import {
  CircleAlert,
  FolderOpen,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Maximize2,
  SlidersHorizontal,
  Sparkles,
  StopCircle,
  Wallpaper,
  RefreshCw
} from 'lucide-react'
import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GeneratedImageAsset } from '@shared/image-generation.js'
import { localAssetUrl } from '@shared/local-asset'
import { useT } from '@renderer/i18n'
import { ipc, type ImageFulfillmentJobView } from '@renderer/lib/ipc'
import { cn } from '@renderer/lib/utils'
import { useSessionDetailUiStore, useSettingsStore, useToastStore } from '@renderer/store'
import { useModelAction } from '@renderer/hooks/useModelAction'
import { ModelSplitButton } from '@renderer/components/model/ModelActionButton'
import { Button } from '../../ui/Button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../ui/Dialog'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/Popover'
import { Progress } from '../../ui/Progress'
import { ScrollArea } from '../../ui/ScrollArea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../ui/Select'
import { Textarea } from '../../ui/Input'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../ui/Tooltip'
import { resolveImageSizeOptions } from './imageSizeOptions'
import { useImageGenerationActions } from '../hooks/useImageGenerationActions'

const localAssetSrc = (absolutePath?: string): string =>
  absolutePath ? localAssetUrl(absolutePath) : ''

export function ImageGenerationPanel({ sessionId }: { sessionId: string }): React.JSX.Element {
  const t = useT()
  const modelAction = useModelAction()
  const { selectedPage, generate, cancel, addToCanvas, setAsBackground, revealFile } =
    useImageGenerationActions(sessionId)
  const selectedPageExists = Boolean(selectedPage?.pageId)
  const selectedPageHtmlPath = selectedPage?.htmlPath
  const selectedPageNumber = selectedPage?.pageNumber
  const selectedPageTitle = selectedPage?.title
  const selectedPageOutline = selectedPage?.contentOutline
  const imageModelConfigs = useSettingsStore((state) => state.imageModelConfigs)
  const { error: toastError, success: toastSuccess } = useToastStore()
  const imagePrompt = useSessionDetailUiStore((state) => state.imagePrompt)
  const imageMessages = useSessionDetailUiStore((state) => state.imageMessages)
  const selectedImageModelConfigId = useSessionDetailUiStore(
    (state) => state.selectedImageModelConfigId
  )
  const imageSize = useSessionDetailUiStore((state) => state.imageSize)
  const imageCount = 1
  const isGeneratingImage = useSessionDetailUiStore((state) => state.isGeneratingImage)
  const imageProgress = useSessionDetailUiStore((state) => state.imageProgress)
  const setImagePrompt = useSessionDetailUiStore((state) => state.setImagePrompt)
  const setSelectedImageModelConfigId = useSessionDetailUiStore(
    (state) => state.setSelectedImageModelConfigId
  )
  const setImageSize = useSessionDetailUiStore((state) => state.setImageSize)
  const [previewAsset, setPreviewAsset] = useState<GeneratedImageAsset | null>(null)
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false)
  const [fulfillmentJobs, setFulfillmentJobs] = useState<ImageFulfillmentJobView[]>([])
  const [retryingFulfillmentJobId, setRetryingFulfillmentJobId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const hasImageModels = imageModelConfigs.length > 0
  const imageControlsDisabled = !hasImageModels || isGeneratingImage || isGeneratingPrompt
  const selectedImageModel =
    imageModelConfigs.find((config) => config.id === selectedImageModelConfigId) ||
    imageModelConfigs.find((config) => config.active) ||
    imageModelConfigs[0]
  const imageSizeOptions = useMemo(
    () => resolveImageSizeOptions(selectedImageModel),
    [selectedImageModel]
  )
  const selectedImageSizeOption =
    imageSizeOptions.find((option) => option.value === imageSize) || imageSizeOptions[0]

  useEffect(() => {
    const selectedExists = imageModelConfigs.some(
      (config) => config.id === selectedImageModelConfigId
    )
    if (selectedImageModelConfigId && selectedExists) return
    const active = imageModelConfigs.find((config) => config.active) || imageModelConfigs[0]
    if (active) {
      setSelectedImageModelConfigId(active.id)
    }
  }, [imageModelConfigs, selectedImageModelConfigId, setSelectedImageModelConfigId])

  useEffect(() => {
    if (imageSizeOptions.length === 0) return
    if (imageSizeOptions.some((option) => option.value === imageSize)) return
    setImageSize(imageSizeOptions[0].value)
  }, [imageSize, imageSizeOptions, setImageSize])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [imageMessages, isGeneratingImage, imageProgress?.progress])

  useEffect(() => {
    if (!sessionId || !selectedPage?.pageId) {
      setFulfillmentJobs([])
      return
    }
    let disposed = false
    const loadJobs = async (): Promise<void> => {
      try {
        const jobs = await ipc.listImageFulfillmentJobs({
          sessionId,
          pageId: selectedPage.pageId
        })
        if (!disposed) setFulfillmentJobs(jobs)
      } catch {
        if (!disposed) setFulfillmentJobs([])
      }
    }
    void loadJobs()
    const timer = window.setInterval(() => void loadJobs(), 5000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [selectedPage?.pageId, sessionId])

  const handleFillFromOutline = (): void => {
    if (!hasImageModels) return
    const parts = [
      t('sessionDetail.imageOutlinePromptIntro'),
      selectedPageTitle ? `${t('sessionDetail.imageOutlineTitle')}: ${selectedPageTitle}` : '',
      selectedPageOutline
        ? `${t('sessionDetail.imageOutlineContent')}: ${selectedPageOutline}`
        : '',
      t('sessionDetail.imageOutlineConstraints')
    ].filter(Boolean)
    setImagePrompt(parts.join('\n'))
  }

  const handleGeneratePromptFromCurrentPage = async (modelConfigId: string): Promise<void> => {
    if (
      !hasImageModels ||
      !selectedPageExists ||
      !sessionId ||
      !selectedPageHtmlPath ||
      isGeneratingPrompt
    ) {
      return
    }
    const activeModelConfigId = await modelAction.ensureModelActive(modelConfigId)
    if (!activeModelConfigId) return

    setIsGeneratingPrompt(true)
    try {
      const result = await ipc.generateImagePrompt({
        sessionId,
        htmlPath: selectedPageHtmlPath,
        userPrompt: imagePrompt,
        pageTitle: selectedPageTitle,
        pageOutline: selectedPageOutline || undefined,
        modelConfigId: activeModelConfigId
      })
      setImagePrompt(result.prompt)
      toastSuccess(t('sessionDetail.imagePromptGenerated'))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : t('sessionDetail.imagePromptGenerateFailed')
      toastError(t('sessionDetail.imagePromptGenerateFailed'), { description: message })
    } finally {
      setIsGeneratingPrompt(false)
    }
  }

  const generateDisabled = imageControlsDisabled || !selectedPageExists || !imagePrompt.trim()
  const latestFulfillmentJob = fulfillmentJobs[0]
  const optionSummary = selectedImageModel
    ? `${selectedImageModel.name} · ${selectedImageSizeOption?.label || imageSize} · ${imageCount}`
    : t('sessionDetail.imageOptions')

  const retryFailedIllustration = async (): Promise<void> => {
    if (!latestFulfillmentJob || retryingFulfillmentJobId) return
    setRetryingFulfillmentJobId(latestFulfillmentJob.id)
    try {
      const result = await ipc.retryImageFulfillment({
        sessionId,
        jobId: latestFulfillmentJob.id
      })
      if (result.status === 'degraded' || result.status === 'cancelled') {
        throw new Error(result.error || t('sessionDetail.autoImageRetryFailed'))
      }
      const jobs = await ipc.listImageFulfillmentJobs({
        sessionId,
        pageId: selectedPage?.pageId
      })
      setFulfillmentJobs(jobs)
      toastSuccess(t('sessionDetail.autoImageRetryStarted'))
    } catch (error) {
      toastError(t('sessionDetail.autoImageRetryFailed'), {
        description: error instanceof Error ? error.message : undefined
      })
    } finally {
      setRetryingFulfillmentJobId(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mx-2.5 mt-2.5 overflow-hidden rounded-[1.35rem] border border-[#e1d6c4]/72 bg-[#fffaf1]/78 px-3 pb-2.5 pt-3 shadow-[0_4px_12px_rgba(77,61,43,0.06)]">
        <div className="relative flex flex-col gap-2">
          <h3 className="text-sm font-semibold tracking-[0.04em] text-[#34402c]">
            {t('sessionDetail.imageMode')}
          </h3>
          <div className="flex items-center justify-between gap-2 text-xs text-[#6d604d]">
            <span>
              {selectedPageExists && selectedPageNumber
                ? t('sessionDetail.pageContext', { pageNumber: selectedPageNumber })
                : t('sessionDetail.selectPageFirst')}
            </span>
            <Sparkles className="h-4 w-4 text-[#6f8f64]" />
          </div>
        </div>
      </div>

      {latestFulfillmentJob &&
        (latestFulfillmentJob.status === 'pending' ||
          latestFulfillmentJob.status === 'running' ||
          latestFulfillmentJob.status === 'finalizing' ||
          latestFulfillmentJob.status === 'degraded' ||
          latestFulfillmentJob.status === 'failed' ||
          latestFulfillmentJob.status === 'cancelled') && (
          <div className="mx-2.5 mt-2 flex items-start gap-2 rounded-lg border border-[#ded2bd]/78 bg-[#fffaf1]/84 px-2.5 py-2 text-xs text-[#5c513f]">
            {latestFulfillmentJob.status === 'pending' ||
            latestFulfillmentJob.status === 'running' ||
            latestFulfillmentJob.status === 'finalizing' ? (
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[#6f8f64]" />
            ) : (
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b26b3c]" />
            )}
            <div className="min-w-0 flex-1">
              <p className="leading-5">
                {latestFulfillmentJob.status === 'degraded'
                  ? latestFulfillmentJob.layout_failed_count > 0
                    ? t('sessionDetail.autoImageLayoutFailed')
                    : t('sessionDetail.autoImageDegraded')
                  : latestFulfillmentJob.status === 'failed'
                    ? t('sessionDetail.autoImageRetryFailed')
                    : latestFulfillmentJob.status === 'cancelled'
                      ? t('sessionDetail.autoImageCancelled')
                    : t('sessionDetail.autoImageInProgress')}
              </p>
              {latestFulfillmentJob.error &&
                latestFulfillmentJob.status !== 'pending' &&
                latestFulfillmentJob.status !== 'running' &&
                latestFulfillmentJob.status !== 'finalizing' && (
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-[#8a735d]">
                    {latestFulfillmentJob.error}
                  </p>
                )}
            </div>
            {latestFulfillmentJob.retryable_intent_count > 0 &&
              (latestFulfillmentJob.status === 'degraded' ||
                latestFulfillmentJob.status === 'failed' ||
                latestFulfillmentJob.status === 'cancelled') && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-1.5 text-[11px] text-[#5d6b4d] hover:bg-[#dcebcf]/72"
                  disabled={retryingFulfillmentJobId === latestFulfillmentJob.id}
                  onClick={() => void retryFailedIllustration()}
                >
                  {retryingFulfillmentJobId === latestFulfillmentJob.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="mr-1 h-3.5 w-3.5" />
                  )}
                  {t('sessionDetail.autoImageRetry')}
                </Button>
              )}
          </div>
        )}

      <ScrollArea
        data-image-results-container
        className="min-h-0 flex-1"
        viewportClassName="px-2.5 py-2"
      >
        {imageMessages.length === 0 && !isGeneratingImage ? (
          <div className="mt-24 flex min-h-full flex-col items-center justify-center gap-2 text-center text-sm text-[#7a6b56]">
            <ImageIcon className="h-8 w-8 text-[#9ba88d]" />
            <span>{t('sessionDetail.imageResultEmpty')}</span>
          </div>
        ) : (
          <div className="flex min-h-full flex-col justify-end gap-2.5">
            {imageMessages.map((message) => {
              const isUser = message.role === 'user'
              return (
                <div
                  key={message.id}
                  className={cn('flex w-full min-w-0', isUser ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'min-w-0 overflow-hidden rounded-[1.15rem] border px-3 py-2 shadow-[0_6px_14px_rgba(74,59,42,0.08)]',
                      isUser ? 'w-fit max-w-[238px]' : 'w-full max-w-[238px]',
                      isUser
                        ? 'border-[#d6e3c8]/78 bg-[#fbfef6]/90 text-[#34402c]'
                        : 'border-[#ded2bd]/78 bg-[#fffaf1]/88 text-[#3f372b]'
                    )}
                  >
                    {message.content && (
                      <p className="whitespace-pre-wrap break-words text-[13px] leading-5">
                        {message.content}
                      </p>
                    )}
                    {message.assets && message.assets.length > 0 && (
                      <div className={cn('flex flex-col gap-2', message.content && 'mt-2')}>
                        {message.assets.map((asset) => (
                          <div
                            key={asset.id}
                            className="rounded-[0.9rem] border border-[#ded2bd]/72 bg-[#fffdf8]/82 p-1.5"
                          >
                            {asset.absolutePath ? (
                              <button
                                type="button"
                                className="group relative flex h-[132px] w-full items-center justify-center overflow-hidden rounded-[0.7rem] bg-[#f6efe3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8aa878]"
                                onClick={() => setPreviewAsset(asset)}
                                aria-label={t('sessionDetail.imagePreviewOpen')}
                                title={t('sessionDetail.imagePreviewOpen')}
                              >
                                <img
                                  src={localAssetSrc(asset.absolutePath)}
                                  alt={asset.fileName}
                                  className="h-full w-full object-contain"
                                />
                                <span className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-[#2f3829]/70 text-[#fffaf1] opacity-0 shadow-[0_6px_14px_rgba(33,29,21,0.24)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                  <Maximize2 className="h-3 w-3" />
                                </span>
                              </button>
                            ) : (
                              <div className="flex h-[132px] w-full items-center justify-center rounded-[0.7rem] border border-dashed border-[#ded2bd]/72 text-[11px] text-muted-foreground">
                                {asset.fileName}
                              </div>
                            )}
                            {(() => {
                              const modelConfig = imageModelConfigs.find(
                                (c) => c.id === asset.modelConfigId
                              )
                              const modelLabel = modelConfig?.name || asset.model
                              return (
                                <p className="mt-1 text-center text-[10px] leading-3 text-muted-foreground">
                                  {modelLabel}
                                </p>
                              )
                            })()}
                            <div className="mt-1 flex items-center justify-center gap-1">
                              {asset.absolutePath && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 shrink-0 rounded-[7px] p-0 text-[#5d6b4d] hover:bg-[#dcebcf]/72 disabled:opacity-40"
                                      disabled={!selectedPageExists}
                                      onClick={() => void addToCanvas(asset)}
                                      aria-label={t('sessionDetail.addImageToCanvas')}
                                    >
                                      <ImagePlus className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {t('sessionDetail.addImageToCanvas')}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              {asset.absolutePath && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 shrink-0 rounded-[7px] p-0 text-[#5d6b4d] hover:bg-[#dcebcf]/72 disabled:opacity-40"
                                      disabled={!selectedPageExists}
                                      onClick={() => void setAsBackground(asset)}
                                      aria-label={t('sessionDetail.setImageAsBackground')}
                                    >
                                      <Wallpaper className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    {t('sessionDetail.setImageAsBackground')}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                              {asset.absolutePath && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-7 w-7 rounded-[7px] p-0 text-[#5d6b4d] hover:bg-[#f4ebdc]"
                                      onClick={() => void revealFile(asset.absolutePath)}
                                      aria-label={t('sessionDetail.revealFile')}
                                    >
                                      <FolderOpen className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>{t('sessionDetail.revealFile')}</TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                      {dayjs(message.createdAt * 1000).format('YYYY-MM-DD HH:mm:ss')}
                    </p>
                  </div>
                </div>
              )
            })}
            {isGeneratingImage && imageProgress && (
              <div className="w-full max-w-[238px] rounded-[1.15rem] border border-[#ded2bd]/72 bg-[#fffaf1]/82 px-3 py-2 shadow-[0_6px_14px_rgba(74,59,42,0.08)]">
                <p className="mb-2 text-sm text-[#655843]">
                  {imageProgress.label || t('sessionDetail.imageGenerating')}
                </p>
                <Progress value={imageProgress.progress} />
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      <div className="mx-2.5 mb-2.5 rounded-[1.4rem] border border-[#ded2bd]/72 bg-[#fffaf1]/84 px-2.5 pb-3 pt-2 shadow-[0_12px_24px_rgba(74,59,42,0.11)]">
        <div className="mb-1.5 flex items-center justify-end gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={imageControlsDisabled || !selectedPageExists}
            className="h-6 rounded-full border border-[#8faf7d]/36 bg-[#dcebcf]/74 px-2.5 text-[11px] font-medium text-[#526942] shadow-none hover:bg-[#d2e4c3] disabled:opacity-45"
            onClick={handleFillFromOutline}
          >
            {t('sessionDetail.imagePromptFromOutline')}
          </Button>
          <ModelSplitButton
            modelAction={modelAction}
            label={t('sessionDetail.imagePromptFromCurrentPage')}
            loadingLabel={t('sessionDetail.imagePromptGenerating')}
            loading={isGeneratingPrompt}
            disabled={
              imageControlsDisabled || !selectedPageExists || !sessionId || !selectedPageHtmlPath
            }
            icon={Sparkles}
            tone="subtle"
            size="sm"
            dropdownAlign="end"
            className="h-6 rounded-full border-[#8faf7d]/36 bg-[#dcebcf]/74 shadow-none"
            mainClassName="h-6 rounded-full px-2.5 text-[11px] font-medium text-[#526942] hover:bg-[#d2e4c3] hover:text-[#526942]"
            triggerClassName="h-6 text-[#526942] hover:bg-[#d2e4c3] hover:text-[#526942]"
            onRun={handleGeneratePromptFromCurrentPage}
          />
        </div>
        {!hasImageModels && (
          <p className="mb-1.5 rounded-lg border border-[#e3d6c2]/78 bg-[#fff6e7]/82 px-2.5 py-1.5 text-[11px] leading-4 text-[#8a5d2d]">
            {t('sessionDetail.imageModelRequiredHint')}
          </p>
        )}
        <div>
          <Textarea
            placeholder={t('sessionDetail.imagePromptPlaceholder')}
            value={imagePrompt}
            onChange={(event) => setImagePrompt(event.target.value)}
            disabled={imageControlsDisabled}
            rows={4}
            className="min-h-[96px] resize-none rounded-[1.15rem] border border-[#ded2bd]/72 bg-[#fffdf8]/88 px-3 py-2 text-[13px] leading-5 text-[#3f4b35] shadow-[inset_0_1px_2px_rgba(74,59,42,0.05)] focus-visible:border-[#9bb98a] focus-visible:ring-0 focus-visible:ring-offset-0"
          />
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={imageControlsDisabled}
                className="h-8 min-w-0 flex-1 justify-start rounded-full border border-[#ded2bd]/70 bg-[#fffdf8]/88 px-2.5 text-xs text-[#52614a]"
              >
                <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                  {t('sessionDetail.imageConfigButton')}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              className="w-[268px] border-[#d8cfbc]/80 bg-[#fffdf8] p-3"
            >
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-semibold text-[#34402c]">
                    {t('sessionDetail.imageConfigTitle')}
                  </p>
                  <p className="mt-0.5 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-muted-foreground">
                    {optionSummary}
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-[#6d604d]">
                    {t('sessionDetail.imageModelPlaceholder')}
                  </label>
                  <Select
                    value={selectedImageModelConfigId || undefined}
                    onValueChange={setSelectedImageModelConfigId}
                    disabled={imageControlsDisabled}
                  >
                    <SelectTrigger className="h-8 w-full min-w-0 rounded-lg border-[#ded2bd]/70 bg-[#fffdf8]/82 px-3 py-1 text-xs text-[#3e4a32] shadow-none">
                      <SelectValue placeholder={t('sessionDetail.imageModelPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {imageModelConfigs.map((config) => (
                        <SelectItem key={config.id} value={config.id}>
                          {config.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#6d604d]">
                      {t('sessionDetail.imageSizeLabel')}
                    </label>
                    <Select
                      value={selectedImageSizeOption?.value || imageSize}
                      onValueChange={setImageSize}
                      disabled={imageControlsDisabled}
                    >
                      <SelectTrigger className="h-8 w-full rounded-lg border-[#ded2bd]/70 bg-[#fffdf8]/82 px-3 py-1 text-xs text-[#3e4a32] shadow-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {imageSizeOptions.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="mb-1 block text-[11px] font-medium text-[#6d604d]">
                      {t('sessionDetail.imageCountLabel')}
                    </label>
                    <Select value="1" disabled>
                      <SelectTrigger className="h-8 w-full rounded-lg border-[#ded2bd]/70 bg-[#fffdf8]/82 px-3 py-1 text-xs text-[#3e4a32] shadow-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">1</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          {isGeneratingImage ? (
            <Button
              variant="destructive"
              onClick={() => void cancel()}
              size="sm"
              className="shrink-0 whitespace-nowrap rounded-full px-3 text-xs shadow-[0_8px_18px_rgba(177,90,88,0.22)]"
            >
              <StopCircle className="mr-1 h-4 w-4" />
              {t('sessionDetail.stop')}
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={generateDisabled}
              onClick={() => void generate()}
              className="h-8 shrink-0 whitespace-nowrap px-3 text-xs"
            >
              {isGeneratingImage && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              <Sparkles className="mr-1 h-4 w-4" />
              {t('sessionDetail.generateImage')}
            </Button>
          )}
        </div>
      </div>
      <Dialog open={Boolean(previewAsset)} onOpenChange={(open) => !open && setPreviewAsset(null)}>
        <DialogContent className="w-[min(96vw,1080px)] max-w-none gap-3 border-[#d8cfbc]/80 bg-[#171b14] p-3 text-[#fffaf1] shadow-[0_28px_90px_rgba(12,15,10,0.42)] sm:p-4">
          <DialogHeader className="pr-10">
            <DialogTitle className="truncate text-sm text-[#fffaf1]">
              {previewAsset?.fileName || t('sessionDetail.imagePreviewTitle')}
            </DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[76vh] min-h-[260px] items-center justify-center overflow-hidden rounded-lg bg-[#0d100b]">
            {previewAsset?.absolutePath && (
              <img
                src={localAssetSrc(previewAsset.absolutePath)}
                alt={previewAsset.fileName}
                className="max-h-[76vh] max-w-full object-contain"
              />
            )}
          </div>
          {previewAsset && (
            <div className="flex justify-end">
              <div className="flex gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-8 bg-[#fffaf1] p-0 text-[#34402c] hover:bg-[#efe5d5]"
                      disabled={!selectedPageExists}
                      onClick={() => void addToCanvas(previewAsset)}
                      aria-label={t('sessionDetail.addImageToCanvas')}
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('sessionDetail.addImageToCanvas')}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-8 w-8 bg-[#fffaf1] p-0 text-[#34402c] hover:bg-[#efe5d5]"
                      disabled={!selectedPageExists}
                      onClick={() => void setAsBackground(previewAsset)}
                      aria-label={t('sessionDetail.setImageAsBackground')}
                    >
                      <Wallpaper className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('sessionDetail.setImageAsBackground')}</TooltipContent>
                </Tooltip>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-8 bg-[#fffaf1] px-2.5 text-xs text-[#34402c] hover:bg-[#efe5d5]"
                  onClick={() => void revealFile(previewAsset.absolutePath)}
                >
                  <FolderOpen className="mr-1 h-3.5 w-3.5" />
                  {t('sessionDetail.revealFile')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
