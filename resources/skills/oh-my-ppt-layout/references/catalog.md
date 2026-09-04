# Oh My PPT Layout — Pattern Catalog

> **This catalog is advisory.** Every layout pattern is a *structure choice*, not a template. It describes how information is organized — module count, primary/secondary hierarchy, reading path, and height budget. It does **not** prescribe colors, rounded corners, shadows, gradients, fonts, or any decorative look. Any pattern can be re-visualized by whatever style the user has chosen; the structure stays the same while the current style owns the visual language.
>
> Success is **not** "use as many patterns as possible." It is: the model picks the structure that lets the current style express the content most stably — a data page knows the relationship between its main chart and support modules, a comparison page aligns its zones fairly, a process page defines its reading path, a summary page separates the conclusion from its evidence.

## How to read a layout pattern

Each pattern has four parts:

- **Input shape** — what content and density this pattern fits.
- **Structure recipe** — the recommended grid/flex organization (tracks, module count, primary/secondary, reading path). **No visual words** — colors, corners, shadows, gradients, fonts are all decided by the current style.
- **Budget rule** — the structural relationship that lets the page use the 1600×900 canvas: which module dominates, how the rest shares the remaining space, where actual module gaps belong, and the failure sign when it overflows or leaves a large accidental empty band. It states the relationship, not a pixel budget — you compute the actual heights.
- **Failure signs** — structural failures (overload, collision, missing hierarchy, overflow, unreadable font size) and how to reorder. **No aesthetic failure** ("too plain", "not elegant") — those belong to the style.

Before trusting a structure recipe, run the **style-swap self-check**: swap the current style for any other style; does this pattern description still hold without pointing at one fixed look? If not, rewrite it in more abstract structural language.

---

## Canonical 1600×900 zone skeletons

Use these skeletons when the model would otherwise invent an unstable layout. They are **not visual styles**: do not copy colors, rounded corners, shadows, gradients, or decoration from the skeleton name. The current style still owns the visual language. The skeleton only decides canvas zones, hierarchy, and what carries the page's thesis.

The visual center may sit slightly above the geometric center for comfortable projection, but the slide must still use the middle of the canvas. A page where all real modules sit in the top half and the lower half is only source text or background is not a designed low-density page.

#### `full-height-two-zone`

- **Use for**: data exhibit, comparison, concept explanation, or a page with one dominant evidence object plus supporting interpretation.
- **Zone sketch**: title/claim band at top; remaining height split into two full-height columns or unequal zones. One zone carries the primary chart/table/diagram/hero number; the other carries an insight rail, compact evidence, or a concise explanation block.
- **Balance rule**: both zones must visibly participate in the middle of the canvas. The support zone may be lighter, but it cannot become a huge empty card with one short paragraph floating inside.
- **Failure sign**: a small chart or metric row at the top plus a large blank lower area. Recompose into two full-height zones, or let the primary object own the middle and move support into a rail.

#### `vertical-timeline-lanes`

- **Use for**: roadmap, forecast, history, phased plan, or year-by-year narrative.
- **Zone sketch**: title band at top; the content area becomes lane columns or stacked lanes that extend through the middle height. Each time period gets a lane with 1–3 compact events distributed down the lane, plus one conclusion band or trend note at the bottom when useful.
- **Balance rule**: timeline cards should not all sit in one top row. If a year has fewer events, use larger event spacing, a milestone marker, or a concise trend note so the lane still feels intentional.
- **Failure sign**: three year columns with two cards each in the upper third and a blank middle. Rebuild as lanes that occupy the content height.

#### `kpi-dashboard-balanced`

- **Use for**: KPI overview, key data snapshot, market sizing, or metric-heavy summary.
- **Zone sketch**: title/claim band; one hero metric or primary data band; secondary metric group, compact comparison row, or insight rail in the lower/middle area. The hierarchy is hero first, support second.
- **Balance rule**: a metric dashboard needs a designed middle, not just a row of equal cards near the top. If there are many facts, group them into metric bands, bento cells, or compact rows instead of equal full cards.
- **Failure sign**: a top row of KPI cards followed by untouched background. Promote one metric to hero, use a lower support band, or switch to a bento/grid structure.

#### `chart-plus-insight-stack`

- **Use for**: one main chart where the takeaway matters as much as the data.
- **Zone sketch**: title/claim band; chart frame as the dominant middle zone; concise insight band, annotation rail, or 1–2 support chips attached to the chart. Footer/source stays small.
- **Balance rule**: if the chart is the main evidence, it normally needs a real chart frame (often 380–560px depending on remaining slot) and the insight area stays compact. A 220–280px chart can be intentionally supporting evidence; make sure either it or another visual element clearly carries the page's thesis.
- **Failure sign**: a compact chart presented as the sole hero without enough visual weight, or a giant empty explanation card beside/below the chart, weakens the argument → adjust the relationship between chart, explanation, and visual focal point rather than mechanically enlarging the chart.

---

## `cover` — opening or section divider

### `hero-title-center`

- **Input shape**: Opening cover. Single title + optional one-line subtitle (scope, date, or thesis). Low density.
- **Structure recipe**: Title block centered on both axes. Optional accent line above or below the title. Subtitle on its own line beneath. Single column, generous outer padding.
- **Budget rule**: Title + subtitle + accent occupy a centered low-density composition; use scale and placement to keep the opening visually complete without adding filler.
- **Failure signs**: Multiple subtitles, intro paragraphs, or several metadata rows turn the cover into a document page → keep the cover to title + one subtitle line; fold the extra detail into the subtitle or compress it into a single metadata tag.

### `hero-title-asymmetric`

- **Input shape**: Cover or section opener that wants editorial energy. Title + short subtitle + optional single metadata tag.
- **Structure recipe**: Two-zone unequal split (`grid grid-cols-[2fr_1fr]` or `[3fr_1fr]`). Title block in the dominant zone; the small zone holds subtitle/metadata or provides a visual counterweight. Title left-aligned, vertically centered.
- **Budget rule**: Dominant zone carries title scale; small zone keeps to 1–2 short lines.
- **Failure signs**: The small zone fills with multiple paragraphs that compete with the title → reduce the small zone to one short anchor.

### `hero-big-number`

- **Input shape**: Cover or key-message slide built around one headline metric (a total, a percentage, a year). Low density.
- **Structure recipe**: One hero number at visual center (or in the dominant zone); label/unit below it; optional one-line context. Single column.
- **Budget rule**: Hero number + label + 1 context line; use scale and placement to keep the single focus visually complete without adding a parallel card row.
- **Failure signs**: Two or three competing big numbers, or a long explanation paragraph under the number, kills the hero → pick one hero number; relegate the other numbers to 1–2 small context chips or fold them into the hero label.

### `section-divider`

- **Input shape**: Chapter/section transition. Section label + section name + optional one-line scope.
- **Structure recipe**: Low-density, centered or asymmetric. Section label (e.g. an index) and section name on separate lines. Single column.
- **Budget rule**: Label + name occupy a center band; keep the transition concise and focused.
- **Failure signs**: The divider carries body bullets or a mini agenda → it becomes a content slide; keep it to label + name (+ optional one scope line).

---

## `quote` — single statement

### `hero-quote`

- **Input shape**: One quotation or statement that *is* the slide. Low density.
- **Structure recipe**: Quotation block centered on both axes, constrained to a readable line length (e.g. `max-w-3xl`). Attribution on its own line below at a smaller scale. Optional one-line context.
- **Budget rule**: Quote + attribution + 1 context line; large padding; no grid needed.
- **Failure signs**: Multiple quotes, or a paragraph of commentary around the quote, dilute it → one quote per slide; fold commentary into a single context line beneath the attribution, or compress it into a short context tag.

---

## `summary` — conclusion, takeaways

### `summary-takeaways`

- **Input shape**: Conclusion/takeaway slide. One conclusion statement + 2–3 evidence or takeaway points. Low-medium to medium density.
- **Structure recipe**: Opening conclusion at the top at hero scale; 2–3 takeaway blocks below in a grid (`grid-cols-2` or `grid-cols-3`) or stacked. Conclusion dominates; takeaways support.
- **Budget rule**: Conclusion ~1–2 lines; takeaway blocks use enough space to carry the page while retaining actual gaps between independent modules. Do not force 3–4 full cards just to fill height.
- **Failure signs**: 5+ takeaways, or takeaways each holding long paragraphs, overflow → group into 3 primary takeaways; secondary detail becomes annotation chips.

### `executive-brief`  *(controlled high-density, use sparingly)*

- **Input shape**: An executive summary that must convey conclusion + key data + risk/action in one slide. High density but disciplined.
- **Structure recipe**: Three-band vertical structure: (1) one-line conclusion, (2) key-data row of 2–4 metric cells, (3) risk/action row of 1–3 compact blocks. Use `grid-rows-[auto_auto_1fr]` with each band a grid. Reading path: conclusion → data → action.
- **Budget rule**: three bands — one-line conclusion, key-data row, risk/action row — share the canvas; the data band takes the room it needs, conclusion and action stay compact, and the three bands remain clearly separated.
- **Failure signs**: Adding a fourth band (a full chart or a long footnote list) overflows → executive-brief holds three bands only; if a chart is essential, swap one band for a compact chart or switch this page to the `trend-exhibit` pattern.

---

## `data-focus` — metrics, KPIs, charts

### `kpi-hero`

- **Input shape**: One headline KPI to dominate. Optional baseline, unit, and context.
- **Structure recipe**: Hero KPI number + label in the dominant zone; use a compact context set (baseline, delta, or note) beside or below. Single column or `grid grid-cols-[2fr_1fr]`.
- **Budget rule**: KPI hero often occupies roughly 40% of height; keep context visibly secondary without adding filler modules. If more context is essential, group it into a compact rail or matrix rather than making each detail a full card.
- **Failure signs**: A full chart + KPI + metric row + footnotes all compete as heroes → make the KPI primary, or choose `chart-annotated`, `metric-band`, or a compact grouped context treatment that keeps one clear focal point.

### `metric-band`

- **Input shape**: Parallel metrics of equal weight (a dashboard snapshot). Medium-high density.
- **Structure recipe**: A short set can use one horizontal band of equal-width cells; a larger set can use grouped bands, a bento grid, or a compact matrix. Each cell is number + label. Optional one-line title above the band.
- **Budget rule**: cells stay compact (number + short label); choose the number of rows and columns from the available width, hierarchy, and actual metric relationship rather than forcing one band.
- **Failure signs**: Cells holding multi-line paragraphs, or multiple full-card bands competing equally, overflow → keep cells to number + short label and group the metrics into a clearer band, bento, matrix, or comparison structure.

### `trend-exhibit`

- **Input shape**: One main trend/chart as the primary evidence with a compact support set as needed. Medium density.
- **Structure recipe**: Title at top; chart in the dominant zone; start with compact support blocks (metric chips or an annotation rail) in a single row or narrow rail. When more parallel facts are essential, a compact aligned data mosaic is valid if its budget is explicit and the chart remains dominant.
- **Budget rule**: title at top; the chart owns the dominant zone and support blocks sit beside or below it only when they clarify the chart. Independent chart and support modules retain an actual nonzero gap. The chart is not a tiny default, but the page is not forced into a dense dashboard.
- **Failure signs**: A two-row bottom card grid under the tall chart, or support modules expanded into full cards, overwhelms the chart or overflows the 900px budget → regroup the support, move it to a rail/table/annotations, or use a shorter aligned data mosaic; see SKILL.md "Overpacked chart slide guardrails".

### `chart-annotated`

- **Input shape**: A chart whose key insight needs callouts. Chart is primary; annotations are the support.
- **Structure recipe**: Chart in the dominant zone; 1–3 annotation labels placed as a rail beside it (`grid-cols-[2fr_1fr]`) or as a compact row below, each annotation tied to a chart feature. No card grid competing with the chart.
- **Budget rule**: chart owns the dominant zone; annotation rail/row beside or below stays compact and retains an actual nonzero gap from the chart.
- **Failure signs**: Annotations expanded into full multi-line cards, or a second chart plus an annotation row, overflow → annotations stay as short callouts; a second chart only when the two are truly comparable (one primary, one compact).

---

## `comparison` — options, alternatives, before/after

### `compare-two-zone`

- **Input shape**: Side-by-side comparison of two options or states (before/after, A/B). Medium density.
- **Structure recipe**: Use two comparable zones (`grid-cols-2` or unequal tracks when one side genuinely needs more context). Align the shared dimensions and field treatment wherever the comparison calls for a fair A/B reading; title spans both zones at the top.
- **Budget rule**: title spans both zones at top; distribute width and height according to the comparison relationship, with an actual nonzero gap between independent comparisons.
- **Failure signs**: Missing shared dimensions make an intended A/B comparison ambiguous, or long paragraphs overflow → align the comparable fields, make the asymmetry explicit, and turn long text into labels.

### `compare-options`

- **Input shape**: Compare multiple options along shared dimensions. Medium-high density.
- **Structure recipe**: Options as columns or rows with shared dimension labels. A short option set can use `grid-cols-3` / `grid-cols-4`; a larger one can use a row-per-dimension table, grouped matrix, or multi-row comparison. Keep the shared dimensions consistent where they are being compared.
- **Budget rule**: choose columns, rows, and grouping from the option count and available width; each cell remains concise and the comparison stays scannable.
- **Failure signs**: Too many options forced into narrow columns, or cells with long prose, overflow → change to rows, grouped comparison, or a matrix; condense prose to phrases without discarding necessary options.

### `decision-matrix`  *(fills a gap)*

- **Input shape**: Evaluate options against weighted criteria (a decision aid). High density.
- **Structure recipe**: Matrix grid — rows are criteria, columns are options, cells are ratings/values. Criteria labels in a left rail (`grid-cols-[1fr_repeat(n,1fr)]`); optional one-line verdict per option below. Equal columns.
- **Budget rule**: header + criteria rows + optional verdict row; row count justified by real criteria; fit in 900px.
- **Failure signs**: A criteria column with long prose cells, or 6+ criteria, overflows → criteria condense to short labels; cap visible criteria at 5–6; fold deep rationale into a compact footnote line or one summary cell.

---

## `concept` — ideas, frameworks

### `concept-center-satellites`

- **Input shape**: One central concept explained by surrounding facets. Medium density.
- **Structure recipe**: Explicit `grid-cols-3 grid-rows-3` with the concept in the center cell and satellites in surrounding cells; connector lines as an SVG decoration layer (not content). Each satellite: short title + 1 line.
- **Budget rule**: a compact center/satellite layout often uses 4–8 satellites; for more facets, choose a larger grid, grouped ring, or a different concept structure that preserves readable labels and gaps.
- **Failure signs**: Satellites holding multi-line paragraphs, or the center concept also being a long paragraph, collide → keep satellites short and move to a larger grid, grouped concept map, `framework-2x2`, or a compact list as the content calls for it.

### `framework-2x2`  *(fills a gap)*

- **Input shape**: A 2×2 framework / quad map (two axes, four quadrants). Medium density.
- **Structure recipe**: `grid-cols-2 grid-rows-2` for the four quadrants; axis labels placed as a decoration/rail (one top axis label, one left axis label); each quadrant: short title + 1–2 lines. Reading path: axis meaning → quadrant.
- **Budget rule**: axis labels + 2×2 grid; each quadrant capped at short title + 1–2 lines + reserve.
- **Failure signs**: Quadrants holding long paragraphs, or a third implicit axis, break the 2×2 → quadrants condense to short title + 1 line; if there is a third dimension, switch this page to the `framework-pyramid` pattern.

### `framework-pyramid`  *(fills a gap)*

- **Input shape**: A layered hierarchy (strategy → tactics → execution, or a needs hierarchy). Medium density.
- **Structure recipe**: Stacked horizontal layers, narrowest at the top (or bottom). `grid-rows-3` / `grid-rows-4` with each layer a band holding a layer label + one-line content. Reading path is consistent (apex → base, or base → apex).
- **Budget rule**: 3–5 layers is a readable starting range; each layer is a band holding a label + one line. For more layers, choose a wider, multi-row, or stepped structure that keeps the hierarchy readable.
- **Failure signs**: Too many layers or multi-line paragraphs make the hierarchy unreadable or overflow → change the representation, use compact labels, or choose a different hierarchy structure without discarding necessary stages.

---

## `process` — steps, flow, mechanism

### `process-linear`

- **Input shape**: A linear sequence of steps or stages. Medium density.
- **Structure recipe**: A short sequence can use a row (`grid-cols-3` / `grid-cols-4` / `grid-cols-5`); longer sequences can use a vertical staircase, multi-row path, or grouped lanes. Each step uses a number/label + concise content. Connectors are decoration. Reading path: left → right (or top → bottom).
- **Budget rule**: 3–6 steps is a readable starting range; for more steps, change the path structure before labels become cramped.
- **Failure signs**: Steps holding long paragraphs, or a long sequence forced into one row, overflow → choose a vertical/multi-row path or a timeline while preserving the necessary stages.

### `process-loop`  *(fills a gap)*

- **Input shape**: A cyclical/recurring process (continuous improvement, lifecycle). Medium density.
- **Structure recipe**: Center cell holds the cycle's goal or theme; a compact cycle can arrange stage cells in a ring around the center (`grid-cols-3 grid-rows-3` with the center occupied). For more stages, use a multi-row cycle, loop-plus-rail, or linear sequence. Connector arrows as SVG decoration show loop direction. Reading path: center theme → stages in cycle order.
- **Budget rule**: 3–5 stage cells is a readable starting range; each stage stays concise and the selected cycle structure fits the canvas.
- **Failure signs**: Long paragraphs or connector arrows overlapping stage text cause collisions → keep stages concise and choose a multi-row or linear representation when the cycle has more stages.

---

## `timeline` — phases, stages, roadmap

### `timeline-strip`

- **Input shape**: A sequence of phases over time (roadmap, history, project plan). Medium density.
- **Structure recipe**: Horizontal strip with labeled nodes (or a vertical staircase for many phases); each phase: time + label + 1–2 lines. Optional detail cards in a single band below the strip. `grid-cols-n` for nodes.
- **Budget rule**: title; a horizontal node strip; an optional detail band below; together they feel balanced. With no detail band, the strip and nodes scale up modestly instead of leaving the page accidentally short.
- **Failure signs**: A long node sequence forced into one horizontal strip compresses labels unreadably, or detail cards expanding into a two-row grid below overflow → switch to a vertical staircase, multi-lane timeline, or grouped path while preserving the necessary node labels on the page.

---

## `image-focus` — products, scenes, visual material

> Standard mode does **not** generate images. These patterns describe how to lay out a slide *when an image asset already exists* (an imported image, a screenshot, a diagram you have been given). Do not create image slots, request image jobs, or reserve empty image placeholders.

### `asset-image-hero`

- **Input shape**: A slide built around one existing image/diagram/screenshot — the image is the argument.
- **Structure recipe**: Image fills 60–70% of the canvas (dominant zone); compact text block: title + 1–2 lines + labels. Single column or `grid-cols-[2fr_1fr]` with the image dominant. The image needs an `object-fit` and an explicit ratio constraint (structural — it prevents distortion, not a style choice).
- **Budget rule**: image zone carries most of the visual weight; compact text block (title + 1–2 lines); image and text remain separated by an actual nonzero gap.
- **Failure signs**: The text block expanding into multiple paragraphs competes with the image, or an image without a ratio constraint distorts → text stays compact; the image gets an explicit ratio.

### `asset-text-visual-split`

- **Input shape**: Image and substantial text both matter (narrative + visual). Medium density.
- **Structure recipe**: Two-zone split (`grid-cols-2` or `grid-cols-[1fr_2fr]`); one zone is the image (with a ratio constraint), the other is text (title + 2–3 short blocks). Reading path is defined by which zone is primary.
- **Budget rule**: split zones share height equally; text zone capped at title + 2–3 short blocks; reserve.
- **Failure signs**: The text zone holding long paragraphs, or an image without a ratio constraint, overflow or distort → text condenses; the image gets a ratio.

---

## Stackable composition techniques

These are **not** layout patterns. They are composition mechanics you can layer on top of any pattern above to add hierarchy or rhythm. They describe mechanism only — the actual color, weight, and decoration are chosen by the current style.

- **unequal-zones** — unequal grid track splits (`grid-cols-[2fr_1fr]`, `[1fr_3fr]`). The larger zone gets dominance; the smaller zone anchors with context. Use for hero + support, claim + evidence, narrative + data.
- **overlap-layering** — a background image/video field may carry a transparent panel or necessary text as an intentional media composition; reserve the panel's readable zone and keep all media inside the canvas. For non-media content, create depth with nested color, border, shadow, or background layers inside a module's own grid/flex cell, while independent modules remain separated by a nonzero gap. `absolute` / translate is for decorative accents only, never for content cards or text.
- **bento-grid** — `grid-cols-4 grid-rows-3` with some cells `col-span-2` / `row-span-2` to create size hierarchy within the grid; the largest cell gets implicit importance. Use for 5+ parallel items that need differentiation.
- **split-tone** — each grid child gets its own background (color chosen by the current style) to create an instant visual split. Keep an actual nonzero gap between independent content modules. Use for before/after, problem/solution.
- **floating-cards** — a full-canvas background with card modules placed asymmetrically on top; the shared background unifies disparate content. Use for process steps, feature showcases, brand slides.
- **staircase** — modules offset with incrementing `ml-*` / `pl-*` create a diagonal reading flow; pair with a descending scale for rhythm. Use for sequential content.
- **hero-band** — a full-width band occupying 40–60% of page height creates dramatic weight; use it as a grid/flex zone with a compact support row below, separated by a nonzero gap. Use for key results and section openers.
- **diagonal-accent** — a tilted decorative band behind the content layer (via transform rotation; angle chosen by the current style) adds energy; content stays flat on top. Use for covers, case studies that need energy without affecting layout.
- **asymmetric-weight** — content placed off-center (e.g. left 60%) with a dominant visual field and limited support. Use for quotes, key messages, low-density slides.

---

## Intent → pattern quick lookup

| Intent | Patterns |
| --- | --- |
| `cover` | `hero-title-center` · `hero-title-asymmetric` · `hero-big-number` · `section-divider` |
| `quote` | `hero-quote` |
| `summary` | `summary-takeaways` · `executive-brief` |
| `data-focus` | `kpi-hero` · `metric-band` · `trend-exhibit` · `chart-annotated` |
| `comparison` | `compare-two-zone` · `compare-options` · `decision-matrix` |
| `concept` | `concept-center-satellites` · `framework-2x2` · `framework-pyramid` |
| `process` | `process-linear` · `process-loop` |
| `timeline` | `timeline-strip` |
| `image-focus` | `asset-image-hero` · `asset-text-visual-split` |
