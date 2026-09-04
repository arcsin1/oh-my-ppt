import { useState, useEffect, useCallback, useMemo, type ReactElement } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '../ui/Dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import { StyleSelect } from '../style/StyleSelect'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Checkbox } from '../ui/Checkbox'
import { useT, type I18nKey } from '@renderer/i18n'
import { ipc, type FontListItem } from '@renderer/lib/ipc'
import {
  getImageModelConfigLabel,
  getUsableImageModelConfigs,
  resolveDefaultImageModelConfigId
} from '@renderer/lib/image-model-config'
import type { FontSelection, SourceDocumentPlan } from '@shared/generation'
import {
  DEFAULT_SLIDE_SIZE_ID,
  SLIDE_SIZE_PRESETS,
  type SlideSizePresetId
} from '@shared/slide-size'
import type { ThinkingPrepareGenerationResult } from '@shared/thinking'
import { Sparkles } from 'lucide-react'
import { ModelSplitButton } from '../model/ModelActionButton'
import { useModelAction } from '@renderer/hooks/useModelAction'
import { useSettingsStore } from '@renderer/store'

type FontPairRef = Extract<FontSelection, { mode: 'pair' }>['title']

const MIN_PAGE_COUNT = 1
const MAX_PAGE_COUNT = 500

const resolvePageCount = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10)
  const resolved = Number.isFinite(parsed) ? parsed : fallback
  return Math.min(MAX_PAGE_COUNT, Math.max(MIN_PAGE_COUNT, resolved))
}

const getSlideSizeLabelKey = (id: SlideSizePresetId): I18nKey => {
  switch (id) {
    case 'wide-16-9':
      return 'home.slideSizeWide'
    case 'vertical-9-16':
      return 'home.slideSizeVertical'
    case 'standard-4-3':
      return 'home.slideSizeStandard'
    case 'square-1-1':
      return 'home.slideSizeSquare'
    case 'vertical-3-4':
      return 'home.slideSizePortrait'
    case 'xiaohongshu-note':
      return 'home.slideSizeXiaohongshu'
  }
}

interface StyleOption {
  id: string
  styleKey?: string
  label: string
  description: string
  aliases?: string[]
  styleCase?: string
  imageGenerationPrompt?: string
  thumbnailPath?: string | null
  previewPath?: string | null
  favoriteAt?: number | null
}

const tokenizeStyleText = (value: string): string[] => {
  const compact = value.trim().toLowerCase()
  const baseTokens = compact
    .split(/[\s,，、/|;；:：()[\]{}"'“”‘’<>《》]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  const latinTokens = Array.from(compact.matchAll(/[a-z0-9-]{2,}/g), (match) => match[0])
  const cnBigrams = Array.from(compact.matchAll(/[\u4e00-\u9fa5]{2,}/g)).flatMap((match) => {
    const text = match[0]
    const grams: string[] = []
    for (let index = 0; index < text.length - 1; index += 1) {
      grams.push(text.slice(index, index + 2))
    }
    return grams
  })
  return Array.from(new Set([...baseTokens, ...latinTokens, ...cnBigrams]))
}

const resolveFallbackStyleId = (fallbackStyleId: string, options: StyleOption[]): string => {
  if (fallbackStyleId) return fallbackStyleId
  return (
    options.find((option) => option.styleKey === 'minimal-white')?.id ||
    options.find((option) => option.id === 'minimal-white')?.id ||
    options[0]?.id ||
    ''
  )
}

const resolveMatchedStyleId = (
  styleText: string | undefined,
  fallbackStyleId: string,
  options: StyleOption[]
): string => {
  const normalizedStyleText = (styleText || '').trim().toLowerCase()
  const resolvedFallbackStyleId = resolveFallbackStyleId(fallbackStyleId, options)
  if (options.length === 0) return resolvedFallbackStyleId
  if (!normalizedStyleText) return resolvedFallbackStyleId

  const exact = options.find((option) => {
    const candidates = [
      option.id,
      option.styleKey || '',
      option.label,
      ...(option.aliases || [])
    ].map((value) => value.toLowerCase())
    return candidates.includes(normalizedStyleText)
  })
  if (exact) return exact.id

  const queryTokens = tokenizeStyleText(normalizedStyleText)
  let best: { id: string; score: number } | null = null
  for (const option of options) {
    const haystack = [
      option.id,
      option.styleKey || '',
      option.label,
      ...(option.aliases || []),
      option.description,
      option.styleCase || ''
    ]
      .join(' ')
      .toLowerCase()
    let score = 0
    for (const token of queryTokens) {
      if (!token || !haystack.includes(token)) continue
      score += token.length >= 2 ? 2 : 1
    }
    if (!best || score > best.score) best = { id: option.id, score }
  }
  return best && best.score > 0 ? best.id : resolvedFallbackStyleId
}

interface GenerationConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  prepared: ThinkingPrepareGenerationResult | null
  onConfirm: (params: {
    topic: string
    pageCount: number
    styleId: string
    fontSelection: FontSelection
    slideSizeId: SlideSizePresetId
    referenceDocumentPath: string
    sourcePlan?: SourceDocumentPlan
    modelConfigId?: string
    visualEnabled: boolean
    imageModelConfigId?: string
  }) => void
}

export function GenerationConfirmDialog({
  open,
  onOpenChange,
  prepared,
  onConfirm
}: GenerationConfirmDialogProps): ReactElement {
  const t = useT()
  const modelAction = useModelAction()
  const { selectedModelConfigId, ensureModelActive } = modelAction
  const imageModelConfigs = useSettingsStore((state) => state.imageModelConfigs)
  const [confirming, setConfirming] = useState(false)
  const [topic, setTopic] = useState('')
  const [pageCount, setPageCount] = useState('5')
  const [styleId, setStyleId] = useState('')
  const [styleOptions, setStyleOptions] = useState<StyleOption[]>([])
  const [fontOptions, setFontOptions] = useState<FontListItem[]>([])
  const [titleFontId, setTitleFontId] = useState('auto')
  const [bodyFontId, setBodyFontId] = useState('auto')
  const [slideSizeId, setSlideSizeId] = useState<SlideSizePresetId>(DEFAULT_SLIDE_SIZE_ID)
  const [visualEnabled, setVisualEnabled] = useState(false)
  const [selectedImageModelConfigId, setSelectedImageModelConfigId] = useState('')
  const usableImageModelConfigs = useMemo(
    () => getUsableImageModelConfigs(imageModelConfigs),
    [imageModelConfigs]
  )

  useEffect(() => {
    if (usableImageModelConfigs.length === 0) {
      setVisualEnabled(false)
      setSelectedImageModelConfigId('')
      return
    }
    if (!visualEnabled) return
    setSelectedImageModelConfigId((current) =>
      usableImageModelConfigs.some((config) => config.id === current)
        ? current
        : resolveDefaultImageModelConfigId(usableImageModelConfigs)
    )
  }, [usableImageModelConfigs, visualEnabled])

  useEffect(() => {
    if (prepared) {
      setTopic(prepared.topic)
      setPageCount(String(prepared.pageCount))
      if (styleOptions.length > 0) {
        setStyleId(resolveMatchedStyleId(prepared.styleText, prepared.styleId, styleOptions))
      }
    }
  }, [prepared, styleOptions])

  useEffect(() => {
    if (!prepared || prepared.fontSelection.mode !== 'pair') {
      setTitleFontId('auto')
      setBodyFontId('auto')
      return
    }

    const resolveSelectId = (font: FontPairRef): string => {
      if (font.id) return `${font.source}:${font.id}`
      const match = fontOptions.find(
        (option) => option.source === font.source && option.family === font.family
      )
      return match ? `${match.source}:${match.id}` : 'auto'
    }

    setTitleFontId(resolveSelectId(prepared.fontSelection.title))
    setBodyFontId(resolveSelectId(prepared.fontSelection.body))
  }, [prepared, fontOptions])

  const loadOptions = useCallback(async (): Promise<void> => {
    const [styleRes, fontRes] = await Promise.all([ipc.listStyles(), ipc.listFonts()])
    const sorted = [...styleRes.items].sort(
      (a, b) =>
        (b.favoriteAt || 0) - (a.favoriteAt || 0) ||
        (b.updatedAt || 0) - (a.updatedAt || 0) ||
        (b.createdAt || 0) - (a.createdAt || 0) ||
        a.id.localeCompare(b.id)
    )
    setStyleOptions(
      sorted.map((item) => ({
        id: item.id,
        styleKey: item.styleKey,
        label: item.label,
        description: item.description,
        aliases: item.aliases,
        styleCase: item.styleCase,
        imageGenerationPrompt: item.imageGenerationPrompt,
        thumbnailPath: item.thumbnailPath,
        previewPath: item.previewPath,
        favoriteAt: item.favoriteAt
      }))
    )
    const fonts = [...fontRes.userFonts, ...fontRes.googleFonts]
    setFontOptions(fonts)
  }, [])

  useEffect(() => {
    if (open) void loadOptions()
  }, [open, loadOptions])

  if (!prepared) return <></>

  const titleFonts = fontOptions.filter((f) => f.role.includes('title'))
  const bodyFonts = fontOptions.filter((f) => f.role.includes('body'))
  const availableTitle = titleFonts.length > 0 ? titleFonts : fontOptions
  const availableBody = bodyFonts.length > 0 ? bodyFonts : fontOptions

  const resolveFontSelection = (): FontSelection => {
    const find = (id: string): FontListItem | undefined =>
      fontOptions.find((f) => `${f.source}:${f.id}` === id)
    const tf = find(titleFontId)
    const bf = find(bodyFontId)
    if (tf && bf) {
      return {
        mode: 'pair',
        title: { source: tf.source, family: tf.family, id: tf.id },
        body: { source: bf.source, family: bf.family, id: bf.id }
      }
    }
    if (
      prepared?.fontSelection.mode === 'pair' &&
      (fontOptions.length === 0 || (titleFontId !== 'auto' && bodyFontId !== 'auto'))
    ) {
      return prepared.fontSelection
    }
    return { mode: 'auto' }
  }

  const resolvedConfirmStyleId = styleId || resolveFallbackStyleId(prepared.styleId, styleOptions)

  const handleConfirm = async (modelConfigId = selectedModelConfigId): Promise<void> => {
    if (!resolvedConfirmStyleId || confirming) return
    if (
      visualEnabled &&
      !usableImageModelConfigs.some((config) => config.id === selectedImageModelConfigId)
    ) {
      return
    }
    const resolvedModelConfigId = await ensureModelActive(modelConfigId)
    if (!resolvedModelConfigId) return
    setConfirming(true)
    try {
      const resolvedPageCount = resolvePageCount(pageCount, prepared.pageCount)
      onConfirm({
        topic: topic.trim() || prepared.topic,
        pageCount: resolvedPageCount,
        styleId: resolvedConfirmStyleId,
        fontSelection: resolveFontSelection(),
        slideSizeId,
        referenceDocumentPath: prepared.thinkingDocumentPath,
        sourcePlan:
          prepared.sourcePlan?.pageSkeleton.length === resolvedPageCount
            ? prepared.sourcePlan
            : undefined,
        modelConfigId: resolvedModelConfigId,
        visualEnabled,
        imageModelConfigId: visualEnabled ? selectedImageModelConfigId : undefined
      })
      onOpenChange(false)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('thinking.generationDialogTitle')}</DialogTitle>
          <DialogDescription className="text-[12px]">
            {t('thinking.generationDialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-3 py-2 [&_button[role=combobox]]:h-8 [&_input]:h-8 [&_label]:mb-1.5 [&_label]:text-xs">
          <div className="min-w-0">
            <label className="block font-medium">{t('home.topic')}</label>
            <Input className="min-w-0" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(20rem,1fr)_6.25rem_minmax(0,12rem)]">
            <div className="min-w-0">
              <label className="block font-medium">{t('home.style')}</label>
              <StyleSelect
                value={styleId}
                onChange={setStyleId}
                options={styleOptions}
                placeholder={t('home.stylePlaceholder')}
                recommendation={{ topic, modelConfigId: selectedModelConfigId }}
                className="h-8 min-w-0 py-0 text-xs"
                dropdownClassName="w-[min(640px,calc(100vw-3rem))]"
              />
            </div>

            <div className="min-w-0">
              <label className="block font-medium">{t('home.pageCount')}</label>
              <Input
                className="min-w-0 text-center"
                type="text"
                inputMode="numeric"
                value={pageCount}
                onChange={(e) => {
                  const next = e.target.value
                  if (next === '' || /^\d+$/.test(next)) setPageCount(next)
                }}
                onBlur={() => {
                  setPageCount(String(resolvePageCount(pageCount, prepared.pageCount)))
                }}
              />
            </div>

            <div className="min-w-0">
              <label className="block font-medium">{t('home.slideSize')}</label>
              <Select
                value={slideSizeId}
                onValueChange={(value) => setSlideSizeId(value as SlideSizePresetId)}
              >
                <SelectTrigger className="min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SLIDE_SIZE_PRESETS.map((preset) => (
                    <SelectItem key={preset.id} value={preset.id}>
                      {t(getSlideSizeLabelKey(preset.id))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="min-w-0">
            <label className="block font-medium">{t('home.fontScheme')}</label>
            <div className="mt-1 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Select value={titleFontId} onValueChange={setTitleFontId}>
                <SelectTrigger className="min-w-0">
                  <SelectValue placeholder={t('home.fontSchemeAuto')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('home.fontSchemeAuto')}</SelectItem>
                  {availableTitle.map((font) => {
                    const isUploaded = font.source === 'uploaded'
                    return (
                      <SelectItem
                        key={`${font.source}:${font.id}`}
                        value={`${font.source}:${font.id}`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${
                              isUploaded
                                ? 'bg-[#eef9ec] text-[#4a7a46]'
                                : 'bg-[#eef6ff] text-[#3e6685]'
                            }`}
                          >
                            {isUploaded
                              ? t('home.fontSourceUploaded')
                              : t('home.fontSourceBuiltIn')}
                          </span>
                          <span className="truncate">
                            {t('home.fontPairTitle')} · {font.family}
                          </span>
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <Select value={bodyFontId} onValueChange={setBodyFontId}>
                <SelectTrigger className="min-w-0">
                  <SelectValue placeholder={t('home.fontSchemeAuto')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">{t('home.fontSchemeAuto')}</SelectItem>
                  {availableBody.map((font) => {
                    const isUploaded = font.source === 'uploaded'
                    return (
                      <SelectItem
                        key={`${font.source}:${font.id}`}
                        value={`${font.source}:${font.id}`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${
                              isUploaded
                                ? 'bg-[#eef9ec] text-[#4a7a46]'
                                : 'bg-[#eef6ff] text-[#3e6685]'
                            }`}
                          >
                            {isUploaded
                              ? t('home.fontSourceUploaded')
                              : t('home.fontSourceBuiltIn')}
                          </span>
                          <span className="truncate">
                            {t('home.fontPairBody')} · {font.family}
                          </span>
                        </span>
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="min-w-0 rounded-md border border-[#d8ccb5]/70 bg-[#fffdf8]/70 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Checkbox
                checked={visualEnabled}
                disabled={usableImageModelConfigs.length === 0}
                onCheckedChange={(checked) => {
                  const enabled = checked === true
                  setVisualEnabled(enabled)
                  setSelectedImageModelConfigId(
                    enabled ? resolveDefaultImageModelConfigId(usableImageModelConfigs) : ''
                  )
                }}
              />
              <span>{t('home.enableImageGeneration')}</span>
            </label>
            {visualEnabled ? (
              <div className="mt-3 min-w-0">
                <label className="block font-medium">{t('home.imageModel')}</label>
                <Select value={selectedImageModelConfigId} onValueChange={setSelectedImageModelConfigId}>
                  <SelectTrigger className="min-w-0">
                    <SelectValue placeholder={t('home.imageModelPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {usableImageModelConfigs.map((config) => (
                      <SelectItem key={config.id} value={config.id}>
                        {getImageModelConfigLabel(config)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <p className="mt-2 text-xs text-muted-foreground">
              {usableImageModelConfigs.length > 0
                ? t('home.imageGenerationHint')
                : t('home.imageModelUnavailable')}
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={confirming}
            className="w-full rounded-full sm:w-auto"
          >
            {t('common.cancel')}
          </Button>
          <ModelSplitButton
            modelAction={modelAction}
            label={t('home.createAndStart')}
            loadingLabel={t('home.creating')}
            loading={confirming}
            disabled={
              !resolvedConfirmStyleId ||
              (visualEnabled &&
                !usableImageModelConfigs.some((config) => config.id === selectedImageModelConfigId))
            }
            icon={Sparkles}
            tone="primary"
            className="w-full sm:w-auto"
            mainClassName="min-w-0 flex-1 sm:flex-none sm:min-w-[156px]"
            onRun={handleConfirm}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
