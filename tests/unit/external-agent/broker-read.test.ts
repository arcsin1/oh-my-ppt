import { describe, expect, it, beforeEach } from 'vitest'
import {
  ExternalAgentBroker,
  type ExternalAgentBrokerDataSource
} from '../../../src/main/external-agent/broker'
import {
  ExternalAgentAuthorizationService,
  InMemoryExternalAgentAuthorizationStore
} from '../../../src/main/external-agent/authorization'
import {
  EXTERNAL_AGENT_PROTOCOL_VERSION,
  type ExternalAgentBrokerRequest
} from '@shared/external-agent'

describe('ExternalAgentBroker read flow', () => {
  let authStore: InMemoryExternalAgentAuthorizationStore
  let authService: ExternalAgentAuthorizationService
  let dataSource: ExternalAgentBrokerDataSource
  let broker: ExternalAgentBroker

  beforeEach(() => {
    authStore = new InMemoryExternalAgentAuthorizationStore()
    authService = new ExternalAgentAuthorizationService(authStore)

    const mockSessions = [
      {
        session: {
          id: 'sess-1',
          title: '年度工作总结',
          topic: '年终回顾',
          status: 'completed' as const,
          created_at: 1725400000,
          updated_at: 1725403600,
          slideSizeId: 'wide-16-9' as const,
          slideWidth: 1600,
          slideHeight: 900
        },
        pages: [
          {
            page_id: 'page-1',
            page_number: 1,
            title: '封面',
            status: 'completed',
            content_outline: '标题与副标题',
            layout_intent: 'cover',
            assets: [{ kind: 'image' as const, relativePath: './images/hero.png' }]
          },
          {
            page_id: 'page-2',
            page_number: 2,
            title: '目录',
            status: 'completed',
            content_outline: '章节一览',
            layout_intent: 'toc'
          }
        ]
      }
    ]

    dataSource = {
      async listAuthorizedSessions(sessionIds: string[]) {
        return mockSessions.filter((s) => sessionIds.includes(s.session.id))
      },
      async getSessionWithPages(sessionId: string) {
        return mockSessions.find((s) => s.session.id === sessionId) ?? null
      },
      async listAvailableStyles() {
        return [
          {
            id: 'tech-neon',
            name: '赛博科技',
            description: '霓虹暗黑风',
            category: 'tech',
            version: '1.0.0'
          }
        ]
      }
    }

    broker = new ExternalAgentBroker(authService, dataSource, '2.3.0')
  })

  it('rejects unsupported protocol version upon initialize', async () => {
    const req: ExternalAgentBrokerRequest = {
      type: 'initialize',
      input: {
        protocolVersion: '2020-01-01',
        clientInfo: { name: 'old-agent', version: '0.1.0' }
      }
    }

    const res = await broker.handleRequest('agent-1', req)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('PROTOCOL_VERSION_UNSUPPORTED')
    }
  })

  it('does not block other requests while the auth dialog is open', async () => {
    const hanging = new ExternalAgentBroker(
      authService,
      dataSource,
      '2.3.0',
      undefined,
      undefined,
      () => new Promise(() => undefined)
    )
    const init = hanging.handleRequest('agent-new', {
      type: 'initialize',
      input: {
        protocolVersion: EXTERNAL_AGENT_PROTOCOL_VERSION,
        clientInfo: { name: 'claude-code', version: '1.0.0' }
      }
    })
    const caps = hanging.handleRequest('agent-new', { type: 'get_capabilities', input: {} })
    const initRes = await init
    const capsRes = await caps
    expect(initRes.ok).toBe(true)
    expect(capsRes.ok).toBe(true)
  })

  it('succeeds initialize with supported protocol version', async () => {
    const req: ExternalAgentBrokerRequest = {
      type: 'initialize',
      input: {
        protocolVersion: EXTERNAL_AGENT_PROTOCOL_VERSION,
        clientInfo: { name: 'pi-agent', version: '1.0.0' }
      }
    }

    const res = await broker.handleRequest('agent-1', req)
    expect(res.ok).toBe(true)
    if (res.ok) {
      const data = res.data as { authenticated: boolean; protocolVersion: string }
      expect(data.authenticated).toBe(false)
      expect(data.protocolVersion).toBe(EXTERNAL_AGENT_PROTOCOL_VERSION)
    }
  })

  it('returns capabilities including style summaries and slide presets', async () => {
    const res = await broker.handleRequest('agent-1', {
      type: 'get_capabilities',
      input: {}
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      const data = res.data as { availableStyles: Array<{ id: string }> }
      expect(data.availableStyles[0].id).toBe('tech-neon')
    }
  })

  it('blocks list_sessions without authorization', async () => {
    const res = await broker.handleRequest('agent-1', {
      type: 'list_sessions',
      input: { limit: 10 }
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('AUTH_REQUIRED')
    }
  })

  it('allows list_sessions, get_session and get_page within granted sessions', async () => {
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi coding agent',
      version: '1.0.0',
      sessionIds: ['sess-1']
    })

    const listRes = await broker.handleRequest('pi', {
      type: 'list_sessions',
      input: { limit: 10 }
    })
    expect(listRes.ok).toBe(true)
    if (listRes.ok) {
      const data = listRes.data as { sessions: Array<{ id: string; firstPageTitle?: string }> }
      expect(data.sessions).toHaveLength(1)
      expect(data.sessions[0].id).toBe('sess-1')
      expect(data.sessions[0].firstPageTitle).toBe('封面')
    }

    const getSessRes = await broker.handleRequest('pi', {
      type: 'get_session',
      input: { sessionId: 'sess-1' }
    })
    expect(getSessRes.ok).toBe(true)
    if (getSessRes.ok) {
      const data = getSessRes.data as { id: string; pages: Array<{ pageId: string }> }
      expect(data.id).toBe('sess-1')
      expect(data.pages).toHaveLength(2)
    }

    const getPageRes = await broker.handleRequest('pi', {
      type: 'get_page',
      input: { sessionId: 'sess-1', pageId: 'page-1' }
    })
    expect(getPageRes.ok).toBe(true)
    if (getPageRes.ok) {
      const data = getPageRes.data as { pageId: string; assets: Array<{ relativePath: string }> }
      expect(data.pageId).toBe('page-1')
      expect(data.assets[0].relativePath).toBe('./images/hero.png')
    }
  })

  it('blocks access to ungranted sessions', async () => {
    await authService.grantInitial({
      agentId: 'pi',
      name: 'pi coding agent',
      version: '1.0.0',
      sessionIds: ['sess-1']
    })

    const getUngranted = await broker.handleRequest('pi', {
      type: 'get_session',
      input: { sessionId: 'sess-unauthorized' }
    })
    expect(getUngranted.ok).toBe(false)
    if (!getUngranted.ok) {
      expect(getUngranted.error.code).toBe('SESSION_NOT_GRANTED')
    }
  })
})
