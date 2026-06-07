import { beforeEach, describe, expect, it, vi } from 'vitest'

const exportHandlerState = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

  return {
    browserWindowMock: {
      fromWebContents: vi.fn(() => null),
      getFocusedWindow: vi.fn(() => null)
    },
    dialogMock: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn()
    },
    handlers,
    ipcMainMock: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    },
    logMock: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    },
    shellMock: {
      openPath: vi.fn(),
      showItemInFolder: vi.fn()
    },
    writeHtmlToPptxMock: vi.fn(async () => undefined),
    collectEmbeddedFontsMock: vi.fn(async () => []),
    captureHtmlPageToPptxImageSlideMock: vi.fn(),
    extractHtmlPageToPptxSlideMock: vi.fn()
  }
})

vi.mock('electron', () => ({
  BrowserWindow: exportHandlerState.browserWindowMock,
  dialog: exportHandlerState.dialogMock,
  ipcMain: exportHandlerState.ipcMainMock,
  shell: exportHandlerState.shellMock
}))

vi.mock('electron-log/main.js', () => ({
  default: exportHandlerState.logMock
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: {
    dev: false
  }
}))

vi.mock('../../../src/main/utils/html-pptx', () => ({
  writeHtmlToPptx: exportHandlerState.writeHtmlToPptxMock,
  collectEmbeddedFonts: exportHandlerState.collectEmbeddedFontsMock
}))

vi.mock('../../../src/main/utils/html-pptx/renderer', () => ({
  captureHtmlPageToPptxImageSlide: exportHandlerState.captureHtmlPageToPptxImageSlideMock,
  extractHtmlPageToPptxSlide: exportHandlerState.extractHtmlPageToPptxSlideMock
}))

async function registerHandlers() {
  vi.resetModules()
  exportHandlerState.handlers.clear()

  const { registerExportHandlers } = await import('../../../src/main/ipc/io/export-handlers')

  const db = {
    getProject: vi.fn(async () => ({ id: 'project-1' })),
    updateProjectStatus: vi.fn(async () => undefined)
  }

  const ctx = {
    mainWindow: {} as never,
    db,
    resolveSessionPageFiles: vi.fn(async () => ({
      session: { id: 'session-1', title: 'Deck' },
      pages: [
        {
          id: 'session-page-1',
          pageId: 'page-1',
          pageNumber: 1,
          title: 'Overview',
          htmlPath: '/tmp/page-1.html'
        },
        {
          id: 'session-page-2',
          pageId: 'page-2',
          pageNumber: 2,
          title: 'Risks',
          htmlPath: '/tmp/page-2.html'
        }
      ],
      projectDir: '/tmp/project'
    })),
    renderPageToPdfBuffer: vi.fn(),
    waitForPrintReadySignal: vi.fn(),
    EXPORT_PAGE_READY_TIMEOUT_MS: 1000,
    EXPORT_CAPTURE_SETTLE_MS: 100
  }

  registerExportHandlers(ctx as never)

  return {
    db,
    ctx,
    getHandler: (channel: string) => exportHandlerState.handlers.get(channel)
  }
}

describe('export:pptx animation fidelity warnings', () => {
  beforeEach(() => {
    exportHandlerState.browserWindowMock.fromWebContents.mockReset()
    exportHandlerState.browserWindowMock.fromWebContents.mockReturnValue(null)
    exportHandlerState.browserWindowMock.getFocusedWindow.mockReset()
    exportHandlerState.browserWindowMock.getFocusedWindow.mockReturnValue(null)
    exportHandlerState.dialogMock.showOpenDialog.mockReset()
    exportHandlerState.dialogMock.showSaveDialog.mockReset()
    exportHandlerState.handlers.clear()
    exportHandlerState.ipcMainMock.handle.mockClear()
    exportHandlerState.logMock.error.mockClear()
    exportHandlerState.logMock.info.mockClear()
    exportHandlerState.logMock.warn.mockClear()
    exportHandlerState.shellMock.openPath.mockReset()
    exportHandlerState.shellMock.showItemInFolder.mockReset()
    exportHandlerState.writeHtmlToPptxMock.mockClear()
    exportHandlerState.collectEmbeddedFontsMock.mockClear()
    exportHandlerState.captureHtmlPageToPptxImageSlideMock.mockReset()
    exportHandlerState.extractHtmlPageToPptxSlideMock.mockReset()
  })

  it('returns page-scoped fidelity warnings for editable PPTX export', async () => {
    exportHandlerState.dialogMock.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/tmp/output.pptx'
    })

    exportHandlerState.extractHtmlPageToPptxSlideMock
      .mockResolvedValueOnce({
        slide: {
          title: 'Overview',
          texts: [{ text: 'Overview', x: 1, y: 1, w: 1, h: 1, fontSize: 24 }],
          shapes: [],
          images: [],
          tables: [],
          animationTraces: [
            {
              type: 'slide-up',
              trigger: 'load',
              duration: 500,
              delay: 0,
              order: 0,
              x: 0,
              y: 0,
              w: 100,
              h: 100
            }
          ]
        }
      })
      .mockResolvedValueOnce({
        slide: {
          title: 'Risks',
          texts: [{ text: 'Risks', x: 1, y: 1, w: 1, h: 1, fontSize: 24 }],
          shapes: [],
          images: [],
          tables: [],
          animationTraces: [
            {
              type: 'path',
              trigger: 'load',
              duration: 500,
              delay: 0,
              order: 0,
              x: 0,
              y: 0,
              w: 100,
              h: 100
            }
          ]
        }
      })

    const { getHandler, db } = await registerHandlers()
    const handler = getHandler('export:pptx')

    const result = await handler?.({ sender: {} }, { sessionId: 'session-1' })

    expect(exportHandlerState.writeHtmlToPptxMock).toHaveBeenCalledWith(
      '/tmp/output.pptx',
      expect.objectContaining({
        title: 'Deck',
        slides: expect.any(Array)
      })
    )
    expect(exportHandlerState.collectEmbeddedFontsMock).toHaveBeenCalled()
    expect(exportHandlerState.shellMock.showItemInFolder).toHaveBeenCalledWith('/tmp/output.pptx')
    expect(db.updateProjectStatus).toHaveBeenCalledWith('project-1', 'exported')
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        cancelled: false,
        path: '/tmp/output.pptx',
        pageCount: 2,
        warnings: [
          expect.stringContaining('第 1 页《Overview》：动画 slide-up'),
          expect.stringContaining('第 2 页《Risks》：动画 path')
        ]
      })
    )
  })
})
