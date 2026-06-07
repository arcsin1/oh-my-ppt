# GSAP ↔ PPTX Animation Preset Mapping

## Fidelity Tiers

| Tier | Definition |
|------|-----------|
| **Exact** | Visual output is indistinguishable between GSAP preview and PPTX playback |
| **Good** | Minor timing/easing differences that require side-by-side comparison to detect |
| **Approximate** | Same general effect (e.g., "fades in from bottom") but precise values differ |
| **Degraded** | Core semantic is preserved but visual effect is noticeably different |
| **Play-Only** | No PPTX preset exists; must be pre-rendered as video |

## Complete Mapping Table

### Entrance Animations (presetClass='entr')

| data-anim type | GSAP Properties | PPTX presetId | PPTX subtype | PPTX motion | PPTX scale | Fidelity | Notes |
|---------------|-----------------|---------------|-------------|------------|-----------|----------|-------|
| `fade` | `opacity: 0→1` | 10 | — | — | — | **Exact** | Simplest mapping. No motion, no scale. |
| `fade-up` | `opacity: 0→1, y: 20→0` | 2 | 8 | fromBottom | — | **Good** | Runtime uses a lighter 20px offset than `slide-up`; PPTX still maps to the same entrance preset family. |
| `fade-down` | `opacity: 0→1, y: -20→0` | 2 | 1 | fromTop | — | **Good** | Same as fade-up, reversed direction. |
| `fade-left` | `opacity: 0→1, x: 20→0` | 2 | 3 | fromRight | — | **Good** | PPTX subtype 3 = "from right" (element enters from right = moves left). Direction naming is inverted relative to GSAP. |
| `fade-right` | `opacity: 0→1, x: -20→0` | 2 | 2 | fromLeft | — | **Good** | PPTX subtype 2 = "from left" (element enters from left = moves right). |
| `scale-in` | `opacity: 0→1, scale: 0.85→1` | 31 | — | — | 0.85→1.0 | **Approximate** | PPTX preset 31 uses fixed scale curve; GSAP uses configurable from-value. |
| `slide-up` | `opacity: 0→1, y: 40→0` | 2 | 8 | fromBottom | — | **Approximate** | Runtime intentionally keeps the fade component, but with a larger travel distance than `fade-up`. PPTX still collapses both to the same preset family. |
| `slide-left` | `opacity: 0→1, x: 40→0` | 2 | 3 | fromRight | — | **Approximate** | Same trade-off as `slide-up`: larger travel than `fade-left`, but no PPTX preset can preserve the distinction exactly. |
| `fly-in` | `opacity: 0→1, direction-based translate` | 2 | — | fromTrace | — | **Good** | Direction resolved from `data-anim-from`. PPTX uses actual motion path, GSAP uses directional translate. |
| `wipe` | `opacity: 0→1, clipPath edge reveal` | 5 | direction-based | — | — | **Approximate** | Runtime uses directional `clipPath` reveal values. PPTX export uses native wipe `presetSubtype` instead of clip-path, so the semantic is preserved but the rendering engine differs. |
| `zoom-in` | `opacity: 0→1, scale: 0.75→1` | 31 | — | — | 0.75→1.0 | **Approximate** | PPTX scale preset 31 has fixed zoom curve; GSAP 0.75 from-value is configurable. |
| `spin-in` | `opacity: 0→1, scale: 0.92→1, rotation: -15°→0` | 31 | — | — | 0.92→1.0 | **Degraded** | PPTX preset 31 has **no rotation component**. The spin effect is entirely lost in export. GSAP's rotation is not represented. |
| `path` | `opacity: 0→1` (degraded) | 10 | — | — | — | **Play-Only** | **SEMANTIC EMPTY**: Mapped as simple fade in v2.0. No path data exists in the protocol. Should be deprecated or implemented with motion-path support. |

### Emphasis Animations (presetClass='emph')

| data-anim type | GSAP Properties | PPTX presetId | PPTX subtype | PPTX motion | PPTX scale | Fidelity | Notes |
|---------------|-----------------|---------------|-------------|------------|-----------|----------|-------|
| `grow-shrink` | `scale: 0.9→1.08→0.9` (yoyo) | 6 | — | — | 0.9→1.08 | **Approximate** | PPTX preset 6 executes scale emphasis automatically. GSAP's explicit from/to/back values are lost. Behavior timing differs: PPTX auto-reverses, GSAP requires explicit yoyo. |
| `pulse` | `scale: 1→1.06→1` | 6 | — | — | 1.0→1.06 | **Approximate** | Same preset as grow-shrink but different scale range. PPTX can't distinguish these two types at export. Roundtrip: pulse → PPTX → import → grow-shrink (semantic loss). |

### Exit Animations (presetClass='exit')

| data-anim type | GSAP Properties | PPTX presetId | PPTX subtype | PPTX motion | PPTX scale | Fidelity | Notes |
|---------------|-----------------|---------------|-------------|------------|-----------|----------|-------|
| `exit-fade` | `opacity: 1→0` | 10 | — | — | — | **Exact** | transition='out' on the fade filter. |
| `exit-fly` | `opacity: 1→0, direction-based translate out` | 2 | — | fromTrace | — | **Good** | Direction resolved from `data-anim-from`. PPTX exit motion path is the inverse of the entrance. |

## Direction Mapping

| `data-anim-from` | GSAP Translate Origin | PPTX Motion | Wipe Filter |
|-----------------|----------------------|-------------|-------------|
| `top` | `y: -40` (from above) | fromTop | reveal from top edge |
| `bottom` | `y: 40` (from below) | fromBottom | reveal from bottom edge |
| `left` | `x: 40` (from left) | fromLeft | reveal from left edge |
| `right` | `x: -40` (from right) | fromRight | reveal from right edge |
| `center` | no translation | fromBottom (fallback) | inset reveal fallback |

**WARNING**: The semantic inversion in PPTX naming is a known trap.
- `data-anim-from="left"` means "fly in FROM the left side" → GSAP `x: 40` (positive offset) → PPTX `fromLeft` motion.
- This is **correct** — but confusing because PPTX describes the motion origin, not the destination.

## Easing Approximation

| GSAP Ease | PPTX Equivalent | Quality |
|-----------|----------------|---------|
| `none` (linear) | system-default (closest) | Degraded |
| `power*.out` | system-default | Acceptable — PPTX default easing resembles power2.out |
| `power*.in` | system-default | Degraded — PPTX has no "slow-start" easing |
| `back.out` | system-default | Degraded — overshoot is not preserved |
| `elastic.out` | system-default | Degraded — bounce is not preserved |
| `bounce.out` | system-default | Degraded |
| `sine.*` | system-default | Acceptable |
| CustomEase | system-default | Degraded — play-only candidate |

**Decision**: PPTX `p:animEffect` supports `filter="fade"` which uses fixed system easing. There is no standard OOXML attribute for custom easing curves. We accept this as an inherent limitation of the editable-export target.

## Structural Mapping

```
GSAP Timeline                    PPTX Timing XML
─────────────                    ───────────────
gsap.timeline()          →       <p:par> (root container)
  .add(tweenA, 0)        →         <p:par> (effect group, delay=0)
  .add(tweenB, 0.2)      →         <p:par> (effect group, delay=200ms)
  .add(tweenC, "+=0")    →         <p:par> (with-effect, same trigger)

gsap.from(el, {          →       <p:par nodeType="withEffect">
  opacity: 0,                     <p:animEffect filter="fade">       (opacity)
  y: 40                           <p:anim calcmode="lin">            (y-motion)
})                                  <p:attrName>ppt_y</p:attrName>
                                  </p:par>
```
