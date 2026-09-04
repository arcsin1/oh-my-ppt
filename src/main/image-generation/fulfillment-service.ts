import crypto from 'crypto'
import log from 'electron-log/main.js'
import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import type {
  ImageFulfillmentIntentRecord,
  ImageFulfillmentJobRecord,
  PPTDatabase
} from '../db/database'
import { imageHistoryLockKey, JobCoordinator } from '../agent-runtime'
import { resolveImageGenerationProvider } from '../agent-runtime/provider/image'
import { allowLocalAssetRoot } from '../io/local-asset-roots'
import { getImageModelDisplayName, resolveConfiguredImageModel } from './model-config'
import type { ParsedVisualIntent, VisualIntentParseResult } from './visual-intent'
import {
  adoptFinalizedImageAssets,
  stripImageIntentDrafts,
  validateFinalizedImageHtml,
  type FinalizationAsset
} from './finalization-validator'

const LEASE_DURATION_SECONDS = 10 * 60
const FINALIZATION_LEASE_DURATION_SECONDS = 30 * 60

type FulfillmentDb = Pick<
  PPTDatabase,
  | 'createImageFulfillmentJob'
  | 'getImageFulfillmentJob'
  | 'getImageModelConfig'
  | 'claimImageFulfillmentJob'
  | 'completeImageFulfillmentJob'
  | 'transitionImageFulfillmentJob'
  | 'transitionImageFulfillmentIntent'
>

export type FinalizeAutomaticImageArgs = {
  db: FulfillmentDb
  coordinator: JobCoordinator
  decryptApiKey(value: string): string
  resolveSessionProjectDir(sessionId: string): Promise<string>
  sessionId: string
  sessionPageId: string
  runId: string
  pageId: string
  pageHtmlPath: string
  layoutId: string
  layoutContractVersion: number
  imageModelConfigId: string
  parseResult: VisualIntentParseResult
  retryOfJobId?: string
  retryOfIntentIdBySlot?: Record<string, string>
  idempotencyKey?: string
  validateCandidateHtml?: (html: string) => string[]
  signal?: AbortSignal
  refineImageLayout?: ImageLayoutRefinement
}

export type ImageLayoutRefinement = (assets: Array<{
  slotId: string
  layoutSlotId: string
  relativePath: string
  role: string
  prompt: string
}>) => Promise<void>

export type AutomaticImageFinalizationResult = {
  status: 'none' | 'completed' | 'degraded' | 'cancelled'
  jobId?: string
  error?: string
  reused?: boolean
}

type StagedAsset = FinalizationAsset & {
  intent: ImageFulfillmentIntentRecord
  stagingPath: string
  finalPath: string
  mimeType: string
  width: number
  height: number
  prompt: string
}

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : String(error)

const isAbortError = (error: unknown): boolean => /abort|cancel/i.test(errorMessage(error))

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new Error('Image fulfillment cancelled')
}

const throwIfJobCancelled = async (db: FulfillmentDb, jobId: string): Promise<void> => {
  const job = await db.getImageFulfillmentJob(jobId)
  if (job?.cancel_requested_at) throw new Error('Image fulfillment cancelled')
}

const writeFileAtomically = async (targetPath: string, content: string): Promise<void> => {
  const tempPath = `${targetPath}.${crypto.randomUUID()}.tmp`
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
  try {
    await fs.promises.writeFile(tempPath, content, 'utf-8')
    await fs.promises.rename(tempPath, targetPath)
  } finally {
    await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
  }
}

const sanitizeExtension = (extension: string): string =>
  /^\.[a-z0-9]{2,5}$/i.test(extension) ? extension.toLowerCase() : '.png'

type ImageDimensions = { width: number; height: number }

const readPngDimensions = (bytes: Buffer): ImageDimensions | null => {
  if (
    bytes.length < 24 ||
    bytes.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0
  ) {
    return null
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  return width > 0 && height > 0 ? { width, height } : null
}

const readJpegDimensions = (bytes: Buffer): ImageDimensions | null => {
  if (bytes.length < 9 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 <= bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === undefined || marker === 0xd9 || marker === 0xda) return null
    if (offset + 2 > bytes.length) return null
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return null
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const height = bytes.readUInt16BE(offset + 3)
      const width = bytes.readUInt16BE(offset + 5)
      return width > 0 && height > 0 ? { width, height } : null
    }
    offset += length
  }
  return null
}

const readWebpDimensions = (bytes: Buffer): ImageDimensions | null => {
  if (
    bytes.length < 30 ||
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    return null
  }
  const chunk = bytes.subarray(12, 16).toString('ascii')
  if (chunk === 'VP8X') {
    const width = bytes.readUIntLE(24, 3) + 1
    const height = bytes.readUIntLE(27, 3) + 1
    return width > 0 && height > 0 ? { width, height } : null
  }
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    const width = bytes.readUInt16LE(26) & 0x3fff
    const height = bytes.readUInt16LE(28) & 0x3fff
    return width > 0 && height > 0 ? { width, height } : null
  }
  if (chunk === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return width > 0 && height > 0 ? { width, height } : null
  }
  return null
}

const resolveImageDimensions = (bytes: Buffer): ImageDimensions | null =>
  readPngDimensions(bytes) || readJpegDimensions(bytes) || readWebpDimensions(bytes)

const toImagePrompt = (intent: ParsedVisualIntent): string =>
  [
    intent.subject,
    intent.textZone ? `Preserve text zone: ${intent.textZone}.` : '',
    intent.subjectZone ? `Place subject in: ${intent.subjectZone}.` : '',
    intent.negativeSpace ? `Negative space: ${intent.negativeSpace}.` : '',
    intent.avoid.length > 0 ? `Avoid: ${intent.avoid.join(', ')}.` : ''
  ]
    .filter(Boolean)
    .join('\n')

const finalizationAssets = (assets: StagedAsset[]): FinalizationAsset[] =>
  assets.map((asset) => ({
    slotId: asset.slotId,
    layoutSlotId: asset.intent.layout_slot_id,
    layer: asset.intent.layer === 'background' ? 'background' : 'visual',
    relativePath: asset.relativePath
  }))

const fallbackHtml = async (pageHtmlPath: string, html: string): Promise<void> =>
  writeFileAtomically(pageHtmlPath, stripImageIntentDrafts(html))

const transitionAll = async (
  db: FulfillmentDb,
  intents: ImageFulfillmentIntentRecord[],
  status: 'fallback' | 'failed' | 'cancelled',
  error?: string
): Promise<void> => {
  await Promise.all(
    intents.map((intent) =>
      db.transitionImageFulfillmentIntent({
        intentId: intent.id,
        from: ['pending', 'generating', 'generated'],
        status,
        error: error || null
      })
    )
  )
}

const createJob = async (
  args: FinalizeAutomaticImageArgs,
  intents: ParsedVisualIntent[],
  invalidIntents = false
): Promise<{
  job: ImageFulfillmentJobRecord
  intents: ImageFulfillmentIntentRecord[]
  created: boolean
}> => {
  const modelConfig = await resolveConfiguredImageModel(
    { db: args.db, decryptApiKey: args.decryptApiKey },
    args.imageModelConfigId
  )
  const contentHash = crypto
    .createHash('sha256')
    .update(await fs.promises.readFile(args.pageHtmlPath, 'utf-8'))
    .digest('hex')
    .slice(0, 16)
  const created = await args.db.createImageFulfillmentJob({
    runId: args.runId,
    sessionId: args.sessionId,
    sessionPageId: args.sessionPageId,
    pageId: args.pageId,
    layoutId: args.layoutId,
    layoutContractVersion: args.layoutContractVersion,
    imageModelConfigId: modelConfig.id,
    imageProvider: modelConfig.provider,
    imageModel: getImageModelDisplayName(modelConfig),
    idempotencyKey:
      args.idempotencyKey ||
      `${args.runId}:${args.sessionPageId}:${contentHash}:${invalidIntents ? 'invalid' : 'valid'}`,
    retryOfJobId: args.retryOfJobId || null,
    intents: intents.map((intent, index) => ({
      slotId: intent.slotId || `invalid-${index + 1}`,
      layoutSlotId: intent.layoutSlotId || 'invalid',
      role: intent.role || 'invalid',
      layer: intent.layer || 'visual',
      requestVersion: args.layoutContractVersion,
      sizeHint: null,
      subject: intent.subject || 'Invalid automatic image request',
      textZone: intent.textZone || null,
      subjectZone: intent.subjectZone || null,
      negativeSpace: intent.negativeSpace || null,
      avoidJson: JSON.stringify(intent.avoid || []),
      requestJson: intent.requestJson || '{}',
      retryOfIntentId: args.retryOfIntentIdBySlot?.[intent.slotId] || null
    }))
  })
  return created
}

const createInvalidIntentAudit = (args: FinalizeAutomaticImageArgs): ParsedVisualIntent[] =>
  args.parseResult.invalidIntents.map((intent, index) => ({
    slotId: intent.slotId || `invalid-${index + 1}`,
    layoutSlotId: intent.layoutSlotId || 'invalid',
    role: 'spot-illustration',
    layer: 'visual',
    subject: 'Invalid automatic image request',
    avoid: [],
    requestJson: intent.requestJson || JSON.stringify({ errors: intent.errors })
  }))

const moveCommittedAssets = async (assets: StagedAsset[]): Promise<void> => {
  for (const asset of assets) {
    await fs.promises.mkdir(path.dirname(asset.finalPath), { recursive: true })
    await fs.promises.rename(asset.stagingPath, asset.finalPath)
  }
}

const restoreCommittedAssetsToStaging = async (assets: StagedAsset[]): Promise<boolean> => {
  const results = await Promise.allSettled(
    assets.map(async (asset) => {
      if (!fs.existsSync(asset.finalPath)) return
      await fs.promises.mkdir(path.dirname(asset.stagingPath), { recursive: true })
      await fs.promises.rename(asset.finalPath, asset.stagingPath)
    })
  )
  return results.every((result) => result.status === 'fulfilled')
}

/** Generates image assets in staging, then validates a scoped page-agent refinement of their slot placement. */
export const finalizeAutomaticImageIntents = async (
  args: FinalizeAutomaticImageArgs
): Promise<AutomaticImageFinalizationResult> => {
  const originalHtml = await fs.promises.readFile(args.pageHtmlPath, 'utf-8')
  if (args.parseResult.status === 'none') {
    log.info('[images:fulfillment] no image intents to fulfill', {
      sessionId: args.sessionId,
      runId: args.runId,
      pageId: args.pageId,
      layoutId: args.layoutId
    })
    return { status: 'none' }
  }

  if (args.parseResult.status !== 'valid') {
    if (args.parseResult.status === 'forbidden') {
      throw new Error(args.parseResult.errors.join('; ') || 'Image intent drafts are forbidden.')
    }
    const audit = await createJob(args, createInvalidIntentAudit(args), true)
    const error = args.parseResult.errors.join('; ') || 'Invalid image intent draft'
    log.warn('[images:fulfillment] invalid image intent draft', {
      sessionId: args.sessionId,
      runId: args.runId,
      pageId: args.pageId,
      jobId: audit.job.id,
      error
    })
    await fallbackHtml(args.pageHtmlPath, originalHtml)
    await transitionAll(args.db, audit.intents, 'failed', error)
    await args.db.transitionImageFulfillmentJob({
      jobId: audit.job.id,
      from: ['pending'],
      status: 'degraded',
      error
    })
    return { status: 'degraded', jobId: audit.job.id, error }
  }

  const created = await createJob(args, args.parseResult.intents)
  if (!created.job || !created.intents.length) return { status: 'none' }
  log.info('[images:fulfillment] job prepared', {
    sessionId: args.sessionId,
    runId: args.runId,
    pageId: args.pageId,
    jobId: created.job.id,
    created: created.created,
    layoutId: args.layoutId,
    intentCount: created.intents.length,
    imageModelConfigId: args.imageModelConfigId
  })
  if (!created.created) {
    const status =
      created.job.status === 'completed'
        ? 'completed'
        : created.job.status === 'cancelled'
          ? 'cancelled'
          : created.job.status === 'degraded' || created.job.status === 'failed'
            ? 'degraded'
            : 'none'
    log.info('[images:fulfillment] reusing existing job', {
      sessionId: args.sessionId,
      runId: args.runId,
      pageId: args.pageId,
      jobId: created.job.id,
      status
    })
    return { status, jobId: created.job.id, error: created.job.error || undefined, reused: true }
  }
  const projectDir = await args.resolveSessionProjectDir(args.sessionId)
  const stagingDir = path.join(projectDir, 'images', '.staging', created.job.id)
  const manifestPath = path.join(stagingDir, 'manifest.json')
  const manifestRelativePath = path.relative(projectDir, manifestPath)
  const leaseOwner = `image-fulfillment:${created.job.id}`
  const reservation = await args.coordinator.reserve({
    jobId: created.job.id,
    domain: 'image',
    owner: { kind: 'image-fulfillment', id: created.job.id },
    claims: { write: [imageHistoryLockKey(args.sessionId)] },
    wait: 'block',
    signal: args.signal
  })
  if (reservation.status === 'busy') {
    log.warn('[images:fulfillment] image generation lock is busy', {
      sessionId: args.sessionId,
      runId: args.runId,
      pageId: args.pageId,
      jobId: created.job.id
    })
    await fallbackHtml(args.pageHtmlPath, originalHtml)
    await transitionAll(args.db, created.intents, 'fallback', 'Image generation is busy')
    await args.db.transitionImageFulfillmentJob({
      jobId: created.job.id,
      from: ['pending'],
      status: 'degraded',
      error: 'Image generation is busy'
    })
    return { status: 'degraded', jobId: created.job.id, error: 'Image generation is busy' }
  }

  const lease = reservation.lease
  const stagedAssets: StagedAsset[] = []
  let jobInFinalizing = false
  let candidatePath = ''
  try {
    throwIfAborted(lease.signal)
    const claimed = await args.db.claimImageFulfillmentJob({
      jobId: created.job.id,
      leaseOwner,
      leaseDurationSec: LEASE_DURATION_SECONDS
    })
    if (!claimed) throw new Error('Image fulfillment job could not be claimed')
    const modelConfig = await resolveConfiguredImageModel(
      { db: args.db, decryptApiKey: args.decryptApiKey },
      args.imageModelConfigId
    )
    const adapter = resolveImageGenerationProvider(modelConfig.provider)
    const displayModel = getImageModelDisplayName(modelConfig)
    const imageSize = adapter.getDefaultSize(modelConfig)
    await fs.promises.mkdir(stagingDir, { recursive: true })

    const manifest = {
      version: 1,
      jobId: created.job.id,
      sessionId: args.sessionId,
      pageId: args.pageId,
      pageHtmlPath: args.pageHtmlPath,
      fallbackHtmlPath: path.join(stagingDir, 'fallback.html'),
      assets: [] as Array<{
        slotId: string
        stagingPath: string
        finalPath: string
        relativePath: string
        mimeType: string
        width: number
        height: number
      }>
    }
    // The recovery contract must exist before any provider output enters staging.
    await writeFileAtomically(manifest.fallbackHtmlPath, stripImageIntentDrafts(originalHtml))
    await writeFileAtomically(manifestPath, JSON.stringify(manifest, null, 2))
    const tracked = await args.db.transitionImageFulfillmentJob({
      jobId: created.job.id,
      from: ['running'],
      status: 'running',
      finalizationManifestPath: manifestRelativePath,
      imageProvider: modelConfig.provider,
      imageModel: displayModel,
      leaseOwner,
      leaseExpiresAt: Math.floor(Date.now() / 1000) + LEASE_DURATION_SECONDS
    })
    if (!tracked) throw new Error('Image fulfillment execution snapshot could not be persisted')

    for (let index = 0; index < args.parseResult.intents.length; index += 1) {
      throwIfAborted(lease.signal)
      await throwIfJobCancelled(args.db, created.job.id)
      const intent = created.intents[index]
      const request = args.parseResult.intents[index]
      if (!intent || !request) throw new Error('Image fulfillment intent is missing')
      await args.db.transitionImageFulfillmentIntent({
        intentId: intent.id,
        from: ['pending'],
        status: 'generating'
      })
      const prompt = toImagePrompt(request)
      log.info('[images:fulfillment] provider request', {
        sessionId: args.sessionId,
        runId: args.runId,
        pageId: args.pageId,
        jobId: created.job.id,
        slotId: request.slotId,
        layoutSlotId: request.layoutSlotId,
        provider: modelConfig.provider,
        model: displayModel,
        size: imageSize,
        count: 1,
        prompt
      })
      const results = await adapter.generate(modelConfig, {
        prompt,
        count: 1,
        size: imageSize,
        negativePrompt: request.avoid.join(', ') || undefined,
        signal: lease.signal
      })
      log.info('[images:fulfillment] provider response', {
        sessionId: args.sessionId,
        runId: args.runId,
        pageId: args.pageId,
        jobId: created.job.id,
        slotId: request.slotId,
        assetCount: results.length,
        firstAssetBytes: results[0]?.bytes.length || 0,
        firstAssetMimeType: results[0]?.mimeType || null
      })
      throwIfAborted(lease.signal)
      await throwIfJobCancelled(args.db, created.job.id)
      const generated = results[0]
      if (!generated) throw new Error(`Image provider returned no asset for ${request.slotId}`)
      const dimensions = resolveImageDimensions(generated.bytes)
      if (!dimensions) throw new Error(`Image provider returned an invalid image for ${request.slotId}`)
      const fileName = `generated-${args.pageId}-${nanoid(10)}${sanitizeExtension(generated.extension)}`
      const stagingPath = path.join(stagingDir, fileName)
      const finalPath = path.join(projectDir, 'images', fileName)
      await fs.promises.writeFile(stagingPath, generated.bytes)
      const staged: StagedAsset = {
        slotId: request.slotId,
        relativePath: `./images/${fileName}`,
        intent,
        stagingPath,
        finalPath,
        mimeType: generated.mimeType,
        width: dimensions.width,
        height: dimensions.height,
        prompt
      }
      stagedAssets.push(staged)
      await args.db.transitionImageFulfillmentIntent({
        intentId: intent.id,
        from: ['generating'],
        status: 'generated',
        assetPath: staged.relativePath,
        mimeType: staged.mimeType,
        width: staged.width,
        height: staged.height
      })
    }

    manifest.assets = stagedAssets.map((asset) => ({
        slotId: asset.slotId,
        stagingPath: asset.stagingPath,
        finalPath: asset.finalPath,
        relativePath: asset.relativePath,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height
      }))
    await writeFileAtomically(manifestPath, JSON.stringify(manifest, null, 2))
    const movedToFinalizing = await args.db.transitionImageFulfillmentJob({
      jobId: created.job.id,
      from: ['running'],
      status: 'finalizing',
      finalizationManifestPath: manifestRelativePath,
      leaseOwner,
      leaseExpiresAt:
        Math.floor(Date.now() / 1000) + FINALIZATION_LEASE_DURATION_SECONDS
    })
    if (!movedToFinalizing) throw new Error('Image fulfillment job could not enter finalization')
    jobInFinalizing = true
    lease.release()

    throwIfAborted(args.signal)
    await throwIfJobCancelled(args.db, created.job.id)
    const adoption = adoptFinalizedImageAssets(originalHtml, finalizationAssets(stagedAssets))
    const validateCandidate = (html: string) => {
      const validation = validateFinalizedImageHtml(html, finalizationAssets(stagedAssets))
      const contractErrors = args.validateCandidateHtml?.(html) || []
      return { validation, contractErrors }
    }
    const deterministicHtml = adoption.html
    let candidateHtml = deterministicHtml
    candidatePath = `${args.pageHtmlPath}.${created.job.id}.finalizing`
    await writeFileAtomically(candidatePath, candidateHtml)
    let candidateEvaluation = validateCandidate(candidateHtml)
    const deterministicCandidateValid =
      adoption.errors.length === 0 &&
      candidateEvaluation.validation.valid &&
      candidateEvaluation.validation.unusedSlotIds.length === 0 &&
      candidateEvaluation.contractErrors.length === 0

    if (args.refineImageLayout && deterministicCandidateValid) {
      // The page agent reads the image-bearing candidate but can only make local edit_file changes.
      await writeFileAtomically(args.pageHtmlPath, candidateHtml)
      try {
        await args.refineImageLayout(
          stagedAssets.map((asset) => ({
            slotId: asset.slotId,
            layoutSlotId: asset.intent.layout_slot_id,
            relativePath: asset.relativePath,
            role: asset.intent.role,
            prompt: asset.prompt
          }))
        )
        throwIfAborted(args.signal)
        await throwIfJobCancelled(args.db, created.job.id)
        const refinedHtml = await fs.promises.readFile(args.pageHtmlPath, 'utf-8')
        const refinedEvaluation = validateCandidate(refinedHtml)
        const refinedCandidateValid =
          refinedEvaluation.validation.valid &&
          refinedEvaluation.validation.unusedSlotIds.length === 0 &&
          refinedEvaluation.contractErrors.length === 0
        if (refinedCandidateValid) {
          candidateHtml = refinedHtml
          candidateEvaluation = refinedEvaluation
          await writeFileAtomically(candidatePath, candidateHtml)
        } else {
          const errors = [
            ...refinedEvaluation.validation.errors,
            ...refinedEvaluation.contractErrors
          ]
          log.warn('[images:fulfillment] refinement rejected; using deterministic candidate', {
            sessionId: args.sessionId,
            runId: args.runId,
            pageId: args.pageId,
            jobId: created.job.id,
            error: errors.join('; ') || 'Refinement did not retain the generated image layout'
          })
          await writeFileAtomically(args.pageHtmlPath, deterministicHtml)
        }
      } catch (error) {
        await throwIfJobCancelled(args.db, created.job.id)
        if (isAbortError(error) || args.signal?.aborted) throw error
        log.warn('[images:fulfillment] refinement failed; using deterministic candidate', {
          sessionId: args.sessionId,
          runId: args.runId,
          pageId: args.pageId,
          jobId: created.job.id,
          error: errorMessage(error)
        })
        await writeFileAtomically(args.pageHtmlPath, deterministicHtml)
      }
    }
    const { validation, contractErrors } = candidateEvaluation
    if (
      adoption.errors.length > 0 ||
      !validation.valid ||
      validation.unusedSlotIds.length > 0 ||
      contractErrors.length > 0
    ) {
      await fs.promises.rm(candidatePath, { force: true }).catch(() => undefined)
      await fallbackHtml(args.pageHtmlPath, originalHtml)
      const error =
        [...adoption.errors, ...validation.errors, ...contractErrors].join('; ') ||
        'Generated images were not adopted by the final layout'
      await Promise.all(
        created.intents.map((intent) =>
          args.db.transitionImageFulfillmentIntent({
            intentId: intent.id,
            from: ['generated'],
            status: validation.unusedSlotIds.includes(intent.slot_id)
              ? 'layout_failed'
              : 'fallback',
            error
          })
        )
      )
      await args.db.transitionImageFulfillmentJob({
        jobId: created.job.id,
        from: ['finalizing'],
        status: 'degraded',
        error
      })
      await fs.promises.rm(stagingDir, { recursive: true, force: true })
      log.warn('[images:fulfillment] final layout rejected generated images', {
        sessionId: args.sessionId,
        runId: args.runId,
        pageId: args.pageId,
        jobId: created.job.id,
        error
      })
      return { status: 'degraded', jobId: created.job.id, error }
    }

    const commitReservation = await args.coordinator.reserve({
      jobId: `${created.job.id}:commit`,
      domain: 'image',
      owner: { kind: 'image-fulfillment', id: `${created.job.id}:commit` },
      claims: { write: [imageHistoryLockKey(args.sessionId)] },
      wait: 'block',
      signal: args.signal
    })
    if (commitReservation.status === 'busy') throw new Error('Image finalization commit is busy')
    try {
      throwIfAborted(commitReservation.lease.signal)
      await throwIfJobCancelled(args.db, created.job.id)
      await moveCommittedAssets(stagedAssets)
      throwIfAborted(commitReservation.lease.signal)
      await throwIfJobCancelled(args.db, created.job.id)
      allowLocalAssetRoot(path.join(projectDir, 'images'))
      await fs.promises.rename(candidatePath, args.pageHtmlPath)
      throwIfAborted(commitReservation.lease.signal)
      await throwIfJobCancelled(args.db, created.job.id)
      const completed = await args.db.completeImageFulfillmentJob({
        jobId: created.job.id,
        sessionId: args.sessionId,
        pageId: args.pageId,
        modelConfigId: args.imageModelConfigId,
        provider: modelConfig.provider,
        model: displayModel,
        assets: stagedAssets.map((asset) => ({
          intentId: asset.intent.id,
          prompt: asset.prompt,
          assetPath: asset.relativePath,
          mimeType: asset.mimeType,
          width: asset.width,
          height: asset.height
        }))
      })
      if (!completed) throw new Error('Image fulfillment was cancelled before completion')
    } finally {
      commitReservation.lease.release()
    }
    await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch((cleanupError) => {
      // Completion is already durable in SQLite and the page points only at final assets.
      // Preserve the private staging directory for startup cleanup instead of undoing the commit.
      console.warn('[image:fulfillment] completed job staging cleanup failed', {
        jobId: created.job.id,
        message: errorMessage(cleanupError)
      })
    })
    log.info('[images:fulfillment] completed', {
      sessionId: args.sessionId,
      runId: args.runId,
      pageId: args.pageId,
      jobId: created.job.id,
      assetCount: stagedAssets.length,
      assets: stagedAssets.map((asset) => asset.relativePath)
    })
    return { status: 'completed', jobId: created.job.id }
  } catch (error) {
    const message = errorMessage(error)
    const cancelled = isAbortError(error) || args.signal?.aborted === true || lease.signal.aborted
    const restoredAssets = await restoreCommittedAssetsToStaging(stagedAssets)
    if (candidatePath) await fs.promises.rm(candidatePath, { force: true }).catch(() => undefined)
    await fallbackHtml(args.pageHtmlPath, originalHtml)
    await transitionAll(args.db, created.intents, cancelled ? 'cancelled' : 'fallback', message)
    await args.db.transitionImageFulfillmentJob({
      jobId: created.job.id,
      from: jobInFinalizing ? ['finalizing'] : ['pending', 'running'],
      status: cancelled ? 'cancelled' : 'degraded',
      error: message
    })
    if (!jobInFinalizing || restoredAssets) {
      await fs.promises.rm(stagingDir, { recursive: true, force: true }).catch(() => undefined)
    }
    log.warn('[images:fulfillment] failed', {
      sessionId: args.sessionId,
      runId: args.runId,
      pageId: args.pageId,
      jobId: created.job.id,
      cancelled,
      error: message
    })
    return { status: cancelled ? 'cancelled' : 'degraded', jobId: created.job.id, error: message }
  } finally {
    lease.release()
  }
}
