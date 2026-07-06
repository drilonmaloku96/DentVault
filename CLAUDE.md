# DentVault — Project Guide for Claude

## What is DentVault?

A cross-platform desktop dental patient management app for independent practitioners and small clinics.
Built with **Tauri 2 + SvelteKit + Svelte 5 + TypeScript + SQLite + Tailwind CSS v4 + shadcn-svelte**.

**Core principle**: Every piece of clinical data must be structured, tagged, and queryable — not buried in free-text notes. The app's primary long-term value is clinical outcome tracking and statistical analysis.

**Reference docs** (read these when working on specific areas):
- `docs/claude/DATA_INTEGRITY.md` — **MANDATORY before adding/changing any feature**: dataset & evaluation mindset, known mistake patterns (dead pipelines, string-matched queries, notation mixing, enum drift, rate denominators), pre-merge checklist
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
- **Migrations**: append to `SCHEMA_STATEMENTS` array in `src/lib/services/db.ts`, never modify existing ones. Update `LATEST_VERSION` after adding. Current version: **68**. Test every new migration's SQL against a copy of a real vault DB with the `sqlite3` CLI before shipping — SQLite rejects some common syntax (e.g. derived-table column-list aliases `AS t(a,b)`, which made v65 a permanent no-op until fixed).
- **`getDb()` caches the handle only after `runMigrations` succeeds** — never assign `db` before migrations finish. The old order (assign, then migrate) swallowed the first migration error and served the unmigrated DB forever after, silently freezing vaults at an old schema version with no visible error.
- **Tooth notation**: `timeline_entries` + `entry_teeth` store **FDI only** (quadrant/tooth, e.g. 14 = quadrant 1 tooth 4; 11–48 permanent, 51–85 primary — no Universal numbers; v66 migration normalized legacy rows). `dental_chart`, plan, and probing tables store **Universal 1–32** internally. `toFDI()` for display. `isValidEntryTooth()` validates entry teeth (FDI only). Keyword-engine emits FDI.
- **Types**: all interfaces in `src/lib/types.ts`
- **Type check**: `npm run check` must pass with 0 errors after every change
- **`untrack()`**: use in `$state()` initializers when reading props to suppress "captures initial value" warning
- **Svelte 5 deep reactivity**: mutate `$state` object properties directly (`obj[key] = val`, `delete obj[key]`) — do NOT use spread+reassign for per-property updates
- **Dialog width override**: override BOTH `max-w-[Xpx]` AND `sm:max-w-[Xpx]` — shadcn has built-in `sm:max-w-lg` that wins otherwise
- **Large working surfaces go full screen, never in dialogs**: charts, planners, assessments (dental chart, snapshots, ortho, therapy plan, PAR) render in `FullScreenView` (`$lib/components/ui/FullScreenView.svelte`) — a full-window surface with a ← Back header at `z-[45]` (above the fixed timeline bars at z-40, below shadcn dialogs at z-50, so confirms/pickers stack on top). Dialogs are reserved for small forms and confirmations. Never put a wide charting surface in a width-capped popup — and never `overflow-x-hidden` a container holding a fixed-min-width SVG (this clipped half the PAR chart)
- **Opening files externally**: use `invoke('open_file_native', { path })` — do NOT use `openPath` from opener plugin (silently fails)
- **`entry_teeth` sync**: call `syncEntryTeeth(entryId, toothNumbers)` after any insert/update of `timeline_entries` with `tooth_numbers`
- **Data-integrity hard rules** (full list + rationale in `docs/claude/DATA_INTEGRITY.md`): never `LIKE`-match serialized fields — query `entry_teeth`/typed columns; every new DB function needs a caller in the same change; never branch on hardcoded members of user-configurable sets; enum literals must exist in `types.ts`; rates use final outcomes only (`successful/retreated/failed_extracted/failed_other`); `_planned` values never count as performed; SQLite dates use `'localtime'`
- **JSON export**: `downloadJson` from `src/lib/services/export.ts` (CSV helpers `entriesToCSV`/`downloadCSV` were removed with the old clinical filter report — zero callers)

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

Migrations in `SCHEMA_STATEMENTS` in `src/lib/services/db.ts`. **Never modify existing migrations.** `LATEST_VERSION = 68`.

**Key tables:** `patients`, `timeline_entries`, `treatment_plans`, `treatment_plan_items`, `documents`, `dental_chart`, `settings`, `doctors`, `ortho_classifications`, `entry_teeth`, `complications`, `dental_chart_history`, `probing_records`, `probing_measurements`, `probing_tooth_data`, `patient_conditions`, `appointment_rooms`, `appointments`, `schedule_blocks`, `staff_blockouts`, `doctor_working_hours`

**`appointment_types`** has an `icon TEXT NOT NULL DEFAULT ''` column (v64) — emoji displayed in appointment blocks. Joined as `type_icon` on `Appointment`.

**`AppointmentStatus`** is `string` (open type) — built-in values are `scheduled | waiting | in_chair | completed | cancelled | no_show`. Custom statuses are stored in settings key `'appointment_statuses'` via `appointmentStatuses` store.

**v66** — entry teeth are FDI-only: `isValidEntryTooth()` rejects Universal 1–32, the migration converted unambiguous legacy tokens (1–10) to FDI in `timeline_entries.tooth_numbers` + `entry_teeth`, and 11–32 are interpreted as FDI from here on.

**v68 — appointment time tracking**: `appointments` gained `arrival_time`, `treatment_start_time`, `treatment_end_time` (TEXT ISO, all nullable). All three are **first-time-only** — `updateAppointmentStatus` writes them via `CASE WHEN col IS NULL` so a status change never overwrites the first-observed timestamp. Capture points: status → `waiting` sets `arrival_time`; status → `in_chair` sets `arrival_time` + `treatment_start_time`; `syncAppointmentFromTimelineEntry` (fires when a clinical note is saved) sets `treatment_end_time` when `treatment_start_time` is set, and also assigns the entry's `doctor_id` to the appointment if it had none (pass the entry's doctor id as the optional 5th arg). Derived stats: `getPatientAppointmentStats` (patient info page "Appointment Statistics" card) and the doctor KPI functions (see Doctor Performance Analytics). No separate stats table — all metrics derived at query time.

**Status vs type visuals in `AppointmentBlock.svelte` — one signal, one meaning**: the box left border + background tint **always** encode the STATUS color (from the `appointmentStatuses` store), for `scheduled` too — never the type color. The appointment TYPE is shown separately inside the box: full layout renders a type-colored pill (tinted background + border + icon + short name from `type_color`/`type_icon`); compact layout shows the type icon or a type-colored dot next to the name. Do not reintroduce type color into the box border/background — that was ambiguous (color meant "type" when scheduled, "status" otherwise). Additional status elements: corner kuerzel badge (pulsing dot for `waiting`/`in_chair`) and the inline `statusMark()` snippet — radiating `animate-ping` dot for `waiting`/`in_chair`, ✓ for `completed`, ✗ for `no_show`, solid dot for custom statuses, nothing extra for `cancelled` (grayscale + line-through already signal it). Never hardcode status colors.

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

## Cephalyzer Integration (embedded cephalometric analysis)

Full roadmap + status: `ROADMAP_CEPH_INTEGRATION.md`. Cephalyzer stays ONE codebase in
`../Cephalyzer/vite-project` (see its CLAUDE.md); DentVault embeds a **build artifact**.

- **Embed build**: `npm run sync-ceph` (from this repo) builds Cephalyzer with
  `--mode electron` and copies `dist/` → `static/cephalyzer/`. Never edit those files by
  hand; never use Cephalyzer's plain `npm run build` (its `/app/` base breaks the embed).
  Bundle filenames are content-hashed and the iframe cache-busts `index.html` with `?v=` —
  the WKWebView cached the old stable `assets/index.js` URL and kept running stale bundles.
- **Entry flow** (user-chosen design — do NOT add per-card analyze buttons): file rows in
  the sidebar tree (`PatientTreeView`) are click-selectable via `cephSelection.svelte.ts`
  (toggle + highlight); the "Ceph Analysis" button in the TimelineView toolbar (next to
  Chart/Plans/Ortho) activates when the selection is an image or `.ceph` of the open patient
  and navigates to `patients/[patient_id]/ceph?file=<vault-relative-path>`.
- **Ceph route** (`src/routes/patients/[patient_id]/ceph/+page.svelte`): full-window
  `fixed inset-0 z-[45]` iframe, no DentVault header — the Cephalyzer logo is the back
  button (posts `NAVIGATE_BACK`); Escape works on both sides of the boundary. The page
  neutralizes the UI-scale zoom (`documentElement.style.zoom = '1'`) while open and
  restores it on leave — a zoomed root breaks fixed full-window geometry.
- **Bridge protocol** (field names are load-bearing, both sides shipped): parent→iframe
  `LOAD_IMAGE { url, name, patientName }`, `LOAD_CEPH { content, patientName }`,
  `SAVE_CEPH_RESULT` / `SAVE_PDF_RESULT { success, path?, error? }`; iframe→parent
  `CEPH_READY` (posted when its listener mounts — parent must not send `LOAD_*` before it;
  1.2 s post-load timer as fallback), `SAVE_CEPH { content, filename }`,
  `SAVE_PDF { base64, filename }`, `NAVIGATE_BACK`.
- **Image transfer = data: URL, decoded manually.** `read_base64_file` (Rust) → parent
  builds `data:{mime};base64,…` → the iframe decodes with `atob` into a `File`. Do NOT
  "simplify" to `fetch()`: `asset://` URLs are not fetchable cross-scheme from the iframe,
  and WKWebView mangles `fetch(data:)` — both produced "stuck on Loading X-ray".
- **Saving**: dialog asks only `.ceph` / PDF / harmony-box; filename is auto-derived from
  the X-ray's basename (no prompt). `write_text_file` / `write_base64_file` write both next
  to the source X-ray; the parent replies `*_RESULT` and the iframe posts `NAVIGATE_BACK`
  → back to the patient timeline. A sibling `{basename}.ceph` auto-reopens on the next
  Analyze click (`LOAD_CEPH` instead of `LOAD_IMAGE`) — this is why the filename must
  mirror the X-ray's.
- **Rust commands**: `read_text_file`, `read_base64_file`, `write_base64_file` (uses the
  `base64` crate). i18n block: `ceph.*`.
- **Not done yet (Phase 1 of the roadmap)**: saved `.ceph`/PDFs are untracked vault files —
  no `ceph_analysis` timeline entry, no `documents` row, not in the HTML export.
- **Dev ports**: 5173 belongs to this app's Tauri `devUrl` (strictPort); Cephalyzer's dev
  server is pinned to 5175; automated browser tests run a second instance via
  `npm run dev -- --port 4998`. Never kill vite processes broadly — a dead 5173 server
  leaves a running window that 500s on every lazily-loaded route.

---

## Sidebar Navigation

Left sidebar (`src/routes/+layout.svelte`): `{#each primaryNav}` rows with icon + label — Dashboard / Patients / Schedule / Reports, then Settings after a hairline divider (`border-t border-sidebar-border/60`). Active state: left accent bar + `bg-sidebar-accent`. `{@const}` tags must be INSIDE `{#each}` blocks — for the Settings link (outside loop), use inline expressions directly.

**PAR is archived for v1** — parked, not fixed. `components/par/`, `par_*` DB tables/functions, and `par_step` timeline rendering in `TimelineView.svelte` are untouched — only the dead `ParCaseView` import/`showPar` state on the patient page were removed (the entry point was already unwired). Known bug: case-completion never sets `ParStatus: 'ended'` so `lockParCaseAssessments()` never engages — fix when un-archiving.

**Reports is no longer archived** — `/reports` is now the Doctor Performance Analytics dashboard (nav link restored). The old clinical filter report and its dead code (`getFilteredEntries`, `getFilteredSummary`, `ReportFilters`, `ReportEntry`, `entriesToCSV`, `downloadCSV`) were deleted.

## Doctor Performance Analytics

The `/reports` route is a doctor performance dashboard. Data sources in `db.ts`:

| Function | Returns | Purpose |
|----------|---------|---------|
| `getAllDoctorKPIs(dateFrom, dateTo)` | `DoctorPerformanceKPI[]` | All-doctors comparison table |
| `getDoctorPerformanceKPI(doctorId, from, to)` | `DoctorPerformanceKPI \| null` | Single-doctor KPI cards |
| `getDoctorMonthlyTrend(doctorId, from, to)` | `DoctorMonthlyTrend[]` | `strftime('%Y-%m')` GROUP BY month |
| `getDoctorDowDistribution(doctorId, from, to)` | `DoctorDowStat[]` | Weekday distribution, excludes cancelled/no_show |
| `getDoctorTreatmentStats(doctorId, from, to)` | `DoctorTreatmentStat[]` | Per-type planned vs actual duration (needs `treatment_end_time`) |

Page (`src/routes/reports/+page.svelte`): doctor selector (all or single), date range + quick presets (this month / last 3 months / this year). All-doctors view = comparison table with clickable drill-down; single-doctor view = 4 KPI cards + secondary strip + monthly trend bars + Mon-first day-of-week bars (`[1,2,3,4,5,6,0]` with Sun-first `defaults.dayAbbrevs`) + treatment-type dual-bar list. All charts CSS-only, no library. Actual-duration KPIs stay `—` (NULL) until appointments run through the waiting → in_chair → clinical-note flow. i18n block: `reports.performance.*` (the dashboard-independent `reports.columns.*` block is still used by the dashboard page).

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

### Floating patient panels
Acute Problems, Medical History, and Notes render as **`FloatingPanel`** instances on the patient page (`src/lib/components/ui/FloatingPanel.svelte`) — draggable, resizable floating windows with no backdrop. Positions staggered at `(panelBaseX, 90)`, `(panelBaseX+40, 130)`, `(panelBaseX+80, 170)` where `panelBaseX = Math.max(20, floor(innerWidth/2) − 210)`.

`FloatingPanel` internals: drag via pointer events + `setPointerCapture` on the title bar; resize via CSS `resize: both`; a `ResizeObserver` reads `offsetWidth/offsetHeight` back into `$state` on every resize — required because CSS resize writes inline style that Svelte's reactive style binding would otherwise overwrite on re-render, snapping the panel back. Dims to 40% opacity on document `wheel` (capture) or outside `mousedown`; `onmouseenter` restores. `initialX`/`initialY` must be read through `untrack()` in the `$state()` initializers.

**Panel content scaling**: box components inside `FloatingPanel` use `h-full flex flex-col` on the outer div and `flex-1 min-h-[...] resize-none` on the textarea so content fills the resizable panel and scrolls internally. The old JS `autoResize()` (textarea auto-grow) was removed from the boxes — do not reintroduce it; it fights flex sizing.

### OS file drag-and-drop → VaultDropDialog
Files enter the timeline **exclusively** via OS drag-and-drop. The automatic vault-scan system (`NewFilesDialog`, `checkNewVaultFiles`, `scanVaultForUntrackedFiles`, `getTrackedFilePaths`, the amber "files found in vault" banner) is fully removed — **do not re-implement it**.

- **Tauri WKWebView rule**: `dataTransfer.files` is always empty — Tauri intercepts OS drops natively. `TimelineView.svelte` listens to `tauri://drag-enter` / `drag-leave` / `drag-drop` (from `@tauri-apps/api/event`) in `onMount` (with unlisten cleanup) and opens `VaultDropDialog` with `event.payload.paths`.
- **`VaultDropDialog.svelte`** (`src/lib/components/timeline/`): folder-tree picker (Rust `list_patient_folders`), inline subfolder creation (`create_patient_subfolder`), pointer-based drag-to-reorganize of folders (`move_patient_folder`). Saving copies each file via `copy_file_to_vault`, then `insertDocument` + a `document` timeline entry.
- **Vault-relative paths**: `rel_path` in `documents` and `path` in the `attachments` JSON must be relative to **vault root** — `{patientFolder}/{selectedFolder}/{filename}` — so `toAbsPath(relPath, vault.path)` resolves thumbnails correctly.
- **Folder drag targets**: `data-folder-rel` attributes mark drop targets for `elementsFromPoint`; empty string `""` is the valid patient-root target, so destination checks must use `dest === null`, never `!dest`.
- **Never use HTML5 `draggable="true"`** for in-app drags — it fires `tauri://drag-enter` and confuses the OS-drop overlay. Use pointer events + `setPointerCapture`.
- i18n block: `timeline.vaultDrop.*`.

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
- [x] v1 release audit — patients/schedule bug-fix pass; Reports & PAR archived (nav removed, code/data intact); provider success-rate denominator fixed to final outcomes only; complications recording UI built; vault integrity check surfaced in Settings; v67 migration folds legacy tables (`patient_note_entries`, `medical_entries`, `acute_problems`, `clinical_exams`, `ortho_assessments`) into current structures, then their dead CRUD deleted; document metadata editing; Patients nav item added; HTML export gained an appointments/visit-history section; verified zero-caller dead code removed from `db.ts`/`files.ts`/`utils.ts`
- [x] Symbiosis feature port — appointment time tracking (v68: arrival/treatment start/end timestamps, first-time-only capture); Doctor Performance Analytics dashboard replaces the archived clinical report at `/reports` (nav restored); patient info "Appointment Statistics" card; floating patient panels (`FloatingPanel.svelte` — Acute/Medical/Notes as draggable resizable windows, backdrop modals removed); OS drag-and-drop file ingestion (`VaultDropDialog` + Rust folder-tree commands); NewFilesDialog vault-scan system fully removed
- [x] Cephalyzer integration core flow (July 2026) — embedded analyzer at `patients/[patient_id]/ceph` with postMessage bridge, sidebar file selection + toolbar "Ceph Analysis" button, save-to-vault next to the X-ray, sibling-`.ceph` auto-reopen (see "Cephalyzer Integration" section + `ROADMAP_CEPH_INTEGRATION.md`; Phase 1 timeline/export integration still open)

---

## What to Build Next

**Ceph Phase 1** (`ROADMAP_CEPH_INTEGRATION.md`): `ceph_analysis` timeline entries on `SAVE_CEPH` (measurements in `chart_data`), `CephSnapshotCard`, register PDFs in `documents`, `renderCeph()` in the HTML export

**Phase 7:** Multi-user roles — map `doctors` table to login/session concept

**Phase 8:** Recall / reminder system (only the v54 `recall_due` column exists so far) · Schedule nav item in Settings to add appointment statuses section link · ~~Week/month schedule views~~ — evaluated and dropped as not useful in a clinic context

**Clinical:** Keyword mappings user-configurable in Settings (`keyword-engine.ts` done, needs UI) · Cost/Billing module (deferred) · Time-series outcome survival curves · Cohort comparison

**Phase 10:** Legacy KIG `OrthoSnapshotCard` — consider a "Recorded under legacy KIG system" note instead of insurance badge (low priority)
