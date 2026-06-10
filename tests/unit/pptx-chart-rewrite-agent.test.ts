import { describe, expect, it, vi } from 'vitest'
import type { PptxChartRewriteRequest } from '../../src/main/utils/pptx-importer'

vi.mock('../../src/main/agent', () => ({
  resolveModel: vi.fn()
}))

vi.mock('../../src/main/skills/skill-paths', () => ({
  resolveBuiltinSkillsSourcePath: vi.fn(() => '/tmp/resources/skills')
}))

vi.mock('../../src/main/ipc/utils', () => ({
  extractJsonBlock: (raw: string) => {
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
    return match?.[1]?.trim() || raw
  },
  extractModelText: (value: unknown) =>
    typeof value === 'string'
      ? value
      : value && typeof value === 'object' && 'content' in value
        ? String((value as { content?: unknown }).content || '')
        : ''
}))

vi.mock('@shared/model-timeout', () => ({
  resolveModelTimeoutMs: vi.fn((value: number) => value)
}))

vi.mock('electron-log/main.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn()
  }
}))

import {
  buildPptxChartRewriteSystemPrompt,
  buildPptxChartRewriteUserPrompt,
  parsePptxChartRewriteAgentResponse
} from '../../src/main/utils/pptx-chart-rewrite-agent'

describe('pptx chart rewrite agent', () => {
  it('tells the agent to preserve importer absolute positioning', () => {
    const prompt = buildPptxChartRewriteSystemPrompt({
      skill: 'Use PPT.createChart(canvasElement, config).',
      reference: 'Chart.js examples'
    })

    expect(prompt).toContain('oh-my-ppt-chart/SKILL.md')
    expect(prompt).toContain('style="position:absolute; left:...; top:...; width:...; height:...; ..."')
    expect(prompt).toContain('Do not output HTML')
    expect(prompt).toContain('Return only a Chart.js config object')
  })

  it('includes the importer frame style as immutable context', () => {
    const request = {
      element: {
        type: 'chart',
        chartType: 'stockChart',
        data: [[1, 2]],
        colors: ['#123456']
      },
      blockId: 'chart-1',
      pageId: 'page-1',
      chartIndex: 1,
      canvasId: 'chart-page-1-1',
      frameStyle: 'position:absolute;left:10px;top:20px;width:300px;height:180px;',
      animationAttrs: 'data-anim="fade"',
      pageNumber: 2
    } as PptxChartRewriteRequest

    const prompt = buildPptxChartRewriteUserPrompt(request)

    expect(prompt).toContain('"blockId": "chart-1"')
    expect(prompt).toContain('"canvasId": "chart-page-1-1"')
    expect(prompt).toContain('"frameStyle": "position:absolute;left:10px;top:20px;width:300px;height:180px;"')
    expect(prompt).toContain('"chartType": "stockChart"')
  })

  it('parses config JSON and forces responsive chart options', () => {
    const result = parsePptxChartRewriteAgentResponse({
      content: `\`\`\`json
{
  "config": {
    "type": "line",
    "data": { "labels": ["A"], "datasets": [{ "data": [1] }] },
    "options": { "maintainAspectRatio": true }
  },
  "warnings": ["simplified"]
}
\`\`\``
    })

    expect(result?.config.type).toBe('line')
    expect(result?.config.options).toMatchObject({
      responsive: true,
      maintainAspectRatio: false
    })
    expect(result?.warnings).toEqual(['simplified'])
  })
})
