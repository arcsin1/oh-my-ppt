export const DATA_ANIM_SUPPORTED_TYPES = [
  'fade',
  'fade-up',
  'fade-down',
  'fade-left',
  'fade-right',
  'scale-in',
  'slide-up',
  'slide-left',
  'fly-in',
  'wipe',
  'zoom-in',
  'spin-in',
  'grow-shrink',
  'pulse',
  'exit-fade',
  'exit-fly',
  'path'
] as const

export type DataAnimType = (typeof DATA_ANIM_SUPPORTED_TYPES)[number]

export const DATA_ANIM_FROM_VALUES = ['left', 'right', 'top', 'bottom', 'center'] as const
export type DataAnimFrom = (typeof DATA_ANIM_FROM_VALUES)[number]

export const DATA_ANIM_TRIGGERS = ['load', 'with', 'after', 'click'] as const
export type DataAnimTrigger = (typeof DATA_ANIM_TRIGGERS)[number]
export type DataAnimPptxTrigger = Extract<DataAnimTrigger, 'load' | 'click'>

/**
 * Easing values supported by the data-anim protocol (GSAP-compatible names).
 * These are used at runtime by GSAP. PPTX export ignores easing and uses
 * system-default curves — this is a documented fidelity limitation.
 */
export const DATA_ANIM_EASE_VALUES = [
  'none',
  'power1.in', 'power1.out', 'power1.inOut',
  'power2.in', 'power2.out', 'power2.inOut',
  'power3.in', 'power3.out', 'power3.inOut',
  'power4.in', 'power4.out', 'power4.inOut',
  'back.in', 'back.out', 'back.inOut',
  'elastic.in', 'elastic.out', 'elastic.inOut',
  'bounce.in', 'bounce.out', 'bounce.inOut',
  'sine.in', 'sine.out', 'sine.inOut',
  'expo.in', 'expo.out', 'expo.inOut',
  'circ.in', 'circ.out', 'circ.inOut'
] as const
export type DataAnimEase = (typeof DATA_ANIM_EASE_VALUES)[number]

/**
 * Full runtime animation configuration parsed from data-anim attributes.
 * v2.1 adds ease, stagger, repeat, yoyo, and sequence support.
 */
export interface DataAnimConfig {
  type: DataAnimType
  from?: DataAnimFrom
  trigger: DataAnimTrigger
  duration: number       // ms, clamped [100, 5000]
  delay: number          // ms, clamped [0, 30000]
  sequence?: 'with' | 'after'  // relative to previous load element
  ease?: DataAnimEase    // GSAP easing name; PPTX ignores this
  stagger?: number       // ms gap for stagger; replaces stagger(N) string pattern
  repeat?: number        // repeat count [0, 10]; 0 = no repeat
  yoyo?: boolean         // yoyo/reverse after each repeat
}
