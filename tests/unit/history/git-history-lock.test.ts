import { describe, expect, it } from 'vitest'
import { withHistoryProjectLock } from '../../../src/main/history/git-history-service'

describe('git history project lock', () => {
  it('serializes concurrent repository initialization for the same project', async () => {
    let releaseFirst!: () => void
    let markFirstStarted!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve
    })
    const order: string[] = []

    const first = withHistoryProjectLock('/tmp/anjian-history-lock', async () => {
      order.push('first:start')
      markFirstStarted()
      await firstGate
      order.push('first:end')
    })
    const second = withHistoryProjectLock('/tmp/anjian-history-lock', async () => {
      order.push('second:start')
      order.push('second:end')
    })

    await firstStarted
    expect(order).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })
})
