import type { LayoutIntent } from './layout-intent'

/** A generated slide's semantic plan, shared by planning, generation, and page tools. */
export interface OutlineItem {
  title: string
  contentOutline: string
  layoutIntent?: LayoutIntent
  /** M3a resolves a session layout master into a flexible generation constraint. */
  layoutId?: string
  layoutPrompt?: string
}

/** Deck-level visual rules persisted with a session and applied to every generated page. */
export interface DesignContract {
  theme: string
  background: string
  palette: string[]
  titleStyle: string
  layoutMotif: string
  chartStyle: string
  shapeLanguage: string
  titleFont: string
  bodyFont: string
}

export type DeckEditScope = 'page' | 'deck' | 'presentation-container'

export interface UploadedAsset {
  id: string
  fileName: string
  originalName: string
  relativePath: string
  absolutePath?: string
  mimeType: string
  size: number
  createdAt: number
}

export interface ParseDocumentPlanPayload {
  files: Array<{
    path: string
    name?: string
  }>
  modelConfigId?: string
  topic?: string
  existingBrief?: string
}

export interface SourceDocumentPlan {
  version: 1
  confidence: 'high' | 'medium' | 'low'
  sourceDocumentPath?: string
  sourceDocumentName?: string
  pageSkeleton: DocumentPlanPageSkeletonItem[]
}

export interface PrepareReferenceDocumentPayload {
  files: Array<{
    path: string
    name?: string
  }>
}

export interface ParseImageReferencePayload {
  file: {
    path: string
    name?: string
  }
  modelConfigId?: string
}

export interface ParsedDocumentPlanResult {
  topic: string
  pageCount: number
  briefText: string
  pageSkeleton?: DocumentPlanPageSkeletonItem[]
  sourcePlan?: SourceDocumentPlan
  files: Array<{
    name: string
    type: 'markdown' | 'text' | 'csv' | 'docx' | 'image'
    characterCount: number
    path: string
  }>
}

export interface DocumentPlanPageSkeletonItem {
  id?: string
  pageNumber: number
  title: string
  role: 'chapter-divider' | 'content'
  sourceHeading: string
  headingLevel: number
  lineStart: number
  lineEnd: number
  reason: string
  agendaItems?: DocumentPlanAgendaItem[]
}

export interface DocumentPlanAgendaItem {
  title: string
  lineStart: number
}

export interface PageReferenceContext {
  referenceDocumentPath: string
  sourceHeading: string
  sourceRange: {
    lineStart: number
    lineEnd: number
  }
  agendaItems?: DocumentPlanAgendaItem[]
  isSectionAgenda: boolean
}

export const SECTION_AGENDA_OUTLINE_MARKER = 'Page role: section-agenda'
export const SECTION_AGENDA_REASON_PREFIX_ZH = '章节目录页'
export const SECTION_AGENDA_REASON_PREFIX_EN = 'Section agenda page'

export const isSectionAgendaReason = (reason: string): boolean =>
  new RegExp(
    `^(?:${SECTION_AGENDA_REASON_PREFIX_ZH}|${SECTION_AGENDA_REASON_PREFIX_EN})\\s*[:：]`,
    'i'
  ).test(reason.trim())

export const isSectionAgendaOutline = (outline: string): boolean =>
  /Page role:\s*section-agenda/i.test(outline)

export const isInternalDocumentPlanPageReason = (reason: string): boolean => {
  const normalized = reason.toLowerCase()
  return (
    normalized.includes('major # heading') ||
    normalized.includes('leaf ## section') ||
    normalized.includes('top-level ## section') ||
    normalized.includes('standalone level-') ||
    normalized.includes('section has substantial own body')
  )
}

export interface PreparedReferenceDocumentResult {
  files: ParsedDocumentPlanResult['files']
}

export interface PptxImportPayload {
  filePath: string
  title?: string
  styleId?: string | null
  modelConfigId?: string
}

export interface PptxImportProgressPayload {
  sessionId?: string
  stage: 'reading' | 'parsing' | 'media' | 'pages' | 'index' | 'database' | 'completed'
  progress: number
  label: string
  pageNumber?: number
  totalPages?: number
}

export interface PptxImportResult {
  sessionId: string
  pageCount: number
  warnings: string[]
}

export interface FontRef {
  source: 'google' | 'uploaded'
  family: string
  id?: string
}

export type FontSelection =
  | { mode: 'auto' }
  | {
      mode: 'pair'
      title: FontRef
      body: FontRef
    }

export const normalizeFontSelection = (value: unknown): FontSelection => {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  if (record.mode !== 'pair') return { mode: 'auto' }
  const title =
    record.title && typeof record.title === 'object'
      ? (record.title as Record<string, unknown>)
      : {}
  const body =
    record.body && typeof record.body === 'object' ? (record.body as Record<string, unknown>) : {}
  const titleFamily = typeof title.family === 'string' ? title.family.trim() : ''
  const bodyFamily = typeof body.family === 'string' ? body.family.trim() : ''
  if (!titleFamily || !bodyFamily) return { mode: 'auto' }
  const titleSource = title.source === 'uploaded' ? 'uploaded' : 'google'
  const bodySource = body.source === 'uploaded' ? 'uploaded' : 'google'
  return {
    mode: 'pair',
    title: {
      source: titleSource,
      family: titleFamily,
      id: typeof title.id === 'string' ? title.id : undefined
    },
    body: {
      source: bodySource,
      family: bodyFamily,
      id: typeof body.id === 'string' ? body.id : undefined
    }
  }
}

/**
 * A bounded, read-only snapshot of the element that initiated a selector-scoped AI edit.
 *
 * The renderer reads this from the live preview; the main process normalizes it again before
 * it reaches an agent prompt. It deliberately excludes HTML, event handlers, and editor-only
 * markers so it remains context rather than an alternate document-editing channel.
 */
export interface SelectedElementRuntimeContext {
  classList?: string[]
  attributes?: Record<string, string>
  inlineStyle?: Record<string, { value: string; priority?: '' | 'important' }>
  computedStyle?: Record<string, string>
  bounds?: { x: number; y: number; width: number; height: number }
}

/**
 * The renderer samples only these computed properties and the main process accepts only these
 * keys from IPC. Keep the list shared so the two trust-boundary checks cannot drift.
 */
export const SELECTED_ELEMENT_CONTEXT_COMPUTED_STYLE_PROPERTIES = [
  'display',
  'position',
  'box-sizing',
  'left',
  'top',
  'right',
  'bottom',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'margin',
  'padding',
  'gap',
  'z-index',
  'opacity',
  'visibility',
  'overflow',
  'transform',
  'transform-origin',
  'color',
  'background-color',
  'background-image',
  'border',
  'border-radius',
  'box-shadow',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'text-align',
  'white-space',
  'flex',
  'flex-direction',
  'align-items',
  'justify-content',
  'grid-template-columns',
  'grid-template-rows',
  'object-fit',
  'object-position'
] as const

export interface GenerateStartPayload {
  sessionId: string
  modelConfigId?: string
  userMessage: string
  type?: 'deck' | 'page'
  chatType?: 'main' | 'page'
  resetVisualStyle?: boolean
  persistUserMessage?: boolean
  /** Renderer-generated ID so an optimistic chat message is reconciled with its DB record. */
  clientMessageId?: string
  chatPageId?: string
  selectPageIds?: string[]
  selectedPageId?: string
  htmlPath?: string
  selector?: string
  elementTag?: string
  elementText?: string
  selectedElementContext?: SelectedElementRuntimeContext
  imagePaths?: string[]
  videoPaths?: string[]
  docPaths?: string[]
  animationPreferences?: AnimationPreferencesPayload
  autoApply?: boolean
  approvedPlan?: SessionPageEditPlan
}

export const SESSION_PAGE_EDIT_INTENTS = [
  'content',
  'style',
  'layout',
  'redesign',
  'other'
] as const

export type SessionPageEditIntent = (typeof SESSION_PAGE_EDIT_INTENTS)[number]

export interface SessionPageEditPlan {
  intent: SessionPageEditIntent
  target: string
  summary: string
  changes: string[]
  confirmationQuestion: string
}

export interface SessionPageEditAssessment {
  plan: SessionPageEditPlan
  requiresConfirmation: boolean
}

export const normalizeSessionPageEditPlan = (value: unknown): SessionPageEditPlan | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const intent = SESSION_PAGE_EDIT_INTENTS.includes(record.intent as SessionPageEditIntent)
    ? (record.intent as SessionPageEditIntent)
    : undefined
  const target = typeof record.target === 'string' ? record.target.trim().slice(0, 500) : ''
  const summary = typeof record.summary === 'string' ? record.summary.trim().slice(0, 1500) : ''
  const changes = Array.isArray(record.changes)
    ? record.changes
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8)
    : []
  const confirmationQuestion =
    typeof record.confirmationQuestion === 'string'
      ? record.confirmationQuestion.trim().slice(0, 300)
      : ''
  if (!intent || !target || !summary || changes.length === 0 || !confirmationQuestion)
    return undefined
  return { intent, target, summary, changes, confirmationQuestion }
}

export interface SwitchSessionStylePayload {
  sessionId: string
  styleId: string
  modelConfigId?: string
}

export type RetrySessionStylePayload = SwitchSessionStylePayload & {
  failedRunId?: string
}

export type RetryDeckEditPayload = GenerateStartPayload & {
  failedRunId?: string
}

export const MAX_SELECTED_PAGES = 50
export const MAX_STYLE_SWITCH_PAGES = 500

export const normalizeSelectPageIds = (value: unknown, limit = MAX_SELECTED_PAGES): string[] => {
  if (!Array.isArray(value)) return []
  const normalized = Array.from(
    new Set(
      value.map((item) => String(item || '').trim()).filter((item) => /^[a-z0-9_-]+$/i.test(item))
    )
  )
  if (normalized.length > limit) {
    throw new Error(`一次最多选择 ${limit} 页`)
  }
  return normalized
}

export interface GenerateRetryFailedPayload {
  sessionId: string
  modelConfigId?: string
  userMessage?: string
  failedRunId?: string
}

export type AnimationPreferenceId =
  | 'fade'
  | 'fade-up'
  | 'fade-down'
  | 'fade-left'
  | 'fade-right'
  | 'scale-in'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'fly-in'
  | 'wipe'
  | 'zoom-in'
  | 'spin-in'
  | 'pulse-soft'
  | 'pulse'
  | 'pulse-strong'
  | 'grow-shrink-soft'
  | 'grow-shrink'
  | 'grow-shrink-strong'

export interface AnimationPreferencesPayload {
  ids: AnimationPreferenceId[]
}

const ANIMATION_PREFERENCE_IDS = new Set<AnimationPreferenceId>([
  'fade',
  'fade-up',
  'fade-down',
  'fade-left',
  'fade-right',
  'scale-in',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'fly-in',
  'wipe',
  'zoom-in',
  'spin-in',
  'pulse-soft',
  'pulse',
  'pulse-strong',
  'grow-shrink-soft',
  'grow-shrink',
  'grow-shrink-strong'
])

export const normalizeAnimationPreferences = (
  value: unknown
): AnimationPreferencesPayload | null => {
  const rawIds = Array.isArray((value as AnimationPreferencesPayload | null)?.ids)
    ? (value as AnimationPreferencesPayload).ids
    : Array.isArray(value)
      ? value
      : []
  const ids = Array.from(
    new Set(
      rawIds
        .map((item) => String(item || '').trim())
        .filter((item): item is AnimationPreferenceId =>
          ANIMATION_PREFERENCE_IDS.has(item as AnimationPreferenceId)
        )
    )
  )
  const selected = ids.slice(0, 3)
  return selected.length > 0 ? { ids: selected } : null
}

export type AnimationPreferenceSourceRun = {
  session_id: string
  animation_preferences: string | null
}

/**
 * Inherit animation preferences from a prior generation run — but only when an
 * explicit source run is supplied AND it belongs to the same session. A missing
 * or stale source run must never block retry; degrade to no preferences.
 * See docs/design/session-create-animation-preferences-design.md (run 字段持久化).
 */
export const resolveInheritedAnimationPreferences = (
  sourceRun: AnimationPreferenceSourceRun | null | undefined,
  sessionId: string
): AnimationPreferencesPayload | null => {
  if (!sourceRun || sourceRun.session_id !== sessionId) return null
  try {
    return normalizeAnimationPreferences(
      sourceRun.animation_preferences ? JSON.parse(sourceRun.animation_preferences) : null
    )
  } catch {
    return null
  }
}

export interface GenerateAddPagePayload {
  sessionId: string
  modelConfigId?: string
  userMessage: string
  insertAfterPageNumber: number
  targetPageId?: string
}

export interface GenerateRetrySinglePagePayload {
  sessionId: string
  modelConfigId?: string
  pageId: string
}

export interface GeneratedPagePayload {
  id?: string
  focusPage?: boolean
  pageNumber: number
  title: string
  contentOutline?: string | null
  html: string
  htmlPath?: string
  pageId?: string
  sourceUrl?: string
  pageCommitReady?: boolean
}

export interface PageStatusPayload {
  id?: string
  pageNumber: number
  title: string
  pageId?: string
  htmlPath?: string
  error?: string
}

export interface GenerateStagePayload {
  runId: string
  sessionId?: string
  stage: string
  label: string
  progress?: number
  currentPage?: number
  totalPages?: number
  completedPageCount?: number
  failedPageCount?: number
  timestamp?: string
  activityKind?:
    | 'page-edit'
    | 'deck-edit'
    | 'edit'
    | 'style-switch'
    | 'single-page-retry'
    | 'addPage'
}

export type GenerateChunkEvent =
  | {
      type: 'stage_started' | 'stage_progress'
      payload: GenerateStagePayload
    }
  | {
      type: 'llm_status'
      payload: GenerateStagePayload & {
        provider?: string
        model?: string
        detail?: string
      }
    }
  | {
      type: 'assistant_message'
      payload: {
        id?: string
        runId: string
        sessionId?: string
        content: string
        chatType?: 'main' | 'page'
        pageId?: string
        timestamp?: string
        activityKind?:
          | 'page-edit'
          | 'deck-edit'
          | 'edit'
          | 'style-switch'
          | 'single-page-retry'
          | 'addPage'
      }
    }
  | {
      type: 'page_generated'
      payload: GenerateStagePayload & GeneratedPagePayload
    }
  | {
      type: 'page_updated'
      payload: GenerateStagePayload & GeneratedPagePayload
    }
  | {
      type: 'page_planned'
      payload: GenerateStagePayload & PageStatusPayload
    }
  | {
      type: 'page_started' | 'page_failed'
      payload: GenerateStagePayload & PageStatusPayload
    }
  | {
      type: 'run_completed'
      payload: {
        runId: string
        sessionId?: string
        totalPages: number
        completedPageCount?: number
        failedPageCount?: number
        timestamp?: string
        outcome?: 'changed' | 'unchanged'
        activityKind?:
          | 'page-edit'
          | 'deck-edit'
          | 'edit'
          | 'style-switch'
          | 'single-page-retry'
          | 'addPage'
      }
    }
  | {
      type: 'run_error'
      payload: {
        runId: string
        sessionId?: string
        message: string
        cancelled?: boolean
        completedPageCount?: number
        failedPageCount?: number
        timestamp?: string
        activityKind?:
          | 'page-edit'
          | 'deck-edit'
          | 'edit'
          | 'style-switch'
          | 'single-page-retry'
          | 'addPage'
      }
    }
