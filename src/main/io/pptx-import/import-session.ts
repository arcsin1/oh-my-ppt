import log from 'electron-log/main.js'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { customAlphabet } from 'nanoid'
import type { IpcContext } from '../../ipc/context'
import { importPptxToEditableHtml, type PptxImportProgressPayload } from './index'
import { extractStyleFromExistingHtml } from '../../styles/import/pptx'
import { createPptxChartRewriteHandler } from './chart-rewrite-agent'
import { createStyleSkill, resolveUsableStyleId } from '../../styles/catalog'
import {
  resolveGlobalModelTimeouts,
  resolveModelConfigForTask
} from '../../config/model-config-utils'
import { buildDesignContractWithLLM } from '../../generation/agent-runner'
import { createPptxImportPostPersistProgress } from './progress'
import { recordHistoryOperationStrict } from '../../history/git-history-service'
import { createDefaultDesignContract } from '../../presentation/design-contract'
import { requireSlideSizePreset } from '@shared/slide-size'
import { createSessionMasterIfMissing } from '../../session/master-service'
import { MAX_PPTX_IMPORT_SIZE, MAX_PPTX_IMPORT_SIZE_MB } from './constants'

const nanoidLower = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)

export type ImportPptxToSessionArgs = {
  sourcePath: string
  title?: string
  styleId?: string | null
  modelConfigId?: string
  onProgress?: (progress: PptxImportProgressPayload) => void
}

export type ImportPptxToSessionResult = {
  sessionId: string
  pageCount: number
  warnings: string[]
}

export type ImportPptxContext = Pick<
  IpcContext,
  'db' | 'resolveStoragePath' | 'ensureSessionAssets' | 'modelRuntime' | 'decryptApiKey'
>

export function assertPptxImportSource(sourcePath: string): { size: number } {
  const extension = path.extname(sourcePath).toLowerCase()
  if (extension !== '.pptx') {
    throw new Error('仅支持导入 .pptx 文件')
  }
  const stat = fs.statSync(sourcePath)
  if (stat.size > MAX_PPTX_IMPORT_SIZE) {
    throw new Error(`PPTX 文件不能超过 ${MAX_PPTX_IMPORT_SIZE_MB}MB`)
  }
  return { size: stat.size }
}

export async function importPptxToSession(
  ctx: ImportPptxContext,
  args: ImportPptxToSessionArgs
): Promise<ImportPptxToSessionResult> {
  const { db, resolveStoragePath, ensureSessionAssets } = ctx
  const sourcePath = path.resolve(args.sourcePath)
  const { size } = assertPptxImportSource(sourcePath)

  const sessionId = crypto.randomUUID()
  const storagePath = await resolveStoragePath()
  const projectDir = path.join(storagePath, sessionId)
  const originalFileName = path.basename(sourcePath)
  const title =
    (typeof args.title === 'string' && args.title.trim()) ||
    path.basename(originalFileName, path.extname(originalFileName)) ||
    '导入的 PPTX'

  const sendProgress = (progress: PptxImportProgressPayload): void => {
    args.onProgress?.({ ...progress, sessionId })
  }

  log.info('[pptx:import] invoke', {
    sessionId,
    filePath: sourcePath,
    size
  })

  try {
    await fs.promises.mkdir(projectDir, { recursive: true })
    await ensureSessionAssets(projectDir)
    await createSessionMasterIfMissing(projectDir)
    let chartRewrite: ReturnType<typeof createPptxChartRewriteHandler> | undefined
    try {
      const activeModel = await resolveModelConfigForTask(ctx, {
        modelConfigId: args.modelConfigId,
        purpose: 'pptx:import:chartRewrite'
      })
      const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
      chartRewrite = createPptxChartRewriteHandler({
        provider: activeModel.provider,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        baseUrl: activeModel.baseUrl,
        maxTokens: activeModel.maxTokens,
        modelRuntime: ctx.modelRuntime,
        modelTimeoutMs: modelTimeouts.document
      })
    } catch (chartRewriteError) {
      log.warn('[pptx:import] chart rewrite agent unavailable, import continues', {
        sessionId,
        message:
          chartRewriteError instanceof Error ? chartRewriteError.message : String(chartRewriteError)
      })
    }
    const imported = await importPptxToEditableHtml({
      filePath: sourcePath,
      projectDir,
      title,
      onProgress: sendProgress,
      chartRewrite
    })

    sendProgress(createPptxImportPostPersistProgress('session-records', imported.pageCount))
    const initialStyleId = resolveUsableStyleId(args.styleId ?? undefined)

    await db.createSession({
      id: sessionId,
      title: imported.title,
      topic: imported.title,
      styleId: initialStyleId,
      pageCount: imported.pageCount,
      slideSizeId: 'wide-16-9',
      slideWidth: 1600,
      slideHeight: 900,
      provider: 'import',
      model: 'pptx-import'
    })
    await db.updateSessionDesignContract(sessionId, createDefaultDesignContract())
    const projectId = await db.createProject({
      session_id: sessionId,
      title: imported.title,
      output_path: projectDir,
      root_path: projectDir
    })
    const runId = await db.createGenerationRun({
      sessionId,
      mode: 'import',
      totalPages: imported.pageCount,
      modelConfigId: args.modelConfigId,
      metadata: {
        source: 'pptx-import',
        originalFileName,
        modelConfigId: args.modelConfigId
      }
    })
    for (const page of imported.pages) {
      await db.upsertGenerationPage({
        runId,
        sessionId,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: page.contentOutline,
        htmlPath: page.htmlPath,
        status: 'completed'
      })
      await db.upsertSessionPage({
        id: crypto.randomUUID(),
        sessionId,
        legacyPageId: /^page-\d+$/i.test(page.pageId) ? page.pageId : null,
        fileSlug: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        htmlPath: page.htmlPath,
        status: 'completed',
        error: null
      })
    }
    await db.updateGenerationRunStatus(runId, 'completed')
    await db.updateSessionStatus(sessionId, 'completed')
    await db.updateSessionMetadata(sessionId, {
      source: 'pptx-import',
      importedAt: Date.now(),
      originalFileName,
      indexPath: imported.indexPath,
      warnings: imported.warnings.slice(0, 30)
    })
    await db.updateProjectStatus(projectId, 'draft')
    await recordHistoryOperationStrict(db, {
      sessionId,
      projectDir,
      type: 'import',
      scope: 'session',
      prompt: `导入 PPTX：${originalFileName}`,
      metadata: {
        runId,
        source: 'pptx-import',
        originalFileName,
        pageCount: imported.pageCount
      }
    })

    try {
      const activeModel = await resolveModelConfigForTask(ctx, {
        modelConfigId: args.modelConfigId,
        purpose: 'pptx:import'
      })
      const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
      sendProgress(createPptxImportPostPersistProgress('style-extraction', imported.pageCount))
      const styleResult = await extractStyleFromExistingHtml({
        projectDir,
        pageHtmlPaths: imported.pages.map((p) => path.basename(p.htmlPath)),
        sourceFilePath: sourcePath,
        provider: activeModel.provider,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        baseUrl: activeModel.baseUrl,
        maxTokens: activeModel.maxTokens,
        modelTimeoutMs: modelTimeouts.document
      })

      const styleId = `style-${nanoidLower()}`
      await createStyleSkill({
        id: styleId,
        label: styleResult.label,
        description: styleResult.description,
        category: styleResult.category,
        aliases: styleResult.aliases,
        prompt: styleResult.styleSkill,
        styleCase: styleResult.styleCase
      })
      await db.updateSessionStyleId(sessionId, styleId)
      log.info('[pptx:import] auto style extracted', { sessionId, styleId })

      sendProgress(createPptxImportPostPersistProgress('design-contract', imported.pageCount))
      const designContract = await buildDesignContractWithLLM({
        provider: activeModel.provider,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        baseUrl: activeModel.baseUrl,
        maxTokens: activeModel.maxTokens,
        modelRuntime: ctx.modelRuntime,
        styleId,
        styleSkillPrompt: styleResult.styleSkill,
        modelTimeoutMs: modelTimeouts.document,
        totalPages: imported.pageCount,
        slideSize: requireSlideSizePreset('wide-16-9'),
        topic: title
      })
      sendProgress(
        createPptxImportPostPersistProgress('design-contract-persist', imported.pageCount)
      )
      await db.updateSessionDesignContract(sessionId, designContract)
      log.info('[pptx:import] design contract generated', { sessionId })
    } catch (styleError) {
      log.warn('[pptx:import] auto style extraction failed, import continues', {
        sessionId,
        message: styleError instanceof Error ? styleError.message : String(styleError)
      })
      sendProgress(createPptxImportPostPersistProgress('style-skipped', imported.pageCount))
    }

    sendProgress(createPptxImportPostPersistProgress('completed', imported.pageCount))

    log.info('[pptx:import] completed', {
      sessionId,
      pageCount: imported.pageCount,
      warningCount: imported.warnings.length,
      projectDir
    })

    return {
      sessionId,
      pageCount: imported.pageCount,
      warnings: imported.warnings
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.deleteSession(sessionId).catch((cleanupError) => {
      log.warn('[pptx:import] cleanup db failed', {
        sessionId,
        message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      })
    })
    await fs.promises.rm(projectDir, { recursive: true, force: true }).catch((cleanupError) => {
      log.warn('[pptx:import] cleanup project dir failed', {
        sessionId,
        projectDir,
        message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      })
    })
    log.error('[pptx:import] failed', {
      sessionId,
      filePath: sourcePath,
      message
    })
    throw error
  }
}
