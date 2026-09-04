import { beforeEach, describe, expect, it, vi } from 'vitest'

const logMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}))
const finalizeGenerationFailureMock = vi.hoisted(() => vi.fn())

vi.mock('electron-log/main.js', () => ({ default: logMocks }))
vi.mock('../../../src/main/generation/finalization', () => ({
  finalizeGenerationFailure: finalizeGenerationFailureMock,
  resolveGenerationFailureSessionStatus: () => 'failed'
}))

import { GenerateJobManager } from '../../../src/main/generation/job-manager'
import { JobCoordinator } from '../../../src/main/agent-runtime/job/coordinator'

const createGenerationJobContext = (ctx: Record<string, any>) => ({
  ...ctx,
  sessionRuns: {
    sessionRunStates: ctx.sessionRunStates,
    beginSessionRunState: ctx.beginSessionRunState,
    pruneFinishedSessionRunStates: () => undefined,
    trackSessionRunChunk: () => undefined
  },
  runtimeEmitters: {
    emitSessionRunLifecycle: ctx.emitSessionRunLifecycle || (() => undefined),
    emitGenerateChunk: ctx.emitGenerateChunk,
    emitRuntimeJobStarted: ctx.emitRuntimeJobStarted || (() => undefined),
    emitRuntimeJobTerminal: ctx.emitRuntimeJobTerminal,
    createDeckProgressEmitter: () => () => undefined
  }
})

describe('GenerateJobManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    finalizeGenerationFailureMock.mockReset()
  })

  it('persists a background generation as a unified session job', async () => {
    let resolveExecution: (() => void) | undefined
    const execution = new Promise<void>((resolve) => {
      resolveExecution = resolve
    })
    const beginSessionRunState = vi.fn()
    const emitRuntimeJobTerminal = vi.fn()
    const ctx = {
      db: {
        createGenerationRunWithSessionJob: vi.fn().mockResolvedValue(undefined),
        updateSessionJobStatus: vi.fn().mockResolvedValue(undefined)
      },
      sessionRunStates: new Map(),
      beginSessionRunState,
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobTerminal,
      agentManager: {
        removeSession: vi.fn(),
        cancelSession: vi.fn()
      }
    }
    const coordinator = new JobCoordinator()
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never, coordinator)
    const reserved = await manager.reserve('generate:start', 'session-1', 'run-generate-1')
    if (reserved.alreadyRunning) throw new Error('expected available job reservation')

    const result = await manager.enqueue({
      reservation: reserved.reservation,
      kind: 'standard',
      context: {
        sessionId: 'session-1',
        runId: 'run-generate-1',
        styleId: 'style-1',
        previousSessionStatus: 'completed',
        effectiveMode: 'generate',
        messageScope: 'main',
        projectId: 'project-1'
      },
      totalPages: 1,
      execute: async () => execution
    })

    expect(result).toEqual({ runId: 'run-generate-1', queued: false })
    expect(ctx.db.createGenerationRunWithSessionJob).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({ id: 'run-generate-1', mode: 'generate', totalPages: 1 }),
        job: expect.objectContaining({
          id: 'run-generate-1',
          kind: 'standard',
          previousSessionStatus: 'completed',
          totalPages: 1
        })
      })
    )
    expect(beginSessionRunState).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'standard'
      })
    )

    resolveExecution?.()
    await vi.waitFor(() => {
      expect(ctx.db.updateSessionJobStatus).toHaveBeenCalledWith('run-generate-1', 'finished')
    })
    expect(emitRuntimeJobTerminal).toHaveBeenCalledWith({
      sessionId: 'session-1',
      jobId: 'run-generate-1',
      domain: 'generation',
      status: 'completed'
    })
    const sessionJobFinishedCall = ctx.db.updateSessionJobStatus.mock.calls.findIndex(
      ([runId, status]) => runId === 'run-generate-1' && status === 'finished'
    )
    expect(sessionJobFinishedCall).toBeGreaterThanOrEqual(0)
    expect(
      ctx.db.updateSessionJobStatus.mock.invocationCallOrder[sessionJobFinishedCall]
    ).toBeLessThan(emitRuntimeJobTerminal.mock.invocationCallOrder[0])
    expect(coordinator.getByOwner({ kind: 'session', id: 'session-1' })).toBeNull()
  })

  it('does not leave a run behind when atomic job creation fails', async () => {
    const ctx = {
      db: {
        createGenerationRunWithSessionJob: vi.fn().mockRejectedValue(new Error('job insert failed')),
        updateSessionJobStatus: vi.fn(),
        updateGenerationRunStatus: vi.fn().mockResolvedValue(undefined),
        updateSessionStatus: vi.fn().mockResolvedValue(undefined)
      },
      sessionRunStates: new Map(),
      beginSessionRunState: vi.fn(),
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobTerminal: vi.fn(),
      agentManager: {
        removeSession: vi.fn(),
        cancelSession: vi.fn()
      }
    }
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never)
    const reserved = await manager.reserve('generate:start', 'session-2', 'run-generate-2')
    if (reserved.alreadyRunning) throw new Error('expected available job reservation')

    await expect(
      manager.enqueue({
        reservation: reserved.reservation,
        kind: 'standard',
        context: {
          sessionId: 'session-2',
          runId: 'run-generate-2',
          styleId: 'style-1',
          previousSessionStatus: 'completed',
          effectiveMode: 'generate',
          messageScope: 'main',
          projectId: 'project-1'
        },
        totalPages: 1,
        execute: vi.fn()
      })
    ).rejects.toThrow('job insert failed')

    expect(ctx.db.updateGenerationRunStatus).not.toHaveBeenCalled()
    expect(ctx.db.updateSessionStatus).not.toHaveBeenCalled()
  })

  it('aborts the persisted session job when setup fails after it has been created', async () => {
    const ctx = {
      db: {
        createGenerationRunWithSessionJob: vi.fn().mockResolvedValue(undefined),
        updateSessionJobStatus: vi.fn().mockResolvedValue(undefined),
        updateGenerationRunStatus: vi.fn().mockResolvedValue(undefined),
        updateSessionStatus: vi.fn().mockResolvedValue(undefined)
      },
      sessionRunStates: new Map(),
      beginSessionRunState: vi.fn(() => {
        throw new Error('state initialization failed')
      }),
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobTerminal: vi.fn(),
      agentManager: {
        removeSession: vi.fn(),
        cancelSession: vi.fn()
      }
    }
    const coordinator = new JobCoordinator()
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never, coordinator)
    const reserved = await manager.reserve(
      'generate:start',
      'session-setup-failure',
      'run-generate-setup-failure'
    )
    if (reserved.alreadyRunning) throw new Error('expected available job reservation')

    await expect(
      manager.enqueue({
        reservation: reserved.reservation,
        kind: 'standard',
        context: {
          sessionId: 'session-setup-failure',
          runId: 'run-generate-setup-failure',
          styleId: 'style-1',
          previousSessionStatus: 'completed',
          effectiveMode: 'generate',
          messageScope: 'main',
          projectId: 'project-1'
        },
        totalPages: 1,
        execute: vi.fn()
      })
    ).rejects.toThrow('state initialization failed')

    expect(ctx.db.updateSessionJobStatus).toHaveBeenCalledWith(
      'run-generate-setup-failure',
      'aborted',
      { abortReason: 'setup_failed' }
    )
    expect(ctx.db.updateGenerationRunStatus).toHaveBeenCalledWith(
      'run-generate-setup-failure',
      'failed',
      'state initialization failed'
    )
    expect(coordinator.getByOwner({ kind: 'session', id: 'session-setup-failure' })).toBeNull()
  })

  it('restores session status after an interrupted persisted job', async () => {
    const ctx = {
      db: {
        listActiveSessionJobs: vi.fn().mockResolvedValue([
          {
            id: 'run-generate-3',
            session_id: 'session-3',
            previous_session_status: 'completed'
          }
        ]),
        updateSessionJobStatus: vi.fn().mockResolvedValue(undefined),
        updateGenerationRunStatus: vi.fn().mockResolvedValue(undefined),
        updateSessionStatus: vi.fn().mockResolvedValue(undefined),
        getGenerationRun: vi.fn().mockResolvedValue({ status: 'running' })
      },
      sessionRunStates: new Map(),
      beginSessionRunState: vi.fn(),
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobTerminal: vi.fn(),
      agentManager: {
        removeSession: vi.fn(),
        cancelSession: vi.fn()
      }
    }
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never)

    await manager.abortInterruptedJobs('应用退出导致生成中断')

    expect(ctx.db.updateSessionJobStatus).toHaveBeenCalledWith('run-generate-3', 'aborted', {
      abortReason: '应用退出导致生成中断'
    })
    expect(ctx.db.updateGenerationRunStatus).toHaveBeenCalledWith(
      'run-generate-3',
      'failed',
      '应用退出导致生成中断'
    )
    expect(ctx.db.updateSessionStatus).toHaveBeenCalledWith('session-3', 'completed')
  })

  it('settles an interrupted job that already persisted a successful generation', async () => {
    const ctx = {
      db: {
        listActiveSessionJobs: vi.fn().mockResolvedValue([
          {
            id: 'run-completed-before-crash',
            session_id: 'session-completed-before-crash',
            previous_session_status: 'active'
          }
        ]),
        getGenerationRun: vi.fn().mockResolvedValue({ status: 'completed' }),
        updateSessionJobStatus: vi.fn().mockResolvedValue(undefined),
        updateGenerationRunStatus: vi.fn(),
        updateSessionStatus: vi.fn()
      },
      sessionRunStates: new Map(),
      beginSessionRunState: vi.fn(),
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobTerminal: vi.fn(),
      agentManager: { removeSession: vi.fn() }
    }
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never)

    await manager.abortInterruptedJobs('应用退出导致生成中断')

    expect(ctx.db.updateSessionJobStatus).toHaveBeenCalledWith(
      'run-completed-before-crash',
      'finished'
    )
    expect(ctx.db.updateGenerationRunStatus).not.toHaveBeenCalled()
    expect(ctx.db.updateSessionStatus).not.toHaveBeenCalled()
  })

  it('uses the active JobCoordinator lease signal for cancellation and terminal persistence', async () => {
    let executionSignal: AbortSignal | undefined
    let executionStarted!: () => void
    const started = new Promise<void>((resolve) => {
      executionStarted = resolve
    })
    const emitRuntimeJobTerminal = vi.fn()
    const ctx = {
      db: {
        createGenerationRunWithSessionJob: vi.fn().mockResolvedValue(undefined),
        updateSessionJobStatus: vi.fn().mockResolvedValue(undefined),
        updateGenerationRunStatus: vi.fn().mockResolvedValue(undefined),
        updateSessionStatus: vi.fn().mockResolvedValue(undefined),
        getGenerationRun: vi.fn().mockResolvedValue(null),
        addMessage: vi.fn().mockResolvedValue(undefined)
      },
      sessionRunStates: new Map(),
      beginSessionRunState: vi.fn(),
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobTerminal,
      agentManager: { removeSession: vi.fn() }
    }
    const coordinator = new JobCoordinator()
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never, coordinator)
    const reserved = await manager.reserve('generate:start', 'session-active', 'run-active')
    if (reserved.alreadyRunning) throw new Error('expected available job reservation')

    await manager.enqueue({
      reservation: reserved.reservation,
      kind: 'standard',
      context: {
        sessionId: 'session-active',
        runId: 'run-active',
        styleId: 'style-1',
        previousSessionStatus: 'completed',
        effectiveMode: 'generate',
        messageScope: 'main',
        projectId: 'project-1',
        // Generation handlers resolve expensive context only after reserve(),
        // so their execution context carries this exact JobLease signal.
        abortSignal: reserved.reservation.signal
      },
      totalPages: 1,
      execute: async (context) => {
        executionSignal = context.abortSignal
        executionStarted()
        await new Promise<void>((_resolve, reject) => {
          context.abortSignal.addEventListener(
            'abort',
            () => reject(new Error('生成已取消')),
            { once: true }
          )
        })
      }
    })
    await started

    expect(executionSignal).toBe(reserved.reservation.signal)
    await expect(manager.cancel('session-active')).resolves.toBe(true)
    await vi.waitFor(() => {
      expect(ctx.db.updateSessionJobStatus).toHaveBeenCalledWith('run-active', 'aborted', {
        abortReason: 'cancelled'
      })
    })
    expect(emitRuntimeJobTerminal).toHaveBeenCalledWith({
      sessionId: 'session-active',
      jobId: 'run-active',
      domain: 'generation',
      status: 'cancelled',
      errorCode: undefined,
      errorMessage: undefined
    })
    expect(coordinator.getByOwner({ kind: 'session', id: 'session-active' })).toBeNull()
  })

  it('settles and publishes a failed job when generation finalization fails', async () => {
    const emitRuntimeJobTerminal = vi.fn()
    const ctx = {
      db: {
        createGenerationRunWithSessionJob: vi.fn().mockResolvedValue(undefined),
        updateSessionJobStatus: vi.fn().mockResolvedValue(undefined),
        updateGenerationRunStatus: vi.fn().mockResolvedValue(undefined),
        updateSessionStatus: vi.fn().mockResolvedValue(undefined)
      },
      sessionRunStates: new Map(),
      beginSessionRunState: vi.fn(),
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobTerminal,
      agentManager: { removeSession: vi.fn() }
    }
    const coordinator = new JobCoordinator()
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never, coordinator)
    const reserved = await manager.reserve('generate:start', 'session-finalize-failure', 'run-finalize-failure')
    if (reserved.alreadyRunning) throw new Error('expected available job reservation')
    finalizeGenerationFailureMock.mockRejectedValueOnce(new Error('database temporarily unavailable'))

    await manager.enqueue({
      reservation: reserved.reservation,
      kind: 'standard',
      context: {
        sessionId: 'session-finalize-failure',
        runId: 'run-finalize-failure',
        styleId: 'style-1',
        previousSessionStatus: 'completed',
        effectiveMode: 'generate',
        messageScope: 'main',
        projectId: 'project-1'
      },
      totalPages: 1,
      execute: async () => {
        throw new Error('generation failed')
      }
    })

    await vi.waitFor(() => {
      expect(ctx.db.updateSessionJobStatus).toHaveBeenCalledWith('run-finalize-failure', 'finished')
    })
    expect(ctx.db.updateGenerationRunStatus).toHaveBeenCalledWith(
      'run-finalize-failure',
      'failed',
      'generation failed'
    )
    expect(ctx.db.updateSessionStatus).toHaveBeenCalledWith('session-finalize-failure', 'failed')
    expect(ctx.emitGenerateChunk).toHaveBeenCalledWith('session-finalize-failure', {
      type: 'run_error',
      payload: {
        runId: 'run-finalize-failure',
        message: 'generation failed',
        cancelled: false
      }
    })
    expect(logMocks.error).toHaveBeenCalledWith(
      '[generate:job] failed to finalize generation',
      expect.objectContaining({ runId: 'run-finalize-failure' })
    )
    expect(emitRuntimeJobTerminal).toHaveBeenCalledWith({
      sessionId: 'session-finalize-failure',
      jobId: 'run-finalize-failure',
      domain: 'generation',
      status: 'failed',
      errorCode: 'generation_failed',
      errorMessage: 'generation failed'
    })
    const sessionJobFinishedCall = ctx.db.updateSessionJobStatus.mock.calls.findIndex(
      ([runId, status]) => runId === 'run-finalize-failure' && status === 'finished'
    )
    expect(
      ctx.db.updateSessionJobStatus.mock.invocationCallOrder[sessionJobFinishedCall]
    ).toBeLessThan(emitRuntimeJobTerminal.mock.invocationCallOrder[0])
    const fallbackRunFailureCall = ctx.db.updateGenerationRunStatus.mock.calls.findIndex(
      ([runId, status]) => runId === 'run-finalize-failure' && status === 'failed'
    )
    expect(
      ctx.db.updateGenerationRunStatus.mock.invocationCallOrder[fallbackRunFailureCall]
    ).toBeLessThan(ctx.db.updateSessionJobStatus.mock.invocationCallOrder[sessionJobFinishedCall])
    expect(coordinator.getByOwner({ kind: 'session', id: 'session-finalize-failure' })).toBeNull()
  })

  it('leaves the session job recoverable when finalization cannot restore the session', async () => {
    const emitRuntimeJobTerminal = vi.fn()
    const ctx = {
      db: {
        createGenerationRunWithSessionJob: vi.fn().mockResolvedValue(undefined),
        updateGenerationRunStatus: vi.fn().mockResolvedValue(undefined),
        updateSessionStatus: vi.fn().mockRejectedValue(new Error('session database unavailable')),
        updateSessionJobStatus: vi.fn().mockResolvedValue(undefined)
      },
      sessionRunStates: new Map(),
      beginSessionRunState: vi.fn(),
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobTerminal,
      agentManager: { removeSession: vi.fn() }
    }
    const coordinator = new JobCoordinator()
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never, coordinator)
    const reserved = await manager.reserve('generate:start', 'session-unrecoverable', 'run-unrecoverable')
    if (reserved.alreadyRunning) throw new Error('expected available job reservation')
    finalizeGenerationFailureMock.mockRejectedValueOnce(new Error('finalization database unavailable'))

    await manager.enqueue({
      reservation: reserved.reservation,
      kind: 'standard',
      context: {
        sessionId: 'session-unrecoverable',
        runId: 'run-unrecoverable',
        styleId: 'style-1',
        previousSessionStatus: 'completed',
        effectiveMode: 'generate',
        messageScope: 'main',
        projectId: 'project-1'
      },
      totalPages: 1,
      execute: async () => {
        throw new Error('generation failed')
      }
    })

    await vi.waitFor(() => {
      expect(logMocks.error).toHaveBeenCalledWith(
        '[generate:job] failed to persist fallback generation terminal state',
        expect.objectContaining({ runId: 'run-unrecoverable' })
      )
    })
    expect(ctx.db.updateSessionJobStatus).not.toHaveBeenCalledWith('run-unrecoverable', 'finished')
    expect(emitRuntimeJobTerminal).not.toHaveBeenCalled()
    expect(coordinator.getByOwner({ kind: 'session', id: 'session-unrecoverable' })).toBeNull()
  })

  it('does not execute or publish started when activation cannot be persisted', async () => {
    const execute = vi.fn()
    const emitRuntimeJobStarted = vi.fn()
    const emitRuntimeJobTerminal = vi.fn()
    const ctx = {
      db: {
        createGenerationRunWithSessionJob: vi.fn().mockResolvedValue(undefined),
        updateSessionJobStatus: vi
          .fn()
          .mockRejectedValueOnce(new Error('activation database unavailable'))
          .mockResolvedValue(undefined)
      },
      sessionRunStates: new Map(),
      beginSessionRunState: vi.fn(),
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobStarted,
      emitRuntimeJobTerminal,
      agentManager: { removeSession: vi.fn() }
    }
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never)
    const reserved = await manager.reserve('generate:start', 'session-activation-failure', 'run-activation-failure')
    if (reserved.alreadyRunning) throw new Error('expected available job reservation')
    finalizeGenerationFailureMock.mockResolvedValueOnce(undefined)

    await manager.enqueue({
      reservation: reserved.reservation,
      kind: 'standard',
      context: {
        sessionId: 'session-activation-failure',
        runId: 'run-activation-failure',
        styleId: 'style-1',
        previousSessionStatus: 'completed',
        effectiveMode: 'generate',
        messageScope: 'main',
        projectId: 'project-1'
      },
      totalPages: 1,
      execute
    })

    await vi.waitFor(() => {
      expect(emitRuntimeJobTerminal).toHaveBeenCalledWith({
        sessionId: 'session-activation-failure',
        jobId: 'run-activation-failure',
        domain: 'generation',
        status: 'failed',
        errorCode: 'generation_failed',
        errorMessage: 'activation database unavailable'
      })
    })
    expect(execute).not.toHaveBeenCalled()
    expect(emitRuntimeJobStarted).not.toHaveBeenCalled()
  })

  it('does not turn completed generation into failure when only the session-job terminal write fails', async () => {
    const emitRuntimeJobTerminal = vi.fn()
    const ctx = {
      db: {
        createGenerationRunWithSessionJob: vi.fn().mockResolvedValue(undefined),
        updateSessionJobStatus: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('session job database unavailable'))
      },
      sessionRunStates: new Map(),
      beginSessionRunState: vi.fn(),
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobTerminal,
      agentManager: { removeSession: vi.fn() }
    }
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never)
    const reserved = await manager.reserve('generate:start', 'session-completed-write-failure', 'run-completed-write-failure')
    if (reserved.alreadyRunning) throw new Error('expected available job reservation')

    await manager.enqueue({
      reservation: reserved.reservation,
      kind: 'standard',
      context: {
        sessionId: 'session-completed-write-failure',
        runId: 'run-completed-write-failure',
        styleId: 'style-1',
        previousSessionStatus: 'completed',
        effectiveMode: 'generate',
        messageScope: 'main',
        projectId: 'project-1'
      },
      totalPages: 1,
      execute: vi.fn().mockResolvedValue(undefined)
    })

    await vi.waitFor(() => {
      expect(logMocks.error).toHaveBeenCalledWith(
        '[generate:job] failed to settle completed session job',
        expect.objectContaining({ runId: 'run-completed-write-failure' })
      )
    })
    expect(finalizeGenerationFailureMock).not.toHaveBeenCalled()
    expect(emitRuntimeJobTerminal).not.toHaveBeenCalled()
  })

  it('does not publish a terminal event until the failed job status is persisted', async () => {
    const emitRuntimeJobTerminal = vi.fn()
    const ctx = {
      db: {
        createGenerationRunWithSessionJob: vi.fn().mockResolvedValue(undefined),
        updateSessionJobStatus: vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('session job database unavailable'))
      },
      sessionRunStates: new Map(),
      beginSessionRunState: vi.fn(),
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobTerminal,
      agentManager: { removeSession: vi.fn() }
    }
    const coordinator = new JobCoordinator()
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never, coordinator)
    const reserved = await manager.reserve('generate:start', 'session-status-failure', 'run-status-failure')
    if (reserved.alreadyRunning) throw new Error('expected available job reservation')

    await manager.enqueue({
      reservation: reserved.reservation,
      kind: 'standard',
      context: {
        sessionId: 'session-status-failure',
        runId: 'run-status-failure',
        styleId: 'style-1',
        previousSessionStatus: 'completed',
        effectiveMode: 'generate',
        messageScope: 'main',
        projectId: 'project-1'
      },
      totalPages: 1,
      execute: async () => {
        throw new Error('generation failed')
      }
    })

    await vi.waitFor(() => {
      expect(logMocks.error).toHaveBeenCalledWith(
        '[generate:job] failed to settle session job',
        expect.objectContaining({ runId: 'run-status-failure' })
      )
    })
    expect(emitRuntimeJobTerminal).not.toHaveBeenCalled()
    expect(coordinator.getByOwner({ kind: 'session', id: 'session-status-failure' })).toBeNull()
  })

  it('settles a queued job cancelled directly through JobCoordinator and starts the next job in FIFO order', async () => {
    const executions: string[] = []
    const completions = new Map<string, { promise: Promise<void>; resolve: () => void }>()
    const createCompletion = (runId: string): void => {
      let resolve!: () => void
      const promise = new Promise<void>((complete) => {
        resolve = complete
      })
      completions.set(runId, { promise, resolve })
    }
    for (const runId of ['run-1', 'run-2', 'run-3', 'run-4']) createCompletion(runId)

    const emitRuntimeJobStarted = vi.fn()
    const ctx = {
      db: {
        createGenerationRunWithSessionJob: vi.fn().mockResolvedValue(undefined),
        updateSessionJobStatus: vi.fn().mockResolvedValue(undefined),
        updateGenerationRunStatus: vi.fn().mockResolvedValue(undefined),
        updateSessionStatus: vi.fn().mockResolvedValue(undefined)
      },
      sessionRunStates: new Map(),
      beginSessionRunState: vi.fn(),
      emitGenerateChunk: vi.fn(),
      emitRuntimeJobStarted,
      emitRuntimeJobTerminal: vi.fn(),
      agentManager: { removeSession: vi.fn() }
    }
    const coordinator = new JobCoordinator()
    const manager = new GenerateJobManager(createGenerationJobContext(ctx) as never, coordinator)

    const enqueue = async (sessionId: string, runId: string): Promise<void> => {
      const reservation = await manager.reserve('generate:start', sessionId, runId)
      if (reservation.alreadyRunning) throw new Error(`unexpected busy reservation for ${runId}`)
      await manager.enqueue({
        reservation: reservation.reservation,
        kind: 'standard',
        context: {
          sessionId,
          runId,
          styleId: 'style-1',
          previousSessionStatus: 'completed',
          effectiveMode: 'generate',
          messageScope: 'main',
          projectId: 'project-1'
        },
        totalPages: 1,
        execute: async () => {
          executions.push(runId)
          await completions.get(runId)?.promise
        }
      })
    }

    await enqueue('session-1', 'run-1')
    await enqueue('session-2', 'run-2')
    await vi.waitFor(() => expect(executions).toEqual(['run-1', 'run-2']))

    await enqueue('session-3', 'run-3')
    await enqueue('session-4', 'run-4')
    expect(executions).toEqual(['run-1', 'run-2'])

    // A capacity-queued generation keeps its session write lease. Every outer
    // writer must observe the queued run as busy rather than slipping between
    // resource and capacity scheduling.
    const queuedGenerationConflicts = [
      { name: 'retry-failed-pages', domain: 'generation' as const },
      { name: 'add-page', domain: 'generation' as const },
      { name: 'single-page-retry', domain: 'generation' as const },
      { name: 'page-edit', domain: 'edit' as const },
      { name: 'deck-edit', domain: 'edit' as const },
      { name: 'style-switch', domain: 'style' as const }
    ]
    for (const operation of queuedGenerationConflicts) {
      await expect(
        coordinator.reserve({
          jobId: `${operation.name}-while-queued`,
          domain: operation.domain,
          owner: { kind: 'session', id: 'session-3' },
          claims: { write: ['session:session-3'] },
          wait: 'fail'
        })
      ).resolves.toEqual({ status: 'busy', conflictingJobId: 'run-3' })
    }

    expect(coordinator.cancel('run-3')).toBe(true)
    await vi.waitFor(() => {
      expect(ctx.db.updateSessionJobStatus).toHaveBeenCalledWith('run-3', 'aborted', {
        abortReason: 'cancelled'
      })
    })
    await vi.waitFor(() => {
      expect(coordinator.getByOwner({ kind: 'session', id: 'session-3' })).toBeNull()
    })

    const retryAfterQueuedGeneration = await manager.reserve(
      'generate:retryFailedPages',
      'session-3',
      'run-3-retry'
    )
    expect(retryAfterQueuedGeneration).toMatchObject({ alreadyRunning: false })
    if (!retryAfterQueuedGeneration.alreadyRunning) retryAfterQueuedGeneration.reservation.release()

    completions.get('run-1')?.resolve()
    await vi.waitFor(() => expect(executions).toEqual(['run-1', 'run-2', 'run-4']))
    expect(emitRuntimeJobStarted).toHaveBeenCalledWith({
      sessionId: 'session-4',
      jobId: 'run-4',
      domain: 'generation'
    })
    expect(executions).not.toContain('run-3')

    completions.get('run-2')?.resolve()
    completions.get('run-4')?.resolve()
    await vi.waitFor(() => {
      expect(coordinator.getByOwner({ kind: 'session', id: 'session-2' })).toBeNull()
      expect(coordinator.getByOwner({ kind: 'session', id: 'session-4' })).toBeNull()
    })
  })
})
