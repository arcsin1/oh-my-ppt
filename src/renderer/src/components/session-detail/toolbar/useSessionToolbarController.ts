import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  useGenerateStore,
  useEditHistoryStore,
  useSessionDetailUiStore,
  useSessionStore,
  useToastStore
} from '@renderer/store'
import { ipc } from '@renderer/lib/ipc'
import { useT } from '@renderer/i18n'
import { normalizePagesForSelection } from '../shared/pageUtils'
import { useSessionExportActions } from '../hooks/useSessionExportActions'

export function useSessionToolbarController(sessionId: string) {
  const t = useT()
  const navigate = useNavigate()
  const currentSession = useSessionStore((state) => state.currentSession)
  const fetchSessions = useSessionStore((state) => state.fetchSessions)
  const currentPages = useGenerateStore((state) => state.currentPages)
  const isGenerating = useGenerateStore((state) => state.isGenerating)
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const isAddingPage = useSessionDetailUiStore((state) => state.isAddingPage)
  const isRetryingSinglePage = useSessionDetailUiStore((state) => state.isRetryingSinglePage)
  const isManagingPages = useSessionDetailUiStore((state) => state.isManagingPages)
  const setHistoryDialogOpen = useSessionDetailUiStore((state) => state.setHistoryDialogOpen)
  const { success: toastSuccess, error: toastError } = useToastStore()
  const exportActions = useSessionExportActions(sessionId)
  const [saveAsNewSessionOpen, setSaveAsNewSessionOpen] = useState(false)
  const [savingAsNewSession, setSavingAsNewSession] = useState(false)

  const pages = useMemo(() => normalizePagesForSelection(currentPages), [currentPages])
  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  )
  const selectedPageHasPendingEdits = useEditHistoryStore((state) =>
    state.hasPendingEdits(selectedPage?.pageId)
  )
  const sessionStatus =
    currentSession && typeof (currentSession as { status?: unknown }).status === 'string'
      ? String((currentSession as { status?: unknown }).status)
      : ''
  const historyDisabled =
    isGenerating ||
    isAddingPage ||
    isRetryingSinglePage ||
    isManagingPages ||
    sessionStatus === 'active'
  const saveAsNewSessionDisabled = historyDisabled || savingAsNewSession

  const handleSaveAsNewSession = async (payload: { title: string }): Promise<void> => {
    const title = payload.title.trim()
    if (!sessionId || savingAsNewSession || saveAsNewSessionDisabled) return
    if (!title) {
      toastError(t('sessionDetail.saveAsNewSessionTitleRequired'))
      return
    }
    setSavingAsNewSession(true)
    try {
      await ipc.saveSessionAsNew({ sessionId, title })
      await fetchSessions()
      toastSuccess(t('sessionDetail.saveAsNewSessionSuccess'))
      setSaveAsNewSessionOpen(false)
      navigate('/sessions')
    } catch (err) {
      toastError(t('sessionDetail.saveAsNewSessionFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setSavingAsNewSession(false)
    }
  }

  return {
    hasPages: pages.length > 0,
    isGenerating,
    historyDisabled,
    selectedPageHasPendingEdits,
    canPreview: Boolean(selectedPage?.htmlPath || pages[0]?.htmlPath),
    canRevealFile: Boolean(selectedPage?.htmlPath),
    sessionTitle: currentSession?.title || '',
    saveAsNewSessionOpen,
    savingAsNewSession,
    saveAsNewSessionDisabled,
    defaultSaveAsNewSessionName: t('sessionDetail.saveAsNewSessionDefaultName', {
      title: currentSession?.title || t('sessionDetail.sessionFallback')
    }),
    setSaveAsNewSessionOpen,
    handleSaveAsNewSession,
    exportActions,
    openHistory: () => {
      if (!historyDisabled) setHistoryDialogOpen(true)
    }
  }
}
