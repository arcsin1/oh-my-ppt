import { useCallback, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Download,
  Eye,
  ExternalLink,
  FileSearch,
  History,
  Home,
  Pencil,
  Redo2,
  RotateCcw,
  Save,
  Undo2
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { useT } from '../../i18n'
import { ipc } from '../../lib/ipc'
import { useHtmlEditorStore } from '../../store/htmlEditorStore'
import { useHtmlEditStore } from '../../store/htmlEditStore'
import { useHtmlEditHistoryStore } from '../../store/htmlEditHistoryStore'
import { useHtmlEditorAiStore } from '../../store/htmlEditorAiStore'
import { useHtmlEditorUiStore } from '../../store/htmlEditorUiStore'
import { useToastStore } from '../../store/toastStore'
import { WindowControls } from '../layout/WindowControls'

const iconBtnClass =
  'app-no-drag rounded-md p-1.5 text-[#5d6b4d] transition-colors hover:bg-[#ece5d6] disabled:pointer-events-none disabled:opacity-40'

export type HtmlEditorMode = 'preview' | 'edit'

/** HTML 编辑器顶部工具条（全图标，tooltip 标注）。 */
export function HtmlEditorToolbar({
  onOpenHistory,
  mode = 'preview',
  onModeChange
}: {
  onOpenHistory: () => void
  mode?: HtmlEditorMode
  onModeChange?: (mode: HtmlEditorMode) => void
}): ReactElement {
  const t = useT()
  const navigate = useNavigate()
  const isMac = ipc.getPlatform() === 'darwin'

  const docId = useHtmlEditorStore((s) => s.docId)
  const title = useHtmlEditorStore((s) => s.title)
  const sourcePath = useHtmlEditorStore((s) => s.sourcePath)
  const exporting = useHtmlEditorStore((s) => s.exporting)
  const isSavingEdits = useHtmlEditStore((s) => s.isSavingEdits)
  const canUndo = useHtmlEditHistoryStore((s) => (docId ? s.canUndo(docId) : false))
  const canRedo = useHtmlEditHistoryStore((s) => (docId ? s.canRedo(docId) : false))
  const hasPending = useHtmlEditHistoryStore((s) => (docId ? s.hasPendingEdits(docId) : false))
  const aiModeEnabled = useHtmlEditorAiStore((s) => s.enabled)

  const displayName =
    title || (sourcePath ? sourcePath.split(/[\\/]/).pop() : '') || t('htmlEditor.untitled')

  const handleSave = useCallback(async (): Promise<void> => {
    await useHtmlEditStore.getState().save()
  }, [])

  const handleExport = useCallback(async (): Promise<void> => {
    const saved = await useHtmlEditStore.getState().save()
    if (saved.error) return
    const path = await useHtmlEditorStore.getState().exportAs()
    if (path) useToastStore.getState().success(t('htmlEditor.exported'))
  }, [t])

  const handlePreview = useCallback(async (): Promise<void> => {
    const saved = await useHtmlEditStore.getState().save()
    if (saved.error || !docId) return
    await ipc.openHtmlInBrowser({ docId })
  }, [docId])

  const handleRevealFile = useCallback(async (): Promise<void> => {
    if (!docId) return
    const result = await ipc.revealHtmlFile({ docId })
    if (!result.ok) useToastStore.getState().error(t('htmlEditor.revealFileFailed'))
  }, [docId, t])

  const handleUndo = useCallback((): void => {
    useHtmlEditStore.getState().undo()
  }, [])
  const handleRedo = useCallback((): void => {
    useHtmlEditStore.getState().redo()
  }, [])
  const handleDiscardAll = useCallback((): void => {
    useHtmlEditStore.getState().discardAll()
  }, [])

  const handleToggleAiMode = useCallback(async (): Promise<void> => {
    if (isSavingEdits) return
    if (mode !== 'edit') onModeChange?.('edit')
    const nextEnabled = !useHtmlEditorAiStore.getState().enabled
    if (nextEnabled && docId) {
      const editStore = useHtmlEditStore.getState()
      editStore.commitCurrentDraft()
      if (useHtmlEditHistoryStore.getState().hasPendingEdits(docId)) {
        const saved = await editStore.save()
        if (!saved.saved) return
      }
    }
    useHtmlEditorAiStore.getState().setEnabled(nextEnabled)
    useHtmlEditorUiStore.getState().clearSelectedElement()
  }, [docId, isSavingEdits, mode, onModeChange])

  const tipBtn = (
    Icon: typeof Home,
    label: string,
    onClick: () => void,
    disabled?: boolean,
    danger?: boolean
  ) => (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={`${iconBtnClass} ${danger ? 'text-[#8e5a53] hover:bg-[#f3e6e2]' : ''}`}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )

  return (
    <header className="app-drag-region app-titlebar relative flex shrink-0 bg-[#f5f1e8]/95 shadow-[0_10px_26px_rgba(93,107,77,0.055)] backdrop-blur-xl">
      <div
        className={`relative flex h-full min-w-0 flex-1 items-center gap-1.5 ${
          isMac ? 'pl-[85px]' : 'pl-4'
        }`}
      >
        {/* 返回 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => navigate('/edit-html')}
              className="app-no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[#e8e0d0]/72 text-[#3e4a32] shadow-[0_4px_10px_rgba(86,72,53,0.08)] transition-colors hover:bg-[#d4e4c1]/78"
            >
              <Home className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('htmlEditor.backToList')}</TooltipContent>
        </Tooltip>

        {/* 标题 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex w-[150px] shrink-0 items-center gap-2 rounded-[10px] bg-[#e8e0d0]/60 px-3 py-1">
              <div className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#3e4a32]">
                {displayName}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="start">
            {displayName}
          </TooltipContent>
        </Tooltip>

        <span className="mx-0.5 h-4 w-px bg-[#e2dccf]" />

        {/* 撤销 / 重做 / 撤销所有 / 保存（一组） */}
        {tipBtn(Undo2, t('htmlEditor.undo'), handleUndo, !canUndo)}
        {tipBtn(Redo2, t('htmlEditor.redo'), handleRedo, !canRedo)}
        {tipBtn(RotateCcw, t('htmlEditor.discardAll'), handleDiscardAll, !hasPending, true)}
        {tipBtn(Save, t('htmlEditor.save'), () => void handleSave(), !hasPending || isSavingEdits)}

        <span className="mx-0.5 h-4 w-px bg-[#e2dccf]" />

        <div
          className="app-no-drag flex items-center gap-0.5 rounded-md bg-[#e8e0d0]/72 p-0.5"
          aria-label={t('htmlEditor.edit')}
          role="group"
        >
          <button
            type="button"
            onClick={() => onModeChange?.('preview')}
            aria-label={t('common.preview')}
            aria-pressed={mode === 'preview'}
            className={`inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11px] font-medium transition-colors ${
              mode === 'preview'
                ? 'bg-[#5d6b4d] text-white shadow-[0_1px_3px_rgba(62,74,50,0.2)]'
                : 'text-[#5d6b4d] hover:bg-[#f5f1e8]'
            }`}
          >
            <Eye className="h-3 w-3" />
            {t('common.preview')}
          </button>
          <button
            type="button"
            onClick={() => onModeChange?.('edit')}
            aria-label={t('common.edit')}
            aria-pressed={mode === 'edit'}
            className={`inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11px] font-medium transition-colors ${
              mode === 'edit'
                ? 'bg-[#5d6b4d] text-white shadow-[0_1px_3px_rgba(62,74,50,0.2)]'
                : 'text-[#5d6b4d] hover:bg-[#f5f1e8]'
            }`}
          >
            <Pencil className="h-3 w-3" />
            {t('common.edit')}
          </button>
        </div>

        <span className="mx-0.5 h-4 w-px bg-[#e2dccf]" />

        {/* 导出 / 查看文件 / 预览 / 版本历史（一组） */}
        {tipBtn(
          Download,
          t('htmlEditor.export'),
          () => void handleExport(),
          exporting || isSavingEdits
        )}
        {tipBtn(
          FileSearch,
          t('htmlEditor.revealFile'),
          () => void handleRevealFile(),
          !docId || isSavingEdits
        )}
        {tipBtn(
          ExternalLink,
          t('htmlEditor.preview'),
          () => void handlePreview(),
          !docId || isSavingEdits
        )}
        {tipBtn(History, t('htmlEditor.history'), onOpenHistory, !docId)}
        <button
          type="button"
          onClick={() => void handleToggleAiMode()}
          disabled={!docId || isSavingEdits}
          className={`app-no-drag ml-1 rounded-md px-2 py-1 text-[12px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 ${
            aiModeEnabled ? 'bg-[#dbe7ca] text-[#2f3b28]' : 'text-[#5d6b4d] hover:bg-[#ece5d6]'
          }`}
          title={t('htmlEditor.aiModeButton')}
        >
          {t('htmlEditor.aiModeButton')}
        </button>
      </div>
      <WindowControls />
    </header>
  )
}
