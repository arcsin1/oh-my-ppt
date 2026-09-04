import type { SessionWorkspaceTab } from '@renderer/store'
import type { InsertAssetType } from '@renderer/types/session-detail'

export type { InsertAssetType }

export interface WorkspaceRibbonState {
  isGenerating: boolean
  isPageEditing: boolean
  isDeckEditing: boolean
  isStyleSwitchPageLocked: boolean
  isSavingEdits: boolean
  canUndo: boolean
  canRedo: boolean
  hasPendingEdits: boolean
  activeTab: SessionWorkspaceTab
}
