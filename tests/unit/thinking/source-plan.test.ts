import { describe, expect, it } from 'vitest'
import {
  buildThinkingPageOutline,
  buildThinkingSourcePlan
} from '../../../src/main/thinking/source-plan'

describe('thinking source plan', () => {
  it('returns null when thinking.md has no page headings', () => {
    const sourcePlan = buildThinkingSourcePlan(
      ['# Thinking Brief', '', '## Topic', '只有主题，没有页面'].join('\n'),
      '/tmp/thinking.md'
    )

    expect(sourcePlan).toBeNull()
  })

  it('builds compact range-bound skeletons for 100-page thinking briefs', () => {
    const pages = Array.from({ length: 100 }, (_, index) => {
      const pageNumber = index + 1
      return [
        `## Page ${pageNumber}: 第 ${pageNumber} 页主题`,
        '- Role: content',
        `- Objective: 说明第 ${pageNumber} 页的核心任务`,
        '',
        `这一页总结第 ${pageNumber} 个主题的关键背景、判断和行动方向。`,
        '',
        `- 保留第 ${pageNumber} 页的事实边界`,
        `- 展开第 ${pageNumber} 页的关键论据`,
        `- 给出第 ${pageNumber} 页的表达重点`
      ].join('\n')
    })
    const thinkingMd = ['# Thinking Brief', '## Topic', '百页方案', '', ...pages].join('\n')

    const sourcePlan = buildThinkingSourcePlan(thinkingMd, '/tmp/thinking.md')

    expect(sourcePlan?.pageSkeleton).toHaveLength(100)
    expect(sourcePlan?.pageSkeleton[0]).toMatchObject({
      pageNumber: 1,
      title: '第 1 页主题',
      sourceHeading: 'Page 1: 第 1 页主题'
    })
    expect(sourcePlan?.pageSkeleton[99]).toMatchObject({
      pageNumber: 100,
      title: '第 100 页主题'
    })
    for (const item of sourcePlan?.pageSkeleton ?? []) {
      expect(item.lineEnd).toBeGreaterThanOrEqual(item.lineStart)
      expect(item.reason).toContain(`第 ${item.pageNumber} 页`)
      expect(item.reason.length).toBeLessThanOrEqual(520)
    }
  })

  it('keeps summary and key points in a bounded page outline', () => {
    const outline = buildThinkingPageOutline([
      '- Role: content',
      '- Objective: 建立核心判断',
      '',
      '总结第一句。',
      '总结第二句。',
      '',
      '- 关键点一',
      '- 关键点二',
      '- 关键点三',
      '- 关键点四',
      '- 关键点五',
      '- 关键点六',
      '- 关键点七',
      '- 关键点八',
      '- 关键点九',
      '- 关键点十',
      '- 关键点十一'
    ])

    expect(outline).toContain('建立核心判断')
    expect(outline).toContain('总结第一句。 总结第二句。')
    expect(outline).toContain('关键点十')
    expect(outline).not.toContain('关键点十一')
    expect(outline.length).toBeLessThanOrEqual(520)
  })
})
