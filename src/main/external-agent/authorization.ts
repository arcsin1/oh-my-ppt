import path from 'path'
import fs from 'fs'
import {
  createExternalAgentError,
  type ExternalAgentCapability,
  type ExternalAgentErrorPayload,
  EXTERNAL_AGENT_DEFAULT_CAPABILITIES
} from '@shared/external-agent'

export interface ExternalAgentRecord {
  id: string
  name: string
  version: string
  executablePath?: string
  credentialId?: string | null
  lastUsedAt?: string | null
  revokedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ExternalAgentGrantRecord {
  id: string
  agentId: string
  capabilities: ExternalAgentCapability[]
  sessionIds: string[]
  workspaceRoots: string[]
  lastUsedAt?: string | null
  revokedAt?: string | null
  createdAt: string
  updatedAt: string
}

export interface ExternalAgentAuthorizationStore {
  getAgent(agentId: string): Promise<ExternalAgentRecord | null>
  getGrant(agentId: string): Promise<ExternalAgentGrantRecord | null>
  listAgents(): Promise<ExternalAgentRecord[]>
  listGrants(): Promise<ExternalAgentGrantRecord[]>
  saveAgent(agent: ExternalAgentRecord): Promise<void>
  saveGrant(grant: ExternalAgentGrantRecord): Promise<void>
  revokeAgent(agentId: string): Promise<void>
  revokeGrant(agentId: string): Promise<void>
  touchLastUsed?(agentId: string, at: string): Promise<void>
}

export class InMemoryExternalAgentAuthorizationStore implements ExternalAgentAuthorizationStore {
  private agents = new Map<string, ExternalAgentRecord>()
  private grants = new Map<string, ExternalAgentGrantRecord>()

  async getAgent(agentId: string): Promise<ExternalAgentRecord | null> {
    return this.agents.get(agentId) ?? null
  }

  async getGrant(agentId: string): Promise<ExternalAgentGrantRecord | null> {
    return this.grants.get(agentId) ?? null
  }

  async listAgents(): Promise<ExternalAgentRecord[]> {
    return [...this.agents.values()]
  }

  async listGrants(): Promise<ExternalAgentGrantRecord[]> {
    return [...this.grants.values()]
  }

  async saveAgent(agent: ExternalAgentRecord): Promise<void> {
    this.agents.set(agent.id, agent)
  }

  async saveGrant(grant: ExternalAgentGrantRecord): Promise<void> {
    this.grants.set(grant.agentId, grant)
  }

  async revokeAgent(agentId: string): Promise<void> {
    const existing = this.agents.get(agentId)
    if (existing) {
      existing.revokedAt = new Date().toISOString()
      existing.updatedAt = existing.revokedAt
    }
  }

  async revokeGrant(agentId: string): Promise<void> {
    const existing = this.grants.get(agentId)
    if (existing) {
      existing.revokedAt = new Date().toISOString()
      existing.updatedAt = existing.revokedAt
    }
  }

  async touchLastUsed(agentId: string, at: string): Promise<void> {
    const agent = this.agents.get(agentId)
    if (agent) {
      agent.lastUsedAt = at
      agent.updatedAt = at
    }
    const grant = this.grants.get(agentId)
    if (grant) {
      grant.lastUsedAt = at
      grant.updatedAt = at
    }
  }
}

export interface AuthorizationCheckResult {
  authorized: boolean
  error?: ExternalAgentErrorPayload
  grant?: ExternalAgentGrantRecord
}

export function isPathInsideRoot(targetPath: string, rootPath: string): boolean {
  const normTarget = path.resolve(targetPath)
  const normRoot = path.resolve(rootPath)

  if (process.platform === 'win32') {
    const lowerTarget = normTarget.toLowerCase()
    const lowerRoot = normRoot.toLowerCase()
    if (lowerTarget === lowerRoot) return true
    const prefix = lowerRoot.endsWith(path.sep) ? lowerRoot : lowerRoot + path.sep
    return lowerTarget.startsWith(prefix)
  }

  if (normTarget === normRoot) return true
  const prefix = normRoot.endsWith(path.sep) ? normRoot : normRoot + path.sep
  return normTarget.startsWith(prefix)
}

export interface SafePathCheckResult {
  ok: boolean
  resolvedPath?: string
  error?: ExternalAgentErrorPayload
}

export function validateSafePath(args: {
  targetPath: string
  authorizedRoots: string[]
  mustExist?: boolean
  allowMissingLeaf?: boolean
}): SafePathCheckResult {
  const { targetPath, authorizedRoots, mustExist = false, allowMissingLeaf = false } = args
  if (!targetPath || !targetPath.trim()) {
    return {
      ok: false,
      error: createExternalAgentError({
        code: 'VALIDATION_FAILED',
        message: '路径不能为空'
      })
    }
  }

  const rawNormalized = path.resolve(targetPath.trim())

  let realTargetPath = rawNormalized
  try {
    if (fs.existsSync(rawNormalized)) {
      realTargetPath = fs.realpathSync(rawNormalized)
    } else if (allowMissingLeaf) {
      const parent = path.dirname(rawNormalized)
      if (fs.existsSync(parent)) {
        const realParent = fs.realpathSync(parent)
        realTargetPath = path.join(realParent, path.basename(rawNormalized))
      } else if (mustExist) {
        return {
          ok: false,
          error: createExternalAgentError({
            code: 'PATH_OUTSIDE_AUTHORIZED_ROOT',
            message: '目标路径或其父级目录不存在'
          })
        }
      }
    } else if (mustExist) {
      return {
        ok: false,
        error: createExternalAgentError({
          code: 'PATH_OUTSIDE_AUTHORIZED_ROOT',
          message: '目标文件不存在'
        })
      }
    }
  } catch (err) {
    return {
      ok: false,
      error: createExternalAgentError({
        code: 'VALIDATION_FAILED',
        message: '解析路径时发生错误',
        details: { path: targetPath, error: String(err) }
      })
    }
  }

  let matchedRoot: string | null = null
  for (const root of authorizedRoots) {
    let realRoot = path.resolve(root)
    try {
      if (fs.existsSync(realRoot)) {
        realRoot = fs.realpathSync(realRoot)
      }
    } catch {
      // ignore
    }

    if (isPathInsideRoot(realTargetPath, realRoot)) {
      matchedRoot = root
      break
    }
  }

  if (!matchedRoot) {
    return {
      ok: false,
      error: createExternalAgentError({
        code: 'PATH_OUTSIDE_AUTHORIZED_ROOT',
        message: '路径不在授权工作区根目录范围内',
        details: { targetPath: path.basename(targetPath) }
      })
    }
  }

  return {
    ok: true,
    resolvedPath: realTargetPath
  }
}

export class ExternalAgentAuthorizationService {
  constructor(private store: ExternalAgentAuthorizationStore) {}

  async checkAccess(args: {
    agentId: string
    capability?: ExternalAgentCapability
    sessionId?: string
  }): Promise<AuthorizationCheckResult> {
    const { agentId, capability, sessionId } = args

    const agent = await this.store.getAgent(agentId)
    if (!agent) {
      return {
        authorized: false,
        error: createExternalAgentError({
          code: 'AUTH_REQUIRED',
          message: `Agent ${agentId} 未注册或需要重新授权`,
          details: { agentId }
        })
      }
    }

    if (agent.revokedAt) {
      return {
        authorized: false,
        error: createExternalAgentError({
          code: 'AUTH_REVOKED',
          message: `Agent ${agentId} 的访问权限已被用户撤回`,
          details: { agentId }
        })
      }
    }

    const grant = await this.store.getGrant(agentId)
    if (!grant || grant.revokedAt) {
      return {
        authorized: false,
        error: createExternalAgentError({
          code: 'AUTH_REVOKED',
          message: `Agent ${agentId} 缺少有效授权或授权已被撤销`,
          details: { agentId }
        })
      }
    }

    if (capability && !grant.capabilities.includes(capability)) {
      return {
        authorized: false,
        error: createExternalAgentError({
          code: 'NOT_AUTHORIZED',
          message: `Agent ${agentId} 未被授予能力: ${capability}`,
          details: { capability }
        })
      }
    }

    if (capability === 'create_session') {
      return { authorized: true, grant }
    }

    if (sessionId && !grant.sessionIds.includes(sessionId)) {
      return {
        authorized: false,
        error: createExternalAgentError({
          code: 'SESSION_NOT_GRANTED',
          message: `Session ${sessionId} 未在 Agent ${agentId} 的授权列表中`,
          details: { sessionId }
        })
      }
    }

    return {
      authorized: true,
      grant
    }
  }

  async grantInitial(args: {
    agentId: string
    name: string
    version: string
    executablePath?: string
    capabilities?: ExternalAgentCapability[]
    sessionIds?: string[]
    workspaceRoots?: string[]
  }): Promise<ExternalAgentGrantRecord> {
    const now = new Date().toISOString()
    const capabilities = args.capabilities ?? [...EXTERNAL_AGENT_DEFAULT_CAPABILITIES]
    const existingAgent = await this.store.getAgent(args.agentId)
    const existingGrant = await this.store.getGrant(args.agentId)

    const agent: ExternalAgentRecord = {
      id: args.agentId,
      name: args.name,
      version: args.version,
      executablePath: args.executablePath,
      createdAt: existingAgent?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: now,
      revokedAt: null
    }
    await this.store.saveAgent(agent)

    const grant: ExternalAgentGrantRecord = {
      id: existingGrant?.id ?? `grant_${args.agentId}_${Date.now()}`,
      agentId: args.agentId,
      capabilities,
      sessionIds: args.sessionIds ?? [],
      workspaceRoots: (args.workspaceRoots ?? []).map((r) => path.resolve(r)),
      createdAt: existingGrant?.createdAt ?? now,
      updatedAt: now,
      lastUsedAt: now,
      revokedAt: null
    }
    await this.store.saveGrant(grant)
    return grant
  }

  async attachSession(agentId: string, sessionId: string): Promise<boolean> {
    const grant = await this.store.getGrant(agentId)
    if (!grant || grant.revokedAt) return false
    if (!grant.sessionIds.includes(sessionId)) {
      grant.sessionIds.push(sessionId)
      grant.updatedAt = new Date().toISOString()
      await this.store.saveGrant(grant)
    }
    return true
  }

  async updateGrant(
    agentId: string,
    patch: { sessionIds?: string[]; workspaceRoots?: string[] }
  ): Promise<{ grant: ExternalAgentGrantRecord; removedSessionIds: string[] } | null> {
    const [agent, grant] = await Promise.all([
      this.store.getAgent(agentId),
      this.store.getGrant(agentId)
    ])
    if (!agent || agent.revokedAt || !grant || grant.revokedAt) return null

    const sessionIds = patch.sessionIds ?? grant.sessionIds
    const uniqueSessionIds = [...new Set(sessionIds.filter(Boolean))]
    const removedSessionIds = grant.sessionIds.filter((id) => !uniqueSessionIds.includes(id))
    const workspaceRoots =
      patch.workspaceRoots === undefined
        ? grant.workspaceRoots
        : [
            ...new Set(
              patch.workspaceRoots.flatMap((root) => {
                const trimmed = root.trim()
                return trimmed ? [path.resolve(trimmed)] : []
              })
            )
          ]

    const next: ExternalAgentGrantRecord = {
      ...grant,
      sessionIds: uniqueSessionIds,
      workspaceRoots,
      updatedAt: new Date().toISOString()
    }
    await this.store.saveGrant(next)
    return { grant: next, removedSessionIds }
  }

  async getAgent(agentId: string): Promise<ExternalAgentRecord | null> {
    return this.store.getAgent(agentId)
  }

  async listAgents(): Promise<ExternalAgentRecord[]> {
    return this.store.listAgents()
  }

  async listGrants(): Promise<ExternalAgentGrantRecord[]> {
    return this.store.listGrants()
  }

  async revokeAccess(agentId: string): Promise<void> {
    await this.store.revokeAgent(agentId)
    await this.store.revokeGrant(agentId)
  }

  async touchLastUsed(agentId: string, at = new Date().toISOString()): Promise<void> {
    await this.store.touchLastUsed?.(agentId, at)
  }
}
