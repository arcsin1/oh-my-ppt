import fs from 'fs'
import path from 'path'
import log from 'electron-log/main.js'
import { progressText } from '@shared/progress'
import { normalizeLayoutIntent, type LayoutIntent } from '@shared/layout-intent'
import type { IpcContext } from '../context'
import { buildProjectIndexHtml, type DeckPageFile } from '../engine/template'
import { planDeckWithLLM, runDeepAgentDeckGeneration } from '../engine/generate'
import { isPlaceholderPageHtml, validatePersistedPageHtml } from '../../tools/html-utils'
import { finalizeGenerationSuccess } from './finalization'
import { uiText } from './generation-utils'
import type { DeckContext, EmitAssistantFn } from './types'
import { resolveDeckContext } from './deck-flow'
import { parseJsonObject } from '../utils'
import { resolveTemplateDesignContract } from '../templates/template-design-contract'
import { canUseSourcePlanForTemplateBodyPages, mapSourcePlanToOutlineItems } from './source-plan'
import {
  resolveCorporateTemplatePageRoles,
  type CorporateTemplatePageRole
} from '@shared/corporate-template'
import {
  normalizeConfirmedCorporatePagePlan,
  validateConfirmedCorporatePagePlan
} from '@shared/confirmed-corporate-plan'
import { mapConfirmedCorporatePlanToOutlineItems } from './confirmed-corporate-plan'
import { sanitizeTemplateOutlineItem } from './template-outline-grounding'
import {
  normalizeCorporateTemplatePageChrome,
  validateCorporateTemplateBodyPageLayout
} from './template-page-chrome'

type TemplateSeedPage = {
  id: string
  pageNumber: number
  pageId: string
  title: string
  htmlPath: string
  status: string
  templateRole: CorporateTemplatePageRole
}

type TemplateDeckContext = DeckContext & {
  templateSeedPages: TemplateSeedPage[]
  templateRetry: boolean
}

function isTemplateSession(sessionRecord: Record<string, unknown>): boolean {
  const metadata = parseJsonObject(sessionRecord.metadata ?? sessionRecord.metadata_json)
  return metadata.source === 'template' && typeof metadata.templateId === 'string'
}

const normalizeTemplateRole = (
  value: unknown,
  fallback: CorporateTemplatePageRole
): CorporateTemplatePageRole =>
  value === 'cover' || value === 'agenda' || value === 'body' || value === 'closing'
    ? value
    : fallback

export function shouldUseTemplateDeckFlow(sessionRecord: Record<string, unknown>): boolean {
  return isTemplateSession(sessionRecord)
}

export async function resolveTemplateDeckContext(
  ctx: IpcContext,
  event: Electron.IpcMainInvokeEvent,
  payload: unknown
): Promise<TemplateDeckContext> {
  const context = await resolveDeckContext(ctx, event, payload)
  if (!isTemplateSession(context.sessionRecord)) {
    throw new Error('当前会话不是模板会话，不能使用模板生成链路')
  }
  const payloadRecord =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const templateRetry = payloadRecord.retry === true

  const sessionPages = await ctx.db.listSessionPages(context.sessionId)
  const sessionMetadata = parseJsonObject(
    context.sessionRecord.metadata ?? context.sessionRecord.metadata_json
  )
  const persistedRoleMap = parseJsonObject(sessionMetadata.templatePageRoles)
  const sortedSeedPages = sessionPages
    .filter((page) => page.html_path && page.file_slug)
    .sort((a, b) => a.page_number - b.page_number)
  const fallbackRolePlan = resolveCorporateTemplatePageRoles(
    sortedSeedPages.length,
    sessionMetadata.includeAgenda === true
  )
  const allSeedPages = sortedSeedPages.map((page) => ({
    id: page.id,
    pageNumber: page.page_number,
    pageId: page.file_slug,
    title: page.title || `第 ${page.page_number} 页`,
    htmlPath: page.html_path,
    status: page.status,
    templateRole: normalizeTemplateRole(
      persistedRoleMap[page.file_slug],
      fallbackRolePlan[page.page_number - 1] || 'body'
    )
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
  ctx: IpcContext,
  emitAssistant: EmitAssistantFn,
  context: TemplateDeckContext
): Promise<void> {
  const {
    db,
    agentManager,
    getPageSourceUrl,
    validateProjectIndexHtml,
    createDeckProgressEmitter,
    PLANNER_TEMPERATURE,
    PAGE_GENERATION_TEMPERATURE
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
    htmlPath: page.htmlPath,
    templateRole: page.templateRole
  }))
  const fullDeckPageCount = Math.max(allPageRefs.length, pageRefs.length)
  const pageFileMap = Object.fromEntries(pageRefs.map((page) => [page.pageId, page.htmlPath]))
  const indexPath = path.join(context.entry.projectDir, 'index.html')
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
    '- 用户 brief 是无附件场景下的事实边界；未提供的部门、日期、姓名、数据、状态、反馈、决策和结论必须省略，不能补示例值或把验收目标写成已达成结果。',
    '- 页面角色只有四类：封面、可选目录、正文、固定结束页。所有非封面、非目录、非结束页必须使用正文页模板，不使用章节分隔页。',
    '- 固定结束页不参与模型生成，必须保持原模板的文字、图片、位置和样式完全不变。',
    '- 新增/复用的中间页统一沿用正文页模板，不得自行改用其他模板页型。',
    '- 公司正文页左上角约 347×128px 的橙色区域只是一块顶部标题区，不是贯穿整页的侧栏；正文从顶部约 150px 以下开始时必须使用全页宽度，并让正文视觉中心与 1600px 画布中心基本重合。',
    '- 左上角主标题和副标题各自保持单行，不得把一个汉字孤立在单独一行；标题较长时优先提炼短标题或缩小字号，完整长标题放到右侧结论区。'
  ].join('\n')
  const templateSinglePagePromptAddendum = [
    'Template design system for this slide:',
    '- The existing target page file is a copied template page base. Preserve its visual system and layout language.',
    '- Replace old text/data/media meaning with the new slide content, but do not redesign the whole page.',
    '- Treat background images, texture images, decorative images, masks, overlay layers, CSS background-image/url(...) references, and SVG image hrefs as template structure, not old business content.',
    '- Keep those template assets and their local paths in the written page unless the user explicitly asks to remove them; text/data changes must not strip the visual shell.',
    '- Keep color language, typography scale, spacing rhythm, component shapes, and chart/table styling unless a local adjustment is needed to avoid overlap.',
    '- Keep every title and visible text block fully inside the 1600x900 canvas. Do not use negative top offsets or clipping; preserve a visible top safe area and verify the first line is fully readable.',
    '- On a corporate body slide, the approximately 347x128 orange block at the top-left is a header title block only, never a full-height sidebar. Below y=150, use the full slide width with balanced left/right margins; keep the body visual center within 80px of x=800.',
    '- Keep each top-left header title row on one line. Never leave a single CJK character on its own line. Shorten the header label or reduce its font size when needed, and place the complete long-form title in the right conclusion header.',
    `- This deck has ${fullDeckPageCount} pages. Replace any sample footer total with ${fullDeckPageCount}; never retain a template example such as 20 pages.`,
    '- The user brief is the factual boundary when no source document is attached. Omit missing departments, dates, names, metrics, status claims, feedback, decisions, and conclusions instead of inventing them.',
    '- Without a source document, do not introduce user-feedback items, survey findings, acceptance conclusions, or unverified product capabilities even as generic examples.',
    '- If an outline only names a topic, write neutral verification actions such as check, confirm, record, or compare. Do not expand it into unsupported claims beginning with supports, provides, ensures, has completed, or has achieved.',
    '- Treat goals, risks, checks, and acceptance criteria as planned work unless the user explicitly provides evidence that they were achieved.',
    '- This target page already has its assigned template role. Do not substitute a contents, section-divider, cover, or closing layout for a body-page target.',
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
      projectDir: context.entry.projectDir,
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
  const contentPlanningPageRefs = pageRefs.filter(
    (page) => page.templateRole === 'cover' || page.templateRole === 'body'
  )
  const bodyPlanningPageRefs = pageRefs.filter((page) => page.templateRole === 'body')
  const confirmedPlan = normalizeConfirmedCorporatePagePlan(
    templateMetadata.confirmedCorporatePagePlan
  )
  if (templateMetadata.confirmedCorporatePagePlan !== undefined && !confirmedPlan) {
    throw new Error('已确认逐页计划格式无效，请返回首页重新确认。')
  }
  if (confirmedPlan && !context.templateRetry) {
    const confirmedPlanErrors = validateConfirmedCorporatePagePlan(
      confirmedPlan,
      pageRefs.map((page) => page.templateRole)
    )
    if (confirmedPlanErrors.length > 0) {
      throw new Error(
        `已确认逐页计划与当前模板页型不一致，请返回首页重新确认：${confirmedPlanErrors.join('；')}`
      )
    }
  }
  const shouldUseConfirmedPlan = !context.templateRetry && Boolean(confirmedPlan)
  const confirmedOutlineItems = confirmedPlan
    ? mapConfirmedCorporatePlanToOutlineItems(confirmedPlan)
    : []
  const shouldUseSourcePlan =
    !shouldUseConfirmedPlan &&
    !context.templateRetry &&
    canUseSourcePlanForTemplateBodyPages({
      sourcePlan: context.sourcePlan,
      templateRoles: pageRefs.map((page) => page.templateRole),
      userMessage: context.userMessage
    })
  const shouldPlanReferenceDocumentOnBodyPages =
    !context.templateRetry && (shouldUseSourcePlan || context.sourceDocumentPaths.length > 0)
  const planningPageRefs = shouldUseConfirmedPlan
    ? contentPlanningPageRefs
    : shouldPlanReferenceDocumentOnBodyPages
      ? bodyPlanningPageRefs
      : contentPlanningPageRefs
  const plannedOutlineItems = context.templateRetry
    ? contentPlanningPageRefs.map((page) => {
        const snapshot = latestPageSnapshot.find((item) => item.page_id === page.pageId)
        return {
          title: snapshot?.title?.trim() || page.title,
          contentOutline: snapshot?.content_outline?.trim() || '',
          layoutIntent: snapshot?.layout_intent
            ? normalizeLayoutIntent(snapshot.layout_intent)
            : undefined
        }
      })
    : shouldUseConfirmedPlan
      ? planningPageRefs.map((page) => confirmedOutlineItems[page.pageNumber - 1])
      : shouldUseSourcePlan && context.sourcePlan
        ? mapSourcePlanToOutlineItems(context.sourcePlan)
        : await planDeckWithLLM({
            provider: context.provider,
            apiKey: context.apiKey,
            model: context.model,
            baseUrl: context.providerBaseUrl,
            maxTokens: context.maxTokens,
            modelTimeoutMs: context.modelTimeouts.planning,
            temperature: PLANNER_TEMPERATURE,
            styleId: context.styleId,
            totalPages: planningPageRefs.length,
            appLocale: context.appLocale,
            topic: context.topic,
            userMessage: context.userMessage,
            sourceDocumentPaths: context.sourceDocumentPaths,
            emit: (chunk) => emitDeckChunk(chunk),
            runId: context.runId,
            signal: context.entry.abortController.signal
          })

  const groundedPlannedOutlineItems = shouldUseConfirmedPlan
    ? plannedOutlineItems
    : plannedOutlineItems.map((item) =>
        sanitizeTemplateOutlineItem(item, {
          userMessage: context.userMessage,
          hasSourceDocuments:
            context.sourceDocumentPaths.length > 0 ||
            Boolean(context.sourcePlan?.pageSkeleton.length)
        })
      )
  const plannedByPageId = new Map(
    planningPageRefs.map((page, index) => [page.pageId, groundedPlannedOutlineItems[index]])
  )
  const bodyTitles = bodyPlanningPageRefs.map(
    (page) => plannedByPageId.get(page.pageId)?.title?.trim() || page.title
  )
  const outlineItems = pageRefs.map((page) => {
    if (page.templateRole === 'closing') {
      return {
        title: '结束页',
        contentOutline: '',
        layoutIntent: 'cover' as const
      }
    }
    if (page.templateRole === 'agenda') {
      return {
        title: '目录',
        contentOutline: bodyTitles.map((title, index) => `${index + 1}. ${title}`).join('\n'),
        layoutIntent: 'summary' as const
      }
    }
    if (
      page.templateRole === 'cover' &&
      shouldPlanReferenceDocumentOnBodyPages &&
      !shouldUseConfirmedPlan
    ) {
      return {
        title: context.topic,
        contentOutline: '',
        layoutIntent: 'cover' as const
      }
    }
    const planned = plannedByPageId.get(page.pageId)
    return {
      title: planned?.title?.trim() || page.title,
      contentOutline: planned?.contentOutline?.trim() || '',
      layoutIntent: page.templateRole === 'cover' ? ('cover' as const) : planned?.layoutIntent
    }
  })
  if (shouldUseConfirmedPlan) {
    log.info('[generate:template] resolved page plan', {
      planSource: 'confirmed-user-plan',
      pages: outlineItems.map((item, index) => ({
        pageNumber: index + 1,
        title: item.title,
        contentLength: item.contentOutline.length
      }))
    })
  }
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
  const persistCompletedGeneratedPage = async (page: {
    pageNumber: number
    pageId: string
    title: string
    contentOutline: string
    layoutIntent?: LayoutIntent
    htmlPath: string
  }): Promise<void> => {
    if (!fs.existsSync(page.htmlPath)) {
      throw new Error(`${page.pageId}.html 缺失`)
    }
    const pageRef = pageRefs.find((item) => item.pageId === page.pageId)
    const sourceHtml = await fs.promises.readFile(page.htmlPath, 'utf-8')
    const html = normalizeCorporateTemplatePageChrome(sourceHtml, {
      pageNumber: page.pageNumber,
      totalPages: fullDeckPageCount,
      templateRole: pageRef?.templateRole || 'body'
    })
    if (html !== sourceHtml) {
      await fs.promises.writeFile(page.htmlPath, html, 'utf-8')
    }
    const validation = validatePersistedPageHtml(html, page.pageId)
    if (!validation.valid) {
      throw new Error(`HTML 验证失败 (${page.pageId}): ${validation.errors.join('; ')}`)
    }
    if (pageRef?.templateRole === 'body') {
      const bodyLayoutValidation = validateCorporateTemplateBodyPageLayout(html)
      if (!bodyLayoutValidation.valid) {
        throw new Error(
          `模板正文布局验证失败 (${page.pageId}): ${bodyLayoutValidation.errors.join('; ')}`
        )
      }
    }
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: page.contentOutline,
      layoutIntent: page.layoutIntent,
      htmlPath: page.htmlPath,
      status: 'completed'
    })
    persistedGeneratedPagesById.set(page.pageId, {
      pageNumber: page.pageNumber,
      title: page.title,
      pageId: page.pageId,
      htmlPath: page.htmlPath
    })
    completedTargetPageCount += 1
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
      htmlPath: page.htmlPath,
      status: 'failed',
      error: page.reason
    })
    await persistGenerationSnapshotMetadata()
  }

  const generationPageRefs = pageRefs.filter((page) => page.templateRole !== 'closing')
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
    pageTasks: generationPageRefs.map((page) => {
      const outlineIndex = pageRefs.findIndex((item) => item.pageId === page.pageId)
      const outlineItem = outlineItems[outlineIndex]
      return {
        pageNumber: page.pageNumber,
        pageId: page.pageId,
        title: page.title,
        contentOutline: outlineItem?.contentOutline || '',
        layoutIntent: outlineItem?.layoutIntent
      }
    }),
    sourceDocumentPaths: context.sourceDocumentPaths,
    designContract: templateDesignContract,
    systemPromptAddendum: templateSystemPromptAddendum,
    singlePagePromptAddendum: templateSinglePagePromptAddendum,
    requireTemplatePageRead: true,
    generationMode: 'generate',
    projectDir: context.entry.projectDir,
    indexPath,
    pageFileMap,
    agentManager,
    emit: (chunk) => emitDeckChunk(chunk),
    onPageCompleted: persistCompletedGeneratedPage,
    onPageFailed: persistFailedGeneratedPage,
    runId: context.runId,
    signal: context.entry.abortController.signal
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
    if (pageRef.templateRole === 'body') {
      const bodyLayoutValidation = validateCorporateTemplateBodyPageLayout(html)
      if (!bodyLayoutValidation.valid) {
        postValidationFailures.push({
          pageId: pageRef.pageId,
          title: pageRef.title,
          reason: bodyLayoutValidation.errors.join('; ')
        })
        continue
      }
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
  await db.updateGenerationRunStatus(context.runId, 'completed', null)
  await finalizeGenerationSuccess(ctx, {
    context,
    indexPath,
    totalPages: fullDeckPageCount,
    generatedPages: pageDescriptors
  })
  await persistGenerationSnapshotMetadata()
}
