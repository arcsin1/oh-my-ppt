import { describe, expect, it } from 'vitest'
import { pathToFileURL } from 'node:url'
import path from 'path'

// 回归背景（用户反馈「副标题"录"字换行」）：html2pptx 提取器用 @chenglou/pretext
// （canvas 逐字测宽）对文本自行重排断行，再把每行拆成独立文本框。pretext 的
// 测宽与浏览器 DOM 实际排版存在亚像素级分歧（实测：DOM 整行 418px，pretext
// 自然行宽 418.8px），当元素宽 418px 时 pretext 凭空把末字断到"第二行"，
// 导出 PPT 里出现孤字文本框。
// 修复（html2pptx >= 0.2.0）：pretext 拆出多行时必须与 DOM 几何佐证一致——
// 矩形高度（含垂直 padding/border）只够放一行（≤1.5×行高）就不允许拆行，
// 回退 DOM 单框路径。

const html2pptxRoot = path.resolve('node_modules/@arcsin1/html2pptx/dist/index.js')

const buildExtractScript = async () => {
  const lib = (await import(pathToFileURL(path.resolve(html2pptxRoot)).href)) as {
    buildHtmlToPptxExtractScript: (options?: Record<string, unknown>) => string
  }
  return lib.buildHtmlToPptxExtractScript({
    pageWidthPx: 1600,
    pageHeightPx: 900,
    slideWidthIn: 13.333,
    slideHeightIn: 7.5
  })
}

describe('extract script rejects pretext phantom line breaks', () => {
  it('keeps the pretext layout path', async () => {
    const script = await buildExtractScript()
    expect(script).toContain('layoutWithLines')
  })

  it('only trusts multi-line pretext output when the rect height proves multiple lines', async () => {
    const script = await buildExtractScript()
    // pretext 拆出 >1 行时：矩形高 ≤ 1.5×行高+垂直 padding/border ⇒ 视为
    // 幻影拆行，返回 null 走 DOM 单框路径。npm dist 是压缩产物，用占位正则
    // 匹配结构（标识符名在压缩间不稳定）。
    expect(script).toMatch(
      /if\((\w+)\.lines\.length>1\)\{const \w+=\(Number\.parseFloat\(\w+\.paddingTop\)\|\|0\)\+\(Number\.parseFloat\(\w+\.paddingBottom\)\|\|0\)\+\(Number\.parseFloat\(\w+\.borderTopWidth\)\|\|0\)\+\(Number\.parseFloat\(\w+\.borderBottomWidth\)\|\|0\);if\(\w+\.height<=1\.5\*\w+\+\w+\)return null\}/
    )
    // 守卫命中后的回退产物仍是 DOM 单框路径
    expect(script).toContain('{lineHeightPx:')
  })
})
