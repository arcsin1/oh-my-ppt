import { describe, expect, it } from 'vitest'
import {
  DATA_ANIM_APPROXIMATE_TYPES,
  DATA_ANIM_DEGRADED_TYPES,
  DATA_ANIM_DIRECTIONAL_EMPHASIS_TYPES,
  DATA_ANIM_EXPORT_STABLE_TYPES,
  DATA_ANIM_WEAKER_ROUNDTRIP_TYPES
} from '../../../src/main/animation/data-anim-schema'
import {
  collectPptxFidelityWarningsByScope,
  collectPptxFidelityWarnings,
  getPptxFidelityNote,
  getPptxFidelityTier
} from '../../../src/main/animation/pptx-animation-map'

describe('PPTX fidelity helpers', () => {
  it('classifies exact, approximate, and degraded public animation types', () => {
    expect(getPptxFidelityTier('fade')).toBe('exact')
    expect(getPptxFidelityTier('exit-fade')).toBe('exact')
    expect(getPptxFidelityTier('slide-right')).toBe('approximate')
    expect(getPptxFidelityTier('wipe')).toBe('approximate')
    expect(getPptxFidelityTier('exit-wipe')).toBe('approximate')
    expect(getPptxFidelityTier('zoom-in')).toBe('degraded')
    expect(getPptxFidelityTier('path')).toBe('degraded')
  })

  it('provides human-readable fidelity notes for non-exact types', () => {
    expect(getPptxFidelityNote('slide-up')).toContain('fade + directional motion')
    expect(getPptxFidelityNote('exit-wipe')).toContain('native wipe exit preset')
    expect(getPptxFidelityNote('spin-in')).toContain('旋转分量')
    expect(getPptxFidelityNote('fade')).toBeNull()
  })

  it('deduplicates warnings and skips exact types', () => {
    const warnings = collectPptxFidelityWarnings([
      'fade',
      'slide-up',
      'slide-up',
      'exit-wipe',
      'path'
    ])

    expect(warnings).toHaveLength(3)
    expect(warnings[0]).toContain('slide-up')
    expect(warnings[1]).toContain('exit-wipe')
    expect(warnings[2]).toContain('path')
    expect(warnings.some((warning) => warning.startsWith('动画 fade '))).toBe(false)
  })

  it('adds page labels when collecting warnings by scope', () => {
    const warnings = collectPptxFidelityWarningsByScope([
      { label: '第 1 页《Overview》', types: ['fade', 'slide-up'] },
      { label: '第 2 页《Risks》', types: ['exit-wipe', 'path'] }
    ])

    expect(warnings).toHaveLength(3)
    expect(warnings[0]).toContain('第 1 页《Overview》：动画 slide-up')
    expect(warnings[1]).toContain('第 2 页《Risks》：动画 exit-wipe')
    expect(warnings[2]).toContain('第 2 页《Risks》：动画 path')
  })

  it('keeps authoring group constants aligned with fidelity tiers', () => {
    for (const type of DATA_ANIM_EXPORT_STABLE_TYPES) {
      expect(['exact', 'approximate']).toContain(getPptxFidelityTier(type))
    }
    for (const type of DATA_ANIM_DIRECTIONAL_EMPHASIS_TYPES) {
      expect(getPptxFidelityTier(type)).toBe('approximate')
    }
    for (const type of DATA_ANIM_WEAKER_ROUNDTRIP_TYPES) {
      expect(getPptxFidelityTier(type)).toBe('degraded')
    }
    expect(DATA_ANIM_DIRECTIONAL_EMPHASIS_TYPES.every((type) => DATA_ANIM_APPROXIMATE_TYPES.includes(type))).toBe(true)
    expect(DATA_ANIM_EXPORT_STABLE_TYPES.some((type) => getPptxFidelityTier(type) === 'approximate')).toBe(true)
    expect(DATA_ANIM_DEGRADED_TYPES).toEqual(DATA_ANIM_WEAKER_ROUNDTRIP_TYPES)
  })
})
