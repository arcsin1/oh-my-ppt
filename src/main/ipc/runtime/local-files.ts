import fs from 'fs'
import path from 'path'
import dayjs from 'dayjs'
import { nanoid } from 'nanoid'
import type { UploadedAsset } from '@shared/generation'
import type { PPTDatabase } from '../../db/database'
import type { SessionProjectResolver } from './session-project'

type UploadedFile = { path?: unknown; name?: unknown }
type UploadTarget = 'images' | 'videos' | 'docs'

export type RuntimeLocalFiles = {
  resolveStoragePath(): Promise<string>
  normalizeSessionId(value: unknown): string | undefined
  parsePathPayload(
    payload: unknown,
    preferredKey?: 'path' | 'htmlPath'
  ): { filePath: string; sessionId?: string; hash?: string }
  formatImagePathsForPrompt(imagePaths?: string[], videoPaths?: string[]): string
  buildAssetTimestamp(): string
  uploadSessionFiles(
    sessionId: string,
    files: UploadedFile[],
    target: UploadTarget
  ): Promise<UploadedAsset[]>
  uploadImageAssets(sessionId: string, files: UploadedFile[]): Promise<UploadedAsset[]>
  uploadMediaAssets(sessionId: string, files: UploadedFile[]): Promise<UploadedAsset[]>
  resolveExistingFileRealPath(filePath: string): Promise<string>
  resolveWritableFileRealPath(filePath: string): Promise<string>
  resolveAllowedRoots(sessionId?: string): Promise<string[]>
  assertPathInAllowedRoots(args: {
    filePath: string
    mode: 'read' | 'write'
    sessionId?: string
    htmlOnly?: boolean
  }): Promise<string>
}

export const MAX_ASSET_IMPORT_SIZE = 20 * 1024 * 1024
export const ALLOWED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'])
export const ALLOWED_VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.ogg'])
export const ALLOWED_DOC_EXTENSIONS = new Set(['.md', '.txt', '.text'])

export function resolveAssetUploadTarget(
  sourcePath: string,
  kind?: 'image' | 'video' | 'document'
): UploadTarget {
  const ext = path.extname(sourcePath).toLowerCase()
  const inferred: UploadTarget | null = ALLOWED_IMAGE_EXTENSIONS.has(ext)
    ? 'images'
    : ALLOWED_VIDEO_EXTENSIONS.has(ext)
      ? 'videos'
      : ALLOWED_DOC_EXTENSIONS.has(ext)
        ? 'docs'
        : null
  if (kind === 'image') {
    if (inferred !== 'images') throw new Error('暂只支持 png、jpg、jpeg、webp、gif、svg 图片素材')
    return 'images'
  }
  if (kind === 'video') {
    if (inferred !== 'videos') throw new Error('暂只支持 mp4、webm、ogg 视频素材')
    return 'videos'
  }
  if (kind === 'document') {
    if (inferred !== 'docs') throw new Error('暂只支持 md、txt 文档素材')
    return 'docs'
  }
  if (!inferred)
    throw new Error('暂只支持 png/jpg/webp/gif/svg 图片、mp4/webm/ogg 视频，或 md/txt 文档素材')
  return inferred
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
}
const DOC_MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.text': 'text/plain'
}
const VIDEO_MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg'
}

export function createRuntimeLocalFiles(args: {
  db: PPTDatabase
  sessionProject: SessionProjectResolver
}): RuntimeLocalFiles {
  const { db, sessionProject } = args

  const resolveStoragePath = async (): Promise<string> => {
    const saved = await db.getSetting<string>('storage_path')
    if (typeof saved === 'string' && saved.trim().length > 0) {
      const normalized = saved.trim()
      await db.setStoragePath(normalized)
      return normalized
    }
    throw new Error('请先前往系统设置选择存储目录。')
  }

  const normalizeSessionId = (value: unknown): string | undefined => {
    if (typeof value !== 'string') return undefined
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  const parsePathPayload = (
    payload: unknown,
    preferredKey: 'path' | 'htmlPath' = 'path'
  ): { filePath: string; sessionId?: string; hash?: string } => {
    if (typeof payload === 'string') return { filePath: payload.trim() }
    if (!payload || typeof payload !== 'object') return { filePath: '' }
    const record = payload as Record<string, unknown>
    const candidate =
      typeof record[preferredKey] === 'string'
        ? String(record[preferredKey])
        : typeof record.path === 'string'
          ? String(record.path)
          : typeof record.htmlPath === 'string'
            ? String(record.htmlPath)
            : ''
    return {
      filePath: candidate.trim(),
      sessionId: normalizeSessionId(record.sessionId),
      hash: typeof record.hash === 'string' ? record.hash : undefined
    }
  }

  const formatImagePathsForPrompt = (imagePaths?: string[], videoPaths?: string[]): string => {
    const validPaths = Array.isArray(imagePaths)
      ? imagePaths
          .map((item) => String(item || '').trim())
          .filter((item) => item.startsWith('./images/'))
          .slice(0, 10)
      : []
    const validVideoPaths = Array.isArray(videoPaths)
      ? videoPaths
          .map((item) => String(item || '').trim())
          .filter((item) => item.startsWith('./videos/'))
          .slice(0, 10)
      : []
    if (validPaths.length === 0 && validVideoPaths.length === 0) return ''
    return [
      '',
      validPaths.length > 0 ? '本次消息可用图片路径：' : '',
      ...validPaths.map((imagePath, index) => `- ${index + 1}. ${imagePath}`),
      validPaths.length > 0 ? '' : '',
      validVideoPaths.length > 0 ? '本次消息可用视频路径：' : '',
      ...validVideoPaths.map((videoPath, index) => `- ${index + 1}. ${videoPath}`),
      validVideoPaths.length > 0 ? '' : '',
      '素材使用规则：',
      '- 如需使用图片或视频，请引用上面的相对路径。',
      '- 禁止使用 file://、绝对路径或 base64。',
      '- 不要重新引入远程资源，优先使用这些本地素材。',
      '- 插入视频时必须使用 HTML <video> 标签，并包含 controls playsinline preload="metadata"。',
      '- 视频默认不要添加 autoplay 或 muted，让用户点击控件后播放并保留声音；只有明确要求循环背景视频时才使用 muted/loop。'
    ]
      .filter(Boolean)
      .join('\n')
  }

  const buildAssetTimestamp = (): string => dayjs().format('YYYYMMDD-HHmmss')

  const uploadSessionFiles = async (
    sessionId: string,
    files: UploadedFile[],
    target: UploadTarget
  ): Promise<UploadedAsset[]> => {
    if (!sessionId) throw new Error('sessionId 不能为空')
    if (files.length === 0) return []

    const projectDir = await sessionProject.resolveSessionProjectDir(sessionId)
    const targetRoot = path.join(projectDir, target)
    await fs.promises.mkdir(targetRoot, { recursive: true })
    const uploadedAssets: UploadedAsset[] = []

    for (const file of files) {
      const sourcePath = typeof file.path === 'string' ? file.path.trim() : ''
      if (!sourcePath) throw new Error('素材路径不能为空')
      const stat = await fs.promises.stat(sourcePath)
      if (!stat.isFile()) throw new Error(`素材不是文件: ${sourcePath}`)
      if (stat.size > MAX_ASSET_IMPORT_SIZE) throw new Error('单个素材不能超过 20MB')

      const ext = path.extname(sourcePath).toLowerCase()
      if (target === 'images' && !ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        throw new Error('暂只支持 png、jpg、jpeg、webp、gif、svg 图片素材')
      }
      if (target === 'docs' && !ALLOWED_DOC_EXTENSIONS.has(ext)) {
        throw new Error('暂只支持 md、txt 文档素材')
      }
      if (target === 'videos' && !ALLOWED_VIDEO_EXTENSIONS.has(ext)) {
        throw new Error('暂只支持 mp4、webm、ogg 视频素材')
      }

      const originalName =
        typeof file.name === 'string' && file.name.trim().length > 0
          ? file.name.trim()
          : path.basename(sourcePath)
      const id = nanoid(10)
      const baseNameWithoutExt = sessionProject.toSafeAssetBaseName(
        originalName.replace(/\.[^.]+$/, '')
      )
      const fileName = `${baseNameWithoutExt}-${id}${ext}`
      const targetPath = path.join(targetRoot, fileName)
      if (!sessionProject.isPathInside(path.resolve(targetPath), targetRoot)) {
        throw new Error('素材目标路径不合法')
      }
      await fs.promises.copyFile(sourcePath, targetPath)

      uploadedAssets.push({
        id,
        fileName,
        originalName,
        relativePath: `./${target}/${fileName}`,
        absolutePath: targetPath,
        mimeType:
          target === 'images'
            ? IMAGE_MIME_BY_EXT[ext] || 'application/octet-stream'
            : target === 'videos'
              ? VIDEO_MIME_BY_EXT[ext] || 'application/octet-stream'
              : DOC_MIME_BY_EXT[ext] || 'text/plain',
        size: stat.size,
        createdAt: Math.floor(Date.now() / 1000)
      })
    }

    return uploadedAssets
  }

  const uploadImageAssets = (sessionId: string, files: UploadedFile[]): Promise<UploadedAsset[]> =>
    uploadSessionFiles(sessionId, files, 'images')

  const uploadMediaAssets = async (
    sessionId: string,
    files: UploadedFile[]
  ): Promise<UploadedAsset[]> => {
    const mediaAssets: UploadedAsset[] = []
    const imageFiles: UploadedFile[] = []
    const videoFiles: UploadedFile[] = []
    for (const file of files) {
      const sourcePath = typeof file.path === 'string' ? file.path.trim() : ''
      const ext = path.extname(sourcePath).toLowerCase()
      if (ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
        imageFiles.push(file)
        continue
      }
      if (ALLOWED_VIDEO_EXTENSIONS.has(ext)) {
        videoFiles.push(file)
        continue
      }
      throw new Error('暂只支持 png/jpg/webp/gif/svg 图片，或 mp4/webm/ogg 视频素材')
    }
    if (imageFiles.length > 0) {
      mediaAssets.push(...(await uploadSessionFiles(sessionId, imageFiles, 'images')))
    }
    if (videoFiles.length > 0) {
      mediaAssets.push(...(await uploadSessionFiles(sessionId, videoFiles, 'videos')))
    }
    return mediaAssets
  }

  const resolveExistingFileRealPath = async (filePath: string): Promise<string> => {
    const absolutePath = path.resolve(filePath)
    if (!fs.existsSync(absolutePath)) throw new Error(`文件不存在: ${absolutePath}`)
    const stat = await fs.promises.stat(absolutePath)
    if (!stat.isFile()) throw new Error(`目标不是文件: ${absolutePath}`)
    return fs.promises.realpath(absolutePath)
  }

  const resolveWritableFileRealPath = async (filePath: string): Promise<string> => {
    const absolutePath = path.resolve(filePath)
    if (fs.existsSync(absolutePath)) {
      const stat = await fs.promises.stat(absolutePath)
      if (!stat.isFile()) throw new Error(`目标不是文件: ${absolutePath}`)
      return fs.promises.realpath(absolutePath)
    }
    const parentDir = path.dirname(absolutePath)
    if (!fs.existsSync(parentDir)) throw new Error(`目标目录不存在: ${parentDir}`)
    const parentRealPath = await fs.promises.realpath(parentDir)
    return path.join(parentRealPath, path.basename(absolutePath))
  }

  const resolveAllowedRoots = async (sessionId?: string): Promise<string[]> => {
    const roots = new Set<string>()
    const storagePath = await resolveStoragePath()
    const storageRoot = fs.existsSync(storagePath)
      ? await fs.promises.realpath(storagePath)
      : path.resolve(storagePath)
    roots.add(storageRoot)

    if (sessionId) {
      const project = await db.getProject(sessionId)
      const rootPath = typeof project?.root_path === 'string' ? project.root_path : ''
      if (rootPath) {
        const resolvedRootPath = fs.existsSync(rootPath)
          ? await fs.promises.realpath(rootPath)
          : path.resolve(rootPath)
        roots.add(resolvedRootPath)
      }
    }
    return [...roots]
  }

  const assertPathInAllowedRoots = async (args: {
    filePath: string
    mode: 'read' | 'write'
    sessionId?: string
    htmlOnly?: boolean
  }): Promise<string> => {
    const { filePath, mode, sessionId, htmlOnly } = args
    if (typeof filePath !== 'string' || filePath.trim().length === 0) {
      throw new Error('文件路径不能为空')
    }
    const extension = path.extname(filePath).toLowerCase()
    if (htmlOnly && extension !== '.html' && extension !== '.htm') {
      throw new Error(`仅允许访问 HTML 文件，当前扩展名: ${extension || '(none)'}`)
    }
    const resolveSessionHtmlFallbackPath = async (): Promise<string | null> => {
      if (mode !== 'read' || !sessionId) return null
      if (extension !== '.html' && extension !== '.htm') return null
      const fileName = path.basename(filePath)
      if (!fileName) return null
      const projectDir = await sessionProject.resolveSessionProjectDir(sessionId)
      const fallbackPath = path.join(projectDir, fileName)
      if (path.resolve(fallbackPath) === path.resolve(filePath)) return null
      return fs.existsSync(fallbackPath) ? fallbackPath : null
    }

    let targetPath: string
    if (mode === 'read') {
      try {
        targetPath = await resolveExistingFileRealPath(filePath)
      } catch (error) {
        const fallbackPath = await resolveSessionHtmlFallbackPath()
        if (!fallbackPath) throw error
        targetPath = await resolveExistingFileRealPath(fallbackPath)
      }
    } else {
      targetPath = await resolveWritableFileRealPath(filePath)
    }
    const allowedRoots = await resolveAllowedRoots(sessionId)
    if (!allowedRoots.some((root) => sessionProject.isPathInside(targetPath, root))) {
      throw new Error(`文件路径不在允许目录内: ${targetPath}`)
    }
    return targetPath
  }

  return {
    resolveStoragePath,
    normalizeSessionId,
    parsePathPayload,
    formatImagePathsForPrompt,
    buildAssetTimestamp,
    uploadSessionFiles,
    uploadImageAssets,
    uploadMediaAssets,
    resolveExistingFileRealPath,
    resolveWritableFileRealPath,
    resolveAllowedRoots,
    assertPathInAllowedRoots
  }
}
