import { describe, expect, it, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ExternalAgentBroker } from '../../../src/main/external-agent/broker'
import {
  ExternalAgentAuthorizationService,
  InMemoryExternalAgentAuthorizationStore
} from '../../../src/main/external-agent/authorization'
import {
  ExternalAgentOperationService,
  InMemoryExternalAgentOperationStore
} from '../../../src/main/external-agent/operations'

describe('ExternalAgentBroker write and recovery flow', () => {
  let authService: ExternalAgentAuthorizationService
  let operations: ExternalAgentOperationService
  let broker: ExternalAgentBroker

  beforeEach(() => {
    const authStore = new InMemoryExternalAgentAuthorizationStore()
    authService = new ExternalAgentAuthorizationService(authStore)
    operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    broker = new ExternalAgentBroker(
      authService,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return null
        }
      },
      '2.3.0',
      operations
    )
  })

  it('enqueues generation, replays the same idempotency key, and rejects a reused key', async () => {
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1']
    })

    const first = await broker.handleRequest('pi', {
      type: 'start_generation',
      input: {
        idempotencyKey: 'gen-1',
        sessionId: 'sess-1',
        topic: '季度复盘'
      }
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.operationId).toBeTruthy()
    expect((first.data as { status: string }).status).toBe('queued')

    const replay = await broker.handleRequest('pi', {
      type: 'start_generation',
      input: {
        idempotencyKey: 'gen-1',
        sessionId: 'sess-1',
        topic: '季度复盘'
      }
    })
    expect(replay.ok).toBe(true)
    if (replay.ok) expect(replay.operationId).toBe(first.operationId)

    const reused = await broker.handleRequest('pi', {
      type: 'start_generation',
      input: {
        idempotencyKey: 'gen-1',
        sessionId: 'sess-1',
        topic: '另一份主题'
      }
    })
    expect(reused.ok).toBe(false)
    if (!reused.ok) expect(reused.error.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })

  it('replays events after a cursor and cancels the operation', async () => {
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1']
    })
    const created = await broker.handleRequest('pi', {
      type: 'edit_page',
      input: {
        idempotencyKey: 'edit-1',
        sessionId: 'sess-1',
        pageId: 'page-1',
        instruction: '改标题'
      }
    })
    expect(created.ok).toBe(true)
    if (!created.ok || !created.operationId) return

    await operations.dequeueNext('sess-1')
    const events = await broker.handleRequest('pi', {
      type: 'get_operation_events',
      input: { operationId: created.operationId, afterSequence: 0, limit: 20 }
    })
    expect(events.ok).toBe(true)
    if (events.ok) {
      const data = events.data as { events: Array<{ sequence: number; type: string }> }
      expect(data.events.map((event) => event.type)).toEqual(['queued', 'started'])
    }

    const replay = await broker.handleRequest('pi', {
      type: 'get_operation_events',
      input: { operationId: created.operationId, afterSequence: 1, limit: 20 }
    })
    expect(replay.ok).toBe(true)
    if (replay.ok) {
      const data = replay.data as { events: Array<{ sequence: number }> }
      expect(data.events).toHaveLength(1)
      expect(data.events[0].sequence).toBe(2)
    }

    const cancelled = await broker.handleRequest('pi', {
      type: 'cancel_operation',
      input: {
        idempotencyKey: 'cancel-1',
        operationId: created.operationId
      }
    })
    expect(cancelled.ok).toBe(true)
    if (cancelled.ok) expect((cancelled.data as { status: string }).status).toBe('cancelled')
  })

  it('creates confirmation operations for delete and overwrite export', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-export-'))
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1'],
      workspaceRoots: [workspace]
    })
    const deleted = await broker.handleRequest('pi', {
      type: 'delete_session',
      input: { idempotencyKey: 'del-1', sessionId: 'sess-1' }
    })
    expect(deleted.ok).toBe(true)
    if (deleted.ok)
      expect((deleted.data as { status: string }).status).toBe('awaiting_confirmation')

    const exported = await broker.handleRequest('pi', {
      type: 'export_pptx',
      input: {
        idempotencyKey: 'exp-1',
        sessionId: 'sess-1',
        outputPath: path.join(workspace, 'deck.pptx'),
        overwrite: true
      }
    })
    expect(exported.ok).toBe(true)
    if (exported.ok)
      expect((exported.data as { status: string }).status).toBe('awaiting_confirmation')
  })

  it('rejects export_pptx when the target already exists without overwrite', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-export-exists-'))
    const outputPath = path.join(workspace, 'deck.pptx')
    fs.writeFileSync(outputPath, 'existing')
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1'],
      workspaceRoots: [workspace]
    })
    const exported = await broker.handleRequest('pi', {
      type: 'export_pptx',
      input: {
        idempotencyKey: 'exp-exists',
        sessionId: 'sess-1',
        outputPath
      }
    })
    expect(exported.ok).toBe(false)
    if (!exported.ok) expect(exported.error.code).toBe('EXPORT_TARGET_EXISTS')
  })

  it('allows export_pptx into the session exports directory without a workspace grant', async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-export-session-'))
    const exportsDir = path.join(projectDir, 'exports')
    fs.mkdirSync(exportsDir)
    broker = new ExternalAgentBroker(
      authService,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return null
        },
        async resolveSessionProjectDir(sessionId) {
          return sessionId === 'sess-1' ? projectDir : null
        }
      },
      '2.3.0',
      operations
    )
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1']
    })
    const exported = await broker.handleRequest('pi', {
      type: 'export_pptx',
      input: {
        idempotencyKey: 'exp-session-exports',
        sessionId: 'sess-1',
        outputPath: path.join(exportsDir, 'deck.pptx')
      }
    })
    expect(exported.ok).toBe(true)
    if (exported.ok) expect((exported.data as { status: string }).status).toBe('queued')
  })

  it('rejects import_pptx when the source is not a pptx file', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-import-type-'))
    const sourcePath = path.join(workspace, 'notes.txt')
    fs.writeFileSync(sourcePath, 'not pptx')
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      workspaceRoots: [workspace]
    })
    const imported = await broker.handleRequest('pi', {
      type: 'import_pptx',
      input: {
        idempotencyKey: 'import-type',
        sourcePath
      }
    })
    expect(imported.ok).toBe(false)
    if (!imported.ok) expect(imported.error.code).toBe('FILE_TYPE_UNSUPPORTED')
  })

  it('rejects import_assets when the source type is unsupported', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-asset-type-'))
    const sourcePath = path.join(workspace, 'notes.exe')
    fs.writeFileSync(sourcePath, 'exe')
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1'],
      workspaceRoots: [workspace]
    })
    const imported = await broker.handleRequest('pi', {
      type: 'import_assets',
      input: {
        idempotencyKey: 'asset-type',
        sessionId: 'sess-1',
        sources: [{ sourcePath }]
      }
    })
    expect(imported.ok).toBe(false)
    if (!imported.ok) expect(imported.error.code).toBe('FILE_TYPE_UNSUPPORTED')
  })

  it('rejects create_session when the workspace root is not granted', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-workspace-'))
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-other-'))
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      workspaceRoots: [workspace]
    })
    const created = await broker.handleRequest('pi', {
      type: 'create_session',
      input: {
        idempotencyKey: 'create-denied',
        title: '新演示',
        workspaceRootPath: other
      }
    })
    expect(created.ok).toBe(false)
    if (!created.ok) expect(created.error.code).toBe('PATH_OUTSIDE_AUTHORIZED_ROOT')
  })

  it('allows create_session without a granted workspace when the path is omitted', async () => {
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0'
    })
    const created = await broker.handleRequest('pi', {
      type: 'create_session',
      input: {
        idempotencyKey: 'create-no-workspace',
        title: '新演示'
      }
    })
    expect(created.ok).toBe(true)
    if (created.ok) expect((created.data as { status: string }).status).toBe('queued')
  })

  it('approves overwrite export into queued and rejects delete_session', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-confirm-'))
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1'],
      workspaceRoots: [workspace]
    })
    const exported = await broker.handleRequest('pi', {
      type: 'export_pptx',
      input: {
        idempotencyKey: 'exp-overwrite',
        sessionId: 'sess-1',
        outputPath: path.join(workspace, 'deck.pptx'),
        overwrite: true
      }
    })
    expect(exported.ok).toBe(true)
    if (!exported.ok || !exported.operationId) return
    expect((exported.data as { status: string }).status).toBe('awaiting_confirmation')
    await broker.resolveConfirmation(exported.operationId, true)
    expect((await operations.get(exported.operationId))?.status).toBe('queued')

    const deleted = await broker.handleRequest('pi', {
      type: 'delete_session',
      input: { idempotencyKey: 'del-reject', sessionId: 'sess-1' }
    })
    expect(deleted.ok).toBe(true)
    if (!deleted.ok || !deleted.operationId) return
    await broker.resolveConfirmation(deleted.operationId, false)
    const rejected = await operations.get(deleted.operationId)
    expect(rejected?.status).toBe('rejected')
    expect(rejected?.errorCode).toBe('CONFIRMATION_REJECTED')
  })
})
