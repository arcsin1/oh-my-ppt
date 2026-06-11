import type { ReactNode } from 'react'
import type { ToastId } from '../../../store/toastStore'

type ExportProgressToastOptions = {
  id?: ToastId
  description?: ReactNode
  duration?: number
}

type ExportProgressToastApi = {
  loading: (message: ReactNode, options?: ExportProgressToastOptions) => ToastId
  success: (message: ReactNode, options?: ExportProgressToastOptions) => ToastId
  info: (message: ReactNode, options?: ExportProgressToastOptions) => ToastId
  error: (message: ReactNode, options?: ExportProgressToastOptions) => ToastId
}

export const EXPORT_PROGRESS_TOAST_DURATION_MS = 60 * 60 * 1000

export function clampExportProgress(progress: number): number {
  return Math.max(0, Math.min(100, Math.round(progress)))
}

function ExportProgressDescription({
  description,
  progress
}: {
  description: ReactNode
  progress: number
}): React.JSX.Element {
  return (
    <div className="mt-1 flex w-[260px] max-w-full flex-col gap-2">
      <div className="text-[12px] leading-snug text-muted-foreground">{description}</div>
      <div className="flex items-center gap-2">
        <div className="soft-inset h-2 flex-1 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
          />
        </div>
        <span className="w-9 text-right text-[11px] tabular-nums text-primary">{progress}%</span>
      </div>
    </div>
  )
}

export function startExportProgressToast({
  toast,
  title,
  description,
  initialProgress = 8
}: {
  toast: ExportProgressToastApi
  title: string
  description: ReactNode
  initialProgress?: number
}): {
  success: (message: string, options?: ExportProgressToastOptions) => void
  cancel: (message: string) => void
  error: (message: string) => void
  update: (payload: { progress: number; description?: ReactNode }) => void
  dispose: () => void
} {
  let finished = false
  let progress = clampExportProgress(initialProgress)
  let currentDescription = description

  const renderDescription = (): React.JSX.Element => (
    <ExportProgressDescription description={currentDescription} progress={progress} />
  )

  const toastId = toast.loading(title, {
    description: renderDescription(),
    duration: EXPORT_PROGRESS_TOAST_DURATION_MS
  })

  const stop = (): void => {
    if (finished) return
    finished = true
  }

  const terminalOptions = (options?: ExportProgressToastOptions): ExportProgressToastOptions => ({
    ...options,
    id: toastId,
    description: options?.description ?? null
  })

  return {
    success: (message, options) => {
      stop()
      toast.success(message, terminalOptions(options))
    },
    cancel: (message) => {
      stop()
      toast.info(message, terminalOptions({ duration: 3000 }))
    },
    error: (message) => {
      stop()
      toast.error(message, terminalOptions({ duration: 6000 }))
    },
    update: (payload) => {
      if (finished) return
      progress = clampExportProgress(payload.progress)
      currentDescription = payload.description ?? description
      toast.loading(title, {
        id: toastId,
        description: renderDescription(),
        duration: EXPORT_PROGRESS_TOAST_DURATION_MS
      })
    },
    dispose: stop
  }
}
