/** Generation orchestration: LLM planning + DeepAgent execution. */
import pLimit from 'p-limit'
import log from 'electron-log/main.js'
import type { AgentManager } from '../agent'
import { createSessionDeckAgent, createSessionEditAgent, resolveModel } from '../agent'
import {
  buildDesignContractSystemPrompt,
  buildDesignContractUserPrompt,
  buildEditUserPrompt,
  buildPlanningSystemPrompt,
  buildPlanningUserPrompt,
  buildSinglePageGenerationPrompt
} from '../prompt'
import type { GenerateChunkEvent } from '@shared/generation'
import { normalizeLayoutIntent } from '@shared/layout-intent'
import { resolveModelTimeoutMs, type ModelTimeoutProfile } from '@shared/model-timeout'
import { progressLabel, progressText } from '@shared/progress'
import type { DesignContract, OutlineItem } from '../tools/types'
import { extractModelText, extractJsonBlock, sleep } from './utils'
import {
  createReferenceDocumentRetriever,
  formatReferenceDocumentSnippets
} from '../utils/reference-document-retrieval'

type AppLocale = 'zh' | 'en'

const uiText = (locale: AppLocale | undefined, zh: string, en: string): string =>
  locale === 'en' ? en : zh

const modelCallSignal = (
  timeoutMs: unknown,
  profile: ModelTimeoutProfile,
  upstreamSignal?: AbortSignal
): AbortSignal => {
  const timeoutSignal = AbortSignal.timeout(resolveModelTimeoutMs(timeoutMs, profile))
  return upstreamSignal ? AbortSignal.any([timeoutSignal, upstreamSignal]) : timeoutSignal
}

// ── Shared agent stream processor ───────────────────────────────────────

interface DeckToolStatusChunk {
  type?: string
  label?: string
  detail?: string
  progress?: number
  pageId?: string
  agentName?: string
}

interface StreamProcessOptions {
  emit?: (chunk: GenerateChunkEvent) => void
  runId: string
  stage: string
  totalPages: number
  provider: string
  model: string
  sessionId: string
  workerLabel?: string
  /**
   * Called for each `deck_tool_status` custom chunk.
   * Return `true` to break the stream loop (e.g. all pages written).
   */
  onCustom?: (custom: DeckToolStatusChunk) => boolean | void
  /** Called when `updates.model` is detected — the model is actively thinking. */
  onModelThinking?: (defaultProgress: number) => void
  /** Called with the extracted assistant message text. */
  onMessage?: (content: string) => void
}

/**
 * Iterate an agent stream, dispatching parsed chunks to the provided handlers.
 * Covers the common `custom` / `updates` / `messages` mode triad shared by all three
 * generation paths (single-page, parallel, edit).
 */
async function processAgentStream(
  stream: AsyncIterable<unknown>,
  options: StreamProcessOptions
): Promise<void> {
  const { sessionId, workerLabel, onCustom, onModelThinking, onMessage } = options
  let firstChunkLogged = false

  for await (const chunk of stream) {
    if (!firstChunkLogged) {
      firstChunkLogged = true
      log.info('[deepagent] stream first chunk', { sessionId, worker: workerLabel })
    }
    if (!Array.isArray(chunk) || chunk.length < 3) continue
    const parts = chunk as unknown[]
    const mode = parts[1] as string
    const data = parts[2]

    if (mode === 'custom' && data && typeof data === 'object') {
      const custom = data as DeckToolStatusChunk
      if (custom.type === 'deck_tool_status' && custom.label) {
        const shouldBreak = onCustom?.(custom)
        if (shouldBreak) break
      }
      continue
    }

    if (mode === 'updates' && data && typeof data === 'object') {
      const updates = data as Record<string, unknown>
      if (updates.model) {
        onModelThinking?.(42)
      }
      continue
    }

    if (mode === 'messages' && Array.isArray(data)) {
      const [message] = data as Array<Record<string, unknown>>
      const content = extractModelText(message)
      if (content) {
        onMessage?.(content)
      }
    }
  }
}

const normalizeOutlineText = (raw: string): string => {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return ''
  // Prefer compact clause-style outline to reduce downstream prompt bloat.
  const chunks = text
    .split(/[；;。.!?\n、,，|/]/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  const compact = (chunks.length > 0 ? chunks.slice(0, 4).join('；') : text).trim()
  if (compact.length <= 96) return compact
  return `${compact.slice(0, 96).trimEnd()}…`
}

const normalizeKeyPoints = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0)
    .slice(0, 6)
    .map((item) => (item.length > 24 ? `${item.slice(0, 24).trimEnd()}…` : item))
}

const DEFAULT_DESIGN_CONTRACT: DesignContract = {
  theme: 'cohesive editorial presentation',
  background: 'root uses a consistent full-canvas background with no exposed white edges',
  palette: ['#f8fafc', '#334155', '#64748b', '#94a3b8'],
  titleStyle: 'text-5xl font-semibold text-slate-800',
  layoutMotif:
    'varied 16:9 editorial layouts with flexible title placement inside the content area',
  chartStyle: 'readable Chart.js v4 charts with restrained colors and stable canvas height',
  shapeLanguage: '8px radius, light borders, subtle shadows'
}

const normalizeDesignContract = (value: unknown): DesignContract => {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  const readText = (key: keyof Omit<DesignContract, 'palette'>): string => {
    const text = String(record[key] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
    const fallback = DEFAULT_DESIGN_CONTRACT[key]
    const resolved = text || fallback
    return resolved.length > 120 ? `${resolved.slice(0, 120).trimEnd()}…` : resolved
  }
  const paletteRaw = Array.isArray(record.palette) ? record.palette : []
  const palette = paletteRaw
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0)
    .slice(0, 6)
  const resolvedPalette = Array.from(
    new Set([...palette, ...DEFAULT_DESIGN_CONTRACT.palette])
  ).slice(0, 6)
  return {
    theme: readText('theme'),
    background: readText('background'),
    palette: resolvedPalette,
    titleStyle: readText('titleStyle'),
    layoutMotif: readText('layoutMotif'),
    chartStyle: readText('chartStyle'),
    shapeLanguage: readText('shapeLanguage')
  }
}

const unwrapJsonLikeString = (value: string): string => {
  const source = value.trim()
  if (source.length < 2 || !source.startsWith('"') || !source.endsWith('"')) {
    return source
  }
  const inner = source
    .slice(1, -1)
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .trim()
  return inner.startsWith('{') || inner.startsWith('[') || inner.startsWith('```') ? inner : source
}

const parseModelJson = (responseText: string, appLocale?: AppLocale): unknown => {
  let source = responseText.trim()
  let lastError: unknown

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidates = Array.from(new Set([source, extractJsonBlock(source)]))
    let decodedJsonString = false

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate) as unknown
        if (typeof parsed !== 'string') {
          return parsed
        }
        source = parsed.trim()
        lastError = null
        decodedJsonString = true
        break
      } catch (err) {
        lastError = err
      }
    }

    if (decodedJsonString) {
      continue
    }

    const unwrapped = unwrapJsonLikeString(source)
    if (unwrapped !== source) {
      source = unwrapped
      continue
    }

    const block = extractJsonBlock(source)
    if (block !== source) {
      source = block
      continue
    }

    break
  }

  const preview = source.length > 200 ? `${source.slice(0, 200)}…` : source
  throw new Error(
    uiText(
      appLocale,
      `LLM 返回的 JSON 解析失败: ${lastError instanceof Error ? lastError.message : String(lastError)}. 原始文本预览: ${preview}`,
      `Failed to parse JSON returned by the LLM: ${lastError instanceof Error ? lastError.message : String(lastError)}. Raw text preview: ${preview}`
    )
  )
}

const SUMMARY_PUNCT_ONLY_RE = /^[\s.。!！?？,，;；:：、~—_`'"“”‘’()（）[\]【】-]+$/

const isMeaningfulSummary = (value: string): boolean => {
  const text = value.trim()
  if (!text) return false
  if (SUMMARY_PUNCT_ONLY_RE.test(text)) return false
  if (text.length <= 2 && !/[\p{L}\p{N}\u4e00-\u9fff]/u.test(text)) return false
  return true
}

const normalizePageSummary = (raw: string, pageTitle: string, appLocale?: AppLocale): string => {
  const trimmed = raw.replace(/\s+/g, ' ').trim()
  const withoutPrefix = trimmed.replace(/^第\s*\d+\s*页\s*[:：]\s*/u, '').trim()
  const candidate = withoutPrefix || trimmed
  if (!isMeaningfulSummary(candidate)) {
    return uiText(
      appLocale,
      `已完成《${pageTitle}》页面生成`,
      `Completed page "${pageTitle}" generation`
    )
  }
  if (candidate.length <= 120) return candidate
  return `${candidate.slice(0, 120).trimEnd()}…`
}

const buildPlanningRetryUserPrompt = (
  userPrompt: string,
  totalPages: number,
  previousError: string
): string =>
  [
    userPrompt,
    '',
    'Planning retry requirement:',
    `- The previous planning response failed validation: ${previousError}`,
    `- Retry now and return exactly ${totalPages} items.`,
    '- Return only a raw JSON array. Do not wrap it in Markdown. Do not add explanations.',
    '- Each item must have exactly these fields: title, keyPoints, layoutIntent.',
    '- keyPoints must be an array with 1-6 short strings.'
  ].join('\n')

const buildDesignContractRetryUserPrompt = (userPrompt: string, previousError: string): string =>
  [
    userPrompt,
    '',
    'Design contract retry requirement:',
    `- The previous design contract response failed validation: ${previousError}`,
    '- Retry now and return only a raw JSON object. Do not wrap it in Markdown. Do not add explanations.',
    '- Use exactly these fields: theme, background, palette, titleStyle, layoutMotif, chartStyle, shapeLanguage.',
    '- palette must be an array with 3-6 color strings.',
    '- titleStyle must use text-5xl and must not use text-6xl, text-7xl, or text-8xl.'
  ].join('\n')

export const planDeckWithLLM = async (args: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  temperature?: number
  styleId: string | null | undefined
  totalPages: number
  appLocale?: AppLocale
  modelTimeoutMs?: number
  topic: string
  userMessage: string
  emit?: (chunk: GenerateChunkEvent) => void
  runId?: string
  signal?: AbortSignal
}): Promise<OutlineItem[]> => {
  const client = resolveModel(
    args.provider,
    args.apiKey,
    args.model,
    args.baseUrl,
    args.temperature
  )
  const systemPrompt = buildPlanningSystemPrompt(args.totalPages)
  const userPrompt = buildPlanningUserPrompt({
    topic: args.topic,
    totalPages: args.totalPages,
    userMessage: args.userMessage
  })
  const parsePlanningItems = (responseText: string): OutlineItem[] => {
    const parsed = parseModelJson(responseText, args.appLocale)
    if (!Array.isArray(parsed)) {
      throw new Error(
        uiText(
          args.appLocale,
          'LLM plan_deck 返回格式不正确，期望 [{title, keyPoints[], layoutIntent}] 数组。',
          'LLM plan_deck returned an invalid format; expected an array like [{ title, keyPoints[], layoutIntent }].'
        )
      )
    }
    if (parsed.length === 0 || typeof parsed[0] !== 'object' || parsed[0] === null) {
      throw new Error(
        uiText(
          args.appLocale,
          'LLM plan_deck pages 返回格式不正确，期望 [{title, keyPoints[], layoutIntent}] 数组。',
          'LLM plan_deck pages returned an invalid format; expected an array like [{ title, keyPoints[], layoutIntent }].'
        )
      )
    }
    const items: OutlineItem[] = (parsed as Array<Record<string, unknown>>).map((item, index) => {
      const title = String(item.title ?? '').trim()
      const keyPoints = normalizeKeyPoints(item.keyPoints)
      if (!title) {
        throw new Error(
          uiText(
            args.appLocale,
            `LLM plan_deck 第 ${index + 1} 项缺少 title，期望格式: { title, keyPoints[], layoutIntent }`,
            `LLM plan_deck item ${index + 1} is missing title; expected format: { title, keyPoints[], layoutIntent }`
          )
        )
      }
      if (keyPoints.length < 1) {
        throw new Error(
          uiText(
            args.appLocale,
            `LLM plan_deck 第 ${index + 1} 项 keyPoints 为空，至少需要 1 条。`,
            `LLM plan_deck item ${index + 1} has empty keyPoints; at least one item is required.`
          )
        )
      }
      return {
        title,
        contentOutline: normalizeOutlineText(keyPoints.join('；')),
        layoutIntent: normalizeLayoutIntent(item.layoutIntent)
      }
    })
    if (items.length === 0) {
      throw new Error(
        uiText(
          args.appLocale,
          'LLM plan_deck 返回空大纲。',
          'LLM plan_deck returned an empty outline.'
        )
      )
    }
    // Pad if LLM returned fewer pages than requested
    while (items.length < args.totalPages) {
      items.push({
        title: uiText(args.appLocale, `第 ${items.length + 1} 页`, `Page ${items.length + 1}`),
        contentOutline: '',
        layoutIntent: 'concept'
      })
    }
    return items.slice(0, args.totalPages)
  }

  args.emit?.({
    type: 'llm_status',
    payload: {
      runId: args.runId || '',
      stage: 'planning',
      label: progressText(args.appLocale, 'planning'),
      progress: 4,
      totalPages: args.totalPages,
      provider: args.provider,
      model: args.model,
      detail: uiText(
        args.appLocale,
        `正在生成 ${args.totalPages} 页的标题与要点`,
        `Generating titles and key points for ${args.totalPages} pages`
      )
    }
  })
  const maxAttempts = 2
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      args.emit?.({
        type: 'llm_status',
        payload: {
          runId: args.runId || '',
          stage: 'planning',
          label: progressText(args.appLocale, 'planning'),
          progress: 5,
          totalPages: args.totalPages,
          provider: args.provider,
          model: args.model,
          detail: uiText(
            args.appLocale,
            '页面计划格式异常，正在自动重试一次',
            'The page plan format was invalid; retrying once'
          )
        }
      })
    }
    const previousError =
      lastError instanceof Error ? lastError.message : lastError ? String(lastError) : ''
    const effectiveUserPrompt =
      attempt === 1
        ? userPrompt
        : buildPlanningRetryUserPrompt(userPrompt, args.totalPages, previousError)
    log.info('[llm] invoke plan_deck', {
      provider: args.provider,
      model: args.model,
      temperature: args.temperature ?? null,
      styleId: args.styleId || '',
      totalPages: args.totalPages,
      topic: args.topic,
      attempt,
      maxAttempts
    })
    try {
      const combinedSignal = modelCallSignal(args.modelTimeoutMs, 'planning', args.signal)
      const response = await client.invoke(
        [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: effectiveUserPrompt }
        ],
        { signal: combinedSignal }
      )
      const responseText = extractModelText(response)
      args.emit?.({
        type: 'llm_status',
        payload: {
          runId: args.runId || '',
          stage: 'planning',
          label: progressText(args.appLocale, 'planning'),
          progress: 9,
          totalPages: args.totalPages,
          provider: args.provider,
          model: args.model,
          detail: uiText(
            args.appLocale,
            '正在整理成可执行页面计划',
            'Converting outline into an executable page plan'
          )
        }
      })
      log.info('[llm] plan_deck response', {
        attempt,
        textLength: responseText.length,
        preview: JSON.stringify(
          responseText.length > 240 ? `${responseText.slice(0, 240)}…` : responseText
        )
      })
      return parsePlanningItems(responseText)
    } catch (error) {
      lastError = error
      if (args.signal?.aborted || attempt >= maxAttempts) {
        throw error
      }
      log.warn('[llm] plan_deck retry scheduled', {
        provider: args.provider,
        model: args.model,
        attempt,
        maxAttempts,
        reason: error instanceof Error ? error.message : String(error)
      })
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? 'Planning failed'))
}

export const buildDesignContractWithLLM = async (args: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  temperature?: number
  styleId: string | null | undefined
  styleSkillPrompt: string
  appLocale?: AppLocale
  modelTimeoutMs?: number
  totalPages: number
  emit?: (chunk: GenerateChunkEvent) => void
  runId?: string
  signal?: AbortSignal
}): Promise<DesignContract> => {
  const client = resolveModel(
    args.provider,
    args.apiKey,
    args.model,
    args.baseUrl,
    args.temperature
  )
  const totalPages = Math.max(1, args.totalPages)
  const systemPrompt = buildDesignContractSystemPrompt(args.styleSkillPrompt)
  const userPrompt = buildDesignContractUserPrompt()
  const parseDesignContract = (responseText: string): DesignContract => {
    const parsed = parseModelJson(responseText, args.appLocale)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(
        uiText(
          args.appLocale,
          'LLM design_contract 返回格式不正确，期望 JSON object。',
          'LLM design_contract returned an invalid format; expected a JSON object.'
        )
      )
    }
    const record = parsed as Record<string, unknown>
    const requiredKeys = [
      'theme',
      'background',
      'palette',
      'titleStyle',
      'layoutMotif',
      'chartStyle',
      'shapeLanguage'
    ]
    const missingKeys = requiredKeys.filter((key) => record[key] === undefined || record[key] === '')
    if (missingKeys.length > 0) {
      throw new Error(
        uiText(
          args.appLocale,
          `LLM design_contract 缺少字段：${missingKeys.join(', ')}`,
          `LLM design_contract is missing fields: ${missingKeys.join(', ')}`
        )
      )
    }
    if (!Array.isArray(record.palette) || record.palette.length < 3) {
      throw new Error(
        uiText(
          args.appLocale,
          'LLM design_contract palette 至少需要 3 个颜色。',
          'LLM design_contract palette must contain at least 3 colors.'
        )
      )
    }
    return normalizeDesignContract(parsed)
  }
  args.emit?.({
    type: 'llm_status',
    payload: {
      runId: args.runId || '',
      stage: 'planning',
      label: progressText(args.appLocale, 'planning'),
      progress: 9,
      totalPages,
      provider: args.provider,
      model: args.model,
      detail: uiText(args.appLocale, '正在生成独立设计契约', 'Generating design contract')
    }
  })
  const maxAttempts = 2
  let lastError: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      args.emit?.({
        type: 'llm_status',
        payload: {
          runId: args.runId || '',
          stage: 'planning',
          label: progressText(args.appLocale, 'planning'),
          progress: 9,
          totalPages,
          provider: args.provider,
          model: args.model,
          detail: uiText(
            args.appLocale,
            '设计契约格式异常，正在自动重试一次',
            'The design contract format was invalid; retrying once'
          )
        }
      })
    }
    const previousError =
      lastError instanceof Error ? lastError.message : lastError ? String(lastError) : ''
    const effectiveUserPrompt =
      attempt === 1 ? userPrompt : buildDesignContractRetryUserPrompt(userPrompt, previousError)
    try {
      const combinedSignal = modelCallSignal(args.modelTimeoutMs, 'design', args.signal)
      const response = await client.invoke(
        [
          {
            role: 'system' as const,
            content: systemPrompt
          },
          {
            role: 'user' as const,
            content: effectiveUserPrompt
          }
        ],
        { signal: combinedSignal }
      )
      const responseText = extractModelText(response)
      log.info('[llm] design_contract response', {
        attempt,
        textLength: responseText.length,
        preview: JSON.stringify(
          responseText.length > 240 ? `${responseText.slice(0, 240)}…` : responseText
        )
      })
      const contract = parseDesignContract(responseText)
      args.emit?.({
        type: 'llm_status',
        payload: {
          runId: args.runId || '',
          stage: 'planning',
          label: progressText(args.appLocale, 'planning'),
          progress: 10,
          totalPages,
          provider: args.provider,
          model: args.model,
          detail: contract.theme
        }
      })
      return contract
    } catch (error) {
      if (args.signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw error
      }
      lastError = error
      if (attempt < maxAttempts) {
        log.warn('[llm] design_contract retry scheduled', {
          provider: args.provider,
          model: args.model,
          attempt,
          maxAttempts,
          message: error instanceof Error ? error.message : String(error)
        })
        continue
      }
    }
  }
  log.warn('[llm] design_contract fallback', {
    provider: args.provider,
    model: args.model,
    temperature: args.temperature ?? null,
    styleId: args.styleId || '',
    message: lastError instanceof Error ? lastError.message : String(lastError)
  })
  return normalizeDesignContract(null)
}

export const runDeepAgentDeckGeneration = async (args: {
  sessionId: string
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  temperature?: number
  styleId: string | null | undefined
  styleSkillPrompt: string
  appLocale?: AppLocale
  modelTimeoutMs?: number
  topic: string
  deckTitle: string
  allowWebSearch?: boolean
  webSearchEngines?: string[]
  webSearchLimit?: number
  userMessage: string
  outlineTitles: string[]
  outlineItems: OutlineItem[]
  sourceDocumentPaths?: string[]
  generationMode?: 'generate' | 'retry'
  pageTasks?: Array<{
    pageNumber: number
    pageId: string
    title: string
    contentOutline?: string | null
    layoutIntent?: OutlineItem['layoutIntent']
  }>
  designContract: DesignContract
  projectDir: string
  indexPath: string
  pageFileMap: Record<string, string>
  agentManager: AgentManager
  emit?: (chunk: GenerateChunkEvent) => void
  onPageCompleted?: (page: {
    pageNumber: number
    pageId: string
    title: string
    contentOutline: string
    layoutIntent?: OutlineItem['layoutIntent']
    htmlPath: string
  }) => Promise<void>
  onPageFailed?: (page: {
    pageNumber: number
    pageId: string
    title: string
    contentOutline: string
    layoutIntent?: OutlineItem['layoutIntent']
    htmlPath: string
    reason: string
  }) => Promise<void>
  runId?: string
  signal?: AbortSignal
}): Promise<{
  summary: string
  failedPages: Array<{ pageId: string; title: string; reason: string }>
}> => {
  type PageRef = {
    pageNumber: number
    pageId: string
    title: string
    outline: string
    layoutIntent?: OutlineItem['layoutIntent']
  }
  const pageRefs: PageRef[] =
    args.pageTasks && args.pageTasks.length > 0
      ? args.pageTasks.map((page) => ({
          pageNumber: page.pageNumber,
          pageId: page.pageId,
          title: page.title,
          outline: page.contentOutline || '',
          layoutIntent: page.layoutIntent
        }))
      : args.outlineTitles.map((title, index) => ({
          pageNumber: index + 1,
          pageId: `page-${index + 1}`,
          title,
          outline: args.outlineItems[index]?.contentOutline || '',
          layoutIntent: args.outlineItems[index]?.layoutIntent
        }))
  const totalPages = pageRefs.length
  const clampProgress = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))
  const pageSummaryMap = new Map<number, string>()
  const useDualWorkerQueue = totalPages >= 3
  const pageProgressMap = new Map<string, number>()
  let renderingProgress = 0
  const toRenderingProgress = (target: number): number => {
    const capped = clampProgress(Math.min(90, target))
    renderingProgress = Math.max(renderingProgress, capped)
    return renderingProgress
  }
  const emitRenderingStatus = (input: {
    label: string
    detail?: string
    progress: number
  }): void => {
    args.emit?.({
      type: 'llm_status',
      payload: {
        runId: args.runId || '',
        stage: 'rendering',
        label: input.label,
        detail: input.detail,
        progress: toRenderingProgress(input.progress),
        totalPages,
        provider: args.provider,
        model: args.model
      }
    })
  }

  const setPageProgress = (pageId: string, rawProgress: number): number => {
    const prev = pageProgressMap.get(pageId) ?? 0
    const bounded = Math.max(0, Math.min(100, Math.round(rawProgress)))
    const next = Math.max(prev, bounded)
    pageProgressMap.set(pageId, next)
    return next
  }

  const getCompletedPageCount = (): number =>
    pageRefs.reduce(
      (count, page) => count + ((pageProgressMap.get(page.pageId) ?? 0) >= 100 ? 1 : 0),
      0
    )

  const getOverallRenderProgress = (): number => {
    const sum = pageRefs.reduce((acc, page) => acc + (pageProgressMap.get(page.pageId) ?? 0), 0)
    const ratio = sum / Math.max(1, totalPages * 100)
    return 10 + ratio * 80
  }

  const resolvePageProgressFromCustomStatus = (custom: DeckToolStatusChunk): number => {
    const label = custom.label || ''
    if (/读取会话上下文|Reading session context/i.test(label)) return 25
    if (/更新\s*page-\d+|更新单页\s*page-\d+|Updating\s*page-\d+/i.test(label)) return 60
    if (/验证完成状态|Verifying completion/i.test(label)) return 85
    if (/所有页面已填充|当前页面已填充|All pages filled|Current page filled/i.test(label)) return 95
    if (/生成完成|修改完成|Generation completed|Edit completed/i.test(label)) return 100
    if (Number.isFinite(custom.progress)) {
      const raw = Number(custom.progress)
      return Math.max(12, Math.min(96, raw))
    }
    return 50
  }

  const emitPageStatus = (args: {
    pageId: string
    label: string
    detail?: string
    pageProgress: number
  }): void => {
    setPageProgress(args.pageId, args.pageProgress)
    emitRenderingStatus({
      label: args.label,
      detail: args.detail,
      progress: getOverallRenderProgress()
    })
  }

  emitRenderingStatus({
    label: progressText(args.appLocale, 'generating'),
    progress: 12,
    detail: uiText(args.appLocale, `共 ${totalPages} 页`, `${totalPages} pages`)
  })

  log.info('[deepagent] invoke deck generation', {
    sessionId: args.sessionId,
    provider: args.provider,
    model: args.model,
    temperature: args.temperature ?? null,
    styleId: args.styleId || '',
    projectDir: args.projectDir,
    indexPath: args.indexPath,
    totalPages,
    fixedConcurrency: useDualWorkerQueue ? 2 : 1,
    designContract: {
      theme: args.designContract.theme,
      background: args.designContract.background,
      palette: args.designContract.palette,
      titleStyle: args.designContract.titleStyle
    }
  })

  const referenceDocumentRetriever = args.sourceDocumentPaths?.length
    ? await createReferenceDocumentRetriever({
        sessionId: args.sessionId,
        projectDir: args.projectDir,
        sourceDocumentPaths: args.sourceDocumentPaths
      })
    : null

  const generateSinglePage = async (
    page: PageRef,
    workerLabel: string,
    retryContext?: {
      attempt: number
      maxRetries: number
      previousError: string
    }
  ): Promise<string> => {
    if (args.signal?.aborted) {
      throw new Error(uiText(args.appLocale, '生成已取消', 'Generation canceled'))
    }
    const pageStartedAt = Date.now()

    emitPageStatus({
      pageId: page.pageId,
      label: progressText(args.appLocale, 'generating'),
      detail: `${page.pageId} · ${page.title}`,
      pageProgress: 5
    })

    const currentPagePath = args.pageFileMap[page.pageId]
    if (!currentPagePath) {
      throw new Error(`pageFileMap 缺少 ${page.pageId} 对应文件路径`)
    }
    log.info('[deepagent] page generation context', {
      sessionId: args.sessionId,
      worker: workerLabel,
      styleId: args.styleId || '',
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      pagePath: currentPagePath,
      outline: page.outline || '',
      outlineLength: (page.outline || '').length
    })

    const referenceDocumentSnippets = referenceDocumentRetriever
      ? formatReferenceDocumentSnippets(
          referenceDocumentRetriever.search({
            pageId: page.pageId,
            pageTitle: page.title,
            pageOutline: page.outline,
            userMessage: args.userMessage
          })
        )
      : ''
    log.info('[deepagent] reference document snippets prepared', {
      sessionId: args.sessionId,
      pageId: page.pageId,
      pageNumber: page.pageNumber,
      title: page.title,
      hasSourceDocuments: Boolean(args.sourceDocumentPaths?.length),
      hasRetriever: Boolean(referenceDocumentRetriever),
      injected: referenceDocumentSnippets.trim().length > 0,
      injectedCharacterCount: referenceDocumentSnippets.length
    })

    const deepAgent = createSessionDeckAgent({
      provider: args.provider,
      apiKey: args.apiKey,
      model: args.model,
      baseUrl: args.baseUrl,
      temperature: args.temperature,
      styleId: args.styleId,
      context: {
        sessionId: args.sessionId,
        projectDir: args.projectDir,
        indexPath: args.indexPath,
        topic: args.topic,
        deckTitle: args.deckTitle,
        styleId: args.styleId,
        allowWebSearch: args.allowWebSearch,
        webSearchEngines: args.webSearchEngines,
        webSearchLimit: args.webSearchLimit,
        styleSkillPrompt: args.styleSkillPrompt,
        appLocale: args.appLocale,
        designContract: args.designContract,
        userMessage: args.userMessage,
        outlineTitles: [page.title],
        outlineItems: [
          { title: page.title, contentOutline: page.outline, layoutIntent: page.layoutIntent }
        ],
        sourceDocumentPaths: args.sourceDocumentPaths,
        mode: args.generationMode ?? 'generate',
        pageFileMap: { [page.pageId]: currentPagePath },
        selectedPageId: page.pageId,
        selectedPageNumber: page.pageNumber,
        existingPageIds: [page.pageId],
        allowedPageIds: [page.pageId]
      }
    })
    args.agentManager.setPageAgent(args.sessionId, page.pageId, deepAgent)

    try {
      const combinedSignal = modelCallSignal(args.modelTimeoutMs, 'agent', args.signal)
      const stream = await deepAgent.stream(
        {
          messages: [
            {
              role: 'user',
              content: buildSinglePageGenerationPrompt({
                topic: args.topic,
                deckTitle: args.deckTitle,
                pageId: page.pageId,
                pageNumber: page.pageNumber,
                pageTitle: page.title,
                pageOutline: page.outline,
                layoutIntent: page.layoutIntent,
                allowWebSearch: args.allowWebSearch,
                sourceDocumentPaths: args.sourceDocumentPaths,
                referenceDocumentSnippets,
                isRetryMode: args.generationMode === 'retry',
                designContract: args.designContract,
                retryContext
              })
            }
          ]
        },
        {
          streamMode: ['updates', 'messages', 'custom'],
          subgraphs: true,
          signal: combinedSignal
        }
      )

      let pageSummaryFromStatus = ''
      let pageSummaryFromMessage = ''
      await processAgentStream(stream, {
        emit: args.emit,
        runId: args.runId || '',
        stage: 'rendering',
        totalPages,
        provider: args.provider,
        model: args.model,
        sessionId: args.sessionId,
        workerLabel,
        onCustom: (custom) => {
          const mappedPageProgress = resolvePageProgressFromCustomStatus(custom)
          const normalizedLabel = progressLabel(args.appLocale, custom.label)
          const normalizedDetail =
            /所有页面已填充|当前页面已填充|All pages filled|Current page filled/i.test(
              custom.label || ''
            )
              ? uiText(
                  args.appLocale,
                  `${page.title} · 页面内容已写入`,
                  `${page.title} · page content written`
                )
              : custom.detail
          if (
            typeof custom.label === 'string' &&
            /生成完成|修改完成/.test(custom.label) &&
            typeof custom.detail === 'string' &&
            isMeaningfulSummary(custom.detail)
          ) {
            pageSummaryFromStatus = custom.detail.trim()
          }
          emitPageStatus({
            pageId: page.pageId,
            label: normalizedLabel,
            detail: normalizedDetail,
            pageProgress: mappedPageProgress
          })
        },
        onModelThinking: (defaultProgress) => {
          const mappedPageProgress = Math.max(12, Math.min(96, defaultProgress))
          emitPageStatus({
            pageId: page.pageId,
            label: progressText(args.appLocale, 'generating'),
            detail: page.title,
            pageProgress: mappedPageProgress
          })
        },
        onMessage: (content) => {
          if (!isMeaningfulSummary(content)) return
          pageSummaryFromMessage = content.trim()
        }
      })

      await args.onPageCompleted?.({
        pageNumber: page.pageNumber,
        pageId: page.pageId,
        title: page.title,
        contentOutline: page.outline,
        layoutIntent: page.layoutIntent,
        htmlPath: currentPagePath
      })

      setPageProgress(page.pageId, 100)
      const completedCount = getCompletedPageCount()
      emitRenderingStatus({
        label: progressText(args.appLocale, 'completed'),
        detail: uiText(
          args.appLocale,
          `${page.title} · 已完成 ${completedCount}/${totalPages} 页`,
          `${page.title} · ${completedCount}/${totalPages} pages completed`
        ),
        progress: getOverallRenderProgress()
      })

      log.info('[deepagent] page generation finished', {
        sessionId: args.sessionId,
        worker: workerLabel,
        styleId: args.styleId || '',
        pageId: page.pageId,
        retryAttempt: retryContext?.attempt || 0,
        elapsedMs: Date.now() - pageStartedAt,
        pagePath: currentPagePath
      })

      const rawSummary = pageSummaryFromMessage || pageSummaryFromStatus
      return normalizePageSummary(rawSummary, page.title, args.appLocale)
    } finally {
      args.agentManager.removePageAgent(args.sessionId, page.pageId)
    }
  }

  // 仅重试失败页面，避免影响已成功页面。
  // MAX_PAGE_RETRIES=3 表示首轮失败后最多再重试 3 次。
  const MAX_PAGE_RETRIES = 3
  const RETRY_DELAY_BASE_MS = 1_000
  const generateSinglePageWithRetry = async (
    page: {
      pageNumber: number
      pageId: string
      title: string
      outline: string
    },
    workerLabel: string
  ): Promise<string> => {
    let lastError: unknown = null
    for (let attempt = 0; attempt <= MAX_PAGE_RETRIES; attempt++) {
      try {
        const retryContext =
          attempt > 0 && lastError
            ? {
                attempt,
                maxRetries: MAX_PAGE_RETRIES,
                previousError: lastError instanceof Error ? lastError.message : String(lastError)
              }
            : undefined
        return await generateSinglePage(page, workerLabel, retryContext)
      } catch (error) {
        lastError = error
        const reason = error instanceof Error ? error.message : String(error)
        if (attempt >= MAX_PAGE_RETRIES) break
        const retryAttempt = attempt + 1
        const retryDelayMs = RETRY_DELAY_BASE_MS * retryAttempt
        emitPageStatus({
          pageId: page.pageId,
          label: progressText(args.appLocale, 'retrying'),
          detail: uiText(
            args.appLocale,
            `仅重试失败页：上次失败原因 ${reason}`,
            `Retrying only the failed page. Previous failure: ${reason}`
          ),
          pageProgress: 12
        })
        log.warn('[deepagent] page generation retry scheduled', {
          sessionId: args.sessionId,
          styleId: args.styleId || '',
          pageId: page.pageId,
          worker: workerLabel,
          attempt: retryAttempt,
          maxRetries: MAX_PAGE_RETRIES,
          retryDelayMs,
          lastErrorReason: reason,
          reason
        })
        await sleep(retryDelayMs, args.signal)
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error(
          String(lastError ?? uiText(args.appLocale, '页面生成失败', 'Page generation failed'))
        )
  }

  const workerCount = useDualWorkerQueue ? 2 : 1
  const PAGE_GENERATION_STAGGER_MS = 500
  if (useDualWorkerQueue) {
    emitRenderingStatus({
      label: progressText(args.appLocale, 'generating'),
      progress: 14,
      detail: uiText(args.appLocale, '创意即将正式生成..', 'Generation is about to begin.')
    })
  }
  const limit = pLimit(workerCount)
  const settled = await Promise.allSettled(
    pageRefs.map((page, index) =>
      limit(async () => {
        if (args.signal?.aborted)
          throw new Error(uiText(args.appLocale, '生成已取消', 'Generation canceled'))
        const workerLabel = useDualWorkerQueue ? 'limit-worker' : 'single-worker'
        const launchDelayMs = useDualWorkerQueue
          ? (index % workerCount) * PAGE_GENERATION_STAGGER_MS
          : 0
        if (launchDelayMs > 0) {
          log.info('[deepagent] queue stagger delay', {
            sessionId: args.sessionId,
            worker: workerLabel,
            styleId: args.styleId || '',
            pageId: page.pageId,
            pageNumber: page.pageNumber,
            delayMs: launchDelayMs
          })
          await sleep(launchDelayMs, args.signal)
        }
        if (args.signal?.aborted)
          throw new Error(uiText(args.appLocale, '生成已取消', 'Generation canceled'))
        log.info('[deepagent] queue dispatch', {
          sessionId: args.sessionId,
          worker: workerLabel,
          styleId: args.styleId || '',
          pageId: page.pageId,
          pageNumber: page.pageNumber,
          title: page.title
        })
        try {
          const summary = await generateSinglePageWithRetry(page, workerLabel)
          if (summary) {
            pageSummaryMap.set(
              page.pageNumber,
              uiText(
                args.appLocale,
                `第 ${page.pageNumber} 页：${summary}`,
                `Page ${page.pageNumber}: ${summary}`
              )
            )
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          await args.onPageFailed?.({
            pageNumber: page.pageNumber,
            pageId: page.pageId,
            title: page.title,
            contentOutline: page.outline,
            layoutIntent: page.layoutIntent,
            htmlPath: args.pageFileMap[page.pageId] || '',
            reason
          })
          throw error
        }
      })
    )
  )
  const failedPages: Array<{ pageId: string; title: string; reason: string }> = []
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      const page = pageRefs[index]
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason)
      failedPages.push({
        pageId: page.pageId,
        title: page.title,
        reason
      })
      log.warn('[deepagent] page generation failed', {
        sessionId: args.sessionId,
        styleId: args.styleId || '',
        pageId: page.pageId,
        reason
      })
    }
  })
  const finalAssistantText = pageRefs
    .map((page) => pageSummaryMap.get(page.pageNumber))
    .filter((item): item is string => Boolean(item))
    .join('\n')
  log.info('[deepagent] host worker queue generation completed', {
    sessionId: args.sessionId,
    styleId: args.styleId || '',
    totalPages,
    workerCount,
    finalAssistantPreview: finalAssistantText.slice(0, 200)
  })
  return {
    summary: finalAssistantText,
    failedPages
  }
}

export const runDeepAgentEdit = async (args: {
  sessionId: string
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  temperature?: number
  styleId: string | null | undefined
  styleSkillPrompt: string
  appLocale?: AppLocale
  modelTimeoutMs?: number
  topic: string
  deckTitle: string
  allowWebSearch?: boolean
  webSearchEngines?: string[]
  webSearchLimit?: number
  userMessage: string
  outlineTitles: string[]
  outlineItems: OutlineItem[]
  projectDir: string
  indexPath: string
  pageFileMap: Record<string, string>
  designContract?: DesignContract
  editScope: 'main' | 'page'
  selectedPageId?: string
  selectedPageNumber?: number
  selectedSelector?: string
  elementTag?: string
  elementText?: string
  existingPageIds?: string[]
  agentManager: AgentManager
  emit?: (chunk: GenerateChunkEvent) => void
  runId?: string
  signal?: AbortSignal
}): Promise<string> => {
  const editAgent = createSessionEditAgent({
    provider: args.provider,
    apiKey: args.apiKey,
    model: args.model,
    baseUrl: args.baseUrl,
    temperature: args.temperature,
    styleId: args.styleId,
    context: {
      mode: 'edit',
      editScope: args.editScope,
      sessionId: args.sessionId,
      projectDir: args.projectDir,
      indexPath: args.indexPath,
      topic: args.topic,
      deckTitle: args.deckTitle,
      styleId: args.styleId,
      allowWebSearch: args.allowWebSearch,
      webSearchEngines: args.webSearchEngines,
      webSearchLimit: args.webSearchLimit,
      styleSkillPrompt: args.styleSkillPrompt,
      appLocale: args.appLocale,
      designContract: args.designContract,
      userMessage: args.userMessage,
      outlineTitles: args.outlineTitles,
      outlineItems: args.outlineItems,
      pageFileMap: args.pageFileMap,
      selectedPageId: args.selectedPageId,
      selectedPageNumber: args.selectedPageNumber,
      selectedSelector: args.selectedSelector,
      elementTag: args.elementTag,
      elementText: args.elementText,
      existingPageIds: args.existingPageIds,
      allowedPageIds:
        args.editScope === 'page' && args.selectedPageId ? [args.selectedPageId] : undefined
    }
  })
  args.agentManager.setAgent(args.sessionId, editAgent)

  args.emit?.({
    type: 'llm_status',
    payload: {
      runId: args.runId || '',
      stage: 'editing',
      label: progressText(args.appLocale, 'generating'),
      progress: 40,
      totalPages: args.outlineTitles.length,
      provider: args.provider,
      model: args.model,
      detail:
        args.editScope === 'main'
          ? uiText(
              args.appLocale,
              '仅修改 index.html 总览壳，不会改动 page 页面内容',
              'Only modifying the index.html overview shell; page content will not be changed'
            )
          : uiText(
              args.appLocale,
              '仅修改目标页面，不会重排整套内容',
              'Only modifying the target page; the whole deck will not be rearranged'
            )
    }
  })

  log.info('[deepagent] invoke edit agent', {
    sessionId: args.sessionId,
    provider: args.provider,
    model: args.model,
    temperature: args.temperature ?? null,
    styleId: args.styleId || '',
    projectDir: args.projectDir,
    indexPath: args.indexPath,
    editScope: args.editScope,
    selectedPageId: args.selectedPageId,
    selectedPageNumber: args.selectedPageNumber,
    selectedSelector: args.selectedSelector || '',
    elementTag: args.elementTag || '',
    elementText: args.elementText || ''
  })

  let finalAssistantText = ''
  const totalPages = args.outlineTitles.length
  let editProgress = 40
  const emitEditStatus = (payload: { label: string; detail?: string; progress?: number }): void => {
    const bounded = Math.max(0, Math.min(100, Math.round(payload.progress ?? editProgress)))
    editProgress = Math.max(editProgress, bounded)
    args.emit?.({
      type: 'llm_status',
      payload: {
        runId: args.runId || '',
        stage: 'editing',
        label: payload.label,
        detail: payload.detail,
        progress: editProgress,
        totalPages,
        provider: args.provider,
        model: args.model
      }
    })
  }

  try {
    const editCombinedSignal = modelCallSignal(args.modelTimeoutMs, 'agent', args.signal)
    const stream = await editAgent.stream(
      {
        messages: [
          {
            role: 'user',
            content: buildEditUserPrompt({
              userMessage: args.userMessage,
              editScope: args.editScope,
              selectedPageId: args.selectedPageId,
              selectedPageNumber: args.selectedPageNumber,
              selectedSelector: args.selectedSelector,
              elementTag: args.elementTag,
              elementText: args.elementText,
              existingPageIds: args.existingPageIds
            })
          }
        ]
      },
      {
        streamMode: ['updates', 'messages', 'custom'],
        subgraphs: true,
        signal: editCombinedSignal
      }
    )

    await processAgentStream(stream, {
      emit: args.emit,
      runId: args.runId || '',
      stage: 'editing',
      totalPages,
      provider: args.provider,
      model: args.model,
      sessionId: args.sessionId,
      onCustom: (custom) => {
        emitEditStatus({
          label: progressLabel(args.appLocale, custom.label),
          detail: custom.detail,
          progress: custom.progress ?? 50
        })
      },
      onModelThinking: (defaultProgress) => {
        emitEditStatus({
          label: progressText(args.appLocale, 'understanding'),
          detail: uiText(
            args.appLocale,
            '正在规划最小改动路径',
            'Planning the smallest safe edit path'
          ),
          progress: defaultProgress
        })
      },
      onMessage: (content) => {
        finalAssistantText = content
      }
    })
  } finally {
    args.agentManager.clearAgent(args.sessionId)
  }

  log.info('[deepagent] edit agent completed', {
    sessionId: args.sessionId,
    styleId: args.styleId || '',
    finalAssistantPreview: finalAssistantText.slice(0, 200)
  })

  return finalAssistantText
}
