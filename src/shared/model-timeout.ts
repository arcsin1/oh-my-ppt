export const DEFAULT_SHORT_MODEL_TIMEOUT_MS = 5 * 60_000
export const DEFAULT_MODEL_TIMEOUT_MS = 10 * 60_000
export const MIN_MODEL_TIMEOUT_MS = 60_000
export const MAX_MODEL_TIMEOUT_MS = 60 * 60_000

export type ModelTimeoutProfile = 'verify' | 'planning' | 'design' | 'agent' | 'document'
export type ConfigurableModelTimeoutProfile = Exclude<ModelTimeoutProfile, 'verify'>
export const MODEL_TIMEOUT_PROFILES: readonly ModelTimeoutProfile[] = [
  'verify',
  'planning',
  'design',
  'agent',
  'document'
]
export const CONFIGURABLE_MODEL_TIMEOUT_PROFILES: readonly ConfigurableModelTimeoutProfile[] = [
  'planning',
  'design',
  'agent',
  'document'
]

const PROFILE_DEFAULT_TIMEOUT_MS: Record<ModelTimeoutProfile, number> = {
  verify: 60_000,
  planning: DEFAULT_SHORT_MODEL_TIMEOUT_MS,
  design: DEFAULT_SHORT_MODEL_TIMEOUT_MS,
  // 推理型网关模型在工具调用前会流式输出 reasoning_content（且可能忽略
  // thinking 禁用参数），单页写入轮次经常超过 10 分钟，故 agent 默认放宽到 20 分钟。
  agent: 20 * 60_000,
  document: DEFAULT_MODEL_TIMEOUT_MS
}

const PROFILE_MIN_TIMEOUT_MS: Record<ModelTimeoutProfile, number> = {
  verify: 30_000,
  planning: 2 * 60_000,
  design: 2 * 60_000,
  agent: 5 * 60_000,
  document: 5 * 60_000
}

const PROFILE_MAX_TIMEOUT_MS: Record<ModelTimeoutProfile, number> = {
  verify: 2 * 60_000,
  planning: MAX_MODEL_TIMEOUT_MS,
  design: MAX_MODEL_TIMEOUT_MS,
  agent: MAX_MODEL_TIMEOUT_MS,
  document: MAX_MODEL_TIMEOUT_MS
}

export function normalizeModelTimeoutMs(value: unknown): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN
  if (!Number.isFinite(numeric)) return DEFAULT_MODEL_TIMEOUT_MS
  const integer = Math.round(numeric)
  return Math.max(MIN_MODEL_TIMEOUT_MS, Math.min(MAX_MODEL_TIMEOUT_MS, integer))
}

export function resolveModelTimeoutMs(
  value: unknown,
  profile: ModelTimeoutProfile = 'agent'
): number {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value)
        : Number.NaN
  const fallback = PROFILE_DEFAULT_TIMEOUT_MS[profile]
  const integer = Number.isFinite(numeric) ? Math.round(numeric) : fallback
  return Math.max(
    PROFILE_MIN_TIMEOUT_MS[profile],
    Math.min(PROFILE_MAX_TIMEOUT_MS[profile], integer)
  )
}

export function defaultModelTimeoutMs(profile: ModelTimeoutProfile): number {
  return PROFILE_DEFAULT_TIMEOUT_MS[profile]
}

export function normalizeModelTimeoutSeconds(value: unknown): number {
  return Math.round(normalizeModelTimeoutMs(Number(value) * 1000) / 1000)
}

export function modelTimeoutMsToSeconds(
  value: unknown,
  profile: ModelTimeoutProfile = 'agent'
): number {
  return Math.round(resolveModelTimeoutMs(value, profile) / 1000)
}
