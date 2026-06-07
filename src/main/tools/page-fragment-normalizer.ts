import * as cheerio from 'cheerio'

type CheerioSelection = ReturnType<cheerio.CheerioAPI>

const CREATIVE_FRAGMENT_SECTION_CLASS = 'h-full min-h-0 overflow-hidden'
const CREATIVE_FRAGMENT_MAIN_CLASS = 'h-full min-h-0'
const EDITABLE_TEXT_SELECTOR = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'blockquote',
  'figcaption',
  'td',
  'th'
].join(',')
const INLINE_TEXT_CANDIDATE_SELECTOR = ['span', 'strong', 'em', 'b', 'i', 'small', 'label', 'button'].join(',')
const VISUAL_BLOCK_SELECTOR = [
  'article',
  'aside',
  'figure',
  'table',
  'section',
  'div'
].join(',')
const VISUAL_BLOCK_CLASS_PATTERN =
  /(?:^|[-_\s])(card|panel|chart|graph|plot|metric|stat|timeline|diagram|visual|figure|image|media|table|ranking|rank|top|list|item|tile|badge|kpi|summary|callout)(?:$|[-_\s])/i
const mergeClassNames = (current: string | undefined, additions: string[]): string => {
  const classes = new Set((current || '').split(/\s+/).filter(Boolean))
  additions.forEach((item) => classes.add(item))
  return Array.from(classes).join(' ')
}

const normalizeBlockIdBase = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'block'

const allocateBlockId = (base: string, used: Set<string>): string => {
  const normalized = normalizeBlockIdBase(base)
  let candidate = normalized
  let suffix = 1
  while (used.has(candidate)) {
    candidate = `${normalized}-${suffix}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

const directTextContent = (el: CheerioSelection): string =>
  el
    .contents()
    .toArray()
    .filter((node) => node.type === 'text')
    .map((node) => ('data' in node ? String(node.data || '') : ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

const hasVisualChild = (el: CheerioSelection): boolean =>
  el.find('canvas,svg,img,picture,video,table,figure').length > 0

const blockIdBaseForTag = (tagName: string, titleAvailable: boolean): string => {
  if (/^h[1-6]$/.test(tagName)) return titleAvailable ? 'title' : 'heading'
  if (tagName === 'li') return 'item'
  if (tagName === 'blockquote') return 'quote'
  if (tagName === 'figcaption') return 'caption'
  if (tagName === 'td' || tagName === 'th') return 'cell'
  return 'text'
}

const blockIdBaseForVisualElement = (
  tagName: string,
  el: CheerioSelection
): string => {
  if (tagName === 'figure') return 'figure'
  if (tagName === 'table') return 'table'
  const raw = `${el.attr('data-role') || ''} ${el.attr('class') || ''} ${el.attr('id') || ''}`
  const match = raw.match(VISUAL_BLOCK_CLASS_PATTERN)
  if (match?.[1]) return match[1]
  if (hasVisualChild(el)) return 'visual'
  return 'block'
}

export const normalizeCreativePageFragment = (html: string): string => {
  const $ = cheerio.load(html.trim(), { scriptingEnabled: false }, false)
  let scaffold: CheerioSelection = $('section[data-page-scaffold]').first()

  if (!scaffold.length) {
    const originalNodes = $.root().contents().toArray()
    const section = $('<section></section>')
    const main = $('<main></main>')
    section.attr('data-page-scaffold', '1')
    section.attr('class', CREATIVE_FRAGMENT_SECTION_CLASS)
    main.attr('data-block-id', 'content')
    main.attr('data-role', 'content')
    main.attr('class', CREATIVE_FRAGMENT_MAIN_CLASS)
    main.append(originalNodes)
    section.append(main)
    $.root().empty().append(section)
    scaffold = section
  } else {
    scaffold.attr('data-page-scaffold', '1')
    scaffold.attr(
      'class',
      mergeClassNames(scaffold.attr('class'), CREATIVE_FRAGMENT_SECTION_CLASS.split(/\s+/))
    )
  }

  let content: CheerioSelection = scaffold
    .find('main[data-role="content"], main[data-block-id="content"], main')
    .first()
  if (!content.length) {
    const originalNodes = scaffold.contents().toArray()
    const main = $('<main></main>')
    main.append(originalNodes)
    scaffold.empty().append(main)
    content = main
  }
  if (!content.attr('data-block-id')) {
    content.attr('data-block-id', 'content')
  }
  content.attr('data-role', 'content')
  content.attr(
    'class',
    mergeClassNames(content.attr('class'), CREATIVE_FRAGMENT_MAIN_CLASS.split(/\s+/))
  )

  const usedBlockIds = new Set<string>()
  $('[data-block-id]').each((_, node) => {
    const el = $(node)
    const current = (el.attr('data-block-id') || '').trim()
    if (current) {
      usedBlockIds.add(current)
    }
  })

  let hasTitleRole = $('[data-role="title"]').length > 0
  content.find(EDITABLE_TEXT_SELECTOR).each((_, node) => {
    const el = $(node)
    if (el.closest('script, style, svg, canvas').length) return
    const tagName = (node.type === 'tag' ? node.name : '').toLowerCase()
    if (!tagName) return
    const directText = directTextContent(el)
    const text = /^(h[1-6]|p|li|blockquote|figcaption|td|th)$/.test(tagName)
      ? el.text().trim()
      : directText
    if (!text || text.replace(/\s+/g, '').length === 0) return
    if (!el.attr('data-block-id')) {
      el.attr(
        'data-block-id',
        allocateBlockId(blockIdBaseForTag(tagName, !hasTitleRole), usedBlockIds)
      )
    }
    if (!hasTitleRole && /^h[1-6]$/.test(tagName)) {
      el.attr('data-role', 'title')
      hasTitleRole = true
    }
  })

  content.find(VISUAL_BLOCK_SELECTOR).each((_, node) => {
    const el = $(node)
    if (el.closest('script, style').length) return
    if (el.attr('data-block-id')) return
    if (el.attr('data-role') === 'content') return
    const tagName = (node.type === 'tag' ? node.name : '').toLowerCase()
    if (!tagName) return
    const rawIdentity = `${el.attr('data-role') || ''} ${el.attr('class') || ''} ${
      el.attr('id') || ''
    }`
    const semanticVisualBlock =
      tagName === 'figure' ||
      tagName === 'table' ||
      VISUAL_BLOCK_CLASS_PATTERN.test(rawIdentity) ||
      hasVisualChild(el)
    if (!semanticVisualBlock) return
    // Skip pure layout containers: div/section with many element children and no direct text
    if ((tagName === 'div' || tagName === 'section') && el.children().length > 3) {
      const dt = directTextContent(el)
      if (!dt || dt.replace(/\s+/g, '').length === 0) return
    }
    el.attr('data-block-id', allocateBlockId(blockIdBaseForVisualElement(tagName, el), usedBlockIds))
  })

  // Pass 3: inline leaf text nodes — only add block-id to inline elements that are
  // true leaf text nodes (direct text content, no child elements with text).
  const BLOCK_TAGS = new Set([
    'div', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main',
    'ul', 'ol', 'dl', 'form', 'fieldset', 'details', 'summary',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote', 'figcaption', 'td', 'th',
    'figure', 'table', 'pre', 'hr'
  ])
  const hasOnlyInlineOrTextChildren = (el: CheerioSelection): boolean => {
    const children = el.children().toArray()
    return children.every((child) => {
      if (child.type !== 'tag') return true
      return !BLOCK_TAGS.has((child as { name?: string }).name?.toLowerCase() || '')
    })
  }
  content.find(INLINE_TEXT_CANDIDATE_SELECTOR).each((_, node) => {
    const el = $(node)
    if (el.closest('script, style, svg, canvas').length) return
    if (el.attr('data-block-id')) return
    if (!hasOnlyInlineOrTextChildren(el)) return
    const text = el.text().replace(/\s+/g, ' ').trim()
    if (!text || text.replace(/\s+/g, '').length === 0) return
    const tagName = (node.type === 'tag' ? node.name : '').toLowerCase()
    el.attr('data-block-id', allocateBlockId(blockIdBaseForTag(tagName, !hasTitleRole), usedBlockIds))
  })

  return ($.root().html() || html).trim()
}
