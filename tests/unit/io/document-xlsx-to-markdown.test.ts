import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { convertWorkbookToMarkdown } from '../../../src/main/ipc/io/document-xlsx-to-markdown'

describe('Excel reference conversion', () => {
  it('preserves every non-empty worksheet in source order', () => {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['项目', '数量', '日期'],
        ['安居项目', 12, new Date('2026-07-28T00:00:00Z')]
      ]),
      '项目台账'
    )
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([]), '空白表')
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['风险', '状态'],
        ['工期', '跟进中']
      ]),
      '风险清单'
    )

    const markdown = convertWorkbookToMarkdown(workbook, '项目资料')

    expect(markdown.indexOf('## 工作表：项目台账')).toBeLessThan(
      markdown.indexOf('## 工作表：风险清单')
    )
    expect(markdown).not.toContain('空白表')
    expect(markdown).toContain('| 安居项目 | 12 | 2026-07-28 |')
    expect(markdown).toContain('| 工期 | 跟进中 |')
  })

  it('rejects an empty workbook with a clear Chinese error', () => {
    expect(() => convertWorkbookToMarkdown(XLSX.utils.book_new(), '空工作簿')).toThrow(
      '工作簿没有可读取的非空单元格'
    )
  })
})
