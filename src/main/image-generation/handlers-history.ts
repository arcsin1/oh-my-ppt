import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import type {
  GeneratedImageAsset,
  ImageGenerationHistoryRecord,
  ImageModelProvider
} from '@shared/image-generation'
import type { ImageGenerationHistoryRow } from '../db/database'
import type { IpcContext } from '../ipc/context'
import { allowLocalAssetRoot } from '../io/local-asset-roots'

const VALID_IMAGE_PROVIDERS = [
  'jimeng',
  'jimeng4',
  'agnes',
  'siliconflow',
  'openaiCompatible',
  'openaiImages',
  'gemini',
  'seedream'
] as const

const resolveProvider = (provider: unknown): ImageModelProvider => {
  if (VALID_IMAGE_PROVIDERS.includes(provider as ImageModelProvider)) {
    return provider as ImageModelProvider
  }
  throw new Error('Unsupported image provider')
}

const mimeFromFileName = (fileName: string): string => {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return 'image/png'
}

const readImagePaths = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed
          .map((item) => String(item || '').trim())
          .filter((item) => item.startsWith('./images/'))
          .slice(0, 12)
      : []
  } catch {
    return []
  }
}

const buildHistoryRecord = async (
  ctx: IpcContext,
  row: ImageGenerationHistoryRow
): Promise<ImageGenerationHistoryRecord> => {
  const projectDir = await ctx.resolveSessionProjectDir(row.sessionId)
  const imagesDir = path.join(projectDir, 'images')
  allowLocalAssetRoot(imagesDir)
  const imagePaths = readImagePaths(row.imagePaths)
  const provider = resolveProvider(row.provider)
  const assets: GeneratedImageAsset[] = []
  for (const relativePath of imagePaths) {
    const fileName = path.basename(relativePath)
    const absolutePath = path.join(projectDir, relativePath.replace(/^\.\//, ''))
    let size = 0
    try {
      size = (await fs.promises.stat(absolutePath)).size
    } catch {
      size = 0
    }
    assets.push({
      id: `${row.id}-${assets.length}`,
      fileName,
      originalName: fileName,
      relativePath,
      absolutePath,
      mimeType: mimeFromFileName(fileName),
      size,
      prompt: row.prompt,
      modelConfigId: row.modelConfigId,
      provider,
      model: row.model,
      pageId: row.pageId,
      createdAt: row.createdAt
    })
  }
  return {
    id: row.id,
    sessionId: row.sessionId,
    pageId: row.pageId,
    prompt: row.prompt,
    imagePaths,
    assets,
    modelConfigId: row.modelConfigId,
    provider,
    model: row.model,
    createdAt: row.createdAt
  }
}

export function registerImageGenerationHistoryHandlers(ctx: IpcContext): void {
  ipcMain.handle('images:listHistory', async (_event, payload) => {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const pageId = typeof record.pageId === 'string' ? record.pageId.trim() : ''
    if (!sessionId || !pageId) return []
    const rows = await ctx.db.listImageGenerationHistories(sessionId, pageId)
    return Promise.all(rows.map((row) => buildHistoryRecord(ctx, row)))
  })
}
