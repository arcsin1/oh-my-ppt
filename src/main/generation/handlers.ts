import { ipcMain } from 'electron'
import crypto from 'crypto'
import log from 'electron-log/main.js'
import { getSessionRunPageCounts } from '../ipc/runtime/session-run-state'
import { createEmitAssistantMessage } from './generation-utils'
import { executeDeckGeneration, resolveDeckContext } from './deck-flow'
import { executeTemplateDeckGeneration, resolveTemplateDeckContext } from './template-deck-flow'
import { executeRetryFailedPages, resolveRetryContext } from './retry-flow'
import type { DeckContext, RetryContext } from './types'
import {
  resolveAddPageContext,
  executeAddPageGeneration,
  type AddPageContext
} from './add-page-flow'
import {
  resolveRetrySinglePageContext,
  executeRetrySinglePageGeneration,
  type RetrySinglePageContext
} from './retry-single-page-flow'
import { finalizeGenerationFailure } from './finalization'
import { GenerateJobManager } from './job-manager'
import { JobCoordinator } from '../agent-runtime'
import type { GenerationContext } from './context'
import type { DeckEditJobService } from '../edit-jobs/deck-edit-job-service'
import type { PageEditJobService } from '../edit-jobs/page-edit-job-service'
import type { StyleSwitchJobService } from '../edit-jobs/style-switch-job-service'

export function registerGenerationHandlers(
  ctx: GenerationContext,
  coordinator: JobCoordinator,
  styleSwitchJobs: StyleSwitchJobService,
  pageEditJobs?: PageEditJobService,
  deckEditJobs?: DeckEditJobService
): GenerateJobManager {
  const { db, agentManager, sessionRuns, runtimeEmitters } = ctx
  const { sessionRunStates, pruneFinishedSessionRunStates } = sessionRuns
  const { emitGenerateChunk } = runtimeEmitters
  const emitAssistant = createEmitAssistantMessage(db, emitGenerateChunk)
  const jobManager = new GenerateJobManager(ctx, coordinator)
  const interruptedJobsReady = jobManager
    .abortInterruptedJobs('应用退出导致生成中断，可继续生成')
    .catch((error) => {
      log.warn('[generate:job] failed to abort interrupted jobs', {
        message: error instanceof Error ? error.message : String(error)
      })
    })

  const logPreContextFailure = (operation: string, sessionId: string, error: unknown): void => {
    log.error(`[${operation}] failed before context`, {
      sessionId,
      message: error instanceof Error ? error.message : String(error)
    })
  }

  const getSessionPageStatusSnapshot = async (
    sessionId: string
  ): Promise<{ completed: number; failedKeys: string[] }> => {
    const pages = await db.listSessionPages(sessionId)
    return {
      completed: pages.filter((page) => page.status === 'completed').length,
      failedKeys: pages
        .filter((page) => page.status === 'failed')
        .map((page) => page.file_slug || page.legacy_page_id || page.id)
        .filter((pageKey) => pageKey.length > 0)
    }
  }

  ipcMain.handle('generate:state', async (_event, rawSessionId: unknown) => {
    await interruptedJobsReady
    pruneFinishedSessionRunStates()
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : ''
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    const activeState = sessionRunStates.get(sessionId)
    if (activeState) {
      const pageCounts = getSessionRunPageCounts(activeState)
      return {
        sessionId,
        runId: activeState.runId,
        status: activeState.status,
        hasActiveRun: activeState.status === 'queued' || activeState.status === 'running',
        progress: activeState.progress,
        totalPages: activeState.totalPages,
        completedPageCount: pageCounts.completedPageCount,
        failedPageCount: pageCounts.failedPageCount,
        events: activeState.events,
        error: activeState.error,
        startedAt: activeState.startedAt,
        updatedAt: activeState.updatedAt,
        kind: activeState.kind,
        activityKind: activeState.activityKind,
        targetPageId: activeState.targetPageId,
        targetPageNumber: activeState.targetPageNumber
      }
    }

    const latestJob = await db.getLatestSessionJob(sessionId, [
      'standard',
      'template',
      'retry',
      'add-page',
      'single-page-retry'
    ])
    if (latestJob) {
      const generationRun = await db.getGenerationRun(latestJob.id)
      const session = await db.getSession(sessionId)
      const sessionRecord = (session || {}) as Record<string, unknown>
      const pageCount = Number(sessionRecord.page_count ?? sessionRecord.pageCount ?? 1) || 1
      const status =
        latestJob.status === 'pending'
          ? 'queued'
          : latestJob.status === 'active'
            ? 'running'
            : latestJob.status === 'aborted'
              ? generationRun?.error && /取消|cancel/i.test(generationRun.error)
                ? 'cancelled'
                : 'failed'
              : generationRun?.status === 'completed'
                ? 'completed'
                : generationRun?.status === 'failed' || generationRun?.status === 'partial'
                  ? 'failed'
                  : 'idle'
      return {
        sessionId,
        runId: latestJob.id,
        status,
        hasActiveRun: latestJob.status === 'pending' || latestJob.status === 'active',
        progress: status === 'completed' ? 100 : 0,
        totalPages: Math.max(1, Math.floor(generationRun?.total_pages || pageCount)),
        completedPageCount: 0,
        failedPageCount: 0,
        events: [],
        error: generationRun?.error || latestJob.abort_reason || null,
        startedAt: (latestJob.activated_at || latestJob.created_at) * 1000,
        updatedAt: latestJob.updated_at * 1000,
        kind: latestJob.kind,
        activityKind:
          generationRun?.mode === 'addPage'
            ? 'addPage'
            : generationRun?.mode === 'retrySinglePage'
              ? 'single-page-retry'
              : undefined,
        targetPageId: latestJob.target_page_id || undefined,
        targetPageNumber: latestJob.target_page_number || undefined
      }
    }

    const session = await db.getSession(sessionId)
    const sessionRecord = (session || {}) as Record<string, unknown>
    const sessionStatus = String(sessionRecord.status || 'active')
    const normalizedStatus =
      sessionStatus === 'completed' ? 'completed' : sessionStatus === 'failed' ? 'failed' : 'idle'
    const pageCount = Number(sessionRecord.page_count ?? sessionRecord.pageCount ?? 1) || 1
    return {
      sessionId,
      runId: null,
      status: normalizedStatus,
      hasActiveRun: false,
      progress: normalizedStatus === 'completed' ? 100 : 0,
      totalPages: Math.max(1, Math.floor(pageCount)),
      completedPageCount: 0,
      failedPageCount: 0,
      events: [],
      error: null,
      startedAt: null,
      updatedAt: null
    }
  })

  ipcMain.handle('generate:listActive', async () => {
    await interruptedJobsReady
    pruneFinishedSessionRunStates()
    const jobs = await db.listActiveSessionJobs([
      'standard',
      'template',
      'retry',
      'add-page',
      'single-page-retry'
    ])
    return jobs.flatMap((job) => {
      const state = sessionRunStates.get(job.session_id)
      if (state?.runId === job.id && state.status !== 'queued' && state.status !== 'running') {
        return []
      }
      return [
        {
          sessionId: job.session_id,
          runId: job.id,
          status: job.status === 'pending' ? 'queued' : 'running',
          hasActiveRun: true,
          progress: state?.progress ?? 0,
          totalPages: state?.totalPages ?? 1,
          ...(state
            ? getSessionRunPageCounts(state)
            : { completedPageCount: 0, failedPageCount: 0 }),
          events: state?.events ?? [],
          error: state?.error ?? null,
          startedAt: state?.startedAt ?? (job.activated_at || job.created_at) * 1000,
          updatedAt: state?.updatedAt ?? job.updated_at * 1000,
          kind: job.kind,
          activityKind:
            state?.activityKind ||
            (job.kind === 'add-page'
              ? 'addPage'
              : job.kind === 'single-page-retry'
                ? 'single-page-retry'
                : undefined),
          targetPageId: state?.targetPageId || job.target_page_id || undefined,
          targetPageNumber: state?.targetPageNumber || job.target_page_number || undefined
        }
      ]
    })
  })

  ipcMain.handle('generate:start', async (event, payload) => {
    await interruptedJobsReady
    pruneFinishedSessionRunStates()
    const requestedSessionId =
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { sessionId?: unknown }).sessionId === 'string'
        ? String((payload as { sessionId?: string }).sessionId).trim()
        : ''
    const reservation = requestedSessionId
      ? await jobManager.reserve('generate:start', requestedSessionId, crypto.randomUUID())
      : null
    if (reservation?.alreadyRunning) {
      return { success: true, runId: reservation.runId, alreadyRunning: true }
    }
    const reserved = reservation?.alreadyRunning === false ? reservation.reservation : null

    let context: DeckContext | null = null
    let handedToBackground = false
    try {
      const requestedType =
        payload && typeof payload === 'object' && (payload as { type?: unknown }).type === 'page'
          ? 'page'
          : 'deck'
      const requestedChatType =
        payload &&
        typeof payload === 'object' &&
        (payload as { chatType?: unknown }).chatType === 'main'
          ? 'main'
          : 'page'
      if (requestedType === 'page' && requestedChatType === 'page') {
        throw new Error('单页编辑请使用 page-edit:start')
      }
      if (requestedType === 'page' && requestedChatType === 'main') {
        throw new Error('主会话编辑请使用 deck-edit:start')
      }
      if (!reserved) throw new Error('生成任务 reservation 缺失')
      context = await resolveDeckContext(ctx, event, payload, {
        runId: reserved.jobId,
        abortSignal: reserved.signal
      })
      jobManager.assertNotCancelled(reserved)
      if (context.effectiveMode !== 'generate') {
        throw new Error('非主会话编辑不能进入通用生成队列')
      }
      const deckContext = context
      const result = await jobManager.enqueue({
        reservation: reserved,
        kind: 'standard',
        context: deckContext,
        totalPages: deckContext.totalPages,
        execute: (deckContext) => executeDeckGeneration(ctx, emitAssistant, deckContext)
      })
      handedToBackground = true
      return { success: true, runId: result.runId, queued: result.queued }
    } catch (error) {
      if (context && !handedToBackground) {
        await finalizeGenerationFailure(ctx, context, error)
      } else {
        logPreContextFailure('generate:start', requestedSessionId, error)
      }
      throw error
    } finally {
      if (!handedToBackground) {
        jobManager.release(reserved)
      }
      if (context && !handedToBackground) {
        agentManager.removeSession(context.sessionId)
      }
    }
  })

  ipcMain.handle('generate:switchStyle', async (event, payload) => {
    return styleSwitchJobs.start(event, payload)
  })

  ipcMain.handle('generate:retryStyleSwitch', async (event, payload) => {
    return styleSwitchJobs.retryFailed(event, payload)
  })

  ipcMain.handle('generate:retryDeckEdit', async (event, payload) => {
    await interruptedJobsReady
    pruneFinishedSessionRunStates()
    if (!deckEditJobs) throw new Error('deck-edit job service is unavailable')
    return deckEditJobs.retry(event, payload)
  })

  ipcMain.handle('generate:startTemplate', async (event, payload) => {
    await interruptedJobsReady
    pruneFinishedSessionRunStates()
    const requestedSessionId =
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { sessionId?: unknown }).sessionId === 'string'
        ? String((payload as { sessionId?: string }).sessionId).trim()
        : ''
    const reservation = requestedSessionId
      ? await jobManager.reserve('generate:startTemplate', requestedSessionId, crypto.randomUUID())
      : null
    if (reservation?.alreadyRunning) {
      return { success: true, runId: reservation.runId, alreadyRunning: true }
    }
    const reserved = reservation?.alreadyRunning === false ? reservation.reservation : null

    let context: Awaited<ReturnType<typeof resolveTemplateDeckContext>> | null = null
    let handedToBackground = false
    try {
      if (!reserved) throw new Error('生成任务 reservation 缺失')
      context = await resolveTemplateDeckContext(ctx, event, payload, {
        runId: reserved.jobId,
        abortSignal: reserved.signal
      })
      jobManager.assertNotCancelled(reserved)
      const templateBaseSnapshot = context.templateRetry
        ? await getSessionPageStatusSnapshot(context.sessionId)
        : { completed: 0, failedKeys: [] }
      const result = await jobManager.enqueue({
        reservation: reserved,
        kind: 'template',
        context,
        totalPages: context.totalPages,
        completedPageBaseCount: templateBaseSnapshot.completed,
        failedPageBaseKeys: templateBaseSnapshot.failedKeys,
        execute: (templateContext) =>
          executeTemplateDeckGeneration(ctx, emitAssistant, templateContext)
      })
      handedToBackground = true
      return { success: true, runId: result.runId, queued: result.queued }
    } catch (error) {
      if (context && !handedToBackground) {
        await finalizeGenerationFailure(ctx, context, error)
      } else {
        logPreContextFailure('generate:startTemplate', requestedSessionId, error)
      }
      throw error
    } finally {
      if (!handedToBackground) {
        jobManager.release(reserved)
      }
      if (context && !handedToBackground) {
        agentManager.removeSession(context.sessionId)
      }
    }
  })

  ipcMain.handle('generate:retryFailedPages', async (event, payload) => {
    await interruptedJobsReady
    pruneFinishedSessionRunStates()
    const requestedSessionId =
      payload &&
      typeof payload === 'object' &&
      typeof (payload as { sessionId?: unknown }).sessionId === 'string'
        ? String((payload as { sessionId?: string }).sessionId).trim()
        : ''
    const reservation = requestedSessionId
      ? await jobManager.reserve(
          'generate:retryFailedPages',
          requestedSessionId,
          crypto.randomUUID()
        )
      : null
    if (reservation?.alreadyRunning) {
      return { success: true, runId: reservation.runId, alreadyRunning: true }
    }

    const reserved = reservation?.alreadyRunning === false ? reservation.reservation : null
    let context: RetryContext | null = null
    let handedToBackground = false
    try {
      if (!reserved) throw new Error('生成任务 reservation 缺失')
      context = await resolveRetryContext(ctx, event, payload, {
        runId: reserved.jobId,
        abortSignal: reserved.signal
      })
      jobManager.assertNotCancelled(reserved)
      const retryTotalPages = Math.max(
        1,
        (await db.listLatestGenerationPageSnapshot(context.sessionId)).filter(
          (page) => page.status !== 'completed'
        ).length || context.totalPages
      )
      const retryBaseSnapshot = await getSessionPageStatusSnapshot(context.sessionId)
      jobManager.assertNotCancelled(reserved)
      const result = await jobManager.enqueue({
        reservation: reserved,
        kind: 'retry',
        context,
        totalPages: retryTotalPages,
        completedPageBaseCount: retryBaseSnapshot.completed,
        failedPageBaseKeys: retryBaseSnapshot.failedKeys,
        execute: (retryContext) => executeRetryFailedPages(ctx, emitAssistant, retryContext)
      })
      handedToBackground = true
      return { success: true, runId: result.runId, queued: result.queued }
    } catch (error) {
      if (context && !handedToBackground) {
        await finalizeGenerationFailure(ctx, context, error)
      } else {
        logPreContextFailure('generate:retryFailedPages', requestedSessionId, error)
      }
      throw error
    } finally {
      if (!handedToBackground) {
        jobManager.release(reserved)
      }
      if (context && !handedToBackground) {
        agentManager.removeSession(context.sessionId)
      }
    }
  })

  ipcMain.handle('generate:addPage', async (_event, payload) => {
    await interruptedJobsReady
    pruneFinishedSessionRunStates()
    const addPagePayload =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const requestedSessionId =
      typeof addPagePayload.sessionId === 'string' ? addPagePayload.sessionId.trim() : ''
    if (!requestedSessionId) {
      throw new Error('sessionId 不能为空')
    }
    const userMsg =
      typeof addPagePayload.userMessage === 'string' ? addPagePayload.userMessage.trim() : ''
    const targetPageId =
      typeof addPagePayload.targetPageId === 'string' ? addPagePayload.targetPageId.trim() : ''
    if (!userMsg) {
      throw new Error('userMessage is required for addPage')
    }

    const reservation = await jobManager.reserve(
      'generate:addPage',
      requestedSessionId,
      crypto.randomUUID()
    )
    if (reservation.alreadyRunning) {
      return { success: true, runId: reservation.runId, alreadyRunning: true }
    }

    const reserved = reservation.reservation
    let addPageCtx: AddPageContext | null = null
    let handedToBackground = false
    try {
      const insertAfter = Number(addPagePayload.insertAfterPageNumber) || 0

      // Resolve context independently — no shared resolveGenerationContext
      const modelConfigId =
        typeof addPagePayload.modelConfigId === 'string'
          ? addPagePayload.modelConfigId.trim()
          : undefined
      addPageCtx = await resolveAddPageContext(
        ctx,
        requestedSessionId,
        userMsg,
        insertAfter,
        modelConfigId,
        targetPageId || undefined,
        { runId: reserved.jobId, abortSignal: reserved.signal }
      )
      jobManager.assertNotCancelled(reserved)
      const addPageContext = addPageCtx
      if (!addPageContext) throw new Error('新增页面生成上下文缺失')

      // Persist user message
      await db.addMessage(addPageContext.sessionId, {
        role: 'user',
        content: userMsg,
        type: 'text',
        chat_scope: 'main' as const,
        run_model: addPageContext.runModel
      })
      jobManager.assertNotCancelled(reserved)
      const targetPage = addPageContext.targetPageId
        ? (await db.listSessionPages(addPageContext.sessionId)).find(
            (page) =>
              page.id === addPageContext.targetPageId ||
              page.file_slug === addPageContext.targetPageId
          )
        : undefined
      jobManager.assertNotCancelled(reserved)
      if (targetPage) {
        await db.upsertSessionPage({
          id: targetPage.id,
          sessionId: targetPage.session_id,
          legacyPageId: targetPage.legacy_page_id,
          fileSlug: targetPage.file_slug,
          pageNumber: targetPage.page_number,
          title: targetPage.title,
          htmlPath: targetPage.html_path,
          status: 'pending',
          error: null
        })
      }
      jobManager.assertNotCancelled(reserved)
      const result = await jobManager.enqueue({
        reservation: reserved,
        kind: 'add-page',
        context: addPageContext,
        totalPages: 1,
        activityKind: 'addPage',
        targetPageId: targetPage?.id || addPageContext.targetPageId,
        targetPageNumber: targetPage?.page_number,
        execute: (context) => executeAddPageGeneration(ctx, context)
      })
      handedToBackground = true
      return { success: true, runId: result.runId, queued: result.queued }
    } catch (error) {
      if (addPageCtx && !handedToBackground) {
        await finalizeGenerationFailure(ctx, addPageCtx, error)
      } else {
        logPreContextFailure('generate:addPage', requestedSessionId, error)
      }
      throw error
    } finally {
      if (!handedToBackground) {
        jobManager.release(reserved)
      }
      if (addPageCtx && !handedToBackground) {
        agentManager.removeSession(addPageCtx.sessionId)
      }
    }
  })

  ipcMain.handle('generate:retrySinglePage', async (_event, payload) => {
    await interruptedJobsReady
    pruneFinishedSessionRunStates()
    const addPagePayload =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const requestedSessionId =
      typeof addPagePayload.sessionId === 'string' ? addPagePayload.sessionId.trim() : ''
    const requestedPageId =
      typeof addPagePayload.pageId === 'string' ? addPagePayload.pageId.trim() : ''
    if (!requestedSessionId) {
      throw new Error('sessionId 不能为空')
    }
    if (!requestedPageId) {
      throw new Error('pageId 不能为空')
    }

    const reservation = await jobManager.reserve(
      'generate:retrySinglePage',
      requestedSessionId,
      crypto.randomUUID()
    )
    if (reservation.alreadyRunning) {
      return { success: true, runId: reservation.runId, alreadyRunning: true }
    }

    const reserved = reservation.reservation
    let retryCtx: RetrySinglePageContext | null = null
    let handedToBackground = false
    try {
      const modelConfigId =
        typeof addPagePayload.modelConfigId === 'string'
          ? addPagePayload.modelConfigId.trim()
          : undefined
      retryCtx = await resolveRetrySinglePageContext(
        ctx,
        requestedSessionId,
        requestedPageId,
        modelConfigId,
        { runId: reserved.jobId, abortSignal: reserved.signal }
      )
      jobManager.assertNotCancelled(reserved)
      const result = await jobManager.enqueue({
        reservation: reserved,
        kind: 'single-page-retry',
        context: retryCtx,
        totalPages: 1,
        activityKind: 'single-page-retry',
        targetPageId: retryCtx.pageId,
        targetPageNumber: retryCtx.pageNumber,
        execute: (context) => executeRetrySinglePageGeneration(ctx, context)
      })
      handedToBackground = true
      return { success: true, runId: result.runId, queued: result.queued }
    } catch (error) {
      if (retryCtx && !handedToBackground) {
        await finalizeGenerationFailure(ctx, retryCtx, error)
      } else {
        logPreContextFailure('generate:retrySinglePage', requestedSessionId, error)
      }
      throw error
    } finally {
      if (!handedToBackground) {
        jobManager.release(reserved)
      }
      if (retryCtx && !handedToBackground) {
        agentManager.removeSession(retryCtx.sessionId)
      }
    }
  })

  ipcMain.handle('generate:cancel', async (_event, sessionId) => {
    await interruptedJobsReady
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : ''
    const cancelSessionId = normalizedSessionId || String(sessionId || '')
    if (!cancelSessionId) return { success: true }
    if (await pageEditJobs?.cancel(cancelSessionId)) return { success: true }
    if (await deckEditJobs?.cancel(cancelSessionId)) return { success: true }
    const handledByJobManager = await jobManager.cancel(cancelSessionId)
    if (handledByJobManager) return { success: true }
    const activeState = sessionRunStates.get(cancelSessionId)
    if (activeState?.status === 'queued' || activeState?.status === 'running') {
      emitGenerateChunk(cancelSessionId, {
        type: 'run_error',
        payload: {
          runId: activeState.runId,
          message: '生成已取消'
        }
      })
    }
    return { success: true }
  })
  return jobManager
}
