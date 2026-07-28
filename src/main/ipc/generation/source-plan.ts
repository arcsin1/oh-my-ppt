import type { OutlineItem } from '../../tools/types'
import type { CorporateTemplatePageRole } from '../../../shared/corporate-template'
import {
  SECTION_AGENDA_OUTLINE_MARKER,
  isInternalDocumentPlanPageReason,
  isSectionAgendaReason,
  type SourceDocumentPlan
} from '../../../shared/generation'

const MAX_SOURCE_PLAN_PAGES = 500
const LAYOUT_INTENTS = new Set([
  'cover',
  'data-focus',
  'comparison',
  'timeline',
  'concept',
  'process',
  'summary',
  'quote',
  'image-focus'
])

const getObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const readPositiveInt = (value: unknown): number | null => {
  const n = Number(value)
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
}

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const normalizeSourcePlanReason = (reason: string): string =>
  reason && !isInternalDocumentPlanPageReason(reason) ? reason : ''

const normalizeSourcePlanItem = (value: unknown, fallbackPageNumber: number) => {
  const record = getObject(value)
  if (!record) return null
  const pageNumber = readPositiveInt(record.pageNumber) ?? fallbackPageNumber
  const title = readString(record.title) || `Slide ${pageNumber}`
  const role = record.role === 'chapter-divider' ? 'chapter-divider' : 'content'
  const sourceHeading = readString(record.sourceHeading)
  const headingLevel = readPositiveInt(record.headingLevel) ?? 1
  const lineStart = readPositiveInt(record.lineStart) ?? 1
  const lineEnd = readPositiveInt(record.lineEnd) ?? lineStart
  const reason = readString(record.reason)
  if (!sourceHeading || lineEnd < lineStart) return null
  return {
    pageNumber,
    title,
    role,
    sourceHeading,
    headingLevel,
    lineStart,
    lineEnd,
    reason: normalizeSourcePlanReason(reason)
  }
}

export const normalizeSourcePlan = (value: unknown): SourceDocumentPlan | null => {
  const record = getObject(value)
  if (!record) return null
  const sourcePlanRecord = getObject(record.sourcePlan) ?? record
  const rawSkeleton = sourcePlanRecord.pageSkeleton
  if (!Array.isArray(rawSkeleton)) return null
  const pageSkeleton = rawSkeleton
    .slice(0, MAX_SOURCE_PLAN_PAGES)
    .map((item, index) => normalizeSourcePlanItem(item, index + 1))
    .filter((item): item is SourceDocumentPlan['pageSkeleton'][number] => Boolean(item))
  if (pageSkeleton.length === 0) return null
  const confidence =
    sourcePlanRecord.confidence === 'medium' || sourcePlanRecord.confidence === 'low'
      ? sourcePlanRecord.confidence
      : 'high'
  return {
    version: 1,
    confidence,
    sourceDocumentPath: readString(sourcePlanRecord.sourceDocumentPath) || undefined,
    sourceDocumentName: readString(sourcePlanRecord.sourceDocumentName) || undefined,
    pageSkeleton
  }
}

export const sourcePlanFromSkeletonRows = (rows: unknown[]): SourceDocumentPlan | null => {
  if (rows.length === 0) return null
  const first = getObject(rows[0])
  if (!first) return null
  const pageSkeleton = rows
    .map((row, index) => {
      const record = getObject(row)
      if (!record) return null
      return normalizeSourcePlanItem(
        {
          pageNumber: record.page_number ?? record.pageNumber,
          title: record.title,
          role: record.role,
          sourceHeading: record.source_heading ?? record.sourceHeading,
          headingLevel: record.heading_level ?? record.headingLevel,
          lineStart: record.line_start ?? record.lineStart,
          lineEnd: record.line_end ?? record.lineEnd,
          reason: record.reason
        },
        index + 1
      )
    })
    .filter((item): item is SourceDocumentPlan['pageSkeleton'][number] => Boolean(item))
  if (pageSkeleton.length === 0) return null
  const confidence =
    first.confidence === 'medium' || first.confidence === 'low' ? first.confidence : 'high'
  return {
    version: 1,
    confidence,
    sourceDocumentPath:
      readString(first.source_document_path ?? first.sourceDocumentPath) || undefined,
    sourceDocumentName:
      readString(first.source_document_name ?? first.sourceDocumentName) || undefined,
    pageSkeleton
  }
}

export const userMessageRequestsOutlineRestructure = (value: string): boolean =>
  /重排|重组|重新规划|压缩|合并|拆分|删减|精简.*页|改成\s*\d+\s*页|做成\s*\d+\s*页|只做\s*\d+\s*页|rewrite.*outline|replan|restructure|compress|merge|split|make\s+it\s+\d+\s+(?:slides|pages)/i.test(
    value
  )

export const canUseSourcePlanDirectly = (args: {
  sourcePlan: SourceDocumentPlan | null | undefined
  totalPages: number
  userMessage: string
}): boolean =>
  Boolean(
    args.sourcePlan &&
    args.sourcePlan.confidence === 'high' &&
    args.sourcePlan.pageSkeleton.length === args.totalPages &&
    !userMessageRequestsOutlineRestructure(args.userMessage)
  )

export const canUseSourcePlanForTemplateBodyPages = (args: {
  sourcePlan: SourceDocumentPlan | null | undefined
  templateRoles: CorporateTemplatePageRole[]
  userMessage: string
}): boolean =>
  canUseSourcePlanDirectly({
    sourcePlan: args.sourcePlan,
    totalPages: args.templateRoles.filter((role) => role === 'body').length,
    userMessage: args.userMessage
  })

const inferLayoutIntentFromSkeletonTitle = (
  item: SourceDocumentPlan['pageSkeleton'][number]
): OutlineItem['layoutIntent'] => {
  const text = `${item.title}\n${item.sourceHeading}`
  if (isSectionAgendaReason(item.reason)) return 'summary'
  if (item.role === 'chapter-divider') return 'cover'
  if (/指标|数据|收入|增长|下降|比例|金额|率|metric|revenue|growth|decline|kpi|%|\d/.test(text)) {
    return 'data-focus'
  }
  if (/对比|比较|差异|竞品|comparison|versus|vs\.?/i.test(text)) return 'comparison'
  if (/流程|步骤|路径|机制|workflow|process|step|how to/i.test(text)) return 'process'
  if (/计划|阶段|路线|节奏|timeline|roadmap|phase|schedule/i.test(text)) return 'timeline'
  if (/总结|结论|复盘|summary|conclusion|takeaway/i.test(text)) return 'summary'
  return 'concept'
}

export const mapSourcePlanToOutlineItems = (sourcePlan: SourceDocumentPlan): OutlineItem[] =>
  sourcePlan.pageSkeleton.map((item) => {
    const inferredLayoutIntent = inferLayoutIntentFromSkeletonTitle(item)
    const isSectionAgenda = isSectionAgendaReason(item.reason)
    return {
      title: item.title,
      contentOutline: (isSectionAgenda
        ? [SECTION_AGENDA_OUTLINE_MARKER, `Page purpose: ${item.reason}`]
        : [
            `Source heading: ${item.sourceHeading}`,
            `Source range: lines ${item.lineStart}-${item.lineEnd}`,
            `Page role: ${item.role}`,
            item.reason ? `Page purpose: ${item.reason}` : ''
          ])
        .filter(Boolean)
        .join('\n'),
      layoutIntent: LAYOUT_INTENTS.has(inferredLayoutIntent || '')
        ? inferredLayoutIntent
        : 'concept'
    }
  })
