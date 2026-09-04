import log from 'electron-log/main.js'
import type {
  ImageGenerationProviderAdapter,
  ImageGenerationResult,
  ResolvedImageModelConfig
} from '../types'
import { collectImageResults, joinUrl, readJsonResponse, readRecord, readString } from './utils'
import { resolveConfiguredDefaultImageSize } from './default-size'

const DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com'
const DEFAULT_ENDPOINT_PATH = '/api/v3/images/generations'
const DEFAULT_MODEL = 'doubao-seedream-5-0-260128'
const LOG_TAG = 'seedream'
const LABEL = 'Seedream'
const DEFAULT_SIZE = '2K'

// M3b and the manual image panel use semantic aspect ratios. Seedream accepts a
// pixel dimension or a quality tier, so map the former to balanced defaults.
const DEFAULT_SIZE_BY_ASPECT: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1536x864',
  '4:3': '1280x960',
  '9:16': '864x1536',
  '3:4': '960x1280'
}

const buildEndpoint = (config: ResolvedImageModelConfig): string => {
  const endpoint = readString(config.modelConfig, 'endpoint')
  if (endpoint) return endpoint
  const baseUrl = readString(config.modelConfig, 'baseUrl')
  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl)
      if (parsed.pathname && parsed.pathname !== '/') return baseUrl
    } catch {
      return baseUrl
    }
  }
  return joinUrl(baseUrl || DEFAULT_BASE_URL, DEFAULT_ENDPOINT_PATH)
}

const resolveSize = (config: ResolvedImageModelConfig, inputSize: string): string => {
  const configuredSize = readString(config.modelConfig, 'size') || readString(config.modelConfig, 'imageSize')
  const size = configuredSize || inputSize
  if (!size) throw new Error(`${LABEL} 需要 size，请在模型配置里填写 sizes 并选择一个值。`)
  return DEFAULT_SIZE_BY_ASPECT[size.trim().toLowerCase()] || size
}

const readNumber = (config: ResolvedImageModelConfig, key: string): number | undefined => {
  const value = Number(config.modelConfig[key])
  return Number.isFinite(value) ? value : undefined
}

const readBoolean = (config: ResolvedImageModelConfig, key: string): boolean | undefined => {
  const value = config.modelConfig[key]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return undefined
}

const readBooleanWithDefault = (
  config: ResolvedImageModelConfig,
  key: string,
  fallback: boolean
): boolean => readBoolean(config, key) ?? fallback

const resolveResponseFormat = (config: ResolvedImageModelConfig): 'url' | 'b64_json' => {
  const value =
    readString(config.modelConfig, 'response_format') ||
    readString(config.modelConfig, 'responseFormat')
  return value === 'b64_json' ? 'b64_json' : 'url'
}

const buildOptionalParameters = (
  config: ResolvedImageModelConfig,
  input: Parameters<ImageGenerationProviderAdapter['generate']>[1]
): Record<string, unknown> => {
  const params: Record<string, unknown> = {
    sequential_image_generation:
      readString(config.modelConfig, 'sequential_image_generation') ||
      readString(config.modelConfig, 'sequentialImageGeneration') ||
      'disabled',
    stream: readBooleanWithDefault(config, 'stream', false)
  }
  if (typeof input.seed === 'number') params.seed = input.seed
  if (input.negativePrompt) params.negative_prompt = input.negativePrompt

  const guidanceScale = readNumber(config, 'guidanceScale') ?? readNumber(config, 'guidance_scale')
  if (guidanceScale !== undefined) params.guidance_scale = guidanceScale

  const watermark = readBoolean(config, 'watermark')
  if (watermark !== undefined) params.watermark = watermark

  return params
}

const collectSeedreamImages = async (
  payload: unknown,
  signal?: AbortSignal
): Promise<ImageGenerationResult[]> => collectImageResults(payload, signal)

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const seedreamAdapter: ImageGenerationProviderAdapter = {
  getDefaultSize(config) {
    return resolveConfiguredDefaultImageSize(config) || DEFAULT_SIZE
  },

  async generate(config, input) {
    const startedAt = Date.now()
    const endpoint = buildEndpoint(config)
    const model = readString(config.modelConfig, 'model') || DEFAULT_MODEL
    const apiKey = readString(config.modelConfig, 'apiKey')
    if (!apiKey) throw new Error(`${LABEL} 需要 API Key。`)

    const size = resolveSize(config, input.size)
    const responseFormat = resolveResponseFormat(config)
    const requestBody = readRecord(config.modelConfig.requestBody)
    const headers = readRecord(config.modelConfig.headers) as Record<string, string>
    const body = {
      model,
      prompt: input.prompt,
      size,
      n: input.count,
      response_format: responseFormat,
      ...buildOptionalParameters(config, input),
      ...requestBody
    }

    log.info(`[images:${LOG_TAG}] generation start`, {
      configId: config.id,
      configName: config.name,
      model,
      endpoint,
      size,
      count: input.count,
      responseFormat,
      promptLength: input.prompt.length,
      hasSeed: typeof input.seed === 'number',
      requestBodyKeys: Object.keys(requestBody).sort()
    })

    try {
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
      log.info(`[images:${LOG_TAG}] request end`, {
        model,
        status: response.status,
        ok: response.ok,
        elapsedMs: Date.now() - startedAt
      })
      const payload = await readJsonResponse(response)
      const results = await collectSeedreamImages(payload, input.signal)
      if (results.length === 0) throw new Error(`${LABEL} 未返回图片`)
      log.info(`[images:${LOG_TAG}] generation completed`, {
        model,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt
      })
      return results.slice(0, input.count)
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
