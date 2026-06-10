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

  it('writes rich text runs with their own color and bold style', () => {
    const slide: HtmlToPptxSlide = {
      texts: [
        {
          text: '本页文字梳理：原始内容',
          x: 1,
          y: 1,
          w: 4,
          h: 0.5,
          fontSize: 18,
          fontFace: 'Noto Sans SC',
          color: '3E3A39',
          runs: [
            {
              text: '本页文字梳理：',
              fontSize: 18,
              fontFace: 'Noto Sans SC',
              color: 'C00000',
              bold: true
            },
            {
              text: '原始内容',
              fontSize: 18,
              fontFace: 'Noto Sans SC',
              color: '3E3A39'
            }
          ]
        }
      ],
      shapes: [],
      images: [],
      tables: []
    }

    const xml = buildSlideXml(slide, new Map(), 1)

    expect(xml).toContain('<a:srgbClr val="C00000"/>')
    expect(xml).toContain('<a:t>本页文字梳理：</a:t>')
    expect(xml).toContain('b="1"')
    expect(xml).toContain('<a:srgbClr val="3E3A39"/>')
    expect(xml).toContain('<a:t>原始内容</a:t>')
  })

  it('writes single-side exported borders as PPT line shapes', () => {
    const slide: HtmlToPptxSlide = {
      texts: [],
      shapes: [
        {
          x: 1,
          y: 1.5,
          w: 3,
          h: 0.001,
          shapeType: 'line',
          border: {
            color: 'BFDDE8',
            widthPt: 1.5,
            dash: 'dash'
          }
        }
      ],
      images: [],
      tables: []
    }

    const xml = buildSlideXml(slide, new Map(), 1)

    expect(xml).toContain('<a:prstGeom prst="line"><a:avLst/></a:prstGeom>')
    expect(xml).toContain('<a:prstDash val="dash"/>')
    expect(xml).not.toContain('prst="rect"><a:avLst/></a:prstGeom>')
  })

  it('writes flipped line shapes for CSS chevron arrowheads', () => {
    const slide: HtmlToPptxSlide = {
      texts: [],
      shapes: [
        {
          x: 1,
          y: 1.5,
          w: 0.2,
          h: 0.12,
          shapeType: 'line',
          flipV: true,
          border: {
            color: 'AF2125',
            widthPt: 1.5
          }
        }
      ],
      images: [],
      tables: []
    }

    const xml = buildSlideXml(slide, new Map(), 1)

    expect(xml).toContain('<a:xfrm flipV="1">')
    expect(xml).toContain('<a:prstGeom prst="line"><a:avLst/></a:prstGeom>')
  })
})
