import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

const projectRoot = path.resolve(__dirname, '../../..')
const pageWriterSource = readFileSync(
  path.join(projectRoot, 'src/main/tools/page-writer.ts'),
  'utf-8'
)
const templateSource = readFileSync(
  path.join(projectRoot, 'src/main/ipc/engine/template.ts'),
  'utf-8'
)
const indexRuntimeSource = readFileSync(
  path.join(projectRoot, 'resources/index-runtime.js'),
  'utf-8'
)
const previewIframeSource = readFileSync(
  path.join(projectRoot, 'src/renderer/src/components/preview/PreviewIframe.tsx'),
  'utf-8'
)

describe('page runtime frame padding', () => {
  it('does not add default padding to the page root', () => {
    expect(pageWriterSource).toContain('.ppt-page-root.p-2,')
    expect(pageWriterSource).toContain('padding: 0;')
    expect(pageWriterSource).not.toContain('padding: 0.5rem')
    expect(pageWriterSource).not.toContain('padding: 2rem')
    expect(pageWriterSource).not.toContain('padding: 3rem')
  })

  it('creates scaffold pages without padding utility classes on the root frame', () => {
    expect(templateSource).toContain('<main class="ppt-page-root" data-ppt-guard-root="1">')
    expect(templateSource).not.toContain('ppt-page-root p-2')
    expect(pageWriterSource).toContain('<main class="ppt-page-root" data-ppt-guard-root="1">')
    expect(pageWriterSource).not.toContain('ppt-page-root p-2')
  })

  it('keeps preview scaling letterboxed to match the fixed 16:9 PPTX canvas', () => {
    expect(indexRuntimeSource).toContain('Math.min(rect.width / 1600, rect.height / 900)')
    expect(indexRuntimeSource).not.toContain('Math.max(rect.width / 1600, rect.height / 900)')
    expect(indexRuntimeSource).toContain('Math.max(0, (rect.width - 1600 * scale) / 2)')

    expect(previewIframeSource).toContain('Math.min(width / 1600, height / 900)')
    expect(previewIframeSource).not.toContain('Math.max(width / 1600, height / 900)')
    expect(previewIframeSource).toContain('Math.max(0, (width - 1600 * nextScale) / 2)')
  })

  it('uses black letterbox bars in presentation mode', () => {
    expect(templateSource).toContain('body.present { background: #000000; }')
    expect(templateSource).toContain('body.present .ppt-preview-viewport { border-radius: 0; background: #000000; }')
    expect(indexRuntimeSource).toContain('function ensurePresentBackgroundStyles()')
    expect(indexRuntimeSource).toContain('body.present { background: #000000 !important; }')
  })
})
