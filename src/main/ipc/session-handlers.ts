import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { pathToFileURL } from 'url'
import { normalizeSession, normalizeMessage } from './utils'
import { extractPagesDataFromIndex } from './template'
import { getStyleDetail, hasStyleSkill } from '../utils/style-skills'
import type { IpcContext } from './context'
import { resolveActiveModelConfig } from './model-config-utils'
import { readAppLocale, uiText } from './locale-utils'

export function registerSessionHandlers(ctx: IpcContext): void {
  const {
    db,
    agentManager,
    resolveStoragePath,
    ensureSessionAssets,
    buildSessionGenerationSnapshot,
    getPageSourceUrl
  } = ctx

  ipcMain.handle('session:create', async (_event, payload) => {
    const { topic, styleId, pageCount } = payload
    const allowWebSearch = payload?.allowWebSearch === true
    const referenceDocumentPath =
      typeof payload?.referenceDocumentPath === 'string' ? payload.referenceDocumentPath.trim() : ''
    const locale = await readAppLocale(ctx)
    const storagePath = await resolveStoragePath()
    const activeModel = await resolveActiveModelConfig(ctx)
    const { provider, model } = activeModel
    const baseUrl = activeModel.baseUrl
    const normalizedStyleId = typeof styleId === 'string' ? styleId.trim() : ''
    if (!normalizedStyleId) {
      throw new Error(
        uiText(
          locale,
          '创建会话失败：styleId 不能为空。',
          'Failed to create session: styleId is required.'
        )
      )
    }
    if (!hasStyleSkill(normalizedStyleId)) {
      throw new Error(
        uiText(
          locale,
          `创建会话失败：styleId 不存在 ${normalizedStyleId}`,
          `Failed to create session: styleId does not exist: ${normalizedStyleId}`
        )
      )
    }
    let validatedReferenceSourcePath: string | null = null
    if (referenceDocumentPath) {
      const storageRoot = fs.existsSync(storagePath)
        ? await fs.promises.realpath(storagePath)
        : path.resolve(storagePath)
      const sourcePath = path.resolve(referenceDocumentPath)
      if (!fs.existsSync(sourcePath)) {
        throw new Error(
          uiText(
            locale,
            '解析后的文档不存在，请重新解析文档',
            'The parsed document no longer exists. Parse the document again.'
          )
        )
      }
      const sourceRealPath = await fs.promises.realpath(sourcePath)
      const relativeToStorage = path.relative(storageRoot, sourceRealPath)
      if (relativeToStorage.startsWith('..') || path.isAbsolute(relativeToStorage)) {
        throw new Error(
          uiText(
            locale,
            '文档路径不在用户配置目录内，请重新解析文档',
            'The document path is outside the configured storage folder. Parse the document again.'
          )
        )
      }
      validatedReferenceSourcePath = sourceRealPath
    }
    const sessionId = crypto.randomUUID()
    const projectDir = path.join(storagePath, sessionId)

    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true })
    }
    await ensureSessionAssets(projectDir)
    const copyReferenceDocumentToSession = async (): Promise<string | null> => {
      if (!validatedReferenceSourcePath) return null
      const docsDir = path.join(projectDir, 'docs')
      await fs.promises.mkdir(docsDir, { recursive: true })
      const ext = path.extname(validatedReferenceSourcePath).toLowerCase() || '.md'
      const fileName = `${Date.now()}${ext}`
      const targetPath = path.join(docsDir, fileName)
      await fs.promises.copyFile(validatedReferenceSourcePath, targetPath)
      return `/docs/${fileName}`
    }
    const sessionReferenceDocumentPath = await copyReferenceDocumentToSession()

    const styleDetail = getStyleDetail(normalizedStyleId)
    log.info('[session:create] style selected', {
      sessionId,
      styleId: normalizedStyleId,
      styleKey: styleDetail.styleKey,
      styleLabel: styleDetail.label
    })

    await agentManager.createSession({
      sessionId,
      provider,
      model,
      baseUrl,
      projectDir,
      topic,
      styleId: normalizedStyleId,
      pageCount,
      referenceDocumentPath: sessionReferenceDocumentPath
    })

    await db.updateSessionMetadata(sessionId, {
      allowWebSearch
    })

    return { sessionId }
  })

  ipcMain.handle('session:list', async () => {
    const sessions = await db.listSessions()
    const enrichedSessions = await Promise.all(
      sessions.map(async (session) => {
        const snapshot = await buildSessionGenerationSnapshot(
          session as unknown as Record<string, unknown>,
          {
            includeHtml: false
          }
        )
        return snapshot.session || (session as unknown as Record<string, unknown>)
      })
    )
    return enrichedSessions.map((session) =>
      normalizeSession(session as unknown as Record<string, unknown>)
    )
  })

  ipcMain.handle('session:updateTitle', async (_event, payload: unknown) => {
    const locale = await readAppLocale(ctx)
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    const title = typeof record.title === 'string' ? record.title.trim() : ''
    if (!sessionId) throw new Error(uiText(locale, '会话 ID 不能为空', 'Session ID is required.'))
    if (!title) throw new Error(uiText(locale, '会话名称不能为空', 'Session title is required.'))
    if (title.length > 120) {
      throw new Error(
        uiText(locale, '会话名称不能超过 120 个字符', 'Session title cannot exceed 120 characters.')
      )
    }
    const existingSession = await db.getSession(sessionId)
    if (!existingSession) {
      throw new Error(
        uiText(locale, '会话不存在或已被删除', 'The session does not exist or has been deleted.')
      )
    }
    await db.updateSessionTitle(sessionId, title)
    return { ok: true }
  })

  ipcMain.handle('session:get', async (_event, sessionId) => {
    const session = await db.getSession(sessionId)
    const messages = await db.getSessionMessages(sessionId, { chatScope: 'main' })
    const generatedPages: Array<{
      pageNumber: number
      title: string
      html: string
      htmlPath?: string
      pageId?: string
      sourceUrl?: string
      status?: string
      error?: string | null
    }> = []
    const metadataForSnapshot = (() => {
      if (!session?.metadata) return {} as Record<string, unknown>
      try {
        return JSON.parse(session.metadata) as Record<string, unknown>
      } catch {
        return {} as Record<string, unknown>
      }
    })()

    if (session?.metadata) {
      try {
        const metadata = metadataForSnapshot as {
          entryMode?: 'single_index' | 'multi_page'
          indexPath?: string
          generatedPages?: Array<{
            pageNumber: number
            title: string
            pageId?: string
            htmlPath?: string
            html?: string
          }>
        }

        if (metadata.entryMode === 'multi_page') {
          const indexPath = metadata.indexPath || ''
          const restoredPages = await Promise.all(
            (metadata.generatedPages || []).map(async (page) => {
              const pageId = page.pageId || `page-${page.pageNumber}`
              const pagePath = page.htmlPath || path.join(path.dirname(indexPath), `${pageId}.html`)
              if (!fs.existsSync(pagePath)) return null
              const html = await fs.promises.readFile(pagePath, 'utf-8')
              return {
                pageNumber: page.pageNumber,
                title: page.title,
                html,
                htmlPath: pagePath,
                pageId,
                sourceUrl: getPageSourceUrl(pagePath),
                status: 'completed'
              }
            })
          )
          for (const page of restoredPages) {
            if (page) generatedPages.push(page)
          }
        } else if (
          metadata.entryMode === 'single_index' &&
          metadata.indexPath &&
          fs.existsSync(metadata.indexPath)
        ) {
          const resolvedIndexPath = metadata.indexPath
          const indexHtml = await fs.promises.readFile(resolvedIndexPath, 'utf-8')
          const baseUrl = pathToFileURL(resolvedIndexPath).toString()
          const parsedPages = extractPagesDataFromIndex(indexHtml)
          const parsedById = new Map(parsedPages.map((item) => [item.pageId, item]))
          const restoredPages = await Promise.all(
            (metadata.generatedPages || []).map(async (page) => {
              const pageId = page.pageId || `page-${page.pageNumber}`
              const parsed = parsedById.get(pageId)
              const pagePath =
                page.htmlPath ||
                (typeof parsed?.htmlPath === 'string'
                  ? path.resolve(path.dirname(resolvedIndexPath), parsed.htmlPath)
                  : resolvedIndexPath)
              const html =
                pagePath && pagePath !== resolvedIndexPath && fs.existsSync(pagePath)
                  ? await fs.promises.readFile(pagePath, 'utf-8')
                  : page.html || parsed?.html || indexHtml
              return {
                pageNumber: page.pageNumber,
                title: page.title,
                html,
                htmlPath: pagePath,
                pageId,
                sourceUrl: `${baseUrl}?embed=1#${encodeURIComponent(pageId)}`,
                status: 'completed'
              }
            })
          )
          generatedPages.push(...restoredPages)
        } else {
          const restoredPages = await Promise.all(
            (metadata.generatedPages || []).map(async (page) => {
              if (!page.htmlPath || !fs.existsSync(page.htmlPath)) return null
              const html = await fs.promises.readFile(page.htmlPath, 'utf-8')
              return {
                pageNumber: page.pageNumber,
                title: page.title,
                html,
                htmlPath: page.htmlPath,
                pageId: page.pageId || `page-${page.pageNumber}`,
                sourceUrl: getPageSourceUrl(page.htmlPath),
                status: 'completed'
              }
            })
          )
          for (const page of restoredPages) {
            if (page) generatedPages.push(page)
          }
        }
      } catch {
        // Ignore malformed metadata and let the session open without restored pages.
      }
    }

    if (session) {
      const existingPageIds = new Set(
        generatedPages.map((page) => page.pageId || `page-${page.pageNumber}`)
      )
      const generationSnapshot = await db.listLatestGenerationPageSnapshot(sessionId)
      if (generationSnapshot.length > 0) {
        const project = await db.getProject(sessionId)
        const metadataIndexPath =
          typeof metadataForSnapshot.indexPath === 'string' &&
          metadataForSnapshot.indexPath.trim().length > 0
            ? metadataForSnapshot.indexPath.trim()
            : ''
        const projectDir =
          typeof project?.output_path === 'string' && project.output_path.trim().length > 0
            ? project.output_path.trim()
            : metadataIndexPath
              ? path.dirname(metadataIndexPath)
              : path.join(await resolveStoragePath(), sessionId)

        for (const page of generationSnapshot) {
          const pageId = page.page_id || `page-${page.page_number}`
          if (existingPageIds.has(pageId)) continue
          const htmlPath = page.html_path || path.join(projectDir, `${pageId}.html`)
          if (!fs.existsSync(htmlPath)) continue
          const html = await fs.promises.readFile(htmlPath, 'utf-8')
          generatedPages.push({
            pageNumber: page.page_number,
            title: page.title || `第 ${page.page_number} 页`,
            html,
            htmlPath,
            pageId,
            sourceUrl: getPageSourceUrl(htmlPath),
            status: page.status,
            error: page.error
          })
          existingPageIds.add(pageId)
        }
      }
    }
    generatedPages.sort((a, b) => a.pageNumber - b.pageNumber)

    const snapshotForGate = await buildSessionGenerationSnapshot(
      session as unknown as Record<string, unknown> | undefined,
      {
        includeHtml: true
      }
    )
    const responsePages = snapshotForGate.pages.length > 0 ? snapshotForGate.pages : generatedPages

    return {
      session: normalizeSession(
        snapshotForGate.session as unknown as Record<string, unknown> | undefined
      ),
      messages: messages.map((message) =>
        normalizeMessage(message as unknown as Record<string, unknown>)
      ),
      generatedPages: responsePages
    }
  })

  ipcMain.handle(
    'session:getMessages',
    async (_event, payload: { sessionId: string; chatType?: 'main' | 'page'; pageId?: string }) => {
      const chatType = payload?.chatType === 'page' ? 'page' : 'main'
      const pageId =
        chatType === 'page' &&
        typeof payload?.pageId === 'string' &&
        payload.pageId.trim().length > 0
          ? payload.pageId.trim()
          : undefined
      const messages = await db.getSessionMessages(payload.sessionId, {
        chatScope: chatType,
        pageId
      })
      return messages.map((message) =>
        normalizeMessage(message as unknown as Record<string, unknown>)
      )
    }
  )

  ipcMain.handle('session:delete', async (_event, sessionId) => {
    await db.deleteSession(sessionId)
    return { success: true }
  })
}
