import type { IpcContext } from '../context'
import * as fs from 'fs'
import path from 'path'
import * as cheerio from 'cheerio'
import { customAlphabet, nanoid } from 'nanoid'
import { buildProjectIndexHtml } from '../engine/template'
import { ensureSessionRuntimeCompatible } from './runtime-assets'
import { carryIndexTransitionConfig } from '../../session/index-transition'
import { validatePersistedPageHtml } from '../../tools/html-utils'
import type { SessionPageStatus } from '../../db/schema'
import { resolveOutlinesForPages } from './page-outline-utils'

const pageSlugId = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 10)

type CheerioSelection = ReturnType<cheerio.CheerioAPI>

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
  htmlPath: string
  html?: string
  status?: SessionPageStatus
  error?: string | null
}

export async function loadEditableSessionPages(
  ctx: IpcContext,
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
    htmlPath: resolvePageHtmlPath(projectDir, sp.file_slug, sp.html_path),
    status: sp.status,
    error: sp.error
  }))

  return { session: session as unknown as Record<string, unknown>, projectDir, indexPath, deckTitle, pages }
}

export async function persistManagedPages(
  ctx: IpcContext,
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

  const deckPages = renumbered.map((p) => ({
    id: p.id,
    pageNumber: p.pageNumber,
    pageId: p.pageId,
    title: p.title,
    htmlPath: path.basename(p.htmlPath)
  }))
  const rebuiltIndexHtml = buildProjectIndexHtml(args.deckTitle, deckPages)
  const indexHtml = fs.existsSync(args.indexPath)
    ? carryIndexTransitionConfig(
        await fs.promises.readFile(args.indexPath, 'utf-8'),
        rebuiltIndexHtml
      )
    : rebuiltIndexHtml
  await fs.promises.writeFile(`${args.indexPath}.tmp`, indexHtml, 'utf-8')
  try {
    if (args.deletedPageIds?.length) {
      await db.softDeleteSessionPages(args.sessionId, args.deletedPageIds)
    }
    await db.replaceSessionPageOrder(
      args.sessionId,
      renumbered.map((p) => ({ id: p.id, pageNumber: p.pageNumber }))
    )
    const currentSession = await db.getSession(args.sessionId)
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
    await db.updateSessionMetadata(args.sessionId, {
      ...safeMetadata,
      entryMode: 'multi_page',
      indexPath: args.indexPath
    })
  } catch (error) {
    await fs.promises.rm(`${args.indexPath}.tmp`, { force: true })
    throw error
  }
  await fs.promises.rename(`${args.indexPath}.tmp`, args.indexPath)

  return renumbered
}

const replacePageIdentity = (html: string, oldPageId: string, nextPageId: string): string => {
  const oldId = oldPageId.trim()
  if (!oldId || oldId === nextPageId) return html
  const escapedOldId = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const boundaryPattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapedOldId}(?=$|[^A-Za-z0-9_-])`, 'g')
  return html.replace(boundaryPattern, `$1${nextPageId}`)
}

const clearVisibleText = ($: cheerio.CheerioAPI, root: CheerioSelection): void => {
  root.find('input, textarea').each((_, node) => {
    const el = $(node)
    el.removeAttr('value')
    el.removeAttr('placeholder')
    el.text('')
  })
  root.find('*').contents().each((_, node) => {
    const parentTag = node.parent?.type === 'tag' ? node.parent.name.toLowerCase() : ''
    if (parentTag === 'script' || parentTag === 'style') return
    if (node.type === 'text' && node.data?.trim()) {
      node.data = ''
    }
  })
}

export function buildBlankPageHtmlFromSource(args: {
  html: string
  oldPageId: string
  nextPageId: string
  title: string
}): string {
  const rewritten = replacePageIdentity(args.html, args.oldPageId, args.nextPageId)
  const $ = cheerio.load(rewritten, { scriptingEnabled: false })
  $('title').text(args.title)
  $('body').attr('data-page-id', args.nextPageId)
  $('[data-page-id]').each((_, node) => {
    const el = $(node)
    if ((el.attr('data-page-id') || '').trim() === args.oldPageId) {
      el.attr('data-page-id', args.nextPageId)
    }
  })

  const content = $('.ppt-page-content').first()
  if (content.length > 0) {
    clearVisibleText($, content)
    content.attr('data-blank-page', '1')
  }

  return $.html()
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
  const sourcePage = pages.find((page) => page.id === sourcePageId || page.pageId === sourcePageId)
  if (!sourcePage) throw new Error('未找到要复制的页面')
  if (!fs.existsSync(sourcePage.htmlPath)) throw new Error('源页面文件不存在')

  await ensureSessionRuntimeCompatible(ctx, projectDir)
  const insertAfterPageNumber = pages.length
  const nextPageEntityId = nanoid()
  const nextPageId = `page-${pageSlugId()}`
  const nextHtmlPath = path.join(projectDir, `${nextPageId}.html`)
  const nextTitle = '新增空白页'
  const sourceHtml = await fs.promises.readFile(sourcePage.htmlPath, 'utf-8')
  const nextHtml = buildBlankPageHtmlFromSource({
    html: sourceHtml,
    oldPageId: sourcePage.pageId,
    nextPageId,
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
    htmlPath: nextHtmlPath,
    html: nextHtml,
    status: 'completed',
    error: null
  }
  const mergedPages = [...pages, newPage]

  await ctx.db.upsertSessionPage({
    id: newPage.id,
    sessionId,
    legacyPageId: null,
    fileSlug: newPage.pageId,
    pageNumber: newPage.pageNumber,
    title: newPage.title,
    htmlPath: newPage.htmlPath,
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
    prompt: `新增空白页到末尾：复制 P${sourcePage.pageNumber}`
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
  const { projectDir, indexPath, deckTitle, pages } = await loadEditableSessionPages(ctx, args.sessionId)
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
