import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, session: { defaultSession: {} } }))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false, main: true } }))

import { replacePageContentFragment } from '../../../src/main/presentation/html/page-writer-core'

const SHELL_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Target</title>
    <link rel="stylesheet" href="./assets/fonts/inter.css" />
    <style id="ppt-page-guard-style">:root { --ppt-page-bg: #ffffff; }</style>
  </head>
  <body data-page-id="page-1">
    <main class="ppt-page-root" data-ppt-guard-root="1" data-ppt-slide-size-id="wide-16-9" data-ppt-width="1600" data-ppt-height="900">
      <div class="ppt-page-fit-scope">
        <div class="ppt-page-content"><h1>Target</h1></div>
      </div>
    </main>
    <script src="./assets/ppt-page-fit.js"></script>
    <script>window.__ppt = { pageId: 'page-1' }</script>
  </body>
</html>`

describe('replacePageContentFragment', () => {
  it('swaps only .ppt-page-content and preserves the shell, head, fonts, and runtime scripts', () => {
    const fragment = '<section class="grid"><h1>Target</h1><p>subtitle</p></section>'
    const { html, content, repaired } = replacePageContentFragment({
      originalHtml: SHELL_HTML,
      content: fragment,
      pageId: 'page-1'
    })

    expect(content).toBe(fragment)
    expect(repaired).toBe(false)
    // Head, fonts, CSS, runtime scripts are untouched.
    expect(html).toContain('<title>Target</title>')
    expect(html).toContain('./assets/fonts/inter.css')
    expect(html).toContain('ppt-page-guard-style')
    expect(html).toContain('./assets/ppt-page-fit.js')
    expect(html).toContain("window.__ppt = { pageId: 'page-1' }")
    // Shell attributes on .ppt-page-root are preserved.
    expect(html).toContain('data-ppt-slide-size-id="wide-16-9"')
    expect(html).toContain('data-ppt-width="1600"')
    expect(html).toContain('data-ppt-height="900"')
    // The original inner fragment is gone, the new one is in place (the
    // normalizer wraps it in a scaffold and decorates block-level children).
    expect(html).not.toContain('<div class="ppt-page-content"><h1>Target</h1></div>')
    expect(html).toContain('<div class="ppt-page-content">')
    expect(html).toContain('<section class="grid">')
    expect(html).toContain('subtitle</p>')
  })

  it('rejects fragments that reference remote CDN resources', () => {
    expect(() =>
      replacePageContentFragment({
        originalHtml: SHELL_HTML,
        content: '<section><script src="https://cdn.example/lib.js"></script></section>',
        pageId: 'page-1'
      })
    ).toThrow(/CDN\/远程资源引用/)
  })

  it('strips model-authored block ids before persisted validation', () => {
    const { html } = replacePageContentFragment({
      originalHtml: SHELL_HTML,
      content: `
        <section data-block-id="select-arcsin1-5kQfdkFj"><h1>Target</h1></section>
        <section data-block-id="select-arcsin1-5kQfdkFj"><p>subtitle</p></section>
      `,
      pageId: 'page-1'
    })

    expect(html).not.toContain('data-block-id=')
  })

  it('throws when the original page no longer carries the ppt-page-content container', () => {
    expect(() =>
      replacePageContentFragment({
        originalHtml: '<!doctype html><html><body><main class="something-else"></main></body></html>',
        content: '<h1>Target</h1>',
        pageId: 'page-1'
      })
    ).toThrow(/页面主体容器/)
  })
})
