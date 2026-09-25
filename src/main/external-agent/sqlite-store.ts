import { and, asc, eq, gt, inArray, isNull, max } from 'drizzle-orm'
import type { drizzle } from 'drizzle-orm/libsql'
import { nanoid } from 'nanoid'
import {
  EXTERNAL_AGENT_CAPABILITIES,
  EXTERNAL_AGENT_ERROR_CODES,
  EXTERNAL_AGENT_EVENT_TYPES,
  EXTERNAL_AGENT_OPERATION_STATUSES,
  EXTERNAL_AGENT_TOOL_NAMES,
  type ExternalAgentCapability,
  type ExternalAgentErrorCode,
  type ExternalAgentEventType,
  type ExternalAgentOperationStatus,
  type ExternalAgentToolName
} from '@shared/external-agent'
import * as schema from '../db/schema'
import type {
  ExternalAgentAuthorizationStore,
  ExternalAgentGrantRecord,
  ExternalAgentRecord
} from './authorization'
import type { ExternalAgentIdempotencyStore, IdempotencyRecord } from './idempotency'
import type {
  ExternalAgentEventRecord,
  ExternalAgentOperationRecord,
  ExternalAgentOperationStore
} from './operations'

type DrizzleDb = ReturnType<typeof drizzle>

const toMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

const toIso = (ms: number | null | undefined): string | undefined => {
  if (ms === null || ms === undefined) return undefined
  return new Date(ms).toISOString()
}

const parseJsonArray = (raw: string | null | undefined): string[] => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

const parseCapabilities = (raw: string | null | undefined): ExternalAgentCapability[] => {
  const allowed = new Set<string>(EXTERNAL_AGENT_CAPABILITIES)
  return parseJsonArray(raw).filter((item): item is ExternalAgentCapability => allowed.has(item))
}

const isToolName = (value: string): value is ExternalAgentToolName =>
  (EXTERNAL_AGENT_TOOL_NAMES as readonly string[]).includes(value)

const isStatus = (value: string): value is ExternalAgentOperationStatus =>
  (EXTERNAL_AGENT_OPERATION_STATUSES as readonly string[]).includes(value)

const isEventType = (value: string): value is ExternalAgentEventType =>
  (EXTERNAL_AGENT_EVENT_TYPES as readonly string[]).includes(value)

const isErrorCode = (value: string): value is ExternalAgentErrorCode =>
  (EXTERNAL_AGENT_ERROR_CODES as readonly string[]).includes(value)

const mapAgent = (row: typeof schema.externalAgents.$inferSelect): ExternalAgentRecord => ({
  id: row.id,
  name: row.name,
  version: row.version,
  executablePath: row.executablePath ?? undefined,
  credentialId: row.credentialId,
  lastUsedAt: toIso(row.lastUsedAt),
  revokedAt: toIso(row.revokedAt),
  createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
  updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString()
})

const mapGrant = (
  row: typeof schema.externalAgentGrants.$inferSelect
): ExternalAgentGrantRecord => ({
  id: row.id,
  agentId: row.agentId,
  capabilities: parseCapabilities(row.capabilitiesJson),
  sessionIds: parseJsonArray(row.sessionIdsJson),
  workspaceRoots: parseJsonArray(row.workspaceRootsJson),
  lastUsedAt: toIso(row.lastUsedAt),
  revokedAt: toIso(row.revokedAt),
  createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
  updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString()
})

const mapOperation = (
  row: typeof schema.externalAgentOperations.$inferSelect
): ExternalAgentOperationRecord | null => {
  if (!isToolName(row.toolName) || !isStatus(row.status)) return null
  return {
    id: row.id,
    agentId: row.agentId,
    sessionId: row.sessionId ?? undefined,
    toolName: row.toolName,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    requestJson: row.requestJson ?? undefined,
    status: row.status,
    progress: row.progress,
    checkpoint: row.checkpoint ?? undefined,
    resultRef: row.resultRef ?? undefined,
    errorCode: row.errorCode && isErrorCode(row.errorCode) ? row.errorCode : undefined,
    resumable: Boolean(row.resumable),
    createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
    updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString()
  }
}

export class SqliteExternalAgentStore
  implements
    ExternalAgentAuthorizationStore,
    ExternalAgentOperationStore,
    ExternalAgentIdempotencyStore
{
  constructor(private db: DrizzleDb) {}

  async getAgent(agentId: string): Promise<ExternalAgentRecord | null> {
    const row = await this.db
      .select()
      .from(schema.externalAgents)
      .where(eq(schema.externalAgents.id, agentId))
      .get()
    return row ? mapAgent(row) : null
  }

  async getGrant(agentId: string): Promise<ExternalAgentGrantRecord | null> {
    const row = await this.db
      .select()
      .from(schema.externalAgentGrants)
      .where(eq(schema.externalAgentGrants.agentId, agentId))
      .get()
    return row ? mapGrant(row) : null
  }

  async listAgents(): Promise<ExternalAgentRecord[]> {
    const rows = await this.db.select().from(schema.externalAgents).all()
    return rows.map(mapAgent)
  }

  async listGrants(): Promise<ExternalAgentGrantRecord[]> {
    const rows = await this.db.select().from(schema.externalAgentGrants).all()
    return rows.map(mapGrant)
  }

  async saveAgent(agent: ExternalAgentRecord): Promise<void> {
    const values = {
      id: agent.id,
      name: agent.name,
      version: agent.version,
      executablePath: agent.executablePath ?? null,
      credentialId: agent.credentialId ?? null,
      createdAt: toMs(agent.createdAt) ?? Date.now(),
      updatedAt: toMs(agent.updatedAt) ?? Date.now(),
      lastUsedAt: toMs(agent.lastUsedAt ?? null),
      revokedAt: toMs(agent.revokedAt ?? null)
    }
    await this.db
      .insert(schema.externalAgents)
      .values(values)
      .onConflictDoUpdate({
        target: schema.externalAgents.id,
        set: {
          name: values.name,
          version: values.version,
          executablePath: values.executablePath,
          credentialId: values.credentialId,
          updatedAt: values.updatedAt,
          lastUsedAt: values.lastUsedAt,
          revokedAt: values.revokedAt
        }
      })
      .run()
  }

  async saveGrant(grant: ExternalAgentGrantRecord): Promise<void> {
    const values = {
      id: grant.id,
      agentId: grant.agentId,
      capabilitiesJson: JSON.stringify(grant.capabilities),
      sessionIdsJson: JSON.stringify(grant.sessionIds),
      workspaceRootsJson: JSON.stringify(grant.workspaceRoots),
      createdAt: toMs(grant.createdAt) ?? Date.now(),
      updatedAt: toMs(grant.updatedAt) ?? Date.now(),
      lastUsedAt: toMs(grant.lastUsedAt ?? null),
      revokedAt: toMs(grant.revokedAt ?? null)
    }
    await this.db
      .insert(schema.externalAgentGrants)
      .values(values)
      .onConflictDoUpdate({
        target: schema.externalAgentGrants.agentId,
        set: {
          capabilitiesJson: values.capabilitiesJson,
          sessionIdsJson: values.sessionIdsJson,
          workspaceRootsJson: values.workspaceRootsJson,
          updatedAt: values.updatedAt,
          lastUsedAt: values.lastUsedAt,
          revokedAt: values.revokedAt
        }
      })
      .run()
  }

  async revokeAgent(agentId: string): Promise<void> {
    const now = Date.now()
    await this.db
      .update(schema.externalAgents)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(schema.externalAgents.id, agentId))
      .run()
  }

  async revokeGrant(agentId: string): Promise<void> {
    const now = Date.now()
    await this.db
      .update(schema.externalAgentGrants)
      .set({ revokedAt: now, updatedAt: now })
      .where(eq(schema.externalAgentGrants.agentId, agentId))
      .run()
  }

  async touchLastUsed(agentId: string, at: string): Promise<void> {
    const ms = toMs(at) ?? Date.now()
    await this.db
      .update(schema.externalAgents)
      .set({ lastUsedAt: ms, updatedAt: ms })
      .where(eq(schema.externalAgents.id, agentId))
      .run()
    await this.db
      .update(schema.externalAgentGrants)
      .set({ lastUsedAt: ms, updatedAt: ms })
      .where(eq(schema.externalAgentGrants.agentId, agentId))
      .run()
  }

  async get(agentId: string, key: string): Promise<IdempotencyRecord | null> {
    const record = await this.getByIdempotency(agentId, key)
    if (!record) return null
    return {
      idempotencyKey: record.idempotencyKey,
      agentId: record.agentId,
      requestHash: record.requestHash,
      operationId: record.id,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  }

  async save(record: IdempotencyRecord): Promise<void> {
    const existing = await this.getOperation(record.operationId)
    if (!existing) return
    await this.saveOperation({
      ...existing,
      idempotencyKey: record.idempotencyKey,
      requestHash: record.requestHash,
      updatedAt: record.updatedAt
    })
  }

  async getOperation(operationId: string): Promise<ExternalAgentOperationRecord | null> {
    const row = await this.db
      .select()
      .from(schema.externalAgentOperations)
      .where(eq(schema.externalAgentOperations.id, operationId))
      .get()
    return row ? mapOperation(row) : null
  }

  async getByIdempotency(
    agentId: string,
    idempotencyKey: string
  ): Promise<ExternalAgentOperationRecord | null> {
    const row = await this.db
      .select()
      .from(schema.externalAgentOperations)
      .where(
        and(
          eq(schema.externalAgentOperations.agentId, agentId),
          eq(schema.externalAgentOperations.idempotencyKey, idempotencyKey)
        )
      )
      .get()
    return row ? mapOperation(row) : null
  }

  async saveOperation(record: ExternalAgentOperationRecord): Promise<void> {
    const values = {
      id: record.id,
      agentId: record.agentId,
      sessionId: record.sessionId ?? null,
      toolName: record.toolName,
      idempotencyKey: record.idempotencyKey,
      requestHash: record.requestHash,
      requestJson: record.requestJson ?? '{}',
      status: record.status,
      progress: Math.round(record.progress),
      checkpoint: record.checkpoint ?? null,
      resultRef: record.resultRef ?? null,
      errorCode: record.errorCode ?? null,
      resumable: record.resumable ? 1 : 0,
      createdAt: toMs(record.createdAt) ?? Date.now(),
      updatedAt: toMs(record.updatedAt) ?? Date.now()
    }
    await this.db
      .insert(schema.externalAgentOperations)
      .values(values)
      .onConflictDoUpdate({
        target: schema.externalAgentOperations.id,
        set: {
          sessionId: values.sessionId,
          toolName: values.toolName,
          idempotencyKey: values.idempotencyKey,
          requestHash: values.requestHash,
          requestJson: values.requestJson,
          status: values.status,
          progress: values.progress,
          checkpoint: values.checkpoint,
          resultRef: values.resultRef,
          errorCode: values.errorCode,
          resumable: values.resumable,
          updatedAt: values.updatedAt
        }
      })
      .run()
  }

  async listQueued(sessionId?: string): Promise<ExternalAgentOperationRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.externalAgentOperations)
      .where(
        and(
          sessionId
            ? eq(schema.externalAgentOperations.sessionId, sessionId)
            : isNull(schema.externalAgentOperations.sessionId),
          eq(schema.externalAgentOperations.status, 'queued')
        )
      )
      .orderBy(
        asc(schema.externalAgentOperations.createdAt),
        asc(schema.externalAgentOperations.id)
      )
      .all()
    const mapped = rows
      .map(mapOperation)
      .filter((row): row is ExternalAgentOperationRecord => Boolean(row))
    if (sessionId) return mapped
    return mapped.filter((row) => !row.sessionId)
  }

  async listRunning(sessionId?: string): Promise<ExternalAgentOperationRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.externalAgentOperations)
      .where(
        and(
          sessionId
            ? eq(schema.externalAgentOperations.sessionId, sessionId)
            : isNull(schema.externalAgentOperations.sessionId),
          eq(schema.externalAgentOperations.status, 'running')
        )
      )
      .all()
    const mapped = rows
      .map(mapOperation)
      .filter((row): row is ExternalAgentOperationRecord => Boolean(row))
    if (sessionId) return mapped
    return mapped.filter((row) => !row.sessionId)
  }

  async listAwaitingConfirmation(): Promise<ExternalAgentOperationRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.externalAgentOperations)
      .where(eq(schema.externalAgentOperations.status, 'awaiting_confirmation'))
      .orderBy(
        asc(schema.externalAgentOperations.createdAt),
        asc(schema.externalAgentOperations.id)
      )
      .all()
    return rows.map(mapOperation).filter((row): row is ExternalAgentOperationRecord => Boolean(row))
  }

  async listActiveByAgent(agentId: string): Promise<ExternalAgentOperationRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.externalAgentOperations)
      .where(
        and(
          eq(schema.externalAgentOperations.agentId, agentId),
          inArray(schema.externalAgentOperations.status, [
            'queued',
            'running',
            'awaiting_confirmation'
          ])
        )
      )
      .all()
    return rows.map(mapOperation).filter((row): row is ExternalAgentOperationRecord => Boolean(row))
  }

  async appendEvent(event: ExternalAgentEventRecord): Promise<void> {
    await this.db
      .insert(schema.externalAgentEvents)
      .values({
        id: event.id || nanoid(),
        operationId: event.operationId,
        sequence: event.sequence,
        type: event.type,
        payloadJson: JSON.stringify(event.payload ?? {}),
        occurredAt: toMs(event.occurredAt) ?? Date.now()
      })
      .run()
  }

  async listEvents(
    operationId: string,
    afterSequence: number,
    limit: number
  ): Promise<ExternalAgentEventRecord[]> {
    const rows = await this.db
      .select()
      .from(schema.externalAgentEvents)
      .where(
        and(
          eq(schema.externalAgentEvents.operationId, operationId),
          gt(schema.externalAgentEvents.sequence, afterSequence)
        )
      )
      .orderBy(asc(schema.externalAgentEvents.sequence))
      .limit(limit)
      .all()
    return rows.flatMap((row) => {
      if (!isEventType(row.type)) return []
      let payload: ExternalAgentEventRecord['payload'] = {}
      try {
        const parsed = JSON.parse(row.payloadJson) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          payload = parsed as ExternalAgentEventRecord['payload']
        }
      } catch {
        payload = {}
      }
      return [
        {
          id: row.id,
          operationId: row.operationId,
          sequence: row.sequence,
          type: row.type,
          occurredAt: toIso(row.occurredAt) ?? new Date(0).toISOString(),
          payload
        }
      ]
    })
  }

  async nextSequence(operationId: string): Promise<number> {
    const row = await this.db
      .select({ value: max(schema.externalAgentEvents.sequence) })
      .from(schema.externalAgentEvents)
      .where(eq(schema.externalAgentEvents.operationId, operationId))
      .get()
    return (row?.value ?? 0) + 1
  }
}
