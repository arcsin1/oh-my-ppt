import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  convertExcelFileToMarkdown,
  convertWorkbookToMarkdown,
  describeExcelReadError
} from '../../../src/main/ipc/io/document-xlsx-to-markdown'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  )
})

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

  it.each([
    { extension: 'xlsx', bookType: 'xlsx' as const },
    { extension: 'xls', bookType: 'xls' as const }
  ])(
    'reads a long Chinese $extension path through a Buffer and preserves worksheet order',
    async ({ extension, bookType }) => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), '安居建业-Excel-'))
      temporaryDirectories.push(directory)
      const filePath = path.join(
        directory,
        `【意见反馈】附件1-深圳市安和二号房地产开发有限公司2024年度经营业绩考核指标表(送审稿)-结合陶总意见-0912(2).${extension}`
      )
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['项目', '数值'],
          ['年度经营指标', 2026]
        ]),
        '经营指标（送审）'
      )
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['事项', '意见'],
          ['陶总意见', '保留']
        ]),
        '反馈《汇总》'
      )
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType })
      await fs.writeFile(filePath, buffer)

      const markdown = await convertExcelFileToMarkdown(filePath)

      expect(markdown.indexOf('## 工作表：经营指标（送审）')).toBeLessThan(
        markdown.indexOf('## 工作表：反馈《汇总》')
      )
      expect(markdown).toContain('| 年度经营指标 | 2026 |')
      expect(markdown).toContain('| 陶总意见 | 保留 |')
    }
  )

  it('classifies missing, locked and invalid workbook errors in Chinese', () => {
    expect(describeExcelReadError('/tmp/资料.xlsx', { code: 'ENOENT' })).toContain(
      '文件不存在或已移动'
    )
    expect(describeExcelReadError('/tmp/资料.xlsx', { code: 'EBUSY' })).toContain(
      '关闭占用该文件的程序'
    )
    expect(describeExcelReadError('/tmp/资料.xlsx', new Error('Unsupported ZIP file'))).toContain(
      '可能已损坏、加密或格式不受支持'
    )
  })
})
