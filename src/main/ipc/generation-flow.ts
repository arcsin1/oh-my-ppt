import log from 'electron-log/main.js'
import type { PPTDatabase } from '../db/database'
import type { AgentManager } from '../agent'
import type { GenerateStartPayload, GeneratedPagePayload } from '@shared/generation'
import { normalizeLayoutIntent, type LayoutIntent } from '@shared/layout-intent'
import type { ModelTimeoutProfile } from '@shared/model-timeout'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import {
  loadStyleSkill,
  listStyleCatalog,
  getStyleDetail,
  hasStyleSkill
} from '../utils/style-skills'
import { extractOutlineTitles, sleep } from './utils'
import { validatePersistedPageHtml } from '../tools/html-utils'
import type { DesignContract } from '../tools/types'
import { buildProjectIndexHtml, type DeckPageFile } from './template'
import {
  buildDesignContractWithLLM,
  planDeckWithLLM,
  runDeepAgentDeckGeneration,
  runDeepAgentEdit
} from './generate'
import type { IpcContext } from './context'
import { resolveActiveModelConfig, resolveGlobalModelTimeouts } from './model-config-utils'

type GenerateMode = 'generate' | 'edit' | 'retry'
type GenerateChatType = 'main' | 'page'

const uiText = (locale: 'zh' | 'en', zh: string, en: string): string => (locale === 'en' ? en : zh)

export type GenerationContext = {
  sessionId: string
  userMessage: string
  requestedType?: 'deck' | 'page'
  effectiveMode: GenerateMode
  selectedPageId?: string
  htmlPath?: string
  selector?: string
  elementTag?: string
  elementText?: string
  session: Awaited<ReturnType<PPTDatabase['getSession']>>
  sessionRecord: Record<string, unknown>
  previousSessionStatus: string
  entry: ReturnType<AgentManager['beginRun']> extends infer T ? NonNullable<T> : never
  runId: string
  styleId: string
  styleSkill: ReturnType<typeof loadStyleSkill>
  userProvidedOutlineTitles: string[]
  totalPages: number
  provider: string
  apiKey: string
  model: string
  modelTimeouts: Record<ModelTimeoutProfile, number>
  providerBaseUrl: string
  projectId: string
  messageScope: GenerateChatType
  messagePageId?: string
  imagePaths: string[]
  sourceDocumentPaths: string[]
  topic: string
  deckTitle: string
  appLocale: 'zh' | 'en'
  allowWebSearch: boolean
  webSearchEngines: string[]
  webSearchLimit: number
}

type FinalizeGenerationArgs = {
  context: GenerationContext
  indexPath: string
  totalPages: number
  generatedPages: Array<{
    pageNumber: number
    title: string
    pageId: string
    htmlPath: string
    html: string
  }>
  designContract?: DesignContract
}

export interface GenerationService {
  resolveGenerationContext: (
    _event: Electron.IpcMainInvokeEvent,
    payload: unknown,
    options?: { persistUserMessage?: boolean; mode?: GenerateMode }
  ) => Promise<GenerationContext>
  finalizeGenerationFailure: (context: GenerationContext, error: unknown) => Promise<void>
  executeGeneration: (context: GenerationContext) => Promise<void>
  executeRetryFailedPages: (context: GenerationContext) => Promise<void>
}

export function createGenerationService(ctx: IpcContext): GenerationService {
  const {
    db,
    agentManager,
    getPageSourceUrl,
    validateProjectIndexHtml,
    createDeckProgressEmitter,
    resolveStoragePath,
    formatImagePathsForPrompt,
    assertPathInAllowedRoots,
    ensureSessionAssets,
    scaffoldProjectFiles,
    emitGenerateChunk,
    PLANNER_TEMPERATURE,
    DESIGN_CONTRACT_TEMPERATURE,
    PAGE_GENERATION_TEMPERATURE,
    PAGE_EDIT_WITH_SELECTOR_TEMPERATURE,
    PAGE_EDIT_DEFAULT_TEMPERATURE
  } = ctx

  const emitAssistantMessage = async (
    context: GenerationContext,
    content: string
  ): Promise<void> => {
    if (!content.trim()) return
    const messageId = await db.addMessage(context.sessionId, {
      role: 'assistant',
      content: content.trim(),
      type: 'text',
      chat_scope: context.messageScope,
      page_id: context.messagePageId
    })
    emitGenerateChunk(context.sessionId, {
      type: 'assistant_message',
      payload: {
        id: messageId,
        runId: context.runId,
        content: content.trim(),
        chatType: context.messageScope,
        pageId: context.messagePageId
      }
    })
  }

  const resolveGenerationContext = async (
    _event: Electron.IpcMainInvokeEvent,
    payload: unknown,
    options?: { persistUserMessage?: boolean; mode?: GenerateMode }
  ): Promise<GenerationContext> => {
    const input = payload as GenerateStartPayload
    const sessionId = String(input?.sessionId || '').trim()
    const rawUserMessage = typeof input?.userMessage === 'string' ? input.userMessage : ''
    const rawImagePaths = Array.isArray(input?.imagePaths)
      ? input.imagePaths
          .map((item) => String(item || '').trim())
          .filter((item) => item.startsWith('./images/'))
          .slice(0, 10)
      : []
    const rawDocPaths = Array.isArray(input?.docPaths)
      ? input.docPaths
          .map((item) => String(item || '').trim())
          .filter(Boolean)
          .slice(0, 1)
      : []
    const requestedType =
      input?.type === 'page' ? 'page' : input?.type === 'deck' ? 'deck' : undefined
    const effectiveMode: GenerateMode =
      options?.mode ?? (requestedType === 'page' ? 'edit' : 'generate')
    const imagePaths = effectiveMode === 'edit' ? rawImagePaths : []
    const userMessage = `${rawUserMessage}${formatImagePathsForPrompt(imagePaths)}`
    const selectedPageId =
      typeof input?.selectedPageId === 'string' && input.selectedPageId.trim().length > 0
        ? input.selectedPageId.trim()
        : undefined
    const htmlPath = typeof input?.htmlPath === 'string' ? input.htmlPath : undefined
    const selector =
      typeof input?.selector === 'string' && input.selector.trim().length > 0
        ? input.selector.trim()
        : undefined
    const elementTag =
      typeof input?.elementTag === 'string' && input.elementTag.trim().length > 0
        ? input.elementTag.trim()
        : undefined
    const elementText =
      typeof input?.elementText === 'string' && input.elementText.trim().length > 0
        ? input.elementText.trim()
        : undefined

    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    log.info('[generate:start] received', {
      sessionId,
      type: requestedType || 'legacy',
      mode: effectiveMode,
      chatType: input?.chatType === 'page' ? 'page' : 'main',
      chatPageId: input?.chatPageId || null,
      hasUserMessage: rawUserMessage.trim().length > 0,
      imagePaths,
      selectedPageId: selectedPageId || null,
      selector: selector || null,
      elementTag: elementTag || null,
      elementText: elementText || null
    })

    const session = await db.getSession(sessionId)
    if (!session) throw new Error('Session not found')
    const sessionRecord = session as unknown as Record<string, unknown>
    const sessionMetadata =
      typeof sessionRecord.metadata === 'string' && sessionRecord.metadata.trim().length > 0
        ? (() => {
            try {
              return JSON.parse(sessionRecord.metadata) as Record<string, unknown>
            } catch {
              return {}
            }
          })()
        : {}
    const previousSessionStatus = String(sessionRecord.status || 'active')
    const styleCatalog = listStyleCatalog()
    const defaultStyleId =
      styleCatalog.find((item) => item.styleKey === 'minimal-white')?.id ??
      styleCatalog[0]?.id ??
      ''
    const styleIdRaw =
      typeof sessionRecord.styleId === 'string' ? String(sessionRecord.styleId).trim() : ''
    const styleId = styleIdRaw || defaultStyleId
    if (!styleId) {
      throw new Error('未找到可用风格，请先在风格管理中创建或导入风格。')
    }
    if (!hasStyleSkill(styleId)) {
      throw new Error(`styleId 不存在或不可用：${styleId}`)
    }
    const styleDetail = getStyleDetail(styleId)

    const existingProject = await db.getProject(sessionId)
    const storagePath = await resolveStoragePath()
    const projectDir = existingProject?.output_path || path.join(storagePath, sessionId)
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true })
    }
    await ensureSessionAssets(projectDir)
    const latestGenerationRun = await db.getLatestGenerationRun(sessionId)
    const isFirstDeckGeneration = effectiveMode === 'generate' && !latestGenerationRun
    const rawReferenceDocumentPath =
      sessionRecord.referenceDocumentPath ?? sessionRecord.reference_document_path
    const referenceDocumentPath =
      typeof rawReferenceDocumentPath === 'string' ? rawReferenceDocumentPath.trim() : ''
    const sourceDocumentPaths = await (async (): Promise<string[]> => {
      const sessionDocsDir = path.join(projectDir, 'docs')
      if (rawDocPaths.length > 0) {
        await fs.promises.mkdir(sessionDocsDir, { recursive: true })
        const copiedPaths: string[] = []
        for (const candidate of rawDocPaths) {
          const sourcePath = await assertPathInAllowedRoots({
            filePath: candidate,
            mode: 'read',
            sessionId
          })
          const safeName = path.basename(sourcePath).replace(/[\\/:"*?<>|]+/g, '-')
          const targetPath = path.join(sessionDocsDir, safeName)
          if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
            await fs.promises.copyFile(sourcePath, targetPath)
          }
          copiedPaths.push(`/docs/${safeName}`)
        }
        return copiedPaths
      }

      if (effectiveMode === 'edit') return []
      const shouldUseReferenceDocument =
        (effectiveMode === 'generate' && isFirstDeckGeneration) || effectiveMode === 'retry'
      if (!shouldUseReferenceDocument || !referenceDocumentPath) {
        return []
      }

      await fs.promises.mkdir(sessionDocsDir, { recursive: true })
      if (referenceDocumentPath) {
        const normalizedReferenceDocumentPath = referenceDocumentPath.startsWith('/')
          ? referenceDocumentPath
          : `/docs/${referenceDocumentPath}`
        if (!normalizedReferenceDocumentPath.startsWith('/docs/')) return []
        const filePath = path.resolve(
          projectDir,
          normalizedReferenceDocumentPath.replace(/^\/+/, '')
        )
        const relativeToProject = path.relative(projectDir, filePath)
        if (relativeToProject.startsWith('..') || path.isAbsolute(relativeToProject)) return []
        if (fs.existsSync(filePath)) {
          return [normalizedReferenceDocumentPath]
        }
        return []
      }
      return []
    })()

    const settings = await db.getAllSettings()
    const appLocale = settings.locale === 'en' ? 'en' : 'zh'
    const allowWebSearch = sessionMetadata.allowWebSearch === true
    const webSearchEngines = Array.isArray(settings.web_search_engines)
      ? settings.web_search_engines
          .map((item) => String(item || '').trim().toLowerCase())
          .filter((item) => item.length > 0)
      : ['bing', 'duckduckgo']
    const rawWebSearchLimit = Number(settings.web_search_limit)
    const webSearchLimit =
      Number.isFinite(rawWebSearchLimit) && rawWebSearchLimit > 0
        ? Math.max(1, Math.min(20, Math.round(rawWebSearchLimit)))
        : 20
    const activeModel = await resolveActiveModelConfig(ctx)
    const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
    const { provider, model, apiKey } = activeModel
    const providerBaseUrl = activeModel.baseUrl

    agentManager.ensureSession({
      sessionId,
      provider,
      model,
      baseUrl: providerBaseUrl,
      projectDir
    })

    const entry = agentManager.beginRun(sessionId)
    if (!entry) throw new Error('Session not found')

    const runId = crypto.randomUUID()
    const styleSkill = loadStyleSkill(styleId)
    const userProvidedOutlineTitles = extractOutlineTitles(rawUserMessage)
    const totalPages = Number(sessionRecord.page_count ?? sessionRecord.pageCount)

    const projectId =
      existingProject?.id ??
      (await db.createProject({
        session_id: sessionId,
        title: String(sessionRecord.title || 'Untitled'),
        output_path: entry.projectDir
      }))

    const normalizedChatType: GenerateChatType = input?.chatType === 'page' ? 'page' : 'main'
    const normalizedChatPageId =
      normalizedChatType === 'page'
        ? typeof input?.chatPageId === 'string' && input.chatPageId.trim().length > 0
          ? input.chatPageId.trim()
          : selectedPageId
        : undefined
    if (normalizedChatType === 'page' && !normalizedChatPageId) {
      throw new Error('chatType=page requires chatPageId or selectedPageId')
    }

    if (options?.persistUserMessage !== false) {
      await db.addMessage(sessionId, {
        role: 'user',
        content: rawUserMessage,
        type: 'text',
        chat_scope: normalizedChatType,
        page_id: normalizedChatType === 'page' ? normalizedChatPageId : undefined,
        selector: normalizedChatType === 'page' ? selector : undefined,
        image_paths: imagePaths
      })
    }
    await db.updateSessionStatus(sessionId, 'active')

    const topic = String(sessionRecord.topic || '当前主题')
    const deckTitle = String(sessionRecord.title || 'OpenPPT Preview')

    log.info('[generate:start] run initialized', {
      sessionId,
      projectDir: entry.projectDir,
      mode: effectiveMode,
      styleId,
      styleKey: styleDetail.styleKey,
      styleLabel: styleDetail.label,
      provider,
      model
    })

    return {
      sessionId,
      userMessage,
      requestedType,
      effectiveMode,
      selectedPageId,
      htmlPath,
      selector,
      elementTag,
      elementText,
      session,
      sessionRecord,
      previousSessionStatus,
      entry,
      runId,
      styleId,
      styleSkill,
      userProvidedOutlineTitles,
      totalPages,
      provider,
      apiKey,
      model,
      modelTimeouts,
      providerBaseUrl,
      projectId,
      messageScope: normalizedChatType,
      messagePageId: normalizedChatType === 'page' ? normalizedChatPageId : undefined,
      imagePaths,
      sourceDocumentPaths,
      topic,
      deckTitle,
      appLocale,
      allowWebSearch,
      webSearchEngines,
      webSearchLimit
    }
  }

  const finalizeGenerationSuccess = async (args: FinalizeGenerationArgs): Promise<void> => {
    const { context, indexPath, totalPages, generatedPages } = args
    await db.updateSessionMetadata(context.sessionId, {
      lastRunId: context.runId,
      entryMode: 'multi_page',
      generatedPages: generatedPages.map((page) => ({
        pageNumber: page.pageNumber,
        title: page.title,
        pageId: page.pageId,
        htmlPath: page.htmlPath,
        html: page.html
      })),
      indexPath,
      projectId: context.projectId
    })
    if (args.designContract) {
      await db.updateSessionDesignContract(context.sessionId, args.designContract)
    }
    await db.updateProjectStatus(context.projectId, 'draft')
    await db.updateSessionStatus(context.sessionId, 'completed')
    log.info('[generate:start] completed', {
      sessionId: context.sessionId,
      styleId: context.styleId,
      totalPages
    })
    emitGenerateChunk(context.sessionId, {
      type: 'run_completed',
      payload: {
        runId: context.runId,
        totalPages
      }
    })
  }

  const finalizeGenerationFailure = async (
    context: GenerationContext,
    error: unknown
  ): Promise<void> => {
    const message =
      error instanceof Error && error.message.length > 0 ? error.message : 'Generation failed'
    log.error('[generate:start] failed', {
      sessionId: context.sessionId,
      styleId: context.styleId,
      message
    })
    const generationRun = await db.getGenerationRun(context.runId)
    if (generationRun && generationRun.status === 'running') {
      await db.updateGenerationRunStatus(context.runId, 'failed', message)
    }
    await db.updateSessionStatus(
      context.sessionId,
      (context.effectiveMode === 'edit' || context.effectiveMode === 'retry') &&
        context.previousSessionStatus !== 'active'
        ? (context.previousSessionStatus as 'completed' | 'failed' | 'archived')
        : 'failed'
    )
    await db.addMessage(context.sessionId, {
      role: 'system',
      content: message,
      type: 'stream_chunk',
      chat_scope: context.messageScope,
      page_id: context.messagePageId
    })
    emitGenerateChunk(context.sessionId, {
      type: 'run_error',
      payload: { runId: context.runId, message }
    })
  }

  const executeEditGeneration = async (context: GenerationContext): Promise<void> => {
    if (!context.apiKey) {
      throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
    }

    const indexPath = context.htmlPath
      ? path.join(path.dirname(context.htmlPath), 'index.html')
      : path.join(context.entry.projectDir, 'index.html')
    const isMainScopeEdit = context.messageScope === 'main'
    const pageIdFromPath =
      typeof context.htmlPath === 'string'
        ? path.basename(context.htmlPath).match(/^(page-\d+)\.html$/i)?.[1]
        : undefined
    let resolvedSelectedPageId = isMainScopeEdit
      ? undefined
      : context.selectedPageId || pageIdFromPath
    const selectedSelector = isMainScopeEdit ? undefined : context.selector

    let outlineTitles: string[] = context.userProvidedOutlineTitles
    let pageRefs: Array<{ pageNumber: number; title: string; pageId: string; htmlPath: string }> =
      []
    let savedDesignContract: DesignContract | undefined
    let metadataFailedPages: Array<{ pageId: string; title: string; reason: string }> = []
    if (context.session?.metadata) {
      try {
        const metadata = JSON.parse(context.session.metadata) as {
          generatedPages?: Array<{
            pageNumber: number
            title: string
            pageId?: string
            htmlPath?: string
          }>
          failedPages?: Array<{ pageId?: string; title?: string; reason?: string }>
        }
        if (outlineTitles.length === 0) {
          outlineTitles = (metadata.generatedPages || []).map((p) => p.title)
        }
        metadataFailedPages = (metadata.failedPages || [])
          .map((page) => ({
            pageId: typeof page.pageId === 'string' ? page.pageId.trim() : '',
            title: typeof page.title === 'string' ? page.title.trim() : '',
            reason: typeof page.reason === 'string' ? page.reason.trim() : ''
          }))
          .filter((page) => page.pageId.length > 0)
        pageRefs = (metadata.generatedPages || []).map((p, index) => {
          const pageId = p.pageId || `page-${p.pageNumber || index + 1}`
          return {
            pageNumber: p.pageNumber || index + 1,
            title: p.title || `第${index + 1}页`,
            pageId,
            htmlPath: p.htmlPath || path.join(context.entry.projectDir, `${pageId}.html`)
          }
        })
      } catch {
        // ignore malformed metadata
      }
    }
    const latestPageSnapshot = await db.listLatestGenerationPageSnapshot(context.sessionId)
    const pageRefById = new Map(pageRefs.map((ref) => [ref.pageId, ref]))
    for (const page of latestPageSnapshot) {
      const pageId = page.page_id || `page-${page.page_number}`
      if (pageRefById.has(pageId)) continue
      const ref = {
        pageNumber: page.page_number,
        title: page.title || `第${page.page_number}页`,
        pageId,
        htmlPath: page.html_path || path.join(context.entry.projectDir, `${pageId}.html`)
      }
      pageRefs.push(ref)
      pageRefById.set(pageId, ref)
    }
    const failedPageInfoById = new Map<string, { title: string; reason: string }>()
    for (const page of latestPageSnapshot) {
      if (page.status !== 'failed') continue
      const pageId = page.page_id || `page-${page.page_number}`
      failedPageInfoById.set(pageId, {
        title: page.title || `第${page.page_number}页`,
        reason: page.error || '页面仍需修复'
      })
    }
    for (const page of metadataFailedPages) {
      if (!failedPageInfoById.has(page.pageId)) {
        failedPageInfoById.set(page.pageId, {
          title: page.title || page.pageId,
          reason: page.reason || '页面仍需修复'
        })
      }
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
    if (outlineTitles.length === 0) {
      outlineTitles = Array.from({ length: context.totalPages }, (_unused, i) => `第${i + 1}页`)
    }
    if (pageRefs.length === 0) {
      const diskPageIds = fs.existsSync(context.entry.projectDir)
        ? fs
            .readdirSync(context.entry.projectDir)
            .map((name) => name.match(/^(page-(\d+))\.html$/i))
            .filter((m): m is RegExpMatchArray => Boolean(m))
            .sort((a, b) => Number(a[2]) - Number(b[2]))
            .map((m) => m[1])
        : []
      const ids =
        diskPageIds.length > 0 ? diskPageIds : outlineTitles.map((_title, i) => `page-${i + 1}`)
      pageRefs = ids.map((pid, index) => ({
        pageNumber: Number(pid.match(/^page-(\d+)$/i)?.[1] || index + 1),
        title: outlineTitles[index] || `第${index + 1}页`,
        pageId: pid,
        htmlPath: path.join(context.entry.projectDir, `${pid}.html`)
      }))
    }
    if (
      !isMainScopeEdit &&
      resolvedSelectedPageId &&
      !pageRefs.some((ref) => ref.pageId === resolvedSelectedPageId)
    ) {
      const inferredNumber = Number(
        resolvedSelectedPageId.match(/^page-(\d+)$/i)?.[1] || pageRefs.length + 1
      )
      pageRefs.push({
        pageNumber: inferredNumber,
        title: outlineTitles[inferredNumber - 1] || `第${inferredNumber}页`,
        pageId: resolvedSelectedPageId,
        htmlPath: path.join(context.entry.projectDir, `${resolvedSelectedPageId}.html`)
      })
    }
    pageRefs.sort((a, b) => a.pageNumber - b.pageNumber)
    if (!isMainScopeEdit && !resolvedSelectedPageId && pageRefs.length > 0) {
      resolvedSelectedPageId = pageRefs[0].pageId
    }
    const resolvedSelectedPageNumber = !isMainScopeEdit
      ? Number(resolvedSelectedPageId?.match(/^page-(\d+)$/i)?.[1] || 0) ||
        pageRefs.find((ref) => ref.pageId === resolvedSelectedPageId)?.pageNumber ||
        undefined
      : undefined
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

    await db.createGenerationRun({
      id: context.runId,
      sessionId: context.sessionId,
      mode: 'edit',
      totalPages: pageRefs.length,
      metadata: {
        editScope: isMainScopeEdit ? 'main' : 'page',
        selectedPageId: resolvedSelectedPageId || null,
        selector: selectedSelector || null
      }
    })
    const emitEditChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)

    emitEditChunk({
      type: 'stage_started',
      payload: {
        runId: context.runId,
        stage: 'editing',
        label: progressText(context.appLocale, 'understanding'),
        progress: 10,
        totalPages: outlineTitles.length
      }
    })

    await emitAssistantMessage(
      context,
      isMainScopeEdit
        ? uiText(
            context.appLocale,
            `我准备开始调整「${context.topic}」了。目标：主会话总览壳（index.html），我只会修改切换演示动画与交互层动画。`,
            `I am ready to adjust "${context.topic}". Target: the main overview shell (index.html). I will only modify transition and interaction-layer animations.`
          )
        : uiText(
            context.appLocale,
            `我准备开始调整「${context.topic}」了。目标：${resolvedSelectedPageId ? `第 ${resolvedSelectedPageNumber ?? '?'} 页` : '按你的指令智能定位'}${selectedSelector ? `（选择器：${selectedSelector}）` : ''}。`,
            `I am ready to adjust "${context.topic}". Target: ${resolvedSelectedPageId ? `page ${resolvedSelectedPageNumber ?? '?'}` : 'infer from your instruction'}${selectedSelector ? ` (selector: ${selectedSelector})` : ''}.`
          )
    )
    const editTemperature = selectedSelector
      ? PAGE_EDIT_WITH_SELECTOR_TEMPERATURE
      : PAGE_EDIT_DEFAULT_TEMPERATURE

    const beforeIndexHtml = fs.existsSync(indexPath)
      ? await fs.promises.readFile(indexPath, 'utf-8')
      : ''

    const editSummaryFromEngine = await runDeepAgentEdit({
      sessionId: context.sessionId,
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      modelTimeoutMs: context.modelTimeouts.agent,
      temperature: editTemperature,
      styleId: context.styleId,
      styleSkillPrompt: context.styleSkill.prompt,
      appLocale: context.appLocale,
      topic: context.topic,
      deckTitle: context.deckTitle,
      allowWebSearch: context.allowWebSearch,
      webSearchEngines: context.webSearchEngines,
      webSearchLimit: context.webSearchLimit,
      userMessage: context.userMessage,
      outlineTitles,
      outlineItems,
      projectDir: context.entry.projectDir,
      indexPath,
      pageFileMap,
      designContract: savedDesignContract,
      editScope: isMainScopeEdit ? 'main' : 'page',
      selectedPageId: resolvedSelectedPageId,
      selectedPageNumber: resolvedSelectedPageNumber,
      selectedSelector,
      elementTag: context.elementTag,
      elementText: context.elementText,
      existingPageIds: existingPageIdsBeforeRun,
      agentManager,
      emit: (chunk) => emitEditChunk(chunk),
      runId: context.runId,
      signal: context.entry.abortController.signal
    })
    const afterIndexHtml = fs.existsSync(indexPath)
      ? await fs.promises.readFile(indexPath, 'utf-8')
      : ''
    const indexChanged = beforeIndexHtml !== afterIndexHtml
    if (indexChanged) {
      const indexValidationErrors = validateProjectIndexHtml(afterIndexHtml)
      if (indexValidationErrors.length > 0) {
        const details = indexValidationErrors.join('; ')
        await db.updateGenerationRunStatus(context.runId, 'failed', details)
        throw new Error(`index.html 验证失败: ${details}`)
      }
    }

    const pageDescriptors: Array<{
      pageNumber: number
      title: string
      pageId: string
      html: string
      htmlPath: string
    }> = []
    const changedPageDescriptors: Array<{
      pageNumber: number
      title: string
      pageId: string
      html: string
      htmlPath: string
    }> = []
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
      const page: GeneratedPagePayload = {
        pageNumber: ref.pageNumber,
        title: ref.title,
        html,
        pageId: ref.pageId,
        htmlPath: ref.htmlPath,
        sourceUrl: getPageSourceUrl(ref.htmlPath)
      }
      pageDescriptors.push({
        pageNumber: ref.pageNumber,
        title: ref.title,
        pageId: ref.pageId,
        html,
        htmlPath: ref.htmlPath
      })
      const isExisting = existingPageIdsBeforeRun.includes(ref.pageId)
      const changed = beforeMap.get(ref.pageId) !== html
      if (!changed && isExisting) continue
      changedPageDescriptors.push({
        pageNumber: ref.pageNumber,
        title: ref.title,
        pageId: ref.pageId,
        html,
        htmlPath: ref.htmlPath
      })
      emitEditChunk({
        type: isExisting ? 'page_updated' : 'page_generated',
        payload: {
          runId: context.runId,
          stage: 'editing',
          label: progressText(context.appLocale, 'completed'),
          progress: 90,
          currentPage: page.pageNumber,
          totalPages: pageRefs.length,
          ...page
        }
      })
    }

    const invalidChangedPages = changedPageDescriptors
      .map((page) => {
        const validation = validatePersistedPageHtml(page.html, page.pageId)
        return validation.valid
          ? null
          : {
              page,
              reason: validation.errors.join('; ')
            }
      })
      .filter(
        (
          item
        ): item is {
          page: {
            pageNumber: number
            title: string
            pageId: string
            html: string
            htmlPath: string
          }
          reason: string
        } => Boolean(item)
      )
    if (invalidChangedPages.length > 0) {
      const details = invalidChangedPages
        .map((item) => `${item.page.pageId}（${item.page.title}）：${item.reason}`)
        .join('；')
      await db.updateGenerationRunStatus(context.runId, 'failed', details)
      throw new Error(`页面编辑结果验证失败：${details}`)
    }

    const changedPageIdSet = new Set(changedPageDescriptors.map((page) => page.pageId))
    for (const page of changedPageDescriptors) {
      const outlineItem = outlineItems.find(
        (_item, index) => pageRefs[index]?.pageId === page.pageId
      )
      await db.upsertGenerationPage({
        runId: context.runId,
        sessionId: context.sessionId,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: outlineItem?.contentOutline || '',
        layoutIntent: outlineItem?.layoutIntent,
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

    const changedPages = changedPageDescriptors
      .map((p) => uiText(context.appLocale, `第${p.pageNumber}页`, `page ${p.pageNumber}`))
      .join(uiText(context.appLocale, '、', ', '))
    const editSummary =
      changedPageDescriptors.length > 0
        ? uiText(
            context.appLocale,
            `修改完成：${changedPages}${selectedSelector ? `（目标选择器：${selectedSelector}）` : ''}。`,
            `Edit completed: ${changedPages}${selectedSelector ? ` (target selector: ${selectedSelector})` : ''}.`
          )
        : indexChanged
          ? uiText(
              context.appLocale,
              '修改完成：已更新 index.html 总览壳交互。',
              'Edit completed: updated index.html overview-shell interactions.'
            )
          : editSummaryFromEngine.trim() ||
            uiText(
              context.appLocale,
              '我已经检查过了，这次没有检测到需要落盘的页面变化。',
              'I checked the session and did not detect page changes that needed to be written this time.'
            )
    await emitAssistantMessage(context, editSummary)

    await db.updateSessionMetadata(context.sessionId, {
      lastRunId: context.runId,
      entryMode: 'multi_page',
      generatedPages: generatedPagesForMetadata.map((page) => ({
        pageNumber: page.pageNumber,
        title: page.title,
        pageId: page.pageId,
        htmlPath: page.htmlPath,
        html: page.html
      })),
      failedPages: remainingFailedPages,
      indexPath,
      projectId: context.projectId
    })
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
        totalPages: pageRefs.length
      }
    })
  }

  const executeDeckGeneration = async (context: GenerationContext): Promise<void> => {
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
      page_id: context.messagePageId
    })
    await sleep(120, context.entry.abortController.signal)

    const pageRefs = Array.from({ length: context.totalPages }, (_unused, index) => {
      const pageNumber = index + 1
      const pageId = `page-${pageNumber}`
      const htmlPath = path.join(context.entry.projectDir, `${pageId}.html`)
      const fallbackTitle = context.userProvidedOutlineTitles[index] || `Slide ${pageNumber}`
      return { pageNumber, title: fallbackTitle, pageId, htmlPath }
    })
    const pageFileMap = Object.fromEntries(pageRefs.map((page) => [page.pageId, page.htmlPath]))
    const indexPath = path.join(context.entry.projectDir, 'index.html')
    await db.createGenerationRun({
      id: context.runId,
      sessionId: context.sessionId,
      mode: 'generate',
      totalPages: pageRefs.length,
      metadata: {
        topic: context.topic,
        styleId: context.styleId,
        projectDir: context.entry.projectDir,
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
      pages: pageRefs
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

    const plannerPromise = planDeckWithLLM({
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      modelTimeoutMs: context.modelTimeouts.planning,
      temperature: PLANNER_TEMPERATURE,
      styleId: context.styleId,
      totalPages: pageRefs.length,
      appLocale: context.appLocale,
      topic: context.topic,
      userMessage: context.userMessage,
      emit: (chunk) => emitDeckChunk(chunk),
      runId: context.runId,
      signal: context.entry.abortController.signal
    })
    const designContractPromise = sleep(500, context.entry.abortController.signal).then(() =>
      buildDesignContractWithLLM({
        provider: context.provider,
        apiKey: context.apiKey,
        model: context.model,
        baseUrl: context.providerBaseUrl,
        modelTimeoutMs: context.modelTimeouts.design,
        temperature: DESIGN_CONTRACT_TEMPERATURE,
        styleId: context.styleId,
        styleSkillPrompt: context.styleSkill.prompt,
        appLocale: context.appLocale,
        totalPages: context.totalPages,
        emit: (chunk) => emitDeckChunk(chunk),
        runId: context.runId,
        signal: context.entry.abortController.signal
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
    }

    await fs.promises.writeFile(
      indexPath,
      buildProjectIndexHtml(
        context.deckTitle,
        pageRefs.map(
          (page): DeckPageFile => ({
            pageNumber: page.pageNumber,
            pageId: page.pageId,
            title: page.title,
            htmlPath: path.basename(page.htmlPath)
          })
        )
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

    await emitAssistantMessage(
      context,
      uiText(
        context.appLocale,
        `已为「${context.topic}」规划 ${outlineItems.length} 页内容，风格为「${context.styleSkill.preset.label}」。接下来我会逐页完善并实时同步进度。`,
        `Planned ${outlineItems.length} slides for "${context.topic}" in the "${context.styleSkill.preset.label}" style. I will refine each page and stream progress in real time.`
      )
    )
    await sleep(120, context.entry.abortController.signal)

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
        generatedPages: Array.from(persistedGeneratedPagesById.values()).sort(
          (a, b) => a.pageNumber - b.pageNumber
        ),
        failedPages: Array.from(persistedFailedPagesById.values()).sort((a, b) => {
          const aNumber = Number(a.pageId.match(/^page-(\d+)$/i)?.[1] || 0)
          const bNumber = Number(b.pageId.match(/^page-(\d+)$/i)?.[1] || 0)
          return aNumber - bNumber
        }),
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
        htmlPath: page.htmlPath,
        status: 'completed'
      })
      persistedFailedPagesById.delete(page.pageId)
      persistedGeneratedPagesById.set(page.pageId, {
        pageNumber: page.pageNumber,
        title: page.title,
        pageId: page.pageId,
        htmlPath: page.htmlPath
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
      persistedGeneratedPagesById.delete(page.pageId)
      persistedFailedPagesById.set(page.pageId, {
        pageId: page.pageId,
        title: page.title,
        reason: page.reason
      })
      await persistGenerationSnapshotMetadata()
    }

    const { failedPages } = await runDeepAgentDeckGeneration({
      sessionId: context.sessionId,
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      modelTimeoutMs: context.modelTimeouts.agent,
      temperature: PAGE_GENERATION_TEMPERATURE,
      styleId: context.styleId,
      styleSkillPrompt: context.styleSkill.prompt,
      appLocale: context.appLocale,
      topic: context.topic,
      deckTitle: context.deckTitle,
      allowWebSearch: context.allowWebSearch,
      webSearchEngines: context.webSearchEngines,
      webSearchLimit: context.webSearchLimit,
      userMessage: context.userMessage,
      outlineTitles,
      outlineItems,
      sourceDocumentPaths: context.sourceDocumentPaths,
      generationMode: 'generate',
      designContract,
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
        stage: 'rendering',
        label: progressText(
          context.appLocale,
          postValidationErrors.length > 0 ? 'failed' : 'checking'
        ),
        progress: 90,
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
      if (html.includes('等待模型填充这一页内容')) {
        placeholderPages.push(pageRef.pageId)
      }
      const page: GeneratedPagePayload = {
        pageNumber: pageRef.pageNumber,
        title: pageRef.title,
        html,
        pageId: pageRef.pageId,
        htmlPath: pageRef.htmlPath,
        sourceUrl: getPageSourceUrl(pageRef.htmlPath)
      }
      pageDescriptors.push({
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
      emitDeckChunk({
        type: 'page_generated',
        payload: {
          runId: context.runId,
          stage: 'rendering',
          label: progressText(context.appLocale, 'completed'),
          progress: 10 + Math.round((page.pageNumber / Math.max(pageRefs.length, 1)) * 80),
          currentPage: page.pageNumber,
          totalPages: pageRefs.length,
          ...page
        }
      })
      const changed = beforePageMap.get(pageRef.pageId) !== html
      await db.addMessage(context.sessionId, {
        role: 'tool',
        content: `${changed ? '已更新' : '已确认'} ${page.pageId}: ${page.title}`,
        type: 'tool_result',
        tool_name: 'update_page_file',
        tool_call_id: context.runId,
        chat_scope: context.messageScope,
        page_id: context.messagePageId
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
      await db.updateGenerationRunStatus(
        context.runId,
        pageDescriptors.length > 0 ? 'partial' : 'failed',
        failedDetails
      )
      await db.updateSessionMetadata(context.sessionId, {
        lastRunId: context.runId,
        entryMode: 'multi_page',
        generatedPages: pageDescriptors.map((page) => ({
          pageNumber: page.pageNumber,
          title: page.title,
          pageId: page.pageId,
          htmlPath: page.htmlPath,
          html: page.html
        })),
        failedPages: failedPages.map((page) => ({
          pageId: page.pageId,
          title: page.title,
          reason: page.reason
        })),
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

    const completionSummary =
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
    await emitAssistantMessage(context, completionSummary)

    await db.updateGenerationRunStatus(context.runId, 'completed', null)
    await finalizeGenerationSuccess({
      context,
      indexPath,
      totalPages: outlineTitles.length,
      generatedPages: pageDescriptors,
      designContract
    })
  }

  const executeRetryFailedPages = async (context: GenerationContext): Promise<void> => {
    if (!context.apiKey) {
      throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
    }

    const indexPath = path.join(context.entry.projectDir, 'index.html')
    const emitRetryChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)
    let savedDesignContract: DesignContract | undefined
    const sessionRecord = (context.session || {}) as Record<string, unknown>
    const latestPageSnapshot = await db.listLatestGenerationPageSnapshot(context.sessionId)
    const incompleteSnapshotRecords = latestPageSnapshot.filter(
      (page) => page.status !== 'completed'
    )
    let metadataGeneratedPageCount = 0
    let metadataFailedPages: Array<Record<string, unknown>> = []
    if (typeof sessionRecord.metadata === 'string' && sessionRecord.metadata.trim().length > 0) {
      try {
        const metadata = JSON.parse(sessionRecord.metadata) as {
          generatedPages?: Array<Record<string, unknown>>
          failedPages?: Array<Record<string, unknown>>
        }
        metadataGeneratedPageCount = Array.isArray(metadata.generatedPages)
          ? metadata.generatedPages.length
          : 0
        metadataFailedPages =
          incompleteSnapshotRecords.length === 0 && Array.isArray(metadata.failedPages)
            ? metadata.failedPages
            : []
      } catch {
        metadataGeneratedPageCount = 0
        metadataFailedPages = []
      }
    }
    if (incompleteSnapshotRecords.length === 0 && metadataFailedPages.length === 0) {
      throw new Error('当前会话没有可继续生成的页面。')
    }
    if (metadataGeneratedPageCount === 0) {
      const latestSnapshot = await db.listLatestGenerationPageSnapshot(context.sessionId)
      const completedSnapshotCount = latestSnapshot.filter(
        (page) => page.status === 'completed'
      ).length
      if (completedSnapshotCount === 0) {
        throw new Error('当前没有成功页面可保留，请使用完整重新生成。')
      }
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
        modelTimeoutMs: context.modelTimeouts.design,
        temperature: DESIGN_CONTRACT_TEMPERATURE,
        styleId: context.styleId,
        styleSkillPrompt: context.styleSkill.prompt,
        appLocale: context.appLocale,
        totalPages: context.totalPages,
        emit: (chunk) => emitRetryChunk(chunk),
        runId: context.runId,
        signal: context.entry.abortController.signal
      }))

    const retryPages =
      incompleteSnapshotRecords.length > 0
        ? incompleteSnapshotRecords.map((page) => ({
            pageNumber: page.page_number,
            pageId: page.page_id,
            title: page.title || page.page_id,
            contentOutline: page.content_outline || '',
            layoutIntent: page.layout_intent
              ? normalizeLayoutIntent(page.layout_intent)
              : undefined,
            htmlPath: page.html_path || path.join(context.entry.projectDir, `${page.page_id}.html`),
            retryCount: page.retry_count + 1
          }))
        : metadataFailedPages
            .map((page, index) => {
              const rawPageId = typeof page.pageId === 'string' ? page.pageId.trim() : ''
              const inferredNumber = Number(rawPageId.match(/^page-(\d+)$/i)?.[1] || 0)
              const rawPageNumber = Number(page.pageNumber)
              const pageNumber =
                Number.isFinite(rawPageNumber) && rawPageNumber > 0
                  ? Math.floor(rawPageNumber)
                  : inferredNumber > 0
                    ? inferredNumber
                    : index + 1
              const pageId = rawPageId || `page-${pageNumber}`
              const title =
                typeof page.title === 'string' && page.title.trim().length > 0
                  ? page.title.trim()
                  : `第 ${pageNumber} 页`
              const htmlPathRaw = typeof page.htmlPath === 'string' ? page.htmlPath.trim() : ''
              return {
                pageNumber,
                pageId,
                title,
                contentOutline:
                  typeof page.contentOutline === 'string' ? page.contentOutline.trim() : '',
                layoutIntent:
                  typeof page.layoutIntent === 'string'
                    ? normalizeLayoutIntent(page.layoutIntent)
                    : undefined,
                htmlPath: htmlPathRaw
                  ? path.isAbsolute(htmlPathRaw)
                    ? htmlPathRaw
                    : path.join(context.entry.projectDir, htmlPathRaw)
                  : path.join(context.entry.projectDir, `${pageId}.html`),
                retryCount: 1
              }
            })
            .filter(
              (page, index, pages) =>
                pages.findIndex((item) => item.pageId === page.pageId) === index
            )
    const pageFileMap = Object.fromEntries(retryPages.map((page) => [page.pageId, page.htmlPath]))

    await db.createGenerationRun({
      id: context.runId,
      sessionId: context.sessionId,
      mode: 'retry',
      totalPages: retryPages.length,
      metadata: {
        retryOnly: true,
        source:
          incompleteSnapshotRecords.length > 0
            ? 'latest_incomplete_pages'
            : 'metadata_failed_pages',
        pageIds: retryPages.map((page) => page.pageId)
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
        label: progressText(context.appLocale, 'retrying'),
        progress: 8,
        totalPages: retryPages.length
      }
    })
    await emitAssistantMessage(
      context,
      uiText(
        context.appLocale,
        `继续生成 ${retryPages.length} 个未完成页面：${retryPages.map((page) => page.pageId).join('、')}。`,
        `Continuing ${retryPages.length} unfinished pages: ${retryPages.map((page) => page.pageId).join(', ')}.`
      )
    )

    const persistedRetryCompletedPageIds = new Set<string>()
    const persistedRetryFailedPageIds = new Set<string>()

    const persistCompletedRetryPage = async (page: {
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
        htmlPath: page.htmlPath,
        status: 'completed',
        retryCount: retryPage?.retryCount || 0
      })
      persistedRetryFailedPageIds.delete(page.pageId)
      persistedRetryCompletedPageIds.add(page.pageId)
    }
    const persistFailedRetryPage = async (page: {
      pageNumber: number
      pageId: string
      title: string
      contentOutline: string
      layoutIntent?: LayoutIntent
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
        htmlPath: page.htmlPath,
        status: 'failed',
        error: page.reason,
        retryCount: retryPage?.retryCount || 0
      })
      persistedRetryCompletedPageIds.delete(page.pageId)
      persistedRetryFailedPageIds.add(page.pageId)
    }

    const { failedPages } = await runDeepAgentDeckGeneration({
      sessionId: context.sessionId,
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      modelTimeoutMs: context.modelTimeouts.agent,
      temperature: PAGE_GENERATION_TEMPERATURE,
      styleId: context.styleId,
      styleSkillPrompt: context.styleSkill.prompt,
      appLocale: context.appLocale,
      topic: context.topic,
      deckTitle: context.deckTitle,
      allowWebSearch: context.allowWebSearch,
      webSearchEngines: context.webSearchEngines,
      webSearchLimit: context.webSearchLimit,
      userMessage:
        context.userMessage ||
        'Continue generating the unfinished slides in this session. Determine the content language from the existing topic, outline, and source materials; do not infer it from this instruction.',
      outlineTitles: retryPages.map((page) => page.title),
      outlineItems: retryPages.map((page) => ({
        title: page.title,
        contentOutline: page.contentOutline,
        layoutIntent: page.layoutIntent
      })),
      sourceDocumentPaths: context.sourceDocumentPaths,
      generationMode: 'retry',
      pageTasks: retryPages.map((page) => ({
        pageNumber: page.pageNumber,
        pageId: page.pageId,
        title: page.title,
        contentOutline: page.contentOutline,
        layoutIntent: page.layoutIntent
      })),
      designContract,
      projectDir: context.entry.projectDir,
      indexPath,
      pageFileMap,
      agentManager,
      emit: (chunk) => emitRetryChunk(chunk),
      onPageCompleted: persistCompletedRetryPage,
      onPageFailed: persistFailedRetryPage,
      runId: context.runId,
      signal: context.entry.abortController.signal
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
            htmlPath: page.htmlPath,
            status: 'failed',
            error: failure?.reason || '页面重试失败',
            retryCount: page.retryCount
          })
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
            htmlPath: page.htmlPath,
            status: 'failed',
            error: reason,
            retryCount: page.retryCount
          })
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
            htmlPath: page.htmlPath,
            status: 'failed',
            error: reason,
            retryCount: page.retryCount
          })
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
          htmlPath: page.htmlPath,
          status: 'completed',
          retryCount: page.retryCount
        })
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
    if (context.session?.metadata) {
      try {
        const metadata = JSON.parse(context.session.metadata) as {
          generatedPages?: Array<{
            pageNumber: number
            title: string
            pageId?: string
            htmlPath?: string
            html?: string
          }>
        }
        const restoredPages = await Promise.all(
          (metadata.generatedPages || [])
            .filter((page) => !retryPageIdSet.has(page.pageId || `page-${page.pageNumber}`))
            .map(async (page) => {
              const pageId = page.pageId || `page-${page.pageNumber}`
              const htmlPath =
                page.htmlPath || path.join(context.entry.projectDir, `${pageId}.html`)
              const html = fs.existsSync(htmlPath)
                ? await fs.promises.readFile(htmlPath, 'utf-8')
                : page.html || ''
              if (!html.trim()) return null
              return {
                pageNumber: page.pageNumber,
                title: page.title,
                pageId,
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
      } catch {
        previousGeneratedPages = []
      }
    }
    const mergedGeneratedPages = [...previousGeneratedPages, ...retrySuccessPages].sort(
      (a, b) => a.pageNumber - b.pageNumber
    )

    await db.updateSessionMetadata(context.sessionId, {
      lastRunId: context.runId,
      entryMode: 'multi_page',
      generatedPages: mergedGeneratedPages,
      failedPages: retryFailures.map((page) => ({
        pageId: page.pageId,
        title: page.title,
        reason: page.reason
      })),
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

    if (mergedGeneratedPages.length < context.totalPages) {
      const message = uiText(
        context.appLocale,
        `重试页面已完成，但当前只恢复 ${mergedGeneratedPages.length}/${context.totalPages} 页，请继续重试或重新生成。`,
        `Retry completed, but only ${mergedGeneratedPages.length}/${context.totalPages} pages were restored. Retry again or regenerate.`
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

    await emitAssistantMessage(
      context,
      uiText(
        context.appLocale,
        `失败页面已经重试完成，本次修复 ${retrySuccessPages.length} 页。`,
        `Failed pages were retried. ${retrySuccessPages.length} pages were fixed.`
      )
    )
    await db.updateGenerationRunStatus(context.runId, 'completed', null)
    await finalizeGenerationSuccess({
      context,
      indexPath,
      totalPages: context.totalPages,
      generatedPages: mergedGeneratedPages,
      designContract
    })
  }

  const executeGeneration = async (context: GenerationContext): Promise<void> => {
    if (context.effectiveMode === 'edit') {
      await executeEditGeneration(context)
      return
    }
    await executeDeckGeneration(context)
  }

  return {
    resolveGenerationContext,
    finalizeGenerationFailure,
    executeGeneration,
    executeRetryFailedPages
  }
}
