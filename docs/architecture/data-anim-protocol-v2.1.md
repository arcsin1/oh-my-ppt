# Data-Anim Protocol v2.1 Specification

## Purpose

Define the animation description protocol that bridges:
- **Runtime**: GSAP execution in the Electron preview
- **Export**: PPTX OOXML `<p:timing>` generation
- **Import**: Reverse-parsing PPTX animations into editable HTML

## Current State (v2.0, deployed)

### Attributes

```html
<div data-anim="fade-up"           <!-- Animation type (required) -->
     data-anim-from="bottom"       <!-- Direction (optional, defaults per type) -->
     data-anim-duration="500"      <!-- Duration in ms (default: 500) -->
     data-anim-delay="200"         <!-- Delay in ms (default: 0) -->
     data-anim-trigger="click"     <!-- Trigger: load|click (default: load) -->
></div>
```

### Supported types (18)

```
Entrance:   fade, fade-up, fade-down, fade-left, fade-right,
            scale-in, slide-up, slide-left, fly-in,
            wipe, zoom-in, spin-in, path
Emphasis:   grow-shrink, pulse
Exit:       exit-fade, exit-fly
```

### Protocol limitations (v2.0)

- No ease specification — all animations use browser-default (anime.js `easeOutCubic`)
- No stagger control beyond `data-anim-delay="stagger(n)"` string pattern
- No repeat/yoyo specification
- `slide-up` and `fade-up` map to identical PPTX presets (semantic collision)
- `path` has no semantic meaning — degenerates to `fade` in export
- No play-only/editable distinction
- No element identity for export binding (relies on spatial overlap)

## Proposed Extensions (v2.1)

### New attributes

```html
<div data-anim="fade-up"
     data-anim-from="bottom"
     data-anim-duration="500"
     data-anim-delay="200"
     data-anim-trigger="click"
     data-anim-sequence="after"   <!-- NEW: load sequencing: with|after (default: auto) -->
     data-anim-ease="power2.out"  <!-- NEW: GSAP easing (ignored in PPTX, system-default) -->
     data-anim-stagger="80"       <!-- NEW: stagger gap in ms (replaces stagger(n) pattern) -->
     data-anim-repeat="2"         <!-- NEW: repeat count (0 = no repeat, default: 0) -->
     data-anim-yoyo="true"        <!-- NEW: yoyo/reverse (default: false) -->
></div>
```

### Schema additions

```typescript
// src/main/animation/data-anim-schema.ts

export const DATA_ANIM_EASE_VALUES = [
  'none',            // linear
  'power1.in', 'power1.out', 'power1.inOut',
  'power2.in', 'power2.out', 'power2.inOut',
  'power3.in', 'power3.out', 'power3.inOut',
  'power4.in', 'power4.out', 'power4.inOut',
  'back.in', 'back.out', 'back.inOut',
  'elastic.in', 'elastic.out', 'elastic.inOut',
  'bounce.in', 'bounce.out', 'bounce.inOut',
  'sine.in', 'sine.out', 'sine.inOut',
  'expo.in', 'expo.out', 'expo.inOut',
  'circ.in', 'circ.out', 'circ.inOut',
] as const;
export type DataAnimEase = (typeof DATA_ANIM_EASE_VALUES)[number];

export interface DataAnimConfig {
  type: DataAnimType;
  from?: DataAnimFrom;
  trigger: DataAnimTrigger;
  duration: number;    // ms, [100, 5000]
  delay: number;       // ms, [0, 30000]
  sequence?: 'with' | 'after';  // relative to previous element
  ease?: DataAnimEase;          // GSAP easing name
  stagger?: number;             // ms gap for stagger
  repeat?: number;              // [0, 10]
  yoyo?: boolean;
}
```

### Semantic fixes (v2.1)

1. **Deprecate `stagger(n)` string pattern** in `data-anim-delay`. Replace with `data-anim-stagger` numeric attribute. The old pattern continues to parse for backward compatibility.

2. **Disambiguate slide-* vs fade-***: `slide-up` and `slide-left` should NOT include fade in their GSAP vars. They are pure translate animations. This fixes the PPTX preset collision where both map to presetId=2.

3. **Deprecate `path` type**: Mark as "play-only" with a deprecation warning. It currently maps to `fade` in PPTX, which is misleading. Either implement path support via motion-path or remove.

4. **Add explicit `data-anim-editable` marker**: Boolean attribute that signals whether this animation is expected to export as editable PPTX. If absent, `editable=true` is the default for all types except those marked play-only.

### Backward compatibility

All v2.0 attributes continue to parse. New attributes are optional and default to current behavior:
- `ease` absent → `power2.out` (matches current anime.js default)
- `stagger` absent → no stagger
- `repeat` absent → 0
- `yoyo` absent → false
- `sequence` absent → auto (derived from element order in DOM)
