import { CONTENT_LANGUAGE_RULES, SOURCE_MATERIAL_PLANNING_RULES } from './shared'
import type { AvailableFont } from '../tools/font-registry'
import { requireSlideSize, type SlideSizePreset } from '@shared/slide-size'

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
    '- The user request is the factual authority even when no source documents are attached.',
    '- Never invent exact facts, metrics, dates, departments, names, status claims, user feedback, decisions, or conclusions that the user did not provide.',
    '- If a factual field is missing, omit it and use grounded structure instead. Do not add sample values or placeholders such as a guessed presenter, department, date, or result.',
    '- Treat requested goals, checks, risks, and acceptance criteria as planned work, not as achieved outcomes.',
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
    'Format example: [{"title":"Cover","keyPoints":["User-provided project name","User-provided subtitle"],"layoutIntent":"cover"},{"title":"Acceptance Criteria","keyPoints":["Functional checks","Compatibility checks","Security checks"],"layoutIntent":"concept"}]',
    'Each slide must have 1-10 keyPoints.'
  ].join('\n')
}

export function buildDesignContractSystemPrompt(args: {
  styleSkill?: string | null
  availableFonts?: AvailableFont[]
  requestedFontPair?: { titleFont: string; bodyFont: string } | null
  languageHint?: string | null
  slideSize: SlideSizePreset
}): string {
  const styleSkill = args.styleSkill
  const availableFonts = args.availableFonts || []
  const requestedFontPair = args.requestedFontPair || null
  const slideSize = requireSlideSize(args.slideSize)
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
    '## Target canvas',
    `- Slide size id: ${slideSize.id}`,
    `- Exact dimensions: ${slideSize.width}x${slideSize.height}`,
    '- Generate layoutMotif for this exact canvas. The target dimensions override any different canvas ratio, width, or height implied by the style source.',
    '- layoutMotif should adapt the style into a flexible reading direction, visual-weight distribution, whitespace rhythm, and composition tendency for this canvas.',
    '- Do not prescribe one fixed page template that every slide must repeat.',
    '- Font sizes must scale with this canvas height. Presentation fits the canvas by min(vw/cw, vh/ch); taller canvases get a smaller scale, so text designed at 18px body (the 900h wide-screen default) becomes unreadable. Compute the height factor = canvasHeight/900, then scale font floors accordingly. Reference floors by canvas height:',    `  - 900h (wide-16-9):    body min 18px, heading min 24px, auxiliary min 12px`,
    `  - 1200h (4:3 / 1:1):  body min 24px, heading min 32px, auxiliary min 16px`,
    `  - 1600h (9:16 / 3:4): body min 32px, heading min 43px, auxiliary min 21px`,
    `  - 1660h (xiaohongshu): body min 33px, heading min 44px, auxiliary min 22px`,
    `  - Current target canvas height is ${slideSize.height}px — pick the closest row above, or interpolate.`,    '- In titleStyle, prefer explicit px sizes (`text-[32px]` or `style="font-size:32px"`) over default Tailwind text-lg/text-xl/text-2xl when the canvas is taller than 900px, because those classes stay at 18/20/24px regardless of canvas and will be too small here.',
    '',
    'Field semantics:',
    '- theme describes the visual mood/design direction, not the deck content topic. Do not repeat the topic, title, year, or industry name.',
    '- background, palette, titleStyle, chartStyle, and shapeLanguage must be derived from the style specification.',
    '- layoutMotif must combine the style specification with the exact target canvas above.',
    fontInstruction,
    '- The design contract should keep the deck visually coherent while allowing slide-level variation in composition, density, and emphasis.',
    '- Avoid over-prescribing exact placements, repeated templates, or one layout that every page must copy.',
    '- Keep fields concrete and actionable, but phrase them as ranges, tendencies, and reusable tokens when the source style allows flexibility.',
    '',
    `languageHint: ${args.languageHint || 'unknown'}`,
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
