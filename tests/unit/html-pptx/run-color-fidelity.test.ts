import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import os from 'os'
import path from 'path'
import { unzipSync } from 'fflate'
import {
  HIDE_FOR_PPTX_BACKGROUND_SCRIPT,
  buildMarkPptxExtractedTextForBackgroundScript
} from '../../../src/main/io/html-pptx/browser-scripts'

// 回归背景（用户反馈「导出的 PPT 与预览相比，文本加粗/颜色不一致」）：
// 1. 标题里的蓝色 span（如「EMV <blue>L3</blue>认证」）跨行时导出后变回单色——
//    html2pptx 0.0.10 的提取脚本在行界（display:block 子元素 / <br>）不把 \n
//    写进 runs，normalize 的完整性校验（runs 拼接 === 全文）失败后整组丢弃，
//    writer 退化成单色单 run。html2pptx >= 0.2.0 修复：在块级边界把 \n 补进
//    最后一个非空白 run；normalize 一旦通过校验即保留 runs，writer 按 run
//    拆 <a:r> 且按 \n 切段落。
// 2. aria-hidden 装饰文字（如 440px 的「L3」水印）被提取端有意跳过、留给背景
//    截图，但背景隐藏规则会把「已提取容器」的所有后代文字透明化，水印一起被
//    清空。修复：隐藏规则对 aria-hidden 子树豁免，并以行内 !important 钉住
//    其计算后的画笔值（color / -webkit-text-fill-color 等会继承，仅靠选择器
//    无法撤销祖先链上的透明化）。

// vitest 会把 '@arcsin1/html2pptx' 别名到不存在的作者本地目录，且 CJS 入口在
// "type": "module" 包内 require ESM 直接报错；沿用 pptx-compat.test.ts 的方式，
// 用绝对路径动态导入 ESM 入口。
const html2pptxNode = (await import(
  pathToFileURL(path.resolve('node_modules/@arcsin1/html2pptx/dist/node.js')).href
)) as { writeHtmlToPptx: (outputPath: string, document: unknown) => void }
const html2pptxEsm = await import(
  pathToFileURL(path.resolve('node_modules/@arcsin1/html2pptx/dist/index.js')).href
) as {
  normalizeExtractedHtmlToPptxSlide: (extracted: unknown, title: string, size: { widthIn: number; heightIn: number }) => {
    texts: Array<{ text: string; runs?: Array<{ text: string; color: string; bold?: boolean }> }>
  }
  buildHtmlToPptxExtractScript: (options: Record<string, unknown>) => string
}

type ExtractRun = {
  text: string
  color: string
  bold?: boolean
  italic?: boolean
  fontSize?: number
  fontFace?: string
}

const titleExtracted = {
  texts: [
    {
      text: 'EMV L3认证\n问题复盘与经验分享',
      x: 1,
      y: 2.9,
      w: 9,
      h: 2.2,
      fontSize: 55.2,
      fontFace: 'Noto Sans SC',
      bold: true,
      color: '0F172A',
      runs: [
        { text: 'EMV ', color: '0F172A', bold: true, fontSize: 55.2, fontFace: 'Noto Sans SC' },
        { text: 'L3', color: '3B82F6', bold: true, fontSize: 55.2, fontFace: 'Noto Sans SC' },
        { text: '认证\n', color: '0F172A', bold: true, fontSize: 55.2, fontFace: 'Noto Sans SC' },
        { text: '问题复盘与经验分享', color: '0F172A', bold: true, fontSize: 55.2, fontFace: 'Noto Sans SC' }
      ] as ExtractRun[]
    }
  ],
  shapes: [],
  images: [],
  tables: [],
  limits: { maxTextChars: 1000, maxImageBytes: 12582912 }
}

describe('mixed-color runs survive export when a line break falls between runs', () => {
  it('normalize keeps the runs once their joined text (with \\n) matches the full text', () => {
    const slide = html2pptxEsm.normalizeExtractedHtmlToPptxSlide(titleExtracted, '混色标题', {
      widthIn: 13.333333333,
      heightIn: 7.5
    })
    const title = slide.texts.find((t) => t.text.includes('EMV'))
    expect(title).toBeDefined()
    const runs = title!.runs
    expect(runs).toBeDefined()
    expect(runs!.map((r) => r.text)).toEqual(['EMV ', 'L3', '认证\n', '问题复盘与经验分享'])
    expect(runs!.find((r) => r.text === 'L3')!.color).toBe('3B82F6')
  })

  it('writer emits the blue run and splits paragraphs at the run-embedded newline', () => {
    const slide = html2pptxEsm.normalizeExtractedHtmlToPptxSlide(titleExtracted, '混色标题', {
      widthIn: 13.333333333,
      heightIn: 7.5
    })
    const outPath = path.join(os.tmpdir(), `oh-my-ppt-run-colors-${Date.now()}.pptx`)
    html2pptxNode.writeHtmlToPptx(outPath, { title: '混色标题', slides: [slide] })

    const xml = Buffer.from(unzipSync(readFileSync(outPath))['ppt/slides/slide1.xml']).toString('utf-8')
    // 蓝 run 必须原样出现在 XML 里（修复前整组 runs 被丢弃、只剩单色文本）
    expect(xml).toContain('<a:srgbClr val="3B82F6"/>')
    const l3Index = xml.indexOf('<a:t>L3</a:t>')
    expect(l3Index).toBeGreaterThan(-1)
    const restIndex = xml.indexOf('<a:t>问题复盘与经验分享</a:t>')
    expect(restIndex).toBeGreaterThan(l3Index)
    // 换行必须成为段落边界（修复前 runs 丢失，两行被合并成一个单色段落）
    const between = xml.slice(l3Index, restIndex)
    expect(between).toContain('</a:p>')
  })
})

describe('decorative aria-hidden text stays in the raster background', () => {
  it('background hide rule exempts aria-hidden subtrees', () => {
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain(':not(:is([aria-hidden="true"], [aria-hidden="true"] *))')
  })

  it('hide script pins computed paint on aria-hidden subtrees with inline !important', () => {
    // color / -webkit-text-fill-color 会从被标记祖先继承透明值，必须行内钉住
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain(
      "root.querySelectorAll('[aria-hidden=\"true\"], [aria-hidden=\"true\"] *')"
    )
    expect(HIDE_FOR_PPTX_BACKGROUND_SCRIPT).toContain("el.style.setProperty(prop, value, 'important')")
  })

  it('background text-match marking skips aria-hidden elements', () => {
    const script = buildMarkPptxExtractedTextForBackgroundScript(
      [{ x: 1, y: 1, w: 4, h: 1 }],
      { widthIn: 13.333333333, heightIn: 7.5 }
    )
    expect(script).toContain("element.closest('[aria-hidden=\"true\"]')")
  })
})

describe('html2pptx extract: block boundaries feed newlines into runs', () => {
  it('extract script carries the block-boundary newline insertion', () => {
    const script = html2pptxEsm.buildHtmlToPptxExtractScript({
      pageWidthPx: 1600,
      pageHeightPx: 900,
      slideWidthIn: 13.333333333,
      slideHeightIn: 7.5,
      maxTextBoxes: 360,
      maxShapes: 400,
      maxImages: 80,
      unsupportedTransformStrategy: 'raster-fallback'
    })
    // npm dist 是压缩产物，用占位正则匹配结构（标识符名在压缩间不稳定）：
    // 块级边界（<br> 或块级 display）时从最后一个非空白 run 向前找插入点，
    // 追加纯 \n（追加到纯空白 run 会被过滤丢掉）
    expect(script).toMatch(
      /\("BR"===(\w+)\.tagName\|\|\/\^\(block\|flex\|grid\|list-item\|flow-root\|table\)\$\/\.test\(/
    )
    expect(script).toMatch(
      /for\(let (\w+)=(\w+)\.length-1;\1>=0;\1--\)if\(\w+\(\2\[\1\]\.text\)\)return void\(\2\[\1\]\.text\+="\\n"\)/
    )
    // <br> 只插换行不递归子节点
    expect(script).toContain('"BR"!==')
  })
})
