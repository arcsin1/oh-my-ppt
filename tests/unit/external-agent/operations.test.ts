import { describe, expect, it, beforeEach } from 'vitest'
import {
  ExternalAgentOperationService,
  InMemoryExternalAgentOperationStore,
  canTransition
} from '../../../src/main/external-agent/operations'

describe('external agent operation queue and events', () => {
  let service: ExternalAgentOperationService

  beforeEach(() => {
    service = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
  })

  it('enqueues FIFO and dequeues the oldest session write first', async () => {
    const first = await service.enqueue({
      agentId: 'pi',
      sessionId: 'sess-1',
      toolName: 'start_generation',
      idempotencyKey: 'k-1',
      requestHash: 'h-1'
    })
    const second = await service.enqueue({
      agentId: 'pi',
      sessionId: 'sess-1',
      toolName: 'edit_page',
      idempotencyKey: 'k-2',
      requestHash: 'h-2'
    })
    await service.enqueue({
      agentId: 'pi',
      sessionId: 'sess-2',
      toolName: 'edit_deck',
      idempotencyKey: 'k-3',
      requestHash: 'h-3'
    })

    const next = await service.dequeueNext('sess-1')
    expect(next?.id).toBe(first.id)
    expect(next?.status).toBe('running')
    expect((await service.get(second.id))?.status).toBe('queued')
  })

  it('records monotonic events and replays after a cursor', async () => {
    const record = await service.enqueue({
      agentId: 'pi',
      sessionId: 'sess-1',
      toolName: 'start_generation',
      idempotencyKey: 'k-1',
      requestHash: 'h-1'
    })
    await service.dequeueNext('sess-1')
    await service.transition({ operationId: record.id, to: 'completed', progress: 100 })

    const all = await service.listEvents(record.id, 0, 50)
    expect(all.map((event) => event.sequence)).toEqual([1, 2, 3])
    expect(all.map((event) => event.type)).toEqual(['queued', 'started', 'completed'])

    const replay = await service.listEvents(record.id, 1, 50)
    expect(replay).toHaveLength(2)
    expect(replay[0].sequence).toBe(2)
  })

  it('cancels queued work, interrupts with checkpoint, and resumes to queued', async () => {
    const queued = await service.enqueue({
      agentId: 'pi',
      sessionId: 'sess-1',
      toolName: 'edit_page',
      idempotencyKey: 'k-1',
      requestHash: 'h-1'
    })
    const cancelled = await service.cancel({
      operationId: queued.id,
      agentId: 'pi',
      reason: 'stop'
    })
    expect('status' in cancelled && cancelled.status).toBe('cancelled')

    const running = await service.enqueue({
      agentId: 'pi',
      sessionId: 'sess-1',
      toolName: 'start_generation',
      idempotencyKey: 'k-2',
      requestHash: 'h-2'
    })
    await service.dequeueNext('sess-1')
    await service.interruptActive(running.id, 'page-2')
    const interrupted = await service.get(running.id)
    expect(interrupted?.status).toBe('interrupted')
    expect(interrupted?.resumable).toBe(true)
    expect(interrupted?.checkpoint).toBe('page-2')

    const resumed = await service.transition({ operationId: running.id, to: 'queued' })
    expect('status' in resumed && resumed.status).toBe('queued')
  })

  it('revokes active operations for an agent', async () => {
    const record = await service.enqueue({
      agentId: 'pi',
      sessionId: 'sess-1',
      toolName: 'start_generation',
      idempotencyKey: 'k-1',
      requestHash: 'h-1'
    })
    const revoked = await service.revokeAgentOperations('pi')
    expect(revoked).toEqual(['sess-1'])
    expect((await service.get(record.id))?.status).toBe('revoked')
  })

  it('revokes only the sessions removed from a grant', async () => {
    const keep = await service.enqueue({
      agentId: 'pi',
      sessionId: 'sess-keep',
      toolName: 'start_generation',
      idempotencyKey: 'k-keep',
      requestHash: 'h-keep'
    })
    const drop = await service.enqueue({
      agentId: 'pi',
      sessionId: 'sess-drop',
      toolName: 'export_pptx',
      idempotencyKey: 'k-drop',
      requestHash: 'h-drop'
    })

    const revoked = await service.revokeAgentOperations('pi', ['sess-drop'])
    expect(revoked).toEqual(['sess-drop'])
    expect((await service.get(drop.id))?.status).toBe('revoked')
    expect((await service.get(keep.id))?.status).toBe('queued')
  })

  it('rejects illegal status transitions', () => {
    expect(canTransition('completed', 'queued')).toBe(false)
    expect(canTransition('queued', 'running')).toBe(true)
    expect(canTransition('interrupted', 'queued')).toBe(true)
    expect(canTransition('awaiting_confirmation', 'queued')).toBe(true)
  })
})
