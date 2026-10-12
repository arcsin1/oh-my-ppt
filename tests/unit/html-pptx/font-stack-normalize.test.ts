import { describe, expect, it } from 'vitest'
import path from 'node:path'

// 回归背景：html2pptx 的浏览器提取脚本原来直接取 fontFamily 栈第一项写进
// PPTX typeface（如 Tailwind font-mono 的 "ui-monospace"），WPS 不认识该名
// 会乱替换成斜体/回退字体。补丁在导出的提取脚本前拼入 __h2pFontFace 归一化
// helper：泛型/系统 UI 项映射为 Windows 常见具体字体，具体字体取第一个非泛型项。
// 注意：不通过裸包名导入（vitest 别名指向兄弟源码 checkout，本机不存在），
// 与 eot-bold-sample.test.ts 一致地从已安装 dist 导入。

const html2pptx = (await import(
  pathToFileURL(path.resolve('node_modules/@arcsin1/html2pptx/dist/index.js')).href
)) as { buildHtmlToPptxExtractScript: (options: Record<string, unknown>) => string }

import { pathToFileURL } from 'node:url'

/** 从拼接脚本头部摘出 helper 函数源码（包装格式固定：var __h2pFontFace=<fn>;...） */
const extractHelper = (script: string): string => {
  const prefix = 'var __h2pFontFace='
  expect(script.startsWith(prefix)).toBe(true)
  let depth = 0
  for (let i = prefix.length; i < script.length; i++) {
    const ch = script[i]
    if (ch === '{') depth++
    if (ch === '}') {
      depth--
      if (depth === 0) return script.slice(prefix.length, i + 1)
    }
  }
  throw new Error('helper function source not terminated')
}

describe('html2pptx extraction script normalizes font stacks', () => {
  it('buildHtmlToPptxExtractScript prepends the __h2pFontFace helper', () => {
    const script = html2pptx.buildHtmlToPptxExtractScript({
      slideWidthIn: 13.333,
      slideHeightIn: 7.5
    })
    expect(script).toContain('__h2pFontFace')
    // 提取脚本内的 fontFace 推导点全部走 helper（不再有 split(",")[0] 原式）
    expect(script).not.toMatch(/\.split\(","\)\[0\]\.replace\(/)
    const calls = script.match(/__h2pFontFace\(\w+\.fontFamily\)/g) ?? []
    expect(calls.length).toBeGreaterThanOrEqual(3)
  })

  it('helper maps generic/system-ui-first stacks to concrete Windows fonts', () => {
    const helper = new Function(
      `return (${extractHelper(
        html2pptx.buildHtmlToPptxExtractScript({ slideWidthIn: 13.333, slideHeightIn: 7.5 })
      )})`
    )() as (stack: unknown) => string

    // Tailwind font-mono 栈：ui-monospace 打头 → Consolas（WPS 认识的等宽字体）
    expect(
      helper('ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace')
    ).toBe('Consolas')
    // Tailwind font-sans 栈：system-ui 打头 → 映射到 Windows 保底无衬线 Arial
    // （栈内后续具体名可能 Mac 专属，如 SFMono-Regular，不可信）
    expect(
      helper('system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"')
    ).toBe('Arial')
    // 具体字体打头：保持原样
    expect(helper('"Noto Sans SC", sans-serif')).toBe('Noto Sans SC')
    expect(helper('"Fira Code", monospace')).toBe('Fira Code')
    // 空栈回退为空串（由 ||"Aptos" 兜底）
    expect(helper('')).toBe('')
    expect(helper(undefined)).toBe('')
  })
})
