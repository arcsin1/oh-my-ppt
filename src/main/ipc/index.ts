import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import type { PPTDatabase } from '../db/database'
import type { AgentManager } from '../agent-runtime/agent'
import { createIpcContext } from './context'
import { registerSessionHandlers } from '../session/handlers'
import { registerSessionImportHandlers } from '../session/import-handlers'
import { registerSessionSaveAsNewHandler } from '../session/save-as-new'
import { registerAssetHandlers, registerLocalAssetProtocol } from '../io/assets-handlers'
import { registerThumbnailHandlers } from '../io/thumbnails/handlers'
import { registerGenerationHandlers } from '../generation/handlers'
import { createGenerationContext } from '../generation/context'
import { registerExportHandlers } from '../io/export-handlers'
import { registerStyleHandlers } from '../styles/handlers'
import { registerStylePreviewHandlers } from '../styles/preview/handlers'
import { registerFontHandlers } from '../presentation/fonts/handlers'
import { registerSettingsHandlers } from '../config/settings-handlers'
import { registerImageModelHandlers } from '../config/image-model-handlers'
import { registerPreviewHandlers } from '../session/preview-handlers'
import { registerPageManagementHandlers } from '../session/page-management-handlers'
import { registerPageMergeHandlers } from '../session/page-merge-handlers'
import { registerFileHandlers } from '../io/file-handlers'
import { registerChartDataImportHandlers, registerEditorHandlers } from '../element-editor'
import { registerDocumentParseHandlers } from '../io/document-parse-handlers'
import { registerPptxImportHandlers } from '../io/pptx-import/handlers'
import { registerHistoryHandlers } from '../history/handlers'
import { registerPresentationHandlers } from '../session/presentation-handlers'
import { registerSpeechHandlers } from '../speech/handlers'
import { registerThinkingHandlers } from './thinking/thinking-handlers'
import { registerTemplateHandlers } from '../templates/template-handlers'
import { registerImageGenerationHandlers } from '../image-generation/handlers'
import { registerImageGenerationHistoryHandlers } from '../image-generation/handlers-history'
import { registerImageFulfillmentHandlers } from '../image-generation/fulfillment-handlers'
import { registerHtmlEditorHandlers } from '../html-editor/html-editor-handlers'
import { registerHtmlEditorAiHandlers } from '../html-editor/html-editor-ai-handlers'
import { JobCoordinator, TypedEventBus } from '../agent-runtime'
import { RuntimeEventBridge } from './runtime/event-bridge'
import { translateLegacyRuntimeEvent } from './runtime/event-contract'
import { DbModelUsageRecorder } from './runtime/model-usage-recorder'
import { registerDeckEditJobHandlers } from '../edit-jobs/deck-edit-job-service'
import { registerPageEditJobHandlers } from '../edit-jobs/page-edit-job-service'
import { registerStyleSwitchJobHandlers } from '../edit-jobs/style-switch-job-service'
import { registerMasterHandlers } from '../session/master-handlers'

export { registerLocalAssetProtocol }

export function setupIPC(
  mainWindow: BrowserWindow,
  db: PPTDatabase,
  agentManager: AgentManager
): void {
  const runtimeEvents = new TypedEventBus({
    onListenerError: (error, event) => {
      console.warn('[runtime:event] listener failed', {
        type: event.type,
        jobId: event.jobId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
  const runtimeEventBridge = new RuntimeEventBridge(runtimeEvents)
  runtimeEventBridge.registerWindowBroadcast({
    subscriberId: 'legacy-generate-chunk-broadcast',
    windows: () => BrowserWindow.getAllWindows(),
    translate: translateLegacyRuntimeEvent,
    onSendError: ({ windowId, error }) => {
      console.warn('[generate:chunk] send failed', {
        windowId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })
  const context = createIpcContext(mainWindow, db, agentManager, runtimeEvents, {
    recorder: new DbModelUsageRecorder(db)
  })
  const jobCoordinator = new JobCoordinator()
  const generationContext = createGenerationContext({
    ...context,
    imageCoordinator: jobCoordinator
  })
  void (async () => {
    const expiredJobs = await db.recoverExpiredImageFulfillmentJobs({ includePending: true })
    await Promise.all(
      expiredJobs.map(async (job) => {
        const manifest = job.finalization_manifest_path || ''
        if (!manifest.startsWith('images/.staging/')) return
        const projectDir = await context.resolveSessionProjectDir(job.session_id)
        const manifestPath = path.resolve(projectDir, manifest)
        const stagingRoot = path.resolve(projectDir, 'images', '.staging')
        if (!manifestPath.startsWith(`${stagingRoot}${path.sep}`)) return
        const stagingDir = path.dirname(manifestPath)
        try {
          const parsed = JSON.parse(await fs.promises.readFile(manifestPath, 'utf-8')) as {
            pageHtmlPath?: unknown
            fallbackHtmlPath?: unknown
            assets?: Array<{ finalPath?: unknown }>
          }
          const pageHtmlPath =
            typeof parsed.pageHtmlPath === 'string' ? path.resolve(parsed.pageHtmlPath) : ''
          const fallbackHtmlPath =
            typeof parsed.fallbackHtmlPath === 'string' ? path.resolve(parsed.fallbackHtmlPath) : ''
          const isProjectPath = (filePath: string): boolean =>
            Boolean(filePath) && filePath.startsWith(`${path.resolve(projectDir)}${path.sep}`)
          const isStagingPath = (filePath: string): boolean =>
            Boolean(filePath) && filePath.startsWith(`${stagingRoot}${path.sep}`)
          if (
            isProjectPath(pageHtmlPath) &&
            isStagingPath(fallbackHtmlPath) &&
            fs.existsSync(fallbackHtmlPath)
          ) {
            const fallbackHtml = await fs.promises.readFile(fallbackHtmlPath, 'utf-8')
            const imageRoot = path.resolve(projectDir, 'images')
            const finalPaths = (parsed.assets || [])
              .map((asset) =>
                typeof asset.finalPath === 'string' ? path.resolve(asset.finalPath) : ''
              )
              .filter((assetPath) => assetPath.startsWith(`${imageRoot}${path.sep}`))
            await Promise.all(
              finalPaths.map((assetPath) => fs.promises.rm(assetPath, { force: true }))
            )
            const tempPagePath = `${pageHtmlPath}.${job.id}.recovery`
            await fs.promises.writeFile(tempPagePath, fallbackHtml, 'utf-8')
            await fs.promises.rename(tempPagePath, pageHtmlPath)
            const intents = await db.listImageFulfillmentIntents(job.id)
            await Promise.all(
              intents.map((intent) =>
                db.transitionImageFulfillmentIntent({
                  intentId: intent.id,
                  from: ['failed'],
                  status: 'fallback',
                  error: 'Image fulfillment recovered to the page fallback.'
                })
              )
            )
            await db.transitionImageFulfillmentJob({
              jobId: job.id,
              from: ['failed'],
              status: 'degraded',
              error: 'Image fulfillment recovered to the page fallback.'
            })
          }
        } finally {
          await fs.promises.rm(stagingDir, { recursive: true, force: true })
        }
      })
    )
  })().catch((error) => {
    console.warn('[image:fulfillment] failed to recover expired jobs', {
      message: error instanceof Error ? error.message : String(error)
    })
  })

  registerSessionHandlers(context)
  registerSessionSaveAsNewHandler(context)
  registerSessionImportHandlers(context)
  registerMasterHandlers(context)
  registerPageManagementHandlers(context)
  registerPageMergeHandlers(context)
  registerAssetHandlers(context)
  registerThumbnailHandlers(context)
  const pageEditJobs = registerPageEditJobHandlers(context, jobCoordinator)
  const deckEditJobs = registerDeckEditJobHandlers(context, jobCoordinator)
  const styleSwitchJobs = registerStyleSwitchJobHandlers(context, jobCoordinator)
  registerGenerationHandlers(
    generationContext,
    jobCoordinator,
    styleSwitchJobs,
    pageEditJobs,
    deckEditJobs
  )
  registerExportHandlers(context)
  registerStyleHandlers(context)
  registerStylePreviewHandlers(context)
  registerFontHandlers()
  registerSettingsHandlers(context)
  registerImageModelHandlers(context)
  registerPreviewHandlers(context)
  registerFileHandlers(context)
  registerEditorHandlers(context)
  registerChartDataImportHandlers(context)
  registerDocumentParseHandlers(context)
  registerPptxImportHandlers(context)
  registerHistoryHandlers(context)
  registerPresentationHandlers(context)
  registerSpeechHandlers(context)
  registerThinkingHandlers(context)
  registerTemplateHandlers(context)
  registerImageGenerationHandlers(context, jobCoordinator, runtimeEvents)
  registerImageFulfillmentHandlers(context, jobCoordinator)
  registerImageGenerationHistoryHandlers(context)
  registerHtmlEditorHandlers(context)
  registerHtmlEditorAiHandlers(context)
}
