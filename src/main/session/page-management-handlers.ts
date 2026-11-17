import { ipcMain } from 'electron'
import type { IpcContext } from '../ipc/context'
import {
  createBlankSessionPage,
  deleteSessionPages,
  duplicateSessionPage,
  loadEditableSessionPages,
  persistManagedPages,
  renameSessionPageTitle
} from './page-management-service'
import { migrateLegacyPageOutlinesToSourceSkeletons } from './page-outline-utils'
import {
  ensureHistoryBaselineSafe,
  recordHistoryOperationStrict
} from '../history/git-history-service'

export function registerPageManagementHandlers(ctx: IpcContext): void {
  ipcMain.handle('session:migratePageOutlinesToSourceSkeletons', async (_event, payload) => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    if (!sessionId) throw new Error('sessionId 不能为空')
    return migrateLegacyPageOutlinesToSourceSkeletons(ctx.db, sessionId)
  })

  ipcMain.handle('session:reorderPages', async (_event, payload) => {
    const { sessionId, orderedPageIds, selectedPageId } = payload as {
      sessionId: string
      orderedPageIds: string[]
      selectedPageId?: string
    }
    const { projectDir, indexPath, deckTitle, pages } = await loadEditableSessionPages(
      ctx,
      sessionId
    )
    if (orderedPageIds.length !== pages.length) {
      throw new Error('orderedPageIds length mismatch')
    }
    const pageMap = new Map(pages.map((p) => [p.id, p]))
    const uniqueOrderedIds = new Set(orderedPageIds)
    if (uniqueOrderedIds.size !== orderedPageIds.length) {
      throw new Error('orderedPageIds contains duplicate page ids')
    }
    for (const id of orderedPageIds) {
      if (!pageMap.has(id)) throw new Error(`Unknown page id: ${id}`)
    }
    const beforeOrder = pages.map((p) => ({
      id: p.id,
      pageNumber: p.pageNumber,
      pageId: p.pageId,
      title: p.title
    }))
    const reordered = orderedPageIds.map((id) => {
      return pageMap.get(id)!
    })
    const afterOrder = reordered.map((p, index) => ({
      id: p.id,
      pageNumber: index + 1,
      pageId: p.pageId,
      title: p.title
    }))
    const movedPages = afterOrder
      .map((item, index) => {
        const fromIndex = beforeOrder.findIndex((x) => x.id === item.id)
        return {
          id: item.id,
          title: item.title,
          from: fromIndex >= 0 ? fromIndex + 1 : null,
          to: index + 1
        }
      })
      .filter((item) => item.from !== item.to)
    const shrinkTitle = (title: string): string => {
      const clean = title.replace(/\s+/g, ' ').trim()
      if (clean.length <= 16) return clean
      return `${clean.slice(0, 16)}…`
    }
    const movedPreview = movedPages
      .slice(0, 2)
      .map((item) => `P${item.from}->P${item.to}《${shrinkTitle(item.title)}》`)
      .join('；')
    const operationPrompt =
      movedPages.length > 0
        ? `调整页面顺序：${movedPreview}${movedPages.length > 2 ? `；等 ${movedPages.length} 项` : ''}`
        : '调整页面顺序（位置未变化）'
    await ensureHistoryBaselineSafe(ctx.db, sessionId, projectDir)

    const result = await persistManagedPages(ctx, {
      sessionId,
      projectDir,
      indexPath,
      deckTitle,
      pages: reordered,
      operation: 'reorder',
      prompt: operationPrompt
    })
    await recordHistoryOperationStrict(ctx.db, {
      sessionId,
      type: 'reorder',
      scope: 'session',
      projectDir,
      prompt: operationPrompt,
      metadata: {
        changedPageIds: result.map((p) => p.id),
        selectedPageId: selectedPageId || null,
        totalPages: result.length,
        movedCount: movedPages.length,
        movedPages,
        beforeOrder,
        afterOrder
      }
    })

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
      selectedPageId: selectedPageId || null
    }
  })

  ipcMain.handle('session:deletePages', async (_event, payload) => {
    const { sessionId, pageIds, selectedPageId } = payload as {
      sessionId: string
      pageIds: string[]
      selectedPageId?: string
    }
    return deleteSessionPages(ctx, { sessionId, pageIds, selectedPageId })
  })

  ipcMain.handle('session:createBlankPage', async (_event, payload) => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const sourcePageId = typeof record.sourcePageId === 'string' ? record.sourcePageId.trim() : ''
    if (!sessionId) throw new Error('sessionId 不能为空')
    if (!sourcePageId) throw new Error('sourcePageId 不能为空')
    const { projectDir, pages } = await loadEditableSessionPages(ctx, sessionId)
    await ensureHistoryBaselineSafe(ctx.db, sessionId, projectDir)
    const sourcePage = pages.find(
      (page) => page.id === sourcePageId || page.pageId === sourcePageId
    )
    const result = await createBlankSessionPage(ctx, {
      sessionId,
      sourcePageId
    })
    const prompt = sourcePage
      ? `新增空白页：复制 P${sourcePage.pageNumber}《${sourcePage.title}》`
      : '新增空白页'
    await recordHistoryOperationStrict(ctx.db, {
      sessionId,
      type: 'addPage',
      scope: 'session',
      projectDir,
      prompt,
      metadata: {
        addPage: true,
        blankPage: true,
        sourcePageId,
        selectedPageId: result.selectedPageId,
        totalPages: result.pages.length
      }
    })

    return {
      ok: true,
      generatedPages: result.pages.map((p) => ({
        id: p.id,
        pageNumber: p.pageNumber,
        pageId: p.pageId,
        title: p.title,
        contentOutline: p.contentOutline?.trim() || null,
        html: p.html || '',
        htmlPath: p.htmlPath,
        status: p.status,
        error: p.error
      })),
      selectedPageId: result.selectedPageId
    }
  })

  ipcMain.handle('session:duplicatePage', async (_event, payload) => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const sourcePageId = typeof record.sourcePageId === 'string' ? record.sourcePageId.trim() : ''
    if (!sessionId) throw new Error('sessionId 不能为空')
    if (!sourcePageId) throw new Error('sourcePageId 不能为空')
    const { projectDir, pages } = await loadEditableSessionPages(ctx, sessionId)
    await ensureHistoryBaselineSafe(ctx.db, sessionId, projectDir)
    const sourcePage = pages.find(
      (page) => page.id === sourcePageId || page.pageId === sourcePageId
    )
    const result = await duplicateSessionPage(ctx, {
      sessionId,
      sourcePageId
    })
    const prompt = sourcePage
      ? `复制页面：P${sourcePage.pageNumber}《${sourcePage.title}》`
      : '复制页面'
    await recordHistoryOperationStrict(ctx.db, {
      sessionId,
      type: 'addPage',
      scope: 'session',
      projectDir,
      prompt,
      metadata: {
        addPage: true,
        duplicatePage: true,
        sourcePageId,
        selectedPageId: result.selectedPageId,
        totalPages: result.pages.length
      }
    })

    return {
      ok: true,
      generatedPages: result.pages.map((p) => ({
        id: p.id,
        pageNumber: p.pageNumber,
        pageId: p.pageId,
        title: p.title,
        contentOutline: p.contentOutline?.trim() || null,
        html: p.html || '',
        htmlPath: p.htmlPath,
        status: p.status,
        error: p.error
      })),
      selectedPageId: result.selectedPageId
    }
  })

  ipcMain.handle('session:updatePageTitle', async (_event, payload) => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const pageId = typeof record.pageId === 'string' ? record.pageId.trim() : ''
    const title = typeof record.title === 'string' ? record.title.replace(/\s+/g, ' ').trim() : ''
    if (!sessionId) throw new Error('sessionId 不能为空')
    if (!pageId) throw new Error('pageId 不能为空')
    if (!title) throw new Error('页面标题不能为空')

    const { projectDir, pages } = await loadEditableSessionPages(ctx, sessionId)
    const page = pages.find((item) => item.id === pageId || item.pageId === pageId)
    if (!page) throw new Error('未找到要修改标题的页面')
    if (page.title === title) {
      return {
        ok: true,
        generatedPages: pages.map((p) => ({
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
        selectedPageId: page.id
      }
    }

    await ensureHistoryBaselineSafe(ctx.db, sessionId, projectDir)
    const result = await renameSessionPageTitle(ctx, {
      sessionId,
      pageId,
      title
    })
    const prompt = `修改页面标题：P${page.pageNumber}《${page.title}》->《${title}》`
    await recordHistoryOperationStrict(ctx.db, {
      sessionId,
      type: 'edit',
      scope: 'page',
      projectDir,
      prompt,
      metadata: {
        pageId: page.id,
        pageSlug: page.pageId,
        oldTitle: page.title,
        newTitle: title,
        selectedPageId: result.selectedPageId,
        titleEdit: true
      }
    })

    return {
      ok: true,
      generatedPages: result.pages.map((p) => ({
        id: p.id,
        pageNumber: p.pageNumber,
        pageId: p.pageId,
        title: p.title,
        contentOutline: p.contentOutline?.trim() || null,
        html: p.html || '',
        htmlPath: p.htmlPath,
        status: p.status,
        error: p.error
      })),
      selectedPageId: result.selectedPageId
    }
  })

  ipcMain.handle('session:updatePageOutline', async (_event, payload) => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const pageId = typeof record.pageId === 'string' ? record.pageId.trim() : ''
    const contentOutline =
      typeof record.contentOutline === 'string'
        ? record.contentOutline.replace(/\s+/g, ' ').trim()
        : ''
    if (!sessionId) throw new Error('sessionId 不能为空')
    if (!pageId) throw new Error('pageId 不能为空')

    const { projectDir, pages } = await loadEditableSessionPages(ctx, sessionId)
    const page = pages.find((item) => item.id === pageId || item.pageId === pageId)
    if (!page) throw new Error('未找到要修改大纲的页面')
    const oldOutline = page.contentOutline?.trim() || ''
    if (oldOutline === contentOutline) {
      return {
        ok: true,
        generatedPages: pages.map((p) => ({
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
        selectedPageId: page.id
      }
    }

    await ensureHistoryBaselineSafe(ctx.db, sessionId, projectDir)
    const [session, skeletons] = await Promise.all([
      ctx.db.getSession(sessionId),
      ctx.db.listSourcePageSkeletons(sessionId)
    ])
    const skeleton = skeletons.find((item) => item.page_number === page.pageNumber)
    const sourceDocumentPath =
      skeleton?.source_document_path ||
      session?.referenceDocumentPath ||
      session?.reference_document_path ||
      `legacy-outline:${sessionId}`
    if (contentOutline) {
      await ctx.db.upsertSourcePageSkeleton({
        sessionId,
        pageNumber: page.pageNumber,
        title: page.title,
        role: skeleton?.role || 'content',
        sourceDocumentPath,
        sourceDocumentName: skeleton?.source_document_name || session?.title || 'Manual outline',
        sourceHeading: contentOutline,
        headingLevel: skeleton?.heading_level || 1,
        lineStart: skeleton?.line_start || page.pageNumber,
        lineEnd: skeleton?.line_end || page.pageNumber,
        reason: null,
        confidence: skeleton?.confidence || 'medium'
      })
    } else {
      await ctx.db.deleteSourcePageSkeleton(sessionId, page.pageNumber)
    }

    const refreshed = await loadEditableSessionPages(ctx, sessionId)
    const prompt = `修改页面大纲：P${page.pageNumber}《${page.title}》`
    await recordHistoryOperationStrict(ctx.db, {
      sessionId,
      type: 'edit',
      scope: 'page',
      projectDir,
      prompt,
      metadata: {
        pageId: page.id,
        pageSlug: page.pageId,
        oldOutline,
        newOutline: contentOutline,
        selectedPageId: page.id,
        outlineEdit: true
      }
    })

    return {
      ok: true,
      generatedPages: refreshed.pages.map((p) => ({
        id: p.id,
        pageNumber: p.pageNumber,
        pageId: p.pageId,
        title: p.title,
        contentOutline: p.contentOutline?.trim() || null,
        html: p.html || '',
        htmlPath: p.htmlPath,
        status: p.status,
        error: p.error
      })),
      selectedPageId: page.id
    }
  })
}
