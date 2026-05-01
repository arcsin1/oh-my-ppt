import type {
  GenerateChunkEvent,
  GenerateRetryFailedPayload,
  GenerateStartPayload,
  ParseDocumentPlanPayload,
  ParsedDocumentPlanResult,
  PptxImportPayload,
  PptxImportProgressPayload,
  PptxImportResult,
  UploadedAsset
} from '@shared/generation.js'
import type { UpdateAvailablePayload } from '@shared/app-update.js'

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
}

export interface StyleListItem {
  id: string
  label: string
  description: string
  category: string
  source?: 'builtin' | 'custom' | 'override'
  editable?: boolean
  createdAt?: number
  updatedAt?: number
}

export interface GenerateRunStateSnapshot {
  sessionId: string
  runId: string | null
  status: 'idle' | 'running' | 'completed' | 'failed'
  hasActiveRun: boolean
  progress: number
  totalPages: number
  events: GenerateChunkEvent[]
  error: string | null
  startedAt: number | null
  updatedAt: number | null
}

export interface ExportDeckResult {
  success: boolean
  cancelled?: boolean
  path?: string
  warnings?: string[]
  pageCount?: number
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
}

export interface CreateSessionPayload {
  topic: string
  styleId: string
  pageCount?: number
  referenceDocumentPath?: string
  allowWebSearch?: boolean
}

export interface ModelConfig {
  id: string
  name: string
  provider: 'anthropic' | 'openai'
  model: string
  apiKey: string
  baseUrl: string
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface WebSearchServiceStatus {
  daemonUrl: string
  running: boolean
  installed: boolean
  installSource: 'managed' | 'workspace' | 'none'
  installDir: string
  workspaceDir: string
  canInstall: boolean
  canStart: boolean
}

export const ipc = {
  createSession: (payload: CreateSessionPayload) =>
    getIpc().invoke('session:create', payload) as Promise<{ sessionId: string }>,
  listSessions: () => getIpc().invoke('session:list') as Promise<unknown[]>,
  getSession: (sessionId: string) =>
    getIpc().invoke('session:get', sessionId) as Promise<{
      session: unknown
      messages: unknown[]
      generatedPages: Array<{
        pageNumber: number
        title: string
        html: string
        htmlPath?: string
        pageId?: string
        sourceUrl?: string
        status?: string
        error?: string | null
      }>
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
  startGenerate: (payload: GenerateStartPayload) =>
    getIpc().invoke('generate:start', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
    }>,
  retryFailedPages: (payload: GenerateRetryFailedPayload) =>
    getIpc().invoke('generate:retryFailedPages', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
    }>,
  getGenerateState: (sessionId: string) =>
    getIpc().invoke('generate:state', sessionId) as Promise<GenerateRunStateSnapshot>,
  cancelGenerate: (sessionId: string) =>
    getIpc().invoke('generate:cancel', sessionId) as Promise<{ success: boolean }>,
  uploadAssets: (payload: UploadAssetsPayload) =>
    getIpc().invoke('assets:upload', payload) as Promise<{ assets: UploadedAsset[] }>,
  parseDocumentPlan: (payload: ParseDocumentPlanPayload) =>
    getIpc().invoke('documents:parsePlan', payload) as Promise<ParsedDocumentPlanResult>,
  importPptx: (payload: PptxImportPayload) =>
    getIpc().invoke('pptx:import', payload) as Promise<PptxImportResult>,
  chooseAndUploadAssets: (sessionId: string) =>
    getIpc().invoke('assets:chooseAndUpload', { sessionId }) as Promise<{
      assets: UploadedAsset[]
      cancelled?: boolean
    }>,
  exportPdf: (sessionId: string) =>
    getIpc().invoke('export:pdf', { sessionId }) as Promise<ExportDeckResult>,
  exportPng: (sessionId: string) =>
    getIpc().invoke('export:png', { sessionId }) as Promise<ExportDeckResult>,
  exportPptx: (sessionId: string) =>
    getIpc().invoke('export:pptx', { sessionId }) as Promise<ExportDeckResult>,
  getSettings: () => getIpc().invoke('settings:get') as Promise<Record<string, unknown>>,
  listModelConfigs: () => getIpc().invoke('settings:listModelConfigs') as Promise<ModelConfig[]>,
  saveSettings: (settings: Record<string, unknown>) =>
    getIpc().invoke('settings:save', settings) as Promise<{ success: boolean }>,
  getWebSearchServiceStatus: () =>
    getIpc().invoke('settings:getWebSearchServiceStatus') as Promise<WebSearchServiceStatus>,
  installWebSearchService: () =>
    getIpc().invoke('settings:installWebSearchService') as Promise<WebSearchServiceStatus>,
  startWebSearchService: () =>
    getIpc().invoke('settings:startWebSearchService') as Promise<WebSearchServiceStatus>,
  upsertModelConfig: (payload: {
    id?: string
    name: string
    provider: 'anthropic' | 'openai'
    model: string
    apiKey: string
    baseUrl: string
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
  verifyApiKey: (payload: {
    provider: string
    apiKey: string
    model: string
    baseUrl: string
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
        }>
      >
      defaultStyle: string
    }>,
  getStyleDetail: (styleId: string) =>
    getIpc().invoke('styles:getDetail', styleId) as Promise<StyleDetail>,
  listStyles: () => getIpc().invoke('styles:list') as Promise<{ items: StyleListItem[] }>,
  createStyle: (payload: {
    id: string
    label: string
    description: string
    category?: string
    aliases?: string[]
    styleSkill: string
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
  onUpdateAvailable: (callback: (payload: UpdateAvailablePayload) => void): (() => void) => {
    const channel = 'app:update-available'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as UpdateAvailablePayload)
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  }
}
