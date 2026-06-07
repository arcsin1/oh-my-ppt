import * as cheerio from 'cheerio'
import { nanoid } from 'nanoid'

type CheerioSelection = ReturnType<cheerio.CheerioAPI>
type CheerioNode = ReturnType<CheerioSelection['contents']> extends cheerio.Cheerio<infer Node>
  ? Node
  : never

// ─── 共享锁 ───────────────────────────────────────────────

const htmlWriteLocks = new Map<string, Promise<void>>()

export async function withHtmlFileLock<T>(htmlPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = htmlWriteLocks.get(htmlPath) || Promise.resolve()
  const run = previous.then(fn, fn)
  const next = run.then(
    () => undefined,
    () => undefined
  )
  htmlWriteLocks.set(htmlPath, next)
  return run.finally(() => {
    if (htmlWriteLocks.get(htmlPath) === next) {
      htmlWriteLocks.delete(htmlPath)
    }
  })
}

// ─── 常量 ─────────────────────────────────────────────────

export const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'code',
  'em',
  'i',
  'label',
  'small',
  'span',
  'strong',
  'sub',
  'sup'
])

export const EDITABLE_TEXT_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'ul',
  'ol',
  'li',
  'span',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'small',
  'label',
  'button',
  'td',
  'th',
  'blockquote',
  'figcaption',
  'sub',
  'sup'
])
export const EDITABLE_TEXT_CHILD_TAGS = new Set([...EDITABLE_TEXT_TAGS, 'br'])

export const SCAFFOLD_BLOCK_IDS = new Set(['content', 'page', 'root'])
export const BLOCKED_TAGS = new Set([
  'html',
  'head',
  'body',
  'script',
  'style',
  'link',
  'meta',
  'title'
])

// ─── 通用工具函数 ──────────────────────────────────────────

export function parseStyle(style: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const rawDeclaration of style.split(';')) {
    const declaration = rawDeclaration.trim()
    if (!declaration) continue
    const separatorIndex = declaration.indexOf(':')
    if (separatorIndex < 0) continue
    const key = declaration.slice(0, separatorIndex).trim()
    const value = declaration.slice(separatorIndex + 1).trim()
    if (!key || !value) continue
    map.set(key, value)
  }
  return map
}

export function serializeStyle(styleMap: Map<string, string>): string {
  return Array.from(styleMap.entries())
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ')
}

function stripStyleKeys(style: string, keys: string[]): string {
  const excluded = new Set(keys.map((key) => key.toLowerCase()))
  const styleMap = parseStyle(style)
  let changed = false
  for (const key of Array.from(styleMap.keys())) {
    if (excluded.has(key.toLowerCase())) {
      styleMap.delete(key)
      changed = true
    }
  }
  return changed ? serializeStyle(styleMap) : style
}

export function clampDragValue(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(-1600, Math.min(1600, Math.round(parsed * 10) / 10))
}

export function clampSizeValue(value: unknown): number | null {
  if (value === undefined || value === null) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(1, Math.min(3200, Math.round(parsed * 10) / 10))
}

export interface ChildStyleUpdate {
  path: number[]
  width: number | null
  height: number | null
}

export function normalizeChildStyleUpdates(value: unknown): ChildStyleUpdate[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item): ChildStyleUpdate | null => {
      if (!item || typeof item !== 'object') return null
      const record = item as { path?: unknown; width?: unknown; height?: unknown }
      if (!Array.isArray(record.path) || record.path.length === 0 || record.path.length > 12)
        return null
      const path = record.path
        .map((part) => Number(part))
        .filter((part) => Number.isInteger(part) && part >= 0 && part <= 200)
      if (path.length !== record.path.length) return null
      const width = clampSizeValue(record.width)
      const height = clampSizeValue(record.height)
      if (width === null && height === null) return null
      return { path, width, height }
    })
    .filter((item): item is ChildStyleUpdate => item !== null)
    .slice(0, 20)
}

export function normalizeText(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(text)) return text
  if (/^rgba?\([\d\s.,%]+\)$/i.test(text)) return text
  return null
}

export function normalizeFontSize(value: unknown): string | null {
  const raw =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const numberValue = Number(raw.replace(/px$/i, ''))
  if (!Number.isFinite(numberValue)) return null
  const clamped = Math.max(8, Math.min(160, Math.round(numberValue * 10) / 10))
  return `${clamped}px`
}

export function normalizeFontWeight(value: unknown): string | null {
  const raw =
    typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  if (['normal', 'bold', 'lighter', 'bolder'].includes(raw)) return raw
  const numberValue = Number(raw)
  if (!Number.isFinite(numberValue)) return null
  const clamped = Math.max(100, Math.min(900, Math.round(numberValue / 100) * 100))
  return String(clamped)
}

// Keep in sync with normalizeTextAlign in src/renderer/src/pages/session-detail.tsx.
export function normalizeTextAlign(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return ['left', 'center', 'right', 'justify'].includes(text) ? text : null
}

export function normalizeOpacity(value: unknown): string | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return String(Math.max(0, Math.min(1, Math.round(parsed * 100) / 100)))
}

export function normalizeObjectFit(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return ['contain', 'cover', 'fill', 'none', 'scale-down'].includes(text) ? text : null
}

export function normalizeBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  return null
}

export const attrEscape = (value: string): string => value.replace(/"/g, '\\"')

export const stableSelectorFor = (pageId: string, blockId: string): string =>
  `body[data-page-id="${attrEscape(pageId)}"] [data-block-id="${attrEscape(blockId)}"]`

export function allocateBlockId(): string {
  return 'select-arcsin1-' + nanoid(8)
}

export function assertAnchorableElement(target: CheerioSelection): void {
  const node = target.get(0)
  const tagName = String((node as { tagName?: string })?.tagName || '').toLowerCase()
  if (!tagName || BLOCKED_TAGS.has(tagName)) {
    throw new Error(`当前元素不能锚定：<${tagName || 'unknown'}>`)
  }
  const role = (target.attr('data-role') || '').trim()
  const blockId = (target.attr('data-block-id') || '').trim()
  const classRaw = target.attr('class') || ''
  const guardRoot = target.attr('data-ppt-guard-root') === '1'
  if (
    role === 'content' ||
    SCAFFOLD_BLOCK_IDS.has(blockId) ||
    guardRoot ||
    /\bppt-page-(?:root|content|fit-scope)\b/.test(classRaw)
  ) {
    throw new Error('页面骨架元素不能锚定，请选择页面内容里的具体元素')
  }
}

// ─── Patch 函数 ────────────────────────────────────────────

export function patchDraggedElementStyle(
  html: string,
  selector: string,
  x: number,
  y: number,
  width: number | null,
  height: number | null,
  childUpdates: ChildStyleUpdate[],
  isAbsoluteMode: boolean,
  zIndex?: number,
  zIndexOnly?: boolean
): string {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  let target
  try {
    target = $(selector).first()
  } catch {
    return html
  }
  if (!target || target.length === 0) return html

  const styleMap = parseStyle(target.attr('style') || '')

  // zIndexOnly: only update z-index, leave everything else untouched
  if (zIndexOnly && zIndex !== undefined) {
    const position = String(styleMap.get('position') || '').trim().toLowerCase()
    if (!position || position === 'static') styleMap.set('position', 'relative')
    styleMap.set('z-index', String(zIndex))
    target.attr('style', serializeStyle(styleMap))
    return $.html()
  }

  const tagName = String(target.get(0)?.tagName || '').toLowerCase()
  const effectiveZIndex = zIndex !== undefined ? String(zIndex) : undefined

  if (isAbsoluteMode) {
    styleMap.set('position', 'absolute')
    styleMap.set('left', `${x}px`)
    styleMap.set('top', `${y}px`)
    if (width !== null) styleMap.set('width', `${width}px`)
    if (height !== null) styleMap.set('height', `${height}px`)
    if (effectiveZIndex !== undefined) {
      styleMap.set('z-index', effectiveZIndex)
    } else if (!styleMap.has('z-index')) {
      styleMap.set('z-index', '10')
    }
    styleMap.delete('--ppt-drag-x')
    styleMap.delete('--ppt-drag-y')
    styleMap.delete('translate')
    styleMap.delete('will-change')
    target.attr('data-ppt-layout-converted', '1')
  } else {
    if (INLINE_TAGS.has(tagName) && !styleMap.has('display')) {
      styleMap.set('display', 'inline-block')
    }
    const position = String(styleMap.get('position') || '').trim().toLowerCase()
    if (!position || position === 'static') {
      styleMap.set('position', 'relative')
    }
    if (effectiveZIndex !== undefined) {
      styleMap.set('z-index', effectiveZIndex)
    } else if (!styleMap.has('z-index')) {
      styleMap.set('z-index', '10')
    }
    styleMap.set('--ppt-drag-x', `${x}px`)
    styleMap.set('--ppt-drag-y', `${y}px`)
    styleMap.set('translate', 'var(--ppt-drag-x, 0px) var(--ppt-drag-y, 0px)')
    if (width !== null) styleMap.set('width', `${width}px`)
    if (height !== null) styleMap.set('height', `${height}px`)
    styleMap.delete('will-change')
  }
  target.attr('style', serializeStyle(styleMap))

  for (const childUpdate of childUpdates) {
    let child = target
    for (const index of childUpdate.path) {
      child = child.children().eq(index)
      if (!child || child.length === 0) break
    }
    if (!child || child.length === 0) continue
    if (String(child.get(0)?.tagName || '').toLowerCase() === 'canvas') continue
    const childStyleMap = parseStyle(child.attr('style') || '')
    if (childUpdate.width !== null) childStyleMap.set('width', `${childUpdate.width}px`)
    if (childUpdate.height !== null) childStyleMap.set('height', `${childUpdate.height}px`)
    child.attr('style', serializeStyle(childStyleMap))
  }

  return $.html()
}

export function hasOnlyEditableTextChildren(
  $: cheerio.CheerioAPI,
  target: CheerioSelection
): boolean {
  return target
    .children()
    .toArray()
    .every((child) => {
      const childTagName = String(child.tagName || '').toLowerCase()
      if (!childTagName || !EDITABLE_TEXT_CHILD_TAGS.has(childTagName)) return false
      const childElement = $(child)
      return hasOnlyEditableTextChildren($, childElement)
    })
}

export function patchElementProperties(
  html: string,
  selector: string,
  patch: {
    html?: string
    text?: string
    textTarget?: unknown
    style?: {
      color?: string
      fontSize?: string
      fontWeight?: string
      textAlign?: string
    }
  }
): string {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  let target: CheerioSelection
  try {
    target = $(selector).first()
  } catch {
    return html
  }
  if (!target || target.length === 0) return html

  const node = target.get(0) as { tagName?: string } | undefined
  const tagName = String(node?.tagName || '').toLowerCase()
  const hasRole = Boolean(target.attr('data-role'))
  const hasBlockId = Boolean(target.attr('data-block-id'))
  if (!EDITABLE_TEXT_TAGS.has(tagName) && !hasRole && !hasBlockId) {
    throw new Error(`当前元素暂不支持直接编辑文字：<${tagName || 'unknown'}>`)
  }
  if (!hasOnlyEditableTextChildren($, target)) {
    throw new Error('当前元素包含非文本子元素，暂不支持直接编辑；可以选择更内层的文字。')
  }

  if (typeof patch.html === 'string') {
    const nextHtml = stripUnsafeRichTextHtml(patch.html)
    const text = normalizeText(
      cheerio.load(`<root>${nextHtml}</root>`, { scriptingEnabled: false }, false).text()
    )
    if (!text) throw new Error('文字不能为空')
    if (text.length > 500) throw new Error('文字不能超过 500 个字符')
    target.html(nextHtml)
  } else if (typeof patch.text === 'string') {
    const text = patch.text
    const normalizedText = normalizeText(text)
    if (!normalizedText) throw new Error('文字不能为空')
    if (normalizedText.length > 500) throw new Error('文字不能超过 500 个字符')
    if (!patchTextNodeTarget($, patch.textTarget, text)) {
      target.text(normalizedText)
    }
  }

  const stylePatch = patch.style || {}
  const styleMap = parseStyle(target.attr('style') || '')
  const color = normalizeColor(stylePatch.color)
  const fontSize = normalizeFontSize(stylePatch.fontSize)
  const fontWeight = normalizeFontWeight(stylePatch.fontWeight)
  const textAlign = normalizeTextAlign(stylePatch.textAlign)
  if (color) styleMap.set('color', color)
  if (fontSize) styleMap.set('font-size', fontSize)
  if (fontWeight) styleMap.set('font-weight', fontWeight)
  if (textAlign) styleMap.set('text-align', textAlign)
  if (color || fontSize || fontWeight || textAlign) {
    target.attr('style', serializeStyle(styleMap))
  }

  return $.html()
}

export interface TextNodeTarget {
  type: 'text-node'
  parentSelector: string
  textNodeIndex: number
}

function normalizeTextNodeTarget(value: unknown): TextNodeTarget | null {
  if (!value || typeof value !== 'object') return null
  const record = value as {
    type?: unknown
    parentSelector?: unknown
    textNodeIndex?: unknown
  }
  if (record.type !== 'text-node') return null
  const parentSelector =
    typeof record.parentSelector === 'string' ? record.parentSelector.trim() : ''
  const textNodeIndex = Number(record.textNodeIndex)
  if (
    !parentSelector ||
    !Number.isInteger(textNodeIndex) ||
    textNodeIndex < 0 ||
    textNodeIndex > 1000
  ) {
    return null
  }
  return { type: 'text-node', parentSelector, textNodeIndex }
}

export function patchTextNodeTarget(
  $: cheerio.CheerioAPI,
  textTarget: unknown,
  text: string
): boolean {
  const target = normalizeTextNodeTarget(textTarget)
  if (!target) return false
  let parent: CheerioSelection
  try {
    parent = $(target.parentSelector).first()
  } catch {
    return false
  }
  if (!parent || parent.length === 0) return false
  const node = parent.contents().get(target.textNodeIndex) as
    | (CheerioNode & { type?: string; data?: string })
    | undefined
  if (!node || node.type !== 'text') return false
  node.data = text
  return true
}

function stripUnsafeRichTextHtml(html: string): string {
  const $ = cheerio.load(`<root>${html}</root>`, { scriptingEnabled: false }, false)
  const root = $('root').first()
  root
    .find(
      'script, style, iframe, object, embed, img, video, audio, canvas, svg, input, textarea, select'
    )
    .remove()
  root.find('*').each((_, node) => {
    const el = $(node)
    const tagName = String(node.tagName || '').toLowerCase()
    if (!EDITABLE_TEXT_CHILD_TAGS.has(tagName)) {
      el.replaceWith(el.contents())
      return
    }
    const attrs = { ...(node.attribs || {}) }
    for (const name of Object.keys(attrs)) {
      if (
        name === 'style' ||
        name === 'class' ||
        name === 'data-block-id' ||
        (name === 'data-text' && el.hasClass('ppt-art-text')) ||
        name === 'href' ||
        name === 'target' ||
        name === 'rel'
      ) {
        continue
      }
      el.removeAttr(name)
    }
    const style = stripStyleKeys(el.attr('style') || '', ['zoom'])
    if (style) el.attr('style', style)
    else el.removeAttr('style')
    if (tagName === 'a') {
      const href = el.attr('href') || ''
      if (href && !/^(https?:|mailto:|#)/i.test(href)) el.removeAttr('href')
      if (el.attr('target') === '_blank') el.attr('rel', 'noopener noreferrer')
    }
  })
  return root.html() || ''
}

export function patchGenericElementProperties(
  html: string,
  selector: string,
  patch: {
    html?: string
    text?: string
    textTarget?: unknown
    style?: {
      zIndex?: unknown
      opacity?: unknown
      backgroundColor?: unknown
      color?: unknown
      fontSize?: unknown
      fontWeight?: unknown
      textAlign?: unknown
      objectFit?: unknown
    }
    attrs?: {
      alt?: unknown
      poster?: unknown
      controls?: unknown
      muted?: unknown
      loop?: unknown
      autoplay?: unknown
      playsInline?: unknown
      preload?: unknown
    }
  }
): string {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  let target: CheerioSelection
  try {
    target = $(selector).first()
  } catch {
    return html
  }
  if (!target || target.length === 0) return html

  if (typeof patch.html === 'string') {
    const nextHtml = stripUnsafeRichTextHtml(patch.html)
    const text = normalizeText(
      cheerio.load(`<root>${nextHtml}</root>`, { scriptingEnabled: false }, false).text()
    )
    if (!text) throw new Error('文字不能为空')
    if (text.length > 500) throw new Error('文字不能超过 500 个字符')
    target.html(nextHtml)
  } else if (typeof patch.text === 'string') {
    const text = patch.text
    const normalizedText = normalizeText(text)
    if (!normalizedText) throw new Error('文字不能为空')
    if (normalizedText.length > 500) throw new Error('文字不能超过 500 个字符')
    if (!patchTextNodeTarget($, patch.textTarget, text)) {
      if (!hasOnlyEditableTextChildren($, target)) {
        throw new Error('当前元素包含非文本子元素，暂不支持直接编辑；可以选择更内层的文字。')
      }
      target.text(normalizedText)
    }
  }

  const stylePatch = patch.style || {}
  const styleMap = parseStyle(target.attr('style') || '')
  const zIndex = typeof stylePatch.zIndex === 'number' ? Math.round(stylePatch.zIndex) : null
  const opacity = normalizeOpacity(stylePatch.opacity)
  const backgroundColor = normalizeColor(stylePatch.backgroundColor)
  const color = normalizeColor(stylePatch.color)
  const fontSize = normalizeFontSize(stylePatch.fontSize)
  const fontWeight = normalizeFontWeight(stylePatch.fontWeight)
  const textAlign = normalizeTextAlign(stylePatch.textAlign)
  const objectFit = normalizeObjectFit(stylePatch.objectFit)
  if (zIndex !== null && zIndex >= -999 && zIndex <= 9999) {
    const position = String(styleMap.get('position') || '').trim().toLowerCase()
    if (!position || position === 'static') styleMap.set('position', 'relative')
    styleMap.set('z-index', String(zIndex))
  }
  if (opacity) styleMap.set('opacity', opacity)
  if (backgroundColor) styleMap.set('background-color', backgroundColor)
  if (color) styleMap.set('color', color)
  if (fontSize) styleMap.set('font-size', fontSize)
  if (fontWeight) styleMap.set('font-weight', fontWeight)
  if (textAlign) styleMap.set('text-align', textAlign)
  if (objectFit) styleMap.set('object-fit', objectFit)
  if (
    zIndex !== null ||
    opacity ||
    backgroundColor ||
    color ||
    fontSize ||
    fontWeight ||
    textAlign ||
    objectFit
  ) {
    target.attr('style', serializeStyle(styleMap))
  }

  const attrs = patch.attrs || {}
  if (typeof attrs.alt === 'string') target.attr('alt', attrs.alt.slice(0, 500))
  if (typeof attrs.poster === 'string') target.attr('poster', attrs.poster.slice(0, 1000))
  for (const name of ['controls', 'muted', 'loop', 'autoplay'] as const) {
    const value = normalizeBoolean(attrs[name])
    if (value === null) continue
    if (value) target.attr(name, '')
    else target.removeAttr(name)
  }
  const playsInline = normalizeBoolean(attrs.playsInline)
  if (playsInline !== null) {
    if (playsInline) target.attr('playsinline', '')
    else target.removeAttr('playsinline')
  }
  if (typeof attrs.preload === 'string') {
    const preload = attrs.preload.toLowerCase()
    if (['metadata', 'auto', 'none'].includes(preload)) target.attr('preload', preload)
  }

  return $.html()
}

export function ensureElementAnchorInHtml(
  html: string,
  args: {
    pageId: string
    selector: string
    elementTag?: string
  }
): { html: string; selector: string; blockId: string; changed: boolean } {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  let target: CheerioSelection
  try {
    target = $(args.selector).first()
  } catch {
    throw new Error('无法锚定元素：selector 无效')
  }
  if (!target || target.length === 0) {
    throw new Error('无法锚定元素：页面内容可能已经变化')
  }
  assertAnchorableElement(target)
  const existingBlockId = (target.attr('data-block-id') || '').trim()
  if (existingBlockId) {
    const existingSelector = stableSelectorFor(args.pageId, existingBlockId)
    if ($(existingSelector).length === 1) {
      return {
        html,
        selector: existingSelector,
        blockId: existingBlockId,
        changed: false
      }
    }
  }
  const blockId = allocateBlockId()
  target.attr('data-block-id', blockId)
  return {
    html: $.html(),
    selector: stableSelectorFor(args.pageId, blockId),
    blockId,
    changed: true
  }
}

export function patchAddElement(
  html: string,
  parentSelector: string,
  htmlFragment: string,
  insertIndex: number
): string {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  const parent = $(parentSelector).first()
  if (!parent || parent.length === 0) {
    throw new Error('插入目标父元素不存在')
  }
  if (insertIndex < 0 || insertIndex >= parent.children().length) {
    parent.append(htmlFragment)
  } else {
    parent.children().eq(insertIndex).before(htmlFragment)
  }
  return $.html()
}

export function removeLegacyVideoAutoplayScript(html: string): string {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  $('#ppt-video-autoplay').remove()
  $('video').each((_, node) => {
    const video = $(node)
    video.attr('controls', '')
    video.attr('playsinline', '')
    if (video.attr('preload') === undefined) {
      video.attr('preload', 'metadata')
    }
  })
  return $.html()
}
