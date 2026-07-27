import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  useEditHistoryStore,
  useEditSessionStore,
  useGenerateStore,
  useSessionDetailRuntimeStore,
  useSessionDetailUiStore,
  useToastStore,
  type WorkspaceRibbonRegisteredActions
} from '@renderer/store'
import { useT } from '@renderer/i18n'
import type { SessionWorkspaceTab } from '@renderer/types/session-detail'
import { normalizePagesForSelection } from '../shared'
import type { WorkspaceRibbonState } from '../workspace/toolbar/types'

export function useWorkspaceRibbonActionsRegistration(
  actions: WorkspaceRibbonRegisteredActions
): void {
  const actionsRef = useRef(actions)
  const setWorkspaceRibbonActions = useSessionDetailRuntimeStore(
    (state) => state.setWorkspaceRibbonActions
  )

  useEffect(() => {
    actionsRef.current = actions
  }, [actions])

  useEffect(() => {
    const registeredActions: WorkspaceRibbonRegisteredActions = {
      onUndo: () => actionsRef.current.onUndo(),
      onRedo: () => actionsRef.current.onRedo(),
      onSaveCurrentPage: () => actionsRef.current.onSaveCurrentPage(),
      onDiscardAllEdits: () => actionsRef.current.onDiscardAllEdits(),
      onApplySelectedToAllPages: () => actionsRef.current.onApplySelectedToAllPages(),
      onCopySelectedElement: () => actionsRef.current.onCopySelectedElement(),
      onDeleteSelectedElement: () => actionsRef.current.onDeleteSelectedElement(),
      onBackToSessions: () => actionsRef.current.onBackToSessions(),
      onAddFromLibrary: (type) => actionsRef.current.onAddFromLibrary(type),
      onAddFromLocal: (type) => actionsRef.current.onAddFromLocal(type),
      onAddText: () => actionsRef.current.onAddText(),
      onAddArtText: (templateId) => actionsRef.current.onAddArtText(templateId),
      onAddShape: (type) => actionsRef.current.onAddShape(type),
      onAddIcon: (iconId) => actionsRef.current.onAddIcon(iconId),
      onAddChart: (type) => actionsRef.current.onAddChart(type),
      onAddFormula: () => actionsRef.current.onAddFormula()
    }
    setWorkspaceRibbonActions(registeredActions)
    return () => setWorkspaceRibbonActions(null)
  }, [setWorkspaceRibbonActions])
}

export function useWorkspaceRibbonController(isSavingEdits: boolean): {
  selectedPageKey: string | null
  state: WorkspaceRibbonState
  activateTab: (tab: SessionWorkspaceTab) => void
  pendingTab: SessionWorkspaceTab | null
  pendingTabLabel: string
  savingBeforeTabSwitch: boolean
  cancelPendingTab: () => void
  confirmPendingTab: () => Promise<void>
} {
  const t = useT()
  const [pendingTab, setPendingTab] = useState<SessionWorkspaceTab | null>(null)
  const [savingBeforeTabSwitch, setSavingBeforeTabSwitch] = useState(false)
  const isGenerating = useGenerateStore((state) => state.isGenerating)
  const currentPages = useGenerateStore((state) => state.currentPages)
  const toastInfo = useToastStore((state) => state.info)
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const activeTab = useSessionDetailUiStore((state) => state.workspaceTab)
  const setActiveTab = useSessionDetailUiStore((state) => state.setWorkspaceTab)
  const bumpPreviewKey = useSessionDetailUiStore((state) => state.bumpPreviewKey)
  const interactionMode = useSessionDetailUiStore((state) => state.interactionMode)
  const setInteractionMode = useSessionDetailUiStore((state) => state.setInteractionMode)
  const clearSelectedElement = useSessionDetailUiStore((state) => state.clearSelectedElement)
  const setSpeechScriptDialogOpen = useSessionDetailUiStore(
    (state) => state.setSpeechScriptDialogOpen
  )
  const pages = useMemo(() => normalizePagesForSelection(currentPages), [currentPages])
  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  )

  const selectedPageKey = selectedPage?.htmlPath
    ? `${selectedPage.pageId}:${selectedPage.htmlPath}`
    : null
  const pageId = selectedPage?.pageId
  const canUndo = useEditHistoryStore((state) => state.canUndo(pageId))
  const canRedo = useEditHistoryStore((state) => state.canRedo(pageId))
  const hasPendingEdits = useEditHistoryStore((state) => state.hasPendingEdits(pageId))
  const tabLabels = useMemo<Record<SessionWorkspaceTab, string>>(
    () => ({
      preview: t('sessionDetail.previewMode'),
      edit: t('sessionDetail.editMode'),
      animation: t('sessionDetail.animationTab'),
      speech: t('sessionDetail.speechScript'),
      ai: t('sessionDetail.aiMode')
    }),
    [t]
  )
  const pendingTabLabel = pendingTab ? tabLabels[pendingTab] : ''

  const applyTab = useCallback(
    (tab: SessionWorkspaceTab): void => {
      if (activeTab === 'animation' && tab !== 'animation') {
        clearSelectedElement()
        bumpPreviewKey()
      }
      setActiveTab(tab)
      if (tab === 'preview') {
        setInteractionMode('preview')
        setSpeechScriptDialogOpen(false)
        return
      }
      if (tab === 'speech') {
        clearSelectedElement()
        setInteractionMode('preview')
        setSpeechScriptDialogOpen(true)
        return
      }
      if (tab === 'animation') {
        useEditSessionStore.getState().cancelEdit()
        clearSelectedElement()
        setInteractionMode('animation-select')
        setSpeechScriptDialogOpen(false)
        toastInfo(t('sessionDetail.animationModeToast'))
        return
      }
      if (tab === 'ai') {
        clearSelectedElement()
        setInteractionMode('ai-inspect')
        setSpeechScriptDialogOpen(false)
        toastInfo(t('sessionDetail.inspectActiveToast'))
        return
      }
      if (interactionMode !== 'edit') {
        setInteractionMode('edit')
      }
      setSpeechScriptDialogOpen(false)
      toastInfo(t('sessionDetail.editModeToast'))
    },
    [
      clearSelectedElement,
      activeTab,
      bumpPreviewKey,
      interactionMode,
      setActiveTab,
      setInteractionMode,
      setSpeechScriptDialogOpen,
      t,
      toastInfo
    ]
  )

  const activateTab = useCallback(
    (tab: SessionWorkspaceTab): void => {
      if (tab === activeTab) return
      const canSwitchWithoutSave = tab === 'edit' || tab === 'preview'
      if (!canSwitchWithoutSave) {
        useEditSessionStore.getState().commitCurrentDraft()
      }
      const hasCurrentPendingEdits = useEditHistoryStore.getState().hasPendingEdits(pageId)
      if (!canSwitchWithoutSave && (hasPendingEdits || hasCurrentPendingEdits)) {
        setPendingTab(tab)
        return
      }
      applyTab(tab)
    },
    [activeTab, applyTab, hasPendingEdits, pageId]
  )

  const cancelPendingTab = useCallback((): void => {
    if (savingBeforeTabSwitch) return
    setPendingTab(null)
  }, [savingBeforeTabSwitch])

  const confirmPendingTab = useCallback(async (): Promise<void> => {
    const tab = pendingTab
    if (!tab || savingBeforeTabSwitch) return
    setSavingBeforeTabSwitch(true)
    try {
      const result = await useEditSessionStore.getState().save()
      const stillPending = useEditHistoryStore.getState().hasPendingEdits(pageId)
      if (result.saved || !stillPending) {
        setPendingTab(null)
        applyTab(tab)
      }
    } finally {
      setSavingBeforeTabSwitch(false)
    }
  }, [applyTab, pageId, pendingTab, savingBeforeTabSwitch])

  const state: WorkspaceRibbonState = useMemo(
    () => ({
      isGenerating,
      isSavingEdits,
      canUndo,
      canRedo,
      hasPendingEdits,
      activeTab
    }),
    [activeTab, canRedo, canUndo, hasPendingEdits, isGenerating, isSavingEdits]
  )

  return {
    selectedPageKey,
    state,
    activateTab,
    pendingTab,
    pendingTabLabel,
    savingBeforeTabSwitch,
    cancelPendingTab,
    confirmPendingTab
  }
}
