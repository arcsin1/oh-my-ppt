import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  Image as ImageIcon,
  Loader2,
  Move,
  PencilLine,
  Presentation,
  Trash2
} from 'lucide-react'
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  isStyleSwitchPageLocked,
  useGenerateStore,
  useSessionDetailUiStore,
  useSessionStore
} from '@renderer/store'
import { isPageGenerationLocked, normalizePagesForSelection } from '../shared'
import type { SessionPreviewPage } from '../shared/types'
import { PreviewIframe } from '../../preview/PreviewIframe'
import { ScrollArea } from '../../ui/ScrollArea'
import { useT } from '@renderer/i18n'
import { limitBrowsePreviewIds } from './browse-preview-utils'
import { useSessionReorderPages } from '../hooks/useSessionReorderPages'
import { useSessionPageActions } from '../hooks/useSessionPageActions'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/Tooltip'
import { isDefaultSlideSize, trySessionSlideSize } from '@shared/slide-size'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../ui/DropdownMenu'

/** Keep recently-scrolled-past webviews alive as buffer */
const VISIBLE_CACHE = 20

const BrowseCard = memo(function BrowseCard({
  page,
  previewVersion,
  renderPreview
}: {
  page: SessionPreviewPage
  previewVersion: number
  renderPreview: boolean
}): React.JSX.Element {
  const currentSession = useSessionStore((state) => state.currentSession)
  const slideSize = trySessionSlideSize(currentSession)
  const isGeneratingPlaceholder = page.status === 'generating' || page.status === 'pending'
  if (!slideSize) {
    return (
      <div className="group overflow-hidden rounded-[4px] bg-white/60 shadow-[0_4px_16px_rgba(93,107,77,0.08)]">
        <div className="relative flex h-[220px] w-full items-center justify-center overflow-hidden rounded-t-[4px] bg-[#f5f1e8]/88" />
      </div>
    )
  }
  const thumbnailFitStyle =
    slideSize.width >= slideSize.height
      ? { width: '100%', aspectRatio: `${slideSize.width}/${slideSize.height}` }
      : { height: '100%', aspectRatio: `${slideSize.width}/${slideSize.height}` }
  return (
    <div className="group overflow-hidden rounded-[4px] bg-white/60 shadow-[0_4px_16px_rgba(93,107,77,0.08)] transition-shadow hover:shadow-[0_8px_24px_rgba(93,107,77,0.14)]">
      <div
        className="relative flex h-[220px] w-full items-center justify-center overflow-hidden rounded-t-[4px] bg-[#f5f1e8]/88"
        style={{ contain: 'paint' }}
      >
        <div className="relative max-h-full max-w-full overflow-hidden" style={thumbnailFitStyle}>
          {isGeneratingPlaceholder ? (
            <div
              className="flex h-full w-full items-center justify-center bg-[#f8f4eb] text-[#5d6b4d]"
              aria-live="polite"
            >
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : renderPreview ? (
            <PreviewIframe
              key={`browse-${page.id}-${previewVersion}`}
              src={page.sourceUrl}
              htmlPath={page.htmlPath}
              pageId={page.pageId}
              title={`browse-page-${page.pageNumber}`}
              slideSize={slideSize}
              inspectable={false}
              thumbnail
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8a9a7b]">
              P{page.pageNumber}
            </div>
          )}
        </div>
      </div>
      <div className="px-3 py-2.5">
        <span className="inline-block rounded-full bg-[#d4e4c1]/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-[#5c6c47]">
          P{page.pageNumber}
        </span>
        <p
          className="mt-1 text-[12px] font-medium leading-4 text-[#4c5d3d]"
          style={{
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            // leading-4 = 1rem/line; reserve 2 lines so short titles don't
            // shrink the card and misalign the row.
            minHeight: 'calc(2 * 1rem)'
          }}
        >
          {page.title}
        </p>
      </div>
    </div>
  )
})

function SortableBrowseCard({
  page,
  previewVersion,
  renderPreview,
  disabled,
  structureDisabled,
  dragHandleLabel,
  exportLabel,
  exportEditableLabel,
  exportImageOnlyLabel,
  isExportingPptx,
  canExportPptx,
  pageCount,
  onExportPagePptx,
  onRenamePage,
  onDuplicatePage,
  onDeletePage,
  registerRef,
  renameLabel,
  duplicateLabel,
  deleteLabel
}: {
  page: SessionPreviewPage
  previewVersion: number
  renderPreview: boolean
  disabled: boolean
  structureDisabled: boolean
  dragHandleLabel: string
  exportLabel: string
  exportEditableLabel: string
  exportImageOnlyLabel: string
  isExportingPptx: boolean
  canExportPptx: boolean
  pageCount: number
  onExportPagePptx: (page: SessionPreviewPage, options?: { imageOnly?: boolean }) => void
  onRenamePage: (page: SessionPreviewPage) => void
  onDuplicatePage: (page: SessionPreviewPage) => void
  onDeletePage: (page: SessionPreviewPage) => void
  registerRef: (el: HTMLElement | null) => void
  renameLabel: string
  duplicateLabel: string
  deleteLabel: string
}): React.JSX.Element {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({
    id: page.id,
    disabled: structureDisabled
  })
  // Stable composed ref so React doesn't detach/reattach on every render
  // (which would re-register every dnd-kit droppable + re-observe every card
  // on each scroll-driven render). Requires registerRef to be stable.
  const setRef = useCallback(
    (el: HTMLElement | null) => {
      setNodeRef(el)
      registerRef(el)
    },
    [setNodeRef, registerRef]
  )
  return (
    <div
      ref={setRef}
      data-browse-card-id={page.id}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.8 : 1
      }}
      className="group relative"
    >
      <div className="absolute inset-x-2 top-2 z-10 flex items-start justify-between opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              ref={setActivatorNodeRef}
              disabled={structureDisabled}
              onClick={(event) => event.stopPropagation()}
              className={`inline-flex h-8 w-8 items-center justify-center rounded bg-white/90 p-1 text-[#5d6b4d] shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] disabled:cursor-not-allowed disabled:opacity-50 ${
                isDragging ? 'cursor-grabbing' : 'cursor-grab'
              }`}
              aria-label={dragHandleLabel}
              {...attributes}
              {...listeners}
            >
              <Move className={`h-4 w-4 ${isDragging ? 'opacity-60' : ''}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            {dragHandleLabel}
          </TooltipContent>
        </Tooltip>
        <div className="flex items-center gap-1">
          {canExportPptx ? (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      disabled={disabled || isExportingPptx}
                      onClick={(event) => event.stopPropagation()}
                      className="rounded bg-white/90 p-1 text-[#5d6b4d] shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={exportLabel}
                    >
                      <Presentation className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="bottom">{exportLabel}</TooltipContent>
              </Tooltip>
              <DropdownMenuContent
                side="bottom"
                align="end"
                className="min-w-[9rem]"
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenuItem onSelect={() => onExportPagePptx(page)}>
                  <Presentation className="h-3.5 w-3.5 shrink-0 text-[#5f6b50]" />
                  <span className="whitespace-nowrap">{exportEditableLabel}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onExportPagePptx(page, { imageOnly: true })}>
                  <ImageIcon className="h-3.5 w-3.5 shrink-0 text-[#7c6a4c]" />
                  <span className="whitespace-nowrap">{exportImageOnlyLabel}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation()
                  onRenamePage(page)
                }}
                className="rounded bg-white/90 p-1 text-[#5d6b4d] shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={renameLabel}
              >
                <PencilLine className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{renameLabel}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={disabled || structureDisabled}
                onClick={(event) => {
                  event.stopPropagation()
                  onDuplicatePage(page)
                }}
                className="rounded bg-white/90 p-1 text-[#5d6b4d] shadow-sm transition-colors hover:bg-[#f5f1e8] hover:text-[#3e4a32] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={duplicateLabel}
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{duplicateLabel}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                disabled={disabled || structureDisabled || pageCount <= 1}
                onClick={(event) => {
                  event.stopPropagation()
                  onDeletePage(page)
                }}
                className="rounded bg-white/90 p-1 shadow-sm transition-colors hover:bg-[#f5f1e8] disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={deleteLabel}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="end">
              {deleteLabel}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <BrowseCard page={page} previewVersion={previewVersion} renderPreview={renderPreview} />
    </div>
  )
}

export function BrowseView(props: { sessionId: string }): React.JSX.Element {
  const { sessionId } = props
  const t = useT()
  const currentPages = useGenerateStore((state) => state.currentPages)
  const currentSession = useSessionStore((state) => state.currentSession)
  const slideSize = trySessionSlideSize(currentSession)
  const canExportPptx = slideSize ? isDefaultSlideSize(slideSize) : false
  const isGenerating = useGenerateStore((state) => state.isGenerating)
  const isDeckEditing = useGenerateStore((state) => Boolean(state.deckEditJobs[sessionId]))
  const pageEditJob = useGenerateStore((state) => state.pageEditJobs[sessionId] || null)
  const styleSwitchJob = useGenerateStore((state) => state.styleSwitchJobs[sessionId] || null)
  const previewKey = useSessionDetailUiStore((state) => state.previewKey)
  const thumbnailVersions = useSessionDetailUiStore((state) => state.thumbnailVersions)
  const isAddingPage = useSessionDetailUiStore((state) => state.isAddingPage)
  const addingPageId = useSessionDetailUiStore((state) => state.addingPageId)
  const isRetryingSinglePage = useSessionDetailUiStore((state) => state.isRetryingSinglePage)
  const retryingSinglePageId = useSessionDetailUiStore((state) => state.retryingSinglePageId)
  const isManagingPages = useSessionDetailUiStore((state) => state.isManagingPages)
  const { reorder: reorderSessionPages } = useSessionReorderPages(sessionId)
  const pageActions = useSessionPageActions(sessionId)

  const pages = useMemo(() => normalizePagesForSelection(currentPages), [currentPages])
  const hasPageScopedGeneration =
    isAddingPage ||
    isRetryingSinglePage ||
    Boolean(pageEditJob) ||
    Boolean(styleSwitchJob)
  const isSessionWideGenerating = isGenerating && !hasPageScopedGeneration
  const structureDisabled =
    isGenerating || isDeckEditing || isAddingPage || isRetryingSinglePage || isManagingPages
  const isPageActionDisabled = (page: SessionPreviewPage): boolean =>
    isSessionWideGenerating ||
    isDeckEditing ||
    isManagingPages ||
    isPageGenerationLocked(page.id, {
      isAddingPage,
      addingPageId,
      isRetryingSinglePage,
      retryingSinglePageId
    }) ||
    pageEditJob?.pageId === page.pageId ||
    isStyleSwitchPageLocked(styleSwitchJob, page.pageId)

  const pageIds = useMemo(() => new Set(pages.map((page) => page.id)), [pages])
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() => new Set())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const cardRefsRef = useRef<Map<string, HTMLElement>>(new Map())
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  useEffect(() => {
    setVisibleIds((current) => {
      const next = new Set(Array.from(current).filter((id) => pageIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [pageIds])

  useEffect(() => {
    if (pages.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleIds((prev) => {
          const next = new Set(prev)
          let changed = false
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.browseCardId
            if (!id) continue
            if (entry.isIntersecting) {
              if (!next.has(id)) {
                next.add(id)
                changed = true
              }
            } else if (next.delete(id)) {
              changed = true
            }
          }
          return changed ? next : prev
        })
      },
      {
        root: viewportRef.current,
        rootMargin: '200px 100px',
        threshold: 0
      }
    )
    observerRef.current = observer

    for (const el of cardRefsRef.current.values()) {
      observer.observe(el)
    }

    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [pages.length])

  const renderableIds = useMemo(
    () => limitBrowsePreviewIds(visibleIds, VISIBLE_CACHE),
    [visibleIds]
  )

  // Stable per-id ref callbacks (cached) so the composed ref in
  // SortableBrowseCard stays referentially stable across renders.
  const cardRefCallbacksRef = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map())
  const getCardRef = useCallback((pageId: string) => {
    let cb = cardRefCallbacksRef.current.get(pageId)
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        const map = cardRefsRef.current
        if (el) {
          map.set(pageId, el)
          observerRef.current?.observe(el)
        } else {
          const old = map.get(pageId)
          if (old) {
            observerRef.current?.unobserve(old)
            map.delete(pageId)
          }
        }
      }
      cardRefCallbacksRef.current.set(pageId, cb)
    }
    return cb
  }, [])

  if (pages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-[#8a9a7b]">{t('sessionDetail.pagesEmpty')}</p>
      </div>
    )
  }

  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    if (structureDisabled) return
    const oldIndex = pages.findIndex((page) => page.id === String(active.id))
    const newIndex = pages.findIndex((page) => page.id === String(over.id))
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return
    const next = arrayMove(pages, oldIndex, newIndex)
    void reorderSessionPages(
      next.map((page) => page.id),
      String(active.id)
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="flex-1" viewportRef={viewportRef}>
        <div className="p-6">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={pages.map((page) => page.id)} strategy={rectSortingStrategy}>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5">
                {pages.map((page) => {
                  const previewVersion = previewKey + (thumbnailVersions[page.pageId] || 0)
                  return (
                    <SortableBrowseCard
                      key={page.id}
                      page={page}
                      previewVersion={previewVersion}
                      renderPreview={renderableIds.has(page.id)}
                      disabled={isPageActionDisabled(page)}
                      structureDisabled={structureDisabled}
                      dragHandleLabel={t('pageManagement.dragHandle')}
                      exportLabel={t('sessionDetail.exportSinglePagePptx')}
                      exportEditableLabel={t('sessionDetail.exportPptxEditable')}
                      exportImageOnlyLabel={t('sessionDetail.exportPptxImageOnly')}
                      isExportingPptx={pageActions.isExportingPptx}
                      canExportPptx={canExportPptx}
                      pageCount={pages.length}
                      onExportPagePptx={pageActions.exportPagePptx}
                      onRenamePage={pageActions.renamePage}
                      onDuplicatePage={pageActions.duplicatePage}
                      onDeletePage={pageActions.deletePage}
                      registerRef={getCardRef(page.id)}
                      renameLabel={t('pageManagement.editPageTitle')}
                      duplicateLabel={t('pageManagement.duplicatePage')}
                      deleteLabel={t('pageManagement.deletePage')}
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </ScrollArea>
    </div>
  )
}
