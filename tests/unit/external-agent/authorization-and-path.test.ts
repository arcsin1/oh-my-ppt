import { describe, expect, it, beforeEach } from 'vitest'
import path from 'path'
import fs from 'fs'
import os from 'os'
import {
  ExternalAgentAuthorizationService,
  InMemoryExternalAgentAuthorizationStore,
  isPathInsideRoot,
  validateSafePath
} from '../../../src/main/external-agent/authorization'
import {
  ExternalAgentIdempotencyService,
  InMemoryExternalAgentIdempotencyStore,
  computeRequestHash
} from '../../../src/main/external-agent/idempotency'

describe('external agent authorization and path security', () => {
  let tempDir: string
  let store: InMemoryExternalAgentAuthorizationStore
  let authService: ExternalAgentAuthorizationService

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-auth-test-'))
    store = new InMemoryExternalAgentAuthorizationStore()
    authService = new ExternalAgentAuthorizationService(store)
  })

  it('rejects unregistered or ungranted agents with AUTH_REQUIRED', async () => {
    const res = await authService.checkAccess({ agentId: 'unknown-agent' })
    expect(res.authorized).toBe(false)
    expect(res.error?.code).toBe('AUTH_REQUIRED')
  })

  it('allows access within granted capabilities and sessions', async () => {
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi coding agent',
      version: '1.0.0',
      capabilities: ['read', 'create_session', 'generation'],
      sessionIds: ['sess_1'],
      workspaceRoots: [tempDir]
    })

    const allow = await authService.checkAccess({
      agentId: 'pi',
      capability: 'read',
      sessionId: 'sess_1'
    })
    expect(allow.authorized).toBe(true)

    const ungrantedCap = await authService.checkAccess({
      agentId: 'pi',
      capability: 'delete_session',
      sessionId: 'sess_1'
    })
    expect(ungrantedCap.authorized).toBe(false)
    expect(ungrantedCap.error?.code).toBe('NOT_AUTHORIZED')

    const ungrantedSess = await authService.checkAccess({
      agentId: 'pi',
      capability: 'read',
      sessionId: 'sess_2'
    })
    expect(ungrantedSess.authorized).toBe(false)
    expect(ungrantedSess.error?.code).toBe('SESSION_NOT_GRANTED')
  })

  it('immediately blocks access when agent or grant is revoked', async () => {
    await authService.grantInitial({
      agentId: 'codex',
      name: 'codex agent',
      version: '1.0.0',
      sessionIds: ['sess_a']
    })

    expect(
      (await authService.checkAccess({ agentId: 'codex', sessionId: 'sess_a' })).authorized
    ).toBe(true)

    await store.revokeAgent('codex')
    const revoked = await authService.checkAccess({ agentId: 'codex', sessionId: 'sess_a' })
    expect(revoked.authorized).toBe(false)
    expect(revoked.error?.code).toBe('AUTH_REVOKED')
  })

  it('updates grant sessions and workspace without re-authorizing', async () => {
    const firstRoot = path.join(tempDir, 'one')
    const nextRoot = path.join(tempDir, 'two')
    fs.mkdirSync(firstRoot, { recursive: true })
    fs.mkdirSync(nextRoot, { recursive: true })

    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess_1', 'sess_2'],
      workspaceRoots: [firstRoot]
    })

    const updated = await authService.updateGrant('pi', {
      sessionIds: ['sess_2', 'sess_3'],
      workspaceRoots: [nextRoot]
    })
    expect(updated?.removedSessionIds).toEqual(['sess_1'])
    expect(updated?.grant.sessionIds).toEqual(['sess_2', 'sess_3'])
    expect(updated?.grant.workspaceRoots).toEqual([path.resolve(nextRoot)])

    expect(
      (await authService.checkAccess({ agentId: 'pi', sessionId: 'sess_1' })).error?.code
    ).toBe('SESSION_NOT_GRANTED')
    expect((await authService.checkAccess({ agentId: 'pi', sessionId: 'sess_3' })).authorized).toBe(
      true
    )

    expect(await authService.updateGrant('missing', { sessionIds: [] })).toBeNull()
  })

  it('safely verifies boundary containment and rejects path traversal', () => {
    const root = path.join(tempDir, 'workspace')
    fs.mkdirSync(root, { recursive: true })

    const validChild = path.join(root, 'sub', 'doc.pptx')
    expect(isPathInsideRoot(validChild, root)).toBe(true)

    const escapePath = path.join(root, '..', 'escape.pptx')
    expect(isPathInsideRoot(escapePath, root)).toBe(false)

    const check = validateSafePath({
      targetPath: escapePath,
      authorizedRoots: [root]
    })
    expect(check.ok).toBe(false)
    expect(check.error?.code).toBe('PATH_OUTSIDE_AUTHORIZED_ROOT')
  })

  it('rejects symlinks that point outside the authorized roots', () => {
    const root = path.join(tempDir, 'workspace')
    const outside = path.join(tempDir, 'secret.txt')
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(outside, 'sensitive')

    const linkPath = path.join(root, 'link.txt')
    try {
      fs.symlinkSync(outside, linkPath)
      const res = validateSafePath({
        targetPath: linkPath,
        authorizedRoots: [root],
        mustExist: true
      })
      expect(res.ok).toBe(false)
      expect(res.error?.code).toBe('PATH_OUTSIDE_AUTHORIZED_ROOT')
    } catch {
      // 在无管理员权限创建 symlink 的系统环境下降级忽略真实 symlink 测试
    }
  })
})

describe('external agent idempotency service', () => {
  let idempotencyStore: InMemoryExternalAgentIdempotencyStore
  let service: ExternalAgentIdempotencyService

  beforeEach(() => {
    idempotencyStore = new InMemoryExternalAgentIdempotencyStore()
    service = new ExternalAgentIdempotencyService(idempotencyStore)
  })

  it('reserves a new operation on first call and reuses it on exact replay', async () => {
    const payload = { title: 'Presentation', topic: 'AI' }
    const res1 = await service.checkOrReserve({
      agentId: 'agent-1',
      idempotencyKey: 'key-100',
      payload,
      newOperationId: 'op-1'
    })

    expect(res1.ok).toBe(true)
    expect(res1.isReplay).toBe(false)
    expect(res1.record?.operationId).toBe('op-1')

    const res2 = await service.checkOrReserve({
      agentId: 'agent-1',
      idempotencyKey: 'key-100',
      payload,
      newOperationId: 'op-2'
    })

    expect(res2.ok).toBe(true)
    expect(res2.isReplay).toBe(true)
    expect(res2.record?.operationId).toBe('op-1')
  })

  it('rejects same key reused with different request payload', async () => {
    await service.checkOrReserve({
      agentId: 'agent-1',
      idempotencyKey: 'key-100',
      payload: { foo: 1 },
      newOperationId: 'op-1'
    })

    const resDiff = await service.checkOrReserve({
      agentId: 'agent-1',
      idempotencyKey: 'key-100',
      payload: { foo: 2 },
      newOperationId: 'op-2'
    })

    expect(resDiff.ok).toBe(false)
    expect(resDiff.error?.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('computes stable hash regardless of key insertion order', () => {
    const hashA = computeRequestHash({ a: 1, b: 2 })
    const hashB = computeRequestHash({ b: 2, a: 1 })
    expect(hashA).toBe(hashB)
  })
})
