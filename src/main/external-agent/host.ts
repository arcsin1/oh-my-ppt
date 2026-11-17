import { createServer, type Server, type Socket } from 'net'
import fs from 'fs'
import { createExternalAgentError, type ExternalAgentBrokerRequest } from '@shared/external-agent'
import type { ExternalAgentBroker } from './broker'
import { getFixedLocalEndpoint } from './endpoint'

export type CreateNetServer = typeof createServer

export interface ExternalAgentHost {
  endpoint: string
  close(): Promise<void>
}

export function encodeNdjsonFrame(value: unknown): string {
  return `${JSON.stringify(value)}\n`
}

export function parseNdjsonFrames(chunk: string, leftover = ''): string[] {
  const combined = leftover + chunk
  const parts = combined.split('\n')
  return parts.slice(0, -1).filter((line) => line.trim().length > 0)
}

export function leftoverNdjson(chunk: string, leftover = ''): string {
  const combined = leftover + chunk
  const lastBreak = combined.lastIndexOf('\n')
  return lastBreak === -1 ? combined : combined.slice(lastBreak + 1)
}

export async function startExternalAgentHost(args: {
  broker: ExternalAgentBroker
  listenPath?: string
  createServerImpl?: CreateNetServer
}): Promise<ExternalAgentHost> {
  const endpoint = args.listenPath ?? getFixedLocalEndpoint()
  if (process.platform !== 'win32' && fs.existsSync(endpoint)) {
    try {
      fs.unlinkSync(endpoint)
    } catch {
      // stale socket; listen() will fail loudly if it is still in use
    }
  }

  const create = args.createServerImpl ?? createServer
  const server: Server = create((socket) => attachSocket(socket, args.broker))

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, () => {
      server.off('error', reject)
      resolve()
    })
  })

  return {
    endpoint,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
  }
}

function attachSocket(socket: Socket, broker: ExternalAgentBroker): void {
  let leftover = ''
  socket.on('data', (buffer) => {
    const text = buffer.toString('utf8')
    const frames = parseNdjsonFrames(text, leftover)
    leftover = leftoverNdjson(text, leftover)
    void handleFrames(socket, broker, frames)
  })
}

async function handleFrames(
  socket: Socket,
  broker: ExternalAgentBroker,
  frames: string[]
): Promise<void> {
  for (const frame of frames) {
    let id = ''
    try {
      const parsed = JSON.parse(frame) as {
        id?: unknown
        agentId?: unknown
        request?: unknown
      }
      id = typeof parsed.id === 'string' ? parsed.id : ''
      const agentId = typeof parsed.agentId === 'string' ? parsed.agentId : ''
      if (!id || !agentId || !parsed.request || typeof parsed.request !== 'object') {
        socket.write(
          encodeNdjsonFrame({
            id,
            response: {
              ok: false,
              error: createExternalAgentError({
                code: 'VALIDATION_FAILED',
                message: '请求必须包含 id、agentId 和 request'
              })
            }
          })
        )
        continue
      }
      const response = await broker.handleRequest(
        agentId,
        parsed.request as ExternalAgentBrokerRequest
      )
      socket.write(encodeNdjsonFrame({ id, response }))
    } catch (error) {
      socket.write(
        encodeNdjsonFrame({
          id,
          response: {
            ok: false,
            error: createExternalAgentError({
              code: 'VALIDATION_FAILED',
              message: error instanceof Error ? error.message : String(error)
            })
          }
        })
      )
    }
  }
}
