---
name: vertical-9-16-layout-skill
description: Must be read before creating, relaying out, or repairing 9:16 vertical Oh My PPT pages. Defines mobile-story layout, top/middle/bottom zone planning, vertical flow patterns, height budgeting, readable chart/list composition, plus catalog and checklist references for 900x1600 canvases.
---

# Vertical 9:16 Layout Skill

This skill is the layout source of truth for `vertical-9-16` pages, usually 900x1600.

A 9:16 page is a vertical story screen. Its strongest layouts feel like a designed reading sequence: a top hook, a middle value zone, and a bottom conclusion or support area. The job is to make the page scan from top to bottom without becoming a stack of unrelated cards.

**This canvas is a vertical story frame, not a compressed slide.** When the source content is dense or "needs to be summarized", summarize or regroup it for this reading format instead of cramming a 16:9 deck's worth of outline into one page.

Deep details live in the references:

- `references/catalog.md` - named vertical story patterns and 900x1600 zone skeletons.
- `references/checklist.md` - P0/P1/P2 structural self-check for delivery.

## Preflight

Before writing HTML, decide:

1. **Message** - the one sentence this screen should make the viewer remember.
2. **Hook** - the first visual/text anchor: claim, question, number, quote, or compact image/data object.
3. **Main value** - the proof, explanation, comparison, steps, or data that makes the hook useful. Start with **2-3 supporting modules** (or **4-5 compact list rows** for ranked/steps), then regroup or choose a denser pattern when the content genuinely needs it; do not squeeze extra material in by making it unreadable.
4. **Bottom role** - takeaway, implication, source, callout, or final support.
5. **Density** - low for hero claim/quote, medium for most explainers, high only for compact ranked lists or step pages. Never use "high density" as a reason to exceed the 3-module cap.
6. **Pattern** - use a structure from `references/catalog.md` as a starting point when it helps the reading path; it is not a closed template menu, and a fresh composition is welcome when it serves the page thesis.
7. **Budget** - estimate title wrapping, section heights, gaps, chart/list height, and bottom reserve against the current canvas.

Use the canvas dimensions from the prompt. If custom dimensions are supplied, scale the same vertical relationships to that height and width.

## Canvas Grammar

- Work in a vertical stack. The page should have a clear top, middle, and bottom.
- Use one dominant focal object, then 2-4 supporting modules.
- Keep the middle zone load-bearing. A page with only small modules near the top feels unfinished.
- Use full-width sections by default. A compact two-column pocket is acceptable only inside one short section when both columns stay readable.
- Use grid/flex document flow for text-bearing modules. Independent text/content modules occupy their own cells and must not overlap or escape the canvas. Absolute positioning is only for background accents, connector lines, non-text decoration, and intentional image/video background composition; text or transparent panels may intentionally sit over media.
- **Composition starting point**: a hook, 2-3 supporting modules (or 5 compact list rows), and a bottom takeaway usually create a clear story. A "module" is a labeled section, a comparison row, a step group, or a data block — not a single bullet. Treat this as a guide, not a closed composition: regroup, compress, or choose a denser pattern when the source needs it while keeping the page readable and inside the canvas.
- **Vertical rhythm (guidance)**: avoid an accidental top-stack or unused lower band. Use `flex flex-col` with `flex-1` / `flex-grow` or `justify-between` only when it distributes actual hook / value / bottom modules; do not stretch empty containers merely to fill height. When content is sparse, enlarge or reposition the focal and support modules so the middle or bottom carries the page. Independent content modules must retain an actual nonzero gap. If content is longer than the canvas, compress or regroup it before writing.
- Body copy, ordinary labels, and card descriptions default to at least **32px** (`text-[32px]` or `style="font-size:32px"`). Only a genuinely high-density bounded module may use **28px** after restructuring; mark it `data-ppt-density="high"` and compensate its grid/flex footprint if it is scaled. Headings are at least **43px** (`text-[43px]` or larger) with no upper cap; auxiliary source/footer text is at least **21px**. These floors preserve the same displayed 18px / 16px / 24px / 12px semantic minimums on this 1600px-high canvas.

## Pattern Quick Lookup

| Intent | Patterns |
| --- | --- |
| hook / summary | `hook-value-takeaway` · `hero-claim` |
| process | `vertical-step-story` |
| comparison | `stacked-comparison` |
| data | `data-takeaway` · `ranked-list` |

Use `references/catalog.md` for the full structure recipe before writing a new or heavily repaired page.

## Height Budget

Calculate before writing:

1. Canvas height: usually 1600px.
2. Outer vertical padding: commonly 64-112px total.
3. Hook/title zone: usually 180-360px after wrapping.
4. Gaps between sections.
5. Bottom takeaway/support/source: usually 160-320px when present.
6. Safety reserve: 40-64px.
7. Remaining height is the main value zone.

For charts, reserve a specific frame height and keep the `@ppt-chart-height=N` marker aligned with the `h-[Npx]` class. Prefer compact bars, rank lists, simple trends, or hero metric + interpretation when the data has many labels.

## Repair And Self-check

- If the page feels top-heavy, enlarge or move the main value object into the middle and give the bottom a real takeaway.
- If the page feels like a long list, group items into 2-4 sections or promote one item to hero.
- **If the outline goes beyond the starting point, resolve the density in this priority: (1) summarize and compress — say the same information in fewer words (long descriptions become short phrases, sentences become single data points; remove water, not information), (2) merge related points into one module with a shared label, (3) rewrite a long list as one hero metric + one-line interpretation, (4) switch pattern to a denser format (e.g. comparison stack, ranked list). Preserve readability and keep the result inside the canvas.**
- If text feels cramped, shorten copy and group evidence before reducing its readable scale.
- If a chart/list is hard to read, switch to a hero metric, rank list, compact bars, or grouped rows.
- If the bottom is decorative only, replace decoration with conclusion, implication, source, or final support.
- Before delivery, run `references/checklist.md`.
