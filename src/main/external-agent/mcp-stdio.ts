import { createConnection, type Socket } from 'net'
import { createExternalAgentError, EXTERNAL_AGENT_PROTOCOL_VERSION } from '@shared/external-agent'
import { getFixedLocalEndpoint } from './endpoint'
import { encodeNdjsonFrame, leftoverNdjson, parseNdjsonFrames } from './host'
import { getMcpToolDefinitions, isKnownMcpToolName } from './mcp-bridge'

type JsonRpcRequest = {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export function isMcpStdioLaunch(argv = process.argv): boolean {
  return (
    process.env.OH_MY_PPT_MCP === '1' || argv.includes('--mcp') || argv.includes('--oh-my-ppt-mcp')
  )
}

function writeStdout(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function rpcError(id: string | number | null | undefined, code: string, message: string): void {
  writeStdout({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32000, message, data: { code } }
  })
}

function rpcResult(id: string | number | null | undefined, result: unknown): void {
  writeStdout({ jsonrpc: '2.0', id: id ?? null, result })
}

async function callBroker(socket: Socket, agentId: string, request: unknown): Promise<unknown> {
  const id = `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  socket.write(encodeNdjsonFrame({ id, agentId, request }))
  return new Promise((resolve, reject) => {
    let leftover = ''
    const onData = (buffer: Buffer): void => {
      const text = buffer.toString('utf8')
      const frames = parseNdjsonFrames(text, leftover)
      leftover = leftoverNdjson(text, leftover)
      for (const frame of frames) {
        try {
          const parsed = JSON.parse(frame) as { id?: string; response?: unknown }
          if (parsed.id !== id) continue
          socket.off('data', onData)
          resolve(parsed.response)
          return
        } catch (error) {
          socket.off('data', onData)
          reject(error)
        }
      }
    }
    socket.on('data', onData)
    socket.once('error', reject)
  })
}

export async function runMcpStdioBridge(args?: {
  endpoint?: string
  connect?: (endpoint: string) => Promise<Socket>
}): Promise<void> {
  const endpoint = args?.endpoint ?? getFixedLocalEndpoint()
  const connect =
    args?.connect ??
    ((path: string) =>
      new Promise<Socket>((resolve, reject) => {
        const socket = createConnection(path)
        socket.once('connect', () => resolve(socket))
        socket.once('error', reject)
      }))

  let socket: Socket | null = null
  try {
    socket = await connect(endpoint)
  } catch {
    writeStdout({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: 'Oh My PPT 桌面应用未在运行，请先启动应用',
        data: createExternalAgentError({
          code: 'APP_NOT_RUNNING',
          message: 'Oh My PPT 桌面应用未在运行，请先启动应用'
        })
      }
    })
  }

  const agentId = process.env.OH_MY_PPT_AGENT_ID?.trim() || 'local-mcp'
  let leftover = ''
  let queue = Promise.resolve()
  process.stdin.setEncoding('utf8')
  process.stdin.resume()
  process.stdin.on('data', (chunk: string) => {
    const frames = parseNdjsonFrames(chunk, leftover)
    leftover = leftoverNdjson(chunk, leftover)
    queue = queue
      .then(async () => {
        for (const frame of frames) {
          let parsed: JsonRpcRequest
          try {
            parsed = JSON.parse(frame) as JsonRpcRequest
          } catch {
            rpcError(null, 'VALIDATION_FAILED', 'MCP 请求不是合法 JSON')
            continue
          }
          await handleRpc(parsed, socket, agentId)
        }
      })
      .catch((error) => {
        rpcError(null, 'INTERNAL_ERROR', error instanceof Error ? error.message : String(error))
      })
  })
}

export function clientInfoFromParams(params?: Record<string, unknown>): {
  name: string
  version: string
  executablePath?: string
} {
  const clientInfo =
    params && typeof params.clientInfo === 'object' && params.clientInfo
      ? (params.clientInfo as Record<string, unknown>)
      : {}
  const name =
    typeof clientInfo.name === 'string' && clientInfo.name.trim() ? clientInfo.name : 'mcp'
  const version =
    typeof clientInfo.version === 'string' && clientInfo.version.trim()
      ? clientInfo.version
      : '0.0.0'
  const executablePath =
    typeof clientInfo.executablePath === 'string' ? clientInfo.executablePath : process.execPath
  return { name, version, executablePath }
}

export function buildInitializeBrokerRequest(params?: Record<string, unknown>): {
  type: 'initialize'
  input: {
    protocolVersion: string
    clientInfo: { name: string; version: string; executablePath?: string }
  }
} {
  return {
    type: 'initialize',
    input: {
      protocolVersion: EXTERNAL_AGENT_PROTOCOL_VERSION,
      clientInfo: clientInfoFromParams(params)
    }
  }
}

async function handleRpc(
  parsed: JsonRpcRequest,
  socket: Socket | null,
  agentId: string
): Promise<void> {
  const id = parsed.id ?? null
  if (parsed.method === 'initialize') {
    if (!socket) {
      rpcError(id, 'APP_NOT_RUNNING', 'Oh My PPT 桌面应用未在运行，请先启动应用')
      return
    }
    // MCP handshake must return immediately. Claude Code times out at 30s if we wait for the auth dialog.
    void callBroker(socket, agentId, buildInitializeBrokerRequest(parsed.params)).catch(
      () => undefined
    )
    rpcResult(id, {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'oh-my-ppt-mcp', version: EXTERNAL_AGENT_PROTOCOL_VERSION }
    })
    return
  }
  if (parsed.method === 'notifications/initialized' || parsed.method === 'initialized') {
    return
  }
  if (parsed.method === 'tools/list') {
    rpcResult(id, { tools: getMcpToolDefinitions() })
    return
  }
  if (parsed.method === 'tools/call') {
    const params = parsed.params ?? {}
    const name = typeof params.name === 'string' ? params.name : ''
    const args =
      params.arguments && typeof params.arguments === 'object'
        ? (params.arguments as Record<string, unknown>)
        : {}
    if (!isKnownMcpToolName(name)) {
      rpcError(id, 'VALIDATION_FAILED', `未知的 MCP 工具名称: ${name}`)
      return
    }
    if (!socket) {
      rpcResult(id, {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: createExternalAgentError({
                code: 'APP_NOT_RUNNING',
                message: 'Oh My PPT 桌面应用未在运行，请先启动应用'
              })
            })
          }
        ],
        isError: true
      })
      return
    }
    const response = await callBroker(socket, agentId, { type: name, input: args })
    rpcResult(id, {
      content: [{ type: 'text', text: JSON.stringify(response) }],
      isError: Boolean(
        response && typeof response === 'object' && 'ok' in response && response.ok === false
      )
    })
    return
  }
  rpcError(id, 'VALIDATION_FAILED', `不支持的 MCP 方法: ${parsed.method ?? ''}`)
}
