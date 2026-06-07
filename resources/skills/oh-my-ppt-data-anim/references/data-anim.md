# Data Anim Reference

Deep-dive into how data-anim works, timing internals, trigger mechanics, scripted animation patterns, and composition examples.

## How data-anim maps to runtime motion

Each `data-anim` type generates a normalized motion description. The runtime executes it through the internal `PPT.*` bridge:

| data-anim | Effect | Runtime from → to values |
|---|---|---|
| `fade` | Simple opacity transition | `opacity: 0 → 1` |
| `fade-up` | Fade + slide up 20px | `opacity: 0 → 1`, `y: 20 → 0` |
| `fade-down` | Fade + slide down 20px | `opacity: 0 → 1`, `y: -20 → 0` |
| `fade-left` | Fade + slide from right 20px | `opacity: 0 → 1`, `x: 20 → 0` |
| `fade-right` | Fade + slide from left 20px | `opacity: 0 → 1`, `x: -20 → 0` |
| `scale-in` | Fade + scale from 85% | `opacity: 0 → 1`, `scale: 0.85 → 1` |
| `slide-up` | Larger slide up 40px | `opacity: 0 → 1`, `y: 40 → 0` |
| `slide-down` | Larger slide down 40px | `opacity: 0 → 1`, `y: -40 → 0` |
| `slide-left` | Larger slide from right 40px | `opacity: 0 → 1`, `x: 40 → 0` |
| `slide-right` | Larger slide from left 40px | `opacity: 0 → 1`, `x: -40 → 0` |
| `fly-in` | Directional entrance, 40px | `opacity: 0 → 1` + x/y based on `from` |
| `wipe` | Clip-path reveal | `opacity: 0 → 1`, clip-path animated |
| `zoom-in` | Dramatic scale from 75% | `opacity: 0 → 1`, `scale: 0.75 → 1` |
| `spin-in` | Rotate + scale | `opacity: 0 → 1`, `rotation: -12 → 0`, `scale: 0.92 → 1` |
| `grow-shrink` | Emphasis pulse (no fade) | `scale: 0.9 → 1.08`, yoyo, repeat:1 |
| `pulse` | Subtle emphasis (no fade) | `scale: 1 → 1.06`, yoyo, repeat:1 |
| `exit-fade` | Fade out | `opacity: 1 → 0` |
| `exit-wipe` | Directional wipe out | `opacity: 1 → 0`, clip-path concealed by `from` |
| `exit-fly` | Fly out in direction | `opacity: 1 → 0` + x/y out based on `from` |
| `path` | Motion along SVG path | translateX/Y derived from path delta |

## Attribute defaults and ranges

| Attribute | Default | Range / Notes |
|---|---|---|
| `data-anim-trigger` | `load` | `load`, `with`, `after`, `click` |
| `data-anim-sequence` | unset | `with`, `after`. Preferred load-order control for new content. |
| `data-anim-duration` | 500ms | Clamped to 100–5000ms. Prefer 300–1200ms |
| `data-anim-delay` | 0 | Milliseconds, or `stagger(N)` |
| `data-anim-stagger` | unset | Millisecond gap. Preferred over `stagger(N)` for new content. |
| `data-anim-easing` | `easeOutCubic` | Prefer GSAP-compatible names: `power2.out`, `power3.out`, `back.out`, etc. Legacy anime.js names are translated. |
| `data-anim-from` | Type-dependent | `left`, `right`, `top`, `bottom`, `center` |
| `data-anim-repeat` | None | Number (max 20) or `infinite` |
| `data-anim-direction` | `normal` | `normal`, `reverse`, `alternate` |

## Fidelity-aware defaults

- **Best editable/export fidelity**: `fade`, `fade-up`, `fade-down`, `fade-left`, `fade-right`, `scale-in`, `wipe`, `exit-fade`
- **Stable but approximate**: `slide-up`, `slide-down`, `slide-left`, `slide-right`, `fly-in`, `exit-wipe`
- **Supported but weaker roundtrip fidelity**: `zoom-in`, `spin-in`, `grow-shrink`, `pulse`, `path`

When the user does not ask for a specific effect, prefer the first group. Use the second group when direction itself is part of the message. Use the third group only when the semantic trade-off is acceptable.

## How stagger() works

`stagger(N)` and `data-anim-stagger="N"` both use per-trigger-group counters. Within the same trigger group (all `load` elements share one counter, all `click` elements share another):

- 1st element with `stagger(100)` → delay = 0
- 2nd element with `stagger(100)` → delay = 100
- 3rd element with `stagger(100)` → delay = 200
- 4th element with `stagger(100)` → delay = 300

This creates a cascade without needing to manually specify each delay.

```html
<div data-anim="fade-up" data-anim-delay="stagger(120)">Card A</div>
<!-- delay: 0 -->
<div data-anim="fade-up" data-anim-delay="stagger(120)">Card B</div>
<!-- delay: 120 -->
<div data-anim="fade-up" data-anim-delay="stagger(120)">Card C</div>
<!-- delay: 240 -->
```

Preferred new syntax:

```html
<div data-anim="fade-up" data-anim-stagger="120">Card A</div>
<div data-anim="fade-up" data-anim-stagger="120">Card B</div>
<div data-anim="fade-up" data-anim-stagger="120">Card C</div>
```

Good stagger values:
- 60–80ms: tight, energetic cascade (cards, metrics)
- 90–120ms: comfortable, readable sequence (list items, steps)
- 150–200ms: dramatic, deliberate reveal (key points, sections)

## Trigger mechanics in detail

### load (default)

Animation plays immediately when the page renders. The runtime scans all `[data-anim]` elements and plays load-triggered animations right away.

```html
<h2 data-anim="fade-up">Title</h2>
<p data-anim="fade-up" data-anim-delay="200">Subtitle appears 200ms later</p>
```

### with

Starts at the same time as the previous animated element. Use for grouping: a title and its subtitle should appear together, not sequentially.

```html
<div class="grid grid-cols-2 gap-4">
  <div data-anim="fade-up" data-anim-delay="stagger(100)">
    <h3>Point A</h3>
    <p>Detail for A</p>
  </div>
  <div data-anim="fade-up" data-anim-delay="stagger(100)">
    <h3>Point B</h3>
    <p>Detail for B</p>
  </div>
</div>
```

### after

Starts after the previous animation finishes (previous delay + duration). Use for short sequences that tell a story.

```html
<div data-anim="fade-up">Step 1: Identify</div>
<div data-anim="fade-up" data-anim-trigger="after">Step 2: Analyze</div>
<div data-anim="fade-up" data-anim-trigger="after">Step 3: Act</div>
```

The runtime tracks `lastSequenceEnd` internally. Each `after` element's effective delay = previous element's delay + duration.

For new content, prefer `data-anim-sequence="with|after"` and keep `data-anim-trigger` focused on actual trigger semantics:

```html
<div data-anim="fade-up">Step 1: Identify</div>
<div data-anim="fade" data-anim-sequence="with" data-anim-delay="80">Supporting note</div>
<div data-anim="fade-up" data-anim-sequence="after">Step 2: Analyze</div>
```

### click

Waits for the user to click/press. The runtime maintains a click state machine — each click advances to the next animation.

```html
<div data-anim="zoom-in" data-anim-trigger="click">Reveal on first click</div>
<div data-anim="zoom-in" data-anim-trigger="click">Reveal on second click</div>
```

Click is for explicit presentation control. Do not use click for timelines, processes, or steps — those work better with `stagger` or `after`.

## Initial hidden states

The runtime handles hidden states automatically. Here's how:

- **load/with/after triggers**: no hidden state applied. The element animates from the `[from, to]` values directly.
- **click-triggered entrance animations** (fade, fade-up, slide-up, slide-down, slide-left, slide-right, zoom-in, etc.): the runtime sets `opacity: 0` and an appropriate `transform` inline, then marks the element with `data-ppt-anim-initialized="1"`.
- **click-triggered emphasis/exit animations** (pulse, grow-shrink, exit-fade, exit-wipe, exit-fly): no hidden state — the element is already visible.

Do not manually set `opacity: 0`, `visibility: hidden`, `display: none`, or inline `opacity:0` on animated elements. The runtime handles this, and manual hidden states conflict with the animation system.

## Type selection guide

### Entrance animations (elements appearing)

| Goal | Type | Notes |
|---|---|---|
| Subtle fade-in | `fade` | For text blocks, annotations |
| Standard card entrance | `fade-up` | Default choice for most elements |
| Directional emphasis | `fly-in` + `from` | Metrics flying in from the side |
| Strong directional entrance | `slide-down` / `slide-right` | When fade-up/left is too subtle but wipe is too hard-edged |
| Dramatic hero reveal | `zoom-in` | Key numbers, hero images |
| Slide-in bar | `wipe` + `from` | Progress bars, timeline segments |
| Playful entrance | `spin-in` | Use sparingly for emphasis |

### Emphasis animations (already visible elements)

| Goal | Type | Notes |
|---|---|---|
| Subtle attention | `pulse` | 1–2 repeats for key metrics |
| Grow and settle | `grow-shrink` | Important callouts |

### Exit animations (elements leaving)

| Goal | Type | Notes |
|---|---|---|
| Simple fade-out | `exit-fade` | Replacing content |
| Directional wipe-out | `exit-wipe` + `from` | Remove banners, process bars, transient callouts |
| Fly off screen | `exit-fly` + `from` | Dramatic exits |

## Composition patterns

### Staggered card grid

```html
<div class="grid grid-cols-3 gap-4">
  <div data-anim="fade-up" data-anim-delay="stagger(100)">
    <p class="text-3xl font-bold">$12M</p>
    <p class="text-base text-gray-500">Revenue</p>
  </div>
  <div data-anim="fade-up" data-anim-delay="stagger(100)">
    <p class="text-3xl font-bold">86%</p>
    <p class="text-base text-gray-500">Retention</p>
  </div>
  <div data-anim="fade-up" data-anim-delay="stagger(100)">
    <p class="text-3xl font-bold">2.4x</p>
    <p class="text-base text-gray-500">ROI</p>
  </div>
</div>
```

### Title + content sequence

```html
<h2 data-anim="fade-up" data-anim-duration="600">Key Insight</h2>
<p data-anim="fade" data-anim-trigger="with" data-anim-delay="100" data-anim-duration="500">
  Supporting explanation appears alongside the title.
</p>
<div data-anim="fade-up" data-anim-trigger="after" data-anim-duration="500">
  Evidence card appears after title finishes.
</div>
```

### Directional fly-in from different sides

```html
<div class="grid grid-cols-2 gap-6">
  <div data-anim="fly-in" data-anim-from="left">
    <h3>Challenge</h3>
    <p>Traditional approaches fall short.</p>
  </div>
  <div data-anim="fly-in" data-anim-from="right">
    <h3>Solution</h3>
    <p>Our approach addresses this directly.</p>
  </div>
</div>
```

### Hero number with zoom + supporting cards

```html
<div class="flex flex-col gap-6">
  <div data-anim="zoom-in" data-anim-duration="800">
    <p class="text-5xl font-bold">42%</p>
    <p class="text-base text-gray-500">Market Growth</p>
  </div>
  <div class="grid grid-cols-3 gap-4">
    <div data-anim="fade-up" data-anim-delay="stagger(80)">Card 1</div>
    <div data-anim="fade-up" data-anim-delay="stagger(80)">Card 2</div>
    <div data-anim="fade-up" data-anim-delay="stagger(80)">Card 3</div>
  </div>
</div>
```

### Emphasis pulse on a key risk

```html
<div data-anim="pulse" data-anim-repeat="2" data-anim-direction="alternate" data-anim-duration="600">
  <p class="text-xl font-bold text-red-600">Critical Risk</p>
  <p class="text-base">Action required before Q3.</p>
</div>
```

## Scripted animation escape hatch

Use `PPT.animate(targets, params)` only when `data-anim` cannot express the motion — complex timelines, synchronized choreography, or custom easing curves. PPT.animate delegates to the internal GSAP bridge for high-performance tweening.

```js
// Staggered card entrance with custom curve
PPT.animate(".metric-card", {
  opacity: [0, 1],
  translateY: [30, 0],
  duration: 500,
  delay: PPT.stagger(100),
  easing: 'power2.out'
})
```

### PPT.animate vs data-anim

| | data-anim | PPT.animate |
|---|---|---|
| Export to PPTX | Yes, deterministic | Partial |
| Syntax | HTML attributes | JavaScript |
| Runtime engine | Internal PPT bridge | Internal PPT bridge |
| Best for | Standard entrance/emphasis/exit | Complex timelines, synchronized groups |
| Initial state | Managed automatically | Managed automatically |

### Timeline for multi-step choreography

```js
var tl = PPT.createTimeline()
tl.add({ targets: ".step-1", opacity: [0, 1], translateY: [20, 0], duration: 400 })
tl.add({ targets: ".step-2", opacity: [0, 1], translateY: [20, 0] }, "+=0.2")
tl.add({ targets: ".step-3", opacity: [0, 1], translateY: [20, 0] }, "+=0.2")
```

Do not call `gsap.timeline()` directly. `PPT.createTimeline().add(...)` accepts the Oh My PPT `{ targets, ...params }` shape and delegates to the internal runtime bridge.

### Scripted stagger

```js
PPT.animate(".card", {
  opacity: [0, 1],
  scale: [0.9, 1],
  delay: PPT.stagger(80, { start: 200 })
})
```

`PPT.stagger(ms)` delegates through the internal runtime bridge and keeps millisecond-based PPT API semantics.

## Easing selection guide

GSAP easing names use the format `{curve}.{type}` (e.g., `power2.out`, `back.inOut`). Legacy anime.js names (`easeOutCubic`, `easeInOutQuad`) are translated automatically.

| Easing | GSAP Name | Feel | Best for |
|---|---|---|---|
| easeOutCubic | `power2.out` (default) | Smooth deceleration | Most entrance animations |
| easeOutQuad | `power1.out` | Gentle deceleration | Subtle fades, text |
| easeInOutQuad | `power1.inOut` | Smooth start and end | Movement across distance |
| easeOutExpo | `power4.out` | Snappy stop | Dramatic entrances, hero numbers |
| easeOutBack | `back.out` | Overshoot and settle | Playful, emphasis |
| easeOutElastic | `elastic.out` | Bouncy arrival | Attention-grabbing, hero sections |
| easeOutBounce | `bounce.out` | Gravity bounce | Fun, casual transitions |

## Print and export behavior

In print mode (`?print=1`), `PPT.animate` does not run the animation engine. Instead, it computes the final animated CSS values and applies them as inline styles. This ensures charts and animated elements are fully visible in screenshots and PDF exports. Any active internal runtime animations are force-completed before capture.

Elements with `data-ppt-anim-initialized="1"` have their animation styles cleared when entering edit mode, so they remain visible and editable.
