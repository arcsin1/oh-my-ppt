import * as cheerio from 'cheerio'
import {
  SHARED_PAGE_STYLES_END,
  SHARED_PAGE_STYLES_START,
  pageContentEndMarker,
  pageContentStartMarker
} from './page-contract'
import { validateDataAnimContract } from '../../animation/data-anim-validator'
import {
  CHART_SKILL_NAME,
  DATA_ANIM_SKILL_NAME,
  formatSkillUsageRequirement
} from '../../product-skills/contract'
import {
  CHART_FRAME_HEIGHT_COMMENT_MARKER,
  parseChartHeightClass,
  resolveChartHeightFromNearbyComment
} from './chart-height'
import { normalizeDataAnimTrigger } from '@shared/element-animation'

// ── HTML parsing ──

export const extractBodyHtml = (html: string): string => {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  $('script').remove()
  const bodyHtml = $('body').html()
  return (bodyHtml || '').trim()
}

export const extractStyleCss = (html: string): string =>
  (html.match(/<style[^>]*>([\s\S]*?)<\/style>/i)?.[1] || '').trim()

export const normalizePageCss = (css: string): string =>
  css
    .replace(/body\s*\{/g, '.ppt-page-root {')
    .replace(/\s+$/g, '')
    .trim()

export const unwrapCss = (input: string): string => {
  const styleMatch = input.match(/<style[^>]*>([\s\S]*?)<\/style>/i)
  return normalizePageCss((styleMatch?.[1] || input).trim())
}

// ── Marker-based replacement ──

export const replaceBetweenMarkers = (
  source: string,
  startMarker: string,
  endMarker: string,
  replacement: string
): string | null => {
  const startIndex = source.indexOf(startMarker)
  const endIndex = source.indexOf(endMarker)
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    return null // marker block not found, caller should handle
  }
  const before = source.slice(0, startIndex + startMarker.length)
  const after = source.slice(endIndex)
  return `${before}\n${replacement.trim()}\n${after}`
}

// ── Validation ──

// Tags that should be strictly balanced (any imbalance is an error)
const STRICT_TAGS = [
  'div',
  'section',
  'main',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'article',
  'header',
  'footer',
  'aside',
  'figure',
  'figcaption',
  'blockquote'
]

const SCRIPT_SRC_RE = /<script[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi
const INLINE_SCRIPT_RE = /<script\b(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi
const REMOTE_SCRIPT_OR_LINK_RE =
  /<(script|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']+["'][^>]*>/i
const HIDDEN_STYLE_RULE_RE =
  /(?:^|[;}])\s*[^{}]+\{\s*[^{}]*(?:opacity\s*:\s*0(?:\.0+)?|visibility\s*:\s*hidden)[^{}]*\}/i
const CHART_LABELS_ARRAY_RE = /\blabels\s*:\s*\[([\s\S]*?)\]/gi
const HTML_TAG_IN_STRING_RE = /<\s*\/?\s*[a-z][^>]*>/i
export const PAGE_PLACEHOLDER_TEXT = '等待模型填充这一页内容'

export const isPlaceholderPageHtml = (html: string): boolean =>
  html.includes(PAGE_PLACEHOLDER_TEXT) || /data-placeholder-page\s*=\s*["']1["']/i.test(html)

const LEGACY_DATA_ANIM_TYPE_ALIASES: Record<string, string> = {
  'fade-in': 'fade',
  'fade-in-up': 'fade-up',
  'fade-in-down': 'fade-down',
  'fade-in-left': 'fade-left',
  'fade-in-right': 'fade-right'
}

/**
 * Normalize only the legacy animation spellings the editor already understands.
 * Persisted pages remain strict: unknown values still fail validateDataAnimContract.
 */
export const normalizeLegacyDataAnimAttributes = (html: string): string => {
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false }, false)
    $('[data-anim]').each((_index, node) => {
      const raw = ($(node).attr('data-anim') || '').trim().toLowerCase()
      const normalized = LEGACY_DATA_ANIM_TYPE_ALIASES[raw]
      if (normalized) $(node).attr('data-anim', normalized)
    })
    $('[data-anim-trigger]').each((_index, node) => {
      const normalized = normalizeDataAnimTrigger($(node).attr('data-anim-trigger'))
      if (normalized) $(node).attr('data-anim-trigger', normalized)
    })
    return $.root().html() || html
  } catch {
    return html
  }
}

const getInlineScriptSyntaxErrors = (html: string): string[] => {
  const errors: string[] = []
  let scriptIndex = 0
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    const attrs = match[1] || ''
    const type = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1]?.trim().toLowerCase()
    if (type && type !== 'text/javascript' && type !== 'application/javascript') {
      continue
    }
    const scriptBody = (match[2] || '').trim()
    if (!scriptBody) continue
    scriptIndex += 1
    try {
      new Function(scriptBody)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`第 ${scriptIndex} 个内联 script 语法错误：${message}`)
    }
  }
  return errors
}

// All explicit h-[Npx] heights on the frame, as positive pixel values. Deliberately
// NOT range-clamped: the marker/class contract is "must match", so an out-of-range
// class (e.g. h-[100px]) still counts and is compared against the marker instead of
// being silently dropped as "missing".
const getFixedChartHeightClasses = (classRaw: string): number[] =>
  classRaw
    .split(/\s+/)
    .map((cls) => cls.split(':').pop() || cls)
    .map(parseChartHeightClass)
    .filter((value): value is number => value !== null)

const getChartHeightMarkerMismatchErrors = (html: string): string[] => {
  const errors: string[] = []
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false })
    $('canvas').each((index, node) => {
      const parent = $(node).parent()
      if (!parent.length) return
      const markerHeight = resolveChartHeightFromNearbyComment(parent)
      if (!markerHeight) return
      const classHeights = getFixedChartHeightClasses(parent.attr('class') || '')
      if (classHeights.length === 0 || classHeights.includes(markerHeight)) return
      const actual = classHeights.map((height) => `h-[${height}px]`).join(', ')
      errors.push(
        `第 ${index + 1} 个图表高度标记 ${CHART_FRAME_HEIGHT_COMMENT_MARKER}=${markerHeight} 与图表框 class 不一致：${actual}`
      )
    })
  } catch {
    // Structural parse errors are reported by the existing HTML parser checks.
  }
  return errors
}

const getVisibleChartHeightMarkerErrors = (html: string): string[] => {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '')
  if (!new RegExp(`${CHART_FRAME_HEIGHT_COMMENT_MARKER}\\s*=`, 'i').test(withoutComments)) {
    return []
  }
  return [
    `图表高度标记 ${CHART_FRAME_HEIGHT_COMMENT_MARKER}=N 必须写在 HTML 注释中，不能作为可见文本放进图表框。`
  ]
}

const getChartHtmlLabelErrors = (html: string): string[] => {
  const errors: string[] = []
  let scriptIndex = 0
  for (const match of html.matchAll(INLINE_SCRIPT_RE)) {
    scriptIndex += 1
    const scriptBody = match[2] || ''
    if (!/PPT\.createChart\s*\(|new\s+Chart\s*\(/i.test(scriptBody)) continue
    for (const labelsMatch of scriptBody.matchAll(CHART_LABELS_ARRAY_RE)) {
      const labelsSource = labelsMatch[1] || ''
      if (!HTML_TAG_IN_STRING_RE.test(labelsSource)) continue
      errors.push(
        `第 ${scriptIndex} 个图表 labels 包含 HTML 标签。Chart.js 不会渲染 <br>/<span>，请使用纯文本标签、字符串数组换行，或 tooltip/注释承载补充信息。`
      )
      break
    }
  }
  return errors
}

const isAllowedRuntimeAsset = (src: string): boolean => {
  const normalized = src.trim().toLowerCase()
  const clean = normalized.split('?')[0].split('#')[0]
  return (
    clean.endsWith('/assets/anime.v4.js') ||
    clean.endsWith('./assets/anime.v4.js') ||
    clean.endsWith('assets/anime.v4.js') ||
    clean.endsWith('/assets/ppt-runtime.js') ||
    clean.endsWith('./assets/ppt-runtime.js') ||
    clean.endsWith('assets/ppt-runtime.js') ||
    clean.endsWith('/assets/chart.v4.js') ||
    clean.endsWith('./assets/chart.v4.js') ||
    clean.endsWith('assets/chart.v4.js') ||
    clean.endsWith('/assets/tailwindcss.v3.js') ||
    clean.endsWith('./assets/tailwindcss.v3.js') ||
    clean.endsWith('assets/tailwindcss.v3.js') ||
    clean.endsWith('/assets/katex/katex.min.js') ||
    clean.endsWith('./assets/katex/katex.min.js') ||
    clean.endsWith('assets/katex/katex.min.js') ||
    clean.endsWith('/assets/katex/katex-auto-render.min.js') ||
    clean.endsWith('./assets/katex/katex-auto-render.min.js') ||
    clean.endsWith('assets/katex/katex-auto-render.min.js')
  )
}

export const validateHtmlContent = (html: string): { valid: boolean; errors: string[] } => {
  const errors: string[] = []
  const animationCallScanHtml = html.replace(
    /\bdata-anim-delay\s*=\s*(["'])stagger\s*\(\s*\d+\s*\)\1/gi,
    'data-anim-delay=$1__DATA_ANIM_STAGGER__$1'
  )
  const hasUnqualifiedCall = (fnName: string): boolean =>
    new RegExp(`(^|[^\\w$.])${fnName}\\s*\\(`, 'm').test(animationCallScanHtml)
  if (!html || html.trim().length === 0) {
    errors.push('HTML 内容为空')
    return { valid: false, errors }
  }
  // Creative fragment mode: content must be a fragment, while write tools add page semantics.
  if (/<!doctype[\s>]/i.test(html)) {
    errors.push('检测到 <!doctype>。请仅传页面片段，不要传完整文档。')
  }
  if (/<html[\s>]/i.test(html) || /<\/html>/i.test(html)) {
    errors.push('检测到 <html> 标签。请仅传页面片段，不要传完整文档。')
  }
  if (/<head[\s>]/i.test(html) || /<\/head>/i.test(html)) {
    errors.push('检测到 <head> 标签。请仅传页面片段，不要传完整文档。')
  }
  if (/<body[\s>]/i.test(html) || /<\/body>/i.test(html)) {
    errors.push('检测到 <body> 标签。请仅传页面片段，不要传完整文档。')
  }
  if (/<meta[\s>]/i.test(html)) {
    errors.push('检测到 <meta> 标签。页面片段中禁止包含 head 元信息。')
  }
  if (/<title[\s>]/i.test(html) || /<\/title>/i.test(html)) {
    errors.push('检测到 <title> 标签。页面片段中禁止包含标题标签。')
  }
  if (/<link\b[^>]*>/i.test(html)) {
    errors.push('检测到 <link> 标签。页面片段中禁止引入字体或外部资源，字体由系统统一注入。')
  }
  if (/@font-face\b/i.test(html)) {
    errors.push('检测到 @font-face。页面片段中禁止声明字体，字体由系统统一注入。')
  }
  if (/url\(\s*["']?(?:https?:)?\/\//i.test(html)) {
    errors.push('检测到远程 CSS URL。页面片段中禁止引入远程字体或样式资源。')
  }
  if (/data-ppt-guard-root\s*=\s*["']1["']/i.test(html)) {
    errors.push('检测到 data-ppt-guard-root。禁止传入页面骨架根节点，请仅传主体片段。')
  }
  if (
    /\bppt-page-root\b/i.test(html) ||
    /\bppt-page-content\b/i.test(html) ||
    /\bppt-page-fit-scope\b/i.test(html)
  ) {
    errors.push('检测到页面骨架类（ppt-page-root/content/fit-scope）。请仅传主体片段。')
  }
  if (/<script[^>]*id=["']ppt-(?:page-fit|default-motion|page-guard-style)["'][^>]*>/i.test(html)) {
    errors.push('检测到内置运行时脚本/样式块。请不要自行注入，系统会自动注入。')
  }
  if (/<iframe[\s>]/gi.test(html)) {
    errors.push('内容中包含 iframe 标签，页面内不允许嵌套 iframe')
  }
  const scriptSrcHits = Array.from(html.matchAll(SCRIPT_SRC_RE)).map((m) => (m[1] || '').trim())
  const disallowedScriptSrc = scriptSrcHits.filter((src) => !isAllowedRuntimeAsset(src))
  if (disallowedScriptSrc.length > 0) {
    const preview = disallowedScriptSrc.slice(0, 3).join(', ')
    errors.push(`检测到不允许的 script src：${preview}。页面片段禁止引入脚本资源，运行时已预注入。`)
  }
  errors.push(...getInlineScriptSyntaxErrors(html))
  errors.push(...getVisibleChartHeightMarkerErrors(html))
  errors.push(...getChartHeightMarkerMismatchErrors(html))
  errors.push(...getChartHtmlLabelErrors(html))
  errors.push(...validateDataAnimContract(html).errors)
  if (/anime\s*\(\s*\{[\s\S]{0,240}?targets\s*:/im.test(html)) {
    errors.push(`检测到旧版 anime({ targets, ... }) 写法；修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`)
  }
  if (/(^|[^\w$])anime\.(?:animate|stagger|createTimeline|timeline)\s*\(/i.test(html)) {
    errors.push(`检测到直接 anime.* 调用；修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`)
  }
  if (/\banime\.(?:svg\.)?(?:createMotionPath|createDrawable|morphTo)\s*\(/i.test(html)) {
    errors.push(`检测到 anime 的 SVG/path/morph 高级能力；这些能力当前属于 preview-only 方向，不应进入标准可编辑页面。修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`)
  }
  if (/\b(?:anime\.)?splitText\s*\(/i.test(html)) {
    errors.push(`检测到 splitText 文本碎片动画；该能力当前属于 preview-only 方向，不应进入标准可编辑页面。修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`)
  }
  if (/PPT\.animate\s*\(\s*\{[\s\S]{0,240}?targets\s*:/im.test(html)) {
    errors.push(`检测到 PPT.animate({ targets, ... }) 写法；修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`)
  }
  if (
    hasUnqualifiedCall('animate') ||
    hasUnqualifiedCall('stagger') ||
    hasUnqualifiedCall('createTimeline')
  ) {
    errors.push(`检测到未命名空间的动画调用（animate/stagger/createTimeline）；修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`)
  }
  if (/new\s+Chart\s*\(/i.test(html)) {
    errors.push(
      `检测到直接 new Chart(...) 调用；修改图表前请先 ${formatSkillUsageRequirement(CHART_SKILL_NAME)}`
    )
  }
  if (/addEventListener\s*\(\s*['"](?:ppt-ready|ppt-rendered|ppt-page-ready)['"]/i.test(html)) {
    errors.push(
      `检测到自定义事件（ppt-ready/ppt-rendered/ppt-page-ready）绑定 chart 代码，这些事件运行时不会触发。请改用 DOMContentLoaded。${formatSkillUsageRequirement(CHART_SKILL_NAME)}`
    )
  }
  if (/PPT\.createChart/i.test(html) && !/DOMContentLoaded/i.test(html)) {
    errors.push(
      `PPT.createChart 未包裹在 DOMContentLoaded 回调中，图表可能无法渲染。${formatSkillUsageRequirement(CHART_SKILL_NAME)}`
    )
  }
  if (/<[^>]*$/.test(html.trim())) {
    errors.push('HTML 末尾存在未闭合标签，内容可能被截断')
  }
  const normalized = html.trim()
  if (/<html[\s>]/i.test(normalized) && !/<\/html>\s*$/i.test(normalized)) {
    errors.push('检测到 <html> 但缺少结尾 </html>，内容可能被截断')
  }
  if (/<body[\s>]/i.test(normalized) && !/<\/body>/i.test(normalized)) {
    errors.push('检测到 <body> 但缺少 </body>，内容可能被截断')
  }

  // Remove comments/script/style to avoid counting pseudo tags in JS/CSS/comment text.
  const structuralHtml = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')

  // Check for orphan closing tags (closing tag without a matching open)
  for (const tag of STRICT_TAGS) {
    const opens = (structuralHtml.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length
    const closes = (structuralHtml.match(new RegExp(`</${tag}>`, 'gi')) || []).length
    if (opens < closes) {
      errors.push(`</${tag}> 闭标签多于开标签（${opens} 个开, ${closes} 个闭），可能是内容被截断`)
    } else if (opens !== closes) {
      errors.push(`<${tag}> 开闭标签数量不一致（${opens} 个开, ${closes} 个闭），内容可能被截断`)
    }
  }
  try {
    const $ = cheerio.load(html, { scriptingEnabled: false })
    const blockIds = new Map<string, number>()
    $('[data-block-id]').each((_, node) => {
      const id = ($(node).attr('data-block-id') || '').trim()
      if (!id) return
      blockIds.set(id, (blockIds.get(id) || 0) + 1)
    })
    const duplicatedBlockIds = Array.from(blockIds.entries())
      .filter(([, count]) => count > 1)
      .map(([id]) => id)
    if (duplicatedBlockIds.length > 0) {
      errors.push(`data-block-id 必须唯一，重复项：${duplicatedBlockIds.join(', ')}`)
    }
  } catch {
    errors.push('HTML 片段结构解析失败')
  }
  return { valid: errors.length === 0, errors }
}

export const validatePersistedPageHtml = (
  html: string,
  pageId: string
): { valid: boolean; errors: string[] } => {
  const errors: string[] = []
  if (!html || html.trim().length === 0) {
    return { valid: false, errors: [`${pageId}.html 内容为空`] }
  }
  if (isPlaceholderPageHtml(html)) {
    errors.push('仍包含页面占位文案')
  }
  const $ = cheerio.load(html, { scriptingEnabled: false })
  errors.push(...getInlineScriptSyntaxErrors(html))
  errors.push(...getVisibleChartHeightMarkerErrors(html))
  errors.push(...getChartHeightMarkerMismatchErrors(html))
  errors.push(...getChartHtmlLabelErrors(html))
  errors.push(...validateDataAnimContract(html).errors)
  if (REMOTE_SCRIPT_OR_LINK_RE.test(html)) {
    errors.push('包含远程资源引用（字体已改为本地加载，禁止 CDN 链接）')
  }
  $('style').each((_, node) => {
    const el = $(node)
    const css = el.text()
    const fontMarker = el.attr('data-ppt-fonts')
    if (/@font-face\b/i.test(css) && fontMarker !== 'user' && fontMarker !== 'google') {
      errors.push('@font-face 只能由系统字体注入块声明')
      return false
    }
    if (/url\(\s*["']?(?:https?:)?\/\//i.test(css)) {
      errors.push('样式块中包含远程 URL')
      return false
    }
    if (/url\(\s*"(?!\.\/assets\/fonts\/user-fonts\/)[^)]+/i.test(css) && fontMarker === 'user') {
      errors.push('@font-face 只能引用 ./assets/fonts/user-fonts/ 下的字体文件')
      return false
    }
    if (/url\(\s*"(?!\.\/assets\/fonts\/google-fonts\/)[^)]+/i.test(css) && fontMarker === 'google') {
      errors.push('Google 字体只能引用 ./assets/fonts/google-fonts/ 下的字体文件')
      return false
    }
    return undefined
  })
  $('style').each((_, node) => {
    const css = $(node).text()
    if (HIDDEN_STYLE_RULE_RE.test(css)) {
      errors.push('样式块包含默认隐藏态规则，可能导致内容不可见')
      return false
    }
    return undefined
  })
  $('[class], [style]').each((_, node) => {
    const el = $(node)
    const classRaw = el.attr('class') || ''
    const styleRaw = el.attr('style') || ''
    const animation = (el.attr('data-anim') || '').trim().toLowerCase()
    const hasEnteringAnimation = Boolean(animation) && !animation.startsWith('exit-')
    if (/\binvisible\b/i.test(classRaw)) {
      errors.push('包含默认隐藏态 class，可能导致内容不可见')
      return false
    }
    if (/\bopacity-0\b/i.test(classRaw) && !hasEnteringAnimation) {
      errors.push('包含默认隐藏态 class，可能导致内容不可见')
      return false
    }
    if (/visibility\s*:\s*hidden/i.test(styleRaw)) {
      errors.push('包含默认隐藏态 style，可能导致内容不可见')
      return false
    }
    if (/opacity\s*:\s*0(?:\.0+)?(?:\s*!important)?(?:;|$)/i.test(styleRaw) && !hasEnteringAnimation) {
      errors.push('包含默认隐藏态 style，可能导致内容不可见')
      return false
    }
    return undefined
  })
  const root = $('.ppt-page-root[data-ppt-guard-root="1"]').first()
  if (!root.length) {
    errors.push('缺少 .ppt-page-root[data-ppt-guard-root="1"]')
  }
  const content = $('.ppt-page-content').first()
  if (!content.length) {
    errors.push('缺少 .ppt-page-content')
  }
  const blockIds = new Map<string, number>()
  $('[data-block-id]').each((_, node) => {
    const id = ($(node).attr('data-block-id') || '').trim()
    if (!id) return
    blockIds.set(id, (blockIds.get(id) || 0) + 1)
  })
  const duplicatedBlockIds = Array.from(blockIds.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
  if (duplicatedBlockIds.length > 0) {
    errors.push(`data-block-id 重复：${duplicatedBlockIds.join(', ')}`)
  }

  $('video').each((index, node) => {
    const video = $(node)
    const missingAttrs = ['controls', 'playsinline'].filter(
      (attr) => video.attr(attr) === undefined
    )
    if (missingAttrs.length > 0) {
      errors.push(`第 ${index + 1} 个 video 缺少属性：${missingAttrs.join(', ')}`)
    }
    const preload = (video.attr('preload') || '').toLowerCase()
    if (preload && !['metadata', 'auto', 'none'].includes(preload)) {
      errors.push(`第 ${index + 1} 个 video 的 preload 只能是 metadata、auto 或 none`)
    }
  })

  return { valid: errors.length === 0, errors }
}

// ── Section content normalization ──

export const normalizeSectionContent = (pageId: string, html: string): string => {
  const trimmed = html.trim()
  const bodyHtml = extractBodyHtml(trimmed)
  const css = extractStyleCss(trimmed)
  const normalizedBody = (bodyHtml || trimmed).trim()
  const normalizedCss = normalizePageCss(css)
  if (!normalizedCss) return normalizedBody
  return `<style data-page-style="${pageId}">
${normalizedCss}
</style>
${normalizedBody}`
}

// ── Re-export markers for convenience ──

export {
  SHARED_PAGE_STYLES_START,
  SHARED_PAGE_STYLES_END,
  pageContentStartMarker,
  pageContentEndMarker
}
