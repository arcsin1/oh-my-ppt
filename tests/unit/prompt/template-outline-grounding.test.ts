import { describe, expect, it } from 'vitest'
import { sanitizeTemplateOutlineItem } from '../../../src/main/ipc/generation/template-outline-grounding'

describe('模板规划结果事实过滤', () => {
  it('removes invented placeholder metadata and unsupported outcome claims without sources', () => {
    const sanitized = sanitizeTemplateOutlineItem(
      {
        title: '安居建业PPT助手试运行验收',
        contentOutline:
          '内部文件 请勿外传；日期：待定；部门：待定；系统运行稳定；试运行验收报告',
        layoutIntent: 'cover'
      },
      {
        userMessage: '不要虚构日期、部门或已完成结论。',
        hasSourceDocuments: false
      }
    )

    expect(sanitized.contentOutline).toBe('内部文件 请勿外传；试运行验收报告')
  })

  it('keeps concrete facts explicitly supplied by the user', () => {
    const sanitized = sanitizeTemplateOutlineItem(
      {
        title: '封面',
        contentOutline: '日期：2026年7月；部门：信息技术部',
        layoutIntent: 'cover'
      },
      {
        userMessage: '封面写日期：2026年7月；部门：信息技术部',
        hasSourceDocuments: false
      }
    )

    expect(sanitized.contentOutline).toBe('日期：2026年7月；部门：信息技术部')
  })
})
