/**
 * Generate real .pptx test files for manual verification.
 * Output: tests/output/pptx-test/
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import {
  writePptxDocument,
  buildSlideXml
} from '../../src/main/utils/html-pptx/ooxml-writer'
import type { HtmlToPptxSlide, HtmlToPptxDocument } from '../../src/main/utils/html-pptx/types'
import {
  DATA_ANIM_SUPPORTED_TYPES,
  type DataAnimType,
  type DataAnimFrom
} from '../../src/main/animation/data-anim-schema'

const OUT_DIR = resolve(__dirname, '../output/pptx-test')
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })

const SLIDE_W = 13.333333333
const SLIDE_H = 7.5
const inToPxX = (i: number) => Math.round((i / SLIDE_W) * 1600)
const inToPxY = (i: number) => Math.round((i / SLIDE_H) * 900)

function makeSlide(
  label: string,
  type: DataAnimType,
  from?: DataAnimFrom,
  overrides: Partial<{ duration: number; delay: number; trigger: 'load' | 'click' }> = {}
): HtmlToPptxSlide {
  return {
    texts: [{ text: label, x: 1, y: 1, w: 5, h: 1, fontSize: 36 }],
    shapes: [],
    images: [],
    tables: [],
    animationTraces: [{
      type, from,
      trigger: overrides.trigger || 'load',
      duration: overrides.duration || 500,
      delay: overrides.delay || 0,
      order: 0,
      x: inToPxX(1), y: inToPxY(1), w: inToPxX(5), h: inToPxY(1),
      blockId: `anim-${type}`
    }]
  }
}

async function main() {
  // ── File 1: All 17 editable/exportable types, one per slide ──
  const allSlides = DATA_ANIM_SUPPORTED_TYPES.map((t) =>
    makeSlide(`data-anim="${t}"`, t)
  )
  await writePptxDocument(resolve(OUT_DIR, '01-all-17-types.pptx'), {
    title: 'All 17 Animation Types', slides: allSlides
  })
  console.log('[OK] 01-all-17-types.pptx')

  // ── File 2: Directional fly-in × 5 ──
  const directions: DataAnimFrom[] = ['left','right','top','bottom','center']
  const flySlides = directions.map((d) =>
    makeSlide(`fly-in from="${d}"`, 'fly-in', d)
  )
  await writePptxDocument(resolve(OUT_DIR, '02-fly-in-directions.pptx'), {
    title: 'Fly-in Direction Test', slides: flySlides
  })
  console.log('[OK] 02-fly-in-directions.pptx')

  // ── File 3: Wipe directions × 4 ──
  const wipeDirs: DataAnimFrom[] = ['left','right','top','bottom']
  const wipeSlides = wipeDirs.map((d) =>
    makeSlide(`wipe from="${d}"`, 'wipe', d)
  )
  await writePptxDocument(resolve(OUT_DIR, '03-wipe-directions.pptx'), {
    title: 'Wipe Direction Test', slides: wipeSlides
  })
  console.log('[OK] 03-wipe-directions.pptx')

  // ── File 4: Click triggers ──
  const clickSlides: HtmlToPptxSlide[] = [
    {
      texts: [
        { text: 'Click 1: fade-up', x: 1, y: 1, w: 4, h: 0.7, fontSize: 24 },
        { text: 'Click 2: scale-in', x: 1, y: 2.5, w: 4, h: 0.7, fontSize: 24 },
        { text: 'Click 3: exit-fly', x: 1, y: 4, w: 4, h: 0.7, fontSize: 24 },
      ],
      shapes: [], images: [], tables: [],
      animationTraces: [
        { type: 'fade-up', trigger: 'click', from: 'bottom', duration: 500, delay: 0, order: 0,
          x: inToPxX(1), y: inToPxY(1), w: inToPxX(4), h: inToPxY(0.7), blockId: 'c1' },
        { type: 'scale-in', trigger: 'click', duration: 500, delay: 0, order: 1,
          x: inToPxX(1), y: inToPxY(2.5), w: inToPxX(4), h: inToPxY(0.7), blockId: 'c2' },
        { type: 'exit-fly', trigger: 'click', from: 'bottom', duration: 500, delay: 0, order: 2,
          x: inToPxX(1), y: inToPxY(4), w: inToPxX(4), h: inToPxY(0.7), blockId: 'c3' },
      ]
    }
  ]
  await writePptxDocument(resolve(OUT_DIR, '04-click-triggers.pptx'), {
    title: 'Click Trigger Test', slides: clickSlides
  })
  console.log('[OK] 04-click-triggers.pptx')

  // ── File 5: Duration/delay variants ──
  const durDelaySlides: HtmlToPptxSlide[] = [
    makeSlide('dur=100ms (min)', 'fade', undefined, { duration: 100 }),
    makeSlide('dur=300ms', 'fade-up', undefined, { duration: 300 }),
    makeSlide('dur=1000ms', 'zoom-in', undefined, { duration: 1000 }),
    makeSlide('dur=5000ms (max)', 'fly-in', 'left', { duration: 5000 }),
    makeSlide('delay=0ms', 'fade-left', undefined, { delay: 0 }),
    makeSlide('delay=250ms', 'scale-in', undefined, { delay: 250 }),
    makeSlide('delay=1000ms', 'spin-in', undefined, { delay: 1000, duration: 900 }),
    makeSlide('dur=500ms delay=0ms', 'fade-up', undefined, { duration: 500, delay: 0 }),
  ]
  await writePptxDocument(resolve(OUT_DIR, '05-duration-delay.pptx'), {
    title: 'Duration & Delay Test', slides: durDelaySlides
  })
  console.log('[OK] 05-duration-delay.pptx')

  // ── File 6: Multi-animation on one slide ──
  const multiSlide: HtmlToPptxSlide = {
    texts: [
      { text: 'fade-up (load, delay=0)', x: 1, y: 0.5, w: 5, h: 0.7, fontSize: 22 },
      { text: 'scale-in (load, delay=200)', x: 1, y: 2, w: 5, h: 0.7, fontSize: 22 },
      { text: 'fly-in from=left (load, delay=400)', x: 1, y: 3.5, w: 5, h: 0.7, fontSize: 22 },
      { text: 'exit-fade (click)', x: 1, y: 5, w: 5, h: 0.7, fontSize: 22 },
    ],
    shapes: [], images: [], tables: [],
    animationTraces: [
      { type: 'fade-up', trigger: 'load', duration: 500, delay: 0, order: 0,
        x: inToPxX(1), y: inToPxY(0.5), w: inToPxX(5), h: inToPxY(0.7), blockId: 'ma' },
      { type: 'scale-in', trigger: 'load', duration: 600, delay: 200, order: 1,
        x: inToPxX(1), y: inToPxY(2), w: inToPxX(5), h: inToPxY(0.7), blockId: 'mb' },
      { type: 'fly-in', trigger: 'load', from: 'left', duration: 500, delay: 400, order: 2,
        x: inToPxX(1), y: inToPxY(3.5), w: inToPxX(5), h: inToPxY(0.7), blockId: 'mc' },
      { type: 'exit-fade', trigger: 'click', duration: 400, delay: 0, order: 3,
        x: inToPxX(1), y: inToPxY(5), w: inToPxX(5), h: inToPxY(0.7), blockId: 'md' },
    ]
  }
  await writePptxDocument(resolve(OUT_DIR, '06-multi-animation.pptx'), {
    title: 'Multi-Animation Slide', slides: [multiSlide]
  })
  console.log('[OK] 06-multi-animation.pptx')

  // ── File 7: Emphasis types (grow-shrink, pulse) ──
  const emphSlides = [
    makeSlide('grow-shrink emphasis', 'grow-shrink'),
    makeSlide('pulse emphasis', 'pulse'),
  ]
  await writePptxDocument(resolve(OUT_DIR, '07-emphasis-types.pptx'), {
    title: 'Emphasis Animation Test', slides: emphSlides
  })
  console.log('[OK] 07-emphasis-types.pptx')

  // ── File 8: Exit animations ──
  const exitSlides = [
    makeSlide('exit-fade', 'exit-fade'),
    makeSlide('exit-fly from=bottom', 'exit-fly', 'bottom'),
    makeSlide('exit-fly from=left', 'exit-fly', 'left'),
    makeSlide('exit-fly from=top', 'exit-fly', 'top'),
    makeSlide('exit-fly from=right', 'exit-fly', 'right'),
  ]
  await writePptxDocument(resolve(OUT_DIR, '08-exit-animations.pptx'), {
    title: 'Exit Animation Test', slides: exitSlides
  })
  console.log('[OK] 08-exit-animations.pptx')

  console.log(`\nDone. Files in: ${OUT_DIR}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
