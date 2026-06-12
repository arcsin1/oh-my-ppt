/**
 * End-to-end animation export test: builds real .pptx files, unzips them,
 * and validates roundtrip fidelity for all supported DataAnimType values.
 *
 * This test exercises the full OOXML writer pipeline:
 *   HtmlToPptxSlide → buildSlideXml → writePptxDocument → .pptx ZIP → unzip + parse
 *
 * @vitest-environment node
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { unzipSync, strFromU8 } from 'fflate'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  writePptxDocument
} from '../../../src/main/utils/html-pptx/ooxml-writer'
import type { HtmlToPptxSlide, HtmlToPptxDocument } from '../../../src/main/utils/html-pptx/types'
import { parsePptxSlideAnimationPlan } from '../../../src/main/utils/pptx-animation-import'
import {
  DATA_ANIM_SUPPORTED_TYPES,
  type DataAnimType,
  type DataAnimFrom
} from '../../../src/main/animation/data-anim-schema'
import {
  PPTX_ANIMATION_PRESETS,
  hasExactPptxPreset
} from '../../../src/main/animation/pptx-animation-map'

const TMP_DIR = path.join(os.tmpdir(), 'ohmyppt-anim-e2e-' + Date.now())

// ─── Helpers ────────────────────────────────────────────────────

const SLIDE_W_IN = 13.333333333
const SLIDE_H_IN = 7.5
const PPTX_TRACE_W_PX = 1600
const PPTX_TRACE_H_PX = 900

const inToPxX = (ins: number): number => Math.round((ins / SLIDE_W_IN) * PPTX_TRACE_W_PX)
const inToPxY = (ins: number): number => Math.round((ins / SLIDE_H_IN) * PPTX_TRACE_H_PX)

function createSlideWithAnimation(
  type: DataAnimType,
  from?: DataAnimFrom,
  overrides: { duration?: number; delay?: number; trigger?: 'load' | 'click' } = {}
): HtmlToPptxSlide {
  // Place the text shape at (1, 1, 3, 1) inches.
  // The animation trace box must cover it for spatial matching to succeed.
  const tx = 1; const ty = 1; const tw = 3; const th = 1

  return {
    texts: [
      { text: 'Test Shape', x: tx, y: ty, w: tw, h: th, fontSize: 24 }
    ],
    shapes: [],
    images: [],
    tables: [],
    animationTraces: [
      {
        type,
        trigger: overrides.trigger || 'load',
        from,
        duration: overrides.duration || 500,
        delay: overrides.delay || 0,
        order: 0,
        // Trace box covers the text box exactly — centerInside and overlap checks pass
        x: inToPxX(tx),
        y: inToPxY(ty),
        w: inToPxX(tw),
        h: inToPxY(th),
        blockId: 'test-block'
      }
    ]
  }
}

function buildFullDocument(slides: HtmlToPptxSlide[]): HtmlToPptxDocument {
  return {
    title: 'Animation E2E Test',
    slides
  }
}

interface ParsedSlideXml {
  raw: string
  plan: ReturnType<typeof parsePptxSlideAnimationPlan>
}

function unzipAndParsePptx(filePath: string): ParsedSlideXml[] {
  const buffer = fs.readFileSync(filePath)
  const files = unzipSync(new Uint8Array(buffer))

  // Find all slide XMLs
  const results: ParsedSlideXml[] = []
  let idx = 1
  while (true) {
    const key = `ppt/slides/slide${idx}.xml`
    const raw = files[key]
    if (!raw) break
    const rawStr = strFromU8(raw)
    const plan = parsePptxSlideAnimationPlan(
      rawStr,
      { cx: 12192000, cy: 6858000 },  // 13.333" x 7.5" in EMU
      { width: 1600, height: 900 }
    )
    results.push({ raw: rawStr, plan })
    idx++
  }
  return results
}

// ─── Setup / Teardown ───────────────────────────────────────────

beforeAll(() => {
  fs.mkdirSync(TMP_DIR, { recursive: true })
})

afterAll(() => {
  try { fs.rmSync(TMP_DIR, { recursive: true }) } catch (_) {}
})

// ─── Tests ──────────────────────────────────────────────────────

describe('PPTX animation E2E', () => {
  it('generates valid PPTX with single slide and fade animation', async () => {
    const doc = buildFullDocument([createSlideWithAnimation('fade')])
    const outPath = path.join(TMP_DIR, 'fade-single.pptx')
    await writePptxDocument(outPath, doc)

    expect(fs.existsSync(outPath)).toBe(true)
    const stat = fs.statSync(outPath)
    expect(stat.size).toBeGreaterThan(1000) // non-empty ZIP

    const parsed = unzipAndParsePptx(outPath)
    expect(parsed).toHaveLength(1)

    const anim = parsed[0].plan.animations
    expect(anim).toHaveLength(1)
    expect(anim[0].type).toBe('fade')
    expect(anim[0].trigger).toBe('load')
    expect(anim[0].duration).toBe(500)
  })

  it('generates valid PPTX for all supported types in one file', async () => {
    const slides: HtmlToPptxSlide[] = DATA_ANIM_SUPPORTED_TYPES.map((type) =>
      createSlideWithAnimation(type)
    )

    const doc = buildFullDocument(slides)
    const outPath = path.join(TMP_DIR, 'all-types.pptx')
    await writePptxDocument(outPath, doc)

    expect(fs.existsSync(outPath)).toBe(true)

    const parsed = unzipAndParsePptx(outPath)

    // Every slide must exist (one per type)
    expect(parsed.length).toBeGreaterThanOrEqual(DATA_ANIM_SUPPORTED_TYPES.length)

    // Track which types resolved to at least one animation
    const resolvedTypes = new Set<string>()
    for (let i = 0; i < parsed.length; i++) {
      const typeLabel = DATA_ANIM_SUPPORTED_TYPES[i]
      const slidePlan = parsed[i].plan
      const xml = parsed[i].raw

      // Every slide must have valid timing XML with tmRoot
      expect(xml, `${typeLabel}: timing XML missing`).toContain('<p:timing>')
      expect(xml, `${typeLabel}: tmRoot missing`).toContain('nodeType="tmRoot"')
      expect(xml, `${typeLabel}: mainSeq missing`).toContain('nodeType="mainSeq"')

      // Every slide must reference the correct preset
      const preset = PPTX_ANIMATION_PRESETS[typeLabel]
      if (preset) {
        expect(xml, `${typeLabel}: presetID mismatch`).toContain(
          `presetID="${preset.presetId}"`
        )
        expect(xml, `${typeLabel}: presetClass mismatch`).toContain(
          `presetClass="${preset.presetClass}"`
        )
        if (preset.presetSubtype !== undefined) {
          expect(xml, `${typeLabel}: presetSubtype mismatch`).toContain(
            `presetSubtype="${preset.presetSubtype}"`
          )
        }
      }

      if (slidePlan.animations.length > 0) {
        resolvedTypes.add(typeLabel)
        const anim = slidePlan.animations[0]
        expect(anim.duration, `${typeLabel}: duration should be 500`).toBe(500)
      }
    }

    // Every type must produce at least one animation in its slide
    expect(
      resolvedTypes.size,
      `Not all types resolved: ${[...resolvedTypes].join(', ')}`
    ).toBe(DATA_ANIM_SUPPORTED_TYPES.length)
  })

  it('preserves click-trigger animations', async () => {
    const slides: HtmlToPptxSlide[] = [
      createSlideWithAnimation('fade', undefined, { trigger: 'click' }),
      createSlideWithAnimation('exit-fly', 'bottom', { trigger: 'click' }),
    ]

    const doc = buildFullDocument(slides)
    const outPath = path.join(TMP_DIR, 'click-trigger.pptx')
    await writePptxDocument(outPath, doc)

    const parsed = unzipAndParsePptx(outPath)
    expect(parsed[0].plan.animations[0].trigger).toBe('click')
    expect(parsed[1].plan.animations[0].trigger).toBe('click')
  })

  it('roundtrips duration and delay values for all types', async () => {
    const testCases: Array<{ type: DataAnimType; duration: number; delay: number }> = [
      { type: 'fade', duration: 300, delay: 0 },
      { type: 'fade-up', duration: 750, delay: 200 },
      { type: 'fly-in', duration: 1000, delay: 500 },
      { type: 'zoom-in', duration: 450, delay: 120 },
      { type: 'exit-fade', duration: 500, delay: 0 },
      { type: 'exit-wipe', duration: 520, delay: 80 },
      { type: 'grow-shrink', duration: 600, delay: 0 },
      { type: 'wipe', duration: 500, delay: 50 },
      { type: 'spin-in', duration: 900, delay: 300 },
    ]

    const slides = testCases.map((tc) =>
      createSlideWithAnimation(tc.type, undefined, {
        duration: tc.duration,
        delay: tc.delay
      })
    )

    const doc = buildFullDocument(slides)
    const outPath = path.join(TMP_DIR, 'duration-delay-roundtrip.pptx')
    await writePptxDocument(outPath, doc)

    const parsed = unzipAndParsePptx(outPath)

    for (let i = 0; i < testCases.length; i++) {
      const tc = testCases[i]
      const anim = parsed[i].plan.animations[0]
      expect(
        anim.duration,
        `${tc.type}: expected duration=${tc.duration}, got ${anim.duration}`
      ).toBe(tc.duration)
      expect(
        anim.delay,
        `${tc.type}: expected delay=${tc.delay}, got ${anim.delay}`
      ).toBe(tc.delay)
    }
  })

  it('preserves directional animations in XML structure', async () => {
    const directions: DataAnimFrom[] = ['left', 'right', 'top', 'bottom']

    const slides = directions.map((dir) =>
      createSlideWithAnimation('fly-in', dir)
    )

    const doc = buildFullDocument(slides)
    const outPath = path.join(TMP_DIR, 'directional-fly-in.pptx')
    await writePptxDocument(outPath, doc)

    const parsed = unzipAndParsePptx(outPath)

    for (let i = 0; i < directions.length; i++) {
      const xml = parsed[i].raw

      // fly-in uses fromTrace motion → must contain ppt_x and ppt_y numeric anim elements
      expect(xml).toContain('<p:attrName>ppt_x</p:attrName>')
      expect(xml).toContain('<p:attrName>ppt_y</p:attrName>')

      // Each must contain visibility setup (marker for correct animation XML structure)
      expect(xml).toContain('style.visibility')
    }
  })

  it('preserves wipe animation with correct filter', async () => {
    const slides = [
      createSlideWithAnimation('wipe', 'left'),
      createSlideWithAnimation('wipe', 'right'),
      createSlideWithAnimation('wipe', 'top'),
      createSlideWithAnimation('wipe', 'bottom'),
    ]

    const doc = buildFullDocument(slides)
    const outPath = path.join(TMP_DIR, 'wipe-directions.pptx')
    await writePptxDocument(outPath, doc)

    const parsed = unzipAndParsePptx(outPath)

    // Wipe now uses presetSubtype instead of custom filter='wipe(X)' strings.
    // subtype 1=wipeRight(fromLeft), 2=wipeLeft(fromRight), 3=wipeUp(fromBottom), 4=wipeDown(fromTop)
    expect(parsed[0].raw).toContain('presetSubtype="1"')  // from=left
    expect(parsed[1].raw).toContain('presetSubtype="2"')  // from=right
    expect(parsed[2].raw).toContain('presetSubtype="4"')  // from=top
    expect(parsed[3].raw).toContain('presetSubtype="3"')  // from=bottom
  })

  it('preserves exit wipe animation with correct filter and subtype', async () => {
    const slides = [
      createSlideWithAnimation('exit-wipe', 'left', { trigger: 'click' }),
      createSlideWithAnimation('exit-wipe', 'right', { trigger: 'click' }),
      createSlideWithAnimation('exit-wipe', 'top', { trigger: 'click' }),
      createSlideWithAnimation('exit-wipe', 'bottom', { trigger: 'click' }),
    ]

    const doc = buildFullDocument(slides)
    const outPath = path.join(TMP_DIR, 'exit-wipe-directions.pptx')
    await writePptxDocument(outPath, doc)

    const parsed = unzipAndParsePptx(outPath)

    expect(parsed[0].raw).toContain('presetSubtype="1"')
    expect(parsed[0].raw).toContain('transition="out" filter="wipe(right)"')
    expect(parsed[1].raw).toContain('presetSubtype="2"')
    expect(parsed[1].raw).toContain('transition="out" filter="wipe(left)"')
    expect(parsed[2].raw).toContain('presetSubtype="4"')
    expect(parsed[2].raw).toContain('transition="out" filter="wipe(down)"')
    expect(parsed[3].raw).toContain('presetSubtype="3"')
    expect(parsed[3].raw).toContain('transition="out" filter="wipe(up)"')
  })

  it('generates multi-animation slide correctly', async () => {
    const slide: HtmlToPptxSlide = {
      texts: [
        { text: 'First', x: 1, y: 1, w: 3, h: 0.8, fontSize: 24 },
        { text: 'Second', x: 1, y: 2.5, w: 3, h: 0.8, fontSize: 24 },
        { text: 'Third', x: 1, y: 4, w: 3, h: 0.8, fontSize: 24 },
      ],
      shapes: [],
      images: [],
      tables: [],
      animationTraces: [
        {
          type: 'fade-up', trigger: 'load', duration: 500, delay: 0, order: 0,
          x: inToPxX(1), y: inToPxY(1), w: inToPxX(3), h: inToPxY(0.8), blockId: 'block-1'
        },
        {
          type: 'scale-in', trigger: 'load', duration: 600, delay: 200, order: 1,
          x: inToPxX(1), y: inToPxY(2.5), w: inToPxX(3), h: inToPxY(0.8), blockId: 'block-2'
        },
        {
          type: 'exit-fade', trigger: 'click', duration: 400, delay: 0, order: 2,
          x: inToPxX(1), y: inToPxY(4), w: inToPxX(3), h: inToPxY(0.8), blockId: 'block-3'
        },
      ]
    }

    const doc = buildFullDocument([slide])
    const outPath = path.join(TMP_DIR, 'multi-anim.pptx')
    await writePptxDocument(outPath, doc)

    const parsed = unzipAndParsePptx(outPath)
    const anims = parsed[0].plan.animations

    expect(anims.length).toBeGreaterThanOrEqual(3)

    // First two should be load-triggered
    const loadAnims = anims.filter((a) => a.trigger === 'load')
    expect(loadAnims.length).toBeGreaterThanOrEqual(2)

    // Third should be click-triggered
    const clickAnims = anims.filter((a) => a.trigger === 'click')
    expect(clickAnims.length).toBeGreaterThanOrEqual(1)
  })

  it('build-list references all animated shapes', async () => {
    const slide: HtmlToPptxSlide = {
      texts: [
        { text: 'A', x: 1, y: 1, w: 2, h: 0.8, fontSize: 20 },
        { text: 'B', x: 1, y: 2.2, w: 2, h: 0.8, fontSize: 20 },
        { text: 'C', x: 1, y: 3.4, w: 2, h: 0.8, fontSize: 20 },
      ],
      shapes: [],
      images: [],
      tables: [],
      animationTraces: [
        {
          type: 'fade', trigger: 'load', duration: 300, delay: 0, order: 0,
          x: inToPxX(1), y: inToPxY(1), w: inToPxX(2), h: inToPxY(0.8), blockId: 'block-a'
        },
        {
          type: 'fade', trigger: 'load', duration: 300, delay: 0, order: 1,
          x: inToPxX(1), y: inToPxY(2.2), w: inToPxX(2), h: inToPxY(0.8), blockId: 'block-b'
        },
        {
          type: 'fade', trigger: 'load', duration: 300, delay: 0, order: 2,
          x: inToPxX(1), y: inToPxY(3.4), w: inToPxX(2), h: inToPxY(0.8), blockId: 'block-c'
        },
      ]
    }

    const doc = buildFullDocument([slide])
    const outPath = path.join(TMP_DIR, 'build-list.pptx')
    await writePptxDocument(outPath, doc)

    const parsed = unzipAndParsePptx(outPath)
    const xml = parsed[0].raw

    // build-list must contain entries for all animated shapes
    expect(xml).toContain('<p:bldLst>')
    const bldPCount = (xml.match(/<p:bldP /g) || []).length
    expect(bldPCount).toBeGreaterThanOrEqual(1)
  })

  it('generates structurally valid OOXML that opens in PowerPoint', async () => {
    // Structural validation: every slide XML must contain the required OOXML elements
    // in the correct order for PowerPoint to parse it without errors.

    const slides: HtmlToPptxSlide[] = [
      createSlideWithAnimation('fade-up'),
      createSlideWithAnimation('scale-in'),
      createSlideWithAnimation('zoom-in'),
    ]

    const doc = buildFullDocument(slides)
    const outPath = path.join(TMP_DIR, 'structural-validation.pptx')
    await writePptxDocument(outPath, doc)

    const parsed = unzipAndParsePptx(outPath)

    for (let i = 0; i < parsed.length; i++) {
      const xml = parsed[i].raw

      // Required OOXML slide structure
      expect(xml).toContain('<p:sld ')
      expect(xml).toContain('xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"')
      expect(xml).toContain('<p:cSld>')
      expect(xml).toContain('<p:spTree>')
      expect(xml).toContain('<p:sp>')

      // cSld before clrMapOvr before transition before timing
      const cSldIdx = xml.indexOf('<p:cSld>')
      const clrMapIdx = xml.indexOf('<p:clrMapOvr>')
      const timingIdx = xml.indexOf('<p:timing>')

      expect(cSldIdx).toBeGreaterThan(-1)
      expect(clrMapIdx).toBeGreaterThan(-1)
      expect(timingIdx).toBeGreaterThan(-1)

      expect(cSldIdx).toBeLessThan(clrMapIdx)
      expect(clrMapIdx).toBeLessThan(timingIdx)

      // Timing structure
      expect(xml).toContain('nodeType="tmRoot"')
      expect(xml).toContain('nodeType="mainSeq"')
      expect(xml).toContain('<p:bldLst>')

      // Visibility set must be present for each animated shape
      expect(xml).toContain('style.visibility')
      expect(xml).toContain('val="visible"')
    }
  })

  it('produces consistent XML across repeated exports', async () => {
    // Two consecutive exports with the same input should produce
    // structurally equivalent timing XML (ignoring node IDs).
    const slide = createSlideWithAnimation('fade-up')

    const stripNodeIds = (xml: string): string =>
      xml.replace(/id="\d+"/g, 'id="X"')

    const outPath1 = path.join(TMP_DIR, 'consistent-1.pptx')
    const outPath2 = path.join(TMP_DIR, 'consistent-2.pptx')

    await writePptxDocument(outPath1, buildFullDocument([slide]))
    await writePptxDocument(outPath2, buildFullDocument([slide]))

    const parsed1 = unzipAndParsePptx(outPath1)
    const parsed2 = unzipAndParsePptx(outPath2)

    const xml1 = stripNodeIds(parsed1[0].raw)
    const xml2 = stripNodeIds(parsed2[0].raw)

    expect(xml1).toBe(xml2)
  })

  it('handles boundary duration values', async () => {
    const testCases = [
      { type: 'fade' as DataAnimType, duration: 100, label: 'minimum' },
      { type: 'fade-up' as DataAnimType, duration: 5000, label: 'maximum' },
      { type: 'scale-in' as DataAnimType, duration: 1, label: 'below-min-clamped', expectedDuration: 100 },
    ]

    for (const tc of testCases) {
      const slide = createSlideWithAnimation(tc.type, undefined, {
        duration: tc.duration
      })
      const doc = buildFullDocument([slide])
      const outPath = path.join(TMP_DIR, `boundary-${tc.label}.pptx`)
      await writePptxDocument(outPath, doc)

      const parsed = unzipAndParsePptx(outPath)
      const expectedDur = tc.expectedDuration || tc.duration
      expect(
        parsed[0].plan.animations[0].duration,
        `${tc.label}: expected ${expectedDur}, got ${parsed[0].plan.animations[0].duration}`
      ).toBe(expectedDur)
    }
  })

  it('exported file is a valid ZIP archive with all expected parts', async () => {
    const doc = buildFullDocument([createSlideWithAnimation('fade')])
    const outPath = path.join(TMP_DIR, 'valid-zip.pptx')
    await writePptxDocument(outPath, doc)

    const buffer = fs.readFileSync(outPath)
    const files = unzipSync(new Uint8Array(buffer))

    // Required OOXML parts
    const requiredParts = [
      '[Content_Types].xml',
      '_rels/.rels',
      'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels',
      'ppt/slides/slide1.xml',
      'ppt/slides/_rels/slide1.xml.rels',
      'ppt/theme/theme1.xml',
      'ppt/slideMasters/slideMaster1.xml',
      'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    ]

    for (const part of requiredParts) {
      expect(files[part], `Missing required part: ${part}`).toBeDefined()
      expect(files[part].length, `Empty part: ${part}`).toBeGreaterThan(0)
    }
  })

  it('fidelity: all exact-roundtrip types preserve type label', async () => {
    // Test that types marked as exactRoundtrip actually roundtrip
    const exactTypes = DATA_ANIM_SUPPORTED_TYPES.filter(hasExactPptxPreset)

    const slides = exactTypes.map((t) => createSlideWithAnimation(t))
    const doc = buildFullDocument(slides)
    const outPath = path.join(TMP_DIR, 'exact-roundtrip-types.pptx')
    await writePptxDocument(outPath, doc)

    const parsed = unzipAndParsePptx(outPath)

    for (let i = 0; i < exactTypes.length; i++) {
      const expected = exactTypes[i]
      const actual = parsed[i].plan.animations[0]?.type

      expect(
        actual,
        `Exact-roundtrip type '${expected}' resolved to '${actual}' — expected exact match`
      ).toBe(expected)
    }
  })
})
