import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  buildHtmlToPptxExtractScript,
  normalizeExtractedHtmlToPptxSlide
} from '../../../src/main/utils/html-pptx'

describe('buildHtmlToPptxExtractScript', () => {
  const buildScript = () =>
    buildHtmlToPptxExtractScript({
      pageWidthPx: 1600,
      pageHeightPx: 900
    })

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
    expect(script).toContain('inlineLineRuns.forEach((line) => {')
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
    expect(script).toContain('if (shapes.length >= maxShapes) continue;')
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

  it('uses enough shape budget for dense Tailwind grid panels during PPTX export', () => {
    const rendererSource = fs.readFileSync(
      path.join(process.cwd(), 'src/main/utils/html-pptx/renderer.ts'),
      'utf-8'
    )

    expect(rendererSource).toContain('maxShapes: 240')
    expect(rendererSource).not.toContain('maxShapes: 80')
  })
})
