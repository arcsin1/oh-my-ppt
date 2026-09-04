import type { ImageModelConfig, ImageModelProvider, ModelConfig } from '../../lib/ipc'
import type { ImageModelForm, ModelForm } from './types'
import { DEFAULT_THINKING_PARAMETER_MODE } from '@shared/model-config.js'

export const IMAGE_PROVIDER_OPTIONS: Array<{ value: ImageModelProvider; label: string }> = [
  { value: 'agnes', label: 'Agnes AI' },
  { value: 'jimeng', label: '即梦3.0' },
  { value: 'jimeng4', label: '即梦4.0' },
  { value: 'seedream', label: 'Seedream' },
  { value: 'siliconflow', label: '硅基流动' },
  { value: 'openaiCompatible', label: 'OpenAI 兼容' },
  { value: 'gemini', label: 'Gemini' }
]

const JIMENG_DEFAULT_REQ_KEY = 'jimeng_t2i_v30'
const JIMENG_V4_DEFAULT_REQ_KEY = 'jimeng_t2i_v40'

export const readJsonObject = (value: string): Record<string, unknown> | null => {
  const text = value.trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export const stringifyJsonObject = (record: Record<string, unknown>): string => {
  return JSON.stringify(record, null, 2)
}

export const createImageModelVerificationSignature = (
  provider: ImageModelProvider,
  modelConfig: string
): string => JSON.stringify({ provider, modelConfig })

export const isImageModelVerificationCurrent = (
  verifiedSignature: string | null,
  provider: ImageModelProvider,
  modelConfig: string | null
): boolean => {
  if (!modelConfig) return false
  return verifiedSignature === createImageModelVerificationSignature(provider, modelConfig)
}

export const summarizeImageModelConfig = (value: string): string => {
  const config = readJsonObject(value)
  if (!config) return 'model_config'
  const model = typeof config.model === 'string' ? config.model.trim() : ''
  const reqKey = typeof config.reqKey === 'string' ? config.reqKey.trim() : ''
  const endpoint =
    typeof config.endpoint === 'string'
      ? config.endpoint.trim()
      : typeof config.baseUrl === 'string'
        ? config.baseUrl.trim()
        : ''
  return [model || reqKey || 'model_config', endpoint].filter(Boolean).join(' · ')
}

export const createDefaultImageModelConfig = (provider: ImageModelProvider): string => {
  if (provider === 'jimeng') {
    return stringifyJsonObject({
      reqKey: JIMENG_DEFAULT_REQ_KEY,
      accessKeyId: '',
      secretKey: ''
    })
  }
  if (provider === 'jimeng4') {
    return stringifyJsonObject({
      reqKey: JIMENG_V4_DEFAULT_REQ_KEY,
      accessKeyId: '',
      secretKey: '',
      force_single: true
    })
  }
  if (provider === 'siliconflow') {
    return stringifyJsonObject({
      model: 'Tongyi-MAI/Z-Image-Turbo',
      apiKey: ''
    })
  }
  if (provider === 'openaiCompatible') {
    return stringifyJsonObject({
      baseUrl: 'https://api.openai.com',
      apiKey: '',
      model: 'gpt-image-1'
    })
  }
  if (provider === 'gemini') {
    return stringifyJsonObject({
      model: 'gemini-3.1-flash-image',
      apiKey: ''
    })
  }
  if (provider === 'seedream') {
    return stringifyJsonObject({
      baseUrl: 'https://ark.cn-beijing.volces.com',
      model: 'doubao-seedream-5-0-260128',
      apiKey: '',
      response_format: 'url',
      sizes: ['2K'],
      sequential_image_generation: 'disabled',
      stream: false
    })
  }
  return stringifyJsonObject({
    model: 'agnes-image-2.0-flash',
    apiKey: '',
    responseFormat: 'url'
  })
}

export const createEmptyModelForm = (active = false): ModelForm => ({
  name: '',
  provider: 'openai',
  model: '',
  apiKey: '',
  baseUrl: '',
  maxTokens: '4096',
  disableTemperature: false,
  thinkingParameterMode: DEFAULT_THINKING_PARAMETER_MODE,
  active
})

export const createModelForm = (config: ModelConfig): ModelForm => ({
  id: config.id,
  name: config.name,
  provider: config.provider,
  model: config.model,
  apiKey: config.apiKey,
  baseUrl: config.baseUrl,
  maxTokens: String(config.maxTokens || 4096),
  disableTemperature: config.disableTemperature,
  thinkingParameterMode: config.thinkingParameterMode || DEFAULT_THINKING_PARAMETER_MODE,
  active: config.active
})

export const createEmptyImageModelForm = (active = false): ImageModelForm => ({
  name: '',
  provider: 'agnes',
  modelConfig: createDefaultImageModelConfig('agnes'),
  active
})

export const createImageModelForm = (config: ImageModelConfig): ImageModelForm => {
  return {
    id: config.id,
    name: config.name,
    provider: config.provider,
    modelConfig: config.modelConfig || createDefaultImageModelConfig(config.provider),
    active: config.active
  }
}
