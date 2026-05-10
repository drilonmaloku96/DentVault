# DentVault — PAR Module: Clean Architecture Plan

> Source reference: DS-WIN-PAR Handbook v2.9 (Dampsoft GmbH)
> Regulatory basis: G-BA PAR-Richtlinie, effective 01.07.2021
> Design philosophy: built from scratch, not patched onto the existing perio system

---

## 0. Why a Clean Build

The existing `probing_records` / `probing_measurements` / `probing_tooth_data` tables were designed for casual standalone perio checkups. PAR is a different domain:

- **Clinically regulated** — strict step sequence enforced by law (AIT → BEVa → CPT → BEVb → UPT), with time windows and mandatory approval forms
- **Measurement-dense** — up to 6 sites × 28 teeth = 168 values per assessment, needing fast keyboard-driven entry, not click-based
- **Stateful** — each case has a lifecycle; the system should prevent illegal transitions (no BEVb before CPT, no UPT before BEVa)
- **Outcome-oriented** — the primary value is tracking periodontal improvement across 2–3 years; this needs proper trend analytics, not just a comparison view
- **Multi-assessment** — every patient goes through 3–8 assessments in a single PAR cycle; the data model must treat them as a unified clinical trajectory, not isolated records

The existing perio module stays intact, untouched, for standalone checkups. PAR gets its own isolated schema, its own components, and its own entry/visualization pipeline.

---

## 1. Clinical Pathway Reference

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                         PAR TREATMENT PATHWAY                            │
 │                                                                          │
 │  [AIT] ──────────────►[BEVa] ──────────────►[UPT 1..n]                  │
 │          3–6 months           3–6 months     (grade A=2, B=4, C=6)       │
 │                    └──────►[CPT]──────►[BEVb]──►[UPT 1..n]              │
 │                        (if TT ≥6mm)  3–6 months                          │
 │                                                                           │
 │  [KTB] = standalone control plan, not part of any series                 │
 └──────────────────────────────────────────────────────────────────────────┘
```

### Step types

| Code | Full name | Triggered by |
|---|---|---|
| `AIT` | Antiinfektiöse Therapie | New case |
| `BEVa` | Befundevaluation nach AIT | AIT `end_date` set |
| `CPT` | Chirurgische Therapie | BEVa with TT ≥ 6mm |
| `BEVb` | Befundevaluation nach CPT | CPT `end_date` set |
| `UPTd` | UPT durch Zahnarzt | BEVa or BEVb complete |
| `UPTg` | UPT durch Zahnarzthelferin | BEVa or BEVb complete |
| `UPTc` | UPT (§ 22 SGB V) | Only for Pflegegrad patients |
| `KTB` | Kontrollplan | Standalone, any time |

---

## 2. Database Schema

> Append to `SCHEMA_STATEMENTS` in `db.ts`. All 6 tables in one migration block.
> Current `LATEST_VERSION = 54`. New target: `LATEST_VERSION = 57`.

### v55 — Core PAR tables

```sql
CREATE TABLE IF NOT EXISTS par_cases (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id    TEXT    NOT NULL,
  plan_type     TEXT    NOT NULL DEFAULT 'kasse',   -- 'kasse' | 'privat'
  status        TEXT    NOT NULL DEFAULT 'active',  -- 'active' | 'completed' | 'ended'
  grade         TEXT    DEFAULT NULL,               -- 'A' | 'B' | 'C'
  sgb22         INTEGER DEFAULT 0,                  -- § 22 SGB V flag
  is_transfer   INTEGER DEFAULT 0,                  -- Übernahmefall
  transfer_from TEXT    DEFAULT '',
  transfer_step TEXT    DEFAULT NULL,               -- prior step done elsewhere
  transfer_upt  INTEGER DEFAULT NULL,               -- UPT phase at time of transfer
  end_date      TEXT    DEFAULT NULL,               -- Behandlungsende
  doctor_id     INTEGER DEFAULT NULL,               -- primary responsible doctor
  created_at    TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id)  REFERENCES doctors(id)
);

CREATE TABLE IF NOT EXISTS par_assessments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,
  type            TEXT    NOT NULL,               -- 'AIT'|'BEVa'|'CPT'|'BEVb'|'UPTd'|'UPTg'|'UPTc'|'KTB'
  sequence        INTEGER DEFAULT 1,              -- UPT session number (1..6)
  exam_date       TEXT    NOT NULL,
  doctor_id       INTEGER DEFAULT NULL,
  start_date      TEXT    DEFAULT NULL,           -- treatment start
  end_date        TEXT    DEFAULT NULL,           -- treatment end / Abschlussdatum
  approval_date   TEXT    DEFAULT NULL,
  is_referral     INTEGER DEFAULT 0,
  notes           TEXT    DEFAULT '',
  locked          INTEGER DEFAULT 0,              -- 1 when case.end_date is set
  created_at      TEXT    NOT NULL,
  updated_at      TEXT    NOT NULL,
  FOREIGN KEY (case_id)   REFERENCES par_cases(id)   ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id)
);

CREATE TABLE IF NOT EXISTS par_measurements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id  INTEGER NOT NULL,
  tooth          INTEGER NOT NULL,   -- FDI (11–48)
  site           TEXT    NOT NULL,   -- 'db'|'b'|'mb'|'ml'|'l'|'dl'
  pocket         INTEGER,            -- mm
  recession      INTEGER,            -- mm (positive = recession, use for CAL calc)
  bop            INTEGER DEFAULT 0,  -- 0=none  1=bleeding  2=pus
  plaque         INTEGER DEFAULT 0,  -- 0=none  1=present
  FOREIGN KEY (assessment_id) REFERENCES par_assessments(id) ON DELETE CASCADE,
  UNIQUE(assessment_id, tooth, site)
);

CREATE TABLE IF NOT EXISTS par_tooth_data (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id  INTEGER NOT NULL,
  tooth          INTEGER NOT NULL,
  mobility       INTEGER DEFAULT NULL,   -- 0–3
  furcation_b    INTEGER DEFAULT NULL,   -- buccal/labial: 0–3
  furcation_m    INTEGER DEFAULT NULL,   -- mesial: 0–3  (multi-root only)
  furcation_d    INTEGER DEFAULT NULL,   -- distal: 0–3  (multi-root only)
  vitality       INTEGER DEFAULT NULL,   -- 1=vital  0=devital  NULL=unknown
  ait_planned    INTEGER DEFAULT 0,
  cpt_planned    INTEGER DEFAULT 0,
  status         TEXT    DEFAULT NULL,   -- 'implant'|'destroyed'|'missing'|NULL
  FOREIGN KEY (assessment_id) REFERENCES par_assessments(id) ON DELETE CASCADE,
  UNIQUE(assessment_id, tooth)
);

CREATE TABLE IF NOT EXISTS par_bone_levels (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  assessment_id  INTEGER NOT NULL,
  jaw            TEXT    NOT NULL,              -- 'upper'|'lower'
  points_json    TEXT    NOT NULL DEFAULT '[]', -- [{x,y}[]] normalized 0–1 coords
  UNIQUE(assessment_id, jaw),
  FOREIGN KEY (assessment_id) REFERENCES par_assessments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_par_cases_patient      ON par_cases(patient_id);
CREATE INDEX IF NOT EXISTS idx_par_assessments_case   ON par_assessments(case_id);
CREATE INDEX IF NOT EXISTS idx_par_measurements_ass   ON par_measurements(assessment_id, tooth);
CREATE INDEX IF NOT EXISTS idx_par_tooth_data_ass     ON par_tooth_data(assessment_id, tooth);
```

### v56 — Anamnesis & UPT schedule

```sql
CREATE TABLE IF NOT EXISTS par_anamnesis (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id          INTEGER NOT NULL UNIQUE,
  diabetes         INTEGER DEFAULT 0,
  hba1c            REAL    DEFAULT NULL,
  smoking          INTEGER DEFAULT 0,
  smoking_cpd      INTEGER DEFAULT NULL,    -- cigarettes/day
  smoking_years    INTEGER DEFAULT NULL,
  cardiovascular   INTEGER DEFAULT 0,
  immunosuppression INTEGER DEFAULT 0,
  general_other    TEXT    DEFAULT '',
  prior_par        INTEGER DEFAULT 0,
  prior_par_year   INTEGER DEFAULT NULL,    -- 4-digit year
  family_history   INTEGER DEFAULT 0,
  specific_other   TEXT    DEFAULT '',
  special_history  TEXT    DEFAULT '',
  assessor_done    INTEGER DEFAULT 0,
  assessor_date    TEXT    DEFAULT NULL,
  FOREIGN KEY (case_id) REFERENCES par_cases(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS par_upt_schedule (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id         INTEGER NOT NULL,
  session         INTEGER NOT NULL,        -- 1..6
  window_start    TEXT    NOT NULL,
  window_end      TEXT    NOT NULL,
  delivered_date  TEXT    DEFAULT NULL,
  assessment_id   INTEGER DEFAULT NULL,    -- FK when session is marked delivered
  appointment_id  INTEGER DEFAULT NULL,    -- FK to appointments when booked
  UNIQUE(case_id, session),
  FOREIGN KEY (case_id)       REFERENCES par_cases(id)       ON DELETE CASCADE,
  FOREIGN KEY (assessment_id) REFERENCES par_assessments(id)
);
```

### v57 — Settings keys (no table needed, stored in existing `settings` table)

Document the keys used:

| Key | Type | Default | Description |
|---|---|---|---|
| `par_sites` | `'2'\|'6'` | `'2'` | Measurement points per tooth |
| `par_seq_q1` | `'d'\|'m'` | `'d'` | First site in Q1 (upper right) |
| `par_seq_q2` | `'d'\|'m'` | `'m'` | First site in Q2 (upper left) |
| `par_seq_q3` | `'d'\|'m'` | `'m'` | First site in Q3 (lower left) |
| `par_seq_q4` | `'d'\|'m'` | `'d'` | First site in Q4 (lower right) |
| `par_bop_threshold` | number string | `'4'` | BOP highlight threshold (mm) |
| `par_highlight` | `'all'\|'applied'` | `'all'` | Which teeth to highlight |
| `par_working_days` | JSON number[] | `'[1,2,3,4,5]'` | Working days (1=Mon) |
| `par_upt_stat_only` | `'true'\|'false'` | `'false'` | Include stat-only UPT |

---

## 3. TypeScript Types

### `src/lib/types.ts` additions

```typescript
// ── PAR domain types ──────────────────────────────────────────────────────

export type ParPlanType   = 'kasse' | 'privat';
export type ParStatus     = 'active' | 'completed' | 'ended';
export type ParGrade      = 'A' | 'B' | 'C';
export type ParStepType   = 'AIT' | 'BEVa' | 'CPT' | 'BEVb' | 'UPTd' | 'UPTg' | 'UPTc' | 'KTB';
export type ParSite       = 'db' | 'b' | 'mb' | 'ml' | 'l' | 'dl';
export type ParToothStatus = 'implant' | 'destroyed' | 'missing';
export type ParBopState   = 0 | 1 | 2;  // none | bleeding | pus

export interface ParCase {
  id: number;
  patient_id: string;
  plan_type: ParPlanType;
  status: ParStatus;
  grade: ParGrade | null;
  sgb22: boolean;
  is_transfer: boolean;
  transfer_from: string;
  transfer_step: ParStepType | null;
  transfer_upt: number | null;
  end_date: string | null;
  doctor_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface ParAssessment {
  id: number;
  case_id: number;
  type: ParStepType;
  sequence: number;
  exam_date: string;
  doctor_id: number | null;
  start_date: string | null;
  end_date: string | null;
  approval_date: string | null;
  is_referral: boolean;
  notes: string;
  locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface ParMeasurement {
  id: number;
  assessment_id: number;
  tooth: number;
  site: ParSite;
  pocket: number | null;
  recession: number | null;
  bop: ParBopState;
  plaque: number;
}

export interface ParToothData {
  id: number;
  assessment_id: number;
  tooth: number;
  mobility: number | null;
  furcation_b: number | null;
  furcation_m: number | null;
  furcation_d: number | null;
  vitality: number | null;
  ait_planned: boolean;
  cpt_planned: boolean;
  status: ParToothStatus | null;
}

export interface ParBoneLevel {
  id: number;
  assessment_id: number;
  jaw: 'upper' | 'lower';
  points_json: string;
}

export interface ParAnamnesis {
  id: number;
  case_id: number;
  diabetes: boolean;
  hba1c: number | null;
  smoking: boolean;
  smoking_cpd: number | null;
  smoking_years: number | null;
  cardiovascular: boolean;
  immunosuppression: boolean;
  general_other: string;
  prior_par: boolean;
  prior_par_year: number | null;
  family_history: boolean;
  specific_other: string;
  special_history: string;
  assessor_done: boolean;
  assessor_date: string | null;
}

export interface ParUptSession {
  id: number;
  case_id: number;
  session: number;
  window_start: string;
  window_end: string;
  delivered_date: string | null;
  assessment_id: number | null;
  appointment_id: number | null;
}

// ── Derived / computed types ──────────────────────────────────────────────

// Full snapshot of one assessment's data (used in chart + comparison)
export interface ParAssessmentSnapshot {
  assessment: ParAssessment;
  measurements: ParMeasurement[];
  toothData: ParToothData[];
  boneLevels: ParBoneLevel[];
}

// Per-tooth computed summary across sites
export interface ParToothSummary {
  tooth: number;
  maxPocket: number | null;
  bopCount: number;           // number of sites with BOP ≥ 1
  siteCount: number;          // recorded sites
  cal: number | null;         // max CAL = max(pocket + recession)
  mobility: number | null;
  status: ParToothStatus | null;
  vitality: number | null;
  aitPlanned: boolean;
  cptPlanned: boolean;
}

// Case health stats (derived, not stored)
export interface ParCaseStats {
  bopPercent: number;         // BOP positive sites / total sites
  meanPocket: number;
  maxPocket: number;
  teethWithPocket6plus: number;
  teethWithBop: number;
  cal: number;                // mean CAL
  riskLevel: 'stable' | 'maintenance' | 'high_risk';
}

// UPT window (computed)
export interface UptWindowResult {
  sessions: UptSessionWindow[];
  total: number;
  baseDate: string;
}
export interface UptSessionWindow {
  session: number;
  windowStart: string;
  windowEnd: string;
  deliveredDate: string | null;
  appointmentId: number | null;
  status: 'delivered_on_time' | 'delivered_late' | 'delivered_early' | 'overdue' | 'upcoming' | 'future';
}
```

---

## 4. DB Service Functions

### New functions in `src/lib/services/db.ts`

```typescript
// ── Cases ─────────────────────────────────────────────────────────────────
getParCases(patientId: string): Promise<ParCase[]>
getParCase(id: number): Promise<ParCase | null>
createParCase(patientId: string, data: Partial<ParCase>): Promise<number>
updateParCase(id: number, patch: Partial<ParCase>): Promise<void>
deleteParCase(id: number): Promise<void>

// ── Assessments ───────────────────────────────────────────────────────────
getParAssessments(caseId: number): Promise<ParAssessment[]>
getParAssessment(id: number): Promise<ParAssessment | null>
createParAssessment(caseId: number, data: Partial<ParAssessment>): Promise<number>
updateParAssessment(id: number, patch: Partial<ParAssessment>): Promise<void>
deleteParAssessment(id: number): Promise<void>
lockCaseAssessments(caseId: number): Promise<void>   // sets locked=1 on all

// ── Measurements ──────────────────────────────────────────────────────────
getParMeasurements(assessmentId: number): Promise<ParMeasurement[]>
bulkUpsertParMeasurements(assessmentId: number, rows: Omit<ParMeasurement,'id'|'assessment_id'>[]): Promise<void>
// Uses a single transaction for all 56/168 rows

// ── Tooth data ────────────────────────────────────────────────────────────
getParToothData(assessmentId: number): Promise<ParToothData[]>
upsertParToothData(assessmentId: number, tooth: number, patch: Partial<ParToothData>): Promise<void>
bulkUpsertParToothData(assessmentId: number, rows: Partial<ParToothData>[]): Promise<void>

// ── Bone levels ───────────────────────────────────────────────────────────
getParBoneLevel(assessmentId: number, jaw: 'upper'|'lower'): Promise<ParBoneLevel | null>
upsertParBoneLevel(assessmentId: number, jaw: 'upper'|'lower', points: {x:number,y:number}[]): Promise<void>

// ── Anamnesis ─────────────────────────────────────────────────────────────
getParAnamnesis(caseId: number): Promise<ParAnamnesis | null>
upsertParAnamnesis(caseId: number, data: Partial<ParAnamnesis>): Promise<void>

// ── UPT schedule ──────────────────────────────────────────────────────────
getParUptSchedule(caseId: number): Promise<ParUptSession[]>
upsertParUptSchedule(caseId: number, sessions: Omit<ParUptSession,'id'>[]): Promise<void>
markUptDelivered(sessionId: number, deliveredDate: string, assessmentId: number): Promise<void>
linkUptToAppointment(sessionId: number, appointmentId: number): Promise<void>

// ── Snapshot load ─────────────────────────────────────────────────────────
// Loads full assessment data in one transaction (measurements + tooth + bone)
loadParAssessmentSnapshot(assessmentId: number): Promise<ParAssessmentSnapshot>

// ── Practice-wide Kontrollbuch ────────────────────────────────────────────
getParKontrollbuchRows(filters: ParKontrollbuchFilters): Promise<ParKontrollbuchRow[]>

// ── Utility: sync tooth status from dental chart ──────────────────────────
// Reads dental_chart for a patient and auto-fills par_tooth_data.status
// Called when creating a new assessment; user can override afterward
syncParToothStatusFromChart(assessmentId: number, patientId: string): Promise<void>
```

---

## 5. Utility: UPT Calculator

### `src/lib/utils/par-upt-calculator.ts`

Pure function, no DB dependency, fully unit-testable.

```typescript
export function calculateUptWindows(
  grade: ParGrade,
  aitEndDate: string,             // ISO
  cptEndDate?: string | null,
  workingDays?: number[],         // 1=Mon..7=Sun, defaults [1..5]
): UptWindowResult

// Algorithm:
//   baseDate = max(aitEndDate, cptEndDate ?? aitEndDate)
//   count = { A:2, B:4, C:6 }[grade]
//   session[1].start = nextWorkingDay(addMonths(baseDate, 3))
//   session[1].end   = prevWorkingDay(addMonths(baseDate, 6))
//   for i in 2..count:
//     prev = session[i-1].delivered ?? session[i-1].end
//     session[i].start = nextWorkingDay(addMonths(prev, 3))
//     session[i].end   = prevWorkingDay(addMonths(prev, 6))
//   All windows capped at baseDate + 24 months.

export function classifyUptStatus(
  session: UptSessionWindow
): UptSessionWindow['status']

// Logic:
//   if !delivered → overdue if today > window_end; upcoming if today in [start,end]; future if today < start
//   if delivered  → late if > window_end; early if < window_start; on_time otherwise
```

### `src/lib/utils/par-stats.ts`

```typescript
// Derive ParCaseStats from an assessment snapshot
export function computeAssessmentStats(snapshot: ParAssessmentSnapshot): ParCaseStats

// Risk level rules:
//   stable:      BOP% < 10% AND max pocket ≤ 4mm
//   maintenance: BOP% < 25% OR max pocket ≤ 5mm
//   high_risk:   BOP% ≥ 25% OR max pocket ≥ 6mm OR mobility ≥ 2

// Compute per-tooth summary from measurements
export function computeToothSummaries(
  measurements: ParMeasurement[],
  toothData: ParToothData[]
): ParToothSummary[]

// Compute improvement metrics between two snapshots
export interface ParImprovementStats {
  bopDelta: number;      // percentage points
  meanPocketDelta: number;
  cal_delta: number;
  improvedTeeth: number;
  worsenedTeeth: number;
  teethWithPocket6Resolved: number;
}
export function compareSnapshots(
  before: ParAssessmentSnapshot,
  after: ParAssessmentSnapshot
): ParImprovementStats
```

---

## 6. UI Component Architecture

### 6.1 Patient page PAR tab

The patient detail page adds a **"PAR"** tab in its navigation. The tab renders `ParCaseView`.

If the patient has no PAR case: show an empty state with "Neuen PAR-Fall anlegen" button.

If they have one active case: show it directly.

If they have multiple (rare — e.g. a new cycle years later): show a list to select from, plus a "Neuer Fall" button.

---

### 6.2 Component tree

```
src/lib/components/par/
│
├── ParCaseView.svelte              ← top-level: orchestrates all sub-panels
│
├── case/
│   ├── ParNewCaseDialog.svelte     ← create case: plan type, doctor, § 22, transfer
│   ├── ParCaseHeader.svelte        ← grade badge, status, plan type, edit meta
│   └── ParCaseEndDialog.svelte     ← set Behandlungsende + confirm
│
├── pathway/
│   └── ParPathwayLane.svelte       ← horizontal step visualization
│       (each step = colored node: pending-gray / active-blue / done-green / locked-slate)
│
├── assessment/
│   ├── ParAssessmentPanel.svelte   ← detail view for selected assessment
│   │   ├── shows meta: type, date, doctor, start/end, approval, referral
│   │   ├── three tabs: "Messwerte" | "Status Blatt 2" | "Vergleich"
│   │   └── "Blatt 1" button (AIT only) → opens ParBlatt1Dialog
│   │
│   ├── ParMeasurementGrid.svelte   ← the data-entry spreadsheet
│   └── ParNewAssessmentDialog.svelte ← create: shows only valid next types
│
├── chart/
│   └── ParStatusChart.svelte       ← SVG Blatt 2 rendering (display-only)
│       ├── ParChartUpperJaw.svelte
│       └── ParChartLowerJaw.svelte
│
├── anamnesis/
│   └── ParBlatt1Dialog.svelte      ← full anamnesis form
│
├── upt/
│   ├── UptStatusWidget.svelte      ← compact inline tracker (always visible when in UPT phase)
│   └── UptCalculatorDialog.svelte  ← expanded UPT manager + scheduler + extension
│
├── trend/
│   └── ParTrendPanel.svelte        ← multi-assessment comparison (tab inside AssessmentPanel)
│
└── kontrollbuch/
    └── ParKontrollbuch.svelte      ← practice-wide register
```

---

### 6.3 Key component specs

#### `ParCaseView.svelte`

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Kasse] Grad B   Dr. Mayer   § 22: Nein      [aktiv]  [Abschließen]│
├─────────────────────────────────────────────────────────────────────┤
│  Pathway:  [AIT ✓] ──► [BEVa ✓] ──► [UPT 1 ✓] [UPT 2 ⏳] [UPT 3·] │
├─────────────────────────────────────────────────────────────────────┤
│  ┌── UPT Widget (compact) ─────────────────────────────────────────┐│
│  │  UPT 2: window 14.02–14.05.2026   [Termin: keiner]   ● DUE SOON││
│  └─────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────┤
│  [Selected: BEVa  — 12.08.2025]                                      │
│  ┌──────────────────────────────────────────────────────────────────┐│
│  │  Messwerte │ Status Blatt 2 │ Vergleich                          ││
│  │  ...                                                             ││
│  └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

State: `$state selectedAssessmentId`, `$state activeTab`.

#### `ParPathwayLane.svelte`

- Renders ordered step nodes left-to-right
- AIT/BEVa/CPT/BEVb shown in fixed positions; UPT sessions shown dynamically (count depends on grade)
- Click any node → sets `selectedAssessmentId`
- "Neu" FAB at end of lane: shows a dialog with only valid next step types (computed from case state machine)
- Tooltip on hover: exam date, examiner, end date

#### State machine for valid next steps

```typescript
// src/lib/utils/par-state-machine.ts
export function getValidNextSteps(
  assessments: ParAssessment[],
  grade: ParGrade | null
): ParStepType[]

// Rules:
//   No assessments yet            → ['AIT', 'KTB']
//   AIT exists, no end_date       → []  (AIT still open)
//   AIT has end_date, no BEVa     → ['BEVa']
//   BEVa exists, no end_date      → []
//   BEVa has end_date, no CPT/UPT → ['CPT', 'UPTd', 'UPTg', 'UPTc']
//   CPT exists, no end_date       → []
//   CPT has end_date, no BEVb     → ['BEVb']
//   BEVb has end_date             → ['UPTd', 'UPTg', 'UPTc']
//   UPT in progress, < max count  → ['UPTd', 'UPTg', 'UPTc']
//   UPT complete (max count done) → []  (case should be ended)
//   KTB always addable            → always in list
```

This prevents all illegal step creation at the data layer, not just the UI.

#### `ParMeasurementGrid.svelte`

**This is the core input component. It must be fast.**

Layout: a spreadsheet-style grid mimicking the PAR chart layout.

```
        11  12  13  14  15  16  17  18   21  22 ...
  [Mob]  0   0   -   -   I   -   -   -    0   0 ...
  [Fur]  -   -   -   -  F1   -  F2   -    -   - ...
  [B]   d b m|d b m|...  ← buccal pocket depths
  [R-B]  -   -  1   ...  ← buccal recession
  [L]   d l m|...        ← lingual pocket depths
  [R-L]  -   -   -   ...
```

**Keyboard entry:**
- Numpad/number keys 0–9 → enter pocket depth for current site
- Tab / Enter → advance to next site in configured order
- Backspace → clear current, go back
- Arrow keys → navigate freely
- Right-click on a site → cycle BOP state (0→1→2→0), visual update
- F1 / F2 / F3 → furcation on current tooth's furcation row
- V key → toggle vitality on current tooth
- A key → toggle AIT planned
- C key → toggle CPT planned

**Visual feedback:**
- Red cell: pocket ≥ 6mm
- Orange cell: pocket 4–5mm with BOP
- Yellow: BOP present
- Blue dot: plaque
- Pink background (BOP bleeding), yellow background (BOP pus)
- Live summary bar at top: `BOP: 32%  |  Max TT: 7mm  |  Mean TT: 3.1mm  |  CAL: 4.2mm  |  Risk: ⚠ Maintenance`

**2-point vs 6-point mode:**
- 2-point: shows only `db` (distal-buccal) and `mb` (mesial-buccal) + lingual equivalents = 4 sites/tooth
- 6-point: shows all 6 sites
- Setting changes the displayed columns; DB always stores whatever is entered

#### `ParStatusChart.svelte`

SVG-based visual display of Blatt 2 (display only — not the entry grid). Used in the "Status Blatt 2" tab.

Rendered from a `ParAssessmentSnapshot`. Features:
- Authentic PAR chart layout: two jaw halves with mirrored tooth schema
- Per-tooth: TT values as numeric text in colored cells (height = depth, like bar chart)
- Recession bars drawn as extensions below gingival margin
- BOP markers: pink/yellow stars at each site
- Mobility row: 0/I/II/III text labels
- Furcation: degree symbols at root trifurcation points
- Vitality: +/- at root apex
- AIT/CPT planned: × marks
- Bone level: drawn red line overlay (interactive — right-click drag to draw, saved to `par_bone_levels`)
- Tooth status: missing = empty box, implant = different crown shape, destroyed = hatched

When a **previous assessment** is selected for comparison (via the Vergleich tab), depth cells from the previous assessment are shown as ghost/outline bars for visual overlay.

#### `ParTrendPanel.svelte`

"Vergleich" tab inside `ParAssessmentPanel`.

- Multi-select assessments from this case (checkbox list of all completed assessments)
- Renders a per-tooth trend visualization:
  - Each tooth = a small sparkline showing max pocket depth across selected assessments
  - Color gradient: red at first → green at last (improvement)
  - Click tooth → show full 6-site breakdown for that tooth across assessments
- Summary cards:
  - "BOP-Verbesserung: −18% seit AIT"
  - "TT Verbesserung: −1.4mm mean seit AIT"
  - "6mm+ Taschen: 4 → 0"
  - Risk level progression: `⚠ Maintenance → ✓ Stable`

Uses `compareSnapshots()` utility for all math.

#### `UptStatusWidget.svelte`

Compact always-visible widget shown in `ParCaseView` when case is in UPT phase.

```
┌─────────────────────────────────────────────────────────────────┐
│  UPT-Verlauf (Grad B, 4 Sitzungen)                  [Details]  │
│  ● UPT 1  14.03.25  ✓ erbracht (pünktlich)                     │
│  ● UPT 2  window: 14.08–14.11.25  [Termin: 23.09.25]  ⏳ offen  │
│  ● UPT 3  —  (noch nicht fällig)                               │
│  ● UPT 4  —  (noch nicht fällig)                               │
└─────────────────────────────────────────────────────────────────┘
```

Click "Details" → opens `UptCalculatorDialog`.

#### `UptCalculatorDialog.svelte`

Full UPT manager dialog. Tabs:

**"Zeiträume" tab:**
- Table with one row per UPT session
- Columns: Nr., Von, Bis, Erbracht, Termin, Status-indicator
- Row actions: "Termin vereinbaren" (→ BookingPanel with UPT type pre-filled + date window hint), "Erbracht markieren"
- Bottom: working days configuration (Mon–Sun checkboxes)
- "Statistik-Leistungen berücksichtigen" toggle

**"Verlängerung" tab (UPT-Verlängerung):**
- Only active after all UPT sessions done or near the 24-month window end
- Reason selection: two options (standard / custom months)
- Free text justification (required if ≥ 7 months, max 600 chars)
- Print form button

#### `ParBlatt1Dialog.svelte`

Anamnesis form for the AIT step. Sections:

1. **Progressionsgrad** — large A/B/C radio group (mandatory, warning if not set before end_date)
2. **Allgemeine Anamnese:**
   - Diabetes toggle → reveals HbA1c input
   - Rauchen toggle → reveals CPD + years inputs
   - Kardiovaskuläre Erkrankungen toggle
   - Immunsuppression toggle
   - Sonstiges: text field + user-maintained pick-list dropdown
3. **Parodontitisspezifische Anamnese:**
   - Frühere PAR-Therapie toggle → reveals year (4-digit validation)
   - Familiäre Belastung toggle
   - Spezielle Vorgeschichte textarea
   - Sonstiges: text + pick-list
4. **Gutachter / Genehmigung:**
   - "Wurde durch Gutachter geprüft" toggle → reveals date
   - Genehmigungsdatum

The pick-list for "Sonstiges" is managed inline (add/remove items) and persisted in the `settings` table as a JSON array under `'par_anamnesis_general_picklist'` and `'par_anamnesis_specific_picklist'`.

#### `ParKontrollbuch.svelte`

Standalone view at `/reports`. Filter bar + table.

**Columns:** Patient, GKV/Priv, Grade, Step (last), Exam date, UPT due, Status badge, Risk level

**Filter bar:** Doctor, Plan type, Step type (multi-select), Date range, Status, Risk level

**Counter chips:**
- Aktive Fälle: 24
- BEVa fällig (nächste 4 Wochen): 3
- UPT überfällig: 2
- Abgeschlossen: 18

**Actions:**
- Row click → navigate to patient PAR tab
- Print → generates filtered list HTML
- Export CSV

**Clinical insight view (beyond Dampsoft):**
Tabs: "Alle" | "Risikopatient" | "Fällig" | "Statistik"

"Statistik" tab:
- BOP% distribution across all active cases
- Average improvement AIT → BEVa across the practice
- Doctor-level comparison (with drill-down)

---

## 7. Dental Chart Integration

When creating a new `ParAssessment`, `syncParToothStatusFromChart()` is called automatically. It reads the patient's `dental_chart` table:

- Teeth with tag `extracted` or `missing` → `par_tooth_data.status = 'missing'`
- Teeth with tag indicating implant → `par_tooth_data.status = 'implant'`
- Vitality from `dental_chart` root canal status → initial value for `par_tooth_data.vitality`

These are only **initial defaults**. The user can override per-tooth within the PAR assessment. The PAR tooth status is stored separately in `par_tooth_data` and never writes back to the dental chart.

---

## 8. Timeline Integration

PAR case events appear as **timeline entries** with `entry_type = 'par_step'`. This gives them visibility in the main patient timeline alongside other clinical activity.

Triggered automatically:
- Case created → timeline entry "PAR-Behandlung gestartet"
- Each assessment completed (`end_date` set) → timeline entry with step type + brief stats (e.g. "BEVa abgeschlossen — BOP 18%, Max TT 4mm")
- Case ended → timeline entry "PAR-Behandlung abgeschlossen"

These are auto-generated, read-only, non-deletable timeline entries (like `chart_snapshot` entries). They use `SYSTEM_ENTRY_TYPES` and are rendered by a `ParStepCard.svelte` component.

---

## 9. Export Integration

Per the mandatory export rule:

### `gatherExportData()` additions

```typescript
parCases: ParCase[]
parData: Map<number, {
  anamnesis: ParAnamnesis | null,
  assessments: ParAssessment[],
  snapshots: Map<number, ParAssessmentSnapshot>,
  uptSchedule: ParUptSession[]
}>
```

### `renderPar()` function

Generates a PAR section in the HTML export:

```
For each case:
  Header: plan type, grade, status, § 22, doctor

  Anamnesis table (Blatt 1 data, if exists)
    Risk factors in a 2-column layout

  Treatment pathway summary table
    Columns: Step, Date, Examiner, Start, End, Status

  Per-assessment measurement tables
    One table per assessment
    Rows: tooth numbers, columns: TT sites, recession, BOP, mobility, furcation

  UPT schedule table
    Columns: Session, Window, Delivered, Status
    Color coding for status

  Improvement summary (if ≥ 2 assessments)
    BOP delta, TT delta, risk level change
```

Export section toggle key: `'par'` (added to `PatientExportOptions.sections`).

---

## 10. i18n Keys

```typescript
// In Translations interface (types.ts):
par: {
  // Navigation / meta
  title: string              // "PAR-Behandlung"
  kontrollbuch: string       // "PAR-Kontrollbuch"
  newCase: string
  noCase: string
  noAssessments: string

  // Case
  planType: { kasse: string; privat: string }
  status: { active: string; completed: string; ended: string }
  grade: string              // "Progressionsgrad"
  gradeValues: { A: string; B: string; C: string }
  sgb22: string
  treatmentEnd: string
  transferCase: string

  // Steps
  stepTypes: Record<ParStepType, string>
  stepStatus: { pending: string; done: string; locked: string; active: string }
  newStep: string
  noValidNextStep: string

  // Measurement grid
  grid: {
    pocketDepth: string      // "Taschentiefe"
    recession: string
    bop: string
    plaque: string
    mobility: string
    furcation: string
    vitality: string
    aitPlanned: string
    cptPlanned: string
    sites2: string
    sites6: string
    bopStates: { none: string; bleeding: string; pus: string }
    toothStatus: { implant: string; destroyed: string; missing: string }
  }

  // Chart
  chart: {
    buccal: string
    lingual: string
    boneLevel: string
    ttTrend: string
    attachmentLevel: string
  }

  // Blatt 1
  blatt1: {
    title: string
    progressionGrade: string
    gradeWarning: string
    anamnesis: {
      general: string
      specific: string
      diabetes: string
      hba1c: string
      smoking: string
      cpd: string
      years: string
      cardiovascular: string
      immunosuppression: string
      other: string
      priorPar: string
      priorParYear: string
      familyHistory: string
      specialHistory: string
    }
    assessor: string
    approvalDate: string
  }

  // UPT
  upt: {
    title: string
    session: string           // "UPT"
    window: string            // "Zeitraum"
    from: string
    to: string
    delivered: string         // "Erbracht"
    schedule: string          // "Termin"
    noAppointment: string
    statusLabels: Record<UptSessionWindow['status'], string>
    extension: {
      title: string
      period: string
      justification: string
      justificationRequired: string
    }
    statOnly: string
    workingDays: string
  }

  // Stats
  stats: {
    bopPercent: string
    meanPocket: string
    maxPocket: string
    cal: string
    riskLevel: string
    riskValues: { stable: string; maintenance: string; high_risk: string }
    improvement: string
    bopDelta: string
    pocketDelta: string
  }

  // Kontrollbuch
  book: {
    title: string
    counters: {
      active: string
      bevadue: string
      uptOverdue: string
      completed: string
    }
    filters: {
      allPlanTypes: string
      allSteps: string
      allStatus: string
      allRisk: string
    }
    tabs: { all: string; risk: string; due: string; stats: string }
  }

  // Settings
  settings: {
    measurementPoints: string
    measurementOrder: string
    firstSite: { distal: string; mesial: string }
    bopThreshold: string
    highlightMode: { all: string; applied: string }
    workingDays: string
    anamnesisPicklist: string
    general: string
    specific: string
  }
}
```

---

## 11. Settings Page Additions

**Settings → Clinical → "PAR-Einstellungen"** sub-section:

1. **Messpunkte** — 2-point / 6-point radio
2. **Messreihenfolge** — 4 quadrant dropdowns (erster Messpunkt: Distal / Mesial)
3. **BOP-Hervorhebung** — threshold spinner (mm) + mode radio (Alle Zähne / Nur beantragte)
4. **Werktage** — day-of-week checkboxes for UPT calculator
5. **Auswahlliste "Sonstiges"** — two managed lists (Allgemein + Spezifisch) with add/remove

---

## 12. Implementation Stages

### Stage 1 — Schema + Case CRUD + Patient Tab

**Goal:** A PAR case can be created for a patient and navigated.

- Migrations v55, v56
- Types: `ParCase`, `ParAssessment`
- DB functions: case + assessment CRUD
- `ParCaseView.svelte` — empty state + new case dialog
- `ParCaseHeader.svelte` — grade, plan type, status badges
- `ParPathwayLane.svelte` — renders existing assessments, "Neu" creates new
- `ParNewAssessmentDialog.svelte` — shows valid next steps via state machine
- `src/lib/utils/par-state-machine.ts` — `getValidNextSteps()`
- Patient page: PAR tab added
- i18n: par.title, par.newCase, par.stepTypes, par.planType, par.status, par.grade
- `npm run check` passes

**Deliverable:** Create PAR case, add AIT, advance through steps.

---

### Stage 2 — Measurement Entry Grid

**Goal:** Full data entry for an assessment.

- DB functions: `getParMeasurements`, `bulkUpsertParMeasurements`, `getParToothData`, `upsertParToothData`
- `ParAssessmentPanel.svelte` — panel with meta fields (date, doctor, dates, notes)
- `ParMeasurementGrid.svelte` — full keyboard-driven entry grid
  - 2-site mode first, 6-site behind settings toggle
  - Pocket depth entry (numpad), BOP right-click cycle, mobility/furcation click
  - Live summary bar (BOP%, max TT, mean TT)
  - Color highlighting (red ≥6, orange 4-5 + BOP)
- `src/lib/utils/par-stats.ts` — `computeToothSummaries()`, `computeAssessmentStats()`
- `syncParToothStatusFromChart()` — auto-fill tooth status on new assessment
- i18n: par.grid.*
- `npm run check` passes

**Deliverable:** Enter a full set of TT, BOP, recession, mobility, furcation measurements.

---

### Stage 3 — Blatt 2 SVG Chart

**Goal:** Visual periodontal status chart display.

- `ParStatusChart.svelte` (+ `ParChartUpperJaw.svelte`, `ParChartLowerJaw.svelte`)
- Renders TT as bar chart cells, BOP markers, recession, mobility, furcation, vitality, tooth status indicators
- Bone level drawing: right-click drag on SVG canvas → saves to `par_bone_levels`
- AIT/CPT planned markers
- "Status Blatt 2" tab in `ParAssessmentPanel` loads chart
- i18n: par.chart.*
- `npm run check` passes

**Deliverable:** View a complete PAR chart for any assessment, draw bone level lines.

---

### Stage 4 — Blatt 1 Anamnesis Form

**Goal:** Regulatory anamnesis form with progression grade.

- `ParBlatt1Dialog.svelte` — full form
- Pick-list management (settings JSON arrays)
- Progression grade syncs to `par_cases.grade`
- Grade change triggers UPT recalculation warning if UPT schedule exists
- 4-digit year validation for prior PAR history
- Settings sub-section for PAR pick-lists
- i18n: par.blatt1.*
- `npm run check` passes

**Deliverable:** Fill in Blatt 1, set progression grade, manage Sonstiges pick-list.

---

### Stage 5 — UPT Calculator + Scheduler Integration

**Goal:** Full UPT session management.

- `src/lib/utils/par-upt-calculator.ts` — `calculateUptWindows()`
- DB functions: `getParUptSchedule`, `upsertParUptSchedule`, `markUptDelivered`, `linkUptToAppointment`
- `UptStatusWidget.svelte` — compact always-visible tracker in `ParCaseView`
- `UptCalculatorDialog.svelte` — full manager: Zeiträume tab + Verlängerung tab
- "Termin vereinbaren" → opens `BookingPanel` with UPT appointment type + date hint pre-filled
- When a UPT appointment is completed (schedule marks it done), auto-marks UPT session as delivered
- Working days settings applied to date calculation
- i18n: par.upt.*
- `npm run check` passes

**Deliverable:** See UPT windows, book appointments, track delivery, apply for extension.

---

### Stage 6 — Trend Comparison

**Goal:** Clinical outcome visualization across assessments.

- `loadParAssessmentSnapshot()` DB function
- `compareSnapshots()` utility
- `ParTrendPanel.svelte` — "Vergleich" tab
  - Per-tooth sparklines for max pocket trend
  - Summary: BOP delta, TT delta, resolved pockets, risk level change
  - Multi-assessment selection
- "Status Blatt 2" chart: overlay previous assessment as ghost bars
- i18n: par.stats.*
- `npm run check` passes

**Deliverable:** Select two assessments, see improvement stats and visual overlays.

---

### Stage 7 — Timeline Integration

**Goal:** PAR events visible in the main patient timeline.

- `ParStepCard.svelte` — read-only timeline card for `par_step` entry type
- Auto-create timeline entries on: case created, assessment `end_date` set, case ended
- Show brief stats in the timeline card (BOP%, max TT on assessment completion)
- `SYSTEM_ENTRY_TYPES` extended with `'par_step'`
- `gatherExportData()` already pulls timeline, so this is free in export
- `npm run check` passes

**Deliverable:** PAR milestones appear in the patient timeline alongside other entries.

---

### Stage 8 — HTML Export

**Goal:** Full PAR data in the patient report.

- `renderPar()` in `patient-export.ts`
- Add `'par'` to `PatientExportOptions.sections`
- Anamnesis table, assessment measurement tables, UPT schedule, improvement summary
- Export dialog toggle for PAR section
- `npm run check` passes

**Deliverable:** Export includes complete PAR data rendered in the HTML report.

---

### Stage 9 — PAR Kontrollbuch + Reports Route

**Goal:** Practice-wide PAR management view.

- `getParKontrollbuchRows()` DB function — cross-patient JOIN
- `ParKontrollbuch.svelte` — filter bar, table, counter chips, search
- Re-activate `/reports` route with Kontrollbuch as default view
- Add "Berichte" nav link in sidebar (`src/routes/+layout.svelte`)
- "Statistik" tab: BOP distribution, improvement rates, doctor comparison
- i18n: par.book.*
- `npm run check` passes

**Deliverable:** Navigate to Reports → see all active PAR cases, filter by status/doctor/grade, identify overdue UPTs.

---

### Stage 10 — Settings Polish + Private PAR

**Goal:** Full settings coverage + private patient flow.

- Settings → Clinical → PAR-Einstellungen: measurement points, sequence, BOP threshold, working days
- Measurement sequence applied to grid tab order in Stage 2 grid
- Private PAR: `plan_type = 'privat'` unlocks `ParKvaDialog.svelte` — cost estimate dialog
  - List GOZ codes per step type
  - Mark/unmark line items
  - Printable cost estimate
- i18n: par.settings.*, par.kva.*
- `npm run check` passes

---

## 13. Files to Create / Modify

### New files

```
src/lib/components/par/
  ParCaseView.svelte
  case/
    ParNewCaseDialog.svelte
    ParCaseHeader.svelte
    ParCaseEndDialog.svelte
  pathway/
    ParPathwayLane.svelte
  assessment/
    ParAssessmentPanel.svelte
    ParMeasurementGrid.svelte
    ParNewAssessmentDialog.svelte
  chart/
    ParStatusChart.svelte
    ParChartUpperJaw.svelte
    ParChartLowerJaw.svelte
  anamnesis/
    ParBlatt1Dialog.svelte
  upt/
    UptStatusWidget.svelte
    UptCalculatorDialog.svelte
  trend/
    ParTrendPanel.svelte
  kontrollbuch/
    ParKontrollbuch.svelte

src/lib/utils/
  par-state-machine.ts
  par-upt-calculator.ts
  par-stats.ts
```

### Modified files

```
src/lib/services/db.ts                 ← v55–v57 migrations + all PAR DB functions
src/lib/types.ts                       ← all PAR types
src/lib/i18n/types.ts                  ← par.* key group
src/lib/i18n/de.ts
src/lib/i18n/en.ts
src/lib/services/patient-export.ts    ← renderPar() + gatherExportData PAR queries
src/routes/patients/[patient_id]/+page.svelte  ← PAR tab
src/routes/reports/+page.svelte        ← Kontrollbuch as main content
src/routes/settings/+page.svelte       ← PAR settings sub-section
src/routes/+layout.svelte             ← re-add Berichte nav link
```

The existing perio components (`ProbingChartDialog`, `PerioSVGChart`, `PerioDataEntryPanel`, `PerioComparisonView`, `PerioSummaryBar`) are **not modified**.

---

## 14. What This Does Better Than Dampsoft

| Area | Dampsoft | DentVault PAR |
|---|---|---|
| Measurement entry | Click on SVG chart areas | Keyboard-driven numeric grid, 10× faster |
| State enforcement | Soft warnings only | Hard state machine — invalid steps cannot be created |
| Risk stratification | None | Automatic BOP%/TT/mobility risk scoring per assessment |
| Outcome tracking | TT-Verlauf chart only | Per-tooth sparklines, delta stats, practice-wide improvement analytics |
| UPT scheduling | Separate dialog modal | Persistent widget in case view + direct scheduler integration |
| Trend visualization | Up to 6 static overlays | Sparklines + animated delta overlays + improvement summary cards |
| Export | Print forms (paper) | Full HTML patient report with PAR section, structured data |
| Practice analytics | Basic filter + count | Risk distribution, doctor comparison, improvement rate tracking |
| Data model | Monolithic plan records | Normalized tables: snapshot-per-assessment enables fine-grained queries |
| Integration | Separate module | Timeline entries, dental chart sync, appointment scheduler |

---

## 15. Open Questions for User Confirmation

1. **PAR tab visibility**: Show the PAR tab on all patients, or only when a PAR case exists (with a "hidden until needed" approach)?

2. **Standalone perio records**: Should old/existing standalone perio checkup records appear anywhere in the PAR view for context, or stay completely separate?

3. **UPT appointment auto-detection**: When a UPT appointment is marked as completed in the scheduler, should it automatically create the `par_assessments` record and mark the UPT session as delivered? This requires that the appointment type "UPTd" etc. is linked to the PAR case.

4. **Multiple PAR cycles**: Some patients will complete one full PAR cycle and years later start a new one. Should multiple `par_cases` be shown as a list or as a timeline selector? How far back should the history go?

5. **Private PAR billing codes**: Should DentVault store GOZ fee amounts (user-configurable), or just list the GOZ code numbers? The actual fees depend on the practice's agreements.
