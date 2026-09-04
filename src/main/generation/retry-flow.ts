import type { EmitAssistantFn, RetryContext } from './types'
import { resolvePageHtmlPath, uiText } from './generation-utils'
import { finalizeGenerationSuccess } from './finalization'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import { normalizeLayoutIntent, type LayoutIntent } from '@shared/layout-intent'
import { validatePersistedPageHtml } from '../presentation/html/html-utils'
import { buildDesignContractWithLLM, runDeepAgentDeckGeneration } from './agent-runner'
import {
  type DesignContract,
  resolveInheritedAnimationPreferences,
  type AnimationPreferencesPayload,
  type GeneratedPagePayload
} from '@shared/generation'
import { nanoid } from 'nanoid'
import {
  buildRetryUserMessage,
  buildTotalPages,
  type GenerationContext,
  type RuntimeJobExecutionContext,
  normalizeGeneratePayload,
  resolveCommonContext,
  resolveSessionReferenceDocumentPath,
  resolveSourceDocuments
} from './context'
import { createPageImageFinalizer } from './page-image-finalizer'

export async function resolveRetryContext(
  ctx: GenerationContext,
  _event: Electron.IpcMainInvokeEvent,
  payload: unknown,
  execution?: RuntimeJobExecutionContext
): Promise<RetryContext> {
  const input = normalizeGeneratePayload(payload)
  if (!input.sessionId) throw new Error('sessionId 不能为空')

  const common = await resolveCommonContext(ctx, input.sessionId, input.modelConfigId, execution)
  const userMessage = buildRetryUserMessage(input.rawUserMessage)
  let animationPreferences: AnimationPreferencesPayload | null = null
  if (input.failedRunId) {
    const sourceRun = await ctx.db.getGenerationRun(input.failedRunId)
    animationPreferences = resolveInheritedAnimationPreferences(sourceRun, input.sessionId)
  }
  const sourceDocumentPaths = await resolveSourceDocuments(ctx, {
    sessionId: input.sessionId,
    projectDir: common.projectDir,
    rawDocPaths: input.rawDocPaths,
    mode: 'retry',
    sessionRecord: common.sessionRecord
  })
  const referenceDocumentPath =
    resolveSessionReferenceDocumentPath(common.projectDir, common.sessionRecord) ?? undefined

  return {
    sessionId: input.sessionId,
    userMessage,
    requestedType: 'deck',
    effectiveMode: 'retry',
    selectedPageId: undefined,
    selectPageIds: [],
    htmlPath: undefined,
    selector: undefined,
    elementTag: undefined,
    elementText: undefined,
    sourceRunId: input.failedRunId,
    session: common.session,
    sessionRecord: common.sessionRecord,
    previousSessionStatus: common.previousSessionStatus,
    projectDir: common.projectDir,
    abortSignal: common.abortSignal,
    runId: common.runId,
    styleId: common.styleId,
    styleSkill: common.styleSkill,
    imageGenerationPrompt: common.imageGenerationPrompt,
    styleKey: common.styleKey,
    styleName: common.styleName,
    styleVersion: common.styleVersion,
    slideSize: common.slideSize,
    userProvidedOutlineTitles: [],
    totalPages: buildTotalPages(common.sessionRecord),
    provider: common.provider,
    apiKey: common.apiKey,
    model: common.model,
    modelConfigId: common.modelConfigId,
    modelConfigName: common.modelConfigName,
    runModel: common.runModel,
    modelTimeouts: common.modelTimeouts,
    providerBaseUrl: common.providerBaseUrl,
    maxTokens: common.maxTokens,
    modelRuntime: common.modelRuntime,
    projectId: common.projectId,
    messageScope: 'main',
    messagePageId: undefined,
    imagePaths: [],
    videoPaths: [],
    sourceDocumentPaths,
    referenceDocumentPath,
    sourcePlan: common.sourcePlan,
    topic: common.topic,
    deckTitle: common.deckTitle,
    appLocale: common.appLocale,
    fontSelection: common.fontSelection,
    animationPreferences,
    visualEnabled: common.visualEnabled,
    imageModelConfigId: common.imageModelConfigId
  }
}

export async function executeRetryFailedPages(
  ctx: GenerationContext,
  emitAssistant: EmitAssistantFn,
  context: RetryContext
): Promise<void> {
  const {
    db,
    agentManager,
    runtimeEmitters: { createDeckProgressEmitter },
    sessionProject: { getPageSourceUrl },
    tuning: {
      designContractTemperature: DESIGN_CONTRACT_TEMPERATURE,
      pageGenerationTemperature: PAGE_GENERATION_TEMPERATURE
    }
  } = ctx

  if (!context.apiKey) {
    throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
  }

  const indexPath = path.join(context.projectDir, 'index.html')
  const emitRetryChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)
  let savedDesignContract: DesignContract | undefined
  const sessionRecord = (context.session || {}) as Record<string, unknown>
  const sessionPages = await db.listSessionPages(context.sessionId)
  if (sessionPages.length === 0) {
    throw new Error('session_pages is empty after migration; cannot retry this session')
  }
  await ctx.history.ensureBaseline(context.sessionId, context.projectDir)
  const latestPageSnapshot = await db.listLatestGenerationPageSnapshot(context.sessionId)
  const failedSessionPages = sessionPages.filter((page) => page.status !== 'completed')
  const retryRecords = failedSessionPages.map((page) => {
    const snapshot = latestPageSnapshot.find((item) => item.page_id === page.file_slug)
    return {
      page_number: page.page_number,
      page_id: page.file_slug,
      title: page.title || snapshot?.title || page.file_slug,
      content_outline: snapshot?.content_outline || '',
      layout_intent: page.layout_intent || snapshot?.layout_intent || null,
      layout_id: page.layout_id || snapshot?.layout_id || null,
      layout_contract_version:
        page.layout_contract_version ?? snapshot?.layout_contract_version ?? null,
      html_path: resolvePageHtmlPath({
        projectDir: context.projectDir,
        fileSlug: page.file_slug,
        candidates: [page.html_path, snapshot?.html_path]
      }),
      retry_count: snapshot?.retry_count || 0,
      status: page.status,
      error: page.error
    }
  })
  const completedSessionPageCount = sessionPages.filter(
    (page) => page.status === 'completed'
  ).length
  if (retryRecords.length === 0) {
    throw new Error('当前会话没有可继续生成的页面。')
  }
  if (completedSessionPageCount === 0) {
    throw new Error('当前没有成功页面可保留，请使用完整重新生成。')
  }
  if (
    typeof sessionRecord.designContract === 'string' &&
    sessionRecord.designContract.trim().length > 0
  ) {
    try {
      savedDesignContract = JSON.parse(sessionRecord.designContract) as DesignContract
    } catch {
      // ignore malformed design contract and rebuild below
    }
  }
  const designContract =
    savedDesignContract ||
    (await buildDesignContractWithLLM({
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      maxTokens: context.maxTokens,
      modelRuntime: context.modelRuntime,
      modelTimeoutMs: context.modelTimeouts.design,
      temperature: DESIGN_CONTRACT_TEMPERATURE,
      styleId: context.styleId,
      styleSkillPrompt: context.styleSkill.prompt,
      styleKey: context.styleKey,
      styleName: context.styleName,
      styleVersion: context.styleVersion,
      appLocale: context.appLocale,
      totalPages: sessionPages.length,
      slideSize: context.slideSize,
      topic: context.topic,
      userMessage: context.userMessage,
      fontSelection: context.fontSelection,
      emit: (chunk) => emitRetryChunk(chunk),
      runId: context.runId,
      signal: context.abortSignal
    }))

  const retryPages = retryRecords.map((page) => ({
    pageNumber: page.page_number,
    pageId: page.page_id,
    title: page.title || page.page_id,
    contentOutline: page.content_outline || '',
    layoutIntent: page.layout_intent ? normalizeLayoutIntent(page.layout_intent) : undefined,
    layoutId: page.layout_id,
    layoutContractVersion: page.layout_contract_version,
    htmlPath: resolvePageHtmlPath({
      projectDir: context.projectDir,
      fileSlug: page.page_id,
      candidates: [page.html_path]
    }),
    retryCount: page.retry_count + 1
  }))
  const pageFileMap = Object.fromEntries(retryPages.map((page) => [page.pageId, page.htmlPath]))
  const pageNumbers = Object.fromEntries(retryPages.map((page) => [page.pageId, page.pageNumber]))
  const existingSessionPages = await db.listSessionPages(context.sessionId, {
    includeDeleted: true
  })
  const existingSessionPageBySlug = new Map(
    existingSessionPages.map((page) => [page.file_slug, page])
  )
  const upsertRetrySessionPage = async (
    page: {
      pageNumber: number
      pageId: string
      title: string
      htmlPath: string
      layoutIntent?: LayoutIntent
      layoutId?: string | null
      layoutContractVersion?: number | null
    },
    status: 'completed' | 'failed' | 'pending',
    error: string | null
  ): Promise<void> => {
    const existing = existingSessionPageBySlug.get(page.pageId)
    const id = existing?.id || nanoid()
    await db.upsertSessionPage({
      id,
      sessionId: context.sessionId,
      legacyPageId:
        existing?.legacy_page_id || (page.pageId.match(/^page-\d+$/) ? page.pageId : null),
      fileSlug: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      htmlPath: page.htmlPath,
      layoutIntent: page.layoutIntent ?? existing?.layout_intent ?? null,
      layoutId: page.layoutId ?? existing?.layout_id ?? null,
      layoutContractVersion:
        page.layoutContractVersion ?? existing?.layout_contract_version ?? null,
      status,
      error
    })
    existingSessionPageBySlug.set(page.pageId, {
      id,
      session_id: context.sessionId,
      legacy_page_id:
        existing?.legacy_page_id || (page.pageId.match(/^page-\d+$/) ? page.pageId : null),
      file_slug: page.pageId,
      page_number: page.pageNumber,
      title: page.title,
      html_path: page.htmlPath,
      layout_intent: page.layoutIntent ?? existing?.layout_intent ?? null,
      layout_id: page.layoutId ?? existing?.layout_id ?? null,
      layout_contract_version:
        page.layoutContractVersion ?? existing?.layout_contract_version ?? null,
      status,
      error,
      created_at: existing?.created_at || Math.floor(Date.now() / 1000),
      updated_at: Math.floor(Date.now() / 1000),
      deleted_at: null
    })
  }

  await db.createGenerationRun({
    id: context.runId,
    sessionId: context.sessionId,
    mode: 'retry',
    totalPages: retryPages.length,
    modelConfigId: context.modelConfigId,
    animationPreferences: context.animationPreferences,
    metadata: {
      retryOnly: true,
      source: 'session_pages',
      pageIds: retryPages.map((page) => page.pageId),
      inheritedAnimationPreferencesFromRunId: context.animationPreferences
        ? context.sourceRunId || null
        : null,
      modelConfigId: context.modelConfigId,
      modelConfigName: context.modelConfigName,
      provider: context.provider,
      model: context.model
    }
  })
  for (const page of retryPages) {
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent,
      layoutId: page.layoutId,
      layoutContractVersion: page.layoutContractVersion,
      htmlPath: page.htmlPath,
      status: 'pending',
      retryCount: page.retryCount
    })
  }

  emitRetryChunk({
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'rendering',
      label: uiText(
        context.appLocale,
        `正在重新生成 ${retryPages.length} 个失败页面`,
        `Regenerating ${retryPages.length} failed pages`
      ),
      progress: 8,
      totalPages: retryPages.length
    }
  })
  const persistedRetryCompletedPageIds = new Set<string>()
  const persistedRetryFailedPageIds = new Set<string>()

  const persistCompletedRetryPage = async (page: {
    pageNumber: number
    pageId: string
    title: string
    contentOutline: string
    layoutIntent?: LayoutIntent
    layoutId: string
    layoutContractVersion: number
    htmlPath: string
  }): Promise<void> => {
    if (!fs.existsSync(page.htmlPath)) {
      throw new Error(`${page.pageId}.html 缺失`)
    }
    const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
    const validation = validatePersistedPageHtml(html, page.pageId)
    if (!validation.valid) {
      throw new Error(`HTML 验证失败 (${page.pageId}): ${validation.errors.join('; ')}`)
    }
    const retryPage = retryPages.find((item) => item.pageId === page.pageId)
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent,
      layoutId: page.layoutId,
      layoutContractVersion: page.layoutContractVersion,
      htmlPath: page.htmlPath,
      status: 'completed',
      retryCount: retryPage?.retryCount || 0
    })
    await upsertRetrySessionPage(page, 'completed', null)
    persistedRetryFailedPageIds.delete(page.pageId)
    persistedRetryCompletedPageIds.add(page.pageId)
    const existingSessionPage = existingSessionPageBySlug.get(page.pageId)
    const payload: GeneratedPagePayload = {
      id: existingSessionPage?.id,
      pageNumber: page.pageNumber,
      title: page.title,
      html,
      pageId: page.pageId,
      htmlPath: page.htmlPath,
      sourceUrl: getPageSourceUrl(page.htmlPath)
    }
    emitRetryChunk({
      type: 'page_updated',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'completed'),
        progress: 90,
        currentPage: page.pageNumber,
        totalPages: retryPages.length,
        ...payload
      }
    })
  }
  const persistFailedRetryPage = async (page: {
    pageNumber: number
    pageId: string
    title: string
    contentOutline: string
    layoutIntent?: LayoutIntent
    layoutId: string
    layoutContractVersion: number
    htmlPath: string
    reason: string
  }): Promise<void> => {
    const retryPage = retryPages.find((item) => item.pageId === page.pageId)
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent,
      layoutId: page.layoutId,
      layoutContractVersion: page.layoutContractVersion,
      htmlPath: page.htmlPath,
      status: 'failed',
      error: page.reason,
      retryCount: retryPage?.retryCount || 0
    })
    await upsertRetrySessionPage(page, 'failed', page.reason)
    persistedRetryCompletedPageIds.delete(page.pageId)
    persistedRetryFailedPageIds.add(page.pageId)
  }

  const { summary: agentSummary, failedPages } = await runDeepAgentDeckGeneration({
    renderingLabel: uiText(
      context.appLocale,
      `正在重新生成 ${retryPages.length} 个失败页面`,
      `Regenerating ${retryPages.length} failed pages`
    ),
    sessionId: context.sessionId,
    provider: context.provider,
    apiKey: context.apiKey,
    model: context.model,
    baseUrl: context.providerBaseUrl,
    maxTokens: context.maxTokens,
    modelTimeoutMs: context.modelTimeouts.agent,
    temperature: PAGE_GENERATION_TEMPERATURE,
    styleId: context.styleId,
    styleSkillPrompt: context.styleSkill.prompt,
    hasStyleImageDirection: Boolean(context.imageGenerationPrompt.trim()),
    styleKey: context.styleKey,
    styleName: context.styleName,
    styleVersion: context.styleVersion,
    slideSize: context.slideSize,
    appLocale: context.appLocale,
    animationPreferences: context.animationPreferences,
    topic: context.topic,
    deckTitle: context.deckTitle,
    userMessage:
      context.userMessage ||
      [
        '继续生成本会话中未完成的页面。页面正文、标题、图表标签必须保持与现有页面相同语言。',
        'Continue generating the unfinished slides in this session. Keep slide text, titles, and chart labels in the same language as existing slides.',
        'Determine the content language from the existing topic, outline, source materials, and existing slides; do not infer it from this instruction.'
      ].join('\n'),
    outlineTitles: retryPages.map((page) => page.title),
    outlineItems: retryPages.map((page) => ({
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent
    })),
    sourceDocumentPaths: context.sourceDocumentPaths,
    referenceDocumentPath: context.referenceDocumentPath,
    sourcePlan: context.sourcePlan,
    generationMode: 'retry',
    visualEnabled: context.visualEnabled,
    pageTasks: retryPages.map((page) => ({
      pageNumber: page.pageNumber,
      pageId: page.pageId,
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent,
      layoutId: page.layoutId,
      layoutContractVersion: page.layoutContractVersion
    })),
    designContract,
    projectDir: context.projectDir,
    indexPath,
    pageFileMap,
    pageNumbers,
    agentManager,
    emit: (chunk) => emitRetryChunk(chunk),
    finalizePage: createPageImageFinalizer(ctx, {
      sessionId: context.sessionId,
      runId: context.runId,
      visualEnabled: context.visualEnabled,
      imageModelConfigId: context.imageModelConfigId,
      imageGenerationPrompt: context.imageGenerationPrompt,
      imagePromptDirector: {
        provider: context.provider,
        apiKey: context.apiKey,
        model: context.model,
        baseUrl: context.providerBaseUrl,
        maxTokens: context.maxTokens,
        modelRuntime: context.modelRuntime,
        modelTimeoutMs: context.modelTimeouts.agent,
        locale: context.appLocale
      },
      abortSignal: context.abortSignal
    }),
    onPageCompleted: persistCompletedRetryPage,
    onPageFailed: persistFailedRetryPage,
    runId: context.runId,
    signal: context.abortSignal
  })

  const failedPageIdSet = new Set(failedPages.map((page) => page.pageId))
  const retrySuccessPages: Array<{
    pageNumber: number
    title: string
    pageId: string
    htmlPath: string
    html: string
  }> = []
  const retryFailures = [...failedPages]
  for (const page of retryPages) {
    if (failedPageIdSet.has(page.pageId)) {
      const failure = failedPages.find((item) => item.pageId === page.pageId)
      if (!persistedRetryFailedPageIds.has(page.pageId)) {
        await db.upsertGenerationPage({
          runId: context.runId,
          sessionId: context.sessionId,
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title,
          contentOutline: page.contentOutline,
          layoutIntent: page.layoutIntent,
          layoutId: page.layoutId,
          layoutContractVersion: page.layoutContractVersion,
          htmlPath: page.htmlPath,
          status: 'failed',
          error: failure?.reason || '页面重试失败',
          retryCount: page.retryCount
        })
        await upsertRetrySessionPage(page, 'failed', failure?.reason || '页面重试失败')
        persistedRetryFailedPageIds.add(page.pageId)
      }
      continue
    }
    if (!fs.existsSync(page.htmlPath)) {
      const reason = `${page.pageId}.html 缺失`
      retryFailures.push({ pageId: page.pageId, title: page.title, reason })
      if (!persistedRetryFailedPageIds.has(page.pageId)) {
        await db.upsertGenerationPage({
          runId: context.runId,
          sessionId: context.sessionId,
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title,
          contentOutline: page.contentOutline,
          layoutIntent: page.layoutIntent,
          layoutId: page.layoutId,
          layoutContractVersion: page.layoutContractVersion,
          htmlPath: page.htmlPath,
          status: 'failed',
          error: reason,
          retryCount: page.retryCount
        })
        await upsertRetrySessionPage(page, 'failed', reason)
        persistedRetryFailedPageIds.add(page.pageId)
      }
      continue
    }
    const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
    const validation = validatePersistedPageHtml(html, page.pageId)
    if (!validation.valid) {
      const reason = validation.errors.join('; ')
      retryFailures.push({ pageId: page.pageId, title: page.title, reason })
      if (!persistedRetryFailedPageIds.has(page.pageId)) {
        await db.upsertGenerationPage({
          runId: context.runId,
          sessionId: context.sessionId,
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title,
          contentOutline: page.contentOutline,
          layoutIntent: page.layoutIntent,
          layoutId: page.layoutId,
          layoutContractVersion: page.layoutContractVersion,
          htmlPath: page.htmlPath,
          status: 'failed',
          error: reason,
          retryCount: page.retryCount
        })
        await upsertRetrySessionPage(page, 'failed', reason)
        persistedRetryFailedPageIds.add(page.pageId)
      }
      continue
    }
    retrySuccessPages.push({
      pageNumber: page.pageNumber,
      title: page.title,
      pageId: page.pageId,
      htmlPath: page.htmlPath,
      html
    })
    if (!persistedRetryCompletedPageIds.has(page.pageId)) {
      await db.upsertGenerationPage({
        runId: context.runId,
        sessionId: context.sessionId,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: page.contentOutline,
        layoutIntent: page.layoutIntent,
        layoutId: page.layoutId,
        layoutContractVersion: page.layoutContractVersion,
        htmlPath: page.htmlPath,
        status: 'completed',
        retryCount: page.retryCount
      })
      await upsertRetrySessionPage(page, 'completed', null)
      persistedRetryCompletedPageIds.add(page.pageId)
    }
  }

  const retryPageIdSet = new Set(retryPages.map((page) => page.pageId))
  let previousGeneratedPages: Array<{
    pageNumber: number
    title: string
    pageId: string
    htmlPath: string
    html: string
  }> = []
  const restoredPages = await Promise.all(
    sessionPages
      .filter((page) => page.status === 'completed' && !retryPageIdSet.has(page.file_slug))
      .map(async (page) => {
        const htmlPath = resolvePageHtmlPath({
          projectDir: context.projectDir,
          fileSlug: page.file_slug,
          candidates: [page.html_path]
        })
        const html = fs.existsSync(htmlPath) ? await fs.promises.readFile(htmlPath, 'utf-8') : ''
        if (!html.trim()) return null
        return {
          pageNumber: page.page_number,
          title: page.title,
          pageId: page.file_slug,
          htmlPath,
          html
        }
      })
  )
  previousGeneratedPages = restoredPages.filter(
    (
      page
    ): page is {
      pageNumber: number
      title: string
      pageId: string
      htmlPath: string
      html: string
    } => Boolean(page)
  )
  const mergedGeneratedPages = [...previousGeneratedPages, ...retrySuccessPages].sort(
    (a, b) => a.pageNumber - b.pageNumber
  )

  await db.updateSessionMetadata(context.sessionId, {
    lastRunId: context.runId,
    entryMode: 'multi_page',
    indexPath,
    projectId: context.projectId
  })
  await db.updateSessionDesignContract(context.sessionId, designContract)
  await db.updateProjectStatus(context.projectId, 'draft')

  if (retryFailures.length > 0) {
    const failedDetails = retryFailures
      .map((item) => `${item.pageId}（${item.title}）：${item.reason}`)
      .join('；')
    await db.updateGenerationRunStatus(
      context.runId,
      retrySuccessPages.length > 0 ? 'partial' : 'failed',
      failedDetails
    )
    emitRetryChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'failed'),
        progress: 90,
        totalPages: retryPages.length,
        detail: failedDetails
      }
    })
    throw new Error(
      `重试后仍有页面失败（${retryFailures.length}/${retryPages.length}）：${retryFailures
        .map((item) => `${item.pageId}(${item.title})`)
        .join(', ')}`
    )
  }

  if (mergedGeneratedPages.length < sessionPages.length) {
    const message = uiText(
      context.appLocale,
      `重试页面已完成，但当前只恢复 ${mergedGeneratedPages.length}/${sessionPages.length} 页，请继续重试或重新生成。`,
      `Retry completed, but only ${mergedGeneratedPages.length}/${sessionPages.length} pages were restored. Retry again or regenerate.`
    )
    await db.updateGenerationRunStatus(context.runId, 'partial', message)
    emitRetryChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'failed'),
        progress: 90,
        totalPages: retryPages.length,
        detail: message
      }
    })
    throw new Error(message)
  }

  const fallbackCompletionSummary = uiText(
    context.appLocale,
    `失败页面已经重试完成，本次修复 ${retrySuccessPages.length} 页。`,
    `Failed pages were retried. ${retrySuccessPages.length} pages were fixed.`
  )
  await emitAssistant(context, agentSummary.trim() || fallbackCompletionSummary)
  await finalizeGenerationSuccess(ctx, {
    context,
    indexPath,
    totalPages: sessionPages.length,
    generatedPages: mergedGeneratedPages,
    designContract
  })
}
