import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { FilesystemBackend, createDeepAgent } from 'deepagents'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import { extractJsonBlock, extractModelText, resolveModel } from '../agent-runtime/model'
import type { ModelRuntimeConfig } from '../agent-runtime/model'
import type { StylePackageJson } from './style-package'

const MAX_RECOMMENDATION_COUNT = 4
const STYLE_CATALOG_PATH = '/style-catalog.json'

export type StyleRecommendationInput = {
  topic: string
  brief?: string
  styles: StylePackageJson[]
}

type StyleRecommendationAgentArgs = StyleRecommendationInput & {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  maxTokens?: number
  modelRuntime?: ModelRuntimeConfig
  modelTimeoutMs: number
  workspaceDir: string
}

export function buildStyleRecommendationPrompt(input: StyleRecommendationInput): string {
  return [
    `Read ${STYLE_CATALOG_PATH} before choosing presentation styles.`,
    'Select exactly four distinct values from each style entry\'s "style" field. Use fewer only when fewer than four styles are available.',
    'Match the presentation topic and brief to the style descriptions, use cases, and visual directions.',
    'Prioritize styles with a non-empty "imageGeneration.prompt" when they fit the content. Use a style without image generation only when its data, process, or framework direction is clearly a better fit.',
    'Return only a JSON array of the selected style values, ordered from the best fit to the next best fit. Do not include explanations, markdown, or any other text.',
    '',
    `Topic: ${input.topic}`,
    input.brief?.trim() ? `Brief: ${input.brief.trim()}` : ''
  ]
    .filter(Boolean)
    .join('\n')
}

export function serializeStyleRecommendationCatalog(styles: StylePackageJson[]): string {
  return JSON.stringify({ styles }, null, 2) + '\n'
}

export function parseStyleRecommendationResponse(
  response: unknown,
  availableStyleKeys: Iterable<string>
): string[] {
  const available = new Set(
    Array.from(availableStyleKeys, (styleKey) => String(styleKey || '').trim()).filter(Boolean)
  )
  const text = extractModelText(response) || (typeof response === 'string' ? response : '')
  const jsonText = extractJsonBlock(text).trim()
  if (!jsonText) throw new Error('风格推荐失败：AI 未返回推荐结果。')

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    throw new Error('风格推荐失败：AI 返回格式无效。')
  }
  const values = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { styles?: unknown }).styles)
      ? (parsed as { styles: unknown[] }).styles
      : []

  const result: string[] = []
  for (const value of values) {
    const styleKey = typeof value === 'string' ? value.trim() : ''
    if (!styleKey || !available.has(styleKey) || result.includes(styleKey)) continue
    result.push(styleKey)
    if (result.length === MAX_RECOMMENDATION_COUNT) break
  }
  if (result.length === 0) throw new Error('风格推荐失败：AI 未返回可用风格。')
  return result
}

async function runStyleRecommendationAgent(args: StyleRecommendationAgentArgs): Promise<string> {
  const model = resolveModel(
    args.provider,
    args.apiKey,
    args.model,
    args.baseUrl,
    0.2,
    args.maxTokens,
    args.modelRuntime
  )
  const agent = createDeepAgent({
    model,
    backend: new FilesystemBackend({ rootDir: args.workspaceDir, virtualMode: true }),
    systemPrompt:
      'You are a presentation style recommendation agent. You must use read_file to read /style-catalog.json before selecting styles. Your final response must be only the requested JSON array.'
  })
  const stream = await agent.stream(
    {
      messages: [{ role: 'user', content: buildStyleRecommendationPrompt(args) }]
    },
    {
      streamMode: ['messages'],
      subgraphs: true,
      signal: AbortSignal.timeout(resolveModelTimeoutMs(args.modelTimeoutMs, 'agent'))
    }
  )

  let response = ''
  for await (const chunk of stream as AsyncIterable<unknown>) {
    if (!Array.isArray(chunk) || chunk[1] !== 'messages' || !Array.isArray(chunk[2])) continue
    for (const message of chunk[2] as Array<Record<string, unknown>>) {
      const text = extractModelText(message).trim()
      if (text) response += text
    }
  }
  return response
}

export async function recommendStyles(
  args: Omit<StyleRecommendationAgentArgs, 'workspaceDir'>
): Promise<string[]> {
  const styles = args.styles.filter((style) => style.style.trim())
  if (styles.length === 0) return []

  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'ohmyppt-style-recommendation-'))
  try {
    await writeFile(
      path.join(workspaceDir, STYLE_CATALOG_PATH.slice(1)),
      serializeStyleRecommendationCatalog(styles),
      'utf8'
    )
    const response = await runStyleRecommendationAgent({ ...args, styles, workspaceDir })
    return parseStyleRecommendationResponse(
      response,
      styles.map((style) => style.style)
    )
  } finally {
    await rm(workspaceDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
