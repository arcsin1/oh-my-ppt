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
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("'exit-fly'")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("const supportedTriggers = new Set(['load', 'click', 'with', 'after'])")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("const normalizeSequence = (value) =>")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("const staggerAttr = (el.getAttribute('data-anim-stagger') || '').trim()")
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain('from,')
    expect(COLLECT_PPTX_ANIMATION_TRACES_SCRIPT).toContain("collectTrace(el, type, effectiveTrigger, from")
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
})
