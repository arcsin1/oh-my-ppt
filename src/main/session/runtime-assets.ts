import fs from 'fs'
import path from 'path'
import type { IpcContext } from '../ipc/context'

export const INDEX_RUNTIME_MARKER = '@ohmyppt-index-runtim:arcsin1:v2.0.19'
export const PPT_RUNTIME_MARKER = '@ohmyppt-ppt-runtime:arcsin1:v2.0.21'

const RUNTIME_ASSET_MARKERS = [
  { fileName: 'index-runtime.js', marker: INDEX_RUNTIME_MARKER },
  { fileName: 'ppt-runtime.js', marker: PPT_RUNTIME_MARKER }
] as const

async function hasExpectedRuntimeMarker(
  projectDir: string,
  fileName: string,
  marker: string
): Promise<boolean> {
  try {
    const content = await fs.promises.readFile(path.join(projectDir, 'assets', fileName), 'utf-8')
    return content.includes(marker)
  } catch {
    return false
  }
}

export async function ensureSessionRuntimeCompatible(
  ctx: Pick<IpcContext, 'ensureSessionAssets'>,
  projectDir: string
): Promise<void> {
  for (const { fileName, marker } of RUNTIME_ASSET_MARKERS) {
    if (!(await hasExpectedRuntimeMarker(projectDir, fileName, marker))) {
      await ctx.ensureSessionAssets(projectDir)
      return
    }
  }
}
