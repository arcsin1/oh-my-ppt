import { describe, expect, it } from 'vitest'
import {
  buildConfirmedCorporatePagePlan,
  sourcePlanFromConfirmedCorporatePagePlan,
  updateConfirmedCorporatePagePlanItem,
  validateConfirmedCorporatePagePlan
} from '../../../src/shared/confirmed-corporate-plan'
import { mapConfirmedCorporatePlanToOutlineItems } from '../../../src/main/ipc/generation/confirmed-corporate-plan'

const sourcePlan = {
  version: 1 as const,
  confidence: 'high' as const,
  sourceDocumentPath: '/source.md',
  sourceDocumentName: 'source.md',
  pageSkeleton: [
    {
      pageNumber: 1,
      title: '原始正文标题',
      role: 'content' as const,
      sourceHeading: '## PDF 第 1 页',
      headingLevel: 2,
      lineStart: 3,
      lineEnd: 18,
      reason: '原始事实一；原始事实二'
    }
  ]
}

describe('confirmed corporate page plan', () => {
  it('shows the complete default four-page structure before generation', () => {
    const plan = buildConfirmedCorporatePagePlan({
      topic: 'WorkBuddy 数据清洗',
      requirements: '严格依据上传资料',
      sourcePlan,
      contentPageCount: 1,
      includeAgenda: true
    })

    expect(plan.totalPages).toBe(4)
    expect(plan.items.map((item) => item.role)).toEqual(['cover', 'agenda', 'body', 'closing'])
    expect(plan.items.map((item) => item.editable)).toEqual([true, false, true, false])
    expect(
      validateConfirmedCorporatePagePlan(
        plan,
        plan.items.map((item) => item.role)
      )
    ).toEqual([])
  })

  it('uses edited body values verbatim, refreshes the agenda and preserves source ranges', () => {
    const initial = buildConfirmedCorporatePagePlan({
      topic: 'WorkBuddy 数据清洗',
      requirements: '严格依据上传资料',
      sourcePlan,
      contentPageCount: 1,
      includeAgenda: true
    })
    const edited = updateConfirmedCorporatePagePlanItem(initial, 3, {
      title: '用户确认后的清洗步骤',
      content: '识别空行；统一日期格式；复核异常记录'
    })

    expect(edited.items[1]).toMatchObject({
      role: 'agenda',
      content: '1. 用户确认后的清洗步骤'
    })
    const outlineItems = mapConfirmedCorporatePlanToOutlineItems(edited)
    expect(outlineItems[2]).toMatchObject({
      title: '用户确认后的清洗步骤',
      contentOutline: '识别空行；统一日期格式；复核异常记录'
    })
    expect(outlineItems[3]).toMatchObject({
      title: '结束页',
      contentOutline: ''
    })

    const syncedSourcePlan = sourcePlanFromConfirmedCorporatePagePlan(edited, sourcePlan)
    expect(syncedSourcePlan?.pageSkeleton[0]).toMatchObject({
      title: '用户确认后的清洗步骤',
      reason: '识别空行；统一日期格式；复核异常记录',
      sourceHeading: '## PDF 第 1 页',
      lineStart: 3,
      lineEnd: 18
    })
  })

  it('rejects a persisted plan whose page roles no longer match the template', () => {
    const plan = buildConfirmedCorporatePagePlan({
      topic: 'WorkBuddy 数据清洗',
      requirements: '严格依据上传资料',
      sourcePlan,
      contentPageCount: 1,
      includeAgenda: true
    })

    expect(
      validateConfirmedCorporatePagePlan(plan, ['cover', 'body', 'body', 'closing'])
    ).toContain('第 2 页角色应为 body，实际为 agenda')
  })

  it('keeps every editable body page confirmable when no source skeleton is available', () => {
    const plan = buildConfirmedCorporatePagePlan({
      topic: '图片资料汇报',
      requirements: '仅使用图片中可辨认的信息',
      contentPageCount: 2,
      includeAgenda: false
    })

    expect(plan.items.filter((item) => item.role === 'body').map((item) => item.content)).toEqual([
      '仅使用图片中可辨认的信息',
      '仅使用图片中可辨认的信息'
    ])
    expect(
      validateConfirmedCorporatePagePlan(
        plan,
        plan.items.map((item) => item.role)
      )
    ).toEqual([])
  })

  it('does not collapse the confirmed page count when a dense source yields fewer line ranges', () => {
    const plan = buildConfirmedCorporatePagePlan({
      topic: '密集资料汇报',
      requirements: '依据密集资料生成三个正文页',
      sourcePlan,
      contentPageCount: 3,
      includeAgenda: true
    })

    expect(plan.totalPages).toBe(6)
    expect(plan.items.filter((item) => item.role === 'body')).toHaveLength(3)
    expect(
      validateConfirmedCorporatePagePlan(
        plan,
        plan.items.map((item) => item.role)
      )
    ).toEqual([])
  })
})
