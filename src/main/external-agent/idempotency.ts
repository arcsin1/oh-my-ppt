import crypto from 'crypto'
import { createExternalAgentError, type ExternalAgentErrorPayload } from '@shared/external-agent'

export interface IdempotencyRecord {
  idempotencyKey: string
  agentId: string
  requestHash: string
  operationId: string
  status: string
  responseSnapshot?: unknown
  createdAt: string
  updatedAt: string
}

export interface ExternalAgentIdempotencyStore {
  get(agentId: string, key: string): Promise<IdempotencyRecord | null>
  save(record: IdempotencyRecord): Promise<void>
}

export class InMemoryExternalAgentIdempotencyStore implements ExternalAgentIdempotencyStore {
  private records = new Map<string, IdempotencyRecord>()

  private compoundKey(agentId: string, key: string): string {
    return `${agentId}:${key}`
  }

  async get(agentId: string, key: string): Promise<IdempotencyRecord | null> {
    return this.records.get(this.compoundKey(agentId, key)) ?? null
  }

  async save(record: IdempotencyRecord): Promise<void> {
    this.records.set(this.compoundKey(record.agentId, record.idempotencyKey), record)
  }
}

export function computeRequestHash(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return crypto.createHash('sha256').update(String(payload)).digest('hex')
  }
  const keys = Object.keys(payload as object).sort()
  const sortedObj: Record<string, unknown> = {}
  for (const k of keys) {
    sortedObj[k] = (payload as Record<string, unknown>)[k]
  }
  return crypto.createHash('sha256').update(JSON.stringify(sortedObj)).digest('hex')
}

export interface IdempotencyCheckResult {
  ok: boolean
  isReplay?: boolean
  record?: IdempotencyRecord
  error?: ExternalAgentErrorPayload
}

export class ExternalAgentIdempotencyService {
  constructor(private store: ExternalAgentIdempotencyStore) {}

  async checkOrReserve(args: {
    agentId: string
    idempotencyKey: string
    payload: unknown
    newOperationId: string
  }): Promise<IdempotencyCheckResult> {
    const { agentId, idempotencyKey, payload, newOperationId } = args

    if (!idempotencyKey || !idempotencyKey.trim()) {
      return {
        ok: false,
        error: createExternalAgentError({
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: '缺少幂等键 idempotencyKey'
        })
      }
    }

    const currentHash = computeRequestHash(payload)
    const existing = await this.store.get(agentId, idempotencyKey)

    if (existing) {
      if (existing.requestHash !== currentHash) {
        return {
          ok: false,
          error: createExternalAgentError({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: `幂等键 ${idempotencyKey} 已被其他请求使用`,
            details: {
              idempotencyKey,
              existingOperationId: existing.operationId
            }
          })
        }
      }

      return {
        ok: true,
        isReplay: true,
        record: existing
      }
    }

    const now = new Date().toISOString()
    const newRecord: IdempotencyRecord = {
      idempotencyKey,
      agentId,
      requestHash: currentHash,
      operationId: newOperationId,
      status: 'reserved',
      createdAt: now,
      updatedAt: now
    }
    await this.store.save(newRecord)

    return {
      ok: true,
      isReplay: false,
      record: newRecord
    }
  }

  async updateSnapshot(args: {
    agentId: string
    idempotencyKey: string
    status: string
    responseSnapshot?: unknown
  }): Promise<void> {
    const existing = await this.store.get(args.agentId, args.idempotencyKey)
    if (existing) {
      existing.status = args.status
      existing.responseSnapshot = args.responseSnapshot
      existing.updatedAt = new Date().toISOString()
      await this.store.save(existing)
    }
  }
}
