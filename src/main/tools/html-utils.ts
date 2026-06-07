import * as cheerio from 'cheerio'
import {
  SHARED_PAGE_STYLES_END,
  SHARED_PAGE_STYLES_START,
  pageContentEndMarker,
  pageContentStartMarker
} from './types'
import {
  CHART_SKILL_NAME,
  DATA_ANIM_SKILL_NAME,
  formatSkillUsageRequirement,
} from '../skills/skill-contract'
import { DATA_ANIM_SUPPORTED_TYPES, type DataAnimType } from '../animation/data-anim-schema'
import { collectPptxFidelityWarnings } from '../animation/pptx-animation-map'

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
const REMOTE_SCRIPT_OR_LINK_RE =
  /<(script|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\/[^"']+["'][^>]*>/i
const HIDDEN_STYLE_RULE_RE =
  /(?:^|[;}])\s*[^{}]+\{\s*[^{}]*(?:opacity\s*:\s*0(?:\.0+)?|visibility\s*:\s*hidden)[^{}]*\}/i
const VALID_DATA_ANIM_VALUES = new Set<string>([...DATA_ANIM_SUPPORTED_TYPES, 'none'])
const FIXED_PIXEL_HEIGHT_CLASS_RE = /^h-\[\s*(?!0+(?:\.0+)?px\b)\d+(?:\.\d+)?px\s*\]$/
const FIXED_HEIGHT_STYLE_RE =
  /(?:^|;)\s*height\s*:\s*(?!\s*(?:auto|0(?:px|rem|em|%)?|100%|inherit|initial|unset)\b)[^;]+/i
export const PAGE_PLACEHOLDER_TEXT = '等待模型填充这一页内容'
const PPT_SCRIPTED_MOTION_RE = /PPT\.(?:animate|createTimeline)\s*\(/m

export const isPlaceholderPageHtml = (html: string): boolean =>
  html.includes(PAGE_PLACEHOLDER_TEXT) || /data-placeholder-page\s*=\s*["']1["']/i.test(html)


const isAllowedRuntimeAsset = (src: string): boolean => {
  const normalized = src.trim().toLowerCase()
  const clean = normalized.split('?')[0].split('#')[0]
  return (
    clean.endsWith('/assets/anime.v4.js') ||
    clean.endsWith('./assets/anime.v4.js') ||
    clean.endsWith('assets/anime.v4.js') ||
    clean.endsWith('/assets/gsap.min.js') ||
    clean.endsWith('./assets/gsap.min.js') ||
    clean.endsWith('assets/gsap.min.js') ||
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

const classBaseName = (className: string): string => className.split(':').pop() || className

const hasFixedPixelHeightClass = (classRaw: string): boolean =>
  classRaw
    .split(/\s+/)
    .map(classBaseName)
    .some((className) => FIXED_PIXEL_HEIGHT_CLASS_RE.test(className))

const hasUnstableHeightClass = (classRaw: string): boolean =>
  classRaw
    .split(/\s+/)
    .map(classBaseName)
    .some(
      (className) =>
        className === 'flex-1' ||
        (/^h-/.test(className) && !FIXED_PIXEL_HEIGHT_CLASS_RE.test(className)) ||
        /^min-h-/.test(className) ||
        /^max-h-/.test(className)
    )

export const validateHtmlContent = (
  html: string
): { valid: boolean; errors: string[]; warnings: string[] } => {
  const errors: string[] = []
  const warnings: string[] = []
  const animationCallScanHtml = html.replace(
    /\bdata-anim-delay\s*=\s*(["'])stagger\s*\(\s*\d+\s*\)\1/gi,
    'data-anim-delay=$1__DATA_ANIM_STAGGER__$1'
  )
  const hasUnqualifiedCall = (fnName: string): boolean =>
    new RegExp(`(^|[^\\w$.])${fnName}\\s*\\(`, 'm').test(animationCallScanHtml)
  if (!html || html.trim().length === 0) {
    errors.push('HTML 内容为空')
    return { valid: false, errors, warnings }
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
  if (/anime\s*\(\s*\{[\s\S]{0,240}?targets\s*:/im.test(html)) {
    errors.push(`检测到旧版 anime({ targets, ... }) 写法；修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`)
  }
  if (/(^|[^\w$])anime\.(?:animate|stagger|createTimeline|timeline)\s*\(/i.test(html)) {
    errors.push(`检测到直接 anime.* 调用；修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`)
  }
  if (/(^|[^\w$])gsap(?:\.[A-Za-z_$][\w$]*)+\s*\(/i.test(html)) {
    errors.push(`检测到直接 gsap.* 调用；GSAP 仅作为内部运行时引擎。修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`)
  }
  if (/\b(?:window|globalThis)\.gsap\b/i.test(html)) {
    errors.push(`检测到直接访问 window.gsap/globalThis.gsap；请使用 data-anim 或 PPT.* 动画接口。${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`)
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
    const unsupportedAnimTypes = new Set<string>()
    const declaredAnimTypes = new Set<DataAnimType>()
    $('[data-anim]').each((_, node) => {
      const type = ($(node).attr('data-anim') || '').trim().toLowerCase()
      if (type && type !== 'none' && VALID_DATA_ANIM_VALUES.has(type)) {
        declaredAnimTypes.add(type as DataAnimType)
      }
      if (type && !VALID_DATA_ANIM_VALUES.has(type)) unsupportedAnimTypes.add(type)
    })
    if (unsupportedAnimTypes.size > 0) {
      errors.push(
        `data-anim 类型不受支持：${Array.from(unsupportedAnimTypes).join(', ')}。修改动画前请先 ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`
      )
    }
    warnings.push(...collectPptxFidelityWarnings(declaredAnimTypes))
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
  if (PPT_SCRIPTED_MOTION_RE.test(html)) {
    warnings.push(
      '检测到 PPT.animate/PPT.createTimeline；该接口适合预览编排，但 editable PPTX 导出只对 data-anim 提供稳定 native roundtrip，如需可编辑导出请优先改写为 data-anim。'
    )
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings: Array.from(new Set(warnings))
  }
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
    if (/\bopacity-0\b|\binvisible\b/i.test(classRaw)) {
      errors.push('包含默认隐藏态 class，可能导致内容不可见')
      return false
    }
    if (/visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?(?:;|$)/i.test(styleRaw)) {
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

  $('.ppt-chart-frame').each((index, node) => {
    const el = $(node)
    const classRaw = el.attr('class') || ''
    const styleRaw = el.attr('style') || ''
    if (hasUnstableHeightClass(classRaw)) {
      errors.push(`第 ${index + 1} 个 .ppt-chart-frame 必须使用 h-[Npx]，不能使用 Tailwind 比例/预设高度类`)
      return undefined
    }
    if (!hasFixedPixelHeightClass(classRaw) && !FIXED_HEIGHT_STYLE_RE.test(styleRaw)) {
      errors.push(`第 ${index + 1} 个 .ppt-chart-frame 缺少固定高度，请使用 h-[Npx]`)
    }
    return undefined
  })


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
