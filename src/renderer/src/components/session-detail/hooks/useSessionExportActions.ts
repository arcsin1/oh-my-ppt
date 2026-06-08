import { useMemo } from 'react'
import { ipc } from '@renderer/lib/ipc'
import { useGenerateStore, useSessionDetailUiStore, useToastStore } from '@renderer/store'
import { useT } from '@renderer/i18n'
import { normalizePagesForSelection } from '../shared/pageUtils'

type PptxExportOptions = {
  imageOnly?: boolean
  embedFonts?: boolean | 'auto' | 'always' | 'never'
  pageId?: string
}

type VideoExportOptions = {
  pageId?: string
}

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
  exportVideo: (options?: VideoExportOptions) => Promise<void>
  exportPptx: (options?: PptxExportOptions) => Promise<void>
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
    info: toastInfo
  } = useToastStore()
  const selectedPageId = useSessionDetailUiStore((state) => state.selectedPageId)
  const currentPages = useGenerateStore((state) => state.currentPages)

  const pages = useMemo(() => normalizePagesForSelection(currentPages), [currentPages])
  const selectedPage = useMemo(
    () => pages.find((page) => page.id === selectedPageId) ?? pages[0] ?? null,
    [pages, selectedPageId]
  )

  const exportPdf = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingPdf) return
    detailState.setIsExportingPdf(true)
    toastInfo(t('sessionDetail.exportPdfStart'), {
      description: t('sessionDetail.exportPdfDescription'),
      duration: 4000
    })
    try {
      const result = await ipc.exportPdf(sessionId)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toastSuccess(t('sessionDetail.exportSuccessPages', { count: result.pageCount || 0 }), {
          description: result.warnings[0]
        })
        return
      }
      toastSuccess(t('sessionDetail.exportSuccessPages', { count: result.pageCount || 0 }))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingPdf(false)
    }
  }

  const exportPng = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingPng) return
    detailState.setIsExportingPng(true)
    toastInfo(t('sessionDetail.exportPngStart'), {
      description: t('sessionDetail.exportPngDescription'),
      duration: 4000
    })
    try {
      const result = await ipc.exportPng(sessionId)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toastSuccess(t('sessionDetail.pngExported', { count: result.pageCount || 0 }), {
          description: t('sessionDetail.pageLoadNotice')
        })
        return
      }
      toastSuccess(t('sessionDetail.pngExported', { count: result.pageCount || 0 }))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingPng(false)
    }
  }

  const exportVideo = async (options?: VideoExportOptions): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingVideo) return
    detailState.setIsExportingVideo(true)
    toastInfo(t('sessionDetail.exportVideoStart'), {
      description: t('sessionDetail.exportVideoDescription'),
      duration: 5000
    })
    try {
      const result = await ipc.exportVideo(sessionId, options)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      if (Array.isArray(result.warnings) && result.warnings.length > 0) {
        toastSuccess(t('sessionDetail.videoExported', { count: result.pageCount || 0 }), {
          description: result.warnings[0]
        })
        return
      }
      toastSuccess(t('sessionDetail.videoExported', { count: result.pageCount || 0 }))
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingVideo(false)
    }
  }

  const exportPptx = async (options?: PptxExportOptions): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingPptx) return
    const imageOnly = options?.imageOnly === true
    detailState.setIsExportingPptx(true)
    toastInfo(
      t(imageOnly ? 'sessionDetail.pptxPreparingImage' : 'sessionDetail.pptxPreparingEditable'),
      {
        description: t(
          imageOnly
            ? 'sessionDetail.pptxPreparingImageDescription'
            : 'sessionDetail.pptxPreparingEditableDescription'
        ),
        duration: 4000
      }
    )
    try {
      const result = await ipc.exportPptx(sessionId, options)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      const exportNotice = getPptxExportNotice(result.warnings, t)
      if (exportNotice) {
        toastSuccess(t('sessionDetail.pptxExported', { count: result.pageCount || 0 }), {
          description: exportNotice
        })
        return
      }
      toastSuccess(t('sessionDetail.pptxExported', { count: result.pageCount || 0 }), {
        description: t(
          imageOnly ? 'sessionDetail.pptxImageDescription' : 'sessionDetail.pptxEditableDescription'
        )
      })
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingPptx(false)
    }
  }

  const exportSlidePack = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingSlidePack) return
    detailState.setIsExportingSlidePack(true)
    toastInfo(t('sessionDetail.slidePackPreparing'), {
      description: t('sessionDetail.slidePackPreparingDescription'),
      duration: 4000
    })
    try {
      const result = await ipc.exportSlidePack(sessionId)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      toastSuccess(t('sessionDetail.slidePackExported'), {
        description: t('sessionDetail.slidePackExportedDescription')
      })
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
      useSessionDetailUiStore.getState().setIsExportingSlidePack(false)
    }
  }

  const exportSessionZip = async (): Promise<void> => {
    const detailState = useSessionDetailUiStore.getState()
    if (!sessionId || detailState.isExportingSessionZip) return
    detailState.setIsExportingSessionZip(true)
    toastInfo(t('sessionDetail.sessionZipPreparing'), {
      description: t('sessionDetail.sessionZipPreparingDescription'),
      duration: 4000
    })
    try {
      const result = await ipc.exportSessionZip(sessionId)
      if (result.cancelled) {
        toastInfo(t('sessionDetail.exportCancelled'))
        return
      }
      if (!result.success || !result.path) {
        toastError(t('sessionDetail.exportFailed'))
        return
      }
      toastSuccess(t('sessionDetail.sessionZipExported'), {
        description: t('sessionDetail.sessionZipExportedDescription')
      })
    } catch (error) {
      toastError(error instanceof Error ? error.message : t('sessionDetail.exportFailed'))
    } finally {
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
    exportVideo,
    exportPptx,
    exportSlidePack,
    exportSessionZip,
    exportOutlinesMarkdown,
    openProjectPreview,
    revealSelectedPageFile,
    openPresentation
  }
}
