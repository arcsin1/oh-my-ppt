import type { GenerateChunkEvent } from '@shared/generation'
import type { RuntimeDomain } from '../../agent-runtime'

export type SessionRunMode =
  | 'generate'
  | 'edit'
  | 'retry'
  | 'addPage'
  | 'retrySinglePage'
  | 'style-switch'

export type SessionRunKind =
  | 'standard'
  | 'template'
  | 'retry'
  | 'add-page'
  | 'single-page-retry'
  | 'edit'
  | 'page-edit'
  | 'deck-edit'
  | 'style-switch'

export type SessionRunActivityKind =
  | 'page-edit'
  | 'deck-edit'
  | 'edit'
  | 'style-switch'
  | 'single-page-retry'
  | 'addPage'

export type SessionRunState = {
  sessionId: string
  runId: string
  mode: SessionRunMode
  kind?: SessionRunKind
  activityKind?: SessionRunActivityKind
  targetPageId?: string
  targetPageNumber?: number
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

export type BeginSessionRunStateArgs = {
  sessionId: string
  runId: string
  mode: SessionRunMode
  kind?: SessionRunKind
  activityKind?: SessionRunActivityKind
  targetPageId?: string
  targetPageNumber?: number
  totalPages: number
  previousSessionStatus?: string
  status?: 'queued' | 'running'
  completedPageBaseCount?: number
  failedPageBaseKeys?: string[]
}

export type SessionRunStateStore = {
  sessionRunStates: Map<string, SessionRunState>
  pruneFinishedSessionRunStates(now?: number): void
  beginSessionRunState(args: BeginSessionRunStateArgs): SessionRunState
  trackSessionRunChunk(sessionId: string, chunk: GenerateChunkEvent): void
}

const MAX_SESSION_RUN_EVENTS = 500
const FINISHED_SESSION_RUN_STATE_TTL_MS = 30 * 60 * 1000

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

export function runtimeDomainForSessionRun(state: SessionRunState | undefined): RuntimeDomain {
  const activityKind = state?.activityKind
  if (activityKind === 'style-switch') return 'style'
  if (activityKind === 'page-edit' || activityKind === 'deck-edit' || activityKind === 'edit') {
    return 'edit'
  }
  return 'generation'
}

export function createSessionRunStateStore(): SessionRunStateStore {
  const sessionRunStates = new Map<string, SessionRunState>()

  const pruneFinishedSessionRunStates = (now = Date.now()): void => {
    for (const [sessionId, state] of sessionRunStates) {
      if (state.status === 'queued' || state.status === 'running') continue
      if (now - state.updatedAt > FINISHED_SESSION_RUN_STATE_TTL_MS) {
        sessionRunStates.delete(sessionId)
      }
    }
  }

  const beginSessionRunState = (args: BeginSessionRunStateArgs): SessionRunState => {
    const now = Date.now()
    pruneFinishedSessionRunStates(now)
    const state: SessionRunState = {
      sessionId: args.sessionId,
      runId: args.runId,
      mode: args.mode,
      kind: args.kind,
      activityKind: args.activityKind,
      targetPageId: args.targetPageId,
      targetPageNumber: args.targetPageNumber,
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
    }
    sessionRunStates.set(args.sessionId, state)
    return state
  }

  const trackSessionRunChunk = (sessionId: string, chunk: GenerateChunkEvent): void => {
    const state = sessionRunStates.get(sessionId)
    if (!state || state.runId !== chunk.payload.runId) return

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

  return {
    sessionRunStates,
    pruneFinishedSessionRunStates,
    beginSessionRunState,
    trackSessionRunChunk
  }
}
