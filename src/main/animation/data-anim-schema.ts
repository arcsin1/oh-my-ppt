export const DATA_ANIM_SUPPORTED_TYPES = [
  'fade',
  'fade-up',
  'fade-down',
  'fade-left',
  'fade-right',
  'scale-in',
  'slide-up',
  'slide-down',
  'slide-left',
  'slide-right',
  'fly-in',
  'wipe',
  'zoom-in',
  'spin-in',
  'grow-shrink-soft',
  'grow-shrink',
  'grow-shrink-strong',
  'pulse-soft',
  'pulse',
  'pulse-strong',
  'exit-fade',
  'exit-scale',
  'exit-zoom',
  'exit-wipe',
  'exit-fly',
  'path'
] as const

export type DataAnimType = (typeof DATA_ANIM_SUPPORTED_TYPES)[number]

export const DATA_ANIM_FROM_VALUES = ['left', 'right', 'top', 'bottom'] as const
export type DataAnimFrom = (typeof DATA_ANIM_FROM_VALUES)[number]

export const DATA_ANIM_TRIGGERS = ['load', 'with', 'after', 'click'] as const
export type DataAnimTrigger = (typeof DATA_ANIM_TRIGGERS)[number]
export type DataAnimPptxTrigger = Extract<DataAnimTrigger, 'load' | 'click'>

export const DATA_ANIM_SEQUENCES = ['with', 'after'] as const
export type DataAnimSequence = (typeof DATA_ANIM_SEQUENCES)[number]
