import { ipcMain } from 'electron'
import log from 'electron-log/main.js'
import { tool, type StructuredToolInterface } from '@langchain/core/tools'
import { FilesystemBackend, createDeepAgent } from 'deepagents'
import { z } from 'zod'
import { extractModelText, resolveAgentOutputBudget, resolveModel } from '../agent-runtime/model'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import type { IpcContext } from '../ipc/context'
import { resolveGlobalModelTimeouts, resolveModelConfigForTask } from '../config/model-config-utils'
import { readAppLocale } from '../config/locale-utils'
import { logAgentToolEvents } from '../utils/agent-tool-logger'
import {
  applyHtmlEditsForDocument,
  resolveHtmlEditorDocumentWorkspace
} from './html-editor-handlers'
import { nanoid } from 'nanoid'

export type HtmlEditorAiMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type HtmlEditorAiElementContext = {
  selector: string
  label?: string
  elementTag?: string
  elementText?: string
  html?: string
}

export type HtmlEditorAiEditBatch = {
  propertyEdits: Array<Record<string, unknown>>
  textEdits: Array<Record<string, unknown>>
  dragEdits: Array<Record<string, unknown>>
  deletes: Array<Record<string, unknown>>
  addElements: Array<Record<string, unknown>>
}

export const HTML_EDITOR_AI_INTENTS = [
  'inspect',
  'redesign',
  'style',
  'layout',
  'content',
  'other'
] as const

export type HtmlEditorAiIntent = (typeof HTML_EDITOR_AI_INTENTS)[number]

export type HtmlEditorAiPlan = {
  intent: HtmlEditorAiIntent
  target: string
  summary: string
  changes: string[]
  confirmationQuestion: string
  edits: HtmlEditorAiEditBatch
}

export type HtmlEditorAiPromptArgs = {
  documentTitle?: string
  pageHtml?: string
  selectedElement?: HtmlEditorAiElementContext
  recentMessages?: HtmlEditorAiMessage[]
  userMessage: string
  locale?: 'zh' | 'en'
  pendingPlan?: HtmlEditorAiPlan
}

const MAX_USER_MESSAGE_LENGTH = 4_000
const MAX_HISTORY_MESSAGES = 6
const MAX_HISTORY_MESSAGE_LENGTH = 1_800
const MAX_ELEMENT_HTML_LENGTH = 10_000
const MAX_PAGE_HTML_LENGTH = 12_000
const MAX_VERSION_MESSAGE_LENGTH = 180

const htmlEditorAiStylePatchSchema = z.object({
  zIndex: z.number().finite().optional(),
  opacity: z.number().finite().optional(),
  backgroundColor: z.string().max(100).optional(),
  color: z.string().max(100).optional(),
  fontSize: z.string().max(50).optional(),
  fontWeight: z.string().max(50).optional(),
  textAlign: z.string().max(30).optional(),
  objectFit: z.string().max(30).optional()
})

const htmlEditorAiAttrsPatchSchema = z.object({
  className: z.string().max(2_000).optional(),
  alt: z.string().max(500).optional(),
  poster: z.string().max(1_000).optional(),
  controls: z.boolean().optional(),
  muted: z.boolean().optional(),
  loop: z.boolean().optional(),
  autoplay: z.boolean().optional(),
  playsInline: z.boolean().optional(),
  preload: z.enum(['metadata', 'auto', 'none']).optional()
})

const htmlEditorAiPropertyEditSchema = z.object({
  selector: z.string().min(1).max(2_000),
  blockId: z.string().max(500).optional(),
  patch: z.object({
    html: z.string().max(12_000).optional(),
    text: z.string().max(500).optional(),
    style: htmlEditorAiStylePatchSchema.optional(),
    attrs: htmlEditorAiAttrsPatchSchema.optional()
  })
})

const htmlEditorAiDragEditSchema = z.object({
  selector: z.string().min(1).max(2_000),
  x: z.number().finite().optional(),
  y: z.number().finite().optional(),
  width: z.number().finite().optional(),
  height: z.number().finite().optional(),
  isAbsoluteMode: z.boolean().optional(),
  zIndex: z.number().finite().optional(),
  zIndexOnly: z.boolean().optional()
})

const htmlEditorAiEditBatchSchema = z.object({
  propertyEdits: z.array(htmlEditorAiPropertyEditSchema).max(8).default([]),
  textEdits: z.array(htmlEditorAiPropertyEditSchema).max(8).default([]),
  dragEdits: z.array(htmlEditorAiDragEditSchema).max(8).default([]),
  deletes: z
    .array(z.object({ selector: z.string().min(1).max(2_000) }))
    .max(8)
    .default([]),
  addElements: z
    .array(
      z.object({
        parentSelector: z.string().min(1).max(2_000),
        htmlFragment: z.string().min(1).max(20_000),
        insertIndex: z.number().int().min(-1).max(10_000).optional()
      })
    )
    .max(4)
    .default([])
})

const htmlEditorAiPlanSchema = z.object({
  intent: z.enum(HTML_EDITOR_AI_INTENTS),
  target: z.string().min(1).max(500),
  summary: z.string().min(1).max(1_500),
  changes: z.array(z.string().min(1).max(500)).min(1).max(8),
  confirmationQuestion: z.string().min(1).max(300),
  edits: htmlEditorAiEditBatchSchema.default({
    propertyEdits: [],
    textEdits: [],
    dragEdits: [],
    deletes: [],
    addElements: []
  })
})

const clipText = (value: unknown, maxLength: number): string => {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}\n...[内容已截断]`
}

async function persistHtmlEditorMessage(
  ctx: Pick<IpcContext, 'db'>,
  message: {
    docId: string
    role: 'user' | 'assistant'
    content: string
    intent?: string
    plan?: HtmlEditorAiPlan | null
    requiresConfirmation?: boolean
    selectedElement?: HtmlEditorAiElementContext
  }
): Promise<void> {
  try {
    await ctx.db.createHtmlEditMessage({
      id: nanoid(14),
      docId: message.docId,
      role: message.role,
      content: clipText(message.content, MAX_USER_MESSAGE_LENGTH),
      intent: message.intent || null,
      planJson: message.plan ? JSON.stringify(message.plan) : null,
      requiresConfirmation: message.requiresConfirmation === true,
      selectedElement: message.selectedElement,
      createdAt: Date.now()
    })
  } catch (error) {
    log.warn('[html-editor:aiChat] persist message failed', {
      docId: message.docId,
      role: message.role,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

function normalizeMessage(value: unknown): HtmlEditorAiMessage | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const role = record.role === 'assistant' ? 'assistant' : record.role === 'user' ? 'user' : null
  const content = clipText(record.content, MAX_HISTORY_MESSAGE_LENGTH)
  return role && content ? { role, content } : null
}

function normalizeElement(value: unknown): HtmlEditorAiElementContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  const selector = clipText(record.selector, 2_000)
  if (!selector) return undefined
  return {
    selector,
    label: clipText(record.label, 500) || undefined,
    elementTag: clipText(record.elementTag, 80) || undefined,
    elementText: clipText(record.elementText, 2_000) || undefined,
    html: clipText(record.html, MAX_ELEMENT_HTML_LENGTH) || undefined
  }
}

function normalizePendingPlan(value: unknown): HtmlEditorAiPlan | undefined {
  const parsed = htmlEditorAiPlanSchema.safeParse(value)
  return parsed.success ? (parsed.data as HtmlEditorAiPlan) : undefined
}

function shouldIncludeConversationHistory(args: HtmlEditorAiPromptArgs): boolean {
  if (!args.selectedElement || args.pendingPlan) return true
  const normalized = args.userMessage.toLowerCase().replace(/\s+/g, '')
  return /继续|刚才|上一条|上面|之前|这个方案|还是|然后|另外|同样|再改/.test(normalized)
}

function shouldIncludePageHtml(args: HtmlEditorAiPromptArgs): boolean {
  if (!args.pageHtml) return false
  if (!args.selectedElement) return true
  const normalized = args.userMessage.toLowerCase().replace(/\s+/g, '')
  return /整页|页面|文档|全局|整体|布局|结构|周围|旁边|其他|全部|整个/.test(normalized)
}

function isConfirmationRequest(userMessage: string, pendingPlan?: HtmlEditorAiPlan): boolean {
  if (!pendingPlan) return false
  const normalized = userMessage.toLowerCase().replace(/\s+/g, '')
  return /确认|按这个|按方案|直接改|改吧|执行|应用|同意|没问题|可以改|好的改/.test(normalized)
}

function hasConcreteEditValue(normalizedMessage: string): boolean {
  return /(?:改成|改为|换成|换为|设置为|设置成|设为|变成|变为|替换为|替换成|调整为|移动到|添加|加上|改造成)(?!$)(?!一下$)/.test(
    normalizedMessage
  )
}

export function isExplicitHtmlEditorEditRequest(
  userMessage: string,
  selectedElement?: HtmlEditorAiElementContext
): boolean {
  if (!selectedElement?.selector) return false
  const normalized = userMessage.toLowerCase().replace(/\s+/g, '')
  if (
    /更?好看|更?现代|更?高级|更?专业|漂亮|美观|简洁|优化|美化|风格|设计感/.test(normalized) ||
    /调整一下|改造一下|重新设计|改一下|处理一下/.test(normalized)
  ) {
    return false
  }
  if (/删除|移除|隐藏|显示/.test(normalized)) return true
  return hasConcreteEditValue(normalized)
}

function isHtmlEditorChangeRequest(userMessage: string): boolean {
  const normalized = userMessage.toLowerCase().replace(/\s+/g, '')
  return /改|换|设置|删除|移除|隐藏|显示|添加|加上|移动|调整|优化|美化|改造|重新设计|替换|变成|设为/.test(
    normalized
  )
}

function hasHtmlEditorEdits(batch: HtmlEditorAiEditBatch): boolean {
  return Object.values(batch).some((edits) => edits.length > 0)
}

function buildAppliedReply(locale: 'zh' | 'en', confirmed: boolean, warnings: string[]): string {
  if (locale === 'en') {
    return `${confirmed ? 'The confirmed HTML redesign has been applied.' : 'The HTML redesign has been applied.'}${warnings.length > 0 ? ` Warnings: ${warnings.join('; ')}` : ''}`
  }
  return `${confirmed ? '已按确认方案完成 HTML 改造。' : '已完成 HTML 改造。'}${warnings.length > 0 ? `提示：${warnings.join('；')}` : ''}`
}

function buildNoChangeReply(locale: 'zh' | 'en', warnings: string[]): string {
  if (locale === 'en') {
    return `No effective HTML change was produced, so the page and version history were left unchanged.${warnings.length > 0 ? ` Warnings: ${warnings.join('; ')}` : ''}`
  }
  return `没有产生可写入的 HTML 改动，页面和版本历史保持不变。${warnings.length > 0 ? ` 警告：${warnings.join('；')}` : ''}`
}

function buildHtmlEditorAiVersionMessage(
  userMessage: string,
  plan?: HtmlEditorAiPlan | null
): string {
  const detail = plan?.summary?.trim() || userMessage.trim() || '已应用改动'
  return clipText(`AI 改造：${detail.replace(/\s+/g, ' ')}`, MAX_VERSION_MESSAGE_LENGTH)
}

function buildSelectionRequiredReply(locale: 'zh' | 'en'): string {
  return locale === 'en'
    ? 'Select an element on the canvas first, then I can apply the requested change to it.'
    : '请先在画布中检选一个元素，再让我按你的要求改造它。'
}

function validateHtmlEditorAiEditTargets(
  batch: HtmlEditorAiEditBatch,
  selectedSelector?: string
): void {
  const selectors = [
    ...batch.propertyEdits,
    ...batch.textEdits,
    ...batch.dragEdits,
    ...batch.deletes,
    ...batch.addElements.map((item) => ({ selector: item.parentSelector }))
  ]
    .map((item) => (typeof item.selector === 'string' ? item.selector.trim() : ''))
    .filter(Boolean)
  if (!selectedSelector && selectors.length > 0) {
    throw new Error('AI 改造必须先检选一个元素')
  }
  if (selectedSelector && selectors.some((selector) => selector !== selectedSelector)) {
    throw new Error('AI 改造只能应用到当前检选的元素')
  }
}

function createHtmlEditorAiApplyTool(args: {
  ctx: Pick<IpcContext, 'db' | 'resolveStoragePath'>
  documentId: string
  html?: string
  selectedSelector?: string
  canApply: boolean
  batchOverride?: HtmlEditorAiEditBatch
  getVersionMessage?: () => string
}): {
  tool: StructuredToolInterface
  getApplied: () => { html: string; warnings: string[]; changed: boolean } | null
} {
  let applied: { html: string; warnings: string[]; changed: boolean } | null = null
  const applyTool = tool(
    async (input) => {
      if (!args.canApply) {
        return JSON.stringify({
          status: 'confirmation_required',
          message: '用户尚未确认，不能应用改动。'
        })
      }
      if (applied) {
        return JSON.stringify({ status: 'already_applied', warnings: applied.warnings })
      }
      const batch = args.batchOverride || (input as HtmlEditorAiEditBatch)
      validateHtmlEditorAiEditTargets(batch, args.selectedSelector)
      applied = await applyHtmlEditsForDocument(args.ctx, {
        docId: args.documentId,
        html: args.html,
        batch,
        message: args.getVersionMessage?.() || 'AI 改造'
      })
      return JSON.stringify({
        status: applied.changed ? 'applied' : 'no_changes',
        warnings: applied.warnings
      })
    },
    {
      name: 'apply_html_editor_edits',
      description:
        '在执行条件满足时，将结构化 HTML 编辑持久化到当前文档。明确改动请求可以直接执行；模糊改造请求必须先等待用户确认。只能修改当前检选元素。',
      schema: htmlEditorAiEditBatchSchema
    }
  )
  return { tool: applyTool as unknown as StructuredToolInterface, getApplied: () => applied }
}

export function buildHtmlEditorAiSystemPrompt(
  locale: 'zh' | 'en' = 'zh',
  options: { confirmed?: boolean; autoApply?: boolean; hasSelectedElement?: boolean } = {}
): string {
  const confirmed = options.confirmed === true
  const autoApply = options.autoApply === true
  const hasSelectedElement = options.hasSelectedElement !== false
  return locale === 'en'
    ? [
        'You are the independent AI assistant for a local HTML editor.',
        'Help the user select an element and assist with redesigning or improving it.',
        "Answer in the user's language. Be concrete and concise.",
        'You are running in a ReAct flow. You must call record_html_editor_plan once before your final response to identify intent and record the executable redesign plan.',
        'There is no separate confirmation button in the UI. Treat a clear user message such as "yes", "confirm", or "apply this" as confirmation.',
        'When changing className, submit the complete class list and preserve all existing classes except the explicitly requested replacement.',
        !hasSelectedElement
          ? 'No element is selected. You may analyze the page or guide selection, but never create executable edits, ask for confirmation, or call apply_html_editor_edits. The current document is /current.html in your workspace. When a request depends on page content, use the native read_file tool on /current.html with offset and limit, then read further sections only when needed. For an analysis request, record an inspect plan with empty edits.'
          : confirmed
            ? 'The user explicitly confirmed the pending plan. Call apply_html_editor_edits exactly once with the pending plan edits, then clearly report what was applied. Do not ask for confirmation again.'
            : autoApply
              ? 'The user gave a concrete edit request for the selected element. Record the executable plan, then stop tool use; the host will apply the plan immediately. Do not ask for confirmation or call apply_html_editor_edits.'
              : 'When the user asks for a change, provide a concrete transformation plan with executable edits and ask whether to proceed. Do not apply changes at this stage.',
        'Clearly separate proposed changes from changes that have actually been applied. Never claim that the document was changed unless the apply_html_editor_edits tool succeeded.'
      ].join('\n')
    : [
        '你是本地 HTML 编辑器中的独立 AI 助手。',
        '请帮助用户检选当前文档中的元素，并辅助改造它。',
        '使用用户的语言回答，内容具体、简洁。',
        '你运行在 ReAct 流程中，必须在最终回复前调用 record_html_editor_plan 识别意图，并记录可执行的改造 edits。',
        '界面没有额外的确认按钮；用户在输入框明确回复“可以”“确认”或“按这个改”时，就视为确认。',
        '修改 className 时必须提交完整类名列表；除用户明确要求替换的类名外，其他已有类名必须保留。',
        !hasSelectedElement
          ? '当前没有检选元素。你可以分析页面或引导用户检选，但绝不能生成可执行 edits、询问确认或调用 apply_html_editor_edits。当前文档位于工作区的 /current.html；只要问题依赖页面内容，就使用原生 read_file 工具并通过 offset、limit 分段读取，只在确有需要时继续读取后续内容。分析请求只记录 intent=inspect 且 edits 为空的方案。'
          : confirmed
            ? '用户已经明确确认了待执行方案。请严格调用一次 apply_html_editor_edits，使用待执行方案中的 edits，然后明确说明已应用的内容，不要再次询问确认。'
            : autoApply
              ? '用户对当前检选元素提出了明确的改造动作。记录可执行方案后立即停止工具调用，由宿主直接应用方案；不要询问确认，也不要调用 apply_html_editor_edits。'
              : '当用户提出改造要求时，先给出包含可执行 edits 的具体方案并询问是否按此方案改造；当前阶段不要直接应用改动。',
        '明确区分“建议改造内容”和“已经应用的改动”；只有 apply_html_editor_edits 工具成功后才能声称文档已修改。'
      ].join('\n')
}

export function buildHtmlEditorAiMessages(args: HtmlEditorAiPromptArgs): HtmlEditorAiMessage[] {
  const locale = args.locale === 'en' ? 'en' : 'zh'
  const selectedElement = args.selectedElement
  const history = shouldIncludeConversationHistory(args)
    ? (args.recentMessages || [])
        .map(normalizeMessage)
        .filter((message): message is HtmlEditorAiMessage => Boolean(message))
        .slice(-MAX_HISTORY_MESSAGES)
    : []
  const includePageHtml = shouldIncludePageHtml(args)

  const context = [
    locale === 'en' ? '[HTML editor context]' : '[HTML 编辑器上下文]',
    `${locale === 'en' ? 'Document' : '文档'}: ${clipText(args.documentTitle, 500) || '(untitled)'}`,
    includePageHtml
      ? `${locale === 'en' ? 'Page HTML' : '页面 HTML'}:\n${clipText(args.pageHtml, MAX_PAGE_HTML_LENGTH)}`
      : locale === 'en'
        ? '[Page HTML omitted; the selected element context is sufficient for this request.]'
        : '[已省略页面 HTML；当前请求只需要当前选中元素上下文。]',
    args.pendingPlan
      ? `${locale === 'en' ? '[Pending confirmed plan]' : '[待确认/待执行方案]'}\n${clipText(JSON.stringify(args.pendingPlan), 24_000)}`
      : '',
    selectedElement
      ? [
          locale === 'en' ? '[Selected element]' : '[当前选中元素]',
          `selector: ${selectedElement.selector}`,
          selectedElement.label ? `label: ${selectedElement.label}` : '',
          selectedElement.elementTag ? `tag: <${selectedElement.elementTag}>` : '',
          selectedElement.elementText ? `text: ${selectedElement.elementText}` : '',
          selectedElement.html ? `outerHTML:\n${selectedElement.html}` : ''
        ]
          .filter(Boolean)
          .join('\n')
      : locale === 'en'
        ? '[No element is selected. Ask the user to click an element in inspect mode when element context is needed.]'
        : '[当前没有选中元素；需要元素上下文时，请提示用户先在检视模式中点击画布元素。]'
  ].join('\n\n')

  const userPrompt = `${context}\n\n${locale === 'en' ? '[User request]' : '[用户请求]'}\n${clipText(
    args.userMessage,
    MAX_USER_MESSAGE_LENGTH
  )}`

  return [...history, { role: 'user', content: userPrompt }]
}

function createHtmlEditorAiPlanTool(args: { autoApply: boolean; confirmed: boolean }): {
  tool: StructuredToolInterface
  getPlan: () => HtmlEditorAiPlan | null
} {
  let plan: HtmlEditorAiPlan | null = null
  const planTool = tool(
    async (input) => {
      plan = input as HtmlEditorAiPlan
      return JSON.stringify({
        status: 'plan_recorded',
        message:
          args.autoApply || args.confirmed
            ? '方案已记录。宿主将直接应用这份方案，并在最终回复中说明已经应用的内容。'
            : '方案已记录。向用户说明意图、改造步骤，并询问是否按此方案改造。'
      })
    },
    {
      name: 'record_html_editor_plan',
      description:
        '识别用户意图并记录 HTML 元素改造方案。每次请求必须调用一次。此工具只记录方案，不修改 HTML。',
      schema: htmlEditorAiPlanSchema
    }
  )
  return { tool: planTool as unknown as StructuredToolInterface, getPlan: () => plan }
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function isAssistantMessage(value: unknown): boolean {
  const record = getObject(value)
  if (!record) return false
  const role = String(record.role || '').toLowerCase()
  const type = String(record.type || '').toLowerCase()
  const constructorName = String(
    getObject(record.lc_kwargs)?.type ?? getObject(record.kwargs)?.type ?? ''
  ).toLowerCase()
  const isAssistant =
    role === 'assistant' ||
    type === 'ai' ||
    type === 'assistant' ||
    constructorName === 'ai' ||
    constructorName === 'assistant'
  const isToolOrHuman =
    role === 'tool' ||
    role === 'user' ||
    role === 'system' ||
    type === 'tool' ||
    type === 'human' ||
    type === 'system'
  return isAssistant && !isToolOrHuman
}

function hasToolCalls(value: unknown): boolean {
  const record = getObject(value)
  if (!record) return false
  const additional = getObject(record.additional_kwargs)
  return [
    record.tool_calls,
    record.tool_call_chunks,
    additional?.tool_calls,
    additional?.tool_call_chunks
  ].some((calls) => Array.isArray(calls) && calls.length > 0)
}

function extractAssistantTextsFromState(data: unknown): string[] {
  const texts: string[] = []
  const seen = new Set<object>()

  const visit = (current: unknown): void => {
    if (!current || typeof current !== 'object') return
    if (seen.has(current as object)) return
    seen.add(current as object)

    if (Array.isArray(current)) {
      current.forEach(visit)
      return
    }
    if (isAssistantMessage(current) && !hasToolCalls(current)) {
      const text = extractModelText(current).trim()
      if (text) texts.push(text)
    }
    Object.values(current).forEach(visit)
  }
  visit(data)
  return texts
}

async function collectHtmlEditorAgentReply(stream: AsyncIterable<unknown>): Promise<string> {
  let reply = ''
  let latestAssistantStateText = ''
  const seenToolEvents = new Set<string>()
  for await (const chunk of stream) {
    if (!Array.isArray(chunk) || chunk.length < 3) continue
    const mode = chunk[1] as string
    const data = chunk[2]
    if (mode === 'updates') {
      logAgentToolEvents(data, seenToolEvents, { tag: 'html-editor:aiChat', source: 'updates' })
      const assistantTexts = extractAssistantTextsFromState(data)
      const longestText = assistantTexts.sort((a, b) => b.length - a.length)[0] || ''
      if (longestText.length >= latestAssistantStateText.length) {
        latestAssistantStateText = longestText
      }
      continue
    }
    if (mode !== 'messages' || !Array.isArray(data)) continue
    logAgentToolEvents(data, seenToolEvents, { tag: 'html-editor:aiChat', source: 'messages' })
    for (const message of data as Array<Record<string, unknown>>) {
      if (!isAssistantMessage(message) || hasToolCalls(message)) continue
      const text = extractModelText(message).trim()
      if (text) reply += text
    }
  }
  return latestAssistantStateText.trim() || reply.trim()
}

export function registerHtmlEditorAiHandlers(ctx: IpcContext): void {
  ipcMain.handle('html-editor:aiChat', async (_event, payload: unknown) => {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
    const documentId = clipText(record.documentId, 200)
    const userMessage = clipText(record.userMessage, MAX_USER_MESSAGE_LENGTH)
    const selectedElement = normalizeElement(record.selectedElement)
    if (!documentId) throw new Error('HTML 文档 ID 不能为空')
    if (!userMessage) throw new Error('请输入 AI 请求')

    const fallbackRecentMessages = Array.isArray(record.recentMessages) ? record.recentMessages : []
    let recentMessages = fallbackRecentMessages
    try {
      const persistedMessages = await ctx.db.listHtmlEditMessages(documentId, MAX_HISTORY_MESSAGES)
      if (persistedMessages.length > 0 || fallbackRecentMessages.length === 0) {
        recentMessages = persistedMessages.map((message) => ({
          role: message.role === 'assistant' ? ('assistant' as const) : ('user' as const),
          content: message.content
        }))
      }
    } catch (error) {
      log.warn('[html-editor:aiChat] load message history failed', {
        documentId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    await persistHtmlEditorMessage(ctx, {
      docId: documentId,
      role: 'user',
      content: userMessage,
      selectedElement
    })

    const locale = await readAppLocale(ctx)
    const activeModel = await resolveModelConfigForTask(ctx, {
      modelConfigId: typeof record.modelConfigId === 'string' ? record.modelConfigId : undefined,
      purpose: 'html-editor:aiChat'
    })
    const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
    const pageHtml = typeof record.pageHtml === 'string' ? record.pageHtml : ''
    const pendingPlan = normalizePendingPlan(record.pendingPlan)
    const hasSelectedElement = Boolean(selectedElement?.selector)
    const confirmed = isConfirmationRequest(userMessage, pendingPlan)
    const autoApply = isExplicitHtmlEditorEditRequest(userMessage, selectedElement)
    if (!hasSelectedElement && (confirmed || isHtmlEditorChangeRequest(userMessage))) {
      const reply = buildSelectionRequiredReply(locale)
      await persistHtmlEditorMessage(ctx, {
        docId: documentId,
        role: 'assistant',
        content: reply,
        selectedElement
      })
      return {
        reply,
        model: activeModel.name,
        intent: 'other' as const,
        plan: null,
        requiresConfirmation: false,
        applied: false,
        warnings: []
      }
    }
    if (confirmed && pendingPlan) {
      validateHtmlEditorAiEditTargets(pendingPlan.edits, selectedElement?.selector)
      const applied = await applyHtmlEditsForDocument(ctx, {
        docId: documentId,
        batch: pendingPlan.edits,
        message: buildHtmlEditorAiVersionMessage(userMessage, pendingPlan)
      })
      const reply = applied.changed
        ? buildAppliedReply(locale, true, applied.warnings)
        : buildNoChangeReply(locale, applied.warnings)
      await persistHtmlEditorMessage(ctx, {
        docId: documentId,
        role: 'assistant',
        content: reply,
        intent: pendingPlan.intent,
        plan: pendingPlan,
        requiresConfirmation: false,
        selectedElement
      })
      log.info('[html-editor:aiChat] confirmation fast path', {
        documentId,
        warnings: applied.warnings.length
      })
      return {
        reply,
        model: activeModel.name,
        intent: pendingPlan.intent,
        plan: pendingPlan,
        requiresConfirmation: false,
        applied: applied.changed,
        appliedHtml: applied.changed ? applied.html : undefined,
        warnings: applied.warnings
      }
    }
    const model = resolveModel(
      activeModel.provider,
      activeModel.apiKey,
      activeModel.model,
      activeModel.baseUrl,
      0.35,
      resolveAgentOutputBudget(activeModel.maxTokens),
      ctx.modelRuntime
    )
    const messages = buildHtmlEditorAiMessages({
      documentTitle: typeof record.documentTitle === 'string' ? record.documentTitle : undefined,
      pageHtml,
      selectedElement,
      recentMessages,
      userMessage,
      locale,
      pendingPlan
    })
    const systemPrompt = buildHtmlEditorAiSystemPrompt(locale, {
      confirmed,
      autoApply,
      hasSelectedElement
    })

    log.info('[html-editor:aiChat] start', {
      documentId,
      modelConfigId: activeModel.id,
      model: activeModel.model,
      hasSelectedElement: Boolean(record.selectedElement),
      confirmed,
      autoApply,
      userMessageLength: userMessage.length
    })

    const planRecorder = createHtmlEditorAiPlanTool({ autoApply, confirmed })
    const applyRecorder = createHtmlEditorAiApplyTool({
      ctx,
      documentId,
      selectedSelector: selectedElement?.selector,
      canApply: confirmed || autoApply,
      batchOverride: confirmed ? pendingPlan?.edits : undefined,
      getVersionMessage: () => buildHtmlEditorAiVersionMessage(userMessage, planRecorder.getPlan())
    })
    const documentWorkspace = await resolveHtmlEditorDocumentWorkspace(ctx, documentId)
    const agent = createDeepAgent({
      model,
      backend: new FilesystemBackend({ rootDir: documentWorkspace, virtualMode: true }),
      tools: [planRecorder.tool, applyRecorder.tool] as unknown as StructuredToolInterface[],
      permissions: [
        { operations: ['read'], paths: ['/**'] },
        { operations: ['write'], paths: ['/**'], mode: 'deny' }
      ],
      systemPrompt
    })
    const stream = await agent.stream(
      { messages },
      {
        streamMode: ['updates', 'messages'],
        subgraphs: true,
        signal: AbortSignal.timeout(resolveModelTimeoutMs(modelTimeouts.agent, 'agent'))
      }
    )
    const streamedReply = await collectHtmlEditorAgentReply(stream as AsyncIterable<unknown>)
    let applied = applyRecorder.getApplied()
    const recordedPlan = planRecorder.getPlan()
    const plan = hasSelectedElement
      ? confirmed && pendingPlan
        ? pendingPlan
        : recordedPlan || pendingPlan || null
      : null
    if ((confirmed || autoApply) && !applied && plan) {
      validateHtmlEditorAiEditTargets(plan.edits, selectedElement?.selector)
      applied = await applyHtmlEditsForDocument(ctx, {
        docId: documentId,
        batch: plan.edits,
        message: buildHtmlEditorAiVersionMessage(userMessage, plan)
      })
    }
    if ((confirmed || autoApply) && !plan) {
      throw new Error('AI 未生成可执行改动，请重试或把要改的内容描述得更具体')
    }
    const reply = applied
      ? applied.changed
        ? buildAppliedReply(locale, confirmed, applied.warnings)
        : buildNoChangeReply(locale, applied.warnings)
      : streamedReply
    if (!reply) {
      log.warn('[html-editor:aiChat] stream completed without assistant text', {
        documentId,
        modelConfigId: activeModel.id,
        hasPlan: Boolean(plan)
      })
      throw new Error('AI 未返回有效内容，请检查模型协议和模型配置')
    }
    const requiresConfirmation = Boolean(
      hasSelectedElement &&
      !confirmed &&
      !autoApply &&
      plan &&
      (hasHtmlEditorEdits(plan.edits) || !['inspect', 'other'].includes(plan.intent))
    )

    log.info('[html-editor:aiChat] complete', {
      documentId,
      modelConfigId: activeModel.id,
      replyLength: reply.length,
      intent: plan?.intent || 'unknown',
      requiresConfirmation
    })
    await persistHtmlEditorMessage(ctx, {
      docId: documentId,
      role: 'assistant',
      content: reply,
      intent: plan?.intent,
      plan,
      requiresConfirmation,
      selectedElement
    })
    return {
      reply,
      model: activeModel.name,
      intent: plan?.intent || 'other',
      plan,
      requiresConfirmation,
      applied: applied?.changed === true,
      appliedHtml: applied?.changed ? applied.html : undefined,
      warnings: applied?.warnings || []
    }
  })
}
