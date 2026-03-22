# Dental Chart Architecture

The dental chart opens as a centered `Dialog` (1100px wide) from the timeline toolbar.

## Layout

- **Two-column** in `DentalChartView.svelte`: chart left (~55%) + detail panel right (~45%), always both visible
- No `viewMode` toggle — clicking a tooth sets `selectedTooth`, side panel updates instantly
- **Right panel**: shows `ToothDetailPanel` when a tooth is selected; placeholder + Clinical Exams when nothing selected
- **Read-only snapshot**: single-column chart only (no side panel, no bridge drag)
- Dialog width: `max-w-[1100px] sm:max-w-[1100px]` in `TimelineView.svelte`

## ToothDetailPanel

- No `fullView` prop — single consistent compact layout
- Surface grid: 160px wide, 48px tall cells, abbreviated names (O/B/L/M/D)
- Close (×) button deselects tooth, returns to placeholder
- Drag-select surfaces: `setPointerCapture` + `document.elementFromPoint` on 3×3 grid. Cells must NOT have `pointer-events:none`
- `surfaceMap` (`$state` object): mutate directly (`surfaceMap[s] = tag`) — never spread
- `doSave()` uses `_pendingSave` flag to queue concurrent saves
- Auto-save text fields debounced 600ms; tag/condition changes save immediately
- **"Brücke auflösen"** button shown when `entry.bridge_group_id` is set — dissolves the whole group
- **Condition History** collapsible section: loads via `getToothHistory(patientId, tooth)` — requires `patientId` prop
- **Surface tag picker** excludes whole-tooth-only conditions: `impacted`, `implant`, `bridge`, `prosthesis`, `missing`, `extracted`
- **Overall condition selector** shows all tags without filtering

## ToothChart SVG

- `viewBox="0 0 736 304"` (VH=304), `class="w-full"`, `min-width:560px`, `touch-action:none`
- **FDI notation** displayed — internal storage uses Universal 1–32, display via `toFDI()` / `fromFDI()` from `$lib/utils`
- **Roots**: upper teeth roots grow upward from crown top (`g.oy`), lower roots grow downward from crown bottom (`LOWER_TOP + CROWN_H[t]`), `ROOT_H=36`
- Root canal: light purple fill (root only) + purple obturated canal line + apex dot. **Crown surfaces fall back to `healthy` fill** — `crownFallback = cond === 'root_canal' ? 'healthy' : cond`
- No roots for: `extracted`, `missing`, `implant`, and pontic bridge members (`bridge_role === 'pontic'`)
- **Missing/Extracted** (`isAbsent`): tooth body hidden. Dashed gray outline rect only. Extracted = × (crossing lines with `stroke-linecap="round"`); missing = horizontal `–` dash. Roots suppressed.
- **Impacted/Retained**: displaced `−14px` (upper) / `+14px` (lower) via `<g transform="translate(0,N)">`. FDI label stays at original position.
- Quadrant labels: Q1 (upper right = FDI 18–11), Q2 (upper left = FDI 21–28), Q3 (lower left = FDI 38–31), Q4 (lower right = FDI 41–48)
- **Selected tooth**: blue border (`#2563eb`), blue drop shadow, blue FDI label
- No `onSurfaceClick` prop — all interactions via SVG-level `onpointerdown/move/up` with pointer capture
- `onBridgeRangeSelected?: (teeth: number[]) => void` fires when user drags across ≥2 teeth; single click fires `onToothClick`
- Bridge drag preview: blue dashed overlay rect during drag
- **Legend**: grouped (General, Restorative, Endodontic, Fixed Prosthetics, Removable, Missing/Absent). Shortcuts shown `(p)` — reactive via `dentalTags` store.

## Keyboard Navigation & Shortcuts

- **Enter** (tooth selected, no input focused) → next tooth in `FDI_CHARTING_ORDER`; **Shift+Enter** → previous
- **Escape** → deselect tooth (or exit charting mode)
- **Letter key** (e.g. `k`) → applies matching tag to active surfaces, or whole tooth if none selected
- Default shortcuts: g=Gesund, u=Beobachtung, k=Karies, f=Füllung, o=Krone, w=Wurzelbehandlung, i=Implantat, b=Brücke, x=Fehlend, e=Extrahiert, p=Verlagert/Impaktiert, r=Fraktur
- All shortcuts user-configurable in Edit Tags dialog; duplicate detection blocks save
- `FDI_CHARTING_ORDER`, `getNextTooth()`, `getPrevTooth()` exported from `$lib/utils`

## Charting Mode

- **"Charting starten"** button starts guided mode at FDI 18 (Universal 1)
- Progress bar shows `chartingIndex/32`; **Enter** advances, **Shift+Enter** goes back, **Escape** exits, **"Fertig"** exits
- Clicking any tooth during charting mode jumps to it and syncs index
- Current tooth highlighted with blue dashed ring on SVG crown
- `chartingMode`, `chartingIndex` state in `DentalChartView`; `chartingTooth` prop passed to `ToothChart`

---

## Bridge Workflow

- **DB**: `dental_chart` has `bridge_group_id TEXT` and `bridge_role TEXT` columns (migration v14)
- **Types**: `ToothChartEntry.bridge_group_id: string | null`, `bridge_role: 'abutment' | 'pontic' | null`
- **DB functions**: `upsertToothChartEntry` handles bridge fields; `getBridgeGroup(patientId, groupId)` fetches all members
- **Create**: drag across teeth → `onBridgeRangeSelected` → `BridgeDialog.svelte` (chip toggles Abutment ↔ Pontic, middle teeth default to Pontic) → `handleBridgeConfirm` saves with shared `crypto.randomUUID()` group ID
- **Render**: `bridgeGroups` derived in `ToothChart` draws horizontal bar; upper bar below crowns, lower bar above crowns
- **Pontics**: dashed outline; `showRoot = !NO_ROOT.has(cond) && !isPontic`
- **Dissolve**: `onDissolveBridge(groupId)` resets all members to `condition='healthy'`, clears bridge fields
- **`bridgeRoles` store** (`src/lib/stores/bridgeRoles.svelte.ts`): 3 configs (abutment, pontic, connector) — badge, color, fillColor, fillPattern. Key: `'bridge_role_configs'`. `getFill(role)` / `getConfig(role)` used by SVG.

## Prosthesis Workflow (Removable Prosthetics)

- `BridgeDialog.svelte` toggle switches between "Bridge" and "Prosthesis" mode
- **DB**: same `bridge_group_id` / `bridge_role` columns, plus `prosthesis_type TEXT` on `dental_chart`
- **Types**: `ToothChartEntry.prosthesis_type: 'telescope' | 'replaced' | null`
- **Roles**: `telescope` (anchor crown), `replaced` (artificial tooth in denture)
- **`prosthesisTypes` store** (`src/lib/stores/prosthesisTypes.svelte.ts`): 2 configs — badge, color, fillColor, fillPattern. Key: `'prosthesis_type_configs'`. `getFill(key)` returns hex or `url(#ptpat-KEY)`.
- **Visual**: semi-transparent pink polygon overlay (`fill="#fda4af" fill-opacity="0.20"`, `stroke="#f43f5e"`, dashed) per consecutive run via `slotRuns(memberSlots)` — does NOT span healthy teeth
- Components: `BridgeDialog.svelte`, `ToothChart.svelte`, `DentalChartView.svelte`, `RestorationEditorPanel.svelte`

---

## Audit Log

Immutable append-only trail at `<vault_root>/audit.jsonl`.

- `src/lib/services/audit.ts` — `logAudit(action, entity_type, entity_id, patientId, before, after)` via Rust `append_audit_line` / `read_audit_log`
- `src/lib/components/audit/AuditLogDialog.svelte` — browse/filter dialog, accessible from patient page toolbar
- Records every update/deletion: timeline entries, treatment plans, dental chart, documents, patients
- Format: `{ id, timestamp, action, entity_type, entity_id, patient_id, before, after }`

---

## Periodontal Probing Chart

4-component architecture in `src/lib/components/perio/`, opened as Dialog (1200px wide) from timeline toolbar "Perio" button.

| Component | Purpose |
|---|---|
| `ProbingChartDialog.svelte` | Main orchestrator — two-column layout (62/38 split), toolbar, charting mode, record management |
| `PerioSVGChart.svelte` | SVG bar-graph: vertical bars per site, color-coded green/amber/red by PD depth, BOP red dots, recession purple bars, plaque yellow dots, ghost comparison bars |
| `PerioDataEntryPanel.svelte` | Single-tooth editor — PD + recession inputs, BOP/plaque toggles, CAL computed row, mobility (0–III), furcation, notes |
| `PerioSummaryBar.svelte` | Bottom stats: mean PD, BOP%, PD≥4/≥6 counts, sites recorded, teeth charted — all `$derived` |
| `PerioComparisonView.svelte` | Comparison strip — delta per site vs. past record (↑ worse/↓ better) |

**Key behaviours:**
- **Guided charting mode**: begins at FDI 18, Enter advances, Shift+Enter goes back, Escape exits
- **Auto-create record**: `ensureRecord()` creates DB record on first data input, not on dialog open
- **Auto-save**: every PD, recession, BOP, plaque, mobility, furcation change saves immediately
- **Comparison**: select past record → ghost bars overlay on SVG + delta table
- **CAL**: computed read-only `PD + recession` per site, updates live
- **Furcation**: only shown for multi-rooted teeth (molars + upper premolars)
- **Scale**: `SCALE_PX_PER_MM = 8` — 10mm pocket = 80px bar; max rendered = 12mm
