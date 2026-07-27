/**
 * Font registry: bundled Google Fonts (local-first) + user-uploaded fonts infrastructure.
 * Used by buildScaffoldDocument to auto-inject font loading + CSS variables.
 */

import { is } from '@electron-toolkit/utils'
import { app } from 'electron'
import fs from 'fs'
import path from 'path'

export type FontSource = 'google' | 'uploaded'
export type FontRole = 'title' | 'body'
export type FontScript = 'latin' | 'cjk'

export interface FontFileEntry {
  file: string
  weight: number
  style: 'normal' | 'italic'
  size?: number
  sha256?: string
}

export interface FontRegistryEntry {
  id: string
  family: string
  source: 'uploaded'
  category: string
  role: FontRole[]
  scripts: FontScript[]
  createdAt: number
  updatedAt: number
  files: FontFileEntry[]
}

export interface AvailableFont {
  id: string
  family: string
  source: FontSource
  category: string
  role: FontRole[]
  scripts: FontScript[]
  files?: FontFileEntry[]
}

export interface FontRegistryFile {
  version: 1
  fonts: FontRegistryEntry[]
}

export interface GoogleFontEntry {
  id: string
  family: string
  /** Category for AI selection guidance */
  category: string
  role: FontRole[]
  scripts: FontScript[]
}

/**
 * Built-in Google Fonts catalog (local-first).
 * Key = font family name (must match titleFont/bodyFont in design contract).
 * Woff2 files live in resources/google-fonts/{FamilyName}/.
 */
const GOOGLE_FONTS: Record<string, GoogleFontEntry> = {
  Poppins: {
    id: 'google:poppins',
    family: 'Poppins',
    category: 'sans-body',
    role: ['body', 'title'],
    scripts: ['latin']
  },
  Inter: {
    id: 'google:inter',
    family: 'Inter',
    category: 'sans-body',
    role: ['body', 'title'],
    scripts: ['latin']
  },
  Montserrat: {
    id: 'google:montserrat',
    family: 'Montserrat',
    category: 'sans-title',
    role: ['title'],
    scripts: ['latin']
  },
  'Space Grotesk': {
    id: 'google:space-grotesk',
    family: 'Space Grotesk',
    category: 'sans-title',
    role: ['title', 'body'],
    scripts: ['latin']
  },
  'Bebas Neue': {
    id: 'google:bebas-neue',
    family: 'Bebas Neue',
    category: 'display',
    role: ['title'],
    scripts: ['latin']
  },
  'Playfair Display': {
    id: 'google:playfair-display',
    family: 'Playfair Display',
    category: 'serif',
    role: ['title'],
    scripts: ['latin']
  },
  Merriweather: {
    id: 'google:merriweather',
    family: 'Merriweather',
    category: 'serif',
    role: ['body', 'title'],
    scripts: ['latin']
  },
  Caveat: {
    id: 'google:caveat',
    family: 'Caveat',
    category: 'handwriting',
    role: ['title'],
    scripts: ['latin']
  },
  'Dancing Script': {
    id: 'google:dancing-script',
    family: 'Dancing Script',
    category: 'handwriting',
    role: ['title'],
    scripts: ['latin']
  },
  'Fira Code': {
    id: 'google:fira-code',
    family: 'Fira Code',
    category: 'mono',
    role: ['body'],
    scripts: ['latin']
  },
  'Noto Sans SC': {
    id: 'google:noto-sans-sc',
    family: 'Noto Sans SC',
    category: 'cjk-sans',
    role: ['body', 'title'],
    scripts: ['cjk', 'latin']
  },
  'Noto Serif SC': {
    id: 'google:noto-serif-sc',
    family: 'Noto Serif SC',
    category: 'cjk-serif',
    role: ['body', 'title'],
    scripts: ['cjk', 'latin']
  },
  'ZCOOL XiaoWei': {
    id: 'google:zcool-xiaowei',
    family: 'ZCOOL XiaoWei',
    category: 'cjk-display',
    role: ['title'],
    scripts: ['cjk']
  },
  'Ma Shan Zheng': {
    id: 'google:ma-shan-zheng',
    family: 'Ma Shan Zheng',
    category: 'cjk-display',
    role: ['title'],
    scripts: ['cjk']
  }
}

export const AVAILABLE_GOOGLE_FONTS = GOOGLE_FONTS

/**
 * Company-approved fonts supplied by the operating system or Office/WPS.
 * These fonts do not need to be copied into the project; PPTX keeps the
 * family name so WPS/PowerPoint can resolve the locally installed typeface.
 */
const SYSTEM_FONTS = new Set(['KaiTi', 'Microsoft YaHei'])

const DEFAULT_REGISTRY: FontRegistryFile = { version: 1, fonts: [] }

const normalizeFamily = (value: string): string => value.replace(/\s+/g, ' ').trim()
export const cssEscapeString = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')

/** Resolve resources/ root (dev vs production). */
function getResourcesRoot(): string {
  return is.dev
    ? path.join(process.cwd(), 'resources')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'resources')
}

/** Bundled Google Fonts directory: resources/google-fonts/ */
export function getBundledFontsRoot(): string {
  return path.join(getResourcesRoot(), 'google-fonts')
}

/** Directory name for a font family: "Noto Sans SC" → "Noto_Sans_SC" */
const familyDirName = (family: string): string => family.replace(/ /g, '_')

export function getUserFontsRoot(): string {
  return path.join(app.getPath('userData'), 'userFonts')
}

export function getUserFontRegistryPath(): string {
  return path.join(getUserFontsRoot(), 'registry.json')
}

export function getUserFontFilesRoot(): string {
  return path.join(getUserFontsRoot(), 'files')
}

const normalizeRoles = (value: unknown): FontRole[] => {
  const roles = Array.isArray(value) ? value : []
  const normalized = roles.filter((item): item is FontRole => item === 'title' || item === 'body')
  return normalized.length > 0 ? Array.from(new Set(normalized)) : ['title', 'body']
}

const normalizeScripts = (value: unknown): FontScript[] => {
  const scripts = Array.isArray(value) ? value : []
  const normalized = scripts.filter((item): item is FontScript => item === 'latin' || item === 'cjk')
  return normalized.length > 0 ? Array.from(new Set(normalized)) : []
}

const normalizeFontFile = (value: unknown): FontFileEntry | null => {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const file = String(record.file || '').trim()
  if (!file) return null
  const weight = Number(record.weight)
  return {
    file,
    weight: Number.isFinite(weight) ? Math.max(1, Math.floor(weight)) : 400,
    style: record.style === 'italic' ? 'italic' : 'normal',
    size: Number.isFinite(Number(record.size)) ? Math.max(0, Math.floor(Number(record.size))) : undefined,
    sha256: typeof record.sha256 === 'string' ? record.sha256 : undefined
  }
}

const normalizeUserFontEntry = (value: unknown): FontRegistryEntry | null => {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const id = String(record.id || '').trim()
  const family = normalizeFamily(String(record.family || ''))
  const files = Array.isArray(record.files)
    ? record.files.map(normalizeFontFile).filter((item): item is FontFileEntry => Boolean(item))
    : []
  if (!id || !family || files.length === 0) return null
  const now = Math.floor(Date.now() / 1000)
  return {
    id,
    family,
    source: 'uploaded',
    category: String(record.category || 'brand').trim() || 'brand',
    role: normalizeRoles(record.role),
    scripts: normalizeScripts(record.scripts),
    createdAt: Number.isFinite(Number(record.createdAt)) ? Math.floor(Number(record.createdAt)) : now,
    updatedAt: Number.isFinite(Number(record.updatedAt)) ? Math.floor(Number(record.updatedAt)) : now,
    files
  }
}

export async function readUserFontRegistry(): Promise<FontRegistryFile> {
  const registryPath = getUserFontRegistryPath()
  try {
    const raw = await fs.promises.readFile(registryPath, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<FontRegistryFile>
    const fonts = Array.isArray(parsed.fonts)
      ? parsed.fonts.map(normalizeUserFontEntry).filter((item): item is FontRegistryEntry => Boolean(item))
      : []
    return { version: 1, fonts }
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return DEFAULT_REGISTRY
    throw error
  }
}

export async function writeUserFontRegistry(registry: FontRegistryFile): Promise<void> {
  const root = getUserFontsRoot()
  await fs.promises.mkdir(root, { recursive: true })
  const registryPath = getUserFontRegistryPath()
  const tmpPath = `${registryPath}.tmp`
  const payload: FontRegistryFile = {
    version: 1,
    fonts: registry.fonts.map((entry) => ({
      ...entry,
      family: normalizeFamily(entry.family),
      role: normalizeRoles(entry.role),
      scripts: normalizeScripts(entry.scripts),
      files: entry.files.map((file) => ({
        ...file,
        style: file.style === 'italic' ? 'italic' : 'normal'
      }))
    }))
  }
  await fs.promises.writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
  await fs.promises.rename(tmpPath, registryPath)
}

export function getGoogleFont(family: string): GoogleFontEntry | undefined {
  return GOOGLE_FONTS[normalizeFamily(family)]
}

export async function getUserFont(family: string): Promise<FontRegistryEntry | undefined> {
  const normalized = normalizeFamily(family)
  const registry = await readUserFontRegistry()
  return registry.fonts.find((entry) => entry.family === normalized)
}

export async function getAvailableFonts(): Promise<AvailableFont[]> {
  const registry = await readUserFontRegistry()
  return [
    ...Object.values(GOOGLE_FONTS).map((entry): AvailableFont => ({
      id: entry.id,
      family: entry.family,
      source: 'google',
      category: entry.category,
      role: entry.role,
      scripts: entry.scripts
    })),
    ...registry.fonts.map((entry): AvailableFont => ({
      id: entry.id,
      family: entry.family,
      source: 'uploaded',
      category: entry.category,
      role: entry.role,
      scripts: entry.scripts,
      files: entry.files
    }))
  ]
}

export async function assertFontFamilyAvailable(family: string, fieldName: string): Promise<void> {
  const normalized = normalizeFamily(family)
  if (!normalized) throw new Error(`${fieldName} 不能为空`)
  if (SYSTEM_FONTS.has(normalized)) return
  if (GOOGLE_FONTS[normalized]) return
  const uploaded = await getUserFont(normalized)
  if (uploaded) return
  throw new Error(`${fieldName} 不在可用字体列表中：${normalized}`)
}

export async function assertFontFamilyNameAvailableForUpload(family: string, currentFontId?: string): Promise<void> {
  const normalized = normalizeFamily(family)
  if (!normalized) throw new Error('字体族名称不能为空')
  if (SYSTEM_FONTS.has(normalized)) throw new Error(`字体族名称与系统字体重名：${normalized}`)
  if (GOOGLE_FONTS[normalized]) throw new Error(`字体族名称与内置 Google Fonts 重名：${normalized}`)
  const registry = await readUserFontRegistry()
  const duplicate = registry.fonts.find(
    (entry) => entry.family === normalized && entry.id !== currentFontId
  )
  if (duplicate) throw new Error(`字体族名称已存在：${normalized}`)
}

export async function ensureUserFontsForProject(
  fontFamilies: string[],
  projectDir: string
): Promise<void> {
  const uniqueFamilies = Array.from(new Set(fontFamilies.map(normalizeFamily).filter(Boolean)))
  if (uniqueFamilies.length === 0) return
  const registry = await readUserFontRegistry()
  const userFonts = uniqueFamilies
    .map((family) => registry.fonts.find((entry) => entry.family === family))
    .filter((entry): entry is FontRegistryEntry => Boolean(entry))
  if (userFonts.length === 0) return

  for (const entry of userFonts) {
    const sourceDir = path.join(getUserFontFilesRoot(), entry.id)
    const targetDir = path.join(projectDir, 'assets', 'fonts', 'user-fonts', entry.id)
    await fs.promises.mkdir(targetDir, { recursive: true })
    for (const file of entry.files) {
      const sourcePath = path.join(sourceDir, file.file)
      const targetPath = path.join(targetDir, file.file)
      await fs.promises.copyFile(sourcePath, targetPath)
    }
  }
}

/**
 * Copy bundled Google Fonts woff2 files into the project assets directory.
 * Returns the list of relative woff2 file paths copied.
 */
async function ensureGoogleFontsForProject(
  fontFamilies: string[],
  projectDir: string
): Promise<void> {
  const uniqueFamilies = Array.from(new Set(fontFamilies.map(normalizeFamily).filter(Boolean)))
  if (uniqueFamilies.length === 0) return

  const bundledRoot = getBundledFontsRoot()
  for (const family of uniqueFamilies) {
    const google = GOOGLE_FONTS[family]
    if (!google) continue
    const sourceDir = path.join(bundledRoot, familyDirName(family))
    const targetDir = path.join(projectDir, 'assets', 'fonts', 'google-fonts', familyDirName(family))
    // Read woff2 files from bundled resources
    let woff2Files: string[]
    try {
      woff2Files = (await fs.promises.readdir(sourceDir)).filter((f) => f.endsWith('.woff2'))
    } catch {
      throw new Error(`内置字体文件缺失：${family}（期望目录：${sourceDir}）`)
    }
    if (woff2Files.length === 0) {
      throw new Error(`内置字体目录为空：${family}`)
    }
    await fs.promises.mkdir(targetDir, { recursive: true })
    for (const file of woff2Files) {
      const src = path.join(sourceDir, file)
      const dst = path.join(targetDir, file)
      try {
        await fs.promises.copyFile(src, dst)
      } catch (err) {
        // Skip if already exists (e.g. race condition on parallel builds)
        if ((err as NodeJS.ErrnoException)?.code !== 'EEXIST') throw err
      }
    }
  }
}

/**
 * Build @font-face CSS text from a bundled Google Font's faces.css,
 * rewriting ./ paths to the project-relative assets path.
 */
async function buildGoogleFontFaceTags(family: string, _projectDir: string): Promise<string[]> {
  const bundledRoot = getBundledFontsRoot()
  const sourceDir = path.join(bundledRoot, familyDirName(family))
  const facesCssPath = path.join(sourceDir, 'faces.css')
  const cssRaw = await fs.promises.readFile(facesCssPath, 'utf-8')
  const relPrefix = `./assets/fonts/google-fonts/${familyDirName(family)}/`

  // Parse each @font-face block, rewrite url("./...") to project-relative path
  const blocks = cssRaw.split(/@font-face\s*\{/).slice(1)
  return blocks.map((block) => {
    const body = block.slice(0, block.indexOf('}')).trim()
    // Replace url("./...") with the project-relative path
    const rewritten = body.replace(
      /url\(\s*"\.\/([^"]+)"\s*\)/g,
      (_, fileName) => `url("${relPrefix}${fileName}")`
    )
    return `<style data-ppt-fonts="google">@font-face{${rewritten}}</style>`
  })
}

/**
 * Build system-owned font loading tags and CSS variables from design contract font names.
 * Throws for unknown fonts; the new font design intentionally does not silently fall back.
 */
export async function buildFontHeadTags(args: {
  titleFont: string
  bodyFont: string
  projectDir: string
}): Promise<string> {
  const titleFont = normalizeFamily(args.titleFont)
  const bodyFont = normalizeFamily(args.bodyFont)
  await assertFontFamilyAvailable(titleFont, 'titleFont')
  await assertFontFamilyAvailable(bodyFont, 'bodyFont')

  // Copy font files to project assets
  await ensureGoogleFontsForProject([titleFont, bodyFont], args.projectDir)
  await ensureUserFontsForProject([titleFont, bodyFont], args.projectDir)

  const userRegistry = await readUserFontRegistry()
  const families = Array.from(new Set([titleFont, bodyFont]))
  const tags: string[] = []

  for (const family of families) {
    if (SYSTEM_FONTS.has(family)) continue
    const google = GOOGLE_FONTS[family]
    if (google) {
      const faceTags = await buildGoogleFontFaceTags(family, args.projectDir)
      tags.push(...faceTags)
      continue
    }
    const uploaded = userRegistry.fonts.find((entry) => entry.family === family)
    if (!uploaded) throw new Error(`字体不在可用字体列表中：${family}`)
    for (const file of uploaded.files) {
      const fontUrl = `./assets/fonts/user-fonts/${uploaded.id}/${file.file}`
      tags.push(
        `<style data-ppt-fonts="user">@font-face{font-family:"${cssEscapeString(uploaded.family)}";src:url("${cssEscapeString(fontUrl)}") format("woff2");font-weight:${file.weight};font-style:${file.style};font-display:swap}</style>`
      )
    }
  }

  tags.push(
    `<style data-ppt-fonts="1">:root{--ppt-title-font:"${cssEscapeString(titleFont)}";--ppt-body-font:"${cssEscapeString(bodyFont)}"}</style>`
  )
  return tags.join('\n    ')
}

/**
 * JSON-safe array of available fonts for design contract prompt.
 */
export async function buildAvailableFontsForPrompt(): Promise<AvailableFont[]> {
  const fonts = await getAvailableFonts()
  return fonts.map(({ id, family, source, category, role, scripts }) => ({
    id,
    family,
    source,
    category,
    role,
    scripts
  }))
}
