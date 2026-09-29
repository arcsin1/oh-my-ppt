import type { IpcContext } from '../ipc/context'
import * as fs from 'fs'
import path from 'path'
import * as cheerio from 'cheerio'
import { customAlphabet, nanoid } from 'nanoid'
import { buildProjectIndexHtml } from './template-builder'
import { ensureSessionRuntimeCompatible } from './runtime-assets'
import { carryIndexTransitionConfig } from './index-transition'
import { validatePersistedPageHtml } from '../presentation/html/html-utils'
import {
  buildBlankPageHtmlFromSource,
  buildDuplicatePageHtmlFromSource
} from './page-html-builders'
import { setMasterPageNumber } from '../presentation/html/master-link'
import type { SessionPageStatus } from '../db/schema'
import { resolveOutlinesForPages } from './page-outline-utils'
import { requireSessionSlideSize } from '@shared/slide-size'
import {
  ensureHistoryBaselineSafe,
  recordHistoryOperationStrict
} from '../history/git-history-service'

type PageManagementContext = Pick<
  IpcContext,
  'db' | 'resolveSessionProjectDir' | 'ensureSessionAssets'
>

const pageSlugId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)

const resolvePageHtmlPath = (
  projectDir: string,
  fileSlug: string,
  candidatePath?: string | null
): string => {
  const projectRoot = path.resolve(projectDir)
  const fallbackPath = path.resolve(projectRoot, `${fileSlug}.html`)
  const rawCandidate = typeof candidatePath === 'string' ? candidatePath.trim() : ''
  if (!rawCandidate) return fallbackPath
  const resolvedCandidate = path.isAbsolute(rawCandidate)
    ? path.resolve(rawCandidate)
    : path.resolve(projectRoot, rawCandidate)
  const relative = path.relative(projectRoot, resolvedCandidate)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return fallbackPath
  return fs.existsSync(resolvedCandidate) ? resolvedCandidate : fallbackPath
}

export interface ManagedPage {
  id: string
  pageNumber: number
  pageId: string
  legacyPageId?: string
  title: string
  contentOutline?: string | null
  layoutIntent?: string | null
  layoutId?: string | null
  layoutContractVersion?: number | null
  htmlPath: string
  html?: string
  status?: SessionPageStatus
  error?: string | null
}

export async function loadEditableSessionPages(
  ctx: PageManagementContext,
  sessionId: string
): Promise<{
  session: Record<string, unknown>
  projectDir: string
  indexPath: string
  deckTitle: string
  pages: ManagedPage[]
}> {
  const session = await ctx.db.getSession(sessionId)
  if (!session) throw new Error('Session not found')

  const projectDir = await ctx.resolveSessionProjectDir(sessionId)
  const indexPath = path.join(projectDir, 'index.html')
  // SAFETY: Session DTO 只有 title 字段被页面管理使用，其余列保持原样。
  const deckTitle = (session as unknown as { title?: string }).title || 'Untitled'

  const sessionPages = await ctx.db.listSessionPages(sessionId)
  const outlineBySessionPageId = await resolveOutlinesForPages(ctx.db, sessionId, sessionPages)
  const pages: ManagedPage[] = sessionPages.map((sp) => ({
    id: sp.id,
    pageNumber: sp.page_number,
    pageId: sp.file_slug,
    legacyPageId: sp.legacy_page_id || undefined,
    title: sp.title,
    contentOutline: outlineBySessionPageId.get(sp.id) || null,
    layoutIntent: sp.layout_intent,
    layoutId: sp.layout_id,
    layoutContractVersion: sp.layout_contract_version,
    htmlPath: resolvePageHtmlPath(projectDir, sp.file_slug, sp.html_path),
    status: sp.status,
    error: sp.error
  }))

  // SAFETY: 调用方只读取 title/pages，Session 行被当作宽松对象传出。
  return {
    session: session as unknown as Record<string, unknown>,
    projectDir,
    indexPath,
    deckTitle,
    pages
  }
}

export async function persistManagedPages(
  ctx: PageManagementContext,
  args: {
    sessionId: string
    projectDir: string
    indexPath: string
    deckTitle: string
    pages: ManagedPage[]
    operation: 'reorder' | 'delete' | 'addPage' | 'rename'
    deletedPageIds?: string[]
    prompt: string
  }
): Promise<ManagedPage[]> {
  const { db } = ctx
  // Refresh assets only when runtime marker is missing/mismatched (mainly old sessions).
  await ensureSessionRuntimeCompatible(ctx, args.projectDir)
  // Keep caller order (drag result / filtered order), only rewrite contiguous page numbers.
  const renumbered = args.pages.map((p, i) => ({ ...p, pageNumber: i + 1 }))
  const pageUpdates = await Promise.all(
    renumbered.map(async (page) => {
      const source = await fs.promises.readFile(page.htmlPath, 'utf-8')
      return { path: page.htmlPath, source, updated: setMasterPageNumber(source, page.pageNumber) }
    })
  )
  const changedPageUpdates = pageUpdates.filter((page) => page.updated !== page.source)
  const restorePageSnapshots = async (): Promise<void> => {
    await Promise.all(
      changedPageUpdates.map((page) => fs.promises.writeFile(page.path, page.source, 'utf-8'))
    )
  }
  const currentSession = await db.getSession(args.sessionId)
  const deckPages = renumbered.map((p) => ({
    id: p.id,
    pageNumber: p.pageNumber,
    pageId: p.pageId,
    title: p.title,
    htmlPath: path.basename(p.htmlPath)
  }))
  const rebuiltIndexHtml = buildProjectIndexHtml(
    args.deckTitle,
    deckPages,
    requireSessionSlideSize(currentSession)
  )
  const indexHtml = fs.existsSync(args.indexPath)
    ? carryIndexTransitionConfig(
        await fs.promises.readFile(args.indexPath, 'utf-8'),
        rebuiltIndexHtml
      )
    : rebuiltIndexHtml
  let currentMetadata: Record<string, unknown> = {}
  try {
    currentMetadata = JSON.parse((currentSession?.metadata as string | null) || '{}')
  } catch {
    currentMetadata = {}
  }
  const {
    generatedPages: _generatedPages,
    failedPages: _failedPages,
    ...safeMetadata
  } = currentMetadata as Record<string, unknown> & {
    generatedPages?: unknown
    failedPages?: unknown
  }
  void _generatedPages
  void _failedPages

  try {
    await Promise.all(
      changedPageUpdates.map((page) => fs.promises.writeFile(page.path, page.updated, 'utf-8'))
    )
    await fs.promises.writeFile(`${args.indexPath}.tmp`, indexHtml, 'utf-8')
    await db.persistSessionPageState({
      sessionId: args.sessionId,
      pages: renumbered.map((page) => ({ id: page.id, pageNumber: page.pageNumber })),
      deletedPageIds: args.deletedPageIds,
      metadata: {
        ...safeMetadata,
        entryMode: 'multi_page',
        indexPath: args.indexPath
      }
    })
  } catch (error) {
    await restorePageSnapshots().catch(() => undefined)
    await fs.promises.rm(`${args.indexPath}.tmp`, { force: true })
    throw error
  }
  await fs.promises.rename(`${args.indexPath}.tmp`, args.indexPath)

  return renumbered
}

export async function deleteSessionPages(
  ctx: PageManagementContext,
  payload: {
    sessionId: string
    pageIds: string[]
    selectedPageId?: string
  }
): Promise<{
  ok: boolean
  generatedPages: Array<{
    id: string
    pageNumber: number
    pageId: string
    title: string
    contentOutline: string | null
    html: string
    htmlPath: string
    status?: SessionPageStatus
    error?: string | null
  }>
  selectedPageId: string | null
}> {
  const { sessionId, pageIds, selectedPageId } = payload
  const { projectDir, indexPath, deckTitle, pages } = await loadEditableSessionPages(ctx, sessionId)
  if (!pageIds.length) throw new Error('pageIds is empty')
  const uniqueDeleteIds = new Set(pageIds)
  if (uniqueDeleteIds.size !== pageIds.length) {
    throw new Error('pageIds contains duplicate page ids')
  }
  const resolvedIds = pageIds.map((id) => {
    const page = pages.find((item) => item.id === id || item.pageId === id)
    if (!page) throw new Error(`Unknown page id: ${id}`)
    return page.id
  })
  const deleteSet = new Set(resolvedIds)
  if (pages.length - deleteSet.size < 1) throw new Error('Cannot delete last page')
  const beforeOrder = pages.map((p) => ({
    id: p.id,
    pageNumber: p.pageNumber,
    pageId: p.pageId,
    title: p.title
  }))
  const firstDeletedIndex = pages.findIndex((p) => deleteSet.has(p.id))
  const remaining = pages.filter((p) => !deleteSet.has(p.id))
  const deletedPages = pages.filter((p) => deleteSet.has(p.id))
  const afterOrder = remaining.map((p, index) => ({
    id: p.id,
    pageNumber: index + 1,
    pageId: p.pageId,
    title: p.title
  }))
  const shrinkTitle = (title: string): string => {
    const clean = title.replace(/\s+/g, ' ').trim()
    if (clean.length <= 16) return clean
    return `${clean.slice(0, 16)}…`
  }
  const deletedPreview = deletedPages
    .slice(0, 3)
    .map((item) => `P${item.pageNumber}《${shrinkTitle(item.title)}》`)
    .join('；')
  const deletePrompt =
    deletedPages.length > 0
      ? `删除页面：${deletedPreview}${deletedPages.length > 3 ? `；等 ${deletedPages.length} 页` : ''}`
      : `删除页面：${resolvedIds.length} 页`
  await ensureHistoryBaselineSafe(ctx.db, sessionId, projectDir)

  const result = await persistManagedPages(ctx, {
    sessionId,
    projectDir,
    indexPath,
    deckTitle,
    pages: remaining,
    operation: 'delete',
    deletedPageIds: resolvedIds,
    prompt: deletePrompt
  })
  await recordHistoryOperationStrict(ctx.db, {
    sessionId,
    type: 'delete',
    scope: 'session',
    projectDir,
    prompt: deletePrompt,
    metadata: {
      deletedPageIds: resolvedIds,
      selectedPageId: selectedPageId || null,
      deletedCount: resolvedIds.length,
      totalPagesAfterDelete: result.length,
      beforeOrder,
      afterOrder
    }
  })

  let newSelectedId = selectedPageId || null
  if (selectedPageId && deleteSet.has(selectedPageId)) {
    const nextIndex = Math.min(Math.max(firstDeletedIndex, 0), result.length - 1)
    newSelectedId = result.length > 0 ? result[nextIndex].id : null
  }

  return {
    ok: true,
    generatedPages: result.map((p) => ({
      id: p.id,
      pageNumber: p.pageNumber,
      pageId: p.pageId,
      title: p.title,
      contentOutline: p.contentOutline?.trim() || null,
      html: '',
      htmlPath: p.htmlPath,
      status: p.status,
      error: p.error
    })),
    selectedPageId: newSelectedId
  }
}

export async function createBlankSessionPage(
  ctx: IpcContext,
  args: {
    sessionId: string
    sourcePageId: string
  }
): Promise<{ pages: ManagedPage[]; selectedPageId: string }> {
  const { sessionId, sourcePageId } = args
  const { projectDir, indexPath, deckTitle, pages } = await loadEditableSessionPages(ctx, sessionId)
  if (pages.length === 0) throw new Error('当前会话没有可复制的页面')
  const sourceIndex = pages.findIndex(
    (page) => page.id === sourcePageId || page.pageId === sourcePageId
  )
  if (sourceIndex < 0) throw new Error('未找到要复制的页面')
  const sourcePage = pages[sourceIndex]
  if (!fs.existsSync(sourcePage.htmlPath)) throw new Error('源页面文件不存在')

  await ensureSessionRuntimeCompatible(ctx, projectDir)
  const insertAfterPageNumber = sourcePage.pageNumber
  const nextPageEntityId = nanoid()
  const nextPageId = `page-${pageSlugId()}`
  const nextHtmlPath = path.join(projectDir, `${nextPageId}.html`)
  const nextTitle = '新增空白页'
  const sourceHtml = await fs.promises.readFile(sourcePage.htmlPath, 'utf-8')
  const nextHtml = buildBlankPageHtmlFromSource({
    html: sourceHtml,
    oldPageId: sourcePage.pageId,
    nextPageId,
    pageNumber: insertAfterPageNumber + 1,
    title: nextTitle
  })
  const validation = validatePersistedPageHtml(nextHtml, nextPageId)
  if (!validation.valid) {
    throw new Error(`空白页创建失败: ${validation.errors.join('; ')}`)
  }
  await fs.promises.writeFile(nextHtmlPath, nextHtml, 'utf-8')

  const newPage: ManagedPage = {
    id: nextPageEntityId,
    pageNumber: insertAfterPageNumber + 1,
    pageId: nextPageId,
    title: nextTitle,
    contentOutline: null,
    layoutIntent: sourcePage.layoutIntent || null,
    layoutId: sourcePage.layoutId || null,
    layoutContractVersion: sourcePage.layoutContractVersion || null,
    htmlPath: nextHtmlPath,
    html: nextHtml,
    status: 'completed',
    error: null
  }
  const mergedPages = [...pages.slice(0, sourceIndex + 1), newPage, ...pages.slice(sourceIndex + 1)]

  await ctx.db.upsertSessionPage({
    id: newPage.id,
    sessionId,
    legacyPageId: null,
    fileSlug: newPage.pageId,
    pageNumber: newPage.pageNumber,
    title: newPage.title,
    htmlPath: newPage.htmlPath,
    layoutIntent: newPage.layoutIntent || null,
    layoutId: newPage.layoutId || null,
    layoutContractVersion: newPage.layoutContractVersion || null,
    status: 'completed',
    error: null
  })

  const result = await persistManagedPages(ctx, {
    sessionId,
    projectDir,
    indexPath,
    deckTitle,
    pages: mergedPages,
    operation: 'addPage',
    prompt: `新增空白页：复制 P${sourcePage.pageNumber}`
  })
  const project = await ctx.db.getProject(sessionId)
  if (project?.id) await ctx.db.updateProjectStatus(project.id, 'draft')
  await ctx.db.updateSessionStatus(sessionId, 'completed')
  return { pages: result, selectedPageId: nextPageEntityId }
}

export async function duplicateSessionPage(
  ctx: IpcContext,
  args: {
    sessionId: string
    sourcePageId: string
  }
): Promise<{ pages: ManagedPage[]; selectedPageId: string }> {
  const { sessionId, sourcePageId } = args
  const { projectDir, indexPath, deckTitle, pages } = await loadEditableSessionPages(ctx, sessionId)
  if (pages.length === 0) throw new Error('当前会话没有可复制的页面')
  const sourceIndex = pages.findIndex(
    (page) => page.id === sourcePageId || page.pageId === sourcePageId
  )
  if (sourceIndex < 0) throw new Error('未找到要复制的页面')
  const sourcePage = pages[sourceIndex]
  if (!fs.existsSync(sourcePage.htmlPath)) throw new Error('源页面文件不存在')

  await ensureSessionRuntimeCompatible(ctx, projectDir)
  const nextPageEntityId = nanoid()
  const nextPageId = `page-${pageSlugId()}`
  const nextHtmlPath = path.join(projectDir, `${nextPageId}.html`)
  const nextTitle = `[副本]${sourcePage.title ?? ''}`
  const sourceHtml = await fs.promises.readFile(sourcePage.htmlPath, 'utf-8')
  const nextHtml = buildDuplicatePageHtmlFromSource({
    html: sourceHtml,
    oldPageId: sourcePage.pageId,
    nextPageId,
    pageNumber: sourcePage.pageNumber + 1,
    title: nextTitle
  })
  const validation = validatePersistedPageHtml(nextHtml, nextPageId)
  if (!validation.valid) {
    throw new Error(`复制页面失败: ${validation.errors.join('; ')}`)
  }
  await fs.promises.writeFile(nextHtmlPath, nextHtml, 'utf-8')

  const newPage: ManagedPage = {
    id: nextPageEntityId,
    // 占位页码，persistManagedPages 会按位置连续重排。
    pageNumber: sourcePage.pageNumber + 1,
    pageId: nextPageId,
    title: nextTitle,
    contentOutline: sourcePage.contentOutline || null,
    layoutIntent: sourcePage.layoutIntent || null,
    layoutId: sourcePage.layoutId || null,
    layoutContractVersion: sourcePage.layoutContractVersion || null,
    htmlPath: nextHtmlPath,
    html: nextHtml,
    status: sourcePage.status || 'completed',
    error: null
  }
  // 插到源页紧后方（区别于空白页追加到末尾）。
  const mergedPages = [...pages.slice(0, sourceIndex + 1), newPage, ...pages.slice(sourceIndex + 1)]

  await ctx.db.upsertSessionPage({
    id: newPage.id,
    sessionId,
    legacyPageId: null,
    fileSlug: newPage.pageId,
    pageNumber: newPage.pageNumber,
    title: newPage.title,
    htmlPath: newPage.htmlPath,
    layoutIntent: newPage.layoutIntent || null,
    layoutId: newPage.layoutId || null,
    layoutContractVersion: newPage.layoutContractVersion || null,
    status: newPage.status || 'completed',
    error: null
  })

  const result = await persistManagedPages(ctx, {
    sessionId,
    projectDir,
    indexPath,
    deckTitle,
    pages: mergedPages,
    operation: 'addPage',
    prompt: `复制页面：P${sourcePage.pageNumber}《${sourcePage.title}》`
  })
  const project = await ctx.db.getProject(sessionId)
  if (project?.id) await ctx.db.updateProjectStatus(project.id, 'draft')
  await ctx.db.updateSessionStatus(sessionId, 'completed')
  return { pages: result, selectedPageId: nextPageEntityId }
}

export async function renameSessionPageTitle(
  ctx: IpcContext,
  args: {
    sessionId: string
    pageId: string
    title: string
  }
): Promise<{ pages: ManagedPage[]; selectedPageId: string }> {
  const title = args.title.replace(/\s+/g, ' ').trim()
  if (!title) throw new Error('页面标题不能为空')
  const { projectDir, indexPath, deckTitle, pages } = await loadEditableSessionPages(
    ctx,
    args.sessionId
  )
  const page = pages.find((item) => item.id === args.pageId || item.pageId === args.pageId)
  if (!page) throw new Error('未找到要修改标题的页面')

  const nextPages = pages.map((item) =>
    item.id === page.id
      ? {
          ...item,
          title
        }
      : item
  )

  if (fs.existsSync(page.htmlPath)) {
    const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
    const $ = cheerio.load(html, { scriptingEnabled: false })
    $('title').text(title)
    await fs.promises.writeFile(page.htmlPath, $.html(), 'utf-8')
  }
  await ctx.db.upsertSessionPage({
    id: page.id,
    sessionId: args.sessionId,
    legacyPageId: page.legacyPageId || null,
    fileSlug: page.pageId,
    pageNumber: page.pageNumber,
    title,
    htmlPath: page.htmlPath,
    layoutIntent: page.layoutIntent || null,
    layoutId: page.layoutId || null,
    layoutContractVersion: page.layoutContractVersion || null,
    status: page.status || 'completed',
    error: page.error || null
  })

  const result = await persistManagedPages(ctx, {
    sessionId: args.sessionId,
    projectDir,
    indexPath,
    deckTitle,
    pages: nextPages,
    operation: 'rename',
    prompt: `修改页面标题：P${page.pageNumber}《${page.title}》->《${title}》`
  })
  const project = await ctx.db.getProject(args.sessionId)
  if (project?.id) await ctx.db.updateProjectStatus(project.id, 'draft')
  return { pages: result, selectedPageId: page.id }
}
