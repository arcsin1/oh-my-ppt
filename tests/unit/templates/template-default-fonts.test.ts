import { describe, expect, it } from 'vitest'
import { applyTemplateDefaultFonts } from '../../../src/main/ipc/templates/template-default-fonts'

const IMPORTED_PAGE = `<!doctype html>
<html>
  <head>
    <style id="ppt-page-guard-style">
      html, body {
        font-family: "SF Pro Text", "PingFang SC", "Helvetica Neue", Arial, sans-serif;
      }
    </style>
  </head>
  <body><section style="position:absolute;left:10px">固定结束页</section></body>
</html>`

describe('applyTemplateDefaultFonts', () => {
  it('applies the configured template fonts without changing slide content or layout', () => {
    const result = applyTemplateDefaultFonts(IMPORTED_PAGE, {
      titleFont: 'KaiTi',
      bodyFont: 'KaiTi'
    })

    expect(result).toContain('--ppt-title-font:"KaiTi"')
    expect(result).toContain('--ppt-body-font:"KaiTi"')
    expect(result).toContain('font-family: var(--ppt-body-font);')
    expect(result).toContain('style="position:absolute;left:10px"')
    expect(result).toContain('固定结束页')
    expect(result).not.toContain('"SF Pro Text"')
  })

  it('replaces an existing template font declaration instead of duplicating it', () => {
    const first = applyTemplateDefaultFonts(IMPORTED_PAGE, {
      titleFont: 'KaiTi',
      bodyFont: 'KaiTi'
    })
    const second = applyTemplateDefaultFonts(first, {
      titleFont: 'KaiTi',
      bodyFont: 'KaiTi'
    })

    expect(second.match(/data-ppt-fonts="1"/g)).toHaveLength(1)
  })
})
