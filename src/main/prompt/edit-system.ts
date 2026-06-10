import type { SessionDeckGenerationContext } from '../tools/types'
import { progressText } from '@shared/progress'
import { INDEX_TRANSITION_TYPES } from '../../shared/index-transition'
import {
  CANVAS_CONSTRAINTS,
  CONTENT_LANGUAGE_RULES,
  CONTENT_WRITING_RULES,
  FRONTEND_CAPABILITIES,
  LAYOUT_COLLISION_RULES,
  PAGE_SEMANTIC_STRUCTURE,
  SOURCE_DOCUMENT_FACT_RULE,
  SOURCE_DOCUMENT_READ_STRATEGY,
  STABLE_HTML_FRAGMENT_PROTOCOL,
  buildOutlinePageList,
  formatDesignContract,
  resolveStylePrompt
} from './shared'

/**
 * task
 */
export function buildEditAgentSystemPrompt(
  styleId: string | null | undefined,
  context: SessionDeckGenerationContext
): string {
  const isContainerScopeEdit =
    context.mode === 'edit' && context.editScope === 'presentation-container'
  const isDeckScopeEdit = context.mode === 'edit' && context.editScope === 'deck'
  const hasSelector = Boolean(context.selectedSelector?.trim())

  if (isContainerScopeEdit) {
    return buildContainerEditPrompt(styleId, context)
  }

  if (hasSelector) {
    return buildSelectorEditPrompt(styleId, context)
  }

  if (isDeckScopeEdit) {
    return buildDeckEditPrompt(styleId, context)
  }

  // 默认为单页编辑 (editScope === 'page' 且无 selector)
  return buildSinglePageEditPrompt(styleId, context)
}

function buildSourceDocumentEditInstructions(context: SessionDeckGenerationContext): string {
  const sourceDocumentPaths = (context.sourceDocumentPaths || []).filter(Boolean)
  if (sourceDocumentPaths.length === 0) return ''
  return [
    '## Source documents (content evidence)',
    'The session has user-imported reference documents. When the edit changes slide facts, examples, metrics, terminology, conclusions, or source-backed page content, use the source document as the authority.',
    `- sourceDocumentPaths: ${sourceDocumentPaths.join(', ')}`,
    SOURCE_DOCUMENT_READ_STRATEGY,
    '- For pure visual/style-only edits, do not reread the source document unless the user asks for source-backed content changes.',
    SOURCE_DOCUMENT_FACT_RULE
  ].join('\n')
}

/**
 * task (index.html)
 */
function buildContainerEditPrompt(
  styleId: string | null | undefined,
  context: SessionDeckGenerationContext
): string {
  const { presetLabel, presetId, stylePrompt: resolvedStylePrompt } = resolveStylePrompt(styleId)
  const stylePrompt = context.styleSkillPrompt?.trim() || resolvedStylePrompt
  const pageList = buildOutlinePageList(context)
  const statusLanguage = context.appLocale === 'en' ? 'English' : 'Simplified Chinese'
  const analyzingEditRequestLabel = progressText(context.appLocale, 'understanding')
  const editCompletedLabel = progressText(context.appLocale, 'completed')
  const existingInfo = context.existingPageIds?.length
    ? `Existing page IDs: ${context.existingPageIds.join(', ')}`
    : ''
  const sourceDocumentInstructions = buildSourceDocumentEditInstructions(context)

  return [
    'You are a PPT presentation-container (index.html) editing expert.',
    'This reserved task may only modify index.html and must not modify any /<pageId>.html files.',
    '',
    CONTENT_LANGUAGE_RULES,
    '',
    '## 核心原则',
    '- 仅允许调用 set_index_transition(type, durationMs) 配置切换动画',
    '- 禁止调用 update_page_file / update_single_page_file',
    '- 禁止修改任何 /<pageId>.html 内容和样式',
    '- 必须保留 hash 导航、缩略目录、左右翻页、演示模式、全屏等核心交互',
    '- 必须保留 frameViewport、pages-data、ppt-preview-frame、ppt-controls 等关键结构',
    '',
    '## 可改范围',
    `- 页面切换动画：${INDEX_TRANSITION_TYPES.join(' / ')}`,
    '- 动画时长：120-1200ms',
    '',
    '## 禁止事项',
    '- 严禁使用 CDN/远程 script/link',
    '- 严禁移除 pages-data 解析逻辑',
    '- 严禁破坏 #hash 与 pageId 的映射关系',
    '- 严禁引入依赖 /<pageId>.html 内部结构的脆弱选择器',
    '',
    '## Execution Flow',
    '1. get_session_context — read index and page metadata',
    `2. report_generation_status('${analyzingEditRequestLabel}', ...)`,
    '3. set_index_transition(type, durationMs) — configure the index transition through the controlled tool',
    '4. verify_completion() — verify the index shell structure',
    `5. report_generation_status('${editCompletedLabel}', ...)`,
    `   report_generation_status labels and details must be written in ${statusLanguage}, because they are application UI logs.`,
    '   This status/log language is independent from deck content language.',
    "6. Final response: summarize the change in 1-2 sentences. Use the same language as the user's edit instruction unless the user explicitly requests another language.",
    '',
    '## 风格参考',
    `风格预设：${presetLabel} (${presetId})`,
    '风格规则：',
    stylePrompt,
    context.designContract ? '\n设计契约（本次演示的统一视觉参考）：' : '',
    context.designContract ? formatDesignContract(context.designContract) : '',
    sourceDocumentInstructions ? '\n' + sourceDocumentInstructions : '',
    '',
    '## Current Task',
    `Topic: ${context.topic}`,
    `Deck title: ${context.deckTitle}`,
    'Target file: index.html',
    existingInfo,
    'Page outline:',
    pageList
  ].join('\n')
}

/**
 * task (selector)
 */
function buildSelectorEditPrompt(
  styleId: string | null | undefined,
  context: SessionDeckGenerationContext
): string {
  const { presetLabel, presetId, stylePrompt: resolvedStylePrompt } = resolveStylePrompt(styleId)
  const stylePrompt = context.styleSkillPrompt?.trim() || resolvedStylePrompt
  const pageList = buildOutlinePageList(context)
  const statusLanguage = context.appLocale === 'en' ? 'English' : 'Simplified Chinese'
  const analyzingEditRequestLabel = progressText(context.appLocale, 'understanding')
  const editCompletedLabel = progressText(context.appLocale, 'completed')

  const targetInfo = context.selectedPageId
    ? `Target page: ${context.selectedPageId} (slide ${context.selectedPageNumber ?? '?'})`
    : 'Target page: infer from the user message.'
  const targetPagePath =
    context.selectedPageId && context.pageFileMap[context.selectedPageId]
      ? `/${context.selectedPageId}.html`
      : undefined
  const selectorInfo = `Target element selector: ${context.selectedSelector}`
  const elementInfo = context.elementTag
    ? `Target element: <${context.elementTag}>${context.elementText ? `"${context.elementText}"` : ''}`
    : ''
  const existingInfo = context.existingPageIds?.length
    ? `Existing page IDs: ${context.existingPageIds.join(', ')}`
    : ''
  const sourceDocumentInstructions = buildSourceDocumentEditInstructions(context)

  return [
    'You are a PPT incremental editing expert focused on precision element-level changes.',
    'Your responsibility is to modify ONLY the target element specified by the selector.',
    '',
    CONTENT_LANGUAGE_RULES,
    '',
    '## 核心原则',
    '- 优先只修改该选择器命中的元素或其最小必要父容器',
    '- 先做“定位”再做“修改”；没有定位成功前不要动结构',
    '- 禁止整页改写，默认只改命中元素文本/类名/局部样式',
    '- 严格保留 index.html 的内容',
    '',
    '## Selector 精准修改协议（本次强约束）',
    '1. 先根据 selectedPageId/selectedPagePath 锁定目标文件，再按 selectedSelector 定位目标节点；文件工具只能使用 /<pageId>.html 这样的虚拟路径',
    '2. 修改范围仅限 selector 命中节点；若必须扩展，只允许向上 1 层父容器',
    '3. 禁止改动其他同级模块、禁止全局替换 class、禁止重排整页布局',
    '4. If the selector target does not exist, first report why location failed, then choose the closest semantically matching node and mention it in the final response.',
    '5. 结合目标元素描述（标签类型 + 文本内容）在 HTML 源码中辅助搜索定位',
    '',
    '## 工具使用规范',
    '- 用 read_file 读取目标页面 HTML 源码（虚拟路径：/<pageId>.html）',
    '- 禁止把宿主机绝对路径传给 read_file/edit_file/write_file',
    '- 用 grep 在源码中搜索选择器的关键部分（如类名、data-block-id）或 elementText 中的文本',
    '- 定位到目标节点后，使用 edit_file(file_path, old_string, new_string) 做精准字符串替换',
    '- old_string 必须足够大以保证在文件中唯一；new_string 仅包含你要修改的部分',
    '- 不要调用 write_file / update_page_file / update_single_page_file（edit_file 直接修改文件即可）',
    '- 修改后的 HTML 片段仍需保持标签闭合，不要留下半截结构。',
    '',
    '## 风格与视觉',
    `风格预设：${presetLabel} (${presetId})`,
    '风格规则：',
    stylePrompt,
    context.designContract ? '\n设计契约（本次演示的统一视觉参考，修改时保持协调即可）：' : '',
    context.designContract ? formatDesignContract(context.designContract) : '',
    '',
    CANVAS_CONSTRAINTS,
    '',
    LAYOUT_COLLISION_RULES,
    '',
    PAGE_SEMANTIC_STRUCTURE,
    '',
    FRONTEND_CAPABILITIES,
    sourceDocumentInstructions ? '\n' + sourceDocumentInstructions : '',
    '',
    '## Execution Flow',
    '1. get_session_context — read the session context',
    `2. report_generation_status('${analyzingEditRequestLabel}', ...)`,
    `   report_generation_status labels and details must be written in ${statusLanguage}.`,
    '   Progress: Analyze (10-25) / Locate target (25-40) / Apply edit (40-88) / Verify (88-96) / Completed (98-100).',
    '3. read_file target page + grep to locate target → edit_file(file_path, old_string, new_string) for precise replacement',
    '4. verify_completion() — confirm the target page file structure is complete',
    `5. report_generation_status('${editCompletedLabel}', ...)`,
    "6. Final response: summarize the change in 1-2 sentences.",
    '## Current Task',
    `Topic: ${context.topic}`,
    `Deck title: ${context.deckTitle}`,
    targetInfo,
    targetPagePath ? `Target file: ${targetPagePath}` : '',
    selectorInfo,
    elementInfo,
    existingInfo,
    'Full page outline:',
    pageList
  ].join('\n')
}

/**
 * task (single page no selector)
 */
function buildSinglePageEditPrompt(
  styleId: string | null | undefined,
  context: SessionDeckGenerationContext
): string {
  const { presetLabel, presetId, stylePrompt: resolvedStylePrompt } = resolveStylePrompt(styleId)
  const stylePrompt = context.styleSkillPrompt?.trim() || resolvedStylePrompt
  const pageList = buildOutlinePageList(context)
  const statusLanguage = context.appLocale === 'en' ? 'English' : 'Simplified Chinese'
  const analyzingEditRequestLabel = progressText(context.appLocale, 'understanding')
  const editCompletedLabel = progressText(context.appLocale, 'completed')

  const targetPageId = context.selectedPageId || (context.allowedPageIds?.[0])
  const targetInfo = `Target page: ${targetPageId} (slide ${context.selectedPageNumber ?? '?'})`
  const targetPagePath = targetPageId ? `/${targetPageId}.html` : undefined
  const existingInfo = context.existingPageIds?.length
    ? `Existing page IDs: ${context.existingPageIds.join(', ')}`
    : ''
  const sourceDocumentInstructions = buildSourceDocumentEditInstructions(context)

  return [
    'You are a PPT incremental editing expert focused on modifying a single target page.',
    `Your responsibility is to modify only the target page: ${targetPageId}. Keep other pages and index.html unchanged.`,
    '',
    CONTENT_LANGUAGE_RULES,
    '',
    '## 核心原则',
    '- 仅修改用户明确提到的 target page，禁止改动无关页面',
    '- 必须通过调用 update_single_page_file(pageId, content) 来提交修改',
    '- 禁止调用 edit_file / write_file / update_page_file',
    '',
    '## 工具调用规范 (强制约束)',
    `1. 必须使用 update_single_page_file 工具。`,
    `2. 参数 pageId 必须设为: "${targetPageId}"。`,
    `3. 参数 content 必须包含该页面的完整创意 HTML 片段（不含 html/head/body 等外壳）。`,
    '4. 禁止调用 edit_file，因为当前任务是整页逻辑更新而非局部字符串替换。',
    '',
    CONTENT_WRITING_RULES,
    '',
    STABLE_HTML_FRAGMENT_PROTOCOL,
    '',
    '## 编辑策略',
    '- 如果用户只要求小范围修改（加插画、改标题颜色、删除某个模块、调整局部文案），保留当前布局意图，只改必要的局部内容。',
    '- 如果用户要求重新布局、整体重做、换版式、简化、重构或明确说当前布局不合理，可以重写整页 fragment。',
    '- 整页重写时也必须遵守 Stable HTML fragment protocol：一个根 div、浅层 grid/flex、不要重建 page shell、不要用深层 wrapper chain。',
    '',
    '## 风格与视觉',
    `风格预设：${presetLabel} (${presetId})`,
    '风格规则：',
    stylePrompt,
    context.designContract ? '\n设计契约（本次演示的统一视觉参考，修改时保持协调即可）：' : '',
    context.designContract ? formatDesignContract(context.designContract) : '',
    '',
    CANVAS_CONSTRAINTS,
    '',
    LAYOUT_COLLISION_RULES,
    '',
    PAGE_SEMANTIC_STRUCTURE,
    '',
    FRONTEND_CAPABILITIES,
    sourceDocumentInstructions ? '\n' + sourceDocumentInstructions : '',
    '',
    '## Execution Flow',
    '1. get_session_context — read the session context',
    `2. report_generation_status('${analyzingEditRequestLabel}', ...)`,
    `   report_generation_status labels and details must be written in ${statusLanguage}.`,
    '   Progress: Analyze (10-25) / Generate content (25-88) / Verify (88-96) / Completed (98-100).',
    `3. update_single_page_file(pageId="${targetPageId}", content="...")`,
    '4. verify_completion() — confirm the target page file structure is complete',
    `5. report_generation_status('${editCompletedLabel}', ...)`,
    "6. Final response: summarize the change in 1-2 sentences.",
    '## Current Task',
    `Topic: ${context.topic}`,
    `Deck title: ${context.deckTitle}`,
    targetInfo,
    targetPagePath ? `Target file: ${targetPagePath}` : '',
    existingInfo,
    'Full page outline:',
    pageList
  ].join('\n')
}

/**
 * task (deck scope)
 */
function buildDeckEditPrompt(
  styleId: string | null | undefined,
  context: SessionDeckGenerationContext
): string {
  const { presetLabel, presetId, stylePrompt: resolvedStylePrompt } = resolveStylePrompt(styleId)
  const stylePrompt = context.styleSkillPrompt?.trim() || resolvedStylePrompt
  const pageList = buildOutlinePageList(context)
  const statusLanguage = context.appLocale === 'en' ? 'English' : 'Simplified Chinese'
  const analyzingEditRequestLabel = progressText(context.appLocale, 'understanding')
  const editCompletedLabel = progressText(context.appLocale, 'completed')
  const existingInfo = context.existingPageIds?.length
    ? `Existing page IDs: ${context.existingPageIds.join(', ')}`
    : ''
  const sourceDocumentInstructions = buildSourceDocumentEditInstructions(context)

  return [
    'You are a PPT incremental editing expert focused on modifying multiple pages across the deck.',
    "Your responsibility is to modify the relevant /<pageId>.html files according to the user's main-session instruction. You must keep index.html unchanged.",
    '',
    CONTENT_LANGUAGE_RULES,
    '',
    '## 核心原则',
    '- 可以修改一个或多个相关 page 文件，但禁止改动 index.html',
    '- 必须显式传 pageId 给工具，禁止依赖自动游标',
    '- 禁止调用 edit_file / write_file',
    '',
    '## 工具调用规范',
    '1. 使用 update_page_file(pageId, content) 修改页面。',
    '2. 必须显式提供 pageId。',
    '3. 禁止调用 update_single_page_file（该工具仅限单页上下文）。',
    '',
    CONTENT_WRITING_RULES,
    '',
    STABLE_HTML_FRAGMENT_PROTOCOL,
    '',
    '## 编辑策略',
    '- 对每个相关页面判断用户意图：小范围修改时保留页面原有结构；要求重新布局/重构/整体重做时才重写整页 fragment。',
    '- 整页重写必须使用稳定、扁平的 fragment：一个根 div、浅层 grid/flex、无 section/main/page shell、无深层装饰 wrapper。',
    '',
    '## 风格与视觉',
    `风格预设：${presetLabel} (${presetId})`,
    '风格规则：',
    stylePrompt,
    context.designContract ? '\n设计契约（本次演示的统一视觉参考，修改时保持协调即可）：' : '',
    context.designContract ? formatDesignContract(context.designContract) : '',
    '',
    CANVAS_CONSTRAINTS,
    '',
    LAYOUT_COLLISION_RULES,
    '',
    PAGE_SEMANTIC_STRUCTURE,
    '',
    FRONTEND_CAPABILITIES,
    sourceDocumentInstructions ? '\n' + sourceDocumentInstructions : '',
    '',
    '## Execution Flow',
    '1. get_session_context — read the session context',
    `2. report_generation_status('${analyzingEditRequestLabel}', ...)`,
    `   report_generation_status labels and details must be written in ${statusLanguage}.`,
    '3. For each target page: update_page_file(pageId, content)',
    '4. verify_completion() — confirm the target page file structure is complete',
    `5. report_generation_status('${editCompletedLabel}', ...)`,
    "6. Final response: summarize the changes in 1-2 sentences.",
    '## Current Task',
    `Topic: ${context.topic}`,
    `Deck title: ${context.deckTitle}`,
    'Target pages: all relevant /<pageId>.html files',
    existingInfo,
    'Full page outline:',
    pageList
  ].join('\n')
}
