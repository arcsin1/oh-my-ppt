import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), isPackaged: false }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

import { collectEmbeddedFonts } from '../../../src/main/io/html-pptx/font-collect'

const html2pptxNode = (await import(
  pathToFileURL(path.resolve('node_modules/@arcsin1/html2pptx/dist/node.js')).href
)) as { writeHtmlToPptx: (p: string, d: unknown) => void }

import { pathToFileURL } from 'node:url'

// 手工样本生成器（默认跳过）：EOT_SAMPLE_DIR=<输出目录>，可选 EOT_SAMPLE_PROJECT=<项目目录>
// 生成一个带加粗用法的真实 EOT 导出，用于 WPS/PowerPoint 嵌入字体人工验证。
describe.skipIf(!process.env.EOT_SAMPLE_DIR)('eot bold sample', () => {
  it('generates a real eot export with bold usage', async () => {
    const outDir = process.env.EOT_SAMPLE_DIR as string
    mkdirSync(outDir, { recursive: true })
    const projectDir = process.env.EOT_SAMPLE_PROJECT || ''
    if (!projectDir || !existsSync(projectDir)) {
      throw new Error('EOT_SAMPLE_PROJECT must point to an existing project directory')
    }
    const pageHtml = path.join(projectDir, 'page-0aHwF1Sjkk.html')
    const slides = [
      {
        texts: [
          { text: '这是普通粗细的正文字体测试', x: 1, y: 1, w: 8, h: 1, fontSize: 18, fontFace: 'Noto Sans SC' },
          { text: '这是加粗字重的标题字体测试', x: 1, y: 2.5, w: 8, h: 1, fontSize: 28, fontFace: 'Noto Sans SC', bold: true }
        ]
      }
    ]
    const embedded = await collectEmbeddedFonts(projectDir, slides, {
      mode: 'always',
      pageHtmlPaths: [pageHtml]
    })
    console.log('[sample] embedded slots:', embedded.map((e) => `${e.style}:${Math.round(e.ttfBuffer.byteLength / 1024)}KB`).join(', '))
    writeFileSync(path.join(outDir, 'sample.json'), JSON.stringify(embedded.map((e) => ({ style: e.style, bytes: e.ttfBuffer.byteLength }))))
    html2pptxNode.writeHtmlToPptx(path.join(outDir, 'eot-bold-sample.pptx'), {
      title: 'EOT bold sample',
      slides,
      embeddedFonts: embedded
    })
    expect(embedded.length).toBeGreaterThan(0)
  })
})
