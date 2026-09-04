import { app, BrowserWindow, type WebContents } from 'electron'
import { is } from '@electron-toolkit/utils'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import pLimit from 'p-limit'
import type { PPTDatabase, ThumbnailRecord } from '../../db/database'
import type { HtmlThumbnailResourceType } from '@shared/thumbnail'
import { allowLocalAssetRoot } from '../local-asset-roots'
import { FREEZE_PAGE_FOR_EXPORT_SCRIPT } from '../html-pptx/browser-scripts'

const DEFAULT_CAPTURE_WIDTH = 1600
const DEFAULT_CAPTURE_HEIGHT = 900
const DEFAULT_THUMBNAIL_WIDTH = 640
const DEFAULT_THUMBNAIL_HEIGHT = 360
export const HTML_THUMBNAIL_CONCURRENCY = 2
const PRINT_READY_PREFIX = '__PPT_PRINT_READY__'
const PRINT_READY_DEFAULT_TIMEOUT_MS = 8000
const PRINT_READY_SETTLE_MS = 120
const PRINT_READY_PASS_TWO_DELAY_MS = 450
const PRINT_READY_PASS_THREE_DELAY_MS = 80
const MAX_SOURCE_STABILITY_ATTEMPTS = 2

export type HtmlThumbnailRequest = {
  resourceType: HtmlThumbnailResourceType
  resourceId: string
  variant?: string
  sourcePath: string
  pageId?: string
  query?: Record<string, string>
  captureWidth?: number
  captureHeight?: number
  thumbnailWidth?: number
  thumbnailHeight?: number
}

export type HtmlThumbnailTaskStatus = 'queued' | 'running' | 'completed' | 'failed'

export type HtmlThumbnailTask = {
  resourceType: HtmlThumbnailResourceType
  resourceId: string
  variant: string
  status: HtmlThumbnailTaskStatus
  thumbnailPath: string | null
  error?: string
}

export type HtmlPageScreenshotRequest = {
  sourcePath: string
  pageId: string
  width: number
  height: number
}

let thumbnailDb: PPTDatabase | null = null
const thumbnailLimit = pLimit(HTML_THUMBNAIL_CONCURRENCY)
const backgroundTasks = new Map<string, HtmlThumbnailTask>()
const taskListeners = new Set<(task: HtmlThumbnailTask) => void>()

export function configureHtmlThumbnailService(db: PPTDatabase): void {
  thumbnailDb = db
  const cacheRoot = resolveHtmlThumbnailCacheRoot()
  fs.mkdirSync(cacheRoot, { recursive: true })
  for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.tmp')) {
      try {
        fs.rmSync(path.join(cacheRoot, entry.name), { force: true })
      } catch {
        // A stale temp file must not prevent the app from starting.
      }
    }
  }
  allowLocalAssetRoot(cacheRoot)
}

export function onHtmlThumbnailTaskChanged(
  listener: (task: HtmlThumbnailTask) => void
): () => void {
  taskListeners.add(listener)
  return () => taskListeners.delete(listener)
}

function emitTaskChanged(task: HtmlThumbnailTask): void {
  for (const listener of taskListeners) listener({ ...task })
}

function getDb(): PPTDatabase {
  if (!thumbnailDb) throw new Error('Thumbnail service is not initialized')
  return thumbnailDb
}

function thumbnailTaskKey(
  resourceType: HtmlThumbnailResourceType,
  resourceId: string,
  variant: string
): string {
  return `${resourceType}\u0000${resourceId}\u0000${variant}`
}

function normalizeDimension(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(64, Math.min(4096, Math.round(value)))
    : fallback
}

function normalizeRequest(request: HtmlThumbnailRequest): Required<HtmlThumbnailRequest> {
  const query = Object.fromEntries(
    Object.entries(request.query || {})
      .map(([key, value]) => [String(key), String(value)] as const)
      .sort(([left], [right]) => left.localeCompare(right))
  )
  return {
    resourceType: request.resourceType,
    resourceId: String(request.resourceId || '').trim(),
    variant: String(request.variant || 'default').trim() || 'default',
    sourcePath: path.resolve(request.sourcePath),
    pageId: String(request.pageId || '').trim(),
    query,
    captureWidth: normalizeDimension(request.captureWidth, DEFAULT_CAPTURE_WIDTH),
    captureHeight: normalizeDimension(request.captureHeight, DEFAULT_CAPTURE_HEIGHT),
    thumbnailWidth: normalizeDimension(request.thumbnailWidth, DEFAULT_THUMBNAIL_WIDTH),
    thumbnailHeight: normalizeDimension(request.thumbnailHeight, DEFAULT_THUMBNAIL_HEIGHT)
  }
}

function validateRequest(request: Required<HtmlThumbnailRequest>): void {
  if (!request.resourceType) throw new Error('Thumbnail resourceType is required')
  if (!request.resourceId) throw new Error('Thumbnail resourceId is required')
}

function requestSignature(request: Required<HtmlThumbnailRequest>): string {
  return JSON.stringify(request)
}

export function resolveHtmlThumbnailCacheRoot(): string {
  return path.join(app.getPath('userData'), is.dev ? 'html-thumbnails-dev' : 'html-thumbnails')
}

export function resolveHtmlThumbnailPath(
  resourceType: HtmlThumbnailResourceType,
  resourceId: string,
  variant = 'default',
  size?: { width: number; height: number }
): string {
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        resourceType,
        resourceId,
        variant,
        width: size?.width || DEFAULT_CAPTURE_WIDTH,
        height: size?.height || DEFAULT_CAPTURE_HEIGHT
      })
    )
    .digest('hex')
    .slice(0, 32)
  return path.join(resolveHtmlThumbnailCacheRoot(), `${key}.png`)
}

function recordToTask(record: ThumbnailRecord | undefined): HtmlThumbnailTask | null {
  if (!record) return null
  return {
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    variant: record.variant,
    status: record.status,
    thumbnailPath:
      record.status === 'completed' && record.thumbnailPath && fs.existsSync(record.thumbnailPath)
        ? record.thumbnailPath
        : null,
    error: record.error || undefined
  }
}

export async function getHtmlThumbnailTask(
  resourceType: HtmlThumbnailResourceType,
  resourceId: string,
  variant = 'default'
): Promise<HtmlThumbnailTask | null> {
  const normalizedVariant = variant.trim() || 'default'
  const key = thumbnailTaskKey(resourceType, resourceId, normalizedVariant)
  const activeTask = backgroundTasks.get(key)
  if (activeTask) return { ...activeTask }
  const record = await getDb().getThumbnailRecord(resourceType, resourceId, normalizedVariant)
  return recordToTask(record)
}

export async function waitForHtmlThumbnailTask(
  resourceType: HtmlThumbnailResourceType,
  resourceId: string,
  variant = 'default',
  timeoutMs = 60_000
): Promise<HtmlThumbnailTask> {
  const normalizedVariant = variant.trim() || 'default'
  return new Promise((resolve, reject) => {
    let finished = false
    let timeoutRef: NodeJS.Timeout | null = null

    const finish = (task: HtmlThumbnailTask): void => {
      if (finished) return
      finished = true
      if (timeoutRef) clearTimeout(timeoutRef)
      unsubscribe()
      if (task.status === 'completed' && task.thumbnailPath) {
        resolve(task)
        return
      }
      reject(new Error(task.error || 'Thumbnail generation failed'))
    }

    const unsubscribe = onHtmlThumbnailTaskChanged((task) => {
      if (
        task.resourceType !== resourceType ||
        task.resourceId !== resourceId ||
        task.variant !== normalizedVariant ||
        (task.status !== 'completed' && task.status !== 'failed')
      ) {
        return
      }
      finish(task)
    })

    timeoutRef = setTimeout(
      () => {
        finish({
          resourceType,
          resourceId,
          variant: normalizedVariant,
          status: 'failed',
          thumbnailPath: null,
          error: 'Thumbnail generation timed out'
        })
      },
      Math.max(1_000, timeoutMs)
    )

    void getHtmlThumbnailTask(resourceType, resourceId, normalizedVariant)
      .then((task) => {
        if (task && (task.status === 'completed' || task.status === 'failed')) finish(task)
      })
      .catch((error) => {
        finish({
          resourceType,
          resourceId,
          variant: normalizedVariant,
          status: 'failed',
          thumbnailPath: null,
          error: error instanceof Error ? error.message : String(error)
        })
      })
  })
}

export async function getFreshHtmlThumbnailPath(
  request: HtmlThumbnailRequest
): Promise<string | null> {
  const normalized = normalizeRequest(request)
  validateRequest(normalized)
  if (!fs.existsSync(normalized.sourcePath)) return null
  const record = await getDb().getThumbnailRecord(
    normalized.resourceType,
    normalized.resourceId,
    normalized.variant
  )
  if (!record || record.status !== 'completed' || !fs.existsSync(record.thumbnailPath)) return null

  try {
    const sourceMtimeMs = Math.floor(fs.statSync(normalized.sourcePath).mtimeMs)
    return record.signature === requestSignature(normalized) &&
      record.sourceMtimeMs >= sourceMtimeMs
      ? record.thumbnailPath
      : null
  } catch {
    return null
  }
}

export async function getFreshHtmlThumbnailPaths(
  requests: HtmlThumbnailRequest[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (requests.length === 0) return result

  const validRaw = requests.filter((request) => {
    const resourceType = String(request.resourceType || '').trim()
    const resourceId = String(request.resourceId || '').trim()
    const sourcePath = typeof request.sourcePath === 'string' ? request.sourcePath.trim() : ''
    return resourceType.length > 0 && resourceId.length > 0 && sourcePath.length > 0
  })
  if (validRaw.length === 0) return result

  const normalized = validRaw.map((request) => {
    const item = normalizeRequest(request)
    return { request: item, sourceExists: fs.existsSync(item.sourcePath) }
  })

  const groups = new Map<string, Required<HtmlThumbnailRequest>[]>()
  for (const entry of normalized) {
    if (!entry.sourceExists) continue
    const groupKey = `${entry.request.resourceType}\u0000${entry.request.variant}`
    const arr = groups.get(groupKey) || []
    arr.push(entry.request)
    groups.set(groupKey, arr)
  }

  const db = getDb()
  for (const arr of groups.values()) {
    const resourceType = arr[0].resourceType
    const variant = arr[0].variant
    const records = await db.getThumbnailRecords(
      resourceType,
      arr.map((item) => item.resourceId),
      variant
    )
    const recordByResourceId = new Map(records.map((record) => [record.resourceId, record]))
    for (const request of arr) {
      const record = recordByResourceId.get(request.resourceId)
      if (!record || record.status !== 'completed') continue
      if (!record.thumbnailPath || !fs.existsSync(record.thumbnailPath)) continue
      try {
        const sourceMtimeMs = Math.floor(fs.statSync(request.sourcePath).mtimeMs)
        if (
          record.signature === requestSignature(request) &&
          record.sourceMtimeMs >= sourceMtimeMs
        ) {
          result.set(request.resourceId, record.thumbnailPath)
        }
      } catch {
        // Skip entries whose source can no longer be stat'd.
      }
    }
  }

  return result
}

async function ensureThumbnailCacheRoot(): Promise<void> {
  const cacheRoot = resolveHtmlThumbnailCacheRoot()
  await fs.promises.mkdir(cacheRoot, { recursive: true })
  allowLocalAssetRoot(cacheRoot)
}

function createCaptureWindow(): BrowserWindow {
  return new BrowserWindow({
    show: false,
    width: DEFAULT_CAPTURE_WIDTH,
    height: DEFAULT_CAPTURE_HEIGHT,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
      offscreen: false
    }
  })
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function waitForPrintReady(
  webContents: WebContents,
  pageId: string,
  timeoutMs: number
): Promise<{ timedOut: boolean; reportedPageId?: string }> {
  return new Promise((resolve) => {
    let done = false
    let timeoutRef: NodeJS.Timeout | null = null

    const finalize = (timedOut: boolean, reportedPageId?: string): void => {
      if (done) return
      done = true
      if (timeoutRef) clearTimeout(timeoutRef)
      webContents.removeListener('console-message', onConsoleMessage)
      resolve({ timedOut, reportedPageId })
    }

    const onConsoleMessage = (...rawArgs: unknown[]): void => {
      const message =
        rawArgs.length >= 3 && typeof rawArgs[2] === 'string'
          ? rawArgs[2]
          : ((rawArgs[0] as { message?: unknown } | undefined)?.message ?? '')
      if (typeof message !== 'string') return
      const prefixIndex = message.indexOf(PRINT_READY_PREFIX)
      if (prefixIndex < 0) return
      const suffix = message.slice(prefixIndex + PRINT_READY_PREFIX.length)
      const colonIndex = suffix.indexOf(':')
      const reported = colonIndex >= 0 ? suffix.slice(colonIndex + 1).trim() : ''
      if (reported === pageId || reported === 'page-unknown') {
        finalize(false, reported)
      }
    }

    timeoutRef = setTimeout(() => finalize(true), Math.max(500, timeoutMs))
    webContents.on('console-message', onConsoleMessage as (...args: unknown[]) => void)
  })
}

async function captureThumbnail(
  window: BrowserWindow,
  request: Required<HtmlThumbnailRequest>
): Promise<Buffer> {
  window.webContents.setZoomFactor(1)
  window.setContentSize(request.captureWidth, request.captureHeight)

  if (request.pageId) {
    // Export strategy: drive the page in print/export mode so the runtime
    // emits PRINT_READY, then run FREEZE in three passes mirroring the
    // renderPageToPdfBuffer flow used by PNG/PDF/PPTX export.
    const pageUrl = new URL(pathToFileURL(request.sourcePath).toString())
    pageUrl.searchParams.set('fit', 'off')
    pageUrl.searchParams.set('print', '1')
    pageUrl.searchParams.set('export', '1')
    pageUrl.searchParams.set('pageId', request.pageId)
    pageUrl.searchParams.set('printTimeoutMs', String(PRINT_READY_DEFAULT_TIMEOUT_MS))
    pageUrl.searchParams.set('_ts', String(Date.now()))
    for (const [key, value] of Object.entries(request.query)) {
      pageUrl.searchParams.set(key, value)
    }
    pageUrl.searchParams.set(
      '_pptMasterExpected',
      fs.existsSync(path.join(path.dirname(request.sourcePath), 'master', 'master.css')) ? '1' : '0'
    )
    pageUrl.searchParams.set(
      '_pptMasterElementsExpected',
      fs.existsSync(path.join(path.dirname(request.sourcePath), 'master', 'master.html'))
        ? '1'
        : '0'
    )

    const readyWaitPromise = waitForPrintReady(
      window.webContents,
      request.pageId,
      PRINT_READY_DEFAULT_TIMEOUT_MS
    )
    await window.loadURL(pageUrl.toString())
    await window.webContents.executeJavaScript(FREEZE_PAGE_FOR_EXPORT_SCRIPT, true)
    await readyWaitPromise
    await sleep(PRINT_READY_SETTLE_MS)
    await window.webContents.executeJavaScript(FREEZE_PAGE_FOR_EXPORT_SCRIPT, true)
    await sleep(PRINT_READY_PASS_TWO_DELAY_MS)
    await window.webContents.executeJavaScript(FREEZE_PAGE_FOR_EXPORT_SCRIPT, true)
    await sleep(PRINT_READY_PASS_THREE_DELAY_MS)
  } else {
    await window.loadFile(request.sourcePath, {
      query: {
        ...request.query,
        _pptMasterExpected: fs.existsSync(
          path.join(path.dirname(request.sourcePath), 'master', 'master.css')
        )
          ? '1'
          : '0',
        _pptMasterElementsExpected: fs.existsSync(
          path.join(path.dirname(request.sourcePath), 'master', 'master.html')
        )
          ? '1'
          : '0'
      }
    })
    await window.webContents.executeJavaScript(FREEZE_PAGE_FOR_EXPORT_SCRIPT, true)
    await window.webContents.executeJavaScript(
      `new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))`
    )
  }

  const image = await window.webContents.capturePage({
    x: 0,
    y: 0,
    width: request.captureWidth,
    height: request.captureHeight
  })
  return image
    .resize({
      width: request.thumbnailWidth,
      height: request.thumbnailHeight,
      quality: 'best'
    })
    .toPNG()
}

/** Captures one persisted page at its logical canvas size without creating a thumbnail record. */
export async function captureHtmlPageScreenshot(args: HtmlPageScreenshotRequest): Promise<Buffer> {
  const sourcePath = path.resolve(args.sourcePath)
  const pageId = String(args.pageId || '').trim()
  if (!pageId) throw new Error('Page screenshot requires a page id')
  if (!fs.existsSync(sourcePath)) throw new Error('Page screenshot source does not exist')

  const request = normalizeRequest({
    resourceType: 'session',
    resourceId: 'temporary-page-screenshot',
    variant: 'temporary',
    sourcePath,
    pageId,
    captureWidth: args.width,
    captureHeight: args.height,
    thumbnailWidth: args.width,
    thumbnailHeight: args.height
  })

  return thumbnailLimit(async () => {
    const window = createCaptureWindow()
    try {
      return await captureThumbnail(window, request)
    } finally {
      if (!window.isDestroyed()) window.destroy()
    }
  })
}

async function persistTask(
  request: Required<HtmlThumbnailRequest>,
  status: HtmlThumbnailTaskStatus,
  thumbnailPath: string,
  error?: string,
  sourceMtimeMsOverride?: number
): Promise<void> {
  const sourceMtimeMs =
    sourceMtimeMsOverride ??
    (fs.existsSync(request.sourcePath)
      ? Math.floor((await fs.promises.stat(request.sourcePath)).mtimeMs)
      : 0)
  await getDb().upsertThumbnailRecord({
    resourceType: request.resourceType,
    resourceId: request.resourceId,
    variant: request.variant,
    sourcePath: request.sourcePath,
    sourceMtimeMs,
    signature: requestSignature(request),
    thumbnailPath,
    status,
    error: error || null
  })
}

export async function enqueueHtmlThumbnail(
  request: HtmlThumbnailRequest,
  options: { force?: boolean; delayMs?: number } = {}
): Promise<HtmlThumbnailTask> {
  const normalized = normalizeRequest(request)
  validateRequest(normalized)
  const key = thumbnailTaskKey(normalized.resourceType, normalized.resourceId, normalized.variant)
  const existing = backgroundTasks.get(key)
  if (existing?.status === 'queued' || existing?.status === 'running') return { ...existing }

  if (!options.force) {
    const thumbnailPath = await getFreshHtmlThumbnailPath(normalized)
    if (thumbnailPath) {
      const completed: HtmlThumbnailTask = {
        resourceType: normalized.resourceType,
        resourceId: normalized.resourceId,
        variant: normalized.variant,
        status: 'completed',
        thumbnailPath
      }
      return { ...completed }
    }
  }

  const queued: HtmlThumbnailTask = {
    resourceType: normalized.resourceType,
    resourceId: normalized.resourceId,
    variant: normalized.variant,
    status: 'queued',
    thumbnailPath: null
  }
  backgroundTasks.set(key, queued)
  await persistTask(normalized, 'queued', queued.thumbnailPath || '')
  emitTaskChanged(queued)

  const readyAt = Date.now() + Math.max(0, options.delayMs || 0)
  void thumbnailLimit(async () => {
    const remainingDelayMs = readyAt - Date.now()
    if (remainingDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, remainingDelayMs))
    }
    let pendingPath = ''
    try {
      const running = { ...queued, status: 'running' as const }
      backgroundTasks.set(key, running)
      await persistTask(normalized, 'running', '')
      emitTaskChanged(running)
      await ensureThumbnailCacheRoot()
      const thumbnailPath = resolveHtmlThumbnailPath(
        normalized.resourceType,
        normalized.resourceId,
        normalized.variant,
        { width: normalized.captureWidth, height: normalized.captureHeight }
      )
      pendingPath = `${thumbnailPath}.tmp`
      let png: Buffer | null = null
      let capturedSourceMtimeMs = 0
      for (let attempt = 0; attempt < MAX_SOURCE_STABILITY_ATTEMPTS; attempt += 1) {
        const sourceMtimeBefore = Math.floor(
          (await fs.promises.stat(normalized.sourcePath)).mtimeMs
        )
        const window = createCaptureWindow()
        try {
          png = await captureThumbnail(window, normalized)
        } finally {
          if (!window.isDestroyed()) window.destroy()
        }
        const sourceMtimeAfter = Math.floor((await fs.promises.stat(normalized.sourcePath)).mtimeMs)
        if (sourceMtimeBefore === sourceMtimeAfter) {
          capturedSourceMtimeMs = sourceMtimeAfter
          break
        }
        png = null
      }
      if (!png) throw new Error('Thumbnail source changed during capture')
      await fs.promises.writeFile(pendingPath, png)
      await fs.promises.rename(pendingPath, thumbnailPath)
      const completed: HtmlThumbnailTask = {
        resourceType: normalized.resourceType,
        resourceId: normalized.resourceId,
        variant: normalized.variant,
        status: 'completed',
        thumbnailPath
      }
      await persistTask(normalized, 'completed', thumbnailPath, undefined, capturedSourceMtimeMs)
      emitTaskChanged(completed)
      backgroundTasks.delete(key)
    } catch (error) {
      if (pendingPath) await fs.promises.rm(pendingPath, { force: true }).catch(() => undefined)
      const message = error instanceof Error ? error.message : String(error)
      const failed: HtmlThumbnailTask = {
        ...queued,
        status: 'failed',
        error: message
      }
      backgroundTasks.set(key, failed)
      await persistTask(normalized, 'failed', '', message).catch(() => undefined)
      emitTaskChanged(failed)
      backgroundTasks.delete(key)
    }
  }).catch(() => backgroundTasks.delete(key))

  return { ...queued }
}

export async function enqueueHtmlThumbnails(
  requests: HtmlThumbnailRequest[],
  options: { force?: boolean; delayMs?: number } = {}
): Promise<HtmlThumbnailTask[]> {
  const tasks: HtmlThumbnailTask[] = []
  for (let index = 0; index < requests.length; index += 1) {
    tasks.push(
      await enqueueHtmlThumbnail(requests[index], {
        force: options.force,
        delayMs: options.delayMs
      })
    )
  }
  return tasks
}
