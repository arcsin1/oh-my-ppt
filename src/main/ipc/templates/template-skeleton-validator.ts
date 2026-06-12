import * as cheerio from 'cheerio'

const NON_TEMPLATE_SKELETON_RESOURCE_RE =
  /(?:^|\/)(?:(?:tailwindcss\.v3|anime\.v4|gsap\.min|ppt-runtime|chart\.v4|katex(?:\.min)?|katex-auto-render\.min)\.(?:js|css)|assets\/fonts\/.+)(?:[?#].*)?$/i
const SKELETON_HINT_RE =
  /\b(?:bg-|background|decor|decoration|texture|mask|overlay|ornament|pattern|backdrop)\b/i

function normalizeTemplateResourceRef(value: string): string | null {
  const raw = value.trim().replace(/^['"]|['"]$/g, '').trim()
  if (!raw || raw.startsWith('#')) return null
  const withoutQuery = raw.split('#')[0].split('?')[0].trim()
  if (
    !withoutQuery ||
    /^data:/i.test(withoutQuery) ||
    /^blob:/i.test(withoutQuery) ||
    /^javascript:/i.test(withoutQuery)
  ) {
    return null
  }
  if (NON_TEMPLATE_SKELETON_RESOURCE_RE.test(withoutQuery)) return null
  return withoutQuery.replace(/^\.\//, '')
}

function collectTemplateSkeletonResourceRefs(html: string): string[] {
  const refs = new Set<string>()
  const push = (value: string | undefined | null): void => {
    if (!value) return
    const normalized = normalizeTemplateResourceRef(value)
    if (normalized) refs.add(normalized)
  }

  const urlRe = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi
  let match: RegExpExecArray | null
  while ((match = urlRe.exec(html)) !== null) {
    push(match[2])
  }

  try {
    const $ = cheerio.load(html, { scriptingEnabled: false })
    $('image').each((_, node) => {
      const el = $(node)
      push(el.attr('href') || el.attr('xlink:href'))
    })
    $('img, video, source').each((_, node) => {
      const el = $(node)
      const identity = [
        el.attr('class') || '',
        el.attr('style') || '',
        el.parent().attr('class') || '',
        el.parent().attr('style') || ''
      ].join(' ')
      if (!SKELETON_HINT_RE.test(identity)) return
      push(el.attr('src') || el.attr('poster'))
    })
  } catch {
    // CSS url(...) extraction above still covers the most important template resources.
  }

  return Array.from(refs).sort()
}

export function validateTemplateSkeletonPreserved(beforeHtml: string, afterHtml: string): string[] {
  const beforeRefs = collectTemplateSkeletonResourceRefs(beforeHtml)
  if (beforeRefs.length === 0) return []
  const afterRefs = new Set(collectTemplateSkeletonResourceRefs(afterHtml))
  return beforeRefs.filter((ref) => !afterRefs.has(ref))
}
