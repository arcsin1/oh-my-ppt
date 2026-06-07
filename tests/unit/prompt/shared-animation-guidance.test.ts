import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

const sharedPromptSource = fs.readFileSync(
  path.resolve(__dirname, '../../../src/main/prompt/shared.ts'),
  'utf-8'
)

describe('shared prompt animation guidance', () => {
  it('steers the model toward export-stable animation types first', () => {
    expect(sharedPromptSource).toContain('Prefer export-stable animation types by default')
    expect(sharedPromptSource).toContain('fade, fade-up/down/left/right, scale-in, wipe, exit-fade')
    expect(sharedPromptSource).toContain('Use slide-*, fly-in, and exit-wipe only when directional emphasis matters')
    expect(sharedPromptSource).toContain('Use weaker-roundtrip types (zoom-in, spin-in, grow-shrink, pulse, path)')
  })
})
