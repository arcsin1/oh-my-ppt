import type {
  DataAnimFrom,
  DataAnimPptxTrigger,
  DataAnimType
} from '../../animation/data-anim-schema'

export type HtmlToPptxTextAlign = 'left' | 'center' | 'right' | 'justify'

export interface HtmlToPptxTextRun {
  text: string
  fontSize?: number
  fontFace?: string
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
}

export interface HtmlToPptxTextBox {
  text: string
  x: number
  y: number
  w: number
  h: number
  fontSize: number
  fontFace?: string
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  align?: HtmlToPptxTextAlign
  opacity?: number
  rotate?: number
  lineSpacing?: number
  charSpacing?: number
  paragraphSpacingBefore?: number
  paragraphSpacingAfter?: number
  verticalAlign?: 'top' | 'middle' | 'bottom'
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  bullet?: {
    type: 'bullet' | 'number'
    level?: number
    startAt?: number
  }
  wrap?: boolean
  runs?: HtmlToPptxTextRun[]
  order?: number
}

export type HtmlToPptxShapeType = 'rect' | 'roundRect' | 'ellipse' | 'line'

export interface HtmlToPptxBorder {
  color: string
  widthPt: number
  transparency?: number
  dash?: 'solid' | 'dash'
}

export interface HtmlToPptxShape {
  x: number
  y: number
  w: number
  h: number
  fill?: string
  transparency?: number
  radius?: number
  radiusAdj?: number
  border?: HtmlToPptxBorder
  shapeType?: HtmlToPptxShapeType
  rotate?: number
  order?: number
}

export interface HtmlToPptxImage {
  dataUri: string
  mimeType: string
  x: number
  y: number
  w: number
  h: number
  alt?: string
  rotate?: number
  opacity?: number
  order?: number
}

export interface HtmlToPptxTableCell {
  text: string
  rowspan: number
  colspan: number
  x: number
  y: number
  w: number
  h: number
  fontSize?: number
  fontFace?: string
  color?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  align?: HtmlToPptxTextAlign
  valign?: 'top' | 'middle' | 'bottom'
  fill?: string
  fillTransparency?: number
  border?: HtmlToPptxBorder
}

export interface HtmlToPptxTable {
  x: number
  y: number
  w: number
  h: number
  colWidths: number[]
  rowHeights: number[]
  rows: HtmlToPptxTableCell[][]
  order?: number
}

export type HtmlToPptxAnimationType = DataAnimType
export type HtmlToPptxAnimationTrigger = DataAnimPptxTrigger
export type HtmlToPptxAnimationFrom = DataAnimFrom

export interface HtmlToPptxAnimationTrace {
  type: HtmlToPptxAnimationType
  trigger: HtmlToPptxAnimationTrigger
  from?: HtmlToPptxAnimationFrom
  duration: number
  delay: number
  order: number
  x: number
  y: number
  w: number
  h: number
}

export interface HtmlToPptxSlide {
  title?: string
  backgroundColor?: string
  backgroundImage?: HtmlToPptxImage
  texts: HtmlToPptxTextBox[]
  shapes?: HtmlToPptxShape[]
  images?: HtmlToPptxImage[]
  tables?: HtmlToPptxTable[]
  /** Overlay images rendered on top of shapes/texts (e.g. KaTeX formula screenshots) */
  overlayImages?: HtmlToPptxImage[]
  /** Element animation boxes collected from data-anim attributes in the source HTML. */
  animationTraces?: HtmlToPptxAnimationTrace[]
  /** Native slide transition type, when configured by callers. */
  transitionType?: string
  transitionDurationMs?: number
}

export interface HtmlToPptxEmbeddedFont {
  fontFace: string
  style: 'regular' | 'bold' | 'italic' | 'boldItalic'
  ttfBuffer: Uint8Array
}

export interface HtmlToPptxDocument {
  title: string
  author?: string
  slides: HtmlToPptxSlide[]
  embeddedFonts?: HtmlToPptxEmbeddedFont[]
}

export interface HtmlToPptxExtractOptions {
  pageWidthPx: number
  pageHeightPx: number
  slideWidthIn?: number
  slideHeightIn?: number
  maxTextChars?: number
  maxTextBoxes?: number
  maxShapes?: number
  maxImages?: number
  maxImageBytes?: number
}

export interface HtmlToPptxExtractedSlide {
  backgroundColor?: string
  texts: HtmlToPptxTextBox[]
  shapes: HtmlToPptxShape[]
  images: HtmlToPptxImage[]
  tables: HtmlToPptxTable[]
  consumedTableElementIds: string[]
}
