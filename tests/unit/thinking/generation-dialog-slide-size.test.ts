import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('thinking generation corporate template lock', () => {
  it('removes external style and canvas choices and creates from the company template', () => {
    const dialogSource = readFileSync(
      'src/renderer/src/components/thinking/GenerationConfirmDialog.tsx',
      'utf8'
    )
    const pageSource = readFileSync('src/renderer/src/pages/thinking-detail.tsx', 'utf8')

    expect(dialogSource).not.toContain('SLIDE_SIZE_PRESETS')
    expect(dialogSource).not.toContain('StyleSelect')
    expect(dialogSource).not.toContain('FontSelection')
    expect(dialogSource).toContain('安居建业标准模板 · 16:9')
    expect(pageSource).toContain('templateId: CORPORATE_TEMPLATE_ID')
    expect(pageSource).toContain('/template-generating')
    expect(pageSource).not.toContain('slideSizeId: params.slideSizeId')
  })
})
