import { nanoid } from 'nanoid'
import {
  createExternalAgentError,
  sanitizeErrorDetails,
  type ExternalAgentErrorCode,
  type ExternalAgentErrorPayload,
  type ExternalAgentEvent,
  type ExternalAgentEventType,
  type ExternalAgentOperationStatus,
  type ExternalAgentOperationSummary,
  type ExternalAgentSafeDetails,
  type ExternalAgentToolName
} from '@shared/external-agent'

export interface ExternalAgentOperationRecord {
  id: string
  agentId: string
  sessionId?: string
  toolName: ExternalAgentToolName
  idempotencyKey: string
  requestHash: string
  requestJson?: string
  status: ExternalAgentOperationStatus
  progress: number
  checkpoint?: string
  resultRef?: string
  errorCode?: ExternalAgentErrorCode
  resumable: boolean
  createdAt: string
  updatedAt: string
}

export interface ExternalAgentEventRecord extends ExternalAgentEvent {
  id: string
}

export interface ExternalAgentOperationStore {
  getOperation(operationId: string): Promise<ExternalAgentOperationRecord | null>
  getByIdempotency(
    agentId: string,
    idempotencyKey: string
  ): Promise<ExternalAgentOperationRecord | null>
  saveOperation(record: ExternalAgentOperationRecord): Promise<void>
  listQueued(sessionId?: string): Promise<ExternalAgentOperationRecord[]>
  listRunning(sessionId?: string): Promise<ExternalAgentOperationRecord[]>
  listAwaitingConfirmation(): Promise<ExternalAgentOperationRecord[]>
  listActiveByAgent(agentId: string): Promise<ExternalAgentOperationRecord[]>
  appendEvent(event: ExternalAgentEventRecord): Promise<void>
  listEvents(
    operationId: string,
    afterSequence: number,
    limit: number
  ): Promise<ExternalAgentEventRecord[]>
  nextSequence(operationId: string): Promise<number>
}

export class InMemoryExternalAgentOperationStore implements ExternalAgentOperationStore {
  private operations = new Map<string, ExternalAgentOperationRecord>()
  private events = new Map<string, ExternalAgentEventRecord[]>()

  async getOperation(operationId: string): Promise<ExternalAgentOperationRecord | null> {
    return this.operations.get(operationId) ?? null
  }

  async getByIdempotency(
    agentId: string,
    idempotencyKey: string
  ): Promise<ExternalAgentOperationRecord | null> {
    for (const record of this.operations.values()) {
      if (record.agentId === agentId && record.idempotencyKey === idempotencyKey) return record
    }
    return null
  }

  async saveOperation(record: ExternalAgentOperationRecord): Promise<void> {
    this.operations.set(record.id, { ...record })
  }

  async listQueued(sessionId?: string): Promise<ExternalAgentOperationRecord[]> {
    return [...this.operations.values()]
      .filter(
        (record) =>
          record.status === 'queued' &&
          (sessionId ? record.sessionId === sessionId : !record.sessionId)
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  async listRunning(sessionId?: string): Promise<ExternalAgentOperationRecord[]> {
    return [...this.operations.values()].filter(
      (record) =>
        record.status === 'running' &&
        (sessionId ? record.sessionId === sessionId : !record.sessionId)
    )
  }

  async listAwaitingConfirmation(): Promise<ExternalAgentOperationRecord[]> {
    return [...this.operations.values()]
      .filter((record) => record.status === 'awaiting_confirmation')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  }

  async listActiveByAgent(agentId: string): Promise<ExternalAgentOperationRecord[]> {
    return [...this.operations.values()].filter(
      (record) =>
        record.agentId === agentId &&
        (record.status === 'queued' ||
          record.status === 'running' ||
          record.status === 'awaiting_confirmation')
    )
  }

  async appendEvent(event: ExternalAgentEventRecord): Promise<void> {
    const list = this.events.get(event.operationId) ?? []
    list.push(event)
    this.events.set(event.operationId, list)
  }

  async listEvents(
    operationId: string,
    afterSequence: number,
    limit: number
  ): Promise<ExternalAgentEventRecord[]> {
    return (this.events.get(operationId) ?? [])
      .filter((event) => event.sequence > afterSequence)
      .sort((a, b) => a.sequence - b.sequence)
      .slice(0, limit)
  }

  async nextSequence(operationId: string): Promise<number> {
    const list = this.events.get(operationId) ?? []
    return list.reduce((max, event) => Math.max(max, event.sequence), 0) + 1
  }
}

const ACTIVE_STATUSES: readonly ExternalAgentOperationStatus[] = [
  'queued',
  'running',
  'awaiting_confirmation'
]

const TERMINAL_STATUSES: readonly ExternalAgentOperationStatus[] = [
  'completed',
  'partial',
  'failed',
  'cancelled',
  'interrupted',
  'rejected',
  'expired',
  'revoked'
]

const ALLOWED_TRANSITIONS: Record<ExternalAgentOperationStatus, ExternalAgentOperationStatus[]> = {
  queued: ['running', 'awaiting_confirmation', 'cancelled', 'interrupted', 'revoked', 'failed'],
  running: [
    'completed',
    'partial',
    'failed',
    'cancelled',
    'interrupted',
    'awaiting_confirmation',
    'queued',
    'revoked'
  ],
  awaiting_confirmation: [
    'queued',
    'running',
    'rejected',
    'expired',
    'revoked',
    'cancelled',
    'interrupted'
  ],
  completed: [],
  partial: [],
  failed: [],
  cancelled: [],
  interrupted: ['queued'],
  rejected: [],
  expired: [],
  revoked: []
}

export function canTransition(
  from: ExternalAgentOperationStatus,
  to: ExternalAgentOperationStatus
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

function eventTypeForStatus(status: ExternalAgentOperationStatus): ExternalAgentEventType {
  if (status === 'running') return 'started'
  if (status === 'awaiting_confirmation') return 'confirmation_required'
  if (status === 'rejected' || status === 'expired') return 'failed'
  return status
}

export function toOperationSummary(
  record: ExternalAgentOperationRecord
): ExternalAgentOperationSummary {
  return {
    operationId: record.id,
    agentId: record.agentId,
    sessionId: record.sessionId,
    toolName: record.toolName,
    status: record.status,
    progress: record.progress,
    checkpoint: record.checkpoint,
    resultRef: record.resultRef,
    errorCode: record.errorCode,
    resumable: record.resumable,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  }
}

export class ExternalAgentOperationService {
  constructor(private store: ExternalAgentOperationStore) {}

  async enqueue(args: {
    agentId: string
    sessionId?: string
    toolName: ExternalAgentToolName
    idempotencyKey: string
    requestHash: string
    requestJson?: string
    initialStatus?: Extract<ExternalAgentOperationStatus, 'queued' | 'awaiting_confirmation'>
  }): Promise<ExternalAgentOperationRecord> {
    const now = new Date().toISOString()
    const record: ExternalAgentOperationRecord = {
      id: nanoid(),
      agentId: args.agentId,
      sessionId: args.sessionId,
      toolName: args.toolName,
      idempotencyKey: args.idempotencyKey,
      requestHash: args.requestHash,
      requestJson: args.requestJson,
      status: args.initialStatus ?? 'queued',
      progress: 0,
      resumable: false,
      createdAt: now,
      updatedAt: now
    }
    await this.store.saveOperation(record)
    await this.appendEvent(record.id, eventTypeForStatus(record.status), {
      toolName: args.toolName,
      sessionId: args.sessionId ?? null
    })
    return record
  }

  get(operationId: string): Promise<ExternalAgentOperationRecord | null> {
    return this.store.getOperation(operationId)
  }

  getByIdempotency(
    agentId: string,
    idempotencyKey: string
  ): Promise<ExternalAgentOperationRecord | null> {
    return this.store.getByIdempotency(agentId, idempotencyKey)
  }

  listEvents(
    operationId: string,
    afterSequence = 0,
    limit = 50
  ): Promise<ExternalAgentEventRecord[]> {
    return this.store.listEvents(operationId, afterSequence, limit)
  }

  async transition(args: {
    operationId: string
    to: ExternalAgentOperationStatus
    progress?: number
    checkpoint?: string
    resultRef?: string
    sessionId?: string
    errorCode?: ExternalAgentErrorCode
    resumable?: boolean
    eventType?: ExternalAgentEventType
    payload?: ExternalAgentSafeDetails
  }): Promise<ExternalAgentOperationRecord | ExternalAgentErrorPayload> {
    const current = await this.store.getOperation(args.operationId)
    if (!current) {
      return createExternalAgentError({
        code: 'OPERATION_NOT_FOUND',
        message: `未找到 operation: ${args.operationId}`,
        details: { operationId: args.operationId }
      })
    }
    if (current.status === args.to) {
      const patched: ExternalAgentOperationRecord = {
        ...current,
        sessionId: args.sessionId ?? current.sessionId,
        progress: args.progress ?? current.progress,
        checkpoint: args.checkpoint ?? current.checkpoint,
        resultRef: args.resultRef ?? current.resultRef,
        errorCode: args.errorCode ?? current.errorCode,
        resumable: args.resumable ?? current.resumable,
        updatedAt: new Date().toISOString()
      }
      await this.store.saveOperation(patched)
      if (args.eventType) {
        await this.appendEvent(patched.id, args.eventType, args.payload)
      }
      return patched
    }
    if (!canTransition(current.status, args.to)) {
      return createExternalAgentError({
        code: 'VALIDATION_FAILED',
        message: `operation 不能从 ${current.status} 转到 ${args.to}`,
        details: { from: current.status, to: args.to }
      })
    }

    const next: ExternalAgentOperationRecord = {
      ...current,
      status: args.to,
      sessionId: args.sessionId ?? current.sessionId,
      progress: args.progress ?? current.progress,
      checkpoint: args.checkpoint ?? current.checkpoint,
      resultRef: args.resultRef ?? current.resultRef,
      errorCode: args.errorCode ?? current.errorCode,
      resumable: args.resumable ?? args.to === 'interrupted',
      updatedAt: new Date().toISOString()
    }
    await this.store.saveOperation(next)
    await this.appendEvent(
      next.id,
      args.eventType ?? eventTypeForStatus(args.to),
      args.payload ?? { status: args.to }
    )
    return next
  }

  listRunning(sessionId?: string): Promise<ExternalAgentOperationRecord[]> {
    return this.store.listRunning(sessionId)
  }

  listAwaitingConfirmation(): Promise<ExternalAgentOperationRecord[]> {
    return this.store.listAwaitingConfirmation()
  }

  async peekQueued(sessionId?: string): Promise<ExternalAgentOperationRecord | null> {
    const queued = await this.store.listQueued(sessionId)
    return queued[0] ?? null
  }

  async dequeueNext(sessionId?: string): Promise<ExternalAgentOperationRecord | null> {
    const queued = await this.store.listQueued(sessionId)
    const next = queued[0]
    if (!next) return null
    const started = await this.transition({
      operationId: next.id,
      to: 'running',
      eventType: 'started',
      payload: { sessionId: sessionId || null }
    })
    return 'id' in started ? started : null
  }

  async cancel(args: {
    operationId: string
    agentId: string
    reason?: string
  }): Promise<ExternalAgentOperationRecord | ExternalAgentErrorPayload> {
    const current = await this.store.getOperation(args.operationId)
    if (!current) {
      return createExternalAgentError({
        code: 'OPERATION_NOT_FOUND',
        message: `未找到 operation: ${args.operationId}`,
        details: { operationId: args.operationId }
      })
    }
    if (current.agentId !== args.agentId) {
      return createExternalAgentError({
        code: 'NOT_AUTHORIZED',
        message: '只能取消自己发起的 operation',
        details: { operationId: args.operationId }
      })
    }
    if ((TERMINAL_STATUSES as readonly string[]).includes(current.status)) {
      return current
    }
    return this.transition({
      operationId: current.id,
      to: 'cancelled',
      payload: { reason: args.reason ?? null }
    })
  }

  async interruptActive(operationId: string, checkpoint?: string): Promise<void> {
    const current = await this.store.getOperation(operationId)
    if (!current || !(ACTIVE_STATUSES as readonly string[]).includes(current.status)) return
    await this.transition({
      operationId,
      to: 'interrupted',
      checkpoint,
      resumable: Boolean(checkpoint),
      payload: { checkpoint: checkpoint ?? null }
    })
  }

  async revokeAgentOperations(agentId: string, sessionIds?: string[]): Promise<string[]> {
    const active = await this.store.listActiveByAgent(agentId)
    const targets =
      sessionIds === undefined
        ? active
        : active.filter(
            (record) => record.sessionId != null && sessionIds.includes(record.sessionId)
          )
    const revokedSessionIds = [
      ...new Set(
        targets.map((record) => record.sessionId).filter((id): id is string => Boolean(id))
      )
    ]
    for (const record of targets) {
      await this.transition({
        operationId: record.id,
        to: 'revoked',
        payload: { agentId }
      })
    }
    return revokedSessionIds
  }

  async markShuttingDown(sessionIds: string[]): Promise<void> {
    for (const sessionId of sessionIds) {
      const queued = await this.store.listQueued(sessionId)
      for (const record of queued) {
        await this.interruptActive(record.id, 'shutdown')
      }
    }
  }

  private async appendEvent(
    operationId: string,
    type: ExternalAgentEventType,
    payload?: ExternalAgentSafeDetails
  ): Promise<ExternalAgentEventRecord> {
    const sequence = await this.store.nextSequence(operationId)
    const event: ExternalAgentEventRecord = {
      id: nanoid(),
      operationId,
      sequence,
      type,
      occurredAt: new Date().toISOString(),
      payload: sanitizeErrorDetails(payload)
    }
    await this.store.appendEvent(event)
    return event
  }
}
