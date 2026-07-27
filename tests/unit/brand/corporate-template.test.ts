import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CORPORATE_TEMPLATE_ID, CORPORATE_STYLE_KEY } from '../../../src/shared/brand'

const templateDir = path.join(
  process.cwd(),
  'resources',
  'corporate-template',
  CORPORATE_TEMPLATE_ID
)

describe('bundled Anju Jianye corporate template', () => {
  it('ships the four approved page roles in 16:9', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(templateDir, 'manifest.json'), 'utf8')
    ) as {
      id: string
      styleId: string
      slideSizeId: string
      slideWidth: number
      slideHeight: number
      pageCount: number
      designContract: { titleFont: string; bodyFont: string }
      pages: Array<{
        pageNumber: number
        title: string
        htmlPath: string
        role: string
      }>
    }

    expect(manifest.id).toBe(CORPORATE_TEMPLATE_ID)
    expect(manifest.styleId).toBe(CORPORATE_STYLE_KEY)
    expect(manifest.slideSizeId).toBe('wide-16-9')
    expect([manifest.slideWidth, manifest.slideHeight]).toEqual([1600, 900])
    expect(manifest.pageCount).toBe(4)
    expect(manifest.designContract).toMatchObject({
      titleFont: 'KaiTi',
      bodyFont: 'KaiTi'
    })
    expect(manifest.pages.map((page) => page.role)).toEqual([
      'cover',
      'agenda',
      'body',
      'closing'
    ])
    expect(manifest.pages.map((page) => page.htmlPath)).toEqual([
      'page-1.html',
      'page-2.html',
      'page-4.html',
      'page-5.html'
    ])

    for (const page of manifest.pages) {
      const htmlPath = path.join(templateDir, page.htmlPath)
      expect(fs.existsSync(htmlPath), `${page.htmlPath} should exist`).toBe(true)
      const html = fs.readFileSync(htmlPath, 'utf8')
      expect(html).toContain('data-ppt-slide-size-id="wide-16-9"')
      expect(html).toContain('data-ppt-width="1600"')
      expect(html).toContain('data-ppt-height="900"')
    }
  })

  it('retains the editable source deck and corporate confidentiality footer', () => {
    const sourceDeck = path.join(
      process.cwd(),
      'resources',
      'corporate-template',
      'source',
      '安居建业PPT模板（2024年6月）.pptx'
    )
    expect(fs.existsSync(sourceDeck)).toBe(true)
    expect(fs.statSync(sourceDeck).size).toBeGreaterThan(100_000)

    const allPageHtml = fs
      .readdirSync(templateDir)
      .filter((name) => /^page-\d+\.html$/.test(name))
      .map((name) => fs.readFileSync(path.join(templateDir, name), 'utf8'))
      .join('\n')
    expect(allPageHtml).toContain('内部文件')
    expect(allPageHtml).toContain('请勿外传')
  })
})
