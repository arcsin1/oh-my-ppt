import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as XLSX from 'xlsx'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
  ipcMain: { handle: vi.fn() }
}))

import { parseChartDataFile } from '../../../src/main/ipc/editor/chart-data-import'

const tempDirs: string[] = []

const makeTempDir = async (): Promise<string> => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'anjian-chart-data-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.promises.rm(dir, { recursive: true, force: true }))
  )
})

describe('chart data import', () => {
  it('parses CSV data through the statically imported Papa Parse runtime', async () => {
    const dir = await makeTempDir()
    const filePath = path.join(dir, '季度数据.csv')
    await fs.promises.writeFile(
      filePath,
      ['季度,收入,成本', '一季度,120,80', '二季度,150,90'].join('\n'),
      'utf8'
    )

    const result = await parseChartDataFile(filePath)

    expect(result).toMatchObject({ canceled: false, rowCount: 2, seriesCount: 2 })
    expect(JSON.parse(result.dataJson ?? '[]')).toEqual([
      { x: '一季度', 收入: 120, 成本: 80 },
      { x: '二季度', 收入: 150, 成本: 90 }
    ])
  })

  it('parses XLSX data through the statically imported SheetJS runtime', async () => {
    const dir = await makeTempDir()
    const filePath = path.join(dir, '月度数据.xlsx')
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([
      ['月份', '计划', '完成'],
      ['一月', 100, 92],
      ['二月', 110, 115]
    ])
    XLSX.utils.book_append_sheet(workbook, sheet, '数据')
    XLSX.writeFile(workbook, filePath)

    const result = await parseChartDataFile(filePath)

    expect(result).toMatchObject({ canceled: false, rowCount: 2, seriesCount: 2 })
    expect(JSON.parse(result.dataJson ?? '[]')).toEqual([
      { x: '一月', 计划: 100, 完成: 92 },
      { x: '二月', 计划: 110, 完成: 115 }
    ])
  })
})
