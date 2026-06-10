# Data Anim Reference

Deep-dive into how data-anim works, timing internals, trigger mechanics, scripted animation patterns, and composition examples.

## How data-anim maps to anime.js

Each `data-anim` type generates specific anime.js parameters:

| data-anim | Effect | anime.js params |
|---|---|---|
| `fade` | Simple opacity transition | `opacity: [0, 1]` |
| `fade-up` | Fade + slide up 20px | `opacity: [0, 1]`, `translateY: [20, 0]` |
| `fade-down` | Fade + slide down 20px | `opacity: [0, 1]`, `translateY: [-20, 0]` |
| `fade-left` | Fade + slide from right 20px | `opacity: [0, 1]`, `translateX: [20, 0]` |
| `fade-right` | Fade + slide from left 20px | `opacity: [0, 1]`, `translateX: [-20, 0]` |
| `scale-in` | Fade + scale from 85% | `opacity: [0, 1]`, `scale: [0.85, 1]` |
| `slide-up` | Larger slide up 40px | `opacity: [0, 1]`, `translateY: [40, 0]` |
| `slide-down` | Larger slide down 40px | `opacity: [0, 1]`, `translateY: [-40, 0]` |
| `slide-left` | Larger slide from right 40px | `opacity: [0, 1]`, `translateX: [40, 0]` |
| `slide-right` | Larger slide from left 40px | `opacity: [0, 1]`, `translateX: [-40, 0]` |
| `fly-in` | Directional entrance, 40px | `opacity: [0, 1]` + translateX/Y based on `from` |
| `wipe` | Clip-path reveal | `opacity: [0, 1]`, `clipPath: [hidden, 'inset(0%)']` |
| `zoom-in` | Dramatic scale from 75% | `opacity: [0, 1]`, `scale: [0.75, 1]` |
| `spin-in` | Rotate + scale | `opacity: [0, 1]`, `rotate: [-12, 0]`, `scale: [0.92, 1]` |
| `grow-shrink-soft` | Gentle emphasis pulse | `scale: [0.95, 1.04, 1]` |
| `grow-shrink` | Emphasis pulse (no fade) | `scale: [0.9, 1.08, 1]` |
| `grow-shrink-strong` | Strong emphasis pulse | `scale: [0.85, 1.12, 1]` |
| `pulse-soft` | Very subtle attention | `scale: [1, 1.03, 1]` |
| `pulse` | Subtle emphasis (no fade) | `scale: [1, 1.06, 1]` |
| `pulse-strong` | Strong attention pulse | `scale: [1, 1.1, 1]` |
| `exit-fade` | Fade out | `opacity: [1, 0]` |
| `exit-scale` | Soft scale-down exit | `opacity: [1, 0]`, `scale: [1, 0.85]` |
| `exit-zoom` | Strong scale-down exit | `opacity: [1, 0]`, `scale: [1, 0.75]` |
| `exit-wipe` | Directional wipe out | `opacity: [1, 0]`, `clipPath: [visible, hidden]` |
| `exit-fly` | Fly out in direction | `opacity: [1, 0]` + translate out based on `from` |
| `path` | Motion along constrained linear path | translateX/Y derived from an inline start/end delta |

### Path boundary

For the editable/exportable lane, `data-anim="path"` is intentionally constrained:

- use an inline linear path string such as `M 0 0 L 120 30`
- do not use a DOM selector such as `#curve`
- do not use rich SVG draw/morph/path choreography here

Reason:

- the current export/import chain can preserve a linear delta
- it cannot preserve arbitrary SVG path semantics as stable editable PPTX motion

## Attribute defaults and ranges

| Attribute | Default | Range / Notes |
|---|---|---|
| `data-anim-trigger` | `load` | `load`, `with`, `after`, `click` |
| `data-anim-sequence` | unset | `with`, `after`. Preferred load-order control for new content. |
| `data-anim-click-group` | unset | Stable token. Only for contiguous `click` animations sharing one reveal step. |
| `data-anim-duration` | 500ms | Clamped to 100–5000ms. Prefer 300–1200ms |
| `data-anim-delay` | 0 | Milliseconds, or `stagger(N)` |
| `data-anim-stagger` | unset | Millisecond gap. Preferred over `stagger(N)` for new content. |
| `data-anim-from` | Type-dependent | `left`, `right`, `top`, `bottom`, `center` |
| `data-anim-easing` | runtime-only | Compatibility only. Do not use in standard editable/exportable pages. |
| `data-anim-repeat` | runtime-only | Compatibility only. Do not use in standard editable/exportable pages. |
| `data-anim-direction` | runtime-only | Compatibility only. Do not use in standard editable/exportable pages. |

## How stagger() works

`stagger(N)` uses per-trigger-group counters. Within the same trigger group (all `load` elements share one counter, all `click` elements share another):

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

Good stagger values:
- 60–80ms: tight, energetic cascade (cards, metrics)
- 90–120ms: comfortable, readable sequence (list items, steps)
- 150–200ms: dramatic, deliberate reveal (key points, sections)

Preferred new syntax:

```html
<div data-anim="fade-up" data-anim-stagger="120">Card A</div>
<div data-anim="fade-up" data-anim-stagger="120">Card B</div>
<div data-anim="fade-up" data-anim-stagger="120">Card C</div>
```

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

### click-group

Use `data-anim-click-group` when several adjacent click-triggered elements must reveal on the same click step:

```html
<div data-anim="fade-up" data-anim-trigger="click" data-anim-click-group="reveal">Headline</div>
<div data-anim="pulse-soft" data-anim-trigger="click" data-anim-click-group="reveal">Badge</div>
<div data-anim="fade" data-anim-trigger="click">Next click step</div>
```

Rules:

- only use it with `data-anim-trigger="click"`
- keep the grouped elements contiguous in DOM order
- use a stable token such as `reveal`, `step-1`, or `milestone-a`
- do not use it as a general timeline language

Export behavior:

- contiguous grouped click animations compile into one PPTX build step
- the first element becomes the step leader and the following grouped elements become with-effects
- if the DOM order breaks the group, it becomes a different click step

## Preview-only boundary

- Keep the editable public lane centered on whole-element motion.
- `splitText`, per-letter/per-word reveal, SVG morph/draw helpers, and arbitrary motion-path choreography should not be normalized into standard editable page content.
- If these richer anime capabilities are explored later, they should live behind a dedicated preview-only lane with explicit expectations that editable PPTX guarantees do not apply.
- `data-anim-easing`, `data-anim-repeat`, and `data-anim-direction` currently live in the same category: runtime-only compatibility, not stable editable/exportable semantics.

## Initial hidden states

The runtime handles hidden states automatically. Here's how:

- **load/with/after triggers**: no hidden state applied. The element animates from the `[from, to]` values directly.
- **click-triggered entrance animations** (fade, fade-up, slide-up, zoom-in, etc.): the runtime sets `opacity: 0` and an appropriate `transform` inline, then marks the element with `data-ppt-anim-initialized="1"`.
- **click-triggered emphasis/exit animations** (`pulse-soft`, `pulse`, `pulse-strong`, `grow-shrink-soft`, `grow-shrink`, `grow-shrink-strong`, `exit-fade`, `exit-scale`, `exit-zoom`, `exit-wipe`, `exit-fly`): no hidden state — the element is already visible.

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
| Very subtle attention | `pulse-soft` | Tight KPI polish, low-distraction |
| Subtle attention | `pulse` | Default emphasis for key metrics |
| Strong attention | `pulse-strong` | Escalations, urgent callouts |
| Gentle grow and settle | `grow-shrink-soft` | Confirmation and secondary emphasis |
| Grow and settle | `grow-shrink` | Important callouts |
| Strong grow and settle | `grow-shrink-strong` | High-priority moments, use sparingly |

These bounded emphasis labels are preferred over custom scale arrays because the PPTX export path preserves them through distinct native scale ranges.

### Exit animations (elements leaving)

| Goal | Type | Notes |
|---|---|---|
| Simple fade-out | `exit-fade` | Replacing content |
| Soft scale-down exit | `exit-scale` | Quietly retiring chips, secondary panels, low-drama removals |
| Strong scale-down exit | `exit-zoom` | Hero outro, spotlight handoff, more theatrical exits |
| Directional wipe-out | `exit-wipe` + `from` | Remove banners, process bars, transient callouts |
| Fly off screen | `exit-fly` + `from` | Dramatic exits |

These exit scale labels are preferred over ad hoc scale arrays because the PPTX export path preserves them through distinct native exit scale ranges and the importer can map those ranges back to the same semantic labels.

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
<div data-anim="pulse" data-anim-duration="600">
  <p class="text-xl font-bold text-red-600">Critical Risk</p>
  <p class="text-base">Action required before Q3.</p>
</div>
```

### Click-group with bounded emphasis

```html
<div class="flex items-center gap-3">
  <div data-anim="fade-up" data-anim-trigger="click" data-anim-click-group="reveal">
    Launch risk
  </div>
  <div data-anim="pulse-strong" data-anim-trigger="click" data-anim-click-group="reveal">
    Immediate action
  </div>
</div>
<div data-anim="grow-shrink-soft" data-anim-trigger="click">
  Follow-up mitigation
</div>
```

## Scripted animation escape hatch

Use `PPT.animate(targets, params)` only when `data-anim` cannot express the motion — complex timelines, synchronized choreography, or custom easing curves.

```js
// Staggered card entrance with custom curve
PPT.animate(".metric-card", {
  opacity: [0, 1],
  translateY: [30, 0],
  duration: 500,
  delay: PPT.stagger(100),
  easing: 'easeOutCubic'
})
```

### PPT.animate vs data-anim

| | data-anim | PPT.animate |
|---|---|---|
| Export to PPTX | Yes, deterministic | Partial |
| Syntax | HTML attributes | JavaScript |
| Best for | Standard entrance/emphasis/exit | Complex timelines, synchronized groups |
| Initial state | Managed automatically | Managed automatically |

### Timeline for multi-step choreography

```js
var tl = PPT.createTimeline(".step-card", {
  opacity: [0, 1],
  duration: 400
})
tl.add({ targets: ".step-1", translateY: [20, 0] }, 0)
tl.add({ targets: ".step-2", translateY: [20, 0] }, 200)
tl.add({ targets: ".step-3", translateY: [20, 0] }, 400)
```

### Scripted stagger

```js
PPT.animate(".card", {
  opacity: [0, 1],
  scale: [0.9, 1],
  delay: PPT.stagger(80, { start: 200 })
})
```

`PPT.stagger(ms)` is a passthrough to `anime.stagger()` when available, with a built-in fallback.

## Easing selection guide

| Easing | Feel | Best for |
|---|---|---|
| `easeOutCubic` (default) | Smooth deceleration | Most entrance animations |
| `easeOutQuad` | Gentle deceleration | Subtle fades, text |
| `easeInOutQuad` | Smooth start and end | Movement across distance |
| `easeOutExpo` | Snappy stop | Dramatic entrances, hero numbers |
| `spring` | Natural bounce | Playful, emphasis |

## Print and export behavior

In print mode (`?print=1`), `PPT.animate` does not run anime.js. Instead, it computes the final animated CSS values and applies them as inline styles. This ensures charts and animated elements are fully visible in screenshots and PDF exports.

Elements with `data-ppt-anim-initialized="1"` have their animation styles cleared when entering edit mode, so they remain visible and editable.
