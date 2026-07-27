import { BrowserWindow, safeStorage } from 'electron'
import { is } from '@electron-toolkit/utils'
import log from 'electron-log/main.js'
import type { PPTDatabase } from '../db/database'
import type { AgentManager } from '../agent'
import type { GenerateChunkEvent, UploadedAsset } from '@shared/generation'
import { progressDisplayLabel, type AppLocale } from '@shared/progress'
import path from 'path'
import fs from 'fs'

import dayjs from 'dayjs'
import { pathToFileURL } from 'url'
import { sleep } from './utils'
import { nanoid } from 'nanoid'
import {
  buildPageScaffoldHtml,
  buildProjectIndexHtml,
  SESSION_ASSET_FILE_NAMES,
  type DeckPageFile
} from './engine/template'
import { FREEZE_PAGE_FOR_EXPORT_SCRIPT } from '../utils/html-pptx/browser-scripts'
import { isCancellationMessage } from './generation/status-utils'
import {
  revealGenerationWindow,
  shouldRevealGenerationWindow
} from './generation/generation-window-policy'
import { createCredentialCodec } from '../security/credential-storage'

export type SessionRunState = {
  sessionId: string
  runId: string
  mode: 'generate' | 'edit' | 'retry' | 'addPage' | 'retrySinglePage'
  kind?: 'standard' | 'template' | 'retry'
  activityKind?: 'edit' | 'style-switch' | 'single-page-retry' | 'addPage'
  previousSessionStatus?: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number
  totalPages: number
  completedPageBaseCount: number
  failedPageBaseKeys: string[]
  completedPageKeys: string[]
  failedPageKeys: string[]
  events: GenerateChunkEvent[]
  error: string | null
  startedAt: number
  updatedAt: number
}

export type SessionPageFile = {
  id: string
  pageNumber: number
  pageId: string
  title: string
  htmlPath: string
}

export type SessionGenerationSnapshot = {
  session: Record<string, unknown> | null | undefined
  pages: Array<{
    pageNumber: number
    title: string
    html: string
    htmlPath?: string
    pageId?: string
    sourceUrl?: string
    status?: string
    error?: string | null
  }>
}

export interface IpcContext {
  mainWindow: BrowserWindow
  db: PPTDatabase
  agentManager: AgentManager
  getPageSourceUrl: (htmlPath?: string) => string | undefined
  validateProjectIndexHtml: (html: string) => string[]
  parseSessionMetadataObject: (value: unknown) => Record<string, unknown>
  buildSessionGenerationSnapshot: (
    session: Record<string, unknown> | null | undefined,
    options?: { includeHtml?: boolean }
  ) => Promise<SessionGenerationSnapshot>
  sessionRunStates: Map<string, SessionRunState>
  pruneFinishedSessionRunStates: (now?: number) => void
  beginSessionRunState: (args: {
    sessionId: string
    runId: string
    mode: 'generate' | 'edit' | 'retry' | 'addPage' | 'retrySinglePage'
    kind?: 'standard' | 'template' | 'retry'
    activityKind?: 'edit' | 'style-switch' | 'single-page-retry' | 'addPage'
    totalPages: number
    previousSessionStatus?: string
    status?: 'queued' | 'running'
    completedPageBaseCount?: number
    failedPageBaseKeys?: string[]
  }) => void
  trackSessionRunChunk: (sessionId: string, chunk: GenerateChunkEvent) => void
  emitGenerateChunk: (sessionId: string, chunk: GenerateChunkEvent) => void
  createDeckProgressEmitter: (
    sessionId: string,
    appLocale?: AppLocale
  ) => (chunk: GenerateChunkEvent) => void
  resolveStoragePath: () => Promise<string>
  normalizeSessionId: (value: unknown) => string | undefined
  parsePathPayload: (
    payload: unknown,
    preferredKey?: 'path' | 'htmlPath'
  ) => { filePath: string; sessionId?: string; hash?: string }
  isPathInside: (targetPath: string, rootPath: string) => boolean
  toSafeAssetBaseName: (value: string) => string
  resolveSessionProjectDir: (sessionId: string) => Promise<string>
  formatImagePathsForPrompt: (imagePaths?: string[], videoPaths?: string[]) => string
  buildAssetTimestamp: () => string
  uploadSessionFiles: (
    sessionId: string,
    files: Array<{ path?: unknown; name?: unknown }>,
    target: 'images' | 'videos' | 'docs'
  ) => Promise<UploadedAsset[]>
  uploadImageAssets: (
    sessionId: string,
    files: Array<{ path?: unknown; name?: unknown }>
  ) => Promise<UploadedAsset[]>
  uploadMediaAssets: (
    sessionId: string,
    files: Array<{ path?: unknown; name?: unknown }>
  ) => Promise<UploadedAsset[]>
  resolveExistingFileRealPath: (filePath: string) => Promise<string>
  resolveWritableFileRealPath: (filePath: string) => Promise<string>
  resolveAllowedRoots: (sessionId?: string) => Promise<string[]>
  assertPathInAllowedRoots: (args: {
    filePath: string
    mode: 'read' | 'write'
    sessionId?: string
    htmlOnly?: boolean
  }) => Promise<string>
  encryptApiKey: (apiKey: string) => string
  decryptApiKey: (rawValue: unknown) => string
  PLANNER_TEMPERATURE: number
  DESIGN_CONTRACT_TEMPERATURE: number
  PAGE_GENERATION_TEMPERATURE: number
  PAGE_EDIT_WITH_SELECTOR_TEMPERATURE: number
  PAGE_EDIT_DEFAULT_TEMPERATURE: number
  resolveSessionAssetSourcePath: (fileName: string) => string
  ensureSessionAssets: (projectDir: string) => Promise<void>
  scaffoldProjectFiles: (args: {
    deckTitle: string
    indexPath: string
    pages: Array<{ pageNumber: number; pageId: string; title: string; htmlPath: string }>
    slideSize: import('@shared/slide-size').SlideSizePreset
  }) => Promise<void>
  PRINT_READY_PREFIX: string
  EXPORT_PAGE_READY_TIMEOUT_MS: number
  EXPORT_CAPTURE_SETTLE_MS: number
  resolveSessionPageFiles: (sessionId: string) => Promise<{
    session: Record<string, unknown>
    pages: SessionPageFile[]
    projectDir: string
  }>
  waitForPrintReadySignal: (args: {
    win: BrowserWindow
    pageId: string
    timeoutMs: number
  }) => Promise<{ timedOut: boolean; reportedPageId?: string }>
  renderPageToPdfBuffer: (args: {
    page: SessionPageFile
    timeoutMs: number
    slideSize: import('@shared/slide-size').SlideSizePreset
  }) => Promise<{ pngBuffer: Buffer; warning?: string }>
}

export function getSessionRunPageCounts(state: {
  completedPageBaseCount: number
  failedPageBaseKeys: string[]
  completedPageKeys: string[]
  failedPageKeys: string[]
}): { completedPageCount: number; failedPageCount: number } {
  const completedPageCount = state.completedPageBaseCount + state.completedPageKeys.length
  const completed = new Set(state.completedPageKeys)
  const failed = new Set(state.failedPageKeys)
  for (const pageKey of state.failedPageBaseKeys) {
    if (!completed.has(pageKey)) failed.add(pageKey)
  }
  return { completedPageCount, failedPageCount: failed.size }
}

export function createIpcContext(
  mainWindow: BrowserWindow,
  db: PPTDatabase,
  agentManager: AgentManager
): IpcContext {
  const credentialCodec = createCredentialCodec(safeStorage, log, {
    allowSessionOnly: is.dev && process.platform === 'darwin'
  })
  const MAX_SESSION_RUN_EVENTS = 500
  const FINISHED_SESSION_RUN_STATE_TTL_MS = 30 * 60 * 1000
  const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
  const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogg'])
  const ALLOWED_DOC_EXTENSIONS = new Set(['.md', '.txt', '.text'])
  const IMAGE_MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  }
  const DOC_MIME_BY_EXT: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.text': 'text/plain'
  }
  const VIDEO_MIME_BY_EXT: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogg': 'video/ogg'
  }
  const getPageSourceUrl = (htmlPath?: string): string | undefined => {
    if (!htmlPath || !fs.existsSync(htmlPath)) return undefined
    return pathToFileURL(htmlPath).toString()
  }
  const validateProjectIndexHtml = (html: string): string[] => {
    const errors: string[] = []
    if (!/<html[\s>]/i.test(html)) errors.push('index.html 缺少 <html> 标签')
    if (!/<body[\s>]/i.test(html)) errors.push('index.html 缺少 <body> 标签')
    if (!/<iframe\b[^>]*class=["'][^"']*\bppt-preview-frame\b/i.test(html)) {
      errors.push('index.html 缺少页面预览 iframe')
    }
    if (!/id=["']pages-data["']/i.test(html)) {
      errors.push('index.html 缺少 pages-data 页面数据')
    }
    const hasInlineJs =
      /const\s+pages\s*=\s*JSON\.parse/i.test(html) && /function\s+applyPage\s*\(/i.test(html)
    const hasExternalRuntime = /src=["'][^"']*index-runtime\.js["']/i.test(html)
    if (!hasInlineJs && !hasExternalRuntime) {
      errors.push('index.html 缺少页面数据解析逻辑')
    }
    return errors
  }
  const parseSessionMetadataObject = (value: unknown): Record<string, unknown> => {
    if (typeof value !== 'string' || value.trim().length === 0) return {}
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }

  const buildSessionGenerationSnapshot = async (
    session: Record<string, unknown> | null | undefined,
    options?: { includeHtml?: boolean }
  ): Promise<{
    session: Record<string, unknown> | null | undefined
    pages: Array<{
      pageNumber: number
      title: string
      html: string
      htmlPath?: string
      pageId?: string
      sourceUrl?: string
      status?: string
      error?: string | null
    }>
  }> => {
    if (!session) return { session, pages: [] }
    const sessionId = String(session.id || '').trim()
    if (!sessionId) return { session, pages: [] }

    const metadata = parseSessionMetadataObject(session.metadata)
    const sessionPages = await db.listSessionPages(sessionId)
    if (sessionPages.length === 0) {
      return { session, pages: [] }
    }

    const projectDir = await resolveSessionProjectDir(sessionId)
    const project = await db.getProject(sessionId)
    const indexPath = path.join(projectDir, 'index.html')
    const pages: Array<{
      pageNumber: number
      title: string
      html: string
      htmlPath?: string
      pageId?: string
      sourceUrl?: string
      status?: string
      error?: string | null
    }> = []

    for (const page of sessionPages) {
      const pageId = page.file_slug
      const title = page.title || `第 ${page.page_number} 页`
      const htmlPath = resolveProjectPageHtmlPath(projectDir, pageId, page.html_path)
      const html =
        options?.includeHtml && fs.existsSync(htmlPath)
          ? await fs.promises.readFile(htmlPath, 'utf-8')
          : ''
      pages.push({
        pageNumber: page.page_number,
        title,
        html: options?.includeHtml ? html : '',
        htmlPath,
        pageId,
        sourceUrl: getPageSourceUrl(htmlPath),
        status: page.status,
        error: page.error
      })
    }

    const synthesizedMetadata = {
      ...metadata,
      entryMode: 'multi_page',
      indexPath,
      projectId: project?.id || metadata.projectId
    }
    const completedCount = pages.filter((page) => page.status === 'completed').length
    const failedCount = pages.filter((page) => page.status === 'failed').length

    return {
      session: {
        ...session,
        metadata: JSON.stringify(synthesizedMetadata),
        page_count: pages.length,
        generated_count: completedCount,
        failed_count: failedCount
      },
      pages: pages.sort((a, b) => a.pageNumber - b.pageNumber)
    }
  }

  const sessionRunStates = new Map<string, SessionRunState>()

  const pruneFinishedSessionRunStates = (now = Date.now()): void => {
    for (const [sessionId, state] of sessionRunStates) {
      if (state.status === 'queued' || state.status === 'running') continue
      if (now - state.updatedAt > FINISHED_SESSION_RUN_STATE_TTL_MS) {
        sessionRunStates.delete(sessionId)
      }
    }
  }

  const summarizeGenerateChunk = (chunk: GenerateChunkEvent): Record<string, unknown> => {
    switch (chunk.type) {
      case 'stage_started':
      case 'stage_progress':
        return {
          type: chunk.type,
          stage: chunk.payload.stage,
          label: chunk.payload.label,
          progress: chunk.payload.progress ?? null,
          totalPages: chunk.payload.totalPages ?? null
        }
      case 'llm_status':
        return {
          type: chunk.type,
          stage: chunk.payload.stage,
          label: chunk.payload.label,
          detail: chunk.payload.detail ?? null,
          progress: chunk.payload.progress ?? null,
          totalPages: chunk.payload.totalPages ?? null,
          provider: chunk.payload.provider ?? null,
          model: chunk.payload.model ?? null
        }
      case 'page_generated':
      case 'page_updated':
        return {
          type: chunk.type,
          stage: chunk.payload.stage,
          pageNumber: chunk.payload.pageNumber,
          pageId: chunk.payload.pageId,
          title: chunk.payload.title,
          progress: chunk.payload.progress ?? null,
          htmlPath: chunk.payload.htmlPath ?? null
        }
      case 'page_planned':
      case 'page_started':
      case 'page_failed':
        return {
          type: chunk.type,
          stage: chunk.payload.stage,
          pageNumber: chunk.payload.pageNumber,
          pageId: chunk.payload.pageId,
          title: chunk.payload.title,
          progress: chunk.payload.progress ?? null,
          error: chunk.payload.error ?? null
        }
      case 'run_completed':
        return {
          type: chunk.type,
          totalPages: chunk.payload.totalPages,
          completedPageCount: chunk.payload.completedPageCount ?? null,
          failedPageCount: chunk.payload.failedPageCount ?? null,
          activityKind: chunk.payload.activityKind ?? null
        }
      case 'run_error':
        return {
          type: chunk.type,
          message: chunk.payload.message,
          activityKind: chunk.payload.activityKind ?? null
        }
      default:
        return { type: chunk.type }
    }
  }

  const beginSessionRunState = (args: {
    sessionId: string
    runId: string
    mode: 'generate' | 'edit' | 'retry' | 'addPage' | 'retrySinglePage'
    kind?: 'standard' | 'template' | 'retry'
    activityKind?: 'edit' | 'style-switch' | 'single-page-retry' | 'addPage'
    totalPages: number
    previousSessionStatus?: string
    status?: 'queued' | 'running'
    completedPageBaseCount?: number
    failedPageBaseKeys?: string[]
  }): void => {
    const now = Date.now()
    pruneFinishedSessionRunStates(now)
    sessionRunStates.set(args.sessionId, {
      sessionId: args.sessionId,
      runId: args.runId,
      mode: args.mode,
      kind: args.kind,
      activityKind: args.activityKind,
      previousSessionStatus: args.previousSessionStatus,
      status: args.status || 'running',
      progress: 0,
      totalPages: Math.max(1, Math.floor(args.totalPages || 1)),
      completedPageBaseCount: Math.max(0, Math.floor(args.completedPageBaseCount || 0)),
      failedPageBaseKeys: args.failedPageBaseKeys || [],
      completedPageKeys: [],
      failedPageKeys: [],
      events: [],
      error: null,
      startedAt: now,
      updatedAt: now
    })
  }

  const trackSessionRunChunk = (sessionId: string, chunk: GenerateChunkEvent): void => {
    const state = sessionRunStates.get(sessionId)
    if (!state) return
    if (state.runId !== chunk.payload.runId) return

    if (
      chunk.type === 'page_generated' ||
      chunk.type === 'page_updated' ||
      chunk.type === 'page_failed'
    ) {
      const payload = chunk.payload as { pageId?: unknown; id?: unknown; pageNumber?: unknown }
      const pageId =
        typeof payload.pageId === 'string' && payload.pageId.trim().length > 0
          ? payload.pageId.trim()
          : typeof payload.id === 'string' && payload.id.trim().length > 0
            ? payload.id.trim()
            : ''
      const pageKey =
        pageId ||
        (typeof payload.pageNumber === 'number' && Number.isFinite(payload.pageNumber)
          ? `page-number:${Math.floor(payload.pageNumber)}`
          : '')
      if (pageKey) {
        const completed = new Set(state.completedPageKeys)
        const failed = new Set(state.failedPageKeys)
        if (chunk.type === 'page_failed') {
          completed.delete(pageKey)
          failed.add(pageKey)
        } else {
          failed.delete(pageKey)
          completed.add(pageKey)
        }
        state.completedPageKeys = Array.from(completed)
        state.failedPageKeys = Array.from(failed)
      }
    }

    const compactChunk =
      chunk.type === 'page_generated' || chunk.type === 'page_updated'
        ? ({
            ...chunk,
            payload: {
              ...chunk.payload,
              html: ''
            }
          } as GenerateChunkEvent)
        : chunk

    state.updatedAt = Date.now()
    state.events.push(compactChunk)
    if (state.events.length > MAX_SESSION_RUN_EVENTS) {
      state.events.splice(0, state.events.length - MAX_SESSION_RUN_EVENTS)
    }

    if (chunk.type === 'run_completed') {
      state.status = 'completed'
      state.progress = 100
      state.totalPages = Math.max(
        state.totalPages,
        Math.floor(chunk.payload.totalPages || state.totalPages)
      )
      state.error = null
      return
    }

    if (chunk.type === 'run_error') {
      state.status = /^(生成已取消|Generation cancelled|Generation canceled)$/i.test(
        chunk.payload.message || ''
      )
        ? 'cancelled'
        : 'failed'
      state.error = chunk.payload.message || 'Generation failed'
      return
    }

    if (
      'totalPages' in chunk.payload &&
      typeof chunk.payload.totalPages === 'number' &&
      Number.isFinite(chunk.payload.totalPages)
    ) {
      state.totalPages = Math.max(1, Math.floor(chunk.payload.totalPages))
    }
    if (
      'progress' in chunk.payload &&
      typeof chunk.payload.progress === 'number' &&
      Number.isFinite(chunk.payload.progress)
    ) {
      const boundedProgress = Math.max(0, Math.min(100, Math.round(chunk.payload.progress)))
      state.progress = Math.max(state.progress, boundedProgress)
    }
  }

  const emitGenerateChunk = (sessionId: string, chunk: GenerateChunkEvent): void => {
    let enrichedChunk = {
      ...chunk,
      payload: {
        ...chunk.payload,
        sessionId,
        timestamp: new Date().toISOString()
      }
    } as GenerateChunkEvent
    if (enrichedChunk.type === 'run_error') {
      enrichedChunk = {
        ...enrichedChunk,
        payload: {
          ...enrichedChunk.payload,
          cancelled:
            enrichedChunk.payload.cancelled ??
            isCancellationMessage(enrichedChunk.payload.message || '')
        }
      }
    }

    trackSessionRunChunk(sessionId, enrichedChunk)
    const state = sessionRunStates.get(sessionId)
    if (state?.runId === enrichedChunk.payload.runId) {
      const pageCounts = getSessionRunPageCounts(state)
      enrichedChunk = {
        ...enrichedChunk,
        payload: {
          ...enrichedChunk.payload,
          activityKind: state.activityKind,
          completedPageCount: pageCounts.completedPageCount,
          failedPageCount: pageCounts.failedPageCount
        }
      } as GenerateChunkEvent
    }

    if (
      enrichedChunk.type === 'stage_started' ||
      enrichedChunk.type === 'stage_progress' ||
      enrichedChunk.type === 'llm_status' ||
      enrichedChunk.type === 'page_planned' ||
      enrichedChunk.type === 'page_started' ||
      enrichedChunk.type === 'page_generated' ||
      enrichedChunk.type === 'page_updated' ||
      enrichedChunk.type === 'page_failed' ||
      enrichedChunk.type === 'run_completed' ||
      enrichedChunk.type === 'run_error'
    ) {
      log.info('[generate:chunk] emit', summarizeGenerateChunk(enrichedChunk))
    }

    if (shouldRevealGenerationWindow(enrichedChunk, state)) {
      revealGenerationWindow(mainWindow)
    }

    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      try {
        win.webContents.send('generate:chunk', enrichedChunk)
      } catch (sendError) {
        log.warn('[generate:chunk] send failed', {
          sessionId,
          windowId: win.id,
          message: sendError instanceof Error ? sendError.message : String(sendError)
        })
      }
    }
  }

  const createDeckProgressEmitter = (
    sessionId: string,
    appLocale?: AppLocale
  ): ((chunk: GenerateChunkEvent) => void) => {
    let normalizedProgress = 0

    const clamp = (value: number, min: number, max: number): number =>
      Math.max(min, Math.min(max, Math.round(value)))

    const getStageBounds = (stage: string): { min: number; max: number } => {
      if (stage === 'preflight' || stage === 'planning') {
        return { min: 0, max: 10 }
      }
      if (stage === 'rendering') {
        return { min: 10, max: 90 }
      }
      return { min: 0, max: 90 }
    }

    return (chunk: GenerateChunkEvent) => {
      if (chunk.type === 'run_completed') {
        normalizedProgress = 100
        emitGenerateChunk(sessionId, chunk)
        return
      }

      if (
        chunk.type !== 'stage_started' &&
        chunk.type !== 'stage_progress' &&
        chunk.type !== 'llm_status' &&
        chunk.type !== 'page_started' &&
        chunk.type !== 'page_generated' &&
        chunk.type !== 'page_updated' &&
        chunk.type !== 'page_failed'
      ) {
        emitGenerateChunk(sessionId, chunk)
        return
      }

      const { min, max } = getStageBounds(chunk.payload.stage)
      const rawProgress =
        typeof chunk.payload.progress === 'number' && Number.isFinite(chunk.payload.progress)
          ? chunk.payload.progress
          : normalizedProgress
      const bounded = clamp(rawProgress, min, max)
      normalizedProgress = Math.max(normalizedProgress, bounded)

      emitGenerateChunk(sessionId, {
        ...chunk,
        payload: {
          ...chunk.payload,
          label: progressDisplayLabel(appLocale, chunk.payload.label),
          progress: normalizedProgress
        }
      } as GenerateChunkEvent)
    }
  }

  const resolveStoragePath = async (): Promise<string> => {
    const saved = await db.getSetting<string>('storage_path')
    if (typeof saved === 'string' && saved.trim().length > 0) {
      const normalized = saved.trim()
      await db.setStoragePath(normalized)
      return normalized
    }
    throw new Error('请先前往系统设置选择存储目录。')
  }

  const normalizeSessionId = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const parsePathPayload = (
    payload: unknown,
    preferredKey: 'path' | 'htmlPath' = 'path'
  ): { filePath: string; sessionId?: string; hash?: string } => {
    if (typeof payload === 'string') {
      return { filePath: payload.trim() }
    }
    if (!payload || typeof payload !== 'object') {
      return { filePath: '' }
    }
    const record = payload as Record<string, unknown>
    const candidate =
      typeof record[preferredKey] === 'string'
        ? String(record[preferredKey])
        : typeof record.path === 'string'
          ? String(record.path)
          : typeof record.htmlPath === 'string'
            ? String(record.htmlPath)
            : ''
    return {
      filePath: candidate.trim(),
      sessionId: normalizeSessionId(record.sessionId),
      hash: typeof record.hash === 'string' ? record.hash : undefined
    }
  }

  const isPathInside = (targetPath: string, rootPath: string): boolean => {
    const relative = path.relative(rootPath, targetPath)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }

  const resolveProjectPageHtmlPath = (
    projectDir: string,
    fileSlug: string,
    candidatePath?: string | null
  ): string => {
    const projectRoot = path.resolve(projectDir)
    const fallbackPath = path.resolve(projectRoot, `${fileSlug}.html`)
    const rawCandidate = typeof candidatePath === 'string' ? candidatePath.trim() : ''
    if (!rawCandidate) return fallbackPath
    const resolvedCandidate = path.isAbsolute(rawCandidate)
      ? path.resolve(rawCandidate)
      : path.resolve(projectRoot, rawCandidate)
    if (!isPathInside(resolvedCandidate, projectRoot)) return fallbackPath
    return fs.existsSync(resolvedCandidate) ? resolvedCandidate : fallbackPath
  }

  const toSafeAssetBaseName = (value: string): string => {
    const parsed = path.parse(value)
    const fallback = parsed.name || 'image'
    const safe = fallback
      .normalize('NFKD')
      .replace(/[^\w\u4e00-\u9fff.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72)
    return safe || 'image'
  }

  const resolveSessionProjectDir = async (sessionId: string): Promise<string> => {
    const session = await db.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    const project = await db.getProject(sessionId)
    const rootPath = typeof project?.root_path === 'string' ? project.root_path.trim() : ''
    if (!rootPath) throw new Error(`Session ${sessionId} has no root_path`)
    return path.resolve(rootPath)
  }

  const formatImagePathsForPrompt = (imagePaths?: string[], videoPaths?: string[]): string => {
    const validPaths = Array.isArray(imagePaths)
      ? imagePaths
          .map((item) => String(item || '').trim())
          .filter((item) => item.startsWith('./images/'))
          .slice(0, 10)
      : []
    const validVideoPaths = Array.isArray(videoPaths)
      ? videoPaths
          .map((item) => String(item || '').trim())
          .filter((item) => item.startsWith('./videos/'))
          .slice(0, 10)
      : []
    if (validPaths.length === 0 && validVideoPaths.length === 0) return ''
    return [
      '',
      validPaths.length > 0 ? '本次消息可用图片路径：' : '',
      ...validPaths.map((imagePath, index) => `- ${index + 1}. ${imagePath}`),
      validPaths.length > 0 ? '' : '',
      validVideoPaths.length > 0 ? '本次消息可用视频路径：' : '',
      ...validVideoPaths.map((videoPath, index) => `- ${index + 1}. ${videoPath}`),
      validVideoPaths.length > 0 ? '' : '',
      '素材使用规则：',
      '- 如需使用图片或视频，请引用上面的相对路径。',
      '- 禁止使用 file://、绝对路径或 base64。',
      '- 不要重新引入远程资源，优先使用这些本地素材。',
      '- 插入视频时必须使用 HTML <video> 标签，并包含 controls playsinline preload="metadata"。',
      '- 视频默认不要添加 autoplay 或 muted，让用户点击控件后播放并保留声音；只有明确要求循环背景视频时才使用 muted/loop。'
    ]
      .filter(Boolean)
      .join('\n')
  }

  const buildAssetTimestamp = (): string => {
    return dayjs().format('YYYYMMDD-HHmmss')
  }

  const uploadSessionFiles = async (
    sessionId: string,
    files: Array<{ path?: unknown; name?: unknown }>,
    target: 'images' | 'videos' | 'docs'
  ): Promise<UploadedAsset[]> => {
    if (!sessionId) throw new Error('sessionId 不能为空')
    if (files.length === 0) return []
    if (files.length > 10) throw new Error('一次最多上传 10 个素材')

    const projectDir = await resolveSessionProjectDir(sessionId)
    const targetDir = path.join(projectDir, target)
    await fs.promises.mkdir(targetDir, { recursive: true })
    const targetRoot = await fs.promises.realpath(targetDir)

    const uploadedAssets: UploadedAsset[] = []
    for (const file of files) {
      const sourcePathRaw = typeof file.path === 'string' ? file.path.trim() : ''
      if (!sourcePathRaw) throw new Error('无法读取拖入文件路径')
      const sourcePath = path.resolve(sourcePathRaw)
      if (!fs.existsSync(sourcePath)) throw new Error(`素材文件不存在: ${sourcePath}`)
      const stat = await fs.promises.stat(sourcePath)
      if (!stat.isFile()) throw new Error(`素材不是文件: ${sourcePath}`)
      if (stat.size > 20 * 1024 * 1024) throw new Error('单个素材不能超过 20MB')

      const ext = path.extname(sourcePath).toLowerCase()
      if (target === 'images' && !ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        throw new Error('暂只支持 png、jpg、jpeg、webp、gif、svg 图片素材')
      }
      if (target === 'docs' && !ALLOWED_DOC_EXTENSIONS.has(ext)) {
        throw new Error('暂只支持 md、txt 文档素材')
      }
      if (target === 'videos' && !ALLOWED_VIDEO_EXTENSIONS.has(ext)) {
        throw new Error('暂只支持 mp4、webm、ogg 视频素材')
      }

      const originalName =
        typeof file.name === 'string' && file.name.trim().length > 0
          ? file.name.trim()
          : path.basename(sourcePath)
      const id = nanoid(10)
      const baseNameWithoutExt = toSafeAssetBaseName(originalName.replace(/\.[^.]+$/, ''))
      const fileName = `${baseNameWithoutExt}-${id}${ext}`
      const targetPath = path.join(targetDir, fileName)
      if (!isPathInside(path.resolve(targetPath), targetRoot)) {
        throw new Error('素材目标路径不合法')
      }
      await fs.promises.copyFile(sourcePath, targetPath)

      uploadedAssets.push({
        id,
        fileName,
        originalName,
        relativePath: `./${target}/${fileName}`,
        absolutePath: targetPath,
        mimeType:
          target === 'images'
            ? IMAGE_MIME_BY_EXT[ext] || 'application/octet-stream'
            : target === 'videos'
              ? VIDEO_MIME_BY_EXT[ext] || 'application/octet-stream'
              : DOC_MIME_BY_EXT[ext] || 'text/plain',
        size: stat.size,
        createdAt: Math.floor(Date.now() / 1000)
      })
    }

    log.info('[assets] uploaded', {
      sessionId,
      projectDir,
      target,
      count: uploadedAssets.length,
      files: uploadedAssets.map((asset) => asset.fileName)
    })
    return uploadedAssets
  }

  const uploadImageAssets = async (
    sessionId: string,
    files: Array<{ path?: unknown; name?: unknown }>
  ): Promise<UploadedAsset[]> => uploadSessionFiles(sessionId, files, 'images')

  const uploadMediaAssets = async (
    sessionId: string,
    files: Array<{ path?: unknown; name?: unknown }>
  ): Promise<UploadedAsset[]> => {
    const mediaAssets: UploadedAsset[] = []
    const imageFiles: Array<{ path?: unknown; name?: unknown }> = []
    const videoFiles: Array<{ path?: unknown; name?: unknown }> = []
    for (const file of files) {
      const sourcePath = typeof file.path === 'string' ? file.path.trim() : ''
      const ext = path.extname(sourcePath).toLowerCase()
      if (ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        imageFiles.push(file)
        continue
      }
      if (ALLOWED_VIDEO_EXTENSIONS.has(ext)) {
        videoFiles.push(file)
        continue
      }
      throw new Error('暂只支持 png/jpg/webp/gif/svg 图片，或 mp4/webm/ogg 视频素材')
    }
    if (imageFiles.length > 0) {
      mediaAssets.push(...(await uploadSessionFiles(sessionId, imageFiles, 'images')))
    }
    if (videoFiles.length > 0) {
      mediaAssets.push(...(await uploadSessionFiles(sessionId, videoFiles, 'videos')))
    }
    return mediaAssets
  }

  const resolveExistingFileRealPath = async (filePath: string): Promise<string> => {
    const absolutePath = path.resolve(filePath)
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`文件不存在: ${absolutePath}`)
    }
    const stat = await fs.promises.stat(absolutePath)
    if (!stat.isFile()) {
      throw new Error(`目标不是文件: ${absolutePath}`)
    }
    return fs.promises.realpath(absolutePath)
  }

  const resolveWritableFileRealPath = async (filePath: string): Promise<string> => {
    const absolutePath = path.resolve(filePath)
    if (fs.existsSync(absolutePath)) {
      const stat = await fs.promises.stat(absolutePath)
      if (!stat.isFile()) {
        throw new Error(`目标不是文件: ${absolutePath}`)
      }
      return fs.promises.realpath(absolutePath)
    }
    const parentDir = path.dirname(absolutePath)
    if (!fs.existsSync(parentDir)) {
      throw new Error(`目标目录不存在: ${parentDir}`)
    }
    const parentRealPath = await fs.promises.realpath(parentDir)
    return path.join(parentRealPath, path.basename(absolutePath))
  }

  const resolveAllowedRoots = async (sessionId?: string): Promise<string[]> => {
    const roots = new Set<string>()
    const storagePath = await resolveStoragePath()
    const storageRoot = fs.existsSync(storagePath)
      ? await fs.promises.realpath(storagePath)
      : path.resolve(storagePath)
    roots.add(storageRoot)

    if (sessionId) {
      const project = await db.getProject(sessionId)
      const rootPath = typeof project?.root_path === 'string' ? project.root_path : ''
      if (rootPath) {
        const resolvedRootPath = fs.existsSync(rootPath)
          ? await fs.promises.realpath(rootPath)
          : path.resolve(rootPath)
        roots.add(resolvedRootPath)
      }
    }
    return [...roots]
  }

  const assertPathInAllowedRoots = async (args: {
    filePath: string
    mode: 'read' | 'write'
    sessionId?: string
    htmlOnly?: boolean
  }): Promise<string> => {
    const { filePath, mode, sessionId, htmlOnly } = args
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      throw new Error('文件路径不能为空')
    }
    const extension = path.extname(filePath).toLowerCase()
    if (htmlOnly && extension !== '.html' && extension !== '.htm') {
      throw new Error(`仅允许访问 HTML 文件，当前扩展名: ${extension || '(none)'}`)
    }
    const resolveSessionHtmlFallbackPath = async (): Promise<string | null> => {
      if (mode !== 'read' || !sessionId) return null
      if (extension !== '.html' && extension !== '.htm') return null
      const fileName = path.basename(filePath)
      if (!fileName) return null
      const projectDir = await resolveSessionProjectDir(sessionId)
      const fallbackPath = path.join(projectDir, fileName)
      if (path.resolve(fallbackPath) === path.resolve(filePath)) return null
      return fs.existsSync(fallbackPath) ? fallbackPath : null
    }

    let targetPath: string
    if (mode === 'read') {
      try {
        targetPath = await resolveExistingFileRealPath(filePath)
      } catch (error) {
        const fallbackPath = await resolveSessionHtmlFallbackPath()
        if (!fallbackPath) throw error
        targetPath = await resolveExistingFileRealPath(fallbackPath)
      }
    } else {
      targetPath = await resolveWritableFileRealPath(filePath)
    }
    const allowedRoots = await resolveAllowedRoots(sessionId)
    const allowed = allowedRoots.some((root) => isPathInside(targetPath, root))
    if (!allowed) {
      throw new Error(`文件路径不在允许目录内: ${targetPath}`)
    }
    return targetPath
  }

  const encryptApiKey = credentialCodec.encrypt
  const decryptApiKey = credentialCodec.decrypt

  const PLANNER_TEMPERATURE = 0.1
  const DESIGN_CONTRACT_TEMPERATURE = 0.25
  const PAGE_GENERATION_TEMPERATURE = 0.65
  const PAGE_EDIT_WITH_SELECTOR_TEMPERATURE = 0.15
  const PAGE_EDIT_DEFAULT_TEMPERATURE = 0.45

  const resolveSessionAssetSourcePath = (fileName: string): string => {
    const baseDir = is.dev
      ? path.join(process.cwd(), 'resources')
      : path.join(process.resourcesPath, 'app.asar.unpacked', 'resources')
    const sourcePath = path.join(baseDir, fileName)
    if (fs.existsSync(sourcePath)) return sourcePath
    throw new Error(`缺少资源文件 ${fileName}。期望路径: ${sourcePath}`)
  }

  const ensureSessionAssets = async (projectDir: string): Promise<void> => {
    const assetsDir = path.join(projectDir, 'assets')
    const imagesDir = path.join(projectDir, 'images')
    const videosDir = path.join(projectDir, 'videos')
    const docsDir = path.join(projectDir, 'docs')
    await fs.promises.mkdir(assetsDir, { recursive: true })
    await fs.promises.mkdir(imagesDir, { recursive: true })
    await fs.promises.mkdir(videosDir, { recursive: true })
    await fs.promises.mkdir(docsDir, { recursive: true })
    // Copy runtime assets, preserving subdirectories such as katex/.
    await Promise.all(
      SESSION_ASSET_FILE_NAMES.map(async (sourceRelPath) => {
        const sourcePath = resolveSessionAssetSourcePath(sourceRelPath)
        const targetPath = path.join(assetsDir, sourceRelPath)
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.promises.copyFile(sourcePath, targetPath)
      })
    )
    // Copy KaTeX woff2 fonts next to katex.min.css so its relative fonts/... URLs stay contained.
    const katexFontsSource = resolveSessionAssetSourcePath('katex/fonts')
    const katexFontsTarget = path.join(assetsDir, 'katex', 'fonts')
    await fs.promises.mkdir(katexFontsTarget, { recursive: true })
    const katexFontFiles = await fs.promises.readdir(katexFontsSource)
    await Promise.all(
      katexFontFiles
        .filter((f) => f.endsWith('.woff2'))
        .map(async (f) =>
          fs.promises.copyFile(path.join(katexFontsSource, f), path.join(katexFontsTarget, f))
        )
    )
    log.info('[assets] session assets ready', {
      projectDir,
      assetsDir,
      imagesDir,
      videosDir,
      docsDir,
      env: is.dev ? 'dev' : 'prod'
    })
  }

  const scaffoldProjectFiles = async (args: {
    deckTitle: string
    indexPath: string
    pages: Array<{ pageNumber: number; pageId: string; title: string; htmlPath: string }>
    slideSize: import('@shared/slide-size').SlideSizePreset
  }): Promise<void> => {
    const { deckTitle, indexPath, pages, slideSize } = args
    await Promise.all(
      pages.map((page) =>
        fs.promises.writeFile(
          page.htmlPath,
          buildPageScaffoldHtml(
            {
              pageNumber: page.pageNumber,
              pageId: page.pageId,
              title: page.title
            },
            slideSize
          ),
          'utf-8'
        )
      )
    )
    await fs.promises.writeFile(
      indexPath,
      buildProjectIndexHtml(
        deckTitle,
        pages.map(
          (page): DeckPageFile => ({
            pageNumber: page.pageNumber,
            pageId: page.pageId,
            title: page.title,
            htmlPath: path.basename(page.htmlPath)
          })
        ),
        slideSize
      ),
      'utf-8'
    )
  }

  const PRINT_READY_PREFIX = '__PPT_PRINT_READY__'
  const EXPORT_PAGE_READY_TIMEOUT_MS = 4000
  const EXPORT_CAPTURE_SETTLE_MS = 120

  const resolveSessionPageFiles = async (
    sessionId: string
  ): Promise<{
    session: Record<string, unknown>
    pages: SessionPageFile[]
    projectDir: string
  }> => {
    const session = await db.getSession(sessionId)
    if (!session) {
      throw new Error('Session not found')
    }
    const sessionRecord = session as unknown as Record<string, unknown>

    const projectDir = await resolveSessionProjectDir(sessionId)
    const sessionPages = await db.listSessionPages(sessionId)
    if (sessionPages.length === 0) {
      throw new Error(
        'session_pages is empty after migration; export path requires session_pages as source of truth'
      )
    }
    const dedupedPages: SessionPageFile[] = sessionPages.map((sp) => ({
      id: sp.id,
      pageNumber: sp.page_number,
      pageId: sp.file_slug,
      title: sp.title,
      htmlPath: resolveProjectPageHtmlPath(projectDir, sp.file_slug, sp.html_path)
    }))

    const missingPages: string[] = []
    const safePages: SessionPageFile[] = []
    for (const page of dedupedPages) {
      try {
        const safePath = await assertPathInAllowedRoots({
          filePath: page.htmlPath,
          mode: 'read',
          sessionId,
          htmlOnly: true
        })
        safePages.push({
          ...page,
          htmlPath: safePath
        })
      } catch {
        missingPages.push(page.pageId)
      }
    }
    if (missingPages.length > 0) {
      throw new Error(`页面文件缺失：${missingPages.join(', ')}`)
    }

    return { session: sessionRecord, pages: safePages, projectDir }
  }

  const waitForPrintReadySignal = async (args: {
    win: BrowserWindow
    pageId: string
    timeoutMs: number
  }): Promise<{ timedOut: boolean; reportedPageId?: string }> => {
    const { win, pageId, timeoutMs } = args
    return new Promise((resolve) => {
      let done = false
      let timeoutRef: NodeJS.Timeout | null = null
      let closedListenerBound = false

      const finalize = (timedOut: boolean, reportedPageId?: string): void => {
        if (done) return
        done = true
        if (timeoutRef) clearTimeout(timeoutRef)
        win.webContents.removeListener('console-message', onConsoleMessage)
        if (closedListenerBound) {
          win.removeListener('closed', onClosed)
        }
        resolve({ timedOut, reportedPageId })
      }

      const resolveConsoleMessageText = (...rawArgs: unknown[]): string => {
        if (rawArgs.length >= 3 && typeof rawArgs[2] === 'string') {
          return rawArgs[2]
        }
        const firstArg = rawArgs[0] as
          | { message?: unknown; params?: { message?: unknown } }
          | undefined
        if (firstArg && typeof firstArg === 'object') {
          if (typeof firstArg.message === 'string') return firstArg.message
          if (firstArg.params && typeof firstArg.params.message === 'string') {
            return firstArg.params.message
          }
        }
        return ''
      }

      const extractReportedPageId = (message: string): string | null => {
        if (typeof message !== 'string') return null
        const prefixIndex = message.indexOf(PRINT_READY_PREFIX)
        if (prefixIndex < 0) return null
        const suffix = message.slice(prefixIndex + PRINT_READY_PREFIX.length)
        const colonIndex = suffix.indexOf(':')
        if (colonIndex < 0) return null
        return suffix.slice(colonIndex + 1).trim() || null
      }

      const onConsoleMessage = (...rawArgs: unknown[]): void => {
        const message = resolveConsoleMessageText(...rawArgs)
        const reported = extractReportedPageId(message)
        if (!reported) return
        if (reported === pageId || reported === 'page-unknown') {
          finalize(false, reported)
        }
      }

      const onClosed = (): void => {
        finalize(true)
      }

      timeoutRef = setTimeout(() => finalize(true), Math.max(500, timeoutMs))
      win.webContents.on('console-message', onConsoleMessage as (...args: unknown[]) => void)
      win.on('closed', onClosed)
      closedListenerBound = true
    })
  }

  const renderPageToPdfBuffer = async (args: {
    page: SessionPageFile
    timeoutMs: number
    slideSize: import('@shared/slide-size').SlideSizePreset
  }): Promise<{ pngBuffer: Buffer; warning?: string }> => {
    const { page, timeoutMs, slideSize } = args
    const captureWidth = slideSize.width
    const captureHeight = slideSize.height
    const win = new BrowserWindow({
      show: false,
      width: captureWidth,
      height: captureHeight,
      backgroundColor: '#ffffff',
      webPreferences: {
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
        backgroundThrottling: false,
        offscreen: false
      }
    })

    try {
      // Ensure no zoom and exact content size for consistent capture
      win.webContents.setZoomFactor(1)
      win.setContentSize(captureWidth, captureHeight)
      const pageUrl = new URL(pathToFileURL(page.htmlPath).toString())
      pageUrl.searchParams.set('fit', 'off')
      pageUrl.searchParams.set('print', '1')
      pageUrl.searchParams.set('export', '1')
      pageUrl.searchParams.set('pageId', page.pageId)
      pageUrl.searchParams.set('printTimeoutMs', String(timeoutMs))
      pageUrl.searchParams.set('_ts', String(Date.now()))

      const readyWaitPromise = waitForPrintReadySignal({
        win,
        pageId: page.pageId,
        timeoutMs
      })
      await win.loadURL(pageUrl.toString())
      await win.webContents.executeJavaScript(FREEZE_PAGE_FOR_EXPORT_SCRIPT, true)
      const readyResult = await readyWaitPromise
      if (readyResult.timedOut) {
        log.warn('[export:pdf] print ready timeout', {
          pageId: page.pageId,
          htmlPath: page.htmlPath,
          timeoutMs
        })
      }
      await sleep(EXPORT_CAPTURE_SETTLE_MS)
      await win.webContents.executeJavaScript(FREEZE_PAGE_FOR_EXPORT_SCRIPT, true)
      await sleep(450)
      await win.webContents.executeJavaScript(FREEZE_PAGE_FOR_EXPORT_SCRIPT, true)
      await sleep(80)
      // Capture with an explicit rect to preserve the session canvas.
      const image = await win.webContents.capturePage({
        x: 0,
        y: 0,
        width: captureWidth,
        height: captureHeight
      })
      const pngBuffer = image.toPNG()

      return {
        pngBuffer,
        warning: readyResult.timedOut
          ? `页面 ${page.pageId} 未收到打印就绪信号，已按当前状态导出`
          : undefined
      }
    } finally {
      if (!win.isDestroyed()) {
        win.destroy()
      }
    }
  }

  return {
    mainWindow,
    db,
    agentManager,
    getPageSourceUrl,
    validateProjectIndexHtml,
    parseSessionMetadataObject,
    buildSessionGenerationSnapshot,
    sessionRunStates,
    pruneFinishedSessionRunStates,
    beginSessionRunState,
    trackSessionRunChunk,
    emitGenerateChunk,
    createDeckProgressEmitter,
    resolveStoragePath,
    normalizeSessionId,
    parsePathPayload,
    isPathInside,
    toSafeAssetBaseName,
    resolveSessionProjectDir,
    formatImagePathsForPrompt,
    buildAssetTimestamp,
    uploadSessionFiles,
    uploadImageAssets,
    uploadMediaAssets,
    resolveExistingFileRealPath,
    resolveWritableFileRealPath,
    resolveAllowedRoots,
    assertPathInAllowedRoots,
    encryptApiKey,
    decryptApiKey,
    PLANNER_TEMPERATURE,
    DESIGN_CONTRACT_TEMPERATURE,
    PAGE_GENERATION_TEMPERATURE,
    PAGE_EDIT_WITH_SELECTOR_TEMPERATURE,
    PAGE_EDIT_DEFAULT_TEMPERATURE,
    resolveSessionAssetSourcePath,
    ensureSessionAssets,
    scaffoldProjectFiles,
    PRINT_READY_PREFIX,
    EXPORT_PAGE_READY_TIMEOUT_MS,
    EXPORT_CAPTURE_SETTLE_MS,
    resolveSessionPageFiles,
    waitForPrintReadySignal,
    renderPageToPdfBuffer
  }
}
