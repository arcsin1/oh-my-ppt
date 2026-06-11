import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import type { GenerateChunkEvent } from '@shared/generation'
import { ipc } from '@renderer/lib/ipc'
import { useToastStore } from '@renderer/store'
import { useT } from '@renderer/i18n'
import { createGenerationNotificationToast } from './generationNotificationToast'

const MAX_NOTIFIED_RUNS = 200
const MAX_CACHED_TITLES = 100

const addBoundedEntry = <T>(map: Map<string, T>, key: string, value: T, limit: number): void => {
  map.delete(key)
  map.set(key, value)
  while (map.size > limit) {
    const oldestKey = map.keys().next().value
    if (typeof oldestKey !== 'string') break
    map.delete(oldestKey)
  }
}

export function useGenerationNotifications(): void {
  const navigate = useNavigate()
  const t = useT()
  const notifiedKeysRef = useRef(new Map<string, true>())
  const sessionTitlesRef = useRef(new Map<string, string>())

  useEffect(() => {
    const readSessionTitle = async (sessionId: string): Promise<string> => {
      const cached = sessionTitlesRef.current.get(sessionId)
      if (cached) return cached
      try {
        const { session } = await ipc.getSession(sessionId)
        const title =
          session && typeof session === 'object' && 'title' in session
            ? String((session as { title?: unknown }).title || '').trim()
            : ''
        const resolvedTitle = title || t('generationNotifications.untitled')
        addBoundedEntry(sessionTitlesRef.current, sessionId, resolvedTitle, MAX_CACHED_TITLES)
        return resolvedTitle
      } catch {
        return t('generationNotifications.untitled')
      }
    }

    const notify = async (event: GenerateChunkEvent): Promise<void> => {
      const sessionId = event.payload.sessionId
      if (!sessionId) return

      const isCompleted = event.type === 'run_completed'
      const isFailed = event.type === 'run_error'
      if (!isCompleted && !isFailed) return
      if (isFailed && event.payload.cancelled === true) return

      const notificationType = isCompleted ? 'completed' : 'failed'
      const notificationKey = `${event.payload.runId}:${notificationType}`
      if (notifiedKeysRef.current.has(notificationKey)) return
      addBoundedEntry(notifiedKeysRef.current, notificationKey, true, MAX_NOTIFIED_RUNS)

      const title = await readSessionTitle(sessionId)
      const action = {
        label: t('generationNotifications.view'),
        onClick: () => navigate(`/sessions/${sessionId}`)
      }

      const toast = createGenerationNotificationToast({
        event,
        title,
        action,
        t
      })
      useToastStore.getState()[toast.type](toast.message, toast.options)
    }

    const unsubscribe = ipc.onGenerateChunk((event) => {
      void notify(event).catch((error) => {
        console.warn(
          '[generation-notification] failed',
          error instanceof Error ? error.message : String(error)
        )
      })
    })
    return () => unsubscribe?.()
  }, [navigate, t])
}
