import { describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  ExternalAgentAuthorizationService,
  InMemoryExternalAgentAuthorizationStore
} from '../../../src/main/external-agent/authorization'
import { ExternalAgentBroker } from '../../../src/main/external-agent/broker'
import {
  ExternalAgentOperationService,
  InMemoryExternalAgentOperationStore
} from '../../../src/main/external-agent/operations'
import type { ExternalAgentProductRuntime } from '../../../src/main/external-agent/product-runtime'
import { ExternalAgentRuntimeExecutor } from '../../../src/main/external-agent/runtime-executor'

describe('external agent runtime executor', () => {
  it('dequeues start_generation through the product runtime and maps completion chunks', async () => {
    const operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    const product: ExternalAgentProductRuntime = {
      startGeneration: vi.fn(async () => ({ success: true, runId: 'run-1', queued: false })),
      startPageEdit: vi.fn(async () => ({ success: true, runId: 'run-edit' })),
      startDeckEdit: vi.fn(async () => ({ success: true, runId: 'run-deck' })),
      createSession: vi.fn(async () => ({ success: true, sessionId: 'sess-new' })),
      exportPptx: vi.fn(async () => ({ success: true, outputPath: 'F:\\out\\deck.pptx' })),
      importPptx: vi.fn(async () => ({ success: true, sessionId: 'sess-imported' })),
      importAssets: vi.fn(async () => ({ success: true, assets: [] })),
      deletePage: vi.fn(async () => ({ success: true })),
      deleteSession: vi.fn(async () => ({ success: true })),
      applySessionStyle: vi.fn(async () => undefined),
      cancelSession: vi.fn(async () => true)
    }
    const executor = new ExternalAgentRuntimeExecutor(operations, product)
    const auth = new ExternalAgentAuthorizationService(
      new InMemoryExternalAgentAuthorizationStore()
    )
    await auth.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1']
    })
    const broker = new ExternalAgentBroker(
      auth,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return null
        }
      },
      '2.3.0',
      operations,
      executor
    )

    const created = await broker.handleRequest('pi', {
      type: 'start_generation',
      input: { idempotencyKey: 'gen-1', sessionId: 'sess-1', topic: '季度复盘', pageCount: 6 }
    })
    expect(created.ok).toBe(true)
    await executor.kick('sess-1')
    expect(product.startGeneration).toHaveBeenCalledTimes(1)
    expect(product.startGeneration).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'sess-1', pageCount: 6 })
    )
    const running = await operations.listRunning('sess-1')
    expect(running).toHaveLength(1)
    expect(running[0].resultRef).toBe('run-1')

    await executor.observeChunk('sess-1', {
      type: 'run_completed',
      payload: { runId: 'run-1', totalPages: 3, completedPageCount: 3, failedPageCount: 0 }
    })
    expect((await operations.get(running[0].id))?.status).toBe('completed')
  })

  it('applies start_generation styleId and animationPreferences before generating', async () => {
    const operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    const product: ExternalAgentProductRuntime = {
      startGeneration: vi.fn(async () => ({ success: true, runId: 'run-style', queued: false })),
      startPageEdit: vi.fn(async () => ({ success: true, runId: 'run-edit' })),
      startDeckEdit: vi.fn(async () => ({ success: true, runId: 'run-deck' })),
      createSession: vi.fn(async () => ({ success: true, sessionId: 'sess-new' })),
      exportPptx: vi.fn(async () => ({ success: true, outputPath: 'F:\\out\\deck.pptx' })),
      importPptx: vi.fn(async () => ({ success: true, sessionId: 'sess-imported' })),
      importAssets: vi.fn(async () => ({ success: true, assets: [] })),
      deletePage: vi.fn(async () => ({ success: true })),
      deleteSession: vi.fn(async () => ({ success: true })),
      applySessionStyle: vi.fn(async () => undefined),
      cancelSession: vi.fn(async () => true)
    }
    const executor = new ExternalAgentRuntimeExecutor(operations, product)
    const auth = new ExternalAgentAuthorizationService(
      new InMemoryExternalAgentAuthorizationStore()
    )
    await auth.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1']
    })
    const broker = new ExternalAgentBroker(
      auth,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return null
        }
      },
      '2.3.0',
      operations,
      executor
    )

    const created = await broker.handleRequest('pi', {
      type: 'start_generation',
      input: {
        idempotencyKey: 'gen-style',
        sessionId: 'sess-1',
        topic: '极光演示',
        styleId: 'aurora',
        animationPreferences: { ids: ['fade', 'slide-up'] }
      }
    })
    expect(created.ok).toBe(true)
    await executor.kick('sess-1')
    expect(product.applySessionStyle).toHaveBeenCalledWith('sess-1', 'aurora')
    expect(product.startGeneration).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'sess-1',
        animationPreferences: { ids: ['fade', 'slide-up'] }
      })
    )
  })

  it('requeues when JobCoordinator is already running and cancels the product session', async () => {
    const operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    const product: ExternalAgentProductRuntime = {
      startGeneration: vi.fn(async () => ({
        success: true,
        runId: 'busy-run',
        alreadyRunning: true
      })),
      startPageEdit: vi.fn(async () => ({ success: true })),
      startDeckEdit: vi.fn(async () => ({ success: true })),
      createSession: vi.fn(async () => ({ success: true, sessionId: 'sess-new' })),
      exportPptx: vi.fn(async () => ({ success: true, outputPath: 'F:\\out\\deck.pptx' })),
      importPptx: vi.fn(async () => ({ success: true, sessionId: 'sess-imported' })),
      importAssets: vi.fn(async () => ({ success: true, assets: [] })),
      deletePage: vi.fn(async () => ({ success: true })),
      deleteSession: vi.fn(async () => ({ success: true })),
      applySessionStyle: vi.fn(async () => undefined),
      cancelSession: vi.fn(async () => true)
    }
    const executor = new ExternalAgentRuntimeExecutor(operations, product)
    const auth = new ExternalAgentAuthorizationService(
      new InMemoryExternalAgentAuthorizationStore()
    )
    await auth.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1']
    })
    const broker = new ExternalAgentBroker(
      auth,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return null
        }
      },
      '2.3.0',
      operations,
      executor
    )

    const created = await broker.handleRequest('pi', {
      type: 'start_generation',
      input: { idempotencyKey: 'gen-busy', sessionId: 'sess-1', topic: '主题' }
    })
    expect(created.ok).toBe(true)
    await executor.kick('sess-1')
    const queued = await operations.peekQueued('sess-1')
    expect(queued?.status).toBe('queued')

    const cancelled = await broker.handleRequest('pi', {
      type: 'cancel_operation',
      input: { idempotencyKey: 'cancel-1', operationId: queued?.id || '' }
    })
    expect(cancelled.ok).toBe(true)
    expect(product.cancelSession).toHaveBeenCalledWith('sess-1')
  })

  it('creates a session without a prior sessionId and attaches it to the grant', async () => {
    const operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    const product: ExternalAgentProductRuntime = {
      startGeneration: vi.fn(async () => ({ success: true })),
      startPageEdit: vi.fn(async () => ({ success: true })),
      startDeckEdit: vi.fn(async () => ({ success: true })),
      createSession: vi.fn(async () => ({ success: true, sessionId: 'sess-created' })),
      exportPptx: vi.fn(async () => ({ success: true, outputPath: 'F:\\out\\deck.pptx' })),
      importPptx: vi.fn(async () => ({ success: true, sessionId: 'sess-imported' })),
      importAssets: vi.fn(async () => ({ success: true, assets: [] })),
      deletePage: vi.fn(async () => ({ success: true })),
      deleteSession: vi.fn(async () => ({ success: true })),
      applySessionStyle: vi.fn(async () => undefined),
      cancelSession: vi.fn(async () => true)
    }
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-create-'))
    const auth = new ExternalAgentAuthorizationService(
      new InMemoryExternalAgentAuthorizationStore()
    )
    await auth.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      workspaceRoots: [workspace]
    })
    const executor = new ExternalAgentRuntimeExecutor(operations, product, auth)
    const broker = new ExternalAgentBroker(
      auth,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return null
        }
      },
      '2.3.0',
      operations,
      executor
    )

    const created = await broker.handleRequest('pi', {
      type: 'create_session',
      input: {
        idempotencyKey: 'create-1',
        title: '新演示',
        styleId: 'modern',
        workspaceRootPath: workspace
      }
    })
    expect(created.ok).toBe(true)
    await executor.kick()
    expect(product.createSession).toHaveBeenCalledTimes(1)
    const record = await operations.get((created as { operationId?: string }).operationId || '')
    expect(record?.status).toBe('completed')
    expect(record?.sessionId).toBe('sess-created')
    expect(record?.resultRef).toBe('sess-created')
    const access = await auth.checkAccess({
      agentId: 'pi',
      capability: 'read',
      sessionId: 'sess-created'
    })
    expect(access.authorized).toBe(true)
  })

  it('creates a session using the granted workspace when workspaceRootPath is omitted', async () => {
    const operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    const product: ExternalAgentProductRuntime = {
      startGeneration: vi.fn(async () => ({ success: true })),
      startPageEdit: vi.fn(async () => ({ success: true })),
      startDeckEdit: vi.fn(async () => ({ success: true })),
      createSession: vi.fn(async () => ({ success: true, sessionId: 'sess-default' })),
      exportPptx: vi.fn(async () => ({ success: true, outputPath: 'F:\\out\\deck.pptx' })),
      importPptx: vi.fn(async () => ({ success: true, sessionId: 'sess-imported' })),
      importAssets: vi.fn(async () => ({ success: true, assets: [] })),
      deletePage: vi.fn(async () => ({ success: true })),
      deleteSession: vi.fn(async () => ({ success: true })),
      applySessionStyle: vi.fn(async () => undefined),
      cancelSession: vi.fn(async () => true)
    }
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-create-default-'))
    const auth = new ExternalAgentAuthorizationService(
      new InMemoryExternalAgentAuthorizationStore()
    )
    await auth.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      workspaceRoots: [workspace]
    })
    const executor = new ExternalAgentRuntimeExecutor(operations, product, auth)
    const broker = new ExternalAgentBroker(
      auth,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return null
        }
      },
      '2.3.0',
      operations,
      executor
    )

    const created = await broker.handleRequest('pi', {
      type: 'create_session',
      input: {
        idempotencyKey: 'create-default',
        title: '默认工作区演示'
      }
    })
    expect(created.ok).toBe(true)
    await executor.kick()
    expect(product.createSession).toHaveBeenCalledTimes(1)
    const record = await operations.get((created as { operationId?: string }).operationId || '')
    expect(record?.status).toBe('completed')
    expect(record?.sessionId).toBe('sess-default')
  })

  it('deletes a page through the product runtime after confirmation', async () => {
    const operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    const product: ExternalAgentProductRuntime = {
      startGeneration: vi.fn(async () => ({ success: true })),
      startPageEdit: vi.fn(async () => ({ success: true })),
      startDeckEdit: vi.fn(async () => ({ success: true })),
      createSession: vi.fn(async () => ({ success: true, sessionId: 'sess-new' })),
      exportPptx: vi.fn(async () => ({ success: true, outputPath: 'F:\\out\\deck.pptx' })),
      importPptx: vi.fn(async () => ({ success: true, sessionId: 'sess-imported' })),
      importAssets: vi.fn(async () => ({ success: true, assets: [] })),
      deletePage: vi.fn(async () => ({ success: true })),
      deleteSession: vi.fn(async () => ({ success: true })),
      applySessionStyle: vi.fn(async () => undefined),
      cancelSession: vi.fn(async () => true)
    }
    const auth = new ExternalAgentAuthorizationService(
      new InMemoryExternalAgentAuthorizationStore()
    )
    await auth.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1']
    })
    const executor = new ExternalAgentRuntimeExecutor(operations, product, auth)
    const broker = new ExternalAgentBroker(
      auth,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return {
            session: {
              id: 'sess-1',
              title: '验收会话',
              status: 'completed',
              created_at: 0,
              updated_at: 0
            },
            pages: [{ id: 'page-row-1', page_id: 'page-1', pageNumber: 1, title: '封面' }]
          }
        }
      },
      '2.3.0',
      operations,
      executor,
      undefined,
      async () => true
    )

    const created = await broker.handleRequest('pi', {
      type: 'delete_page',
      input: { idempotencyKey: 'del-page-1', sessionId: 'sess-1', pageId: 'page-1' }
    })
    expect(created.ok).toBe(true)
    await vi.waitFor(async () => {
      const record = await operations.get((created as { operationId?: string }).operationId || '')
      expect(record?.status).toBe('completed')
    })
    expect(product.deletePage).toHaveBeenCalledWith({ sessionId: 'sess-1', pageId: 'page-1' })
  })

  it('imports assets through the product runtime', async () => {
    const operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-assets-run-'))
    const sourcePath = path.join(workspace, 'logo.png')
    fs.writeFileSync(sourcePath, 'png')
    const product: ExternalAgentProductRuntime = {
      startGeneration: vi.fn(async () => ({ success: true })),
      startPageEdit: vi.fn(async () => ({ success: true })),
      startDeckEdit: vi.fn(async () => ({ success: true })),
      createSession: vi.fn(async () => ({ success: true, sessionId: 'sess-new' })),
      exportPptx: vi.fn(async () => ({ success: true, outputPath: 'F:\\out\\deck.pptx' })),
      importPptx: vi.fn(async () => ({ success: true, sessionId: 'sess-imported' })),
      importAssets: vi.fn(async () => ({
        success: true,
        assets: [
          {
            kind: 'image' as const,
            relativePath: './images/logo-abc.png',
            originalName: 'logo.png'
          }
        ]
      })),
      deletePage: vi.fn(async () => ({ success: true })),
      deleteSession: vi.fn(async () => ({ success: true })),
      applySessionStyle: vi.fn(async () => undefined),
      cancelSession: vi.fn(async () => true)
    }
    const auth = new ExternalAgentAuthorizationService(
      new InMemoryExternalAgentAuthorizationStore()
    )
    await auth.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1'],
      workspaceRoots: [workspace]
    })
    const executor = new ExternalAgentRuntimeExecutor(operations, product, auth)
    const broker = new ExternalAgentBroker(
      auth,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return null
        }
      },
      '2.3.0',
      operations,
      executor
    )

    const imported = await broker.handleRequest('pi', {
      type: 'import_assets',
      input: {
        idempotencyKey: 'assets-1',
        sessionId: 'sess-1',
        sources: [{ sourcePath, kind: 'image' }]
      }
    })
    expect(imported.ok).toBe(true)
    await executor.kick('sess-1')
    expect(product.importAssets).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      sources: [{ sourcePath, kind: 'image' }]
    })
    const record = await operations.get((imported as { operationId?: string }).operationId || '')
    expect(record?.status).toBe('completed')
    expect(record?.resultRef).toBe('./images/logo-abc.png')
  })

  it('imports pptx through the product runtime and attaches the new session', async () => {
    const operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-import-run-'))
    const sourcePath = path.join(workspace, 'deck.pptx')
    fs.writeFileSync(sourcePath, 'pptx')
    const product: ExternalAgentProductRuntime = {
      startGeneration: vi.fn(async () => ({ success: true })),
      startPageEdit: vi.fn(async () => ({ success: true })),
      startDeckEdit: vi.fn(async () => ({ success: true })),
      createSession: vi.fn(async () => ({ success: true, sessionId: 'sess-new' })),
      exportPptx: vi.fn(async () => ({ success: true, outputPath: 'F:\\out\\deck.pptx' })),
      importPptx: vi.fn(async () => ({ success: true, sessionId: 'sess-imported' })),
      importAssets: vi.fn(async () => ({ success: true, assets: [] })),
      deletePage: vi.fn(async () => ({ success: true })),
      deleteSession: vi.fn(async () => ({ success: true })),
      applySessionStyle: vi.fn(async () => undefined),
      cancelSession: vi.fn(async () => true)
    }
    const auth = new ExternalAgentAuthorizationService(
      new InMemoryExternalAgentAuthorizationStore()
    )
    await auth.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      workspaceRoots: [workspace]
    })
    const executor = new ExternalAgentRuntimeExecutor(operations, product, auth)
    const broker = new ExternalAgentBroker(
      auth,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return null
        }
      },
      '2.3.0',
      operations,
      executor
    )

    const imported = await broker.handleRequest('pi', {
      type: 'import_pptx',
      input: {
        idempotencyKey: 'import-1',
        sourcePath,
        title: '导入演示'
      }
    })
    expect(imported.ok).toBe(true)
    await executor.kick()
    expect(product.importPptx).toHaveBeenCalledWith({
      sourcePath,
      title: '导入演示',
      styleId: undefined
    })
    const record = await operations.get((imported as { operationId?: string }).operationId || '')
    expect(record?.status).toBe('completed')
    expect(record?.sessionId).toBe('sess-imported')
    expect(record?.resultRef).toBe('sess-imported')
    const access = await auth.checkAccess({
      agentId: 'pi',
      capability: 'read',
      sessionId: 'sess-imported'
    })
    expect(access.authorized).toBe(true)
  })

  it('exports pptx through the product runtime', async () => {
    const operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-export-run-'))
    const outputPath = path.join(workspace, 'deck.pptx')
    const product: ExternalAgentProductRuntime = {
      startGeneration: vi.fn(async () => ({ success: true })),
      startPageEdit: vi.fn(async () => ({ success: true })),
      startDeckEdit: vi.fn(async () => ({ success: true })),
      createSession: vi.fn(async () => ({ success: true, sessionId: 'sess-new' })),
      exportPptx: vi.fn(async () => ({ success: true, outputPath })),
      importPptx: vi.fn(async () => ({ success: true, sessionId: 'sess-imported' })),
      importAssets: vi.fn(async () => ({ success: true, assets: [] })),
      deletePage: vi.fn(async () => ({ success: true })),
      deleteSession: vi.fn(async () => ({ success: true })),
      applySessionStyle: vi.fn(async () => undefined),
      cancelSession: vi.fn(async () => true)
    }
    const auth = new ExternalAgentAuthorizationService(
      new InMemoryExternalAgentAuthorizationStore()
    )
    await auth.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1'],
      workspaceRoots: [workspace]
    })
    const executor = new ExternalAgentRuntimeExecutor(operations, product, auth)
    const broker = new ExternalAgentBroker(
      auth,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return null
        }
      },
      '2.3.0',
      operations,
      executor
    )

    const created = await broker.handleRequest('pi', {
      type: 'export_pptx',
      input: {
        idempotencyKey: 'export-1',
        sessionId: 'sess-1',
        outputPath
      }
    })
    expect(created.ok).toBe(true)
    await executor.kick('sess-1')
    expect(product.exportPptx).toHaveBeenCalledWith({
      sessionId: 'sess-1',
      outputPath,
      overwrite: false
    })
    const record = await operations.get((created as { operationId?: string }).operationId || '')
    expect(record?.status).toBe('completed')
    expect(record?.resultRef).toBe(outputPath)
  })

  it('completes edit_page when run_completed chunk arrives', async () => {
    const operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    const product: ExternalAgentProductRuntime = {
      startGeneration: vi.fn(async () => ({ success: true })),
      startPageEdit: vi.fn(async () => ({ success: true, runId: 'run-edit' })),
      startDeckEdit: vi.fn(async () => ({ success: true })),
      createSession: vi.fn(async () => ({ success: true, sessionId: 'sess-new' })),
      exportPptx: vi.fn(async () => ({ success: true, outputPath: 'F:\\out\\deck.pptx' })),
      importPptx: vi.fn(async () => ({ success: true, sessionId: 'sess-imported' })),
      importAssets: vi.fn(async () => ({ success: true, assets: [] })),
      deletePage: vi.fn(async () => ({ success: true })),
      deleteSession: vi.fn(async () => ({ success: true })),
      applySessionStyle: vi.fn(async () => undefined),
      cancelSession: vi.fn(async () => true)
    }
    const auth = new ExternalAgentAuthorizationService(
      new InMemoryExternalAgentAuthorizationStore()
    )
    await auth.grantInitial({
      agentId: 'pi',
      name: 'pi',
      version: '1.0.0',
      sessionIds: ['sess-1']
    })
    const executor = new ExternalAgentRuntimeExecutor(operations, product, auth)
    const broker = new ExternalAgentBroker(
      auth,
      {
        async listAuthorizedSessions() {
          return []
        },
        async getSessionWithPages() {
          return null
        }
      },
      '2.3.0',
      operations,
      executor
    )
    const created = await broker.handleRequest('pi', {
      type: 'edit_page',
      input: {
        idempotencyKey: 'edit-1',
        sessionId: 'sess-1',
        pageId: 'page-1',
        instruction: '把副标题改短'
      }
    })
    expect(created.ok).toBe(true)
    await executor.kick('sess-1')
    const running = await operations.listRunning('sess-1')
    expect(running).toHaveLength(1)
    await executor.observeChunk('sess-1', {
      type: 'run_completed',
      payload: { runId: 'run-edit', totalPages: 1, completedPageCount: 1, failedPageCount: 0 }
    })
    expect((await operations.get(running[0].id))?.status).toBe('completed')
  })
})
