import { formatLayoutIntentPrompt } from '@shared/layout-intent'
import type { DesignContract, PageReferenceContext } from '@shared/generation'
import { DATA_ANIM_SUPPORTED_TYPES } from '@shared/element-animation'
import type { SessionDeckGenerationContext } from '../../agent/types'
import { requireSlideSize, type SlideSizePreset } from '@shared/slide-size'
import {
  buildCanvasScenarioContentRules,
  buildCanvasScenarioDeliveryGuard,
  buildCanvasScenarioExpansionRules
} from './canvas-scenario'
import {
  CHART_SKILL_NAME,
  DATA_ANIM_SKILL_NAME,
  LAYOUT_SKILL_NAME,
  RED_LAYOUT_SKILL_NAME,
  SOURCE_READING_SKILL_NAME,
  SQUARE_1_1_LAYOUT_SKILL_NAME,
  STANDARD_4_3_LAYOUT_SKILL_NAME,
  VERTICAL_3_4_LAYOUT_SKILL_NAME,
  VERTICAL_9_16_LAYOUT_SKILL_NAME,
  formatSkillUsageRequirement,
  resolveLayoutSkillName,
  type RequiredProductSkillName
} from '../../../product-skills/contract'

function describeLayoutSkill(skillName: RequiredProductSkillName): string {
  if (skillName === LAYOUT_SKILL_NAME) return '16:9 PPT layout'
  if (skillName === VERTICAL_9_16_LAYOUT_SKILL_NAME) return '9:16 vertical layout'
  if (skillName === STANDARD_4_3_LAYOUT_SKILL_NAME) return '4:3 standard layout'
  if (skillName === SQUARE_1_1_LAYOUT_SKILL_NAME) return '1:1 square card layout'
  if (skillName === VERTICAL_3_4_LAYOUT_SKILL_NAME) return '3:4 vertical poster layout'
  if (skillName === RED_LAYOUT_SKILL_NAME) return '小红书图文笔记 layout'
  return '非 16:9 画布 layout'
}

export function buildPageSemanticStructure(input: SlideSizePreset): string {
  const layoutSkillName = resolveLayoutSkillName(input)
  return [
    '## 页面语义结构',
    `- The layout source of truth for this canvas is the ${describeLayoutSkill(layoutSkillName)} skill ${layoutSkillName}. Before creating a slide, choosing a composition, or repairing overflow/collision: ${formatSkillUsageRequirement(layoutSkillName)}`,
    '- 写每页 HTML 前，先像设计师想三件事：① 这页的**焦点**是什么（观众先看哪）？② 其余元素怎么摆才**平衡**（视觉重量不偏一边、不堆一角）？③ 每处留白是**刻意的 framing 还是不小心的空缺**——不小心的空缺就重排。想清楚再写。',
    '- If the task is a tiny text/style edit that does not affect layout, do not read the full layout reference.',
    '- 直接输出完整创意页面片段；系统会自动包裹 section[data-page-scaffold]、main[data-role="content"] 和标准 page frame。',
    '- 如果页面有明确标题，可以给第一个标题元素添加 data-role="title"；没有传统标题时不要为了校验硬造标题。',
    '- 主动添加 data-block-id 时保持页面内唯一（kebab-case：metric-1、summary、chart-main）；未添加时系统会自动补齐。'
  ].join('\n')
}

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
  'specific facts, metrics, dates, system names, status claims, examples, risks, decisions, or conclusions'

export const SOURCE_MATERIAL_PLANNING_RULES = [
  '## Source-grounded planning rules',
  '- Apply these rules only when source documents, parsed reference-document outlines, or source-material briefs are present.',
  '- Treat source materials as the primary content authority. Stay source-grounded and avoid creative drift.',
  `- Every source-backed slide title and key point must be traceable to the user requirements or source materials. Do not invent ${SOURCE_UNSUPPORTED_CLAIMS} not present in the source.`,
  '- Preserve source order, hierarchy, terminology, and stated conclusions unless the user explicitly asks for a different structure.',
  '- Dense source tables/lists are evidence, not a slide checklist. Plan them as focused PPT pages: one main message per page, grouped support, and a clear reading path; split into multiple slides when one page would become a data dump.',
  '- If the source material does not naturally fill the target slide count, split source-backed sections into finer-grained slides and deepen each slide from the available material: background/context already implied by the source, comparison dimensions, cause/effect, mechanism, implications, "so what", evidence groupings, or visual explanation modules.',
  '- Do not add generic agenda, data overview, synthesis, next steps, outlook, background, summary, or transition slides unless the user request or source material explicitly contains them.'
].join('\n')

export const SOURCE_DOCUMENT_LOCATE_THEN_READ_RULE = [
  `- Before using source documents: ${formatSkillUsageRequirement(SOURCE_READING_SKILL_NAME)}`,
  '- No retrieved snippets matched. Locate relevant source passages before writing; do not write the slide from the outline alone. Then expand thin pages with analysis derived from the source — grounding forbids invented facts, not analytical structure.'
].join('\n')

export const SOURCE_DOCUMENT_READ_STRATEGY = [
  `- Before using source documents: ${formatSkillUsageRequirement(SOURCE_READING_SKILL_NAME)}`,
  '- Treat retrieved snippets as an index into the source, not as final evidence. Grounding forbids inventing facts the source lacks — not the analytical expansion (comparison, implications, so-what) that fills a thin page from inspected material.'
].join('\n')

export const SOURCE_DOCUMENT_FACT_RULE = [
  `- Do not invent ${SOURCE_UNSUPPORTED_CLAIMS} not present in the source document.`
].join('\n')

export const SOURCE_GROUNDED_EXPANSION_RULES = [
  '- When source documents are present, expansion must be source-grounded: use the inspected material as the authority for enrichment and summarization.',
  '- First judge whether the inspected reference material is already enough for a readable slide. If it is enough, do not enrich or add support modules; edit, group, and choose the clearest PPT expression.',
  '- If the reference material for a slide is truly thin, you should actively enrich the slide from the material instead of leaving it sparse.',
  '- Expand by adding source-grounded analysis structure: context implied by the source, comparison dimensions, cause/effect, mechanism, implications, "so what", evidence grouping, annotations, or concise explanatory modules.',
  '- If the inspected source material is already dense, source-grounded does not mean exhaustive: summarize, group, and choose the clearest PPT expression instead of reproducing every row, metric, or bullet as visible modules.',
  '- This is expansion of reasoning and presentation structure, not invention of new evidence: do not fabricate unsupported exact facts, metrics, dates, cases, quotes, source names, risks, decisions, or conclusions.'
].join('\n')

export const buildReferenceRangeContentBoundaryRules = (
  referenceDocumentPath: string,
  pageReferenceContext?: PageReferenceContext,
  options?: { sourceReadRequired?: 'always' | 'when-content-changes' }
): string =>
  [
    '## Reference Range Content Boundary (required)',
    `- Reference Markdown: ${referenceDocumentPath}.`,
    options?.sourceReadRequired === 'when-content-changes'
      ? `- For a pure visual edit, do not read the source. If the edit changes wording or facts: ${formatSkillUsageRequirement(SOURCE_READING_SKILL_NAME)}, then read the raw Markdown source heading and range before writing.`
      : `- Before writing: ${formatSkillUsageRequirement(SOURCE_READING_SKILL_NAME)}`,
    options?.sourceReadRequired === 'when-content-changes'
      ? ''
      : '- Retrieved snippets are navigation only. Read the raw Markdown source heading and range before writing.',
    pageReferenceContext
      ? `- Page source heading: ${pageReferenceContext.sourceHeading}\n- Page source range: lines ${pageReferenceContext.sourceRange.lineStart}-${pageReferenceContext.sourceRange.lineEnd}.`
      : '- When no page range is available, use the relevant source heading as the content boundary and do not assume the whole document is available.',
    '- The selected Source range is the only factual and content boundary for this page. Do not take specific material from outside that range or from another uploaded document.',
    '- For cross-page context, use grep to locate related headings, terms, or neighboring passages, then read only the targeted sections you need; do not read the whole reference document merely for context.',
    '- Other ranges may inform narrative continuity, terminology, and transition design, but they are context only. Facts rendered or rewritten on this page must remain grounded in its selected Source range.',
    '- You may rephrase for presentation, summarize repetition, break or combine sentences, reorder the visual layout, and convert source lists into timelines, process diagrams, matrices, charts, metric cards, or relationship maps.',
    '- You may create neutral structural headings, labels, chart titles, and directly source-derived headings needed to organize the page. Expression may change; factual relationships must not.',
    '- Preserve the source meaning when summarizing or reorganizing, especially numbers, dates, proper nouns, qualifiers, conditions, comparison objects, uncertainty, causal relations, conclusion strength, and necessary discrete list items. Do not treat every source sentence as an equal-weight visible module.',
    '- Do not introduce facts, numbers, dates, examples, quotes, sources, proper nouns, conditions, causal claims, or business conclusions from outside the selected range.',
    '- Do not turn uncertain or conditional source language into a definite claim, strengthen a result, weaken a limitation, or drop a qualifier that changes the meaning.',
    '- A user instruction may override this boundary only when it explicitly identifies the source fact to replace and the replacement value. Generic requests for impact, polish, or expansion do not authorize new facts.',
    '- For dense content, group and visualize first. As a last layout measure, scale only a bounded internal module with `transform: scale(...)` and compensate its layout. Never scale the page root, section/page shell, canvas, or `main[data-role="content"]`; never use clipping or hidden overflow to conceal rendered content.',
    pageReferenceContext?.isSectionAgenda
      ? pageReferenceContext.agendaItems?.length
        ? `- Section agenda page: the following Agenda items are the only permitted child-topic source: ${JSON.stringify(pageReferenceContext.agendaItems)}. Do not infer child topics from reason text or from the document body outside the recorded range.`
        : '- Legacy section agenda page without structured Agenda items: preserve the existing agenda behavior and do not infer additional child topics from the document body.'
      : ''
  ]
    .filter(Boolean)
    .join('\n')

export {
  buildCanvasScenarioContentRules,
  buildCanvasScenarioDeliveryGuard,
  buildCanvasScenarioExpansionRules
}

export const STABLE_HTML_FRAGMENT_PROTOCOL = [
  '## HTML 片段协议',
  '- 只输出正文片段（一个 `<div>` 根节点）；section[data-page-scaffold]、main[data-role="content"]、data-block-id、page frame 由工具自动补，不要手写。',
  '- 片段里不要出现 `<!doctype>/<html>/<head>/<body>`、`<script src=>`、CDN/远程资源，以及系统骨架类 .ppt-page-root/.ppt-page-content/.ppt-page-fit-scope/data-ppt-guard-root（class、CSS、注释里都算）。',
  '- 结构扁平：用 Tailwind 类替代多层 wrapper，目标 3 层、不超 4 层。',
  '- 标签全部成对闭合、末尾完整——这是最常见的失败，写完自检每个 <div>/<section>/<ul>/<li>/<table>。'
].join('\n')

export function buildCanvasConstraints(
  input: SlideSizePreset,
  options?: { referenceTextLocked?: boolean }
): string {
  const slideSize = requireSlideSize(input)
  const layoutSkillName = resolveLayoutSkillName(slideSize)
  const isPortrait = slideSize.height > slideSize.width
  const ratioGuidance =
    slideSize.id === 'xiaohongshu-note'
      ? `- 小红书画布按图文笔记组织：强化标题、视觉锚点与信息层级，优先上下模块栈和分段叙事；不要套用 16:9 PPT 骨架，必须使用 ${RED_LAYOUT_SKILL_NAME}。`
      : isPortrait
        ? `- 这是非 PPT 竖版画布：优先顶部标题 + 中部主体 + 底部结论的纵向叙事或上下模块栈，不要照搬横向三列；必须使用 ${layoutSkillName}。`
        : slideSize.id === 'square-1-1'
          ? `- 这是 1:1 方形画布：围绕中心焦点、四象限/上下两段/中心主体 + 周边支撑组织，避免套用宽屏 PPT 骨架；必须使用 ${layoutSkillName}。`
          : slideSize.id === 'standard-4-3'
            ? `- 这是非 16:9 的 4:3 画布：减少横向密集信息，图表和卡片按更方正的区域组织；不要套用 16:9 PPT skeleton，必须使用 ${layoutSkillName}。`
            : '- 这是横版画布：可以使用左右分栏、横向时间线和宽表格，但仍需围绕单一视觉焦点。'

  const densityRule = options?.referenceTextLocked
    ? '- Reference Range Content Boundary applies. If the source is dense, first clarify hierarchy, group related material, and choose a compact visualization; then reduce decoration and internal padding while preserving actual nonzero gaps between independent modules. Only as a last measure, scale a bounded internal content group, card, chart, or visual module with `transform: scale(...)`, an explicit transform origin, and layout compensation. Never scale the page root, section/page shell, `main[data-role="content"]`, canvas, or their wrapper.'
    : '- 密度由内容决定：氛围/叙事页低密度，多数页中密度，表格/多指标对比才高密度；内容过密先压缩、归并、换表达，仍放不下时才缩放承载内容的局部模块并补偿其 grid/flex 占位。'
  const overflowRule = options?.referenceTextLocked
    ? '- Reference-bound content must remain fully inside the logical canvas. Preserve source meaning while restructuring; if it still does not fit, scale only a bounded internal module as a last measure. Never scale the page root, section/page shell, `main[data-role="content"]`, canvas, or their wrapper, and never hide overflow to conceal content.'
    : `- 所有可见内容必须落在 ${slideSize.width}×${slideSize.height}px 逻辑画布内；放不下先重组结构，再对承载过密内容的局部模块做缩放并补偿占位，不能靠裁切或 hidden overflow 遮住。`
  const fontRule =
    '- 字号：默认正文、普通标签和卡片说明不小于 18px；标题至少 24px，按层级和版面需要自由放大，不设上限。只有确属高密度且内部重组后仍放不下的局部模块，才可标记 `data-ppt-density="high"`，将其中正文/普通标签降至 16px，并配合模块缩放与布局占位补偿；注释、页脚、页码、来源/出处等辅助信息可以小于 18px，但不得小于 12px。'

  return [
    `## 画布与技法（${slideSize.label} / ${slideSize.width}×${slideSize.height}）`,
    `- 版式细节（密度、pattern、高度预算、防重叠）在 ${describeLayoutSkill(layoutSkillName)} skill ${layoutSkillName}，写前先读：${formatSkillUsageRequirement(layoutSkillName)}`,
    `- 根容器不带默认 padding，用 Tailwind grid/flex；背景可铺满 ${slideSize.width}×${slideSize.height}，正文四边留 24-40px。`,
    `- 已有内容在画布上占稳、对齐、按构图需要合理伸展，让版面协调——目标是平衡，不是把每寸塞满。对应逻辑画布宽 ${slideSize.width}px、高 ${slideSize.height}px；不为填满而新增卡片/注释/第二行模块，也不能溢出画布。`,
    ratioGuidance,
    densityRule,
    overflowRule,
    '- 图表高度：注释里写 `@ppt-chart-height=N`，且 N 与 class 的 `h-[Npx]` 一致（写 560 就配 h-[560px]）。',
    fontRule,
    '- 用 grid/flex 解决结构，不用 100vw/100vh/w-screen/h-screen/iframe。'
  ].join('\n')
}

export function buildLayoutCollisionRules(input: SlideSizePreset): string {
  const layoutSkillName = resolveLayoutSkillName(input)
  return [
    '## 布局防重叠',
    `- Full collision guide for this canvas is in the ${describeLayoutSkill(layoutSkillName)} skill ${layoutSkillName}. ${formatSkillUsageRequirement(layoutSkillName)}`,
    '- 标题、章节栏、正文、卡片、图表、流程节点、页眉页脚必须各占自己的 grid/flex 区域，不能互相重叠、层叠或越出画布；正文结构不要用 absolute/fixed。',
    '- 图片、视频可作为背景，文字或透明内容面板可有意叠在媒体上；媒体本身仍必须完整位于画布内。其他 absolute/fixed 仅用于背景装饰和连接线。'
  ].join('\n')
}

export const FRONTEND_CAPABILITIES = [
  '## Runtime capability contract',
  'Available in every /<pageId>.html:',
  '- Tailwind CSS, anime.js, Chart.js, ppt-runtime.js, and KaTeX are already loaded from local assets.',
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
  '- Prefer `data-anim-stagger="N"` over embedding `stagger(N)` in delay strings for new content.',
  '- Prefer `data-anim-sequence="with|after"` over overloading `data-anim-trigger` when you only need load-order composition.',
  '- Use `data-anim-click-group="name"` only for contiguous click-triggered elements that should reveal on the same click step.',
  '- Prefer bounded emphasis labels such as `pulse-soft|pulse|pulse-strong` and `grow-shrink-soft|grow-shrink|grow-shrink-strong` over ad hoc scale choreography.',
  `- For data-anim, use only these exact public values: ${DATA_ANIM_SUPPORTED_TYPES.join('|')}. Never use CSS-style aliases such as fade-in, fade-in-up, fade-in-down, fade-in-left, or fade-in-right.`,
  '- Use `data-anim="path"` only with an inline linear path string such as `M 0 0 L 120 30`; do not use selector-based SVG path choreography in normal generated pages.',
  '- Do not use `data-anim-easing`, `data-anim-repeat`, or `data-anim-direction` in normal generated pages; those are runtime-only compatibility knobs and are not preserved by the editable PPTX lane.',
  '- Keep the editable lane focused on whole-element motion. Do not use split-text/per-letter effects, SVG morph/draw helpers, or arbitrary path choreography in normal generated pages.',
  '- Treat those richer anime capabilities as preview-only concepts until a dedicated non-editable lane exists.',
  '',
  'Validation:',
  '- Use \\( \\) or $$ $$ for math; do not use single-dollar inline math.'
].join('\n')

export const buildContentWritingRules = (options?: { referenceTextLocked?: boolean }): string =>
  [
    '## 内容与视觉',
    '- 用真实文案与数据填模块；少用 emoji/贴纸装饰。',
    '- 布局靠 grid/flex 文档流：items-center/justify-* 的父节点配 flex 或 grid，正文结构各占自己的区域；图片、视频可作为背景或有意的媒体叠层，其他正文不要用 absolute/fixed。',
    '- 装饰块保持扁平（单层绝对定位 div / 几个并列 div / 一个 SVG）。',
    '- 模块占稳各自位置、彼此对齐，形成均衡版面与干净间距——不堆在顶部，也不塞到溢出。',
    options?.referenceTextLocked
      ? '- Reference Range Content Boundary applies: preserve source facts, qualifiers, relationships, and uncertainty while allowing presentation rephrasing, grouping, and visualization. When dense, first clarify hierarchy, group related material, and use a compact internal layout; scale a bounded internal content module with `transform: scale(...)` plus layout compensation only as a final measure. Never scale the page root, section/page shell, `main[data-role="content"]`, or canvas.'
      : '- 内容超载时按这个优先级解决：(1) 总结精简——用更少的字表达同等信息量（长描述压成短句、词组、单一数据点），不丢信息只去水分 → (2) 合并/归并相关点为一个带共享标签的块 → (3) 把长清单重写成一个 hero 指标 + 一句解释 → (4) 换更紧凑的 pattern（如对比矩阵/ranking/2x2）→ (5) 仍放不下时，仅对承载过密内容的 `data-ppt-density="high"` 内部模块使用缩放并补偿布局。不能重叠、越出画布或用 hidden overflow 遮挡内容。'
  ].join('\n')

export const CONTENT_WRITING_RULES = buildContentWritingRules()

export const STYLE_FIDELITY_RULES = [
  '## 尺寸布局与风格合成闸门',
  '- 当前画布尺寸与已注入的 layout skill/catalog 是页面结构的唯一来源：由它们决定阅读路径、分区、列数、密度和空间预算。',
  '- 当前风格规则是视觉语言的唯一来源：颜色、字体气质、圆角/线条/阴影、背景、装饰符号、图表质感都必须从当前 style 与 design contract 派生。',
  '- 先依据 layout skill/catalog 选择适合当前尺寸的页面结构，再把 style 的视觉语言应用到这些结构区域；layout 不提供新的审美，style 不替代尺寸结构。',
  '- style 中出现的左右分栏、固定列数、横向色带或固定位置只表达视觉构图倾向；必须在当前尺寸与 layout pattern 中重新表达，不能直接作为页面骨架。',
  '- size-aware layoutMotif 负责连接当前尺寸与 style 的构图气质，但不能覆盖当前画布尺寸或 layout skill/catalog。',
  '- 单页生成也必须像整套 deck 一样遵守当前 style。可以变化构图和节奏，但不能自创无关配色、组件语言、插画/装饰风格或字体气质。',
  '- 写入前做一次 style check：如果把当前 style 名字遮住，页面仍应能从配色、形状、字体和装饰语言上看出属于同一套演示。'
].join('\n')

export function resolveContextStylePrompt(context: SessionDeckGenerationContext): {
  presetLabel: string
  presetId: string
  stylePrompt: string
} {
  const presetLabel =
    context.styleName?.trim() || context.styleKey?.trim() || context.styleId || 'Session style'
  const presetId = context.styleKey?.trim() || context.styleId || 'session-style'
  const stylePrompt = context.styleSkillPrompt?.trim()
  if (!stylePrompt) {
    throw new Error('Session style snapshot is missing styleSkillPrompt.')
  }
  return {
    presetLabel,
    presetId,
    stylePrompt
  }
}

export function buildOutlinePageList(context: SessionDeckGenerationContext): string {
  return context.outlineItems
    .map((item, i) => {
      const layoutIntent = item.layoutIntent
        ? `\n   ${formatLayoutIntentPrompt(item.layoutIntent).replace(/\n/g, '\n   ')}`
        : ''
      const layoutMaster =
        item.layoutId && item.layoutPrompt
          ? `\n   ${item.layoutPrompt.replace(/\n/g, '\n   ')}`
          : ''
      return `${i + 1}. ${item.title}\n   Content points: ${item.contentOutline}${layoutIntent}${layoutMaster}`
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
    `- Size-adapted composition motif: ${contract.layoutMotif}`,
    '- Apply this motif within the current canvas layout rules. Keep pages varied within the motif instead of repeating one template.',
    `- Chart style: ${contract.chartStyle}`,
    `- Shape language: ${contract.shapeLanguage}`
  ]
  lines.push(
    `- Title font: ${contract.titleFont} (use var(--ppt-title-font) for titles)`,
    `- Body font: ${contract.bodyFont} (use var(--ppt-body-font) for body)`
  )
  return lines.join('\n')
}
