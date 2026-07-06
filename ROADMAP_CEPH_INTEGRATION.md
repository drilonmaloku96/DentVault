# Roadmap — Cephalyzer × DentVault Integration ("Ceph-Vault Symbiosis")

**Status**: Planned · **Created**: 2026-07-05

## Goal

Make Cephalyzer feel like a native DentVault module instead of a standalone web app that
happens to live inside it. Ceph analyses become first-class, structured, queryable patient
data — consistent with DentVault's core principle.

## Guiding decision: keep the iframe, kill the seams

A full rewrite of Cephalyzer (React + Zustand, 14 store slices) into Svelte 5 would take
weeks and reintroduce solved bugs. The iframe is not the UX problem — the *seams* are.
We keep the React codebase and the postMessage bridge, and invest everything in making the
boundary invisible.

Current state (July 2026 — the experimental "CEPH-VAULT SYMBIOSIS" workspace was deleted;
its Cephalyzer-side changes were re-implemented in the standalone repo per
`../Cephalyzer/SYMBIOSIS_PORT_PLAN.md`, now executed):

- **Cephalyzer side: DONE.** One codebase serves web/Electron and the embed. Runtime
  detection in `src/lib/embed.ts` (`isEmbedded()` / `isPublicWeb()`) gates the vault Save
  flow vs. AuthGate/Tutorial/Analytics — nothing is stripped at build time anymore.
  Bridge implemented: `LOAD_IMAGE`, `LOAD_CEPH`, `SAVE_CEPH`/`SAVE_CEPH_RESULT`,
  `SAVE_PDF`/`SAVE_PDF_RESULT`, `NAVIGATE_BACK`.
- Cephalyzer built with `--mode electron` via `npm run sync-ceph` (T.1, done), copied to
  `DentVault/static/cephalyzer/`
- **DentVault side: core flow DONE (July 2026).** `src/routes/patients/[patient_id]/ceph/+page.svelte`
  hosts the iframe in a `FullScreenView` and implements the parent half of the bridge
  (`?file=` query param = vault-relative path). Entry flow (user-chosen design): files in
  the sidebar tree (`PatientTreeView`) are click-selectable (toggle + highlight) via
  `cephSelection.svelte.ts`; the TimelineView toolbar (next to Chart/Plans/Ortho) has a
  "Ceph Analysis" button that activates when the selection is a Cephalyzer-compatible
  image or `.ceph` for the open patient. In embedded mode Cephalyzer shows no upload/home
  screen (a "Loading X-ray…" state until `LOAD_*` arrives) and the save dialog asks only
  .ceph / PDF / harmony-box — the filename is auto-derived from the X-ray's basename.
  Rust commands `read_text_file` / `write_base64_file` added (`base64` crate).
  `.ceph` + PDF are saved next to the source X-ray; if a sibling `.ceph` with the same
  basename exists, it is loaded (`LOAD_CEPH`) instead of the raw image, so re-analyzing
  continues the saved analysis. New bridge message: iframe posts `CEPH_READY` when its
  listener mounts; the parent waits for it before posting `LOAD_*` (1.2 s post-load timer
  as fallback). Verified with a Playwright run against the dev server with a mocked Tauri
  IPC layer (route → LOAD_IMAGE → save dialog → SAVE_CEPH written to the right vault path
  → NAVIGATE_BACK).
  Not yet done: analyses/PDFs are untracked files (no `documents` row, no timeline entry —
  that's Phase 1), and there is no "open existing analysis" entry point until 1.1's
  timeline cards exist (saved `.ceph` files are reachable by re-clicking Analyze on the
  same X-ray).

---

## Phase 1 — Ceph analyses as first-class patient data

*The biggest UX win; everything else builds on this.*

- [ ] **1.1 Timeline entries for analyses.** On `SAVE_CEPH`, DentVault inserts/updates a
  timeline entry of a new system type `ceph_analysis` (follow the `chart_snapshot` /
  `ortho_snapshot` pattern, add to `SYSTEM_ENTRY_TYPES`). Payload in `chart_data` JSON:
  key measurements (SNA, SNB, ANB, …), the `.ceph` file's vault-relative path, analysis
  date, template used. Same-file re-save updates the existing entry instead of duplicating.
- [ ] **1.2 `CephSnapshotCard.svelte`.** Timeline card rendering headline measurements
  (with normal-range indication) + thumbnail, so the clinician sees results without opening
  the analyzer. Click reopens the analysis in Cephalyzer.
- [ ] **1.3 Patient HTML export.** New `renderCeph()` section in `patient-export.ts`
  (mandatory export-compatibility rule). Renders measurement tables per analysis; include
  the `.ceph` and PDF files in the copied assets. New section toggle `ceph` in
  `PatientExportOptions.sections`.
- [ ] **1.4 Register PDF reports.** `SAVE_PDF` output gets a row in the `documents` table
  (and thus a `document` timeline entry) instead of landing as an untracked file.
- [ ] **1.5 DB migration.** Append-only migration if any new column/table is needed
  (likely none — `timeline_entries.chart_data` should suffice). Bump `LATEST_VERSION`.
- [ ] **1.6 i18n.** All new UI strings in `types.ts` + `de.ts` + `en.ts`
  (`timeline.cephCard.*`, `export.sections.ceph`, …).

## Phase 2 — Streamline the entry flow

*Today's flow (click file in tree → find Ceph button in toolbar) requires knowing the trick.*

- [ ] **2.1 Launch from the timeline.** "Analyze" action on any ceph-compatible
  image/document entry; click-to-reopen on `ceph_analysis` entries.
- [ ] **2.2 Double-click in PatientTreeView.** Double-clicking a compatible file opens it
  in Cephalyzer directly. The `cephSelection` store + toolbar button remain as fallback.
- [ ] **2.3 Vault mode boot.** `?embedded=1` query flag (or an `INIT` handshake message):
  Cephalyzer skips the upload/landing screen, hides all remaining web-only chrome
  (account/upgrade leftovers from the OAuth strip), and shows a minimal "waiting for
  image" state until `LOAD_IMAGE`/`LOAD_CEPH` arrives. No flash of the standalone app's
  empty state.

## Phase 3 — Visual & behavioral coherence

- [ ] **3.1 Theme sync.** Pass DentVault's light/dark theme in the bridge handshake
  (`INIT { theme }` + live `THEME_CHANGED` message). A mismatched analyzer is the most
  obvious "different app" tell.
- [ ] **3.2 Language sync.** Pass locale in the handshake; add a German string layer to
  Cephalyzer (its UI surface is small relative to DentVault's). Until done, Cephalyzer
  stays English-only — acceptable interim, not the end state.
- [ ] **3.3 Autosave into the vault.** Route Cephalyzer's existing 30 s autosave through
  `SAVE_CEPH` (silent flag, no PDF/navigation side effects) instead of localStorage.
  Crash never loses work; the recovery modal becomes unnecessary in embedded mode.
- [ ] **3.4 Unsaved-changes guard.** Back navigation (thin bar link + `NAVIGATE_BACK`)
  confirms when there are unsaved landmarks. Currently backing out silently discards work.

## Phase 4 — Clinical leverage (the symbiosis payoff)

- [ ] **4.1 Comparison mode fed from the vault.** DentVault lists the patient's prior
  `.ceph` analyses and sends two through the bridge (`LOAD_CEPH_COMPARISON`), so
  longitudinal pre/post comparison is two clicks instead of manual file juggling.
- [ ] **4.2 Measurements over time.** With measurements stored in timeline payloads
  (1.1), chart ANB/SNA/etc. per patient over time — fits the outcome-tracking goal and
  complements the IOTN work.

## Tooling

- [x] **T.1 `npm run sync-ceph`.** DentVault `package.json` script wrapping
  `npx vite build --mode electron` + `rm -rf`/`cp -r` into `DentVault/static/cephalyzer/`,
  so the "never use `npm run build`" footgun can't fire. Run it from `DentVault/` after any
  Cephalyzer change to refresh the embedded copy.

---

## Bridge protocol — target state

| Direction | Type | Payload | Phase |
|-----------|------|---------|-------|
| Parent → iframe | `INIT` | `{ theme, locale, patientName, embedded: true }` | 2.3 / 3.1 / 3.2 |
| Parent → iframe | `THEME_CHANGED` | `{ theme }` | 3.1 |
| Parent → iframe | `LOAD_IMAGE` | `{ url, name, patientName }` | exists |
| Parent → iframe | `LOAD_CEPH` | `{ content, patientName }` | exists |
| Parent → iframe | `LOAD_CEPH_COMPARISON` | `{ contentA, contentB }` | 4.1 |
| Parent → iframe | `SAVE_CEPH_RESULT` | `{ success, path? }` | exists |
| Parent → iframe | `SAVE_PDF_RESULT` | `{ success, path? }` | exists |
| Iframe → parent | `SAVE_CEPH` | `{ content, filename, measurements?, silent? }` | exists → extend (1.1 / 3.3) |
| Iframe → parent | `SAVE_PDF` | `{ base64, filename }` | exists → register in DB (1.4) |
| Iframe → parent | `NAVIGATE_BACK` | `{ dirty?: boolean }` | exists → extend (3.4) |

## Order of work

1 → 2 → 3 → 4. Phase 1 first because timeline/export integration defines the data shape
everything else (cards, comparison, trends) consumes. Tooling (T.1) can land any time.

## Conventions checklist (applies to every phase)

- DB migrations append-only; bump `LATEST_VERSION`
- All strings through `i18n.t.*`, EN + DE
- New patient data appears in the HTML export
- `npm run check` passes 0 errors
- Cephalyzer always built with `--mode electron` for embedding
