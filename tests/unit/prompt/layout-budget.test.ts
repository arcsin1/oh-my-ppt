import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'

const projectRoot = process.cwd()

const readProjectFile = (filePath: string) =>
  readFileSync(path.join(projectRoot, filePath), 'utf-8')

describe('layout prompt budget guardrails', () => {
  it('keeps fullscreen backgrounds separate from conservative content budget', () => {
    const sharedPrompt = readProjectFile('src/main/prompt/shared.ts')
    const layoutSkill = readProjectFile('resources/skills/oh-my-ppt-layout/SKILL.md')

    expect(sharedPrompt).toContain('背景可以铺满 1600×900')
    expect(sharedPrompt).toContain('保留 24-40px 余量')
    expect(layoutSkill).toContain('Full-bleed backgrounds may use the entire 1600×900 canvas')
    expect(layoutSkill).toContain('24-40px spare height')
  })

  it('prevents overpacked chart slides with two-row support grids', () => {
    const layoutSkill = readProjectFile('resources/skills/oh-my-ppt-layout/SKILL.md')
    const chartSkill = readProjectFile('resources/skills/oh-my-ppt-chart/SKILL.md')
    const chartReference = readProjectFile('resources/skills/oh-my-ppt-chart/references/chart.md')

    expect(layoutSkill).toContain('Overpacked chart slide guardrails')
    expect(layoutSkill).toContain('Do not create two-row bottom card grids below a tall chart')
    expect(layoutSkill).toContain('support modules are capped at 1-3 compact blocks')
    expect(chartSkill).toContain('Do not pair a standard/tall chart with a two-row bottom card grid')
    expect(chartReference).toContain('Never place a two-row bottom card grid under a standard/tall chart')
  })

  it('keeps layout guidance density-driven and requires a pre-write size self-check', () => {
    const sharedPrompt = readProjectFile('src/main/prompt/shared.ts')
    const layoutSkill = readProjectFile('resources/skills/oh-my-ppt-layout/SKILL.md')
    const chartSkill = readProjectFile('resources/skills/oh-my-ppt-chart/SKILL.md')
    const chartReference = readProjectFile('resources/skills/oh-my-ppt-chart/references/chart.md')

    expect(layoutSkill).toContain('Self-check width/height')
    expect(layoutSkill).toContain('Width must fit 1600px and height must fit 900px')
    expect(layoutSkill).toContain('Do not mechanically reuse the same card grid')
    expect(sharedPrompt).toContain('不要机械套固定布局')
    expect(chartSkill).toContain('redesign the chart/support relationship')
    expect(chartReference).toContain('redesign the chart/support relationship')

    const combinedPrompt = [sharedPrompt, layoutSkill, chartSkill, chartReference].join('\n')
    expect(combinedPrompt).not.toContain('cut content')
    expect(combinedPrompt).not.toContain('move support modules to another slide')
    expect(combinedPrompt).not.toContain('split the content')
    expect(combinedPrompt).not.toContain('放不下就减模块')
  })
})
