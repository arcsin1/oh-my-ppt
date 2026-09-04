import { GoogleGenAI } from '@google/genai'
import log from 'electron-log/main.js'
import type {
  ImageGenerationProviderAdapter,
  ImageGenerationResult,
  ResolvedImageModelConfig
} from '../types'
import { readRecord, readString } from './utils'
import { resolveConfiguredDefaultImageSize } from './default-size'

const DEFAULT_MODEL = 'gemini-3.1-flash-image'
const LOG_TAG = 'gemini'

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const mimeToExtension = (mimeType: string): string => {
  if (/jpeg/i.test(mimeType)) return '.jpg'
  if (/webp/i.test(mimeType)) return '.webp'
  return '.png'
}

const readNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = Number(record[key])
  return Number.isFinite(value) ? value : undefined
}

const normalizeAspectRatio = (value: string): string => {
  const trimmed = value.trim()
  if (/^\d+:\d+$/.test(trimmed)) return trimmed
  const match = /^(\d{2,5})\s*[x*]\s*(\d{2,5})$/i.exec(trimmed)
  if (!match) return ''
  const width = Number(match[1])
  const height = Number(match[2])
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

const parseImageSizeSelection = (value: string): { aspectRatio: string; imageSize: string } => {
  const [ratioPart, sizePart] = value
    .split(/[|@]/, 2)
    .map((part) => part.trim())
    .filter(Boolean)
  return {
    aspectRatio: normalizeAspectRatio(ratioPart || value),
    imageSize: /^[124]K$/i.test(sizePart || '') ? (sizePart || '').toUpperCase() : ''
  }
}

const buildGenerationConfig = (
  config: ResolvedImageModelConfig,
  input: Parameters<ImageGenerationProviderAdapter['generate']>[1]
): Record<string, unknown> => {
  const generationConfig = { ...readRecord(config.modelConfig.generationConfig) }
  const imageConfig = { ...readRecord(generationConfig.imageConfig) }
  const selectedSize = parseImageSizeSelection(input.size)

  const aspectRatio =
    readString(config.modelConfig, 'aspectRatio') ||
    readString(config.modelConfig, 'aspect_ratio') ||
    selectedSize.aspectRatio
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio

  if (selectedSize.imageSize) imageConfig.imageSize = selectedSize.imageSize

  const personGeneration =
    readString(config.modelConfig, 'personGeneration') ||
    readString(config.modelConfig, 'person_generation')
  if (personGeneration) imageConfig.personGeneration = personGeneration

  if (Object.keys(imageConfig).length > 0) generationConfig.imageConfig = imageConfig
  generationConfig.responseModalities = ['TEXT', 'IMAGE']

  const systemInstruction =
    readString(config.modelConfig, 'systemInstruction') ||
    readString(config.modelConfig, 'system_instruction')
  if (systemInstruction) generationConfig.systemInstruction = systemInstruction

  const temperature = readNumber(config.modelConfig, 'temperature')
  if (temperature !== undefined) generationConfig.temperature = temperature

  if (typeof input.seed === 'number') generationConfig.seed = input.seed

  return generationConfig
}

const buildHttpOptions = (config: ResolvedImageModelConfig): Record<string, unknown> | undefined => {
  const httpOptions = { ...readRecord(config.modelConfig.httpOptions) }
  const baseUrl = readString(config.modelConfig, 'baseUrl') || readString(config.modelConfig, 'base_url')
  const apiVersion = readString(config.modelConfig, 'apiVersion')
  const timeout = readNumber(config.modelConfig, 'timeout')
  const headers = readRecord(config.modelConfig.headers)

  if (baseUrl) httpOptions.baseUrl = baseUrl
  if (apiVersion) httpOptions.apiVersion = apiVersion
  if (timeout !== undefined) httpOptions.timeout = timeout
  if (Object.keys(headers).length > 0) httpOptions.headers = headers

  return Object.keys(httpOptions).length > 0 ? httpOptions : undefined
}

const collectGeminiImages = (response: unknown): ImageGenerationResult[] => {
  const record = readRecord(response)
  const results: ImageGenerationResult[] = []
  const candidates = Array.isArray(record.candidates) ? record.candidates : []
  for (const candidate of candidates) {
    const content = readRecord(readRecord(candidate).content)
    const parts = Array.isArray(content.parts) ? content.parts : []
    for (const part of parts) {
      const inlineData = readRecord(readRecord(part).inlineData)
      const data = readString(inlineData, 'data')
      if (!data) continue
      const mimeType = readString(inlineData, 'mimeType') || 'image/png'
      results.push({
        bytes: Buffer.from(data, 'base64'),
        mimeType,
        extension: mimeToExtension(mimeType)
      })
    }
  }
  return results
}

export const geminiAdapter: ImageGenerationProviderAdapter = {
  getDefaultSize(config) {
    const configured = resolveConfiguredDefaultImageSize(config)
    if (configured) return configured
    const imageConfig = readRecord(readRecord(config.modelConfig.generationConfig).imageConfig)
    const aspectRatio = readString(config.modelConfig, 'aspectRatio') || readString(imageConfig, 'aspectRatio')
    const imageSize = readString(imageConfig, 'imageSize') || '1K'
    return `${aspectRatio || '16:9'}|${imageSize}`
  },

  async generate(config, input) {
    const startedAt = Date.now()
    const model = readString(config.modelConfig, 'model') || DEFAULT_MODEL
    const apiKey = readString(config.modelConfig, 'apiKey') || readString(config.modelConfig, 'api_key')
    const httpOptions = buildHttpOptions(config)
    if (!apiKey) throw new Error('Gemini 需要 API Key。')

    const generationConfig = buildGenerationConfig(config, input)

    log.info(`[images:${LOG_TAG}] generation start`, {
      configId: config.id,
      configName: config.name,
      model,
      promptLength: input.prompt.length,
      size: input.size,
      baseUrl: readString(config.modelConfig, 'baseUrl') || readString(config.modelConfig, 'base_url') || null,
      generationConfigKeys: Object.keys(generationConfig).sort()
    })

    try {
      const ai = new GoogleGenAI({
        apiKey,
        ...(httpOptions ? { httpOptions } : {})
      })
      const response = await ai.models.generateContent({
        model,
        contents: input.prompt,
        config: {
          ...generationConfig,
          abortSignal: input.signal
        }
      })
      const results = collectGeminiImages(response)
      if (results.length === 0) throw new Error('Gemini 未返回图片')
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
