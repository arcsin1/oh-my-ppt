---
name: oh-my-ppt-data-anim
description: Must be read before adding or modifying Oh My PPT slide animations. Defines exportable data-anim usage, trigger decisions, and how to replace unsupported scripted/anime.js animation.
---

# Oh My PPT Data Anim

For deeper examples (trigger choice guide, scripted animation patterns, timing tips), read `references/data-anim.md`.

## When to use

- Adding entrance or emphasis animation to slide elements
- Creating staggered reveal sequences for cards, steps, or list items
- Repairing broken or unsupported animation

## When not to use

- Layout-only changes with no motion intent
- Adding animation in edit mode unless the user asks, the page already has animation, or you are fixing broken animation

## 30-second decision checklist

Before adding animation, answer these:

1. **Reading path**: which elements should appear first, second, third? Animation follows the reading path.
2. **Trigger**: load (default), stagger (repeated items), with (group together), after (sequence), click (presentation control only)?
3. **Type**: fade, slide, scale, fly, wipe, zoom, bounded emphasis — match the visual intent.
4. **Duration**: 300–1200ms. Shorter for subtle, longer for dramatic.

## How to add animation

### 1. Declarative data-anim — preferred

Add `data-anim` attributes directly on HTML elements. This works in preview and exports deterministically to PPTX.

```html
<div data-anim="fade-up" data-anim-delay="stagger(90)">Card 1</div>
<div data-anim="fade-up" data-anim-delay="stagger(90)">Card 2</div>
<div data-anim="fade-up" data-anim-delay="stagger(90)">Card 3</div>
```

### 2. Supported animation types

`fade`, `fade-up`, `fade-down`, `fade-left`, `fade-right`, `scale-in`, `slide-up`, `slide-down`, `slide-left`, `slide-right`, `fly-in`, `wipe`, `zoom-in`, `spin-in`, `grow-shrink-soft`, `grow-shrink`, `grow-shrink-strong`, `pulse-soft`, `pulse`, `pulse-strong`, `exit-fade`, `exit-scale`, `exit-zoom`, `exit-wipe`, `exit-fly`, `path`

### 3. Attributes

| Attribute | Values | Notes |
|---|---|---|
| `data-anim` | type from supported list | required |
| `data-anim-trigger` | `load`, `click`, `with`, `after` | omit for `load` |
| `data-anim-sequence` | `with`, `after` | preferred load-order control for new content |
| `data-anim-click-group` | stable token such as `step-1` | only for contiguous `click` animations that should reveal on the same click |
| `data-anim-from` | `left`, `right`, `top`, `bottom` | direction/origin |
| `data-anim-delay` | ms or `stagger(N)` | stagger for repeated items |
| `data-anim-stagger` | ms | preferred new declarative stagger gap |
| `data-anim-duration` | ms | prefer 300–1200 |
| `data-anim-path` | inline linear path string such as `M 0 0 L 120 30` | only for `path` type |

### 4. Trigger patterns

**stagger(N)** — repeated items appearing in sequence:
```html
<div data-anim="fade-up" data-anim-delay="stagger(90)">Point 1</div>
<div data-anim="fade-up" data-anim-delay="stagger(90)">Point 2</div>
```

**data-anim-stagger="N"** — preferred new syntax for repeated items:
```html
<div data-anim="fade-up" data-anim-stagger="90">Point 1</div>
<div data-anim="fade-up" data-anim-stagger="90">Point 2</div>
```

**with** — group starts together with previous animated element:
```html
<h2 data-anim="fade-up">Market Signal</h2>
<p data-anim="fade" data-anim-trigger="with" data-anim-delay="120">Supporting text.</p>
```

**after** — short auto-playing sequence:
```html
<div data-anim="fade-up">1. First</div>
<div data-anim="fade-up" data-anim-trigger="after">2. Second</div>
<div data-anim="fade-up" data-anim-trigger="after">3. Third</div>
```

For new content, prefer `data-anim-sequence` so trigger semantics stay separate from load ordering:
```html
<div data-anim="fade-up">1. First</div>
<div data-anim="fade" data-anim-sequence="with" data-anim-delay="80">Supporting note</div>
<div data-anim="fade-up" data-anim-sequence="after">2. Second</div>
```

**click** — only for explicit presentation control (step-by-step, one-by-one reveal). Use `load`, `stagger`, `with`, or `after` for timelines, processes, steps, and flows.

**click-group** — multiple contiguous click-triggered elements on the same build step:
```html
<div data-anim="fade-up" data-anim-trigger="click" data-anim-click-group="reveal">Headline</div>
<div data-anim="pulse-soft" data-anim-trigger="click" data-anim-click-group="reveal">Badge</div>
<div data-anim="fade" data-anim-trigger="click">Next click step</div>
```

- Use only on `data-anim-trigger="click"` elements.
- Keep the grouped elements contiguous in DOM order.
- Do not use click-group as a timeline DSL or to jump across unrelated click steps.

## Preview-only boundary

- Keep the standard editable lane focused on whole-element motion.
- `splitText`, per-letter/per-word choreography, SVG draw/morph helpers, and arbitrary path choreography are not part of the normal editable contract.
- The only supported path-like public motion in the editable lane is the constrained `data-anim="path"` semantic with an inline linear path string such as `M 0 0 L 120 30`. Richer path/draw/morph ideas belong to a future preview-only lane.
- `data-anim-easing`, `data-anim-repeat`, and `data-anim-direction` are runtime-only compatibility attributes. Do not use them in standard generated editable/exportable pages because PPTX export/import does not preserve them semantically.

### 5. Directional examples

```html
<div data-anim="fly-in" data-anim-from="left">Side metric</div>
<div data-anim="wipe" data-anim-from="right">Process bar</div>
<div data-anim="slide-right">Supporting card</div>
<div data-anim="exit-wipe" data-anim-from="top">Dismissed panel</div>
<div data-anim="exit-scale">Quietly de-emphasized chip</div>
<div data-anim="exit-zoom">Dramatic hero outro</div>
<div data-anim="zoom-in">Hero number</div>
<div data-anim="pulse">Key risk</div>
<div data-anim="pulse-strong" data-anim-trigger="click">Escalation callout</div>
<div data-anim="grow-shrink-soft">Subtle confirmation</div>
```

## Scripted animation escape hatch

Use `PPT.animate(targets, params)` only when `data-anim` cannot express a complex timeline or synchronized choreography:

```js
PPT.animate(".card", {
  opacity: [0, 1],
  translateY: [20, 0],
  duration: 500,
  delay: PPT.stagger(100)
})
```

- Targets is the first argument (a CSS selector string or DOM element), not an object property.
- Create timelines with `PPT.createTimeline(targets, params)`.
- Use `PPT.stagger(ms)` for staggered scripted delays.

## Hard rules

- Prefer no animation, `load`, `stagger`, `with`, or `after` before `click`.
- Use `data-anim-click-group="name"` only for contiguous `click` animations that share one reveal step.
- Keep emphasis choices bounded: `pulse-soft|pulse|pulse-strong` and `grow-shrink-soft|grow-shrink|grow-shrink-strong`.
- Do not use `data-anim-easing`, `data-anim-repeat`, or `data-anim-direction` in normal generated editable pages. Those attributes are runtime-only compatibility and are not part of the export-friendly contract.
- Use `PPT.animate(selector, params)` — targets is the first argument, not an object property. Call `PPT.animate(...)`, never `anime(...)` or `anime.timeline(...)`.
- The runtime handles initial hidden states automatically. Do not set `opacity-0`, `invisible`, `visibility:hidden`, `display:none`, or inline `opacity:0` on animated elements.
- Use only the supported data-anim types listed above.

## Failure repair strategy

When animation is broken or not playing:

1. **Check the type value**: must be from the supported list. Values like `typewriter`, `glitch-in`, `path-draw` are not supported.
2. **Check for conflicting initial states**: remove any manual `opacity-0`, `invisible`, `visibility:hidden`, `display:none`, or inline `opacity:0` — the runtime sets these automatically.
3. **Check for direct anime() calls**: replace `anime(...)` or `anime.timeline(...)` with `PPT.animate(...)` or `PPT.createTimeline(...)`.
4. **Check targets argument format**: `PPT.animate` takes targets as the first argument, not as an object property like `{ targets: ".card" }`.

## Chart animation boundary

Two levels of chart animation, each handled by a different system:

- **Chart container entrance** (the whole chart block fading/sliding in): add `data-anim` on the `.ppt-chart-frame` div.
- **Chart internal drawing** (bars growing, lines drawing): controlled by Chart.js `options.animation`. The runtime defaults handle this.
- **Do not** write custom JS timelines that animate individual chart elements. Use `data-anim` for the container, and Chart.js options for the internals.

## Cross-skill references

- Animation follows the reading path defined by layout (see layout skill). Do not animate elements in an order that contradicts the visual hierarchy.
