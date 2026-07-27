import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

describe('主进程生产构建依赖策略', () => {
  it('将纯 JavaScript 依赖打入 bundle，只外置运行时原生模块', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'electron.vite.config.ts'),
      'utf-8'
    )

    expect(source).toContain('externalizeDeps: false')
    expect(source).toContain("'@napi-rs/canvas'")
    expect(source).toContain("'@node-rs/jieba'")
    expect(source).toContain("'@libsql/client'")
  })
})
