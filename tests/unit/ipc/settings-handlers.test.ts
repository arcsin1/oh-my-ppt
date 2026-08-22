import { beforeEach, describe, expect, it, vi } from 'vitest'

const settingsHandlersState = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()

  return {
    appMock: {
      getVersion: vi.fn(() => '1.0.0')
    },
    applyProxyMock: vi.fn(),
    dialogMock: {
      showOpenDialog: vi.fn()
    },
    handlers,
    ipcMainMock: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
        handlers.set(channel, handler)
      })
    },
    localeMock: {
      readAppLocale: vi.fn(async () => 'zh'),
      uiText: vi.fn((locale: string, zh: string, en: string) => (locale === 'en' ? en : zh))
    },
    logMock: {
      error: vi.fn(),
      info: vi.fn()
    },
    resolveModelMock: vi.fn()
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(),
    getFocusedWindow: vi.fn()
  },
  app: settingsHandlersState.appMock,
  dialog: settingsHandlersState.dialogMock,
  ipcMain: settingsHandlersState.ipcMainMock
}))

vi.mock('electron-log/main.js', () => ({
  default: settingsHandlersState.logMock
}))

vi.mock('../../../src/main/agent-runtime/model', () => ({
  resolveModel: settingsHandlersState.resolveModelMock,
  runWithModelTemperatureControl: <T>(_config: unknown, task: () => T): T => task(),
  OPENAI_RESPONSES_FORMAT_ERROR_EN: 'Invalid OpenAI Responses API payload.',
  OPENAI_RESPONSES_FORMAT_ERROR_ZH: '当前 provider 返回的不是 OpenAI Responses API 格式。',
  isOpenAIResponsesFormatError: (error: unknown) =>
    /Cannot read propert(?:y|ies).*undefined.*map|Cannot read propert(?:y|ies).*map.*undefined/i.test(
      error instanceof Error ? error.message : ''
    )
}))

vi.mock('../../../src/main/utils/proxy', () => ({
  applyProxy: settingsHandlersState.applyProxyMock
}))

vi.mock('../../../src/main/config/locale-utils', () => ({
  readAppLocale: settingsHandlersState.localeMock.readAppLocale,
  uiText: settingsHandlersState.localeMock.uiText
}))

vi.mock('@shared/model-timeout', () => ({
  CONFIGURABLE_MODEL_TIMEOUT_PROFILES: ['planning', 'design', 'agent', 'document'],
  resolveModelTimeoutMs: vi.fn((value: unknown, profile: string) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    const defaults: Record<string, number> = {
      planning: 300000,
      design: 300000,
      agent: 600000,
      document: 600000
    }
    return defaults[profile] ?? 300000
  })
}))

async function registerWithDb(overrides: Partial<Record<string, unknown>> = {}) {
  vi.resetModules()
  settingsHandlersState.handlers.clear()

  const { registerSettingsHandlers } = await import('../../../src/main/config/settings-handlers')

  const db = {
    getAllSettings: vi.fn(async () => ({})),
    listModelConfigs: vi.fn(async () => []),
    setSetting: vi.fn(async () => undefined),
    setStoragePath: vi.fn(async () => undefined),
    ...overrides
  }

  const ctx = {
    mainWindow: {} as never,
    db,
    encryptApiKey: vi.fn((value: string) => value),
    decryptApiKey: vi.fn((value: unknown) => String(value ?? ''))
  }

  registerSettingsHandlers(ctx as never)

  return {
    db,
    getHandler: (channel: string) => settingsHandlersState.handlers.get(channel)
  }
}

describe('registerSettingsHandlers proxy settings', () => {
  beforeEach(() => {
    settingsHandlersState.applyProxyMock.mockReset()
    settingsHandlersState.appMock.getVersion.mockClear()
    settingsHandlersState.dialogMock.showOpenDialog.mockReset()
    settingsHandlersState.handlers.clear()
    settingsHandlersState.ipcMainMock.handle.mockClear()
    settingsHandlersState.localeMock.readAppLocale.mockReset()
    settingsHandlersState.localeMock.readAppLocale.mockResolvedValue('zh')
    settingsHandlersState.localeMock.uiText.mockClear()
    settingsHandlersState.logMock.error.mockClear()
    settingsHandlersState.logMock.info.mockClear()
    settingsHandlersState.resolveModelMock.mockReset()
  })

  it('returns trimmed proxyUrl from settings:get', async () => {
    const { getHandler } = await registerWithDb({
      getAllSettings: vi.fn(async () => ({
        locale: 'en',
        proxy_url: '  http://127.0.0.1:7890  ',
        storage_path: '  /tmp/workspace  '
      }))
    })

    const getSettings = getHandler('settings:get')
    const result = await getSettings?.()

    expect(result).toMatchObject({
      locale: 'en',
      proxyUrl: 'http://127.0.0.1:7890',
      storagePath: '/tmp/workspace'
    })
  })

  it('applies proxy before persisting proxy_url in settings:save', async () => {
    const callOrder: string[] = []
    settingsHandlersState.applyProxyMock.mockImplementation(() => {
      callOrder.push('apply')
    })
    const db = {
      setSetting: vi.fn(async (key: string) => {
        if (key === 'proxy_url') {
          callOrder.push('persist')
        }
      })
    }
    const { getHandler } = await registerWithDb(db)

    const saveSettings = getHandler('settings:save')
    const result = await saveSettings?.(undefined, {
      proxyUrl: '  http://127.0.0.1:7890  '
    })

    expect(result).toEqual({ success: true })
    expect(settingsHandlersState.applyProxyMock).toHaveBeenCalledWith('http://127.0.0.1:7890')
    expect(db.setSetting).toHaveBeenCalledWith('proxy_url', 'http://127.0.0.1:7890')
    expect(callOrder).toEqual(['apply', 'persist'])
  })

  it('does not persist proxy_url when applyProxy fails', async () => {
    settingsHandlersState.applyProxyMock.mockImplementation(() => {
      throw new Error('bad proxy')
    })
    const db = {
      setSetting: vi.fn(async () => undefined)
    }
    const { getHandler } = await registerWithDb(db)

    const saveSettings = getHandler('settings:save')

    await expect(
      saveSettings?.(undefined, {
        proxyUrl: 'http://broken-proxy'
      })
    ).rejects.toThrow('代理设置无效：bad proxy')

    expect(settingsHandlersState.localeMock.readAppLocale).toHaveBeenCalled()
    expect(db.setSetting).not.toHaveBeenCalledWith('proxy_url', expect.anything())
  })

  it('clears persisted proxy when saving an empty proxyUrl', async () => {
    const db = {
      setSetting: vi.fn(async () => undefined)
    }
    const { getHandler } = await registerWithDb(db)

    const saveSettings = getHandler('settings:save')
    await saveSettings?.(undefined, { proxyUrl: '   ' })

    expect(settingsHandlersState.applyProxyMock).toHaveBeenCalledWith(undefined)
    expect(db.setSetting).toHaveBeenCalledWith('proxy_url', '')
  })
})

describe('registerSettingsHandlers model temperature settings', () => {
  beforeEach(() => {
    settingsHandlersState.handlers.clear()
    settingsHandlersState.ipcMainMock.handle.mockClear()
    settingsHandlersState.localeMock.readAppLocale.mockResolvedValue('zh')
    settingsHandlersState.resolveModelMock.mockReset()
  })

  it('returns disableTemperature in the model config list', async () => {
    const { getHandler } = await registerWithDb({
      listModelConfigs: vi.fn(async () => [
        {
          id: 'model-1',
          name: 'Reasoning model',
          provider: 'openai',
          model: 'reasoner',
          apiKey: 'secret',
          baseUrl: '',
          maxTokens: 4096,
          disableTemperature: 1,
          thinkingParameterMode: 'omit',
          active: 1,
          createdAt: 1,
          updatedAt: 2
        }
      ])
    })

    const listModelConfigs = getHandler('settings:listModelConfigs')
    await expect(listModelConfigs?.()).resolves.toEqual([
      expect.objectContaining({
        id: 'model-1',
        disableTemperature: true,
        thinkingParameterMode: 'omit'
      })
    ])
  })

  it('persists parameter controls when saving a model config', async () => {
    const upsertModelConfig = vi.fn(async () => 'model-1')
    const { getHandler } = await registerWithDb({ upsertModelConfig })

    const saveModelConfig = getHandler('settings:upsertModelConfig')
    await saveModelConfig?.(undefined, {
      name: 'Reasoning model',
      provider: 'openai',
      model: 'reasoner',
      apiKey: 'secret',
      baseUrl: '',
      maxTokens: 4096,
      disableTemperature: true,
      thinkingParameterMode: 'omit'
    })

    expect(upsertModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        disableTemperature: true,
        thinkingParameterMode: 'omit'
      })
    )
  })

  it('accepts the OpenAI Responses provider when saving a model config', async () => {
    const upsertModelConfig = vi.fn(async () => 'model-1')
    const { getHandler } = await registerWithDb({ upsertModelConfig })

    const saveModelConfig = getHandler('settings:upsertModelConfig')
    await saveModelConfig?.(undefined, {
      name: 'Responses model',
      provider: 'openai-responses',
      model: 'gpt-5.1',
      apiKey: 'secret',
      baseUrl: 'https://api.openai.com/v1',
      maxTokens: 4096,
      disableTemperature: false,
      thinkingParameterMode: 'not-valid'
    })

    expect(upsertModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai-responses',
        thinkingParameterMode: 'auto'
      })
    )
  })

  it('accepts the OrcaRouter provider when saving a model config', async () => {
    const upsertModelConfig = vi.fn(async () => 'model-1')
    const { getHandler } = await registerWithDb({ upsertModelConfig })

    const saveModelConfig = getHandler('settings:upsertModelConfig')
    await saveModelConfig?.(undefined, {
      name: 'OrcaRouter model',
      provider: 'orcarouter',
      model: 'orcarouter/auto',
      apiKey: 'sk-orca-',
      baseUrl: 'https://api.orcarouter.ai/v1',
      maxTokens: 4096,
      disableTemperature: false,
      thinkingParameterMode: 'not-valid'
    })

    expect(upsertModelConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'orcarouter',
        thinkingParameterMode: 'auto'
      })
    )
  })

  it('explains invalid Responses API payloads during model verification', async () => {
    settingsHandlersState.localeMock.readAppLocale.mockResolvedValue('zh')
    settingsHandlersState.resolveModelMock.mockReturnValue({
      invoke: vi.fn(async () => {
        throw new TypeError("Cannot read properties of undefined (reading 'map')")
      })
    })
    const { getHandler } = await registerWithDb()

    const verifyApiKey = getHandler('settings:verifyApiKey')
    const result = await verifyApiKey?.(undefined, {
      provider: 'openai-responses',
      model: 'gpt-5.5',
      apiKey: 'secret',
      baseUrl: 'https://www.toumingren.xyz/v1',
      maxTokens: 4096,
      timeoutMs: 60000
    })

    expect(result).toEqual({
      valid: false,
      message: expect.stringContaining('不是 OpenAI Responses API 格式')
    })
  })

  it('explains unsupported thinking parameter errors during model verification', async () => {
    settingsHandlersState.localeMock.readAppLocale.mockResolvedValue('zh')
    settingsHandlersState.resolveModelMock.mockReturnValue({
      invoke: vi.fn(async () => {
        throw new Error('Unsupported parameter: thinking')
      })
    })
    const { getHandler } = await registerWithDb()

    const verifyApiKey = getHandler('settings:verifyApiKey')
    const result = await verifyApiKey?.(undefined, {
      provider: 'openai',
      model: 'compatible-model',
      apiKey: 'secret',
      baseUrl: 'https://api.example-compatible.com/v1',
      maxTokens: 4096,
      thinkingParameterMode: 'auto',
      timeoutMs: 60000
    })

    expect(result).toEqual({
      valid: false,
      message: expect.stringContaining('不发送 thinking 参数')
    })
  })

  it('explains unrecognized thinking argument errors during model verification', async () => {
    settingsHandlersState.localeMock.readAppLocale.mockResolvedValue('zh')
    settingsHandlersState.resolveModelMock.mockReturnValue({
      invoke: vi.fn(async () => {
        throw new Error('Unrecognized request argument supplied: thinking')
      })
    })
    const { getHandler } = await registerWithDb()

    const verifyApiKey = getHandler('settings:verifyApiKey')
    const result = await verifyApiKey?.(undefined, {
      provider: 'openai',
      model: 'compatible-model',
      apiKey: 'secret',
      baseUrl: 'https://api.example-compatible.com/v1',
      maxTokens: 4096,
      thinkingParameterMode: 'auto',
      timeoutMs: 60000
    })

    expect(result).toEqual({
      valid: false,
      message: expect.stringContaining('不发送 thinking 参数')
    })
  })

  it('explains older undefined map errors during Responses API verification', async () => {
    settingsHandlersState.localeMock.readAppLocale.mockResolvedValue('zh')
    settingsHandlersState.resolveModelMock.mockReturnValue({
      invoke: vi.fn(async () => {
        throw new TypeError("Cannot read property 'map' of undefined")
      })
    })
    const { getHandler } = await registerWithDb()

    const verifyApiKey = getHandler('settings:verifyApiKey')
    const result = await verifyApiKey?.(undefined, {
      provider: 'openai-responses',
      model: 'gpt-5.5',
      apiKey: 'secret',
      baseUrl: 'https://www.toumingren.xyz/v1',
      maxTokens: 4096,
      timeoutMs: 60000
    })

    expect(result).toEqual({
      valid: false,
      message: expect.stringContaining('OpenAI Responses API')
    })
  })
})

describe('registerSettingsHandlers model usage', () => {
  beforeEach(() => {
    settingsHandlersState.handlers.clear()
    settingsHandlersState.ipcMainMock.handle.mockClear()
  })

  it('delegates the selected usage period to the database', async () => {
    const stats = {
      period: '7d',
      startedAt: 1,
      totals: {
        callCount: 2,
        exactCallCount: 1,
        estimatedCallCount: 1,
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120
      },
      byModel: [],
      byDay: []
    }
    const getModelUsageStats = vi.fn(async () => stats)
    const { getHandler } = await registerWithDb({ getModelUsageStats })

    await expect(getHandler('settings:getModelUsage')?.(undefined, '7d')).resolves.toBe(stats)
    expect(getModelUsageStats).toHaveBeenCalledWith('7d')
  })

  it('falls back to 30 days for an invalid usage period', async () => {
    const getModelUsageStats = vi.fn(async () => ({ period: '30d' }))
    const { getHandler } = await registerWithDb({ getModelUsageStats })

    await getHandler('settings:getModelUsage')?.(undefined, 'invalid')
    expect(getModelUsageStats).toHaveBeenCalledWith('30d')
  })
})
