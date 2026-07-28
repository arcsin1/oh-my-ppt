import { describe, expect, it } from 'vitest'
import {
  buildCorporatePrompt,
  clampCorporatePageCount,
  resolveCorporateCreationPageCount,
  resolveCorporateDocumentTotalPageCount,
  resolveRequestedPageCount,
  shouldIncludeCorporateAgenda
} from '../../../src/renderer/src/pages/home-utils'

describe('安居建业首页创建约束', () => {
  it('将生成页数限制在 1 到 50 页', () => {
    expect(clampCorporatePageCount(0)).toBe(1)
    expect(clampCorporatePageCount(12)).toBe(12)
    expect(clampCorporatePageCount(51)).toBe(50)
    expect(resolveRequestedPageCount('制作 1 页项目简报')).toBe(1)
    expect(resolveRequestedPageCount('生成 80 页汇报')).toBe(50)
  })

  it('文档生成提示明确要求基于资料，不虚构内容', () => {
    const prompt = buildCorporatePrompt({
      brief: '项目经营分析',
      pageCount: 8,
      hasReferenceDocument: true,
      includeAgenda: false
    })

    expect(prompt).toContain('参考资料及其逐页内容骨架已附加')
    expect(prompt).toContain('不得臆造')
    expect(prompt).toContain('安居建业标准模板')
    expect(prompt).toContain('不生成目录')
    expect(prompt).toContain('最后1页原模板结束页')
    expect(prompt).toContain('结束页必须保持原样')
  })

  it('只在明确需要时启用目录页', () => {
    expect(
      shouldIncludeCorporateAgenda({
        brief: '制作5页验收汇报：封面、目标、功能、风险、结束'
      })
    ).toBe(false)
    expect(
      shouldIncludeCorporateAgenda({
        brief: '制作10页年度汇报，需要目录页'
      })
    ).toBe(true)
  })

  it('将资料正文页与封面、结束页、可选目录分别计算', () => {
    expect(
      resolveCorporateDocumentTotalPageCount({ contentPageCount: 4, includeAgenda: false })
    ).toBe(6)
    expect(
      resolveCorporateDocumentTotalPageCount({ contentPageCount: 4, includeAgenda: true })
    ).toBe(7)
    expect(
      resolveCorporateDocumentTotalPageCount({ contentPageCount: 50, includeAgenda: true })
    ).toBe(50)
  })

  it('用户明确填写总页数时优先采用用户数字', () => {
    expect(
      resolveCorporateCreationPageCount({
        brief: '请制作 9 页项目汇报',
        contentPageCount: 4,
        includeAgenda: true
      })
    ).toBe(9)
    expect(
      resolveCorporateCreationPageCount({
        brief: '请根据资料制作项目汇报\n第 1 页：背景\n第 2 页：目标',
        contentPageCount: 4,
        includeAgenda: true
      })
    ).toBe(7)
  })
})
