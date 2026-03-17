# Periodontal Chart UX Overhaul Plan

> **Goal**: Transform the perio charting experience from a cramped data-entry table into an intuitive, visually rich, keyboard-driven interface that matches the polish and ease-of-use of the dental chart.

---

## Problems with Current Implementation

1. **192 tiny `<input type="number">` fields** in a flat HTML table — overwhelming, hard to find your place
2. **No visual feedback** — just background color on individual cells; no chart/graph showing pocket depth patterns at a glance
3. **No keyboard navigation** — user must Tab through 192 inputs or click each one; no guided charting flow
4. **No tooth context** — just FDI numbers in a header row; no visual connection to actual tooth positions
5. **BOP dots are 12px circles** below each input — easy to miss, hard to click
6. **No comparison view** — can load a past record but can't see current vs. previous side-by-side
7. **No summary statistics** — no mean PD, no BOP percentage, no site count breakdown
8. **Single monolithic component** (277 lines) — no separation of rendering, data entry, and visualization
9. **No recession/CAL tracking** — only pocket depths and BOP are captured
10. **No furcation or mobility recording** — common perio exam data points are missing

---

## Architecture Overview (After Overhaul)

```
ProbingChartDialog.svelte              ← Dialog shell, record management, toolbar
├── PerioSVGChart.svelte               ← SVG visualization (pocket depth bars + BOP dots per tooth)
├── PerioDataEntryPanel.svelte         ← Right-side panel: focused data entry for selected tooth
├── PerioSummaryBar.svelte             ← Bottom bar: live statistics (mean PD, BOP%, site counts)
└── PerioComparisonView.svelte         ← Optional overlay: side-by-side with previous record
```

All files go in `src/lib/components/perio/`.

---

## Step-by-Step Implementation

### Step 0: DB Schema Extension (migration v30)

Add recession and furcation columns to `probing_measurements`, and mobility to a new per-tooth level.

**In `src/lib/services/db.ts`**, append to `SCHEMA_STATEMENTS` array and bump `LATEST_VERSION` to 30:

```sql
-- v30: Perio chart enhancements — recession, furcation, mobility, plaque
ALTER TABLE probing_measurements ADD COLUMN recession INTEGER DEFAULT NULL;
ALTER TABLE probing_measurements ADD COLUMN plaque INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS probing_tooth_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id INTEGER NOT NULL,
  tooth_number INTEGER NOT NULL,
  mobility INTEGER DEFAULT NULL,        -- 0, 1, 2, 3
  furcation INTEGER DEFAULT NULL,       -- 0, I, II, III (stored as 0-3)
  furcation_sites TEXT DEFAULT '',       -- comma-separated sites, e.g. 'B,L' or 'B,ML,DL'
  notes TEXT DEFAULT '',
  FOREIGN KEY (record_id) REFERENCES probing_records(id) ON DELETE CASCADE,
  UNIQUE(record_id, tooth_number)
);
```

**Update `src/lib/types.ts`** — extend `ProbingMeasurement` and add new type:

```typescript
export interface ProbingMeasurement {
  id: number;
  record_id: number;
  tooth_number: number;
  site: string;
  pocket_depth: number | null;
  bleeding_on_probing: number;
  recession: number | null;       // NEW
  plaque: number;                 // NEW (0 or 1)
}

export interface ProbingToothData {
  id: number;
  record_id: number;
  tooth_number: number;
  mobility: number | null;
  furcation: number | null;
  furcation_sites: string;
  notes: string;
}
```

**Add DB functions** in `src/lib/services/db.ts`:

```typescript
export async function upsertProbingToothData(
  recordId: number, toothNumber: number,
  data: { mobility?: number | null; furcation?: number | null; furcation_sites?: string; notes?: string }
): Promise<void>

export async function getProbingToothData(recordId: number): Promise<ProbingToothData[]>
```

Also update `upsertProbingMeasurement` to accept `recession` and `plaque` fields in the data parameter, and include them in the INSERT/UPDATE SQL.

**Checklist:**
- [ ] Add migration v30 SQL to `SCHEMA_STATEMENTS` array (4 statements: 2 ALTER, 1 CREATE TABLE, and a CREATE INDEX on `probing_tooth_data(record_id, tooth_number)`)
- [ ] Bump `LATEST_VERSION` to 30
- [ ] Extend `ProbingMeasurement` interface in `types.ts`
- [ ] Add `ProbingToothData` interface in `types.ts`
- [ ] Add `upsertProbingToothData()` and `getProbingToothData()` in `db.ts`
- [ ] Update `upsertProbingMeasurement()` to handle `recession` and `plaque`
- [ ] Run `npm run check` — 0 errors

---

### Step 1: SVG Probing Visualization — `PerioSVGChart.svelte`

This is the visual centerpiece. It replaces the HTML table with an SVG chart that shows pocket depths as **vertical bar graphs** per tooth site, with BOP markers.

**File**: `src/lib/components/perio/PerioSVGChart.svelte`

#### 1.1 Layout Geometry

```
viewBox="0 0 800 460"

Upper Arch (teeth 1–16, displayed as FDI 18→11, 21→28):
  y=0..200:   Buccal row (bars grow downward from gum line)
              FDI labels at y≈10
              Gum line at y≈30
              Bars from y=30 downward, height = PD × scale
              BOP dots at bar tip
  y=110..200: Lingual row (bars grow upward from lower gum line)
              Gum line at y≈200
              Bars from y=200 upward

  Separator line at y=220

Lower Arch (teeth 32–17, displayed as FDI 48→41, 31→38):
  y=230..430: Mirror of upper arch layout
              Buccal bars grow downward
              Lingual bars grow upward
```

Each tooth occupies a **48px-wide slot** (48 × 16 = 768, with 16px padding each side = 800).

Within each 48px slot, 3 bar columns for the 3 sites (MB, B, DB on buccal; ML, L, DL on lingual):
- Each bar is 10px wide, spaced 4px apart
- Centered in the 48px slot: total bar group width = 10+4+10+4+10 = 38px, centered with 5px margins

#### 1.2 Bar Rendering

Each bar represents one site's pocket depth:

```
Bar height = PD_value × SCALE_PX_PER_MM
SCALE_PX_PER_MM = 8  (so a 10mm pocket = 80px tall)
```

Color fill uses the same clinical thresholds:
- 1–3mm: `#34d399` (emerald-400)
- 4–5mm: `#fbbf24` (amber-400)
- 6+mm: `#f87171` (red-400)
- No value: light gray dashed outline (2px tall placeholder)

**BOP indicator**: If `bleeding_on_probing === 1`, draw a solid red circle (r=3) at the tip of the bar.

**Recession visualization** (if recession data exists): Draw a second bar segment below the PD bar in a distinct purple/blue color representing recession depth. The clinical attachment level (CAL = PD + recession) is visually apparent from the combined bar height.

#### 1.3 Tooth Labels & Grid

- FDI number centered below each tooth slot (upper) or above (lower)
- Light vertical grid lines separating each tooth slot
- Horizontal reference lines at 3mm and 6mm depth (dashed, subtle)
- Midline separator between teeth 8–9 (upper) and 25–24 (lower) — slightly thicker line
- Quadrant labels: "Q1", "Q2", "Q3", "Q4" at edges

#### 1.4 Selected Tooth Highlight

When a tooth is selected (for data entry in the side panel):
- Blue background highlight on the tooth's column (full height, low opacity)
- Blue border on the FDI label
- Subtle blue glow/shadow

#### 1.5 Charting Mode Highlight

When in guided charting mode, the current tooth gets:
- Amber dashed border around the column (matching dental chart's charting highlight)
- Pulsing/breathing animation on the column background

#### 1.6 Click Interaction

- **Click on a tooth column** → emit `onToothSelect(toothNumber)` → opens that tooth in the data entry panel
- **Click on a specific bar** → emit `onToothSelect(toothNumber)` AND pre-focus the corresponding site input in the panel
- Pointer cursor on hover; tooltip showing "FDI XX — click to edit"

#### 1.7 Plaque Indicators

If `plaque === 1` for a site, render a small yellow dot at the base of the bar.

#### 1.8 Props

```typescript
{
  pocketDepths: Record<string, number | null>;    // key: `${toothNum}_${site}`
  bopSites: Record<string, boolean>;
  recessions: Record<string, number | null>;
  plaqueSites: Record<string, boolean>;
  selectedTooth: number | null;
  chartingTooth: number | null;
  comparisonDepths?: Record<string, number | null>;  // ghost bars for comparison
  onToothSelect: (tooth: number) => void;
}
```

**Checklist:**
- [ ] Create `src/lib/components/perio/PerioSVGChart.svelte`
- [ ] Implement tooth slot geometry (48px slots × 16, upper + lower arches)
- [ ] Render vertical bars for each site (3 buccal + 3 lingual per tooth)
- [ ] Color-code bars by PD threshold (green/amber/red)
- [ ] Render BOP red dots at bar tips
- [ ] Render recession bars (purple/blue) below PD bars when data exists
- [ ] Render plaque yellow dots at bar bases when data exists
- [ ] Draw FDI labels, grid lines, 3mm/6mm reference lines, quadrant labels
- [ ] Implement selected tooth highlight (blue column)
- [ ] Implement charting mode highlight (amber dashed column)
- [ ] Handle click → `onToothSelect(tooth)`
- [ ] Render comparison ghost bars when `comparisonDepths` provided (semi-transparent overlay bars behind the current bars)
- [ ] Add hover tooltip with FDI number and summary (e.g., "FDI 16 — max PD: 5mm, BOP: 2/6")
- [ ] Run `npm run check` — 0 errors

---

### Step 2: Data Entry Panel — `PerioDataEntryPanel.svelte`

This replaces the 192-input table with a **focused single-tooth editor** in the right side panel — exactly like `ToothDetailPanel` in the dental chart.

**File**: `src/lib/components/perio/PerioDataEntryPanel.svelte`

#### 2.1 Layout

The panel shows data for ONE selected tooth at a time:

```
┌──────────────────────────────────┐
│  FDI 16  (Universal 3)      [×] │
│──────────────────────────────────│
│                                  │
│  ┌─ Buccal ──────────────────┐   │
│  │   MB      B       DB      │   │
│  │  [___]  [___]   [___]  PD │   │
│  │  [___]  [___]   [___]  Rec│   │
│  │  (●)    (●)     (●)   BOP│   │
│  │  (○)    (○)     (○)   Plq│   │
│  └───────────────────────────┘   │
│                                  │
│  ┌─ Lingual ─────────────────┐   │
│  │   ML      L       DL      │   │
│  │  [___]  [___]   [___]  PD │   │
│  │  [___]  [___]   [___]  Rec│   │
│  │  (●)    (●)     (●)   BOP│   │
│  │  (○)    (○)     (○)   Plq│   │
│  └───────────────────────────┘   │
│                                  │
│  Mobility: [0] [I] [II] [III]   │
│  Furcation: [0] [I] [II] [III]  │
│    Sites: [B] [ML] [DL]         │
│                                  │
│  CAL Summary:                    │
│  MB:5  B:3  DB:4  ML:6  L:3 DL:4│
│                                  │
│  Notes: [________________]       │
│──────────────────────────────────│
│  ← Prev (Shift+Enter)           │
│  → Next (Enter)                  │
└──────────────────────────────────┘
```

#### 2.2 Input Behavior

- **PD inputs**: `<input type="number">` with min=0, max=15. Larger than current (w-14 h-8 text-sm instead of w-10 h-6 text-[10px]). Color-coded background by threshold.
- **Recession inputs**: Same style, below PD inputs. Optional — leave blank if not measuring recession.
- **BOP toggles**: Circular toggle buttons (w-5 h-5). Red fill when active, gray outline when inactive. Click to toggle.
- **Plaque toggles**: Same as BOP but yellow fill when active.
- **CAL display**: Read-only computed row showing `PD + recession` for each site. Auto-updates as user types.
- **Mobility**: 4 radio-style buttons (0, I, II, III). Highlight selected.
- **Furcation**: 4 radio-style buttons (0, I, II, III). Only shown for multi-rooted teeth (molars and upper premolars). When furcation > 0, show site checkboxes (B, ML, DL for upper molars; B, L for lower molars).
- **Notes**: Single-line text input, debounced 600ms auto-save.

#### 2.3 Keyboard Navigation Within Panel

- **Tab**: Moves through the 6 PD inputs in order: MB → B → DB → ML → L → DL
- **Shift+Tab**: Reverse order
- **Enter** (when focus is on last PD input DL, or when no input focused): Advance to next tooth
- **Shift+Enter**: Go to previous tooth
- **Escape**: Deselect tooth (return to placeholder)
- **Arrow Up/Down** on a PD input: Increment/decrement the value by 1 (clamped 0–15)
- **`b` key** (when not in an input): Toggle BOP on focused site
- **`p` key** (when not in an input): Toggle plaque on focused site

#### 2.4 Auto-Save

Every input change triggers an immediate `upsertProbingMeasurement()` call (same as current behavior, but now through the panel). Use the same `_pendingSave` flag pattern from `ToothDetailPanel` to prevent concurrent save conflicts. Show a brief green checkmark pulse after save.

#### 2.5 Placeholder State

When no tooth is selected, show:
```
┌──────────────────────────────────┐
│                                  │
│     Click a tooth on the chart   │
│     or press "Start Charting"    │
│     to begin recording.          │
│                                  │
│     [Start Charting]             │
│                                  │
└──────────────────────────────────┘
```

#### 2.6 Props

```typescript
{
  toothNumber: number | null;
  pocketDepths: Record<string, number | null>;
  bopSites: Record<string, boolean>;
  recessions: Record<string, number | null>;
  plaqueSites: Record<string, boolean>;
  toothData: ProbingToothData | null;      // mobility, furcation, notes
  onPdChange: (tooth: number, site: string, value: number | null) => void;
  onRecessionChange: (tooth: number, site: string, value: number | null) => void;
  onBopToggle: (tooth: number, site: string) => void;
  onPlaqueToggle: (tooth: number, site: string) => void;
  onToothDataChange: (tooth: number, data: Partial<ProbingToothData>) => void;
  onAdvance: () => void;      // next tooth
  onBack: () => void;         // previous tooth
  onClose: () => void;        // deselect
  onStartCharting: () => void;
}
```

**Checklist:**
- [ ] Create `src/lib/components/perio/PerioDataEntryPanel.svelte`
- [ ] Implement single-tooth layout with Buccal and Lingual sections
- [ ] PD number inputs (6 total) with color-coded backgrounds, larger than current
- [ ] Recession number inputs (6 total) below PD inputs
- [ ] BOP toggle circles (6 total) with red active state
- [ ] Plaque toggle circles (6 total) with yellow active state
- [ ] CAL computed display row (PD + recession per site)
- [ ] Mobility radio buttons (0, I, II, III)
- [ ] Furcation radio buttons (only shown for multi-rooted teeth) with site checkboxes
- [ ] Notes text input with 600ms debounced auto-save
- [ ] Tab order: MB→B→DB→ML→L→DL PD inputs
- [ ] Enter/Shift+Enter keyboard navigation to next/prev tooth
- [ ] Escape to deselect
- [ ] Arrow Up/Down to increment/decrement PD value
- [ ] `b`/`p` key shortcuts for BOP/plaque toggle (when not in input)
- [ ] Placeholder state when no tooth selected (with "Start Charting" button)
- [ ] Auto-save with `_pendingSave` pattern and green checkmark pulse
- [ ] Run `npm run check` — 0 errors

---

### Step 3: Summary Statistics Bar — `PerioSummaryBar.svelte`

A compact horizontal bar at the bottom of the dialog showing live-computed statistics.

**File**: `src/lib/components/perio/PerioSummaryBar.svelte`

#### 3.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Sites: 84/192 │ Mean PD: 3.2mm │ PD≥4: 23 (27%) │ PD≥6: 5 (6%) │ BOP: 31% │ Teeth: 28 │
└─────────────────────────────────────────────────────────────────────────┘
```

#### 3.2 Computed Statistics

All derived from the current `pocketDepths` and `bopSites` maps:

| Stat | Computation |
|------|-------------|
| **Sites recorded** | Count of non-null PD values / total possible (192 if all teeth, or `teeth × 6`) |
| **Mean PD** | Average of all non-null PD values, 1 decimal |
| **PD ≥ 4mm** | Count and percentage of sites with PD ≥ 4 |
| **PD ≥ 6mm** | Count and percentage of sites with PD ≥ 6 |
| **BOP %** | Percentage of recorded sites with BOP positive |
| **Teeth charted** | Count of teeth with at least one PD recorded |

Color-code the BOP% and PD≥6 values: green if low, amber if moderate, red if high.

#### 3.3 Props

```typescript
{
  pocketDepths: Record<string, number | null>;
  bopSites: Record<string, boolean>;
}
```

**Checklist:**
- [ ] Create `src/lib/components/perio/PerioSummaryBar.svelte`
- [ ] Compute all 6 statistics reactively using `$derived`
- [ ] Display in compact horizontal layout with dividers
- [ ] Color-code warning values (BOP > 30%: amber, > 50%: red; PD≥6 > 10%: amber, > 20%: red)
- [ ] Run `npm run check` — 0 errors

---

### Step 4: Comparison View — `PerioComparisonView.svelte`

When the user selects a past record to compare, show differences visually.

**File**: `src/lib/components/perio/PerioComparisonView.svelte`

#### 4.1 Comparison Modes

**Mode A — Ghost Bars on SVG (default)**: The `PerioSVGChart` already accepts `comparisonDepths`. When a comparison record is selected, render semi-transparent bars behind the current bars in a neutral gray. This lets the user see at a glance where depths have increased or decreased.

**Mode B — Delta Table**: A small overlay/section that shows only the sites where PD changed, with:
- Arrow indicators: ↑ (deeper, bad) in red, ↓ (shallower, good) in green, = (unchanged) in gray
- Grouped by tooth, only showing teeth with changes
- Summary: "12 sites improved, 3 worsened, 69 unchanged"

#### 4.2 Activation

In the toolbar, the "Load past record" dropdown gets a "Compare" toggle button next to it. When toggled:
1. Past record's measurements are loaded into `comparisonDepths`
2. Ghost bars appear on the SVG chart
3. A small delta summary appears above the summary bar

#### 4.3 Props

```typescript
{
  currentDepths: Record<string, number | null>;
  comparisonDepths: Record<string, number | null>;
  currentBop: Record<string, boolean>;
  comparisonBop: Record<string, boolean>;
}
```

**Checklist:**
- [ ] Create `src/lib/components/perio/PerioComparisonView.svelte`
- [ ] Implement delta computation (improved/worsened/unchanged per site)
- [ ] Render delta summary strip ("12 sites improved, 3 worsened")
- [ ] Show per-tooth change table (only teeth with differences)
- [ ] Arrow + color indicators (↑red, ↓green, =gray)
- [ ] Ensure SVG ghost bar rendering works via `comparisonDepths` prop on `PerioSVGChart`
- [ ] Run `npm run check` — 0 errors

---

### Step 5: Main Dialog Orchestrator — Rewrite `ProbingChartDialog.svelte`

Rename the existing `ProbingChartView.svelte` to `ProbingChartDialog.svelte` (to match naming convention of being a dialog) and completely rewrite it as an orchestrator.

**File**: `src/lib/components/perio/ProbingChartDialog.svelte` (replaces `ProbingChartView.svelte`)

#### 5.1 Two-Column Layout

Mirror the dental chart's layout exactly:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│  Periodontal Probing Chart                              [Date] [Examiner] [Save] │
│  [Load past ▾] [Compare ◻]  [Start Charting]  [Charting: 5/32 ████░░░░░░░░]     │
│─────────────────────────────────────────────────────────────────────────────────── │
│                                          │                                       │
│   ┌─── SVG Probing Chart ────────────┐   │   ┌── Data Entry Panel ───────────┐   │
│   │                                  │   │   │                               │   │
│   │  Upper Arch                      │   │   │  FDI 16                       │   │
│   │  ▐▐▐ ▐▐▐ ▐▐▐ ...  (buccal)     │   │   │                               │   │
│   │  ▐▐▐ ▐▐▐ ▐▐▐ ...  (lingual)    │   │   │  Buccal: MB  B   DB           │   │
│   │                                  │   │   │  PD:    [4] [3]  [5]          │   │
│   │  ─────── separator ───────────   │   │   │  Rec:   [2] [1]  [3]          │   │
│   │                                  │   │   │  BOP:   (●) (○)  (●)          │   │
│   │  Lower Arch                      │   │   │                               │   │
│   │  ▐▐▐ ▐▐▐ ▐▐▐ ...  (buccal)     │   │   │  Lingual: ML  L   DL          │   │
│   │  ▐▐▐ ▐▐▐ ▐▐▐ ...  (lingual)    │   │   │  PD:     [3] [2]  [4]         │   │
│   │                                  │   │   │  ...                           │   │
│   │  Legend: ■ 1-3  ■ 4-5  ■ 6+  ● B│   │   │                               │   │
│   └──────────────────────────────────┘   │   │  Mobility: [0] [I] [II] [III] │   │
│                                          │   │  Furcation: [0] [I] [II][III] │   │
│                                          │   │  Notes: [_______________]      │   │
│                                          │   └───────────────────────────────┘   │
│──────────────────────────────────────────────────────────────────────────────────│
│ Sites: 84/192 │ Mean PD: 3.2mm │ PD≥4: 23 (27%) │ PD≥6: 5 (6%) │ BOP: 31%     │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**Flex layout**: Left panel `flex: 60 1 0; min-width:0` / Right panel `flex: 40 1 0; min-width: 300px`.

Dialog width: `max-w-[1200px] sm:max-w-[1200px]` with `max-h-[90vh] overflow-y-auto`.

#### 5.2 State Management

```typescript
// Record management
let examDate = $state(new Date().toISOString().slice(0, 10));
let examinerId = $state<number | null>(null);
let notes = $state('');
let currentRecord = $state<ProbingRecord | null>(null);
let pastRecords = $state<ProbingRecord[]>([]);

// Measurement data (flat maps, same keys as before: `${toothNum}_${site}`)
let pocketDepths = $state<Record<string, number | null>>({});
let bopSites = $state<Record<string, boolean>>({});
let recessions = $state<Record<string, number | null>>({});
let plaqueSites = $state<Record<string, boolean>>({});
let toothDataMap = $state<Record<number, ProbingToothData>>({});  // keyed by tooth number

// Navigation
let selectedTooth = $state<number | null>(null);

// Charting mode
let chartingMode = $state(false);
let chartingIndex = $state(0);

// Comparison
let comparisonRecord = $state<ProbingRecord | null>(null);
let comparisonDepths = $state<Record<string, number | null> | null>(null);
let comparisonBop = $state<Record<string, boolean> | null>(null);
let showComparison = $state(false);
```

#### 5.3 Charting Mode (Guided Entry)

Exactly mirrors the dental chart's charting mode:

1. **"Charting starten" button** in toolbar starts guided mode at FDI 18 (Universal tooth 1)
2. **Progress bar** shows `chartingIndex / 32` with percentage
3. Current tooth is highlighted on SVG with amber dashed column
4. Data entry panel auto-focuses the first PD input (MB) for that tooth
5. **Enter** on last input (DL) or when no input focused → advance to next tooth in FDI charting order
6. **Shift+Enter** → go back to previous tooth
7. **Escape** → exit charting mode
8. **"Fertig" button** → exit charting mode
9. Click any tooth on SVG during charting → jump to that tooth, sync chartingIndex

Use `FDI_CHARTING_ORDER` from `$lib/utils` (same array as dental chart).

#### 5.4 Record Create/Save Flow

On dialog open:
1. Load `pastRecords` via `getProbingRecords(patientId)`
2. If user immediately starts entering data (first PD input), auto-create a new record in DB via `insertProbingRecord()`
3. All subsequent inputs auto-save to that record
4. "Save & Close" button just closes the dialog (data is already persisted)
5. The explicit "Save" button is now "Save & Close" — data is already auto-saved per-input

If loading a past record:
1. Set `currentRecord` to the selected record
2. Load all measurements via `getProbingMeasurements(recordId)`
3. Load all tooth data via `getProbingToothData(recordId)`
4. Populate all state maps

#### 5.5 Keyboard Handler (Window-Level)

Attach a `keydown` handler to the dialog (same pattern as `DentalChartView`):

```typescript
function handleKeydown(e: KeyboardEvent) {
  // Skip if user is typing in an input/textarea
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    // But still handle Enter on last PD input (DL) to advance tooth
    if (e.key === 'Enter' && isLastPdInput(e.target)) {
      e.preventDefault();
      advanceTooth();
    }
    return;
  }

  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    advanceTooth();
  } else if (e.key === 'Enter' && e.shiftKey) {
    e.preventDefault();
    goBackTooth();
  } else if (e.key === 'Escape') {
    if (chartingMode) {
      chartingMode = false;
    } else if (selectedTooth) {
      selectedTooth = null;
    }
  }
}
```

#### 5.6 Ensuring Record Exists Before First Input

When the user types the first PD value or toggles the first BOP, if `currentRecord` is null, auto-create a record:

```typescript
async function ensureRecord(): Promise<ProbingRecord> {
  if (!currentRecord) {
    currentRecord = await insertProbingRecord(patientId, {
      exam_date: examDate,
      examiner: examinerId ? String(examinerId) : '',
      notes,
    });
  }
  return currentRecord;
}
```

Call `await ensureRecord()` at the top of every `handlePdChange`, `handleBopToggle`, etc.

#### 5.7 Update Import in TimelineView

After renaming, update `src/lib/components/timeline/TimelineView.svelte`:
- Change import from `ProbingChartView` to `ProbingChartDialog`
- Update the component tag: `<ProbingChartDialog bind:open={showProbingChart} {patientId} onRecordSaved={() => {}} />`

**Checklist:**
- [ ] Create `src/lib/components/perio/ProbingChartDialog.svelte` with full state management
- [ ] Implement two-column flex layout (60/40 split)
- [ ] Toolbar: date picker, examiner dropdown, "Load past" dropdown, "Compare" toggle, "Start Charting" button, "Save & Close" button
- [ ] Integrate `PerioSVGChart` in left panel
- [ ] Integrate `PerioDataEntryPanel` in right panel
- [ ] Integrate `PerioSummaryBar` at bottom
- [ ] Integrate `PerioComparisonView` (conditionally shown when comparison active)
- [ ] Implement charting mode with progress bar (matching dental chart pattern)
- [ ] Window-level keyboard handler: Enter/Shift+Enter/Escape
- [ ] Auto-create record on first data input (`ensureRecord()`)
- [ ] Load past record measurements into state maps
- [ ] Comparison record loading and toggle
- [ ] Update import in `TimelineView.svelte` (change `ProbingChartView` → `ProbingChartDialog`)
- [ ] Delete old `ProbingChartView.svelte` file
- [ ] Run `npm run check` — 0 errors

---

### Step 6: Visual Polish & Final Touches

#### 6.1 Animations & Transitions

- **Bar growth animation**: When loading data or switching records, bars animate from 0 to target height (CSS transition: `height 300ms ease-out`)
- **Save pulse**: Green checkmark flash on the data entry panel header after auto-save (same as `ToothDetailPanel`)
- **Charting progress bar**: Smooth width transition when advancing teeth

#### 6.2 Legend on SVG Chart

Below the lower arch, render a compact legend row inside the SVG:

```
■ 1-3mm (healthy)   ■ 4-5mm (moderate)   ■ ≥6mm (deep)   ● BOP   ● Plaque   ▬ Recession
```

#### 6.3 Empty State

When the SVG chart has no data yet, show ghost placeholder bars (very light gray, all at 2mm height) to indicate where data will appear. This gives the chart structure before any input.

#### 6.4 Responsive Behavior

- Below 900px dialog width: stack layout vertically (chart on top, panel below) instead of side-by-side
- SVG chart has `class="w-full"` and `preserveAspectRatio="xMidYMid meet"`

#### 6.5 Dark Mode

All colors must work in both light and dark mode. Use oklch custom properties from `app.css` where possible; for clinical colors (green/amber/red), use Tailwind's dark variants (already done in the color classes).

SVG bars: use slightly muted colors in dark mode. Detect via `prefers-color-scheme` media query in the SVG `<style>` block, or pass a `darkMode` prop.

**Checklist:**
- [ ] Add CSS transitions for bar height animation (300ms ease-out)
- [ ] Save pulse animation on panel header
- [ ] Charting progress bar smooth transition
- [ ] SVG legend below lower arch
- [ ] Ghost placeholder bars when no data
- [ ] Responsive stacked layout below 900px
- [ ] Dark mode color adjustments for SVG bars
- [ ] Run `npm run check` — 0 errors

---

### Step 7: Migration & Backward Compatibility

#### 7.1 Old Data

Existing `probing_measurements` rows have `recession = NULL` and `plaque = 0` — this is fine, the new UI treats NULL recession as "not measured" and plaque=0 as "clean". No data migration needed.

#### 7.2 Old Component Removal

After the new `ProbingChartDialog.svelte` is working:
1. Delete `src/lib/components/perio/ProbingChartView.svelte`
2. Verify no other imports reference `ProbingChartView`
3. The only import point is `TimelineView.svelte` — updated in Step 5.7

#### 7.3 Audit Trail

The new component should call `logAudit()` when:
- A new probing record is created
- A probing record is updated (examiner, notes changed)
- This keeps parity with the rest of the app's audit logging

**Checklist:**
- [ ] Verify old data renders correctly (NULL recession, plaque=0)
- [ ] Delete old `ProbingChartView.svelte`
- [ ] Grep codebase for any remaining `ProbingChartView` references
- [ ] Add `logAudit` calls for probing record create/update
- [ ] Final `npm run check` — 0 errors

---

## File Inventory (New & Modified)

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/components/perio/PerioSVGChart.svelte` | **CREATE** | SVG visualization of probing depths |
| `src/lib/components/perio/PerioDataEntryPanel.svelte` | **CREATE** | Right-side single-tooth data entry |
| `src/lib/components/perio/PerioSummaryBar.svelte` | **CREATE** | Bottom statistics bar |
| `src/lib/components/perio/PerioComparisonView.svelte` | **CREATE** | Comparison delta display |
| `src/lib/components/perio/ProbingChartDialog.svelte` | **CREATE** | Main dialog orchestrator (replaces old) |
| `src/lib/components/perio/ProbingChartView.svelte` | **DELETE** | Old implementation |
| `src/lib/services/db.ts` | **MODIFY** | Add migration v30, new DB functions, extend upsert |
| `src/lib/types.ts` | **MODIFY** | Extend ProbingMeasurement, add ProbingToothData |
| `src/lib/components/timeline/TimelineView.svelte` | **MODIFY** | Update import to ProbingChartDialog |

---

## Execution Order

**The steps MUST be done in this order** because of dependencies:

1. **Step 0** — DB schema + types (everything else depends on this)
2. **Step 1** — SVG chart (visual foundation, no dependencies except types)
3. **Step 2** — Data entry panel (needs types from Step 0)
4. **Step 3** — Summary bar (standalone, just needs the data maps)
5. **Step 4** — Comparison view (needs SVG chart from Step 1 to exist)
6. **Step 5** — Main dialog orchestrator (integrates all above components + updates TimelineView import)
7. **Step 6** — Visual polish (refinement pass on all components)
8. **Step 7** — Cleanup and backward compatibility verification

Steps 1, 2, and 3 can technically be done in parallel after Step 0, but it's easier to test sequentially.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **SVG bars, not table cells** | Visual pattern recognition is instant — tall red bars jump out; a red background on a tiny input does not |
| **One-tooth-at-a-time panel** | Matches dental chart UX; reduces cognitive load from 192 fields to 6+6=12 at a time |
| **Guided charting mode** | Ensures complete data entry in consistent order; practitioners are used to calling out sites sequentially |
| **Auto-save per input** | Same pattern as dental chart — never lose work, no explicit "Save" step for data |
| **Ghost comparison bars** | Side-by-side tables are hard to scan; overlaid ghost bars let you see improvement/worsening at a glance |
| **Recession + CAL** | Pocket depth alone is insufficient for staging; CAL (PD + recession) is the clinical standard |
| **Mobility + furcation** | Standard perio exam components; storing them per-record enables tracking progression over time |
