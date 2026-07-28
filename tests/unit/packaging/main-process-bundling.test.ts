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
    expect(source).toContain('transformMixedEsModules: true')
    expect(source).toContain("'@napi-rs/canvas'")
    expect(source).toContain("'@node-rs/jieba'")
    expect(source).toContain("'@libsql/client'")
    expect(source).not.toContain("'better-sqlite3'")
  })

  it('不使用 createRequire 绕过纯 JavaScript 依赖打包', () => {
    const sourceFiles = [
      'src/main/ipc/io/document-parse-handlers.ts',
      'src/main/thinking/source-prepare.ts',
      'src/main/ipc/editor/chart-data-import.ts',
      'src/main/utils/docx-to-markdown.ts'
    ]
    const forbiddenPackages = [
      'mammoth',
      'turndown',
      '@joplin/turndown-plugin-gfm',
      'xlsx',
      'papaparse'
    ]

    for (const sourceFile of sourceFiles) {
      const source = fs.readFileSync(path.join(process.cwd(), sourceFile), 'utf-8')
      for (const packageName of forbiddenPackages) {
        expect(source).not.toContain(`require('${packageName}')`)
      }
    }
  })

  it('让两个 DOCX 入口都经过构建期可追踪的静态转换模块', () => {
    for (const sourceFile of [
      'src/main/ipc/io/document-parse-handlers.ts',
      'src/main/thinking/source-prepare.ts'
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), sourceFile), 'utf-8')
      expect(source).toContain("import { convertDocxToMarkdown } from")
      expect(source).toContain('await convertDocxToMarkdown(')
    }
  })
})
