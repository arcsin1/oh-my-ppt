import path from 'path'
import type { SourceDocumentPlan } from '@shared/generation'

const MAX_THINKING_PAGE_OUTLINE_CHARS = 520
const MAX_THINKING_PAGE_KEY_POINTS = 10

const compactThinkingOutlineText = (value: string): string => value.replace(/\s+/g, ' ').trim()

const readThinkingPageField = (blockLines: string[], field: string): string => {
  const pattern = new RegExp(`^-\\s*${field}\\s*:`, 'i')
  return (
    blockLines
      .find((line) => pattern.test(line.trim()))
      ?.replace(pattern, '')
      .trim() || ''
  )
}

export const buildThinkingPageOutline = (blockLines: string[]): string => {
  const objective = readThinkingPageField(blockLines, 'Objective')
  const summaryLines: string[] = []
  const keyPointLines: string[] = []
  let collectingSummary = false

  for (const rawLine of blockLines) {
    const line = rawLine.trim()
    if (!line) {
      collectingSummary = false
      continue
    }
    if (/^-\s*(Role|Objective)\s*:/i.test(line)) continue
    if (/^-\s+/.test(line)) {
      keyPointLines.push(line.replace(/^-\s+/, '').trim())
      collectingSummary = false
      continue
    }
    if (!collectingSummary && summaryLines.length > 0) continue
    summaryLines.push(line)
    collectingSummary = true
  }

  const parts = [
    objective,
    compactThinkingOutlineText(summaryLines.join(' ')),
    ...keyPointLines.slice(0, MAX_THINKING_PAGE_KEY_POINTS).map(compactThinkingOutlineText)
  ].filter(Boolean)

  return compactThinkingOutlineText(parts.join('；')).slice(0, MAX_THINKING_PAGE_OUTLINE_CHARS)
}

export function buildThinkingSourcePlan(
  thinkingMd: string,
  thinkingDocumentPath: string
): SourceDocumentPlan | null {
  const lines = thinkingMd.split(/\r?\n/)
  const headings: Array<{ pageNumber: number; title: string; lineNumber: number }> = []

  lines.forEach((line, index) => {
    const match = line.match(/^##\s*Page\s+(\d+)\s*:\s*(.+)$/)
    if (!match) return
    const pageNumber = Number.parseInt(match[1], 10)
    const title = match[2].trim()
    if (!Number.isFinite(pageNumber) || !title) return
    headings.push({ pageNumber, title, lineNumber: index + 1 })
  })

  if (headings.length === 0) return null

  return {
    version: 1,
    confidence: 'high',
    sourceDocumentPath: thinkingDocumentPath,
    sourceDocumentName: path.basename(thinkingDocumentPath),
    pageSkeleton: headings.map((heading, index) => {
      const next = headings[index + 1]
      const lineStart = heading.lineNumber
      const lineEnd = Math.max(lineStart, next ? next.lineNumber - 1 : lines.length)
      const blockLines = lines.slice(heading.lineNumber, lineEnd)
      const roleText = readThinkingPageField(blockLines, 'Role')
      const pageOutline = buildThinkingPageOutline(blockLines)
      const roleBasis = `${heading.title}\n${roleText}`
      const role = /chapter|section|divider|cover|title|agenda|章节|过渡|封面|目录|标题/i.test(
        roleBasis
      )
        ? 'chapter-divider'
        : 'content'

      return {
        pageNumber: heading.pageNumber,
        title: heading.title,
        role,
        sourceHeading: `Page ${heading.pageNumber}: ${heading.title}`,
        headingLevel: 2,
        lineStart,
        lineEnd,
        reason: pageOutline || roleText || 'Thinking page section'
      }
    })
  }
}
