import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INDEX_TRANSITION_CONFIG,
  carryIndexTransitionConfig,
  ensureIndexAnimeScript,
  ensureIndexPresentBackgroundStyle,
  parseIndexTransitionConfig,
  patchIndexTransitionConfig,
  validateIndexShellHtml
} from '../../../src/main/session/index-transition'

const baseIndexHtml = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>Deck</title>
  </head>
  <body>
    <div id="frameViewport"><iframe class="ppt-preview-frame"></iframe></div>
    <div class="ppt-controls"></div>
    <script type="application/json" id="pages-data">[]</script>
    <script src="./assets/index-runtime.js"></script>
  </body>
</html>`

describe('index transition config patching', () => {
  it('inserts anime before index-runtime and writes normalized config', () => {
    const next = patchIndexTransitionConfig(baseIndexHtml, {
      type: 'flip',
      durationMs: 520
    })

    expect(next).toContain('<script id="ppt-index-transition-config" type="application/json">{"type":"flip","durationMs":520}</script>')
    expect(next.indexOf('./assets/anime.v4.js')).toBeLessThan(
      next.indexOf('./assets/index-runtime.js')
    )
    expect(validateIndexShellHtml(next)).toEqual([])
  })

  it('removes old CSS transition style and old config', () => {
    const oldHtml = baseIndexHtml.replace(
      '<script src="./assets/index-runtime.js"></script>',
      `<style id="ppt-index-transition-style">.ppt-preview-frame{transition:opacity 420ms}</style>
    <script id="ppt-index-transition-config" type="application/json">{"type":"zoom","durationMs":420}</script>
    <script src="./assets/index-runtime.js"></script>`
    )
    const next = patchIndexTransitionConfig(oldHtml, {
      type: 'stack',
      durationMs: 480
    })

    expect(next).not.toContain('ppt-index-transition-style')
    expect(next.match(/ppt-index-transition-config/g)).toHaveLength(1)
    expect(parseIndexTransitionConfig(next)).toEqual({ type: 'stack', durationMs: 480 })
  })

  it('keeps none at 0ms instead of clamping to the minimum duration', () => {
    const next = patchIndexTransitionConfig(baseIndexHtml, {
      type: 'none',
      durationMs: 999
    })

    expect(parseIndexTransitionConfig(next)).toEqual({ type: 'none', durationMs: 0 })
  })

  it('writes distinctive transition types such as center reveal', () => {
    const next = patchIndexTransitionConfig(baseIndexHtml, {
      type: 'center-reveal',
      durationMs: 580
    })

    expect(parseIndexTransitionConfig(next)).toEqual({ type: 'center-reveal', durationMs: 580 })
  })

  it('does not duplicate anime script', () => {
    const withAnime = ensureIndexAnimeScript(baseIndexHtml)
    const next = ensureIndexAnimeScript(withAnime)

    expect(next.match(/anime\.v4\.js/g)).toHaveLength(1)
  })

  it('adds present-mode black background styles without duplication', () => {
    const withPresentBackground = ensureIndexPresentBackgroundStyle(baseIndexHtml)
    const next = ensureIndexPresentBackgroundStyle(withPresentBackground)

    expect(next.match(/ppt-present-background-style/g)).toHaveLength(1)
    expect(next).toContain('body.present { background: #000000 !important; }')
    expect(next).toContain('body.present .ppt-preview-viewport')
    expect(next.indexOf('ppt-present-background-style')).toBeLessThan(next.indexOf('</head>'))
  })

  it('falls back to default config when JSON is missing or invalid', () => {
    expect(parseIndexTransitionConfig(baseIndexHtml)).toEqual(DEFAULT_INDEX_TRANSITION_CONFIG)
    expect(
      parseIndexTransitionConfig(
        baseIndexHtml.replace(
          '<script src="./assets/index-runtime.js"></script>',
          '<script id="ppt-index-transition-config" type="application/json">{bad}</script><script src="./assets/index-runtime.js"></script>'
        )
      )
    ).toEqual(DEFAULT_INDEX_TRANSITION_CONFIG)
  })

  it('carries old transition config into rebuilt index html', () => {
    const previous = patchIndexTransitionConfig(baseIndexHtml, {
      type: 'slide-up',
      durationMs: 420
    })
    const rebuilt = baseIndexHtml.replace('Deck', 'Renamed Deck')
    const next = carryIndexTransitionConfig(previous, rebuilt)

    expect(next).toContain('Renamed Deck')
    expect(parseIndexTransitionConfig(next)).toEqual({ type: 'slide-up', durationMs: 420 })
  })
})
