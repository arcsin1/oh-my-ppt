import log from 'electron-log/main.js'
import type { SessionJobKind } from '../db/database'
import type { FinalizeContext } from './types'
import type { GenerationContext } from './context'
import {
  finalizeGenerationFailure,
  resolveGenerationFailureSessionStatus
} from './finalization'
import { isCancellationMessage, normalizeRestoredSessionStatus } from './status-utils'
import { JobCoordinator, sessionLockKey, type JobLease } from '../agent-runtime'

const MAX_ACTIVE_GENERATION_JOBS = 2

export type GenerateJobReservation = JobLease

type BackgroundJob<TContext extends FinalizeContext> = {
  sessionId: string
  runId: string
  kind: SessionJobKind
  context: TContext
  totalPages: number
  status: 'pending' | 'active' | 'settling'
  reservedCapacitySlot: boolean
  reservation: GenerateJobReservation
  execute: (context: TContext) => Promise<void>
  pendingCancellation?: Promise<void>
  removeAbortListener: () => void
}

export class GenerateJobManager {
  private ctx: GenerationContext
  private jobsBySession = new Map<string, BackgroundJob<FinalizeContext>>()
  private pendingQueue: Array<BackgroundJob<FinalizeContext>> = []
  private activeCount = 0
  private startingCount = 0

  private coordinator: JobCoordinator

  constructor(ctx: GenerationContext, coordinator = new JobCoordinator()) {
    this.ctx = ctx
    this.coordinator = coordinator
  }

  async reserve(
    operation: string,
    sessionId: string,
    runId: string
  ): Promise<
    | { alreadyRunning: true; runId?: string }
    | { alreadyRunning: false; reservation: GenerateJobReservation }
  > {
    const existingJob = this.jobsBySession.get(sessionId)
    if (existingJob) {
      return { alreadyRunning: true, runId: existingJob.runId }
    }
    const existingRunState = this.ctx.sessionRuns.sessionRunStates.get(sessionId)
    if (existingRunState?.status === 'queued' || existingRunState?.status === 'running') {
      return { alreadyRunning: true, runId: existingRunState.runId }
    }
    const result = await this.coordinator.reserve({
      jobId: runId,
      domain: 'generation',
      owner: { kind: 'session', id: sessionId },
      claims: { write: [sessionLockKey(sessionId)] },
      wait: 'fail'
    })
    if (result.status === 'busy') {
      return { alreadyRunning: true, runId: result.conflictingJobId }
    }
    log.info('[generate:job] reserved', { sessionId, runId, operation })
    return { alreadyRunning: false, reservation: result.lease }
  }

  assertNotCancelled(reservation: GenerateJobReservation | null | undefined): void {
    if (reservation?.signal.aborted) {
      throw new Error('生成已取消')
    }
  }

  release(reservation: GenerateJobReservation | null | undefined): void {
    if (!reservation) return
    reservation.release()
  }

  async enqueue<TContext extends FinalizeContext>(args: {
    reservation: GenerateJobReservation
    kind: Extract<
      SessionJobKind,
      'standard' | 'template' | 'retry' | 'add-page' | 'single-page-retry'
    >
    context: TContext
    totalPages: number
    activityKind?:
      | 'page-edit'
      | 'edit'
      | 'style-switch'
      | 'single-page-retry'
      | 'addPage'
    targetPageId?: string
    targetPageNumber?: number
    completedPageBaseCount?: number
    failedPageBaseKeys?: string[]
    execute: (context: TContext) => Promise<void>
  }): Promise<{ runId: string; queued: boolean }> {
    const {
      reservation,
      context,
      kind,
      totalPages,
      activityKind,
      targetPageId,
      targetPageNumber,
      completedPageBaseCount,
      failedPageBaseKeys,
      execute
    } = args
    const runId = context.runId
    if (reservation.jobId !== runId) {
      throw new Error(`Generation reservation jobId mismatch: expected ${runId}`)
    }
    this.assertNotCancelled(reservation)

    const willRunNow = this.activeCount + this.startingCount < MAX_ACTIVE_GENERATION_JOBS
    if (willRunNow) {
      this.startingCount += 1
    }
    let runCreated = false
    let jobCreated = false

    try {
      await this.ctx.db.createGenerationRunWithSessionJob({
        run: {
          id: runId,
          sessionId: context.sessionId,
          mode: context.effectiveMode,
          totalPages,
          modelConfigId: context.modelConfigId,
          animationPreferences: context.animationPreferences || null,
          metadata: {
            backgroundJob: true,
            kind,
            jobKind: kind
          }
        },
        job: {
          id: runId,
          sessionId: context.sessionId,
          kind,
          status: willRunNow ? 'active' : 'pending',
          previousSessionStatus: normalizeRestoredSessionStatus(context.previousSessionStatus),
          totalPages
        }
      })
      runCreated = true
      jobCreated = true
      this.assertNotCancelled(reservation)

      const state = this.ctx.sessionRuns.beginSessionRunState({
        sessionId: context.sessionId,
        runId,
        mode: context.effectiveMode,
        kind,
        activityKind,
        targetPageId,
        targetPageNumber,
        totalPages,
        previousSessionStatus: context.previousSessionStatus,
        status: willRunNow ? 'running' : 'queued',
        completedPageBaseCount,
        failedPageBaseKeys
      })
      this.ctx.runtimeEmitters.emitSessionRunLifecycle(state)

      const job: BackgroundJob<FinalizeContext> = {
        sessionId: context.sessionId,
        runId,
        kind,
        context,
        totalPages,
        status: 'pending',
        reservedCapacitySlot: willRunNow,
        reservation,
        execute: execute as (context: FinalizeContext) => Promise<void>,
        removeAbortListener: () => undefined
      }
      this.jobsBySession.set(context.sessionId, job)
      this.watchCancellation(job)

      if (willRunNow) {
        this.startJob(job, { reservedSlot: true })
      } else {
        this.pendingQueue.push(job)
        this.ctx.runtimeEmitters.emitGenerateChunk(context.sessionId, {
          type: 'stage_started',
          payload: {
            runId,
            stage: 'queued',
            label: '排队中',
            progress: 0,
            totalPages
          }
        })
        log.info('[generate:job] queued', { sessionId: context.sessionId, runId, kind })
      }

      return { runId, queued: !willRunNow }
    } catch (error) {
      if (willRunNow) {
        this.startingCount = Math.max(0, this.startingCount - 1)
      }
      const message =
        error instanceof Error ? error.message : String(error || 'Generation job setup failed')
      if (jobCreated) {
        await this.ctx.db
          .updateSessionJobStatus(runId, 'aborted', {
            abortReason: isCancellationMessage(message) ? 'cancelled' : 'setup_failed'
          })
          .catch((statusError) => {
            log.warn('[generate:job] failed to abort partially created job', {
              sessionId: context.sessionId,
              runId,
              message: statusError instanceof Error ? statusError.message : String(statusError)
            })
          })
      }
      if (runCreated) {
        const settled = await Promise.allSettled([
          this.ctx.db.updateGenerationRunStatus(runId, 'failed', message),
          this.ctx.db.updateSessionStatus(
            context.sessionId,
            normalizeRestoredSessionStatus(context.previousSessionStatus)
          )
        ])
        settled.forEach((result) => {
          if (result.status === 'rejected') {
            log.warn('[generate:job] failed to clean up partial job setup', {
              sessionId: context.sessionId,
              runId,
              message:
                result.reason instanceof Error ? result.reason.message : String(result.reason)
            })
          }
        })
      }
      this.release(reservation)
      throw error
    }
  }

  async cancel(sessionId: string): Promise<boolean> {
    const job = this.jobsBySession.get(sessionId)
    if (job?.status === 'settling') return false
    const activeJob = this.coordinator.getByOwner({ kind: 'session', id: sessionId })
    const cancelled = activeJob ? this.coordinator.cancel(activeJob.jobId) : false
    if (!job) return cancelled
    if (job.status === 'pending') {
      await this.cancelPendingJob(job)
      return cancelled || Boolean(job.pendingCancellation)
    }
    return true
  }

  async abortInterruptedJobs(reason: string): Promise<void> {
    const activeJobs = await this.ctx.db.listActiveSessionJobs([
      'standard',
      'template',
      'retry',
      'add-page',
      'single-page-retry'
    ])
    for (const job of activeJobs) {
      if (this.jobsBySession.has(job.session_id)) continue
      const reservation = this.coordinator.getByOwner({ kind: 'session', id: job.session_id })
      if (reservation?.jobId === job.id) continue
      const generationRun = await this.ctx.db.getGenerationRun(job.id)
      if (generationRun?.status === 'completed' || generationRun?.status === 'partial') {
        await this.ctx.db.updateSessionJobStatus(job.id, 'finished')
        continue
      }
      await this.ctx.db.updateSessionJobStatus(job.id, 'aborted', { abortReason: reason })
      await this.ctx.db.updateGenerationRunStatus(job.id, 'failed', reason)
      await this.ctx.db.updateSessionStatus(
        job.session_id,
        normalizeRestoredSessionStatus(job.previous_session_status)
      )
    }
  }

  private startJob(
    job: BackgroundJob<FinalizeContext>,
    options?: { reservedSlot?: boolean }
  ): void {
    if (this.jobsBySession.get(job.sessionId) !== job || job.reservation.signal.aborted) {
      void this.cancelPendingJob(job)
      return
    }
    job.status = 'active'
    if (options?.reservedSlot) {
      this.startingCount = Math.max(0, this.startingCount - 1)
      job.reservedCapacitySlot = false
    }
    this.activeCount += 1
    void this.activateAndRunJob(job, !options?.reservedSlot)
  }

  private async activateAndRunJob(
    job: BackgroundJob<FinalizeContext>,
    emitStarted: boolean
  ): Promise<void> {
    try {
      await this.ctx.db.updateSessionJobStatus(job.runId, 'active')
    } catch (error) {
      log.warn('[generate:job] failed to mark active', {
        sessionId: job.sessionId,
        runId: job.runId,
        message: error instanceof Error ? error.message : String(error)
      })
      await this.runJob(job, error)
      return
    }

    const state = this.ctx.sessionRuns.sessionRunStates.get(job.sessionId)
    if (state?.runId === job.runId) {
      state.status = 'running'
      state.updatedAt = Date.now()
    }
    log.info('[generate:job] start', {
      sessionId: job.sessionId,
      runId: job.runId,
      kind: job.kind
    })
    if (emitStarted) {
      this.ctx.runtimeEmitters.emitRuntimeJobStarted({
        sessionId: job.sessionId,
        jobId: job.runId,
        domain: 'generation'
      })
    }
    await this.runJob(job)
  }

  private async runJob(job: BackgroundJob<FinalizeContext>, activationError?: unknown): Promise<void> {
    try {
      try {
        if (activationError) throw activationError
        await job.execute(job.context)
        this.assertNotCancelled(job.reservation)
        // execute() only resolves after generation, history, and session state have committed.
        // Keep the lease until its session-job row is durable, but do not let a late cancel
        // turn that already committed success into a contradictory cancelled run.
        job.status = 'settling'
      } catch (error) {
        await this.settleFailedJob(job, error)
        return
      }

      try {
        await this.ctx.db.updateSessionJobStatus(job.runId, 'finished')
      } catch (error) {
        log.error('[generate:job] failed to settle completed session job', {
          sessionId: job.sessionId,
          runId: job.runId,
          message: error instanceof Error ? error.message : String(error || '')
        })
        return
      }
      this.ctx.runtimeEmitters.emitRuntimeJobTerminal({
        sessionId: job.sessionId,
        jobId: job.runId,
        domain: 'generation',
        status: 'completed'
      })
    } finally {
      job.removeAbortListener()
      this.ctx.agentManager.removeSession(job.sessionId)
      this.jobsBySession.delete(job.sessionId)
      this.release(job.reservation)
      this.activeCount = Math.max(0, this.activeCount - 1)
      this.processQueue()
    }
  }

  private async settleFailedJob(job: BackgroundJob<FinalizeContext>, error: unknown): Promise<void> {
      const message = error instanceof Error ? error.message : String(error || '')
      const cancelled = job.reservation.signal.aborted || isCancellationMessage(message)
      let terminalStatePersisted = false
      let finalizationFailed = false
      try {
        await finalizeGenerationFailure(
          this.ctx,
          job.context,
          cancelled ? new Error('生成已取消') : error
        )
        terminalStatePersisted = true
      } catch (finalizeError) {
        finalizationFailed = true
        log.error('[generate:job] failed to finalize generation', {
          sessionId: job.sessionId,
          runId: job.runId,
          message:
            finalizeError instanceof Error ? finalizeError.message : String(finalizeError || '')
        })
        const fallbackResults = await Promise.allSettled([
          this.ctx.db.updateGenerationRunStatus(
            job.runId,
            'failed',
            message || 'Generation failed'
          ),
          this.ctx.db.updateSessionStatus(
            job.sessionId,
            resolveGenerationFailureSessionStatus(job.context, cancelled)
          )
        ])
        terminalStatePersisted = fallbackResults.every((result) => result.status === 'fulfilled')
        if (!terminalStatePersisted) {
          const failure = fallbackResults.find((result) => result.status === 'rejected')
          log.error('[generate:job] failed to persist fallback generation terminal state', {
            sessionId: job.sessionId,
            runId: job.runId,
            message:
              failure?.status === 'rejected' && failure.reason instanceof Error
                ? failure.reason.message
                : String(failure?.status === 'rejected' ? failure.reason : '')
          })
        }
      }

      // Do not mark the session job terminal until the generation run and session state are
      // both durable. Otherwise startup recovery will no longer find an orphaned active job.
      if (!terminalStatePersisted) return

      // finalizeGenerationFailure publishes this itself on its normal path. Its
      // fallback only persists the database state, so close the in-memory run
      // before releasing the lease; otherwise reserve() will keep treating the
      // session as running for the rest of the process lifetime.
      if (finalizationFailed) {
        this.ctx.runtimeEmitters.emitGenerateChunk(job.sessionId, {
          type: 'run_error',
          payload: {
            runId: job.runId,
            message: cancelled ? '生成已取消' : message || 'Generation failed',
            cancelled
          }
        })
      }

      let jobStatusPersisted = false
      try {
        if (cancelled) {
          await this.ctx.db.updateSessionJobStatus(job.runId, 'aborted', {
            abortReason: 'cancelled'
          })
        } else {
          await this.ctx.db.updateSessionJobStatus(job.runId, 'finished')
        }
        jobStatusPersisted = true
      } catch (statusError) {
        log.error('[generate:job] failed to settle session job', {
          sessionId: job.sessionId,
          runId: job.runId,
          message: statusError instanceof Error ? statusError.message : String(statusError || '')
        })
      }

      if (jobStatusPersisted) {
        this.ctx.runtimeEmitters.emitRuntimeJobTerminal({
          sessionId: job.sessionId,
          jobId: job.runId,
          domain: 'generation',
          status: cancelled ? 'cancelled' : 'failed',
          errorCode: cancelled ? undefined : 'generation_failed',
          errorMessage: cancelled ? undefined : message
        })
      }
  }

  private processQueue(): void {
    while (
      this.activeCount + this.startingCount < MAX_ACTIVE_GENERATION_JOBS &&
      this.pendingQueue.length > 0
    ) {
      const next = this.pendingQueue.shift()
      if (!next || !this.jobsBySession.has(next.sessionId)) continue
      if (next.reservation.signal.aborted) {
        void this.cancelPendingJob(next)
        continue
      }
      this.startJob(next)
    }
  }

  private watchCancellation(job: BackgroundJob<FinalizeContext>): void {
    const onAbort = (): void => {
      if (job.status === 'pending') void this.cancelPendingJob(job)
    }
    job.removeAbortListener = (): void => job.reservation.signal.removeEventListener('abort', onAbort)
    job.reservation.signal.addEventListener('abort', onAbort, { once: true })
    if (job.reservation.signal.aborted) onAbort()
  }

  private async cancelPendingJob(job: BackgroundJob<FinalizeContext>): Promise<void> {
    if (job.pendingCancellation) return job.pendingCancellation
    if (job.status !== 'pending' || this.jobsBySession.get(job.sessionId) !== job) return

    this.pendingQueue = this.pendingQueue.filter((candidate) => candidate !== job)
    this.jobsBySession.delete(job.sessionId)
    job.removeAbortListener()
    if (job.reservedCapacitySlot) {
      this.startingCount = Math.max(0, this.startingCount - 1)
      job.reservedCapacitySlot = false
    }

    job.pendingCancellation = (async () => {
      try {
        await this.ctx.db.updateSessionJobStatus(job.runId, 'aborted', { abortReason: 'cancelled' })
        await this.ctx.db.updateGenerationRunStatus(job.runId, 'failed', '生成已取消')
        await this.ctx.db.updateSessionStatus(
          job.sessionId,
          normalizeRestoredSessionStatus(job.context.previousSessionStatus)
        )
        this.ctx.runtimeEmitters.emitGenerateChunk(job.sessionId, {
          type: 'run_error',
          payload: { runId: job.runId, message: '生成已取消' }
        })
        this.ctx.runtimeEmitters.emitRuntimeJobTerminal({
          sessionId: job.sessionId,
          jobId: job.runId,
          domain: 'generation',
          status: 'cancelled'
        })
      } catch (error) {
        log.warn('[generate:job] failed to settle cancelled queued job', {
          sessionId: job.sessionId,
          runId: job.runId,
          message: error instanceof Error ? error.message : String(error)
        })
      } finally {
        this.ctx.agentManager.removeSession(job.sessionId)
        this.release(job.reservation)
        this.processQueue()
      }
    })()
    return job.pendingCancellation
  }
}
