import { create } from 'zustand'
import { ipc } from '@renderer/lib/ipc'
import type { I18nKey, TranslationParams } from '../i18n'
import type { EditModeMovePayload, EditSelectionPayload } from '@arcsin1/presentation-editor-runtime'
import type { HtmlEditorCanvasHandle } from '../components/html-editor/HtmlEditorCanvas'
import {
  EMPTY_ELEMENT_DRAFT,
  fontSizeToNumber,
  normalizeFontWeight,
  normalizeTextAlign,
  opacityToInput,
  rgbToHex
} from '../components/session-detail/element-inspector/elementEditUtils'
import type { ElementEditDraft } from '../components/session-detail/element-inspector'
import { hasCapability } from '../components/session-detail/element-inspector/types'
import {
  buildChartJsConfig,
  normalizeChartData,
  type InsertChartSeries,
  type InsertChartType
} from '../components/session-detail/workspace/insert-charts'
import { editTargetMatchesDeletedSelector, useHtmlEditHistoryStore } from './htmlEditHistoryStore'
import { useHtmlEditorStore } from './htmlEditorStore'
import { useHtmlEditorUiStore } from './htmlEditorUiStore'
import { useToastStore } from './toastStore'

type ElementPropertyStylePatch = {
  zIndex?: number
  opacity?: number
  backgroundColor?: string
  color?: string
  fontSize?: string
  fontWeight?: string
  textAlign?: string
  objectFit?: string
}

type ElementPropertyAttrsPatch = {
  alt?: string
  poster?: string
  controls?: boolean
  muted?: boolean
  loop?: boolean
  autoplay?: boolean
  playsInline?: boolean
  preload?: string
}

type ElementPropertyPatch = {
  html?: string
  text?: string
  textTarget?: EditSelectionPayload['textTarget']
  formula?: {
    latex: string
    html: string
    displayMode: boolean
    originalLatex?: string
  }
  chart?: {
    type: string
    title: string
    labels: string[]
    values: number[]
    series: InsertChartSeries[]
    primaryColor: string
    accentColor: string
    textColor: string
    smooth: boolean
    horizontal: boolean
    stacked: boolean
    areaFill: boolean
    showPoints: boolean
    showLegend: boolean
    doughnutCutout: number
    radarFill: boolean
    configJson: string
  }
  style?: ElementPropertyStylePatch
  attrs?: ElementPropertyAttrsPatch
}

export interface EditSessionContext {
  t: (key: I18nKey, params?: TranslationParams) => string
  requestRefresh: () => void
  bumpThumbnail: (pageId: string) => void
  getPageContext: () => { pageId: string; htmlPath: string; sessionId: string } | null
}

function getCommitFieldsForSelection(selection: EditSelectionPayload): Set<keyof ElementEditDraft> {
  const fields = new Set<keyof ElementEditDraft>()
  const capabilities = selection.capabilities || []
  if (capabilities.includes('layer')) fields.add('layoutZIndex')
  if (hasCapability(selection, 'appearance')) {
    fields.add('opacity')
    fields.add('backgroundColor')
  }
  if (hasCapability(selection, 'media')) {
    fields.add('objectFit')
    fields.add('alt')
    fields.add('poster')
    fields.add('controls')
    fields.add('muted')
    fields.add('loop')
    fields.add('autoplay')
    fields.add('playsInline')
    fields.add('preload')
  }
  if (capabilities.includes('text')) {
    fields.add('html')
    fields.add('text')
    fields.add('color')
    fields.add('fontSize')
    fields.add('fontWeight')
    fields.add('textAlign')
  }
  if (capabilities.includes('formula')) {
    fields.add('formulaLatex')
    fields.add('formulaHtml')
    fields.add('formulaDisplayMode')
  }
  if (capabilities.includes('chart')) {
    fields.add('chartTitle')
    fields.add('chartDataJson')
    fields.add('chartPrimaryColor')
    fields.add('chartAccentColor')
    fields.add('chartTextColor')
    fields.add('chartSmooth')
    fields.add('chartHorizontal')
    fields.add('chartStacked')
    fields.add('chartAreaFill')
    fields.add('chartShowPoints')
    fields.add('chartShowLegend')
    fields.add('chartDoughnutCutout')
    fields.add('chartRadarFill')
    fields.add('chartConfigJson')
  }
  return fields
}

function parseCsvList(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseNumberCsv(value: string): number[] {
  return parseCsvList(value)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
}

const CHART_DATA_X_KEYS = ['x', 'label', 'category', 'name']
const MAX_CHART_IMPORT_ROWS = 200
const MAX_CHART_IMPORT_SERIES = 8

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = String(value ?? '')
    .trim()
    .replace(/,/g, '')
  if (!text) return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

function formatChartDataJson(
  labels: string[],
  series: InsertChartSeries[] | undefined,
  values: number[]
): string {
  const safeSeries =
    series && series.length > 0
      ? series
      : [
          {
            name: 'Value',
            values
          }
        ]
  return JSON.stringify(
    labels.map((label, index) => ({
      x: label,
      ...safeSeries.reduce<Record<string, number>>((record, item, seriesIndex) => {
        const name = item.name || (seriesIndex === 0 ? 'Value' : `Series ${seriesIndex + 1}`)
        const value = Number(item.values[index])
        record[name] = Number.isFinite(value) ? value : 0
        return record
      }, {})
    })),
    null,
    2
  )
}

function parseChartDataJson(
  value: string
): { labels: string[]; values: number[]; series: InsertChartSeries[] } | null {
  const text = String(value || '').trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) return null
    const labels: string[] = []
    const normalizedRows: Array<Record<string, unknown>> = []
    parsed.slice(0, MAX_CHART_IMPORT_ROWS).forEach((item) => {
      if (Array.isArray(item)) {
        const label = String(item[0] ?? '').trim()
        if (!label) return
        labels.push(label)
        normalizedRows.push(
          item
            .slice(1, MAX_CHART_IMPORT_SERIES + 1)
            .reduce<Record<string, unknown>>((record, cell, index) => {
              record[index === 0 ? 'Value' : `Series ${index + 1}`] = cell
              return record
            }, {})
        )
      } else if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        const keys = Object.keys(record)
        const xKey =
          CHART_DATA_X_KEYS.find((key) => key in record) ??
          keys.find((key) => toFiniteNumber(record[key]) === null) ??
          keys[0]
        const label = String(record[xKey] ?? '').trim()
        if (!label) return
        labels.push(label)
        normalizedRows.push(
          keys.reduce<Record<string, unknown>>((row, key) => {
            if (key !== xKey) row[key] = record[key]
            return row
          }, {})
        )
      }
    })
    if (labels.length === 0 || normalizedRows.length === 0) return null
    const seriesKeys = Array.from(
      new Set(
        normalizedRows.flatMap((row) =>
          Object.keys(row).filter((key) => normalizedRows.some((item) => key in item))
        )
      )
    )
      .filter(
        (key) => key.trim() && normalizedRows.some((row) => toFiniteNumber(row[key]) !== null)
      )
      .slice(0, MAX_CHART_IMPORT_SERIES)
    const safeSeriesKeys = seriesKeys.length > 0 ? seriesKeys : ['Value']
    const series = safeSeriesKeys.map((key, index) => ({
      name: key || (index === 0 ? 'Value' : `Series ${index + 1}`),
      values: normalizedRows.map((row) => toFiniteNumber(row[key]) ?? 0)
    }))
    return labels.length > 0 ? { labels, values: series[0]?.values ?? [], series } : null
  } catch {
    return null
  }
}

function buildChartPatchFromDraft(draft: ElementEditDraft): ElementPropertyPatch['chart'] {
  const chartData = parseChartDataJson(draft.chartDataJson)
  const chart = normalizeChartData({
    type: draft.chartType as InsertChartType,
    title: draft.chartTitle,
    labels: chartData?.labels ?? parseCsvList(draft.chartLabels),
    values: chartData?.values ?? parseNumberCsv(draft.chartValues),
    series: chartData?.series,
    primaryColor: draft.chartPrimaryColor,
    accentColor: draft.chartAccentColor,
    textColor: draft.chartTextColor,
    smooth: draft.chartSmooth,
    horizontal: draft.chartHorizontal,
    stacked: draft.chartStacked,
    areaFill: draft.chartAreaFill,
    showPoints: draft.chartShowPoints,
    showLegend: draft.chartShowLegend,
    doughnutCutout: Number(draft.chartDoughnutCutout),
    radarFill: draft.chartRadarFill
  })
  return {
    ...chart,
    configJson: JSON.stringify(buildChartJsConfig(chart))
  }
}

function buildElementPropertyPatch(
  selection: EditSelectionPayload,
  draft: ElementEditDraft,
  fields?: Array<keyof ElementEditDraft>
): ElementPropertyPatch | null {
  if (!selection.snapshot) return null

  const commitFields =
    fields && fields.length > 0 ? new Set(fields) : getCommitFieldsForSelection(selection)
  const initial = selection.snapshot
  const style: ElementPropertyStylePatch = {}
  const attrs: ElementPropertyAttrsPatch = {}
  let text: string | undefined
  let html: string | undefined
  let formula: ElementPropertyPatch['formula'] | undefined
  let chart: ElementPropertyPatch['chart'] | undefined

  if (commitFields.has('layoutZIndex')) {
    const value = parseInt(draft.layoutZIndex, 10)
    const initialValue = selection.zIndex ?? 10
    if (Number.isFinite(value) && value !== initialValue) style.zIndex = value
  }
  if (commitFields.has('opacity')) {
    const value = Number(draft.opacity)
    const initialValue = Number(opacityToInput(initial.computed.opacity))
    if (Number.isFinite(value) && value !== initialValue) style.opacity = value
  }
  if (
    commitFields.has('backgroundColor') &&
    draft.backgroundColor !==
      rgbToHex(initial.computed.svgPaintColor || initial.computed.backgroundColor)
  ) {
    style.backgroundColor = draft.backgroundColor
  }
  if (
    commitFields.has('objectFit') &&
    draft.objectFit !== (initial.computed.objectFit || 'contain')
  ) {
    style.objectFit = draft.objectFit
  }
  const initialHtml = initial.text?.html || ''
  if (commitFields.has('html') && draft.html.trim() && draft.html.trim() !== initialHtml.trim()) {
    html = draft.html.trim()
  }
  const initialText = selection.textTarget?.text ?? initial.text?.value ?? ''
  if (!html && commitFields.has('text') && draft.text.trim() && draft.text.trim() !== initialText) {
    text = draft.text.trim()
  }
  if (
    (commitFields.has('formulaLatex') ||
      commitFields.has('formulaHtml') ||
      commitFields.has('formulaDisplayMode')) &&
    draft.formulaLatex.trim() &&
    draft.formulaHtml.trim()
  ) {
    const initialFormula = initial.formula
    const nextLatex = draft.formulaLatex.trim()
    const nextHtml = draft.formulaHtml.trim()
    const nextDisplayMode = draft.formulaDisplayMode
    if (
      nextLatex !== (initialFormula?.latex || '') ||
      nextHtml !== (initialFormula?.html || '') ||
      nextDisplayMode !== Boolean(initialFormula?.displayMode)
    ) {
      formula = {
        latex: nextLatex,
        html: nextHtml,
        displayMode: nextDisplayMode,
        originalLatex: initialFormula?.latex || ''
      }
    }
  }
  if (
    commitFields.has('chartTitle') ||
    commitFields.has('chartDataJson') ||
    commitFields.has('chartPrimaryColor') ||
    commitFields.has('chartAccentColor') ||
    commitFields.has('chartTextColor') ||
    commitFields.has('chartSmooth') ||
    commitFields.has('chartHorizontal') ||
    commitFields.has('chartStacked') ||
    commitFields.has('chartAreaFill') ||
    commitFields.has('chartShowPoints') ||
    commitFields.has('chartShowLegend') ||
    commitFields.has('chartDoughnutCutout') ||
    commitFields.has('chartRadarFill') ||
    commitFields.has('chartConfigJson')
  ) {
    const nextChart = buildChartPatchFromDraft(draft)
    const initialChart = initial.chart
      ? {
          type: initial.chart.type,
          title: initial.chart.title,
          labels: initial.chart.labels,
          values: initial.chart.values,
          series: initial.chart.series || [
            {
              name: initial.chart.title || 'Value',
              values: initial.chart.values
            }
          ],
          primaryColor: initial.chart.primaryColor,
          accentColor: initial.chart.accentColor,
          textColor: initial.chart.textColor,
          smooth: initial.chart.smooth,
          horizontal: initial.chart.horizontal,
          stacked: initial.chart.stacked,
          areaFill: initial.chart.areaFill,
          showPoints: initial.chart.showPoints,
          showLegend: initial.chart.showLegend,
          doughnutCutout: initial.chart.doughnutCutout,
          radarFill: initial.chart.radarFill,
          configJson: initial.chart.configJson
        }
      : null
    if (JSON.stringify(nextChart) !== JSON.stringify(initialChart)) {
      chart = nextChart
    }
  }
  if (commitFields.has('color') && draft.color !== rgbToHex(initial.computed.color)) {
    style.color = draft.color
  }
  if (
    commitFields.has('fontSize') &&
    draft.fontSize !== fontSizeToNumber(initial.computed.fontSize)
  ) {
    style.fontSize = draft.fontSize ? `${draft.fontSize}px` : undefined
  }
  if (
    commitFields.has('fontWeight') &&
    draft.fontWeight !== normalizeFontWeight(initial.computed.fontWeight)
  ) {
    style.fontWeight = draft.fontWeight
  }
  if (
    commitFields.has('textAlign') &&
    draft.textAlign !== normalizeTextAlign(initial.computed.textAlign)
  ) {
    style.textAlign = draft.textAlign
  }
  if (commitFields.has('alt') && draft.alt !== (initial.attrs.alt || '')) attrs.alt = draft.alt
  if (commitFields.has('poster') && draft.poster !== (initial.attrs.poster || '')) {
    attrs.poster = draft.poster
  }
  if (commitFields.has('controls') && draft.controls !== Boolean(initial.attrs.controls)) {
    attrs.controls = draft.controls
  }
  if (commitFields.has('muted') && draft.muted !== Boolean(initial.attrs.muted)) {
    attrs.muted = draft.muted
  }
  if (commitFields.has('loop') && draft.loop !== Boolean(initial.attrs.loop)) {
    attrs.loop = draft.loop
  }
  if (commitFields.has('autoplay') && draft.autoplay !== Boolean(initial.attrs.autoplay)) {
    attrs.autoplay = draft.autoplay
  }
  if (
    commitFields.has('playsInline') &&
    draft.playsInline !== (initial.attrs.playsInline !== false)
  ) {
    attrs.playsInline = draft.playsInline
  }
  if (commitFields.has('preload') && draft.preload !== (initial.attrs.preload || 'metadata')) {
    attrs.preload = draft.preload
  }

  if (
    html === undefined &&
    text === undefined &&
    formula === undefined &&
    chart === undefined &&
    Object.keys(style).length === 0 &&
    Object.keys(attrs).length === 0
  ) {
    return null
  }

  return {
    html,
    text,
    formula,
    chart,
    textTarget: text !== undefined ? selection.textTarget : undefined,
    style: Object.keys(style).length > 0 ? style : undefined,
    attrs: Object.keys(attrs).length > 0 ? attrs : undefined
  }
}

interface EditSessionState {
  iframeHandle: HtmlEditorCanvasHandle | null
  selection: EditSelectionPayload | null
  draft: ElementEditDraft
  isSavingEdits: boolean
  isApplyingSyncElement: boolean
  ctx: EditSessionContext | null

  attach: (ctx: EditSessionContext) => void
  setIframeHandle: (handle: HtmlEditorCanvasHandle | null) => void
  resetForPage: () => void
  reset: () => void
  selectElement: (payload: EditSelectionPayload) => void
  handleMoved: (payload: EditModeMovePayload) => void
  updateDraft: (
    draft: ElementEditDraft,
    options?: { commit?: boolean; fields?: Array<keyof ElementEditDraft> }
  ) => void
  cancelEdit: () => void
  deleteSelected: () => void
  deleteBySelector: (selector: string) => void
  discardAll: () => void
  undo: () => void
  redo: () => void
  replayPending: () => void
  commitDraft: (draft: ElementEditDraft, fields?: Array<keyof ElementEditDraft>) => boolean
  commitCurrentDraft: () => boolean
  flushPendingDrags: () => Promise<void>
  save: () => Promise<{ saved: boolean; error?: string }>
}

export const useHtmlEditStore = create<EditSessionState>((set, get) => ({
  iframeHandle: null,
  selection: null,
  draft: EMPTY_ELEMENT_DRAFT,
  isSavingEdits: false,
  isApplyingSyncElement: false,
  ctx: null,

  attach: (ctx) => set({ ctx }),
  setIframeHandle: (iframeHandle) => set({ iframeHandle }),
  resetForPage: () => set({ selection: null, draft: EMPTY_ELEMENT_DRAFT }),
  reset: () =>
    set({
      iframeHandle: null,
      selection: null,
      draft: EMPTY_ELEMENT_DRAFT,
      isSavingEdits: false,
      ctx: null
    }),

  commitDraft: (draft, fields) => {
    const selection = get().selection
    const pc = get().ctx?.getPageContext()
    if (!selection || !pc) return false
    const patch = buildElementPropertyPatch(selection, draft, fields)
    if (!patch) return false
    useHtmlEditHistoryStore.getState().upsertPropertyEdit({
      pageId: pc.pageId,
      htmlPath: pc.htmlPath,
      selector: selection.selector,
      blockId: selection.blockId,
      patch
    })
    return true
  },
  commitCurrentDraft: () => get().commitDraft(get().draft),

  selectElement: (payload) => {
    get().commitCurrentDraft()
    if (!payload.snapshot) {
      set({ selection: null, draft: EMPTY_ELEMENT_DRAFT })
      useHtmlEditorUiStore.getState().clearEditSelectedElement()
      return
    }
    set({ selection: payload })
    useHtmlEditorUiStore.getState().setEditSelectedElement(payload.selector)
    const zValue = payload.zIndex !== undefined ? String(payload.zIndex) : '10'
    const bounds = payload.snapshot.metrics.page
    const computed = payload.snapshot.computed
    const attrs = payload.snapshot.attrs
    const formula = payload.snapshot.formula
    const chart = payload.snapshot.chart
    if (payload.isText) {
      set({
        draft: {
          text: payload.textTarget?.text ?? payload.text,
          html: payload.html || payload.snapshot.text?.html || '',
          color: rgbToHex(computed.color),
          fontSize: fontSizeToNumber(computed.fontSize),
          fontWeight: normalizeFontWeight(computed.fontWeight),
          textAlign: normalizeTextAlign(computed.textAlign),
          layoutX: String(Math.round(bounds.x)),
          layoutY: String(Math.round(bounds.y)),
          layoutWidth: String(Math.round(bounds.width)),
          layoutHeight: String(Math.round(bounds.height)),
          layoutZIndex: zValue,
          opacity: opacityToInput(computed.opacity),
          backgroundColor: rgbToHex(computed.svgPaintColor || computed.backgroundColor),
          objectFit: computed.objectFit || 'contain',
          alt: attrs.alt || '',
          poster: attrs.poster || '',
          controls: Boolean(attrs.controls),
          muted: Boolean(attrs.muted),
          loop: Boolean(attrs.loop),
          autoplay: Boolean(attrs.autoplay),
          playsInline: attrs.playsInline !== false,
          preload: attrs.preload || 'metadata',
          artTextTemplateId: attrs.artTextTemplate || '',
          formulaLatex: formula?.latex || '',
          formulaHtml: formula?.html || '',
          formulaDisplayMode: Boolean(formula?.displayMode),
          chartType: chart?.type || 'bar',
          chartTitle: chart?.title || '',
          chartLabels: chart?.labels.join(', ') || '',
          chartValues: chart?.values.join(', ') || '',
          chartDataJson: chart ? formatChartDataJson(chart.labels, chart.series, chart.values) : '',
          chartPrimaryColor: chart?.primaryColor || '#5d6b4d',
          chartAccentColor: chart?.accentColor || '#8fbc8f',
          chartTextColor: chart?.textColor || '#2f3b28',
          chartSmooth: chart?.smooth !== false,
          chartHorizontal: Boolean(chart?.horizontal),
          chartStacked: Boolean(chart?.stacked),
          chartAreaFill: chart?.areaFill !== false,
          chartShowPoints: chart?.showPoints !== false,
          chartShowLegend: Boolean(chart?.showLegend),
          chartDoughnutCutout: String(chart?.doughnutCutout ?? 58),
          chartRadarFill: chart?.radarFill !== false,
          chartConfigJson: chart?.configJson || ''
        }
      })
    } else {
      set({
        draft: {
          ...EMPTY_ELEMENT_DRAFT,
          layoutX: String(Math.round(bounds.x)),
          layoutY: String(Math.round(bounds.y)),
          layoutWidth: String(Math.round(bounds.width)),
          layoutHeight: String(Math.round(bounds.height)),
          layoutZIndex: zValue,
          opacity: opacityToInput(computed.opacity),
          backgroundColor: rgbToHex(computed.svgPaintColor || computed.backgroundColor),
          objectFit: computed.objectFit || 'contain',
          alt: attrs.alt || '',
          poster: attrs.poster || '',
          controls: Boolean(attrs.controls),
          muted: Boolean(attrs.muted),
          loop: Boolean(attrs.loop),
          autoplay: Boolean(attrs.autoplay),
          playsInline: attrs.playsInline !== false,
          preload: attrs.preload || 'metadata',
          artTextTemplateId: attrs.artTextTemplate || '',
          formulaLatex: formula?.latex || '',
          formulaHtml: formula?.html || '',
          formulaDisplayMode: Boolean(formula?.displayMode),
          chartType: chart?.type || 'bar',
          chartTitle: chart?.title || '',
          chartLabels: chart?.labels.join(', ') || '',
          chartValues: chart?.values.join(', ') || '',
          chartDataJson: chart ? formatChartDataJson(chart.labels, chart.series, chart.values) : '',
          chartPrimaryColor: chart?.primaryColor || '#5d6b4d',
          chartAccentColor: chart?.accentColor || '#8fbc8f',
          chartTextColor: chart?.textColor || '#2f3b28',
          chartSmooth: chart?.smooth !== false,
          chartHorizontal: Boolean(chart?.horizontal),
          chartStacked: Boolean(chart?.stacked),
          chartAreaFill: chart?.areaFill !== false,
          chartShowPoints: chart?.showPoints !== false,
          chartShowLegend: Boolean(chart?.showLegend),
          chartDoughnutCutout: String(chart?.doughnutCutout ?? 58),
          chartRadarFill: chart?.radarFill !== false,
          chartConfigJson: chart?.configJson || ''
        }
      })
    }
  },

  handleMoved: (payload) => {
    const pc = get().ctx?.getPageContext()
    if (!pc) return
    const selection = get().selection
    const draftZIndex = parseInt(get().draft.layoutZIndex, 10)

    if (selection && payload.selector === selection.selector) {
      const visualX =
        payload.visualX ??
        (selection.pageBounds?.x ?? selection.bounds?.x ?? 0) +
          (payload.layoutMode === 'translate' ? payload.x : payload.deltaX)
      const visualY =
        payload.visualY ??
        (selection.pageBounds?.y ?? selection.bounds?.y ?? 0) +
          (payload.layoutMode === 'translate' ? payload.y : payload.deltaY)
      set((state) => ({
        draft: {
          ...state.draft,
          layoutX: String(Math.round(visualX)),
          layoutY: String(Math.round(visualY)),
          ...(payload.width !== undefined
            ? { layoutWidth: String(Math.round(payload.width)) }
            : {}),
          ...(payload.height !== undefined
            ? { layoutHeight: String(Math.round(payload.height)) }
            : {})
        }
      }))
    }

    useHtmlEditHistoryStore.getState().upsertDragEdit({
      pageId: pc.pageId,
      htmlPath: pc.htmlPath,
      selector: payload.selector,
      x: payload.x,
      y: payload.y,
      width: payload.width ?? null,
      height: payload.height ?? null,
      layoutIsland: payload.layoutIsland,
      childUpdates: payload.childUpdates ?? [],
      isAbsoluteMode: payload.layoutMode === 'absolute',
      zIndex: Number.isFinite(draftZIndex) ? draftZIndex : undefined
    })
  },

  updateDraft: (draft, options) => {
    const selection = get().selection
    const prevDraft = get().draft
    const pc = get().ctx?.getPageContext()
    const liveStyle: ElementPropertyStylePatch = {}
    const liveAttrs: ElementPropertyAttrsPatch = {}

    if (selection && pc && draft.layoutZIndex !== prevDraft.layoutZIndex) {
      const zNum = parseInt(draft.layoutZIndex, 10)
      if (Number.isFinite(zNum)) liveStyle.zIndex = zNum
    }
    if (draft.opacity !== prevDraft.opacity) {
      const opacity = Number(draft.opacity)
      if (Number.isFinite(opacity)) liveStyle.opacity = opacity
    }
    if (draft.backgroundColor !== prevDraft.backgroundColor)
      liveStyle.backgroundColor = draft.backgroundColor
    if (draft.objectFit !== prevDraft.objectFit) liveStyle.objectFit = draft.objectFit
    if (draft.textAlign !== prevDraft.textAlign) liveStyle.textAlign = draft.textAlign
    if (draft.alt !== prevDraft.alt) liveAttrs.alt = draft.alt
    if (draft.poster !== prevDraft.poster) liveAttrs.poster = draft.poster
    if (draft.controls !== prevDraft.controls) liveAttrs.controls = draft.controls
    if (draft.muted !== prevDraft.muted) liveAttrs.muted = draft.muted
    if (draft.loop !== prevDraft.loop) liveAttrs.loop = draft.loop
    if (draft.autoplay !== prevDraft.autoplay) liveAttrs.autoplay = draft.autoplay
    if (draft.playsInline !== prevDraft.playsInline) liveAttrs.playsInline = draft.playsInline
    if (draft.preload !== prevDraft.preload) liveAttrs.preload = draft.preload
    const formulaChanged =
      draft.formulaLatex !== prevDraft.formulaLatex ||
      draft.formulaHtml !== prevDraft.formulaHtml ||
      draft.formulaDisplayMode !== prevDraft.formulaDisplayMode
    const chartChanged =
      draft.chartTitle !== prevDraft.chartTitle ||
      draft.chartDataJson !== prevDraft.chartDataJson ||
      draft.chartPrimaryColor !== prevDraft.chartPrimaryColor ||
      draft.chartAccentColor !== prevDraft.chartAccentColor ||
      draft.chartTextColor !== prevDraft.chartTextColor ||
      draft.chartSmooth !== prevDraft.chartSmooth ||
      draft.chartHorizontal !== prevDraft.chartHorizontal ||
      draft.chartStacked !== prevDraft.chartStacked ||
      draft.chartAreaFill !== prevDraft.chartAreaFill ||
      draft.chartShowPoints !== prevDraft.chartShowPoints ||
      draft.chartShowLegend !== prevDraft.chartShowLegend ||
      draft.chartDoughnutCutout !== prevDraft.chartDoughnutCutout ||
      draft.chartRadarFill !== prevDraft.chartRadarFill

    set({ draft })

    if (selection && pc) {
      const iframe = get().iframeHandle
      const zNum = parseInt(draft.layoutZIndex, 10)
      if (Number.isFinite(zNum) && draft.layoutZIndex !== prevDraft.layoutZIndex) {
        iframe?.applyZIndex(selection.selector, zNum)
      }
      if (Object.keys(liveStyle).length > 0 || Object.keys(liveAttrs).length > 0) {
        iframe?.applyElementProperties(selection.selector, {
          style: liveStyle,
          attrs: liveAttrs
        })
      }
      if (selection.isText) {
        iframe?.liveUpdateElement(selection.selector, {
          html: draft.html,
          text: draft.text,
          textTarget: selection.textTarget,
          style: {
            color: draft.color,
            fontSize: draft.fontSize ? `${draft.fontSize}px` : undefined,
            fontWeight: draft.fontWeight
          }
        })
      }
      if (selection.capabilities?.includes('formula') && formulaChanged && draft.formulaHtml) {
        iframe?.liveUpdateElement(selection.selector, {
          formula: {
            latex: draft.formulaLatex.trim(),
            html: draft.formulaHtml,
            displayMode: draft.formulaDisplayMode
          }
        })
      }
      if (selection.capabilities?.includes('chart') && chartChanged) {
        iframe?.liveUpdateElement(selection.selector, {
          chart: buildChartPatchFromDraft(draft)
        })
      }
      if (options?.commit) get().commitDraft(draft, options.fields)
    }
  },

  cancelEdit: () => {
    get().commitCurrentDraft()
    get().iframeHandle?.clearEditModeSelection()
    set({ selection: null, draft: EMPTY_ELEMENT_DRAFT })
    useHtmlEditorUiStore.getState().clearEditSelectedElement()
  },

  deleteSelected: () => {
    const selection = get().selection
    const pc = get().ctx?.getPageContext()
    if (!selection || !pc) return
    const selector = selection.selector
    useHtmlEditHistoryStore.getState().addDelete({
      pageId: pc.pageId,
      htmlPath: pc.htmlPath,
      selector
    })
    get().iframeHandle?.hideElement(selector)
    get().iframeHandle?.clearEditModeSelection()
    set({ selection: null, draft: EMPTY_ELEMENT_DRAFT })
    useHtmlEditorUiStore.getState().clearEditSelectedElement()
  },

  deleteBySelector: (selector) => {
    const pc = get().ctx?.getPageContext()
    if (!pc || !selector) return
    const selection = get().selection
    if (selection && selection.selector === selector) get().commitCurrentDraft()
    useHtmlEditHistoryStore.getState().addDelete({
      pageId: pc.pageId,
      htmlPath: pc.htmlPath,
      selector
    })
    get().iframeHandle?.hideElement(selector)
    get().iframeHandle?.clearEditModeSelection()
    set({ selection: null, draft: EMPTY_ELEMENT_DRAFT })
    useHtmlEditorUiStore.getState().clearEditSelectedElement()
  },

  discardAll: () => {
    const ctx = get().ctx
    const pc = ctx?.getPageContext()
    if (!ctx || !pc) return
    const editHistory = useHtmlEditHistoryStore.getState()
    const snapshot = editHistory.getSnapshotForPage(pc.pageId)
    const hadPending =
      snapshot.dragEdits.length > 0 ||
      snapshot.textEdits.length > 0 ||
      snapshot.propertyEdits.length > 0 ||
      snapshot.deletes.length > 0 ||
      snapshot.addElements.length > 0
    editHistory.clearPage(pc.pageId)
    get().iframeHandle?.clearEditModeSelection()
    set({ selection: null, draft: EMPTY_ELEMENT_DRAFT })
    useHtmlEditorUiStore.getState().clearEditSelectedElement()
    if (hadPending) ctx.requestRefresh()
    if (hadPending) useToastStore.getState().info(ctx.t('sessionDetail.discardedAdjustments'))
  },

  undo: () => {
    const ctx = get().ctx
    const pc = ctx?.getPageContext()
    if (!ctx || !pc) return
    get().commitCurrentDraft()
    if (!useHtmlEditHistoryStore.getState().undo(pc.pageId)) return
    get().iframeHandle?.clearEditModeSelection()
    set({ selection: null, draft: EMPTY_ELEMENT_DRAFT })
    useHtmlEditorUiStore.getState().clearEditSelectedElement()
    ctx.requestRefresh()
  },

  redo: () => {
    const ctx = get().ctx
    const pc = ctx?.getPageContext()
    if (!ctx || !pc) return
    if (!useHtmlEditHistoryStore.getState().redo(pc.pageId)) return
    get().iframeHandle?.clearEditModeSelection()
    set({ selection: null, draft: EMPTY_ELEMENT_DRAFT })
    useHtmlEditorUiStore.getState().clearEditSelectedElement()
    ctx.requestRefresh()
  },

  replayPending: () => {
    const pc = get().ctx?.getPageContext()
    const iframe = get().iframeHandle
    if (!pc || !iframe) return
    const snapshot = useHtmlEditHistoryStore.getState().getSnapshotForPage(pc.pageId)
    for (const d of snapshot.deletes) iframe.hideElement(d.selector)
    for (const a of snapshot.addElements)
      void iframe.injectElement(a.parentSelector, a.htmlFragment, a.insertIndex)
    for (const d of snapshot.dragEdits) {
      if (d.layoutIsland) iframe.applyLayoutIsland(d.layoutIsland)
      iframe.applyDragStyle(d.selector, {
        x: d.x,
        y: d.y,
        width: d.width ?? undefined,
        height: d.height ?? undefined,
        isAbsoluteMode: d.isAbsoluteMode
      })
      if (d.zIndex !== undefined) iframe.applyZIndex(d.selector, d.zIndex)
      if (d.childUpdates.length > 0) iframe.applyChildUpdates(d.selector, d.childUpdates)
    }
    for (const t of snapshot.textEdits) {
      iframe.liveUpdateElement(t.selector, {
        text: t.patch.text,
        textTarget: undefined,
        style: t.patch.style
      })
    }
    for (const p of snapshot.propertyEdits) {
      iframe.applyElementProperties(p.selector, {
        style: p.patch.style,
        attrs: p.patch.attrs
      })
      if (
        p.patch.formula ||
        p.patch.chart ||
        p.patch.html ||
        p.patch.text ||
        p.patch.style?.color ||
        p.patch.style?.fontSize ||
        p.patch.style?.fontWeight
      ) {
        iframe.liveUpdateElement(p.selector, {
          text: p.patch.text,
          html: p.patch.html,
          formula: p.patch.formula,
          chart: p.patch.chart,
          textTarget: p.patch.textTarget,
          style: {
            color: p.patch.style?.color,
            fontSize: p.patch.style?.fontSize,
            fontWeight: p.patch.style?.fontWeight
          }
        })
      }
    }
    const selection = get().selection
    const selectedDeleted = selection
      ? snapshot.deletes.some((d) =>
          editTargetMatchesDeletedSelector(selection.selector, d.selector, selection.blockId)
        )
      : false
    if (selection?.selector && !selectedDeleted) {
      void iframe.restoreEditModeSelection?.(selection.selector)
    }
  },

  flushPendingDrags: async () => {
    const pc = get().ctx?.getPageContext()
    const iframe = get().iframeHandle
    if (!pc || !iframe) return
    const editHistory = useHtmlEditHistoryStore.getState()
    const snap = editHistory.getSnapshotForPage(pc.pageId)
    const deletedSelectors = new Set(snap.deletes.map((d) => d.selector))
    const covered = new Set<string>()
    for (const d of snap.dragEdits) {
      if (deletedSelectors.has(d.selector)) continue
      covered.add(d.selector)
      const layout = await iframe.readElementLayout(d.selector)
      if (!layout) continue
      editHistory.upsertDragEdit({
        pageId: d.pageId,
        htmlPath: d.htmlPath,
        selector: d.selector,
        x: layout.x,
        y: layout.y,
        isAbsoluteMode: layout.isAbsoluteMode,
        width: d.width != null ? (layout.width > 0 ? layout.width : d.width) : null,
        height: d.height != null ? (layout.height > 0 ? layout.height : d.height) : null,
        layoutIsland: layout.layoutIsland ?? d.layoutIsland,
        childUpdates: d.childUpdates ?? [],
        zIndex: d.zIndex
      })
    }
    // Capture an in-flight first move/resize: a `moved` whose async `ensureAnchoredAnchor`
    // is still straddling the save has not upserted a dragEdit yet, so the loop
    // above skipped it. If the currently selected element has actually moved from
    // its selection-time position or size, read its current DOM layout and persist it now
    // (mirroring what that late `moved` would have produced). Without this, an
    // empty save + refresh would silently drop the edit. The stale `moved` itself
    // is dropped by the PreviewIframe page-instance guard after the refresh.
    const selection = get().selection
    if (
      selection?.selector &&
      selection.snapshot &&
      !covered.has(selection.selector) &&
      !deletedSelectors.has(selection.selector)
    ) {
      const layout = await iframe.readElementLayout(selection.selector)
      if (layout) {
        const base = selection.snapshot.metrics.page
        const movedX = Math.abs((layout.visualX ?? 0) - base.x)
        const movedY = Math.abs((layout.visualY ?? 0) - base.y)
        const resizedWidth = layout.width > 0 && Math.abs(layout.width - base.width) >= 0.5
        const resizedHeight = layout.height > 0 && Math.abs(layout.height - base.height) >= 0.5
        const resized = resizedWidth || resizedHeight
        if (movedX >= 0.5 || movedY >= 0.5 || resized) {
          const draftZIndex = parseInt(get().draft.layoutZIndex, 10)
          editHistory.upsertDragEdit({
            pageId: pc.pageId,
            htmlPath: pc.htmlPath,
            selector: selection.selector,
            x: layout.x,
            y: layout.y,
            isAbsoluteMode: layout.isAbsoluteMode,
            width: resized && layout.width > 0 ? layout.width : null,
            height: resized && layout.height > 0 ? layout.height : null,
            layoutIsland: layout.layoutIsland,
            childUpdates: [],
            zIndex: Number.isFinite(draftZIndex) ? draftZIndex : undefined
          })
        }
      }
    }
  },

  save: async () => {
    if (get().isSavingEdits) return { saved: false }
    const ctx = get().ctx
    const iframe = get().iframeHandle
    const pc = ctx?.getPageContext()
    if (!ctx || !pc) return { saved: false }
    set({ isSavingEdits: true })
    try {
      get().commitCurrentDraft()
      await get().flushPendingDrags()
      const editHistory = useHtmlEditHistoryStore.getState()
      const snapshot = editHistory.getSnapshotForPage(pc.pageId)
      const hasEdits =
        snapshot.dragEdits.length > 0 ||
        snapshot.textEdits.length > 0 ||
        snapshot.propertyEdits.length > 0 ||
        snapshot.deletes.length > 0 ||
        snapshot.addElements.length > 0
      if (!hasEdits) {
        iframe?.clearEditModeSelection()
        set({ selection: null, draft: EMPTY_ELEMENT_DRAFT })
        useHtmlEditorUiStore.getState().clearEditSelectedElement()
        ctx.requestRefresh()
        return { saved: false }
      }

      const filledAddElements = await Promise.all(
        snapshot.addElements.map(async (el) => {
          if (el.htmlFragment) return el
          const selector = el.assignedBlockId
            ? `body[data-page-id="${el.pageId}"] [data-block-id="${el.assignedBlockId}"]`
            : ''
          if (!selector || !iframe) return el
          try {
            const html = await iframe.readElementHtml?.(selector)
            return html ? { ...el, htmlFragment: html } : el
          } catch {
            return el
          }
        })
      )
      const isDeletedTarget = (selector: string, blockId?: string): boolean =>
        snapshot.deletes.some((d) =>
          editTargetMatchesDeletedSelector(selector, d.selector, blockId)
        )
      const safeDragEdits = snapshot.dragEdits.filter((e) => !isDeletedTarget(e.selector))
      const safeTextEdits = snapshot.textEdits.filter((e) => !isDeletedTarget(e.selector))
      const safePropertyEdits = snapshot.propertyEdits.filter(
        (e) => !isDeletedTarget(e.selector, e.blockId)
      )
      const currentHtml = useHtmlEditorStore.getState().html
      const { html: nextHtml } = await ipc.applyHtmlEdits({
        html: currentHtml,
        pageId: pc.pageId,
        dragEdits: safeDragEdits,
        textEdits: safeTextEdits,
        propertyEdits: safePropertyEdits,
        deletes: snapshot.deletes,
        addElements: filledAddElements
      })
      useHtmlEditorStore.getState().setHtml(nextHtml)
      useHtmlEditHistoryStore.getState().markPageSaved(pc.pageId)
      iframe?.clearEditModeSelection()
      set({ selection: null, draft: EMPTY_ELEMENT_DRAFT })
      useHtmlEditorUiStore.getState().clearEditSelectedElement()
      ctx.bumpThumbnail(pc.pageId)
      ctx.requestRefresh()
      const totalCount =
        safeDragEdits.length +
        safeTextEdits.length +
        safePropertyEdits.length +
        snapshot.deletes.length +
        filledAddElements.length
      useToastStore
        .getState()
        .success(ctx.t('sessionDetail.adjustmentsSaved', { count: totalCount }))
      return { saved: true }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : ctx.t('sessionDetail.layoutSaveFailed')
      useToastStore.getState().error(message)
      return { saved: false, error: message }
    } finally {
      set({ isSavingEdits: false })
    }
  }
}))
