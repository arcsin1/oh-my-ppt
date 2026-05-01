import { loadStyleSkill } from "../utils/style-skills";
import { formatLayoutIntentPrompt } from "@shared/layout-intent";
import type { DesignContract, SessionDeckGenerationContext } from "../tools/types";

export const PAGE_SEMANTIC_STRUCTURE = [
  "## 页面语义结构（必须）",
  "- 每页内容根节点使用 <section data-page-scaffold=\"1\">。",
  "- section 内只需要一个 <main data-block-id=\"content\" data-role=\"content\"> 作为整体内容入口。",
  "- 标题放在 content 内，并标记 data-role=\"title\"。",
  "- data-role=\"title\" 只表示语义标题，不表示固定 header；不要把它默认放在页面最顶部",
  "- content 内主要可编辑子块需要唯一 data-block-id 和语义 class。",
  "",
  "布局决策：",
  "- 先判断本页叙事重心：数据展示、概念解释、信息对比、流程时间线、结论收束、封面/章节页。",
  "- 标题是阅读路径的一部分，不是固定装饰头部；它应该出现在最能引导阅读的位置。",
  "- 数据页可以让图表/指标成为主视觉，标题靠边或与关键数字组合。",
  "- 对比页优先考虑分区结构，标题服务于对比关系。",
  "- 概念页可以使用中心主视觉、侧栏标题、图文交错或卡片组合。",
  "- 总结页和封面页可以让标题占据视觉重心。",
  "- 在同一套视觉语言下保持变化，不要机械重复同一标题位置和同一网格。",
  "",
  "标题可读性底线：",
  "- 竖排仅限 2-6 个中文字符的短标签。",
  "- 标题包含英文、数字、年份、中英混排或长句时必须横排。",
  "- 完整标题优先保证可读性，不要为了装饰牺牲阅读。",
  "- 不要默认预留 footer/meta；来源、注释、结论等信息若必须出现，应作为 content 内的普通子块呈现",
  "- content 内至少 2-4 个可编辑子块，每个子块都要有 data-block-id，例如：overview / metric-1 / list-1 / timeline-1",
  "- content 内所有主要可视元素都要有稳定唯一标识：可编辑子块必须有唯一 data-block-id，同时添加唯一语义 class（如 ppt-page-title / ppt-chart-main / ppt-metric-1）",
  "- 图表容器、图片、表格、关键文本块、按钮式标签等可被用户点选的元素，都应添加页面内唯一 class，便于检选、拖拽和局部编辑",
  "- 所有可编辑子块命名采用 kebab-case（如：metric-1、summary、chart-main）；不要再使用 data-block-id=\"title\" 作为固定骨架",
  "- 不要创建第二层 .ppt-page-content 包裹；不要输出孤立 closing tag",
].join("\n");

export const CONTENT_LANGUAGE_RULES = [
  "## Content language",
  "- The language of these instructions is not the output language. Do not imitate the prompt language.",
  "- If the user explicitly requests a language, use that language.",
  "- Otherwise, use the dominant language of the user's latest request and provided source materials.",
  "- If source materials are primarily English, write slide titles, body text, outlines, and user-facing summaries in English. Do not translate them into Chinese.",
  "- If source materials are primarily Chinese, write slide titles, body text, outlines, and user-facing summaries in Chinese.",
  "- For mixed-language materials, prefer the latest user instruction language.",
  "- Preserve proper nouns, brand names, technical terms, quoted source text, and metrics when appropriate.",
].join("\n");

export const CANVAS_CONSTRAINTS = [
  "## 画布约束（重要）",
  "- 页面固定按 16:9 比例（1600×900 像素）设计，系统会自动缩放适配视口。",
  "- 系统外层提供 p-2 padding，实际可用内容区约 1584×884；所有内容必须在此区域内完成。",
  "- 使用 Tailwind flex/grid 组织 content 内部布局；不要给根容器设置视口尺寸或锁死画布尺寸。",
  "- 禁止 w-[1600px] / h-[900px] / min-h-[900px] / w-screen / h-screen / min-h-screen / 100vw / 100vh 等画布锁定或视口相对布局。",
  "- 不要使用 text-[clamp(...)]、vw/vh 字体单位；字号使用固定层级。",
  "- 页面内部必须是真实 HTML 元素，禁止嵌套 iframe。",
  "- 页面样式写在各自 page 文件内，但写入片段中禁止引用系统骨架类；使用 section[data-page-scaffold=\"1\"] 或你自己定义的页面内语义 class。",
  "- 整套页面必须复用同一套背景体系、主色与字体，不要每页换一套皮肤。",
  "- 背景必须铺满画布：背景应定义在 section[data-page-scaffold=\"1\"] 层，不要只给局部卡片上色导致边缘露白。",
  "- 如果 section[data-page-scaffold=\"1\"] 承载背景或主布局，它应使用 h-full min-h-0 overflow-hidden，并保持与根背景同一色系。",
  "- 不要默认预留页脚/meta 区；来源、注释、结论等信息若必须出现，应作为 content 内的普通子块呈现。",
  "- 内容过长时必须精简文字、减少卡片、压缩图表高度或改紧凑布局；正文和关键数据必须留在正常布局流内。",
  "- h1 标题统一使用 text-5xl（48px），禁止使用 text-6xl / text-7xl / text-8xl。",
].join("\n");

export const FRONTEND_CAPABILITIES = [
  "## 前端能力（已内置）",
  "- 每个 page-x.html 已预注入本地脚本 ./assets/anime.v4.js、./assets/tailwindcss.v3.js、./assets/chart.v4.js、./assets/ppt-runtime.js，以及本地 KaTeX 资源。",
  "- 严禁使用 CDN：禁止输出任何 https:// / http:// / //cdn... 的 <script> 或 <link> 外链资源。",
  "- 严禁重复插入上述本地 script/link 标签，避免冲突与重复加载。",
  "- 可直接使用 Tailwind 类名组织布局与间距；必要时再补充少量页面内 <style>。",
  "- 动画统一使用 PPT Runtime：PPT.animate(targets, params)、PPT.createTimeline(...)、PPT.stagger(...)。",
  "- 禁止旧写法 anime({ targets, ... })、anime.timeline(...) 和 PPT.animate({ targets, ... })。",
  "- 图表统一使用 PPT.createChart(canvasOrSelector, config)；禁止直接 new Chart(...)。",
  "- 使用图表时必须使用真实 <canvas> 元素，并为每个图表创建专门的直接父容器作为 chart frame（如 <div class=\"relative h-[260px] w-full\"><canvas class=\"h-full w-full\"></canvas></div>）。",
  "- 图表高度必须写在 canvas 的直接父容器上；不要把 canvas 直接放进卡片/文本块里，不要只给祖先容器写 min-h，也不要只给 canvas 写 h-32 / h-full / flex-1。",
  "- 图表 labels、ticks、tooltip 中的数字必须先格式化，避免显示 JS 浮点误差。",
  "- 数学公式直接写 LaTeX 分隔符：行内用 \\( ... \\)，块级用 \\[ ... \\] 或 $$...$$；不要使用单 $...$，不要把公式做成图片。",
  "- 禁止默认隐藏态：不要使用 opacity-0 / invisible / style=\"opacity:0\" / style=\"visibility:hidden\"。",
  "- 页面初始态必须可读可见；动画只能做增强，不能依赖“先隐藏再显示”才能看到内容。",
  "- 动画是可选增强；如添加，仅对关键模块做轻量入场动画（opacity/translate/scale），单段 300-700ms，禁止无限循环和高频闪烁。",
].join("\n");

export const CONTENT_WRITING_RULES = [
  "## 内容写入规则（重要）",
  "- 严格输出页面片段，不是完整 HTML 文档，也不是系统页面骨架。工具会自动包裹标准 page frame。",
  "- 片段外层必须长这样：<section data-page-scaffold=\"1\" ...><main data-block-id=\"content\" data-role=\"content\" ...>...全部内容...</main></section>。",
  "- 调用写入工具前必须自检：section 开闭数量一致、main 开闭数量一致、HTML 末尾不能停在未闭合标签内。",
  "- The page-writing tool automatically wraps your content in the standard page frame. Pass only the page fragment.",
  "- 片段必须包含 section[data-page-scaffold] 和 main[data-block-id=\"content\"][data-role=\"content\"]；标题放在 content 内并标记 data-role=\"title\"。",
  "- 不要生成 <!doctype>、<html>、<head>、<body> 等完整文档结构。",
  "- 禁止输出 <meta>/<title>/<link> 这类 head 标签。",
  "- 禁止输出 <script src=...>；运行时脚本已由系统预注入。",
  "- 严禁出现系统骨架标识：.ppt-page-root / .ppt-page-fit-scope / .ppt-page-content / data-ppt-guard-root。不要把它们写在 class、CSS selector、script 字符串或注释里。",
  "- 每个标签必须成对闭合；所有 <div>、<p>、<span>、<section> 等必须有对应闭合标签。",
  "- 若内容过多，请主动精简，不要留下未完成结构或半截输出。",
  "- 出现 items-center / justify-* / content-* 时，父节点必须同时有 flex 或 grid。",
  "- 写入前先自检：无孤立 </div> / </main> / </section>，且不出现双重 .ppt-page-content 包裹。",
  "- 先在脑内完成整页结构后再一次性调用工具写入，避免分段写入导致截断。",
  "- 默认禁止 emoji/贴纸/玩具化装饰，除非用户明确要求。",
  "- 单个内容区最多 3 列；如果信息块超过 4 个，改为 2 列多行或主次分区布局。",
  "- 优先保证留白与可读性，不要把页面塞满；卡片和模块之间保持清晰间距。",
  "- 每页应包含足够的实际内容模块来支撑表达，不要只写一句话或一个数字。",
  "- 主要可视元素必须有稳定唯一 class；可编辑子块同时必须有唯一 data-block-id，便于后续检选、拖拽和局部编辑。",
  "- 写入工具会自动验证 HTML，验证失败须修正后重试。",
].join("\n");

export function resolveStylePrompt(
  styleId: string | null | undefined,
): { presetLabel: string; presetId: string; stylePrompt: string } {
  const { preset, prompt } = loadStyleSkill(styleId);
  return {
    presetLabel: preset.label,
    presetId: preset.id,
    stylePrompt: prompt,
  };
}

export function formatCurrentDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function buildOutlinePageList(context: SessionDeckGenerationContext): string {
  return context.outlineItems
    .map((item, i) => {
      const layoutIntent = item.layoutIntent
        ? `\n   ${formatLayoutIntentPrompt(item.layoutIntent).replace(/\n/g, "\n   ")}`
        : "";
      return `${i + 1}. ${item.title}\n   Content points: ${item.contentOutline}${layoutIntent}`;
    })
    .join("\n");
}

export function formatDesignContract(contract?: DesignContract): string {
  if (!contract) return "Not provided. Keep pages visually consistent according to the style rules.";
  return [
    `- Visual theme: ${contract.theme}`,
    `- Canvas background: ${contract.background}`,
    `- Palette: ${contract.palette.join(", ")}`,
    `- Title style: ${contract.titleStyle}`,
    `- Layout motif: ${contract.layoutMotif}`,
    "- Use the layout motif as the deck-level layout language. Keep pages varied within this motif instead of repeating one template.",
    `- Chart style: ${contract.chartStyle}`,
    `- Shape language: ${contract.shapeLanguage}`,
  ].join("\n");
}
