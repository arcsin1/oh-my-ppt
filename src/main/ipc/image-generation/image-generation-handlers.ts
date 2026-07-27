import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { nanoid } from 'nanoid'
import log from 'electron-log/main.js'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type {
  GeneratedImageAsset,
  ImageGenerationHistoryRecord,
  ImageModelProvider
} from '@shared/image-generation'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import type { IpcContext } from '../context'
import { readAppLocale, uiText, type AppLocale } from '../config/locale-utils'
import {
  resolveGlobalModelTimeouts,
  resolveModelConfigForTask,
  type ActiveModelConfig
} from '../config/model-config-utils'
import { extractModelText } from '../utils'
import { allowLocalAssetRoot } from '../io/assets-handlers'
import { resolveModel } from '../../agent'
import { resolveImageGenerationProvider } from '../../image-generation/providers'
import type { ResolvedImageModelConfig } from '../../image-generation/types'

type ImageRunState = {
  runId: string
  sessionId: string
  pageId: string
  progress: number
  label: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  error?: string
  abortController: AbortController
  updatedAt: number
}

const imageRunStates = new Map<string, ImageRunState>()

const VALID_IMAGE_PROVIDERS = [
  'jimeng',
  'jimeng4',
  'agnes',
  'siliconflow',
  'openaiCompatible',
  'gemini',
  'seedream'
] as const

const resolveProvider = (provider: unknown): ImageModelProvider => {
  if (VALID_IMAGE_PROVIDERS.includes(provider as ImageModelProvider)) {
    return provider as ImageModelProvider
  }
  throw new Error('Unsupported image provider')
}

const readJsonObject = (value: unknown): Record<string, unknown> => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const readConfigString = (config: ResolvedImageModelConfig, key: string): string => {
  const value = config.modelConfig[key]
  return typeof value === 'string' ? value.trim() : ''
}

const resolveDisplayModel = (config: ResolvedImageModelConfig): string =>
  readConfigString(config, 'model') || readConfigString(config, 'reqKey') || config.provider

const resolveImageModelConfig = async (
  ctx: IpcContext,
  modelConfigId?: string
): Promise<ResolvedImageModelConfig> => {
  const raw =
    modelConfigId && modelConfigId.trim().length > 0
      ? await ctx.db.getImageModelConfig(modelConfigId.trim())
      : await ctx.db.getActiveImageModelConfig()
  if (!raw) throw new Error('请先在设置中配置并启用生图模型。')
  if (raw.provider !== 'openaiCompatible') {
    throw new Error('安居建业内部版仅支持 OpenAI 兼容生图协议；首版 BYOK 默认关闭生图。')
  }
  return {
    id: raw.id,
    name: raw.name,
    provider: resolveProvider(raw.provider),
    active: raw.active === 1,
    modelConfig: readJsonObject(ctx.decryptApiKey(raw.modelConfig || '{}'))
  }
}

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

const compactPageHtmlForPrompt = (html: string): string =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24000)

const normalizeGeneratedImagePrompt = (raw: string): string =>
  raw
    .replace(/^```(?:text|markdown|md)?\s*/i, '')
    .replace(/```$/i, '')
    .replace(/^\s*(?:prompt|提示词)\s*[:：]\s*/i, '')
    .trim()

const buildImagePromptGenerationMessages = (args: {
  locale: AppLocale
  userPrompt: string
  pageTitle: string
  pageOutline: string
  pageHtml: string
}): [SystemMessage, HumanMessage] => {
  const isZh = args.locale.startsWith('zh')
  const systemPrompt = isZh
    ? `你是 PPT 生图描述改写助手。你的任务不是总结风格，而是把用户想生成的画面改写成一条可直接发给生图模型的最终配图描述，并让它自然匹配当前页。

规则：
- 只输出配图描述本身，不要解释、不要 Markdown、不要编号。
- 如果用户提供了想画的内容，必须保留这个核心画面；当前页只作为风格、氛围、构图和留白参考。
- 如果用户没有提供想画的内容，再从页面标题、大纲和内容推断一个合适的配图主题。
- 不要输出“当前页风格是...”这类分析文字，也不要输出模板字段。
- 用自然、友好的语言写成一小段，不要堆参数词。
- 最终描述要包含主体、场景、构图、色彩、材质、光影和插画/摄影风格。
- 图片用于 PPT 背景或插画，必须避免任何可读文字、标题、logo、水印、界面截图、假图表标签。
- 保留适合幻灯片放文字的留白。
- 不要写画幅比例、尺寸或分辨率。
- 不要照抄页面已有文字；把页面内容转化成视觉意象。`
    : `You are a presentation image-description rewriting assistant. Do not summarize the style. Rewrite the user's desired image into one final description that can be sent directly to an image generation model, naturally matching the current slide.

Rules:
- Output only the visual description itself. No explanation, Markdown, or numbering.
- If the user provides desired content, preserve that core image; use the current slide only as style, mood, composition, and whitespace reference.
- If the user provides no desired content, infer a suitable visual subject from the slide title, outline, and content.
- Do not output style analysis such as "the current slide style is..." and do not output template fields.
- Write one short, natural, friendly paragraph instead of a pile of parameter keywords.
- The final description should include subject, scene, composition, palette, material, lighting, and photography/illustration style.
- The image is for a slide background or illustration. Avoid readable text, titles, logos, watermarks, UI screenshots, and fake chart labels.
- Preserve clean negative space for slide typography.
- Do not mention aspect ratios, sizes, or resolutions.
- Do not copy slide text literally; translate the slide content into visual imagery.`

  const userPrompt = isZh
    ? `【页面标题】
${args.pageTitle || '（无标题）'}

【页面大纲】
${args.pageOutline || '（无大纲）'}

【用户想生成的画面】
${args.userPrompt || '（用户未填写，请根据当前页推断配图主题）'}

【当前页 HTML/CSS，供分析视觉风格】
${args.pageHtml}

请输出一条最终配图描述。它应该能直接填入生图模型，而不是风格总结。`
    : `[Slide title]
${args.pageTitle || '(untitled)'}

[Slide outline]
${args.pageOutline || '(no outline)'}

[User desired image]
${args.userPrompt || '(User did not provide one. Infer a visual subject from the current slide.)'}

[Current slide HTML/CSS for visual style analysis]
${args.pageHtml}

Output one final visual description that can be pasted directly into an image model. Do not summarize the style.`

  return [new SystemMessage(systemPrompt), new HumanMessage(userPrompt)]
}

const resolvePromptModelConfig = async (
  ctx: IpcContext,
  modelConfigId?: string
): Promise<ActiveModelConfig> => {
  return resolveModelConfigForTask(ctx, {
    modelConfigId,
    purpose: 'images:generatePrompt'
  })
}

export function registerImageGenerationHandlers(ctx: IpcContext): void {
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
    const pageHtml = compactPageHtmlForPrompt(await fs.promises.readFile(safeHtmlPath, 'utf-8'))
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
      activeModel.maxTokens
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

    const modelConfig = await resolveImageModelConfig(
      ctx,
      typeof record.imageModelConfigId === 'string'
        ? record.imageModelConfigId
        : typeof record.modelConfigId === 'string'
          ? record.modelConfigId
          : undefined
    )
    const pageContext = await resolvePageContext(ctx, sessionId, pageId)
    const count =
      typeof record.count === 'number' && record.count > 0
        ? Math.min(Math.floor(record.count), 4)
        : 1
    const size = typeof record.size === 'string' && record.size.trim() ? record.size.trim() : '16:9'
    const displayModel = resolveDisplayModel(modelConfig)
    const runId = nanoid(12)
    const abortController = new AbortController()
    const startedAt = Date.now()
    imageRunStates.set(sessionId, {
      runId,
      sessionId,
      pageId: pageContext.pageId,
      progress: 5,
      label: uiText(locale, '准备生图', 'Preparing image generation'),
      status: 'running',
      abortController,
      updatedAt: Date.now()
    })

    try {
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
        signal: abortController.signal
      })
      log.info('[images:generate] provider returned', {
        runId,
        provider: modelConfig.provider,
        resultCount: results.length,
        elapsedMs: Date.now() - startedAt
      })
      imageRunStates.set(sessionId, {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        progress: 80,
        label: uiText(locale, '正在保存图片', 'Saving images'),
        status: 'running',
        abortController,
        updatedAt: Date.now()
      })
      const projectDir = await ctx.resolveSessionProjectDir(sessionId)
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
        const id = nanoid(10)
        const extension = sanitizeExt(result.extension)
        const fileName = `${ctx.toSafeAssetBaseName(`generated-${pageContext.title}`)}-${id}${extension}`
        const absolutePath = path.join(imagesDir, fileName)
        await fs.promises.writeFile(absolutePath, result.bytes)
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
      imageRunStates.set(sessionId, {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        progress: 100,
        label: uiText(locale, '生图完成', 'Image generation completed'),
        status: 'completed',
        abortController,
        updatedAt: Date.now()
      })
      log.info('[images:generate] completed', {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        assetCount: assets.length,
        elapsedMs: Date.now() - startedAt
      })
      return { history }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const wasCancelled = abortController.signal.aborted
      const logPayload = {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        provider: modelConfig.provider,
        message,
        elapsedMs: Date.now() - startedAt
      }
      if (wasCancelled) {
        log.warn('[images:generate] cancelled', logPayload)
      } else {
        log.error('[images:generate] failed', logPayload)
      }
      imageRunStates.set(sessionId, {
        runId,
        sessionId,
        pageId: pageContext.pageId,
        progress: 100,
        label: wasCancelled ? uiText(locale, '已取消生图', 'Image generation cancelled') : message,
        status: wasCancelled ? 'cancelled' : 'failed',
        error: message,
        abortController,
        updatedAt: Date.now()
      })
      throw error
    }
  })

  ipcMain.handle('images:cancel', async (_event, sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return { success: false }
    const state = imageRunStates.get(sessionId.trim())
    if (!state || state.status !== 'running') return { success: false }
    log.warn('[images:cancel] abort requested', {
      runId: state.runId,
      sessionId: state.sessionId,
      pageId: state.pageId,
      progress: state.progress
    })
    state.abortController.abort()
    return { success: true }
  })

  ipcMain.handle('images:getState', async (_event, sessionId) => {
    if (typeof sessionId !== 'string' || !sessionId.trim()) return null
    const state = imageRunStates.get(sessionId.trim())
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
