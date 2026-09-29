import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import { afterEach, describe, expect, it } from 'vitest'
import { patchExternalAgentTables } from '../../../src/main/db/patch/add-external-agent-tables'
import * as schema from '../../../src/main/db/schema'
import { ExternalAgentAuthorizationService } from '../../../src/main/external-agent/authorization'
import { ExternalAgentOperationService } from '../../../src/main/external-agent/operations'
import { SqliteExternalAgentStore } from '../../../src/main/external-agent/sqlite-store'

describe('external agent sqlite persistence', () => {
  const clients: Array<ReturnType<typeof createClient>> = []

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      await client.close()
    }
  })

  it('persists grants, operations and event cursors through sqlite', async () => {
    const client = createClient({ url: ':memory:' })
    clients.push(client)
    await client.execute('PRAGMA foreign_keys = ON;')
    await patchExternalAgentTables(client)
    const db = drizzle(client, { schema })
    const store = new SqliteExternalAgentStore(db)
    const auth = new ExternalAgentAuthorizationService(store)
    const operations = new ExternalAgentOperationService(store)

    await auth.grantInitial({
      agentId: 'pi',
      name: 'pi coding agent',
      version: '1.0.0',
      sessionIds: ['sess-1'],
      workspaceRoots: ['C:\\workspace']
    })
    const access = await auth.checkAccess({
      agentId: 'pi',
      capability: 'read',
      sessionId: 'sess-1'
    })
    expect(access.authorized).toBe(true)

    const record = await operations.enqueue({
      agentId: 'pi',
      sessionId: 'sess-1',
      toolName: 'start_generation',
      idempotencyKey: 'gen-1',
      requestHash: 'hash-1'
    })
    await operations.dequeueNext('sess-1')
    await operations.transition({ operationId: record.id, to: 'completed', progress: 100 })

    const replayed = await operations.getByIdempotency('pi', 'gen-1')
    expect(replayed?.id).toBe(record.id)
    expect(replayed?.status).toBe('completed')

    const events = await operations.listEvents(record.id, 0, 20)
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3])

    await store.revokeAgent('pi')
    const revoked = await auth.checkAccess({ agentId: 'pi', sessionId: 'sess-1' })
    expect(revoked.authorized).toBe(false)
    expect(revoked.error?.code).toBe('AUTH_REVOKED')
  })
})
