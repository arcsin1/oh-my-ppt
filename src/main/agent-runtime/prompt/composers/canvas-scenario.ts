// Canvas-dependent prompt vocabulary belongs with Runtime prompt composers.
import { requireSlideSize, type SlideSizePreset, type SlideSizePresetId } from '@shared/slide-size'

export type CanvasScenarioId =
  | 'presentation-wide'
  | 'presentation-standard'
  | 'square-card'
  | 'mobile-story'
  | 'poster-card'
  | 'social-note'

interface CanvasScenario {
  id: CanvasScenarioId
  label: string
  artifactName: string
  pageName: string
  sequenceName: string
  identity: string
  editIdentity: string
}

export function resolveCanvasScenario(input: SlideSizePreset): CanvasScenario {
  const slideSize = requireSlideSize(input)
  const scenarioIdByPreset: Record<SlideSizePresetId, CanvasScenarioId> = {
    'wide-16-9': 'presentation-wide',
    'standard-4-3': 'presentation-standard',
    'square-1-1': 'square-card',
    'vertical-9-16': 'mobile-story',
    'vertical-3-4': 'poster-card',
    'xiaohongshu-note': 'social-note'
  }

  const scenarioId = scenarioIdByPreset[slideSize.id]
  if (!scenarioId) {
    throw new Error(`No canvas scenario prompt configured for slide size: ${slideSize.id}`)
  }

  switch (scenarioId) {
    case 'presentation-wide':
      return {
        id: 'presentation-wide',
        label: '16:9 PPT 演示',
        artifactName: 'PPT presentation',
        pageName: 'slide',
        sequenceName: 'deck',
        identity:
          'You are a PPT generation expert responsible for turning a planned page outline into slide HTML content.',
        editIdentity: 'You are a PPT incremental editing expert focused on page-quality changes.'
      }
    case 'presentation-standard':
      return {
        id: 'presentation-standard',
        label: '4:3 传统演示',
        artifactName: '4:3 presentation',
        pageName: 'slide',
        sequenceName: 'deck',
        identity:
          'You are a 4:3 presentation generation expert responsible for turning a planned outline into readable slide HTML content.',
        editIdentity: 'You are a 4:3 presentation editing expert focused on page-quality changes.'
      }
    case 'mobile-story':
      return {
        id: 'mobile-story',
        label: '移动端竖屏内容',
        artifactName: 'vertical mobile story',
        pageName: 'screen',
        sequenceName: 'screen sequence',
        identity:
          'You are a vertical mobile story generation expert responsible for turning a planned outline into 9:16 screen HTML content.',
        editIdentity:
          'You are a vertical mobile story editing expert focused on screen-quality changes.'
      }
    case 'square-card':
      return {
        id: 'square-card',
        label: '1:1 方形内容卡',
        artifactName: 'square content card',
        pageName: 'card',
        sequenceName: 'card sequence',
        identity:
          'You are a square content-card generation expert responsible for turning a planned outline into 1:1 card HTML content.',
        editIdentity:
          'You are a square content-card editing expert focused on card-quality changes.'
      }
    case 'poster-card':
      return {
        id: 'poster-card',
        label: '竖版海报信息卡',
        artifactName: 'vertical poster card',
        pageName: 'card',
        sequenceName: 'card sequence',
        identity:
          'You are a vertical poster-card generation expert responsible for turning a planned outline into 3:4 information-card HTML content.',
        editIdentity:
          'You are a vertical poster-card editing expert focused on card-quality changes.'
      }
    case 'social-note':
      return {
        id: 'social-note',
        label: '小红书图文笔记',
        artifactName: 'Xiaohongshu note',
        pageName: 'note page',
        sequenceName: 'note sequence',
        identity:
          'You are a Xiaohongshu note generation expert responsible for turning a planned outline into collectible note-page HTML content.',
        editIdentity: 'You are a Xiaohongshu note editing expert focused on note-page quality.'
      }
  }
}

export function buildCanvasScenarioBrief(input: SlideSizePreset): string {
  const scenario = resolveCanvasScenario(input)
  return [
    '## Canvas scenario',
    `- Current scenario: ${scenario.label}.`,
    `- Treat each output as a ${scenario.pageName} in a ${scenario.sequenceName}, not as a generic 16:9 PPT unless this scenario explicitly says so.`,
    `- Product form: ${scenario.artifactName}.`
  ].join('\n')
}

export function buildCanvasScenarioContentRules(
  input: SlideSizePreset,
  options?: { referenceTextLocked?: boolean }
): string {
  const scenario = resolveCanvasScenario(input)
  if (options?.referenceTextLocked) {
    return [
      `## 场景内容组织：${scenario.label}`,
      '- Reference Range Content Boundary applies to this page. Preserve source facts, qualifiers, relationships, and uncertainty while allowing presentation rephrasing, grouping, and visualization.',
      '- Keep the source meaning in a clear reading order. Compact columns, tables, grids, labels, timelines, and visual hierarchy are allowed.',
      '- The reference boundary does not relax composition: independent cards, charts, tables, and callouts must retain an actual nonzero gap. When the source is brief, consider enlarging, extending, or rebalancing the existing fact-bearing modules instead of creating a shallow stack at the top or filler content.',
      '- When the source is dense, first clarify hierarchy, group related material, and choose a compact visualization; then reduce decoration and internal padding while preserving actual nonzero gaps between independent modules. Only as a last measure, scale a bounded internal content group, card, chart, or visual module with `transform: scale(...)` and layout compensation. Never scale the page root, section/page shell, `main[data-role="content"]`, or canvas.'
    ].join('\n')
  }
  const common = [
    '- **一个焦点**：这页让观众先看什么、记住哪一句？围绕唯一焦点组织，其余是它的支撑；靠大小 / 位置 / 颜色分出层级，不要所有模块等权平铺。',
    '- **模块间距**：独立内容模块之间必须保留实际的非零间距；紧凑可以，但不能相贴。',
    '- **过密先自我总结**：如果素材 / 当前页内容一眼看会超出当前画布或形成高密度信息墙，写 HTML 前先总结成一个主旨和少量支撑组；只把总结后的结构上屏。',
    '- **构图平衡**：元素的视觉重量（大 / 深 / 彩色 = 重，小 / 浅 = 轻）在画布上分布平衡，不偏一边、不堆一角。'
  ]

  if (scenario.id === 'presentation-wide') {
    return [
      '## 场景内容组织：16:9 PPT 演示',
      '- **3 秒主旨**：PPT 是演讲辅助，不是文档浏览。写页面前先定一句观众 3 秒内能抓住的话；标题、主图表、关键数字和结论都围绕这句话服务。',
      ...common,
      '- **低密度也要承重**：内容少时用低密度 hero / 大图表 / 时间线 / 结构图焦点承担页面，不把几个小模块停在顶部。',
      '- **量的多少不是问题，平衡才是**：内容多就先总结、分组、压缩，并保留模块间实际间距。'
    ].join('\n')
  }

  if (scenario.id === 'presentation-standard') {
    return [
      '## 场景内容组织：4:3 传统演示',
      '- **演示主旨优先**：4:3 仍是演示页，但横向空间更少。每页保留一个清楚观点，避免把 16:9 的宽屏三列直接压进方正画布。',
      ...common,
      '- **更方正的层级**：优先上下两段、中心主体 + 周边辅助、或 2×2 以内的信息结构；少用长横向时间线和宽表格。',
      '- **可投影可阅读**：标题、主视觉和结论必须远距离可读，辅助信息宁可合并为短标签，不做密集脚注墙。'
    ].join('\n')
  }

  if (scenario.id === 'mobile-story') {
    return [
      '## 场景内容组织：移动端竖屏',
      '- **首屏抓人**：页面开头应给出标题钩子、核心判断或强视觉锚点，让手机用户一眼知道为什么继续看。',
      '- **上下阅读路径**：按从上到下的叙事组织信息，优先标题钩子 → 主体解释 → 关键证据/步骤 → 底部结论，不要照搬横向三列。',
      '- **分屏节奏**：按内容组织成少量清楚的纵向段落或模块，每段只承担一个阅读动作；步骤或证据确实较多时可增加段落，但必须保持层级、阅读节奏和独立模块间的实际非零间距，不堆同级小卡片。',
      '- **移动端可读**：正文宁可少而清楚，不把表格、宽图表、长句密集塞进窄屏。'
    ].join('\n')
  }

  if (scenario.id === 'square-card') {
    return [
      '## 场景内容组织：1:1 方形内容卡',
      '- **中心焦点**：方形画布最怕平均摊开。先确定一个居中或略偏上的主视觉/主结论/关键数字，让用户一眼抓住重点。',
      '- **方形秩序**：优先中心主体 + 周边支撑、上下两段、2×2 信息块、环绕式解释或图文对半；不要照搬宽屏左右大分栏或长横向时间线。',
      '- **少而完整**：适合做概念卡、总结卡、对比卡、清单卡、社媒封面和单图知识卡；围绕标题、主体、与内容相称的支撑点和结论/来源组织，不把支撑点机械压成固定数量。',
      '- **四边平衡**：上下左右外边距都要稳定，避免内容只堆上半区或一侧，底部不能只是装饰空白。'
    ].join('\n')
  }

  if (scenario.id === 'poster-card') {
    return [
      '## 场景内容组织：竖版海报信息卡',
      '- **主视觉锚点**：先确定一个最大的信息或视觉锚点，可以是大标题、关键数字、产品/人物/概念图形或核心结论。',
      '- **少层级强秩序**：海报卡不是文档页。围绕标题、主视觉、与内容相称的支撑信息和结论/来源组织；信息较多时先建立分组和阅读顺序，不机械压成固定层数。',
      '- **信息卡阅读**：适合做清单、对比、步骤、概念解释和结论卡；不要做满屏段落或复杂宽表格。',
      '- **边界与间距**：四边外边距和模块间距必须稳定，不能因为竖版空间高就一路堆到底。'
    ].join('\n')
  }

  if (scenario.id === 'social-note') {
    return [
      '## 场景内容组织：小红书图文笔记',
      '- **标题钩子**：顶部必须有明确标题钩子或利益点，让用户知道这页值得停留、截图或收藏。',
      '- **收藏价值**：优先组织成可保存的清单、步骤、避坑、对比、模板、结论卡；不要做纯演讲页或宽屏 PPT 结构。',
      '- **图文分段**：用上下模块栈承载按内容分组的信息段，每段有清楚小标题或视觉锚点；避免横向三列和复杂表格。',
      '- **口吻清楚但不花哨**：可以更像笔记，但事实、指标、来源仍需严谨；不要为了平台感编造案例或结论。'
    ].join('\n')
  }

  throw new Error(`No content prompt configured for canvas scenario: ${scenario.id}`)
}

export function buildCanvasScenarioExpansionRules(
  input: SlideSizePreset,
  options?: { referenceTextLocked?: boolean }
): string {
  const scenario = resolveCanvasScenario(input)
  if (options?.referenceTextLocked) {
    return [
      `## Reference-preserving layout rules (${scenario.pageName})`,
      '- Do not introduce facts outside the selected range or change source relationships, qualifiers, uncertainty, or conclusion strength.',
      '- Use rephrasing, visual hierarchy, grouping, and compact internal patterns to fit the selected source content; use bounded internal-module scaling only as a final measure.',
      '- Internal scaling must not target the page root, section/page shell, `main[data-role="content"]`, or canvas.'
    ].join('\n')
  }
  const common = [
    '- **补结构 ≠ 编造事实**：内容少时，可以从现有标题 / 要点推导解释、影响、对比、机制、so-what 表达和视觉结构；禁止捏造源里没有的具体数字、日期、案例、引用、人名、来源或新结论。',
    '- **够了就压缩**：如果已有足够事实或结构，不要再新增同级模块；改为取舍、分组、压缩和换表达。',
    '- **收在当前画布内**：扩展后的可见内容必须适合当前画布，不靠任意缩小字号、堆同级卡片或塞满边角解决。'
  ]

  if (scenario.id === 'presentation-wide' || scenario.id === 'presentation-standard') {
    return [
      '## 内容丰富与优化规则（演示页）',
      '- 写 HTML 前判断：这一页是内容足够，只需取舍 / 分组 / 压缩；还是内容真的偏薄，需要补论证结构、解释关系或 so-what 表达。',
      ...common,
      '- 演示页的“够”是一个明确观点 + 与材料相称的支撑组 / 证据轨，而不是把素材逐条搬运成可见模块。',
      '- 不扩展时也不能小卡片堆顶部留空底：用低密度 hero / 大图表 / 时间线 / 结构图撑住页面。'
    ].join('\n')
  }

  if (scenario.id === 'mobile-story') {
    return [
      '## 内容丰富与优化规则（移动端竖屏）',
      '- 写 HTML 前判断：是否已经有清楚的首屏钩子、主体解释和底部结论；缺哪一段就补结构，不补无来源事实。',
      ...common,
      '- 竖屏的“够”是一条清楚连续的顺序阅读路径，而不是一堆平级卡片。',
      '- 内容多时优先拆成纵向分段和短句，不做宽表格或密集脚注墙。'
    ].join('\n')
  }

  if (scenario.id === 'poster-card') {
    return [
      '## 内容丰富与优化规则（竖版海报信息卡）',
      '- 写 HTML 前判断：是否已经有主视觉锚点、少量支撑信息和明确结论；缺的是结构感时补视觉层级，不补长段文字。',
      ...common,
      '- 海报卡的“够”是少量高辨识信息层级；已有足够关键点时应压缩表达，而不是继续扩写。',
      '- 内容少时放大核心信息和视觉锚点，内容多时合并为清单/对比/步骤，不做文档页。'
    ].join('\n')
  }

  if (scenario.id === 'square-card') {
    return [
      '## 内容丰富与优化规则（1:1 方形内容卡）',
      '- 写 HTML 前判断：是否已经有一个强焦点、少量支撑信息和可截图/可复述的结论；缺的是结构感时补视觉层级，不补长文档内容。',
      ...common,
      '- 方形卡的“够”是一个核心观点 + 与内容相称的支撑点；已有关键点时应强化焦点和分组，而不是继续扩写。',
      '- 内容多时压成 2×2、上下两段或中心主体 + 周边短标签；内容少时放大主结论和视觉锚点。'
    ].join('\n')
  }

  if (scenario.id === 'social-note') {
    return [
      '## 内容丰富与优化规则（小红书图文笔记）',
      '- 写 HTML 前判断：是否已经有标题钩子、可收藏要点和解释/步骤/避坑结构；缺结构就补笔记结构，不编造事实。',
      ...common,
      '- 小红书页的“够”是让用户能快速保存或复述：一组可扫读的短要点、步骤、对比或结论通常比长篇论证更有效。',
      '- 内容多时做“分组 + 小标题 + 重点标注”，内容少时强化标题利益点和一个可执行结论。'
    ].join('\n')
  }

  throw new Error(`No expansion prompt configured for canvas scenario: ${scenario.id}`)
}

export function buildCanvasScenarioDeliveryGuard(
  input: SlideSizePreset,
  options?: { referenceTextLocked?: boolean }
): string {
  const scenario = resolveCanvasScenario(input)
  if (options?.referenceTextLocked) {
    const referenceRules = [
      `## 交付前版面检查（${scenario.pageName}，Reference Range Content Boundary）`,
      '- Confirm that source facts, qualifiers, relationships, and uncertainty are preserved; neutral structural headings and presentation rephrasing are allowed.',
      '- Confirm the page preserves the source meaning, necessary discrete items, and material qualifiers: no clipping, truncation, hidden overflow, or meaning-changing omission.',
      '- If the page is dense, first adjust internal hierarchy, grouping, visualization, and internal padding while preserving actual nonzero gaps between independent modules; use bounded internal-module scale only as a final measure. The page root, section/page shell, `main[data-role="content"]`, and canvas must remain unscaled.'
    ]
    if (scenario.id === 'presentation-wide' || scenario.id === 'presentation-standard') {
      referenceRules.push(
        '- Preserve a coherent slide composition while respecting the source boundary: non-cover / non-quote / non-divider pages should have a load-bearing central or lower structure, unless a dominant media or typographic focal element already carries that visual weight. Do not leave an accidental empty lower band.',
        '- Independent modules must retain an actual nonzero gap. If a chart, evidence rail, or takeaway gets too close to the next card, rebalance their existing heights and positions rather than adding facts or reducing the gap.'
      )
    }
    return referenceRules.join('\n')
  }

  if (scenario.id === 'presentation-wide' || scenario.id === 'presentation-standard') {
    return [
      '## 交付前版面检查（演示页）',
      '- 形服务于魂：先确认页面有一个 3 秒可读的主旨，再检查这个主旨有没有对应的承重结构（大图表、hero 数字、矩阵、时间线、对比区或结论区）。',
      '- 非 cover / quote / divider / 纯氛围页，检查标题 + 主要模块是否只停在画布上半部，且中部/下部没有承重焦点而只剩 footer/source 或大片空底；出现这种未完成的构图时，重分配现有内容。媒体或大字主视觉本身已经承担视觉重量时，不必为了填空而增加模块。',
      '- 低密度页面也要有足够大的焦点承重；不要把几个小卡片、小图表排在顶部，却没有任何中部或下部承重结构。',
      '- 独立内容模块之间必须保留实际的非零间距；若空间不够，优先重分配现有模块的高度和位置，不要为了塞下内容压缩间距。',
      '- 视觉重心可以略高于几何中心，让投影/大屏观看更舒服；这不是把正文堆到上方。',
      '- 主图表只有 220–280px 时，先判断它是否只是辅助证据；如果它是主要证据且页面也没有其他主视觉承重，再考虑扩大主图区或改成更合适的结构。不要机械拉大本应保持紧凑的辅助图表。',
      '- 写入前做一次 mental bounding-box check：忽略背景装饰和 footer/source 后，主要内容应形成清楚的上/中/下或左/右结构。'
    ].join('\n')
  }

  if (scenario.id === 'mobile-story') {
    return [
      '## 交付前版面检查（移动端竖屏）',
      '- 首屏必须有吸引点：顶部区域不能只是小标题或空背景，应能看到标题钩子、核心判断或强视觉锚点。',
      '- 上下阅读路径必须连续：用户从上滑到下时，能按顺序读到主旨、解释、证据/步骤和结论。',
      '- 不要把横向三列、宽表格或大量并排卡片硬塞进窄屏；宽向信息必须转成纵向分组。',
      '- 底部不能只是空白或零散 footer；如果有结论，应在底部形成收束。'
    ].join('\n')
  }

  if (scenario.id === 'poster-card') {
    return [
      '## 交付前版面检查（竖版海报信息卡）',
      '- 一眼必须有主视觉锚点：最大标题、关键数字、图形或结论不能被一堆小模块淹没。',
      '- 层级不能过多：如果出现太多同级卡片、脚注、标签和小标题，先合并成更少的信息组。',
      '- 海报边界要稳：四边外边距、模块间距和底部收束都要稳定。',
      '- 不要让页面变成竖版文档：长段落、密集表格和满屏小字都是失败。'
    ].join('\n')
  }

  if (scenario.id === 'square-card') {
    return [
      '## 交付前版面检查（1:1 方形内容卡）',
      '- 一眼必须有中心焦点：最大标题、关键数字、概念图形或核心结论不能被平级小模块稀释。',
      '- 四边视觉重量要平衡：不要只占上半区、左侧或某个角落；外边距围绕主体保持稳定。',
      '- 不要套宽屏 PPT 骨架：避免长横向时间线、宽表格、三列 dashboard 和底部卡片排。',
      '- 内容应像一张完整卡片：标题、主体、支撑和收束都在方形画布内形成闭合。'
    ].join('\n')
  }

  if (scenario.id === 'social-note') {
    return [
      '## 交付前版面检查（小红书图文笔记）',
      '- 顶部标题钩子必须清楚：用户应能立刻知道这页解决什么问题、提供什么清单或给出什么结论。',
      '- 页面要有收藏价值：至少形成清单、步骤、对比、避坑、模板或关键结论中的一种，而不是普通演示页。',
      '- 上下模块节奏要像图文笔记：按内容组织可扫读段落，每段有小标题、重点标注或视觉锚点。',
      '- 不要套 16:9 PPT 骨架：避免宽屏分栏和普通演示结构。'
    ].join('\n')
  }

  throw new Error(`No delivery prompt configured for canvas scenario: ${scenario.id}`)
}
