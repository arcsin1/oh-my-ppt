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
  fade?: boolean
  transition?: 'in' | 'out'
}

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
    // Maps to same PPTX preset as fade-up (presetId=2, subtype=8).
    // This is correct: GSAP preview also applies opacity fade.
    // The semantic distinction between "slide" (40px translate) and
    // "fade-up" (20px translate) is encoded as distance, not preset.
    // Roundtrip type label may collapse to 'fade-up' — documented limitation.
  },
  'slide-left': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 3,
    motion: 'fromRight',
    fade: true
    // Same rationale: GSAP preview applies opacity fade for slide-left too.
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
    presetSubtype: 1
    // Subtypes: 1=wipeRight(fromLeft), 2=wipeLeft(fromRight), 3=wipeUp(fromBottom), 4=wipeDown(fromTop)
    // The subtype is set by animation-writer.ts based on data-anim-from,
    // exactly like directional fades use presetSubtype with presetId=2.
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
    fade: true
  },
  'grow-shrink': {
    presetId: 6,
    presetClass: 'emph',
    scale: true,
    scaleFrom: 90000,
    scaleTo: 108000
  },
  pulse: {
    presetId: 6,
    presetClass: 'emph',
    scale: true,
    scaleFrom: 100000,
    scaleTo: 106000
  },
  'exit-fade': {
    presetId: 10,
    presetClass: 'exit',
    fade: true,
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

/** Returns true if the animation type is expected to degrade on PPTX roundtrip. */
export const hasExactPptxPreset = (type: DataAnimType): boolean => {
  switch (type) {
    case 'slide-up':
    case 'slide-left':
      // PPTX always adds opacity fade to presetId=2; pure translate is unsupported.
      return false
    case 'zoom-in':
    case 'spin-in':
      // Both map to presetId=31 scale-in; rotation is lost for spin-in.
      return false
    case 'grow-shrink':
    case 'pulse':
      // Both map to presetId=6 emph; cannot distinguish in roundtrip.
      return false
    case 'fly-in':
      // fromTrace motion encodes direction in numeric XML, not presetSubtype.
      return false
    case 'path':
      // No semantic PPTX preset; degenerates to fade.
      return false
    default:
      return true
  }
}

export const resolveTraceMotion = (from: DataAnimFrom | undefined): Exclude<PptxMotion, 'fromTrace'> => {
  switch (from) {
    case 'left':
      return 'fromLeft'
    case 'right':
      return 'fromRight'
    case 'top':
      return 'fromTop'
    case 'bottom':
    case 'center':
    default:
      return 'fromBottom'
  }
}

export const mapPptxPresetToDataAnimType = (args: {
  presetId?: string
  presetSubtype?: string
  presetClass?: string
  hasScale: boolean
  effectFilter?: string
}): DataAnimType => {
  if (args.presetClass === 'exit') {
    if (args.presetId === '2') return 'exit-fly'
    return 'exit-fade'
  }
  if (args.presetClass === 'emph' && args.hasScale) return 'pulse'
  if (args.effectFilter?.startsWith('wipe') || args.presetId === '5') return 'wipe'
  if (args.hasScale) return 'scale-in'
  if (args.presetId === '10') return 'fade'
  if (args.presetId === '2') {
    switch (args.presetSubtype) {
      case '1':
        return 'fade-down'
      case '2':
        return 'fade-right'
      case '3':
      case '4':
        return 'fade-left'
      case '8':
        return 'fade-up'
      default:
        return 'fade-up'
    }
  }
  return 'fade'
}

export const mapPptxPresetToDataAnimFrom = (args: {
  presetSubtype?: string
  presetClass?: string
  presetId?: string
  effectFilter?: string
}): DataAnimFrom | undefined => {
  // Wipe direction (presetId=5):
  //   subtype 1=wipeRight(fromLeft), 2=wipeLeft(fromRight), 3=wipeUp(fromBottom), 4=wipeDown(fromTop)
  //   If no subtype, try parsing legacy 'wipe(X)' filter strings.
  if (args.presetId === '5' && args.presetClass === 'entr') {
    if (args.presetSubtype) {
      switch (args.presetSubtype) {
        case '1': return 'left'
        case '2': return 'right'
        case '3': return 'bottom'
        case '4': return 'top'
        default:  return 'left'
      }
    }
    // No subtype — try legacy 'wipe(X)' filter (used in older export versions)
    if (args.effectFilter?.startsWith('wipe')) {
      if (args.effectFilter.includes('(l)')) return 'right'
      if (args.effectFilter.includes('(r)')) return 'left'
      if (args.effectFilter.includes('(u)')) return 'bottom'
      if (args.effectFilter.includes('(d)')) return 'top'
    }
    return 'left'
  }
  // Legacy: custom 'wipe(X)' filter strings from older exports
  if (args.effectFilter?.startsWith('wipe')) {
    if (args.effectFilter.includes('(l)')) return 'right'
    if (args.effectFilter.includes('(r)')) return 'left'
    if (args.effectFilter.includes('(u)')) return 'bottom'
    if (args.effectFilter.includes('(d)')) return 'top'
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
