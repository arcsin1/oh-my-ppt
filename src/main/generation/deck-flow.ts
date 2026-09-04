import type { DeckContext, EmitAssistantFn } from './types'
import { uiText } from './generation-utils'
import { finalizeGenerationSuccess } from './finalization'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import log from 'electron-log/main.js'
import { type LayoutIntent } from '@shared/layout-intent'
import { isPlaceholderPageHtml, validatePersistedPageHtml } from '../presentation/html/html-utils'
import { validateLayoutSlots } from './layout-slot-validator'
import { buildProjectIndexHtml, type DeckPageFile } from '../session/template-builder'
import {
  buildDesignContractWithLLM,
  planDeckWithLLM,
  runDeepAgentDeckGeneration
} from './agent-runner'
import type { GeneratedPagePayload } from '@shared/generation'
import { sleep } from '../ipc/utils'
import { customAlphabet, nanoid } from 'nanoid'
import {
  buildOutlineTitles,
  buildTotalPages,
  type GenerationContext,
  normalizeGeneratePayload,
  type RuntimeJobExecutionContext,
  resolveCommonContext,
  resolveSessionReferenceDocumentPath,
  resolveSourceDocuments
} from './context'
import { canUseSourcePlanDirectly, mapSourcePlanToOutlineItems } from './source-plan'
import { createPageImageFinalizer } from './page-image-finalizer'

const pageSlugId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)

export async function resolveDeckContext(
  ctx: GenerationContext,
  _event: Electron.IpcMainInvokeEvent,
  payload: unknown,
  execution?: RuntimeJobExecutionContext
): Promise<DeckContext> {
  const input = normalizeGeneratePayload(payload)
  const { db, localFiles } = ctx
  if (!input.sessionId) throw new Error('sessionId 不能为空')

  const common = await resolveCommonContext(ctx, input.sessionId, input.modelConfigId, execution)
  const userMessage = `${input.rawUserMessage}${localFiles.formatImagePathsForPrompt([])}`
  const userProvidedOutlineTitles = buildOutlineTitles(input.rawUserMessage)
  const totalPages = buildTotalPages(common.sessionRecord)
  const sourceDocumentPaths = await resolveSourceDocuments(ctx, {
    sessionId: input.sessionId,
    projectDir: common.projectDir,
    rawDocPaths: input.rawDocPaths,
    mode: 'generate',
    sessionRecord: common.sessionRecord
  })
  const referenceDocumentPath =
    resolveSessionReferenceDocumentPath(common.projectDir, common.sessionRecord) ?? undefined

  await db.addMessage(input.sessionId, {
    role: 'user',
    content: input.rawUserMessage,
    type: 'text',
    chat_scope: 'main',
    image_paths: [],
    run_model: common.runModel
  })
  await db.updateSessionStatus(input.sessionId, 'active')

  return {
    sessionId: input.sessionId,
    userMessage,
    requestedType: input.requestedType,
    effectiveMode: 'generate',
    selectedPageId: undefined,
    selectPageIds: [],
    htmlPath: undefined,
    selector: undefined,
    elementTag: undefined,
    elementText: undefined,
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
    userProvidedOutlineTitles,
    totalPages,
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
    animationPreferences: input.animationPreferences,
    visualEnabled: common.visualEnabled,
    imageModelConfigId: common.imageModelConfigId
  }
}

export async function executeDeckGeneration(
  ctx: GenerationContext,
  emitAssistant: EmitAssistantFn,
  context: DeckContext
): Promise<void> {
  const {
    db,
    agentManager,
    sessionProject: { getPageSourceUrl, validateProjectIndexHtml },
    runtimeEmitters: { createDeckProgressEmitter },
    sessionScaffold: { scaffoldProjectFiles },
    tuning: {
      plannerTemperature: PLANNER_TEMPERATURE,
      designContractTemperature: DESIGN_CONTRACT_TEMPERATURE,
      pageGenerationTemperature: PAGE_GENERATION_TEMPERATURE
    }
  } = ctx

  if (!context.apiKey) {
    throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
  }

  const emitDeckChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)

  emitDeckChunk({
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'preflight',
      label: progressText(context.appLocale, 'understanding'),
      progress: 2,
      totalPages: context.totalPages
    }
  })
  await db.addMessage(context.sessionId, {
    role: 'system',
    content: uiText(
      context.appLocale,
      '正在梳理需求并准备生成画布。',
      'Organizing requirements and preparing the canvas.'
    ),
    type: 'stream_chunk',
    chat_scope: context.messageScope,
    page_id: context.messagePageId,
    run_model: context.runModel
  })
  await sleep(120, context.abortSignal)

  const pageRefs = Array.from({ length: context.totalPages }, (_unused, index) => {
    const pageNumber = index + 1
    const id = nanoid()
    const pageId = `page-${pageSlugId()}`
    const htmlPath = path.join(context.projectDir, `${pageId}.html`)
    const fallbackTitle = context.userProvidedOutlineTitles[index] || `Slide ${pageNumber}`
    return { id, pageNumber, title: fallbackTitle, pageId, htmlPath }
  })
  const pageFileMap = Object.fromEntries(pageRefs.map((page) => [page.pageId, page.htmlPath]))
  const pageNumbers = Object.fromEntries(pageRefs.map((page) => [page.pageId, page.pageNumber]))
  const indexPath = path.join(context.projectDir, 'index.html')
  await db.createGenerationRun({
    id: context.runId,
    sessionId: context.sessionId,
    mode: 'generate',
    totalPages: pageRefs.length,
    modelConfigId: context.modelConfigId,
    animationPreferences: context.animationPreferences,
    metadata: {
      topic: context.topic,
      styleId: context.styleId,
      modelConfigId: context.modelConfigId,
      modelConfigName: context.modelConfigName,
      provider: context.provider,
      model: context.model,
      projectDir: context.projectDir,
      indexPath
    }
  })

  emitDeckChunk({
    type: 'stage_progress',
    payload: {
      runId: context.runId,
      stage: 'planning',
      label: progressText(context.appLocale, 'planning'),
      progress: 6,
      totalPages: context.totalPages
    }
  })
  const scaffoldPromise = scaffoldProjectFiles({
    deckTitle: context.deckTitle,
    indexPath,
    pages: pageRefs,
    slideSize: context.slideSize
  }).then(() => {
    emitDeckChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'preflight',
        label: progressText(context.appLocale, 'preparing'),
        progress: 4,
        totalPages: pageRefs.length,
        detail: uiText(
          context.appLocale,
          `已创建 index.html 与 ${pageRefs.length} 个页面骨架`,
          `Created index.html and ${pageRefs.length} page shells`
        )
      }
    })
  })

  const shouldUseSourcePlan = canUseSourcePlanDirectly({
    sourcePlan: context.sourcePlan,
    totalPages: pageRefs.length,
    userMessage: context.userMessage
  })
  const plannerPromise =
    shouldUseSourcePlan && context.sourcePlan
      ? Promise.resolve(mapSourcePlanToOutlineItems(context.sourcePlan))
      : planDeckWithLLM({
          provider: context.provider,
          apiKey: context.apiKey,
          model: context.model,
          baseUrl: context.providerBaseUrl,
          maxTokens: context.maxTokens,
          modelRuntime: context.modelRuntime,
          modelTimeoutMs: context.modelTimeouts.planning,
          temperature: PLANNER_TEMPERATURE,
          styleId: context.styleId,
          totalPages: pageRefs.length,
          appLocale: context.appLocale,
          topic: context.topic,
          userMessage: context.userMessage,
          sourceDocumentPaths: context.sourceDocumentPaths,
          emit: (chunk) => emitDeckChunk(chunk),
          runId: context.runId,
          signal: context.abortSignal
        })
  if (shouldUseSourcePlan) {
    log.info('[generate:deck] using source page skeleton as outline plan', {
      sessionId: context.sessionId,
      pageCount: pageRefs.length,
      sourceDocumentPath: context.sourcePlan?.sourceDocumentPath ?? null
    })
    emitDeckChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'planning',
        label: progressText(context.appLocale, 'planning'),
        progress: 9,
        totalPages: pageRefs.length,
        detail: uiText(
          context.appLocale,
          `已使用源文档结构生成 ${pageRefs.length} 页计划`,
          `Using source document structure for ${pageRefs.length} slide plans`
        )
      }
    })
  }
  const designContractPromise = sleep(500, context.abortSignal).then(() =>
    buildDesignContractWithLLM({
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
      totalPages: context.totalPages,
      slideSize: context.slideSize,
      topic: context.topic,
      userMessage: context.userMessage,
      fontSelection: context.fontSelection,
      emit: (chunk) => emitDeckChunk(chunk),
      runId: context.runId,
      signal: context.abortSignal
    })
  )
  const [plannedOutlineItems, designContract] = await Promise.all([
    plannerPromise,
    designContractPromise,
    scaffoldPromise
  ])
  await db.updateSessionDesignContract(context.sessionId, designContract)
  const outlineItems = pageRefs.map((page, index) => {
    const planned = plannedOutlineItems[index]
    return {
      title: planned?.title?.trim() || page.title,
      contentOutline: planned?.contentOutline?.trim() || '',
      layoutIntent: planned?.layoutIntent
    }
  })
  const outlineTitles = outlineItems.map((item) => item.title)
  for (const page of pageRefs) {
    page.title = outlineTitles[page.pageNumber - 1] || page.title
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: outlineItems[page.pageNumber - 1]?.contentOutline || '',
      layoutIntent: outlineItems[page.pageNumber - 1]?.layoutIntent,
      htmlPath: page.htmlPath,
      status: 'pending'
    })
    await db.upsertSessionPage({
      id: page.id,
      sessionId: context.sessionId,
      legacyPageId: page.pageId.match(/^page-\d+$/) ? page.pageId : null,
      fileSlug: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      htmlPath: page.htmlPath,
      layoutIntent: outlineItems[page.pageNumber - 1]?.layoutIntent || null,
      status: 'pending',
      error: null
    })
  }

  await fs.promises.writeFile(
    indexPath,
    buildProjectIndexHtml(
      context.deckTitle,
      pageRefs.map(
        (page): DeckPageFile => ({
          id: page.id,
          pageNumber: page.pageNumber,
          pageId: page.pageId,
          title: page.title,
          htmlPath: path.basename(page.htmlPath)
        })
      ),
      context.slideSize
    ),
    'utf-8'
  )
  emitDeckChunk({
    type: 'llm_status',
    payload: {
      runId: context.runId,
      stage: 'preflight',
      label: progressText(context.appLocale, 'generating'),
      progress: 10,
      totalPages: pageRefs.length,
      detail: uiText(
        context.appLocale,
        `已完成规划并更新目录标题，设计契约：${designContract.theme}`,
        `Planning completed and index titles updated. Design contract: ${designContract.theme}`
      )
    }
  })

  await sleep(120, context.abortSignal)

  const beforePageMap = new Map<string, string>()
  const beforePageResults = await Promise.all(
    pageRefs.map(async (page) => ({
      pageId: page.pageId,
      html: await fs.promises.readFile(page.htmlPath, 'utf-8')
    }))
  )
  for (const item of beforePageResults) {
    beforePageMap.set(item.pageId, item.html)
  }

  const persistedGeneratedPagesById = new Map<
    string,
    {
      pageNumber: number
      title: string
      pageId: string
      htmlPath: string
    }
  >()
  const persistedFailedPagesById = new Map<
    string,
    {
      pageId: string
      title: string
      reason: string
    }
  >()
  const persistGenerationSnapshotMetadata = async (): Promise<void> => {
    await db.updateSessionMetadata(context.sessionId, {
      lastRunId: context.runId,
      entryMode: 'multi_page',
      indexPath,
      projectId: context.projectId
    })
  }
  const persistSessionPageLayoutSource = async (
    page: {
      pageNumber: number
      pageId: string
      title: string
      htmlPath: string
      layoutIntent?: LayoutIntent
      layoutId: string
      layoutContractVersion: number
    },
    status: 'completed' | 'failed',
    error: string | null
  ): Promise<void> => {
    const pageRef = pageRefs.find((item) => item.pageId === page.pageId)
    if (!pageRef) return
    await db.upsertSessionPage({
      id: pageRef.id,
      sessionId: context.sessionId,
      legacyPageId: page.pageId.match(/^page-\d+$/) ? page.pageId : null,
      fileSlug: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      htmlPath: page.htmlPath,
      layoutIntent: page.layoutIntent || null,
      layoutId: page.layoutId,
      layoutContractVersion: page.layoutContractVersion,
      status,
      error
    })
  }
  const persistCompletedGeneratedPage = async (page: {
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
    const slotValidation = validateLayoutSlots({
      html,
      layoutIntent: page.layoutIntent,
      layoutId: page.layoutId,
      layoutContractVersion: page.layoutContractVersion
    })
    if (!slotValidation.valid) {
      throw new Error(
        `Layout slot validation failed (${page.pageId}): ${slotValidation.errors.join('; ')}`
      )
    }
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
      status: 'completed'
    })
    await persistSessionPageLayoutSource(page, 'completed', null)
    persistedFailedPagesById.delete(page.pageId)
    persistedGeneratedPagesById.set(page.pageId, {
      pageNumber: page.pageNumber,
      title: page.title,
      pageId: page.pageId,
      htmlPath: page.htmlPath
    })
    const pageRef = pageRefs.find((item) => item.pageId === page.pageId)
    emitDeckChunk({
      type: 'page_generated',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'completed'),
        progress: 10 + Math.round((page.pageNumber / Math.max(pageRefs.length, 1)) * 80),
        currentPage: page.pageNumber,
        totalPages: pageRefs.length,
        id: pageRef?.id,
        pageNumber: page.pageNumber,
        title: page.title,
        html,
        pageId: page.pageId,
        htmlPath: page.htmlPath,
        sourceUrl: getPageSourceUrl(page.htmlPath)
      }
    })
    await persistGenerationSnapshotMetadata()
  }
  const persistFailedGeneratedPage = async (page: {
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
      error: page.reason
    })
    await persistSessionPageLayoutSource(page, 'failed', page.reason)
    persistedGeneratedPagesById.delete(page.pageId)
    persistedFailedPagesById.set(page.pageId, {
      pageId: page.pageId,
      title: page.title,
      reason: page.reason
    })
    await persistGenerationSnapshotMetadata()
  }

  const { summary: agentSummary, failedPages } = await runDeepAgentDeckGeneration({
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
    userMessage: context.userMessage,
    outlineTitles,
    outlineItems,
    pageTasks: pageRefs.map((page, index) => ({
      pageNumber: page.pageNumber,
      pageId: page.pageId,
      title: page.title,
      contentOutline: outlineItems[index]?.contentOutline || '',
      layoutIntent: outlineItems[index]?.layoutIntent
    })),
    sourceDocumentPaths: context.sourceDocumentPaths,
    referenceDocumentPath: context.referenceDocumentPath,
    sourcePlan: context.sourcePlan,
    generationMode: 'generate',
    visualEnabled: context.visualEnabled,
    designContract,
    projectDir: context.projectDir,
    indexPath,
    pageFileMap,
    pageNumbers,
    agentManager,
    emit: (chunk) => emitDeckChunk(chunk),
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
    onPageCompleted: persistCompletedGeneratedPage,
    onPageFailed: persistFailedGeneratedPage,
    runId: context.runId,
    signal: context.abortSignal
  })

  const failedPageIdSet = new Set(failedPages.map((item) => item.pageId))
  const postValidationErrors: string[] = []
  const postValidationFailures: Array<{ pageId: string; title: string; reason: string }> = []
  if (!fs.existsSync(indexPath)) {
    postValidationErrors.push('index.html 缺失')
  } else {
    const indexHtml = await fs.promises.readFile(indexPath, 'utf-8')
    postValidationErrors.push(...validateProjectIndexHtml(indexHtml))
  }
  const validationPages = await Promise.all(
    pageRefs.map(async (page) => {
      if (!fs.existsSync(page.htmlPath)) {
        return { pageId: page.pageId, missing: true, html: '' }
      }
      const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
      return { pageId: page.pageId, missing: false, html }
    })
  )
  for (const item of validationPages) {
    const pageRef = pageRefs.find((page) => page.pageId === item.pageId)
    if (item.missing) {
      const reason = `${item.pageId}.html 缺失`
      postValidationErrors.push(reason)
      if (!failedPageIdSet.has(item.pageId)) {
        postValidationFailures.push({
          pageId: item.pageId,
          title: pageRef?.title || item.pageId,
          reason
        })
      }
      continue
    }
    if (!/<html[\s>]/i.test(item.html)) {
      const reason = `${item.pageId}.html 缺少 <html>`
      postValidationErrors.push(reason)
      if (!failedPageIdSet.has(item.pageId)) {
        postValidationFailures.push({
          pageId: item.pageId,
          title: pageRef?.title || item.pageId,
          reason
        })
      }
      continue
    }
    if (!failedPageIdSet.has(item.pageId)) {
      const validation = validatePersistedPageHtml(item.html, item.pageId)
      if (!validation.valid) {
        const reason = validation.errors.join('; ')
        postValidationErrors.push(`${item.pageId}.html ${reason}`)
        postValidationFailures.push({
          pageId: item.pageId,
          title: pageRef?.title || item.pageId,
          reason
        })
      }
    }
  }
  for (const failure of postValidationFailures) {
    failedPageIdSet.add(failure.pageId)
    failedPages.push(failure)
  }
  emitDeckChunk({
    type: 'llm_status',
    payload: {
      runId: context.runId,
      stage: 'validation',
      label: progressText(
        context.appLocale,
        postValidationErrors.length > 0 ? 'failed' : 'checking'
      ),
      progress: 92,
      totalPages: outlineTitles.length,
      detail:
        postValidationErrors.length > 0
          ? postValidationErrors.join('; ')
          : uiText(
              context.appLocale,
              `全部 ${pageRefs.length} 个页面文件都已准备完成`,
              `All ${pageRefs.length} page files are ready`
            )
    }
  })

  const placeholderPages: string[] = []
  const pageDescriptors: Array<{
    id: string
    pageNumber: number
    title: string
    pageId: string
    htmlPath: string
    html: string
  }> = []
  const generatedPageReads = await Promise.all(
    pageRefs.map(async (pageRef) => {
      if (!fs.existsSync(pageRef.htmlPath)) return null
      const html = await fs.promises.readFile(pageRef.htmlPath, 'utf-8')
      return { pageRef, html }
    })
  )
  for (const item of generatedPageReads) {
    if (!item) continue
    const { pageRef, html } = item
    if (failedPageIdSet.has(pageRef.pageId)) {
      continue
    }
    if (isPlaceholderPageHtml(html)) {
      const reason = '页面仍为占位内容，模型没有成功写入真实页面'
      placeholderPages.push(pageRef.pageId)
      failedPageIdSet.add(pageRef.pageId)
      failedPages.push({
        pageId: pageRef.pageId,
        title: pageRef.title,
        reason
      })
      continue
    }
    const page: GeneratedPagePayload = {
      id: pageRef.id,
      pageNumber: pageRef.pageNumber,
      title: pageRef.title,
      html,
      pageId: pageRef.pageId,
      htmlPath: pageRef.htmlPath,
      sourceUrl: getPageSourceUrl(pageRef.htmlPath)
    }
    pageDescriptors.push({
      id: pageRef.id,
      pageNumber: pageRef.pageNumber,
      title: pageRef.title,
      pageId: pageRef.pageId,
      htmlPath: pageRef.htmlPath,
      html
    })
    if (!persistedGeneratedPagesById.has(pageRef.pageId)) {
      await db.upsertGenerationPage({
        runId: context.runId,
        sessionId: context.sessionId,
        pageId: pageRef.pageId,
        pageNumber: pageRef.pageNumber,
        title: pageRef.title,
        contentOutline: outlineItems[pageRef.pageNumber - 1]?.contentOutline || '',
        layoutIntent: outlineItems[pageRef.pageNumber - 1]?.layoutIntent,
        htmlPath: pageRef.htmlPath,
        status: 'completed'
      })
    }
    const changed = beforePageMap.get(pageRef.pageId) !== html
    await db.addMessage(context.sessionId, {
      role: 'tool',
      content: `${changed ? '已更新' : '已确认'} ${page.pageId}: ${page.title}`,
      type: 'tool_result',
      tool_name: 'update_page_file',
      tool_call_id: context.runId,
      chat_scope: context.messageScope,
      page_id: context.messagePageId,
      run_model: context.runModel
    })
  }

  if (placeholderPages.length > 0) {
    emitDeckChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'checking'),
        progress: 90,
        totalPages: outlineTitles.length,
        detail: uiText(
          context.appLocale,
          `以下页面可能仍是占位内容：${placeholderPages.join(', ')}`,
          `These pages may still contain placeholders: ${placeholderPages.join(', ')}`
        )
      }
    })
  }

  if (failedPages.length > 0) {
    const failedDetails = failedPages
      .map((item) => `${item.pageId}（${item.title}）：${item.reason}`)
      .join('；')
    for (const failedPage of failedPages) {
      const pageRef = pageRefs.find((page) => page.pageId === failedPage.pageId)
      if (!pageRef) continue
      emitDeckChunk({
        type: 'page_failed',
        payload: {
          runId: context.runId,
          stage: 'validation',
          label: progressText(context.appLocale, 'failed'),
          progress: 92,
          currentPage: pageRef.pageNumber,
          totalPages: pageRefs.length,
          pageNumber: pageRef.pageNumber,
          pageId: pageRef.pageId,
          title: pageRef.title,
          htmlPath: pageRef.htmlPath,
          error: failedPage.reason
        }
      })
      await db.upsertGenerationPage({
        runId: context.runId,
        sessionId: context.sessionId,
        pageId: pageRef.pageId,
        pageNumber: pageRef.pageNumber,
        title: pageRef.title,
        contentOutline: outlineItems[pageRef.pageNumber - 1]?.contentOutline || '',
        layoutIntent: outlineItems[pageRef.pageNumber - 1]?.layoutIntent,
        htmlPath: pageRef.htmlPath,
        status: 'failed',
        error: failedPage.reason
      })
    }
    const existingSessionPages = await db.listSessionPages(context.sessionId, {
      includeDeleted: true
    })
    const existingBySlug = new Map(existingSessionPages.map((sp) => [sp.file_slug, sp]))
    for (const failedPage of failedPages) {
      const pageRef = pageRefs.find((page) => page.pageId === failedPage.pageId)
      if (!pageRef) continue
      const existing = existingBySlug.get(pageRef.pageId)
      await db.upsertSessionPage({
        id: existing?.id || pageRef.id,
        sessionId: context.sessionId,
        legacyPageId:
          existing?.legacy_page_id || (pageRef.pageId.match(/^page-\d+$/) ? pageRef.pageId : null),
        fileSlug: pageRef.pageId,
        pageNumber: pageRef.pageNumber,
        title: pageRef.title,
        htmlPath: pageRef.htmlPath,
        status: 'failed',
        error: failedPage.reason
      })
    }
    for (const page of pageDescriptors) {
      const existing = existingBySlug.get(page.pageId)
      await db.upsertSessionPage({
        id: existing?.id || page.id,
        sessionId: context.sessionId,
        legacyPageId:
          existing?.legacy_page_id || (page.pageId.match(/^page-\d+$/) ? page.pageId : null),
        fileSlug: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        htmlPath: page.htmlPath,
        status: 'completed',
        error: null
      })
    }
    await db.updateGenerationRunStatus(
      context.runId,
      pageDescriptors.length > 0 ? 'partial' : 'failed',
      failedDetails
    )
    await db.updateSessionMetadata(context.sessionId, {
      lastRunId: context.runId,
      entryMode: 'multi_page',
      indexPath,
      projectId: context.projectId
    })
    await db.updateSessionDesignContract(context.sessionId, designContract)
    await db.updateProjectStatus(context.projectId, 'draft')
    emitDeckChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'failed'),
        progress: 90,
        totalPages: outlineTitles.length,
        detail: uiText(
          context.appLocale,
          `本次已完成 ${pageDescriptors.length}/${pageRefs.length} 页，失败页面：${failedDetails}`,
          `${pageDescriptors.length}/${pageRefs.length} pages completed. Failed pages: ${failedDetails}`
        )
      }
    })
    throw new Error(
      `部分页面生成失败（${failedPages.length}/${pageRefs.length}）：${failedPages
        .map((item) => `${item.pageId}(${item.title})`)
        .join(', ')}`
    )
  }

  const fallbackCompletionSummary =
    placeholderPages.length > 0
      ? uiText(
          context.appLocale,
          `演示已生成完成。当前共 ${pageDescriptors.length} 页，主题「${context.topic}」。其中 ${placeholderPages.length} 页可以继续优化。`,
          `The presentation has been generated. It has ${pageDescriptors.length} pages for "${context.topic}". ${placeholderPages.length} pages can still be improved.`
        )
      : uiText(
          context.appLocale,
          `演示已生成完成。共 ${pageDescriptors.length} 页，主题「${context.topic}」。`,
          `The presentation has been generated. It has ${pageDescriptors.length} pages for "${context.topic}".`
        )
  await emitAssistant(context, agentSummary.trim() || fallbackCompletionSummary)

  await finalizeGenerationSuccess(ctx, {
    context,
    indexPath,
    totalPages: outlineTitles.length,
    generatedPages: pageDescriptors,
    designContract
  })
}
