---
name: red-layout-skill
description: Must be read before creating, relaying out, or repairing Xiaohongshu/red-note canvas pages. Defines social-note layout, hook/value/takeaway reading flow, saveable note patterns, vertical budgeting, compact chart/list composition, plus catalog and checklist references for 1242x1660 canvases.
---

# Red Layout Skill

This skill is the layout source of truth for `xiaohongshu-note` pages, commonly 1242x1660.

A red-note page should read like a saveable social image note: a strong hook, useful body, and memorable takeaway. The layout should make the viewer understand why the page is worth pausing on and what value they can keep.

**This canvas is a social note card, not a compressed slide.** When the source content is dense or "needs to be summarized", summarize or regroup it for this reading format instead of cramming a 16:9 deck's worth of outline into one page.

Deep details live in the references:

- `references/catalog.md` - named red-note patterns and 1242x1660 zone skeletons.
- `references/checklist.md` - P0/P1/P2 structural self-check for delivery.

## Preflight

Before writing HTML, decide:

1. **Stop reason** - why would someone pause, save, or screenshot this note page?
2. **Hook** - title, question, claim, number, or visual anchor in the first 1-2 seconds.
3. **Value format** - checklist, steps, comparison, myth/fact, template, data takeaway, framework, or story/proof.
4. **Body grouping** - start with **3-4 information chunks** (or **5-6 compact list rows** for checklist/steps), then regroup or choose a denser pattern when the content genuinely needs it; do not squeeze more chunks in by making them unreadable.
5. **Takeaway** - conclusion, action, summary line, warning, or compact bottom note.
6. **Pattern** - use a structure from `references/catalog.md` as a starting point when it helps the reading path; it is not a closed template menu, and a fresh composition is welcome when it serves the page thesis.
7. **Budget** - estimate hook height, body rows/sections, gaps, bottom note, and safe margin.

Use the canvas dimensions from the prompt. If custom dimensions are supplied, preserve the same red-note reading flow.

## Canvas Grammar

- Hierarchy: hook > value body > support > takeaway/source.
- Prefer vertical sections, note cards, list rows, and poster-like bands.
- Keep copy short and scan-friendly. Split long paragraphs into bullets, labeled chunks, or compact rows.
- Use one main data object, framework, or list as the value body.
- Give the lower area a useful role: takeaway, action, summary, source, or final support.
- Use grid/flex document flow for text-bearing modules. Independent text/content modules occupy their own cells and must not overlap or escape the canvas. Absolute positioning is only for background accents, connector lines, non-text decoration, and intentional image/video background composition; text or transparent panels may intentionally sit over media.
- **Composition starting point**: a hook, 3-4 information chunks (or 6 compact rows), and a takeaway usually create a clear note. A "chunk" is a labeled card, a mini-section, a step, or a row group — not a single bullet. Treat this as a guide, not a closed composition: regroup, compress, or choose a denser pattern when the source needs it while keeping the page readable and inside the canvas.
- **Vertical rhythm (guidance)**: avoid an accidental top-stack or unused lower band. Use `flex flex-col` with `flex-1` / `flex-grow` or `justify-between` only when it distributes actual hook / body / takeaway modules; do not stretch empty containers merely to fill height. When content is sparse, enlarge or reposition the focal and support modules so the middle or bottom carries the page. Independent content modules must retain an actual nonzero gap. If content is longer than the canvas, compress or regroup it before writing.
- Body copy, ordinary labels, and card descriptions default to at least **33px** (`text-[33px]` or `style="font-size:33px"`). Only a genuinely high-density bounded module may use **30px** after restructuring; mark it `data-ppt-density="high"` and compensate its grid/flex footprint if it is scaled. Titles/headers are at least **44px** (`text-[44px]` or larger) with no upper cap; auxiliary source/footer text is at least **22px**. These floors preserve the same displayed 18px / 16px / 24px / 12px semantic minimums on this 1660px-high canvas.

## Pattern Quick Lookup

| Intent | Patterns |
| --- | --- |
| cover / hook | `cover-hook` |
| checklist / steps | `saveable-checklist` · `step-guide` |
| comparison / Q&A | `before-after-stack` · `myth-fact-qa` |
| data / framework | `data-takeaway-note` · `mini-framework` |
| reusable asset | `template-note` |

Use `references/catalog.md` for the full structure recipe before writing a new or heavily repaired note page.

## Note Budget

Calculate before writing:

1. Canvas height: commonly 1660px.
2. Outer vertical padding: commonly 96-176px total.
3. Hook/title zone: usually 220-420px after wrapping.
4. Body sections or list rows: calculate count and row height.
5. Gaps between sections.
6. Bottom takeaway/source/reserve: usually 120-260px when present.
7. Remaining height is the main value zone.

For charts, reserve a specific frame height and keep the `@ppt-chart-height=N` marker aligned with the `h-[Npx]` class. Prefer compact bars, mini trends, rank lists, or hero metric + explanation.

Keep visible facts grounded in the source. Do not invent social-proof numbers, quotes, cases, or claims.

## Repair And Self-check

- If the hook is weak, rewrite it around a concrete benefit, question, number, or claim.
- If the value body is dense, convert paragraphs into labeled chunks, bullets, rows, or one hero data object.
- **If the outline goes beyond the starting point, resolve the density in this priority: (1) summarize and compress — say the same information in fewer words (long descriptions become short phrases, sentences become single data points; remove water, not information), (2) merge related points into one chunk with a shared label, (3) rewrite a long list as one hero metric + one-line interpretation, (4) switch pattern to a denser format (e.g. comparison matrix, 2x2). Preserve readability and keep the result inside the canvas.**
- If the note lacks a memory point, add a bottom takeaway or action line.
- If items feel scattered, group them under 2-4 section labels.
- If a chart/list is hard to scan, simplify to a hero metric, compact ranking, or grouped rows.
- Before delivery, run `references/checklist.md`.
