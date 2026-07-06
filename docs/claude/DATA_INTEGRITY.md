# DATA_INTEGRITY.md — Dataset & Evaluation Mindset

**Read this before adding or changing ANY feature.** DentVault's entire long-term value is
statistical: failure rates, per-tooth diagnosis progression, outcome tracking across
prosthetics / ortho / restorative. Every feature is a *dataset feature first* and a UI
feature second. A feature that displays data but doesn't make it queryable is unfinished.

This file exists because a full audit (2026-07) found the same categories of mistakes
repeated across the codebase. Each rule below is followed by the real bug that motivated
it. Do not repeat these patterns.

---

## 1. The Dataset Mindset — apply to every new feature

Before writing code, answer these questions in order:

1. **What analytical question will this data answer in 5 years?**
   ("What is my crown failure rate on molars?" — if you can't phrase the question, the
   data model is not ready.)
2. **Is the fact stored structured?** Own column or table with typed keys — never only
   inside free text, a title, or a description. Free text is commentary; columns are data.
3. **Is it anchored?** Every clinical fact needs, where applicable: date, tooth (FDI),
   provider (`doctor_id`), and a causal link (`related_entry_id` for retreatment/failure
   chains).
4. **Is it queryable without string parsing?** If a query would need `LIKE` on a
   serialized string or JSON to filter it, add a junction table or structured column
   instead (see §3).
5. **Does it flow to the consumers?** New data must reach: the HTML export
   (`patient-export.ts` — mandatory rule in CLAUDE.md), and, if it's an outcome/category/
   per-tooth fact, the dashboard/reports queries.
6. **Can the user record it with near-zero friction?** Data that requires opening a
   buried dialog will not be recorded, and unrecorded data poisons every statistic.
   Prefer inline tagging (like `dNN` teeth or `#condition`) over extra form fields.

**Definition of done for a data-bearing feature:**
write path → DB → read path → UI display → export → (if clinical) statistics query.
Trace the whole loop. If any link is missing, the feature is not done.

---

## 2. Verify both ends of every pipeline (dead-path bugs)

**The bugs:** `recordChartHistory()` existed for months with **zero call sites** — the
tooth-history panel silently rendered an empty list forever. `getPatientSummary()` was
written and never consumed. Nothing errored; the data was simply never collected.

**Rules:**
- When you add a DB function, grep for its call site *in the same change*. A writer with
  no caller, or a reader whose table has no writer, is a bug — not future-proofing.
- When a UI panel shows "no data", ask whether the data *can exist* before assuming it
  just doesn't yet. An always-empty view looks identical to a broken pipeline.
- After wiring a snapshot/history mechanism, insert a record manually and confirm it
  appears in the consuming UI.

---

## 3. Never string-match structured data (format-drift bugs)

**The bug:** `tooth_numbers` is saved as `"14, 15"` (comma + space) but three queries
matched it with `LIKE '%,15%'`-style patterns assuming `"14,15"`. Every tooth except the
first in a multi-tooth entry was invisible to per-tooth queries — silent, no error,
statistics quietly wrong.

**Rules:**
- Filterable facts get **junction tables or typed columns**. For entry teeth that is
  `entry_teeth` (synced by `syncEntryTeeth`) — query it with `IN (SELECT entry_id FROM
  entry_teeth WHERE tooth_number IN (...))`, never `LIKE` on `tooth_numbers`.
- Serialized strings (`", "`-joined lists, JSON columns) are for *display and storage
  round-trips only*, never for `WHERE` clauses.
- If you must introduce a new serialized format, define it in ONE place, note the exact
  separator, and grep every consumer before changing it.

---

## 4. One canonical notation — FDI only for entry teeth

**The bug:** `entry_teeth` accepted both FDI (11–48, 51–85) and Universal (1–32).
Values 11–32 were ambiguous between the two systems — unanswerable per-tooth statistics.
Resolved in migration v66: **FDI only** (quadrant/tooth: 14 = quadrant 1, tooth 4).

**Rules:**
- `timeline_entries.tooth_numbers`, `entry_teeth`, keyword-engine output, and all user
  input paths are **FDI**. Validate with `isValidEntryTooth()` — never write your own
  range check.
- `dental_chart`, plan, and probing tables store Universal 1–32 **internally**;
  convert with `toFDI()` at the display boundary only. Never mix notations in one table.
- Never re-add Universal acceptance, conversion maps, or "legacy fallback" branches to
  entry-tooth paths. If input can't be parsed as valid FDI, drop it — don't guess.

---

## 5. Never gate UI on hardcoded keys of user-configurable sets

**The bug:** the entry form showed the treatment category/outcome fields only for
`entry_type === 'procedure' | 'visit' | 'referral'` — legacy built-ins. Entry types had
become user-configurable appointment-type *names*, so the fields never appeared for any
new entry. The outcome dataset was starved at the source for months.

**Rules:**
- If a set is user-configurable (entry types, appointment statuses, categories, tags,
  procedures…), **never** branch on specific member values. Derive behavior from the
  store (`entryTypes`, `appointmentStatuses`, …) or from an explicit flag on the config
  object — or don't gate at all.
- When converting a built-in enum to a user-configurable store, grep for **every string
  literal** of the old values across `src/` in the same change. Each leftover comparison
  is a dormant bug.
- Data-capture fields (outcome, category, teeth, provider) should be *always available*.
  Hiding them "when not relevant" costs dataset completeness; err on visible.

---

## 6. Enum values come from the type definition, nowhere else

**The bug:** a query counted plans with `status IN ('active','draft')` — statuses that
have never existed (`proposed/accepted/in_progress/completed/cancelled`). Always 0,
no error.

**Rules:**
- Before writing a string literal for a status/category/outcome in SQL or TS, open
  `src/lib/types.ts` and copy the values from the type. If the literal isn't in the type,
  it's wrong.
- Statistics `CASE WHEN status = '...'` buckets must cover the type exhaustively or have
  an explicit "other" bucket — silent non-matching rows skew percentages.

---

## 7. Define numerator AND denominator for every rate

**The bugs:** overall success rate included `ongoing` treatments in the denominator
(deflating it); the reports page divided successes by *all* entries including untagged
ones.

**Rules:**
- Success/failure rates use **final outcomes only**: `successful`, `retreated`,
  `failed_extracted`, `failed_other`. Exclude `''`, `unknown`, `ongoing` from the
  denominator.
- **Planned ≠ done**: anything with a `_planned` suffix or plan-item status `pending/
  scheduled` never counts toward performed-treatment or DMFT-style scores. (Bug:
  `inlay_planned` counted as "F" in DMFT.)
- When adding any new rate/score, write a comment at the query stating what the
  denominator is and why. If two screens show "success rate", they must use the same
  definition — extract it, don't re-derive it.

---

## 8. Duplicated derived calculations WILL drift

**The bug:** DMFT was computed independently in `DentalChartView.svelte` and
`patient-export.ts`. A fix applied to one had to be manually mirrored in the other.

**Rules:**
- Derived clinical scores (DMFT, PAR stats, success rates…) live in **one** shared
  function (`src/lib/utils/` or a service), imported by every consumer including the
  export.
- If you find an existing duplicate while working nearby, consolidate it or fix both and
  flag the duplication — never fix just the copy in front of you.

---

## 9. Dates: local clock, always

**The bug:** `date('now')` in SQLite is UTC; entries written near midnight fell out of
"this month" counts.

**Rules:**
- SQLite: always `date('now', 'localtime')` / `datetime('now', 'localtime')` when
  comparing against locally-written dates (`entry_date`, `start_time`).
- TS: `toLocalISODate()` — never `toISOString().slice(0, 10)`.
- `entry_date` and other clinical dates are naive local `YYYY-MM-DD` strings. Do not
  introduce UTC timestamps into comparisons with them.

---

## 10. Migration hygiene

**Rules:**
- Append-only: never modify an existing `SCHEMA_STATEMENTS` entry. New version = new
  entries + bump `LATEST_VERSION` + update CLAUDE.md (it states the current version in
  two places).
- A schema change that reinterprets existing data needs a **data migration** in the same
  version (SQL statement, or a TS function hooked into `runMigrations` like
  `migrateUniversalTeethToFDI`), and dedup/cleanup of any derived rows (e.g. deleting a
  snapshot must delete its `dental_chart_history` rows via
  `deleteChartHistoryForSnapshot`).
- Migrations must be idempotent-safe (`IF NOT EXISTS`, `OR IGNORE`, tolerated duplicate
  column errors) — they re-run against half-migrated DBs.

---

## 11. English only — no exceptions

**The bugs:** German survived deletion of `de.ts` in scattered places: tooth names,
plan-procedure defaults, a dashboard label, dialog fallbacks, comments.

**Rules:**
- All UI strings via `i18n.t.*` (key in `types.ts` first, then `en.ts`). No hardcoded
  UI strings — including *fallbacks* after `??` and default labels in stores.
- Comments, placeholders, example names: English.
- German statutory keys that are domain identifiers (PAR step types `AIT/BEV/UPT`,
  `kasse/privat`) are data keys, not UI text — they stay, but their *labels* are English.
- Never recreate `de.ts` or add language switching.

---

## 12. Pre-merge checklist (run every time)

- [ ] New data-bearing feature: full loop traced — write → DB → read → UI → export → stats?
- [ ] Every new DB function has a caller; every new table has both a writer and a reader?
- [ ] No `LIKE`/string parsing in `WHERE` clauses on serialized fields?
- [ ] Teeth: FDI on entry paths (`isValidEntryTooth`), Universal only inside chart tables, `toFDI()` at display?
- [ ] `syncEntryTeeth()` called after any `timeline_entries.tooth_numbers` write?
- [ ] No branching on hardcoded members of user-configurable sets?
- [ ] Status/outcome literals verified against `types.ts`?
- [ ] Rates: denominator defined, final outcomes only, no `_planned` values counted as done?
- [ ] Derived scores computed in one shared place?
- [ ] Dates: `'localtime'` in SQL, `toLocalISODate()` in TS?
- [ ] Migration appended (not edited), `LATEST_VERSION` + CLAUDE.md bumped, data migration included if semantics changed?
- [ ] All strings English, via i18n keys (fallbacks included)?
- [ ] Export updated per CLAUDE.md's mandatory compatibility rule?
- [ ] `npm run check` — 0 errors?
