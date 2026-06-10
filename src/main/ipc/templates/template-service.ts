import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import { LRUCache } from 'lru-cache'
import type { IpcContext } from '../context'
import {
  resolveGlobalModelTimeouts,
  resolveModelConfigForTask
} from '../config/model-config-utils'
import { buildProjectIndexHtml, type DeckPageFile } from '../engine/template'
import { buildDesignContractWithLLM } from '../engine/generate'
import { parseJsonObject } from '../utils'
import { normalizeSourcePlan } from '../generation/source-plan'
import { importPptxToEditableHtml, type PptxImportProgressPayload } from '../../utils/pptx-importer'
import { createPptxChartRewriteHandler } from '../../utils/pptx-chart-rewrite-agent'
import { extractStyleFromExistingHtml } from '../../utils/style-pptx-import'
import { createStyleSkill, resolveUsableStyleId } from '../../utils/style-skills'
import { recordHistoryOperationStrict } from '../../history/git-history-service'
import { copyDirExcluding } from './template-copy'
import { resolveTemplateDesignContract } from './template-design-contract'
import {
  manifestToListItem,
  parseTemplateManifest,
  type TemplateListItem,
  type TemplateManifest
} from './template-manifest'
import {
  createLowercaseId,
  createTemplateId,
  ensureTemplatesRoot,
  resolveTemplateDir,
  resolveTemplateManifestPath,
  resolveTemplateRelativePath
} from './template-paths'

type CacheValue = { manifest: TemplateManifest; templateDir: string }
type PreparedTemplatePage = {
  id: string
  pageNumber: number
  pageId: string
  title: string
  htmlPath: string
  sourceTemplatePageNumber: number
}

const templateManifestCache = new LRUCache<string, CacheValue>({
  max: 200,
  ttl: 30 * 1000
})

const templateListCache = new LRUCache<string, TemplateListItem[]>({
  max: 20,
  ttl: 30 * 1000
})

const MAX_TEMPLATE_PPTX_SIZE = 80 * 1024 * 1024

function clearTemplateCache(templatesRoot: string, templateId?: string): void {
  templateListCache.delete(`list:${templatesRoot}`)
  if (templateId) templateManifestCache.delete(`manifest:${templatesRoot}:${templateId}`)
}

function createTemplateSessionId(): string {
  return crypto.randomUUID()
}

function createTemplateSessionPageId(): string {
  return `page_${createLowercaseId()}`
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 12)
  }
  if (typeof value === 'string') {
    return value
      .split(/[,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 12)
  }
  return []
}

function resolveTemplateListPaths(templateDir: string, manifest: TemplateManifest): {
  previewHtmlPath: string | null
  previewPages: Array<{
    pageNumber: number
    pageId: string
    title: string
    htmlPath: string
  }>
} {
  const previewPages = manifest.pages
    .map((page) => {
      const htmlPath = resolveTemplateRelativePath(templateDir, page.htmlPath)
      if (!htmlPath || !fs.existsSync(htmlPath)) return null
      return {
        pageNumber: page.pageNumber,
        pageId: page.pageId,
        title: page.title,
        htmlPath
      }
    })
    .filter((page): page is NonNullable<typeof page> => Boolean(page))
  const previewHtmlPath = previewPages[0]?.htmlPath || null
  return {
    previewHtmlPath,
    previewPages
  }
}

async function readManifest(templatesRoot: string, templateId: string): Promise<CacheValue> {
  const cacheKey = `manifest:${templatesRoot}:${templateId}`
  const cached = templateManifestCache.get(cacheKey)
  if (cached) return cached
  const templateDir = resolveTemplateDir(templatesRoot, templateId)
  const manifestPath = resolveTemplateManifestPath(templatesRoot, templateId)
  const raw = await fs.promises.readFile(manifestPath, 'utf-8')
  const manifest = parseTemplateManifest(JSON.parse(raw))
  const value = { manifest, templateDir }
  templateManifestCache.set(cacheKey, value)
  return value
}

async function writeManifest(templateDir: string, manifest: TemplateManifest): Promise<void> {
  await fs.promises.writeFile(
    path.join(templateDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  )
}

async function copyReferenceDocumentToSession(args: {
  sourcePath: string
  storageRoot: string
  projectDir: string
}): Promise<string | null> {
  const sourcePath = args.sourcePath.trim()
  if (!sourcePath) return null
  const resolvedSourcePath = path.resolve(sourcePath)
  if (!fs.existsSync(resolvedSourcePath)) throw new Error('解析后的文档不存在，请重新解析文档')

  const sourceRealPath = await fs.promises.realpath(resolvedSourcePath)
  const relativeToStorage = path.relative(args.storageRoot, sourceRealPath)
  if (relativeToStorage.startsWith('..') || path.isAbsolute(relativeToStorage)) {
    throw new Error('文档路径不在用户配置目录内，请重新解析文档')
  }

  const docsDir = path.join(args.projectDir, 'docs')
  await fs.promises.mkdir(docsDir, { recursive: true })
  const ext = path.extname(sourceRealPath).toLowerCase() || '.md'
  const fileName = `${Date.now()}${ext}`
  await fs.promises.copyFile(sourceRealPath, path.join(docsDir, fileName))
  return `/docs/${fileName}`
}

function pickTemplateSourcePage(
  pages: TemplateManifest['pages'],
  outputIndex: number,
  totalPages: number
): TemplateManifest['pages'][number] {
  if (pages.length === 1 || totalPages === 1) return pages[0]
  if (outputIndex === 0) return pages[0]
  if (outputIndex === totalPages - 1) return pages[pages.length - 1]

  const middlePages = pages.slice(1, -1)
  if (middlePages.length === 0) return pages[0]
  const middleOutputCount = Math.max(1, totalPages - 2)
  const middleOutputIndex = outputIndex - 1
  const sourceIndex =
    middleOutputCount === 1
      ? 0
      : Math.round((middleOutputIndex * (middlePages.length - 1)) / (middleOutputCount - 1))
  return middlePages[Math.max(0, Math.min(middlePages.length - 1, sourceIndex))]
}

function replacePageIdentity(html: string, oldPageId: string, nextPageId: string): string {
  const oldId = oldPageId.trim()
  if (!oldId || oldId === nextPageId) return html
  const escapedOldId = oldId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const boundaryPattern = new RegExp(`(^|[^A-Za-z0-9_-])${escapedOldId}(?=$|[^A-Za-z0-9_-])`, 'g')
  return html.replace(boundaryPattern, `$1${nextPageId}`)
}

function rewriteTemplatePageIdentities(
  html: string,
  idMap: Map<string, string>,
  sourcePageId: string,
  targetPageId: string
): string {
  let rewritten = html
  for (const [oldPageId, newPageId] of idMap) {
    rewritten = replacePageIdentity(rewritten, oldPageId, newPageId)
  }
  return replacePageIdentity(rewritten, sourcePageId, targetPageId)
}

async function prepareTemplatePagesForSession(args: {
  manifest: TemplateManifest
  projectDir: string
  totalPages: number
}): Promise<PreparedTemplatePage[]> {
  const templatePages = args.manifest.pages.slice().sort((a, b) => a.pageNumber - b.pageNumber)
  if (templatePages.length === 0) throw new Error('模板没有可用页面')

  const usedTargetPaths = new Set<string>()
  const sourceHtmlPaths = new Set(templatePages.map((page) => page.htmlPath.replace(/\\/g, '/')))
  const pagePlan = Array.from({ length: args.totalPages }, (_unused, outputIndex) => {
    const pageNumber = outputIndex + 1
    const sourcePage = pickTemplateSourcePage(templatePages, outputIndex, args.totalPages)
    return {
      pageNumber,
      sourcePage,
      pageId: `page-${createLowercaseId()}`,
      id: createTemplateSessionPageId()
    }
  })
  const sourceIdToFirstTargetId = new Map<string, string>()
  for (const item of pagePlan) {
    if (!sourceIdToFirstTargetId.has(item.sourcePage.pageId)) {
      sourceIdToFirstTargetId.set(item.sourcePage.pageId, item.pageId)
    }
  }

  const preparedPages: PreparedTemplatePage[] = []
  for (const item of pagePlan) {
    const { pageNumber, sourcePage, pageId } = item
    const sourcePath = path.resolve(args.projectDir, sourcePage.htmlPath)
    const relativeToProject = path.relative(args.projectDir, sourcePath)
    if (relativeToProject.startsWith('..') || path.isAbsolute(relativeToProject)) {
      throw new Error('模板页面路径越界')
    }
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`模板页面不存在：${sourcePage.htmlPath}`)
    }

    const relativeHtmlPath = `${pageId}.html`
    const targetPath = path.resolve(args.projectDir, relativeHtmlPath)
    const html = await fs.promises.readFile(sourcePath, 'utf-8')
    await fs.promises.writeFile(
      targetPath,
      rewriteTemplatePageIdentities(html, sourceIdToFirstTargetId, sourcePage.pageId, pageId),
      'utf-8'
    )
    usedTargetPaths.add(path.relative(args.projectDir, targetPath).replace(/\\/g, '/'))
    preparedPages.push({
      id: item.id,
      pageNumber,
      pageId,
      title: `第 ${pageNumber} 页`,
      htmlPath: targetPath,
      sourceTemplatePageNumber: sourcePage.pageNumber
    })
  }

  await Promise.all(
    Array.from(sourceHtmlPaths).map(async (relativeHtmlPath) => {
      if (usedTargetPaths.has(relativeHtmlPath)) return
      const sourcePath = path.resolve(args.projectDir, relativeHtmlPath)
      const relativeToProject = path.relative(args.projectDir, sourcePath)
      if (relativeToProject.startsWith('..') || path.isAbsolute(relativeToProject)) return
      await fs.promises.rm(sourcePath, { force: true })
    })
  )
  await fs.promises.rm(path.join(args.projectDir, 'manifest.json'), { force: true })

  return preparedPages
}

export async function listTemplates(): Promise<{ items: TemplateListItem[] }> {
  const templatesRoot = await ensureTemplatesRoot()
  const cacheKey = `list:${templatesRoot}`
  const cached = templateListCache.get(cacheKey)
  if (cached) return { items: cached }

  const entries = await fs.promises.readdir(templatesRoot, { withFileTypes: true }).catch(() => [])
  const items: TemplateListItem[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      const { manifest, templateDir } = await readManifest(templatesRoot, entry.name)
      items.push(manifestToListItem(manifest, resolveTemplateListPaths(templateDir, manifest)))
    } catch {
      // Ignore malformed template folders; they should not break the template library.
    }
  }

  items.sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
  templateListCache.set(cacheKey, items)
  return { items }
}

export async function getTemplate(templateId: string): Promise<{
  manifest: TemplateManifest
  previewHtmlPath: string | null
}> {
  const templatesRoot = await ensureTemplatesRoot()
  const { manifest, templateDir } = await readManifest(templatesRoot, templateId)
  return {
    manifest,
    ...resolveTemplateListPaths(templateDir, manifest)
  }
}

export async function updateTemplateMetadata(payload: unknown): Promise<{
  success: true
  item: TemplateListItem
}> {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const templateId = typeof record.templateId === 'string' ? record.templateId.trim() : ''
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!name) throw new Error('模板名称不能为空')

  const templatesRoot = await ensureTemplatesRoot()
  const { manifest, templateDir } = await readManifest(templatesRoot, templateId)
  const nextManifest: TemplateManifest = {
    ...manifest,
    name,
    description: typeof record.description === 'string' ? record.description.trim() : '',
    tags: normalizeTags(record.tags),
    updatedAt: Date.now()
  }
  await writeManifest(templateDir, nextManifest)
  clearTemplateCache(templatesRoot, templateId)
  return {
    success: true,
    item: manifestToListItem(nextManifest, resolveTemplateListPaths(templateDir, nextManifest))
  }
}

export async function createTemplateFromSession(
  ctx: IpcContext,
  payload: unknown
): Promise<{ success: true; id: string }> {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
  if (!sessionId) throw new Error('缺少 sessionId')

  const session = await ctx.db.getSession(sessionId)
  if (!session) throw new Error('Session not found')
  const projectDir = await ctx.resolveSessionProjectDir(sessionId)
  const pages = (await ctx.db.listSessionPages(sessionId)).filter((page) => page.status === 'completed')
  if (pages.length === 0) throw new Error('至少生成 1 页后才能保存为模板')

  const templatesRoot = await ensureTemplatesRoot()
  const templateId = createTemplateId()
  const templateDir = resolveTemplateDir(templatesRoot, templateId)
  await fs.promises.mkdir(templateDir, { recursive: true })
  await copyDirExcluding(projectDir, templateDir)

  const projectRoot = path.resolve(projectDir)
  const templatePages = pages
    .map((page) => {
      const sourcePath = path.isAbsolute(page.html_path)
        ? path.resolve(page.html_path)
        : path.resolve(projectRoot, page.html_path)
      if (!sourcePath || !fs.existsSync(sourcePath)) return null
      const relativeHtmlPath = path.relative(projectRoot, sourcePath)
      if (relativeHtmlPath.startsWith('..') || path.isAbsolute(relativeHtmlPath)) return null
      return {
        page,
        htmlPath: relativeHtmlPath
      }
    })
    .filter((item): item is { page: (typeof pages)[number]; htmlPath: string } => Boolean(item))
  if (templatePages.length === 0) throw new Error('没有可保存的页面文件')

  const now = Date.now()
  const metadata = parseJsonObject(session.metadata)
  const designContract = resolveTemplateDesignContract(session.designContract, metadata)
  const styleId = session.styleId || null

  const inputName = typeof record.name === 'string' ? record.name.trim() : ''
  const inputDescription = typeof record.description === 'string' ? record.description.trim() : ''
  const manifest: TemplateManifest = {
    schemaVersion: 1,
    id: templateId,
    name: inputName || session.title || '未命名模板',
    description: inputDescription,
    sourceSessionId: sessionId,
    createdAt: now,
    updatedAt: now,
    pageCount: templatePages.length,
    tags: normalizeTags(record.tags),
    styleId,
    designContract,
    pages: templatePages.map(({ page, htmlPath }, index) => {
      return {
        pageNumber: page.page_number || index + 1,
        pageId: page.file_slug,
        title: page.title || `第 ${index + 1} 页`,
        htmlPath
      }
    })
  }

  await writeManifest(templateDir, manifest)
  clearTemplateCache(templatesRoot, templateId)
  return { success: true, id: templateId }
}

export async function importPptxAsTemplate(
  ctx: IpcContext,
  payload: unknown,
  onProgress?: (progress: PptxImportProgressPayload) => void
): Promise<{ success: true; id: string; pageCount: number; warnings: string[] }> {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const rawFilePath = typeof record.filePath === 'string' ? record.filePath.trim() : ''
  const inputName = typeof record.name === 'string' ? record.name.trim() : ''
  if (!rawFilePath) throw new Error('PPTX 文件路径不能为空')

  const sourcePath = await ctx.resolveExistingFileRealPath(rawFilePath)
  if (path.extname(sourcePath).toLowerCase() !== '.pptx') {
    throw new Error('仅支持导入 .pptx 文件')
  }
  const stat = await fs.promises.stat(sourcePath)
  if (stat.size > MAX_TEMPLATE_PPTX_SIZE) {
    throw new Error('PPTX 文件不能超过 80MB')
  }

  const originalFileName = path.basename(sourcePath)
  const title = inputName || path.basename(originalFileName, path.extname(originalFileName)) || '导入的 PPTX 模板'
  const templatesRoot = await ensureTemplatesRoot()
  const templateId = createTemplateId()
  const templateDir = resolveTemplateDir(templatesRoot, templateId)
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ohmyppt-template-pptx-'))
  const modelConfigId =
    typeof record.modelConfigId === 'string' ? record.modelConfigId.trim() : undefined
  const activeModel = await resolveModelConfigForTask(ctx, {
    modelConfigId,
    purpose: 'templates:importPptx'
  })
  const modelTimeouts = await resolveGlobalModelTimeouts(ctx)

  try {
    await ctx.ensureSessionAssets(tempDir)
    const imported = await importPptxToEditableHtml({
      filePath: sourcePath,
      projectDir: tempDir,
      title,
      onProgress,
      chartRewrite: createPptxChartRewriteHandler({
        provider: activeModel.provider,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        baseUrl: activeModel.baseUrl,
        maxTokens: activeModel.maxTokens,
        modelTimeoutMs: modelTimeouts.document
      })
    })
    if (imported.pages.length === 0) {
      throw new Error('PPTX 未解析出可用页面')
    }

    onProgress?.({
      stage: 'database',
      progress: 92,
      label: '正在抽取模板风格',
      totalPages: imported.pageCount
    })
    const styleResult = await extractStyleFromExistingHtml({
      projectDir: tempDir,
      pageHtmlPaths: imported.pages.map((page) => path.basename(page.htmlPath)),
      sourceFilePath: sourcePath,
      provider: activeModel.provider,
      apiKey: activeModel.apiKey,
      model: activeModel.model,
      baseUrl: activeModel.baseUrl,
      maxTokens: activeModel.maxTokens,
      modelTimeoutMs: modelTimeouts.document
    })
    const styleId = `style-${createLowercaseId()}`
    await createStyleSkill({
      id: styleId,
      label: styleResult.label,
      description: styleResult.description,
      category: styleResult.category,
      aliases: styleResult.aliases,
      prompt: styleResult.styleSkill,
      styleCase: styleResult.styleCase
    })

    onProgress?.({
      stage: 'database',
      progress: 94,
      label: '正在生成模板设计契约',
      totalPages: imported.pageCount
    })
    const designContract = await buildDesignContractWithLLM({
      provider: activeModel.provider,
      apiKey: activeModel.apiKey,
      model: activeModel.model,
      baseUrl: activeModel.baseUrl,
      maxTokens: activeModel.maxTokens,
      styleId,
      styleSkillPrompt: styleResult.styleSkill,
      modelTimeoutMs: modelTimeouts.document,
      totalPages: imported.pageCount,
      topic: title
    })

    onProgress?.({
      stage: 'database',
      progress: 96,
      label: '正在写入模板',
      totalPages: imported.pageCount
    })

    await fs.promises.mkdir(templateDir, { recursive: true })
    await copyDirExcluding(tempDir, templateDir)

    const now = Date.now()
    const manifest: TemplateManifest = {
      schemaVersion: 1,
      id: templateId,
      name: imported.title || title,
      description: '',
      createdAt: now,
      updatedAt: now,
      pageCount: imported.pageCount,
      tags: [],
      styleId,
      designContract,
      pages: imported.pages.map((page, index) => {
        const relativeHtmlPath = path.relative(tempDir, page.htmlPath).split(path.sep).join('/')
        return {
          pageNumber: page.pageNumber || index + 1,
          pageId: page.pageId,
          title: page.title || `第 ${index + 1} 页`,
          htmlPath:
            relativeHtmlPath && !relativeHtmlPath.startsWith('..') && !path.isAbsolute(relativeHtmlPath)
              ? relativeHtmlPath
              : `${page.pageId}.html`
        }
      })
    }

    await writeManifest(templateDir, manifest)
    clearTemplateCache(templatesRoot, templateId)

    onProgress?.({
      stage: 'completed',
      progress: 100,
      label: '模板导入完成',
      totalPages: imported.pageCount
    })

    return { success: true, id: templateId, pageCount: imported.pageCount, warnings: imported.warnings }
  } catch (error) {
    await fs.promises.rm(templateDir, { recursive: true, force: true }).catch(() => undefined)
    throw error
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function deleteTemplate(templateId: string): Promise<{ success: true; deleted: boolean }> {
  const templatesRoot = await ensureTemplatesRoot()
  const templateDir = resolveTemplateDir(templatesRoot, templateId)
  if (!fs.existsSync(templateDir)) return { success: true, deleted: false }
  await fs.promises.rm(templateDir, { recursive: true, force: true })
  clearTemplateCache(templatesRoot, templateId)
  return { success: true, deleted: true }
}

export async function createSessionFromTemplate(
  ctx: IpcContext,
  payload: unknown
): Promise<{ success: true; sessionId: string }> {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const templateId = typeof record.templateId === 'string' ? record.templateId.trim() : ''
  const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : ''
  const requestedPageCount = Number(record.pageCount)
  const pageCount = Number.isFinite(requestedPageCount)
    ? Math.max(1, Math.min(500, Math.floor(requestedPageCount)))
    : undefined
  const referenceDocumentPath =
    typeof record.referenceDocumentPath === 'string' ? record.referenceDocumentPath.trim() : ''
  const sourcePlan = normalizeSourcePlan(record.sourcePlan)

  const templatesRoot = await ensureTemplatesRoot()
  const { manifest, templateDir } = await readManifest(templatesRoot, templateId)
  if (manifest.pages.length === 0) throw new Error('模板没有可创建的页面')

  const modelConfigId =
    typeof record.modelConfigId === 'string' ? record.modelConfigId.trim() : undefined
  const activeModel = await resolveModelConfigForTask(ctx, {
    modelConfigId,
    purpose: 'templates:createSession'
  })
  const storagePath = await ctx.resolveStoragePath()
  const storageRoot = fs.existsSync(storagePath)
    ? await fs.promises.realpath(storagePath)
    : path.resolve(storagePath)
  const sessionId = createTemplateSessionId()
  const styleId = resolveUsableStyleId(manifest.styleId)
  const projectDir = path.join(storagePath, sessionId)
  const deckTitle = title || manifest.name || '从模板创建的演示'
  const resolvedPageCount = pageCount || manifest.pageCount || manifest.pages.length
  await fs.promises.mkdir(projectDir, { recursive: true })
  await copyDirExcluding(templateDir, projectDir, { exclude: ['manifest.json'] })
  await ctx.ensureSessionAssets(projectDir)
  const preparedPages = await prepareTemplatePagesForSession({
    manifest,
    projectDir,
    totalPages: resolvedPageCount
  })
  const indexPages: DeckPageFile[] = preparedPages.map((page) => ({
    id: page.id,
    pageNumber: page.pageNumber,
    pageId: page.pageId,
    title: page.title,
    htmlPath: path.basename(page.htmlPath)
  }))
  const indexPath = path.join(projectDir, 'index.html')
  await fs.promises.writeFile(indexPath, buildProjectIndexHtml(deckTitle, indexPages), 'utf-8')
  const userReferenceDocumentPath = await copyReferenceDocumentToSession({
    sourcePath: referenceDocumentPath,
    storageRoot,
    projectDir
  })
  await ctx.agentManager.createSession({
    sessionId,
    provider: activeModel.provider,
    model: activeModel.model,
    baseUrl: activeModel.baseUrl,
    projectDir,
    topic: deckTitle,
    styleId,
    pageCount: resolvedPageCount,
    referenceDocumentPath: userReferenceDocumentPath
  })
  if (sourcePlan && userReferenceDocumentPath) {
    await ctx.db.replaceSourcePageSkeletons({
      sessionId,
      sourceDocumentPath: userReferenceDocumentPath,
      sourceDocumentName: sourcePlan.sourceDocumentName || path.basename(userReferenceDocumentPath),
      confidence: sourcePlan.confidence,
      items: sourcePlan.pageSkeleton
    })
  }
  const designContract = resolveTemplateDesignContract(manifest.designContract)
  await ctx.db.updateSessionDesignContract(sessionId, designContract)
  const projectId = await ctx.db.createProject({
    session_id: sessionId,
    title: deckTitle,
    output_path: projectDir,
    root_path: projectDir
  })
  for (const page of preparedPages) {
    await ctx.db.upsertSessionPage({
      id: page.id,
      sessionId,
      legacyPageId: null,
      fileSlug: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      htmlPath: page.htmlPath,
      status: 'pending',
      error: null
    })
  }

  const metadata = {
    source: 'template',
    templateId,
    createdFromTemplateAt: Date.now(),
    indexPath,
    projectId
  }
  await ctx.db.updateSessionMetadata(sessionId, metadata)
  await ctx.db.updateProjectStatus(projectId, 'draft')

  return { success: true, sessionId }
}

export async function createEditableSessionFromTemplate(
  ctx: IpcContext,
  payload: unknown
): Promise<{ success: true; sessionId: string }> {
  const record = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const templateId = typeof record.templateId === 'string' ? record.templateId.trim() : ''
  const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : ''

  const templatesRoot = await ensureTemplatesRoot()
  const { manifest, templateDir } = await readManifest(templatesRoot, templateId)
  if (manifest.pages.length === 0) throw new Error('模板没有可创建的页面')

  const storagePath = await ctx.resolveStoragePath()
  const sessionId = createTemplateSessionId()
  const styleId = resolveUsableStyleId(manifest.styleId)
  const projectDir = path.join(storagePath, sessionId)
  const deckTitle = title || manifest.name || '从模板创建的演示'

  await fs.promises.mkdir(projectDir, { recursive: true })
  await copyDirExcluding(templateDir, projectDir, { exclude: ['manifest.json'] })
  await ctx.ensureSessionAssets(projectDir)
  const preparedPages = await prepareTemplatePagesForSession({
    manifest,
    projectDir,
    totalPages: manifest.pageCount || manifest.pages.length
  })
  const indexPages: DeckPageFile[] = preparedPages.map((page) => ({
    id: page.id,
    pageNumber: page.pageNumber,
    pageId: page.pageId,
    title: page.title,
    htmlPath: path.basename(page.htmlPath)
  }))
  const indexPath = path.join(projectDir, 'index.html')
  await fs.promises.writeFile(indexPath, buildProjectIndexHtml(deckTitle, indexPages), 'utf-8')

  await ctx.db.createSession({
    id: sessionId,
    title: deckTitle,
    topic: deckTitle,
    styleId,
    pageCount: preparedPages.length,
    provider: 'import',
    model: 'template-direct-edit'
  })
  const designContract = resolveTemplateDesignContract(manifest.designContract)
  await ctx.db.updateSessionDesignContract(sessionId, designContract)
  const projectId = await ctx.db.createProject({
    session_id: sessionId,
    title: deckTitle,
    output_path: projectDir,
    root_path: projectDir
  })
  const runId = await ctx.db.createGenerationRun({
    sessionId,
    mode: 'import',
    totalPages: preparedPages.length,
    metadata: {
      source: 'template-direct-edit',
      templateId
    }
  })
  for (const page of preparedPages) {
    await ctx.db.upsertSessionPage({
      id: page.id,
      sessionId,
      legacyPageId: null,
      fileSlug: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      htmlPath: page.htmlPath,
      status: 'completed',
      error: null
    })
    await ctx.db.upsertGenerationPage({
      runId,
      sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      contentOutline: '',
      layoutIntent: null,
      htmlPath: page.htmlPath,
      status: 'completed'
    })
  }

  const metadata = {
    source: 'template-direct-edit',
    templateId,
    createdFromTemplateAt: Date.now(),
    indexPath,
    projectId,
    entryMode: 'direct_edit'
  }
  await ctx.db.updateSessionMetadata(sessionId, metadata)
  await ctx.db.updateGenerationRunStatus(runId, 'completed')
  await ctx.db.updateProjectStatus(projectId, 'draft')
  await ctx.db.updateSessionStatus(sessionId, 'completed')
  await recordHistoryOperationStrict(ctx.db, {
    sessionId,
    projectDir,
    type: 'import',
    scope: 'session',
    prompt: `从模板直接创建：${manifest.name}`,
    metadata: {
      runId,
      source: 'template-direct-edit',
      templateId,
      pageCount: preparedPages.length
    }
  })

  return { success: true, sessionId }
}
