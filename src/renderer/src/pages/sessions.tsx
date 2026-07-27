import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Card, CardContent, CardTitle } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/Dialog'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/Tooltip'
import { FileArchive, FileText, FileUp, FolderOpen, LayoutTemplate, MessageSquare, MessagesSquare, Pencil, Search, Sparkles, Trash2, X, type LucideIcon } from 'lucide-react'
import { type Session, useSessionStore } from '../store'
import { useToastStore } from '../store'
import { ipc, type GenerateRunStateSnapshot, type HtmlThumbnailTask } from '../lib/ipc'
import { getEditorGate, parseSessionMetadata } from '../lib/sessionMetadata'
import { useT } from '../i18n'
import { useThumbnailUpdates } from '../hooks/useThumbnailUpdates'
import sessionPlaceholder from '../assets/images/space.webp'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import { resolveSessionSlideSize } from '@shared/slide-size'

dayjs.extend(duration)

type ActiveGenerateRun = GenerateRunStateSnapshot & {
  status: 'queued' | 'running'
}

const localAssetUrl = (filePath: string): string =>
  import.meta.env.MODE === 'test'
    ? 'about:blank'
    : `local-asset://${encodeURIComponent(filePath)}`

const getSourceTag = (
  session: Session,
  labels: { pptx: string; sessionFile: string; saveAsNew: string; document: string; ai: string; thinking: string; template: string }
): { label: string; Icon: LucideIcon; className: string; iconClassName: string } => {
  const metadata = parseSessionMetadata(session.metadata)
  const source = typeof metadata.source === 'string' ? metadata.source : ''
  if (source === 'session-save-as-new') {
    return {
      label: labels.saveAsNew,
      Icon: FileArchive,
      className:
        'border-[#6fc2aa]/50 bg-[#e8f8f3] text-[#1f6f5f] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]',
      iconClassName: 'text-[#189072]'
    }
  }
  if (source === 'template' || source === 'template-direct-edit' || session.model === 'template-direct-edit') {
    return {
      label: labels.template,
      Icon: LayoutTemplate,
      className:
        'border-[#e48aa5]/50 bg-[#fff0f5] text-[#8b3352] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]',
      iconClassName: 'text-[#c94672]'
    }
  }
  if (source === 'session-file-import' || session.model === 'session-file-import') {
    return {
      label: labels.sessionFile,
      Icon: FileArchive,
      className:
        'border-[#a798ee]/55 bg-[#f3f0ff] text-[#5642a2] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]',
      iconClassName: 'text-[#765ee0]'
    }
  }
  if (source === 'pptx-import' || session.provider === 'import' || session.model === 'pptx-import') {
    return {
      label: labels.pptx,
      Icon: FileUp,
      className:
        'border-[#74b6e5]/55 bg-[#eef8ff] text-[#286a9a] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]',
      iconClassName: 'text-[#2582c3]'
    }
  }
  if (source === 'thinking') {
    return {
      label: labels.thinking,
      Icon: MessagesSquare,
      className:
        'border-[#82c86a]/55 bg-[#effbe9] text-[#38702c] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]',
      iconClassName: 'text-[#4a9e39]'
    }
  }
  if (session.referenceDocumentPath || session.reference_document_path) {
    return {
      label: labels.document,
      Icon: FileText,
      className:
        'border-[#d0b157]/55 bg-[#fff8df] text-[#7b5d13] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]',
      iconClassName: 'text-[#ad7d10]'
    }
  }
  return {
    label: labels.ai,
    Icon: Sparkles,
    className:
      'border-[#f0a96b]/55 bg-[#fff3e6] text-[#8a5425] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]',
    iconClassName: 'text-[#d87721]'
  }
}

export function SessionsPage(): React.JSX.Element {
  const navigate = useNavigate()
  const { sessions, fetchSessions, deleteSession, updateSessionTitle } = useSessionStore()
  const { success, error } = useToastStore()
  const t = useT()
  const [renameSession, setRenameSession] = useState<Session | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<Session | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [activeRuns, setActiveRuns] = useState<Record<string, ActiveGenerateRun>>({})
  const [thumbnailPaths, setThumbnailPaths] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void fetchSessions()
  }, [fetchSessions])

  useEffect(() => {
    if (!searchOpen) return
    searchInputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    let mounted = true
    void ipc
      .listActiveGenerateRuns()
      .then((runs) => {
        if (!mounted) return
        setActiveRuns(
          Object.fromEntries(
            runs
              .filter((run): run is ActiveGenerateRun => run.status === 'queued' || run.status === 'running')
              .map((run) => [run.sessionId, run])
          )
        )
      })
      .catch(() => {})

    const unsubscribe = ipc.onGenerateChunk((chunk) => {
      const sessionId = chunk.payload.sessionId
      if (!sessionId) return
      if (chunk.type === 'run_completed' || chunk.type === 'run_error') {
        void fetchSessions()
      }
      setActiveRuns((prev) => {
        if (chunk.type === 'run_completed' || chunk.type === 'run_error') {
          const previous = prev[sessionId]
          if (!previous || previous.runId !== chunk.payload.runId) return prev
          const next = { ...prev }
          delete next[sessionId]
          return next
        }
        const previous = prev[sessionId]
        if (previous?.runId && previous.runId !== chunk.payload.runId) return prev
        const stage = 'stage' in chunk.payload ? chunk.payload.stage : ''
        const completedPageCount =
          'completedPageCount' in chunk.payload &&
          typeof chunk.payload.completedPageCount === 'number'
            ? chunk.payload.completedPageCount
            : previous?.completedPageCount || 0
        const failedPageCount =
          'failedPageCount' in chunk.payload && typeof chunk.payload.failedPageCount === 'number'
            ? chunk.payload.failedPageCount
            : previous?.failedPageCount || 0
        return {
          ...prev,
          [sessionId]: {
            sessionId,
            runId: chunk.payload.runId,
            status: stage === 'queued' ? 'queued' : 'running',
            hasActiveRun: true,
            progress:
              'progress' in chunk.payload && typeof chunk.payload.progress === 'number'
                ? Math.max(0, Math.min(90, Math.floor(chunk.payload.progress)))
                : previous?.progress || 0,
            totalPages:
              'totalPages' in chunk.payload && typeof chunk.payload.totalPages === 'number'
                ? Math.max(1, Math.floor(chunk.payload.totalPages))
                : previous?.totalPages || 1,
            events: previous?.events || [],
            error: null,
            startedAt: previous?.startedAt || Date.now(),
            updatedAt: Date.now(),
            kind: previous?.kind,
            completedPageCount,
            failedPageCount
          }
        }
      })
    })

    return () => {
      mounted = false
      unsubscribe?.()
    }
  }, [fetchSessions])

  const sortedSessions = sessions
  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase()
    if (!query) return sortedSessions
    return sortedSessions.filter((session) => session.title.toLocaleLowerCase().includes(query))
  }, [searchQuery, sortedSessions])
  const applyThumbnail = useCallback((task: HtmlThumbnailTask): void => {
    if (task.variant !== 'first-page' || !task.thumbnailPath) return
    setThumbnailPaths((current) => ({ ...current, [task.resourceId]: task.thumbnailPath! }))
  }, [])

  useThumbnailUpdates('session', applyThumbnail)
  const canEnterEditor = (session: {
    id: string
    status: string
    metadata: string | null
    page_count: number | null
  }): boolean => getEditorGate(session, 0.68).canEdit

  const getSessionRoute = (session: { id: string; status: string; metadata: string | null; page_count: number | null }): string => {
    const activeRun = activeRuns[session.id]
    const metadata = parseSessionMetadata(session.metadata)
    if (activeRun) {
      return activeRun.kind === 'template' || metadata.source === 'template'
        ? `/sessions/${session.id}/template-generating`
        : `/sessions/${session.id}/generating`
    }
    if (canEnterEditor(session)) return `/sessions/${session.id}`
    return metadata.source === 'template'
      ? `/sessions/${session.id}/template-generating`
      : `/sessions/${session.id}/generating`
  }

  const openRenameDialog = (session: Session): void => {
    setRenameSession(session)
    setRenameTitle(session.title)
  }

  const closeRenameDialog = (): void => {
    if (renaming) return
    setRenameSession(null)
    setRenameTitle('')
  }

  const handleRenameSubmit = async (): Promise<void> => {
    if (!renameSession) return
    const title = renameTitle.trim()
    if (!title) {
      error(t('sessions.titleEmpty'))
      return
    }
    if (title.length > 120) {
      error(t('sessions.titleTooLong'), { description: t('sessions.titleTooLongDescription') })
      return
    }
    setRenaming(true)
    try {
      await updateSessionTitle({ sessionId: renameSession.id, title })
      success(t('sessions.titleUpdated'))
      setRenameSession(null)
      setRenameTitle('')
    } catch (err) {
      error(t('sessions.renameFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setRenaming(false)
    }
  }

  const closeDeleteDialog = (): void => {
    if (deleting) return
    setDeleteSessionTarget(null)
  }

  const handleDeleteSession = async (): Promise<void> => {
    if (!deleteSessionTarget) return
    setDeleting(true)
    try {
      await deleteSession(deleteSessionTarget.id)
      success(t('sessions.deleted'))
      setDeleteSessionTarget(null)
    } catch (err) {
      error(t('sessions.deleteFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl p-6">
      <div className="mb-6">
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[30px] font-semibold leading-none text-[#333333]">我的演示</h1>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
            {sessions.length > 0 ? (
              searchOpen || searchQuery ? (
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#829071]" />
                  <Input
                    ref={searchInputRef}
                    type="search"
                    value={searchQuery}
                    placeholder={t('sessions.searchPlaceholder')}
                    className="h-9 bg-[#fffaf1] pl-9 pr-10"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    onBlur={() => {
                      if (!searchQuery.trim()) setSearchOpen(false)
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={t('sessions.clearSearch')}
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0 text-[#829071] hover:text-[#3e4a32]"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSearchQuery('')
                      setSearchOpen(false)
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <TooltipProvider delayDuration={180}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={t('sessions.searchButton')}
                        onClick={() => setSearchOpen(true)}
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="end">
                      {t('sessions.searchButton')}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )
            ) : null}
            <Button size="sm" className="min-w-[124px] bg-[#e21b22] text-white hover:bg-[#ba1218]" onClick={() => navigate('/')}>
              <FolderOpen className="mr-2 h-4 w-4" />
              新建公司演示
            </Button>
          </div>
        </div>
      </div>

      {sessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <FolderOpen className="mb-4 h-12 w-12 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-medium">{t('sessions.emptyTitle')}</h3>
            <p className="mb-4 text-muted-foreground">{t('sessions.emptyDescription')}</p>
          </CardContent>
        </Card>
      ) : filteredSessions.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="mb-4 h-10 w-10 text-muted-foreground" />
            <h3 className="mb-2 text-lg font-medium">{t('sessions.noSearchResultsTitle')}</h3>
            <p className="text-muted-foreground">{t('sessions.noSearchResultsDescription')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filteredSessions.map((session) => {
            const editorGate = getEditorGate(session)
            const activeRun = activeRuns[session.id]
            const displayGeneratedCount = activeRun
              ? Math.max(editorGate.generatedCount, activeRun.completedPageCount || 0)
              : editorGate.generatedCount
            const displayFailedCount = activeRun
              ? activeRun.failedPageCount || 0
              : editorGate.failedCount
            const displayTotalCount = activeRun
              ? Math.max(editorGate.totalCount, activeRun.totalPages, displayGeneratedCount + displayFailedCount)
              : editorGate.totalCount
            const hasCompletedPages = editorGate.generatedCount > 0
            const isFullyComplete = canEnterEditor(session) && editorGate.generatedCount >= editorGate.totalCount && editorGate.failedCount === 0
            const isPartialComplete = !isFullyComplete && canEnterEditor(session)
            const isContinuable = !isFullyComplete && !isPartialComplete && hasCompletedPages
            const statusText = activeRun
              ? activeRun.status === 'queued'
                ? t('sessions.statusQueued')
                : activeRun.progress > 0
                  ? t('sessions.statusGeneratingProgress', { progress: activeRun.progress })
                  : t('sessions.statusGenerating')
              : isFullyComplete
              ? t('sessions.statusComplete')
              : isPartialComplete
                ? t('sessions.statusPartialComplete')
                : isContinuable
                  ? t('sessions.statusContinuable')
                  : t('sessions.statusRegenerate')
            const actionText = activeRun
              ? t('sessions.actionViewProgress')
              : isFullyComplete || isPartialComplete
              ? t('sessions.actionEnter')
              : isContinuable
                ? t('sessions.actionContinue')
                : t('sessions.actionRegenerate')
            const sourceTag = getSourceTag(session, {
              pptx: t('sessions.sourcePptx'),
              sessionFile: t('sessions.sourceSessionFile'),
              saveAsNew: t('sessions.sourceSaveAsNew'),
              document: t('sessions.sourceDocument'),
              ai: t('sessions.sourceAi'),
              thinking: t('sessions.sourceThinking'),
              template: t('sessions.sourceTemplate')
            })
            const SourceIcon = sourceTag.Icon
            const thumbnailPath = thumbnailPaths[session.id] || session.thumbnailPath || ''
            const slideSize = resolveSessionSlideSize(session)
            const sourceTagBaseClass =
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold leading-none'
            const statusClassName = activeRun
              ? 'border-[#9fc7df]/80 bg-[#edf8ff] text-[#286a9a] shadow-[0_0_0_1px_rgba(116,182,229,0.14)]'
              : isFullyComplete
              ? 'border-[#bad8b7]/80 bg-[#eef9ec] text-[#4a7a46]'
              : isPartialComplete
                ? 'border-[#b5c9a8]/80 bg-[#eef5e8] text-[#4f7b3f]'
                : isContinuable
                  ? 'border-[#d6c08d]/80 bg-[#fff3cf] text-[#7a5a19] shadow-[0_0_0_1px_rgba(214,192,141,0.14)]'
                  : 'border-[#d7b5ae]/70 bg-[#fbf1ee] text-[#93564f]'
            return (
              <Card
                key={session.id}
                data-session-card-id={session.id}
                className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-[#e2d9cd] bg-white shadow-[0_4px_16px_rgba(76,76,76,0.06)] transition-all hover:-translate-y-0.5 hover:shadow-[0_10px_26px_rgba(76,76,76,0.11)]"
                title={isPartialComplete ? t('sessions.statusPartialCompleteTip') : undefined}
                onClick={() => navigate(getSessionRoute(session))}
              >
                <div
                  className="relative flex h-[230px] w-full shrink-0 items-center justify-center overflow-hidden bg-[#faf8f3]"
                  data-session-thumbnail-frame
                >
                  {thumbnailPath ? (
                    <img
                      src={localAssetUrl(thumbnailPath)}
                      loading="lazy"
                      alt=""
                      aria-hidden="true"
                      className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-[1.015]"
                      style={{ aspectRatio: `${slideSize.width}/${slideSize.height}` }}
                    />
                  ) : (
                    <img
                      src={sessionPlaceholder}
                      alt=""
                      aria-hidden="true"
                      className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-[1.015]"
                      style={{ aspectRatio: `${slideSize.width}/${slideSize.height}` }}
                    />
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/45 via-black/10 to-transparent" />
                  <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-lg bg-white/94 px-2.5 py-1 text-xs font-semibold text-[#4c4c4c] shadow-[0_4px_12px_rgba(31,31,31,0.14)] backdrop-blur-sm">
                    <MessageSquare className="h-3 w-3" />
                    {actionText}
                  </span>
                </div>

                <div className="min-w-0 flex-1 p-4">
                  <CardTitle className="line-clamp-2 min-h-10 text-base leading-5 text-[#333333]">
                    {session.title}
                  </CardTitle>
                  <p className="mt-1.5 text-xs text-[#847866]">
                    {dayjs.unix(session.updated_at).format('YYYY/MM/DD HH:mm')}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    <span
                      className={`rounded-lg border px-2 py-1 font-semibold ${statusClassName}`}
                    >
                      {statusText}
                    </span>
                    <span className={`${sourceTagBaseClass} ${sourceTag.className}`}>
                      <SourceIcon className={`h-3.5 w-3.5 ${sourceTag.iconClassName}`} />
                      {sourceTag.label}
                    </span>
                    <span className="rounded-lg border border-[#e1d1b7]/80 bg-[#fff7e8]/75 px-2 py-1 text-[#7c6a4c]">
                      {t('sessions.pagesCount', {
                        generated: displayGeneratedCount,
                        total: displayTotalCount
                      })}
                    </span>
                    {session.generation_duration_sec ? (
                      <span className="rounded-lg border border-[#d5cfc5]/60 bg-[#f9f6f1] px-2 py-1 text-[#6b6560]">
                        {(() => {
                          const d = dayjs.duration(session.generation_duration_sec!, 'second')
                          const m = Math.floor(d.asMinutes())
                          const s = d.seconds()
                          return m > 0 ? `${m}m ${s}s` : `${s}s`
                        })()}
                      </span>
                    ) : null}
                    {!isFullyComplete && displayFailedCount > 0 && (
                      <span className="rounded-lg border border-[#d7b5ae]/70 bg-[#fff7f2]/80 px-2 py-1 text-[#93564f]">
                        {t('sessions.failedCount', { count: displayFailedCount })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-1 border-t border-[#eee7dd] bg-[#fbfaf7] px-3 py-2">
                  <TooltipProvider delayDuration={180}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={t('sessions.editTitleTooltip')}
                          onClick={(e) => {
                            e.stopPropagation()
                            openRenameDialog(session)
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" align="end">
                        {t('sessions.editTitleTooltip')}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('common.delete')}
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeleteSessionTarget(session)
                    }}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}
      {renameSession ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#1f261d]/35 p-4 backdrop-blur-sm"
          onClick={closeRenameDialog}
        >
          <div
            className="w-full max-w-md rounded-xl border border-[#d8cfbc]/80 bg-[#fffaf0] p-5 shadow-[0_24px_60px_rgba(64,52,38,0.28)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-[#3e4a32]">{t('sessions.editTitle')}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('sessions.renameDescription')}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={closeRenameDialog} disabled={renaming}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void handleRenameSubmit()
              }}
            >
              <Input
                autoFocus
                value={renameTitle}
                maxLength={120}
                placeholder={t('sessions.renamePlaceholder')}
                onChange={(event) => setRenameTitle(event.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={closeRenameDialog} disabled={renaming}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" size="sm" disabled={renaming}>
                  {renaming ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      <Dialog open={Boolean(deleteSessionTarget)} onOpenChange={(open) => !open && closeDeleteDialog()}>
        <DialogContent showClose={false}>
          <DialogHeader>
            <DialogTitle>{t('sessions.deleteConfirmTitle')}</DialogTitle>
            <DialogDescription>
              {t('sessions.deleteConfirmDescription', { title: deleteSessionTarget?.title || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={closeDeleteDialog} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={() => void handleDeleteSession()} disabled={deleting}>
              {deleting ? t('common.saving') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
