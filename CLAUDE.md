# DentVault — Project Guide for Claude

## What is DentVault?

A cross-platform desktop dental patient management app for independent practitioners and small clinics.
Built with **Tauri 2 + SvelteKit + Svelte 5 + TypeScript + SQLite + Tailwind CSS v4 + shadcn-svelte**.

**Core principle**: Every piece of clinical data must be structured, tagged, and queryable — not buried in free-text notes. The app's primary long-term value is clinical outcome tracking and statistical analysis.

**Reference docs** (read these when working on specific areas):
- `docs/claude/CLINICAL.md` — treatment taxonomy, outcomes, ortho classification, keyword detection
- `docs/claude/DB_SCHEMA.md` — full schema tables (v1–v65), all DB function signatures
- `docs/claude/DENTAL_CHART.md` — watch status, root canals, crown findings, bridge/prosthesis, surface picker
- `docs/claude/TIMELINE.md` — timeline entries, rich text editor, ortho snapshots, plan indicators
- `docs/claude/SCHEDULE.md` — calendar pointer system, appointment & block interactions
- `docs/claude/FEATURES.md` — vault/files, settings page, customizable systems, patient form

---

## Technical Conventions

- **Svelte 5 runes**: `$state()`, `$derived()`, `$effect()`, `$props()`
- **Snippet slots**: `{@render children()}`
- **Tailwind v4**: `@theme inline` blocks in `src/app.css`, no `tailwind.config.js`
- **Colors**: oklch CSS custom properties in `src/app.css`
- **shadcn-svelte**: components at `$lib/components/ui/`, install with `npx shadcn-svelte@1.1.1 add <name> -y`
- **DB access**: exclusively through `src/lib/services/db.ts`, positional `$1, $2` params
- **Migrations**: append to `SCHEMA_STATEMENTS` array in `src/lib/services/db.ts`, never modify existing ones. Update `LATEST_VERSION` after adding. Current version: **65**.
- **Tooth notation**: `timeline_entries` + `entry_teeth` store **FDI** (11–48 permanent, 51–85 primary). `dental_chart`, plan, and probing tables store **Universal 1–32**. `toFDI()` for display. `isValidEntryTooth()` validates entry teeth. Keyword-engine emits FDI.
- **Types**: all interfaces in `src/lib/types.ts`
- **Type check**: `npm run check` must pass with 0 errors after every change
- **`untrack()`**: use in `$state()` initializers when reading props to suppress "captures initial value" warning
- **Svelte 5 deep reactivity**: mutate `$state` object properties directly (`obj[key] = val`, `delete obj[key]`) — do NOT use spread+reassign for per-property updates
- **Dialog width override**: override BOTH `max-w-[Xpx]` AND `sm:max-w-[Xpx]` — shadcn has built-in `sm:max-w-lg` that wins otherwise
- **Opening files externally**: use `invoke('open_file_native', { path })` — do NOT use `openPath` from opener plugin (silently fails)
- **`entry_teeth` sync**: call `syncEntryTeeth(entryId, toothNumbers)` after any insert/update of `timeline_entries` with `tooth_numbers`
- **CSV/JSON export**: `entriesToCSV` + `downloadCSV`, `downloadJson` from `src/lib/services/export.ts`

### Fixed UI bars

`position: sticky` inside a `flex-col` that's inside the layout's `h-full` wrapper fails at the bottom of long content — use `fixed` instead.

Both persistent bars use the same pattern (`left-56 right-0` = sidebar width offset):
- **Bottom bar** (`TimelineEntryBar`): `fixed bottom-0 left-56 right-0 z-40`
- **Top toolbar** (`TimelineView` filter/search bar): `fixed left-56 right-0 z-10`, `top` set via inline `style="top: {headerHeight}px"` prop

The patient page (`+page.svelte`) measures the sticky patient header's actual rendered height with a `ResizeObserver` and passes it as `headerHeight` to `TimelineView`. This keeps the toolbar correctly positioned below the patient header at all window widths, even when the header wraps at narrow sizes.

**Minimum window size**: `820 × 560 px` (set in `src-tauri/tauri.conf.json`). Design and test all fixed/sticky UI at this width. Content area at min-width = `820 − 224 (sidebar) − 48 (p-6 × 2) = 548 px`.

---

## Patient Export — Mandatory Compatibility Rule

**Any feature that adds data to a patient's record must be reflected in the HTML export.**

Export lives in `src/lib/services/patient-export.ts` → `PatientExportDialog.svelte`.

```
gatherExportData()        ← all DB queries; returns PatientExportData
generatePatientHTML()     ← assembles sections into full HTML document
  renderCover / renderDemographics / renderMedical / renderOrtho
  renderChart / renderTimeline / renderPerio / renderPlans / renderDocuments
exportPatient()           ← orchestrator: gather → render → copy files → write HTML
```

**Section toggles**: `demographics`, `medical`, `notes`, `ortho`, `chart`, `timeline`, `perio`, `plans`, `documents`. Medical section also exports acute/medical clinical tags; perio exports recession (`pd/rec`), mobility, furcation.

### Rules
1. New patient data source → add to `gatherExportData()` + `PatientExportData`
2. New timeline entry type → `renderTimeline()` must handle it
3. New dialog/section → add `render*()` function; include in `generatePatientHTML()`
4. New fields on existing table → update relevant `render*()` function
5. No silent omissions — if a field exists in the UI it must appear in the export

### Checklist
- [ ] New data in `gatherExportData()`?
- [ ] Rendered in `render*()` section?
- [ ] HTML output correct?
- [ ] `npm run check` passes 0 errors?

---

## Language (English-only)

**`de.ts` deleted — English only.** `LangCode = 'en'`, no language switching.

Files: `src/lib/i18n/types.ts` (source of truth) + `en.ts` + `index.svelte.ts` + `index.ts`.
Usage: `import { i18n } from '$lib/i18n'` → `{i18n.t.nav.patients}`

### Rules
1. Add keys to `types.ts` first — TS errors catch missing keys in `en.ts`
2. Add to `en.ts` only — do not recreate `de.ts`
3. No hardcoded UI strings — use `i18n.t.*` (exceptions: console logs, DB column names, code constants)
4. User-configurable defaults → `{ key, label? }[]` pattern; built-in keys resolve via `i18n.t.defaults.*`
5. Parameterized strings: `.replace('{n}', String(value))`

### Checklist
- [ ] Keys in `types.ts` and `en.ts`
- [ ] Component uses `i18n.t.*`
- [ ] `npm run check` passes 0 errors

---

## Customizability First

Before hard-coding anything, ask: "Could this be user-configurable?"

Store config in `settings` table via `getSetting()` / `setSetting()`. Use reactive `.svelte.ts` stores. See `docs/claude/FEATURES.md` for the full list of already-configurable systems.

### Rules
1. Present configurable option before coding
2. Store in `settings` table
3. Use module-level `.svelte.ts` store as single source of truth
4. Never lock users in — every category/type/label/folder must support additions/edits/deletions via Settings
5. Filter dropdowns, badges, pills must be `$derived` from the relevant store

### Checklist
- [ ] Labels/categories/types hard-coded that user might want to change?
- [ ] Stored in `settings` table and managed in Settings?
- [ ] `.svelte.ts` store as single source of truth?
- [ ] UI elements derive reactively from store?
- [ ] Users can add entries without a code change?

---

## Data Model

Migrations in `SCHEMA_STATEMENTS` in `src/lib/services/db.ts`. **Never modify existing migrations.** `LATEST_VERSION = 65`.

**Key tables:** `patients`, `timeline_entries`, `treatment_plans`, `treatment_plan_items`, `documents`, `dental_chart`, `settings`, `doctors`, `ortho_classifications`, `entry_teeth`, `complications`, `dental_chart_history`, `probing_records`, `probing_measurements`, `probing_tooth_data`, `patient_conditions`, `appointment_rooms`, `appointments`, `schedule_blocks`, `staff_blockouts`, `doctor_working_hours`

**`appointment_types`** has an `icon TEXT NOT NULL DEFAULT ''` column (v64) — emoji displayed in appointment blocks. Joined as `type_icon` on `Appointment`.

**`AppointmentStatus`** is `string` (open type) — built-in values are `scheduled | waiting | in_chair | completed | cancelled | no_show`. Custom statuses are stored in settings key `'appointment_statuses'` via `appointmentStatuses` store.

See `docs/claude/DB_SCHEMA.md` for full per-version descriptions and all DB function signatures.

---

## Vault Storage Structure

```
{vault_folder}/
  dentvault.db              ← SQLite: all patients, timeline, chart, AND all settings
  audit.jsonl               ← immutable append-only audit trail
  !TEMPLATE/                ← patient file templates (sorts to top; always present)
  !Documents/               ← reusable document templates (PDFs, Word files, etc.)
  {Lastname_Firstname_ID}/  ← one folder per patient
    xrays/ photos/ documents/ lab_results/ consents/ referrals/
```

Vault folder location stored in `{app_data_dir}/vault_path.txt`. **Full backup = copy the vault folder.**

---

## Sidebar Navigation

Left sidebar (`src/routes/+layout.svelte`): `{#each primaryNav}` rows with icon + label. Settings after hairline divider (`border-t border-sidebar-border/60`). Active state: left accent bar + `bg-sidebar-accent`. `{@const}` tags must be INSIDE `{#each}` blocks — for the Settings link (outside loop), use inline expressions directly.

## Settings Page Navigation

`src/routes/settings/+page.svelte` uses a single `activeSection` string to switch between sections (`'home'`, `'general'`, `'team'`, `'schedule'`, `'clinical'`, `'documents'`, `'patients'`).

- **No inner sidebar** — the secondary nav panel was removed. On `activeSection === 'home'` the full-width overview grid is shown. On any sub-section, a `← Settings` back button appears at the top of the content area (plus a patient link if coming from a patient page).
- **Staff working hours on add** — `openAddStaff()` initialises `newStaffHours` from the clinic-wide `workingHours.hours` defaults. The add-staff form includes an inline hours table the user can adjust before saving. `handleAddStaff()` calls `upsertDoctorWorkingHours` immediately after creating the doctor record.
- **v65 migration** backfills default working hours (Mon–Fri 08:00–18:00, Sat 08:00–13:00, Sun off) for any doctor who had no rows in `doctor_working_hours` yet.

---

## Timeline — Key Architecture Notes

### Filter system
`TimelineView.svelte` derives `availableTypes` from the patient's actual `entries` array — only types that exist, with counts. No static category buckets. Active filters stored in `typeFilters: Set<string>` containing raw `entry_type` values.

`typeLabel(key)` maps entry_type values to display labels:
- `''` → "Unclassified", `'document'` → "Documents", `'chart_snapshot'` → "Chart Snapshots", `'ortho_snapshot'` → "Ortho Records", `'plan'` → "Treatment Plans", anything else → `entryTypes.labelFor(key)` (handles legacy keys + current appointment type names).

When `typeFilters.size > 1`, the filter button shows a compact `N types` badge instead of all labels, to stay within the toolbar's available width.

### Timeline entry bar
No title field — `autoTitle(bodyText, date)` always generates the title on save. Triggers: `/` for text blocks, `@` for staff mentions, `d15`-style for teeth. No `#` trigger in the bar (conditions are tagged in the Acute/Medical boxes instead).

### Acute Problems & Medical History boxes
Both boxes (`AcuteProblemsBox.svelte`, `MedicalHistoryBox.svelte`) support `#word` typing in their textarea to trigger an inline condition autocomplete palette. Selecting a condition: activates the tag + replaces `#query` with `#Label` in the textarea. Creating a new condition: adds it to the `acuteTagOptions`/`medicalTagOptions` store. Active tags shown as removable colored pills below the textarea. The `#` hint is in the textarea placeholder text (second line). No separate "add condition" button.

- **Do not toggle-remove a tag when the user selects it from the palette** — `selectCondition` checks `!activeTags.includes(tag.key)` before calling `toggleTag`.
- Suggestion list renders in **normal document flow** (not `position: absolute`) — the outer box has `overflow-hidden` so it clips content, not the inline palette.

---

## Build Phases Status

- [x] Phase 0–6g — Scaffolding through Rich text / UX polish
- [x] Phase 7 (partial) — Backup & Export
- [x] Phase 8 / 8b / 8c (partial) — Appointment Scheduling + Block drag/resize
- [x] Phase 9 / 9b / 9c (partial) — Dashboard Analytics Overhaul
- [x] Phase 10 (partial) — IOTN Ortho rebuild, plan timeline indicators, PAR removal
- [x] i18n full audit — all hardcoded German strings replaced with `i18n.t.*`
- [x] Schedule UX — appointment status workflow (right-click menu), configurable statuses store, appointment type icons, date-grouped timeline
- [x] Timeline UX polish — removed title field, English default text blocks, dynamic per-patient type filters with counts, fixed toolbar (ResizeObserver-tracked top offset), condition tagging via `#` in Acute/Medical boxes
- [x] Settings UX — inner sidebar removed; back button on sub-pages; staff add form includes inline working hours editor seeded from clinic defaults (v65 migration backfills existing staff)

---

## What to Build Next

**Phase 7:** Multi-user roles — map `doctors` table to login/session concept

**Phase 8:** Recall / reminder system · Week/month schedule views · Schedule nav item in Settings to add appointment statuses section link

**Phase 9:** Drill-down on heatmap / day chart · Dashboard date range override · Time-series trend sparklines · Reports page re-integration (route `/reports` exists, nav link removed)

**Clinical:** Keyword mappings user-configurable in Settings (`keyword-engine.ts` done, needs UI) · Cost/Billing module (deferred) · Time-series outcome survival curves · Cohort comparison

**Phase 10:** Legacy KIG `OrthoSnapshotCard` — consider a "Recorded under legacy KIG system" note instead of insurance badge (low priority)
