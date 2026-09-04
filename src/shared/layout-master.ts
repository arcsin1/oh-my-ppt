import { LAYOUT_INTENTS, normalizeLayoutIntent, type LayoutIntent } from './layout-intent'

export const MASTER_LAYOUTS_FILENAME = 'layouts.json'
export const MASTER_LAYOUTS_RELATIVE_PATH = `master/${MASTER_LAYOUTS_FILENAME}`
export const MASTER_LAYOUTS_VERSION = 1 as const
export const LAYOUT_CONTRACT_VERSION = 1 as const

export const LAYOUT_MASTER_CATEGORIES = [
  'cover',
  'content',
  'comparison',
  'data',
  'narrative',
  'closing'
] as const

export type LayoutMasterCategory = (typeof LAYOUT_MASTER_CATEGORIES)[number]

export type LayoutSlotRole =
  | 'title'
  | 'subtitle'
  | 'body'
  | 'metric'
  | 'chart'
  | 'comparison'
  | 'timeline'
  | 'quote'
  | 'takeaway'
  | 'visual'
  | 'source'

export type LayoutImagePolicy = 'forbidden' | 'optional' | 'preferred'

export type LayoutSlot = {
  id: string
  role: LayoutSlotRole
  required: boolean
  maxItems?: number
  maxChars?: number
  priority: 'hero' | 'support' | 'auxiliary'
  image?: {
    policy: LayoutImagePolicy
    role: 'hero-image' | 'product-visual' | 'spot-illustration' | 'data-visual'
    layer: 'background' | 'visual'
    aspectHint?: string
  }
}

export type PageLayoutSource = {
  version: typeof LAYOUT_CONTRACT_VERSION
  layoutId: string
  layoutContractVersion: typeof LAYOUT_CONTRACT_VERSION
  layoutIntent: LayoutIntent
}

export type LayoutMasterTemplate = {
  id: string
  intent: LayoutIntent
  layoutContractVersion: typeof LAYOUT_CONTRACT_VERSION
  slots: LayoutSlot[]
  category: LayoutMasterCategory
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  preview:
    | 'title-center'
    | 'title-split'
    | 'editorial'
    | 'two-column'
    | 'metric-grid'
    | 'chart-side'
    | 'versus'
    | 'timeline'
    | 'process'
    | 'quote'
    | 'image-focus'
    | 'closing'
  prompt: string
}

type LayoutMasterTemplateDefinition = Omit<
  LayoutMasterTemplate,
  'layoutContractVersion' | 'slots'
>

export type SessionLayoutLibrary = {
  version: typeof MASTER_LAYOUTS_VERSION
  mappings: Record<LayoutIntent, string>
}

export type SessionLayoutLibraryStatus = {
  library: SessionLayoutLibrary
  exists: boolean
  revision: string
}

const createSlot = (
  id: string,
  role: LayoutSlotRole,
  required: boolean,
  priority: LayoutSlot['priority'],
  options?: Pick<LayoutSlot, 'maxItems' | 'maxChars' | 'image'>
): LayoutSlot => ({ id, role, required, priority, ...options })

const visualSlot = (
  id: string,
  required: boolean,
  priority: LayoutSlot['priority'],
  role: NonNullable<LayoutSlot['image']>['role'],
  policy: LayoutImagePolicy,
  aspectHint: string
): LayoutSlot =>
  createSlot(id, 'visual', required, priority, {
    image: { role, policy, layer: 'visual', aspectHint }
  })

const LAYOUT_MASTER_SLOTS: Record<string, LayoutSlot[]> = {
  'cover-statement': [
    createSlot('cover-title', 'title', true, 'hero', { maxChars: 80 }),
    createSlot('cover-subtitle', 'subtitle', false, 'support', { maxChars: 180 }),
    visualSlot('cover-visual', false, 'support', 'hero-image', 'preferred', '16:9')
  ],
  'cover-split': [
    createSlot('cover-title', 'title', true, 'hero', { maxChars: 80 }),
    createSlot('cover-context', 'subtitle', false, 'support', { maxChars: 180 }),
    visualSlot('cover-visual', false, 'hero', 'hero-image', 'preferred', '4:3')
  ],
  'cover-immersive': [
    createSlot('cover-title', 'title', true, 'hero', { maxChars: 80 }),
    createSlot('cover-context', 'subtitle', false, 'support', { maxChars: 180 }),
    visualSlot('cover-visual', false, 'hero', 'hero-image', 'preferred', '16:9')
  ],
  'content-editorial': [
    createSlot('editorial-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('editorial-body', 'body', true, 'support', { maxChars: 600 }),
    visualSlot('editorial-visual', false, 'support', 'spot-illustration', 'optional', '4:3')
  ],
  'content-two-column': [
    createSlot('two-column-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('primary-column', 'body', true, 'hero', { maxChars: 500 }),
    createSlot('supporting-column', 'body', true, 'support', { maxChars: 500 })
  ],
  'data-metrics': [
    createSlot('metric-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('key-metric', 'metric', true, 'hero', { maxChars: 96 }),
    createSlot('metric-evidence', 'body', false, 'support', { maxItems: 3 }),
    visualSlot('metric-visual', false, 'support', 'spot-illustration', 'preferred', '1:1')
  ],
  'data-chart-side': [
    createSlot('chart-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('primary-chart', 'chart', true, 'hero'),
    createSlot('chart-takeaway', 'takeaway', true, 'support', { maxChars: 240 })
  ],
  'data-annotated': [
    createSlot('chart-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('primary-chart', 'chart', true, 'hero'),
    createSlot('chart-takeaway', 'takeaway', true, 'support', { maxChars: 240 })
  ],
  'comparison-versus': [
    createSlot('comparison-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('alternatives', 'comparison', true, 'hero'),
    createSlot('comparison-conclusion', 'takeaway', true, 'support', { maxChars: 220 })
  ],
  'comparison-matrix': [
    createSlot('comparison-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('comparison-matrix', 'comparison', true, 'hero'),
    createSlot('comparison-recommendation', 'takeaway', true, 'support', { maxChars: 220 })
  ],
  'comparison-decision': [
    createSlot('comparison-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('alternatives', 'comparison', true, 'hero'),
    createSlot('comparison-conclusion', 'takeaway', true, 'support', { maxChars: 220 })
  ],
  'timeline-progress': [
    createSlot('timeline-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('timeline-stages', 'timeline', true, 'hero', { maxItems: 6 }),
    createSlot('timeline-highlight', 'takeaway', false, 'support', { maxChars: 220 })
  ],
  'timeline-milestones': [
    createSlot('timeline-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('milestones', 'timeline', true, 'hero', { maxItems: 6 }),
    createSlot('current-state', 'takeaway', true, 'support', { maxChars: 220 })
  ],
  'timeline-journey': [
    createSlot('timeline-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('milestones', 'timeline', true, 'hero', { maxItems: 6 }),
    createSlot('current-state', 'takeaway', true, 'support', { maxChars: 220 })
  ],
  'concept-hierarchy': [
    createSlot('concept-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('central-concept', 'body', true, 'hero', { maxChars: 220 }),
    createSlot('supporting-concepts', 'body', true, 'support', { maxItems: 4 })
  ],
  'process-flow': [
    createSlot('process-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('process-steps', 'timeline', true, 'hero', { maxItems: 6 }),
    createSlot('process-outcome', 'takeaway', false, 'support', { maxChars: 220 })
  ],
  'process-cycle': [
    createSlot('process-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('cycle-steps', 'timeline', true, 'hero', { maxItems: 6 }),
    createSlot('cycle-insight', 'takeaway', false, 'support', { maxChars: 220 })
  ],
  'process-layers': [
    createSlot('process-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('process-steps', 'timeline', true, 'hero', { maxItems: 6 }),
    createSlot('process-outcome', 'takeaway', false, 'support', { maxChars: 220 })
  ],
  'summary-takeaway': [
    createSlot('summary-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('primary-takeaway', 'takeaway', true, 'hero', { maxChars: 260 }),
    createSlot('proof-points', 'body', false, 'support', { maxItems: 3 }),
    visualSlot('summary-visual', false, 'support', 'spot-illustration', 'preferred', '4:3')
  ],
  'summary-evidence': [
    createSlot('summary-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('summary-conclusion', 'takeaway', true, 'hero', { maxChars: 260 }),
    createSlot('evidence-recap', 'body', true, 'support', { maxItems: 4 })
  ],
  'summary-argument': [
    createSlot('summary-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('primary-takeaway', 'takeaway', true, 'hero', { maxChars: 260 }),
    createSlot('proof-points', 'body', false, 'support', { maxItems: 3 }),
    visualSlot('summary-visual', false, 'support', 'spot-illustration', 'preferred', '4:3')
  ],
  'quote-focus': [
    createSlot('quote-statement', 'quote', true, 'hero', { maxChars: 320 }),
    createSlot('quote-attribution', 'source', false, 'support', { maxChars: 120 })
  ],
  'quote-side-note': [
    createSlot('quote-statement', 'quote', true, 'hero', { maxChars: 320 }),
    createSlot('quote-context', 'body', true, 'support', { maxChars: 260 }),
    createSlot('quote-source', 'source', false, 'auxiliary', { maxChars: 120 })
  ],
  'quote-editorial': [
    createSlot('quote-statement', 'quote', true, 'hero', { maxChars: 320 }),
    createSlot('quote-context', 'body', true, 'support', { maxChars: 260 }),
    createSlot('quote-source', 'source', false, 'auxiliary', { maxChars: 120 })
  ],
  'image-spotlight': [
    createSlot('image-title', 'title', true, 'hero', { maxChars: 100 }),
    createSlot('image-supporting-copy', 'body', false, 'support', { maxChars: 280 }),
    visualSlot('primary-visual', false, 'hero', 'hero-image', 'preferred', '16:9')
  ],
  'image-caption': [
    createSlot('image-title', 'title', true, 'hero', { maxChars: 100 }),
    visualSlot('primary-visual', false, 'hero', 'product-visual', 'preferred', '4:3'),
    createSlot('visual-caption', 'body', true, 'support', { maxChars: 300 })
  ],
  'image-essay': [
    createSlot('image-title', 'title', true, 'hero', { maxChars: 100 }),
    visualSlot('primary-visual', false, 'hero', 'product-visual', 'preferred', '16:9'),
    createSlot('visual-caption', 'body', true, 'support', { maxChars: 300 })
  ]
}

const LAYOUT_MASTER_TEMPLATE_DEFINITIONS: LayoutMasterTemplateDefinition[] = [
  {
    id: 'cover-statement',
    intent: 'cover',
    category: 'cover',
    name: 'Statement cover',
    nameZh: '主张式封面',
    description: 'A single message with restrained supporting detail.',
    descriptionZh: '单一核心主张，配合克制的辅助信息。',
    preview: 'title-center',
    prompt:
      'Use a single dominant title or claim with generous negative space. Keep supporting information small and grouped; give one visual or decorative anchor a clear secondary role.'
  },
  {
    id: 'cover-split',
    intent: 'cover',
    category: 'cover',
    name: 'Split cover',
    nameZh: '左右分屏封面',
    description: 'A clear title block balanced by one hero visual.',
    descriptionZh: '清晰标题区与单个主视觉平衡构成。',
    preview: 'title-split',
    prompt:
      'Use an asymmetric split composition: title and context occupy one side, while one hero visual or visual field occupies the other. Keep the title block compact and make the split deliberate.'
  },
  {
    id: 'cover-immersive',
    intent: 'cover',
    category: 'cover',
    name: 'Immersive cover',
    nameZh: '沉浸式封面',
    description: 'A title enters a full visual field with controlled context.',
    descriptionZh: '标题进入完整视觉场，搭配克制的背景信息。',
    preview: 'image-focus',
    prompt:
      'Let a title or claim enter a dominant visual field rather than sit in a separate panel. Use contrast, scale, crop, depth, and a small contextual detail to make the opening feel like a scene, object, or point of view.'
  },
  {
    id: 'content-editorial',
    intent: 'concept',
    category: 'content',
    name: 'Editorial content',
    nameZh: '编辑式内容页',
    description: 'A title-led narrative with one clear reading path.',
    descriptionZh: '标题主导的叙事内容，阅读路径明确。',
    preview: 'editorial',
    prompt:
      'Use an editorial composition: establish a strong title zone, one primary idea or visual anchor, and a small number of supporting modules. Preserve a clear top-to-bottom or left-to-right reading path.'
  },
  {
    id: 'content-two-column',
    intent: 'concept',
    category: 'content',
    name: 'Two-column narrative',
    nameZh: '双栏叙事页',
    description: 'Two related content groups with intentional imbalance.',
    descriptionZh: '两个相关内容组，以有意的不对称形成层级。',
    preview: 'two-column',
    prompt:
      'Use two related columns with intentional hierarchy rather than equal card stacks. Give one column a primary role and use the other for explanation, evidence, or a supporting visual.'
  },
  {
    id: 'data-metrics',
    intent: 'data-focus',
    category: 'data',
    name: 'Metric focus',
    nameZh: '核心指标页',
    description: 'A key number or chart supported by concise evidence.',
    descriptionZh: '核心数字或图表主导，配合简洁证据。',
    preview: 'metric-grid',
    prompt:
      'Make one metric, trend, or chart the dominant visual anchor. Support it with a small number of concise evidence modules and make numeric hierarchy immediately scannable. Choose the expression that best fits this page: a typographic hero beside a visual, a metric integrated into an annotated chart, a full-height evidence field, or a compact data band. Independent content modules must retain an actual nonzero gap. When evidence is brief, consider enlarging or repositioning the existing metric, chart, or evidence panels so they jointly carry the page height instead of pinning a shallow evidence rail directly beneath a chart.'
  },
  {
    id: 'data-chart-side',
    intent: 'data-focus',
    category: 'data',
    name: 'Chart with takeaway',
    nameZh: '图表结论页',
    description: 'A chart-led area paired with a decisive takeaway.',
    descriptionZh: '图表主区域配合明确结论。',
    preview: 'chart-side',
    prompt:
      'Allocate a substantial chart or data visualization area and pair it with one concise takeaway panel. Let the chart carry the evidence and keep surrounding labels restrained. The chart may lead as a large field, share the page with a tall conclusion, or become an annotated evidence surface; choose the relationship that best tells this page rather than repeating a fixed sidebar. Independent content modules must retain an actual nonzero gap. When the supporting content is short, let the chart or takeaway panel extend into the available height, or rebalance the existing modules vertically; avoid leaving an accidental empty lower band beneath a row of small cards.'
  },
  {
    id: 'data-annotated',
    intent: 'data-focus',
    category: 'data',
    name: 'Annotated evidence',
    nameZh: '注释式数据证据',
    description: 'One evidence surface with interpretation integrated into it.',
    descriptionZh: '一个主证据面，将解释融入图表或数据视觉中。',
    preview: 'chart-side',
    prompt:
      'Treat the chart, scale, or data object as the page itself: integrate the main statement, one or two annotations, and the conclusion into a single evidence surface. Use proximity and contrast to guide attention; supporting facts may orbit, attach to, or emerge from the visual rather than forming a conventional dashboard.'
  },
  {
    id: 'comparison-versus',
    intent: 'comparison',
    category: 'comparison',
    name: 'Versus comparison',
    nameZh: '正反对比',
    description: 'Two alternatives aligned against shared criteria.',
    descriptionZh: '两个方案围绕共用维度对齐比较。',
    preview: 'versus',
    prompt:
      'Use two clearly separated alternatives aligned against the same comparison criteria. Keep their visual weight balanced, make differences explicit, and reserve a short conclusion area.'
  },
  {
    id: 'comparison-matrix',
    intent: 'comparison',
    category: 'comparison',
    name: 'Comparison matrix',
    nameZh: '矩阵对比',
    description: 'A compact shared-criteria comparison with one recommendation.',
    descriptionZh: '围绕共用维度紧凑比较，并给出一个建议。',
    preview: 'two-column',
    prompt:
      'Use a compact comparison matrix or aligned criterion rows. Surface the most meaningful distinction visually, then close with one recommendation or implication rather than repeating every point.'
  },
  {
    id: 'comparison-decision',
    intent: 'comparison',
    category: 'comparison',
    name: 'Decision spine',
    nameZh: '决策脊线对比',
    description: 'Alternatives converge on one decisive distinction or choice.',
    descriptionZh: '多个选项收束到一个决定性差异或选择。',
    preview: 'versus',
    prompt:
      'Organize alternatives around the decisive choice rather than forcing equal side-by-side panels. A central verdict, threshold, criterion spine, or branching path can make the difference visible; give shared criteria and the final implication stronger structure than decorative symmetry.'
  },
  {
    id: 'timeline-progress',
    intent: 'timeline',
    category: 'narrative',
    name: 'Progress timeline',
    nameZh: '进程时间线',
    description: 'A sequence of stages with one highlighted moment.',
    descriptionZh: '阶段推进的时间线，突出一个关键节点。',
    preview: 'timeline',
    prompt:
      'Use a clear chronological progression with a limited number of stages. Emphasize the most important moment or transition and keep supporting detail attached to its stage.'
  },
  {
    id: 'timeline-milestones',
    intent: 'timeline',
    category: 'narrative',
    name: 'Milestone story',
    nameZh: '里程碑叙事',
    description: 'A milestone sequence with a strong present or future state.',
    descriptionZh: '里程碑序列，突出当前或未来状态。',
    preview: 'timeline',
    prompt:
      'Use a milestone sequence that leads clearly to a highlighted current, decision, or future state. Give the highlighted destination more space than the historical steps.'
  },
  {
    id: 'timeline-journey',
    intent: 'timeline',
    category: 'narrative',
    name: 'Journey timeline',
    nameZh: '旅程式时间线',
    description: 'A temporal path that turns stages into a visual journey.',
    descriptionZh: '将阶段转化为一条具有空间感的时间旅程。',
    preview: 'timeline',
    prompt:
      'Turn the sequence into a journey through the canvas: a route, rising path, staged landscape, or editorial progression can carry time. Keep the order unmistakable, but let scale, pause, and destination create drama instead of presenting identical stops on a single rail.'
  },
  {
    id: 'concept-hierarchy',
    intent: 'concept',
    category: 'content',
    name: 'Concept hierarchy',
    nameZh: '概念层级',
    description: 'One central idea and grouped supporting concepts.',
    descriptionZh: '一个中心概念，搭配分组的支撑信息。',
    preview: 'process',
    prompt:
      'Use one central concept or proposition with a small number of grouped supporting concepts. Make the hierarchy visible through scale and proximity, not a dense network of arrows.'
  },
  {
    id: 'process-flow',
    intent: 'process',
    category: 'narrative',
    name: 'Flow process',
    nameZh: '流程机制',
    description: 'A directional flow with visible cause and effect.',
    descriptionZh: '方向明确的流程，清楚表达因果关系。',
    preview: 'process',
    prompt:
      'Use a directional process or mechanism with visible handoffs between steps. Keep each stage concise and make the causal or operational flow legible at a glance.'
  },
  {
    id: 'process-cycle',
    intent: 'process',
    category: 'narrative',
    name: 'Cycle process',
    nameZh: '循环机制',
    description: 'A recurring system with a deliberate feedback loop.',
    descriptionZh: '循环系统，明确表现反馈关系。',
    preview: 'process',
    prompt:
      'Use a compact recurring cycle when the mechanism includes feedback or iteration. Make the loop legible, but keep labels and step count restrained so the process reads in one glance.'
  },
  {
    id: 'process-layers',
    intent: 'process',
    category: 'narrative',
    name: 'Layered mechanism',
    nameZh: '分层机制图',
    description: 'A process shown as stacked layers, handoffs, or operating planes.',
    descriptionZh: '用分层、交接或运行平面表达流程机制。',
    preview: 'process',
    prompt:
      'Show the mechanism as layers, swimlanes, handoffs, or an operating stack when that reveals how parts work together. Preserve causal order, while allowing steps to inhabit different visual planes instead of always becoming one left-to-right arrow chain.'
  },
  {
    id: 'summary-takeaway',
    intent: 'summary',
    category: 'closing',
    name: 'Key takeaway',
    nameZh: '结论总结',
    description: 'One conclusion supported by compact proof points.',
    descriptionZh: '一个结论，配合紧凑的支撑证据。',
    preview: 'closing',
    prompt:
      'Lead with one decisive conclusion. Use a compact set of supporting proof points or next actions beneath it, with the conclusion visually stronger than every support module.'
  },
  {
    id: 'summary-evidence',
    intent: 'summary',
    category: 'closing',
    name: 'Evidence recap',
    nameZh: '证据回顾',
    description: 'A concise conclusion supported by a few memorable facts.',
    descriptionZh: '简洁结论配合少量关键事实回顾。',
    preview: 'closing',
    prompt:
      'Use a concise conclusion with two to four memorable proof points. Let evidence appear as a compact recap, leaving enough negative space for the conclusion to remain dominant.'
  },
  {
    id: 'summary-argument',
    intent: 'summary',
    category: 'closing',
    name: 'Argument close',
    nameZh: '论点式收束',
    description: 'A final claim, proof, and visual memory point.',
    descriptionZh: '以最终主张、证据和视觉记忆点完成收束。',
    preview: 'closing',
    prompt:
      'Close as a short visual argument: state the final claim, give only the proof that earns it, and create one memorable visual or typographic memory point. It may feel like an editorial end card, a decisive poster, or a compact manifesto rather than a recap grid.'
  },
  {
    id: 'quote-focus',
    intent: 'quote',
    category: 'content',
    name: 'Quote focus',
    nameZh: '引言聚焦',
    description: 'A statement-led composition with minimal context.',
    descriptionZh: '语句主导的构图，只保留最少必要背景。',
    preview: 'quote',
    prompt:
      'Make the statement the visual anchor. Use an expressive type hierarchy and only minimal attribution or supporting context; do not dilute it with ordinary card grids.'
  },
  {
    id: 'quote-side-note',
    intent: 'quote',
    category: 'content',
    name: 'Quote with context',
    nameZh: '引言与注释',
    description: 'A strong statement paired with a compact contextual note.',
    descriptionZh: '重点语句配合紧凑的背景说明。',
    preview: 'quote',
    prompt:
      'Use a large statement zone paired with one compact context, source, or implication note. Maintain the statement as the visual anchor and keep the secondary note clearly subordinate.'
  },
  {
    id: 'quote-editorial',
    intent: 'quote',
    category: 'content',
    name: 'Editorial quote',
    nameZh: '编辑式引言',
    description: 'A statement staged through type, scale, and one supporting trace.',
    descriptionZh: '用字体、尺度和一条支撑线索来呈现重点表达。',
    preview: 'quote',
    prompt:
      'Stage the statement like an editorial moment. Let type scale, line breaks, framing space, and one trace of context or source make it felt before it is explained; the page can be quiet, dramatic, or documentary, but should not resemble a standard content card.'
  },
  {
    id: 'image-spotlight',
    intent: 'image-focus',
    category: 'content',
    name: 'Image spotlight',
    nameZh: '视觉聚焦',
    description: 'A dominant visual field with concise supporting copy.',
    descriptionZh: '主视觉区域占主导，文字简洁辅助。',
    preview: 'image-focus',
    prompt:
      'Give one image, product visual, or illustrated field dominant space. Keep text to a concise title and short supporting copy, positioned to complement rather than compete with the visual.'
  },
  {
    id: 'image-caption',
    intent: 'image-focus',
    category: 'content',
    name: 'Visual caption',
    nameZh: '图片注释页',
    description: 'A visual field supported by a structured caption block.',
    descriptionZh: '视觉主区域配合有层级的说明文字。',
    preview: 'image-focus',
    prompt:
      'Use a dominant visual field with a structured caption or annotation block. The supporting text should interpret the visual, not compete with it or turn into a generic card grid.'
  },
  {
    id: 'image-essay',
    intent: 'image-focus',
    category: 'content',
    name: 'Visual essay',
    nameZh: '视觉短章',
    description: 'A full visual field with a concise interpretive thread.',
    descriptionZh: '完整视觉场配合简洁的解读线索。',
    preview: 'image-focus',
    prompt:
      'Let the visual field establish the page mood and point of view, then place a concise title and interpretive thread where they create tension or dialogue with the image. Crop, scale, overlay, and annotation are expressive tools; the copy should read like a visual essay, not a caption card.'
  }
]

const cloneSlot = (slot: LayoutSlot): LayoutSlot => ({
  ...slot,
  image: slot.image ? { ...slot.image } : undefined
})

const cloneTemplate = (template: LayoutMasterTemplate): LayoutMasterTemplate => ({
  ...template,
  slots: template.slots.map(cloneSlot)
})

const LAYOUT_MASTER_TEMPLATES: LayoutMasterTemplate[] = LAYOUT_MASTER_TEMPLATE_DEFINITIONS.map(
  (template) => ({
    ...template,
    layoutContractVersion: LAYOUT_CONTRACT_VERSION,
    slots: (LAYOUT_MASTER_SLOTS[template.id] || []).map(cloneSlot)
  })
)

const DEFAULT_LAYOUT_MAPPINGS: Record<LayoutIntent, string> = {
  cover: 'cover-statement',
  'data-focus': 'data-metrics',
  comparison: 'comparison-versus',
  timeline: 'timeline-progress',
  concept: 'content-editorial',
  process: 'process-flow',
  summary: 'summary-takeaway',
  quote: 'quote-focus',
  'image-focus': 'image-spotlight'
}

const TEMPLATE_BY_ID = new Map(LAYOUT_MASTER_TEMPLATES.map((template) => [template.id, template]))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const getLayoutMasterTemplates = (): LayoutMasterTemplate[] =>
  LAYOUT_MASTER_TEMPLATES.map(cloneTemplate)

export const getDefaultLayoutMasterMappings = (): Record<LayoutIntent, string> => ({
  ...DEFAULT_LAYOUT_MAPPINGS
})

export const getLayoutMasterTemplate = (value: unknown): LayoutMasterTemplate | null => {
  const id = typeof value === 'string' ? value.trim() : ''
  const template = TEMPLATE_BY_ID.get(id)
  return template ? cloneTemplate(template) : null
}

export const createPageLayoutSource = (template: LayoutMasterTemplate): PageLayoutSource => ({
  version: LAYOUT_CONTRACT_VERSION,
  layoutId: template.id,
  layoutContractVersion: template.layoutContractVersion,
  layoutIntent: template.intent
})

export const resolvePageLayoutSourceTemplate = (
  source: Pick<PageLayoutSource, 'layoutId' | 'layoutIntent'> | null | undefined
): LayoutMasterTemplate | null => {
  if (!source || !source.layoutId) return null
  const template = getLayoutMasterTemplate(source.layoutId)
  return template && template.intent === source.layoutIntent ? template : null
}

export const isCompatiblePageLayoutSource = (
  source: PageLayoutSource | null | undefined
): boolean => {
  if (!source || source.version !== LAYOUT_CONTRACT_VERSION) return false
  const template = resolvePageLayoutSourceTemplate(source)
  return Boolean(template && template.layoutContractVersion === source.layoutContractVersion)
}

export const validateLayoutMasterTemplate = (template: LayoutMasterTemplate): string[] => {
  const errors: string[] = []
  const slotIds = new Set<string>()
  for (const slot of template.slots) {
    if (!slot.id.trim()) {
      errors.push(`Layout ${template.id} has a slot without an id.`)
      continue
    }
    if (slotIds.has(slot.id)) {
      errors.push(`Layout ${template.id} has a duplicate slot id: ${slot.id}.`)
    }
    slotIds.add(slot.id)
    if (slot.maxItems !== undefined && (!Number.isInteger(slot.maxItems) || slot.maxItems < 1)) {
      errors.push(`Layout ${template.id} slot ${slot.id} has an invalid maxItems value.`)
    }
    if (slot.maxChars !== undefined && (!Number.isInteger(slot.maxChars) || slot.maxChars < 1)) {
      errors.push(`Layout ${template.id} slot ${slot.id} has an invalid maxChars value.`)
    }
    if (slot.image && slot.role !== 'visual') {
      errors.push(`Layout ${template.id} slot ${slot.id} declares image policy outside visual role.`)
    }
  }
  if (!template.slots.some((slot) => slot.role === 'title' || slot.role === 'quote')) {
    errors.push(`Layout ${template.id} must declare a title or quote slot.`)
  }
  return errors
}

export const buildDefaultSessionLayoutLibrary = (): SessionLayoutLibrary => ({
  version: MASTER_LAYOUTS_VERSION,
  mappings: getDefaultLayoutMasterMappings()
})

export const normalizeSessionLayoutLibrary = (value: unknown): SessionLayoutLibrary => {
  const input = isRecord(value) ? value : {}
  const rawMappings = isRecord(input.mappings) ? input.mappings : {}
  const mappings = getDefaultLayoutMasterMappings()
  for (const intent of LAYOUT_INTENTS) {
    const candidate = rawMappings[intent]
    const template = getLayoutMasterTemplate(candidate)
    if (template && template.intent === intent) mappings[intent] = template.id
  }
  return { version: MASTER_LAYOUTS_VERSION, mappings }
}

export const isValidSessionLayoutLibrary = (value: unknown): value is SessionLayoutLibrary => {
  if (!isRecord(value) || value.version !== MASTER_LAYOUTS_VERSION) return false
  const mappings = value.mappings
  if (!isRecord(mappings)) return false
  return LAYOUT_INTENTS.every((intent) => {
    const template = getLayoutMasterTemplate(mappings[intent])
    return template?.intent === intent
  })
}

export const resolveLayoutMasterTemplate = (
  library: unknown,
  intent: LayoutIntent | undefined
): LayoutMasterTemplate => {
  const normalizedIntent = normalizeLayoutIntent(intent)
  const normalizedLibrary = normalizeSessionLayoutLibrary(library)
  return (
    getLayoutMasterTemplate(normalizedLibrary.mappings[normalizedIntent]) ||
    getLayoutMasterTemplate(DEFAULT_LAYOUT_MAPPINGS[normalizedIntent]) ||
    getLayoutMasterTemplates()[0]
  )
}

/**
 * Resolve a deterministic creative variant for a page that has not persisted a
 * concrete layout yet. The session mapping remains the preferred first variant;
 * later pages of the same intent can use the other catalog entries without
 * changing the layout source of already-generated pages.
 */
export const resolveLayoutMasterTemplateVariant = (
  library: unknown,
  intent: LayoutIntent | undefined,
  variantIndex = 0
): LayoutMasterTemplate => {
  const normalizedIntent = normalizeLayoutIntent(intent)
  const candidates = getLayoutMasterTemplates().filter(
    (template) => template.intent === normalizedIntent
  )
  if (candidates.length === 0) return resolveLayoutMasterTemplate(library, normalizedIntent)

  const preferred = resolveLayoutMasterTemplate(library, normalizedIntent)
  const preferredIndex = Math.max(
    0,
    candidates.findIndex((template) => template.id === preferred.id)
  )
  const normalizedVariantIndex = Number.isInteger(variantIndex) && variantIndex >= 0 ? variantIndex : 0
  return candidates[(preferredIndex + normalizedVariantIndex) % candidates.length]
}

export type StablePageLayoutResolution = {
  layoutIntent: LayoutIntent
  layoutId: string
  layoutContractVersion: number
  layoutPrompt: string
  diagnostic?: 'layout-contract-incompatible'
}

/**
 * A persisted page source is authoritative over the current session mapping.
 * When a catalog entry has since disappeared, keep its identity instead of
 * silently regenerating the page with a different layout.
 */
export const resolveStablePageLayoutSource = (
  library: unknown,
  source: {
    layoutIntent?: LayoutIntent | null
    layoutId?: string | null
    layoutContractVersion?: number | null
  }
): StablePageLayoutResolution => {
  const layoutId = typeof source.layoutId === 'string' ? source.layoutId.trim() : ''
  const layoutContractVersion = Number(source.layoutContractVersion)
  const hasPersistedSource = Boolean(layoutId) && Number.isInteger(layoutContractVersion) && layoutContractVersion > 0
  const layoutIntent = normalizeLayoutIntent(source.layoutIntent)

  if (hasPersistedSource) {
    const template = getLayoutMasterTemplate(layoutId)
    if (template && (!source.layoutIntent || template.intent === layoutIntent)) {
      return {
        layoutIntent: source.layoutIntent || template.intent,
        layoutId,
        layoutContractVersion,
        layoutPrompt: formatLayoutMasterPrompt(template)
      }
    }
    return {
      layoutIntent,
      layoutId,
      layoutContractVersion,
      layoutPrompt:
        `Stored layout source ${layoutId} is unavailable or incompatible. ` +
        'Preserve the existing information architecture and do not remap this page to another layout.',
      diagnostic: 'layout-contract-incompatible'
    }
  }

  const template = resolveLayoutMasterTemplate(library, source.layoutIntent || undefined)
  return {
    layoutIntent: source.layoutIntent || template.intent,
    layoutId: template.id,
    layoutContractVersion: template.layoutContractVersion,
    layoutPrompt: formatLayoutMasterPrompt(template)
  }
}

export const formatLayoutMasterPrompt = (template: LayoutMasterTemplate): string =>
  [
    `Selected layout family: ${template.name} (${template.id}).`,
    `Creative direction: ${template.prompt}`,
    `Semantic anchors (layout compatibility v${template.layoutContractVersion}):`,
    ...template.slots.map((slot) => {
      const limits = [
        slot.maxItems ? `target up to ${slot.maxItems} concise content items` : '',
        slot.maxChars ? `target up to ${slot.maxChars} characters` : '',
        slot.image ? `image policy: ${slot.image.policy}` : ''
      ].filter(Boolean)
      return `- ${slot.id}: ${slot.role}, ${slot.required ? 'required' : 'optional'}, ${slot.priority}${limits.length ? `, ${limits.join(', ')}` : ''}`
    }),
    'Mark every used anchor on its rendered element with data-ppt-slot. Anchors may use any semantic HTML structure that fits the composition. Character and item budgets are density guidance, not structural requirements.',
    'Anchors name content roles, not coordinates or a mandatory grid. Recompose each use from the page thesis and current style: an asymmetric editorial field, centered hero, full-height split, layered annotation, spatial tension, or sequential path can all be valid. When nearby pages use the same family, choose a meaningfully different reading path or visual relationship instead of copying one memorized arrangement.',
    'Use major zones to check visual rhythm, not to force equal boxes. Independent cards, charts, tables, and callouts must retain an actual nonzero gap. With sparse content, redistribute height among existing high-priority zones rather than pinning every module to its minimum height or inventing filler facts.',
    'Treat this as a flexible information architecture, not a pixel-for-pixel template. Keep the current style contract authoritative for visual language, and let imagery, decoration, emphasis, and local composition create a distinct page.'
  ].join('\n')
