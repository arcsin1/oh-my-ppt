import log from 'electron-log/main.js'
import {
  createGenerationPageCallbacks,
  generatePagesWithRetry,
  resolvePageHtmlPath,
  uiText
} from './generation-utils'
import {
  type GenerationContext,
  resolveCommonContext,
  type RuntimeJobExecutionContext
} from './context'
import { finalizeGenerationSuccess } from './finalization'
import { progressText } from '@shared/progress'
import path from 'path'
import fs from 'fs'
import { customAlphabet, nanoid } from 'nanoid'
import { type LayoutIntent } from '@shared/layout-intent'
import { validatePersistedPageHtml } from '../presentation/html/html-utils'
import { buildProjectIndexHtml, buildPageScaffoldHtml, type DeckPageFile } from '../session/template-builder'
import { planNewPage } from './agent-runner'
import type { DesignContract } from '@shared/generation'
import type { ModelTimeoutProfile } from '@shared/model-timeout'
import type { ModelRuntimeConfig } from '../agent-runtime/model'
import { createPageImageFinalizer } from './page-image-finalizer'

const pageSlugId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)

// ── Independent AddPage context (not shared with generation/retry/edit) ──

export type AddPageContext = {
  sessionId: string
  runId: string
  userDescription: string
  insertAfterPageNumber: number
  targetPageId?: string
  provider: string
  apiKey: string
  model: string
  modelConfigId?: string
  modelConfigName?: string
  runModel?: string
  providerBaseUrl: string
  maxTokens: number
  modelRuntime: ModelRuntimeConfig
  modelTimeouts: Record<ModelTimeoutProfile, number>
  projectDir: string
  abortSignal: AbortSignal
  styleId: string
  styleSkillPrompt: string
  imageGenerationPrompt: string
  styleKey: string
  styleName: string
  styleVersion: string
  slideSize: import('@shared/slide-size').SlideSizePreset
  topic: string
  deckTitle: string
  appLocale: 'zh' | 'en'
  sessionRecord: Record<string, unknown>
  previousSessionStatus: string
  messageScope: 'main' | 'page'
  messagePageId?: string
  projectId: string
  effectiveMode: 'addPage'
  visualEnabled: boolean
  imageModelConfigId?: string
}

export async function resolveAddPageContext(
  ctx: GenerationContext,
  sessionId: string,
  userDescription: string,
  insertAfterPageNumber: number,
  modelConfigId?: string,
  targetPageId?: string,
  execution?: RuntimeJobExecutionContext
): Promise<AddPageContext> {
  log.info('[generate:addPage] resolving context', {
    sessionId,
    insertAfterPageNumber,
    targetPageId
  })
  const common = await resolveCommonContext(ctx, sessionId, modelConfigId, execution)
  const { sessionRecord } = common

  log.info('[generate:addPage] context resolved', {
    sessionId,
    projectDir: common.projectDir,
    styleId: common.styleId,
    provider: common.provider,
    model: common.model,
    insertAfterPageNumber
  })

  return {
    ...common,
    sessionId,
    userDescription,
    insertAfterPageNumber,
    targetPageId,
    sessionRecord,
    messageScope: 'main' as const,
    messagePageId: undefined,
    effectiveMode: 'addPage' as const
  }
}

// ── Execute the full add-page generation ──

export async function executeAddPageGeneration(
  ctx: GenerationContext,
  context: AddPageContext
): Promise<void> {
  const {
    db,
    agentManager,
    sessionProject: { getPageSourceUrl },
    runtimeEmitters: { createDeckProgressEmitter },
    tuning: {
      designContractTemperature: DESIGN_CONTRACT_TEMPERATURE,
      pageGenerationTemperature: PAGE_GENERATION_TEMPERATURE
    }
  } = ctx

  if (!context.apiKey) {
    throw new Error(`当前 provider "${context.provider}" 缺少 API Key，请先到设置页配置。`)
  }

  const emitChunk = createDeckProgressEmitter(context.sessionId, context.appLocale)
  const sessionRecord = context.sessionRecord
  const indexPath = path.join(context.projectDir, 'index.html')
  await ctx.history.ensureBaseline(context.sessionId, context.projectDir)

  // ── Step 1: Read designContract from session independent field ──
  let designContract: DesignContract | undefined
  if (
    typeof sessionRecord.designContract === 'string' &&
    sessionRecord.designContract.trim().length > 0
  ) {
    try {
      designContract = JSON.parse(sessionRecord.designContract) as DesignContract
    } catch {
      // ignore malformed design contract
    }
  }
  if (!designContract) {
    throw new Error('当前会话缺少设计契约，无法新增页面。请先完成首次生成。')
  }

  // ── Step 2: Read existing pages from session_pages ──
  const existingPages = await db.listSessionPages(context.sessionId)

  if (existingPages.length === 0) {
    throw new Error('当前会话没有已完成的页面，无法新增。请先完成首次生成。')
  }

  const insertAfterPageNumber = context.insertAfterPageNumber
  const userDescription = context.userDescription
  const targetPage = context.targetPageId
    ? existingPages.find(
        (page) => page.id === context.targetPageId || page.file_slug === context.targetPageId
      )
    : null
  if (context.targetPageId && !targetPage) {
    throw new Error('未找到新增页面的空白占位页')
  }

  // ── Step 3: Plan new page ──
  emitChunk({
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'planning',
      label: uiText(context.appLocale, '正在规划新增页面', 'Planning the new page'),
      progress: 2,
      totalPages: 1
    }
  })

  const newPageNumber =
    targetPage?.page_number ?? Math.max(...existingPages.map((p) => p.page_number)) + 1
  const newPageEntityId = targetPage?.id ?? nanoid()
  const newPageId = targetPage?.file_slug ?? `page-${pageSlugId()}`
  const newHtmlPath = targetPage
    ? resolvePageHtmlPath({
        projectDir: context.projectDir,
        fileSlug: newPageId,
        candidates: [targetPage.html_path]
      })
    : path.join(context.projectDir, `${newPageId}.html`)

  const existingTitles = existingPages.map((p) => p.title).filter(Boolean)

  let planResult: { title: string; contentOutline: string; layoutIntent: LayoutIntent }
  try {
    planResult = await planNewPage({
      provider: context.provider,
      apiKey: context.apiKey,
      model: context.model,
      baseUrl: context.providerBaseUrl,
      maxTokens: context.maxTokens,
      modelRuntime: context.modelRuntime,
      modelTimeoutMs: context.modelTimeouts.planning,
      temperature: DESIGN_CONTRACT_TEMPERATURE,
      appLocale: context.appLocale,
      userDescription,
      topic: context.topic,
      existingTitles,
      sourceDocumentPaths: [],
      signal: context.abortSignal
    })
  } catch (planError) {
    // Retry plan once
    try {
      planResult = await planNewPage({
        provider: context.provider,
        apiKey: context.apiKey,
        model: context.model,
        baseUrl: context.providerBaseUrl,
        maxTokens: context.maxTokens,
        modelRuntime: context.modelRuntime,
        modelTimeoutMs: context.modelTimeouts.planning,
        temperature: DESIGN_CONTRACT_TEMPERATURE,
        appLocale: context.appLocale,
        userDescription,
        topic: context.topic,
        existingTitles,
        sourceDocumentPaths: [],
        signal: context.abortSignal
      })
    } catch {
      throw new Error(
        `规划新页面失败：${planError instanceof Error ? planError.message : String(planError)}`
      )
    }
  }

  // ── Step 4: Create scaffold ──
  if (!targetPage) {
    await fs.promises.writeFile(
      newHtmlPath,
      buildPageScaffoldHtml(
        {
          pageNumber: newPageNumber,
          pageId: newPageId,
          title: planResult.title
        },
        context.slideSize
      ),
      'utf-8'
    )
  }

  // ── Step 5: Generate with agent ──
  emitChunk({
    type: 'stage_started',
    payload: {
      runId: context.runId,
      stage: 'rendering',
      label: uiText(context.appLocale, '正在生成新增页面', 'Generating the new page'),
      progress: 10,
      totalPages: 1
    }
  })

  await db.createGenerationRun({
    id: context.runId,
    sessionId: context.sessionId,
    mode: 'addPage',
    totalPages: 1,
    modelConfigId: context.modelConfigId,
    metadata: {
      addPage: true,
      pageId: newPageId,
      insertAfterPageNumber,
      modelConfigId: context.modelConfigId,
      modelConfigName: context.modelConfigName,
      provider: context.provider,
      model: context.model
    }
  })
  await db.upsertGenerationPage({
    runId: context.runId,
    sessionId: context.sessionId,
    pageId: newPageId,
    pageNumber: newPageNumber,
    title: planResult.title,
    contentOutline: planResult.contentOutline,
    layoutIntent: planResult.layoutIntent,
    htmlPath: newHtmlPath,
    status: 'pending'
  })
  await db.upsertSessionPage({
    id: newPageEntityId,
    sessionId: context.sessionId,
    legacyPageId: null,
    fileSlug: newPageId,
    pageNumber: newPageNumber,
    title: planResult.title,
    htmlPath: newHtmlPath,
    status: 'pending',
    error: null
  })

  const pageFileMap: Record<string, string> = { [newPageId]: newHtmlPath }
  const pageNumbers: Record<string, number> = { [newPageId]: newPageNumber }
  const pageCallbacks = createGenerationPageCallbacks({
    db,
    runId: context.runId,
    sessionId: context.sessionId
  })
  let agentSummary = ''
  try {
    const generationResult = await generatePagesWithRetry({
      runArgs: {
        sessionId: context.sessionId,
        provider: context.provider,
        apiKey: context.apiKey,
        model: context.model,
        baseUrl: context.providerBaseUrl,
        maxTokens: context.maxTokens,
        modelTimeoutMs: context.modelTimeouts.agent,
        temperature: PAGE_GENERATION_TEMPERATURE,
        styleId: context.styleId,
        styleSkillPrompt: context.styleSkillPrompt,
        hasStyleImageDirection: Boolean(context.imageGenerationPrompt.trim()),
        styleKey: context.styleKey,
        styleName: context.styleName,
        styleVersion: context.styleVersion,
        slideSize: context.slideSize,
        appLocale: context.appLocale,
        topic: context.topic,
        deckTitle: context.deckTitle,
        userMessage: userDescription,
        outlineTitles: [planResult.title],
        outlineItems: [planResult],
        sourceDocumentPaths: [],
        generationMode: 'generate',
        visualEnabled: context.visualEnabled,
        renderingLabel: uiText(context.appLocale, '正在生成新增页面', 'Generating the new page'),
        pageTasks: [
          {
            pageNumber: newPageNumber,
            pageId: newPageId,
            title: planResult.title,
            contentOutline: planResult.contentOutline,
            layoutIntent: planResult.layoutIntent
          }
        ],
        designContract,
        projectDir: context.projectDir,
        indexPath,
        pageFileMap,
        pageNumbers,
        agentManager,
        emit: (chunk) => emitChunk(chunk),
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
        ...pageCallbacks,
        runId: context.runId,
        signal: context.abortSignal
      },
      emitChunk,
      appLocale: context.appLocale,
      runId: context.runId,
      totalPages: 1,
      retryDetail: uiText(
        context.appLocale,
        `页面生成失败，正在重试...`,
        `Page generation failed, retrying...`
      )
    })
    agentSummary = generationResult.summary.trim()
    if (context.abortSignal.aborted) throw new Error('生成已取消')

    // ── Step 6: Validate generated page ──
    if (!fs.existsSync(newHtmlPath)) {
      throw new Error(`${newPageId}.html 缺失`)
    }
    const newPageValidation = validatePersistedPageHtml(
      await fs.promises.readFile(newHtmlPath, 'utf-8'),
      newPageId
    )
    if (!newPageValidation.valid) {
      throw new Error(`新页面 HTML 验证失败: ${newPageValidation.errors.join('; ')}`)
    }
    const generatedPage = (await db.listGenerationPages(context.runId)).find(
      (page) => page.page_id === newPageId
    )
    await db.upsertSessionPage({
      id: newPageEntityId,
      sessionId: context.sessionId,
      legacyPageId: targetPage?.legacy_page_id || null,
      fileSlug: newPageId,
      pageNumber: newPageNumber,
      title: generatedPage?.title || planResult.title,
      htmlPath: newHtmlPath,
      layoutIntent: generatedPage?.layout_intent || planResult.layoutIntent,
      layoutId: generatedPage?.layout_id || null,
      layoutContractVersion: generatedPage?.layout_contract_version || null,
      status: 'completed',
      error: null
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Page generation failed'
    await db.upsertSessionPage({
      id: newPageEntityId,
      sessionId: context.sessionId,
      legacyPageId: null,
      fileSlug: newPageId,
      pageNumber: newPageNumber,
      title: planResult.title,
      htmlPath: newHtmlPath,
      status: 'failed',
      error: errorMessage
    })
    throw error
  }

  // ── Step 7: Merge into existing pages and renumber ──
  const newPageHtml = await fs.promises.readFile(newHtmlPath, 'utf-8')
  const newPageEntry = {
    id: newPageEntityId,
    pageNumber: targetPage?.page_number ?? insertAfterPageNumber + 1,
    title: planResult.title,
    pageId: newPageId,
    htmlPath: newHtmlPath,
    html: newPageHtml
  }

  // Read existing page HTMLs for the merge
  const existingPageDescriptors = await Promise.all(
    existingPages.map(async (page) => {
      const pageId = page.file_slug
      const htmlPath = resolvePageHtmlPath({
        projectDir: context.projectDir,
        fileSlug: pageId,
        candidates: [page.html_path]
      })
      const html = fs.existsSync(htmlPath) ? await fs.promises.readFile(htmlPath, 'utf-8') : ''
      return {
        id: page.id,
        pageNumber: page.page_number,
        title: page.title,
        pageId,
        htmlPath,
        html
      }
    })
  )

  const mergedPages = targetPage
    ? existingPageDescriptors.map((page) => (page.id === targetPage.id ? newPageEntry : page))
    : [
        ...existingPageDescriptors.filter((page) => page.pageNumber <= insertAfterPageNumber),
        newPageEntry,
        ...existingPageDescriptors.filter((page) => page.pageNumber > insertAfterPageNumber)
      ]

  // Renumber
  const renumberedPages = mergedPages.map((page, index) => ({
    ...page,
    pageNumber: index + 1
  }))

  // ── Step 8: Rebuild index.html ──
  await fs.promises.writeFile(
    indexPath,
    buildProjectIndexHtml(
      context.deckTitle,
      renumberedPages.map(
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

  const sessionPagesAfterGeneration = await db.listSessionPages(context.sessionId, {
    includeDeleted: true
  })
  const sessionPageById = new Map(sessionPagesAfterGeneration.map((page) => [page.id, page]))
  for (const page of renumberedPages) {
    const sessionPage = sessionPageById.get(page.id)
    await db.upsertSessionPage({
      id: page.id,
      sessionId: context.sessionId,
      legacyPageId: sessionPage?.legacy_page_id || null,
      fileSlug: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      htmlPath: page.htmlPath,
      layoutIntent: sessionPage?.layout_intent,
      layoutId: sessionPage?.layout_id,
      layoutContractVersion: sessionPage?.layout_contract_version,
      status: sessionPage?.status || 'completed',
      error: sessionPage?.error || null
    })
  }

  // ── Step 9: Emit page_generated event ──
  const renumberedNewPage = renumberedPages.find((p) => p.pageId === newPageId)
  const generatedPayload = {
    pageNumber: renumberedNewPage?.pageNumber ?? newPageEntry.pageNumber,
    title: newPageEntry.title,
    pageId: newPageEntry.pageId,
    htmlPath: newPageEntry.htmlPath,
    html: newPageEntry.html,
    sourceUrl: getPageSourceUrl(newPageEntry.htmlPath)
  }

  emitChunk({
    type: 'page_generated',
    payload: {
      runId: context.runId,
      stage: 'rendering',
      label: progressText(context.appLocale, 'completed'),
      progress: 95,
      currentPage: generatedPayload.pageNumber,
      totalPages: renumberedPages.length,
      ...generatedPayload
    }
  })

  // ── Step 10: Finalize ──
  // Persist assistant message
  const assistantContent =
    agentSummary ||
    uiText(
      context.appLocale,
      `已新增页面「${planResult.title}」并插入到第 ${insertAfterPageNumber} 页之后。`,
      `Added page "${planResult.title}" after page ${insertAfterPageNumber}.`
    )
  await db.addMessage(context.sessionId, {
    role: 'assistant',
    content: assistantContent,
    type: 'text',
    chat_scope: 'main' as const,
    run_model: context.runModel
  })
  emitChunk({
    type: 'assistant_message',
    payload: {
      runId: context.runId,
      content: assistantContent,
      chatType: 'main',
      pageId: undefined
    }
  })

  await finalizeGenerationSuccess(ctx, {
    context,
    indexPath,
    totalPages: renumberedPages.length,
    generatedPages: renumberedPages
  })
}
