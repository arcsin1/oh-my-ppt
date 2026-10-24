import type { GenerateChunkEvent } from '@shared/generation'

export function mapGenerateChunkToExternalEvent(chunk: GenerateChunkEvent): {
  type:
    | 'progress'
    | 'page_started'
    | 'page_completed'
    | 'warning'
    | 'completed'
    | 'failed'
    | 'cancelled'
  progress?: number
  checkpoint?: string
  payload: Record<string, string | number | boolean | null>
} | null {
  if (chunk.type === 'assistant_message') return null
  if (
    chunk.type === 'stage_started' ||
    chunk.type === 'stage_progress' ||
    chunk.type === 'llm_status'
  ) {
    return {
      type: 'progress',
      progress: typeof chunk.payload.progress === 'number' ? chunk.payload.progress : undefined,
      payload: {
        stage: chunk.payload.stage ?? null,
        label: chunk.payload.label ?? null,
        progress: typeof chunk.payload.progress === 'number' ? chunk.payload.progress : null
      }
    }
  }
  if (chunk.type === 'page_started' || chunk.type === 'page_planned') {
    return {
      type: 'page_started',
      checkpoint: chunk.payload.pageId ?? undefined,
      payload: {
        pageId: chunk.payload.pageId ?? null,
        pageNumber: chunk.payload.pageNumber ?? null,
        title: chunk.payload.title ?? null
      }
    }
  }
  if (chunk.type === 'page_generated' || chunk.type === 'page_updated') {
    return {
      type: 'page_completed',
      checkpoint: chunk.payload.pageId ?? undefined,
      payload: {
        pageId: chunk.payload.pageId ?? null,
        pageNumber: chunk.payload.pageNumber ?? null,
        title: chunk.payload.title ?? null
      }
    }
  }
  if (chunk.type === 'page_failed') {
    return {
      type: 'warning',
      payload: {
        pageId: chunk.payload.pageId ?? null,
        pageNumber: chunk.payload.pageNumber ?? null,
        error: chunk.payload.error ?? null
      }
    }
  }
  if (chunk.type === 'run_completed') {
    const failed = Number(chunk.payload.failedPageCount ?? 0)
    return {
      type: failed > 0 ? 'warning' : 'completed',
      progress: 100,
      payload: {
        totalPages: chunk.payload.totalPages,
        completedPageCount: chunk.payload.completedPageCount ?? null,
        failedPageCount: failed
      }
    }
  }
  if (chunk.type === 'run_error') {
    const cancelled = Boolean(chunk.payload.cancelled) || /取消|cancel/i.test(chunk.payload.message)
    return {
      type: cancelled ? 'cancelled' : 'failed',
      payload: { message: chunk.payload.message }
    }
  }
  return null
}
