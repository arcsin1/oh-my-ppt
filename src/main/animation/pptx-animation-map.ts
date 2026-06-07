import type { DataAnimFrom, DataAnimType } from './data-anim-schema'

export type PptxPresetClass = 'entr' | 'emph' | 'exit'
export type PptxMotion = 'fromTop' | 'fromBottom' | 'fromLeft' | 'fromRight' | 'fromTrace'
export type PptxFidelityTier = 'exact' | 'approximate' | 'degraded'

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
  'slide-down': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 1,
    motion: 'fromTop',
    fade: true
    // Same preset family as fade-down; semantic distinction is distance, not preset.
  },
  'slide-left': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 3,
    motion: 'fromRight',
    fade: true
    // Same rationale: GSAP preview applies opacity fade for slide-left too.
  },
  'slide-right': {
    presetId: 2,
    presetClass: 'entr',
    presetSubtype: 2,
    motion: 'fromLeft',
    fade: true
    // Same preset family as fade-right; semantic distinction is distance, not preset.
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
  'exit-wipe': {
    presetId: 5,
    presetClass: 'exit',
    presetSubtype: 1,
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
    case 'slide-down':
    case 'slide-left':
    case 'slide-right':
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

export const getPptxFidelityTier = (type: DataAnimType): PptxFidelityTier => {
  switch (type) {
    case 'slide-up':
    case 'slide-down':
    case 'slide-left':
    case 'slide-right':
    case 'fly-in':
    case 'wipe':
    case 'exit-wipe':
      return 'approximate'
    case 'zoom-in':
    case 'spin-in':
    case 'grow-shrink':
    case 'pulse':
    case 'path':
      return 'degraded'
    default:
      return 'exact'
  }
}

export const getPptxFidelityNote = (type: DataAnimType): string | null => {
  switch (type) {
    case 'slide-up':
    case 'slide-down':
    case 'slide-left':
    case 'slide-right':
      return `${type} 会映射到 PowerPoint 的 fade + directional motion 预设，方向保留但纯位移语义会折叠`
    case 'fly-in':
      return 'fly-in 会保留方向性位移，但回导时可能折叠为 fade-* 语义'
    case 'wipe':
      return 'wipe 在预览中使用 clip-path，在 PPTX 中使用 native wipe preset，视觉接近但不逐像素一致'
    case 'exit-wipe':
      return 'exit-wipe 在预览中使用 clip-path conceal，在 PPTX 中使用 native wipe exit preset，视觉接近但不逐像素一致'
    case 'zoom-in':
      return 'zoom-in 会折叠到 scale-in 预设，缩放意图保留但类型标签无法精确保真'
    case 'spin-in':
      return 'spin-in 的旋转分量在 PPTX 中会丢失，只保留缩放/淡入语义'
    case 'grow-shrink':
    case 'pulse':
      return `${type} 会映射到同一 emphasis preset，回导时两者会折叠为同类强调动画`
    case 'path':
      return 'path 缺少可编辑 PPTX 等价物，当前会退化为基础 entrance 语义'
    default:
      return null
  }
}

export const collectPptxFidelityWarnings = (types: Iterable<DataAnimType>): string[] => {
  const warnings: string[] = []
  const seen = new Set<DataAnimType>()

  for (const type of types) {
    if (seen.has(type)) continue
    seen.add(type)

    const tier = getPptxFidelityTier(type)
    if (tier === 'exact') continue

    const note = getPptxFidelityNote(type)
    if (!note) continue

    warnings.push(`动画 ${type} 为 ${tier} 保真度：${note}`)
  }

  return warnings
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
    if (args.presetId === '5' || args.effectFilter?.startsWith('wipe')) return 'exit-wipe'
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
  const fromWipeFilter = (filter: string | undefined): DataAnimFrom | undefined => {
    if (!filter?.startsWith('wipe')) return undefined
    if (filter.includes('(l)') || filter.includes('(left)')) return 'right'
    if (filter.includes('(r)') || filter.includes('(right)')) return 'left'
    if (filter.includes('(u)') || filter.includes('(up)')) return 'bottom'
    if (filter.includes('(d)') || filter.includes('(down)')) return 'top'
    return undefined
  }

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
    const fromFilter = fromWipeFilter(args.effectFilter)
    if (fromFilter) return fromFilter
    return 'left'
  }
  if (args.presetId === '5' && args.presetClass === 'exit') {
    const fromFilter = fromWipeFilter(args.effectFilter)
    if (fromFilter) return fromFilter
    if (args.presetSubtype) {
      switch (args.presetSubtype) {
        case '1': return 'left'
        case '2': return 'right'
        case '3': return 'bottom'
        case '4': return 'top'
        default: return 'left'
      }
    }
    return 'left'
  }
  const legacyWipeFrom = fromWipeFilter(args.effectFilter)
  if (legacyWipeFrom) return legacyWipeFrom
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
