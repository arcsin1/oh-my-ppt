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
    expect(xml).toContain('<p:cTn id="4" fill="hold">')
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

  it('maps slide-down and slide-right to directional entrance preset subtypes', () => {
    const xml = buildSlideTimingXml([
      makeAnim({ spid: 3, type: 'slide-down' }),
      makeAnim({ spid: 4, type: 'slide-right', order: 1 })
    ])

    expect(xml).toContain('presetSubtype="1"')
    expect(xml).toContain('presetSubtype="2"')
    expect(xml).toContain('<p:strVal val="#ppt_y-#ppt_h/2"/>')
    expect(xml).toContain('<p:strVal val="#ppt_x-#ppt_w/2"/>')
  })

  it('emits exit-wipe as an exit wipe effect instead of generic fade-out', () => {
    const xml = buildSlideTimingXml([
      makeAnim({ type: 'exit-wipe', trigger: 'click', from: 'top' })
    ])

    expect(xml).toContain('presetID="5"')
    expect(xml).toContain('presetClass="exit"')
    expect(xml).toContain('nodeType="clickEffect"')
    expect(xml).toContain('transition="out"')
    expect(xml).toContain('filter="wipe(d)"')
  })

  it('emits scale animation for scale-in', () => {
    const xml = buildSlideTimingXml([makeAnim({ type: 'scale-in' })])

    expect(xml).toContain('presetID="31"')
    expect(xml).toContain('<p:animScale>')
    expect(xml).toContain('<p:from x="85000" y="85000"/>')
    expect(xml).toContain('<p:to x="100000" y="100000"/>')
  })

  it('emits distinct native exit scale ranges for exit-scale and exit-zoom', () => {
    const xml = buildSlideTimingXml([
      makeAnim({ spid: 3, type: 'exit-scale', trigger: 'click' }),
      makeAnim({ spid: 4, type: 'exit-zoom', trigger: 'click', order: 1 })
    ])

    expect(xml).toContain('presetID="31"')
    expect(xml).toContain('presetClass="exit"')
    expect(xml).toContain('transition="out"')
    expect(xml).toContain('<p:from x="100000" y="100000"/>')
    expect(xml).toContain('<p:to x="85000" y="85000"/>')
    expect(xml).toContain('<p:to x="75000" y="75000"/>')
  })

  it('emits linear motion channels for constrained path animations', () => {
    const xml = buildSlideTimingXml([
      makeAnim({ spid: 3, type: 'path', path: 'M 0 0 L 120 30' })
    ])

    expect(xml).toContain('presetID="10"')
    expect(xml).toContain('<p:attrName>ppt_x</p:attrName>')
    expect(xml).toContain('<p:strVal val="#ppt_x"/>')
    expect(xml).toContain('<p:strVal val="#ppt_x+120"/>')
    expect(xml).toContain('<p:attrName>ppt_y</p:attrName>')
    expect(xml).toContain('<p:strVal val="#ppt_y+30"/>')
  })

  it('preserves click-triggered animations as click effects', () => {
    const xml = buildSlideTimingXml([makeAnim({ trigger: 'click' })])

    expect(xml).toContain('nodeType="clickEffect"')
  })

  it('groups contiguous click-group animations into one PPTX build step', () => {
    const xml = buildSlideTimingXml([
      makeAnim({ spid: 3, trigger: 'click', clickGroup: 'reveal', type: 'fade-up', order: 0 }),
      makeAnim({ spid: 4, trigger: 'click', clickGroup: 'reveal', type: 'pulse-soft', order: 1 }),
      makeAnim({ spid: 5, trigger: 'click', type: 'pulse-strong', order: 2 })
    ])

    expect(xml).toContain('spid="3"')
    expect(xml).toContain('spid="4"')
    expect(xml).toContain('spid="5"')
    expect(xml).toContain('nodeType="clickEffect"')
    expect(xml).toContain('nodeType="withEffect"')
    expect(xml).toContain('grpId="1"')
    expect(xml).toContain('grpId="0"')
  })

  it('emits distinct native scale ranges for bounded emphasis variants', () => {
    const xml = buildSlideTimingXml([
      makeAnim({ spid: 3, type: 'pulse-soft' }),
      makeAnim({ spid: 4, type: 'pulse-strong', order: 1 }),
      makeAnim({ spid: 5, type: 'grow-shrink-soft', order: 2 }),
      makeAnim({ spid: 6, type: 'grow-shrink-strong', order: 3 })
    ])

    expect(xml).toContain('<p:from x="100000" y="100000"/>')
    expect(xml).toContain('<p:to x="103000" y="103000"/>')
    expect(xml).toContain('<p:to x="110000" y="110000"/>')
    expect(xml).toContain('<p:from x="95000" y="95000"/>')
    expect(xml).toContain('<p:to x="104000" y="104000"/>')
    expect(xml).toContain('<p:from x="85000" y="85000"/>')
    expect(xml).toContain('<p:to x="112000" y="112000"/>')
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
