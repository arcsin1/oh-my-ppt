import * as cheerio from 'cheerio'
import {
  SHARED_PAGE_STYLES_END,
  SHARED_PAGE_STYLES_START,
  pageContentEndMarker,
  pageContentStartMarker
} from './types'
import {
  DATA_ANIM_FROM_VALUES,
  DATA_ANIM_SEQUENCES,
  DATA_ANIM_SUPPORTED_TYPES,
  DATA_ANIM_TRIGGERS
} from '../animation/data-anim-schema'
import {
  CHART_SKILL_NAME,
  DATA_ANIM_SKILL_NAME,
  formatSkillUsageRequirement,
} from '../skills/skill-contract'

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
export const PAGE_PLACEHOLDER_TEXT = '等待模型填充这一页内容'

export const isPlaceholderPageHtml = (html: string): boolean =>
  html.includes(PAGE_PLACEHOLDER_TEXT) || /data-placeholder-page\s*=\s*["']1["']/i.test(html)

const isLinearMotionPathString = (value: string): boolean => {
  const coords = value.match(/-?\d+(?:\.\d+)?/g)
  return Array.isArray(coords) && coords.length >= 4
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
  const supportedAnimTypes = new Set<string>(DATA_ANIM_SUPPORTED_TYPES)
  const supportedAnimTriggers = new Set<string>(DATA_ANIM_TRIGGERS)
  const supportedAnimFromValues = new Set<string>(DATA_ANIM_FROM_VALUES)
  const supportedAnimDirections = new Set(['normal', 'reverse', 'alternate'])
  const normalizeAnimTrigger = (value: string): 'load' | 'click' | 'with' | 'after' => {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'on-click') return 'click'
    if (normalized === 'after-previous') return 'after'
    if (normalized === 'with-previous') return 'with'
    if (normalized === 'click' || normalized === 'with' || normalized === 'after') return normalized
    return 'load'
  }
  const CLICK_GROUP_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
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
    const invalidAnimTypes = new Set<string>()
    $('[data-anim]').each((_, node) => {
      const type = (($(node).attr('data-anim') || '').trim().toLowerCase())
      if (!type || !supportedAnimTypes.has(type)) {
        invalidAnimTypes.add(type || '(empty)')
      }
    })
    if (invalidAnimTypes.size > 0) {
      errors.push(
        `data-anim 仅支持当前公开可编辑动画类型，非法值：${Array.from(invalidAnimTypes).join(', ')}`
      )
    }
    const invalidTriggers = new Set<string>()
    $('[data-anim-trigger]').each((_, node) => {
      const trigger = (($(node).attr('data-anim-trigger') || '').trim().toLowerCase())
      if (!trigger || !supportedAnimTriggers.has(trigger)) {
        invalidTriggers.add(trigger || '(empty)')
      }
    })
    if (invalidTriggers.size > 0) {
      errors.push(
        `data-anim-trigger 仅支持 ${DATA_ANIM_TRIGGERS.join('/')}，非法值：${Array.from(invalidTriggers).join(', ')}`
      )
    }
    const invalidFromValues = new Set<string>()
    $('[data-anim-from]').each((_, node) => {
      const from = (($(node).attr('data-anim-from') || '').trim().toLowerCase())
      if (!from || !supportedAnimFromValues.has(from)) {
        invalidFromValues.add(from || '(empty)')
      }
    })
    if (invalidFromValues.size > 0) {
      errors.push(
        `data-anim-from 仅支持 ${DATA_ANIM_FROM_VALUES.join('/')}，非法值：${Array.from(invalidFromValues).join(', ')}`
      )
    }
    const missingPathValues = new Set<string>()
    const unexpectedPathValues = new Set<string>()
    $('[data-anim]').each((_, node) => {
      const type = (($(node).attr('data-anim') || '').trim().toLowerCase())
      const rawPath = ($(node).attr('data-anim-path') || '').trim()
      if (type === 'path') {
        if (!rawPath) {
          missingPathValues.add('path')
        } else if (!isLinearMotionPathString(rawPath)) {
          missingPathValues.add(rawPath)
        }
        return
      }
      if ($(node).attr('data-anim-path') !== undefined) {
        unexpectedPathValues.add(type || '(empty)')
      }
    })
    if (missingPathValues.size > 0) {
      errors.push(
        `data-anim="path" 必须同时提供可解析为线性位移的 data-anim-path，非法值：${Array.from(missingPathValues).join(', ')}`
      )
    }
    if (unexpectedPathValues.size > 0) {
      errors.push(
        `只有 data-anim=\"path\" 才能使用 data-anim-path，非法类型：${Array.from(unexpectedPathValues).join(', ')}`
      )
    }
    const invalidDurations = new Set<string>()
    $('[data-anim-duration]').each((_, node) => {
      const raw = ($(node).attr('data-anim-duration') || '').trim()
      const value = Number(raw)
      if (!raw || !Number.isFinite(value) || value < 100 || value > 5000) {
        invalidDurations.add(raw || '(empty)')
      }
    })
    if (invalidDurations.size > 0) {
      errors.push(
        `data-anim-duration 必须是 100-5000 的数字毫秒值，非法值：${Array.from(invalidDurations).join(', ')}`
      )
    }
    const invalidDelays = new Set<string>()
    $('[data-anim-delay]').each((_, node) => {
      const raw = ($(node).attr('data-anim-delay') || '').trim()
      if (!raw) {
        invalidDelays.add('(empty)')
        return
      }
      if (/^stagger\s*\(\s*\d+\s*\)$/i.test(raw)) return
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) {
        invalidDelays.add(raw)
      }
    })
    if (invalidDelays.size > 0) {
      errors.push(
        `data-anim-delay 必须是大于等于 0 的数字毫秒值或 stagger(N)，非法值：${Array.from(invalidDelays).join(', ')}`
      )
    }
    const runtimeOnlyEasing = new Set<string>()
    $('[data-anim-easing]').each((_, node) => {
      const raw = ($(node).attr('data-anim-easing') || '').trim()
      runtimeOnlyEasing.add(raw || '(empty)')
    })
    if (runtimeOnlyEasing.size > 0) {
      errors.push(
        `data-anim-easing 当前属于 runtime-only 兼容能力，不应进入标准可编辑导出页面，非法值：${Array.from(runtimeOnlyEasing).join(', ')}`
      )
    }
    const runtimeOnlyRepeats = new Set<string>()
    $('[data-anim-repeat]').each((_, node) => {
      const raw = ($(node).attr('data-anim-repeat') || '').trim().toLowerCase()
      runtimeOnlyRepeats.add(raw || '(empty)')
    })
    if (runtimeOnlyRepeats.size > 0) {
      errors.push(
        `data-anim-repeat 当前属于 runtime-only 兼容能力，不应进入标准可编辑导出页面，非法值：${Array.from(runtimeOnlyRepeats).join(', ')}`
      )
    }
    const runtimeOnlyDirections = new Set<string>()
    $('[data-anim-direction]').each((_, node) => {
      const raw = ($(node).attr('data-anim-direction') || '').trim().toLowerCase()
      if (!raw || !supportedAnimDirections.has(raw)) {
        runtimeOnlyDirections.add(raw || '(empty)')
        return
      }
      runtimeOnlyDirections.add(raw)
    })
    if (runtimeOnlyDirections.size > 0) {
      errors.push(
        `data-anim-direction 当前属于 runtime-only 兼容能力，不应进入标准可编辑导出页面，非法值：${Array.from(runtimeOnlyDirections).join(', ')}`
      )
    }
    const invalidSequences = new Set<string>()
    $('[data-anim-sequence]').each((_, node) => {
      const value = ($(node).attr('data-anim-sequence') || '').trim().toLowerCase()
      if (value && !DATA_ANIM_SEQUENCES.includes(value as (typeof DATA_ANIM_SEQUENCES)[number])) {
        invalidSequences.add(value)
      }
    })
    if (invalidSequences.size > 0) {
      errors.push(
        `data-anim-sequence 仅支持 with/after，非法值：${Array.from(invalidSequences).join(', ')}`
      )
    }
    const invalidStaggers = new Set<string>()
    $('[data-anim-stagger]').each((_, node) => {
      const raw = ($(node).attr('data-anim-stagger') || '').trim()
      if (!raw) {
        invalidStaggers.add('(empty)')
        return
      }
      const value = Number(raw)
      if (!Number.isFinite(value) || value < 0) {
        invalidStaggers.add(raw)
      }
    })
    if (invalidStaggers.size > 0) {
      errors.push(
        `data-anim-stagger 必须是大于等于 0 的数字毫秒值，非法值：${Array.from(invalidStaggers).join(', ')}`
      )
    }
    const invalidClickGroups = new Set<string>()
    const nonClickGrouped: string[] = []
    const clickGroupTimeline: Array<string | null> = []
    $('[data-anim]').each((_, node) => {
      const trigger = normalizeAnimTrigger($(node).attr('data-anim-trigger') || 'load')
      const attrValue = $(node).attr('data-anim-click-group')
      const group = (attrValue || '').trim()
      if (trigger !== 'click') {
        if (attrValue !== undefined && !group) {
          invalidClickGroups.add('(empty)')
          return
        }
        if (!group) return
        if (!CLICK_GROUP_RE.test(group)) {
          invalidClickGroups.add(group || '(empty)')
          return
        }
        nonClickGrouped.push(group)
        return
      }
      if (attrValue === undefined) {
        clickGroupTimeline.push(null)
        return
      }
      if (!group) {
        invalidClickGroups.add('(empty)')
        clickGroupTimeline.push(null)
        return
      }
      if (!CLICK_GROUP_RE.test(group)) {
        invalidClickGroups.add(group)
        clickGroupTimeline.push(null)
        return
      }
      clickGroupTimeline.push(group)
    })
    if (invalidClickGroups.size > 0) {
      errors.push(
        `data-anim-click-group 仅支持字母/数字/中划线/下划线，并且必须以字母或数字开头，非法值：${Array.from(invalidClickGroups).join(', ')}`
      )
    }
    if (nonClickGrouped.length > 0) {
      errors.push(
        `data-anim-click-group 只能用于 click 触发动画，非法分组：${Array.from(new Set(nonClickGrouped)).join(', ')}`
      )
    }
    if (clickGroupTimeline.length > 1) {
      const closedGroups = new Set<string>()
      let activeGroup: string | null = null
      for (const group of clickGroupTimeline) {
        if (!group) {
          if (activeGroup) {
            closedGroups.add(activeGroup)
            activeGroup = null
          }
          continue
        }
        if (group === activeGroup) continue
        if (closedGroups.has(group)) {
          errors.push(`data-anim-click-group 必须在 click 动画的 DOM 顺序上连续出现，非法分组：${group}`)
          break
        }
        if (activeGroup) closedGroups.add(activeGroup)
        activeGroup = group
      }
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
