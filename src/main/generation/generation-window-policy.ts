import type { BrowserWindow } from 'electron'
import type { GenerateChunkEvent } from '@shared/generation'

type GenerationWindowRunState = {
  runId: string
  mode:
    | 'generate'
    | 'edit'
    | 'retry'
    | 'addPage'
    | 'retrySinglePage'
    | 'style-switch'
}

export function shouldRevealGenerationWindow(
  event: GenerateChunkEvent,
  runState?: GenerationWindowRunState
): boolean {
  if (event.type !== 'run_completed' && event.type !== 'run_error') return false
  if (event.type === 'run_error' && event.payload.cancelled === true) return false

  if (runState) {
    if (runState.runId !== event.payload.runId) return false
    return runState.mode === 'generate' || runState.mode === 'retry'
  }

  return !event.payload.activityKind
}

export function revealGenerationWindow(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  if (!window.isVisible()) window.show()
  window.focus()
}
