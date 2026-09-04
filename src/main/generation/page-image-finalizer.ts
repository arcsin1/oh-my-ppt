import fs from 'fs'
import log from 'electron-log/main.js'
import { nanoid } from 'nanoid'
import type { OutlineItem } from '@shared/generation'
import { getLayoutMasterTemplate } from '@shared/layout-master'
import {
  isValidImagePrompt,
  parseVisualIntents,
  type VisualIntentParseResult
} from '../image-generation/visual-intent'
import {
  finalizeAutomaticImageIntents,
  type ImageLayoutRefinement
} from '../image-generation/fulfillment-service'
import {
  createImagePromptDirector,
  type ImagePromptDirectorConfig
} from '../image-generation/prompt-director'
import { validatePersistedPageHtml } from '../presentation/html/html-utils'
import type { GenerationContext } from './context'
import { validateLayoutSlots } from './layout-slot-validator'

type PageFinalizerContext = {
  sessionId: string
  runId: string
  visualEnabled: boolean
  imageModelConfigId?: string
  imageGenerationPrompt?: string
  imagePromptDirector?: ImagePromptDirectorConfig
  abortSignal?: AbortSignal
}

type CompletedPage = {
  pageNumber: number
  pageId: string
  title: string
  contentOutline: string
  layoutIntent?: OutlineItem['layoutIntent']
  layoutId: string
  layoutContractVersion: number
  htmlPath: string
}

const assertNotCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new Error('生成已取消')
}

const imageDirectorFailure = (
  parsed: VisualIntentParseResult,
  error: unknown
): VisualIntentParseResult => {
  const message = error instanceof Error && error.message ? error.message : String(error)
  const failure = `Image director failed: ${message}`
  return {
    status: 'invalid',
    intents: [],
    invalidIntents: parsed.intents.map((intent) => ({
      slotId: intent.slotId,
      layoutSlotId: intent.layoutSlotId,
      role: intent.role,
      requestJson: intent.requestJson,
      errors: [failure]
    })),
    errors: [failure]
  }
}

const ensureSessionPageForFinalization = async (
  ctx: GenerationContext,
  context: PageFinalizerContext,
  page: CompletedPage
): Promise<string> => {
  const pages = await ctx.db.listSessionPages(context.sessionId, { includeDeleted: true })
  const existing = pages.find(
    (item) =>
      item.file_slug === page.pageId ||
      item.id === page.pageId ||
      item.legacy_page_id === page.pageId
  )
  if (existing) return existing.id
  const id = nanoid()
  await ctx.db.upsertSessionPage({
    id,
    sessionId: context.sessionId,
    legacyPageId: page.pageId.match(/^page-\d+$/) ? page.pageId : null,
    fileSlug: page.pageId,
    pageNumber: page.pageNumber,
    title: page.title,
    htmlPath: page.htmlPath,
    layoutIntent: page.layoutIntent || null,
    layoutId: page.layoutId,
    layoutContractVersion: page.layoutContractVersion,
    status: 'pending',
    error: null
  })
  return id
}

/** Shared generation-stage gate. A page cannot be persisted or emitted until this resolves. */
export const createPageImageFinalizer =
  (ctx: GenerationContext, context: PageFinalizerContext) =>
  async (page: CompletedPage, refineImageLayout?: ImageLayoutRefinement): Promise<void> => {
    assertNotCancelled(context.abortSignal)
    const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
    const imageRequestsEnabled =
      context.visualEnabled && Boolean(context.imageGenerationPrompt?.trim())
    const imageSlots = (getLayoutMasterTemplate(page.layoutId)?.slots || []).filter(
      (slot) => slot.role === 'visual' && slot.image?.policy !== 'forbidden'
    )
    const imageCapableSlots = imageSlots.map((slot) => slot.id)
    let parsed = parseVisualIntents({
      html,
      visualEnabled: imageRequestsEnabled,
      layoutIntent: page.layoutIntent || null,
      layoutId: page.layoutId,
      layoutContractVersion: page.layoutContractVersion
    })
    if (parsed.status === 'valid' && parsed.intents.length > 0) {
      if (!context.imagePromptDirector) {
        parsed = imageDirectorFailure(parsed, new Error('Image director is not configured.'))
      } else {
        try {
          const directImage = createImagePromptDirector(context.imagePromptDirector)
          const intents = await Promise.all(
            parsed.intents.map(async (intent) => {
              const subject = await directImage({
                sessionId: context.sessionId,
                pageId: page.pageId,
                pageTitle: page.title,
                pageOutline: page.contentOutline,
                pageHtml: html,
                layoutSlotId: intent.layoutSlotId,
                role: intent.role,
                imageGenerationPrompt: context.imageGenerationPrompt || '',
                signal: context.abortSignal
              })
              if (!isValidImagePrompt(subject)) throw new Error('Image director returned an empty prompt.')
              return { ...intent, subject }
            })
          )
          parsed = { ...parsed, intents }
        } catch (error) {
          parsed = imageDirectorFailure(parsed, error)
        }
      }
    }
    log.info('[images:fulfillment] page intent scan', {
      sessionId: context.sessionId,
      runId: context.runId,
      pageId: page.pageId,
      layoutId: page.layoutId,
      layoutIntent: page.layoutIntent || null,
      visualEnabled: context.visualEnabled,
      hasStyleImageDirection: Boolean(context.imageGenerationPrompt?.trim()),
      imageModelConfigured: Boolean(context.imageModelConfigId?.trim()),
      imageCapableSlots,
      intentStatus: parsed.status,
      intentCount: parsed.intents.length,
      errors: parsed.errors
    })
    if (parsed.status === 'forbidden') {
      const error = parsed.errors.join(' ') || 'Image intent drafts are forbidden for this session.'
      log.warn('[images:fulfillment] forbidden image intent drafts', {
        sessionId: context.sessionId,
        runId: context.runId,
        pageId: page.pageId,
        error
      })
      throw new Error(error)
    }
    if (parsed.status === 'none') {
      log.info('[images:fulfillment] page skipped', {
        sessionId: context.sessionId,
        runId: context.runId,
        pageId: page.pageId,
        reason: !imageRequestsEnabled
          ? 'automatic image generation is disabled or the style has no image direction'
          : imageCapableSlots.length === 0
            ? 'layout has no image-capable visual slot'
            : 'page agent determined that no generated image improves this page'
      })
      assertNotCancelled(context.abortSignal)
      return
    }
    const sessionPageId = await ensureSessionPageForFinalization(ctx, context, page)
    const result = await finalizeAutomaticImageIntents({
      db: ctx.db,
      coordinator: ctx.imageCoordinator,
      decryptApiKey: ctx.credentials.decryptApiKey,
      resolveSessionProjectDir: ctx.sessionProject.resolveSessionProjectDir,
      sessionId: context.sessionId,
      sessionPageId,
      runId: context.runId,
      pageId: page.pageId,
      pageHtmlPath: page.htmlPath,
      layoutId: page.layoutId,
      layoutContractVersion: page.layoutContractVersion,
      imageModelConfigId: context.imageModelConfigId || '',
      parseResult: parsed,
      validateCandidateHtml: (candidateHtml) => [
        ...validatePersistedPageHtml(candidateHtml, page.pageId).errors,
        ...validateLayoutSlots({
          html: candidateHtml,
          layoutIntent: page.layoutIntent || null,
          layoutId: page.layoutId,
          layoutContractVersion: page.layoutContractVersion
        }).errors
      ],
      signal: context.abortSignal,
      refineImageLayout
    })
    log.info('[images:fulfillment] page finalization finished', {
      sessionId: context.sessionId,
      runId: context.runId,
      pageId: page.pageId,
      jobId: result.jobId || null,
      status: result.status,
      reused: Boolean(result.reused),
      error: result.error || null
    })
    if (result.status === 'cancelled') throw new Error('生成已取消')
    assertNotCancelled(context.abortSignal)
  }
