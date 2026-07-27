import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string): string =>
  fs.readFileSync(path.join(process.cwd(), relativePath), 'utf-8')

describe('旧 PPTX 导入策略', () => {
  it('不自动套用公司风格，并在首页说明保留原版式', () => {
    const home = readSource('src/renderer/src/pages/home.tsx')
    const importCall = home.slice(
      home.indexOf('const result = await ipc.importPptx({'),
      home.indexOf("success('PPTX 导入完成'")
    )

    expect(importCall).toContain('styleId: null')
    expect(home).toContain('保留原有颜色和版式')
  })
})
