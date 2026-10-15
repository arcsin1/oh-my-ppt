import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  const defaultAgentStream = async () =>
    (async function* () {
      yield ['', 'messages', [{ lc_kwargs: { type: 'ai' }, content: 'AI reply', tool_calls: [] }]]
    })()
  const agentStream = vi.fn(defaultAgentStream)
  return {
    handlers,
    agentStream,
    defaultAgentStream,
    agentConfig: null as {
      tools?: Array<{ invoke: (input: unknown) => Promise<unknown> }>
      systemPrompt?: string
      backend?: unknown
      permissions?: unknown
    } | null,
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    },
    log: { info: vi.fn(), warn: vi.fn() },
    db: {
      listHtmlEditMessages: vi.fn(async () => []),
      createHtmlEditMessage: vi.fn(async () => {})
    },
    resolveModel: vi.fn(() => ({ invoke: vi.fn() })),
    applyHtmlEditsForDocument: vi.fn(async () => ({
      html: '<main>updated</main>',
      warnings: [],
      changed: true
    })),
    resolveHtmlEditorDocumentWorkspace: vi.fn(async () => '/workspace/html-editor/doc-1'),
    filesystemBackendOptions: null as { rootDir?: string; virtualMode?: boolean } | null,
    createDeepAgent: vi.fn((config: typeof state.agentConfig) => {
      state.agentConfig = config
      return { stream: state.agentStream }
    }),
    resolveModelConfigForTask: vi.fn(async () => ({
      id: 'model-1',
      name: 'Test model',
      provider: 'openai',
      apiKey: 'key',
      model: 'test-model',
      baseUrl: '',
      maxTokens: 1024
    })),
    resolveGlobalModelTimeouts: vi.fn(async () => ({ agent: 1000 })),
    resolveModelTimeoutMs: vi.fn(() => 1000),
    readAppLocale: vi.fn(async () => 'zh'),
    extractModelText: vi.fn(() => 'AI reply')
  }
})

vi.mock('electron', () => ({ ipcMain: state.ipcMain }))
vi.mock('electron-log/main.js', () => ({ default: state.log }))
vi.mock('../../../src/main/agent-runtime/model', () => ({
  resolveModel: state.resolveModel,
  extractModelText: state.extractModelText,
  resolveAgentOutputBudget: (value: unknown) =>
    Math.max(typeof value === 'number' && value > 0 ? value : 0, 16384)
}))
vi.mock('deepagents', () => ({
  createDeepAgent: state.createDeepAgent,
  FilesystemBackend: class {
    constructor(options: { rootDir?: string; virtualMode?: boolean }) {
      state.filesystemBackendOptions = options
    }
  }
}))
vi.mock('../../../src/main/config/model-config-utils', () => ({
  resolveGlobalModelTimeouts: state.resolveGlobalModelTimeouts,
  resolveModelConfigForTask: state.resolveModelConfigForTask
}))
vi.mock('../../../src/main/config/locale-utils', () => ({
  readAppLocale: state.readAppLocale
}))
vi.mock('../../../src/main/html-editor/html-editor-handlers', () => ({
  applyHtmlEditsForDocument: state.applyHtmlEditsForDocument,
  resolveHtmlEditorDocumentWorkspace: state.resolveHtmlEditorDocumentWorkspace
}))
vi.mock('@shared/model-timeout', () => ({
  resolveModelTimeoutMs: state.resolveModelTimeoutMs
}))

describe('html-editor AI IPC', () => {
  beforeEach(() => {
    vi.resetModules()
    state.handlers.clear()
    state.ipcMain.handle.mockClear()
    state.agentStream.mockReset()
    state.agentStream.mockImplementation(state.defaultAgentStream)
    state.resolveModel.mockClear()
    state.applyHtmlEditsForDocument.mockClear()
    state.resolveHtmlEditorDocumentWorkspace.mockClear()
    state.filesystemBackendOptions = null
    state.createDeepAgent.mockClear()
    state.agentConfig = null
    state.resolveModelConfigForTask.mockClear()
    state.resolveGlobalModelTimeouts.mockClear()
    state.resolveModelTimeoutMs.mockClear()
    state.readAppLocale.mockClear()
    state.extractModelText.mockClear()
    state.db.listHtmlEditMessages.mockClear()
    state.db.createHtmlEditMessage.mockClear()
  })

  it('registers an independent chat handler with selected HTML context', async () => {
    const {
      buildHtmlEditorAiMessages,
      buildHtmlEditorAiSystemPrompt,
      isExplicitHtmlEditorEditRequest,
      registerHtmlEditorAiHandlers
    } = await import('../../../src/main/html-editor/html-editor-ai-handlers')
    registerHtmlEditorAiHandlers({ db: state.db } as never)

    const handler = state.handlers.get('html-editor:aiChat')
    expect(handler).toBeDefined()

    const messages = buildHtmlEditorAiMessages({
      documentTitle: 'Demo',
      pageHtml: '<main><p>Hello</p></main>',
      selectedElement: {
        selector: 'body[data-page-id="doc-1"] p',
        elementTag: 'p',
        elementText: 'Hello',
        html: '<p style="color:red">Hello</p>'
      },
      recentMessages: [{ role: 'assistant', content: 'Previous answer' }],
      userMessage: '把这个元素改造成绿色卡片'
    })
    expect(buildHtmlEditorAiSystemPrompt()).toContain('record_html_editor_plan')
    expect(buildHtmlEditorAiSystemPrompt('zh', { hasSelectedElement: false })).toContain(
      '绝不能生成可执行 edits'
    )
    expect(
      isExplicitHtmlEditorEditRequest('把这个改为蓝色', {
        selector: 'body[data-page-id="doc-1"] p'
      })
    ).toBe(true)
    expect(
      isExplicitHtmlEditorEditRequest('把这个改得更现代', {
        selector: 'body[data-page-id="doc-1"] p'
      })
    ).toBe(false)
    expect(messages[0]?.role).toBe('user')
    expect(messages).toHaveLength(1)
    expect(messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'system' })])
    )
    expect(messages[0]?.content).toContain('color:red')
    expect(messages[0]?.content).toContain('把这个元素改造成绿色卡片')
    expect(messages[0]?.content).toContain('已省略页面 HTML')

    const continuedMessages = buildHtmlEditorAiMessages({
      selectedElement: {
        selector: 'body[data-page-id="doc-1"] p',
        html: '<p>Hello</p>'
      },
      recentMessages: [{ role: 'assistant', content: '上一条方案' }],
      userMessage: '继续按上面的方案改'
    })
    expect(continuedMessages[0]).toEqual({ role: 'assistant', content: '上一条方案' })

    const pageAnalysisMessages = buildHtmlEditorAiMessages({
      pageHtml: '<main><h1>页面标题</h1></main>',
      userMessage: '这个页面布局怎么样'
    })
    expect(pageAnalysisMessages[0]?.content).toContain('<h1>页面标题</h1>')

    const directPlan = {
      intent: 'style',
      target: 'body[data-page-id="doc-1"] p',
      summary: '将元素颜色改为蓝色。',
      changes: ['将元素文字颜色改为蓝色。'],
      confirmationQuestion: '是否按此方案改造？',
      edits: {
        propertyEdits: [
          {
            selector: 'body[data-page-id="doc-1"] p',
            patch: { style: { color: '#3b82f6' } }
          }
        ],
        textEdits: [],
        dragEdits: [],
        deletes: [],
        addElements: []
      }
    }
    state.agentStream.mockImplementation(async () => {
      const tools = state.agentConfig?.tools || []
      await tools[0]?.invoke(directPlan)
      return state.defaultAgentStream()
    })

    const result = await handler?.(
      {},
      {
        documentId: 'doc-1',
        documentTitle: 'Demo',
        pageHtml: '',
        selectedElement: {
          selector: 'body[data-page-id="doc-1"] p',
          elementTag: 'p',
          elementText: 'Hello',
          html: '<p style="color:red">Hello</p>'
        },
        recentMessages: [{ role: 'assistant', content: 'Previous answer' }],
        userMessage: '把这个改为蓝色'
      }
    )

    expect(state.resolveModelConfigForTask).toHaveBeenCalledWith(expect.anything(), {
      modelConfigId: undefined,
      purpose: 'html-editor:aiChat'
    })
    expect(state.resolveModel).toHaveBeenCalledWith(
      'openai',
      'key',
      'test-model',
      '',
      0.35,
      // agent 输出预算下限：模型配置的 1024 会被抬到 16384
      16384,
      undefined
    )
    expect(state.createDeepAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        systemPrompt: expect.stringContaining('record_html_editor_plan'),
        tools: expect.any(Array),
        permissions: [
          { operations: ['read'], paths: ['/**'] },
          { operations: ['write'], paths: ['/**'], mode: 'deny' }
        ]
      })
    )
    expect(state.agentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.not.arrayContaining([expect.objectContaining({ role: 'system' })])
      }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(result).toMatchObject({
      reply: '已完成 HTML 改造。',
      intent: 'style',
      applied: true,
      plan: directPlan,
      requiresConfirmation: false
    })
    const [, applyArgs] = state.applyHtmlEditsForDocument.mock.calls[0] || []
    expect(applyArgs).not.toHaveProperty('html')
    expect(applyArgs).toMatchObject({
      message: 'AI 改造：将元素颜色改为蓝色。'
    })
    expect(state.db.createHtmlEditMessage).toHaveBeenCalledTimes(2)
    expect(state.db.createHtmlEditMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        selectedElement: expect.objectContaining({ selector: 'body[data-page-id="doc-1"] p' })
      })
    )
  })

  it('asks for confirmation for a vague redesign request', async () => {
    const { registerHtmlEditorAiHandlers } =
      await import('../../../src/main/html-editor/html-editor-ai-handlers')
    registerHtmlEditorAiHandlers({ db: state.db } as never)
    const handler = state.handlers.get('html-editor:aiChat')
    const plan = {
      intent: 'redesign',
      target: 'body[data-page-id="doc-1"] p',
      summary: '让这个元素更现代。',
      changes: ['调整配色和圆角，使视觉更现代。'],
      confirmationQuestion: '是否按此方案改造？',
      edits: {
        propertyEdits: [
          {
            selector: 'body[data-page-id="doc-1"] p',
            patch: { style: { backgroundColor: '#eef6ff' } }
          }
        ],
        textEdits: [],
        dragEdits: [],
        deletes: [],
        addElements: []
      }
    }
    state.agentStream.mockImplementation(async () => {
      const tools = state.agentConfig?.tools || []
      await tools[0]?.invoke(plan)
      return state.defaultAgentStream()
    })

    const result = await handler?.(
      {},
      {
        documentId: 'doc-1',
        pageHtml: '<main><p>Hello</p></main>',
        selectedElement: {
          selector: 'body[data-page-id="doc-1"] p',
          html: '<p>Hello</p>'
        },
        userMessage: '把这个改得更现代'
      }
    )

    expect(state.applyHtmlEditsForDocument).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      intent: 'redesign',
      plan,
      requiresConfirmation: true,
      applied: false
    })
    expect(state.db.createHtmlEditMessage).toHaveBeenCalledTimes(2)
  })

  it('requires a selected element before accepting a modification request', async () => {
    const { registerHtmlEditorAiHandlers } =
      await import('../../../src/main/html-editor/html-editor-ai-handlers')
    registerHtmlEditorAiHandlers({ db: state.db } as never)
    const handler = state.handlers.get('html-editor:aiChat')

    const result = await handler?.(
      {},
      {
        documentId: 'doc-1',
        pageHtml: '<main><p>Hello</p></main>',
        userMessage: '改成红色'
      }
    )

    expect(state.resolveModel).not.toHaveBeenCalled()
    expect(state.applyHtmlEditsForDocument).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      reply: '请先在画布中检选一个元素，再让我按你的要求改造它。',
      plan: null,
      requiresConfirmation: false,
      applied: false
    })
    expect(state.db.createHtmlEditMessage).toHaveBeenCalledTimes(2)
  })

  it('gives whole-page analysis a read-only document workspace', async () => {
    const { registerHtmlEditorAiHandlers } =
      await import('../../../src/main/html-editor/html-editor-ai-handlers')
    registerHtmlEditorAiHandlers({ db: state.db } as never)
    const handler = state.handlers.get('html-editor:aiChat')

    const result = await handler?.(
      {},
      {
        documentId: 'doc-1',
        pageHtml: '',
        userMessage: '这个页面布局怎么样'
      }
    )

    expect(state.resolveHtmlEditorDocumentWorkspace).toHaveBeenCalledWith(
      expect.anything(),
      'doc-1'
    )
    expect(state.filesystemBackendOptions).toEqual({
      rootDir: '/workspace/html-editor/doc-1',
      virtualMode: true
    })
    expect(state.applyHtmlEditsForDocument).not.toHaveBeenCalled()
    expect(state.agentConfig?.tools).toHaveLength(2)
    expect(state.agentConfig?.systemPrompt).toContain('read_file')
    expect(state.agentConfig?.systemPrompt).toContain('/current.html')
    expect(state.agentConfig?.permissions).toEqual([
      { operations: ['read'], paths: ['/**'] },
      { operations: ['write'], paths: ['/**'], mode: 'deny' }
    ])
    expect(result).toMatchObject({ applied: false, requiresConfirmation: false, plan: null })
  })

  it('applies the pending plan after an explicit confirmation', async () => {
    const { registerHtmlEditorAiHandlers } =
      await import('../../../src/main/html-editor/html-editor-ai-handlers')
    registerHtmlEditorAiHandlers({ db: state.db } as never)
    const handler = state.handlers.get('html-editor:aiChat')
    const pendingPlan = {
      intent: 'style',
      target: 'body[data-page-id="doc-1"] p',
      summary: '将文字颜色替换为红色。',
      changes: ['将 text-gray-800 替换为 text-red-500。'],
      confirmationQuestion: '是否按此方案改造？',
      edits: {
        propertyEdits: [
          {
            selector: 'body[data-page-id="doc-1"] p',
            patch: { attrs: { className: 'text-red-500' } }
          }
        ],
        textEdits: [],
        dragEdits: [],
        deletes: [],
        addElements: []
      }
    }

    const result = await handler?.(
      {},
      {
        documentId: 'doc-1',
        pageHtml: '<main><p class="text-gray-800">Hello</p></main>',
        selectedElement: {
          selector: 'body[data-page-id="doc-1"] p',
          html: '<p class="text-gray-800">Hello</p>'
        },
        pendingPlan,
        recentMessages: [{ role: 'assistant', content: '方案已记录' }],
        userMessage: '可以，就按这个吧'
      }
    )

    expect(state.applyHtmlEditsForDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        docId: 'doc-1',
        message: 'AI 改造：将文字颜色替换为红色。',
        batch: pendingPlan.edits
      })
    )
    expect(result).toMatchObject({
      applied: true,
      appliedHtml: '<main>updated</main>',
      requiresConfirmation: false
    })
    expect(state.db.createHtmlEditMessage).toHaveBeenCalledTimes(2)
  })

  it('does not report an AI version when the requested edit makes no HTML change', async () => {
    const { registerHtmlEditorAiHandlers } =
      await import('../../../src/main/html-editor/html-editor-ai-handlers')
    registerHtmlEditorAiHandlers({ db: state.db } as never)
    const handler = state.handlers.get('html-editor:aiChat')
    const plan = {
      intent: 'style',
      target: 'body[data-page-id="doc-1"] p',
      summary: '将元素颜色改为蓝色。',
      changes: ['将文字颜色改为蓝色。'],
      confirmationQuestion: '是否按此方案改造？',
      edits: {
        propertyEdits: [
          {
            selector: 'body[data-page-id="doc-1"] p',
            patch: { style: { color: '#3b82f6' } }
          }
        ],
        textEdits: [],
        dragEdits: [],
        deletes: [],
        addElements: []
      }
    }
    state.applyHtmlEditsForDocument.mockResolvedValueOnce({
      html: '<main><p style="color:#3b82f6">Hello</p></main>',
      warnings: [],
      changed: false
    })
    state.agentStream.mockImplementation(async () => {
      const tools = state.agentConfig?.tools || []
      await tools[0]?.invoke(plan)
      return state.defaultAgentStream()
    })

    const result = await handler?.(
      {},
      {
        documentId: 'doc-1',
        selectedElement: {
          selector: 'body[data-page-id="doc-1"] p',
          html: '<p style="color:#3b82f6">Hello</p>'
        },
        userMessage: '把这个改为蓝色'
      }
    )

    expect(result).toMatchObject({
      applied: false,
      appliedHtml: undefined,
      reply: expect.stringContaining('没有产生可写入的 HTML 改动')
    })
    expect(state.applyHtmlEditsForDocument).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ message: 'AI 改造：将元素颜色改为蓝色。' })
    )
  })
})
