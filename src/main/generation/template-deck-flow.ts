import fs from 'fs'
import path from 'path'
import { progressText } from '@shared/progress'
import { normalizeLayoutIntent, type LayoutIntent } from '@shared/layout-intent'
import { buildProjectIndexHtml, type DeckPageFile } from '../session/template-builder'
import { planDeckWithLLM, runDeepAgentDeckGeneration } from './agent-runner'
import { isPlaceholderPageHtml, validatePersistedPageHtml } from '../presentation/html/html-utils'
import { finalizeGenerationSuccess } from './finalization'
import { uiText } from './generation-utils'
import type { DeckContext, EmitAssistantFn } from './types'
import { resolveDeckContext } from './deck-flow'
import { parseJsonObject } from '../ipc/utils'
import { resolveTemplateDesignContract } from '../templates/template-design-contract'
import { canUseSourcePlanDirectly, mapSourcePlanToOutlineItems } from './source-plan'
import type { GenerationContext, RuntimeJobExecutionContext } from './context'
import { createPageImageFinalizer } from './page-image-finalizer'

type TemplateSeedPage = {
  id: string
  pageNumber: number
  pageId: string
  title: string
  htmlPath: string
  status: string
}

type TemplateDeckContext = DeckContext & {
  templateSeedPages: TemplateSeedPage[]
  templateRetry: boolean
}

function isTemplateSession(sessionRecord: Record<string, unknown>): boolean {
  const metadata = parseJsonObject(sessionRecord.metadata ?? sessionRecord.metadata_json)
  return metadata.source === 'template' && typeof metadata.templateId === 'string'
}

export function shouldUseTemplateDeckFlow(sessionRecord: Record<string, unknown>): boolean {
  return isTemplateSession(sessionRecord)
}

export async function resolveTemplateDeckContext(
  ctx: GenerationContext,
  event: Electron.IpcMainInvokeEvent,
  payload: unknown,
  execution?: RuntimeJobExecutionContext
): Promise<TemplateDeckContext> {
  const context = await resolveDeckContext(ctx, event, payload, execution)
  if (!isTemplateSession(context.sessionRecord)) {
    throw new Error('当前会话不是模板会话，不能使用模板生成链路')
  }
  const payloadRecord =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const templateRetry = payloadRecord.retry === true

  const sessionPages = await ctx.db.listSessionPages(context.sessionId)
  const allSeedPages = sessionPages
    .filter((page) => page.html_path && page.file_slug)
    .sort((a, b) => a.page_number - b.page_number)
    .map((page) => ({
      id: page.id,
      pageNumber: page.page_number,
      pageId: page.file_slug,
      title: page.title || `第 ${page.page_number} 页`,
      htmlPath: page.html_path,
      status: page.status
    }))
  if (allSeedPages.length === 0) {
    throw new Error('模板会话缺少已清洗的页面基底')
  }
  const seedPages = templateRetry
    ? allSeedPages.filter((page) => page.status !== 'completed')
    : allSeedPages
  if (templateRetry && seedPages.length === 0) {
    throw new Error('当前模板会话没有未完成页面。')
  }

  return {
    ...context,
    totalPages: seedPages.length,
    templateSeedPages: seedPages,
    templateRetry
  }
}

export async function executeTemplateDeckGeneration(
  ctx: GenerationContext,
  emitAssistant: EmitAssistantFn,
  context: TemplateDeckContext
): Promise<void> {
  const {
    db,
    agentManager,
    sessionProject: { getPageSourceUrl, validateProjectIndexHtml },
    runtimeEmitters: { createDeckProgressEmitter },
    tuning: {
      plannerTemperature: PLANNER_TEMPERATURE,
      pageGenerationTemperature: PAGE_GENERATION_TEMPERATURE
    }
  } = ctx

  if (!context.apiKey) {
    throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
  }
  if (context.templateSeedPages.length === 0) {
    throw new Error('模板生成链路缺少模板页面基底')
  }

  const emitDeckChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)
  const templateMetadata = parseJsonObject(
    context.sessionRecord.metadata ?? context.sessionRecord.metadata_json
  )
  const templateDesignContract = resolveTemplateDesignContract(
    context.sessionRecord.designContract,
    templateMetadata
  )
  await db.updateSessionDesignContract(context.sessionId, templateDesignContract)
  const allSessionPages = await db.listSessionPages(context.sessionId)
  const allPageRefs = allSessionPages
    .filter((page) => page.html_path && page.file_slug)
    .sort((a, b) => a.page_number - b.page_number)
    .map((page) => ({
      id: page.id,
      pageNumber: page.page_number,
      title: page.title || `第 ${page.page_number} 页`,
      pageId: page.file_slug,
      htmlPath: page.html_path
    }))
  const pageRefs = context.templateSeedPages.map((page) => ({
    id: page.id,
    pageNumber: page.pageNumber,
    title: page.title,
    pageId: page.pageId,
    htmlPath: page.htmlPath
  }))
  const fullDeckPageCount = Math.max(allPageRefs.length, pageRefs.length)
  const pageFileMap = Object.fromEntries(pageRefs.map((page) => [page.pageId, page.htmlPath]))
  const pageNumbers = Object.fromEntries(pageRefs.map((page) => [page.pageId, page.pageNumber]))
  const indexPath = path.join(context.projectDir, 'index.html')
  const templateSystemPromptAddendum = [
    '## 模板设计系统模式',
    '- 当前页面文件来自用户模板复制并清洗后的页面基底；它定义本会话的当前设计系统。',
    '- 以模板页面和 styleId 共同作为设计依据，优先保持视觉连续性。',
    '- 本链路不抽象、不重算 designContract；直接从页面基底继承背景、配色、字体尺度、组件语言、留白节奏和首尾页角色。',
    '- 如果上下文里存在 designContract，它只代表模板继承的字体与历史元数据；页面基底才是视觉事实来源。',
    '- 不要无故换成一套全新的风格、背景、配色、字体尺度、组件语言或首尾页角色。',
    '- 背景图、纹理图、装饰图片、蒙版、叠加层、CSS background-image/url(...)、SVG image href 属于模板骨架，不属于旧业务内容；生成时必须保留或等价复现。',
    '- 写回页面时要使用模板里读到的本地资源路径，不要因为替换文字/数据而删除背景层、装饰层或承载它们的结构容器。',
    '- 可以为了适配新内容做必要的局部调整：信息密度、模块数量、图表类型、局部排列、文字层级和避免遮挡的尺寸变化。',
    '- 旧模板里的业务文字、数字、公司名、日期和结论不是事实来源，必须用用户 brief/source document 替换。',
    '- 新增/复用的中间页应沿着模板设计系统延展，而不是机械复制旧内容。'
  ].join('\n')
  const templateSinglePagePromptAddendum = [
    'Template design system for this slide:',
    '- The existing target page file is a copied template page base. Preserve its visual system and layout language.',
    '- Replace old text/data/media meaning with the new slide content, but do not redesign the whole page.',
    '- Treat background images, texture images, decorative images, masks, overlay layers, CSS background-image/url(...) references, and SVG image hrefs as template structure, not old business content.',
    '- Keep those template assets and their local paths in the written page unless the user explicitly asks to remove them; text/data changes must not strip the visual shell.',
    '- Keep color language, typography scale, spacing rhythm, component shapes, and chart/table styling unless a local adjustment is needed to avoid overlap.',
    '- Do not infer or invent a separate deck-wide design contract for this template run.',
    '- If a design contract is present, treat it as inherited font/runtime metadata only; the page base remains the visual source of truth.',
    '- Do not treat old template business text, numbers, company names, dates, or conclusions as facts.'
  ].join('\n')

  emitDeckChunk({
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'preflight',
      label: progressText(context.appLocale, 'understanding'),
      progress: 2,
      totalPages: fullDeckPageCount
    }
  })

  await db.addMessage(context.sessionId, {
    role: 'system',
    content: uiText(
      context.appLocale,
      '正在按模板设计系统准备生成内容。',
      'Preparing content generation with the template design system.'
    ),
    type: 'stream_chunk',
    chat_scope: context.messageScope,
    page_id: context.messagePageId,
    run_model: context.runModel
  })

  await db.createGenerationRun({
    id: context.runId,
    sessionId: context.sessionId,
    mode: 'generate',
    totalPages: pageRefs.length,
    modelConfigId: context.modelConfigId,
    metadata: {
      templateGeneration: true,
      templateRetry: context.templateRetry,
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
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'planning',
      label: progressText(context.appLocale, 'planning'),
      progress: 6,
      totalPages: fullDeckPageCount
    }
  })

  const latestPageSnapshot = context.templateRetry
    ? await db.listLatestGenerationPageSnapshot(context.sessionId)
    : []
  const shouldUseSourcePlan =
    !context.templateRetry &&
    canUseSourcePlanDirectly({
      sourcePlan: context.sourcePlan,
      totalPages: pageRefs.length,
      userMessage: context.userMessage
    })
  const plannedOutlineItems = context.templateRetry
    ? pageRefs.map((page) => {
        const snapshot = latestPageSnapshot.find((item) => item.page_id === page.pageId)
        return {
          title: snapshot?.title?.trim() || page.title,
          contentOutline: snapshot?.content_outline?.trim() || '',
          layoutIntent: snapshot?.layout_intent
            ? normalizeLayoutIntent(snapshot.layout_intent)
            : undefined
        }
      })
    : shouldUseSourcePlan && context.sourcePlan
      ? mapSourcePlanToOutlineItems(context.sourcePlan)
      : await planDeckWithLLM({
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

  const outlineItems = pageRefs.map((page, index) => {
    const planned = plannedOutlineItems[index]
    return {
      title: planned?.title?.trim() || page.title,
      contentOutline: planned?.contentOutline?.trim() || '',
      layoutIntent: planned?.layoutIntent
    }
  })
  const outlineTitles = outlineItems.map((item) => item.title)
  const existingSessionPages = await db.listSessionPages(context.sessionId, {
    includeDeleted: true
  })
  const existingSessionPageBySlug = new Map(
    existingSessionPages.map((page) => [page.file_slug, page])
  )
  for (let index = 0; index < pageRefs.length; index += 1) {
    const page = pageRefs[index]
    page.title = outlineTitles[index] || page.title
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: outlineItems[index]?.contentOutline || '',
      layoutIntent: outlineItems[index]?.layoutIntent,
      htmlPath: page.htmlPath,
      status: 'pending'
    })
    const existing = existingSessionPageBySlug.get(page.pageId)
    await db.upsertSessionPage({
      id: existing?.id || page.id,
      sessionId: context.sessionId,
      legacyPageId: existing?.legacy_page_id || null,
      fileSlug: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      htmlPath: page.htmlPath,
      status: 'pending',
      error: null
    })
    emitDeckChunk({
      type: 'page_planned',
      payload: {
        runId: context.runId,
        stage: 'planning',
        label: progressText(context.appLocale, 'planning'),
        progress: 9,
        currentPage: page.pageNumber,
        totalPages: fullDeckPageCount,
        id: page.id,
        pageNumber: page.pageNumber,
        pageId: page.pageId,
        title: page.title,
        htmlPath: page.htmlPath
      }
    })
  }

  const titleByPageId = new Map(pageRefs.map((page) => [page.pageId, page.title]))
  await fs.promises.writeFile(
    indexPath,
    buildProjectIndexHtml(
      context.deckTitle,
      allPageRefs.map(
        (page): DeckPageFile => ({
          id: page.id,
          pageNumber: page.pageNumber,
          pageId: page.pageId,
          title: titleByPageId.get(page.pageId) || page.title,
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
      totalPages: fullDeckPageCount,
      detail: uiText(
        context.appLocale,
        context.templateRetry
          ? `已准备继续生成 ${pageRefs.length} 个未完成模板页面`
          : '已按模板设计系统完成规划并更新目录标题',
        context.templateRetry
          ? `Prepared to continue ${pageRefs.length} unfinished template pages`
          : 'Planning completed with the template design system and index titles updated'
      )
    }
  })

  const persistedGeneratedPagesById = new Map<
    string,
    {
      pageNumber: number
      title: string
      pageId: string
      htmlPath: string
    }
  >()
  let completedTargetPageCount = 0
  const persistGenerationSnapshotMetadata = async (): Promise<void> => {
    await db.updateSessionMetadata(context.sessionId, {
      ...templateMetadata,
      lastRunId: context.runId,
      entryMode: 'template_multi_page',
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
    const existing = existingSessionPageBySlug.get(page.pageId)
    if (!pageRef) return
    await db.upsertSessionPage({
      id: existing?.id || pageRef.id,
      sessionId: context.sessionId,
      legacyPageId: existing?.legacy_page_id || null,
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
    persistedGeneratedPagesById.set(page.pageId, {
      pageNumber: page.pageNumber,
      title: page.title,
      pageId: page.pageId,
      htmlPath: page.htmlPath
    })
    completedTargetPageCount += 1
    const pageRef = pageRefs.find((item) => item.pageId === page.pageId)
    emitDeckChunk({
      type: 'page_generated',
      payload: {
        runId: context.runId,
        stage: 'rendering',
        label: progressText(context.appLocale, 'completed'),
        progress: 10 + Math.round((completedTargetPageCount / Math.max(pageRefs.length, 1)) * 80),
        currentPage: page.pageNumber,
        totalPages: fullDeckPageCount,
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
    hasStyleImageDirection: false,
    styleKey: context.styleKey,
    styleName: context.styleName,
    styleVersion: context.styleVersion,
    slideSize: context.slideSize,
    appLocale: context.appLocale,
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
    designContract: templateDesignContract,
    systemPromptAddendum: templateSystemPromptAddendum,
    singlePagePromptAddendum: templateSinglePagePromptAddendum,
    requireTemplatePageRead: true,
    generationMode: 'generate',
    visualEnabled: false,
    projectDir: context.projectDir,
    indexPath,
    pageFileMap,
    pageNumbers,
    agentManager,
    emit: (chunk) => emitDeckChunk(chunk),
    finalizePage: createPageImageFinalizer(ctx, {
      sessionId: context.sessionId,
      runId: context.runId,
      visualEnabled: false,
      abortSignal: context.abortSignal
    }),
    onPageCompleted: persistCompletedGeneratedPage,
    onPageFailed: persistFailedGeneratedPage,
    runId: context.runId,
    signal: context.abortSignal
  })

  const failedPageIdSet = new Set(failedPages.map((item) => item.pageId))
  const postValidationFailures: Array<{ pageId: string; title: string; reason: string }> = []
  if (!fs.existsSync(indexPath)) {
    postValidationFailures.push({
      pageId: 'index',
      title: 'index.html',
      reason: 'index.html 缺失'
    })
  } else {
    const indexHtml = await fs.promises.readFile(indexPath, 'utf-8')
    const indexErrors = validateProjectIndexHtml(indexHtml)
    if (indexErrors.length > 0) {
      postValidationFailures.push({
        pageId: 'index',
        title: 'index.html',
        reason: indexErrors.join('; ')
      })
    }
  }

  const pageDescriptors: Array<{
    id?: string
    pageNumber: number
    title: string
    pageId: string
    htmlPath: string
    html: string
  }> = []
  const placeholderPages: string[] = []
  for (const pageRef of pageRefs) {
    if (failedPageIdSet.has(pageRef.pageId)) continue
    if (!fs.existsSync(pageRef.htmlPath)) {
      postValidationFailures.push({
        pageId: pageRef.pageId,
        title: pageRef.title,
        reason: `${pageRef.pageId}.html 缺失`
      })
      continue
    }
    const html = await fs.promises.readFile(pageRef.htmlPath, 'utf-8')
    const validation = validatePersistedPageHtml(html, pageRef.pageId)
    if (!validation.valid) {
      postValidationFailures.push({
        pageId: pageRef.pageId,
        title: pageRef.title,
        reason: validation.errors.join('; ')
      })
      continue
    }
    if (isPlaceholderPageHtml(html)) {
      placeholderPages.push(pageRef.pageId)
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
      const outlineIndex = pageRefs.findIndex((item) => item.pageId === pageRef.pageId)
      await db.upsertGenerationPage({
        runId: context.runId,
        sessionId: context.sessionId,
        pageId: pageRef.pageId,
        pageNumber: pageRef.pageNumber,
        title: pageRef.title,
        contentOutline: outlineItems[outlineIndex]?.contentOutline || '',
        layoutIntent: outlineItems[outlineIndex]?.layoutIntent,
        htmlPath: pageRef.htmlPath,
        status: 'completed'
      })
    }
  }

  const allFailedPages = [
    ...failedPages,
    ...postValidationFailures.filter((item) => item.pageId !== 'index')
  ]
  if (allFailedPages.length > 0 || postValidationFailures.some((item) => item.pageId === 'index')) {
    const failedDetails = [
      ...allFailedPages,
      ...postValidationFailures.filter((item) => item.pageId === 'index')
    ]
      .map((item) => `${item.pageId}（${item.title}）：${item.reason}`)
      .join('；')
    const existingSessionPages = await db.listSessionPages(context.sessionId, {
      includeDeleted: true
    })
    const existingBySlug = new Map(existingSessionPages.map((page) => [page.file_slug, page]))
    for (const pageRef of pageRefs) {
      const failed = allFailedPages.find((item) => item.pageId === pageRef.pageId)
      const existing = existingBySlug.get(pageRef.pageId)
      await db.upsertSessionPage({
        id: existing?.id || pageRef.id,
        sessionId: context.sessionId,
        legacyPageId: existing?.legacy_page_id || null,
        fileSlug: pageRef.pageId,
        pageNumber: pageRef.pageNumber,
        title: pageRef.title,
        htmlPath: pageRef.htmlPath,
        status: failed ? 'failed' : 'completed',
        error: failed?.reason || null
      })
    }
    await db.updateGenerationRunStatus(
      context.runId,
      pageDescriptors.length > 0 ? 'partial' : 'failed',
      failedDetails
    )
    await persistGenerationSnapshotMetadata()
    await db.updateProjectStatus(context.projectId, 'draft')
    throw new Error(
      `模板生成部分页面失败（${allFailedPages.length}/${pageRefs.length}）：${allFailedPages
        .map((item) => `${item.pageId}(${item.title})`)
        .join(', ')}`
    )
  }

  if (placeholderPages.length > 0) {
    emitDeckChunk({
      type: 'llm_status',
      payload: {
        runId: context.runId,
        stage: 'validation',
        label: progressText(context.appLocale, 'completed'),
        progress: 94,
        totalPages: fullDeckPageCount,
        detail: uiText(
          context.appLocale,
          `以下页面可能仍是占位内容：${placeholderPages.join(', ')}`,
          `These pages may still contain placeholders: ${placeholderPages.join(', ')}`
        )
      }
    })
  }

  const fallbackCompletionSummary = uiText(
    context.appLocale,
    context.templateRetry
      ? `未完成模板页已继续生成完成。当前共 ${fullDeckPageCount} 页，主题「${context.topic}」。`
      : `模板生成已完成。共 ${fullDeckPageCount} 页，主题「${context.topic}」。`,
    context.templateRetry
      ? `Unfinished template pages are complete. The deck now has ${fullDeckPageCount} pages for "${context.topic}".`
      : `Template generation completed. It has ${fullDeckPageCount} pages for "${context.topic}".`
  )
  await emitAssistant(context, agentSummary.trim() || fallbackCompletionSummary)
  await finalizeGenerationSuccess(ctx, {
    context,
    indexPath,
    totalPages: fullDeckPageCount,
    generatedPages: pageDescriptors
  })
  await persistGenerationSnapshotMetadata()
}
