# PPTX Animation Export Verification Checklist

Generated: 2026-06-06T05:42:21.755Z

## Summary

- **Total animation types**: 17
- **Exact roundtrip**: 9 / 17
- **Degraded fidelity**: 2 / 17

## Verification Instructions

For each type below, verify in Microsoft PowerPoint (desktop):

1. Open the exported .pptx file
2. Open Animation Pane (Alt → A → C)
3. Find the animation entry for the test shape
4. Verify: type matches expected behavior, duration/delay within ±50ms tolerance
5. Play the slideshow (F5) and compare visual effect to GSAP browser preview

## Animation Type Mapping

| Type | presetId | Class | Subtype | Motion | Scale | Fade | Exact RT | GSAP Behavior | Fidelity |
|------|----------|-------|---------|--------|-------|------|----------|---------------|----------|
| `fade` | 10 | entr | — | — | — | ✓ | ✓ | opacity: 0 → 1 | Exact match |
| `fade-up` | 2 | entr | 8 | ✓ | — | ✓ | ✓ | opacity: 0 → 1, y: 20 → 0 | Exact match |
| `fade-down` | 2 | entr | 1 | ✓ | — | ✓ | ✓ | opacity: 0 → 1, y: -20 → 0 | Exact match |
| `fade-left` | 2 | entr | 3 | ✓ | — | ✓ | ✓ | opacity: 0 → 1, x: 20 → 0 | Exact match |
| `fade-right` | 2 | entr | 2 | ✓ | — | ✓ | ✓ | opacity: 0 → 1, x: -20 → 0 | Exact match |
| `scale-in` | 31 | entr | — | — | ✓ | ✓ | ✓ | opacity: 0 → 1, scale: 0.85 → 1 | Exact match |
| `slide-up` | 2 | entr | 8 | ✓ | — | ✓ | ✗ | opacity: 0 → 1, y: 40 → 0 | Approximate: PPTX adds opacity fade to presetId=2 translate; pure translate not supported |
| `slide-left` | 2 | entr | 3 | ✓ | — | ✓ | ✗ | opacity: 0 → 1, x: 40 → 0 | Approximate: PPTX adds opacity fade to presetId=2 translate; pure translate not supported |
| `fly-in` | 2 | entr | — | ✓ | — | ✓ | ✗ | opacity: 0 → 1, directional translate | Good: direction resolved via fromTrace motion; roundtrip type detection is approximate |
| `wipe` | 5 | entr | — | — | — | — | ✓ | opacity: 0 → 1, animated clip-path | Approximate: PPTX native wipe filter; GSAP uses clip-path with different visual edge |
| `zoom-in` | 31 | entr | — | — | ✓ | ✓ | ✗ | opacity: 0 → 1, scale: 0.75 → 1 | Approximate: both zoom-in and scale-in map to presetId=31; cannot distinguish in roundtrip |
| `spin-in` | 31 | entr | — | — | ✓ | ✓ | ✗ | opacity: 0 → 1, scale: 0.92 → 1, rotate: -12 → 0 | Degraded: rotation (−12°) is lost; PPTX preset 31 has no rotation component |
| `grow-shrink` | 6 | emph | — | — | ✓ | — | ✗ | scale: 0.9 → 1.08 → 0.9 (yoyo) | Approximate: maps to presetId=6 emph; cannot distinguish from pulse in roundtrip |
| `pulse` | 6 | emph | — | — | ✓ | — | ✗ | scale: 1 → 1.06 → 1 (yoyo) | Approximate: maps to presetId=6 emph; cannot distinguish from grow-shrink in roundtrip |
| `exit-fade` | 10 | exit | — | — | — | ✓ | ✓ | opacity: 1 → 0 | Exact match |
| `exit-fly` | 2 | exit | — | ✓ | — | ✓ | ✓ | opacity: 1 → 0, directional translate out | Good: direction preserved via fromTrace motion; subtype not encoded |
| `path` | 10 | entr | — | — | — | ✓ | ✗ | opacity: 0 → 1 (degraded to fade) | Degraded: no PPTX equivalent; degenerates to simple fade entrance |

## Directions Verification

For directional types, verify the following combos produce correct motion:

| Type | from=left | from=right | from=top | from=bottom | from=center |
|------|-----------|------------|----------|-------------|-------------|
| `fly-in` | ✓ → ppt_x + width/2 | ✓ → ppt_x − width/2 | ✓ → ppt_y + height/2 | ✓ → ppt_y − height/2 | ✓ → fade only |
| `wipe` | wipe(r) | wipe(l) | wipe(d) | wipe(u) | wipe(r) fallback |
| `exit-fly` | ✓ (inverse) | ✓ (inverse) | ✓ (inverse) | ✓ (inverse) | ✓ → scale only |

## Known Limitations

1. **Easing**: PPTX uses system-default easing. GSAP custom eases (elastic, bounce, back) are not preserved.
2. **Rotation**: PPTX preset 31 has no rotation component. `spin-in` rotation (−12°) is lost.
3. **slide-* vs fade-***: PPTX always applies opacity fade to presetId=2. Pure translate entrance (slide-up/slide-left) is approximated.
4. **grow-shrink / pulse**: Both map to presetId=6. Distinction is lost in roundtrip.
5. **fly-in / exit-fly**: Direction encoded in numeric motion XML, not presetSubtype. Import parser cannot reconstruct original type without subtype.
6. **path**: No PPTX equivalent. Degrades to `fade` entrance with opacity-only animation.

## Verification Signature

- [ ] All entrance types visually verified
- [ ] All emphasis types visually verified
- [ ] All exit types visually verified
- [ ] Directional combos verified (fly-in × 5, wipe × 5, exit-fly × 5)
- [ ] Click-trigger animations advance correctly
- [ ] Duration/delay values preserved within ±50ms tolerance
- [ ] Exported PPTX opens correctly in Microsoft PowerPoint (desktop Windows)

---

Version: ppt-runtime v2.0.14 | GSAP 3.15.0
