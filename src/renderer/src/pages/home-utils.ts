import { MAX_CORPORATE_PAGE_COUNT } from '@shared/brand.js'
import { resolveCorporateAgendaPreference } from '@shared/corporate-template.js'
import type { SourceDocumentPlan } from '@shared/generation'

export const DEFAULT_CORPORATE_PAGE_COUNT = 8

export const clampCorporatePageCount = (
  value: unknown,
  fallback = DEFAULT_CORPORATE_PAGE_COUNT
): number => {
  const numeric = Number(value)
  const resolved = Number.isFinite(numeric) ? numeric : fallback
  return Math.max(1, Math.min(MAX_CORPORATE_PAGE_COUNT, Math.floor(resolved)))
}

export const resolveRequestedPageCount = (
  brief: string,
  fallback = DEFAULT_CORPORATE_PAGE_COUNT
): number => {
  const match = brief.match(/(?:制作|生成|共|约)?\s*(\d{1,3})\s*页/)
  return clampCorporatePageCount(match?.[1], fallback)
}

export const buildCorporatePrompt = (args: {
  brief: string
  pageCount: number
  hasReferenceDocument?: boolean
  includeAgenda?: boolean
}): string =>
  [
    `围绕以下要求制作 ${clampCorporatePageCount(args.pageCount)} 页安居建业内部演示文稿：${args.brief}`,
    args.hasReferenceDocument
      ? '参考资料及其逐页内容骨架已附加到当前项目；只使用资料中可核验的事实，不得臆造缺失内容。'
      : '',
    '必须严格沿用已复制的安居建业标准模板结构、公司标识、红橙黄波浪、页码和“内部文件 请勿外传”页脚。',
    args.includeAgenda
      ? '页面角色固定为：第1页封面、第2页目录、最后1页原模板结束页；其余页面全部使用正文页模板。'
      : '页面角色固定为：第1页封面、最后1页原模板结束页；不生成目录，其余页面全部使用正文页模板。',
    '原模板结束页必须保持原样，不修改任何文字、图片、位置或样式。',
    '使用自然、专业、适合内部汇报的中文，不虚构数据、结论或来源。'
  ]
    .filter(Boolean)
    .join('\n')

export const shouldIncludeCorporateAgenda = (args: {
  brief: string
  sourcePlan?: SourceDocumentPlan
}): boolean =>
  resolveCorporateAgendaPreference({
    brief: args.brief,
    sourceTitles: args.sourcePlan?.pageSkeleton.map((page) => page.title)
  })
