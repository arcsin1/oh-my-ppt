import type { ImageModelConfig, ImageModelProvider } from '@shared/image-generation.js'

export type ImageSizeOption = {
  value: string
  label: string
}

const PROVIDER_SIZE_OPTIONS: Record<ImageModelProvider, ImageSizeOption[]> = {
  jimeng: [
    { value: '16:9', label: '16:9 · 1664x936' },
    { value: '1:1', label: '1:1 · 1328x1328' },
    { value: '4:3', label: '4:3 · 1472x1104' }
  ],
  jimeng4: [
    { value: '16:9', label: '16:9 · 2560x1440' },
    { value: '1:1', label: '1:1 · 2048x2048' },
    { value: '4:3', label: '4:3 · 2304x1728' },
    { value: '9:16', label: '9:16 · 1440x2560' },
    { value: '3:4', label: '3:4 · 1728x2304' }
  ],
  agnes: [
    { value: '16:9', label: '16:9 · 1024x768' },
    { value: '1:1', label: '1:1 · 1024x1024' },
    { value: '4:3', label: '4:3 · 1024x768' }
  ],
  siliconflow: [
    { value: '1024x1024', label: '1:1 · 1024x1024' },
    { value: '1280x720', label: '16:9 · 1280x720' },
    { value: '720x1280', label: '9:16 · 720x1280' }
  ],
  openaiCompatible: [
    { value: '1024x1024', label: '1:1 · 1024x1024' },
    { value: '1536x1024', label: '3:2 · 1536x1024' },
    { value: '1024x1536', label: '2:3 · 1024x1536' },
    { value: 'auto', label: 'auto' }
  ],
  openaiImages: [
    { value: '1024x1024', label: '1:1 · 1024x1024' },
    { value: '1536x1024', label: '3:2 · 1536x1024' },
    { value: '1024x1536', label: '2:3 · 1024x1536' },
    { value: 'auto', label: 'auto' }
  ],
  gemini: [
    { value: '1:1|1K', label: '1:1 · 1K' },
    { value: '16:9|1K', label: '16:9 · 1K' },
    { value: '9:16|1K', label: '9:16 · 1K' },
    { value: '4:3|1K', label: '4:3 · 1K' },
    { value: '3:4|1K', label: '3:4 · 1K' },
    { value: '3:2|1K', label: '3:2 · 1K' },
    { value: '2:3|1K', label: '2:3 · 1K' },
    { value: '21:9|1K', label: '21:9 · 1K' },
    { value: '1:1|2K', label: '1:1 · 2K' },
    { value: '16:9|2K', label: '16:9 · 2K' },
    { value: '9:16|2K', label: '9:16 · 2K' },
    { value: '1:1|4K', label: '1:1 · 4K' },
    { value: '16:9|4K', label: '16:9 · 4K' },
    { value: '9:16|4K', label: '9:16 · 4K' }
  ],
  seedream: [{ value: '2K', label: '2K' }]
}

const SILICONFLOW_QWEN_SIZE_OPTIONS: ImageSizeOption[] = [
  { value: '1328x1328', label: '1:1 · 1328x1328' },
  { value: '1664x928', label: '16:9 · 1664x928' },
  { value: '928x1664', label: '9:16 · 928x1664' },
  { value: '1472x1140', label: '4:3 · 1472x1140' },
  { value: '1140x1472', label: '3:4 · 1140x1472' },
  { value: '1584x1056', label: '3:2 · 1584x1056' },
  { value: '1056x1584', label: '2:3 · 1056x1584' }
]

const SILICONFLOW_KOLORS_SIZE_OPTIONS: ImageSizeOption[] = [
  { value: '1024x1024', label: '1:1 · 1024x1024' },
  { value: '960x1280', label: '3:4 · 960x1280' },
  { value: '768x1024', label: '3:4 · 768x1024' },
  { value: '720x1440', label: '1:2 · 720x1440' },
  { value: '720x1280', label: '9:16 · 720x1280' }
]

const readModelConfigObject = (config?: ImageModelConfig): Record<string, unknown> => {
  if (!config?.modelConfig) return {}
  try {
    const parsed = JSON.parse(config.modelConfig)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const readSizeString = (record: Record<string, unknown>, key: string): string => {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

const buildSizeOption = (value: string, label?: string): ImageSizeOption | null => {
  const normalizedValue = value.trim()
  if (!normalizedValue) return null
  const normalizedLabel = label?.trim()
  return {
    value: normalizedValue,
    label: normalizedLabel || normalizedValue
  }
}

const normalizeConfiguredSizeOption = (item: unknown): ImageSizeOption | null => {
  if (typeof item === 'string') return buildSizeOption(item)
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null
  const record = item as Record<string, unknown>
  const value =
    readSizeString(record, 'value') ||
    readSizeString(record, 'size') ||
    readSizeString(record, 'ratio') ||
    readSizeString(record, 'aspectRatio') ||
    readSizeString(record, 'aspect_ratio')
  const width = Number(record.width)
  const height = Number(record.height)
  const dimensionLabel =
    Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      ? `${Math.floor(width)}x${Math.floor(height)}`
      : ''
  const explicitValue = readSizeString(record, 'value') || readSizeString(record, 'size')
  return buildSizeOption(
    explicitValue || dimensionLabel || value,
    readSizeString(record, 'label') || [value, dimensionLabel].filter(Boolean).join(' · ')
  )
}

const uniqueSizeOptions = (options: ImageSizeOption[]): ImageSizeOption[] => {
  const seen = new Set<string>()
  return options.filter((option) => {
    if (seen.has(option.value)) return false
    seen.add(option.value)
    return true
  })
}

const isImageSizeOption = (option: ImageSizeOption | null): option is ImageSizeOption =>
  Boolean(option)

export const resolveImageSizeOptions = (config?: ImageModelConfig): ImageSizeOption[] => {
  const modelConfig = readModelConfigObject(config)
  const configuredOptionsSource =
    modelConfig.sizes ||
    modelConfig.supportedSizes ||
    modelConfig.aspectRatios ||
    modelConfig.aspect_ratios ||
    modelConfig.ratios
  const configuredOptions = Array.isArray(configuredOptionsSource)
    ? uniqueSizeOptions(
        configuredOptionsSource.map(normalizeConfiguredSizeOption).filter(isImageSizeOption)
      )
    : []
  if (configuredOptions.length > 0) return configuredOptions

  const fixedSize = readSizeString(modelConfig, 'size')
  if (fixedSize) return [{ value: fixedSize, label: fixedSize }]

  const width = Number(modelConfig.width)
  const height = Number(modelConfig.height)
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    const size = `${Math.floor(width)}x${Math.floor(height)}`
    return [{ value: size, label: size }]
  }

  const model = readSizeString(modelConfig, 'model')
  if (config?.provider === 'siliconflow') {
    if (/qwen\/qwen-image/i.test(model)) return SILICONFLOW_QWEN_SIZE_OPTIONS
    if (/kolors/i.test(model)) return SILICONFLOW_KOLORS_SIZE_OPTIONS
  }

  if (config?.provider) return PROVIDER_SIZE_OPTIONS[config.provider]
  return PROVIDER_SIZE_OPTIONS.jimeng
}
