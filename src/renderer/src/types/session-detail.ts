import type { GeneratedImageAsset } from '@shared/image-generation.js'
import type { GeneratedPage } from '@renderer/store/sessionStore'
import type { GenerateProgress } from '@renderer/store/generateStore'
import type { ArtTextTemplateId } from '@renderer/lib/artTextTemplates'
import type { InsertShapeType } from '@renderer/components/session-detail/workspace/insert-shapes'
import type { InsertChartType } from '@renderer/components/session-detail/workspace/insert-charts'

export type SessionDetailChatType = 'main' | 'page'
export type SessionDetailAiPanelMode = 'chat' | 'image'
export type InteractionMode = 'preview' | 'ai-inspect' | 'animation-select' | 'edit'
export type SessionWorkspaceTab =
  | 'preview'
  | 'edit'
  | 'animation'
  | 'speech'
  | 'ai'
export type ChatType = SessionDetailChatType
export type InsertAssetType = 'image' | 'video'

export type ImageGenerationMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  assets?: GeneratedImageAsset[]
  createdAt: number
}

export type SessionPreviewPage = GeneratedPage & {
  id: string
  pageId: string
}

export interface AddSessionElementOptions {
  persistImmediately?: boolean
  prompt?: string
  asBackground?: boolean
}

export type AddSessionElementHandler = (
  relativePath: string,
  fileName: string,
  options?: AddSessionElementOptions
) => Promise<boolean>

export interface WorkspaceRibbonRegisteredActions {
  onUndo: () => void
  onRedo: () => void
  onSaveCurrentPage: () => void
  onDiscardAllEdits: () => void
  onApplySelectedToAllPages: () => void
  onCopySelectedElement: () => void
  onDeleteSelectedElement: () => void
  onBackToSessions: () => void
  onAddFromLibrary: (type: InsertAssetType) => void
  onAddFromLocal: (type: InsertAssetType) => void
  onAddText: () => void
  onAddArtText: (templateId: ArtTextTemplateId) => void
  onAddShape: (type: InsertShapeType) => void
  onAddIcon: (iconId: string) => void
  onAddChart: (type: InsertChartType) => void
  onAddFormula: () => void
}

export interface ChatPanelController {
  selectedPageExists: boolean
  selectedPageNumber?: number
  isGenerating: boolean
  progress: GenerateProgress | null
  error: string | null
  uploadFiles: (files: File[]) => Promise<void>
  chooseAssets: (assetType: 'image' | 'video') => Promise<void>
  send: (modelConfigId: string, selectPageIds?: string[]) => Promise<boolean>
  cancel: () => Promise<void>
}

export interface ChatSendGuardInput {
  sessionId: string
  sending: boolean
  generating: boolean
  input: string
  pendingAssetCount: number
}

export interface ResolveChatSendContextInput {
  selectedSelector: string | null
  chatType: SessionDetailChatType
  selectedPage: SessionPreviewPage | null
  firstPage: SessionPreviewPage | null
}

export type ChatSendContext =
  | { ready: false }
  | {
      ready: true
      hasSelector: boolean
      selector: string | null
      chatType: SessionDetailChatType
      targetPageId?: string
      targetPagePath?: string
      messagePageId: string | null
    }
