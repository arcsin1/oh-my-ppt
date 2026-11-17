import { ipcMain } from 'electron'
import type { IpcContext } from '../../ipc/context'
import { importPptxToSession } from './import-session'
import type { PptxImportProgressPayload } from './index'

type PptxImportPayload = {
  filePath?: unknown
  title?: unknown
  styleId?: unknown
  modelConfigId?: unknown
}

const parsePayload = (
  payload: unknown
): { filePath: string; title: string; styleId: string | null; modelConfigId?: string } => {
  const record = payload && typeof payload === 'object' ? (payload as PptxImportPayload) : {}
  const filePath = typeof record.filePath === 'string' ? record.filePath.trim() : ''
  if (!filePath) throw new Error('PPTX 文件路径不能为空')
  const title = typeof record.title === 'string' ? record.title.trim() : ''
  const styleId =
    typeof record.styleId === 'string' && record.styleId.trim() ? record.styleId.trim() : null
  const modelConfigId =
    typeof record.modelConfigId === 'string' ? record.modelConfigId.trim() : undefined
  return { filePath, title, styleId, modelConfigId }
}

export function registerPptxImportHandlers(ctx: IpcContext): void {
  const { resolveExistingFileRealPath } = ctx

  ipcMain.handle('pptx:import', async (event, payload: unknown) => {
    const parsedPayload = parsePayload(payload)
    const sourcePath = await resolveExistingFileRealPath(parsedPayload.filePath)
    return importPptxToSession(ctx, {
      sourcePath,
      title: parsedPayload.title,
      styleId: parsedPayload.styleId,
      modelConfigId: parsedPayload.modelConfigId,
      onProgress: (progress: PptxImportProgressPayload) => {
        event.sender.send('pptx:import:progress', progress)
      }
    })
  })
}
