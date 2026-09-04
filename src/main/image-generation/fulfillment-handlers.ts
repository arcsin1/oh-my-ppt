import { ipcMain } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import * as cheerio from 'cheerio'
import type { IpcContext } from '../ipc/context'
import { JobCoordinator } from '../agent-runtime'
import { formatLayoutMasterPrompt, getLayoutMasterTemplate } from '@shared/layout-master'
import { createGenerationContext, resolveCommonContext } from '../generation/context'
import { createImageLayoutRefinement } from '../generation/agent-runner'
import { resolvePageHtmlPath } from '../generation/generation-utils'
import { validateLayoutSlots } from '../generation/layout-slot-validator'
import { validatePersistedPageHtml } from '../presentation/html/html-utils'
import { finalizeAutomaticImageIntents } from './fulfillment-service'
import { withImageFulfillmentRetryLock } from './fulfillment-retry-lock'
import type { ParsedVisualIntent, VisualIntentParseResult } from './visual-intent'
import {
  ensureHistoryBaselineSafe,
  recordHistoryOperationStrict
} from '../history/git-history-service'

const readRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const RETRYABLE_INTENT_STATUSES = new Set(['failed', 'fallback', 'layout_failed', 'cancelled'])
const IMAGE_ROLES = new Set(['hero-image', 'product-visual', 'spot-illustration', 'data-visual'])

const parseStringArray = (value: string | null): string[] => {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

const toRetryIntent = (intent: {
  slot_id: string
  layout_slot_id: string
  role: string
  layer: string
  subject: string
  text_zone: string | null
  subject_zone: string | null
  negative_space: string | null
  avoid_json: string | null
  request_json: string
}): ParsedVisualIntent | null => {
  if (!IMAGE_ROLES.has(intent.role)) return null
  if (!intent.slot_id || !intent.layout_slot_id || !intent.subject.trim()) return null
  if (intent.layer !== 'background' && intent.layer !== 'visual') return null
  return {
    slotId: intent.slot_id,
    layoutSlotId: intent.layout_slot_id,
    role: intent.role as ParsedVisualIntent['role'],
    layer: intent.layer,
    subject: intent.subject,
    textZone: intent.text_zone || undefined,
    subjectZone: intent.subject_zone || undefined,
    negativeSpace: intent.negative_space || undefined,
    avoid: parseStringArray(intent.avoid_json),
    requestJson: intent.request_json
  }
}

const hasLayoutSlot = ($: cheerio.CheerioAPI, slotId: string): boolean =>
  $('[data-ppt-slot]')
    .toArray()
    .some((node) => ($(node).attr('data-ppt-slot') || '').trim() === slotId)

const executeAutomaticImageFulfillmentRetry = async (
  ctx: IpcContext,
  coordinator: JobCoordinator,
  args: { sessionId: string; sourceJobId: string }
) => {
  const sourceJob = await ctx.db.getImageFulfillmentJob(args.sourceJobId)
  if (!sourceJob || sourceJob.session_id !== args.sessionId)
    throw new Error('Image fulfillment job not found.')
  if (!['completed', 'degraded', 'failed', 'cancelled'].includes(sourceJob.status)) {
    throw new Error('Image fulfillment job is not ready to retry.')
  }
  if (!sourceJob.layout_id || !sourceJob.layout_contract_version) {
    throw new Error('The original image job has no compatible layout source.')
  }

  const sessionPage = (
    await ctx.db.listSessionPages(args.sessionId, { includeDeleted: true })
  ).find((page) => page.id === sourceJob.session_page_id)
  if (!sessionPage || sessionPage.deleted_at) throw new Error('The original page no longer exists.')
  if (
    sessionPage.layout_id !== sourceJob.layout_id ||
    sessionPage.layout_contract_version !== sourceJob.layout_contract_version ||
    !sessionPage.layout_intent
  ) {
    throw new Error(
      'The page layout source changed; regenerate the page before retrying its illustration.'
    )
  }

  const execution = { runId: sourceJob.run_id, abortSignal: new AbortController().signal }
  const generationContext = createGenerationContext({ ...ctx, imageCoordinator: coordinator })
  const common = await resolveCommonContext(generationContext, args.sessionId, undefined, execution)
  if (!common.visualEnabled || !common.imageModelConfigId) {
    throw new Error('Automatic image generation is disabled for this session.')
  }

  const pageHtmlPath = resolvePageHtmlPath({
    projectDir: common.projectDir,
    fileSlug: sessionPage.file_slug,
    candidates: [sessionPage.html_path]
  })
  if (!fs.existsSync(pageHtmlPath)) throw new Error('The page file no longer exists.')
  const currentHtml = await fs.promises.readFile(pageHtmlPath, 'utf-8')
  const layoutIntent = sessionPage.layout_intent as Parameters<
    typeof validateLayoutSlots
  >[0]['layoutIntent']
  const slotValidation = validateLayoutSlots({
    html: currentHtml,
    layoutIntent,
    layoutId: sessionPage.layout_id,
    layoutContractVersion: sessionPage.layout_contract_version
  })
  if (!slotValidation.valid || slotValidation.skipped) {
    throw new Error('The current page no longer satisfies the original layout slot contract.')
  }

  const template = getLayoutMasterTemplate(sessionPage.layout_id)
  if (!template || template.intent !== layoutIntent) {
    throw new Error('The current layout catalog entry is unavailable for image retry.')
  }

  const sourceIntents = await ctx.db.listImageFulfillmentIntents(sourceJob.id)
  const retryable = sourceIntents
    .filter((intent) => RETRYABLE_INTENT_STATUSES.has(intent.status))
    .map((intent) => ({ source: intent, request: toRetryIntent(intent) }))
    .filter(
      (item): item is { source: (typeof sourceIntents)[number]; request: ParsedVisualIntent } =>
        Boolean(item.request)
    )
    .filter((item) =>
      hasLayoutSlot(
        cheerio.load(currentHtml, { scriptingEnabled: false }),
        item.request.layoutSlotId
      )
    )
    .filter((item) => {
      const layoutSlot = template.slots.find((slot) => slot.id === item.request.layoutSlotId)
      return Boolean(
        layoutSlot?.image &&
        layoutSlot.image.policy !== 'forbidden' &&
        layoutSlot.image.role === item.request.role
      )
    })
  if (retryable.length === 0) {
    throw new Error('No failed illustration remains compatible with the current page layout.')
  }

  const parseResult: VisualIntentParseResult = {
    status: 'valid',
    intents: retryable.map((item) => item.request),
    invalidIntents: [],
    errors: []
  }
  const retryOfIntentIdBySlot = Object.fromEntries(
    retryable.map((item) => [item.request.slotId, item.source.id])
  )
  const retryKey = crypto
    .createHash('sha256')
    .update(`${sourceJob.id}:${currentHtml}`)
    .digest('hex')
    .slice(0, 24)
  await ensureHistoryBaselineSafe(ctx.db, args.sessionId, common.projectDir)
  const result = await finalizeAutomaticImageIntents({
    db: ctx.db,
    coordinator,
    decryptApiKey: ctx.credentials.decryptApiKey,
    resolveSessionProjectDir: ctx.resolveSessionProjectDir,
    sessionId: args.sessionId,
    sessionPageId: sessionPage.id,
    runId: sourceJob.run_id,
    pageId: sessionPage.file_slug,
    pageHtmlPath,
    layoutId: sessionPage.layout_id,
    layoutContractVersion: sessionPage.layout_contract_version,
    imageModelConfigId: common.imageModelConfigId,
    parseResult,
    retryOfJobId: sourceJob.id,
    retryOfIntentIdBySlot,
    idempotencyKey: `retry:${retryKey}`,
    validateCandidateHtml: (candidateHtml) => [
      ...validatePersistedPageHtml(candidateHtml, sessionPage.file_slug).errors,
      ...validateLayoutSlots({
        html: candidateHtml,
        layoutIntent,
        layoutId: sessionPage.layout_id,
        layoutContractVersion: sessionPage.layout_contract_version
      }).errors
    ],
    refineImageLayout: createImageLayoutRefinement({
      provider: common.provider,
      apiKey: common.apiKey,
      model: common.model,
      baseUrl: common.providerBaseUrl,
      maxTokens: common.maxTokens,
      modelRuntime: common.modelRuntime,
      styleId: common.styleId,
      context: {
        mode: 'edit',
        editScope: 'page',
        sessionId: args.sessionId,
        projectDir: common.projectDir,
        indexPath: path.join(common.projectDir, 'index.html'),
        pageFileMap: { [sessionPage.file_slug]: pageHtmlPath },
        pageNumbers: { [sessionPage.file_slug]: sessionPage.page_number },
        selectPageIds: [sessionPage.file_slug],
        allowedPageIds: [sessionPage.file_slug],
        topic: common.topic,
        deckTitle: common.deckTitle,
        styleId: common.styleId,
        styleSkillPrompt: common.styleSkillPrompt,
        hasStyleImageDirection: Boolean(common.imageGenerationPrompt.trim()),
        styleKey: common.styleKey,
        styleName: common.styleName,
        styleVersion: common.styleVersion,
        slideSize: common.slideSize,
        appLocale: common.appLocale,
        userMessage: 'Refine this page after automatic image placement.',
        outlineTitles: [sessionPage.title || sessionPage.file_slug],
        outlineItems: [
          {
            title: sessionPage.title || sessionPage.file_slug,
            contentOutline: '',
            layoutIntent,
            layoutId: sessionPage.layout_id,
            layoutPrompt: formatLayoutMasterPrompt(template)
          }
        ],
        selectedPageId: sessionPage.file_slug,
        selectedPageNumber: sessionPage.page_number,
        selectedSelector: 'main[data-role="content"]',
        elementTag: 'main',
        elementText: 'Complete slide content after automatic image placement',
        existingPageIds: [sessionPage.file_slug]
      },
      agentManager: generationContext.agentManager,
      emit: (chunk) => ctx.emitGenerateChunk(args.sessionId, chunk),
      runId: sourceJob.run_id,
      stage: 'editing',
      totalPages: 1,
      timeoutMs: common.modelTimeouts.agent,
      signal: execution.abortSignal,
      workerLabel: sessionPage.file_slug
    }),
    signal: execution.abortSignal
  })
  if (result.status === 'completed' && result.jobId && !result.reused) {
    const retryIntents = await ctx.db.listImageFulfillmentIntents(result.jobId)
    const imagePaths = retryIntents
      .filter((intent) => intent.status === 'used' && intent.asset_path)
      .map((intent) => intent.asset_path!.replace(/^\.\//, ''))
    await recordHistoryOperationStrict(ctx.db, {
      sessionId: args.sessionId,
      projectDir: common.projectDir,
      type: 'edit',
      scope: 'page',
      prompt: 'Retry failed automatic illustration',
      allowedPaths: [
        path.relative(common.projectDir, pageHtmlPath).split(path.sep).join('/'),
        ...imagePaths
      ]
    })
    const html = await fs.promises.readFile(pageHtmlPath, 'utf-8')
    ctx.emitGenerateChunk(args.sessionId, {
      type: 'page_updated',
      payload: {
        runId: sourceJob.run_id,
        stage: 'finalizing',
        label: common.appLocale === 'en' ? 'Illustration retry saved' : '配图重试已保存',
        progress: 100,
        currentPage: sessionPage.page_number,
        totalPages: 1,
        id: sessionPage.id,
        pageNumber: sessionPage.page_number,
        title: sessionPage.title || `第${sessionPage.page_number}页`,
        html,
        pageId: sessionPage.file_slug,
        htmlPath: pageHtmlPath,
        sourceUrl: ctx.getPageSourceUrl(pageHtmlPath)
      }
    })
  }
  return result
}

export const retryAutomaticImageFulfillment = async (
  ctx: IpcContext,
  coordinator: JobCoordinator,
  args: { sessionId: string; sourceJobId: string }
) => {
  return withImageFulfillmentRetryLock(coordinator, args.sessionId, args.sourceJobId, () =>
    executeAutomaticImageFulfillmentRetry(ctx, coordinator, args)
  )
}

/** IPC is deliberately limited to state and cooperative cancellation. Generation owns job creation. */
export const registerImageFulfillmentHandlers = (
  ctx: IpcContext,
  coordinator: JobCoordinator
): void => {
  ipcMain.handle('images:listFulfillmentJobs', async (_event, payload: unknown) => {
    const input = readRecord(payload)
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
    const pageId = typeof input.pageId === 'string' ? input.pageId.trim() : ''
    if (!sessionId) throw new Error('Session ID is required.')
    let sessionPageId: string | undefined
    if (pageId) {
      const page = (await ctx.db.listSessionPages(sessionId, { includeDeleted: true })).find(
        (item) => item.id === pageId || item.file_slug === pageId || item.legacy_page_id === pageId
      )
      if (!page) return []
      sessionPageId = page.id
    }
    const jobs = await ctx.db.listImageFulfillmentJobs(sessionId, sessionPageId)
    return Promise.all(
      jobs.map(async (job) => {
        const intents = await ctx.db.listImageFulfillmentIntents(job.id)
        return {
          ...job,
          layout_failed_count: intents.filter((intent) => intent.status === 'layout_failed').length,
          retryable_intent_count: intents.filter(
            (intent) =>
              RETRYABLE_INTENT_STATUSES.has(intent.status) && Boolean(toRetryIntent(intent))
          ).length
        }
      })
    )
  })

  ipcMain.handle('images:cancelFulfillment', async (_event, payload: unknown) => {
    const input = readRecord(payload)
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
    const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : ''
    if (!sessionId || !jobId) return { success: false }
    const job = await ctx.db.getImageFulfillmentJob(jobId)
    if (!job || job.session_id !== sessionId) return { success: false }
    const requested = await ctx.db.requestImageFulfillmentCancellation(jobId)
    const cancelled = coordinator.cancel(jobId) || coordinator.cancel(`${jobId}:commit`)
    return { success: requested || cancelled }
  })

  ipcMain.handle('images:retryFulfillment', async (_event, payload: unknown) => {
    const input = readRecord(payload)
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
    const jobId = typeof input.jobId === 'string' ? input.jobId.trim() : ''
    if (!sessionId || !jobId) throw new Error('Session ID and fulfillment job ID are required.')
    return retryAutomaticImageFulfillment(ctx, coordinator, { sessionId, sourceJobId: jobId })
  })
}
