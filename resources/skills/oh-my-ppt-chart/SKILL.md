---
name: oh-my-ppt-chart
description: Must be read before adding or modifying Oh My PPT slide charts. Defines chart-selection rules, product-safe Chart.js usage, canvas layout constraints, axis label rules, and retry fixes.
---

# Oh My PPT Chart

For deeper examples (chart selection, frame height guide, category axis patterns, layout integration tips), read `references/chart.md`.

## When to use

- Adding a chart to a new or existing slide
- Modifying chart type, data, or options
- Repairing a blank or broken chart canvas

## When not to use

- Pure visual micro-edits that don't change chart structure (e.g. adjusting a single color value). These still follow chart skill hard rules, but don't require reading the full reference.
- A page without a source-grounded quantitative relationship. Course maps, agendas, processes, equal-status topic groups, hierarchies, and qualitative comparisons are page-native diagrams, not Chart.js charts.

## 30-second decision checklist

Before deciding to write chart HTML, answer these in order:

1. **Chart gate**: does the source provide a real numeric, temporal, compositional, profile, or correlation relationship? If not, use a page-native diagram and stop.
2. **Visual question**: is the message comparison, trend, composition, profile, or correlation? Choose the chart form for that question; never create numbers or proportions just to use a chart.
3. **Content slot**: how much vertical space remains for the chart zone after title, outer padding, gaps, notes, and reserve?
4. **Support budget**: if metric cards, insight rails, legends, or footnotes share that zone, subtract their height first. Start with a small support set (often 0-2 items) around a main chart; add more when the reading path, hierarchy, and chart budget remain clear.
5. **Final chart height**: hero / standard / compact? Pick one final px height for the chart frame. The `h-[Npx]` class must equal this final number.
6. **Data semantics**: one value axis = one unit/meaning. Do not mix counts, percentages, money, or "new role" labels in one numeric dataset.
7. **Takeaway**: what should the audience conclude from the chart? Write one visible interpretation sentence or a compact annotation rail; the chart cannot be the whole argument by itself.
8. **Data shape**: labels + datasets. Are there enough data points for the chosen type?
9. **Script event**: DOMContentLoaded only — the runtime loads Chart.js before this event fires.

## Chart selection

Use Chart.js only for a real source-grounded relationship:

- **Category comparison or ranking**: use a bar chart; use horizontal bars for long labels.
- **Ordered time or continuous change**: use a line chart; use an area only when cumulative magnitude is the message.
- **Verified, mutually exclusive parts of one stated whole**: use a doughnut or pie with 4-6 slices. Values must add to the displayed total or 100%; a list of topics or an invented time split is not a whole.
- **Same-scale scores across shared dimensions**: use a radar chart sparingly; every axis must share a meaningful scale.
- **Two or three numeric variables**: use scatter or bubble for correlation/distribution.
- **No data chart**: use a page-native route, four-part map, process, hierarchy, relationship diagram, or comparison layout for agendas, course maps, stages, concepts, or unquantified topic groups.

## How to create a chart

Every chart needs exactly two parts: an HTML frame with explicit height, and a script block using DOMContentLoaded + PPT.createChart.

### 1. HTML — chart frame with explicit height

Before writing the chart frame, you MUST calculate the chart slot and then choose the actual chart frame height. Write the calculation as an HTML comment immediately before the chart frame, include the dedicated marker `@ppt-chart-height=N`, and make the marker, the **final chart height**, and the `h-[Npx]` value all use the same number. Never put `@ppt-chart-height=...` as visible text inside `.ppt-chart-frame`. Do NOT write a comment that ends with one number and a frame height that uses another number. Two terms: **content slot** = current canvas height − padding − title − gaps − reserve (the area for the chart plus its support modules); **chart slot** = content slot − support modules. The final `h-[Npx]` MUST equal the chart slot, never the content slot.

```html
<!-- height calc @ppt-chart-height=560: default 900 canvas example; content slot = 900 - 48(p-6) - 68(title) - 24(gap-6) - 28(h3) - 8(gap-2) - 32(reserve) = 692 (chart + support area); support rail = 132; chart slot = 692 - 132 = 560 -> h-[560px] -->
<div class="ppt-chart-frame relative h-[560px] w-full overflow-hidden">
  <canvas id="my-chart" class="h-full w-full"></canvas>
</div>
```

The final number in the comment and `h-[Npx]` MUST match. If the comment ends with `chart height = 420`, the div MUST say `h-[420px]`; never write `chart height = 420` and then use `h-[240px]`.

Use this exact comment structure for generated charts:

```html
<!-- height calc @ppt-chart-height=[final]: content slot = [current canvas height - ... - reserve] = [content slot]; support = [support height]; chart slot = [content slot - support] = [chart slot]; chart height = [role decision] = [final] -->
<!-- Example after replacing placeholders: height calc @ppt-chart-height=560: chart slot = 560; chart height = hero/main = 560 -->
<div class="ppt-chart-frame relative h-[560px] w-full overflow-hidden">
```

Calculation steps:
1. Start from the current canvas height stated by the layout/canvas prompt (runtime page root has no default padding)
2. Subtract outer padding (p-6=48, p-8=64)
3. Subtract all modules above the chart: title, subtitle, metrics row, legends
4. Subtract all gaps between modules
5. If chart is inside a card: subtract card padding and card title
6. Subtract a 24-40px safety reserve (use 40px on dense data slides)
7. This gives the **content slot** for the chart zone.
8. Subtract only sibling modules stacked above/below the chart inside the same column or vertical zone. Side-by-side modules in other columns share width, not height; do **not** divide the content slot by column count, and do not subtract a left metric rail from a right-column chart height.
9. Choose the chart frame height from the chart slot (do not stop short and leave an empty band):
   - Hero/main chart (dominant zone): 380–560px only when the chart is the primary evidence
   - Standard chart beside/under a compact support set: 280–360px, with an actual nonzero gap around independent support modules
   - Compact supporting chart (one small module in a dense layout): 220–280px, with other modules kept concise
   - If the computed chart slot is 600px+ and the chart is the primary evidence, use the top of the hero/main range (usually 520–560px). Do not calculate a 600+ slot and then choose 340px for the primary chart.
10. If the chart slot is below the space needed for its labels, axes, and intended reading distance (often around 220px on a 1600×900 canvas), redesign the chart/support relationship and run the layout width/height self-check again.

Column budget rule: columns share width, not height. If the page uses `grid-cols-2`, the chart column still receives the full post-title vertical content slot. A bad calc is `content slot = 732; left metrics = 732/2; right side = 366`; the correct calc is `right column content slot = 732`, then subtract only the right-column heading, insight card, gaps, padding, and reserve.

Avoid a two-row bottom card grid when it competes with a standard/tall chart. If the slide has 4-6 additional facts, choose in-chart annotations, an evidence rail, a compact table, a grouped list, or a compact aligned data mosaic with an explicit budget. A main chart usually starts with 0-2 support items; a larger set is valid when the chart remains dominant and the reading path stays clear.

Axis-heavy charts need extra space. For horizontal bars with 6+ categories, long labels, negative+positive ranges, or wide tick labels such as percentages, reserve 40-60px inside the chart options for the x-axis/tick area (`layout.padding.bottom`, tick padding, and a modest `maxTicksLimit`). If that would push support modules into a second row, redesign the support area as a side rail, annotation band, compact table, or in-chart callouts instead of shrinking the plot.

Only the `.ppt-chart-frame` owns chart size. The `<canvas>` uses `class="h-full w-full"` and must not have `width`, `height`, or inline `style` size attributes in generated HTML.

### Data semantics — one axis, one meaning

Do not mix units or meanings in a single Chart.js dataset or value axis. A bar chart whose x-axis is "变化率 %" must contain only percentages; do not put headcount values such as `850` or `1400` into that same dataset. If the source has both absolute counts and percent changes, choose one expression:

- **Counts story**: grouped bars for 2022 vs 2026 headcount; put percent change in tooltips, labels, or a compact insight rail.
- **Change-rate story**: bars for comparable percentage changes only; represent "new role / 0 → 850" as an annotation or separate card, not as `850` on the percent axis.

Chart.js category labels are plain text. Do not put HTML such as `<br>`, `<span>`, or inline styles inside `data.labels`; Chart.js will draw that HTML literally or mis-measure it. For multi-line category labels, use string-array labels (e.g. `['AI调校师', '约80→1,400']`) or keep details in tooltip callbacks / nearby annotations.

### Chart slides need interpretation

A chart-only slide is usually under-explained even if the chart is large. Pair the main chart with one visible takeaway sentence and, when useful, concise annotations, an insight rail, or a source/note line. These support modules explain how to read the chart; they must not repeat every bar/table row as equal-weight cards. If the source has rich context, use the support area for "so what", caveat, baseline, or implication rather than more labels.

Bad patterns to avoid:

```html
<!-- height calc: current canvas height - 48(...) = available content slot -->
<div class="ppt-chart-frame relative h-[400px]">...</div>

<div class="ppt-chart-frame relative h-64">...</div>

<canvas id="chart" width="320" height="380" style="height: 240px"></canvas>

<!-- Mixed units on one percentage axis: 850 people, 1650%, and 17.9% are not comparable -->
data: { labels: ['AI叙事设计师', 'AI调校师', '原画师'], datasets: [{ label: '变化率', data: [850, 1650, 17.9] }] }

<!-- Chart.js labels are not HTML -->
labels: ['AI调校师<br><span>约80→1,400</span>']
```

### 2. JavaScript — always use DOMContentLoaded + PPT.createChart

```html
<script>
document.addEventListener('DOMContentLoaded', function() {
  PPT.createChart(document.getElementById('my-chart'), {
    type: 'bar',
    data: {
      labels: ['A', 'B', 'C'],
      datasets: [{
        label: 'Revenue',
        data: [10, 20, 30],
        backgroundColor: ['#3B82F6', '#10B981', '#F59E0B']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
});
</script>
```

This is the only correct event and the only correct API. The runtime loads Chart.js before `DOMContentLoaded` fires, so the helper is always available inside this callback.

### Complete working example

```html
<div class="grid grid-cols-2 gap-4">
  <div class="flex flex-col gap-2">
    <h3 class="text-2xl font-bold">Quarterly Revenue</h3>
    <p class="text-lg text-gray-500">Growth trend across regions</p>
  </div>
  <!-- height calc @ppt-chart-height=560: default 900 canvas example; page content slot = 900 - 48(p-6) - 68(title/subtitle) - 24(gap-6) - 32(reserve) = 728; two columns share width, not height; right-column heading/support = 168; chart slot = 728 - 168 = 560; chart height = hero/main side chart = 560 -->
  <div class="ppt-chart-frame relative h-[560px] w-full overflow-hidden">
    <canvas id="revenue-chart" class="h-full w-full"></canvas>
  </div>
</div>
<script>
document.addEventListener('DOMContentLoaded', function() {
  PPT.createChart(document.getElementById('revenue-chart'), {
    type: 'bar',
    data: {
      labels: ['Q1', 'Q2', 'Q3', 'Q4'],
      datasets: [{
        label: 'Revenue (M)',
        data: [12, 19, 15, 22],
        backgroundColor: '#3B82F6'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
});
</script>
```

## Hard rules

- Use `PPT.createChart(canvasElement, config)` — pass the canvas DOM element, not a 2D context.
- Wrap every `PPT.createChart` call inside `document.addEventListener('DOMContentLoaded', function() { ... })`.
- Put category labels in `data.labels` as plain strings or string arrays. If a category-axis `ticks.callback` is needed, return `this.getLabelForValue(value)`.
- Derive chart frame height from the layout budget (current canvas height minus all other modules and a 24-40px safety reserve), then choose a height that fits the chart role. Do not blindly use all leftover height.
- Every generated `.ppt-chart-frame` needs the height calc comment immediately before it.
- Do not add padding to the `.ppt-chart-frame` div — it wastes height budget without visual benefit. Padding belongs on the parent card/container, not on the chart frame itself.
- Do not put `width`, `height`, or inline `style` size attributes on `<canvas>`; the chart frame controls the size.
- Keep chart code local and deterministic.

## Failure repair strategy

When a chart is blank or broken:

1. **Check the event**: the script must use `DOMContentLoaded`. Any other event name (ppt-ready, ppt-rendered, ppt-page-ready, load, etc.) will not fire or fire too early.
2. **Check the canvas id**: the `getElementById` string must match the canvas `id` attribute exactly.
3. **Check the height**: the chart frame `h-[Npx]` must be a positive number. A missing or zero height produces an invisible canvas.
4. **Check the data format**: labels must be an array of plain strings/string arrays (no HTML), datasets an array of objects with a `data` array of numbers using one unit/meaning per value axis.
5. **Remove duplicate scripts**: if editing a page that already has a chart, merge scripts rather than adding a second `DOMContentLoaded` listener for the same canvas.

## Chart animation boundary

Two levels of chart animation, each handled by a different system:

- **Chart container entrance** (the whole chart block fading/sliding in): add `data-anim` on the `.ppt-chart-frame` div. This is a standard layout animation — see animation skill.
- **Chart internal drawing** (bars growing, lines drawing, pie slices rotating): controlled by Chart.js `options.animation`. The runtime defaults handle this; you rarely need to customize it.
- **Do not** write custom JS timelines that animate individual chart elements. Use `data-anim` for the container, and Chart.js options for the internals.

## Cross-skill references

- Budget chart height from the current slide height (see layout skill). Title + modules + gaps + chart frame + 24-40px reserve <= current canvas height.
- Chart container entrance animation uses `data-anim` on the chart frame div (see animation skill).
