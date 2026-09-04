import { useEffect, useRef, useState } from 'react'
import { ChevronDown, LayoutTemplate, Layers3, Loader2, Palette, X } from 'lucide-react'
import { useT } from '@renderer/i18n'
import { ipc, type FontListItem } from '@renderer/lib/ipc'
import {
  useEditSessionStore,
  useGenerateStore,
  useLayoutMasterStore,
  useMasterWorkbenchStore,
  useSessionDetailRuntimeStore,
  useSessionDetailUiStore,
  useSessionStore,
  useToastStore
} from '@renderer/store'
import {
  buildDefaultMasterConfig,
  buildDefaultMasterElementsConfig,
  normalizeMasterConfig,
  type SessionMasterConfig,
  type SessionMasterStatus
} from '@shared/master'
import { Button } from '../../../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../../../ui/Dialog'
import { Checkbox } from '../../../ui/Checkbox'
import { Input } from '../../../ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../ui/Select'
import { MasterGradientEditor } from '../../../gradient-editor/MasterGradientEditor'
import { MasterElementsEditor } from '../../../master-elements/MasterElementsEditor'
import { MasterLayoutLibraryDialog } from '../../../master-layouts/MasterLayoutLibraryDialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '../../../ui/DropdownMenu'

const fontPresetKeys = ['inherit', 'sans', 'serif', 'mono'] as const

const fontPresetLabelKeys = {
  inherit: 'sessionDetail.masterFontInherit',
  sans: 'sessionDetail.masterFontSans',
  serif: 'sessionDetail.masterFontSerif',
  mono: 'sessionDetail.masterFontMono'
} as const

const getRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const getJsonRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    return getRecord(JSON.parse(value))
  } catch {
    return {}
  }
}

const getFontFamily = (value: unknown): string | null => {
  const family = typeof value === 'string' ? value.trim() : ''
  return family || null
}

export function MasterWorkbenchPanel(): React.JSX.Element | null {
  const t = useT()
  const [styleOpen, setStyleOpen] = useState(false)
  const [elementsOpen, setElementsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<SessionMasterStatus | null>(null)
  const [fontOptions, setFontOptions] = useState<FontListItem[]>([])
  const masterLoadRequestRef = useRef(0)
  const config = useMasterWorkbenchStore((state) => state.config)
  const setConfig = useMasterWorkbenchStore((state) => state.setConfig)
  const updateConfig = useMasterWorkbenchStore((state) => state.updateConfig)
  const setLayoutLibraryOpen = useLayoutMasterStore((state) => state.setOpen)
  const isSavingEdits = useEditSessionStore((state) => state.isSavingEdits)
  const isApplyingSyncElement = useEditSessionStore((state) => state.isApplyingSyncElement)
  const currentSession = useSessionStore((state) => state.currentSession)
  const sessionId = currentSession?.id || ''
  const currentSessionIdRef = useRef(sessionId)
  currentSessionIdRef.current = sessionId
  const mutationBusy = useGenerateStore((state) =>
    Boolean(
      state.isGenerating ||
      state.pageEditJobs[sessionId] ||
      state.deckEditJobs[sessionId] ||
      state.styleSwitchJobs[sessionId]
    )
  )
  const currentPages = useSessionStore((state) => state.currentGeneratedPages)
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const bumpThumbnailVersion = useSessionDetailUiStore((state) => state.bumpThumbnailVersion)
  const reloadCurrentPreviewIgnoringCache = useSessionDetailRuntimeStore(
    (state) => state.reloadCurrentPreviewIgnoringCache
  )
  const toastError = useToastStore((state) => state.error)
  const toastSuccess = useToastStore((state) => state.success)
  const busy = saving || isSavingEdits || isApplyingSyncElement || mutationBusy
  const open = styleOpen || elementsOpen

  const refreshPreview = (): void => {
    reloadCurrentPreviewIgnoringCache()
    currentPages.forEach((page) => {
      if (page.pageId) bumpThumbnailVersion(page.pageId)
    })
  }

  const loadMaster = async (requestId: number, requestedSessionId: string): Promise<void> => {
    const isCurrentRequest = (): boolean =>
      masterLoadRequestRef.current === requestId &&
      currentSessionIdRef.current === requestedSessionId
    if (!isCurrentRequest()) return
    setLoading(true)
    setError('')
    setStatus(null)
    try {
      const [next, fonts] = await Promise.all([
        ipc.getSessionMaster({ sessionId: requestedSessionId }),
        ipc.listFonts()
      ])
      if (!isCurrentRequest()) return
      setStatus(next)
      setConfig(normalizeMasterConfig(next.config))
      setFontOptions([...fonts.userFonts, ...fonts.googleFonts])
    } catch (loadError) {
      if (!isCurrentRequest()) return
      const message =
        loadError instanceof Error ? loadError.message : t('sessionDetail.masterLoadFailed')
      setError(message)
      toastError(message)
    } finally {
      if (isCurrentRequest()) setLoading(false)
    }
  }

  useEffect(() => {
    const requestId = ++masterLoadRequestRef.current
    if (!open || !sessionId) return
    void loadMaster(requestId, sessionId)
    return () => {
      if (masterLoadRequestRef.current === requestId) masterLoadRequestRef.current += 1
    }
  }, [open, sessionId])

  if (!sessionId) return null

  const designContract = getJsonRecord(currentSession?.designContract)
  const fontSelection = getRecord(getJsonRecord(currentSession?.metadata).fontSelection)
  const inheritedFonts = {
    title:
      getFontFamily(designContract.titleFont) ||
      getFontFamily(getRecord(fontSelection.title).family),
    body:
      getFontFamily(designContract.bodyFont) || getFontFamily(getRecord(fontSelection.body).family)
  }
  const getInheritLabel = (family: string | null): string =>
    family
      ? t('sessionDetail.masterFontInheritWithFamily', { family })
      : t('sessionDetail.masterFontInherit')
  const resolveFontValue = (
    family: string | null,
    preset: SessionMasterConfig['titleFontPreset']
  ): string => (family ? `font:${family}` : `preset:${preset}`)
  const updateFont = (role: 'title' | 'body', value: string): void => {
    const family = value.startsWith('font:') ? value.slice('font:'.length) : null
    const preset = value.startsWith('preset:')
      ? (value.slice('preset:'.length) as SessionMasterConfig['titleFontPreset'])
      : 'inherit'
    updateConfig(
      role === 'title'
        ? { titleFontFamily: family, titleFontPreset: preset }
        : { bodyFontFamily: family, bodyFontPreset: preset }
    )
  }

  const updateFontSize = (role: 'title' | 'body', value: string): void => {
    const raw = value.trim()
    const size = raw === '' ? null : Number(raw)
    if (size !== null && (!Number.isInteger(size) || size < 1)) return
    updateConfig(role === 'title' ? { titleFontSize: size } : { bodyFontSize: size })
  }

  const saveMaster = async (): Promise<void> => {
    if (busy) return
    setSaving(true)
    setError('')
    try {
      const next = await ipc.saveSessionMaster({ sessionId, config })
      setStatus(next)
      setConfig(normalizeMasterConfig(next.config))
      refreshPreview()
      toastSuccess(t('sessionDetail.masterSaved'))
      setStyleOpen(false)
      setElementsOpen(false)
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : t('sessionDetail.masterSaveFailed')
      setError(message)
      toastError(message)
    } finally {
      setSaving(false)
    }
  }

  const toggleCurrentPageElements = async (disabled: boolean): Promise<void> => {
    if (!selectedPageId || busy) return
    setSaving(true)
    setError('')
    try {
      await ipc.setSessionMasterPageOverride({ sessionId, pageId: selectedPageId, disabled })
      const next = await ipc.getSessionMaster({ sessionId })
      setStatus(next)
      refreshPreview()
    } catch (overrideError) {
      const message =
        overrideError instanceof Error
          ? overrideError.message
          : t('sessionDetail.masterPageOverrideFailed')
      setError(message)
      toastError(message)
    } finally {
      setSaving(false)
    }
  }

  const currentPageElementsDisabled = Boolean(
    selectedPageId && status?.disabledPageIds.includes(selectedPageId)
  )

  const closeElementsDialog = (): void => {
    if (saving) return
    if (status) setConfig(normalizeMasterConfig(status.config))
    setError('')
    setElementsOpen(false)
  }

  const closeStyleDialog = (): void => {
    if (saving) return
    if (status) setConfig(normalizeMasterConfig(status.config))
    setError('')
    setStyleOpen(false)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 min-w-[56px] shrink-0 gap-1 rounded-full border-0 bg-transparent px-2 text-[10px] font-bold text-[#4f5f40] shadow-none hover:bg-[#fffaf1]/54 hover:text-[#314028]"
            disabled={busy}
          >
            <Palette className="h-3 w-3" />
            {t('sessionDetail.master')}
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onSelect={() => setStyleOpen(true)}>
            <Palette className="h-3.5 w-3.5 text-[#637552]" />
            {t('sessionDetail.masterStyle')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setElementsOpen(true)}>
            <Layers3 className="h-3.5 w-3.5 text-[#637552]" />
            {t('sessionDetail.masterGlobalElements')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setLayoutLibraryOpen(true)}>
            <LayoutTemplate className="h-3.5 w-3.5 text-[#637552]" />
            {t('sessionDetail.masterLayoutLibrary')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <MasterLayoutLibraryDialog />

      <Dialog
        open={styleOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeStyleDialog()
          else if (!saving) setStyleOpen(true)
        }}
      >
        <DialogContent showClose={!saving} className="!max-w-[600px] gap-5 p-6">
          <DialogHeader>
            <DialogTitle>{t('sessionDetail.masterStyleTitle')}</DialogTitle>
            <DialogDescription>{t('sessionDetail.masterDescription')}</DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex justify-center py-10 text-[#667257]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <fieldset disabled={busy} className="space-y-5">
              <div className="space-y-3">
                <label className="flex cursor-pointer items-center justify-between gap-4 text-sm text-[#4a563d]">
                  <span>{t('sessionDetail.masterOverrideBackground')}</span>
                  <Checkbox
                    checked={config.backgroundMode === 'override'}
                    onCheckedChange={(checked) =>
                      updateConfig({ backgroundMode: checked === true ? 'override' : 'inherit' })
                    }
                  />
                </label>
                <MasterGradientEditor />
              </div>

              <div className="grid gap-x-8 gap-y-6 border-t border-[#e6ddcf] pt-5 sm:grid-cols-2">
                <div className="space-y-3 text-sm text-[#4a563d]">
                  <span>{t('sessionDetail.masterTitleFont')}</span>
                  <Select
                    value={resolveFontValue(config.titleFontFamily, config.titleFontPreset)}
                    onValueChange={(value) => updateFont('title', value)}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fontPresetKeys.map((preset) => (
                        <SelectItem key={preset} value={`preset:${preset}`}>
                          {preset === 'inherit'
                            ? getInheritLabel(inheritedFonts.title)
                            : t(fontPresetLabelKeys[preset])}
                        </SelectItem>
                      ))}
                      {fontOptions.map((font) => (
                        <SelectItem key={`${font.source}:${font.id}`} value={`font:${font.family}`}>
                          {font.family}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-4 text-sm text-[#667257]">
                    <span>{t('sessionDetail.masterTitleFontSize')}</span>
                    <span className="relative block w-[128px]">
                      <Input
                        type="number"
                        min={12}
                        max={160}
                        value={config.titleFontSize ?? ''}
                        placeholder={t('sessionDetail.masterFontSizeInherit')}
                        aria-label={t('sessionDetail.masterTitleFontSize')}
                        className="h-8 pr-7 text-center text-xs"
                        onChange={(event) => updateFontSize('title', event.target.value)}
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#89917d]">
                        px
                      </span>
                    </span>
                  </label>
                </div>

                <div className="space-y-3 text-sm text-[#4a563d]">
                  <span>{t('sessionDetail.masterBodyFont')}</span>
                  <Select
                    value={resolveFontValue(config.bodyFontFamily, config.bodyFontPreset)}
                    onValueChange={(value) => updateFont('body', value)}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fontPresetKeys.map((preset) => (
                        <SelectItem key={preset} value={`preset:${preset}`}>
                          {preset === 'inherit'
                            ? getInheritLabel(inheritedFonts.body)
                            : t(fontPresetLabelKeys[preset])}
                        </SelectItem>
                      ))}
                      {fontOptions.map((font) => (
                        <SelectItem key={`${font.source}:${font.id}`} value={`font:${font.family}`}>
                          {font.family}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <label className="flex items-center gap-4 text-sm text-[#667257]">
                    <span>{t('sessionDetail.masterBodyFontSize')}</span>
                    <span className="relative block w-[128px]">
                      <Input
                        type="number"
                        min={8}
                        max={96}
                        value={config.bodyFontSize ?? ''}
                        placeholder={t('sessionDetail.masterFontSizeInherit')}
                        aria-label={t('sessionDetail.masterBodyFontSize')}
                        className="h-8 pr-7 text-center text-xs"
                        onChange={(event) => updateFontSize('body', event.target.value)}
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#89917d]">
                        px
                      </span>
                    </span>
                  </label>
                </div>
              </div>

              {status && status.unlinkedPageCount > 0 && (
                <p className="text-xs leading-4 text-[#667257]">
                  {t('sessionDetail.masterUnlinkedHint', { count: status.unlinkedPageCount })}
                </p>
              )}
              {error && <p className="text-xs leading-4 text-[#a14f4a]">{error}</p>}
            </fieldset>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || loading || (status?.missingPageCount || 0) > 0}
              onClick={() => setConfig(buildDefaultMasterConfig())}
            >
              {t('sessionDetail.masterReset')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || loading}
              onClick={() => void saveMaster()}
            >
              {saving ? t('common.saving') : t('sessionDetail.masterSaveAndApply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={elementsOpen}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) closeElementsDialog()
          else setElementsOpen(true)
        }}
      >
        <DialogContent
          showClose={false}
          className="!max-w-[960px] h-[600px] gap-4 overflow-y-auto p-5"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="absolute right-3 top-3 h-7 w-7 p-0"
            aria-label={t('common.cancel')}
            disabled={saving}
            onClick={closeElementsDialog}
          >
            <X className="h-4 w-4" />
          </Button>
          <DialogHeader>
            <DialogTitle>{t('sessionDetail.masterElementsTitle')}</DialogTitle>
            <DialogDescription>{t('sessionDetail.masterElementsDescription')}</DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex justify-center py-10 text-[#667257]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <fieldset disabled={busy} className="space-y-5">
              <MasterElementsEditor />

              {selectedPageId && (
                <div className="flex w-fit items-center gap-2 text-sm text-[#4a563d]">
                  <label htmlFor="master-hide-elements-on-slide" className="cursor-pointer">
                    {t('sessionDetail.masterHideElementsOnSlide')}
                  </label>
                  <Checkbox
                    id="master-hide-elements-on-slide"
                    checked={currentPageElementsDisabled}
                    onCheckedChange={(checked) => void toggleCurrentPageElements(checked === true)}
                  />
                </div>
              )}

              {status && status.unlinkedPageCount > 0 && (
                <p className="text-xs leading-4 text-[#667257]">
                  {t('sessionDetail.masterUnlinkedHint', { count: status.unlinkedPageCount })}
                </p>
              )}
              {error && <p className="text-xs leading-4 text-[#a14f4a]">{error}</p>}
            </fieldset>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={closeElementsDialog}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || loading || (status?.missingPageCount || 0) > 0}
              onClick={() => updateConfig({ elements: buildDefaultMasterElementsConfig() })}
            >
              {t('sessionDetail.masterElementsReset')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={busy || loading}
              onClick={() => void saveMaster()}
            >
              {saving ? t('common.saving') : t('sessionDetail.masterSaveAndApply')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
