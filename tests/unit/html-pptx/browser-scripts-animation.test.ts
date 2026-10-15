/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  COLLECT_PPTX_ANIMATION_TRACES_SCRIPT,
  buildMarkPptxExtractedTextForBackgroundScript,
  FREEZE_PAGE_FOR_PPTX_SCRIPT,
  HAS_DECLARED_PPTX_ANIMATION_SCRIPT,
  HIDE_FOR_PPTX_BACKGROUND_SCRIPT
} from '../../../src/main/io/html-pptx/browser-scripts'

const rect = (left: number, top: number, width: number, height: number) => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height
})

const assignRect = (selector: string, left: number, top: number, width = 120, height = 48) => {
  const el = document.querySelector(selector)
  if (!el) throw new Error(`Missing test node: ${selector}`)
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => rect(left, top, width, height),
    configurable: true
  })
  return el
}

const collectTraces = () =>
  new Function(`return ${COLLECT_PPTX_ANIMATION_TRACES_SCRIPT.trim()}`)() as Array<
    Record<string, number | string>
  >

describe('PPTX animation browser scripts', () => {
  it('uses a slide transition instead of emitting unreliable element timing', () => {
    expect(FREEZE_PAGE_FOR_PPTX_SCRIPT).not.toContain('data-pptx-native-anim')
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).not.toContain('[data-pptx-native-anim]')
    const rendererSource = fs.readFileSync(
      path.resolve('src/main/io/html-pptx/renderer.ts'),
      'utf8'
    )
    expect(rendererSource).toContain("animationMode = 'slide-transition'")
    expect(rendererSource).toContain("animationMode === 'slide-transition'")
    expect(rendererSource).toContain("slide.transitionType = 'fade'")
    expect(rendererSource).not.toContain("animationMode === 'native-element'")
    expect(rendererSource).not.toContain('slide.animationTraces = traces')
  })

  it('detects source animation for a slide-level transition without using element timing', () => {
    document.body.innerHTML = '<div class="ppt-page-root"><p>Static</p></div>'
    const hasAnimation = () =>
      new Function(`return ${HAS_DECLARED_PPTX_ANIMATION_SCRIPT.trim()}`)() as boolean

    expect(hasAnimation()).toBe(false)
    document.querySelector('.ppt-page-root')?.setAttribute('data-anim', 'fade-up')
    expect(hasAnimation()).toBe(true)

    document.querySelector('.ppt-page-root')?.setAttribute('data-anim', 'none')
    expect(hasAnimation()).toBe(false)
  })

  it('freezes animation visibility without killing static class transforms', () => {
    // data-anim / opacity-0 元素的 class transform 可能是静态定位（如
    // -translate-y-1/2 垂直居中的装饰水印），FREEZE 不得整体清零，
    // 否则背景截图里元素坠到错误位置；动画脚手架由 JS 遍历按行内样式清除。
    expect(FREEZE_PAGE_FOR_PPTX_SCRIPT).toContain(
      "'.opacity-0, [data-anim] { opacity: 1 !important; }'"
    )
    expect(FREEZE_PAGE_FOR_PPTX_SCRIPT).toContain(
      "'[data-anime], [data-animate] { opacity: 1 !important; transform: none !important; }'"
    )
    expect(FREEZE_PAGE_FOR_PPTX_SCRIPT).not.toContain(
      '[data-anim] { opacity: 1 !important; transform: none !important; }'
    )
  })

  it('removes extracted text even when its source container is animated', () => {
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain(
      '[data-pptx-extracted-shape]:not([data-pptx-static-background])'
    )
    // 已提取文本连同后代都要在背景截图里隐藏；唯一豁免是 aria-hidden 装饰子树
    //（提取端有意跳过它们、留给栅格背景，见 run-color-fidelity.test.ts）
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain(
      '[data-pptx-extracted-text], [data-pptx-extracted-text] *:not(:is([aria-hidden="true"], [aria-hidden="true"] *)), [data-pptx-background-text-match]'
    )
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).not.toContain(
      'body *:not(canvas):not(svg):not(svg *):not([data-pptx-extracted-image])'
    )
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain('[data-pptx-has-before]::before')
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain('[data-pptx-has-after]::after')
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain(
      "'[data-pptx-extracted-image] { opacity: 0 !important; visibility: hidden !important; }'"
    )
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain('const horizontalTolerance = 2;')
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain('const verticalTolerance = 2;')
  })

  it('does not invent native effects for legacy opacity markers', () => {
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).not.toContain(
      "collectTrace(el, 'fade-up', 'load', 'bottom', 560, index * 45"
    )
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).not.toContain('legacyTargets')
  })

  it('adds an all-descendants text mask from exported PPT text boxes', () => {
    const script = buildMarkPptxExtractedTextForBackgroundScript([{ x: 1, y: 2, w: 3, h: 0.5 }])

    expect(script).toContain('data-pptx-background-text-match')
    expect(script).toContain('every descendant text fragment maps to a')
    expect(script).toContain('"x":1')
    expect(script).toContain('overlap / rectArea >= 0.85')
    expect(script).not.toContain('centerInside')
  })

  it('maps text boxes against the requested 4:3 slide size', () => {
    const script = buildMarkPptxExtractedTextForBackgroundScript(
      [{ x: 1, y: 2, w: 3, h: 0.5 }],
      { widthIn: 10, heightIn: 7.5 }
    )

    expect(script).toContain('const slideWidth = 10;')
    expect(script).toContain('const slideHeight = 7.5;')
  })

  it('marks a mixed text container only when every fragment has an exported PPT text box', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root" data-ppt-guard-root="1">
        <p id="exported">$528<span>亿</span></p>
        <p id="fallback">Background fallback</p>
      </div>
    `
    assignRect('.ppt-page-root', 0, 0, 1600, 900)

    const originalCreateRange = document.createRange.bind(document)
    document.createRange = (() => {
      let selectedNode: Node | null = null
      return {
        selectNodeContents: (node: Node) => {
          selectedNode = node
        },
        getClientRects: () =>
          selectedNode?.textContent === '$528'
            ? [rect(120, 250, 100, 24)]
            : selectedNode?.textContent === '亿'
              ? [rect(220, 260, 30, 18)]
              : [rect(760, 450, 180, 24)]
      } as unknown as Range
    }) as typeof document.createRange

    try {
      const script = buildMarkPptxExtractedTextForBackgroundScript([
        { x: 1, y: 2, w: 1.8, h: 0.5 },
        { x: 1.8, y: 2.1, w: 0.4, h: 0.3 }
      ])
      const marked = new Function(`return ${script.trim()}`)() as number

      expect(marked).toBeGreaterThan(0)
      expect(
        document.querySelector('#exported')?.getAttribute('data-pptx-background-text-match')
      ).toBe('1')
      expect(
        document.querySelector('#fallback')?.hasAttribute('data-pptx-background-text-match')
      ).toBe(false)
    } finally {
      document.createRange = originalCreateRange
    }
  })

  it('clears stale text masks before a background-capture retry', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root" data-ppt-guard-root="1">
        <p id="exported">Exported text</p>
      </div>
    `
    assignRect('.ppt-page-root', 0, 0, 1600, 900)

    const originalCreateRange = document.createRange.bind(document)
    document.createRange = (() => {
      return {
        selectNodeContents: () => {},
        getClientRects: () => [rect(120, 240, 160, 24)]
      } as unknown as Range
    }) as typeof document.createRange

    try {
      const firstAttempt = buildMarkPptxExtractedTextForBackgroundScript([
        { x: 1, y: 2, w: 1.5, h: 0.3 }
      ])
      new Function(`return ${firstAttempt.trim()}`)()
      expect(
        document.querySelector('#exported')?.hasAttribute('data-pptx-background-text-match')
      ).toBe(true)

      const retryWithoutText = buildMarkPptxExtractedTextForBackgroundScript([])
      new Function(`return ${retryWithoutText.trim()}`)()
      expect(
        document.querySelector('#exported')?.hasAttribute('data-pptx-background-text-match')
      ).toBe(false)
    } finally {
      document.createRange = originalCreateRange
    }
  })

  it('keeps partially covered text in the raster background', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root" data-ppt-guard-root="1">
        <p id="partial">Long fallback text</p>
      </div>
    `
    assignRect('.ppt-page-root', 0, 0, 1600, 900)

    const originalCreateRange = document.createRange.bind(document)
    document.createRange = (() => {
      return {
        selectNodeContents: () => {},
        getClientRects: () => [rect(120, 250, 100, 24)]
      } as unknown as Range
    }) as typeof document.createRange

    try {
      const script = buildMarkPptxExtractedTextForBackgroundScript([
        { x: 1, y: 2.083333, w: 0.416667, h: 0.2 }
      ])
      new Function(`return ${script.trim()}`)()

      expect(
        document.querySelector('#partial')?.hasAttribute('data-pptx-background-text-match')
      ).toBe(false)
    } finally {
      document.createRange = originalCreateRange
    }
  })

  it('collects extended data-anim metadata for native PPTX export', () => {
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("'fly-in'")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("'slide-down'")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("'slide-right'")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("'grow-shrink-soft'")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("'pulse-strong'")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("'exit-scale'")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("'exit-zoom'")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("'exit-wipe'")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("'exit-fly'")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("'path'")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain(
      "const supportedTriggers = new Set(['load', 'click', 'with', 'after'])"
    )
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain(
      "const supportedSequences = new Set(['with', 'after'])"
    )
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain(
      "const sequence = normalizeSequence(el.getAttribute('data-anim-sequence'));"
    )
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain(
      "const clickGroupRaw = normalizeClickGroup(el.getAttribute('data-anim-click-group'));"
    )
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain(
      "const staggerRaw = (el.getAttribute('data-anim-stagger') || '').trim();"
    )
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain('from,')
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain(
      'collectTrace(target, type, effectiveTrigger, from'
    )
  })

  it('keeps unsupported path motion in the static fallback', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="path" data-anim-path="M 0 0 L 120 30" data-pptx-extracted-text="1" id="path-ok">Path</div>
        <div data-anim="path" data-anim-path="#curve" data-pptx-extracted-text="1" id="path-bad">Bad</div>
      </div>
    `

    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#path-ok', 100, 100)
    assignRect('#path-bad', 100, 180)

    const traces = collectTraces()

    expect(traces).toHaveLength(0)
  })

  it('only collects extracted descendants so unmapped visuals stay in the fallback', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <section data-anim="zoom-in" id="group">
          <p data-pptx-extracted-text="1" id="title">Extracted title</p>
          <canvas id="chart"></canvas>
        </section>
        <p data-anim="fade" id="unmapped">Unmapped text</p>
      </div>
    `

    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#group', 100, 80, 600, 260)
    assignRect('#title', 140, 110, 360, 64)
    assignRect('#chart', 140, 200, 420, 120)
    assignRect('#unmapped', 120, 400, 360, 64)

    const traces = collectTraces()

    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({ type: 'zoom-in', x: 140, y: 110, w: 360, h: 64 })
  })

  it('computes load sequencing from data-anim-sequence during trace collection', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="fade-up" data-anim-duration="400" data-pptx-extracted-text="1" id="lead">Lead</div>
        <div data-anim="fade-up" data-anim-sequence="with" data-anim-delay="50" data-anim-duration="300" data-pptx-extracted-text="1" id="with">With</div>
        <div data-anim="fade-up" data-anim-sequence="after" data-anim-delay="20" data-anim-duration="200" data-pptx-extracted-text="1" id="after">After</div>
      </div>
    `

    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#lead', 100, 100)
    assignRect('#with', 100, 180)
    assignRect('#after', 100, 260)

    const traces = collectTraces()

    expect(traces).toHaveLength(3)
    expect(traces[0]).toMatchObject({ trigger: 'load', delay: 0, order: 0 })
    expect(traces[1]).toMatchObject({ trigger: 'load', delay: 50, order: 1 })
    expect(traces[2]).toMatchObject({ trigger: 'load', delay: 420, order: 2 })
  })

  it('keeps click-trigger stagger independent from load sequencing during trace collection', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="fade-up" data-anim-stagger="80" data-pptx-extracted-text="1" id="load-a">Load A</div>
        <div data-anim="fade-up" data-anim-stagger="80" data-pptx-extracted-text="1" id="load-b">Load B</div>
        <div data-anim="fade-up" data-anim-trigger="click" data-anim-stagger="90" data-pptx-extracted-text="1" id="click-a">Click A</div>
        <div data-anim="fade-up" data-anim-trigger="click" data-anim-stagger="90" data-anim-sequence="after" data-pptx-extracted-text="1" id="click-b">Click B</div>
      </div>
    `

    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#load-a', 100, 100)
    assignRect('#load-b', 100, 180)
    assignRect('#click-a', 100, 260)
    assignRect('#click-b', 100, 340)

    const traces = collectTraces()

    expect(traces).toHaveLength(4)
    expect(traces[0]).toMatchObject({ trigger: 'load', delay: 0, order: 0 })
    expect(traces[1]).toMatchObject({ trigger: 'load', delay: 80, order: 1 })
    expect(traces[2]).toMatchObject({ trigger: 'click', delay: 0, order: 2 })
    expect(traces[3]).toMatchObject({ trigger: 'click', delay: 90, order: 3 })
  })

  it('keeps contiguous click-group traces on the same click step and drops non-click grouping metadata', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="fade-up" data-anim-trigger="click" data-anim-click-group="reveal" data-pptx-extracted-text="1" id="click-a">Click A</div>
        <div data-anim="pulse-soft" data-anim-trigger="click" data-anim-click-group="reveal" data-pptx-extracted-text="1" id="click-b">Click B</div>
        <div data-anim="pulse-strong" data-anim-trigger="click" data-pptx-extracted-text="1" id="click-c">Click C</div>
        <div data-anim="fade" data-anim-click-group="ignored" data-pptx-extracted-text="1" id="load-a">Load A</div>
      </div>
    `

    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#click-a', 100, 100)
    assignRect('#click-b', 100, 180)
    assignRect('#click-c', 100, 260)
    assignRect('#load-a', 100, 340)

    const traces = collectTraces()

    expect(traces).toHaveLength(4)
    expect(traces[0]).toMatchObject({ trigger: 'click', clickGroup: 'reveal', type: 'fade-up' })
    expect(traces[1]).toMatchObject({ trigger: 'click', clickGroup: 'reveal', type: 'pulse-soft' })
    expect(traces[2]).toMatchObject({ trigger: 'click', type: 'pulse-strong' })
    expect(traces[2]).not.toHaveProperty('clickGroup')
    expect(traces[3]).toMatchObject({ trigger: 'load', type: 'fade' })
    expect(traces[3]).not.toHaveProperty('clickGroup')
  })

  it('derives default directional origins for symmetry and exit-wipe candidates', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="slide-down" data-pptx-extracted-text="1" id="down">Down</div>
        <div data-anim="slide-right" data-pptx-extracted-text="1" id="right">Right</div>
        <div data-anim="exit-wipe" data-pptx-extracted-text="1" id="exit">Exit</div>
      </div>
    `

    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#down', 100, 100)
    assignRect('#right', 100, 180)
    assignRect('#exit', 100, 260)

    const traces = collectTraces()

    expect(traces[0]).toMatchObject({ type: 'slide-down', from: 'top' })
    expect(traces[1]).toMatchObject({ type: 'slide-right', from: 'left' })
    expect(traces[2]).toMatchObject({ type: 'exit-wipe', from: 'left' })
  })
})
