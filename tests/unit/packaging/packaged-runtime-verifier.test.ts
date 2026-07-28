import { describe, expect, it } from 'vitest'
import {
  collectRuntimeSpecifiers,
  validateDependencyClosure,
  validateDynamicLoads,
  validateRequiredArchivePaths,
  validateRuntimeSpecifiers
} from '../../../scripts/verify-packaged-runtime.mjs'

type Manifest = {
  name: string
  version: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}

describe('最终安装包运行时验证器', () => {
  it('跨 Node 版本接受 node: 协议的 Electron 内建模块', () => {
    const scan = collectRuntimeSpecifiers(
      "import { DatabaseSync } from 'node:sqlite'",
      '/out/main/index.js'
    )

    expect(validateRuntimeSpecifiers(scan.specifiers).errors).toEqual([])
  })

  it('拒绝 bundle 中残留的未允许纯 JavaScript 运行时依赖', () => {
    const source = [
      "import { createRequire } from 'node:module'",
      'const runtimeRequire = createRequire(import.meta.url)',
      "runtimeRequire('mammoth')"
    ].join('\n')

    const scan = collectRuntimeSpecifiers(source, '/out/main/index.js')
    const result = validateRuntimeSpecifiers(scan.specifiers)

    expect(result.errors).toEqual([
      '/out/main/index.js:3 contains unexpected external runtime module "mammoth"'
    ])
  })

  it('拒绝未列入明确表达式允许名单的非字面量动态加载', () => {
    const source = [
      "import { createRequire } from 'node:module'",
      'const runtimeRequire = createRequire(import.meta.url)',
      'const packageName = process.env.RUNTIME_PACKAGE',
      'runtimeRequire(packageName)'
    ].join('\n')

    const scan = collectRuntimeSpecifiers(source, '/out/main/index.js')
    const result = validateDynamicLoads(scan.dynamicLoads)

    expect(result.errors).toEqual([
      '/out/main/index.js:4 contains dynamic-require with non-literal target "packageName"'
    ])
  })

  it('拒绝外置包缺失声明的生产依赖', () => {
    const manifests = new Map<string, Manifest>([
      [
        '/node_modules/jszip/package.json',
        {
          name: 'jszip',
          version: '3.10.1',
          dependencies: { setimmediate: '^1.0.5' }
        }
      ]
    ])

    const result = validateDependencyClosure({
      files: new Set(manifests.keys()),
      rootPackageNames: new Set(['jszip']),
      readManifest: (manifestPath: string) => manifests.get(manifestPath)
    })

    expect(result.errors).toContain(
      'jszip@3.10.1 is missing dependency setimmediate@^1.0.5'
    )
  })

  it('拒绝 Node 解析到不满足声明范围的依赖版本', () => {
    const manifests = new Map<string, Manifest>([
      [
        '/node_modules/jszip/package.json',
        {
          name: 'jszip',
          version: '3.10.1',
          dependencies: { 'readable-stream': '~2.3.6' }
        }
      ],
      [
        '/node_modules/readable-stream/package.json',
        { name: 'readable-stream', version: '4.7.0' }
      ]
    ])

    const result = validateDependencyClosure({
      files: new Set(manifests.keys()),
      rootPackageNames: new Set(['jszip']),
      readManifest: (manifestPath: string) => manifests.get(manifestPath)
    })

    expect(result.errors).toContain(
      'jszip@3.10.1 resolves readable-stream@4.7.0, expected ~2.3.6'
    )
  })

  it('校验归档中实际保留的 Windows 可选原生包版本', () => {
    const manifests = new Map<string, Manifest>([
      [
        '/node_modules/@napi-rs/canvas/package.json',
        {
          name: '@napi-rs/canvas',
          version: '0.1.100',
          optionalDependencies: {
            '@napi-rs/canvas-win32-x64-msvc': '0.1.100',
            '@napi-rs/canvas-linux-x64-gnu': '0.1.100'
          }
        }
      ],
      [
        '/node_modules/@napi-rs/canvas-win32-x64-msvc/package.json',
        { name: '@napi-rs/canvas-win32-x64-msvc', version: '0.1.99' }
      ]
    ])

    const result = validateDependencyClosure({
      files: new Set(manifests.keys()),
      rootPackageNames: new Set(['@napi-rs/canvas']),
      readManifest: (manifestPath: string) => manifests.get(manifestPath)
    })

    expect(result.errors).toContain(
      '@napi-rs/canvas@0.1.100 resolves @napi-rs/canvas-win32-x64-msvc@0.1.99, expected 0.1.100'
    )
    expect(result.errors).not.toContain(
      '@napi-rs/canvas@0.1.100 is missing dependency @napi-rs/canvas-linux-x64-gnu@0.1.100'
    )
  })

  it('拒绝缺少 Windows x64 原生绑定或公司模板资源', () => {
    const errors = validateRequiredArchivePaths(
      new Set(['/out/main/index.js']),
      [
        '/out/main/index.js',
        '/node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node',
        '/resources/corporate-template/tpl_anjian_standard_v1/manifest.json'
      ]
    )

    expect(errors).toEqual([
      'missing required packaged runtime file /node_modules/@napi-rs/canvas-win32-x64-msvc/skia.win32-x64-msvc.node',
      'missing required packaged runtime file /resources/corporate-template/tpl_anjian_standard_v1/manifest.json'
    ])
  })

  it('接受允许名单内且依赖闭包完整、版本兼容的运行时包', () => {
    const source = [
      "import { createClient } from '@libsql/client'",
      "import { createRequire } from 'node:module'",
      'const runtimeRequire = createRequire(import.meta.url)',
      "runtimeRequire('@node-rs/jieba/dict.js')"
    ].join('\n')
    const scan = collectRuntimeSpecifiers(source, '/out/main/index.js')
    const runtime = validateRuntimeSpecifiers(scan.specifiers)
    const manifests = new Map<string, Manifest>([
      [
        '/node_modules/@libsql/client/package.json',
        {
          name: '@libsql/client',
          version: '0.14.0',
          dependencies: { '@libsql/core': '^0.14.0' }
        }
      ],
      [
        '/node_modules/@libsql/core/package.json',
        { name: '@libsql/core', version: '0.14.0' }
      ],
      [
        '/node_modules/@node-rs/jieba/package.json',
        { name: '@node-rs/jieba', version: '2.0.1' }
      ]
    ])
    const closure = validateDependencyClosure({
      files: new Set(manifests.keys()),
      rootPackageNames: runtime.externalPackageRoots,
      readManifest: (manifestPath: string) => manifests.get(manifestPath)
    })

    expect(runtime.errors).toEqual([])
    expect(closure.errors).toEqual([])
  })
})
