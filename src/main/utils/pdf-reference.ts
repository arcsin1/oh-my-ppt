import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import { createCanvas, type Canvas } from '@napi-rs/canvas'
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFPageProxy
} from 'pdfjs-dist/legacy/build/pdf.mjs'

const MAX_PDF_TEXT_PAGES = 200
const MAX_PDF_OCR_PAGES = 50
const MIN_LOCAL_TEXT_CHARS = 12
const OCR_RENDER_WIDTH = 1600
const require = createRequire(import.meta.url)
const PDFJS_PACKAGE_DIR = path.dirname(require.resolve('pdfjs-dist/package.json'))
const PDFJS_STANDARD_FONT_DATA_URL = `${path.join(
  PDFJS_PACKAGE_DIR,
  'standard_fonts'
)}${path.sep}`
GlobalWorkerOptions.workerSrc = pathToFileURL(
  path.join(PDFJS_PACKAGE_DIR, 'legacy', 'build', 'pdf.worker.mjs')
).href

type CanvasAndContext = {
  canvas: Canvas
  context: ReturnType<Canvas['getContext']>
}

class NapiCanvasFactory {
  create(width: number, height: number): CanvasAndContext {
    const canvas = createCanvas(width, height)
    return { canvas, context: canvas.getContext('2d') }
  }

  reset(target: CanvasAndContext, width: number, height: number): void {
    target.canvas.width = width
    target.canvas.height = height
  }

  destroy(target: CanvasAndContext): void {
    target.canvas.width = 0
    target.canvas.height = 0
  }
}

type PdfTextItem = {
  str?: string
  hasEOL?: boolean
}

export type PdfOcrPage = (args: {
  imageBase64: string
  mimeType: 'image/jpeg'
  pageNumber: number
  totalPages: number
  fileName: string
}) => Promise<string>

export type PdfReferenceResult = {
  markdown: string
  pageCount: number
  ocrPageCount: number
}

const compactExtractedText = (items: unknown[]): string => {
  let text = ''
  for (const rawItem of items) {
    const item = rawItem && typeof rawItem === 'object' ? (rawItem as PdfTextItem) : {}
    const value = typeof item.str === 'string' ? item.str.replace(/\s+/g, ' ').trim() : ''
    if (value) text += `${value}${item.hasEOL ? '\n' : ' '}`
  }
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

const renderPageForOcr = async (page: PDFPageProxy): Promise<string> => {
  const baseViewport = page.getViewport({ scale: 1 })
  const scale = Math.max(1, Math.min(2.5, OCR_RENDER_WIDTH / baseViewport.width))
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  await page
    .render({
      canvas: canvas as unknown as HTMLCanvasElement,
      viewport
    })
    .promise
  return canvas.toBuffer('image/jpeg', 82).toString('base64')
}

const normalizeOcrText = (value: string): string =>
  value
    .replace(/^```(?:markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()

export const convertPdfToMarkdown = async (args: {
  filePath: string
  fileName?: string
  ocrPage?: PdfOcrPage
}): Promise<PdfReferenceResult> => {
  const fileName = args.fileName?.trim() || path.basename(args.filePath)
  const data = new Uint8Array(await fs.promises.readFile(args.filePath))
  const loadingTask = getDocument({
    data,
    CanvasFactory: NapiCanvasFactory,
    standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_URL
  })
  const document = await loadingTask.promise

  try {
    if (document.numPages < 1) throw new Error(`${fileName} 没有可读取的页面`)
    if (document.numPages > MAX_PDF_TEXT_PAGES) {
      throw new Error(`PDF 最多读取 ${MAX_PDF_TEXT_PAGES} 页，请拆分后重试`)
    }

    const pages: Array<{ page: PDFPageProxy; text: string; needsOcr: boolean }> = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = compactExtractedText(content.items)
      pages.push({ page, text, needsOcr: text.length < MIN_LOCAL_TEXT_CHARS })
    }

    const ocrTargets = pages.filter((page) => page.needsOcr)
    if (ocrTargets.length > 0 && !args.ocrPage) {
      throw new Error('检测到扫描型 PDF，请使用已配置的支持图片识别的公司模型进行解析')
    }
    if (ocrTargets.length > MAX_PDF_OCR_PAGES) {
      throw new Error(`扫描型 PDF 一次最多识别 ${MAX_PDF_OCR_PAGES} 页，请拆分后重试`)
    }

    for (let index = 0; index < pages.length; index += 1) {
      const item = pages[index]
      if (!item.needsOcr || !args.ocrPage) continue
      const imageBase64 = await renderPageForOcr(item.page)
      const ocrText = normalizeOcrText(
        await args.ocrPage({
          imageBase64,
          mimeType: 'image/jpeg',
          pageNumber: index + 1,
          totalPages: document.numPages,
          fileName
        })
      )
      if (!ocrText) throw new Error(`PDF 第 ${index + 1} 页未识别出可用内容`)
      item.text = ocrText
    }

    const title = path.basename(fileName, path.extname(fileName)) || 'PDF 参考资料'
    const markdown = [
      `# ${title}`,
      '',
      `> 来源：${fileName}`,
      `> 共 ${document.numPages} 页；其中 ${ocrTargets.length} 页通过图片识别读取。`,
      '> 识别结果仅作为演示文稿内容参考；模糊、缺失或不确定的信息不得补写。',
      '',
      ...pages.flatMap((item, index) => [
        `## PDF 第 ${index + 1} 页${item.needsOcr ? '（图片识别）' : ''}`,
        '',
        item.text || '[本页未提取到可用文字]',
        ''
      ])
    ]
      .join('\n')
      .trim()

    return {
      markdown,
      pageCount: document.numPages,
      ocrPageCount: ocrTargets.length
    }
  } finally {
    await document.destroy()
  }
}
