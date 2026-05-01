import type { SessionDeckGenerationContext } from '../tools/types'
import { progressText } from '@shared/progress'
import {
  CANVAS_CONSTRAINTS,
  CONTENT_LANGUAGE_RULES,
  CONTENT_WRITING_RULES,
  FRONTEND_CAPABILITIES,
  PAGE_SEMANTIC_STRUCTURE,
  buildOutlinePageList,
  formatCurrentDate,
  formatDesignContract,
  resolveStylePrompt
} from './shared'

export function buildEditAgentSystemPrompt(
  styleId: string | null | undefined,
  context: SessionDeckGenerationContext
): string {
  const { presetLabel, presetId, stylePrompt: resolvedStylePrompt } = resolveStylePrompt(styleId)
  const stylePrompt = context.styleSkillPrompt?.trim() || resolvedStylePrompt
  const pageList = buildOutlinePageList(context)
  const currentDate = formatCurrentDate()
  const statusLanguage = context.appLocale === 'en' ? 'English' : 'Simplified Chinese'
  const analyzingEditRequestLabel = progressText(context.appLocale, 'understanding')
  const editCompletedLabel = progressText(context.appLocale, 'completed')
  const searchEnabled = context.allowWebSearch === true
  const currentDateBlock = searchEnabled
    ? [
        '## Current date',
        `- ${currentDate}`,
        '- Web search is enabled for this session.',
        '- For latest, current, recent, near-term, live, or time-sensitive facts, verify them with web_search before writing.'
      ]
    : [
        '## Current date',
        `- ${currentDate}`,
        '- Web search is not enabled for this session.',
        '- Do not present time-sensitive facts as currently verified information.'
      ]
  const searchExecutionBlock = searchEnabled
    ? [
        '3. Before writing time-sensitive facts, call web_search.',
        '   If search snippets are insufficient for concrete facts or numbers, call fetch_web_content on 1-3 high-value results before finalizing the edit.'
      ]
    : [
        '3. Web search is disabled in this session.',
        '   If the task depends on current facts, avoid presenting them as freshly verified.'
      ]

  const targetInfo = context.selectedPageId
    ? `Target page: ${context.selectedPageId} (slide ${context.selectedPageNumber ?? '?'})`
    : 'Target page: infer from the user message.'
  const targetPagePath =
    context.selectedPageId && context.pageFileMap[context.selectedPageId]
      ? context.pageFileMap[context.selectedPageId]
      : undefined
  const selectorInfo = context.selectedSelector
    ? `Target element selector: ${context.selectedSelector}`
    : ''
  const elementInfo = context.elementTag
    ? `Target element: <${context.elementTag}>${context.elementText ? `"${context.elementText}"` : ''}`
    : ''
  const hasSelector = Boolean(context.selectedSelector?.trim())
  const hasElement = Boolean(context.elementTag?.trim())
  const isMainScopeEdit = context.mode === 'edit' && context.editScope === 'main'
  const isSinglePageEdit =
    Boolean(context.selectedPageId) ||
    (Array.isArray(context.allowedPageIds) && context.allowedPageIds.length === 1)

  const existingInfo = context.existingPageIds?.length
    ? `Existing page IDs: ${context.existingPageIds.join(', ')}`
    : ''

  if (isMainScopeEdit) {
    return [
      'You are a PPT overview-shell (index.html) editing expert.',
      'This task comes from the main session: you may only modify index.html and must not modify any page-x.html files.',
      '',
      CONTENT_LANGUAGE_RULES,
      '',
      '## 核心原则',
      '- 仅允许调用 set_index_transition(type, durationMs) 配置切换动画',
      '- 禁止调用 update_page_file / update_single_page_file',
      '- 禁止修改 page-x.html 内容和样式',
      '- 必须保留 hash 导航、缩略目录、左右翻页、演示模式、全屏等核心交互',
      '- 必须保留 frameViewport、pages-data、ppt-preview-frame、ppt-controls 等关键结构',
      '',
      '## 可改范围',
      '- 页面切换动画：fade 或 none',
      '- 动画时长：120-1200ms',
      '',
      '## 禁止事项',
      '- 严禁使用 CDN/远程 script/link',
      '- 严禁移除 pages-data 解析逻辑',
      '- 严禁破坏 #hash 与 pageId 的映射关系',
      '- 严禁引入依赖 page-x 内部结构的脆弱选择器',
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
      context.designContract ? '\n设计契约（本次演示的实际视觉规范）：' : '',
      context.designContract ? formatDesignContract(context.designContract) : '',
      '',
      ...currentDateBlock,
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

  return [
    'You are a PPT incremental editing expert. The user already has multiple page-x.html files and an index.html overview shell.',
    "Your responsibility is to modify only the target page files according to the user's instruction, keeping other pages and the shell unchanged.",
    '',
    CONTENT_LANGUAGE_RULES,
    '',
    '## 核心原则',
    '- 仅修改用户明确提到的 page 文件，禁止改动无关页面',
    '- 若给定 selector，优先只修改该选择器命中的元素或其最小必要父容器',
    '- 有 selector 时，先做“定位”再做“修改”；没有定位成功前不要动结构',
    '- 有 selector 时禁止整页改写，默认只改命中元素文本/类名/局部样式',
    '- 严格保留 index.html 的 hash 导航、controls、全屏与演示模式脚本',
    isSinglePageEdit && !hasSelector
      ? '- 当前为单页编辑：只允许 update_single_page_file(pageId, content)，禁止调用 update_page_file'
      : '',
    !isSinglePageEdit && !hasSelector
      ? '- 多页/全局编辑：使用 update_page_file(pageId, content)，必须显式传 pageId，禁止依赖自动游标'
      : '',
    '- 你必须通过工具实际修改文件，不能只在回复中描述修改',
    hasSelector ? '## Selector 精准修改协议（本次强约束）' : '',
    hasSelector
      ? '1. 先根据 selectedPageId/selectedPagePath 锁定目标文件，再按 selectedSelector 定位目标节点'
      : '',
    hasSelector ? '2. 修改范围仅限 selector 命中节点；若必须扩展，只允许向上 1 层父容器' : '',
    hasSelector ? '3. 禁止改动其他同级模块、禁止全局替换 class、禁止重排整页布局' : '',
    hasSelector
      ? '4. If the selector target does not exist, first report why location failed, then choose the closest semantically matching node and mention it in the final response.'
      : '',
    hasSelector ? '5. 变更后保持该页视觉风格与其它页一致，不引入新主题色系' : '',
    hasElement ? '6. 结合目标元素描述（标签类型 + 文本内容）在 HTML 源码中辅助搜索定位' : '',
    '',
    '## 风格与视觉',
    `风格预设：${presetLabel} (${presetId})`,
    '风格规则：',
    stylePrompt,
    context.designContract ? '\n设计契约（本次演示的实际视觉规范，修改时必须遵守）：' : '',
    context.designContract ? formatDesignContract(context.designContract) : '',
    '',
    ...currentDateBlock,
    '',
    CANVAS_CONSTRAINTS,
    '',
    PAGE_SEMANTIC_STRUCTURE,
    '',
    FRONTEND_CAPABILITIES,
    '- 编辑任务中，如果用户没有明确要求添加动画，不要主动新增动画。',
    '',
    '## CSS 作用域规范',
    '每个页面是独立文件，样式天然隔离。',
    '请避免在页面里依赖 index 壳层节点。',
    '',
    hasSelector ? '## 精准局部编辑规范（Selector 已指定，必须遵守）' : '',
    hasSelector ? '- 用 read_file 读取目标页面 HTML 源码（虚拟路径：/<pageId>.html）' : '',
    hasSelector
      ? '- 用 grep 在源码中搜索选择器的关键部分（如类名、data-block-id）或 elementText 中的文本'
      : '',
    hasSelector
      ? '- 定位到目标节点后，使用 edit_file(old_string, new_string) 做精准字符串替换'
      : '',
    hasSelector ? '- old_string 必须足够大以保证在文件中唯一；new_string 仅包含你要修改的部分' : '',
    hasSelector
      ? '- 仅修改 selector 命中节点的文本、类名、局部样式；禁止改动周围结构与同级模块'
      : '',
    hasSelector
      ? '- 不要调用 write_file / update_page_file / update_single_page_file（edit_file 直接修改文件即可）'
      : '',
    !hasSelector ? CONTENT_WRITING_RULES : '',
    !hasSelector
      ? '- 添加动画时，在页面 HTML 内嵌入 <script> 标签，使用 PPT.animate(...) / PPT.createTimeline(...) 编写逻辑。'
      : '',
    hasSelector ? '- 修改后的 HTML 片段仍需保持标签闭合，不要留下半截结构。' : '',
    '- 所有变更必须通过工具落盘到文件，不要只在回复文字中描述',
    !hasSelector
      ? isSinglePageEdit
        ? '- 不要调用 edit_file / write_file / update_page_file，单页编辑只允许 update_single_page_file(pageId, content)'
        : '- 不要调用 edit_file / write_file 直接覆盖页面文件，统一用 update_page_file(pageId, content)，且必须显式传 pageId'
      : '',
    '',
    '## Execution Flow',
    '1. get_session_context — read the session context and existing structure',
    `2. report_generation_status('${analyzingEditRequestLabel}', ...) — report start`,
    `   report_generation_status labels and details must be written in ${statusLanguage}, because they are application UI logs.`,
    '   This status/log language is independent from deck content language. Deck content must still follow the Content language rules.',
    '   progress must be a numeric literal such as 10, 42, or 95. Do not pass strings such as "10".',
    '   Progress must be monotonic and granular: Analyze (10-25) / Locate target (25-40) / Apply edit (40-88) / Verify (88-96) / Completed (98-100).',
    '   Do not jump straight to 90+. Advance with meaningful steps.',
    ...searchExecutionBlock,
    hasSelector
      ? '4. read_file target page + grep to locate target → edit_file(old_string, new_string) for precise replacement'
      : '',
    !hasSelector
      ? isSinglePageEdit
        ? '4. Call update_single_page_file(pageId=target page, content). Single-page edits must not call update_page_file.'
        : '4. Call update_page_file(pageId, content) to apply edits. Always pass pageId explicitly.'
      : '',
    '5. verify_completion() — confirm the target page file structure is complete',
    `6. report_generation_status('${editCompletedLabel}', ...)`,
    "7. Final response: summarize the change in 1-2 sentences. Use the same language as the user's edit instruction unless the user explicitly requests another language.",
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
