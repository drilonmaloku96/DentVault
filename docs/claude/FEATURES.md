# Feature Reference

## Onboarding Wizard

First-run setup when `vault.isConfigured` is `false`. Component: `src/lib/components/onboarding/OnboardingWizard.svelte`, mounted in `src/routes/+layout.svelte`.

```svelte
{#if vault.initialized && !vault.isConfigured}
  <OnboardingWizard onConfigured={onVaultConfigured} />
{:else}
  <!-- main app shell -->
{/if}
```

`vault.isConfigured` becomes `true` only when `vault.configure(path)` is called — deferred to last step.

### Steps

| # | Name | Content |
|---|---|---|
| 0 | Welcome | Logo, title, language switcher (DE / EN) |
| 1 | Vault | Folder picker, vault structure preview (monospace tree) |
| 2 | Team | Staff list (name + role select), skip allowed |
| 3 | Defaults | Read-only preview of 5 default sections as chip groups |
| 4 | Done | Animated SVG checkmark, "Add First Patient" button triggers `finish()` |

### `finish()` sequence

```typescript
await vault.configure(selectedPath.trim());   // 1. configure vault (creates DB)
resetDb();                                     // 2. reconnect db.ts
await i18n.setLang(i18n.code);                // 3. persist language choice
// insert staff doctors...
await Promise.all([stores.load()...]);        // 4. reload all stores
onConfigured();                               // 5. triggers layout to show main app
```

Language switching on step 0: `switchLang(code)` calls `i18n.setLang(code)` but if vault not configured yet the DB write may fail — catches error and falls back to in-memory only. `finish()` re-persists after vault is configured.

**Transitions**: `{#key step}` with `in:fly={{ x: direction * 40 }}` — +1 forward, −1 back.

**`onVaultConfigured`**: calls `window.location.reload()` to reinitialise all Svelte stores.

---

## Patient Sidebar File Tree

When patient selected in `PatientSidebar.svelte`, switches to file-system tree view: `PatientTreeView.svelte`.

- Data: `listVaultFiles(vaultPath, patientFolder)` Tauri command → `VaultFileInfo[]`
- Folder name computed via `vault.patientFolder(lastName, firstName, patientId)`
- Shows all 6 standard folders + any extras on disk
- Folders with files auto-expand on load; empty folders start collapsed
- **Single-click folder** → toggle expand/collapse
- **Double-click folder** → open in OS Finder/Explorer via `open_file_native` (NOT `@tauri-apps/plugin-opener`)
- **Double-click file** → open with OS default app
- Folder labels language-aware: from `i18n.t.defaults.docCategories`
- Folder icons: uniform SVG folder icon, `text-sidebar-primary` — NOT category-specific emojis
- File icons: uniform SVG document icon, `text-muted-foreground/50` — NOT extension-specific emojis

`PatientSidebar` state: `activePatient = $state<Patient | null>(null)` — set by `$effect` watching `activePatientId`.

---

## Vault Path Change

Settings page `handleChangeVault()`:

```typescript
const path = await pickDirectory();
if (!path) return;
await vault.configure(path);
resetDb();
window.location.reload();   // ← critical: reinitialises sidebar + all stores
```

---

## Timeline Auto-Scroll

`TimelineView.svelte` — scrolls to bottom on initial load so newest entries are visible:

- `bottomAnchor` div placed **after** the `h-56` spacer (not before — would stop short by spacer height)
- `behavior: 'instant'` — no visible scroll animation on page open
- Deferred with `requestAnimationFrame` after `await tick()` — `tick()` alone is not enough

```typescript
if (scrollToBottom) {
    await tick();
    requestAnimationFrame(() => {
        bottomAnchor?.scrollIntoView({ behavior: 'instant', block: 'end' });
    });
}
```

---

## GitHub Actions / CI Build

`.github/workflows/release.yml` — manual `workflow_dispatch` trigger.

- **`windows-latest`** runner → `.msi` / `.exe` via `tauri-apps/tauri-action@v0`
- **`macos-latest`** runner → `.dmg` (native ARM64 / Apple Silicon)
- Creates a **draft GitHub Release** — review and publish when ready
- Cannot cross-compile Windows from macOS locally
- **`frontendDist` must be `"../build"`** in `src-tauri/tauri.conf.json` (relative to `src-tauri/`, points to project-root `build/`). Using `"build"` caused CI failures.
- Universal macOS binary (`--target universal-apple-darwin`) fails DMG bundling on GitHub runners — use native ARM64 instead.

---

## Practitioner Handbook

PDF-ready handbook at `docs/handbook.html`. 12 chapters covering all feature areas.

To produce PDF:
1. Drop screenshots into `docs/screenshots/` (23 total, filenames in checklist at bottom of `handbook.html`)
2. Preview at `docs/handbook.html` in Chrome
3. `node docs/generate-pdf.js` → `docs/DentVault-Handbook.pdf`

Uses Playwright Chromium (dev dependency). Screenshot checklist page (`class="no-print"`) hidden when printing.
