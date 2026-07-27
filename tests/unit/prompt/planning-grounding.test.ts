import { describe, expect, it } from 'vitest'
import { buildPlanningSystemPrompt } from '../../../src/main/prompt/planning'

describe('planning factual boundary', () => {
  it('forbids invented metadata and achieved-status claims without source material', () => {
    const prompt = buildPlanningSystemPrompt(5)

    expect(prompt).toContain('Never invent exact facts, metrics, dates, departments')
    expect(prompt).toContain('Treat requested goals, checks, risks, and acceptance criteria as planned work')
    expect(prompt).not.toContain('Presenter and date')
  })
})
