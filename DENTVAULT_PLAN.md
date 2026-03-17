# DentVault — Implementation Plan (Phases 1–7)

> **Handoff document for continuing development.**
> Phase 0 (scaffolding) is complete. This document describes everything needed to build the remaining phases.

---

## Table of Contents

1. [Project Overview & Tech Stack](#project-overview--tech-stack)
2. [Current State (Phase 0 — Complete)](#current-state-phase-0--complete)
3. [Architecture & Conventions](#architecture--conventions)
4. [Phase 1 — Patient CRUD](#phase-1--patient-crud)
5. [Phase 2 — Timeline & Treatment History](#phase-2--timeline--treatment-history)
6. [Phase 3 — Treatment Plans](#phase-3--treatment-plans)
7. [Phase 4 — Clinical Exams (Dental Chart)](#phase-4--clinical-exams-dental-chart)
8. [Phase 5 — Documents & Attachments](#phase-5--documents--attachments)
9. [Phase 6 — Dashboard & Analytics](#phase-6--dashboard--analytics)
10. [Phase 7 — Settings, Export & Multi-User Prep](#phase-7--settings-export--multi-user-prep)
11. [Database Migration Strategy](#database-migration-strategy)
12. [Testing Strategy](#testing-strategy)

---

## Project Overview & Tech Stack

**DentVault** is a cross-platform desktop app for dental patient management, built for independent practitioners and small clinics.

| Layer | Technology | Version |
|---|---|---|
| Desktop Shell | Tauri | 2.10.0 |
| Frontend | SvelteKit + Svelte 5 | 2.50 / 5.51 |
| Language | TypeScript (strict) | 5.9 |
| Styling | Tailwind CSS v4 | 4.2 |
| Components | shadcn-svelte (bits-ui) | 1.1.1 / 2.16 |
| Database | SQLite via tauri-plugin-sql | 2.3.2 |
| Backend | Rust | 1.93 |

**Key conventions:**
- Svelte 5 runes: `$state()`, `$derived()`, `$effect()`, `$props()`
- Snippet-based slots: `{@render children()}`
- Tailwind v4 uses `@theme inline` blocks in CSS — no `tailwind.config.js`
- All colors are oklch CSS custom properties defined in `src/app.css`
- shadcn components live at `$lib/components/ui/` and are imported like `import { Button } from '$lib/components/ui/button'`
- Database access is exclusively through `src/lib/services/db.ts` — no direct plugin imports elsewhere
- SQL uses `$1, $2, ...` positional parameters (not `?`)
- New migrations are appended to the `migrations` vec in `src-tauri/src/lib.rs`

---

## Current State (Phase 0 — Complete)

### What exists now

**App shell** — `src/routes/+layout.svelte`:
- 240px sidebar with DentVault logo (tooth SVG icon), 3 nav links (Patients, Dashboard, Settings), "+ New Patient" button
- Main content area (flex-1, scrollable, 24px padding)
- Active route highlighting via `$app/state` → `page.url.pathname`

**Database** — SQLite `dentvault.db`:
- `patients` table with 18 columns (see schema below)
- Migrations run automatically on app start via Rust

**Service layer** — `src/lib/services/db.ts`:
- `getDb()` — singleton connection
- `generatePatientId()` — returns `"PT-" + Date.now().toString(36).toUpperCase()`
- `insertPatient(data)` → creates patient, returns full row
- `getAllPatients()` → sorted by lastname, firstname
- `getPatient(patientId)` → single patient or null
- `updatePatient(patientId, data)` → dynamic field update
- `searchPatients(query)` → LIKE search on name, ID, phone, email

**Types** — `src/lib/types.ts`:
```ts
type PatientStatus = 'active' | 'inactive' | 'archived'
interface Patient { id, patient_id, firstname, lastname, dob, gender, phone, email, insurance_provider, insurance_id, allergies, medications, risk_flags, status, next_appointment, notes, created_at, updated_at }
interface PatientFormData { firstname, lastname, dob?, gender?, phone?, email?, insurance_provider?, insurance_id? }
interface TimelineEntry { id, patient_id, date, type, provider, tooth, notes, created_at }
```

**Routes** — all placeholders:
- `/` → redirects to `/patients`
- `/patients` → search bar + empty state
- `/patients/new` → placeholder
- `/dashboard` → placeholder
- `/settings` → placeholder

**Installed shadcn components:** button, card, input, label, separator, badge, dialog, sheet, scroll-area

**Tauri capabilities:** `core:default`, `sql:default`, `sql:allow-load`, `sql:allow-execute`, `sql:allow-select`, `sql:allow-close`

### Current `patients` table schema

```sql
CREATE TABLE patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT UNIQUE NOT NULL,     -- "PT-XXXXXXX"
    firstname TEXT NOT NULL,
    lastname TEXT NOT NULL,
    dob TEXT DEFAULT '',
    gender TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    email TEXT DEFAULT '',
    insurance_provider TEXT DEFAULT '',
    insurance_id TEXT DEFAULT '',
    allergies TEXT DEFAULT '[]',          -- JSON array string
    medications TEXT DEFAULT '[]',        -- JSON array string
    risk_flags TEXT DEFAULT '[]',         -- JSON array string
    status TEXT DEFAULT 'active',         -- active | inactive | archived
    next_appointment TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL,             -- ISO datetime
    updated_at TEXT NOT NULL              -- ISO datetime
);
```

---

## Architecture & Conventions

### File organization pattern

```
src/routes/<feature>/+page.svelte          ← route page
src/lib/components/<feature>/              ← feature-specific components
src/lib/components/ui/                     ← shadcn base components
src/lib/services/db.ts                     ← all database operations
src/lib/services/<feature>.ts              ← feature service logic (if complex)
src/lib/types.ts                           ← all TypeScript interfaces
src/lib/stores/                            ← shared reactive state (if needed)
```

### How to add shadcn components

```bash
npx shadcn-svelte@1.1.1 add <component-name> -y
```

Components that will likely be needed in later phases: `table`, `select`, `textarea`, `tabs`, `dropdown-menu`, `tooltip`, `calendar`, `date-picker`, `alert`, `checkbox`, `radio-group`, `switch`, `progress`, `avatar`, `popover`, `command`, `form`.

### How to add database migrations

In `src-tauri/src/lib.rs`, append to the `migrations` vec:

```rust
Migration {
    version: N,  // increment from last version
    description: "description here",
    sql: "ALTER TABLE ... / CREATE TABLE ...",
    kind: MigrationKind::Up,
},
```

Migrations run automatically in order on app start. Never modify existing migrations — always add new ones.

### How to run & verify

```bash
# Source Rust environment (needed in each new terminal)
source ~/.cargo/env

# Development (opens Tauri window with hot reload)
npm run tauri dev

# Type check
npm run check

# Production build
npm run tauri build
```

---

## Phase 1 — Patient CRUD

**Goal:** Full patient lifecycle — create, list, view, edit, delete, search, status management.

### Phase 1A — New Patient Form

**File:** `src/routes/patients/new/+page.svelte` (replace placeholder)

**New component:** `src/lib/components/patient/PatientForm.svelte`
- Reusable form component (used for both create and edit)
- Props: `initialData?: PatientFormData`, `onSubmit: (data: PatientFormData) => Promise<void>`, `submitLabel?: string`
- Form sections:
  1. **Personal Info** — firstname (required), lastname (required), DOB (date input), gender (select: Male/Female/Other/Prefer not to say)
  2. **Contact** — phone, email
  3. **Insurance** — insurance_provider, insurance_id
- Validation: firstname and lastname required, email format check if provided, phone format hint
- Use shadcn components: `Input`, `Label`, `Button`, `Select`, `Card`, `Separator`
- Add shadcn `select` component: `npx shadcn-svelte@1.1.1 add select -y`
- On submit: call `insertPatient()` from db.ts, then `goto('/patients/' + patient.patient_id)`
- Show toast/alert on success
- Cancel button → `goto('/patients')`

**Add shadcn components needed:** `select`, `textarea`, `alert`

### Phase 1B — Patient List (with real data)

**File:** `src/routes/patients/+page.svelte` (replace placeholder)

**New component:** `src/lib/components/patient/PatientCard.svelte`
- Compact card for each patient in the list
- Shows: full name, patient_id, status badge, phone, next appointment
- Click navigates to `/patients/[patient_id]`

**Implementation:**
- On mount, call `getAllPatients()` from db.ts
- Store in `let patients = $state<Patient[]>([])`
- Wire search input to `searchPatients()` with debounce (300ms)
- Display as a grid of `PatientCard` components (responsive: 1 col mobile, 2 cols medium, 3 cols wide)
- Keep the empty state when `patients.length === 0`
- Add patient count in header: "X patients"
- Add shadcn `table` component as an alternative list/table view toggle

**Add a debounce utility to `src/lib/utils.ts`:**
```ts
export function debounce<T extends (...args: any[]) => any>(fn: T, ms: number) {
    let timeout: ReturnType<typeof setTimeout>;
    return (...args: Parameters<T>) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), ms);
    };
}
```

### Phase 1C — Patient Detail View

**New route:** `src/routes/patients/[patient_id]/+page.svelte`

**Layout:** Tabbed interface using shadcn `tabs`:
- **Overview tab** (default): Patient card with all demographics, status badge, quick actions
- **Medical tab**: Allergies, medications, risk flags (editable lists — arrays stored as JSON text)
- **Notes tab**: Free-text notes field with save button
- **Timeline tab**: Placeholder (implemented in Phase 2)

**Implementation:**
- URL param: `patient_id` extracted from route
- On mount: `getPatient(patient_id)` — if null, show "Patient not found" with back link
- Display all patient fields in organized card sections
- "Edit" button → opens edit dialog or navigates to edit page
- "Back to Patients" breadcrumb link

**Add shadcn components:** `tabs`

### Phase 1D — Edit Patient

**New route:** `src/routes/patients/[patient_id]/edit/+page.svelte`

**Implementation:**
- Reuse `PatientForm.svelte` with `initialData` pre-filled from `getPatient()`
- On submit: call `updatePatient()` from db.ts
- Redirect back to patient detail view on success

### Phase 1E — Patient Status & Delete

**Status management:**
- In patient detail view, add a status dropdown (active/inactive/archived)
- Changing status calls `updatePatient(patientId, { status: newStatus })`
- Archived patients are hidden from default list view (add a "Show archived" toggle)

**Delete:**
- Add "Delete Patient" button in patient detail (destructive variant)
- Confirmation dialog (shadcn `dialog`) with patient name
- Add `deletePatient(patientId)` to `db.ts`:
  ```ts
  export async function deletePatient(patientId: string): Promise<void> {
      const conn = await getDb();
      await conn.execute('DELETE FROM patients WHERE patient_id = $1', [patientId]);
  }
  ```
- After delete, redirect to `/patients`

### Phase 1F — Medical Info Editor

**New component:** `src/lib/components/patient/ArrayFieldEditor.svelte`
- Editable list for allergies, medications, risk_flags
- Props: `items: string[]`, `label: string`, `onUpdate: (items: string[]) => void`
- Each item: text display + remove button
- Add input at bottom with "Add" button
- Items stored as JSON string in the patient record

**Implementation in patient detail "Medical" tab:**
- Parse JSON strings: `JSON.parse(patient.allergies)` → string[]
- On change: `updatePatient(patientId, { allergies: JSON.stringify(newArray) })`
- Color-coded badges for risk flags (red), allergies (orange), medications (blue)

### Phase 1 — Verification Checklist

After completing Phase 1, verify:
- [ ] Can create a new patient with all fields
- [ ] Patient appears in the list immediately
- [ ] Search filters patients by name, ID, phone, email
- [ ] Can click a patient to see their detail view
- [ ] Can edit patient demographics
- [ ] Can change patient status
- [ ] Can add/remove allergies, medications, risk flags
- [ ] Can delete a patient with confirmation
- [ ] Archived patients hidden by default, shown with toggle
- [ ] Navigation works: list → detail → edit → back
- [ ] `npm run check` passes with no errors

---

## Phase 2 — Timeline & Treatment History

**Goal:** Chronological record of all visits, procedures, and notes for each patient.

### Database Migration (version 2)

Add to `src-tauri/src/lib.rs` migrations:

```sql
CREATE TABLE IF NOT EXISTS timeline_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    entry_type TEXT NOT NULL,           -- 'visit' | 'procedure' | 'note' | 'lab' | 'imaging' | 'referral'
    title TEXT NOT NULL,
    provider TEXT DEFAULT '',
    tooth_numbers TEXT DEFAULT '',       -- comma-separated: "14,15,16"
    description TEXT DEFAULT '',
    diagnosis_codes TEXT DEFAULT '[]',   -- JSON array
    cpt_codes TEXT DEFAULT '[]',         -- JSON array
    attachments TEXT DEFAULT '[]',       -- JSON array of file paths (Phase 5)
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);
```

### Service Layer Additions

Add to `src/lib/services/db.ts`:

```ts
// Timeline CRUD
insertTimelineEntry(patientId, data) → TimelineEntry
getTimelineEntries(patientId, options?: { type?, limit?, offset? }) → TimelineEntry[]
getTimelineEntry(id) → TimelineEntry | null
updateTimelineEntry(id, data) → void
deleteTimelineEntry(id) → void
```

### Update Types

Expand `TimelineEntry` in `src/lib/types.ts`:

```ts
export type TimelineEntryType = 'visit' | 'procedure' | 'note' | 'lab' | 'imaging' | 'referral';

export interface TimelineEntry {
    id: number;
    patient_id: string;
    entry_date: string;
    entry_type: TimelineEntryType;
    title: string;
    provider: string;
    tooth_numbers: string;
    description: string;
    diagnosis_codes: string;  // JSON array
    cpt_codes: string;        // JSON array
    attachments: string;      // JSON array
    created_at: string;
    updated_at: string;
}

export interface TimelineFormData {
    entry_date: string;
    entry_type: TimelineEntryType;
    title: string;
    provider?: string;
    tooth_numbers?: string;
    description?: string;
}
```

### Components

**`src/lib/components/timeline/TimelineView.svelte`**
- Vertical timeline with date markers
- Each entry shows: date, type icon, title, provider, tooth numbers
- Click to expand → full description
- Filter by type (dropdown)
- "Add Entry" button at top

**`src/lib/components/timeline/TimelineEntryForm.svelte`**
- Dialog-based form for creating/editing entries
- Fields: date (date picker), type (select), title, provider, tooth numbers, description (textarea)
- Type-specific icons: 🏥 visit, 🔧 procedure, 📝 note, 🧪 lab, 📷 imaging, 📋 referral

**`src/lib/components/timeline/TimelineEntryCard.svelte`**
- Individual entry display: compact and expanded views
- Edit/delete actions on hover or via menu

### Route Integration

Add timeline as a tab in `src/routes/patients/[patient_id]/+page.svelte`:
- "Timeline" tab loads and displays `TimelineView` component
- Pass `patient_id` as prop

### Add shadcn components: `calendar`, `popover` (for date picker), `dropdown-menu`, `tooltip`

### Phase 2 — Verification Checklist

- [ ] Can add timeline entries of each type
- [ ] Timeline displays chronologically (newest first)
- [ ] Can filter by entry type
- [ ] Can edit an existing entry
- [ ] Can delete an entry with confirmation
- [ ] Tooth numbers display correctly
- [ ] Timeline shows on patient detail "Timeline" tab
- [ ] Entries deleted when patient is deleted (CASCADE)

---

## Phase 3 — Treatment Plans

**Goal:** Create and track multi-step treatment plans with status per procedure.

### Database Migration (version 3)

```sql
CREATE TABLE IF NOT EXISTS treatment_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id TEXT UNIQUE NOT NULL,          -- "TP-xxxxx"
    patient_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'proposed',        -- proposed | accepted | in_progress | completed | cancelled
    total_estimated_cost REAL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS treatment_plan_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id TEXT NOT NULL,
    sequence_order INTEGER NOT NULL,
    procedure_code TEXT DEFAULT '',         -- CDT code
    description TEXT NOT NULL,
    tooth_numbers TEXT DEFAULT '',
    estimated_cost REAL DEFAULT 0,
    status TEXT DEFAULT 'pending',          -- pending | scheduled | completed | cancelled
    completed_date TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    FOREIGN KEY (plan_id) REFERENCES treatment_plans(plan_id) ON DELETE CASCADE
);
```

### Components

**`src/lib/components/treatment/TreatmentPlanList.svelte`**
- List of all plans for a patient
- Status badge, progress bar (X of Y items completed), estimated cost
- Click to view/edit plan

**`src/lib/components/treatment/TreatmentPlanEditor.svelte`**
- Plan title, description, status
- Ordered list of procedure items (drag-to-reorder if feasible, otherwise up/down arrows)
- Each item: procedure code, description, tooth, cost, status
- Add/remove items
- Auto-calculate total cost
- "Accept Plan" / "Mark Complete" actions

**`src/lib/components/treatment/TreatmentPlanItem.svelte`**
- Single procedure row: checkbox, description, tooth, cost, status select

### Route Integration

New tab in patient detail view: "Treatment Plans"

### Phase 3 — Verification Checklist

- [ ] Can create a treatment plan with multiple items
- [ ] Can reorder items
- [ ] Plan status transitions work (proposed → accepted → in_progress → completed)
- [ ] Individual items can be marked completed
- [ ] Progress bar updates as items are completed
- [ ] Estimated cost auto-calculated
- [ ] Plans display in patient detail view

---

## Phase 4 — Clinical Exams (Dental Chart)

**Goal:** Visual tooth chart for recording conditions, with per-tooth notes.

### Database Migration (version 4)

```sql
CREATE TABLE IF NOT EXISTS dental_chart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    tooth_number INTEGER NOT NULL,          -- 1-32 (universal numbering)
    surface TEXT DEFAULT '',                 -- M, O, D, B, L combinations
    condition TEXT DEFAULT 'healthy',        -- healthy | decayed | filled | missing | crowned | implant | root_canal
    notes TEXT DEFAULT '',
    last_examined TEXT DEFAULT '',
    updated_at TEXT NOT NULL,
    UNIQUE(patient_id, tooth_number, surface),
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS clinical_exams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    exam_date TEXT NOT NULL,
    exam_type TEXT NOT NULL,                 -- 'comprehensive' | 'periodic' | 'limited' | 'emergency'
    findings TEXT DEFAULT '',                 -- free text
    probing_data TEXT DEFAULT '{}',           -- JSON: { "1": { "B": [3,3,3], "L": [3,3,3] }, ... }
    bpe_score TEXT DEFAULT '',
    examiner TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
);
```

### Components

**`src/lib/components/dental-chart/ToothChart.svelte`**
- Visual SVG representation of adult dentition (teeth 1-32)
- Two arches: upper (1-16) and lower (17-32) in anatomical layout
- Each tooth is clickable
- Color-coded by condition:
  - Healthy: white/light gray
  - Decayed: red
  - Filled: blue
  - Missing: dashed outline / X
  - Crowned: gold
  - Implant: silver
  - Root canal: purple
- Hover tooltip showing tooth number + condition

**`src/lib/components/dental-chart/ToothDetailPanel.svelte`**
- Appears when a tooth is clicked
- Shows: tooth number, current condition, surface details, notes
- Edit condition, add surface-specific entries (M/O/D/B/L)
- Save updates to `dental_chart` table

**`src/lib/components/dental-chart/ExamForm.svelte`**
- Create/edit clinical exam record
- Exam type, date, examiner, findings
- Optional periodontal probing data entry

### Route Integration

New tab in patient detail view: "Dental Chart"

Sub-views:
- Chart view (default): Interactive tooth diagram
- Exam history: List of past clinical exams

### Phase 4 — Verification Checklist

- [ ] Tooth chart renders all 32 teeth
- [ ] Can click a tooth and see/edit its condition
- [ ] Conditions are color-coded on the chart
- [ ] Surface-specific entries work (M, O, D, B, L)
- [ ] Can create a clinical exam record
- [ ] Exam history displays chronologically
- [ ] Chart data persists between sessions

---

## Phase 5 — Documents & Attachments

**Goal:** Attach files (X-rays, photos, PDFs) to patients and timeline entries.

### Tauri Plugin Addition

Add `tauri-plugin-fs` for file system access and `tauri-plugin-dialog` for file picker:

**Rust (`Cargo.toml`):**
```toml
tauri-plugin-fs = "2"
tauri-plugin-dialog = "2"
```

**Rust (`lib.rs`):** Register plugins:
```rust
.plugin(tauri_plugin_fs::init())
.plugin(tauri_plugin_dialog::init())
```

**Frontend (`package.json`):**
```bash
npm install @tauri-apps/plugin-fs @tauri-apps/plugin-dialog
```

**Capabilities (`default.json`):** Add permissions:
```json
"fs:default", "fs:allow-read", "fs:allow-write", "fs:allow-exists", "fs:allow-mkdir",
"dialog:default", "dialog:allow-open"
```

### Storage Strategy

Files are stored in the app's data directory:
```
{app_data_dir}/dentvault/attachments/{patient_id}/{filename}
```

Use `@tauri-apps/api/path` → `appDataDir()` to resolve the base path.

### Database Migration (version 5)

```sql
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id TEXT UNIQUE NOT NULL,       -- "DOC-xxxxx"
    patient_id TEXT NOT NULL,
    timeline_entry_id INTEGER,              -- nullable, links to timeline
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_type TEXT DEFAULT '',              -- mime type
    file_size INTEGER DEFAULT 0,
    file_path TEXT NOT NULL,                -- relative path from app data dir
    category TEXT DEFAULT 'other',          -- xray | photo | document | lab_report | other
    description TEXT DEFAULT '',
    uploaded_at TEXT NOT NULL,
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
    FOREIGN KEY (timeline_entry_id) REFERENCES timeline_entries(id) ON DELETE SET NULL
);
```

### Components

**`src/lib/components/documents/DocumentUploader.svelte`**
- Button to trigger native file picker via `@tauri-apps/plugin-dialog`
- Accepts: images (jpg, png, bmp, tiff), PDFs, DICOM (future)
- Copies file to app data directory
- Creates database record
- Shows upload progress

**`src/lib/components/documents/DocumentGallery.svelte`**
- Grid/list view of all documents for a patient
- Thumbnail previews for images
- File icon for PDFs and other types
- Filter by category
- Click to view full size

**`src/lib/components/documents/DocumentViewer.svelte`**
- Full-screen overlay for viewing documents
- Image zoom/pan
- PDF rendering (if feasible, or open in system viewer)

### Route Integration

New tab in patient detail view: "Documents"

Also linkable from timeline entries (attach documents to visits).

### Phase 5 — Verification Checklist

- [ ] Can upload images and PDFs via file picker
- [ ] Files stored in app data directory
- [ ] Thumbnail previews display in gallery
- [ ] Can categorize documents
- [ ] Can delete documents (removes file + DB record)
- [ ] Can associate documents with timeline entries
- [ ] Documents tab shows in patient detail view

---

## Phase 6 — Dashboard & Analytics

**Goal:** Practice overview with patient statistics and upcoming activity.

### File: `src/routes/dashboard/+page.svelte` (replace placeholder)

### Dashboard Widgets

**`src/lib/components/dashboard/StatsCards.svelte`**
- Total patients (active)
- New patients this month
- Patients needing follow-up (no appointment)
- Archived patients count

**`src/lib/components/dashboard/UpcomingAppointments.svelte`**
- List of patients with `next_appointment` in the next 7 days
- Click to navigate to patient detail

**`src/lib/components/dashboard/RecentActivity.svelte`**
- Last 10 timeline entries across all patients
- Shows patient name, entry type, date
- Click to navigate to patient

**`src/lib/components/dashboard/PatientStatusChart.svelte`**
- Simple bar or pie chart showing patient status distribution
- Can use a lightweight SVG-based chart (no heavy library dependency)
- Or use CSS-based bar chart for simplicity

### Service Layer Additions

Add to `src/lib/services/db.ts`:

```ts
// Dashboard queries
getPatientStats() → { total, active, inactive, archived, newThisMonth }
getUpcomingAppointments(days: number) → Patient[]
getRecentActivity(limit: number) → (TimelineEntry & { patient_firstname, patient_lastname })[]
```

These use JOIN queries and aggregate functions.

### Phase 6 — Verification Checklist

- [ ] Dashboard shows correct patient counts
- [ ] Stats update when patients are added/modified
- [ ] Upcoming appointments list works
- [ ] Recent activity shows timeline entries with patient names
- [ ] Clicking items navigates to correct patient
- [ ] Dashboard loads fast (< 500ms)

---

## Phase 7 — Settings, Export & Multi-User Prep

**Goal:** App preferences, data export, and groundwork for iCloud sync.

### Phase 7A — Settings Page

**File:** `src/routes/settings/+page.svelte` (replace placeholder)

**Settings sections:**

1. **Practice Info** — Practice name, address, phone (stored in a `settings` table)
2. **Appearance** — Dark mode toggle, sidebar collapse preference
3. **Data Management** — Export database, import database, view database location
4. **About** — App version, credits

### Database Migration (version 6)

```sql
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

### Service Layer

Add `src/lib/services/settings.ts`:

```ts
getSetting(key: string) → string | null
setSetting(key: string, value: string) → void
getAllSettings() → Record<string, string>
```

### Phase 7B — Data Export

**Export formats:**
- **SQLite backup** — Copy the entire `dentvault.db` file to a user-chosen location
- **CSV export** — Export patient list as CSV
- **JSON export** — Full data dump (patients + timeline + plans)

Use `@tauri-apps/plugin-dialog` save dialog + `@tauri-apps/plugin-fs` to write files.

### Phase 7C — Dark Mode

**Implementation:**
- Toggle adds/removes `dark` class on `<html>` element
- Already fully supported by the theme CSS in `app.css` (all dark mode variables are defined)
- Persist preference in `settings` table
- Load preference on app start in `+layout.svelte`

### Phase 7D — Multi-User Prep (iCloud Sync)

**Strategy:** The SQLite database file (`dentvault.db`) can be stored in an iCloud-synced folder. This provides basic multi-device support.

**Implementation:**
- Add a setting for "Database location" — default (app data dir) or custom path
- If custom path is set (e.g., `~/Library/Mobile Documents/com~apple~CloudDocs/DentVault/`), the app connects to that database instead
- Update `getDb()` to read the database path from settings
- Add conflict warning: "Only one instance should write at a time"
- This is a simple file-sync approach — not real-time multi-user

### Phase 7 — Verification Checklist

- [ ] Practice info saves and persists
- [ ] Dark mode toggles correctly and persists
- [ ] Can export database as SQLite backup
- [ ] Can export patients as CSV
- [ ] Settings page loads all current values
- [ ] Custom database path works for iCloud folder
- [ ] App version displays correctly

---

## Database Migration Strategy

All migrations live in `src-tauri/src/lib.rs` in the `migrations` vec. They run in order by version number on every app start. The plugin tracks which have been applied.

**Summary of all migrations:**

| Version | Phase | Description |
|---------|-------|-------------|
| 1 | 0 | Create `patients` table |
| 2 | 2 | Create `timeline_entries` table |
| 3 | 3 | Create `treatment_plans` + `treatment_plan_items` tables |
| 4 | 4 | Create `dental_chart` + `clinical_exams` tables |
| 5 | 5 | Create `documents` table |
| 6 | 7 | Create `settings` table |

**Rules:**
- Never modify an existing migration
- Always increment the version number
- Test migrations on a fresh database AND on an existing one
- Keep SQL in the migration compatible with SQLite syntax

---

## Testing Strategy

Since this is a Tauri desktop app, testing is split:

### Manual Testing (primary for now)

Each phase has a verification checklist. Run `npm run tauri dev` and test each item manually.

### Type Checking

```bash
npm run check
```

Run after every phase. Must pass with zero errors.

### Build Verification

```bash
source ~/.cargo/env && npm run tauri build
```

Run after each phase to ensure production build works.

### Future: Automated Tests

When the app matures, consider:
- **Vitest** for unit testing service functions (mock the Tauri SQL plugin)
- **Playwright** for E2E testing (SvelteKit supports this)
- Add test scripts to `package.json`

---

## Development Order & Dependencies

```
Phase 1 (Patient CRUD) ← Foundation for everything
    ↓
Phase 2 (Timeline) ← Needs patients to exist
    ↓
Phase 3 (Treatment Plans) ← Builds on timeline concepts
    ↓
Phase 4 (Dental Chart) ← Independent of 2-3 but needs patients
    ↓
Phase 5 (Documents) ← Needs timeline entries to attach to
    ↓
Phase 6 (Dashboard) ← Needs data from phases 1-5 to display
    ↓
Phase 7 (Settings/Export) ← Can be done anytime but best last
```

**Recommended order:** Do them in sequence (1→2→3→4→5→6→7). Phase 1 is the most critical — everything depends on it.

---

## Quick Reference: Key File Paths

| Purpose | Path |
|---------|------|
| Types | `src/lib/types.ts` |
| DB service | `src/lib/services/db.ts` |
| Utilities | `src/lib/utils.ts` |
| App layout | `src/routes/+layout.svelte` |
| Global CSS | `src/app.css` |
| Rust entry | `src-tauri/src/lib.rs` |
| Tauri config | `src-tauri/tauri.conf.json` |
| Rust deps | `src-tauri/Cargo.toml` |
| Permissions | `src-tauri/capabilities/default.json` |
| shadcn config | `components.json` |
| Package config | `package.json` |
| Vite config | `vite.config.ts` |
| Svelte config | `svelte.config.js` |
| TS config | `tsconfig.json` |
