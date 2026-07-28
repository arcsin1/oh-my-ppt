import type { ParsedDocumentPlanResult } from '@shared/generation'
import type { DocumentOutlinePageCountEstimate } from './document-outline-scan'

type DocumentPlan = Pick<ParsedDocumentPlanResult, 'topic' | 'pageCount' | 'briefText'>

const RECOVERABLE_LOCAL_PLAN_FAILURE =
  /合理下限|逐页提纲|总结过短|page candidate skeleton|source-structure page-count estimate/i

export const isRecoverableLocalDocumentPlanFailure = (message: string): boolean =>
  RECOVERABLE_LOCAL_PLAN_FAILURE.test(message) && !/合理上限/i.test(message)

export const buildRecoverableLocalDocumentPlan = (args: {
  lastCandidatePlan: DocumentPlan | null
  failureMessage: string
  fallbackTopic: string
  existingBrief: string
  estimate: DocumentOutlinePageCountEstimate
}): {
  plan: DocumentPlan
  originalModelPageCount: number | null
  fallbackReason: string
} | null => {
  if (!isRecoverableLocalDocumentPlanFailure(args.failureMessage)) return null

  const candidate = args.lastCandidatePlan
  return {
    plan: {
      topic: candidate?.topic.trim() || args.fallbackTopic.trim() || '参考资料',
      pageCount: args.estimate.preferredPageCount,
      briefText: candidate?.briefText.trim() || args.existingBrief.trim()
    },
    originalModelPageCount: candidate?.pageCount ?? null,
    fallbackReason: args.failureMessage
  }
}
