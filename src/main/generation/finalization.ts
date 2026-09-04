import log from 'electron-log/main.js'
import path from 'path'
import { customAlphabet, nanoid } from 'nanoid'
import type { GenerationContext } from './context'
import type { FinalizeContext, FinalizeGenerationArgs } from './types'
import type { SessionPageRecord } from '../db/database'
import { isCancellationMessage, normalizeRestoredSessionStatus } from './status-utils'

const pageSlugId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)

const assertNotCancelled = (context: FinalizeContext): void => {
  if (context.abortSignal?.aborted) throw new Error('生成已取消')
}

export const resolveGenerationFailureSessionStatus = (
  context: FinalizeContext,
  cancelled: boolean
): 'active' | 'completed' | 'failed' | 'archived' => {
  if (cancelled) return normalizeRestoredSessionStatus(context.previousSessionStatus)
  if (
    (context.effectiveMode === 'edit' ||
      context.effectiveMode === 'retry' ||
      context.effectiveMode === 'addPage' ||
      context.effectiveMode === 'retrySinglePage') &&
    context.previousSessionStatus !== 'active'
  ) {
    return normalizeRestoredSessionStatus(context.previousSessionStatus)
  }
  return 'failed'
}

const syncGeneratedPagesToSessionPages = async (
  ctx: GenerationContext,
  args: {
    sessionId: string
    runId: string
    generatedPages: Array<{
      id?: string
      pageNumber: number
      title: string
      pageId?: string
      htmlPath?: string
      layoutIntent?: string | null
      layoutId?: string | null
      layoutContractVersion?: number | null
    }>
  }
): Promise<void> => {
  const existingPages = await ctx.db.listSessionPages(args.sessionId, { includeDeleted: true })
  const generationPages = await ctx.db.listGenerationPages(args.runId)
  const generationPageById = new Map(generationPages.map((page) => [page.page_id, page]))
  const existingBySlug = new Map<string, SessionPageRecord>()
  for (const row of existingPages) {
    existingBySlug.set(row.file_slug, row)
    if (row.legacy_page_id) existingBySlug.set(row.legacy_page_id, row)
  }

  for (const page of args.generatedPages) {
    const fileSlug = page.pageId || `page-${pageSlugId()}`
    const existing = existingBySlug.get(fileSlug)
    const generationPage = generationPageById.get(fileSlug)
    await ctx.db.upsertSessionPage({
      id: page.id || existing?.id || nanoid(),
      sessionId: args.sessionId,
      legacyPageId: existing?.legacy_page_id || (fileSlug.match(/^page-\d+$/) ? fileSlug : null),
      fileSlug,
      pageNumber: page.pageNumber,
      title: page.title || `第 ${page.pageNumber} 页`,
      htmlPath: page.htmlPath || '',
      layoutIntent:
        page.layoutIntent ?? generationPage?.layout_intent ?? existing?.layout_intent ?? null,
      layoutId: page.layoutId ?? generationPage?.layout_id ?? existing?.layout_id ?? null,
      layoutContractVersion:
        page.layoutContractVersion ??
        generationPage?.layout_contract_version ??
        existing?.layout_contract_version ??
        null,
      status: 'completed',
      error: null
    })
  }
}

export async function finalizeGenerationSuccess(
  ctx: GenerationContext,
  args: FinalizeGenerationArgs
): Promise<void> {
  const { db } = ctx
  const { context, indexPath, totalPages, generatedPages } = args
  const contextWithPrompt = context as FinalizeContext & { userMessage?: unknown }
  assertNotCancelled(context)
  await syncGeneratedPagesToSessionPages(ctx, {
    sessionId: context.sessionId,
    runId: context.runId,
    generatedPages
  })
  assertNotCancelled(context)
  await db.updateSessionMetadata(context.sessionId, {
    lastRunId: context.runId,
    entryMode: 'multi_page',
    indexPath,
    projectId: context.projectId
  })
  assertNotCancelled(context)
  if (args.designContract) {
    await db.updateSessionDesignContract(context.sessionId, args.designContract)
  }
  assertNotCancelled(context)
  await db.updateProjectStatus(context.projectId, 'draft')
  assertNotCancelled(context)
  await db.updateSessionStatus(context.sessionId, 'completed')
  assertNotCancelled(context)
  await ctx.history.recordOperation({
    sessionId: context.sessionId,
    projectDir: path.dirname(indexPath),
    type:
      context.effectiveMode === 'addPage'
        ? 'addPage'
        : context.effectiveMode === 'retry'
          ? 'retry'
          : context.effectiveMode === 'retrySinglePage'
            ? 'retry'
            : 'generate',
    scope: context.effectiveMode === 'retrySinglePage' ? 'page' : 'session',
    prompt: typeof contextWithPrompt.userMessage === 'string' ? contextWithPrompt.userMessage : null,
    metadata: {
      runId: context.runId,
      effectiveMode: context.effectiveMode,
      totalPages
    }
  })
  assertNotCancelled(context)
  await db.updateGenerationRunStatus(context.runId, 'completed', null)
  assertNotCancelled(context)
  log.info('[generate:start] completed', {
    sessionId: context.sessionId,
    styleId: context.styleId,
    totalPages
  })
  ctx.runtimeEmitters.emitGenerateChunk(context.sessionId, {
    type: 'run_completed',
    payload: {
      runId: context.runId,
      totalPages
    }
  })
}

export async function finalizeGenerationFailure(
  ctx: GenerationContext,
  context: FinalizeContext,
  error: unknown
): Promise<void> {
  const { db } = ctx
  const message =
    error instanceof Error && error.message.length > 0 ? error.message : 'Generation failed'
  const cancelled = isCancellationMessage(message)
  log.error('[generate:start] failed', {
    sessionId: context.sessionId,
    styleId: context.styleId,
    message
  })
  const generationRun = await db.getGenerationRun(context.runId)
  if (generationRun && (generationRun.status === 'running' || generationRun.status === 'completed')) {
    await db.updateGenerationRunStatus(context.runId, 'failed', message)
  }
  if (context.effectiveMode === 'addPage' && context.targetPageId) {
    const targetPage = (await db.listSessionPages(context.sessionId)).find(
      (page) => page.id === context.targetPageId || page.file_slug === context.targetPageId
    )
    if (targetPage) {
      await db.upsertSessionPage({
        id: targetPage.id,
        sessionId: targetPage.session_id,
        legacyPageId: targetPage.legacy_page_id,
        fileSlug: targetPage.file_slug,
        pageNumber: targetPage.page_number,
        title: targetPage.title,
        htmlPath: targetPage.html_path,
        status: 'failed',
        error: message
      })
    }
  }
  await db.updateSessionStatus(
    context.sessionId,
    resolveGenerationFailureSessionStatus(context, cancelled)
  )
  await db.addMessage(context.sessionId, {
    role: 'system',
    content: message,
    type: 'stream_chunk',
    chat_scope: context.messageScope,
    page_id: context.messagePageId,
    run_model: context.runModel
  })
  ctx.runtimeEmitters.emitGenerateChunk(context.sessionId, {
    type: 'run_error',
    payload: { runId: context.runId, message, cancelled }
  })
}
