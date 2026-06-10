import { describe, expect, it } from 'vitest'

import { validateHtmlContent } from '../../../src/main/tools/html-utils'

describe('validateHtmlContent preview-only animation boundary', () => {
  it('rejects anime SVG motion-path helpers in normal editable content', () => {
    const result = validateHtmlContent(`
      <div class="card">Card</div>
      <script>
        anime.svg.createMotionPath("#curve")
      </script>
    `)

    expect(result.errors.join('\n')).toContain('preview-only 方向')
  })

  it('rejects splitText-style fragmented text animation in normal editable content', () => {
    const result = validateHtmlContent(`
      <div class="title">Title</div>
      <script>
        splitText(".title")
      </script>
    `)

    expect(result.errors.join('\n')).toContain('splitText 文本碎片动画')
  })
})
