import { describe, expect, it } from 'vitest'
import { createGenerationNotificationToast } from '../../../src/renderer/src/hooks/generationNotificationToast'

const t = (key: string, params?: Record<string, string | number>): string => {
  if (key === 'generationNotifications.completed') return `"${params?.title}" generation completed`
  if (key === 'generationNotifications.partial') {
    return `"${params?.title}" completed with ${params?.count} failed page(s)`
  }
  if (key === 'generationNotifications.failed') return `"${params?.title}" generation failed`
  return key
}

const action = {
  label: 'View',
  onClick: () => {}
}

describe('generation notification toast', () => {
  it('summarizes failed jobs without showing the raw failure message', () => {
    const toast = createGenerationNotificationToast({
      event: {
        type: 'run_error',
        payload: {
          message: 'A very long model stack trace and job failure payload'
        }
      },
      title: 'Quarterly Review',
      action,
      t
    })

    expect(toast).toEqual({
      type: 'error',
      message: '"Quarterly Review" generation failed',
      options: {
        action,
        duration: 8000
      }
    })
    expect(toast.options.description).toBeUndefined()
  })

  it('keeps completed and partial completion notifications informative', () => {
    expect(
      createGenerationNotificationToast({
        event: {
          type: 'run_completed',
          payload: {
            failedPageCount: 2
          }
        },
        title: 'Quarterly Review',
        action,
        t
      })
    ).toMatchObject({
      type: 'warning',
      message: '"Quarterly Review" completed with 2 failed page(s)'
    })

    expect(
      createGenerationNotificationToast({
        event: {
          type: 'run_completed',
          payload: {
            failedPageCount: 0
          }
        },
        title: 'Quarterly Review',
        action,
        t
      })
    ).toMatchObject({
      type: 'success',
      message: '"Quarterly Review" generation completed'
    })
  })
})
