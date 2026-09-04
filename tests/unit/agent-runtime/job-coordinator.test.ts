import { describe, expect, it } from 'vitest'
import { JobCoordinator } from '../../../src/main/agent-runtime/job/coordinator'
import { sessionLockKey } from '../../../src/main/agent-runtime/lock/keys'

const reserve = (
  coordinator: JobCoordinator,
  args: Partial<Parameters<JobCoordinator['reserve']>[0]> & {
    jobId: string
    owner: { kind: 'session' | 'style' | 'image-history'; id: string }
    claims: { read?: string[]; write?: string[] }
  }
) =>
  coordinator.reserve({
    domain: 'generation',
    wait: 'block',
    ...args
  })

describe('JobCoordinator', () => {
  it('returns the existing job for the same owner and conflicting fail-fast claim', async () => {
    const coordinator = new JobCoordinator()
    const first = await reserve(coordinator, {
      jobId: 'job-1',
      owner: { kind: 'session', id: 'session-1' },
      claims: { write: ['session:session-1'] }
    })
    if (first.status !== 'acquired') throw new Error('expected first job to acquire')

    await expect(
      reserve(coordinator, {
        jobId: 'job-2',
        owner: { kind: 'session', id: 'session-1' },
        claims: { write: ['session:session-1'] }
      })
    ).resolves.toEqual({ status: 'busy', conflictingJobId: 'job-1' })

    await expect(
      reserve(coordinator, {
        jobId: 'job-3',
        owner: { kind: 'style', id: 'style-1' },
        claims: { write: ['session:session-1'] },
        wait: 'fail'
      })
    ).resolves.toEqual({ status: 'busy', conflictingJobId: 'job-1' })

    first.lease.release()
  })

  it('keeps every outer session writer busy while generation owns the session', async () => {
    const coordinator = new JobCoordinator()
    const sessionId = 'session-1'
    const generation = await reserve(coordinator, {
      jobId: 'generation-run-1',
      owner: { kind: 'session', id: sessionId },
      claims: { write: [sessionLockKey(sessionId)] }
    })
    if (generation.status !== 'acquired') throw new Error('expected generation job')

    const outerWriters = [
      { name: 'retry-failed-pages', domain: 'generation' as const },
      { name: 'add-page', domain: 'generation' as const },
      { name: 'single-page-retry', domain: 'generation' as const },
      { name: 'page-edit', domain: 'edit' as const },
      { name: 'deck-edit', domain: 'edit' as const },
      { name: 'style-switch', domain: 'style' as const }
    ]
    for (const operation of outerWriters) {
      await expect(
        coordinator.reserve({
          jobId: `${operation.name}-job`,
          domain: operation.domain,
          owner: { kind: 'session', id: sessionId },
          claims: { write: [sessionLockKey(sessionId)] },
          wait: 'fail'
        })
      ).resolves.toEqual({ status: 'busy', conflictingJobId: 'generation-run-1' })
    }

    generation.lease.release()
    const retry = await reserve(coordinator, {
      jobId: 'retry-run-2',
      owner: { kind: 'session', id: sessionId },
      claims: { write: [sessionLockKey(sessionId)] }
    })
    expect(retry.status).toBe('acquired')
    if (retry.status === 'acquired') retry.lease.release()
  })

  it('keeps queued jobs cancellable through the same signal and removes them', async () => {
    const coordinator = new JobCoordinator()
    const active = await reserve(coordinator, {
      jobId: 'job-active',
      owner: { kind: 'session', id: 'session-1' },
      claims: { write: ['session:session-1'] }
    })
    if (active.status !== 'acquired') throw new Error('expected active job')

    const waiting = reserve(coordinator, {
      jobId: 'job-waiting',
      owner: { kind: 'style', id: 'style-1' },
      claims: { write: ['session:session-1'] }
    })
    expect(coordinator.getByOwner({ kind: 'style', id: 'style-1' })).toMatchObject({
      jobId: 'job-waiting',
      state: 'waiting'
    })

    expect(coordinator.cancel('job-waiting')).toBe(true)
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(coordinator.getByOwner({ kind: 'style', id: 'style-1' })).toBeNull()

    active.lease.release()
  })

  it('relays external cancellation, cancels active jobs once, and releases idempotently', async () => {
    const coordinator = new JobCoordinator()
    const external = new AbortController()
    const acquired = await reserve(coordinator, {
      jobId: 'job-1',
      owner: { kind: 'session', id: 'session-1' },
      claims: { write: ['session:session-1'] },
      signal: external.signal
    })
    if (acquired.status !== 'acquired') throw new Error('expected acquired job')

    external.abort()
    expect(acquired.lease.signal.aborted).toBe(true)
    expect(coordinator.cancel('job-1')).toBe(false)

    acquired.lease.release()
    acquired.lease.release()

    const next = await reserve(coordinator, {
      jobId: 'job-2',
      owner: { kind: 'session', id: 'session-1' },
      claims: { write: ['session:session-1'] }
    })
    expect(next.status).toBe('acquired')
    if (next.status === 'acquired') next.lease.release()
  })

  it('cancels every job owned by the requested owner', async () => {
    const coordinator = new JobCoordinator()
    const acquired = await reserve(coordinator, {
      jobId: 'job-1',
      owner: { kind: 'session', id: 'session-1' },
      claims: { write: ['session:session-1'] }
    })
    if (acquired.status !== 'acquired') throw new Error('expected acquired job')

    expect(coordinator.cancelOwner({ kind: 'session', id: 'session-1' })).toBe(1)
    expect(acquired.lease.signal.aborted).toBe(true)
    acquired.lease.release()
  })
})
