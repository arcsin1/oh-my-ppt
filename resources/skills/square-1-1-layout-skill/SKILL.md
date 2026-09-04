---
name: square-1-1-layout-skill
description: Must be read before creating, relaying out, or repairing 1:1 square Oh My PPT pages. Defines square-card layout, centered focal hierarchy, quadrant and orbit structures, balanced margins, data-card budgeting, plus catalog and checklist references for 1200x1200 canvases.
---

# Square 1:1 Layout Skill

This skill is the layout source of truth for `square-1-1` pages, usually 1200x1200.

A 1:1 page is a square content card. It works best when the card has one unmistakable center of gravity and balanced margins on all four sides. The layout should feel complete as a single shareable visual, not like a cropped presentation page.

Deep details live in the references:

- `references/catalog.md` - named square-card patterns and 1200x1200 zone skeletons.
- `references/checklist.md` - P0/P1/P2 structural self-check for delivery.

## Preflight

Before writing HTML, decide:

1. **Message** - the one sentence this card should make the viewer remember.
2. **Focal anchor** - claim, quote, hero number, chart, image, concept, or matrix.
3. **Support shape** - orbit chips, 2x2 cells, evidence band, stacked pair, or short explanation.
4. **Reading path** - center first, then support, then takeaway/source.
5. **Density** - low for quote/claim, medium for most cards, high only for compact 2x2 or ranked list.
6. **Pattern** - use a structure from `references/catalog.md` as a starting point when it helps the reading path; it is not a closed template menu, and a fresh composition is welcome when it serves the page thesis.
7. **Balance check** - inspect top/bottom/left/right margins and corner weight.

Use the canvas dimensions from the prompt. If custom dimensions are supplied, preserve square balance.

## Canvas Grammar

- Start with one focal anchor. A square card needs a dominant center of gravity.
- Keep margins visually balanced on all four sides.
- Use at most two real columns or a 2x2 grid.
- Corners matter. Fill them only with meaningful support, not decorative leftovers.
- Use grid/flex document flow for text-bearing modules. Independent text/content modules occupy their own cells and must not overlap or escape the canvas. Absolute positioning is only for background accents, connector lines, non-text decoration, and intentional image/video background composition; text or transparent panels may intentionally sit over media.
- Independent content modules must retain an actual nonzero gap. Compact spacing is valid when it suits the composition.
- Body copy, ordinary labels, and card descriptions default to at least **24px** (Tailwind `text-2xl` or `text-[24px]`). Only a genuinely high-density bounded module may use **21px** after restructuring; mark it `data-ppt-density="high"` and compensate its grid/flex footprint if it is scaled. Headings are at least **32px** (`text-3xl` or larger) with no upper cap; auxiliary source/footer text is at least **16px**. These floors preserve the same displayed 18px / 16px / 24px / 12px semantic minimums on this 1200px-high canvas.

## Pattern Quick Lookup

| Intent | Patterns |
| --- | --- |
| hero / quote | `claim-evidence-band` · `top-center-bottom` |
| concept | `center-hero-orbit` · `quadrant-card` |
| data | `square-data-card` |
| comparison | `stacked-pair` |

Use `references/catalog.md` for the full structure recipe before writing a new or heavily repaired card.

## Square Budget

Calculate before writing:

1. Canvas: usually 1200px x 1200px.
2. Outer padding: commonly 64-112px per axis.
3. Title/claim wrapping.
4. Gaps between zones.
5. Bottom takeaway/source/reserve: 40-96px when present.
6. Remaining width and height define the focal zone.

For charts, reserve a specific frame height and keep the `@ppt-chart-height=N` marker aligned with the `h-[Npx]` class. Prefer one clear chart, hero number, compact bars, rank list, or small 2x2 data matrix.

## Repair And Self-check

- If modules feel equal, promote one block to hero and compress support.
- If the card is top-heavy, move the focal anchor, takeaway, or evidence into the middle/lower area.
- If corners feel accidental, rebalance support around the focal anchor.
- If a table or timeline feels cramped, convert it into a 2x2, ranked list, stacked pair, or compact evidence band.
- If content is sparse, enlarge the core claim or visual anchor instead of adding filler.
- Before delivery, run `references/checklist.md`.
