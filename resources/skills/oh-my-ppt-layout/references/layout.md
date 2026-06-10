# Oh My PPT Layout — Supplementary Reference

Deep-dive examples, composition patterns, collision avoidance techniques, and height budget walkthroughs. The core rules are in SKILL.md — this file adds practical detail.

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

Chart height (360px) is chosen from the remaining budget, not equal to all leftover space. If you need a taller chart, reduce padding to `p-6` or use a shorter title area; if the available slot is large, cap the chart and leave controlled whitespace or a short annotation.

Do not add a second row of summary cards under this layout. When a data-focus slide already has a chart plus metric row, extra facts need a density-appropriate expression such as an evidence rail, annotated chart, metric band, compact chip row, or small table that is included in the budget.

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

## Composition patterns

These are structural archetypes. Adapt the grid structure and density to match the slide's content — do not copy content or styling literally.

### Big claim + evidence rail

Hero statement on one side, 2-4 evidence cards stacked on the other. Use `grid grid-cols-[1fr_1fr]` or `grid-cols-[2fr_1fr]` for emphasis asymmetry. Cards are simple `p-4 rounded-lg bg-*-50` blocks with a number + label.

### Before / after contrast

Two zones with same internal structure but different colors (e.g. `bg-red-50` vs `bg-green-50`). Use `grid grid-cols-2 gap-6`. Keep the same number of data points in each zone for fair comparison.

### Center concept + satellites

Central element in a `grid-cols-3 grid-rows-3` grid at `col-start-2 row-start-2`. Satellites at corners. Center gets bold background (`bg-blue-600 text-white`); satellites get light background (`bg-blue-50`).

### Cause → effect chain

3-4 sequential cards in `grid grid-cols-3`. Progress color from neutral → action → result (`bg-slate-100` → `bg-blue-50` → `bg-green-50`). Each card: short title + 1-2 sentence explanation.

### Quote slide

Centered text block with `max-w-3xl`, large quotation in `text-4xl font-bold`, attribution below in `text-xl`. Generous padding (`p-12`). No grid — just centered `flex items-center justify-center`.

## Density levels

### Low-density

One hero element (big number, key phrase, image) centered with generous whitespace. Use `p-12`, `text-5xl`, `max-w-2xl` or `max-w-3xl`. Keep supporting text to 1-2 lines. Sparse content should feel intentional — whitespace is framing, not emptiness.

### Medium-density

Title area + `grid grid-cols-3` with evidence cards. Each card: `p-5 rounded-xl bg-*-50` with a title + 1-2 line explanation. Clear visual hierarchy: title dominates, cards support.

### High-density

High-density can use a compact metric row (`grid grid-cols-4`, `p-3 rounded-lg`) + chart or table below, but this is one option, not a fixed template. Module count should be justified by real information volume. Use `ppt-chart-frame h-[220px]` to `h-[280px]` for supporting charts in this mode, and make the chart height comment's final number match that class. Avoid two-row card grids below charts; 4-6 facts need a density-appropriate structure such as a metric band, bento grid, small multiples, compact labels, or table-like rows.

## Title placement variations

Within a deck, vary title positions to maintain visual rhythm across consecutive slides:

1. **Top-left** (standard): `p-8` container with title as first element.
2. **Top-center**: `text-center` on the title, left-align body below.
3. **Left sidebar**: `grid grid-cols-[200px_1fr]` with title in the left column, rotated only if it's a short Chinese label (2–6 characters).
4. **Bottom**: title at the bottom of the slide, chart or visual above. Works for reveal slides.
5. **Visual center**: for cover, quote, and summary slides — title is the dominant element, centered vertically and horizontally.

Mixed-language titles (English + numbers + Chinese) should always be horizontal. Vertical text only works for short pure-Chinese labels.

## Creative layout techniques

These are building blocks — individual techniques to combine and adapt. Do not copy them as-is; adapt the principle to each slide's content and role.

### Technique: Unequal zones

**Why it works**: Equal `grid-cols-2` feels balanced but static. Unequal splits (`[2fr_1fr]`, `[1fr_3fr]`) feel editorial and intentional. The larger zone gets visual dominance; the smaller zone anchors with context.

**Key classes**: `grid grid-cols-[1fr_2fr]` or `grid-cols-[2fr_1fr]`

**When to use**: Hero content + supporting detail, claim + evidence, narrative + data.

### Technique: Overlap / layering

**Why it works**: An element overlapping a zone boundary creates perceived depth and draws attention. The overlap point becomes a visual anchor.

**Key mechanism**: Content cards use negative margin (`-mt-8`) to overlap into the adjacent zone. `absolute` + translate is only for decorative elements (accent lines, connector shapes), never for content cards or text.

**When to use**: Highlighting a key metric that bridges two zones, or cards floating up into a hero color block.

### Technique: Bento grid

**Why it works**: Some cards spanning 2 columns or 2 rows creates size hierarchy within a grid. The largest card gets implicit importance. Mix sizes to avoid a uniform dashboard feel.

**Key classes**: `grid grid-cols-4 grid-rows-3` with `col-span-2` or `row-span-2` on the hero card.

**When to use**: Dashboards, product overviews, capability maps — any slide with 5+ equal items that need differentiation.

### Technique: Split-tone background

**Why it works**: Different background colors on left vs right (or top vs bottom) halves create an instant visual split without borders. Each zone's content inherits its background mood.

**Key mechanism**: Each grid child gets its own `bg-*`. No gap (`gap-0`), or add `rounded-l-xl` / `rounded-r-xl` for soft boundaries.

**When to use**: Before/after, problem/solution, dark/light mood contrast.

### Technique: Floating cards over color field

**Why it works**: A full-slide dark or gradient background with semi-transparent cards on top feels modern and cohesive. The shared background unifies disparate content.

**Key classes**: Root gets `bg-gradient-to-br from-slate-900 to-slate-800`. Cards get `bg-white/10 backdrop-blur border border-white/10`.

**When to use**: Process steps, feature showcases, brand slides.

### Technique: Vertical cascade / staircase

**Why it works**: Items offset with increasing `ml-*` or `pl-*` create a diagonal reading flow. Each step feels progressive. Works with descending opacity or color gradation for extra rhythm.

**Key classes**: Each child gets incrementing `ml-0`, `ml-16`, `ml-32`, `ml-48`. Optionally pair with `bg-blue-600`, `bg-blue-500`, `bg-blue-400` for color cascade.

**When to use**: Steps, phases, methodology, any sequential content.

### Technique: Edge-to-edge hero band

**Why it works**: A full-width color block (40-60% of page height) creates dramatic visual weight. Cards below overlap into the band with negative margin, connecting the two zones.

**Key mechanism**: Top section is a `bg-*` div with generous `pb-16`. Below it, a card row uses `-mt-8` to float up into the color block. Cards get `shadow-lg` for separation.

**When to use**: Key results, hero metrics, section openers.

### Technique: Diagonal / skewed accent

**Why it works**: A tilted decorative band (`rotate-3` or `skew-x-[-6deg]`) adds energy and breaks the rectangular monotony. Content stays flat (un-rotated) on top.

**Key mechanism**: A decorative div with `absolute`, `bg-*`, and `transform skew-x-[-6deg]` sits behind the content layer. Content has `relative z-10`.

**When to use**: Cover slides, case studies, any slide that needs energy without affecting content layout.

### Technique: Asymmetric whitespace

**Why it works**: Placing content off-center (e.g. left 60% of slide) with large empty space on one side feels editorial and confident. The whitespace itself becomes a design element.

**Key classes**: `grid grid-cols-[3fr_1fr]` where the 1fr column is empty. Or `max-w-2xl` on centered content with a decorative element in the remaining space.

**When to use**: Quotes, key messages, low-density slides where the idea should breathe.
