import fs from 'fs'
import path from 'path'
import type { IpcContext } from '../ipc/context'

export async function deleteProductSession(
  ctx: Pick<IpcContext, 'db' | 'resolveSessionProjectDir'>,
  sessionId: string
): Promise<void> {
  let projectDir: string | null = null
  try {
    projectDir = await ctx.resolveSessionProjectDir(sessionId)
  } catch {
    projectDir = null
  }
  await ctx.db.deleteSession(sessionId)
  if (!projectDir) return
  const resolved = path.resolve(projectDir)
  if (!resolved || resolved === path.parse(resolved).root) return
  await fs.promises.rm(resolved, { recursive: true, force: true }).catch(() => undefined)
}
