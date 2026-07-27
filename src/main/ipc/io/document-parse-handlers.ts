import { ipcMain } from 'electron'
import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import log from 'electron-log/main.js'
import { nanoid } from 'nanoid'
import pLimit from 'p-limit'
import { resolveModel } from '../../agent'
import { extractJsonBlock, extractModelText } from '../utils'
import type { IpcContext } from '../context'
import type {
  DocumentPlanPageSkeletonItem,
  ParseDocumentPlanPayload,
  ParseImageReferencePayload,
  ParsedDocumentPlanResult,
  PrepareReferenceDocumentPayload,
  PreparedReferenceDocumentResult
} from '@shared/generation'
import { isSectionAgendaReason } from '@shared/generation'
import { MAX_CORPORATE_PAGE_COUNT } from '@shared/brand'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import { resolveGlobalModelTimeouts, resolveModelConfigForTask } from '../config/model-config-utils'
import { assertImageWasRead, isImageUnsupportedError } from '../../utils/style-image-import'
import { invokeVisionModelText } from '../../utils/vision-model'
import { convertPdfToMarkdown } from '../../utils/pdf-reference'
import { normalizeGeneratedPlan as normalizeDocumentPlan } from './document-plan-normalizer'
import { convertCsvTextToMarkdown } from './document-csv-to-markdown'
import {
  deriveOutlinePageCandidates,
  estimateOutlinePageCount,
  formatDocumentOutlineScanForPrompt,
  scanDocumentOutline,
  scanHasMultipleSlideCandidates,
  scanHeadingTitles,
  type DocumentOutlinePageCandidate,
  type DocumentOutlineScan
} from './document-outline-scan'
import {
  buildDocumentPlanPageSkeleton,
  sanitizeDocumentPlanPageSkeletonContent
} from './document-plan-page-skeleton'

type PreparedSourceFile = ParsedDocumentPlanResult['files'][number] & {
  originalPath: string
  workspacePath: string
  virtualPath: string
}

type PdfVisionConfig = {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  maxTokens: number | undefined
  modelTimeoutMs: number
}

const MAX_DOCUMENT_FILES = 1
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024
const MAX_PAGE_COUNT = MAX_CORPORATE_PAGE_COUNT
const MAX_PARSE_SOURCE_PREVIEW_CHARS = 20_000
const PAGE_SUMMARY_BATCH_SIZE = 10
const PAGE_SUMMARY_BATCH_CONCURRENCY = 2
const PAGE_SUMMARY_BATCH_START_DELAY_MS = 200
const PAGE_SUMMARY_BATCH_MAX_ATTEMPTS = 3
const MAX_PAGE_SUMMARY_PASSAGE_CHARS = 1_600
const MAX_PAGE_SUMMARY_TOTAL_PAGES = 300
const MAX_PAGE_SUMMARY_CHARS = 80

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.text', '.csv', '.docx', '.pdf'])
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}
const NULL_CHAR_PATTERN = new RegExp(String.fromCharCode(0), 'g')
const CJK_PATTERN = /[\u3400-\u9fff]/
const LATIN_WORD_PATTERN = /\b[A-Za-z][A-Za-z'-]{2,}\b/g

class RetryableDocumentPlanQualityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetryableDocumentPlanQualityError'
  }
}

type PageSummaryTarget = {
  id: string
  item: DocumentPlanPageSkeletonItem
  passage: string
}

const require = createRequire(import.meta.url)
const mammoth = require('mammoth') as typeof import('mammoth')
const TurndownService = require('turndown') as new (options?: Record<string, unknown>) => {
  use: (plugin: unknown) => void
  turndown: (html: string) => string
}
const { gfm } = require('@joplin/turndown-plugin-gfm') as { gfm: unknown }

const stripControlChars = (value: string): string =>
  value.replace(NULL_CHAR_PATTERN, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const compactText = (value: string): string =>
  stripControlChars(value)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const countCjkChars = (value: string): number =>
  Array.from(value).filter((char) => CJK_PATTERN.test(char)).length

const countLatinWords = (value: string): number => value.match(LATIN_WORD_PATTERN)?.length ?? 0

const isMostlyEnglishText = (value: string): boolean => {
  const sample = value.slice(0, 30_000)
  const latinWords = countLatinWords(sample)
  const cjkChars = countCjkChars(sample)
  return latinWords >= 30 && cjkChars <= Math.max(10, latinWords * 0.08)
}

const isMostlyChineseText = (value: string): boolean => {
  const sample = value.slice(0, 30_000)
  const latinWords = countLatinWords(sample)
  const cjkChars = countCjkChars(sample)
  return cjkChars >= 50 && cjkChars > latinWords
}

const ENGLISH_BRIEF_LABEL_PATTERN =
  /(?:^|\n)\s*(?:Presentation\s*goal|Presentationgoal|Audience\s*\/\s*context|Audiencecontext|Core\s*argument|Coreargument|Recommended\s*outline|Recommendedoutline|Per[-\s]*page\s*points|Per-pagepoints|Perpagepoints|Facts\s*\/\s*metrics\s*\/\s*terms\s*to\s*preserve|Facts\/metrics\/termstopreserve|Factsmetricstermstopreserve|Style\s*or\s*expression\s*notes|Styleorexpressionnotes|Page\s*\d{1,2})\s*[:：]/i

const assertPlanLanguageMatchesSource = async (args: {
  file: PreparedSourceFile
  plan: Pick<ParsedDocumentPlanResult, 'topic' | 'briefText'>
  userText: string
}): Promise<void> => {
  if (args.file.type === 'image') return
  if (countCjkChars(args.userText) >= 6) return

  const sourceText = await fs.promises.readFile(args.file.workspacePath, 'utf-8').catch(() => '')
  const outputText = `${args.plan.topic}\n${args.plan.briefText}`

  if (isMostlyEnglishText(sourceText) && countCjkChars(outputText) >= 12) {
    throw new RetryableDocumentPlanQualityError(
      'The source document is primarily English, but topic/briefText were returned in Chinese. Return topic and briefText in English; do not translate the outline into Chinese.'
    )
  }

  if (isMostlyChineseText(sourceText) && ENGLISH_BRIEF_LABEL_PATTERN.test(args.plan.briefText)) {
    throw new RetryableDocumentPlanQualityError(
      '源文档主要是中文，但 briefText 使用了英文结构标签。请用中文结构标签返回，例如：演示目标、受众/场景、核心观点、建议大纲、每页要点、必须保留的事实/指标/术语、风格/表达要求。不要使用 Presentation goal、Audience/context、Core argument、Recommended outline、Per-page points、Page 1 等英文模板标签。'
    )
  }
}

const stripInlineImagesFromHtml = (html: string): string =>
  html.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = tag.match(/\balt=(["'])(.*?)\1/i)?.[2]?.trim()
    return alt ? `<p>[图片：${alt}]</p>` : ''
  })

const stripMarkdownDataImages = (markdown: string): string =>
  markdown.replace(/!\[[^\]]*]\(data:[^)]+\)/gi, '').replace(/!\[[^\]]*]\(\s*\)/g, '')

const convertDocxToMarkdown = async (filePath: string): Promise<string> => {
  const result = await mammoth.convertToHtml({ path: filePath })
  if (result.messages.length > 0) {
    log.info('[documents:parsePlan] mammoth warnings', {
      filePath,
      messages: result.messages.map((message) => message.message)
    })
  }
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
  })
  turndown.use(gfm)
  return compactText(
    stripMarkdownDataImages(turndown.turndown(stripInlineImagesFromHtml(result.value)))
  )
}

const buildPdfPageOcrPrompt = (args: {
  fileName: string
  pageNumber: number
  totalPages: number
}): string =>
  [
    `这是 PDF 文件“${args.fileName}”的第 ${args.pageNumber}/${args.totalPages} 页扫描图。`,
    '请逐项读取这一页的可见文字、标题、表格、图表标签、数字、日期和专有名词，并整理为简洁 Markdown。',
    '保持原文语言和层级；表格尽量还原为 Markdown 表格，图表需说明可见的指标与关系。',
    '不确定或无法辨认的内容明确标为“无法辨认”，不得猜测或补写。',
    '只返回本页 Markdown 内容，不要返回代码围栏、页数建议、PPT 大纲或任务解释。'
  ].join('\n')

const toSafeFileName = (value: string): string =>
  value
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'source'

const prepareSourceFile = async (
  file: { path?: unknown; name?: unknown },
  workspaceDir: string,
  options: { pdfVision?: PdfVisionConfig } = {}
): Promise<PreparedSourceFile> => {
  const rawPath = typeof file.path === 'string' ? file.path.trim() : ''
  if (!rawPath) throw new Error('无法读取文档路径')
  const filePath = path.resolve(rawPath)
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile()) throw new Error(`文档不是文件: ${filePath}`)
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error('单个文档不能超过 10MB')

  const ext = path.extname(filePath).toLowerCase()
  const isImage = SUPPORTED_IMAGE_EXTENSIONS.has(ext)
  if (!SUPPORTED_EXTENSIONS.has(ext) && !isImage) {
    throw new Error('暂只支持 pdf、docx、md、txt、csv 文档，以及 png、jpg、jpeg、webp 图片')
  }
  log.info('[documents:parsePlan] read source file', {
    fileName: path.basename(filePath),
    extension: ext,
    size: stat.size
  })

  const name =
    typeof file.name === 'string' && file.name.trim().length > 0
      ? file.name.trim()
      : path.basename(filePath)
  let type: PreparedSourceFile['type'] = isImage
    ? 'image'
    : ext === '.docx'
      ? 'docx'
      : ext === '.pdf'
        ? 'markdown'
      : ext === '.md'
        ? 'markdown'
        : ext === '.csv'
          ? 'csv'
          : 'text'

  const safeBaseName = toSafeFileName(path.basename(name, ext))
  const stamp = Date.now()
  const uniqueId = nanoid(8)
  const workspaceName =
    ext === '.docx' || ext === '.csv' || ext === '.pdf'
      ? `${stamp}-${uniqueId}-${safeBaseName || 'source'}.md`
      : `${stamp}-${uniqueId}-${safeBaseName}${ext}`
  const workspacePath = path.join(workspaceDir, workspaceName)
  let characterCount = stat.size

  if (isImage) {
    if (path.resolve(filePath) !== path.resolve(workspacePath)) {
      await fs.promises.copyFile(filePath, workspacePath)
    }
    log.info('[documents:parsePlan] image source prepared for vision', {
      originalName: name,
      workspaceName,
      size: stat.size
    })
  } else if (ext === '.docx') {
    const markdown = await convertDocxToMarkdown(filePath)
    if (!markdown) throw new Error(`${name} 未解析出可用文本`)
    await fs.promises.writeFile(
      workspacePath,
      [
        `# ${path.basename(name, ext)}`,
        '',
        '> Converted from Word .docx for agent reading. Inline images were omitted; image alt text may be preserved when available.',
        '',
        markdown
      ].join('\n'),
      'utf-8'
    )
    characterCount = markdown.length
    log.info('[documents:parsePlan] docx converted for reading', {
      originalName: name,
      workspaceName,
      characterCount
    })
  } else if (ext === '.csv') {
    const csvText = await fs.promises.readFile(filePath, 'utf-8')
    const markdown = convertCsvTextToMarkdown(csvText, {
      title: path.basename(name, ext)
    })
    if (!markdown) throw new Error(`${name} 未解析出可用文本`)
    await fs.promises.writeFile(workspacePath, markdown, 'utf-8')
    type = 'markdown'
    characterCount = markdown.length
    log.info('[documents:parsePlan] csv converted for reading', {
      originalName: name,
      workspaceName,
      characterCount
    })
  } else if (ext === '.pdf') {
    const pdfResult = await convertPdfToMarkdown({
      filePath,
      fileName: name,
      ocrPage: options.pdfVision
        ? async ({ imageBase64, mimeType, pageNumber, totalPages, fileName }) => {
            try {
              return await invokeVisionModelText({
                imageBase64,
                mimeType,
                prompt: buildPdfPageOcrPrompt({ fileName, pageNumber, totalPages }),
                provider: options.pdfVision!.provider,
                apiKey: options.pdfVision!.apiKey,
                model: options.pdfVision!.model,
                baseUrl: options.pdfVision!.baseUrl,
                maxTokens: options.pdfVision!.maxTokens,
                modelTimeoutMs: options.pdfVision!.modelTimeoutMs,
                logTag: `documents:parsePlan:pdf-page-${pageNumber}`
              })
            } catch (error) {
              if (isImageUnsupportedError(error)) {
                throw new Error('该 PDF 包含扫描页，当前公司模型不支持图片识别')
              }
              throw error
            }
          }
        : undefined
    })
    await fs.promises.writeFile(workspacePath, pdfResult.markdown, 'utf-8')
    type = 'markdown'
    characterCount = pdfResult.markdown.length
    log.info('[documents:parsePlan] pdf converted for reading', {
      originalName: name,
      workspaceName,
      pageCount: pdfResult.pageCount,
      ocrPageCount: pdfResult.ocrPageCount,
      characterCount
    })
  } else {
    if (path.resolve(filePath) !== path.resolve(workspacePath)) {
      await fs.promises.copyFile(filePath, workspacePath)
    }
    log.info('[documents:parsePlan] text source prepared for reading', {
      originalName: name,
      workspaceName,
      characterCount
    })
  }

  return {
    name,
    type,
    characterCount,
    path: workspacePath,
    originalPath: filePath,
    workspacePath,
    virtualPath: `/${workspaceName}`
  }
}

const resolveOutlineScanFormat = (file: PreparedSourceFile): DocumentOutlineScan['format'] => {
  if (file.type === 'csv') return 'csv'
  if (file.type === 'text') return 'text'
  return 'markdown'
}

const scanPreparedSourceOutline = async (
  file: PreparedSourceFile
): Promise<{
  scan: DocumentOutlineScan
  pageCandidates: DocumentOutlinePageCandidate[]
} | null> => {
  if (file.type === 'image') {
    log.info('[documents:parsePlan] document outline scan skipped', {
      sourceVirtualPath: file.virtualPath,
      reason: 'image-source'
    })
    return null
  }
  const content = await fs.promises.readFile(file.workspacePath, 'utf-8').catch((error) => {
    log.warn('[documents:parsePlan] document outline scan read failed', {
      sourceVirtualPath: file.virtualPath,
      message: error instanceof Error ? error.message : String(error)
    })
    return ''
  })
  if (!content.trim()) {
    log.info('[documents:parsePlan] document outline scan skipped', {
      sourceVirtualPath: file.virtualPath,
      reason: 'empty-source'
    })
    return null
  }
  const scan = scanDocumentOutline(content, resolveOutlineScanFormat(file))
  const pageCandidates = deriveOutlinePageCandidates(scan)
  log.info('[documents:parsePlan] document outline scanned', {
    sourceVirtualPath: file.virtualPath,
    format: scan.format,
    headingCount: scan.headingCount,
    topLevelTitle: scan.topLevelTitle,
    pageCandidateCount: pageCandidates.length,
    splitHintCount: scan.recommendedSplitHints.length,
    headingPreview: scanHeadingTitles(scan).slice(0, 15),
    splitHintsPreview: scan.recommendedSplitHints.slice(0, 5)
  })
  return { scan, pageCandidates }
}

const assertPlanMatchesDocumentOutline = (args: {
  scan: DocumentOutlineScan | null
  pageCandidates: DocumentOutlinePageCandidate[]
  plan: Pick<ParsedDocumentPlanResult, 'pageCount' | 'briefText'>
}): void => {
  if (!args.scan || !scanHasMultipleSlideCandidates(args.scan)) return
  if (args.plan.pageCount <= 1) {
    throw new RetryableDocumentPlanQualityError(
      'The source document has multiple Markdown/source sections, but the plan collapsed it to one slide. Rebuild the outline from the document heading structure and infer a multi-slide pageCount.'
    )
  }
  const pageCountEstimate = estimateOutlinePageCount(args.scan, args.pageCandidates)
  if (
    args.pageCandidates.length > 0 &&
    pageCountEstimate &&
    args.plan.pageCount !== pageCountEstimate.preferredPageCount
  ) {
    throw new RetryableDocumentPlanQualityError(
      `The source document scan provided an authoritative page candidate skeleton of ${pageCountEstimate.preferredPageCount} slides, but the plan returned pageCount=${args.plan.pageCount}. Rebuild the outline from the page candidate skeleton without compressing or expanding it.`
    )
  }
  if (
    pageCountEstimate &&
    (args.plan.pageCount < pageCountEstimate.minPageCount ||
      args.plan.pageCount > pageCountEstimate.maxPageCount)
  ) {
    throw new RetryableDocumentPlanQualityError(
      `The source document structure suggests ${pageCountEstimate.preferredPageCount} slides with acceptable range ${pageCountEstimate.minPageCount}-${pageCountEstimate.maxPageCount}, but the plan returned pageCount=${args.plan.pageCount}. Rebuild the outline using the deterministic source-structure page-count estimate.`
    )
  }

  const briefText = args.plan.briefText
  if (hasOutlinePageCandidateSkeleton(args.pageCandidates)) return

  const hasSourceHeadingLabel =
    /源文档结构|来源标题|Source document structure|Source heading/i.test(briefText)
  const headingTitles = scanHeadingTitles(args.scan)
  const mentionedHeadingCount = headingTitles.filter((title) => briefText.includes(title)).length
  if (!hasSourceHeadingLabel && mentionedHeadingCount < Math.min(2, headingTitles.length)) {
    throw new RetryableDocumentPlanQualityError(
      'The source document has a heading structure, but briefText does not preserve source headings. Include a compact source-structure section and source heading for each page entry.'
    )
  }
}

const isDocumentOutlineQualityError = (error: unknown): boolean =>
  error instanceof RetryableDocumentPlanQualityError &&
  /multiple Markdown\/source sections|heading structure|source-structure page-count estimate|page candidate skeleton/i.test(
    error.message
  )

const hasOutlinePageCandidateSkeleton = (pageCandidates: DocumentOutlinePageCandidate[]): boolean =>
  pageCandidates.length > 0

const formatLightweightPageCandidateSkeletonForPrompt = (args: {
  scan: DocumentOutlineScan | null
  pageCandidates: DocumentOutlinePageCandidate[]
}): string => {
  if (!args.scan || args.pageCandidates.length === 0) return ''
  return [
    'Document structure scan:',
    `- Format: ${args.scan.format}`,
    `- Markdown headings detected: ${args.scan.headingCount}`,
    args.scan.topLevelTitle ? `- Top-level title: ${args.scan.topLevelTitle}` : '',
    `- Authoritative page candidate skeleton: ${args.pageCandidates.length} slides.`,
    ...args.pageCandidates.map(
      (candidate, index) =>
        `  ${index + 1}. [${candidate.role}] ${candidate.sourceHeading} (lines ${candidate.lineStart}-${candidate.lineEnd})`
    )
  ]
    .filter(Boolean)
    .join('\n')
}

const normalizeLightweightGeneratedPlan = (
  rawText: string,
  fallback: {
    topic: string
    pageCount: number
  }
): Pick<ParsedDocumentPlanResult, 'topic' | 'pageCount' | 'briefText'> => {
  const parsed = (() => {
    try {
      return JSON.parse(extractJsonBlock(rawText)) as unknown
    } catch {
      return null
    }
  })()
  const record =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  const topic =
    typeof record.topic === 'string' && record.topic.trim() ? record.topic.trim() : fallback.topic
  const rawPageCount = Number(record.pageCount ?? record.page_count ?? fallback.pageCount)
  const pageCount = Number.isFinite(rawPageCount)
    ? Math.min(MAX_PAGE_COUNT, Math.max(1, Math.round(rawPageCount)))
    : fallback.pageCount
  if (!topic) throw new Error('文档解析完成，但模型未返回 topic')
  return {
    topic,
    pageCount,
    briefText: ''
  }
}

const formatPageSkeletonBriefText = (args: {
  topic: string
  pageSkeleton: DocumentPlanPageSkeletonItem[]
}): string => {
  const useChineseLabels = CJK_PATTERN.test(
    `${args.topic}\n${args.pageSkeleton.map((item) => `${item.title}\n${item.reason}`).join('\n')}`
  )
  const outlineLabel = useChineseLabels ? '建议大纲' : 'Recommended outline'
  const summaryLabel = useChineseLabels ? '简要总结' : 'Brief summary'
  const pageLabel = useChineseLabels ? '第' : 'Page'
  const pageSuffix = useChineseLabels ? ' 页' : ''

  return [
    `## ${outlineLabel}`,
    ...args.pageSkeleton.map(
      (item) =>
        `### ${pageLabel} ${item.pageNumber}${pageSuffix}: ${item.title}\n\n- **${summaryLabel}:** ${item.reason || item.title}`
    )
  ].join('\n\n')
}

const buildSingleShotDocumentPlanPrompt = (args: {
  topic: string
  existingBrief: string
  file: PreparedSourceFile
  outlineScan: DocumentOutlineScan | null
  pageCandidates: DocumentOutlinePageCandidate[]
  sourcePreview: string
  sourcePreviewLimit: number
  sourcePreviewTruncated: boolean
  retryHint?: string
}): string => {
  const useLightweightSourcePlan = hasOutlinePageCandidateSkeleton(args.pageCandidates)

  return [
    'Turn the uploaded document into the fixed JSON needed by the PPT creation form.',
    'This is a single-shot document parsing task. The host already scanned the source document with Markdown/GFM AST when possible.',
    'Do not ask to read the file, do not mention tools, and do not reconstruct the source document.',
    useLightweightSourcePlan
      ? 'Use the page candidate skeleton as the authoritative outline. Do not need source body text during parsing; later slide generation will read source passages by line range.'
      : 'No authoritative page candidate skeleton is available. Use the bounded source preview and any structure scan to infer a concise source-ordered page outline.',
    '',
    'Return only a JSON object. Do not return Markdown, explanations, or extra fields.',
    useLightweightSourcePlan
      ? 'Use exactly these fields: topic, pageCount. Do not include briefText.'
      : 'Use exactly these fields: topic, pageCount, briefText.',
    '',
    'Output language rules:',
    '- Use the dominant language of the source structure, user topic, and existing brief.',
    useLightweightSourcePlan
      ? ''
      : '- If the source structure is primarily Chinese, use Chinese labels in briefText.',
    useLightweightSourcePlan
      ? ''
      : '- If the source structure is primarily English, use English labels in briefText.',
    '- Keep proper nouns, product names, technical terms, quoted text, and metrics in their original form when appropriate.',
    '',
    'Field rules:',
    '- topic: a concise title suitable for the creation form topic input.',
    `- pageCount: an integer from 1 to ${MAX_PAGE_COUNT}.`,
    useLightweightSourcePlan
      ? '- Return pageCount equal to the page candidate skeleton count.'
      : '- Infer pageCount from source structure, information density, paragraphs, lists, tables, and semantic transitions. Do not return 1 for ordinary multi-section documents.',
    useLightweightSourcePlan
      ? '- Per-page summaries are generated by a later batch pass using source line ranges. Do not write any outline or page summaries now.'
      : '- briefText: a compact page skeleton, not a detailed fact summary.',
    useLightweightSourcePlan
      ? ''
      : '- briefText must include source document structure, recommended outline, and per-page points.',
    useLightweightSourcePlan
      ? ''
      : '- Recommended outline must contain exactly pageCount numbered items.',
    useLightweightSourcePlan
      ? ''
      : '- Per-page points must contain exactly pageCount page entries.',
    useLightweightSourcePlan
      ? ''
      : '- Each page entry should include: page title, page role, source anchor when available, and one short page purpose.',
    '- Do not write detailed facts, metrics, scripts, examples, risks, or per-page summaries during parsing. Later slide generation will inspect source passages again.',
    '- Preserve source order and hierarchy. Do not rewrite the source into a generic storyline, marketing narrative, consulting framework, or inspirational theme.',
    '- Keep chapter divider slides as standalone section-divider pages and include a role marker such as 页面角色：章节页 or Page role: chapter divider.',
    '- Do not add agenda/background/outlook/summary/next-step pages unless present in the source skeleton or requested by the user.',
    '',
    args.outlineScan ? 'Host-provided document structure:' : '',
    args.outlineScan
      ? useLightweightSourcePlan
        ? formatLightweightPageCandidateSkeletonForPrompt({
            scan: args.outlineScan,
            pageCandidates: args.pageCandidates
          })
        : formatDocumentOutlineScanForPrompt(args.outlineScan, args.pageCandidates)
      : '',
    '',
    args.sourcePreview ? 'Bounded source preview for unstructured parsing:' : '',
    args.sourcePreviewTruncated
      ? `The preview is capped at ${args.sourcePreviewLimit} characters. Use it conservatively with the structure scan; do not invent unsupported later-section details.`
      : '',
    args.sourcePreview ? '```text' : '',
    args.sourcePreview,
    args.sourcePreview ? '```' : '',
    args.retryHint
      ? useLightweightSourcePlan
        ? `\nRetry requirement: the previous output failed validation because: ${args.retryHint}. Fix this issue. Return topic and pageCount only, with pageCount exactly matching the page candidate skeleton.`
        : `\nRetry requirement: the previous output failed validation because: ${args.retryHint}. Fix this issue. Ensure briefText is non-empty and pageCount exactly matches the page-level outline and per-page points.`
      : '',
    args.topic
      ? `\nUser-provided topic: ${args.topic}`
      : '\nThe user did not provide a topic; infer it from the document structure.',
    args.existingBrief ? `\nExisting user brief:\n${args.existingBrief}` : '',
    `\nSource document path for later generation only: ${args.file.virtualPath}`,
    '',
    'Return format examples:',
    useLightweightSourcePlan
      ? '{"topic":"直播与短视频自然流增长：汽车经销商新媒体实战指南","pageCount":65}'
      : '',
    useLightweightSourcePlan
      ? ''
      : 'For Chinese source: {"topic":"直播与短视频自然流增长——汽车经销商新媒体实战指南","pageCount":65,"briefText":"演示目标：...\\n源文档结构：...\\n建议大纲：\\n1. 手册结构导航\\n2. 阅读角色指引\\n每页要点：\\n第 1 页：手册结构导航\\n页面角色：内容页\\n来源标题：### 手册结构导航\\n来源范围：lines 17-32\\n页面目的：说明本手册的结构导航。"}',
    useLightweightSourcePlan
      ? ''
      : 'For English source: {"topic":"Product Launch Readiness Review","pageCount":8,"briefText":"Presentation goal: ...\\nSource document structure: ...\\nRecommended outline:\\n1. Launch Readiness\\nPer-page points:\\nPage 1: Launch Readiness\\nPage role: content\\nSource heading: ## Launch Readiness\\nSource range: lines 10-32\\nPage purpose: Anchor the launch readiness section."}'
  ].join('\n')
}

const runSingleShotDocumentPlanModel = async (args: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  maxTokens: number | undefined
  modelTimeoutMs: number
  file: PreparedSourceFile
  outlineScan: DocumentOutlineScan | null
  pageCandidates: DocumentOutlinePageCandidate[]
  topic: string
  existingBrief: string
  retryHint?: string
}): Promise<string> => {
  const client = resolveModel(
    args.provider,
    args.apiKey,
    args.model,
    args.baseUrl,
    0.2,
    args.maxTokens
  )
  const sourceText = await fs.promises.readFile(args.file.workspacePath, 'utf-8')
  const pageCandidateCount = args.pageCandidates.length
  const useLightweightSourcePlan = hasOutlinePageCandidateSkeleton(args.pageCandidates)
  const sourcePreview = useLightweightSourcePlan
    ? ''
    : sourceText.slice(0, MAX_PARSE_SOURCE_PREVIEW_CHARS)
  const sourcePreviewTruncated =
    !useLightweightSourcePlan && sourceText.length > sourcePreview.length
  const prompt = buildSingleShotDocumentPlanPrompt({
    topic: args.topic,
    existingBrief: args.existingBrief,
    file: args.file,
    outlineScan: args.outlineScan,
    pageCandidates: args.pageCandidates,
    sourcePreview,
    sourcePreviewLimit: MAX_PARSE_SOURCE_PREVIEW_CHARS,
    sourcePreviewTruncated,
    retryHint: args.retryHint
  })
  log.info('[documents:parsePlan] single-shot model invoke', {
    sourceVirtualPath: args.file.virtualPath,
    headingCount: args.outlineScan?.headingCount ?? 0,
    pageCandidateCount,
    sourceLength: sourceText.length,
    sourcePreviewLength: sourcePreview.length,
    sourcePreviewTruncated,
    promptLength: prompt.length
  })
  const result = await client.invoke(
    [
      {
        role: 'system' as const,
        content: useLightweightSourcePlan
          ? 'You are a document-to-PPT-creation-form parser. You have no filesystem tools in this call. Use the host-provided structure scan. Return strict JSON only: topic, pageCount.'
          : 'You are a document-to-PPT-creation-form parser. You have no filesystem tools in this call. Use the host-provided structure scan and any bounded source preview. Return strict JSON only: topic, pageCount, briefText.'
      },
      {
        role: 'user' as const,
        content: prompt
      }
    ],
    {
      signal: AbortSignal.timeout(resolveModelTimeoutMs(args.modelTimeoutMs, 'document'))
    }
  )
  return extractModelText(result)
}

const extractSourcePassageByLines = (
  sourceLines: string[],
  item: DocumentPlanPageSkeletonItem
): string => {
  const start = Math.max(1, Math.floor(item.lineStart || 1))
  const end = Math.max(start, Math.floor(item.lineEnd || start))
  const text = sourceLines
    .slice(start - 1, end)
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '')
        .replace(/^\s*(?:[-*+]|\d+[.)、．])\s+/, '')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_`~>|]+/g, ' ')
        .replace(/[ \t]+/g, ' ')
        .trim()
    )
    .filter(Boolean)
    .join(' ')
    .trim()
  return text.length > MAX_PAGE_SUMMARY_PASSAGE_CHARS
    ? `${text.slice(0, MAX_PAGE_SUMMARY_PASSAGE_CHARS).trim()}\n...[truncated]`
    : text
}

const buildPageSummaryBatchPrompt = (args: {
  topic: string
  targets: PageSummaryTarget[]
  retryHint?: string
}): string =>
  [
    'Summarize source passages for PPT page suggestions.',
    'The host has already selected exact source line ranges for each page. Use only the provided passages.',
    'Return strict JSON only: {"items":[{"id":"page-1","pageNumber":1,"summary":"..."}]}',
    '',
    'Rules:',
    '- Return exactly one non-empty summary for every page listed.',
    '- Preserve each page ID exactly as provided. Do not renumber pages within this batch.',
    '- Write a very brief factual summary for each page, grounded in its source passage when body text is available.',
    `- Each summary must be very concise and at most ${MAX_PAGE_SUMMARY_CHARS} characters.`,
    '- Preserve important facts, metrics, terms, names, and source language.',
    '- Do not invent missing facts. If the passage has no body text beyond a heading, summarize the page role or section based on the page title and source heading instead of returning an empty summary.',
    '- Keep each summary short enough for an editable PPT creation dialog.',
    args.retryHint
      ? `Retry requirement: the previous response was invalid because: ${args.retryHint}. Return all listed IDs exactly once in this attempt.`
      : '',
    '',
    args.topic ? `Deck topic: ${args.topic}` : '',
    '',
    'Pages:',
    ...args.targets.map((target) =>
      [
        `ID: ${target.id}`,
        `Page ${target.item.pageNumber}: ${target.item.title}`,
        `Role: ${target.item.role}`,
        `Source heading: ${target.item.sourceHeading}`,
        `Source lines: ${target.item.lineStart}-${target.item.lineEnd}`,
        `Passage: ${target.passage || '(No body text was extracted for this page.)'}`
      ].join('\n')
    )
  ]
    .filter(Boolean)
    .join('\n\n')

const readPageSummaryItems = (
  responseText: string,
  allowedTargets: Map<string, number>
): Map<number, string> => {
  const parsed = (() => {
    try {
      return JSON.parse(extractJsonBlock(responseText)) as unknown
    } catch {
      return null
    }
  })()
  const rawItems =
    parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).items
      : parsed
  if (!Array.isArray(rawItems)) return new Map()

  const result = new Map<number, string>()
  for (const rawItem of rawItems) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const record = rawItem as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const pageNumber = id ? allowedTargets.get(id) : undefined
    const summary =
      typeof record.summary === 'string'
        ? record.summary.replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_SUMMARY_CHARS).trim()
        : ''
    if (!pageNumber || !summary) continue
    result.set(pageNumber, summary)
  }
  return result
}

const missingPageSummaryIds = (
  batch: PageSummaryTarget[],
  summaries: Map<number, string>
): string[] =>
  batch.filter((target) => !summaries.get(target.item.pageNumber)).map((target) => target.id)

const summarizePageSummaryBatch = async (args: {
  batch: PageSummaryTarget[]
  batchIndex: number
  topic: string
  client: ReturnType<typeof resolveModel>
  modelTimeoutMs: number
  sourceVirtualPath: string
  totalSummaryTargets: number
  waitForBatchStartSlot: () => Promise<void>
}): Promise<Map<number, string>> => {
  let lastError: unknown = null
  for (let attempt = 1; attempt <= PAGE_SUMMARY_BATCH_MAX_ATTEMPTS; attempt += 1) {
    const retryHint = attempt > 1 && lastError instanceof Error ? lastError.message : undefined
    const prompt = buildPageSummaryBatchPrompt({
      topic: args.topic,
      targets: args.batch,
      retryHint
    })
    try {
      await args.waitForBatchStartSlot()
      log.info('[documents:parsePlan] page summary batch invoke', {
        sourceVirtualPath: args.sourceVirtualPath,
        batchIndex: args.batchIndex + 1,
        attempt,
        maxAttempts: PAGE_SUMMARY_BATCH_MAX_ATTEMPTS,
        batchSize: args.batch.length,
        totalSummaryTargets: args.totalSummaryTargets,
        concurrency: PAGE_SUMMARY_BATCH_CONCURRENCY,
        startDelayMs: PAGE_SUMMARY_BATCH_START_DELAY_MS,
        promptLength: prompt.length,
        hasRetryHint: Boolean(retryHint)
      })
      const result = await args.client.invoke(
        [
          {
            role: 'system' as const,
            content:
              'You summarize source passages for PPT page suggestions. Return strict JSON only.'
          },
          {
            role: 'user' as const,
            content: prompt
          }
        ],
        {
          signal: AbortSignal.timeout(resolveModelTimeoutMs(args.modelTimeoutMs, 'document'))
        }
      )
      const batchSummaries = readPageSummaryItems(
        extractModelText(result),
        new Map(args.batch.map((target) => [target.id, target.item.pageNumber]))
      )
      const missingIds = missingPageSummaryIds(args.batch, batchSummaries)
      if (missingIds.length === 0) return batchSummaries
      throw new Error(`模型摘要返回缺少页面 ID: ${missingIds.join(', ')}`)
    } catch (error) {
      lastError = error
      log.warn('[documents:parsePlan] page summary batch attempt failed', {
        sourceVirtualPath: args.sourceVirtualPath,
        batchIndex: args.batchIndex + 1,
        attempt,
        maxAttempts: PAGE_SUMMARY_BATCH_MAX_ATTEMPTS,
        batchSize: args.batch.length,
        message: error instanceof Error ? error.message : String(error)
      })
    }
  }
  throw lastError || new Error('模型摘要批次失败')
}

const summarizePageSkeletonContentInBatches = async (args: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  maxTokens: number | undefined
  modelTimeoutMs: number
  file: PreparedSourceFile
  topic: string
  pageSkeleton: DocumentPlanPageSkeletonItem[]
}): Promise<DocumentPlanPageSkeletonItem[]> => {
  if (args.file.type === 'image' || args.pageSkeleton.length === 0) return args.pageSkeleton
  const sourceText = await fs.promises.readFile(args.file.workspacePath, 'utf-8')
  const sourceLines = stripControlChars(sourceText).split('\n')
  const summaryTargets = args.pageSkeleton
    .filter((item) => !isSectionAgendaReason(item.reason))
    .slice(0, MAX_PAGE_SUMMARY_TOTAL_PAGES)
    .map((item) => ({
      id: item.id || `page-${item.pageNumber}`,
      item,
      passage: extractSourcePassageByLines(sourceLines, item)
    }))
    .sort((a, b) => a.item.pageNumber - b.item.pageNumber)
  if (summaryTargets.length === 0) return args.pageSkeleton

  const client = resolveModel(
    args.provider,
    args.apiKey,
    args.model,
    args.baseUrl,
    0.1,
    args.maxTokens
  )
  const summaries = new Map<number, string>()
  const batches: PageSummaryTarget[][] = []

  for (let index = 0; index < summaryTargets.length; index += PAGE_SUMMARY_BATCH_SIZE) {
    batches.push(summaryTargets.slice(index, index + PAGE_SUMMARY_BATCH_SIZE))
  }

  const limit = pLimit(PAGE_SUMMARY_BATCH_CONCURRENCY)
  let nextBatchStartAt = Date.now()
  const waitForBatchStartSlot = async (): Promise<void> => {
    const now = Date.now()
    const waitMs = Math.max(0, nextBatchStartAt - now)
    nextBatchStartAt = Math.max(now, nextBatchStartAt) + PAGE_SUMMARY_BATCH_START_DELAY_MS
    if (waitMs > 0) await sleep(waitMs)
  }

  await Promise.all(
    batches.map((batch, batchIndex) =>
      limit(async () => {
        try {
          const batchSummaries = await summarizePageSummaryBatch({
            batch,
            batchIndex,
            topic: args.topic,
            client,
            modelTimeoutMs: args.modelTimeoutMs,
            sourceVirtualPath: args.file.virtualPath,
            totalSummaryTargets: summaryTargets.length,
            waitForBatchStartSlot
          })
          batchSummaries.forEach((summary, pageNumber) => summaries.set(pageNumber, summary))
        } catch (error) {
          log.warn('[documents:parsePlan] page summary batch failed, keeping existing summaries', {
            sourceVirtualPath: args.file.virtualPath,
            batchIndex: batchIndex + 1,
            maxAttempts: PAGE_SUMMARY_BATCH_MAX_ATTEMPTS,
            batchSize: batch.length,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      })
    )
  )

  if (args.pageSkeleton.length > summaryTargets.length) {
    log.info('[documents:parsePlan] page summary target capped', {
      sourceVirtualPath: args.file.virtualPath,
      summarizedPages: summaryTargets.length,
      totalPages: args.pageSkeleton.length
    })
  }

  return args.pageSkeleton.map((item) => ({
    ...item,
    reason: summaries.get(item.pageNumber) || item.reason || item.title
  }))
}

const buildImageDocumentPlanPrompt = (args: {
  topic: string
  existingBrief: string
  fileName: string
  retryHint?: string
}): string =>
  [
    'Analyze the attached image or screenshot and produce the fixed structure needed by the PPT creation form.',
    'The image is attached to this same message as a multimodal image block. Do not look for a file upload tool, file path, or external attachment.',
    'You must directly inspect the attached image content before answering.',
    '',
    'Return only a JSON object. Do not return Markdown, explanations, or extra fields.',
    'Use exactly these fields: topic, pageCount, briefText.',
    '',
    'Interpretation rules:',
    '- If the image is a slide, dashboard, poster, whiteboard, document screenshot, product screenshot, chart, or design mockup, infer the presentation topic and outline from visible text, chart labels, layout, and visual context.',
    '- If visible text is limited, produce a conservative editable brief based on what can be observed. Do not invent exact numbers or facts that are not visible.',
    '- Preserve visible names, metrics, labels, dates, and terminology when they are readable.',
    '- Mention uncertainty explicitly inside briefText when image content is ambiguous.',
    '- Treat the image as an input reference only. Do not assume the original image will be available during later slide generation.',
    '- Therefore briefText must fully capture both the content reference and the visual style reference needed for generation.',
    '',
    'Output language rules:',
    '- Use the dominant language visible in the image and the latest user-provided topic/brief.',
    '- If the user explicitly asks for a language, use that language.',
    '- If the image is primarily Chinese, use Chinese section labels such as 演示目标、受众/场景、核心观点、建议大纲、每页要点、必须保留的事实/指标/术语、风格/表达要求.',
    '- If the image is primarily English, use English section labels.',
    '',
    'Field rules:',
    '- topic: a concise title suitable for the creation form topic input.',
    `- pageCount: an integer from 1 to ${MAX_PAGE_COUNT}.`,
    '- pageCount means the target number of PPT slides to generate from this image/reference. It is not the number of attached images.',
    '- Use pageCount=1 only for a single simple visual with one presentation point; if the image contains multiple sections, panels, metrics, or a document-like screenshot, infer a multi-slide deck.',
    '- briefText: a concise but structured outline suitable for the creation form detailed-brief input.',
    '- briefText should include presentation goal, audience/context, core argument, recommended outline, per-page points, facts/metrics/terms to preserve, and visual/style reference.',
    '- visual/style reference should cover approximate colors, background, typography feel, layout density, alignment, cards/shapes/borders/shadows, chart style, image/illustration style, and any mood or motion guidance that would help recreate the look.',
    '- The recommended outline and per-page points should align with pageCount.',
    '- Infer the target PPT slide count from the image structure. Do not return 1 merely because one image was attached.',
    args.retryHint
      ? `\nRetry requirement: the previous output failed validation because: ${args.retryHint}. Fix this issue. Ensure briefText is non-empty and pageCount matches the page-level outline.`
      : '',
    args.topic
      ? `\nUser-provided topic: ${args.topic}`
      : '\nThe user did not provide a topic; infer it from the image.',
    args.existingBrief ? `\nExisting user brief:\n${args.existingBrief}` : '',
    `\nImage file name: ${args.fileName}`,
    '',
    'Return format examples:',
    '{"topic":"AI动漫产业发展分析","pageCount":7,"briefText":"演示目标：...\\n受众/场景：...\\n核心观点：...\\n建议大纲：\\n1. ...\\n每页要点：\\n第 1 页：...\\n必须保留的事实/指标/术语：...\\n风格/表达要求：..."}',
    '{"topic":"Product Launch Readiness Review","pageCount":8,"briefText":"Presentation goal: ...\\nAudience/context: ...\\nCore argument: ...\\nRecommended outline:\\n1. ...\\nPer-page points:\\nPage 1: ...\\nFacts/metrics/terms to preserve: ...\\nStyle or expression notes: ..."}'
  ].join('\n')

// Image plan parsing is for creation-form suggestions and writes a structured
// reference file from the accepted plan.
const writeImagePlanReferenceFile = async (args: {
  file: PreparedSourceFile
  plan: Pick<ParsedDocumentPlanResult, 'topic' | 'pageCount' | 'briefText'>
}): Promise<PreparedSourceFile> => {
  const ext = path.extname(args.file.workspacePath).toLowerCase()
  const mdPath = args.file.workspacePath.replace(/\.[^.]+$/, '.image.md')
  const briefText = compactText(args.plan.briefText)
  if (!briefText) throw new Error('图片解析完成，但模型未返回可用参考内容')
  const useChineseLabels = isMostlyChineseText(`${args.plan.topic}\n${briefText}`)
  const markdown = [
    `# ${path.basename(args.file.name, ext) || (useChineseLabels ? '图片参考' : 'Image reference')}`,
    '',
    `> Source image: ${args.file.name}`,
    '> This file was generated after the user explicitly parsed the uploaded image, so later generation can use it as text reference.',
    '',
    `## ${useChineseLabels ? '主题' : 'Topic'}`,
    '',
    args.plan.topic,
    '',
    `## ${useChineseLabels ? '建议页数' : 'Suggested page count'}`,
    '',
    String(args.plan.pageCount),
    '',
    `## ${useChineseLabels ? '图片解析参考' : 'Image analysis reference'}`,
    '',
    briefText
  ].join('\n')
  await fs.promises.writeFile(mdPath, markdown, 'utf-8')

  return {
    ...args.file,
    name: `${args.file.name}.image.md`,
    type: 'markdown',
    characterCount: markdown.length,
    path: mdPath,
    workspacePath: mdPath,
    virtualPath: `/${path.basename(mdPath)}`
  }
}

// Image plan parsing is for creation-form suggestions: topic/pageCount/briefText.
// This separate image-reference path only converts an image into readable source notes.
const buildImageReferenceMarkdownPrompt = (fileName: string): string =>
  [
    'Analyze the attached image or screenshot and convert it into a readable Markdown reference document.',
    'The image is attached to this same message as a multimodal image block. Directly inspect the image before answering.',
    '',
    'Return Markdown only. Do not return JSON. Do not include task explanations.',
    'Do not generate a PPT outline, page count, slide plan, or creation-form suggestions. Only organize what can be read or observed from the image.',
    '',
    `# 图片参考：${fileName}`,
    '',
    'Required sections:',
    '## 可见文字',
    '- Transcribe readable text, headings, labels, chart labels, names, metrics, dates, and terminology. Keep the original language.',
    '- Preserve line breaks or hierarchy when they are visible.',
    '## 内容整理',
    '- Organize the observed content into concise Markdown bullets or tables when helpful.',
    '- Mark uncertain or unreadable items clearly instead of guessing.',
    '## 视觉信息',
    '- Briefly describe visible layout, chart/table/UI structure, colors, and other visual cues that may help later generation.',
    '',
    'Rules:',
    '- Do not invent exact numbers or facts that are not visible.',
    '- If text is unreadable, say it is unreadable.',
    '- If the image is mainly visual with little text, describe only the observable visual content.'
  ].join('\n')

const convertImageReferenceToMarkdown = async (args: {
  file: PreparedSourceFile
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  maxTokens: number | undefined
  modelTimeoutMs: number
}): Promise<PreparedSourceFile> => {
  const ext = path.extname(args.file.workspacePath).toLowerCase()
  const mimeType = IMAGE_MIME_BY_EXTENSION[ext]
  if (!mimeType) throw new Error('暂只支持 png、jpg、jpeg、webp 图片')

  const imageBase64 = (await fs.promises.readFile(args.file.workspacePath)).toString('base64')
  let markdown = ''
  try {
    markdown = await invokeVisionModelText({
      imageBase64,
      mimeType,
      prompt: buildImageReferenceMarkdownPrompt(args.file.name),
      provider: args.provider,
      apiKey: args.apiKey,
      model: args.model,
      baseUrl: args.baseUrl,
      maxTokens: args.maxTokens,
      modelTimeoutMs: args.modelTimeoutMs,
      logTag: 'documents:parseImageReference'
    })
  } catch (error) {
    if (isImageUnsupportedError(error)) {
      throw new Error('当前模型不支持图片解析，请在设置中切换到支持多模态的模型')
    }
    throw error
  }

  const content = compactText(markdown)
  assertImageWasRead(content)
  if (!content) throw new Error('图片解析完成，但模型未返回可用内容')

  const mdPath = args.file.workspacePath.replace(/\.[^.]+$/, '.image.md')
  await fs.promises.writeFile(
    mdPath,
    [
      `# ${path.basename(args.file.name, ext) || '图片参考'}`,
      '',
      `> Source image: ${args.file.name}`,
      '> This file was generated after the user explicitly parsed the uploaded image into a readable Markdown reference.',
      '',
      content
    ].join('\n'),
    'utf-8'
  )

  return {
    ...args.file,
    name: `${args.file.name}.image.md`,
    type: 'markdown',
    characterCount: content.length,
    path: mdPath,
    workspacePath: mdPath,
    virtualPath: `/${path.basename(mdPath)}`
  }
}

const runImageDocumentPlanModel = async (args: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  maxTokens: number | undefined
  modelTimeoutMs: number
  file: PreparedSourceFile
  topic: string
  existingBrief: string
  retryHint?: string
}): Promise<string> => {
  const ext = path.extname(args.file.workspacePath).toLowerCase()
  const mimeType = IMAGE_MIME_BY_EXTENSION[ext]
  if (!mimeType) throw new Error('暂只支持 png、jpg、jpeg、webp 图片')

  const imageBase64 = (await fs.promises.readFile(args.file.workspacePath)).toString('base64')
  const prompt = buildImageDocumentPlanPrompt({
    topic: args.topic,
    existingBrief: args.existingBrief,
    fileName: args.file.name,
    retryHint: args.retryHint
  })
  try {
    return await invokeVisionModelText({
      imageBase64,
      mimeType,
      prompt,
      provider: args.provider,
      apiKey: args.apiKey,
      model: args.model,
      baseUrl: args.baseUrl,
      maxTokens: args.maxTokens,
      modelTimeoutMs: args.modelTimeoutMs,
      logTag: 'documents:parsePlan:image'
    })
  } catch (error) {
    if (isImageUnsupportedError(error)) {
      throw new Error('当前模型不支持图片解析，请在设置中切换到支持多模态的模型')
    }
    throw error
  }
}

export function registerDocumentParseHandlers(ctx: IpcContext): void {
  const { resolveStoragePath } = ctx

  ipcMain.handle(
    'documents:prepareReference',
    async (_event, payload: PrepareReferenceDocumentPayload) => {
      const input = payload && typeof payload === 'object' ? payload : { files: [] }
      const files = Array.isArray(input.files) ? input.files.slice(0, MAX_DOCUMENT_FILES) : []
      if (files.length === 0) throw new Error('请先选择要附加的参考文件')

      const docsDir = path.join(await resolveStoragePath(), 'docs')
      await fs.promises.mkdir(docsDir, { recursive: true })
      const preparedFiles = await Promise.all(files.map((file) => prepareSourceFile(file, docsDir)))

      return {
        files: preparedFiles.map(({ name, type, characterCount, workspacePath }) => ({
          name,
          type,
          characterCount,
          path: workspacePath
        }))
      } satisfies PreparedReferenceDocumentResult
    }
  )

  ipcMain.handle(
    'documents:parseImageReference',
    async (_event, payload: ParseImageReferencePayload) => {
      const input: Partial<ParseImageReferencePayload> =
        payload && typeof payload === 'object' ? payload : {}
      const rawFile = input.file && typeof input.file === 'object' ? input.file : null
      if (!rawFile) throw new Error('请先选择要解析的图片')

      const docsDir = path.join(await resolveStoragePath(), 'docs')
      await fs.promises.mkdir(docsDir, { recursive: true })
      const sourceFile = await prepareSourceFile(rawFile, docsDir)
      if (sourceFile.type !== 'image') throw new Error('请选择 png、jpg、jpeg、webp 图片')

      const activeModel = await resolveModelConfigForTask(ctx, {
        modelConfigId: input.modelConfigId,
        purpose: 'documents:parseImageReference'
      })
      const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
      const referenceFile = await convertImageReferenceToMarkdown({
        file: sourceFile,
        provider: activeModel.provider,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        baseUrl: activeModel.baseUrl,
        maxTokens: activeModel.maxTokens,
        modelTimeoutMs: modelTimeouts.document
      })

      return {
        files: [
          {
            name: referenceFile.name,
            type: referenceFile.type,
            characterCount: referenceFile.characterCount,
            path: referenceFile.workspacePath
          }
        ]
      } satisfies PreparedReferenceDocumentResult
    }
  )

  ipcMain.handle('documents:parsePlan', async (_event, payload: ParseDocumentPlanPayload) => {
    const parseStartedAt = Date.now()
    const parseStartedAtIso = new Date(parseStartedAt).toISOString()
    let parseEndStatus: 'success' | 'error' = 'error'
    let parseEndSourceVirtualPath: string | null = null
    let parseEndPageCount: number | null = null
    let parseEndError: string | null = null
    try {
      const input = payload && typeof payload === 'object' ? payload : { files: [] }
      const files = Array.isArray(input.files) ? input.files.slice(0, MAX_DOCUMENT_FILES) : []
      if (files.length === 0) throw new Error('请先选择要解析的文档')
      log.info('[documents:parsePlan] invoke', {
        files: files.map((file) => ({
          name: typeof file.name === 'string' ? file.name : path.basename(String(file.path || '')),
          pathProvided: typeof file.path === 'string' && file.path.trim().length > 0
        })),
        startedAt: parseStartedAtIso
      })

      const docsDir = path.join(await resolveStoragePath(), 'docs')
      await fs.promises.mkdir(docsDir, { recursive: true })
      const activeModel = await resolveModelConfigForTask(ctx, {
        modelConfigId: input.modelConfigId,
        purpose: 'documents:parsePlan'
      })
      const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
      const { provider, model, apiKey } = activeModel
      const baseUrl = activeModel.baseUrl
      const maxTokens = activeModel.maxTokens
      const modelTimeoutMs = modelTimeouts.document
      const preparedFiles = await Promise.all(
        files.map((file) =>
          prepareSourceFile(file, docsDir, {
            pdfVision: {
              provider,
              apiKey,
              model,
              baseUrl,
              maxTokens,
              modelTimeoutMs
            }
          })
        )
      )
      const [sourceFile] = preparedFiles
      if (!sourceFile) throw new Error('请先选择要解析的文档')
      parseEndSourceVirtualPath = sourceFile.virtualPath
      const outlineResult = await scanPreparedSourceOutline(sourceFile)
      const outlineScan = outlineResult?.scan ?? null
      const pageCandidates = outlineResult?.pageCandidates ?? []
      const pageCountEstimate = estimateOutlinePageCount(outlineScan, pageCandidates)
      if (pageCountEstimate) {
        log.info('[documents:parsePlan] document outline page-count estimate', {
          preferredPageCount: pageCountEstimate.preferredPageCount,
          minPageCount: pageCountEstimate.minPageCount,
          maxPageCount: pageCountEstimate.maxPageCount,
          basis: pageCountEstimate.basis,
          sourceVirtualPath: sourceFile.virtualPath
        })
      }

      const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
      const existingBrief =
        typeof input.existingBrief === 'string' ? input.existingBrief.trim() : ''
      const fallbackPlan = {
        topic: topic || path.basename(sourceFile.name, path.extname(sourceFile.name)),
        pageCount: null,
        briefText: existingBrief
      }
      const MAX_ATTEMPTS = 2
      let plan: Pick<ParsedDocumentPlanResult, 'topic' | 'pageCount' | 'briefText'> | null = null
      let lastError: unknown = null
      const useLightweightSourcePlan =
        sourceFile.type !== 'image' && hasOutlinePageCandidateSkeleton(pageCandidates)

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const retryHint = attempt > 1 && lastError instanceof Error ? lastError.message : undefined
        const responseText = (
          sourceFile.type === 'image'
            ? await runImageDocumentPlanModel({
                provider,
                apiKey,
                model,
                baseUrl,
                maxTokens,
                modelTimeoutMs,
                file: sourceFile,
                topic,
                existingBrief,
                retryHint
              })
            : await runSingleShotDocumentPlanModel({
                provider,
                apiKey,
                model,
                baseUrl,
                maxTokens,
                modelTimeoutMs,
                file: sourceFile,
                outlineScan,
                pageCandidates,
                topic,
                existingBrief,
                retryHint
              })
        ).trim()
        if (!responseText) {
          lastError = new Error('文档解析完成，但模型未返回可用内容')
          log.warn('[documents:parsePlan] empty response', { attempt })
          continue
        }
        log.info('[documents:parsePlan] agent response received', {
          attempt,
          responseLength: responseText.length,
          sourceVirtualPath: sourceFile.virtualPath
        })
        try {
          const candidatePlan = useLightweightSourcePlan
            ? normalizeLightweightGeneratedPlan(responseText, {
                topic: fallbackPlan.topic,
                pageCount: pageCandidates.length
              })
            : normalizeDocumentPlan(responseText, fallbackPlan)
          log.info('[documents:parsePlan] normalized candidate plan', {
            attempt,
            pageCount: candidatePlan.pageCount,
            briefLength: candidatePlan.briefText.length,
            lightweightSourcePlan: useLightweightSourcePlan,
            outlineScanHeadingCount: outlineScan?.headingCount ?? 0,
            scanHasMultipleSlideCandidates: scanHasMultipleSlideCandidates(outlineScan)
          })
          if (sourceFile.type === 'image') {
            assertImageWasRead(`${candidatePlan.topic}\n${candidatePlan.briefText}`)
          }
          await assertPlanLanguageMatchesSource({
            file: sourceFile,
            plan: candidatePlan,
            userText: `${topic}\n${existingBrief}`
          })
          assertPlanMatchesDocumentOutline({
            scan: outlineScan,
            pageCandidates,
            plan: candidatePlan
          })
          plan = candidatePlan
          break
        } catch (error) {
          lastError = error
          if (
            error instanceof RetryableDocumentPlanQualityError &&
            attempt >= MAX_ATTEMPTS &&
            !isDocumentOutlineQualityError(error)
          ) {
            plan = useLightweightSourcePlan
              ? normalizeLightweightGeneratedPlan(responseText, {
                  topic: fallbackPlan.topic,
                  pageCount: pageCandidates.length
                })
              : normalizeDocumentPlan(responseText, fallbackPlan)
            log.warn(
              '[documents:parsePlan] quality check failed after retry, returning editable plan',
              {
                attempt,
                message: error.message,
                responsePreview: responseText.slice(0, 400)
              }
            )
            break
          }
          if (isDocumentOutlineQualityError(error) && attempt >= MAX_ATTEMPTS) {
            log.warn(
              '[documents:parsePlan] outline quality check failed after retry, rejecting plan',
              {
                attempt,
                message: error instanceof Error ? error.message : String(error),
                responsePreview: responseText.slice(0, 400)
              }
            )
          }
          log.warn(
            attempt < MAX_ATTEMPTS
              ? '[documents:parsePlan] normalize failed, will retry'
              : '[documents:parsePlan] normalize failed, no attempts left',
            {
              attempt,
              message: error instanceof Error ? error.message : String(error),
              responsePreview: responseText.slice(0, 400)
            }
          )
        }
      }
      if (!plan) throw lastError || new Error('文档解析完成，但模型未返回可用解析结果')
      const resultFiles =
        sourceFile.type === 'image'
          ? [await writeImagePlanReferenceFile({ file: sourceFile, plan })]
          : preparedFiles

      const pageSkeletonBase = sanitizeDocumentPlanPageSkeletonContent({
        pageSkeleton: buildDocumentPlanPageSkeleton({
          scan: outlineScan,
          pageCandidates,
          pageCount: plan.pageCount
        })
      })
      const pageSkeleton = await summarizePageSkeletonContentInBatches({
        provider,
        apiKey,
        model,
        baseUrl,
        maxTokens,
        modelTimeoutMs,
        file: sourceFile,
        topic: plan.topic,
        pageSkeleton: pageSkeletonBase
      })
      const sourcePlan =
        pageSkeleton.length > 0
          ? {
              version: 1 as const,
              confidence: 'high' as const,
              sourceDocumentPath: resultFiles[0]?.virtualPath,
              sourceDocumentName: resultFiles[0]?.name,
              pageSkeleton
            }
          : undefined
      const resultPlan =
        useLightweightSourcePlan && pageSkeleton.length > 0
          ? {
              ...plan,
              briefText: formatPageSkeletonBriefText({
                topic: plan.topic,
                pageSkeleton
              })
            }
          : plan
      const result = {
        ...resultPlan,
        ...(pageSkeleton.length > 0 ? { pageSkeleton } : {}),
        ...(sourcePlan ? { sourcePlan } : {}),
        files: resultFiles.map(({ name, type, characterCount, workspacePath }) => ({
          name,
          type,
          characterCount,
          path: workspacePath
        }))
      } satisfies ParsedDocumentPlanResult
      parseEndStatus = 'success'
      parseEndPageCount = resultPlan.pageCount
      return result
    } catch (error) {
      parseEndError = error instanceof Error ? error.message : String(error)
      throw error
    } finally {
      const parseEndedAt = Date.now()
      log.info('[documents:parsePlan] end', {
        status: parseEndStatus,
        startedAt: parseStartedAtIso,
        endedAt: new Date(parseEndedAt).toISOString(),
        durationMs: parseEndedAt - parseStartedAt,
        sourceVirtualPath: parseEndSourceVirtualPath,
        pageCount: parseEndPageCount,
        error: parseEndError
      })
    }
  })
}
