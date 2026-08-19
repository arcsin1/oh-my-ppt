import {
  DEFAULT_THINKING_PARAMETER_MODE,
  normalizeThinkingParameterMode,
  type ThinkingParameterMode
} from '@shared/model-config'

export interface OpenAIModelOptionsInput {
  model: string
  apiKey: string
  baseUrl: string
  temperatureOptions: { temperature?: number }
  maxTokens: number
  useResponsesApi?: boolean
  thinkingParameterMode?: ThinkingParameterMode
}

export const shouldDisableOpenAICompatibleThinking = (baseUrl: string): boolean => {
  const resolvedBaseUrl = baseUrl.trim()
  if (!resolvedBaseUrl) return false

  try {
    const hostname = new URL(resolvedBaseUrl).hostname.toLowerCase().replace(/\.$/, '')
    return hostname !== 'api.openai.com'
  } catch {
    return true
  }
}

export const normalizeOpenAIBaseUrl = (baseUrl: string, useResponsesApi = false): string => {
  const resolvedBaseUrl = baseUrl.trim().replace(/\/+$/, '')
  if (!useResponsesApi) return resolvedBaseUrl
  return resolvedBaseUrl.replace(/\/responses$/i, '')
}

export const resolveOpenAIThinkingModelKwargs = ({
  baseUrl,
  useResponsesApi = false,
  thinkingParameterMode = DEFAULT_THINKING_PARAMETER_MODE
}: {
  baseUrl: string
  useResponsesApi?: boolean
  thinkingParameterMode?: ThinkingParameterMode
}): Record<string, unknown> => {
  if (useResponsesApi) return {}

  const mode = normalizeThinkingParameterMode(thinkingParameterMode)
  if (mode === 'omit') return {}

  return shouldDisableOpenAICompatibleThinking(baseUrl) ? { thinking: { type: 'disabled' } } : {}
}

export const buildOpenAIModelOptions = ({
  model,
  apiKey,
  baseUrl,
  temperatureOptions,
  maxTokens,
  useResponsesApi = false,
  thinkingParameterMode = DEFAULT_THINKING_PARAMETER_MODE
}: OpenAIModelOptionsInput) => {
  const resolvedBaseUrl = normalizeOpenAIBaseUrl(baseUrl, useResponsesApi)
  const modelKwargs = resolveOpenAIThinkingModelKwargs({
    baseUrl: resolvedBaseUrl,
    useResponsesApi,
    thinkingParameterMode
  })

  return {
    model,
    apiKey,
    ...temperatureOptions,
    maxTokens,
    configuration: resolvedBaseUrl ? { baseURL: resolvedBaseUrl } : undefined,
    modelKwargs
  }
}

export const isOpenAIResponsesProvider = (provider: string): boolean => {
  return provider === 'openai-responses'
}

export const ORCAROUTER_BASE_URL = 'https://api.orcarouter.ai/v1'
export const ORCAROUTER_DEFAULT_MODEL = 'orcarouter/auto'

export const isOrcaRouterProvider = (provider: string): boolean => {
  return provider === 'orcarouter'
}

export const buildOrcaRouterModelOptions = ({
  model,
  apiKey,
  baseUrl,
  temperatureOptions,
  maxTokens,
  thinkingParameterMode = DEFAULT_THINKING_PARAMETER_MODE
}: {
  model: string
  apiKey: string
  baseUrl?: string
  temperatureOptions: { temperature?: number }
  maxTokens: number
  thinkingParameterMode?: ThinkingParameterMode
}): ReturnType<typeof buildOpenAIModelOptions> =>
  buildOpenAIModelOptions({
    model,
    apiKey,
    baseUrl: baseUrl?.trim() || ORCAROUTER_BASE_URL,
    temperatureOptions,
    maxTokens,
    thinkingParameterMode
  })
