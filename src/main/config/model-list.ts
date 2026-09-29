import { normalizeOpenAIBaseUrl } from '../agent-runtime/model/options'

export interface ModelListRequestSpec {
  url: string
  headers: Record<string, string>
}

const trimBaseUrl = (baseUrl: unknown): string => {
  if (typeof baseUrl !== 'string') return ''
  return baseUrl.trim().replace(/\/+$/, '')
}

/** 按供应商约定拼出拉取模型列表的请求（openai/openai-responses/anthropic/google）。 */
export const buildModelListRequest = (
  provider: string,
  baseUrl: string,
  apiKey: string
): ModelListRequestSpec => {
  const key = apiKey.trim()
  const base = trimBaseUrl(baseUrl)
  if (provider === 'google') {
    const origin = base || 'https://generativelanguage.googleapis.com'
    return {
      url: `${origin}/v1beta/models?pageSize=1000`,
      headers: { 'x-goog-api-key': key }
    }
  }
  if (provider === 'anthropic') {
    const origin = base || 'https://api.anthropic.com'
    return {
      url: `${origin}/v1/models?limit=1000`,
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    }
  }
  const origin =
    normalizeOpenAIBaseUrl(base, provider === 'openai-responses') || 'https://api.openai.com/v1'
  return {
    url: `${origin}/models`,
    headers: { Authorization: `Bearer ${key}` }
  }
}

/** 从 /models 响应中提取模型 ID 列表（去重排序），不合法结构直接抛错。 */
export const parseModelListResponse = (provider: string, json: unknown): string[] => {
  const source =
    provider === 'google'
      ? (json as { models?: unknown } | null)?.models
      : (json as { data?: unknown } | null)?.data
  if (!Array.isArray(source)) {
    throw new Error('unexpected model list response shape')
  }
  const models = new Set<string>()
  for (const item of source) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    if (provider === 'google') {
      const name = typeof record.name === 'string' ? record.name.trim() : ''
      if (name) models.add(name.replace(/^models\//, ''))
      continue
    }
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const model = id || (name ? name.replace(/^models\//, '') : '')
    if (model) models.add(model)
  }
  return [...models].sort((a, b) => a.localeCompare(b))
}
