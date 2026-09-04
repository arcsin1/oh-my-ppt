import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: {}, safeStorage: {} }))
vi.mock('@electron-toolkit/utils', () => ({ is: {} }))
vi.mock('electron-log/main.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }))

import {
  createIpcContext,
  getDeckProgressStageBounds,
  shouldEmitLlmStatusUpdate
} from '../../../src/main/ipc/context'
import { TypedEventBus } from '../../../src/main/agent-runtime/events/bus'

describe('getDeckProgressStageBounds', () => {
  it('caps preflight/planning at 10 so later stages own the upper range', () => {
    expect(getDeckProgressStageBounds('preflight')).toEqual({ min: 0, max: 10 })
    expect(getDeckProgressStageBounds('planning')).toEqual({ min: 0, max: 10 })
  })

  it('keeps rendering inside [10, 90] so finalization can claim [90, 100]', () => {
    expect(getDeckProgressStageBounds('rendering')).toEqual({ min: 10, max: 90 })
  })

  it('clamps unknown stages (incl. editing) to [0, 90]', () => {
    expect(getDeckProgressStageBounds('editing')).toEqual({ min: 0, max: 90 })
    expect(getDeckProgressStageBounds('whatever')).toEqual({ min: 0, max: 90 })
  })

  it('lets finalizing reach 100 so single-page edit milestones are not stalled at 90', () => {
    // Regression: post-agent emits (83/87/91/95/100) used to be clamped to ≤90 by the
    // default branch, making the bar freeze one tick short of done. The finalizing stage
    // exists specifically to let single-page workflows complete visibly.
    const bounds = getDeckProgressStageBounds('finalizing')
    expect(bounds.min).toBeLessThanOrEqual(83)
    expect(bounds.max).toBeGreaterThanOrEqual(100)
  })

  it('coalesces repetitive llm status updates while preserving meaningful progress changes', () => {
    const previous = {
      stage: 'editing',
      label: '生成页面',
      detail: '',
      progress: 45,
      emittedAt: 1_000
    }

    expect(
      shouldEmitLlmStatusUpdate(previous, { ...previous, progress: 45 }, 1_200)
    ).toBe(false)
    expect(
      shouldEmitLlmStatusUpdate(previous, { ...previous, progress: 46 }, 1_200)
    ).toBe(false)
    expect(
      shouldEmitLlmStatusUpdate(previous, { ...previous, progress: 47 }, 1_200)
    ).toBe(false)
    expect(
      shouldEmitLlmStatusUpdate(previous, { ...previous, progress: 50 }, 1_200)
    ).toBe(true)
    expect(
      shouldEmitLlmStatusUpdate(previous, { ...previous, label: '校验页面' }, 1_200)
    ).toBe(true)
    expect(
      shouldEmitLlmStatusUpdate(previous, { ...previous, progress: 45 }, 1_800)
    ).toBe(false)
  })

  it('separates streamed chunks from persisted lifecycle events on the typed runtime bus', () => {
    const eventBus = new TypedEventBus()
    const events: Array<{ type: string; domain: string; jobId: string }> = []
    eventBus.subscribe({}, (event) => events.push(event))
    const context = createIpcContext(
      {
        isDestroyed: () => false,
        isMinimized: () => false,
        isVisible: () => true,
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn()
      } as never,
      {} as never,
      {} as never,
      eventBus
    )

    context.beginSessionRunState({
      sessionId: 'session-1',
      runId: 'run-1',
      mode: 'generate',
      totalPages: 1,
      status: 'running'
    })
    context.emitGenerateChunk('session-1', {
      type: 'run_error',
      payload: { runId: 'run-1', message: '生成已取消', cancelled: true }
    })

    expect(events).toEqual([
      expect.objectContaining({ type: 'job.started', domain: 'generation', jobId: 'run-1' }),
      expect.objectContaining({ type: 'generation.chunk', domain: 'generation', jobId: 'run-1' })
    ])

    context.emitRuntimeJobTerminal({
      sessionId: 'session-1',
      jobId: 'run-1',
      status: 'cancelled'
    })

    expect(events).toEqual([
      expect.objectContaining({ type: 'job.started', domain: 'generation', jobId: 'run-1' }),
      expect.objectContaining({ type: 'generation.chunk', domain: 'generation', jobId: 'run-1' }),
      expect.objectContaining({ type: 'job.cancelled', domain: 'generation', jobId: 'run-1' })
    ])
  })
})
