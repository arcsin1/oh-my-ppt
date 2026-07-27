import { ipcMain, BrowserWindow, shell } from 'electron'
import path from 'path'
import fs from 'fs'
import log from 'electron-log/main.js'
import type { IpcContext } from '../context'
import { resolveGlobalModelTimeouts, resolveModelConfigForTask } from '../config/model-config-utils'
import {
  createWorkspace,
  deleteWorkspace,
  readWorkspace,
  scanLatestWorkspace,
  scanWorkspaceList,
  resolveThinkingDir,
  replaceThinkingPageOutline,
  writeThinkingMd,
  writeMessagesList
} from '../../thinking/workspace'
import {
  extractPendingImageTextSources,
  prepareMultipleSources
} from '../../thinking/source-prepare'
import { invalidateRuntime, runThinkingChat } from '../../thinking/thinking-agent'
import { buildThinkingSourceBrief } from '../../thinking/source-brief'
import { buildThinkingSourcePlan } from '../../thinking/source-plan'
import { normalizeFontSelection } from '@shared/generation'
import { MAX_CORPORATE_PAGE_COUNT } from '@shared/brand'
import type {
  ThinkingChatMessage,
  ThinkingPageOutlineUpdate,
  ThinkingPrepareGenerationResult
} from '@shared/thinking'

async function updateSourcesManifest(
  thinkingDir: string,
  sources: Array<{ id: string; name: string; kind: string; fileName: string }>
): Promise<void> {
  const manifestPath = path.join(thinkingDir, 'sources.json')
  let existing: Array<{ id: string; name: string; kind: string; fileName: string }> = []
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      existing = parsed.filter((item) => item && typeof item === 'object')
    }
  } catch {
    existing = []
  }

  const byId = new Map(existing.map((item) => [item.id, item]))
  for (const source of sources) {
    byId.set(source.id, source)
  }
  await fs.promises.writeFile(
    manifestPath,
    JSON.stringify(Array.from(byId.values()), null, 2),
    'utf-8'
  )
}

async function removeSourceFromManifest(
  thinkingDir: string,
  sourceId: string
): Promise<{
  removed: boolean
  fileName?: string
}> {
  const manifestPath = path.join(thinkingDir, 'sources.json')
  let existing: Array<{ id: string; name: string; kind: string; fileName: string }> = []
  try {
    const raw = await fs.promises.readFile(manifestPath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      existing = parsed.filter((item) => item && typeof item === 'object')
    }
  } catch {
    existing = []
  }

  const target = existing.find((item) => item.id === sourceId)
  if (!target) return { removed: false }
  await fs.promises.writeFile(
    manifestPath,
    JSON.stringify(
      existing.filter((item) => item.id !== sourceId),
      null,
      2
    ),
    'utf-8'
  )
  return { removed: true, fileName: target.fileName }
}

function parseThinkingAssetPath(content: string): string {
  const match = content.match(/^- thinkingAssetPath:\s*(.+)$/m)
  return match?.[1]?.trim() || ''
}

async function removeCopiedSourceFiles(thinkingDir: string, fileName: string): Promise<void> {
  const sourcePath = path.join(thinkingDir, 'sources', fileName)
  let imageAssetPath = ''
  try {
    const content = await fs.promises.readFile(sourcePath, 'utf-8')
    imageAssetPath = parseThinkingAssetPath(content)
  } catch {
    imageAssetPath = ''
  }

  await fs.promises.rm(sourcePath, { force: true })
  if (imageAssetPath) {
    const assetsDir = path.join(thinkingDir, 'assets')
    const resolvedAssetPath = path.resolve(imageAssetPath)
    const relative = path.relative(assetsDir, resolvedAssetPath)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      await fs.promises.rm(resolvedAssetPath, { force: true })
    }
  }
}

function parseTopicFromThinkingMd(thinkingMd: string): string {
  // Try "## Topic: xxx" (inline) first, then "## Topic\nxxx" (next line)
  const inline = thinkingMd.match(/^##\s*Topic\s*:\s*(.+)/m)
  if (inline) return inline[1].trim()
  const newline = thinkingMd.match(/^##\s*Topic\s*\n\s*(.+)/m)
  return newline ? newline[1].trim() : ''
}

function parsePageCountFromThinkingMd(thinkingMd: string): number {
  const matches = thinkingMd.match(/^##\s*Page\s+\d+\s*:/gm)
  return matches ? matches.length : 0
}

function readMarkdownSectionBlock(markdown: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const inline = markdown.match(new RegExp(`^##\\s*${escaped}\\s*:\\s*(.+)`, 'm'))
  if (inline) return inline[1].trim()
  const block = markdown.match(
    new RegExp(`^##\\s*${escaped}\\s*\\n([\\s\\S]*?)(?=^##\\s+|(?![\\s\\S]))`, 'm')
  )
  return block?.[1]?.trim() || ''
}

function parseFontFromThinkingMd(thinkingMd: string): unknown {
  const match = thinkingMd.match(/^##\s*Font\s*\n\s*(.+)/m)
  if (!match) return { mode: 'auto' }
  const fontText = match[1].trim().toLowerCase()
  if (fontText === 'auto') return { mode: 'auto' }
  // For now, if the user specified fonts, try to parse as JSON
  try {
    return JSON.parse(match[1].trim())
  } catch {
    return { mode: 'auto' }
  }
}

export function registerThinkingHandlers(ctx: IpcContext): void {
  const { resolveStoragePath } = ctx

  ipcMain.handle('thinking:createWorkspace', async () => {
    const storagePath = await resolveStoragePath()
    return createWorkspace(storagePath)
  })

  ipcMain.handle('thinking:getWorkspace', async (_event, thinkingId: string) => {
    const storagePath = await resolveStoragePath()
    return readWorkspace(storagePath, thinkingId)
  })

  ipcMain.handle('thinking:getLatestWorkspace', async () => {
    const storagePath = await resolveStoragePath()
    const latest = await scanLatestWorkspace(storagePath)
    if (!latest) return null
    return readWorkspace(storagePath, latest.thinkingId)
  })

  ipcMain.handle('thinking:listWorkspaces', async (_event, payload?: { limit?: unknown }) => {
    const storagePath = await resolveStoragePath()
    const limit = Math.max(1, Math.min(100, Math.floor(Number(payload?.limit) || 50)))
    return scanWorkspaceList(storagePath, limit)
  })

  ipcMain.handle('thinking:deleteWorkspace', async (_event, thinkingId: string) => {
    const storagePath = await resolveStoragePath()
    await deleteWorkspace(storagePath, thinkingId)
    invalidateRuntime(thinkingId)
    return { success: true }
  })

  ipcMain.handle('thinking:revealWorkspace', async (_event, thinkingId: string) => {
    const storagePath = await resolveStoragePath()
    await readWorkspace(storagePath, thinkingId)
    const dir = resolveThinkingDir(storagePath, thinkingId)
    const result = await shell.openPath(dir)
    if (result) throw new Error(result)
    return { success: true }
  })

  ipcMain.handle(
    'thinking:updatePageOutline',
    async (_event, payload: { thinkingId: string; page: ThinkingPageOutlineUpdate }) => {
      const thinkingId = String(payload?.thinkingId || '').trim()
      if (!thinkingId || !payload?.page) {
        throw new Error('Invalid page outline update')
      }

      const storagePath = await resolveStoragePath()
      const workspace = await readWorkspace(storagePath, thinkingId)
      const dir = resolveThinkingDir(storagePath, thinkingId)
      const thinkingMd = replaceThinkingPageOutline(workspace.thinkingMd, payload.page)
      await writeThinkingMd(dir, thinkingMd)
      invalidateRuntime(thinkingId)

      log.info('[thinking] page outline updated', {
        thinkingId,
        pageNumber: payload.page.pageNumber
      })

      return { success: true, thinkingMd }
    }
  )

  ipcMain.handle(
    'thinking:uploadSources',
    async (
      _event,
      payload: { thinkingId: string; files: Array<{ path: string; name?: string }> }
    ) => {
      const { thinkingId, files } = payload
      const storagePath = await resolveStoragePath()
      await readWorkspace(storagePath, thinkingId)
      const dir = resolveThinkingDir(storagePath, thinkingId)

      const filePaths = files
        .map((f) => f.path)
        .filter((p) => typeof p === 'string' && p.trim().length > 0)

      if (filePaths.length === 0) {
        throw new Error('No valid file paths provided')
      }
      if (filePaths.length > 10) {
        throw new Error('Upload at most 10 files at a time')
      }

      const prepared = await prepareMultipleSources(filePaths, dir)

      const sources = prepared.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind
      }))
      await updateSourcesManifest(
        dir,
        prepared.map((p) => ({
          id: p.id,
          name: p.name,
          kind: p.kind,
          fileName: path.basename(p.sourcePath)
        }))
      )

      log.info('[thinking] sources uploaded', {
        thinkingId,
        count: sources.length,
        kinds: sources.map((s) => s.kind)
      })

      return { sources }
    }
  )

  ipcMain.handle(
    'thinking:removeSource',
    async (_event, payload: { thinkingId: string; sourceId: string }) => {
      const thinkingId = String(payload?.thinkingId || '').trim()
      const sourceId = String(payload?.sourceId || '').trim()
      if (!thinkingId || !sourceId) throw new Error('Invalid source removal request')

      const storagePath = await resolveStoragePath()
      await readWorkspace(storagePath, thinkingId)
      const dir = resolveThinkingDir(storagePath, thinkingId)
      const removed = await removeSourceFromManifest(dir, sourceId)
      if (removed.fileName) {
        await removeCopiedSourceFiles(dir, removed.fileName)
      }

      log.info('[thinking] source removed', {
        thinkingId,
        sourceId,
        removed: removed.removed
      })

      return { success: true, removed: removed.removed }
    }
  )

  ipcMain.handle(
    'thinking:chat',
    async (
      _event,
      payload: {
        thinkingId: string
        modelConfigId?: string
        userMessage: string
        recentMessages?: ThinkingChatMessage[]
        attachments?: ThinkingChatMessage['attachments']
      }
    ) => {
      const { thinkingId, userMessage, recentMessages, attachments } = payload
      const storagePath = await resolveStoragePath()
      const dir = resolveThinkingDir(storagePath, thinkingId)

      const workspace = await readWorkspace(storagePath, thinkingId)
      const activeModel = await resolveModelConfigForTask(ctx, {
        modelConfigId: payload.modelConfigId,
        purpose: 'thinking:chat'
      })
      const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
      await extractPendingImageTextSources(dir, {
        provider: activeModel.provider,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        baseUrl: activeModel.baseUrl,
        maxTokens: activeModel.maxTokens,
        modelTimeoutMs: modelTimeouts.document
      })

      const emitThinkingEvent = (event: {
        type: string
        toolName: string
        summary: string
      }): void => {
        const windows = BrowserWindow.getAllWindows()
        for (const win of windows) {
          if (win.isDestroyed() || win.webContents.isDestroyed()) continue
          try {
            win.webContents.send('thinking:stream:thinking', { thinkingId, ...event })
          } catch {
            /* window may have closed */
          }
        }
      }

      const documentAttachments = Array.isArray(attachments)
        ? attachments.filter((attachment) => attachment.kind !== 'image')
        : []
      const sourceBrief =
        documentAttachments.length > 0
          ? await buildThinkingSourceBrief({
              thinkingDir: dir,
              attachments: documentAttachments
            })
          : ''
      const thinkingUserMessage = [userMessage, sourceBrief]
        .filter((part) => part.trim().length > 0)
        .join('\n\n')

      const result = await runThinkingChat({
        thinkingId,
        thinkingDir: dir,
        stage: workspace.stage,
        thinkingMd: workspace.thinkingMd,
        contextMd: workspace.contextMd,
        sourcesDir: `${dir}/sources`,
        userMessage: thinkingUserMessage,
        recentMessages: Array.isArray(recentMessages)
          ? recentMessages.slice(-8)
          : workspace.messages.slice(-8),
        provider: activeModel.provider,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        baseUrl: activeModel.baseUrl,
        maxTokens: activeModel.maxTokens,
        modelTimeoutMs: modelTimeouts.agent,
        onThinkingEvent: emitThinkingEvent
      })

      await writeMessagesList(dir, [
        ...workspace.messages,
        {
          role: 'user',
          content: userMessage,
          timestamp: Date.now(),
          ...(Array.isArray(attachments) && attachments.length > 0 ? { attachments } : {})
        },
        {
          role: 'assistant',
          content: result.reply,
          timestamp: Date.now()
        }
      ])

      // Send final result with the full reply for typing animation
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        if (win.isDestroyed() || win.webContents.isDestroyed()) continue
        try {
          win.webContents.send('thinking:stream:end', {
            thinkingId,
            reply: result.reply,
            thinkingMd: result.thinkingMd,
            contextMd: result.contextMd,
            stage: result.stage
          })
        } catch {
          /* window may have closed */
        }
      }

      log.info('[thinking] chat result', {
        thinkingId,
        stage: result.stage,
        replyLength: result.reply.length
      })

      return result
    }
  )

  ipcMain.handle('thinking:prepareGeneration', async (_event, payload: { thinkingId: string }) => {
    const { thinkingId } = payload
    const storagePath = await resolveStoragePath()
    const dir = resolveThinkingDir(storagePath, thinkingId)

    const workspace = await readWorkspace(storagePath, thinkingId)

    const topic = parseTopicFromThinkingMd(workspace.thinkingMd)
    const pageCount = parsePageCountFromThinkingMd(workspace.thinkingMd)
    const styleText = readMarkdownSectionBlock(workspace.thinkingMd, 'Style')
    const rawFont = parseFontFromThinkingMd(workspace.thinkingMd)
    const fontSelection = normalizeFontSelection(rawFont)

    if (!topic) {
      throw new Error('thinking.md is missing ## Topic. Please complete the thinking brief first.')
    }
    if (pageCount < 1) {
      throw new Error(
        'thinking.md has no pages. Please create a page-by-page thinking brief first.'
      )
    }

    const thinkingDocumentPath = path.join(dir, 'thinking.md')
    const sourcePlan = buildThinkingSourcePlan(workspace.thinkingMd, thinkingDocumentPath)

    const result: ThinkingPrepareGenerationResult = {
      thinkingDocumentPath,
      topic,
      pageCount: Math.max(1, Math.min(MAX_CORPORATE_PAGE_COUNT, pageCount)),
      styleId: '',
      styleText,
      fontSelection,
      ...(sourcePlan ? { sourcePlan } : {})
    }

    log.info('[thinking] prepareGeneration', {
      thinkingId,
      topic: result.topic,
      pageCount: result.pageCount,
      styleId: result.styleId,
      fontMode: result.fontSelection.mode,
      sourcePlanPages: result.sourcePlan?.pageSkeleton.length ?? 0
    })

    return result
  })

  log.info('[thinking] handlers registered')
}
