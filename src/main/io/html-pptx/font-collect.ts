import { readFileSync, statSync } from 'fs'
import path from 'path'
import log from 'electron-log/main.js'
import { decompress } from 'woff2-encoder'
import fonteditorCore, { createFont } from 'fonteditor-core'
import type { HtmlToPptxEmbeddedFont, HtmlToPptxSlide } from '@arcsin1/html2pptx'

type EmbeddedFontStyle = HtmlToPptxEmbeddedFont['style']

// Container format written into ppt/fonts/fontN.fntdata. 'eot' is what Windows
// PowerPoint itself produces; some viewers (PowerPoint for Mac, WPS) are more
// reliable with a plain sfnt ('ttf') payload.
type EmbeddedPayloadFormat = 'eot' | 'ttf'

type FontUsage = {
  fontFace: string
  style: EmbeddedFontStyle
  characters: Set<string>
}

type ProjectFontFace = {
  fontFace: string
  weight: number
  style: 'normal' | 'italic'
  fontPath: string
  unicodeRange?: string
}

const EOT_HEADER_SIZE = 82
const RESTRICTED_EMBEDDING = 0x0002
const BITMAP_ONLY_EMBEDDING = 0x0200

const normalizeFontFace = (value: string): string => value.replace(/\s+/g, ' ').trim()

const fontStyleFor = (bold?: boolean, italic?: boolean): EmbeddedFontStyle => {
  if (bold && italic) return 'boldItalic'
  if (bold) return 'bold'
  if (italic) return 'italic'
  return 'regular'
}

const usageKey = (fontFace: string, style: EmbeddedFontStyle): string =>
  `${normalizeFontFace(fontFace).toLocaleLowerCase()}::${style}`

const addUsage = (
  usages: Map<string, FontUsage>,
  fontFace: string | undefined,
  text: string,
  bold?: boolean,
  italic?: boolean
): void => {
  const normalizedFace = normalizeFontFace(fontFace || '')
  if (!normalizedFace) return
  const style = fontStyleFor(bold, italic)
  const key = usageKey(normalizedFace, style)
  const usage = usages.get(key) || {
    fontFace: normalizedFace,
    style,
    characters: new Set<string>()
  }
  for (const character of text) usage.characters.add(character)
  usages.set(key, usage)
}

// Text extraction is the authority for what becomes editable in the PPTX.
// Scanning every font on disk would embed unused families and miss the actual
// style used by rich-text runs.
const collectUsedFontUsages = (slides: HtmlToPptxSlide[]): FontUsage[] => {
  const usages = new Map<string, FontUsage>()
  for (const slide of slides) {
    for (const text of slide.texts) {
      if (text.runs?.length) {
        for (const run of text.runs) {
          addUsage(
            usages,
            run.fontFace || text.fontFace,
            run.text,
            run.bold ?? text.bold,
            run.italic ?? text.italic
          )
        }
      } else {
        addUsage(usages, text.fontFace, text.text, text.bold, text.italic)
      }
    }
    for (const table of slide.tables || []) {
      for (const row of table.rows) {
        for (const cell of row) {
          addUsage(usages, cell.fontFace, cell.text, cell.bold, cell.italic)
        }
      }
    }
  }
  return [...usages.values()]
}

const parseCssValue = (css: string, property: string): string => {
  const escapedProperty = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return css.match(new RegExp(`(?:^|;)\\s*${escapedProperty}\\s*:\\s*([^;]+)`, 'i'))?.[1]?.trim() || ''
}

const parseCssFontFamily = (value: string): string =>
  normalizeFontFace(value.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '') || '')

const parseCssFontWeight = (value: string): number => {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'normal') return 400
  if (normalized === 'bold') return 700
  const match = normalized.match(/\d{1,4}/)
  return match ? Math.max(1, Math.min(1000, Number.parseInt(match[0], 10))) : 400
}

const parseCssFontStyle = (value: string): 'normal' | 'italic' =>
  /italic|oblique/i.test(value) ? 'italic' : 'normal'

const isProjectFontPath = (candidatePath: string, projectDir: string): boolean => {
  const fontRoot = path.resolve(projectDir, 'assets', 'fonts')
  const relative = path.relative(fontRoot, candidatePath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

const resolveFontUrl = (url: string, htmlPath: string, projectDir: string): string | null => {
  const source = url.trim().replace(/^['"]|['"]$/g, '')
  if (!source || /^(?:data:|https?:|local-asset:)/i.test(source)) return null
  const pathname = source.split(/[?#]/, 1)[0]
  const candidatePath = path.resolve(path.dirname(htmlPath), decodeURIComponent(pathname))
  if (!isProjectFontPath(candidatePath, projectDir)) return null
  if (path.extname(candidatePath).toLowerCase() !== '.woff2') return null
  try {
    return statSync(candidatePath).isFile() ? candidatePath : null
  } catch {
    return null
  }
}

// Read the actual @font-face declarations injected into exported HTML. This
// covers both bundled Google files and user uploads without relying on either
// storage directory's name or global user-font registry state.
const collectProjectFontFaces = (projectDir: string, htmlPaths: string[]): ProjectFontFace[] => {
  const faces = new Map<string, ProjectFontFace>()
  for (const htmlPath of new Set(htmlPaths)) {
    let html: string
    try {
      html = readFileSync(htmlPath, 'utf-8')
    } catch {
      continue
    }
    for (const match of html.matchAll(/@font-face\s*\{([\s\S]*?)\}/gi)) {
      const block = match[1] || ''
      const fontFace = parseCssFontFamily(parseCssValue(block, 'font-family'))
      const src = parseCssValue(block, 'src')
      if (!fontFace || !src) continue
      const weight = parseCssFontWeight(parseCssValue(block, 'font-weight'))
      const style = parseCssFontStyle(parseCssValue(block, 'font-style'))
      const unicodeRange = parseCssValue(block, 'unicode-range') || undefined
      for (const urlMatch of src.matchAll(/url\(\s*([^)]*?)\s*\)/gi)) {
        const fontPath = resolveFontUrl(urlMatch[1] || '', htmlPath, projectDir)
        if (!fontPath) continue
        const key = `${normalizeFontFace(fontFace).toLocaleLowerCase()}::${weight}::${style}::${fontPath}::${unicodeRange || ''}`
        faces.set(key, { fontFace, weight, style, fontPath, unicodeRange })
      }
    }
  }
  return [...faces.values()]
}

const unicodeRangeContains = (unicodeRange: string, codePoint: number): boolean => {
  for (const token of unicodeRange.split(',')) {
    const value = token.trim().replace(/^U\+/i, '')
    if (!value) continue
    const rangeMatch = value.match(/^([0-9a-f?]+)(?:-([0-9a-f]+))?$/i)
    if (!rangeMatch) continue
    const start = rangeMatch[1].replace(/\?/g, '0')
    const end = rangeMatch[2] || rangeMatch[1].replace(/\?/g, 'f')
    const lower = Number.parseInt(start, 16)
    const upper = Number.parseInt(end, 16)
    if (Number.isFinite(lower) && Number.isFinite(upper) && codePoint >= lower && codePoint <= upper) {
      return true
    }
  }
  return false
}

const faceContainsUsage = (face: ProjectFontFace, usage: FontUsage): boolean => {
  if (!face.unicodeRange || usage.characters.size === 0) return true
  for (const character of usage.characters) {
    if (unicodeRangeContains(face.unicodeRange, character.codePointAt(0) || 0)) return true
  }
  return false
}

const expectedWeightFor = (style: EmbeddedFontStyle): number =>
  style === 'bold' || style === 'boldItalic' ? 700 : 400

const sourceStyleFor = (style: EmbeddedFontStyle): 'normal' | 'italic' =>
  style === 'italic' || style === 'boldItalic' ? 'italic' : 'normal'

const resolveFontSources = (
  usage: FontUsage,
  faces: ProjectFontFace[]
): { weight: number; paths: string[] } | null => {
  const normalizedFace = normalizeFontFace(usage.fontFace).toLocaleLowerCase()
  const style = sourceStyleFor(usage.style)
  const candidates = faces.filter(
    (face) =>
      normalizeFontFace(face.fontFace).toLocaleLowerCase() === normalizedFace &&
      face.style === style
  )
  if (candidates.length === 0) return null

  const expectedWeight = expectedWeightFor(usage.style)
  const closestWeight = candidates.reduce(
    (closest, face) =>
      Math.abs(face.weight - expectedWeight) < Math.abs(closest - expectedWeight)
        ? face.weight
        : closest,
    candidates[0].weight
  )
  const matchingFaces = candidates.filter((face) => face.weight === closestWeight)
  const paths = matchingFaces
    .filter((face) => faceContainsUsage(face, usage))
    .map((face) => face.fontPath)

  return paths.length > 0 ? { weight: closestWeight, paths: [...new Set(paths)].sort() } : null
}

// ─── TTF merge ──────────────────────────────────────────────────────

const uint8ToArrayBuffer = (buffer: Uint8Array): ArrayBuffer => {
  const arrayBuffer = new ArrayBuffer(buffer.byteLength)
  new Uint8Array(arrayBuffer).set(buffer)
  return arrayBuffer
}

const detectSfntType = (buffer: Uint8Array): 'ttf' | 'otf' =>
  buffer[0] === 0x4f && buffer[1] === 0x54 && buffer[2] === 0x54 && buffer[3] === 0x4f
    ? 'otf'
    : 'ttf'

const readWoff2SubsetAsTtfObject = async (woff2Path: string): Promise<any> => {
  const woff2Data = new Uint8Array(readFileSync(woff2Path))
  const sfntData = await decompress(woff2Data)
  const font = createFont(uint8ToArrayBuffer(sfntData), {
    type: detectSfntType(sfntData),
    subset: [],
    hinting: false,
    compound2simple: true
  })
  return font.get()
}

const glyphUnicodeCodes = (glyph: any): number[] =>
  Array.isArray(glyph?.unicode)
    ? Array.from(
        new Set<number>(
          glyph.unicode.filter((code: unknown): code is number =>
            typeof code === 'number' && Number.isFinite(code)
          )
        )
      )
    : []

const glyphSortKey = (glyph: any): number => {
  const codes = glyphUnicodeCodes(glyph)
  return codes.length > 0 ? Math.min(...codes) : Number.MAX_SAFE_INTEGER
}

const isEmbeddable = (ttf: any): boolean => {
  const flags = Number(ttf?.['OS/2']?.fsType || 0)
  return (flags & (RESTRICTED_EMBEDDING | BITMAP_ONLY_EMBEDDING)) === 0
}

const normalizeMergedFontMetadata = (
  ttf: any,
  familyName: string,
  styleName: string,
  weight: number,
  italic: boolean
): void => {
  const postScriptStyle = styleName.replace(/\s+/g, '')
  ttf.name = {
    ...(ttf.name || {}),
    fontFamily: familyName,
    fontSubFamily: styleName,
    preferredFamily: familyName,
    preferredSubFamily: styleName,
    compatibleFull: `${familyName} ${styleName}`,
    uniqueSubFamily: `${familyName}-${postScriptStyle}`,
    fullName: `${familyName} ${styleName}`,
    postScriptName: `${familyName.replace(/\s+/g, '')}-${postScriptStyle}`
  }
  if (ttf['OS/2']) {
    ttf['OS/2'].usWeightClass = weight
    const currentSelection = Number(ttf['OS/2'].fsSelection || 0)
    ttf['OS/2'].fsSelection =
      (currentSelection & ~(0x0001 | 0x0020)) | (italic ? 0x0001 : 0) | (weight >= 700 ? 0x0020 : 0)
    const unicodes = ttf.glyf
      .flatMap((glyph: any) => (Array.isArray(glyph.unicode) ? glyph.unicode : []))
      .filter((code: number) => Number.isFinite(code))
    if (unicodes.length > 0) {
      ttf['OS/2'].usFirstCharIndex = Math.min(...unicodes)
      ttf['OS/2'].usLastCharIndex = Math.max(...unicodes)
    }
  }
  if (ttf.head) {
    ttf.head.macStyle = (weight >= 700 ? 1 : 0) | (italic ? 2 : 0)
  }
}

const isCjkFontFace = (fontFace: string): boolean =>
  /(?:Noto Sans SC|Noto Serif SC|Ma Shan Zheng|Source Han|PingFang|Microsoft YaHei|SimHei|SimSun)/i.test(fontFace)

const swapUtf16ByteOrder = (buffer: Uint8Array, start: number, byteLength: number): void => {
  for (let index = start; index < start + byteLength; index += 2) {
    const first = buffer[index]
    buffer[index] = buffer[index + 1]
    buffer[index + 1] = first
  }
}

const readEotNames = (buffer: Uint8Array): string[] | null => {
  if (buffer.byteLength < EOT_HEADER_SIZE) return null
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (view.getUint32(0, true) !== buffer.byteLength || view.getUint16(34, true) !== 0x504c) return null
  let offset = EOT_HEADER_SIZE
  const names: string[] = []
  for (let index = 0; index < 4; index += 1) {
    if (offset + 4 > buffer.byteLength) return null
    const byteLength = view.getUint16(offset, true)
    const textStart = offset + 2
    const textEnd = textStart + byteLength
    if (byteLength % 2 !== 0 || textEnd + 2 > buffer.byteLength) return null
    names.push(new TextDecoder('utf-16le').decode(buffer.slice(textStart, textEnd)))
    offset = textEnd + 2
  }
  if (offset + 2 > buffer.byteLength) return null
  const rootStringSize = view.getUint16(offset, true)
  const fontOffset = offset + 2 + rootStringSize
  const fontDataSize = view.getUint32(4, true)
  if (fontOffset + fontDataSize !== buffer.byteLength) return null
  return names
}

const encodeUtf16Le = (value: string): Uint8Array => {
  const output = new Uint8Array(value.length * 2)
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    output[index * 2] = codeUnit & 0xff
    output[index * 2 + 1] = codeUnit >>> 8
  }
  return output
}

const readEotNameRanges = (buffer: Uint8Array): Array<{ start: number; byteLength: number }> | null => {
  if (buffer.byteLength < EOT_HEADER_SIZE) return null
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (view.getUint32(0, true) !== buffer.byteLength || view.getUint16(34, true) !== 0x504c) return null
  let offset = EOT_HEADER_SIZE
  const ranges: Array<{ start: number; byteLength: number }> = []
  for (let index = 0; index < 4; index += 1) {
    if (offset + 4 > buffer.byteLength) return null
    const byteLength = view.getUint16(offset, true)
    const start = offset + 2
    const end = start + byteLength
    if (byteLength % 2 !== 0 || end + 2 > buffer.byteLength) return null
    ranges.push({ start, byteLength })
    offset = end + 2
  }
  return ranges
}

const replaceEotStyleName = (eotBuffer: Uint8Array, styleName: string): Uint8Array | null => {
  const nameRanges = readEotNameRanges(eotBuffer)
  if (!nameRanges) return null
  const styleRange = nameRanges[1]
  const styleBytes = encodeUtf16Le(styleName)
  if (styleRange.byteLength === styleBytes.byteLength) {
    const normalized = new Uint8Array(eotBuffer)
    normalized.set(styleBytes, styleRange.start)
    return normalized
  }

  // fonteditor-core serializes name ID 2 as fontSubFamily, but its EOT writer
  // reads the non-existent fontStyle alias. Rebuild only that EOT field so the
  // header's StyleName remains consistent with the embedded OpenType font.
  const styleSizeOffset = styleRange.start - 2
  const sourceAfterStyle = styleRange.start + styleRange.byteLength
  const resized = new Uint8Array(eotBuffer.byteLength - styleRange.byteLength + styleBytes.byteLength)
  resized.set(eotBuffer.slice(0, styleSizeOffset), 0)
  const view = new DataView(resized.buffer)
  view.setUint16(styleSizeOffset, styleBytes.byteLength, true)
  resized.set(styleBytes, styleSizeOffset + 2)
  resized.set(eotBuffer.slice(sourceAfterStyle), styleSizeOffset + 2 + styleBytes.byteLength)
  view.setUint32(0, resized.byteLength, true)
  return resized
}

const normalizeEotPayload = (
  eotBuffer: Uint8Array,
  familyName: string,
  styleName: string,
  italic: boolean
): Uint8Array | null => {
  const normalized = new Uint8Array(eotBuffer)
  if (normalized.byteLength < EOT_HEADER_SIZE) return null
  const view = new DataView(normalized.buffer, normalized.byteOffset, normalized.byteLength)
  if (view.getUint16(34, true) !== 0x504c) return null

  const nameRanges = readEotNameRanges(normalized)
  if (!nameRanges) return null
  for (const { start: textStart, byteLength } of nameRanges) {
    // fonteditor-core writes EOT name strings as UTF-16BE. EOT requires
    // UTF-16LE, which Office uses when matching the font reference.
    swapUtf16ByteOrder(normalized, textStart, byteLength)
  }
  const withStyleName = replaceEotStyleName(normalized, styleName)
  if (!withStyleName) return null
  withStyleName[26] = isCjkFontFace(familyName) ? 0x86 : 0x01
  withStyleName[27] = italic ? 1 : 0
  const names = readEotNames(withStyleName)
  return names && normalizeFontFace(names[0]) === normalizeFontFace(familyName) && names[1] === styleName
    ? withStyleName
    : null
}

const mergeTtfObjects = (
  ttfObjects: any[],
  familyName: string,
  styleName: string,
  weight: number,
  italic: boolean,
  payloadFormat: EmbeddedPayloadFormat
): Uint8Array | null => {
  const base = ttfObjects[0]
  const notdef = base.glyf?.[0] || { name: '.notdef', unicode: [] }
  const glyphs: any[] = [notdef]
  const seenCodes = new Set<number>()
  const seenNames = new Set<string>()

  for (const ttf of ttfObjects) {
    for (const glyph of ttf.glyf || []) {
      if (glyph.name === '.notdef' || glyph.name === '.null' || glyph.name === 'nonmarkingreturn') {
        continue
      }
      const codes = glyphUnicodeCodes(glyph)
      const name = String(glyph.name || '')
      if (codes.length > 0) {
        if (codes.some((code) => seenCodes.has(code))) continue
        glyph.unicode = codes.sort((a, b) => a - b)
        codes.forEach((code) => seenCodes.add(code))
      } else if (name) {
        if (seenNames.has(name)) continue
        seenNames.add(name)
      } else {
        continue
      }
      glyphs.push(glyph)
    }
  }

  base.glyf = [glyphs[0], ...glyphs.slice(1).sort((a, b) => glyphSortKey(a) - glyphSortKey(b))]
  normalizeMergedFontMetadata(base, familyName, styleName, weight, italic)

  const writer = new fonteditorCore.TTFWriter()
  try {
    const ttfBuffer = new Uint8Array(writer.write(base))
    if (payloadFormat === 'ttf') {
      return ttfBuffer
    }
    const eotBuffer = new Uint8Array(fonteditorCore.ttf2eot(uint8ToArrayBuffer(ttfBuffer)))
    const normalizedEot = normalizeEotPayload(eotBuffer, familyName, styleName, italic)
    const eotNames = normalizedEot ? readEotNames(normalizedEot) : null
    if (!normalizedEot || !eotNames || normalizeFontFace(eotNames[0]) !== normalizeFontFace(familyName)) {
      return null
    }
    return normalizedEot
  } finally {
    writer.dispose()
  }
}

export const collectEmbeddedFonts = async (
  projectDir: string,
  slides: HtmlToPptxSlide[],
  options: {
    mode?: 'auto' | 'always' | 'never'
    payloadFormat?: EmbeddedPayloadFormat
    maxTotalBytes?: number
    pageHtmlPaths?: string[]
  } = {}
): Promise<HtmlToPptxEmbeddedFont[]> => {
  const mode = options.mode || 'auto'
  // 默认裸 TTF（sfnt）载荷：实测 PowerPoint for Mac 16.78 在 fntdata 为 EOT 容器时
  // 会忽略 b="1"（加粗不渲染，暗像素仅 100%），去嵌入或换裸 TTF 后加粗恢复
  // （约 131%）。EOT 仅按需显式传入以兼容旧链路。
  const payloadFormat = options.payloadFormat || 'ttf'
  if (mode === 'never') {
    log.info('[font-embed] disabled by export option')
    return []
  }
  if (slides.length === 0) return []

  const usages = collectUsedFontUsages(slides)
  log.info('[font-embed] actual text font usages', {
    usages: usages.map((usage) => ({
      fontFace: usage.fontFace,
      style: usage.style,
      characterCount: usage.characters.size
    }))
  })
  if (usages.length === 0) return []

  const faces = collectProjectFontFaces(projectDir, options.pageHtmlPaths || [])
  log.info('[font-embed] local @font-face declarations', {
    count: faces.length,
    families: [...new Set(faces.map((face) => face.fontFace))]
  })
  if (faces.length === 0) return []

  const embeddedFonts: HtmlToPptxEmbeddedFont[] = []
  for (const usage of usages) {
    const source = resolveFontSources(usage, faces)
    if (!source) {
      log.info('[font-embed] skip (no matching local font face)', {
        fontFace: usage.fontFace,
        style: usage.style
      })
      continue
    }

    const ttfObjects: any[] = []
    for (const woff2Path of source.paths) {
      try {
        const ttf = await readWoff2SubsetAsTtfObject(woff2Path)
        if (!isEmbeddable(ttf)) {
          log.warn('[font-embed] skip font restricted by fsType', {
            fontFace: usage.fontFace,
            style: usage.style,
            path: woff2Path
          })
          continue
        }
        ttfObjects.push(ttf)
      } catch (error) {
        log.warn('[font-embed] failed to read woff2 source', {
          path: woff2Path,
          error: String(error)
        })
      }
    }
    if (ttfObjects.length === 0) continue

    try {
      const isBold = usage.style === 'bold' || usage.style === 'boldItalic'
      const isItalic = usage.style === 'italic' || usage.style === 'boldItalic'
      const payload = mergeTtfObjects(
        ttfObjects,
        usage.fontFace,
        isBold ? (isItalic ? 'Bold Italic' : 'Bold') : isItalic ? 'Italic' : 'Regular',
        source.weight,
        isItalic,
        payloadFormat
      )
      if (!payload) {
        log.warn('[font-embed] generated font payload failed structural validation', {
          fontFace: usage.fontFace,
          style: usage.style,
          payloadFormat
        })
        continue
      }
      embeddedFonts.push({ fontFace: usage.fontFace, style: usage.style, ttfBuffer: payload })
      log.info('[font-embed] embedded actual font usage', {
        fontFace: usage.fontFace,
        style: usage.style,
        files: source.paths.length,
        sizeKb: Math.round(payload.byteLength / 1024)
      })
    } catch (error) {
      log.warn('[font-embed] failed to merge font', {
        fontFace: usage.fontFace,
        style: usage.style,
        error: String(error)
      })
    }
  }

  if (mode === 'auto') {
    const maxTotalBytes = options.maxTotalBytes ?? 20 * 1024 * 1024
    const totalBytes = embeddedFonts.reduce((sum, item) => sum + item.ttfBuffer.byteLength, 0)
    if (totalBytes > maxTotalBytes) {
      log.warn('[font-embed] skipped embedded fonts in auto mode because payload is too large', {
        totalBytes,
        maxTotalBytes,
        count: embeddedFonts.length
      })
      return []
    }
  }

  return embeddedFonts
}
