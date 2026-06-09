import { describe, expect, it } from 'vitest'
import { buildSlideXml } from '../../../src/main/utils/html-pptx/ooxml-writer'
import type { HtmlToPptxSlide } from '../../../src/main/utils/html-pptx/types'

describe('buildSlideXml text export', () => {
  it('writes text box padding as PPTX body insets', () => {
    const slide: HtmlToPptxSlide = {
      texts: [
        {
          text: '写给业务人员',
          x: 9,
          y: 0.6,
          w: 2,
          h: 0.56,
          fontSize: 15,
          paddingLeft: 0.25,
          paddingRight: 0.25,
          paddingTop: 0.15,
          paddingBottom: 0.15
        }
      ],
      shapes: [],
      images: [],
      tables: []
    }

    const xml = buildSlideXml(slide, new Map(), 1)

    expect(xml).toContain('lIns="228600"')
    expect(xml).toContain('rIns="228600"')
    expect(xml).toContain('tIns="137160"')
    expect(xml).toContain('bIns="137160"')
    expect(xml).toContain('<a:t>写给业务人员</a:t>')
  })
})
