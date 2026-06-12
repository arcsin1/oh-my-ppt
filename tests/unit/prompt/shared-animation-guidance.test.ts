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
    expect(sharedPromptSource).toContain("DATA_ANIM_EXPORT_STABLE_TYPES.join(', ')")
    expect(sharedPromptSource).toContain("DATA_ANIM_DIRECTIONAL_EMPHASIS_TYPES.join(', ')")
    expect(sharedPromptSource).toContain("DATA_ANIM_WEAKER_ROUNDTRIP_TYPES.join(', ')")
    expect(sharedPromptSource).toContain('Use weaker-roundtrip types (')
    expect(sharedPromptSource).toContain('preview choreography matters more than editable PPTX roundtrip')
    expect(sharedPromptSource).toContain('preview-first escape hatches')
  })
})
