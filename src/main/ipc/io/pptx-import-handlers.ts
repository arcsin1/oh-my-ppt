import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { IpcContext } from '../context'
import { importPptxToEditableHtml, type PptxImportProgressPayload } from '../../utils/pptx-importer'
import { extractStyleFromExistingHtml } from '../../utils/style-pptx-import'
import { createPptxChartRewriteHandler } from '../../utils/pptx-chart-rewrite-agent'
import { createStyleSkill, resolveUsableStyleId } from '../../utils/style-skills'
import { resolveGlobalModelTimeouts, resolveModelConfigForTask } from '../config/model-config-utils'
import { buildDesignContractWithLLM } from '../engine/generate'
import { customAlphabet } from 'nanoid'
import { recordHistoryOperationStrict } from '../../history/git-history-service'
import { createDefaultDesignContract } from '../../utils/design-contract'

const nanoidLower = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)

type PptxImportPayload = {
  filePath?: unknown
  title?: unknown
  styleId?: unknown
  modelConfigId?: unknown
}

const MAX_PPTX_SIZE_MB = 500
const MAX_PPTX_SIZE = MAX_PPTX_SIZE_MB * 1024 * 1024

const parsePayload = (
  payload: unknown
): { filePath: string; title: string; styleId: string | null; modelConfigId?: string } => {
  const record = payload && typeof payload === 'object' ? (payload as PptxImportPayload) : {}
  const filePath = typeof record.filePath === 'string' ? record.filePath.trim() : ''
  if (!filePath) throw new Error('PPTX 文件路径不能为空')
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const styleId = typeof record.styleId === 'string' && record.styleId.trim() ? record.styleId.trim() : null
  const modelConfigId =
    typeof record.modelConfigId === 'string' ? record.modelConfigId.trim() : undefined
  return { filePath, title, styleId, modelConfigId }
}

export function registerPptxImportHandlers(ctx: IpcContext): void {
  const { db, resolveStoragePath, ensureSessionAssets, resolveExistingFileRealPath } = ctx

  ipcMain.handle('pptx:import', async (event, payload: unknown) => {
    const parsedPayload = parsePayload(payload)
    const sourcePath = await resolveExistingFileRealPath(parsedPayload.filePath)
    const extension = path.extname(sourcePath).toLowerCase()
    if (extension !== '.pptx') {
      throw new Error('仅支持导入 .pptx 文件')
    }
    const stat = await fs.promises.stat(sourcePath)
    if (stat.size > MAX_PPTX_SIZE) {
      throw new Error(`PPTX 文件不能超过 ${MAX_PPTX_SIZE_MB}MB`)
    }

    const sessionId = crypto.randomUUID()
    const storagePath = await resolveStoragePath()
    const projectDir = path.join(storagePath, sessionId)
    const originalFileName = path.basename(sourcePath)
    const title =
      parsedPayload.title || path.basename(originalFileName, path.extname(originalFileName)) || '导入的 PPTX'

    const sendProgress = (progress: PptxImportProgressPayload): void => {
      event.sender.send('pptx:import:progress', {
        ...progress,
        sessionId
      })
    }

    log.info('[pptx:import] invoke', {
      sessionId,
      filePath: sourcePath,
      size: stat.size
    })

    try {
      await fs.promises.mkdir(projectDir, { recursive: true })
      await ensureSessionAssets(projectDir)
      let chartRewrite: ReturnType<typeof createPptxChartRewriteHandler> | undefined
      try {
        const activeModel = await resolveModelConfigForTask(ctx, {
          modelConfigId: parsedPayload.modelConfigId,
          purpose: 'pptx:import:chartRewrite'
        })
        const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
        chartRewrite = createPptxChartRewriteHandler({
          provider: activeModel.provider,
          apiKey: activeModel.apiKey,
          model: activeModel.model,
          baseUrl: activeModel.baseUrl,
          maxTokens: activeModel.maxTokens,
          modelTimeoutMs: modelTimeouts.document
        })
      } catch (chartRewriteError) {
        log.warn('[pptx:import] chart rewrite agent unavailable, import continues', {
          sessionId,
          message:
            chartRewriteError instanceof Error
              ? chartRewriteError.message
              : String(chartRewriteError)
        })
      }
      const imported = await importPptxToEditableHtml({
        filePath: sourcePath,
        projectDir,
        title,
        onProgress: sendProgress,
        chartRewrite
      })

      sendProgress({
        stage: 'database',
        progress: 94,
        label: '正在写入会话记录',
        totalPages: imported.pageCount
      })
      const initialStyleId = resolveUsableStyleId(parsedPayload.styleId)

      await db.createSession({
        id: sessionId,
        title: imported.title,
        topic: imported.title,
        styleId: initialStyleId,
        pageCount: imported.pageCount,
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
        modelConfigId: parsedPayload.modelConfigId,
        metadata: {
          source: 'pptx-import',
          originalFileName,
          modelConfigId: parsedPayload.modelConfigId
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

      sendProgress({
        stage: 'completed',
        progress: 100,
        label: 'PPTX 导入完成',
        totalPages: imported.pageCount
      })

      log.info('[pptx:import] completed', {
        sessionId,
        pageCount: imported.pageCount,
        warningCount: imported.warnings.length,
        projectDir
      })

      // --- Auto style extraction (non-blocking) ---
      try {
        const activeModel = await resolveModelConfigForTask(ctx, {
          modelConfigId: parsedPayload.modelConfigId,
          purpose: 'pptx:import'
        })
        const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
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

        // Generate design contract from the extracted styleSkill
        const designContract = await buildDesignContractWithLLM({
          provider: activeModel.provider,
          apiKey: activeModel.apiKey,
          model: activeModel.model,
          baseUrl: activeModel.baseUrl,
          maxTokens: activeModel.maxTokens,
          styleId,
          styleSkillPrompt: styleResult.styleSkill,
          modelTimeoutMs: modelTimeouts.document,
          totalPages: imported.pageCount,
          topic: title
        })
        await db.updateSessionDesignContract(sessionId, designContract)
        log.info('[pptx:import] design contract generated', { sessionId })
      } catch (styleError) {
        log.warn('[pptx:import] auto style extraction failed, import continues', {
          sessionId,
          message: styleError instanceof Error ? styleError.message : String(styleError)
        })
      }

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
  })
}
