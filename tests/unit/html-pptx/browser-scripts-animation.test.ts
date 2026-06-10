/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import {
  COLLECT_PPTX_ANIMATION_TRACES_SCRIPT,
  FREEZE_PAGE_FOR_PPTX_SCRIPT,
  HIDE_FOR_PPTX_BACKGROUND_SCRIPT
} from '../../../src/main/utils/html-pptx/browser-scripts'

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
  it('marks data-anim nodes for native animation without baking them into the background', () => {
    expect(FREEZE_PAGE_FOR_PPTX_SCRIPT).toContain(
      "el.setAttribute('data-pptx-native-anim', '1');"
    )
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain('[data-pptx-native-anim]')
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain('box-shadow: none !important')
  })

  it('collects command-style anime targets as fade-up traces', () => {
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain('[data-anime]')
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain('[data-animate]')
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("collectTrace(el, 'fade-up', 'load', 'bottom', 560, index * 45")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("el.setAttribute('data-pptx-native-anim', '1');")
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
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("const supportedTriggers = new Set(['load', 'click', 'with', 'after'])")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("const supportedSequences = new Set(['with', 'after'])")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("const sequence = normalizeSequence(el.getAttribute('data-anim-sequence'));")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("const clickGroupRaw = normalizeClickGroup(el.getAttribute('data-anim-click-group'));")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("const staggerRaw = (el.getAttribute('data-anim-stagger') || '').trim();")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("const parseLinearPathDelta = (value) => {")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain('from,')
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("collectTrace(el, type, effectiveTrigger, from")
  })

  it('collects constrained path traces and skips non-linear/selector path values', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="path" data-anim-path="M 0 0 L 120 30" id="path-ok">Path</div>
        <div data-anim="path" data-anim-path="#curve" id="path-bad">Bad</div>
      </div>
    `

    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#path-ok', 100, 100)
    assignRect('#path-bad', 100, 180)

    const traces = collectTraces()

    expect(traces).toHaveLength(1)
    expect(traces[0]).toMatchObject({
      type: 'path',
      path: 'M 0 0 L 120 30'
    })
  })

  it('computes load sequencing from data-anim-sequence during trace collection', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="fade-up" data-anim-duration="400" id="lead">Lead</div>
        <div data-anim="fade-up" data-anim-sequence="with" data-anim-delay="50" data-anim-duration="300" id="with">With</div>
        <div data-anim="fade-up" data-anim-sequence="after" data-anim-delay="20" data-anim-duration="200" id="after">After</div>
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
        <div data-anim="fade-up" data-anim-stagger="80" id="load-a">Load A</div>
        <div data-anim="fade-up" data-anim-stagger="80" id="load-b">Load B</div>
        <div data-anim="fade-up" data-anim-trigger="click" data-anim-stagger="90" id="click-a">Click A</div>
        <div data-anim="fade-up" data-anim-trigger="click" data-anim-stagger="90" data-anim-sequence="after" id="click-b">Click B</div>
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
        <div data-anim="fade-up" data-anim-trigger="click" data-anim-click-group="reveal" id="click-a">Click A</div>
        <div data-anim="pulse-soft" data-anim-trigger="click" data-anim-click-group="reveal" id="click-b">Click B</div>
        <div data-anim="pulse-strong" data-anim-trigger="click" id="click-c">Click C</div>
        <div data-anim="fade" data-anim-click-group="ignored" id="load-a">Load A</div>
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
        <div data-anim="slide-down" id="down">Down</div>
        <div data-anim="slide-right" id="right">Right</div>
        <div data-anim="exit-wipe" id="exit">Exit</div>
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
