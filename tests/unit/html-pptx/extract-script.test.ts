/** @vitest-environment happy-dom */
import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  buildHtmlToPptxExtractScript,
  normalizeExtractedHtmlToPptxSlide
} from '@arcsin1/html2pptx'

describe('buildHtmlToPptxExtractScript', () => {
  const buildScript = () =>
    buildHtmlToPptxExtractScript({
      pageWidthPx: 1600,
      pageHeightPx: 900
    })

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

  const assignRect = (selector: string, left: number, top: number, width: number, height: number) => {
    const element = document.querySelector(selector)
    if (!element) throw new Error(`Missing test node: ${selector}`)
    Object.defineProperty(element, 'getBoundingClientRect', {
      configurable: true,
      value: () => rect(left, top, width, height)
    })
  }

  const extractInDom = async ({
    maxTextBoxes = 360,
    unsupportedTransformStrategy
  }: {
    maxTextBoxes?: number
    unsupportedTransformStrategy?: 'native' | 'raster-fallback'
  } = {}) =>
    new Function(
      `return ${
        buildHtmlToPptxExtractScript({
          pageWidthPx: 1600,
          pageHeightPx: 900,
          maxTextBoxes,
          unsupportedTransformStrategy
        }).trim()
      }`
    )() as Promise<Record<string, unknown>>

  it('exports Tailwind rings with a visual hint map and computed spread fallback', () => {
    const script = buildScript()

    expect(script).toContain("['ring-1', 1]")
    expect(script).toContain("['ring-2', 2]")
    expect(script).toContain("['ring-4', 4]")
    expect(script).toContain('const parseTailwindRingWidth = (utility) => {')
    expect(script).toContain('const arbitrary = utility.match(/^ring-')
    expect(script).toContain('Number.parseFloat(arbitrary[1])')
    expect(script).toContain('const [offsetX, offsetY, blur, spread] = lengths;')
    expect(script).toContain('best = { w: spread, c: color, colorSource };')
  })

  it('supports common Tailwind color scales for visual hints', () => {
    const script = buildScript()

    expect(script).toContain('const resolveTailwindColorToken = (name) => {')
    expect(script).toContain("red: ['#FEF2F2'")
    expect(script).toContain("'#EF4444'")
    expect(script).toContain('const palette = tailwindColorPaletteMap.get(match[1]);')
  })

  it('generates parseable browser extraction JavaScript', () => {
    expect(() => new Function(buildScript())).not.toThrow()
  })

  it('keeps an unexported text block in the raster fallback when the text limit is reached', async () => {
    document.body.innerHTML = `
      <div class="ppt-page-root" style="display:block">
        <p id="first" style="display:block;font-size:20px">First text</p>
        <p id="second" style="display:block;font-size:20px">Second text</p>
      </div>
    `
    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#first', 100, 100, 320, 36)
    assignRect('#second', 100, 160, 320, 36)

    const extracted = await extractInDom({ maxTextBoxes: 1 })

    expect(extracted.texts).toHaveLength(1)
    expect(extracted.extractionReport).toMatchObject({ textLimitReached: true })
    expect(document.querySelector('#first')?.getAttribute('data-pptx-extracted-text')).toBe('1')
    expect(document.querySelector('#second')?.hasAttribute('data-pptx-extracted-text')).toBe(false)
  })

  it('marks extracted inline KPI text so it is removed from the raster background', async () => {
    document.body.innerHTML = `
      <div class="ppt-page-root" style="display:block">
        <div id="metrics" style="display:flex">
          <span id="market" style="font-size:48px">528</span>
          <span id="share" style="font-size:48px">63<span id="percent" style="font-size:30px">%</span></span>
          <span id="cost" style="font-size:48px">$2,950</span>
        </div>
        <p id="fallback" data-pptx-formula-block style="display:block;font-size:20px">Fallback text</p>
      </div>
    `
    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#metrics', 100, 180, 640, 80)
    assignRect('#market', 100, 180, 120, 60)
    assignRect('#share', 240, 180, 120, 60)
    assignRect('#percent', 320, 205, 32, 36)
    assignRect('#cost', 400, 180, 180, 60)
    assignRect('#fallback', 100, 300, 220, 36)

    const originalCreateRange = document.createRange.bind(document)
    let selectedNode: Node | null = null
    const rangeRect = () => {
      const id = selectedNode?.parentElement?.id
      if (id === 'market') return rect(100, 180, 120, 60)
      if (id === 'share') return rect(240, 180, 80, 60)
      if (id === 'percent') return rect(320, 205, 32, 36)
      if (id === 'cost') return rect(400, 180, 180, 60)
      return rect(100, 300, 220, 36)
    }
    document.createRange = (() => ({
      selectNode: (node: Node) => {
        selectedNode = node
      },
      selectNodeContents: (node: Node) => {
        selectedNode = node
      },
      setStart: () => {},
      setEnd: () => {},
      getBoundingClientRect: () => rangeRect(),
      getClientRects: () => [rangeRect()],
      detach: () => {}
    })) as typeof document.createRange

    try {
      await extractInDom({ unsupportedTransformStrategy: 'raster-fallback' })

      expect(document.querySelector('#market')?.getAttribute('data-pptx-extracted-text')).toBe('1')
      expect(document.querySelector('#share')?.getAttribute('data-pptx-extracted-text')).toBe('1')
      expect(document.querySelector('#percent')?.getAttribute('data-pptx-extracted-text')).toBe('1')
      expect(document.querySelector('#cost')?.getAttribute('data-pptx-extracted-text')).toBe('1')
      expect(document.querySelector('#fallback')?.hasAttribute('data-pptx-extracted-text')).toBe(false)
    } finally {
      document.createRange = originalCreateRange
    }
  })

  it('exports simple rotation natively with a rotate field instead of a distorted rectangle', async () => {
    document.body.innerHTML = `
      <div class="ppt-page-root" style="display:block">
        <div id="rotated" style="display:block;background-color:rgb(22, 96, 171);border:1px solid rgb(22, 96, 171);transform:rotate(25deg)"></div>
      </div>
    `
    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#rotated', 120, 90, 360, 180)

    const extracted = await extractInDom({ unsupportedTransformStrategy: 'raster-fallback' })

    // html2pptx >= 0.2.0 通过矩阵分解重建简单旋转：导出带 rotate 的可编辑形状，
    // 不再视为 unsupported transform 坠回栅格（修复前导出的是无旋转的畸变矩形）
    const shapes = extracted.shapes as Array<Record<string, unknown>>
    expect(shapes).toHaveLength(1)
    expect(shapes[0]).toMatchObject({ shapeType: 'rect', rotate: 25, fill: '1660AB' })
    expect(extracted.extractionReport).toMatchObject({ unsupportedTransformCount: 0 })
    expect(document.querySelector('#rotated')?.getAttribute('data-pptx-extracted-shape')).toBe('1')
  })

  it('keeps skewed shapes in the raster fallback instead of exporting a distorted approximation', async () => {
    document.body.innerHTML = `
      <div class="ppt-page-root" style="display:block">
        <div id="skewed" style="display:block;background-color:rgb(22, 96, 171);transform:skew(20deg)"></div>
      </div>
    `
    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#skewed', 120, 90, 360, 180)

    const extracted = await extractInDom({ unsupportedTransformStrategy: 'raster-fallback' })

    expect(extracted.shapes).toHaveLength(0)
    expect(extracted.extractionReport).toMatchObject({ unsupportedTransformCount: 1 })
    expect(document.querySelector('#skewed')?.hasAttribute('data-pptx-extracted-shape')).toBe(false)
  })

  it('keeps transformed elements in the public API output unless raster fallback is requested', async () => {
    document.body.innerHTML = `
      <div class="ppt-page-root" style="display:block">
        <div id="rotated" style="display:block;background-color:rgb(22, 96, 171);border:1px solid rgb(22, 96, 171);transform:rotate(25deg)"></div>
      </div>
    `
    assignRect('.ppt-page-root', 0, 0, 1600, 900)
    assignRect('#rotated', 120, 90, 360, 180)

    const extracted = await extractInDom()

    expect(extracted.shapes).toHaveLength(1)
    expect(extracted.extractionReport).toMatchObject({ unsupportedTransformCount: 0 })
  })

  it('uses Tailwind font weight hints when no inline font weight overrides them', () => {
    const script = buildHtmlToPptxExtractScript({
      pageWidthPx: 1600,
      pageHeightPx: 900
    })

    expect(script).toContain('const resolveTailwindFontWeight = (element) => {')
    expect(script).toContain('const resolveInlineFontWeight = (element) => {')
    expect(script).toContain('const inlineFontWeight = resolveInlineFontWeight(parentElement);')
    expect(script).toContain('const tailwindFontWeight = resolveTailwindFontWeight(parentElement);')
    expect(script).toContain(
      'const fontWeight = inlineFontWeight || tailwindFontWeight || computedFontWeight || 400;'
    )
    expect(script).not.toContain('tailwindTextHints.fontWeight || computedFontWeight')
  })

  it('extracts inline text runs for styled spans inside block text', () => {
    const script = buildScript()

    expect(script).toContain('const collectInlineTextRuns = (element, baseStyle) => {')
    expect(script).toContain('const collectInlineTextLineRuns = (element, baseStyle) => {')
    expect(script).toContain('const appendTextRun = (runs, run) => {')
    expect(script).toContain('const textRunFor = (text, style, element) => {')
    expect(script).toContain('const hasStyledRun = runs.some((run) => !sameTextRunStyle(run, baseRun));')
    expect(script).toContain('const inlineRuns = collectInlineTextRuns(element, style);')
    expect(script).toContain('const inlineLineRuns = inlineRuns?.length ? collectInlineTextLineRuns(element, style) : [];')
    expect(script).toContain('inlineLineRuns.every((line) =>')
    expect(script).toContain('const rollbackTextExtraction = (startIndex, seenBefore) =>')
    expect(script).toContain('runs: inlineRuns')
    expect(script).toContain('...(richTextRuns?.length ? { runs: richTextRuns } : {})')
  })

  it('preserves normalized rich text runs with color and bold weight', () => {
    const slide = normalizeExtractedHtmlToPptxSlide({
      backgroundColor: 'FFFFFF',
      texts: [
        {
          text: '本页文字梳理：原始内容',
          x: 1,
          y: 1,
          w: 3,
          h: 0.4,
          fontSize: 18,
          color: '3E3A39',
          runs: [
            {
              text: '本页文字梳理：',
              fontSize: 18,
              fontFace: 'Noto Sans SC',
              color: 'C00000',
              bold: true
            },
            {
              text: '原始内容',
              fontSize: 18,
              fontFace: 'Noto Sans SC',
              color: '3E3A39'
            }
          ]
        }
      ],
      shapes: [],
      images: [],
      tables: []
    })

    expect(slide.texts[0]?.runs?.[0]).toMatchObject({
      text: '本页文字梳理：',
      color: 'C00000',
      bold: true
    })
    expect(slide.texts[0]?.runs?.[1]).toMatchObject({
      text: '原始内容',
      color: '3E3A39',
      bold: false
    })
  })

  it('uses CSS stacking order as paint-order fallback for z-indexed edits', () => {
    const script = buildScript()

    expect(script).toContain('const parseCssZIndex = (style) => {')
    expect(script).toContain(
      "parseCssZIndex(style) !== undefined && (style.position !== 'static' || isFlexOrGridItem(element))"
    )
    expect(script).toContain('const stackingKeyFor = (element) => {')
    expect(script).toContain('const compareStackingOrder = (left, right) => {')
    expect(script).toContain('const fallback = new Map(entries.map(([id, element]) => [id, stackingKeyFor(element)]));')
    expect(script).toContain('if (!document.elementsFromPoint) return buildFallbackResult();')
    expect(script).not.toContain('if (entries.length === 0 || !document.elementsFromPoint) return new Map();')
  })

  it('exports a single visible border side as a line instead of a full rectangle border', () => {
    const script = buildScript()

    expect(script).toContain('const collectBorderSides = () => {')
    expect(script).toContain('const parseTailwindBorderSideWidth = (utility) => {')
    expect(script).toContain('const parseTailwindBorderSideColor = (utility) => {')
    expect(script).toContain("sideKey === 'x' ? ['left', 'right']")
    expect(script).toContain('borderSideWidthPx: {')
    expect(script).toContain('borderSideColorSource: {')
    expect(script).toContain('const hintedWidth = tailwindVisualHints.borderSideWidthPx?.[sideName];')
    expect(script).toContain('const removeSide = (sideName) => {')
    expect(script).toContain('if (hintedWidth !== undefined && hintedWidth <= 0) {')
    expect(script).toContain('const hasUniformFourSideBorder =')
    expect(script).toContain('const shouldSplitBorderSides =')
    expect(script).toContain('const mainBorderInfo = shouldSplitBorderSides ? null : borderInfo;')
    expect(script).toContain('const buildBorderLineShape = (borderSide) => {')
    expect(script).toContain("shapeType: 'line'")
    expect(script).toContain("if (borderSide.side === 'bottom')")
    expect(script).toContain('border: hasMainBorder')
    expect(script).toContain('splitBorderLineShapes.forEach((shape) => shapes.push(shape));')
    expect(script).toContain("dash: borderSide.dash || 'solid'")
  })

  it('keeps small grid color cells as shapes for Tailwind visual panels', () => {
    const script = buildScript()

    expect(script).toContain('const isGridPaintCell =')
    expect(script).toContain('/grid/i.test(parentDisplay)')
    expect(script).toContain('!normalize(element.innerText || element.textContent)')
    expect(script).toContain('!hasBorder && !isSmallBadge && !isGridPaintCell')
    expect(script).toContain('if (shapes.length >= maxShapes) {')
    expect(script).toContain('extractionReport.shapeLimitReached = true;')
    expect(script).not.toContain('if (shapes.length >= maxShapes) break;')
  })

  it('keeps thin filled strips such as Tailwind header bars', () => {
    const script = buildScript()

    expect(script).toContain('const isThinPaintStrip =')
    expect(script).toContain('(rect.width >= 24 && rect.height >= 2 && rect.height < 12)')
    expect(script).toContain('(rect.height >= 24 && rect.width >= 2 && rect.width < 12)')
    expect(script).toContain("if ((rect.width < 12 || rect.height < 12) && !isThinPaintStrip) continue;")
  })

  it('exports thin border connectors and CSS chevron arrows as PPT lines', () => {
    const script = buildScript()

    expect(script).toContain('const hasVisibleBorder =')
    expect(script).toContain("['Top', 'Right', 'Bottom', 'Left'].some")
    expect(script).toContain('const isCssChevronBorder =')
    expect(script).toContain("hasCornerBorderSides('top', 'right')")
    expect(script).toContain('const buildCssChevronLineShapes = () => {')
    expect(script).toContain('flipV: true')
    expect(script).toContain('cssChevronLineShapes.forEach((shape) => shapes.push(shape));')
    expect(script).toContain('const shouldExportOnlyBorderLines =')
  })

  it('uses enough text, shape and image budget for dense PPTX export', () => {
    const rendererSource = fs.readFileSync(
      path.join(process.cwd(), 'src/main/io/html-pptx/renderer.ts'),
      'utf-8'
    )

    expect(rendererSource).toContain('maxTextBoxes: 360')
    expect(rendererSource).toContain('maxShapes: 400')
    expect(rendererSource).toContain('maxImages: 80')
    expect(rendererSource).not.toContain('maxShapes: 80')
  })
})
