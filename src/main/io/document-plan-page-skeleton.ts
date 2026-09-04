import {
  isInternalDocumentPlanPageReason,
  type DocumentPlanPageSkeletonItem
} from '../../shared/generation'
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
    reason: candidate.reason,
    agendaItems: candidate.agendaItems
  }))
}

export const sanitizeDocumentPlanPageSkeletonContent = (args: {
  pageSkeleton: DocumentPlanPageSkeletonItem[]
}): DocumentPlanPageSkeletonItem[] => {
  return args.pageSkeleton.map((item) => ({
    ...item,
    reason: item.reason && !isInternalDocumentPlanPageReason(item.reason) ? item.reason : ''
  }))
}
