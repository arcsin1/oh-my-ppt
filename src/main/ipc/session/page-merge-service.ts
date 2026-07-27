import fs from 'fs'
import path from 'path'
import log from 'electron-log/main.js'
import { customAlphabet, nanoid } from 'nanoid'
import type { IpcContext } from '../context'
import type { SourcePageSkeletonRecord } from '../../db/database'
import { SESSION_ASSET_FILE_NAMES } from '../engine/template'
import { validatePersistedPageHtml } from '../../tools/html-utils'
import {
  ensureHistoryBaselineSafe,
  recordHistoryOperationStrict
} from '../../history/git-history-service'
import {
  loadEditableSessionPages,
  persistManagedPages,
  type ManagedPage
} from './page-management-service'
import {
  collectMergedPageResourceKeys,
  collectUnsafeMergedPageResourceReferences,
  extractMergePageFontProfile,
  isMergePathInside,
  resolveMergeFileInside,
  rewriteMergedPageHtml,
  type MergePageFontProfile
} from './page-merge-rewriter'
import { mapPageMergeConcurrent } from './page-merge-concurrency'
import { buildFontHeadTags } from '../../tools/font-registry'
import { normalizeDesignContract } from '../../utils/design-contract'
import { PageMergeError, type PageMergeDisabledReason } from '../../../shared/page-merge'
import {
  requireSessionSlideSize,
  requireSlideSize,
  type SlideSizePresetId
} from '@shared/slide-size'
import { CORPORATE_TEMPLATE_ID } from '@shared/brand'
import { listTemplates, loadTemplateManifest } from '../templates/template-service'
import { resolveTemplateRelativePath } from '../templates/template-paths'

export const MAX_MERGE_PAGE_COUNT = 50
const pageSlugId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)
const SHARED_RUNTIME_ASSETS = new Set(
  SESSION_ASSET_FILE_NAMES.map((item) => item.replace(/^\.\//, '').replace(/\\/g, '/'))
)
const FONT_RESOURCE_EXTENSIONS = new Set(['.woff', '.woff2', '.ttf', '.otf', '.eot'])

export interface MergeSourceSessionSummary {
  id: string
  title: string
  pageCount: number
  slideSizeId: SlideSizePresetId
  slideWidth: number
  slideHeight: number
  updatedAt: number
  status: string
  selectable: boolean
  disabledReason?: PageMergeDisabledReason
}

export interface MergeSourcePageSummary {
  id: string
  pageId: string
  pageNumber: number
  title: string
  contentOutline?: string | null
  slideSizeId: SlideSizePresetId
  slideWidth: number
  slideHeight: number
  htmlPath?: string
  sourceUrl?: string
  status?: string
  selectable: boolean
  disabledReason?: PageMergeDisabledReason
}

interface PreparedMergedPage {
  page: ManagedPage
  sourceSkeleton?: SourcePageSkeletonRecord
  targetSourceDocumentPath?: string
}

interface PageMergeLogContext {
  batchId: string
  targetSessionId: string
  sourceSessionId: string
  sourceType?: string
}

const mergeLog = (
  level: 'info' | 'warn' | 'error',
  stage: string,
  context: PageMergeLogContext,
  details: Record<string, unknown> = {}
): void => {
  log[level]('[page-merge]', { stage, ...context, ...details })
}

const runMergeRollbackStep = async (
  stage: string,
  context: PageMergeLogContext,
  task: () => Promise<unknown>
): Promise<void> => {
  const startedAt = Date.now()
  mergeLog('info', `rollback:${stage}:start`, context)
  try {
    await task()
    mergeLog('info', `rollback:${stage}:completed`, context, {
      durationMs: Date.now() - startedAt
    })
  } catch (error) {
    mergeLog('warn', `rollback:${stage}:failed`, context, {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

const shouldKeepTargetRuntimeAsset = (resourceKey: string): boolean => {
  if (!resourceKey.startsWith('assets/')) return false
  const assetRelative = resourceKey.slice('assets/'.length)
  return SHARED_RUNTIME_ASSETS.has(assetRelative)
}

const collectCssDependencyKeys = (css: string, cssResourceKey: string): string[] => {
  const keys = new Set<string>()
  const baseDir = path.posix.dirname(cssResourceKey)
  css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _quote, rawUrl: string) => {
    const trimmed = rawUrl.trim()
    if (
      !trimmed ||
      trimmed.startsWith('#') ||
      trimmed.startsWith('/') ||
      /^(?:data|blob|https?|local-asset):/i.test(trimmed)
    ) {
      return full
    }
    const pathname = trimmed.split(/[?#]/, 1)[0].replace(/\\/g, '/')
    const normalized = path.posix.normalize(path.posix.join(baseDir, pathname))
    if (normalized && !normalized.startsWith('../')) keys.add(normalized)
    return full
  })
  css.replace(/@import\s+(['"])([^'"]+)\1/gi, (full, _quote, rawUrl: string) => {
    const trimmed = rawUrl.trim()
    if (
      !trimmed ||
      trimmed.startsWith('/') ||
      /^(?:data|blob|https?|local-asset):/i.test(trimmed)
    ) {
      return full
    }
    const pathname = trimmed.split(/[?#]/, 1)[0].replace(/\\/g, '/')
    const normalized = path.posix.normalize(path.posix.join(baseDir, pathname))
    if (normalized && !normalized.startsWith('../')) keys.add(normalized)
    return full
  })
  return Array.from(keys)
}

const escapeCssRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const sanitizeMergedStylesheet = (css: string, targetBodyFont: string): string => {
  const sourceFontFamilies = new Set<string>()
  css.replace(/@font-face\s*\{([^{}]*)\}/gi, (_full, body: string) => {
    const family = body.match(/font-family\s*:\s*(["']?)([^;"'}]+)\1\s*;/i)?.[2]?.trim()
    if (family) sourceFontFamilies.add(family)
    return ''
  })
  let sanitized = css.replace(/@font-face\s*\{[^{}]*\}/gi, '')
  for (const family of sourceFontFamilies) {
    const escaped = escapeCssRegExp(family)
    sanitized = sanitized.replace(
      new RegExp(`(["'])${escaped}\\1`, 'gi'),
      (_match, quote: string) => `${quote}${targetBodyFont}${quote}`
    )
    sanitized = sanitized.replace(
      new RegExp(`(font-family\\s*:\\s*)${escaped}(?=\\s*(?:[,;}]))`, 'gi'),
      `$1${targetBodyFont}`
    )
  }
  return sanitized
}

const copyPageResources = async (args: {
  html: string
  sourceProjectDir: string
  tempProjectDir: string
  batchId: string
  nextPageId: string
  targetBodyFont: string
  preserveFonts?: boolean
}): Promise<Map<string, string>> => {
  const unsafeReferences = collectUnsafeMergedPageResourceReferences(args.html)
  if (unsafeReferences.length > 0) {
    throw new PageMergeError(
      'PAGE_MERGE_PAGE_COPY_FAILED',
      `页面包含越界资源路径: ${unsafeReferences.join(', ')}`
    )
  }
  const resourcePathMap = new Map<string, string>()
  const pendingResourceKeys = [...collectMergedPageResourceKeys(args.html)]
  const copiedResourceKeys = new Set<string>()
  while (pendingResourceKeys.length > 0) {
    const resourceKey = pendingResourceKeys.shift()!
    if (copiedResourceKeys.has(resourceKey)) continue
    copiedResourceKeys.add(resourceKey)
    if (shouldKeepTargetRuntimeAsset(resourceKey)) continue
    if (!args.preserveFonts && resourceKey.startsWith('assets/fonts/')) continue
    if (
      !args.preserveFonts &&
      FONT_RESOURCE_EXTENSIONS.has(path.extname(resourceKey).toLowerCase())
    )
      continue
    const sourcePath = await resolveMergeFileInside(
      path.resolve(args.sourceProjectDir, resourceKey),
      args.sourceProjectDir
    )
    if (!sourcePath) {
      throw new PageMergeError('PAGE_MERGE_PAGE_COPY_FAILED', `页面资源不存在: ${resourceKey}`)
    }
    const stat = await fs.promises.stat(sourcePath)
    if (!stat.isFile()) continue
    const targetRelative = path.posix.join(
      'assets',
      'merged-pages',
      args.batchId,
      args.nextPageId,
      resourceKey
    )
    const tempTargetPath = path.join(args.tempProjectDir, ...targetRelative.split('/'))
    await fs.promises.mkdir(path.dirname(tempTargetPath), { recursive: true })
    if (path.extname(resourceKey).toLowerCase() === '.css') {
      const css = await fs.promises.readFile(sourcePath, 'utf-8')
      await fs.promises.writeFile(
        tempTargetPath,
        args.preserveFonts ? css : sanitizeMergedStylesheet(css, args.targetBodyFont),
        'utf-8'
      )
      pendingResourceKeys.push(...collectCssDependencyKeys(css, resourceKey))
    } else {
      await fs.promises.copyFile(sourcePath, tempTargetPath)
    }
    resourcePathMap.set(resourceKey, `./${targetRelative}`)
  }
  return resourcePathMap
}

const prepareSourceDocument = async (args: {
  skeleton?: SourcePageSkeletonRecord
  sourceProjectDir: string
  tempProjectDir: string
  batchId: string
  nextPageId: string
}): Promise<string | undefined> => {
  const sourceDocumentPath = args.skeleton?.source_document_path?.trim()
  if (!sourceDocumentPath) return undefined
  const relative = sourceDocumentPath.replace(/^\/?docs\//, '')
  if (relative === sourceDocumentPath || !relative || relative.startsWith('../')) {
    return sourceDocumentPath
  }
  const sourcePath = await resolveMergeFileInside(
    path.resolve(args.sourceProjectDir, 'docs', relative),
    path.join(args.sourceProjectDir, 'docs')
  )
  if (!sourcePath) {
    return `merged-session:${args.batchId}`
  }
  const targetRelative = path.posix.join(
    'docs',
    'merged-pages',
    args.batchId,
    args.nextPageId,
    path.posix.basename(relative.replace(/\\/g, '/'))
  )
  const tempTargetPath = path.join(args.tempProjectDir, ...targetRelative.split('/'))
  await fs.promises.mkdir(path.dirname(tempTargetPath), { recursive: true })
  await fs.promises.copyFile(sourcePath, tempTargetPath)
  return `/${targetRelative}`
}

const movePreparedEntries = async (
  tempProjectDir: string,
  targetProjectDir: string,
  movedTargetFontFiles: string[],
  relativeDir = ''
): Promise<void> => {
  const entries = await fs.promises.readdir(tempProjectDir, { withFileTypes: true })
  for (const entry of entries) {
    const source = path.join(tempProjectDir, entry.name)
    const target = path.join(targetProjectDir, entry.name)
    const relativePath = path.posix.join(relativeDir, entry.name)
    if (entry.isDirectory()) {
      await fs.promises.mkdir(target, { recursive: true })
      await movePreparedEntries(source, target, movedTargetFontFiles, relativePath)
      continue
    }
    const targetExisted = fs.existsSync(target)
    if (targetExisted && relativePath.startsWith('assets/fonts/')) {
      await fs.promises.rm(source, { force: true })
      continue
    }
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.rename(source, target)
    if (!targetExisted && relativePath.startsWith('assets/fonts/')) {
      movedTargetFontFiles.push(target)
    }
  }
}

const resolveTargetFontProfile = async (args: {
  pages: ManagedPage[]
  fontProjectDir: string
  designContract: unknown
}): Promise<{ profile: MergePageFontProfile; source: 'target-page' | 'design-contract' }> => {
  for (const page of args.pages) {
    if (page.status !== 'completed' || !fs.existsSync(page.htmlPath)) continue
    const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
    const profile = extractMergePageFontProfile(html)
    if (profile) return { profile, source: 'target-page' }
  }

  const designContract = normalizeDesignContract(args.designContract)
  const headTags = await buildFontHeadTags({
    titleFont: designContract.titleFont,
    bodyFont: designContract.bodyFont,
    projectDir: args.fontProjectDir
  })
  const profile = extractMergePageFontProfile(`<html><head>${headTags}</head><body></body></html>`)
  if (!profile) {
    throw new PageMergeError('PAGE_MERGE_TARGET_FONT_UNAVAILABLE', '无法读取当前模板字体配置')
  }
  return { profile, source: 'design-contract' }
}

const toGeneratedPages = (
  ctx: IpcContext,
  pages: ManagedPage[]
): Array<{
  id: string
  pageNumber: number
  pageId: string
  title: string
  contentOutline?: string | null
  html: string
  htmlPath: string
  sourceUrl?: string
  status?: string
  error?: string | null
}> =>
  pages.map((page) => ({
    id: page.id,
    pageNumber: page.pageNumber,
    pageId: page.pageId,
    title: page.title,
    contentOutline: page.contentOutline?.trim() || null,
    html: '',
    htmlPath: page.htmlPath,
    sourceUrl: ctx.getPageSourceUrl(page.htmlPath),
    status: page.status,
    error: page.error
  }))

export async function listMergeSourceSessions(
  ctx: IpcContext,
  targetSessionId: string
): Promise<MergeSourceSessionSummary[]> {
  const [sessions, targetSession] = await Promise.all([
    ctx.db.listSessionsWithPageCounts(500),
    ctx.db.getSession(targetSessionId)
  ])
  const targetSlideSize = requireSessionSlideSize(targetSession)
  return sessions
    .filter(({ session }) => session.id !== targetSessionId)
    .map(({ session, pageCount }) => {
      const runState = ctx.sessionRunStates.get(session.id)
      const running =
        session.status === 'active' ||
        runState?.status === 'queued' ||
        runState?.status === 'running'
      const sourceSlideSize = requireSessionSlideSize(session)
      const sizeMatches =
        sourceSlideSize.width === targetSlideSize.width &&
        sourceSlideSize.height === targetSlideSize.height
      const selectable = pageCount > 0 && !running && sizeMatches
      return {
        id: session.id,
        title: session.title || '',
        pageCount,
        slideSizeId: sourceSlideSize.id,
        slideWidth: sourceSlideSize.width,
        slideHeight: sourceSlideSize.height,
        updatedAt: session.updated_at,
        status: session.status,
        selectable,
        disabledReason: running
          ? 'PAGE_MERGE_SESSION_BUSY'
          : pageCount === 0
            ? 'PAGE_MERGE_SESSION_EMPTY'
            : !sizeMatches
              ? 'PAGE_MERGE_SLIDE_SIZE_MISMATCH'
            : undefined
      }
    })
}

export async function listMergeSourcePages(
  ctx: IpcContext,
  sourceSessionId: string
): Promise<MergeSourcePageSummary[]> {
  const { session, pages, projectDir } = await loadEditableSessionPages(ctx, sourceSessionId)
  const slideSize = requireSessionSlideSize(session)
  return Promise.all(
    pages.map(async (page) => {
      const safeHtmlPath = await resolveMergeFileInside(page.htmlPath, projectDir)
      const selectable = page.status === 'completed' && Boolean(safeHtmlPath)
      return {
        id: page.id,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: page.contentOutline?.trim() || null,
        slideSizeId: slideSize.id,
        slideWidth: slideSize.width,
        slideHeight: slideSize.height,
        htmlPath: safeHtmlPath || undefined,
        sourceUrl: safeHtmlPath ? ctx.getPageSourceUrl(safeHtmlPath) : undefined,
        status: page.status,
        selectable,
        disabledReason:
          page.status !== 'completed'
            ? 'PAGE_MERGE_PAGE_INCOMPLETE'
            : !safeHtmlPath
              ? 'PAGE_MERGE_PAGE_FILE_MISSING'
              : undefined
      }
    })
  )
}

export interface MergeTemplateSourceSummary {
  id: string
  title: string
  pageCount: number
  slideSizeId: SlideSizePresetId
  slideWidth: number
  slideHeight: number
  updatedAt: number
  thumbnailPath: string | null
  selectable: boolean
  disabledReason?: PageMergeDisabledReason
  isSource: boolean
}

export async function listMergeSourceTemplates(
  ctx: IpcContext,
  targetSessionId: string
): Promise<MergeTemplateSourceSummary[]> {
  const targetSession = await ctx.db.getSession(targetSessionId)
  if (!targetSession) return []
  const targetSlideSize = requireSessionSlideSize(targetSession)
  let sourceTemplateId = ''
  try {
    const meta = JSON.parse(targetSession.metadata || '{}') as Record<string, unknown>
    sourceTemplateId = typeof meta.templateId === 'string' ? meta.templateId.trim() : ''
  } catch {
    sourceTemplateId = ''
  }
  const { items } = await listTemplates()
  const summaries: MergeTemplateSourceSummary[] = items
    .filter((item) => item.id === CORPORATE_TEMPLATE_ID)
    .map((item) => {
      const sizeMatches =
        item.slideWidth === targetSlideSize.width && item.slideHeight === targetSlideSize.height
      const hasPages = item.previewPages.length > 0
      return {
        id: item.id,
        title: item.name,
        pageCount: item.pageCount,
        slideSizeId: item.slideSizeId,
        slideWidth: item.slideWidth,
        slideHeight: item.slideHeight,
        updatedAt: item.updatedAt,
        thumbnailPath: item.thumbnailPath,
        selectable: sizeMatches && hasPages,
        disabledReason: !sizeMatches
          ? ('PAGE_MERGE_SLIDE_SIZE_MISMATCH' as PageMergeDisabledReason)
          : !hasPages
            ? ('PAGE_MERGE_SESSION_EMPTY' as PageMergeDisabledReason)
            : undefined,
        isSource: Boolean(sourceTemplateId) && item.id === sourceTemplateId
      }
    })
  return summaries.sort((a, b) => {
    if (a.isSource !== b.isSource) return a.isSource ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
}

export async function listMergeSourceTemplatePages(
  ctx: IpcContext,
  targetSessionId: string,
  templateId: string
): Promise<MergeSourcePageSummary[]> {
  if (templateId !== CORPORATE_TEMPLATE_ID) {
    throw new PageMergeError('PAGE_MERGE_SESSION_NOT_FOUND', '内部版仅允许使用公司标准模板')
  }
  const targetSession = await ctx.db.getSession(targetSessionId)
  if (!targetSession) {
    throw new PageMergeError('PAGE_MERGE_SESSION_NOT_FOUND', '当前会话不存在')
  }
  const targetSlideSize = requireSessionSlideSize(targetSession)
  const loaded = await loadTemplateManifest(templateId).catch(() => {
    throw new PageMergeError('PAGE_MERGE_SESSION_NOT_FOUND', '模板不存在')
  })
  const { manifest, templateDir } = loaded
  const slideSize = requireSlideSize({
    id: manifest.slideSizeId,
    width: manifest.slideWidth,
    height: manifest.slideHeight
  })
  if (slideSize.width !== targetSlideSize.width || slideSize.height !== targetSlideSize.height) {
    throw new PageMergeError(
      'PAGE_MERGE_SLIDE_SIZE_MISMATCH',
      '模板与当前会话的画布尺寸不同，不能添加页面'
    )
  }
  return Promise.all(
    manifest.pages.map(async (page) => {
      const htmlPath = resolveTemplateRelativePath(templateDir, page.htmlPath)
      const safeHtmlPath =
        htmlPath && fs.existsSync(htmlPath)
          ? await resolveMergeFileInside(htmlPath, templateDir)
          : null
      const selectable = Boolean(safeHtmlPath)
      return {
        id: `${manifest.id}:${page.pageNumber}`,
        pageId: page.pageId,
        pageNumber: page.pageNumber,
        title: page.title,
        contentOutline: null,
        slideSizeId: slideSize.id,
        slideWidth: slideSize.width,
        slideHeight: slideSize.height,
        htmlPath: safeHtmlPath || undefined,
        sourceUrl: safeHtmlPath ? ctx.getPageSourceUrl(safeHtmlPath) : undefined,
        status: 'completed',
        selectable,
        disabledReason: !selectable
          ? ('PAGE_MERGE_PAGE_FILE_MISSING' as PageMergeDisabledReason)
          : undefined
      }
    })
  )
}

interface MergeSourceData {
  selectedSourcePages: ManagedPage[]
  sourcePageHtmlPaths: Map<string, string>
  sourceProjectDir: string
  sourceTitle: string
  skeletonByPageNumber: Map<number, SourcePageSkeletonRecord>
  sourcePageCount: number
  preserveFonts: boolean
}

async function loadMergeSource(
  ctx: IpcContext,
  args: {
    sourceType: 'session' | 'template'
    sourceId: string
    targetSlideSize: { width: number; height: number }
    sourcePageIds: string[]
  }
): Promise<MergeSourceData> {
  if (args.sourceType === 'template') {
    return loadTemplateMergeSource(args.sourceId, args.targetSlideSize, args.sourcePageIds)
  }
  return loadSessionMergeSource(ctx, args.sourceId, args.targetSlideSize, args.sourcePageIds)
}

async function loadSessionMergeSource(
  ctx: IpcContext,
  sourceSessionId: string,
  targetSlideSize: { width: number; height: number },
  sourcePageIds: string[]
): Promise<MergeSourceData> {
  const sourceSession = await ctx.db.getSession(sourceSessionId)
  if (!sourceSession) {
    throw new PageMergeError('PAGE_MERGE_SESSION_NOT_FOUND', '源会话不存在')
  }
  const runState = ctx.sessionRunStates.get(sourceSessionId)
  if (
    sourceSession.status === 'active' ||
    runState?.status === 'queued' ||
    runState?.status === 'running'
  ) {
    throw new PageMergeError('PAGE_MERGE_SESSION_BUSY', '源会话正在生成，暂时不能添加页面')
  }
  const sourceSlideSize = requireSessionSlideSize(sourceSession)
  if (
    sourceSlideSize.width !== targetSlideSize.width ||
    sourceSlideSize.height !== targetSlideSize.height
  ) {
    throw new PageMergeError(
      'PAGE_MERGE_SLIDE_SIZE_MISMATCH',
      '源会话与当前会话的画布尺寸不同，不能混合添加页面'
    )
  }
  const sourceData = await loadEditableSessionPages(ctx, sourceSessionId)
  const sourcePageMap = new Map(sourceData.pages.map((page) => [page.id, page]))
  const sourcePageHtmlPaths = new Map<string, string>()
  const selectedSourcePages = sourcePageIds.map((id) => {
    const page = sourcePageMap.get(id)
    if (!page) {
      throw new PageMergeError('PAGE_MERGE_SOURCE_PAGE_NOT_FOUND', `源页面不存在: ${id}`)
    }
    if (page.status !== 'completed') {
      throw new PageMergeError(
        'PAGE_MERGE_SOURCE_PAGE_UNAVAILABLE',
        `页面尚未生成完成: ${page.title}`
      )
    }
    const safeHtmlPath = fs.existsSync(page.htmlPath)
      ? fs.realpathSync.native(page.htmlPath)
      : null
    if (
      !safeHtmlPath ||
      !isMergePathInside(safeHtmlPath, fs.realpathSync.native(sourceData.projectDir))
    ) {
      throw new PageMergeError(
        'PAGE_MERGE_SOURCE_PAGE_UNAVAILABLE',
        `页面文件不存在: ${page.title}`
      )
    }
    sourcePageHtmlPaths.set(page.id, safeHtmlPath)
    return page
  })
  selectedSourcePages.sort((left, right) => left.pageNumber - right.pageNumber)
  const sourceSkeletons = await ctx.db.listSourcePageSkeletons(sourceSessionId)
  return {
    selectedSourcePages,
    sourcePageHtmlPaths,
    sourceProjectDir: sourceData.projectDir,
    sourceTitle: String(sourceData.deckTitle || ''),
    skeletonByPageNumber: new Map(sourceSkeletons.map((item) => [item.page_number, item])),
    sourcePageCount: sourceData.pages.length,
    preserveFonts: false
  }
}

async function loadTemplateMergeSource(
  templateId: string,
  targetSlideSize: { width: number; height: number },
  sourcePageIds: string[]
): Promise<MergeSourceData> {
  if (templateId !== CORPORATE_TEMPLATE_ID) {
    throw new PageMergeError('PAGE_MERGE_SESSION_NOT_FOUND', '内部版仅允许使用公司标准模板')
  }
  const loaded = await loadTemplateManifest(templateId).catch(() => {
    throw new PageMergeError('PAGE_MERGE_SESSION_NOT_FOUND', '模板不存在')
  })
  const { manifest, templateDir } = loaded
  const sourceSlideSize = requireSlideSize({
    id: manifest.slideSizeId,
    width: manifest.slideWidth,
    height: manifest.slideHeight
  })
  if (
    sourceSlideSize.width !== targetSlideSize.width ||
    sourceSlideSize.height !== targetSlideSize.height
  ) {
    throw new PageMergeError(
      'PAGE_MERGE_SLIDE_SIZE_MISMATCH',
      '模板与当前会话的画布尺寸不同，不能添加页面'
    )
  }
  const sortedPages = manifest.pages.slice().sort((a, b) => a.pageNumber - b.pageNumber)
  const sourcePages: ManagedPage[] = sortedPages.map((page) => {
    const resolved = resolveTemplateRelativePath(templateDir, page.htmlPath)
    return {
      id: `${manifest.id}:${page.pageNumber}`,
      pageNumber: page.pageNumber,
      pageId: page.pageId,
      title: page.title,
      contentOutline: null,
      htmlPath: resolved || path.join(templateDir, page.htmlPath),
      status: 'completed' as const,
      error: null
    }
  })
  const sourcePageMap = new Map(sourcePages.map((page) => [page.id, page]))
  const sourcePageHtmlPaths = new Map<string, string>()
  const realTemplateDir = fs.realpathSync.native(templateDir)
  const selectedSourcePages = sourcePageIds.map((id) => {
    const page = sourcePageMap.get(id)
    if (!page) {
      throw new PageMergeError('PAGE_MERGE_SOURCE_PAGE_NOT_FOUND', `模板页面不存在: ${id}`)
    }
    const safeHtmlPath = fs.existsSync(page.htmlPath)
      ? fs.realpathSync.native(page.htmlPath)
      : null
    if (!safeHtmlPath || !isMergePathInside(safeHtmlPath, realTemplateDir)) {
      throw new PageMergeError(
        'PAGE_MERGE_SOURCE_PAGE_UNAVAILABLE',
        `模板页面文件不存在: ${page.title}`
      )
    }
    sourcePageHtmlPaths.set(page.id, safeHtmlPath)
    return page
  })
  selectedSourcePages.sort((left, right) => left.pageNumber - right.pageNumber)
  return {
    selectedSourcePages,
    sourcePageHtmlPaths,
    sourceProjectDir: templateDir,
    sourceTitle: manifest.name,
    skeletonByPageNumber: new Map(),
    sourcePageCount: sourcePages.length,
    preserveFonts: true
  }
}

export async function mergeSessionPages(
  ctx: IpcContext,
  args: {
    targetSessionId: string
    sourceType?: 'session' | 'template'
    sourceSessionId?: string
    sourceTemplateId?: string
    sourcePageIds: string[]
  }
): Promise<{
  generatedPages: ReturnType<typeof toGeneratedPages>
  insertedPageIds: string[]
  selectedPageId: string
}> {
  const startedAt = Date.now()
  const batchId = `mg_${nanoid(10)}`
  const sourceType = args.sourceType ?? 'session'
  const sourceId = sourceType === 'template' ? args.sourceTemplateId : args.sourceSessionId
  const logContext: PageMergeLogContext = {
    batchId,
    targetSessionId: args.targetSessionId,
    sourceSessionId: sourceId || '',
    sourceType
  }
  let stage = 'validate-request'
  mergeLog('info', 'request:start', logContext, { requestedPageCount: args.sourcePageIds.length })
  if (!sourceId) {
    throw new PageMergeError('PAGE_MERGE_INVALID_REQUEST', '缺少来源标识')
  }
  if (sourceType === 'session' && args.targetSessionId === sourceId) {
    throw new PageMergeError('PAGE_MERGE_SAME_SESSION', '不能从当前会话添加页面')
  }
  const uniquePageIds = Array.from(
    new Set(args.sourcePageIds.map((item) => item.trim()).filter(Boolean))
  )
  if (uniquePageIds.length === 0) {
    throw new PageMergeError('PAGE_MERGE_NO_PAGE_SELECTED', '请选择要添加的页面')
  }
  if (uniquePageIds.length !== args.sourcePageIds.length) {
    throw new PageMergeError('PAGE_MERGE_INVALID_REQUEST', '页面列表包含重复项')
  }
  if (uniquePageIds.length > MAX_MERGE_PAGE_COUNT) {
    throw new PageMergeError(
      'PAGE_MERGE_PAGE_LIMIT_EXCEEDED',
      `一次最多添加 ${MAX_MERGE_PAGE_COUNT} 页`
    )
  }

  stage = 'load-target'
  const targetSession = await ctx.db.getSession(args.targetSessionId)
  if (!targetSession) {
    throw new PageMergeError('PAGE_MERGE_SESSION_NOT_FOUND', '当前会话不存在')
  }
  const targetSlideSize = requireSessionSlideSize(targetSession)
  const targetRunState = ctx.sessionRunStates.get(args.targetSessionId)
  if (
    targetSession.status === 'active' ||
    targetRunState?.status === 'queued' ||
    targetRunState?.status === 'running'
  ) {
    throw new PageMergeError('PAGE_MERGE_SESSION_BUSY', '当前会话正在生成，暂时不能添加页面')
  }
  const targetData = await loadEditableSessionPages(ctx, args.targetSessionId)
  const targetProject = await ctx.db.getProject(args.targetSessionId)
  mergeLog('info', 'sessions:validated', logContext, {
    sourceType,
    targetStatus: targetSession.status
  })

  stage = 'load-source'
  const source = await loadMergeSource(ctx, {
    sourceType,
    sourceId,
    targetSlideSize,
    sourcePageIds: uniquePageIds
  })
  const {
    selectedSourcePages,
    sourcePageHtmlPaths,
    sourceProjectDir,
    sourceTitle,
    skeletonByPageNumber,
    preserveFonts
  } = source
  mergeLog('info', 'pages:selected', logContext, {
    sourcePageCount: source.sourcePageCount,
    targetPageCount: targetData.pages.length,
    selectedPageCount: selectedSourcePages.length,
    selectedPageNumbers: selectedSourcePages.map((page) => page.pageNumber)
  })
  const tempRoot = path.join(targetData.projectDir, '.merge-pages-tmp', batchId)
  await fs.promises.mkdir(tempRoot, { recursive: true })
  mergeLog('info', 'workspace:prepared', logContext, {
    sourceSkeletonCount: skeletonByPageNumber.size,
    tempRoot
  })
  let preparedPages: PreparedMergedPage[] = []
  let movedTargetFontFiles: string[] = []
  const insertedPageIds: string[] = []
  const insertedPageNumbers: number[] = []
  const previousIndex = fs.existsSync(targetData.indexPath)
    ? await fs.promises.readFile(targetData.indexPath)
    : null
  let previousMetadata: Record<string, unknown> = {}
  try {
    previousMetadata = JSON.parse(targetSession.metadata || '{}') as Record<string, unknown>
  } catch {
    previousMetadata = {}
  }

  try {
    stage = 'resolve-target-fonts'
    const targetFontResult = await resolveTargetFontProfile({
      pages: targetData.pages,
      fontProjectDir: tempRoot,
      designContract: targetSession.designContract
    })
    const targetFontProfile = targetFontResult.profile
    mergeLog('info', 'fonts:resolved', logContext, {
      source: targetFontResult.source,
      titleFont: targetFontProfile.titleFont,
      bodyFont: targetFontProfile.bodyFont
    })
    stage = 'prepare-pages'
    preparedPages = await mapPageMergeConcurrent(
      selectedSourcePages,
      async (sourcePage, sourceIndex) => {
        const pageStartedAt = Date.now()
        const nextPageId = `page-${pageSlugId()}`
        const nextEntityId = nanoid()
        const nextPageNumber = targetData.pages.length + sourceIndex + 1
        const sourceHtmlPath = sourcePageHtmlPaths.get(sourcePage.id)
        if (!sourceHtmlPath) {
          throw new PageMergeError(
            'PAGE_MERGE_SOURCE_PAGE_UNAVAILABLE',
            `页面文件不存在: ${sourcePage.title}`
          )
        }
        mergeLog('info', 'page:prepare:start', logContext, {
          sourcePageId: sourcePage.id,
          sourcePageNumber: sourcePage.pageNumber,
          targetPageId: nextPageId,
          targetPageNumber: nextPageNumber
        })
        const sourceHtml = await fs.promises.readFile(sourceHtmlPath, 'utf-8')
        const pageFontProfile = preserveFonts
          ? (extractMergePageFontProfile(sourceHtml) ?? targetFontProfile)
          : targetFontProfile
        const resourcePathMap = await copyPageResources({
          html: sourceHtml,
          sourceProjectDir,
          tempProjectDir: tempRoot,
          batchId,
          nextPageId,
          targetBodyFont: pageFontProfile.bodyFont,
          preserveFonts
        })
        const rewrittenHtml = rewriteMergedPageHtml({
          html: sourceHtml,
          oldPageId: sourcePage.pageId,
          nextPageId,
          resourcePathMap,
          targetFontProfile: pageFontProfile
        })
        const validation = validatePersistedPageHtml(rewrittenHtml, nextPageId)
        if (!validation.valid) {
          throw new PageMergeError(
            'PAGE_MERGE_PAGE_COPY_FAILED',
            `页面“${sourcePage.title}”复制失败: ${validation.errors.join('; ')}`
          )
        }
        const targetHtmlPath = path.join(targetData.projectDir, `${nextPageId}.html`)
        const tempHtmlPath = path.join(tempRoot, `${nextPageId}.html`)
        await fs.promises.writeFile(tempHtmlPath, rewrittenHtml, 'utf-8')
        const sourceSkeleton = skeletonByPageNumber.get(sourcePage.pageNumber)
        const targetSourceDocumentPath = await prepareSourceDocument({
          skeleton: sourceSkeleton,
          sourceProjectDir,
          tempProjectDir: tempRoot,
          batchId,
          nextPageId
        })
        mergeLog('info', 'page:prepare:completed', logContext, {
          sourcePageId: sourcePage.id,
          sourcePageNumber: sourcePage.pageNumber,
          targetPageId: nextPageId,
          targetPageNumber: nextPageNumber,
          copiedResourceCount: resourcePathMap.size,
          sourceDocumentCopied: Boolean(
            targetSourceDocumentPath?.startsWith('/docs/merged-pages/')
          ),
          durationMs: Date.now() - pageStartedAt
        })
        return {
          page: {
            id: nextEntityId,
            pageNumber: nextPageNumber,
            pageId: nextPageId,
            title: sourcePage.title,
            contentOutline: sourcePage.contentOutline,
            htmlPath: targetHtmlPath,
            html: rewrittenHtml,
            status: 'completed' as const,
            error: null
          },
          sourceSkeleton,
          targetSourceDocumentPath
        }
      }
    )
    mergeLog('info', 'pages:prepare:completed', logContext, {
      preparedPageCount: preparedPages.length
    })

    stage = 'ensure-history-baseline'
    mergeLog('info', 'history:baseline:start', logContext)
    await ensureHistoryBaselineSafe(ctx.db, args.targetSessionId, targetData.projectDir)
    mergeLog('info', 'history:baseline:completed', logContext)
    stage = 'commit-files'
    mergeLog('info', 'files:commit:start', logContext, {
      preparedPageCount: preparedPages.length
    })
    await movePreparedEntries(tempRoot, targetData.projectDir, movedTargetFontFiles)
    mergeLog('info', 'files:commit:completed', logContext, {
      createdTargetFontFileCount: movedTargetFontFiles.length
    })

    stage = 'write-page-records'
    for (const prepared of preparedPages) {
      await ctx.db.upsertSessionPage({
        id: prepared.page.id,
        sessionId: args.targetSessionId,
        legacyPageId: null,
        fileSlug: prepared.page.pageId,
        pageNumber: prepared.page.pageNumber,
        title: prepared.page.title,
        htmlPath: prepared.page.htmlPath,
        status: 'completed',
        error: null
      })
      insertedPageIds.push(prepared.page.id)
      insertedPageNumbers.push(prepared.page.pageNumber)
      if (prepared.sourceSkeleton?.source_heading.trim()) {
        await ctx.db.upsertSourcePageSkeleton({
          sessionId: args.targetSessionId,
          pageNumber: prepared.page.pageNumber,
          title: prepared.page.title,
          role: prepared.sourceSkeleton.role,
          sourceDocumentPath:
            prepared.targetSourceDocumentPath || `merged-session:${args.sourceSessionId}`,
          sourceDocumentName: prepared.sourceSkeleton.source_document_name,
          sourceHeading: prepared.sourceSkeleton.source_heading,
          headingLevel: prepared.sourceSkeleton.heading_level,
          lineStart: prepared.sourceSkeleton.line_start,
          lineEnd: prepared.sourceSkeleton.line_end,
          reason: prepared.sourceSkeleton.reason,
          confidence: prepared.sourceSkeleton.confidence
        })
      }
    }
    mergeLog('info', 'database:page-records:completed', logContext, {
      insertedPageCount: insertedPageIds.length,
      skeletonCount: preparedPages.filter((item) => item.sourceSkeleton?.source_heading.trim())
        .length
    })

    stage = 'persist-deck'
    const mergedPages = [...targetData.pages, ...preparedPages.map((item) => item.page)]
    const persistedPages = await persistManagedPages(ctx, {
      sessionId: args.targetSessionId,
      projectDir: targetData.projectDir,
      indexPath: targetData.indexPath,
      deckTitle: targetData.deckTitle,
      pages: mergedPages,
      operation: 'addPage',
      prompt: `从${sourceType === 'template' ? '模板' : '会话'}《${sourceTitle}》添加 ${preparedPages.length} 页`
    })
    if (targetProject?.id) await ctx.db.updateProjectStatus(targetProject.id, 'draft')
    await ctx.db.updateSessionStatus(args.targetSessionId, 'completed')
    mergeLog('info', 'deck:persisted', logContext, { totalPageCount: persistedPages.length })
    stage = 'record-history'
    mergeLog('info', 'history:commit:start', logContext)
    await recordHistoryOperationStrict(ctx.db, {
      sessionId: args.targetSessionId,
      type: 'addPage',
      scope: 'session',
      projectDir: targetData.projectDir,
      prompt: `从${sourceType === 'template' ? '模板' : '会话'}《${sourceTitle}》添加 ${preparedPages.length} 页`,
      metadata: {
        sourceType,
        sourceSessionId: sourceId,
        sourceSessionTitle: sourceTitle,
        sourcePageIds: selectedSourcePages.map((page) => page.id),
        sourcePageNumbers: selectedSourcePages.map((page) => page.pageNumber),
        insertedPageIds,
        insertedPageSlugs: preparedPages.map((item) => item.page.pageId),
        mergeBatchId: batchId,
        totalPages: persistedPages.length
      }
    })
    mergeLog('info', 'history:commit:completed', logContext)

    stage = 'completed'
    mergeLog('info', 'request:completed', logContext, {
      insertedPageCount: insertedPageIds.length,
      totalPageCount: persistedPages.length,
      durationMs: Date.now() - startedAt
    })
    return {
      generatedPages: toGeneratedPages(ctx, persistedPages),
      insertedPageIds,
      selectedPageId: insertedPageIds[0]
    }
  } catch (error) {
    mergeLog('error', 'request:failed', logContext, {
      failedStage: stage,
      durationMs: Date.now() - startedAt,
      code: error instanceof PageMergeError ? error.code : 'PAGE_MERGE_INTERNAL_ERROR',
      error: error instanceof Error ? error.message : String(error)
    })
    const rollbackContext = logContext
    mergeLog('warn', 'rollback:start', rollbackContext, {
      insertedPageCount: insertedPageIds.length,
      preparedPageCount: preparedPages.length
    })
    await runMergeRollbackStep('delete-session-pages', rollbackContext, () =>
      ctx.db.hardDeleteSessionPages(args.targetSessionId, insertedPageIds)
    )
    await runMergeRollbackStep('delete-source-skeletons', rollbackContext, () =>
      ctx.db.deleteSourcePageSkeletons(args.targetSessionId, insertedPageNumbers)
    )
    await runMergeRollbackStep('restore-page-order', rollbackContext, () =>
      ctx.db.replaceSessionPageOrder(
        args.targetSessionId,
        targetData.pages.map((page) => ({ id: page.id, pageNumber: page.pageNumber }))
      )
    )
    await runMergeRollbackStep('restore-session-metadata', rollbackContext, () =>
      ctx.db.updateSessionMetadata(args.targetSessionId, previousMetadata)
    )
    await runMergeRollbackStep('restore-session-status', rollbackContext, () =>
      ctx.db.updateSessionStatus(args.targetSessionId, targetSession.status)
    )
    if (targetProject?.id) {
      await runMergeRollbackStep('restore-project-status', rollbackContext, () =>
        ctx.db.updateProjectStatus(targetProject.id, targetProject.status)
      )
    }
    if (previousIndex) {
      await runMergeRollbackStep('restore-index', rollbackContext, () =>
        fs.promises.writeFile(targetData.indexPath, previousIndex)
      )
    } else {
      await runMergeRollbackStep('remove-created-index', rollbackContext, () =>
        fs.promises.rm(targetData.indexPath, { force: true })
      )
    }
    await runMergeRollbackStep('remove-page-html', rollbackContext, () =>
      Promise.all(preparedPages.map((item) => fs.promises.rm(item.page.htmlPath, { force: true })))
    )
    await runMergeRollbackStep('remove-merged-assets', rollbackContext, () =>
      fs.promises.rm(path.join(targetData.projectDir, 'assets', 'merged-pages', batchId), {
        recursive: true,
        force: true
      })
    )
    await runMergeRollbackStep('remove-merged-docs', rollbackContext, () =>
      fs.promises.rm(path.join(targetData.projectDir, 'docs', 'merged-pages', batchId), {
        recursive: true,
        force: true
      })
    )
    await runMergeRollbackStep('remove-created-font-files', rollbackContext, () =>
      Promise.all(movedTargetFontFiles.map((fontPath) => fs.promises.rm(fontPath, { force: true })))
    )
    mergeLog('warn', 'rollback:completed', rollbackContext, {
      durationMs: Date.now() - startedAt
    })
    throw error
  } finally {
    const cleanupStartedAt = Date.now()
    try {
      await fs.promises.rm(tempRoot, { recursive: true, force: true })
      mergeLog('info', 'cleanup:temp-directory:completed', logContext, {
        durationMs: Date.now() - cleanupStartedAt
      })
    } catch (error) {
      mergeLog('warn', 'cleanup:temp-directory:failed', logContext, {
        durationMs: Date.now() - cleanupStartedAt,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}
