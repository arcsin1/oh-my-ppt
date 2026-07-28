import { describe, expect, it } from 'vitest'
import { scanDocumentOutline } from '../../../src/main/ipc/io/document-outline-scan'
import {
  buildDocumentPlanPageSkeleton,
  buildDeterministicDocumentPlanPageSkeleton,
  sanitizeDocumentPlanPageSkeletonContent
} from '../../../src/main/ipc/io/document-plan-page-skeleton'

describe('document plan page skeleton', () => {
  it('derives an authoritative skeleton only when source candidates match the plan count', () => {
    const scan = scanDocumentOutline(
      [
        '# Source Manual',
        '',
        '## Market',
        'Market details.',
        '',
        '## Execution',
        'Execution details.'
      ].join('\n')
    )

    const skeleton = buildDocumentPlanPageSkeleton({
      scan,
      pageCount: 2
    })

    expect(skeleton).toHaveLength(2)
    expect(skeleton[0]).toMatchObject({
      id: 'page-1',
      pageNumber: 1,
      title: 'Market',
      sourceHeading: '## Market',
      lineStart: 3
    })
    expect(
      buildDocumentPlanPageSkeleton({
        scan,
        pageCount: 1
      })
    ).toEqual([])
    expect(
      buildDocumentPlanPageSkeleton({
        scan,
        pageCount: 2
      })
    ).toHaveLength(2)
  })

  it('keeps LLM summaries as skeleton reasons', () => {
    const skeleton = [
      {
        pageNumber: 1,
        title: '市场洞察',
        role: 'content' as const,
        sourceHeading: '## 市场洞察',
        headingLevel: 2,
        lineStart: 3,
        lineEnd: 18,
        reason: '说明市场增长信号和关键机会。'
      }
    ]

    const sanitized = sanitizeDocumentPlanPageSkeletonContent({
      pageSkeleton: skeleton
    })

    expect(sanitized[0].reason).toBe('说明市场增长信号和关键机会。')
  })

  it('drops internal scanner reasons when no model page purpose is available', () => {
    const skeleton = [
      {
        pageNumber: 1,
        title: 'Execution',
        role: 'content' as const,
        sourceHeading: '## Execution',
        headingLevel: 2,
        lineStart: 3,
        lineEnd: 18,
        reason: 'leaf ## section without standalone child sections'
      }
    ]

    const sanitized = sanitizeDocumentPlanPageSkeletonContent({
      pageSkeleton: skeleton
    })

    expect(sanitized[0].reason).toBe('')
  })

  it('splits one dense physical PDF page into continuous non-overlapping source ranges', () => {
    const source = [
      '# WorkBuddy 表格清洗',
      '',
      '## PDF 第 1 页',
      '第一部分介绍原始表格存在空行、合并单元格和日期格式不一致。'.repeat(12),
      '',
      '第二部分说明先识别字段，再统一类型并保留原始数据。'.repeat(12),
      '',
      '第三部分列出复核步骤、异常记录和导出要求。'.repeat(12)
    ].join('\n')
    const scan = scanDocumentOutline(source)
    const skeleton = buildDeterministicDocumentPlanPageSkeleton({
      scan,
      sourceText: source,
      pageCount: 3
    })

    expect(skeleton).toHaveLength(3)
    expect(skeleton.map((item) => [item.lineStart, item.lineEnd])).toEqual([
      [1, 4],
      [5, 6],
      [7, 8]
    ])
    expect(skeleton.every((item) => item.sourceHeading === '## PDF 第 1 页')).toBe(true)
    expect(skeleton[0].title).toBe('PDF 第 1 页')
    expect(skeleton[1].title).toContain('续')
  })

  it('builds editable ranges for a dense source without headings', () => {
    const source = [
      '项目背景与现状。'.repeat(30),
      '',
      '实施方案与责任分工。'.repeat(30),
      '',
      '风险控制与后续安排。'.repeat(30)
    ].join('\n')
    const skeleton = buildDeterministicDocumentPlanPageSkeleton({
      scan: scanDocumentOutline(source, 'text'),
      sourceText: source,
      pageCount: 2
    })

    expect(skeleton).toHaveLength(2)
    expect(skeleton[0].lineStart).toBe(1)
    expect(skeleton[0].lineEnd + 1).toBe(skeleton[1].lineStart)
    expect(skeleton[1].lineEnd).toBe(source.split('\n').length)
  })
})
