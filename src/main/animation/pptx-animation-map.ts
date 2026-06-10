import type { DataAnimFrom, DataAnimType } from './data-anim-schema'

export type PptxPresetClass = 'entr' | 'emph' | 'exit'
export type PptxMotion = 'fromTop' | 'fromBottom' | 'fromLeft' | 'fromRight' | 'fromTrace'

export interface PptxAnimationPreset {
  presetId: number
  presetClass: PptxPresetClass
  presetSubtype?: number
  motion?: PptxMotion
  scale?: boolean
  scaleFrom?: number
  scaleTo?: number
  rotateFrom?: number
  rotateTo?: number
  fade?: boolean
  effectFilter?: 'wipe'
  transition?: 'in' | 'out'
}

const SIMPLE_ENTRANCE_DELTA_THRESHOLD = 30

const parseNumericMotionDelta = (
  from: string | undefined,
  to: string | undefined,
  axis: 'x' | 'y'
): number | undefined => {
  const base = axis === 'x' ? '#ppt_x' : '#ppt_y'
  if (to !== base || !from?.startsWith(base)) return undefined
  const match = from.match(new RegExp(`^${base}([+-]\\d+(?:\\.\\d+)?)$`))
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) ? value : undefined
}

const EMPHASIS_PRESETS = [
  { type: 'grow-shrink-soft', scaleFrom: 95000, scaleTo: 104000 },
  { type: 'grow-shrink', scaleFrom: 90000, scaleTo: 108000 },
  { type: 'grow-shrink-strong', scaleFrom: 85000, scaleTo: 112000 },
  { type: 'pulse-soft', scaleFrom: 100000, scaleTo: 103000 },
  { type: 'pulse', scaleFrom: 100000, scaleTo: 106000 },
  { type: 'pulse-strong', scaleFrom: 100000, scaleTo: 110000 }
] as const satisfies ReadonlyArray<{
  type: DataAnimType
  scaleFrom: number
  scaleTo: number
}>

const ENTRANCE_SCALE_PRESETS = [
  { type: 'zoom-in', scaleFrom: 75000, scaleTo: 100000 },
  { type: 'scale-in', scaleFrom: 85000, scaleTo: 100000 },
  { type: 'spin-in', scaleFrom: 92000, scaleTo: 100000 }
] as const satisfies ReadonlyArray<{
  type: DataAnimType
  scaleFrom: number
  scaleTo: number
}>

const EXIT_SCALE_PRESETS = [
  { type: 'exit-scale', scaleFrom: 100000, scaleTo: 85000 },
  { type: 'exit-zoom', scaleFrom: 100000, scaleTo: 75000 }
] as const satisfies ReadonlyArray<{
  type: DataAnimType
  scaleFrom: number
  scaleTo: number
}>

export const PPTX_ANIMATION_PRESETS: Record<DataAnimType, PptxAnimationPreset> = {
  fade: { presetId: 10, presetClass: 'entr', fade: true },
  'fade-up': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 8,
    motion: 'fromBottom',
    fade: true
  },
  'fade-down': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 1,
    motion: 'fromTop',
    fade: true
  },
  'fade-left': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 3,
    motion: 'fromRight',
    fade: true
  },
  'fade-right': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 2,
    motion: 'fromLeft',
    fade: true
  },
  'scale-in': { presetId: 31, presetClass: 'entr', scale: true, fade: true },
  'slide-up': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 8,
    motion: 'fromBottom',
    fade: true
  },
  'slide-down': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 1,
    motion: 'fromTop',
    fade: true
  },
  'slide-left': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 3,
    motion: 'fromRight',
    fade: true
  },
  'slide-right': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 2,
    motion: 'fromLeft',
    fade: true
  },
  'fly-in': {
    presetId: 2,
    presetClass: 'entr',
    motion: 'fromTrace',
    fade: true
  },
  wipe: {
    presetId: 5,
    presetClass: 'entr',
    effectFilter: 'wipe'
  },
  'zoom-in': {
    presetId: 31,
    presetClass: 'entr',
    scale: true,
    scaleFrom: 75000,
    scaleTo: 100000,
    fade: true
  },
  'spin-in': {
    presetId: 31,
    presetClass: 'entr',
    scale: true,
    scaleFrom: 92000,
    scaleTo: 100000,
    rotateFrom: -720000,
    rotateTo: 0,
    fade: true
  },
  'grow-shrink-soft': {
    presetId: 6,
    presetClass: 'emph',
    scale: true,
    scaleFrom: 95000,
    scaleTo: 104000
  },
  'grow-shrink': {
    presetId: 6,
    presetClass: 'emph',
    scale: true,
    scaleFrom: 90000,
    scaleTo: 108000
  },
  'grow-shrink-strong': {
    presetId: 6,
    presetClass: 'emph',
    scale: true,
    scaleFrom: 85000,
    scaleTo: 112000
  },
  'pulse-soft': {
    presetId: 6,
    presetClass: 'emph',
    scale: true,
    scaleFrom: 100000,
    scaleTo: 103000
  },
  pulse: {
    presetId: 6,
    presetClass: 'emph',
    scale: true,
    scaleFrom: 100000,
    scaleTo: 106000
  },
  'pulse-strong': {
    presetId: 6,
    presetClass: 'emph',
    scale: true,
    scaleFrom: 100000,
    scaleTo: 110000
  },
  'exit-fade': {
    presetId: 10,
    presetClass: 'exit',
    fade: true,
    transition: 'out'
  },
  'exit-scale': {
    presetId: 31,
    presetClass: 'exit',
    scale: true,
    scaleFrom: 100000,
    scaleTo: 85000,
    fade: true,
    transition: 'out'
  },
  'exit-zoom': {
    presetId: 31,
    presetClass: 'exit',
    scale: true,
    scaleFrom: 100000,
    scaleTo: 75000,
    fade: true,
    transition: 'out'
  },
  'exit-wipe': {
    presetId: 5,
    presetClass: 'exit',
    effectFilter: 'wipe',
    transition: 'out'
  },
  'exit-fly': {
    presetId: 2,
    presetClass: 'exit',
    motion: 'fromTrace',
    fade: true,
    transition: 'out'
  },
  path: { presetId: 10, presetClass: 'entr', fade: true }
}

export const getPptxAnimationPreset = (
  type: DataAnimType
): PptxAnimationPreset | undefined => PPTX_ANIMATION_PRESETS[type]

export const resolveTraceMotion = (from: DataAnimFrom | undefined): Exclude<PptxMotion, 'fromTrace'> => {
  switch (from) {
    case 'left':
      return 'fromLeft'
    case 'right':
      return 'fromRight'
    case 'top':
      return 'fromTop'
    case 'bottom':
    default:
      return 'fromBottom'
  }
}

export const wipeFilterForFrom = (from: DataAnimFrom | undefined): string => {
  switch (from) {
    case 'right':
      return 'wipe(l)'
    case 'top':
      return 'wipe(d)'
    case 'bottom':
      return 'wipe(u)'
    case 'left':
    default:
      return 'wipe(r)'
  }
}

export const mapPptxPresetToDataAnimType = (args: {
  presetId?: string
  presetSubtype?: string
  presetClass?: string
  hasScale: boolean
  hasRotation?: boolean
  scaleFrom?: number
  scaleTo?: number
  effectFilter?: string
  motionXFrom?: string
  motionXTo?: string
  motionYFrom?: string
  motionYTo?: string
}): DataAnimType => {
  const hasLinearMotionDelta =
    (args.motionXFrom !== undefined &&
      args.motionXTo !== undefined &&
      args.motionXFrom !== args.motionXTo) ||
    (args.motionYFrom !== undefined &&
      args.motionYTo !== undefined &&
      args.motionYFrom !== args.motionYTo)
  const simpleEntranceDeltaX = parseNumericMotionDelta(args.motionXFrom, args.motionXTo, 'x')
  const simpleEntranceDeltaY = parseNumericMotionDelta(args.motionYFrom, args.motionYTo, 'y')
  if (args.presetClass === 'exit') {
    if (args.effectFilter?.startsWith('wipe') || args.presetId === '5') return 'exit-wipe'
    if (args.hasScale) {
      if (args.scaleFrom !== undefined && args.scaleTo !== undefined) {
        return EXIT_SCALE_PRESETS.reduce(
          (best, preset) => {
            const distance =
              Math.abs(preset.scaleFrom - args.scaleFrom!) + Math.abs(preset.scaleTo - args.scaleTo!)
            return distance < best.distance ? { type: preset.type, distance } : best
          },
          { type: 'exit-scale' as DataAnimType, distance: Number.POSITIVE_INFINITY }
        ).type
      }
      return 'exit-scale'
    }
    if (args.presetId === '2') return 'exit-fly'
    return 'exit-fade'
  }
  if (args.presetClass === 'emph' && args.hasScale) {
    if (args.scaleFrom === undefined || args.scaleTo === undefined) return 'pulse'
    return EMPHASIS_PRESETS.reduce(
      (best, preset) => {
        const distance =
          Math.abs(preset.scaleFrom - args.scaleFrom!) + Math.abs(preset.scaleTo - args.scaleTo!)
        return distance < best.distance ? { type: preset.type, distance } : best
      },
      { type: 'pulse' as DataAnimType, distance: Number.POSITIVE_INFINITY }
    ).type
  }
  if (args.effectFilter?.startsWith('wipe') || args.presetId === '5') return 'wipe'
  if (args.hasScale) {
    if (args.hasRotation) return 'spin-in'
    if (args.scaleFrom !== undefined && args.scaleTo !== undefined) {
      return ENTRANCE_SCALE_PRESETS.reduce(
        (best, preset) => {
          const distance =
            Math.abs(preset.scaleFrom - args.scaleFrom!) + Math.abs(preset.scaleTo - args.scaleTo!)
          return distance < best.distance ? { type: preset.type, distance } : best
        },
        { type: 'scale-in' as DataAnimType, distance: Number.POSITIVE_INFINITY }
      ).type
    }
    return 'scale-in'
  }
  if (args.presetId === '10') return hasLinearMotionDelta ? 'path' : 'fade'
  if (args.presetId === '2') {
    if (
      !args.presetSubtype &&
      (args.motionXFrom !== undefined ||
        args.motionXTo !== undefined ||
        args.motionYFrom !== undefined ||
        args.motionYTo !== undefined)
    ) {
      return 'fly-in'
    }
    switch (args.presetSubtype) {
      case '1':
        return Math.abs(simpleEntranceDeltaY || 0) >= SIMPLE_ENTRANCE_DELTA_THRESHOLD
          ? 'slide-down'
          : 'fade-down'
      case '2':
        return Math.abs(simpleEntranceDeltaX || 0) >= SIMPLE_ENTRANCE_DELTA_THRESHOLD
          ? 'slide-right'
          : 'fade-right'
      case '3':
      case '4':
        return Math.abs(simpleEntranceDeltaX || 0) >= SIMPLE_ENTRANCE_DELTA_THRESHOLD
          ? 'slide-left'
          : 'fade-left'
      case '8':
        return Math.abs(simpleEntranceDeltaY || 0) >= SIMPLE_ENTRANCE_DELTA_THRESHOLD
          ? 'slide-up'
          : 'fade-up'
      default:
        return 'fade-up'
    }
  }
  return 'fade'
}

export const mapPptxPresetToDataAnimFrom = (args: {
  presetId?: string
  presetClass?: string
  presetSubtype?: string
  effectFilter?: string
  motionXFrom?: string
  motionXTo?: string
  motionYFrom?: string
  motionYTo?: string
}): DataAnimFrom | undefined => {
  const inferMotionDirection = (): DataAnimFrom | undefined => {
    const xAway = args.presetClass === 'exit' ? args.motionXTo : args.motionXFrom
    const yAway = args.presetClass === 'exit' ? args.motionYTo : args.motionYFrom
    if (xAway?.includes('#ppt_x-#ppt_w/2')) return 'left'
    if (xAway?.includes('#ppt_x+#ppt_w/2')) return 'right'
    if (yAway?.includes('#ppt_y-#ppt_h/2')) return 'top'
    if (yAway?.includes('#ppt_y+#ppt_h/2')) return 'bottom'
    return undefined
  }
  if (args.effectFilter?.startsWith('wipe')) {
    if (args.effectFilter.includes('(l)') || args.effectFilter.includes('(left)')) return 'right'
    if (args.effectFilter.includes('(r)') || args.effectFilter.includes('(right)')) return 'left'
    if (args.effectFilter.includes('(u)') || args.effectFilter.includes('(up)')) return 'bottom'
    if (args.effectFilter.includes('(d)') || args.effectFilter.includes('(down)')) return 'top'
  }
  const motionDirection = inferMotionDirection()
  if (motionDirection) return motionDirection
  if (args.presetId === '5' && args.presetSubtype) {
    switch (args.presetSubtype) {
      case '1':
        return 'left'
      case '2':
        return 'right'
      case '3':
        return 'bottom'
      case '4':
        return 'top'
      default:
        return undefined
    }
  }
  switch (args.presetSubtype) {
    case '1':
      return 'top'
    case '2':
      return 'left'
    case '3':
    case '4':
      return 'right'
    case '8':
      return 'bottom'
    default:
      return undefined
  }
}
