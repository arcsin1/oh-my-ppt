---
name: vertical-3-4-layout-skill
description: Must be read before creating, relaying out, or repairing 3:4 vertical Oh My PPT pages. Defines poster-card layout, focal hierarchy, vertical section planning, evidence grouping, compact two-column pockets, chart/list budgeting, plus catalog and checklist references for 1200x1600 canvases.
---

# Vertical 3:4 Layout Skill

This skill is the layout source of truth for `vertical-3-4` pages, usually 1200x1600.

A 3:4 page is a vertical poster-card canvas. It has enough width for rich information cards and compact two-column pockets, but its reading path is still vertical. The layout should feel like a poster with one strong anchor and grouped evidence, not a long feed of equal blocks.

**This canvas is a poster card, not a compressed slide.** When the source content is dense or "needs to be summarized", summarize or regroup it for this reading format instead of cramming a 16:9 deck's worth of outline into one page.

Deep details live in the references:

- `references/catalog.md` - named poster-card patterns and 1200x1600 zone skeletons.
- `references/checklist.md` - P0/P1/P2 structural self-check for delivery.

## Preflight

Before writing HTML, decide:

1. **Message** - the one sentence this card should make the viewer remember.
2. **Focal anchor** - title block, hero metric, chart, image/diagram, framework, or conclusion.
3. **Support groups** - start with **3-4 support bands** (or **5-6 compact rows/chips** for grouped facts), then regroup or choose a denser pattern when the content genuinely needs it; do not squeeze extra material in by making it unreadable.
4. **Reading path** - top claim -> main proof/value -> bottom synthesis/source.
5. **Density** - low-medium for poster claims, medium for most information cards, high only for compact lists or matrices. Never use "high density" as a reason to exceed the 4-band cap.
6. **Pattern** - use a structure from `references/catalog.md` as a starting point when it helps the reading path; it is not a closed template menu, and a fresh composition is welcome when it serves the page thesis.
7. **Budget** - estimate hero zone, main proof zone, bottom synthesis, gaps, and reserve.

Use the canvas dimensions from the prompt. If custom dimensions are supplied, preserve the same vertical poster relationships.

## Canvas Grammar

- Keep one visual or conceptual anchor larger than the rest.
- Use vertical sections, but group small facts into bands, rows, or chips so the card does not become a long list.
- A compact two-column pocket is allowed inside one section when each item remains readable.
- Let the bottom carry synthesis, implication, source, or a final evidence band.
- Use grid/flex document flow for text-bearing modules. Independent text/content modules occupy their own cells and must not overlap or escape the canvas. Absolute positioning is only for background accents, connector lines, non-text decoration, and intentional image/video background composition; text or transparent panels may intentionally sit over media.
- **Composition starting point**: a focal anchor, 3-4 support bands (or 6 compact rows/chips), and a bottom synthesis usually create a clear poster. A "band" is a labeled section, a comparison row group, an evidence cluster, or a step group — not a single bullet. Treat this as a guide, not a closed composition: regroup, compress, or choose a denser pattern when the source needs it while keeping the page readable and inside the canvas.
- **Vertical rhythm (guidance)**: avoid an accidental top-stack or unused lower band. Use `flex flex-col` with `flex-1` / `flex-grow` or `justify-between` only when it distributes actual focal / support / synthesis modules; do not stretch empty containers merely to fill height. When content is sparse, enlarge or reposition the focal and support modules so the middle or bottom carries the page. Independent content modules must retain an actual nonzero gap. If content is longer than the canvas, compress or regroup it before writing.
- Body copy, ordinary labels, and card descriptions default to at least **32px** (`text-[32px]` or `style="font-size:32px"`). Only a genuinely high-density bounded module may use **28px** after restructuring; mark it `data-ppt-density="high"` and compensate its grid/flex footprint if it is scaled. Headings are at least **43px** (`text-[43px]` or larger) with no upper cap; auxiliary source/footer text is at least **21px**. These floors preserve the same displayed 18px / 16px / 24px / 12px semantic minimums on this 1600px-high canvas.

## Pattern Quick Lookup

| Intent | Patterns |
| --- | --- |
| poster claim | `poster-hero-proof` |
| metric / data | `hero-metric-explainer` · `data-card` |
| process | `vertical-process` |
| comparison | `comparison-rows` |
| evidence | `evidence-band-stack` · `two-column-pocket` |

Use `references/catalog.md` for the full structure recipe before writing a new or heavily repaired card.

## Poster Budget

Calculate before writing:

1. Canvas height: usually 1600px.
2. Outer vertical padding: commonly 72-128px total.
3. Hero/title zone: usually 240-420px depending on focal scale.
4. Gaps between sections.
5. Bottom conclusion/source/reserve: 80-240px when present.
6. Remaining height is the main proof/value zone.

Canvas width is usually 1200px. After horizontal padding, use one full-width column or one compact two-column pocket.

For charts, reserve a specific frame height and keep the `@ppt-chart-height=N` marker aligned with the `h-[Npx]` class. Prefer one clear chart, hero metric, compact bars, rank list, or short table.

## Repair And Self-check

- If the card is just a stack of cards, introduce a hero/focal block.
- If the bottom is empty, add synthesis, implication, source, or a final evidence band.
- If there are too many small facts, group them into bands or chips under shared labels.
- **If the outline goes beyond the starting point, resolve the density in this priority: (1) summarize and compress — say the same information in fewer words (long descriptions become short phrases, sentences become single data points; remove water, not information), (2) merge related points into one band with a shared label, (3) rewrite a long list as one hero metric + one-line interpretation, (4) switch pattern to a denser format (e.g. comparison rows, ranked chips). Preserve readability and keep the result inside the canvas.**
- If a two-column pocket feels cramped, return to full-width rows.
- If a chart/table is hard to read, convert it to a hero metric, rank list, compact bars, or grouped rows.
- Before delivery, run `references/checklist.md`.
