import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useParams } from 'react-router-dom'
import { Copy, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import { useT } from '@renderer/i18n'
import {
  HtmlEditorCanvas,
  type HtmlEditorCanvasHandle
} from '../components/html-editor/HtmlEditorCanvas'
import { HtmlEditorInsertRibbon } from '../components/html-editor/HtmlEditorInsertRibbon'
import { HtmlEditorHistoryDialog } from '../components/html-editor/HtmlEditorHistoryDialog'
import {
  HtmlEditorToolbar,
  type HtmlEditorMode
} from '../components/html-editor/HtmlEditorToolbar'
import { HtmlEditorAiPanel } from '../components/html-editor/HtmlEditorAiPanel'
import { HtmlEditorInspectorPanel } from '../components/html-editor/HtmlEditorInspectorPanel'
import { TooltipProvider } from '../components/ui/Tooltip'
import { useHtmlElementInsertion } from '../components/html-editor/useHtmlElementInsertion'
import { useHtmlEditorStore } from '../store/htmlEditorStore'
import { useHtmlEditStore } from '../store/htmlEditStore'
import { useHtmlEditHistoryStore } from '../store/htmlEditHistoryStore'
import { useHtmlEditorUiStore } from '../store/htmlEditorUiStore'
import { useHtmlEditorAiStore } from '../store/htmlEditorAiStore'

/**
 * 独立 HTML 编辑器页面（/edit-html）。与 session-edit 完全解耦：
 * 内存编辑（零 DB / 零 git），工作文件落 <storage>/html-editor/。
 * 组合自有 HtmlEditorCanvas（document 模式）+ HtmlEditorGuidesOverlay + HTML 专用检视面板。
 */
export function EditHtmlPage(): ReactElement {
  const t = useT()
  const { id } = useParams<{ id: string }>()

  const docId = useHtmlEditorStore((s) => s.docId)
  const title = useHtmlEditorStore((s) => s.title)
  const htmlPath = useHtmlEditorStore((s) => s.htmlPath)
  const designWidth = useHtmlEditorStore((s) => s.designWidth)
  const importing = useHtmlEditorStore((s) => s.importing)
  const loadError = useHtmlEditorStore((s) => s.error)

  const selection = useHtmlEditStore((s) => s.selection)
  const draft = useHtmlEditStore((s) => s.draft)
  const aiModeEnabled = useHtmlEditorAiStore((s) => s.enabled)
  const reloadSignal = useHtmlEditorUiStore((s) => s.previewKey)

  const canvasRef = useRef<HtmlEditorCanvasHandle>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [mode, setMode] = useState<HtmlEditorMode>('preview')
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | undefined>()

  const isEditing = mode === 'edit'
  const isAiInspecting = isEditing && aiModeEnabled

  // 挂载：注入 htmlEditStore 上下文
  useEffect(() => {
    useHtmlEditStore.getState().attach({
      t: t as unknown as (key: string, params?: Record<string, unknown>) => string,
      requestRefresh: () => useHtmlEditorUiStore.getState().bumpPreviewKey(),
      bumpThumbnail: () => {
        /* 内存编辑无需缩略图 */
      },
      getPageContext: () => {
        const s = useHtmlEditorStore.getState()
        if (!s.docId || !s.htmlPath) return null
        return { pageId: s.docId, htmlPath: s.htmlPath, sessionId: 'html-editor' }
      }
    })
    return () => {
      useHtmlEditStore.getState().reset()
      useHtmlEditHistoryStore.getState().clear()
      useHtmlEditorAiStore.getState().reset()
      useHtmlEditorUiStore.getState().clearSelectedElement()
    }
  }, [t])

  useEffect(() => {
    useHtmlEditorAiStore.getState().reset()
    setActivePreviewUrl(undefined)
  }, [docId])

  // 按 :id 打开文档（列表页/导入跳转过来时加载）
  useEffect(() => {
    if (!id) return
    if (useHtmlEditorStore.getState().docId === id) return
    void useHtmlEditorStore.getState().openDocument(id)
  }, [id])

  const setCanvasHandle = useCallback((handle: HtmlEditorCanvasHandle | null): void => {
    canvasRef.current = handle
    useHtmlEditStore.getState().setIframeHandle(handle)
  }, [])

  const insertion = useHtmlElementInsertion({ designWidth: designWidth || 1280, t })

  const handleRestored = useCallback((html: string): void => {
    useHtmlEditorStore.getState().setHtml(html)
    useHtmlEditStore.getState().reset()
    useHtmlEditHistoryStore.getState().clear()
    useHtmlEditorUiStore.getState().bumpPreviewKey()
  }, [])

  const handleModeChange = useCallback(
    (nextMode: HtmlEditorMode): void => {
      if (nextMode === mode) return
      if (nextMode === 'preview') {
        useHtmlEditorAiStore.getState().setEnabled(false)
        useHtmlEditorUiStore.getState().clearSelectedElement()
        useHtmlEditStore.getState().cancelEdit()
      }
      setMode(nextMode)
    },
    [mode]
  )

  const handleActiveUrlChange = useCallback((url: string): void => {
    setActivePreviewUrl((current) => (current === url ? current : url))
  }, [])

  // 键盘：撤销/重做/保存/删除/退出
  useEffect(() => {
    if (!isEditing) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      const editable =
        target instanceof Element &&
        Boolean(
          target.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]')
        )
      if ((event.metaKey || event.ctrlKey) && !editable) {
        const key = event.key.toLowerCase()
        if (key === 'z') {
          event.preventDefault()
          if (event.shiftKey) useHtmlEditStore.getState().redo()
          else useHtmlEditStore.getState().undo()
          return
        }
        if (key === 'y') {
          event.preventDefault()
          useHtmlEditStore.getState().redo()
          return
        }
        if (key === 's') {
          event.preventDefault()
          void useHtmlEditStore.getState().save()
          return
        }
      }
      if (event.key === 'Escape') {
        if (useHtmlEditorAiStore.getState().enabled) {
          useHtmlEditorAiStore.getState().setEnabled(false)
          useHtmlEditorUiStore.getState().clearSelectedElement()
        } else {
          useHtmlEditStore.getState().cancelEdit()
        }
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !editable && selection) {
        event.preventDefault()
        useHtmlEditStore.getState().deleteSelected()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isEditing, selection])

  // 加载中（openDocument 进行时）
  if (!docId && loadError) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-[#f5f1e8] text-sm text-[#8a8676]">
        <p className="max-w-md text-center text-[#8e5a53]">{loadError}</p>
        <button
          type="button"
          onClick={() => void useHtmlEditorStore.getState().openDocument(id || '')}
          disabled={importing || !id}
          className="inline-flex items-center gap-1.5 rounded-md border border-[#c9c0ad] px-3 py-1.5 text-[#3e4a32] hover:bg-[#ece5d6] disabled:opacity-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          {t('htmlEditor.retry')}
        </button>
      </div>
    )
  }

  if (!docId) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-3 bg-[#f5f1e8] text-sm text-[#8a8676]">
        <Loader2 className="h-5 w-5 animate-spin text-[#657050]" aria-hidden="true" />
        <span>{t('common.loading')}</span>
      </div>
    )
  }

  return (
    <TooltipProvider delayDuration={180}>
      <div className="flex h-screen w-screen flex-col bg-[#efe9dc]">
        {/* 顶部工具条 */}
        <HtmlEditorToolbar
          onOpenHistory={() => setHistoryOpen(true)}
          mode={mode}
          onModeChange={handleModeChange}
        />

        <div className="flex min-h-0 flex-1">
          {/* 左侧插入条（hover 画廊） */}
          {isEditing && (
            <HtmlEditorInsertRibbon insertion={insertion} disabled={!docId || aiModeEnabled} />
          )}

          {/* 画布 */}
          <main className="relative min-w-0 flex-1">
            <div
              className={`absolute inset-0 overflow-hidden ${
                isAiInspecting ? 'rounded-xl bg-[#e8e1d4] p-3' : 'bg-[#f5f1e8]'
              }`}
            >
              <HtmlEditorCanvas
                ref={setCanvasHandle}
                key={`hedit-${docId}-${reloadSignal}`}
                htmlPath={htmlPath ?? undefined}
                pageId={docId ?? undefined}
                title={title || 'html-editor'}
                designWidth={designWidth || 1280}
                reloadSignal={reloadSignal}
                inspectable
                playback={!isEditing}
                activeUrl={activePreviewUrl}
                onActiveUrlChange={handleActiveUrlChange}
                inspecting={isAiInspecting}
                interactionMode={isAiInspecting ? 'ai-inspect' : isEditing ? 'edit' : 'preview'}
                editMode={isEditing && !isAiInspecting}
                onSelectorSelected={(selector, label, elementTag, elementText) =>
                  useHtmlEditorUiStore
                    .getState()
                    .setSelectedElement(selector, label, elementTag, elementText)
                }
                onElementMoved={(payload) => useHtmlEditStore.getState().handleMoved(payload)}
                onElementSelected={(payload) => useHtmlEditStore.getState().selectElement(payload)}
                onInspectExit={() => {
                  if (useHtmlEditorAiStore.getState().enabled) {
                    useHtmlEditorAiStore.getState().setEnabled(false)
                    useHtmlEditorUiStore.getState().clearSelectedElement()
                  } else {
                    useHtmlEditStore.getState().cancelEdit()
                  }
                }}
                onDidReload={() => useHtmlEditStore.getState().replayPending()}
                onDeleteRequest={(selector) =>
                  useHtmlEditStore.getState().deleteBySelector(selector)
                }
              />
            </div>
          </main>

          {/* 右侧检视面板（仅选中元素时显示） */}
          {isAiInspecting ? (
            <HtmlEditorAiPanel />
          ) : isEditing && selection ? (
            <aside className="flex w-72 shrink-0 flex-col border-l border-[#e2dccf] bg-[#f5f1e8]">
              <div className="flex shrink-0 items-center gap-1 border-b border-[#e2dccf] px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => void insertion.copyElement()}
                  title={t('sessionDetail.copyElement')}
                  className="rounded-md p-1.5 text-[#5d6b4d] hover:bg-[#ece5d6]"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => useHtmlEditStore.getState().deleteSelected()}
                  title={t('htmlEditor.delete')}
                  className="rounded-md p-1.5 text-[#8e5a53] hover:bg-[#f3e6e2]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <HtmlEditorInspectorPanel
                  selection={selection}
                  draft={draft}
                  onDraftChange={(d, options) =>
                    useHtmlEditStore.getState().updateDraft(d, options)
                  }
                  onClose={() => useHtmlEditStore.getState().cancelEdit()}
                />
              </div>
            </aside>
          ) : null}
        </div>
      </div>
      <HtmlEditorHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        docId={docId ?? ''}
        onRestored={handleRestored}
      />
    </TooltipProvider>
  )
}
