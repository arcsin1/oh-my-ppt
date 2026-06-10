---
name: oh-my-ppt-layout
description: Must be read before creating, relaying out, or repairing Oh My PPT slide layouts. Defines slide archetypes, density decisions, canvas budgeting, collision avoidance, and title readability rules.
---

# Oh My PPT Layout

For supplementary examples (collision avoidance code comparison, height budget walkthrough), read `references/layout.md`.

## When to use

- Creating a new slide or rewriting a whole slide
- Choosing a slide composition or layout intent (cover, data-focus, comparison, etc.)
- Repairing overflow, collision, or content exceeding the canvas

## When not to use

- Tiny text/style edits that do not affect layout (color, wording, single element)

## 30-second decision checklist

Before writing HTML, answer these in order:

1. **Role**: What is this slide? (cover / data exhibit / comparison / timeline / concept / process / summary / quote / image-focus)
2. **Reading path**: What does the audience see first → understand second → remember last?
3. **Content shape**: What information must appear, and what visual form best expresses it? A slide is a designed argument, not a document dump.
4. **Density**: Low (generous whitespace, one hero), medium (main + 2-3 support), or high (grid/table/cards)?
5. **Creative fit**: Choose a creative layout family that matches the density and role, then budget height. Do not mechanically force every crowded slide into chips or tables.
6. **Self-check width/height**: Before calling the write tool, estimate the final layout. Width must fit 1600px and height must fit 900px, including padding, title/subtitle, rows, gaps, chart frames, footnotes, and likely text wrapping. If either dimension exceeds the canvas, redesign the composition creatively and check again.

## Canvas and spacing

- Design for 16:9 canvas: 1600×900. The runtime page root has no default padding.
- Full-bleed backgrounds may use the entire 1600×900 canvas. Authored content must still use a conservative safe content budget with 24-40px spare height.
- Use Tailwind grid/flex layout. The root container usually uses `w-full h-full`; avoid fixed pixel values on the root.
- All content must be fully visible within the canvas. When space is tight, preserve the information by changing the composition: asymmetric split, bento grid, evidence rail, timeline strip, layered callout, compact table, grouped labels, or side-by-side zones.
- Background fills the entire canvas, defined on the outermost container.
- Use `text-base` (16px) as the smallest class for all visible text — body, labels, annotations, footnotes.
- Use `text-5xl` as the largest heading scale. Use `text-2xl` through `text-4xl` for subtitles and metric labels.

## Layout decision order

1. **Slide role**: cover, section divider, big number, key message, text-image, list, data exhibit, comparison, timeline/process, framework/matrix, quote, Q&A, executive summary, closing takeaway.
2. **Reading path**: what the audience sees first, understands second, and remembers last.
3. **Density**: low, medium, or high.
4. **Creative layout family**: choose an expressive structure for that density, not a default template.
5. **Module budget**: title area, main visual/data area, supporting evidence, annotation/footer if truly needed.
6. **Height budget**: outer margins + title + modules + gaps + chart/tables + notes + 24-40px reserve must fit in 900px.

## Density-driven creativity

Density guides the layout strategy; it does not prescribe a fixed layout.

- **Low-density**: use large scale and atmosphere: edge-to-edge hero area, oversized number/quote, diagonal color field, negative space, image focus, or a single strong visual metaphor.
- **Medium-density**: use hierarchy: asymmetric split, main claim + evidence rail, 2-zone comparison, staircase, timeline strip, or one dominant visual with 2-4 annotations.
- **High-density**: use disciplined structure without becoming dull: bento grid, matrix, compact dashboard, table-like rows, grouped metric bands, small multiples, or chart + concise evidence rail.
- The same content density can produce multiple valid layouts. Pick the one that best matches the slide role and reading path.
- Do not mechanically reuse the same card grid, chip row, or table pattern across slides.

## Body content uses grid/flex flow

- Lay out body content with grid/flex document flow.
- Use `absolute`/`fixed` only for background decoration, connectors, and non-text visual accents.
- Elements containing h1, h2, h3, p, li, or primary slide text use grid/flex cells, not absolute positioning.
- Put `gap-*` on grid/flex containers. Put `min-w-0` on long-text children.
- Avoid combining h-full, min-h-*, large padding, large gaps, and multi-paragraph text across nested vertical levels.
- For radial/surround/center-image layouts: use explicit grid (e.g. 3-col 3-row), put each module in its own cell, connector lines as SVG decoration layer.

## Height budgeting

Total canvas height: 900px. Before writing HTML, calculate the height budget in order:

1. Outer padding (e.g. `p-6` = 48px, `p-8` = 64px)
2. Title + subtitle area (~60-80px including gap)
3. Gaps between modules (each `gap-4` = 16px, `gap-6` = 24px)
4. Safety reserve (24-40px; use 40px for dense chart/table slides)
5. Remaining = maximum space for chart/data modules

Chart frame `h-[Npx]` must fit within the remaining space, but it should not blindly consume all leftover height. First calculate the available slot, then choose a role-appropriate chart height: hero 340-420px, standard 280-360px, compact support 220-280px. The chart skill's height comment must end with the chosen frame height, not just the raw leftover space. If the total exceeds 900px, change the composition and hierarchy before shrinking everything.

Charts, tables, timelines, and long lists must share the same budget as titles and notes. Budget the chart frame height before writing HTML — see the chart skill for chart-specific height rules.

## Overpacked chart slide guardrails

Do not treat the missing runtime padding as permission to add more content. The slide canvas is full height, but dense content still needs breathing room.

- If a slide has a main chart or two tall data cards, support modules are capped at 1-3 compact blocks.
- Do not create two-row bottom card grids below a tall chart, a two-column main area, or a long title. Six facts below a chart should be re-composed into a better data layout: evidence rail, small multiples, compact band, annotated chart, or table-like rows.
- A `grid-cols-3` support row may contain at most 3 cards. If there are 4-6 facts, choose a density-appropriate structure: bento grid, metric band, compact comparison, annotated chart, or table/list.
- Avoid `flex-1 min-h-0` main content followed by an uncapped bottom grid. Give rows explicit budgeted heights (`grid-rows-[auto_1fr_auto]`, `max-h-*`) or redesign the support area as part of the main composition.
- Footnotes are optional on crowded data slides. If kept, they must be a single short line included in the height budget.

For chart slides, decide the chart role before choosing layout density:

- If the chart is the main evidence, give it one dominant zone and keep support modules to 1-3 compact blocks.
- If the chart is supporting evidence, keep it compact and let the primary claim or comparison own the visual hierarchy.
- If the page needs more than one chart, use equal chart frames only when the charts are truly comparable; otherwise make one primary and one compact.
- Do not pair a tall chart with a full metric row, long subtitle, summary cards, and footnotes in full card form. Redesign the relationship between chart and evidence so one element is primary and the others are visibly supporting.

## Density rules

Low-density: large title/message scale, one core number, one strong visual symbol, generous whitespace, diagonal or asymmetric layout. Sparse content should feel intentional.

Medium-density: primary/secondary zones, one main visual + 2-3 supporting evidence blocks, left-right narrative, timeline, step ladder, matrix, or comparison. Clear hierarchy between main message and supporting points.

High-density: disciplined but expressive structures: bento grids, dashboards, matrices, compact lists, table-like rows, small multiples, or multi-card systems. Module count justified by real information volume. Equal-weight cards only for truly parallel items. 4-column cards only for real four-object comparison.

When source content has many data points, avoid equal-weight cards for everything. Preserve the information by changing its visual grammar: grouped labels, mini chart annotations, table-like rows, matrix, metric band, or a main chart plus concise evidence rail. A clear hierarchy with dense but disciplined support beats a crowded stack of full cards.

## Title readability

Titles are part of the reading path, not a fixed header decoration.

- Cover/summary slides: title can be at visual center.
- Data slides: title can be near a key number or beside the chart.
- Comparison slides: title where it clarifies the contrast.
- Within one deck, vary title position and card grid across consecutive pages.
- Vertical title text: only for short Chinese labels of 2-6 characters.
- Titles with English, numbers, years, mixed text, or long phrases must be horizontal.

## When content feels thin — fill the whole page

Clean layout does not mean empty. When source content is short, turn one idea into a richer visual argument.

Strategies:

1. **Expand the argument**: add context, comparison, baseline, reason, implication, or a "so what" line.
2. **Add a visual anchor**: diagram, axis, progress bar, timeline strip, comparison bracket, or quadrant using divs/SVG.
3. **Evidence rail**: 2-4 supporting cards or metric chips alongside the main message.
4. **Split into zones**: claim + evidence, number + context, before + after, cause + effect.
5. **Give the main idea more room**: scale up hero text/number, add subtitle, whitespace as framing.

Composition patterns:

- **Big claim + evidence rail**: hero on one side, 3 cards on the other. `grid grid-cols-[1fr_1fr]`.
- **Key number + context**: large metric, baseline/previous, interpretation block.
- **Before/after contrast**: two zones with 2-3 differences. `grid grid-cols-2`.
- **Cause → effect chain**: 3 steps + final implication. `grid grid-cols-3`.
- **Center concept + satellites**: central idea + 3 surrounding blocks in grid cells.
- **Image + annotation rail**: visual-dominant area + 2-4 annotations. `grid grid-cols-[2fr_1fr]`.

## Layout creativity

Vary layout aggressively across a deck. Consecutive slides should feel different, not like the same template with swapped content.

Creative techniques:

- **Asymmetric splits**: `grid grid-cols-[2fr_1fr]` or `grid-cols-[1fr_2fr]` — unequal zones feel more editorial.
- **Overlap / layering**: a card or badge overlapping two zones creates depth. Use relative positioning and small offsets while keeping the element in normal flow.
- **Split-tone backgrounds**: different background colors in left vs right zone. Use `bg-*` on each grid child.
- **Bento grid**: `grid grid-cols-3 grid-rows-2` with some cells spanning 2 columns or 2 rows (`col-span-2`, `row-span-2`). Feels like a magazine dashboard.
- **Floating cards over a color field**: full-slide color background, cards with `bg-white/90 backdrop-blur` positioned asymmetrically.
- **Diagonal accent**: a tilted decorative band (`rotate-3` or `skew-y-2`) behind the title or across the page. Content stays flat.
- **Staircase / cascade**: items offset vertically with increasing `ml-*` or `pl-*`, creating a stepped flow.
- **Edge-to-edge hero**: a full-width color block or gradient taking 40-60% of the page height, with text overlaid and detail cards below.

For complete HTML examples of these techniques, read `references/layout.md`.

## Layout intent composition guide

### `cover` — opening or section divider

Large title at visual center. Short subtitle for scope, date, or thesis. Optional accent line or background color block.

### `data-focus` — metrics, KPIs, charts

1-2 hero numbers with label, unit, context. Charts get the largest area. Budget chart height from remaining space.

### `comparison` — options, alternatives, before/after

Split into 2-3 zones with clear boundaries. Same dimensions in each zone for fair comparison.

### `timeline` — phases, stages, roadmap

Horizontal strip with labeled nodes, or vertical staircase with alternating cards. Each phase: label + time + 1-2 sentences.

### `concept` — ideas, frameworks

Central idea with supporting dimensions. Or structured breakdown: definition + aspects + example.

### `process` — steps, flow, mechanism

Numbered steps flowing left-to-right or top-to-bottom. Each step: short title + 1-2 sentences.

### `summary` — conclusion, takeaways

Opening conclusion in large text. 2-4 evidence blocks below.

### `quote` — single statement

Large quotation text. Attribution below. Optional context line.

### `image-focus` — products, scenes, visual material

Visual takes 60-70% of page. Text compact: title + 1-2 lines + labels.

## Failure repair strategy

When a slide has overflow, collision, or exceeds the canvas:

1. **Revisit density and hierarchy first**: decide what should be hero, support, annotation, or background.
2. **Change composition**: use a different creative family such as asymmetric split, bento, evidence rail, timeline strip, matrix, or layered callout.
3. **Change representation**: convert full cards into labels, bands, rows, annotations, or compact modules only when the density calls for it.
4. **Rebudget chart height**: if the page has a chart, calculate the available slot and choose a role-appropriate `h-[Npx]`; update the height comment so the final number matches the class.
5. **Check nesting**: flatten any deep wrapper chains that consume vertical space.

## Cross-skill references

- When a slide needs a chart, budget the chart frame height first (see chart skill), then lay out the remaining modules.
- Animation should follow the reading path (see animation skill), not replace layout.
