import fs from 'fs'
import path from 'path'
import type {
  FontSelection,
  GenerateStartPayload,
  SelectedElementRuntimeContext,
  SessionPageEditPlan,
  SourceDocumentPlan
} from '@shared/generation'
import {
  MAX_SELECTED_PAGES,
  MAX_STYLE_SWITCH_PAGES,
  SELECTED_ELEMENT_CONTEXT_COMPUTED_STYLE_PROPERTIES,
  normalizeAnimationPreferences,
  normalizeFontSelection,
  normalizeSessionPageEditPlan,
  normalizeSelectPageIds
} from '@shared/generation'
import type { AnimationPreferencesPayload } from '@shared/generation'
import type { ModelTimeoutProfile } from '@shared/model-timeout'
import type { AgentManager } from '../agent-runtime/agent'
import type { ModelRuntimeConfig } from '../agent-runtime/model'
import type { GenerateChatType } from './types'
import type { PPTDatabase, SessionStyleSnapshotRow } from '../db/database'
import { requireSessionSlideSize, type SlideSizePreset } from '@shared/slide-size'
import type { RuntimeCredentials } from '../ipc/runtime/credentials'
import type { RuntimeLocalFiles } from '../ipc/runtime/local-files'
import type { RuntimeEmitters } from '../ipc/runtime/runtime-emitters'
import type { SessionProjectResolver } from '../ipc/runtime/session-project'
import type { SessionScaffold } from '../ipc/runtime/session-scaffold'
import type { SessionRunStateStore } from '../ipc/runtime/session-run-state'
import { JobCoordinator } from '../agent-runtime'
import { resolveConfiguredImageModel } from '../image-generation/model-config'
import { appendStyleImageGuidance } from '../agent-runtime/prompt/composers/style-image-guidance'

export { resolveSessionReferenceDocumentPath, resolveSourceDocuments } from './source-documents'
import { resolveGlobalModelTimeouts, resolveModelConfigForTask } from '../config/model-config-utils'
import {
  ensureHistoryBaselineSafe,
  recordHistoryOperationStrict
} from '../history/git-history-service'
import { extractOutlineTitles, parseJsonObject } from '../ipc/utils'
import { sourcePlanFromSkeletonRows } from './source-plan'

export type GenerationDbPort = Pick<
  PPTDatabase,
  | 'addMessage'
  | 'createGenerationRun'
  | 'createGenerationRunWithSessionJob'
  | 'createImageFulfillmentJob'
  | 'createProject'
  | 'getActiveModelConfig'
  | 'getAllSettings'
  | 'getImageModelConfig'
  | 'getGenerationRun'
  | 'getImageFulfillmentJob'
  | 'getLatestSessionJob'
  | 'getModelConfig'
  | 'getOrCreateSessionStyleSnapshot'
  | 'getProject'
  | 'getSession'
  | 'getSetting'
  | 'listActiveSessionJobs'
  | 'listGenerationPages'
  | 'listImageFulfillmentIntents'
  | 'listLatestGenerationPageSnapshot'
  | 'listSessionPages'
  | 'listSourcePageSkeletons'
  | 'updateGenerationRunStatus'
  | 'updateProjectStatus'
  | 'updateSessionDesignContract'
  | 'updateSessionJobStatus'
  | 'updateSessionMetadata'
  | 'updateSessionStatus'
  | 'claimImageFulfillmentJob'
  | 'completeImageFulfillmentJob'
  | 'transitionImageFulfillmentIntent'
  | 'transitionImageFulfillmentJob'
  | 'insertImageGenerationHistory'
  | 'upsertGenerationPage'
  | 'upsertSessionPage'
>

export type GenerationTuning = {
  plannerTemperature: number
  designContractTemperature: number
  pageGenerationTemperature: number
  pageEditWithSelectorTemperature: number
  pageEditDefaultTemperature: number
}

export type GenerationAgentManager = Pick<
  AgentManager,
  | 'clearCachedAgent'
  | 'ensureSession'
  | 'getSession'
  | 'removePageAgent'
  | 'removeSession'
  | 'setAgent'
  | 'setPageAgent'
>

export type GenerationHistory = {
  ensureBaseline(sessionId: string, projectDir: string): Promise<void>
  recordOperation(args: Parameters<typeof recordHistoryOperationStrict>[1]): Promise<void>
}

/**
 * The complete set of capabilities Generation may use. It deliberately owns no
 * Electron objects and does not inherit the broad IPC compatibility facade.
 */
export type GenerationContext = {
  db: GenerationDbPort
  agentManager: GenerationAgentManager
  modelRuntime: ModelRuntimeConfig
  sessionRuns: SessionRunStateStore
  runtimeEmitters: Pick<
    RuntimeEmitters,
    | 'emitGenerateChunk'
    | 'emitRuntimeJobStarted'
    | 'emitRuntimeJobTerminal'
    | 'emitSessionRunLifecycle'
    | 'createDeckProgressEmitter'
  >
  sessionProject: Pick<
    SessionProjectResolver,
    'getPageSourceUrl' | 'resolveSessionProjectDir' | 'validateProjectIndexHtml'
  >
  localFiles: Pick<
    RuntimeLocalFiles,
    'assertPathInAllowedRoots' | 'formatImagePathsForPrompt' | 'resolveStoragePath'
  >
  sessionScaffold: Pick<SessionScaffold, 'ensureSessionAssets' | 'scaffoldProjectFiles'>
  credentials: Pick<RuntimeCredentials, 'decryptApiKey'>
  history: GenerationHistory
  tuning: GenerationTuning
  imageCoordinator: JobCoordinator
}

/**
 * IPC composition helper. The input is structural on purpose so the setup
 * layer can pass its compatibility facade without Generation importing it.
 */
export type GenerationContextAssembly = Omit<
  GenerationContext,
  'history' | 'tuning' | 'imageCoordinator'
> & {
  db: PPTDatabase
  imageCoordinator?: JobCoordinator
  PLANNER_TEMPERATURE: number
  DESIGN_CONTRACT_TEMPERATURE: number
  PAGE_GENERATION_TEMPERATURE: number
  PAGE_EDIT_WITH_SELECTOR_TEMPERATURE: number
  PAGE_EDIT_DEFAULT_TEMPERATURE: number
}

export const createGenerationContext = (args: GenerationContextAssembly): GenerationContext => ({
  db: args.db,
  agentManager: args.agentManager,
  modelRuntime: args.modelRuntime,
  sessionRuns: args.sessionRuns,
  runtimeEmitters: args.runtimeEmitters,
  sessionProject: args.sessionProject,
  localFiles: args.localFiles,
  sessionScaffold: args.sessionScaffold,
  credentials: args.credentials,
  history: {
    ensureBaseline: (sessionId, projectDir) =>
      ensureHistoryBaselineSafe(args.db, sessionId, projectDir),
    recordOperation: (operation) => recordHistoryOperationStrict(args.db, operation)
  },
  imageCoordinator: args.imageCoordinator || new JobCoordinator(),
  tuning: {
    plannerTemperature: args.PLANNER_TEMPERATURE,
    designContractTemperature: args.DESIGN_CONTRACT_TEMPERATURE,
    pageGenerationTemperature: args.PAGE_GENERATION_TEMPERATURE,
    pageEditWithSelectorTemperature: args.PAGE_EDIT_WITH_SELECTOR_TEMPERATURE,
    pageEditDefaultTemperature: args.PAGE_EDIT_DEFAULT_TEMPERATURE
  }
})

export type CommonGenerationContext = {
  session: Awaited<ReturnType<GenerationDbPort['getSession']>>
  sessionRecord: Record<string, unknown>
  previousSessionStatus: string
  runId: string
  provider: string
  apiKey: string
  model: string
  modelConfigId?: string
  modelConfigName?: string
  runModel?: string
  providerBaseUrl: string
  maxTokens: number
  modelRuntime: ModelRuntimeConfig
  modelTimeouts: Record<ModelTimeoutProfile, number>
  projectDir: string
  abortSignal: AbortSignal
  styleId: string
  styleSnapshot: SessionStyleSnapshotRow
  styleSkill: {
    preset: {
      id: string
      label: string
      aliases: string[]
      description: string
      fallbackPrompt: string
    }
    prompt: string
  }
  styleSkillPrompt: string
  imageGenerationPrompt: string
  styleKey: string
  styleName: string
  styleVersion: string
  slideSize: SlideSizePreset
  topic: string
  deckTitle: string
  appLocale: 'zh' | 'en'
  fontSelection: FontSelection
  sourcePlan: SourceDocumentPlan | null
  projectId: string
  visualEnabled: boolean
  imageModelConfigId?: string
}

/**
 * Run-scoped identity and cancellation supplied by JobCoordinator. Generation
 * resolves all expensive context only after this lease has been acquired.
 */
export type RuntimeJobExecutionContext = {
  runId: string
  abortSignal: AbortSignal
}

export type NormalizedGenerateInput = {
  sessionId: string
  modelConfigId?: string
  rawUserMessage: string
  rawImagePaths: string[]
  rawVideoPaths: string[]
  rawDocPaths: string[]
  requestedType?: 'deck' | 'page'
  resetVisualStyle: boolean
  persistUserMessage: boolean
  clientMessageId?: string
  selectedPageId?: string
  selectPageIds: string[]
  htmlPath?: string
  selector?: string
  elementTag?: string
  elementText?: string
  selectedElementContext?: SelectedElementRuntimeContext
  chatType: GenerateChatType
  chatPageId?: string
  animationPreferences: AnimationPreferencesPayload | null
  autoApply: boolean
  approvedPlan?: SessionPageEditPlan
  failedRunId?: string
}

const MAX_SELECTED_ELEMENT_CONTEXT_ENTRIES = 40
const MAX_SELECTED_ELEMENT_CONTEXT_CLASSES = 24
const MAX_SELECTED_ELEMENT_CONTEXT_VALUE_LENGTH = 480
const PROMPT_SAFE_COMPUTED_STYLE_PROPERTIES = new Set<string>(
  SELECTED_ELEMENT_CONTEXT_COMPUTED_STYLE_PROPERTIES
)

const normalizeSelectedElementContextValue = (
  value: unknown,
  maxLength = MAX_SELECTED_ELEMENT_CONTEXT_VALUE_LENGTH
): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength)

const isSelectedElementContextAttributeName = (value: string): boolean => {
  const name = value.toLowerCase()
  return (
    Boolean(name) &&
    !name.startsWith('on') &&
    name !== 'style' &&
    name !== 'srcdoc' &&
    !name.startsWith('data-arcsin1-presentation-editor-')
  )
}

export function normalizeSelectedElementRuntimeContext(
  value: unknown
): SelectedElementRuntimeContext | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const input = value as Record<string, unknown>
  const attributes: Record<string, string> = {}
  if (
    input.attributes &&
    typeof input.attributes === 'object' &&
    !Array.isArray(input.attributes)
  ) {
    for (const [key, rawValue] of Object.entries(input.attributes)) {
      if (Object.keys(attributes).length >= MAX_SELECTED_ELEMENT_CONTEXT_ENTRIES) break
      const name = normalizeSelectedElementContextValue(key, 100).toLowerCase()
      if (!isSelectedElementContextAttributeName(name)) continue
      attributes[name] = normalizeSelectedElementContextValue(rawValue)
    }
  }

  const inlineStyle: NonNullable<SelectedElementRuntimeContext['inlineStyle']> = {}
  if (
    input.inlineStyle &&
    typeof input.inlineStyle === 'object' &&
    !Array.isArray(input.inlineStyle)
  ) {
    for (const [key, rawDeclaration] of Object.entries(input.inlineStyle)) {
      if (Object.keys(inlineStyle).length >= MAX_SELECTED_ELEMENT_CONTEXT_ENTRIES) break
      const property = normalizeSelectedElementContextValue(key, 100).toLowerCase()
      if (!/^(?:--)?[a-z][a-z0-9-]*$/i.test(property)) continue
      const declaration =
        rawDeclaration && typeof rawDeclaration === 'object' && !Array.isArray(rawDeclaration)
          ? (rawDeclaration as Record<string, unknown>)
          : null
      if (!declaration) continue
      inlineStyle[property] = {
        value: normalizeSelectedElementContextValue(declaration.value),
        priority: declaration.priority === 'important' ? 'important' : ''
      }
    }
  }

  const computedStyle: Record<string, string> = {}
  if (
    input.computedStyle &&
    typeof input.computedStyle === 'object' &&
    !Array.isArray(input.computedStyle)
  ) {
    for (const [key, rawValue] of Object.entries(input.computedStyle)) {
      const property = normalizeSelectedElementContextValue(key, 100).toLowerCase()
      if (!PROMPT_SAFE_COMPUTED_STYLE_PROPERTIES.has(property)) continue
      const normalizedValue = normalizeSelectedElementContextValue(rawValue)
      if (normalizedValue) computedStyle[property] = normalizedValue
    }
  }

  const classList = Array.isArray(input.classList)
    ? input.classList
        .map((item) => normalizeSelectedElementContextValue(item, 100))
        .filter(
          (item) =>
            Boolean(item) &&
            !item.startsWith('arcsin1-presentation-editor-') &&
            !item.startsWith('ppt-inspector-')
        )
        .slice(0, MAX_SELECTED_ELEMENT_CONTEXT_CLASSES)
    : []
  const boundsInput =
    input.bounds && typeof input.bounds === 'object' && !Array.isArray(input.bounds)
      ? (input.bounds as Record<string, unknown>)
      : null
  const boundsValues = boundsInput
    ? [boundsInput.x, boundsInput.y, boundsInput.width, boundsInput.height].map(Number)
    : []
  const bounds =
    boundsValues.length === 4 && boundsValues.every(Number.isFinite)
      ? {
          x: Math.round(Math.max(-100_000, Math.min(100_000, boundsValues[0])) * 100) / 100,
          y: Math.round(Math.max(-100_000, Math.min(100_000, boundsValues[1])) * 100) / 100,
          width: Math.round(Math.max(0, Math.min(100_000, boundsValues[2])) * 100) / 100,
          height: Math.round(Math.max(0, Math.min(100_000, boundsValues[3])) * 100) / 100
        }
      : undefined

  if (
    classList.length === 0 &&
    Object.keys(attributes).length === 0 &&
    Object.keys(inlineStyle).length === 0 &&
    Object.keys(computedStyle).length === 0 &&
    !bounds
  ) {
    return undefined
  }
  return {
    ...(classList.length > 0 ? { classList } : {}),
    ...(Object.keys(attributes).length > 0 ? { attributes } : {}),
    ...(Object.keys(inlineStyle).length > 0 ? { inlineStyle } : {}),
    ...(Object.keys(computedStyle).length > 0 ? { computedStyle } : {}),
    ...(bounds ? { bounds } : {})
  }
}

export function normalizeGeneratePayload(payload: unknown): NormalizedGenerateInput {
  const input = payload as GenerateStartPayload
  const sessionId = String(input?.sessionId || '').trim()
  const modelConfigId =
    typeof input?.modelConfigId === 'string' && input.modelConfigId.trim().length > 0
      ? input.modelConfigId.trim()
      : undefined
  const rawUserMessage = typeof input?.userMessage === 'string' ? input.userMessage : ''
  const rawImagePaths = Array.isArray(input?.imagePaths)
    ? input.imagePaths
        .map((item) => String(item || '').trim())
        .filter((item) => item.startsWith('./images/'))
        .slice(0, 10)
    : []
  const rawVideoPaths = Array.isArray(input?.videoPaths)
    ? input.videoPaths
        .map((item) => String(item || '').trim())
        .filter((item) => item.startsWith('./videos/'))
        .slice(0, 10)
    : []
  const rawDocPaths = Array.isArray(input?.docPaths)
    ? input.docPaths
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .slice(0, 1)
    : []
  const requestedType =
    input?.type === 'page' ? 'page' : input?.type === 'deck' ? 'deck' : undefined
  const resetVisualStyle = input?.resetVisualStyle === true
  const persistUserMessage = input?.persistUserMessage !== false
  const rawClientMessageId =
    typeof input?.clientMessageId === 'string' ? input.clientMessageId.trim() : ''
  const clientMessageId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    rawClientMessageId
  )
    ? rawClientMessageId
    : undefined
  const selectedPageId =
    typeof input?.selectedPageId === 'string' && input.selectedPageId.trim().length > 0
      ? input.selectedPageId.trim()
      : undefined
  const selectPageIds = normalizeSelectPageIds(
    input?.selectPageIds,
    resetVisualStyle ? MAX_STYLE_SWITCH_PAGES : MAX_SELECTED_PAGES
  )
  const htmlPath = typeof input?.htmlPath === 'string' ? input.htmlPath : undefined
  const selector =
    typeof input?.selector === 'string' && input.selector.trim().length > 0
      ? input.selector.trim()
      : undefined
  const elementTag =
    typeof input?.elementTag === 'string' && input.elementTag.trim().length > 0
      ? input.elementTag.trim()
      : undefined
  const elementText =
    typeof input?.elementText === 'string' && input.elementText.trim().length > 0
      ? input.elementText.trim()
      : undefined
  const selectedElementContext = selector
    ? normalizeSelectedElementRuntimeContext(input?.selectedElementContext)
    : undefined
  const chatType: GenerateChatType = input?.chatType === 'page' ? 'page' : 'main'
  const chatPageId =
    chatType === 'page' &&
    typeof input?.chatPageId === 'string' &&
    input.chatPageId.trim().length > 0
      ? input.chatPageId.trim()
      : undefined
  const animationPreferences = normalizeAnimationPreferences(input?.animationPreferences)
  const autoApply = input?.autoApply === true
  const approvedPlan = normalizeSessionPageEditPlan(input?.approvedPlan)
  const failedRunIdRaw = (payload as { failedRunId?: unknown } | null)?.failedRunId
  const failedRunId =
    typeof failedRunIdRaw === 'string' && failedRunIdRaw.trim().length > 0
      ? failedRunIdRaw.trim()
      : undefined

  return {
    sessionId,
    modelConfigId,
    rawUserMessage,
    rawImagePaths,
    rawVideoPaths,
    rawDocPaths,
    requestedType,
    resetVisualStyle,
    persistUserMessage,
    clientMessageId,
    selectedPageId,
    selectPageIds,
    htmlPath,
    selector,
    elementTag,
    elementText,
    selectedElementContext,
    chatType,
    chatPageId,
    animationPreferences,
    autoApply,
    approvedPlan,
    failedRunId
  }
}

export function buildRetryUserMessage(retrySupplementRaw: string): string {
  const retrySupplement = retrySupplementRaw.trim()
  return retrySupplement
    ? [
        '继续生成本会话中未完成的页面。页面正文、标题、图表标签必须保持与现有页面相同语言。',
        'Continue generating the unfinished slides in this session. Keep slide text, titles, and chart labels in the same language as existing slides.',
        'Determine the content language from the existing topic, outline, source materials, existing slides, and the user supplement; do not infer it from this instruction language.',
        `User supplement:\n${retrySupplement}`
      ].join('\n')
    : [
        '继续生成本会话中未完成的页面。页面正文、标题、图表标签必须保持与现有页面相同语言。',
        'Continue generating the unfinished slides in this session. Keep slide text, titles, and chart labels in the same language as existing slides.',
        'Determine the content language from the existing topic, outline, source materials, and existing slides; do not infer it from this instruction language.'
      ].join('\n')
}

export function buildTotalPages(sessionRecord: Record<string, unknown>): number {
  const total = Number(sessionRecord.page_count ?? sessionRecord.pageCount)
  return Math.max(1, Number.isFinite(total) ? Math.floor(total) : 1)
}

export function buildOutlineTitles(rawUserMessage: string): string[] {
  return extractOutlineTitles(rawUserMessage)
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '')).filter(Boolean) : []
  } catch {
    return []
  }
}

export async function resolveCommonContext(
  ctx: GenerationContext,
  sessionId: string,
  modelConfigId?: string,
  execution?: RuntimeJobExecutionContext
): Promise<CommonGenerationContext> {
  const { db, agentManager, sessionProject, sessionScaffold } = ctx
  if (!execution) throw new Error('Runtime job execution context is required')

  const session = await db.getSession(sessionId)
  if (!session) throw new Error('Session not found')
  const sessionRecord = session as unknown as Record<string, unknown>
  const sessionMetadata = parseJsonObject(sessionRecord.metadata ?? sessionRecord.metadata_json)
  const sourcePlan = sourcePlanFromSkeletonRows(await db.listSourcePageSkeletons(sessionId))
  const previousSessionStatus = String(sessionRecord.status || 'active')
  const visualEnabled =
    Number(sessionRecord.visualEnabled ?? sessionRecord.visual_enabled ?? 0) === 1
  const imageModelConfigId = String(
    sessionRecord.imageModelConfigId ?? sessionRecord.image_model_config_id ?? ''
  ).trim()
  if (visualEnabled) {
    if (!imageModelConfigId) {
      throw new Error('Automatic image generation requires an image model configuration.')
    }
    await resolveConfiguredImageModel(
      { db, decryptApiKey: ctx.credentials.decryptApiKey },
      imageModelConfigId
    )
  }

  const modelConfigContext = {
    db,
    decryptApiKey: ctx.credentials.decryptApiKey
  }
  const activeModel = await resolveModelConfigForTask(modelConfigContext, {
    modelConfigId,
    purpose: 'generation'
  })
  const modelTimeouts = await resolveGlobalModelTimeouts({ db })
  const runModel = JSON.stringify({
    modelConfigId: activeModel.id,
    name: activeModel.name,
    provider: activeModel.provider,
    model: activeModel.model,
    baseUrl: activeModel.baseUrl || undefined,
    maxTokens: activeModel.maxTokens
  })

  const styleSnapshot = await db.getOrCreateSessionStyleSnapshot(sessionId)
  const styleId = styleSnapshot.styleId
  const styleAliases = parseJsonArray(styleSnapshot.aliases)
  const imageGenerationPrompt = styleSnapshot.imageGenerationPrompt?.trim() || ''
  const rawStyleSkillPrompt =
    styleSnapshot.styleSkill?.trim() ||
    (styleSnapshot.description
      ? `Use ${styleSnapshot.styleKey} style: ${styleSnapshot.description}`
      : `Use ${styleSnapshot.styleKey} style.`)
  const styleSkill = {
    preset: {
      id: styleSnapshot.styleId,
      label: styleSnapshot.styleName,
      aliases: styleAliases,
      description: styleSnapshot.description,
      fallbackPrompt: styleSnapshot.description
        ? `Use ${styleSnapshot.styleKey} style: ${styleSnapshot.description}`
        : `Use ${styleSnapshot.styleKey} style.`
    },
    prompt: appendStyleImageGuidance(rawStyleSkillPrompt, {
      visualEnabled,
      imageGenerationPrompt
    })
  }

  const existingProject = await db.getProject(sessionId)
  if (!existingProject) {
    const storagePath = await ctx.localFiles.resolveStoragePath()
    const projectDir = path.join(storagePath, sessionId)
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true })
    }
    await db.createProject({
      session_id: sessionId,
      title: String(sessionRecord.title || 'Untitled'),
      output_path: projectDir,
      root_path: projectDir
    })
  }
  const projectDir = await sessionProject.resolveSessionProjectDir(sessionId)
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true })
  }
  await sessionScaffold.ensureSessionAssets(projectDir)

  agentManager.ensureSession({
    sessionId,
    provider: activeModel.provider,
    model: activeModel.model,
    baseUrl: activeModel.baseUrl,
    projectDir,
    modelRuntime: ctx.modelRuntime
  })
  const settings = await db.getAllSettings()
  const appLocale: 'zh' | 'en' = settings.locale === 'en' ? 'en' : 'zh'
  const projectId = existingProject?.id ?? (await db.getProject(sessionId))?.id
  if (!projectId) throw new Error('Failed to resolve project for session')

  return {
    session,
    sessionRecord,
    previousSessionStatus,
    runId: execution.runId,
    provider: activeModel.provider,
    apiKey: activeModel.apiKey,
    model: activeModel.model,
    modelConfigId: activeModel.id,
    modelConfigName: activeModel.name,
    runModel,
    providerBaseUrl: activeModel.baseUrl,
    maxTokens: activeModel.maxTokens,
    modelRuntime: ctx.modelRuntime,
    modelTimeouts,
    projectDir,
    abortSignal: execution.abortSignal,
    styleId,
    styleSnapshot,
    styleSkill,
    styleSkillPrompt: styleSkill.prompt,
    imageGenerationPrompt,
    styleKey: styleSnapshot.styleKey,
    styleName: styleSnapshot.styleName,
    styleVersion: styleSnapshot.version,
    slideSize: requireSessionSlideSize(sessionRecord),
    topic: String(sessionRecord.topic || '当前主题'),
    deckTitle: String(sessionRecord.title || 'OhMyPPT Preview'),
    appLocale,
    fontSelection: normalizeFontSelection(sessionMetadata.fontSelection),
    sourcePlan,
    projectId,
    visualEnabled,
    imageModelConfigId: visualEnabled ? imageModelConfigId : undefined
  }
}
