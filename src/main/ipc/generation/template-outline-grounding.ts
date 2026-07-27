import type { LayoutIntent } from '@shared/layout-intent'

type TemplateOutlineItem = {
  title: string
  contentOutline: string
  layoutIntent?: LayoutIntent
}

const PLACEHOLDER_METADATA_PATTERN =
  /^(?:(?:汇报|编制)?(?:日期|时间|部门|汇报部门|汇报人|姓名|负责人|编制人))\s*[:：]\s*(?:待定|未定|暂无|未提供|待补充|待填写|tbd|n\/a|-+)$/i

const UNSUPPORTED_OUTCOME_PATTERN =
  /(?:系统|工具|平台|软件).{0,8}(?:运行稳定|稳定运行)|用户反馈.{0,6}(?:积极|良好|满意)|核心功能.{0,6}(?:达标|通过)|(?:已|成功)(?:完成|实现|达成|通过|上线)/i

const compact = (value: string): string => value.replace(/\s+/g, '').trim()

export const sanitizeTemplateOutlineItem = (
  item: TemplateOutlineItem,
  options: {
    userMessage: string
    hasSourceDocuments: boolean
  }
): TemplateOutlineItem => {
  if (options.hasSourceDocuments) return item
  const compactUserMessage = compact(options.userMessage)
  const points = item.contentOutline
    .split(/[；;\n]+/)
    .map((point) => point.trim())
    .filter(Boolean)
    .filter((point) => {
      if (compactUserMessage.includes(compact(point))) return true
      if (PLACEHOLDER_METADATA_PATTERN.test(point)) return false
      if (UNSUPPORTED_OUTCOME_PATTERN.test(point)) return false
      return true
    })

  return {
    ...item,
    contentOutline: points.join('；')
  }
}
