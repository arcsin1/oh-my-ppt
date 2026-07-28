import type { ParsedDocumentPlanResult } from '@shared/generation'
import type { DocumentOutlinePageCountEstimate } from './document-outline-scan'
import { extractImpliedPageCount } from './document-plan-normalizer'

export class DocumentPlanQualityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DocumentPlanQualityError'
  }
}

export const assertDocumentPlanQuality = (args: {
  plan: Pick<ParsedDocumentPlanResult, 'pageCount' | 'briefText'>
  estimate: DocumentOutlinePageCountEstimate
  requireDetailedBrief: boolean
}): void => {
  if (args.plan.pageCount < args.estimate.minPageCount) {
    throw new DocumentPlanQualityError(
      `模型返回 ${args.plan.pageCount} 个正文页，低于资料合理下限 ${args.estimate.minPageCount} 页`
    )
  }
  if (args.plan.pageCount > args.estimate.maxPageCount) {
    throw new DocumentPlanQualityError(
      `模型返回 ${args.plan.pageCount} 个正文页，超过资料合理上限 ${args.estimate.maxPageCount} 页`
    )
  }
  if (!args.requireDetailedBrief) return

  const impliedPageCount = extractImpliedPageCount(args.plan.briefText)
  if (impliedPageCount < args.plan.pageCount) {
    throw new DocumentPlanQualityError(
      `逐页提纲仅覆盖 ${impliedPageCount} 页，少于建议的 ${args.plan.pageCount} 个正文页`
    )
  }
  const minimumBriefLength = Math.max(120, args.plan.pageCount * 50)
  if (args.plan.briefText.trim().length < minimumBriefLength) {
    throw new DocumentPlanQualityError(
      `总结过短，需为 ${args.plan.pageCount} 个正文页分别提供 2–4 条可核验要点`
    )
  }
}
