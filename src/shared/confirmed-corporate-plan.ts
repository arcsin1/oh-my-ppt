import { MAX_CORPORATE_PAGE_COUNT } from './brand'
import {
  resolveCorporateTemplatePageRoles,
  type CorporateTemplatePageRole
} from './corporate-template'
import type { DocumentPlanPageSkeletonItem, SourceDocumentPlan } from './generation'

export interface ConfirmedCorporatePagePlanItem {
  pageNumber: number
  role: CorporateTemplatePageRole
  title: string
  content: string
  editable: boolean
  sourceHeading?: string
  headingLevel?: number
  lineStart?: number
  lineEnd?: number
}

export interface ConfirmedCorporatePagePlan {
  version: 1
  totalPages: number
  includeAgenda: boolean
  items: ConfirmedCorporatePagePlanItem[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

const positiveInt = (value: unknown): number | null => {
  const number = Number(value)
  return Number.isFinite(number) && number >= 1 ? Math.floor(number) : null
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

const isCorporateRole = (value: unknown): value is CorporateTemplatePageRole =>
  value === 'cover' || value === 'agenda' || value === 'body' || value === 'closing'

const refreshAgendaContent = (
  items: ConfirmedCorporatePagePlanItem[]
): ConfirmedCorporatePagePlanItem[] => {
  const bodyTitles = items
    .filter((item) => item.role === 'body')
    .map((item) => item.title.trim())
    .filter(Boolean)
  return items.map((item) =>
    item.role === 'agenda'
      ? {
          ...item,
          title: '目录',
          content: bodyTitles.map((title, index) => `${index + 1}. ${title}`).join('\n'),
          editable: false
        }
      : item
  )
}

const pageItemFromSource = (
  item: DocumentPlanPageSkeletonItem,
  pageNumber: number
): ConfirmedCorporatePagePlanItem => ({
  pageNumber,
  role: 'body',
  title: item.title.trim() || `正文第 ${pageNumber} 页`,
  content: item.reason.trim(),
  editable: true,
  sourceHeading: item.sourceHeading,
  headingLevel: item.headingLevel,
  lineStart: item.lineStart,
  lineEnd: item.lineEnd
})

export const buildConfirmedCorporatePagePlan = (args: {
  topic: string
  requirements: string
  sourcePlan?: SourceDocumentPlan
  contentPageCount: number
  includeAgenda: boolean
}): ConfirmedCorporatePagePlan => {
  const fixedPageCount = 2 + (args.includeAgenda ? 1 : 0)
  const requestedContentPageCount = Math.max(
    1,
    Math.floor(args.contentPageCount || 1),
    args.sourcePlan?.pageSkeleton.length || 0
  )
  const totalPages = Math.min(MAX_CORPORATE_PAGE_COUNT, requestedContentPageCount + fixedPageCount)
  const roles = resolveCorporateTemplatePageRoles(totalPages, args.includeAgenda)
  let bodyIndex = 0
  const items = roles.map((role, index): ConfirmedCorporatePagePlanItem => {
    const pageNumber = index + 1
    if (role === 'cover') {
      return {
        pageNumber,
        role,
        title: args.topic.trim() || '参考资料汇报',
        content: args.requirements.trim(),
        editable: true
      }
    }
    if (role === 'agenda') {
      return {
        pageNumber,
        role,
        title: '目录',
        content: '',
        editable: false
      }
    }
    if (role === 'closing') {
      return {
        pageNumber,
        role,
        title: '结束页',
        content: '保持原模板文字、图片、位置和样式不变。',
        editable: false
      }
    }
    const sourceItem = args.sourcePlan?.pageSkeleton[bodyIndex]
    bodyIndex += 1
    return sourceItem
      ? pageItemFromSource(sourceItem, pageNumber)
      : {
          pageNumber,
          role,
          title: `正文第 ${bodyIndex} 页`,
          content:
            args.requirements.trim().slice(0, 800) ||
            '依据已解析参考资料提炼本页要点，不补写资料外信息。',
          editable: true
        }
  })
  return {
    version: 1,
    totalPages,
    includeAgenda: args.includeAgenda,
    items: refreshAgendaContent(items)
  }
}

export const updateConfirmedCorporatePagePlanItem = (
  plan: ConfirmedCorporatePagePlan,
  pageNumber: number,
  patch: Partial<Pick<ConfirmedCorporatePagePlanItem, 'title' | 'content'>>
): ConfirmedCorporatePagePlan => {
  const items = plan.items.map((item) =>
    item.pageNumber === pageNumber && item.editable ? { ...item, ...patch } : item
  )
  return {
    ...plan,
    items: refreshAgendaContent(items)
  }
}

export const normalizeConfirmedCorporatePagePlan = (
  value: unknown
): ConfirmedCorporatePagePlan | null => {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.items)) return null
  const totalPages = positiveInt(value.totalPages)
  if (!totalPages || totalPages > MAX_CORPORATE_PAGE_COUNT) return null
  const rawItems = value.items.slice(0, MAX_CORPORATE_PAGE_COUNT)
  if (rawItems.length !== totalPages) return null
  const items = rawItems
    .map((rawItem, index): ConfirmedCorporatePagePlanItem | null => {
      if (!isRecord(rawItem) || !isCorporateRole(rawItem.role)) return null
      const pageNumber = positiveInt(rawItem.pageNumber)
      if (pageNumber !== index + 1) return null
      const role = rawItem.role
      const title = text(rawItem.title)
      if (!title) return null
      const sourceHeading = text(rawItem.sourceHeading)
      const headingLevel = positiveInt(rawItem.headingLevel)
      const lineStart = positiveInt(rawItem.lineStart)
      const lineEnd = positiveInt(rawItem.lineEnd)
      return {
        pageNumber,
        role,
        title,
        content: text(rawItem.content),
        editable: role === 'cover' || role === 'body',
        ...(sourceHeading ? { sourceHeading } : {}),
        ...(headingLevel ? { headingLevel } : {}),
        ...(lineStart ? { lineStart } : {}),
        ...(lineEnd ? { lineEnd } : {})
      }
    })
    .filter((item): item is ConfirmedCorporatePagePlanItem => Boolean(item))
  if (items.length !== totalPages) return null
  return {
    version: 1,
    totalPages,
    includeAgenda: value.includeAgenda === true,
    items: refreshAgendaContent(items)
  }
}

export const validateConfirmedCorporatePagePlan = (
  plan: ConfirmedCorporatePagePlan,
  expectedRoles: CorporateTemplatePageRole[]
): string[] => {
  const errors: string[] = []
  if (plan.totalPages !== expectedRoles.length || plan.items.length !== expectedRoles.length) {
    errors.push(`确认计划为 ${plan.items.length} 页，但模板会话要求 ${expectedRoles.length} 页`)
    return errors
  }
  plan.items.forEach((item, index) => {
    const expectedRole = expectedRoles[index]
    if (item.pageNumber !== index + 1) {
      errors.push(`第 ${index + 1} 页编号不连续`)
    }
    if (item.role !== expectedRole) {
      errors.push(`第 ${index + 1} 页角色应为 ${expectedRole}，实际为 ${item.role}`)
    }
    if (!item.title.trim()) errors.push(`第 ${index + 1} 页标题不能为空`)
    if ((item.role === 'cover' || item.role === 'body') && !item.content.trim()) {
      errors.push(`第 ${index + 1} 页要求或要点不能为空`)
    }
  })
  return errors
}

export const sourcePlanFromConfirmedCorporatePagePlan = (
  confirmedPlan: ConfirmedCorporatePagePlan,
  originalSourcePlan?: SourceDocumentPlan
): SourceDocumentPlan | undefined => {
  if (!originalSourcePlan) return undefined
  const bodyItems = confirmedPlan.items.filter((item) => item.role === 'body')
  const pageSkeleton = bodyItems
    .map((item, index): DocumentPlanPageSkeletonItem | null => {
      const original = originalSourcePlan.pageSkeleton[index]
      const sourceHeading = item.sourceHeading || original?.sourceHeading
      const headingLevel = item.headingLevel || original?.headingLevel
      const lineStart = item.lineStart || original?.lineStart
      const lineEnd = item.lineEnd || original?.lineEnd
      if (!original || !sourceHeading || !headingLevel || !lineStart || !lineEnd) return null
      return {
        ...original,
        pageNumber: index + 1,
        title: item.title,
        reason: item.content,
        sourceHeading,
        headingLevel,
        lineStart,
        lineEnd
      }
    })
    .filter((item): item is DocumentPlanPageSkeletonItem => Boolean(item))
  if (pageSkeleton.length !== bodyItems.length) return undefined
  return {
    ...originalSourcePlan,
    pageSkeleton
  }
}
