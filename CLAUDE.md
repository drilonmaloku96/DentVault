# DentVault — Project Guide for Claude

## What is DentVault?

A cross-platform desktop dental patient management app for independent practitioners and small clinics.
Built with **Tauri 2
 + SvelteKit + Svelte 5 + TypeScript + SQLite + Tailwind CSS v4 + shadcn-svelte**.

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
- **Migrations**: append to `SCHEMA_STATEMENTS` array in `src/lib/services/db.ts`, never modify existing ones. Update `LATEST_VERSION` constant after adding. Current version: **60**.
- **Types**: all interfaces in `src/lib/types.ts`
- **Type check**: `npm run check` must pass with 0 errors after every change
- **`untrack()`**: use in `$state()` initializers when reading props to suppress "captures initial value" warning
- **Svelte 5 deep reactivity**: mutate `$state` object properties directly (`obj[key] = val`, `delete obj[key]`) — do NOT use spread+reassign (`obj = { ...obj }`) for per-property updates
- **Dialog width override**: shadcn DialogContent has a built-in `sm:max-w-lg`; to widen a dialog override BOTH `max-w-[Xpx]` AND `sm:max-w-[Xpx]` in the `class` prop, otherwise the responsive variant wins
- **Opening files externally**: do NOT use `openPath` from `@tauri-apps/plugin-opener` — it silently fails. Use `invoke('open_file_native', { path })` in `src/lib/services/files.ts`.
- **Timeline polling (silent refresh)**: `hasEverLoaded` flag controls skeleton visibility — skeleton shows only on the very first fetch (`!hasEverLoaded`), never on background polls. Set `hasEverLoaded = true` after the first successful load. Background polling must NOT set `isLoading = true` once entries have been loaded at least once.
- **Scroll to revealed element after image expand**: call `scrollIntoView` AFTER awaiting the image `load` event. Pattern: `if (!img.complete) await new Promise(r => img.addEventListener('load', r, { once: true }))` before measuring.
- **`provider` field deprecated**: free-text `provider` column no longer shown in UI. Use `doctor_id` + `colleague_ids`. Legacy `provider` shown with "(legacy)" label in expanded entry view only.
- **`TimelineEntryType` is now `string`**: loosened from strict union. `SYSTEM_ENTRY_TYPES = new Set(['document', 'plan', 'chart_snapshot', 'ortho_snapshot'])` identifies system-only types. Legacy strings ('visit', 'procedure', etc.) via `LEGACY_LABELS` in `entryTypes.svelte.ts`.
  - **`AppointmentStatus` is now `string`**: loosened from strict union (same pattern as `TimelineEntryType`). `SYSTEM_APPOINTMENT_STATUSES = ['scheduled', 'waiting', 'in_treatment', 'completed', 'cancelled', 'no_show'] as const` in `types.ts` identifies built-in statuses for business logic. Custom statuses are stored in settings and resolved via `appointmentStatusLabels` store.
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
- **Rich text in timeline entries**: `description` stores raw HTML. `TimelineEntryBar.svelte` body editor uses `bind:this={editorEl}` (NOT `bind:innerHTML`) — reads innerHTML manually in `handleDescriptionInput` and on submit. `TimelineEntryForm.svelte` description editor uses `bind:innerHTML={description}`. Card display uses `{@html}`. Shortcuts: Cmd/Ctrl+B/I/U. Toolbar buttons use `onmousedown` + `e.preventDefault()`. Selection API via TreeWalker for `@` mention and `/` text block detection.
- **Text color picker** (`src/lib/components/timeline/TextColorPicker.svelte`): Floating pill that appears above selected text in the documentation box. Colors are user-configurable via `textHighlightColors` store (Settings → Clinical → Text Highlight Colors) — defaults: red `#dc2626`, blue `#2563eb`, green `#16a34a`. Includes a remove button. Uses `document.execCommand('foreColor', false, hex)` / `'inherit'` to apply/remove. Built with vanilla DOM (`document.body.appendChild`) to escape any transformed ancestor (Dialog `translate-x/y` would break `position:fixed` children). `showPopup` always rebuilds fresh (no caching) so color list stays in sync with store. Activated by `mouseup`/`keyup` on the container element; dismissed by `mousedown`. Used in both `TimelineEntryBar.svelte` (passes `docBoxEl`) and `TimelineEntryForm.svelte` (passes `descContainerEl`). i18n keys: `timeline.bar.formatting.{red,blue,green,remove}`.
- **Sticky patient header**: `sticky top-0 z-20` in `src/routes/patients/[patient_id]/+page.svelte`, height ≈ 76px. Uses `-mx-6 -mt-6 px-6 pt-6` to flush to scroll container edges. Timeline toolbar sticky at **`top-[76px]`** (`z-10`).
- **Timeline entry bar body editor height**: `min-h-[52px] max-h-[140px] overflow-y-auto` — expands freely up to ~6 lines, then scrolls internally. The absolute-positioned Add button (`right-2 bottom-2`) stays fixed within the container; `pr-32` on the editor reserves space for it.
- **Extended patient data model**: v31 adds 10 columns: `address`, `city`, `postal_code`, `country`, `emergency_contact_name/phone/relation`, `blood_group`, `primary_physician`, `marital_status`. `PatientStatus` includes `'deceased'`. `PatientForm` has 7 sections.
- **Settings page — two-panel layout**: fixed left `<nav>` (208px, `w-52 shrink-0`) + scrollable right content (has `use:scrollIndicator={{ zIndex: 45 }}`). Outer wrapper `class="flex h-full overflow-hidden -m-6"`. `activeSection` (`$state<string>`, default `'general'`). Seven nav items (flat, no sub-groups): `home` (overview landing grid), `general` (language + appearance + vault + backup + about), `team` (staff + working hours + roles), `schedule` (working hours + rooms + appointment types), `clinical` (clinical tags + complications + text blocks + **text highlight colors** + dental tags + prosthetics/bridges + plan procedures + DMFT), `documents` (folder categories/!TEMPLATE + document templates/!Documents), `patients` (management + export). Each page is one long scrollable view with `<Separator />` dividers between sub-sections.
- **Settings scroll position memory**: `navigateTo(key)` saves `contentEl.scrollTop` into plain `Record<string, number>` before switching, restores via `tick().then(...)`. Plain object — not `$state`.
- **Timeline toolbar — upload and plan buttons removed**: "Dokumente hochladen" and "Neuer Plan" buttons and all associated state/handlers removed from `TimelineView.svelte`.
- **Timeline polling anti-flicker**: `loadEntries` uses `id|updated_at` fingerprints instead of `JSON.stringify` — `entryFingerprint(e) = \`${e.id}|${e.updated_at}\`` joined with `','`. Same pattern for `plansMap` using `plan_id|updated_at`. Only reassigns state when fingerprint string changes — avoids full re-render on background poll when data is unchanged.
- **`ortho_snapshot` timeline entries**: Ortho assessments are saved as `entry_type: 'ortho_snapshot'` timeline entries (not in `ortho_assessments` table). Same-date dedup: delete existing `ortho_snapshot` for the same date before inserting new one. Stored payload in `chart_data` JSON. Past entries are read-only (`is_locked: 1`). Rendered by `OrthoSnapshotCard.svelte`. Export reads them from timeline entries, not the DB table.
- **IOTN ortho system** — `OrthoChartDialog.svelte` rebuilt on the Austrian IOTN standard. Condition-first flow: clinician picks the malformation type (missing/retained, overjet, crossbite, displacement, overbite, other), enters the measurement, and the DHC grade is **auto-derived**. Conditions: `i` (retained), `h` (hypodontia), `a` (positive overjet + lip competence), `b/m` fused (reverse overjet + masticatory difficulties — `b` = no difficulties → grades 2–4, `m` = with difficulties → grades 2–5, code auto-derived), `c` (crossbite RCP/ICP discrepancy), `d` (contact point displacement), `f` (deep overbite: 4-option selector), `e` (open bite), binary Sonstiges (`g/l/p/s/t/x`). DHC header shows the live leading finding. AC (1–10) is separate. Score stored as `dhc: IOTNDHCFinding` (worst finding) + `dhc_measurements` (full detail for re-loading). `OrthoSnapshotCard.svelte` detects IOTN (`dhc` key present) vs legacy KIG (`findings` array) at runtime and renders accordingly. New entries titled `'IOTN Assessment'`.
- **`IOTNDHCFinding` type** (`src/lib/types.ts`): `{ grade: 1|2|3|4|5; subcategory: string; mm_value: number | null }`. `subcategory` is the condition code (`'a'`, `'b'`, `'m'`, `'c'`, etc.). `OrthoAssessment` has optional `dhc?: IOTNDHCFinding` and `ac_grade?: number` (new) alongside optional `findings?: OrthoKigEntry[]` (legacy KIG — do not remove).
- **`TherapyPlanView.svelte` keyboard shortcuts**: Multi-tooth selection uses `altSelectedTeeth` (Alt+click or plain drag in plan mode) — separate from `DentalChartView`'s `ctrlSelectedTeeth`. Keyboard handler ($effect, active when dialog `open`): if `altSelectedTeeth.length > 0`, pressing a shortcut key calls `applyProcToSelection(procKey)` (applies to all selected teeth); if `altSelectedTeeth` is empty and `selectedTooth !== null`, calls `toggleProcedureOnTooth(selectedTooth, procKey)`. `PROC_SHORTCUT` is a `$derived` map of `procKey → shortcutKeyString`. Guard: skip if target is input/textarea.
- **Plan timeline entries**: `insertTreatmentPlan` in `db.ts` auto-inserts a `plan` type `timeline_entry` linked via `plan_id`. `deleteTreatmentPlan` deletes the linked entry before the audit log. `updateTreatmentPlan` syncs the entry title when `title` changes. In `TimelineView.svelte`, `plan` entries render as a slim single-line indicator (icon + plan name + status label + chevron) that opens `TherapyPlanView` on click — no separate card component. `plansMap` (`Map<number, TreatmentPlan>`) is passed down to look up plan details by `plan_id`.
- **PAR button removed** from patient top bar (`src/routes/patients/[patient_id]/+page.svelte`).
- **`FloatingPanel.svelte`** (`src/lib/components/ui/FloatingPanel.svelte`): Draggable, resizable floating window. Drag: pointer events with `setPointerCapture` on the title bar div. Resize: CSS `resize: both` on the root element. Size retention: a `ResizeObserver` reads `el.offsetWidth`/`el.offsetHeight` into `width`/`height` `$state` on every resize — required because CSS `resize: both` writes inline style directly and Svelte's reactive style binding would overwrite it on every re-render, snapping the panel back to its default size. Position tracked in `x`/`y` `$state`. Dims to 40% opacity when the user scrolls (document `wheel` capture) or clicks outside (`mousedown` capture); `onmouseenter` restores opacity. `initialX`/`initialY` must use `untrack(() => initialX)` in the `$state()` initializer to suppress Svelte 5 "captures initial value" warning.
- **`bind:this` + `$state` on conditionally-rendered elements**: In Svelte 5 runes mode, `bind:this` on an element inside `{#if}` updates the `$state` signal asynchronously — the element may be in the DOM but the signal hasn't propagated yet. **Do NOT use a `$state` ref for immediate DOM reads in event handlers.** Use plain `let` instead and get the element from `e.currentTarget` inside the handler. Example: `let textareaEl: HTMLTextAreaElement | null = null` set via `textareaEl = e.currentTarget as HTMLTextAreaElement` in `oninput`.
- **Inline `+` tag trigger** (`AcuteProblemsBox`, `MedicalHistoryBox`): `@mention`-style tag search activated by typing `+` in the textarea. In `oninput`, check `ta.value.slice(0, ta.selectionStart).match(/\+(\S*)$/)` — matches while the cursor sits right after `+` with non-space chars. Space cancels naturally (regex fails → `handleInput` sees `triggerFromTextarea = true` with no match → clears state). Enter selects the highlighted suggestion and removes the `+query` text from the textarea via `content = val.slice(0, triggerPos) + val.slice(cursor)`. `ta` must come from `e.currentTarget`, not `bind:this` (see rule above).
- **Floating panel content scaling**: Box components inside `FloatingPanel` must use `h-full flex flex-col` on their outer div and `flex-1 min-h-0 resize-none` on textareas so content fills and scales with the panel as it is resized.
- **Suggestion pill blur prevention**: `onmousedown={(e) => e.preventDefault()}` on suggestion buttons prevents the focused search input (or textarea) from losing focus before the click event fires. Required for any dropdown/suggestion UI where `onblur` of the input cancels the suggestion list.
- **Patient top bar panels — floating windows**: Acute Problems, Medical History, and Notes now render as `FloatingPanel` instances (not centered modals). No backdrop. Positions staggered at `(panelBaseX, 90)`, `(panelBaseX+40, 130)`, `(panelBaseX+80, 170)` where `panelBaseX = Math.max(20, Math.floor(window.innerWidth / 2) - 210)`.
- **Document Categories settings UX**: The category table/card is visually framed as the `!TEMPLATE/` folder (amber header, folder icon). Each category row = one subfolder on disk. An `!Documents/` card below shows that folder's file list with type icons, KB sizes, and open-file buttons.
- **Timeline entry bar — Enter key inserts newline**: plain Enter in the body `contenteditable` calls `insertBodyLineBreak()` which does `document.execCommand('insertHTML', false, '<br>​')`. The zero-width space (U+200B) after the `<br>` gives WebKit a real text node to land the cursor in — without it WebKit does not reliably render the cursor on the new line. `​` is stripped from `description` before saving via `.replace(/​/g, '')` in `handleSubmit`. Cmd/Ctrl+Enter submits. **Critical guard**: always check `showMentionPalette || showPalette` before any Enter handling — palette components are conditionally rendered and their refs can be null briefly, causing keydown to fall through unexpectedly.
- **`applyToothHighlighting` cursor reset trap**: `applyToothHighlighting(el)` saves/restores the cursor as a plain text-character offset (`pre.toString().length`) which is blind to `<br>` elements. If it runs after a line-break insertion the cursor snaps back to the previous line. **Never dispatch a synthetic `input` event from within `insertBodyLineBreak()`** — that would trigger `handleDescriptionInput` → `applyToothHighlighting`. Instead, update state directly: `description = editorEl.innerHTML`. This is safe because pressing Enter cannot introduce a tooth-reference pattern.
- **`@` mention → auto-removes `@` from editor**: `insertMention` calls `document.execCommand('insertText', false, '')` to delete the `@query` text — the doctor is added as a tag only, not inline in the description. Same pattern in both `TimelineEntryBar.svelte` (`insertMention`) and `TimelineEntryForm.svelte` (`insertMentionInForm`).
- **`scrollIndicator` Svelte action** (`src/lib/actions/scrollIndicator.ts`): Attaches a floating `position:fixed` pill (chevron-down icon, primary accent color) to any overflow scroll container. Appears when content extends below visible area; fades out near bottom. Options: `zIndex` (default 40), `offset` (px from bottom edge, default 20), `threshold` (px proximity before fade, default 48). CSS animation injected once via `stylesInjected` singleton. Listeners: `scroll` (passive) + `ResizeObserver` + `MutationObserver(childList+subtree, no attributes/characterData). rAF deduplication via `schedule()`. Pill style: `var(--primary)` background, `var(--primary-foreground)` color. Apply with `use:scrollIndicator` on native HTML elements only (not Svelte components). Z-index convention: `40` for main content area, `45` for Settings right panel, `55` for inside dialogs (above shadcn z-50). Applied to: `<main>` in `+layout.svelte` (z:40), Settings right content panel (z:45), `OrthoChartDialog.svelte` scroll body (z:55), three scroll containers in `TherapyPlanView.svelte` (z:55).
- **`TimelineEntryCard.svelte` — flat visual style**: Clinical entries use a borderless/card-free layout matching `ChartSnapshotCard`. Title row: type icon + bold title + category/outcome badges + muted date + 3-dot menu. Meta row: doctor dot + name, colleague colored pill badges. Description: `font-mono text-[13px] text-muted-foreground/80 leading-relaxed` with show-more/less at 350 chars. Actions: subtle text links (Edit, History). `descExpanded` state + `descIsLong` derived from `entry.description.length > 350`.
- **`+ Template` button removed** from timeline toolbar (`TimelineView.svelte`). `DocTemplatePickerDialog` component and `showDocTemplatePicker` state remain in file but button is gone.
- **Schedule calendar pointer system**: All calendar interactions (slot drag-create, appointment drag/resize, block drag/resize) are handled exclusively via `onGridPointerDown` / `onGridPointerMove` / `onGridPointerUp` on the grid container with `setPointerCapture`. Never add standalone `onclick` to appointment or block wrappers for interaction logic — it bypasses the pointer capture system.
- **Appointment interactions**: Single click → selects (shows ring, enables drag-move + edge-resize). Double click → opens `BookingPanel` edit dialog. Detection via `data-appt-id` on wrapper div and `data-appt-handle="top|bottom"` on resize handles inside `AppointmentBlock.svelte`. Quick-update callback: `onAppointmentQuickUpdate(id, startTime, endTime, durationMin, roomId)`.
- **Schedule block interactions**: Identical pattern to appointments. Single click → selects (shows ring, enables drag-move + edge-resize). Double click → opens `ScheduleBlockEditDialog`. Detection via `data-block-id` on wrapper div and `data-block-handle="top|bottom"` on resize handles inside `ScheduleBlockCell.svelte`. Quick-update callback: `onBlockQuickUpdate(id, startTime, endTime, roomId)`. Block drag state mirrors appointment drag state (prefix `block*` vs `appt*`).
- **`ScheduleBlockCell.svelte`**: Accepts `isSelected?: boolean` prop — shows color ring. Has `data-block-handle="top"` and `data-block-handle="bottom"` resize handle divs. No `onclick` prop — parent wrapper handles all pointer events.
- **Deselect on empty click**: Clicking empty calendar area (slot drag path with no movement) clears both `selectedApptId` and `selectedBlockId`.
- **Default startup route**: App always opens at `/schedule`. Root `src/routes/+page.svelte` does `goto('/schedule', { replaceState: true })`. Do not change back to `/patients`.
- **OS file drag-and-drop (Tauri WKWebView)**: `dataTransfer.files` is always empty in Tauri's WKWebView — Tauri intercepts OS drops at the native layer. Use `listen('tauri://drag-drop', event => { paths = event.payload.paths })` from `@tauri-apps/api/event`. Also: even internal HTML5 drags on `draggable="true"` elements fire `tauri://drag-enter` — use pointer events (`setPointerCapture` + `onpointermove` + `document.elementsFromPoint`) for any in-page drag-to-reorganize. `draggable="true"` must never appear on interactive elements inside the app.
- **`VaultDropDialog` — vault-relative paths**: When inserting a dropped file, `rel_path` in `documents` table and `path` in `attachments` JSON must be **relative to vault root** — i.e. `{patientFolder}/{selected}/{filename}`. `toAbsPath(relPath, vault.path)` in `TimelineEntryCard` prepends vault root, so including `patientFolder` is required for the image URL to resolve correctly.
- **`VaultDropDialog` — folder drag targets**: `data-folder-rel` attribute on DOM elements marks drop targets for `elementsFromPoint`. Empty string `""` = vault root. The scroll container and the "New folder" bar both carry `data-folder-rel=""`. When checking destination, use `dest === null` (not `!dest`) to treat `""` as a valid root drop.
- **`NewFilesDialog` removed**: The automatic vault-scan / "New Files Detected" system (`checkNewVaultFiles`, `NewFilesDialog`, `scanVaultForUntrackedFiles`) is fully removed. Do not re-implement. Files enter the timeline exclusively via `VaultDropDialog` (OS drag-and-drop).
- **Left sidebar auto-refresh**: `PatientTreeView.svelte` polls `listVaultFiles` every 3 seconds using a `rel_path` join fingerprint — only reassigns `files` state when the list actually changes, preventing needless re-renders.
- **Timeline image expand click area**: In `TimelineEntryCard.svelte`, for `document` entries where `isImageMime(docFile.mime)` is true, the thumbnail **and** the filename are wrapped together in a single `<button onclick={handleImageClick}>`. Single click toggles the expanded preview; double-click opens in the system app via `handleOpenFile`.

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
  renderOrtho()           ← OrthoClassification (legacy) + ortho_snapshot timeline entries (IOTN + legacy KIG both handled)
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
4. **Never use `i18n.code === 'de' ? … : …` inline ternaries** — always add a proper key. The only permitted uses of `i18n.code` are: setting the HTML `lang` attribute, passing a BCP-47 locale string to `Intl` APIs, and CSS class selection. Everything else must go through `i18n.t.*`.
5. **User-configurable defaults are bilingual** — follow `{ key, label? }[]` pattern; built-in keys resolve via `i18n.t.defaults.*`, custom items carry their own `label`
6. **Dental tag labels** — `DentalTag.label` deprecated. Labels from `i18n.t.chart.tags[key].label` at render time via `dentalTags.getLabel(key)`. New tag keys need entries in both `de.ts` + `en.ts` under `chart.tags`.
7. **Shortcuts are language-aware** — `chart.tags[key].defaultShortcut` differs per language. On switch, confirmation dialog offers to reset shortcuts.
8. **Tag group labels** — `i18n.t.chart.tagGroups`: `general`, `restorative`, `endodontic`, `fixedProsthetics`, `removable`, `absent`, `custom`, `bridgeTagNote`, `prosthesisTagNote`
9. **IOTN i18n keys** added to `ortho.*`: `dhcTitle`, `dhcNeedLevel` (grades 1–5), `dhcSubcategories` (all condition codes 2a–5x), `acTitle`, `acGradeDesc` (1–10), `iotnScore`. Legacy KIG keys (`groups`, `grades`, `insuranceCovered`, `notCovered`, `leadingGroup`) kept for backward-compat display of old snapshots — do not remove.
10. **`plans.status.edited`** added to i18n — used in slim plan timeline indicator.
11. **`defaults.dayAbbrevs`** — Sun-first abbreviated day names (7 items, index 0 = Sunday, matching SQL `strftime('%w')`). Use this instead of language ternaries for day-of-week labels in schedules/working-hours dialogs. `defaults.workingDays` has full names in same order.
12. **Parameterized strings** use `.replace('{n}', String(value))` — e.g. `i18n.t.plans.countPlural.replace('{n}', String(count))`. Wrap numeric values in `String()` explicitly.

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
- **Text Highlight Colors** — `textHighlightColors` store (`src/lib/stores/textHighlightColors.svelte.ts`), max 8 colors. Key: `'text_highlight_colors'`. Default: red `#dc2626`, blue `#2563eb`, green `#16a34a`. Settings → Clinical → Text Highlight Colors. Used by `TextColorPicker.svelte`.
- **Appointment Statuses** — `appointmentStatusLabels` store (`src/lib/stores/appointmentStatusLabels.svelte.ts`). Two settings keys: `appointment_status_labels` (override labels for system statuses) + `appointment_status_custom` (custom status array as `{ key, label }[]`). `allStatuses()` returns system + custom in order. `getMeta(s)` returns icon + colorClass. `getLabel(s)` resolves override → custom lookup → i18n fallback. Custom keys auto-generated as `custom_` + snake_case label. Settings → Schedule → Appointment Statuses. Loaded in `+layout.svelte` `onMount`.
- **"Reset to Defaults" buttons removed** from Settings — `DEFAULT_*` constants kept for onboarding only

### Checklist for New Features

- [ ] Are there labels/categories/types currently hard-coded that a user might want to change?
- [ ] Should these be stored in `settings` table and managed in Settings?
- [ ] Is there a `.svelte.ts` store as single source of truth?
- [ ] Do dependent UI elements (filters, badges, dropdowns) derive reactively from that store?
- [ ] Can users add their own entries without a code change?

---

## Data Model — DB Schema Overview

Migrations in `SCHEMA_STATEMENTS` in `src/lib/services/db.ts`. **NEVER modify existing migrations — always append new ones.** `LATEST_VERSION = 60`.

**Key tables:** `patients`, `timeline_entries`, `treatment_plans`, `treatment_plan_items`, `documents`, `dental_chart`, `settings`, `doctors`, `ortho_classifications`, `entry_teeth`, `complications`, `dental_chart_history`, `probing_records`, `probing_measurements`, `probing_tooth_data`, `patient_conditions`, `appointment_rooms`, `appointments`, `schedule_blocks`, `staff_blockouts`, `doctor_working_hours`

See `docs/claude/DB_SCHEMA.md` for full per-version descriptions and all DB function signatures.

---

## Appointment Lifecycle & Time Tracking

### Status Flow

Every appointment passes through a defined sequence of statuses. Each transition records a timestamp that enables both patient and doctor analytics.

```
scheduled → waiting → in_treatment → completed
                   ↘               ↗
                    cancelled / no_show
```

| Status | Meaning | Timestamp recorded |
|--------|---------|-------------------|
| `scheduled` | Appointment booked, not yet started | — |
| `waiting` | Patient has arrived at the practice | `arrival_time = NOW()` (once, never overwritten) |
| `in_treatment` | Patient is on the dental chair | `arrival_time` (if not set), `treatment_start_time = NOW()` (once) |
| `completed` | Treatment finished, session documented | — (set via context menu or BookingPanel) |
| `cancelled` | Appointment cancelled | `cancelled_at = NOW()` (once) |
| `no_show` | Patient did not appear | `no_show_recorded_at = NOW()` (once) |

Status transitions are set via:
1. **Right-click context menu** on any appointment block in the day view → instant status change, no dialog
2. **BookingPanel** (double-click an appointment) → status dropdown in the edit form

### Time Columns on `appointments` Table

| Column | Type | Set when |
|--------|------|---------|
| `start_time` | TEXT (ISO) | Appointment created — the *planned* start |
| `end_time` | TEXT (ISO) | Appointment created — the *planned* end |
| `arrival_time` | TEXT (ISO) | Status → `waiting` (first time only) |
| `treatment_start_time` | TEXT (ISO) | Status → `in_treatment` (first time only) |
| `treatment_end_time` | TEXT (ISO) | Auto-set by `syncAppointmentFromTimelineEntry` when a doctor saves a timeline entry linked to this appointment and `treatment_start_time` is set |
| `cancelled_at` | TEXT (ISO) | Status → `cancelled` (once) |
| `no_show_recorded_at` | TEXT (ISO) | Status → `no_show` (once) |

**"First time only" rule**: all temporal columns except `updated_at` use `CASE WHEN col IS NULL THEN NOW() ELSE col END` — once written, they are never overwritten by status changes. This preserves the first-observed timestamp even if a status is changed back and forth.

### The treatment_end_time Auto-Capture

When a doctor saves a clinical timeline entry (in `TimelineView.svelte`) that matches the appointment's type and date, `syncAppointmentFromTimelineEntry` fires and:
1. Links `timeline_entry_id` on the appointment
2. Syncs `type_id` to the matching appointment type
3. **If `treatment_start_time IS NOT NULL` and `treatment_end_time IS NULL`** → sets `treatment_end_time = NOW()`
4. **If the appointment has no `doctor_id` yet** → assigns the timeline entry's `doctor_id` to the appointment

This makes "saving the clinical note" the natural endpoint of the treatment session — no extra manual step required.

`syncAppointmentFromTimelineEntry` signature:
```ts
syncAppointmentFromTimelineEntry(
  patientId: string,
  entryDate: string,
  entryId: string,
  entryTypeName: string,
  doctorId?: string | null,  // from data.doctor_id on the timeline entry
): Promise<boolean>
```

### Visual Indicators in the Day View

| Status | Left border | Background | Dot indicator |
|--------|-------------|------------|---------------|
| `scheduled` | appointment type color | type color @ 12% | — |
| `waiting` | amber `#d97706` | amber @ 10% | pulsing amber dot |
| `in_treatment` | blue `#2563eb` | blue @ 10% | pulsing blue dot |
| `completed` | type color | type color @ 12% | ✓ green, 60% opacity |
| `cancelled` | type color | type color @ 12% | ✕ red, greyscale + 40% opacity |
| `no_show` | type color | type color @ 12% | ✗ orange |

### Derived Patient Statistics (`getPatientAppointmentStats`)

Computes for all past appointments of a patient (i.e. `start_time < NOW()`):

| Metric | Formula | Shown when |
|--------|---------|-----------|
| `avg_minutes_offset` | `(arrival_time − start_time) / 60` | `arrival_time` is set on ≥1 appointment |
| `avg_wait_minutes` | `(treatment_start_time − arrival_time) / 60` | Both times are set |
| `avg_actual_duration_min` | `(treatment_end_time − treatment_start_time) / 60` | Both times are set |
| `avg_duration_deviation` | `avg_actual_duration_min − duration_min` | Both treatment times are set |
| `cancelled_count` | `SUM(status = 'cancelled')` | Always |
| `no_show_count` | `SUM(status = 'no_show')` | Always |
| `tracked_count` | `SUM(arrival_time IS NOT NULL)` | Always |

**Displayed on**: `src/routes/patients/[patient_id]/info/+page.svelte` — "Terminstatistik / Appointment Statistics" card. Color coding:
- Punctuality: orange = late, blue = early, green = on time (≤2 min)
- Wait time: orange if > 15 min avg (signals systemic delay at the practice)
- Duration deviation: green = within ±2 min, orange = over, blue = under

### Derived Doctor Statistics (`getDoctorTreatmentStats`)

For a specific doctor, grouped by appointment type, over a date range. Only counts appointments that have *both* `treatment_start_time` and `treatment_end_time` — i.e. those that went through the full tracked flow.

| Column | Meaning |
|--------|---------|
| `appointment_count` | How many appointments of this type this doctor has tracked |
| `avg_planned_duration` | Average `duration_min` from those appointments |
| `avg_actual_duration` | Average `(treatment_end_time − treatment_start_time) / 60` |
| `avg_deviation` | `avg_actual_duration − avg_planned_duration` (positive = runs over) |

**Displayed in**: `StaffAnalytics.svelte` (Dashboard → Staff tab) when a specific doctor is selected. Shows a table plus a dual-bar chart (planned vs actual) per appointment type. Deviation is color-coded: green ≤ 2 min, red = over, blue = under.

**Purpose for clinic management**: Identifies whether appointment slots are correctly sized per treatment type per doctor. A doctor who consistently runs +10 min on "Füllung" slots is causing schedule overruns; the slots should be lengthened or the workflow optimised.

### Architecture Notes

- **No separate stats table** — all metrics are derived at query time from the `appointments` table columns. This keeps data in one place, avoids synchronisation bugs, and lets the queries adapt to any date range or filter.
- **NULL safety** — all avg calculations use `CASE WHEN ... IS NOT NULL THEN ... ELSE NULL END` so SQLite's `AVG()` ignores untracked appointments rather than counting them as zero.
- **Optimistic UI on status change** — the schedule page updates `appointments[idx].status` and `arrival_time` in local state immediately; no reload required. The DB write happens in the background via `updateAppointmentStatus`.
- **context menu suppression fix** — `onGridPointerDown` in `DayView.svelte` has an early `if (e.button !== 0) return` guard. Without this, the pointer capture system called `preventDefault()` on right-clicks, which suppressed the `contextmenu` event before it reached the appointment wrapper div.

---


## Doctor Performance Analytics

The `/reports` route is a standalone doctor performance dashboard (no longer a clinical filter report). Navigation link restored in the left sidebar.

### Data Sources

Four DB functions in `src/lib/services/db.ts`:

| Function | Returns | Query |
|----------|---------|-------|
| `getDoctorPerformanceKPI(doctorId, dateFrom, dateTo)` | `DoctorPerformanceKPI` | Aggregated appointment counts, completion/cancel/no-show rates, avg planned/actual duration, working days |
| `getAllDoctorKPIs(dateFrom, dateTo)` | `DoctorPerformanceKPI[]` | Same query without doctor filter — all doctors in one call |
| `getDoctorMonthlyTrend(doctorId, dateFrom, dateTo)` | `DoctorMonthlyTrend[]` | `strftime('%Y-%m', start_time)` GROUP BY month |
| `getDoctorDowDistribution(doctorId, dateFrom, dateTo)` | `DoctorDowStat[]` | `strftime('%w')` weekday distribution, excludes cancelled/no_show |

### Types (in `src/lib/types.ts`)

```ts
interface DoctorPerformanceKPI {
  doctor_id: string; doctor_name: string; doctor_color: string;
  total: number; completed: number; cancelled: number; no_show: number;
  working_days: number;
  avg_planned_duration: number | null; avg_actual_duration: number | null; avg_deviation: number | null;
}
interface DoctorMonthlyTrend { month: string; total: number; completed: number; cancelled: number; no_show: number; }
interface DoctorDowStat { dow: number; count: number; }
```

### Page Architecture (`src/routes/reports/+page.svelte`)

Controls: doctor selector (all or single), date range inputs, quick preset buttons (this month / last 3 months / this year).

- **All-doctors view**: comparison table with colored doctor dots, clickable name drills into single-doctor view
- **Single-doctor view**: 4 KPI cards (total, avg/day, completion rate, avg deviation) + secondary stats strip (cancelled, no-show, avg planned/actual) + monthly trend vertical bars (completed=green, cancelled=red, no-show=orange) + day-of-week horizontal bars (Mon-first: 1,2,3,4,5,6,0) + treatment types dual-bar table (reuses `getDoctorTreatmentStats`)

All charts are CSS-only (no charting library). `` reloads on any filter change.

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
- [x] Phase 8 / 8b / 8c / 8d — Appointment Scheduling + UX polish + Block drag/resize + Appointment status lifecycle + Treatment time tracking + Custom appointment statuses
- [x] Phase 9 / 9b / 9c / 9d — Dashboard Analytics Overhaul + UX polish + Doctor Performance Analytics (reports page)
- [x] Phase 10 (partial) — IOTN Ortho rebuild, plan timeline indicators, PAR removal
- [x] i18n full audit — all hardcoded German strings replaced with `i18n.t.*` keys across all routes and components

---

## What to Build Next

**Phase 7 — remaining:**
1. Multi-user roles — map `doctors` table to login/session concept

**Phase 8 — remaining:**
2. Recall / reminder system
3. Week/month schedule views
4. Doctor working hours UI — `DoctorWorkingHoursDialog.svelte` exists but is not yet surfaced in Settings (no route/nav entry)

**Phase 9 — remaining:**
6. Drill-down on heatmap / day chart
7. Dashboard date range override (custom range beyond period toggle)
8. Time-series trend sparklines on stat cards

**Clinical intelligence — remaining:**
10. Make keyword mappings user-configurable in Settings (`src/lib/services/keyword-engine.ts` done, needs Settings UI)
11. Cost / Billing module (deferred)
12. Time-series outcome survival curves in Reports
13. Cohort comparison (side-by-side group analysis)

**Phase 10 — remaining:**
14. `OrthoSnapshotCard` read-only view for legacy KIG entries could show a note "Recorded under legacy KIG system" instead of the insurance badge — low priority

---

## Cephalyzer Integration

Cephalyzer (React cephalometric X-ray analysis app) is embedded inside DentVault as a full-screen iframe. See root `../CLAUDE.md` for the full cross-app architecture.

### Key files

- **`src/lib/stores/cephSelection.svelte.ts`** — Svelte 5 reactive store holding the currently selected vault file for Ceph analysis. PatientTreeView writes to it on single-click; TimelineView's Ceph button reads from it.
- **`src/routes/patients/[patient_id]/ceph/+page.svelte`** — Hosts the Cephalyzer iframe, bridges postMessages, handles `SAVE_CEPH` (writes `.ceph` file via Rust `write_text_file`) and `NAVIGATE_BACK` (calls `goto(/patients/${id})`).
- **`src/routes/+layout.svelte`** — Derives `isCephPage = page.url.pathname.endsWith('/ceph')`. When true: hides `<aside>`, sets `overflow-hidden` on `<main>`, removes `p-6` from content wrapper.

### postMessage protocol (parent side)

| Received from iframe | Action in `ceph/+page.svelte` |
|----------------------|-------------------------------|
| `SAVE_CEPH { content, filename }` | Write file to X-ray's directory via `writeTextFile`, reply with `SAVE_CEPH_RESULT { success, path }` |
| `NAVIGATE_BACK` | `goto(/patients/${patientId})` |

| Sent to iframe (in `onIframeLoad`) | Trigger |
|------------------------------------|---------|
| `LOAD_IMAGE { url, name, patientName }` | File is an image extension |
| `LOAD_CEPH { content, patientName }` | File ends in `.ceph` |

### cephSelection store

```ts
// src/lib/stores/cephSelection.svelte.ts
cephSelection.select(file: VaultFileInfo | null)  // PatientTreeView calls on click
cephSelection.clear()                               // Called when patient changes
cephSelection.file                                  // Currently selected file (reactive)
isCephCompatible(filename)  // true for png/jpg/jpeg/gif/tif/tiff/.ceph
isCephFileType(filename)    // true only for .ceph
```

### Ceph button in TimelineView

Lives in the Chart/Plan/Ortho toolbar row. Cyan-tinted when a file is selected; disabled/faded otherwise. Uses `cephSelection.file` from the store. Navigates to `/patients/${patientId}/ceph?filePath=...&fileName=...`.

### Layout rules for ceph route

- `isCephPage` hides the entire `<aside>` sidebar
- `<main>` class switches from `overflow-auto` to `overflow-hidden`
- Inner content wrapper: `{isCephPage ? '' : 'p-6'}` — no padding on ceph page
- Ceph page itself uses `<div class="flex flex-col h-full">` (no `-m-6` needed)
- `convertFileSrc(path)` converts filesystem path to Tauri asset URL for image loading and `.ceph` file fetching
