import crypto from 'crypto'
import log from 'electron-log/main.js'
import type {
  ImageGenerationProviderAdapter,
  ImageGenerationResult,
  ResolvedImageModelConfig
} from '../types'
import { collectImageResults, readJsonResponse, readRecord, readString } from './utils'
import { resolveConfiguredDefaultImageSize } from './default-size'

// https://www.volcengine.com/docs/85621/1817045?lang=zh
const DEFAULT_ENDPOINT = 'https://visual.volcengineapi.com'
const DEFAULT_REQ_KEY = 'jimeng_t2i_v40'
const DEFAULT_VERSION = '2022-08-31'
const DEFAULT_REGION = 'cn-north-1'
const DEFAULT_SERVICE = 'cv'
const LOG_TAG = 'jimeng-v4'
const LABEL = '即梦 4.0'

const JIMENG_V4_SIZE_MAP: Record<string, { width: number; height: number }> = {
  '1:1': { width: 2048, height: 2048 },
  '16:9': { width: 2560, height: 1440 },
  '9:16': { width: 1440, height: 2560 },
  '4:3': { width: 2304, height: 1728 },
  '3:4': { width: 1728, height: 2304 }
}

const encodeQuery = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  )

const canonicalQuery = (params: Record<string, string>): string =>
  Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeQuery(key)}=${encodeQuery(value)}`)
    .join('&')

const sha256Hex = (value: string): string =>
  crypto.createHash('sha256').update(value, 'utf8').digest('hex')

const hmac = (key: Buffer | string, value: string): Buffer =>
  crypto.createHmac('sha256', key).update(value, 'utf8').digest()

const hmacHex = (key: Buffer | string, value: string): string =>
  crypto.createHmac('sha256', key).update(value, 'utf8').digest('hex')

const utcDate = (): { longDate: string; shortDate: string } => {
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  return {
    longDate: iso,
    shortDate: iso.slice(0, 8)
  }
}

const parseCredentials = (
  config: ResolvedImageModelConfig
): { accessKeyId: string; secretAccessKey: string; sessionToken?: string } => {
  const accessKeyId = readString(config.modelConfig, 'accessKeyId')
  const secretAccessKey = readString(config.modelConfig, 'secretKey')
  const sessionToken = readString(config.modelConfig, 'sessionToken') || undefined
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(`${LABEL} 需要 Access Key ID 和 Secret Key。`)
  }
  return { accessKeyId, secretAccessKey, sessionToken }
}

const signHeaders = ({
  accessKeyId,
  secretAccessKey,
  sessionToken,
  host,
  query,
  body,
  region,
  service
}: {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  host: string
  query: string
  body: string
  region: string
  service: string
}): Record<string, string> => {
  const { longDate, shortDate } = utcDate()
  const payloadHash = sha256Hex(body)
  const signedHeaders = 'content-type;host;x-content-sha256;x-date'
  const canonicalHeaders = [
    'content-type:application/json',
    `host:${host}`,
    `x-content-sha256:${payloadHash}`,
    `x-date:${longDate}`
  ].join('\n')
  const canonicalRequest = [
    'POST',
    '/',
    query,
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash
  ].join('\n')
  const credentialScope = `${shortDate}/${region}/${service}/request`
  const stringToSign = [
    'HMAC-SHA256',
    longDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(secretAccessKey, shortDate), region), service), 'request')
  const signature = hmacHex(signingKey, stringToSign)

  return {
    authorization: `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'content-type': 'application/json',
    'x-content-sha256': payloadHash,
    'x-date': longDate,
    ...(sessionToken ? { 'x-security-token': sessionToken } : {})
  }
}

const resolveEndpoint = (config: ResolvedImageModelConfig): URL => {
  const endpoint =
    readString(config.modelConfig, 'endpoint') || DEFAULT_ENDPOINT
  return new URL(endpoint)
}

const resolveReqKey = (config: ResolvedImageModelConfig): string =>
  readString(config.modelConfig, 'reqKey') || DEFAULT_REQ_KEY

const resolveVersion = (config: ResolvedImageModelConfig): string =>
  readString(config.modelConfig, 'version') || DEFAULT_VERSION

const parseDimensionSize = (value: string): { width: number; height: number } | null => {
  const match = /^\s*(\d{2,5})\s*[x*]\s*(\d{2,5})\s*$/i.exec(value)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width: Math.floor(width), height: Math.floor(height) }
}

const resolveSize = (
  config: ResolvedImageModelConfig,
  inputSize: string
): { width?: number; height?: number; size?: number } => {
  const width = Number(config.modelConfig.width)
  const height = Number(config.modelConfig.height)
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width: Math.floor(width), height: Math.floor(height) }
  }
  const size = Number(config.modelConfig.size)
  if (Number.isFinite(size) && size > 0) {
    return { size: Math.floor(size) }
  }
  const explicitDimension = parseDimensionSize(inputSize)
  if (explicitDimension) return explicitDimension
  return JIMENG_V4_SIZE_MAP[inputSize] || JIMENG_V4_SIZE_MAP['1:1']
}

const resolveForceSingle = (config: ResolvedImageModelConfig, count: number): boolean => {
  const value = config.modelConfig.forceSingle ?? config.modelConfig.force_single
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return count <= 1
}

const postSignedJson = async ({
  config,
  action,
  body,
  signal
}: {
  config: ResolvedImageModelConfig
  action: string
  body: Record<string, unknown>
  signal?: AbortSignal
}): Promise<unknown> => {
  const endpoint = resolveEndpoint(config)
  const version = resolveVersion(config)
  const query = canonicalQuery({
    Action: action,
    Version: version
  })
  endpoint.search = query
  const bodyText = JSON.stringify(body)
  const credentials = parseCredentials(config)
  const headers = signHeaders({
    ...credentials,
    host: endpoint.host,
    query,
    body: bodyText,
    region: readString(config.modelConfig, 'region') || DEFAULT_REGION,
    service: readString(config.modelConfig, 'service') || DEFAULT_SERVICE
  })
  const startedAt = Date.now()
  log.info(`[images:${LOG_TAG}] request start`, {
    action,
    version,
    endpoint: endpoint.origin,
    bodyKeys: Object.keys(body).sort()
  })
  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers,
    body: bodyText
  })
  log.info(`[images:${LOG_TAG}] request end`, {
    action,
    status: response.status,
    ok: response.ok,
    elapsedMs: Date.now() - startedAt
  })
  return readJsonResponse(response)
}

const assertSuccess = (payload: unknown, context: string): Record<string, unknown> => {
  const record = readRecord(payload)
  const code = Number(record.code)
  if (code !== 10000) {
    const message = readString(record, 'message') || readString(record, 'msg') || `${context} failed`
    log.warn(`[images:${LOG_TAG}] api returned non-success`, {
      context,
      code,
      message,
      payloadKeys: Object.keys(record).sort()
    })
    throw new Error(message)
  }
  return record
}

const collectJimengImages = async (
  payload: unknown,
  signal: AbortSignal | undefined
): Promise<ImageGenerationResult[]> => {
  const data = readRecord(readRecord(payload).data)
  const normalized: Array<Record<string, string>> = []
  const imageUrls = Array.isArray(data.image_urls) ? data.image_urls : []
  for (const url of imageUrls) {
    if (typeof url === 'string' && url.trim()) normalized.push({ url: url.trim() })
  }
  const binaryData = Array.isArray(data.binary_data_base64)
    ? data.binary_data_base64
    : typeof data.binary_data_base64 === 'string'
      ? [data.binary_data_base64]
      : []
  log.info(`[images:${LOG_TAG}] collect image payload`, {
    imageUrlCount: imageUrls.filter((url) => typeof url === 'string' && url.trim()).length,
    binaryDataCount: binaryData.filter((base64) => typeof base64 === 'string' && base64.trim())
      .length
  })
  for (const base64 of binaryData) {
    if (typeof base64 === 'string' && base64.trim()) normalized.push({ base64: base64.trim() })
  }
  return collectImageResults({ data: normalized }, signal)
}

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const jimengV4Adapter: ImageGenerationProviderAdapter = {
  getDefaultSize(config) {
    return resolveConfiguredDefaultImageSize(config) || '2560x1440'
  },

  async generate(config, input) {
    const startedAt = Date.now()
    const reqKey = resolveReqKey(config)
    const requestBody = readRecord(config.modelConfig.requestBody)
    const resultJson = readRecord(config.modelConfig.resultJson)
    const { width, height, size } = resolveSize(config, input.size)
    const forceSingle = resolveForceSingle(config, input.count)
    const results: ImageGenerationResult[] = []
    const maxPolls = Number(config.modelConfig.maxPolls || 60)
    const intervalMs = Number(config.modelConfig.pollIntervalMs || 2000)
    log.info(`[images:${LOG_TAG}] generation start`, {
      configId: config.id,
      configName: config.name,
      reqKey,
      inputSize: input.size,
      width,
      height,
      size,
      forceSingle,
      count: input.count,
      promptLength: input.prompt.length,
      hasSeed: typeof input.seed === 'number',
      maxPolls,
      intervalMs,
      requestBodyKeys: Object.keys(requestBody).sort(),
      resultJsonKeys: Object.keys(resultJson).sort()
    })

    try {
      for (let index = 0; index < input.count; index += 1) {
        const imageStartedAt = Date.now()
        log.info(`[images:${LOG_TAG}] submit task`, {
          imageIndex: index + 1,
          total: input.count,
          reqKey,
          width,
          height,
          size,
          forceSingle
        })
        const submitPayload = assertSuccess(
          await postSignedJson({
            config,
            action: 'CVSync2AsyncSubmitTask',
            signal: input.signal,
            body: {
              req_key: reqKey,
              prompt: input.prompt,
              seed: typeof input.seed === 'number' ? input.seed : -1,
              ...(width && height ? { width, height } : {}),
              ...(size ? { size } : {}),
              force_single: forceSingle,
              ...requestBody
            }
          }),
          `${LABEL} task submit`
        )
        const taskId = readString(readRecord(submitPayload.data), 'task_id')
        if (!taskId) throw new Error(`${LABEL} 未返回 task_id`)
        log.info(`[images:${LOG_TAG}] task submitted`, {
          imageIndex: index + 1,
          taskId,
          elapsedMs: Date.now() - imageStartedAt
        })

        let lastStatus = ''
        for (let poll = 0; poll < maxPolls; poll += 1) {
          if (input.signal?.aborted) throw new Error('Image generation cancelled')
          await new Promise((resolve) => setTimeout(resolve, intervalMs))
          const queryPayload = assertSuccess(
            await postSignedJson({
              config,
              action: 'CVSync2AsyncGetResult',
              signal: input.signal,
              body: {
                req_key: reqKey,
                task_id: taskId,
                req_json: JSON.stringify({
                  return_url: true,
                  ...resultJson
                })
              }
            }),
            `${LABEL} task query`
          )
          const data = readRecord(queryPayload.data)
          const status = readString(data, 'status')
          if (status !== lastStatus || poll === 0 || (poll + 1) % 5 === 0) {
            log.info(`[images:${LOG_TAG}] poll task`, {
              imageIndex: index + 1,
              taskId,
              poll: poll + 1,
              maxPolls,
              status: status || 'unknown',
              elapsedMs: Date.now() - imageStartedAt
            })
          }
          lastStatus = status
          if (status === 'done') {
            const images = await collectJimengImages(queryPayload, input.signal)
            if (images.length === 0) throw new Error(`${LABEL} 未返回图片`)
            results.push(...images)
            log.info(`[images:${LOG_TAG}] task completed`, {
              imageIndex: index + 1,
              taskId,
              imageCount: images.length,
              elapsedMs: Date.now() - imageStartedAt
            })
            break
          }
          if (status === 'not_found' || status === 'expired') {
            throw new Error(`${LABEL} 任务状态异常：${status}`)
          }
        }

        if (results.length <= index) {
          log.warn(`[images:${LOG_TAG}] task timed out`, {
            imageIndex: index + 1,
            taskId,
            maxPolls,
            elapsedMs: Date.now() - imageStartedAt
          })
          throw new Error(`${LABEL} 生图超时`)
        }
        if (results.length >= input.count) break
      }

      log.info(`[images:${LOG_TAG}] generation completed`, {
        requestedCount: input.count,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt
      })
      return results.slice(0, input.count)
    } catch (error) {
      log.error(`[images:${LOG_TAG}] generation failed`, {
        message: toErrorMessage(error),
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt
      })
      throw error
    }
  }
}
