# Oh My PPT Layout — Supplementary Reference

Deep-dive examples: collision-avoidance code comparisons and height-budget walkthroughs. The core rules are in SKILL.md; the named layout patterns and composition techniques are in `catalog.md`.

## Collision avoidance — code comparison

### Radial / surround layout — grid, not absolute

```html
<!-- Risky: cards positioned with absolute/translate -->
<div class="relative">
  <div class="absolute top-0 left-[20%]">Card A</div>
  <div class="absolute top-0 right-[20%]">Card B</div>
  <div class="absolute bottom-0 left-[20%]">Card C</div>
  <div class="absolute bottom-0 right-[20%]">Card D</div>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">Center</div>
</div>

<!-- Reliable: explicit grid with cells -->
<div class="grid grid-cols-3 grid-rows-3 gap-4 h-full">
  <div class="col-start-1 row-start-1">Card A</div>
  <div class="col-start-3 row-start-1">Card B</div>
  <div class="col-start-1 row-start-3">Card C</div>
  <div class="col-start-3 row-start-3">Card D</div>
  <div class="col-start-2 row-start-2">Center</div>
</div>
```

Grid cells participate in document flow, expand to fit their content, and never overlap. Absolute elements can collide, overflow, or clip when content varies.

### Comparison layout — equal-width columns

```html
<!-- Risky: left side may push right side out -->
<div class="flex">
  <div class="w-[55%]">Option A content</div>
  <div class="w-[45%]">Option B content</div>
</div>

<!-- Reliable: grid with equal tracks -->
<div class="grid grid-cols-2 gap-6">
  <div>Option A content</div>
  <div>Option B content</div>
</div>
```

### Card with text — avoid deep nesting

```html
<!-- Risky: 5 levels deep, easy to miss a closing tag -->
<div class="flex">
  <div class="flex-1">
    <div class="p-4">
      <div class="bg-white rounded-lg">
        <div>
          <h3>Title</h3>
          <p>Content</p>
        </div>
      </div>
    </div>
  </div>
</div>

<!-- Reliable: 3 levels, same visual result -->
<div class="grid grid-cols-2 gap-4">
  <div class="p-4 bg-white rounded-lg">
    <h3>Title</h3>
    <p>Content</p>
  </div>
  <div class="p-4 bg-white rounded-lg">
    <h3>Title</h3>
    <p>Content</p>
  </div>
</div>
```

## Height budget walkthrough

### Data-focus slide: title + metrics + chart

```
900px total height
- p-8 (32px top + 32px bottom) = 64px -> 836px remaining
- Title area (h1 + gap) = 60px -> 776px
- Metric cards row (grid-cols-4) = 100px -> 676px
- Gap = 24px -> 652px
- Chart frame: h-[360px] = 360px -> 292px
- Annotation line = 24px -> 268px (spare)
- Safety reserve = 40px -> 228px spare after reserve
```

Chart height is chosen from the computed chart slot, not from a copied default. If the content slot is large, either size the chart enough to feel dominant or give the remaining space to the support the content actually needs, while keeping actual gaps between independent modules. Do not cap the chart at a tiny default height and leave an accidental empty band; also do not fill the band with unnecessary cards.

Do not add a second row of summary cards under this layout. When a data-focus slide already has a chart plus metric row, extra facts need a density-appropriate expression such as in-chart annotations, one concise evidence rail, a compact chip row, or a small table that is included in the budget.

### Comparison slide: title + two zones

```
900px total height
- p-6 (24px top + 24px bottom) = 48px -> 852px remaining
- Title + subtitle = 70px -> 782px
- Gap = 16px -> 766px
- Safety reserve = 32px -> 734px
- Two comparison zones (grid-cols-2) -> each gets 734px height
```

### Timeline slide: title + horizontal strip

```
900px total height
- p-6 = 48px -> 852px
- Title = 60px -> 792px
- Gap = 16px -> 776px
- Timeline strip (horizontal) = 120px -> 656px
- Detail cards below = 200px -> 456px (spare)
- Safety reserve = 32px -> 424px spare after reserve
```
