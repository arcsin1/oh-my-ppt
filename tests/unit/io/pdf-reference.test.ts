import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { PNG } from 'pngjs'
import { convertPdfToMarkdown } from '../../../src/main/utils/pdf-reference'

const tempDirs: string[] = []

const makeTempDir = async (): Promise<string> => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'anjian-pdf-test-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true }))
  )
})

describe('PDF reference conversion', () => {
  it('extracts text PDF pages locally without calling OCR', async () => {
    const dir = await makeTempDir()
    const filePath = path.join(dir, 'text.pdf')
    const pdf = await PDFDocument.create()
    const font = await pdf.embedFont(StandardFonts.Helvetica)
    const page = pdf.addPage([600, 800])
    page.drawText('Anjian Jianye internal project summary', { x: 60, y: 720, font, size: 18 })
    await fs.promises.writeFile(filePath, await pdf.save())
    let ocrCalls = 0

    const result = await convertPdfToMarkdown({
      filePath,
      ocrPage: async () => {
        ocrCalls += 1
        return 'should not run'
      }
    })

    expect(result.pageCount).toBe(1)
    expect(result.ocrPageCount).toBe(0)
    expect(result.markdown).toContain('Anjian Jianye internal project summary')
    expect(ocrCalls).toBe(0)
  })

  it('renders scanned pages and uses the supplied vision OCR callback', async () => {
    const dir = await makeTempDir()
    const filePath = path.join(dir, 'scan.pdf')
    const png = new PNG({ width: 120, height: 80 })
    png.data.fill(255)
    const pdf = await PDFDocument.create()
    const image = await pdf.embedPng(PNG.sync.write(png))
    const page = pdf.addPage([600, 800])
    page.drawImage(image, { x: 40, y: 500, width: 520, height: 240 })
    await fs.promises.writeFile(filePath, await pdf.save())

    const result = await convertPdfToMarkdown({
      filePath,
      fileName: '扫描材料.pdf',
      ocrPage: async ({ imageBase64, pageNumber, totalPages }) => {
        expect(imageBase64.length).toBeGreaterThan(100)
        expect(pageNumber).toBe(1)
        expect(totalPages).toBe(1)
        return '## 可见文字\n\n项目进度正常'
      }
    })

    expect(result.ocrPageCount).toBe(1)
    expect(result.markdown).toContain('PDF 第 1 页（图片识别）')
    expect(result.markdown).toContain('项目进度正常')
  })
})
