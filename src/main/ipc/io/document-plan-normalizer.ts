import type { ParsedDocumentPlanResult } from '@shared/generation'
import { MAX_CORPORATE_PAGE_COUNT } from '@shared/brand'

const MAX_PAGE_COUNT = MAX_CORPORATE_PAGE_COUNT
const CHINESE_NUMERAL_MAP: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9
}

const getObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const isMeaningfulText = (value: string): boolean => value.trim().length > 0

const stringifyLooseValue = (value: unknown): string => {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyLooseValue(item))
      .filter(isMeaningfulText)
      .join('\n')
  }
  const record = getObject(value)
  if (record) {
    return Object.entries(record)
      .map(([key, item]) => {
        const text = stringifyLooseValue(item)
        return text ? `${key}：${text}` : ''
      })
      .filter(isMeaningfulText)
      .join('\n')
  }
  return ''
}

const readFirstLooseString = (object: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = object[key]
    const text = stringifyLooseValue(value)
    if (text) return text
  }
  return ''
}

const unescapeLooseJsonString = (value: string): string =>
  value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim()

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const extractLooseFieldFromText = (rawText: string, keys: string[]): string => {
  for (const key of keys) {
    const quotedPattern = new RegExp(
      `["']${escapeRegExp(key)}["']\\s*[:：]\\s*["']([\\s\\S]*?)(?=["']\\s*(?:,|}|\\n\\s*["'][^"']+["']\\s*[:：]))`,
      'i'
    )
    const quotedMatch = rawText.match(quotedPattern)
    if (quotedMatch?.[1]?.trim()) return unescapeLooseJsonString(quotedMatch[1])

    const linePattern = new RegExp(
      `(?:^|\\n)\\s*["']?${escapeRegExp(key)}["']?\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*["']?(?:${keys
        .map(escapeRegExp)
        .join('|')})["']?\\s*[:：]|$)`,
      'i'
    )
    const lineMatch = rawText.match(linePattern)
    if (lineMatch?.[1]?.trim()) {
      return unescapeLooseJsonString(lineMatch[1].replace(/[,}]\s*$/g, ''))
    }
  }
  return ''
}

const stripLikelyJsonWrappers = (rawText: string): string =>
  rawText
    .replace(/```(?:json)?/gi, '')
    .replace(/```/g, '')
    .replace(/^\s*[{[]\s*/, '')
    .replace(/\s*[}\]]\s*$/, '')
    .trim()

const extractJsonBlock = (content: string): string => {
  const trimmed = content.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) return fenced[1].trim()
  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1)
  return trimmed
}

const parseChinesePageNumber = (value: string): number | null => {
  const text = value.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number.parseInt(text, 10)
  if (text === '十') return 10
  if (text.startsWith('十')) {
    const ones = CHINESE_NUMERAL_MAP[text.slice(1)]
    return ones !== undefined ? 10 + ones : null
  }
  if (text.includes('十')) {
    const [tensRaw, onesRaw = ''] = text.split('十')
    const tens = CHINESE_NUMERAL_MAP[tensRaw]
    const ones = onesRaw ? CHINESE_NUMERAL_MAP[onesRaw] : 0
    return tens !== undefined && ones !== undefined ? tens * 10 + ones : null
  }
  return CHINESE_NUMERAL_MAP[text] ?? null
}

const extractNumberedSectionCount = (text: string, headingPattern: RegExp): number => {
  const lines = text.split('\n')
  const startIndex = lines.findIndex((line) => headingPattern.test(line))
  if (startIndex < 0) return 0
  let count = 0
  let lastNumber = 0
  for (const line of lines.slice(startIndex + 1)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^(每页要点|必须保留|风格|表达|注意事项|受众|核心观点|演示目标)\s*[:：]/.test(trimmed))
      break
    const match = trimmed.match(/^(\d{1,2})\s*[.、．)]\s*\S+/)
    if (!match) {
      if (count > 0 && /^[^\d第]/.test(trimmed)) break
      continue
    }
    const n = Number.parseInt(match[1], 10)
    if (Number.isFinite(n) && n >= 1 && n <= MAX_PAGE_COUNT) {
      lastNumber = Math.max(lastNumber, n)
      count += 1
    }
  }
  return Math.max(count, lastNumber)
}

export const extractImpliedPageCount = (text: string): number => {
  const pageNumbers = Array.from(text.matchAll(/第\s*([一二两三四五六七八九十\d]{1,3})\s*页/g))
    .map((match) => parseChinesePageNumber(match[1] || ''))
    .filter((value): value is number => Boolean(value && value >= 1 && value <= MAX_PAGE_COUNT))
  const englishPageNumbers = Array.from(text.matchAll(/\bPage\s+(\d{1,2})\s*[:：.\-]/gi))
    .map((match) => Number.parseInt(match[1] || '', 10))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= MAX_PAGE_COUNT)
  const maxPageNumber =
    pageNumbers.length > 0 || englishPageNumbers.length > 0
      ? Math.max(...pageNumbers, ...englishPageNumbers)
      : 0
  const outlineCount = extractNumberedSectionCount(text, /建议大纲|大纲|目录/)
  const pagePointCount = extractNumberedSectionCount(text, /每页要点|页面要点|页级要点/)
  return Math.min(MAX_PAGE_COUNT, Math.max(maxPageNumber, outlineCount, pagePointCount, 0))
}

export const normalizeGeneratedPlan = (
  rawText: string,
  fallback: {
    topic: string
    pageCount: number | null
    briefText: string
  }
): Pick<ParsedDocumentPlanResult, 'topic' | 'pageCount' | 'briefText'> => {
  const parsed = (() => {
    try {
      return JSON.parse(extractJsonBlock(rawText)) as unknown
    } catch {
      return null
    }
  })()
  const object =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}

  const topicKeys = ['topic', 'title', '主题', '标题']
  const briefKeys = [
    'briefText',
    'brief_text',
    'brief',
    'description',
    'detail',
    'detailedDescription',
    'outline',
    'summary',
    'content',
    'plan',
    '详细描述',
    '描述',
    '大纲',
    '建议大纲'
  ]
  const pageCountKeys = ['pageCount', 'page_count', 'pages', 'totalPages', '页数']

  const topic =
    readFirstLooseString(object, topicKeys) ||
    extractLooseFieldFromText(rawText, topicKeys) ||
    fallback.topic ||
    ''
  const rawPageCountValue =
    pageCountKeys.map((key) => object[key]).find((value) => value !== undefined) ??
    extractLooseFieldFromText(rawText, pageCountKeys)
  const rawPageCount = Number(rawPageCountValue)
  const hasExplicitPageCount = Number.isFinite(rawPageCount)
  const normalizedPageCount = hasExplicitPageCount
    ? Math.min(MAX_PAGE_COUNT, Math.max(1, Math.round(rawPageCount)))
    : fallback.pageCount || 5
  const parsedHasBriefKey = Object.keys(object).some((key) => briefKeys.includes(key))
  const looseBriefText = parsedHasBriefKey
    ? (readFirstLooseString(object, briefKeys) ?? '')
    : readFirstLooseString(object, briefKeys) ||
      extractLooseFieldFromText(rawText, briefKeys) ||
      fallback.briefText ||
      stripLikelyJsonWrappers(rawText)
  const briefText = looseBriefText.trim()
  const impliedPageCount = extractImpliedPageCount(`${briefText}\n${rawText}`)
  const pageCount =
    hasExplicitPageCount && !(fallback.pageCount === null && normalizedPageCount <= 1 && impliedPageCount >= 2)
      ? normalizedPageCount
      : impliedPageCount >= 2
        ? impliedPageCount
        : normalizedPageCount

  if (!topic.trim()) throw new Error('文档解析完成，但模型未返回 topic')
  if (!briefText) throw new Error('文档解析完成，但模型未返回 briefText')

  return {
    topic: topic.trim(),
    pageCount,
    briefText
  }
}
