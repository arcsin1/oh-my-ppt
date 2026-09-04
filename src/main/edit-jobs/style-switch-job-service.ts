import { ipcMain } from 'electron'
import crypto from 'crypto'
import path from 'path'
import log from 'electron-log/main.js'
import type { SessionStyleSnapshotRow } from '../db/database'
import type { IpcContext } from '../ipc/context'
import { resolveEditContext } from '../generation/edit-flow'
import { createGenerationContext } from '../generation/context'
import { buildStyleSwitchUserMessage } from '../generation/style-switch'
import { resolvePageHtmlPath } from '../generation/generation-utils'
import { isCancellationMessage, normalizeRestoredSessionStatus } from '../generation/status-utils'
import { buildDesignContractWithLLM } from '../generation/agent-runner'
import { ensureHistoryBaselineSafe, GitHistoryService } from '../history/git-history-service'
import { JobCoordinator, sessionLockKey } from '../agent-runtime'
import type { EditContext } from '../generation/types'
import type { GenerateChunkEvent } from '@shared/generation'
import { normalizeLayoutIntent } from '@shared/layout-intent'
import { resolveRetainedPageLayoutSource } from '../generation/layout-slot-validator'
import { runStyleSwitchPageFlow } from './style-switch-job-flow'
import {
  readStyleSwitchFileSnapshot,
  restoreStyleSwitchFileSnapshot
} from './style-switch-job-files'
import {
  STYLE_SWITCH_CONCURRENCY,
  type ActiveStyleSwitchJob,
  type StyleSwitchJobSnapshot,
  type StyleSwitchPageRef,
  type StyleSwitchRunMetadata
} from './style-switch-job-types'

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error || '风格切换失败')

class StyleSwitchCommittedPageFinalizationError extends Error {
  constructor(cause: unknown) {
    super(`页面历史已写入，但页面状态更新失败：${errorMessage(cause)}`)
    this.name = 'StyleSwitchCommittedPageFinalizationError'
  }
}

class StyleSwitchHistoryCommitError extends Error {
  constructor(cause: unknown) {
    super(`页面版本历史写入失败：${errorMessage(cause)}`)
    this.name = 'StyleSwitchHistoryCommitError'
  }
}

const readSessionDesignContract = (value: string | null | undefined): unknown =>
  parseJson<unknown>(value, null)

const toRelativeProjectPath = (projectDir: string, filePath: string): string => {
  const relative = path.relative(projectDir, filePath).split(path.sep).join('/')
  if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) {
    throw new Error(`风格切换页面路径不在项目目录内：${filePath}`)
  }
  return relative
}

export class StyleSwitchJobService {
  private activeJobs = new Map<string, ActiveStyleSwitchJob>()
  private reservedJobIds = new Map<string, string>()

  constructor(
    private ctx: IpcContext,
    private coordinator: JobCoordinator
  ) {}

  async start(
    event: Electron.IpcMainInvokeEvent,
    payload: unknown,
    options?: { pageIds?: string[]; sourceRunId?: string; retryCounts?: Record<string, number> }
  ): Promise<{
    success: boolean
    runId?: string
    styleId: string
    alreadyRunning?: boolean
    unchanged?: boolean
  }> {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const styleId = typeof record.styleId === 'string' ? record.styleId.trim() : ''
    const modelConfigId =
      typeof record.modelConfigId === 'string'
        ? record.modelConfigId.trim() || undefined
        : undefined
    if (!sessionId) throw new Error('sessionId 不能为空')
    if (!styleId) throw new Error('styleId 不能为空')

    const reservation = await this.coordinator.reserve({
      jobId: crypto.randomUUID(),
      domain: 'style',
      owner: { kind: 'session', id: sessionId },
      claims: { write: [sessionLockKey(sessionId)] },
      wait: 'fail'
    })
    if (reservation.status === 'busy') {
      return { success: true, styleId, runId: reservation.conflictingJobId, alreadyRunning: true }
    }

    const lease = reservation.lease
    this.reservedJobIds.set(sessionId, lease.jobId)
    let context: EditContext | null = null
    let jobCreated = false
    let previousStyleId: string | null = null
    let previousStyleSnapshot: SessionStyleSnapshotRow | null = null
    let previousDesignContract: unknown = null
    let targetSnapshotInstalled = false
    try {
      const style = this.ctx.db.getStyleRowSync(styleId)
      if (!style || style.active === false) throw new Error('选择的风格不存在或已停用')
      const session = await this.ctx.db.getSession(sessionId)
      if (!session) throw new Error('Session not found')
      previousStyleId = session.styleId
      previousStyleSnapshot = (await this.ctx.db.getSessionStyleSnapshot(sessionId)) || null
      previousDesignContract = readSessionDesignContract(session.designContract)

      const sessionPages = await this.ctx.db.listSessionPages(sessionId)
      const requestedPageIds = Array.from(new Set(options?.pageIds || []))
      const selectedPages =
        requestedPageIds.length > 0
          ? sessionPages.filter((page) => requestedPageIds.includes(page.file_slug))
          : sessionPages
      if (requestedPageIds.length > 0 && selectedPages.length !== requestedPageIds.length) {
        throw new Error('重试页面不存在或已被删除')
      }
      if (selectedPages.length === 0) throw new Error('没有可切换风格的页面')
      if (requestedPageIds.length === 0 && session.styleId === styleId) {
        return { success: true, styleId, unchanged: true }
      }

      await ensureHistoryBaselineSafe(
        this.ctx.db,
        sessionId,
        await this.ctx.resolveSessionProjectDir(sessionId)
      )
      await new GitHistoryService(this.ctx.db).captureCurrentVersionStyleState(sessionId)

      // resolveEditContext obtains its style prompt from the session snapshot. Keep the user-visible
      // session style unchanged until the first page history commit succeeds.
      await this.ctx.db.replaceSessionStyleSnapshot(sessionId, styleId)
      targetSnapshotInstalled = true
      context = await resolveEditContext(
        createGenerationContext(this.ctx),
        event,
        {
          sessionId,
          modelConfigId,
          userMessage: buildStyleSwitchUserMessage(style.styleName),
          type: 'page',
          chatType: 'main',
          selectPageIds: selectedPages.map((page) => page.file_slug),
          resetVisualStyle: true,
          persistUserMessage: false
        },
        { runId: lease.jobId, abortSignal: lease.signal }
      )
      if (context.runId !== lease.jobId) {
        throw new Error('风格切换 runId 与 JobCoordinator lease 不一致')
      }

      const latestPages = await this.ctx.db.listLatestGenerationPageSnapshot(sessionId)
      const latestByPageId = new Map(latestPages.map((page) => [page.page_id, page]))
      const projectDir = context.projectDir
      const pageRefs: StyleSwitchPageRef[] = selectedPages.map((page) => {
        const latest = latestByPageId.get(page.file_slug)
        return {
          id: page.id,
          pageId: page.file_slug,
          pageNumber: page.page_number,
          title: page.title || `第${page.page_number}页`,
          htmlPath: resolvePageHtmlPath({
            projectDir,
            fileSlug: page.file_slug,
            candidates: [page.html_path]
          }),
          contentOutline: latest?.content_outline || '',
          layoutIntent: page.layout_intent
            ? normalizeLayoutIntent(page.layout_intent)
            : latest?.layout_intent
              ? normalizeLayoutIntent(latest.layout_intent)
              : undefined,
          layoutId: page.layout_id || null,
          layoutContractVersion: page.layout_contract_version || null,
          retryCount: Math.max(0, Math.floor(options?.retryCounts?.[page.file_slug] || 0))
        }
      })
      pageRefs.sort((left, right) => left.pageNumber - right.pageNumber)

      const metadata: StyleSwitchRunMetadata = {
        jobType: 'style-switch',
        targetStyleId: style.id,
        targetStyleName: style.styleName,
        previousStyleId,
        previousStyleSnapshot,
        previousDesignContract,
        designContract: null,
        pageIds: pageRefs.map((page) => page.pageId),
        sourceRunId: options?.sourceRunId,
        userMessage: context.userMessage
      }
      await this.ctx.db.createGenerationRunWithSessionJobAndPages({
        run: {
          id: context.runId,
          sessionId,
          mode: 'style-switch',
          totalPages: pageRefs.length,
          modelConfigId: context.modelConfigId,
          metadata
        },
        job: {
          id: context.runId,
          sessionId,
          kind: 'style-switch',
          status: 'active',
          previousSessionStatus: normalizeRestoredSessionStatus(context.previousSessionStatus),
          totalPages: pageRefs.length
        },
        pages: pageRefs.map((page) => ({
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title,
          contentOutline: page.contentOutline,
          layoutIntent: page.layoutIntent,
          layoutId: page.layoutId,
          layoutContractVersion: page.layoutContractVersion,
          htmlPath: page.htmlPath,
          status: 'pending',
          retryCount: page.retryCount
        }))
      })
      jobCreated = true
      this.ctx.beginSessionRunState({
        sessionId,
        runId: context.runId,
        mode: 'style-switch',
        kind: 'style-switch',
        activityKind: 'style-switch',
        totalPages: pageRefs.length,
        previousSessionStatus: context.previousSessionStatus,
        status: 'running'
      })
      this.ctx.emitGenerateChunk(sessionId, {
        type: 'stage_started',
        payload: {
          runId: context.runId,
          stage: 'style-switch',
          label: context.appLocale === 'en' ? 'Preparing style switch' : '正在准备切换风格',
          progress: 0,
          totalPages: pageRefs.length
        }
      })

      const designContract = await buildDesignContractWithLLM({
        provider: context.provider,
        apiKey: context.apiKey,
        model: context.model,
        baseUrl: context.providerBaseUrl,
        maxTokens: context.maxTokens,
        modelRuntime: this.ctx.modelRuntime,
        modelTimeoutMs: context.modelTimeouts.design,
        temperature: this.ctx.DESIGN_CONTRACT_TEMPERATURE,
        styleId: context.styleId,
        styleSkillPrompt: context.styleSkill.prompt,
        styleKey: context.styleKey,
        styleName: context.styleName,
        styleVersion: context.styleVersion,
        appLocale: context.appLocale,
        totalPages: pageRefs.length,
        slideSize: context.slideSize,
        topic: context.topic,
        userMessage: context.userMessage,
        fontSelection: context.fontSelection,
        emit: this.ctx.createDeckProgressEmitter(sessionId, context.appLocale),
        runId: context.runId,
        signal: context.abortSignal
      })
      context.designContract = designContract
      await this.ctx.db.updateGenerationRunMetadata(context.runId, { ...metadata, designContract })

      const job: ActiveStyleSwitchJob = {
        sessionId,
        runId: context.runId,
        styleId,
        lease,
        context,
        pageRefs,
        previousStyleId,
        previousStyleSnapshot,
        previousDesignContract,
        designContract,
        styleStateCommitted: false,
        commitQueue: Promise.resolve(),
        fatalError: null
      }
      this.activeJobs.set(sessionId, job)
      void this.run(job)
      return { success: true, runId: context.runId, styleId }
    } catch (error) {
      const message = errorMessage(error)
      let terminalRunId: string | null = null
      let terminalCancelled = false
      if (jobCreated && context) {
        await this.markUnfinishedPagesFailed(context.runId, message)
        await this.ctx.db.updateSessionJobStatus(context.runId, 'aborted', {
          abortReason: lease.signal.aborted ? 'cancelled' : 'setup_failed'
        })
        await this.ctx.db.updateGenerationRunStatus(context.runId, 'failed', message)
        terminalRunId = context.runId
        terminalCancelled = lease.signal.aborted
      }
      if (targetSnapshotInstalled) {
        await this.ctx.db
          .restoreSessionStyleState(sessionId, previousStyleId, previousStyleSnapshot || undefined)
          .catch(() => undefined)
        await this.ctx.db
          .updateSessionDesignContract(sessionId, previousDesignContract)
          .catch(() => undefined)
      }
      if (context) {
        await this.ctx.db
          .updateSessionStatus(
            sessionId,
            normalizeRestoredSessionStatus(context.previousSessionStatus)
          )
          .catch(() => undefined)
      }
      if (terminalRunId) {
        this.ctx.emitGenerateChunk(sessionId, {
          type: 'run_error',
          payload: { runId: terminalRunId, message, cancelled: terminalCancelled }
        })
        this.ctx.emitRuntimeJobTerminal({
          sessionId,
          jobId: terminalRunId,
          domain: 'style',
          status: terminalCancelled ? 'cancelled' : 'failed',
          errorCode: terminalCancelled ? undefined : 'style_switch_setup_failed',
          errorMessage: terminalCancelled ? undefined : message
        })
      }
      throw error
    } finally {
      if (!this.activeJobs.has(sessionId)) {
        lease.release()
        this.reservedJobIds.delete(sessionId)
        if (context) this.ctx.agentManager.removeSession(context.sessionId)
      }
    }
  }

  async retryPage(
    event: Electron.IpcMainInvokeEvent,
    payload: unknown
  ): Promise<{ success: boolean; runId?: string; styleId: string; alreadyRunning?: boolean }> {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const pageId = typeof record.pageId === 'string' ? record.pageId.trim() : ''
    const failedRunId = typeof record.failedRunId === 'string' ? record.failedRunId.trim() : ''
    if (!sessionId || !pageId) throw new Error('重试风格切换缺少页面参数')
    const sourceRunId =
      failedRunId || (await this.ctx.db.getLatestSessionJob(sessionId, ['style-switch']))?.id
    if (!sourceRunId) throw new Error('没有可重试的风格切换任务')
    const sourceRun = await this.ctx.db.getGenerationRun(sourceRunId)
    if (!sourceRun || sourceRun.session_id !== sessionId) throw new Error('重试来源任务不存在')
    const failedPage = (await this.ctx.db.listGenerationPages(sourceRunId)).find(
      (page) => page.page_id === pageId && page.status === 'failed'
    )
    if (!failedPage) throw new Error('该页面不是可重试的失败页面')
    const metadata = parseJson<Partial<StyleSwitchRunMetadata>>(sourceRun.metadata, {})
    if (!metadata.targetStyleId) throw new Error('重试来源缺少目标风格')
    return this.start(
      event,
      { ...record, sessionId, styleId: metadata.targetStyleId },
      {
        pageIds: [pageId],
        sourceRunId,
        retryCounts: { [pageId]: failedPage.retry_count + 1 }
      }
    )
  }

  async retryFailed(
    event: Electron.IpcMainInvokeEvent,
    payload: unknown
  ): Promise<{
    success: boolean
    runId?: string
    styleId: string
    alreadyRunning?: boolean
    failedPageCount: number
  }> {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const failedRunId = typeof record.failedRunId === 'string' ? record.failedRunId.trim() : ''
    if (!sessionId) throw new Error('sessionId 不能为空')
    const sourceRunId =
      failedRunId || (await this.ctx.db.getLatestSessionJob(sessionId, ['style-switch']))?.id
    if (!sourceRunId) return { success: true, styleId: '', failedPageCount: 0 }
    const sourceRun = await this.ctx.db.getGenerationRun(sourceRunId)
    if (!sourceRun || sourceRun.session_id !== sessionId) throw new Error('重试来源任务不存在')
    const failedPages = (await this.ctx.db.listGenerationPages(sourceRunId)).filter(
      (page) => page.status === 'failed'
    )
    const failedPageIds = failedPages.map((page) => page.page_id)
    const metadata = parseJson<Partial<StyleSwitchRunMetadata>>(sourceRun.metadata, {})
    const styleId =
      typeof record.styleId === 'string' ? record.styleId.trim() : metadata.targetStyleId || ''
    if (!styleId) throw new Error('重试来源缺少目标风格')
    if (failedPageIds.length === 0) return { success: true, styleId, failedPageCount: 0 }
    const result = await this.start(
      event,
      { ...record, sessionId, styleId },
      {
        pageIds: failedPageIds,
        sourceRunId,
        retryCounts: Object.fromEntries(
          failedPages.map((page) => [page.page_id, page.retry_count + 1])
        )
      }
    )
    return { ...result, failedPageCount: failedPageIds.length }
  }

  async cancel(sessionId: string): Promise<boolean> {
    const job = this.activeJobs.get(sessionId)
    if (job) {
      return this.coordinator.cancel(job.lease.jobId)
    }
    const jobId = this.reservedJobIds.get(sessionId)
    return jobId ? this.coordinator.cancel(jobId) : false
  }

  async getState(sessionId: string): Promise<StyleSwitchJobSnapshot> {
    const active = this.activeJobs.get(sessionId)
    const activeState = this.ctx.sessionRunStates.get(sessionId)
    const job = active
      ? await this.ctx.db.getSessionJob(active.runId)
      : await this.ctx.db.getLatestSessionJob(sessionId, ['style-switch'])
    const run = job ? await this.ctx.db.getGenerationRun(job.id) : undefined
    const pages = run ? await this.ctx.db.listGenerationPages(run.id) : []
    const metadata = parseJson<Partial<StyleSwitchRunMetadata>>(run?.metadata, {})
    const completedPageCount = pages.filter((page) => page.status === 'completed').length
    const failedPageCount = pages.filter((page) => page.status === 'failed').length
    const activeJob = Boolean(active) || job?.status === 'active'
    const cancelled = job?.status === 'aborted' && job.abort_reason === 'cancelled'
    const status: StyleSwitchJobSnapshot['status'] = activeJob
      ? 'running'
      : cancelled
        ? 'cancelled'
        : run?.status === 'completed'
          ? 'completed'
          : run?.status === 'partial'
            ? 'partial'
            : run?.status === 'failed' || job?.status === 'aborted'
              ? 'failed'
              : 'idle'
    return {
      sessionId,
      runId: job?.id || null,
      status,
      hasActiveRun: activeJob,
      progress: activeState?.progress ?? (status === 'completed' ? 100 : 0),
      totalPages: job?.total_pages || run?.total_pages || pages.length || 1,
      completedPageCount,
      failedPageCount,
      targetStyleId: metadata.targetStyleId || null,
      targetStyleName: metadata.targetStyleName || null,
      pages: pages.map((page) => ({
        pageId: page.page_id,
        pageNumber: page.page_number,
        title: page.title,
        status: page.status,
        error: page.error,
        retryCount: page.retry_count
      })),
      error: run?.error || job?.abort_reason || null,
      startedAt:
        activeState?.startedAt ?? (job ? (job.activated_at || job.created_at) * 1000 : null),
      updatedAt: activeState?.updatedAt ?? (job ? job.updated_at * 1000 : null),
      kind: 'style-switch'
    }
  }

  async listActive(): Promise<StyleSwitchJobSnapshot[]> {
    const jobs = await this.ctx.db.listActiveSessionJobs(['style-switch'])
    return Promise.all(jobs.map((job) => this.getState(job.session_id)))
  }

  async abortInterruptedJobs(reason: string): Promise<void> {
    const jobs = await this.ctx.db.listActiveSessionJobs(['style-switch'])
    for (const job of jobs) {
      if (this.activeJobs.has(job.session_id)) continue
      const run = await this.ctx.db.getGenerationRun(job.id)
      const metadata = parseJson<Partial<StyleSwitchRunMetadata>>(run?.metadata, {})
      const pages = await this.ctx.db.listGenerationPages(job.id)
      const completed = pages.some((page) => page.status === 'completed')
      if (!completed) {
        await this.ctx.db
          .restoreSessionStyleState(
            job.session_id,
            metadata.previousStyleId || null,
            metadata.previousStyleSnapshot || undefined
          )
          .catch(() => undefined)
        await this.ctx.db
          .updateSessionDesignContract(job.session_id, metadata.previousDesignContract ?? null)
          .catch(() => undefined)
      }
      await this.markUnfinishedPagesFailed(job.id, reason)
      await this.ctx.db.updateSessionJobStatus(job.id, 'aborted', { abortReason: reason })
      await this.ctx.db.updateGenerationRunStatus(job.id, completed ? 'partial' : 'failed', reason)
      await this.ctx.db.updateSessionStatus(
        job.session_id,
        completed ? 'failed' : normalizeRestoredSessionStatus(job.previous_session_status)
      )
    }
  }

  private async run(job: ActiveStyleSwitchJob): Promise<void> {
    try {
      await this.runWorkers(job)
      await job.commitQueue
      if (job.lease.signal.aborted || job.fatalError) {
        const message = job.fatalError?.message || '生成已取消'
        await this.markUnfinishedPagesFailed(job.runId, message)
        const pages = await this.ctx.db.listGenerationPages(job.runId)
        const completedCount = pages.filter((page) => page.status === 'completed').length
        const failedCount = pages.filter((page) => page.status === 'failed').length
        await this.ctx.db.updateSessionJobStatus(job.runId, 'aborted', {
          abortReason: job.lease.signal.aborted ? 'cancelled' : message
        })
        await this.ctx.db.updateGenerationRunStatus(
          job.runId,
          completedCount > 0 ? 'partial' : 'failed',
          message
        )
        await this.ctx.db.updateSessionStatus(
          job.sessionId,
          completedCount > 0
            ? 'failed'
            : normalizeRestoredSessionStatus(job.context.previousSessionStatus)
        )
        if (!job.styleStateCommitted) await this.restoreInitialStyleState(job)
        this.ctx.emitGenerateChunk(job.sessionId, {
          type: 'run_error',
          payload: {
            runId: job.runId,
            message,
            cancelled: job.lease.signal.aborted,
            completedPageCount: completedCount,
            failedPageCount: failedCount
          }
        })
        this.ctx.emitRuntimeJobTerminal({
          sessionId: job.sessionId,
          jobId: job.runId,
          domain: 'style',
          status: job.lease.signal.aborted ? 'cancelled' : 'failed',
          errorCode: job.lease.signal.aborted ? undefined : 'style_switch_failed',
          errorMessage: job.lease.signal.aborted ? undefined : message
        })
        return
      }

      const pages = await this.ctx.db.listGenerationPages(job.runId)
      const completedCount = pages.filter((page) => page.status === 'completed').length
      const failedCount = pages.filter((page) => page.status === 'failed').length
      const runStatus = failedCount === 0 ? 'completed' : completedCount > 0 ? 'partial' : 'failed'
      await this.ctx.db.updateSessionJobStatus(job.runId, 'finished')
      await this.ctx.db.updateGenerationRunStatus(
        job.runId,
        runStatus,
        failedCount > 0 ? `${failedCount} 个页面切换失败` : null
      )
      await this.ctx.db.updateSessionStatus(job.sessionId, failedCount > 0 ? 'failed' : 'completed')
      await this.ctx.db.updateSessionMetadata(job.sessionId, {
        lastRunId: job.runId,
        entryMode: 'multi_page',
        styleSwitchTargetStyleId: job.styleId
      })
      await this.ctx.db.updateProjectStatus(job.context.projectId, 'draft')
      if (!job.styleStateCommitted) await this.restoreInitialStyleState(job)
      this.ctx.emitGenerateChunk(job.sessionId, {
        type: 'run_completed',
        payload: {
          runId: job.runId,
          totalPages: job.pageRefs.length,
          completedPageCount: completedCount,
          failedPageCount: failedCount
        }
      })
      this.ctx.emitRuntimeJobTerminal({
        sessionId: job.sessionId,
        jobId: job.runId,
        domain: 'style',
        status: 'completed'
      })
    } catch (error) {
      const message = errorMessage(error)
      log.error('[style-switch:job] run failed', {
        sessionId: job.sessionId,
        runId: job.runId,
        message
      })
      await this.markUnfinishedPagesFailed(job.runId, message)
      const pages = await this.ctx.db.listGenerationPages(job.runId)
      const completedCount = pages.filter((page) => page.status === 'completed').length
      await this.ctx.db.updateSessionJobStatus(job.runId, 'aborted', { abortReason: message })
      await this.ctx.db.updateGenerationRunStatus(
        job.runId,
        completedCount > 0 ? 'partial' : 'failed',
        message
      )
      await this.ctx.db.updateSessionStatus(
        job.sessionId,
        completedCount > 0
          ? 'failed'
          : normalizeRestoredSessionStatus(job.context.previousSessionStatus)
      )
      if (!job.styleStateCommitted) await this.restoreInitialStyleState(job)
      this.ctx.emitGenerateChunk(job.sessionId, {
        type: 'run_error',
        payload: {
          runId: job.runId,
          message,
          cancelled: job.lease.signal.aborted,
          completedPageCount: completedCount,
          failedPageCount: pages.filter((page) => page.status === 'failed').length
        }
      })
      this.ctx.emitRuntimeJobTerminal({
        sessionId: job.sessionId,
        jobId: job.runId,
        domain: 'style',
        status: job.lease.signal.aborted ? 'cancelled' : 'failed',
        errorCode: job.lease.signal.aborted ? undefined : 'style_switch_failed',
        errorMessage: job.lease.signal.aborted ? undefined : message
      })
    } finally {
      this.ctx.agentManager.removeSession(job.sessionId)
      this.activeJobs.delete(job.sessionId)
      this.reservedJobIds.delete(job.sessionId)
      job.lease.release()
    }
  }

  private async runWorkers(job: ActiveStyleSwitchJob): Promise<void> {
    const pageQueue = [...job.pageRefs]
    const worker = async (): Promise<void> => {
      while (!job.lease.signal.aborted && !job.fatalError) {
        const page = pageQueue.shift()
        if (!page) return
        await this.runPage(job, page)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(STYLE_SWITCH_CONCURRENCY, pageQueue.length) }, () => worker())
    )
  }

  private async runPage(job: ActiveStyleSwitchJob, page: StyleSwitchPageRef): Promise<void> {
    const pageSnapshot = await readStyleSwitchFileSnapshot(page.htmlPath)
    const indexPath = path.join(job.context.projectDir, 'index.html')
    const indexSnapshot = await readStyleSwitchFileSnapshot(indexPath)
    try {
      if (job.lease.signal.aborted) throw new Error('生成已取消')
      await this.ctx.db.upsertGenerationPage({
        runId: job.runId,
        sessionId: job.sessionId,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: page.contentOutline,
        layoutIntent: page.layoutIntent,
        layoutId: page.layoutId,
        layoutContractVersion: page.layoutContractVersion,
        htmlPath: page.htmlPath,
        status: 'running',
        retryCount: page.retryCount
      })
      this.ctx.emitGenerateChunk(job.sessionId, {
        type: 'page_started',
        payload: {
          runId: job.runId,
          stage: 'style-switch',
          label:
            job.context.appLocale === 'en'
              ? `Editing P${page.pageNumber}`
              : `正在切换 P${page.pageNumber} 风格`,
          progress: 0,
          currentPage: page.pageNumber,
          totalPages: job.pageRefs.length,
          pageNumber: page.pageNumber,
          pageId: page.pageId,
          title: page.title,
          htmlPath: page.htmlPath
        }
      })
      const html = await runStyleSwitchPageFlow({
        ctx: this.ctx,
        job,
        page,
        indexPath,
        indexSnapshot,
        emitProgress: (chunk) => this.emitPageProgress(job, page, chunk)
      })
      if (!pageSnapshot.exists || pageSnapshot.content === html) {
        throw new Error('当前页面编辑没有检测到落盘变化。')
      }
      await this.enqueueCommit(job, async () => this.commitPage(job, page, html))
    } catch (error) {
      const message = errorMessage(error)
      const historyAlreadyCommitted = error instanceof StyleSwitchCommittedPageFinalizationError
      const historyCommitFailed = error instanceof StyleSwitchHistoryCommitError
      if (!historyAlreadyCommitted) {
        await restoreStyleSwitchFileSnapshot(page.htmlPath, pageSnapshot).catch((restoreError) => {
          log.error('[style-switch:job] page rollback failed', {
            sessionId: job.sessionId,
            runId: job.runId,
            pageId: page.pageId,
            message: errorMessage(restoreError)
          })
        })
      }
      if (!historyAlreadyCommitted && /index\.html/i.test(message)) {
        await restoreStyleSwitchFileSnapshot(indexPath, indexSnapshot).catch((restoreError) => {
          log.error('[style-switch:job] index rollback failed', {
            sessionId: job.sessionId,
            runId: job.runId,
            pageId: page.pageId,
            message: errorMessage(restoreError)
          })
        })
      }
      const cancelled = job.lease.signal.aborted || isCancellationMessage(message)
      await this.ctx.db.upsertGenerationPage({
        runId: job.runId,
        sessionId: job.sessionId,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: page.contentOutline,
        layoutIntent: page.layoutIntent,
        layoutId: page.layoutId,
        layoutContractVersion: page.layoutContractVersion,
        htmlPath: page.htmlPath,
        status: 'failed',
        error: message,
        retryCount: page.retryCount
      })
      this.ctx.emitGenerateChunk(job.sessionId, {
        type: 'page_failed',
        payload: {
          runId: job.runId,
          stage: 'style-switch',
          label:
            job.context.appLocale === 'en'
              ? `P${page.pageNumber} failed`
              : `P${page.pageNumber} 切换失败`,
          progress: 0,
          currentPage: page.pageNumber,
          totalPages: job.pageRefs.length,
          pageNumber: page.pageNumber,
          pageId: page.pageId,
          title: page.title,
          htmlPath: page.htmlPath,
          error: message
        }
      })
      if (
        !cancelled &&
        (historyAlreadyCommitted ||
          historyCommitFailed ||
          /index\.html|历史记录|history/i.test(message))
      ) {
        job.fatalError = new Error(message)
        this.coordinator.cancel(job.lease.jobId)
      }
    }
  }

  private async commitPage(
    job: ActiveStyleSwitchJob,
    page: StyleSwitchPageRef,
    html: string
  ): Promise<void> {
    // A page may finish agent work while an earlier page is still committing. Do not let a
    // cancelled job turn that queued result into a durable page version.
    this.assertCommitNotCancelled(job)
    const existingPage = (
      await this.ctx.db.listSessionPages(job.sessionId, { includeDeleted: true })
    ).find((candidate) => candidate.id === page.id || candidate.file_slug === page.pageId)
    const previousPage = existingPage ? { ...existingPage } : null
    const retainedLayoutSource = resolveRetainedPageLayoutSource({
      html,
      layoutIntent: page.layoutIntent || null,
      layoutId: page.layoutId,
      layoutContractVersion: page.layoutContractVersion
    })
    const relativePath = toRelativeProjectPath(job.context.projectDir, page.htmlPath)
    let appliedStyleState = false
    try {
      if (!job.styleStateCommitted) {
        await this.ctx.db.updateSessionStyleId(job.sessionId, job.styleId)
        await this.ctx.db.updateSessionDesignContract(job.sessionId, job.designContract)
        appliedStyleState = true
      }
      // Git is the durability boundary. A page is not marked completed until this per-page
      // history operation has succeeded.
      this.assertCommitNotCancelled(job)
      const history = new GitHistoryService(this.ctx.db)
      let operation
      try {
        operation = await history.recordOperation({
          sessionId: job.sessionId,
          projectDir: job.context.projectDir,
          type: 'edit',
          scope: 'page',
          prompt: `切换风格 · 第 ${page.pageNumber} 页`,
          allowedPaths: [relativePath],
          metadata: {
            runId: job.runId,
            jobType: 'style-switch',
            pageId: page.pageId,
            pageNumber: page.pageNumber,
            styleId: job.styleId,
            styleName: job.context.styleName || null,
            retryCount: page.retryCount
          }
        })
      } catch (error) {
        const fatalError = new StyleSwitchHistoryCommitError(error)
        job.fatalError = fatalError
        this.coordinator.cancel(job.lease.jobId)
        throw fatalError
      }
      if (!operation?.after_commit) {
        const fatalError = new StyleSwitchHistoryCommitError('未生成 Git 提交')
        job.fatalError = fatalError
        this.coordinator.cancel(job.lease.jobId)
        throw fatalError
      }
      try {
        await this.ctx.db.upsertSessionPage({
          id: existingPage?.id || page.id,
          sessionId: job.sessionId,
          legacyPageId:
            existingPage?.legacy_page_id || (page.pageId.match(/^page-\d+$/) ? page.pageId : null),
          fileSlug: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title,
          htmlPath: page.htmlPath,
          layoutIntent: retainedLayoutSource.layoutIntent,
          layoutId: retainedLayoutSource.layoutId,
          layoutContractVersion: retainedLayoutSource.layoutContractVersion,
          status: 'completed',
          error: null
        })
        await this.ctx.db.upsertGenerationPage({
          runId: job.runId,
          sessionId: job.sessionId,
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title,
          contentOutline: page.contentOutline,
          layoutIntent: retainedLayoutSource.layoutIntent,
          layoutId: retainedLayoutSource.layoutId,
          layoutContractVersion: retainedLayoutSource.layoutContractVersion,
          htmlPath: page.htmlPath,
          status: 'completed',
          retryCount: page.retryCount
        })
      } catch (error) {
        try {
          await history.rollbackCommittedOperation({
            sessionId: job.sessionId,
            projectDir: job.context.projectDir,
            operation,
            allowedPaths: [relativePath],
            reason: errorMessage(error)
          })
        } catch (compensationError) {
          const fatalError = new StyleSwitchCommittedPageFinalizationError(compensationError)
          job.fatalError = fatalError
          this.coordinator.cancel(job.lease.jobId)
          throw fatalError
        }
        throw new StyleSwitchHistoryCommitError(error)
      }
      job.styleStateCommitted = true
      // History is already durable. A renderer notification failure must not make the page look
      // failed or roll its file back after the commit.
      try {
        this.ctx.emitGenerateChunk(job.sessionId, {
          type: 'page_updated',
          payload: {
            runId: job.runId,
            stage: 'style-switch',
            label:
              job.context.appLocale === 'en'
                ? `P${page.pageNumber} saved`
                : `P${page.pageNumber} 已保存到历史版本`,
            progress: 100,
            currentPage: page.pageNumber,
            totalPages: job.pageRefs.length,
            id: page.id,
            pageNumber: page.pageNumber,
            title: page.title,
            html,
            htmlPath: page.htmlPath,
            pageId: page.pageId,
            sourceUrl: this.ctx.getPageSourceUrl(page.htmlPath),
            pageCommitReady: true
          }
        })
      } catch (error) {
        log.warn('[style-switch:job] page commit notification failed', {
          sessionId: job.sessionId,
          runId: job.runId,
          pageId: page.pageId,
          message: errorMessage(error)
        })
      }
    } catch (error) {
      if (previousPage) {
        await this.ctx.db.upsertSessionPage({
          id: previousPage.id,
          sessionId: previousPage.session_id,
          legacyPageId: previousPage.legacy_page_id,
          fileSlug: previousPage.file_slug,
          pageNumber: previousPage.page_number,
          title: previousPage.title,
          htmlPath: previousPage.html_path,
          layoutIntent: previousPage.layout_intent
            ? normalizeLayoutIntent(previousPage.layout_intent)
            : null,
          layoutId: previousPage.layout_id || null,
          layoutContractVersion: previousPage.layout_contract_version || null,
          status: previousPage.status,
          error: previousPage.error
        })
      }
      if (appliedStyleState && !job.styleStateCommitted) await this.restoreInitialStyleState(job)
      throw error
    }
  }

  private emitPageProgress(
    job: ActiveStyleSwitchJob,
    page: StyleSwitchPageRef,
    chunk: GenerateChunkEvent
  ): void {
    if (
      chunk.type === 'assistant_message' ||
      chunk.type === 'run_completed' ||
      chunk.type === 'run_error'
    )
      return
    this.ctx.emitGenerateChunk(job.sessionId, {
      ...chunk,
      payload: {
        ...chunk.payload,
        runId: job.runId,
        currentPage: page.pageNumber,
        totalPages: job.pageRefs.length
      }
    } as GenerateChunkEvent)
  }

  private async enqueueCommit(
    job: ActiveStyleSwitchJob,
    operation: () => Promise<void>
  ): Promise<void> {
    const guardedOperation = async (): Promise<void> => {
      this.assertCommitNotCancelled(job)
      if (job.fatalError) throw job.fatalError
      await operation()
    }
    const next = job.commitQueue.then(guardedOperation, guardedOperation)
    job.commitQueue = next.catch(() => undefined)
    await next
  }

  private assertCommitNotCancelled(job: ActiveStyleSwitchJob): void {
    if (job.lease.signal.aborted) throw new Error('生成已取消')
  }

  private async markUnfinishedPagesFailed(runId: string, reason: string): Promise<void> {
    const pages = await this.ctx.db.listGenerationPages(runId)
    await Promise.all(
      pages
        .filter((page) => page.status !== 'completed' && page.status !== 'failed')
        .map((page) =>
          this.ctx.db.upsertGenerationPage({
            runId: page.run_id,
            sessionId: page.session_id,
            pageId: page.page_id,
            pageNumber: page.page_number,
            title: page.title,
            contentOutline: page.content_outline,
            layoutIntent: page.layout_intent,
            layoutId: page.layout_id,
            layoutContractVersion: page.layout_contract_version,
            htmlPath: page.html_path,
            status: 'failed',
            error: reason,
            retryCount: page.retry_count
          })
        )
    )
  }

  private async restoreInitialStyleState(job: ActiveStyleSwitchJob): Promise<void> {
    await this.ctx.db
      .restoreSessionStyleState(
        job.sessionId,
        job.previousStyleId,
        job.previousStyleSnapshot || undefined
      )
      .catch((error) => {
        log.error('[style-switch:job] failed to restore style state', {
          sessionId: job.sessionId,
          runId: job.runId,
          message: errorMessage(error)
        })
      })
    await this.ctx.db
      .updateSessionDesignContract(job.sessionId, job.previousDesignContract)
      .catch(() => undefined)
  }
}

export function registerStyleSwitchJobHandlers(
  ctx: IpcContext,
  coordinator: JobCoordinator
): StyleSwitchJobService {
  const service = new StyleSwitchJobService(ctx, coordinator)
  const interruptedReady = service
    .abortInterruptedJobs('应用退出导致风格切换中断，可重试')
    .catch((error) => {
      log.warn('[style-switch:job] failed to abort interrupted jobs', {
        message: errorMessage(error)
      })
    })
  ipcMain.handle('style-switch:start', async (event, payload) => {
    await interruptedReady
    return service.start(event, payload)
  })
  ipcMain.handle('style-switch:retryPage', async (event, payload) => {
    await interruptedReady
    return service.retryPage(event, payload)
  })
  ipcMain.handle('style-switch:retryFailed', async (event, payload) => {
    await interruptedReady
    return service.retryFailed(event, payload)
  })
  ipcMain.handle('style-switch:cancel', async (_event, rawSessionId) => {
    await interruptedReady
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : ''
    return { success: sessionId ? await service.cancel(sessionId) : true }
  })
  ipcMain.handle('style-switch:state', async (_event, rawSessionId) => {
    await interruptedReady
    const sessionId = typeof rawSessionId === 'string' ? rawSessionId.trim() : ''
    if (!sessionId) throw new Error('sessionId 不能为空')
    return service.getState(sessionId)
  })
  ipcMain.handle('style-switch:listActive', async () => {
    await interruptedReady
    return service.listActive()
  })
  return service
}
