# DB Schema Reference

All migrations in `SCHEMA_STATEMENTS` array in `src/lib/services/db.ts`. **NEVER modify existing migrations — always append.** `LATEST_VERSION = 36`.

## Schema Versions

### Core Tables (v1–v22)

`patients`, `timeline_entries` (with `treatment_category`, `treatment_outcome`, `related_entry_id`, `tooth_numbers`, `doctor_id`, `colleague_ids`), `treatment_plans`, `treatment_plan_items` (with `timeline_entry_id`), `documents`, `dental_chart`, `settings`, `doctors`, `ortho_classifications`

### Analytics Infrastructure (v23–v30)

| Version | Table / Column | Purpose |
|---|---|---|
| v23 | `entry_teeth` | Junction table normalizing tooth numbers per entry. `syncEntryTeeth(entryId, toothNumbers)` keeps it in sync. `migrateEntryTeeth()` backfills. |
| v24 | `treatment_plan_items.timeline_entry_id` | Links a completed plan item to the timeline entry it produced. |
| v25 | `complications` | Structured per-entry complication tracking (type, severity, description, resolved_at). User-configurable via `complicationTypes` store. |
| v26 | `dental_chart_history` | Snapshot of all tooth conditions at a specific timeline entry. |
| v27 | `probing_records` + `probing_measurements` | Periodontal probing: one record per session, 6 site measurements per tooth (MB/B/DB + ML/L/DL). PD (mm) + BOP (boolean). |
| v28 | `patients.referral_source`, `.smoking_status`, `.occupation` | Extended patient demographics. |
| v29 | `patient_conditions` | Dated special conditions with start_date, end_date, is_active, notes. |
| v30 | `probing_measurements.recession` + `.plaque`, `probing_tooth_data` | Perio overhaul: recession (for CAL = PD + recession), plaque; tooth-level mobility (0–III), furcation (0–III) + sites, notes. |

### Extended Patient & Scheduling (v31–v36)

| Version | Table / Column | Purpose |
|---|---|---|
| v31 | 10 new patient columns | `address`, `city`, `postal_code`, `country`, `emergency_contact_name/phone/relation`, `blood_group`, `primary_physician`, `marital_status`. `PatientStatus` includes `'deceased'`. |
| v32 | `appointment_rooms` + `appointments` | Scheduling: rooms (name, short_name, color, sort_order), appointments (patient_id, room_id, doctor_id, start_time, duration_min, status, notes). |
| v33 | `schedule_blocks` | Non-patient time blocks per room: title, doctor_id, start_time/end_time, color, notes. |
| v34 | `staff_blockouts` | Doctor absence/vacation: doctor_id, date range, is_all_day, reason, color. |
| v35 | `doctor_working_hours` | Per-doctor, per-day hours: day_of_week (0–6), start_time, end_time, break_start/end, is_active. |
| v36 | `appointments.cancelled_at`, `.no_show_recorded_at` | Timestamp columns for cancellation and no-show tracking. |

---

## Key DB Functions

### Analytics Aggregates
- `getCategoryStats(filters?)` / `getOutcomeStats(filters?)` / `getOverallSuccessRate(filters?)` — dashboard aggregates
- `getProviderOutcomeStats(filters?)` — per-doctor outcome breakdown
- `getDrillDownEntries(category, outcome, filters?)` — entries for a clicked dashboard cell
- `getFilteredEntries(filters: ReportFilters)` / `getFilteredSummary(filters)` — reports page
- `getPriorProceduresForTooth(patientId, toothNumber)` — find earlier entries on same tooth

### Clinical Data
- `getComplications(entryId)` / `insertComplication()` / `resolveComplication()` / `deleteComplication()`
- `recordChartHistory(patientId, entryId)` / `getToothHistory(patientId, tooth)`
- `insertProbingRecord()` / `getProbingRecords()` / `upsertProbingMeasurement()` / `getProbingMeasurements()` / `upsertProbingToothData()` / `getProbingToothData()`
- `getPatientConditions()` / `insertPatientCondition()` / `updatePatientCondition()` / `deactivatePatientCondition()`

### Dashboard / Period Stats
- `getActivityStats(from, to)` / `getDoctorActivityStats(from, to)` — patients served, new patients, entries, per-doctor volume
- `getAppointmentPeriodStats(from, to)` — totals + completed/cancelled/no_show + avg duration
- `getAppointmentHeatmap(from, to)` — count by `day_of_week` (0=Sun…6=Sat) and `hour` (0–23), excluding cancelled
- `getPatientDemographics()` — avg age, age buckets (0–17/18–35/36–50/51–64/65+), gender, referral source (top 8)

### Settings
- `getAllSettings()` / `bulkSetSettings(entries)` — export/import all settings rows

---

## Filter Types (`src/lib/types.ts`)

- `AnalyticsFilters` — `{ dateFrom?, dateTo?, doctorId? }` — used by dashboard
- `ReportFilters` — `{ dateFrom?, dateTo?, categories?, outcomes?, doctorId?, toothNumbers? }` — used by reports page
- `ReportEntry` — flat row returned by `getFilteredEntries` for table/CSV display
