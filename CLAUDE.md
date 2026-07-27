# DentVault — Project Guide for Claude

## What is DentVault?

A cross-platform desktop dental patient management app for independent practitioners and small clinics.
Built with **Tauri 2 + SvelteKit + Svelte 5 + TypeScript + SQLite + Tailwind CSS v4 + shadcn-svelte**.

**Core principle**: Every piece of clinical data must be structured, tagged, and queryable — not buried in free-text notes. The app's primary long-term value is clinical outcome tracking and statistical analysis.

**Reference docs** (read these when working on specific areas):
- `docs/claude/DESIGN_SYSTEM.md` — **Design system specification**: color palette (warm paper + clinical teal + semantic colors), typography scale, component library, dark mode, layout patterns. Defines all Tailwind color tokens used throughout the app.
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
- **Colors**: hex-based CSS custom properties in `src/app.css` (see `DESIGN_SYSTEM.md` for the complete palette: warm paper, deep-pine sidebar, clinical teal primary, semantic colors for critical/warning/success/info, and procedure-type colors for endodontics/periodontics/orthodontics/prosthetics/hygiene). All components inherit from tokens—no hardcoded colors.
- **Theme switching**: `theme.svelte.ts` must set **all three** of `.dark` class (drives Tailwind `dark:` variants), `data-theme` attribute (drives the `:root[data-theme]` token override blocks in `app.css` — without it the `@media (prefers-color-scheme: dark)` block keeps every token dark when the OS is dark, so "light mode" only changed the few class-driven bits), and `style.colorScheme` (native form controls/scrollbars).
- **shadcn-svelte**: components at `$lib/components/ui/`, install with `npx shadcn-svelte@1.1.1 add <name> -y`
- **DB access**: exclusively through `src/lib/services/db.ts`, positional `$1, $2` params
- **`db.ts` is now a barrel** (`src/lib/services/db.ts` → `export * from './db-local'; export * from './db-core';`) — a Phase 0 step of `ROADMAP_MULTI_COMPUTER.md`. `db-local.ts` holds `runMigrations` and `getDb()` (solo-mode transport: local SQLite via tauri-plugin-sql). `db-core.ts` holds the 158 data functions, written against the `DataTransport` interface (`db-transport.ts`: `{select, execute}`) rather than the concrete `Database` class, so a future `db-remote.ts` (server transport) can be swapped in without touching db-core. All existing `import ... from '$lib/services/db'` call sites are unaffected — keep importing from `db.ts`, not the split files directly.
- **Migrations**: the DDL itself lives in `shared/schema-statements.json` (a `{latestVersion, statements: [{version, sql}]}` JSON file at the repo root, **not** inside `src/`) — `db-local.ts` imports it directly (`resolveJsonModule`), and `dentvault-server` (Rust) reads the identical file, so solo mode and connected mode apply byte-identical migrations with zero porting risk. Append new `{version, sql}` entries to the JSON array; **never modify an existing entry.** Update `latestVersion` after adding. Current version: **69**. Test every new migration's SQL against a copy of a real vault DB with the `sqlite3` CLI before shipping — SQLite rejects some common syntax (e.g. derived-table column-list aliases `AS t(a,b)`, which made v65 a permanent no-op until fixed). `shared/` sits outside SvelteKit's default dev-server `fs.allow` boundary (`src`/`node_modules`/`.svelte-kit` only) — `vite.config.ts` explicitly allows the project root (`server.fs.allow: ['.']`) so `npm run tauri dev` can read it; this only affects `dev`, not `npm run build`, which has no such middleware.
- **`getDb()` caches the handle only after `runMigrations` succeeds** — never assign `db` before migrations finish. The old order (assign, then migrate) swallowed the first migration error and served the unmigrated DB forever after, silently freezing vaults at an old schema version with no visible error.
- **v69 — dormant optimistic-concurrency version columns** (`ROADMAP_MULTI_COMPUTER.md` Phase 0, §3.6): `appointments`, `schedule_blocks`, `timeline_entries`, `treatment_plans`, `treatment_plan_items`, `dental_chart` each gained `version INTEGER NOT NULL DEFAULT 1`. Not enforced yet — nothing reads or bumps it today. Phase 2's connected-mode writes will send the version they read and the server will reject on mismatch (409 → refetch/retry UX). Scoped to the tables §3.6 flags as conflict-prone (viewed and edited concurrently all day), not literally every mutable table.
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

### Fixed UI bars & the resizable sidebar

`position: sticky` inside a `flex-col` that's inside the layout's `h-full` wrapper fails at the bottom of long content — use `fixed` instead.

**The sidebar is user-resizable** (`sidebarWidth.svelte.ts` store — 180–480px, default 224, double-click the right-edge drag handle in `+layout.svelte` to reset; persisted to localStorage only, deliberately not the vault DB since width is display-specific). Any fixed-position element that must start where the sidebar ends **must NOT hardcode `left-56`** — bind `style="left: {sidebarWidth.px}px"` instead. Current bindings:
- **Bottom bar** (`TimelineEntryBar`): `fixed bottom-0 right-0 z-40` + dynamic `left`
- **Top toolbar** (`TimelineView` filter/search bar): `fixed right-0 z-10` + dynamic `left`, `top` set via inline `style="top: {headerHeight}px"` prop
- **OS-drop overlay** (`TimelineView` `isDragOver`): `fixed inset-y-0 right-0 z-50` + dynamic `left`

The sidebar resize handle divides `e.clientX` by the root `zoom` (uiScale) — pointer coords are visual px, layout px are scaled (see the zoom rule below).

The patient page (`+page.svelte`) measures the sticky patient header's actual rendered height with a `ResizeObserver` and passes it as `headerHeight` to `TimelineView`. This keeps the toolbar correctly positioned below the patient header at all window widths, even when the header wraps at narrow sizes.

**Minimum window size**: `820 × 560 px` (set in `src-tauri/tauri.conf.json`). Design and test all fixed/sticky UI at this width and at the sidebar's max width. Content area at min-width, default sidebar = `820 − 224 (sidebar) − 48 (p-6 × 2) = 548 px`.

**Root-zoom coordinate rule (uiScale)**: `uiScale` sets `zoom` on `<html>`, so `getBoundingClientRect()`/`clientX/Y` (visual px = layout × zoom) disagree with `style.left/top`/`offsetWidth` (layout px) everywhere in the app. Any popup/overlay positioned from selection or pointer coordinates must divide rect differences by `parseFloat(document.documentElement.style.zoom || '1')` — and prefer `position:absolute` inside a relative container over `position:fixed` + body-append (the error compounds toward the bottom of the screen; this is what pushed the text color picker off-screen from the composer). Same class of bug as the ceph route's full-window geometry.

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

**Section toggles**: `demographics`, `medical`, `notes`, `ortho`, `chart`, `timeline`, `perio`, `plans`, `documents`, `par`, `appointments`. Medical section also exports acute/medical clinical tags; perio exports recession (`pd/rec`), mobility, furcation.

### Rules
1. New patient data source → add to `gatherExportData()` + `PatientExportData`
2. New timeline entry type → `renderTimeline()` must handle it
3. New dialog/section → add `render*()` function; include in `generatePatientHTML()`
4. New fields on existing table → update relevant `render*()` function
5. No silent omissions — if a field exists in the UI it must appear in the export

### File-path invariants (July 2026 audit)
- **Attachment/document hrefs use `pathInPatientFolder(path, patientId)`** — path within the patient folder, anchored on the segment ending in the patient id, works for absolute (legacy) and vault-relative inputs at any subfolder depth. The old "take the parent dir" (`slice(-2, -1)`) broke every file living in a category *sub*folder (`xrays/2023/scan.png` → `src="2023/scan.png"`); it survives only as the fallback for paths missing the patient folder.
- **Non-image attachments render as links** (`.attachment-file`) into the copied folder tree — images stay inline `<figure>`s. `copy_patient_folder_to` copies category folders recursively (`copy_dir_all`), so subfoldered targets exist in the export.
- **`titleIsRedundant()` mirrors `TimelineEntryCard`** — auto-generated titles that repeat the description's first words are skipped in `renderTimeline` too; empty `entry_type` renders no badge (composer entries save `''`).
- Rich text (colors, semi-transparent highlights, strikethrough) reaches the export automatically — `entry.description` is inserted as raw HTML on a white page, so the rgba highlight tints stay readable.

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

Migrations in `shared/schema-statements.json` (read by both `db-local.ts` and `dentvault-server`). **Never modify existing migrations.** `latestVersion = 69`.

**Key tables:** `patients`, `timeline_entries`, `treatment_plans`, `treatment_plan_items`, `documents`, `dental_chart`, `settings`, `doctors`, `ortho_classifications`, `entry_teeth`, `complications`, `dental_chart_history`, `probing_records`, `probing_measurements`, `probing_tooth_data`, `patient_conditions`, `appointment_rooms`, `appointments`, `schedule_blocks`, `staff_blockouts`, `doctor_working_hours`

**`appointment_types`** has an `icon TEXT NOT NULL DEFAULT ''` column (v64) — emoji displayed in appointment blocks. Joined as `type_icon` on `Appointment`. Note the app has exactly ONE type list, not two — `entryTypes.svelte.ts` is a thin derived view over `appointmentTypes` ("One list controls both timeline entry categories and appointment types," per its own doc comment and `settings.entryTypes.description`); there's no separate `entry_types` table. `icon` (emoji) is what `AppointmentBlock.svelte` renders on calendar blocks; `short_name` (2-3 chars) is what `entryTypes.iconFor()`/`TimelineEntryCard`'s dynamic badge config renders in the timeline — the two fields serve different UI surfaces, both exist so a type is identifiable either way, and both are user-editable per type in Settings › Entry & Appointment Types (`maxlength="3"` enforced on the short_name input; the section description spells out the 2-3 char + emoji convention for anyone adding a custom type).

**Default seed set** (July 2026 — `i18n.t.defaults.appointmentTypes`, English-only per the i18n rules, `AppointmentType.icon` populated for the first time): 14 entries — Check-up 🦷 Cu, Cleaning 🪥 Cl, Consultation 💬 Co, X-ray 🩻 Xr, Filling 🔧 Fi, Root Canal 🩹 RC, Extraction ⛏️ Ex, Crown 👑 Cr, Denture 😬 De, Implant 🔩 Im, Perio Therapy 🩸 Pe, Ortho Check 📐 Or, Emergency 🚨 Em, Follow-up 📋 Fu — chosen to cover every `TreatmentCategory` (types.ts) at least once and ordered roughly by real-world frequency in general dental practice. `appointmentTypes.svelte.ts`'s `load()` only seeds these into a brand-new, empty `appointment_types` table — existing vaults are never retroactively touched, and every field stays fully user-editable/deletable afterward (Customizability First rule).

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

**`!TEMPLATE` on disk is the single source of truth for a new patient's starting folder structure** — `patients/new/+page.svelte` calls `copyTemplateToPatient()` → Rust `copy_template_to_patient`, which mirrors whatever subfolders currently exist under `!TEMPLATE` (via the same recursive `copy_dir_all` the HTML export's `copy_patient_folder_to` uses), **including nested sub-subfolders** (e.g. `!TEMPLATE/xrays/Panoramic/`) — since `!TEMPLATE` shows up in the sidebar file tree like any other patient folder, users routinely create nested structure in it the same way they would in a patient's own folder. A prior version only copied one level deep (top subfolder + its direct files, no recursion), so a nested folder added under `!TEMPLATE` silently never reached new patients — this is why editing `!TEMPLATE` could look like it "didn't do anything." The hardcoded 6-folder fallback (`xrays/photos/documents/lab_results/consents/referrals`, built from `docCategories.list`) is used **only** if `!TEMPLATE` doesn't exist at all yet — never as a partial substitute alongside an existing template. An older `init_patient_folder` Rust command did the same always-hardcoded-6-folder creation with zero regard for `!TEMPLATE`; it had zero frontend callers (dead since `copy_template_to_patient` was built) and was deleted (July 2026) rather than left around as a "simpler" alternative someone might wire up by mistake.

**The sidebar tree itself had a second, separate bug that made the above fix look like it hadn't worked** (July 2026): `PatientTreeView.svelte`'s `buildPatientTree` used to hardcode a placeholder node for **every** configured `docCategories` folder ("Always include all standard category folders (even if empty)"), regardless of whether that folder actually existed on disk for the patient — so even after `copy_template_to_patient` correctly stopped creating a folder the user had deleted from `!TEMPLATE`, the sidebar still showed it as a row, because the tree was never actually reading the disk. Fixed by sourcing the tree from `listPatientFolders()` → Rust `list_patient_folders`/`scan_folders` (the same live recursive folder scan `VaultDropDialog`'s folder-tree picker already used) instead of the hardcoded `docCategories` list — a category folder now shows (even empty) exactly when it's really there. `standardFolders` (from `docCategories`) is still used, but only to decide **display order** for whichever real folders happen to match a configured category name — not to fabricate rows for folders that don't exist. `refreshFiles()` now calls `listPatientFolders` alongside `listVaultFiles` each refresh, storing the result in `folderTree` state.

**Never point the vault at a network share (SMB/NFS/CIFS/AFP/WebDAV).** SQLite's file locking is broken over network filesystems and *will* silently corrupt `dentvault.db` under concurrent writers (`ROADMAP_MULTI_COMPUTER.md`, "Option A — REJECTED"). `vault.configure()` (`src/lib/stores/vault.svelte.ts`) is the single choke point for setting the vault path — it calls the Rust `is_network_mount` command (`src-tauri/src/lib.rs`, parses `mount` output on macOS/Linux, checks UNC-path/`fsutil fsinfo drivetype` on Windows) and throws before persisting if the path is network-mounted. `OnboardingWizard.svelte` also checks at folder-pick time (step 1) for immediate feedback instead of failing at the final `finish()` step. Best-effort by design: a detection failure (missing `mount`/`fsutil`, unexpected output) reports `false` rather than blocking a legitimate local path.

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
  (toggle + highlight). See "Image Analysis Entry Points" below for how selecting a file
  routes into Ceph / X-ray Report / Facial Analysis — the three no longer have separate
  toolbar buttons.
- **Ceph route** (`src/routes/patients/[patient_id]/ceph/+page.svelte`): full-window
  `fixed inset-0 z-[45]` iframe, no DentVault header — the Cephalyzer logo also acts as a
  back button (posts `NAVIGATE_BACK`); Escape works on both sides of the boundary. A small
  floating circular back-arrow button (`absolute top-3 left-3 z-[50]`) is layered on top of
  the iframe as an explicit affordance, since the logo alone didn't read as "back" to users.
  The page neutralizes the UI-scale zoom (`documentElement.style.zoom = '1'`) while open and
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
- **Saved `.ceph`/PDFs are auto-tracked** (see "Auto-tracking files added outside the app"):
  they get a `documents` row + generic `document` timeline entry and appear in the HTML
  export (timeline attachment link + Document Index). **Still open for Phase 1 of the
  roadmap**: a dedicated `ceph_analysis` entry type with parsed measurements in
  `chart_data`, `CephSnapshotCard`, and a `renderCeph()` export section.
- **Dev ports**: 5173 belongs to this app's Tauri `devUrl` (strictPort); Cephalyzer's dev
  server is pinned to 5175; automated browser tests run a second instance via
  `npm run dev -- --port 4998`. Never kill vite processes broadly — a dead 5173 server
  leaves a running window that 500s on every lazily-loaded route.
  `npm run tauri dev` fails outright with `Error: Port 5173 is already in use` if anything
  else holds that port — observed in practice with a stray Cephalyzer vite instance started
  with an explicit `--port 5173` override (its 5175 pin is just its default, not enforced).
  Before killing whatever's on 5173, `lsof -i :5173 -sTCP:LISTEN` and `ps -p <pid> -o command`
  to confirm it's not the user's own live session (Cephalyzer or otherwise) — it may not be a
  DentVault process at all, so don't assume and don't kill without checking first.

---

## Image Analysis Entry Points (Ceph / X-ray Report / Facial Analysis)

Three image-analysis destinations (Cephalometric Analysis, Facial Analysis, X-ray Report) share
one selection store (`cephSelection.svelte.ts`) and one picker component — **do not reintroduce
three separate toolbar buttons**, that was the pre-July-2026 design and was deliberately combined
because it crowded the toolbar.

- **`$lib/components/imaging/AnalysisTypeMenu.svelte`** is the single source of truth for the
  3-item list, per-item enablement, icons/colors, and navigation. Props: `onClose`, `showHeader`
  (sidebar popup shows an "Analyze as" label, the toolbar dropdown doesn't), `panelClass`
  (caller-supplied positioning — it renders itself `position: absolute; z-50`, so callers must
  wrap it in a `position: relative` container). It reads `cephSelection.file` /
  `.isAnalyzable` / `.isImage` reactively itself — callers never pass the file in. Ceph is
  enabled for `isAnalyzable` (image or `.ceph`); Facial Analysis and X-ray Report require
  `isImage` (excludes `.ceph`). Adding a fourth analysis type = add one entry to this component's
  `items` array, nothing else.
- **Toolbar** (`TimelineView.svelte`): one neutral "Analyze" button (no color accent — the three
  destinations each still get their own accent color inside the dropdown) with a chevron, next to
  Ortho. Toggles `analyzeMenuOpen`; renders `AnalysisTypeMenu` with `panelClass="top-full mt-1
  right-0"` when open. i18n: `imaging.analyzeButton` / `imaging.analyzeAs`.
- **Sidebar popup-on-select** (`PatientTreeView.svelte`): `cephSelection.toggle(file)` returns a
  `boolean` — `true` only on a FRESH select (unselected → selected), `false` on deselect. The
  file row's click handler opens `AnalysisTypeMenu` (anchored `top-full left-0 mt-1` off that
  specific row, which needs `position: relative`) only when the toggle returned `true` AND
  `cephSelection.isAnalyzable` is true — never on deselect or shift-click multi-select. This
  includes `.ceph` files (July 2026 correction — they used to be excluded on the theory that
  "only one destination applies, so there's nothing to pick," but users expect the same
  load-into-Cephalyzer confirmation for `.ceph` as for images; the menu just shows Facial
  Analysis/X-ray Report disabled since those require `isImage`). A `suppressAnalyzePopup`
  flag set in the drag-end handler (`onGlobalMouseUp`) prevents the popup from opening as a side
  effect of the `click` event that still fires after a drag-move's `mouseup` — without it, every
  file drag would also pop the picker open on release.
- Both the toolbar dropdown and the sidebar popup coexist by design — the popup is a fast path
  for "I just clicked this file to analyze it right now"; the toolbar dropdown covers "I already
  selected a file earlier and want to analyze it now."

---

## X-ray Report (general/panoramic X-ray PDF reports)

Native full-screen viewer + written report → A4-landscape PDF, for any X-ray image (not just cephs).

- **Entry**: select an image in the sidebar file tree — see "Image Analysis Entry Points" above.
- **Viewer** (`src/routes/patients/[patient_id]/xray-report/+page.svelte`, `FullScreenView`, no iframe): interaction mirrors Cephalyzer's `ImageCanvas` — wheel zoom 0.12 step clamped [0.1, 5], `Z`/`B`/`C` toggle drag-adjust modes (zoom / brightness / contrast, mode auto-clears after one drag), `Escape` clears the mode **with `preventDefault()`** so `FullScreenView` doesn't also navigate back, right-drag pans. Pointer deltas are divided by the root zoom per the uiScale rule; the root zoom is NOT neutralized (unlike the ceph route). Report box = `FloatingPanel` (textarea + Generate); closing it shows a "Report" reopen button in the header.
- **Generate** (`generateXrayReportPdf` in `src/lib/services/xray-report-pdf.ts`, jsPDF): A4 landscape, header = patient name + date (the entry's date on re-generate, so the printed date stays stable), image fitted to width and capped at 60% of page height, text flows to continuation pages (never truncates). PDF written next to the source X-ray as `{basename}_report.pdf` via `write_base64_file` (overwrite = re-generate), then a `documents` row is ensured by `rel_path` **before** returning to the patient page so the auto-tracker doesn't create a duplicate generic entry. Deliberately no `document_id` on the entry — `deleteDocument` would cascade-delete the report.
- **One `xray_report` entry per source image** (in `SYSTEM_ENTRY_TYPES`): `description` = HTML-escaped text with `<br>`, `chart_data` = `{source, pdf, text}` (raw `text` reloads into the textarea on reopen), `attachments` = vault-relative `[{path,name,mime,size}]` (PDF + source X-ray). Lookup via `getXrayReportEntryForSource(patientId, sourceRelPath)` — SQL filters `entry_type = 'xray_report'` with positional params, JS matches `chart_data.source` (never `LIKE` on serialized fields). `entry_date` set on create, kept on update.
- **Export**: `renderTimeline` maps the badge to "X-ray Report"; both attachments flow through the existing figure/link rendering. **Known gap**: `TimelineEntryCard` renders attachment rows only for `document` entries, so the card shows badge/title/text but no inline file rows (files remain reachable via the sidebar tree and the HTML export).
- i18n block: `xrayReport.*`.

## Facial Analysis (extraoral photo evaluation)

Third native image-analysis mode alongside Ceph Analysis (embedded Cephalyzer) and X-ray Report.
Full design doc: `ROADMAP_FACIAL_ANALYSIS.md` (orthodontic background, landmark vocabulary,
AI-trainability requirements, phases). Phases F0–F2 shipped July 2026; F3 (dataset export) and
F4 (auto-place model, frontal-smile view) are still open.

- **Shared viewport**: `src/lib/components/imaging/ImageViewport.svelte` was extracted from
  X-ray Report's viewer (wheel zoom / Z-B-C drag-adjust / right-drag pan / root-zoom-corrected
  pointer deltas — same interaction model as Ceph's `ImageCanvas`) so both routes share one
  implementation. Its `children` snippet renders inside the same zoom/pan-transformed,
  natural-pixel-sized wrapper, so overlay content (landmark dots) authored in image-pixel
  coordinates stays glued to the image at any zoom/pan. `onImageClick(x, y)` fires natural-image
  coordinates on a plain left click (movement < 5px, no active drag-adjust mode).
- **Entry**: same `cephSelection.isImage` gate as X-ray Report — see "Image Analysis Entry
  Points" above; navigates to `patients/[patient_id]/facial-analysis?file=<vault-relative-path>`
  with no view param. The route itself decides: if a `facial_analysis` entry already exists for
  that source image, its saved `view` loads directly (skipping the chooser); otherwise a small
  dialog picks Profile/Frontal before landmark placement starts.
- **Layout**: the Landmarks checklist is a `FloatingPanel` (draggable, like X-ray Report's report
  box), but the Measurements panel is a **static, non-draggable right-side sidebar** (`<aside>`,
  fixed 360px width, `shrink-0`) — not a `FloatingPanel`. This was a deliberate correction (July
  2026): measurements are a reference the user checks constantly while placing landmarks, so
  they shouldn't be movable/closable clutter. `ImageViewport` and the sidebar sit in a shared
  `flex-1 min-h-0 flex` row so the viewer's `ResizeObserver`-driven fit recomputes correctly
  against its now-narrower share of the width. Do not convert the Measurements sidebar back into
  a `FloatingPanel`, and do not apply this static treatment to the Landmarks panel unless asked.
- **Landmark placement** (`LandmarkLayer.svelte`): guided sequential queue driven by
  `FACIAL_TEMPLATES[view].landmarks` (fixed order) — one active landmark at a time with a
  name+hint card, click-to-place auto-advances to the next unplaced one, a checklist alongside
  shows progress and lets you jump back. Every placed dot stays individually draggable
  (`setPointerCapture` on the dot's own `<g>`, `stopPropagation` so a drag never triggers a
  stray placement) — the SVG root itself is `pointer-events: none` so clicks pass through to the
  viewport except where a dot explicitly opts in.
- **Profile facing-direction**: no detection heuristic — a `⇋ Flip` button (profile view only)
  mirrors the working image via canvas (`ctx.translate/scale(-1,1)`) and re-expresses every
  placed landmark's x-coordinate (`naturalWidth − x`) into the flipped frame, so landmarks are
  always stored in one canonical face-right frame regardless of source orientation. This is the
  ONLY coordinate frame used anywhere (display, placement, PDF annotation) — no dual-frame math.
- **Measurement engine** (`src/lib/services/facial-measurements.ts`, pure functions): profile
  (17 landmarks) and frontal (23 landmarks) templates with fixed placement order, plus
  `computeMeasurements(view, landmarks)` — gracefully skips (never throws) any measurement whose
  required landmarks aren't placed yet. Angles/ratios/relative-line-distances only (photos have
  no mm scale) — `mm`-unit measurements store raw pixel-space values, a documented limitation.
- **PDF** (`facial-analysis-pdf.ts`, sibling to `xray-report-pdf.ts`): A4 landscape, annotated
  image (canvas-flattened image + landmark dots/lines/labels, built by the route via
  `buildAnnotatedImage()`) in the left column, measurement table with norm bands in the right
  column, notes printed as a "Clinical Notes" section below. Written next to the source photo as
  `{basename}_facial.pdf`; same `documents`-row-before-return auto-tracker dodge and no
  `document_id` on the entry (cascade-delete trap) as X-ray Report.
- **One `facial_analysis` entry per source image** (in `SYSTEM_ENTRY_TYPES`), `chart_data` =
  `FacialAnalysisChartData` (`$lib/types.ts`) — `schemaVersion`, `view`, `mirrored`,
  `landmarks: Record<id, {x,y,placedBy,confidence}>`, `measurements`, `notes`. This IS the future
  AI-training data format: landmarks in natural-image pixel coords, closed stable id vocabulary,
  `placedBy: 'human' | 'ai'` so a future auto-place model's suggestions and the user's
  corrections both stay labeled. Lookup via `getFacialAnalysisEntryForSource` (mirrors
  `getXrayReportEntryForSource` — positional params, JS-side `chart_data.source` match, never
  `LIKE` on serialized fields).
- i18n block: `facialAnalysis.*` (chrome only — landmark/measurement display names live in the
  template tables, not i18n, per the Customizability/i18n rules).

## Sidebar Navigation

Left sidebar (`src/routes/+layout.svelte`): `{#each primaryNav}` rows with icon + label — Dashboard / Patients / Schedule / Reports, then Settings after a hairline divider (`border-t border-sidebar-border/60`). Active state: left accent bar + `bg-sidebar-accent`. `{@const}` tags must be INSIDE `{#each}` blocks — for the Settings link (outside loop), use inline expressions directly.

**PAR is archived for v1** — parked, not fixed. `components/par/`, `par_*` DB tables/functions, and `par_step` timeline rendering in `TimelineView.svelte` are untouched — only the dead `ParCaseView` import/`showPar` state on the patient page were removed (the entry point was already unwired). Known bug: case-completion never sets `ParStatus: 'ended'` so `lockParCaseAssessments()` never engages — fix when un-archiving.

**Reports is no longer archived** — `/reports` is now the Doctor Performance Analytics dashboard (nav link restored). The old clinical filter report and its dead code (`getFilteredEntries`, `getFilteredSummary`, `ReportFilters`, `ReportEntry`, `entriesToCSV`, `downloadCSV`) were deleted.

**No "Back to List" button in the patient sidebar** (`PatientTreeView.svelte`) — removed as redundant with the main nav's "Patients" link. Don't re-add it.

## Dashboard

`/dashboard` (`src/routes/dashboard/+page.svelte`) lays out a `grid gap-6 lg:grid-cols-[1fr_320px]` — a flexible left column of chart cards (Procedures by Category, Outcome Analysis) next to a fixed 320px right column stacking Upcoming Appointments (`getUpcomingAppointments(8)`) above Recent Activity (`getRecentEntries(12)`).

**Both right-column lists are height-capped** (`max-h-[336px] overflow-y-auto`, July 2026 fix) — they previously had no height limit, and Recent Activity's multi-line rows (name, category badge, title, tooth numbers, date) at up to 12 items could grow far taller than the left column's chart cards next to it, making the whole right column look stretched/disproportionate. Capping bounds both cards to a consistent height matching the rest of the dashboard; overflow scrolls internally instead of pushing the card taller. If you add more fields to either row template, keep this in mind — taller rows just mean the scrollbar kicks in sooner, not a growing card.

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
- **`OnboardingWizard.finish()` must reload `rooms`/`appointmentTypes`/`workingHours`/`noShowThreshold` after configuring the vault** (July 2026 fix) — `+layout.svelte`'s `onMount` calls every store's `.load()` once, unconditionally, before the vault exists (hitting a throwaway fallback `sqlite:dentvault.db` in the app-data dir via `get_db_url`'s no-vault branch). `rooms.load()` and `appointmentTypes.load()` both auto-seed defaults when their table is empty, so this pre-vault call seeds phantom defaults into that fallback DB and leaves the in-memory stores holding them. `finish()` then inserts the user's actual chosen rooms straight into the real vault DB (bypassing the `rooms` store), but its post-configure reload (`Promise.all([docCategories.load(), doctors.load(), ...])`) didn't originally include `rooms`/`appointmentTypes`/`workingHours`/`noShowThreshold` — so the Schedule tab kept showing the stale pre-vault state (usually zero real rooms) right after setup, which is exactly what led a real user to manually create duplicate rooms on top of the ones the wizard had already created. Fixed by adding those four `.load()` calls to `finish()`'s reload (and mirrored in the "join existing server" `handleJoinServer()` path, same staleness issue in connected mode). If you add another store with an auto-seed-on-empty `.load()`, make sure it's in both reload lists too.
- **Practice-wide working hours live under `'team'`, not `'schedule'`** (July 2026 move) — the clinic-wide default-hours editor (`localWorkingHours`/`handleSaveWorkingHours`, unchanged logic) used to be its own section under Schedule, visually identical to every other card on the page even though it wasn't per-staff data; that made "Staff Members & Hours" (the actual nav label — see `settings.sections.staffAndHours`) misleading, since the "Hours" it promised weren't on the Team page at all. It's now the first box in `'team'`, right after the section header, styled with an accent border/background/clock icon and its own heading (`i18n.t.settings.schedule.practiceHoursTitle`) so it doesn't read as one more staff row; a plain "Staff Members" label (`i18n.t.staff.membersLabel`) sits between it and the existing staff-list card to make the split explicit. The Schedule section's own Working Hours sub-nav entry was removed from the home overview grid along with the now-dead `settings.sections.workingHours` i18n key (it never referred to anything else). Component state (`localWorkingHours`, `workingHoursSaving`/`Saved`, `handleSaveWorkingHours`) didn't move — it was already section-agnostic top-level `$state` in the same file, only the markup did.
- **"Reveal the add-form" button vs. "commit the new item" button must never share a label** (July 2026 fix) — Rooms, Entry & Appointment Types, Appointment Statuses, Staff Members, and Document Categories all use the same two-step pattern (a button toggles an inline form open, the form itself has its own commit button), and in every one of these five sections both buttons said the exact same thing ("Add", or "Add Staff Member", or "Add Category") — a real user reported not being able to tell which button actually created the thing. Fixed by giving each pair distinct roles: for the three generic ones (Rooms/Appointment Types/Appointment Statuses), the reveal button changed from bare "Add" to **"+ New"** (`i18n.t.actions.new`, plus a `+` SVG icon matching the affordance already used elsewhere in this file) while the form's commit button stays `i18n.t.actions.add`; for Staff Members and Document Categories, the reveal button was already specific enough ("Add Staff Member"/"Add Category", left unchanged) so instead the *form's* commit button was changed down to generic `i18n.t.actions.add`. Net rule for this file: "Add" always means "commit," never "open a form."

---

## Timeline — Key Architecture Notes

### Filter system
`TimelineView.svelte` derives `availableTypes` from the patient's actual `entries` array — only types that exist, with counts. No static category buckets. Active filters stored in `typeFilters: Set<string>` containing raw `entry_type` values.

`typeLabel(key)` maps entry_type values to display labels:
- `''` → "Unclassified", `'document'` → "Documents", `'chart_snapshot'` → "Chart Snapshots", `'ortho_snapshot'` → "Ortho Records", `'plan'` → "Treatment Plans", `'xray_report'` → "X-ray Reports", anything else → `entryTypes.labelFor(key)` (handles legacy keys + current appointment type names).

When `typeFilters.size > 1`, the filter button shows a compact `N types` badge instead of all labels, to stay within the toolbar's available width.

### Timeline entry bar
No title field — `autoTitle(bodyText, date)` always generates the title on save (still stored/exported, but `TimelineEntryCard` hides it in the card whenever it's a whitespace/markup-insensitive prefix of the description — showing it would just repeat the opening line). ⌘B/⌘I/⌘U and ⌘⇧X (strikethrough — clinical convention: retracted text stays visible, struck through) are handled explicitly in `handleDescriptionKeydown` via `execCommand` — WKWebView under Tauri doesn't deliver them to contenteditable natively. Selecting text pops the formatting bar (`TextColorPicker.svelte`): B/I/U/S buttons, configurable text-color circles (`textHighlightColors` store — despite the name these are FORE colors), fixed highlighter squares (semi-transparent `rgba` tints so the theme's own text color stays readable in both modes — do not switch to opaque marker colors), and a clear-formatting button (⌘\) that strips everything via `execCommand('removeFormat')` + an explicit underline toggle-off. Never "remove" a color with `foreColor 'inherit'` / `hiliteColor 'transparent'` — execCommand nests the new wrapper INSIDE the colored span, so those values resolve to the very color being removed and nothing visibly changes. The popup mounts inside the composer box with zoom-corrected absolute positioning (see the root-zoom coordinate rule). Highlights/strikethrough reach the HTML export automatically — `renderTimeline` inserts `entry.description` HTML raw. No date or entry-type field either — every entry from this bar saves with `entry_type: ''` (the existing "Unclassified" state, already handled throughout filters/badges) and today's date; there is nothing to pick from a persistent metadata row anymore. Triggers: `/` for text blocks, `@` for staff mentions, `d15`-style for teeth. No `#` trigger in the bar (conditions are tagged in the Acute/Medical boxes instead).

Tagged doctors (via `@mention` or the staff picker) and detected tooth numbers render as **floating pills** overlapping the top edge of the documentation box (`absolute -top-3`) instead of a metadata bar above it — they only appear once something is actually tagged. The "add staff" trigger is a small dashed-circle icon button floating at the top-right of the box; its dropdown opens upward from there. `TimelineEntryCard.svelte` mirrors this for saved entries — tagged doctors (primary + colleagues, both) render as solid-colored pills floating over the top-right of the description text, not as a separate meta line.

### Chart snapshot reports (`generateChartReport`, `chart-report.ts`)
Closing the dental chart after edits auto-saves a `chart_snapshot` timeline entry (`TimelineView.svelte`'s `chartSheetOpen` effect) whose `description` is a plain-text summary built once at save time by `generateChartReport(chartData)` — it is **not** re-derived at render time, so fixing the generator doesn't retroactively fix already-saved entries.

**`isArchPlaceholderMissing()` exclusion (July 2026 fix)**: the dental chart's arch-setup step (`DentalChartView.svelte`, picking Permanent/Mixed/Primary dentition) marks every tooth of the *other* dentition as `condition: 'missing'` as a bookkeeping placeholder — e.g. choosing "Permanent" marks all 20 primary teeth missing, since they're expected to be absent, not because anything was clinically found. `generateChartReport` used to treat any non-`'healthy'` condition as "notable" unconditionally, so every permanent-dentition chart snapshot printed 20 lines of `NN (Primary dentition): Missing` — pure noise, and it bloats the timeline entry. Fixed by excluding any `'missing'`-condition tooth that has no notes, no surface tags, and no bridge group (`isArchPlaceholderMissing`) — the exact same predicate `DentalChartView.svelte`'s DMFT calculation already used to exclude these placeholders from its M count, now applied consistently in the report generator too. A tooth manually tagged "Missing" by a clinician (typically with at least a note) still reports normally; only the synthetic whole-dentition placeholder sweep is suppressed. Existing snapshot entries saved before this fix keep their stored bloated description until the chart is opened and closed again for that patient (which regenerates it).

### Acute Problems & Medical History boxes
Both boxes (`AcuteProblemsBox.svelte`, `MedicalHistoryBox.svelte`) support `#word` typing in their textarea to trigger an inline condition autocomplete palette. Selecting a condition: activates the tag + replaces `#query` with `#Label` in the textarea. Creating a new condition: adds it to the `acuteTagOptions`/`medicalTagOptions` store. Active tags shown as removable colored pills below the textarea. The `#` hint is in the textarea placeholder text (second line). No separate "add condition" button.

- **Do not toggle-remove a tag when the user selects it from the palette** — `selectCondition` checks `!activeTags.includes(tag.key)` before calling `toggleTag`.
- Suggestion list renders in **normal document flow** (not `position: absolute`) — the outer box has `overflow-hidden` so it clips content, not the inline palette.

### Floating patient panels
Acute Problems, Medical History, and Notes render as **`FloatingPanel`** instances on the patient page (`src/lib/components/ui/FloatingPanel.svelte`) — draggable, resizable floating windows with no backdrop. Positions staggered at `(panelBaseX, 90)`, `(panelBaseX+40, 130)`, `(panelBaseX+80, 170)` where `panelBaseX = Math.max(20, floor(innerWidth/2) − 210)`.

`FloatingPanel` internals: drag via pointer events + `setPointerCapture` on the title bar; resize via CSS `resize: both`; a `ResizeObserver` reads `offsetWidth/offsetHeight` back into `$state` on every resize — required because CSS resize writes inline style that Svelte's reactive style binding would otherwise overwrite on re-render, snapping the panel back. Dims to 40% opacity on document `wheel` (capture) or outside `mousedown`; `onmouseenter` restores. `initialX`/`initialY` must be read through `untrack()` in the `$state()` initializers.

**Panel content scaling**: box components inside `FloatingPanel` use `h-full flex flex-col` on the outer div and `flex-1 min-h-[...] resize-none` on the textarea so content fills the resizable panel and scrolls internally. The old JS `autoResize()` (textarea auto-grow) was removed from the boxes — do not reintroduce it; it fights flex sizing.

### OS file drag-and-drop → VaultDropDialog
In-app drops open a folder-picker dialog before filing the document; **files added any other way** (Finder, a Ceph analysis save) are picked up automatically by the auto-track mechanism below — see that section for how the two stay non-overlapping. The old interactive review-wizard system (`NewFilesDialog`, `checkNewVaultFiles`, `scanVaultForUntrackedFiles`, `getTrackedFilePaths`, the amber "files found in vault" banner, one-file-at-a-time date/category/staff form) is still fully removed — **do not re-implement that wizard UI**; the replacement below is deliberately silent, not a review step.

- **Tauri WKWebView rule**: `dataTransfer.files` is always empty — Tauri intercepts OS drops natively. `TimelineView.svelte` listens to `tauri://drag-enter` / `drag-leave` / `drag-drop` (from `@tauri-apps/api/event`) in `onMount` (with unlisten cleanup) and opens `VaultDropDialog` with `event.payload.paths`.
- **`VaultDropDialog.svelte`** (`src/lib/components/timeline/`): folder-tree picker (Rust `list_patient_folders`), inline subfolder creation (`create_patient_subfolder`), pointer-based drag-to-reorganize of folders (`move_patient_folder`). Saving copies each file via `copy_file_to_vault`, then `insertDocument` + a `document` timeline entry.
- **Vault-relative paths**: `rel_path` in `documents` and `path` in the `attachments` JSON must be relative to **vault root** — `{patientFolder}/{selectedFolder}/{filename}` — so `toAbsPath(relPath, vault.path)` resolves thumbnails correctly.
- **Folder drag targets**: `data-folder-rel` attributes mark drop targets for `elementsFromPoint`; empty string `""` is the valid patient-root target, so destination checks must use `dest === null`, never `!dest`.
- **Never use HTML5 `draggable="true"`** for in-app drags — it fires `tauri://drag-enter` and confuses the OS-drop overlay. Use pointer events + `setPointerCapture`.

### Auto-tracking files added outside the app (Finder, Ceph saves)
`PatientTreeView.svelte`'s `autoTrackUntrackedFiles()` runs after every `refreshFiles()` (on mount and on the 2s poll) — compares the fresh `list_vault_files()` result against `getDocuments(patientId)` by `rel_path`, and for any file on disk with no matching `documents` row, silently creates one (`category` inferred from the file's top-level folder via `folderToKey`, `mime_type` via `getMimeType`) plus a generic `document` timeline entry (`entry_date` = the file's mtime, falling back to today). No dialog, no per-file review — this is intentionally silent, unlike the removed `NewFilesDialog` wizard.

- **Why in-app drops don't get double-tracked**: both `VaultDropDialog` and the template-drop flow (`performDrop` in `PatientTreeView.svelte`) call `insertDocument` *before* the next `listVaultFiles()` refresh, so by the time `autoTrackUntrackedFiles` runs, the file is already in `documents` and gets skipped.
- **Backfill is implicit, not a separate pass**: there's no "first run" flag — any file untracked at the time this code runs (whether it's brand new or has been sitting in the vault since before this feature existed) gets tracked the same way. A patient with old untracked Finder-dropped files will get a batch of entries the first time their page loads after this shipped.
- **Scope**: only runs while a patient's own timeline page is mounted (that's where the poll lives) — not while browsing other patients, and not while the full-window Ceph route is open. Returning from Ceph to the patient page re-triggers `onMount` → `refreshFiles()` immediately, so newly-saved `.ceph`/PDF files are tracked the moment the user is back, without waiting for the poll.
- **Concurrency guard**: `isAutoTracking` prevents overlapping runs — since each file requires a couple of awaited DB writes, a slow batch could otherwise still be running when the next 2s poll fires and re-read a not-yet-committed `getDocuments()` snapshot, tracking the same file twice.
- **No distinct entry type for Ceph saves yet** — `.ceph`/PDF files get the same generic `document` entry as anything else. A dedicated `ceph_analysis` type with parsed measurements in `chart_data` is still the separate, bigger "Ceph Phase 1" work in `ROADMAP_CEPH_INTEGRATION.md`. What the generic `document` row DOES get (July 2026): `TimelineEntryCard`'s document file row detects a `.ceph` attachment (`docFile.name` ends with `.ceph`) and shows an always-visible "Open in Cephalyzer" pill button (`i18n.t.ceph.openButton`) that navigates straight to `patients/[patient_id]/ceph?file=<relPath>` — the same URL shape `AnalysisTypeMenu` uses, and the ceph route already resolves `.ceph` extensions via `LOAD_CEPH`. It's shown unconditionally (not hover-revealed like the generic Open icon button next to it) because the OS has no application registered for `.ceph`, so the generic "open externally" action is useless for this attachment type.
- i18n block: `timeline.vaultDrop.*`.

### Sidebar file tree (`PatientTreeView.svelte`) — reorganizing files already in the vault
Same mouse-based drag pattern as `VaultDropDialog` (mousedown + global `mousemove`/`mouseup`, `data-drop-folder` attribute + `elementFromPoint().closest(...)`, `DRAG_THRESHOLD = 5px` before a drag activates) — never HTML5 `draggable`.

- **Drop zone = the whole folder row AND its open file-list container**, not just the folder icon — both carry `data-drop-folder={node.folderPath}` so dropping among files (not only directly on the row) still resolves to that folder via `closest()`.
- **Rust commands** (`src-tauri/src/lib.rs`): `move_patient_file` (single file between category/sub-folders) and `delete_patient_file` both take vault-relative paths matching `VaultFileInfo.rel_path` and validate `file_path.starts_with(patient_folder)` before touching disk. `create_patient_subfolder`'s Rust parameter is `parent_rel`, not `parent_folder` — a JS→Rust key mismatch here silently no-ops the call (Tauri just reports a missing-argument error that only reaches the console), which is exactly what broke folder creation and file moves for a while. Double-check invoke argument names against the `#[tauri::command]` signature, not against sibling call sites.
- **Move must never touch the timeline; delete must always leave one entry** (July 2026 fix): `performFileMove` now looks up any `documents` row tracking the moved file (by old `rel_path`) and repoints it — `moveDocumentPath()` in `db-core.ts` updates `documents.rel_path`/`abs_path` AND does a `REPLACE()` on the matching path inside any timeline entry's `attachments` JSON (attachments are a blob, not a queryable column, so they don't follow the documents row automatically). Skipping this made `autoTrackUntrackedFiles` see the file as "new" at its new path after every move and log a spurious "document added" entry. `deleteFile` mirrors this the other way: it looks up the tracked `documents` row and calls `deleteDocument()` on it (so nothing lingers pointing at a file that no longer exists), then inserts one `document_removed` timeline entry (`SYSTEM_ENTRY_TYPES`, badge "Removed Files"/`i18n.t.timeline.typeLabels.documentRemoved`) noting what was deleted and from which folder — the deletion counterpart to the "document added" entry auto-tracking already creates on add. The original "document added" entry for that file is intentionally left in place as history, not deleted.
- The file context menu is Open / Delete only — "Select for Ceph" was removed (July 2026) as a redundant third option; the popup-on-select flow (below) already covers "I clicked this file to analyze it."
- **Shift-click multi-select**: shift-clicking a file toggles it into `multiSelected` (a `Set<rel_path>`, violet ring highlight) without touching `cephSelection`. A plain click clears `multiSelected` and does the normal single-select-for-Ceph behavior. Dragging a file that's part of an active multi-selection (`multiSelected.size > 1`) moves the whole group in one drop; `currentFolderPath(file)` (category + `path_in_category`) is what's compared against the drop target, not the bare `category_folder`, so dropping a sub-folder file back onto its own folder is correctly treated as a no-op instead of erroring on "file already exists."
- **Template-drop filename collisions**: `performDrop()` calls `uniqueFilename()` against a freshly-fetched file list before saving, appending `_1`, `_2`, ... — repeated drops of the same template no longer silently overwrite the previous copy.
- **File-type icons**: `getFileKind()` classifies by extension into a small `FileKind` union (`image | pdf | document | spreadsheet | archive | dicom | generic`), rendered via the `fileTypeIcon` snippet as stroke-SVGs colored from semantic tokens (`FILE_KIND_COLOR`) — no emoji.
- **Draggable rows must be `<div>`, never `<button>`** (July 2026 fix): each file row was a native `<button>`; in WKWebView (Tauri macOS) the `mousemove` stream that this drag pattern depends on doesn't reliably continue after a `mousedown` on a `<button>`, so the drag never activated (`onFileMouseDown` fired, but `isDraggingFile` never flipped true) — dropping a file into another folder was silently impossible. Template rows were already plain `div`s and worked. Fixed by converting the file row to a `div` (`role="button" tabindex="0"`, same onclick/ondblclick/onmousedown/oncontextmenu handlers, `select-none` added). Do not revert this to a `<button>`.
- **Template multi-select**: shift-clicking a template in `!Documents` toggles it into `multiSelectedTemplates` (`Set<rel_path>`), mirroring file multi-select. Dragging a template that's part of an active selection (`size > 1`) drops the whole group via `performDropGroup()`, which awaits `performDrop()` **sequentially** per template — not `Promise.all` — so each call's `uniqueFilename()` check (re-reads `listVaultFiles()`) sees the previous drop already on disk and correctly appends `_1`, `_2`, ... instead of racing to the same filename.
- **Nested-folder indentation must use inline `style="margin-left: …"`, never a dynamically-built `ml-[Npx]` class string** — Tailwind's JIT scanner matches literal class tokens in the source text; `'ml-[' + depth*14 + 'px]'` never appears as one token, so no CSS is generated and nested rows silently render unindented. Both the folder row and its open content container hit this.
- **Right-click folder creation** (July 2026): right-clicking a folder row (`handleFolderContextMenu`) opens a menu with "New subfolder" (`createNewFolder(node.folderPath, name)` — same call the hover-only `+` button already made, this is just a second entry point to it, not a new mechanism); right-clicking empty space in the tree background (`onEmptyTreeContextMenu`, bound on the tree's outer wrapper) opens "New folder" at the patient root (`createNewFolder('', name)`, matching `create_patient_subfolder`'s existing empty-`parent_rel`-means-root behavior). Both share `folderContextMenu` state (`{ kind: 'folder' | 'empty', folderPath, x, y }`) with the pre-existing file context menu's `closeContextMenu()`. The empty-space handler mirrors `DayView.svelte`'s `onGridContextMenu` guard pattern exactly: bail via `target.closest('[data-folder-row]')` before acting, since the folder-row content div is a **sibling**, not a descendant, of the row carrying `data-folder-row` — bubbling from inside an open folder's own row still needs the guard to correctly attribute the click. `handleFileContextMenu` (files) now also calls `e.stopPropagation()` — it didn't before, and without it a right-click on any file bubbled past the guard too (files aren't inside a `data-folder-row` element either) and incorrectly opened "New folder" *in addition to* the file's own menu, stacking two menus on screen. If you add another right-click surface to this tree, stopPropagation it and/or extend the guard, or this bug reappears.
- **`window.prompt()` silently does nothing in Tauri's WKWebView — never use it** (July 2026 fix): `createNewFolder` originally asked for the new folder's name via `prompt('Folder name:')`. WKWebView on macOS has no default `UIDelegate` implementation for `runJavaScriptTextInputPanelWithPrompt`, so the call returns `null` **instantly with no dialog shown at all** — clicking "New subfolder" (from either the right-click menu or the hover-`+` button) silently did nothing, which read as a broken button. `confirm()`/`alert()` usually *do* have a default WKWebView implementation (both are used successfully elsewhere in this codebase, e.g. delete confirmations), which is exactly why this was the only `prompt()` call anywhere in the app and the only one that was broken. Fixed with an inline popover text input (`folderNamePrompt`/`folderNameInput` state, positioned at the triggering click's coordinates, Enter submits / Escape or an outside click cancels via the same deferred-registration technique `AnalysisTypeMenu` uses) — matching how every other "type a name" interaction in this app already works (e.g. Settings' inline room-rename form). `createNewFolder(parentFolder, folderName)` now takes the name as a parameter instead of prompting internally. **Do not reintroduce `window.prompt()`/`window.alert()` for anything user-facing** — `alert()` has the same WKWebView caveat as `prompt()` on some configurations and isn't used anywhere in this codebase for that reason; build an inline input or reuse an existing dialog primitive instead.

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
- [x] File management + timeline bar cleanup (July 2026) — template-drop filename collisions fixed (`uniqueFilename()`); timeline document rows open on double-click; sidebar file-type icons are stroke-SVGs, not emoji; folder drop zone expanded to the whole row + open file list, not just the icon; "Back to List" sidebar button removed; Cephalyzer page gained an explicit floating back-arrow button; timeline entry bar's Type dropdown and persistent metadata row removed in favor of floating tagged-doctor/tooth pills (see "Timeline entry bar" section); fixed a broken inter-folder file drag/move (missing `move_patient_file`/`delete_patient_file` Rust commands, mismatched `create_patient_subfolder` argument name) and added shift-click multi-select for moving several files at once (see "Sidebar file tree" section)
- [x] Silent auto-tracking of externally-added files (July 2026) — any file that appears in a patient's vault folder via Finder or a Ceph analysis save now gets a `documents` row + generic `document` timeline entry automatically, no dialog (see "Auto-tracking files added outside the app" section). This intentionally supersedes the earlier "files enter the timeline exclusively via OS drag-and-drop" rule — the removed `NewFilesDialog` review-wizard UI stays removed, but untracked-file *detection* is back in a silent, non-interactive form
- [x] UI polish batch (July 2026) — resizable left sidebar (drag handle + `sidebarWidth` store; all `left-56` fixed bars now bind the store — see "Fixed UI bars & the resizable sidebar"); light-mode fix (theme store now sets `data-theme` + `color-scheme`, not just the `.dark` class); schedule hover time line no longer freezes over appointment blocks (`elementsFromPoint` looks through overlays); composer formatting (⌘B/I/U handled explicitly, selection popup gained B/I/U/S buttons + highlighter swatches + native custom color picker, ⌘⇧X strikethrough, ⌘\ clear via `removeFormat`, color picker repositioned zoom-correctly inside the box); auto-generated title hidden in timeline cards when it repeats the description's opening; document-category badge removed from timeline document rows (auto-assignment too unreliable to display)
- [x] Export audit + fixes (July 2026) — attachment/document paths in the HTML report are now subfolder-safe via `pathInPatientFolder()` (old parent-dir-only logic broke images in category subfolders); non-image attachments (PDFs, `.ceph`) render as links; Document Index paths are links; redundant auto-titles skipped and empty `entry_type` badges dropped in `renderTimeline`; attachments JSON now stores vault-relative paths in `performDrop` + auto-track (abs paths broke vault portability — the documented convention is enforced everywhere now)
- [x] Schedule grid interaction fixes + multi-select (July 2026) — right-click on empty calendar space now deselects (`onGridContextMenu`, grid-level, distinct from `AppointmentBlock`'s own right-click status menu); `onpointercancel` wired to the same cleanup as `onpointerup` so a cancelled gesture can no longer leave `apptPendingId`/`isDragging` stuck, which previously blocked drag-creating a new appointment in the same room column as a just-selected one; shift-click multi-select for appointments (`multiSelectedApptIds`) with group drag-move (preserves each member's relative time/room offset from the dragged anchor, clamped to grid bounds) — see `docs/claude/SCHEDULE.md` "Multi-Select + Group Drag" for the `suppressNextEmptyDeselect` gotcha this introduced
- [x] X-ray Report feature (July 2026) — full-screen viewer (Cephalyzer-style zoom/pan/brightness/contrast) + FloatingPanel report box + jsPDF A4-landscape report saved next to the X-ray, one upserted `xray_report` entry per source image with reload-for-editing; see the "X-ray Report" section
- [x] Facial Analysis feature F0–F2 (July 2026) — shared `ImageViewport` extracted from X-ray Report's viewer (both now share zoom/pan/brightness/contrast); native profile (17-landmark) and frontal (23-landmark) extraoral photo analysis with guided sequential landmark placement, drag-to-correct, face-right flip normalization, live orthodontic measurements (convexity, E-line, nasolabial/mentolabial/H-angle, facial thirds, rule of fifths, facial index, cants, etc.) against stored norms, annotated A4-landscape PDF, one upserted `facial_analysis` entry per source photo with reload-for-editing; data model designed for later AI-assisted landmark placement (`placedBy: human|ai`, versioned schema). F3 (dataset export tool) and F4 (auto-place model, frontal-smile view) remain open — see `ROADMAP_FACIAL_ANALYSIS.md`
- [x] Image-analysis entry consolidation + sidebar folder context menu (July 2026) — Ceph Analysis / X-ray Report / Facial Analysis's three toolbar buttons replaced with one neutral "Analyze" dropdown button (`AnalysisTypeMenu.svelte`, shared by both entry points below) to stop crowding the toolbar; selecting a fresh image in the sidebar file tree now also pops the same picker anchored to that file row (not on deselect/multi-select/drag — see "Image Analysis Entry Points"); Facial Analysis's Measurements panel converted from a `FloatingPanel` to a static right-side sidebar (Landmarks panel unchanged); right-click context menu added to the sidebar folder tree for "New subfolder" (on a folder row) and "New folder" at patient root (on empty tree space), alongside the pre-existing hover-`+` button and file context menu — see "Sidebar file tree" for the `stopPropagation`/`data-folder-row` guard interaction this introduced
- [x] Multi-room block creation + universal bulk delete (July 2026) — schedule blocks can now be created across "Apply to all rooms" or a customized room subset in one action from `DragCreatePopover`, as N independent (unlinked) `schedule_blocks` rows; schedule blocks gained shift-click multi-select (`multiSelectedBlockIds`, mirroring the existing appointment mechanism); right-click on any multi-selected appointment or block now shows "Delete N selected" and bulk-deletes the whole mixed-type selection in one action instead of each item behaving independently — see `docs/claude/SCHEDULE.md` "Multi-Room Block Creation" and "Universal Bulk Delete" for the root-zoom popup-positioning and `Promise.allSettled` details
- [x] Cephalyzer embed sync (July 2026) — `npm run sync-ceph` re-pulled the reference Cephalyzer app: comparison superimposition rework (rotation-aligned NL/SN/S modes, mm- or S–N-normalized scale, auto-fit-and-center), analysis click-to-highlight (clicking a measurement row draws its defining geometry on the X-ray canvas), one-click `.ceph` load (no intermediate dialog), template angle/distance restore fidelity, exact-instance `.ceph` loading (no default-merging), mm-only distance display, and a `.ceph` export fix (`extendedMode` was silently dropped on every round-trip). Verified the DentVault-side postMessage bridge (`LOAD_IMAGE`/`LOAD_CEPH`/`CEPH_READY`/`SAVE_CEPH`/`SAVE_PDF`/`NAVIGATE_BACK`) is untouched upstream, so no bridge changes were needed on this side — see the "Cephalyzer Integration" section
- [x] No-show auto-detection (July 2026) — `'scheduled'` appointments past `start_time` + a configurable minutes threshold (default 30, Settings → Schedule → "No-Show Auto-Detection", `noShowThreshold` store / `no_show_threshold_min` setting) auto-flip to `'no_show'` via a `setInterval` sweep in `schedule/+page.svelte`, gated to only run while viewing today and reusing `handleAppointmentStatusChange` so `no_show_recorded_at` stamps correctly — see `docs/claude/SCHEDULE.md` "No-Show Auto-Detection" for the same-day-only scope tradeoff (no app-wide background sweep)
- [x] Multi-computer Phase 0 + Phase 1 core (July 2026) — `dentvault-server` (standalone axum + rusqlite crate), `/rpc`/`/events`/`/files/*`, `db-remote.ts`/`files-remote.ts` transports, connect UI, verified end-to-end against the real app; file-transport viewing + `VaultDropDialog` upload/organize wired to connected mode. See the dedicated "Multi-Computer / Connected Mode" section for full status and what's still deferred (delete/rename, templates, native-open, analysis-tool bridges, Docker/TLS deployment)
- [x] v0.9.1 bug-fix batch (July 2026) — real-user bug reports fixed in one pass: onboarding no longer seeds duplicate rooms (missing `rooms`/`appointmentTypes`/`workingHours`/`noShowThreshold` store reload after `finish()`/`handleJoinServer()`, see "Settings Page Navigation"); sidebar file context menu simplified (removed redundant "Select for Ceph"), file moves no longer spuriously touch the timeline, file deletes now log a `document_removed` entry (see "Sidebar file tree"); dashboard Recent Activity/Upcoming boxes height-capped instead of stretching (see "Dashboard"); `.ceph` timeline entries gained an "Open in Cephalyzer" button and `.ceph` sidebar selection now pops the analyze menu too (see "Cephalyzer Integration" / "Image Analysis Entry Points"); Practice Hours moved from Schedule into Staff Members & Hours with visual separation from the staff list (see "Settings Page Navigation"); predetermined 14-type default set with emoji icons + 2-3 char codes for appointment/entry types, plus Settings hints explaining the convention (see "Data Model"); `!TEMPLATE`→new-patient folder copy made fully recursive and the sidebar tree now sources its structure from a live disk scan instead of a hardcoded category list, so template edits (including deletions) actually reach both new patients and what the sidebar displays (see "Vault Storage Structure" and "Sidebar file tree"); dead `init_patient_folder` Rust command removed; `window.prompt()` (silently a no-op in Tauri's WKWebView) replaced with an inline popover for the sidebar's "New folder"/"New subfolder" (see "Sidebar file tree"); dental chart snapshot reports no longer list arch-setup placeholder "missing" teeth (e.g. all primary teeth when charted as permanent dentition) as bogus findings (see "Chart snapshot reports")

---

## What to Build Next

**Multi-computer / connected mode** — see the dedicated section below for full status. Next up: the remaining file-transport gaps (delete/rename, templates, native-open, analysis-tool bridges), then Docker packaging for NAS deployment + TLS, then Phase 2 (multi-user).

**Ceph Phase 1** (`ROADMAP_CEPH_INTEGRATION.md`): `ceph_analysis` timeline entries on `SAVE_CEPH` (measurements in `chart_data`), `CephSnapshotCard`, register PDFs in `documents`, `renderCeph()` in the HTML export

**Phase 7:** Multi-user roles — map `doctors` table to login/session concept (absorbed into `ROADMAP_MULTI_COMPUTER.md` Phase 2, see below)

**Phase 8:** Recall / reminder system (only the v54 `recall_due` column exists so far) · Schedule nav item in Settings to add appointment statuses section link · ~~Week/month schedule views~~ — evaluated and dropped as not useful in a clinic context

**Clinical:** Keyword mappings user-configurable in Settings (`keyword-engine.ts` done, needs UI) · Cost/Billing module (deferred) · Time-series outcome survival curves · Cohort comparison

**Phase 10:** Legacy KIG `OrthoSnapshotCard` — consider a "Recorded under legacy KIG system" note instead of insurance badge (low priority)

---

## Multi-Computer / Connected Mode

Full blueprint in `ROADMAP_MULTI_COMPUTER.md`. One server process owns `dentvault.db` and the vault folder; workstations run the same DentVault app in "connected mode," talking HTTP + WebSocket to it instead of touching SQLite/the filesystem directly. Solo mode (today's default) is untouched by any of this — it's a pure transport swap sitting behind interfaces, not a fork.

**Target deployment**: a NAS on the clinic LAN running `dentvault-server` in a Docker container (most modern NAS boxes support this natively), with the vault folder as a bind-mounted volume on the NAS's own local storage. **This is not the same as pointing workstations at an SMB/NFS share** — that pattern (raw SQLite file access over a network filesystem) is explicitly rejected in the roadmap (§2, "Option A") because SQLite's locking is unreliable over network filesystems and will silently corrupt the database under concurrent writers; the `is_network_mount` guard exists specifically to block a workstation from being pointed at one. The NAS's role here is purely as "a machine that runs the server process," with the actual SQLite file only ever touched by that one local process — everyone else goes through `/rpc`/`/files/*`/`/events`. Not yet built: the Dockerfile/container packaging itself, and — since a NAS puts the server on a shared LAN rather than one trusted machine — TLS should be pulled forward ahead of its original "Phase 4" slot; today's `/rpc` traffic (including the bearer token and all patient data) is plaintext HTTP.

Client OS doesn't matter: the entire connected-mode client is `fetch`/`WebSocket`/`FormData`/`Blob` (standard web APIs, work identically in WKWebView/WebView2/webkit2gtk) plus two already-cross-platform Rust commands (`read_base64_file`, `get_server_connection`/`save_server_connection`). Windows is already a first-class Tauri target for this app. Server-side, the NAS's CPU architecture (ARM vs x86_64) is what actually needs to be known for the Docker build.

### Phase 0 — Groundwork (shipped, July 2026)
`db.ts` split into `db-transport.ts`/`db-local.ts`/`db-core.ts` behind the `DataTransport` interface (see the Migrations note above); `src/lib/stores/invalidations.svelte.ts` entity-keyed pub/sub bus, with `TimelineView`'s 5s and `PatientTreeView`'s 2s polling feeding/consuming it (same cadence — pure refactor); network-mount guard (`is_network_mount` Rust command, unit-tested mount-output parser) wired into `vault.configure()`; v69 migration added dormant `version` columns on the tables §3.6 flags as conflict-prone, ready for Phase 2.

### Phase 1 — Server MVP + connected mode (mostly shipped, July 2026)

**Server** (`dentvault-server/` — standalone Rust crate, deliberately NOT a Cargo workspace member of `src-tauri`, zero risk to the existing Tauri build):
- axum + rusqlite (WAL mode); `shared/schema-statements.json` (Phase 0's migration source of truth) is `include_str!`'d at compile time, so the server applies byte-identical migrations with no runtime file dependency.
- `POST /rpc` (Shape 1 SQL pass-through): rejects anything not starting with SELECT/INSERT/UPDATE/DELETE and rejects multi-statement input — schema changes only ever happen via the server's own startup migrations. Verified via curl (auth, guardrails, round-trips) and via the real app.
- `/events` WebSocket: coarse table→entity broadcast (`entity_for_table` in `events.rs`) after every write, no payload data. A 15s server heartbeat + client-side watchdog (`ws-client.ts`, 35s timeout) force-reconnect if traffic goes quiet — added after finding that Tauri's WKWebView doesn't reliably fire `'close'` on an abrupt TCP death, only on a clean handshake.
- `/files/*`: list/raw/upload/mkdir/move/delete plus dedicated `tree`/`subfolder`/`move-folder` endpoints that mirror the Tauri folder commands' exact safety checks (name sanitization, no-move-into-own-descendant, no-overwrite). Path-traversal-guarded (`safe_join`), verified against raw and percent-encoded `../`.

**Client**: `db-remote.ts`/`db-connection.ts` (DB transport picker — the only place `db-core.ts`'s `getDb` import comes from) and `files-remote.ts`/`files-local.ts`/`files-connection.ts` (file transport picker, same pattern; `resetDb()` also resets the files connection so the two never drift). Connect UI in Settings ("Server Connection," tests with a harmless `SELECT 1` before persisting) and an alternate OnboardingWizard step-1 path for a workstation joining with no local vault (skips straight to `onConfigured()` — a joining station shouldn't recreate team/room data that already exists server-side).

**What works today in connected mode**: patients, timeline, appointments, settings, doctors/rooms/types — all clinical *data* — verified end-to-end with the real app against a real server (not just curl), including the WebSocket push (a `curl` "station B" write showed up live). Viewing existing documents (`getFileDisplayUrl`, blob-URL fallback in `DocumentCard`/`TimelineEntryCard`). Dragging new files in and organizing folders via `VaultDropDialog` (its complex pointer-drag UI needed almost no changes — none of that state touches the filesystem directly, only 4 function calls did).

**Still local-vault-only, explicitly deferred** (not silently broken — every one of these still works fine in solo mode): deleting a document, renaming/deleting a whole patient folder; the `!TEMPLATE`/`!Documents` template systems; native "open in Finder" (needs download-to-cache-then-open semantics); patient HTML export's file bundling (`copyPatientFolderTo`); the Ceph/X-ray/facial-analysis image bridges; `PatientTreeView`'s own internal drag-to-reorganize (distinct from `VaultDropDialog`'s OS-drop entry flow); server-side file auto-tracking (roadmap wants the *server* to watch its own vault folder instead of depending on a client having a patient page open — still client-triggered today, just now transport-aware); mDNS discovery (manual URL entry only); TLS (see deployment note above).

### Phases 2–5 — not started
Phase 2 (Shape 2 named RPC operations with per-operation authorization, per-user login/PIN + roles, server-side audit with user attribution, enforcing the v69 version columns with 409-conflict-retry), Phase 3 (live schedule board polish, waiting-room kiosk, per-station default views), Phase 4 (backups, TLS, status tray, auto-update — TLS should move earlier given the NAS deployment target), Phase 5 (remote/VPN docs, kiosk niceties).
