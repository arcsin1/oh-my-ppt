import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { copyFile, mkdir, mkdtemp, readFile, writeFile, rm } from 'fs/promises'
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import os from 'os'
import path from 'path'
import { unzipSync, zipSync } from 'fflate'
import { collectEmbeddedFonts } from '../../../src/main/io/html-pptx/font-collect'

type ExperimentRun = {
  text: string
  x: number
  y: number
  w: number
  h: number
  fontSize: number
  fontFace: string
  bold?: boolean
}
type WriteHtmlToPptx = (
  outputPath: string,
  document: { title: string; slides: Array<{ texts: ExperimentRun[] }>; embeddedFonts?: unknown[] }
) => void

// vitest 把 '@arcsin1/html2pptx' 别名到作者本地的兄弟源码目录（本机不存在），
// 且该包的 CJS 入口在 "type": "module" 包内 require ESM 会直接报错；
// 因此用绝对路径动态导入 ESM 入口，绕开别名与坏掉的 CJS 入口。
const html2pptxNode = (await import(
  pathToFileURL(path.resolve('node_modules/@arcsin1/html2pptx/dist/node.js')).href
)) as { writeHtmlToPptx: WriteHtmlToPptx }
const writeHtmlToPptx = html2pptxNode.writeHtmlToPptx

const OUTPUT_DIR = process.env.FONT_EXPERIMENT_DIR
const GOOGLE_FONTS_ROOT = path.resolve('resources/google-fonts')

type FontFaceDecl = { file: string; unicodeRange?: string }

const parseFacesCss = (css: string): FontFaceDecl[] => {
  const faces: FontFaceDecl[] = []
  for (const match of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const block = match[1] || ''
    const rawUrl = block.match(/url\(\s*([^)]+?)\s*\)/)?.[1] || ''
    const file = rawUrl.replace(/^['"]|['"]$/g, '').replace(/^\.\//, '')
    if (!file || !file.endsWith('.woff2')) continue
    const unicodeRange = block.match(/unicode-range\s*:\s*([^;}]+)/i)?.[1]?.trim()
    faces.push({ file, unicodeRange: unicodeRange || undefined })
  }
  return faces
}

type FamilyFixture = {
  projectDir: string
  subsetHtmlPath: string
}

// 搭建一个最小导出环境：把某字体族全部 woff2 拷入项目 assets/fonts，
// 并生成带真实 unicode-range 的 @font-face 页面 HTML（与生产导出一致）。
const buildFamilyFixture = async (
  family: string,
  familyDirName: string,
  opts: { fullMerge?: boolean } = {}
): Promise<FamilyFixture> => {
  const projectDir = await mkdtemp(path.join(os.tmpdir(), 'oh-my-ppt-font-exp-'))
  const fontDir = path.join(projectDir, 'assets', 'fonts', 'user-fonts', 'exp')
  await mkdir(fontDir, { recursive: true })
  const sourceDir = path.join(GOOGLE_FONTS_ROOT, familyDirName)
  const faces = parseFacesCss(await readFile(path.join(sourceDir, 'faces.css'), 'utf-8'))
  expect(faces.length).toBeGreaterThan(0)
  for (const face of faces) {
    await copyFile(path.join(sourceDir, face.file), path.join(fontDir, face.file))
  }
  const blocks = faces
    .map((face) => {
      // fullMerge: 去掉 unicode-range → faceContainsUsage 恒 true → 全部分片合并（全量嵌入）
      const range = opts.fullMerge ? '' : face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ''
      return (
        `@font-face{font-family:"${family}";src:url("./assets/fonts/user-fonts/exp/${face.file}") format("woff2");` +
        `font-weight:400;font-style:normal;font-display:swap;${range}}`
      )
    })
    .join('\n')
  const htmlPath = path.join(projectDir, 'page.html')
  await writeFile(
    htmlPath,
    `<!doctype html><html><head><meta charset="utf-8"><style>${blocks}</style></head><body></body></html>`,
    'utf-8'
  )
  return { projectDir, subsetHtmlPath: htmlPath }
}

// EOT 头部布局（fonteditor-core EotHead）：EOTSize@0, FontDataSize@4, Version@8, Flags@12
const patchEotHeader = (
  buffer: Uint8Array,
  patch: { version?: number; flags?: number }
): Uint8Array => {
  const copy = new Uint8Array(buffer)
  const view = new DataView(copy.buffer)
  if (patch.version !== undefined) view.setUint32(8, patch.version, true)
  if (patch.flags !== undefined) view.setUint32(12, patch.flags, true)
  return copy
}

// app.xml 的 AppVersion 当前是 "00.09:0000"（含冒号，不符合 XX.YYYY 约定），改写为标准格式
const rewriteAppVersion = (pptxPath: string): void => {
  const zip = unzipSync(readFileSync(pptxPath))
  const appXml = Buffer.from(zip['docProps/app.xml'])
    .toString('utf-8')
    .replace(/<AppVersion>[^<]*<\/AppVersion>/, '<AppVersion>00.0000</AppVersion>')
  zip['docProps/app.xml'] = new Uint8Array(Buffer.from(appXml, 'utf-8'))
  writeFileSync(pptxPath, zipSync(zip))
}

const maShanZhengRun = (): ExperimentRun => ({
  text: '嵌字实验 ABC 123，永',
  x: 0.5,
  y: 0.5,
  w: 9,
  h: 1.2,
  fontSize: 44,
  fontFace: 'Ma Shan Zheng'
})

const assertPayloadMagic = (pptxPath: string, format: 'eot' | 'ttf'): void => {
  const zip = unzipSync(readFileSync(pptxPath))
  const fontEntries = Object.keys(zip).filter((name) => name.startsWith('ppt/fonts/'))
  expect(fontEntries.length).toBeGreaterThan(0)
  for (const entry of fontEntries) {
    const data = zip[entry]
    if (format === 'eot') {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
      expect(view.byteLength).toBeGreaterThan(82)
      expect(view.getUint16(34, true)).toBe(0x504c)
    } else {
      const isPlainTtf =
        data[0] === 0x00 && data[1] === 0x01 && data[2] === 0x00 && data[3] === 0x00
      const isCff = data[0] === 0x4f && data[1] === 0x54 && data[2] === 0x54 && data[3] === 0x4f
      expect(isPlainTtf || isCff).toBe(true)
    }
  }
  const presentation = Buffer.from(zip['ppt/presentation.xml']).toString('utf-8')
  expect(presentation).toContain('embedTrueTypeFonts="1"')
  expect(presentation).toContain('<p:embeddedFontLst>')
}

describe.skipIf(!OUTPUT_DIR)('PPTX font payload experiment', () => {
  const tempDirectories: string[] = []
  const generatedFiles: string[] = []

  const generate = async (
    fileName: string,
    fixture: FamilyFixture,
    runs: ExperimentRun[],
    opts: {
      payloadFormat: 'eot' | 'ttf'
      eotPatch?: { version?: number; flags?: number }
      omitFonts?: boolean
      fixAppVersion?: boolean
      overridePayload?: Uint8Array
    }
  ): Promise<void> => {
    const outPath = path.join(OUTPUT_DIR as string, fileName)
    const slides = [{ texts: runs }]
    let embedded = opts.omitFonts
      ? []
      : await collectEmbeddedFonts(fixture.projectDir, slides, {
          mode: 'always',
          payloadFormat: opts.payloadFormat,
          pageHtmlPaths: [fixture.subsetHtmlPath]
        })
    if (opts.eotPatch && embedded.length > 0) {
      embedded = embedded.map((item) => ({ ...item, ttfBuffer: patchEotHeader(item.ttfBuffer, opts.eotPatch!) }))
    }
    if (opts.overridePayload && embedded.length > 0) {
      embedded = embedded.map((item) => ({ ...item, ttfBuffer: opts.overridePayload! }))
    }
    writeHtmlToPptx(outPath, {
      title: '字体嵌入实验',
      slides,
      embeddedFonts: embedded.length > 0 ? embedded : undefined
    })
    if (opts.fixAppVersion) rewriteAppVersion(outPath)
    if (!opts.omitFonts) assertPayloadMagic(outPath, opts.payloadFormat)
    generatedFiles.push(fileName)
    console.log(
      `[experiment] ${fileName}: ${embedded
        .map((item) => `${item.style}=${Math.round(item.ttfBuffer.byteLength / 1024)}KB`)
        .join(', ') || 'no embedded fonts'}`
    )
  }

  beforeAll(async () => {
    await mkdir(OUTPUT_DIR as string, { recursive: true })
  })

  it(
    'generates variant 6: EOT with TTEMBED_SUBSET flag',
    async () => {
      const fixture = await buildFamilyFixture('Ma Shan Zheng', 'Ma_Shan_Zheng')
      tempDirectories.push(fixture.projectDir)
      await generate(
        '实验6-EOT子集标志.pptx',
        fixture,
        [maShanZhengRun()],
        { payloadFormat: 'eot', eotPatch: { flags: 0x00000001 } }
      )
    },
    120_000
  )

  it(
    'generates variant 7: EOT version 2.2 + TTEMBED_SUBSET flag',
    async () => {
      const fixture = await buildFamilyFixture('Ma Shan Zheng', 'Ma_Shan_Zheng')
      tempDirectories.push(fixture.projectDir)
      await generate(
        '实验7-EOTv22子集标志.pptx',
        fixture,
        [maShanZhengRun()],
        { payloadFormat: 'eot', eotPatch: { version: 0x00020002, flags: 0x00000001 } }
      )
    },
    120_000
  )

  it(
    'generates variant 8: standard AppVersion (00.0000)',
    async () => {
      const fixture = await buildFamilyFixture('Ma Shan Zheng', 'Ma_Shan_Zheng')
      tempDirectories.push(fixture.projectDir)
      await generate(
        '实验8-AppVersion标准.pptx',
        fixture,
        [maShanZhengRun()],
        { payloadFormat: 'eot', fixAppVersion: true }
      )
    },
    120_000
  )

  it(
    'generates variant 9: no embedded fonts (repair dialog control)',
    async () => {
      const fixture = await buildFamilyFixture('Ma Shan Zheng', 'Ma_Shan_Zheng')
      tempDirectories.push(fixture.projectDir)
      await generate(
        '实验9-无嵌入字体.pptx',
        fixture,
        [maShanZhengRun()],
        { payloadFormat: 'eot', omitFonts: true }
      )
    },
    120_000
  )

  it(
    'generates variant 10: TTF subset (current v2.8.1 default, WPS baseline)',
    async () => {
      const fixture = await buildFamilyFixture('Ma Shan Zheng', 'Ma_Shan_Zheng')
      tempDirectories.push(fixture.projectDir)
      await generate('实验10-TTF子集.pptx', fixture, [maShanZhengRun()], { payloadFormat: 'ttf' })
    },
    120_000
  )

  it(
    'generates variant 11: TTF full merge (no unicode-range)',
    async () => {
      const fixture = await buildFamilyFixture('Ma Shan Zheng', 'Ma_Shan_Zheng', { fullMerge: true })
      tempDirectories.push(fixture.projectDir)
      await generate('实验11-TTF全量.pptx', fixture, [maShanZhengRun()], { payloadFormat: 'ttf' })
    },
    180_000
  )

  it(
    'generates variant 12: canonical Google TTF payload (skip fonteditor serialization)',
    async () => {
      const canonicalPath = path.join(OUTPUT_DIR as string, 'MaShanZheng-Regular.ttf')
      const canonical = new Uint8Array(readFileSync(canonicalPath))
      expect(canonical.byteLength).toBeGreaterThan(1_000_000)
      const fixture = await buildFamilyFixture('Ma Shan Zheng', 'Ma_Shan_Zheng')
      tempDirectories.push(fixture.projectDir)
      await generate('实验12-原版TTF.pptx', fixture, [maShanZhengRun()], {
        payloadFormat: 'ttf',
        overridePayload: canonical
      })
    },
    120_000
  )

  it(
    'generates variant 13: EOT subset (old default, WPS positive control)',
    async () => {
      const fixture = await buildFamilyFixture('Ma Shan Zheng', 'Ma_Shan_Zheng')
      tempDirectories.push(fixture.projectDir)
      await generate('实验13-EOT子集.pptx', fixture, [maShanZhengRun()], { payloadFormat: 'eot' })
    },
    120_000
  )

  it('writes viewing instructions', async () => {
    const instructions = [
      '第四轮实验：定位 Windows WPS 不应用嵌入字体的原因',
      '',
      '已知矩阵（实测）：',
      '- EOT 载荷（旧默认）：WPS 显示正常；Mac PowerPoint 加粗丢失（b="1" 被忽略）',
      '- 裸 TTF 载荷（v2.8.1 现默认）：Mac PowerPoint 正常；Windows WPS 字体不对（本次要解）',
      '',
      '请用 Windows 的 WPS 依次打开以下文件，记录大号文字「嵌字实验 ABC 123，永」',
      '是否显示为毛笔书法体（Ma Shan Zheng）。也请顺手记下 WPS 版本号（首页菜单 → 关于）：',
      '',
      '10. 实验10-TTF子集.pptx — 裸 TTF 子集（= v2.8.1 默认，预期复现「字体不对」）',
      '11. 实验11-TTF全量.pptx — 裸 TTF 全量合并（排除子集缺字形/分片因素）',
      '12. 实验12-原版TTF.pptx — Google 原版 TTF 直接嵌入（排除 fonteditor 序列化差异）',
      '13. 实验13-EOT子集.pptx — EOT 容器（= 旧默认，历史上 WPS 正常，作对照）',
      '',
      '判读：',
      '- 10 错、11 对   → 子集策略问题（缺字形/分片），调子集逻辑',
      '- 10 错、12 对   → fonteditor 序列化问题（name 表/表顺序/校验和），修 buildPayload 的 TTF 分支',
      '- 10/11/12 全错、13 对 → WPS 只认 EOT 容器，与 Mac 只认 TTF 成僵局，需另想策略',
      '- 全错（含 13）  → 与载荷格式无关：WPS 版本不支持第三方嵌字或设置问题，报版本号即可'
    ].join('\n')
    await writeFile(path.join(OUTPUT_DIR as string, '说明.txt'), instructions, 'utf-8')
  })

  afterAll(async () => {
    await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })))
  })
})
