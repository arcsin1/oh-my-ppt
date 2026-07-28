import {
  isInternalDocumentPlanPageReason,
  type DocumentPlanPageSkeletonItem
} from '../../../shared/generation'
import {
  deriveOutlinePageCandidates,
  type DocumentOutlinePageCandidate,
  type DocumentOutlineScan
} from './document-outline-scan'

export const buildDocumentPlanPageSkeleton = (args: {
  scan: DocumentOutlineScan | null
  pageCandidates?: DocumentOutlinePageCandidate[]
  pageCount: number
}): DocumentPlanPageSkeletonItem[] => {
  if (!args.scan) return []
  const candidates = args.pageCandidates ?? deriveOutlinePageCandidates(args.scan)
  if (candidates.length === 0 || candidates.length !== args.pageCount) return []
  return candidates.map((candidate, index) => ({
    id: `page-${index + 1}`,
    pageNumber: index + 1,
    title: candidate.title,
    role: candidate.role,
    sourceHeading: candidate.sourceHeading,
    headingLevel: candidate.headingLevel,
    lineStart: candidate.lineStart,
    lineEnd: candidate.lineEnd,
    reason: candidate.reason
  }))
}

type SourceLineRange = {
  lineStart: number
  lineEnd: number
}

const countNonWhitespace = (value: string): number => value.replace(/\s/g, '').length

const splitLineRangeByDensity = (args: {
  sourceLines: string[]
  lineStart: number
  lineEnd: number
  pageCount: number
}): SourceLineRange[] => {
  const lineStart = Math.max(1, Math.floor(args.lineStart))
  const lineEnd = Math.min(args.sourceLines.length, Math.max(lineStart, Math.floor(args.lineEnd)))
  const availableLineCount = Math.max(1, lineEnd - lineStart + 1)
  const pageCount = Math.max(1, Math.min(availableLineCount, Math.floor(args.pageCount)))
  if (pageCount === 1) return [{ lineStart, lineEnd }]

  const weights = args.sourceLines
    .slice(lineStart - 1, lineEnd)
    .map((line) => countNonWhitespace(line))
  const cumulativeWeights: number[] = []
  weights.reduce((sum, weight) => {
    const next = sum + weight
    cumulativeWeights.push(next)
    return next
  }, 0)
  const totalWeight = cumulativeWeights[cumulativeWeights.length - 1] || availableLineCount
  const ranges: SourceLineRange[] = []
  let nextStartOffset = 0

  for (let pageIndex = 0; pageIndex < pageCount - 1; pageIndex += 1) {
    const remainingPages = pageCount - pageIndex - 1
    const maxEndOffset = availableLineCount - remainingPages - 1
    const desiredWeight = (totalWeight * (pageIndex + 1)) / pageCount
    let bestEndOffset = nextStartOffset
    let bestDistance = Number.POSITIVE_INFINITY
    for (let offset = nextStartOffset; offset <= maxEndOffset; offset += 1) {
      const observedWeight =
        cumulativeWeights[offset] || Math.round(((offset + 1) / availableLineCount) * totalWeight)
      const distance = Math.abs(observedWeight - desiredWeight)
      if (distance < bestDistance) {
        bestDistance = distance
        bestEndOffset = offset
      }
    }
    ranges.push({
      lineStart: lineStart + nextStartOffset,
      lineEnd: lineStart + bestEndOffset
    })
    nextStartOffset = bestEndOffset + 1
  }
  ranges.push({
    lineStart: lineStart + nextStartOffset,
    lineEnd
  })
  return ranges
}

const candidateCharacterCount = (
  sourceLines: string[],
  candidate: DocumentOutlinePageCandidate
): number =>
  countNonWhitespace(
    sourceLines
      .slice(Math.max(0, candidate.lineStart - 1), Math.max(candidate.lineStart, candidate.lineEnd))
      .join('\n')
  )

const allocateCandidatePages = (args: {
  sourceLines: string[]
  candidates: DocumentOutlinePageCandidate[]
  pageCount: number
}): number[] => {
  const allocations = args.candidates.map(() => 1)
  let remaining = Math.max(0, args.pageCount - args.candidates.length)
  const weights = args.candidates.map((candidate) =>
    Math.max(1, candidateCharacterCount(args.sourceLines, candidate))
  )
  while (remaining > 0) {
    let selectedIndex = 0
    let selectedScore = -1
    weights.forEach((weight, index) => {
      const score = weight / allocations[index]
      if (score > selectedScore) {
        selectedIndex = index
        selectedScore = score
      }
    })
    allocations[selectedIndex] += 1
    remaining -= 1
  }
  return allocations
}

const normalizeCandidateSegments = (
  candidates: DocumentOutlinePageCandidate[],
  totalLines: number
): DocumentOutlinePageCandidate[] =>
  candidates.map((candidate, index) => ({
    ...candidate,
    lineStart: index === 0 ? 1 : Math.max(1, candidate.lineStart),
    lineEnd:
      index === candidates.length - 1
        ? totalLines
        : Math.max(candidate.lineStart, candidates[index + 1].lineStart - 1)
  }))

const fallbackTitle = (scan: DocumentOutlineScan | null, sourceLines: string[]): string => {
  if (scan?.topLevelTitle?.trim()) return scan.topLevelTitle.trim()
  const firstContentLine = sourceLines
    .map((line) => line.replace(/^\s{0,3}#{1,6}\s+/, '').trim())
    .find(Boolean)
  return firstContentLine?.slice(0, 36).trim() || '参考资料'
}

const skeletonItem = (args: {
  pageNumber: number
  title: string
  role?: DocumentOutlinePageCandidate['role']
  sourceHeading: string
  headingLevel: number
  range: SourceLineRange
}): DocumentPlanPageSkeletonItem => ({
  id: `page-${args.pageNumber}`,
  pageNumber: args.pageNumber,
  title: args.title,
  role: args.role || 'content',
  sourceHeading: args.sourceHeading,
  headingLevel: args.headingLevel,
  lineStart: args.range.lineStart,
  lineEnd: args.range.lineEnd,
  reason: ''
})

export const buildDeterministicDocumentPlanPageSkeleton = (args: {
  scan: DocumentOutlineScan | null
  pageCandidates?: DocumentOutlinePageCandidate[]
  sourceText: string
  pageCount: number
}): DocumentPlanPageSkeletonItem[] => {
  if (!args.scan || !args.sourceText.trim()) return []
  const scan = args.scan
  const sourceLines = args.sourceText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const pageCount = Math.max(1, Math.floor(args.pageCount))
  const candidates = [...(args.pageCandidates ?? deriveOutlinePageCandidates(scan))]
    .filter((candidate) => candidate.lineEnd >= candidate.lineStart)
    .sort((left, right) => left.lineStart - right.lineStart)

  if (candidates.length === pageCount) {
    return buildDocumentPlanPageSkeleton({
      scan,
      pageCandidates: candidates,
      pageCount
    })
  }

  if (candidates.length > 0 && pageCount > candidates.length) {
    const segments = normalizeCandidateSegments(candidates, sourceLines.length)
    const allocations = allocateCandidatePages({
      sourceLines,
      candidates: segments,
      pageCount
    })
    const items: DocumentPlanPageSkeletonItem[] = []
    segments.forEach((candidate, candidateIndex) => {
      const ranges = splitLineRangeByDensity({
        sourceLines,
        lineStart: candidate.lineStart,
        lineEnd: candidate.lineEnd,
        pageCount: allocations[candidateIndex]
      })
      ranges.forEach((range, continuationIndex) => {
        items.push(
          skeletonItem({
            pageNumber: items.length + 1,
            title:
              continuationIndex === 0
                ? candidate.title
                : `${candidate.title}（续 ${continuationIndex + 1}）`,
            role: continuationIndex === 0 ? candidate.role : 'content',
            sourceHeading: candidate.sourceHeading,
            headingLevel: candidate.headingLevel,
            range
          })
        )
      })
    })
    return items
  }

  const ranges = splitLineRangeByDensity({
    sourceLines,
    lineStart: 1,
    lineEnd: sourceLines.length,
    pageCount
  })
  const defaultTitle = fallbackTitle(scan, sourceLines)
  return ranges.map((range, index) => {
    const candidate =
      candidates.find(
        (item) => item.lineStart >= range.lineStart && item.lineStart <= range.lineEnd
      ) || candidates.find((item) => item.lineStart <= range.lineEnd)
    return skeletonItem({
      pageNumber: index + 1,
      title:
        candidate?.title || (index === 0 ? defaultTitle : `${defaultTitle}（续 ${index + 1}）`),
      role: candidates.length === 1 && index === 0 ? candidates[0].role : 'content',
      sourceHeading: candidate?.sourceHeading || scan.topLevelTitle || defaultTitle,
      headingLevel: candidate?.headingLevel || 1,
      range
    })
  })
}

export const sanitizeDocumentPlanPageSkeletonContent = (args: {
  pageSkeleton: DocumentPlanPageSkeletonItem[]
}): DocumentPlanPageSkeletonItem[] => {
  return args.pageSkeleton.map((item) => ({
    ...item,
    reason: item.reason && !isInternalDocumentPlanPageReason(item.reason) ? item.reason : ''
  }))
}
