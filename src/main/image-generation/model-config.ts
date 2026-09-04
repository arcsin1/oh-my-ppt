import type { ImageModelProvider } from '@shared/image-generation'
import type { ResolvedImageModelConfig } from '../agent-runtime/provider/image'
import type { PPTDatabase } from '../db/database'
import type { IpcContext } from '../ipc/context'

type ImageModelConfigContext = Pick<IpcContext, 'decryptApiKey'> & {
  db: Pick<PPTDatabase, 'getImageModelConfig'>
}

type ActiveImageModelConfigContext = ImageModelConfigContext & {
  db: Pick<PPTDatabase, 'getImageModelConfig' | 'getActiveImageModelConfig'>
}

export const IMAGE_MODEL_PROVIDERS = [
  'jimeng',
  'jimeng4',
  'agnes',
  'siliconflow',
  'openaiCompatible',
  'gemini',
  'seedream'
] as const

export const resolveImageModelProvider = (provider: unknown): ImageModelProvider => {
  if (IMAGE_MODEL_PROVIDERS.includes(provider as ImageModelProvider)) {
    return provider as ImageModelProvider
  }
  throw new Error('Unsupported image provider')
}

export const parseImageModelConfig = (value: unknown): Record<string, unknown> | null => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return Object.keys(parsed).length > 0 ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const getImageModelConfigString = (config: ResolvedImageModelConfig, key: string): string => {
  const value = config.modelConfig[key]
  return typeof value === 'string' ? value.trim() : ''
}

export const getImageModelDisplayName = (config: ResolvedImageModelConfig): string =>
  getImageModelConfigString(config, 'model') ||
  getImageModelConfigString(config, 'reqKey') ||
  config.provider

const resolveRawImageModelConfig = (
  ctx: Pick<IpcContext, 'decryptApiKey'>,
  raw: {
    id: string
    name: string
    provider: string
    active: number
    modelConfig: string
  }
): ResolvedImageModelConfig => {
  const modelConfig = parseImageModelConfig(ctx.decryptApiKey(raw.modelConfig || '{}'))
  if (!modelConfig) throw new Error('Image model config is empty or invalid')
  return {
    id: raw.id,
    name: raw.name,
    provider: resolveImageModelProvider(raw.provider),
    active: raw.active === 1,
    modelConfig
  }
}

export const resolveConfiguredImageModel = async (
  ctx: ImageModelConfigContext,
  modelConfigId: string
): Promise<ResolvedImageModelConfig> => {
  const id = modelConfigId.trim()
  if (!id) throw new Error('Image model config ID is required')
  const raw = await ctx.db.getImageModelConfig(id)
  if (!raw) throw new Error('Image model config does not exist')
  return resolveRawImageModelConfig(ctx, raw)
}

export const resolveActiveOrSelectedImageModel = async (
  ctx: ActiveImageModelConfigContext,
  modelConfigId?: string
): Promise<ResolvedImageModelConfig> => {
  const id = modelConfigId?.trim()
  if (id) return resolveConfiguredImageModel(ctx, id)
  const active = await ctx.db.getActiveImageModelConfig()
  if (!active) throw new Error('请先在设置中配置并启用生图模型。')
  return resolveRawImageModelConfig(ctx, active)
}
