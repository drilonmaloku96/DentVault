import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { appendAuditRecord } from '$lib/services/audit';
import type {
	Patient,
	PatientFormData,
	TimelineEntry,
	TimelineFormData,
	TreatmentPlan,
	TreatmentPlanFormData,
	TreatmentPlanItem,
	TreatmentPlanItemFormData,
	TreatmentPlanStatus,
	TreatmentPlanItemStatus,
	OrthoClassification,
	PatientClassification,
	ToothChartEntry,
	ToothChartFormData,
	ClinicalExam,
	ClinicalExamFormData,
	PatientDocument,
	PatientDocumentFormData,
	PatientStatusCounts,
	CategoryStat,
	OutcomeStat,
	SuccessRateStat,
	RecentEntry,
	PatientNoteEntry,
	MedicalEntry,
	MedicalEntryType,
	AcuteProblem,
	Doctor,
	DoctorFormData,
	AuditEntityType,
	Complication,
	PatientCondition,
	DentalChartHistoryEntry,
	ProbingRecord,
	ProbingMeasurement,
	ProbingToothData,
	AnalyticsFilters,
	ReportFilters,
	ReportEntry,
	AppointmentRoom,
	AppointmentRoomFormData,
	AppointmentType,
	AppointmentTypeFormData,
	Appointment,
	AppointmentFormData,
	AppointmentStatus,
	ScheduleBlock,
	ScheduleBlockFormData,
	StaffBlockout,
	StaffBlockoutFormData,
	DoctorWorkingHours,
	DoctorWorkingHoursFormData,
	AbsenceStat,
	AppointmentDoctorStat,
	KigFinding,
	KigGroupCode,
	OrthoAssessment,
	OrthoKigEntry,
} from '$lib/types';

// ── Schema / Migrations ────────────────────────────────────────────────

/**
 * All DDL statements in order. Each entry is one SQL statement.
 * The schema_version table tracks which version we're at.
 * "IF NOT EXISTS" and "IF NOT EXISTS" guards make re-runs safe.
 */
const SCHEMA_STATEMENTS: { version: number; sql: string }[] = [
	// ── v1: Patients ──────────────────────────────────
	{
		version: 1,
		sql: `CREATE TABLE IF NOT EXISTS patients (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT UNIQUE NOT NULL,
			firstname TEXT NOT NULL,
			lastname TEXT NOT NULL,
			dob TEXT DEFAULT '',
			gender TEXT DEFAULT '',
			phone TEXT DEFAULT '',
			email TEXT DEFAULT '',
			insurance_provider TEXT DEFAULT '',
			insurance_id TEXT DEFAULT '',
			allergies TEXT DEFAULT '[]',
			medications TEXT DEFAULT '[]',
			risk_flags TEXT DEFAULT '[]',
			status TEXT DEFAULT 'active',
			next_appointment TEXT DEFAULT '',
			notes TEXT DEFAULT '',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
	},
	// ── v2: Timeline entries ──────────────────────────
	{
		version: 2,
		sql: `CREATE TABLE IF NOT EXISTS timeline_entries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT NOT NULL,
			entry_date TEXT NOT NULL,
			entry_type TEXT NOT NULL,
			title TEXT NOT NULL,
			provider TEXT DEFAULT '',
			tooth_numbers TEXT DEFAULT '',
			description TEXT DEFAULT '',
			diagnosis_codes TEXT DEFAULT '[]',
			cpt_codes TEXT DEFAULT '[]',
			attachments TEXT DEFAULT '[]',
			treatment_category TEXT DEFAULT '',
			treatment_outcome TEXT DEFAULT '',
			related_entry_id INTEGER,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
		)`,
	},
	// ── v3: Treatment plans ───────────────────────────
	{
		version: 3,
		sql: `CREATE TABLE IF NOT EXISTS treatment_plans (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			plan_id TEXT UNIQUE NOT NULL,
			patient_id TEXT NOT NULL,
			title TEXT NOT NULL,
			description TEXT DEFAULT '',
			status TEXT DEFAULT 'proposed',
			total_estimated_cost REAL DEFAULT 0,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
		)`,
	},
	{
		version: 3,
		sql: `CREATE TABLE IF NOT EXISTS treatment_plan_items (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			plan_id TEXT NOT NULL,
			sequence_order INTEGER NOT NULL,
			procedure_code TEXT DEFAULT '',
			description TEXT NOT NULL,
			tooth_numbers TEXT DEFAULT '',
			estimated_cost REAL DEFAULT 0,
			status TEXT DEFAULT 'pending',
			completed_date TEXT DEFAULT '',
			notes TEXT DEFAULT '',
			treatment_category TEXT DEFAULT '',
			FOREIGN KEY (plan_id) REFERENCES treatment_plans(plan_id) ON DELETE CASCADE
		)`,
	},
	// ── v4: Clinical classifications ──────────────────
	{
		version: 4,
		sql: `CREATE TABLE IF NOT EXISTS ortho_classifications (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT NOT NULL UNIQUE,
			pre_angle_class TEXT DEFAULT '',
			post_angle_class TEXT DEFAULT '',
			pre_molar_relationship TEXT DEFAULT '',
			post_molar_relationship TEXT DEFAULT '',
			pre_overjet_mm REAL DEFAULT 0,
			post_overjet_mm REAL DEFAULT 0,
			pre_overbite_mm REAL DEFAULT 0,
			post_overbite_mm REAL DEFAULT 0,
			pre_crowding TEXT DEFAULT '',
			post_crowding TEXT DEFAULT '',
			pre_crossbite TEXT DEFAULT '',
			post_crossbite TEXT DEFAULT '',
			pre_open_bite TEXT DEFAULT '',
			post_open_bite TEXT DEFAULT '',
			pre_midline_deviation_mm REAL DEFAULT 0,
			post_midline_deviation_mm REAL DEFAULT 0,
			treatment_type TEXT DEFAULT '',
			extraction_pattern TEXT DEFAULT '',
			treatment_start_date TEXT DEFAULT '',
			treatment_end_date TEXT DEFAULT '',
			notes TEXT DEFAULT '',
			updated_at TEXT NOT NULL,
			FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
		)`,
	},
	{
		version: 4,
		sql: `CREATE TABLE IF NOT EXISTS patient_classifications (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT NOT NULL UNIQUE,
			perio_status TEXT DEFAULT '',
			caries_risk TEXT DEFAULT '',
			perio_risk TEXT DEFAULT '',
			special_conditions TEXT DEFAULT '[]',
			notes TEXT DEFAULT '',
			updated_at TEXT NOT NULL,
			FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
		)`,
	},
	// ── v5: Dental chart ──────────────────────────────
	{
		version: 5,
		sql: `CREATE TABLE IF NOT EXISTS dental_chart (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT NOT NULL,
			tooth_number INTEGER NOT NULL,
			condition TEXT DEFAULT 'healthy',
			surfaces TEXT DEFAULT '{}',
			notes TEXT DEFAULT '',
			last_examined TEXT DEFAULT '',
			updated_at TEXT NOT NULL,
			UNIQUE(patient_id, tooth_number),
			FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
		)`,
	},
	{
		version: 5,
		sql: `CREATE TABLE IF NOT EXISTS clinical_exams (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT NOT NULL,
			exam_date TEXT NOT NULL,
			exam_type TEXT DEFAULT 'full',
			examiner TEXT DEFAULT '',
			chief_complaint TEXT DEFAULT '',
			findings TEXT DEFAULT '',
			probing_data TEXT DEFAULT '{}',
			notes TEXT DEFAULT '',
			created_at TEXT NOT NULL,
			FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
		)`,
	},
	// ── v6: Documents ─────────────────────────────────
	{
		version: 6,
		sql: `CREATE TABLE IF NOT EXISTS documents (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT NOT NULL,
			filename TEXT NOT NULL,
			original_name TEXT NOT NULL,
			category TEXT DEFAULT 'other',
			mime_type TEXT DEFAULT '',
			file_size INTEGER DEFAULT 0,
			abs_path TEXT NOT NULL,
			notes TEXT DEFAULT '',
			created_at TEXT NOT NULL,
			FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
		)`,
	},
	// ── v7: document_id on timeline_entries ───────────
	{
		version: 7,
		sql: `ALTER TABLE timeline_entries ADD COLUMN document_id INTEGER`,
	},
	// ── v8: App-level key/value settings ──────────────
	{
		version: 8,
		sql: `CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)`,
	},
	// ── v9: Patient notes, medical entries, acute problems, timeline extra cols ──
	{
		version: 9,
		sql: `CREATE TABLE IF NOT EXISTS patient_note_entries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT NOT NULL,
			content TEXT NOT NULL,
			created_at TEXT NOT NULL,
			FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
		)`,
	},
	{
		version: 9,
		sql: `CREATE TABLE IF NOT EXISTS medical_entries (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT NOT NULL,
			content TEXT NOT NULL,
			entry_type TEXT NOT NULL DEFAULT 'note',
			created_at TEXT NOT NULL,
			FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
		)`,
	},
	{
		version: 9,
		sql: `CREATE TABLE IF NOT EXISTS acute_problems (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT NOT NULL,
			content TEXT NOT NULL,
			resolved INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL,
			FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE
		)`,
	},
	{
		version: 9,
		sql: `ALTER TABLE timeline_entries ADD COLUMN plan_id TEXT DEFAULT ''`,
	},
	{
		version: 9,
		sql: `ALTER TABLE timeline_entries ADD COLUMN chart_data TEXT DEFAULT ''`,
	},
	{
		version: 9,
		sql: `ALTER TABLE timeline_entries ADD COLUMN is_locked INTEGER DEFAULT 0`,
	},
	// ── v10: Doctors table + doctor_id on timeline entries ──
	{
		version: 10,
		sql: `CREATE TABLE IF NOT EXISTS doctors (
			id        INTEGER PRIMARY KEY AUTOINCREMENT,
			name      TEXT NOT NULL,
			specialty TEXT DEFAULT '',
			color     TEXT DEFAULT '#6366f1',
			created_at TEXT NOT NULL
		)`,
	},
	{
		version: 10,
		sql: `ALTER TABLE timeline_entries ADD COLUMN doctor_id INTEGER DEFAULT NULL`,
	},
	// ── v11: Patient miscellaneous (scratch-pad) notes ──
	{
		version: 11,
		sql: `CREATE TABLE IF NOT EXISTS patient_misc_notes (
			patient_id TEXT PRIMARY KEY,
			content    TEXT DEFAULT '',
			updated_at TEXT NOT NULL
		)`,
	},
	// ── v12: Staff roles — add role column to doctors ──
	{
		version: 12,
		sql: `ALTER TABLE doctors ADD COLUMN role TEXT DEFAULT 'doctor'`,
	},
	// ── v13: Portable paths — add rel_path to documents ──
	{
		version: 13,
		sql: `ALTER TABLE documents ADD COLUMN rel_path TEXT DEFAULT ''`,
	},
	// ── v14: Bridge support on dental chart ──
	{
		version: 14,
		sql: `ALTER TABLE dental_chart ADD COLUMN bridge_group_id TEXT DEFAULT NULL`,
	},
	{
		version: 14,
		sql: `ALTER TABLE dental_chart ADD COLUMN bridge_role TEXT DEFAULT NULL`,
	},
	// ── v15: Abutment type (tooth vs implant) ──
	{
		version: 15,
		sql: `ALTER TABLE dental_chart ADD COLUMN abutment_type TEXT DEFAULT NULL`,
	},
	// ── v16: Prosthesis type ──
	{
		version: 16,
		sql: `ALTER TABLE dental_chart ADD COLUMN prosthesis_type TEXT DEFAULT NULL`,
	},
	// ── v17: Acute problems text (scratch-pad) ──
	{
		version: 17,
		sql: `CREATE TABLE IF NOT EXISTS patient_acute_text (
			patient_id TEXT PRIMARY KEY,
			content    TEXT DEFAULT '',
			updated_at TEXT NOT NULL
		)`,
	},
	// ── v18: Medical history text (scratch-pad) ──
	{
		version: 18,
		sql: `CREATE TABLE IF NOT EXISTS patient_medical_text (
			patient_id TEXT PRIMARY KEY,
			content    TEXT DEFAULT '',
			updated_at TEXT NOT NULL
		)`,
	},
	// ── v19: Acute problem tags (for statistical queries) ──
	{
		version: 19,
		sql: `CREATE TABLE IF NOT EXISTS patient_acute_tags (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT NOT NULL,
			tag        TEXT NOT NULL
		)`,
	},
	// ── v20: Medical history tags (for statistical queries) ──
	{
		version: 20,
		sql: `CREATE TABLE IF NOT EXISTS patient_medical_tags (
			id         INTEGER PRIMARY KEY AUTOINCREMENT,
			patient_id TEXT NOT NULL,
			tag        TEXT NOT NULL
		)`,
	},
	// ── v21: Doc bar visibility flag on doctors ──
	{
		version: 21,
		sql: `ALTER TABLE doctors ADD COLUMN show_in_doc_bar INTEGER DEFAULT 1`,
	},
	// ── v22: Colleague IDs on timeline entries ──
	{
		version: 22,
		sql: `ALTER TABLE timeline_entries ADD COLUMN colleague_ids TEXT DEFAULT ''`,
	},
	// ── v23: Entry-teeth junction table ──
	{
		version: 23,
		sql: `CREATE TABLE IF NOT EXISTS entry_teeth (entry_id INTEGER NOT NULL, tooth_number INTEGER NOT NULL, PRIMARY KEY (entry_id, tooth_number), FOREIGN KEY (entry_id) REFERENCES timeline_entries(id) ON DELETE CASCADE)`,
	},
	// ── v24: Treatment plan item → timeline entry link ──
	{
		version: 24,
		sql: `ALTER TABLE treatment_plan_items ADD COLUMN timeline_entry_id INTEGER REFERENCES timeline_entries(id) ON DELETE SET NULL`,
	},
	// ── v25: Complications table ──
	{
		version: 25,
		sql: `CREATE TABLE IF NOT EXISTS complications (id INTEGER PRIMARY KEY AUTOINCREMENT, timeline_entry_id INTEGER NOT NULL, patient_id TEXT NOT NULL, complication_type TEXT NOT NULL, description TEXT DEFAULT '', severity TEXT DEFAULT 'mild', date_reported TEXT NOT NULL, date_resolved TEXT DEFAULT '', resolved INTEGER DEFAULT 0, created_at TEXT NOT NULL, FOREIGN KEY (timeline_entry_id) REFERENCES timeline_entries(id) ON DELETE CASCADE)`,
	},
	// ── v26: Dental chart history ──
	{
		version: 26,
		sql: `CREATE TABLE IF NOT EXISTS dental_chart_history (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT NOT NULL, tooth_number INTEGER NOT NULL, condition TEXT NOT NULL, surfaces TEXT DEFAULT '{}', snapshot_entry_id INTEGER, recorded_at TEXT NOT NULL, FOREIGN KEY (snapshot_entry_id) REFERENCES timeline_entries(id) ON DELETE SET NULL)`,
	},
	{
		version: 26,
		sql: `CREATE INDEX IF NOT EXISTS idx_chart_history_patient_tooth ON dental_chart_history(patient_id, tooth_number)`,
	},
	// ── v27: Probing records ──
	{
		version: 27,
		sql: `CREATE TABLE IF NOT EXISTS probing_records (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT NOT NULL, exam_date TEXT NOT NULL, examiner TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT NOT NULL, FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE)`,
	},
	{
		version: 27,
		sql: `CREATE TABLE IF NOT EXISTS probing_measurements (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, tooth_number INTEGER NOT NULL, site TEXT NOT NULL, pocket_depth INTEGER, bleeding_on_probing INTEGER DEFAULT 0, FOREIGN KEY (record_id) REFERENCES probing_records(id) ON DELETE CASCADE, UNIQUE(record_id, tooth_number, site))`,
	},
	// ── v28: Patient demographics additions ──
	{
		version: 28,
		sql: `ALTER TABLE patients ADD COLUMN referral_source TEXT DEFAULT ''`,
	},
	{
		version: 28,
		sql: `ALTER TABLE patients ADD COLUMN smoking_status TEXT DEFAULT ''`,
	},
	{
		version: 28,
		sql: `ALTER TABLE patients ADD COLUMN occupation TEXT DEFAULT ''`,
	},
	// ── v29: Patient conditions with dates ──
	{
		version: 29,
		sql: `CREATE TABLE IF NOT EXISTS patient_conditions (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT NOT NULL, condition_key TEXT NOT NULL, start_date TEXT DEFAULT '', end_date TEXT DEFAULT '', is_active INTEGER DEFAULT 1, notes TEXT DEFAULT '', created_at TEXT NOT NULL)`,
	},
	{
		version: 29,
		sql: `CREATE INDEX IF NOT EXISTS idx_patient_conditions_patient ON patient_conditions(patient_id, is_active)`,
	},
	// ── v30: Perio chart enhancements — recession, furcation, mobility ──
	{
		version: 30,
		sql: `ALTER TABLE probing_measurements ADD COLUMN recession INTEGER DEFAULT NULL`,
	},
	{
		version: 30,
		sql: `ALTER TABLE probing_measurements ADD COLUMN plaque INTEGER DEFAULT 0`,
	},
	{
		version: 30,
		sql: `CREATE TABLE IF NOT EXISTS probing_tooth_data (id INTEGER PRIMARY KEY AUTOINCREMENT, record_id INTEGER NOT NULL, tooth_number INTEGER NOT NULL, mobility INTEGER DEFAULT NULL, furcation INTEGER DEFAULT NULL, furcation_sites TEXT DEFAULT '', notes TEXT DEFAULT '', FOREIGN KEY (record_id) REFERENCES probing_records(id) ON DELETE CASCADE, UNIQUE(record_id, tooth_number))`,
	},
	{
		version: 30,
		sql: `CREATE INDEX IF NOT EXISTS idx_probing_tooth_data_record ON probing_tooth_data(record_id, tooth_number)`,
	},
	// v31 – expanded patient fields
	{ version: 31, sql: `ALTER TABLE patients ADD COLUMN address TEXT DEFAULT ''` },
	{ version: 31, sql: `ALTER TABLE patients ADD COLUMN city TEXT DEFAULT ''` },
	{ version: 31, sql: `ALTER TABLE patients ADD COLUMN postal_code TEXT DEFAULT ''` },
	{ version: 31, sql: `ALTER TABLE patients ADD COLUMN country TEXT DEFAULT ''` },
	{ version: 31, sql: `ALTER TABLE patients ADD COLUMN emergency_contact_name TEXT DEFAULT ''` },
	{ version: 31, sql: `ALTER TABLE patients ADD COLUMN emergency_contact_phone TEXT DEFAULT ''` },
	{ version: 31, sql: `ALTER TABLE patients ADD COLUMN emergency_contact_relation TEXT DEFAULT ''` },
	{ version: 31, sql: `ALTER TABLE patients ADD COLUMN blood_group TEXT DEFAULT ''` },
	{ version: 31, sql: `ALTER TABLE patients ADD COLUMN primary_physician TEXT DEFAULT ''` },
	{ version: 31, sql: `ALTER TABLE patients ADD COLUMN marital_status TEXT DEFAULT ''` },
	// v32 – appointment scheduling
	{
		version: 32,
		sql: `CREATE TABLE IF NOT EXISTS appointment_rooms (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			short_name TEXT NOT NULL DEFAULT '',
			color TEXT NOT NULL DEFAULT '#6366f1',
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
	},
	{
		version: 32,
		sql: `CREATE TABLE IF NOT EXISTS appointment_types (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL,
			short_name TEXT NOT NULL DEFAULT '',
			default_duration_min INTEGER NOT NULL DEFAULT 30,
			color TEXT NOT NULL DEFAULT '#6366f1',
			treatment_category TEXT NOT NULL DEFAULT 'other',
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
	},
	{
		version: 32,
		sql: `CREATE TABLE IF NOT EXISTS appointments (
			id TEXT PRIMARY KEY,
			patient_id TEXT NOT NULL REFERENCES patients(patient_id) ON DELETE CASCADE,
			doctor_id TEXT REFERENCES doctors(id) ON DELETE SET NULL,
			room_id TEXT NOT NULL REFERENCES appointment_rooms(id) ON DELETE RESTRICT,
			type_id TEXT REFERENCES appointment_types(id) ON DELETE SET NULL,
			start_time TEXT NOT NULL,
			end_time TEXT NOT NULL,
			duration_min INTEGER NOT NULL DEFAULT 30,
			title TEXT,
			notes TEXT,
			status TEXT NOT NULL DEFAULT 'scheduled',
			timeline_entry_id TEXT REFERENCES timeline_entries(id) ON DELETE SET NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			updated_at TEXT NOT NULL DEFAULT (datetime('now'))
		)`,
	},
	{
		version: 32,
		sql: `CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time)`,
	},
	{
		version: 32,
		sql: `CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id)`,
	},
	{
		version: 32,
		sql: `CREATE INDEX IF NOT EXISTS idx_appointments_room_start ON appointments(room_id, start_time)`,
	},
	{
		version: 33,
		sql: `CREATE TABLE IF NOT EXISTS schedule_blocks (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES appointment_rooms(id) ON DELETE CASCADE,
    doctor_id TEXT REFERENCES doctors(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#94a3b8',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_schedule_blocks_start ON schedule_blocks(start_time);`,
	},
	{
		version: 34,
		sql: `CREATE TABLE IF NOT EXISTS staff_blockouts (
    id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    start_time TEXT,
    end_time TEXT,
    is_all_day INTEGER NOT NULL DEFAULT 1,
    reason TEXT NOT NULL DEFAULT 'other',
    notes TEXT,
    color TEXT NOT NULL DEFAULT '#f59e0b',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_staff_blockouts_date ON staff_blockouts(start_date, end_date);`,
	},
	{
		version: 35,
		sql: `CREATE TABLE IF NOT EXISTS doctor_working_hours (
    id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL REFERENCES doctors(id) ON DELETE CASCADE,
    day_of_week INTEGER NOT NULL,
    start_time TEXT NOT NULL DEFAULT '08:00',
    end_time TEXT NOT NULL DEFAULT '18:00',
    break_start TEXT,
    break_end TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(doctor_id, day_of_week)
  )`,
	},
	{
		version: 36,
		sql: `ALTER TABLE appointments ADD COLUMN cancelled_at TEXT`,
	},
	{
		version: 36,
		sql: `ALTER TABLE appointments ADD COLUMN no_show_recorded_at TEXT`,
	},
	// v37: Extended ortho fields + KIG support
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN exam_date TEXT DEFAULT ''` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN pre_canine_class TEXT DEFAULT ''` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN post_canine_class TEXT DEFAULT ''` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN pre_crowding_upper_mm REAL DEFAULT 0` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN post_crowding_upper_mm REAL DEFAULT 0` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN pre_crowding_lower_mm REAL DEFAULT 0` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN post_crowding_lower_mm REAL DEFAULT 0` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN facial_profile TEXT DEFAULT ''` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN lip_competence TEXT DEFAULT ''` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN nasal_breathing TEXT DEFAULT ''` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN oral_habits TEXT DEFAULT '[]'` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN cvm_stage INTEGER DEFAULT 0` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN growth_potential TEXT DEFAULT ''` },
	{ version: 37, sql: `ALTER TABLE ortho_classifications ADD COLUMN retention_protocol TEXT DEFAULT ''` },
	// v38: KIG findings table
	{
		version: 38,
		sql: `CREATE TABLE IF NOT EXISTS kig_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    kig_group TEXT NOT NULL,
    kig_level INTEGER NOT NULL DEFAULT 1,
    measured_value REAL,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(patient_id, kig_group)
  );
  CREATE INDEX IF NOT EXISTS idx_kig_findings_patient ON kig_findings(patient_id);`,
	},
	// v39: KIG assessment snapshots (snapshot-based like dental chart)
	{
		version: 39,
		sql: `CREATE TABLE IF NOT EXISTS ortho_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    exam_date TEXT NOT NULL,
    doctor_id INTEGER,
    findings TEXT NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (patient_id) REFERENCES patients(id),
    FOREIGN KEY (doctor_id) REFERENCES doctors(id)
  );
  CREATE INDEX IF NOT EXISTS idx_ortho_assessments_patient ON ortho_assessments(patient_id);`,
	},
	// v40: Optional clinical context fields on ortho_assessments
	{ version: 40, sql: `ALTER TABLE ortho_assessments ADD COLUMN dentition_stage TEXT NOT NULL DEFAULT ''` },
	{ version: 40, sql: `ALTER TABLE ortho_assessments ADD COLUMN treatment_phase TEXT NOT NULL DEFAULT ''` },
	{ version: 40, sql: `ALTER TABLE ortho_assessments ADD COLUMN angle_class TEXT NOT NULL DEFAULT ''` },
	{ version: 40, sql: `ALTER TABLE ortho_assessments ADD COLUMN cvm_stage INTEGER NOT NULL DEFAULT 0` },
	{ version: 40, sql: `ALTER TABLE ortho_assessments ADD COLUMN facial_profile TEXT NOT NULL DEFAULT ''` },
	{ version: 40, sql: `ALTER TABLE ortho_assessments ADD COLUMN treatment_recommendation TEXT NOT NULL DEFAULT ''` },
	// v41: Fix ortho_assessments FK — was REFERENCES patients(id) (integer PK), must be patients(patient_id) (text)
	{
		version: 41,
		sql: `ALTER TABLE ortho_assessments RENAME TO ortho_assessments_old`,
	},
	{
		version: 41,
		sql: `CREATE TABLE ortho_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL,
  exam_date TEXT NOT NULL,
  doctor_id INTEGER,
  findings TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  dentition_stage TEXT NOT NULL DEFAULT '',
  treatment_phase TEXT NOT NULL DEFAULT '',
  angle_class TEXT NOT NULL DEFAULT '',
  cvm_stage INTEGER NOT NULL DEFAULT 0,
  facial_profile TEXT NOT NULL DEFAULT '',
  treatment_recommendation TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON DELETE CASCADE,
  FOREIGN KEY (doctor_id) REFERENCES doctors(id)
)`,
	},
	{
		version: 41,
		sql: `INSERT INTO ortho_assessments SELECT * FROM ortho_assessments_old`,
	},
	{
		version: 41,
		sql: `DROP TABLE ortho_assessments_old`,
	},
	{
		version: 41,
		sql: `CREATE INDEX IF NOT EXISTS idx_ortho_assessments_patient ON ortho_assessments(patient_id)`,
	},
];

const LATEST_VERSION = 41;

async function runMigrations(conn: Database): Promise<void> {
	// Create the version tracking table
	await conn.execute(
		`CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY)`,
		[],
	);

	// Check if we're working on an already-migrated DB (from old Rust migration system)
	const versionRows = await conn.select<{ version: number }[]>(
		`SELECT COALESCE(MAX(version), 0) AS version FROM _schema_version`,
		[],
	);
	let current = versionRows[0]?.version ?? 0;

	if (current === 0) {
		// Check if tables already exist (DB created by old Rust migration system)
		const tableRows = await conn.select<{ name: string }[]>(
			`SELECT name FROM sqlite_master WHERE type='table' AND name='patients'`,
			[],
		);
		if (tableRows.length > 0) {
			// Existing DB — mark all migrations as applied and return
			await conn.execute(
				`INSERT OR REPLACE INTO _schema_version (version) VALUES ($1)`,
				[LATEST_VERSION],
			);
			return;
		}
	}

	// Apply any missing DDL statements
	const versionsApplied = new Set<number>();
	for (const stmt of SCHEMA_STATEMENTS) {
		if (stmt.version > current) {
			try {
				await conn.execute(stmt.sql, []);
			} catch (e) {
				// ALTER TABLE ADD COLUMN throws "duplicate column name" if column already exists — safe to ignore
				const msg = String(e).toLowerCase();
				if (!msg.includes('duplicate column') && !msg.includes('already exists')) throw e;
			}
			versionsApplied.add(stmt.version);
		}
	}

	// Bump schema version to the highest applied
	if (versionsApplied.size > 0) {
		const maxApplied = Math.max(...versionsApplied);
		await conn.execute(
			`INSERT OR REPLACE INTO _schema_version (version) VALUES ($1)`,
			[maxApplied],
		);
	}

	// ── v13 data migration: convert abs_path → rel_path ──
	// Runs if rel_path column exists but hasn't been populated yet
	if (versionsApplied.has(13) || current < 13) {
		await migrateAbsToRelPaths(conn);
	}

	// ── v23 data migration: backfill entry_teeth from existing tooth_numbers ──
	if (versionsApplied.has(23) || current < 23) {
		await migrateEntryTeeth(conn);
	}
}

/**
 * One-time data migration: populate rel_path from abs_path on documents
 * and convert timeline_entries.attachments paths from absolute to relative.
 */
async function migrateAbsToRelPaths(conn: Database): Promise<void> {
	// Get vault path from Rust
	const vaultPath = await invoke<string | null>('get_vault_path');
	if (!vaultPath) return; // no vault configured yet — nothing to migrate

	const vaultNorm = vaultPath.replace(/\\/g, '/').replace(/\/$/, '');

	function stripVault(absPath: string): string {
		const norm = absPath.replace(/\\/g, '/');
		if (norm.startsWith(vaultNorm + '/')) {
			return norm.slice(vaultNorm.length + 1);
		}
		return norm; // can't determine — keep as-is
	}

	// 1. Populate rel_path on documents where it's empty
	const docs = await conn.select<{ id: number; abs_path: string; rel_path: string }[]>(
		`SELECT id, abs_path, rel_path FROM documents WHERE rel_path = '' AND abs_path != ''`,
		[],
	);
	for (const doc of docs) {
		const rel = stripVault(doc.abs_path);
		await conn.execute('UPDATE documents SET rel_path = $1 WHERE id = $2', [rel, doc.id]);
	}

	// 2. Convert timeline_entries.attachments paths from absolute to relative
	const entries = await conn.select<{ id: number; attachments: string }[]>(
		`SELECT id, attachments FROM timeline_entries WHERE attachments != '' AND attachments != '[]'`,
		[],
	);
	for (const entry of entries) {
		try {
			const parsed = JSON.parse(entry.attachments);
			if (!Array.isArray(parsed)) continue;
			let changed = false;
			for (const att of parsed) {
				if (att.path && (att.path.startsWith('/') || /^[A-Za-z]:/.test(att.path))) {
					att.path = stripVault(att.path);
					changed = true;
				}
			}
			if (changed) {
				await conn.execute(
					'UPDATE timeline_entries SET attachments = $1 WHERE id = $2',
					[JSON.stringify(parsed), entry.id],
				);
			}
		} catch {
			// malformed JSON — skip
		}
	}
}

// ── Entry-teeth sync helper ────────────────────────────────────────────

async function syncEntryTeeth(conn: Database, entryId: number, toothNumbers: string): Promise<void> {
	await conn.execute('DELETE FROM entry_teeth WHERE entry_id = $1', [entryId]);
	if (!toothNumbers) return;
	const teeth = toothNumbers.split(',').map(t => parseInt(t.trim(), 10)).filter(n => !isNaN(n) && n >= 1 && n <= 32);
	for (const tooth of teeth) {
		await conn.execute('INSERT OR IGNORE INTO entry_teeth (entry_id, tooth_number) VALUES ($1, $2)', [entryId, tooth]);
	}
}

async function migrateEntryTeeth(conn: Database): Promise<void> {
	const rows = await conn.select<{ id: number; tooth_numbers: string }[]>(
		`SELECT id, tooth_numbers FROM timeline_entries WHERE tooth_numbers != '' AND tooth_numbers IS NOT NULL`,
	);
	for (const row of rows) {
		await syncEntryTeeth(conn, row.id, row.tooth_numbers);
	}
}

// ── DB singleton ───────────────────────────────────────────────────────

let db: Database | null = null;

/** Call this after vault configuration changes to force reconnect. */
export function resetDb(): void {
	db = null;
}

export async function getDb(): Promise<Database> {
	if (!db) {
		const url = await invoke<string>('get_db_url');
		db = await Database.load(url);
		await runMigrations(db);
	}
	return db;
}

// ── Patient ID generation ──────────────────────────────────────────────

export function generatePatientId(): string {
	return 'PT-' + Date.now().toString(36).toUpperCase();
}

function nowISO(): string {
	return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

// ── CRUD operations ────────────────────────────────────────────────────

export async function insertPatient(data: PatientFormData): Promise<Patient> {
	const conn = await getDb();
	const patientId = generatePatientId();
	const now = nowISO();

	await conn.execute(
		`INSERT INTO patients (patient_id, firstname, lastname, dob, gender, phone, email,
		  insurance_provider, insurance_id, referral_source, smoking_status, occupation,
		  address, city, postal_code, country,
		  emergency_contact_name, emergency_contact_phone, emergency_contact_relation,
		  blood_group, primary_physician, marital_status,
		  created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
		[
			patientId,
			data.firstname,
			data.lastname,
			data.dob ?? '',
			data.gender ?? '',
			data.phone ?? '',
			data.email ?? '',
			data.insurance_provider ?? '',
			data.insurance_id ?? '',
			data.referral_source ?? '',
			data.smoking_status ?? '',
			data.occupation ?? '',
			data.address ?? '',
			data.city ?? '',
			data.postal_code ?? '',
			data.country ?? '',
			data.emergency_contact_name ?? '',
			data.emergency_contact_phone ?? '',
			data.emergency_contact_relation ?? '',
			data.blood_group ?? '',
			data.primary_physician ?? '',
			data.marital_status ?? '',
			now,
			now,
		],
	);

	const rows = await conn.select<Patient[]>('SELECT * FROM patients WHERE patient_id = $1', [
		patientId,
	]);
	return rows[0];
}

export async function getAllPatients(): Promise<Patient[]> {
	const conn = await getDb();
	return conn.select<Patient[]>(
		"SELECT * FROM patients WHERE status != 'archived' ORDER BY lastname ASC, firstname ASC",
	);
}

export async function getAllPatientsIncludingArchived(): Promise<Patient[]> {
	const conn = await getDb();
	return conn.select<Patient[]>('SELECT * FROM patients ORDER BY lastname ASC, firstname ASC');
}

// ── Audit helpers ──────────────────────────────────────────────────────

/** Returns "Lastname, Firstname" for a patient (denormalized for audit records). */
async function getPatientDisplayName(patientId: string): Promise<string> {
	const conn = await getDb();
	const rows = await conn.select<{ firstname: string; lastname: string }[]>(
		'SELECT firstname, lastname FROM patients WHERE patient_id = $1',
		[patientId],
	);
	if (!rows[0]) return patientId;
	return `${rows[0].lastname}, ${rows[0].firstname}`;
}

/** Returns current user label from the doctors table (first doctor) or "System". */
async function getCurrentUser(): Promise<string> {
	const conn = await getDb();
	const rows = await conn.select<{ name: string }[]>(
		'SELECT name FROM doctors ORDER BY id ASC LIMIT 1',
	);
	return rows[0]?.name ?? 'System';
}

export async function getPatient(patientId: string): Promise<Patient | null> {
	const conn = await getDb();
	const rows = await conn.select<Patient[]>('SELECT * FROM patients WHERE patient_id = $1', [
		patientId,
	]);
	return rows[0] ?? null;
}

export async function updatePatient(
	patientId: string,
	data: Partial<PatientFormData> & Record<string, unknown>,
): Promise<void> {
	const conn = await getDb();
	const now = nowISO();

	// Read before mutating (for audit)
	const before = await getPatient(patientId);

	const fields: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	for (const [key, value] of Object.entries(data)) {
		fields.push(`${key} = $${idx}`);
		values.push(value);
		idx++;
	}

	fields.push(`updated_at = $${idx}`);
	values.push(now);
	idx++;

	values.push(patientId);

	await conn.execute(
		`UPDATE patients SET ${fields.join(', ')} WHERE patient_id = $${idx}`,
		values,
	);

	if (before) {
		try {
			const patientName = `${before.lastname}, ${before.firstname}`;
			const user = await getCurrentUser();
			const changedBefore: Record<string, unknown> = {};
			const changedAfter: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(data)) {
				const prev = (before as unknown as Record<string, unknown>)[k];
				if (prev !== v) {
					changedBefore[k] = prev;
					changedAfter[k] = v;
				}
			}
			await appendAuditRecord({
				action: 'update',
				entity_type: 'patient' as AuditEntityType,
				entity_id: patientId,
				patient_id: patientId,
				patient_name: patientName,
				user,
				summary: `Edited patient "${before.firstname} ${before.lastname}"`,
				before: Object.keys(changedBefore).length ? changedBefore : null,
				after: Object.keys(changedAfter).length ? changedAfter : null,
			});
		} catch {
			// silently ignore audit errors
		}
	}
}

export async function deletePatient(patientId: string): Promise<void> {
	const conn = await getDb();

	// Read before deleting (for audit)
	const before = await getPatient(patientId);

	await conn.execute('DELETE FROM patients WHERE patient_id = $1', [patientId]);

	if (before) {
		try {
			const user = await getCurrentUser();
			await appendAuditRecord({
				action: 'delete',
				entity_type: 'patient' as AuditEntityType,
				entity_id: patientId,
				patient_id: patientId,
				patient_name: `${before.lastname}, ${before.firstname}`,
				user,
				summary: `Deleted patient "${before.firstname} ${before.lastname}"`,
				before: {
					firstname: before.firstname,
					lastname: before.lastname,
					dob: before.dob,
					phone: before.phone,
					email: before.email,
					status: before.status,
				},
				after: null,
			});
		} catch {
			// silently ignore audit errors
		}
	}
}

export async function searchPatients(query: string, includeArchived = false): Promise<Patient[]> {
	const conn = await getDb();
	const pattern = `%${query}%`;
	const archivedClause = includeArchived ? '' : "AND status != 'archived'";
	return conn.select<Patient[]>(
		`SELECT * FROM patients
		 WHERE (firstname LIKE $1 OR lastname LIKE $1 OR patient_id LIKE $1
		   OR phone LIKE $1 OR email LIKE $1
		   OR (firstname || ' ' || lastname) LIKE $1
		   OR (lastname  || ' ' || firstname) LIKE $1
		   OR (lastname  || ', ' || firstname) LIKE $1)
		 ${archivedClause}
		 ORDER BY lastname ASC, firstname ASC`,
		[pattern],
	);
}

// ── Timeline CRUD ──────────────────────────────────────────────────────

export async function insertTimelineEntry(
	patientId: string,
	data: TimelineFormData,
): Promise<TimelineEntry> {
	const conn = await getDb();
	const now = nowISO();

	await conn.execute(
		`INSERT INTO timeline_entries
		  (patient_id, entry_date, entry_type, title, provider, tooth_numbers, description,
		   treatment_category, treatment_outcome, related_entry_id, attachments, document_id,
		   plan_id, chart_data, is_locked, doctor_id, colleague_ids, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
		[
			patientId,
			data.entry_date,
			data.entry_type,
			data.title,
			data.provider ?? '',
			data.tooth_numbers ?? '',
			data.description ?? '',
			data.treatment_category ?? '',
			data.treatment_outcome ?? '',
			data.related_entry_id ?? null,
			data.attachments ?? '[]',
			data.document_id ?? null,
			data.plan_id ?? '',
			data.chart_data ?? '',
			data.is_locked ?? 0,
			data.doctor_id ?? null,
			data.colleague_ids ?? '',
			now,
			now,
		],
	);

	const rows = await conn.select<TimelineEntry[]>(
		'SELECT * FROM timeline_entries WHERE patient_id = $1 ORDER BY id DESC LIMIT 1',
		[patientId],
	);
	const newRow = rows[0];
	await syncEntryTeeth(conn, newRow.id, data.tooth_numbers ?? '');
	return newRow;
}

/** Delete all timeline entries linked to a document (used when the document is deleted). */
export async function deleteTimelineEntriesByDocumentId(documentId: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM timeline_entries WHERE document_id = $1', [documentId]);
}

export async function getTimelineEntries(
	patientId: string,
	options?: { type?: string; limit?: number; offset?: number },
): Promise<TimelineEntry[]> {
	const conn = await getDb();
	const typeClause = options?.type ? `AND entry_type = $2` : '';
	const limitClause = options?.limit ? `LIMIT ${options.limit}` : '';
	const offsetClause = options?.offset ? `OFFSET ${options.offset}` : '';
	const params: unknown[] = [patientId];
	if (options?.type) params.push(options.type);

	return conn.select<TimelineEntry[]>(
		`SELECT * FROM timeline_entries
		 WHERE patient_id = $1 ${typeClause}
		 ORDER BY entry_date ASC, id ASC
		 ${limitClause} ${offsetClause}`,
		params,
	);
}

export async function getTimelineEntry(id: number): Promise<TimelineEntry | null> {
	const conn = await getDb();
	const rows = await conn.select<TimelineEntry[]>(
		'SELECT * FROM timeline_entries WHERE id = $1',
		[id],
	);
	return rows[0] ?? null;
}

export async function getPriorProceduresForTooth(
	patientId: string,
	toothNumbers: string,
	beforeDate?: string,
	excludeEntryId?: number,
): Promise<TimelineEntry[]> {
	const conn = await getDb();
	const teeth = toothNumbers.split(',').map(t => t.trim()).filter(Boolean);
	if (teeth.length === 0) return [];

	const params: unknown[] = [patientId];
	let idx = 2;

	const toothClauses = teeth.map(n => {
		const clauses = [
			`tooth_numbers = $${idx}`,
			`tooth_numbers LIKE $${idx + 1}`,
			`tooth_numbers LIKE $${idx + 2}`,
			`tooth_numbers LIKE $${idx + 3}`,
		];
		params.push(n, `${n},%`, `%,${n},%`, `%,${n}`);
		idx += 4;
		return `(${clauses.join(' OR ')})`;
	});

	let sql = `SELECT * FROM timeline_entries
	 WHERE patient_id = $1
	   AND entry_type IN ('procedure', 'visit')
	   AND (${toothClauses.join(' OR ')})`;

	if (beforeDate) {
		sql += ` AND entry_date <= $${idx}`;
		params.push(beforeDate);
		idx++;
	}

	if (excludeEntryId !== undefined) {
		sql += ` AND id != $${idx}`;
		params.push(excludeEntryId);
		idx++;
	}

	sql += ' ORDER BY entry_date DESC LIMIT 20';

	return conn.select<TimelineEntry[]>(sql, params);
}

export async function updateTimelineEntry(
	id: number,
	data: Partial<TimelineFormData>,
): Promise<void> {
	const conn = await getDb();
	const now = nowISO();

	// Read current state before mutating (for audit)
	const before = await getTimelineEntry(id);

	const fields: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	for (const [key, value] of Object.entries(data)) {
		fields.push(`${key} = $${idx}`);
		values.push(value);
		idx++;
	}

	fields.push(`updated_at = $${idx}`);
	values.push(now);
	idx++;
	values.push(id);

	await conn.execute(
		`UPDATE timeline_entries SET ${fields.join(', ')} WHERE id = $${idx}`,
		values,
	);

	// Sync entry_teeth junction table if tooth_numbers changed
	if (data.tooth_numbers !== undefined) {
		await syncEntryTeeth(conn, id, data.tooth_numbers);
	}

	// Append audit record (non-blocking — don't let audit failure break saves)
	if (before) {
		try {
			const patientName = await getPatientDisplayName(before.patient_id);
			const user = await getCurrentUser();
			// Only record fields that actually changed
			const changedBefore: Record<string, unknown> = {};
			const changedAfter: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(data)) {
				const prev = (before as unknown as Record<string, unknown>)[k];
				if (prev !== v) {
					changedBefore[k] = prev;
					changedAfter[k] = v;
				}
			}
			await appendAuditRecord({
				action: 'update',
				entity_type: 'timeline_entry' as AuditEntityType,
				entity_id: String(id),
				patient_id: before.patient_id,
				patient_name: patientName,
				user,
				summary: `Edited "${before.title}"`,
				before: Object.keys(changedBefore).length ? changedBefore : null,
				after: Object.keys(changedAfter).length ? changedAfter : null,
			});
		} catch {
			// silently ignore audit errors
		}
	}
}

export async function deleteTimelineEntry(id: number): Promise<void> {
	const conn = await getDb();

	// Read before deleting (for audit)
	const before = await getTimelineEntry(id);

	await conn.execute('DELETE FROM timeline_entries WHERE id = $1', [id]);

	if (before) {
		try {
			const patientName = await getPatientDisplayName(before.patient_id);
			const user = await getCurrentUser();
			await appendAuditRecord({
				action: 'delete',
				entity_type: 'timeline_entry' as AuditEntityType,
				entity_id: String(id),
				patient_id: before.patient_id,
				patient_name: patientName,
				user,
				summary: `Deleted "${before.title}"`,
				before: {
					title: before.title,
					entry_date: before.entry_date,
					entry_type: before.entry_type,
					description: before.description,
					treatment_category: before.treatment_category,
					treatment_outcome: before.treatment_outcome,
					tooth_numbers: before.tooth_numbers,
					doctor_id: before.doctor_id,
				},
				after: null,
			});
		} catch {
			// silently ignore audit errors
		}
	}
}

// ── Treatment Plan CRUD ────────────────────────────────────────────────

export function generatePlanId(): string {
	return 'TP-' + Date.now().toString(36).toUpperCase();
}

export async function insertTreatmentPlan(
	patientId: string,
	data: TreatmentPlanFormData,
): Promise<TreatmentPlan> {
	const conn = await getDb();
	const planId = generatePlanId();
	const now = nowISO();

	await conn.execute(
		`INSERT INTO treatment_plans (plan_id, patient_id, title, description, status, total_estimated_cost, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, 0, $6, $7)`,
		[planId, patientId, data.title, data.description ?? '', data.status ?? 'proposed', now, now],
	);

	const rows = await conn.select<TreatmentPlan[]>(
		'SELECT * FROM treatment_plans WHERE plan_id = $1',
		[planId],
	);
	return rows[0];
}

export async function getTreatmentPlans(patientId: string): Promise<TreatmentPlan[]> {
	const conn = await getDb();
	return conn.select<TreatmentPlan[]>(
		'SELECT * FROM treatment_plans WHERE patient_id = $1 ORDER BY created_at DESC',
		[patientId],
	);
}

export async function getTreatmentPlan(planId: string): Promise<TreatmentPlan | null> {
	const conn = await getDb();
	const rows = await conn.select<TreatmentPlan[]>(
		'SELECT * FROM treatment_plans WHERE plan_id = $1',
		[planId],
	);
	return rows[0] ?? null;
}

export async function updateTreatmentPlan(
	planId: string,
	data: Partial<TreatmentPlanFormData> & { status?: TreatmentPlanStatus; total_estimated_cost?: number },
): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	const fields: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	for (const [key, value] of Object.entries(data)) {
		fields.push(`${key} = $${idx}`);
		values.push(value);
		idx++;
	}
	fields.push(`updated_at = $${idx}`);
	values.push(now);
	idx++;
	values.push(planId);

	await conn.execute(
		`UPDATE treatment_plans SET ${fields.join(', ')} WHERE plan_id = $${idx}`,
		values,
	);
}

export async function deleteTreatmentPlan(planId: string): Promise<void> {
	const conn = await getDb();

	// Read before deleting (for audit)
	const rows = await conn.select<TreatmentPlan[]>('SELECT * FROM treatment_plans WHERE plan_id = $1', [planId]);
	const before = rows[0] ?? null;

	await conn.execute('DELETE FROM treatment_plans WHERE plan_id = $1', [planId]);

	if (before) {
		try {
			const patientName = await getPatientDisplayName(before.patient_id);
			const user = await getCurrentUser();
			await appendAuditRecord({
				action: 'delete',
				entity_type: 'treatment_plan' as AuditEntityType,
				entity_id: planId,
				patient_id: before.patient_id,
				patient_name: patientName,
				user,
				summary: `Deleted treatment plan "${before.title}"`,
				before: before as unknown as Record<string, unknown>,
				after: null,
			});
		} catch {
			// silently ignore audit errors
		}
	}
}

// ── Treatment Plan Item CRUD ───────────────────────────────────────────

export async function getTreatmentPlanItems(planId: string): Promise<TreatmentPlanItem[]> {
	const conn = await getDb();
	return conn.select<TreatmentPlanItem[]>(
		'SELECT * FROM treatment_plan_items WHERE plan_id = $1 ORDER BY sequence_order ASC',
		[planId],
	);
}

export async function insertTreatmentPlanItem(
	planId: string,
	data: TreatmentPlanItemFormData,
	sequenceOrder: number,
): Promise<TreatmentPlanItem> {
	const conn = await getDb();

	await conn.execute(
		`INSERT INTO treatment_plan_items
		  (plan_id, sequence_order, procedure_code, description, tooth_numbers, estimated_cost, status)
		 VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
		[
			planId,
			sequenceOrder,
			data.procedure_code ?? '',
			data.description,
			data.tooth_numbers ?? '',
			data.estimated_cost ?? 0,
		],
	);

	const rows = await conn.select<TreatmentPlanItem[]>(
		'SELECT * FROM treatment_plan_items WHERE plan_id = $1 ORDER BY id DESC LIMIT 1',
		[planId],
	);
	return rows[0];
}

export async function updateTreatmentPlanItem(
	id: number,
	data: Partial<TreatmentPlanItemFormData> & {
		status?: TreatmentPlanItemStatus;
		completed_date?: string;
		sequence_order?: number;
	},
): Promise<void> {
	const conn = await getDb();
	const fields: string[] = [];
	const values: unknown[] = [];
	let idx = 1;

	for (const [key, value] of Object.entries(data)) {
		fields.push(`${key} = $${idx}`);
		values.push(value);
		idx++;
	}
	values.push(id);

	await conn.execute(
		`UPDATE treatment_plan_items SET ${fields.join(', ')} WHERE id = $${idx}`,
		values,
	);
}

export async function deleteTreatmentPlanItem(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM treatment_plan_items WHERE id = $1', [id]);
}

export async function recomputePlanCost(planId: string): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	await conn.execute(
		`UPDATE treatment_plans
		 SET total_estimated_cost = (
		   SELECT COALESCE(SUM(estimated_cost), 0)
		   FROM treatment_plan_items
		   WHERE plan_id = $1
		 ),
		 updated_at = $2
		 WHERE plan_id = $1`,
		[planId, now],
	);
}

// ── Ortho Classification CRUD ──────────────────────────────────────────

export async function getOrthoClassification(patientId: string): Promise<OrthoClassification | null> {
	const conn = await getDb();
	const rows = await conn.select<OrthoClassification[]>(
		'SELECT * FROM ortho_classifications WHERE patient_id = $1',
		[patientId],
	);
	return rows[0] ?? null;
}

export async function upsertOrthoClassification(
	patientId: string,
	data: Partial<Omit<OrthoClassification, 'id' | 'patient_id' | 'updated_at'>>,
): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	const existing = await getOrthoClassification(patientId);

	if (!existing) {
		const defaults: Record<string, unknown> = {
			pre_angle_class: '',
			post_angle_class: '',
			pre_molar_relationship: '',
			post_molar_relationship: '',
			pre_overjet_mm: 0,
			post_overjet_mm: 0,
			pre_overbite_mm: 0,
			post_overbite_mm: 0,
			pre_crowding: '',
			post_crowding: '',
			pre_crossbite: '',
			post_crossbite: '',
			pre_open_bite: '',
			post_open_bite: '',
			pre_midline_deviation_mm: 0,
			post_midline_deviation_mm: 0,
			treatment_type: '',
			extraction_pattern: '',
			treatment_start_date: '',
			treatment_end_date: '',
			notes: '',
			exam_date: '',
			pre_canine_class: '',
			post_canine_class: '',
			pre_crowding_upper_mm: 0,
			post_crowding_upper_mm: 0,
			pre_crowding_lower_mm: 0,
			post_crowding_lower_mm: 0,
			facial_profile: '',
			lip_competence: '',
			nasal_breathing: '',
			oral_habits: '[]',
			cvm_stage: 0,
			growth_potential: '',
			retention_protocol: '',
		};
		const merged = { ...defaults, ...data };
		const cols = Object.keys(merged);
		const vals = Object.values(merged);
		const placeholders = cols.map((_, i) => `$${i + 2}`).join(', ');
		await conn.execute(
			`INSERT INTO ortho_classifications (patient_id, ${cols.join(', ')}, updated_at) VALUES ($1, ${placeholders}, $${vals.length + 2})`,
			[patientId, ...vals, now],
		);
	} else {
		const fields: string[] = [];
		const values: unknown[] = [];
		let idx = 1;
		for (const [key, value] of Object.entries(data)) {
			fields.push(`${key} = $${idx}`);
			values.push(value);
			idx++;
		}
		fields.push(`updated_at = $${idx}`);
		values.push(now);
		idx++;
		values.push(patientId);
		await conn.execute(
			`UPDATE ortho_classifications SET ${fields.join(', ')} WHERE patient_id = $${idx}`,
			values,
		);
	}
}

// ── KIG Findings CRUD ─────────────────────────────────────────────────

export async function getKigFindings(patientId: string): Promise<KigFinding[]> {
	const conn = await getDb();
	return conn.select<KigFinding[]>(
		`SELECT * FROM kig_findings WHERE patient_id = $1 ORDER BY kig_group`,
		[patientId],
	);
}

export async function upsertKigFinding(
	patientId: string,
	kigGroup: KigGroupCode,
	kigLevel: number,
	measuredValue: number | null,
	notes: string,
): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		`INSERT INTO kig_findings (patient_id, kig_group, kig_level, measured_value, notes)
		 VALUES ($1, $2, $3, $4, $5)
		 ON CONFLICT(patient_id, kig_group) DO UPDATE SET
		   kig_level = excluded.kig_level,
		   measured_value = excluded.measured_value,
		   notes = excluded.notes`,
		[patientId, kigGroup, kigLevel, measuredValue, notes],
	);
}

export async function deleteKigFinding(patientId: string, kigGroup: KigGroupCode): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		`DELETE FROM kig_findings WHERE patient_id = $1 AND kig_group = $2`,
		[patientId, kigGroup],
	);
}

// ── Ortho Assessment Snapshots ─────────────────────────────────────────

export async function getOrthoAssessments(patientId: string): Promise<OrthoAssessment[]> {
	const conn = await getDb();
	type RawRow = Omit<OrthoAssessment, 'findings'> & { findings: string };
	const rows = await conn.select<RawRow[]>(
		`SELECT * FROM ortho_assessments WHERE patient_id = $1 ORDER BY exam_date DESC, created_at DESC`,
		[patientId],
	);
	return rows.map((r) => ({ ...r, findings: JSON.parse(r.findings) as OrthoKigEntry[] }));
}

export async function saveOrthoAssessment(
	patientId: string,
	examDate: string,
	doctorId: number | null,
	findings: OrthoKigEntry[],
	notes: string,
	dentitionStage: string,
	treatmentPhase: string,
	angleClass: string,
	cvmStage: number,
	facialProfile: string,
	treatmentRecommendation: string,
): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		`INSERT INTO ortho_assessments
		 (patient_id, exam_date, doctor_id, findings, notes, dentition_stage, treatment_phase, angle_class, cvm_stage, facial_profile, treatment_recommendation)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		[patientId, examDate, doctorId, JSON.stringify(findings), notes, dentitionStage, treatmentPhase, angleClass, cvmStage, facialProfile, treatmentRecommendation],
	);
}

export async function deleteOrthoAssessment(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute(`DELETE FROM ortho_assessments WHERE id = $1`, [id]);
}

// ── Patient Classification CRUD ────────────────────────────────────────

export async function getPatientClassification(
	patientId: string,
): Promise<PatientClassification | null> {
	const conn = await getDb();
	const rows = await conn.select<PatientClassification[]>(
		'SELECT * FROM patient_classifications WHERE patient_id = $1',
		[patientId],
	);
	return rows[0] ?? null;
}

export async function upsertPatientClassification(
	patientId: string,
	data: Partial<Omit<PatientClassification, 'id' | 'patient_id' | 'updated_at'>>,
): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	const existing = await getPatientClassification(patientId);

	if (!existing) {
		const merged = {
			perio_status: '',
			caries_risk: '',
			perio_risk: '',
			special_conditions: '[]',
			notes: '',
			...data,
		};
		await conn.execute(
			`INSERT INTO patient_classifications
			 (patient_id, perio_status, caries_risk, perio_risk, special_conditions, notes, updated_at)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)`,
			[
				patientId,
				merged.perio_status, merged.caries_risk, merged.perio_risk,
				merged.special_conditions, merged.notes, now,
			],
		);
	} else {
		const fields: string[] = [];
		const values: unknown[] = [];
		let idx = 1;
		for (const [key, value] of Object.entries(data)) {
			fields.push(`${key} = $${idx}`);
			values.push(value);
			idx++;
		}
		fields.push(`updated_at = $${idx}`);
		values.push(now);
		idx++;
		values.push(patientId);
		await conn.execute(
			`UPDATE patient_classifications SET ${fields.join(', ')} WHERE patient_id = $${idx}`,
			values,
		);
	}
}

// ── Dental Chart CRUD ──────────────────────────────────────────────────

export async function getChartData(patientId: string): Promise<ToothChartEntry[]> {
	const conn = await getDb();
	return conn.select<ToothChartEntry[]>(
		'SELECT * FROM dental_chart WHERE patient_id = $1 ORDER BY tooth_number ASC',
		[patientId],
	);
}

export async function getToothChartEntry(
	patientId: string,
	toothNumber: number,
): Promise<ToothChartEntry | null> {
	const conn = await getDb();
	const rows = await conn.select<ToothChartEntry[]>(
		'SELECT * FROM dental_chart WHERE patient_id = $1 AND tooth_number = $2',
		[patientId, toothNumber],
	);
	return rows[0] ?? null;
}

export async function upsertToothChartEntry(
	patientId: string,
	toothNumber: number,
	data: ToothChartFormData,
): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	const existing = await getToothChartEntry(patientId, toothNumber);

	if (!existing) {
		await conn.execute(
			`INSERT INTO dental_chart (patient_id, tooth_number, condition, surfaces, notes, last_examined, bridge_group_id, bridge_role, abutment_type, prosthesis_type, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
			[
				patientId,
				toothNumber,
				data.condition ?? 'healthy',
				data.surfaces ?? '{}',
				data.notes ?? '',
				data.last_examined ?? '',
				data.bridge_group_id ?? null,
				data.bridge_role ?? null,
				data.abutment_type ?? null,
				data.prosthesis_type ?? null,
				now,
			],
		);
	} else {
		const fields: string[] = [];
		const values: unknown[] = [];
		let idx = 1;
		for (const [key, value] of Object.entries(data)) {
			fields.push(`${key} = $${idx}`);
			values.push(value);
			idx++;
		}
		fields.push(`updated_at = $${idx}`);
		values.push(now);
		idx++;
		values.push(patientId);
		values.push(toothNumber);
		await conn.execute(
			`UPDATE dental_chart SET ${fields.join(', ')} WHERE patient_id = $${idx} AND tooth_number = $${idx + 1}`,
			values,
		);

		// Audit — only log fields that actually changed
		try {
			const changedBefore: Record<string, unknown> = {};
			const changedAfter: Record<string, unknown> = {};
			for (const [k, v] of Object.entries(data)) {
				const prev = (existing as unknown as Record<string, unknown>)[k];
				if (prev !== v) {
					changedBefore[k] = prev;
					changedAfter[k] = v;
				}
			}
			if (Object.keys(changedAfter).length > 0) {
				const patientName = await getPatientDisplayName(patientId);
				const user = await getCurrentUser();
				await appendAuditRecord({
					action: 'update',
					entity_type: 'dental_chart' as AuditEntityType,
					entity_id: `${patientId}:${toothNumber}`,
					patient_id: patientId,
					patient_name: patientName,
					user,
					summary: `Updated tooth #${toothNumber}`,
					before: changedBefore,
					after: changedAfter,
				});
			}
		} catch {
			// silently ignore audit errors
		}
	}
}

export async function getBridgeGroup(
	patientId: string,
	bridgeGroupId: string,
): Promise<ToothChartEntry[]> {
	const conn = await getDb();
	return conn.select<ToothChartEntry[]>(
		`SELECT * FROM dental_chart WHERE patient_id = $1 AND bridge_group_id = $2 ORDER BY tooth_number ASC`,
		[patientId, bridgeGroupId],
	);
}

// ── Clinical Exams CRUD ────────────────────────────────────────────────

export async function insertClinicalExam(
	patientId: string,
	data: ClinicalExamFormData,
): Promise<ClinicalExam> {
	const conn = await getDb();
	const now = nowISO();

	// Keep only the latest chart per day — delete any existing exam for the same patient + date
	await conn.execute(
		'DELETE FROM clinical_exams WHERE patient_id = $1 AND exam_date = $2',
		[patientId, data.exam_date],
	);

	await conn.execute(
		`INSERT INTO clinical_exams
		  (patient_id, exam_date, exam_type, examiner, chief_complaint, findings, notes, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[
			patientId,
			data.exam_date,
			data.exam_type ?? 'full',
			data.examiner ?? '',
			data.chief_complaint ?? '',
			data.findings ?? '',
			data.notes ?? '',
			now,
		],
	);

	const rows = await conn.select<ClinicalExam[]>(
		'SELECT * FROM clinical_exams WHERE patient_id = $1 ORDER BY id DESC LIMIT 1',
		[patientId],
	);
	return rows[0];
}

export async function getClinicalExams(patientId: string): Promise<ClinicalExam[]> {
	const conn = await getDb();
	return conn.select<ClinicalExam[]>(
		'SELECT * FROM clinical_exams WHERE patient_id = $1 ORDER BY exam_date DESC, id DESC',
		[patientId],
	);
}

export async function updateClinicalExam(
	id: number,
	data: Partial<ClinicalExamFormData>,
): Promise<void> {
	const conn = await getDb();
	const fields: string[] = [];
	const values: unknown[] = [];
	let idx = 1;
	for (const [key, value] of Object.entries(data)) {
		fields.push(`${key} = $${idx}`);
		values.push(value);
		idx++;
	}
	values.push(id);
	await conn.execute(
		`UPDATE clinical_exams SET ${fields.join(', ')} WHERE id = $${idx}`,
		values,
	);
}

export async function deleteClinicalExam(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM clinical_exams WHERE id = $1', [id]);
}

// ── Documents CRUD ─────────────────────────────────────────────────────

export async function insertDocument(
	patientId: string,
	data: PatientDocumentFormData,
): Promise<PatientDocument> {
	const conn = await getDb();
	const now = nowISO();

	await conn.execute(
		`INSERT INTO documents
		  (patient_id, filename, original_name, category, mime_type, file_size, abs_path, rel_path, notes, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		[
			patientId,
			data.filename,
			data.original_name,
			data.category ?? 'other',
			data.mime_type ?? '',
			data.file_size ?? 0,
			data.abs_path,
			data.rel_path ?? '',
			data.notes ?? '',
			now,
		],
	);

	const rows = await conn.select<PatientDocument[]>(
		'SELECT * FROM documents WHERE patient_id = $1 ORDER BY id DESC LIMIT 1',
		[patientId],
	);
	return rows[0];
}

export async function getDocuments(
	patientId: string,
	category?: string,
): Promise<PatientDocument[]> {
	const conn = await getDb();
	const catClause = category ? 'AND category = $2' : '';
	const params: unknown[] = [patientId];
	if (category) params.push(category);

	return conn.select<PatientDocument[]>(
		`SELECT * FROM documents WHERE patient_id = $1 ${catClause} ORDER BY created_at DESC`,
		params,
	);
}

export async function updateDocument(
	id: number,
	data: Partial<Pick<PatientDocument, 'category' | 'notes'>>,
): Promise<void> {
	const conn = await getDb();
	const fields: string[] = [];
	const values: unknown[] = [];
	let idx = 1;
	for (const [key, value] of Object.entries(data)) {
		fields.push(`${key} = $${idx}`);
		values.push(value);
		idx++;
	}
	values.push(id);
	await conn.execute(
		`UPDATE documents SET ${fields.join(', ')} WHERE id = $${idx}`,
		values,
	);
}

export async function deleteDocument(id: number): Promise<void> {
	const conn = await getDb();

	// Read before deleting (for audit)
	const docRows = await conn.select<PatientDocument[]>('SELECT * FROM documents WHERE id = $1', [id]);
	const before = docRows[0] ?? null;

	await conn.execute('DELETE FROM documents WHERE id = $1', [id]);

	if (before) {
		try {
			const patientName = await getPatientDisplayName(before.patient_id);
			const user = await getCurrentUser();
			await appendAuditRecord({
				action: 'delete',
				entity_type: 'document' as AuditEntityType,
				entity_id: String(id),
				patient_id: before.patient_id,
				patient_name: patientName,
				user,
				summary: `Deleted document "${before.filename}"`,
				before: before as unknown as Record<string, unknown>,
				after: null,
			});
		} catch {
			// silently ignore audit errors
		}
	}
}

/**
 * Return all relative file paths tracked in the documents table for a patient.
 * Used by the vault auto-scan to determine which on-disk files are already imported.
 * Falls back to abs_path for legacy rows that haven't been migrated yet.
 */
export async function getTrackedFilePaths(patientId: string): Promise<string[]> {
	const conn = await getDb();
	const rows = await conn.select<{ rel_path: string; abs_path: string }[]>(
		'SELECT rel_path, abs_path FROM documents WHERE patient_id = $1',
		[patientId],
	);
	return rows.map((r) => r.rel_path || r.abs_path);
}

// ── Analytics / Dashboard ──────────────────────────────────────────────

export async function getPatientStatusCounts(): Promise<PatientStatusCounts> {
	const conn = await getDb();
	const rows = await conn.select<PatientStatusCounts[]>(
		`SELECT COUNT(*) as total,
		  SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
		  SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive,
		  SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) as archived
		 FROM patients`,
		[],
	);
	return rows[0] ?? { total: 0, active: 0, inactive: 0, archived: 0 };
}

export async function getProcedureCountThisMonth(): Promise<number> {
	const conn = await getDb();
	const rows = await conn.select<{ count: number }[]>(
		`SELECT COUNT(*) as count FROM timeline_entries
		 WHERE entry_type = 'procedure'
		   AND entry_date >= date('now', 'start of month')
		   AND entry_date <= date('now')`,
		[],
	);
	return rows[0]?.count ?? 0;
}

export async function getCategoryStats(): Promise<CategoryStat[]> {
	const conn = await getDb();
	return conn.select<CategoryStat[]>(
		`SELECT treatment_category as category, COUNT(*) as count
		 FROM timeline_entries
		 WHERE entry_type = 'procedure' AND treatment_category != ''
		 GROUP BY treatment_category
		 ORDER BY count DESC`,
		[],
	);
}

export async function getOutcomeStats(): Promise<OutcomeStat[]> {
	const conn = await getDb();
	return conn.select<OutcomeStat[]>(
		`SELECT treatment_category as category, treatment_outcome as outcome, COUNT(*) as count
		 FROM timeline_entries
		 WHERE entry_type = 'procedure'
		   AND treatment_category != ''
		   AND treatment_outcome != ''
		 GROUP BY treatment_category, treatment_outcome
		 ORDER BY category, count DESC`,
		[],
	);
}

export async function getOverallSuccessRate(): Promise<SuccessRateStat> {
	const conn = await getDb();
	const rows = await conn.select<SuccessRateStat[]>(
		`SELECT
		  SUM(CASE WHEN treatment_outcome = 'successful' THEN 1 ELSE 0 END) as successful,
		  COUNT(*) as total_with_outcome
		 FROM timeline_entries
		 WHERE entry_type = 'procedure'
		   AND treatment_outcome != ''
		   AND treatment_outcome != 'unknown'`,
		[],
	);
	return rows[0] ?? { successful: 0, total_with_outcome: 0 };
}

export async function getRecentEntries(limit = 10): Promise<RecentEntry[]> {
	const conn = await getDb();
	return conn.select<RecentEntry[]>(
		`SELECT te.id, te.patient_id, te.entry_date, te.entry_type, te.title,
		        te.treatment_category, te.treatment_outcome, te.tooth_numbers,
		        p.firstname, p.lastname
		 FROM timeline_entries te
		 JOIN patients p ON te.patient_id = p.patient_id
		 ORDER BY te.entry_date DESC, te.id DESC
		 LIMIT $1`,
		[limit],
	);
}

export async function getUpcomingAppointments(limit = 10): Promise<Patient[]> {
	const conn = await getDb();
	return conn.select<Patient[]>(
		`SELECT * FROM patients
		 WHERE next_appointment != ''
		   AND next_appointment >= date('now')
		   AND status != 'archived'
		 ORDER BY next_appointment ASC
		 LIMIT $1`,
		[limit],
	);
}

// ── App Settings ───────────────────────────────────────────────────────

export async function getSetting(key: string): Promise<string | null> {
	const conn = await getDb();
	const rows = await conn.select<{ value: string }[]>(
		'SELECT value FROM settings WHERE key = $1',
		[key],
	);
	return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
		[key, value],
	);
}

export async function getAllSettings(): Promise<{ key: string; value: string }[]> {
	const conn = await getDb();
	return conn.select<{ key: string; value: string }[]>(
		'SELECT key, value FROM settings ORDER BY key',
		[],
	);
}

export async function bulkSetSettings(entries: { key: string; value: string }[]): Promise<void> {
	const conn = await getDb();
	for (const { key, value } of entries) {
		await conn.execute(
			'INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)',
			[key, value],
		);
	}
}

// ── Patient Note Entries CRUD ──────────────────────────────────────────

export async function getNoteEntries(patientId: string): Promise<PatientNoteEntry[]> {
	const conn = await getDb();
	return conn.select<PatientNoteEntry[]>(
		'SELECT * FROM patient_note_entries WHERE patient_id = $1 ORDER BY created_at ASC, id ASC',
		[patientId],
	);
}

export async function insertNoteEntry(patientId: string, content: string): Promise<PatientNoteEntry> {
	const conn = await getDb();
	const now = nowISO();
	await conn.execute(
		'INSERT INTO patient_note_entries (patient_id, content, created_at) VALUES ($1, $2, $3)',
		[patientId, content, now],
	);
	const rows = await conn.select<PatientNoteEntry[]>(
		'SELECT * FROM patient_note_entries WHERE patient_id = $1 ORDER BY id DESC LIMIT 1',
		[patientId],
	);
	return rows[0];
}

export async function deleteNoteEntry(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM patient_note_entries WHERE id = $1', [id]);
}

// ── Medical Entries CRUD ───────────────────────────────────────────────

export async function getMedicalEntries(patientId: string): Promise<MedicalEntry[]> {
	const conn = await getDb();
	return conn.select<MedicalEntry[]>(
		'SELECT * FROM medical_entries WHERE patient_id = $1 ORDER BY created_at ASC, id ASC',
		[patientId],
	);
}

export async function insertMedicalEntry(
	patientId: string,
	content: string,
	entry_type: MedicalEntryType = 'note',
	createdAt?: string,
): Promise<MedicalEntry> {
	const conn = await getDb();
	const ts = createdAt ?? nowISO();
	await conn.execute(
		'INSERT INTO medical_entries (patient_id, content, entry_type, created_at) VALUES ($1, $2, $3, $4)',
		[patientId, content, entry_type, ts],
	);
	const rows = await conn.select<MedicalEntry[]>(
		'SELECT * FROM medical_entries WHERE patient_id = $1 ORDER BY id DESC LIMIT 1',
		[patientId],
	);
	return rows[0];
}

export async function deleteMedicalEntry(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM medical_entries WHERE id = $1', [id]);
}

export async function updateMedicalEntryDate(id: number, createdAt: string): Promise<void> {
	const conn = await getDb();
	await conn.execute('UPDATE medical_entries SET created_at = $1 WHERE id = $2', [createdAt, id]);
}

// ── Acute Problems CRUD ────────────────────────────────────────────────

export async function getAcuteProblems(patientId: string): Promise<AcuteProblem[]> {
	const conn = await getDb();
	return conn.select<AcuteProblem[]>(
		'SELECT * FROM acute_problems WHERE patient_id = $1 ORDER BY resolved ASC, created_at DESC, id DESC',
		[patientId],
	);
}

export async function insertAcuteProblem(
	patientId: string,
	content: string,
	createdAt?: string,
): Promise<AcuteProblem> {
	const conn = await getDb();
	const ts = createdAt ?? nowISO();
	await conn.execute(
		'INSERT INTO acute_problems (patient_id, content, resolved, created_at) VALUES ($1, $2, 0, $3)',
		[patientId, content, ts],
	);
	const rows = await conn.select<AcuteProblem[]>(
		'SELECT * FROM acute_problems WHERE patient_id = $1 ORDER BY id DESC LIMIT 1',
		[patientId],
	);
	return rows[0];
}

export async function resolveAcuteProblem(id: number, resolved: boolean): Promise<void> {
	const conn = await getDb();
	await conn.execute('UPDATE acute_problems SET resolved = $1 WHERE id = $2', [resolved ? 1 : 0, id]);
}

export async function deleteAcuteProblem(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM acute_problems WHERE id = $1', [id]);
}

export async function updateAcuteProblemDate(id: number, createdAt: string): Promise<void> {
	const conn = await getDb();
	await conn.execute('UPDATE acute_problems SET created_at = $1 WHERE id = $2', [createdAt, id]);
}

// ── Timeline: unlock chart snapshot ───────────────────────────────────

export async function unlockTimelineEntry(id: number): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	await conn.execute('UPDATE timeline_entries SET is_locked = 0, updated_at = $1 WHERE id = $2', [now, id]);
}

export async function updateSnapshotChartData(id: number, chartData: string): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	await conn.execute(
		'UPDATE timeline_entries SET chart_data = $1, updated_at = $2 WHERE id = $3',
		[chartData, now, id],
	);
}

// ── Doctors CRUD ───────────────────────────────────────────────────────

export async function getDoctors(): Promise<Doctor[]> {
	const conn = await getDb();
	return conn.select<Doctor[]>('SELECT * FROM doctors ORDER BY name ASC');
}

export async function insertDoctor(data: DoctorFormData): Promise<Doctor> {
	const conn = await getDb();
	const now = nowISO();
	await conn.execute(
		'INSERT INTO doctors (name, specialty, color, role, created_at) VALUES ($1, $2, $3, $4, $5)',
		[data.name.trim(), data.specialty?.trim() ?? '', data.color ?? '#6366f1', data.role ?? 'doctor', now],
	);
	const rows = await conn.select<Doctor[]>('SELECT * FROM doctors ORDER BY id DESC LIMIT 1');
	return rows[0];
}

export async function updateDoctor(id: number, data: Partial<DoctorFormData>): Promise<void> {
	const conn = await getDb();
	const sets: string[] = [];
	const vals: unknown[] = [];
	let i = 1;
	if (data.name !== undefined)      { sets.push(`name = $${i++}`);      vals.push(data.name.trim()); }
	if (data.specialty !== undefined) { sets.push(`specialty = $${i++}`); vals.push(data.specialty.trim()); }
	if (data.color !== undefined)     { sets.push(`color = $${i++}`);     vals.push(data.color); }
	if (data.role !== undefined)      { sets.push(`role = $${i++}`);      vals.push(data.role); }
	if (sets.length === 0) return;
	vals.push(id);
	await conn.execute(`UPDATE doctors SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

export async function deleteDoctor(id: number): Promise<void> {
	const conn = await getDb();
	// Unlink any timeline entries that referenced this doctor
	await conn.execute('UPDATE timeline_entries SET doctor_id = NULL WHERE doctor_id = $1', [id]);
	await conn.execute('DELETE FROM doctors WHERE id = $1', [id]);
}

// ── Acute Problems text (scratch-pad) ────────────────────────────────

export async function getAcuteText(patientId: string): Promise<string> {
	const conn = await getDb();
	const rows = await conn.select<{ content: string }[]>(
		'SELECT content FROM patient_acute_text WHERE patient_id = $1',
		[patientId],
	);
	return rows[0]?.content ?? '';
}

export async function upsertAcuteText(patientId: string, content: string): Promise<void> {
	const conn = await getDb();
	const now  = nowISO();
	await conn.execute(
		`INSERT INTO patient_acute_text (patient_id, content, updated_at)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (patient_id) DO UPDATE SET content = $2, updated_at = $3`,
		[patientId, content, now],
	);
}

// ── Medical History text (scratch-pad) ───────────────────────────────

export async function getMedicalText(patientId: string): Promise<string> {
	const conn = await getDb();
	const rows = await conn.select<{ content: string }[]>(
		'SELECT content FROM patient_medical_text WHERE patient_id = $1',
		[patientId],
	);
	return rows[0]?.content ?? '';
}

export async function upsertMedicalText(patientId: string, content: string): Promise<void> {
	const conn = await getDb();
	const now  = nowISO();
	await conn.execute(
		`INSERT INTO patient_medical_text (patient_id, content, updated_at)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (patient_id) DO UPDATE SET content = $2, updated_at = $3`,
		[patientId, content, now],
	);
}

// ── Per-patient clinical tags ────────────────────────────────────────

export async function getPatientTags(patientId: string, scope: 'acute' | 'medical'): Promise<string[]> {
	const conn  = await getDb();
	const table = scope === 'acute' ? 'patient_acute_tags' : 'patient_medical_tags';
	const rows  = await conn.select<{ tag: string }[]>(
		`SELECT tag FROM ${table} WHERE patient_id = $1`,
		[patientId],
	);
	return rows.map(r => r.tag);
}

export async function setPatientTags(patientId: string, scope: 'acute' | 'medical', tags: string[]): Promise<void> {
	const conn  = await getDb();
	const table = scope === 'acute' ? 'patient_acute_tags' : 'patient_medical_tags';
	await conn.execute(`DELETE FROM ${table} WHERE patient_id = $1`, [patientId]);
	for (const tag of tags) {
		await conn.execute(`INSERT INTO ${table} (patient_id, tag) VALUES ($1, $2)`, [patientId, tag]);
	}
}

// ── Patient Misc Notes (single persistent scratch-pad per patient) ─────

export async function getMiscNotes(patientId: string): Promise<string> {
	const conn = await getDb();
	const rows = await conn.select<{ content: string }[]>(
		'SELECT content FROM patient_misc_notes WHERE patient_id = $1',
		[patientId],
	);
	return rows[0]?.content ?? '';
}

export async function upsertMiscNotes(patientId: string, content: string): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	await conn.execute(
		`INSERT INTO patient_misc_notes (patient_id, content, updated_at)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (patient_id) DO UPDATE SET content = $2, updated_at = $3`,
		[patientId, content, now],
	);
}

// ── Complications CRUD ─────────────────────────────────────────────────

export async function getComplications(timelineEntryId: number): Promise<Complication[]> {
	const conn = await getDb();
	return conn.select<Complication[]>(
		'SELECT * FROM complications WHERE timeline_entry_id = $1 ORDER BY date_reported DESC',
		[timelineEntryId],
	);
}

export async function insertComplication(
	timelineEntryId: number,
	patientId: string,
	data: {
		complication_type: string;
		description?: string;
		severity?: string;
		date_reported: string;
	},
): Promise<Complication> {
	const conn = await getDb();
	const now = nowISO();
	await conn.execute(
		`INSERT INTO complications (timeline_entry_id, patient_id, complication_type, description, severity, date_reported, resolved, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, 0, $7)`,
		[
			timelineEntryId,
			patientId,
			data.complication_type,
			data.description ?? '',
			data.severity ?? 'mild',
			data.date_reported,
			now,
		],
	);
	const rows = await conn.select<Complication[]>(
		'SELECT * FROM complications WHERE timeline_entry_id = $1 ORDER BY id DESC LIMIT 1',
		[timelineEntryId],
	);
	return rows[0];
}

export async function resolveComplication(id: number, resolved: boolean): Promise<void> {
	const conn = await getDb();
	const today = new Date().toISOString().slice(0, 10);
	await conn.execute(
		'UPDATE complications SET resolved = $1, date_resolved = $2 WHERE id = $3',
		[resolved ? 1 : 0, resolved ? today : '', id],
	);
}

export async function deleteComplication(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM complications WHERE id = $1', [id]);
}

// ── Patient Conditions CRUD ────────────────────────────────────────────

export async function getPatientConditions(patientId: string): Promise<PatientCondition[]> {
	const conn = await getDb();
	return conn.select<PatientCondition[]>(
		'SELECT * FROM patient_conditions WHERE patient_id = $1 ORDER BY is_active DESC, start_date DESC',
		[patientId],
	);
}

export async function insertPatientCondition(
	patientId: string,
	data: { condition_key: string; start_date?: string; notes?: string },
): Promise<PatientCondition> {
	const conn = await getDb();
	const now = nowISO();
	await conn.execute(
		`INSERT INTO patient_conditions (patient_id, condition_key, start_date, end_date, is_active, notes, created_at)
		 VALUES ($1, $2, $3, '', 1, $4, $5)`,
		[patientId, data.condition_key, data.start_date ?? '', data.notes ?? '', now],
	);
	const rows = await conn.select<PatientCondition[]>(
		'SELECT * FROM patient_conditions WHERE patient_id = $1 ORDER BY id DESC LIMIT 1',
		[patientId],
	);
	return rows[0];
}

export async function resolvePatientCondition(id: number, endDate: string): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		'UPDATE patient_conditions SET is_active = 0, end_date = $1 WHERE id = $2',
		[endDate, id],
	);
}

export async function deletePatientCondition(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM patient_conditions WHERE id = $1', [id]);
}

// ── Dental Chart History ───────────────────────────────────────────────

export async function recordChartHistory(patientId: string, snapshotEntryId: number): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	const chartRows = await conn.select<{ tooth_number: number; condition: string; surfaces: string }[]>(
		'SELECT tooth_number, condition, surfaces FROM dental_chart WHERE patient_id = $1',
		[patientId],
	);
	for (const row of chartRows) {
		await conn.execute(
			`INSERT INTO dental_chart_history (patient_id, tooth_number, condition, surfaces, snapshot_entry_id, recorded_at)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[patientId, row.tooth_number, row.condition, row.surfaces, snapshotEntryId, now],
		);
	}
}

export async function getToothHistory(patientId: string, toothNumber: number): Promise<DentalChartHistoryEntry[]> {
	const conn = await getDb();
	return conn.select<DentalChartHistoryEntry[]>(
		'SELECT * FROM dental_chart_history WHERE patient_id = $1 AND tooth_number = $2 ORDER BY recorded_at ASC',
		[patientId, toothNumber],
	);
}

// ── Probing CRUD ───────────────────────────────────────────────────────

export async function insertProbingRecord(
	patientId: string,
	data: { exam_date: string; examiner?: string; notes?: string },
): Promise<ProbingRecord> {
	const conn = await getDb();
	const now = nowISO();
	await conn.execute(
		'INSERT INTO probing_records (patient_id, exam_date, examiner, notes, created_at) VALUES ($1, $2, $3, $4, $5)',
		[patientId, data.exam_date, data.examiner ?? '', data.notes ?? '', now],
	);
	const rows = await conn.select<ProbingRecord[]>(
		'SELECT * FROM probing_records WHERE patient_id = $1 ORDER BY id DESC LIMIT 1',
		[patientId],
	);
	return rows[0];
}

export async function getProbingRecords(patientId: string): Promise<ProbingRecord[]> {
	const conn = await getDb();
	return conn.select<ProbingRecord[]>(
		'SELECT * FROM probing_records WHERE patient_id = $1 ORDER BY exam_date DESC',
		[patientId],
	);
}

export async function upsertProbingMeasurement(
	recordId: number,
	toothNumber: number,
	site: string,
	data: {
		pocket_depth?: number | null;
		bleeding_on_probing?: number;
		recession?: number | null;
		plaque?: number;
	},
): Promise<void> {
	const conn = await getDb();
	const pd = data.pocket_depth !== undefined ? data.pocket_depth : null;
	const bop = data.bleeding_on_probing !== undefined ? data.bleeding_on_probing : 0;
	const rec = data.recession !== undefined ? data.recession : null;
	const plaque = data.plaque !== undefined ? data.plaque : 0;

	await conn.execute(
		`INSERT INTO probing_measurements (record_id, tooth_number, site, pocket_depth, bleeding_on_probing, recession, plaque)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (record_id, tooth_number, site) DO UPDATE SET
		   pocket_depth = CASE WHEN $4 IS NOT NULL THEN $4 ELSE pocket_depth END,
		   bleeding_on_probing = $5,
		   recession = CASE WHEN $6 IS NOT NULL THEN $6 ELSE recession END,
		   plaque = $7`,
		[recordId, toothNumber, site, pd, bop, rec, plaque],
	);
}

export async function getProbingMeasurements(recordId: number): Promise<ProbingMeasurement[]> {
	const conn = await getDb();
	return conn.select<ProbingMeasurement[]>(
		'SELECT * FROM probing_measurements WHERE record_id = $1',
		[recordId],
	);
}

export async function upsertProbingToothData(
	recordId: number,
	toothNumber: number,
	data: {
		mobility?: number | null;
		furcation?: number | null;
		furcation_sites?: string;
		notes?: string;
	},
): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		`INSERT INTO probing_tooth_data (record_id, tooth_number, mobility, furcation, furcation_sites, notes)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (record_id, tooth_number) DO UPDATE SET
		   mobility = COALESCE($3, mobility),
		   furcation = COALESCE($4, furcation),
		   furcation_sites = CASE WHEN $5 != '' THEN $5 ELSE furcation_sites END,
		   notes = $6`,
		[
			recordId,
			toothNumber,
			data.mobility ?? null,
			data.furcation ?? null,
			data.furcation_sites ?? '',
			data.notes ?? '',
		],
	);
}

export async function getProbingToothData(recordId: number): Promise<ProbingToothData[]> {
	const conn = await getDb();
	return conn.select<ProbingToothData[]>(
		'SELECT * FROM probing_tooth_data WHERE record_id = $1',
		[recordId],
	);
}

// ── Reports / Filtered queries ─────────────────────────────────────────

export async function getFilteredEntries(filters: ReportFilters): Promise<ReportEntry[]> {
	const conn = await getDb();
	const params: unknown[] = [];
	let idx = 1;
	const clauses: string[] = [];

	if (filters.dateFrom) {
		clauses.push(`te.entry_date >= $${idx}`);
		params.push(filters.dateFrom);
		idx++;
	}
	if (filters.dateTo) {
		clauses.push(`te.entry_date <= $${idx}`);
		params.push(filters.dateTo);
		idx++;
	}
	if (filters.doctorId !== undefined && filters.doctorId !== null) {
		clauses.push(`te.doctor_id = $${idx}`);
		params.push(filters.doctorId);
		idx++;
	}
	if (filters.categories && filters.categories.length > 0) {
		const placeholders = filters.categories.map(() => `$${idx++}`);
		clauses.push(`te.treatment_category IN (${placeholders.join(', ')})`);
		params.push(...filters.categories);
	}
	if (filters.outcomes && filters.outcomes.length > 0) {
		const placeholders = filters.outcomes.map(() => `$${idx++}`);
		clauses.push(`te.treatment_outcome IN (${placeholders.join(', ')})`);
		params.push(...filters.outcomes);
	}
	if (filters.toothNumbers && filters.toothNumbers.length > 0) {
		const toothClauses = filters.toothNumbers.map(n => {
			const c = [
				`te.tooth_numbers = $${idx}`,
				`te.tooth_numbers LIKE $${idx + 1}`,
				`te.tooth_numbers LIKE $${idx + 2}`,
				`te.tooth_numbers LIKE $${idx + 3}`,
			];
			params.push(String(n), `${n},%`, `%,${n},%`, `%,${n}`);
			idx += 4;
			return `(${c.join(' OR ')})`;
		});
		clauses.push(`(${toothClauses.join(' OR ')})`);
	}

	const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

	return conn.select<ReportEntry[]>(
		`SELECT te.id, te.patient_id,
		        (p.lastname || ', ' || p.firstname) as patient_name,
		        te.entry_date, te.entry_type, te.title,
		        te.treatment_category, te.treatment_outcome,
		        te.tooth_numbers, te.description,
		        COALESCE(d.name, '') as doctor_name
		 FROM timeline_entries te
		 JOIN patients p ON te.patient_id = p.patient_id
		 LEFT JOIN doctors d ON te.doctor_id = d.id
		 ${whereClause}
		 ORDER BY te.entry_date DESC, te.id DESC
		 LIMIT 1000`,
		params,
	);
}

export async function getFilteredSummary(filters: ReportFilters): Promise<{
	total: number;
	byCategory: CategoryStat[];
	byOutcome: { outcome: string; count: number }[];
	byProvider: { doctor_name: string; total: number; successful: number }[];
}> {
	const entries = await getFilteredEntries(filters);
	const total = entries.length;

	const catMap = new Map<string, number>();
	const outcomeMap = new Map<string, number>();
	const providerMap = new Map<string, { total: number; successful: number }>();

	for (const e of entries) {
		if (e.treatment_category) {
			catMap.set(e.treatment_category, (catMap.get(e.treatment_category) ?? 0) + 1);
		}
		if (e.treatment_outcome) {
			outcomeMap.set(e.treatment_outcome, (outcomeMap.get(e.treatment_outcome) ?? 0) + 1);
		}
		if (e.doctor_name) {
			const p = providerMap.get(e.doctor_name) ?? { total: 0, successful: 0 };
			p.total++;
			if (e.treatment_outcome === 'successful') p.successful++;
			providerMap.set(e.doctor_name, p);
		}
	}

	const byCategory: CategoryStat[] = [...catMap.entries()]
		.map(([category, count]) => ({ category, count }))
		.sort((a, b) => b.count - a.count);

	const byOutcome = [...outcomeMap.entries()]
		.map(([outcome, count]) => ({ outcome, count }))
		.sort((a, b) => b.count - a.count);

	const byProvider = [...providerMap.entries()]
		.map(([doctor_name, stats]) => ({ doctor_name, ...stats }))
		.sort((a, b) => b.total - a.total);

	return { total, byCategory, byOutcome, byProvider };
}

export async function getPatientSummary(patientId: string): Promise<import('../types').PatientSummary> {
	const conn = await getDb();
	const [timelineRows, recentEntries, planRows, documentRows, perioRows, conditionRows, acuteTagRows, medicalTagRows] = await Promise.all([
		conn.select<[{ count: number }]>(
			`SELECT COUNT(*) as count FROM timeline_entries WHERE patient_id = $1 AND entry_type != 'document'`,
			[patientId],
		),
		conn.select<import('../types').PatientSummaryEntry[]>(
			`SELECT id, entry_date, title, entry_type, treatment_category FROM timeline_entries WHERE patient_id = $1 AND entry_type != 'document' ORDER BY entry_date DESC, id DESC LIMIT 4`,
			[patientId],
		),
		conn.select<[{ total: number; active: number }]>(
			`SELECT COUNT(*) as total, SUM(CASE WHEN status IN ('active','draft') THEN 1 ELSE 0 END) as active FROM treatment_plans WHERE patient_id = $1`,
			[patientId],
		),
		conn.select<[{ count: number }]>(
			`SELECT COUNT(*) as count FROM documents WHERE patient_id = $1`,
			[patientId],
		),
		conn.select<[{ count: number; last_date: string | null }]>(
			`SELECT COUNT(*) as count, MAX(exam_date) as last_date FROM probing_records WHERE patient_id = $1`,
			[patientId],
		),
		conn.select<[{ count: number }]>(
			`SELECT COUNT(*) as count FROM patient_conditions WHERE patient_id = $1 AND is_active = 1`,
			[patientId],
		),
		conn.select<{ tag: string }[]>(`SELECT tag FROM patient_acute_tags WHERE patient_id = $1`, [patientId]),
		conn.select<{ tag: string }[]>(`SELECT tag FROM patient_medical_tags WHERE patient_id = $1`, [patientId]),
	]);
	return {
		timelineCount: timelineRows[0]?.count ?? 0,
		recentEntries,
		planCount: planRows[0]?.total ?? 0,
		activePlanCount: planRows[0]?.active ?? 0,
		documentCount: documentRows[0]?.count ?? 0,
		perioExamCount: perioRows[0]?.count ?? 0,
		lastPerioDate: perioRows[0]?.last_date ?? null,
		activeConditionCount: conditionRows[0]?.count ?? 0,
		acuteTags: acuteTagRows.map(r => r.tag),
		medicalTags: medicalTagRows.map(r => r.tag),
	};
}

export async function getProviderOutcomeStats(filters?: AnalyticsFilters): Promise<{ doctor_name: string; total: number; successful: number; retreated: number; failed: number }[]> {
	const conn = await getDb();
	const params: unknown[] = [];
	const clauses: string[] = ["te.entry_type = 'procedure'", "te.treatment_outcome != ''"];
	let idx = 1;

	if (filters?.dateFrom) {
		clauses.push(`te.entry_date >= $${idx}`);
		params.push(filters.dateFrom);
		idx++;
	}
	if (filters?.dateTo) {
		clauses.push(`te.entry_date <= $${idx}`);
		params.push(filters.dateTo);
		idx++;
	}
	if (filters?.doctorId) {
		clauses.push(`te.doctor_id = $${idx}`);
		params.push(filters.doctorId);
		idx++;
	}

	const whereClause = `WHERE ${clauses.join(' AND ')}`;

	return conn.select<{ doctor_name: string; total: number; successful: number; retreated: number; failed: number }[]>(
		`SELECT COALESCE(d.name, 'Unassigned') as doctor_name,
		        COUNT(*) as total,
		        SUM(CASE WHEN te.treatment_outcome = 'successful' THEN 1 ELSE 0 END) as successful,
		        SUM(CASE WHEN te.treatment_outcome = 'retreated' THEN 1 ELSE 0 END) as retreated,
		        SUM(CASE WHEN te.treatment_outcome IN ('failed_extracted', 'failed_other') THEN 1 ELSE 0 END) as failed
		 FROM timeline_entries te
		 LEFT JOIN doctors d ON te.doctor_id = d.id
		 ${whereClause}
		 GROUP BY COALESCE(d.name, 'Unassigned')
		 ORDER BY total DESC`,
		params,
	);
}

/** Patients served, total entries, and new patients registered in a date range */
export async function getActivityStats(from: string, to: string): Promise<{
	patients_served: number;
	entries_count: number;
	new_patients: number;
}> {
	const conn = await getDb();
	const [activityRows, newRows] = await Promise.all([
		conn.select<{ patients_served: number; entries_count: number }[]>(
			`SELECT COUNT(DISTINCT patient_id) as patients_served,
			        COUNT(*) as entries_count
			 FROM timeline_entries
			 WHERE entry_date BETWEEN $1 AND $2
			   AND entry_type NOT IN ('document', 'plan', 'chart_snapshot')`,
			[from, to],
		),
		conn.select<{ new_patients: number }[]>(
			`SELECT COUNT(*) as new_patients FROM patients WHERE date(created_at) BETWEEN $1 AND $2`,
			[from, to],
		),
	]);
	return {
		patients_served: activityRows[0]?.patients_served ?? 0,
		entries_count:   activityRows[0]?.entries_count   ?? 0,
		new_patients:    newRows[0]?.new_patients          ?? 0,
	};
}

/** Per-doctor: unique patients served + total entries in a date range */
export async function getDoctorActivityStats(from: string, to: string): Promise<Array<{
	doctor_name: string;
	doctor_color: string;
	patients_served: number;
	entries_count: number;
}>> {
	const conn = await getDb();
	return conn.select(
		`SELECT d.name  as doctor_name,
		        d.color as doctor_color,
		        COUNT(DISTINCT te.patient_id) as patients_served,
		        COUNT(te.id)                  as entries_count
		 FROM doctors d
		 JOIN timeline_entries te ON te.doctor_id = d.id
		   AND te.entry_date BETWEEN $1 AND $2
		   AND te.entry_type NOT IN ('document', 'plan', 'chart_snapshot')
		 GROUP BY d.id, d.name, d.color
		 ORDER BY entries_count DESC`,
		[from, to],
	);
}

// ─── Appointment Period Stats ─────────────────────────────────────────────────

/** Total / completed / cancelled / no_show + avg duration for a date range */
export async function getAppointmentPeriodStats(from: string, to: string): Promise<{
	total: number;
	completed: number;
	cancelled: number;
	no_show: number;
	avg_duration_min: number;
}> {
	const conn = await getDb();
	const rows = await conn.select<{ total: number; completed: number; cancelled: number; no_show: number; avg_duration_min: number }[]>(
		`SELECT COUNT(*) as total,
		        COALESCE(SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END), 0) as completed,
		        COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END), 0) as cancelled,
		        COALESCE(SUM(CASE WHEN status='no_show'   THEN 1 ELSE 0 END), 0) as no_show,
		        COALESCE(ROUND(AVG(duration_min), 1), 0) as avg_duration_min
		 FROM appointments
		 WHERE date(start_time) BETWEEN $1 AND $2`,
		[from, to],
	);
	return rows[0] ?? { total: 0, completed: 0, cancelled: 0, no_show: 0, avg_duration_min: 0 };
}

/** Appointment count grouped by day_of_week (0=Sun…6=Sat) and hour, for heatmap */
export async function getAppointmentHeatmap(from: string, to: string): Promise<Array<{
	day_of_week: number;
	hour: number;
	count: number;
}>> {
	const conn = await getDb();
	return conn.select(
		`SELECT CAST(strftime('%w', start_time) AS INTEGER) as day_of_week,
		        CAST(strftime('%H', start_time) AS INTEGER) as hour,
		        COUNT(*) as count
		 FROM appointments
		 WHERE date(start_time) BETWEEN $1 AND $2
		   AND status != 'cancelled'
		 GROUP BY day_of_week, hour
		 ORDER BY day_of_week, hour`,
		[from, to],
	);
}

/** Patient demographics: avg age, age buckets, gender counts, referral source counts */
export async function getPatientDemographics(): Promise<{
	avg_age: number | null;
	age_buckets: Array<{ label: string; count: number }>;
	gender_counts: Array<{ gender: string; count: number }>;
	referral_counts: Array<{ source: string; count: number }>;
}> {
	const conn = await getDb();
	const DOB_FILTER = `dob != '' AND dob IS NOT NULL AND length(dob) >= 8`;
	const [ageRows, bucketRows, genderRows, referralRows] = await Promise.all([
		conn.select<{ avg_age: number | null }[]>(
			`SELECT ROUND(AVG(CAST((julianday('now') - julianday(dob)) / 365.25 AS INTEGER)), 1) as avg_age
			 FROM patients WHERE ${DOB_FILTER}`,
			[],
		),
		conn.select<{ label: string; sort_key: number; count: number }[]>(
			`SELECT
			   CASE WHEN age < 18 THEN '0–17'
			        WHEN age < 36 THEN '18–35'
			        WHEN age < 51 THEN '36–50'
			        WHEN age < 65 THEN '51–64'
			        ELSE '65+' END as label,
			   CASE WHEN age < 18 THEN 0 WHEN age < 36 THEN 1 WHEN age < 51 THEN 2 WHEN age < 65 THEN 3 ELSE 4 END as sort_key,
			   COUNT(*) as count
			 FROM (SELECT CAST((julianday('now') - julianday(dob)) / 365.25 AS INTEGER) as age
			       FROM patients WHERE ${DOB_FILTER})
			 GROUP BY label, sort_key ORDER BY sort_key`,
			[],
		),
		conn.select<{ gender: string; count: number }[]>(
			`SELECT COALESCE(NULLIF(gender,''), 'unknown') as gender, COUNT(*) as count
			 FROM patients GROUP BY gender ORDER BY count DESC`,
			[],
		),
		conn.select<{ source: string; count: number }[]>(
			`SELECT COALESCE(NULLIF(referral_source,''), 'unknown') as source, COUNT(*) as count
			 FROM patients GROUP BY referral_source ORDER BY count DESC LIMIT 8`,
			[],
		),
	]);
	return {
		avg_age: ageRows[0]?.avg_age ?? null,
		age_buckets: bucketRows.map(({ label, count }) => ({ label, count })),
		gender_counts: genderRows,
		referral_counts: referralRows,
	};
}

// ─── Appointment Rooms ────────────────────────────────────────────────────────

export async function getAppointmentRooms(): Promise<AppointmentRoom[]> {
	const conn = await getDb();
	return conn.select<AppointmentRoom[]>('SELECT * FROM appointment_rooms ORDER BY sort_order, name', []);
}

export async function getActiveRooms(): Promise<AppointmentRoom[]> {
	const conn = await getDb();
	return conn.select<AppointmentRoom[]>('SELECT * FROM appointment_rooms WHERE is_active=1 ORDER BY sort_order, name', []);
}

export async function insertAppointmentRoom(data: AppointmentRoomFormData): Promise<AppointmentRoom> {
	const conn = await getDb();
	const id = crypto.randomUUID();
	await conn.execute(
		'INSERT INTO appointment_rooms (id, name, short_name, color, sort_order, is_active) VALUES ($1, $2, $3, $4, $5, $6)',
		[id, data.name, data.short_name, data.color, data.sort_order, data.is_active ? 1 : 0],
	);
	const rows = await conn.select<AppointmentRoom[]>('SELECT * FROM appointment_rooms WHERE id=$1', [id]);
	return rows[0];
}

export async function updateAppointmentRoom(id: string, data: Partial<AppointmentRoomFormData>): Promise<void> {
	const conn = await getDb();
	const fields: string[] = [];
	const values: unknown[] = [];
	let i = 1;
	if (data.name !== undefined) { fields.push(`name=$${i++}`); values.push(data.name); }
	if (data.short_name !== undefined) { fields.push(`short_name=$${i++}`); values.push(data.short_name); }
	if (data.color !== undefined) { fields.push(`color=$${i++}`); values.push(data.color); }
	if (data.sort_order !== undefined) { fields.push(`sort_order=$${i++}`); values.push(data.sort_order); }
	if (data.is_active !== undefined) { fields.push(`is_active=$${i++}`); values.push(data.is_active ? 1 : 0); }
	if (fields.length === 0) return;
	values.push(id);
	await conn.execute(`UPDATE appointment_rooms SET ${fields.join(', ')} WHERE id=$${i}`, values);
}

export async function deleteAppointmentRoom(id: string): Promise<void> {
	const conn = await getDb();
	await conn.execute('UPDATE appointment_rooms SET is_active=0 WHERE id=$1', [id]);
}

// ─── Appointment Types ────────────────────────────────────────────────────────

export async function getAppointmentTypes(): Promise<AppointmentType[]> {
	const conn = await getDb();
	return conn.select<AppointmentType[]>('SELECT * FROM appointment_types ORDER BY sort_order, name', []);
}

export async function getActiveTypes(): Promise<AppointmentType[]> {
	const conn = await getDb();
	return conn.select<AppointmentType[]>('SELECT * FROM appointment_types WHERE is_active=1 ORDER BY sort_order, name', []);
}

export async function insertAppointmentType(data: AppointmentTypeFormData): Promise<AppointmentType> {
	const conn = await getDb();
	const id = crypto.randomUUID();
	await conn.execute(
		'INSERT INTO appointment_types (id, name, short_name, default_duration_min, color, treatment_category, sort_order, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
		[id, data.name, data.short_name, data.default_duration_min, data.color, data.treatment_category, data.sort_order, data.is_active ? 1 : 0],
	);
	const rows = await conn.select<AppointmentType[]>('SELECT * FROM appointment_types WHERE id=$1', [id]);
	return rows[0];
}

export async function updateAppointmentType(id: string, data: Partial<AppointmentTypeFormData>): Promise<void> {
	const conn = await getDb();
	const fields: string[] = [];
	const values: unknown[] = [];
	let i = 1;
	if (data.name !== undefined) { fields.push(`name=$${i++}`); values.push(data.name); }
	if (data.short_name !== undefined) { fields.push(`short_name=$${i++}`); values.push(data.short_name); }
	if (data.default_duration_min !== undefined) { fields.push(`default_duration_min=$${i++}`); values.push(data.default_duration_min); }
	if (data.color !== undefined) { fields.push(`color=$${i++}`); values.push(data.color); }
	if (data.treatment_category !== undefined) { fields.push(`treatment_category=$${i++}`); values.push(data.treatment_category); }
	if (data.sort_order !== undefined) { fields.push(`sort_order=$${i++}`); values.push(data.sort_order); }
	if (data.is_active !== undefined) { fields.push(`is_active=$${i++}`); values.push(data.is_active ? 1 : 0); }
	if (fields.length === 0) return;
	values.push(id);
	await conn.execute(`UPDATE appointment_types SET ${fields.join(', ')} WHERE id=$${i}`, values);
}

export async function deleteAppointmentType(id: string): Promise<void> {
	const conn = await getDb();
	await conn.execute('UPDATE appointment_types SET is_active=0 WHERE id=$1', [id]);
}

// ─── Appointments ─────────────────────────────────────────────────────────────

const APPOINTMENT_JOIN = `
  SELECT a.*,
    p.firstname AS patient_firstname, p.lastname AS patient_lastname,
    d.name AS doctor_name,
    at.name AS type_name, at.color AS type_color, at.short_name AS type_short_name,
    ar.name AS room_name, ar.color AS room_color
  FROM appointments a
  LEFT JOIN patients p ON a.patient_id = p.patient_id
  LEFT JOIN doctors d ON a.doctor_id = d.id
  LEFT JOIN appointment_types at ON a.type_id = at.id
  LEFT JOIN appointment_rooms ar ON a.room_id = ar.id
`;

export async function getAppointmentsForDate(date: string): Promise<Appointment[]> {
	const conn = await getDb();
	return conn.select<Appointment[]>(
		`${APPOINTMENT_JOIN} WHERE date(a.start_time) = date($1) ORDER BY a.start_time`,
		[date],
	);
}

export async function getAppointmentsForPatient(patientId: string): Promise<Appointment[]> {
	const conn = await getDb();
	return conn.select<Appointment[]>(
		`${APPOINTMENT_JOIN} WHERE a.patient_id = $1 ORDER BY a.start_time DESC`,
		[patientId],
	);
}

export async function insertAppointment(data: AppointmentFormData & { patient_id: string }): Promise<Appointment> {
	const conn = await getDb();
	const id = crypto.randomUUID();
	const now = new Date().toISOString();
	await conn.execute(
		`INSERT INTO appointments (id, patient_id, doctor_id, room_id, type_id, start_time, end_time, duration_min, title, notes, status, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
		[
			id, data.patient_id,
			data.doctor_id || null,
			data.room_id,
			data.type_id || null,
			data.start_time, data.end_time, data.duration_min,
			data.title || null, data.notes || null,
			data.status, now, now,
		],
	);
	const rows = await conn.select<Appointment[]>(`${APPOINTMENT_JOIN} WHERE a.id=$1`, [id]);
	return rows[0];
}

export async function updateAppointment(id: string, data: Partial<AppointmentFormData>): Promise<void> {
	const conn = await getDb();
	const fields: string[] = [];
	const values: unknown[] = [];
	let i = 1;
	if (data.patient_id !== undefined) { fields.push(`patient_id=$${i++}`); values.push(data.patient_id); }
	if (data.doctor_id !== undefined) { fields.push(`doctor_id=$${i++}`); values.push(data.doctor_id || null); }
	if (data.room_id !== undefined) { fields.push(`room_id=$${i++}`); values.push(data.room_id); }
	if (data.type_id !== undefined) { fields.push(`type_id=$${i++}`); values.push(data.type_id || null); }
	if (data.start_time !== undefined) { fields.push(`start_time=$${i++}`); values.push(data.start_time); }
	if (data.end_time !== undefined) { fields.push(`end_time=$${i++}`); values.push(data.end_time); }
	if (data.duration_min !== undefined) { fields.push(`duration_min=$${i++}`); values.push(data.duration_min); }
	if (data.title !== undefined) { fields.push(`title=$${i++}`); values.push(data.title || null); }
	if (data.notes !== undefined) { fields.push(`notes=$${i++}`); values.push(data.notes || null); }
	if (data.status !== undefined) {
		fields.push(`status=$${i++}`);
		values.push(data.status);
		fields.push(`cancelled_at = CASE WHEN $${i} = 'cancelled' AND cancelled_at IS NULL THEN datetime('now') ELSE cancelled_at END`);
		values.push(data.status);
		i++;
		fields.push(`no_show_recorded_at = CASE WHEN $${i} = 'no_show' AND no_show_recorded_at IS NULL THEN datetime('now') ELSE no_show_recorded_at END`);
		values.push(data.status);
		i++;
	}
	if (fields.length === 0) return;
	fields.push(`updated_at=$${i++}`);
	values.push(new Date().toISOString());
	values.push(id);
	await conn.execute(`UPDATE appointments SET ${fields.join(', ')} WHERE id=$${i}`, values);
}

export async function deleteAppointment(id: string): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM appointments WHERE id=$1', [id]);
}

export async function updateAppointmentStatus(id: string, status: AppointmentStatus): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		'UPDATE appointments SET status=$1, updated_at=$2 WHERE id=$3',
		[status, new Date().toISOString(), id],
	);
}

/**
 * When a timeline entry is saved with a specific entry type (appointment type name),
 * find any scheduled appointment for that patient on the same date and update its
 * type_id to match + link timeline_entry_id. Returns true if an appointment was synced.
 */
export async function syncAppointmentFromTimelineEntry(
	patientId: string,
	entryDate: string,
	entryId: string,
	entryTypeName: string,
): Promise<boolean> {
	if (!entryTypeName) return false;
	const conn = await getDb();
	// Look up appointment type by name
	const types = await conn.select<{ id: string }[]>(
		`SELECT id FROM appointment_types WHERE name=$1 AND is_active=1 LIMIT 1`,
		[entryTypeName],
	);
	if (types.length === 0) return false;
	const typeId = types[0].id;
	// Find a non-cancelled/no-show appointment for this patient on this date
	const appts = await conn.select<{ id: string }[]>(
		`SELECT id FROM appointments
		 WHERE patient_id=$1 AND date(start_time)=date($2)
		   AND status NOT IN ('cancelled','no_show')
		 ORDER BY start_time
		 LIMIT 1`,
		[patientId, entryDate],
	);
	if (appts.length === 0) return false;
	await conn.execute(
		`UPDATE appointments SET type_id=$1, timeline_entry_id=$2, updated_at=$3 WHERE id=$4`,
		[typeId, entryId, new Date().toISOString(), appts[0].id],
	);
	return true;
}

// ── Schedule Blocks ──────────────────────────────────────────────────────

export async function getScheduleBlocksForDate(date: string): Promise<ScheduleBlock[]> {
	const db = await getDb();
	const dateStart = `${date}T00:00:00`;
	const dateEnd = `${date}T23:59:59`;
	return await db.select<ScheduleBlock[]>(
		`SELECT sb.*, d.name AS doctor_name, r.name AS room_name
		 FROM schedule_blocks sb
		 LEFT JOIN doctors d ON sb.doctor_id = d.id
		 LEFT JOIN appointment_rooms r ON sb.room_id = r.id
		 WHERE sb.start_time <= $1 AND sb.end_time > $2
		    OR (sb.start_time >= $3 AND sb.start_time <= $4)
		 ORDER BY sb.start_time`,
		[dateEnd, dateStart, dateStart, dateEnd]
	);
}

export async function insertScheduleBlock(data: ScheduleBlockFormData): Promise<void> {
	const db = await getDb();
	const id = crypto.randomUUID();
	await db.execute(
		`INSERT INTO schedule_blocks (id, room_id, doctor_id, title, start_time, end_time, color, notes)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		[id, data.room_id, data.doctor_id || null, data.title, data.start_time, data.end_time, data.color, data.notes || null]
	);
}

export async function updateScheduleBlock(id: string, data: ScheduleBlockFormData): Promise<void> {
	const db = await getDb();
	await db.execute(
		`UPDATE schedule_blocks SET room_id=$1, doctor_id=$2, title=$3, start_time=$4, end_time=$5, color=$6, notes=$7, updated_at=datetime('now') WHERE id=$8`,
		[data.room_id, data.doctor_id || null, data.title, data.start_time, data.end_time, data.color, data.notes || null, id]
	);
}

export async function deleteScheduleBlock(id: string): Promise<void> {
	const db = await getDb();
	await db.execute(`DELETE FROM schedule_blocks WHERE id = $1`, [id]);
}

// ── Staff Blockouts ──────────────────────────────────────────────────────

export async function getStaffBlockoutsForDate(date: string): Promise<StaffBlockout[]> {
	const db = await getDb();
	return await db.select<StaffBlockout[]>(
		`SELECT sb.*, d.name AS doctor_name, d.color AS doctor_color
		 FROM staff_blockouts sb
		 JOIN doctors d ON sb.doctor_id = d.id
		 WHERE $1 BETWEEN sb.start_date AND sb.end_date
		 ORDER BY sb.start_date`,
		[date]
	);
}

export async function getStaffBlockoutsForRange(start: string, end: string): Promise<StaffBlockout[]> {
	const db = await getDb();
	return await db.select<StaffBlockout[]>(
		`SELECT sb.*, d.name AS doctor_name, d.color AS doctor_color
		 FROM staff_blockouts sb
		 JOIN doctors d ON sb.doctor_id = d.id
		 WHERE sb.start_date <= $1 AND sb.end_date >= $2
		 ORDER BY sb.start_date`,
		[end, start]
	);
}

export async function getAllStaffBlockouts(): Promise<StaffBlockout[]> {
	const db = await getDb();
	return await db.select<StaffBlockout[]>(
		`SELECT sb.*, d.name AS doctor_name, d.color AS doctor_color
		 FROM staff_blockouts sb
		 JOIN doctors d ON sb.doctor_id = d.id
		 ORDER BY sb.start_date DESC`,
		[]
	);
}

export async function insertStaffBlockout(data: StaffBlockoutFormData): Promise<void> {
	const db = await getDb();
	const id = crypto.randomUUID();
	await db.execute(
		`INSERT INTO staff_blockouts (id, doctor_id, start_date, end_date, start_time, end_time, is_all_day, reason, notes, color)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		[id, data.doctor_id, data.start_date, data.end_date, data.start_time || null, data.end_time || null, data.is_all_day ? 1 : 0, data.reason, data.notes || null, data.color]
	);
}

export async function updateStaffBlockout(id: string, data: StaffBlockoutFormData): Promise<void> {
	const db = await getDb();
	await db.execute(
		`UPDATE staff_blockouts SET doctor_id=$1, start_date=$2, end_date=$3, start_time=$4, end_time=$5, is_all_day=$6, reason=$7, notes=$8, color=$9 WHERE id=$10`,
		[data.doctor_id, data.start_date, data.end_date, data.start_time || null, data.end_time || null, data.is_all_day ? 1 : 0, data.reason, data.notes || null, data.color, id]
	);
}

export async function deleteStaffBlockout(id: string): Promise<void> {
	const db = await getDb();
	await db.execute(`DELETE FROM staff_blockouts WHERE id = $1`, [id]);
}

// ── Doctor Working Hours ─────────────────────────────────────────────────

export async function getDoctorWorkingHours(doctorId: string): Promise<DoctorWorkingHours[]> {
	const db = await getDb();
	return await db.select<DoctorWorkingHours[]>(
		`SELECT * FROM doctor_working_hours WHERE doctor_id = $1 ORDER BY day_of_week`,
		[doctorId]
	);
}

export async function upsertDoctorWorkingHours(doctorId: string, hours: DoctorWorkingHoursFormData[]): Promise<void> {
	const db = await getDb();
	await db.execute(`DELETE FROM doctor_working_hours WHERE doctor_id = $1`, [doctorId]);
	for (const h of hours) {
		const id = crypto.randomUUID();
		await db.execute(
			`INSERT INTO doctor_working_hours (id, doctor_id, day_of_week, start_time, end_time, break_start, break_end, is_active)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[id, doctorId, h.day_of_week, h.start_time, h.end_time, h.break_start || null, h.break_end || null, h.is_active ? 1 : 0]
		);
	}
}

export async function getStaffPresenceForDay(dayOfWeek: number): Promise<import('../types').StaffPresenceInfo[]> {
	const db = await getDb();
	return await db.select(
		`SELECT d.id as doctor_id, d.name, d.color,
		 dwh.start_time, dwh.end_time, dwh.break_start, dwh.break_end
		 FROM doctors d
		 JOIN doctor_working_hours dwh ON dwh.doctor_id = d.id
		 WHERE dwh.day_of_week = $1 AND dwh.is_active = 1
		 ORDER BY d.name`,
		[dayOfWeek]
	);
}

// ── Staff Analytics ──────────────────────────────────────────────────────

export async function getAbsenceStatsByYear(year: number): Promise<AbsenceStat[]> {
	const db = await getDb();
	return await db.select<AbsenceStat[]>(
		`SELECT
		   d.id AS doctor_id,
		   d.name AS doctor_name,
		   d.color AS doctor_color,
		   COALESCE(SUM(CASE WHEN sb.reason = 'vacation'   THEN CAST(julianday(MIN(sb.end_date, $1 || '-12-31')) - julianday(MAX(sb.start_date, $1 || '-01-01')) + 1 AS INTEGER) ELSE 0 END), 0) AS vacation_days,
		   COALESCE(SUM(CASE WHEN sb.reason = 'sick'       THEN CAST(julianday(MIN(sb.end_date, $1 || '-12-31')) - julianday(MAX(sb.start_date, $1 || '-01-01')) + 1 AS INTEGER) ELSE 0 END), 0) AS sick_days,
		   COALESCE(SUM(CASE WHEN sb.reason = 'conference' THEN CAST(julianday(MIN(sb.end_date, $1 || '-12-31')) - julianday(MAX(sb.start_date, $1 || '-01-01')) + 1 AS INTEGER) ELSE 0 END), 0) AS conference_days,
		   COALESCE(SUM(CASE WHEN sb.reason = 'training'   THEN CAST(julianday(MIN(sb.end_date, $1 || '-12-31')) - julianday(MAX(sb.start_date, $1 || '-01-01')) + 1 AS INTEGER) ELSE 0 END), 0) AS training_days,
		   COALESCE(SUM(CASE WHEN sb.reason = 'other'      THEN CAST(julianday(MIN(sb.end_date, $1 || '-12-31')) - julianday(MAX(sb.start_date, $1 || '-01-01')) + 1 AS INTEGER) ELSE 0 END), 0) AS other_days
		 FROM doctors d
		 LEFT JOIN staff_blockouts sb ON sb.doctor_id = d.id
		   AND sb.start_date <= $1 || '-12-31'
		   AND sb.end_date >= $1 || '-01-01'
		 GROUP BY d.id, d.name, d.color
		 ORDER BY d.name`,
		[String(year)]
	);
}

export async function getAppointmentStatsByDoctor(dateFrom: string, dateTo: string): Promise<AppointmentDoctorStat[]> {
	const db = await getDb();
	return await db.select<AppointmentDoctorStat[]>(
		`SELECT
		   d.id AS doctor_id,
		   d.name AS doctor_name,
		   d.color AS doctor_color,
		   COUNT(a.id) AS total,
		   COALESCE(SUM(CASE WHEN a.status = 'completed'  THEN 1 ELSE 0 END), 0) AS completed,
		   COALESCE(SUM(CASE WHEN a.status = 'cancelled'  THEN 1 ELSE 0 END), 0) AS cancelled,
		   COALESCE(SUM(CASE WHEN a.status = 'no_show'    THEN 1 ELSE 0 END), 0) AS no_show,
		   COALESCE(SUM(CASE WHEN a.status = 'scheduled'  THEN 1 ELSE 0 END), 0) AS scheduled,
		   COALESCE(ROUND(AVG(a.duration_min), 1), 0) AS avg_duration_min
		 FROM doctors d
		 LEFT JOIN appointments a ON a.doctor_id = d.id
		   AND a.start_time >= $1 || 'T00:00:00'
		   AND a.start_time <= $2 || 'T23:59:59'
		 GROUP BY d.id, d.name, d.color
		 ORDER BY d.name`,
		[dateFrom, dateTo]
	);
}

/** Count unique patients scheduled today and during the current calendar week (Mon–Sun). */
export async function getPatientVisitCounts(today: string): Promise<{ today: number; week: number }> {
	const db = await getDb();
	// Compute Monday of the current week
	const d = new Date(today);
	const dow = d.getDay(); // 0=Sun
	const diffToMon = dow === 0 ? -6 : 1 - dow;
	const mon = new Date(d);
	mon.setDate(d.getDate() + diffToMon);
	const sun = new Date(mon);
	sun.setDate(mon.getDate() + 6);
	const weekStart = mon.toISOString().slice(0, 10);
	const weekEnd = sun.toISOString().slice(0, 10);
	const rows = await db.select<{ today: number; week: number }[]>(
		`SELECT
		  COUNT(DISTINCT CASE WHEN date(a.start_time) = date($1) THEN a.patient_id END) AS today,
		  COUNT(DISTINCT CASE WHEN date(a.start_time) BETWEEN $2 AND $3 THEN a.patient_id END) AS week
		 FROM appointments a
		 WHERE a.status NOT IN ('cancelled', 'no_show')`,
		[today, weekStart, weekEnd]
	);
	return rows[0] ?? { today: 0, week: 0 };
}

export async function getAbsencesByDoctorAndYear(doctorId: string, year: number): Promise<StaffBlockout[]> {
	const db = await getDb();
	return await db.select<StaffBlockout[]>(
		`SELECT sb.*, d.name AS doctor_name, d.color AS doctor_color
		 FROM staff_blockouts sb
		 JOIN doctors d ON sb.doctor_id = d.id
		 WHERE sb.doctor_id = $1
		   AND sb.start_date <= $2 || '-12-31'
		   AND sb.end_date >= $2 || '-01-01'
		 ORDER BY sb.start_date`,
		[doctorId, String(year)]
	);
}
