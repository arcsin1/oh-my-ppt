import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { unzipSync, zipSync } from 'fflate'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), 'ohmyppt-test-user-data'))
  }
}))

vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

vi.mock('../../../src/main/ipc/io/assets-handlers', () => ({
  allowLocalAssetRoot: vi.fn()
}))
import {
  compareStyleVersion,
  listStylePackageDirectories,
  normalizeStyleVersion,
  readStylePackage,
  writeStylePackage
} from '../../../src/main/styles/style-package'
import { initializeStyles } from '../../../src/main/styles/style-initializer'
import { setStylesRuntime } from '../../../src/main/styles/style-runtime'
import {
  backfillUserStylePackagesFromDatabase,
  createStyleSkill,
  deleteStyleSkill,
  exportStylePackageZip,
  importStylePackageDirectory,
  importStylePackageZip,
  saveGeneratedStylePreview,
  setStyleDb,
  updateStyleSkill
} from '../../../src/main/utils/style-skills'

async function makeStyle(
  root: string,
  style: string,
  version: string,
  skillMarkdown = '# Style Skill\n'
): Promise<void> {
  const styleDir = path.join(root, style)
  await mkdir(styleDir, { recursive: true })
  await writeFile(
    path.join(styleDir, 'style.json'),
    JSON.stringify(
      {
        style,
        name: { zh: '极简白', en: 'Minimal White' },
        description: 'Test style',
        category: '测试',
        aliases: ['minimal'],
        styleCase: 'Unit test',
        version,
        source: 'builtin'
      },
      null,
      2
    ) + '\n',
    'utf8'
  )
  await writeFile(path.join(styleDir, 'SKILL.md'), skillMarkdown, 'utf8')
  await writeFile(path.join(styleDir, 'preview.html'), '<!doctype html><html><body></body></html>', 'utf8')
}

function makeStyleZip(style = 'imported-style', includePreview = true): Uint8Array {
  const files: Record<string, Uint8Array> = {
    [style + '/style.json']: Buffer.from(
      JSON.stringify(
        {
          style,
          name: { zh: '导入风格', en: 'Imported Style' },
          description: 'Imported package',
          category: '测试',
          aliases: ['imported'],
          styleCase: 'Zip import',
          version: '1.2.3',
          source: 'custom'
        },
        null,
        2
      ) + '\n'
    ),
    [style + '/SKILL.md']: Buffer.from('imported skill\n')
  }
  if (includePreview) {
    files[style + '/preview.html'] = Buffer.from('<!doctype html><html><body>preview</body></html>')
  }
  return zipSync(files)
}

function makeStyleDb() {
  const rows: Array<Record<string, unknown>> = []
  return {
    rows,
    db: {
      listStyleRowsSync: vi.fn(() => rows),
      getStyleRowByStyleSync: vi.fn((style: string) => rows.find((row) => row.style === style)),
      getStyleRowSync: vi.fn((id: string) => rows.find((row) => row.id === id)),
      createStyleRow: vi.fn(async (row: Record<string, unknown>) => {
        rows.push({
          ...row,
          aliases: JSON.stringify(row.aliases || []),
          active: true,
          createdAt: 1,
          updatedAt: 1
        })
        return row.id
      }),
      updateStyleRow: vi.fn(async (id: string, patch: Record<string, unknown>) => {
        const row = rows.find((item) => item.id === id)
        if (row) Object.assign(row, patch)
      })
    }
  }
}

describe('style packages', () => {
  it('uses semver strings for style package versions', () => {
    expect(normalizeStyleVersion(1)).toBe('1.0.0')
    expect(normalizeStyleVersion('v2.3')).toBe('2.3.0')
    expect(compareStyleVersion('1.10.0', '1.2.0')).toBeGreaterThan(0)
  })

  it('reads and writes style.json + SKILL.md + preview.html packages', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-package-'))
    const dir = path.join(tmp, 'minimal-white')
    await writeStylePackage({
      dir,
      json: {
        style: 'minimal-white',
        name: { zh: '极简白', en: 'Minimal White' },
        description: 'Test style',
        category: '测试',
        aliases: ['minimal'],
        styleCase: 'Unit test',
        version: '1.0.0',
        source: 'builtin'
      },
      skillMarkdown: '# Minimal White\n'
    })

    const pkg = await readStylePackage(dir)
    expect(pkg.json).toMatchObject({
      style: 'minimal-white',
      name: { zh: '极简白', en: 'Minimal White' },
      version: '1.0.0'
    })
    expect(pkg.skillMarkdown).toContain('Minimal White')
    const rawJson = JSON.parse(await readFile(path.join(dir, 'style.json'), 'utf8'))
    expect(rawJson.schemaVersion).toBeUndefined()
    expect(rawJson.styleSkill).toBeUndefined()
  })

  it('allows standard inline SVG namespace declarations in preview.html', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-svg-preview-'))
    const dir = path.join(tmp, 'svg-preview')

    await writeStylePackage({
      dir,
      json: {
        style: 'svg-preview',
        name: { zh: 'SVG 预览', en: 'SVG Preview' },
        description: 'Inline SVG preview',
        category: '测试',
        aliases: [],
        styleCase: 'Unit test',
        version: '1.0.0',
        source: 'custom'
      },
      skillMarkdown: '# SVG Preview\n',
      previewHtml:
        '<!doctype html><html><body><svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gradient"></linearGradient></defs><rect fill="url(#gradient)" /></svg></body></html>'
    })

    await expect(readStylePackage(dir)).resolves.toMatchObject({ previewPath: path.join(dir, 'preview.html') })
  })

  it.each([
    '<!doctype html><html><body><img src="https://example.com/image.png"></body></html>',
    '<!doctype html><html><body><img src="data:image/png;base64,AAAA"></body></html>',
    '<!doctype html><html><body><a href="javascript:alert(1)">open</a></body></html>',
    '<!doctype html><html><body onload="alert(1)"></body></html>',
    '<!doctype html><html><body><iframe srcdoc="&lt;img src=https://example.com/a.png&gt;"></iframe></body></html>',
    '<!doctype html><html><style>body{background:url(http://example.com/bg.png)}</style></html>',
    '<!doctype html><html><style>body{background:url(\\68 ttp://example.com/bg.png)}</style></html>',
    '<!doctype html><html><style>@import "https://example.com/style.css";</style></html>',
    '<!doctype html><html><meta http-equiv="refresh" content="0; url=https://example.com"></html>'
  ])('rejects unsafe references or executable markup in preview.html', async (previewHtml) => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-remote-preview-'))

    await expect(
      writeStylePackage({
        dir: path.join(tmp, 'remote-preview'),
        json: {
          style: 'remote-preview',
          name: { zh: '远程预览', en: 'Remote Preview' },
          description: 'Remote preview',
          category: '测试',
          aliases: [],
          styleCase: 'Unit test',
          version: '1.0.0',
          source: 'custom'
        },
        skillMarkdown: '# Remote Preview\n',
        previewHtml
      })
    ).rejects.toThrow(/forbidden|Forbidden/)
  })

  it('rejects oversized preview.html files before persisting them', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-large-preview-'))

    await expect(
      writeStylePackage({
        dir: path.join(tmp, 'large-preview'),
        json: {
          style: 'large-preview',
          name: { zh: '大预览', en: 'Large Preview' },
          description: 'Large preview',
          category: '测试',
          aliases: [],
          styleCase: 'Unit test',
          version: '1.0.0',
          source: 'custom'
        },
        skillMarkdown: '# Large Preview\n',
        previewHtml: '<!doctype html><html><body>' + 'x'.repeat(1024 * 1024) + '</body></html>'
      })
    ).rejects.toThrow('preview.html must not exceed 1MB')
  })

  it('rewrites old installed system packages from bundled styles', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-init-'))
    const bundled = path.join(tmp, 'bundled')
    const installed = path.join(tmp, 'installed')
    await makeStyle(bundled, 'minimal-white', '1.0.0', 'new skill\n')

    const oldInstalledDir = path.join(installed, 'system', 'minimal-white')
    await mkdir(oldInstalledDir, { recursive: true })
    await writeFile(
      path.join(oldInstalledDir, 'style.json'),
      JSON.stringify(
        {
          style: 'minimal-white',
          styleName: '旧极简白',
          description: 'Old style',
          category: '旧',
          aliases: [],
          styleCase: '',
          version: '1.0.0',
          source: 'builtin',
          styleSkill: 'old inline skill'
        },
        null,
        2
      ) + '\n',
      'utf8'
    )
    await writeFile(path.join(oldInstalledDir, 'preview.html'), '<!doctype html><html></html>', 'utf8')

    const result = await initializeStyles({
      bundledSourcePath: bundled,
      installedRootPath: installed
    })

    expect(result.copiedCount).toBe(1)
    expect(result.skippedCount).toBe(0)
    const pkg = await readStylePackage(oldInstalledDir)
    expect(pkg.skillMarkdown).toBe('new skill\n')
    expect(pkg.json.name).toEqual({ zh: '极简白', en: 'Minimal White' })
  })

  it('skips system style sync when release manifest version is unchanged', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-system-manifest-'))
    const bundled = path.join(tmp, 'bundled')
    const installed = path.join(tmp, 'installed')
    await makeStyle(bundled, 'minimal-white', '1.0.0', 'new skill\n')
    await writeFile(
      path.join(bundled, 'manifest.json'),
      JSON.stringify({ version: '1.0.0', time: '2026-06-13', author: 'arcsin1' }, null, 2) + '\n',
      'utf8'
    )

    const first = await initializeStyles({
      bundledSourcePath: bundled,
      installedRootPath: installed
    })
    expect(first.copiedCount).toBe(1)
    expect(first.skippedCount).toBe(0)
    await writeFile(path.join(installed, 'system', 'minimal-white', 'SKILL.md'), 'local unchanged\n', 'utf8')

    const second = await initializeStyles({
      bundledSourcePath: bundled,
      installedRootPath: installed
    })
    expect(second).toMatchObject({
      bundledCount: 0,
      copiedCount: 0,
      skippedCount: 1,
      failedCount: 0
    })
    const pkg = await readStylePackage(path.join(installed, 'system', 'minimal-white'))
    expect(pkg.skillMarkdown).toBe('local unchanged\n')
  })

  it('installs and retains only the approved internal system style', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-internal-scope-'))
    const bundled = path.join(tmp, 'bundled')
    const installed = path.join(tmp, 'installed')
    await makeStyle(bundled, 'anjian-corporate', '1.0.0')
    await makeStyle(bundled, 'minimal-white', '1.0.0')
    await writeFile(
      path.join(bundled, 'manifest.json'),
      JSON.stringify({ version: '2.1.1', time: '2026-07-20', author: '安居建业' }, null, 2) + '\n',
      'utf8'
    )
    await makeStyle(path.join(installed, 'system'), 'legacy-generic', '1.0.0')

    const result = await initializeStyles({
      bundledSourcePath: bundled,
      installedRootPath: installed,
      allowedStyleKeys: new Set(['anjian-corporate'])
    })

    expect(result).toMatchObject({
      bundledCount: 1,
      copiedCount: 1,
      failedCount: 0
    })
    await expect(listStylePackageDirectories(path.join(installed, 'system'))).resolves.toEqual([
      'anjian-corporate'
    ])
  })

  it('lists style package directories with valid names and style.json files', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-package-list-'))
    await makeStyle(tmp, 'minimal-white', '1.0.0')
    await makeStyle(tmp, 'tokyo-night', '1.0.0')
    await mkdir(path.join(tmp, 'missing-json'), { recursive: true })
    await writeFile(path.join(tmp, 'not-a-dir'), 'ignored', 'utf8')
    await mkdir(path.join(tmp, '.minimal-white-tmp'), { recursive: true })

    await expect(listStylePackageDirectories(tmp)).resolves.toEqual(['minimal-white', 'tokyo-night'])
  })

  it('imports and exports strict style package zips', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-zip-'))
    const installed = path.join(tmp, 'installed')
    const sourceZip = path.join(tmp, 'imported-style.zip')
    await writeFile(sourceZip, Buffer.from(makeStyleZip()))
    setStylesRuntime({ installedStylesPath: installed, ready: Promise.resolve() })
    const fake = makeStyleDb()
    setStyleDb(fake.db as never)

    const imported = await importStylePackageZip(sourceZip)
    expect(imported).toEqual({ id: 'imported-style', source: 'custom' })
    const installedPackage = await readStylePackage(path.join(installed, 'user', 'imported-style'))
    expect(installedPackage.json.version).toBe('1.2.3')
    expect(installedPackage.skillMarkdown).toBe('imported skill\n')
    expect(await readFile(installedPackage.previewPath || '', 'utf8')).toContain('preview')

    const outputZip = path.join(tmp, 'exported.zip')
    await exportStylePackageZip('imported-style', outputZip)
    const exported = unzipSync(new Uint8Array(await readFile(outputZip)))
    expect(Object.keys(exported).sort()).toEqual([
      'imported-style/SKILL.md',
      'imported-style/preview.html',
      'imported-style/style.json'
    ])
  })

  it('imports a style package directory and ignores unrelated files', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-directory-'))
    const installed = path.join(tmp, 'installed')
    await makeStyle(tmp, 'hand-drawn-autumn', '1.0.0', '# Hand-drawn Autumn\n')
    const sourceDir = path.join(tmp, 'hand-drawn-autumn')
    await mkdir(path.join(sourceDir, '.claude'), { recursive: true })
    await writeFile(path.join(sourceDir, '.claude', 'settings.local.json'), '{}', 'utf8')
    await mkdir(path.join(sourceDir, 'assets', 'nested'), { recursive: true })
    await writeFile(path.join(sourceDir, 'assets', 'nested', 'texture.png'), 'ignored', 'utf8')
    await writeFile(path.join(sourceDir, 'README.md'), 'ignored', 'utf8')
    await writeFile(path.join(sourceDir, 'notes.txt'), 'ignored', 'utf8')
    setStylesRuntime({ installedStylesPath: installed, ready: Promise.resolve() })
    setStyleDb(makeStyleDb().db as never)

    await expect(importStylePackageDirectory(sourceDir)).resolves.toEqual({
      id: 'hand-drawn-autumn',
      source: 'custom'
    })
    const installedDir = path.join(installed, 'user', 'hand-drawn-autumn')
    const installedPackage = await readStylePackage(installedDir)
    expect(installedPackage.skillMarkdown).toBe('# Hand-drawn Autumn\n')
    expect((await readdir(installedDir)).sort()).toEqual(['SKILL.md', 'preview.html', 'style.json'])
  })

  it('backfills legacy user styles into user packages without preview.html', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-legacy-backfill-'))
    const installed = path.join(tmp, 'installed')
    setStylesRuntime({ installedStylesPath: installed, ready: Promise.resolve() })
    const fake = makeStyleDb()
    fake.rows.push({
      id: 'style-bgnyzgo0pd66',
      style: 'style-bgnyzgo0pd66',
      styleName: '旧解析风格',
      styleNameZh: '旧解析风格',
      styleNameEn: '',
      description: 'legacy parsed style',
      category: '自定义',
      aliases: '[]',
      source: 'custom',
      styleSkill: 'legacy parsed skill\n',
      version: '1.0.0',
      styleCase: '',
      packageDir: '',
      active: true,
      createdAt: 1,
      updatedAt: 1
    })
    setStyleDb(fake.db as never)

    const result = await backfillUserStylePackagesFromDatabase(installed)
    expect(result).toEqual({ scanned: 1, created: 1, skipped: 0, failed: 0 })
    const packageDir = path.join(installed, 'user', 'style-bgnyzgo0pd66')
    const stylePackage = await readStylePackage(packageDir)
    expect(stylePackage.json.name.zh).toBe('旧解析风格')
    expect(stylePackage.skillMarkdown).toBe('legacy parsed skill\n')
    expect(stylePackage.previewPath).toBeUndefined()
    expect(fake.rows[0].packageDir).toBe('user/style-bgnyzgo0pd66')

    const outputZip = path.join(tmp, 'legacy-exported.zip')
    await exportStylePackageZip('style-bgnyzgo0pd66', outputZip)
    const exported = unzipSync(new Uint8Array(await readFile(outputZip)))
    expect(Object.keys(exported).sort()).toEqual([
      'style-bgnyzgo0pd66/SKILL.md',
      'style-bgnyzgo0pd66/style.json'
    ])
  })

  it('creates styles without a preview and preserves an existing preview on update', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-create-no-preview-'))
    const installed = path.join(tmp, 'installed')
    setStylesRuntime({ installedStylesPath: installed, ready: Promise.resolve() })
    const fake = makeStyleDb()
    setStyleDb(fake.db as never)

    await createStyleSkill({
      id: 'parsed-style',
      label: '解析风格',
      description: 'Parsed style',
      category: '自定义',
      aliases: [],
      prompt: '# Parsed Style\n',
      styleCase: '产品介绍'
    })

    const packageDir = path.join(installed, 'user', 'parsed-style')
    const createdPackage = await readStylePackage(packageDir)
    expect(createdPackage.previewPath).toBeUndefined()

    const previewPath = path.join(packageDir, 'preview.html')
    await writeFile(
      previewPath,
      '<!doctype html><html><body>keep preview</body></html>',
      'utf8'
    )
    await updateStyleSkill({
      id: 'parsed-style',
      label: '更新后的解析风格',
      description: 'Updated style',
      category: '自定义',
      aliases: [],
      prompt: '# Updated Parsed Style\n',
      styleCase: '产品介绍'
    })

    expect(await readFile(previewPath, 'utf8')).toContain('keep preview')
  })

  it('soft deletes builtin and custom styles from the active catalog', async () => {
    const fake = makeStyleDb()
    fake.rows.push(
      { id: 'builtin-style', style: 'builtin-style', source: 'builtin', active: true },
      { id: 'custom-style', style: 'custom-style', source: 'custom', active: true }
    )
    setStyleDb(fake.db as never)

    await expect(deleteStyleSkill('builtin-style')).resolves.toEqual({ deleted: true })
    await expect(deleteStyleSkill('custom-style')).resolves.toEqual({ deleted: true })
    expect(fake.rows).toEqual([
      expect.objectContaining({ id: 'builtin-style', active: false }),
      expect.objectContaining({ id: 'custom-style', active: false })
    ])
  })

  it('persists a generated builtin preview as a user override package', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-preview-override-'))
    const installed = path.join(tmp, 'installed')
    const systemDir = path.join(installed, 'system', 'minimal-white')
    setStylesRuntime({ installedStylesPath: installed, ready: Promise.resolve() })
    await writeStylePackage({
      dir: systemDir,
      json: {
        style: 'minimal-white',
        name: { zh: '极简白', en: 'Minimal White' },
        description: 'Test style',
        category: '测试',
        aliases: [],
        styleCase: 'Unit test',
        version: '1.0.0',
        source: 'builtin'
      },
      skillMarkdown: '# Minimal White\n'
    })
    const fake = makeStyleDb()
    fake.rows.push({
      id: 'minimal-white',
      style: 'minimal-white',
      styleName: '极简白',
      styleNameZh: '极简白',
      styleNameEn: 'Minimal White',
      description: 'Test style',
      category: '测试',
      aliases: '[]',
      source: 'builtin',
      styleSkill: '# Minimal White\n',
      version: '1.0.0',
      styleCase: 'Unit test',
      packageDir: 'system/minimal-white',
      active: true,
      createdAt: 1,
      updatedAt: 1
    })
    setStyleDb(fake.db as never)

    const result = await saveGeneratedStylePreview(
      'minimal-white',
      '<!doctype html><html><body>generated preview</body></html>'
    )

    expect(result.previewPath).toBe(
      path.join(installed, 'user', 'minimal-white', 'preview.html')
    )
    const overridePackage = await readStylePackage(path.join(installed, 'user', 'minimal-white'))
    expect(overridePackage.json.source).toBe('override')
    expect(await readFile(overridePackage.previewPath || '', 'utf8')).toContain('generated preview')
    expect(fake.rows[0]).toMatchObject({
      source: 'override',
      packageDir: 'user/minimal-white'
    })
    const systemPackage = await readStylePackage(systemDir)
    expect(systemPackage.previewPath).toBeUndefined()
  })

  it('does not backfill user packages with empty style skills', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-empty-skill-'))
    const installed = path.join(tmp, 'installed')
    setStylesRuntime({ installedStylesPath: installed, ready: Promise.resolve() })
    const fake = makeStyleDb()
    fake.rows.push({
      id: 'style-empty-skill',
      style: 'style-empty-skill',
      styleName: '空技能风格',
      styleNameZh: '空技能风格',
      styleNameEn: '',
      description: '',
      category: '自定义',
      aliases: '[]',
      source: 'custom',
      styleSkill: '   ',
      version: '1.0.0',
      styleCase: '',
      packageDir: '',
      active: true,
      createdAt: 1,
      updatedAt: 1
    })
    setStyleDb(fake.db as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await backfillUserStylePackagesFromDatabase(installed)
    expect(result).toEqual({ scanned: 1, created: 0, skipped: 0, failed: 1 })
    expect(warn).toHaveBeenCalledWith(
      '[styles] failed to backfill user style package',
      expect.objectContaining({
        styleId: 'style-empty-skill',
        message: expect.stringContaining(
          '跳过用户风格包回填：style-empty-skill。原因：style_skill 为空，无法生成 SKILL.md'
        )
      })
    )
    warn.mockRestore()
    await expect(readStylePackage(path.join(installed, 'user', 'style-empty-skill'))).rejects.toThrow()
  })

  it('does not backfill user packages with invalid style json metadata', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-invalid-json-'))
    const installed = path.join(tmp, 'installed')
    setStylesRuntime({ installedStylesPath: installed, ready: Promise.resolve() })
    const fake = makeStyleDb()
    fake.rows.push({
      id: 'style-invalid-json',
      style: 'Invalid Style Key',
      styleName: '非法风格',
      styleNameZh: '非法风格',
      styleNameEn: '',
      description: '',
      category: '自定义',
      aliases: '[]',
      source: 'custom',
      styleSkill: 'valid skill\n',
      version: '1.0.0',
      styleCase: '',
      packageDir: '',
      active: true,
      createdAt: 1,
      updatedAt: 1
    })
    setStyleDb(fake.db as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const result = await backfillUserStylePackagesFromDatabase(installed)
    expect(result).toEqual({ scanned: 1, created: 0, skipped: 0, failed: 1 })
    expect(warn).toHaveBeenCalledWith(
      '[styles] failed to backfill user style package',
      expect.objectContaining({
        styleId: 'style-invalid-json',
        message: expect.stringContaining(
          '跳过用户风格包回填：style-invalid-json。原因：style.json 无效'
        )
      })
    )
    warn.mockRestore()
    await expect(readStylePackage(path.join(installed, 'user', 'style-invalid-json'))).rejects.toThrow()
  })

  it('imports and exports package zips without preview.html', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-zip-no-preview-'))
    const installed = path.join(tmp, 'installed')
    const sourceZip = path.join(tmp, 'imported-style.zip')
    await writeFile(sourceZip, Buffer.from(makeStyleZip('imported-style', false)))
    setStylesRuntime({ installedStylesPath: installed, ready: Promise.resolve() })
    setStyleDb(makeStyleDb().db as never)

    await importStylePackageZip(sourceZip)
    const installedPackage = await readStylePackage(path.join(installed, 'user', 'imported-style'))
    expect(installedPackage.previewPath).toBeUndefined()

    const outputZip = path.join(tmp, 'exported.zip')
    await exportStylePackageZip('imported-style', outputZip)
    const exported = unzipSync(new Uint8Array(await readFile(outputZip)))
    expect(Object.keys(exported).sort()).toEqual([
      'imported-style/SKILL.md',
      'imported-style/style.json'
    ])
  })

  it('rejects zip packages with files outside the style root', async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-zip-invalid-'))
    const zipPath = path.join(tmp, 'bad.zip')
    await writeFile(
      zipPath,
      Buffer.from(
        zipSync({
          'style-a/style.json': Buffer.from('{}'),
          'style-a/SKILL.md': Buffer.from('skill'),
          'style-a/preview.html': Buffer.from('<!doctype html><html></html>'),
          'style-a/extra.txt': Buffer.from('extra')
        })
      )
    )
    setStylesRuntime({ installedStylesPath: path.join(tmp, 'installed'), ready: Promise.resolve() })
    setStyleDb(makeStyleDb().db as never)

    await expect(importStylePackageZip(zipPath)).rejects.toThrow(/必须只包含/)
  })
})
