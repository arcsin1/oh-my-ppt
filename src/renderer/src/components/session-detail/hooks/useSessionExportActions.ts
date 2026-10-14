import { useMemo } from 'react'
import { ipc } from '@renderer/lib/ipc'
import {
  useGenerateStore,
  useSessionDetailUiStore,
  useSessionStore,
  useToastStore
} from '@renderer/store'
import { useT } from '@renderer/i18n'
import { normalizePagesForSelection } from '../shared/pageUtils'
import { startExportProgressToast } from './exportProgressToast'
import type { ExportKind, ExportProgressPayload } from '@shared/export-progress.js'
import { isDefaultSlideSize, trySessionSlideSize } from '@shared/slide-size'

type PptxExportOptions = {
  imageOnly?: boolean
  embedFonts?: boolean | 'auto' | 'always' | 'never'
  pageId?: string
}

type VideoExportOptions = {
  pageId?: string
}

type ExportProgressToastController = ReturnType<typeof startExportProgressToast>

function getPptxExportNotice(
  warnings: string[] | undefined,
  t: ReturnType<typeof useT>
): string | null {
  const items = (warnings || []).filter(Boolean)
  if (items.length === 0) return null

  const hasPageLoadDelay = items.some((item) => item.includes('未收到打印就绪信号'))
  if (hasPageLoadDelay) return t('sessionDetail.pageLoadNotice')

  const hasNoEditableText = items.some((item) => item.includes('未提取到可编辑文本'))
  if (hasNoEditableText) return t('sessionDetail.noEditableTextNotice')

  const hasOnlyCapabilityNote = items.every(
    (item) =>
      item.includes('自研') ||
      item.includes('pptxgenjs') ||
      item.includes('HTML 解析器') ||
      item.includes('文本层')
  )
  if (hasOnlyCapabilityNote) return null

  return t('sessionDetail.exportCheckNotice')
}

export function useSessionExportActions(sessionId: string): {
  exportPdf: () => Promise<void>
  exportPng: () => Promise<void>
  exportLongImage: () => Promise<void>
  exportVideo: (options?: VideoExportOptions) => Promise<void>
  exportPptx: (options?: PptxExportOptions) => Promise<void>
  canExportPptx: boolean
  exportSlidePack: () => Promise<void>
  exportSessionZip: () => Promise<void>
  exportOutlinesMarkdown: () => Promise<void>
  openProjectPreview: () => Promise<void>
  revealSelectedPageFile: () => Promise<void>
  openPresentation: () => Promise<void>
} {
  const t = useT()
  const {
    success: toastSuccess,
    error: toastError,
    info: toastInfo,
    loading: toastLoading
  } = useToastStore()
  const progressToastApi = useMemo(
    () => ({
      loading: toastLoading,
      success: toastSuccess,
      info: toastInfo,
      error: toastError
    }),
    [toastError, toastInfo, toastLoading, toastSuccess]
  )
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const currentPages = useGenerateStore((state) => state.currentPages)
  const currentSession = useSessionStore((state) => state.currentSession)
  const slideSize = trySessionSlideSize(currentSession)
  const canExportPptx = slideSize ? isDefaultSlideSize(slideSize) : false

  const pages = useMemo(() => normalizePagesForSelection(currentPages), [currentPages])
  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  )

  const describeExportProgress = (
    payload: ExportProgressPayload,
    fallbackDescription: string
  ): string => {
    if (
      payload.stage === 'rendering' &&
      typeof payload.current === 'number' &&
      typeof payload.total === 'number' &&
      payload.total > 0
    ) {
      return t('sessionDetail.exportProgressRendering', {
        current: payload.current,
        total: payload.total
      })
    }
    if (payload.stage === 'preparing') return t('sessionDetail.exportProgressPreparing')
    if (payload.stage === 'packaging') return t('sessionDetail.exportProgressPackaging')
    if (payload.stage === 'writing') return t('sessionDetail.exportProgressWriting')
    return fallbackDescription
  }

  const createExportProgressToast = ({
    kind,
    title,
    description
  }: {
    kind: ExportKind
    title: string
    description: string
  }): {
    success: (
      message: string,
      options?: Parameters<ExportProgressToastController['success']>[1]
    ) => void
    cancel: (message: string) => void
    error: (message: string) => void
    dispose: () => void
  } => {
    let progressToast: ExportProgressToastController | null = null
    let closed = false
    const unsubscribe = ipc.onExportProgress((payload) => {
      if (payload.sessionId !== sessionId || payload.kind !== kind) return
      const progressDescription = describeExportProgress(payload, description)
      if (!progressToast) {
        progressToast = startExportProgressToast({
          toast: progressToastApi,
          title,
          description: progressDescription,
          initialProgress: payload.progress
        })
        return
      }
      progressToast.update({
        progress: payload.progress,
        description: progressDescription
      })
    })

    const close = (): void => {
      if (closed) return
      closed = true
      unsubscribe()
    }

    return {
      success: (message, options) => {
        close()
        if (progressToast) {
          progressToast.success(message, options)
          return
        }
        toastSuccess(message, options)
      },
      cancel: (message) => {
        close()
        if (progressToast) {
          progressToast.cancel(message)
          return
        }
        toastInfo(message)
      },
      error: (message) => {
        close()
        if (progressToast) {
          progressToast.error(message)
          return
        }
        toastError(message)
      },
      dispose: () => {
        close()
        progressToast?.dispose()
      }
    }
  }

  const exportPdf = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingPdf) return
    detailState.setIsExportingPdf(true)
    const progressToast = createExportProgressToast({
      kind: 'pdf',
      title: t('sessionDetail.exportPdfStart'),
      description: t('sessionDetail.exportPdfDescription')
    })
    try {
      const result = await ipc.exportPdf(sessionId)
      if (result.cancelled) {
        progressToast.cancel(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        progressToast.error(t('sessionDetail.exportFailed'))
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        progressToast.success(
          t('sessionDetail.exportSuccessPages', { count: result.pageCount || 0 }),
          {
            description: result.warnings[0]
          }
        )
        return
      }
      progressToast.success(t('sessionDetail.exportSuccessPages', { count: result.pageCount || 0 }))
    } catch (error) {
      progressToast.error(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      progressToast.dispose()
      useSessionDetailUiStore.getState().setIsExportingPdf(false)
    }
  }

  const exportPng = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingPng) return
    detailState.setIsExportingPng(true)
    const progressToast = createExportProgressToast({
      kind: 'png',
      title: t('sessionDetail.exportPngStart'),
      description: t('sessionDetail.exportPngDescription')
    })
    try {
      const result = await ipc.exportPng(sessionId)
      if (result.cancelled) {
        progressToast.cancel(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        progressToast.error(t('sessionDetail.exportFailed'))
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        progressToast.success(t('sessionDetail.pngExported', { count: result.pageCount || 0 }), {
          description: t('sessionDetail.pageLoadNotice')
        })
        return
      }
      progressToast.success(t('sessionDetail.pngExported', { count: result.pageCount || 0 }))
    } catch (error) {
      progressToast.error(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      progressToast.dispose()
      useSessionDetailUiStore.getState().setIsExportingPng(false)
    }
  }

  const exportLongImage = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingLongImage) return
    detailState.setIsExportingLongImage(true)
    const progressToast = createExportProgressToast({
      kind: 'longImage',
      title: t('sessionDetail.exportLongImageStart'),
      description: t('sessionDetail.exportLongImageDescription')
    })
    try {
      const result = await ipc.exportLongImage(sessionId)
      if (result.cancelled) {
        progressToast.cancel(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        progressToast.error(t('sessionDetail.exportFailed'))
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        progressToast.success(
          t('sessionDetail.longImageExported', { count: result.pageCount || 0 }),
          {
            description: t('sessionDetail.pageLoadNotice')
          }
        )
        return
      }
      progressToast.success(t('sessionDetail.longImageExported', { count: result.pageCount || 0 }))
    } catch (error) {
      progressToast.error(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      progressToast.dispose()
      useSessionDetailUiStore.getState().setIsExportingLongImage(false)
    }
  }

  const exportVideo = async (options?: VideoExportOptions): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingVideo) return
    detailState.setIsExportingVideo(true)
    const progressToast = createExportProgressToast({
      kind: 'video',
      title: t('sessionDetail.exportVideoStart'),
      description: t('sessionDetail.exportVideoDescription')
    })
    try {
      const result = await ipc.exportVideo(sessionId, options)
      if (result.cancelled) {
        progressToast.cancel(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        progressToast.error(t('sessionDetail.exportFailed'))
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        progressToast.success(t('sessionDetail.videoExported', { count: result.pageCount || 0 }), {
          description: result.warnings[0]
        })
        return
      }
      progressToast.success(t('sessionDetail.videoExported', { count: result.pageCount || 0 }))
    } catch (error) {
      progressToast.error(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      progressToast.dispose()
      useSessionDetailUiStore.getState().setIsExportingVideo(false)
    }
  }

  const exportPptx = async (options?: PptxExportOptions): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingPptx) return
    if (!canExportPptx) {
      toastError('当前 PPTX 导出仅支持 16:9。请导出 PNG、PDF 或视频。')
      return
    }
    const imageOnly = options?.imageOnly === true
    detailState.setIsExportingPptx(true)
    const progressToast = createExportProgressToast({
      kind: 'pptx',
      title: t(
        imageOnly ? 'sessionDetail.pptxPreparingImage' : 'sessionDetail.pptxPreparingEditable'
      ),
      description: t(
        imageOnly
          ? 'sessionDetail.pptxPreparingImageDescription'
          : 'sessionDetail.pptxPreparingEditableDescription'
      )
    })
    try {
      const result = await ipc.exportPptx(sessionId, options)
      if (result.cancelled) {
        progressToast.cancel(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        progressToast.error(t('sessionDetail.exportFailed'))
        return
      }
      const exportNotice = getPptxExportNotice(result.warnings, t)
      if (exportNotice) {
        progressToast.success(t('sessionDetail.pptxExported', { count: result.pageCount || 0 }), {
          description: exportNotice
        })
        return
      }
      progressToast.success(t('sessionDetail.pptxExported', { count: result.pageCount || 0 }), {
        description: t(
          imageOnly ? 'sessionDetail.pptxImageDescription' : 'sessionDetail.pptxEditableDescription'
        )
      })
    } catch (error) {
      progressToast.error(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      progressToast.dispose()
      useSessionDetailUiStore.getState().setIsExportingPptx(false)
    }
  }

  const exportSlidePack = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingSlidePack) return
    detailState.setIsExportingSlidePack(true)
    const progressToast = createExportProgressToast({
      kind: 'slidePack',
      title: t('sessionDetail.slidePackPreparing'),
      description: t('sessionDetail.slidePackPreparingDescription')
    })
    try {
      const result = await ipc.exportSlidePack(sessionId)
      if (result.cancelled) {
        progressToast.cancel(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        progressToast.error(t('sessionDetail.exportFailed'))
        return
      }
      progressToast.success(t('sessionDetail.slidePackExported'), {
        description: t('sessionDetail.slidePackExportedDescription')
      })
    } catch (error) {
      progressToast.error(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      progressToast.dispose()
      useSessionDetailUiStore.getState().setIsExportingSlidePack(false)
    }
  }

  const exportSessionZip = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingSessionZip) return
    detailState.setIsExportingSessionZip(true)
    const progressToast = createExportProgressToast({
      kind: 'sessionZip',
      title: t('sessionDetail.sessionZipPreparing'),
      description: t('sessionDetail.sessionZipPreparingDescription')
    })
    try {
      const result = await ipc.exportSessionZip(sessionId)
      if (result.cancelled) {
        progressToast.cancel(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        progressToast.error(t('sessionDetail.exportFailed'))
        return
      }
      progressToast.success(t('sessionDetail.sessionZipExported'), {
        description: t('sessionDetail.sessionZipExportedDescription')
      })
    } catch (error) {
      progressToast.error(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      progressToast.dispose()
      useSessionDetailUiStore.getState().setIsExportingSessionZip(false)
    }
  }

  const exportOutlinesMarkdown = async (): Promise<void> => {
    if (!sessionId) return
    try {
      const result = await ipc.exportOutlinesMarkdown(sessionId)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      toastSuccess(t('sessionDetail.outlinesExported'))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    }
  }

  const openProjectPreview = async (): Promise<void> => {
    const basePath = selectedPage?.htmlPath || pages[0]?.htmlPath
    if (!basePath) return
    const indexPath = basePath.replace(/[^/\\]+\.html$/i, 'index.html')
    const pageHash = selectedPage?.id || pages[0]?.id
    await ipc.openInBrowser(
      indexPath,
      pageHash ? `#${pageHash}` : undefined,
      sessionId || undefined
    )
  }

  const revealSelectedPageFile = async (): Promise<void> => {
    if (!selectedPage?.htmlPath) return
    await ipc.revealFile(selectedPage.htmlPath, sessionId || undefined)
  }

  const openPresentation = async (): Promise<void> => {
    const idx = pages.findIndex((page) => page.id === selectedPageId)
    await ipc.openPresentation({
      sessionId,
      startIndex: idx >= 0 ? idx : 0
    })
  }

  return {
    exportPdf,
    exportPng,
    exportLongImage,
    exportVideo,
    exportPptx,
    canExportPptx,
    exportSlidePack,
    exportSessionZip,
    exportOutlinesMarkdown,
    openProjectPreview,
    revealSelectedPageFile,
    openPresentation
  }
}
