import { memo, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Copy,
  Image as ImageIcon,
  LayoutTemplate,
  Loader2,
  Move,
  PanelLeft,
  PanelRight,
  PencilLine,
  Presentation,
  Plus,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import { useEditHistoryStore, useEditSessionStore, useSessionDetailUiStore } from '@renderer/store'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ScrollArea } from '../../ui/ScrollArea'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/Tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle
} from '../../ui/AlertDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../ui/DropdownMenu'
import { PageThumbnail } from './PageThumbnail'
import type { SessionPreviewPage } from '../shared/types'
import { useT } from '@renderer/i18n'
import { usePreviewWindow } from '../hooks/usePreviewWindow'
import { usePageSidebarController } from './usePageSidebarController'

const THUMBNAIL_PREVIEW_LIMIT = 8

function SortablePageItem({
  id,
  disabled,
  children
}: {
  id: string
  disabled: boolean
  children: (bindings: {
    attributes: ReturnType<typeof useSortable>['attributes']
    listeners: ReturnType<typeof useSortable>['listeners']
    setActivatorNodeRef: ReturnType<typeof useSortable>['setActivatorNodeRef']
    isDragging: boolean
  }) => React.ReactNode
}): React.JSX.Element {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id,
    disabled
  })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1
  }
  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners, setActivatorNodeRef, isDragging })}
    </div>
  )
}

const getPageOutlineText = (page: SessionPreviewPage): string => {
  return page.contentOutline?.trim() || ''
}

const stripOutlineHeadingPrefix = (value: string): string => {
  return value
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/^(?:第?\d+|[一二三四五六七八九十]+)[\s.、：:-]*/, '')
    .trim()
}

const getPageOutlineDisplayText = (page: SessionPreviewPage): string => {
  const outlineText = getPageOutlineText(page)
  if (!outlineText) return ''

  const lines = outlineText.replace(/\r\n/g, '\n').split('\n')
  const title = stripOutlineHeadingPrefix(page.title || '')
  const normalizedFirstLine = stripOutlineHeadingPrefix(lines[0] || '')

  let firstLine = normalizedFirstLine
  if (title && firstLine.startsWith(title)) {
    firstLine = firstLine
      .slice(title.length)
      .replace(/^[\s:：,，.。-]+/, '')
      .trim()
  }

  return [firstLine, ...lines.slice(1).map((line) => line.trim())].filter(Boolean).join('\n').trim()
}

const copyTextToClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      document.execCommand('copy')
    } finally {
      document.body.removeChild(textarea)
    }
  }
}

export const PageSidebar = memo(function PageSidebar({
  sessionId
}: {
  sessionId: string
}): React.JSX.Element {
  const t = useT()
  const {
    pages,
    disabled,
    onAddPage,
    onMergeTemplatePages,
    onRetryFailedPage,
    onReorderPages,
    onDeletePage,
    onRenamePage,
    onDuplicatePage,
    onUpdatePageOutline,
    onExportPagePptx,
    canExportPptx,
    pageManagementDisabled,
    collapsed,
    onToggleCollapsed
  } = usePageSidebarController(sessionId)
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const previewKey = useSessionDetailUiStore((state) => state.previewKey)
  const thumbnailVersions = useSessionDetailUiStore((state) => state.thumbnailVersions)
  const setSelectedPageId = useSessionDetailUiStore((state) => state.setSelectedPageId)
  const setWorkspaceTab = useSessionDetailUiStore((state) => state.setWorkspaceTab)
  const isAddingPage = useSessionDetailUiStore((state) => state.isAddingPage)
  const isExportingPptx = useSessionDetailUiStore((state) => state.isExportingPptx)
  const mergeSessionPagesDialogOpen = useSessionDetailUiStore(
    (state) => state.mergeSessionPagesDialogOpen
  )
  const [activeView, setActiveView] = useState<'pages' | 'outline'>('pages')
  const [copiedOutlinePageId, setCopiedOutlinePageId] = useState<string | null>(null)
  const [editingOutlinePageId, setEditingOutlinePageId] = useState<string | null>(null)
  const [outlineDraft, setOutlineDraft] = useState('')
  const [savingOutlinePageId, setSavingOutlinePageId] = useState<string | null>(null)
  const [pendingSwitchPageId, setPendingSwitchPageId] = useState<string | null>(null)
  const [savingBeforeSwitch, setSavingBeforeSwitch] = useState(false)
  const wasAddingRef = useRef(false)
  const copyResetTimerRef = useRef<number | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const sortableIds = useMemo(() => pages.map((p) => p.id), [pages])
  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  )
  const currentPageHasPendingEdits = useEditHistoryStore((state) =>
    state.hasPendingEdits(selectedPage?.pageId)
  )
  const pendingSwitchPage = useMemo(
    () => pages.find((page) => page.id === pendingSwitchPageId) ?? null,
    [pages, pendingSwitchPageId]
  )
  const {
    activePreviewIds: thumbnailPreviewIds,
    viewportRef,
    schedulePreviewWindowUpdate: scheduleThumbnailPreviewWindowUpdate
  } = usePreviewWindow({
    enabled:
      !collapsed && activeView === 'pages' && pages.length > 0 && !mergeSessionPagesDialogOpen,
    itemIds: sortableIds,
    limit: THUMBNAIL_PREVIEW_LIMIT
  })

  // Keep selected thumbnail in view when add-page completes (isAddingPage: true -> false).
  // Fallback to bottom if selected thumbnail is not found yet.
  useEffect(() => {
    if (wasAddingRef.current && !isAddingPage && viewportRef.current) {
      const viewport = viewportRef.current
      const selectedNode = selectedPageId
        ? viewport.querySelector<HTMLElement>(`[data-page-id="${selectedPageId}"]`)
        : null

      if (selectedNode) {
        selectedNode.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      } else {
        viewport.scrollTop = viewport.scrollHeight
      }
    }
    wasAddingRef.current = isAddingPage
  }, [isAddingPage, selectedPageId, pages.length])

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
    }
  }, [])

  const handleDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    if (!onReorderPages || pageManagementDisabled || disabled) return
    const oldIndex = pages.findIndex((p) => p.id === String(active.id))
    const newIndex = pages.findIndex((p) => p.id === String(over.id))
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    const next = arrayMove(pages, oldIndex, newIndex)
    void onReorderPages(
      next.map((p) => p.id),
      String(active.id)
    )
  }

  const requestSelectPage = (pageId: string): boolean => {
    if (!pageId || disabled) return false
    if (pageId === selectedPageId) {
      setSelectedPageId(pageId)
      setWorkspaceTab('preview')
      return true
    }
    if (currentPageHasPendingEdits) {
      setPendingSwitchPageId(pageId)
      return false
    }
    setSelectedPageId(pageId)
    setWorkspaceTab('preview')
    return true
  }

  const handleConfirmSaveAndSwitch = async (): Promise<void> => {
    const targetPageId = pendingSwitchPageId
    if (!targetPageId || savingBeforeSwitch) return
    setSavingBeforeSwitch(true)
    try {
      const result = await useEditSessionStore.getState().save()
      const stillPending = useEditHistoryStore.getState().hasPendingEdits(selectedPage?.pageId)
      if (result.saved || !stillPending) {
        setSelectedPageId(targetPageId)
        setWorkspaceTab('preview')
        setPendingSwitchPageId(null)
      }
    } finally {
      setSavingBeforeSwitch(false)
    }
  }

  const handleCopyOutline = async (
    page: SessionPreviewPage,
    outlineText: string
  ): Promise<void> => {
    const title = (page.title || t('sessionDetail.untitledPage')).trim()
    const content = outlineText.trim()
    const text = [title, content].filter(Boolean).join('\n')
    if (!text) return
    await copyTextToClipboard(text)
    setCopiedOutlinePageId(page.id)
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current)
    copyResetTimerRef.current = window.setTimeout(() => {
      setCopiedOutlinePageId((current) => (current === page.id ? null : current))
      copyResetTimerRef.current = null
    }, 1600)
  }

  const handleStartEditOutline = (page: SessionPreviewPage, outlineText: string): void => {
    if (page.id !== selectedPageId && currentPageHasPendingEdits) {
      setPendingSwitchPageId(page.id)
      return
    }
    setSelectedPageId(page.id)
    setEditingOutlinePageId(page.id)
    setOutlineDraft(outlineText)
  }

  const handleCancelEditOutline = (): void => {
    setEditingOutlinePageId(null)
    setOutlineDraft('')
  }

  const handleSaveOutline = async (page: SessionPreviewPage): Promise<void> => {
    if (!onUpdatePageOutline || savingOutlinePageId) return
    const normalizedDraft = outlineDraft.replace(/\s+/g, ' ').trim()
    if (normalizedDraft === getPageOutlineText(page)) {
      handleCancelEditOutline()
      return
    }
    setSavingOutlinePageId(page.id)
    try {
      await onUpdatePageOutline(page, normalizedDraft)
      handleCancelEditOutline()
    } finally {
      setSavingOutlinePageId(null)
    }
  }

  return (
    <aside
      className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden border-r border-[#eadfd8] bg-[#faf8f4] pb-3 pt-3 transition-[width] duration-300 ${
        collapsed ? 'w-[48px] min-w-[48px] max-w-[48px]' : 'w-[220px] min-w-[220px] max-w-[220px]'
      }`}
    >
      <div className={`flex min-h-0 flex-1 flex-col ${collapsed ? 'px-1' : 'px-2.5'}`}>
        {collapsed ? (
          // Collapsed: compact icons
          <>
            {/* Middle: page list */}
            <ScrollArea
              className="min-h-0 min-w-0 flex-1"
              viewportClassName="overflow-x-hidden pb-2"
              viewportRef={viewportRef}
            >
              <div className="space-y-1.5">
                {pages.map((page) => (
                  <button
                    key={page.id}
                    type="button"
                    data-page-id={page.id}
                    onClick={() => requestSelectPage(page.id)}
                    className={`flex h-8 w-full items-center justify-center rounded-md text-xs font-semibold transition-all ${selectedPageId === page.id ? 'bg-[#e31921] text-white shadow-sm' : 'text-[#665c56] hover:bg-[#f3e9e3]'}`}
                  >
                    P{page.pageNumber}
                  </button>
                ))}
              </div>
            </ScrollArea>

            {/* Bottom: add page + expand */}
            <div className="mt-2 space-y-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    title={t('sessionDetail.addPage')}
                    aria-label={t('sessionDetail.addPage')}
                    className="flex h-8 w-full cursor-pointer items-center justify-center rounded-md bg-[#fff0e7] text-[#e31921] transition-colors hover:bg-[#ffe1d2] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-max min-w-[9rem]">
                  <DropdownMenuItem onSelect={onAddPage}>
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#e31921]" />
                    <span className="whitespace-nowrap">{t('sessionDetail.addGeneratedPage')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={pageManagementDisabled}
                    onSelect={onMergeTemplatePages}
                  >
                    <LayoutTemplate className="h-3.5 w-3.5 shrink-0 text-[#7c6a4c]" />
                    <span className="whitespace-nowrap">
                      {t('sessionDetail.addPagesFromTemplate')}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onToggleCollapsed}
                    className="flex h-8 w-full cursor-pointer items-center justify-center rounded-md text-[#857872] transition-colors hover:bg-[#f3e9e3] hover:text-[#e31921]"
                    aria-label={t('sessionDetail.expandSidebar')}
                  >
                    <PanelRight className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sessionDetail.expandSidebar')}</TooltipContent>
              </Tooltip>
            </div>
          </>
        ) : (
          // Expanded: full sidebar
          <>
            <div className="mx-1 mb-2 grid grid-cols-2 rounded-md bg-[#f1ece8] p-0.5 text-[10.5px] font-medium text-[#746963]">
              <button
                type="button"
                onClick={() => setActiveView('pages')}
                className={`h-6 rounded-md transition-all ${
                  activeView === 'pages'
                    ? 'bg-white text-[#e31921] shadow-sm'
                    : 'hover:bg-white/70 hover:text-[#e31921]'
                }`}
              >
                {t('sessionDetail.pageTab')}
              </button>
              <button
                type="button"
                onClick={() => setActiveView('outline')}
                className={`h-6 rounded-md transition-all ${
                  activeView === 'outline'
                    ? 'bg-white text-[#e31921] shadow-sm'
                    : 'hover:bg-white/70 hover:text-[#e31921]'
                }`}
              >
                {t('sessionDetail.outlineTab')}
              </button>
            </div>
            {/* Middle: page list */}
            <ScrollArea
              className="min-h-0 min-w-0 flex-1"
              viewportClassName="overflow-x-hidden px-0.5 pb-2"
              viewportRef={viewportRef}
              onViewportScroll={
                activeView === 'pages' ? scheduleThumbnailPreviewWindowUpdate : undefined
              }
            >
              {pages.length === 0 ? (
                <div className="flex min-h-[96px] items-center justify-center rounded-[1.25rem] bg-[#e8e0d0]/54 text-xs text-[#8a9a7b]">
                  {t('sessionDetail.pagesEmpty')}
                </div>
              ) : activeView === 'outline' ? (
                <div className="min-w-0 space-y-1.5 overflow-x-hidden">
                  {pages.map((page) => {
                    const outlineText = getPageOutlineText(page)
                    const outlineDisplayText = getPageOutlineDisplayText(page)
                    const selected = selectedPageId === page.id
                    const copied = copiedOutlinePageId === page.id
                    const editing = editingOutlinePageId === page.id
                    const savingOutline = savingOutlinePageId === page.id
                    return (
                      <div
                        key={page.id}
                        data-page-id={page.id}
                        title={outlineText || page.title}
                        className={`group relative block w-full min-w-0 max-w-full whitespace-normal rounded-[1.25rem] p-1.5 text-left transition-all ${
                          selected
                            ? 'bg-[#d4e4c1]/86 shadow-[0_14px_26px_rgba(93,107,77,0.18)]'
                            : 'bg-[#e8e0d0]/34 hover:bg-[#e8e0d0]/68 hover:shadow-[0_8px_18px_rgba(93,107,77,0.09)]'
                        } ${disabled ? 'opacity-45' : ''}`}
                      >
                        {editing ? (
                          <div className="block min-w-0 max-w-full overflow-hidden rounded-[1rem] bg-[#fffaf1]/72 px-2.5 py-2 shadow-[0_5px_14px_rgba(93,107,77,0.08)]">
                            <p className="mb-1 whitespace-normal break-words text-[12px] font-semibold leading-5 text-[#33402a] [overflow-wrap:anywhere]">
                              {page.title || t('sessionDetail.untitledPage')}
                            </p>
                            <textarea
                              value={outlineDraft}
                              onChange={(event) => setOutlineDraft(event.target.value)}
                              disabled={savingOutline}
                              className="min-h-[84px] w-full resize-none rounded-lg border border-[#d8cfbc]/80 bg-[#fffdf8]/90 px-2 py-1.5 text-[11px] leading-4 text-[#514736] shadow-inner outline-none focus:border-[#9bb98a] disabled:opacity-60"
                              placeholder={t('pageManagement.pageOutlinePlaceholder')}
                              autoFocus
                            />
                            <div className="mt-1.5 flex justify-end gap-1">
                              <button
                                type="button"
                                disabled={savingOutline}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  handleCancelEditOutline()
                                }}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#f1e7d6] text-[#756955] transition-colors hover:bg-[#e8ddca] disabled:opacity-50"
                                aria-label={t('common.cancel')}
                                title={t('common.cancel')}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={savingOutline}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleSaveOutline(page)
                                }}
                                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#5d6b4d] text-white shadow-[0_4px_10px_rgba(62,74,50,0.18)] transition-colors hover:bg-[#4d5a40] disabled:opacity-50"
                                aria-label={t('pageManagement.savePageOutline')}
                                title={t('pageManagement.savePageOutline')}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div
                            role="button"
                            tabIndex={disabled ? -1 : 0}
                            aria-disabled={disabled}
                            onClick={() => requestSelectPage(page.id)}
                            onKeyDown={(event) => {
                              if (disabled) return
                              if (event.key !== 'Enter' && event.key !== ' ') return
                              event.preventDefault()
                              requestSelectPage(page.id)
                            }}
                            className={`relative block w-full min-w-0 rounded-[1rem] text-left ${
                              disabled ? 'cursor-not-allowed' : 'cursor-pointer'
                            }`}
                          >
                            <span className="relative block min-w-0 max-w-full overflow-hidden rounded-[1rem] bg-[#fffaf1]/72 px-2.5 py-2 shadow-[0_5px_14px_rgba(93,107,77,0.08)]">
                              <span className="block whitespace-normal break-words pr-14 text-[12px] font-semibold leading-5 text-[#33402a] [overflow-wrap:anywhere]">
                                {page.title || t('sessionDetail.untitledPage')}
                              </span>
                              <span className="mt-1 block whitespace-normal break-words text-[11px] leading-4 text-[#716654] [overflow-wrap:anywhere]">
                                {outlineDisplayText || t('sessionDetail.outlineEmpty')}
                              </span>
                              {!editing ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      disabled={pageManagementDisabled || disabled}
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        handleStartEditOutline(page, outlineText)
                                      }}
                                      className="absolute right-9 top-2 inline-flex h-6 w-6 items-center justify-center rounded bg-white p-1 text-[#5d6b4d] opacity-0 shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] group-hover:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-0"
                                      aria-label={t('pageManagement.editPageOutline')}
                                    >
                                      <PencilLine className="h-3.5 w-3.5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="right">
                                    {t('pageManagement.editPageOutline')}
                                  </TooltipContent>
                                </Tooltip>
                              ) : null}
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    disabled={!outlineDisplayText || editing}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void handleCopyOutline(page, outlineDisplayText)
                                    }}
                                    className={`absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full transition-all ${
                                      copied
                                        ? 'bg-[#5d6b4d] text-white shadow-sm'
                                        : 'bg-white text-[#5d6b4d] opacity-0 shadow-sm hover:bg-[#f5f1e8] hover:text-[#3e4a32] group-hover:opacity-100 focus-visible:opacity-100'
                                    } disabled:cursor-not-allowed disabled:opacity-0`}
                                    aria-label={
                                      copied
                                        ? t('sessionDetail.outlineCopied')
                                        : t('sessionDetail.copyOutline')
                                    }
                                  >
                                    {copied ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : (
                                      <Copy className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                </TooltipTrigger>
                                <TooltipContent side="right">
                                  {copied
                                    ? t('sessionDetail.outlineCopied')
                                    : t('sessionDetail.copyOutline')}
                                </TooltipContent>
                              </Tooltip>
                            </span>
                          </div>
                        )}
                        <span className="relative mt-1.5 flex items-center justify-between gap-1 px-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#5c6c47]">
                            P{page.pageNumber}
                          </span>
                          {selected ? (
                            <span className="rounded-full bg-[#5d6b4d] px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-[0_3px_8px_rgba(62,74,50,0.18)]">
                              {t('sessionDetail.current')}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                    <div className="space-y-2.5">
                      {pages.map((page) => (
                        <div key={page.id} data-page-id={page.id} data-preview-window-id={page.id}>
                          <SortablePageItem
                            id={page.id}
                            disabled={pageManagementDisabled || disabled}
                          >
                            {({ attributes, listeners, setActivatorNodeRef, isDragging }) => (
                              <PageThumbnail
                                page={page}
                                isSelected={selectedPageId === page.id}
                                previewVersion={previewKey + (thumbnailVersions[page.pageId] || 0)}
                                renderPreview={thumbnailPreviewIds.has(page.id)}
                                onSelect={disabled ? undefined : requestSelectPage}
                                actions={
                                  <div className="absolute inset-x-1 top-1 z-10 flex items-start justify-between opacity-0 transition-opacity group-hover:opacity-100">
                                    <button
                                      type="button"
                                      ref={setActivatorNodeRef}
                                      disabled={pageManagementDisabled || disabled}
                                      onClick={(e) => {
                                        e.stopPropagation()
                                      }}
                                      className="cursor-grab rounded bg-white/90 p-1 text-[#5d6b4d] shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50"
                                      aria-label={t('pageManagement.dragHandle')}
                                      title={t('pageManagement.dragHandle')}
                                      {...attributes}
                                      {...listeners}
                                    >
                                      <Move
                                        className={`h-4 w-4 ${isDragging ? 'opacity-60' : ''}`}
                                      />
                                    </button>
                                    <div className="flex items-center gap-1">
                                      {canExportPptx ? (
                                        <DropdownMenu>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <DropdownMenuTrigger asChild>
                                                <button
                                                  type="button"
                                                  disabled={
                                                    pageManagementDisabled ||
                                                    disabled ||
                                                    isExportingPptx
                                                  }
                                                  onClick={(e) => e.stopPropagation()}
                                                  className="rounded bg-white/90 p-1 text-[#5d6b4d] shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] disabled:cursor-not-allowed disabled:opacity-50"
                                                  aria-label={t(
                                                    'sessionDetail.exportSinglePagePptx'
                                                  )}
                                                >
                                                  <Presentation className="h-3.5 w-3.5" />
                                                </button>
                                              </DropdownMenuTrigger>
                                            </TooltipTrigger>
                                            <TooltipContent side="right">
                                              {t('sessionDetail.exportSinglePagePptx')}
                                            </TooltipContent>
                                          </Tooltip>
                                          <DropdownMenuContent
                                            side="right"
                                            align="start"
                                            className="min-w-[9rem]"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <DropdownMenuItem
                                              onSelect={() => onExportPagePptx(page)}
                                            >
                                              <Presentation className="h-3.5 w-3.5 shrink-0 text-[#5f6b50]" />
                                              <span className="whitespace-nowrap">
                                                {t('sessionDetail.exportPptxEditable')}
                                              </span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                              onSelect={() =>
                                                onExportPagePptx(page, { imageOnly: true })
                                              }
                                            >
                                              <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[#7c6a4c]" />
                                              <span className="whitespace-nowrap">
                                                {t('sessionDetail.exportPptxImageOnly')}
                                              </span>
                                            </DropdownMenuItem>
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      ) : null}
                                      {onRenamePage ? (
                                        <button
                                          type="button"
                                          disabled={pageManagementDisabled || disabled}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onRenamePage(page)
                                          }}
                                          className="rounded bg-white/90 p-1 text-[#5d6b4d] shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] disabled:cursor-not-allowed disabled:opacity-50"
                                          aria-label={t('pageManagement.editPageTitle')}
                                          title={t('pageManagement.editPageTitle')}
                                        >
                                          <PencilLine className="h-3.5 w-3.5" />
                                        </button>
                                      ) : null}
                                      {onDuplicatePage ? (
                                        <button
                                          type="button"
                                          disabled={pageManagementDisabled || disabled}
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onDuplicatePage(page)
                                          }}
                                          className="rounded bg-white/90 p-1 text-[#5d6b4d] shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] disabled:cursor-not-allowed disabled:opacity-50"
                                          aria-label={t('pageManagement.duplicatePage')}
                                          title={t('pageManagement.duplicatePage')}
                                        >
                                          <Copy className="h-3.5 w-3.5" />
                                        </button>
                                      ) : null}
                                      {onDeletePage ? (
                                        <button
                                          type="button"
                                          disabled={
                                            pageManagementDisabled || disabled || pages.length <= 1
                                          }
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            onDeletePage(page)
                                          }}
                                          className="rounded bg-white/90 p-1 shadow-sm"
                                          aria-label={t('pageManagement.deletePage')}
                                          title={t('pageManagement.deletePage')}
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                      ) : null}
                                    </div>
                                  </div>
                                }
                              />
                            )}
                          </SortablePageItem>
                          {page.status === 'failed' && onRetryFailedPage && (
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => {
                                if (requestSelectPage(page.id)) onRetryFailedPage(page)
                              }}
                              className="group mt-1 block w-full rounded-[1.1rem] bg-[#f3e4df]/85 p-1.5 text-left shadow-[0_8px_18px_rgba(142,90,83,0.08)] transition-all duration-200 hover:bg-[#f1ddd7] hover:shadow-[0_10px_22px_rgba(142,90,83,0.12)] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <div className="rounded-[0.9rem] border border-[#d7b5ae]/70 bg-[#fbf1ee] px-2.5 py-2">
                                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#a36a63]">
                                  P{page.pageNumber}
                                </div>
                                <div className="mt-1 text-[11px] font-medium leading-4 text-[#93564f]">
                                  {t('sessionDetail.retryFailedPage')}
                                </div>
                              </div>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </ScrollArea>

            {/* Bottom: add page + collapse */}
            <div className="mt-2 flex items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-[#efb6a5] bg-[#fff2eb] px-2 py-1.5 text-[11px] font-medium text-[#e31921] transition-colors hover:bg-[#ffe2d5] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" />
                    {t('sessionDetail.addPage')}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-max min-w-[9rem]">
                  <DropdownMenuItem onSelect={onAddPage}>
                    <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#e31921]" />
                    <span className="whitespace-nowrap">{t('sessionDetail.addGeneratedPage')}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={pageManagementDisabled}
                    onSelect={onMergeTemplatePages}
                  >
                    <LayoutTemplate className="h-3.5 w-3.5 shrink-0 text-[#7c6a4c]" />
                    <span className="whitespace-nowrap">
                      {t('sessionDetail.addPagesFromTemplate')}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={onToggleCollapsed}
                    className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-[#857872] transition-colors hover:bg-[#f3e9e3] hover:text-[#e31921]"
                    aria-label={t('sessionDetail.collapseSidebar')}
                  >
                    <PanelLeft className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{t('sessionDetail.collapseSidebar')}</TooltipContent>
              </Tooltip>
            </div>
          </>
        )}
      </div>
      <AlertDialog
        open={Boolean(pendingSwitchPageId)}
        onOpenChange={(open) => {
          if (!open && !savingBeforeSwitch) setPendingSwitchPageId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>{t('sessionDetail.pageSwitchSaveConfirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('sessionDetail.pageSwitchSaveConfirmDescription', {
              page: pendingSwitchPage?.title || t('sessionDetail.untitledPage')
            })}
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel disabled={savingBeforeSwitch}>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={savingBeforeSwitch}
              className="bg-[#e31921] text-white hover:bg-[#c9161d] disabled:cursor-not-allowed disabled:opacity-60"
              onClick={(event) => {
                event.preventDefault()
                void handleConfirmSaveAndSwitch()
              }}
            >
              {savingBeforeSwitch ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t('sessionDetail.pageSwitchSaveConfirmAction')}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
})
