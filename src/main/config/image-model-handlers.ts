import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import type { ImageModelProvider, ImageModelVerificationResult } from '@shared/image-generation'
import {
  resolveImageGenerationProvider,
  type ResolvedImageModelConfig
} from '../agent-runtime/provider/image'
import type { IpcContext } from '../ipc/context'
import { readAppLocale, uiText } from './locale-utils'

const IMAGE_MODEL_VERIFY_PROMPT = '生成一只卡通猫'
const IMAGE_MODEL_VERIFY_TIMEOUT_MS = 120_000

const VALID_IMAGE_PROVIDERS = [
  'jimeng',
  'jimeng4',
  'agnes',
  'siliconflow',
  'openaiCompatible',
  'gemini',
  'seedream'
] as const

const resolveProvider = (provider: unknown): ImageModelProvider => {
  if (VALID_IMAGE_PROVIDERS.includes(provider as ImageModelProvider)) {
    return provider as ImageModelProvider
  }
  throw new Error('Unsupported image provider')
}

const normalizeModelConfig = (value: unknown): string => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return '{}'
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '{}'
    return text
  } catch {
    return '{}'
  }
}

const toPreviewDataUrl = (bytes: Buffer, mimeType: string): string => {
  const safeMimeType = /^image\/[a-z0-9.+-]+$/i.test(mimeType) ? mimeType : 'image/png'
  return `data:${safeMimeType};base64,${bytes.toString('base64')}`
}

const createVerificationConfig = (
  provider: ImageModelProvider,
  modelConfig: string
): ResolvedImageModelConfig => ({
  id: 'image-model-verification',
  name: 'Image model verification',
  provider,
  active: false,
  modelConfig: JSON.parse(modelConfig) as Record<string, unknown>
})

export function registerImageModelHandlers(ctx: IpcContext): void {
  const { db, encryptApiKey, decryptApiKey } = ctx

  ipcMain.handle('imageModels:list', async () => {
    return (await db.listImageModelConfigs()).map((config) => ({
      id: config.id,
      name: config.name,
      provider: resolveProvider(config.provider),
      active: config.active === 1,
      modelConfig: decryptApiKey(config.modelConfig || '{}'),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt
    }))
  })

  ipcMain.handle('imageModels:upsert', async (_event, payload) => {
    const locale = await readAppLocale(ctx)
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    const provider = resolveProvider(record.provider)
    const modelConfig = normalizeModelConfig(record.modelConfig)
    const id =
      typeof record.id === 'string' && record.id.trim().length > 0 ? record.id.trim() : undefined
    if (!name) throw new Error(uiText(locale, '请填写生图模型名称。', 'Enter image model name.'))
    if (modelConfig === '{}') {
      throw new Error(uiText(locale, '请填写生图模型配置。', 'Enter image model config.'))
    }
    const savedId = await db.upsertImageModelConfig({
      id,
      name,
      provider,
      modelConfig: encryptApiKey(modelConfig),
      active: record.active === true,
    })
    return { success: true, id: savedId }
  })

  ipcMain.handle('imageModels:setActive', async (_event, id) => {
    const locale = await readAppLocale(ctx)
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(uiText(locale, '生图模型配置 ID 不能为空。', 'Image model config ID is required.'))
    }
    try {
      await db.setActiveImageModelConfig(id.trim())
    } catch (error) {
      if (error instanceof Error && error.message === 'Image model config does not exist') {
        throw new Error(uiText(locale, '生图模型配置不存在。', 'Image model config does not exist.'))
      }
      throw error
    }
    return { success: true }
  })

  ipcMain.handle('imageModels:delete', async (_event, id) => {
    const locale = await readAppLocale(ctx)
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error(uiText(locale, '生图模型配置 ID 不能为空。', 'Image model config ID is required.'))
    }
    try {
      await db.deleteImageModelConfig(id.trim())
    } catch (error) {
      if (error instanceof Error && error.message === 'Image model config does not exist') {
        throw new Error(uiText(locale, '生图模型配置不存在。', 'Image model config does not exist.'))
      }
      throw error
    }
    return { success: true }
  })

  ipcMain.handle('imageModels:verify', async (_event, payload) => {
    const locale = await readAppLocale(ctx)
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const provider = resolveProvider(record.provider)
    const modelConfig = normalizeModelConfig(record.modelConfig)
    log.info('[imageModels:verify] received', { provider, hasConfig: modelConfig !== '{}' })
    if (modelConfig === '{}') {
      return {
        valid: false,
        message: uiText(locale, '请先填写生图模型配置。', 'Enter image model config first.')
      } satisfies ImageModelVerificationResult
    }

    try {
      const verificationConfig = createVerificationConfig(provider, modelConfig)
      const adapter = resolveImageGenerationProvider(provider)
      const size = adapter.getDefaultSize(verificationConfig)
      const [image] = await adapter.generate(verificationConfig, {
        prompt: IMAGE_MODEL_VERIFY_PROMPT,
        count: 1,
        size,
        signal: AbortSignal.timeout(IMAGE_MODEL_VERIFY_TIMEOUT_MS)
      })
      if (!image || image.bytes.length === 0) {
        return {
          valid: false,
          message: uiText(
            locale,
            '生图接口未返回可预览的图片。',
            'The image endpoint returned no previewable image.'
          )
        } satisfies ImageModelVerificationResult
      }
      return {
        valid: true,
        message: uiText(locale, '已成功生成测试图片。', 'A test image was generated successfully.'),
        previewDataUrl: toPreviewDataUrl(image.bytes, image.mimeType)
      } satisfies ImageModelVerificationResult
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : String(error)
      log.error('[imageModels:verify] failed', { provider, message })
      return {
        valid: false,
        message
      } satisfies ImageModelVerificationResult
    }
  })
}
