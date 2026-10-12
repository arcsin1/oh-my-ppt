import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { createHash } from 'node:crypto'
import os from 'os'
import path from 'path'
import { readdirSync, statSync } from 'node:fs'

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => path.join(os.tmpdir(), 'ohmyppt-bundled-font-test')), isPackaged: false }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))

import { collectEmbeddedFonts } from '../../../src/main/io/html-pptx/font-collect'

// 回归背景：v2.8.3 及更早版本捆绑的 Google Fonts 分片是「可变字体默认实例」，
// 同一字体族所有字重的文件轮廓完全相同（全部是 Thin），只有 faces.css 声明了
// 不同 weight——导出的加粗槽装的是常规轮廓，WPS/PowerPoint 打开后加粗不黑。
// 这两个用例分别守住：1) 捆绑分片本身字重真实；2) 存量项目导出时会用捆绑
// 分片刷新项目资产。

const GOOGLE_FONTS_ROOT = path.resolve('resources/google-fonts')

const decodeShard = async (filePath: string): Promise<any> => {
  const { decompress } = await import('woff2-encoder')
  const { createFont } = await import('fonteditor-core')
  const woff2 = new Uint8Array(await readFile(filePath))
  const sfnt = await decompress(woff2)
  const ab = sfnt.buffer.slice(sfnt.byteOffset, sfnt.byteOffset + sfnt.byteLength)
  return createFont(ab, { type: 'ttf', subset: [], hinting: false, compound2simple: true }).get()
}

const glyphMap = (ttf: any): Map<number, any> => {
  const map = new Map<number, any>()
  for (const glyph of ttf.glyf) {
    if (Array.isArray(glyph.unicode)) {
      for (const code of glyph.unicode) map.set(code, glyph)
    }
  }
  return map
}

const bundledFamilies = (): string[] =>
  readdirSync(GOOGLE_FONTS_ROOT).filter((name) => {
    const dir = path.join(GOOGLE_FONTS_ROOT, name)
    return statSync(dir).isDirectory() && readdirSync(dir).some((f) => f.endsWith('.woff2'))
  })

describe('bundled google font shards carry real per-weight outlines', () => {
  it('multi-weight families decode to distinct outlines per weight', async () => {
    for (const family of bundledFamilies()) {
      const dir = path.join(GOOGLE_FONTS_ROOT, family)
      const files = readdirSync(dir).filter((f) => f.endsWith('.woff2'))
      const weights = [...new Set(files.map((f) => Number.parseInt(f.split('-')[0], 10)))]
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b)
      if (weights.length < 2) continue

      const lowest = weights[0]
      const highest = weights[weights.length - 1]
      for (const weight of weights) {
        const file =
          files.find((f) => f.startsWith(`${weight}-normal-`) && !/-0\.woff2$/.test(f)) ||
          files.find((f) => f.startsWith(`${weight}-normal-`))
        expect(file, `${family} w${weight} shard missing`).toBeTruthy()
        const ttf = await decodeShard(path.join(dir, file as string))
        expect(
          ttf['OS/2']?.usWeightClass,
          `${family} ${file} usWeightClass should match declared weight`
        ).toBe(weight)
      }

      const loFile =
        files.find((f) => f.startsWith(`${lowest}-normal-`) && !/-0\.woff2$/.test(f)) ||
        files.find((f) => f.startsWith(`${lowest}-normal-`))
      const hiFile =
        files.find((f) => f.startsWith(`${highest}-normal-`) && !/-0\.woff2$/.test(f)) ||
        files.find((f) => f.startsWith(`${highest}-normal-`))
      const lo = glyphMap(await decodeShard(path.join(dir, loFile as string)))
      const hi = glyphMap(await decodeShard(path.join(dir, hiFile as string)))
      const shared = [...lo.keys()].filter(
        (code) => hi.has(code) && code > 0x20 && lo.get(code).contours
      )
      expect(shared.length, `${family} has shared codepoints across weights`).toBeGreaterThan(0)
      const differing = shared.filter(
        (code) => JSON.stringify(lo.get(code).contours) !== JSON.stringify(hi.get(code).contours)
      )
      expect(
        differing.length,
        `${family} w${lowest} vs w${highest} outlines must differ (bold must not be a regular clone)`
      ).toBeGreaterThan(0)
    }
  })
})

describe('collectEmbeddedFonts refreshes project bundled-font assets', () => {
  const roots: string[] = []

  afterEach(async () => {
    for (const root of roots.splice(0)) {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('overwrites a corrupted project shard with the bundled copy before collecting', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-font-refresh-'))
    roots.push(projectDir)
    const familyDir = 'Noto_Sans_SC'
    const targetDir = path.join(projectDir, 'assets', 'fonts', 'google-fonts', familyDir)
    await mkdir(targetDir, { recursive: true })

    // 只拷少量分片（收集用不到的会被刷新补齐，不影响断言）
    const bundled = path.join(GOOGLE_FONTS_ROOT, familyDir)
    const bundledFiles = readdirSync(bundled).filter((f) => f.endsWith('.woff2'))
    const probes = [
      bundledFiles.find((f) => f.startsWith('400-normal-1.')),
      bundledFiles.find((f) => f.startsWith('700-normal-1.'))
    ].filter((f): f is string => Boolean(f))
    expect(probes.length).toBeGreaterThan(0)
    for (const file of probes) {
      await copyFile(path.join(bundled, file), path.join(targetDir, file))
    }

    const facesCss = await readFile(path.join(bundled, 'faces.css'), 'utf-8')
    const blocks = facesCss
      .split(/@font-face\s*\{/)
      .slice(1)
      .map((block) => block.slice(0, block.indexOf('}')).trim())
      .filter((body) => probes.some((p) => body.includes(p)))
      .map(
        (body) =>
          `@font-face{${body.replace(/url\(\s*"\.\//g, 'url("./assets/fonts/google-fonts/Noto_Sans_SC/')}}`
      )
    const pageHtml = path.join(projectDir, 'page.html')
    await writeFile(
      pageHtml,
      `<!doctype html><html><head><meta charset="utf-8"><style>${blocks.join('\n')}</style></head><body></body></html>`,
      'utf-8'
    )

    // 损坏项目内的分片
    const probe = probes[0]
    await writeFile(path.join(targetDir, probe), 'corrupted-bytes')

    const slides = [
      {
        texts: [
          { text: '常规文本', x: 1, y: 1, w: 8, h: 1, fontSize: 18, fontFace: 'Noto Sans SC' },
          {
            text: '加粗文本',
            x: 1,
            y: 2.5,
            w: 8,
            h: 1,
            fontSize: 28,
            fontFace: 'Noto Sans SC',
            bold: true
          }
        ]
      }
    ] as any

    await collectEmbeddedFonts(projectDir, slides, {
      mode: 'always',
      pageHtmlPaths: [pageHtml]
    })

    const restored = await readFile(path.join(targetDir, probe))
    const bundledBytes = await readFile(path.join(bundled, probe))
    expect(createHash('sha256').update(restored).digest('hex')).toBe(
      createHash('sha256').update(bundledBytes).digest('hex')
    )
  })
})
