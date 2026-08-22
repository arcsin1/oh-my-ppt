import type { ConfigurableModelTimeoutProfile } from '@shared/model-timeout.js'
import type { ThinkingParameterMode } from '@shared/model-config.js'
import type { I18nKey, TranslationParams } from '../../i18n'
import type { ImageModelProvider } from '../../lib/ipc'

export type ProviderId = 'anthropic' | 'openai' | 'openai-responses' | 'orcarouter' | 'google'

export type SettingsTranslate = (key: I18nKey, params?: TranslationParams) => string

export interface ModelForm {
  id?: string
  name: string
  provider: ProviderId
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: string
  disableTemperature: boolean
  thinkingParameterMode: ThinkingParameterMode
  active: boolean
}

export interface ImageModelForm {
  id?: string
  name: string
  provider: ImageModelProvider
  modelConfig: string
  active: boolean
}

export interface TimeoutField {
  profile: ConfigurableModelTimeoutProfile
  label: string
  hint: string
  min: number
}
