import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { unzipSync } from 'fflate'
import log from 'electron-log/main.js'
import type { IpcContext } from '../ipc/context'
import {
  buildProjectIndexHtml,
  extractPagesDataFromIndex,
  type DeckPageFile
} from '../session/template-builder'
import { recordHistoryOperationStrict } from '../history/git-history-service'
import { createSessionMasterIfMissing } from '../session/master-service'
import { createDefaultDesignContract } from '../presentation/design-contract'
import { resolveUsableStyleId } from '../styles/catalog'
import { findSlidePackResourceZipInsideZip } from './slide-pack-archive'
import {
  requireSlideSizeFromHtml,
  type SlideSizePreset
} from '@shared/slide-size'

const MAX_IMPORT_FILE_BYTES = 300 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 600 * 1024 * 1024
const MAX_EXTRACTED_FILES = 5000
const IGNORED_IMPORT_FILE_EXTENSIONS = new Set([
  '.ppt',
  '.pptx',
  '.key',
  '.py',
  '.pyc',
  '.pyo',
  '.ipynb',
  '.sqlite',
  '.sqlite3',
  '.db',
  '.log'
])
const IGNORED_IMPORT_FILE_NAMES = new Set([
  '.ds_store',
  '.gitignore',
  'thumbs.db',
  'desktop.ini',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock'
])
const IGNORED_IMPORT_DIR_NAMES = new Set([
  '.git',
  '.github',
  '.idea',
  '.vscode',
  '_export_screenshots',
  '__macosx',
  '__pycache__',
  'conversation_history',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'node_modules',
  'tmp',
  'temp',
  'cache',
  '.cache'
])

type ImportKind = 'slide-pack' | 'zip'

type ImportedPage = {
  entityId: string
  fileSlug: string
  legacyPageId: string | null
  pageNumber: number
  title: string
  htmlPath: string
  htmlFileName: string
}

export type SessionFileImportResult = {
  success: true
  cancelled: false
  sessionId: string
  title: string
  pageCount: number
  warnings: string[]
}

type PreparedImport = {
  importKind: ImportKind
  sessionRoot: string
  warnings: string[]
}

const isIgnoredArchivePath = (
  relativePath: string,
  options?: { allowPresentationFiles?: boolean }
): boolean => {
  const parts = relativePath.split('/').filter(Boolean)
  if (parts.length === 0) return true
  if (parts.some((part) => IGNORED_IMPORT_DIR_NAMES.has(part.toLowerCase()))) return true
  const baseName = parts[parts.length - 1]
  if (IGNORED_IMPORT_FILE_NAMES.has(baseName.toLowerCase())) return true
  const ext = path.extname(baseName).toLowerCase()
  if (options?.allowPresentationFiles && ['.ppt', '.pptx', '.key'].includes(ext)) return false
  return IGNORED_IMPORT_FILE_EXTENSIONS.has(ext)
}

const normalizeArchivePath = (rawName: string): string | null => {
  const normalized = rawName.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.endsWith('/')) return null
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0 || parts.some((part) => part === '..' || part === '.')) return null
  return parts.join('/')
}

const isPathInside = (targetPath: string, rootPath: string): boolean => {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const ensureInside = (targetPath: string, rootPath: string, message: string): void => {
  if (!isPathInside(targetPath, rootPath)) throw new Error(message)
}

const tryExtractSlidePackZip = (buffer: Buffer): Uint8Array | null => {
  if (buffer.byteLength < 8) return null
  let zipLength = 0
  try {
    zipLength = Number(buffer.readBigUInt64LE(buffer.byteLength - 8))
  } catch {
    return null
  }
  if (!Number.isSafeInteger(zipLength) || zipLength <= 0) return null
  const zipStart = buffer.byteLength - 8 - zipLength
  if (zipStart < 0) return null
  const zipData = buffer.subarray(zipStart, buffer.byteLength - 8)
  if (zipData[0] !== 0x50 || zipData[1] !== 0x4b) return null
  return zipData
}

const tryReadZip = (zipData: Uint8Array): Record<string, Uint8Array> | null => {
  try {
    return unzipSync(zipData)
  } catch {
    return null
  }
}

const findSlidePackZipInsideZip = (zipData: Uint8Array): Uint8Array | null => {
  const files = tryReadZip(zipData)
  if (!files) return null
  const candidates = Object.entries(files)
    .map(([name, data]) => ({ name: normalizeArchivePath(name), data }))
    .filter((entry): entry is { name: string; data: Uint8Array } => {
      if (!entry.name || isIgnoredArchivePath(entry.name, { allowPresentationFiles: true })) return false
      return entry.data.byteLength > 8
    })
  if (candidates.length !== 1) return null
  return tryExtractSlidePackZip(Buffer.from(candidates[0].data))
}

const archiveHasRootIndexHtml = (zipData: Uint8Array): boolean => {
  const files = tryReadZip(zipData)
  if (!files) return false
  return Object.keys(files).some((rawName) => {
    const relativePath = normalizeArchivePath(rawName)
    return relativePath?.toLowerCase() === 'index.html'
  })
}

const extractZipToDirectory = async (
  zipData: Uint8Array,
  targetDir: string,
  mode: 'deck-root' | 'single-session-directory'
): Promise<string> => {
  log.info('[session-import] extract zip start', {
    targetDir,
    mode,
    zipBytes: zipData.byteLength
  })
  const files = tryReadZip(zipData)
  if (!files) throw new Error('无法读取 ZIP 文件，请确认文件未损坏。')

  let totalBytes = 0
  let fileCount = 0
  let skippedFiles = 0
  const entries: Array<{ relativePath: string; data: Uint8Array }> = []
  const rootNames = new Set<string>()
  const illegalRootFiles: string[] = []

  for (const [rawName, data] of Object.entries(files)) {
    const relativePath = normalizeArchivePath(rawName)
    if (!relativePath) continue
    if (isIgnoredArchivePath(relativePath)) {
      skippedFiles += 1
      continue
    }
    fileCount += 1
    totalBytes += data.byteLength
    if (fileCount > MAX_EXTRACTED_FILES) throw new Error('导入包文件数量过多，请精简后重试。')
    if (totalBytes > MAX_EXTRACTED_BYTES) throw new Error('导入包解压后体积过大，请精简素材后重试。')

    const parts = relativePath.split('/')
    if (mode === 'single-session-directory') {
      if (parts.length < 2) {
        illegalRootFiles.push(relativePath)
        continue
      }
      rootNames.add(parts[0])
    }
    entries.push({ relativePath, data })
  }

  if (entries.length === 0) throw new Error('导入包为空或不包含可导入的会话文件。')
  if (mode === 'single-session-directory') {
    if (illegalRootFiles.length > 0 || rootNames.size !== 1) {
      log.warn('[session-import] invalid zip root layout', {
        rootCount: rootNames.size,
        rootNames: Array.from(rootNames),
        illegalRootFiles: illegalRootFiles.slice(0, 20)
      })
      throw new Error('ZIP 根目录必须只包含一个完整会话目录，请压缩 session-id 文件夹后再导入。')
    }
  }

  await fs.promises.mkdir(targetDir, { recursive: true })
  for (const entry of entries) {
    const targetPath = path.resolve(targetDir, entry.relativePath)
    ensureInside(targetPath, targetDir, '压缩包包含非法路径，已拒绝导入。')
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.promises.writeFile(targetPath, entry.data)
  }

  const sessionRoot = mode === 'single-session-directory'
    ? path.join(targetDir, Array.from(rootNames)[0])
    : targetDir
  log.info('[session-import] extract zip completed', {
    targetDir,
    mode,
    sessionRoot,
    fileCount,
    totalBytes,
    skippedFiles
  })
  return sessionRoot
}

const prepareImportSource = async (sourceBuffer: Buffer, tempDir: string): Promise<PreparedImport> => {
  log.info('[session-import] detect source start', {
    bytes: sourceBuffer.byteLength,
    tempDir
  })
  const directSlidePackZip = tryExtractSlidePackZip(sourceBuffer)
  if (directSlidePackZip) {
    log.info('[session-import] detected direct slide-pack', {
      zipBytes: directSlidePackZip.byteLength
    })
    return {
      importKind: 'slide-pack',
      sessionRoot: await extractZipToDirectory(directSlidePackZip, path.join(tempDir, 'slide-pack'), 'deck-root'),
      warnings: []
    }
  }

  const appBundleSlidePackZip = findSlidePackResourceZipInsideZip(sourceBuffer)
  if (appBundleSlidePackZip) {
    log.info('[session-import] detected macOS app slide-pack', {
      zipBytes: appBundleSlidePackZip.byteLength
    })
    return {
      importKind: 'slide-pack',
      sessionRoot: await extractZipToDirectory(
        appBundleSlidePackZip,
        path.join(tempDir, 'slide-pack-app'),
        'deck-root'
      ),
      warnings: []
    }
  }

  const nestedSlidePackZip = findSlidePackZipInsideZip(sourceBuffer)
  if (nestedSlidePackZip) {
    log.info('[session-import] detected zipped slide-pack', {
      zipBytes: nestedSlidePackZip.byteLength
    })
    return {
      importKind: 'slide-pack',
      sessionRoot: await extractZipToDirectory(
        nestedSlidePackZip,
        path.join(tempDir, 'slide-pack-zip'),
        'deck-root'
      ),
      warnings: []
    }
  }

  if (archiveHasRootIndexHtml(sourceBuffer)) {
    log.info('[session-import] detected flat session zip')
    return {
      importKind: 'zip',
      sessionRoot: await extractZipToDirectory(
        sourceBuffer,
        path.join(tempDir, 'session-zip-root'),
        'deck-root'
      ),
      warnings: []
    }
  }

  log.info('[session-import] fallback to standard session zip')
  return {
    importKind: 'zip',
    sessionRoot: await extractZipToDirectory(
      sourceBuffer,
      path.join(tempDir, 'session-zip'),
      'single-session-directory'
    ),
    warnings: []
  }
}

const sanitizeTitle = (title: string, fallback: string): string => {
  const normalized = title.replace(/\s*[·-]\s*Preview\s*$/i, '').trim()
  return normalized.slice(0, 120) || fallback
}

const readTitleFromIndex = async (indexPath: string, fallback: string): Promise<string> => {
  try {
    const html = await fs.promises.readFile(indexPath, 'utf-8')
    const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    if (!match?.[1]) return fallback
    return sanitizeTitle(match[1].replace(/<[^>]+>/g, '').trim(), fallback)
  } catch {
    return fallback
  }
}

const assertValidFileSlug = (value: string): string => {
  const trimmed = value.trim()
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error(`页面 ID 不合法：${value}`)
  }
  return trimmed
}

const validateSessionRoot = async (
  sessionRoot: string
): Promise<Array<{ pageNumber: number; fileSlug: string; title: string; htmlFileName: string }>> => {
  log.info('[session-import] validate session root start', { sessionRoot })
  const indexPath = path.join(sessionRoot, 'index.html')
  if (!fs.existsSync(indexPath)) throw new Error('会话目录缺少 index.html。')
  const indexHtml = await fs.promises.readFile(indexPath, 'utf-8')
  const pagesData = extractPagesDataFromIndex(indexHtml)
  if (pagesData.length === 0) {
    throw new Error('index.html 缺少页面清单，无法导入。')
  }

  const seenSlugs = new Set<string>()
  const pages = pagesData.map((page, index) => {
    const fileSlug = assertValidFileSlug(page.pageId || `page-${index + 1}`)
    if (seenSlugs.has(fileSlug)) throw new Error(`页面 ID 重复：${fileSlug}`)
    seenSlugs.add(fileSlug)
    const htmlFileName = page.htmlPath || `${fileSlug}.html`
    if (path.isAbsolute(htmlFileName) || htmlFileName.includes('\\')) {
      throw new Error(`页面路径不合法：${htmlFileName}`)
    }
    const htmlPath = path.resolve(sessionRoot, htmlFileName)
    ensureInside(htmlPath, sessionRoot, '页面文件路径越界，已拒绝导入。')
    if (!htmlPath.toLowerCase().endsWith('.html')) throw new Error(`页面文件不是 HTML：${htmlFileName}`)
    if (!fs.existsSync(htmlPath)) throw new Error(`页面文件缺失：${htmlFileName}`)
    return {
      pageNumber: Number(page.pageNumber) > 0 ? Math.floor(Number(page.pageNumber)) : index + 1,
      fileSlug,
      title: page.title || `Page ${index + 1}`,
      htmlFileName
    }
  })

  const sortedPages = pages.sort((left, right) => left.pageNumber - right.pageNumber)
  log.info('[session-import] validate session root completed', {
    sessionRoot,
    pageCount: sortedPages.length,
    pages: sortedPages.map((page) => ({
      pageNumber: page.pageNumber,
      fileSlug: page.fileSlug,
      htmlFileName: page.htmlFileName
    }))
  })
  return sortedPages
}

const copyDirectory = async (sourceDir: string, targetDir: string): Promise<void> => {
  log.info('[session-import] copy directory start', { sourceDir, targetDir })
  const sourceRoot = path.resolve(sourceDir)
  const targetRoot = path.resolve(targetDir)
  let copiedFiles = 0
  let skippedFiles = 0
  const copyRecursive = async (currentSource: string): Promise<void> => {
    const entries = await fs.promises.readdir(currentSource, { withFileTypes: true })
    for (const entry of entries) {
      const sourcePath = path.join(currentSource, entry.name)
      const relativePath = path.relative(sourceRoot, sourcePath).split(path.sep).join('/')
      if (!relativePath) continue
      if (isIgnoredArchivePath(relativePath)) {
        skippedFiles += 1
        continue
      }
      const targetPath = path.resolve(targetRoot, relativePath)
      ensureInside(targetPath, targetRoot, '复制目标路径不合法，已拒绝导入。')
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        await fs.promises.mkdir(targetPath, { recursive: true })
        await copyRecursive(sourcePath)
      } else if (entry.isFile()) {
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
        await fs.promises.copyFile(sourcePath, targetPath)
        copiedFiles += 1
      }
    }
  }
  await fs.promises.mkdir(targetRoot, { recursive: true })
  await copyRecursive(sourceRoot)
  log.info('[session-import] copy directory completed', {
    sourceDir,
    targetDir,
    copiedFiles,
    skippedFiles
  })
}

const buildImportedPages = (
  projectDir: string,
  pages: Array<{ pageNumber: number; fileSlug: string; title: string; htmlFileName: string }>
): ImportedPage[] =>
  pages.map((page) => ({
    entityId: crypto.randomUUID(),
    fileSlug: page.fileSlug,
    legacyPageId: /^page-\d+$/i.test(page.fileSlug) ? page.fileSlug : null,
    pageNumber: page.pageNumber,
    title: page.title,
    htmlPath: path.join(projectDir, page.htmlFileName),
    htmlFileName: page.htmlFileName
  }))

const rewriteIndexHtml = async (
  projectDir: string,
  title: string,
  pages: ImportedPage[],
  slideSize: SlideSizePreset
): Promise<void> => {
  log.info('[session-import] rewrite index start', {
    projectDir,
    title,
    pageCount: pages.length
  })
  const deckPages: DeckPageFile[] = pages.map((page) => ({
    id: page.entityId,
    pageNumber: page.pageNumber,
    pageId: page.fileSlug,
    title: page.title,
    htmlPath: page.htmlFileName
  }))
  await fs.promises.writeFile(
    path.join(projectDir, 'index.html'),
    buildProjectIndexHtml(title, deckPages, slideSize),
    'utf-8'
  )
  log.info('[session-import] rewrite index completed', {
    projectDir,
    pageCount: pages.length
  })
}

const assertImportedSessionReady = async (
  ctx: IpcContext,
  args: { sessionId: string; projectDir: string; pageCount: number }
): Promise<void> => {
  log.info('[session-import] final validation start', {
    sessionId: args.sessionId,
    projectDir: args.projectDir,
    pageCount: args.pageCount
  })
  const session = await ctx.db.getSession(args.sessionId)
  const project = await ctx.db.getProject(args.sessionId)
  const pages = await ctx.db.listSessionPages(args.sessionId)
  const run = await ctx.db.getLatestGenerationRun(args.sessionId)
  const history = await ctx.db.listSessionOperations(args.sessionId, { limit: 1 })
  const currentCommit = typeof session?.currentCommit === 'string' ? session.currentCommit : ''
  if (session?.status !== 'completed') throw new Error('导入校验失败：会话状态未完成。')
  if (path.resolve(project?.root_path || '') !== path.resolve(args.projectDir)) {
    throw new Error('导入校验失败：项目目录未正确写入。')
  }
  if (pages.length !== args.pageCount) throw new Error('导入校验失败：页面数量不一致。')
  if (!pages.every((page) => page.status === 'completed' && fs.existsSync(page.html_path))) {
    throw new Error('导入校验失败：页面文件不完整。')
  }
  if (run?.mode !== 'import' || run.status !== 'completed') {
    throw new Error('导入校验失败：导入运行记录不完整。')
  }
  if (history[0]?.type !== 'import' || !currentCommit) {
    throw new Error('导入校验失败：历史起点未正确创建。')
  }
  log.info('[session-import] final validation completed', {
    sessionId: args.sessionId,
    projectId: project?.id,
    runId: run.id,
    operationId: history[0]?.id,
    currentCommit
  })
}

export async function importSessionFile(
  ctx: IpcContext,
  sourcePath: string
): Promise<SessionFileImportResult> {
  const sourceStat = await fs.promises.stat(sourcePath)
  if (!sourceStat.isFile()) throw new Error('请选择一个会话导入文件。')
  if (sourceStat.size > MAX_IMPORT_FILE_BYTES) {
    throw new Error('导入文件不能超过 300MB。')
  }

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ohmyppt-session-import-'))
  const sessionId = crypto.randomUUID()
  const storagePath = await ctx.resolveStoragePath()
  const projectDir = path.join(storagePath, sessionId)
  const originalFileName = path.basename(sourcePath)
  const fallbackTitle = sanitizeTitle(path.basename(originalFileName, path.extname(originalFileName)), '导入的会话')

  log.info('[session-import] import start', {
    sessionId,
    sourcePath,
    originalFileName,
    sourceBytes: sourceStat.size,
    tempDir,
    projectDir
  })

  try {
    const sourceBuffer = await fs.promises.readFile(sourcePath)
    const prepared = await prepareImportSource(sourceBuffer, tempDir)
    log.info('[session-import] source prepared', {
      sessionId,
      importKind: prepared.importKind,
      sessionRoot: prepared.sessionRoot,
      warningCount: prepared.warnings.length
    })
    const sourcePages = await validateSessionRoot(prepared.sessionRoot)
    const title = await readTitleFromIndex(path.join(prepared.sessionRoot, 'index.html'), fallbackTitle)
    log.info('[session-import] title resolved', {
      sessionId,
      title,
      fallbackTitle
    })

    await copyDirectory(prepared.sessionRoot, projectDir)
    await ctx.ensureSessionAssets(projectDir)
    await createSessionMasterIfMissing(projectDir)
    await fs.promises.rm(path.join(projectDir, '.git'), { recursive: true, force: true })
    log.info('[session-import] project files ready', {
      sessionId,
      projectDir,
      removedGitDir: true
    })

    const importedPages = buildImportedPages(projectDir, sourcePages)
    const sourceSizeHtml = await fs.promises
      .readFile(path.join(projectDir, 'index.html'), 'utf-8')
      .catch(async () =>
        importedPages[0]
          ? fs.promises.readFile(importedPages[0].htmlPath, 'utf-8').catch(() => '')
          : ''
      )
    const slideSize = requireSlideSizeFromHtml(sourceSizeHtml)
    await rewriteIndexHtml(projectDir, title, importedPages, slideSize)
    const styleId = resolveUsableStyleId()

    const metadata: Record<string, unknown> = {
      source: 'session-file-import',
      importedAt: Date.now(),
      originalFileName,
      importKind: prepared.importKind,
      entryMode: 'multi_page',
      indexPath: path.join(projectDir, 'index.html'),
      warnings: prepared.warnings
    }

    log.info('[session-import] db write start', {
      sessionId,
      title,
      pageCount: importedPages.length,
      slideSizeId: slideSize.id,
      slideWidth: slideSize.width,
      slideHeight: slideSize.height,
      importKind: prepared.importKind
    })
    await ctx.db.createSession({
      id: sessionId,
      title,
      topic: title,
      styleId,
      pageCount: importedPages.length,
      slideSizeId: slideSize.id,
      slideWidth: slideSize.width,
      slideHeight: slideSize.height,
      visualEnabled: false,
      imageModelConfigId: null,
      provider: 'import',
      model: 'session-file-import'
    })
    await ctx.db.updateSessionDesignContract(sessionId, createDefaultDesignContract())
    const projectId = await ctx.db.createProject({
      session_id: sessionId,
      title,
      output_path: projectDir,
      root_path: projectDir
    })
    metadata.projectId = projectId
    log.info('[session-import] project row created', {
      sessionId,
      projectId,
      projectDir
    })
    const runId = await ctx.db.createGenerationRun({
      sessionId,
      mode: 'import',
      totalPages: importedPages.length,
      metadata: {
        source: 'session-file-import',
        originalFileName,
        importKind: prepared.importKind
      }
    })
    log.info('[session-import] generation run created', {
      sessionId,
      runId,
      pageCount: importedPages.length
    })

    for (const page of importedPages) {
      log.info('[session-import] upsert page', {
        sessionId,
        runId,
        pageNumber: page.pageNumber,
        fileSlug: page.fileSlug,
        entityId: page.entityId,
        htmlPath: page.htmlPath
      })
      await ctx.db.upsertGenerationPage({
        runId,
        sessionId,
        pageId: page.fileSlug,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: '',
        layoutIntent: null,
        htmlPath: page.htmlPath,
        status: 'completed'
      })
      await ctx.db.upsertSessionPage({
        id: page.entityId,
        sessionId,
        legacyPageId: page.legacyPageId,
        fileSlug: page.fileSlug,
        pageNumber: page.pageNumber,
        title: page.title,
        htmlPath: page.htmlPath,
        status: 'completed',
        error: null
      })
    }

    await ctx.db.updateGenerationRunStatus(runId, 'completed')
    await ctx.db.updateSessionMetadata(sessionId, metadata)
    await ctx.db.updateProjectStatus(projectId, 'draft')
    await ctx.db.updateSessionStatus(sessionId, 'completed')
    log.info('[session-import] db write completed', {
      sessionId,
      projectId,
      runId
    })

    log.info('[session-import] history baseline start', {
      sessionId,
      projectDir,
      runId
    })
    await recordHistoryOperationStrict(ctx.db, {
      sessionId,
      projectDir,
      type: 'import',
      scope: 'session',
      prompt: `导入会话文件：${originalFileName}`,
      metadata: {
        runId,
        source: 'session-file-import',
        importKind: prepared.importKind,
        originalFileName,
        pageCount: importedPages.length,
        sessionMetadata: metadata
      }
    })
    log.info('[session-import] history baseline completed', {
      sessionId,
      projectDir
    })

    await assertImportedSessionReady(ctx, {
      sessionId,
      projectDir,
      pageCount: importedPages.length
    })

    log.info('[session-import] completed', {
      sessionId,
      projectDir,
      pageCount: importedPages.length,
      originalFileName,
      importKind: prepared.importKind
    })

    return {
      success: true,
      cancelled: false,
      sessionId,
      title,
      pageCount: importedPages.length,
      warnings: prepared.warnings
    }
  } catch (error) {
    log.error('[session-import] import failed', {
      sessionId,
      sourcePath,
      projectDir,
      message: error instanceof Error ? error.message : String(error)
    })
    await ctx.db.deleteSession(sessionId).catch((cleanupError) => {
      log.warn('[session-import] cleanup db failed', {
        sessionId,
        message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      })
    })
    await fs.promises.rm(projectDir, { recursive: true, force: true }).catch((cleanupError) => {
      log.warn('[session-import] cleanup project dir failed', {
        sessionId,
        projectDir,
        message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      })
    })
    throw error
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch((cleanupError) => {
      log.warn('[session-import] cleanup temp dir failed', {
        sessionId,
        tempDir,
        message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
      })
    })
    log.info('[session-import] import finished', {
      sessionId,
      tempDir
    })
  }
}
