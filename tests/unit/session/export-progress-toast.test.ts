import { describe, expect, it, vi } from 'vitest'
import {
  clampExportProgress,
  startExportProgressToast
} from '../../../src/renderer/src/components/session-detail/hooks/exportProgressToast'

function createToastApi() {
  return {
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(() => 'toast-id'),
    info: vi.fn(() => 'toast-id'),
    error: vi.fn(() => 'toast-id')
  }
}

describe('export progress toast', () => {
  it('clamps progress to a displayable percent', () => {
    expect(clampExportProgress(-1)).toBe(0)
    expect(clampExportProgress(48.6)).toBe(49)
    expect(clampExportProgress(200)).toBe(100)
  })

  it('updates the same loading toast only when real progress arrives', () => {
    const toast = createToastApi()
    const progressToast = startExportProgressToast({
      toast,
      title: 'Exporting PDF',
      description: 'Please wait',
      initialProgress: 8
    })

    expect(toast.loading).toHaveBeenCalledTimes(1)

    progressToast.update({
      progress: 42,
      description: 'Processing page 2/5'
    })

    expect(toast.loading).toHaveBeenCalledTimes(2)
    expect(toast.loading.mock.calls[1][1]).toMatchObject({
      id: 'toast-id'
    })

    progressToast.success('Done', { description: 'Saved' })

    expect(toast.success).toHaveBeenCalledWith('Done', {
      id: 'toast-id',
      description: 'Saved'
    })
    expect(toast.loading).toHaveBeenCalledTimes(2)
  })

  it('stops progress updates after cancel or failure', () => {
    const cancelledToast = createToastApi()
    const cancelledProgressToast = startExportProgressToast({
      toast: cancelledToast,
      title: 'Exporting',
      description: 'Please wait'
    })

    cancelledProgressToast.cancel('Cancelled')
    cancelledProgressToast.update({ progress: 60 })

    expect(cancelledToast.info).toHaveBeenCalledWith('Cancelled', {
      id: 'toast-id',
      description: null,
      duration: 3000
    })
    expect(cancelledToast.loading).toHaveBeenCalledTimes(1)

    const failedToast = createToastApi()
    const failedProgressToast = startExportProgressToast({
      toast: failedToast,
      title: 'Exporting',
      description: 'Please wait'
    })

    failedProgressToast.error('Failed')
    failedProgressToast.update({ progress: 80 })

    expect(failedToast.error).toHaveBeenCalledWith('Failed', {
      id: 'toast-id',
      description: null,
      duration: 6000
    })
    expect(failedToast.loading).toHaveBeenCalledTimes(1)
  })
})
