import { useMemo } from 'react'
import { ipc } from '@renderer/lib/ipc'
import {
  isStyleSwitchPageLocked,
  hydrateStyleSwitchJob,
  useGenerateStore,
  useSessionDetailUiStore,
  useSessionStore,
  useToastStore
} from '@renderer/store'
import { useT } from '@renderer/i18n'
import { useModelAction } from '@renderer/hooks/useModelAction'
import { isPageGenerationLocked, normalizePagesForSelection } from '../shared/pageUtils'
import type { SessionPreviewPage } from '../shared/types'
import { useSessionPageActions } from '../hooks/useSessionPageActions'
import { useSessionReorderPages } from '../hooks/useSessionReorderPages'
import { isDefaultSlideSize, trySessionSlideSize } from '@shared/slide-size'

export function usePageSidebarController(sessionId: string) {
  const t = useT()
  const modelAction = useModelAction()
  const { reorder: reorderSessionPages } = useSessionReorderPages(sessionId)
  const currentPages = useGenerateStore((state) => state.currentPages)
  const isGenerating = useGenerateStore((state) => state.isGenerating)
  const pageEditJob = useGenerateStore((state) => state.pageEditJobs[sessionId] || null)
  const deckEditJob = useGenerateStore((state) => state.deckEditJobs[sessionId] || null)
  const styleSwitchJob = useGenerateStore((state) => state.styleSwitchJobs[sessionId] || null)
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const interactionMode = useSessionDetailUiStore((state) => state.interactionMode)
  const isAddingPage = useSessionDetailUiStore((state) => state.isAddingPage)
  const addingPageId = useSessionDetailUiStore((state) => state.addingPageId)
  const isRetryingSinglePage = useSessionDetailUiStore((state) => state.isRetryingSinglePage)
  const retryingSinglePageId = useSessionDetailUiStore((state) => state.retryingSinglePageId)
  const isManagingPages = useSessionDetailUiStore((state) => state.isManagingPages)
  const sidebarCollapsed = useSessionDetailUiStore((state) => state.sidebarCollapsed)
  const toggleSidebarCollapsed = useSessionDetailUiStore((state) => state.toggleSidebarCollapsed)
  const setAddPageDialogOpen = useSessionDetailUiStore((state) => state.setAddPageDialogOpen)
  const setMergeSessionPagesDialogOpen = useSessionDetailUiStore(
    (state) => state.setMergeSessionPagesDialogOpen
  )
  const setMergeTemplatePagesDialogOpen = useSessionDetailUiStore(
    (state) => state.setMergeTemplatePagesDialogOpen
  )
  const openBlankPageDialog = useSessionDetailUiStore((state) => state.openBlankPageDialog)
  const currentSession = useSessionStore((state) => state.currentSession)
  const slideSize = trySessionSlideSize(currentSession)
  const toastError = useToastStore((state) => state.error)
  const pageActions = useSessionPageActions(sessionId)
  const pages = useMemo(() => normalizePagesForSelection(currentPages), [currentPages])
  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  )
  const isStyleSwitchActive =
    styleSwitchJob?.status === 'starting' ||
    styleSwitchJob?.status === 'running' ||
    styleSwitchJob?.status === 'cancelling'
  const hasPageScopedGeneration =
    isAddingPage ||
    isRetryingSinglePage ||
    Boolean(pageEditJob) ||
    Boolean(styleSwitchJob)
  const isSessionWideGenerating = isGenerating && !hasPageScopedGeneration
  const isPageActionDisabled = (page: SessionPreviewPage): boolean =>
    isSessionWideGenerating ||
    isPageGenerationLocked(page.id, {
      isAddingPage,
      addingPageId,
      isRetryingSinglePage,
      retryingSinglePageId
    }) ||
    pageEditJob?.pageId === page.pageId ||
    Boolean(deckEditJob) ||
    isStyleSwitchPageLocked(styleSwitchJob, page.pageId) ||
    isManagingPages

  const handleRetryFailedPage = async (page: SessionPreviewPage): Promise<void> => {
    if (!sessionId || !page.id) return
    if (isStyleSwitchActive) return
    const stylePageId = page.pageId || page.id
    const styleSwitchFailedPage = styleSwitchJob?.pages.find(
      (item) => item.pageId === stylePageId && item.status === 'failed'
    )
    if (styleSwitchJob && styleSwitchFailedPage) {
      const modelConfigId = await modelAction.ensureModelActive()
      if (!modelConfigId) return
      useGenerateStore.getState().startStyleSwitch(sessionId, {
        styleId: styleSwitchJob.styleId,
        styleName: styleSwitchJob.styleName,
        totalPages: 1,
        pages: [{ ...styleSwitchFailedPage, status: 'pending', error: null }]
      })
      try {
        const result = await ipc.retryStyleSwitchPage({
          sessionId,
          failedRunId: styleSwitchJob.runId,
          pageId: styleSwitchFailedPage.pageId,
          modelConfigId
        })
        if (result.alreadyRunning) {
          hydrateStyleSwitchJob(sessionId, await ipc.getStyleSwitchState(sessionId))
          return
        }
        if (result.runId) {
          const currentJob = useGenerateStore.getState().styleSwitchJobs[sessionId]
          if (currentJob) {
            useGenerateStore.getState().updateStyleSwitchJob(sessionId, {
              runId: result.runId,
              status: currentJob.status === 'cancelling' ? 'cancelling' : 'running'
            })
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : t('sessionDetail.retryPageFailed')
        useGenerateStore
          .getState()
          .finishStyleSwitch(sessionId, { status: 'failed', error: message })
        toastError(message)
      }
      return
    }
    useSessionDetailUiStore.getState().setIsRetryingSinglePage(true)
    useSessionDetailUiStore.getState().setRetryingSinglePageId(page.id)
    useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
    useGenerateStore.getState().addPage({ ...page, status: 'generating', error: null })
    let handedToJob = false
    try {
      const modelConfigId = await modelAction.ensureModelActive()
      if (!modelConfigId) return
      const result = await ipc.retrySinglePage({ sessionId, pageId: page.id, modelConfigId })
      if (result.alreadyRunning) return
      handedToJob = true
      void ipc
        .clearSpeechScript(sessionId)
        .catch((err) => console.warn('[speech] clearSpeechScript failed', err))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('sessionDetail.retryPageFailed')
      console.warn('[session-detail] retry single page failed', message)
    } finally {
      if (!handedToJob) {
        useGenerateStore.getState().addPage(page)
        useGenerateStore.getState().finishGeneration()
        useSessionDetailUiStore.getState().setIsRetryingSinglePage(false)
      }
    }
  }

  const handleReorderPages = async (
    orderedPageIds: string[],
    selectedForKeep?: string
  ): Promise<void> => {
    await reorderSessionPages(orderedPageIds, selectedForKeep)
  }

  const handleUpdatePageOutline = async (
    page: SessionPreviewPage,
    contentOutline: string
  ): Promise<void> => {
    if (!sessionId) return
    const normalizedOutline = contentOutline.replace(/\s+/g, ' ').trim()
    if (normalizedOutline === (page.contentOutline || '').trim()) return
    useSessionDetailUiStore.getState().setIsManagingPages(true)
    try {
      const result = await ipc.updateSessionPageOutline({
        sessionId,
        pageId: page.id,
        contentOutline: normalizedOutline
      })
      useGenerateStore.getState().setPages(result.generatedPages)
      useSessionDetailUiStore.getState().setSelectedPageId(result.selectedPageId || page.id)
      void ipc
        .clearSpeechScript(sessionId)
        .catch((err) => console.warn('[speech] clearSpeechScript failed', err))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('pageManagement.updateOutlineFailed'))
      throw error
    } finally {
      useSessionDetailUiStore.getState().setIsManagingPages(false)
    }
  }

  return {
    pages,
    disabled: (interactionMode === 'ai-inspect' && isSessionWideGenerating) || Boolean(deckEditJob),
    pageManagementDisabled:
      isGenerating ||
      Boolean(pageEditJob) ||
      Boolean(deckEditJob) ||
      isStyleSwitchActive ||
      isAddingPage ||
      isRetryingSinglePage ||
      isManagingPages,
    collapsed: sidebarCollapsed,
    onAddBlankPage: () => openBlankPageDialog(selectedPage?.id || pages[0]?.id || ''),
    onAddPage: () => setAddPageDialogOpen(true),
    onMergeSessionPages: () => setMergeSessionPagesDialogOpen(true),
    onMergeTemplatePages: () => setMergeTemplatePagesDialogOpen(true),
    onRetryFailedPage: (page: SessionPreviewPage) => void handleRetryFailedPage(page),
    onReorderPages: handleReorderPages,
    onDeletePage: pageActions.deletePage,
    onRenamePage: pageActions.renamePage,
    onDuplicatePage: pageActions.duplicatePage,
    onUpdatePageOutline: handleUpdatePageOutline,
    onExportPagePptx: pageActions.exportPagePptx,
    canExportPptx: slideSize ? isDefaultSlideSize(slideSize) : false,
    onDownloadAllOutlines: pageActions.exportOutlinesMarkdown,
    isPageActionDisabled,
    onToggleCollapsed: toggleSidebarCollapsed
  }
}
