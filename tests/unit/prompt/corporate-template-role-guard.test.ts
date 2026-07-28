import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')

describe('公司模板生成页型保护', () => {
  it('不把固定结束页交给模型生成', () => {
    const source = readSource('src/main/ipc/generation/template-deck-flow.ts')
    expect(source).toContain("pageRefs.filter((page) => page.templateRole !== 'closing')")
    expect(source).toContain('固定结束页不参与模型生成')
    expect(source).toContain('所有非封面、非目录、非结束页必须使用正文页模板')
  })

  it('约束正文居中且不把左上标题块扩展成整页侧栏', () => {
    const source = readSource('src/main/ipc/generation/template-deck-flow.ts')
    expect(source).toContain('不是贯穿整页的侧栏')
    expect(source).toContain('正文视觉中心与 1600px 画布中心基本重合')
    expect(source).toContain('Never leave a single CJK character on its own line')
    expect(source).toContain('validateCorporateTemplateBodyPageLayout(html)')
  })
})
