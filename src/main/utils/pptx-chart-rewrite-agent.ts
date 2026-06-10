import fs from 'fs'
import path from 'path'
import log from 'electron-log/main.js'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import { resolveModel } from '../agent'
import { extractJsonBlock, extractModelText } from '../ipc/utils'
import { resolveBuiltinSkillsSourcePath } from '../skills/skill-paths'
import type {
  PptxChartRewriteHandler,
  PptxChartRewriteRequest,
  PptxChartRewriteResult
} from './pptx-importer'

type PptxChartRewriteAgentOptions = {
  provider: string
  apiKey: string
  model: string
  baseUrl?: string
  maxTokens?: number
  modelTimeoutMs: number
  maxRewrites?: number
}

type ChartSkillDocs = {
  skill: string
  reference: string
}

const DEFAULT_MAX_REWRITES = 6
let cachedChartSkillDocs: ChartSkillDocs | null = null

const readChartSkillDocs = async (): Promise<ChartSkillDocs> => {
  if (cachedChartSkillDocs) return cachedChartSkillDocs
  const skillRoot = path.join(resolveBuiltinSkillsSourcePath(), 'oh-my-ppt-chart')
  const [skill, reference] = await Promise.all([
    fs.promises.readFile(path.join(skillRoot, 'SKILL.md'), 'utf-8'),
    fs.promises.readFile(path.join(skillRoot, 'references', 'chart.md'), 'utf-8').catch(() => '')
  ])
  cachedChartSkillDocs = { skill, reference }
  return cachedChartSkillDocs
}

const compactUnknown = (value: unknown, maxLength = 12000): unknown => {
  const text = JSON.stringify(value, (_key, item) => {
    if (typeof item === 'string' && item.length > 500) return `${item.slice(0, 500)}...`
    return item
  })
  if (!text || text.length <= maxLength) return value
  return `${text.slice(0, maxLength)}...`
}

const summarizeChartElement = (request: PptxChartRewriteRequest): Record<string, unknown> => {
  const record = request.element as unknown as Record<string, unknown>
  return {
    chartType: request.element.chartType,
    barDir: 'barDir' in request.element ? request.element.barDir : undefined,
    colors: request.element.colors || [],
    data: compactUnknown('data' in request.element ? request.element.data : null),
    position: {
      left: record.left,
      top: record.top,
      width: record.width,
      height: record.height
    }
  }
}

export const buildPptxChartRewriteSystemPrompt = (docs: ChartSkillDocs): string => `You are the dedicated PPTX chart parsing agent for Oh My PPT.

You convert one unsupported PPTX chart element into a safe Chart.js config for the existing importer.

You MUST follow the bundled product skill below.

<oh-my-ppt-chart/SKILL.md>
${docs.skill}
</oh-my-ppt-chart/SKILL.md>

<oh-my-ppt-chart/references/chart.md>
${docs.reference}
</oh-my-ppt-chart/references/chart.md>

Importer-specific override:
- The PPTX importer owns the HTML frame and MUST preserve its original absolute-positioned style.
- Do not rewrite or suggest changing the importer frame style. It must stay exactly like:
  style="position:absolute; left:...; top:...; width:...; height:...; ..."
- Do not output HTML.
- Return only a Chart.js config object that can be passed to PPT.createChart(canvasElement, config).
- Keep options responsive: true and maintainAspectRatio: false.
- Use only Chart.js v4-safe chart types: bar, line, pie, doughnut, radar, polarArea, scatter, bubble.
- If the source is too complex, choose the closest readable Chart.js representation instead of refusing.`

export const buildPptxChartRewriteUserPrompt = (request: PptxChartRewriteRequest): string => {
  const chart = summarizeChartElement(request)
  return `Rewrite this PPTX chart as a Chart.js config.

Output strict JSON only:
{
  "config": {
    "type": "line",
    "data": { "labels": [], "datasets": [] },
    "options": { "responsive": true, "maintainAspectRatio": false }
  },
  "warnings": []
}

Importer frame context that must be preserved by the caller, not rewritten by you:
{
  "blockId": ${JSON.stringify(request.blockId)},
  "canvasId": ${JSON.stringify(request.canvasId)},
  "frameStyle": ${JSON.stringify(request.frameStyle)},
  "animationAttrs": ${JSON.stringify(request.animationAttrs)}
}

PPTX chart element summary:
${JSON.stringify(chart, null, 2)}`
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value))

export const parsePptxChartRewriteAgentResponse = (
  response: unknown
): PptxChartRewriteResult | null => {
  const text = extractModelText(response) || (typeof response === 'string' ? response : '')
  const jsonText = extractJsonBlock(text).trim()
  if (!jsonText) return null

  const parsed = JSON.parse(jsonText) as Record<string, unknown>
  const config = parsed.config
  if (!isRecord(config) || typeof config.type !== 'string') return null
  const data = config.data
  if (!isRecord(data) || !Array.isArray(data.datasets)) return null

  const options = isRecord(config.options) ? config.options : {}
  config.options = {
    ...options,
    responsive: true,
    maintainAspectRatio: false
  }

  const warnings = Array.isArray(parsed.warnings)
    ? parsed.warnings.map((item) => String(item || '').trim()).filter(Boolean)
    : []

  return { config, warnings }
}

const rewritePptxChart = async (
  options: PptxChartRewriteAgentOptions,
  request: PptxChartRewriteRequest
): Promise<PptxChartRewriteResult | null> => {
  const docs = await readChartSkillDocs()
  const model = resolveModel(
    options.provider,
    options.apiKey,
    options.model,
    options.baseUrl,
    0.2,
    options.maxTokens
  )
  const response = await model.invoke(
    [
      { role: 'system', content: buildPptxChartRewriteSystemPrompt(docs) },
      { role: 'user', content: buildPptxChartRewriteUserPrompt(request) }
    ],
    { signal: AbortSignal.timeout(resolveModelTimeoutMs(options.modelTimeoutMs, 'document')) }
  )
  return parsePptxChartRewriteAgentResponse(response)
}

export const createPptxChartRewriteHandler = (
  options: PptxChartRewriteAgentOptions
): PptxChartRewriteHandler => {
  let rewriteCount = 0
  const maxRewrites = Math.max(0, options.maxRewrites ?? DEFAULT_MAX_REWRITES)
  return async (request) => {
    if (rewriteCount >= maxRewrites) return null
    rewriteCount += 1
    try {
      const result = await rewritePptxChart(options, request)
      log.info('[pptx:chartRewrite] completed', {
        pageNumber: request.pageNumber,
        blockId: request.blockId,
        chartType: request.element.chartType,
        success: Boolean(result)
      })
      return result
    } catch (error) {
      log.warn('[pptx:chartRewrite] failed', {
        pageNumber: request.pageNumber,
        blockId: request.blockId,
        chartType: request.element.chartType,
        message: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }
}
