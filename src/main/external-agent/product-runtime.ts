import type { GenerateStartPayload } from '@shared/generation'
import type { GenerateJobManager } from '../generation/job-manager'
import type { PageEditJobService } from '../edit-jobs/page-edit-job-service'
import type { DeckEditJobService } from '../edit-jobs/deck-edit-job-service'
import { resolveDeckContext, executeDeckGeneration } from '../generation/deck-flow'
import { createEmitAssistantMessage } from '../generation/generation-utils'
import { finalizeGenerationFailure } from '../generation/finalization'
import { createProductSession } from '../session/create-session'
import { deleteProductSession } from '../session/delete-session'
import { deleteSessionPages } from '../session/page-management-service'
import { writeSessionPptx } from '../io/pptx-export'
import { importPptxToSession } from '../io/pptx-import/import-session'
import { resolveAssetUploadTarget } from '../ipc/runtime/local-files'
import type { IpcContext } from '../ipc/context'
import { resolveUsableStyleId } from '../styles/catalog'

export type ExternalAgentProductStartResult = {
  success: boolean
  runId?: string
  queued?: boolean
  alreadyRunning?: boolean
  sessionId?: string
}

export type ExternalAgentProductExportResult = {
  success: boolean
  outputPath: string
}

export type ExternalAgentImportedAsset = {
  kind: 'image' | 'video' | 'document'
  relativePath: string
  originalName: string
}

export type ExternalAgentProductImportAssetsResult = {
  success: boolean
  assets: ExternalAgentImportedAsset[]
}

export interface ExternalAgentProductRuntime {
  startGeneration(payload: GenerateStartPayload): Promise<ExternalAgentProductStartResult>
  startPageEdit(payload: GenerateStartPayload): Promise<ExternalAgentProductStartResult>
  startDeckEdit(payload: GenerateStartPayload): Promise<ExternalAgentProductStartResult>
  createSession(payload: {
    title?: string
    topic?: string
    styleId?: string
    slideSizeId?: string
    pageCount?: number
  }): Promise<ExternalAgentProductStartResult>
  exportPptx(payload: {
    sessionId: string
    outputPath: string
    overwrite?: boolean
  }): Promise<ExternalAgentProductExportResult>
  importPptx(payload: {
    sourcePath: string
    title?: string
    styleId?: string
  }): Promise<ExternalAgentProductStartResult>
  importAssets(payload: {
    sessionId: string
    sources: Array<{ sourcePath: string; kind?: 'image' | 'video' | 'document'; label?: string }>
  }): Promise<ExternalAgentProductImportAssetsResult>
  deletePage(payload: { sessionId: string; pageId: string }): Promise<{ success: boolean }>
  deleteSession(payload: { sessionId: string }): Promise<{ success: boolean }>
  cancelSession(sessionId: string): Promise<boolean>
  applySessionStyle(sessionId: string, styleId: string): Promise<void>
}

// SAFETY: resolveDeckContext / page-edit start ignore the IPC event object.
const unusedIpcEvent = {} as Electron.IpcMainInvokeEvent

export function createIpcProductRuntime(args: {
  jobManager: GenerateJobManager
  pageEditJobs: PageEditJobService
  deckEditJobs: DeckEditJobService
  ipcContext: Pick<
    IpcContext,
    | 'db'
    | 'agentManager'
    | 'resolveStoragePath'
    | 'ensureSessionAssets'
    | 'modelRuntime'
    | 'decryptApiKey'
    | 'resolveSessionPageFiles'
    | 'waitForPrintReadySignal'
    | 'EXPORT_PAGE_READY_TIMEOUT_MS'
    | 'EXPORT_CAPTURE_SETTLE_MS'
    | 'uploadSessionFiles'
    | 'resolveSessionProjectDir'
  >
}): ExternalAgentProductRuntime {
  return {
    startGeneration: (payload) => startGenerationViaJobManager(args.jobManager, payload),
    startPageEdit: (payload) => args.pageEditJobs.start(unusedIpcEvent, payload),
    startDeckEdit: (payload) => args.deckEditJobs.start(unusedIpcEvent, payload),
    createSession: async (payload) => {
      const created = await createProductSession(args.ipcContext, payload)
      return { success: true, sessionId: created.sessionId, runId: created.sessionId }
    },
    exportPptx: async (payload) => {
      const exported = await writeSessionPptx({
        sessionId: payload.sessionId,
        outputPath: payload.outputPath,
        resolveSessionPageFiles: args.ipcContext.resolveSessionPageFiles,
        waitForPrintReadySignal: args.ipcContext.waitForPrintReadySignal,
        timeoutMs: args.ipcContext.EXPORT_PAGE_READY_TIMEOUT_MS,
        settleMs: args.ipcContext.EXPORT_CAPTURE_SETTLE_MS,
        db: args.ipcContext.db
      })
      return { success: true, outputPath: exported.outputPath }
    },
    importPptx: async (payload) => {
      const imported = await importPptxToSession(args.ipcContext, {
        sourcePath: payload.sourcePath,
        title: payload.title,
        styleId: payload.styleId
      })
      return { success: true, sessionId: imported.sessionId, runId: imported.sessionId }
    },
    importAssets: async (payload) => {
      const assets: ExternalAgentImportedAsset[] = []
      for (const source of payload.sources) {
        const target = resolveAssetUploadTarget(source.sourcePath, source.kind)
        const [uploaded] = await args.ipcContext.uploadSessionFiles(
          payload.sessionId,
          [{ path: source.sourcePath, name: source.label }],
          target
        )
        if (!uploaded) throw new Error('素材导入结果不完整')
        assets.push({
          kind: target === 'images' ? 'image' : target === 'videos' ? 'video' : 'document',
          relativePath: uploaded.relativePath,
          originalName: uploaded.originalName
        })
      }
      return { success: true, assets }
    },
    deletePage: async (payload) => {
      await deleteSessionPages(args.ipcContext, {
        sessionId: payload.sessionId,
        pageIds: [payload.pageId]
      })
      return { success: true }
    },
    deleteSession: async (payload) => {
      await args.pageEditJobs.cancel(payload.sessionId)
      await args.deckEditJobs.cancel(payload.sessionId)
      await args.jobManager.cancel(payload.sessionId)
      await deleteProductSession(args.ipcContext, payload.sessionId)
      return { success: true }
    },
    cancelSession: async (sessionId) => {
      if (await args.pageEditJobs.cancel(sessionId)) return true
      if (await args.deckEditJobs.cancel(sessionId)) return true
      return args.jobManager.cancel(sessionId)
    },
    applySessionStyle: async (sessionId, styleId) => {
      const resolved = resolveUsableStyleId(styleId)
      await args.ipcContext.db.updateSessionStyleId(sessionId, resolved)
    }
  }
}

export async function startGenerationViaJobManager(
  jobManager: GenerateJobManager,
  payload: GenerateStartPayload
): Promise<ExternalAgentProductStartResult> {
  const ctx = jobManager.generationContext
  const reservation = await jobManager.reserve(
    'external-agent:start_generation',
    payload.sessionId,
    crypto.randomUUID()
  )
  if (reservation.alreadyRunning) {
    return { success: true, runId: reservation.runId, alreadyRunning: true }
  }
  const reserved = reservation.reservation
  let handedToBackground = false
  let context: Awaited<ReturnType<typeof resolveDeckContext>> | null = null
  try {
    context = await resolveDeckContext(ctx, unusedIpcEvent, payload, {
      runId: reserved.jobId,
      abortSignal: reserved.signal
    })
    jobManager.assertNotCancelled(reserved)
    const emitAssistant = createEmitAssistantMessage(ctx.db, ctx.runtimeEmitters.emitGenerateChunk)
    const result = await jobManager.enqueue({
      reservation: reserved,
      kind: 'standard',
      context,
      totalPages: context.totalPages,
      execute: (deckContext) => executeDeckGeneration(ctx, emitAssistant, deckContext)
    })
    handedToBackground = true
    return { success: true, runId: result.runId, queued: result.queued }
  } catch (error) {
    if (context && !handedToBackground) {
      await finalizeGenerationFailure(ctx, context, error)
    }
    throw error
  } finally {
    if (!handedToBackground) jobManager.release(reserved)
  }
}
