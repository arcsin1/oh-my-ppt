import type {
  FontSelection,
  GenerateAddPagePayload,
  GenerateChunkEvent,
  GenerateRetryFailedPayload,
  GenerateRetrySinglePagePayload,
  GenerateStartPayload,
  ParseDocumentPlanPayload,
  ParseImageReferencePayload,
  ParsedDocumentPlanResult,
  PrepareReferenceDocumentPayload,
  PreparedReferenceDocumentResult,
  SourceDocumentPlan,
  PptxImportPayload,
  PptxImportProgressPayload,
  PptxImportResult,
  UploadedAsset
} from '@shared/generation.js'
import type { UpdateAvailablePayload } from '@shared/app-update.js'
import type { SpeechConfig } from '@shared/speech'
import type { HistoryVersion, RollbackHistoryResult } from '@shared/history.js'
import type { IndexTransitionConfig, IndexTransitionType } from '@shared/index-transition.js'
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
  description: string
  aliases: string[]
  styleSkill: string
  source?: 'builtin' | 'custom' | 'override'
  editable?: boolean
  category?: string
  styleCase?: string
}

export interface StyleListItem {
  id: string
  styleKey?: string
  label: string
  description: string
  aliases?: string[]
  category: string
  source?: 'builtin' | 'custom' | 'override'
  editable?: boolean
  styleCase?: string
  previewPath?: string | null
  createdAt?: number
  updatedAt?: number
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
  kind?: 'standard' | 'template' | 'retry'
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

export interface ImportSessionFileResult {
  success: boolean
  cancelled?: boolean
  sessionId?: string
  title?: string
  pageCount?: number
  warnings?: string[]
}

export interface TemplateListItem {
  id: string
  name: string
  description: string
  source: 'user'
  pageCount: number
  tags: string[]
  previewHtmlPath: string | null
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
  provider: 'anthropic' | 'openai' | 'google'
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: number
  disableTemperature: boolean
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
  saveSessionAsNew: (payload: SaveSessionAsNewPayload): Promise<SaveSessionAsNewResult> =>
    getIpc().invoke('session:saveAsNew', payload) as Promise<SaveSessionAsNewResult>,
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
  createBlankSessionPage: (payload: {
    sessionId: string
    sourcePageId: string
  }) =>
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
  updateSessionPageTitle: (payload: {
    sessionId: string
    pageId: string
    title: string
  }) =>
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
  listTemplates: () =>
    getIpc().invoke('templates:list') as Promise<{ items: TemplateListItem[] }>,
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
  importPptxAsTemplate: (payload: {
    filePath: string
    name?: string
    modelConfigId?: string
  }) =>
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
    }>,
  retrySinglePage: (payload: GenerateRetrySinglePagePayload) =>
    getIpc().invoke('generate:retrySinglePage', payload) as Promise<{
      success: boolean
      runId?: string
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
    getIpc().invoke('documents:prepareReference', payload) as Promise<PreparedReferenceDocumentResult>,
  parseImageReferenceDocument: (payload: ParseImageReferencePayload) =>
    getIpc().invoke('documents:parseImageReference', payload) as Promise<PreparedReferenceDocumentResult>,
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
  exportVideo: (sessionId: string, options?: { pageId?: string }) =>
    getIpc().invoke('export:video', { sessionId, ...options }) as Promise<ExportDeckResult>,
  exportPptx: (
    sessionId: string,
    options?: {
      imageOnly?: boolean
      embedFonts?: boolean | 'auto' | 'always' | 'never'
      pageId?: string
    }
  ) =>
    getIpc().invoke('export:pptx', { sessionId, ...options }) as Promise<ExportDeckResult>,
  exportSlidePack: (sessionId: string) =>
    getIpc().invoke('export:slidePack', { sessionId }) as Promise<ExportDeckResult>,
  exportSessionZip: (sessionId: string) =>
    getIpc().invoke('export:sessionZip', { sessionId }) as Promise<ExportDeckResult>,
  exportOutlinesMarkdown: (sessionId: string) =>
    getIpc().invoke('export:outlinesMarkdown', { sessionId }) as Promise<ExportDeckResult>,
  getSettings: () => getIpc().invoke('settings:get') as Promise<Record<string, unknown>>,
  listModelConfigs: () => getIpc().invoke('settings:listModelConfigs') as Promise<ModelConfig[]>,
  listImageModelConfigs: () =>
    getIpc().invoke('imageModels:list') as Promise<ImageModelConfig[]>,
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
    provider: 'anthropic' | 'openai' | 'google'
    model: string
    apiKey: string
    baseUrl: string
    maxTokens?: number
    disableTemperature?: boolean
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
  verifyImageModel: (payload: {
    provider: ImageModelProvider
    modelConfig: string
  }) =>
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
  listStyles: () => getIpc().invoke('styles:list') as Promise<{ items: StyleListItem[] }>,
  parseStyleFile: (payload: { filePath: string; modelConfigId?: string }) =>
    getIpc().invoke('styles:parseFile', payload) as Promise<StyleParseResult>,
  parseStylePptx: (payload: { filePath: string; modelConfigId?: string }) =>
    getIpc().invoke('styles:parsePptx', payload) as Promise<StyleParseResult>,
  parseStyleImage: (payload: { imageBase64: string; mimeType: string; modelConfigId?: string }) =>
    getIpc().invoke('styles:parseImage', payload) as Promise<StyleParseResult>,
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
      message?: string
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
  generateSpeechScript: (
    sessionId: string,
    config: SpeechConfig & { currentPageId?: string }
  ) =>
    getIpc().invoke('speech:generateScript', { sessionId, ...config }) as Promise<{ success: boolean }>,
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
    getIpc().invoke('thinking:listWorkspaces', payload || {}) as Promise<ThinkingWorkspaceListItem[]>,
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
  }) =>
    getIpc().invoke('thinking:chat', payload) as Promise<ThinkingChatResult>,
  thinkingPrepareGeneration: (payload: { thinkingId: string }) =>
    getIpc().invoke('thinking:prepareGeneration', payload) as Promise<ThinkingPrepareGenerationResult>,
  onThinkingStreamThinking: (
    callback: (payload: { thinkingId: string; type: string; toolName: string; summary: string }) => void
  ): (() => void) => {
    const channel = 'thinking:stream:thinking'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as { thinkingId: string; type: string; toolName: string; summary: string })
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  onThinkingStreamEnd: (
    callback: (
      payload: {
        thinkingId: string
        reply: string
        thinkingMd: string
        contextMd: string
        stage: ThinkingStage
      }
    ) => void
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
