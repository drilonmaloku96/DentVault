# Timeline Reference

## Polling & Anti-flicker

**Silent refresh**: `hasEverLoaded` flag controls skeleton visibility — skeleton shows only on the very first fetch (`!hasEverLoaded`), never on background polls. Set `hasEverLoaded = true` after the first successful load. Background polling must NOT set `isLoading = true` once entries have loaded.

**Anti-flicker fingerprints**: `loadEntries` uses `id|updated_at` fingerprints instead of `JSON.stringify` — `entryFingerprint(e) = \`${e.id}|${e.updated_at}\`` joined with `','`. Same pattern for `plansMap` using `plan_id|updated_at`. Only reassigns state when fingerprint string changes — avoids full re-render on background poll when data is unchanged.

**Scroll to revealed element after image expand**: call `scrollIntoView` AFTER awaiting the image `load` event. Pattern: `if (!img.complete) await new Promise(r => img.addEventListener('load', r, { once: true }))` before measuring.

## Entry Data Model

- **`provider` field deprecated**: free-text `provider` column no longer shown in UI. Use `doctor_id` + `colleague_ids`. Legacy `provider` shown with "(legacy)" label in expanded entry view only.
- **`TimelineEntryType` is now `string`**: loosened from strict union. `SYSTEM_ENTRY_TYPES = new Set(['document', 'plan', 'chart_snapshot', 'ortho_snapshot'])` identifies system-only types. Legacy strings ('visit', 'procedure', etc.) via `LEGACY_LABELS` in `entryTypes.svelte.ts`.
- **`entry_teeth` sync**: whenever inserting/updating `timeline_entries` with `tooth_numbers`, call `syncEntryTeeth(entryId, toothNumbers)`.

## Filter Bar

"Filter by" dropdown button (searchable, checkboxed types + doctors, grouped) + free-text/date search input (`searchQuery`). State: `activeFilters: Set<string>`, `activeDoctorId: number | null`, `filterDropdownOpen`, `filterSearch`, `searchQuery`.

## Timeline Entry Types

### Ortho Snapshots

Ortho assessments saved as `entry_type: 'ortho_snapshot'` timeline entries (not in `ortho_assessments` table). Same-date dedup: delete existing `ortho_snapshot` for same date before inserting new one. Stored payload in `chart_data` JSON. Past entries are read-only (`is_locked: 1`). Rendered by `OrthoSnapshotCard.svelte`. Export reads them from timeline entries, not DB table.

`OrthoSnapshotCard.svelte` detects IOTN (`dhc` key present) vs legacy KIG (`findings` array) at runtime.

**IOTN system** — `OrthoChartDialog.svelte` rebuilt on the Austrian IOTN standard. Condition-first flow: clinician picks malformation type, enters measurement, DHC grade is **auto-derived**. Conditions: `i` (retained), `h` (hypodontia), `a` (positive overjet + lip competence), `b/m` fused (reverse overjet + masticatory difficulties), `c` (crossbite RCP/ICP discrepancy), `d` (contact point displacement), `f` (deep overbite: 4-option selector), `e` (open bite), binary Sonstiges (`g/l/p/s/t/x`). AC (1–10) is separate. Score stored as `dhc: IOTNDHCFinding` (worst finding) + `dhc_measurements` (full detail for re-loading).

**`IOTNDHCFinding` type** (`src/lib/types.ts`): `{ grade: 1|2|3|4|5; subcategory: string; mm_value: number | null }`. `OrthoAssessment` has optional `dhc?: IOTNDHCFinding` and `ac_grade?: number` (new) alongside optional `findings?: OrthoKigEntry[]` (legacy KIG — do not remove).

**IOTN i18n keys** in `ortho.*`: `dhcTitle`, `dhcNeedLevel` (grades 1–5), `dhcSubcategories` (all condition codes 2a–5x), `acTitle`, `acGradeDesc` (1–10), `iotnScore`. Legacy KIG keys (`groups`, `grades`, `insuranceCovered`, `notCovered`, `leadingGroup`) kept for backward-compat — do not remove.

### Plan Timeline Entries

`insertTreatmentPlan` in `db.ts` auto-inserts a `plan` type `timeline_entry` linked via `plan_id`. `deleteTreatmentPlan` deletes the linked entry before the audit log. `updateTreatmentPlan` syncs the entry title when `title` changes.

In `TimelineView.svelte`, `plan` entries render as a slim single-line indicator (icon + plan name + status label + chevron) that opens `TherapyPlanView` on click — no separate card component. `plansMap` (`Map<number, TreatmentPlan>`) is passed down to look up plan details by `plan_id`. i18n key: `plans.status.edited`.

### TherapyPlanView Keyboard Shortcuts

Multi-tooth selection uses `altSelectedTeeth` (Alt+click or plain drag in plan mode) — separate from `DentalChartView`'s `ctrlSelectedTeeth`. Keyboard handler (`$effect`, active when dialog `open`): if `altSelectedTeeth.length > 0`, pressing a shortcut key calls `applyProcToSelection(procKey)`; otherwise calls `toggleProcedureOnTooth(selectedTooth, procKey)`. `PROC_SHORTCUT` is a `$derived` map of `procKey → shortcutKeyString`. Guard: skip if target is input/textarea.

## Rich Text Editor

`description` stores raw HTML. `TimelineEntryBar.svelte` body editor uses `bind:this={editorEl}` (NOT `bind:innerHTML`) — reads innerHTML manually in `handleDescriptionInput` and on submit. `TimelineEntryForm.svelte` description editor uses `bind:innerHTML={description}`. Card display uses `{@html}`. Shortcuts: Cmd/Ctrl+B/I/U. Toolbar buttons use `onmousedown` + `e.preventDefault()`. Selection API via TreeWalker for `@` mention and `/` text block detection.

### Entry Bar — Enter Key Inserts Newline

Plain Enter in `contenteditable` calls `insertBodyLineBreak()` which does `document.execCommand('insertHTML', false, '<br>​')`. The zero-width space (U+200B) after `<br>` gives WebKit a real text node to land the cursor in — without it WebKit does not reliably render the cursor on the new line. `​` is stripped from `description` before saving via `.replace(/​/g, '')` in `handleSubmit`. Cmd/Ctrl+Enter submits.

**Critical guard**: always check `showMentionPalette || showPalette` before any Enter handling — palette components are conditionally rendered and their refs can be null briefly.

### `applyToothHighlighting` Cursor Reset Trap

`applyToothHighlighting(el)` saves/restores the cursor as a plain text-character offset (`pre.toString().length`) which is blind to `<br>` elements. If it runs after a line-break insertion the cursor snaps back to the previous line. **Never dispatch a synthetic `input` event from within `insertBodyLineBreak()`** — that would trigger `handleDescriptionInput` → `applyToothHighlighting`. Instead update state directly: `description = editorEl.innerHTML`.

### `@` Mention — Auto-removes `@` from Editor

`insertMention` calls `document.execCommand('insertText', false, '')` to delete the `@query` text — the doctor is added as a tag only, not inline in the description. Same pattern in both `TimelineEntryBar.svelte` (`insertMention`) and `TimelineEntryForm.svelte` (`insertMentionInForm`).

## Text Color Picker

`src/lib/components/timeline/TextColorPicker.svelte`: Floating pill above selected text. Colors user-configurable via `textHighlightColors` store — defaults: red `#dc2626`, blue `#2563eb`, green `#16a34a`. Uses `document.execCommand('foreColor', false, hex)` / `'inherit'` to apply/remove.

Built with vanilla DOM (`document.body.appendChild`) to escape transformed ancestors (Dialog `translate-x/y` would break `position:fixed` children). `showPopup` always rebuilds fresh (no caching) so color list stays in sync. Activated by `mouseup`/`keyup`; dismissed by `mousedown`. Used in `TimelineEntryBar.svelte` (passes `docBoxEl`) and `TimelineEntryForm.svelte` (passes `descContainerEl`). i18n keys: `timeline.bar.formatting.{red,blue,green,remove}`.

## Layout Details

- **Sticky patient header**: `sticky top-0 z-20` in `src/routes/patients/[patient_id]/+page.svelte`, height ≈ 76px. Uses `-mx-6 -mt-6 px-6 pt-6` to flush to scroll container edges. Timeline toolbar sticky at **`top-[76px]`** (`z-10`).
- **Entry bar body editor height**: `min-h-[52px] max-h-[140px] overflow-y-auto` — expands freely up to ~6 lines, then scrolls internally. Absolute-positioned Add button (`right-2 bottom-2`) stays fixed; `pr-32` on the editor reserves space for it.

## `TimelineEntryCard.svelte` — Flat Visual Style

Clinical entries use a borderless/card-free layout. Title row: type icon + bold title + category/outcome badges + muted date + 3-dot menu. Meta row: doctor dot + name, colleague colored pill badges. Description: `font-mono text-[13px] text-muted-foreground/80 leading-relaxed` with show-more/less at 350 chars. `descExpanded` state + `descIsLong` derived from `entry.description.length > 350`.

## Removed Items (don't re-add)

- **Timeline toolbar**: "Dokumente hochladen" and "Neuer Plan" buttons removed from `TimelineView.svelte`. `DocTemplatePickerDialog` component and `showDocTemplatePicker` state remain in file but button is gone. "+ Template" teal button also removed.
- **PAR button** removed from patient top bar (`src/routes/patients/[patient_id]/+page.svelte`).
