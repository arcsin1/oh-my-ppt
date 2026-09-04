import type { EditableCapability, EditSelectionPayload } from '@arcsin1/presentation-editor-runtime'

export interface ElementEditDraft {
  html: string
  text: string
  color: string
  fontSize: string
  fontWeight: string
  textAlign: string
  layoutX: string
  layoutY: string
  layoutWidth: string
  layoutHeight: string
  layoutZIndex: string
  opacity: string
  backgroundColor: string
  objectFit: string
  alt: string
  poster: string
  controls: boolean
  muted: boolean
  loop: boolean
  autoplay: boolean
  playsInline: boolean
  preload: string
  artTextTemplateId: string
  formulaLatex: string
  formulaHtml: string
  formulaDisplayMode: boolean
  chartType: string
  chartTitle: string
  chartLabels: string
  chartValues: string
  chartDataJson: string
  chartPrimaryColor: string
  chartAccentColor: string
  chartTextColor: string
  chartSmooth: boolean
  chartHorizontal: boolean
  chartStacked: boolean
  chartAreaFill: boolean
  chartShowPoints: boolean
  chartShowLegend: boolean
  chartDoughnutCutout: string
  chartRadarFill: boolean
  chartConfigJson: string
}

export interface ElementEditorProps {
  selection: EditSelectionPayload
  draft: ElementEditDraft
  onDraftChange: (
    draft: ElementEditDraft,
    options?: { commit?: boolean; fields?: Array<keyof ElementEditDraft> }
  ) => void
}

export function hasCapability(
  selection: EditSelectionPayload | null,
  capability: EditableCapability
): boolean {
  if (!selection) return false
  if (selection.capabilities?.includes(capability)) return true

  // Media semantics are intrinsic to the element tag. Keep the inspector
  // usable for pages produced by older runtimes that omitted the derived
  // capability list from the selection payload.
  if (capability === 'media' || capability === 'appearance') {
    const tag = String(selection.elementTag || selection.snapshot?.elementTag || '').toLowerCase()
    return tag === 'img' || tag === 'video'
  }

  return false
}

export function isArtTextSelection(selection: EditSelectionPayload | null): boolean {
  return Boolean(selection?.snapshot?.attrs.artTextTemplate)
}

export function getElementKindLabel(selection: EditSelectionPayload): string {
  switch (selection.kind) {
    case 'text':
      return 'Text'
    case 'media':
      return 'Media'
    case 'chart':
      return 'Chart'
    case 'table':
      return 'Table'
    case 'formula':
      return 'Formula'
    case 'shape':
      return 'Shape'
    case 'container':
      return 'Group'
    default:
      return 'Element'
  }
}
