import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import os from 'os'
import path from 'path'
import { unzipSync } from 'fflate'
import type { HtmlToPptxSlide } from '@arcsin1/html2pptx'

// 回归背景（用户反馈「标题两行间距过大」）：html2pptx 把含 \n 的文本框拆成多个
// <a:p> 时，会把整个文本框的 paragraphSpacingBefore/After（来自 DOM margin 的
// 块级间距）写给每一个段落。PowerPoint 会把第二段的 spcBef 叠加到行距上
// （实测 64pt 行高 + 24pt 段距 = 89.5pt），行距直接膨胀近一半。
// 修复：spcBef 只写首段、spcAft 只写末段——\n 拆出的是同一块内的换行，
// 行间距离由 lnSpc 表达，块级 margin 已体现在文本框坐标里。

const html2pptxNode = (await import(
  pathToFileURL(path.resolve('node_modules/@arcsin1/html2pptx/dist/node.js')).href
)) as { writeHtmlToPptx: (outputPath: string, document: unknown) => void }

const writeSlide = (slide: HtmlToPptxSlide): string => {
  const outPath = path.join(os.tmpdir(), `oh-my-ppt-para-spacing-${Date.now()}-${Math.random().toString(36).slice(2)}.pptx`)
  html2pptxNode.writeHtmlToPptx(outPath, { title: '段落间距', slides: [slide] })
  return Buffer.from(unzipSync(readFileSync(outPath))['ppt/slides/slide1.xml']).toString('utf-8')
}

describe('paragraph spacing survives the \\n paragraph split correctly', () => {
  it('writes spcBef only to the first paragraph and spcAft only to the last (runs path)', () => {
    const xml = writeSlide({
      texts: [
        {
          text: '标题一行\n标题二行',
          x: 1,
          y: 1,
          w: 9,
          h: 2,
          fontSize: 40,
          fontFace: 'Noto Sans SC',
          bold: true,
          color: '0F172A',
          paragraphSpacingBefore: 24,
          paragraphSpacingAfter: 12,
          runs: [
            { text: '标题一行\n', color: '0F172A', bold: true, fontSize: 40, fontFace: 'Noto Sans SC' },
            { text: '标题二行', color: '0F172A', bold: true, fontSize: 40, fontFace: 'Noto Sans SC' }
          ]
        }
      ]
    })

    expect(xml.match(/<a:spcBef>/g)).toHaveLength(1)
    expect(xml.match(/<a:spcAft>/g)).toHaveLength(1)
    const paragraphs = xml.split('</a:p>')
    const firstPara = paragraphs[0]
    const lastPara = paragraphs[paragraphs.length - 2]
    expect(firstPara).toContain('<a:spcBef>')
    expect(firstPara).not.toContain('<a:spcAft>')
    expect(lastPara).toContain('<a:spcAft>')
    expect(lastPara).not.toContain('<a:spcBef>')
  })

  it('writes spcBef only to the first paragraph (plain text path)', () => {
    const xml = writeSlide({
      texts: [
        {
          text: 'A\nB\nC',
          x: 1,
          y: 1,
          w: 4,
          h: 2,
          fontSize: 20,
          color: '111827',
          paragraphSpacingBefore: 18
        }
      ]
    })

    expect(xml.match(/<a:spcBef>/g)).toHaveLength(1)
    const paragraphs = xml.split('</a:p>')
    expect(paragraphs[0]).toContain('<a:spcBef>')
    expect(paragraphs[1]).not.toContain('<a:spcBef>')
    expect(paragraphs[2]).not.toContain('<a:spcBef>')
  })
})
