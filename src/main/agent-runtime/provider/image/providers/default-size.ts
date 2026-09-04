import type { ResolvedImageModelConfig } from '../types'
import { readRecord, readString } from './utils'

const readPositiveInteger = (value: unknown): number | null => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null
}

const readSizeOption = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  const option = readRecord(value)
  const explicit =
    readString(option, 'value') ||
    readString(option, 'size') ||
    readString(option, 'imageSize') ||
    readString(option, 'image_size')
  if (explicit) return explicit
  const width = readPositiveInteger(option.width)
  const height = readPositiveInteger(option.height)
  return width && height ? `${width}x${height}` : ''
}

/**
 * Model settings may declare one fixed size or a list of supported values. Automatic generation
 * always uses this provider/model default; only the manual image panel supplies a user selection.
 */
export const resolveConfiguredDefaultImageSize = (config: ResolvedImageModelConfig): string => {
  const modelConfig = config.modelConfig
  const configured =
    readString(modelConfig, 'defaultSize') ||
    readString(modelConfig, 'default_size') ||
    readString(modelConfig, 'size') ||
    readString(modelConfig, 'imageSize') ||
    readString(modelConfig, 'image_size')
  if (configured) return configured

  const width = readPositiveInteger(modelConfig.width)
  const height = readPositiveInteger(modelConfig.height)
  if (width && height) return `${width}x${height}`

  const numericSize = readPositiveInteger(modelConfig.size)
  if (numericSize) return String(numericSize)

  for (const key of ['sizes', 'supportedSizes', 'aspectRatios', 'aspect_ratios', 'ratios']) {
    const options = modelConfig[key]
    if (!Array.isArray(options)) continue
    const selected = options.map(readSizeOption).find(Boolean)
    if (selected) return selected
  }
  return ''
}
