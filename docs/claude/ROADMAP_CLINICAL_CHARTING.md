# Clinical Charting Roadmap — DS-Win Feature Parity

Reference: `Information_for_development/Anleitung-Der-Befund-im-DS-Win.pdf`

This roadmap closes the gap between DentVault's current dental chart and the feature set of Dampsoft DS-Win's "Befund" module. Organized into 8 stages, each self-contained and shippable.

---

## Stage 1 — Root Canal Granularity & Enlarged Tooth View

**Goal:** Replace the binary `root_canal` whole-tooth tag with per-root-canal status tracking, and add a visual enlarged tooth view showing roots.

### What DS-Win does
- Enlarged tooth view on the left of the charting dialog — always shows the currently selected tooth with crown surfaces AND root canals
- Click a root canal to cycle through states:
  - Blue = root filling present
  - Red = insufficient root filling
  - Black = post/pin
  - Yellow = medicinal dressing
- Click the root apex → red circle = periapical inflammatory focus (Herd)
- Post type specification (e.g. glass fiber post) via finding buttons

### Data model changes

**New JSON field on `dental_chart`:**

```sql
ALTER TABLE dental_chart ADD COLUMN root_data TEXT DEFAULT '{}';
```

`root_data` stores a JSON object keyed by canal identifier:

```json
{
  "MB": { "status": "filled", "post": null },
  "DB": { "status": "insufficient", "post": "glass_fiber" },
  "P":  { "status": "dressing", "post": null },
  "_apex": { "focus": true }
}
```

**Canal status enum:** `"none"` | `"filled"` | `"insufficient"` | `"dressing"`
**Post types:** `null` | `"metal"` | `"glass_fiber"` | `"carbon"` (user-configurable via settings store)
**Apex focus:** boolean on special key `"_apex"`

**Root canal count by tooth number** (static mapping, standard anatomy):
- Incisors/canines (1x–3x): 1 canal
- Premolars upper (1x4, 1x5): 2 canals (B, P)
- Premolars lower (3x4, 3x5, 4x4, 4x5): 1 canal
- Molars upper (1x6–1x8): 3 canals (MB, DB, P)
- Molars lower (3x6–3x8, 4x6–4x8): 2 canals (M, D)
- Deciduous teeth: simplified (1 canal for all)

This mapping should be a configurable constant (some teeth have anatomical variants — e.g. MB2 on upper molars).

### UI changes

**`ToothDetailPanel.svelte` — new `rootCanalWidget` snippet:**
- Appears below the surface grid
- Shows a schematic of the tooth's root(s) based on tooth number → canal count mapping
- Each canal is a clickable rectangle/trapezoid; click cycles through statuses with matching colors
- Apex dot below each root: click toggles periapical focus (red circle)
- If post is set, show a small icon or label inside the canal

**`ToothChart.svelte` — SVG rendering update:**
- The root area of each tooth SVG already renders differently for `root_canal` condition (purple fill + canal line)
- Extend: if `root_data` has any filled canals, render those canals individually with per-canal colors
- Apex focus: small red circle at root tip

### Settings

**New `postTypes` store** (`src/lib/stores/postTypes.svelte.ts`):
- Default: `[{ key: 'metal', label }, { key: 'glass_fiber', label }, { key: 'carbon', label }]`
- User-configurable in Settings → Chart section
- i18n keys for default labels

### i18n keys to add

```
chart.rootCanal.filled: "Root filling"
chart.rootCanal.insufficient: "Insufficient root filling"
chart.rootCanal.post: "Post/Pin"
chart.rootCanal.dressing: "Medicinal dressing"
chart.rootCanal.apexFocus: "Periapical focus"
chart.rootCanal.canalNames: { MB, DB, P, M, D, B, single }
settings.postTypes.title / description / add / deleteConfirm
```

### Export update
- `renderChart()` in `patient-export.ts`: include root canal status per tooth in the text summary

### Checklist — COMPLETED 2026-04-05
- [x] Migration v42: add `root_data` column
- [x] Canal count mapping constant in `utils.ts`
- [x] `rootCanalWidget` snippet in `ToothDetailPanel` (dropdown status picker, Alt/Option hover info, no legend)
- [x] SVG root rendering in `ToothChart.svelte`
- [x] `postTypes` settings store
- [x] Settings UI for post types
- [x] i18n: types.ts, de.ts, en.ts
- [x] Patient export update
- [x] `npm run check` passes 0 errors

---

## Stage 2 — Endo Documentation Module

**Goal:** Add a full per-tooth, per-canal endodontic treatment documentation system.

### What DS-Win does
- Accessible from the tooth notes dialog → "Endo-Doku" button
- Each tooth can have multiple dated treatment sessions
- Per canal per session: instrument type, ISO size, 3 working lengths (X-ray, preparation, electronic), reference point, calculated definitive length
- Canal names pre-populated by tooth number
- Linked to images (DS-View)

### Data model changes

**New tables:**

```sql
CREATE TABLE endo_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL,
  tooth_number INTEGER NOT NULL,
  treatment_date TEXT NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);
CREATE INDEX idx_endo_patient_tooth ON endo_records(patient_id, tooth_number);

CREATE TABLE endo_canals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  canal_name TEXT NOT NULL,
  instrument TEXT DEFAULT '',
  iso_size INTEGER,
  length_xray REAL,
  length_preparation REAL,
  length_electronic REAL,
  reference_point TEXT DEFAULT '',
  definitive_length REAL,
  FOREIGN KEY (record_id) REFERENCES endo_records(id) ON DELETE CASCADE
);
```

### UI changes

**New `EndoDocDialog.svelte` component:**
- Opens from a button in `ToothDetailPanel` (next to the root canal widget from Stage 1)
- Top section: treatment date picker, tooth number display
- History list: past endo sessions for this tooth (click to view, most recent editable, older read-only)
- Canal table: one row per canal (pre-populated from canal count mapping)
  - Columns: Canal name | Instrument | ISO | X-ray length | Prep length | Electronic length | Reference point | Calc. length
  - Definitive length auto-calculated: `length_xray - (some correction factor)` or user-entered
  - Reference point: text input with dropdown saved values
- Add canal button (for anatomical variants like MB2)
- Delete session button

**Instrument legend** (small info panel):
- Shows symbols/abbreviations used for instrument types (K-file, H-file, rotary, etc.)
- User-configurable via settings

### Settings

**Endo settings** in Settings → Clinical:
- Default canal names per tooth (override the standard mapping from Stage 1)
- Instrument type list (user-configurable)
- Default measurement system

### i18n keys to add

```
endo.title / newSession / history / noHistory
endo.canal / instrument / isoSize
endo.lengthXray / lengthPreparation / lengthElectronic
endo.referencePoint / definitiveLength
endo.addCanal / deleteSession / deleteConfirm
endo.instruments: { kFile, hFile, rotary, reciprocal, ... }
settings.endo.title / description / canalNames / instruments
```

### Export update
- New `renderEndo()` section in patient export — table of endo records per tooth with canal details

### Checklist — COMPLETED 2026-04-05
- [x] Migration v43–44: `endo_records` + `endo_canals` tables (`LATEST_VERSION = 44`)
- [x] DB functions: `getEndoRecords`, `saveEndoRecord`, `deleteEndoRecord`, `getAllEndoRecordsForPatient`
- [x] `EndoDocDialog.svelte` — two-panel: history sidebar + canal measurement table editor
- [x] Button ("Endo-Doku") in `ToothDetailPanel` root canal widget header
- [x] Settings UI for endo instrument types (`endoInstruments` store, key `'endo_instrument_types'`)
- [x] i18n: types.ts, de.ts, en.ts (`chart.endo.*`, `settings.endoInstruments.*`, `defaults.endoInstruments`)
- [x] Patient export: `renderEndo()` section — per-tooth, per-session canal measurement tables
- [x] `npm run check` passes 0 errors

---

## Stage 3 — Filling Material & Insufficiency

**Goal:** Replace the binary `filled` tag with material-aware, insufficiency-trackable filling data per surface.

### What DS-Win does
- Up to 6 filling material types per practice (composite, amalgam, gold, ceramic, glass ionomer, etc.)
- Per surface: material type + own-practice vs. foreign-practice + insufficiency flag
- Own = full surface fill; foreign = half-fill visual
- Insufficiency = hatching overlay
- Inlay option with "planned" variant
- Material colors customizable (except amalgam and inlay)
- Materials can be pre-assigned to tooth regions (e.g. composite for front teeth)

### Data model changes

**Extend `surfaces` JSON format:**

Currently `surfaces` is `{ "B": "filled", "O": "decayed" }` — a simple tag key per surface.

New format (backward-compatible): the value can be either a string (legacy) or an object:

```json
{
  "B": { "tag": "filled", "material": "composite", "origin": "own", "insufficient": false },
  "O": "decayed",
  "M": { "tag": "filled", "material": "amalgam", "origin": "foreign", "insufficient": true }
}
```

Parsing logic: if `typeof val === 'string'` → legacy format, treat as `{ tag: val }`. If object → read all fields. This keeps backward compatibility without a migration.

**`inlay` as a separate tag key** (add to `DEFAULT_DENTAL_TAGS`):
- `inlay` — similar to `filled` but visually distinct
- `inlay_planned` — dashed outline variant

### UI changes

**`ToothDetailPanel.svelte` — material sub-panel:**
- When a surface is tagged `filled` or `inlay`, show a small dropdown below the tag picker:
  - Material: dropdown from `fillingMaterials` store
  - Origin: toggle "Own" / "Foreign"
  - Insufficient: checkbox
- These are saved into the surfaces JSON object

**`ToothChart.svelte` — visual differentiation:**
- Foreign filling: surface polygon is only half-filled (diagonal split)
- Insufficient: SVG hatching pattern overlay on the surface
- Material color: if a material has a custom color set in the store, use it instead of the generic `filled` tag color

### Settings

**New `fillingMaterials` store** (`src/lib/stores/fillingMaterials.svelte.ts`):
- Default: `[{ key: 'composite', color: '#bfdbfe' }, { key: 'amalgam', color: '#9ca3af' }, { key: 'gold', color: '#fbbf24' }, { key: 'ceramic', color: '#f0f9ff' }, { key: 'glass_ionomer', color: '#86efac' }, { key: 'temporary', color: '#fde68a' }]`
- User-configurable: add/remove materials, change colors, rename
- Tooth region pre-assignment: optional per-material setting for front/back/all

### i18n keys to add

```
chart.filling.material / origin / own / foreign / insufficient
chart.filling.inlay / inlayPlanned
settings.fillingMaterials.title / description / add / deleteConfirm
settings.fillingMaterials.regionAssignment / front / back / all
defaults.fillingMaterials: [...]
```

### Export update
- `renderChart()`: include material + origin + insufficiency in the per-tooth summary

### Checklist — COMPLETED 2026-04-05
- [x] Backward-compatible surfaces JSON parsing in `ToothDetailPanel` and `ToothChart` (`string | SurfaceData`, helpers `getSurfTag` / `getSurfData` / `getSurfFill`)
- [x] Material sub-panel in `ToothDetailPanel` — material select + own/foreign toggle + insufficient checkbox; appears when any filled/inlay surface exists
- [x] SVG: foreign = 50% opacity; insufficient = `#surf-insufficient` hatching overlay polygon (`<pattern>` in `<defs>`)
- [x] `fillingMaterials` store (`src/lib/stores/fillingMaterials.svelte.ts`), 6 defaults, key `'filling_material_configs'`, `getColor(key)`
- [x] Settings UI for filling materials (color picker + label input per material, before endoInstruments section)
- [x] `inlay` + `inlay_planned` added to `DEFAULT_DENTAL_TAGS` (shortcuts N / J)
- [x] i18n: `chart.filling.*`, `chart.tags.inlay/inlay_planned`, `settings.fillingMaterials.*`, `defaults.fillingMaterials`
- [x] Patient export update — surface rendering uses `getSurfLabelFromExport` to include material/origin/insufficient
- [x] `npm run check` passes 0 errors

---

## Stage 4 — Multi-Entry Tooth Notes + Reminder Dates

**Goal:** Replace the single `notes` text field with a timestamped, multi-entry notes system per tooth, including reminder dates.

### What DS-Win does
- Each tooth can have multiple notes, each with auto-filled date + time (editable)
- Notes appear in a scrollable list
- Reminder date field: enter a future date → that tooth's dot blinks magenta in the chart when the date is reached
- A red dot appears on the tooth in the chart if notes exist
- Notes are printable
- Dropdown saved list for frequently used note texts

### Data model changes

**New table:**

```sql
CREATE TABLE tooth_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL,
  tooth_number INTEGER NOT NULL,
  text TEXT NOT NULL,
  reminder_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);
CREATE INDEX idx_tooth_notes_patient_tooth ON tooth_notes(patient_id, tooth_number);
```

The existing `dental_chart.notes` field remains for backward compatibility but the UI reads from / writes to the new `tooth_notes` table. On first load, if `dental_chart.notes` is non-empty and no `tooth_notes` exist for that tooth, auto-migrate the text as a single entry.

### UI changes

**`ToothDetailPanel.svelte` — replace notes input:**
- Replace the single text input with a scrollable list of note entries
- Each entry: text, timestamp, optional reminder date badge
- "Add note" button at the top — opens inline input with auto-filled datetime
- Edit: click on an existing note to edit inline
- Delete: small "×" button per entry
- Reminder: small calendar icon per note to set/clear reminder date

**`ToothChart.svelte` — visual indicator:**
- If a tooth has any `tooth_notes` entries, show a small colored dot (red) near the tooth in the SVG
- If any note has a `reminder_date <= today`, the dot pulses/blinks (CSS animation on the SVG element)

**Chart report / snapshot:**
- Include tooth notes count in the chart text summary

### i18n keys to add

```
chart.toothNotes (already exists, reuse)
chart.addNote / editNote / deleteNote / deleteNoteConfirm
chart.reminderDate / reminderDue / noNotes
```

### Export update
- `renderChart()`: list all tooth notes with timestamps under each tooth

### Checklist — COMPLETED 2026-04-06
- [x] Migration: `tooth_notes` table (v45)
- [x] DB functions: CRUD for tooth notes (`getToothNotes`, `saveToothNote`, `deleteToothNote`, `getAllToothNotesForPatient`, `getTeethWithNotes`, `getTeethWithDueReminders`)
- [x] Auto-migrate existing `dental_chart.notes` on first load
- [x] Multi-entry notes UI in `ToothDetailPanel` (scrollable list, inline form, edit/delete)
- [x] Amber/red dot indicator on `ToothChart.svelte` (amber = has notes, red = overdue reminder)
- [x] Reminder date with visual indicator for due reminders
- [x] i18n: types.ts, de.ts, en.ts
- [x] Patient export update (`renderChart` includes tooth notes table)
- [x] `npm run check` passes 0 errors

---

## Stage 5 — DMFT Score & Caries Sub-Types

**Goal:** Add automatic DMFT/dmft index calculation and radiographic caries sub-type.

### What DS-Win does
- Auto-calculates DMFT (adults) and dmft (children) from chart data
- D = decayed (caries to treat), M = missing/extracted, F = filled/crowned
- Caries sub-type: X-ray-only visible (radiographic, not yet clinically cavitated) — yellow marker overlay
- DMFT optionally calculated for adults too (checkbox in settings)

### Data model changes

No schema changes needed. DMFT is a **derived value** computed from existing `dental_chart` data.

**Radiographic caries:** Add a new tag key `decayed_radiographic` to `DEFAULT_DENTAL_TAGS`:
- Color: lighter red with yellow tint to indicate "not yet clinical"
- Whole-tooth: false (surface-applicable)

### UI changes

**DMFT display in `DentalChartView.svelte`:**
- Computed as a `$derived` value from `chartData`:
  - D = teeth where `condition === 'decayed'` or any surface has `decayed`/`decayed_radiographic`
  - M = teeth where `condition === 'missing'` or `condition === 'extracted'`
  - F = teeth where `condition === 'filled'` or `condition === 'crowned'` or any surface has `filled`
- Displayed as a small badge row in the chart header: `DMFT: 12 (D:3 M:4 F:5)`
- Separate dmft for deciduous teeth (teeth 51–85)

**New `decayed_radiographic` tag:**
- Appears in the unified tag picker alongside `decayed` and `watch`
- Labeled "Radiographic caries" / "Röntgenkaries"

### Settings

- Checkbox in Settings → Chart: "Calculate DMFT for adults" (default: true)

### i18n keys to add

```
chart.dmft / dmftLabel / dmftDecayed / dmftMissing / dmftFilled
chart.tags.decayed_radiographic: { label, defaultShortcut }
settings.chart.dmftForAdults
```

### Export update
- `renderChart()`: include DMFT score in the chart summary header

### Checklist — COMPLETED 2026-04-06
- [x] DMFT calculation logic (derived from chart data)
- [x] DMFT display in `DentalChartView` header
- [x] `decayed_radiographic` tag in defaults
- [x] i18n: types.ts, de.ts, en.ts
- [x] Settings toggle for adult DMFT
- [x] Patient export: DMFT in chart summary
- [x] `npm run check` passes 0 errors

---

## Stage 6 — MIH Recording

**Goal:** Add per-surface MIH (Molar-Incisor Hypomineralization) grading.

### What DS-Win does
- Per surface, per tooth: MIH grade 1–4
- Shown in purple on the surfaces
- Hover tooltip shows magnified view with grade
- Auto-removed when a filling is recorded on that surface (configurable)
- Separate checkbox "MIH unter ZE beibehalten" to preserve under prosthetics

### Data model changes

**New JSON field on `dental_chart`:**

```sql
ALTER TABLE dental_chart ADD COLUMN mih_data TEXT DEFAULT '{}';
```

Format: `{ "B": 2, "O": 3 }` — surface key → MIH grade (1–4).

### UI changes

**`ToothDetailPanel.svelte` — MIH sub-panel:**
- Toggle to enter "MIH mode" in the tooth detail panel
- When active: clicking a surface opens a grade picker (1/2/3/4 / none)
- MIH-affected surfaces show a purple overlay indicator next to the surface tag

**`ToothChart.svelte` — visual overlay:**
- Surfaces with MIH: thin purple border or small purple diamond icon on the surface polygon
- Tooltip on hover: "MIH Grade 2" etc.

**Auto-removal logic:**
- When a filling is applied to a surface via `applyTag('filled')`, check setting and optionally clear MIH from that surface

### Settings

- Checkbox: "Remove MIH when filling recorded" (default: true)
- Checkbox: "Preserve MIH under prosthetic restorations" (default: false)

### i18n keys to add

```
chart.mih.title / grade / noMih / mode
chart.mih.grade1 / grade2 / grade3 / grade4
settings.chart.mihAutoRemove / mihPreserveUnderZE
```

### Export update
- `renderChart()`: include MIH data per tooth/surface

### Implementation note (simplified)
Implemented as a hard-coded dental tag (`mih`) — no new schema column or settings section needed.
Grade stored in extended surface JSON: `{ tag: 'mih', grade: 2 }`. Grade picker panel in `ToothDetailPanel`
(like filling material panel). Grade numbers rendered on SVG surface polygons in `ToothChart`.

### Checklist
- [x] `mih` tag added to `DEFAULT_DENTAL_TAGS` (shortcut H, purple)
- [x] Extended surface JSON: `grade` field added to `SurfaceData` interface
- [x] Grade picker sub-panel in `ToothDetailPanel` (grades 1–4)
- [x] Grade text labels on SVG surface polygons in `ToothChart` (all 4 rendering paths)
- [x] i18n: types.ts, de.ts, en.ts (`chart.mih` section)
- [x] Patient export: `getSurfLabelFromExport` includes grade label
- [x] `npm run check` passes 0 errors

---

## Stage 7 — Tooth Position & Foreign Work Flag

**Goal:** Record positional anomalies per tooth and flag foreign/external work.

### What DS-Win does
- Per tooth: migration direction, tipping direction, rotation direction
- Small "F" marker on teeth treated by another practice at first exam

### Data model changes

**New columns on `dental_chart`:**

```sql
ALTER TABLE dental_chart ADD COLUMN migration TEXT DEFAULT '';
ALTER TABLE dental_chart ADD COLUMN tipping TEXT DEFAULT '';
ALTER TABLE dental_chart ADD COLUMN rotation TEXT DEFAULT '';
ALTER TABLE dental_chart ADD COLUMN foreign_work INTEGER DEFAULT 0;
```

Migration/tipping values: `""` (none), `"mesial"`, `"distal"`, `"buccal"`, `"lingual"`, `"superior"`, `"inferior"`
Rotation values: `""` (none), `"clockwise"`, `"counterclockwise"`

### UI changes

**`ToothDetailPanel.svelte` — position sub-panel:**
- Collapsible section "Position" below the tag picker
- Three dropdowns: Migration, Tipping, Rotation — each with direction options
- "Foreign work" checkbox

**`ToothChart.svelte` — visual indicators:**
- Migration: small arrow icon on the tooth pointing in the migration direction
- Tipping: tooth SVG slightly tilted (or small tilt indicator)
- Rotation: small curved arrow icon
- Foreign work: small "F" label rendered on the tooth

### i18n keys to add

```
chart.position.title / migration / tipping / rotation / foreignWork
chart.position.directions: { mesial, distal, buccal, lingual, superior, inferior, clockwise, counterclockwise, none }
```

### Export update
- `renderChart()`: include position data and foreign-work flag in per-tooth summary

### Checklist
- [x] Migration: add 4 columns to `dental_chart` (v46–49)
- [x] Position dropdowns in `ToothDetailPanel` (migration, tipping, rotation selects)
- [x] Foreign work checkbox in `ToothDetailPanel`
- [x] SVG indicators in `ToothChart` (F badge + direction abbreviation in all 4 paths)
- [x] i18n: types.ts, de.ts, en.ts (`chart.position` section)
- [x] Patient export update (position findings table in `renderChart`)
- [x] `npm run check` passes 0 errors

---

## Stage 8 — Tooth Color Recording & Quick-Entry Presets

**Goal:** Add per-surface shade documentation by manufacturer, plus quick chart presets.

### What DS-Win does

**Tooth colors:**
- Per surface, per tooth: shade code from a manufacturer catalog (VITA, etc.)
- Multiple manufacturer configs (user-definable)
- Mirror function: copy shade entries from one quadrant to another
- Filter by tooth region (front/back/wisdom)

**Quick presets:**
- One-click buttons: "All 8s missing", "All upper missing", "All lower missing", "All upper replaced", "All lower replaced", "Deciduous full arch", "Mixed dentition"

### Data model changes

**New tables:**

```sql
CREATE TABLE shade_manufacturers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  display_color TEXT DEFAULT '#f5f5f4',
  codes TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE tooth_shades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL,
  tooth_number INTEGER NOT NULL,
  surface TEXT NOT NULL,
  manufacturer_id INTEGER NOT NULL,
  shade_code TEXT NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
  FOREIGN KEY (manufacturer_id) REFERENCES shade_manufacturers(id) ON DELETE CASCADE,
  UNIQUE(patient_id, tooth_number, surface)
);
```

`shade_manufacturers.codes` is a JSON array of strings: `["A1","A2","A3","A3.5","A4","B1","B2","B3","B4","C1","C2","C3","C4","D2","D3","D4"]` for VITA Classical, for example.

### UI changes

**New `ToothColorDialog.svelte`:**
- Opens from a button in `ToothDetailPanel` or `DentalChartView` toolbar
- Manufacturer dropdown at top
- Region filter: Front / Back / All
- Click a surface on the selected tooth → shade code picker (grid of codes from manufacturer)
- Right-click surface → auto-apply last used code
- Mirror button: copy from quadrant 1→2, 3→4 etc.
- Remove entry / remove all entries per tooth

**Quick-entry presets in `DentalChartView.svelte`:**
- Small dropdown or button group in the chart toolbar (visible in charting mode):
  - "All 8s missing" → sets teeth 18, 28, 38, 48 to `missing`
  - "Upper jaw missing" → sets 11–18, 21–28 to `missing`
  - "Lower jaw missing" → sets 31–38, 41–48 to `missing`
  - "Deciduous full" → sets arch setup to all primary teeth present
  - "Mixed dentition" → configurable by age range

### Settings

**Shade manufacturers** in Settings → Chart:
- List of manufacturers with name, codes, display color
- Default: VITA Classical pre-populated
- Add/edit/delete manufacturers

### i18n keys to add

```
chart.shades.title / manufacturer / code / mirror / removeEntry / removeAll
chart.shades.regionFront / regionBack / regionAll
chart.presets.title / all8sMissing / upperMissing / lowerMissing / upperReplaced / lowerReplaced / deciduousFull / mixedDentition
settings.shadeManufacturers.title / description / add / deleteConfirm / codes
```

### Export update
- New `renderShades()` section or integrate into `renderChart()`: shade table per tooth

### Checklist
- [ ] Migration: `shade_manufacturers` + `tooth_shades` tables
- [ ] DB functions: CRUD for manufacturers and per-tooth shades
- [ ] `ToothColorDialog.svelte` with shade picker
- [ ] Mirror function
- [ ] Quick-entry preset buttons in `DentalChartView`
- [ ] Settings UI for shade manufacturers
- [ ] Default VITA Classical manufacturer
- [ ] i18n: types.ts, de.ts, en.ts
- [ ] Patient export update
- [ ] `npm run check` passes 0 errors

---

## Stage Dependencies

```
Stage 1 (Root Canals)
  └── Stage 2 (Endo Module)  ← needs root canal model from Stage 1

Stage 3 (Filling Materials) ← independent, can run in parallel with 1–2
Stage 4 (Tooth Notes)       ← independent
Stage 5 (DMFT + Caries)     ← independent, but benefits from Stage 3 (filling detection)
Stage 6 (MIH)               ← independent, but benefits from Stage 3 (auto-removal on filling)
Stage 7 (Tooth Position)    ← independent
Stage 8 (Shades + Presets)  ← independent
```

**Recommended order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

Stages 3, 4, 7 are the most self-contained and could be tackled in any order if needed.

---

## Post-Stage Improvements (Not from DS-Win, but natural extensions)

These aren't from the PDF but would be logical additions once the stages above are complete:

- **Bone loss overlay** — render alveolar bone level from perio probing data onto the tooth chart SVG
- **Image-to-tooth linking** — visual icon on tooth in SVG when X-rays/photos are linked via timeline entries
- **Treatment plan auto-transfer** — marking a tooth as "insufficient" in the chart proposes a plan item
- **Warranty tracking** — filling/prosthetic warranty period with auto-expiry indicator
- **Tartar / oral disease flags** — chart-level checkboxes that flag until corresponding treatment is documented
