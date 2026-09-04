// Image-provider contracts belong to Agent Runtime.
import type { ImageModelProvider } from '@shared/image-generation'

export interface ResolvedImageModelConfig {
  id: string
  name: string
  provider: ImageModelProvider
  active: boolean
  modelConfig: Record<string, unknown>
}

export interface ImageGenerationInput {
  prompt: string
  size: string
  count: number
  negativePrompt?: string
  seed?: number
  signal?: AbortSignal
}

export interface ImageGenerationResult {
  bytes: Buffer
  mimeType: string
  extension: string
}

export interface ImageGenerationProviderAdapter {
  /** Returns the model-specific default used when generation has no user-selected size. */
  getDefaultSize(config: ResolvedImageModelConfig): string
  generate(config: ResolvedImageModelConfig, input: ImageGenerationInput): Promise<ImageGenerationResult[]>
}
