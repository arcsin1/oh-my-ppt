import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import os from 'os'
import path from 'path'
import { unzipSync } from 'fflate'

// 回归背景（两处缺陷都会让 PowerPoint 拒绝文件，已通过真机自动开合定位）：
// 1. html2pptx 0.0.10 在 16:9 幻灯片上输出 <p:sldSz type="wide">，"wide" 不是
//    ECMA-376 ST_SlideSizeType 的合法枚举值 → PowerPoint 弹「发现内容问题…修复」
//    对话框（嵌入字体与否均触发）。修复（html2pptx >= 0.2.0 库内完成）：输出合法值
//    "screen16x9"。
// 2. app.xml 的 <AppVersion>00.09:0000</AppVersion> 含冒号，不符合 ECMA-376 的
//    XX.YYYY 数字格式。仅修 sldSz 后 PowerPoint 会直接报「无法读取」。
//    修复（html2pptx >= 0.2.0 库内完成）："00.0000"。
// 本测试锁住这两点。

const html2pptxNode = (await import(
  pathToFileURL(path.resolve('node_modules/@arcsin1/html2pptx/dist/node.js')).href
)) as { writeHtmlToPptx: (outputPath: string, document: unknown) => void }

// ECMA-376 ST_SlideSizeType 合法枚举（html2pptx 可能输出的子集）
const VALID_SLIDE_SIZE_TYPES = new Set(['screen16x9', 'screen4x3', 'custom', 'screen16x10'])

describe('exported pptx opens without PowerPoint repair dialog', () => {
  it('writes a valid sldSz type (never the invalid "wide")', async () => {
    const outPath = path.join(os.tmpdir(), `oh-my-ppt-sldsz-${Date.now()}.pptx`)
    html2pptxNode.writeHtmlToPptx(outPath, {
      title: 'sldSz 回归',
      slides: [
        {
          texts: [
            { text: '兼容性', x: 1, y: 1, w: 8, h: 1, fontSize: 24, fontFace: 'Arial' }
          ]
        }
      ]
    })

    const zip = unzipSync(readFileSync(outPath))
    const presentation = Buffer.from(zip['ppt/presentation.xml']).toString('utf-8')
    const sldSzMatch = presentation.match(/<p:sldSz\b[^>]*>/)
    expect(sldSzMatch).not.toBeNull()
    const sldSzTag = sldSzMatch![0]
    expect(sldSzTag).not.toContain('type="wide"')
    const typeMatch = sldSzTag.match(/type="([^"]+)"/)
    if (typeMatch) {
      expect(VALID_SLIDE_SIZE_TYPES.has(typeMatch[1])).toBe(true)
    }
    // 16:9 默认尺寸下必须带合法 type（修复前此处是非法的 "wide"）
    expect(sldSzTag).toContain('cx="12192000"')
    expect(sldSzTag).toContain('cy="6858000"')
    expect(typeMatch).not.toBeNull()
    expect(typeMatch![1]).toBe('screen16x9')

    // app.xml 的 AppVersion 必须是 XX.YYYY 纯数字格式（修复前是含冒号的 "00.09:0000"）
    const appXml = Buffer.from(zip['docProps/app.xml']).toString('utf-8')
    const appVersion = appXml.match(/<AppVersion>([^<]+)<\/AppVersion>/)?.[1]
    expect(appVersion).toBeDefined()
    expect(appVersion).toMatch(/^\d{2}\.\d{4}$/)
  })
})
