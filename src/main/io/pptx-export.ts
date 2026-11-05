import log from 'electron-log/main.js'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { nanoid } from 'nanoid'
import pLimit from 'p-limit'
import { type HtmlToPptxEmbeddedFont, type HtmlToPptxSlide } from '@arcsin1/html2pptx'
import { writeHtmlToPptx } from '@arcsin1/html2pptx/node'
import { assertPptxExportSupported, requireSessionSlideSize } from '@shared/slide-size'
import type { ExportProgressStage } from '@shared/export-progress'
import type { PageExport } from '../ipc/runtime/page-export'
import { collectEmbeddedFonts } from './html-pptx/font-collect'
import { captureHtmlPageToPptxImageSlide, extractHtmlPageToPptxSlide } from './html-pptx/renderer'
import { resolvePptxExportLayout } from './html-pptx/static-background'

const EXPORT_PAGE_RENDER_CONCURRENCY = Math.max(1, Math.min(2, os.cpus().length || 1))

export type WriteSessionPptxProgress = {
  stage: ExportProgressStage
  progress: number
  current?: number
  total?: number
}

export type WriteSessionPptxArgs = {
  sessionId: string
  outputPath: string
  imageOnly?: boolean
  embedFonts?: 'auto' | 'always' | 'never'
  pageId?: string
  resolveSessionPageFiles: PageExport['resolveSessionPageFiles']
  waitForPrintReadySignal: PageExport['waitForPrintReadySignal']
  timeoutMs: number
  settleMs: number
  db: {
    getProject(sessionId: string): Promise<{ id: string } | undefined | null>
    updateProjectStatus(id: string, status: 'exported'): Promise<void>
  }
  onProgress?: (payload: WriteSessionPptxProgress) => void
}

export type WriteSessionPptxResult = {
  outputPath: string
  pageCount: number
  warnings: string[]
}

const clampExportProgress = (progress: number): number =>
  Math.max(0, Math.min(100, Math.round(progress)))

const scaleExportProgress = (
  current: number,
  total: number,
  startProgress: number,
  endProgress: number
): number => {
  if (total <= 0) return clampExportProgress(startProgress)
  const ratio = Math.max(0, Math.min(1, current / total))
  return clampExportProgress(startProgress + (endProgress - startProgress) * ratio)
}

const mapPageBatch = async <T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  const limit = pLimit(EXPORT_PAGE_RENDER_CONCURRENCY)
  return Promise.all(items.map((item, index) => limit(() => worker(item, index))))
}

const replaceFile = async (fromPath: string, toPath: string): Promise<void> => {
  try {
    await fs.promises.rename(fromPath, toPath)
  } catch {
    await fs.promises.copyFile(fromPath, toPath)
    await fs.promises.unlink(fromPath)
  }
}

export async function writeSessionPptx(
  args: WriteSessionPptxArgs
): Promise<WriteSessionPptxResult> {
  const {
    sessionId,
    outputPath,
    imageOnly = false,
    pageId = '',
    resolveSessionPageFiles,
    waitForPrintReadySignal,
    timeoutMs,
    settleMs,
    db,
    onProgress
  } = args
  const fontEmbedMode = imageOnly ? 'never' : (args.embedFonts ?? 'always')
  const requestedPageId = pageId.trim()

  const { session, pages: allPages, projectDir } = await resolveSessionPageFiles(sessionId)
  const slideSize = requireSessionSlideSize(session)
  assertPptxExportSupported(slideSize)
  const pptxLayout = resolvePptxExportLayout(slideSize)
  const pages = requestedPageId ? allPages.filter((page) => page.id === requestedPageId) : allPages
  if (requestedPageId && pages.length === 0) {
    throw new Error(`页面不存在：${requestedPageId}`)
  }

  const sessionTitle =
    typeof session.title === 'string' && session.title.trim().length > 0
      ? session.title.trim()
      : `ohmyppt-${sessionId}`
  const warnings: string[] = []
  const sendProgress = (payload: WriteSessionPptxProgress): void => {
    onProgress?.(payload)
  }

  let extractedCount = 0
  sendProgress({
    stage: 'preparing',
    progress: 3,
    current: 0,
    total: pages.length
  })
  const slides: HtmlToPptxSlide[] = []
  for (let start = 0; start < pages.length; start += EXPORT_PAGE_RENDER_CONCURRENCY) {
    const pageBatch = pages.slice(start, start + EXPORT_PAGE_RENDER_CONCURRENCY)
    const extractedPages = await mapPageBatch(pageBatch, async (page) => {
      const mode = imageOnly ? 'image' : 'editable'
      log.info('[export:pptx] extract page', {
        sessionId,
        sessionPageId: page.id,
        pageId: page.pageId,
        htmlPath: page.htmlPath,
        mode,
        singlePage: Boolean(requestedPageId)
      })
      return imageOnly
        ? captureHtmlPageToPptxImageSlide({
            page,
            slideSize,
            timeoutMs,
            settleMs,
            waitForPrintReadySignal
          })
        : extractHtmlPageToPptxSlide({
            page,
            slideSize,
            timeoutMs,
            settleMs,
            animationMode: 'slide-transition',
            waitForPrintReadySignal
          })
    })
    for (const extracted of extractedPages) {
      slides.push(extracted.slide)
      if (extracted.warning) warnings.push(extracted.warning)
      extractedCount += 1
      sendProgress({
        stage: 'rendering',
        progress: scaleExportProgress(extractedCount, pages.length, 8, 82),
        current: extractedCount,
        total: pages.length
      })
    }
  }

  if (!imageOnly) {
    const pagesWithoutText = slides.filter((s) => s.texts.length === 0).length
    if (pagesWithoutText > 0) {
      warnings.push(`${pages.length} 页中有 ${pagesWithoutText} 页未提取到可编辑文本。`)
    }
  }

  let embeddedFonts: HtmlToPptxEmbeddedFont[] = []
  if (!imageOnly) {
    try {
      sendProgress({
        stage: 'packaging',
        progress: 88,
        current: pages.length,
        total: pages.length
      })
      embeddedFonts = await collectEmbeddedFonts(projectDir, slides, {
        mode: fontEmbedMode,
        maxTotalBytes: 20 * 1024 * 1024,
        pageHtmlPaths: pages.map((page) => page.htmlPath)
      })
    } catch (error) {
      log.warn('[export:pptx] font embedding collection failed, fallback to system fonts', {
        sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
      warnings.push('字体嵌入失败，已自动改用 PowerPoint 本机字体导出。')
    }
  }

  sendProgress({
    stage: 'writing',
    progress: 94,
    current: pages.length,
    total: pages.length
  })

  const resolvedOutputPath = path.resolve(outputPath)
  await fs.promises.mkdir(path.dirname(resolvedOutputPath), { recursive: true })
  const tempPath = path.join(
    path.dirname(resolvedOutputPath),
    `.${path.basename(resolvedOutputPath)}.${nanoid(8)}.tmp`
  )
  const writeTemp = async (fonts: HtmlToPptxEmbeddedFont[]): Promise<void> => {
    await writeHtmlToPptx(tempPath, {
      title: sessionTitle,
      author: 'OhMyPPT',
      slides,
      slideSize: {
        widthIn: pptxLayout.slideWidthIn,
        heightIn: pptxLayout.slideHeightIn
      },
      embeddedFonts: fonts.length > 0 ? fonts : undefined
    })
  }

  try {
    try {
      await writeTemp(embeddedFonts)
    } catch (error) {
      if (embeddedFonts.length === 0) throw error
      log.warn('[export:pptx] write with embedded fonts failed, retry without fonts', {
        sessionId,
        message: error instanceof Error ? error.message : String(error)
      })
      warnings.push('字体嵌入写入失败，已自动降级为 PowerPoint 本机字体导出。')
      embeddedFonts = []
      await writeTemp(embeddedFonts)
    }
    await replaceFile(tempPath, resolvedOutputPath)
  } finally {
    await fs.promises.unlink(tempPath).catch(() => undefined)
  }

  const project = await db.getProject(sessionId)
  if (project?.id) {
    await db.updateProjectStatus(project.id, 'exported')
  }

  log.info('[export:pptx] completed', {
    sessionId,
    pageCount: slides.length,
    filePath: resolvedOutputPath,
    warningCount: warnings.length,
    imageOnly,
    sessionPageId: requestedPageId || undefined,
    fontEmbedMode,
    embeddedFontCount: embeddedFonts.length
  })

  return {
    outputPath: resolvedOutputPath,
    pageCount: slides.length,
    warnings
  }
}
