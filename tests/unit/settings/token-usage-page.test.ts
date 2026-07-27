// @vitest-environment happy-dom

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tokenUsagePageState = vi.hoisted(() => ({
  destroy: vi.fn(),
  translate: (key: string) =>
    key === 'settings.usagePageTitle'
      ? 'Token 用量统计'
      : key === 'settings.usageTotalTokens'
        ? '总 Token'
        : key === 'settings.usageInputTokens'
          ? '输入 Token'
          : key === 'settings.usageOutputTokens'
            ? '输出 Token'
            : key === 'settings.usageCalls'
              ? '模型调用'
              : key,
  navTranslate: (key: string) => (key === 'nav.tokenUsage' ? 'Token 用量' : key),
  getAppVersion: vi.fn(async () => ({ version: '2.0.16' })),
  getModelUsage: vi.fn(async () => ({
    period: '30d' as const,
    startedAt: 1,
    totals: {
      callCount: 3,
      exactCallCount: 2,
      estimatedCallCount: 1,
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500
    },
    byModel: [
      {
        provider: 'openai',
        model: 'test-model',
        callCount: 3,
        exactCallCount: 2,
        estimatedCallCount: 1,
        inputTokens: 1200,
        outputTokens: 300,
        totalTokens: 1500
      }
    ],
    byDay: [
      {
        date: '2026-06-15',
        callCount: 3,
        exactCallCount: 2,
        estimatedCallCount: 1,
        inputTokens: 1200,
        outputTokens: 300,
        totalTokens: 1500
      }
    ],
    byHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      callCount: hour === 10 ? 1 : 0,
      exactCallCount: hour === 10 ? 1 : 0,
      estimatedCallCount: 0,
      inputTokens: hour === 10 ? 400 : 0,
      outputTokens: hour === 10 ? 100 : 0,
      totalTokens: hour === 10 ? 500 : 0
    }))
  }))
}))

vi.mock('chart.js/auto', () => ({
  default: class ChartMock {
    destroy = tokenUsagePageState.destroy
  }
}))

vi.mock('../../../src/renderer/src/lib/ipc', () => ({
  ipc: {
    getAppVersion: tokenUsagePageState.getAppVersion,
    getModelUsage: tokenUsagePageState.getModelUsage
  }
}))

vi.mock('../../../src/renderer/src/i18n', () => ({
  useLang: () => ({
    t: tokenUsagePageState.translate
  }),
  useT: () => tokenUsagePageState.navTranslate
}))

import { Sidebar } from '../../../src/renderer/src/components/layout/Sidebar'
import { TokenUsagePage } from '../../../src/renderer/src/pages/token-usage'

describe('token usage route', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    tokenUsagePageState.getModelUsage.mockClear()
  })

  afterEach(() => {
    container.remove()
  })

  it('renders usage totals and charts from the usage IPC', async () => {
    const root = createRoot(container)
    await act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/token-usage'] },
          React.createElement(TokenUsagePage)
        )
      )
    })

    expect(container.textContent).toContain('Token 用量统计')
    expect(container.textContent).toContain('1,500')
    expect(container.querySelectorAll('canvas')).toHaveLength(3)
    expect(tokenUsagePageState.getModelUsage).toHaveBeenCalledWith('30d')

    await act(async () => root.unmount())
  })

  it('does not expose the generic token accounting route in the internal sidebar', async () => {
    const root = createRoot(container)
    await act(async () => {
      root.render(
        React.createElement(
          MemoryRouter,
          { initialEntries: ['/token-usage'] },
          React.createElement(Sidebar)
        )
      )
    })

    const usageLink = container.querySelector('a[href="/token-usage"]')
    expect(usageLink).toBeNull()
    expect(container.textContent).not.toContain('Token 用量')

    await act(async () => root.unmount())
  })
})
