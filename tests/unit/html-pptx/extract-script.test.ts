import { describe, expect, it } from 'vitest'
import { buildHtmlToPptxExtractScript } from '../../../src/main/utils/html-pptx'

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

  it('keeps computed font weight ahead of Tailwind font class hints', () => {
    const script = buildHtmlToPptxExtractScript({
      pageWidthPx: 1600,
      pageHeightPx: 900
    })

    expect(script).toContain('const resolveTailwindFontWeight = (element) => {')
    expect(script).toContain('const computedFontWeight = resolveComputedFontWeight(parentStyle);')
    expect(script).toContain(
      'const fontWeight = computedFontWeight || resolveTailwindFontWeight(parentElement) || 400;'
    )
    expect(script).not.toContain('tailwindTextHints.fontWeight || computedFontWeight')
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
    expect(script).toContain("const singleBorderSide = borderSides.length === 1 ? borderSides[0] : null;")
    expect(script).toContain("shapeType: 'line'")
    expect(script).toContain("if (singleBorderSide.side === 'bottom')")
    expect(script).toContain("dash: singleBorderSide.dash || 'solid'")
  })
})
