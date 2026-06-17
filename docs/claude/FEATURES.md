# Features Reference

## Vault & Files

**Vault existence check on startup**: `vault.init()` calls `file_exists` Rust command. If folder gone, `_vaultPath = null`, `isConfigured = false` → triggers onboarding wizard.

**`!TEMPLATE` folder**: Created/synced by `ensure_template_structure(vault_path, category_folders)` Rust command — this command **also always creates `!Documents/`** in the same call. Files copied to every new patient via `copy_template_to_patient`. Copied files pre-registered in `documents` table on patient create to suppress untracked-files banner.

**`!Documents` folder**: Second vault-root special folder for reusable document templates (PDFs, Word files, etc.). Created atomically alongside `!TEMPLATE` by `ensure_template_structure`. Rust commands: `ensure_doc_templates_folder`, `list_doc_templates`, `save_doc_template`, `copy_doc_template_to_patient`, `delete_doc_template`. TS wrappers in `src/lib/services/files.ts` (`DOC_TEMPLATES_FOLDER = '!Documents'`). Shown in Settings → Documents → Document Templates with file list and Finder button.

**Delete patient folder**: `delete_patient_folder(vault_path, patient_folder)` Rust command — called automatically when deleting patients from Settings → Patient Management.

**Database backup**: Rust command `backup_database(vault_path, dest_path)` copies `dentvault.db`.

**Vault backup**: Rust command `backup_vault_to(vault_path, dest_dir)` copies entire vault to `{dest_dir}/DentVault-Backup-{YYYY-MM-DD}/`.

**Settings export/import**: `getAllSettings()` / `bulkSetSettings(entries)` in `db.ts`. Export: `{ version, exportedAt, app, settings[] }`. Import: validate → confirm dialog → `bulkSetSettings` → reload.

**Opening files externally**: use `invoke('open_file_native', { path })` in `src/lib/services/files.ts` — do NOT use `openPath` from `@tauri-apps/plugin-opener` (silently fails).

## Patient Form

**Extended patient data model**: v31 adds 10 columns: `address`, `city`, `postal_code`, `country`, `emergency_contact_name/phone/relation`, `blood_group`, `primary_physician`, `marital_status`. `PatientStatus` includes `'deceased'`. `PatientForm` has 7 sections.

**Patient search multi-word**: `searchPatients` matches `firstname || ' ' || lastname`, `lastname || ' ' || firstname`, `lastname || ', ' || firstname` — so "Max Muster", "Muster Max", "Muster, Max" all work.

## Settings Page

**Two-panel layout**: fixed left `<nav>` (208px, `w-52 shrink-0`) + scrollable right content (has `use:scrollIndicator={{ zIndex: 45 }}`). Outer wrapper `class="flex h-full overflow-hidden -m-6"`. `activeSection` (`$state<string>`, default `'general'`).

Seven nav items: `home` (overview landing grid), `general` (language + appearance + vault + backup + about), `team` (staff + working hours + roles), `schedule` (working hours + rooms + appointment types), `clinical` (clinical tags + complications + text blocks + text highlight colors + dental tags + crown findings + root canal statuses + prosthetics/bridges + plan procedures + DMFT), `documents` (folder categories/!TEMPLATE + document templates/!Documents), `patients` (management + export). Each page is one long scrollable view with `<Separator />` dividers.

**Scroll position memory**: `navigateTo(key)` saves `contentEl.scrollTop` into plain `Record<string, number>` before switching, restores via `tick().then(...)`. Plain object — not `$state`.

**Document Categories UX**: The category table/card is visually framed as the `!TEMPLATE/` folder (amber header, folder icon). Each category row = one subfolder on disk. An `!Documents/` card below shows that folder's file list with type icons, KB sizes, and open-file buttons.

**"Reset to Defaults" buttons removed** from Settings — `DEFAULT_*` constants kept for onboarding only.

## `scrollIndicator` Svelte Action

(`src/lib/actions/scrollIndicator.ts`) Attaches a floating `position:fixed` pill (chevron-down icon, primary accent color) to any overflow scroll container. Appears when content extends below visible area; fades out near bottom.

Options: `zIndex` (default 40), `offset` (px from bottom edge, default 20), `threshold` (px proximity before fade, default 48). CSS animation injected once via `stylesInjected` singleton. Listeners: `scroll` (passive) + `ResizeObserver` + `MutationObserver(childList+subtree)`. rAF deduplication via `schedule()`. Pill style: `var(--primary)` background, `var(--primary-foreground)` color.

**Apply only on native HTML elements** (not Svelte components). Z-index convention: `40` for main content area, `45` for Settings right panel, `55` for inside dialogs (above shadcn z-50). Applied to: `<main>` in `+layout.svelte` (z:40), Settings right panel (z:45), `OrthoChartDialog.svelte` scroll body (z:55), three scroll containers in `TherapyPlanView.svelte` (z:55).

## Already-Configurable Systems

- **Document Categories** — Settings › Documents, `settings` table, drives vault folder creation + timeline badges
- **Clinical Tags** — `acuteTagOptions` + `medicalTagOptions` stores (Settings › Clinical Tags)
- **Staff Roles** — `staffRoles` store (Settings › Team)
- **Text Blocks** — `textBlocks` store (Settings › Clinical), `/` command palette
- **Complication Types** — `complicationTypes` store, 13 defaults. Key: `'complication_types'`. Store: `src/lib/stores/complicationTypes.svelte.ts`
- **Entry & Appointment Types (unified)** — `entryTypes` store is a thin derived view over `appointmentTypes.active`. One list for both timeline entry type dropdown and scheduler. `entryTypes.load()` is a no-op — `appointmentTypes.load()` handles loading. `TimelineEntryCard` uses `appointmentTypes.active.find(t => t.name === entry.entry_type)` for hex color; legacy types use `STATIC_TYPE_CONFIG`.
- **Dental Tags** — `dentalTags` store (`src/lib/stores/dentalTags.svelte.ts`). Shortcuts in `docs/claude/DENTAL_CHART.md`. `watch` tag key removed.
- **Bridge Appearance** — `bridgeRoles` store (`src/lib/stores/bridgeRoles.svelte.ts`), 3 roles. Key: `'bridge_role_configs'`
- **Prosthesis Type Appearance** — `prosthesisTypes` store (`src/lib/stores/prosthesisTypes.svelte.ts`), 2 types. Key: `'prosthesis_type_configs'`
- **Text Highlight Colors** — `textHighlightColors` store (`src/lib/stores/textHighlightColors.svelte.ts`), max 8 colors. Key: `'text_highlight_colors'`. Default: red `#dc2626`, blue `#2563eb`, green `#16a34a`. Settings → Clinical → Text Highlight Colors.
- **Crown Findings** — `crownFindings` store. 10 built-in findings, user can add custom ones. Key: `'crown_findings'`. Settings → Clinical → Crown Findings.
- **Root Canal Statuses** — `canalStatuses` store. 7 built-in statuses, user can add custom ones. Key: `'canal_statuses'`. Settings → Clinical → Root Canal Statuses.
- **Appointment Statuses** — `appointmentStatuses` store (`src/lib/stores/appointmentStatuses.svelte.ts`). 6 built-in statuses (`scheduled`, `waiting`, `in_chair`, `completed`, `cancelled`, `no_show`). Each has `label`, `kuerzel` (badge abbreviation), `color`. Built-ins editable but not deletable; custom ones freely added/deleted. Key: `'appointment_statuses'`. Settings → Schedule → Appointment Statuses. Drives `AppointmentBlock` badge, border, background, context menu, and `BookingPanel` status buttons.
- **Appointment Type Icons** — `icon` field on `appointment_types` table (v64). Emoji shown in calendar blocks instead of color dot. Editable in Settings → Schedule → Appointment Types.
