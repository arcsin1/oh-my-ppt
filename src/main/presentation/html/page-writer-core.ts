import fs from 'fs'
import * as cheerio from 'cheerio'
import type { AnyNode } from 'domhandler'
import { SLIDE_SIZE_PRESETS, type SlideSizePreset } from '@shared/slide-size'
import {
  isPlaceholderPageHtml,
  normalizeLegacyDataAnimAttributes,
  validateHtmlContent,
  validatePersistedPageHtml
} from './html-utils'
import {
  parseChartHeightClass,
  resolveChartHeightFromNearbyComment
} from './chart-height'
import { normalizeCreativePageFragment } from './page-fragment-normalizer'
import { extractRemoteRuntimeResources } from './resource-policy'
import { buildFontHeadTags } from '../fonts/font-registry'
import { buildSessionAssetHeadTags } from '../assets/page-assets'
import { validateTemplateSkeletonPreserved } from '../templates/template-skeleton-validator'
import { serializedWrite } from './write-serialization'
import {
  buildBasePageStyleTag,
  buildFitScript,
  DEFAULT_MOTION_SCRIPT,
  VIDEO_INTERACTION_SCRIPT
} from './page-shell'
import { buildMasterStyleLink } from './master-link'

export {
  buildBasePageStyleTag,
  buildFitScript,
  DEFAULT_MOTION_SCRIPT,
  VIDEO_INTERACTION_SCRIPT
} from './page-shell'

function extractBackgroundStyle(styleAttr: string): string {
  const declarations = styleAttr
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
  const kept = declarations.filter((decl) => {
    const normalized = decl.toLowerCase().replace(/\s+/g, ' ')
    return (
      normalized.startsWith('background:') ||
      normalized.startsWith('background-color:') ||
      normalized.startsWith('background-image:')
    )
  })
  return kept.join('; ')
}

function isBackgroundUtilityClass(cls: string): boolean {
  const base = cls.split(':').pop() || cls
  return (
    base.startsWith('bg-') ||
    base.startsWith('from-') ||
    base.startsWith('via-') ||
    base.startsWith('to-')
  )
}

export function syncRootBackgroundFromScaffold(html: string): string {
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false })
    const root = $('.ppt-page-root[data-ppt-guard-root="1"]').first()
    if (!root.length) return html

    const scaffold = root.find('[data-page-scaffold="1"]').first()
    if (!scaffold.length) return html

    const rootClassRaw = (root.attr('class') || '').trim()
    const rootClasses = rootClassRaw.split(/\s+/).filter(Boolean)
    const rootHasBgClass = rootClasses.some((cls) => isBackgroundUtilityClass(cls))

    if (!rootHasBgClass) {
      const scaffoldClassRaw = (scaffold.attr('class') || '').trim()
      const scaffoldBgClasses = scaffoldClassRaw
        .split(/\s+/)
        .filter(Boolean)
        .filter((cls) => isBackgroundUtilityClass(cls))
      if (scaffoldBgClasses.length > 0) {
        const classSet = new Set(rootClasses)
        for (const cls of scaffoldBgClasses) classSet.add(cls)
        root.attr('class', Array.from(classSet).join(' '))
      }
    }

    const rootStyleRaw = (root.attr('style') || '').trim()
    const rootBgStyle = extractBackgroundStyle(rootStyleRaw)
    if (!rootBgStyle) {
      const scaffoldStyleRaw = (scaffold.attr('style') || '').trim()
      const scaffoldBgStyle = extractBackgroundStyle(scaffoldStyleRaw)
      if (scaffoldBgStyle) {
        const finalStyle = [rootStyleRaw, scaffoldBgStyle].filter(Boolean).join('; ')
        root.attr('style', finalStyle)
      }
    }

    return $.html()
  } catch {
    return html
  }
}

const PRESET_DIMENSIONS_PATTERN = Array.from(
  new Set(SLIDE_SIZE_PRESETS.flatMap((preset) => [preset.width, preset.height]))
).join('|')
const PRESET_ASPECTS_PATTERN = SLIDE_SIZE_PRESETS.flatMap((preset) => [
  `${preset.width}\\/${preset.height}`,
  preset.id === 'wide-16-9'
    ? '16\\/9'
    : preset.id === 'vertical-9-16'
      ? '9\\/16'
      : preset.id === 'standard-4-3'
        ? '4\\/3'
        : preset.id === 'square-1-1'
          ? '1\\/1'
          : '3\\/4'
]).join('|')

const CANVAS_LOCK_CLASS_PATTERNS = [
  new RegExp(
    `^(w|h|min-w|min-h|max-w|max-h)-\\[(?:(?:${PRESET_DIMENSIONS_PATTERN})px|100vw|100vh|100dvw|100dvh)\\]$`,
    'i'
  ),
  /^(w|h|min-w|min-h|max-w|max-h)-screen$/i,
  new RegExp(`^aspect-\\[(?:${PRESET_ASPECTS_PATTERN})\\]$`, 'i'),
  new RegExp(`^size-\\[(?:${PRESET_DIMENSIONS_PATTERN})px\\]$`, 'i')
]

function stripCanvasLockClasses(classAttr: string): string {
  const classes = classAttr.split(/\s+/).filter(Boolean)
  const kept = classes.filter(
    (cls) => !CANVAS_LOCK_CLASS_PATTERNS.some((pattern) => pattern.test(cls))
  )
  return kept.join(' ')
}

function stripCanvasInlineSizes(styleAttr: string): string {
  const declarations = styleAttr
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
  const kept = declarations.filter((decl) => {
    const normalized = decl.toLowerCase().replace(/\s+/g, ' ')
    const dimensionValuePattern = `(?:${PRESET_DIMENSIONS_PATTERN})px`
    if (
      new RegExp(
        `^(width|min-width|max-width): (${dimensionValuePattern}|100vw|100dvw)$`
      ).test(normalized)
    )
      return false
    if (
      new RegExp(
        `^(height|min-height|max-height): (${dimensionValuePattern}|100vh|100dvh)$`
      ).test(normalized)
    )
      return false
    return true
  })
  return kept.join('; ')
}

const CHART_FRAME_DEFAULT_HEIGHT_CLASS = 'h-[240px]'

function splitClassNames(classRaw: string): string[] {
  return classRaw
    .split(/\s+/)
    .map((cls) => cls.trim())
    .filter(Boolean)
}

function classBaseName(cls: string): string {
  return cls.split(':').pop() || cls
}

function isChartCanvasLayoutClass(cls: string): boolean {
  const base = classBaseName(cls)
  return base === 'flex-1' || /^h-/.test(base) || /^min-h-/.test(base) || /^max-h-/.test(base)
}

function isMarginUtilityClass(cls: string): boolean {
  return /^-?m[trblxy]?-[^\s]+$/.test(classBaseName(cls))
}

function hasFixedChartHeightClass(classes: Iterable<string>): boolean {
  return Array.from(classes).some((cls) => parseChartHeightClass(classBaseName(cls)) !== null)
}

function isUnstableChartFrameLayoutClass(cls: string): boolean {
  const base = classBaseName(cls)
  return (
    base === 'flex-1' ||
    (/^h-/.test(base) && parseChartHeightClass(base) === null) ||
    /^min-h-/.test(base) ||
    /^max-h-/.test(base)
  )
}

function hasFixedChartHeightStyle(styleRaw: string): boolean {
  return /(?:^|;)\s*height\s*:\s*(?!\s*(?:auto|0(?:px|rem|em|%)?|100%|inherit|initial|unset)\b)[^;]+/i.test(
    styleRaw
  )
}

function resolveChartFrameHeightClassFromNearbyComment(
  parent: cheerio.Cheerio<AnyNode>
): string | null {
  const height = resolveChartHeightFromNearbyComment(parent)
  return height === null ? null : `h-[${height}px]`
}

/**
 * Merged single-pass cheerio preprocessing: canvas lock styles, chart stabilization,
 * and unsafe hidden states. Replaces 3 separate cheerio.load calls with one.
 */
export function preprocessPageHtml(html: string): string {
  try {
    const $ = cheerio.load(html.trim(), { scriptingEnabled: false })

    $('[class]').each((_, node) => {
      const classValue = ($(node).attr('class') || '').trim()
      if (!classValue) return
      const cleaned = stripCanvasLockClasses(classValue)
      if (cleaned.length > 0) {
        $(node).attr('class', cleaned)
      } else {
        $(node).removeAttr('class')
      }
    })
    $('[style]').each((_, node) => {
      const styleValue = ($(node).attr('style') || '').trim()
      if (!styleValue) return
      const cleaned = stripCanvasInlineSizes(styleValue)
      if (cleaned.length > 0) {
        $(node).attr('style', cleaned)
      } else {
        $(node).removeAttr('style')
      }
    })

    $('canvas').each((_, node) => {
      const canvas = $(node)
      canvas.removeAttr('width')
      canvas.removeAttr('height')
      const originalCanvasClasses = splitClassNames(canvas.attr('class') || '')
      const wrapperClasses = originalCanvasClasses.filter(isMarginUtilityClass)
      const canvasClassSet = new Set(
        originalCanvasClasses.filter(
          (cls) => !isChartCanvasLayoutClass(cls) && !isMarginUtilityClass(cls)
        )
      )
      canvasClassSet.add('h-full')
      canvasClassSet.add('w-full')
      canvas.attr('class', Array.from(canvasClassSet).join(' '))

      const parent = canvas.parent()
      if (!parent.length) return

      const parentClassRaw = (parent.attr('class') || '').trim()
      const originalParentClasses = splitClassNames(parentClassRaw)
      const parentStyle = parent.attr('style') || ''
      const hasFixedHeightStyle = hasFixedChartHeightStyle(parentStyle)
      const hasFixedHeightClass = hasFixedChartHeightClass(originalParentClasses)
      const parentClassSet = new Set(
        originalParentClasses.filter((cls) => !isUnstableChartFrameLayoutClass(cls))
      )

      if (!hasFixedHeightClass && !hasFixedHeightStyle) {
        parentClassSet.add(
          resolveChartFrameHeightClassFromNearbyComment(parent) || CHART_FRAME_DEFAULT_HEIGHT_CLASS
        )
      }

      if (!parentClassSet.has('ppt-chart-frame')) parentClassSet.add('ppt-chart-frame')
      if (!parentClassSet.has('relative')) parentClassSet.add('relative')
      if (!parentClassSet.has('overflow-hidden')) parentClassSet.add('overflow-hidden')
      if (wrapperClasses.length > 0) {
        for (const cls of wrapperClasses) parentClassSet.add(cls)
      }
      parent.attr('class', Array.from(parentClassSet).join(' '))
    })

    $('video').each((_, node) => {
      const video = $(node)
      video.attr('controls', '')
      video.attr('playsinline', '')
      if (video.attr('preload') === undefined) {
        video.attr('preload', 'metadata')
      }
    })

    $('*').each((_, node) => {
      const el = $(node)

      const classRaw = (el.attr('class') || '').trim()
      if (classRaw) {
        const kept = classRaw
          .split(/\s+/)
          .filter(Boolean)
          .filter((cls) => {
            const base = cls.split(':').pop() || cls
            return base !== 'opacity-0' && base !== 'invisible'
          })
        if (kept.length > 0) {
          el.attr('class', kept.join(' '))
        } else {
          el.removeAttr('class')
        }
      }

      const styleRaw = (el.attr('style') || '').trim()
      if (styleRaw) {
        const keptDecls = styleRaw
          .split(';')
          .map((decl) => decl.trim())
          .filter(Boolean)
          .filter((decl) => {
            const idx = decl.indexOf(':')
            if (idx < 0) return true
            const key = decl.slice(0, idx).trim().toLowerCase()
            const value = decl
              .slice(idx + 1)
              .trim()
              .toLowerCase()
            if (key === 'opacity' && /^0(?:\.0+)?$/.test(value)) return false
            if (key === 'visibility' && value === 'hidden') return false
            return true
          })
        if (keptDecls.length > 0) {
          el.attr('style', keptDecls.join('; '))
        } else {
          el.removeAttr('style')
        }
      }
    })

    return $.html()
  } catch {
    return html
  }
}

type HtmlContentValidation = ReturnType<typeof validateHtmlContent>

export type PageWriteValidationFailureKind =
  | 'remote-resource'
  | 'content-validation'
  | 'template-skeleton'
  | 'persisted-validation'

/** A presentation-domain validation failure with machine-readable diagnostics for adapters. */
export class PageWriteValidationError extends Error {
  constructor(
    readonly kind: PageWriteValidationFailureKind,
    readonly pageId: string,
    readonly details: readonly string[],
    message: string
  ) {
    super(message)
    this.name = 'PageWriteValidationError'
  }
}

const STRUCTURAL_FRAGMENT_ERROR_RE =
  /HTML 末尾存在未闭合标签|开闭标签数量不一致|闭标签多于开标签|缺少结尾|缺少 <\/body>/i

function trimTrailingPartialTag(content: string): string {
  const trimmed = content.trim()
  if (!/<[^>]*$/.test(trimmed)) return trimmed
  return trimmed.replace(/<[^>]*$/, '').trim()
}

function repairMalformedCreativeFragment(content: string): string | null {
  const repairInput = trimTrailingPartialTag(content)
  if (!repairInput) return null
  try {
    const $ = cheerio.load(repairInput, { scriptingEnabled: false }, false)
    const repaired = ($.root().html() || repairInput).trim()
    return repaired && repaired !== content.trim() ? repaired : null
  } catch {
    return null
  }
}

export function countHtmlTag(content: string, tagName: string): { open: number; close: number } {
  const withoutNonStructuralBlocks = content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
  return {
    open: (withoutNonStructuralBlocks.match(new RegExp(`<${tagName}[\\s>]`, 'gi')) || []).length,
    close: (withoutNonStructuralBlocks.match(new RegExp(`</${tagName}>`, 'gi')) || []).length
  }
}

export function validateOrRepairHtmlContent(content: string): {
  content: string
  validation: HtmlContentValidation
  repaired: boolean
  originalErrors?: string[]
} {
  const validation = validateHtmlContent(content)
  if (validation.valid) {
    return { content, validation, repaired: false }
  }

  const onlyStructuralErrors = validation.errors.every((error) =>
    STRUCTURAL_FRAGMENT_ERROR_RE.test(error)
  )
  if (!onlyStructuralErrors) {
    return { content, validation, repaired: false }
  }

  const repairedContent = repairMalformedCreativeFragment(content)
  if (!repairedContent) {
    return { content, validation, repaired: false }
  }

  const repairedValidation = validateHtmlContent(repairedContent)
  if (!repairedValidation.valid) {
    return { content, validation: repairedValidation, repaired: false }
  }

  return {
    content: repairedContent,
    validation: repairedValidation,
    repaired: true,
    originalErrors: validation.errors
  }
}

export function replacePageContentFragment(args: {
  originalHtml: string
  content: string
  pageId: string
}): { html: string; content: string; repaired: boolean } {
  const remoteResources = extractRemoteRuntimeResources(args.content)
  if (remoteResources.length > 0) {
    throw new Error(
      `检测到禁止的 CDN/远程资源引用 (${args.pageId})，仅允许使用系统预注入的本地 ./assets/*。`
    )
  }
  const inputContent = normalizeLegacyDataAnimAttributes(args.content)
  const normalizedFragment = normalizeCreativePageFragment(preprocessPageHtml(inputContent), {
    blockIdMode: 'strip'
  })
  const prepared = validateOrRepairHtmlContent(normalizedFragment)
  const normalizedValidation = validateHtmlContent(prepared.content)
  if (!normalizedValidation.valid) {
    throw new Error(
      `HTML 验证失败 (${args.pageId}): ${normalizedValidation.errors.join('; ')}。请修正后重试。`
    )
  }

  const $ = cheerio.load(args.originalHtml, { scriptingEnabled: false })
  const contentNode = $('.ppt-page-root[data-ppt-guard-root="1"] .ppt-page-content').first()
  if (!contentNode.length) {
    throw new Error(
      `无法定位页面主体容器 (${args.pageId})：页面骨架已被破坏，请先修复页面后再编辑。`
    )
  }
  contentNode.html(prepared.content)
  const html = syncRootBackgroundFromScaffold($.html())
  const persistedValidation = validatePersistedPageHtml(html, args.pageId)
  if (!persistedValidation.valid) {
    throw new Error(
      `HTML 落盘校验失败 (${args.pageId}): ${persistedValidation.errors.join('; ')}。请修正页面片段后重试。`
    )
  }
  return { html, content: inputContent, repaired: prepared.repaired }
}

function hasDataAnim(html: string): boolean {
  return /\bdata-anim\b/i.test(html)
}

function hasCustomPageAnimation(html: string): boolean {
  return (
    /(?:anime\s*\(|anime\.(?:createTimeline|timeline|animate|stagger)\s*\()/m.test(html) ||
    /PPT\.(?:animate|stagger|createTimeline)\s*\(/m.test(html) ||
    /data-(?:anime|animate)\b/i.test(html)
  )
}

async function buildScaffoldDocument(args: {
  pageId: string
  pageNumber?: number
  innerContent: string
  includeDefaultMotion: boolean
  projectDir: string
  designFonts?: { titleFont: string; bodyFont: string }
  slideSize: SlideSizePreset
}): Promise<string> {
  const { pageId, pageNumber, innerContent, includeDefaultMotion, projectDir, designFonts, slideSize } =
    args
  const pageNumberAttribute =
    typeof pageNumber === 'number' && Number.isFinite(pageNumber) && pageNumber > 0
      ? ` data-ppt-page-number="${Math.floor(pageNumber)}"`
      : ''
  const motionScript = includeDefaultMotion ? `\n    ${DEFAULT_MOTION_SCRIPT}` : ''
  const fontInjection =
    designFonts
      ? `\n    ${await buildFontHeadTags({ ...designFonts, projectDir })}`
      : ''
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${buildSessionAssetHeadTags()}${fontInjection}
    ${buildBasePageStyleTag(slideSize)}
    ${buildMasterStyleLink()}
  </head>
  <body data-page-id="${pageId}"${pageNumberAttribute}>
    <main class="ppt-page-root" data-ppt-guard-root="1" data-ppt-slide-size-id="${slideSize.id}" data-ppt-width="${slideSize.width}" data-ppt-height="${slideSize.height}"${pageNumberAttribute}>
      <div class="ppt-page-fit-scope">
        <div class="ppt-page-content">
          ${innerContent}
        </div>
      </div>
    </main>
    ${buildFitScript(slideSize)}
    ${VIDEO_INTERACTION_SCRIPT}
    ${motionScript}
  </body>
</html>`
}

export async function normalizeAndInjectPageRuntime(
  content: string,
  pageId: string,
  projectDir: string,
  slideSize: SlideSizePreset,
  designFonts?: { titleFont: string; bodyFont: string },
  pageNumber?: number
): Promise<string> {
  const fragment = normalizeCreativePageFragment(
    preprocessPageHtml(normalizeLegacyDataAnimAttributes(content))
  )
  const document = await buildScaffoldDocument({
    pageId,
    pageNumber,
    innerContent: fragment,
    includeDefaultMotion: hasDataAnim(content) || !hasCustomPageAnimation(content),
    projectDir,
    slideSize,
    designFonts
  })
  return syncRootBackgroundFromScaffold(document)
}

/**
 * Turn a creative page fragment into a validated standalone page document.
 * This capability deliberately stops before filesystem writes; callers own
 * their domain-specific atomic write and rollback strategy.
 */
export async function buildPersistedPageHtmlFromFragment(args: {
  content: string
  pageId: string
  pageNumber?: number
  projectDir: string
  slideSize: SlideSizePreset
  designFonts?: { titleFont: string; bodyFont: string }
}): Promise<{ html: string; content: string; repaired: boolean; originalErrors?: string[] }> {
  const remoteResources = extractRemoteRuntimeResources(args.content)
  if (remoteResources.length > 0) {
    throw new PageWriteValidationError(
      'remote-resource',
      args.pageId,
      remoteResources,
      [
        `检测到禁止的 CDN/远程资源引用 (${args.pageId})，已拒绝写入。`,
        '请移除所有 script/link 的 http(s) 或 // 外链，仅使用系统预注入的本地 ./assets/* 资源。',
        '示例命中：',
        ...remoteResources
      ].join('\n')
    )
  }
  const inputContent = normalizeLegacyDataAnimAttributes(args.content)
  const prepared = validateOrRepairHtmlContent(inputContent)
  const normalizedContent = normalizeCreativePageFragment(preprocessPageHtml(prepared.content))
  const normalizedValidation = validateHtmlContent(normalizedContent)
  if (!normalizedValidation.valid) {
    throw new PageWriteValidationError(
      'content-validation',
      args.pageId,
      normalizedValidation.errors,
      `HTML 验证失败 (${args.pageId}): ${normalizedValidation.errors.join('; ')}。请修正后重试。`
    )
  }
  const html = await normalizeAndInjectPageRuntime(
    normalizedContent,
    args.pageId,
    args.projectDir,
    args.slideSize,
    args.designFonts,
    args.pageNumber
  )
  const persistedValidation = validatePersistedPageHtml(html, args.pageId)
  if (!persistedValidation.valid) {
    throw new PageWriteValidationError(
      'persisted-validation',
      args.pageId,
      persistedValidation.errors,
      `HTML 落盘校验失败 (${args.pageId}): ${persistedValidation.errors.join('; ')}。请修正页面片段后重试。`
    )
  }
  return {
    html,
    content: prepared.content,
    repaired: prepared.repaired,
    originalErrors: prepared.originalErrors
  }
}

/**
 * Presentation-owned page persistence capability shared by Agent tools and any
 * future non-Agent caller. It keeps validation, template-skeleton protection,
 * and serialized writes out of the Agent adapter layer.
 */
export async function persistPageHtmlFromFragment(args: {
  content: string
  pageId: string
  pageNumber?: number
  projectDir: string
  targetPath: string
  slideSize: SlideSizePreset
  designFonts?: { titleFont: string; bodyFont: string }
  preserveTemplateSkeleton?: boolean
}): Promise<{ html: string; content: string; repaired: boolean; originalErrors?: string[] }> {
  const persisted = await buildPersistedPageHtmlFromFragment(args)
  if (args.preserveTemplateSkeleton) {
    const beforeHtml = await fs.promises.readFile(args.targetPath, 'utf-8').catch(() => '')
    const missingTemplateRefs = validateTemplateSkeletonPreserved(beforeHtml, persisted.html)
    if (missingTemplateRefs.length > 0) {
      throw new PageWriteValidationError(
        'template-skeleton',
        args.pageId,
        missingTemplateRefs,
        [
          `模板骨架资源丢失 (${args.pageId})：${missingTemplateRefs.slice(0, 8).join(', ')}`,
          '请重新读取目标模板页，把背景图、纹理、装饰图、mask/overlay 或 CSS url(...) 对应结构保留在 update_template_page_file 的 content 中。'
        ].join(' ')
      )
    }
  }
  await serializedWrite(args.projectDir, async () => {
    await fs.promises.writeFile(args.targetPath, persisted.html, 'utf-8')
  })
  return persisted
}

export type PresentationPageVerification = {
  pageId: string
  filled: boolean
  hasContent: boolean
  hasRemoteRuntime: boolean
}

/** Read and validate the persisted presentation pages without leaking fs access to Agent tools. */
export async function verifyPresentationPageFiles(args: {
  pageFileMap: Record<string, string>
  pageIds: readonly string[]
}): Promise<PresentationPageVerification[]> {
  return Promise.all(
    args.pageIds.map(async (pageId) => {
      const pagePath = args.pageFileMap[pageId]
      if (!pagePath) {
        return { pageId, filled: false, hasContent: false, hasRemoteRuntime: false }
      }
      let content = ''
      try {
        content = await fs.promises.readFile(pagePath, 'utf-8')
      } catch (error) {
        const code = error && typeof error === 'object' ? (error as NodeJS.ErrnoException).code : undefined
        if (code === 'ENOENT') {
          return { pageId, filled: false, hasContent: false, hasRemoteRuntime: false }
        }
        throw error
      }
      const filled = content.trim().length > 0
      return {
        pageId,
        filled,
        hasContent: filled && !isPlaceholderPageHtml(content),
        hasRemoteRuntime: extractRemoteRuntimeResources(content).length > 0
      }
    })
  )
}
