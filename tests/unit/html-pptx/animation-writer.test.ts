import { describe, expect, it } from 'vitest'
import {
  buildSlideTimingXml,
  buildSlideTransitionXml,
  type PptxTargetAnimation
} from '../../../src/main/utils/html-pptx/animation-writer'

const makeAnim = (overrides: Partial<PptxTargetAnimation> = {}): PptxTargetAnimation => ({
  spid: 2,
  type: 'fade-up',
  trigger: 'load',
  duration: 500,
  delay: 0,
  order: 0,
  ...overrides
})

describe('buildSlideTimingXml', () => {
  it('returns empty XML when there are no animations', () => {
    expect(buildSlideTimingXml([])).toBe('')
  })

  it('builds a PowerPoint main sequence with build list and visibility setup', () => {
    const xml = buildSlideTimingXml([makeAnim({ spid: 7, type: 'fade', duration: 400 })])

    expect(xml).toContain('<p:timing>')
    expect(xml).toContain('<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">')
    expect(xml).toContain('nodeType="tmRoot"')
    expect(xml).toContain('nodeType="mainSeq"')
    expect(xml).toContain('nodeType="withEffect"')
    expect(xml).toContain('presetID="10"')
    expect(xml).toContain('<p:attrName>style.visibility</p:attrName>')
    expect(xml).toContain('<p:bldP spid="7" grpId="0"/>')
    expect(xml).toContain('dur="400"')
    expect(xml).toContain('filter="fade"')
  })

  it('maps directional runtime effects to native motion paths', () => {
    const xml = buildSlideTimingXml([makeAnim({ spid: 3, type: 'fade-left', delay: 200 })])

    expect(xml).toContain('presetID="2"')
    expect(xml).toContain('presetSubtype="3"')
    expect(xml).toContain('delay="200"')
    expect(xml).toContain('<p:attrName>ppt_x</p:attrName>')
    expect(xml).toContain('<p:strVal val="#ppt_x+#ppt_w/2"/>')
  })

  it('emits scale animation for scale-in', () => {
    const xml = buildSlideTimingXml([makeAnim({ type: 'scale-in' })])

    expect(xml).toContain('presetID="31"')
    expect(xml).toContain('<p:animScale>')
    expect(xml).toContain('<p:from x="85000" y="85000"/>')
    expect(xml).toContain('<p:to x="100000" y="100000"/>')
  })

  it('preserves click-triggered animations as click effects', () => {
    const xml = buildSlideTimingXml([makeAnim({ trigger: 'click' })])

    expect(xml).toContain('nodeType="clickEffect"')
    expect(xml).toContain('<p:cond delay="indefinite"/>')
  })

  it('emits wipe effects with an Office-recognized wipe filter', () => {
    const xml = buildSlideTimingXml([makeAnim({ type: 'wipe', from: 'right' })])

    expect(xml).toContain('presetID="5"')
    expect(xml).toContain('presetSubtype="2"')
    expect(xml).toContain('filter="wipe(left)"')
  })

  it('deduplicates build-list entries for repeated target shapes', () => {
    const xml = buildSlideTimingXml([
      makeAnim({ spid: 9, order: 0 }),
      makeAnim({ spid: 9, order: 1, type: 'fade' })
    ])

    expect(xml.match(/<p:bldP spid="9" grpId="0"\/>/g)).toHaveLength(1)
  })
})

describe('buildSlideTransitionXml', () => {
  it('maps app transition names to native transition XML', () => {
    expect(buildSlideTransitionXml('slide-left', 500)).toContain('<p:push/>')
    expect(buildSlideTransitionXml('zoom', 500)).toContain('<p:dissolve/>')
    expect(buildSlideTransitionXml('none', 500)).toBe('')
  })
})
