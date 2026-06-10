# Chart Reference

Deep-dive examples, layout integration patterns, and Chart.js options that work reliably in Oh My PPT.

## Complete working example

Copy this pattern for every chart. Adapt the type, data, and options.

```html
<!-- height calc: available slot = 900 - 64(p-8) - 80(title/subtitle) - 24(gap-6) - 32(reserve) = 700; chart height = compact example = 320 -->
<div class="ppt-chart-frame relative h-[320px] w-full overflow-hidden">
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

Before writing the chart frame, calculate the available slot, choose the actual chart frame height for the slide role, and write both in the comment. The final chart-height number MUST equal `h-[Npx]`.

```html
<!-- height calc: available slot = 900 - 64(p-8) - 60(title) - 20(gap-5) - 100(metrics) - 40(h3) - 16(p-4) - 40(reserve) = 560; chart height = min(560, 380 standard cap) = 380 -->
<div class="ppt-chart-frame relative h-[380px] w-full overflow-hidden">
  <canvas id="my-chart" class="h-full w-full"></canvas>
</div>
```

The final number in the comment and `h-[Npx]` MUST match. Do NOT leave a comment such as `= 584` and then use `h-[380px]`; write the cap decision explicitly.

Calculation steps:
1. Start from **900px** (full slide height; runtime page root has no default padding)
2. Subtract outer padding (p-6=48, p-8=64)
3. Subtract all modules above the chart: title, subtitle, metrics row, legends
4. Subtract all gaps between modules
5. If chart is inside a card: subtract card padding and card title/heading
6. Subtract sibling modules below or beside the chart: metric cards, support cards, footer/notes
7. Subtract a 24-40px safety reserve
8. Choose chart height by role: hero 340-420px, standard 280-360px, compact supporting 220-280px.
9. If available space is below 220px, redesign the chart/support relationship and run the layout width/height self-check again.

Never place a two-row bottom card grid under a standard/tall chart. Additional facts should use a density-appropriate structure such as an evidence rail, annotated chart, metric band, small multiples, or compact table.

### What not to use for height

Use only `h-[Npx]` for the chart frame. These do not work reliably:

- `h-full` — depends on parent having a fixed height, which may not exist
- `flex-1` — the chart frame is not inside a flex column with bounded height
- `min-h-*` — sets a minimum but Chart.js needs an exact height to render
- `h-64` or other Tailwind scale shortcuts — they use rem units which may not match the layout budget

Canvas sizing rule: the `<canvas>` should only use `class="h-full w-full"`. Do not add `width`, `height`, or inline `style` sizes to the canvas in generated HTML; Chart.js and the PPT runtime resize the canvas from the frame.

### Height role guide

Use these as caps, not automatic targets:

- Hero/full-width chart: 340-420px. Use for the main evidence of the slide.
- Standard chart: 280-360px. Use when the slide also has metrics, comparison cards, or an annotation rail.
- Compact supporting chart: 220-280px. Use when the chart is one module inside a dense layout.

If the available slot is larger than the role cap, keep the chosen cap and use the spare space for breathing room, annotation, or simply leave it empty. If the available slot is smaller than the role minimum, reduce text/modules before shrinking the chart further.

### Bad examples

Do not generate these patterns:

```html
<!-- Comment ends at raw available slot, but frame uses a different number -->
<!-- height calc: 900 - 48(p-6) - 80(title) - 24(gap) = 748 -->
<div class="ppt-chart-frame relative h-[360px] w-full overflow-hidden"></div>

<!-- Tailwind scale shortcut is not a pixel budget -->
<div class="ppt-chart-frame relative h-72 w-full overflow-hidden"></div>

<!-- Canvas must not own size -->
<canvas id="chart" width="600" height="300" style="height: 300px"></canvas>
```

## Chart type selection guide

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

### pie / doughnut — parts of a whole

Best for: market share, budget allocation, category breakdown. Limit to 4–6 slices for readability.

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

Doughnut is usually better than pie — the center can hold a total or label.

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

Put category labels in `data.labels`:

```js
data: {
  labels: ['Q1', 'Q2', 'Q3'],
  datasets: [{ data: [12, 18, 26] }]
}
```

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
- Keep support modules to 1-3 compact blocks around a standard/tall chart. Do not add a second row of summary cards below it.

## Common patterns

- **Hero metric + chart**: `grid grid-cols-[1fr_2fr]` — metric card on the left with `text-5xl` number, chart on the right. Chart height ~300px.
- **Two charts side by side**: `grid grid-cols-2` — each chart in its own column with a small heading above. Chart height ~260px.
- **Metrics row + chart below**: compact `grid-cols-4` metric cards (p-3) on top, single chart spanning full width below.
