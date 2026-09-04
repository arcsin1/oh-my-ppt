import crypto from 'crypto'
import { JobCoordinator, sessionLockKey } from '../agent-runtime'

export const withImageFulfillmentRetryLock = async <T>(
  coordinator: JobCoordinator,
  sessionId: string,
  sourceJobId: string,
  operation: () => Promise<T>
): Promise<T> => {
  const reservation = await coordinator.reserve({
    jobId: `image-retry:${sourceJobId}:${crypto.randomUUID()}`,
    domain: 'image',
    owner: { kind: 'image-fulfillment', id: `retry:${sourceJobId}` },
    claims: { write: [sessionLockKey(sessionId)] },
    wait: 'fail'
  })
  if (reservation.status === 'busy') {
    throw new Error('The session is busy with another generation or edit. Please try again later.')
  }

  try {
    return await operation()
  } finally {
    reservation.lease.release()
  }
}
