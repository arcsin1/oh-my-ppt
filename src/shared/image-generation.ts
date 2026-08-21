export type ImageModelProvider =
  | 'jimeng'
  | 'jimeng4'
  | 'agnes'
  | 'siliconflow'
  | 'openaiCompatible'
  | 'openaiImages'
  | 'gemini'
  | 'seedream'

export type ImageGenerationSize = '16:9' | '1:1' | '4:3' | '9:16' | '3:4'
export type ImageGenerationQuality = 'standard' | 'high'

export interface ImageModelConfig {
  id: string
  name: string
  provider: ImageModelProvider
  active: boolean
  modelConfig: string
  createdAt: number
  updatedAt: number
}

export interface ImageGeneratePayload {
  sessionId: string
  pageId: string
  prompt: string
  imageModelConfigId?: string
  /** @deprecated Use imageModelConfigId for the image generation model. */
  modelConfigId?: string
  size?: string
  count?: number
  negativePrompt?: string
  seed?: number
}

export interface ImagePromptGeneratePayload {
  sessionId: string
  htmlPath: string
  userPrompt?: string
  pageTitle?: string
  pageOutline?: string | null
  modelConfigId?: string
}

export interface ImagePromptGenerateResult {
  prompt: string
}

export interface GeneratedImageAsset {
  id: string
  fileName: string
  originalName: string
  relativePath: string
  absolutePath: string
  mimeType: string
  size: number
  width?: number
  height?: number
  prompt: string
  modelConfigId: string
  provider: ImageModelProvider
  model: string
  pageId: string
  createdAt: number
}

export interface ImageGenerateResult {
  history: ImageGenerationHistoryRecord
}

export interface ImageGenerationHistoryRecord {
  id: string
  sessionId: string
  pageId: string
  prompt: string
  imagePaths: string[]
  assets: GeneratedImageAsset[]
  modelConfigId: string
  provider: ImageModelProvider
  model: string
  createdAt: number
}
