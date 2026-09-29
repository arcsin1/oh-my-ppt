import { describe, expect, it, beforeEach } from 'vitest'
import {
  McpBridgeDispatcher,
  getMcpToolDefinitions,
  isKnownMcpToolName,
  mapMcpCallToBrokerRequest
} from '../../../src/main/external-agent/mcp-bridge'
import { ExternalAgentBroker } from '../../../src/main/external-agent/broker'
import {
  ExternalAgentAuthorizationService,
  InMemoryExternalAgentAuthorizationStore
} from '../../../src/main/external-agent/authorization'
import {
  getFixedLocalEndpoint,
  getLocalAgentUsername
} from '../../../src/main/external-agent/endpoint'

describe('MCP Bridge and Local Endpoint', () => {
  it('computes isolated local endpoint by user and platform', () => {
    const user = getLocalAgentUsername()
    expect(user.length).toBeGreaterThan(0)

    const winEndpoint = getFixedLocalEndpoint('win32')
    expect(winEndpoint).toContain('\\\\.\\pipe\\oh-my-ppt-')

    const unixEndpoint = getFixedLocalEndpoint('linux')
    expect(unixEndpoint).toContain('oh-my-ppt-')
    expect(unixEndpoint.endsWith('.sock')).toBe(true)
  })

  it('declares the 18 specified MCP tool definitions', () => {
    const tools = getMcpToolDefinitions()
    expect(tools).toHaveLength(18)
    const toolNames = tools.map((t) => t.name)
    expect(toolNames).toContain('get_capabilities')
    expect(toolNames).toContain('list_sessions')
    expect(toolNames).toContain('create_session')
    expect(toolNames).toContain('start_generation')
    expect(toolNames).toContain('import_pptx')
    expect(toolNames).toContain('export_pptx')
    expect(toolNames).toContain('delete_session')
  })

  it('maps known tool calls and rejects unknown tools', () => {
    expect(isKnownMcpToolName('get_capabilities')).toBe(true)
    expect(isKnownMcpToolName('invalid_tool')).toBe(false)

    const mapped = mapMcpCallToBrokerRequest('get_session', { sessionId: 's-1' })
    expect(mapped.type).toBe('get_session')

    expect(() => mapMcpCallToBrokerRequest('unknown', {})).toThrow(/未知的 MCP 工具名称/)
  })

  describe('McpBridgeDispatcher', () => {
    let authStore: InMemoryExternalAgentAuthorizationStore
    let authService: ExternalAgentAuthorizationService
    let broker: ExternalAgentBroker

    beforeEach(() => {
      authStore = new InMemoryExternalAgentAuthorizationStore()
      authService = new ExternalAgentAuthorizationService(authStore)
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
        '2.3.0'
      )
    })

    it('returns APP_NOT_RUNNING when app is not running', async () => {
      const dispatcher = new McpBridgeDispatcher(broker, () => false)
      const res = await dispatcher.dispatchToolCall('agent-1', 'get_capabilities', {})

      expect(res.isError).toBe(true)
      const payload = JSON.parse(res.content[0].text)
      expect(payload.error.code).toBe('APP_NOT_RUNNING')
      expect(payload.error.retryable).toBe(true)
    })

    it('dispatches to broker and returns serialized JSON content when app is running', async () => {
      const dispatcher = new McpBridgeDispatcher(broker, () => true)
      const res = await dispatcher.dispatchToolCall('agent-1', 'get_capabilities', {})

      expect(res.isError).toBe(false)
      const payload = JSON.parse(res.content[0].text)
      expect(payload.ok).toBe(true)
      expect(payload.data.supportedTools).toContain('get_capabilities')
    })
  })
})
