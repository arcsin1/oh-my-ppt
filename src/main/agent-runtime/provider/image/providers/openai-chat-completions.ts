import log from 'electron-log/main.js'
import type {
  ImageGenerationProviderAdapter,
  ImageGenerationResult,
  ResolvedImageModelConfig
} from '../types'
import { collectImageResults, joinUrl, readRecord, readString } from './utils'
import { resolveConfiguredDefaultImageSize } from './default-size'

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_MODEL = 'gpt-image-1'
const LOG_TAG = 'openai-chat-completions'

type ChatMessage = {
  role: 'system' | 'user'
  content: string
}

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const resolveBaseUrl = (config: ResolvedImageModelConfig): string =>
  (readString(config.modelConfig, 'baseUrl') || DEFAULT_BASE_URL).replace(/\/+$/, '')

const buildEndpoint = (config: ResolvedImageModelConfig): string => {
  const baseUrl = readString(config.modelConfig, 'baseUrl') || DEFAULT_BASE_URL
  const normalized = baseUrl.replace(/\/+$/, '')
  if (/\/chat\/completions$/i.test(normalized)) return normalized
  try {
    const url = new URL(normalized)
    const path = url.pathname.replace(/\/+$/, '')
    if (!path) return joinUrl(normalized, '/v1/chat/completions')
  } catch {
    // Keep the fallback path below for non-standard but still fetchable base URLs.
  }
  return joinUrl(normalized, '/chat/completions')
}

const trimResponseText = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 500)

const readChatJsonResponse = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  const preview = trimResponseText(text)
  if (!response.ok) {
    throw new Error(
      `OpenAI Chat Completions failed (${response.status}, ${contentType || 'unknown content-type'}): ${
        preview || 'empty response'
      }`
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      `OpenAI Chat Completions returned invalid JSON (${response.status}, ${
        contentType || 'unknown content-type'
      }): ${preview || 'empty response'}`
    )
  }
}

const collectMarkdownImageUrls = (content: string): string[] => {
  const urls: string[] = []
  for (const match of content.matchAll(/!\[[^\]]*]\(([^)]+)\)/g)) {
    const url = match[1]?.trim()
    if (url) urls.push(url)
  }
  for (const match of content.matchAll(/data:image\/[^;,]+;base64,[A-Za-z0-9+/=]+/g)) {
    urls.push(match[0])
  }
  const trimmed = content.trim()
  if (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) {
    urls.push(trimmed)
  }
  return urls
}

const pushCandidateFromImageUrl = (value: unknown, candidates: unknown[]): boolean => {
  if (typeof value === 'string' && value.trim()) {
    candidates.push(value.trim())
    return true
  }
  const record = readRecord(value)
  const url = readString(record, 'url')
  if (url) {
    candidates.push(url)
    return true
  }
  return false
}

const collectImageCandidates = (value: unknown, candidates: unknown[], depth = 0): void => {
  if (depth > 8 || value == null) return

  if (typeof value === 'string') {
    candidates.push(...collectMarkdownImageUrls(value))
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) collectImageCandidates(item, candidates, depth + 1)
    return
  }

  const record = readRecord(value)
  if (Object.keys(record).length === 0) return

  if (pushCandidateFromImageUrl(record.image_url, candidates)) return

  const url = readString(record, 'url')
  const b64Json = readString(record, 'b64_json')
  const base64 = readString(record, 'base64')
  const data = readString(record, 'data')
  if (url) candidates.push(url)
  if (b64Json) candidates.push(b64Json)
  if (base64) candidates.push(base64)
  if (/^data:image\//i.test(data)) candidates.push(data)

  for (const key of [
    'content',
    'additional_kwargs',
    'response_metadata',
    'tool_calls',
    'choices',
    'message',
    'output',
    'images',
    'results'
  ]) {
    if (key in record) collectImageCandidates(record[key], candidates, depth + 1)
  }
}

const collectMessageImageResults = async (
  payload: unknown,
  signal?: AbortSignal
): Promise<ImageGenerationResult[]> => {
  const candidates: unknown[] = []
  collectImageCandidates(payload, candidates)
  return collectImageResults({ data: candidates }, signal)
}

const buildMessages = (config: ResolvedImageModelConfig, prompt: string): ChatMessage[] => {
  const systemPrompt = readString(config.modelConfig, 'systemPrompt')
  return [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    { role: 'user', content: prompt }
  ]
}

export const openAiChatCompletionsAdapter: ImageGenerationProviderAdapter = {
  getDefaultSize(config) {
    return resolveConfiguredDefaultImageSize(config) || 'auto'
  },

  async generate(config, input) {
    const startedAt = Date.now()
    const baseUrl = resolveBaseUrl(config)
    const endpoint = buildEndpoint(config)
    const model = readString(config.modelConfig, 'model') || DEFAULT_MODEL
    const apiKey = readString(config.modelConfig, 'apiKey') || readString(config.modelConfig, 'api_key')
    if (!model) throw new Error('OpenAI-compatible Chat Completions image model is required')
    if (!apiKey) throw new Error('OpenAI-compatible API key is required')

    const headers = readRecord(config.modelConfig.headers) as Record<string, string>
    const modelKwargs = readRecord(config.modelConfig.modelKwargs)
    const systemPrompt = readString(config.modelConfig, 'systemPrompt')
    const messages = buildMessages(config, input.prompt)
    const count = Math.max(1, input.count)

    log.info(`[images:${LOG_TAG}] generation start`, {
      configId: config.id,
      configName: config.name,
      model,
      baseUrl,
      endpoint,
      count,
      promptLength: input.prompt.length,
      hasSystemPrompt: Boolean(systemPrompt),
      modelKwargsKeys: Object.keys(modelKwargs).sort()
    })

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: input.signal,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          ...headers
        },
        body: JSON.stringify({
          model,
          messages,
          n: count,
          stream: false,
          ...modelKwargs
        })
      })
      const payload = await readChatJsonResponse(response)
      const responseRecord = readRecord(payload)
      log.info(`[images:${LOG_TAG}] request completed`, {
        model,
        status: response.status,
        choiceCount: Array.isArray(responseRecord.choices) ? responseRecord.choices.length : 0,
        responseKeys: Object.keys(responseRecord).sort(),
        elapsedMs: Date.now() - startedAt
      })
      const results = await collectMessageImageResults(payload, input.signal)
      if (results.length === 0) {
        throw new Error('OpenAI-compatible Chat Completions returned no images')
      }
      log.info(`[images:${LOG_TAG}] generation completed`, {
        model,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt
      })
      return results.slice(0, count)
    } catch (error) {
      log.error(`[images:${LOG_TAG}] generation failed`, {
        model,
        message: toErrorMessage(error),
        elapsedMs: Date.now() - startedAt
      })
      throw error
    }
  }
}
