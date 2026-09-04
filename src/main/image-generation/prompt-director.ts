import log from 'electron-log/main.js'
import * as cheerio from 'cheerio'
import type { ModelRuntimeConfig } from '../agent-runtime/model'
import { extractModelText, resolveModel } from '../agent-runtime/model'
import { buildImagePromptGenerationMessages } from '../agent-runtime/prompt'
import { resolveModelTimeoutMs } from '@shared/model-timeout'

export type ImagePromptDirectorConfig = {
  provider: string
  apiKey: string
  model: string
  baseUrl?: string
  maxTokens: number
  modelRuntime: ModelRuntimeConfig
  modelTimeoutMs: unknown
  locale: 'zh' | 'en'
}

export type ImagePromptDirectorInput = {
  sessionId: string
  pageId: string
  pageTitle: string
  pageOutline: string
  pageHtml: string
  layoutSlotId: string
  role: string
  imageGenerationPrompt: string
  signal?: AbortSignal
}

export const compactPageHtmlForImagePrompt = (html: string): string =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24000)

/** The Director needs the slide's meaning, not its full generated CSS and SVG payload. */
export const compactPageContentForImageDirector = (html: string): string => {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  $('script, style, svg, canvas, template').remove()
  const content = $('main[data-role="content"]').first()
  const root = content.length > 0 ? content : $('main').first()
  const slotLines = root
    .find('[data-ppt-slot]')
    .toArray()
    .map((node) => {
      const slot = ($(node).attr('data-ppt-slot') || '').trim()
      const text = $(node).text().replace(/\s+/g, ' ').trim()
      return slot && text ? `${slot}: ${text}` : text
    })
    .filter(Boolean)
  const fallback = root.text().replace(/\s+/g, ' ').trim()
  return (slotLines.length > 0 ? slotLines.join('\n') : fallback).slice(0, 6000)
}

export const normalizeGeneratedImagePrompt = (raw: string): string =>
  raw
    .replace(/^```(?:text|markdown|md)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^\s*(?:prompt|提示词)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

const IMAGE_DIRECTOR_CONSTRAINTS =
  'Return only one concise image-generation prompt. Do not include explanations, JSON, Markdown, logos, watermarks, UI, or remote URLs. Do not invent typography, captions, labels, or lettering-like decoration. Avoid garbled, partial, illegible, or irrelevant text, including pseudo-text and random glyph-like marks. If the image genuinely needs a short text element, state its exact wording in quotation marks, keep it clearly legible and semantically relevant to the page, and do not add any other words.'

export const createImagePromptDirector = (config: ImagePromptDirectorConfig) =>
  async (input: ImagePromptDirectorInput): Promise<string> => {
    const pageContent = compactPageContentForImageDirector(input.pageHtml)
    const model = resolveModel(
      config.provider,
      config.apiKey,
      config.model,
      config.baseUrl,
      0.45,
      config.maxTokens,
      config.modelRuntime
    )
    const timeoutSignal = AbortSignal.timeout(resolveModelTimeoutMs(config.modelTimeoutMs, 'agent'))
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal
    const userPrompt = [
      `Design one ${input.role} for the rendered layout slot "${input.layoutSlotId}".`,
      'The page title, outline, and content define the subject. Turn that meaning into a visual metaphor that supports the factual content instead of repeating it as extra copy or a chart.',
      `Image style direction (treatment only, not subject matter): ${input.imageGenerationPrompt}`,
      'Use the style direction for palette, material, atmosphere, and illustration or photography treatment. Do not reuse literal style motifs unless they are semantically relevant to this page. For legal, data, process, or analytical pages, choose a topic-relevant visual metaphor rather than a generic decorative splash.',
      IMAGE_DIRECTOR_CONSTRAINTS
    ].join(' ')

    log.info('[images:director] start', {
      sessionId: input.sessionId,
      pageId: input.pageId,
      layoutSlotId: input.layoutSlotId,
      role: input.role,
      model: config.model,
      pageContentLength: pageContent.length
    })
    const response = await model.invoke(
      buildImagePromptGenerationMessages({
        locale: config.locale,
        userPrompt,
        pageTitle: input.pageTitle,
        pageOutline: input.pageOutline,
        pageHtml: pageContent
      }),
      { signal }
    )
    const prompt = normalizeGeneratedImagePrompt(extractModelText(response))
    if (!prompt) throw new Error('Image director returned an empty prompt.')
    log.info('[images:director] completed', {
      sessionId: input.sessionId,
      pageId: input.pageId,
      layoutSlotId: input.layoutSlotId,
      promptLength: prompt.length
    })
    return prompt
  }
