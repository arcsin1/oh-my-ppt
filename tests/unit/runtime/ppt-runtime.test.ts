/**
 * @vitest-environment happy-dom
 *
 * Unit tests for ppt-runtime.js v2.0.17:
 *   - PPT.stopAnimations() / PPT.resumeAnimations()
 *   - PPT.clicks state machine (advance returns boolean, _dispatch exact match)
 *   - PPT.scanDataAnim() / PPT.executeDataAnim() (routed through PPT.animate)
 *   - Click-triggered initial hidden state
 *   - Lottie hook (PPT.playLottie placeholder)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const runtimeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../../resources/ppt-runtime.js'),
  'utf-8'
)

function createMockAnime() {
  const animations: Array<{
    pause: ReturnType<typeof vi.fn>
    play: ReturnType<typeof vi.fn>
    complete: ReturnType<typeof vi.fn>
    finished: Promise<void>
  }> = []

  const anime = {
    animate: vi.fn((_targets: unknown, _params: unknown) => {
      let resolveFinished!: () => void
      const finished = new Promise<void>((r) => { resolveFinished = r })
      const anim = {
        pause: vi.fn(),
        play: vi.fn(),
        complete: vi.fn(() => resolveFinished()),
        finished,
        _resolve: resolveFinished
      }
      animations.push(anim)
      return anim
    }),
    stagger: vi.fn((gap: number) => {
      return (_el: unknown, i: number) => i * gap
    }),
    createTimeline: vi.fn(() => ({ add: vi.fn() })),
    timeline: vi.fn(() => ({ add: vi.fn() }))
  }

  return { anime, animations }
}

function setupRuntime(options?: { search?: string; parent?: { postMessage: ReturnType<typeof vi.fn> } }) {
  const { anime, animations } = createMockAnime()

  document.body.innerHTML = `
    <div class="ppt-page-root">
      <div data-anim="fade-up" data-anim-duration="500" id="el1">Card 1</div>
      <div data-anim="fade-up" data-anim-delay="stagger(100)" id="el2">Card 2</div>
      <div data-anim="fade-up" data-anim-delay="stagger(100)" id="el3">Card 3</div>
      <div data-anim="scale-in" data-anim-trigger="click" id="el4">Reveal click</div>
      <div data-anim="fade-left" data-anim-trigger="click" id="el5">Reveal click 2</div>
      <div data-anim="none" id="el6">Skipped</div>
      <div class="card" id="el7">Legacy target</div>
    </div>
  `

  const existingPPT = (globalThis as Record<string, unknown>).PPT as Record<string, unknown> | undefined
  if (existingPPT) existingPPT.__runtimeVersion = null
  ;(globalThis as Record<string, unknown>).__ohmypptPlaybackBridgeInstalled = false
  ;(globalThis as Record<string, unknown>).anime = anime
  delete (globalThis as Record<string, unknown>).gsap
  window.history.replaceState(null, '', `/page.html${options?.search || ''}`)
  try {
    Object.defineProperty(window, 'parent', {
      value: options?.parent || window,
      configurable: true
    })
  } catch {
    // happy-dom allows this; real browsers keep window.parent read-only.
  }

  new Function(runtimeSrc)()

  const PPT = (globalThis as Record<string, unknown>).PPT as Record<string, unknown>
  return { PPT, anime, animations }
}

function setupRuntimeWithGsap() {
  const fromTo = vi.fn((_targets: unknown, _fromVars: unknown, _toVars: unknown) => {
    const tween = {
      then: vi.fn((resolve?: () => void) => {
        if (typeof resolve === 'function') resolve()
        return Promise.resolve()
      }),
      pause: vi.fn(),
      play: vi.fn(),
      progress: vi.fn(),
      totalProgress: vi.fn(),
      complete: vi.fn()
    }
    return tween
  })
  const to = vi.fn((_targets: unknown, _toVars: unknown) => {
    const tween = {
      then: vi.fn((resolve?: () => void) => {
        if (typeof resolve === 'function') resolve()
        return Promise.resolve()
      }),
      pause: vi.fn(),
      play: vi.fn(),
      progress: vi.fn(),
      totalProgress: vi.fn(),
      complete: vi.fn()
    }
    return tween
  })
  const timelineInstance = {
    fromTo: vi.fn(),
    to: vi.fn(),
    add: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    progress: vi.fn(),
    totalProgress: vi.fn(),
    restart: vi.fn()
  }
  const gsap = {
    fromTo,
    to,
    timeline: vi.fn(() => timelineInstance),
    utils: {
      stagger: vi.fn((_gap: number, _options?: Record<string, unknown>) => vi.fn())
    },
    globalTimeline: {
      pause: vi.fn(),
      play: vi.fn(),
      progress: vi.fn()
    },
    killTweensOf: vi.fn()
  }
  const runtime = setupRuntime()
  ;(globalThis as Record<string, unknown>).gsap = gsap
  ;(runtime.PPT as { __runtimeVersion?: string | null }).__runtimeVersion = null
  new Function(runtimeSrc)()
  const PPT = (globalThis as Record<string, unknown>).PPT as Record<string, unknown>
  return { PPT, gsap, timelineInstance }
}

// ── Helper: typed clicks access ──
type ClicksAPI = {
  current: number; total: number
  _listeners: unknown[]
  _advanceListeners: unknown[]
  setTotal: (n: number) => void
  advance: () => boolean
  reset: () => void
  on: (clickNum: number, fn: () => void) => void
  onAdvance: (fn: (click: number, current: number, total: number) => void) => void
}
function getClicks(PPT: Record<string, unknown>): ClicksAPI {
  return PPT.clicks as ClicksAPI
}

function dispatchWheel(
  target: EventTarget,
  options: Partial<{
    deltaX: number
    deltaY: number
    deltaMode: number
    ctrlKey: boolean
    metaKey: boolean
  }> = {}
): Event {
  const event = new Event('wheel', { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    deltaX: { value: options.deltaX ?? 0 },
    deltaY: { value: options.deltaY ?? 0 },
    deltaMode: { value: options.deltaMode ?? 0 },
    ctrlKey: { value: options.ctrlKey ?? false },
    metaKey: { value: options.metaKey ?? false }
  })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  try {
    vi.runOnlyPendingTimers()
  } catch {
    // Some tests use real timers.
  }
  vi.useRealTimers()
})

describe('PPT.stopAnimations / PPT.resumeAnimations', () => {
  let PPT: Record<string, unknown>
  let animations: ReturnType<typeof createMockAnime>['animations']

  beforeEach(() => {
    const s = setupRuntime(); PPT = s.PPT; animations = s.animations
  })

  it('pauses all active animations', () => {
    const animate = PPT.animate as Function
    animate('.card', { opacity: [0, 1] })
    animate('.card', { opacity: [0, 1] })
    expect(animations.length).toBeGreaterThanOrEqual(2)
    ;(PPT.stopAnimations as Function)()
    animations.forEach(a => { expect(a.pause).toHaveBeenCalled() })
  })

  it('resumes all active animations', () => {
    const animate = PPT.animate as Function
    animate('.card', { opacity: [0, 1] })
    ;(PPT.resumeAnimations as Function)()
    animations.forEach(a => { expect(a.play).toHaveBeenCalled() })
  })

  it('finishes active animations before pausing them', () => {
    const animate = PPT.animate as Function
    animate('.card', { opacity: [0, 1] })
    ;(PPT.finishAnimations as Function)()
    animations.forEach(a => {
      expect(a.complete).toHaveBeenCalled()
    })
  })

  it('handles empty active set gracefully', () => {
    expect(() => (PPT.stopAnimations as Function)()).not.toThrow()
    expect(() => (PPT.resumeAnimations as Function)()).not.toThrow()
  })
})

describe('PPT.clicks state machine', () => {
  let PPT: Record<string, unknown>

  beforeEach(() => { PPT = setupRuntime().PPT })

  it('init: current=0, total=0', () => {
    const c = getClicks(PPT)
    expect(c.current).toBe(0)
    expect(c.total).toBe(0)
  })

  it('setTotal', () => {
    const c = getClicks(PPT)
    c.setTotal(5)
    expect(c.total).toBe(5)
  })

  it('setTotal clamps current when the click count shrinks', () => {
    const c = getClicks(PPT)
    c.setTotal(2)
    c.advance()
    c.advance()
    c.setTotal(0)
    expect(c.current).toBe(0)
    expect(c.total).toBe(0)
  })

  it('advance increments current and returns true when step consumed', () => {
    const c = getClicks(PPT)
    expect(c.advance()).toBe(true)
    expect(c.current).toBe(1)
    expect(c.advance()).toBe(true)
    expect(c.current).toBe(2)
  })

  it('advance stops at total and returns false when exhausted', () => {
    const c = getClicks(PPT)
    c.setTotal(2)
    expect(c.advance()).toBe(true)  // → 1
    expect(c.advance()).toBe(true)  // → 2
    expect(c.advance()).toBe(false) // exhausted
    expect(c.current).toBe(2)       // never goes past total
  })

  it('advance returns true in unbounded auto mode when total=0', () => {
    const c = getClicks(PPT)
    expect(c.total).toBe(0)
    expect(c.advance()).toBe(true)
    expect(c.current).toBe(1)
  })

  it('reset sets current back to 0', () => {
    const c = getClicks(PPT)
    c.advance()
    c.advance()
    c.reset()
    expect(c.current).toBe(0)
  })

  it('reset preserves click listeners for manual replay', () => {
    const c = getClicks(PPT)
    c.on(1, vi.fn())
    c.onAdvance(vi.fn())
    c.reset()

    expect(c._listeners).toHaveLength(1)
    expect(c._advanceListeners).toHaveLength(1)
  })

  it('on() fires callback at matching click, does NOT replay on later clicks', () => {
    const c = getClicks(PPT)
    const fn1 = vi.fn(), fn2 = vi.fn(), fn3 = vi.fn()
    c.on(1, fn1)
    c.on(2, fn2)
    c.on(3, fn3)

    c.advance() // click 1
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn2).not.toHaveBeenCalled()
    expect(fn3).not.toHaveBeenCalled()

    c.advance() // click 2
    expect(fn1).toHaveBeenCalledTimes(1) // ⬅ NOT replayed
    expect(fn2).toHaveBeenCalledTimes(1)
    expect(fn3).not.toHaveBeenCalled()

    c.advance() // click 3
    expect(fn1).toHaveBeenCalledTimes(1) // ⬅ NOT replayed
    expect(fn2).toHaveBeenCalledTimes(1)
    expect(fn3).toHaveBeenCalledTimes(1)
  })

  it('on() fires immediately if current >= clickNum (late registration)', () => {
    const c = getClicks(PPT)
    c.advance()
    c.advance() // current=2
    const fn = vi.fn()
    c.on(1, fn) // click 1 already past
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('onAdvance fires on every advance with (click, current, total)', () => {
    const c = getClicks(PPT)
    const fn = vi.fn()
    c.onAdvance(fn)
    c.advance()
    expect(fn).toHaveBeenCalledWith(1, 1, 0)
    c.advance()
    expect(fn).toHaveBeenCalledWith(2, 2, 0)
  })
})

describe('PPT playback bridge', () => {
  it('does not install for normal page preview URLs', () => {
    const parent = { postMessage: vi.fn() }
    const { PPT } = setupRuntime({ parent })
    const c = getClicks(PPT)
    c.setTotal(1)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    dispatchWheel(document.body, { deltaY: 90 })

    expect(c.current).toBe(0)
    expect(parent.postMessage).not.toHaveBeenCalled()
  })

  it('consumes click-triggered animation before asking the parent deck to navigate', () => {
    const parent = { postMessage: vi.fn() }
    const { PPT } = setupRuntime({ search: '?pptPlayback=1', parent })
    const c = getClicks(PPT)
    c.setTotal(1)

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(c.current).toBe(1)
    expect(parent.postMessage).toHaveBeenCalledWith({
      type: 'ohmyppt:playback:goto',
      offset: 1,
      requestId: null
    }, '*')
  })

  it('accepts parent advance messages for focused top-level deck shortcuts', () => {
    const parent = { postMessage: vi.fn() }
    const { PPT } = setupRuntime({ search: '?pptPlayback=1', parent })
    const c = getClicks(PPT)
    c.setTotal(1)

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'ohmyppt:playback:advance', offset: 1 }
    }))
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'ohmyppt:playback:advance', offset: 1 }
    }))

    expect(c.current).toBe(1)
    expect(parent.postMessage).toHaveBeenCalledWith({
      type: 'ohmyppt:playback:goto',
      offset: 1,
      requestId: null
    }, '*')
  })

  it('acknowledges parent advance messages when an animation step is consumed', () => {
    const parent = { postMessage: vi.fn() }
    const { PPT } = setupRuntime({ search: '?pptPlayback=1', parent })
    const c = getClicks(PPT)
    c.setTotal(1)

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'ohmyppt:playback:advance', offset: 1, requestId: 'req-1' }
    }))

    expect(c.current).toBe(1)
    expect(parent.postMessage).toHaveBeenCalledWith({
      type: 'ohmyppt:playback:handled',
      requestId: 'req-1'
    }, '*')
  })

  it('ignores playback advance messages from non-parent windows', () => {
    const parent = { postMessage: vi.fn() }
    const otherWindow = {} as Window
    const { PPT } = setupRuntime({ search: '?pptPlayback=1', parent })
    const c = getClicks(PPT)
    c.setTotal(1)

    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'ohmyppt:playback:advance', offset: 1, requestId: 'req-2' },
      source: otherWindow
    }))

    expect(c.current).toBe(0)
    expect(parent.postMessage).not.toHaveBeenCalled()
  })

  it('navigates parent deck from wheel events inside the slide iframe', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const parent = { postMessage: vi.fn() }
    setupRuntime({ search: '?pptPlayback=1', parent })

    const event = dispatchWheel(document.body, { deltaY: 90 })

    expect(event.defaultPrevented).toBe(true)
    expect(parent.postMessage).toHaveBeenCalledWith({
      type: 'ohmyppt:playback:goto',
      offset: 1,
      requestId: expect.any(String)
    }, '*')
  })

  it('uses upward wheel motion for previous page inside playback mode', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const parent = { postMessage: vi.fn() }
    setupRuntime({ search: '?pptPlayback=1', parent })

    dispatchWheel(document.body, { deltaY: -90 })

    expect(parent.postMessage).toHaveBeenCalledWith({
      type: 'ohmyppt:playback:goto',
      offset: -1,
      requestId: expect.any(String)
    }, '*')
  })

  it('wheel consumes click-triggered animation before asking parent deck to navigate', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const parent = { postMessage: vi.fn() }
    const { PPT } = setupRuntime({ search: '?pptPlayback=1', parent })
    const c = getClicks(PPT)
    c.setTotal(1)

    dispatchWheel(document.body, { deltaY: 90 })
    expect(c.current).toBe(1)
    expect(parent.postMessage).not.toHaveBeenCalled()

    vi.advanceTimersByTime(600)
    dispatchWheel(document.body, { deltaY: 90 })
    expect(parent.postMessage).toHaveBeenCalledWith({
      type: 'ohmyppt:playback:goto',
      offset: 1,
      requestId: expect.any(String)
    }, '*')
  })

  it('locks one continuous trackpad wheel gesture to a single page turn', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const parent = { postMessage: vi.fn() }
    setupRuntime({ search: '?pptPlayback=1', parent })

    dispatchWheel(document.body, { deltaY: 90 })
    for (let i = 0; i < 7; i++) {
      vi.advanceTimersByTime(100)
      dispatchWheel(document.body, { deltaY: 90 })
    }

    expect(parent.postMessage).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(300)
    dispatchWheel(document.body, { deltaY: 90 })

    expect(parent.postMessage).toHaveBeenCalledTimes(2)
  })

  it('allows immediate reverse wheel navigation while the previous direction is locked', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const parent = { postMessage: vi.fn() }
    setupRuntime({ search: '?pptPlayback=1', parent })

    dispatchWheel(document.body, { deltaY: 90 })
    vi.advanceTimersByTime(100)
    dispatchWheel(document.body, { deltaY: -90 })

    expect(parent.postMessage).toHaveBeenNthCalledWith(1, {
      type: 'ohmyppt:playback:goto',
      offset: 1,
      requestId: expect.any(String)
    }, '*')
    expect(parent.postMessage).toHaveBeenNthCalledWith(2, {
      type: 'ohmyppt:playback:goto',
      offset: -1,
      requestId: expect.any(String)
    }, '*')
  })

  it('unlocks wheel gesture when parent reports boundary navigation did not move', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const parent = { postMessage: vi.fn() }
    setupRuntime({ search: '?pptPlayback=1', parent })

    dispatchWheel(document.body, { deltaY: 90 })
    const firstMessage = parent.postMessage.mock.calls[0]?.[0] as { requestId?: string }
    expect(firstMessage.requestId).toEqual(expect.any(String))

    window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'ohmyppt:playback:navigation-result',
        requestId: firstMessage.requestId,
        navigated: false
      }
    }))

    vi.advanceTimersByTime(100)
    dispatchWheel(document.body, { deltaY: 90 })

    expect(parent.postMessage).toHaveBeenCalledTimes(2)
    expect(parent.postMessage.mock.calls[1]?.[0]).toEqual({
      type: 'ohmyppt:playback:goto',
      offset: 1,
      requestId: expect.any(String)
    })
  })

  it('keeps wheel zoom gestures and editable targets untouched in playback mode', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const parent = { postMessage: vi.fn() }
    setupRuntime({ search: '?pptPlayback=1', parent })

    const input = document.createElement('input')
    document.body.appendChild(input)
    const zoomEvent = dispatchWheel(document.body, { deltaY: 100, ctrlKey: true })
    const editEvent = dispatchWheel(input, { deltaY: 100 })

    expect(zoomEvent.defaultPrevented).toBe(false)
    expect(editEvent.defaultPrevented).toBe(false)
    expect(parent.postMessage).not.toHaveBeenCalled()
  })
})

describe('PPT.scanDataAnim', () => {
  let PPT: Record<string, unknown>

  beforeEach(() => { PPT = setupRuntime().PPT })

  it('returns null when no data-anim elements found', () => {
    document.body.innerHTML = '<div class="ppt-page-root"></div>'
    const result = (PPT.scanDataAnim as Function)(document.body)
    expect(result).toBeNull()
  })

  it('splits load vs click animations', () => {
    const root = document.querySelector('.ppt-page-root')!
    const result = (PPT.scanDataAnim as Function)(root) as { load: unknown[]; click: unknown[]; all: unknown[] }
    expect(result.load).toHaveLength(3)
    expect(result.click).toHaveLength(2)
    expect(result.all).toHaveLength(5)
  })

  it('sets PPT.clicks.total to click-triggered count', () => {
    const root = document.querySelector('.ppt-page-root')!
    ;(PPT.scanDataAnim as Function)(root)
    const c = getClicks(PPT)
    expect(c.total).toBe(2)
  })

  it('resets PPT.clicks.total when a later scan has no click-triggered elements', () => {
    const root = document.querySelector('.ppt-page-root')!
    ;(PPT.scanDataAnim as Function)(root)
    const c = getClicks(PPT)
    c.advance()
    c.advance()

    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="fade-up">Only load animation</div>
      </div>
    `
    ;(PPT.scanDataAnim as Function)(document.querySelector('.ppt-page-root'))

    expect(c.total).toBe(0)
    expect(c.current).toBe(0)
  })

  it('clears previous click listeners before rescanning data-anim elements', () => {
    const root = document.querySelector('.ppt-page-root')!
    ;(PPT.scanDataAnim as Function)(root)
    const c = getClicks(PPT)
    c.on(1, vi.fn())
    c.onAdvance(vi.fn())

    ;(PPT.scanDataAnim as Function)(root)

    expect(c._listeners).toHaveLength(0)
    expect(c._advanceListeners).toHaveLength(0)
  })

  it('applies initial hidden state to click-triggered elements', () => {
    const el4 = document.getElementById('el4')!
    const el5 = document.getElementById('el5')!
    const root = document.querySelector('.ppt-page-root')!
    ;(PPT.scanDataAnim as Function)(root)

    expect(el4.style.opacity).toBe('0')
    expect(el5.style.opacity).toBe('0')
  })

  it('marks click-triggered elements with data-ppt-anim-initialized', () => {
    const el4 = document.getElementById('el4')!
    const root = document.querySelector('.ppt-page-root')!
    ;(PPT.scanDataAnim as Function)(root)
    expect(el4.getAttribute('data-ppt-anim-initialized')).toBe('1')
  })

  it('does NOT mark load-triggered elements with initialization marker', () => {
    const el1 = document.getElementById('el1')!
    const root = document.querySelector('.ppt-page-root')!
    ;(PPT.scanDataAnim as Function)(root)
    expect(el1.getAttribute('data-ppt-anim-initialized')).toBeNull()
    expect(el1.style.opacity).toBe('')
  })

  it('skips data-anim="none" elements', () => {
    const root = document.querySelector('.ppt-page-root')!
    const result = (PPT.scanDataAnim as Function)(root) as { all: Array<{ type: string }> }
    const types = result.all.map(a => a.type)
    expect(types).not.toContain('none')
  })

  it('falls back to document when root is null', () => {
    const result = (PPT.scanDataAnim as Function)(null)
    expect(result).not.toBeNull()
    expect((result as { all: unknown[] }).all.length).toBeGreaterThan(0)
  })

  it('parses extended animation attributes without adding non-click steps', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="fly-in" data-anim-from="left" data-anim-trigger="with" id="fly">Fly</div>
        <div data-anim="wipe" data-anim-from="right" data-anim-trigger="after" id="wipe">Wipe</div>
        <div data-anim="pulse" data-anim-repeat="3" data-anim-direction="alternate" id="pulse">Pulse</div>
      </div>
    `

    const result = (PPT.scanDataAnim as Function)(document.querySelector('.ppt-page-root')) as {
      load: Array<Record<string, unknown>>
      click: unknown[]
      all: Array<Record<string, unknown>>
    }

    expect(result.load).toHaveLength(3)
    expect(result.click).toHaveLength(0)
    expect(getClicks(PPT).total).toBe(0)
    expect(result.all[0]).toMatchObject({ type: 'fly-in', trigger: 'with', effectiveTrigger: 'load', from: 'left' })
    expect(result.all[1]).toMatchObject({ type: 'wipe', trigger: 'after', effectiveTrigger: 'load', from: 'right' })
    expect(result.all[2]).toMatchObject({ type: 'pulse', repeat: 3, direction: 'alternate' })
    expect(Number(result.all[1].delay)).toBeGreaterThan(0)
  })

  it('supports data-anim-stagger as a declarative stagger shortcut', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="fade-up" data-anim-stagger="80" id="a">A</div>
        <div data-anim="fade-up" data-anim-stagger="80" id="b">B</div>
        <div data-anim="fade-up" data-anim-stagger="80" id="c">C</div>
      </div>
    `

    const result = (PPT.scanDataAnim as Function)(document.querySelector('.ppt-page-root')) as {
      all: Array<Record<string, unknown>>
    }

    expect(result.all.map((item) => item.delay)).toEqual([0, 80, 160])
    expect(result.all.map((item) => item.stagger)).toEqual([80, 80, 80])
  })

  it('supports data-anim-sequence to control load ordering without overloading trigger', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="fade-up" data-anim-duration="400" id="lead">Lead</div>
        <div data-anim="fade-up" data-anim-sequence="with" data-anim-delay="50" data-anim-duration="300" id="with">With</div>
        <div data-anim="fade-up" data-anim-sequence="after" data-anim-delay="20" data-anim-duration="200" id="after">After</div>
      </div>
    `

    const result = (PPT.scanDataAnim as Function)(document.querySelector('.ppt-page-root')) as {
      all: Array<Record<string, unknown>>
    }

    expect(result.all[1]).toMatchObject({ trigger: 'load', effectiveTrigger: 'load', sequence: 'with', delay: 50 })
    expect(result.all[2]).toMatchObject({ trigger: 'load', effectiveTrigger: 'load', sequence: 'after', delay: 420 })
  })

  it('does not hide click-triggered emphasis or exit animations before playback', () => {
    document.body.innerHTML = `
      <div class="ppt-page-root">
        <div data-anim="pulse" data-anim-trigger="click" id="pulse">Pulse</div>
        <div data-anim="exit-fly" data-anim-trigger="click" data-anim-from="bottom" id="exit">Exit</div>
      </div>
    `

    ;(PPT.scanDataAnim as Function)(document.querySelector('.ppt-page-root'))

    expect(document.getElementById('pulse')!.style.opacity).toBe('')
    expect(document.getElementById('exit')!.style.opacity).toBe('')
    expect(document.getElementById('pulse')!.getAttribute('data-ppt-anim-initialized')).toBeNull()
    expect(getClicks(PPT).total).toBe(2)
  })
})

describe('PPT.executeDataAnim (routed through PPT.animate)', () => {
  let PPT: Record<string, unknown>
  let anime: Record<string, unknown>

  beforeEach(() => {
    const s = setupRuntime(); PPT = s.PPT; anime = s.anime
  })

  it('handles empty config', () => {
    expect(() => (PPT.executeDataAnim as Function)([])).not.toThrow()
  })

  it('calls PPT.animate (not timeline) for each config entry', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const config = [
      { targets: document.getElementById('el1'), type: 'fade-up', duration: 500, easing: 'easeOutCubic', delay: 0 }
    ]
    ;(PPT.executeDataAnim as Function)(config)
    expect(animateSpy).toHaveBeenCalled()
    animateSpy.mockRestore()
  })

  it('slide-up params include opacity for click reveal visibility', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'slide-up', duration: 500, easing: 'easeOutCubic', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    expect(animateSpy).toHaveBeenCalled()
    const callArgs = animateSpy.mock.calls[0]
    const params = callArgs[1] as Record<string, unknown>
    expect(params.opacity).toEqual([0, 1])
    expect(params.translateY).toEqual([40, 0])
    animateSpy.mockRestore()
  })

  it('slide-left params include opacity for click reveal visibility', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'slide-left', duration: 500, easing: 'easeOutCubic', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    const params = animateSpy.mock.calls[0][1] as Record<string, unknown>
    expect(params.opacity).toEqual([0, 1])
    expect(params.translateX).toEqual([40, 0])
    animateSpy.mockRestore()
  })

  it('slide-down params include negative y offset for downward reveal', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'slide-down', duration: 500, easing: 'easeOutCubic', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    const params = animateSpy.mock.calls[0][1] as Record<string, unknown>
    expect(params.opacity).toEqual([0, 1])
    expect(params.translateY).toEqual([-40, 0])
    animateSpy.mockRestore()
  })

  it('slide-right params include negative x offset for rightward reveal', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'slide-right', duration: 500, easing: 'easeOutCubic', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    const params = animateSpy.mock.calls[0][1] as Record<string, unknown>
    expect(params.opacity).toEqual([0, 1])
    expect(params.translateX).toEqual([-40, 0])
    animateSpy.mockRestore()
  })

  it('maps fly-in direction to real translate params', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'fly-in', from: 'left', duration: 500, easing: 'easeOutCubic', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    const params = animateSpy.mock.calls[0][1] as Record<string, unknown>
    expect(params.opacity).toEqual([0, 1])
    expect(params.translateX).toEqual([-40, 0])
    animateSpy.mockRestore()
  })

  it('maps wipe direction to clipPath params', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'wipe', from: 'right', duration: 500, easing: 'easeOutCubic', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    const params = animateSpy.mock.calls[0][1] as Record<string, unknown>
    expect(params.opacity).toEqual([0, 1])
    expect(params.clipPath).toEqual(['inset(0% 0% 0% 100%)', 'inset(0% 0% 0% 0%)'])
    animateSpy.mockRestore()
  })

  it('maps emphasis repeat and direction to anime loop params', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'pulse', repeat: 3, direction: 'alternate', duration: 500, easing: 'easeOutCubic', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    const params = animateSpy.mock.calls[0][1] as Record<string, unknown>
    expect(params.scale).toEqual([1, 1.06, 1])
    expect(params.loop).toBe(2)
    expect(params.alternate).toBe(true)
    animateSpy.mockRestore()
  })

  it('maps exit-fly to visible-to-hidden movement', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'exit-fly', from: 'bottom', duration: 500, easing: 'easeOutCubic', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    const params = animateSpy.mock.calls[0][1] as Record<string, unknown>
    expect(params.opacity).toEqual([1, 0])
    expect(params.translateY).toEqual([0, 40])
    animateSpy.mockRestore()
  })

  it('maps exit-wipe to visible-to-hidden clipPath concealment', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'exit-wipe', from: 'right', duration: 500, easing: 'easeOutCubic', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    const params = animateSpy.mock.calls[0][1] as Record<string, unknown>
    expect(params.opacity).toEqual([1, 0])
    expect(params.clipPath).toEqual(['inset(0% 0% 0% 0%)', 'inset(0% 0% 0% 100%)'])
    animateSpy.mockRestore()
  })

  it('supports simple data-anim-path deltas', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'path', path: 'M 0 0 L 120 30', duration: 500, easing: 'linear', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    const params = animateSpy.mock.calls[0][1] as Record<string, unknown>
    expect(params.translateX).toEqual([0, 120])
    expect(params.translateY).toEqual([0, 30])
    animateSpy.mockRestore()
  })

  it('passes through print mode via PPT.animate', () => {
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'fade', duration: 500, easing: 'linear', delay: 0 }]
    expect(() => (PPT.executeDataAnim as Function)(config)).not.toThrow()
  })

  it('calls PPT.playLottie for lottie type', () => {
    const playLottieSpy = vi.fn()
    const origPlayLottie = PPT.playLottie
    PPT.playLottie = playLottieSpy

    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'lottie', lottieSrc: './test.json', lottieLoop: true, lottieAutoplay: true, duration: 500, easing: 'linear', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    expect(playLottieSpy).toHaveBeenCalledWith(el, config[0])

    PPT.playLottie = origPlayLottie
  })
})

describe('PPT.playLottie placeholder', () => {
  it('exists as a no-op function', () => {
    const PPT = setupRuntime().PPT
    expect(typeof PPT.playLottie).toBe('function')
    expect(() => (PPT.playLottie as Function)(document.body, {})).not.toThrow()
  })
})

describe('PPT.animate tracks animations for stop/resume', () => {
  it('adds animation to active set', () => {
    const { PPT, animations } = setupRuntime()
    ;(PPT.animate as Function)('.card', { opacity: [0, 1] })
    ;(PPT.stopAnimations as Function)()
    const pauseCalls = animations.filter(a => a.pause.mock.calls.length > 0)
    expect(pauseCalls.length).toBeGreaterThan(0)
  })
})

describe('PPT GSAP bridge', () => {
  it('routes PPT.animate through real GSAP adapter with valid easing names', () => {
    const { PPT, gsap } = setupRuntimeWithGsap()

    ;(PPT.animate as Function)('#el1', {
      opacity: [0, 1],
      translateY: [20, 0],
      duration: 500,
      delay: 200,
      easing: 'easeOutCubic'
    })

    expect(gsap.fromTo).toHaveBeenCalledWith(
      '#el1',
      { opacity: 0, y: 20 },
      {
        duration: 0.5,
        delay: 0.2,
        ease: 'power2.out',
        opacity: 1,
        y: 0
      }
    )
  })

  it('maps supported legacy and GSAP easing values explicitly', () => {
    const { PPT, gsap } = setupRuntimeWithGsap()

    ;(PPT.animate as Function)('#el1', { opacity: [0, 1], easing: 'easeInOutQuad' })
    ;(PPT.animate as Function)('#el1', { opacity: [0, 1], easing: 'back.out' })
    ;(PPT.animate as Function)('#el1', { opacity: [0, 1], easing: 'linear' })

    expect(gsap.fromTo.mock.calls[0][2]).toMatchObject({ ease: 'power1.inOut' })
    expect(gsap.fromTo.mock.calls[1][2]).toMatchObject({ ease: 'back.out' })
    expect(gsap.fromTo.mock.calls[2][2]).toMatchObject({ ease: 'none' })
  })

  it('maps symmetric three-step emphasis arrays to GSAP yoyo repeat semantics', () => {
    const { PPT, gsap } = setupRuntimeWithGsap()

    ;(PPT.animate as Function)('#el1', {
      scale: [0.9, 1.08, 0.9],
      duration: 600
    })

    expect(gsap.fromTo).toHaveBeenCalledWith(
      '#el1',
      { scale: 0.9 },
      expect.objectContaining({
        duration: 0.6,
        scale: 1.08,
        repeat: 1,
        yoyo: true
      })
    )
  })

  it('passes PPT.stagger options to GSAP in seconds', () => {
    const { PPT, gsap } = setupRuntimeWithGsap()

    ;(PPT.stagger as Function)(80, { start: 200, from: 'center' })

    expect(gsap.utils.stagger).toHaveBeenCalledWith(0.08, {
      start: 0.2,
      from: 'center'
    })
  })

  it('keeps PPT.createTimeline add syntax while adapting to GSAP timeline.fromTo', () => {
    const { PPT, gsap, timelineInstance } = setupRuntimeWithGsap()

    const timeline = (PPT.createTimeline as Function)({ paused: true })
    timeline.add(
      {
        targets: '.step-1',
        opacity: [0, 1],
        translateY: [20, 0],
        duration: 400,
        easing: 'power2.out'
      },
      '+=0.2'
    )

    expect(gsap.timeline).toHaveBeenCalledWith({ paused: true })
    expect(timelineInstance.fromTo).toHaveBeenCalledWith(
      '.step-1',
      { opacity: 0, y: 20 },
      {
        duration: 0.4,
        ease: 'power2.out',
        opacity: 1,
        y: 0
      },
      '+=0.2'
    )
  })

  it('tracks GSAP timelines for runtime stop, resume, and finish controls', () => {
    const { PPT, gsap, timelineInstance } = setupRuntimeWithGsap()

    ;(PPT.createTimeline as Function)({ paused: true })
    ;(PPT.stopAnimations as Function)()
    ;(PPT.resumeAnimations as Function)()
    ;(PPT.finishAnimations as Function)()

    expect(gsap.globalTimeline.pause).toHaveBeenCalled()
    expect(gsap.globalTimeline.play).toHaveBeenCalled()
    expect(gsap.globalTimeline.progress).toHaveBeenCalledWith(1)
    expect(timelineInstance.pause).toHaveBeenCalled()
    expect(timelineInstance.play).toHaveBeenCalled()
    expect(timelineInstance.totalProgress).toHaveBeenCalledWith(1)
  })

  it('removes completed GSAP timelines from the active runtime set', () => {
    const timelineThen = vi.fn((resolve?: () => void) => {
      if (typeof resolve === 'function') resolve()
      return Promise.resolve()
    })
    const timelineInstance = {
      fromTo: vi.fn(),
      add: vi.fn(),
      pause: vi.fn(),
      play: vi.fn(),
      restart: vi.fn(),
      then: timelineThen
    }
    const gsap = {
      fromTo: vi.fn(),
      to: vi.fn(),
      timeline: vi.fn(() => timelineInstance),
      utils: { stagger: vi.fn() },
      globalTimeline: { pause: vi.fn(), play: vi.fn(), progress: vi.fn() },
      killTweensOf: vi.fn()
    }
    const runtime = setupRuntime()
    ;(globalThis as Record<string, unknown>).gsap = gsap
    ;(runtime.PPT as { __runtimeVersion?: string | null }).__runtimeVersion = null
    new Function(runtimeSrc)()
    const PPT = (globalThis as Record<string, unknown>).PPT as Record<string, unknown>

    ;(PPT.createTimeline as Function)({ paused: true })
    ;(PPT.stopAnimations as Function)()
    expect(timelineInstance.pause).not.toHaveBeenCalled()
  })

  it('uses gsap.to for visible-to-hidden exit opacity', () => {
    const { PPT, gsap } = setupRuntimeWithGsap()

    ;(PPT.animate as Function)('#el1', { opacity: [1, 0], duration: 300 })

    expect(gsap.to).toHaveBeenCalledWith('#el1', {
      duration: 0.3,
      opacity: 0
    })
  })

  it('uses timeline.to for exit opacity steps added through PPT.createTimeline', () => {
    const { PPT, timelineInstance } = setupRuntimeWithGsap()

    const timeline = (PPT.createTimeline as Function)({ paused: true })
    timeline.add(
      {
        targets: '.outro',
        opacity: [1, 0],
        duration: 300,
        easing: 'power2.out'
      },
      '+=0.1'
    )

    expect(timelineInstance.to).toHaveBeenCalledWith(
      '.outro',
      {
        duration: 0.3,
        ease: 'power2.out',
        opacity: 0
      },
      '+=0.1'
    )
    expect(timelineInstance.fromTo).not.toHaveBeenCalled()
  })
})

describe('PPT.createChart tick formatters', () => {
  function installMockChart() {
    const previousChart = (globalThis as Record<string, unknown>).Chart
    const instances = new Map<HTMLCanvasElement, Record<string, any>>()
    const ChartMock = vi.fn(function (this: Record<string, any>, target: HTMLCanvasElement, config: Record<string, any>) {
      this.canvas = target
      this.data = config.data
      this.options = config.options
      this.resize = vi.fn()
      this.update = vi.fn()
      this.destroy = vi.fn()
      instances.set(target, this)
    }) as unknown as ReturnType<typeof vi.fn> & {
      getChart: ReturnType<typeof vi.fn>
    }
    ChartMock.getChart = vi.fn((target: HTMLCanvasElement) => instances.get(target) || null)
    ;(globalThis as Record<string, unknown>).Chart = ChartMock
    return {
      ChartMock,
      restore: () => {
        if (previousChart === undefined) {
          delete (globalThis as Record<string, unknown>).Chart
        } else {
          ;(globalThis as Record<string, unknown>).Chart = previousChart
        }
      }
    }
  }

  it('keeps category axis labels instead of displaying numeric indexes', () => {
    const { PPT } = setupRuntime()
    document.body.innerHTML = '<canvas id="chart"></canvas>'

    const { restore } = installMockChart()

    try {
      const chart = (PPT.createChart as Function)(document.getElementById('chart'), {
        type: 'line',
        data: {
          labels: ['2000', '2005', '2010'],
          datasets: [{ data: [21.5, 20.3, 19.2] }]
        },
        options: {
          scales: {
            x: { type: 'category', ticks: {} },
            y: { ticks: {} }
          }
        }
      })

      const xCallback = chart.options.scales.x.ticks.callback
      const yCallback = chart.options.scales.y.ticks.callback
      const categoryScale = {
        getLabelForValue: (value: number) => chart.data.labels[value]
      }

      expect(xCallback.call(categoryScale, 1)).toBe('2005')
      expect(yCallback(20.300000000000004)).toBe('20.3')
    } finally {
      restore()
    }
  })

  it('keeps category labels when updateChart replaces options', () => {
    const { PPT } = setupRuntime()
    document.body.innerHTML = '<canvas id="chart"></canvas>'

    const { restore } = installMockChart()

    try {
      const canvas = document.getElementById('chart')
      const chart = (PPT.createChart as Function)(canvas, {
        type: 'bar',
        data: {
          labels: ['North', 'South'],
          datasets: [{ data: [10, 20] }]
        },
        options: {}
      })

      ;(PPT.updateChart as Function)(canvas, {
        options: {
          scales: {
            x: { ticks: {} }
          }
        }
      })

      const xCallback = chart.options.scales.x.ticks.callback
      const categoryScale = {
        getLabelForValue: (value: number) => chart.data.labels[value]
      }

      expect(xCallback.call(categoryScale, 1)).toBe('South')
    } finally {
      restore()
    }
  })

  it('uses the value axis in horizontal bar tooltips', () => {
    const { PPT } = setupRuntime()
    document.body.innerHTML = '<canvas id="chart"></canvas>'

    const { restore } = installMockChart()

    try {
      const chart = (PPT.createChart as Function)(document.getElementById('chart'), {
        type: 'bar',
        data: {
          labels: ['North', 'South'],
          datasets: [{ label: 'Revenue', data: [10, 20] }]
        },
        options: {
          indexAxis: 'y'
        }
      })

      const labelCallback = chart.options.plugins.tooltip.callbacks.label
      expect(labelCallback({
        chart,
        dataset: { label: 'Revenue' },
        parsed: { x: 20.300000000000004, y: 1 },
        raw: 20.300000000000004
      })).toBe('Revenue: 20.3')
    } finally {
      restore()
    }
  })
})

describe('Version guard', () => {
  it('runtime version is 2.0.17', () => {
    const PPT = setupRuntime().PPT
    expect(PPT.__runtimeVersion).toBe('2.0.17')
  })
})
