export const MAX_KEY_POINTS_PER_SLIDE = 10
export const MAX_OUTLINE_TEXT_CHUNKS = 10
export const MAX_OUTLINE_TEXT_LENGTH = 260
export const MAX_KEY_POINT_LENGTH = 32

export const normalizeOutlineText = (raw: string): string => {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  // Prefer compact clause-style outline to reduce downstream prompt bloat while preserving explicit user lists.
  const chunks = text
    .split(/[；;。.!?\n、,，|/]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  const compact = (
    chunks.length > 0 ? chunks.slice(0, MAX_OUTLINE_TEXT_CHUNKS).join('；') : text
  ).trim()
  if (compact.length <= MAX_OUTLINE_TEXT_LENGTH) return compact
  return `${compact.slice(0, MAX_OUTLINE_TEXT_LENGTH).trimEnd()}…`
}

export const normalizeKeyPoints = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_KEY_POINTS_PER_SLIDE)
    .map((item) =>
      item.length > MAX_KEY_POINT_LENGTH ? `${item.slice(0, MAX_KEY_POINT_LENGTH).trimEnd()}…` : item
    )
}
