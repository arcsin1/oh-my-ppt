---
name: oh-my-ppt-chart
description: Must be read before adding or modifying Oh My PPT slide charts. Defines product-safe Chart.js usage, canvas layout constraints, axis label rules, and retry fixes.
---

# Oh My PPT Chart

For deeper examples (chart frame height guide, category axis patterns, layout integration tips), read `references/chart.md`.

## When to use

- Adding a chart to a new or existing slide
- Modifying chart type, data, or options
- Repairing a blank or broken chart canvas

## When not to use

- Pure visual micro-edits that don't change chart structure (e.g. adjusting a single color value). These still follow chart skill hard rules, but don't require reading the full reference.

## 30-second decision checklist

Before writing chart HTML, answer these in order:

1. **Chart type**: bar, line, pie, doughnut, radar, polarArea, scatter, bubble?
2. **Available slot**: how much vertical space remains after title, modules, gaps, card padding, and notes?
3. **Final height**: hero / standard / compact? Pick one final px height that fits the available slot.
4. **Data shape**: labels + datasets. Are there enough data points for the chosen type?
5. **Script event**: DOMContentLoaded only — the runtime loads Chart.js before this event fires.

## How to create a chart

Every chart needs exactly two parts: an HTML frame with explicit height, and a script block using DOMContentLoaded + PPT.createChart.

### 1. HTML — chart frame with explicit height

Before writing the chart frame, you MUST calculate the available slot and then choose the actual chart frame height. Write the calculation as a comment, and make the **final chart height** equal the `h-[Npx]` value. Do NOT write a comment that ends with one number and a frame height that uses another number.

```html
<!-- height calc: available slot = 900 - 48(p-6) - 68(title) - 24(gap-6) - 28(h3) - 8(gap-2) - 32(reserve) = 692; chart height = min(692, 400 hero cap) = 400 -->
<div class="ppt-chart-frame relative h-[400px] w-full overflow-hidden">
  <canvas id="my-chart" class="h-full w-full"></canvas>
</div>
```

The final number in the comment and `h-[Npx]` MUST match. If the comment ends with `chart height = 400`, the div MUST say `h-[400px]`.

Use this exact comment structure for generated charts:

```html
<!-- height calc: available slot = [900 - ... - reserve] = [slot]; chart height = [role decision] = [final] -->
<!-- Example after replacing placeholders: chart height = standard = 360 -->
<div class="ppt-chart-frame relative h-[360px] w-full overflow-hidden">
```

Calculation steps:
1. Start from 900px (full slide height; runtime page root has no default padding)
2. Subtract outer padding (p-6=48, p-8=64)
3. Subtract all modules above the chart: title, subtitle, metrics row, legends
4. Subtract all gaps between modules
5. If chart is inside a card: subtract card padding and card title
6. Subtract sibling modules below or beside the chart: metric cards, summary chips, footer/notes
7. Subtract a 24-40px safety reserve (use 40px on dense data slides)
8. Choose the chart frame height from the available slot:
   - Hero/full-width chart: 340-420px
   - Standard chart beside/under 2-3 support modules: 280-360px
   - Compact supporting chart: 220-280px
9. If the available slot is below 220px, redesign the chart/support relationship and run the layout width/height self-check again.

Do not pair a standard/tall chart with a two-row bottom card grid. If the slide has 4-6 additional facts, choose a density-appropriate structure such as an evidence rail, annotated chart, metric band, small multiples, or compact table.

Only the `.ppt-chart-frame` owns chart size. The `<canvas>` uses `class="h-full w-full"` and must not have `width`, `height`, or inline `style` size attributes in generated HTML.

Bad patterns to avoid:

```html
<!-- height calc: 900 - 48(...) = 676 -->
<div class="ppt-chart-frame relative h-[400px]">...</div>

<div class="ppt-chart-frame relative h-64">...</div>

<canvas id="chart" width="320" height="380" style="height: 240px"></canvas>
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
    <p class="text-base text-gray-500">Growth trend across regions</p>
  </div>
  <!-- height calc: available slot = 900 - 48(p-6) - 68(title/subtitle) - 24(gap-6) - 40(chart heading) - 32(reserve) = 688; chart height = standard side chart = 280 -->
  <div class="ppt-chart-frame relative h-[280px] w-full overflow-hidden">
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
- Put category labels in `data.labels`. If a category-axis `ticks.callback` is needed, return `this.getLabelForValue(value)`.
- Derive chart frame height from the layout budget (900px minus all other modules and a 24-40px safety reserve), then choose a height that fits the chart role. Do not blindly use all leftover height.
- Every generated `.ppt-chart-frame` needs the height calc comment immediately before it.
- Do not add padding to the `.ppt-chart-frame` div — it wastes height budget without visual benefit. Padding belongs on the parent card/container, not on the chart frame itself.
- Do not put `width`, `height`, or inline `style` size attributes on `<canvas>`; the chart frame controls the size.
- Keep chart code local and deterministic.

## Failure repair strategy

When a chart is blank or broken:

1. **Check the event**: the script must use `DOMContentLoaded`. Any other event name (ppt-ready, ppt-rendered, ppt-page-ready, load, etc.) will not fire or fire too early.
2. **Check the canvas id**: the `getElementById` string must match the canvas `id` attribute exactly.
3. **Check the height**: the chart frame `h-[Npx]` must be a positive number. A missing or zero height produces an invisible canvas.
4. **Check the data format**: labels must be an array of strings, datasets an array of objects with a `data` array of numbers.
5. **Remove duplicate scripts**: if editing a page that already has a chart, merge scripts rather than adding a second `DOMContentLoaded` listener for the same canvas.

## Chart animation boundary

Two levels of chart animation, each handled by a different system:

- **Chart container entrance** (the whole chart block fading/sliding in): add `data-anim` on the `.ppt-chart-frame` div. This is a standard layout animation — see animation skill.
- **Chart internal drawing** (bars growing, lines drawing, pie slices rotating): controlled by Chart.js `options.animation`. The runtime defaults handle this; you rarely need to customize it.
- **Do not** write custom JS timelines that animate individual chart elements. Use `data-anim` for the container, and Chart.js options for the internals.

## Cross-skill references

- Budget chart height from the slide's 900px total (see layout skill). Title + modules + gaps + chart frame + 24-40px reserve <= 900px.
- Chart container entrance animation uses `data-anim` on the chart frame div (see animation skill).
