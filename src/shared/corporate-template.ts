export type CorporateTemplatePageRole = 'cover' | 'agenda' | 'body' | 'closing'

export const resolveCorporateTemplatePageRoles = (
  totalPages: number,
  includeAgenda: boolean
): CorporateTemplatePageRole[] => {
  const pageCount = Math.max(1, Math.floor(totalPages))
  if (pageCount === 1) return ['cover']
  if (pageCount === 2) return ['cover', 'closing']

  const middlePageCount = pageCount - 2
  const middleRoles: CorporateTemplatePageRole[] = Array.from(
    { length: middlePageCount },
    () => 'body'
  )
  if (includeAgenda) middleRoles[0] = 'agenda'
  return ['cover', ...middleRoles, 'closing']
}

export const resolveCorporateAgendaPreference = (args: {
  brief?: string | null
  sourceTitles?: string[]
}): boolean => {
  const brief = String(args.brief || '').trim()
  const explicitExclusion =
    /(?:不要|不需要|无需|省略|取消|不含|不包含|不设置|不生成).{0,6}(?:目录|议程)|(?:目录|议程).{0,6}(?:不要|不需要|无需|省略|取消)/i
  if (explicitExclusion.test(brief)) return false

  if (
    (args.sourceTitles || []).some((title) =>
      /^(?:目录|议程|内容提要|汇报提纲)(?:页)?$/i.test(String(title || '').trim())
    )
  ) {
    return true
  }

  return (
    /(?:包含|包括|需要|添加|增加|生成|保留|设置|安排|使用|带上?).{0,6}(?:目录|议程)(?:页)?/i.test(
      brief
    ) ||
    /(?:^|[\s,，;；:：])(?:\d+[、.)）]?\s*)?(?:目录|议程)(?:页)?(?=$|[\s,，;；:：])/i.test(
      brief
    )
  )
}
