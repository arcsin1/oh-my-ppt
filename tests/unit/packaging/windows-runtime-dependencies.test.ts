import fs from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

type PackageManifest = {
  dependencies?: Record<string, string>
}

describe('Windows 安装包运行时依赖', () => {
  it('将 LangChain 动态加载的 JSON Schema 包声明为直接生产依赖', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')
    ) as PackageManifest

    expect(packageJson.dependencies?.['@cfworker/json-schema']).toBe('4.1.1')
  })
})
