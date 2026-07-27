import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ipc } from '@renderer/lib/ipc'
import type { EditableElementSnapshot } from '../components/preview/edit-mode-script'
import type { PreviewIframeHandle } from '../components/preview/PreviewIframe'
import { TooltipProvider } from '../components/ui/Tooltip'
import { PageSidebar } from '../components/session-detail/sidebar'
import { PreviewStage } from '../components/session-detail/preview'
import { ElementInspectorPanel } from '../components/session-detail/element-inspector'
import { SessionDetailRightPanel, WorkspaceRibbon } from '../components/session-detail/workspace'
import { SessionToolbar } from '../components/session-detail/toolbar'
import {
  AddBlankPageDialog,
  AddPageDialog,
  AssetPickerDialog,
  DeleteElementDialog,
  DeletePageDialog,
  GenerationActivityDialog,
  HistoryDialog,
  MergeSessionPagesDialog,
  MergeTemplatePagesDialog,
  PageTitleEditDialog
} from '../components/session-detail/modal'
import {
  buildImageMessageCacheKey,
  imageHistoryToMessages,
  mergeImageMessages,
  normalizePagesForSelection,
  type ChatType
} from '../components/session-detail/shared'
import { useWorkspaceRibbonActionsRegistration } from '../components/session-detail/hooks/useWorkspaceRibbonController'
import { buildSelectedElementFromSnapshot } from '../components/session-detail/element-inspector/elementEditUtils'
import { renderFormulaToHtml } from '../components/session-detail/element-inspector/formulaEditUtils'
import {
  useEditHistoryStore,
  useEditSessionStore,
  useGenerateStore,
  useGenerationActivityStore,
  useSessionDetailRuntimeStore,
  useSessionDetailUiStore,
  useSessionStore,
  useToastStore,
  type AddSessionElementHandler,
  type AddSessionElementOptions
} from '../store'
import type { GenerateChunkEvent } from '@shared/generation.js'
import { getEditorGate, parseSessionMetadata } from '../lib/sessionMetadata'
import { buildArtTextHtmlFragment, type ArtTextTemplateId } from '../lib/artTextTemplates'
import {
  buildIconElementHtml,
  buildShapeElementHtml,
  getShapeDefinition,
  type InsertShapeType
} from '../components/session-detail/workspace/insert-shapes'
import {
  buildChartElementHtml,
  DEFAULT_CHART_DATA,
  type InsertChartType
} from '../components/session-detail/workspace/insert-charts'
import { escapeHtmlText } from '../lib/utils'
import { useT } from '../i18n'
import { nanoid } from 'nanoid'
import { requireSessionSlideSize } from '@shared/slide-size'

const ADDED_ELEMENT_EDGE_PADDING = 20
const ADDED_TEXT_WIDTH = 420
const ADDED_TEXT_MIN_HEIGHT = 96
const ADDED_TEXT_OFFSET_STEP = 28
const ADDED_ART_TEXT_WIDTH = 560
const ADDED_ART_TEXT_MIN_HEIGHT = 130
const ADDED_ICON_SIZE = 96
const ADDED_FORMULA_WIDTH = 420
const ADDED_FORMULA_HEIGHT = 112
const ADDED_CHART_WIDTH = 520
const ADDED_CHART_HEIGHT = 300
const DEFAULT_FORMULA_LATEX = 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}'
const ADDED_MEDIA_OFFSET_STEP = 30

function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, ' ')
    .replace(/</g, '\\3C ')
    .replace(/>/g, '\\3E ')
}

export function SessionDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const t = useT()
  const isMac = window.electron?.process?.platform === 'darwin'
  const {
    currentSession,
    currentGeneratedPages,
    loadSession,
    loadMessages,
    setMessages,
    addMessage,
    resetRuntimeState
  } = useSessionStore()
  const slideSize = currentSession ? requireSessionSlideSize(currentSession) : null
  const { updateProgress, currentPages } = useGenerateStore()
  const chatType = useSessionDetailUiStore((state) => state.chatType)
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const setChatType = useSessionDetailUiStore((state) => state.setChatType)
  const resetForPageChange = useSessionDetailUiStore((state) => state.resetForPageChange)
  const resetForSessionChange = useSessionDetailUiStore((state) => state.resetForSessionChange)
  const clearEditSelectedElement = useSessionDetailUiStore(
    (state) => state.clearEditSelectedElement
  )
  const assetPickerOpen = useSessionDetailUiStore((state) => state.assetPickerOpen)
  const assetPickerType = useSessionDetailUiStore((state) => state.assetPickerType)
  const setAssetPickerOpen = useSessionDetailUiStore((state) => state.setAssetPickerOpen)
  const activeChatRef = useRef<{ chatType: ChatType; pageId?: string }>({ chatType: 'page' })
  const editHistory = useEditHistoryStore()
  const isSavingEdits = useEditSessionStore((state) => state.isSavingEdits)
  const elementSelection = useEditSessionStore((state) => state.selection)
  const elementDraft = useEditSessionStore((state) => state.draft)
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [pendingDeleteSelector, setPendingDeleteSelector] = useState<string | null>(null)
  const previewIframeRef = useRef<PreviewIframeHandle | null>(null)
  const addElementHandlerRef = useRef<AddSessionElementHandler | null>(null)
  const setAddElementHandler = useSessionDetailRuntimeStore((state) => state.setAddElementHandler)
  const setRefreshCurrentPreviewHandler = useSessionDetailRuntimeStore(
    (state) => state.setRefreshCurrentPreviewHandler
  )
  const invokeAddElement = useCallback<AddSessionElementHandler>(
    async (relativePath, fileName, options) => {
      const handler = addElementHandlerRef.current
      return handler ? handler(relativePath, fileName, options) : false
    },
    []
  )
  const toastError = useToastStore((state) => state.error)

  const orderedPages = useMemo(
    () => [...currentPages].sort((a, b) => a.pageNumber - b.pageNumber),
    [currentPages]
  )

  const normalizedOrderedPages = useMemo(
    () => normalizePagesForSelection(orderedPages),
    [orderedPages]
  )

  const selectedPage = useMemo(
    () =>
      normalizedOrderedPages.find((page) => page.id === selectedPageId) ??
      normalizedOrderedPages[0] ??
      null,
    [normalizedOrderedPages, selectedPageId]
  )

  const selectedPageRef = useRef(selectedPage)
  selectedPageRef.current = selectedPage
  const sessionIdRef = useRef(id)
  sessionIdRef.current = id
  const translateRef = useRef(t)
  translateRef.current = t

  useEffect(() => {
    useEditSessionStore.getState().attach({
      t: (key, params) => translateRef.current(key, params),
      requestRefresh: () => setPreviewRefreshKey((key) => key + 1),
      bumpThumbnail: (pageId) => useSessionDetailUiStore.getState().bumpThumbnailVersion(pageId),
      getPageContext: () => {
        const page = selectedPageRef.current
        const sessionId = sessionIdRef.current
        if (!page?.pageId || !page.htmlPath || !sessionId) return null
        return { pageId: page.pageId, htmlPath: page.htmlPath, sessionId }
      }
    })
  }, [])

  useEffect(() => {
    setRefreshCurrentPreviewHandler(() => {
      const selected = selectedPageRef.current
      if (!selected?.pageId) return
      setPreviewRefreshKey((key) => key + 1)
    })
    return () => setRefreshCurrentPreviewHandler(null)
  }, [setRefreshCurrentPreviewHandler])

  const handlePreviewIframe = useCallback((handle: PreviewIframeHandle | null): void => {
    previewIframeRef.current = handle
    useEditSessionStore.getState().setIframeHandle(handle)
  }, [])

  useEffect(() => {
    resetForPageChange()
    useEditSessionStore.getState().resetForPage()
    clearEditSelectedElement()
  }, [clearEditSelectedElement, resetForPageChange, selectedPage?.pageId])

  const canEditInSessionDetail = useMemo(() => {
    if (!currentSession) return false
    return getEditorGate(currentSession).canEdit
  }, [currentSession])
  useEffect(() => {
    if (!id) return
    let cancelled = false
    setMessages([])
    useGenerateStore.getState().setPages([])
    useGenerationActivityStore.getState().reset()
    resetForSessionChange()
    void (async () => {
      try {
        await ipc.migratePageOutlinesToSourceSkeletons({ sessionId: id })
      } catch (err) {
        console.warn('[session] migrate page outlines failed', err)
      }
      if (!cancelled) {
        await loadSession(id, () => !cancelled)
      }
    })()
    // Cleanup on unmount (leaving session-detail)
    return () => {
      cancelled = true
      useGenerateStore.getState().reset()
      useGenerationActivityStore.getState().reset()
      useSessionDetailUiStore.getState().resetForSessionChange()
      useEditHistoryStore.getState().clear()
      useEditSessionStore.getState().resetForPage()
    }
  }, [id, loadSession, resetForSessionChange, setMessages])

  useEffect(() => {
    useGenerateStore.getState().setPages(currentGeneratedPages)
  }, [currentGeneratedPages])

  useEffect(() => {
    if (!id || !currentSession) return
    // Don't redirect during addPage / retrySinglePage — we're already on the editor page
    if (
      useSessionDetailUiStore.getState().isAddingPage ||
      useSessionDetailUiStore.getState().isRetryingSinglePage
    )
      return
    if (!canEditInSessionDetail) {
      const metadata = parseSessionMetadata(currentSession.metadata)
      navigate(
        metadata.source === 'template'
          ? `/sessions/${id}/template-generating`
          : `/sessions/${id}/generating`,
        { replace: true }
      )
    }
  }, [canEditInSessionDetail, currentSession, id, navigate])

  useEffect(() => {
    if (!id) return
    const saved = window.localStorage.getItem(`workbench:selected-page-id:${id}`)
    if (!saved) return
    useSessionDetailUiStore.getState().setSelectedPageId(saved)
  }, [id])

  useEffect(() => {
    // Skip auto-select during addPage / retrySinglePage — selection managed explicitly
    if (
      useSessionDetailUiStore.getState().isAddingPage ||
      useSessionDetailUiStore.getState().isRetryingSinglePage
    )
      return

    if (normalizedOrderedPages.length === 0) {
      useSessionDetailUiStore.getState().setSelectedPageId(null)
      return
    }

    if (selectedPageId && normalizedOrderedPages.some((page) => page.id === selectedPageId)) {
      return
    }

    useSessionDetailUiStore.getState().setSelectedPageId(normalizedOrderedPages[0].id)
  }, [normalizedOrderedPages, selectedPageId])

  useEffect(() => {
    if (!id || !selectedPageId) return
    window.localStorage.setItem(`workbench:selected-page-id:${id}`, String(selectedPageId))
  }, [id, selectedPageId])

  useEffect(() => {
    setChatType('page')
  }, [id, setChatType])

  useEffect(() => {
    const pageId = chatType === 'page' ? selectedPage?.id : undefined
    activeChatRef.current = { chatType, pageId }
  }, [chatType, selectedPage?.id])

  useEffect(() => {
    if (!id) return
    if (chatType === 'page' && !selectedPage?.id) {
      void loadMessages({
        sessionId: id,
        chatType: 'page',
        pageId: undefined
      })
      return
    }
    void loadMessages({
      sessionId: id,
      chatType,
      pageId: chatType === 'page' ? selectedPage?.id : undefined
    })
  }, [id, chatType, selectedPage?.id, loadMessages, setMessages])

  useEffect(() => {
    const pageId = selectedPage?.id
    if (!id || !pageId) {
      useSessionDetailUiStore.getState().setImageMessages([])
      return
    }

    const cacheKey = buildImageMessageCacheKey(id, pageId)
    const detailState = useSessionDetailUiStore.getState()
    if (detailState.loadedImageMessageKeys[cacheKey]) {
      detailState.setImageMessages(detailState.imageMessageCache[cacheKey] || [])
      return
    }

    detailState.setImageMessages(detailState.imageMessageCache[cacheKey] || [])
    let cancelled = false
    void ipc
      .listImageGenerationHistory({ sessionId: id, pageId })
      .then((histories) => {
        if (cancelled) return
        const historyMessages = imageHistoryToMessages(histories)
        const latestState = useSessionDetailUiStore.getState()
        const mergedMessages = mergeImageMessages(
          historyMessages,
          latestState.imageMessageCache[cacheKey] || []
        )
        latestState.setLoadedImageMessages(cacheKey, mergedMessages)
        latestState.setImageMessages(mergedMessages)
      })
      .catch((err) => {
        if (!cancelled) {
          toastError(err instanceof Error ? err.message : t('sessionDetail.imageHistoryLoadFailed'))
        }
      })

    return () => {
      cancelled = true
    }
  }, [id, selectedPage?.id, t, toastError])

  useEffect(() => {
    if (!id) return
    const handler = (event: GenerateChunkEvent): void => {
      const { type, payload } = event
      if (payload.sessionId && payload.sessionId !== id) return
      if (
        type === 'stage_started' ||
        type === 'stage_progress' ||
        type === 'page_generated' ||
        type === 'llm_status'
      ) {
        // 不清空 currentPages，保持预览可见
        useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
        updateProgress({
          stage: payload.stage,
          label: payload.label,
          progress: payload.progress ?? 0,
          currentPage: payload.currentPage,
          totalPages: payload.totalPages
        })
        if (type === 'page_generated') {
          // Skip page_generated during addPage — pages will be reloaded on run_completed
          if (useSessionDetailUiStore.getState().isAddingPage) {
            updateProgress({
              stage: payload.stage,
              label: payload.label,
              progress: payload.progress ?? 0,
              currentPage: payload.currentPage,
              totalPages: payload.totalPages
            })
            return
          }
          const store = useGenerateStore.getState()
          const existingPage = store.currentPages.find((page) =>
            payload.id
              ? page.id === payload.id
              : payload.pageId
                ? page.pageId === payload.pageId
                : page.pageNumber === payload.pageNumber
          )
          const entityId =
            payload.id || existingPage?.id || payload.pageId || `page-${payload.pageNumber}`
          // 全新生成：第 1 页到来时清掉旧页面，避免新旧混合
          if (payload.pageNumber === 1 && store.currentPages.length > 0) {
            store.setPages([])
          }
          store.addPage({
            id: entityId,
            pageNumber: payload.pageNumber,
            title: payload.title,
            contentOutline: payload.contentOutline,
            html: payload.html,
            htmlPath: payload.htmlPath,
            pageId: payload.pageId || `page-${payload.pageNumber}`,
            sourceUrl: payload.sourceUrl,
            status: 'completed',
            error: null
          })
          if (payload.focusPage !== false) {
            useSessionDetailUiStore.getState().setSelectedPageId(entityId)
          }
          useSessionDetailUiStore.getState().bumpPreviewKey()
        }
      } else if (type === 'page_updated') {
        useGenerateStore.setState({ isGenerating: true, error: null, status: 'running' })
        const store = useGenerateStore.getState()
        const existingPage = store.currentPages.find((page) =>
          payload.id
            ? page.id === payload.id
            : payload.pageId
              ? page.pageId === payload.pageId
              : page.pageNumber === payload.pageNumber
        )
        const entityId =
          payload.id || existingPage?.id || payload.pageId || `page-${payload.pageNumber}`
        useGenerateStore.getState().addPage({
          id: entityId,
          pageNumber: payload.pageNumber,
          title: payload.title,
          contentOutline: payload.contentOutline,
          html: payload.html,
          htmlPath: payload.htmlPath,
          pageId: payload.pageId || `page-${payload.pageNumber}`,
          sourceUrl: payload.sourceUrl,
          status: 'completed',
          error: null
        })
        if (payload.focusPage !== false) {
          useSessionDetailUiStore.getState().setSelectedPageId(entityId)
        }
        useSessionDetailUiStore.getState().bumpPreviewKey()
      } else if (type === 'assistant_message') {
        const incomingType = payload.chatType === 'page' && payload.pageId ? 'page' : 'main'
        const incomingPageId = incomingType === 'page' ? payload.pageId : undefined
        const active = activeChatRef.current
        const matchesCurrentChat =
          incomingType === active.chatType &&
          (incomingType !== 'page' || incomingPageId === active.pageId)
        if (!matchesCurrentChat) return
        const createdAt = payload.timestamp
          ? Math.floor(new Date(payload.timestamp).getTime() / 1000)
          : Math.floor(Date.now() / 1000)
        addMessage({
          id: payload.id || crypto.randomUUID(),
          session_id: id,
          chat_scope: incomingType,
          page_id: incomingPageId || null,
          role: 'assistant',
          content: payload.content,
          type: 'text',
          tool_name: null,
          tool_call_id: null,
          token_count: null,
          created_at: Number.isFinite(createdAt) ? createdAt : Math.floor(Date.now() / 1000)
        })
      } else if (type === 'run_completed') {
        if (!useSessionDetailUiStore.getState().isAddingPage) {
          useGenerateStore.getState().finishGeneration()
        }
      } else if (type === 'run_error') {
        if (!useSessionDetailUiStore.getState().isAddingPage) {
          if (payload.cancelled) {
            useGenerateStore.getState().cancelGeneration(payload.message)
          } else {
            useGenerateStore.getState().setError(payload.message)
          }
          void loadSession(id)
        }
      }
    }
    const unsubscribe = ipc.onGenerateChunk(handler)
    return () => {
      unsubscribe?.()
    }
  }, [addMessage, id, updateProgress])

  useEffect(() => {
    if (!id) return
    const unsubscribe = ipc.onSpeechProgress((payload) => {
      if (payload.sessionId !== id) return
      useSessionDetailUiStore
        .getState()
        .setSpeechProgress({ current: payload.current, total: payload.total })
    })
    return () => unsubscribe()
  }, [id])

  const handleCopyElement = async (): Promise<void> => {
    if (!elementSelection || !selectedPage?.pageId || !selectedPage.htmlPath) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    let copyResult: { selector: string; htmlFragment: string } | null | undefined
    try {
      copyResult = await previewIframeRef.current?.copyElement(elementSelection.selector, blockId)
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.copyElementFailed'))
      return
    }
    if (!copyResult) {
      toastError(t('sessionDetail.copyElementFailed'))
      return
    }
    const newSelector = copyResult.selector
    const bounds = elementSelection.pageBounds || elementSelection.bounds
    const zValue =
      elementSelection.zIndex !== undefined ? String(elementSelection.zIndex + 1) : '10'
    const nextSnapshot = elementSelection.snapshot
      ? {
          ...elementSelection.snapshot,
          selector: newSelector,
          blockId,
          label: newSelector,
          metrics: {
            ...elementSelection.snapshot.metrics,
            page: bounds
              ? { x: bounds.x + 20, y: bounds.y + 20, width: bounds.width, height: bounds.height }
              : elementSelection.snapshot.metrics.page,
            viewport: bounds
              ? { x: bounds.x + 20, y: bounds.y + 20, width: bounds.width, height: bounds.height }
              : elementSelection.snapshot.metrics.viewport,
            translateX: 0,
            translateY: 0
          }
        }
      : null
    editHistory.addElement({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector: `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`,
      htmlFragment: copyResult.htmlFragment,
      assignedBlockId: blockId,
      insertIndex: -1
    })
    useEditSessionStore.getState().selectElement({
      selector: newSelector,
      blockId,
      label: newSelector,
      elementTag: elementSelection.elementTag,
      elementText: '',
      kind: elementSelection.kind,
      capabilities: elementSelection.capabilities,
      snapshot: nextSnapshot,
      isText: false,
      text: '',
      style: {},
      bounds: bounds
        ? { x: bounds.x + 20, y: bounds.y + 20, width: bounds.width, height: bounds.height }
        : undefined,
      pageBounds: bounds
        ? { x: bounds.x + 20, y: bounds.y + 20, width: bounds.width, height: bounds.height }
        : undefined,
      translateX: 0,
      translateY: 0,
      zIndex: parseInt(zValue, 10),
      editability: { x: true, y: true, width: true, height: true }
    })
  }

  const readElementSnapshotWithRetry = async (
    selector: string
  ): Promise<EditableElementSnapshot | null> => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50))
      }
      const snapshot = await previewIframeRef.current?.readElementSnapshot(selector)
      if (snapshot) return snapshot
    }
    return null
  }

  const handleAddTextElement = async (): Promise<void> => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath || !slideSize) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    const parentSelector = `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`
    const existingCount = editHistory.addElements.filter(
      (e) => e.pageId === selectedPage.pageId
    ).length
    const offset = existingCount * ADDED_TEXT_OFFSET_STEP
    const w = ADDED_TEXT_WIDTH
    const h = ADDED_TEXT_MIN_HEIGHT
    const left = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize.width - w) / 2) + offset,
      slideSize.width - w - ADDED_ELEMENT_EDGE_PADDING
    )
    const top = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize.height - h) / 2) + offset,
      slideSize.height - h - ADDED_ELEMENT_EDGE_PADDING
    )
    const zIdx = 10 + existingCount
    const defaultText = t('editMode.defaultText')
    const textStyle = [
      'position:absolute',
      `left:${left}px`,
      `top:${top}px`,
      `width:${w}px`,
      `min-height:${h}px`,
      'margin:0',
      'padding:0',
      `z-index:${zIdx}`,
      'color:#34402c',
      'font-size:40px',
      'font-weight:700',
      'line-height:1.18',
      'letter-spacing:0',
      'white-space:pre-wrap',
      'overflow-wrap:anywhere',
      'font-family:inherit'
    ].join('; ')
    const htmlFragment = `<p data-block-id="${blockId}" style="${textStyle};">${escapeHtmlText(defaultText)}</p>`

    useEditSessionStore.getState().commitCurrentDraft()
    editHistory.addElement({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector,
      htmlFragment,
      assignedBlockId: blockId,
      insertIndex: -1
    })
    previewIframeRef.current?.injectElement(parentSelector, htmlFragment)

    const selector = `body[data-page-id="${selectedPage.pageId}"] [data-block-id="${blockId}"]`
    if (useSessionDetailUiStore.getState().selectedPageId !== selectedPage.id) return
    const snapshot = await readElementSnapshotWithRetry(selector)
    if (!snapshot) return
    useEditSessionStore.getState().selectElement(
      buildSelectedElementFromSnapshot({
        selector,
        blockId,
        snapshot
      })
    )
  }

  const handleAddArtTextElement = async (templateId: ArtTextTemplateId): Promise<void> => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath || !slideSize) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    const parentSelector = `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`
    const existingCount = editHistory.addElements.filter(
      (e) => e.pageId === selectedPage.pageId
    ).length
    const offset = existingCount * ADDED_TEXT_OFFSET_STEP
    const w = ADDED_ART_TEXT_WIDTH
    const h = ADDED_ART_TEXT_MIN_HEIGHT
    const left = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize.width - w) / 2) + offset,
      slideSize.width - w - ADDED_ELEMENT_EDGE_PADDING
    )
    const top = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize.height - h) / 2) + offset,
      slideSize.height - h - ADDED_ELEMENT_EDGE_PADDING
    )
    const zIdx = 10 + existingCount
    const htmlFragment = buildArtTextHtmlFragment(templateId, {
      blockId,
      left,
      top,
      width: w,
      minHeight: h,
      zIndex: zIdx
    })

    useEditSessionStore.getState().commitCurrentDraft()
    editHistory.addElement({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector,
      htmlFragment,
      assignedBlockId: blockId,
      insertIndex: -1
    })
    previewIframeRef.current?.injectElement(parentSelector, htmlFragment)

    const selector = `body[data-page-id="${selectedPage.pageId}"] [data-block-id="${blockId}"]`
    if (useSessionDetailUiStore.getState().selectedPageId !== selectedPage.id) return
    const snapshot = await readElementSnapshotWithRetry(selector)
    if (!snapshot) return
    useEditSessionStore.getState().selectElement(
      buildSelectedElementFromSnapshot({
        selector,
        blockId,
        snapshot
      })
    )
  }

  const handleAddShapeElement = async (type: InsertShapeType): Promise<void> => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath) return
    const def = getShapeDefinition(type)
    if (!def) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    const parentSelector = `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`
    const existingCount = editHistory.addElements.filter(
      (e) => e.pageId === selectedPage.pageId
    ).length
    const offset = existingCount * ADDED_TEXT_OFFSET_STEP
    const w = def.defaultWidth
    const h = def.defaultHeight
    const left = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize!.width - w) / 2) + offset,
      slideSize!.width - w - ADDED_ELEMENT_EDGE_PADDING
    )
    const top = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize!.height - h) / 2) + offset,
      slideSize!.height - h - ADDED_ELEMENT_EDGE_PADDING
    )
    const zIdx = 10 + existingCount
    const htmlFragment = buildShapeElementHtml({
      blockId,
      type,
      left,
      top,
      width: w,
      height: h,
      zIndex: zIdx
    })

    useEditSessionStore.getState().commitCurrentDraft()
    editHistory.addElement({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector,
      htmlFragment,
      assignedBlockId: blockId,
      insertIndex: -1
    })
    previewIframeRef.current?.injectElement(parentSelector, htmlFragment)

    const selector = `body[data-page-id="${selectedPage.pageId}"] [data-block-id="${blockId}"]`
    if (useSessionDetailUiStore.getState().selectedPageId !== selectedPage.id) return
    const snapshot = await readElementSnapshotWithRetry(selector)
    if (!snapshot) return
    useEditSessionStore.getState().selectElement(
      buildSelectedElementFromSnapshot({
        selector,
        blockId,
        snapshot
      })
    )
  }

  const handleAddIconElement = async (iconId: string): Promise<void> => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    const parentSelector = `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`
    const existingCount = editHistory.addElements.filter(
      (e) => e.pageId === selectedPage.pageId
    ).length
    const offset = existingCount * ADDED_TEXT_OFFSET_STEP
    const w = ADDED_ICON_SIZE
    const h = ADDED_ICON_SIZE
    const left = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize!.width - w) / 2) + offset,
      slideSize!.width - w - ADDED_ELEMENT_EDGE_PADDING
    )
    const top = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize!.height - h) / 2) + offset,
      slideSize!.height - h - ADDED_ELEMENT_EDGE_PADDING
    )
    const zIdx = 10 + existingCount
    const htmlFragment = buildIconElementHtml({
      blockId,
      iconId,
      left,
      top,
      width: w,
      height: h,
      zIndex: zIdx
    })

    useEditSessionStore.getState().commitCurrentDraft()
    editHistory.addElement({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector,
      htmlFragment,
      assignedBlockId: blockId,
      insertIndex: -1
    })
    previewIframeRef.current?.injectElement(parentSelector, htmlFragment)

    const selector = `body[data-page-id="${selectedPage.pageId}"] [data-block-id="${blockId}"]`
    if (useSessionDetailUiStore.getState().selectedPageId !== selectedPage.id) return
    const snapshot = await readElementSnapshotWithRetry(selector)
    if (!snapshot) return
    useEditSessionStore.getState().selectElement(
      buildSelectedElementFromSnapshot({
        selector,
        blockId,
        snapshot
      })
    )
  }

  const handleAddChartElement = async (type: InsertChartType): Promise<void> => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    const parentSelector = `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`
    const existingCount = editHistory.addElements.filter(
      (e) => e.pageId === selectedPage.pageId
    ).length
    const offset = existingCount * ADDED_TEXT_OFFSET_STEP
    const w = ADDED_CHART_WIDTH
    const h = ADDED_CHART_HEIGHT
    const left = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize!.width - w) / 2) + offset,
      slideSize!.width - w - ADDED_ELEMENT_EDGE_PADDING
    )
    const top = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize!.height - h) / 2) + offset,
      slideSize!.height - h - ADDED_ELEMENT_EDGE_PADDING
    )
    const zIdx = 10 + existingCount
    const htmlFragment = buildChartElementHtml(
      {
        blockId,
        left,
        top,
        width: w,
        height: h,
        zIndex: zIdx
      },
      DEFAULT_CHART_DATA[type] || DEFAULT_CHART_DATA.bar
    )

    useEditSessionStore.getState().commitCurrentDraft()
    editHistory.addElement({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector,
      htmlFragment,
      assignedBlockId: blockId,
      insertIndex: -1
    })
    previewIframeRef.current?.injectElement(parentSelector, htmlFragment)

    const selector = `body[data-page-id="${selectedPage.pageId}"] [data-block-id="${blockId}"]`
    if (useSessionDetailUiStore.getState().selectedPageId !== selectedPage.id) return
    const snapshot = await readElementSnapshotWithRetry(selector)
    if (!snapshot) return
    useEditSessionStore.getState().selectElement(
      buildSelectedElementFromSnapshot({
        selector,
        blockId,
        snapshot
      })
    )
  }

  const handleAddFormulaElement = async (): Promise<void> => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath) return
    const rendered = renderFormulaToHtml(DEFAULT_FORMULA_LATEX, true)
    if (!rendered.html) return
    const blockId = 'select-arcsin1-' + nanoid(8)
    const parentSelector = `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`
    const existingCount = editHistory.addElements.filter(
      (e) => e.pageId === selectedPage.pageId
    ).length
    const offset = existingCount * ADDED_TEXT_OFFSET_STEP
    const w = ADDED_FORMULA_WIDTH
    const h = ADDED_FORMULA_HEIGHT
    const left = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize!.width - w) / 2) + offset,
      slideSize!.width - w - ADDED_ELEMENT_EDGE_PADDING
    )
    const top = Math.min(
      Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize!.height - h) / 2) + offset,
      slideSize!.height - h - ADDED_ELEMENT_EDGE_PADDING
    )
    const zIdx = 10 + existingCount
    const formulaStyle = [
      'position:absolute',
      `left:${left}px`,
      `top:${top}px`,
      `width:${w}px`,
      `height:${h}px`,
      `z-index:${zIdx}`,
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'box-sizing:border-box',
      'padding:8px',
      'color:#111827',
      'font-size:30px',
      'line-height:1.2'
    ].join('; ')
    const htmlFragment = `<div data-block-id="${blockId}" data-ppt-edit-kind="formula" style="${formulaStyle};">${rendered.html}</div>`

    useEditSessionStore.getState().commitCurrentDraft()
    editHistory.addElement({
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector,
      htmlFragment,
      assignedBlockId: blockId,
      insertIndex: -1
    })
    previewIframeRef.current?.injectElement(parentSelector, htmlFragment)

    const selector = `body[data-page-id="${selectedPage.pageId}"] [data-block-id="${blockId}"]`
    if (useSessionDetailUiStore.getState().selectedPageId !== selectedPage.id) return
    const snapshot = await readElementSnapshotWithRetry(selector)
    if (!snapshot) return
    useEditSessionStore.getState().selectElement(
      buildSelectedElementFromSnapshot({
        selector,
        blockId,
        snapshot
      })
    )
  }

  const handleAddElement = async (
    relativePath: string,
    _fileName: string,
    options: AddSessionElementOptions = {}
  ): Promise<boolean> => {
    if (!id || !selectedPage?.pageId || !selectedPage.htmlPath || !slideSize) return false
    const selectedHtmlPath = selectedPage.htmlPath
    const blockId = 'select-arcsin1-' + nanoid(8)
    const parentSelector = `body[data-page-id="${selectedPage.pageId}"] [data-ppt-guard-root="1"]`
    const isVideo = /^\.\/videos\//i.test(relativePath)
    const isBackground = Boolean(options.asBackground && !isVideo)
    if (isBackground) previewIframeRef.current?.clearEditModeSelection()
    const safeRelativePath = escapeHtmlText(relativePath)
    // Offset each added element so they don't overlap
    const existingCount = editHistory.addElements.filter(
      (e) => e.pageId === selectedPage.pageId
    ).length
    const offset = existingCount * ADDED_MEDIA_OFFSET_STEP
    const w = isBackground ? slideSize.width : isVideo ? 640 : 400
    const h = isBackground ? slideSize.height : isVideo ? 360 : 300
    const left = isBackground
      ? 0
      : Math.min(
          Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize.width - w) / 2) + offset,
          slideSize.width - w - ADDED_ELEMENT_EDGE_PADDING
        )
    const top = isBackground
      ? 0
      : Math.min(
          Math.max(ADDED_ELEMENT_EDGE_PADDING, (slideSize.height - h) / 2) + offset,
          slideSize.height - h - ADDED_ELEMENT_EDGE_PADDING
        )
    const zIdx = isBackground ? 0 : 10 + existingCount
    const insertIndex = -1
    const objectFit = isBackground ? 'cover' : 'contain'
    const htmlFragment = isBackground
      ? `<style data-ppt-generated-background-style="1">body[data-page-id="${escapeCssString(selectedPage.pageId)}"] .ppt-page-root[data-ppt-guard-root="1"]{background:transparent !important;background-color:transparent !important;}</style><img src="${safeRelativePath}" alt="" data-block-id="${blockId}" data-ppt-generated-background="1" style="position:absolute; left:${left}px; top:${top}px; width:${w}px; height:${h}px; z-index:${zIdx}; object-fit:${objectFit}; opacity:0.5;" />`
      : isVideo
        ? `<video src="${safeRelativePath}" data-block-id="${blockId}" style="position:absolute; left:${left}px; top:${top}px; width:${w}px; height:${h}px; z-index:${zIdx}; object-fit:${objectFit};" controls playsinline preload="metadata"></video>`
        : `<img src="${safeRelativePath}" alt="" data-block-id="${blockId}" style="position:absolute; left:${left}px; top:${top}px; width:${w}px; height:${h}px; z-index:${zIdx}; object-fit:${objectFit};" />`
    useEditSessionStore.getState().commitCurrentDraft()
    const addElementItem = {
      pageId: selectedPage.pageId,
      htmlPath: selectedPage.htmlPath,
      parentSelector,
      htmlFragment,
      assignedBlockId: blockId,
      insertIndex
    }
    const backgroundSelectors: string[] = [
      '[data-ppt-generated-background="1"]',
      '[data-ppt-generated-background-style="1"]'
    ]
    if (options.persistImmediately) {
      const result = await ipc.saveEditBatch({
        sessionId: id,
        htmlPath: selectedPage.htmlPath,
        pageId: selectedPage.pageId,
        dragEdits: [],
        textEdits: [],
        propertyEdits: [],
        deletes: isBackground
          ? backgroundSelectors.map((selector) => ({
              pageId: selectedPage.pageId,
              htmlPath: selectedPage.htmlPath,
              selector
            }))
          : [],
        addElements: [addElementItem],
        prompt: options.prompt || (isVideo ? '添加视频元素' : '添加图片元素')
      })
      if (!result.success) throw new Error(t('sessionDetail.layoutSaveFailed'))
      useSessionDetailUiStore.getState().bumpThumbnailVersion(selectedPage.pageId)
    } else {
      if (isBackground) {
        const deletes = backgroundSelectors.map((selector) => ({
          pageId: selectedPage.pageId,
          htmlPath: selectedHtmlPath,
          selector
        }))
        editHistory.addElementWithDeletes(addElementItem, deletes)
      } else {
        editHistory.addElement(addElementItem)
      }
    }
    if (isBackground) {
      backgroundSelectors.forEach((selector) => previewIframeRef.current?.hideElement(selector))
    }
    previewIframeRef.current?.injectElement(parentSelector, htmlFragment, insertIndex, true)
    const selector = `body[data-page-id="${selectedPage.pageId}"] [data-block-id="${blockId}"]`
    if (useSessionDetailUiStore.getState().selectedPageId !== selectedPage.id) return true
    const snapshot = await readElementSnapshotWithRetry(selector)
    if (snapshot) {
      useEditSessionStore.getState().selectElement(
        buildSelectedElementFromSnapshot({
          selector,
          blockId,
          snapshot
        })
      )
    }
    return true
  }

  useEffect(() => {
    addElementHandlerRef.current = handleAddElement
  }, [handleAddElement])

  useEffect(() => {
    setAddElementHandler(invokeAddElement)
    return () => setAddElementHandler(null)
  }, [invokeAddElement, setAddElementHandler])

  const handleBackToSessions = (): void => {
    useGenerateStore.getState().reset()
    useSessionDetailUiStore.getState().resetForSessionChange()
    resetRuntimeState()
    navigate('/sessions')
  }

  const handleAddFromLibrary = (assetType: 'image' | 'video'): void => {
    setAssetPickerOpen(true, assetType)
  }

  const handleAddFromLocal = async (assetType: 'image' | 'video'): Promise<void> => {
    if (!id) return
    const result = await ipc.chooseAndUploadAssets(id, assetType)
    if (result.cancelled || !result.assets?.length) return
    const asset = result.assets[0]
    await handleAddElement(asset.relativePath, asset.originalName || asset.fileName)
  }

  useWorkspaceRibbonActionsRegistration({
    onUndo: () => useEditSessionStore.getState().undo(),
    onRedo: () => useEditSessionStore.getState().redo(),
    onSaveCurrentPage: () => void useEditSessionStore.getState().save(),
    onDiscardAllEdits: () => useEditSessionStore.getState().discardAll(),
    onApplySelectedToAllPages: () => void useEditSessionStore.getState().applySelectedToAllPages(),
    onCopySelectedElement: () => void handleCopyElement(),
    onDeleteSelectedElement: () => useEditSessionStore.getState().deleteSelected(),
    onBackToSessions: handleBackToSessions,
    onAddFromLibrary: handleAddFromLibrary,
    onAddFromLocal: (type) => void handleAddFromLocal(type),
    onAddText: () => void handleAddTextElement(),
    onAddArtText: (templateId) => void handleAddArtTextElement(templateId),
    onAddShape: (type) => void handleAddShapeElement(type),
    onAddIcon: (iconId) => void handleAddIconElement(iconId),
    onAddChart: (type) => void handleAddChartElement(type),
    onAddFormula: () => void handleAddFormulaElement()
  })

  if (!id || !slideSize) {
    return <div className="h-full bg-[#f3f1ed]" />
  }

  return (
    <TooltipProvider delayDuration={180}>
      <div className="flex h-full min-h-0 flex-col bg-[#f3f1ed] text-foreground outline-none">
        <header className="app-drag-region app-titlebar relative shrink-0 border-b border-[#e7dfd4] bg-[#faf8f3]/98 backdrop-blur-xl">
          <div
            className={`relative flex h-full items-center ${
              isMac ? '' : 'pr-[calc(var(--app-titlebar-control-safe-area)+16px)]'
            }`}
          >
            <div className="flex-1">
              <SessionToolbar sessionId={id} isSavingEdits={isSavingEdits} />
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col bg-[#f3f1ed]">
          <WorkspaceRibbon isSavingEdits={isSavingEdits} />

          <div className="flex min-h-0 flex-1">
            <PageSidebar sessionId={id} />

            <div className="flex min-h-0 flex-1">
              <PreviewStage
                  ref={handlePreviewIframe}
                  selectedPage={selectedPage}
                  sessionTitle={currentSession?.title}
                  previewRefreshKey={previewRefreshKey}
                  onElementMoved={(payload) => useEditSessionStore.getState().handleMoved(payload)}
                  onElementSelected={(payload) =>
                    useEditSessionStore.getState().selectElement(payload)
                  }
                  onCancelElementEdit={() => useEditSessionStore.getState().cancelEdit()}
                  onDiscardAllEdits={() => useEditSessionStore.getState().discardAll()}
                  onUndo={() => useEditSessionStore.getState().undo()}
                  onRedo={() => useEditSessionStore.getState().redo()}
                  onReplayPendingEdits={() => useEditSessionStore.getState().replayPending()}
                  onDeleteRequest={(selector) => {
                    setPendingDeleteSelector(selector)
                    setDeleteConfirmOpen(true)
                  }}
              />
              <SessionDetailRightPanel
                  sessionId={id}
                  elementInspector={
                    elementSelection ? (
                      <ElementInspectorPanel
                        selection={elementSelection}
                        draft={elementDraft}
                        onDraftChange={(draft, options) =>
                          useEditSessionStore.getState().updateDraft(draft, options)
                        }
                        onClose={() => useEditSessionStore.getState().cancelEdit()}
                      />
                    ) : undefined
                  }
              />
            </div>
          </div>
        </div>

        <HistoryDialog sessionId={id} />
        <AddBlankPageDialog sessionId={id} />
        <AddPageDialog sessionId={id} />
        <MergeSessionPagesDialog sessionId={id} />
        <MergeTemplatePagesDialog sessionId={id} />
        <GenerationActivityDialog sessionId={id} />
        <PageTitleEditDialog sessionId={id} />
        <DeletePageDialog sessionId={id} />
        <AssetPickerDialog
          sessionId={id}
          assetType={assetPickerType}
          open={assetPickerOpen}
          onClose={() => setAssetPickerOpen(false)}
          onConfirm={handleAddElement}
        />
        <DeleteElementDialog
          open={deleteConfirmOpen}
          onOpenChange={(open) => {
            setDeleteConfirmOpen(open)
            if (!open) setPendingDeleteSelector(null)
          }}
          onConfirm={() => {
            if (pendingDeleteSelector) {
              useEditSessionStore.getState().deleteBySelector(pendingDeleteSelector)
            } else {
              useEditSessionStore.getState().deleteSelected()
            }
            setPendingDeleteSelector(null)
            setDeleteConfirmOpen(false)
          }}
        />
      </div>
    </TooltipProvider>
  )
}
