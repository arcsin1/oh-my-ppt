import { describe, expect, it } from 'vitest'
import {
  resolveCorporateAgendaPreference,
  resolveCorporateTemplatePageRoles
} from '../../../src/shared/corporate-template'

describe('安居建业模板页面角色', () => {
  it('无目录时所有中间页都使用正文模板', () => {
    expect(resolveCorporateTemplatePageRoles(5, false)).toEqual([
      'cover',
      'body',
      'body',
      'body',
      'closing'
    ])
  })

  it('明确需要目录时只把第二页设为目录', () => {
    expect(resolveCorporateTemplatePageRoles(6, true)).toEqual([
      'cover',
      'agenda',
      'body',
      'body',
      'body',
      'closing'
    ])
  })

  it('目录默认不启用，只响应明确要求或来源提纲', () => {
    expect(
      resolveCorporateAgendaPreference({
        brief: '制作5页验收汇报：封面、目标、功能、风险、结束页'
      })
    ).toBe(false)
    expect(resolveCorporateAgendaPreference({ brief: '制作8页汇报，增加一页目录' })).toBe(true)
    expect(resolveCorporateAgendaPreference({ brief: '制作8页汇报，不需要目录页' })).toBe(false)
    expect(
      resolveCorporateAgendaPreference({
        brief: '根据附件制作汇报',
        sourceTitles: ['封面', '目录', '项目背景']
      })
    ).toBe(true)
  })
})
