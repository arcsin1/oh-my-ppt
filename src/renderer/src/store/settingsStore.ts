import { create } from 'zustand'
import { ipc, type ModelConfig, type WebSearchServiceStatus } from '@renderer/lib/ipc'
import type { ConfigurableModelTimeoutProfile } from '@shared/model-timeout.js'

interface WebSearchSettings {
  engines: string[]
  limit: number
  useProxy?: boolean
  proxyUrl?: string
  serviceStatus?: WebSearchServiceStatus
}

interface Settings {
  theme: string
  locale: 'zh' | 'en'
  storagePath: string
  timeouts: Record<ConfigurableModelTimeoutProfile, number>
  webSearch?: WebSearchSettings
}

interface SettingsStore {
  settings: Settings | null
  modelConfigs: ModelConfig[]
  verificationMessage: string | null
  storagePathError: string | null
  webSearchError: string | null
  loading: boolean
  webSearchBusy: boolean

  fetchSettings: () => Promise<void>
  saveSettings: (settings: Partial<Settings>) => Promise<void>
  upsertModelConfig: (config: {
    id?: string
    name: string
    provider: 'anthropic' | 'openai'
    model: string
    apiKey: string
    baseUrl: string
    active?: boolean
  }) => Promise<string | null>
  setActiveModelConfig: (id: string) => Promise<void>
  deleteModelConfig: (id: string) => Promise<void>
  setVerificationMessage: (message: string | null) => void
  verifyApiKey: (
    provider: string,
    apiKey: string,
    model: string,
    baseUrl: string,
    timeoutMs: number
  ) => Promise<boolean>
  chooseStoragePath: () => Promise<string | null>
  refreshWebSearchServiceStatus: () => Promise<void>
  installWebSearchService: () => Promise<boolean>
  startWebSearchService: () => Promise<boolean>
}

const readStoredLocale = (): 'zh' | 'en' => {
  if (typeof window === 'undefined') return 'zh'
  return window.localStorage.getItem('oh-my-ppt:lang') === 'en' ? 'en' : 'zh'
}

const fallbackMessage = (zh: string, en: string): string => (readStoredLocale() === 'en' ? en : zh)

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  settings: null,
  modelConfigs: [],
  verificationMessage: null,
  storagePathError: null,
  webSearchError: null,
  loading: false,
  webSearchBusy: false,

  fetchSettings: async () => {
    try {
      const [settings, modelConfigs] = await Promise.all([
        ipc.getSettings(),
        ipc.listModelConfigs()
      ])
      const typedSettings = settings as unknown as Settings
      const locale = typedSettings.locale === 'en' ? 'en' : 'zh'
      set({
        settings: {
          ...typedSettings,
          locale
        },
        modelConfigs: Array.isArray(modelConfigs) ? modelConfigs : [],
        storagePathError: null,
        verificationMessage: null,
        webSearchError: null
      })
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('读取设置失败。', 'Failed to read settings.')
      set({ verificationMessage: message })
    }
  },

  saveSettings: async (newSettings) => {
    set({ verificationMessage: null })
    const settingsToSave: Partial<Settings> = { ...newSettings }

    try {
      await ipc.saveSettings(settingsToSave)
      await get().fetchSettings()
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('保存设置失败。', 'Failed to save settings.')
      set({ verificationMessage: message })
    }
  },

  upsertModelConfig: async (config) => {
    set({ verificationMessage: null })
    try {
      const result = await ipc.upsertModelConfig(config)
      await get().fetchSettings()
      return result.id
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('保存模型失败。', 'Failed to save model.')
      set({ verificationMessage: message })
      return null
    }
  },

  setActiveModelConfig: async (id) => {
    set({ verificationMessage: null })
    try {
      await ipc.setActiveModelConfig(id)
      await get().fetchSettings()
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('启用模型失败。', 'Failed to activate model.')
      set({ verificationMessage: message })
    }
  },

  deleteModelConfig: async (id) => {
    set({ verificationMessage: null })
    try {
      await ipc.deleteModelConfig(id)
      await get().fetchSettings()
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('删除模型失败。', 'Failed to delete model.')
      set({ verificationMessage: message })
    }
  },

  setVerificationMessage: (message) => set({ verificationMessage: message }),

  verifyApiKey: async (provider, apiKey, model, baseUrl, timeoutMs) => {
    try {
      const { valid, message } = await ipc.verifyApiKey({
        provider,
        apiKey,
        model,
        baseUrl,
        timeoutMs
      })
      set({ verificationMessage: message || null })
      return valid
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('发送验证请求失败。', 'Failed to send verification request.')
      set({ verificationMessage: message })
      return false
    }
  },

  chooseStoragePath: async () => {
    set({ storagePathError: null })
    try {
      const { path, error } = await ipc.chooseStoragePath()
      set({ storagePathError: error || null })
      return path
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('选择文件夹失败。', 'Failed to choose folder.')
      set({ storagePathError: message })
      return null
    }
  },

  refreshWebSearchServiceStatus: async () => {
    const settings = get().settings
    if (!settings) return
    try {
      const serviceStatus = await ipc.getWebSearchServiceStatus()
      set({
        settings: {
          ...settings,
          webSearch: {
            engines: settings.webSearch?.engines || ['bing', 'duckduckgo'],
            limit: settings.webSearch?.limit || 20,
            useProxy: settings.webSearch?.useProxy,
            proxyUrl: settings.webSearch?.proxyUrl,
            serviceStatus
          }
        },
        webSearchError: null
      })
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('读取联网搜索服务状态失败。', 'Failed to load web search service status.')
      set({ webSearchError: message })
    }
  },

  installWebSearchService: async () => {
    set({ webSearchBusy: true, webSearchError: null })
    try {
      const serviceStatus = await ipc.installWebSearchService()
      const settings = get().settings
      if (settings) {
        set({
          settings: {
            ...settings,
            webSearch: {
              engines: settings.webSearch?.engines || ['bing', 'duckduckgo'],
              limit: settings.webSearch?.limit || 20,
              useProxy: settings.webSearch?.useProxy,
              proxyUrl: settings.webSearch?.proxyUrl,
              serviceStatus
            }
          },
          webSearchBusy: false
        })
      } else {
        set({ webSearchBusy: false })
      }
      return serviceStatus.installed
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('安装联网搜索服务失败。', 'Failed to install web search service.')
      set({ webSearchBusy: false, webSearchError: message })
      return false
    }
  },

  startWebSearchService: async () => {
    set({ webSearchBusy: true, webSearchError: null })
    try {
      const serviceStatus = await ipc.startWebSearchService()
      const settings = get().settings
      if (settings) {
        set({
          settings: {
            ...settings,
            webSearch: {
              engines: settings.webSearch?.engines || ['bing', 'duckduckgo'],
              limit: settings.webSearch?.limit || 20,
              useProxy: settings.webSearch?.useProxy,
              proxyUrl: settings.webSearch?.proxyUrl,
              serviceStatus
            }
          },
          webSearchBusy: false
        })
      } else {
        set({ webSearchBusy: false })
      }
      return serviceStatus.running
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : fallbackMessage('启动联网搜索服务失败。', 'Failed to start web search service.')
      set({ webSearchBusy: false, webSearchError: message })
      return false
    }
  }
}))
