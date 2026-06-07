/**
 * @vitest-environment node
 *
 * Roundtrip: export PPTX timing XML → re-import → verify fidelity.
 * Covers all 17 DataAnimType values for the export+import pipeline.
 */
import { describe, it, expect } from 'vitest'
import {
  buildSlideTimingXml,
  type PptxTargetAnimation
} from '../../../src/main/utils/html-pptx/animation-writer'
import { parsePptxSlideAnimationPlan } from '../../../src/main/utils/pptx-animation-import'
import { PPTX_ANIMATION_PRESETS, type PptxAnimationPreset } from '../../../src/main/animation/pptx-animation-map'
import type { DataAnimType } from '../../../src/main/animation/data-anim-schema'

// Wrap timing XML in a valid slide envelope for the import parser
function wrapSlideTimingXml(xml: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"
       xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="TestShape"/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="4572000" cy="2743200"/></a:xfrm></p:spPr>
    </p:sp>
  </p:spTree></p:cSld>
  ${xml}
</p:sld>`
}

function makeAnim(
  type: DataAnimType,
  overrides: Partial<PptxTargetAnimation> = {}
): PptxTargetAnimation {
  return {
    spid: 2,
    type,
    trigger: 'load',
    duration: 500,
    delay: 0,
    order: 0,
    ...overrides
  }
}

// ─── Tests ─────────────────────────────────────────────────────

describe('PPTX animation preset coverage', () => {
  it('has valid PPTX presets for all supported AnimationTypes', () => {
    const types = Object.keys(PPTX_ANIMATION_PRESETS) as DataAnimType[]

    for (const type of types) {
      const preset: PptxAnimationPreset | undefined = PPTX_ANIMATION_PRESETS[type]
      expect(preset, `${type}: preset not found`).toBeDefined()
      expect(preset!.presetId, `${type}: presetId must be > 0`).toBeGreaterThan(0)
      expect(['entr', 'emph', 'exit']).toContain(preset!.presetClass)
    }
  })

  it('all entrance presets use presetClass entr', () => {
    const entranceTypes: DataAnimType[] = [
      'fade', 'fade-up', 'fade-down', 'fade-left', 'fade-right',
      'scale-in', 'slide-up', 'slide-left', 'fly-in',
      'wipe', 'zoom-in', 'spin-in', 'path'
    ]

    for (const type of entranceTypes) {
      expect(PPTX_ANIMATION_PRESETS[type]!.presetClass).toBe('entr')
    }
  })

  it('emphasis presets use presetClass emph', () => {
    expect(PPTX_ANIMATION_PRESETS['grow-shrink']!.presetClass).toBe('emph')
    expect(PPTX_ANIMATION_PRESETS['pulse']!.presetClass).toBe('emph')
  })

  it('exit presets use presetClass exit', () => {
    expect(PPTX_ANIMATION_PRESETS['exit-fade']!.presetClass).toBe('exit')
    expect(PPTX_ANIMATION_PRESETS['exit-fly']!.presetClass).toBe('exit')
  })
})

describe('PPTX animation roundtrip (export → import)', () => {
  const slideEmuSize = { cx: 9144000, cy: 5143500 }
  const slideSize = { width: 1600, height: 900 }

  function roundtrip(type: DataAnimType, overrides: Partial<PptxTargetAnimation> = {}) {
    const xml = buildSlideTimingXml([makeAnim(type, overrides)])
    const wrapped = wrapSlideTimingXml(xml)
    return parsePptxSlideAnimationPlan(wrapped, slideEmuSize, slideSize)
  }

  it('roundtrips fade entrance', () => {
    const plan = roundtrip('fade', { duration: 400, delay: 100 })
    expect(plan.animations).toHaveLength(1)
    expect(plan.animations[0].type).toBe('fade')
    expect(plan.animations[0].duration).toBe(400)
    expect(plan.animations[0].delay).toBe(100)
  })

  it('roundtrips fade-up with direction', () => {
    const plan = roundtrip('fade-up')
    expect(plan.animations[0].type).toBe('fade-up')
    // fade-up has presetSubtype=8 which resolves to from='bottom'
    expect(plan.animations[0].from).toBe('bottom')
  })

  it('roundtrips fade-left with direction', () => {
    const plan = roundtrip('fade-left')
    expect(plan.animations[0].type).toBe('fade-left')
    expect(plan.animations[0].from).toBe('right')
  })

  it('roundtrips slide-up (maps to same presetId=2 as fade-up)', () => {
    const plan = roundtrip('slide-up')
    // slide-up uses presetId=2, subtype=8 — same as fade-up.
    // Roundtrip resolves back to fade-up since subtypes are identical.
    expect(plan.animations[0].type).toBe('fade-up')
    expect(plan.animations[0].from).toBe('bottom')
  })

  it('roundtrips slide-left (maps to same presetId=2 as fade-left)', () => {
    const plan = roundtrip('slide-left')
    expect(plan.animations[0].from).toBe('right')
  })

  it('roundtrips scale-in (presetId=31)', () => {
    const plan = roundtrip('scale-in', { duration: 600 })
    expect(plan.animations[0].type).toBe('scale-in')
    expect(plan.animations[0].duration).toBe(600)
  })

  it('roundtrips zoom-in (scale variant)', () => {
    const plan = roundtrip('zoom-in')
    // zoom-in and scale-in both map to presetId=31; roundtrip can only
    // resolve back to 'scale-in' since PPTX has no zoom-in subtype.
    // Documented fidelity limitation: §5 Known Limitations in architecture doc.
    expect(plan.animations[0].type).toBe('scale-in')
  })

  it('roundtrips spin-in (scale variant with rotation lost in PPTX)', () => {
    const plan = roundtrip('spin-in')
    // spin-in maps to presetId=31 scale-in in PPTX — rotation is not preserved
    // in the roundtrip, but the type should still map back meaningfully
    expect(plan.animations[0].type).toBe('scale-in')
  })

  it('roundtrips grow-shrink emphasis', () => {
    const plan = roundtrip('grow-shrink')
    // Both grow-shrink and pulse map to presetId=6 emph.
    // pptx-animation-map.ts:mapPptxPresetToDataAnimType resolves emph+scale → 'pulse'.
    // Documented: grow-shrink and pulse are semantically collapsed in PPTX.
    expect(plan.animations[0].type).toBe('pulse')
  })

  it('roundtrips pulse emphasis', () => {
    const plan = roundtrip('pulse')
    // Both grow-shrink and pulse map to presetId=6 emph in PPTX.
    // Roundtrip type determination uses hasScale=true for emphasis → 'pulse'
    expect(plan.animations[0].type).toBe('pulse')
  })

  it('roundtrips exit-fade', () => {
    const plan = roundtrip('exit-fade')
    expect(plan.animations[0].type).toBe('exit-fade')
  })

  it('roundtrips exit-fly with direction', () => {
    const plan = roundtrip('exit-fly', { from: 'bottom' })
    expect(plan.animations[0].type).toBe('exit-fly')
    // exit-fly uses fromTrace motion with no presetSubtype.
    // The import parser resolves from=undefined since the motion direction
    // is encoded in ppt_x/ppt_y numeric properties, not in a subtype.
    // Documented: exit-fly direction roundtrips as visual motion, not attribute.
    expect(plan.animations[0].from).toBeUndefined()
  })

  it('roundtrips fly-in as fade-up (no directional subtype resolution)', () => {
    // fly-in uses fromTrace motion. presetId=2 with no subtype → import parser
    // defaults subtype handling, resolving to 'fade-up'. The motion direction
    // (fromTrace) is encoded in ppt_x/ppt_y motion elements, not in presetSubtype.
    // The import parser only resolves types from presetId+subtype, not from
    // numeric motion analysis. Documented limitation.
    const plan = roundtrip('fly-in', { from: 'left' })
    expect(plan.animations[0].type).toBe('fade-up')
  })

  it('preserves trigger type', () => {
    const loadPlan = roundtrip('fade', { trigger: 'load' })
    expect(loadPlan.animations[0].trigger).toBe('load')

    const clickPlan = roundtrip('fade', { trigger: 'click' })
    expect(clickPlan.animations[0].trigger).toBe('click')
  })

  it('preserves delay and duration values within tolerance', () => {
    const plan = roundtrip('fade-up', { delay: 320, duration: 750 })
    const anim = plan.animations[0]
    expect(anim.delay).toBe(320)
    expect(anim.duration).toBe(750)
  })

  it('generates structurally valid timing XML for every type', () => {
    const types = Object.keys(PPTX_ANIMATION_PRESETS) as DataAnimType[]

    for (const type of types) {
      const xml = buildSlideTimingXml([makeAnim(type)])
      expect(xml, `${type}: timing XML must not be empty`).toBeTruthy()
      expect(xml, `${type}: must contain <p:timing>`).toContain('<p:timing>')
      expect(xml, `${type}: must contain tmRoot`).toContain('nodeType="tmRoot"')
      expect(xml, `${type}: must contain mainSeq`).toContain('nodeType="mainSeq"')

      const preset = PPTX_ANIMATION_PRESETS[type]
      if (preset) {
        expect(xml, `${type}: must contain correct presetID="${preset.presetId}"`)
          .toContain(`presetID="${preset.presetId}"`)
        expect(xml, `${type}: must contain correct presetClass="${preset.presetClass}"`)
          .toContain(`presetClass="${preset.presetClass}"`)
      }
    }
  })

  it('empty animations array returns empty XML', () => {
    expect(buildSlideTimingXml([])).toBe('')
  })

  it('skips animations with invalid spid', () => {
    const xml = buildSlideTimingXml([makeAnim('fade', { spid: NaN })])
    expect(xml).toBe('')
  })
})
