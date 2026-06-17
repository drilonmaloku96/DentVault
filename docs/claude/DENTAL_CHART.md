# Dental Chart Reference

## Watch Status System

`dental_chart.watch_status TEXT` column: `'observe'` | `NULL`. `'suspicious'` migrated → `'observe'` in v63. Only "Under Observation" state exists. Per-surface watch stored in `SurfaceData.watch?: 'observe'` inside `surfaces` JSON blob; any truthy value treated as `'observe'` for backward-compat. Keyboard shortcut `O` (in `DentalChartView.svelte`) toggles whole-tooth watch status or, if surfaces are selected, toggles surface-level watch — passed as `watchShortcutTrigger: { seq: number }` prop to `ToothDetailPanel.svelte`.

**`watch` dental tag removed**: Superseded by the `watch_status` column. `DEFAULT_DENTAL_TAGS` no longer includes `{ key: 'watch' }`. `dentalTags.load()` filters out any stored `watch` entries. Migration v62 converts `condition = 'watch'` rows to `'healthy'`. `LEGEND_GROUPS` no longer includes `'watch'`.

## Eye Icon (Under Observation)

SVG `<symbol id="eye-observe" viewBox="-6 -4 12 8" overflow="visible">` defined once in `<defs>` in `ToothChart.svelte`, reused with `<use href="#eye-observe">`. Natural size ≈ 12×8 px. Symbol origin (0,0) is the visual center — centering math: `x = cx - width/2`, `y = cy - height/2`.

- Whole-tooth badge: `width="13" height="8"`. Upper teeth: placed **below** crown (`y = g.oy + g.oh + 2`). Lower teeth: placed **above** crown (`y = g.oy - 9`). X: `g.ox + g.ow / 2 - 6.5`.
- Per-surface badge: `width="9" height="6"`, `x = mc.cx - 4.5`, `y = mc.cy - 3`.
- Style: `fill="#dbeafe"`, `stroke="#2563eb"`, `stroke-width="1.2"`, pupil radius 2, white highlight dot.
- Watch crown overlay: dashed rect `fill="#dbeafe" fill-opacity="0.4" stroke="#2563eb" stroke-width="2" stroke-dasharray="4,2"`.

## Cervical Surface

`'Cv'` key in `surfaces` JSON, available for every tooth. Shown as a full-width button below the 3×3 cross grid in `surfaceGridWidget()`. All standard dental tags apply.

Rendered in `ToothChart.svelte` as an **always-visible** 6px band at the CEJ: upper teeth `y = g.oy - 6` (above crown), lower teeth `y = g.oy + g.oh` (below crown). Color: light gray (`#e2e8f0`, opacity 0.5) when untagged; full tag fill color (opacity 0.9) when tagged. `#94a3b8` stroke border always present.

The Cv div **must** have its own `onpointerdown`/`onpointerup` handlers (same as main grid) and `touch-action:none; cursor:crosshair` style — pointer events are otherwise lost. No shortcut Kürzel rendered in SVG (stripe too narrow).

## Root Canal UI Model

(`ToothDetailPanel.svelte`) Roots are SVG long triangles in `surfaceGridWidget()` below the Cervical strip (outside the drag-select container). Click to select (`activeRootCanals: Set<string>`); triangles use `allCanals` (anatomical defaults + user-added extras).

**Root selection**: plain click deselects all others and selects just that one; re-clicking deselects it. **Shift+click** is additive. Implemented via `toggleCanalSelection(canal, shift)`.

When root(s) selected, `rootCanalWidget()` appears with:
1. Canal label + deselect ✕
2. Status tag palette from `canalStatuses` store — `applyRootStatus()` does NOT clear selection
3. Per-root notes textarea + canal length (mm) field — only shown after a status is applied (`status !== 'none'`)
4. "+ Add canal" inline input → stores extra canals in `rootDataMap`

`CanalData` type: `{ status: string; notes?: string; length?: number | null }`. `status` is `string` (not union) to support user-added custom statuses.

`allCanals = $derived([...toothCanals, ...Object.keys(rootDataMap).filter(k => !toothCanals.includes(k))])`. Extra canals deletable with ✕.

`EndoDocDialog` is no longer used in `ToothDetailPanel`. **Canal notes and length are included in chart snapshot reports** — `parseRootSummary` in `chart-report.ts` emits `"CanalName: Status, N mm, note text"` per canal.

## Canal Anatomy per Tooth

`getCanalsForTooth` in `utils.ts`:
- Upper molars (1–3, 14–16) → `['MB', 'DB', 'P']`
- Lower molars (17–19, 30–32) → `['M', 'D']`
- Upper premolars (4, 5, 12, 13) → `['B', 'P']`
- All others → `['single']`

`canalNames` i18n: `{ MB, DB, P: 'Pal', M, D: 'Dis', B: 'Buc', ML, single: 'C' }`

## Root Canal Colors

**"Healthy" status**: `status = 'none'` labelled "Healthy". Healthy roots look identical to untagged: `bg: '#f1f5f9'`, `border: '#94a3b8'`, `text: '#64748b'`. No fill, no center line, no apex dot.

Colors driven by `canalStatuses` store — `canalFill(status)` and `canalStroke(status)` in `ToothChart.svelte` call `canalStatuses.getColors(status).bg/.border` and are reactive to store changes.

**Per-root rendering**: `{@const hasFinding = canalStatus !== 'none'}`. Only when `hasFinding` is true does colored polygon fill, center line, and apex circle appear. On a multi-root tooth a "Healthy" root stays visually neutral while an adjacent "Filled" root shows the colored line — independently. The old whole-tooth gate (`cond === 'root_canal' || hasRootData`) has been removed. Crowns and bridges with endo work also show root lines.

## Root Canal Statuses Store

`canalStatuses` store (`src/lib/stores/canalStatuses.svelte.ts`). 7 built-in statuses, user can add custom ones. Key: `'canal_statuses'`. `CanalStatusConfig`: `{ key, label, bg, border, text }`. `BUILTIN_CANAL_STATUS_KEYS` — built-ins cannot be deleted. Settings → Clinical → Root Canal Statuses. Method: `getColors(key)` returns `{ bg, border, text }`. Both `ToothDetailPanel` and `ToothChart` call `canalStatuses.load()` on mount.

## Surface Picker Orientation

(`ToothDetailPanel.svelte`) For **upper teeth**: Buccal at **top** of picker grid (far from arch center), Lingual at bottom. For **lower teeth**: Lingual at **top** (near arch center), Buccal at bottom. Formula: `top = isUpper ? 'B' : 'L'`, `bottom = isUpper ? 'L' : 'B'`. Matches SVG chart where upper `pTop` (small y) = Buccal, lower `pTop` (near center) = Lingual.

## Bridge Abutment Surface Tagging

Bridge member teeth (abutments) support full surface-level tagging (fractures, insufficient margins, etc.) like any other tooth. Clicking a bridge tooth opens `ToothDetailPanel` — NOT `RestorationEditorPanel`. The restoration editor is reachable via an **"Edit Bridge / Restoration"** button rendered inside `prosthesisAndDissolveWidget()` when `entry?.bridge_group_id && onEditBridge` is truthy. i18n key: `chart.editBridge`.

`ToothDetailPanel` accepts `onEditBridge?: () => void` prop; `DentalChartView` passes it only when selected entry has `bridge_group_id` and `!isSnapshotReadOnly`. Old auto-open path removed entirely.

**`isCrowned` derived**: `selectedCondition === 'crowned' || entry?.bridge_role === 'abutment'` — abutments use crown finding schema (`cx_*` tags).

**`isPontic` derived**: `entry?.bridge_role === 'pontic'` — pontic teeth can only be tagged "Fractured/Broken" (no surface picker, no margin/caries/whole-crown findings). `ponticSurfaceWidget` shows decorative dashed ellipse; `ponticTagPickerWidget` shows only the fractured tag button. Toggling: `selectedCondition = isBroken ? 'bridge' : 'fractured'` (NOT `applyTag()` which would toggle to `'healthy'`).

## Crown Findings Store

`crownFindings` store (`src/lib/stores/crownFindings.svelte.ts`). Crown and bridge-abutment surface tags use `cx_*` prefixed keys stored in `surfaceMap` JSON. 10 built-in findings: `cx_secondary_caries`, `cx_margin_open`, `cx_margin_overhang`, `cx_fracture`, `cx_wear`, `cx_margin_exposed`, `cx_hyperocclusion`, `cx_perforation`, `cx_loose`, `cx_aesthetic`. Each has `label`, `color` (fill), `strokeColor`, optional `wholeCrown: boolean`.

`BUILTIN_CROWN_FINDING_KEYS` — built-ins cannot be deleted. Settings key: `'crown_findings'`. Methods: `load()`, `save(list)`, `getByKey(key)`, `getLabel(key)`. `crownSurfFinding(surf)` in `ToothDetailPanel` looks up surface's `cx_*` tag. `wholeCrownFinding` derived from `surfaceMap['_whole']`. Crown surface picker (`crownSurfacePickerWidget`) shows root canal triangles in same flex-order layout. Both `ToothDetailPanel` and `DentalChartView` call `crownFindings.load()` on mount.

## Dental Tag i18n

- Labels: `i18n.t.chart.tags[key].label` at render time via `dentalTags.getLabel(key)`. New tag keys need entries in `en.ts` under `chart.tags`. `DentalTag.label` field deprecated.
- Shortcuts: `H`=Healthy, `C`=Caries, `F`=Filling, `K`=Crown, `R`=Root canal, `I`=Implant, `B`=Bridge, `M`=Missing, `E`=Extracted, `P`=imPacted, `X`=fraXture, `D`=Erupting, `V`=primary, `N`=iNlay, `J`=inlay planned, `Q`=radiographic, `Z`=MIH. `chart.tags[key].defaultShortcut` in `en.ts` must match; "Reset Shortcuts" in Settings syncs stored shortcuts to them.
- Tag groups: `i18n.t.chart.tagGroups`: `general`, `restorative`, `endodontic`, `fixedProsthetics`, `removable`, `absent`, `custom`, `bridgeTagNote`, `prosthesisTagNote`
