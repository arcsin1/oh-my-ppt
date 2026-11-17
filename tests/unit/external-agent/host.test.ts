import { createServer, Socket } from 'net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ExternalAgentAuthorizationService,
  InMemoryExternalAgentAuthorizationStore
} from '../../../src/main/external-agent/authorization'
import { ExternalAgentBroker } from '../../../src/main/external-agent/broker'
import { getFixedLocalEndpoint } from '../../../src/main/external-agent/endpoint'
import {
  encodeNdjsonFrame,
  parseNdjsonFrames,
  startExternalAgentHost,
  type ExternalAgentHost
} from '../../../src/main/external-agent/host'
import { McpBridgeDispatcher } from '../../../src/main/external-agent/mcp-bridge'
import {
  buildInitializeBrokerRequest,
  clientInfoFromParams,
  isMcpStdioLaunch
} from '../../../src/main/external-agent/mcp-stdio'
import {
  ExternalAgentOperationService,
  InMemoryExternalAgentOperationStore
} from '../../../src/main/external-agent/operations'
import { EXTERNAL_AGENT_PROTOCOL_VERSION } from '@shared/external-agent'

function writeLine(socket: Socket, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(`${JSON.stringify(value)}\n`, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

async function readLine(socket: Socket): Promise<unknown> {
  const leftover: string[] = []
  for (;;) {
    const chunk: Buffer = await new Promise((resolve, reject) => {
      socket.once('data', resolve)
      socket.once('error', reject)
    })
    leftover.push(...parseNdjsonFrames(chunk.toString('utf8')))
    const next = leftover.shift()
    if (next) return JSON.parse(next)
  }
}

describe('external agent host', () => {
  const hosts: ExternalAgentHost[] = []

  afterEach(async () => {
    while (hosts.length > 0) {
      await hosts.pop()?.close()
    }
  })

  it('detects the stdio MCP launch flag', () => {
    expect(isMcpStdioLaunch(['node', 'app', '--mcp'])).toBe(true)
    expect(isMcpStdioLaunch(['node', 'app'])).toBe(false)
    const previous = process.env.OH_MY_PPT_MCP
    process.env.OH_MY_PPT_MCP = '1'
    expect(isMcpStdioLaunch(['node', 'app'])).toBe(true)
    if (previous === undefined) delete process.env.OH_MY_PPT_MCP
    else process.env.OH_MY_PPT_MCP = previous
  })

  it('forwards MCP initialize clientInfo to the broker request', () => {
    const request = buildInitializeBrokerRequest({
      clientInfo: { name: 'pi', version: '1.2.3', executablePath: 'C:\\pi.exe' }
    })
    expect(request.type).toBe('initialize')
    expect(request.input.clientInfo).toEqual({
      name: 'pi',
      version: '1.2.3',
      executablePath: 'C:\\pi.exe'
    })
    expect(clientInfoFromParams({}).name).toBe('mcp')
  })

  it('encodes newline-delimited JSON frames', () => {
    expect(encodeNdjsonFrame({ ok: true })).toBe('{"ok":true}\n')
    expect(parseNdjsonFrames('{"a":1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('returns APP_NOT_RUNNING when the local endpoint is missing', async () => {
    const dispatcher = new McpBridgeDispatcher(
      {
        handleRequest: async () => ({ ok: true, data: {} })
      } as never,
      () => false
    )
    const res = await dispatcher.dispatchToolCall('pi', 'get_capabilities')
    expect(res.isError).toBe(true)
    expect(JSON.parse(res.content[0].text).error.code).toBe('APP_NOT_RUNNING')
  })

  it('prompts once, grants default capabilities, then authenticates initialize', async () => {
    const store = new InMemoryExternalAgentAuthorizationStore()
    const auth = new ExternalAgentAuthorizationService(store)
    const operations = new ExternalAgentOperationService(new InMemoryExternalAgentOperationStore())
    const prompt = vi.fn(async () => ({
      approved: true,
      capabilities: ['read', 'create_session', 'generation', 'task_control'],
      sessionIds: ['sess-1'],
      workspaceRoots: []
    }))
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
      undefined,
      prompt
    )

    const first = await broker.handleRequest('pi', {
      type: 'initialize',
      input: {
        protocolVersion: EXTERNAL_AGENT_PROTOCOL_VERSION,
        clientInfo: { name: 'pi', version: '1.0.0', executablePath: 'C:\\pi.exe' }
      }
    })
    expect(first.ok).toBe(true)
    if (first.ok) {
      const data = first.data as { authenticated: boolean }
      expect(data.authenticated).toBe(false)
    }
    expect(prompt).toHaveBeenCalledTimes(1)
    await vi.waitFor(async () => {
      const granted = await auth.checkAccess({
        agentId: 'pi',
        capability: 'read',
        sessionId: 'sess-1'
      })
      expect(granted.authorized).toBe(true)
    })

    const access = await auth.checkAccess({
      agentId: 'pi',
      capability: 'read',
      sessionId: 'sess-1'
    })
    expect(access.authorized).toBe(true)
    expect(access.grant?.capabilities).toContain('generation')
    expect(access.grant?.capabilities).not.toContain('delete_session')

    const second = await broker.handleRequest('pi', {
      type: 'initialize',
      input: {
        protocolVersion: EXTERNAL_AGENT_PROTOCOL_VERSION,
        clientInfo: { name: 'pi', version: '1.0.0' }
      }
    })
    expect(second.ok).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(1)

    await auth.revokeAccess('pi')
    const third = await broker.handleRequest('pi', {
      type: 'initialize',
      input: {
        protocolVersion: EXTERNAL_AGENT_PROTOCOL_VERSION,
        clientInfo: { name: 'pi', version: '1.0.0' }
      }
    })
    expect(third.ok).toBe(true)
    expect(prompt).toHaveBeenCalledTimes(2)
    await vi.waitFor(async () => {
      const restored = await auth.checkAccess({ agentId: 'pi', sessionId: 'sess-1' })
      expect(restored.authorized).toBe(true)
    })
  })

  it('rejects initialize when the user denies first-run authorization', async () => {
    const auth = new ExternalAgentAuthorizationService(
      new InMemoryExternalAgentAuthorizationStore()
    )
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
      undefined,
      undefined,
      async () => ({ approved: false })
    )
    const res = await broker.handleRequest('pi', {
      type: 'initialize',
      input: {
        protocolVersion: EXTERNAL_AGENT_PROTOCOL_VERSION,
        clientInfo: { name: 'pi', version: '1.0.0' }
      }
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      const data = res.data as { authenticated: boolean }
      expect(data.authenticated).toBe(false)
    }
    const access = await auth.checkAccess({ agentId: 'pi', sessionId: 'sess-1' })
    expect(access.authorized).toBe(false)
  })

  it('serves NDJSON broker requests on the local endpoint', async () => {
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
      '2.3.0'
    )
    const listenPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\oh-my-ppt-test-${process.pid}`
        : `${getFixedLocalEndpoint('linux')}.test-${process.pid}`
    const host = await startExternalAgentHost({
      broker,
      listenPath,
      createServerImpl: createServer
    })
    hosts.push(host)
    expect(host.endpoint).toBe(listenPath)

    const socket = await new Promise<Socket>((resolve, reject) => {
      const client = new Socket()
      client.once('error', reject)
      client.connect(listenPath, () => resolve(client))
    })
    await writeLine(socket, {
      id: 'req-1',
      agentId: 'pi',
      request: {
        type: 'initialize',
        input: {
          protocolVersion: EXTERNAL_AGENT_PROTOCOL_VERSION,
          clientInfo: { name: 'pi', version: '1.0.0' }
        }
      }
    })
    const reply = (await readLine(socket)) as { id: string; response: { ok: boolean } }
    expect(reply.id).toBe('req-1')
    expect(reply.response.ok).toBe(true)
    socket.destroy()
  })
})
