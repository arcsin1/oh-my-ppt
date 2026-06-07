import { describe, expect, it } from 'vitest'
import {
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
})
