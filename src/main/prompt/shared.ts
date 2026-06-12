import { loadStyleSkill } from '../utils/style-skills'
import { formatLayoutIntentPrompt } from '@shared/layout-intent'
import {
  DATA_ANIM_DIRECTIONAL_EMPHASIS_TYPES,
  DATA_ANIM_EXPORT_STABLE_TYPES,
  DATA_ANIM_WEAKER_ROUNDTRIP_TYPES
} from '../animation/data-anim-schema'
import type { DesignContract, SessionDeckGenerationContext } from '../tools/types'
import {
  CHART_SKILL_NAME,
  DATA_ANIM_SKILL_NAME,
  LAYOUT_SKILL_NAME,
  SOURCE_READING_SKILL_NAME,
  formatSkillUsageRequirement,
} from '../skills/skill-contract'

export const PAGE_SEMANTIC_STRUCTURE = [
  '## 页面语义结构',
  `- The layout source of truth is the skill ${LAYOUT_SKILL_NAME}. Before creating a slide, choosing a composition, or repairing overflow/collision: ${formatSkillUsageRequirement(LAYOUT_SKILL_NAME)}`,
  '- If the task is a tiny text/style edit that does not affect layout, do not read the full layout reference.',
  '- 直接输出完整创意页面片段；系统会自动包裹 section[data-page-scaffold]、main[data-role="content"] 和标准 page frame。',
  '- 如果页面有明确标题，可以给第一个标题元素添加 data-role="title"；没有传统标题时不要为了校验硬造标题。',
  '- 主动添加 data-block-id 时保持页面内唯一（kebab-case：metric-1、summary、chart-main）；未添加时系统会自动补齐。'
].join('\n')

export const CONTENT_LANGUAGE_RULES = [
  '## Content language',
  '- The language of these instructions is not the output language. Do not imitate the prompt language.',
  '- If the user explicitly requests a language, use that language.',
  "- Otherwise, use the dominant language of the user's latest request and provided source materials.",
  '- If source materials are primarily English, write slide titles, body text, outlines, and user-facing summaries in English. Do not translate them into Chinese.',
  '- If source materials are primarily Chinese, write slide titles, body text, outlines, and user-facing summaries in Chinese.',
  '- For mixed-language materials, prefer the latest user instruction language.',
  '- Preserve proper nouns, brand names, technical terms, quoted source text, and metrics when appropriate.'
].join('\n')

export const SOURCE_UNSUPPORTED_CLAIMS =
  'exact facts, metrics, dates, system names, status claims, examples, risks, decisions, or conclusions'

export const SOURCE_MATERIAL_PLANNING_RULES = [
  '## Source-grounded planning rules',
  '- Apply these rules only when source documents, parsed reference-document outlines, or source-material briefs are present.',
  '- Treat source materials as the primary content authority. Stay source-grounded and avoid creative drift.',
  `- Every source-backed slide title and key point must be traceable to the user requirements or source materials. Do not invent ${SOURCE_UNSUPPORTED_CLAIMS} not present in the source.`,
  '- Preserve source order, hierarchy, terminology, and stated conclusions unless the user explicitly asks for a different structure.',
  '- If the source material does not naturally fill the target slide count, split source-backed sections into finer-grained slides. Do not add generic agenda, data overview, synthesis, next steps, outlook, background, summary, or transition slides unless the user request or source material explicitly contains them.'
].join('\n')

export const SOURCE_DOCUMENT_LOCATE_THEN_READ_RULE = [
  `- Before using source documents: ${formatSkillUsageRequirement(SOURCE_READING_SKILL_NAME)}`,
  '- No retrieved snippets matched. Locate relevant source passages before writing; do not freestyle from the outline.'
].join('\n')

export const SOURCE_DOCUMENT_READ_STRATEGY = [
  `- Before using source documents: ${formatSkillUsageRequirement(SOURCE_READING_SKILL_NAME)}`,
  '- Treat retrieved snippets as an index into the source, not as final evidence or permission to freestyle.'
].join('\n')

export const SOURCE_DOCUMENT_FACT_RULE = [
  `- Do not invent ${SOURCE_UNSUPPORTED_CLAIMS} not present in the source document.`
].join('\n')

export const STABLE_HTML_FRAGMENT_PROTOCOL = [
  '## Stable HTML fragment protocol',
  '- Submit only the creative body fragment. The tool will add section[data-page-scaffold], main[data-role="content"], data-block-id attributes, and the runtime page frame.',
  '- Do not include <!doctype>, <html>, <head>, <body>, section[data-page-scaffold], main[data-role="content"], .ppt-page-root, .ppt-page-content, .ppt-page-fit-scope, or data-ppt-guard-root.',
  '- Use one outer <div> as the fragment root.',
  '- Prefer a shallow grid/flex structure with direct module children.',
  '- Avoid nested cards and wrapper chains. Aim for 3 levels of nesting and avoid exceeding 4.',
  '- If the page needs many ideas, choose the layout by content density and reading path before adding more containers.',
  '- Decorative blocks should stay flat: a single absolute-positioned div, a few sibling decorative divs, or one SVG are all acceptable; avoid nested wrapper chains inside decoration.',
  '- Before calling the write tool, check that every opened div/span/ul/li/p/table-related tag is closed and the fragment ends with a complete closing tag.'
].join('\n')

export const CANVAS_CONSTRAINTS = [
  '## 画布约束',
  `- Layout details (density, archetype, height budget) are in the skill ${LAYOUT_SKILL_NAME}. ${formatSkillUsageRequirement(LAYOUT_SKILL_NAME)}`,
  '- 16:9 画布 1600×900，页面根容器不带默认 padding。用 Tailwind grid/flex。',
  '- 背景可以铺满 1600×900；正文布局必须按安全内容预算排版，保留 24-40px 余量。不要因为根容器无 padding 就把正文塞满全高。',
  '- 高度估算按偏保守值：中文标题/卡片文字考虑换行；grid-cols-3 放 4-6 个卡片时按两行预算。',
  '- 先判断内容密度再设计布局：低密度强调留白和视觉重心，中密度用主次分区，高密度才使用紧凑网格/表格/信息轨；不要机械套固定布局。',
  '- 最小字号 16px（text-base）。text-xs/text-sm/text-[12px]/text-[13px]/text-[14px]/text-[15px] 一律不用。空间紧张时调整密度和版式层级，不靠小字硬塞。',
  '- h1 最大 text-5xl（48px）。text-6xl/7xl/8xl、vw/vh、text-[clamp(...)] 不用。',
  '- 禁止 w-[1600px]/h-[900px]/100vw/100vh/w-screen/h-screen。禁止 iframe。'
].join('\n')

export const LAYOUT_COLLISION_RULES = [
  '## 布局防重叠',
  `- Full collision guide is in the skill ${LAYOUT_SKILL_NAME}. ${formatSkillUsageRequirement(LAYOUT_SKILL_NAME)}`,
  '- 正文内容用 grid/flex 正常文档流。absolute/fixed 仅用于背景装饰、连接线。正文卡片不得用 absolute/fixed。'
].join('\n')

export const FRONTEND_CAPABILITIES = [
  '## Runtime capability contract',
  'Available in every /<pageId>.html:',
  '- Tailwind CSS, Chart.js, ppt-runtime.js, and KaTeX are already loaded from local assets. GSAP is loaded only as the internal animation engine behind PPT.*.',
  '- Do not add CDN links, remote scripts, duplicate runtime tags, or iframe content.',
  '',
  'Fonts:',
  '- Use var(--ppt-title-font) for titles and var(--ppt-body-font) for body text.',
  '- Do not declare @font-face or import external font/icon libraries.',
  '',
  'Charts:',
  `- Chart details are in the skill ${CHART_SKILL_NAME}. ${formatSkillUsageRequirement(CHART_SKILL_NAME)}`,
  '- Wrap in document.addEventListener("DOMContentLoaded", function() { PPT.createChart(...) }). Do not use ppt-ready/ppt-rendered or other custom events.',
  '',
  'Animations:',
  `- Animation rules are in the skill ${DATA_ANIM_SKILL_NAME}. ${formatSkillUsageRequirement(DATA_ANIM_SKILL_NAME)}`,
  '- Use data-anim by default. For scripted motion, use PPT.animate(...) or PPT.createTimeline(...) only when preview choreography matters more than editable PPTX roundtrip. Do not call gsap.* or access window.gsap/globalThis.gsap directly.',
  '- Treat PPT.animate(...) and PPT.createTimeline(...) as preview-first escape hatches. Stable editable PPTX roundtrip is guaranteed only for data-anim-authored motion.',
  `- Prefer export-stable animation types by default: ${DATA_ANIM_EXPORT_STABLE_TYPES.join(', ')}.`,
  `- Use ${DATA_ANIM_DIRECTIONAL_EMPHASIS_TYPES.join(', ')} only when directional emphasis matters.`,
  `- Use weaker-roundtrip types (${DATA_ANIM_WEAKER_ROUNDTRIP_TYPES.join(', ')}) only when the user explicitly wants that trade-off or when exact PPTX roundtrip labels are not important.`,
  '',
  'Validation:',
  '- Use \\( \\) or $$ $$ for math; do not use single-dollar inline math.'
].join('\n')

export const CONTENT_WRITING_RULES = [
  '## 内容写入规则',
  '- 只输出页面片段（不是完整 HTML）。工具自动包裹 page frame、补 data-block-id。',
  '- 禁止 <!doctype>/<html>/<head>/<body>/<meta>/<title>/<link>/<script src=...>。',
  '- 禁止系统骨架标识：.ppt-page-root / .ppt-page-fit-scope / .ppt-page-content / data-ppt-guard-root（class、CSS、script、注释里都不能出现）。',
  '- 所有标签必须成对闭合；items-center/justify-* 的父节点必须有 flex 或 grid。',
  '- ⚠️ 标签闭合是最常见的失败原因。写入前必须自检：每个 <div>/<section> 都有对应的 </div></section>，末尾无未闭合标签。',
  '- 控制嵌套层级：目标 3 层左右，避免超过 4 层。嵌套越深越容易漏闭合标签。',
  '- 片段最外层优先只用一个 <div> 根节点；不要主动输出 section[data-page-scaffold] 或 main[data-role="content"]，工具会自动包裹。',
  '- 精简 HTML 结构：用 Tailwind 类替代多层 wrapper div。能用 1 个 div 解决的不要用 3 个。',
  '- 装饰块保持扁平：单个绝对定位 div、少量并列装饰 div、或单个 SVG 都可以；避免装饰块内部继续套多层 wrapper。',
  '- 默认禁止 emoji/贴纸装饰；单区最多 3 列；留白优先，不要塞满。'
].join('\n')

export function resolveStylePrompt(styleId: string | null | undefined): {
  presetLabel: string
  presetId: string
  stylePrompt: string
} {
  const { preset, prompt } = loadStyleSkill(styleId)
  return {
    presetLabel: preset.label,
    presetId: preset.id,
    stylePrompt: prompt
  }
}

export function buildOutlinePageList(context: SessionDeckGenerationContext): string {
  return context.outlineItems
    .map((item, i) => {
      const layoutIntent = item.layoutIntent
        ? `\n   ${formatLayoutIntentPrompt(item.layoutIntent).replace(/\n/g, '\n   ')}`
        : ''
      return `${i + 1}. ${item.title}\n   Content points: ${item.contentOutline}${layoutIntent}`
    })
    .join('\n')
}

export function formatDesignContract(contract?: DesignContract): string {
  if (!contract) return 'Not provided. Keep pages visually consistent according to the style rules.'
  const lines = [
    '- Treat this as a flexible visual contract, not a fixed template. Preserve coherence while varying composition, density, and emphasis per slide.',
    `- Visual theme: ${contract.theme}`,
    `- Canvas background: ${contract.background}`,
    `- Palette: ${contract.palette.join(', ')}`,
    `- Title style: ${contract.titleStyle}`,
    `- Layout motif: ${contract.layoutMotif}`,
    '- Use the layout motif as the deck-level layout language. Keep pages varied within this motif instead of repeating one template.',
    `- Chart style: ${contract.chartStyle}`,
    `- Shape language: ${contract.shapeLanguage}`
  ]
  lines.push(
    `- Title font: ${contract.titleFont} (use var(--ppt-title-font) for titles)`,
    `- Body font: ${contract.bodyFont} (use var(--ppt-body-font) for body)`
  )
  return lines.join('\n')
}
