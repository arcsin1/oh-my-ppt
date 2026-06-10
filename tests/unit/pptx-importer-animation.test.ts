import { describe, expect, it } from 'vitest'
import { parsePptxSlideAnimationPlan } from '../../src/main/utils/pptx-animation-import'
import { buildSlideXml } from '../../src/main/utils/html-pptx/ooxml-writer'
import type { HtmlToPptxSlide } from '../../src/main/utils/html-pptx/types'

describe('parsePptxSlideAnimationPlan', () => {
  it('maps native PPT timing targets to importable data-anim entries', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="7" name="标题文本"/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm></p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:timing>
    <p:tnLst>
      <p:par>
        <p:cTn id="1" dur="indefinite" nodeType="tmRoot">
          <p:childTnLst>
            <p:par>
              <p:cTn id="5" presetID="2" presetClass="entr" presetSubtype="8" nodeType="withEffect">
                <p:stCondLst><p:cond delay="250"/></p:stCondLst>
                <p:childTnLst>
                  <p:anim>
                    <p:cBhvr><p:cTn id="6" dur="700"/><p:tgtEl><p:spTgt spid="7"/></p:tgtEl></p:cBhvr>
                  </p:anim>
                </p:childTnLst>
              </p:cTn>
            </p:par>
          </p:childTnLst>
        </p:cTn>
      </p:par>
    </p:tnLst>
  </p:timing>
</p:sld>`

    const plan = parsePptxSlideAnimationPlan(xml, { cx: 9144000, cy: 5143500 }, { width: 960, height: 540 })

    expect(plan.animations).toHaveLength(1)
    expect(plan.animations[0]).toMatchObject({
      type: 'fade-up',
      trigger: 'load',
      duration: 700,
      delay: 250,
      sourceId: '7',
      sourceName: '标题文本'
    })
    expect(plan.byName.get('标题文本')?.[0]).toBe(plan.animations[0])
    expect(plan.animations[0].x).toBeCloseTo(96)
  })

  it('preserves click-triggered scale effects', () => {
    const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Icon"/></p:nvSpPr></p:sp></p:spTree></p:cSld>
  <p:timing><p:tnLst><p:par><p:cTn id="9" presetID="31" presetClass="entr" nodeType="clickEffect">
    <p:childTnLst><p:animScale><p:cBhvr><p:cTn id="10" dur="400"/><p:tgtEl><p:spTgt spid="3"/></p:tgtEl></p:cBhvr></p:animScale></p:childTnLst>
  </p:cTn></p:par></p:tnLst></p:timing>
</p:sld>`

    const plan = parsePptxSlideAnimationPlan(xml, null, { width: 960, height: 540 })

    expect(plan.animations[0]).toMatchObject({
      type: 'scale-in',
      trigger: 'click',
      duration: 400,
      sourceName: 'Icon'
    })
  })

  it('restores distinct entrance and exit scale variants from native scale ranges', () => {
    const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="12" name="Zoom In"/></p:nvSpPr></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="13" name="Spin In"/></p:nvSpPr></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="14" name="Scale Exit"/></p:nvSpPr></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="15" name="Zoom Exit"/></p:nvSpPr></p:sp>
  </p:spTree></p:cSld>
  <p:timing><p:tnLst>
    <p:par><p:cTn id="70" presetID="31" presetClass="entr" nodeType="withEffect">
      <p:childTnLst><p:animScale><p:cBhvr><p:cTn id="71" dur="430"/><p:tgtEl><p:spTgt spid="12"/></p:tgtEl></p:cBhvr><p:from x="75000" y="75000"/><p:to x="100000" y="100000"/></p:animScale></p:childTnLst>
    </p:cTn></p:par>
    <p:par><p:cTn id="72" presetID="31" presetClass="entr" nodeType="withEffect">
      <p:childTnLst><p:animScale><p:cBhvr><p:cTn id="73" dur="430"/><p:tgtEl><p:spTgt spid="13"/></p:tgtEl></p:cBhvr><p:from x="92000" y="92000"/><p:to x="100000" y="100000"/></p:animScale></p:childTnLst>
    </p:cTn></p:par>
    <p:par><p:cTn id="74" presetID="31" presetClass="exit" nodeType="clickEffect">
      <p:childTnLst><p:animScale><p:cBhvr><p:cTn id="75" dur="430"/><p:tgtEl><p:spTgt spid="14"/></p:tgtEl></p:cBhvr><p:from x="100000" y="100000"/><p:to x="85000" y="85000"/></p:animScale></p:childTnLst>
    </p:cTn></p:par>
    <p:par><p:cTn id="76" presetID="31" presetClass="exit" nodeType="clickEffect">
      <p:childTnLst><p:animScale><p:cBhvr><p:cTn id="77" dur="430"/><p:tgtEl><p:spTgt spid="15"/></p:tgtEl></p:cBhvr><p:from x="100000" y="100000"/><p:to x="75000" y="75000"/></p:animScale></p:childTnLst>
    </p:cTn></p:par>
  </p:tnLst></p:timing>
</p:sld>`

    const plan = parsePptxSlideAnimationPlan(xml, null, { width: 960, height: 540 })

    expect(plan.animations[0]).toMatchObject({ type: 'zoom-in', trigger: 'load', duration: 430 })
    expect(plan.animations[1]).toMatchObject({ type: 'spin-in', trigger: 'load', duration: 430 })
    expect(plan.animations[2]).toMatchObject({ type: 'exit-scale', trigger: 'click', duration: 430 })
    expect(plan.animations[3]).toMatchObject({ type: 'exit-zoom', trigger: 'click', duration: 430 })
  })

  it('imports native wipe and exit timing as extended data-anim entries', () => {
    const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="4" name="Panel"/></p:nvSpPr></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="5" name="Outro"/></p:nvSpPr></p:sp>
  </p:spTree></p:cSld>
  <p:timing><p:tnLst>
    <p:par><p:cTn id="20" presetID="5" presetClass="entr" nodeType="withEffect">
      <p:childTnLst><p:animEffect transition="in" filter="wipe(l)">
        <p:cBhvr><p:cTn id="21" dur="600"/><p:tgtEl><p:spTgt spid="4"/></p:tgtEl></p:cBhvr>
      </p:animEffect></p:childTnLst>
    </p:cTn></p:par>
    <p:par><p:cTn id="30" presetID="2" presetClass="exit" presetSubtype="8" nodeType="clickEffect">
      <p:childTnLst><p:anim>
        <p:cBhvr><p:cTn id="31" dur="500"/><p:tgtEl><p:spTgt spid="5"/></p:tgtEl></p:cBhvr>
      </p:anim></p:childTnLst>
    </p:cTn></p:par>
  </p:tnLst></p:timing>
</p:sld>`

    const plan = parsePptxSlideAnimationPlan(xml, null, { width: 960, height: 540 })

    expect(plan.animations[0]).toMatchObject({
      type: 'wipe',
      from: 'right',
      trigger: 'load',
      duration: 600,
      sourceName: 'Panel'
    })
    expect(plan.animations[1]).toMatchObject({
      type: 'exit-fly',
      from: 'bottom',
      trigger: 'click',
      sourceName: 'Outro'
    })
  })

  it('roundtrips exported fly-in and exit-fly motion semantics without collapsing direction', () => {
    const slide: HtmlToPptxSlide = {
      texts: [
        { text: 'Fly In', x: 1, y: 1, w: 3, h: 1, fontSize: 24 },
        { text: 'Fly Out', x: 1, y: 2.2, w: 3, h: 1, fontSize: 24 }
      ],
      shapes: [],
      images: [],
      tables: [],
      animationTraces: [
        {
          type: 'fly-in',
          trigger: 'load',
          from: 'left',
          duration: 500,
          delay: 0,
          order: 0,
          x: 100,
          y: 100,
          w: 300,
          h: 100
        },
        {
          type: 'exit-fly',
          trigger: 'click',
          from: 'bottom',
          duration: 500,
          delay: 0,
          order: 1,
          x: 100,
          y: 220,
          w: 300,
          h: 100
        }
      ]
    }

    const xml = buildSlideXml(slide, new Map(), 1)
    const plan = parsePptxSlideAnimationPlan(xml, { cx: 12192000, cy: 6858000 }, { width: 960, height: 540 })

    expect(plan.animations[0]).toMatchObject({
      type: 'fly-in',
      from: 'left',
      trigger: 'load',
      duration: 500
    })
    expect(plan.animations[1]).toMatchObject({
      type: 'exit-fly',
      from: 'bottom',
      trigger: 'click',
      duration: 500
    })
  })

  it('roundtrips constrained linear path motion through exported PPTX XML', () => {
    const slide: HtmlToPptxSlide = {
      texts: [{ text: 'Path', x: 1, y: 1, w: 3, h: 1, fontSize: 24 }],
      shapes: [],
      images: [],
      tables: [],
      animationTraces: [
        {
          type: 'path',
          trigger: 'load',
          path: 'M 0 0 L 120 30',
          duration: 500,
          delay: 0,
          order: 0,
          x: 100,
          y: 100,
          w: 300,
          h: 100
        }
      ]
    }

    const xml = buildSlideXml(slide, new Map(), 1)
    const plan = parsePptxSlideAnimationPlan(xml, { cx: 12192000, cy: 6858000 }, { width: 960, height: 540 })

    expect(plan.animations[0]).toMatchObject({
      type: 'path',
      trigger: 'load',
      duration: 500,
      path: 'M 0 0 L 120 30'
    })
  })

  it('imports exit wipe timing as exit-wipe with directional from metadata', () => {
    const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="6" name="Dismiss"/></p:nvSpPr></p:sp>
  </p:spTree></p:cSld>
  <p:timing><p:tnLst>
    <p:par><p:cTn id="40" presetID="5" presetClass="exit" nodeType="clickEffect">
      <p:childTnLst><p:animEffect transition="out" filter="wipe(d)">
        <p:cBhvr><p:cTn id="41" dur="450"/><p:tgtEl><p:spTgt spid="6"/></p:tgtEl></p:cBhvr>
      </p:animEffect></p:childTnLst>
    </p:cTn></p:par>
  </p:tnLst></p:timing>
</p:sld>`

    const plan = parsePptxSlideAnimationPlan(xml, null, { width: 960, height: 540 })

    expect(plan.animations[0]).toMatchObject({
      type: 'exit-wipe',
      from: 'top',
      trigger: 'click',
      duration: 450,
      sourceName: 'Dismiss'
    })
  })

  it('preserves contiguous click-group metadata from native grouped click steps', () => {
    const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="7" name="Lead"/></p:nvSpPr></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="8" name="Badge"/></p:nvSpPr></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="9" name="Next"/></p:nvSpPr></p:sp>
  </p:spTree></p:cSld>
  <p:timing><p:tnLst>
    <p:par><p:cTn id="50" presetID="2" presetClass="entr" presetSubtype="8" nodeType="clickEffect" grpId="1">
      <p:childTnLst><p:anim><p:cBhvr><p:cTn id="51" dur="400"/><p:tgtEl><p:spTgt spid="7"/></p:tgtEl></p:cBhvr></p:anim></p:childTnLst>
    </p:cTn></p:par>
    <p:par><p:cTn id="52" presetID="6" presetClass="emph" nodeType="withEffect" grpId="1">
      <p:childTnLst><p:animScale><p:cBhvr><p:cTn id="53" dur="400"/><p:tgtEl><p:spTgt spid="8"/></p:tgtEl></p:cBhvr><p:from x="100000" y="100000"/><p:to x="103000" y="103000"/></p:animScale></p:childTnLst>
    </p:cTn></p:par>
    <p:par><p:cTn id="54" presetID="6" presetClass="emph" nodeType="clickEffect">
      <p:childTnLst><p:animScale><p:cBhvr><p:cTn id="55" dur="400"/><p:tgtEl><p:spTgt spid="9"/></p:tgtEl></p:cBhvr><p:from x="100000" y="100000"/><p:to x="110000" y="110000"/></p:animScale></p:childTnLst>
    </p:cTn></p:par>
  </p:tnLst></p:timing>
</p:sld>`

    const plan = parsePptxSlideAnimationPlan(xml, null, { width: 960, height: 540 })

    expect(plan.animations[0]).toMatchObject({ trigger: 'click', clickGroup: '1', type: 'fade-up' })
    expect(plan.animations[1]).toMatchObject({ trigger: 'click', clickGroup: '1', type: 'pulse-soft' })
    expect(plan.animations[2]).toMatchObject({ trigger: 'click', type: 'pulse-strong' })
    expect(plan.animations[2]).not.toHaveProperty('clickGroup')
  })

  it('restores bounded emphasis variants from native scale ranges', () => {
    const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="10" name="Soft Pulse"/></p:nvSpPr></p:sp>
    <p:sp><p:nvSpPr><p:cNvPr id="11" name="Strong Grow"/></p:nvSpPr></p:sp>
  </p:spTree></p:cSld>
  <p:timing><p:tnLst>
    <p:par><p:cTn id="60" presetID="6" presetClass="emph" nodeType="withEffect">
      <p:childTnLst><p:animScale><p:cBhvr><p:cTn id="61" dur="420"/><p:tgtEl><p:spTgt spid="10"/></p:tgtEl></p:cBhvr><p:from x="100000" y="100000"/><p:to x="103000" y="103000"/></p:animScale></p:childTnLst>
    </p:cTn></p:par>
    <p:par><p:cTn id="62" presetID="6" presetClass="emph" nodeType="withEffect">
      <p:childTnLst><p:animScale><p:cBhvr><p:cTn id="63" dur="420"/><p:tgtEl><p:spTgt spid="11"/></p:tgtEl></p:cBhvr><p:from x="85000" y="85000"/><p:to x="112000" y="112000"/></p:animScale></p:childTnLst>
    </p:cTn></p:par>
  </p:tnLst></p:timing>
</p:sld>`

    const plan = parsePptxSlideAnimationPlan(xml, null, { width: 960, height: 540 })

    expect(plan.animations[0]).toMatchObject({ type: 'pulse-soft', trigger: 'load', duration: 420 })
    expect(plan.animations[1]).toMatchObject({ type: 'grow-shrink-strong', trigger: 'load', duration: 420 })
  })
})
