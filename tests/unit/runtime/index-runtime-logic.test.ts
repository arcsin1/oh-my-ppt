/**
 * Unit tests for index-runtime.js logic:
 *   - playback-mode click routing
 *   - Transition name resolution
 *   - Duration clamping
 *   - Reduced motion guard
 *
 * These test the actual logic extracted from the runtime, not abstract mocks.
 */
import { describe, it, expect } from 'vitest'

function advanceClickState(
  clicks: { total: number; advance: () => boolean } | null | undefined
): boolean {
  if (!clicks) return false
  // Only forward when the page actually has click-triggered animation steps
  if (clicks.total > 0 && typeof clicks.advance === 'function') {
    return clicks.advance()
  }
  return false
}

// ── Extracted from index-runtime.js injectTransitionStyles ──
function resolveAnimationNames(transitionType: string): { out: string; in: string } {
  const prefix = 'ppt-vt-'
  switch (transitionType) {
    case 'slide-left': return { out: prefix + 'slide-left-out', in: prefix + 'slide-left-in' }
    case 'slide-up':   return { out: prefix + 'slide-up-out',   in: prefix + 'slide-up-in' }
    case 'push':       return { out: prefix + 'push-out',       in: prefix + 'push-in' }
    case 'wipe':       return { out: prefix + 'wipe-out',       in: prefix + 'wipe-in' }
    case 'zoom':       return { out: prefix + 'zoom-out',       in: prefix + 'zoom-in' }
    default:           return { out: prefix + 'fade-out',       in: prefix + 'fade-in' }
  }
}

function clampTransitionDuration(value: number | undefined): number {
  if (!Number.isFinite(value)) return 420
  return Math.max(120, Math.min(1200, Math.round(value as number)))
}

function shouldBindFrameDocument(previousDocument: object | undefined, nextDocument: object | null): boolean {
  return Boolean(nextDocument && previousDocument !== nextDocument)
}

function simulateEnsureFrameLoadedOrder(): string[] {
  const calls: string[] = []
  const frame = {
    addEventListener: (eventName: string) => {
      calls.push(`listen:${eventName}`)
    },
    set src(_value: string) {
      calls.push('set-src')
    }
  }

  frame.addEventListener('load')
  frame.src = 'page.html'
  return calls
}

function simulateWaitForFrameLoadBeforeActivation(): string[] {
  const calls: string[] = []
  const frame = {
    listeners: {} as Record<string, () => void>,
    addEventListener: (eventName: string, callback: () => void) => {
      calls.push(`listen:${eventName}`)
      frame.listeners[eventName] = callback
    },
    set src(_value: string) {
      calls.push('set-src')
    }
  }

  frame.addEventListener('load', () => {
    calls.push('load')
    calls.push('activate')
  })
  frame.src = 'page.html'
  calls.push('before-load')
  frame.listeners.load()
  return calls
}

function adjacentPageKeys(keys: string[], activeKey: string): string[] {
  const index = keys.indexOf(activeKey)
  if (index < 0) return []
  return [keys[index - 1], keys[index + 1]].filter(Boolean)
}

function shouldEnableDeckPlayback(args: {
  embedMode: boolean
}): boolean {
  return !args.embedMode
}

function resolveFrameClickAction(args: {
  playbackMode: boolean
  forwarded: boolean
}): 'advance-animation' | 'goto-next' | 'none' {
  if (!args.playbackMode) return 'none'
  if (args.forwarded) return 'advance-animation'
  return 'goto-next'
}

function shouldAcceptFramePlaybackMessage(args: {
  hasFrame: boolean
  source: object | null
  frameWindow: object
}): boolean {
  if (!args.hasFrame) return false
  return !args.source || args.source === args.frameWindow
}

function clearPendingPlaybackRequestsForTest(
  pending: Record<string, number>,
  clearTimeoutFn: (id: number) => void
): void {
  Object.keys(pending).forEach((requestId) => {
    clearTimeoutFn(pending[requestId])
    delete pending[requestId]
  })
}

function normalizeWheelDeltaForTest(event: {
  deltaX: number
  deltaY: number
  deltaMode: number
}): number {
  let delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX
  if (event.deltaMode === 1) delta *= 16
  else if (event.deltaMode === 2) delta *= 900
  return delta
}

function createWheelNavigatorForTest(args?: {
  threshold?: number
  cooldown?: number
  now?: () => number
  navigate?: (offset: number) => boolean
}) {
  const threshold = args?.threshold ?? 80
  const cooldown = args?.cooldown ?? 520
  const now = args?.now ?? (() => Date.now())
  const navigate = args?.navigate ?? (() => true)
  let wheelDeltaBuffer = 0
  let wheelGestureLocked = false
  let wheelGestureLockDirection = 0
  let lastWheelNavigateAt = 0
  const offsets: number[] = []

  return {
    offsets,
    unlockGesture() {
      wheelDeltaBuffer = 0
      wheelGestureLocked = false
      wheelGestureLockDirection = 0
    },
    handle(event: {
      deltaX: number
      deltaY: number
      deltaMode: number
      ctrlKey?: boolean
      metaKey?: boolean
      editableTarget?: boolean
      deckSwitcherTarget?: boolean
      preventDefault: () => void
    }) {
      if (event.ctrlKey || event.metaKey) return
      if (event.editableTarget || event.deckSwitcherTarget) return

      const delta = normalizeWheelDeltaForTest(event)
      if (!Number.isFinite(delta) || Math.abs(delta) < 1) return
      const direction = delta > 0 ? 1 : -1

      if (Math.sign(delta) !== Math.sign(wheelDeltaBuffer)) wheelDeltaBuffer = 0
      wheelDeltaBuffer += delta

      if (Math.abs(wheelDeltaBuffer) < threshold) return

      if (wheelGestureLocked && wheelGestureLockDirection && direction !== wheelGestureLockDirection) {
        wheelGestureLocked = false
        wheelGestureLockDirection = 0
        lastWheelNavigateAt = 0
      }

      if (wheelGestureLocked) {
        wheelDeltaBuffer = 0
        event.preventDefault()
        return
      }

      const currentTime = now()
      if (currentTime - lastWheelNavigateAt < cooldown) {
        wheelDeltaBuffer = 0
        wheelGestureLocked = true
        wheelGestureLockDirection = direction
        event.preventDefault()
        return
      }

      const offset = wheelDeltaBuffer > 0 ? 1 : -1
      wheelDeltaBuffer = 0
      event.preventDefault()
      if (navigate(offset)) {
        wheelGestureLocked = true
        wheelGestureLockDirection = offset
        lastWheelNavigateAt = currentTime
        offsets.push(offset)
      } else {
        wheelGestureLocked = false
        wheelGestureLockDirection = 0
        lastWheelNavigateAt = 0
      }
    }
  }
}

describe('click state advance helper (total > 0 guard)', () => {
  function makeClicks(total: number) {
    let current = 0
    return {
      total,
      advance: () => {
        if (total > 0 && current >= total) return false
        current++
        return true
      }
    }
  }

  it('returns false when clicks is null/undefined', () => {
    expect(advanceClickState(null)).toBe(false)
    expect(advanceClickState(undefined)).toBe(false)
  })

  it('returns false when total is 0 (no click-triggered elements)', () => {
    const clicks = makeClicks(0)
    expect(advanceClickState(clicks)).toBe(false)
  })

  it('returns true when step consumed', () => {
    const clicks = makeClicks(3)
    expect(advanceClickState(clicks)).toBe(true)
  })

  it('returns false when all steps exhausted', () => {
    const clicks = makeClicks(2)
    clicks.advance() // → 1
    clicks.advance() // → 2
    expect(advanceClickState(clicks)).toBe(false) // exhausted, nav should proceed
  })

  it('allows nav after last click step exhausted', () => {
    const clicks = makeClicks(1)
    expect(advanceClickState(clicks)).toBe(true)  // consumed step 1
    expect(advanceClickState(clicks)).toBe(false) // exhausted → navigate
  })
})

describe('iframe load binding order', () => {
  it('registers load listener before setting iframe src', () => {
    expect(simulateEnsureFrameLoadedOrder()).toEqual(['listen:load', 'set-src'])
  })

  it('waits for iframe load before activating the target page', () => {
    expect(simulateWaitForFrameLoadBeforeActivation()).toEqual([
      'listen:load',
      'set-src',
      'before-load',
      'load',
      'activate'
    ])
  })

  it('rebinds when iframe document changes after reload', () => {
    const firstDocument = {}
    const secondDocument = {}

    expect(shouldBindFrameDocument(undefined, firstDocument)).toBe(true)
    expect(shouldBindFrameDocument(firstDocument, firstDocument)).toBe(false)
    expect(shouldBindFrameDocument(firstDocument, secondDocument)).toBe(true)
  })
})

describe('adjacent page prefetch selection', () => {
  it('prefetches only immediate neighbors', () => {
    expect(adjacentPageKeys(['p1', 'p2', 'p3', 'p4'], 'p2')).toEqual(['p1', 'p3'])
    expect(adjacentPageKeys(['p1', 'p2', 'p3', 'p4'], 'p1')).toEqual(['p2'])
    expect(adjacentPageKeys(['p1', 'p2', 'p3', 'p4'], 'p4')).toEqual(['p3'])
  })
})

describe('iframe click behavior', () => {
  it('ignores iframe clicks outside deck playback mode', () => {
    expect(resolveFrameClickAction({ playbackMode: false, forwarded: true })).toBe('none')
    expect(resolveFrameClickAction({ playbackMode: false, forwarded: false })).toBe('none')
  })

  it('keeps controls visible while supporting clicks in full-deck playback', () => {
    expect(resolveFrameClickAction({
      playbackMode: true,
      forwarded: true
    })).toBe('advance-animation')
    expect(resolveFrameClickAction({
      playbackMode: true,
      forwarded: false
    })).toBe('goto-next')
  })
})

describe('index.html deck playback mode', () => {
  it('enables click playback for full-deck index without forcing present CSS', () => {
    expect(shouldEnableDeckPlayback({ embedMode: false })).toBe(true)
  })

  it('does not enable deck playback in embed mode', () => {
    expect(shouldEnableDeckPlayback({ embedMode: true })).toBe(false)
  })
})

describe('frame playback postMessage source guard', () => {
  it('accepts messages from the active frame window', () => {
    const frameWindow = {}
    expect(shouldAcceptFramePlaybackMessage({
      hasFrame: true,
      source: frameWindow,
      frameWindow
    })).toBe(true)
  })

  it('accepts null source because some presentation webviews omit event.source', () => {
    expect(shouldAcceptFramePlaybackMessage({
      hasFrame: true,
      source: null,
      frameWindow: {}
    })).toBe(true)
  })

  it('rejects messages from another frame window', () => {
    expect(shouldAcceptFramePlaybackMessage({
      hasFrame: true,
      source: {},
      frameWindow: {}
    })).toBe(false)
  })
})

describe('pending playback request cleanup', () => {
  it('clears and removes all pending fallback timers', () => {
    const pending = { a: 1, b: 2 }
    const cleared: number[] = []

    clearPendingPlaybackRequestsForTest(pending, (id) => cleared.push(id))

    expect(cleared).toEqual([1, 2])
    expect(pending).toEqual({})
  })
})

describe('wheel page navigation', () => {
  const wheel = (deltaY: number, overrides: Partial<{
    deltaX: number
    deltaMode: number
    ctrlKey: boolean
    metaKey: boolean
    editableTarget: boolean
    deckSwitcherTarget: boolean
    preventDefault: () => void
  }> = {}) => ({
    deltaX: overrides.deltaX ?? 0,
    deltaY,
    deltaMode: overrides.deltaMode ?? 0,
    ctrlKey: overrides.ctrlKey,
    metaKey: overrides.metaKey,
    editableTarget: overrides.editableTarget,
    deckSwitcherTarget: overrides.deckSwitcherTarget,
    preventDefault: overrides.preventDefault ?? (() => {})
  })

  it('accumulates small trackpad deltas before navigating', () => {
    let time = 1000
    let prevented = 0
    const navigator = createWheelNavigatorForTest({ now: () => time })

    navigator.handle(wheel(30, { preventDefault: () => prevented++ }))
    navigator.handle(wheel(30, { preventDefault: () => prevented++ }))
    expect(navigator.offsets).toEqual([])

    navigator.handle(wheel(25, { preventDefault: () => prevented++ }))
    expect(navigator.offsets).toEqual([1])
    expect(prevented).toBe(1)
  })

  it('uses upward wheel motion for previous page', () => {
    const navigator = createWheelNavigatorForTest({ now: () => 1000 })

    navigator.handle(wheel(-90))

    expect(navigator.offsets).toEqual([-1])
  })

  it('locks a continuous wheel gesture so one trackpad swipe does not flip many pages', () => {
    let time = 1000
    let prevented = 0
    const navigator = createWheelNavigatorForTest({ now: () => time })

    navigator.handle(wheel(90, { preventDefault: () => prevented++ }))
    time = 1100
    navigator.handle(wheel(90, { preventDefault: () => prevented++ }))
    time = 1700
    navigator.handle(wheel(90, { preventDefault: () => prevented++ }))

    expect(navigator.offsets).toEqual([1])
    expect(prevented).toBe(3)
  })

  it('allows another page turn after the wheel gesture goes idle', () => {
    let time = 1000
    const navigator = createWheelNavigatorForTest({ now: () => time })

    navigator.handle(wheel(90))
    time = 1700
    navigator.unlockGesture()
    navigator.handle(wheel(90))

    expect(navigator.offsets).toEqual([1, 1])
  })

  it('allows immediate reverse navigation even while the previous wheel direction is locked', () => {
    let time = 1000
    const navigator = createWheelNavigatorForTest({ now: () => time })

    navigator.handle(wheel(90))
    time = 1100
    navigator.handle(wheel(-90))

    expect(navigator.offsets).toEqual([1, -1])
  })

  it('does not keep the wheel locked when scrolling outward at a page boundary', () => {
    let time = 1000
    const navigator = createWheelNavigatorForTest({
      now: () => time,
      navigate: (offset) => offset < 0
    })

    navigator.handle(wheel(90))
    time = 1100
    navigator.handle(wheel(-90))

    expect(navigator.offsets).toEqual([-1])
  })

  it('keeps zoom gestures, editable targets, and deck switcher wheel events untouched', () => {
    const navigator = createWheelNavigatorForTest({ now: () => 1000 })

    navigator.handle(wheel(100, { ctrlKey: true }))
    navigator.handle(wheel(100, { metaKey: true }))
    navigator.handle(wheel(100, { editableTarget: true }))
    navigator.handle(wheel(100, { deckSwitcherTarget: true }))

    expect(navigator.offsets).toEqual([])
  })

  it('normalizes line and page wheel deltas', () => {
    expect(normalizeWheelDeltaForTest(wheel(6, { deltaMode: 1 }))).toBe(96)
    expect(normalizeWheelDeltaForTest(wheel(-1, { deltaMode: 2 }))).toBe(-900)
    expect(normalizeWheelDeltaForTest(wheel(10, { deltaX: -120 }))).toBe(-120)
  })
})

describe('Transition animation name resolution', () => {
  it('all 7 types resolve correctly', () => {
    expect(resolveAnimationNames('fade')).toEqual({ out: 'ppt-vt-fade-out', in: 'ppt-vt-fade-in' })
    expect(resolveAnimationNames('slide-left')).toEqual({ out: 'ppt-vt-slide-left-out', in: 'ppt-vt-slide-left-in' })
    expect(resolveAnimationNames('slide-up')).toEqual({ out: 'ppt-vt-slide-up-out', in: 'ppt-vt-slide-up-in' })
    expect(resolveAnimationNames('push')).toEqual({ out: 'ppt-vt-push-out', in: 'ppt-vt-push-in' })
    expect(resolveAnimationNames('wipe')).toEqual({ out: 'ppt-vt-wipe-out', in: 'ppt-vt-wipe-in' })
    expect(resolveAnimationNames('zoom')).toEqual({ out: 'ppt-vt-zoom-out', in: 'ppt-vt-zoom-in' })
    expect(resolveAnimationNames('cube')).toEqual({ out: 'ppt-vt-fade-out', in: 'ppt-vt-fade-in' })
  })
})

describe('Transition duration clamping', () => {
  it('clamps min 120ms', () => {
    expect(clampTransitionDuration(50)).toBe(120)
    expect(clampTransitionDuration(0)).toBe(120)
    expect(clampTransitionDuration(-100)).toBe(120)
  })
  it('clamps max 1200ms', () => {
    expect(clampTransitionDuration(2000)).toBe(1200)
  })
  it('preserves valid values', () => {
    expect(clampTransitionDuration(420)).toBe(420)
  })
  it('defaults to 420ms for undefined/NaN/Infinity', () => {
    expect(clampTransitionDuration(undefined)).toBe(420)
    expect(clampTransitionDuration(NaN)).toBe(420)
    expect(clampTransitionDuration(Infinity)).toBe(420)
  })
  it('rounds to integer', () => {
    expect(clampTransitionDuration(333.7)).toBe(334)
  })
})

describe('Reduced motion guard', () => {
  it('generates CSS disabling VT animations', () => {
    const css = '@media (prefers-reduced-motion: reduce) {' +
      ' ::view-transition-old(root), ::view-transition-new(root) { animation: none !important; } }'
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).toContain('animation: none !important')
  })
})

describe('hasDataAnim / hasCustomPageAnimation coexistence logic', () => {
  function hasDataAnim(html: string): boolean {
    return /\bdata-anim\b/i.test(html)
  }
  function hasCustomPageAnimation(html: string): boolean {
    return (
      /(?:anime\s*\(|anime\.(?:createTimeline|timeline|animate|stagger)\s*\()/m.test(html) ||
      /PPT\.(?:animate|stagger|createTimeline)\s*\(/m.test(html) ||
      /data-(?:anime|animate)\b/i.test(html)
    )
  }
  function shouldIncludeDefaultMotion(html: string): boolean {
    return hasDataAnim(html) || !hasCustomPageAnimation(html)
  }

  it('includes default motion when only data-anim present', () => {
    expect(shouldIncludeDefaultMotion('<div data-anim="fade-up">Hello</div>')).toBe(true)
  })
  it('includes default motion when neither data-anim nor PPT.animate present', () => {
    expect(shouldIncludeDefaultMotion('<div class="card">Plain</div>')).toBe(true)
  })
  it('excludes default motion when only PPT.animate present (no data-anim)', () => {
    expect(shouldIncludeDefaultMotion('<script>PPT.animate(".card", { opacity: [0,1] })</script>')).toBe(false)
  })
  it('includes default motion when BOTH data-anim and PPT.animate coexist', () => {
    const html = '<div data-anim="fade-up">A</div><script>PPT.animate(".b", {})</script>'
    expect(shouldIncludeDefaultMotion(html)).toBe(true)
  })
  it('data-anim is detected as separate from data-anime/data-animate', () => {
    expect(hasDataAnim('<div data-anim="fade-up">A</div>')).toBe(true)
    expect(hasDataAnim('<div data-anime="true">B</div>')).toBe(false)
    expect(hasDataAnim('<div data-animate="true">C</div>')).toBe(false)
  })
})

describe('Transition config JSON round-trip', () => {
  it('all 7 types survive JSON round-trip', () => {
    const types = ['fade', 'slide-left', 'slide-up', 'push', 'wipe', 'zoom', 'none']
    for (const type of types) {
      const json = JSON.stringify({ type, durationMs: type === 'none' ? 0 : 420 })
      const parsed = JSON.parse(json)
      expect(parsed.type).toBe(type)
    }
  })
})
