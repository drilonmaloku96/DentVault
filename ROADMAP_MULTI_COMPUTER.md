# DentVault Multi-Computer Blueprint — One Clinic, One Server, Many Stations

**Status: planning document — nothing here is built yet.**
Written July 2026 against schema v68. This is the architectural blueprint for evolving
DentVault from a single-desktop app into a clinic-wide system: one server machine owning
the data, any number of workstations (front desk, operatories, doctor's office, x-ray
room) running the same DentVault app connected to it.

Guiding constraint from the product owner: **the app's functionality stays what it is.**
It will grow small utilities, but the timeline/chart/schedule/vault core is the product.
This plan therefore changes *where data lives and how it moves* — not what the app does.

---

## 1. Why the current architecture is already halfway there

Three deliberate design decisions made over the past year make this evolution far cheaper
than a rewrite. Preserve all three at every step:

1. **`db.ts` is the single choke point.** All 158 data functions live in one file; no
   component touches SQL directly. Swapping the *transport* of these functions (local
   SQLite ↔ remote server) is a contained change — the ~90 components above them never
   know the difference.
2. **Settings live in the vault DB**, not in app-local storage. When the DB moves to a
   server, every workstation automatically shares clinic-wide configuration (appointment
   types, doc categories, tag colors, working hours). Only *display-local* state
   (theme, UI scale, sidebar width) stays per-machine — and that split already exists.
3. **Vault-relative paths everywhere.** `documents.rel_path` and attachment JSON paths
   are relative to vault root (enforced in the July 2026 export audit). The vault folder
   can move to a server without any stored path breaking.

What does NOT survive the move unchanged: direct filesystem access (`open_file_native`,
`list_vault_files`, drag-drop copy), the SQLite file handle, and the 2s/5s polling loops.
Those are exactly the seams this plan addresses.

---

## 2. Options considered

### Option A — vault folder on a network share (SMB/NAS) ❌ REJECTED
Point every workstation's vault path at a shared folder. **Do not do this, ever.**
SQLite's locking is broken over SMB/NFS — two stations writing concurrently *will*
corrupt `dentvault.db` silently. This is the classic failure mode of naive clinic setups
and it destroys medical records. Rejected permanently; the app should actively refuse a
vault path that it detects is a network mount (cheap safeguard worth adding early).

### Option B — clients connect directly to a server Postgres ❌ REJECTED
Replace SQLite with Postgres on the server, every Tauri client opens its own DB
connection. Positional `$1` params mean the SQL mostly ports — but every client holds DB
credentials (any workstation can bypass all business rules), audit logging becomes
spoofable, migrations race when two clients start at once, and there's no place to put
sessions, permissions, or push notifications. Direct DB-over-LAN is the wrong trust
model for medical data.

### Option C — DentVault Server: an API process owning DB + vault ✅ CHOSEN
One server process on a clinic machine owns `dentvault.db` and the vault folder
exclusively. Workstations run the same DentVault app in **connected mode**, talking
HTTP + WebSocket to the server. All writes are validated, audited, and broadcast from
one place. This is the architecture the rest of this document details.

### Option D — full offline-first sync (CRDT replicas per station) ❌ DEFERRED
Every station has a complete replica, syncing through the server, working offline.
Maximum resilience, but conflict resolution for clinical data (two people editing the
same treatment plan offline) is a genuinely hard correctness problem, and a clinic LAN
is not an offline environment — if the server is down, the clinic has bigger problems.
Not worth the complexity now. The Phase 6 note below keeps the door open.

---

## 3. Target architecture

```
                     ┌──────────────────────────────────────────┐
                     │  SERVER MACHINE (Mac mini / small PC)     │
                     │                                          │
                     │  dentvault-server (Rust, axum)           │
                     │  ├─ SQLite (WAL mode, single writer)     │
                     │  │    dentvault.db  ← same file format,  │
                     │  │    same SCHEMA_STATEMENTS migrations  │
                     │  ├─ Vault folder (patient files)         │
                     │  ├─ HTTP API      /rpc, /files/*, /auth  │
                     │  ├─ WebSocket hub /events  (push)        │
                     │  ├─ audit.jsonl (server-side, per-user)  │
                     │  └─ scheduled backups → NAS/disk         │
                     └───────────────┬──────────────────────────┘
                                     │  LAN (TLS)
        ┌────────────────┬───────────┴───────────┬────────────────┐
        │                │                       │                │
   Front desk       Operatory 1             Operatory 2      Doctor office
   (schedule,       (patient timeline,      (chart, perio)   (reports, plans,
   check-in)        clinical notes)                           ceph analysis)

   All stations run the SAME DentVault app in "connected mode".
   Solo mode (local vault, current behavior) remains for single-chair practices.
```

### 3.1 Keep SQLite on the server — do not port to Postgres

A dental clinic's write volume is trivial by database standards: tens of writes per
minute at peak, from at most a dozen stations. SQLite in WAL mode behind a **single
server process** (which serializes writes by construction) handles this with margin.
Choosing SQLite server-side means:

- `SCHEMA_STATEMENTS` and all 68+ migrations are reused verbatim — zero porting risk.
- Solo mode and connected mode use the *identical* database file format. A growing
  practice migrates by copying their vault folder to the server. A clinic downsizing
  (or a dentist taking a laptop copy on a home visit) copies it back.
- "Full backup = copy the vault folder" stays true — now it just runs on one machine.

Postgres becomes worthwhile only at multi-site scale (Section 8). Don't pay for it now.

### 3.2 The RPC layer — how 158 functions move to the network

`db.ts` splits into three files:

```
db-core.ts      ← the 158 functions, exactly as today, importing a `query`/`execute`
                  primitive instead of calling getDb() directly
db-local.ts     ← query/execute via tauri-plugin-sql (solo mode — current behavior)
db-remote.ts    ← query/execute via POST /rpc {fn, args} to the server (connected mode)
```

Two viable shapes for the remote transport, decided at Phase 1 implementation time:

- **Shape 1 — SQL pass-through**: `/rpc` accepts `{sql, params}`; server whitelists
  statements. Fastest to build (db-core needs no changes at all), but the server can't
  attach per-function authorization or auditing semantics. Fine for Phase 1.
- **Shape 2 — named functions**: `/rpc` accepts `{fn: "insertTimelineEntry", args}`;
  the server has a handler per function (mostly generated). Required by Phase 2, since
  authorization ("assistants can't delete entries") and audit ("who did what") attach to
  *operations*, not SQL strings. Migrate Shape 1 → Shape 2 before roles ship.

The mode is chosen at startup: vault-path config gains a variant — local folder path
(solo) or server URL (connected). The onboarding wizard grows one screen.

### 3.3 Files over HTTP — the vault stays server-side

The Rust file commands get HTTP equivalents on the server:

| Today (Tauri command, local fs)        | Connected mode (HTTP)                        |
|----------------------------------------|----------------------------------------------|
| `list_vault_files`                     | `GET /files/list/{patientFolder}`            |
| `copy_file_to_vault`, `save_document_file` | `POST /files/upload` (multipart, collision-safe server-side) |
| `read_base64_file` (ceph image handoff)| `GET /files/raw/{relPath}` → bytes           |
| `open_file_native`                     | download to a local temp cache → open natively |
| `move_patient_file`, `delete_patient_file`, `create_patient_subfolder` | `POST /files/move` / `DELETE /files` / `POST /files/mkdir` |
| thumbnails (`asset://` protocol)       | `GET /files/thumb/{relPath}?w=` with server-side cache |

Two behaviors change semantics and need care:

- **"Open in Finder" / open natively**: in connected mode this becomes
  *download-to-cache-then-open*. Files opened for editing are stale copies — Phase 3's
  check-in/check-out (or a simple "downloaded copy" toast) makes this explicit. Most
  clinic files (x-rays, PDFs) are read-only in practice, so a toast suffices initially.
- **OS drag-and-drop ingestion**: the drop still happens on a workstation; VaultDropDialog
  copies to the server via `/files/upload` instead of `copy_file_to_vault`. The silent
  auto-tracker moves server-side entirely (Section 3.5).

The Cephalyzer embed needs *no* protocol change: the parent page already hands images to
the iframe as `data:` URLs — it just fetches the bytes from `/files/raw/...` instead of
`read_base64_file`. Saves go through `/files/upload`.

### 3.4 Real-time: WebSocket push replaces polling

Today: TimelineView refetches every 5s, PatientTreeView lists files every 2s. Per-station
polling against a server multiplies load and still feels laggy. Replace with an event
channel:

- Server broadcasts small invalidation events after every committed write:
  `{entity: "timeline", patientId}` · `{entity: "appointments", date}` ·
  `{entity: "files", patientFolder}` · `{entity: "settings", key}`.
- Clients subscribe to what they're displaying and refetch on event. No event payloads
  carrying data — **invalidation only**, refetch through the normal RPC path, so there is
  exactly one code path for reading data.
- The schedule page is the flagship win: front desk sets a patient to `waiting`, the
  operatory's screen updates in under a second. This is the feature that sells the
  multi-computer setup to staff.
- Solo mode keeps the current polling (or fires the same events in-process — cheap
  refactor, one abstraction: an `invalidations` store both modes feed).

### 3.5 What moves INTO the server (business logic that must not stay client-side)

- **The silent file auto-tracker** (currently in PatientTreeView): server watches its own
  vault folder (notify/fsevents crate) and creates `documents` rows + timeline entries
  for untracked files no matter how they arrived — Finder on the server machine, network
  copy, ceph save. Clients just receive `files`/`timeline` invalidations. This is
  *better* than today: tracking no longer depends on someone having the patient open.
- **`syncEntryTeeth`** and every "after insert, also do X" rule — must be transactional
  server-side, not client best-effort.
- **First-time-only appointment timestamps** (v68 `CASE WHEN col IS NULL` writes) —
  already expressed in SQL, survives as-is.
- **Audit trail**: `audit.jsonl` gains `user_id` + station fields and becomes trustworthy
  (server-written, clients can't skip it).
- **Filename collision suffixes** (`_1`, `_2`) on upload — the July 2026 client-side fix
  moves into `/files/upload`, where it's race-free.

### 3.6 Concurrency: optimistic versioning, not locks

Clinical reality: two people rarely edit the *same record* simultaneously — but the
appointment board and a patient's timeline are viewed concurrently all day. Policy:

- Every mutable table gains a `version INTEGER` (or reuses `updated_at`) — one migration.
- Updates send the version they read; the server rejects on mismatch (HTTP 409); the
  client refetches and shows "this record was changed by {user} — review and retry."
- Timeline entries are effectively append-only (edits are rare) → conflicts will be
  near-zero in practice. Appointments get most conflicts; the 409-refetch-retry loop plus
  instant WebSocket updates makes them self-resolving.
- **No pessimistic record locking.** It punishes the common case (viewing) to protect a
  rare one (concurrent edit), and dangling locks from crashed stations are worse than
  occasional 409s.

### 3.7 Users, roles, sessions (absorbs roadmap "Phase 7: Multi-user roles")

- Login screen in connected mode: pick user (from `doctors`/staff table) + PIN or
  password. Argon2 hashes in a new `user_credentials` table; server issues a session
  token; every RPC and file request carries it.
- Role model — keep it to four, resist granularity creep:
  `admin` (settings, users, backups) · `doctor` (full clinical) ·
  `assistant` (clinical documentation, no deletes of others' entries) ·
  `front_desk` (schedule + patient demographics, no clinical read beyond names/appts).
- `timeline_entries.doctor_id` can default from the logged-in user — a nice touch the
  current single-user app can't offer.
- Fast user switching at one station (front desk shift change) — session swap without
  app restart.

### 3.8 Security & data protection (this is medical data — non-negotiable)

- **TLS on the LAN**: self-signed CA generated at server install; client trusts it on
  first connect (certificate pinning). No plaintext patient data on the wire, even
  clinic-internal.
- **The server binds to LAN only** by default. Remote access (dentist at home) is a VPN
  problem (WireGuard/Tailscale), not an app problem — never expose the port to the
  internet.
- **Encryption at rest**: rely on OS full-disk encryption (FileVault/BitLocker) on the
  server machine as the baseline; revisit SQLCipher only if a compliance audit demands it.
- **Backups become a server duty**: scheduled snapshot (SQLite `VACUUM INTO` + rsync of
  vault files) to a second disk/NAS, retention policy, and a *restore test* button in
  Settings. The #1 real-world risk to this data is not hackers, it's a dead disk with
  no tested backup.
- **GDPR posture** (the practice is presumably EU): per-user audit trail (who viewed is
  logging-heavy — log writes at minimum), patient data export already exists (HTML
  export), patient deletion already exists. Document these in a one-page compliance note
  for the practice owner.

### 3.9 Deployment & operations (a dentist is not a sysadmin)

- `dentvault-server` ships as a single binary with an installer that registers it as a
  system service (launchd / Windows service) and creates the vault directory. A tiny
  status tray/menu-bar app shows: running, port, connected stations, last backup.
- **Discovery**: server advertises via mDNS (`_dentvault._tcp`); the client's connect
  screen lists discovered servers, with manual `host:port` fallback.
- **Version compatibility**: server and client exchange versions on connect. Rule:
  server migrates the DB; clients equal-or-older within the same minor version are
  accepted; a too-old client gets a "please update" screen. Client auto-update (Tauri
  updater) pointed at the clinic's own server keeps stations in lockstep.
- **Failure mode**: server unreachable → clients show a clear banner and go read-only on
  cached views (nice-to-have) or block (acceptable v1). Never silently queue writes.

---

## 4. Phase plan (sized for incremental delivery — each phase ships something usable)

### Phase 0 — Groundwork (inside the current app, no server yet)
- Split `db.ts` → `db-core.ts` + `db-local.ts` behind a `DataTransport` interface;
  everything still runs identically in solo mode. **Exit: zero behavior change,
  `npm run check` clean, app indistinguishable from today.**
- Introduce the `invalidations` store; convert TimelineView/PatientTreeView polling to
  consume it (fed by a timer in solo mode for now).
- Add the network-mount guard for vault paths (Option A safeguard).
- Add `version` column migration for optimistic concurrency (dormant until Phase 2).

### Phase 1 — Server MVP + connected mode (the big one)
- `dentvault-server` crate: axum + rusqlite(WAL); executes `SCHEMA_STATEMENTS`; `/rpc`
  (Shape 1 SQL pass-through, statement whitelist), `/files/*` endpoints, `/events`
  WebSocket with invalidation broadcast; single shared token auth (per-user comes in P2).
- `db-remote.ts`; connect screen in onboarding (mDNS + manual); temp-file cache for
  native open; VaultDropDialog + export upload/download over HTTP.
- Server-side file watcher replaces the client auto-tracker in connected mode.
- **Exit: two computers, one server; timeline entry written on station A visible on
  station B within 1s; files uploaded from A open on B; solo mode untouched.**

### Phase 2 — Real multi-user
- Shape 2 RPC (named operations); per-user sessions, Argon2 credentials, the four roles;
  server-side audit with user + station; optimistic-version enforcement with the
  409-review-retry UX; fast user switching.
- **Exit: each staff member logs in as themselves; audit shows who did what; assistant
  role verifiably cannot delete a doctor's entry.**

### Phase 3 — Clinic floor features (the payoff phase)
- Live schedule board: status changes (`waiting` → `in_chair` → done) push to all
  stations instantly; optional waiting-room overview screen (read-only kiosk role).
- "Downloaded copy" staleness toast on native file opens; per-station default views
  (front desk boots to schedule, operatory to patient search).
- Doctor Performance Analytics gains per-user filtering for free (data now has real
  user attribution).
- **Exit: front desk and two operatories run a full clinic day without anyone touching
  a shared mouse or shouting a room number down the hall.**

### Phase 4 — Operations hardening
- Scheduled backups + restore test UI; TLS with pinned self-signed CA; server status
  tray app; client auto-update from the server; version-handshake enforcement;
  monitoring page in Settings (connected stations, DB size, last backup, disk space).
- **Exit: the "dead disk" drill — restore the clinic onto a fresh machine from last
  night's backup in under 30 minutes, following a written runbook.**

### Phase 5 — Remote & niceties (optional, demand-driven)
- WireGuard/Tailscale documentation for home access; read-only "on-call mode".
- Per-station kiosk configurations; second-monitor patient-facing chart display.

### Phase 6 — Explicitly out of scope (revisit only if the product direction changes)
- Multi-site sync between clinic branches (this is where Postgres + real replication
  enters); cloud hosting; patient-facing portal; offline-first CRDT replicas (Option D);
  HL7/FHIR interop.

---

## 5. Invariants to protect while any of this is built

1. **Solo mode never degrades.** Single-chair practices on a laptop are the current
   user base; every phase must leave local-vault mode working without a server.
2. **One codebase, one UI.** Connected mode is a transport + auth layer, not a fork.
   If a feature needs different code per mode above the transport layer, the transport
   abstraction is wrong — fix the abstraction.
3. **The DB file format stays portable both directions** (solo ↔ server) until Phase 6
   forces otherwise. This is the migration story AND the exit story — a clinic can
   always take its data and walk.
4. **`db-core.ts` stays the single choke point.** No component ever gains a private
   `fetch()` to the server. All the leverage in this plan flows from that discipline.
5. **CLAUDE.md data-integrity rules apply server-side too** — the export-compatibility
   rule, entry_teeth sync, outcome denominators. Moving logic to the server is not an
   excuse to re-implement it loosely.
