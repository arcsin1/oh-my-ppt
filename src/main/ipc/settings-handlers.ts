import { BrowserWindow, dialog, ipcMain } from 'electron'
import log from 'electron-log/main.js'
import { resolveModel } from '../agent'
import type { IpcContext } from './context'
import {
  CONFIGURABLE_MODEL_TIMEOUT_PROFILES,
  type ConfigurableModelTimeoutProfile,
  resolveModelTimeoutMs
} from '@shared/model-timeout'
import {
  DEFAULT_WEB_SEARCH_ENGINES,
  DEFAULT_WEB_SEARCH_LIMIT,
  DEFAULT_WEB_SEARCH_PROXY_URL,
  SUPPORTED_WEB_SEARCH_ENGINES,
  getWebSearchServiceStatus,
  installWebSearchService,
  startWebSearchService
} from '../utils/web-search-service'
import { readAppLocale, uiText } from './locale-utils'

const readGlobalTimeouts = (
  settings: Record<string, unknown>
): Record<ConfigurableModelTimeoutProfile, number> =>
  Object.fromEntries(
    CONFIGURABLE_MODEL_TIMEOUT_PROFILES.map((profile) => [
      profile,
      resolveModelTimeoutMs(settings[`timeout_ms_${profile}`], profile)
    ])
  ) as Record<ConfigurableModelTimeoutProfile, number>

const normalizeProvider = (provider: unknown): 'anthropic' | 'openai' =>
  provider === 'anthropic' ? 'anthropic' : 'openai'

export function registerSettingsHandlers(ctx: IpcContext): void {
  const { mainWindow, db, encryptApiKey, decryptApiKey } = ctx

  ipcMain.handle('settings:get', async () => {
    log.info('[settings:get] requested')
    const settings = await db.getAllSettings()
    const storagePath =
      typeof settings.storage_path === 'string' && settings.storage_path.trim().length > 0
        ? settings.storage_path.trim()
        : ''
    const webSearchEngines = Array.isArray(settings.web_search_engines)
      ? settings.web_search_engines
          .map((item) => String(item || '').trim().toLowerCase())
          .filter((item) =>
            SUPPORTED_WEB_SEARCH_ENGINES.includes(
              item as (typeof SUPPORTED_WEB_SEARCH_ENGINES)[number]
            )
          )
      : DEFAULT_WEB_SEARCH_ENGINES
    const rawWebSearchLimit = Number(settings.web_search_limit)
    const webSearchLimit =
      Number.isFinite(rawWebSearchLimit) && rawWebSearchLimit > 0
        ? Math.max(1, Math.min(20, Math.round(rawWebSearchLimit)))
        : DEFAULT_WEB_SEARCH_LIMIT
    const webSearchUseProxy = settings.web_search_use_proxy === true
    const webSearchProxyUrl =
      typeof settings.web_search_proxy_url === 'string' &&
      settings.web_search_proxy_url.trim().length > 0
        ? settings.web_search_proxy_url.trim()
        : DEFAULT_WEB_SEARCH_PROXY_URL
    return {
      theme: settings.theme || 'light',
      locale: settings.locale === 'en' ? 'en' : 'zh',
      storagePath,
      timeouts: readGlobalTimeouts(settings),
      webSearch: {
        engines: webSearchEngines.length > 0 ? webSearchEngines : DEFAULT_WEB_SEARCH_ENGINES,
        limit: webSearchLimit,
        useProxy: webSearchUseProxy,
        proxyUrl: webSearchProxyUrl,
        serviceStatus: await getWebSearchServiceStatus()
      }
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
      active: config.active === 1,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt
    }))
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
    if (settings.webSearch && typeof settings.webSearch === 'object') {
      const webSearch = settings.webSearch as {
        engines?: unknown
        limit?: unknown
        useProxy?: unknown
        proxyUrl?: unknown
      }
      if (Array.isArray(webSearch.engines)) {
        const engines = webSearch.engines
          .map((item) => String(item || '').trim().toLowerCase())
          .filter((item) =>
            SUPPORTED_WEB_SEARCH_ENGINES.includes(
              item as (typeof SUPPORTED_WEB_SEARCH_ENGINES)[number]
            )
          )
        await db.setSetting(
          'web_search_engines',
          engines.length > 0 ? engines : DEFAULT_WEB_SEARCH_ENGINES
        )
      }
      if (webSearch.limit !== undefined) {
        const rawLimit = Number(webSearch.limit)
        const limit =
          Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.max(1, Math.min(20, Math.round(rawLimit)))
            : DEFAULT_WEB_SEARCH_LIMIT
        await db.setSetting('web_search_limit', limit)
      }
      if (webSearch.useProxy !== undefined) {
        await db.setSetting('web_search_use_proxy', webSearch.useProxy === true)
      }
      if (typeof webSearch.proxyUrl === 'string') {
        await db.setSetting('web_search_proxy_url', webSearch.proxyUrl.trim())
      }
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
    return { success: true }
  })

  ipcMain.handle('settings:getWebSearchServiceStatus', async () => {
    log.info('[settings:getWebSearchServiceStatus] requested')
    return getWebSearchServiceStatus()
  })

  ipcMain.handle('settings:installWebSearchService', async () => {
    log.info('[settings:installWebSearchService] requested')
    return installWebSearchService()
  })

  ipcMain.handle('settings:startWebSearchService', async () => {
    log.info('[settings:startWebSearchService] requested')
    const settings = await db.getAllSettings()
    return startWebSearchService({
      useProxy: settings.web_search_use_proxy === true,
      proxyUrl:
        typeof settings.web_search_proxy_url === 'string' &&
        settings.web_search_proxy_url.trim().length > 0
          ? settings.web_search_proxy_url.trim()
          : DEFAULT_WEB_SEARCH_PROXY_URL
    })
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
    const savedId = await db.upsertModelConfig({
      id,
      name,
      provider,
      model,
      apiKey: encryptApiKey(apiKey),
      baseUrl,
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
    async (_event, { provider, apiKey, model, baseUrl, timeoutMs }) => {
      const locale = await readAppLocale(ctx)
      const resolvedTimeoutMs = resolveModelTimeoutMs(timeoutMs, 'verify')
      log.info('[settings:verifyApiKey] received', {
        provider,
        model,
        hasApiKey: typeof apiKey === 'string' && apiKey.trim().length > 0,
        baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
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
        const client = resolveModel(
          provider,
          apiKey.trim(),
          model.trim(),
          typeof baseUrl === 'string' ? baseUrl.trim() : ''
        )
        await client.invoke('Reply with OK.', {
          signal: AbortSignal.timeout(resolvedTimeoutMs)
        })
        log.info('[settings:verifyApiKey] success', { provider, model })
        return { valid: true, message: uiText(locale, '连接验证成功。', 'Connection verified.') }
      } catch (error) {
        const message =
          error instanceof Error && error.message.length > 0
            ? error.message
            : uiText(
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
        title: '选择 OpenPPT 存储目录',
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
