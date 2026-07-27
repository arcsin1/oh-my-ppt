import { describe, expect, it } from 'vitest'
import { normalizeCorporateTemplatePageChrome } from '../../../src/main/ipc/generation/template-page-chrome'

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
})
