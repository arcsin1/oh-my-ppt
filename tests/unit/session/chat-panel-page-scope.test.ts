/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { useChatPanelController } from '../../../src/renderer/src/components/session-detail/hooks/useChatPanelController'
import { useGenerateStore } from '../../../src/renderer/src/store/generateStore'
import { useSessionDetailUiStore } from '../../../src/renderer/src/store/sessionDetailStore'
import { useSessionStore } from '../../../src/renderer/src/store/sessionStore'
import { useToastStore } from '../../../src/renderer/src/store/toastStore'
import type { ChatPanelController } from '../../../src/renderer/src/types/session-detail'

const {
  assessPageEditMock,
  cancelDeckEditMock,
  cancelGenerateMock,
  cancelPageEditMock,
  cancelStyleSwitchMock,
  getDeckEditStateMock,
  getGenerateStateMock,
  getPageEditStateMock,
  getStyleSwitchStateMock,
  startDeckEditMock,
  startGenerateMock,
  startPageEditMock,
  toastErrorMock,
  toastWarningMock
} = vi.hoisted(() => ({
  assessPageEditMock: vi.fn(),
  cancelDeckEditMock: vi.fn().mockResolvedValue({ success: true }),
  cancelGenerateMock: vi.fn().mockResolvedValue({ success: true }),
  cancelPageEditMock: vi.fn().mockResolvedValue({ success: true }),
  cancelStyleSwitchMock: vi.fn().mockResolvedValue({ success: true }),
  getDeckEditStateMock: vi.fn(),
  getGenerateStateMock: vi.fn(),
  getPageEditStateMock: vi.fn(),
  getStyleSwitchStateMock: vi.fn(),
  startDeckEditMock: vi.fn(),
  startGenerateMock: vi.fn(),
  startPageEditMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastWarningMock: vi.fn()
}))

vi.mock('../../../src/renderer/src/i18n', () => ({
  useT: () => (key: string) => key
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  ipc: {
    assessPageEdit: assessPageEditMock,
    cancelDeckEdit: cancelDeckEditMock,
    cancelPageEdit: cancelPageEditMock,
    cancelStyleSwitch: cancelStyleSwitchMock,
    cancelGenerate: cancelGenerateMock,
    getDeckEditState: getDeckEditStateMock,
    getGenerateState: getGenerateStateMock,
    getPageEditState: getPageEditStateMock,
    getStyleSwitchState: getStyleSwitchStateMock,
    startDeckEdit: startDeckEditMock,
    startGenerate: startGenerateMock,
    startPageEdit: startPageEditMock
  }
}))

type Controller = ReturnType<typeof useChatPanelController>

let latest: Controller | null = null

function Harness(): null {
  latest = useChatPanelController('session-1')
  return null
}

async function renderHarness(): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(React.createElement(Harness))
  })
  return { root, container }
}

async function cleanup(root: Root, container: HTMLDivElement): Promise<void> {
  await act(async () => {
    root.unmount()
  })
  container.remove()
}

describe('useChatPanelController page edit scope', () => {
  beforeEach(() => {
    latest = null
    assessPageEditMock.mockReset()
    cancelDeckEditMock.mockReset().mockResolvedValue({ success: true })
    cancelGenerateMock.mockReset().mockResolvedValue({ success: true })
    cancelPageEditMock.mockReset().mockResolvedValue({ success: true })
    cancelStyleSwitchMock.mockReset().mockResolvedValue({ success: true })
    getDeckEditStateMock.mockReset()
    getGenerateStateMock.mockReset()
    getPageEditStateMock.mockReset()
    getStyleSwitchStateMock.mockReset()
    startDeckEditMock.mockReset()
    startGenerateMock.mockReset()
    startPageEditMock.mockReset()
    toastErrorMock.mockClear()
    toastWarningMock.mockClear()
    useToastStore.setState({ error: toastErrorMock, warning: toastWarningMock })
    useGenerateStore.getState().reset()
    useGenerateStore.getState().setPages([
      {
        id: 'page-record-1',
        pageId: 'page-1',
        pageNumber: 1,
        title: 'Page 1',
        html: '<div>Page 1</div>',
        htmlPath: '/tmp/page-1.html'
      },
      {
        id: 'page-record-2',
        pageId: 'page-2',
        pageNumber: 2,
        title: 'Page 2',
        html: '<div>Page 2</div>',
        htmlPath: '/tmp/page-2.html'
      }
    ])
    useSessionDetailUiStore.getState().resetForSessionChange()
    useSessionDetailUiStore.setState({
      selectedPageId: 'page-record-1',
      chatType: 'page'
    })
    useSessionStore.setState({ currentMessages: [] })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('leaves the other page AI panel available after switching away from an active page edit', async () => {
    const { root, container } = await renderHarness()

    try {
      await act(async () => {
        useGenerateStore.getState().startPageEditPlanning('session-1', 'page-1')
        useGenerateStore.getState().setPendingPageEditPlan('session-1', {
          targetPageId: 'page-1',
          targetPageNumber: 1,
          payload: {
            sessionId: 'session-1',
            userMessage: 'Improve the page title',
            type: 'page',
            chatType: 'page',
            selectedPageId: 'page-1'
          },
          plan: {
            intent: 'content',
            target: 'Page title',
            summary: 'Make the title more concise.',
            changes: ['Shorten the title'],
            confirmationQuestion: 'Apply this change?'
          }
        })
        useGenerateStore.getState().finishPageEditPlanning('session-1')
        useGenerateStore.getState().startPageEdit('session-1', { pageId: 'page-1', pageNumber: 1 })
        useSessionDetailUiStore.getState().setSelectedPageId('page-record-2')
      })

      expect(latest).toMatchObject<Partial<ChatPanelController>>({
        isGenerating: false,
        isPageEditing: false,
        isPlanningPageEdit: false,
        pendingPageEditPlan: null,
        progress: null
      })
    } finally {
      await cleanup(root, container)
    }
  })

  it('clears a pending plan without cancelling an unrelated generation', async () => {
    const { root, container } = await renderHarness()

    try {
      await act(async () => {
        useGenerateStore.getState().setPendingPageEditPlan('session-1', {
          targetPageId: 'page-1',
          targetPageNumber: 1,
          payload: {
            sessionId: 'session-1',
            userMessage: 'Update the title',
            type: 'page',
            chatType: 'page',
            selectedPageId: 'page-1'
          },
          plan: {
            intent: 'content',
            target: 'Title',
            summary: 'Update the title copy.',
            changes: ['Replace the title'],
            confirmationQuestion: 'Apply this change?'
          }
        })
      })

      await act(async () => {
        await latest?.cancel()
      })

      expect(useGenerateStore.getState().pageEditPlanning['session-1']?.pendingPlan).toBeNull()
      expect(cancelGenerateMock).not.toHaveBeenCalled()
      expect(cancelPageEditMock).not.toHaveBeenCalled()
    } finally {
      await cleanup(root, container)
    }
  })

  it('keeps the other page input intact and explains why its AI edit cannot start yet', async () => {
    const { root, container } = await renderHarness()

    try {
      await act(async () => {
        useGenerateStore.getState().startPageEdit('session-1', { pageId: 'page-1', pageNumber: 1 })
        useSessionDetailUiStore.setState({
          selectedPageId: 'page-record-2',
          chatType: 'page',
          input: 'Update the second page title'
        })
      })

      await expect(latest?.send('model-1')).resolves.toBe(false)
      expect(assessPageEditMock).not.toHaveBeenCalled()
      expect(useSessionDetailUiStore.getState().input).toBe('Update the second page title')
      expect(toastWarningMock).toHaveBeenCalledWith('sessionDetail.pageEditOtherPageBusy')
    } finally {
      await cleanup(root, container)
    }
  })

  it('does not clear a request when another job starts while page intent is being assessed', async () => {
    const { root, container } = await renderHarness()
    let resolveAssessment: ((value: Record<string, unknown>) => void) | undefined

    assessPageEditMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAssessment = resolve
        })
    )

    try {
      await act(async () => {
        useSessionDetailUiStore.setState({ input: 'Make this title concise' })
      })
      const sendPromise = latest?.send('model-1')
      await act(async () => {
        await Promise.resolve()
        useGenerateStore.setState({ isGenerating: true })
        resolveAssessment?.({
          requiresConfirmation: false,
          plan: {
            intent: 'content',
            target: 'Title',
            summary: 'Shorten the title',
            changes: ['Shorten title copy'],
            confirmationQuestion: 'Apply this edit?'
          },
          reply: 'Ready',
          targetPageId: 'page-1',
          targetPageNumber: 1
        })
      })

      await expect(sendPromise).resolves.toBe(false)
      expect(startPageEditMock).not.toHaveBeenCalled()
      expect(useSessionDetailUiStore.getState().input).toBe('Make this title concise')
      expect(toastWarningMock).toHaveBeenCalledWith('sessionDetail.pageEditPlanWaitForJob')
    } finally {
      await cleanup(root, container)
    }
  })

  it('shows the current-page user message while its edit intent is being assessed', async () => {
    const { root, container } = await renderHarness()
    let resolveAssessment: ((value: Record<string, unknown>) => void) | undefined
    assessPageEditMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAssessment = resolve
        })
    )

    try {
      useSessionDetailUiStore.setState({ input: 'Make this title concise' })
      const sendPromise = latest?.send('model-1')

      await act(async () => {
        await Promise.resolve()
      })

      expect(useSessionStore.getState().currentMessages).toMatchObject([
        {
          session_id: 'session-1',
          chat_scope: 'page',
          page_id: 'page-record-1',
          role: 'user',
          content: 'Make this title concise'
        }
      ])

      resolveAssessment?.({
        requiresConfirmation: true,
        plan: {
          intent: 'content',
          target: 'Title',
          summary: 'Shorten the title',
          changes: ['Shorten title copy'],
          confirmationQuestion: 'Apply this edit?'
        },
        reply: 'Ready',
        targetPageId: 'page-1',
        targetPageNumber: 1
      })
      await expect(sendPromise).resolves.toBe(true)
    } finally {
      await cleanup(root, container)
    }
  })

  it('binds the first main-session edit to its run and infers an explicit page target', async () => {
    startDeckEditMock.mockResolvedValue({ success: true, runId: 'deck-run-1' })
    useSessionDetailUiStore.setState({ chatType: 'main', input: '只修改第 2 页标题' })
    const { root, container } = await renderHarness()

    try {
      let started = false
      await act(async () => {
        started = (await latest?.send('model-1')) ?? false
      })

      expect(started).toBe(true)
      expect(startDeckEditMock).toHaveBeenCalledWith(
        expect.objectContaining({
          chatType: 'main',
          type: 'page',
          selectPageIds: ['page-2']
        })
      )
      expect(useGenerateStore.getState().deckEditJobs['session-1']).toMatchObject({
        runId: 'deck-run-1',
        status: 'running',
        totalPages: 1
      })
    } finally {
      await cleanup(root, container)
    }
  })

  it('does not send unsupported page structure requests as deck edits', async () => {
    useSessionDetailUiStore.setState({ chatType: 'main', input: '删除第 2 页' })
    const { root, container } = await renderHarness()

    try {
      await expect(latest?.send('model-1')).resolves.toBe(false)
      expect(startDeckEditMock).not.toHaveBeenCalled()
      expect(useSessionDetailUiStore.getState().input).toBe('删除第 2 页')
      expect(toastWarningMock).toHaveBeenCalledWith('sessionDetail.mainPageStructureUnsupported')
    } finally {
      await cleanup(root, container)
    }
  })

  it('keeps a deck edit cancelling when its start response arrives late', async () => {
    let resolveStart: ((value: { success: boolean; runId: string }) => void) | undefined
    startDeckEditMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve
        })
    )
    getDeckEditStateMock.mockResolvedValue({
      hasActiveRun: true,
      runId: 'deck-run-late',
      status: 'running',
      progress: 5,
      totalPages: 2
    })
    useSessionDetailUiStore.setState({ chatType: 'main', input: '统一全部页面标题' })
    const { root, container } = await renderHarness()

    try {
      let sendPromise: Promise<boolean> | undefined
      await act(async () => {
        sendPromise = latest?.send('model-1')
        await Promise.resolve()
      })
      await act(async () => {
        await latest?.cancel()
      })
      expect(useGenerateStore.getState().deckEditJobs['session-1']?.status).toBe('cancelling')

      resolveStart?.({ success: true, runId: 'deck-run-late' })
      await act(async () => {
        await sendPromise
      })

      expect(useGenerateStore.getState().deckEditJobs['session-1']).toMatchObject({
        runId: 'deck-run-late',
        status: 'cancelling'
      })
    } finally {
      await cleanup(root, container)
    }
  })

  it('clears a stale deck job when cancellation is rejected and no run is active', async () => {
    cancelDeckEditMock.mockResolvedValueOnce({ success: false })
    getDeckEditStateMock.mockResolvedValueOnce({ hasActiveRun: false })
    useGenerateStore.getState().startDeckEdit('session-1', { totalPages: 2 })
    const { root, container } = await renderHarness()

    try {
      await act(async () => {
        await latest?.cancel()
      })
      expect(useGenerateStore.getState().deckEditJobs['session-1']).toBeUndefined()
    } finally {
      await cleanup(root, container)
    }
  })

  it('does not leave a deck lock when cancel and reconciliation both fail', async () => {
    cancelDeckEditMock.mockRejectedValueOnce(new Error('cancel transport failed'))
    getDeckEditStateMock.mockRejectedValueOnce(new Error('state transport failed'))
    useGenerateStore.getState().startDeckEdit('session-1', { totalPages: 2 })
    const { root, container } = await renderHarness()

    try {
      await act(async () => {
        await latest?.cancel()
      })
      expect(useGenerateStore.getState().deckEditJobs['session-1']).toBeUndefined()
      expect(toastErrorMock).toHaveBeenCalledWith('cancel transport failed')
    } finally {
      await cleanup(root, container)
    }
  })

  it('routes the AI-panel stop action to the active style-switch job', async () => {
    useGenerateStore.getState().startStyleSwitch('session-1', {
      styleId: 'style-2',
      styleName: 'Style 2',
      totalPages: 1,
      pages: [
        {
          pageId: 'page-1',
          pageNumber: 1,
          title: 'Page 1',
          status: 'running',
          error: null,
          retryCount: 0
        }
      ]
    })
    const { root, container } = await renderHarness()

    try {
      await act(async () => {
        await latest?.cancel()
      })
      expect(cancelStyleSwitchMock).toHaveBeenCalledWith('session-1')
      expect(cancelGenerateMock).not.toHaveBeenCalled()
      expect(useGenerateStore.getState().styleSwitchJobs['session-1']?.status).toBe('cancelling')
    } finally {
      await cleanup(root, container)
    }
  })

  it('clears an optimistic deck job when startup is cancelled', async () => {
    startDeckEditMock.mockRejectedValueOnce(new Error('生成已取消'))
    useSessionDetailUiStore.setState({ chatType: 'main', input: '统一全部页面标题' })
    const { root, container } = await renderHarness()

    try {
      await expect(latest?.send('model-1')).resolves.toBe(false)
      expect(useGenerateStore.getState().deckEditJobs['session-1']).toBeUndefined()
      expect(toastErrorMock).not.toHaveBeenCalled()
    } finally {
      await cleanup(root, container)
    }
  })
})
