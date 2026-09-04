/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateChunkEvent } from '@shared/generation'

const { onGenerateChunkMock, navigateMock, getSessionMock, toastMock } = vi.hoisted(() => ({
  onGenerateChunkMock: vi.fn(),
  navigateMock: vi.fn(),
  getSessionMock: vi.fn(),
  toastMock: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn()
  }
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  ipc: {
    onGenerateChunk: onGenerateChunkMock,
    getSession: getSessionMock
  }
}))

vi.mock('../../../src/renderer/src/store', () => ({
  useToastStore: {
    getState: () => toastMock
  }
}))

vi.mock('../../../src/renderer/src/i18n', () => ({
  useT: () => (key: string, params?: Record<string, string | number>) => {
    if (key === 'generationNotifications.untitled') return '未命名'
    if (key === 'generationNotifications.view') return '查看'
    if (key === 'generationNotifications.completed') return `完成 ${params?.title ?? ''}`
    if (key === 'generationNotifications.failed') return `失败 ${params?.title ?? ''}`
    return key
  }
}))

import { useGenerationNotifications } from '../../../src/renderer/src/hooks/useGenerationNotifications'

function Probe() {
  useGenerationNotifications()
  return null
}

const flushAsync = async (): Promise<void> => {
  // The notify() path awaits readSessionTitle() then calls toast. Two microtask ticks cover
  // the awaited ipc.getSession resolution and the subsequent state-mutating sync call.
  await Promise.resolve()
  await Promise.resolve()
}

describe('useGenerationNotifications', () => {
  let container: HTMLDivElement
  let captured: ((chunk: GenerateChunkEvent) => void) | null = null

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    captured = null
    onGenerateChunkMock.mockImplementation((cb: (chunk: GenerateChunkEvent) => void) => {
      captured = cb
      return () => {
        captured = null
      }
    })
    getSessionMock.mockResolvedValue({ session: { title: 'Deck' } })
    Object.values(toastMock).forEach((mock) => mock.mockClear())
    navigateMock.mockClear()
    act(() => {
      createRoot(container).render(React.createElement(Probe))
    })
  })

  afterEach(() => {
    container.remove()
  })

  it('fires the completion toast for a full-deck generation run', async () => {
    expect(captured).toBeTruthy()
    captured!({
      type: 'run_completed',
      payload: { runId: 'run-1', totalPages: 3, sessionId: 's1', activityKind: undefined }
    })
    await flushAsync()
    expect(toastMock.success).toHaveBeenCalledTimes(1)
  })

  it('suppresses the toast for page-edit, deck-edit, and style-switch runs', async () => {
    const kinds = ['page-edit', 'deck-edit', 'style-switch'] as const
    for (const activityKind of kinds) {
      captured!({
        type: 'run_completed',
        payload: { runId: `run-${activityKind}`, totalPages: 1, sessionId: 's1', activityKind }
      })
    }
    await flushAsync()
    expect(toastMock.success).not.toHaveBeenCalled()
  })

  it('suppresses the error toast for a failed single-page retry', async () => {
    captured!({
      type: 'run_error',
      payload: {
        runId: 'run-single-page-fail',
        sessionId: 's1',
        activityKind: 'single-page-retry',
        message: 'boom'
      }
    })
    await flushAsync()
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  it('suppresses the error toast for a failed generated-page addition', async () => {
    captured!({
      type: 'run_error',
      payload: {
        runId: 'run-add-page-fail',
        sessionId: 's1',
        activityKind: 'addPage',
        message: 'boom'
      }
    })
    await flushAsync()
    expect(toastMock.error).not.toHaveBeenCalled()
  })
})
