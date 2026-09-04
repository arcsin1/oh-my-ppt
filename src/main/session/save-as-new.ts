import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { requireSessionSlideSize } from '@shared/slide-size'
import type { IpcContext } from '../ipc/context'
import { readAppLocale, uiText } from '../config/locale-utils'
import { ensureHistoryBaselineSafe } from '../history/git-history-service'
import { createSessionMasterIfMissing } from './master-service'

const copyDirectoryForNewSession = async (sourceDir: string, targetDir: string): Promise<void> => {
  await fs.promises.mkdir(targetDir, { recursive: true })
  const entries = await fs.promises.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'history') continue
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      await copyDirectoryForNewSession(sourcePath, targetPath)
    } else if (entry.isFile()) {
      await fs.promises.copyFile(sourcePath, targetPath)
    }
  }
}

const SESSION_TEXT_FILE_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.svg',
  '.txt',
  '.xml'
])

const replaceSessionIdInClonedTextFiles = async (
  projectDir: string,
  sourceSessionId: string,
  newSessionId: string
): Promise<void> => {
  const entries = await fs.promises.readdir(projectDir, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'history') continue
    const entryPath = path.join(projectDir, entry.name)
    if (entry.isDirectory()) {
      await replaceSessionIdInClonedTextFiles(entryPath, sourceSessionId, newSessionId)
      continue
    }
    if (!entry.isFile() || !SESSION_TEXT_FILE_EXTENSIONS.has(path.extname(entry.name))) continue

    const content = await fs.promises.readFile(entryPath, 'utf-8')
    if (!content.includes(sourceSessionId)) continue
    await fs.promises.writeFile(entryPath, content.replaceAll(sourceSessionId, newSessionId), 'utf-8')
  }
}

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string' || value.trim().length === 0) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

const parseOptionalJson = (value: unknown): unknown | null => {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

const remapClonedMetadataValue = (
  value: unknown,
  sourceProjectDir: string,
  targetProjectDir: string,
  sourceSessionId: string,
  newSessionId: string
): unknown => {
  if (typeof value === 'string') {
    return value
      .replaceAll(sourceSessionId, newSessionId)
      .replaceAll(sourceProjectDir, targetProjectDir)
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      remapClonedMetadataValue(
        item,
        sourceProjectDir,
        targetProjectDir,
        sourceSessionId,
        newSessionId
      )
    )
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        remapClonedMetadataValue(
          item,
          sourceProjectDir,
          targetProjectDir,
          sourceSessionId,
          newSessionId
        )
      ])
    )
  }
  return value
}

const resolveClonedProjectPath = (
  sourceProjectDir: string,
  targetProjectDir: string,
  candidatePath: string | null | undefined,
  fallbackRelativePath: string
): string => {
  const sourceRoot = path.resolve(sourceProjectDir)
  const targetRoot = path.resolve(targetProjectDir)
  const fallback = fallbackRelativePath.replace(/^[/\\]+/, '')
  const rawCandidate = typeof candidatePath === 'string' ? candidatePath.trim() : ''
  let relativePath = rawCandidate

  if (rawCandidate && path.isAbsolute(rawCandidate)) {
    relativePath = path.relative(sourceRoot, path.resolve(rawCandidate))
  }
  if (!relativePath) relativePath = fallback

  const normalizedRelative = relativePath.split(path.sep).join('/').replace(/^\/+/, '')
  if (
    !normalizedRelative ||
    normalizedRelative.startsWith('../') ||
    normalizedRelative === '..' ||
    path.isAbsolute(normalizedRelative)
  ) {
    return path.join(targetRoot, fallback)
  }
  return path.join(targetRoot, normalizedRelative)
}

const resolveClonedSessionDocumentPath = (
  sourceProjectDir: string,
  targetProjectDir: string,
  candidatePath: string | null | undefined,
  sourceSessionId?: string,
  newSessionId?: string
): string | null => {
  const rawCandidate = typeof candidatePath === 'string' ? candidatePath.trim() : ''
  if (!rawCandidate) return null
  if (
    sourceSessionId &&
    newSessionId &&
    rawCandidate === `legacy-outline:${sourceSessionId}`
  ) {
    return `legacy-outline:${newSessionId}`
  }
  if (rawCandidate.startsWith('/docs/')) return rawCandidate

  const sourceRoot = path.resolve(sourceProjectDir)
  let relativePath = rawCandidate
  if (path.isAbsolute(rawCandidate)) {
    relativePath = path.relative(sourceRoot, path.resolve(rawCandidate))
  }
  const normalizedRelative = relativePath.split(path.sep).join('/').replace(/^\/+/, '')
  if (
    !normalizedRelative.startsWith('docs/') ||
    normalizedRelative.startsWith('../') ||
    normalizedRelative === '..' ||
    path.isAbsolute(normalizedRelative)
  ) {
    return null
  }

  const targetPath = path.join(targetProjectDir, normalizedRelative)
  return fs.existsSync(targetPath) ? `/${normalizedRelative}` : null
}

export function registerSessionSaveAsNewHandler(ctx: IpcContext): void {
  const { db, resolveStoragePath, resolveSessionProjectDir, ensureSessionAssets, sessionRunStates } =
    ctx

  ipcMain.handle('session:saveAsNew', async (_event, payload: unknown) => {
    const locale = await readAppLocale(ctx)
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const sourceSessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
    if (!sourceSessionId) {
      throw new Error(uiText(locale, '会话 ID 不能为空', 'Session ID is required.'))
    }

    const sourceSession = await db.getSession(sourceSessionId)
    if (!sourceSession) {
      throw new Error(
        uiText(locale, '会话不存在或已被删除', 'The session does not exist or has been deleted.')
      )
    }

    const sourcePages = await db.listSessionPages(sourceSessionId)
    if (sourcePages.length === 0) {
      throw new Error(
        uiText(locale, '当前会话没有可另存的页面', 'This session has no pages to save as new.')
      )
    }

    const sourceProjectDir = await resolveSessionProjectDir(sourceSessionId)
    if (!fs.existsSync(sourceProjectDir)) {
      throw new Error(
        uiText(locale, '当前会话目录不存在，无法另存', 'The current session directory is missing.')
      )
    }

    const storagePath = await resolveStoragePath()
    const newSessionId = crypto.randomUUID()
    const targetProjectDir = path.join(storagePath, newSessionId)
    const baseTitle =
      typeof sourceSession.title === 'string' && sourceSession.title.trim()
        ? sourceSession.title.trim()
        : uiText(locale, '未命名会话', 'Untitled session')
    const requestedTitle = typeof record.title === 'string' ? record.title.trim() : ''
    if (Object.prototype.hasOwnProperty.call(record, 'title') && !requestedTitle) {
      throw new Error(uiText(locale, '会话名称不能为空', 'Session title is required.'))
    }
    if (requestedTitle.length > 120) {
      throw new Error(
        uiText(locale, '会话名称不能超过 120 个字符', 'Session title cannot exceed 120 characters.')
      )
    }
    const newTitle = requestedTitle || `${baseTitle}${uiText(locale, ' 副本', ' Copy')}`
    const sourceProvider =
      typeof sourceSession.provider === 'string' && sourceSession.provider.trim()
        ? sourceSession.provider
        : 'import'
    const sourceModel =
      typeof sourceSession.model === 'string' && sourceSession.model.trim()
        ? sourceSession.model
        : 'session-save-as-new'
    const sourceImageModelConfigId =
      typeof (sourceSession.imageModelConfigId ?? sourceSession.image_model_config_id) === 'string'
        ? String(sourceSession.imageModelConfigId ?? sourceSession.image_model_config_id).trim()
        : ''
    const sourceVisualEnabled =
      (sourceSession.visualEnabled === 1 || sourceSession.visual_enabled === 1) &&
      Boolean(sourceImageModelConfigId)

    try {
      await copyDirectoryForNewSession(sourceProjectDir, targetProjectDir)
      await replaceSessionIdInClonedTextFiles(targetProjectDir, sourceSessionId, newSessionId)
      await ensureSessionAssets(targetProjectDir)
      await createSessionMasterIfMissing(targetProjectDir)
      const referenceDocumentPath = resolveClonedSessionDocumentPath(
        sourceProjectDir,
        targetProjectDir,
        sourceSession.referenceDocumentPath ?? sourceSession.reference_document_path,
        sourceSessionId,
        newSessionId
      )
      const slideSize = requireSessionSlideSize(sourceSession)

      await db.createSession({
        id: newSessionId,
        title: newTitle,
        topic: sourceSession.topic || baseTitle,
        styleId: sourceSession.styleId ?? undefined,
        pageCount: sourcePages.length,
        slideSizeId: slideSize.id,
        slideWidth: slideSize.width,
        slideHeight: slideSize.height,
        referenceDocumentPath,
        visualEnabled: sourceVisualEnabled,
        imageModelConfigId: sourceVisualEnabled ? sourceImageModelConfigId : null,
        provider: sourceProvider,
        model: sourceModel
      })
      await db.copySessionStyleSnapshot(sourceSessionId, newSessionId)

      const designContract = parseOptionalJson(sourceSession.designContract)
      if (designContract) {
        await db.updateSessionDesignContract(newSessionId, designContract)
      }

      const projectId = await db.createProject({
        session_id: newSessionId,
        title: newTitle,
        output_path: targetProjectDir,
        root_path: targetProjectDir
      })

      for (const page of sourcePages) {
        const htmlPath = resolveClonedProjectPath(
          sourceProjectDir,
          targetProjectDir,
          page.html_path,
          `${page.file_slug}.html`
        )
        if (!fs.existsSync(htmlPath)) {
          throw new Error(
            uiText(
              locale,
              `页面文件缺失，无法另存：${page.file_slug}`,
              `Page file is missing, cannot save as new session: ${page.file_slug}`
            )
          )
        }
        await db.upsertSessionPage({
          id: crypto.randomUUID(),
          sessionId: newSessionId,
          legacyPageId: page.legacy_page_id,
          fileSlug: page.file_slug,
          pageNumber: page.page_number,
          title: page.title,
          htmlPath,
          layoutIntent: page.layout_intent,
          layoutId: page.layout_id,
          layoutContractVersion: page.layout_contract_version,
          status: page.status,
          error: page.error
        })
      }

      const sourceSkeletons = await db.listSourcePageSkeletons(sourceSessionId)
      for (const skeleton of sourceSkeletons) {
        await db.upsertSourcePageSkeleton({
          sessionId: newSessionId,
          pageNumber: skeleton.page_number,
          title: skeleton.title,
          role: skeleton.role,
          sourceDocumentPath:
            resolveClonedSessionDocumentPath(
              sourceProjectDir,
              targetProjectDir,
              skeleton.source_document_path,
              sourceSessionId,
              newSessionId
            ) || skeleton.source_document_path,
          sourceDocumentName: skeleton.source_document_name,
          sourceHeading: skeleton.source_heading,
          headingLevel: skeleton.heading_level,
          lineStart: skeleton.line_start,
          lineEnd: skeleton.line_end,
          reason: skeleton.reason,
          confidence: skeleton.confidence
        })
      }

      const sourceMetadata = remapClonedMetadataValue(
        parseJsonObject(sourceSession.metadata),
        sourceProjectDir,
        targetProjectDir,
        sourceSessionId,
        newSessionId
      ) as Record<string, unknown>
      await db.updateSessionMetadata(newSessionId, {
        ...sourceMetadata,
        source: 'session-save-as-new',
        savedAsNewSessionFrom: sourceSessionId,
        savedAsNewSessionAt: Date.now(),
        entryMode:
          typeof sourceMetadata.entryMode === 'string' && sourceMetadata.entryMode.trim()
            ? sourceMetadata.entryMode
            : 'multi_page',
        indexPath: path.join(targetProjectDir, 'index.html'),
        projectId
      })
      await db.updateProjectStatus(projectId, 'draft')
      await db.updateSessionStatus(newSessionId, 'completed')
      await db.updateSessionHistoryPointer({
        sessionId: newSessionId,
        operationId: null,
        commit: null
      })
      await ensureHistoryBaselineSafe(db, newSessionId, targetProjectDir)
      sessionRunStates.delete(newSessionId)

      log.info('[session:saveAsNew] completed', {
        sourceSessionId,
        newSessionId,
        pageCount: sourcePages.length,
        targetProjectDir
      })

      return { sessionId: newSessionId }
    } catch (error) {
      await fs.promises.rm(targetProjectDir, { recursive: true, force: true }).catch(() => {})
      await db.deleteSession(newSessionId).catch(() => {})
      throw error
    }
  })
}
