import { describe, expect, it } from 'vitest'
import { mapGenerateChunkToExternalEvent } from '../../../src/main/external-agent/event-map'

describe('external agent event map', () => {
  it('maps run_completed without failed pages to completed', () => {
    const mapped = mapGenerateChunkToExternalEvent({
      type: 'run_completed',
      payload: { runId: 'run-1', totalPages: 1 }
    })
    expect(mapped?.type).toBe('completed')
    expect(mapped?.progress).toBe(100)
  })
})
