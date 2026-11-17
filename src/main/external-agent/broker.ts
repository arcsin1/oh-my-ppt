import fs from 'fs'
import path from 'path'
import {
  COMPATIBLE_EXTERNAL_AGENT_PROTOCOL_VERSIONS,
  EXTERNAL_AGENT_CONFIRMATION_TIMEOUT_MS,
  createExternalAgentError,
  buildDefaultCapabilitiesOutput,
  isProtocolVersionSupported,
  redactPageSnapshot,
  redactSessionSnapshot,
  type ExternalAgentBrokerRequest,
  type ExternalAgentCapability,
  type ExternalAgentConfirmationPrompt,
  type ExternalAgentErrorPayload,
  type ExternalAgentFailureResponse,
  type ExternalAgentPageSnapshot,
  type ExternalAgentSessionSnapshot,
  type ExternalAgentStyleSummary,
  type ExternalAgentToolName,
  type InitializeOutput,
  type ListSessionsOutput
} from '@shared/external-agent'
import { validateSafePath, type ExternalAgentAuthorizationService } from './authorization'
import { computeRequestHash } from './idempotency'
import { toOperationSummary, type ExternalAgentOperationService } from './operations'
import type { ExternalAgentRuntimeExecutor } from './runtime-executor'
import { MAX_PPTX_IMPORT_SIZE } from '../io/pptx-import/constants'
import { MAX_ASSET_IMPORT_SIZE, resolveAssetUploadTarget } from '../ipc/runtime/local-files'

export type {
  ExternalAgentConfirmationKind,
  ExternalAgentConfirmationPrompt
} from '@shared/external-agent'

export interface BrokerSessionLookupResult {
  session: Parameters<typeof redactSessionSnapshot>[0]['session'] | null
  pages?: Parameters<typeof redactSessionSnapshot>[0]['pages']
  styleSummary?: ExternalAgentStyleSummary | null
}

export interface ExternalAgentBrokerDataSource {
  listAuthorizedSessions(sessionIds: string[]): Promise<BrokerSessionLookupResult[]>
  getSessionWithPages(sessionId: string): Promise<BrokerSessionLookupResult | null>
  listAvailableStyles?(): Promise<ExternalAgentStyleSummary[]>
  resolveSessionProjectDir?(sessionId: string): Promise<string | null>
}

export type BrokerResponse<T> =
  | { ok: true; data: T; operationId?: string }
  | ExternalAgentFailureResponse

export interface ExternalAgentAuthPromptInput {
  agentId: string
  name: string
  version: string
  executablePath?: string
}

export interface ExternalAgentAuthPromptResult {
  approved: boolean
  capabilities?: ExternalAgentCapability[]
  sessionIds?: string[]
  workspaceRoots?: string[]
}

export type ExternalAgentAuthPrompt = (
  input: ExternalAgentAuthPromptInput
) => Promise<ExternalAgentAuthPromptResult>

const ENQUEUE_TOOLS = new Set<ExternalAgentToolName>([
  'create_session',
  'start_generation',
  'edit_page',
  'edit_deck',
  'import_pptx',
  'import_assets',
  'export_pptx',
  'delete_page',
  'delete_session'
])

function isEnqueueableTool(
  type: ExternalAgentBrokerRequest['type']
): type is ExternalAgentToolName {
  return ENQUEUE_TOOLS.has(type as ExternalAgentToolName)
}

const TOOL_CAPABILITY: Partial<Record<ExternalAgentToolName, ExternalAgentCapability>> = {
  list_sessions: 'read',
  get_session: 'read',
  get_page: 'read',
  create_session: 'create_session',
  start_generation: 'generation',
  edit_page: 'page_edit',
  edit_deck: 'deck_edit',
  import_pptx: 'import_pptx',
  import_assets: 'import_assets',
  export_pptx: 'export_pptx',
  get_operation: 'task_control',
  get_operation_events: 'task_control',
  subscribe_events: 'task_control',
  cancel_operation: 'task_control',
  resume_operation: 'task_control'
}

const fail = (
  error: ExternalAgentErrorPayload,
  operationId?: string
): ExternalAgentFailureResponse => ({
  ok: false,
  error,
  operationId
})

const isErrorPayload = (value: unknown): value is ExternalAgentErrorPayload =>
  Boolean(value) &&
  typeof value === 'object' &&
  'code' in (value as object) &&
  'retryable' in (value as object) &&
  !('id' in (value as object))

export class ExternalAgentBroker {
  constructor(
    private authService: ExternalAgentAuthorizationService,
    private dataSource: ExternalAgentBrokerDataSource,
    private serverVersion: string = '2.3.0',
    private operations?: ExternalAgentOperationService,
    private executor?: ExternalAgentRuntimeExecutor,
    private promptAuth?: ExternalAgentAuthPrompt,
    private promptConfirmation?: (input: ExternalAgentConfirmationPrompt) => Promise<boolean>
  ) {}

  async handleRequest(
    agentId: string,
    request: ExternalAgentBrokerRequest
  ): Promise<BrokerResponse<unknown>> {
    if (request.type === 'initialize') {
      const { protocolVersion } = request.input
      if (!isProtocolVersionSupported(protocolVersion)) {
        return fail(
          createExternalAgentError({
            code: 'PROTOCOL_VERSION_UNSUPPORTED',
            message: `不支持的协议版本: ${protocolVersion}。支持的版本: ${COMPATIBLE_EXTERNAL_AGENT_PROTOCOL_VERSIONS.join(', ')}`,
            details: {
              requestedVersion: protocolVersion,
              supportedVersions: [...COMPATIBLE_EXTERNAL_AGENT_PROTOCOL_VERSIONS]
            }
          })
        )
      }

      const access = await this.authService.checkAccess({ agentId })
      const needsPrompt =
        !access.authorized &&
        Boolean(this.promptAuth) &&
        (access.error?.code === 'AUTH_REQUIRED' || access.error?.code === 'AUTH_REVOKED')
      if (needsPrompt && this.promptAuth) {
        // Do not await the dialog. MCP clients time out, and a pending prompt would block this pipe.
        void this.promptAuth({
          agentId,
          name: request.input.clientInfo.name,
          version: request.input.clientInfo.version,
          executablePath: request.input.clientInfo.executablePath
        })
          .then(async (decision) => {
            if (!decision.approved) return
            await this.authService.grantInitial({
              agentId,
              name: request.input.clientInfo.name,
              version: request.input.clientInfo.version,
              executablePath: request.input.clientInfo.executablePath,
              capabilities: decision.capabilities,
              sessionIds: decision.sessionIds,
              workspaceRoots: decision.workspaceRoots
            })
          })
          .catch(() => undefined)
      } else if (access.authorized) {
        await this.authService.touchLastUsed(agentId)
      }
      const data: InitializeOutput = {
        protocolVersion,
        supportedProtocolVersions: [...COMPATIBLE_EXTERNAL_AGENT_PROTOCOL_VERSIONS],
        serverInfo: {
          name: 'oh-my-ppt',
          version: this.serverVersion
        },
        authenticated: access.authorized,
        agentId: access.authorized ? agentId : undefined
      }
      return { ok: true, data }
    }

    if (request.type === 'get_capabilities') {
      const availableStyles = this.dataSource.listAvailableStyles
        ? await this.dataSource.listAvailableStyles()
        : []
      return { ok: true, data: buildDefaultCapabilitiesOutput({ availableStyles }) }
    }

    if (request.type === 'list_sessions') {
      const access = await this.authService.checkAccess({ agentId, capability: 'read' })
      if (!access.authorized || !access.grant) {
        return fail(
          access.error ??
            createExternalAgentError({
              code: 'AUTH_REQUIRED',
              message: '需要授权后才能列出 Session'
            })
        )
      }

      const records = await this.dataSource.listAuthorizedSessions(access.grant.sessionIds)
      const sessions = records
        .map((r) => {
          if (!r.session) return null
          const snapshot = redactSessionSnapshot({
            session: r.session,
            pages: r.pages,
            styleSummary: r.styleSummary
          })
          const firstPageTitle = snapshot.pages[0]?.title
          const { pages, ...rest } = snapshot
          void pages
          return {
            ...rest,
            firstPageTitle
          }
        })
        .filter((s): s is NonNullable<typeof s> => Boolean(s))

      const limit = request.input.limit ?? 30
      const data: ListSessionsOutput = { sessions: sessions.slice(0, limit) }
      return { ok: true, data }
    }

    if (request.type === 'get_session') {
      const { sessionId } = request.input
      const access = await this.authService.checkAccess({
        agentId,
        capability: 'read',
        sessionId
      })
      if (!access.authorized) {
        return fail(
          access.error ??
            createExternalAgentError({
              code: 'AUTH_REQUIRED',
              message: '需要授权后才能读取 Session'
            })
        )
      }

      const record = await this.dataSource.getSessionWithPages(sessionId)
      if (!record || !record.session) {
        return fail(
          createExternalAgentError({
            code: 'SESSION_NOT_FOUND',
            message: `未找到 Session: ${sessionId}`,
            details: { sessionId }
          })
        )
      }

      const data: ExternalAgentSessionSnapshot = redactSessionSnapshot({
        session: record.session,
        pages: record.pages,
        styleSummary: record.styleSummary
      })
      return { ok: true, data }
    }

    if (request.type === 'get_page') {
      const { sessionId, pageId } = request.input
      const access = await this.authService.checkAccess({
        agentId,
        capability: 'read',
        sessionId
      })
      if (!access.authorized) {
        return fail(
          access.error ??
            createExternalAgentError({ code: 'AUTH_REQUIRED', message: '需要授权后才能读取页面' })
        )
      }

      const record = await this.dataSource.getSessionWithPages(sessionId)
      if (!record || !record.session) {
        return fail(
          createExternalAgentError({
            code: 'SESSION_NOT_FOUND',
            message: `未找到 Session: ${sessionId}`,
            details: { sessionId }
          })
        )
      }

      const rawPage = record.pages?.find((p) => (p.page_id || p.id) === pageId)
      if (!rawPage) {
        return fail(
          createExternalAgentError({
            code: 'VALIDATION_FAILED',
            message: `在 Session ${sessionId} 中未找到页面 ${pageId}`,
            details: { sessionId, pageId }
          })
        )
      }

      const pageIndex = record.pages?.indexOf(rawPage) ?? 0
      const data: ExternalAgentPageSnapshot = redactPageSnapshot(rawPage, pageIndex + 1)
      return { ok: true, data }
    }

    return this.handleMutationOrTask(agentId, request)
  }

  private async handleMutationOrTask(
    agentId: string,
    request: ExternalAgentBrokerRequest
  ): Promise<BrokerResponse<unknown>> {
    if (!this.operations) {
      return fail(
        createExternalAgentError({
          code: 'VALIDATION_FAILED',
          message: `工具未就绪或未支持: ${request.type}`
        })
      )
    }

    if (request.type === 'initialize') {
      return fail(
        createExternalAgentError({
          code: 'VALIDATION_FAILED',
          message: 'initialize 不应进入写路径'
        })
      )
    }
    const capability = TOOL_CAPABILITY[request.type]
    const sessionId = this.sessionIdOf(request)
    const needsSession =
      request.type !== 'create_session' &&
      request.type !== 'import_pptx' &&
      request.type !== 'get_operation' &&
      request.type !== 'get_operation_events' &&
      request.type !== 'subscribe_events' &&
      request.type !== 'cancel_operation' &&
      request.type !== 'resume_operation'

    const access = await this.authService.checkAccess({
      agentId,
      capability:
        request.type === 'delete_page' || request.type === 'delete_session'
          ? undefined
          : capability,
      sessionId: needsSession ? sessionId : undefined
    })
    if (!access.authorized) {
      return fail(
        access.error ??
          createExternalAgentError({ code: 'AUTH_REQUIRED', message: '需要授权后才能调用该工具' })
      )
    }
    const workspaceError = await this.assertWorkspaceAccess(
      request,
      access.grant?.workspaceRoots ?? []
    )
    if (workspaceError) return fail(workspaceError)
    if (request.type === 'export_pptx' && request.input.overwrite !== true) {
      const existingError = this.assertExportTargetAvailable(request.input.outputPath)
      if (existingError) return fail(existingError)
    }

    if (request.type === 'get_operation') {
      return this.readOperation(agentId, request.input.operationId)
    }
    if (request.type === 'get_operation_events' || request.type === 'subscribe_events') {
      return this.readEvents(
        agentId,
        request.input.operationId,
        request.input.afterSequence ?? 0,
        request.type === 'get_operation_events' ? (request.input.limit ?? 50) : 200
      )
    }
    if (request.type === 'cancel_operation') {
      return this.cancelOperation(agentId, request)
    }
    if (request.type === 'resume_operation') {
      return this.resumeOperation(agentId, request)
    }

    if (!isEnqueueableTool(request.type)) {
      return fail(
        createExternalAgentError({
          code: 'VALIDATION_FAILED',
          message: `工具未就绪或未支持: ${request.type}`
        })
      )
    }

    const idempotencyKey =
      'idempotencyKey' in request.input ? request.input.idempotencyKey : undefined
    if (!idempotencyKey) {
      return fail(
        createExternalAgentError({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: '缺少幂等键 idempotencyKey'
        })
      )
    }

    const requestHash = computeRequestHash(request.input)
    const existing = await this.operations.getByIdempotency(agentId, idempotencyKey)
    if (existing) {
      if (existing.requestHash !== requestHash) {
        return fail(
          createExternalAgentError({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: `幂等键 ${idempotencyKey} 已被其他请求使用`,
            details: { idempotencyKey, existingOperationId: existing.id }
          }),
          existing.id
        )
      }
      return {
        ok: true,
        data: toOperationSummary(existing),
        operationId: existing.id
      }
    }

    const awaitingConfirmation =
      request.type === 'delete_page' ||
      request.type === 'delete_session' ||
      (request.type === 'export_pptx' && request.input.overwrite === true)

    const record = await this.operations.enqueue({
      agentId,
      sessionId,
      toolName: request.type,
      idempotencyKey,
      requestHash,
      requestJson: JSON.stringify(request),
      initialStatus: awaitingConfirmation ? 'awaiting_confirmation' : 'queued'
    })
    if (awaitingConfirmation) {
      void this.beginConfirmation(record.id)
    } else {
      this.executor?.kick(sessionId)
    }
    return {
      ok: true,
      data: toOperationSummary(record),
      operationId: record.id
    }
  }

  private async assertWorkspaceAccess(
    request: ExternalAgentBrokerRequest,
    workspaceRoots: string[]
  ): Promise<ExternalAgentErrorPayload | null> {
    const targets: Array<{ path: string; mustExist: boolean; allowMissingLeaf?: boolean }> = []
    let authorizedRoots = workspaceRoots
    if (request.type === 'create_session') {
      if (request.input.workspaceRootPath) {
        if (workspaceRoots.length === 0) return null
        targets.push({ path: request.input.workspaceRootPath, mustExist: false })
      }
    } else if (request.type === 'import_pptx') {
      if (!request.input.sourcePath.toLowerCase().endsWith('.pptx')) {
        return createExternalAgentError({
          code: 'FILE_TYPE_UNSUPPORTED',
          message: '仅支持导入 .pptx 文件',
          details: { targetPath: path.basename(request.input.sourcePath) }
        })
      }
      try {
        if (fs.statSync(request.input.sourcePath).size > MAX_PPTX_IMPORT_SIZE) {
          return createExternalAgentError({
            code: 'FILE_TOO_LARGE',
            message: 'PPTX 文件不能超过 500MB',
            details: { targetPath: path.basename(request.input.sourcePath) }
          })
        }
      } catch {
        // 存在性由 validateSafePath 处理
      }
      targets.push({ path: request.input.sourcePath, mustExist: true })
    } else if (request.type === 'import_assets') {
      for (const source of request.input.sources) {
        try {
          resolveAssetUploadTarget(source.sourcePath, source.kind)
        } catch {
          return createExternalAgentError({
            code: 'FILE_TYPE_UNSUPPORTED',
            message: '素材类型不受支持',
            details: { targetPath: path.basename(source.sourcePath) }
          })
        }
        try {
          if (fs.statSync(source.sourcePath).size > MAX_ASSET_IMPORT_SIZE) {
            return createExternalAgentError({
              code: 'FILE_TOO_LARGE',
              message: '单个素材不能超过 20MB',
              details: { targetPath: path.basename(source.sourcePath) }
            })
          }
        } catch {
          // 存在性由 validateSafePath 处理
        }
        targets.push({ path: source.sourcePath, mustExist: true })
      }
    } else if (request.type === 'export_pptx') {
      if (!request.input.outputPath.toLowerCase().endsWith('.pptx')) {
        return createExternalAgentError({
          code: 'FILE_TYPE_UNSUPPORTED',
          message: '导出目标必须是 .pptx 文件',
          details: { targetPath: path.basename(request.input.outputPath) }
        })
      }
      const projectDir = await this.dataSource.resolveSessionProjectDir?.(request.input.sessionId)
      if (projectDir) {
        authorizedRoots = [...workspaceRoots, path.join(projectDir, 'exports')]
      }
      targets.push({
        path: request.input.outputPath,
        mustExist: false,
        allowMissingLeaf: true
      })
    }
    if (targets.length === 0) return null
    if (authorizedRoots.length === 0) {
      return createExternalAgentError({
        code: 'WORKSPACE_NOT_GRANTED',
        message: '该 Agent 尚未授权工作区根目录'
      })
    }
    for (const target of targets) {
      const check = validateSafePath({
        targetPath: target.path,
        authorizedRoots,
        mustExist: target.mustExist,
        allowMissingLeaf: target.allowMissingLeaf
      })
      if (!check.ok) {
        return (
          check.error ??
          createExternalAgentError({
            code: 'PATH_OUTSIDE_AUTHORIZED_ROOT',
            message: '路径不在授权工作区根目录范围内'
          })
        )
      }
    }
    return null
  }

  private assertExportTargetAvailable(outputPath: string): ExternalAgentErrorPayload | null {
    if (fs.existsSync(path.resolve(outputPath))) {
      return createExternalAgentError({
        code: 'EXPORT_TARGET_EXISTS',
        message: '导出目标已存在，需设置 overwrite: true 并确认后覆盖',
        details: { targetPath: path.basename(outputPath) }
      })
    }
    return null
  }

  private sessionIdOf(request: ExternalAgentBrokerRequest): string | undefined {
    if (!('input' in request) || !request.input || typeof request.input !== 'object')
      return undefined
    const sessionId = (request.input as { sessionId?: unknown }).sessionId
    return typeof sessionId === 'string' ? sessionId : undefined
  }

  private async readOperation(
    agentId: string,
    operationId: string
  ): Promise<BrokerResponse<unknown>> {
    const record = await this.operations?.get(operationId)
    if (!record) {
      return fail(
        createExternalAgentError({
          code: 'OPERATION_NOT_FOUND',
          message: `未找到 operation: ${operationId}`,
          details: { operationId }
        })
      )
    }
    if (record.agentId !== agentId) {
      return fail(
        createExternalAgentError({
          code: 'NOT_AUTHORIZED',
          message: '只能查询自己发起的 operation',
          details: { operationId }
        })
      )
    }
    return { ok: true, data: toOperationSummary(record), operationId: record.id }
  }

  private async readEvents(
    agentId: string,
    operationId: string,
    afterSequence: number,
    limit: number
  ): Promise<BrokerResponse<unknown>> {
    const record = await this.operations?.get(operationId)
    if (!record) {
      return fail(
        createExternalAgentError({
          code: 'OPERATION_NOT_FOUND',
          message: `未找到 operation: ${operationId}`,
          details: { operationId }
        })
      )
    }
    if (record.agentId !== agentId) {
      return fail(
        createExternalAgentError({
          code: 'NOT_AUTHORIZED',
          message: '只能查询自己发起的 operation 事件',
          details: { operationId }
        })
      )
    }
    const events = await this.operations?.listEvents(operationId, afterSequence, limit)
    return {
      ok: true,
      data: { events: events ?? [], nextSequence: events?.at(-1)?.sequence ?? afterSequence },
      operationId
    }
  }

  private async cancelOperation(
    agentId: string,
    request: Extract<ExternalAgentBrokerRequest, { type: 'cancel_operation' }>
  ): Promise<BrokerResponse<unknown>> {
    const current = await this.operations?.get(request.input.operationId)
    const result = await this.operations?.cancel({
      operationId: request.input.operationId,
      agentId,
      reason: request.input.reason
    })
    if (!result) {
      return fail(
        createExternalAgentError({
          code: 'VALIDATION_FAILED',
          message: 'operation 服务未就绪'
        })
      )
    }
    if (isErrorPayload(result)) return fail(result, request.input.operationId)
    if (current?.sessionId) {
      await this.executor?.cancelProduct(current.sessionId)
      this.executor?.kick(current.sessionId)
    }
    return { ok: true, data: toOperationSummary(result), operationId: result.id }
  }

  async resolveConfirmation(operationId: string, approved: boolean): Promise<boolean> {
    if (!this.operations) return false
    const current = await this.operations.get(operationId)
    if (!current || current.status !== 'awaiting_confirmation') return false
    if (!approved) {
      await this.operations.transition({
        operationId,
        to: 'rejected',
        errorCode: 'CONFIRMATION_REJECTED',
        payload: { reason: 'user_rejected' }
      })
      return true
    }
    const access = await this.authService.checkAccess({
      agentId: current.agentId,
      sessionId: current.sessionId
    })
    if (!access.authorized) {
      await this.operations.transition({
        operationId,
        to: 'revoked',
        errorCode: access.error?.code ?? 'AUTH_REVOKED',
        payload: { reason: 'revoked_before_confirm' }
      })
      return true
    }
    const queued = await this.operations.transition({
      operationId,
      to: 'queued',
      payload: { confirmed: true }
    })
    if (isErrorPayload(queued)) return false
    this.executor?.kick(queued.sessionId)
    return true
  }

  private async beginConfirmation(operationId: string): Promise<void> {
    if (!this.operations) return
    const prompt = await this.buildConfirmationPrompt(operationId)
    if (!prompt) {
      await this.operations.transition({
        operationId,
        to: 'failed',
        errorCode: 'VALIDATION_FAILED',
        payload: { message: '无法展示确认弹窗' }
      })
      return
    }
    if (!this.promptConfirmation) return
    const timeout = new Promise<'expired'>((resolve) => {
      setTimeout(() => resolve('expired'), EXTERNAL_AGENT_CONFIRMATION_TIMEOUT_MS)
    })
    const decision = await Promise.race([this.promptConfirmation(prompt), timeout])
    const current = await this.operations.get(operationId)
    if (!current || current.status !== 'awaiting_confirmation') return
    if (decision === 'expired') {
      await this.operations.transition({
        operationId,
        to: 'expired',
        errorCode: 'CONFIRMATION_EXPIRED',
        payload: { reason: 'timeout' }
      })
      return
    }
    await this.resolveConfirmation(operationId, decision)
  }

  private async buildConfirmationPrompt(
    operationId: string
  ): Promise<ExternalAgentConfirmationPrompt | null> {
    const record = await this.operations?.get(operationId)
    if (!record?.requestJson) return null
    let parsed: ExternalAgentBrokerRequest
    try {
      parsed = JSON.parse(record.requestJson) as ExternalAgentBrokerRequest
    } catch {
      return null
    }
    const agent = await this.authService.getAgent(record.agentId)
    const sessionId = record.sessionId
    const lookup = sessionId ? await this.dataSource.getSessionWithPages(sessionId) : null
    const sessionTitle = lookup?.session?.title || sessionId
    if (parsed.type === 'delete_page') {
      const page = lookup?.pages?.find((item) => (item.page_id || item.id) === parsed.input.pageId)
      return {
        operationId,
        agentId: record.agentId,
        agentName: agent?.name || record.agentId,
        kind: 'delete_page',
        sessionId,
        sessionTitle,
        pageId: parsed.input.pageId,
        pageTitle: page?.title,
        pageNumber: page?.pageNumber,
        irreversible: true
      }
    }
    if (parsed.type === 'delete_session') {
      return {
        operationId,
        agentId: record.agentId,
        agentName: agent?.name || record.agentId,
        kind: 'delete_session',
        sessionId,
        sessionTitle,
        irreversible: true
      }
    }
    if (parsed.type === 'export_pptx' && parsed.input.overwrite === true) {
      return {
        operationId,
        agentId: record.agentId,
        agentName: agent?.name || record.agentId,
        kind: 'overwrite_export',
        sessionId,
        sessionTitle,
        outputPath: parsed.input.outputPath,
        irreversible: true
      }
    }
    return null
  }

  private async resumeOperation(
    agentId: string,
    request: Extract<ExternalAgentBrokerRequest, { type: 'resume_operation' }>
  ): Promise<BrokerResponse<unknown>> {
    const current = await this.operations?.get(request.input.operationId)
    if (!current) {
      return fail(
        createExternalAgentError({
          code: 'OPERATION_NOT_FOUND',
          message: `未找到 operation: ${request.input.operationId}`,
          details: { operationId: request.input.operationId }
        })
      )
    }
    if (current.agentId !== agentId) {
      return fail(
        createExternalAgentError({
          code: 'NOT_AUTHORIZED',
          message: '只能恢复自己发起的 operation',
          details: { operationId: current.id }
        })
      )
    }
    if (!current.resumable || current.status !== 'interrupted') {
      return fail(
        createExternalAgentError({
          code: 'OPERATION_NOT_RESUMABLE',
          message: '该 operation 不可恢复',
          details: { operationId: current.id, status: current.status }
        }),
        current.id
      )
    }
    const resumed = await this.operations?.transition({
      operationId: current.id,
      to: 'queued',
      payload: { resumedWith: request.input.idempotencyKey }
    })
    if (!resumed || isErrorPayload(resumed)) {
      return fail(
        isErrorPayload(resumed)
          ? resumed
          : createExternalAgentError({
              code: 'VALIDATION_FAILED',
              message: '恢复 operation 失败'
            }),
        current.id
      )
    }
    this.executor?.kick(resumed.sessionId)
    return { ok: true, data: toOperationSummary(resumed), operationId: resumed.id }
  }
}
