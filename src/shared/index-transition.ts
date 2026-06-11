export const INDEX_TRANSITION_TYPES = [
  'none',
  'fade',
  'slide-left',
  'slide-up',
  'push',
  'wipe',
  'zoom',
  'flip',
  'stack',
  'rotate',
  'cube',
  'cover-flow',
  'blur',
  'iris',
  'swing',
  'center-reveal'
] as const

export type IndexTransitionType = (typeof INDEX_TRANSITION_TYPES)[number]

export interface IndexTransitionConfig {
  type: IndexTransitionType
  durationMs: number
}

export const DEFAULT_INDEX_TRANSITION_CONFIG: IndexTransitionConfig = {
  type: 'fade',
  durationMs: 600
}

export const INDEX_TRANSITION_PRESETS: ReadonlyArray<
  IndexTransitionConfig & { labelKey: string }
> = [
  { type: 'none', durationMs: 0, labelKey: 'sessionDetail.indexTransitionNone' },
  { type: 'fade', durationMs: 600, labelKey: 'sessionDetail.indexTransitionFade' },
  { type: 'slide-left', durationMs: 560, labelKey: 'sessionDetail.indexTransitionSlideLeft' },
  { type: 'slide-up', durationMs: 560, labelKey: 'sessionDetail.indexTransitionSlideUp' },
  { type: 'push', durationMs: 600, labelKey: 'sessionDetail.indexTransitionPush' },
  { type: 'wipe', durationMs: 600, labelKey: 'sessionDetail.indexTransitionWipe' },
  { type: 'zoom', durationMs: 580, labelKey: 'sessionDetail.indexTransitionZoom' },
  { type: 'flip', durationMs: 680, labelKey: 'sessionDetail.indexTransitionFlip' },
  { type: 'stack', durationMs: 640, labelKey: 'sessionDetail.indexTransitionStack' },
  { type: 'rotate', durationMs: 660, labelKey: 'sessionDetail.indexTransitionRotate' },
  { type: 'cube', durationMs: 720, labelKey: 'sessionDetail.indexTransitionCube' },
  { type: 'cover-flow', durationMs: 720, labelKey: 'sessionDetail.indexTransitionCoverFlow' },
  { type: 'blur', durationMs: 640, labelKey: 'sessionDetail.indexTransitionBlur' },
  { type: 'iris', durationMs: 720, labelKey: 'sessionDetail.indexTransitionIris' },
  { type: 'swing', durationMs: 700, labelKey: 'sessionDetail.indexTransitionSwing' },
  { type: 'center-reveal', durationMs: 680, labelKey: 'sessionDetail.indexTransitionCenterReveal' }
]

export function isIndexTransitionType(value: unknown): value is IndexTransitionType {
  return INDEX_TRANSITION_TYPES.includes(value as IndexTransitionType)
}

export function normalizeIndexTransitionType(value: unknown): IndexTransitionType {
  return isIndexTransitionType(value) ? value : DEFAULT_INDEX_TRANSITION_CONFIG.type
}

export function defaultDurationForIndexTransition(type: IndexTransitionType): number {
  return (
    INDEX_TRANSITION_PRESETS.find((preset) => preset.type === type)?.durationMs ??
    DEFAULT_INDEX_TRANSITION_CONFIG.durationMs
  )
}

export function clampIndexTransitionDuration(
  type: IndexTransitionType,
  value: unknown
): number {
  if (type === 'none') return 0
  const numericValue = Number(value)
  if (!Number.isFinite(numericValue)) return defaultDurationForIndexTransition(type)
  return Math.max(120, Math.min(1200, Math.round(numericValue)))
}

export function normalizeIndexTransitionConfig(value: {
  type?: unknown
  durationMs?: unknown
}): IndexTransitionConfig {
  const type = normalizeIndexTransitionType(value.type)
  return {
    type,
    durationMs: clampIndexTransitionDuration(type, value.durationMs)
  }
}
