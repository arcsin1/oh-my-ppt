import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import log from 'electron-log/main.js'
import type {
  GeneratedImageAsset,
  ImageGenerationHistoryRecord,
  ImageModelProvider
} from '@shared/image-generation'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import type { IpcContext } from '../ipc/context'
import { readAppLocale, uiText, type AppLocale } from '../config/locale-utils'
import {
  resolveGlobalModelTimeouts,
  resolveModelConfigForTask,
  type ActiveModelConfig
} from '../config/model-config-utils'
import { allowLocalAssetRoot } from '../io/local-asset-roots'
import { extractModelText, resolveModel } from '../agent-runtime/model'
import { buildImagePromptGenerationMessages } from '../agent-runtime/prompt'
import { resolveImageGenerationProvider } from '../agent-runtime/provider/image'
import {
  getImageModelDisplayName,
  resolveActiveOrSelectedImageModel
} from './model-config'
import {
  compactPageHtmlForImagePrompt,
  normalizeGeneratedImagePrompt
} from './prompt-director'
import {
  imageHistoryLockKey,
  JobCoordinator,
  type TypedEventBus
} from '../agent-runtime'
import {
  getImageRunState,
  setImageRunState,
  type ImageRunState,
  type ImageRunStatus
} from './run-state'

const resolvePageContext = async (
  ctx: IpcContext,
  sessionId: string,
  pageId: string
): Promise<{ pageId: string; title: string; contentOutline: string; htmlPath: string }> => {
  const pages = await ctx.db.listSessionPages(sessionId)
  const page = pages.find(
    (item) => item.id === pageId || item.file_slug === pageId || item.legacy_page_id === pageId
  )
  if (!page) throw new Error('请先选择一个可用页面。')
  const snapshots = await ctx.db.listLatestGenerationPageSnapshot(sessionId)
  const snapshot = snapshots.find(
    (item) => item.page_id === page.id || item.page_id === page.file_slug || item.page_id === page.legacy_page_id
  )
  return {
    pageId: page.id,
    title: page.title || snapshot?.title || `Page ${page.page_number}`,
    contentOutline: snapshot?.content_outline || '',
    htmlPath: page.html_path
  }
}

const sanitizeExt = (extension: string): string =>
  /^\.[a-z0-9]{2,5}$/i.test(extension) ? extension.toLowerCase() : '.png'

const resolvePromptModelConfig = async (
  ctx: IpcContext,
  modelConfigId?: string
): Promise<ActiveModelConfig> => {
  return resolveModelConfigForTask(ctx, {
    modelConfigId,
    purpose: 'images:generatePrompt'
  })
}

export function registerImageGenerationHandlers(
  ctx: IpcContext,
  coordinator: JobCoordinator,
  runtimeEvents: TypedEventBus
): void {
  const emitImageProgress = (state: ImageRunState): void => {
    runtimeEvents.emit({
      type: 'image.progress',
      payload: {
        runId: state.runId,
        sessionId: state.sessionId,
        pageId: state.pageId,
        progress: state.progress,
        label: state.label,
        status: state.status
      },
      jobId: state.runId,
      domain: 'image',
      owner: { sessionId: state.sessionId, imageHistoryOwner: state.sessionId },
      audience: { kind: 'broadcast' },
      occurredAt: state.updatedAt
    })
  }

  const updateImageRunState = (state: ImageRunState): void => {
    setImageRunState(state)
    emitImageProgress(state)
  }

  const emitImageJobTerminalEvent = (args: {
    runId: string
    sessionId: string
    status: Exclude<ImageRunStatus, 'running'>
    errorMessage?: string
  }): void => {
    runtimeEvents.emit({
      type:
        args.status === 'completed'
          ? 'job.completed'
          : args.status === 'cancelled'
            ? 'job.cancelled'
            : 'job.failed',
      payload:
        args.status === 'completed'
          ? {}
          : args.status === 'cancelled'
            ? { reason: 'user' }
            : {
                errorCode: 'image_generation_failed',
                errorMessage: args.errorMessage || 'Image generation failed'
              },
      jobId: args.runId,
      domain: 'image',
      owner: { sessionId: args.sessionId, imageHistoryOwner: args.sessionId },
      audience: { kind: 'broadcast' },
      occurredAt: Date.now()
    })
  }

  const throwIfCancelled = (signal: AbortSignal, locale: AppLocale): void => {
    if (signal.aborted) {
      throw new Error(uiText(locale, '已取消生图', 'Image generation cancelled'))
    }
  }

  ipcMain.handle('images:generatePrompt', async (_event, payload) => {
    const locale = await readAppLocale(ctx)
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const htmlPath = typeof record.htmlPath === 'string' ? record.htmlPath.trim() : ''
    if (!sessionId) throw new Error(uiText(locale, '会话 ID 不能为空。', 'Session ID is required.'))
    if (!htmlPath) {
      throw new Error(
        uiText(locale, '当前页文件地址不能为空。', 'Current page file path is required.')
      )
    }

    const safeHtmlPath = await ctx.assertPathInAllowedRoots({
      filePath: htmlPath,
      mode: 'read',
      sessionId,
      htmlOnly: true
    })
    const pageHtml = compactPageHtmlForImagePrompt(await fs.promises.readFile(safeHtmlPath, 'utf-8'))
    if (!pageHtml) {
      throw new Error(uiText(locale, '当前页内容为空。', 'Current page content is empty.'))
    }

    const activeModel = await resolvePromptModelConfig(
      ctx,
      typeof record.modelConfigId === 'string' ? record.modelConfigId : undefined
    )
    const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
    const timeoutMs = resolveModelTimeoutMs(modelTimeouts.agent, 'agent')
    const model = resolveModel(
      activeModel.provider,
      activeModel.apiKey,
      activeModel.model,
      activeModel.baseUrl,
      0.45,
      activeModel.maxTokens,
      ctx.modelRuntime
    )
    const userPrompt = typeof record.userPrompt === 'string' ? record.userPrompt.trim() : ''
    const pageTitle = typeof record.pageTitle === 'string' ? record.pageTitle.trim() : ''
    const pageOutline = typeof record.pageOutline === 'string' ? record.pageOutline.trim() : ''
    log.info('[images:generatePrompt] start', {
      sessionId,
      htmlPath: safeHtmlPath,
      modelConfigId: activeModel.id,
      model: activeModel.model,
      htmlLength: pageHtml.length,
      userPromptLength: userPrompt.length,
      pageTitleLength: pageTitle.length,
      pageOutlineLength: pageOutline.length
    })

    const response = await model.invoke(
      buildImagePromptGenerationMessages({
        locale,
        userPrompt,
        pageTitle,
        pageOutline,
        pageHtml
      }),
      { signal: AbortSignal.timeout(timeoutMs) }
    )
    const prompt = normalizeGeneratedImagePrompt(extractModelText(response))
    if (!prompt) {
      throw new Error(uiText(locale, '模型未返回提示词。', 'The model returned an empty prompt.'))
    }
    log.info('[images:generatePrompt] completed', {
      sessionId,
      promptLength: prompt.length
    })
    return { prompt }
  })

  ipcMain.handle('images:generate', async (_event, payload) => {
    const locale = await readAppLocale(ctx)
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const pageId = typeof record.pageId === 'string' ? record.pageId.trim() : ''
    const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : ''
    if (!sessionId) throw new Error(uiText(locale, '会话 ID 不能为空。', 'Session ID is required.'))
    if (!pageId) throw new Error(uiText(locale, '请先选择页面。', 'Select a page first.'))
    if (!prompt) throw new Error(uiText(locale, '请先填写图片描述。', 'Enter an image prompt first.'))

    const count =
      typeof record.count === 'number' && record.count > 0
        ? Math.min(Math.floor(record.count), 4)
        : 1
    const size = typeof record.size === 'string' && record.size.trim() ? record.size.trim() : '16:9'
    const runId = nanoid(12)
    const reservation = await coordinator.reserve({
      jobId: runId,
      domain: 'image',
      owner: { kind: 'image-history', id: sessionId },
      claims: { write: [imageHistoryLockKey(sessionId)] },
      wait: 'fail'
    })
    if (reservation.status === 'busy') {
      throw new Error(
        uiText(
          locale,
          '当前会话已有图片生成任务正在进行。',
          'An image generation task is already running for this session.'
        )
      )
    }

    const lease = reservation.lease
    const startedAt = Date.now()
    let resolvedPageId = pageId
    let resolvedProvider: ImageModelProvider | undefined
    const uncommittedImagePaths: string[] = []
    let historyCommitted = false
    const initialState: ImageRunState = {
      runId,
      sessionId,
      pageId,
      progress: 5,
      label: uiText(locale, '准备生图', 'Preparing image generation'),
      status: 'running',
      updatedAt: Date.now()
    }
    setImageRunState(initialState)
    runtimeEvents.emit({
      type: 'job.started',
      payload: {},
      jobId: runId,
      domain: 'image',
      owner: { sessionId, imageHistoryOwner: sessionId },
      audience: { kind: 'broadcast' },
      occurredAt: startedAt
    })
    emitImageProgress(initialState)

    try {
      const modelConfig = await resolveActiveOrSelectedImageModel(
        ctx,
        typeof record.imageModelConfigId === 'string'
          ? record.imageModelConfigId
          : typeof record.modelConfigId === 'string'
            ? record.modelConfigId
            : undefined
      )
      throwIfCancelled(lease.signal, locale)
      const pageContext = await resolvePageContext(ctx, sessionId, pageId)
      throwIfCancelled(lease.signal, locale)
      resolvedPageId = pageContext.pageId
      resolvedProvider = modelConfig.provider
      const displayModel = getImageModelDisplayName(modelConfig)
      log.info('[images:generate] start', {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        requestedPageId: pageId,
        pageTitle: pageContext.title,
        modelConfigId: modelConfig.id,
        modelConfigName: modelConfig.name,
        provider: modelConfig.provider,
        model: displayModel,
        count,
        size,
        promptLength: prompt.length,
        negativePromptLength:
          typeof record.negativePrompt === 'string' ? record.negativePrompt.length : 0,
        hasSeed: typeof record.seed === 'number'
      })
      const adapter = resolveImageGenerationProvider(modelConfig.provider)
      const results = await adapter.generate(modelConfig, {
        prompt,
        count,
        size,
        negativePrompt: typeof record.negativePrompt === 'string' ? record.negativePrompt : undefined,
        seed: typeof record.seed === 'number' ? record.seed : undefined,
        signal: lease.signal
      })
      throwIfCancelled(lease.signal, locale)
      log.info('[images:generate] provider returned', {
        runId,
        provider: modelConfig.provider,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt
      })
      updateImageRunState({
        runId,
        sessionId,
        pageId: pageContext.pageId,
        progress: 80,
        label: uiText(locale, '正在保存图片', 'Saving images'),
        status: 'running',
        updatedAt: Date.now()
      })
      const projectDir = await ctx.resolveSessionProjectDir(sessionId)
      throwIfCancelled(lease.signal, locale)
      const imagesDir = path.join(projectDir, 'images')
      log.info('[images:generate] save start', {
        runId,
        imagesDir,
        resultCount: results.length
      })
      await fs.promises.mkdir(imagesDir, { recursive: true })
      allowLocalAssetRoot(imagesDir)
      const createdAt = Math.floor(Date.now() / 1000)
      const assets: GeneratedImageAsset[] = []
      for (const result of results) {
        throwIfCancelled(lease.signal, locale)
        const id = nanoid(10)
        const extension = sanitizeExt(result.extension)
        const fileName = `${ctx.toSafeAssetBaseName(`generated-${pageContext.title}`)}-${id}${extension}`
        const absolutePath = path.join(imagesDir, fileName)
        await fs.promises.writeFile(absolutePath, result.bytes)
        uncommittedImagePaths.push(absolutePath)
        const stat = await fs.promises.stat(absolutePath)
        log.info('[images:generate] asset saved', {
          runId,
          assetId: id,
          fileName,
          mimeType: result.mimeType,
          size: stat.size
        })
        assets.push({
          id,
          fileName,
          originalName: fileName,
          relativePath: `./images/${fileName}`,
          absolutePath,
          mimeType: result.mimeType,
          size: stat.size,
          prompt,
          modelConfigId: modelConfig.id,
          provider: modelConfig.provider,
          model: displayModel,
          pageId: pageContext.pageId,
          createdAt
        })
      }
      throwIfCancelled(lease.signal, locale)
      const historyId = await ctx.db.insertImageGenerationHistory({
        sessionId,
        pageId: pageContext.pageId,
        prompt,
        imagePaths: assets.map((asset) => asset.relativePath),
        modelConfigId: modelConfig.id,
        provider: modelConfig.provider,
        model: displayModel,
        createdAt
      })
      historyCommitted = true
      const history: ImageGenerationHistoryRecord = {
        id: historyId,
        sessionId,
        pageId: pageContext.pageId,
        prompt,
        imagePaths: assets.map((asset) => asset.relativePath),
        assets,
        modelConfigId: modelConfig.id,
        provider: modelConfig.provider,
        model: displayModel,
        createdAt
      }
      log.info('[images:generate] history saved', {
        runId,
        historyId,
        imagePathCount: history.imagePaths.length
      })
      updateImageRunState({
        runId,
        sessionId,
        pageId: pageContext.pageId,
        progress: 100,
        label: uiText(locale, '生图完成', 'Image generation completed'),
        status: 'completed',
        updatedAt: Date.now()
      })
      emitImageJobTerminalEvent({ runId, sessionId, status: 'completed' })
      log.info('[images:generate] completed', {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        assetCount: assets.length,
        elapsedMs: Date.now() - startedAt
      })
      return { history }
    } catch (error) {
      if (!historyCommitted && uncommittedImagePaths.length > 0) {
        const cleanupResults = await Promise.allSettled(
          uncommittedImagePaths.map((filePath) => fs.promises.rm(filePath, { force: true }))
        )
        const cleanupFailures = cleanupResults.filter((result) => result.status === 'rejected')
        if (cleanupFailures.length > 0) {
          log.warn('[images:generate] failed to clean up uncommitted assets', {
            runId,
            failureCount: cleanupFailures.length
          })
        }
      }
      const message = error instanceof Error ? error.message : String(error)
      const wasCancelled = lease.signal.aborted
      const logPayload = {
        runId,
        sessionId,
        pageId: resolvedPageId,
        provider: resolvedProvider,
        message,
        elapsedMs: Date.now() - startedAt
      }
      if (wasCancelled) {
        log.warn('[images:generate] cancelled', logPayload)
      } else {
        log.error('[images:generate] failed', logPayload)
      }
      updateImageRunState({
        runId,
        sessionId,
        pageId: resolvedPageId,
        progress: 100,
        label: wasCancelled ? uiText(locale, '已取消生图', 'Image generation cancelled') : message,
        status: wasCancelled ? 'cancelled' : 'failed',
        error: message,
        updatedAt: Date.now()
      })
      emitImageJobTerminalEvent({
        runId,
        sessionId,
        status: wasCancelled ? 'cancelled' : 'failed',
        errorMessage: message
      })
      throw error
    } finally {
      lease.release()
    }
  })

  ipcMain.handle('images:cancel', async (_event, sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return { success: false }
    const state = getImageRunState(sessionId.trim())
    if (!state || state.status !== 'running') return { success: false }
    log.warn('[images:cancel] abort requested', {
      runId: state.runId,
      sessionId: state.sessionId,
      pageId: state.pageId,
      progress: state.progress
    })
    return { success: coordinator.cancel(state.runId) }
  })

  ipcMain.handle('images:getState', async (_event, sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return null
    const state = getImageRunState(sessionId.trim())
    if (!state) return null
    return {
      runId: state.runId,
      sessionId: state.sessionId,
      pageId: state.pageId,
      progress: state.progress,
      label: state.label,
      status: state.status,
      error: state.error || null,
      updatedAt: state.updatedAt
    }
  })
}
