import { ipcMain } from 'electron'
import type { IpcContext } from '../context'
import { CORPORATE_TEMPLATE_ID } from '@shared/brand'
import {
  createEditableSessionFromTemplate,
  createSessionFromTemplate,
  createTemplateFromSession,
  deleteTemplate,
  getTemplate,
  importPptxAsTemplate,
  listTemplates,
  updateTemplateMetadata
} from './template-service'

const ENABLE_CUSTOM_TEMPLATE_MANAGEMENT = false

export function registerTemplateHandlers(ctx: IpcContext): void {
  ipcMain.handle('templates:list', async () => {
    const result = await listTemplates()
    return { items: result.items.filter((item) => item.id === CORPORATE_TEMPLATE_ID) }
  })

  ipcMain.handle('templates:get', async (_event, templateId: string) => {
    if (templateId !== CORPORATE_TEMPLATE_ID) {
      throw new Error('内部版仅允许使用公司标准模板。')
    }
    return getTemplate(templateId)
  })

  ENABLE_CUSTOM_TEMPLATE_MANAGEMENT &&
    ipcMain.handle('templates:createFromSession', async (_event, payload: unknown) =>
      createTemplateFromSession(ctx, payload)
    )

  ipcMain.handle('templates:createSession', async (_event, payload: unknown) =>
    createSessionFromTemplate(ctx, payload)
  )

  ENABLE_CUSTOM_TEMPLATE_MANAGEMENT &&
    ipcMain.handle('templates:createEditableSession', async (_event, payload: unknown) =>
      createEditableSessionFromTemplate(ctx, payload)
    )

  ENABLE_CUSTOM_TEMPLATE_MANAGEMENT &&
    ipcMain.handle('templates:importPptx', async (event, payload: unknown) =>
      importPptxAsTemplate(ctx, payload, (progress) => {
        event.sender.send('templates:importPptx:progress', progress)
      })
    )

  ENABLE_CUSTOM_TEMPLATE_MANAGEMENT &&
    ipcMain.handle('templates:updateMetadata', async (_event, payload: unknown) =>
      updateTemplateMetadata(payload)
    )

  ENABLE_CUSTOM_TEMPLATE_MANAGEMENT &&
    ipcMain.handle('templates:delete', async (_event, templateId: string) =>
      deleteTemplate(templateId)
    )
}
