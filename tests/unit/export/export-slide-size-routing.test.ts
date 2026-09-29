import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const exportHandlersSource = (): string =>
  fs.readFileSync(path.resolve('src/main/io/export-handlers.ts'), 'utf8')

const handlerSource = (source: string, channel: string, nextChannel: string): string =>
  source.slice(
    source.indexOf(`ipcMain.handle('${channel}'`),
    source.indexOf(`ipcMain.handle('${nextChannel}'`)
  )

describe('export slide-size routing', () => {
  it('routes a supported 16:9 or 4:3 slide size through PPTX export', () => {
    const source = exportHandlersSource()
    const pptxHandler = handlerSource(source, 'export:pptx', 'export:video')
    const writer = fs.readFileSync(path.resolve('src/main/io/pptx-export.ts'), 'utf8')

    expect(pptxHandler).toContain('const slideSize = requireSessionSlideSize(session)')
    expect(pptxHandler).toContain('assertPptxExportSupported(slideSize)')
    expect(pptxHandler).toContain('writeSessionPptx(')
    expect(writer).toContain('const pptxLayout = resolvePptxExportLayout(slideSize)')
    expect(writer).toContain('widthIn: pptxLayout.slideWidthIn')
    expect(writer).toContain('heightIn: pptxLayout.slideHeightIn')
  })

  it('uses a standard video frame while passing slide size for centered page fitting', () => {
    const source = exportHandlersSource()
    const videoHandler = handlerSource(source, 'export:video', 'export:outlinesMarkdown')

    expect(videoHandler).toContain('const slideSize = requireSessionSlideSize(session)')
    expect(videoHandler).toContain('slideSize,')
    expect(videoHandler).not.toContain('width: slideSize.width')
    expect(videoHandler).not.toContain('height: slideSize.height')
    expect(videoHandler).toContain('exportHtmlPagesToVideo({')
  })
})
