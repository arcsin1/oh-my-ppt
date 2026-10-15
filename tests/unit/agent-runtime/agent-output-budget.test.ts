import { describe, expect, it } from 'vitest'
import { AGENT_MIN_OUTPUT_TOKENS, resolveAgentOutputBudget } from '../../../src/main/agent-runtime/model/output-budget'

// 回归背景：网关推理型模型在工具调用前流式输出 reasoning_content，且可能忽略
// thinking 禁用参数。4096 输出预算会在思考阶段耗尽（finish_reason=length），
// update_*_page_file 工具调用从未发出，页面生成全部以「页面未写入」失败。
// agent 链路（deck 生成 / 整页与 deck 编辑 / selector 编辑）的输出预算因此
// 必须有 16384 下限。

describe('resolveAgentOutputBudget', () => {
  it('raises small configured budgets to the agent minimum', () => {
    expect(resolveAgentOutputBudget(4096)).toBe(AGENT_MIN_OUTPUT_TOKENS)
    expect(AGENT_MIN_OUTPUT_TOKENS).toBe(16384)
  })

  it('keeps budgets already at or above the minimum', () => {
    expect(resolveAgentOutputBudget(16384)).toBe(16384)
    expect(resolveAgentOutputBudget(32768)).toBe(32768)
  })

  it('falls back to the minimum for unset or invalid values', () => {
    expect(resolveAgentOutputBudget(undefined)).toBe(AGENT_MIN_OUTPUT_TOKENS)
    expect(resolveAgentOutputBudget(0)).toBe(AGENT_MIN_OUTPUT_TOKENS)
    expect(resolveAgentOutputBudget(-1)).toBe(AGENT_MIN_OUTPUT_TOKENS)
  })
})
