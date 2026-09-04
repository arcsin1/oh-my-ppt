import type {
  ImageGenerationProviderAdapter,
  ImageGenerationResult,
  ResolvedImageModelConfig
} from '../types'
import log from 'electron-log/main.js'
import { collectImageResults, joinUrl, readJsonResponse, readRecord, readString } from './utils'
import { resolveConfiguredDefaultImageSize } from './default-size'

const DEFAULT_BASE_URL = 'https://apihub.agnes-ai.com/v1'
const DEFAULT_SIZE = '1024x768'

const AGNES_SIZE_MAP: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1024x768',
  '4:3': '1024x768'
}

const buildEndpoint = (config: ResolvedImageModelConfig): string => {
  const endpoint = readString(config.modelConfig, 'endpoint')
  if (endpoint) return endpoint

  const baseUrl = readString(config.modelConfig, 'baseUrl') || DEFAULT_BASE_URL
  if (/\/images\/generations$/i.test(baseUrl.replace(/\/+$/, ''))) {
    return baseUrl.replace(/\/+$/, '')
  }
  return joinUrl(baseUrl, '/images/generations')
}

const resolveSize = (config: ResolvedImageModelConfig, inputSize: string): string => {
  const explicitSize = readString(config.modelConfig, 'size')
  if (explicitSize) return explicitSize
  return AGNES_SIZE_MAP[inputSize] || inputSize
}

const buildExtraBody = (config: ResolvedImageModelConfig): Record<string, unknown> | undefined => {
  const extraBody = { ...readRecord(config.modelConfig.extraBody) }
  const responseFormat = readString(config.modelConfig, 'responseFormat')
  if (responseFormat && extraBody.response_format === undefined) {
    extraBody.response_format = responseFormat
  }
  return Object.keys(extraBody).length > 0 ? extraBody : undefined
}

export const agnesAiAdapter: ImageGenerationProviderAdapter = {
  getDefaultSize(config) {
    return resolveConfiguredDefaultImageSize(config) || DEFAULT_SIZE
  },

  async generate(config, input) {
    const endpoint = buildEndpoint(config)
    const model = readString(config.modelConfig, 'model')
    const apiKey = readString(config.modelConfig, 'apiKey')
    if (!model) throw new Error('Agnes image model is required')
    if (!apiKey) throw new Error('Agnes API key is required')

    const requestBody = readRecord(config.modelConfig.requestBody)
    const headers = readRecord(config.modelConfig.headers) as Record<string, string>
    const size = resolveSize(config, input.size)
    const requestCount = Math.max(1, input.count)
    const results: ImageGenerationResult[] = []
    const startedAt = Date.now()

    log.info('[images:agnes] sync generation start', {
      model,
      endpoint,
      size,
      requestCount,
      promptLength: input.prompt.length,
      hasSeed: typeof input.seed === 'number'
    })

    for (let i = 0; i < requestCount; i += 1) {
      const requestStartedAt = Date.now()
      const extraBody = buildExtraBody(config)
      const body = {
        model,
        prompt: input.prompt,
        size,
        ...(typeof input.seed === 'number' ? { seed: input.seed } : {}),
        ...(extraBody ? { extra_body: extraBody } : {}),
        ...requestBody
      }
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: input.signal,
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          ...headers
        },
        body: JSON.stringify(body)
      })
      const payload = await readJsonResponse(response)
      const collected = await collectImageResults(payload, input.signal)
      results.push(...collected)
      log.info('[images:agnes] sync generation response', {
        model,
        requestIndex: i + 1,
        collectedCount: collected.length,
        totalCollectedCount: results.length,
        elapsedMs: Date.now() - requestStartedAt
      })
      if (results.length >= input.count) break
    }

    if (results.length === 0) throw new Error('Agnes image generation returned no images')
    log.info('[images:agnes] sync generation completed', {
      model,
      resultCount: results.length,
      elapsedMs: Date.now() - startedAt
    })
    return results.slice(0, input.count)
  }
}
