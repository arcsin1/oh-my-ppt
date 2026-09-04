import { Check, LayoutTemplate, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLang, useT } from '@renderer/i18n'
import { ipc } from '@renderer/lib/ipc'
import {
  useEditSessionStore,
  useGenerateStore,
  useLayoutMasterStore,
  useSessionStore,
  useToastStore
} from '@renderer/store'
import {
  buildDefaultSessionLayoutLibrary,
  getLayoutMasterTemplates,
  type LayoutMasterTemplate,
  type SessionLayoutLibrary
} from '@shared/layout-master'
import { LAYOUT_INTENTS, type LayoutIntent } from '@shared/layout-intent'
import { cn } from '@renderer/lib/utils'
import { Button } from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/Dialog'
import { ScrollArea } from '../ui/ScrollArea'

const intentLabelKeys: Record<
  LayoutIntent,
  | 'sessionDetail.layoutMasterIntentCover'
  | 'sessionDetail.layoutMasterIntentData'
  | 'sessionDetail.layoutMasterIntentComparison'
  | 'sessionDetail.layoutMasterIntentTimeline'
  | 'sessionDetail.layoutMasterIntentConcept'
  | 'sessionDetail.layoutMasterIntentProcess'
  | 'sessionDetail.layoutMasterIntentSummary'
  | 'sessionDetail.layoutMasterIntentQuote'
  | 'sessionDetail.layoutMasterIntentImage'
> = {
  cover: 'sessionDetail.layoutMasterIntentCover',
  'data-focus': 'sessionDetail.layoutMasterIntentData',
  comparison: 'sessionDetail.layoutMasterIntentComparison',
  timeline: 'sessionDetail.layoutMasterIntentTimeline',
  concept: 'sessionDetail.layoutMasterIntentConcept',
  process: 'sessionDetail.layoutMasterIntentProcess',
  summary: 'sessionDetail.layoutMasterIntentSummary',
  quote: 'sessionDetail.layoutMasterIntentQuote',
  'image-focus': 'sessionDetail.layoutMasterIntentImage'
}

function LayoutPreview({ preview }: { preview: LayoutMasterTemplate['preview'] }): React.JSX.Element {
  const title = (
    <span className="absolute left-[11%] top-[13%] h-[8%] w-[36%] rounded-sm bg-[#3e4a32]" />
  )
  const muted = 'bg-[#a8b892]'
  const light = 'bg-[#dfe7d4]'
  const accent = 'bg-[#c77a62]'

  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-sm border border-[#ded5c6] bg-[#f9f5ed] shadow-[0_1px_2px_rgba(78,62,43,0.08)]"
    >
      {title}
      {preview === 'title-center' && (
        <>
          <span className="absolute left-[30%] top-[37%] h-[13%] w-[40%] rounded-sm bg-[#42533a]" />
          <span className={`absolute left-[38%] top-[57%] h-[4%] w-[24%] rounded-sm ${muted}`} />
          <span className={`absolute left-[46%] top-[72%] h-[7%] w-[8%] rounded-full ${accent}`} />
        </>
      )}
      {preview === 'title-split' && (
        <>
          <span className={`absolute right-0 top-0 h-full w-[43%] ${accent}`} />
          <span className={`absolute left-[11%] top-[39%] h-[12%] w-[34%] rounded-sm ${muted}`} />
          <span className={`absolute left-[11%] top-[58%] h-[4%] w-[23%] rounded-sm ${light}`} />
        </>
      )}
      {preview === 'editorial' && (
        <>
          <span className={`absolute left-[11%] top-[35%] h-[42%] w-[46%] rounded-sm ${light}`} />
          <span className={`absolute right-[11%] top-[35%] h-[18%] w-[22%] rounded-sm ${muted}`} />
          <span className={`absolute right-[11%] top-[59%] h-[5%] w-[19%] rounded-sm ${accent}`} />
          <span className={`absolute right-[11%] top-[70%] h-[5%] w-[16%] rounded-sm ${light}`} />
        </>
      )}
      {preview === 'two-column' && (
        <>
          <span className={`absolute left-[11%] top-[35%] h-[45%] w-[34%] rounded-sm ${muted}`} />
          <span className={`absolute right-[11%] top-[35%] h-[19%] w-[34%] rounded-sm ${light}`} />
          <span className={`absolute right-[11%] top-[60%] h-[19%] w-[34%] rounded-sm ${accent}`} />
        </>
      )}
      {preview === 'metric-grid' && (
        <>
          <span className={`absolute left-[11%] top-[35%] h-[43%] w-[31%] rounded-sm ${accent}`} />
          <span className={`absolute left-[47%] top-[35%] h-[19%] w-[18%] rounded-sm ${light}`} />
          <span className={`absolute right-[11%] top-[35%] h-[19%] w-[18%] rounded-sm ${muted}`} />
          <span className={`absolute left-[47%] top-[59%] h-[19%] w-[42%] rounded-sm ${light}`} />
        </>
      )}
      {preview === 'chart-side' && (
        <>
          <span className={`absolute left-[11%] top-[35%] h-[45%] w-[53%] rounded-sm ${light}`} />
          <span className={`absolute right-[11%] top-[35%] h-[45%] w-[19%] rounded-sm ${accent}`} />
          <span className="absolute bottom-[21%] left-[18%] h-[3%] w-[8%] rotate-[-22deg] bg-[#5f7650]" />
          <span className="absolute bottom-[31%] left-[31%] h-[3%] w-[13%] rotate-[15deg] bg-[#5f7650]" />
        </>
      )}
      {preview === 'versus' && (
        <>
          <span className={`absolute left-[11%] top-[35%] h-[45%] w-[34%] rounded-sm ${muted}`} />
          <span className={`absolute right-[11%] top-[35%] h-[45%] w-[34%] rounded-sm ${accent}`} />
          <span className="absolute left-[47%] top-[53%] h-[12%] w-[6%] rounded-full bg-[#fffaf0] text-center text-[7px] leading-[24px] text-[#42533a]">
            VS
          </span>
        </>
      )}
      {preview === 'timeline' && (
        <>
          <span className="absolute left-[14%] top-[59%] h-[2px] w-[72%] bg-[#92a47d]" />
          {[17, 36, 55, 74].map((left, index) => (
            <span
              key={left}
              className={cn(
                'absolute top-[53%] h-[12%] w-[7%] rounded-full',
                index === 2 ? accent : muted
              )}
              style={{ left: `${left}%` }}
            />
          ))}
        </>
      )}
      {preview === 'process' && (
        <>
          {[11, 34, 57, 80].map((left, index) => (
            <span
              key={left}
              className={cn(
                'absolute top-[46%] h-[23%] w-[14%] rounded-sm',
                index === 1 ? accent : index === 2 ? muted : light
              )}
              style={{ left: `${left}%` }}
            />
          ))}
        </>
      )}
      {preview === 'quote' && (
        <>
          <span className="absolute left-[13%] top-[36%] text-[33px] font-serif leading-none text-[#c77a62]">
            “
          </span>
          <span className="absolute left-[24%] top-[42%] h-[9%] w-[49%] rounded-sm bg-[#42533a]" />
          <span className={`absolute left-[24%] top-[59%] h-[4%] w-[31%] rounded-sm ${muted}`} />
        </>
      )}
      {preview === 'image-focus' && (
        <>
          <span className={`absolute right-0 top-0 h-full w-[62%] ${muted}`} />
          <span className={`absolute left-[11%] top-[38%] h-[14%] w-[34%] rounded-sm ${accent}`} />
          <span className={`absolute left-[11%] top-[60%] h-[4%] w-[26%] rounded-sm ${light}`} />
        </>
      )}
      {preview === 'closing' && (
        <>
          <span className={`absolute left-[11%] top-[37%] h-[13%] w-[53%] rounded-sm ${accent}`} />
          <span className={`absolute left-[11%] top-[61%] h-[5%] w-[35%] rounded-sm ${muted}`} />
          <span className={`absolute left-[11%] top-[72%] h-[5%] w-[23%] rounded-sm ${light}`} />
        </>
      )}
    </div>
  )
}

export function MasterLayoutLibraryDialog(): React.JSX.Element | null {
  const t = useT()
  const { lang } = useLang()
  const isOpen = useLayoutMasterStore((state) => state.isOpen)
  const setOpen = useLayoutMasterStore((state) => state.setOpen)
  const currentSession = useSessionStore((state) => state.currentSession)
  const sessionId = currentSession?.id || ''
  const isSavingEdits = useEditSessionStore((state) => state.isSavingEdits)
  const mutationBusy = useGenerateStore((state) =>
    Boolean(
      state.isGenerating ||
      state.pageEditJobs[sessionId] ||
      state.deckEditJobs[sessionId] ||
      state.styleSwitchJobs[sessionId]
    )
  )
  const toastError = useToastStore((state) => state.error)
  const toastSuccess = useToastStore((state) => state.success)
  const [library, setLibrary] = useState<SessionLayoutLibrary>(buildDefaultSessionLayoutLibrary())
  const [selectedIntent, setSelectedIntent] = useState<LayoutIntent>('cover')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const requestIdRef = useRef(0)
  const templates = getLayoutMasterTemplates()
  const slideWidth = Math.max(1, currentSession?.slideWidth || 1600)
  const slideHeight = Math.max(1, currentSession?.slideHeight || 900)
  const previewAspectRatio = `${slideWidth} / ${slideHeight}`
  const previewFitStyle =
    slideWidth >= slideHeight
      ? { width: '100%', aspectRatio: previewAspectRatio }
      : { height: '100%', aspectRatio: previewAspectRatio }
  const busy = loading || saving || isSavingEdits || mutationBusy

  useEffect(() => {
    const requestId = ++requestIdRef.current
    if (!isOpen || !sessionId) return
    setLoading(true)
    setError('')
    void ipc
      .getSessionLayoutLibrary({ sessionId })
      .then((status) => {
        if (requestId !== requestIdRef.current) return
        setLibrary(status.library)
      })
      .catch((loadError) => {
        if (requestId !== requestIdRef.current) return
        const message =
          loadError instanceof Error ? loadError.message : t('sessionDetail.layoutMasterLoadFailed')
        setError(message)
        toastError(message)
      })
      .finally(() => {
        if (requestId === requestIdRef.current) setLoading(false)
      })
    return () => {
      if (requestId === requestIdRef.current) requestIdRef.current += 1
    }
  }, [isOpen, sessionId])

  if (!sessionId) return null

  const selectedTemplates = templates.filter((template) => template.intent === selectedIntent)
  const selectedLayoutId = library.mappings[selectedIntent]
  const selectedTemplate = selectedTemplates.find((template) => template.id === selectedLayoutId)
  const templateName = (template: LayoutMasterTemplate): string =>
    lang === 'en' ? template.name : template.nameZh
  const templateDescription = (template: LayoutMasterTemplate): string =>
    lang === 'en' ? template.description : template.descriptionZh

  const chooseTemplate = (template: LayoutMasterTemplate): void => {
    if (busy) return
    setLibrary((current) => ({
      ...current,
      mappings: { ...current.mappings, [selectedIntent]: template.id }
    }))
  }

  const close = (): void => {
    if (saving) return
    setError('')
    setOpen(false)
  }

  const save = async (): Promise<void> => {
    if (busy) return
    setSaving(true)
    setError('')
    try {
      const status = await ipc.saveSessionLayoutLibrary({ sessionId, library })
      setLibrary(status.library)
      toastSuccess(t('sessionDetail.layoutMasterSaved'))
      setOpen(false)
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : t('sessionDetail.layoutMasterSaveFailed')
      setError(message)
      toastError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) close()
      }}
    >
      <DialogContent showClose={!saving} className="!max-w-[960px] gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[#e3dacb] px-6 py-5">
          <DialogTitle>{t('sessionDetail.layoutMasterTitle')}</DialogTitle>
          <DialogDescription>{t('sessionDetail.layoutMasterDescription')}</DialogDescription>
        </DialogHeader>

        <div className="grid h-[min(500px,calc(100vh-14rem))] min-h-[340px] grid-cols-[154px_minmax(0,1fr)]">
          <aside className="border-r border-[#e3dacb] bg-[#f5f0e6] px-2 py-3">
            <div className="space-y-0.5">
              {LAYOUT_INTENTS.map((intent) => (
                <button
                  key={intent}
                  type="button"
                  className={cn(
                    'flex h-8 w-full items-center rounded-md px-3 text-left text-xs transition-colors',
                    selectedIntent === intent
                      ? 'bg-[#d9e4c9] font-semibold text-[#33422a]'
                      : 'text-[#667257] hover:bg-[#ebe4d6] hover:text-[#3f5035]'
                  )}
                  onClick={() => setSelectedIntent(intent)}
                  disabled={busy}
                >
                  {t(intentLabelKeys[intent])}
                </button>
              ))}
            </div>
          </aside>

          <ScrollArea className="h-full" viewportClassName="p-5">
            {loading ? (
              <div className="flex h-full items-center justify-center text-[#667257]">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-sm font-medium text-[#46553a]">
                    {t(intentLabelKeys[selectedIntent])}
                  </p>
                  {selectedTemplate && (
                    <span className="text-xs text-[#748067]">{templateName(selectedTemplate)}</span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {selectedTemplates.map((template) => {
                    const selected = template.id === selectedLayoutId
                    return (
                      <button
                        key={template.id}
                        type="button"
                        className={cn(
                          'group overflow-hidden rounded-md border bg-[#fffdf8] text-left shadow-[0_1px_2px_rgba(78,62,43,0.06)] transition-all',
                          'w-full',
                          selected
                            ? 'border-[#71885b] ring-2 ring-[#a9bd91]/60'
                            : 'border-[#e1d8ca] hover:border-[#aebd9a] hover:shadow-[0_6px_16px_rgba(78,62,43,0.1)]'
                        )}
                        onClick={() => chooseTemplate(template)}
                        disabled={busy}
                      >
                        <div className="flex h-[220px] items-center justify-center overflow-hidden border-b border-[#ded5c6] bg-[#f5f0e6] p-3">
                          <div
                            className="relative max-h-full max-w-full overflow-hidden"
                            style={previewFitStyle}
                          >
                            <LayoutPreview preview={template.preview} />
                          </div>
                        </div>
                        <span className="flex min-h-[62px] items-start gap-2 px-3 py-3">
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-[#3d4c32]">
                              {templateName(template)}
                            </span>
                            <span className="mt-1 block text-xs leading-4 text-[#78816e]">
                              {templateDescription(template)}
                            </span>
                          </span>
                          {selected && (
                            <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#5f7650] text-white">
                              <Check className="h-3.5 w-3.5" />
                            </span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {error && <p className="text-xs leading-4 text-[#a14f4a]">{error}</p>}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter className="border-t border-[#e3dacb] bg-[#fffaf0] px-6 py-4">
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => setLibrary(buildDefaultSessionLayoutLibrary())}
          >
            {t('sessionDetail.layoutMasterReset')}
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
            <LayoutTemplate className="h-3.5 w-3.5" />
            {saving ? t('common.saving') : t('sessionDetail.layoutMasterSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
