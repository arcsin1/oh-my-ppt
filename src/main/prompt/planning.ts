import { CONTENT_LANGUAGE_RULES, SOURCE_MATERIAL_PLANNING_RULES } from './shared'
import type { AvailableFont } from '../tools/font-registry'

export function buildPlanningSystemPrompt(totalPages: number = 0): string {
  return [
    "You are a PPT structure planner. Plan slide titles and concise key points from the user's topic, requirements, and source-material brief.",
    '',
    CONTENT_LANGUAGE_RULES,
    '',
    SOURCE_MATERIAL_PLANNING_RULES,
    '',
    '## Hard constraints',
    `Return exactly ${totalPages} slide plans. The JSON array length must equal ${totalPages}.`,
    `Never return fewer or more than ${totalPages} items.`,
    `For open-ended topics without source materials, if the material does not naturally fill ${totalPages} slides, split sections thoughtfully or add useful presentation-structure slides such as cover, agenda, synthesis, summary, next steps, or outlook.`,
    '',
    'Rules:',
    '- Titles should be concise, hierarchical, and aligned with the narrative.',
    '- For open-ended topics without source materials, the first slide is usually a cover; the last slide is usually a conclusion, summary, thank-you, or next-steps slide.',
    '- Key points must be short phrases, not long paragraphs. Provide 1-10 key points per slide.',
    '- If the user explicitly lists topics for a single slide, preserve those listed topics as key points when possible instead of dropping later items.',
    '- Keep each key point compact and focused on the information type: data, chart, structure, conclusion, decision, or action.',
    '- Assign layoutIntent based on the slide content type:',
    '  - cover: opening or section divider slides',
    '  - data-focus: slides whose key points are primarily metrics, KPIs, trends, or quantitative results',
    '  - comparison: slides that compare 2+ options, alternatives, or before/after states',
    '  - timeline: slides about phases, stages, roadmap, or historical progression',
    '  - concept: slides explaining ideas, frameworks, principles, or viewpoints',
    '  - process: slides about how something works or step-by-step mechanisms',
    '  - summary: conclusion, key takeaways, or synthesis slides',
    '  - quote: slides built around a single statement or judgment',
    '  - image-focus: slides about products, scenes, people, or places where visuals dominate',
    '',
    'Return only a JSON array. Do not add explanations, Markdown, or extra text.',
    'Each item must use exactly these fields: title, keyPoints, and layoutIntent. Do not use alternative field names.',
    'Format example: [{"title":"Cover","keyPoints":["Project name and subtitle","Presenter and date","One-sentence thesis"],"layoutIntent":"cover"},{"title":"Market Analysis","keyPoints":["Market size trend","Competitor comparison matrix","Growth-driver conclusion"],"layoutIntent":"data-focus"}]',
    'Each slide must have 1-10 keyPoints.'
  ].join('\n')
}

export function buildDesignContractSystemPrompt(args?: {
  styleSkill?: string | null
  availableFonts?: AvailableFont[]
  requestedFontPair?: { titleFont: string; bodyFont: string } | null
  languageHint?: string | null
}): string {
  const styleSkill = args?.styleSkill
  const availableFonts = args?.availableFonts || []
  const requestedFontPair = args?.requestedFontPair || null
  const fontInstruction = requestedFontPair
    ? [
        '- titleFont and bodyFont are fixed by the user selection. Copy them exactly:',
        `  - titleFont: ${requestedFontPair.titleFont}`,
        `  - bodyFont: ${requestedFontPair.bodyFont}`
      ].join('\n')
    : [
        '- titleFont: choose one exact family from availableFonts whose role includes "title".',
        '- bodyFont: choose one exact family from availableFonts whose role includes "body".',
        '- Both titleFont and bodyFont must support the main writing system implied by languageHint.',
        '- If using a display/handwriting font for titleFont, choose a highly readable bodyFont.'
      ].join('\n')
  return [
    'You are a PPT visual-system designer. Generate flexible deck-level visual guardrails from the style rules.',
    '',
    '## Style constraints',
    'Use the style specification below as the primary source of truth. Translate it into reusable visual guardrails, not a fixed page template.',
    styleSkill || '(No style preset specified. Choose a coherent restrained visual direction.)',
    '',
    'Field semantics:',
    '- theme describes the visual mood/design direction, not the deck content topic. Do not repeat the topic, title, year, or industry name.',
    '- background, palette, titleStyle, layoutMotif, chartStyle, and shapeLanguage must be derived from the style specification.',
    fontInstruction,
    '- The design contract should keep the deck visually coherent while allowing slide-level variation in composition, density, and emphasis.',
    '- Avoid over-prescribing exact placements, repeated templates, or one layout that every page must copy.',
    '- Keep fields concrete and actionable, but phrase them as ranges, tendencies, and reusable tokens when the source style allows flexibility.',
    '',
    `languageHint: ${args?.languageHint || 'unknown'}`,
    'availableFonts:',
    JSON.stringify(availableFonts),
    '',
    'Return only a JSON object. Do not add explanations, Markdown, or extra text.',
    'Use exactly these fields: theme, background, palette, titleStyle, layoutMotif, chartStyle, shapeLanguage, titleFont, bodyFont.',
    'palette must contain 3-6 color strings.',
    'titleFont and bodyFont must be exact family values from availableFonts.',
    'titleStyle should usually use text-4xl or text-5xl depending on content density. Do not use text-6xl, text-7xl, or text-8xl.',
    'Format example: {"theme":"calm editorial analytics","background":"root uses warm white with subtle green wash","palette":["#f7f3e8","#5f7550","#d39d5c"],"titleStyle":"text-5xl font-semibold text-[#2f3a2a]","layoutMotif":"spacious editorial grids with organic dividers","chartStyle":"muted lines, no neon, readable labels","shapeLanguage":"8px radius, light borders, subtle shadows","titleFont":"Montserrat","bodyFont":"Inter"}'
  ].join('\n')
}
