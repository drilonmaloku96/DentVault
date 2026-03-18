# DentVault — Project Guide for Claude

## What is DentVault?

A cross-platform desktop dental patient management app for independent practitioners and small clinics.
Built with **Tauri 2 + SvelteKit + Svelte 5 + TypeScript + SQLite + Tailwind CSS v4 + shadcn-svelte**.

See `DENTVAULT_PLAN.md` for the full phase-by-phase implementation plan and architecture conventions.

---

## Core Design Principle: Clinical Intelligence Through Structured Data

DentVault is NOT just a patient record system. Its primary long-term value is **clinical outcome tracking and statistical analysis**. Every data model, every form, and every classification field exists to enable the practitioner to filter, cross-reference, and derive insights across their entire patient population.

### The Filtering & Statistics Vision

The app must support arbitrary multi-dimensional queries like:

- "Show me all endodontic treatments, grouped by tooth, with retreatment rates and eventual extraction rates" → **endo success rate analysis**
- "Of all Class II patients treated with fixed appliances, how many achieved Class I after treatment?" → **ortho outcome tracking**
- "All teeth that received root canal treatment in 2023 — how many have been retreated, how many extracted?" → **longitudinal tooth survival**
- "All patients with distal occlusion — what treatment was done, what was the result?" → **treatment efficacy by diagnosis**
- "Show me failure rates by provider, by tooth type, by treatment category" → **practice-level analytics**

This means **every piece of clinical data must be structured, tagged, and queryable** — not buried in free-text notes.

---

## Taxonomy & Classification System

### Treatment Categories (structured, not free-text)

Every procedure/treatment recorded in the app MUST be tagged with a **treatment category**. These are the top-level clinical domains:

| Category Key | Label | Examples |
|---|---|---|
| `endodontics` | Endodontics | Root canal, retreatment, apicoectomy, pulpotomy, pulp cap |
| `orthodontics` | Orthodontics | Fixed appliances, aligners, retainers, space maintainers |
| `prosthodontics` | Prosthodontics | Crowns, bridges, dentures, implant prosthetics, veneers |
| `periodontics` | Periodontics | Scaling/root planing, flap surgery, grafting, implant placement |
| `oral_surgery` | Oral Surgery | Extractions, surgical extractions, biopsies, frenectomy |
| `restorative` | Restorative | Fillings (composite, amalgam), inlays, onlays |
| `preventive` | Preventive | Cleanings, sealants, fluoride, exams |
| `imaging` | Imaging | Periapical, panoramic, CBCT, cephalometric |
| `other` | Other | Anything that doesn't fit above |

### Treatment Outcome Tracking

Every completed treatment should have an **outcome** field. This is what enables success rate calculations:

| Outcome Key | Label | Meaning |
|---|---|---|
| `successful` | Successful | Treatment achieved its goal, tooth/condition stable |
| `retreated` | Retreated | Same treatment had to be redone on same tooth/area |
| `failed_extracted` | Failed → Extracted | Treatment failed, tooth was eventually extracted |
| `failed_other` | Failed → Other | Treatment failed, alternative treatment was done |
| `ongoing` | Ongoing | Treatment still in progress / too early to evaluate |
| `unknown` | Unknown | Outcome not yet recorded |

#### Endo-Specific Outcome Chain

For endodontic treatments, the system must track the **chain of events per tooth**:

1. **Initial RCT** → date, tooth, provider, technique
2. **Follow-up** → is the tooth symptomatic? Radiographic healing?
3. **Retreatment** (if needed) → links back to the original RCT via `related_entry_id`
4. **Extraction** (if needed) → links back to the original RCT via `related_entry_id`

This allows computing: "Of 200 root canals performed, 180 successful (90%), 12 retreated (6%), 8 extracted (4%)."

#### Ortho-Specific Classification

For orthodontic patients, the system must capture **pre-treatment and post-treatment classification**:

| Field | Values |
|---|---|
| `angle_class` | `class_I`, `class_II_div1`, `class_II_div2`, `class_III` |
| `molar_relationship` | `class_I`, `class_II`, `class_III`, `super_class_II`, `super_class_III` |
| `overjet_mm` | numeric (mm) |
| `overbite_mm` | numeric (mm) |
| `crowding` | `none`, `mild`, `moderate`, `severe` |
| `crossbite` | `none`, `anterior`, `posterior_unilateral`, `posterior_bilateral` |
| `open_bite` | `none`, `anterior`, `posterior` |
| `midline_deviation_mm` | numeric (mm) |
| `treatment_type` | `fixed_appliances`, `aligners`, `functional`, `headgear`, `surgical_ortho`, `other` |
| `extraction_pattern` | `non_extraction`, `4_premolars`, `2_upper_premolars`, `other` (text) |

The system records these at **treatment start** and **treatment end** so the practitioner can query:
- "How many Class II div 1 patients were treated to Class I?"
- "Average overjet reduction for patients treated with fixed appliances?"
- "Success rate of non-extraction treatment in severe crowding cases?"

---

## Smart Tag Suggestion System (Keyword Detection with Approval)

The keyword detection engine is **implemented** at `src/lib/services/keyword-engine.ts` (client-side regex pattern matcher, no AI). The suggestion UI is `src/lib/components/ui/TagSuggestionBar.svelte`.

### Suggest, Don't Auto-Classify

1. **Keyword scanner** — as the user types/saves, scans for clinically significant keywords
2. **Tag suggestion banner** — non-intrusive chips below the text field with Accept / Dismiss
3. **Never auto-apply** — tags are NEVER written to DB without explicit user Accept
4. **Hedging language** (may/might/consider/discuss) → low-confidence chip style
5. **Negation** (no signs of / ruled out) → suppresses suggestion entirely
6. **`related_entry` suggestions** — when retreatment/failed_extracted outcomes are detected, a special chip fires `onRelatedEntryAccept` to open the prior-procedure picker

### Keyword → Tag Mapping (baseline)

#### Treatment Category Detection

| Keywords / Patterns | Suggested Category |
|---|---|
| `root canal`, `RCT`, `endodontic`, `pulpectomy`, `pulpotomy`, `pulp cap`, `apicoectomy`, `retreatment` | `endodontics` |
| `orthodontic`, `braces`, `aligner`, `Invisalign`, `retainer`, `archwire`, `bracket`, `malocclusion` | `orthodontics` |
| `crown`, `bridge`, `denture`, `veneer`, `implant prosth`, `pontic`, `abutment`, `onlay`, `inlay` | `prosthodontics` |
| `scaling`, `root planing`, `SRP`, `flap surgery`, `graft`, `perio`, `pocket`, `implant placement` | `periodontics` |
| `extraction`, `surgical extract`, `biopsy`, `frenectomy`, `impaction`, `third molar` | `oral_surgery` |
| `filling`, `composite`, `amalgam`, `restoration`, `caries`, `cavity`, `decay` | `restorative` |
| `cleaning`, `prophylaxis`, `sealant`, `fluoride`, `exam`, `check-up` | `preventive` |
| `x-ray`, `xray`, `radiograph`, `periapical`, `panoramic`, `CBCT`, `cephalometric`, `OPG` | `imaging` |

#### Tooth Number Detection

Patterns: `#\d{1,2}`, `tooth \d{1,2}`, `FDI \d{2}`, Palmer notation (UL6/LR4 etc.)

#### Outcome / Status Detection

| Keywords | Suggested Tag |
|---|---|
| `retreatment`, `re-treatment`, `redo`, `repeat` | `treatment_outcome: retreated` + `related_entry` chip |
| `failed`, `failure`, `unsuccessful` | `treatment_outcome: failed_other` |
| `extracted due to`, `extraction following` | `treatment_outcome: failed_extracted` + `related_entry` chip |
| `successful`, `healed`, `asymptomatic`, `resolved` | `treatment_outcome: successful` |
| `healing`, `monitoring`, `review in` | `treatment_outcome: ongoing` |

---

## Data Model — Current DB Schema

All migrations live in the **`SCHEMA_STATEMENTS` array in `src/lib/services/db.ts`**. NEVER modify existing migrations — always append new ones. `LATEST_VERSION` tracks the current schema version (currently **29**).

### Core Tables (v1–v22, pre-analytics)

`patients`, `timeline_entries` (with `treatment_category`, `treatment_outcome`, `related_entry_id`, `tooth_numbers`, `doctor_id`, `colleague_ids`), `treatment_plans`, `treatment_plan_items` (with `timeline_entry_id`), `documents`, `dental_chart`, `settings`, `doctors`, `ortho_classifications`

### Analytics Infrastructure Tables (v23–v30)

| Version | Table / Column | Purpose |
|---|---|---|
| v23 | `entry_teeth` | Junction table normalizing tooth numbers per entry for efficient per-tooth queries. `syncEntryTeeth(entryId, toothNumbers)` keeps it in sync. `migrateEntryTeeth()` backfills from existing entries. |
| v24 | `treatment_plan_items.timeline_entry_id` | Links a completed plan item to the timeline entry it produced. |
| v25 | `complications` | Structured per-entry complication tracking (type, severity, description, resolved_at). User-configurable types via `complicationTypes` store. |
| v26 | `dental_chart_history` | Snapshot of all tooth conditions for a patient, recorded at a specific timeline entry. Populated when the user explicitly takes a chart snapshot from the timeline toolbar. |
| v27 | `probing_records` + `probing_measurements` | Periodontal probing: one record per exam session, 6 site measurements per tooth (MB/B/DB buccal + ML/L/DL lingual). Pocket depth (mm) + BOP (boolean) per site. |
| v28 | `patients.referral_source`, `patients.smoking_status`, `patients.occupation` | Extended patient demographics for cohort analysis. |
| v29 | `patient_conditions` | Dated special conditions replacing flat JSON array. Supports start_date, end_date, is_active, notes. Supports querying active conditions across patient population. |
| v30 | `probing_measurements.recession` + `.plaque`, `probing_tooth_data` | Perio chart overhaul: recession per site (for CAL = PD + recession), plaque per site; new `probing_tooth_data` table adds mobility (0–III), furcation (0–III) + sites, and per-tooth notes per exam. |

### Patient Clinical Classifications

`ortho_classifications` table stores Angle class, molar relationship, overjet/overbite, crowding, crossbite, open bite — recorded pre and post treatment.

### Key DB Functions (analytics)

- `getCategoryStats(filters?)` / `getOutcomeStats(filters?)` / `getOverallSuccessRate(filters?)` — dashboard aggregates
- `getProviderOutcomeStats(filters?)` — per-doctor outcome breakdown
- `getDrillDownEntries(category, outcome, filters?)` — entries for a clicked dashboard cell
- `getFilteredEntries(filters: ReportFilters)` / `getFilteredSummary(filters: ReportFilters)` — reports page
- `getPriorProceduresForTooth(patientId, toothNumber)` — find earlier entries on same tooth (for related_entry_id linking)
- `getComplications(entryId)` / `insertComplication()` / `resolveComplication()` / `deleteComplication()`
- `recordChartHistory(patientId, entryId)` / `getToothHistory(patientId, tooth)`
- `insertProbingRecord()` / `getProbingRecords()` / `upsertProbingMeasurement()` / `getProbingMeasurements()` / `upsertProbingToothData()` / `getProbingToothData()`
- `getPatientConditions()` / `insertPatientCondition()` / `updatePatientCondition()` / `deactivatePatientCondition()`

### Filter Types (in `src/lib/types.ts`)

- `AnalyticsFilters` — `{ dateFrom?, dateTo?, doctorId? }` — used by dashboard
- `ReportFilters` — `{ dateFrom?, dateTo?, categories?, outcomes?, doctorId?, toothNumbers? }` — used by reports page
- `ReportEntry` — flat row returned by `getFilteredEntries` for table/CSV display

---

## Dual Language (EN / DE) — Mandatory for All Features

DentVault supports English and German with instant switching from Settings (no reload). **Every new feature must be fully bilingual from day one.**

### i18n Architecture

```
src/lib/i18n/
  types.ts          ← Translations interface (single source of truth for all keys)
  de.ts             ← German translation object (default language)
  en.ts             ← English translation object
  index.svelte.ts   ← reactive I18nStore class with init() / setLang()
  index.ts          ← re-export shim so `import { i18n } from '$lib/i18n'` resolves
```

`i18n.t` is `$derived` — any template reading it updates automatically on language switch.

```svelte
<script>
  import { i18n } from '$lib/i18n';
</script>
{i18n.t.nav.patients}
{i18n.t.actions.save}
```

Language persisted in `settings` table under key `'app_locale'` (`'de'` | `'en'`). Initialised in `+layout.svelte` with `await i18n.init()` **before** all other store loads.

### Rules for New Features

1. **Add keys to `types.ts` first** — extend the `Translations` interface for every new string. TypeScript will error if either `de.ts` or `en.ts` is missing a key.
2. **Add to both `de.ts` and `en.ts`** — always add German and English strings together. Never ship a feature with one language missing.
3. **No hardcoded UI strings** — every visible string in a component or page must come from `i18n.t.*`. The only exceptions are: developer console logs, DB column names, and code-level constants.
4. **User-configurable defaults are bilingual** — stores like `complicationTypes`, `acuteTagOptions`, `docCategories`, `staffRoles`, `textBlocks` have keyed defaults that translate automatically. New configurable stores must follow the same `{ key, label? }[]` pattern where built-in keys resolve via `i18n.t.defaults.*` and custom user items carry their own `label`.
5. **Dental tag labels** — `DentalTag.label` is deprecated (optional). All tag labels are derived at render time via `dentalTags.getLabel(key)` → `i18n.t.chart.tags[key].label`. New tag keys added to the system must have entries in both `de.ts` and `en.ts` under `chart.tags`.
6. **Default shortcuts are language-aware** — `chart.tags[key].defaultShortcut` differs per language (e.g. German `'k'` for Karies, English `'c'` for Caries). Respect this when adding new tag types.

### Checklist for New Features

- [ ] New UI strings added to `Translations` interface in `types.ts`
- [ ] Both `de.ts` and `en.ts` updated with translations
- [ ] Component/page imports `{ i18n } from '$lib/i18n'` and uses `i18n.t.*`
- [ ] If the feature has user-configurable lists, defaults follow `{ key, label? }[]` pattern
- [ ] `npm run check` passes 0 errors (TypeScript enforces translation completeness)

---

## Customizability First

DentVault is built for practitioners of all kinds — each with their own workflow, terminology, folder structure, and preferences. **Before implementing any feature as a hard-coded solution, always ask: "Could this be user-configurable?"**

### Guiding Rules

1. **Present options before coding**: When a new feature involves lists, labels, categories, or UI preferences, ask the user whether they want it hard-coded or fully configurable. Propose the configurable option first.
2. **Store configuration in the `settings` table**: All user preferences must be persisted via `getSetting()` / `setSetting()` in `db.ts` — never in hard-coded arrays or constants in source files.
3. **Reactive `.svelte.ts` stores over static maps**: Use module-level Svelte 5 stores (like `docCategories`) rather than static `Record<string, …>` maps for anything the user might want to change.
4. **Never lock users in**: Every feature that has a "category", "type", "label", or "folder" must support user additions, edits, and deletions via the Settings page.
5. **Defaults are starting points, not ceilings**: Ship with sensible built-in defaults, but always expose a Settings UI that lets practitioners completely override them.
6. **Derived UI**: Filter dropdowns, badges, pills, and category selectors must be `$derived` from the relevant store — they update automatically when the user changes Settings.

### Already-Configurable Systems

- **Document Categories** — managed in Settings › Document Categories, backed by the `settings` table, drives vault folder creation, filter pills, and timeline badges automatically.
- **Clinical Tags** — `acuteTagOptions` + `medicalTagOptions` stores (Settings › Clinical Tags), used in AcuteProblemsBox and MedicalHistoryBox.
- **Staff Roles** — `staffRoles` store (Settings › Staff Roles), used across the app for doctor chip labels.
- **Text Blocks** — `textBlocks` store (Settings › Text Blocks), the `/` command palette in entry bars.
- **Complication Types** — `complicationTypes` store (Settings › Complication Types), 13 default types, user-editable. Settings key: `'complication_types'`. Store at `src/lib/stores/complicationTypes.svelte.ts`.

### Checklist for New Features

When adding a new feature, always ask:

- [ ] Are there any labels, categories, or types currently hard-coded that a user might want to rename or extend?
- [ ] Should these be stored in the `settings` table and managed in Settings?
- [ ] Is there a `.svelte.ts` store that should be the single source of truth?
- [ ] Do all dependent UI elements (filters, badges, dropdowns) derive reactively from that store?
- [ ] Can users add their own entries to this list, and will the whole system update without a code change?

---

## Technical Conventions (Quick Reference)

- **Svelte 5 runes**: `$state()`, `$derived()`, `$effect()`, `$props()`
- **Snippet slots**: `{@render children()}`
- **Tailwind v4**: `@theme inline` blocks in `src/app.css`, no `tailwind.config.js`
- **Colors**: oklch CSS custom properties in `src/app.css`
- **shadcn-svelte**: components at `$lib/components/ui/`, install with `npx shadcn-svelte@1.1.1 add <name> -y`
- **DB access**: exclusively through `src/lib/services/db.ts`, positional `$1, $2` params
- **Migrations**: append to `SCHEMA_STATEMENTS` array in `src/lib/services/db.ts`, never modify existing ones. Update `LATEST_VERSION` constant after adding.
- **Types**: all interfaces in `src/lib/types.ts`
- **Type check**: `npm run check` must pass with 0 errors after every change
- **`untrack()`**: use in `$state()` initializers when reading props to suppress "captures initial value" warning
- **Svelte 5 deep reactivity**: mutate `$state` object properties directly (`obj[key] = val`, `delete obj[key]`) — do NOT use spread+reassign (`obj = { ...obj }`) for per-property updates, as it may not trigger fine-grained reactivity in all contexts
- **Dialog width override**: shadcn DialogContent has a built-in `sm:max-w-lg` responsive class; to widen a dialog you must override BOTH `max-w-[Xpx]` AND `sm:max-w-[Xpx]` in the `class` prop, otherwise the responsive variant wins at desktop widths
- **Opening files externally**: do NOT use `openPath` from `@tauri-apps/plugin-opener` — it silently fails. Use the custom Rust command `open_file_native` via `invoke('open_file_native', { path })` in `src/lib/services/files.ts`, which calls `open`/`explorer`/`xdg-open` directly per platform.
- **Timeline polling (silent refresh)**: only show the loading skeleton when `entries.length === 0` (first load). Background polling must NOT set `isLoading = true` when entries already exist — doing so replaces the list with skeleton blocks, shrinking the page and causing the scroll position to jump.
- **Scroll to revealed element after image expand**: call `scrollIntoView` or `scrollBy` AFTER awaiting the image `load` event, not just after `tick()`. The DOM updates immediately but the image height isn't final until load fires, causing `getBoundingClientRect()` to return a stale (too-small) height. Pattern: `if (!img.complete) await new Promise(r => img.addEventListener('load', r, { once: true }))` before measuring.
- **`provider` field deprecated**: The free-text `provider` column on `timeline_entries` is no longer shown in the UI. All provider attribution is done via `doctor_id` (primary doctor chips) + `colleague_ids` (colleague chips). Legacy `provider` text is shown with a "(legacy)" label in the expanded entry view only.
- **`entry_teeth` sync**: whenever you insert or update a `timeline_entries` row with a `tooth_numbers` value, call `syncEntryTeeth(entryId, toothNumbers)` to keep the junction table in sync.
- **CSV export**: use `entriesToCSV(entries)` + `downloadCSV(csv, filename)` from `src/lib/services/export.ts`.
- **JSON export**: use `downloadJson(obj, filename)` from `src/lib/services/export.ts` — serializes any object to a pretty-printed JSON download.
- **Settings export/import**: `getAllSettings()` / `bulkSetSettings(entries)` in `db.ts` read/write all rows of the `settings` table. Export serializes to `{ version, exportedAt, app, settings[] }`. Import validates, shows a confirm dialog, calls `bulkSetSettings`, then reloads.
- **Database backup**: Rust command `backup_database(vault_path, dest_path)` copies `dentvault.db` to a user-chosen path. Called from Settings → Backup & Export.
- **Vault backup**: Rust command `backup_vault_to(vault_path, dest_dir)` recursively copies the entire vault to `{dest_dir}/DentVault-Backup-{YYYY-MM-DD}/`. Uses internal `copy_dir_all` helper — no external crates needed.
- **Backup & Export section** in Settings page: 4 cards — Export Settings (JSON download), Import Settings (file picker + confirm dialog + page reload), Backup Database (directory picker → timestamped .db copy), Backup Vault (directory picker → full folder copy).
- **Rich text in timeline entries**: `timeline_entries.description` stores raw HTML (bold `<b>`, italic `<i>`, underline `<u>`). Both the entry bar (`TimelineEntryBar.svelte`) and form (`TimelineEntryForm.svelte`) use `contenteditable="true"` divs with `bind:innerHTML={description}`. Card display uses `{@html entry.description}`. Formatting shortcuts: Cmd/Ctrl+B/I/U. Toolbar buttons use `onmousedown` + `e.preventDefault()` to preserve editor focus. `execCommand('bold'/'italic'/'underline')` applies formatting. Selection API (`getTextBeforeCaret`, `selectTextRange` via TreeWalker) replaces textarea-based caret tracking for `@` mention and `/` text block detection.
- **Sticky patient header**: Breadcrumb + patient info row wrapped in `<div class="sticky top-0 z-20 bg-background pb-3 border-b ...">` in `src/routes/patients/[patient_id]/+page.svelte`. Timeline toolbar sticky at `top-[140px]` (breadcrumb ~52px + patient header ~76px + pb-3 12px). Scroll container is `<main class="flex-1 overflow-auto">`.
- **Extended patient data model**: v31 DB migration adds 10 columns: `address`, `city`, `postal_code`, `country`, `emergency_contact_name`, `emergency_contact_phone`, `emergency_contact_relation`, `blood_group`, `primary_physician`, `marital_status`. `PatientStatus` includes `'deceased'`. `PatientForm` has 7 sections: Personal, Contact, Address, Emergency Contact, Insurance, Clinical Background, Additional Demographics.

---

## Sidebar Navigation Architecture

The left sidebar (`src/routes/+layout.svelte`) uses a **vertical stacked nav** at the bottom:

- Primary nav items (Patients, Dashboard, Reports) rendered via `{#each primaryNav}` — full-width rows with icon + label
- Settings separated by a hairline divider (`border-t border-sidebar-border/60`) — rendered as a standalone link after the loop
- Active state: left accent bar (`absolute left-0 w-0.5 rounded-full bg-sidebar-primary`) + background highlight (`bg-sidebar-accent`)
- Inactive state: muted text + hover highlight (`hover:bg-sidebar-accent/50`)
- `{@const}` tags must be INSIDE `{#each}` blocks — for the Settings link (outside the loop), inline the expression directly in class bindings

---

## Build Phases Status

- [x] Phase 0 — Scaffolding (app shell, sidebar, DB connection)
- [x] Phase 1 — Patient CRUD (create, list, view, edit, delete, search, status, medical fields)
- [x] Phase 2 — Timeline & Treatment History (chronological entries with type/filter)
- [x] Phase 3 — Treatment Plans (multi-step plans with ordered procedures, progress, cost)
- [x] Phase 4 — Clinical Exams / Dental Chart (SVG tooth chart, per-tooth conditions, per-surface tagging)
- [x] Phase 4b — Dental Chart UX Overhaul (modal dialog, full-view tooth detail, drag-select surfaces, surface color reactivity)
- [x] Phase 4c — Dental Chart UX Overhaul 2 (side-panel layout, FDI charting order, roots, Enter-to-advance, keyboard shortcuts, bridge workflow — see `CHART_OVERHAUL_PLAN.txt`)
- [x] Phase 5 — Documents & Attachments (file picker, thumbnails, viewer, configurable categories)
- [x] Phase 6 — Dashboard & Analytics (stat cards, category bar chart, outcome table, recent activity)
- [x] Phase 6b — Timeline UX enhancements (image thumbnail expand/open, colleague tagging, @mention palette, AcuteProblemsBox + MedicalHistoryBox rewrite with configurable tags, silent background polling, entry bar spacer fix)
- [x] Phase 6c — Analytics Infrastructure (entry_teeth junction table, complications, dental chart history snapshots, probing chart dialog, dashboard provider outcomes + filters, reports page with CSV export, patient demographics, dated patient conditions, keyword engine, TagSuggestionBar, related entry linking — see `ANALYTICS_PLAN.md`)
- [x] Phase 6d — Perio Chart UX Overhaul (SVG bar-graph visualization, single-tooth data entry panel, guided charting mode, recession/CAL tracking, mobility/furcation, comparison view, summary stats bar — see `PERIO_OVERHAUL_PLAN.md`)
- [x] Phase 6e — First-run Onboarding Wizard, Patient Sidebar File Tree, Timeline scroll fix, Vault path change fix (see Onboarding Wizard section below)
- [x] Phase 6f — Sticky patient header + timeline toolbar, expanded patient data model (address, emergency contact, blood group, marital status, primary physician, deceased status), redesigned 7-section PatientForm, rich text formatting in timeline entry bar and form (Bold/Italic/Underline via Cmd/Ctrl+B/I/U, contenteditable editor, HTML stored in DB, `{@html}` rendering in card)
- [x] Phase 7 (partial) — Backup & Export: Settings JSON export/import, database file backup, full vault backup via new Rust commands (`backup_database`, `backup_vault_to`); new "Backup & Export" section in Settings with 4 action cards

### Dental Chart Architecture

The dental chart opens as a centered `Dialog` (1100px wide) from the timeline toolbar. See `CHART_OVERHAUL_PLAN.txt` for the full plan with checkbox progress tracking.

#### Layout
- **Two-column layout** in `DentalChartView.svelte`: chart left (~55%) + detail panel right (~45%), always both visible
- No `viewMode` toggle — clicking a tooth sets `selectedTooth` reactively, side panel updates instantly
- **Right panel**: shows `ToothDetailPanel` when a tooth is selected; shows placeholder + Clinical Exams section when nothing selected
- **Read-only snapshot**: single-column chart only (no side panel, no bridge drag)
- Dialog width: `max-w-[1100px] sm:max-w-[1100px]` in `TimelineView.svelte`

#### ToothDetailPanel
- No `fullView` prop — single consistent compact layout
- Surface grid: 160px wide, 48px tall cells, abbreviated names (O/B/L/M/D)
- Close (×) button deselects tooth, returns to placeholder
- Drag-select surfaces: `setPointerCapture` + `document.elementFromPoint` on 3×3 grid. Cells must NOT have `pointer-events:none`
- `surfaceMap` (`$state` object): mutate directly (`surfaceMap[s] = tag`) — never spread
- `doSave()` uses `_pendingSave` flag to queue concurrent saves
- Auto-save text fields debounced 600ms; tag/condition changes save immediately
- **"Brücke auflösen"** button shown when `entry.bridge_group_id` is set — dissolves the whole group
- **Condition History** collapsible section: loads via `getToothHistory(patientId, tooth)` — requires `patientId` prop

#### ToothChart SVG
- `viewBox="0 0 736 304"` (VH=304), `class="w-full"`, `min-width:560px`, `touch-action:none`
- **FDI notation** displayed throughout — internal storage uses Universal 1–32, display via `toFDI()` / `fromFDI()` from `$lib/utils`
- **Roots**: upper teeth roots grow upward from crown top (`g.oy`), lower roots grow downward from crown bottom (`LOWER_TOP + CROWN_H[t]`), `ROOT_H=36`
- Root canal condition: light purple fill + purple obturated canal line + apex dot
- No roots for: `extracted`, `missing`, `implant`, and pontic bridge members (`bridge_role === 'pontic'`)
- Quadrant labels: Q1 (upper right = FDI 18–11), Q2 (upper left = FDI 21–28), Q3 (lower left = FDI 38–31), Q4 (lower right = FDI 41–48)
- **Selected tooth**: blue border (`#2563eb`), blue drop shadow, blue FDI label
- No `onSurfaceClick` prop — all interactions via SVG-level `onpointerdown/move/up` with pointer capture
- `onBridgeRangeSelected?: (teeth: number[]) => void` fires when user drags across ≥2 teeth; single click fires `onToothClick`
- Bridge drag preview: blue dashed overlay rect shown during drag

#### Keyboard Navigation & Shortcuts
- **Enter** (tooth selected, no input focused) → next tooth in `FDI_CHARTING_ORDER`; **Shift+Enter** → previous
- **Escape** → deselect tooth (or exit charting mode)
- **Letter key** (e.g. `k`) → applies matching tag to active surfaces, or whole tooth if none selected
- Default shortcuts: g=Gesund, u=Beobachtung, k=Karies, f=Füllung, o=Krone, w=Wurzelbehandlung, i=Implantat, b=Brücke, x=Fehlend, e=Extrahiert, p=Impaktiert, r=Fraktur
- All shortcuts user-configurable in Edit Tags dialog; duplicate detection blocks save
- Shortcut badge `[k]` shown on each tag button in side panel
- `FDI_CHARTING_ORDER`, `getNextTooth()`, `getPrevTooth()` exported from `$lib/utils`

#### Charting Mode
- **"Charting starten"** button starts guided mode at FDI 18 (Universal 1)
- Progress bar shows `chartingIndex/32`; **Enter** advances, **Shift+Enter** goes back, **Escape** exits, **"Fertig"** button exits
- Clicking any tooth in chart during charting mode jumps to it and syncs the index
- Current tooth highlighted with blue dashed ring on SVG crown
- `chartingMode`, `chartingIndex` state in `DentalChartView`; `chartingTooth` prop passed to `ToothChart`

#### Prosthesis Workflow (Removable Prosthetics)

The bridge drag-select gesture is extended to also support removable prosthetics (partial dentures, telescope prostheses, clasp-retained prostheses). A toggle at the top of `BridgeDialog.svelte` switches between "Bridge" and "Prosthesis" mode.

- **DB**: same `bridge_group_id` / `bridge_role` columns, plus `prosthesis_type TEXT` column on `dental_chart`
- **Types**: `ToothChartEntry.prosthesis_type: 'telescope' | 'clasp' | 'attachment' | 'replaced' | null`
- **Roles for prosthesis**: `telescope` (primary crown anchor), `clasp` (wire anchor), `attachment` (implant anchor), `replaced` (artificial tooth in denture)
- **Visual**: prosthesis groups render with a distinct bar style/color separate from bridge bars on the SVG chart
- Components involved: `BridgeDialog.svelte`, `ToothChart.svelte`, `DentalChartView.svelte`, `RestorationEditorPanel.svelte`

#### Bridge Workflow
- **DB**: `dental_chart` has `bridge_group_id TEXT` and `bridge_role TEXT` columns (migration v14 in `db.ts`)
- **Types**: `ToothChartEntry.bridge_group_id: string | null`, `bridge_role: 'abutment' | 'pontic' | null`
- **DB functions**: `upsertToothChartEntry` handles bridge fields; `getBridgeGroup(patientId, groupId)` fetches all members
- **Create**: drag across teeth → `onBridgeRangeSelected` → `BridgeDialog.svelte` (chip toggles Abutment ↔ Pontic, middle teeth default to Pontic) → `handleBridgeConfirm` saves with shared `crypto.randomUUID()` group ID
- **Render**: `bridgeGroups` derived in `ToothChart` draws horizontal bar connecting leftmost to rightmost crown edge per group; upper bar below crowns, lower bar above crowns
- **Pontics**: dashed outline with bridge strokeColor; `showRoot = !NO_ROOT.has(cond) && !isPontic`
- **Dissolve**: `onDissolveBridge(groupId)` resets all members to `condition='healthy'`, clears bridge fields

### Audit Log

An immutable, append-only audit trail at `<vault_root>/audit.jsonl`. Implemented via:

- `src/lib/services/audit.ts` — `logAudit(action, entity_type, entity_id, patientId, before, after)` appends a JSONL line via Rust commands `append_audit_line` / `read_audit_log`
- `src/lib/components/audit/AuditLogDialog.svelte` — Dialog to browse/filter the audit log; accessible from the patient page toolbar
- Records every update and deletion across timeline entries, treatment plans, dental chart, documents, and patients
- Format: `{ id, timestamp, action, entity_type, entity_id, patient_id, before, after }`

### Periodontal Probing Chart

**4-component architecture** in `src/lib/components/perio/`, opened as Dialog (1200px wide) from the timeline toolbar "Perio" button.

| Component | Purpose |
|---|---|
| `ProbingChartDialog.svelte` | Main orchestrator — two-column layout (62/38 split), toolbar, charting mode, record management |
| `PerioSVGChart.svelte` | Left panel: SVG bar-graph visualization — vertical bars per site, color-coded green/amber/red by PD depth, BOP red dots, recession purple bars, plaque yellow dots, ghost comparison bars, click-to-select tooth |
| `PerioDataEntryPanel.svelte` | Right panel: single-tooth editor — PD + recession inputs, BOP/plaque toggles, CAL computed row, mobility (0–III), furcation (multi-rooted only), debounced notes, Enter/Shift+Enter navigation |
| `PerioSummaryBar.svelte` | Bottom stats: mean PD, BOP%, PD≥4/≥6 counts, sites recorded, teeth charted — all `$derived` |
| `PerioComparisonView.svelte` | Optional comparison strip — delta per site vs. past record (↑ worse/↓ better), improved/worsened counts |

**Key behaviours:**
- **Guided charting mode**: "Start Charting" button begins at FDI 18, progress bar shows N/32, Enter advances, Shift+Enter goes back, Escape exits — mirrors dental chart UX
- **Auto-create record**: `ensureRecord()` creates the DB record on first data input, not on dialog open
- **Auto-save per input**: every PD, recession, BOP, plaque, mobility, furcation change saves immediately
- **Comparison**: select a past record in the "Compare" dropdown → ghost bars overlay on SVG + delta table
- **CAL display**: computed read-only `PD + recession` per site, updates live
- **Furcation**: only shown for multi-rooted teeth (molars + upper premolars); site checkboxes (B/ML/DL for upper molars, B/L for lower) appear when furcation grade > 0
- **Scale**: `SCALE_PX_PER_MM = 8` — a 10mm pocket renders as an 80px bar; max rendered depth = 12mm

---

## Practitioner Handbook

A PDF-ready practitioner handbook exists at `docs/handbook.html`. It covers all 12 feature areas with A4 print CSS, a cover page, table of contents, callout boxes, and screenshot placeholder slots.

### Workflow to produce the final PDF

1. **Take screenshots** of the running app and drop them into `docs/screenshots/` using the exact filenames listed in the checklist at the bottom of `handbook.html` (also on the last page of any generated PDF). 23 screenshots total — the checklist describes exactly what to capture for each.
2. **Preview** by opening `docs/handbook.html` in Chrome — screenshots fill in live; placeholder boxes show for any missing ones.
3. **Export PDF** by running:
   ```bash
   node docs/generate-pdf.js
   # → docs/DentVault-Handbook.pdf
   ```
   Re-run any time after retaking screenshots.

### Handbook chapters

| Chapter | Content |
|---|---|
| 1 | Introduction & data ownership philosophy |
| 2 | Getting started — vault setup, interface overview |
| 3 | Managing patients — list, create, profile tabs |
| 4 | Clinical timeline — entries, categories, outcomes, smart tags, @mentions, text blocks |
| 5 | Treatment plans — create, items, cost tracking, statuses |
| 6 | Dental chart — reading, charting mode, keyboard shortcuts, bridges, snapshots |
| 7 | Periodontal probing — SVG chart, data entry panel, charting mode, comparison, summary stats |
| 8 | Documents & attachments |
| 9 | Dashboard & analytics — outcome table, drill-down, provider filter |
| 10 | Reports & CSV export |
| 11 | Settings — document categories, clinical tags, staff roles, text blocks, complication types, dental tag shortcuts |
| 12 | Keyboard shortcuts reference (all contexts) |

### Technical notes

- `docs/handbook.html` — single self-contained HTML file; source of truth for content
- `docs/generate-pdf.js` — Node ESM script using Playwright Chromium; Playwright is installed as a dev dependency, Chromium downloaded to the Playwright cache
- `docs/screenshots/` — drop screenshots here; `<img onerror>` degrades gracefully to a labeled dashed placeholder when an image is missing
- The screenshot checklist page (`class="no-print"`) is hidden when printing/exporting to PDF — it only shows in browser preview
- **When the app reaches final UI**: go through the 23-item screenshot checklist, then run `node docs/generate-pdf.js`

---

## Dual Language (EN / DE)

Full plan is in `LANG_PLAN.md`. Summary of the architecture and key decisions:

### Overview
Language is persisted in the `settings` table under key `'app_locale'` (`'en'` | `'de'`, default `'de'`). Switching is instant — no reload. Switchable from **Settings → Language**.

### i18n infrastructure
```
src/lib/i18n/
  types.ts            ← Translations interface (all keys, both langs must satisfy it)
  de.ts               ← German (default)
  en.ts               ← English
  index.svelte.ts     ← reactive store: i18n.code ($state) + i18n.t ($derived)
```

Usage in every component:
```svelte
<script>
  import { i18n } from '$lib/i18n';
</script>
{i18n.t.nav.patients}
{i18n.t.actions.save}
{i18n.t.categories.endodontics}
```

`i18n.t` is `$derived` from `i18n.code` — any template reading it is automatically reactive.

`i18n.init()` is called first in `+layout.svelte` `onMount`, before all other stores load.

### Dental tag labels — decoupled from storage
`DentalTag.label` is **removed** from the persisted object. Labels come from `i18n.t.chart.tags[tag.key].label` at render time. Stored object only keeps: `key`, `color`, `strokeColor`, `pattern`, `shortcut`.

### Keyboard shortcuts adapt per language
Each language defines `defaultShortcut` per tag key inside the translation file. On language switch, a confirmation dialog asks: *"Reset shortcuts to [Language] defaults?"* — user can keep their custom shortcuts or reset.

**German defaults:** g=Gesund, k=Karies, f=Füllung, o=Krone, w=Wurzelbehandlung, i=Implantat, b=Brücke, x=Fehlend, e=Extrahiert, p=Impaktiert, r=Fraktur, t=Prothese, u=Beobachtung

**English defaults:** h=Healthy, c=Caries, f=Filling, k=Crown, r=Root Canal, i=Implant, b=Bridge, m=Missing, e=Extracted, p=Impacted, x=Fracture, t=Prosthesis, u=Watch

### User-configurable stores
Stores like `complicationTypes`, `clinicalTags`, `docCategories`, `staffRoles`, `textBlocks` use a two-tier system:
- **Keyed defaults** (known `key` like `'infection'`) — label looked up from `i18n.t.*[key]`, switches with language
- **Custom items** (key starts with `'custom_'`) — label is the stored string, never auto-translated

`complicationTypes` and `clinicalTags` need migration from bare `string[]` to `{ key: string; label?: string }[]` on first load. Text blocks have `resetToLanguageDefaults()` that pulls from `i18n.t.defaults.textBlocks`.

### Implementation status: **complete**

All steps are done — `npm run check` passes 0 errors. The i18n infrastructure, language switcher, dental tag label decoupling, store migrations, and full component sweep are all implemented.

---

## Onboarding Wizard

First-run setup experience shown when `vault.isConfigured` is `false`. Implemented in `src/lib/components/onboarding/OnboardingWizard.svelte`, mounted in `src/routes/+layout.svelte`.

### How it fits into the layout

```svelte
{#if vault.initialized && !vault.isConfigured}
  <OnboardingWizard onConfigured={onVaultConfigured} />
{:else}
  <!-- main app shell -->
{/if}
```

`vault.isConfigured` becomes `true` only when `vault.configure(path)` is called. The wizard defers this call to the very last step so the wizard is never prematurely unmounted while the user is still on an earlier step.

### Steps

| # | Name | Content |
|---|---|---|
| 0 | Welcome | Logo, title, subtitle, language switcher (DE 🇩🇪 / EN 🇬🇧) |
| 1 | Vault | Folder picker, vault structure preview (monospace tree), continue/back buttons |
| 2 | Team | Staff list (name + role select from `i18n.t.defaults.staffRoles`), skip allowed |
| 3 | Defaults | Read-only preview of 5 default sections as chip groups with count badges; text blocks section shows a `/` key hint |
| 4 | Done | Animated SVG checkmark, "Add First Patient" button triggers `finish()` |

### Language switching during onboarding

`switchLang(code)` on step 0 calls `i18n.setLang(code)` but the vault isn't configured yet so the DB write may fail. It catches the error and falls back to `i18n.code = code` (in-memory only). In `finish()`, after `vault.configure()` + `resetDb()`, the code immediately calls `await i18n.setLang(i18n.code)` to persist the chosen language into the newly created DB. This means text block defaults and all other stores load with the correct language on all subsequent app launches.

### `finish()` sequence

```typescript
await vault.configure(selectedPath.trim());   // 1. configure vault (creates DB)
resetDb();                                     // 2. reconnect db.ts
await i18n.setLang(i18n.code);                // 3. persist language choice
// insert staff doctors...
await Promise.all([stores.load()...]);        // 4. reload all stores
onConfigured();                               // 5. triggers layout to show main app
```

### Progress indicator

3 numbered dots (Vault / Team / Defaults) connected by horizontal lines. Completed steps show a checkmark. Step labels below dots. Rendered only on steps 1–3.

### Transitions

`{#key step}` with `in:fly={{ x: direction * 40 }}` — direction is +1 forward, −1 back.

### `onVaultConfigured` callback

In `+layout.svelte` this calls `window.location.reload()` to reinitialise all Svelte stores from the freshly configured vault.

---

## Patient Sidebar File Tree

When a patient is selected in the left sidebar (`src/lib/components/sidebar/PatientSidebar.svelte`), the sidebar switches from list mode to a file-system tree view (`src/lib/components/sidebar/PatientTreeView.svelte`).

### Data source

Uses the `listVaultFiles(vaultPath, patientFolder)` Tauri command which returns `VaultFileInfo[]` — every file under the patient's vault directory, grouped by category subfolder. The patient folder name is computed via `vault.patientFolder(lastName, firstName, patientId)`.

### Component behaviour

- Shows all 6 standard vault folders (`xrays`, `photos`, `documents`, `lab_results`, `consents`, `referrals`) plus any extras found on disk
- Folders with files auto-expand on load; empty folders start collapsed
- **Single-click folder** → toggle expand/collapse
- **Double-click folder** → opens in OS Finder/Explorer via `openDocumentFile(absPath)` — uses `open_file_native` Tauri command (NOT `@tauri-apps/plugin-opener`)
- **Double-click file** → opens file with OS default app
- Folder labels are language-aware: resolved from `i18n.t.defaults.docCategories` (keyed defaults) — updates on language switch
- Header "Open patient folder" button opens the entire patient folder
- Back button at the bottom navigates to `/patients`

### PatientSidebar state

`activePatient = $state<Patient | null>(null)` — populated by a `$effect` that watches `activePatientId`: it first tries to find the patient in the already-loaded list, otherwise fetches via `getPatient(id)`. When `activePatient` is set the list view is replaced with `<PatientTreeView patient={activePatient} />`.

---

## Vault Path Change

Settings page (`src/routes/settings/+page.svelte`) — `handleChangeVault()`:

```typescript
const path = await pickDirectory();
if (!path) return;
await vault.configure(path);
resetDb();
window.location.reload();   // ← full reload; reinitialises sidebar + all stores
```

The `window.location.reload()` is critical — without it the patient sidebar keeps showing the old vault's data because the Svelte stores are still in memory.

---

## Timeline Auto-Scroll

`src/lib/components/timeline/TimelineView.svelte` — on initial load, the timeline scrolls to the bottom so the newest entries (added at the bottom) are visible. Key implementation details:

- `bottomAnchor` div is placed **after** the `h-56` spacer, not before it — otherwise scrollIntoView stops short by exactly the spacer height
- `behavior: 'instant'` — avoids a visible scroll animation on page open
- Scroll is deferred with `requestAnimationFrame` after `await tick()` — `tick()` alone is not enough; the browser needs to finish layout before `scrollIntoView` positions correctly

```typescript
if (scrollToBottom) {
    await tick();
    requestAnimationFrame(() => {
        bottomAnchor?.scrollIntoView({ behavior: 'instant', block: 'end' });
    });
}
```

---

## GitHub Actions / Windows Build

`.github/workflows/release.yml` — manual `workflow_dispatch` workflow that builds distributable installers on GitHub-hosted runners.

- **`windows-latest`** runner → produces `.msi` / `.exe` via `tauri-apps/tauri-action@v0`
- **`macos-latest`** runner → produces `.dmg` (native ARM64 / Apple Silicon)
- Triggered manually: **Actions → Release → Run workflow**, enter a version tag (e.g. `v0.1.0`)
- Creates a **draft GitHub Release** with installers attached — review and publish when ready
- Cannot cross-compile Windows from macOS locally (only `aarch64-apple-darwin` Rust target is installed); GitHub Actions is the correct path
- **`frontendDist` must be `"../build"`** in `src-tauri/tauri.conf.json` — relative to the `src-tauri/` directory, so it points to the project-root `build/` output. Using `"build"` (no `../`) caused CI failures because it resolved to `src-tauri/build/` instead.
- Universal macOS binary (`--target universal-apple-darwin`) was attempted but DMG bundling (`bundle_dmg.sh`) fails on GitHub Actions runners. Native ARM64 build is used instead.

---

## Vault Storage Structure

Everything lives in the single vault folder the user picks during onboarding:

```
{vault_folder}/
  dentvault.db              ← SQLite: all patients, timeline entries, treatment plans,
                               dental chart, perio, complications, AND all settings
  audit.jsonl               ← immutable append-only audit trail
  {Lastname_Firstname_ID}/  ← one folder per patient
    xrays/
    photos/
    documents/
    lab_results/
    consents/
    referrals/
```

The vault folder location is stored outside the vault in `{app_data_dir}/vault_path.txt` (e.g. `~/Library/Application Support/com.dentvault.app/vault_path.txt` on macOS). This is just a pointer — not patient data.

**A full backup = copy the vault folder.** The Backup Vault button automates this. Restoring = Settings → Change Vault → point to the backup folder.

---

## What to Build Next

**Phase 7 — Settings, Export & Multi-User Prep (remaining)**

1. **PDF patient summary export** — printable per-patient report (demographics + timeline + chart snapshot)
2. **Multi-user roles** — map existing `doctors` table to login/session concept; per-entry doctor attribution already in DB (`doctor_id` + `colleague_ids`)

**Clinical intelligence — remaining items**

3. **Make keyword mappings user-configurable** in Settings — practitioners add custom keyword→tag rules (the engine is in `src/lib/services/keyword-engine.ts`, just needs a Settings UI)
4. **Appointments & Recall** — appointment scheduling, recall reminders (deferred from Phase 7)
5. **Cost / Billing module** — per-treatment cost tracking, invoice generation (deferred)
6. **Time-series outcome survival curves** — 1/3/5-year tooth survival rates in Reports page
7. **Cohort comparison** — side-by-side group analysis (e.g., extraction vs non-extraction ortho)
