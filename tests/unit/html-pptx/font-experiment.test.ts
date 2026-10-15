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
  familyDirName: string
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
    .map(
      (face) =>
        `@font-face{font-family:"${family}";src:url("./assets/fonts/user-fonts/exp/${face.file}") format("woff2");` +
        `font-weight:400;font-style:normal;font-display:swap;${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ''}}`
    )
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

  it('writes viewing instructions', async () => {
    const instructions = [
      '第三轮实验：定位 PowerPoint「修复」对话框的触发点',
      '',
      '已知背景：实验1（EOT 子集）在 Mac PowerPoint 上弹修复框，但修复后书法体仍在；',
      '真实导出文件同样弹框、字体也正常；WPS 里字体正常、只是排版不同。',
      '',
      '请用 Mac PowerPoint 依次打开以下文件，记录：是否弹修复框 + 是否显示毛笔书法体：',
      '',
      '6. 实验6-EOT子集标志.pptx   — EOT Flags 补上 TTEMBED_SUBSET(0x1)（真机子集字体应有的标志）',
      '7. 实验7-EOTv22子集标志.pptx — EOT Version 改为 0x00020002 + SUBSET 标志（贴近真机产物）',
      '8. 实验8-AppVersion标准.pptx — 修正 app.xml 的 AppVersion 为标准格式（字体不动）',
      '9. 实验9-无嵌入字体.pptx     — 完全不嵌字体（判断弹框是否与字体无关）',
      '',
      '判读：',
      '- 若 9 弹框 → 弹框与嵌入字体无关，重点看 8（AppVersion 修复是否解决）',
      '- 若 9 不弹、6/7 有一个不弹 → EOT 头字段是触发点，按胜出格式修 font-collect',
      '- 若 6/7/8/9 都弹 → 触发点在包的其他部分，需继续二分（theme/notes/rels 等）'
    ].join('\n')
    await writeFile(path.join(OUTPUT_DIR as string, '说明.txt'), instructions, 'utf-8')
  })

  afterAll(async () => {
    await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })))
  })
})
