import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import * as cheerio from 'cheerio'
import { parse, type Chart, type Element, type Fill, type Slide } from 'pptxtojson/dist/index.js'
import { unzipSync, zipSync } from 'fflate'
import { buildPageScaffoldHtml, buildProjectIndexHtml, type DeckPageFile } from '../ipc/engine/template'
import { escapeHtml } from '../ipc/utils'
import { validatePersistedPageHtml } from '../tools/html-utils'
import { PptxTextValidator } from './pptx-text-validator'
import {
  normalizePptxShapeName,
  readPptxAnimationPlans,
  type ImportedElementAnimation,
  type SlideAnimationPlan
} from './pptx-animation-import'

const PAGE_WIDTH = 1600
const PAGE_HEIGHT = 900

type ImportWarning = {
  pageNumber?: number
  message: string
}

export type PptxImportProgressPayload = {
  sessionId?: string
  stage: 'reading' | 'parsing' | 'media' | 'pages' | 'index' | 'database' | 'completed'
  progress: number
  label: string
  pageNumber?: number
  totalPages?: number
}

type ImportProgress = (payload: PptxImportProgressPayload) => void

type ImageRegistry = {
  index: number
  byKey: Map<string, string>
}

type ChartSeries = {
  key?: string
  values?: Array<{ x?: string; y?: number }>
}

type MappedChartType = {
  type: string
  indexAxis?: 'x' | 'y'
  fill?: boolean
  showLine?: boolean
}

type ChartTypeMapping = {
  pattern: RegExp
  map: (chartType: string, barDir?: string) => MappedChartType
}

type ImportedTableBorder = {
  borderColor?: string
  borderWidth?: number
  borderType?: string
}

type ImportedTableCell = {
  text?: string
  rowSpan?: number
  colSpan?: number
  vMerge?: number
  hMerge?: number
  fillColor?: string
  fontColor?: string
  fontBold?: boolean
  vAlign?: string
  borders?: Partial<Record<TableBorderSide, ImportedTableBorder>>
}

type TableBorderSide = 'top' | 'right' | 'bottom' | 'left'

type FlattenedElement = {
  element: Element
  left: number
  top: number
  width: number
  height: number
  text: string
}

type TextImportAdjustment = {
  content: string
  extraCss: string[]
}

type SlideAnimationContext = {
  plan?: SlideAnimationPlan
  usedAnimationIds: Set<number>
}

export type ImportedPptxPage = {
  pageNumber: number
  pageId: string
  title: string
  htmlPath: string
  html: string
  contentOutline: string
}

export type ImportedPptxDeck = {
  title: string
  pageCount: number
  indexPath: string
  pages: ImportedPptxPage[]
  warnings: string[]
}

export type PptxChartRewriteRequest = {
  element: Chart
  blockId: string
  pageId: string
  chartIndex: number
  canvasId: string
  frameStyle: string
  animationAttrs: string
  pageNumber?: number
}

export type PptxChartRewriteResult = {
  config: Record<string, unknown>
  warnings?: string[]
}

export type PptxChartRewriteHandler = (
  request: PptxChartRewriteRequest
) => Promise<PptxChartRewriteResult | null>

const clampNumber = (value: unknown, fallback = 0): number => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const decodeUtf8 = (data: Uint8Array): string => new TextDecoder().decode(data)

const encodeUtf8 = (value: string): Uint8Array => new TextEncoder().encode(value)

const arrayBufferFromUint8Array = (data: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return copy.buffer
}

const collectPptxTableStyleIds = (tableStylesXml: string): Set<string> => {
  const ids = new Set<string>()
  const styleIdRe = /\bstyleId=(["'])(.*?)\1/g
  let match: RegExpExecArray | null
  while ((match = styleIdRe.exec(tableStylesXml)) !== null) {
    const id = match[2]?.trim()
    if (id) ids.add(id)
  }
  return ids
}

const tableStyleIdFromTblPr = (tblPrXml: string): string => {
  const match = tblPrXml.match(/<a:tableStyleId\b[^>]*>([\s\S]*?)<\/a:tableStyleId>/)
  return match?.[1]?.trim() || ''
}

const removeUnsupportedTableStyleFlags = (tblPrXml: string, knownStyleIds: Set<string>): {
  xml: string
  changed: boolean
} => {
  const styleId = tableStyleIdFromTblPr(tblPrXml)
  if (styleId && knownStyleIds.has(styleId)) return { xml: tblPrXml, changed: false }
  const nextXml = tblPrXml.replace(
    /\s(?:firstRow|firstCol|lastRow|lastCol|bandRow|bandCol)=("1"|'1')/g,
    ''
  )
  return { xml: nextXml, changed: nextXml !== tblPrXml }
}

const normalizePptxTableStyleFlags = (buffer: Buffer): {
  arrayBuffer: ArrayBuffer
  normalizedTableCount: number
} => {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(buffer))
  } catch {
    return {
      arrayBuffer: arrayBufferFromUint8Array(
        new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      ),
      normalizedTableCount: 0
    }
  }

  const tableStylesXml = files['ppt/tableStyles.xml'] ? decodeUtf8(files['ppt/tableStyles.xml']) : ''
  const knownStyleIds = collectPptxTableStyleIds(tableStylesXml)
  let normalizedTableCount = 0

  for (const name of Object.keys(files)) {
    if (!/^ppt\/slides\/slide\d+\.xml$/i.test(name)) continue
    const xml = decodeUtf8(files[name])
    if (!xml.includes('<a:tblPr')) continue
    const nextXml = xml.replace(
      /<a:tblPr\b[\s\S]*?<\/a:tblPr>|<a:tblPr\b[^>]*\/>/g,
      (tblPrXml) => {
        const result = removeUnsupportedTableStyleFlags(tblPrXml, knownStyleIds)
        if (result.changed) normalizedTableCount += 1
        return result.xml
      }
    )
    if (nextXml !== xml) files[name] = encodeUtf8(nextXml)
  }

  if (normalizedTableCount === 0) {
    return {
      arrayBuffer: arrayBufferFromUint8Array(
        new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      ),
      normalizedTableCount
    }
  }

  return {
    arrayBuffer: arrayBufferFromUint8Array(zipSync(files)),
    normalizedTableCount
  }
}

type ChartCachePoint = {
  idx: string
  value: string
}

const extractChartCachePoints = (
  xml: string,
  cacheTag: 'numCache' | 'strCache' | 'numLit' | 'strLit'
): ChartCachePoint[] => {
  const cacheMatch = xml.match(new RegExp(`<c:${cacheTag}\\b[\\s\\S]*?<\\/c:${cacheTag}>`))
  const cacheXml = cacheMatch?.[0] || ''
  const points: ChartCachePoint[] = []
  const pointRe =
    /<c:pt\b[^>]*\bidx=(["'])(.*?)\1[^>]*>\s*<c:v>([\s\S]*?)<\/c:v>\s*<\/c:pt>/g
  let match: RegExpExecArray | null
  while ((match = pointRe.exec(cacheXml)) !== null) {
    points.push({ idx: match[2] || String(points.length), value: match[3] || '' })
  }
  return points
}

const chartFormulaFromXml = (xml: string): string => {
  const match = xml.match(/<c:f>([\s\S]*?)<\/c:f>/)
  return match?.[1] || ''
}

const numericChartValue = (point: ChartCachePoint, usePointIndex: boolean): string => {
  if (usePointIndex) return String(clampNumber(point.idx, 0))
  const value = Number.parseFloat(point.value)
  return Number.isFinite(value) ? String(value) : String(clampNumber(point.idx, 0))
}

const buildChartNumCache = (points: ChartCachePoint[], usePointIndex: boolean): string => {
  const pointXml = points
    .map((point) => {
      const value = numericChartValue(point, usePointIndex)
      return `<c:pt idx="${point.idx}"><c:v>${value}</c:v></c:pt>`
    })
    .join('')
  return `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${points.length}"/>${pointXml}</c:numCache>`
}

const normalizeChartValueCacheXml = (xml: string): { xml: string; changed: boolean } => {
  if (/<c:numRef\b[\s\S]*?<c:numCache\b/.test(xml)) return { xml, changed: false }

  const numRefMatch = xml.match(/<c:numRef\b[\s\S]*?<\/c:numRef>/)
  if (numRefMatch) {
    const nextXml = xml.replace(/<\/c:numRef>/, `${buildChartNumCache([], false)}</c:numRef>`)
    return { xml: nextXml, changed: nextXml !== xml }
  }

  const numPoints = extractChartCachePoints(xml, 'numLit')
  if (numPoints.length > 0 || /<c:numLit\b/.test(xml)) {
    return {
      xml: `<c:numRef>${buildChartNumCache(numPoints, false)}</c:numRef>`,
      changed: true
    }
  }

  const strPoints = extractChartCachePoints(xml, 'strCache')
  if (strPoints.length > 0 || /<c:strRef\b/.test(xml)) {
    const formula = chartFormulaFromXml(xml)
    const formulaXml = formula ? `<c:f>${formula}</c:f>` : ''
    return {
      xml: `<c:numRef>${formulaXml}${buildChartNumCache(strPoints, true)}</c:numRef>`,
      changed: true
    }
  }

  const strLitPoints = extractChartCachePoints(xml, 'strLit')
  if (strLitPoints.length > 0 || /<c:strLit\b/.test(xml)) {
    return {
      xml: `<c:numRef>${buildChartNumCache(strLitPoints, true)}</c:numRef>`,
      changed: true
    }
  }

  return { xml, changed: false }
}

const normalizePptxChartValueCaches = (buffer: Buffer): {
  arrayBuffer: ArrayBuffer
  normalizedChartValueCount: number
} => {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(buffer))
  } catch {
    return {
      arrayBuffer: arrayBufferFromUint8Array(
        new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      ),
      normalizedChartValueCount: 0
    }
  }

  let normalizedChartValueCount = 0
  for (const name of Object.keys(files)) {
    if (!/^ppt\/charts\/chart\d+\.xml$/i.test(name)) continue
    const xml = decodeUtf8(files[name])
    if (!/<c:(?:xVal|yVal|bubbleSize)\b/.test(xml)) continue
    const nextXml = xml.replace(
      /<c:(xVal|yVal|bubbleSize)\b[^>]*>([\s\S]*?)<\/c:\1>/g,
      (valueXml, tagName: string, innerXml: string) => {
        const result = normalizeChartValueCacheXml(innerXml)
        if (result.changed) normalizedChartValueCount += 1
        return result.changed ? `<c:${tagName}>${result.xml}</c:${tagName}>` : valueXml
      }
    )
    if (nextXml !== xml) files[name] = encodeUtf8(nextXml)
  }

  if (normalizedChartValueCount === 0) {
    return {
      arrayBuffer: arrayBufferFromUint8Array(
        new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
      ),
      normalizedChartValueCount
    }
  }

  return {
    arrayBuffer: arrayBufferFromUint8Array(zipSync(files)),
    normalizedChartValueCount
  }
}

const stripHtml = (html: string): string => {
  if (!html) return ''
  const $ = cheerio.load(html, { scriptingEnabled: false })
  return $.root().text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

const flattenElements = (
  elements: Element[],
  offsetX = 0,
  offsetY = 0
): FlattenedElement[] => {
  const flattened: FlattenedElement[] = []
  for (const element of elements) {
    const record = element as unknown as Record<string, unknown>
    const left = offsetX + clampNumber(record.left)
    const top = offsetY + clampNumber(record.top)
    if (element.type === 'group') {
      flattened.push(
        ...flattenElements(
          Array.isArray(element.elements) ? element.elements : [],
          left,
          top
        )
      )
      continue
    }
    flattened.push({
      element,
      left,
      top,
      width: clampNumber(record.width),
      height: clampNumber(record.height),
      text: 'content' in element ? stripHtml(String(element.content || '')) : ''
    })
  }
  return flattened
}

const isLowValueTitleText = (text: string): boolean => {
  const normalized = text.toLowerCase()
  if (!normalized) return true
  if (/https?:\/\//i.test(text) || /www\./i.test(text)) return true
  if (normalized.includes('ppt模板') || normalized.includes('1ppt.com')) return true
  if (text.includes('单击此处输入') || text.includes('请输入')) return true
  if (normalized.includes('thank you for your attention')) return true
  return false
}

const hasCjkText = (text: string): boolean => /[\u3400-\u9fff]/.test(text)

const hasDeckTitleKeyword = (text: string): boolean =>
  /(总结|汇报|报告|计划|规划|方案|复盘|目录|概述|情况|不足|introduction|overview|summary|agenda|conclusion|plan|report|review)/i.test(text)

const ALLOWED_TEXT_TAGS = new Set([
  'p',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'br',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'sub',
  'sup'
])

const DANGEROUS_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'svg',
  'math',
  'canvas',
  'video',
  'audio',
  'img'
])

const ALLOWED_TEXT_STYLE_PROPS = new Set([
  'color',
  'background',
  'background-image',
  'background-color',
  'background-clip',
  '-webkit-background-clip',
  '-webkit-text-fill-color',
  'font-size',
  'font-weight',
  'font-style',
  'font-family',
  'text-decoration',
  'text-decoration-line',
  'text-align',
  'text-shadow',
  'line-height',
  'vertical-align',
  'letter-spacing'
])

const sanitizeCssValue = (property: string, rawValue: string, scale: number): string | null => {
  const value = rawValue.trim()
  if (!value) return null
  if (/url\s*\(|expression\s*\(|javascript:|data:/i.test(value)) return null
  const normalizedProperty = property.trim().toLowerCase()
  if (normalizedProperty === 'background' || normalizedProperty === 'background-image') {
    if (!/^(?:linear-gradient|radial-gradient)\s*\(/i.test(value)) return null
  }
  if (normalizedProperty === 'background-clip' || normalizedProperty === '-webkit-background-clip') {
    return /^(?:text|border-box|padding-box|content-box)$/i.test(value) ? value : null
  }
  if (property === 'font-size' || property === 'line-height') {
    const ptMatch = value.match(/^([0-9.]+)pt$/i)
    if (ptMatch) {
      const px = Math.max(8, clampNumber(ptMatch[1]) * scale)
      return `${px.toFixed(1)}px`
    }
  }
  if (normalizedProperty === 'font-family') {
    return /^[\p{L}\p{N}\s,.'"_-]+$/u.test(value) ? value : null
  }
  if (/^[#a-z0-9\s.,()%'"-]+$/i.test(value)) return value
  return null
}

const ensureVisibleTextStyle = (style: string): string => {
  if (!style) return ''
  const hasTransparentText =
    /(?:^|;)\s*color\s*:\s*transparent\s*(?:;|$)/i.test(style) ||
    /(?:^|;)\s*-webkit-text-fill-color\s*:\s*transparent\s*(?:;|$)/i.test(style)
  if (!hasTransparentText) return style

  const hasGradientBackground =
    /(?:^|;)\s*background(?:-image)?\s*:\s*(?:linear-gradient|radial-gradient)\s*\(/i.test(style)
  const hasTextClip =
    /(?:^|;)\s*(?:-webkit-)?background-clip\s*:\s*text\s*(?:;|$)/i.test(style)

  if (hasGradientBackground && hasTextClip) {
    return style.includes('-webkit-background-clip')
      ? style
      : `${style};-webkit-background-clip:text`
  }

  return style
    .replace(/((?:^|;)\s*color\s*:\s*)transparent(\s*(?:;|$))/gi, '$1#111827$2')
    .replace(
      /((?:^|;)\s*-webkit-text-fill-color\s*:\s*)transparent(\s*(?:;|$))/gi,
      '$1#111827$2'
    )
}

const sanitizeImportedCssColor = (rawValue: unknown): string | null => {
  if (typeof rawValue !== 'string') return null
  return sanitizeCssValue('color', rawValue, 1)
}

const sanitizeGradientStop = (rawColor: unknown, rawPosition: unknown): string | null => {
  const color = sanitizeImportedCssColor(rawColor)
  if (!color) return null
  const position = typeof rawPosition === 'string' || typeof rawPosition === 'number'
    ? String(rawPosition).trim()
    : ''
  if (!position) return color
  return /^[0-9.]+%?$/.test(position) ? `${color} ${position}` : color
}

const sanitizeStyleAttribute = (style: string, scale: number): string => {
  return ensureVisibleTextStyle(
    style
      .split(';')
      .map((part) => {
        const [propertyRaw, ...valueParts] = part.split(':')
        const property = propertyRaw?.trim().toLowerCase()
        const valueRaw = valueParts.join(':')
        if (!property || !ALLOWED_TEXT_STYLE_PROPS.has(property)) return ''
        const value = sanitizeCssValue(property, valueRaw, scale)
        return value ? `${property}:${value}` : ''
      })
      .filter(Boolean)
      .join(';')
  )
}

const sanitizeContentHtml = (html: string, scale: number): string => {
  if (!html) return ''
  const $ = cheerio.load(html, { scriptingEnabled: false }, false)
  $('*').each((_, node) => {
    const rawNode = node as unknown as { tagName?: string; attribs?: Record<string, string> }
    const element = $(node)
    const tagName = String(rawNode.tagName || '').toLowerCase()
    if (DANGEROUS_TAGS.has(tagName)) {
      element.remove()
      return
    }
    if (!ALLOWED_TEXT_TAGS.has(tagName)) {
      element.replaceWith(element.contents())
      return
    }
    for (const attribute of Object.keys(rawNode.attribs || {})) {
      const value = element.attr(attribute) || ''
      const name = attribute.toLowerCase()
      if (name.startsWith('on')) {
        element.removeAttr(attribute)
        continue
      }
      if (name !== 'style') {
        element.removeAttr(attribute)
        continue
      }
      const sanitizedStyle = sanitizeStyleAttribute(value, scale)
      if (sanitizedStyle) {
        element.attr('style', sanitizedStyle)
      } else {
        element.removeAttr('style')
      }
    }
  })
  return $.root().html() || ''
}

const sanitizeTableCellContentHtml = (html: string, scale: number): string => {
  const sanitized = sanitizeContentHtml(html, Math.min(scale, 1.25))
  return sanitized.replace(/\u00a0/g, '&nbsp;')
}

const parseCssPx = (style: string, property: string): number | null => {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = style.match(new RegExp(`${escaped}\\s*:\\s*([0-9.]+)px`, 'i'))
  if (!match) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

const parseCssValue = (style: string, property: string): string | null => {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = style.match(new RegExp(`${escaped}\\s*:\\s*([^;]+)`, 'i'))
  return match?.[1]?.trim() || null
}

const extractTextTypography = (
  content: string,
  element: Record<string, unknown>,
  textScale: number
): {
  fontSize: number
  lineHeight: number
  fontFamily: string
  fontWeight: string
  fontStyle: string
  letterSpacing: number
} => {
  const $ = cheerio.load(`<body>${content}</body>`, { scriptingEnabled: false })
  let style = ''
  $('*').each((_, node) => {
    const candidate = $(node).attr('style') || ''
    if (candidate && (!style || candidate.includes('font-size'))) style = candidate
  })
  const fontSize =
    parseCssPx(style, 'font-size') ||
    Math.max(10, clampNumber(element.fontSize || element.font_size || 18) * textScale)
  const lineHeight = parseCssPx(style, 'line-height') || fontSize * 1.18
  return {
    fontSize,
    lineHeight,
    fontFamily:
      parseCssValue(style, 'font-family') ||
      String(element.fontFace || element.fontFamily || element.font || 'Arial'),
    fontWeight:
      parseCssValue(style, 'font-weight') ||
      (element.fontBold || element.bold ? '700' : '400'),
    fontStyle: parseCssValue(style, 'font-style') || (element.fontItalic ? 'italic' : 'normal'),
    letterSpacing: parseCssPx(style, 'letter-spacing') || 0
  }
}

const scaleContentTypography = (content: string, ratio: number): string => {
  if (ratio >= 0.995) return content
  const $ = cheerio.load(`<body>${content}</body>`, { scriptingEnabled: false })
  $('*').each((_, node) => {
    const element = $(node)
    const style = element.attr('style') || ''
    if (!style) return
    const scaled = style
      .split(';')
      .map((part) => {
        const [propertyRaw, ...valueParts] = part.split(':')
        const property = propertyRaw?.trim()
        const value = valueParts.join(':').trim()
        if (!property || !value) return ''
        if (/^(font-size|line-height|letter-spacing)$/i.test(property)) {
          const pxMatch = value.match(/^([0-9.]+)px$/i)
          if (pxMatch) {
            return `${property}:${Math.max(0, Number(pxMatch[1]) * ratio).toFixed(1)}px`
          }
        }
        return `${property}:${value}`
      })
      .filter(Boolean)
      .join(';')
    if (scaled) element.attr('style', scaled)
  })
  return $('body').html() || content
}

const getRegistryKey = (key: string, dataUrl: string): string => {
  const stableKey = key.trim()
  if (stableKey && stableKey.length < 512 && !stableKey.startsWith('data:')) return `ref:${stableKey}`
  return `sha256:${crypto.createHash('sha256').update(stableKey || dataUrl).digest('hex')}`
}

const getDataUrlInfo = (dataUrl: string): { mimeType: string; extension: string; data: string } => {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match) return { mimeType: 'application/octet-stream', extension: '.bin', data: dataUrl }
  const mimeType = match[1]
  const extension =
    mimeType === 'image/png'
      ? '.png'
      : mimeType === 'image/jpeg'
        ? '.jpg'
        : mimeType === 'image/webp'
          ? '.webp'
          : mimeType === 'image/gif'
            ? '.gif'
            : mimeType === 'image/svg+xml'
              ? '.svg'
              : '.bin'
  return { mimeType, extension, data: match[2] }
}

const writeImageDataUrl = async (
  imagesDir: string,
  registry: ImageRegistry,
  key: string,
  dataUrl: string
): Promise<string | null> => {
  if (!dataUrl) return null
  const registryKey = getRegistryKey(key, dataUrl)
  const existing = registry.byKey.get(registryKey)
  if (existing) return existing
  const info = getDataUrlInfo(dataUrl)
  if (!info.data || info.extension === '.bin') return null
  registry.index += 1
  const fileName = `imported-${String(registry.index).padStart(4, '0')}${info.extension}`
  const targetPath = path.join(imagesDir, fileName)
  await fs.promises.writeFile(targetPath, Buffer.from(info.data, 'base64'))
  const relativePath = `./images/${fileName}`
  registry.byKey.set(registryKey, relativePath)
  return relativePath
}

const fillToCss = async (
  fill: Fill | undefined,
  imagesDir: string,
  registry: ImageRegistry
): Promise<string[]> => {
  if (!fill) return []
  if (fill.type === 'color' && fill.value) {
    const color = sanitizeImportedCssColor(fill.value)
    return color ? [`background:${color}`] : []
  }
  if (fill.type === 'image' && fill.value?.base64) {
    const imagePath = await writeImageDataUrl(
      imagesDir,
      registry,
      fill.value.ref || fill.value.base64,
      fill.value.base64
    )
    if (imagePath) {
      return [
        `background-image:url('${imagePath}')`,
        'background-size:cover',
        'background-position:center'
      ]
    }
  }
  if (fill.type === 'gradient' && Array.isArray(fill.value?.colors) && fill.value.colors.length) {
    const colors = fill.value.colors
      .map((item) => sanitizeGradientStop(item.color, item.pos))
      .filter((item): item is string => Boolean(item))
    return colors.length ? [`background:linear-gradient(135deg, ${colors.join(', ')})`] : []
  }
  return []
}

const buildBlockStyle = (args: {
  element: Record<string, unknown>
  scaleX: number
  scaleY: number
  zIndex: number
  offsetX?: number
  offsetY?: number
  overflow?: 'hidden' | 'visible'
  extra?: string[]
}): string => {
  const x = (clampNumber(args.element.left) + clampNumber(args.offsetX)) * args.scaleX
  const y = (clampNumber(args.element.top) + clampNumber(args.offsetY)) * args.scaleY
  const width = Math.max(1, clampNumber(args.element.width) * args.scaleX)
  const height = Math.max(1, clampNumber(args.element.height) * args.scaleY)
  const rotate = clampNumber(args.element.rotate)
  const styles = [
    'position:absolute',
    `left:${x.toFixed(1)}px`,
    `top:${y.toFixed(1)}px`,
    `width:${width.toFixed(1)}px`,
    `height:${height.toFixed(1)}px`,
    `z-index:${args.zIndex}`,
    `overflow:${args.overflow || 'visible'}`,
    rotate ? `transform:rotate(${rotate.toFixed(2)}deg)` : ''
  ]
  return [...styles, ...(args.extra || [])].filter(Boolean).join(';')
}

const borderCss = (element: Record<string, unknown>, scale: number): string[] => {
  const width = clampNumber(element.borderWidth)
  if (width <= 0) return []
  const color = sanitizeImportedCssColor(element.borderColor) || '#d1d5db'
  const rawType = typeof element.borderType === 'string' ? element.borderType.trim().toLowerCase() : ''
  const type = ['solid', 'dashed', 'dotted', 'double'].includes(rawType) ? rawType : 'solid'
  return [`border:${Math.max(1, width * scale).toFixed(1)}px ${type} ${color}`]
}

const normalizeBorderType = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (['solid', 'dashed', 'dotted', 'double'].includes(raw)) return raw
  return 'solid'
}

const tableBorderDeclaration = (
  side: TableBorderSide,
  border: ImportedTableBorder | undefined,
  scale: number
): string | null => {
  if (!border) return null
  const width = clampNumber(border.borderWidth)
  if (width <= 0) return null
  const color = sanitizeImportedCssColor(border.borderColor) || '#d1d5db'
  const type = normalizeBorderType(border.borderType)
  return `border-${side}:${Math.max(0.5, width * scale).toFixed(1)}px ${type} ${color}`
}

const tableBorderDeclarations = (
  cellBorders: Partial<Record<TableBorderSide, ImportedTableBorder>> | undefined,
  fallbackBorders: Partial<Record<TableBorderSide, ImportedTableBorder>> | undefined,
  scale: number
): string[] => {
  const declarations = (['top', 'right', 'bottom', 'left'] as TableBorderSide[])
    .map((side) => tableBorderDeclaration(side, cellBorders?.[side] || fallbackBorders?.[side], scale))
    .filter((item): item is string => Boolean(item))
  return declarations.length > 0 ? declarations : ['border:1px solid #d1d5db']
}

const spanAttr = (name: 'colspan' | 'rowspan', value: unknown): string => {
  const span = Math.floor(clampNumber(value, 1))
  return span > 1 ? ` ${name}="${span}"` : ''
}

const spanSize = (value: unknown): number => Math.max(1, Math.floor(clampNumber(value, 1)))

const isMergedTableContinuation = (cell: ImportedTableCell): boolean =>
  clampNumber(cell.hMerge) > 0 || clampNumber(cell.vMerge) > 0

const tableVerticalAlign = (value: unknown): string => {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'mid' || raw === 'middle' || raw === 'center' || raw === 'ctr') return 'middle'
  if (raw === 'down' || raw === 'bottom' || raw === 'b') return 'bottom'
  return 'top'
}

const resolveSlideFit = (size: { width: number; height: number }): {
  scale: number
  offsetX: number
  offsetY: number
} => {
  const sourceWidth = Math.max(1, size.width)
  const sourceHeight = Math.max(1, size.height)
  const scale = Math.min(PAGE_WIDTH / sourceWidth, PAGE_HEIGHT / sourceHeight)
  return {
    scale,
    offsetX: Math.max(0, (PAGE_WIDTH - sourceWidth * scale) / 2),
    offsetY: Math.max(0, (PAGE_HEIGHT - sourceHeight * scale) / 2)
  }
}

const overlapArea = (
  left: { x: number; y: number; w: number; h: number },
  right: { x: number; y: number; w: number; h: number }
): number => {
  const x = Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x))
  const y = Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y))
  return x * y
}

const centerInside = (
  inner: { x: number; y: number; w: number; h: number },
  outer: { x: number; y: number; w: number; h: number }
): boolean => {
  const cx = inner.x + inner.w / 2
  const cy = inner.y + inner.h / 2
  return cx >= outer.x && cx <= outer.x + outer.w && cy >= outer.y && cy <= outer.y + outer.h
}

const resolveElementAnimation = (
  context: SlideAnimationContext | undefined,
  element: Record<string, unknown>,
  offsetX: number,
  offsetY: number
): ImportedElementAnimation | undefined => {
  const plan = context?.plan
  if (!plan || plan.animations.length === 0) return undefined
  const name = normalizePptxShapeName(element.name)
  if (name) {
    const byName = plan.byName.get(name)
    const match = byName?.find((animation) => !context.usedAnimationIds.has(animation.id))
    if (match) {
      context.usedAnimationIds.add(match.id)
      return match
    }
  }

  const box = {
    x: clampNumber(element.left) + offsetX,
    y: clampNumber(element.top) + offsetY,
    w: Math.max(1, clampNumber(element.width)),
    h: Math.max(1, clampNumber(element.height))
  }
  const boxArea = Math.max(0.0001, box.w * box.h)
  const candidates = plan.animations
    .filter(
      (animation) =>
        !context.usedAnimationIds.has(animation.id) &&
        animation.x !== undefined &&
        animation.y !== undefined &&
        animation.w !== undefined &&
        animation.h !== undefined
    )
    .map((animation) => {
      const animBox = {
        x: animation.x || 0,
        y: animation.y || 0,
        w: Math.max(1, animation.w || 1),
        h: Math.max(1, animation.h || 1)
      }
      const overlap = overlapArea(box, animBox)
      const animArea = Math.max(0.0001, animBox.w * animBox.h)
      const eligible =
        overlap > 0 &&
        (centerInside(box, animBox) || overlap / boxArea >= 0.45 || overlap / animArea >= 0.25)
      return { animation, overlap, eligible }
    })
    .filter((candidate) => candidate.eligible)
    .sort((a, b) => b.overlap - a.overlap || a.animation.id - b.animation.id)
  const match = candidates[0]?.animation
  if (match) context.usedAnimationIds.add(match.id)
  return match
}

const buildAnimationAttrs = (animation: ImportedElementAnimation | undefined): string => {
  if (!animation) return ''
  return [
    `data-anim="${animation.type}"`,
    animation.from ? `data-anim-from="${animation.from}"` : '',
    `data-anim-duration="${animation.duration}"`,
    `data-anim-delay="${animation.delay}"`,
    animation.trigger === 'click' ? 'data-anim-trigger="click"' : '',
    `data-pptx-source-spid="${escapeHtml(animation.sourceId)}"`
  ]
    .filter(Boolean)
    .join(' ')
}

const adjustTextBlockWithPretext = async (args: {
  validator?: PptxTextValidator
  element: Record<string, unknown>
  blockId: string
  content: string
  text: string
  scaleX: number
  scaleY: number
  textScale: number
  offsetX: number
  offsetY: number
  pageNumber?: number
  warnings?: ImportWarning[]
}): Promise<TextImportAdjustment> => {
  if (!args.validator || args.text.length < 2) {
    return { content: args.content, extraCss: [] }
  }
  const y = (clampNumber(args.element.top) + clampNumber(args.offsetY)) * args.scaleY
  const width = Math.max(1, clampNumber(args.element.width) * args.scaleX)
  const height = Math.max(1, clampNumber(args.element.height) * args.scaleY)
  const typography = extractTextTypography(args.content, args.element, args.textScale)
  const [result] = await args.validator.measure([
    {
      id: args.blockId,
      text: args.text,
      width,
      height,
      ...typography
    }
  ])
  if (!result || (!result.overflow && result.suggestedFontSize >= typography.fontSize - 0.5)) {
    return {
      content: args.content,
      extraCss: [
        `font-size:${typography.fontSize.toFixed(1)}px`,
        `line-height:${typography.lineHeight.toFixed(1)}px`
      ]
    }
  }

  const fontRatio = Math.min(1, result.suggestedFontSize / typography.fontSize)
  const maxHeight = Math.max(1, PAGE_HEIGHT - y - 2)
  const nextHeight = Math.min(maxHeight, Math.max(height, result.suggestedHeight))
  const extraCss = [
    `font-size:${result.suggestedFontSize.toFixed(1)}px`,
    `line-height:${result.suggestedLineHeight.toFixed(1)}px`
  ]
  if (nextHeight > height + 1) {
    extraCss.push(`height:${nextHeight.toFixed(1)}px`)
  }
  args.warnings?.push({
    pageNumber: args.pageNumber,
    message: `文本块 ${args.blockId} 已按 Pretext 测量调整排版`
  })

  return {
    content: scaleContentTypography(args.content, fontRatio),
    extraCss
  }
}

const titleFromSlide = (slide: Slide, pageNumber: number): string => {
  const candidates = flattenElements([...(slide.layoutElements || []), ...(slide.elements || [])])
    .filter((item) => (item.element.type === 'text' || item.element.type === 'shape') && item.text.length > 0)
    .map((item) => {
      const area = item.width * item.height
      const textLength = Array.from(item.text).length
      const isShortFragment = textLength <= 1
      const isPrimaryBand = item.top < 180
      const score =
        area +
        (isPrimaryBand ? 8000 : 0) +
        (hasCjkText(item.text) ? 5000 : 0) +
        (hasDeckTitleKeyword(item.text) ? 28000 : 0) +
        (textLength >= 2 && textLength <= 28 ? 6000 : 0) -
        (isShortFragment ? 16000 : 0) -
        (isLowValueTitleText(item.text) ? 50000 : 0)
      return { ...item, area, score }
    })
    .sort((a, b) => b.score - a.score || a.top - b.top)
  const title = candidates.find((item) => !isLowValueTitleText(item.text))?.text || candidates[0]?.text
  return title?.slice(0, 80) || `第 ${pageNumber} 页`
}

const buildTextBlock = async (args: {
  element: Record<string, unknown>
  blockId: string
  role?: string
  animation?: ImportedElementAnimation
  imagesDir: string
  registry: ImageRegistry
  scaleX: number
  scaleY: number
  textScale: number
  zIndex: number
  offsetX: number
  offsetY: number
  pageNumber?: number
  warnings?: ImportWarning[]
  textValidator?: PptxTextValidator
}): Promise<string> => {
  const fillCss = await fillToCss(args.element.fill as Fill | undefined, args.imagesDir, args.registry)
  const rawContent = String(args.element.content || '')
  const text = stripHtml(rawContent)
  const sanitizedContent = sanitizeContentHtml(rawContent, args.textScale)
  const adjustment = await adjustTextBlockWithPretext({
    validator: args.textValidator,
    element: args.element,
    blockId: args.blockId,
    content: sanitizedContent,
    text,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    textScale: args.textScale,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    pageNumber: args.pageNumber,
    warnings: args.warnings
  })
  const css = buildBlockStyle({
    element: args.element,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    zIndex: args.zIndex,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    extra: [...fillCss, ...borderCss(args.element, args.textScale), 'padding:0.1px', ...adjustment.extraCss]
  })
  const roleAttr = args.role ? ` data-role="${escapeHtml(args.role)}"` : ''
  const animationAttrs = buildAnimationAttrs(args.animation)
  const animationAttrText = animationAttrs ? ` ${animationAttrs}` : ''
  return `<section data-block-id="${escapeHtml(args.blockId)}"${roleAttr}${animationAttrText} style="${css}">${adjustment.content || '&nbsp;'}</section>`
}

const buildImageBlock = async (args: {
  element: Record<string, unknown>
  blockId: string
  animation?: ImportedElementAnimation
  imagesDir: string
  registry: ImageRegistry
  scaleX: number
  scaleY: number
  zIndex: number
  offsetX: number
  offsetY: number
}): Promise<string> => {
  const source = await writeImageDataUrl(
    args.imagesDir,
    args.registry,
    String(args.element.ref || args.element.base64 || args.blockId),
    String(args.element.base64 || '')
  )
  const css = buildBlockStyle({
    element: args.element,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    zIndex: args.zIndex,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    overflow: 'hidden',
    extra: [...borderCss(args.element, Math.min(args.scaleX, args.scaleY)), 'display:flex']
  })
  const animationAttrs = buildAnimationAttrs(args.animation)
  const animationAttrText = animationAttrs ? ` ${animationAttrs}` : ''
  if (!source) {
    return `<section data-block-id="${escapeHtml(args.blockId)}"${animationAttrText} style="${css};align-items:center;justify-content:center;background:#f3f4f6;color:#6b7280;font-size:18px;">图片未能导入</section>`
  }
  return `<figure data-block-id="${escapeHtml(args.blockId)}"${animationAttrText} style="${css}"><img src="${source}" alt="" style="width:100%;height:100%;object-fit:contain;display:block;" /></figure>`
}

const buildShapeBlock = async (args: {
  element: Record<string, unknown>
  blockId: string
  role?: string
  animation?: ImportedElementAnimation
  imagesDir: string
  registry: ImageRegistry
  scaleX: number
  scaleY: number
  textScale: number
  zIndex: number
  offsetX: number
  offsetY: number
  pageNumber?: number
  warnings?: ImportWarning[]
  textValidator?: PptxTextValidator
}): Promise<string> => {
  if (typeof args.element.content === 'string' && stripHtml(args.element.content).length > 0) {
    return buildTextBlock(args)
  }
  const fillCss = await fillToCss(args.element.fill as Fill | undefined, args.imagesDir, args.registry)
  const css = buildBlockStyle({
    element: args.element,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    zIndex: args.zIndex,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    overflow: 'hidden',
    extra: [...fillCss, ...borderCss(args.element, args.textScale)]
  })
  const animationAttrs = buildAnimationAttrs(args.animation)
  const animationAttrText = animationAttrs ? ` ${animationAttrs}` : ''
  return `<div data-block-id="${escapeHtml(args.blockId)}"${animationAttrText} style="${css}"></div>`
}

const buildTableBlock = (args: {
  element: Record<string, unknown>
  blockId: string
  animation?: ImportedElementAnimation
  scaleX: number
  scaleY: number
  textScale: number
  zIndex: number
  offsetX: number
  offsetY: number
}): string => {
  const rows = Array.isArray(args.element.data) ? (args.element.data as ImportedTableCell[][]) : []
  const tableTextScale = Math.min(args.textScale, 1.25)
  const tableBorders = args.element.borders as Partial<Record<TableBorderSide, ImportedTableBorder>> | undefined
  const colWidths = Array.isArray(args.element.colWidths)
    ? (args.element.colWidths as unknown[])
        .map((width) => clampNumber(width) * args.scaleX)
        .filter((width) => width > 0)
    : []
  const rowHeights = Array.isArray(args.element.rowHeights)
    ? (args.element.rowHeights as unknown[]).map((height) => clampNumber(height) * args.scaleY)
    : []
  const colgroup = colWidths.length
    ? `<colgroup>${colWidths
        .map((width) => `<col style="width:${width.toFixed(1)}px;" />`)
        .join('')}</colgroup>`
    : ''
  const tableRows = rows
    .map((row, rowIndex) => {
      let logicalColIndex = 0
      const rowHeight = rowHeights[rowIndex] && rowHeights[rowIndex] > 0
        ? ` style="height:${rowHeights[rowIndex].toFixed(1)}px;"`
        : ''
      const cells = row
        .map((cell) => {
          if (isMergedTableContinuation(cell)) {
            logicalColIndex += 1
            return ''
          }
          const colIndex = logicalColIndex
          logicalColIndex += spanSize(cell.colSpan)
          const styles = [
            ...tableBorderDeclarations(cell.borders, tableBorders, args.textScale),
            'padding:6px 8px',
            'overflow-wrap:anywhere',
            'white-space:pre-wrap',
            `vertical-align:${tableVerticalAlign(cell.vAlign)}`,
            sanitizeImportedCssColor(cell.fillColor) ? `background:${sanitizeImportedCssColor(cell.fillColor)}` : '',
            sanitizeImportedCssColor(cell.fontColor) ? `color:${sanitizeImportedCssColor(cell.fontColor)}` : '',
            cell.fontBold ? 'font-weight:700' : '',
            rowHeights[rowIndex] && rowHeights[rowIndex] > 0
              ? `height:${rowHeights[rowIndex].toFixed(1)}px`
              : ''
          ]
            .filter(Boolean)
            .join(';')
          const colspan = spanAttr('colspan', cell.colSpan)
          const rowspan = spanAttr('rowspan', cell.rowSpan)
          const content = sanitizeTableCellContentHtml(String(cell.text || ''), args.textScale)
          return `<td data-cell-id="r${rowIndex + 1}-c${colIndex + 1}"${colspan}${rowspan} style="${styles}">${content || '&nbsp;'}</td>`
        })
        .join('')
      return `<tr${rowHeight}>${cells}</tr>`
    })
    .join('')
  const css = buildBlockStyle({
    element: args.element,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    zIndex: args.zIndex,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    extra: ['background:#fff']
  })
  const animationAttrs = buildAnimationAttrs(args.animation)
  const animationAttrText = animationAttrs ? ` ${animationAttrs}` : ''
  if (!rows.length) {
    return `<section data-block-id="${escapeHtml(args.blockId)}" data-pptx-kind="table" data-pptx-import-mode="placeholder"${animationAttrText} style="${css};display:flex;align-items:center;justify-content:center;color:#6b7280;">表格已作为占位导入</section>`
  }
  return `<section data-block-id="${escapeHtml(args.blockId)}" data-pptx-kind="table" data-pptx-import-mode="editable"${animationAttrText} style="${css}"><table style="width:100%;height:100%;border-collapse:collapse;border-spacing:0;table-layout:fixed;font-size:${Math.max(12, 12 * tableTextScale).toFixed(1)}px;">${colgroup}${tableRows}</table></section>`
}

const PPTX_CHART_TYPE_MAPPINGS: ChartTypeMapping[] = [
  { pattern: /bubble/i, map: () => ({ type: 'bubble' }) },
  { pattern: /scatter/i, map: () => ({ type: 'scatter', showLine: true }) },
  { pattern: /doughnut/i, map: () => ({ type: 'doughnut' }) },
  { pattern: /pie/i, map: () => ({ type: 'pie' }) },
  { pattern: /area/i, map: () => ({ type: 'line', fill: true }) },
  { pattern: /line/i, map: () => ({ type: 'line' }) },
  { pattern: /radar/i, map: () => ({ type: 'radar' }) },
  {
    pattern: /bar/i,
    map: (_chartType, barDir) => ({
      type: 'bar',
      // pptxtojson uses barDir="bar" for horizontal bars and "col" for vertical columns.
      indexAxis: barDir === 'bar' ? 'y' : 'x'
    })
  }
]

const mapChartType = (chartType: string, barDir?: string): MappedChartType | null => {
  const mapping = PPTX_CHART_TYPE_MAPPINGS.find((item) => item.pattern.test(chartType))
  return mapping ? mapping.map(chartType, barDir) : null
}

const isNumericArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => Number.isFinite(Number(item)))

const chartCanvasId = (pageId: string, chartIndex: number): string => `chart-${pageId}-${chartIndex}`

const unsupportedChartWarning = (blockId: string, chartType: string): string =>
  `图表 ${blockId}（${chartType || 'unknown'}）暂不支持结构化导入，已作为占位导入`

const buildChartFrameStyle = (args: {
  element: Chart
  scaleX: number
  scaleY: number
  zIndex: number
  offsetX: number
  offsetY: number
}): string =>
  buildBlockStyle({
    element: args.element as unknown as Record<string, unknown>,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    zIndex: args.zIndex,
    offsetX: args.offsetX,
    offsetY: args.offsetY,
    overflow: 'hidden',
    extra: ['background:#fff']
  })

const buildChartHtmlFromConfig = (args: {
  element: Chart
  blockId: string
  canvasId: string
  frameStyle: string
  animationAttrText: string
  config: Record<string, unknown>
}): string => `<section data-block-id="${escapeHtml(args.blockId)}" data-pptx-kind="chart" data-pptx-import-mode="editable" data-pptx-chart-type="${escapeHtml(args.element.chartType)}" class="ppt-chart-frame"${args.animationAttrText} style="${args.frameStyle}">
  <canvas id="${args.canvasId}" class="h-full w-full"></canvas>
</section>
<script>
window.addEventListener("DOMContentLoaded", function () {
  var el = document.getElementById("${args.canvasId}");
  if (!el || !window.PPT || !window.PPT.createChart) return;
  window.PPT.createChart(el, ${JSON.stringify(args.config).replace(/</g, '\\u003c')});
});
</script>`

const buildChartPlaceholderHtml = (args: {
  element: Chart
  blockId: string
  frameStyle: string
  animationAttrText: string
}): string =>
  `<section data-block-id="${escapeHtml(args.blockId)}" data-pptx-kind="chart" data-pptx-import-mode="placeholder" data-pptx-chart-type="${escapeHtml(args.element.chartType || 'unknown')}"${args.animationAttrText} style="${args.frameStyle};display:flex;align-items:center;justify-content:center;color:#6b7280;">图表已作为占位导入</section>`

const buildChartBlock = (args: {
  element: Chart
  blockId: string
  animation?: ImportedElementAnimation
  pageId: string
  chartIndex: number
  scaleX: number
  scaleY: number
  zIndex: number
  offsetX: number
  offsetY: number
  pageNumber?: number
  warnings?: ImportWarning[]
  suppressUnsupportedWarning?: boolean
}): string => {
  const chartType = mapChartType(args.element.chartType, 'barDir' in args.element ? args.element.barDir : undefined)
  const canvasId = chartCanvasId(args.pageId, args.chartIndex)
  const animationAttrs = buildAnimationAttrs(args.animation)
  const animationAttrText = animationAttrs ? ` ${animationAttrs}` : ''
  const frameStyle = buildChartFrameStyle({
    element: args.element,
    scaleX: args.scaleX,
    scaleY: args.scaleY,
    zIndex: args.zIndex,
    offsetX: args.offsetX,
    offsetY: args.offsetY
  })
  const data = 'data' in args.element ? args.element.data : null
  const isCommonSeries = Array.isArray(data) && data.length > 0 && data.every((item) => {
    const record = item as Partial<ChartSeries> | undefined
    return Boolean(record && !Array.isArray(record) && Array.isArray(record.values))
  })
  const isPairedNumericSeries =
    Array.isArray(data) && data.length >= 2 && isNumericArray(data[0]) && isNumericArray(data[1])
  if (!chartType || (!isCommonSeries && !isPairedNumericSeries)) {
    if (!args.suppressUnsupportedWarning) {
      args.warnings?.push({
        pageNumber: args.pageNumber,
        message: unsupportedChartWarning(args.blockId, args.element.chartType)
      })
    }
    return buildChartPlaceholderHtml({
      element: args.element,
      blockId: args.blockId,
      frameStyle,
      animationAttrText
    })
  }
  if (/3DChart/i.test(args.element.chartType)) {
    args.warnings?.push({
      pageNumber: args.pageNumber,
      message: `图表 ${args.blockId} 的 3D 效果已简化为二维图表`
    })
  }
  let labels: string[] = []
  let datasets: Array<Record<string, unknown>> = []
  let legendDisplay = false
  if (isPairedNumericSeries) {
    const xValues = (data[0] as number[]).map((value) => clampNumber(value))
    const yValues = (data[1] as number[]).map((value) => clampNumber(value))
    const radiusValues = isNumericArray(data[2]) ? data[2].map((value) => clampNumber(value, 6)) : []
    labels = xValues.map((value) => String(value))
    datasets = [
      {
        label: 'Series 1',
        data: xValues.map((x, index) => {
          const y = yValues[index] ?? 0
          if (chartType.type !== 'bubble') return { x, y }
          return { x, y, r: Math.max(3, Math.min(40, Math.abs(radiusValues[index] ?? 6))) }
        }),
        borderColor: args.element.colors?.[0] || undefined,
        backgroundColor: args.element.colors?.[0] || undefined,
        showLine: chartType.showLine || undefined,
        tension: chartType.showLine ? 0.25 : undefined
      }
    ]
  } else {
    const series = data as ChartSeries[]
    labels = series[0]?.values?.map((item) => item.x ?? '') || []
    const isSingleDatasetChart = chartType.type === 'pie' || chartType.type === 'doughnut'
    legendDisplay = series.length > 1 || isSingleDatasetChart
    datasets = isSingleDatasetChart
      ? [
          {
            label: series[0]?.key || 'Series 1',
            data: (series[0]?.values || []).map((value) => value.y ?? 0),
            backgroundColor: args.element.colors?.length ? args.element.colors : undefined,
            borderColor: '#ffffff',
            borderWidth: 1
          }
        ]
      : series.map((item, index) => ({
          label: item.key || `Series ${index + 1}`,
          data: (item.values || []).map((value) => value.y ?? 0),
          borderColor: args.element.colors?.[index] || undefined,
          backgroundColor: args.element.colors?.[index] || undefined,
          fill: chartType.fill || false,
          tension: chartType.type === 'line' ? 0.25 : undefined
        }))
  }
  const config = {
    type: chartType.type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: chartType.indexAxis || 'x',
      scales: isPairedNumericSeries ? { x: { type: 'linear' } } : undefined,
      plugins: { legend: { display: legendDisplay } }
    }
  }
  return buildChartHtmlFromConfig({
    element: args.element,
    blockId: args.blockId,
    canvasId,
    frameStyle,
    animationAttrText,
    config
  })
}

export const __pptxImporterTestUtils = {
  buildTableBlock,
  buildChartBlock,
  collectPptxTableStyleIds,
  normalizeChartValueCacheXml,
  normalizePptxChartValueCaches,
  removeUnsupportedTableStyleFlags,
  resolveSlideFit
}

const renderElement = async (args: {
  element: Element
  pageId: string
  blockCounters: Record<string, number>
  animationContext?: SlideAnimationContext
  inheritedAnimation?: ImportedElementAnimation
  imagesDir: string
  registry: ImageRegistry
  scaleX: number
  scaleY: number
  textScale: number
  zIndex: number
  offsetX: number
  offsetY: number
  titleAssigned: boolean
  pageNumber?: number
  warnings?: ImportWarning[]
  textValidator?: PptxTextValidator
  chartRewrite?: PptxChartRewriteHandler
}): Promise<{ html: string; titleAssigned: boolean }> => {
  const nextBlockId = (prefix: string): string => {
    args.blockCounters[prefix] = (args.blockCounters[prefix] || 0) + 1
    return `${prefix}-${args.blockCounters[prefix]}`
  }
  const record = args.element as unknown as Record<string, unknown>
  const elementAnimation =
    resolveElementAnimation(args.animationContext, record, args.offsetX, args.offsetY) ||
    args.inheritedAnimation
  if (args.element.type === 'group') {
    const children = Array.isArray(args.element.elements)
      ? [...args.element.elements].sort(
          (a, b) =>
            clampNumber((a as unknown as Record<string, unknown>).order) -
            clampNumber((b as unknown as Record<string, unknown>).order)
        )
      : []
    const rendered: string[] = []
    let titleAssigned = args.titleAssigned
    const groupOffsetX = args.offsetX + clampNumber(record.left)
    const groupOffsetY = args.offsetY + clampNumber(record.top)
    for (const child of children) {
      const result = await renderElement({
        ...args,
        element: child,
        offsetX: groupOffsetX,
        offsetY: groupOffsetY,
        inheritedAnimation: elementAnimation,
        titleAssigned
      })
      rendered.push(result.html)
      titleAssigned = result.titleAssigned
    }
    return { html: rendered.join('\n'), titleAssigned }
  }
  if (args.element.type === 'image') {
    return {
      html: await buildImageBlock({
        element: record,
        blockId: nextBlockId('image'),
        animation: elementAnimation,
        imagesDir: args.imagesDir,
        registry: args.registry,
        scaleX: args.scaleX,
        scaleY: args.scaleY,
        offsetX: args.offsetX,
        offsetY: args.offsetY,
        zIndex: args.zIndex
      }),
      titleAssigned: args.titleAssigned
    }
  }
  if (args.element.type === 'table') {
    return {
      html: buildTableBlock({
        element: record,
        blockId: nextBlockId('table'),
        animation: elementAnimation,
        scaleX: args.scaleX,
        scaleY: args.scaleY,
        textScale: args.textScale,
        offsetX: args.offsetX,
        offsetY: args.offsetY,
        zIndex: args.zIndex
      }),
      titleAssigned: args.titleAssigned
    }
  }
  if (args.element.type === 'chart') {
    const chartIndex = (args.blockCounters.chart || 0) + 1
    args.blockCounters.chart = chartIndex
    const blockId = `chart-${chartIndex}`
    const canvasId = chartCanvasId(args.pageId, chartIndex)
    const animationAttrs = buildAnimationAttrs(elementAnimation)
    const animationAttrText = animationAttrs ? ` ${animationAttrs}` : ''
    const frameStyle = buildChartFrameStyle({
      element: args.element,
      scaleX: args.scaleX,
      scaleY: args.scaleY,
      zIndex: args.zIndex,
      offsetX: args.offsetX,
      offsetY: args.offsetY
    })
    let html = buildChartBlock({
      element: args.element,
      blockId,
      animation: elementAnimation,
      pageId: args.pageId,
      chartIndex,
      scaleX: args.scaleX,
      scaleY: args.scaleY,
      offsetX: args.offsetX,
      offsetY: args.offsetY,
      zIndex: args.zIndex,
      pageNumber: args.pageNumber,
      warnings: args.warnings,
      suppressUnsupportedWarning: true
    })
    if (html.includes('data-pptx-import-mode="placeholder"') && args.chartRewrite) {
      const rewritten = await args.chartRewrite({
        element: args.element,
        blockId,
        pageId: args.pageId,
        chartIndex,
        canvasId,
        frameStyle,
        animationAttrs,
        pageNumber: args.pageNumber
      })
      if (rewritten?.config) {
        html = buildChartHtmlFromConfig({
          element: args.element,
          blockId,
          canvasId,
          frameStyle,
          animationAttrText,
          config: rewritten.config
        })
        if (rewritten.warnings?.length) {
          args.warnings?.push(
            ...rewritten.warnings.map((message) => ({ pageNumber: args.pageNumber, message }))
          )
        }
      }
    }
    if (html.includes('data-pptx-import-mode="placeholder"')) {
      args.warnings?.push({
        pageNumber: args.pageNumber,
        message: unsupportedChartWarning(blockId, args.element.chartType)
      })
    }
    return {
      html,
      titleAssigned: args.titleAssigned
    }
  }
  if (args.element.type === 'text') {
    const text = stripHtml(String(record.content || ''))
    const shouldBeTitle = !args.titleAssigned && text.length > 0 && clampNumber(record.top) < 120
    return {
      html: await buildTextBlock({
        element: record,
        blockId: shouldBeTitle ? 'title' : nextBlockId('text'),
        role: shouldBeTitle ? 'title' : undefined,
        animation: elementAnimation,
        imagesDir: args.imagesDir,
        registry: args.registry,
        scaleX: args.scaleX,
        scaleY: args.scaleY,
        textScale: args.textScale,
        offsetX: args.offsetX,
        offsetY: args.offsetY,
        zIndex: args.zIndex,
        pageNumber: args.pageNumber,
        warnings: args.warnings,
        textValidator: args.textValidator
      }),
      titleAssigned: args.titleAssigned || shouldBeTitle
    }
  }
  if (args.element.type === 'shape') {
    const text = stripHtml(String(record.content || ''))
    const shouldBeTitle = !args.titleAssigned && text.length > 0 && clampNumber(record.top) < 120
    return {
      html: await buildShapeBlock({
        element: record,
        blockId: shouldBeTitle ? 'title' : nextBlockId(text ? 'text' : 'shape'),
        role: shouldBeTitle ? 'title' : undefined,
        animation: elementAnimation,
        imagesDir: args.imagesDir,
        registry: args.registry,
        scaleX: args.scaleX,
        scaleY: args.scaleY,
        textScale: args.textScale,
        offsetX: args.offsetX,
        offsetY: args.offsetY,
        zIndex: args.zIndex,
        pageNumber: args.pageNumber,
        warnings: args.warnings,
        textValidator: args.textValidator
      }),
      titleAssigned: args.titleAssigned || shouldBeTitle
    }
  }
  if (args.element.type === 'diagram' && Array.isArray(args.element.elements)) {
    const text = args.element.textList?.join(' / ') || 'SmartArt'
    const css = buildBlockStyle({
      element: record,
      scaleX: args.scaleX,
      scaleY: args.scaleY,
      zIndex: args.zIndex,
      offsetX: args.offsetX,
      offsetY: args.offsetY,
      extra: ['background:#f8fafc', 'border:1px dashed #cbd5e1', 'padding:12px', 'color:#475569']
    })
    const animationAttrs = buildAnimationAttrs(elementAnimation)
    const animationAttrText = animationAttrs ? ` ${animationAttrs}` : ''
    return {
      html: `<section data-block-id="${nextBlockId('diagram')}"${animationAttrText} style="${css}">${escapeHtml(text)}</section>`,
      titleAssigned: args.titleAssigned
    }
  }
  return { html: '', titleAssigned: args.titleAssigned }
}

const buildFallbackTitle = (title: string): string =>
  `<header data-block-id="title" data-role="title" style="position:absolute;left:48px;top:36px;width:900px;height:56px;z-index:1;overflow:hidden;">
    <h1 style="margin:0;font-size:36px;line-height:1.2;color:#111827;">${escapeHtml(title)}</h1>
  </header>`

const buildImportedPptxMotionScript = (): string => `<script data-pptx-import-motion="1">
(function () {
  function runImportedPptxMotion() {
    var root = document.querySelector(".ppt-page-root");
    var pptApi = window.PPT;
    if (!root || !pptApi || typeof pptApi.scanDataAnim !== "function") return;
    var config = pptApi.scanDataAnim(root);
    if (!config || (!config.load.length && !config.click.length)) return;
    if (config.load.length && typeof pptApi.executeDataAnim === "function") {
      pptApi.executeDataAnim(config.load);
    }
    if (config.click.length && pptApi.clicks && typeof pptApi.clicks.on === "function") {
      config.click.forEach(function (animDef, index) {
        pptApi.clicks.on(index + 1, function () {
          if (typeof pptApi.executeDataAnim === "function") {
            pptApi.executeDataAnim([animDef]);
          }
        });
      });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runImportedPptxMotion, { once: true });
  } else {
    runImportedPptxMotion();
  }
})();
</script>`

const buildSlideHtml = async (args: {
  slide: Slide
  pageNumber: number
  pageId: string
  title: string
  size: { width: number; height: number }
  animationPlan?: SlideAnimationPlan
  projectDir: string
  registry: ImageRegistry
  textValidator?: PptxTextValidator
  chartRewrite?: PptxChartRewriteHandler
}): Promise<{ html: string; contentOutline: string; warnings: ImportWarning[] }> => {
  const imagesDir = path.join(args.projectDir, 'images')
  const slideFit = resolveSlideFit(args.size)
  const scaleX = slideFit.scale
  const scaleY = slideFit.scale
  const textScale = slideFit.scale
  const warnings: ImportWarning[] = []
  const backgroundCss = await fillToCss(args.slide.fill, imagesDir, args.registry)
  const blockCounters: Record<string, number> = {}
  const animationContext: SlideAnimationContext = {
    plan: args.animationPlan,
    usedAnimationIds: new Set<number>()
  }
  const elements = [...(args.slide.layoutElements || []), ...(args.slide.elements || [])].sort(
    (a, b) => clampNumber((a as unknown as Record<string, unknown>).order) - clampNumber((b as unknown as Record<string, unknown>).order)
  )
  const rendered: string[] = []
  let titleAssigned = false
  for (const [index, element] of elements.entries()) {
    try {
      const result = await renderElement({
        element,
        pageId: args.pageId,
        blockCounters,
        animationContext,
        imagesDir,
        registry: args.registry,
        scaleX,
        scaleY,
        textScale,
        zIndex: index + 2,
        offsetX: slideFit.offsetX,
        offsetY: slideFit.offsetY,
        titleAssigned,
        pageNumber: args.pageNumber,
        warnings,
        textValidator: args.textValidator,
        chartRewrite: args.chartRewrite
      })
      if (result.html) rendered.push(result.html)
      titleAssigned = result.titleAssigned
    } catch (error) {
      warnings.push({
        pageNumber: args.pageNumber,
        message: `元素 ${index + 1} 导入失败：${error instanceof Error ? error.message : String(error)}`
      })
    }
  }
  if (!titleAssigned) {
    rendered.unshift(buildFallbackTitle(args.title))
  }
  const contentOutline = flattenElements(elements)
    .map(({ element, text }) => {
      if (text && !isLowValueTitleText(text)) return text
      if (element.type === 'table') return '表格'
      if (element.type === 'chart') return '图表'
      if (element.type === 'image') return '图片'
      return ''
    })
    .filter(Boolean)
    .slice(0, 8)
    .join('；')
  const sectionStyle = ['position:relative', 'width:100%', 'height:100%', 'overflow:hidden', ...backgroundCss].join(';')
  const hasImportedAnimations = rendered.some((html) => /\sdata-anim=/.test(html))
  const body = `<section data-page-scaffold="1" style="${sectionStyle}">
  <main data-block-id="content" data-role="content" style="position:absolute;inset:0;z-index:0;">
    ${rendered.join('\n')}
  </main>
</section>
${hasImportedAnimations ? buildImportedPptxMotionScript() : ''}`
  const scaffold = buildPageScaffoldHtml({
    pageNumber: args.pageNumber,
    pageId: args.pageId,
    title: args.title
  })
  const $ = cheerio.load(scaffold, { scriptingEnabled: false })
  $('.ppt-page-root').first().removeClass('p-2 p-8').attr('style', 'padding:0;')
  $('.ppt-page-content').first().html(body)
  const html = $.html()
  const validation = validatePersistedPageHtml(html, args.pageId)
  if (!validation.valid) {
    warnings.push(
      ...validation.errors.map((message) => ({
        pageNumber: args.pageNumber,
        message
      }))
    )
  }
  return {
    html,
    contentOutline: contentOutline || args.title,
    warnings
  }
}

/**
 * 等距抽样：从 slides 中均匀选取 count 页，保证首尾都包含，中间按等距取。
 */
type SelectedSlide<T> = { slide: T; originalIndex: number }

function selectSlidesEvenly<T>(slides: T[], count: number): SelectedSlide<T>[] {
  const entries = slides.map((slide, originalIndex) => ({ slide, originalIndex }))
  if (count >= slides.length) return entries
  if (count <= 2) return [entries[0], entries[entries.length - 1]]
  const result: SelectedSlide<T>[] = [entries[0]]
  const middle = slides.slice(1, -1)
  const middleCount = count - 2
  for (let i = 0; i < middleCount; i++) {
    const idx = Math.floor((i + 0.5) * middle.length / middleCount)
    result.push(entries[idx + 1])
  }
  result.push(entries[entries.length - 1])
  return result
}

export async function importPptxToEditableHtml(args: {
  filePath: string
  projectDir: string
  title?: string
  maxPages?: number
  onProgress?: ImportProgress
  chartRewrite?: PptxChartRewriteHandler
}): Promise<ImportedPptxDeck> {
  const fileName = path.basename(args.filePath)
  const title = (args.title || path.basename(fileName, path.extname(fileName)) || '导入的 PPTX').trim()
  const indexPath = path.join(args.projectDir, 'index.html')
  const imagesDir = path.join(args.projectDir, 'images')
  await fs.promises.mkdir(imagesDir, { recursive: true })
  args.onProgress?.({ stage: 'reading', progress: 5, label: '正在读取 PPTX 文件' })
  const buffer = await fs.promises.readFile(args.filePath)
  const normalizedTables = normalizePptxTableStyleFlags(buffer)
  const normalizedCharts = normalizePptxChartValueCaches(Buffer.from(normalizedTables.arrayBuffer))
  args.onProgress?.({ stage: 'parsing', progress: 14, label: '正在解析 PPTX 结构' })
  const parsed = await parse(normalizedCharts.arrayBuffer, {
    imageMode: 'base64',
    videoMode: 'none',
    audioMode: 'none'
  })
  const slides = parsed.slides || []
  if (slides.length === 0) {
    throw new Error('PPTX 中没有可导入的幻灯片')
  }
  const rawMaxPages = typeof args.maxPages === 'number' ? Math.floor(args.maxPages) : null
  const maxPages = rawMaxPages && rawMaxPages > 0 ? rawMaxPages : null
  const effectiveSlides = maxPages && maxPages < slides.length
    ? selectSlidesEvenly(slides, maxPages)
    : slides.map((slide, originalIndex) => ({ slide, originalIndex }))
  const animationPlans = readPptxAnimationPlans(
    buffer,
    effectiveSlides.map(({ originalIndex }) => originalIndex),
    parsed.size
  )
  args.onProgress?.({
    stage: 'media',
    progress: 24,
    label: '正在整理图片和页面元素',
    totalPages: effectiveSlides.length
  })
  const registry: ImageRegistry = { index: 0, byKey: new Map() }
  const pages: ImportedPptxPage[] = []
  const allWarnings: ImportWarning[] = []
  if (normalizedTables.normalizedTableCount > 0) {
    allWarnings.push({
      message: `已修正 ${normalizedTables.normalizedTableCount} 个缺失样式定义的 PPTX 表格`
    })
  }
  if (normalizedCharts.normalizedChartValueCount > 0) {
    allWarnings.push({
      message: `已修正 ${normalizedCharts.normalizedChartValueCount} 个不兼容的 PPTX 图表缓存`
    })
  }
  const textValidator = new PptxTextValidator()
  try {
    for (let i = 0; i < effectiveSlides.length; i += 1) {
      const pageNumber = i + 1
      const pageId = `page-${pageNumber}`
      const selectedSlide = effectiveSlides[i]
      const pageTitle = titleFromSlide(selectedSlide.slide, pageNumber)
      args.onProgress?.({
        stage: 'pages',
        progress: 25 + Math.round((pageNumber / effectiveSlides.length) * 58),
        label: `正在导入并校验第 ${pageNumber} / ${effectiveSlides.length} 页`,
        pageNumber,
        totalPages: effectiveSlides.length
      })
      const htmlPath = path.join(args.projectDir, `${pageId}.html`)
      const rendered = await buildSlideHtml({
        slide: selectedSlide.slide,
        pageNumber,
        pageId,
        title: pageTitle,
        size: parsed.size,
        animationPlan: animationPlans[i],
        projectDir: args.projectDir,
        registry,
        textValidator,
        chartRewrite: args.chartRewrite
      })
      await fs.promises.writeFile(htmlPath, rendered.html, 'utf-8')
      pages.push({
        pageNumber,
        pageId,
        title: pageTitle,
        htmlPath,
        html: rendered.html,
        contentOutline: rendered.contentOutline
      })
      allWarnings.push(...rendered.warnings)
    }
  } finally {
    textValidator.close()
  }
  args.onProgress?.({ stage: 'index', progress: 90, label: '正在生成演示总览' })
  await fs.promises.writeFile(
    indexPath,
    buildProjectIndexHtml(
      title,
      pages.map(
        (page): DeckPageFile => ({
          pageNumber: page.pageNumber,
          pageId: page.pageId,
          title: page.title,
          htmlPath: path.basename(page.htmlPath)
        })
      )
    ),
    'utf-8'
  )
  return {
    title: title.slice(0, 120) || '导入的 PPTX',
    pageCount: pages.length,
    indexPath,
    pages,
    warnings: allWarnings.map((warning) =>
      warning.pageNumber ? `第 ${warning.pageNumber} 页：${warning.message}` : warning.message
    )
  }
}
