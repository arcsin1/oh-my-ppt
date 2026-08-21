import log from 'electron-log/main.js'
import type {
  ImageGenerationProviderAdapter,
  ImageGenerationResult,
  ResolvedImageModelConfig
} from '../types'
import { collectImageResults, joinUrl, readRecord, readString } from './utils'

const DEFAULT_BASE_URL = 'https://api.openai.com'
const DEFAULT_MODEL = 'gpt-image-1.5'
const LOG_TAG = 'openai-images'

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const buildOpenAIImagesEndpoint = (baseUrl: string): string => {
  const normalized = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '')
  if (/\/images\/generations$/i.test(normalized)) return normalized

  try {
    const url = new URL(normalized)
    const path = url.pathname.replace(/\/+$/, '')
    if (!path) return joinUrl(normalized, '/v1/images/generations')
  } catch {
    // Preserve custom fetch-compatible base paths and append the protocol endpoint.
  }
  return joinUrl(normalized, '/images/generations')
}

const trimResponseText = (text: string): string => text.replace(/\s+/g, ' ').trim().slice(0, 500)

const readImagesJsonResponse = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  const preview = trimResponseText(text)
  if (!response.ok) {
    throw new Error(
      `OpenAI Images API failed (${response.status}, ${contentType || 'unknown content-type'}): ${
        preview || 'empty response'
      }`
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      `OpenAI Images API returned invalid JSON (${response.status}, ${
        contentType || 'unknown content-type'
      }): ${preview || 'empty response'}`
    )
  }
}

const optionalRequestFields = (config: ResolvedImageModelConfig): Record<string, unknown> => {
  const fields: Record<string, unknown> = {}
  for (const key of ['quality', 'output_format', 'background', 'moderation']) {
    const value = readString(config.modelConfig, key)
    if (value) fields[key] = value
  }
  return fields
}

const resolveOutputMetadata = (
  config: ResolvedImageModelConfig
): Pick<ImageGenerationResult, 'mimeType' | 'extension'> | null => {
  const outputFormat = readString(config.modelConfig, 'output_format').toLowerCase()
  if (outputFormat === 'jpeg' || outputFormat === 'jpg') {
    return { mimeType: 'image/jpeg', extension: '.jpg' }
  }
  if (outputFormat === 'webp') return { mimeType: 'image/webp', extension: '.webp' }
  if (outputFormat === 'png') return { mimeType: 'image/png', extension: '.png' }
  return null
}

const applyOutputMetadata = (
  results: ImageGenerationResult[],
  payload: unknown,
  metadata: Pick<ImageGenerationResult, 'mimeType' | 'extension'> | null
): ImageGenerationResult[] => {
  if (!metadata) return results
  const data = readRecord(payload).data
  if (!Array.isArray(data)) return results
  return results.map((result, index) => {
    const item = readRecord(data[index])
    const isBase64Result = Boolean(readString(item, 'b64_json') || readString(item, 'base64'))
    return isBase64Result ? { ...result, ...metadata } : result
  })
}

export const openAiImagesAdapter: ImageGenerationProviderAdapter = {
  async generate(config, input) {
    const startedAt = Date.now()
    const baseUrl = readString(config.modelConfig, 'baseUrl') || DEFAULT_BASE_URL
    const endpoint =
      readString(config.modelConfig, 'endpoint') || buildOpenAIImagesEndpoint(baseUrl)
    const model = readString(config.modelConfig, 'model') || DEFAULT_MODEL
    const apiKey = readString(config.modelConfig, 'apiKey') || readString(config.modelConfig, 'api_key')
    if (!model) throw new Error('OpenAI Images API model is required')
    if (!apiKey) throw new Error('OpenAI Images API key is required')

    const headers = readRecord(config.modelConfig.headers) as Record<string, string>
    const modelKwargs = readRecord(config.modelConfig.modelKwargs)
    const count = Math.max(1, input.count)

    log.info(`[images:${LOG_TAG}] generation start`, {
      configId: config.id,
      configName: config.name,
      model,
      endpoint,
      count,
      promptLength: input.prompt.length,
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
          ...modelKwargs,
          ...optionalRequestFields(config),
          model,
          prompt: input.prompt,
          n: count,
          ...(input.size ? { size: input.size } : {})
        })
      })
      const payload = await readImagesJsonResponse(response)
      const responseRecord = readRecord(payload)
      log.info(`[images:${LOG_TAG}] request completed`, {
        model,
        status: response.status,
        responseKeys: Object.keys(responseRecord).sort(),
        elapsedMs: Date.now() - startedAt
      })
      const results = applyOutputMetadata(
        await collectImageResults(payload, input.signal),
        payload,
        resolveOutputMetadata(config)
      )
      if (results.length === 0) throw new Error('OpenAI Images API returned no images')
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
