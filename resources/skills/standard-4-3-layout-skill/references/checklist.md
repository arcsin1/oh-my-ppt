# Standard 4:3 Structural Self-check

## P0 - Not Deliverable

- Content exceeds 1600x1200 or is clipped.
- Non-media text-bearing modules use absolute/fixed positioning instead of grid/flex flow, overlap another content module, or escape the canvas. Intentional text or transparent-panel overlays on image/video are allowed.
- Body text is below 24px outside a bounded `data-ppt-density="high"` module or below 21px inside one, headings below 32px, or auxiliary text below 16px.
- The page has no primary object or readable hierarchy.
- Chart/table labels are unreadable.

## P1 - Should Fix

- More than two real content columns create narrow text.
- A 2x2 matrix has paragraph-heavy cells.
- The title consumes too much height for the body to work.
- A chart lacks a nearby insight or interpretation.
- A support zone is mostly empty or competes with the primary object.
- A table keeps too many columns instead of grouping key dimensions.

## P2 - Consider Optimizing

- The slide could use center + rails instead of equal cards.
- A small table could become rows with stronger grouping.
- Gutter and side margins could be increased for projection readability.
- Source/footer text could be simplified into one auxiliary line.
