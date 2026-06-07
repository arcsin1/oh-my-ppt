# GSAP Animation Integration Plan

## Abstract

Replace the current anime.js-based runtime animation engine with GSAP (GreenSock Animation Platform) to achieve **native-quality animation in preview that exactly matches exported PPTX behavior** for editable animations. For animations that exceed PPTX preset capabilities, provide a graduated degradation strategy: editable → approximated → pre-rendered multimedia.

---

## 1. Definitions

| Term | Definition |
|------|-----------|
| **Ground Truth** | The visual output of GSAP in the Electron preview. All export correctness is measured as L2 visual distance from this reference. |
| **Editable Mode** | PPTX export where each animation maps 1:1 to an OOXML `<p:par>` timing node with a valid PPTX preset. Editable in PowerPoint's Animation Pane. |
| **Play-Only Mode** | Export where the animation is pre-rendered to video/GIF and embedded as a media object. Plays during slideshow, not editable in Animation Pane. |
| **Preset Space** | The finite set of all valid `{ presetId, presetSubtype, presetClass }` tuples in OOXML. Approximately 190 combinations. |
| **Semantic Degradation** | When a GSAP animation has no exact PPTX preset equivalent, the closest available preset is used with a logged fidelity warning. |
| **Data-Anim Protocol** | The declarative HTML attribute protocol (`data-anim`, `data-anim-from`, `data-anim-delay`, `data-anim-duration`, `data-anim-trigger`) that bridges HTML markup to both runtime execution and PPTX export. |

---

## 2. First Principles

### 2.1 The animation function

All animation systems are functions of the form `f(t) → v` where `t ∈ [0,1]` is normalized time and `v` is a vector of property values. The difference between GSAP and PPTX is not in *what* they compute, but in **how the function is defined and where it executes**.

- GSAP: `f` is defined programmatically at runtime, with continuous easing, arbitrary property combinations, and imperative timeline control.
- PPTX: `f` is defined declaratively in XML as a preset reference. The actual interpolation is performed by a closed-source rendering engine with fixed easing functions.

### 2.2 The mapping problem

The core challenge is constructing a mapping function `φ: GSAP_Space → PPTX_Space` that minimizes perceptible visual difference. This is a **lossy compression problem** — PPTX space is a strict subset of GSAP space.

**Editable mode covers the subset where `φ` is exact.**  
**Play-only mode covers the complement where `φ` would produce unacceptable visual degradation.**

### 2.3 Why GSAP over anime.js

The current runtime (`page-writer.ts` L229-345) uses anime.js v4 as a polyfill. This is a **maintenance liability**:

1. anime.js is essentially unmaintained (last significant release: 2021)
2. The current runtime re-implements scanning, stagger, click-trigger, and timing logic that GSAP provides natively
3. GSAP's Timeline class maps directly to PPTX's `<p:seq>` / `<p:par>` container structure
4. GSAP's `gsap.context()` provides automatic cleanup scoping — critical for a multi-page Electron app where animation memory leaks accumulate

---

## 3. Implementation Plan

### Phase 1 — GSAP Runtime Integration (Target: 3 days)

**Goal**: Replace anime.js with GSAP in the default motion script. Preview quality becomes the ground truth.

#### 1.1 Asset bundling

```
resources/gsap.min.js          ← GSAP core + CSSPlugin (tree-shaken, ~30KB gzip)
```

Add to `src/main/ipc/engine/page-assets.ts`:

```typescript
// Add to SESSION_ASSET_SCRIPT_SRCS
gsap: 'gsap.min.js'

// Add to SESSION_ASSET_SCRIPTS
`<script src="${SESSION_ASSET_SCRIPT_SRCS.gsap}"></script>`
```

#### 1.2 Runtime motion script rewrite

Replace `page-writer.ts` `DEFAULT_MOTION_SCRIPT` (L229-345) with GSAP-based version.

Core logic:

```javascript
function runGsapMotion(root) {
  const ctx = gsap.context(() => {
    const elements = Array.from(root.querySelectorAll('[data-anim]'));
    if (elements.length === 0) {
      runFallbackFadeIn(root);
      return;
    }

    const loadDefs = [];
    const clickGroups = new Map(); // clickIndex → animDef[]

    elements.forEach((el) => {
      const def = parseDataAnim(el); // type, from, duration, delay, trigger
      if (def.trigger === 'click') {
        const idx = (clickGroups.size + 1);
        if (!clickGroups.has(idx)) clickGroups.set(idx, []);
        clickGroups.get(idx).push(def);
      } else {
        loadDefs.push(def);
      }
    });

    // Execute load-triggered animations as a GSAP timeline
    if (loadDefs.length > 0) {
      const tl = gsap.timeline();
      loadDefs.forEach((def) => {
        tl.add(gsap.from(def.element, buildGsapVars(def)), def.delay / 1000);
      });
    }

    // Wire click-triggered animations
    clickGroups.forEach((defs, idx) => {
      window.PPT.clicks.on(idx, () => {
        const tl = gsap.timeline();
        defs.forEach((def) => {
          tl.add(gsap.from(def.element, buildGsapVars(def)));
        });
      });
    });
  }, root);
}
```

#### 1.3 data-anim → GSAP vars mapping

```typescript
function buildGsapVars(def: AnimDef): gsap.TweenVars {
  const base = {
    duration: def.duration / 1000,
    ease: resolveEase(def.type), // power2.out for entrances, power2.in for exits
  };

  switch (def.type) {
    case 'fade':
      return { ...base, opacity: 0 };
    case 'fade-up':
      return { ...base, opacity: 0, y: 40 };
    case 'fade-down':
      return { ...base, opacity: 0, y: -40 };
    case 'fade-left':
      return { ...base, opacity: 0, x: 40 };
    case 'fade-right':
      return { ...base, opacity: 0, x: -40 };
    case 'scale-in':
      return { ...base, opacity: 0, scale: 0.85 };
    case 'slide-up':
      return { ...base, y: 40 }; // no opacity change
    case 'slide-left':
      return { ...base, x: 40 };
    case 'fly-in':
      return { ...base, opacity: 0, ...resolveFlyDirection(def.from) };
    case 'wipe':
      // Wipe requires clip-path animation — not natively in GSAP
      // Use opacity + directional translate as approximation
      return { ...base, opacity: 0, ...resolveFlyDirection(def.from) };
    case 'zoom-in':
      return { ...base, opacity: 0, scale: 0.75 };
    case 'spin-in':
      return { ...base, opacity: 0, scale: 0.92, rotation: -15 };
    case 'grow-shrink':
      return { ...base, scale: 0.9, yoyo: true, repeat: 1 };
    case 'pulse':
      return { ...base, scale: 1.06, yoyo: true, repeat: 1 };
    case 'exit-fade':
      return { ...base, opacity: 0 }; // gsap.to, not from
    case 'exit-fly':
      return { ...base, opacity: 0, ...resolveFlyDirection(def.from) };
    case 'path':
      return { ...base, opacity: 0 }; // degraded — no path data in current protocol
    default:
      return { ...base, opacity: 0, y: 40 };
  }
}
```

#### 1.4 Freeze/export integration

In `browser-scripts.ts` `FREEZE_PAGE_FOR_PPTX_SCRIPT`, add GSAP cleanup before capture:

```javascript
// Kill all GSAP animations before freezing
if (window.gsap) {
  window.gsap.globalTimeline.clear();
  window.gsap.killTweensOf('*');
}
```

#### 1.5 Edit mode integration

In `edit-mode-script.ts` L790-806, the existing code already calls `window.PPT.finishAnimations()`. This must be updated to target GSAP:

```javascript
if (window.gsap) {
  gsap.globalTimeline.pause(0);
  gsap.killTweensOf('*');
}
```

### Phase 2 — Unit Testing (Target: 2 days)

#### 2.1 Test Matrix

Each `DataAnimType` × 4 directions × `{ duration: 300, 500, 1000 }` × `{ delay: 0, 200, 500 }`.

Total: 17 × 4 × 3 × 3 = **612 combinatorial cases**.
Practical reduction: test each type with default params, then test parametric extremes on a representative subset (fade, fade-up, fly-in).

#### 2.2 New test files

```
tests/unit/animation/
  gsap-data-anim-mapping.test.ts    ← GSAP vars generation correctness
  pptx-preset-roundtrip.test.ts     ← Export → Import fidelity (all 17 types)
  gsap-timeline-to-pptx.test.ts     ← Timeline XML structural validation
  animation-visual-regression.test.ts ← Pixel-diff test harness (Phase 3)
```

#### 2.3 Roundtrip test specification

For each animation type, the roundtrip test:

1. Creates a minimal HTML page with one `[data-anim]` element
2. Runs the export pipeline (extraction → normalization → OOXML write)
3. Parses the resulting PPTX XML
4. Asserts: `type`, `duration`, `delay`, `trigger`, and `from` match the original
5. Asserts: generated `<p:timing>` XML is structurally valid (contains tmRoot, mainSeq, correct presetID/class)

#### 2.4 Edge cases to test

- Multiple animations on the same element (entrance + emphasis + exit sequences)
- Nested `[data-anim]` elements (parent and child both animated)
- `stagger()` delay pattern correctness
- Click-triggered animations with `after` and `with` sequencing
- Export at boundary values (duration=100ms, duration=5000ms, delay=0, delay=30000ms)
- PPTX re-import after export — verify animation data survives the roundtrip

### Phase 3 — Verification & Acceptance (Target: 2 days)

#### 3.1 Acceptance criteria

For each of the 17 animation types, the exported PPTX must meet these criteria when opened in Microsoft PowerPoint (desktop):

1. Animation entry visible in Animation Pane
2. Animation type label matches the declared type (e.g., "Fade" for `fade`)
3. Duration and delay values preserved (±50ms tolerance)
4. Direction correct (for directional types: fade-up/down/left/right, fly-in, slide-*, wipe)
5. Visual playback matches GSAP preview within perceptual tolerance
6. Click-triggered animations correctly advance on click

#### 3.2 Known fidelity limitations (documented)

| Animation Type | Limitation |
|---------------|------------|
| `slide-up` / `slide-left` | Mapped to same PPTX preset as `fade-up`/`fade-left` (with fade). Semantic difference lost. |
| `grow-shrink` / `pulse` | PPTX emphasis presets auto-reverse; timing differs from GSAP's explicit control. |
| `spin-in` | PPTX has no spin entrance. Degraded to scale-in with spin approximated. |
| `path` | No PPTX equivalent. Degraded to simple fade. Mark for play-only mode in future. |
| `wipe` | PPTX wipe uses built-in direction filter; visual edge differs from CSS clip-path. |
| All types | Easing curve not preserved. PPTX uses system-default easing. |

#### 3.3 Verification script (manual, assisted)

A Node.js script (`scripts/verify-pptx-animations.ts`) that:

1. Loads each test HTML page in Electron
2. Screenshots the GSAP animation at t=0, t=50%, t=100%
3. Exports to PPTX
4. Generates a verification checklist as Markdown with expected PPTX Animation Pane contents

---

## 4. Critical Design Decisions

### 4.1 Element binding: attribute matching over spatial overlap

**Problem**: `matchAnimationTracesToTargets()` in `ooxml-writer.ts` (L588-643) uses bounding-box overlap for binding `animationTraces` to `shapePositions`. When multiple elements overlap (e.g., a card with nested icon both marked `[data-anim]`), the spatial heuristic is non-deterministic.

**Decision**: Require every `[data-anim]` element to also have `data-block-id`. Use exact attribute matching for binding. Spatial overlap becomes a fallback only for imported PPTX animations (which lack block-id).

**Migration**: The `COLLECT_PPTX_ANIMATION_TRACES_SCRIPT` already runs in the browser context and can extract `data-block-id` alongside position data. The `animationTraces` type should be extended with an optional `blockId` field.

### 4.2 Easing degradation strategy

GSAP supports infinite easing curves (including custom). PPTX supports approximately 3 (system-default, linear, smooth). 

**Decision**: Map GSAP eases to PPTX eases only for the three standard curves. For all custom eases: use PPTX system-default and document the degradation. Do NOT attempt to approximate custom eases with keyframe sequences — this creates uneditable keyframe splatter in the Animation Pane.

### 4.3 Play-only mode threshold

**Decision**: Any animation type that requires `gsap.registerPlugin()` (ScrollTrigger, Flip, MotionPath, SplitText, MorphSVG, DrawSVG) is automatically play-only. Any `data-anim` type that maps to `path` (current pseudo-mapping) is flagged for future play-only migration.

---

## 5. Risk Register

| Risk | Probability | Impact | Mitigation |
|------|-----------|--------|------------|
| GSAP license incompatibility | Low | High | GSAP Standard License allows free use in products; verify with legal |
| anime.js removal breaks existing pages | Medium | High | Keep anime.js as fallback for 1 release cycle; deprecation warning in console |
| PPTX roundtrip fidelity < 95% | Medium | Medium | Add per-type fidelity score; document known gaps in CHANGELOG |
| GSAP bundle size impact on page load | Low | Low | Tree-shake to core+CSSPlugin only (~30KB gzip); lazy load plugins |
| ScrollTrigger user expectation | Medium | Medium | Clear documentation that scroll-driven animations are play-only on export |
| PPTX animation engine differences (WPS, Keynote, etc.) | High | Low | Target Microsoft PowerPoint (desktop) as reference; document other renderers as "best effort" |
| `matchAnimationTracesToTargets` non-determinism | High | Medium | Migrate to block-id matching (see §4.1) |

---

## 6. Follow-up Development Strategy

This section is the gate for follow-up PRs. Do not split or extend the work
until the current PR satisfies the contract and verification requirements below.

### 6.1 Public animation contract

GSAP is an internal playback engine, not an AI-facing authoring API.

The public contract has three tiers:

| Tier | API | Export expectation | Policy |
|------|-----|-------------------|--------|
| 1 | `data-anim` attributes | Native editable PPTX where supported | Default and preferred |
| 2 | `PPT.animate(...)` / `PPT.createTimeline(...)` | Exportable only for the documented supported subset | Controlled escape hatch |
| 3 | Direct `gsap.*` / `window.gsap` / `globalThis.gsap` | No stable export contract | Disallowed in generated slide fragments |

This avoids a false promise that arbitrary GSAP code can roundtrip to PPTX. The
runtime may use GSAP internally, but generated HTML should depend on the stable
Oh My PPT contract.

### 6.2 Skill model

`oh-my-ppt-data-anim` remains the source of truth for exportable animations.

If a GSAP-specific skill is added, it must be a dependent advanced skill, not a
competing contract. Its job is to explain controlled choreography through
`PPT.animate(...)` and `PPT.createTimeline(...)`, plus the degradation rules. It
must not teach direct `gsap.to(...)`, `gsap.fromTo(...)`, `gsap.timeline(...)`,
plugin registration, or global timeline manipulation.

### 6.3 Validator gates

The page validator must reject contract violations at the write edge:

1. Direct GSAP access: `gsap.*`, `window.gsap`, `globalThis.gsap`.
2. Direct anime.js access except legacy runtime assets managed by the app.
3. Unsupported `data-anim` values. Unknown values must not silently coerce to a
   fallback type during generation validation.
4. Manual default-hidden states on animated content unless they are introduced
   by the runtime/export freeze path.
5. Timeline calls whose shape is not supported by the `PPT.*` wrapper contract.

Validation belongs at the write/import boundary. Runtime fallback behavior can
remain forgiving for old decks, but new generated fragments must fail fast.

### 6.4 PR split order

After the current PR is proven robust, split follow-up work in this order:

1. Runtime contract PR: asset loading, prompt wording, skill docs, validator
   gates, and actual-runtime tests for `data-anim` and `PPT.*`.
2. PPTX native export PR: OOXML writer/importer, fixture generator,
   deterministic reference artifacts, and PowerPoint verification checklist.
3. Advanced/play-only PR: Lottie, motion path, GSAP plugins, video/GIF export,
   and explicit non-editable degradation UX.

The split should follow ownership boundaries. Do not split by file type if that
leaves a PR with prompts that advertise behavior the validator or runtime does
not enforce.

### 6.5 Verification gates before follow-up work

The current PR is not ready for follow-up unless all of these are true:

1. Tests execute the real `resources/ppt-runtime.js` GSAP path with a mocked
   GSAP object. Tests that copy the runtime switch logic are not sufficient.
2. `DATA_ANIM_SUPPORTED_TYPES`, runtime `DATA_ANIM_TYPES`, skill docs, fixture
   names, and PR copy agree on the same type count and semantics.
3. Unknown animation types are rejected by generation-time validation and only
   legacy runtime playback may degrade them.
4. `PPT.createTimeline(...)` either exposes an Oh My PPT-compatible wrapper or
   its examples use real GSAP timeline methods (`to`, `from`, `fromTo`, `set`).
5. Stagger, easing, repeat, and yoyo semantics are tested against the actual
   runtime bridge, not inferred from copied mapping code.
6. Reference PPTX generation is deterministic or deliberately excluded from
   normal dirty-state expectations.
7. Click-trigger, wipe direction, exit visibility, and slide transition XML have
   a manual Microsoft PowerPoint verification record. ZIP/XML self-parsing does
   not prove PowerPoint behavior.
8. No unrelated lockfile or generated artifact churn is present in the final PR.

### 6.6 Non-goals for this line of work

The editable PPTX path does not support arbitrary GSAP plugins, scroll-driven
motion, custom easing curves, or real motion paths. Those belong in play-only
mode unless a specific editable OOXML mapping is implemented and verified in
PowerPoint.

---

## 7. Summary

1. **GSAP replaces anime.js as the runtime engine**, sharing the same `data-anim` protocol with the PPTX export pipeline. One animation description, two execution backends.
2. **Editable mode covers the intersection of GSAP and PPTX preset spaces**. The current 17-type set includes exact mappings, approximate mappings, and documented degraded mappings such as `path`, `grow-shrink`, and `pulse`.
3. **Element binding must migrate from spatial overlap to attribute matching** (`data-block-id`). This is the highest-risk correctness issue in the current export pipeline.
4. **Acceptance is measured by visual comparison**, not XML attribute validation. Ground truth = GSAP preview. Acceptance = PPTX playback L2 distance < threshold.
5. **Play-only mode is the strategic escape hatch** for GSAP features that exceed PPTX capabilities. It should be designed into the protocol from the start, even if implementation is deferred.
