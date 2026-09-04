import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import log from 'electron-log/main.js'
import { customAlphabet } from 'nanoid'
import {
  listStyleCatalog,
  getStyleDetail,
  createStyleSkill,
  updateStyleSkill,
  hasStyleSkill,
  deleteStyleSkill,
  exportStylePackageZip,
  importStylePackageDirectory,
  importStylePackageZip,
  getStylePackageDirectory
} from './catalog'
import type { IpcContext } from '../ipc/context'
import { resolveGlobalModelTimeouts, resolveModelConfigForTask } from '../config/model-config-utils'
import { parseStyleFile } from './import/file'
import { parseStyleImage } from './import/image'
import { parseStylePptx } from './import/pptx'
import { isSupportedImageMimeType, normalizeImageMimeType } from '@shared/image-mime'
import { getInstalledStylesPath } from './style-runtime'
import { readStylePackage, styleRowToPackageJson } from './style-package'
import { recommendStyles } from './recommendation'
import {
  enqueueHtmlThumbnail,
  getFreshHtmlThumbnailPath
} from '../io/thumbnails/html-thumbnail-service'

const nanoidLower = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 12)
const MAX_STYLE_IMAGE_SIZE_BYTES = 5 * 1024 * 1024

function resolvePreviewPath(row: {
  id: string
  style: string
  source: string
  packageDir?: string | null
}): string | null {
  const installedRoot = getInstalledStylesPath()
  if (!installedRoot) return null
  const dir = row.packageDir
    ? path.join(installedRoot, row.packageDir)
    : row.source === 'builtin'
      ? path.join(installedRoot, 'system', row.style)
      : path.join(installedRoot, 'user', row.id)
  const htmlPath = path.join(dir, 'preview.html')
  return fs.existsSync(htmlPath) ? htmlPath : null
}

type StyleBasePayload = {
  label: string
  description: string
  category: string
  aliases: string[]
  prompt: string
  styleCase: string
  imageGenerationPrompt?: string
}

type StylePayload = StyleBasePayload & {
  id: string
}

function parseAliases(value: string): string[] {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

export function registerStyleHandlers(ctx: IpcContext): void {
  const { db } = ctx
  const completeStylePackageImport = async (result: {
    id: string
    source: 'custom' | 'override'
  }): Promise<{ success: true; cancelled: false; id: string; source: 'custom' | 'override' }> => {
    const importedStyle = await db.getStyleRow(result.id)
    const previewPath = importedStyle ? resolvePreviewPath(importedStyle) : null
    if (previewPath) {
      await enqueueHtmlThumbnail(
        { resourceType: 'style', resourceId: result.id, sourcePath: previewPath },
        { force: true }
      )
    }
    return { success: true, cancelled: false, ...result }
  }

  ipcMain.handle('styles:get', async () => {
    log.info('[styles:get] requested')
    const styles = listStyleCatalog()
    const categories: Record<
      string,
      Array<{
        id: string
        label: string
        description: string
        source?: 'builtin' | 'custom' | 'override'
        editable?: boolean
        styleCase?: string
        imageGenerationPrompt?: string
      }>
    > = {}
    for (const style of styles) {
      const category = style.category
      if (!categories[category]) categories[category] = []
      categories[category].push({
        id: style.id,
        label: style.label,
        description: style.description,
        source: style.source,
        editable: style.editable,
        styleCase: style.styleCase,
        imageGenerationPrompt: style.imageGenerationPrompt
      })
    }
    const defaultStyle =
      styles.find((item) => item.styleKey === 'minimal-white')?.id ?? styles[0]?.id ?? ''
    return { categories, defaultStyle }
  })

  ipcMain.handle('styles:getDetail', async (_event, styleId: string) => {
    return getStyleDetail(styleId)
  })

  ipcMain.handle('styles:list', async (_event, payload?: { sessionId?: string }) => {
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
    const rows = (await db.listStyleRows()).filter((row) => row.active !== false)
    rows.sort(
      (a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id)
    )
    const items = await Promise.all(rows.map(async (row) => {
      const previewPath = resolvePreviewPath(row)
      return {
        id: row.id,
        styleKey: row.style,
        label: row.styleName,
        name: {
          zh: row.styleNameZh || row.styleName,
          en: row.styleNameEn || ''
        },
        description: row.description,
        aliases: parseAliases(row.aliases),
        category: row.category || (row.source === 'builtin' ? '内置' : '自定义'),
        source: row.source,
        editable: row.source !== 'builtin',
        version: row.version,
        styleCase: row.styleCase,
        imageGenerationPrompt: row.imageGenerationPrompt || '',
        packageDir: row.packageDir || '',
        favoriteAt: row.favoriteAt ?? null,
        previewPath,
        thumbnailPath: previewPath
          ? await getFreshHtmlThumbnailPath({
              resourceType: 'style',
              resourceId: row.id,
              sourcePath: previewPath
            })
          : null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }
    }))

    if (sessionId) {
      const snapshot = await db.getSessionStyleSnapshot(sessionId)
      if (snapshot && !items.some((item) => item.id === snapshot.styleId)) {
        const previewPath = resolvePreviewPath({
          id: snapshot.styleId,
          style: snapshot.styleKey,
          source: snapshot.source,
          packageDir: snapshot.packageDir
        })
        items.unshift({
          id: snapshot.styleId,
          styleKey: snapshot.styleKey,
          label: snapshot.styleName,
          name: {
            zh: snapshot.styleNameZh || snapshot.styleName,
            en: snapshot.styleNameEn || ''
          },
          description: snapshot.description,
          aliases: parseAliases(snapshot.aliases),
          category: snapshot.category || (snapshot.source === 'builtin' ? '内置' : '自定义'),
          source: snapshot.source,
          editable: false,
          version: snapshot.version,
          styleCase: snapshot.styleCase,
          imageGenerationPrompt: snapshot.imageGenerationPrompt || '',
          packageDir: snapshot.packageDir || '',
          favoriteAt: null,
          previewPath,
          thumbnailPath: previewPath
            ? await getFreshHtmlThumbnailPath({
                resourceType: 'style',
                resourceId: snapshot.styleId,
                sourcePath: previewPath
              })
            : null,
          createdAt: snapshot.createdAt,
          updatedAt: snapshot.createdAt
        })
      }
    }
    return {
      items
    }
  })

  ipcMain.handle('styles:recommend', async (_event, payload) => {
    const topic = typeof payload?.topic === 'string' ? payload.topic.trim() : ''
    if (!topic) throw new Error('请先填写主题后再推荐风格。')
    const brief = typeof payload?.brief === 'string' ? payload.brief.trim().slice(0, 8000) : ''
    const rows = (await db.listStyleRows()).filter((row) => row.active !== false)
    const styles = await Promise.all(
      rows.map(async (row) => {
        try {
          return (await readStylePackage(getStylePackageDirectory(row.id))).json
        } catch (error) {
          log.warn('[styles:recommend] using catalog metadata for unreadable style package', {
            styleId: row.id,
            styleKey: row.style,
            error: error instanceof Error ? error.message : String(error)
          })
          return styleRowToPackageJson(row)
        }
      })
    )
    const activeModel = await resolveModelConfigForTask(ctx, {
      modelConfigId: payload?.modelConfigId,
      purpose: 'styles:recommend'
    })
    const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
    const styleKeys = await recommendStyles({
      topic: topic.slice(0, 1000),
      brief,
      styles,
      provider: activeModel.provider,
      apiKey: activeModel.apiKey,
      model: activeModel.model,
      baseUrl: activeModel.baseUrl,
      maxTokens: activeModel.maxTokens,
      modelRuntime: ctx.modelRuntime,
      modelTimeoutMs: modelTimeouts.agent
    })
    return { styleKeys }
  })

  ipcMain.handle('styles:setFavorite', async (_event, payload) => {
    const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const styleId = String(record.styleId || '').trim()
    if (!styleId) return { success: false, styleId: '', favoriteAt: null }
    const nextFavoriteAt = record.favorite ? Math.floor(Date.now() / 1000) : null
    try {
      const favoriteAt = await db.setStyleFavorite(styleId, nextFavoriteAt)
      return { success: true, styleId, favoriteAt }
    } catch {
      return { success: false, styleId, favoriteAt: null }
    }
  })

  const parseBasePayload = (payload: unknown): StyleBasePayload => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const label = String(record.label || '').trim()
    const description = String(record.description || '').trim()
    const category = String(record.category || '').trim()
    const styleSkill = String(record.styleSkill || '').trim()
    const aliases = Array.isArray(record.aliases)
      ? record.aliases
          .map((alias: unknown) => String(alias || '').trim())
          .filter((alias: string) => alias.length > 0)
      : []
    if (!label) {
      throw new Error('保存风格失败：label 必填。')
    }
    if (!styleSkill) {
      throw new Error('保存风格失败：styleSkill 不能为空。')
    }
    return {
      label,
      description,
      category,
      aliases,
      prompt: styleSkill,
      styleCase: String(record.styleCase || '').trim(),
      imageGenerationPrompt:
        typeof record.imageGenerationPrompt === 'string'
          ? record.imageGenerationPrompt.trim()
          : undefined
    }
  }

  const parseCreatePayload = (payload: unknown): StyleBasePayload => {
    log.info('[styles:create] payload requested')
    return parseBasePayload(payload)
  }

  const parseUpdatePayload = (payload: unknown): StylePayload => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const id = String(record.id || '').trim()
    if (!id) {
      throw new Error('保存风格失败：id 必填。')
    }
    log.info('[styles:update] payload requested', { styleId: id })
    return {
      ...parseBasePayload(payload),
      id
    }
  }

  ipcMain.handle('styles:parseFile', async (_event, payload) => {
    const filePath = typeof payload?.filePath === 'string' ? payload.filePath.trim() : ''
    if (!filePath) throw new Error('文件路径为空')
    const activeModel = await resolveModelConfigForTask(ctx, {
      modelConfigId: payload?.modelConfigId,
      purpose: 'styles:parseFile'
    })
    const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
    const styleImportDir = path.join(await ctx.resolveStoragePath(), 'style-import')
    await fs.promises.mkdir(styleImportDir, { recursive: true })
    return await parseStyleFile({
      filePath,
      provider: activeModel.provider,
      apiKey: activeModel.apiKey,
      model: activeModel.model,
      baseUrl: activeModel.baseUrl,
      maxTokens: activeModel.maxTokens,
      modelRuntime: ctx.modelRuntime,
      modelTimeoutMs: modelTimeouts.document,
      workspaceDir: styleImportDir
    })
  })

  ipcMain.handle('styles:parsePptx', async (_event, payload) => {
    const filePath = typeof payload?.filePath === 'string' ? payload.filePath.trim() : ''
    if (!filePath) throw new Error('文件路径为空')
    const activeModel = await resolveModelConfigForTask(ctx, {
      modelConfigId: payload?.modelConfigId,
      purpose: 'styles:parsePptx'
    })
    const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
    const tmpRootDir = path.join(await ctx.resolveStoragePath(), 'tmpStyle')
    await fs.promises.mkdir(tmpRootDir, { recursive: true })
    return await parseStylePptx({
      filePath,
      provider: activeModel.provider,
      apiKey: activeModel.apiKey,
      model: activeModel.model,
      baseUrl: activeModel.baseUrl,
      maxTokens: activeModel.maxTokens,
      modelRuntime: ctx.modelRuntime,
      modelTimeoutMs: modelTimeouts.document,
      tmpRootDir
    })
  })

  ipcMain.handle('styles:parseImage', async (_event, payload) => {
    const imageBase64 = typeof payload?.imageBase64 === 'string' ? payload.imageBase64.trim() : ''
    const rawMimeType = typeof payload?.mimeType === 'string' ? payload.mimeType : ''
    const mimeType = normalizeImageMimeType(rawMimeType)
    if (!imageBase64) throw new Error('图片数据为空')
    if (!isSupportedImageMimeType(rawMimeType)) {
      throw new Error(`不支持的图片格式：${mimeType || 'unknown'}`)
    }
    let imageBuffer: Buffer
    try {
      imageBuffer = Buffer.from(imageBase64, 'base64')
    } catch {
      throw new Error('图片数据格式无效')
    }
    if (!imageBuffer.length) {
      throw new Error('图片数据为空')
    }
    if (imageBuffer.length > MAX_STYLE_IMAGE_SIZE_BYTES) {
      throw new Error(
        `图片过大（${(imageBuffer.length / 1024 / 1024).toFixed(1)}MB），图片上限 5MB`
      )
    }

    const activeModel = await resolveModelConfigForTask(ctx, {
      modelConfigId: payload?.modelConfigId,
      purpose: 'styles:parseImage'
    })
    const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
    return await parseStyleImage({
      imageBase64,
      mimeType,
      provider: activeModel.provider,
      apiKey: activeModel.apiKey,
      model: activeModel.model,
      baseUrl: activeModel.baseUrl,
      maxTokens: activeModel.maxTokens,
      modelRuntime: ctx.modelRuntime,
      modelTimeoutMs: modelTimeouts.document
    })
  })

  ipcMain.handle('styles:importPackageZip', async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const openResult = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, {
          title: '导入风格包',
          buttonLabel: '导入',
          properties: ['openFile'],
          filters: [
            { name: 'Style ZIP', extensions: ['zip'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        })
      : await dialog.showOpenDialog({
          title: '导入风格包',
          buttonLabel: '导入',
          properties: ['openFile'],
          filters: [
            { name: 'Style ZIP', extensions: ['zip'] },
            { name: '所有文件', extensions: ['*'] }
          ]
        })
    if (openResult.canceled || openResult.filePaths.length === 0) {
      return { success: false, cancelled: true, id: '', source: 'custom' as const }
    }
    const result = await importStylePackageZip(openResult.filePaths[0])
    return completeStylePackageImport(result)
  })

  ipcMain.handle('styles:importPackageDirectory', async (event) => {
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const openResult = ownerWindow
      ? await dialog.showOpenDialog(ownerWindow, {
          title: '导入风格文件夹',
          buttonLabel: '导入',
          properties: ['openDirectory']
        })
      : await dialog.showOpenDialog({
          title: '导入风格文件夹',
          buttonLabel: '导入',
          properties: ['openDirectory']
        })
    if (openResult.canceled || openResult.filePaths.length === 0) {
      return { success: false, cancelled: true, id: '', source: 'custom' as const }
    }
    const result = await importStylePackageDirectory(openResult.filePaths[0])
    return completeStylePackageImport(result)
  })

  ipcMain.handle('styles:exportPackageZip', async (event, payload) => {
    const styleId = typeof payload?.styleId === 'string' ? payload.styleId.trim() : ''
    if (!styleId) throw new Error('styleId 为空')
    const detail = getStyleDetail(styleId)
    const safeName = (detail.styleKey || detail.id).replace(/[^a-z0-9-]/gi, '-').toLowerCase()
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const saveResult = ownerWindow
      ? await dialog.showSaveDialog(ownerWindow, {
          title: '导出风格包',
          defaultPath: safeName + '.zip',
          filters: [{ name: 'Style ZIP', extensions: ['zip'] }]
        })
      : await dialog.showSaveDialog({
          title: '导出风格包',
          defaultPath: safeName + '.zip',
          filters: [{ name: 'Style ZIP', extensions: ['zip'] }]
        })
    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true }
    }
    const outputPath = saveResult.filePath.toLowerCase().endsWith('.zip')
      ? saveResult.filePath
      : saveResult.filePath + '.zip'
    const result = await exportStylePackageZip(styleId, outputPath)
    return { success: true, canceled: false, ...result }
  })

  ipcMain.handle('styles:create', async (_event, payload) => {
    const parsed = parseCreatePayload(payload)
    let id = `style-${nanoidLower()}`
    while (hasStyleSkill(id)) {
      id = `style-${nanoidLower()}`
    }
    const result = await createStyleSkill({
      ...parsed,
      id
    })
    return { success: true, ...result }
  })

  ipcMain.handle('styles:update', async (_event, payload) => {
    const parsed = parseUpdatePayload(payload)
    const result = await updateStyleSkill(parsed)
    return { success: true, ...result }
  })

  ipcMain.handle('styles:delete', async (_event, styleId: string) => {
    const id = String(styleId || '').trim()
    if (!id) return { success: false, deleted: false }
    const result = await deleteStyleSkill(id)
    return { success: result.deleted, deleted: result.deleted }
  })
}
