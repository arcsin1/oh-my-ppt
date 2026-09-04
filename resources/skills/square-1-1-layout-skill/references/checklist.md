# Square 1:1 Structural Self-check

## P0 - Not Deliverable

- Content exceeds 1200x1200 or is clipped.
- Non-media text-bearing modules use absolute/fixed positioning instead of grid/flex flow, overlap another content module, or escape the canvas. Intentional text or transparent-panel overlays on image/video are allowed.
- Body text is below 24px outside a bounded `data-ppt-density="high"` module or below 21px inside one, headings below 32px, or auxiliary text below 16px.
- The card has no dominant focal anchor.
- A chart/table/list is unreadable at square-card scale.

## P1 - Should Fix

- Modules are all equal weight.
- Margins are visibly unbalanced on one side or corner.
- The center of the card is passive while content sits at the top.
- A 2x2 cell contains paragraph-heavy text.
- The evidence band competes with the hero claim.
- The card relies on decorative filler rather than meaningful support.

## P2 - Consider Optimizing

- Support chips can be grouped closer to the focal anchor.
- The bottom takeaway could be shorter and more memorable.
- A side-by-side pair could become stacked for stronger square balance.
- Source/footer text could be simplified into one auxiliary line.
