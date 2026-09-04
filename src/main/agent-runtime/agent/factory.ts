import log from 'electron-log/main.js'
import { createDeepAgent } from 'deepagents'
import { buildDeckAgentSystemPrompt } from '../prompt/composers/deck-system'
import { buildEditAgentSystemPrompt } from '../prompt/composers/edit-system'
import { createSessionBoundDeckTools } from '../tools/deck-tools'
import { getRequiredProductSkillNamesForSlideSize } from '../../product-skills'
import { resolveModel } from '../model/resolve'
import type { ModelRuntimeConfig } from '../model/usage'
import { attachProductSkillsBackend } from '../skills/backend'
import { createProductGeneralPurposeSubagent, GuardedFilesystemBackend } from './backend'
import type { DeepAgentStreamResult, SessionDeckGenerationContext } from './types'

export type CreateSessionEditAgentArgs = {
  provider: string
  apiKey: string
  model: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
  modelRuntime?: ModelRuntimeConfig
  styleId?: string | null
  context: SessionDeckGenerationContext
}

export type CreateSessionDeckAgentArgs = CreateSessionEditAgentArgs & {
  systemPromptAddendum?: string
}

function shouldBlockNativeEditFile(context: SessionDeckGenerationContext): boolean {
  if (context.editScope === 'presentation-container') return true
  return !Boolean(context.selectedSelector?.trim())
}

function shouldBlockNativeWriteFile(context: SessionDeckGenerationContext): boolean {
  // Every edit scope has a narrower write path with scope and validation enforcement:
  // selector -> edit_file, page -> update_single_page_file,
  // deck -> update_page_file, container -> set_index_transition.
  return context.mode === 'edit'
}

function resolveAllowedEditPaths(context: SessionDeckGenerationContext): string[] | undefined {
  if (!context.selectedSelector?.trim()) return undefined
  const pageId = context.selectedPageId?.trim()
  return pageId ? [`/${pageId}.html`] : []
}

export function createSessionEditAgent(args: CreateSessionEditAgentArgs): DeepAgentStreamResult {
  const model = resolveModel(
    args.provider,
    args.apiKey,
    args.model,
    args.baseUrl,
    args.temperature,
    args.maxTokens,
    args.modelRuntime
  )
  const context: SessionDeckGenerationContext = {
    ...args.context,
    provider: args.provider,
    model: args.model
  }
  const disableNativeEditFile = shouldBlockNativeEditFile(context)
  const disableNativeWriteFile = shouldBlockNativeWriteFile(context)
  const allowedEditPaths = resolveAllowedEditPaths(context)
  const backend = new GuardedFilesystemBackend({
    rootDir: context.projectDir,
    virtualMode: true,
    disableEditFile: disableNativeEditFile,
    disableWriteFile: disableNativeWriteFile,
    allowedEditPaths,
    editBlockedReason: disableNativeEditFile
      ? '当前编辑任务禁止使用 edit_file。请改用 update_single_page_file(pageId, content) 或 update_page_file(pageId, content)。'
      : undefined,
    writeBlockedReason:
      '当前编辑任务禁止使用 write_file。请使用 update_single_page_file(pageId, content)、update_page_file(pageId, content) 或允许的 edit_file。'
  })
  const requiredSkillNames = getRequiredProductSkillNamesForSlideSize(context.slideSize)
  const agentBackend = attachProductSkillsBackend(backend, 'session-edit', requiredSkillNames)
  const tools = createSessionBoundDeckTools(context)
  const systemPrompt = buildEditAgentSystemPrompt(args.styleId, context)
  const hasSelector = Boolean(context.selectedSelector?.trim())
  const isDeckEdit = context.mode === 'edit' && context.editScope === 'deck'
  const isContainerEdit = context.mode === 'edit' && context.editScope === 'presentation-container'
  const promptMode = isContainerEdit
    ? 'container'
    : hasSelector
      ? 'selector'
      : isDeckEdit
        ? 'deck'
        : 'single-page'

  log.info('[deepagent] create session edit agent', {
    sessionId: context.sessionId,
    provider: args.provider,
    model: args.model,
    styleId: args.styleId || '',
    projectDir: context.projectDir,
    indexPath: context.indexPath,
    selectedPageId: context.selectedPageId,
    selectPageIds: context.selectPageIds,
    disableNativeEditFile,
    disableNativeWriteFile,
    allowedEditPaths,
    promptMode,
    skillsEnabled: agentBackend.enabled,
    requiredSkillNames
  })

  return createDeepAgent({
    model: model as any,
    backend: agentBackend.backend,
    systemPrompt,
    tools: tools as any,
    middleware: agentBackend.middleware as any,
    subagents: createProductGeneralPurposeSubagent({
      model,
      tools,
      backend: agentBackend.backend,
      skillSource: agentBackend.skillSource,
      requiredSkillNames
    })
  })
}

export function createSessionDeckAgent(args: CreateSessionDeckAgentArgs): DeepAgentStreamResult {
  const model = resolveModel(
    args.provider,
    args.apiKey,
    args.model,
    args.baseUrl,
    args.temperature,
    args.maxTokens,
    args.modelRuntime
  )
  const context: SessionDeckGenerationContext = {
    ...args.context,
    provider: args.provider,
    model: args.model
  }
  const backend = new GuardedFilesystemBackend({
    rootDir: context.projectDir,
    virtualMode: true,
    disableEditFile: true,
    editBlockedReason: context.templatePageReadRequired
      ? '当前模板生成任务禁止使用 edit_file。请使用 update_template_page_file(pageId, content)。'
      : '当前生成/全局编辑任务禁止使用 edit_file。请使用 update_single_page_file(pageId, content) 或 update_page_file(pageId, content)。'
  })
  const requiredSkillNames = getRequiredProductSkillNamesForSlideSize(context.slideSize)
  const agentBackend = attachProductSkillsBackend(backend, 'session-deck', requiredSkillNames)
  const getToolName = (tool: unknown): string => {
    const maybe = tool as { name?: unknown; lc_kwargs?: { name?: unknown } }
    if (typeof maybe.name === 'string') return maybe.name
    if (typeof maybe.lc_kwargs?.name === 'string') return maybe.lc_kwargs.name
    return ''
  }
  const tools = createSessionBoundDeckTools(context)
  const systemPrompt = [
    buildDeckAgentSystemPrompt(args.styleId, context),
    args.systemPromptAddendum?.trim() || ''
  ]
    .filter(Boolean)
    .join('\n\n')

  log.info('[deepagent] create session deck agent', {
    sessionId: context.sessionId,
    provider: args.provider,
    model: args.model,
    styleId: args.styleId || '',
    projectDir: context.projectDir,
    indexPath: context.indexPath,
    selectedPageId: context.selectedPageId,
    skillsEnabled: agentBackend.enabled,
    requiredSkillNames,
    selectedPagePath:
      context.selectedPageId && context.pageFileMap[context.selectedPageId]
        ? context.pageFileMap[context.selectedPageId]
        : '',
    totalPages: context.outlineTitles.length,
    toolNames: tools.map((tool) => getToolName(tool)).filter((name) => name.length > 0)
  })

  return createDeepAgent({
    model: model as any,
    backend: agentBackend.backend,
    systemPrompt,
    tools: tools as any,
    middleware: agentBackend.middleware as any,
    subagents: createProductGeneralPurposeSubagent({
      model,
      tools,
      backend: agentBackend.backend,
      skillSource: agentBackend.skillSource,
      requiredSkillNames
    })
  })
}
