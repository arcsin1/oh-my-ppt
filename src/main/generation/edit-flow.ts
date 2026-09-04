import type { EditContext, EmitAssistantFn, GenerateChatType } from './types'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import { FilesystemBackend, createDeepAgent } from 'deepagents'
import { z } from 'zod'
import {
  buildEditNoChangeRetryMessage,
  buildEditToolSchemaRetryMessage,
  buildEditValidationRetryMessage,
  type EditedPageDescriptor,
  isEditToolSchemaRetryableError,
  isEditValidationRetryableError,
  resolvePageHtmlPath,
  uiText,
  validateChangedPages
} from './generation-utils'
import log from 'electron-log/main.js'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import { nanoid } from 'nanoid'
import { normalizeLayoutIntent } from '@shared/layout-intent'
import { hasCompatiblePageLayoutSource, validateLayoutSlots } from './layout-slot-validator'
import { runDeepAgentEdit } from './agent-runner'
import { createPageImageFinalizer } from './page-image-finalizer'
import { buildGenerationImageIntentRules } from '../agent-runtime/prompt/composers/generation-image-intent-rules'
import { getLayoutMasterTemplate } from '@shared/layout-master'
import { formatSelectedElementRuntimeContext } from '../agent-runtime/prompt/selected-element-context'
import {
  type DesignContract,
  SESSION_PAGE_EDIT_INTENTS,
  type GeneratedPagePayload,
  type PageReferenceContext,
  type SessionPageEditAssessment,
  type SessionPageEditPlan,
  type SelectedElementRuntimeContext
} from '@shared/generation'
import { resolveModel } from '../agent-runtime/model'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import { resolveGlobalModelTimeouts, resolveModelConfigForTask } from '../config/model-config-utils'
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
import { resolvePageReferenceContext } from './source-plan'
import {
  buildLocalSuccessfulEditSummary,
  emitSuccessfulEditSummary
} from './edit-summary'

const sessionPageEditAssessmentSchema = z.object({
  intent: z.enum(SESSION_PAGE_EDIT_INTENTS),
  target: z.string().min(1).max(500),
  summary: z.string().min(1).max(1500),
  changes: z.array(z.string().min(1).max(500)).min(1).max(8),
  confirmationQuestion: z.string().min(1).max(300),
  requiresConfirmation: z.boolean()
})

type PageEditAssessmentResult = SessionPageEditAssessment & {
  reply: string
  targetPageId: string
  targetPageNumber?: number
}

type RecordedSessionPageEditAssessment = SessionPageEditPlan & {
  requiresConfirmation: boolean
}

const buildApprovedPlanInstruction = (plan: SessionPageEditPlan | undefined): string => {
  if (!plan) return ''
  return [
    '[User-approved edit plan]',
    `Intent: ${plan.intent}`,
    `Target: ${plan.target}`,
    `Summary: ${plan.summary}`,
    'Approved changes:',
    ...plan.changes.map((change, index) => `${index + 1}. ${change}`),
    'Apply this approved scope. If page source requires a small implementation adjustment, keep the result within the approved intent and changes.'
  ].join('\n')
}

const buildPageEditAssessmentSystemPrompt = (locale: 'zh' | 'en', args: {
  targetPageId: string
  targetPageNumber?: number
  selector?: string
  elementTag?: string
  elementText?: string
  selectedElementContext?: SelectedElementRuntimeContext
}): string => {
  const target = `/${args.targetPageId}.html${args.targetPageNumber ? ` (slide ${args.targetPageNumber})` : ''}`
  const selectorContext = [
    args.selector ? `CSS selector: ${args.selector}` : '',
    args.elementTag ? `Element: <${args.elementTag}>${args.elementText ? ` ${args.elementText}` : ''}` : '',
    formatSelectedElementRuntimeContext(args.selectedElementContext)
  ]
    .filter(Boolean)
    .join('\n')
  const localeRule = locale === 'en' ? 'Use English.' : '使用简体中文。'
  return [
    'You are a presentation page-edit intent and execution-risk assessor.',
    'This is a read-only assessment phase. You must never modify, create, rename, or delete files.',
    'You may inspect the project files only to understand the target page and selected element.',
    'Do not propose changes outside the target page. Preserve unrelated content and page shell structure.',
    'Before finishing, call record_session_page_edit_assessment exactly once.',
    'Set requiresConfirmation=false only when the request has a concrete target and outcome, and can be applied without choosing a design direction, scope, or content strategy.',
    'Set requiresConfirmation=true when the request is ambiguous, broad, requests optimization/redesign, has multiple plausible outcomes, or could change meaning or page structure beyond an explicit local instruction.',
    'Always provide the concrete proposed changes. They are shown to the user only when confirmation is required.',
    localeRule,
    '',
    `Target page: ${target}`,
    selectorContext
  ]
    .filter(Boolean)
    .join('\n')
}

const buildPageEditAssessmentUserPrompt = (args: {
  userMessage: string
  imagePrompt: string
  targetPageId: string
  targetPageNumber?: number
  selector?: string
  elementTag?: string
  elementText?: string
  selectedElementContext?: SelectedElementRuntimeContext
}): string =>
  [
    'Assess the edit intent and whether explicit confirmation is required. Do not perform the edit.',
    '',
    'User request:',
    args.userMessage,
    args.imagePrompt,
    '',
    `Target page: ${args.targetPageId}${args.targetPageNumber ? ` (slide ${args.targetPageNumber})` : ''}`,
    args.selector ? `Target selector: ${args.selector}` : '',
    args.elementTag ? `Target element: <${args.elementTag}>${args.elementText ? ` ${args.elementText}` : ''}` : '',
    formatSelectedElementRuntimeContext(args.selectedElementContext)
  ]
    .filter(Boolean)
    .join('\n')

const createSessionPageEditAssessmentTool = (): {
  tool: StructuredToolInterface
  getAssessment: () => SessionPageEditAssessment | null
} => {
  let assessment: RecordedSessionPageEditAssessment | null = null
  const recorder = tool(
    async (input) => {
      assessment = input as RecordedSessionPageEditAssessment
      return assessment.requiresConfirmation
        ? 'Assessment recorded. The host will show the proposed plan to the user for confirmation.'
        : 'Assessment recorded. The host will start the existing page-edit job directly.'
    },
    {
      name: 'record_session_page_edit_assessment',
      description:
        'Record the single-page edit intent, scope, proposed changes, and whether user confirmation is needed. Call exactly once for every request. This tool only records an assessment and cannot modify the presentation.',
      schema: sessionPageEditAssessmentSchema
    }
  )
  return {
    tool: recorder as unknown as StructuredToolInterface,
    getAssessment: () => {
      if (!assessment) return null
      const { requiresConfirmation, ...plan } = assessment
      return { plan, requiresConfirmation }
    }
  }
}

export async function assessPageEdit(
  ctx: GenerationContext,
  payload: unknown,
  signal?: AbortSignal
): Promise<PageEditAssessmentResult> {
  const input = normalizeGeneratePayload(payload)
  if (!input.sessionId) throw new Error('sessionId 不能为空')
  if (input.requestedType !== 'page' || input.chatType !== 'page') {
    throw new Error('仅支持分析当前页面的修改请求')
  }
  if (!input.rawUserMessage.trim()) throw new Error('请输入页面修改需求')
  const requestedPageId = input.chatPageId || input.selectedPageId
  if (!requestedPageId) throw new Error('页面修改分析需要指定目标页面')

  const [session, pages, activeModel, modelTimeouts] = await Promise.all([
    ctx.db.getSession(input.sessionId),
    ctx.db.listSessionPages(input.sessionId),
    resolveModelConfigForTask(
      { db: ctx.db, decryptApiKey: ctx.credentials.decryptApiKey },
      {
      modelConfigId: input.modelConfigId,
      purpose: 'generation:page-edit-plan'
      }
    ),
    resolveGlobalModelTimeouts({ db: ctx.db })
  ])
  if (!session) throw new Error('Session not found')
  if (!activeModel.apiKey) {
    throw new Error(`当前 provider "${activeModel.provider}" 缺少 API Key，请先到设置页配置。`)
  }
  const page = pages.find((item) => item.id === requestedPageId || item.file_slug === requestedPageId)
  if (!page) throw new Error(`Selected page not found in session_pages: ${requestedPageId}`)
  const projectDir = await ctx.sessionProject.resolveSessionProjectDir(input.sessionId)
  const pagePath = resolvePageHtmlPath({
    projectDir,
    fileSlug: page.file_slug,
    candidates: [page.html_path]
  })
  if (!fs.existsSync(pagePath)) throw new Error(`目标页面文件不存在: ${page.file_slug}.html`)

  const appLocale = (await ctx.db.getAllSettings()).locale === 'en' ? 'en' : 'zh'
  const model = resolveModel(
    activeModel.provider,
    activeModel.apiKey,
    activeModel.model,
    activeModel.baseUrl,
    0.2,
    activeModel.maxTokens,
    ctx.modelRuntime
  )
  const assessmentRecorder = createSessionPageEditAssessmentTool()
  const agent = createDeepAgent({
    model: model as any,
    backend: new FilesystemBackend({ rootDir: projectDir, virtualMode: true }),
    tools: [assessmentRecorder.tool] as unknown as StructuredToolInterface[],
    permissions: [
      { operations: ['read'], paths: ['/**'] },
      { operations: ['write'], paths: ['/**'], mode: 'deny' }
    ],
    systemPrompt: buildPageEditAssessmentSystemPrompt(appLocale, {
      targetPageId: page.file_slug,
      targetPageNumber: page.page_number,
      selector: input.selector,
      elementTag: input.elementTag,
      elementText: input.elementText,
      selectedElementContext: input.selectedElementContext
    })
  })
  const imagePrompt = ctx.localFiles.formatImagePathsForPrompt(input.rawImagePaths, input.rawVideoPaths)
  const stream = await agent.stream(
    {
      messages: [
        {
          role: 'user',
          content: buildPageEditAssessmentUserPrompt({
            userMessage: input.rawUserMessage,
            imagePrompt,
            targetPageId: page.file_slug,
            targetPageNumber: page.page_number,
            selector: input.selector,
            elementTag: input.elementTag,
            elementText: input.elementText,
            selectedElementContext: input.selectedElementContext
          })
        }
      ]
    },
    {
      streamMode: ['updates', 'messages'],
      subgraphs: true,
      signal: signal
        ? AbortSignal.any([
            signal,
            AbortSignal.timeout(resolveModelTimeoutMs(modelTimeouts.planning, 'planning'))
          ])
        : AbortSignal.timeout(resolveModelTimeoutMs(modelTimeouts.planning, 'planning'))
    }
  )
  for await (const _chunk of stream as AsyncIterable<unknown>) {
    // Consuming the stream executes the read-only assessment tool call.
  }
  const assessment = assessmentRecorder.getAssessment()
  if (!assessment) throw new Error('AI 未完成页面修改意图分析，请重试或补充需求。')
  log.info('[page-edit:assess] complete', {
    sessionId: input.sessionId,
    targetPageId: page.file_slug,
    targetPageNumber: page.page_number,
    intent: assessment.plan.intent,
    requiresConfirmation: assessment.requiresConfirmation
  })
  return {
    reply: assessment.plan.summary,
    ...assessment,
    targetPageId: page.file_slug,
    targetPageNumber: page.page_number
  }
}

export async function resolveEditContext(
  ctx: GenerationContext,
  _event: Electron.IpcMainInvokeEvent,
  payload: unknown,
  execution?: RuntimeJobExecutionContext
): Promise<EditContext> {
  const input = normalizeGeneratePayload(payload)
  const { db, localFiles } = ctx
  if (!input.sessionId) throw new Error('sessionId 不能为空')

  const common = await resolveCommonContext(ctx, input.sessionId, input.modelConfigId, execution)
  const sourceDocumentPaths = await resolveSourceDocuments(ctx, {
    sessionId: input.sessionId,
    projectDir: common.projectDir,
    rawDocPaths: input.rawDocPaths,
    mode: 'edit',
    sessionRecord: common.sessionRecord
  })
  const referenceDocumentPath =
    resolveSessionReferenceDocumentPath(common.projectDir, common.sessionRecord) ?? undefined
  const imagePaths = input.rawImagePaths
  const videoPaths = input.rawVideoPaths
  const userMessage = [
    input.rawUserMessage,
    localFiles.formatImagePathsForPrompt(imagePaths, videoPaths),
    buildApprovedPlanInstruction(input.approvedPlan)
  ]
    .filter(Boolean)
    .join('\n\n')
  const chatType: GenerateChatType = input.chatType
  const chatPageId = chatType === 'page' ? input.chatPageId || input.selectedPageId : undefined
  if (chatType === 'page' && !chatPageId) {
    throw new Error('chatType=page requires chatPageId or selectedPageId')
  }

  if (input.persistUserMessage) {
    await db.addMessage(input.sessionId, {
      id: input.clientMessageId,
      role: 'user',
      content: input.rawUserMessage,
      type: 'text',
      chat_scope: chatType,
      page_id: chatType === 'page' ? chatPageId : undefined,
      selector: chatType === 'page' ? input.selector : undefined,
      image_paths: imagePaths,
      video_paths: videoPaths,
      run_model: common.runModel
    })
  }
  await db.updateSessionStatus(input.sessionId, 'active')

  return {
    sessionId: input.sessionId,
    userMessage,
    requestedType: 'page',
    effectiveMode: 'edit',
    resetVisualStyle: input.resetVisualStyle,
    selectedPageId: input.selectedPageId,
    selectPageIds: input.chatType === 'main' ? input.selectPageIds : [],
    htmlPath: input.htmlPath,
    selector: input.selector,
    elementTag: input.elementTag,
    elementText: input.elementText,
    selectedElementContext: input.selectedElementContext,
    session: common.session,
    sessionRecord: common.sessionRecord,
    previousSessionStatus: common.previousSessionStatus,
    projectDir: common.projectDir,
    abortSignal: common.abortSignal,
    runId: common.runId,
    styleId: common.styleId,
    styleSkill: common.styleSkill,
    visualEnabled: common.visualEnabled,
    imageModelConfigId: common.imageModelConfigId,
    imageGenerationPrompt: common.imageGenerationPrompt,
    styleKey: common.styleKey,
    styleName: common.styleName,
    styleVersion: common.styleVersion,
    slideSize: common.slideSize,
    userProvidedOutlineTitles: buildOutlineTitles(input.rawUserMessage),
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
    messageScope: chatType,
    messagePageId: chatType === 'page' ? chatPageId : undefined,
    imagePaths,
    videoPaths,
    sourceDocumentPaths,
    referenceDocumentPath,
    sourcePlan: common.sourcePlan,
    topic: common.topic,
    deckTitle: common.deckTitle,
    appLocale: common.appLocale,
    fontSelection: common.fontSelection,
    animationPreferences: null
  }
}

export async function executeEditGeneration(
  ctx: GenerationContext,
  emitAssistant: EmitAssistantFn,
  context: EditContext
): Promise<void> {
  const {
    db,
    agentManager,
    sessionProject: { getPageSourceUrl, validateProjectIndexHtml },
    runtimeEmitters: { createDeckProgressEmitter },
    tuning: {
      pageEditWithSelectorTemperature: PAGE_EDIT_WITH_SELECTOR_TEMPERATURE,
      pageEditDefaultTemperature: PAGE_EDIT_DEFAULT_TEMPERATURE
    }
  } = ctx

  if (!context.apiKey) {
    throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
  }
  if (context.messageScope === 'main') {
    throw new Error('主会话编辑需要走 deck 全页编辑流程，不能进入单页编辑流程。')
  }

  const indexPath = path.join(context.projectDir, 'index.html')
  const pageIdFromPath =
    typeof context.htmlPath === 'string'
      ? path.basename(context.htmlPath).match(/^([a-z0-9_-]+)\.html$/i)?.[1]
      : undefined
  let resolvedSelectedPageId = context.selectedPageId || pageIdFromPath
  const selectedSelector = context.selector

  let outlineTitles: string[] = context.userProvidedOutlineTitles
  let pageRefs: Array<{
    id: string
    pageNumber: number
    title: string
    pageId: string
    htmlPath: string
  }> = []
  let savedDesignContract: DesignContract | undefined
  const sessionPages = await db.listSessionPages(context.sessionId)
  if (sessionPages.length === 0) {
    throw new Error('session_pages is empty after migration; cannot edit this session')
  }
  const layoutSourceByPageId = new Map(
    sessionPages.map((page) => [
      page.file_slug,
      {
        layoutIntent: page.layout_intent ? normalizeLayoutIntent(page.layout_intent) : null,
        layoutId: page.layout_id,
        layoutContractVersion: page.layout_contract_version
      }
    ])
  )
  const pageReferenceContexts: Record<string, PageReferenceContext> = {}
  for (const page of sessionPages) {
    const pageReferenceContext = resolvePageReferenceContext({
      referenceDocumentPath: context.referenceDocumentPath,
      sourcePlan: context.sourcePlan,
      pageNumber: page.page_number
    })
    if (pageReferenceContext) pageReferenceContexts[page.file_slug] = pageReferenceContext
  }
  const selectedSessionPage = resolvedSelectedPageId
    ? sessionPages.find(
        (page) => page.id === resolvedSelectedPageId || page.file_slug === resolvedSelectedPageId
      )
    : undefined
  if (selectedSessionPage) {
    resolvedSelectedPageId = selectedSessionPage.file_slug
  }
  pageRefs = sessionPages.map((page) => ({
    id: page.id,
    pageNumber: page.page_number,
    title: page.title || `第${page.page_number}页`,
    pageId: page.file_slug,
    htmlPath: resolvePageHtmlPath({
      projectDir: context.projectDir,
      fileSlug: page.file_slug,
      candidates: [page.html_path]
    })
  }))
  if (outlineTitles.length === 0) {
    outlineTitles = pageRefs.map((page) => page.title)
  }
  const latestPageSnapshot = await db.listLatestGenerationPageSnapshot(context.sessionId)
  const failedPageInfoById = new Map<string, { title: string; reason: string }>()
  for (const page of sessionPages) {
    if (page.status !== 'failed') continue
    failedPageInfoById.set(page.file_slug, {
      title: page.title || page.file_slug,
      reason: page.error || '页面仍需修复'
    })
  }
  // Read designContract from the dedicated column
  const sessionRecord = (context.session || {}) as Record<string, unknown>
  if (
    typeof sessionRecord.designContract === 'string' &&
    sessionRecord.designContract.trim().length > 0
  ) {
    try {
      savedDesignContract = JSON.parse(sessionRecord.designContract) as DesignContract
    } catch {
      /* ignore */
    }
  }
  if (resolvedSelectedPageId && !pageRefs.some((ref) => ref.pageId === resolvedSelectedPageId)) {
    throw new Error(`Selected page not found in session_pages: ${resolvedSelectedPageId}`)
  }
  pageRefs.sort((a, b) => a.pageNumber - b.pageNumber)
  if (!resolvedSelectedPageId && pageRefs.length > 0) {
    resolvedSelectedPageId = pageRefs[0].pageId
  }
  const resolvedSelectedPageNumber =
    pageRefs.find((ref) => ref.pageId === resolvedSelectedPageId)?.pageNumber || undefined
  const editTotalPages = 1
  if (outlineTitles.length !== pageRefs.length) {
    outlineTitles = pageRefs.map((ref) => ref.title)
  }

  const outlineByPageId = new Map(
    latestPageSnapshot.map((page) => [page.page_id, page.content_outline || ''])
  )
  const layoutIntentByPageId = new Map(
    latestPageSnapshot.map((page) => [
      page.page_id,
      page.layout_intent ? normalizeLayoutIntent(page.layout_intent) : undefined
    ])
  )
  const outlineItems = pageRefs.map((ref) => ({
    title: ref.title,
    contentOutline: outlineByPageId.get(ref.pageId) || '',
    layoutIntent: layoutIntentByPageId.get(ref.pageId)
  }))
  const pageFileMap = Object.fromEntries(pageRefs.map((p) => [p.pageId, p.htmlPath]))
  const pageNumbers = Object.fromEntries(pageRefs.map((p) => [p.pageId, p.pageNumber]))
  const beforeMap = new Map<string, string>()
  const existingPageIdsBeforeRun: string[] = []
  const beforeReads = await Promise.all(
    pageRefs.map(async (ref) => {
      if (!fs.existsSync(ref.htmlPath)) return null
      const html = await fs.promises.readFile(ref.htmlPath, 'utf-8')
      return { pageId: ref.pageId, html }
    })
  )
  for (const item of beforeReads) {
    if (!item) continue
    existingPageIdsBeforeRun.push(item.pageId)
    beforeMap.set(item.pageId, item.html)
  }

  const emitEditChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)

  emitEditChunk({
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'editing',
      label: resolvedSelectedPageNumber
        ? uiText(
            context.appLocale,
            `正在准备编辑第 ${resolvedSelectedPageNumber} 页`,
            `Preparing to edit page ${resolvedSelectedPageNumber}`
          )
        : uiText(context.appLocale, '正在定位需要编辑的页面', 'Locating pages to edit'),
      progress: 10,
      totalPages: editTotalPages
    }
  })

  const editTemperature = selectedSelector
    ? PAGE_EDIT_WITH_SELECTOR_TEMPERATURE
    : PAGE_EDIT_DEFAULT_TEMPERATURE

  const beforeIndexHtml = fs.existsSync(indexPath)
    ? await fs.promises.readFile(indexPath, 'utf-8')
    : ''
  await ctx.history.ensureBaseline(context.sessionId, context.projectDir)

  const editRunArgs = {
    sessionId: context.sessionId,
    provider: context.provider,
    apiKey: context.apiKey,
    model: context.model,
    baseUrl: context.providerBaseUrl,
    maxTokens: context.maxTokens,
    modelTimeoutMs: context.modelTimeouts.agent,
    temperature: editTemperature,
    styleId: context.styleId,
    styleSkillPrompt: context.styleSkill.prompt,
    hasStyleImageDirection: Boolean(context.imageGenerationPrompt.trim()),
    styleKey: context.styleKey,
    styleName: context.styleName,
    styleVersion: context.styleVersion,
    slideSize: context.slideSize,
    appLocale: context.appLocale,
    topic: context.topic,
    deckTitle: context.deckTitle,
    userMessage: context.userMessage,
    imageIntentAddendum: (() => {
      if (selectedSelector || !context.visualEnabled || !resolvedSelectedPageId) return ''
      const source = layoutSourceByPageId.get(resolvedSelectedPageId)
      if (
        !source?.layoutIntent ||
        !source.layoutId ||
        !source.layoutContractVersion ||
        !hasCompatiblePageLayoutSource(source)
      ) {
        return ''
      }
      const template = getLayoutMasterTemplate(source.layoutId)
      return template
        ? buildGenerationImageIntentRules({
            visualEnabled: true,
            template,
            hasStyleImageDirection: Boolean(context.imageGenerationPrompt.trim())
          })
        : ''
    })(),
    outlineTitles,
    outlineItems,
    sourceDocumentPaths: context.sourceDocumentPaths,
    referenceDocumentPath: context.referenceDocumentPath,
    pageReferenceContexts,
    projectDir: context.projectDir,
    indexPath,
    pageFileMap,
    pageNumbers,
    designContract: savedDesignContract,
    editScope: 'page',
    selectedPageId: resolvedSelectedPageId,
    selectedPageNumber: resolvedSelectedPageNumber,
    selectedSelector,
    elementTag: context.elementTag,
    elementText: context.elementText,
    selectedElementContext: context.selectedElementContext,
    existingPageIds: existingPageIdsBeforeRun,
    finalizeEditedPage: selectedSelector
      ? undefined
      : async (pageId, refineImageLayout) => {
          const ref = pageRefs.find((item) => item.pageId === pageId)
          const source = layoutSourceByPageId.get(pageId)
          if (!ref) return
          if (
            !source?.layoutIntent ||
            !source.layoutId ||
            !source.layoutContractVersion ||
            !hasCompatiblePageLayoutSource(source)
          ) {
            log.info('[images:fulfillment] page skipped', {
              sessionId: context.sessionId,
              runId: context.runId,
              pageId,
              reason: 'page edit has no compatible layout source',
              layoutIntent: source?.layoutIntent || null,
              layoutId: source?.layoutId || null,
              layoutContractVersion: source?.layoutContractVersion || null
            })
            return
          }
          const finalizer = createPageImageFinalizer(ctx, {
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
          })
          await finalizer(
            {
              pageNumber: ref.pageNumber,
              pageId: ref.pageId,
              title: ref.title,
              contentOutline: outlineByPageId.get(ref.pageId) || '',
              layoutIntent: source.layoutIntent || undefined,
              layoutId: source.layoutId,
              layoutContractVersion: source.layoutContractVersion,
              htmlPath: ref.htmlPath
            },
            refineImageLayout
          )
        },
    agentManager,
    emit: (chunk) => emitEditChunk(chunk),
    runId: context.runId,
    signal: context.abortSignal
  } satisfies Parameters<typeof runDeepAgentEdit>[0]
  const runEditAttempt = async (userMessage: string, retryDetail?: string): Promise<void> => {
    if (retryDetail) {
      emitEditChunk({
        type: 'llm_status',
        payload: {
          runId: context.runId,
          stage: 'editing',
          label: resolvedSelectedPageNumber
            ? uiText(
                context.appLocale,
                `正在重试第 ${resolvedSelectedPageNumber} 页的编辑`,
                `Retrying the edit for page ${resolvedSelectedPageNumber}`
              )
            : uiText(context.appLocale, '正在重试页面编辑', 'Retrying the page edit'),
          progress: 55,
          totalPages: editTotalPages,
          detail: retryDetail
        }
      })
    }
    return runDeepAgentEdit({ ...editRunArgs, userMessage })
  }
  let editToolSchemaRetryUsed = false
  let editValidationRetryUsed = false
  const failWithUserMessage = async (userMessage: string): Promise<never> => {
    await db.updateGenerationRunStatus(context.runId, 'failed', userMessage)
    throw new Error(userMessage)
  }
  const runRetryAttempt = async (
    userMessage: string,
    retryDetail: string,
    failureMessage: string,
    logLabel: string
  ): Promise<void> => {
    try {
      await runEditAttempt(userMessage, retryDetail)
    } catch (retryError) {
      log.error(logLabel, {
        sessionId: context.sessionId,
        runId: context.runId,
        detail: retryError instanceof Error ? retryError.message : String(retryError)
      })
      return failWithUserMessage(failureMessage)
    }
  }
  try {
    await runEditAttempt(context.userMessage)
  } catch (error) {
    const canRetryByValidation = isEditValidationRetryableError(error)
    const canRetryBySchema = isEditToolSchemaRetryableError(error)
    if (!canRetryByValidation && !canRetryBySchema) throw error
    if (canRetryBySchema) {
      editToolSchemaRetryUsed = true
    } else {
      editValidationRetryUsed = true
    }
    const detail = error instanceof Error ? error.message : String(error)
    log.warn('[generate:start] edit validation/tool retry scheduled', {
      sessionId: context.sessionId,
      runId: context.runId,
      detail,
      kind: canRetryBySchema ? 'tool_schema' : 'validation'
    })
    const retryMessage = canRetryBySchema
      ? buildEditToolSchemaRetryMessage({
          originalMessage: context.userMessage,
          detail,
          allowedTool: selectedSelector ? 'edit_file' : 'update_single_page_file',
          selectedPageId: resolvedSelectedPageId || null
        })
      : buildEditValidationRetryMessage(context.userMessage, detail)
    await runRetryAttempt(
      retryMessage,
      uiText(
        context.appLocale,
        canRetryBySchema
          ? '工具调用参数不完整，正在自动重试一次。'
          : '页面校验失败，正在自动重试一次。',
        canRetryBySchema
          ? 'Tool call schema invalid; retrying once.'
          : 'Page validation failed; retrying once.'
      ),
      uiText(
        context.appLocale,
        '页面编辑重试失败，请重新描述要修改的内容。',
        'Page edit retry failed. Please describe the desired change again.'
      ),
      '[generate:start] edit retry failed'
    )
  }
  const afterIndexHtml = fs.existsSync(indexPath)
    ? await fs.promises.readFile(indexPath, 'utf-8')
    : ''
  const indexChanged = beforeIndexHtml !== afterIndexHtml
  if (indexChanged) {
    const indexValidationErrors = validateProjectIndexHtml(afterIndexHtml)
    if (indexValidationErrors.length > 0) {
      const details = indexValidationErrors.join('; ')
      log.error('[generate:start] edit index validation failed', {
        sessionId: context.sessionId,
        runId: context.runId,
        details
      })
      await failWithUserMessage(
        uiText(
          context.appLocale,
          '页面壳层校验失败，请重新描述要修改的内容。',
          'Page shell validation failed. Please describe the desired change again.'
        )
      )
    }
  }

  let pageDescriptors: EditedPageDescriptor[] = []
  let changedPageDescriptors: EditedPageDescriptor[] = []
  const readEditedPages = async (): Promise<{
    pageDescriptors: typeof pageDescriptors
    changedPageDescriptors: typeof changedPageDescriptors
  }> => {
    const nextPageDescriptors: typeof pageDescriptors = []
    const nextChangedPageDescriptors: typeof changedPageDescriptors = []
    const editedPageReads = await Promise.all(
      pageRefs.map(async (ref) => {
        if (!fs.existsSync(ref.htmlPath)) return null
        const html = await fs.promises.readFile(ref.htmlPath, 'utf-8')
        return { ref, html }
      })
    )
    for (const item of editedPageReads) {
      if (!item) continue
      const { ref, html } = item
      nextPageDescriptors.push({
        id: ref.id,
        pageNumber: ref.pageNumber,
        title: ref.title,
        pageId: ref.pageId,
        html,
        htmlPath: ref.htmlPath
      })
      const isExisting = existingPageIdsBeforeRun.includes(ref.pageId)
      const changed = beforeMap.get(ref.pageId) !== html
      if (!changed && isExisting) continue
      nextChangedPageDescriptors.push({
        id: ref.id,
        pageNumber: ref.pageNumber,
        title: ref.title,
        pageId: ref.pageId,
        html,
        htmlPath: ref.htmlPath
      })
    }
    return {
      pageDescriptors: nextPageDescriptors,
      changedPageDescriptors: nextChangedPageDescriptors
    }
  }
  ;({ pageDescriptors, changedPageDescriptors } = await readEditedPages())

  if (!selectedSelector && changedPageDescriptors.length === 0) {
    const detail = uiText(
      context.appLocale,
      '本次编辑没有检测到任何页面落盘变化。',
      'The edit completed without any detected page changes.'
    )
    log.warn('[generate:start] edit no-change retry scheduled', {
      sessionId: context.sessionId,
      runId: context.runId,
      selectedPageId: resolvedSelectedPageId || null,
      detail,
      schemaRetryUsed: editToolSchemaRetryUsed
    })
    await runRetryAttempt(
      buildEditNoChangeRetryMessage({
        originalMessage: context.userMessage,
        allowedTool: 'update_single_page_file',
        selectedPageId: resolvedSelectedPageId || null
      }),
      uiText(
        context.appLocale,
        '没有检测到页面变化，正在自动重试一次。',
        'No page changes detected; retrying once.'
      ),
      uiText(
        context.appLocale,
        '页面编辑重试后仍未产生变化，请重新描述要修改的内容。',
        'The page edit still did not produce changes after retry. Please describe the desired change again.'
      ),
      '[generate:start] edit no-change retry failed'
    )
    ;({ pageDescriptors, changedPageDescriptors } = await readEditedPages())
    if (changedPageDescriptors.length === 0) {
      const message = uiText(
        context.appLocale,
        '页面编辑没有产生任何落盘变化，请重新描述要修改的页面内容。',
        'The page edit did not produce any persisted page changes. Please describe the desired page content change again.'
      )
      await db.updateGenerationRunStatus(context.runId, 'failed', message)
      throw new Error(message)
    }
  }

  const invalidChangedPages = validateChangedPages(changedPageDescriptors)
  if (invalidChangedPages.length > 0) {
    const details = invalidChangedPages
      .map((item) => `${item.page.pageId}（${item.page.title}）：${item.reason}`)
      .join('；')
    if (editValidationRetryUsed) {
      log.error('[generate:start] edit result validation failed after retry', {
        sessionId: context.sessionId,
        runId: context.runId,
        details
      })
      await failWithUserMessage(
        uiText(
          context.appLocale,
          '页面编辑结果校验失败，请重新描述要修改的内容。',
          'Page edit validation failed. Please describe the desired change again.'
        )
      )
    }
    editValidationRetryUsed = true
    log.warn('[generate:start] edit result validation retry scheduled', {
      sessionId: context.sessionId,
      runId: context.runId,
      details
    })
    await runRetryAttempt(
      buildEditValidationRetryMessage(context.userMessage, `页面编辑结果验证失败：${details}`),
      uiText(
        context.appLocale,
        '页面校验失败，正在自动重试一次。',
        'Page validation failed; retrying once.'
      ),
      uiText(
        context.appLocale,
        '页面编辑重试失败，请重新描述要修改的内容。',
        'Page edit retry failed. Please describe the desired change again.'
      ),
      '[generate:start] edit validation retry failed'
    )
    ;({ pageDescriptors, changedPageDescriptors } = await readEditedPages())
    const retryInvalidChangedPages = validateChangedPages(changedPageDescriptors)
    if (retryInvalidChangedPages.length > 0) {
      const retryDetails = retryInvalidChangedPages
        .map((item) => `${item.page.pageId}（${item.page.title}）：${item.reason}`)
        .join('；')
      log.error('[generate:start] edit result validation failed after retry', {
        sessionId: context.sessionId,
        runId: context.runId,
        details: retryDetails
      })
      await failWithUserMessage(
        uiText(
          context.appLocale,
          '页面编辑结果校验失败，请重新描述要修改的内容。',
          'Page edit validation failed. Please describe the desired change again.'
        )
      )
    }
  }

  const detachedLayoutSourcePageIds = new Set<string>()
  if (!selectedSelector) {
    for (const page of changedPageDescriptors) {
      const source = layoutSourceByPageId.get(page.pageId)
      const validation = validateLayoutSlots({
        html: page.html,
        layoutIntent: source?.layoutIntent,
        layoutId: source?.layoutId,
        layoutContractVersion: source?.layoutContractVersion
      })
      if (!validation.valid) {
        detachedLayoutSourcePageIds.add(page.pageId)
      }
    }
  }

  for (const page of changedPageDescriptors) {
    const isExisting = existingPageIdsBeforeRun.includes(page.pageId)
    const payload: GeneratedPagePayload = {
      id: page.id,
      pageNumber: page.pageNumber,
      title: page.title,
      html: page.html,
      pageId: page.pageId,
      htmlPath: page.htmlPath,
      sourceUrl: getPageSourceUrl(page.htmlPath)
    }
    emitEditChunk({
      type: isExisting ? 'page_updated' : 'page_generated',
      payload: {
        runId: context.runId,
        stage: 'editing',
        label: progressText(context.appLocale, 'completed'),
        progress: 90,
        currentPage: page.pageNumber,
        totalPages: editTotalPages,
        ...payload
      }
    })
  }

  const changedPageIdSet = new Set(changedPageDescriptors.map((page) => page.pageId))
  for (const page of changedPageDescriptors) {
    const outlineItem = outlineItems.find((_item, index) => pageRefs[index]?.pageId === page.pageId)
    const source = layoutSourceByPageId.get(page.pageId)
    const retainsLayoutSource = !detachedLayoutSourcePageIds.has(page.pageId)
    await db.upsertGenerationPage({
      runId: context.runId,
      sessionId: context.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: outlineItem?.contentOutline || '',
      layoutIntent: retainsLayoutSource
        ? source?.layoutIntent || outlineItem?.layoutIntent
        : null,
      layoutId: retainsLayoutSource ? source?.layoutId : null,
      layoutContractVersion: retainsLayoutSource ? source?.layoutContractVersion : null,
      htmlPath: page.htmlPath,
      status: 'completed'
    })
  }

  const remainingFailedPageInfoById = new Map(failedPageInfoById)
  for (const pageId of changedPageIdSet) {
    remainingFailedPageInfoById.delete(pageId)
  }
  const generatedPagesForMetadata = pageDescriptors.filter(
    (page) => !remainingFailedPageInfoById.has(page.pageId)
  )
  const remainingFailedPages = Array.from(remainingFailedPageInfoById.entries()).map(
    ([pageId, info]) => ({
      pageId,
      title: info.title || pageRefs.find((ref) => ref.pageId === pageId)?.title || pageId,
      reason: info.reason || '页面仍需修复'
    })
  )

  await db.updateSessionMetadata(context.sessionId, {
    lastRunId: context.runId,
    entryMode: 'multi_page',
    indexPath,
    projectId: context.projectId
  })
  const existingSessionPages = await db.listSessionPages(context.sessionId, {
    includeDeleted: true
  })
  const existingBySlug = new Map(existingSessionPages.map((sp) => [sp.file_slug, sp]))
  for (const page of generatedPagesForMetadata) {
    const existing = existingBySlug.get(page.pageId)
    const source = layoutSourceByPageId.get(page.pageId)
    const retainsLayoutSource = !detachedLayoutSourcePageIds.has(page.pageId)
    await db.upsertSessionPage({
      id: existing?.id || nanoid(),
      sessionId: context.sessionId,
      legacyPageId:
        existing?.legacy_page_id || (page.pageId.match(/^page-\d+$/) ? page.pageId : null),
      fileSlug: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      htmlPath: page.htmlPath,
      layoutIntent: retainsLayoutSource ? source?.layoutIntent : null,
      layoutId: retainsLayoutSource ? source?.layoutId : null,
      layoutContractVersion: retainsLayoutSource ? source?.layoutContractVersion : null,
      status: 'completed',
      error: null
    })
  }
  await db.updateProjectStatus(context.projectId, 'draft')
  await db.updateSessionStatus(
    context.sessionId,
    remainingFailedPages.length > 0 ? 'failed' : 'completed'
  )
  await db.updateGenerationRunStatus(
    context.runId,
    remainingFailedPages.length > 0 ? 'partial' : 'completed',
    remainingFailedPages.length > 0
      ? remainingFailedPages
          .map((page) => `${page.pageId}（${page.title}）：${page.reason}`)
          .join('；')
      : null
  )
  if (remainingFailedPages.length === 0) {
    await ctx.history.recordOperation({
      sessionId: context.sessionId,
      projectDir: context.projectDir,
      type: 'edit',
      scope: selectedSelector ? 'selector' : 'page',
      prompt: context.userMessage,
      metadata: {
        runId: context.runId,
        selectedPageId: resolvedSelectedPageId || null,
        selector: selectedSelector || null
      }
    })
  }
  const editSummary = buildLocalSuccessfulEditSummary({
    context,
    changedPages: changedPageDescriptors,
    editScope: selectedSelector ? 'selector' : 'page'
  })
  await emitSuccessfulEditSummary(context, editSummary, emitAssistant)
  log.info('[generate:start] edit completed', {
    sessionId: context.sessionId,
    styleId: context.styleId,
    changedPages: Array.from(changedPageIdSet),
    remainingFailedPages: remainingFailedPages.map((page) => page.pageId)
  })
  emitEditChunk({
    type: 'run_completed',
    payload: {
      runId: context.runId,
      totalPages: editTotalPages
    }
  })
}
