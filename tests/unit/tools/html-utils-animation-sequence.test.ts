import { describe, expect, it } from 'vitest'

import { validateHtmlContent } from '../../../src/main/tools/html-utils'

describe('validateHtmlContent declarative animation controls', () => {
  it('allows declarative data-anim-stagger and data-anim-sequence values', () => {
    const result = validateHtmlContent(`
      <div>
        <div data-anim="fade-up" data-anim-stagger="80">A</div>
        <div data-anim="fade" data-anim-sequence="with" data-anim-delay="60">B</div>
        <div data-anim="fade-up" data-anim-sequence="after">C</div>
      </div>
    `)

    expect(result.valid).toBe(true)
  })

  it('rejects invalid data-anim-sequence values', () => {
    const result = validateHtmlContent(`
      <div data-anim="fade-up" data-anim-sequence="together">A</div>
    `)

    expect(result.errors.join('\n')).toContain('data-anim-sequence 仅支持 with/after')
  })

  it('rejects invalid data-anim-stagger values', () => {
    const result = validateHtmlContent(`
      <div data-anim="fade-up" data-anim-stagger="-10">A</div>
    `)

    expect(result.errors.join('\n')).toContain('data-anim-stagger 必须是大于等于 0 的数字毫秒值')
  })

  it('allows contiguous click-group usage on click-triggered animations', () => {
    const result = validateHtmlContent(`
      <div>
        <div data-anim="fade-up" data-anim-trigger="click" data-anim-click-group="reveal">A</div>
        <div data-anim="fade" data-anim-trigger="click" data-anim-click-group="reveal">B</div>
        <div data-anim="pulse-soft" data-anim-trigger="click">C</div>
      </div>
    `)

    expect(result.valid).toBe(true)
  })

  it('rejects click-group on non-click animations', () => {
    const result = validateHtmlContent(`
      <div data-anim="fade-up" data-anim-click-group="reveal">A</div>
    `)

    expect(result.errors.join('\n')).toContain('data-anim-click-group 只能用于 click 触发动画')
  })

  it('rejects non-contiguous click-group reuse across click steps', () => {
    const result = validateHtmlContent(`
      <div>
        <div data-anim="fade-up" data-anim-trigger="click" data-anim-click-group="reveal">A</div>
        <div data-anim="fade-up" data-anim-trigger="click">B</div>
        <div data-anim="fade-up" data-anim-trigger="click" data-anim-click-group="reveal">C</div>
      </div>
    `)

    expect(result.errors.join('\n')).toContain('data-anim-click-group 必须在 click 动画的 DOM 顺序上连续出现')
  })

  it('rejects data-anim values outside the public editable contract', () => {
    const result = validateHtmlContent(`
      <div data-anim="zoom">A</div>
      <div data-anim="glitch-in">B</div>
    `)

    expect(result.errors.join('\n')).toContain('data-anim 仅支持当前公开可编辑动画类型')
    expect(result.errors.join('\n')).toContain('zoom')
    expect(result.errors.join('\n')).toContain('glitch-in')
  })

  it('rejects non-canonical trigger and from aliases in generated content', () => {
    const result = validateHtmlContent(`
      <div data-anim="fade-up" data-anim-trigger="on-click" data-anim-from="start">A</div>
    `)

    expect(result.errors.join('\n')).toContain('data-anim-trigger 仅支持 load/with/after/click')
    expect(result.errors.join('\n')).toContain('on-click')
    expect(result.errors.join('\n')).toContain('data-anim-from 仅支持 left/right/top/bottom/center')
    expect(result.errors.join('\n')).toContain('start')
  })

  it('allows path only with a non-empty data-anim-path', () => {
    const valid = validateHtmlContent(`
      <div data-anim="path" data-anim-path="M 0 0 L 120 30">A</div>
    `)
    const missing = validateHtmlContent(`
      <div data-anim="path">A</div>
    `)
    const invalid = validateHtmlContent(`
      <div data-anim="path" data-anim-path="#curve">A</div>
    `)
    const unexpected = validateHtmlContent(`
      <div data-anim="fade-up" data-anim-path="M 0 0 L 120 30">A</div>
    `)

    expect(valid.valid).toBe(true)
    expect(missing.errors.join('\n')).toContain('data-anim="path" 必须同时提供可解析为线性位移的 data-anim-path')
    expect(invalid.errors.join('\n')).toContain('data-anim="path" 必须同时提供可解析为线性位移的 data-anim-path')
    expect(unexpected.errors.join('\n')).toContain('只有 data-anim="path" 才能使用 data-anim-path')
  })

  it('allows bounded duration and delay values from the public contract', () => {
    const result = validateHtmlContent(`
      <div
        data-anim="pulse"
        data-anim-duration="600"
        data-anim-delay="stagger(80)"
      >A</div>
    `)

    expect(result.valid).toBe(true)
  })

  it('rejects invalid duration and delay values', () => {
    const result = validateHtmlContent(`
      <div
        data-anim="pulse"
        data-anim-duration="80"
        data-anim-delay="-10"
      >A</div>
    `)

    const joined = result.errors.join('\n')
    expect(joined).toContain('data-anim-duration 必须是 100-5000 的数字毫秒值')
    expect(joined).toContain('data-anim-delay 必须是大于等于 0 的数字毫秒值或 stagger(N)')
  })

  it('rejects runtime-only easing, repeat, and direction knobs in normal editable content', () => {
    const result = validateHtmlContent(`
      <div
        data-anim="pulse"
        data-anim-easing="easeOutCubic"
        data-anim-repeat="2"
        data-anim-direction="alternate"
      >A</div>
    `)

    const joined = result.errors.join('\n')
    expect(joined).toContain('data-anim-easing 当前属于 runtime-only 兼容能力')
    expect(joined).toContain('data-anim-repeat 当前属于 runtime-only 兼容能力')
    expect(joined).toContain('data-anim-direction 当前属于 runtime-only 兼容能力')
  })
})
