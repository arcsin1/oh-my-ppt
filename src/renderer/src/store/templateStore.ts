import { create } from 'zustand'
import { ipc, type TemplateListItem } from '@renderer/lib/ipc'
import type { ConfirmedCorporatePagePlan } from '@shared/confirmed-corporate-plan'
import type { SourceDocumentPlan } from '@shared/generation'

interface TemplateStore {
  templates: TemplateListItem[]
  loading: boolean
  fetchTemplates: () => Promise<void>
  applyTemplateThumbnail: (templateId: string, thumbnailPath: string) => void
  createTemplateFromSession: (payload: {
    sessionId: string
    name?: string
    description?: string
    tags?: string[]
  }) => Promise<string>
  createSessionFromTemplate: (payload: {
    templateId: string
    title?: string
    modelConfigId?: string
    pageCount?: number
    includeAgenda?: boolean
    referenceDocumentPath?: string
    sourcePlan?: SourceDocumentPlan
    confirmedPlan?: ConfirmedCorporatePagePlan
  }) => Promise<string>
  createEditableSessionFromTemplate: (payload: {
    templateId: string
    title?: string
    modelConfigId?: string
  }) => Promise<string>
  importPptxAsTemplate: (payload: {
    filePath: string
    name?: string
    modelConfigId?: string
  }) => Promise<{ id: string; pageCount: number; warnings: string[] }>
  updateTemplateMetadata: (payload: {
    templateId: string
    name: string
    description?: string
    tags?: string[]
  }) => Promise<void>
  deleteTemplate: (templateId: string) => Promise<void>
}

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: [],
  loading: false,

  fetchTemplates: async () => {
    set({ loading: true })
    try {
      const { items } = await ipc.listTemplates()
      set({ templates: items, loading: false })
    } catch (error) {
      set({ loading: false })
      throw error
    }
  },

  applyTemplateThumbnail: (templateId, thumbnailPath) => {
    set((state) => ({
      templates: state.templates.map((template) =>
        template.id === templateId ? { ...template, thumbnailPath } : template
      )
    }))
  },

  createTemplateFromSession: async (payload) => {
    const result = await ipc.createTemplateFromSession(payload)
    await get().fetchTemplates()
    return result.id
  },

  createSessionFromTemplate: async (payload) => {
    const result = await ipc.createSessionFromTemplate(payload)
    return result.sessionId
  },

  createEditableSessionFromTemplate: async (payload) => {
    const result = await ipc.createEditableSessionFromTemplate(payload)
    return result.sessionId
  },

  importPptxAsTemplate: async (payload) => {
    const result = await ipc.importPptxAsTemplate(payload)
    await get().fetchTemplates()
    return {
      id: result.id,
      pageCount: result.pageCount,
      warnings: result.warnings
    }
  },

  updateTemplateMetadata: async (payload) => {
    const result = await ipc.updateTemplateMetadata(payload)
    set((state) => ({
      templates: state.templates.map((template) =>
        template.id === result.item.id ? result.item : template
      )
    }))
  },

  deleteTemplate: async (templateId) => {
    await ipc.deleteTemplate(templateId)
    await get().fetchTemplates()
  }
}))
