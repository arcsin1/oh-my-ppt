import { create } from 'zustand'
import type { UploadedAsset } from '@shared/generation.js'
import type { SpeechConfig } from '@shared/speech'
import type {
  ImageGenerationMessage,
  InteractionMode,
  SessionDetailAiPanelMode,
  SessionDetailChatType,
  SessionWorkspaceTab
} from '@renderer/types/session-detail'

export type {
  ImageGenerationMessage,
  InteractionMode,
  SessionDetailAiPanelMode,
  SessionDetailChatType,
  SessionWorkspaceTab
} from '@renderer/types/session-detail'

interface SessionDetailUiStore {
  input: string
  aiPanelMode: SessionDetailAiPanelMode
  chatType: SessionDetailChatType
  imagePrompt: string
  imageMessages: ImageGenerationMessage[]
  imageMessageCache: Record<string, ImageGenerationMessage[]>
  loadedImageMessageKeys: Record<string, boolean>
  selectedImageModelConfigId: string
  imageSize: string
  imageCount: number
  isGeneratingImage: boolean
  imageProgress: { label?: string; progress: number } | null
  selectedPageId: string | null
  consoleOpen: boolean
  previewKey: number
  isExportingPdf: boolean
  isExportingPng: boolean
  isExportingPptx: boolean
  isExportingVideo: boolean
  isExportingSlidePack: boolean
  isExportingSessionZip: boolean
  interactionMode: InteractionMode
  workspaceTab: SessionWorkspaceTab
  thumbnailVersions: Record<string, number>
  selectedSelector: string | null
  editSelectedSelector: string | null
  selectorLabel: string
  elementTag: string
  elementText: string
  pendingAssets: UploadedAsset[]
  assetDragActive: boolean
  isUploadingAssets: boolean
  addPageDialogOpen: boolean
  blankPageDialogOpen: boolean
  blankPageSourceId: string
  historyDialogOpen: boolean
  pageTitleEditPageId: string | null
  pageTitleEditDraft: string
  deleteConfirmPageId: string | null
  isAddingPage: boolean
  isRetryingSinglePage: boolean
  isManagingPages: boolean
  sidebarCollapsed: boolean
  assetPickerOpen: boolean
  assetPickerType: 'image' | 'video'
  isGeneratingSpeechScript: boolean
  speechProgress: { current: number; total: number } | null
  speechScriptDialogOpen: boolean
  speechConfig: SpeechConfig

  setInput: (input: string) => void
  setAiPanelMode: (mode: SessionDetailAiPanelMode) => void
  setChatType: (chatType: SessionDetailChatType) => void
  setImagePrompt: (input: string) => void
  setImageMessages: (messages: ImageGenerationMessage[]) => void
  cacheImageMessages: (key: string, messages: ImageGenerationMessage[]) => void
  setLoadedImageMessages: (key: string, messages: ImageGenerationMessage[]) => void
  addImageMessage: (message: ImageGenerationMessage) => void
  addCachedImageMessage: (key: string, message: ImageGenerationMessage) => void
  setSelectedImageModelConfigId: (id: string) => void
  setImageSize: (size: string) => void
  setImageCount: (count: number) => void
  setIsGeneratingImage: (generating: boolean) => void
  setImageProgress: (progress: { label?: string; progress: number } | null) => void
  setSelectedPageId: (pageId: string | null) => void
  setConsoleOpen: (open: boolean | ((open: boolean) => boolean)) => void
  bumpPreviewKey: () => void
  setIsExportingPdf: (isExporting: boolean) => void
  setIsExportingPng: (isExporting: boolean) => void
  setIsExportingPptx: (isExporting: boolean) => void
  setIsExportingVideo: (isExporting: boolean) => void
  setIsExportingSlidePack: (isExporting: boolean) => void
  setIsExportingSessionZip: (isExporting: boolean) => void
  setInteractionMode: (mode: InteractionMode) => void
  setWorkspaceTab: (tab: SessionWorkspaceTab) => void
  setSelectedElement: (
    selector: string,
    label: string,
    elementTag?: string,
    elementText?: string
  ) => void
  setEditSelectedElement: (selector: string | null) => void
  clearEditSelectedElement: () => void
  clearSelectedElement: () => void
  addPendingAssets: (assets: UploadedAsset[]) => void
  removePendingAsset: (assetId: string) => void
  clearPendingAssets: () => void
  setAssetDragActive: (active: boolean) => void
  setIsUploadingAssets: (isUploading: boolean) => void
  bumpThumbnailVersion: (pageId: string) => void
  setAddPageDialogOpen: (open: boolean) => void
  setBlankPageDialogOpen: (open: boolean) => void
  setBlankPageSourceId: (pageId: string) => void
  openBlankPageDialog: (sourcePageId: string) => void
  setHistoryDialogOpen: (open: boolean) => void
  openPageTitleEdit: (pageId: string, title: string) => void
  setPageTitleEditDraft: (title: string) => void
  closePageTitleEdit: () => void
  setDeleteConfirmPageId: (pageId: string | null) => void
  setIsAddingPage: (adding: boolean) => void
  setIsRetryingSinglePage: (retrying: boolean) => void
  setIsManagingPages: (managing: boolean) => void
  toggleSidebarCollapsed: () => void
  setAssetPickerOpen: (open: boolean, type?: 'image' | 'video') => void
  setIsGeneratingSpeechScript: (v: boolean) => void
  setSpeechProgress: (progress: { current: number; total: number } | null) => void
  setSpeechScriptDialogOpen: (v: boolean) => void
  setSpeechConfig: (config: SpeechConfig) => void
  finishAddPage: (selectedPageId?: string | null) => void
  resetForPageChange: () => void
  resetForSessionChange: () => void
}

export const useSessionDetailUiStore = create<SessionDetailUiStore>((set) => ({
  input: '',
  aiPanelMode: 'chat',
  chatType: 'page',
  imagePrompt: '',
  imageMessages: [],
  imageMessageCache: {},
  loadedImageMessageKeys: {},
  selectedImageModelConfigId: '',
  imageSize: '16:9',
  imageCount: 1,
  isGeneratingImage: false,
  imageProgress: null,
  selectedPageId: null,
  consoleOpen: true,
  previewKey: 0,
  isExportingPdf: false,
  isExportingPng: false,
  isExportingPptx: false,
  isExportingVideo: false,
  isExportingSlidePack: false,
  isExportingSessionZip: false,
  interactionMode: 'preview' as InteractionMode,
  workspaceTab: 'preview' as SessionWorkspaceTab,
  thumbnailVersions: {},
  selectedSelector: null,
  editSelectedSelector: null,
  selectorLabel: '',
  elementTag: '',
  elementText: '',
  pendingAssets: [],
  assetDragActive: false,
  isUploadingAssets: false,
  addPageDialogOpen: false,
  blankPageDialogOpen: false,
  blankPageSourceId: '',
  historyDialogOpen: false,
  pageTitleEditPageId: null,
  pageTitleEditDraft: '',
  deleteConfirmPageId: null,
  isAddingPage: false,
  isRetryingSinglePage: false,
  isManagingPages: false,
  sidebarCollapsed: false,
  assetPickerOpen: false,
  assetPickerType: 'image' as const,
  isGeneratingSpeechScript: false,
  speechProgress: null,
  speechScriptDialogOpen: false,
  speechConfig: {
    scope: 'all' as const,
    length: 'medium' as const,
    style: 'conversational' as const
  },

  setInput: (input) => set({ input }),
  setAiPanelMode: (aiPanelMode) => set({ aiPanelMode }),
  setChatType: (chatType) => set({ chatType }),
  setImagePrompt: (imagePrompt) => set({ imagePrompt }),
  setImageMessages: (imageMessages) => set({ imageMessages }),
  cacheImageMessages: (key, messages) =>
    set((state) => ({
      imageMessageCache: {
        ...state.imageMessageCache,
        [key]: messages
      }
    })),
  setLoadedImageMessages: (key, messages) =>
    set((state) => ({
      imageMessageCache: {
        ...state.imageMessageCache,
        [key]: messages
      },
      loadedImageMessageKeys: {
        ...state.loadedImageMessageKeys,
        [key]: true
      }
    })),
  addImageMessage: (message) =>
    set((state) => ({
      imageMessages: [...state.imageMessages, message].slice(-48)
    })),
  addCachedImageMessage: (key, message) =>
    set((state) => {
      const cached = state.imageMessageCache[key] || []
      return {
        imageMessageCache: {
          ...state.imageMessageCache,
          [key]: [...cached, message].slice(-48)
        }
      }
    }),
  setSelectedImageModelConfigId: (selectedImageModelConfigId) =>
    set({ selectedImageModelConfigId }),
  setImageSize: (imageSize) => set({ imageSize }),
  setImageCount: (imageCount) => set({ imageCount: Math.max(1, Math.min(4, imageCount)) }),
  setIsGeneratingImage: (isGeneratingImage) => set({ isGeneratingImage }),
  setImageProgress: (imageProgress) => set({ imageProgress }),
  setSelectedPageId: (selectedPageId) => set({ selectedPageId }),
  setConsoleOpen: (open) =>
    set((state) => ({
      consoleOpen: typeof open === 'function' ? open(state.consoleOpen) : open
    })),
  bumpPreviewKey: () => set((state) => ({ previewKey: state.previewKey + 1 })),
  setIsExportingPdf: (isExportingPdf) => set({ isExportingPdf }),
  setIsExportingPng: (isExportingPng) => set({ isExportingPng }),
  setIsExportingPptx: (isExportingPptx) => set({ isExportingPptx }),
  setIsExportingVideo: (isExportingVideo) => set({ isExportingVideo }),
  setIsExportingSlidePack: (isExportingSlidePack) => set({ isExportingSlidePack }),
  setIsExportingSessionZip: (isExportingSessionZip) => set({ isExportingSessionZip }),
  setInteractionMode: (interactionMode) => set({ interactionMode }),
  setWorkspaceTab: (workspaceTab) => set({ workspaceTab }),
  // Fix: only reset to preview when currently in preview mode.
  // In edit/ai-inspect mode, selecting an element should NOT change the mode.
  setSelectedElement: (selectedSelector, selectorLabel, elementTag = '', elementText = '') =>
    set((state) => ({
      selectedSelector,
      selectorLabel,
      elementTag,
      elementText,
      interactionMode:
        state.interactionMode === 'preview' ? ('preview' as InteractionMode) : state.interactionMode
    })),
  setEditSelectedElement: (editSelectedSelector) => set({ editSelectedSelector }),
  clearEditSelectedElement: () => set({ editSelectedSelector: null }),
  clearSelectedElement: () =>
    set({
      selectedSelector: null,
      selectorLabel: '',
      elementTag: '',
      elementText: ''
    }),
  addPendingAssets: (assets) =>
    set((state) => ({
      pendingAssets: [...state.pendingAssets, ...assets]
    })),
  removePendingAsset: (assetId) =>
    set((state) => ({
      pendingAssets: state.pendingAssets.filter((asset) => asset.id !== assetId)
    })),
  clearPendingAssets: () => set({ pendingAssets: [] }),
  setAssetDragActive: (assetDragActive) => set({ assetDragActive }),
  setIsUploadingAssets: (isUploadingAssets) => set({ isUploadingAssets }),
  bumpThumbnailVersion: (pageId) =>
    set((state) => ({
      thumbnailVersions: {
        ...state.thumbnailVersions,
        [pageId]: (state.thumbnailVersions[pageId] || 0) + 1
      }
    })),
  setAddPageDialogOpen: (addPageDialogOpen) => set({ addPageDialogOpen }),
  setBlankPageDialogOpen: (blankPageDialogOpen) => set({ blankPageDialogOpen }),
  setBlankPageSourceId: (blankPageSourceId) => set({ blankPageSourceId }),
  openBlankPageDialog: (blankPageSourceId) =>
    set({
      blankPageSourceId,
      blankPageDialogOpen: true
    }),
  setHistoryDialogOpen: (historyDialogOpen) => set({ historyDialogOpen }),
  openPageTitleEdit: (pageTitleEditPageId, pageTitleEditDraft) =>
    set({
      pageTitleEditPageId,
      pageTitleEditDraft
    }),
  setPageTitleEditDraft: (pageTitleEditDraft) => set({ pageTitleEditDraft }),
  closePageTitleEdit: () => set({ pageTitleEditPageId: null, pageTitleEditDraft: '' }),
  setDeleteConfirmPageId: (deleteConfirmPageId) => set({ deleteConfirmPageId }),
  setIsAddingPage: (isAddingPage) => set({ isAddingPage }),
  setIsRetryingSinglePage: (isRetryingSinglePage) => set({ isRetryingSinglePage }),
  setIsManagingPages: (isManagingPages) => set({ isManagingPages }),
  toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setAssetPickerOpen: (open, type) =>
    set((state) => ({
      assetPickerOpen: open,
      ...(type ? { assetPickerType: type } : { assetPickerType: state.assetPickerType })
    })),
  setIsGeneratingSpeechScript: (isGeneratingSpeechScript) => set({ isGeneratingSpeechScript }),
  setSpeechProgress: (speechProgress) => set({ speechProgress }),
  setSpeechScriptDialogOpen: (speechScriptDialogOpen) => set({ speechScriptDialogOpen }),
  setSpeechConfig: (speechConfig) => set({ speechConfig }),
  finishAddPage: (selectedPageId) =>
    set((state) => ({
      isAddingPage: false,
      selectedPageId: typeof selectedPageId === 'undefined' ? state.selectedPageId : selectedPageId
    })),
  resetForPageChange: () =>
    set({
      interactionMode: 'preview' as InteractionMode,
      workspaceTab: 'preview' as SessionWorkspaceTab,
      selectedSelector: null,
      editSelectedSelector: null,
      selectorLabel: '',
      elementTag: '',
      elementText: ''
    }),
  resetForSessionChange: () =>
    set({
      input: '',
      aiPanelMode: 'chat',
      chatType: 'page',
      imagePrompt: '',
      imageMessages: [],
      imageMessageCache: {},
      loadedImageMessageKeys: {},
      selectedImageModelConfigId: '',
      imageSize: '16:9',
      imageCount: 1,
      isGeneratingImage: false,
      imageProgress: null,
      selectedPageId: null,
      interactionMode: 'preview' as InteractionMode,
      workspaceTab: 'preview' as SessionWorkspaceTab,
      selectedSelector: null,
      editSelectedSelector: null,
      selectorLabel: '',
      elementTag: '',
      elementText: '',
      pendingAssets: [],
      assetDragActive: false,
      isUploadingAssets: false,
      thumbnailVersions: {},
      addPageDialogOpen: false,
      blankPageDialogOpen: false,
      blankPageSourceId: '',
      historyDialogOpen: false,
      pageTitleEditPageId: null,
      pageTitleEditDraft: '',
      deleteConfirmPageId: null,
      isAddingPage: false,
      isRetryingSinglePage: false,
      isManagingPages: false,
      sidebarCollapsed: false,
      assetPickerOpen: false,
      isGeneratingSpeechScript: false,
      speechProgress: null,
      speechScriptDialogOpen: false,
      speechConfig: {
        scope: 'all' as const,
        length: 'medium' as const,
        style: 'conversational' as const
      }
    })
}))
