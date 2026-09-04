# Chart Reference

Deep-dive examples, layout integration patterns, and Chart.js options that work reliably in Oh My PPT.

## Complete working example

Copy this pattern for every chart. Adapt the type, data, and options.

```html
<!-- height calc @ppt-chart-height=560: default 900 canvas example; content slot = 900 - 64(p-8) - 80(title/subtitle) - 24(gap-6) - 32(reserve) = 700; support note = 140; chart slot = 700 - 140 = 560; chart height = hero/main = 560 -->
<div class="ppt-chart-frame relative h-[560px] w-full overflow-hidden">
  <canvas id="chart-sales" class="h-full w-full"></canvas>
</div>

<script>
document.addEventListener('DOMContentLoaded', function() {
  PPT.createChart(document.getElementById('chart-sales'), {
    type: 'bar',
    data: {
      labels: ['Q1', 'Q2', 'Q3'],
      datasets: [{
        label: 'Revenue',
        data: [12, 18, 26]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true }
      }
    }
  });
});
</script>
```

## How PPT.createChart works

`PPT.createChart` wraps `new Chart()` and adds several layers of safety:

1. **Readiness guard**: waits for Chart.js v4 to be loaded before creating the instance.
2. **Auto-cleanup**: if a chart already exists on the same canvas, it calls `.destroy()` first — safe to re-render on the same element.
3. **Number formatting**: injects tick callbacks for value axes (trims floating-point noise) and tooltip callbacks that prefix the dataset label.
4. **Category label fix**: on category axes, injects `this.getLabelForValue(value)` so labels always render as strings.
5. **Post-creation resize**: waits 2 animation frames, then calls `chart.resize()` and `chart.update("none")` to ensure correct rendering after layout settles.
6. **Instance registry**: tracks the chart in a global registry for `PPT.updateChart`, `PPT.destroyChart`, and `PPT.resizeCharts`.

Use `PPT.createChart` — never `new Chart(...)`.

## Chart frame height guide

The `.ppt-chart-frame` parent must have an explicit `h-[Npx]` height. Chart.js requires a concrete pixel height to render — relative values (`flex-1`, `h-full`, `min-h-*`) are unreliable.

### Mandatory: calculate slot, choose chart height, then write — numbers must match

Before writing the chart frame, calculate the chart slot, choose the actual chart frame height for the slide role, and write both in an HTML comment immediately before the chart frame. The comment MUST include the dedicated marker `@ppt-chart-height=N`, and the marker value MUST equal `h-[Npx]`. Never put `@ppt-chart-height=...` as visible text inside `.ppt-chart-frame`. Two terms: **content slot** = current canvas height − padding − title − gaps − reserve (the area for the chart plus its support modules); **chart slot** = content slot − support modules. The final `h-[Npx]` MUST equal the chart slot, never the content slot.

```html
<!-- height calc @ppt-chart-height=520: default 900 canvas example; content slot = 900 - 48(p-6) - 80(title+subtitle) - 24(gap) - 40(reserve) = 708 (chart + support area); support cards below = 188; chart slot = 708 - 188 = 520 -> h-[520px] -->
<div class="ppt-chart-frame relative h-[520px] w-full overflow-hidden">
  <canvas id="my-chart" class="h-full w-full"></canvas>
</div>
```

The final number in the comment and `h-[Npx]` MUST match. Do NOT leave a comment such as `chart height = 420` and then use `h-[240px]`; write the final chart-height decision explicitly and copy that exact number into `h-[Npx]`.

Calculation steps:
1. Start from the **current canvas height** stated by the layout/canvas prompt (runtime page root has no default padding)
2. Subtract outer padding (p-6=48, p-8=64)
3. Subtract all modules above the chart: title, subtitle, metrics row, legends
4. Subtract all gaps between modules
5. If chart is inside a card: subtract card padding and card title/heading
6. Subtract a 24-40px safety reserve
7. This gives the **content slot** for the chart zone.
8. Subtract only sibling modules stacked above/below the chart inside the same column or vertical zone. Side-by-side modules in other columns share width, not height; do **not** divide the content slot by column count, and do not subtract a left metric rail from a right-column chart height.
9. Choose chart height from the chart slot without creating a dense wall of content: hero/main 380–560px when the chart is the primary evidence, standard 280–360px with a compact support set, compact supporting 220–280px. Keep an actual nonzero gap between independent chart and support modules. If the computed chart slot is 600px+ and the chart is the primary evidence, use the top of the hero/main range (usually 520–560px). Do not calculate a 600+ slot and then choose 340px for the primary chart.
10. If the chart slot is below the space needed for its labels, axes, and intended reading distance (often around 220px on a 1600×900 canvas), redesign the chart/support relationship and run the layout width/height self-check again.

Column budget rule: columns share width, not height. If the page uses `grid-cols-2`, the chart column still receives the full post-title vertical content slot. A bad calc is `content slot = 732; left metrics = 732/2; right side = 366`; the correct calc is `right column content slot = 732`, then subtract only the right-column heading, insight card, gaps, padding, and reserve.

Avoid a two-row bottom card grid when it competes with a standard/tall chart. Additional facts can use in-chart annotations, an evidence rail, grouped labels, a compact table, or a compact aligned data mosaic with an explicit budget and a clearly dominant chart.

### Data semantics — one axis, one meaning

Each numeric dataset/value axis must use one unit and one meaning. Do not mix headcounts, percentages, money, scores, or "new role" sentinel values in the same bar/line dataset. If the source table contains both 2022/2026 counts and change rates, use grouped bars for the counts and put change rates in tooltips/annotations; or use a percent-change chart and move "0 → 850 / new role" to a callout instead of plotting `850` on a percent axis.

### Chart slides need interpretation

A chart is evidence, not the whole slide. A main chart should be paired with one visible takeaway sentence and, when the content needs it, 1-2 compact annotations, an insight rail, or a source/note line. Use this support area for the interpretation: baseline, "so what", caveat, implication, or the reason the chart matters. Do not repeat every category as equal-weight cards below/beside the chart.

### What not to use for height

Use only `h-[Npx]` for the chart frame. These do not work reliably:

- `h-full` — depends on parent having a fixed height, which may not exist
- `flex-1` — the chart frame is not inside a flex column with bounded height
- `min-h-*` — sets a minimum but Chart.js needs an exact height to render
- `h-64` or other Tailwind scale shortcuts — they use rem units which may not match the layout budget

Canvas sizing rule: the `<canvas>` should only use `class="h-full w-full"`. Do not add `width`, `height`, or inline `style` sizes to the canvas in generated HTML; Chart.js and the PPT runtime resize the canvas from the frame.

### Height role guide

The chart fills its computed slot — these ranges guide the role and proportion; they are NOT a reason to stop short and leave the zone empty:

- Hero/main chart: the chart is the slide's primary module (it lives in the dominant zone). Size the frame to the computed chart slot, typically 380–560px. Do not cap it at 240/340 and leave the rest empty.
- Standard chart: 280–360px, when the chart shares the slide with 1–2 support modules that sit beside/below it with an actual nonzero gap.
- Compact supporting chart: 220–280px, when the chart is one small module inside a dense layout and other modules stay concise.

Size the chart frame so the zone feels intentional. Do NOT cap the chart at a tiny height and leave a large accidental empty band below it — if the chart is the main module, it should be visually dominant. Exception: if the chart's cell/zone is much taller than the chart needs (e.g. a 5-bar chart in a ~600px grid cell), do not stretch the chart to an awkward height and do not fill the rest with multiple cards — keep it readable and add only the support the content actually needs, in the form that best serves the reading path. If the slot is smaller than the role minimum, reduce text/modules before shrinking the chart further.

### Bad examples

Do not generate these patterns:

```html
<!-- Comment ends at raw available slot, but frame uses a different number -->
<!-- height calc: current canvas height - 48(p-6) - 80(title) - 24(gap) = available content slot -->
<div class="ppt-chart-frame relative h-[360px] w-full overflow-hidden"></div>

<!-- Tailwind scale shortcut is not a pixel budget -->
<div class="ppt-chart-frame relative h-72 w-full overflow-hidden"></div>

<!-- Canvas must not own size -->
<canvas id="chart" width="600" height="300" style="height: 300px"></canvas>
```

## Chart selection guide

### First decide whether this is a chart

Use Chart.js only when the source contains a factual relationship that benefits from visual encoding. Never create numbers, proportions, or time allocations merely to make a chart.

| Source relationship | Use | Do not substitute |
| --- | --- | --- |
| Same-unit values across categories or a ranking | Bar; horizontal bar for long labels | A doughnut, which makes ranking harder to read |
| Ordered observations over time | Line; area only for cumulative magnitude | A bar chart when continuity/change is the message |
| Verified, mutually exclusive parts of one stated total | Doughnut or pie, 4-6 slices; values must add to the shown total or 100% | A topic list, agenda, or invented allocation |
| Scores on the same scale across dimensions | Radar, with 4-8 shared-scale axes | Mixed metrics or unrelated concepts |
| Two or three numeric variables | Scatter or bubble | Category cards pretending to show correlation |
| No numeric relationship: course map, agenda, process, stages, hierarchy, qualitative comparison | Page-native cards, route, matrix, process, or relationship diagram | Any Chart.js chart |

For example, "40 minutes and four course themes" is a four-part course map unless the source explicitly allocates the minutes. Do not label an invented split as a chart. A confirmed equal allocation may use four equal segments, but it should still read as a course map rather than evidence of a meaningful difference.

### bar — comparisons across categories

Best for: revenue by quarter, survey results, regional comparisons.

```js
{
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
}
```

Horizontal bar: set `options.indexAxis: 'y'`. Good for ranking lists or long category labels.

### line — trends over time

Best for: monthly trends, growth trajectories, multi-series comparison over time.

```js
{
  type: 'line',
  data: {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
    datasets: [
      {
        label: '2025',
        data: [30, 45, 42, 60, 55],
        borderColor: '#3B82F6',
        tension: 0.3,
        fill: false
      },
      {
        label: '2024',
        data: [20, 35, 38, 45, 40],
        borderColor: '#94A3B8',
        tension: 0.3,
        fill: false
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom' } },
    scales: { y: { beginAtZero: true } }
  }
}
```

Use `tension: 0.3` for smooth curves. Use `fill: true` with `backgroundColor` at low opacity for area charts.

### pie / doughnut — verified parts of a whole

Best for: market share, budget allocation, category breakdown. Limit to 4–6 slices for readability; use only when slices are mutually exclusive, share one unit, and add to a stated total or 100%.

```js
{
  type: 'doughnut',
  data: {
    labels: ['Product A', 'Product B', 'Product C', 'Other'],
    datasets: [{
      data: [40, 25, 20, 15],
      backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#94A3B8']
    }]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' }
    }
  }
}
```

Doughnut is usually better than pie — the center can hold a total or label. Do not use either for an agenda, four equal topics, a process, or an estimated allocation that the source does not state.

### radar — multi-axis profiles

Best for: skill comparisons, product feature matrices, performance across dimensions. Use 4–8 axes.

```js
{
  type: 'radar',
  data: {
    labels: ['Speed', 'Reliability', 'Cost', 'Support', 'Features'],
    datasets: [
      {
        label: 'Product A',
        data: [85, 70, 60, 90, 75],
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.15)'
      },
      {
        label: 'Product B',
        data: [65, 85, 80, 60, 90],
        borderColor: '#10B981',
        backgroundColor: 'rgba(16, 185, 129, 0.15)'
      }
    ]
  },
  options: {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      r: { beginAtZero: true, max: 100 }
    }
  }
}
```

### scatter / bubble — correlations

Best for: showing correlations, distributions, or data points with 2–3 dimensions.

```js
// Scatter: two variables
{
  type: 'scatter',
  data: {
    datasets: [{
      label: 'Team A',
      data: [{ x: 10, y: 20 }, { x: 15, y: 35 }, { x: 25, y: 30 }],
      backgroundColor: '#3B82F6'
    }]
  }
}

// Bubble: three variables (x, y, r=size)
{
  type: 'bubble',
  data: {
    datasets: [{
      label: 'Markets',
      data: [
        { x: 20, y: 30, r: 15 },
        { x: 40, y: 10, r: 8 },
        { x: 30, y: 22, r: 20 }
      ]
    }]
  }
}
```

## Updating an existing chart

Use `PPT.updateChart` to modify data or options without recreating the chart:

```js
// Patch data and options
PPT.updateChart('#my-chart', {
  data: { labels: ['New A', 'New B'], datasets: [{ data: [50, 60] }] },
  mode: 'active'
});

// Or use a callback for complex updates
PPT.updateChart('#my-chart', function(chart) {
  chart.data.datasets[0].data.push(42);
  chart.update();
});
```

`PPT.updateChart` accepts a canvas element, a CSS selector string, or an existing Chart instance.

## Category axis labels

Put category labels in `data.labels` as plain strings or string arrays:

```js
data: {
  labels: ['Q1', 'Q2', 'Q3'],
  datasets: [{ data: [12, 18, 26] }]
}
```

For multi-line labels, use Chart.js string-array labels:

```js
data: {
  labels: [['AI调校师', '约80→1,400'], ['中割/补间', '9,300→5,600']],
  datasets: [{ label: '2026人数', data: [1400, 5600] }]
}
```

Do not put HTML in labels. Chart.js does not render `<br>`, `<span>`, or inline style strings inside axis labels.

The runtime auto-injects `ticks.callback` for category axes. If you need a custom callback:

```js
ticks: {
  callback: function(value) {
    return this.getLabelForValue(value);
  }
}
```

## Layout integration tips

- Reserve space for legends, long labels, and axis ticks when budgeting chart height.
- Prefer fewer categories over tiny unreadable labels. If labels are long, use horizontal bar (`indexAxis: 'y'`).
- Place charts as dedicated visual modules in the grid, not nested inside cards with other content.
- Always set `responsive: true` and `maintainAspectRatio: false` — they work with the explicit-height frame.
- For a chart + metric cards layout, use `grid grid-cols-[1fr_1fr]` or `grid grid-cols-3` with the chart spanning 2 columns.
- Start with 0-2 compact support blocks around a standard/tall chart. Add a larger parallel set only when the chart remains dominant and the full layout budget stays clear.
- Axis-heavy horizontal bars (6+ categories, long y labels, negative+positive x ranges, or wide percentage ticks) need 40-60px of internal axis/tick budget. Use `layout.padding.bottom`, tick padding, and a modest `maxTicksLimit`; if the chart still needs more room, recompose the support content into a side rail, annotation band, compact table, or in-chart callouts.

## Common patterns

- **Hero metric + chart**: `grid grid-cols-[1fr_2fr]` — metric card on the left with `text-5xl` number, chart on the right. Size the right-column chart to its chart slot (post-heading vertical space) so the zone feels intentional; do not cap it so short that it leaves an accidental empty band, and do not stretch it beyond a readable hero height.
- **Two charts side by side**: `grid grid-cols-2` — each chart in its own column with a small heading above. Each chart fills its own column's chart slot; columns share width, not height.
- **Metrics row + chart below**: compact `grid-cols-4` metric cards (p-3) on top, single chart spanning full width below.
