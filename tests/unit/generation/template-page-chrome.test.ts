import { describe, expect, it } from 'vitest'
import {
  normalizeCorporateTemplatePageChrome,
  validateCorporateTemplateBodyPageLayout
} from '../../../src/main/ipc/generation/template-page-chrome'

const BODY_PAGE = `<!doctype html>
<html>
  <body>
    <main>
      <section data-block-id="content"><p>20页报告说明</p></section>
      <section data-block-id="footer">
        <p><span>‹#›</span><span>页</span><span>/20</span><span>页</span></p>
      </section>
    </main>
  </body>
</html>`

const CORPORATE_BODY_PAGE = `<!doctype html>
<html>
  <body>
    <main class="ppt-page-root" data-ppt-guard-root="1">
      <div class="ppt-page-content">
        <section data-page-scaffold="1" style="position:relative;width:1600px;height:900px">
          <main data-block-id="content" data-role="content" style="position:absolute;inset:0">
            <section data-block-id="text-1" style="position:absolute;left:0px;top:0px;width:347.3px;height:127.2px;background:#ed7d31"></section>
            <section data-block-id="title" data-role="title" style="position:absolute;left:0px;top:0px;width:347.3px;height:128.3px;padding:14.2px;display:flex;flex-direction:column;justify-content:center;font-size:40px;line-height:47.2px">
              <p><span style="font-size:46.7px">安恒二号基本情况</span></p>
              <p><span style="font-size:40px">与注销方案</span></p>
            </section>
            <section data-block-id="body-layout" style="position:absolute;left:72px;top:168px;width:1456px;height:620px">
              <h2>安恒二号基本情况</h2>
              <p>正文内容</p>
            </section>
            <section data-block-id="footer">
              <p><span>‹#›</span><span>页</span><span>/20</span><span>页</span></p>
            </section>
          </main>
        </section>
      </div>
    </main>
  </body>
</html>`

describe('normalizeCorporateTemplatePageChrome', () => {
  it('replaces the current-page placeholder and sample total only in the footer section', () => {
    const result = normalizeCorporateTemplatePageChrome(BODY_PAGE, {
      pageNumber: 3,
      totalPages: 5,
      templateRole: 'body'
    })

    expect(result).toContain('<span>3</span>')
    expect(result).toContain('<span>/5</span>')
    expect(result).toContain('20页报告说明')
    expect(result).not.toContain('‹#›')
  })

  it('keeps the fixed closing page unchanged', () => {
    expect(
      normalizeCorporateTemplatePageChrome(BODY_PAGE, {
        pageNumber: 5,
        totalPages: 5,
        templateRole: 'closing'
      })
    ).toBe(BODY_PAGE)
  })

  it('fits both corporate header title rows without allowing an orphan wrap', () => {
    const result = normalizeCorporateTemplatePageChrome(CORPORATE_BODY_PAGE, {
      pageNumber: 3,
      totalPages: 7,
      templateRole: 'body'
    })

    expect(result).toContain('data-corporate-title-fit="1"')
    expect(result).toContain('data-corporate-title-line="1"')
    expect(result).toContain('white-space: nowrap')
    expect(result).toContain('data-ppt-corporate-title-fit')
    expect(result).toContain('安恒二号基本情况')
    expect(result).toContain('与注销方案')
  })
})

describe('validateCorporateTemplateBodyPageLayout', () => {
  it('accepts a body region centered on the full slide below the header', () => {
    expect(validateCorporateTemplateBodyPageLayout(CORPORATE_BODY_PAGE)).toEqual({
      valid: true,
      errors: []
    })
  })

  it('rejects a generated full-height sidebar copied from the 347px header block', () => {
    const result = validateCorporateTemplateBodyPageLayout(
      CORPORATE_BODY_PAGE.replace(
        '<section data-block-id="body-layout" style="position:absolute;left:72px;top:168px;width:1456px;height:620px">',
        `<div data-block-id="body-layout" class="w-full h-full flex">
          <aside class="w-[347px] h-full flex-shrink-0 bg-[#ed7d31]">侧栏</aside>
          <section class="flex-1">`
      ).replace(
        '</section>\n            <section data-block-id="footer">',
        '</section></div>\n            <section data-block-id="footer">'
      )
    )

    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toContain('整页侧栏')
  })

  it('rejects an absolutely positioned body whose visual center is too far right', () => {
    const result = validateCorporateTemplateBodyPageLayout(
      CORPORATE_BODY_PAGE.replace(
        'left:72px;top:168px;width:1456px',
        'left:395px;top:168px;width:1157px'
      )
    )

    expect(result.valid).toBe(false)
    expect(result.errors.join('\n')).toContain('正文区域偏右')
  })
})
