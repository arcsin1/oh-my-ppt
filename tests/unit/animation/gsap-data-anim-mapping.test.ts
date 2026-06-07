/**
 * @vitest-environment node
 *
 * Unit tests: GSAP data-anim mapping correctness.
 * Validates that each DataAnimType maps to correct GSAP fromVars/toVars.
 */
import { describe, it, expect } from 'vitest'

// Replicate the mapping logic from ppt-runtime.js for testing.
// This is the same switch/case that executeDataAnimConfig uses,
// but translated to GSAP's API shape (fromVars + toVars for gsap.fromTo).

type GsapVars = Record<string, number>

interface AnimMapping {
  from: GsapVars
  to: GsapVars
}

const FLY_DISTANCE = 40

function getFlyDirection(side: string): { key: string; value: number } | { key: string; value: number } {
  switch (side) {
    case 'left':   return { key: 'x', value: -FLY_DISTANCE }
    case 'right':  return { key: 'x', value: FLY_DISTANCE }
    case 'top':    return { key: 'y', value: -FLY_DISTANCE }
    case 'center': return { key: 'scale', value: 0.9 }
    case 'bottom':
    default:       return { key: 'y', value: FLY_DISTANCE }
  }
}

function mapDataAnimToGsap(type: string, from?: string): AnimMapping {
  const fromVars: GsapVars = {}
  const toVars: GsapVars = { duration: 0.5, ease: 'power2.out' }

  switch (type) {
    case 'fade':
      fromVars.opacity = 0
      toVars.opacity = 1
      break
    case 'fade-up':
      fromVars.opacity = 0; fromVars.y = 20
      toVars.opacity = 1;   toVars.y = 0
      break
    case 'fade-down':
      fromVars.opacity = 0; fromVars.y = -20
      toVars.opacity = 1;   toVars.y = 0
      break
    case 'fade-left':
      fromVars.opacity = 0; fromVars.x = 20
      toVars.opacity = 1;   toVars.x = 0
      break
    case 'fade-right':
      fromVars.opacity = 0; fromVars.x = -20
      toVars.opacity = 1;   toVars.x = 0
      break
    case 'scale-in':
      fromVars.opacity = 0; fromVars.scale = 0.85
      toVars.opacity = 1;   toVars.scale = 1
      break
    case 'slide-up':
      fromVars.opacity = 0; fromVars.y = 40
      toVars.opacity = 1;   toVars.y = 0
      break
    case 'slide-left':
      fromVars.opacity = 0; fromVars.x = 40
      toVars.opacity = 1;   toVars.x = 0
      break
    case 'fly-in': {
      const fly = getFlyDirection(from || 'bottom')
      fromVars.opacity = 0
      if (fly.key === 'scale') {
        fromVars.scale = fly.value as number
      } else {
        const axisKey = fly.key === 'x' ? 'x' : 'y'
        fromVars[axisKey] = fly.value as number
      }
      toVars.opacity = 1
      toVars.x = 0; toVars.y = 0; toVars.scale = 1
      break
    }
    case 'wipe':
      fromVars.opacity = 0
      toVars.opacity = 1
      break
    case 'zoom-in':
      fromVars.opacity = 0; fromVars.scale = 0.75
      toVars.opacity = 1;   toVars.scale = 1
      break
    case 'spin-in':
      fromVars.opacity = 0;   fromVars.scale = 0.92; fromVars.rotation = -12
      toVars.opacity = 1;     toVars.scale = 1;      toVars.rotation = 0
      break
    case 'grow-shrink':
      fromVars.scale = 0.9
      toVars.scale = 1.08; toVars.yoyo = 1; toVars.repeat = 1
      break
    case 'pulse':
      fromVars.scale = 1
      toVars.scale = 1.06; toVars.yoyo = 1; toVars.repeat = 1
      break
    case 'exit-fade':
      fromVars.opacity = 1
      toVars.opacity = 0
      break
    case 'exit-fly': {
      const exitDir = getFlyDirection(from || 'bottom')
      fromVars.opacity = 1
      toVars.opacity = 0
      if (exitDir.key === 'scale') {
        toVars.scale = 0.9
      } else if (exitDir.key === 'x') {
        toVars.x = exitDir.value as number
      } else {
        toVars.y = exitDir.value as number
      }
      break
    }
    default:
      fromVars.opacity = 0; fromVars.y = 20
      toVars.opacity = 1;   toVars.y = 0
  }

  return { from: fromVars, to: toVars }
}

// ─── Tests ─────────────────────────────────────────────────────

describe('data-anim → GSAP vars mapping', () => {
  it('maps fade to opacity-only animation', () => {
    const { from, to } = mapDataAnimToGsap('fade')
    expect(from).toEqual({ opacity: 0 })
    expect(to.opacity).toBe(1)
  })

  it('maps fade-up to opacity + y translation', () => {
    const { from, to } = mapDataAnimToGsap('fade-up')
    expect(from.opacity).toBe(0)
    expect(from.y).toBe(20)
    expect(to.y).toBe(0)
  })

  it('maps fade-down with negative y direction', () => {
    const { from } = mapDataAnimToGsap('fade-down')
    expect(from.y).toBe(-20)
  })

  it('maps fade-left with positive x (enters from right)', () => {
    const { from } = mapDataAnimToGsap('fade-left')
    expect(from.x).toBe(20)
  })

  it('maps fade-right with negative x (enters from left)', () => {
    const { from } = mapDataAnimToGsap('fade-right')
    expect(from.x).toBe(-20)
  })

  it('maps scale-in with opacity and scale', () => {
    const { from, to } = mapDataAnimToGsap('scale-in')
    expect(from.scale).toBe(0.85)
    expect(from.opacity).toBe(0)
    expect(to.scale).toBe(1)
  })

  it('maps slide-up with larger y offset than fade-up', () => {
    const { from: fadeUp } = mapDataAnimToGsap('fade-up')
    const { from: slideUp } = mapDataAnimToGsap('slide-up')
    expect(slideUp.y).toBeGreaterThan(fadeUp.y!)
    expect(slideUp.y).toBe(40)
  })

  it('maps zoom-in with smaller scale from than scale-in', () => {
    const { from: scaleIn } = mapDataAnimToGsap('scale-in')
    const { from: zoomIn } = mapDataAnimToGsap('zoom-in')
    expect(zoomIn.scale).toBeLessThan(scaleIn.scale!)
    expect(zoomIn.scale).toBe(0.75)
  })

  it('maps spin-in with rotation and scale', () => {
    const { from, to } = mapDataAnimToGsap('spin-in')
    expect(from.rotation).toBe(-12)
    expect(from.scale).toBe(0.92)
    expect(to.rotation).toBe(0)
  })

  it('maps fly-in with direction offset', () => {
    const { from: left } = mapDataAnimToGsap('fly-in', 'left')
    expect(left.x).toBe(-FLY_DISTANCE)

    const { from: right } = mapDataAnimToGsap('fly-in', 'right')
    expect(right.x).toBe(FLY_DISTANCE)

    const { from: center } = mapDataAnimToGsap('fly-in', 'center')
    expect(center.scale).toBe(0.9)
  })

  it('maps exit-fade with reversed opacity', () => {
    const { from, to } = mapDataAnimToGsap('exit-fade')
    expect(from.opacity).toBe(1)
    expect(to.opacity).toBe(0)
  })

  it('maps exit-fly with direction offset and reverse opacity', () => {
    const { to: bottomExit } = mapDataAnimToGsap('exit-fly', 'bottom')
    expect(bottomExit.y).toBe(FLY_DISTANCE)
    expect(bottomExit.opacity).toBe(0)

    const { to: topExit } = mapDataAnimToGsap('exit-fly', 'top')
    expect(topExit.y).toBe(-FLY_DISTANCE)
  })

  it('maps grow-shrink with yoyo repeat', () => {
    const { to } = mapDataAnimToGsap('grow-shrink')
    expect(to.scale).toBe(1.08)
    expect(to.yoyo).toBe(1)
    expect(to.repeat).toBe(1)
  })

  it('maps pulse with yoyo repeat (emphasis type)', () => {
    const { to } = mapDataAnimToGsap('pulse')
    expect(to.scale).toBe(1.06)
    expect(to.yoyo).toBe(1)
  })

  it('produces valid GSAP vars for all 17 supported types', () => {
    const types = [
      'fade', 'fade-up', 'fade-down', 'fade-left', 'fade-right',
      'scale-in', 'slide-up', 'slide-left', 'fly-in',
      'wipe', 'zoom-in', 'spin-in',
      'grow-shrink', 'pulse',
      'exit-fade', 'exit-fly', 'path'
    ]

    for (const type of types) {
      const { from, to } = mapDataAnimToGsap(type, 'bottom')
      expect(from, `${type}: fromVars must not be empty`).toBeDefined()
      expect(to, `${type}: toVars must not be empty`).toBeDefined()
      expect(Object.keys(from).length, `${type}: fromVars has no keys`)
        .toBeGreaterThan(0)
      expect(Object.keys(to).length, `${type}: toVars has no keys`)
        .toBeGreaterThan(0)
    }
  })

  it('maps path type to fallback fade-up', () => {
    const { from, to } = mapDataAnimToGsap('path')
    expect(from.opacity).toBe(0)
    expect(from.y).toBe(20)
    expect(to.opacity).toBe(1)
  })
})
