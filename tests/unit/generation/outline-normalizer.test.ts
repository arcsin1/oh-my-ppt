import { describe, expect, it } from 'vitest'
import {
  MAX_KEY_POINTS_PER_SLIDE,
  normalizeKeyPoints,
  normalizeOutlineText
} from '../../../src/main/ipc/engine/outline-normalizer'

describe('outline normalizer', () => {
  it('preserves explicit one-slide topic lists beyond four items', () => {
    const outline = normalizeOutlineText(
      '一些名词、安全风险、AI 使用场景、用好AI的方法、个人场景分享、待办事项、设计方向'
    )

    expect(outline).toBe(
      '一些名词；安全风险；AI 使用场景；用好AI的方法；个人场景分享；待办事项；设计方向'
    )
  })

  it('keeps up to ten key points for a dense single slide plan', () => {
    const points = [
      '一些名词',
      '安全风险',
      'AI 使用场景',
      '用好AI的方法',
      '个人场景分享',
      '待办事项',
      '设计方向',
      '结尾互动',
      '备用主题',
      '案例延展',
      '超出上限'
    ]

    expect(normalizeKeyPoints(points)).toEqual(points.slice(0, MAX_KEY_POINTS_PER_SLIDE))
  })
})
