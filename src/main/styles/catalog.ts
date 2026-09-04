import type { PPTDatabase, StyleRow } from '../db/database'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { unzipSync, zipSync } from 'fflate'
import {
  atomicCopyDirectory,
  readStylePackage,
  styleRowToPackageJson,
  type StylePackage,
  writeStylePackage
} from './style-package'
import { getInstalledStylesPath } from './style-runtime'

export type StyleSource = 'builtin' | 'custom' | 'override'
type ImportedStyleSource = Exclude<StyleSource, 'builtin'>

export interface StylePreset {
  id: string
  label: string
  aliases: string[]
  description: string
  fallbackPrompt: string
}

export interface LoadStyleSkillOptions {}

export interface StyleCatalogItem {
  id: string
  styleKey: string
  label: string
  description: string
  category: string
  source: StyleSource
  editable: boolean
  styleCase: string
  imageGenerationPrompt: string
}

let _db: PPTDatabase | null = null

export function setStyleDb(db: PPTDatabase): void {
  _db = db
}

function getDb(): PPTDatabase {
  if (!_db) throw new Error('Style DB not initialized. Call setStyleDb() first.')
  return _db
}

function normalize(input: string): string {
  return input.trim().toLowerCase()
}

function normalizeAlias(alias: string): string {
  return normalize(alias).replace(/\s+/g, '-')
}

function normalizeStyleId(styleId: string): string {
  const normalized = normalize(styleId)
  if (!/^[a-z0-9-]{3,40}$/.test(normalized)) {
    throw new Error('styleId 仅允许小写字母/数字/连字符，长度 3-40。')
  }
  return normalized
}

function rowToPreset(row: StyleRow): StylePreset {
  return {
    id: row.id,
    label: row.styleName,
    aliases: JSON.parse(row.aliases || '[]'),
    description: row.description,
    fallbackPrompt: row.description
      ? `Use ${row.style} style: ${row.description}`
      : `Use ${row.style} style.`
  }
}

function getUserStyleDir(styleId: string): string {
  const root = getInstalledStylesPath()
  if (!root) throw new Error('Style runtime not initialized.')
  return path.join(root, 'user', styleId)
}

function getStylePackageDir(row: StyleRow): string {
  const root = getInstalledStylesPath()
  if (!root) throw new Error('Style runtime not initialized.')
  if (row.packageDir) return path.join(root, row.packageDir)
  return row.source === 'builtin' ? path.join(root, 'system', row.style) : path.join(root, 'user', row.id)
}

export function getStylePackageDirectory(styleId: string): string {
  const db = getDb()
  const id = normalizeStyleId(styleId)
  const row = db.getStyleRowSync(id)
  if (!row) throw new Error('style 不存在：' + styleId)
  return getStylePackageDir(row)
}

export async function saveGeneratedStylePreview(
  styleId: string,
  previewHtml: string
): Promise<{ previewPath: string }> {
  const db = getDb()
  const id = normalizeStyleId(styleId)
  const row = db.getStyleRowSync(id)
  if (!row) throw new Error('style 不存在：' + styleId)

  const sourceDir = getStylePackageDir(row)
  const sourcePackage = await readStylePackage(sourceDir)
  if (sourcePackage.previewPath) {
    throw new Error('该风格已有预览，无需重复生成。')
  }

  if (row.source === 'builtin') {
    const targetDir = getUserStyleDir(id)
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-preview-save-'))
    const tempDir = path.join(tempRoot, id)
    try {
      await writeStylePackage({
        dir: tempDir,
        json: { ...sourcePackage.json, source: 'override' },
        skillMarkdown: sourcePackage.skillMarkdown,
        previewHtml
      })
      await atomicCopyDirectory(tempDir, targetDir)
      await db.updateStyleRow(id, {
        source: 'override',
        packageDir: 'user/' + id
      })
      return { previewPath: path.join(targetDir, 'preview.html') }
    } finally {
      await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-preview-save-'))
  const tempDir = path.join(tempRoot, id)
  const pendingPreviewPath = path.join(sourceDir, `.preview-${path.basename(tempRoot)}.tmp`)
  const previewPath = path.join(sourceDir, 'preview.html')
  try {
    await writeStylePackage({
      dir: tempDir,
      json: sourcePackage.json,
      skillMarkdown: sourcePackage.skillMarkdown,
      previewHtml
    })
    await fs.promises.copyFile(path.join(tempDir, 'preview.html'), pendingPreviewPath)
    await fs.promises.rename(pendingPreviewPath, previewPath)
    return { previewPath }
  } finally {
    await fs.promises.rm(pendingPreviewPath, { force: true }).catch(() => undefined)
    await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function writeUserStylePackage(
  row: StyleRow,
  options: { rootPath?: string } = {}
): Promise<void> {
  const skillMarkdown = String(row.styleSkill || '').trim()
  if (!skillMarkdown) {
    throw new Error(formatUserStylePackageBackfillError(row.id, 'style_skill 为空，无法生成 SKILL.md'))
  }
  const dir = options.rootPath ? path.join(options.rootPath, 'user', row.id) : getUserStyleDir(row.id)
  let json: ReturnType<typeof styleRowToPackageJson>
  try {
    json = styleRowToPackageJson({
      style: row.style,
      styleName: row.styleName,
      styleNameZh: row.styleNameZh || row.styleName,
      styleNameEn: row.styleNameEn || '',
      description: row.description,
      category: row.category,
      aliases: row.aliases,
      source: row.source,
      version: row.version,
      styleCase: row.styleCase,
      imageGenerationPrompt: row.imageGenerationPrompt
    })
  } catch (error) {
    throw new Error(
      formatUserStylePackageBackfillError(
        row.id,
        'style.json 无效：' + (error instanceof Error ? error.message : String(error))
      )
    )
  }
  await writeStylePackage({
    dir,
    json,
    skillMarkdown
  })
}

function formatUserStylePackageBackfillError(styleId: string, reason: string): string {
  return '跳过用户风格包回填：' + styleId + '。原因：' + reason
}

export async function backfillUserStylePackagesFromDatabase(installedRootPath: string): Promise<{
  scanned: number
  created: number
  skipped: number
  failed: number
}> {
  const db = getDb()
  const rows = db
    .listStyleRowsSync()
    .filter((row) => row.active !== false && row.source !== 'builtin')
  let created = 0
  let skipped = 0
  let failed = 0

  for (const row of rows) {
    try {
      const packageDir = path.join(installedRootPath, 'user', row.id)
      const hasPackage =
        fs.existsSync(path.join(packageDir, 'style.json')) &&
        fs.existsSync(path.join(packageDir, 'SKILL.md'))
      if (hasPackage) {
        skipped += 1
      } else {
        await writeUserStylePackage(row, { rootPath: installedRootPath })
        created += 1
      }
      if (row.packageDir !== 'user/' + row.id) {
        await db.updateStyleRow(row.id, { packageDir: 'user/' + row.id })
      }
    } catch (error) {
      failed += 1
      console.warn('[styles] failed to backfill user style package', {
        styleId: row.id,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }

  return { scanned: rows.length, created, skipped, failed }
}

export function resolveStylePreset(styleId?: string | null): StylePreset {
  const db = _db
  const rows = db ? db.listStyleRowsSync() : []
  if (rows.length === 0) {
    return {
      id: 'minimal-white',
      label: '极简白',
      aliases: ['minimal', 'light'],
      description: '极简白',
      fallbackPrompt: 'Use minimal-white style.'
    }
  }

  if (!styleId) {
    const found = rows.find((r) => r.style === 'minimal-white')
    return found ? rowToPreset(found) : rowToPreset(rows[0])
  }

  const normalized = normalize(styleId)
  const exact = rows.find((r) => r.id === normalized || r.style === normalized)
  if (exact) return rowToPreset(exact)

  const fallback = rows.find((r) => r.style === 'minimal-white')
  return fallback ? rowToPreset(fallback) : rowToPreset(rows[0])
}

export function resolveUsableStyleId(styleId?: string | null): string {
  const db = getDb()
  const rows = db.listStyleRowsSync().filter((row) => row.active !== false)
  if (styleId) {
    const normalized = normalize(styleId)
    const byId = rows.find((row) => row.id === normalized)
    if (byId) return byId.id
    const byStyle = rows.find((row) => row.style === normalized)
    if (byStyle) return byStyle.id
  }

  const fallback = rows.find((row) => row.style === 'minimal-white') || rows[0]
  if (!fallback) throw new Error('styleId 不存在或不可用：')
  return fallback.id
}

export function loadStyleSkill(styleId?: string | null): { preset: StylePreset; prompt: string } {
  const db = getDb()
  const preset = resolveStylePreset(styleId)
  const row = db.getStyleRowSync(preset.id)
  const prompt = row?.styleSkill?.trim() || preset.fallbackPrompt
  return { preset, prompt }
}

export function listStyleCatalog(): StyleCatalogItem[] {
  const db = getDb()
  const rows = db.listStyleRowsSync().filter((row) => row.active !== false)
  return rows.map((row) => ({
    id: row.id,
    styleKey: row.style,
    label: row.styleName,
    description: row.description,
    category: row.category || (row.source === 'builtin' ? '内置' : '自定义'),
    source: row.source as StyleSource,
    editable: row.source !== 'builtin',
    styleCase: row.styleCase,
    imageGenerationPrompt: row.imageGenerationPrompt || ''
  }))
}

export function getStyleDetail(styleId: string): {
  id: string
  styleKey: string
  label: string
  name: {
    zh: string
    en: string
  }
  description: string
  aliases: string[]
  styleSkill: string
  source: StyleSource
  editable: boolean
  category: string
  version: string
  styleCase: string
  imageGenerationPrompt: string
  packageDir: string
} {
  const db = getDb()
  const normalizedId = normalizeStyleId(styleId)
  const row = db.getStyleRowSync(normalizedId)
  if (row) {
    return {
      id: row.id,
      styleKey: row.style,
      label: row.styleName,
      name: {
        zh: row.styleNameZh || row.styleName,
        en: row.styleNameEn || ''
      },
      description: row.description,
      aliases: JSON.parse(row.aliases || '[]'),
      styleSkill: row.styleSkill,
      source: row.source as StyleSource,
      editable: row.source !== 'builtin',
      category: row.category || (row.source === 'builtin' ? '内置' : '自定义'),
      version: row.version,
      styleCase: row.styleCase,
      imageGenerationPrompt: row.imageGenerationPrompt || '',
      packageDir: row.packageDir || ''
    }
  }
  throw new Error(`风格不存在：${styleId}`)
}

export function hasStyleSkill(styleId: string): boolean {
  const db = getDb()
  const id = normalizeStyleId(styleId)
  return Boolean(db.getStyleRowSync(id))
}

export async function upsertStyleSkill(input: {
  id: string
  label: string
  description: string
  category?: string
  aliases?: string[]
  prompt: string
  styleCase?: string
  imageGenerationPrompt?: string
}): Promise<{ id: string; source: StyleSource }> {
  const db = getDb()
  const id = normalizeStyleId(input.id)
  const existing = db.getStyleRowSync(id)

  const nextSource: StyleSource = existing
    ? existing.source === 'builtin'
      ? 'override'
      : (existing.source as StyleSource)
    : 'custom'

  if (existing) {
    await db.updateStyleRow(id, {
      styleName: input.label.trim() || id,
      styleNameZh: input.label.trim() || id,
      description: input.description.trim(),
      category: (input.category || '').trim() || (nextSource === 'builtin' ? '内置' : '自定义'),
      aliases: (input.aliases || [])
        .map((alias) => normalizeAlias(alias))
        .filter((alias) => alias.length > 0 && alias !== id),
      source: nextSource,
      styleSkill: input.prompt.trim(),
      styleCase: (input.styleCase || '').trim(),
      ...(input.imageGenerationPrompt !== undefined
        ? { imageGenerationPrompt: input.imageGenerationPrompt.trim() }
        : {}),
      packageDir: 'user/' + id
    })
  } else {
    await db.createStyleRow({
      id,
      style: id,
      styleName: input.label.trim() || id,
      styleNameZh: input.label.trim() || id,
      description: input.description.trim(),
      category: (input.category || '').trim() || '自定义',
      aliases: (input.aliases || [])
        .map((alias) => normalizeAlias(alias))
        .filter((alias) => alias.length > 0 && alias !== id),
      source: nextSource,
      styleSkill: input.prompt.trim(),
      styleCase: (input.styleCase || '').trim(),
      imageGenerationPrompt: input.imageGenerationPrompt?.trim() || '',
      packageDir: 'user/' + id
    })
  }

  const saved = db.getStyleRowSync(id)
  if (saved && saved.source !== 'builtin') {
    await writeUserStylePackage(saved)
  }
  return { id, source: nextSource }
}

export async function createStyleSkill(input: {
  id: string
  label: string
  description: string
  category?: string
  aliases?: string[]
  prompt: string
  styleCase?: string
  imageGenerationPrompt?: string
}): Promise<{ id: string; source: StyleSource }> {
  const id = normalizeStyleId(input.id)
  if (hasStyleSkill(id)) {
    throw new Error(`style 已存在：${id}`)
  }
  return upsertStyleSkill(input)
}

export async function updateStyleSkill(input: {
  id: string
  label: string
  description: string
  category?: string
  aliases?: string[]
  prompt: string
  styleCase?: string
  imageGenerationPrompt?: string
}): Promise<{ id: string; source: StyleSource }> {
  const id = normalizeStyleId(input.id)
  if (!hasStyleSkill(id)) {
    throw new Error(`style 不存在：${id}`)
  }
  return upsertStyleSkill(input)
}

export async function importStylePackageZip(
  filePath: string
): Promise<{ id: string; source: ImportedStyleSource }> {
  const zipPath = String(filePath || '').trim()
  if (!zipPath.toLowerCase().endsWith('.zip')) {
    throw new Error('请选择 .zip 风格包。')
  }
  const zipData = await fs.promises.readFile(zipPath)
  const files = unzipSync(new Uint8Array(zipData))
  const packageFiles = normalizeStylePackageZipEntries(files)
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-import-'))
  const tempDir = path.join(tempRoot, packageFiles.rootName)
  try {
    await fs.promises.mkdir(tempDir, { recursive: true })
    await Promise.all(
      Object.entries(packageFiles.files).map(([name, data]) =>
        fs.promises.writeFile(path.join(tempDir, name), Buffer.from(data))
      )
    )
    return await importStylePackageDirectory(tempDir)
  } finally {
    await fs.promises.rm(tempRoot, { recursive: true, force: true })
  }
}

export async function importStylePackageDirectory(
  directoryPath: string
): Promise<{ id: string; source: ImportedStyleSource }> {
  const rawPath = String(directoryPath || '').trim()
  if (!rawPath) throw new Error('请选择风格包文件夹。')
  const sourceDir = path.resolve(rawPath)
  const sourceStat = await fs.promises.stat(sourceDir)
  if (!sourceStat.isDirectory()) throw new Error('请选择风格包文件夹。')
  const directoryName = path.basename(sourceDir)
  const stylePackage = await readStylePackage(sourceDir)
  if (stylePackage.json.style !== directoryName) {
    throw new Error('风格包目录名必须与 style.json 的 style 字段一致。')
  }
  return installStylePackage(stylePackage)
}

async function installStylePackage(
  stylePackage: StylePackage
): Promise<{ id: string; source: ImportedStyleSource }> {
  const db = getDb()
  const existing =
    db.getStyleRowByStyleSync(stylePackage.json.style) ||
    db.getStyleRowSync(stylePackage.json.style)
  const id = existing?.id || stylePackage.json.style
  const source: ImportedStyleSource =
    existing?.source === 'builtin' ? 'override' : existing?.source || 'custom'
  const json = {
    ...stylePackage.json,
    source
  }
  const previewHtml = stylePackage.previewPath
    ? await fs.promises.readFile(stylePackage.previewPath, 'utf8')
    : undefined

  if (existing) {
    await db.updateStyleRow(existing.id, {
      styleName: json.name.zh,
      styleNameZh: json.name.zh,
      styleNameEn: json.name.en,
      description: json.description,
      category: json.category,
      aliases: json.aliases,
      source,
      styleSkill: stylePackage.skillMarkdown,
      version: json.version,
      styleCase: json.styleCase,
      imageGenerationPrompt: json.imageGeneration?.prompt || '',
      packageDir: 'user/' + id,
      active: true
    })
  } else {
    await db.createStyleRow({
      id,
      style: json.style,
      styleName: json.name.zh,
      styleNameZh: json.name.zh,
      styleNameEn: json.name.en,
      description: json.description,
      category: json.category,
      aliases: json.aliases,
      source,
      styleSkill: stylePackage.skillMarkdown,
      version: json.version,
      styleCase: json.styleCase,
      imageGenerationPrompt: json.imageGeneration?.prompt || '',
      packageDir: 'user/' + id
    })
  }
  await writeStylePackage({
    dir: getUserStyleDir(id),
    json,
    skillMarkdown: stylePackage.skillMarkdown,
    previewHtml
  })
  return { id, source }
}

export async function exportStylePackageZip(styleId: string, outputPath: string): Promise<{ filePath: string }> {
  const db = getDb()
  const id = normalizeStyleId(styleId)
  const row = db.getStyleRowSync(id)
  if (!row) throw new Error('style 不存在：' + styleId)
  const packageDir = getStylePackageDir(row)
  let stylePackage: StylePackage
  try {
    stylePackage = await readStylePackage(packageDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && row.source !== 'builtin') {
      throw new Error('该风格没有可导出的 ZIP 包。请重新导入 ZIP 风格包，或编辑保存后再导出。')
    }
    throw error
  }
  const zipRoot = stylePackage.json.style
  const zipFiles: Record<string, Uint8Array> = {
    [zipRoot + '/style.json']: await fs.promises.readFile(path.join(packageDir, 'style.json')),
    [zipRoot + '/SKILL.md']: await fs.promises.readFile(path.join(packageDir, 'SKILL.md'))
  }
  const previewPath = path.join(packageDir, 'preview.html')
  if (stylePackage.previewPath && fs.existsSync(previewPath)) {
    zipFiles[zipRoot + '/preview.html'] = await fs.promises.readFile(previewPath)
  }
  await fs.promises.writeFile(outputPath, Buffer.from(zipSync(zipFiles)))
  return { filePath: outputPath }
}

export async function deleteStyleSkill(styleId: string): Promise<{ deleted: boolean }> {
  const db = getDb()
  const id = normalizeStyleId(styleId)
  const existing = db.getStyleRowSync(id)
  if (!existing) return { deleted: false }
  await db.updateStyleRow(id, { active: false })
  return { deleted: true }
}

function normalizeStylePackageZipEntries(files: Record<string, Uint8Array>): {
  rootName: string
  files: Record<'style.json' | 'SKILL.md', Uint8Array> & Partial<Record<'preview.html', Uint8Array>>
} {
  const allowed = new Set(['style.json', 'SKILL.md', 'preview.html'])
  const required = new Set(['style.json', 'SKILL.md'])
  const entries = Object.entries(files).filter(([rawName]) => {
    const name = rawName.replace(/\\/g, '/')
    if (!name || name.endsWith('/')) return false
    if (name.startsWith('__MACOSX/') || name.includes('/__MACOSX/')) return false
    if (name.split('/').some((part) => part === '.DS_Store')) return false
    return true
  })
  if (entries.length < 2 || entries.length > 3) {
    throw new Error('风格包 ZIP 必须只包含一个目录，目录内必须有 style.json、SKILL.md，可选 preview.html。')
  }

  let rootName = ''
  const normalized: Partial<Record<'style.json' | 'SKILL.md' | 'preview.html', Uint8Array>> = {}
  for (const [rawName, data] of entries) {
    const name = rawName.replace(/\\/g, '/')
    if (name.startsWith('/') || name.includes('../')) {
      throw new Error('风格包 ZIP 包含非法路径。')
    }
    const parts = name.split('/').filter(Boolean)
    if (parts.length !== 2) {
      throw new Error('风格包 ZIP 必须是单个 style 目录结构。')
    }
    if (!rootName) rootName = parts[0]
    if (parts[0] !== rootName) {
      throw new Error('风格包 ZIP 只能包含一个根目录。')
    }
    const fileName = parts[1]
    if (!allowed.has(fileName)) {
      throw new Error('风格包 ZIP 只能包含 style.json、SKILL.md、preview.html。')
    }
    normalized[fileName as 'style.json' | 'SKILL.md' | 'preview.html'] = data
  }
  for (const name of required) {
    if (!normalized[name as 'style.json' | 'SKILL.md']) {
      throw new Error('风格包缺少必需文件：' + name)
    }
  }
  return {
    rootName,
    files: normalized as Record<'style.json' | 'SKILL.md', Uint8Array> &
      Partial<Record<'preview.html', Uint8Array>>
  }
}
