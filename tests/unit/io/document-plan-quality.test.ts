import { describe, expect, it } from 'vitest'
import { assertDocumentPlanQuality } from '../../../src/main/ipc/io/document-plan-quality'

describe('document plan quality gate', () => {
  const estimate = {
    preferredPageCount: 4,
    minPageCount: 3,
    maxPageCount: 5,
    basis: 'about 2800 non-whitespace characters'
  }

  it('rejects a one-page plan below the source-density lower bound', () => {
    expect(() =>
      assertDocumentPlanQuality({
        plan: { pageCount: 1, briefText: '项目议案概述。' },
        estimate,
        requireDetailedBrief: true
      })
    ).toThrow('合理下限')
  })

  it('rejects a short brief without a complete per-page outline', () => {
    expect(() =>
      assertDocumentPlanQuality({
        plan: { pageCount: 4, briefText: '项目议案主要介绍背景、目标和计划。' },
        estimate,
        requireDetailedBrief: true
      })
    ).toThrow('逐页提纲')
  })
})
