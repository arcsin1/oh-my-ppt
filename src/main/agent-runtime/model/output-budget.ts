/**
 * 页面写入轮次（deck 生成 / 整页与 deck 编辑 / selector 编辑）的输出预算下限。
 *
 * 背景：网关推理型模型会在工具调用前流式输出 reasoning_content，且可能忽略
 * thinking 禁用参数（实测 finish_reason=length 时 reasoning 已耗尽全部预算，
 * update_*_page_file 工具调用从未发出）。页面片段 + 思考输出在 4096 预算下
 * 必然截断，因此 agent 链路的输出预算至少要给到配置允许的上限一档。
 */
export const AGENT_MIN_OUTPUT_TOKENS = 16384

export function resolveAgentOutputBudget(maxTokens?: number): number {
  const configured = maxTokens && maxTokens > 0 ? Math.floor(maxTokens) : 0
  return Math.max(configured, AGENT_MIN_OUTPUT_TOKENS)
}
