import type {
  FontSelection,
  GenerateAddPagePayload,
  GenerateChunkEvent,
  GenerateRetryFailedPayload,
  GenerateRetrySinglePagePayload,
  GenerateStartPayload,
  SessionPageEditAssessment,
  ParseDocumentPlanPayload,
  ParseImageReferencePayload,
  ParsedDocumentPlanResult,
  PrepareReferenceDocumentPayload,
  PreparedReferenceDocumentResult,
  SourceDocumentPlan,
  SwitchSessionStylePayload,
  RetrySessionStylePayload,
  RetryDeckEditPayload,
  PptxImportPayload,
  PptxImportProgressPayload,
  PptxImportResult,
  UploadedAsset
} from '@shared/generation.js'
import type { UpdateAvailablePayload } from '@shared/app-update.js'
import type { SpeechConfig } from '@shared/speech'
import type { HistoryVersion, RollbackHistoryResult } from '@shared/history.js'
import type { HtmlThumbnailResourceType } from '@shared/thumbnail'
import type { IndexTransitionConfig, IndexTransitionType } from '@shared/index-transition.js'
import type { ElementAnimationConfig, ElementAnimationPatch } from '@shared/element-animation.js'
import type {
  ThinkingStage,
  ThinkingChatMessage,
  ThinkingWorkspace,
  ThinkingChatResult,
  ThinkingPrepareGenerationResult,
  ThinkingWorkspaceListItem
} from '@shared/thinking.js'
import type {
  GeneratedImageAsset,
  ImageGenerateResult,
  ImageGeneratePayload,
  ImagePromptGeneratePayload,
  ImagePromptGenerateResult,
  ImageGenerationHistoryRecord,
  ImageModelConfig,
  ImageModelProvider
} from '@shared/image-generation.js'
import type { ThinkingParameterMode } from '@shared/model-config.js'
import type { ExportProgressPayload } from '@shared/export-progress.js'
import type { PageMergeDisabledReason } from '@shared/page-merge'
import type { ModelUsagePeriod, ModelUsageStats } from '@shared/model-usage'
import type { SlideSizePresetId } from '@shared/slide-size'
import type { ParsedChartDataResult } from '@shared/chart-data'
import type { SessionMasterConfig, SessionMasterStatus } from '@shared/master'
import type { SessionLayoutLibrary, SessionLayoutLibraryStatus } from '@shared/layout-master'

type IpcRendererLike = Window['electron']['ipcRenderer']

function getIpc(): IpcRendererLike {
  const ipc = window.electron?.ipcRenderer
  if (!ipc) {
    const electronKeys = window.electron ? Object.keys(window.electron).join(', ') : 'none'
    throw new Error(`Electron preload IPC is unavailable. window.electron keys: ${electronKeys}`)
  }
  return ipc
}

export interface StyleCategory {
  name: string
  styles: Array<{
    id: string
    label: string
    description: string
    source?: 'builtin' | 'custom' | 'override'
    editable?: boolean
    styleCase?: string
  }>
}

export interface StyleDetail {
  id: string
  styleKey?: string
  label: string
  name?: {
    zh: string
    en: string
  }
  description: string
  aliases: string[]
  styleSkill: string
  source?: 'builtin' | 'custom' | 'override'
  editable?: boolean
  category?: string
  version?: string
  styleCase?: string
  packageDir?: string
}

export interface StyleListItem {
  id: string
  styleKey?: string
  label: string
  name?: {
    zh: string
    en: string
  }
  description: string
  aliases?: string[]
  category: string
  source?: 'builtin' | 'custom' | 'override'
  editable?: boolean
  version?: string
  styleCase?: string
  packageDir?: string
  favoriteAt?: number | null
  previewPath?: string | null
  thumbnailPath?: string | null
  createdAt?: number
  updatedAt?: number
}

export interface HtmlThumbnailTask {
  resourceType: HtmlThumbnailResourceType
  resourceId: string
  variant: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  thumbnailPath: string | null
  error?: string
}

export interface StyleParseResult {
  label: string
  description: string
  category: string
  aliases: string[]
  styleSkill: string
  styleCase?: string
}

export interface GenerateRunStateSnapshot {
  sessionId: string
  runId: string | null
  status: 'idle' | 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  hasActiveRun: boolean
  progress: number
  totalPages: number
  completedPageCount?: number
  failedPageCount?: number
  events: GenerateChunkEvent[]
  error: string | null
  startedAt: number | null
  updatedAt: number | null
  kind?:
    | 'standard'
    | 'template'
    | 'retry'
    | 'add-page'
    | 'single-page-retry'
    | 'edit'
    | 'page-edit'
    | 'deck-edit'
    | 'style-switch'
    | 'page-beautify'
  targetPageId?: string
  targetPageNumber?: number
  activityKind?:
    | 'page-edit'
    | 'deck-edit'
    | 'edit'
    | 'style-switch'
    | 'page-beautify'
    | 'single-page-retry'
    | 'addPage'
  retryPayload?: GenerateStartPayload
}

export interface StyleSwitchJobSnapshot {
  sessionId: string
  runId: string | null
  status: 'idle' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled'
  hasActiveRun: boolean
  progress: number
  totalPages: number
  completedPageCount: number
  failedPageCount: number
  targetStyleId: string | null
  targetStyleName: string | null
  pages: Array<{
    pageId: string
    pageNumber: number
    title: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    error: string | null
    retryCount: number
  }>
  error: string | null
  startedAt: number | null
  updatedAt: number | null
  kind: 'style-switch'
}

export interface ExportDeckResult {
  success: boolean
  cancelled?: boolean
  path?: string
  warnings?: string[]
  pageCount?: number
  durationMs?: number
  frameCount?: number
}

export interface MergeSourceSessionSummary {
  id: string
  title: string
  pageCount: number
  slideSizeId: SlideSizePresetId
  slideWidth: number
  slideHeight: number
  updatedAt: number
  status: string
  selectable: boolean
  disabledReason?: PageMergeDisabledReason
}

export interface MergeTemplateSourceSummary {
  id: string
  title: string
  pageCount: number
  slideSizeId: SlideSizePresetId
  slideWidth: number
  slideHeight: number
  updatedAt: number
  thumbnailPath: string | null
  selectable: boolean
  disabledReason?: PageMergeDisabledReason
  isSource: boolean
}

export interface MergeSourcePageSummary {
  id: string
  pageId: string
  pageNumber: number
  title: string
  contentOutline?: string | null
  slideSizeId: SlideSizePresetId
  slideWidth: number
  slideHeight: number
  htmlPath?: string
  sourceUrl?: string
  status?: string
  selectable: boolean
  disabledReason?: PageMergeDisabledReason
}

export interface ImportSessionFileResult {
  success: boolean
  cancelled?: boolean
  sessionId?: string
  title?: string
  pageCount?: number
  warnings?: string[]
}

export interface HtmlEditorImportResult {
  docId: string
  title: string
  htmlPath: string
  sourcePath: string
  designWidth: number
  html: string
}

export interface HtmlEditorAiMessage {
  role: 'user' | 'assistant'
  content: string
  selectedElement?: HtmlEditorAiElementContext
}

export interface HtmlEditorAiElementContext {
  selector: string
  label?: string
  elementTag?: string
  elementText?: string
  html?: string
}

export interface HtmlEditorAiEditBatch {
  propertyEdits: Array<Record<string, unknown>>
  textEdits: Array<Record<string, unknown>>
  dragEdits: Array<Record<string, unknown>>
  deletes: Array<Record<string, unknown>>
  addElements: Array<Record<string, unknown>>
}

export type HtmlEditorAiIntent = 'inspect' | 'redesign' | 'style' | 'layout' | 'content' | 'other'

export interface HtmlEditorAiPlan {
  intent: HtmlEditorAiIntent
  target: string
  summary: string
  changes: string[]
  confirmationQuestion: string
  edits: HtmlEditorAiEditBatch
}

export interface HtmlEditorAiHistoryMessage extends HtmlEditorAiMessage {
  id: string
  createdAt: number
  intent?: HtmlEditorAiIntent
  plan?: HtmlEditorAiPlan | null
  requiresConfirmation?: boolean
}

export type HtmlEditorFileImportResult =
  | { cancelled: true; reason?: 'user-cancelled' | 'storage-not-configured' }
  | ({ cancelled: false } & HtmlEditorImportResult)

export interface TemplateListItem {
  id: string
  name: string
  description: string
  source: 'user'
  pageCount: number
  tags: string[]
  slideSizeId?: import('@shared/slide-size').SlideSizePresetId
  slideWidth?: number
  slideHeight?: number
  previewHtmlPath: string | null
  thumbnailPath: string | null
  previewPages: Array<{
    pageNumber: number
    pageId: string
    title: string
    htmlPath: string
  }>
  createdAt: number
  updatedAt: number
}

export interface EnsureElementAnchorPayload {
  sessionId?: string
  htmlPath: string
  pageId: string
  selector: string
  elementTag?: string
  elementText?: string
  reason?: 'inspect' | 'drag' | 'text-edit'
  formula?: {
    latex: string
    html: string
    displayMode: boolean
  }
}

export interface EnsureElementAnchorResult {
  success: boolean
  selector: string
  blockId: string
  changed: boolean
}

export interface UploadAssetsPayload {
  sessionId: string
  files: Array<{
    path: string
    name?: string
  }>
}

export interface UpdateElementLayoutPayload {
  sessionId: string
  htmlPath: string
  pageId: string
  selector: string
  x: number
  y: number
  width?: number
  height?: number
  childUpdates?: Array<{
    path: number[]
    width?: number
    height?: number
  }>
  isAbsoluteMode?: boolean
}

export interface UpdateElementPropertiesPayload {
  sessionId: string
  htmlPath: string
  pageId: string
  selector: string
  patch: {
    html?: string
    text?: string
    textTarget?: {
      type: 'text-node'
      parentSelector: string
      textNodeIndex: number
      text: string
    }
    style?: {
      color?: string
      fontSize?: string
      fontWeight?: string
      textAlign?: string
    }
  }
}

export interface CreateSessionPayload {
  topic: string
  styleId: string
  modelConfigId?: string
  pageCount?: number
  slideSizeId?: import('@shared/slide-size').SlideSizePresetId
  referenceDocumentPath?: string
  fontSelection?: FontSelection
  sourcePlan?: SourceDocumentPlan
}

export interface SaveSessionAsNewPayload {
  sessionId: string
  title: string
}

export interface SaveSessionAsNewResult {
  sessionId: string
}

export interface ModelConfig {
  id: string
  name: string
  provider: 'anthropic' | 'openai' | 'openai-responses' | 'orcarouter' | 'google'
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: number
  disableTemperature: boolean
  thinkingParameterMode: ThinkingParameterMode
  active: boolean
  createdAt: number
  updatedAt: number
}

export type { GeneratedImageAsset, ImageModelConfig, ImageModelProvider }

export interface UploadPrerequisitesResult {
  ready: boolean
  missing: Array<'storagePath' | 'activeModel' | 'apiKey' | 'model'>
  message?: string
}

export type FontRole = 'title' | 'body'
export type FontScript = 'latin' | 'cjk'

export interface FontFileEntry {
  file: string
  weight: number
  style: 'normal' | 'italic'
  size?: number
  sha256?: string
}

export interface FontListItem {
  id: string
  family: string
  source: 'google' | 'uploaded'
  category: string
  role: FontRole[]
  scripts: FontScript[]
  files?: FontFileEntry[]
  createdAt?: number
  updatedAt?: number
}

export interface FontRegistryResponse {
  googleFonts: FontListItem[]
  userFonts: FontListItem[]
}

export interface UploadFontPayload {
  files: Array<{
    path: string
    weight?: number
    style?: 'normal' | 'italic'
  }>
  family: string
  category?: string
  role?: FontRole[]
  scripts?: FontScript[]
}

export const ipc = {
  createSession: (payload: CreateSessionPayload) =>
    getIpc().invoke('session:create', payload) as Promise<{ sessionId: string }>,
  listSessions: () => getIpc().invoke('session:list') as Promise<unknown[]>,
  listMergeSourceSessions: (payload: { targetSessionId: string }) =>
    getIpc().invoke('session:listMergeSources', payload) as Promise<MergeSourceSessionSummary[]>,
  listMergeSourcePages: (payload: { targetSessionId: string; sourceSessionId: string }) =>
    getIpc().invoke('session:listMergeSourcePages', payload) as Promise<MergeSourcePageSummary[]>,
  mergeSessionPages: (payload: {
    targetSessionId: string
    sourceSessionId: string
    sourcePageIds: string[]
  }) =>
    getIpc().invoke('session:mergePages', payload) as Promise<{
      ok: true
      generatedPages: Array<{
        id: string
        pageNumber: number
        pageId: string
        title: string
        contentOutline?: string | null
        html: string
        htmlPath: string
        sourceUrl?: string
        status?: string
        error?: string | null
      }>
      insertedPageIds: string[]
      selectedPageId: string
    }>,
  listMergeSourceTemplates: (payload: { targetSessionId: string }) =>
    getIpc().invoke('session:listMergeSourceTemplates', payload) as Promise<
      MergeTemplateSourceSummary[]
    >,
  listMergeSourceTemplatePages: (payload: { targetSessionId: string; templateId: string }) =>
    getIpc().invoke('session:listMergeSourcePages', {
      targetSessionId: payload.targetSessionId,
      sourceType: 'template',
      templateId: payload.templateId
    }) as Promise<MergeSourcePageSummary[]>,
  mergeTemplatePages: (payload: {
    targetSessionId: string
    templateId: string
    sourcePageIds: string[]
  }) =>
    getIpc().invoke('session:mergePages', {
      targetSessionId: payload.targetSessionId,
      sourceType: 'template',
      templateId: payload.templateId,
      sourcePageIds: payload.sourcePageIds
    }) as Promise<{
      ok: true
      generatedPages: Array<{
        id: string
        pageNumber: number
        pageId: string
        title: string
        contentOutline?: string | null
        html: string
        htmlPath: string
        sourceUrl?: string
        status?: string
        error?: string | null
      }>
      insertedPageIds: string[]
      selectedPageId: string
    }>,
  saveSessionAsNew: (payload: SaveSessionAsNewPayload): Promise<SaveSessionAsNewResult> =>
    getIpc().invoke('session:saveAsNew', payload) as Promise<SaveSessionAsNewResult>,
  getSessionMaster: (payload: { sessionId: string }): Promise<SessionMasterStatus> =>
    getIpc().invoke('session:getMaster', payload) as Promise<SessionMasterStatus>,
  saveSessionMaster: (payload: {
    sessionId: string
    config: SessionMasterConfig
  }): Promise<SessionMasterStatus> =>
    getIpc().invoke('session:saveMaster', payload) as Promise<SessionMasterStatus>,
  setSessionMasterPageOverride: (payload: {
    sessionId: string
    pageId: string
    disabled: boolean
  }): Promise<{ disabled: boolean }> =>
    getIpc().invoke('session:setMasterPageOverride', payload) as Promise<{ disabled: boolean }>,
  getSessionLayoutLibrary: (payload: { sessionId: string }): Promise<SessionLayoutLibraryStatus> =>
    getIpc().invoke('session:getLayoutLibrary', payload) as Promise<SessionLayoutLibraryStatus>,
  saveSessionLayoutLibrary: (payload: {
    sessionId: string
    library: SessionLayoutLibrary
  }): Promise<SessionLayoutLibraryStatus> =>
    getIpc().invoke('session:saveLayoutLibrary', payload) as Promise<SessionLayoutLibraryStatus>,
  getSession: (sessionId: string) =>
    getIpc().invoke('session:get', sessionId) as Promise<{
      session: unknown
      messages: unknown[]
      generatedPages: Array<{
        id: string
        pageNumber: number
        title: string
        contentOutline?: string | null
        html: string
        htmlPath?: string
        pageId?: string
        sourceUrl?: string
        status?: string
        error?: string | null
      }>
    }>,
  getIndexTransition: (sessionId: string) =>
    getIpc().invoke('session:getIndexTransition', { sessionId }) as Promise<IndexTransitionConfig>,
  setIndexTransition: (payload: {
    sessionId: string
    type: IndexTransitionType
    durationMs?: number
  }) =>
    getIpc().invoke('session:setIndexTransition', payload) as Promise<{
      ok: boolean
      transition: IndexTransitionConfig
    }>,
  migratePageOutlinesToSourceSkeletons: (payload: { sessionId: string }) =>
    getIpc().invoke('session:migratePageOutlinesToSourceSkeletons', payload) as Promise<{
      migrated: boolean
      migratedCount: number
      existingCount: number
    }>,
  reorderSessionPages: (payload: {
    sessionId: string
    orderedPageIds: string[]
    selectedPageId?: string
  }) =>
    getIpc().invoke('session:reorderPages', payload) as Promise<{
      ok: boolean
      generatedPages: Array<{
        id: string
        pageNumber: number
        pageId: string
        title: string
        contentOutline?: string | null
        html: string
        htmlPath?: string
        status?: string
        error?: string | null
      }>
      selectedPageId: string | null
    }>,
  deleteSessionPages: (payload: {
    sessionId: string
    pageIds: string[]
    selectedPageId?: string
  }) =>
    getIpc().invoke('session:deletePages', payload) as Promise<{
      ok: boolean
      generatedPages: Array<{
        id: string
        pageNumber: number
        pageId: string
        title: string
        contentOutline?: string | null
        html: string
        htmlPath?: string
        status?: string
        error?: string | null
      }>
      selectedPageId: string | null
    }>,
  createBlankSessionPage: (payload: { sessionId: string; sourcePageId: string }) =>
    getIpc().invoke('session:createBlankPage', payload) as Promise<{
      ok: boolean
      generatedPages: Array<{
        id: string
        pageNumber: number
        pageId: string
        title: string
        contentOutline?: string | null
        html: string
        htmlPath?: string
        status?: string
        error?: string | null
      }>
      selectedPageId: string | null
    }>,
  duplicateSessionPage: (payload: { sessionId: string; sourcePageId: string }) =>
    getIpc().invoke('session:duplicatePage', payload) as Promise<{
      ok: boolean
      generatedPages: Array<{
        id: string
        pageNumber: number
        pageId: string
        title: string
        contentOutline?: string | null
        html: string
        htmlPath?: string
        status?: string
        error?: string | null
      }>
      selectedPageId: string | null
    }>,
  updateSessionPageTitle: (payload: { sessionId: string; pageId: string; title: string }) =>
    getIpc().invoke('session:updatePageTitle', payload) as Promise<{
      ok: boolean
      generatedPages: Array<{
        id: string
        pageNumber: number
        pageId: string
        title: string
        contentOutline?: string | null
        html: string
        htmlPath?: string
        status?: string
        error?: string | null
      }>
      selectedPageId: string | null
    }>,
  updateSessionPageOutline: (payload: {
    sessionId: string
    pageId: string
    contentOutline: string
  }) =>
    getIpc().invoke('session:updatePageOutline', payload) as Promise<{
      ok: boolean
      generatedPages: Array<{
        id: string
        pageNumber: number
        pageId: string
        title: string
        contentOutline?: string | null
        html: string
        htmlPath?: string
        status?: string
        error?: string | null
      }>
      selectedPageId: string | null
    }>,
  getSessionMessages: (payload: {
    sessionId: string
    chatType: 'main' | 'page'
    pageId?: string
  }) => getIpc().invoke('session:getMessages', payload) as Promise<unknown[]>,
  deleteSession: (sessionId: string) =>
    getIpc().invoke('session:delete', sessionId) as Promise<{ success: boolean }>,
  updateSessionTitle: (payload: { sessionId: string; title: string }) =>
    getIpc().invoke('session:updateTitle', payload) as Promise<{ ok: boolean }>,
  importSessionFile: () =>
    getIpc().invoke('session:importFile') as Promise<ImportSessionFileResult>,
  importHtmlFile: () =>
    getIpc().invoke('html-editor:import') as Promise<HtmlEditorFileImportResult>,
  listHtmlEditorMedia: (payload: { docId: string; mediaType: 'image' | 'video' }) =>
    getIpc().invoke('html-editor:listMedia', payload) as Promise<{
      assets: Array<{ fileName: string; filePath: string; relativePath: string; url: string }>
    }>,
  chooseAndImportHtmlMedia: (payload: { docId: string; mediaType: 'image' | 'video' }) =>
    getIpc().invoke('html-editor:chooseAndImportMedia', payload) as Promise<
      | { cancelled: true }
      | { cancelled: false; filePath: string; relativePath: string; url: string }
    >,
  ensureHtmlAnchor: (payload: {
    html: string
    pageId: string
    selector: string
    elementTag?: string
    formula?: { latex?: unknown; html?: unknown; displayMode?: unknown }
  }) =>
    getIpc().invoke('html-editor:ensureAnchor', payload) as Promise<{
      html: string
      selector: string
      blockId: string
      changed: boolean
    }>,
  applyHtmlEdits: (payload: {
    html: string
    pageId: string
    dragEdits?: unknown[]
    textEdits?: unknown[]
    propertyEdits?: unknown[]
    deletes?: unknown[]
    addElements?: unknown[]
  }) =>
    getIpc().invoke('html-editor:applyEdits', payload) as Promise<{
      html: string
      warnings: string[]
    }>,
  exportHtml: (payload: { html: string; suggestedName?: string }) =>
    getIpc().invoke('html-editor:export', payload) as Promise<
      { cancelled: true } | { cancelled: false; path: string }
    >,
  cleanupHtmlEditor: (payload: { docId: string }) =>
    getIpc().invoke('html-editor:cleanup', payload) as Promise<{ ok: boolean }>,
  openHtmlInBrowser: (payload: { docId: string }) =>
    getIpc().invoke('html-editor:openInBrowser', payload) as Promise<{ ok: boolean }>,
  revealHtmlFile: (payload: { docId: string }) =>
    getIpc().invoke('html-editor:revealFile', payload) as Promise<{ ok: boolean }>,
  listHtmlVersions: (payload: { docId: string }) =>
    getIpc().invoke('html-editor:listVersions', payload) as Promise<{
      versions: Array<{ id: string; commitSha: string; message: string; createdAt: number }>
    }>,
  restoreHtmlVersion: (payload: { docId: string; versionId: string }) =>
    getIpc().invoke('html-editor:restoreVersion', payload) as Promise<{ html: string }>,
  listHtmlDocuments: () =>
    getIpc().invoke('html-editor:listDocuments') as Promise<{
      documents: Array<{
        id: string
        title: string
        sourcePath: string | null
        htmlPath: string
        designWidth: number
        updatedAt: number
        thumbnailPath: string | null
      }>
    }>,
  openHtmlDocument: (payload: { docId: string }) =>
    getIpc().invoke('html-editor:openDocument', payload) as Promise<HtmlEditorFileImportResult>,
  htmlEditorAiChat: (payload: {
    documentId: string
    documentTitle?: string
    pageHtml?: string
    selectedElement?: HtmlEditorAiElementContext
    recentMessages?: HtmlEditorAiMessage[]
    pendingPlan?: HtmlEditorAiPlan
    userMessage: string
    modelConfigId?: string
  }) =>
    getIpc().invoke('html-editor:aiChat', payload) as Promise<{
      reply: string
      model: string
      intent: HtmlEditorAiIntent
      plan: HtmlEditorAiPlan | null
      requiresConfirmation: boolean
      applied: boolean
      appliedHtml?: string
      warnings: string[]
    }>,
  listHtmlEditorMessages: (payload: { docId: string }) =>
    getIpc().invoke('html-editor:listMessages', payload) as Promise<{
      messages: HtmlEditorAiHistoryMessage[]
    }>,
  clearHtmlEditorMessages: (payload: { docId: string }) =>
    getIpc().invoke('html-editor:clearMessages', payload) as Promise<{ ok: boolean }>,
  listTemplates: () => getIpc().invoke('templates:list') as Promise<{ items: TemplateListItem[] }>,
  createTemplateFromSession: (payload: {
    sessionId: string
    name?: string
    description?: string
    tags?: string[]
  }) =>
    getIpc().invoke('templates:createFromSession', payload) as Promise<{
      success: true
      id: string
    }>,
  createSessionFromTemplate: (payload: {
    templateId: string
    title?: string
    modelConfigId?: string
    pageCount?: number
    referenceDocumentPath?: string
    sourcePlan?: SourceDocumentPlan
  }) =>
    getIpc().invoke('templates:createSession', payload) as Promise<{
      success: true
      sessionId: string
    }>,
  createEditableSessionFromTemplate: (payload: {
    templateId: string
    title?: string
    modelConfigId?: string
  }) =>
    getIpc().invoke('templates:createEditableSession', payload) as Promise<{
      success: true
      sessionId: string
    }>,
  importPptxAsTemplate: (payload: { filePath: string; name?: string; modelConfigId?: string }) =>
    getIpc().invoke('templates:importPptx', payload) as Promise<{
      success: true
      id: string
      pageCount: number
      warnings: string[]
    }>,
  updateTemplateMetadata: (payload: {
    templateId: string
    name: string
    description?: string
    tags?: string[]
  }) =>
    getIpc().invoke('templates:updateMetadata', payload) as Promise<{
      success: true
      item: TemplateListItem
    }>,
  deleteTemplate: (templateId: string) =>
    getIpc().invoke('templates:delete', templateId) as Promise<{
      success: true
      deleted: boolean
    }>,
  startGenerate: (payload: GenerateStartPayload) =>
    getIpc().invoke('generate:start', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
      queued?: boolean
    }>,
  assessPageEdit: (payload: GenerateStartPayload) =>
    getIpc().invoke('page-edit:assess', payload) as Promise<
      SessionPageEditAssessment & {
        reply: string
        targetPageId: string
        targetPageNumber?: number
      }
    >,
  startPageEdit: (payload: GenerateStartPayload) =>
    getIpc().invoke('page-edit:start', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
    }>,
  getPageEditState: (sessionId: string) =>
    getIpc().invoke('page-edit:state', sessionId) as Promise<GenerateRunStateSnapshot>,
  listActivePageEditRuns: () =>
    getIpc().invoke('page-edit:listActive') as Promise<GenerateRunStateSnapshot[]>,
  cancelPageEdit: (sessionId: string) =>
    getIpc().invoke('page-edit:cancel', sessionId) as Promise<{ success: boolean }>,
  startPageBeautify: (payload: {
    sessionId: string
    selectedPageId: string
    modelConfigId?: string
    layoutAudit?: string
  }) =>
    getIpc().invoke('page-beautify:start', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
    }>,
  getPageBeautifyState: (sessionId: string) =>
    getIpc().invoke('page-beautify:state', sessionId) as Promise<GenerateRunStateSnapshot>,
  listActivePageBeautifyRuns: () =>
    getIpc().invoke('page-beautify:listActive') as Promise<GenerateRunStateSnapshot[]>,
  cancelPageBeautify: (sessionId: string) =>
    getIpc().invoke('page-beautify:cancel', sessionId) as Promise<{ success: boolean }>,
  startDeckEdit: (payload: GenerateStartPayload) =>
    getIpc().invoke('deck-edit:start', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
    }>,
  getDeckEditState: (sessionId: string) =>
    getIpc().invoke('deck-edit:state', sessionId) as Promise<GenerateRunStateSnapshot>,
  listActiveDeckEditRuns: () =>
    getIpc().invoke('deck-edit:listActive') as Promise<GenerateRunStateSnapshot[]>,
  cancelDeckEdit: (sessionId: string) =>
    getIpc().invoke('deck-edit:cancel', sessionId) as Promise<{ success: boolean }>,
  startStyleSwitch: (payload: SwitchSessionStylePayload) =>
    getIpc().invoke('style-switch:start', payload) as Promise<{
      success: boolean
      runId?: string
      styleId: string
      unchanged?: boolean
      alreadyRunning?: boolean
    }>,
  retryStyleSwitchPage: (payload: {
    sessionId: string
    failedRunId?: string
    pageId: string
    modelConfigId?: string
  }) =>
    getIpc().invoke('style-switch:retryPage', payload) as Promise<{
      success: boolean
      runId?: string
      styleId: string
      alreadyRunning?: boolean
    }>,
  retryFailedStyleSwitchPages: (payload: RetrySessionStylePayload) =>
    getIpc().invoke('style-switch:retryFailed', payload) as Promise<{
      success: boolean
      runId?: string
      styleId: string
      alreadyRunning?: boolean
      failedPageCount: number
    }>,
  getStyleSwitchState: (sessionId: string) =>
    getIpc().invoke('style-switch:state', sessionId) as Promise<StyleSwitchJobSnapshot>,
  listActiveStyleSwitchRuns: () =>
    getIpc().invoke('style-switch:listActive') as Promise<StyleSwitchJobSnapshot[]>,
  cancelStyleSwitch: (sessionId: string) =>
    getIpc().invoke('style-switch:cancel', sessionId) as Promise<{ success: boolean }>,
  switchSessionStyle: (payload: SwitchSessionStylePayload) =>
    getIpc().invoke('style-switch:start', payload) as Promise<{
      success: boolean
      runId?: string
      styleId: string
      unchanged?: boolean
      alreadyRunning?: boolean
      failedPageCount?: number
    }>,
  retrySessionStyle: (payload: RetrySessionStylePayload) =>
    getIpc().invoke('style-switch:retryFailed', payload) as Promise<{
      success: boolean
      runId?: string
      styleId: string
      alreadyRunning?: boolean
      failedPageCount: number
    }>,
  retryDeckEdit: (payload: RetryDeckEditPayload) =>
    getIpc().invoke('generate:retryDeckEdit', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
      failedPageCount: number
    }>,
  startTemplateGenerate: (payload: GenerateStartPayload & { retry?: boolean }) =>
    getIpc().invoke('generate:startTemplate', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
      queued?: boolean
    }>,
  retryFailedPages: (payload: GenerateRetryFailedPayload) =>
    getIpc().invoke('generate:retryFailedPages', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
      queued?: boolean
    }>,
  addPage: (payload: GenerateAddPagePayload) =>
    getIpc().invoke('generate:addPage', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
      queued?: boolean
    }>,
  retrySinglePage: (payload: GenerateRetrySinglePagePayload) =>
    getIpc().invoke('generate:retrySinglePage', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
      queued?: boolean
    }>,
  getGenerateState: (sessionId: string) =>
    getIpc().invoke('generate:state', sessionId) as Promise<GenerateRunStateSnapshot>,
  listActiveGenerateRuns: () =>
    getIpc().invoke('generate:listActive') as Promise<GenerateRunStateSnapshot[]>,
  cancelGenerate: (sessionId: string) =>
    getIpc().invoke('generate:cancel', sessionId) as Promise<{ success: boolean }>,
  listHistoryVersions: (payload: { sessionId: string; limit?: number }) =>
    getIpc().invoke('history:listVersions', payload) as Promise<HistoryVersion[]>,
  rollbackToHistoryVersion: (payload: { sessionId: string; versionId: string }) =>
    getIpc().invoke('history:rollbackToVersion', payload) as Promise<RollbackHistoryResult>,
  recordHistorySnapshot: (payload: {
    sessionId: string
    type?: 'generate' | 'edit' | 'addPage' | 'retry' | 'import' | 'rollback' | 'reorder' | 'delete'
    scope?: 'session' | 'deck' | 'page' | 'selector' | 'shell'
    prompt?: string
    metadata?: Record<string, unknown>
  }) => getIpc().invoke('history:recordSnapshot', payload) as Promise<unknown>,
  uploadAssets: (payload: UploadAssetsPayload) =>
    getIpc().invoke('assets:upload', payload) as Promise<{ assets: UploadedAsset[] }>,
  prepareReferenceDocument: (payload: PrepareReferenceDocumentPayload) =>
    getIpc().invoke(
      'documents:prepareReference',
      payload
    ) as Promise<PreparedReferenceDocumentResult>,
  parseImageReferenceDocument: (payload: ParseImageReferencePayload) =>
    getIpc().invoke(
      'documents:parseImageReference',
      payload
    ) as Promise<PreparedReferenceDocumentResult>,
  parseDocumentPlan: (payload: ParseDocumentPlanPayload) =>
    getIpc().invoke('documents:parsePlan', payload) as Promise<ParsedDocumentPlanResult>,
  importPptx: (payload: PptxImportPayload) =>
    getIpc().invoke('pptx:import', payload) as Promise<PptxImportResult>,
  chooseAndUploadAssets: (sessionId: string, assetType: 'image' | 'video' = 'image') =>
    getIpc().invoke('assets:chooseAndUpload', { sessionId, assetType }) as Promise<{
      assets: UploadedAsset[]
      cancelled?: boolean
    }>,
  listAssets: (sessionId: string, assetType: 'image' | 'video') =>
    getIpc().invoke('assets:list', { sessionId, assetType }) as Promise<{
      assets: Array<{ fileName: string; relativePath: string; absolutePath: string }>
    }>,
  exportPdf: (sessionId: string) =>
    getIpc().invoke('export:pdf', { sessionId }) as Promise<ExportDeckResult>,
  exportPng: (sessionId: string) =>
    getIpc().invoke('export:png', { sessionId }) as Promise<ExportDeckResult>,
  exportLongImage: (sessionId: string) =>
    getIpc().invoke('export:longImage', { sessionId }) as Promise<ExportDeckResult>,
  exportVideo: (sessionId: string, options?: { pageId?: string }) =>
    getIpc().invoke('export:video', { sessionId, ...options }) as Promise<ExportDeckResult>,
  exportPptx: (
    sessionId: string,
    options?: {
      imageOnly?: boolean
      embedFonts?: boolean | 'auto' | 'always' | 'never'
      pageId?: string
    }
  ) => getIpc().invoke('export:pptx', { sessionId, ...options }) as Promise<ExportDeckResult>,
  exportSlidePack: (sessionId: string) =>
    getIpc().invoke('export:slidePack', { sessionId }) as Promise<ExportDeckResult>,
  exportSessionZip: (sessionId: string) =>
    getIpc().invoke('export:sessionZip', { sessionId }) as Promise<ExportDeckResult>,
  exportOutlinesMarkdown: (sessionId: string) =>
    getIpc().invoke('export:outlinesMarkdown', { sessionId }) as Promise<ExportDeckResult>,
  onExportProgress: (callback: (payload: ExportProgressPayload) => void): (() => void) => {
    const channel = 'export:progress'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as ExportProgressPayload)
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  getSettings: () => getIpc().invoke('settings:get') as Promise<Record<string, unknown>>,
  getModelUsage: (period: ModelUsagePeriod) =>
    getIpc().invoke('settings:getModelUsage', period) as Promise<ModelUsageStats>,
  listModelConfigs: () => getIpc().invoke('settings:listModelConfigs') as Promise<ModelConfig[]>,
  listImageModelConfigs: () => getIpc().invoke('imageModels:list') as Promise<ImageModelConfig[]>,
  validateUploadPrerequisites: () =>
    getIpc().invoke('settings:validateUploadPrerequisites') as Promise<UploadPrerequisitesResult>,
  listFonts: () => getIpc().invoke('fonts:list') as Promise<FontRegistryResponse>,
  uploadFont: (payload: UploadFontPayload) =>
    getIpc().invoke('fonts:upload', payload) as Promise<{ success: true; font: FontListItem }>,
  updateFont: (payload: {
    id: string
    family?: string
    category?: string
    role?: FontRole[]
    scripts?: FontScript[]
  }) => getIpc().invoke('fonts:update', payload) as Promise<{ success: true; font: FontListItem }>,
  deleteFont: (fontId: string) =>
    getIpc().invoke('fonts:delete', fontId) as Promise<{ success: true }>,
  revealFontsFolder: () => getIpc().invoke('fonts:revealFolder') as Promise<{ success: true }>,
  chooseFontFiles: () =>
    getIpc().invoke('fonts:chooseFiles') as Promise<{ canceled: boolean; filePaths: string[] }>,
  loadFontPreviewCss: () => getIpc().invoke('fonts:previewCss') as Promise<string>,
  saveSettings: (settings: Record<string, unknown>) =>
    getIpc().invoke('settings:save', settings) as Promise<{ success: boolean }>,
  upsertModelConfig: (payload: {
    id?: string
    name: string
    provider: 'anthropic' | 'openai' | 'openai-responses' | 'orcarouter' | 'google'
    model: string
    apiKey: string
    baseUrl: string
    maxTokens?: number
    disableTemperature?: boolean
    thinkingParameterMode?: ThinkingParameterMode
    active?: boolean
  }) =>
    getIpc().invoke('settings:upsertModelConfig', payload) as Promise<{
      success: boolean
      id: string
    }>,
  setActiveModelConfig: (id: string) =>
    getIpc().invoke('settings:setActiveModelConfig', id) as Promise<{ success: boolean }>,
  deleteModelConfig: (id: string) =>
    getIpc().invoke('settings:deleteModelConfig', id) as Promise<{ success: boolean }>,
  upsertImageModelConfig: (payload: {
    id?: string
    name: string
    provider: ImageModelProvider
    active?: boolean
    modelConfig: string
  }) =>
    getIpc().invoke('imageModels:upsert', payload) as Promise<{
      success: boolean
      id: string
    }>,
  setActiveImageModelConfig: (id: string) =>
    getIpc().invoke('imageModels:setActive', id) as Promise<{ success: boolean }>,
  deleteImageModelConfig: (id: string) =>
    getIpc().invoke('imageModels:delete', id) as Promise<{ success: boolean }>,
  verifyImageModel: (payload: { provider: ImageModelProvider; modelConfig: string }) =>
    getIpc().invoke('imageModels:verify', payload) as Promise<{
      valid: boolean
      message?: string
    }>,
  verifyApiKey: (payload: {
    provider: string
    apiKey: string
    model: string
    baseUrl: string
    maxTokens?: number
    disableTemperature?: boolean
    thinkingParameterMode?: ThinkingParameterMode
    timeoutMs: number
  }) =>
    getIpc().invoke('settings:verifyApiKey', payload) as Promise<{
      valid: boolean
      message?: string
    }>,
  chooseStoragePath: () =>
    getIpc().invoke('settings:chooseStoragePath') as Promise<{
      path: string | null
      error?: string
    }>,
  generateImage: (payload: ImageGeneratePayload) =>
    getIpc().invoke('images:generate', payload) as Promise<ImageGenerateResult>,
  generateImagePrompt: (payload: ImagePromptGeneratePayload) =>
    getIpc().invoke('images:generatePrompt', payload) as Promise<ImagePromptGenerateResult>,
  listImageGenerationHistory: (payload: { sessionId: string; pageId: string }) =>
    getIpc().invoke('images:listHistory', payload) as Promise<ImageGenerationHistoryRecord[]>,
  cancelImageGeneration: (sessionId: string) =>
    getIpc().invoke('images:cancel', sessionId) as Promise<{ success: boolean }>,
  getImageGenerationState: (sessionId: string) =>
    getIpc().invoke('images:getState', sessionId) as Promise<{
      runId: string
      sessionId: string
      pageId: string
      progress: number
      label: string
      status: 'running' | 'completed' | 'failed' | 'cancelled'
      error: string | null
      updatedAt: number
    } | null>,
  getStyles: () =>
    getIpc().invoke('styles:get') as Promise<{
      categories: Record<
        string,
        Array<{
          id: string
          label: string
          description: string
          source?: 'builtin' | 'custom' | 'override'
          editable?: boolean
          styleCase?: string
        }>
      >
      defaultStyle: string
    }>,
  getStyleDetail: (styleId: string) =>
    getIpc().invoke('styles:getDetail', styleId) as Promise<StyleDetail>,
  listStyles: (payload?: { sessionId?: string }) =>
    getIpc().invoke('styles:list', payload) as Promise<{ items: StyleListItem[] }>,
  generateStylePreview: (payload: { styleId: string; modelConfigId?: string }) =>
    getIpc().invoke('styles:generatePreview', payload) as Promise<{
      success: boolean
      previewPath: string
      thumbnailPath: string
    }>,
  setStyleFavorite: (payload: { styleId: string; favorite: boolean }) =>
    getIpc().invoke('styles:setFavorite', payload) as Promise<{
      success: boolean
      styleId: string
      favoriteAt: number | null
    }>,
  onHtmlThumbnailChanged: (callback: (task: HtmlThumbnailTask) => void): (() => void) => {
    const channel = 'thumbnails:changed'
    const handler = (_event: unknown, task: Parameters<typeof callback>[0]): void => callback(task)
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  parseStyleFile: (payload: { filePath: string; modelConfigId?: string }) =>
    getIpc().invoke('styles:parseFile', payload) as Promise<StyleParseResult>,
  parseStylePptx: (payload: { filePath: string; modelConfigId?: string }) =>
    getIpc().invoke('styles:parsePptx', payload) as Promise<StyleParseResult>,
  parseStyleImage: (payload: { imageBase64: string; mimeType: string; modelConfigId?: string }) =>
    getIpc().invoke('styles:parseImage', payload) as Promise<StyleParseResult>,
  importStylePackageZip: () =>
    getIpc().invoke('styles:importPackageZip') as Promise<{
      success: boolean
      cancelled?: boolean
      id: string
      source: 'custom' | 'override'
    }>,
  importStylePackageDirectory: () =>
    getIpc().invoke('styles:importPackageDirectory') as Promise<{
      success: boolean
      cancelled?: boolean
      id: string
      source: 'custom' | 'override'
    }>,
  exportStylePackageZip: (payload: { styleId: string }) =>
    getIpc().invoke('styles:exportPackageZip', payload) as Promise<{
      success: boolean
      canceled?: boolean
      filePath?: string
    }>,
  createStyle: (payload: {
    label: string
    description: string
    category?: string
    aliases?: string[]
    styleSkill: string
    styleCase?: string
  }) =>
    getIpc().invoke('styles:create', payload) as Promise<{
      success: boolean
      id: string
      source: 'custom' | 'override'
    }>,
  updateStyle: (payload: {
    id: string
    label: string
    description: string
    category?: string
    aliases?: string[]
    styleSkill: string
    styleCase?: string
  }) =>
    getIpc().invoke('styles:update', payload) as Promise<{
      success: boolean
      id: string
      source: 'custom' | 'override'
    }>,
  deleteStyle: (styleId: string) =>
    getIpc().invoke('styles:delete', styleId) as Promise<{
      success: boolean
      deleted: boolean
    }>,
  loadPreview: (htmlPath: string, sessionId?: string) =>
    getIpc().invoke('preview:load', { htmlPath, sessionId }) as Promise<string>,
  loadPagePreview: (htmlPath: string, pageId: string, sessionId?: string) =>
    getIpc().invoke('preview:loadPage', { htmlPath, pageId, sessionId }) as Promise<{
      pageNumber: number
      pageId: string
      title: string
      html: string
    }>,
  updateElementLayout: (payload: UpdateElementLayoutPayload) =>
    getIpc().invoke('drag-editor:update-element-layout', payload) as Promise<{
      success: boolean
    }>,
  ensureElementAnchor: (payload: EnsureElementAnchorPayload) =>
    getIpc().invoke('element-anchor:ensure', payload) as Promise<EnsureElementAnchorResult>,
  getElementAnimation: (payload: {
    sessionId: string
    htmlPath: string
    pageId: string
    selector: string
  }) =>
    getIpc().invoke('element-animation:get', payload) as Promise<{
      animation: ElementAnimationConfig | null
    }>,
  setElementAnimation: (payload: {
    sessionId: string
    htmlPath: string
    pageId: string
    selector: string
    patch: ElementAnimationPatch
  }) =>
    getIpc().invoke('element-animation:set', payload) as Promise<{
      success: boolean
      changed: boolean
      animation: ElementAnimationConfig | null
    }>,
  updateElementProperties: (payload: UpdateElementPropertiesPayload) =>
    getIpc().invoke('text-editor:update-element-properties', payload) as Promise<{
      success: boolean
    }>,
  deleteElement: (payload: {
    sessionId: string
    htmlPath: string
    pageId: string
    selector: string
  }) =>
    getIpc().invoke('element-editor:delete-element', payload) as Promise<{
      success: boolean
    }>,
  saveEditBatch: (payload: {
    sessionId: string
    htmlPath: string
    pageId: string
    dragEdits: unknown[]
    textEdits: unknown[]
    propertyEdits?: unknown[]
    deletes?: unknown[]
    addElements?: unknown[]
    prompt?: string
  }) =>
    getIpc().invoke('edit:save-batch', payload) as Promise<{
      success: boolean
      dragCount: number
      textCount: number
      propertyCount?: number
      deleteCount: number
      addCount: number
      warnings?: string[]
    }>,
  applySyncElementToAllPages: (payload: {
    sessionId: string
    htmlPath: string
    pageId: string
    sourceHtmlFragment: string
    syncElementId?: string
    sourceBlockId?: string
  }) =>
    getIpc().invoke('element-editor:apply-sync-to-all-pages', payload) as Promise<{
      success: boolean
      syncElementId: string
      changedCount: number
      insertedCount: number
      updatedCount: number
    }>,
  chooseAndParseChartData: () =>
    getIpc().invoke('chart-data:choose-and-parse') as Promise<ParsedChartDataResult>,
  openFile: (filePath: string, sessionId?: string) =>
    getIpc().invoke('file:open', { path: filePath, sessionId }) as Promise<string>,
  revealFile: (filePath: string, sessionId?: string) =>
    getIpc().invoke('file:reveal', { path: filePath, sessionId }) as Promise<{ success: boolean }>,
  openInBrowser: (filePath: string, hash?: string, sessionId?: string) =>
    getIpc().invoke('file:openInBrowser', { path: filePath, hash, sessionId }) as Promise<{
      success: boolean
    }>,
  saveFile: (payload: { path: string; content: string; sessionId?: string }) =>
    getIpc().invoke('file:save', payload) as Promise<{ success: boolean }>,
  onGenerateChunk: (callback: (chunk: GenerateChunkEvent) => void): (() => void) => {
    const channel = 'generate:chunk'
    const handler = (_event: unknown, chunk: unknown): void => callback(chunk as GenerateChunkEvent)
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  onPptxImportProgress: (callback: (payload: PptxImportProgressPayload) => void): (() => void) => {
    const channel = 'pptx:import:progress'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as PptxImportProgressPayload)
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  onTemplatePptxImportProgress: (
    callback: (payload: PptxImportProgressPayload) => void
  ): (() => void) => {
    const channel = 'templates:importPptx:progress'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as PptxImportProgressPayload)
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  onUpdateAvailable: (callback: (payload: UpdateAvailablePayload) => void): (() => void) => {
    const channel = 'app:update-available'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as UpdateAvailablePayload)
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  getAppVersion: () =>
    getIpc().invoke('app:getVersion') as Promise<{
      version: string
    }>,
  openPresentation: (payload: { sessionId: string; startIndex?: number }) =>
    getIpc().invoke('presentation:open', payload) as Promise<{ success: boolean }>,
  generateSpeechScript: (sessionId: string, config: SpeechConfig & { currentPageId?: string }) =>
    getIpc().invoke('speech:generateScript', { sessionId, ...config }) as Promise<{
      success: boolean
    }>,
  getSpeechScript: (sessionId: string) =>
    getIpc().invoke('speech:getScript', { sessionId }) as Promise<{
      success: boolean
      script: string | null
    }>,
  openSpeechScriptFile: (sessionId: string) =>
    getIpc().invoke('speech:openScriptFile', { sessionId }) as Promise<{
      success: boolean
      path: string
    }>,
  clearSpeechScript: (sessionId: string) =>
    getIpc().invoke('speech:clearScript', { sessionId }) as Promise<{ success: boolean }>,
  onSpeechProgress: (
    callback: (payload: { sessionId: string; current: number; total: number }) => void
  ): (() => void) => {
    const channel = 'speech:progress'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as { sessionId: string; current: number; total: number })
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },

  thinkingCreateWorkspace: () =>
    getIpc().invoke('thinking:createWorkspace') as Promise<ThinkingWorkspace>,
  thinkingGetWorkspace: (thinkingId: string) =>
    getIpc().invoke('thinking:getWorkspace', thinkingId) as Promise<ThinkingWorkspace>,
  thinkingGetLatestWorkspace: () =>
    getIpc().invoke('thinking:getLatestWorkspace') as Promise<ThinkingWorkspace | null>,
  thinkingListWorkspaces: (payload?: { limit?: number }) =>
    getIpc().invoke('thinking:listWorkspaces', payload || {}) as Promise<
      ThinkingWorkspaceListItem[]
    >,
  thinkingDeleteWorkspace: (thinkingId: string) =>
    getIpc().invoke('thinking:deleteWorkspace', thinkingId) as Promise<{ success: boolean }>,
  thinkingRevealWorkspace: (thinkingId: string) =>
    getIpc().invoke('thinking:revealWorkspace', thinkingId) as Promise<{ success: boolean }>,
  thinkingUpdatePageOutline: (payload: {
    thinkingId: string
    page: import('@shared/thinking').ThinkingPageOutlineUpdate
  }) =>
    getIpc().invoke('thinking:updatePageOutline', payload) as Promise<{
      success: boolean
      thinkingMd: string
    }>,
  thinkingUploadSources: (payload: {
    thinkingId: string
    files: Array<{ path: string; name?: string }>
  }) =>
    getIpc().invoke('thinking:uploadSources', payload) as Promise<{
      sources: Array<{ id: string; name: string; kind: string }>
    }>,
  thinkingRemoveSource: (payload: { thinkingId: string; sourceId: string }) =>
    getIpc().invoke('thinking:removeSource', payload) as Promise<{
      success: boolean
      removed: boolean
    }>,
  thinkingChat: (payload: {
    thinkingId: string
    modelConfigId?: string
    userMessage: string
    recentMessages?: ThinkingChatMessage[]
    attachments?: ThinkingChatMessage['attachments']
  }) => getIpc().invoke('thinking:chat', payload) as Promise<ThinkingChatResult>,
  thinkingPrepareGeneration: (payload: { thinkingId: string }) =>
    getIpc().invoke(
      'thinking:prepareGeneration',
      payload
    ) as Promise<ThinkingPrepareGenerationResult>,
  onThinkingStreamThinking: (
    callback: (payload: {
      thinkingId: string
      type: string
      toolName: string
      summary: string
    }) => void
  ): (() => void) => {
    const channel = 'thinking:stream:thinking'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as { thinkingId: string; type: string; toolName: string; summary: string })
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  onThinkingStreamEnd: (
    callback: (payload: {
      thinkingId: string
      reply: string
      thinkingMd: string
      contextMd: string
      stage: ThinkingStage
    }) => void
  ): (() => void) => {
    const channel = 'thinking:stream:end'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(
        payload as {
          thinkingId: string
          reply: string
          thinkingMd: string
          contextMd: string
          stage: ThinkingStage
        }
      )
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  }
}
