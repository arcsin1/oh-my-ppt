import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const sharedPromptSource = fs.readFileSync(
  path.resolve(__dirname, '../../../src/main/prompt/shared.ts'),
  'utf-8'
)

describe('shared prompt animation guidance', () => {
  it('prefers declarative stagger and sequence controls for new content', () => {
    expect(sharedPromptSource).toContain('Prefer `data-anim-stagger="N"`')
    expect(sharedPromptSource).toContain('Prefer `data-anim-sequence="with|after"`')
    expect(sharedPromptSource).toContain('Use `data-anim-click-group="name"` only for contiguous click-triggered elements')
    expect(sharedPromptSource).toContain('Prefer bounded emphasis labels such as `pulse-soft|pulse|pulse-strong`')
    expect(sharedPromptSource).toContain('Use `data-anim="path"` only with an inline linear path string')
    expect(sharedPromptSource).toContain('Do not use `data-anim-easing`, `data-anim-repeat`, or `data-anim-direction`')
    expect(sharedPromptSource).toContain('Do not use split-text/per-letter effects')
    expect(sharedPromptSource).toContain('preview-only concepts')
  })
})
