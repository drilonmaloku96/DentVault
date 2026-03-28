# DentVault — Project Guide for Claude

## What is DentVault?

A cross-platform desktop dental patient management app for independent practitioners and small clinics.
Built with **Tauri 2 + SvelteKit + Svelte 5 + TypeScript + SQLite + Tailwind CSS v4 + shadcn-svelte**.

**Core principle**: Every piece of clinical data must be structured, tagged, and queryable — not buried in free-text notes. The app's primary long-term value is clinical outcome tracking and statistical analysis across the patient population.

**Detailed reference docs** (read these when working on specific areas):
- `docs/claude/CLINICAL.md` — treatment taxonomy, outcomes, ortho classification, keyword detection
- `docs/claude/DB_SCHEMA.md` — full schema tables (v1–v36), all DB functions, filter types
- `docs/claude/DENTAL_CHART.md` — dental chart + perio chart + bridge/prosthesis + audit log
- `docs/claude/FEATURES.md` — onboarding wizard, sidebar file tree, vault path change, CI build

---

## Technical Conventions (Quick Reference)

- **Svelte 5 runes**: `$state()`, `$derived()`, `$effect()`, `$props()`
- **Snippet slots**: `{@render children()}`
- **Tailwind v4**: `@theme inline` blocks in `src/app.css`, no `tailwind.config.js`
- **Colors**: oklch CSS custom properties in `src/app.css`
- **shadcn-svelte**: components at `$lib/components/ui/`, install with `npx shadcn-svelte@1.1.1 add <name> -y`
- **DB access**: exclusively through `src/lib/services/db.ts`, positional `$1, $2` params
- **Migrations**: append to `SCHEMA_STATEMENTS` array in `src/lib/services/db.ts`, never modify existing ones. Update `LATEST_VERSION` constant after adding. Current version: **41**.
- **Types**: all interfaces in `src/lib/types.ts`
- **Type check**: `npm run check` must pass with 0 errors after every change
- **`untrack()`**: use in `$state()` initializers when reading props to suppress "captures initial value" warning
- **Svelte 5 deep reactivity**: mutate `$state` object properties directly (`obj[key] = val`, `delete obj[key]`) — do NOT use spread+reassign (`obj = { ...obj }`) for per-property updates
- **Dialog width override**: shadcn DialogContent has a built-in `sm:max-w-lg`; to widen a dialog override BOTH `max-w-[Xpx]` AND `sm:max-w-[Xpx]` in the `class` prop, otherwise the responsive variant wins
- **Opening files externally**: do NOT use `openPath` from `@tauri-apps/plugin-opener` — it silently fails. Use `invoke('open_file_native', { path })` in `src/lib/services/files.ts`.
- **Timeline polling (silent refresh)**: only show the loading skeleton when `entries.length === 0` (first load). Background polling must NOT set `isLoading = true` when entries already exist.
- **Scroll to revealed element after image expand**: call `scrollIntoView` AFTER awaiting the image `load` event. Pattern: `if (!img.complete) await new Promise(r => img.addEventListener('load', r, { once: true }))` before measuring.
- **`provider` field deprecated**: free-text `provider` column no longer shown in UI. Use `doctor_id` + `colleague_ids`. Legacy `provider` shown with "(legacy)" label in expanded entry view only.
- **`TimelineEntryType` is now `string`**: loosened from strict union. `SYSTEM_ENTRY_TYPES = new Set(['document', 'plan', 'chart_snapshot', 'ortho_snapshot'])` identifies system-only types. Legacy strings ('visit', 'procedure', etc.) via `LEGACY_LABELS` in `entryTypes.svelte.ts`.
- **Timeline filter bar**: "Filter by" dropdown button (searchable, checkboxed types + doctors, grouped) + free-text/date search input (`searchQuery`). State: `activeFilters: Set<string>`, `activeDoctorId: number | null`, `filterDropdownOpen`, `filterSearch`, `searchQuery`.
- **`entry_teeth` sync**: whenever inserting/updating `timeline_entries` with `tooth_numbers`, call `syncEntryTeeth(entryId, toothNumbers)`.
- **CSV export**: `entriesToCSV(entries)` + `downloadCSV(csv, filename)` from `src/lib/services/export.ts`.
- **JSON export**: `downloadJson(obj, filename)` from `src/lib/services/export.ts`.
- **Settings export/import**: `getAllSettings()` / `bulkSetSettings(entries)` in `db.ts`. Export: `{ version, exportedAt, app, settings[] }`. Import: validate → confirm dialog → `bulkSetSettings` → reload.
- **Database backup**: Rust command `backup_database(vault_path, dest_path)` copies `dentvault.db`.
- **Vault backup**: Rust command `backup_vault_to(vault_path, dest_dir)` copies entire vault to `{dest_dir}/DentVault-Backup-{YYYY-MM-DD}/`.
- **Vault existence check on startup**: `vault.init()` calls `file_exists` Rust command. If folder gone, `_vaultPath = null`, `isConfigured = false` → triggers onboarding wizard.
- **`!TEMPLATE` folder**: Special vault-root folder. Created/synced by `ensure_template_structure(vault_path, category_folders)` Rust command — this command **also always creates `!Documents/`** in the same call. Files copied to every new patient via `copy_template_to_patient`. Copied files pre-registered in `documents` table on patient create to suppress untracked-files banner.
- **`!Documents` folder**: Second vault-root special folder for reusable document templates (PDFs, Word files, etc.). Created atomically alongside `!TEMPLATE` by `ensure_template_structure`. Rust commands: `ensure_doc_templates_folder`, `list_doc_templates`, `save_doc_template`, `copy_doc_template_to_patient`, `delete_doc_template`. TS wrappers in `src/lib/services/files.ts` (`DOC_TEMPLATES_FOLDER = '!Documents'`). Shown in Settings → Clinical → Document Categories with file list and Finder button. In patient timeline toolbar: teal "+ Template" button opens `DocTemplatePickerDialog` which copies a template into the patient folder and registers it as a `document` timeline entry.
- **Delete patient folder**: `delete_patient_folder(vault_path, patient_folder)` Rust command — called automatically when deleting patients from Settings → Patient Management.
- **Patient search multi-word**: `searchPatients` matches `firstname || ' ' || lastname`, `lastname || ' ' || firstname`, `lastname || ', ' || firstname` — so "Max Muster", "Muster Max", "Muster, Max" all work.
- **BookingPanel keyboard navigation**: ↑↓ arrows + Enter to select + Escape to close. `highlightedIndex` + `data-idx` + `scrollIntoView` pattern.
- **Rich text in timeline entries**: `description` stores raw HTML. Both `TimelineEntryBar.svelte` and `TimelineEntryForm.svelte` use `contenteditable="true"` with `bind:innerHTML`. Card display uses `{@html}`. Shortcuts: Cmd/Ctrl+B/I/U. Toolbar buttons use `onmousedown` + `e.preventDefault()`. Selection API via TreeWalker for `@` mention and `/` text block detection.
- **Sticky patient header**: `sticky top-0 z-20` in `src/routes/patients/[patient_id]/+page.svelte`, height ≈ 76px. Uses `-mx-6 -mt-6 px-6 pt-6` to flush to scroll container edges. Timeline toolbar sticky at **`top-[76px]`** (`z-10`).
- **Extended patient data model**: v31 adds 10 columns: `address`, `city`, `postal_code`, `country`, `emergency_contact_name/phone/relation`, `blood_group`, `primary_physician`, `marital_status`. `PatientStatus` includes `'deceased'`. `PatientForm` has 7 sections.
- **Settings page — two-panel layout**: fixed left `<nav>` (208px, `w-52 shrink-0`) + scrollable right content. Outer wrapper `class="flex h-full overflow-hidden -m-6"`. `activeSection` (`$state<string>`, default `'general'`). Six nav items (flat, no sub-groups): `general` (language + appearance + vault + backup + about), `team` (staff + working hours), `clinical` (doc categories + clinical tags + complications + text blocks), `chart` (tags + prosthesis + bridge), `schedule` (rooms + appointment types), `patients` (management + export). Each page is one long scrollable view with `<Separator />` dividers between sub-sections.
- **Settings scroll position memory**: `navigateTo(key)` saves `contentEl.scrollTop` into plain `Record<string, number>` before switching, restores via `tick().then(...)`. Plain object — not `$state`.
- **Timeline toolbar — upload and plan buttons removed**: "Dokumente hochladen" and "Neuer Plan" buttons and all associated state/handlers removed from `TimelineView.svelte`.
- **Timeline polling anti-flicker**: `loadEntries` compares `JSON.stringify(freshEntries)` against current state before reassigning — avoids full re-render when data is unchanged on background poll.
- **`ortho_snapshot` timeline entries**: Ortho assessments are saved as `entry_type: 'ortho_snapshot'` timeline entries (not in `ortho_assessments` table). Same-date dedup: delete existing `ortho_snapshot` for the same date before inserting new one. Stored payload in `chart_data` JSON. Past entries are read-only (`is_locked: 1`). Rendered by `OrthoSnapshotCard.svelte`. Export reads them from timeline entries, not the DB table.
- **Document Categories settings UX**: The category table/card is visually framed as the `!TEMPLATE/` folder (amber header, folder icon). Each category row = one subfolder on disk. An `!Documents/` card below shows that folder's file list with type icons, KB sizes, and open-file buttons.
- **Timeline entry bar — Enter key submits**: plain Enter in description `contenteditable` submits. Shift+Enter inserts newline. Guard: `e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey`. **Critical**: always check `showMentionPalette || showPalette` before submitting — `bind:this` on conditionally-rendered palette components (`{#if showMentionPalette}`) can be null briefly while Svelte mounts them, causing `mentionPaletteRef?.handleKeydown(e)` to return `undefined` and fall through to `handleSubmit`. Both `TimelineEntryBar.svelte` and `TimelineEntryForm.svelte` have an explicit guard: `if (e.key === 'Enter' && (showMentionPalette || showPalette)) { e.preventDefault(); return; }` placed before the submit handler.
- **`@` mention → auto-removes `@` from editor**: `insertMention` calls `document.execCommand('insertText', false, '')` to delete the `@query` text — the doctor is added as a tag only, not inline in the description. Same pattern in both `TimelineEntryBar.svelte` (`insertMention`) and `TimelineEntryForm.svelte` (`insertMentionInForm`).
- **`TimelineEntryCard.svelte` — flat visual style**: Clinical entries use a borderless/card-free layout matching `ChartSnapshotCard`. Title row: type icon + bold title + category/outcome badges + muted date + 3-dot menu. Meta row: doctor dot + name, colleague colored pill badges. Description: `font-mono text-[13px] text-muted-foreground/80 leading-relaxed` with show-more/less at 350 chars. Actions: subtle text links (Edit, History). `descExpanded` state + `descIsLong` derived from `entry.description.length > 350`.
- **`+ Template` button removed** from timeline toolbar (`TimelineView.svelte`). `DocTemplatePickerDialog` component and `showDocTemplatePicker` state remain in file but button is gone.
- **Schedule calendar pointer system**: All calendar interactions (slot drag-create, appointment drag/resize, block drag/resize) are handled exclusively via `onGridPointerDown` / `onGridPointerMove` / `onGridPointerUp` on the grid container with `setPointerCapture`. Never add standalone `onclick` to appointment or block wrappers for interaction logic — it bypasses the pointer capture system.
- **Appointment interactions**: Single click → selects (shows ring, enables drag-move + edge-resize). Double click → opens `BookingPanel` edit dialog. Detection via `data-appt-id` on wrapper div and `data-appt-handle="top|bottom"` on resize handles inside `AppointmentBlock.svelte`. Quick-update callback: `onAppointmentQuickUpdate(id, startTime, endTime, durationMin, roomId)`.
- **Schedule block interactions**: Identical pattern to appointments. Single click → selects (shows ring, enables drag-move + edge-resize). Double click → opens `ScheduleBlockEditDialog`. Detection via `data-block-id` on wrapper div and `data-block-handle="top|bottom"` on resize handles inside `ScheduleBlockCell.svelte`. Quick-update callback: `onBlockQuickUpdate(id, startTime, endTime, roomId)`. Block drag state mirrors appointment drag state (prefix `block*` vs `appt*`).
- **`ScheduleBlockCell.svelte`**: Accepts `isSelected?: boolean` prop — shows color ring. Has `data-block-handle="top"` and `data-block-handle="bottom"` resize handle divs. No `onclick` prop — parent wrapper handles all pointer events.
- **Deselect on empty click**: Clicking empty calendar area (slot drag path with no movement) clears both `selectedApptId` and `selectedBlockId`.

---

## Patient Export — Mandatory Compatibility Rule

**Any feature that adds data to a patient's record must be reflected in the HTML export.**

The export lives in `src/lib/services/patient-export.ts`. It produces a self-contained HTML report (`Patient-Report.html`) with asset folder, opened from `PatientExportDialog.svelte`.

### Architecture

```
gatherExportData()        ← all DB queries; returns PatientExportData
generatePatientHTML()     ← assembles sections into full HTML document
  renderCover()
  renderDemographics()    ← Patient, insurance, emergency contact
  renderMedical()         ← conditions, allergies, meds, acute/medical/misc text
                             acute + anamnese always included; misc notes optional (sections.notes)
  renderOrtho()           ← OrthoClassification (legacy) + ortho_snapshot timeline entries
  renderChart()           ← dental chart SVG + text summary
  renderTimeline()        ← all timeline entries, chart snapshots, complications, images
  renderPerio()           ← probing records per tooth
  renderPlans()           ← treatment plans + items
  renderDocuments()       ← file index table
exportPatient()           ← orchestrator: gather → render → copy files → write HTML
```

**Export section toggles** (`PatientExportOptions.sections`): `demographics`, `medical`, `notes` (Notizen only — acute/anamnese always export), `ortho`, `chart`, `timeline`, `perio`, `plans`, `documents`.

### Rules for new features

1. **New patient data source** → add query to `gatherExportData()` and field to `PatientExportData`
2. **New timeline entry type** → `renderTimeline()` must handle it (or falls through to generic entry renderer)
3. **New dialog/section** → add a `render*()` function; include it in `generatePatientHTML()`
4. **New fields on existing table** → update the relevant `render*()` function to include them
5. **No silent omissions** — if a field exists in the UI it must appear in the export (or be explicitly excluded with a comment explaining why)

### Checklist for new patient-facing features

- [ ] Is the new data gathered in `gatherExportData()`?
- [ ] Is it rendered in the relevant `render*()` section?
- [ ] Does the output look correct in the HTML report (open in browser to verify)?
- [ ] `npm run check` passes 0 errors after changes to `patient-export.ts`

---

## Dual Language (EN / DE) — Mandatory for All Features

Every new feature must be fully bilingual from day one. Language persisted in `settings` table under key `'app_locale'` (`'de'` | `'en'`, default `'de'`). Instant switching, no reload.

### Architecture

```
src/lib/i18n/
  types.ts          ← Translations interface (single source of truth)
  de.ts             ← German (default)
  en.ts             ← English
  index.svelte.ts   ← reactive I18nStore: init() / setLang()
  index.ts          ← re-export shim
```

`i18n.t` is `$derived` — templates update automatically on language switch. `i18n.init()` called first in `+layout.svelte` `onMount`.

```svelte
<script>
  import { i18n } from '$lib/i18n';
</script>
{i18n.t.nav.patients}
```

### Rules for New Features

1. **Add keys to `types.ts` first** — TypeScript errors if `de.ts` or `en.ts` missing a key
2. **Add to both `de.ts` and `en.ts`** — never ship with one language missing
3. **No hardcoded UI strings** — every visible string from `i18n.t.*` (exceptions: console logs, DB column names, code constants)
4. **User-configurable defaults are bilingual** — follow `{ key, label? }[]` pattern; built-in keys resolve via `i18n.t.defaults.*`, custom items carry their own `label`
5. **Dental tag labels** — `DentalTag.label` deprecated. Labels from `i18n.t.chart.tags[key].label` at render time via `dentalTags.getLabel(key)`. New tag keys need entries in both `de.ts` + `en.ts` under `chart.tags`.
6. **Shortcuts are language-aware** — `chart.tags[key].defaultShortcut` differs per language. On switch, confirmation dialog offers to reset shortcuts.
7. **Tag group labels** — `i18n.t.chart.tagGroups`: `general`, `restorative`, `endodontic`, `fixedProsthetics`, `removable`, `absent`, `custom`, `bridgeTagNote`, `prosthesisTagNote`

### Checklist for New Features

- [ ] New UI strings added to `Translations` interface in `types.ts`
- [ ] Both `de.ts` and `en.ts` updated
- [ ] Component imports `{ i18n } from '$lib/i18n'` and uses `i18n.t.*`
- [ ] If feature has user-configurable lists, defaults follow `{ key, label? }[]` pattern
- [ ] `npm run check` passes 0 errors

---

## Customizability First

Before implementing any feature as hard-coded, ask: "Could this be user-configurable?"

### Rules

1. **Present options before coding** — propose configurable option first
2. **Store configuration in `settings` table** — via `getSetting()` / `setSetting()` in `db.ts`
3. **Reactive `.svelte.ts` stores over static maps** — use module-level Svelte 5 stores
4. **Never lock users in** — every "category", "type", "label", "folder" must support user additions/edits/deletions via Settings
5. **Defaults are starting points** — ship sensible defaults, always expose Settings UI to override
6. **Derived UI** — filter dropdowns, badges, pills must be `$derived` from the relevant store

### Already-Configurable Systems

- **Document Categories** — Settings › Document Categories, `settings` table, drives vault folder creation + timeline badges
- **Clinical Tags** — `acuteTagOptions` + `medicalTagOptions` stores (Settings › Clinical Tags)
- **Staff Roles** — `staffRoles` store (Settings › Staff Roles)
- **Text Blocks** — `textBlocks` store (Settings › Text Blocks), `/` command palette
- **Complication Types** — `complicationTypes` store, 13 defaults. Key: `'complication_types'`. Store: `src/lib/stores/complicationTypes.svelte.ts`
- **Entry & Appointment Types (unified)** — `entryTypes` store is a thin derived view over `appointmentTypes.active`. One list for both timeline entry type dropdown and scheduler. `entryTypes.load()` is a no-op — `appointmentTypes.load()` handles loading. `TimelineEntryCard` uses `appointmentTypes.active.find(t => t.name === entry.entry_type)` for hex color; legacy types use `STATIC_TYPE_CONFIG`.
- **Bridge Appearance** — `bridgeRoles` store (`src/lib/stores/bridgeRoles.svelte.ts`), 3 roles. Key: `'bridge_role_configs'`
- **Prosthesis Type Appearance** — `prosthesisTypes` store (`src/lib/stores/prosthesisTypes.svelte.ts`), 2 types. Key: `'prosthesis_type_configs'`
- **"Reset to Defaults" buttons removed** from Settings — `DEFAULT_*` constants kept for onboarding only

### Checklist for New Features

- [ ] Are there labels/categories/types currently hard-coded that a user might want to change?
- [ ] Should these be stored in `settings` table and managed in Settings?
- [ ] Is there a `.svelte.ts` store as single source of truth?
- [ ] Do dependent UI elements (filters, badges, dropdowns) derive reactively from that store?
- [ ] Can users add their own entries without a code change?

---

## Data Model — DB Schema Overview

Migrations in `SCHEMA_STATEMENTS` in `src/lib/services/db.ts`. **NEVER modify existing migrations — always append new ones.** `LATEST_VERSION = 41`.

**Key tables:** `patients`, `timeline_entries`, `treatment_plans`, `treatment_plan_items`, `documents`, `dental_chart`, `settings`, `doctors`, `ortho_classifications`, `entry_teeth`, `complications`, `dental_chart_history`, `probing_records`, `probing_measurements`, `probing_tooth_data`, `patient_conditions`, `appointment_rooms`, `appointments`, `schedule_blocks`, `staff_blockouts`, `doctor_working_hours`

See `docs/claude/DB_SCHEMA.md` for full per-version descriptions and all DB function signatures.

---

## Vault Storage Structure

```
{vault_folder}/
  dentvault.db              ← SQLite: all patients, timeline, chart, AND all settings
  audit.jsonl               ← immutable append-only audit trail
  !TEMPLATE/                ← patient file templates (sorts to top; always present)
    xrays/ photos/ documents/ lab_results/ consents/ referrals/
  !Documents/               ← reusable document templates (PDFs, Word files, etc.)
  {Lastname_Firstname_ID}/  ← one folder per patient
    xrays/ photos/ documents/ lab_results/ consents/ referrals/
```

Vault folder location stored in `{app_data_dir}/vault_path.txt`. **Full backup = copy the vault folder.**

---

## Sidebar Navigation Architecture

The left sidebar (`src/routes/+layout.svelte`):
- Primary nav items rendered via `{#each primaryNav}` — full-width rows with icon + label
- Settings after a hairline divider (`border-t border-sidebar-border/60`)
- Active state: left accent bar + background highlight (`bg-sidebar-accent`)
- `{@const}` tags must be INSIDE `{#each}` blocks — for Settings link (outside loop), inline expressions directly

---

## Build Phases Status (all complete)

- [x] Phase 0 — Scaffolding
- [x] Phase 1 — Patient CRUD
- [x] Phase 2 — Timeline & Treatment History
- [x] Phase 3 — Treatment Plans
- [x] Phase 4 / 4b / 4c / 4d — Dental Chart + UX overhauls
- [x] Phase 5 — Documents & Attachments
- [x] Phase 6 / 6b / 6c / 6d / 6e / 6f / 6g — Dashboard, Analytics, Perio, Onboarding, Rich text, UX polish
- [x] Phase 7 (partial) — Backup & Export
- [x] Phase 8 / 8b / 8c (partial) — Appointment Scheduling + UX polish + Block drag/resize
- [x] Phase 9 / 9b / 9c (partial) — Dashboard Analytics Overhaul + UX polish

---

## What to Build Next

**Phase 7 — remaining:**
1. Multi-user roles — map `doctors` table to login/session concept

**Phase 8 — remaining:**
2. Recall / reminder system
3. Week/month schedule views
4. Doctor working hours UI — table `doctor_working_hours` (v35) exists, no UI yet

**Phase 9 — remaining:**
6. Drill-down on heatmap / day chart
7. Dashboard date range override (custom range beyond period toggle)
8. Time-series trend sparklines on stat cards
9. Reports page re-integration (route `/reports` exists, nav link removed)

**Clinical intelligence — remaining:**
10. Make keyword mappings user-configurable in Settings (`src/lib/services/keyword-engine.ts` done, needs Settings UI)
11. Cost / Billing module (deferred)
12. Time-series outcome survival curves in Reports
13. Cohort comparison (side-by-side group analysis)
