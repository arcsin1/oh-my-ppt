import { afterEach, describe, expect, it } from 'vitest'
import { copyFile, mkdtemp, mkdir, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { createFont } from 'fonteditor-core'
import type { HtmlToPptxSlide } from '@arcsin1/html2pptx'
import { collectEmbeddedFonts } from '../../../src/main/io/html-pptx/font-collect'

const tempDirectories: string[] = []

const readEotHeaderNames = (data: Uint8Array): { family: string; style: string } => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 82
  const readName = (): string => {
    const byteLength = view.getUint16(offset, true)
    offset += 2
    const value = new TextDecoder('utf-16le').decode(data.slice(offset, offset + byteLength))
    offset += byteLength + 2
    return value
  }
  return { family: readName(), style: readName() }
}

const isPlainSfnt = (data: Uint8Array): boolean =>
  (data[0] === 0x00 && data[1] === 0x01 && data[2] === 0x00 && data[3] === 0x00) ||
  (data[0] === 0x4f && data[1] === 0x54 && data[2] === 0x54 && data[3] === 0x4f)

const readSfntNames = (data: Uint8Array): { family: string; style: string } => {
  const arrayBuffer = new ArrayBuffer(data.byteLength)
  new Uint8Array(arrayBuffer).set(data)
  const isCff = data[0] === 0x4f && data[1] === 0x54 && data[2] === 0x54 && data[3] === 0x4f
  const font = createFont(arrayBuffer, { type: isCff ? 'otf' : 'ttf', hinting: false })
  const ttf = font.get()
  return { family: ttf.name.fontFamily, style: ttf.name.fontSubFamily }
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('PPTX font embedding', () => {
  it('embeds only the user font faces actually used by exported text', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'oh-my-ppt-font-'))
    tempDirectories.push(projectDir)
    const userFontsDir = path.join(projectDir, 'assets', 'fonts', 'user-fonts')
    const titleDir = path.join(userFontsDir, 'title-font')
    const bodyDir = path.join(userFontsDir, 'body-font')
    await Promise.all([mkdir(titleDir, { recursive: true }), mkdir(bodyDir, { recursive: true })])

    const regularSource = path.resolve('resources/google-fonts/Poppins/400-normal-0.woff2')
    const boldSource = path.resolve('resources/google-fonts/Poppins/700-normal-0.woff2')
    await Promise.all([
      copyFile(boldSource, path.join(titleDir, 'title.woff2')),
      copyFile(regularSource, path.join(bodyDir, 'body.woff2'))
    ])

    const htmlPath = path.join(projectDir, 'page-1.html')
    await writeFile(
      htmlPath,
      `<style>
        @font-face { font-family: "User Title"; src: url("./assets/fonts/user-fonts/title-font/title.woff2") format("woff2"); font-weight: 700; font-style: normal; }
        @font-face { font-family: "User Body"; src: url("./assets/fonts/user-fonts/body-font/body.woff2") format("woff2"); font-weight: 400; font-style: normal; }
      </style>`,
      'utf-8'
    )

    const slides: HtmlToPptxSlide[] = [
      {
        texts: [
          { text: 'Title', x: 0, y: 0, w: 2, h: 0.4, fontSize: 20, fontFace: 'User Title', bold: true },
          { text: 'Body', x: 0, y: 1, w: 2, h: 0.3, fontSize: 12, fontFace: 'User Body' }
        ]
      }
    ]

    const embeddedFonts = await collectEmbeddedFonts(projectDir, slides, {
      mode: 'always',
      pageHtmlPaths: [htmlPath]
    })

    expect(embeddedFonts).toHaveLength(2)
    expect(embeddedFonts.map((font) => [font.fontFace, font.style]).sort()).toEqual([
      ['User Body', 'regular'],
      ['User Title', 'bold']
    ])
    // 默认载荷必须是裸 TTF（sfnt）：PowerPoint for Mac 对 EOT 容器载荷不应用 b="1"
    expect(embeddedFonts.every((font) => isPlainSfnt(font.ttfBuffer))).toBe(true)
    expect(
      embeddedFonts.map((font) => readSfntNames(font.ttfBuffer)).sort((a, b) => a.family.localeCompare(b.family))
    ).toEqual([
      { family: 'User Body', style: 'Regular' },
      { family: 'User Title', style: 'Bold' }
    ])
  })

  it('still emits an EOT container payload when explicitly requested', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'oh-my-ppt-font-'))
    tempDirectories.push(projectDir)
    const fontDir = path.join(projectDir, 'assets', 'fonts', 'user-fonts', 'legacy')
    await mkdir(fontDir, { recursive: true })
    await copyFile(
      path.resolve('resources/google-fonts/Poppins/400-normal-0.woff2'),
      path.join(fontDir, 'font.woff2')
    )

    const htmlPath = path.join(projectDir, 'page-1.html')
    await writeFile(
      htmlPath,
      `<style>@font-face { font-family: "EOT Face"; src: url("./assets/fonts/user-fonts/legacy/font.woff2") format("woff2"); font-weight: 400; font-style: normal; }</style>`,
      'utf-8'
    )

    const slides: HtmlToPptxSlide[] = [
      {
        texts: [{ text: 'Body', x: 0, y: 1, w: 2, h: 0.3, fontSize: 12, fontFace: 'EOT Face' }]
      }
    ]

    const embeddedFonts = await collectEmbeddedFonts(projectDir, slides, {
      mode: 'always',
      payloadFormat: 'eot',
      pageHtmlPaths: [htmlPath]
    })

    expect(embeddedFonts).toHaveLength(1)
    const names = readEotHeaderNames(embeddedFonts[0].ttfBuffer)
    expect(names.family).toBe('EOT Face')
    expect(names.style).toBe('Regular')
  })

  it('produces a plain sfnt payload when payloadFormat is ttf', async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), 'oh-my-ppt-font-'))
    tempDirectories.push(projectDir)
    const fontDir = path.join(projectDir, 'assets', 'fonts', 'user-fonts', 'exp')
    await mkdir(fontDir, { recursive: true })
    await copyFile(
      path.resolve('resources/google-fonts/Poppins/400-normal-0.woff2'),
      path.join(fontDir, 'font.woff2')
    )

    const htmlPath = path.join(projectDir, 'page-1.html')
    await writeFile(
      htmlPath,
      `<style>@font-face { font-family: "TTF Face"; src: url("./assets/fonts/user-fonts/exp/font.woff2") format("woff2"); font-weight: 400; font-style: normal; }</style>`,
      'utf-8'
    )

    const slides: HtmlToPptxSlide[] = [
      {
        texts: [{ text: 'Body', x: 0, y: 1, w: 2, h: 0.3, fontSize: 12, fontFace: 'TTF Face' }]
      }
    ]

    const embeddedFonts = await collectEmbeddedFonts(projectDir, slides, {
      mode: 'always',
      payloadFormat: 'ttf',
      pageHtmlPaths: [htmlPath]
    })

    expect(embeddedFonts).toHaveLength(1)
    const payload = embeddedFonts[0].ttfBuffer
    expect(isPlainSfnt(payload)).toBe(true)

    const names = readSfntNames(payload)
    expect(names.family).toBe('TTF Face')
    expect(names.style).toBe('Regular')
  })
})
