import { describe, expect, it } from 'vitest'

import {
  extractImpliedPageCount,
  normalizeGeneratedPlan
} from '../../../src/main/ipc/io/document-plan-normalizer'
import { buildRecoverableLocalDocumentPlan } from '../../../src/main/ipc/io/document-plan-fallback'

describe('document parse plan page count normalization', () => {
  it('uses English per-page entries when the model collapses pageCount to one', () => {
    const result = normalizeGeneratedPlan(
      JSON.stringify({
        topic: 'Product Launch Readiness Review',
        pageCount: 1,
        briefText: [
          'Presentation goal: Review launch readiness.',
          'Recommended outline:',
          '1. Context',
          '2. Market signal',
          '3. Product readiness',
          '4. GTM risks',
          '5. Timeline',
          '6. Decision points',
          'Per-page points:',
          'Page 1: Context',
          'Page 2: Market signal',
          'Page 3: Product readiness',
          'Page 4: GTM risks',
          'Page 5: Timeline',
          'Page 6: Decision points'
        ].join('\n')
      }),
      { topic: '', pageCount: null, briefText: '' }
    )

    expect(result.pageCount).toBe(6)
  })

  it('keeps an explicit user page count even when the outline has more entries', () => {
    const result = normalizeGeneratedPlan(
      JSON.stringify({
        topic: 'Product Launch Readiness Review',
        pageCount: 1,
        briefText: ['Recommended outline:', '1. Context', '2. Market signal'].join('\n')
      }),
      { topic: '', pageCount: 1, briefText: '' }
    )

    expect(result.pageCount).toBe(1)
  })

  it('counts English Page N labels in per-page sections', () => {
    expect(
      extractImpliedPageCount(['Per-page points:', 'Page 1: A', 'Page 2: B', 'Page 3: C'].join('\n'))
    ).toBe(3)
  })

  it('uses the deterministic preferred page count after two model underestimates', () => {
    const modelAttempts = [
      { topic: 'WorkBuddy 表格数据清洗', pageCount: 1, briefText: '' },
      { topic: 'WorkBuddy 表格数据清洗工具', pageCount: 1, briefText: '' }
    ]

    const fallback = buildRecoverableLocalDocumentPlan({
      lastCandidatePlan: modelAttempts[1],
      failureMessage: '模型返回 1 个正文页，低于资料合理下限 2 页',
      fallbackTopic: 'WorkBuddy太神了！表格数据1分钟清洗完，从此告别加班！',
      existingBrief: '',
      estimate: {
        preferredPageCount: 3,
        minPageCount: 2,
        maxPageCount: 4,
        basis: 'density'
      }
    })

    expect(modelAttempts).toHaveLength(2)
    expect(fallback).toMatchObject({
      plan: {
        topic: 'WorkBuddy 表格数据清洗工具',
        pageCount: 3
      },
      originalModelPageCount: 1
    })
  })

  it('does not locally accept an overlong model plan', () => {
    expect(
      buildRecoverableLocalDocumentPlan({
        lastCandidatePlan: { topic: '议案', pageCount: 7, briefText: '逐页内容' },
        failureMessage: '模型返回 7 个正文页，超过资料合理上限 5 页',
        fallbackTopic: '议案',
        existingBrief: '',
        estimate: {
          preferredPageCount: 4,
          minPageCount: 3,
          maxPageCount: 5,
          basis: 'density'
        }
      })
    ).toBeNull()
  })
})
