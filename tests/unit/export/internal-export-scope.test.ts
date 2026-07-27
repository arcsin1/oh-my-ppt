import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8')

describe('安居建业内部版导出范围', () => {
  it('只启用 PPTX、PDF、PNG 产品导出通道', () => {
    const source = readSource('src/main/ipc/io/export-handlers.ts')

    expect(source).toContain("ipcMain.handle('export:pdf'")
    expect(source).toContain("ipcMain.handle('export:png'")
    expect(source).toContain("ipcMain.handle('export:pptx'")
    expect(source).toContain('const ENABLE_UNSUPPORTED_INTERNAL_EXPORTS = false')
    expect(source.match(/ENABLE_UNSUPPORTED_INTERNAL_EXPORTS &&/g)).toHaveLength(5)
  })
})
