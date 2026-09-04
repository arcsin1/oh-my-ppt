import log from 'electron-log/main.js'
import type {
  ImageGenerationProviderAdapter,
  ImageGenerationResult,
  ResolvedImageModelConfig
} from '../types'
import { collectImageResults, joinUrl, readJsonResponse, readRecord, readString } from './utils'
import { resolveConfiguredDefaultImageSize } from './default-size'

const DEFAULT_BASE_URL = 'https://api.siliconflow.cn/v1'
const DEFAULT_ENDPOINT_PATH = '/images/generations'
const DEFAULT_MODEL = 'Tongyi-MAI/Z-Image-Turbo'
const LOG_TAG = 'siliconflow'

const QWEN_IMAGE_SIZE_MAP: Record<string, string> = {
  '1:1': '1328x1328',
  '16:9': '1664x928',
  '9:16': '928x1664',
  '4:3': '1472x1140',
  '3:4': '1140x1472',
  '3:2': '1584x1056',
  '2:3': '1056x1584'
}

const KOLORS_SIZE_MAP: Record<string, string> = {
  '1:1': '1024x1024',
  '3:4': '960x1280',
  '9:16': '720x1280',
  '1:2': '720x1440'
}

const DEFAULT_SIZE_MAP: Record<string, string> = {
  '1:1': '1024x1024',
  '16:9': '1280x720',
  '9:16': '720x1280',
  '4:3': '1024x768',
  '3:4': '768x1024'
}

const buildEndpoint = (config: ResolvedImageModelConfig): string => {
  const endpoint = readString(config.modelConfig, 'endpoint')
  if (endpoint) return endpoint
  return joinUrl(readString(config.modelConfig, 'baseUrl') || DEFAULT_BASE_URL, DEFAULT_ENDPOINT_PATH)
}

const parseDimensionSize = (value: string): string => {
  const match = /^\s*(\d{2,5})\s*[x*]\s*(\d{2,5})\s*$/i.exec(value)
  if (!match) return ''
  return `${Number(match[1])}x${Number(match[2])}`
}

const resolveSizeMap = (model: string): Record<string, string> => {
  if (/qwen\/qwen-image/i.test(model)) return QWEN_IMAGE_SIZE_MAP
  if (/kolors/i.test(model)) return KOLORS_SIZE_MAP
  return DEFAULT_SIZE_MAP
}

const resolveImageSize = (config: ResolvedImageModelConfig, model: string, inputSize: string): string => {
  const configuredSize =
    readString(config.modelConfig, 'imageSize') ||
    readString(config.modelConfig, 'image_size') ||
    readString(config.modelConfig, 'size')
  if (configuredSize) return parseDimensionSize(configuredSize) || configuredSize
  return parseDimensionSize(inputSize) || resolveSizeMap(model)[inputSize] || inputSize
}

const readNumber = (config: ResolvedImageModelConfig, key: string): number | undefined => {
  const value = Number(config.modelConfig[key])
  return Number.isFinite(value) ? value : undefined
}

const buildOptionalParameters = (
  config: ResolvedImageModelConfig,
  input: Parameters<ImageGenerationProviderAdapter['generate']>[1],
  model: string
): Record<string, unknown> => {
  const params: Record<string, unknown> = {}
  if (input.negativePrompt) params.negative_prompt = input.negativePrompt
  if (typeof input.seed === 'number') params.seed = input.seed

  const numInferenceSteps = readNumber(config, 'numInferenceSteps') ?? readNumber(config, 'num_inference_steps')
  if (numInferenceSteps !== undefined) params.num_inference_steps = numInferenceSteps

  const guidanceScale = readNumber(config, 'guidanceScale') ?? readNumber(config, 'guidance_scale')
  if (guidanceScale !== undefined) params.guidance_scale = guidanceScale

  const cfg = readNumber(config, 'cfg')
  if (cfg !== undefined) params.cfg = cfg

  if (/kolors/i.test(model)) {
    params.batch_size = 1
  }
  return params
}

const collectSiliconFlowImages = async (
  payload: unknown,
  signal?: AbortSignal
): Promise<ImageGenerationResult[]> => {
  const record = readRecord(payload)
  return collectImageResults({ output: { images: Array.isArray(record.images) ? record.images : [] } }, signal)
}

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const siliconFlowAdapter: ImageGenerationProviderAdapter = {
  getDefaultSize(config) {
    const model = readString(config.modelConfig, 'model') || DEFAULT_MODEL
    return resolveConfiguredDefaultImageSize(config) || resolveSizeMap(model)['16:9'] || '1280x720'
  },

  async generate(config, input) {
    const startedAt = Date.now()
    const endpoint = buildEndpoint(config)
    const model = readString(config.modelConfig, 'model') || DEFAULT_MODEL
    const apiKey = readString(config.modelConfig, 'apiKey')
    if (!apiKey) throw new Error('硅基流动需要 API Key。')

    const imageSize = resolveImageSize(config, model, input.size)
    const requestBody = readRecord(config.modelConfig.requestBody)
    const headers = readRecord(config.modelConfig.headers) as Record<string, string>
    const body = {
      model,
      prompt: input.prompt,
      image_size: imageSize,
      ...buildOptionalParameters(config, input, model),
      ...requestBody
    }

    log.info(`[images:${LOG_TAG}] generation start`, {
      configId: config.id,
      configName: config.name,
      model,
      endpoint,
      imageSize,
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
      const results = await collectSiliconFlowImages(payload, input.signal)
      if (results.length === 0) throw new Error('硅基流动未返回图片')
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
