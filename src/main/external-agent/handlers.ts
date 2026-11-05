import { BrowserWindow, app, ipcMain } from 'electron'
import {
  EXTERNAL_AGENT_DEFAULT_CAPABILITIES,
  type ExternalAgentCapability,
  type ExternalAgentConfirmationPrompt
} from '@shared/external-agent'
import type { ExternalAgentAuthorizationService } from './authorization'
import type { ExternalAgentAuthPromptInput } from './broker'
import { startExternalAgentHost, type ExternalAgentHost } from './host'
import type { ExternalAgentBroker } from './broker'
import type { ExternalAgentOperationService } from './operations'
import type { ExternalAgentRuntimeExecutor } from './runtime-executor'
import { resolveMcpLaunch } from './mcp-launch'

export interface ExternalAgentSummary {
  id: string
  name: string
  version: string
  executablePath?: string
  capabilities: ExternalAgentCapability[]
  sessionIds: string[]
  sessions: Array<{ id: string; title: string }>
  workspaceRoots: string[]
  createdAt: string
  lastUsedAt?: string | null
  revokedAt?: string | null
  connected: boolean
}

type PendingAuthDecision = {
  approved: boolean
  capabilities?: ExternalAgentCapability[]
  sessionIds?: string[]
  workspaceRoots?: string[]
}

const pendingAuth = new Map<
  string,
  {
    payload: {
      agentId: string
      name: string
      version: string
      executablePath?: string
      defaultCapabilities: ExternalAgentCapability[]
    }
    resolve: (value: PendingAuthDecision) => void
  }
>()

const pendingConfirmations = new Map<
  string,
  {
    payload: ExternalAgentConfirmationPrompt
    resolve: (approved: boolean) => void
  }
>()

function authPayload(input: ExternalAgentAuthPromptInput): {
  agentId: string
  name: string
  version: string
  executablePath?: string
  defaultCapabilities: ExternalAgentCapability[]
} {
  return {
    ...input,
    defaultCapabilities: [...EXTERNAL_AGENT_DEFAULT_CAPABILITIES]
  }
}

export function createRendererAuthPrompt(
  getWindow: () => BrowserWindow | null
): (input: ExternalAgentAuthPromptInput) => Promise<PendingAuthDecision> {
  return (input) =>
    new Promise((resolve) => {
      const payload = authPayload(input)
      pendingAuth.set(input.agentId, { payload, resolve })
      const window = getWindow()
      if (!window || window.isDestroyed()) return
      window.show()
      window.focus()
      window.webContents.send('external-agent:auth-request', payload)
    })
}

export function createRendererConfirmationPrompt(
  getWindow: () => BrowserWindow | null
): (input: ExternalAgentConfirmationPrompt) => Promise<boolean> {
  return (input) =>
    new Promise((resolve) => {
      pendingConfirmations.set(input.operationId, { payload: input, resolve })
      const window = getWindow()
      if (!window || window.isDestroyed()) return
      window.show()
      window.focus()
      window.webContents.send('external-agent:confirm-request', input)
    })
}

export async function startBrokerHost(broker: ExternalAgentBroker): Promise<ExternalAgentHost> {
  return startExternalAgentHost({ broker })
}

export function registerExternalAgentHandlers(args: {
  auth: ExternalAgentAuthorizationService
  operations: ExternalAgentOperationService
  executor: ExternalAgentRuntimeExecutor
  listSessions: () => Promise<Array<{ id: string; title: string }>>
  getStoragePath: () => Promise<string>
}): void {
  ipcMain.handle('external-agent:bridge-command', async () => {
    return resolveMcpLaunch({
      executable: app.getPath('exe'),
      packaged: app.isPackaged,
      appPath: app.getAppPath(),
      nodeExecutable: 'node'
    })
  })

  ipcMain.handle('external-agent:auth-options', async () => {
    const [sessions, storagePath] = await Promise.all([args.listSessions(), args.getStoragePath()])
    return {
      sessions,
      defaultWorkspaceRoot: storagePath || ''
    }
  })

  ipcMain.handle('external-agent:pending-auth', async () => {
    const first = pendingAuth.values().next().value
    return first?.payload ?? null
  })

  ipcMain.handle('external-agent:pending-confirm', async () => {
    const first = pendingConfirmations.values().next().value
    return first?.payload ?? null
  })

  ipcMain.handle('external-agent:list', async () => {
    const [agents, grants, sessions] = await Promise.all([
      args.auth.listAgents(),
      args.auth.listGrants(),
      args.listSessions()
    ])
    const grantByAgent = new Map(grants.map((grant) => [grant.agentId, grant]))
    const titleById = new Map(sessions.map((session) => [session.id, session.title]))
    return agents.map((agent): ExternalAgentSummary => {
      const grant = grantByAgent.get(agent.id)
      const sessionIds = grant?.sessionIds ?? []
      return {
        id: agent.id,
        name: agent.name,
        version: agent.version,
        executablePath: agent.executablePath,
        capabilities: grant?.capabilities ?? [],
        sessionIds,
        sessions: sessionIds.map((id) => ({ id, title: titleById.get(id) || id })),
        workspaceRoots: grant?.workspaceRoots ?? [],
        createdAt: agent.createdAt,
        lastUsedAt: agent.lastUsedAt ?? grant?.lastUsedAt,
        revokedAt: agent.revokedAt ?? grant?.revokedAt,
        connected: !agent.revokedAt && !grant?.revokedAt
      }
    })
  })

  ipcMain.handle('external-agent:revoke', async (_event, agentId: string) => {
    if (!agentId) return { success: false }
    const sessionIds = await args.operations.revokeAgentOperations(agentId)
    for (const sessionId of sessionIds) {
      await args.executor.cancelProduct(sessionId)
    }
    await args.auth.revokeAccess(agentId)
    return { success: true }
  })

  ipcMain.handle(
    'external-agent:update-grant',
    async (
      _event,
      payload: { agentId: string; sessionIds: string[]; workspaceRoots: string[] }
    ) => {
      if (!payload?.agentId) return { success: false }
      const updated = await args.auth.updateGrant(payload.agentId, {
        sessionIds: payload.sessionIds,
        workspaceRoots: payload.workspaceRoots
      })
      if (!updated) return { success: false }
      if (updated.removedSessionIds.length > 0) {
        const sessionIds = await args.operations.revokeAgentOperations(
          payload.agentId,
          updated.removedSessionIds
        )
        for (const sessionId of sessionIds) {
          await args.executor.cancelProduct(sessionId)
        }
      }
      return { success: true }
    }
  )

  ipcMain.handle(
    'external-agent:auth-respond',
    async (
      _event,
      payload: {
        agentId: string
        approved: boolean
        capabilities?: ExternalAgentCapability[]
        sessionIds?: string[]
        workspaceRoots?: string[]
      }
    ) => {
      const pending = pendingAuth.get(payload.agentId)
      if (!pending) return { success: false }
      pendingAuth.delete(payload.agentId)
      pending.resolve({
        approved: payload.approved,
        capabilities: payload.capabilities,
        sessionIds: payload.sessionIds,
        workspaceRoots: payload.workspaceRoots
      })
      return { success: true }
    }
  )

  ipcMain.handle(
    'external-agent:confirm-respond',
    async (_event, payload: { operationId: string; approved: boolean }) => {
      const pending = pendingConfirmations.get(payload.operationId)
      if (!pending) return { success: false }
      pendingConfirmations.delete(payload.operationId)
      pending.resolve(payload.approved)
      return { success: true }
    }
  )
}
