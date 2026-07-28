import fs from 'fs'
import path from 'path'
import log from 'electron-log/main.js'
import { nanoid } from 'nanoid'
import { HumanMessage } from '@langchain/core/messages'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import { isSupportedImageMimeType, normalizeImageMimeType } from '@shared/image-mime'
import { resolveModel } from '../agent'
import { extractModelText } from '../ipc/utils'
import { convertDocxToMarkdown } from '../utils/docx-to-markdown'
import type { ThinkingSource } from '@shared/thinking'

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.text', '.csv', '.docx'])
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_IMAGE_SIZE = 5 * 1024 * 1024

const toSafeFileName = (value: string): string =>
  value
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'source'

const mimeTypeFromExtension = (ext: string): string => {
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return ''
}

const buildImageTextExtractionPrompt = (name: string): string =>
  [
    `请只识别这张图片中的文字、数字、表格、图表标签、界面文案或可直接引用的数据。图片文件名：${name}`,
    '',
    '严格要求：',
    '- 只做文字/数据识别，不做视觉理解、图片摘要、用途建议或风格分析。',
    '- 不要描述配色、构图、审美、质感、版式、插画风格或设计方向。',
    '- 不要判断这张图适合做封面、插图、风格参考或证据素材。',
    '- 不要编造图片中不存在的文字、数字或事实。',
    '- 如果没有可识别文字或数据，只输出“未识别到明确文字内容”。',
    '',
    '请按以下 Markdown 小节输出：',
    '## Extracted Text',
    '## Extracted Data'
  ].join('\n')

const buildFallbackImageTextExtraction = (name: string): string =>
  [
    '## Extracted Text',
    `图片 ${name} 已上传，但未识别到明确文字内容。`,
    '',
    '## Extracted Data',
    '- 未识别到明确数据。'
  ].join('\n')

export type SourceKind = ThinkingSource['kind']

export interface PreparedSource {
  id: string
  name: string
  kind: SourceKind
  sourcePath: string
  assetsPath?: string
}

export interface ImageTextExtractionOptions {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  maxTokens?: number
  modelTimeoutMs: number
}

const IMAGE_TEXT_MARKER = '<!-- image-text-extracted -->'

function detectKind(ext: string): SourceKind {
  if (SUPPORTED_IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (ext === '.docx') return 'docx'
  if (ext === '.md') return 'markdown'
  if (ext === '.csv') return 'csv'
  return 'text'
}

async function extractImageText(args: {
  filePath: string
  name: string
  ext: string
  options: ImageTextExtractionOptions
}): Promise<string> {
  const mimeType = normalizeImageMimeType(mimeTypeFromExtension(args.ext))
  if (!isSupportedImageMimeType(mimeType)) {
    throw new Error(`不支持的图片格式：${mimeType || 'unknown'}`)
  }
  const imageBase64 = await fs.promises.readFile(args.filePath, 'base64')
  const imageBytes = Buffer.byteLength(imageBase64, 'base64')
  log.info('[thinking:image-text] invoke thinking image text model', {
    provider: args.options.provider,
    model: args.options.model,
    mimeType,
    imageBytes
  })
  const model = resolveModel(
    args.options.provider,
    args.options.apiKey,
    args.options.model,
    args.options.baseUrl,
    0.1,
    args.options.maxTokens
  )
  const result = await model.invoke(
    [
      new HumanMessage({
        content: [
          { type: 'text', text: buildImageTextExtractionPrompt(args.name) },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } }
        ]
      })
    ],
    {
      signal: AbortSignal.timeout(resolveModelTimeoutMs(args.options.modelTimeoutMs, 'document'))
    }
  )
  const response = extractModelText(result)
  return response.trim() || buildFallbackImageTextExtraction(args.name)
}

const parseImageAssetPath = (content: string): string => {
  const match = content.match(/^- thinkingAssetPath:\s*(.+)$/m)
  return match?.[1]?.trim() || ''
}

export async function extractPendingImageTextSources(
  thinkingDir: string,
  options: ImageTextExtractionOptions
): Promise<void> {
  const sourcesDir = path.join(thinkingDir, 'sources')
  if (!fs.existsSync(sourcesDir)) return

  const entries = await fs.promises.readdir(sourcesDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.image.md')) continue
    const sourcePath = path.join(sourcesDir, entry.name)
    const content = await fs.promises.readFile(sourcePath, 'utf-8')
    if (content.includes(IMAGE_TEXT_MARKER)) continue

    const imagePath = parseImageAssetPath(content)
    if (!imagePath || !fs.existsSync(imagePath)) continue

    try {
      const extractedText = await extractImageText({
        filePath: imagePath,
        name: path.basename(imagePath),
        ext: path.extname(imagePath).toLowerCase(),
        options
      })
      await fs.promises.writeFile(
        sourcePath,
        [
          content.trimEnd(),
          '',
          IMAGE_TEXT_MARKER,
          '## Notes',
          '- 以下内容仅来自图片中的文字/数据识别，不包含风格、配色、构图或用途分析。',
          '',
          extractedText.trim()
        ].join('\n') + '\n',
        'utf-8'
      )
    } catch (err) {
      log.warn('[thinking:source-prepare] image text extraction failed', {
        source: entry.name,
        message: err instanceof Error ? err.message : String(err)
      })
      await fs.promises.writeFile(
        sourcePath,
        [
          content.trimEnd(),
          '',
          IMAGE_TEXT_MARKER,
          '## Extracted Text',
          '- 图片文字识别失败。',
          '',
          '## Extracted Data',
          '- 未识别到明确数据。'
        ].join('\n') + '\n',
        'utf-8'
      )
    }
  }
}

export async function prepareSourceFile(
  filePath: string,
  thinkingDir: string
): Promise<PreparedSource> {
  const resolved = path.resolve(filePath)
  const stat = await fs.promises.stat(resolved)
  if (!stat.isFile()) throw new Error(`Not a file: ${resolved}`)

  const ext = path.extname(resolved).toLowerCase()
  const isImage = SUPPORTED_IMAGE_EXTENSIONS.has(ext)

  if (!SUPPORTED_EXTENSIONS.has(ext) && !isImage) {
    throw new Error(`Unsupported file type: ${ext}`)
  }

  if (isImage && stat.size > MAX_IMAGE_SIZE) {
    throw new Error(`Image file too large (max 5MB): ${path.basename(resolved)}`)
  }
  if (!isImage && stat.size > MAX_FILE_SIZE) {
    throw new Error(`File too large (max 10MB): ${path.basename(resolved)}`)
  }

  const sourcesDir = path.join(thinkingDir, 'sources')
  const assetsDir = path.join(thinkingDir, 'assets')
  await fs.promises.mkdir(sourcesDir, { recursive: true })
  await fs.promises.mkdir(assetsDir, { recursive: true })

  const kind = detectKind(ext)
  const baseName = path.basename(resolved, ext)
  const safeName = toSafeFileName(baseName)
  const stamp = Date.now()
  const uid = nanoid(8)

  const id = `${stamp}-${uid}-${safeName}`
  let sourcePath: string
  let assetsPath: string | undefined

  if (kind === 'docx') {
    const mdName = `${id}.md`
    sourcePath = path.join(sourcesDir, mdName)
    const markdown = await convertDocxToMarkdown(resolved)
    await fs.promises.writeFile(
      sourcePath,
      [`# ${baseName}`, '', `> Converted from Word .docx`, '', markdown].join('\n'),
      'utf-8'
    )
  } else if (kind === 'image') {
    const imgName = `${id}${ext}`
    const mdName = `${id}.image.md`
    sourcePath = path.join(sourcesDir, mdName)
    assetsPath = path.join(assetsDir, imgName)
    await fs.promises.copyFile(resolved, assetsPath)
    await fs.promises.writeFile(
      sourcePath,
      [
        `# 图片：${path.basename(resolved)}`,
        '',
        '## Asset',
        `- assetId: ${id}`,
        `- fileName: ${imgName}`,
        `- originalPath: ${resolved}`,
        `- thinkingAssetPath: ${assetsPath}`,
        `- thinkingPublicPath: assets/${imgName}`,
        '- sessionAssetPath: (set during generation copy)',
        '- publicPath: (set during generation copy)',
        '',
        '## Notes',
        '- 图片已复制到素材库，上传阶段不进行识别或解析。',
        '- 用户发送消息后才会识别图片中的文字/数据；不会解析图片风格。'
      ].join('\n'),
      'utf-8'
    )
  } else {
    const fileName = `${id}${ext}`
    sourcePath = path.join(sourcesDir, fileName)
    await fs.promises.copyFile(resolved, sourcePath)
  }

  log.info('[thinking:source-prepare] prepared', {
    kind,
    name: path.basename(resolved),
    id
  })

  return {
    id,
    name: path.basename(resolved),
    kind,
    sourcePath,
    assetsPath
  }
}

export async function prepareMultipleSources(
  filePaths: string[],
  thinkingDir: string
): Promise<PreparedSource[]> {
  const results: PreparedSource[] = []
  for (const filePath of filePaths) {
    results.push(await prepareSourceFile(filePath, thinkingDir))
  }
  return results
}
