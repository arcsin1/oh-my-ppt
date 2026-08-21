import type { ImageGenerationProviderAdapter, ResolvedImageModelConfig } from '../types'
import { agnesAiAdapter } from './agnes-ai'
import { geminiAdapter } from './gemini'
import { jimengAdapter } from './jimeng'
import { jimengV4Adapter } from './jimeng-v4'
import { openAiChatCompletionsAdapter } from './openai-chat-completions'
import { openAiImagesAdapter } from './openai-images'
import { seedreamAdapter } from './seedream'
import { siliconFlowAdapter } from './siliconflow'

const PROVIDER_ADAPTERS: Record<
  ResolvedImageModelConfig['provider'],
  ImageGenerationProviderAdapter
> = {
  agnes: agnesAiAdapter,
  jimeng: jimengAdapter,
  jimeng4: jimengV4Adapter,
  siliconflow: siliconFlowAdapter,
  openaiCompatible: openAiChatCompletionsAdapter,
  openaiImages: openAiImagesAdapter,
  gemini: geminiAdapter,
  seedream: seedreamAdapter
}

export function resolveImageGenerationProvider(
  provider: ResolvedImageModelConfig['provider']
): ImageGenerationProviderAdapter {
  return PROVIDER_ADAPTERS[provider]
}
