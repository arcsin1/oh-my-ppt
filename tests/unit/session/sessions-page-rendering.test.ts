/**
 * @vitest-environment happy-dom
 */
import React, { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { SessionsPage } from '../../../src/renderer/src/pages/sessions'

const state = vi.hoisted(() => ({
  fetchSessions: vi.fn(async () => undefined),
  deleteSession: vi.fn(async () => undefined),
  updateSessionTitle: vi.fn(async () => undefined),
  listActiveGenerateRuns: vi.fn(async () => []),
  onGenerateChunk: vi.fn(() => () => undefined),
  onHtmlThumbnailChanged: vi.fn(() => () => undefined)
}))

vi.mock('../../../src/renderer/src/store', () => ({
  useSessionStore: () => ({
    sessions: [
      {
        id: 'session-1',
        title: 'Quarterly Review',
        topic: 'Review',
        styleId: 'style-1',
        page_count: 6,
        status: 'completed',
        provider: 'openai',
        model: 'model',
        created_at: 1,
        updated_at: 2,
        metadata: '{}',
        generated_count: 6,
        failed_count: 0,
        slideSizeId: 'wide-16-9',
        slideWidth: 1600,
        slideHeight: 900,
        thumbnailPath: '/cache/session-1.png'
      },
      {
        id: 'session-2',
        title: 'Draft Session',
        topic: 'Draft',
        styleId: 'style-1',
        page_count: 0,
        status: 'active',
        provider: 'openai',
        model: 'model',
        created_at: 1,
        updated_at: 1,
        metadata: '{}',
        generated_count: 0,
        failed_count: 0,
        slideSizeId: 'vertical-9-16',
        slideWidth: 900,
        slideHeight: 1600,
        thumbnailPath: null
      }
    ],
    fetchSessions: state.fetchSessions,
    deleteSession: state.deleteSession,
    updateSessionTitle: state.updateSessionTitle,
    importSessionFile: state.importSessionFile
  }),
  useToastStore: () => ({
    success: vi.fn(),
    error: vi.fn()
  })
}))
vi.mock('@renderer/lib/ipc', () => ({
  ipc: {
    listActiveGenerateRuns: state.listActiveGenerateRuns,
    onGenerateChunk: state.onGenerateChunk,
    onHtmlThumbnailChanged: state.onHtmlThumbnailChanged
  }
}))
vi.mock('@renderer/i18n', () => ({ useT: () => (key: string) => key }))
const setInputValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('SessionsPage rendering', () => {
  beforeEach(() => vi.clearAllMocks())

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('renders sessions in fixed-height cards with centered size-aware thumbnails', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(MemoryRouter, null, React.createElement(SessionsPage)))
      await Promise.resolve()
    })

    const card = container.querySelector('[data-session-card-id="session-1"]')
    expect(card).toBeTruthy()
    expect(card?.parentElement?.className).toContain('grid-cols-2')
    expect(card?.className).toContain('flex-col')
    expect(card?.querySelector('[data-session-thumbnail-frame]')?.className).toContain('h-[230px]')
    expect((card?.querySelector('img') as HTMLImageElement | null)?.style.aspectRatio).toBe(
      '1600 / 900'
    )
    const portraitCard = container.querySelector('[data-session-card-id="session-2"]')
    expect((portraitCard?.querySelector('img') as HTMLImageElement | null)?.style.aspectRatio).toBe(
      '900 / 1600'
    )
    expect(card?.querySelectorAll('img')).toHaveLength(1)
    expect(card?.querySelectorAll('iframe')).toHaveLength(0)
    const placeholderImage = container.querySelector(
      '[data-session-card-id="session-2"] img'
    ) as HTMLImageElement | null
    expect(placeholderImage?.src).toContain('space.webp')
    expect(container.querySelectorAll('iframe')).toHaveLength(0)
    expect(container.textContent).toContain('Quarterly Review')
    expect(container.querySelector('button[aria-label="sessions.editTitleTooltip"]')).toBeTruthy()
    expect(container.querySelector('button[aria-label="sessions.saveTemplateTooltip"]')).toBeNull()
    expect(container.querySelector('button[aria-label="common.delete"]')).toBeTruthy()

    await act(async () => root.unmount())
  })

  it('filters sessions by title from the page search field', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(React.createElement(MemoryRouter, null, React.createElement(SessionsPage)))
      await Promise.resolve()
    })

    const searchButton = container.querySelector(
      'button[aria-label="sessions.searchButton"]'
    ) as HTMLButtonElement | null
    expect(searchButton).toBeTruthy()

    await act(async () => {
      searchButton!.click()
    })

    const searchInput = container.querySelector(
      'input[placeholder="sessions.searchPlaceholder"]'
    ) as HTMLInputElement | null
    expect(searchInput).toBeTruthy()

    await act(async () => {
      setInputValue(searchInput!, 'quarter')
    })

    expect(container.textContent).toContain('Quarterly Review')
    expect(container.querySelector('[data-session-card-id="session-2"]')).toBeNull()

    await act(async () => {
      setInputValue(searchInput!, 'missing')
    })

    expect(container.querySelector('[data-session-card-id="session-1"]')).toBeNull()
    expect(container.querySelector('[data-session-card-id="session-2"]')).toBeNull()
    expect(container.textContent).toContain('sessions.noSearchResultsTitle')

    const clearButton = container.querySelector(
      'button[aria-label="sessions.clearSearch"]'
    ) as HTMLButtonElement | null
    expect(clearButton).toBeTruthy()

    await act(async () => {
      clearButton!.click()
    })

    expect(container.querySelector('input[placeholder="sessions.searchPlaceholder"]')).toBeNull()
    expect(container.querySelector('[data-session-card-id="session-1"]')).toBeTruthy()
    expect(container.querySelector('[data-session-card-id="session-2"]')).toBeTruthy()
    expect(container.textContent).toContain('Quarterly Review')
    expect(container.textContent).toContain('Draft Session')

    await act(async () => root.unmount())
  })
})
