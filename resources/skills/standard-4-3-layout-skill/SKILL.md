---
name: standard-4-3-layout-skill
description: Must be read before creating, relaying out, or repairing standard 4:3 Oh My PPT pages. Defines square-ish presentation layout, two-zone and 2x2 structures, chart/table budgeting, column discipline, plus catalog and checklist references for 1600x1200 canvases.
---

# Standard 4:3 Layout Skill

This skill is the layout source of truth for `standard-4-3` pages, usually 1600x1200.

A 4:3 page is a square-ish presentation canvas. It supports readable talk-track slides, balanced data + insight pairs, compact matrices, and diagrams with generous margins. Its best layouts use depth through hierarchy, not by spreading many columns across the width.

Deep details live in the references:

- `references/catalog.md` - named 4:3 presentation patterns and 1600x1200 zone skeletons.
- `references/checklist.md` - P0/P1/P2 structural self-check for delivery.

## Preflight

Before writing HTML, decide:

1. **Message** - the one sentence this slide should make the audience remember.
2. **Primary object** - chart, table, matrix, diagram, hero number, conclusion block, image, or comparison.
3. **Reading path** - title/claim -> primary object -> interpretation/action.
4. **Density** - low for cover/quote/hero number, medium for most slides, high only for compact tables or matrices.
5. **Pattern** - use a structure from `references/catalog.md` as a starting point when it helps the reading path; it is not a closed template menu, and a fresh composition is welcome when it serves the page thesis.
6. **Budget** - estimate width and height together; 4:3 failures are often width pressure, not only height pressure.

Use the canvas dimensions from the prompt. If custom dimensions are supplied, preserve the same square-ish relationships.

## Canvas Grammar

- Favor one-column, two-zone, 2x2, or center + rail structures.
- Two real content columns are usually enough. Three columns work only for short metric chips or labels.
- Keep side margins and gutters generous enough for projection readability.
- Use row-based tables and grouped insight rows when information has several dimensions.
- Use grid/flex document flow for text-bearing modules. Independent text/content modules occupy their own cells and must not overlap or escape the canvas. Absolute positioning is only for background accents, connector lines, non-text decoration, and intentional image/video background composition; text or transparent panels may intentionally sit over media.
- Independent content modules must retain an actual nonzero gap. Compact spacing is valid when it suits the composition.
- Body copy, ordinary labels, and card descriptions default to at least **24px** (Tailwind `text-2xl` or `text-[24px]`). Only a genuinely high-density bounded module may use **21px** after restructuring; mark it `data-ppt-density="high"` and compensate its grid/flex footprint if it is scaled. Headings are at least **32px** (`text-3xl` or larger) with no upper cap; auxiliary source/footer text is at least **16px**. These floors preserve the same displayed 18px / 16px / 24px / 12px semantic minimums on this 1200px-high canvas.

## Pattern Quick Lookup

| Intent | Patterns |
| --- | --- |
| main + support | `title-plus-two-zone` · `center-concept-rails` |
| data | `chart-insight-pair` · `compact-table-rows` |
| framework | `matrix-2x2` |
| visual | `diagram-plus-takeaways` |

Use `references/catalog.md` for the full structure recipe before writing a new or heavily repaired page.

## Height And Width Budget

Calculate before writing:

1. Canvas: usually 1600px wide x 1200px tall.
2. Outer padding: commonly 64-112px total per axis.
3. Title/subtitle: usually 80-140px after wrapping.
4. Gaps between zones.
5. Footer/source/reserve: 40-72px when present.
6. Remaining area is the body slot.

Then budget width: subtract horizontal padding and gaps, then check whether each column, chart label, table cell, or matrix quadrant has enough readable width.

For charts, reserve a specific frame height and keep the `@ppt-chart-height=N` marker aligned with the `h-[Npx]` class. In a two-zone layout, columns share width, not height; each column still uses the same vertical body slot.

## Repair And Self-check

- If the page feels cramped, reduce real content columns or convert to rows / 2x2.
- If hierarchy is flat, promote one object to primary and compress the rest into rails, chips, or rows.
- If a table is clipped, keep only key columns or turn dimensions into grouped insight rows.
- If a timeline or process lacks space, use stacked phases or compact sequence bands.
- If a support zone is mostly empty, shrink it or give the primary object more space.
- Before delivery, run `references/checklist.md`.
