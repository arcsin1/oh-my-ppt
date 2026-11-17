/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { createConnection } from 'node:net'
import os from 'node:os'
import path from 'node:path'

const PROTOCOL = '2026-09-04'
const TOOLS = [
  ['get_capabilities', '获取协议版本、工具、画布尺寸和样式摘要', {}],
  [
    'list_sessions',
    '列出已授权 Session',
    { limit: { type: 'integer' }, cursor: { type: 'string' } }
  ],
  ['get_session', '获取 Session 快照', { sessionId: { type: 'string' } }, ['sessionId']],
  [
    'get_page',
    '获取页面快照',
    { sessionId: { type: 'string' }, pageId: { type: 'string' } },
    ['sessionId', 'pageId']
  ],
  [
    'create_session',
    '创建 Session',
    {
      idempotencyKey: { type: 'string' },
      title: { type: 'string' },
      topic: { type: 'string' },
      styleId: { type: 'string' },
      slideSizeId: { type: 'string' },
      pageCount: { type: 'integer' },
      workspaceRootPath: { type: 'string' }
    },
    ['idempotencyKey', 'title']
  ],
  [
    'start_generation',
    '启动整套生成',
    {
      idempotencyKey: { type: 'string' },
      sessionId: { type: 'string' },
      topic: { type: 'string' },
      prompt: { type: 'string' },
      pageCount: { type: 'integer' },
      styleId: { type: 'string' },
      animationPreferences: { type: 'object' }
    },
    ['idempotencyKey', 'sessionId', 'topic']
  ],
  [
    'edit_page',
    '编辑单页',
    {
      idempotencyKey: { type: 'string' },
      sessionId: { type: 'string' },
      pageId: { type: 'string' },
      instruction: { type: 'string' }
    },
    ['idempotencyKey', 'sessionId', 'pageId', 'instruction']
  ],
  [
    'edit_deck',
    '编辑整套',
    {
      idempotencyKey: { type: 'string' },
      sessionId: { type: 'string' },
      instruction: { type: 'string' }
    },
    ['idempotencyKey', 'sessionId', 'instruction']
  ],
  [
    'import_pptx',
    '导入 PPTX',
    {
      idempotencyKey: { type: 'string' },
      sourcePath: { type: 'string' },
      title: { type: 'string' }
    },
    ['idempotencyKey', 'sourcePath']
  ],
  [
    'import_assets',
    '导入素材',
    {
      idempotencyKey: { type: 'string' },
      sessionId: { type: 'string' },
      sources: { type: 'array' }
    },
    ['idempotencyKey', 'sessionId', 'sources']
  ],
  [
    'export_pptx',
    '导出 PPTX',
    {
      idempotencyKey: { type: 'string' },
      sessionId: { type: 'string' },
      outputPath: { type: 'string' },
      overwrite: { type: 'boolean' }
    },
    ['idempotencyKey', 'sessionId', 'outputPath']
  ],
  ['get_operation', '查询 operation', { operationId: { type: 'string' } }, ['operationId']],
  [
    'get_operation_events',
    '查询 operation 事件',
    { operationId: { type: 'string' }, afterSequence: { type: 'integer' } },
    ['operationId']
  ],
  ['subscribe_events', '订阅 operation 事件', { operationId: { type: 'string' } }, ['operationId']],
  [
    'cancel_operation',
    '取消 operation',
    { idempotencyKey: { type: 'string' }, operationId: { type: 'string' } },
    ['idempotencyKey', 'operationId']
  ],
  [
    'resume_operation',
    '恢复 operation',
    { idempotencyKey: { type: 'string' }, operationId: { type: 'string' } },
    ['idempotencyKey', 'operationId']
  ],
  [
    'delete_page',
    '删除页面（需确认）',
    {
      idempotencyKey: { type: 'string' },
      sessionId: { type: 'string' },
      pageId: { type: 'string' }
    },
    ['idempotencyKey', 'sessionId', 'pageId']
  ],
  [
    'delete_session',
    '删除 Session（需确认）',
    { idempotencyKey: { type: 'string' }, sessionId: { type: 'string' } },
    ['idempotencyKey', 'sessionId']
  ]
].map(([name, description, properties, required]) => ({
  name,
  description,
  inputSchema: {
    type: 'object',
    properties,
    required: required ?? [],
    additionalProperties: true
  }
}))

function username() {
  const user =
    process.env.USER ||
    process.env.USERNAME ||
    process.env.LOGNAME ||
    os.userInfo().username ||
    'default'
  return user
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
}

function endpoint() {
  const user = username()
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\oh-my-ppt-${user}`
    : path.join(os.tmpdir(), `oh-my-ppt-${user}.sock`)
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function rpcError(id, code, message) {
  write({ jsonrpc: '2.0', id: id ?? null, error: { code: -32000, message, data: { code } } })
}

function rpcResult(id, result) {
  write({ jsonrpc: '2.0', id: id ?? null, result })
}

function connectPipe() {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint())
    socket.once('connect', () => resolve(socket))
    socket.once('error', reject)
  })
}

function callBroker(socket, agentId, request, timeoutMs = 12000) {
  const id = `mcp-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return new Promise((resolve, reject) => {
    let leftover = ''
    const onData = (buffer) => {
      leftover += buffer.toString('utf8')
      const parts = leftover.split('\n')
      leftover = parts.pop() ?? ''
      for (const part of parts) {
        if (!part.trim()) continue
        try {
          const parsed = JSON.parse(part)
          if (parsed.id !== id) continue
          cleanup()
          resolve(parsed.response)
          return
        } catch (error) {
          cleanup()
          reject(error)
        }
      }
    }
    const onError = (error) => {
      cleanup()
      reject(error)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Oh My PPT 在 12 秒内没有响应，请确认应用已打开并批准授权弹窗'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
    }
    socket.on('data', onData)
    socket.once('error', onError)
    socket.write(`${JSON.stringify({ id, agentId, request })}\n`)
  })
}

const agentId = process.env.OH_MY_PPT_AGENT_ID?.trim() || 'claude-code'

let socket = null
try {
  socket = await connectPipe()
} catch {
  write({
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32000,
      message: 'Oh My PPT 桌面应用未在运行，请先启动应用',
      data: { code: 'APP_NOT_RUNNING' }
    }
  })
}

let leftover = ''
let queue = Promise.resolve()
process.stdin.setEncoding('utf8')
process.stdin.resume()
process.stdin.on('data', (chunk) => {
  leftover += chunk
  const frames = leftover.split('\n')
  leftover = frames.pop() ?? ''
  queue = queue.then(async () => {
    for (const frame of frames) {
      if (!frame.trim()) continue
      let parsed
      try {
        parsed = JSON.parse(frame)
      } catch {
        rpcError(null, 'VALIDATION_FAILED', 'MCP 请求不是合法 JSON')
        continue
      }
      const id = parsed.id ?? null
      if (parsed.method === 'initialize') {
        if (socket) {
          const clientInfo = parsed.params?.clientInfo ?? {}
          void callBroker(socket, agentId, {
            type: 'initialize',
            input: {
              protocolVersion: PROTOCOL,
              clientInfo: {
                name: clientInfo.name || 'claude-code',
                version: clientInfo.version || '0.0.0',
                executablePath: process.execPath
              }
            }
          }).catch(() => undefined)
        }
        rpcResult(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'oh-my-ppt-mcp', version: PROTOCOL }
        })
        continue
      }
      if (parsed.method === 'notifications/initialized' || parsed.method === 'initialized') continue
      if (parsed.method === 'tools/list') {
        rpcResult(id, { tools: TOOLS })
        continue
      }
      if (parsed.method === 'tools/call') {
        const name = parsed.params?.name ?? ''
        const args = parsed.params?.arguments ?? {}
        if (!TOOLS.some((tool) => tool.name === name)) {
          rpcError(id, 'VALIDATION_FAILED', `未知的 MCP 工具名称: ${name}`)
          continue
        }
        if (!socket) {
          rpcError(id, 'APP_NOT_RUNNING', 'Oh My PPT 桌面应用未在运行，请先启动应用')
          continue
        }
        try {
          const response = await callBroker(socket, agentId, { type: name, input: args })
          rpcResult(id, {
            content: [{ type: 'text', text: JSON.stringify(response) }],
            isError: Boolean(response && response.ok === false)
          })
        } catch (error) {
          rpcError(id, 'BROKER_UNAVAILABLE', error instanceof Error ? error.message : String(error))
        }
        continue
      }
      rpcError(id, 'VALIDATION_FAILED', `不支持的 MCP 方法: ${parsed.method ?? ''}`)
    }
  })
})
