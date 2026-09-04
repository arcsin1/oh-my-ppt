import type { ImageModelConfig } from '@renderer/lib/ipc'

const parseModelConfig = (value: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return Object.keys(parsed).length > 0 ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export const isUsableImageModelConfig = (config: ImageModelConfig): boolean =>
  Boolean(config.name.trim() && config.provider && parseModelConfig(config.modelConfig.trim()))

export const getUsableImageModelConfigs = (
  configs: ImageModelConfig[] | null | undefined
): ImageModelConfig[] => (Array.isArray(configs) ? configs : []).filter(isUsableImageModelConfig)

export const resolveDefaultImageModelConfigId = (configs: ImageModelConfig[]): string =>
  configs.find((config) => config.active)?.id || configs[0]?.id || ''

export const getImageModelConfigLabel = (config: ImageModelConfig): string => {
  const parsed = parseModelConfig(config.modelConfig.trim())
  const model =
    typeof parsed?.model === 'string'
      ? parsed.model.trim()
      : typeof parsed?.reqKey === 'string'
        ? parsed.reqKey.trim()
        : ''
  return model ? `${config.name} · ${config.provider} · ${model}` : `${config.name} · ${config.provider}`
}
