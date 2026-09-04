export type StyleCaseItem = {
  styleCase?: string
}

export type StyleCaseOption = {
  label: string
  count: number
}

export function parseStyleCases(styleCase?: string): string[] {
  if (!styleCase) return []
  return Array.from(
    new Set(
      styleCase
        .split(/[、,，;；\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

export function buildStyleCaseOptions(items: StyleCaseItem[]): StyleCaseOption[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    for (const styleCase of parseStyleCases(item.styleCase)) {
      counts.set(styleCase, (counts.get(styleCase) || 0) + 1)
    }
  }

  return Array.from(counts, ([label, count]) => ({ label, count })).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN')
  )
}

export function filterByStyleCase<T extends StyleCaseItem>(items: T[], styleCase: string): T[] {
  if (!styleCase) return items
  return items.filter((item) => parseStyleCases(item.styleCase).includes(styleCase))
}

export type StyleSearchItem = {
  label?: string
  description?: string
  styleCase?: string
  imageGenerationPrompt?: string
}

/** 按关键词模糊过滤风格（匹配名称、描述、用途和生图能力）。空关键词返回全部。 */
export function filterByStyleKeyword<T extends StyleSearchItem>(items: T[], query: string): T[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return items
  return items.filter((item) =>
    [
      item.label,
      item.description,
      item.styleCase,
      item.imageGenerationPrompt,
      item.imageGenerationPrompt ? '支持生图 可生图 配图 image generation illustration' : ''
    ]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .join(' ')
      .toLowerCase()
      .includes(keyword)
  )
}
