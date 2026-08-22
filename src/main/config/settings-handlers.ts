import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import log from 'electron-log/main.js'
import { resolveModel } from '../agent-runtime/model'
import { applyProxy } from '../utils/proxy'
import type { IpcContext } from '../ipc/context'
import {
  CONFIGURABLE_MODEL_TIMEOUT_PROFILES,
  type ConfigurableModelTimeoutProfile,
  resolveModelTimeoutMs
} from '@shared/model-timeout'
import { readAppLocale, uiText } from './locale-utils'
import {
  OPENAI_RESPONSES_FORMAT_ERROR_EN,
  OPENAI_RESPONSES_FORMAT_ERROR_ZH,
  isOpenAIResponsesFormatError,
  runWithModelTemperatureControl
} from '../agent-runtime/model'
import type { ModelUsagePeriod } from '@shared/model-usage'
import { normalizeThinkingParameterMode } from '@shared/model-config'

const readGlobalTimeouts = (
  settings: Record<string, unknown>
): Record<ConfigurableModelTimeoutProfile, number> =>
  Object.fromEntries(
    CONFIGURABLE_MODEL_TIMEOUT_PROFILES.map((profile) => [
      profile,
      resolveModelTimeoutMs(settings[`timeout_ms_${profile}`], profile)
    ])
  ) as Record<ConfigurableModelTimeoutProfile, number>

const VALID_PROVIDERS = [
  'anthropic',
  'openai',
  'openai-responses',
  'orcarouter',
  'google'
] as const
type Provider = (typeof VALID_PROVIDERS)[number]
const normalizeProvider = (provider: unknown): Provider =>
  VALID_PROVIDERS.includes(provider as Provider) ? (provider as Provider) : 'openai'
const normalizeMaxTokens = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 4096
  return Math.max(256, Math.min(16384, Math.floor(value)))
}

const normalizeVerifyErrorMessage = (
  error: unknown,
  options: {
    locale: 'zh' | 'en'
    provider: unknown
  }
): string | null => {
  const message = error instanceof Error ? error.message : ''
  const unsupportedThinkingPattern = [
    /(?:unsupported|unknown|unrecognized|invalid|unexpected).*(?:argument|parameter|field).*thinking/i,
    /thinking.*(?:unsupported|unknown|unrecognized|invalid)/i
  ]
  const isThinkingParameterError =
    unsupportedThinkingPattern.some((pattern) => pattern.test(message)) ||
    (/(?:argument|parameter|field)/i.test(message) && /thinking/i.test(message))
  if (options.provider === 'openai-responses' && isOpenAIResponsesFormatError(error)) {
    return uiText(
      options.locale,
      OPENAI_RESPONSES_FORMAT_ERROR_ZH,
      OPENAI_RESPONSES_FORMAT_ERROR_EN
    )
  }
  if (options.provider === 'openai' && isThinkingParameterError) {
    return uiText(
      options.locale,
      '当前模型不支持 thinking 参数，请在模型设置中改为“不发送 thinking 参数”。',
      'This model does not support the thinking parameter. In model settings, choose "Do not send thinking".'
    )
  }
  return message || null
}

export function registerSettingsHandlers(ctx: IpcContext): void {
  const { mainWindow, db, encryptApiKey, decryptApiKey } = ctx

  ipcMain.handle('app:getVersion', async () => {
    return { version: app.getVersion() }
  })

  ipcMain.handle('settings:get', async () => {
    log.info('[settings:get] requested')
    const settings = await db.getAllSettings()
    const storagePath =
      typeof settings.storage_path === 'string' && settings.storage_path.trim().length > 0
        ? settings.storage_path.trim()
        : ''
    const proxyUrl =
      typeof settings.proxy_url === 'string' && settings.proxy_url.trim().length > 0
        ? settings.proxy_url.trim()
        : ''
    return {
      theme: settings.theme || 'light',
      locale: settings.locale === 'en' ? 'en' : 'zh',
      storagePath,
      timeouts: readGlobalTimeouts(settings),
      proxyUrl
    }
  })

  ipcMain.handle('settings:listModelConfigs', async () => {
    return (await db.listModelConfigs()).map((config) => ({
      id: config.id,
      name: config.name,
      provider: config.provider,
      model: config.model,
      apiKey: decryptApiKey(config.apiKey),
      baseUrl: config.baseUrl,
      maxTokens: config.maxTokens || 4096,
      disableTemperature: config.disableTemperature === 1,
      thinkingParameterMode: normalizeThinkingParameterMode(config.thinkingParameterMode),
      active: config.active === 1,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt
    }))
  })

  ipcMain.handle('settings:getModelUsage', async (_event, requestedPeriod) => {
    const period: ModelUsagePeriod =
      requestedPeriod === 'today' ||
      requestedPeriod === '7d' ||
      requestedPeriod === '30d' ||
      requestedPeriod === 'all'
        ? requestedPeriod
        : '30d'
    return db.getModelUsageStats(period)
  })

  ipcMain.handle('settings:validateUploadPrerequisites', async () => {
    const locale = await readAppLocale(ctx)
    const settings = await db.getAllSettings()
    const storagePath =
      typeof settings.storage_path === 'string' && settings.storage_path.trim().length > 0
        ? settings.storage_path.trim()
        : ''
    const activeModel = (await db.listModelConfigs()).find((config) => config.active === 1)
    const hasModel = !!activeModel
    const hasApiKey = typeof activeModel?.apiKey === 'string' && decryptApiKey(activeModel.apiKey).trim().length > 0
    const hasModelName = typeof activeModel?.model === 'string' && activeModel.model.trim().length > 0

    const missing: Array<'storagePath' | 'activeModel' | 'apiKey' | 'model'> = []
    if (!storagePath) missing.push('storagePath')
    if (!hasModel) missing.push('activeModel')
    if (hasModel && !hasApiKey) missing.push('apiKey')
    if (hasModel && !hasModelName) missing.push('model')

    return {
      ready: missing.length === 0,
      missing,
      message:
        missing.length === 0
          ? ''
          : uiText(
              locale,
              '请先前往系统设置完成模型与存储目录配置。',
              'Please complete model and storage configuration in Settings first.'
            )
    }
  })

  ipcMain.handle('settings:save', async (_event, settings) => {
    log.info('[settings:save] received', {
      hasStoragePath:
        typeof settings?.storagePath === 'string' && settings.storagePath.trim().length > 0
    })
    if (settings.theme !== undefined) await db.setSetting('theme', settings.theme)
    if (settings.locale === 'zh' || settings.locale === 'en')
      await db.setSetting('locale', settings.locale)
    if (typeof settings.storagePath === 'string' && settings.storagePath.trim().length > 0) {
      await db.setStoragePath(settings.storagePath)
    }
    if (settings.timeouts && typeof settings.timeouts === 'object') {
      const timeouts = settings.timeouts as Partial<
        Record<ConfigurableModelTimeoutProfile, unknown>
      >
      for (const profile of CONFIGURABLE_MODEL_TIMEOUT_PROFILES) {
        const value = timeouts[profile]
        if (value !== undefined) {
          await db.setSetting(`timeout_ms_${profile}`, resolveModelTimeoutMs(value, profile))
        }
      }
    }
    if ('proxyUrl' in settings) {
      const nextProxy =
        typeof settings.proxyUrl === 'string' ? settings.proxyUrl.trim() : ''
      try {
        applyProxy(nextProxy || undefined)
      } catch (proxyError) {
        log.error('[settings:save] failed to apply proxy', {
          proxyUrl: nextProxy,
          message: proxyError instanceof Error ? proxyError.message : String(proxyError)
        })
        throw new Error(
          uiText(
            await readAppLocale(ctx),
            `代理设置无效：${proxyError instanceof Error ? proxyError.message : '请检查地址格式'}`,
            `Invalid proxy: ${proxyError instanceof Error ? proxyError.message : 'check the address format'}`
          )
        )
      }
      await db.setSetting('proxy_url', nextProxy)
    }
    return { success: true }
  })

  ipcMain.handle('settings:upsertModelConfig', async (_event, payload) => {
    const locale = await readAppLocale(ctx)
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const provider = normalizeProvider(record.provider)
    const model = typeof record.model === 'string' ? record.model.trim() : ''
    const apiKey = typeof record.apiKey === 'string' ? record.apiKey.trim() : ''
    const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : ''
    const id =
      typeof record.id === 'string' && record.id.trim().length > 0 ? record.id.trim() : undefined
    if (!name) throw new Error(uiText(locale, '请填写模型名称。', 'Enter model name.'))
    if (!model) throw new Error(uiText(locale, '请填写 model。', 'Enter model.'))
    if (!apiKey) throw new Error(uiText(locale, '请填写 api_key。', 'Enter api_key.'))
    const maxTokens = normalizeMaxTokens(record.maxTokens)
    const thinkingParameterMode = normalizeThinkingParameterMode(record.thinkingParameterMode)
    const savedId = await db.upsertModelConfig({
      id,
      name,
      provider,
      model,
      apiKey: encryptApiKey(apiKey),
      baseUrl,
      maxTokens,
      disableTemperature: record.disableTemperature === true,
      thinkingParameterMode,
      active: record.active === true
    })
    return { success: true, id: savedId }
  })

  ipcMain.handle('settings:setActiveModelConfig', async (_event, id) => {
    const locale = await readAppLocale(ctx)
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(uiText(locale, '模型配置 ID 不能为空。', 'Model config ID is required.'))
    }
    const modelId = id.trim()
    try {
      await db.setActiveModelConfig(modelId)
    } catch (error) {
      if (error instanceof Error && error.message === 'Model config does not exist') {
        throw new Error(uiText(locale, '模型配置不存在。', 'Model config does not exist.'))
      }
      throw error
    }
    return { success: true }
  })

  ipcMain.handle('settings:deleteModelConfig', async (_event, id) => {
    const locale = await readAppLocale(ctx)
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(uiText(locale, '模型配置 ID 不能为空。', 'Model config ID is required.'))
    }
    try {
      await db.deleteModelConfig(id.trim())
    } catch (error) {
      if (error instanceof Error && error.message === 'Model config does not exist') {
        throw new Error(uiText(locale, '模型配置不存在。', 'Model config does not exist.'))
      }
      throw error
    }
    return { success: true }
  })

  ipcMain.handle(
    'settings:verifyApiKey',
    async (
      _event,
      {
        provider,
        apiKey,
        model,
        baseUrl,
        maxTokens,
        disableTemperature,
        thinkingParameterMode,
        timeoutMs
      }
    ) => {
      const locale = await readAppLocale(ctx)
      const resolvedTimeoutMs = resolveModelTimeoutMs(timeoutMs, 'verify')
      const resolvedMaxTokens = normalizeMaxTokens(maxTokens)
      const resolvedThinkingParameterMode = normalizeThinkingParameterMode(thinkingParameterMode)
      log.info('[settings:verifyApiKey] received', {
        provider,
        model,
        hasApiKey: typeof apiKey === 'string' && apiKey.trim().length > 0,
        baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
        maxTokens: resolvedMaxTokens,
        thinkingParameterMode: resolvedThinkingParameterMode,
        timeoutMs: resolvedTimeoutMs
      })

      if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
        return {
          valid: false,
          message: uiText(locale, '请先填写 api_key。', 'Enter api_key first.')
        }
      }
      if (typeof model !== 'string' || model.trim().length === 0) {
        return { valid: false, message: uiText(locale, '请先填写 model。', 'Enter model first.') }
      }

      try {
        const client = runWithModelTemperatureControl(
          {
            disableTemperature: disableTemperature === true,
            thinkingParameterMode: resolvedThinkingParameterMode
          },
          () =>
            resolveModel(
              provider,
              apiKey.trim(),
              model.trim(),
              typeof baseUrl === 'string' ? baseUrl.trim() : '',
              undefined,
              resolvedMaxTokens,
              ctx.modelRuntime
            )
        )
        await client.invoke('Reply with OK.', {
          signal: AbortSignal.timeout(resolvedTimeoutMs)
        })
        log.info('[settings:verifyApiKey] success', { provider, model })
        return { valid: true, message: uiText(locale, '连接验证成功。', 'Connection verified.') }
      } catch (error) {
        const message =
          normalizeVerifyErrorMessage(error, { locale, provider }) ||
          uiText(
                locale,
                '连接验证失败，请检查 api_key、model 或 base_url。',
                'Connection verification failed. Check api_key, model, or base_url.'
              )
        log.error('[settings:verifyApiKey] failed', {
          provider,
          model,
          baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
          message
        })
        return { valid: false, message }
      }
    }
  )

  ipcMain.handle('settings:chooseStoragePath', async (event) => {
    log.info('[settings:chooseStoragePath] received')
    const targetWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow

    try {
      const settings = await db.getAllSettings()
      const currentStoragePath =
        typeof settings.storage_path === 'string' && settings.storage_path.trim().length > 0
          ? settings.storage_path.trim()
          : ''
      const result = await dialog.showOpenDialog(targetWindow, {
        title: '选择 OhMYPPT 存储目录',
        buttonLabel: '选择目录',
        ...(currentStoragePath ? { defaultPath: currentStoragePath } : {}),
        properties: ['openDirectory', 'createDirectory', 'promptToCreate']
      })
      if (!result.canceled && result.filePaths.length > 0) {
        return { path: result.filePaths[0] }
      }
      return { path: null }
    } catch (error) {
      const message =
        error instanceof Error && error.message.length > 0
          ? error.message
          : '无法打开系统目录选择器。'
      log.error('[settings:chooseStoragePath] failed', { message })
      return { path: null, error: message }
    }
  })
}
