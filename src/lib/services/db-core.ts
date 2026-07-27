import { appendAuditRecord } from '$lib/services/audit';
import { getDb } from './db-connection';
import { isValidEntryTooth, syncEntryTeeth } from './db-local';
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
	PatientDocument,
	PatientDocumentFormData,
	PatientStatusCounts,
	CategoryStat,
	OutcomeStat,
	SuccessRateStat,
	RecentEntry,
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
	AppointmentRoom,
	AppointmentRoomFormData,
	AppointmentType,
	AppointmentTypeFormData,
	Appointment,
	AppointmentFormData,
	AppointmentStatus,
	PatientAppointmentStats,
	DoctorTreatmentStat,
	DoctorPerformanceKPI,
	DoctorMonthlyTrend,
	DoctorDowStat,
	ScheduleBlock,
	ScheduleBlockFormData,
	StaffBlockout,
	StaffBlockoutFormData,
	DoctorWorkingHours,
	DoctorWorkingHoursFormData,
	AbsenceStat,
	AppointmentDoctorStat,
} from '$lib/types';

// ── Patient ID generation ──────────────────────────────────────────────

export function generatePatientId(): string {
	return 'PT-' + Date.now().toString(36).toUpperCase();
}

/** Current local date-time as "YYYY-MM-DD HH:MM:SS" (local clock, not UTC —
 *  late-evening entries must not roll over to the next day). */
function nowISO(): string {
	const d = new Date();
	const p = (n: number) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
		  blood_group, primary_physician, marital_status, allergies, medications, risk_flags,
		  created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)`,
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
			data.allergies ?? '[]',
			data.medications ?? '[]',
			data.risk_flags ?? '[]',
			now,
			now,
		],
	);

	const rows = await conn.select<Patient[]>('SELECT * FROM patients WHERE patient_id = $1', [
		patientId,
	]);
	return rows[0];
}

const UPCOMING_APPOINTMENT_SUBQUERY = `
	(SELECT MIN(a.start_time) FROM appointments a
	  WHERE a.patient_id = p.patient_id
	    AND a.start_time >= datetime('now','localtime')
	    AND a.status NOT IN ('cancelled','no_show')) AS upcoming_appointment`;

export async function getAllPatients(): Promise<Patient[]> {
	const conn = await getDb();
	return conn.select<Patient[]>(
		`SELECT p.*, ${UPCOMING_APPOINTMENT_SUBQUERY}
		 FROM patients p WHERE status != 'archived' ORDER BY lastname ASC, firstname ASC`,
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
	const rows = await conn.select<Patient[]>(
		`SELECT p.*, ${UPCOMING_APPOINTMENT_SUBQUERY} FROM patients p WHERE patient_id = $1`,
		[patientId],
	);
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
		if (value === undefined) continue;
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
				if (v === undefined) continue;
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

	// Explicitly clean up tables that have no FK to patients (would otherwise
	// leave orphaned rows behind and pollute statistics).
	const orphanTables = [
		'patient_misc_notes',
		'patient_acute_text',
		'patient_medical_text',
		'patient_acute_tags',
		'patient_medical_tags',
		'patient_conditions',
		'kig_findings',
		'dental_chart_history',
	];
	for (const table of orphanTables) {
		await conn.execute(`DELETE FROM ${table} WHERE patient_id = $1`, [patientId]).catch(() => {});
	}

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
	const prefixPattern = `${query}%`;
	const archivedClause = includeArchived ? '' : "AND status != 'archived'";
	return conn.select<Patient[]>(
		`SELECT p.*, ${UPCOMING_APPOINTMENT_SUBQUERY}
		 FROM patients p
		 WHERE (firstname LIKE $1 OR lastname LIKE $1 OR patient_id LIKE $1
		   OR phone LIKE $1 OR email LIKE $1
		   OR (firstname || ' ' || lastname) LIKE $1
		   OR (lastname  || ' ' || firstname) LIKE $1
		   OR (lastname  || ', ' || firstname) LIKE $1)
		 ${archivedClause}
		 ORDER BY CASE WHEN lastname LIKE $2 THEN 0 WHEN firstname LIKE $2 THEN 1 ELSE 2 END,
		          lastname ASC, firstname ASC`,
		[pattern, prefixPattern],
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
	if (!newRow) throw new Error('Failed to insert timeline entry');
	await syncEntryTeeth(conn, newRow.id, data.tooth_numbers ?? '');
	return newRow;
}

/** Delete all timeline entries linked to a document (used when the document is deleted). */
export async function deleteTimelineEntriesByDocumentId(documentId: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM timeline_entries WHERE document_id = $1', [documentId]);
}

/** Keep the mirrored "document" timeline entry's title in sync after a rename. */
export async function updateTimelineEntryTitleByDocumentId(documentId: number, title: string): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	await conn.execute(
		'UPDATE timeline_entries SET title = $1, updated_at = $2 WHERE document_id = $3',
		[title, now, documentId],
	);
}

export async function getTimelineEntries(
	patientId: string,
	options?: { type?: string; limit?: number; offset?: number },
): Promise<TimelineEntry[]> {
	const conn = await getDb();
	const typeClause = options?.type ? `AND entry_type = $2` : '';
	// SQLite requires LIMIT when OFFSET is used — LIMIT -1 means "no limit"
	const limitClause = options?.limit ? `LIMIT ${options.limit}` : options?.offset ? 'LIMIT -1' : '';
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

/**
 * Find the patient's existing X-ray report entry for a given source image.
 * `chart_data` for `xray_report` entries is JSON `{ source, pdf, text }` — the
 * match is done by parsing each row's JSON in JS (never LIKE on serialized
 * fields per DATA_INTEGRITY). Returns null if no report exists for the image.
 */
export async function getXrayReportEntryForSource(
	patientId: string,
	sourceRelPath: string,
): Promise<TimelineEntry | null> {
	const conn = await getDb();
	const rows = await conn.select<TimelineEntry[]>(
		`SELECT * FROM timeline_entries
		 WHERE patient_id = $1 AND entry_type = $2
		 ORDER BY id DESC`,
		[patientId, 'xray_report'],
	);
	for (const row of rows) {
		try {
			const data = JSON.parse(row.chart_data || '{}') as { source?: string };
			if (data?.source === sourceRelPath) return row;
		} catch {
			// malformed chart_data — skip row
		}
	}
	return null;
}

/**
 * Find the patient's existing facial-analysis entry for a given source image.
 * `chart_data` for `facial_analysis` entries is JSON `FacialAnalysisChartData` —
 * the match is done by parsing each row's JSON in JS (never LIKE on serialized
 * fields per DATA_INTEGRITY). Returns null if no analysis exists for the image.
 */
export async function getFacialAnalysisEntryForSource(
	patientId: string,
	sourceRelPath: string,
): Promise<TimelineEntry | null> {
	const conn = await getDb();
	const rows = await conn.select<TimelineEntry[]>(
		`SELECT * FROM timeline_entries
		 WHERE patient_id = $1 AND entry_type = $2
		 ORDER BY id DESC`,
		[patientId, 'facial_analysis'],
	);
	for (const row of rows) {
		try {
			const data = JSON.parse(row.chart_data || '{}') as { source?: string };
			if (data?.source === sourceRelPath) return row;
		} catch {
			// malformed chart_data — skip row
		}
	}
	return null;
}

export async function getPriorProceduresForTooth(
	patientId: string,
	toothNumbers: string,
	beforeDate?: string,
	excludeEntryId?: number,
): Promise<TimelineEntry[]> {
	const conn = await getDb();
	// tooth_numbers strings are stored with ", " separators (entry bar / form),
	// so LIKE matching on the raw column misses everything after the first tooth.
	// The entry_teeth junction table is synced on every insert/update — query it instead.
	const teeth = toothNumbers
		.split(',')
		.map(t => parseInt(t.trim(), 10))
		.filter(n => !isNaN(n) && isValidEntryTooth(n));
	if (teeth.length === 0) return [];

	const params: unknown[] = [patientId];
	let idx = 2;

	const toothPlaceholders = teeth.map(() => `$${idx++}`);
	params.push(...teeth);

	let sql = `SELECT * FROM timeline_entries
	 WHERE patient_id = $1
	   AND entry_type NOT IN ('document', 'plan', 'chart_snapshot', 'ortho_snapshot')
	   AND id IN (SELECT entry_id FROM entry_teeth WHERE tooth_number IN (${toothPlaceholders.join(', ')}))`;

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

/** Column defaults for timeline_entries text columns — used to normalize
 *  `undefined` form values to '' instead of writing SQL NULL (which would
 *  break UI code that assumes non-null strings, e.g. description.length). */
const TIMELINE_TEXT_COLUMNS = new Set([
	'provider', 'tooth_numbers', 'description', 'treatment_category',
	'treatment_outcome', 'plan_id', 'chart_data', 'colleague_ids',
]);

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
		let v = value;
		if (v === undefined) {
			if (TIMELINE_TEXT_COLUMNS.has(key)) v = '';
			else if (key === 'attachments') v = '[]';
			else v = null;
		}
		values.push(v);
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
	// ('in' check so an explicit clear (undefined → '') also clears the junction rows)
	if ('tooth_numbers' in data) {
		await syncEntryTeeth(conn, id, data.tooth_numbers ?? '');
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

	// Create a linked timeline entry so plan creation shows in the timeline
	const entryDate = now.slice(0, 10);
	await conn.execute(
		`INSERT INTO timeline_entries
		  (patient_id, entry_date, entry_type, title, provider, tooth_numbers, description,
		   treatment_category, treatment_outcome, related_entry_id, attachments, document_id,
		   plan_id, chart_data, is_locked, doctor_id, colleague_ids, created_at, updated_at)
		 VALUES ($1, $2, 'plan', $3, '', '', '', '', '', NULL, '[]', NULL, $4, '', 0, NULL, '', $5, $5)`,
		[patientId, entryDate, data.title, planId, now],
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

	// Keep the linked plan timeline entry title in sync if title changed
	if ('title' in data && data.title) {
		await conn.execute(
			`UPDATE timeline_entries SET title = $1, updated_at = $2 WHERE plan_id = $3 AND entry_type = 'plan'`,
			[data.title, now, planId],
		).catch(() => {});
	}
}

export async function deleteTreatmentPlan(planId: string): Promise<void> {
	const conn = await getDb();

	// Read before deleting (for audit)
	const rows = await conn.select<TreatmentPlan[]>('SELECT * FROM treatment_plans WHERE plan_id = $1', [planId]);
	const before = rows[0] ?? null;

	await conn.execute('DELETE FROM treatment_plans WHERE plan_id = $1', [planId]);

	if (before) {
		// Remove the linked plan timeline entry
		await conn.execute(
			`DELETE FROM timeline_entries WHERE patient_id = $1 AND plan_id = $2 AND entry_type = 'plan'`,
			[before.patient_id, planId],
		).catch(() => {});

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

// ── Therapy Plan Chart Data ────────────────────────────────────────────

export async function updatePlanChartData(planId: string, chartDataJson: string): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	await conn.execute(
		'UPDATE treatment_plans SET plan_chart_data = $1, updated_at = $2 WHERE plan_id = $3',
		[chartDataJson, now, planId],
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
			`INSERT INTO dental_chart (patient_id, tooth_number, condition, surfaces, notes, last_examined, bridge_group_id, bridge_role, abutment_type, prosthesis_type, root_data, shade, watch_status, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
				data.root_data ?? '{}',
				data.shade ?? null,
				data.watch_status ?? null,
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
	data: Partial<Pick<PatientDocument, 'category' | 'notes' | 'original_name'>>,
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

/**
 * Repoint a patient's document paths after their vault folder was renamed.
 * Folder names embed the patient ID, so a prefix collision inside the same
 * path is not a realistic risk.
 */
export async function updateDocumentPathsForPatient(
	patientId: string,
	oldFolder: string,
	newFolder: string,
): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		`UPDATE documents SET rel_path = REPLACE(rel_path, $1, $2), abs_path = REPLACE(abs_path, $1, $2) WHERE patient_id = $3`,
		[oldFolder, newFolder, patientId],
	);
}

/**
 * Repoint a single document's path after it was moved within the vault (sidebar
 * drag-to-reorganize between category/sub- folders). Also repoints the vault-relative
 * path inside any timeline entry's `attachments` JSON that references this document —
 * attachments are a JSON blob on the entry, not a queryable column, so they don't follow
 * documents.rel_path automatically. Without this, the next auto-track pass would see the
 * file as "new" at its new path and log a spurious "document added" entry for what was
 * only a move — moving files must never touch the timeline.
 */
export async function moveDocumentPath(id: number, newRelPath: string, newAbsPath: string): Promise<void> {
	const conn = await getDb();
	const rows = await conn.select<{ rel_path: string }[]>('SELECT rel_path FROM documents WHERE id = $1', [id]);
	const oldRelPath = rows[0]?.rel_path;
	await conn.execute('UPDATE documents SET rel_path = $1, abs_path = $2 WHERE id = $3', [newRelPath, newAbsPath, id]);
	if (oldRelPath && oldRelPath !== newRelPath) {
		await conn.execute(
			'UPDATE timeline_entries SET attachments = REPLACE(attachments, $1, $2) WHERE document_id = $3',
			[oldRelPath, newRelPath, id],
		);
	}
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

export async function getCategoryStats(): Promise<CategoryStat[]> {
	const conn = await getDb();
	return conn.select<CategoryStat[]>(
		`SELECT treatment_category as category, COUNT(*) as count
		 FROM timeline_entries
		 WHERE entry_type NOT IN ('document', 'plan', 'chart_snapshot', 'ortho_snapshot') AND treatment_category != ''
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
		 WHERE entry_type NOT IN ('document', 'plan', 'chart_snapshot', 'ortho_snapshot')
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
		 WHERE entry_type NOT IN ('document', 'plan', 'chart_snapshot', 'ortho_snapshot')
		   AND treatment_outcome NOT IN ('', 'unknown', 'ongoing')`,
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

export async function getUpcomingAppointments(limit = 10): Promise<import('../types').UpcomingAppointment[]> {
	const conn = await getDb();
	// Reads the real scheduler (appointments table) — the legacy
	// patients.next_appointment text field is no longer consulted.
	return conn.select<import('../types').UpcomingAppointment[]>(
		`SELECT a.patient_id, p.firstname, p.lastname,
		        a.start_time AS next_appointment
		 FROM appointments a
		 JOIN patients p ON a.patient_id = p.patient_id
		 WHERE a.start_time >= datetime('now', 'localtime')
		   AND a.status NOT IN ('cancelled', 'no_show')
		   AND p.status != 'archived'
		 ORDER BY a.start_time ASC
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
	const today = nowISO().slice(0, 10);
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

/** Remove history rows tied to a snapshot entry (used when a same-day snapshot is replaced). */
export async function deleteChartHistoryForSnapshot(snapshotEntryId: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM dental_chart_history WHERE snapshot_entry_id = $1', [snapshotEntryId]);
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

	// Read-merge-write: only fields explicitly provided are changed.
	// (The previous ON CONFLICT version reset bleeding/plaque to 0 on every
	// partial update and made it impossible to clear a value back to NULL.)
	const existing = await conn.select<ProbingMeasurement[]>(
		'SELECT * FROM probing_measurements WHERE record_id = $1 AND tooth_number = $2 AND site = $3',
		[recordId, toothNumber, site],
	);
	const cur = existing[0];
	const merged = {
		pocket_depth: data.pocket_depth !== undefined ? data.pocket_depth : (cur?.pocket_depth ?? null),
		bleeding_on_probing: data.bleeding_on_probing !== undefined ? data.bleeding_on_probing : (cur?.bleeding_on_probing ?? 0),
		recession: data.recession !== undefined ? data.recession : (cur?.recession ?? null),
		plaque: data.plaque !== undefined ? data.plaque : (cur?.plaque ?? 0),
	};

	if (cur) {
		await conn.execute(
			`UPDATE probing_measurements SET pocket_depth = $1, bleeding_on_probing = $2, recession = $3, plaque = $4 WHERE id = $5`,
			[merged.pocket_depth, merged.bleeding_on_probing, merged.recession, merged.plaque, cur.id],
		);
	} else {
		await conn.execute(
			`INSERT INTO probing_measurements (record_id, tooth_number, site, pocket_depth, bleeding_on_probing, recession, plaque)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			[recordId, toothNumber, site, merged.pocket_depth, merged.bleeding_on_probing, merged.recession, merged.plaque],
		);
	}
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

	// Read-merge-write: only fields explicitly provided are changed.
	// (The previous ON CONFLICT version overwrote notes on every partial update
	// and made it impossible to clear mobility/furcation back to NULL.)
	const existing = await conn.select<ProbingToothData[]>(
		'SELECT * FROM probing_tooth_data WHERE record_id = $1 AND tooth_number = $2',
		[recordId, toothNumber],
	);
	const cur = existing[0];
	const merged = {
		mobility: data.mobility !== undefined ? data.mobility : (cur?.mobility ?? null),
		furcation: data.furcation !== undefined ? data.furcation : (cur?.furcation ?? null),
		furcation_sites: data.furcation_sites !== undefined ? data.furcation_sites : (cur?.furcation_sites ?? ''),
		notes: data.notes !== undefined ? data.notes : (cur?.notes ?? ''),
	};

	if (cur) {
		await conn.execute(
			`UPDATE probing_tooth_data SET mobility = $1, furcation = $2, furcation_sites = $3, notes = $4 WHERE id = $5`,
			[merged.mobility, merged.furcation, merged.furcation_sites, merged.notes, cur.id],
		);
	} else {
		await conn.execute(
			`INSERT INTO probing_tooth_data (record_id, tooth_number, mobility, furcation, furcation_sites, notes)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			[recordId, toothNumber, merged.mobility, merged.furcation, merged.furcation_sites, merged.notes],
		);
	}
}

export async function getProbingToothData(recordId: number): Promise<ProbingToothData[]> {
	const conn = await getDb();
	return conn.select<ProbingToothData[]>(
		'SELECT * FROM probing_tooth_data WHERE record_id = $1',
		[recordId],
	);
}

export async function getProviderOutcomeStats(filters?: AnalyticsFilters): Promise<{ doctor_name: string; total: number; successful: number; retreated: number; failed: number; final_total: number }[]> {
	const conn = await getDb();
	const params: unknown[] = [];
	const clauses: string[] = ["te.entry_type NOT IN ('document', 'plan', 'chart_snapshot', 'ortho_snapshot')", "te.treatment_outcome != ''"];
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

	return conn.select<{ doctor_name: string; total: number; successful: number; retreated: number; failed: number; final_total: number }[]>(
		`SELECT COALESCE(d.name, 'Unassigned') as doctor_name,
		        COUNT(*) as total,
		        SUM(CASE WHEN te.treatment_outcome = 'successful' THEN 1 ELSE 0 END) as successful,
		        SUM(CASE WHEN te.treatment_outcome = 'retreated' THEN 1 ELSE 0 END) as retreated,
		        SUM(CASE WHEN te.treatment_outcome IN ('failed_extracted', 'failed_other') THEN 1 ELSE 0 END) as failed,
		        SUM(CASE WHEN te.treatment_outcome IN ('successful','retreated','failed_extracted','failed_other')
		            THEN 1 ELSE 0 END) as final_total
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
			   AND entry_type NOT IN ('document', 'plan', 'chart_snapshot', 'ortho_snapshot')`,
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
		   AND te.entry_type NOT IN ('document', 'plan', 'chart_snapshot', 'ortho_snapshot')
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

/** Daily activity buckets for sparkline rendering (entries_count, patients_served, new_patients per date) */
export async function getActivityTimeSeries(from: string, to: string): Promise<Array<{
	date: string;
	patients_served: number;
	entries_count: number;
	new_patients: number;
}>> {
	const conn = await getDb();
	const [actRows, patRows] = await Promise.all([
		conn.select<{ date: string; patients_served: number; entries_count: number }[]>(
			`SELECT date(entry_date) as date,
			        COUNT(DISTINCT patient_id) as patients_served,
			        COUNT(*) as entries_count
			 FROM timeline_entries
			 WHERE entry_date BETWEEN $1 AND $2
			   AND entry_type NOT IN ('document', 'plan', 'chart_snapshot', 'ortho_snapshot')
			 GROUP BY date(entry_date)
			 ORDER BY date`,
			[from, to],
		),
		conn.select<{ date: string; new_patients: number }[]>(
			`SELECT date(created_at) as date, COUNT(*) as new_patients
			 FROM patients
			 WHERE date(created_at) BETWEEN $1 AND $2
			 GROUP BY date(created_at)
			 ORDER BY date`,
			[from, to],
		),
	]);
	const map = new Map<string, { patients_served: number; entries_count: number; new_patients: number }>();
	for (const r of actRows) map.set(r.date, { patients_served: r.patients_served, entries_count: r.entries_count, new_patients: 0 });
	for (const r of patRows) {
		const e = map.get(r.date);
		if (e) e.new_patients = r.new_patients;
		else map.set(r.date, { patients_served: 0, entries_count: 0, new_patients: r.new_patients });
	}
	return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, ...v }));
}

/** Appointments for a given day-of-week (0=Sun…6=Sat) and optional hour within a date range */
export async function getAppointmentsForSlot(
	dayOfWeek: number,
	hour: number | null,
	from: string,
	to: string,
): Promise<Array<{
	id: string;
	patient_id: string;
	patient_name: string;
	doctor_name: string;
	type_name: string;
	start_time: string;
	duration_min: number;
	status: string;
}>> {
	const conn = await getDb();
	const hourClause = hour !== null ? `AND CAST(strftime('%H', a.start_time) AS INTEGER) = $4` : '';
	const params: (string | number)[] = hour !== null ? [from, to, dayOfWeek, hour] : [from, to, dayOfWeek];
	return conn.select(
		`SELECT a.id, a.patient_id,
		        (p.firstname || ' ' || p.lastname) as patient_name,
		        COALESCE(d.name, '') as doctor_name,
		        COALESCE(at.name, a.title, '') as type_name,
		        a.start_time, a.duration_min, a.status
		 FROM appointments a
		 JOIN patients p ON a.patient_id = p.patient_id
		 LEFT JOIN doctors d ON a.doctor_id = d.id
		 LEFT JOIN appointment_types at ON a.type_id = at.id
		 WHERE date(a.start_time) BETWEEN $1 AND $2
		   AND CAST(strftime('%w', a.start_time) AS INTEGER) = $3
		   ${hourClause}
		   AND a.status != 'cancelled'
		 ORDER BY a.start_time
		 LIMIT 100`,
		params,
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

export async function insertAppointmentType(data: AppointmentTypeFormData): Promise<AppointmentType> {
	const conn = await getDb();
	const id = crypto.randomUUID();
	await conn.execute(
		'INSERT INTO appointment_types (id, name, short_name, default_duration_min, color, icon, treatment_category, sort_order, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
		[id, data.name, data.short_name, data.default_duration_min, data.color, data.icon ?? '', data.treatment_category, data.sort_order, data.is_active ? 1 : 0],
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
	if (data.icon !== undefined) { fields.push(`icon=$${i++}`); values.push(data.icon); }
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
    at.name AS type_name, at.color AS type_color, at.short_name AS type_short_name, at.icon AS type_icon,
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
	// Temporal columns are first-time-only: once written they are never overwritten
	// by later status changes, preserving the first-observed timestamp.
	await conn.execute(
		`UPDATE appointments SET status=$1, updated_at=$2,
		  arrival_time = CASE WHEN $1 IN ('waiting', 'in_chair') AND arrival_time IS NULL THEN $2 ELSE arrival_time END,
		  treatment_start_time = CASE WHEN $1 = 'in_chair' AND treatment_start_time IS NULL THEN $2 ELSE treatment_start_time END,
		  cancelled_at = CASE WHEN $1 = 'cancelled' AND cancelled_at IS NULL THEN datetime('now') ELSE cancelled_at END,
		  no_show_recorded_at = CASE WHEN $1 = 'no_show' AND no_show_recorded_at IS NULL THEN datetime('now') ELSE no_show_recorded_at END
		 WHERE id=$3`,
		[status, new Date().toISOString(), id],
	);
}

/** Aggregated punctuality / wait / duration statistics over a patient's past appointments. */
export async function getPatientAppointmentStats(patientId: string): Promise<PatientAppointmentStats> {
	const conn = await getDb();
	const rows = await conn.select<PatientAppointmentStats[]>(
		`SELECT
			COUNT(*) AS total,
			SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
			SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS no_show_count,
			SUM(CASE WHEN arrival_time IS NOT NULL THEN 1 ELSE 0 END) AS tracked_count,
			AVG(CASE
				WHEN arrival_time IS NOT NULL
				THEN (strftime('%s', arrival_time) - strftime('%s', start_time)) / 60.0
				ELSE NULL
			END) AS avg_minutes_offset,
			AVG(CASE
				WHEN arrival_time IS NOT NULL AND treatment_start_time IS NOT NULL
				THEN (strftime('%s', treatment_start_time) - strftime('%s', arrival_time)) / 60.0
				ELSE NULL
			END) AS avg_wait_minutes,
			AVG(CASE
				WHEN treatment_start_time IS NOT NULL AND treatment_end_time IS NOT NULL
				THEN (strftime('%s', treatment_end_time) - strftime('%s', treatment_start_time)) / 60.0
				ELSE NULL
			END) AS avg_actual_duration_min,
			AVG(CASE
				WHEN treatment_start_time IS NOT NULL AND treatment_end_time IS NOT NULL
				THEN (strftime('%s', treatment_end_time) - strftime('%s', treatment_start_time)) / 60.0 - duration_min
				ELSE NULL
			END) AS avg_duration_deviation
		FROM appointments
		WHERE patient_id = $1 AND start_time < datetime('now')`,
		[patientId],
	);
	return rows[0] ?? {
		total: 0, cancelled_count: 0, no_show_count: 0, tracked_count: 0,
		avg_minutes_offset: null, avg_wait_minutes: null, avg_actual_duration_min: null, avg_duration_deviation: null,
	};
}

/**
 * Per-appointment-type treatment time breakdown for a doctor.
 * Only counts appointments that have both treatment_start_time and treatment_end_time.
 */
export async function getDoctorTreatmentStats(
	doctorId: string,
	dateFrom: string,
	dateTo: string,
): Promise<DoctorTreatmentStat[]> {
	const conn = await getDb();
	return conn.select<DoctorTreatmentStat[]>(
		`SELECT
			a.type_id,
			at.name AS type_name,
			at.color AS type_color,
			COUNT(*) AS appointment_count,
			ROUND(AVG(a.duration_min), 1) AS avg_planned_duration,
			ROUND(AVG(CASE
				WHEN a.treatment_start_time IS NOT NULL AND a.treatment_end_time IS NOT NULL
				THEN (strftime('%s', a.treatment_end_time) - strftime('%s', a.treatment_start_time)) / 60.0
				ELSE NULL
			END), 1) AS avg_actual_duration,
			ROUND(AVG(CASE
				WHEN a.treatment_start_time IS NOT NULL AND a.treatment_end_time IS NOT NULL
				THEN (strftime('%s', a.treatment_end_time) - strftime('%s', a.treatment_start_time)) / 60.0 - a.duration_min
				ELSE NULL
			END), 1) AS avg_deviation
		FROM appointments a
		LEFT JOIN appointment_types at ON a.type_id = at.id
		WHERE a.doctor_id = $1
			AND a.start_time >= $2 || 'T00:00:00'
			AND a.start_time <= $3 || 'T23:59:59'
			AND a.treatment_end_time IS NOT NULL
		GROUP BY a.type_id
		ORDER BY appointment_count DESC`,
		[doctorId, dateFrom, dateTo],
	);
}

/** Full performance KPIs for a specific doctor over a date range. */
export async function getDoctorPerformanceKPI(
	doctorId: string,
	dateFrom: string,
	dateTo: string,
): Promise<DoctorPerformanceKPI | null> {
	const conn = await getDb();
	const rows = await conn.select<DoctorPerformanceKPI[]>(
		`SELECT
		   d.id AS doctor_id, d.name AS doctor_name, d.color AS doctor_color,
		   COUNT(a.id) AS total,
		   COALESCE(SUM(CASE WHEN a.status='completed'  THEN 1 ELSE 0 END), 0) AS completed,
		   COALESCE(SUM(CASE WHEN a.status='cancelled'  THEN 1 ELSE 0 END), 0) AS cancelled,
		   COALESCE(SUM(CASE WHEN a.status='no_show'    THEN 1 ELSE 0 END), 0) AS no_show,
		   COUNT(DISTINCT date(a.start_time)) AS working_days,
		   ROUND(AVG(a.duration_min), 1) AS avg_planned_duration,
		   ROUND(AVG(CASE
		     WHEN a.treatment_start_time IS NOT NULL AND a.treatment_end_time IS NOT NULL
		     THEN (strftime('%s', a.treatment_end_time) - strftime('%s', a.treatment_start_time)) / 60.0
		     ELSE NULL END), 1) AS avg_actual_duration,
		   ROUND(AVG(CASE
		     WHEN a.treatment_start_time IS NOT NULL AND a.treatment_end_time IS NOT NULL
		     THEN (strftime('%s', a.treatment_end_time) - strftime('%s', a.treatment_start_time)) / 60.0 - a.duration_min
		     ELSE NULL END), 1) AS avg_deviation
		 FROM doctors d
		 LEFT JOIN appointments a ON a.doctor_id = d.id
		   AND a.start_time >= $2 || 'T00:00:00'
		   AND a.start_time <= $3 || 'T23:59:59'
		 WHERE d.id = $1
		 GROUP BY d.id, d.name, d.color`,
		[doctorId, dateFrom, dateTo],
	);
	return rows[0] ?? null;
}

/** Full performance KPIs for all doctors over a date range. */
export async function getAllDoctorKPIs(
	dateFrom: string,
	dateTo: string,
): Promise<DoctorPerformanceKPI[]> {
	const conn = await getDb();
	return conn.select<DoctorPerformanceKPI[]>(
		`SELECT
		   d.id AS doctor_id, d.name AS doctor_name, d.color AS doctor_color,
		   COUNT(a.id) AS total,
		   COALESCE(SUM(CASE WHEN a.status='completed'  THEN 1 ELSE 0 END), 0) AS completed,
		   COALESCE(SUM(CASE WHEN a.status='cancelled'  THEN 1 ELSE 0 END), 0) AS cancelled,
		   COALESCE(SUM(CASE WHEN a.status='no_show'    THEN 1 ELSE 0 END), 0) AS no_show,
		   COUNT(DISTINCT date(a.start_time)) AS working_days,
		   ROUND(AVG(a.duration_min), 1) AS avg_planned_duration,
		   ROUND(AVG(CASE
		     WHEN a.treatment_start_time IS NOT NULL AND a.treatment_end_time IS NOT NULL
		     THEN (strftime('%s', a.treatment_end_time) - strftime('%s', a.treatment_start_time)) / 60.0
		     ELSE NULL END), 1) AS avg_actual_duration,
		   ROUND(AVG(CASE
		     WHEN a.treatment_start_time IS NOT NULL AND a.treatment_end_time IS NOT NULL
		     THEN (strftime('%s', a.treatment_end_time) - strftime('%s', a.treatment_start_time)) / 60.0 - a.duration_min
		     ELSE NULL END), 1) AS avg_deviation
		 FROM doctors d
		 LEFT JOIN appointments a ON a.doctor_id = d.id
		   AND a.start_time >= $1 || 'T00:00:00'
		   AND a.start_time <= $2 || 'T23:59:59'
		 GROUP BY d.id, d.name, d.color
		 ORDER BY d.name`,
		[dateFrom, dateTo],
	);
}

/** Month-by-month appointment trend for a doctor over a date range. */
export async function getDoctorMonthlyTrend(
	doctorId: string,
	dateFrom: string,
	dateTo: string,
): Promise<DoctorMonthlyTrend[]> {
	const conn = await getDb();
	return conn.select<DoctorMonthlyTrend[]>(
		`SELECT
		   strftime('%Y-%m', start_time) AS month,
		   COUNT(*) AS total,
		   SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
		   SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) AS cancelled,
		   SUM(CASE WHEN status='no_show'   THEN 1 ELSE 0 END) AS no_show
		 FROM appointments
		 WHERE doctor_id = $1
		   AND start_time >= $2 || 'T00:00:00'
		   AND start_time <= $3 || 'T23:59:59'
		 GROUP BY month
		 ORDER BY month`,
		[doctorId, dateFrom, dateTo],
	);
}

/** Day-of-week appointment distribution for a doctor over a date range. */
export async function getDoctorDowDistribution(
	doctorId: string,
	dateFrom: string,
	dateTo: string,
): Promise<DoctorDowStat[]> {
	const conn = await getDb();
	return conn.select<DoctorDowStat[]>(
		`SELECT
		   CAST(strftime('%w', start_time) AS INTEGER) AS dow,
		   COUNT(*) AS count
		 FROM appointments
		 WHERE doctor_id = $1
		   AND start_time >= $2 || 'T00:00:00'
		   AND start_time <= $3 || 'T23:59:59'
		   AND status NOT IN ('cancelled', 'no_show')
		 GROUP BY dow
		 ORDER BY dow`,
		[doctorId, dateFrom, dateTo],
	);
}

/**
 * When a timeline entry is saved with a specific entry type (appointment type name),
 * find the matching appointment for that patient on the same date and:
 * - Link it via timeline_entry_id + sync type_id
 * - If treatment was actively tracked (treatment_start_time set), record treatment_end_time = NOW()
 * - If a doctorId is provided and the appointment has no doctor yet, assign it
 * Returns true if an appointment was synced.
 */
export async function syncAppointmentFromTimelineEntry(
	patientId: string,
	entryDate: string,
	entryId: string,
	entryTypeName: string,
	doctorId?: string | null,
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
	const appt = appts[0];
	const now = new Date().toISOString();
	await conn.execute(
		`UPDATE appointments SET
		   type_id=$1, timeline_entry_id=$2, updated_at=$3,
		   treatment_end_time = CASE WHEN treatment_start_time IS NOT NULL AND treatment_end_time IS NULL THEN $3 ELSE treatment_end_time END,
		   doctor_id = COALESCE(doctor_id, $4)
		 WHERE id=$5`,
		[typeId, entryId, now, doctorId ?? null, appt.id],
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
	const pad = (n: number) => String(n).padStart(2, '0');
	const localDate = (x: Date) => `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
	const weekStart = localDate(mon);
	const weekEnd = localDate(sun);
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

// ── Endo Documentation CRUD ────────────────────────────────────────────

export async function getEndoRecords(patientId: string, toothNumber: number): Promise<import('$lib/types').EndoRecord[]> {
	const conn = await getDb();
	const records = await conn.select<{ id: number; patient_id: string; tooth_number: number; treatment_date: string; notes: string; created_at: string }[]>(
		'SELECT * FROM endo_records WHERE patient_id = $1 AND tooth_number = $2 ORDER BY treatment_date DESC, id DESC',
		[patientId, toothNumber],
	);
	const result: import('$lib/types').EndoRecord[] = [];
	for (const rec of records) {
		const canals = await conn.select<import('$lib/types').EndoCanal[]>(
			'SELECT * FROM endo_canals WHERE record_id = $1 ORDER BY id',
			[rec.id],
		);
		result.push({ ...rec, canals });
	}
	return result;
}

export async function saveEndoRecord(
	patientId: string,
	toothNumber: number,
	date: string,
	notes: string,
	canals: import('$lib/types').EndoCanal[],
	recordId?: number,
): Promise<number> {
	const conn = await getDb();
	const now = nowISO();
	let id: number;
	if (recordId) {
		await conn.execute(
			'UPDATE endo_records SET treatment_date = $1, notes = $2 WHERE id = $3',
			[date, notes, recordId],
		);
		id = recordId;
	} else {
		const res = await conn.execute(
			'INSERT INTO endo_records (patient_id, tooth_number, treatment_date, notes, created_at) VALUES ($1, $2, $3, $4, $5)',
			[patientId, toothNumber, date, notes, now],
		);
		id = res.lastInsertId as number;
	}
	await conn.execute('DELETE FROM endo_canals WHERE record_id = $1', [id]);
	for (const c of canals) {
		await conn.execute(
			`INSERT INTO endo_canals (record_id, canal_name, instrument, iso_size, length_xray, length_preparation, length_electronic, reference_point, definitive_length)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			[id, c.canal_name, c.instrument || '', c.iso_size ?? null, c.length_xray ?? null, c.length_preparation ?? null, c.length_electronic ?? null, c.reference_point || '', c.definitive_length ?? null],
		);
	}
	return id;
}

export async function deleteEndoRecord(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM endo_records WHERE id = $1', [id]);
}

export async function getAllEndoRecordsForPatient(patientId: string): Promise<import('$lib/types').EndoRecord[]> {
	const conn = await getDb();
	const records = await conn.select<{ id: number; patient_id: string; tooth_number: number; treatment_date: string; notes: string; created_at: string }[]>(
		'SELECT * FROM endo_records WHERE patient_id = $1 ORDER BY tooth_number, treatment_date DESC',
		[patientId],
	);
	const result: import('$lib/types').EndoRecord[] = [];
	for (const rec of records) {
		const canals = await conn.select<import('$lib/types').EndoCanal[]>(
			'SELECT * FROM endo_canals WHERE record_id = $1 ORDER BY id',
			[rec.id],
		);
		result.push({ ...rec, canals });
	}
	return result;
}

// ── Tooth Notes CRUD ───────────────────────────────────────────────────

export async function getToothNotes(patientId: string, toothNumber: number): Promise<import('$lib/types').ToothNote[]> {
	const conn = await getDb();
	return conn.select<import('$lib/types').ToothNote[]>(
		'SELECT * FROM tooth_notes WHERE patient_id = $1 AND tooth_number = $2 ORDER BY created_at DESC',
		[patientId, toothNumber],
	);
}

export async function saveToothNote(
	patientId: string,
	toothNumber: number,
	text: string,
	reminderDate: string | null,
	noteId?: number,
): Promise<number> {
	const conn = await getDb();
	const now = nowISO();
	if (noteId) {
		await conn.execute(
			'UPDATE tooth_notes SET text = $1, reminder_date = $2, updated_at = $3 WHERE id = $4',
			[text, reminderDate ?? null, now, noteId],
		);
		return noteId;
	}
	const res = await conn.execute(
		'INSERT INTO tooth_notes (patient_id, tooth_number, text, reminder_date, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
		[patientId, toothNumber, text, reminderDate ?? null, now, now],
	);
	return res.lastInsertId as number;
}

export async function deleteToothNote(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM tooth_notes WHERE id = $1', [id]);
}

export async function getAllToothNotesForPatient(patientId: string): Promise<import('$lib/types').ToothNote[]> {
	const conn = await getDb();
	return conn.select<import('$lib/types').ToothNote[]>(
		'SELECT * FROM tooth_notes WHERE patient_id = $1 ORDER BY tooth_number, created_at DESC',
		[patientId],
	);
}

export async function getTeethWithNotes(patientId: string): Promise<Set<number>> {
	const conn = await getDb();
	const rows = await conn.select<{ tooth_number: number }[]>(
		'SELECT DISTINCT tooth_number FROM tooth_notes WHERE patient_id = $1',
		[patientId],
	);
	return new Set(rows.map(r => r.tooth_number));
}

export async function getTeethWithDueReminders(patientId: string, today: string): Promise<Set<number>> {
	const conn = await getDb();
	const rows = await conn.select<{ tooth_number: number }[]>(
		'SELECT DISTINCT tooth_number FROM tooth_notes WHERE patient_id = $1 AND reminder_date IS NOT NULL AND reminder_date <= $2',
		[patientId, today],
	);
	return new Set(rows.map(r => r.tooth_number));
}

// ── PAR Cases ──────────────────────────────────────────────────────────────

export async function getParCases(patientId: string): Promise<import('$lib/types').ParCase[]> {
	const conn = await getDb();
	const rows = await conn.select<import('$lib/types').ParCase[]>(
		'SELECT * FROM par_cases WHERE patient_id = $1 ORDER BY created_at DESC',
		[patientId],
	);
	return rows.map(r => ({
		...r,
		sgb22: Boolean(r.sgb22),
		is_transfer: Boolean(r.is_transfer),
	}));
}

export async function createParCase(
	patientId: string,
	data: {
		plan_type?: 'kasse' | 'privat';
		grade?: 'A' | 'B' | 'C' | null;
		sgb22?: boolean;
		is_transfer?: boolean;
		transfer_from?: string;
		transfer_step?: string | null;
		transfer_upt?: number | null;
		doctor_id?: number | null;
	},
): Promise<number> {
	const conn = await getDb();
	const now = nowISO();
	const res = await conn.execute(
		`INSERT INTO par_cases (patient_id, plan_type, status, grade, sgb22, is_transfer, transfer_from, transfer_step, transfer_upt, doctor_id, created_at, updated_at)
		 VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
		[
			patientId,
			data.plan_type ?? 'kasse',
			data.grade ?? null,
			data.sgb22 ? 1 : 0,
			data.is_transfer ? 1 : 0,
			data.transfer_from ?? '',
			data.transfer_step ?? null,
			data.transfer_upt ?? null,
			data.doctor_id ?? null,
			now,
		],
	);
	return res.lastInsertId as number;
}

export async function updateParCase(
	id: number,
	patch: Partial<{
		plan_type: 'kasse' | 'privat';
		status: 'active' | 'completed' | 'ended';
		grade: 'A' | 'B' | 'C' | null;
		sgb22: boolean;
		is_transfer: boolean;
		transfer_from: string;
		transfer_step: string | null;
		transfer_upt: number | null;
		end_date: string | null;
		doctor_id: number | null;
	}>,
): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	const sets: string[] = ['updated_at = $1'];
	const vals: unknown[] = [now];
	let i = 2;
	const add = (col: string, val: unknown) => { sets.push(`${col} = $${i++}`); vals.push(val); };
	if (patch.plan_type    !== undefined) add('plan_type',    patch.plan_type);
	if (patch.status       !== undefined) add('status',       patch.status);
	if (patch.grade        !== undefined) add('grade',        patch.grade);
	if (patch.sgb22        !== undefined) add('sgb22',        patch.sgb22 ? 1 : 0);
	if (patch.is_transfer  !== undefined) add('is_transfer',  patch.is_transfer ? 1 : 0);
	if (patch.transfer_from !== undefined) add('transfer_from', patch.transfer_from);
	if (patch.transfer_step !== undefined) add('transfer_step', patch.transfer_step);
	if (patch.transfer_upt  !== undefined) add('transfer_upt',  patch.transfer_upt);
	if (patch.end_date      !== undefined) add('end_date',      patch.end_date);
	if (patch.doctor_id     !== undefined) add('doctor_id',     patch.doctor_id);
	vals.push(id);
	await conn.execute(`UPDATE par_cases SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

export async function deleteParCase(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM par_cases WHERE id = $1', [id]);
}

// ── PAR Assessments ────────────────────────────────────────────────────────

export async function getParAssessments(caseId: number): Promise<import('$lib/types').ParAssessment[]> {
	const conn = await getDb();
	const rows = await conn.select<import('$lib/types').ParAssessment[]>(
		'SELECT * FROM par_assessments WHERE case_id = $1 ORDER BY exam_date ASC, created_at ASC',
		[caseId],
	);
	return rows.map(r => ({
		...r,
		is_referral: Boolean(r.is_referral),
		locked: Boolean(r.locked),
	}));
}

export async function getParAssessment(id: number): Promise<import('$lib/types').ParAssessment | null> {
	const conn = await getDb();
	const rows = await conn.select<import('$lib/types').ParAssessment[]>(
		'SELECT * FROM par_assessments WHERE id = $1',
		[id],
	);
	if (!rows[0]) return null;
	const r = rows[0];
	return { ...r, is_referral: Boolean(r.is_referral), locked: Boolean(r.locked) };
}

export async function createParAssessment(
	caseId: number,
	data: {
		type: string;
		sequence?: number;
		exam_date: string;
		doctor_id?: number | null;
		start_date?: string | null;
		end_date?: string | null;
		notes?: string;
	},
): Promise<number> {
	const conn = await getDb();
	const now = nowISO();
	const res = await conn.execute(
		`INSERT INTO par_assessments (case_id, type, sequence, exam_date, doctor_id, start_date, end_date, notes, locked, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, $9, $9)`,
		[
			caseId,
			data.type,
			data.sequence ?? 1,
			data.exam_date,
			data.doctor_id ?? null,
			data.start_date ?? null,
			data.end_date ?? null,
			data.notes ?? '',
			now,
		],
	);
	return res.lastInsertId as number;
}

export async function updateParAssessment(
	id: number,
	patch: Partial<{
		exam_date: string;
		doctor_id: number | null;
		start_date: string | null;
		end_date: string | null;
		approval_date: string | null;
		is_referral: boolean;
		notes: string;
		locked: boolean;
	}>,
): Promise<void> {
	const conn = await getDb();
	const now = nowISO();
	const sets: string[] = ['updated_at = $1'];
	const vals: unknown[] = [now];
	let i = 2;
	const add = (col: string, val: unknown) => { sets.push(`${col} = $${i++}`); vals.push(val); };
	if (patch.exam_date     !== undefined) add('exam_date',     patch.exam_date);
	if (patch.doctor_id     !== undefined) add('doctor_id',     patch.doctor_id);
	if (patch.start_date    !== undefined) add('start_date',    patch.start_date);
	if (patch.end_date      !== undefined) add('end_date',      patch.end_date);
	if (patch.approval_date !== undefined) add('approval_date', patch.approval_date);
	if (patch.is_referral   !== undefined) add('is_referral',   patch.is_referral ? 1 : 0);
	if (patch.notes         !== undefined) add('notes',         patch.notes);
	if (patch.locked        !== undefined) add('locked',        patch.locked ? 1 : 0);
	vals.push(id);
	await conn.execute(`UPDATE par_assessments SET ${sets.join(', ')} WHERE id = $${i}`, vals);
}

export async function deleteParAssessment(id: number): Promise<void> {
	const conn = await getDb();
	await conn.execute('DELETE FROM par_assessments WHERE id = $1', [id]);
}

export async function lockParCaseAssessments(caseId: number): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		'UPDATE par_assessments SET locked = 1, updated_at = $1 WHERE case_id = $2',
		[nowISO(), caseId],
	);
}

// ── PAR Measurements ─────────────────────────────────────────────────────────

export async function getParMeasurements(assessmentId: number): Promise<import('$lib/types').ParMeasurement[]> {
	const conn = await getDb();
	const rows = await conn.select<any[]>(
		'SELECT * FROM par_measurements WHERE assessment_id = $1 ORDER BY tooth, site',
		[assessmentId],
	);
	return rows.map(r => ({
		id: r.id, assessment_id: r.assessment_id, tooth: r.tooth, site: r.site as import('$lib/types').ParSite,
		pocket: r.pocket, recession: r.recession, bop: r.bop as import('$lib/types').ParBopState, plaque: r.plaque,
	}));
}

export async function bulkUpsertParMeasurements(
	assessmentId: number,
	rows: Omit<import('$lib/types').ParMeasurement, 'id' | 'assessment_id'>[],
): Promise<void> {
	const conn = await getDb();
	for (const r of rows) {
		await conn.execute(
			`INSERT INTO par_measurements (assessment_id, tooth, site, pocket, recession, bop, plaque)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)
			 ON CONFLICT(assessment_id, tooth, site) DO UPDATE SET
			   pocket=$4, recession=$5, bop=$6, plaque=$7`,
			[assessmentId, r.tooth, r.site, r.pocket, r.recession, r.bop, r.plaque],
		);
	}
}

// ── PAR Tooth Data ────────────────────────────────────────────────────────────

export async function getParToothData(assessmentId: number): Promise<import('$lib/types').ParToothData[]> {
	const conn = await getDb();
	const rows = await conn.select<any[]>(
		'SELECT * FROM par_tooth_data WHERE assessment_id = $1 ORDER BY tooth',
		[assessmentId],
	);
	return rows.map(r => ({
		id: r.id, assessment_id: r.assessment_id, tooth: r.tooth,
		mobility: r.mobility, furcation_b: r.furcation_b, furcation_m: r.furcation_m,
		furcation_d: r.furcation_d, vitality: r.vitality,
		ait_planned: !!r.ait_planned, cpt_planned: !!r.cpt_planned,
		status: r.status as import('$lib/types').ParToothStatus | null,
	}));
}

export async function upsertParToothData(
	assessmentId: number,
	tooth: number,
	patch: Partial<Omit<import('$lib/types').ParToothData, 'id' | 'assessment_id' | 'tooth'>>,
): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		`INSERT OR IGNORE INTO par_tooth_data (assessment_id, tooth) VALUES ($1, $2)`,
		[assessmentId, tooth],
	);
	const sets: string[] = [];
	const vals: unknown[] = [];
	let i = 1;
	if (patch.mobility       !== undefined) { sets.push(`mobility=$${i}`);       vals.push(patch.mobility); i++; }
	if (patch.furcation_b    !== undefined) { sets.push(`furcation_b=$${i}`);    vals.push(patch.furcation_b); i++; }
	if (patch.furcation_m    !== undefined) { sets.push(`furcation_m=$${i}`);    vals.push(patch.furcation_m); i++; }
	if (patch.furcation_d    !== undefined) { sets.push(`furcation_d=$${i}`);    vals.push(patch.furcation_d); i++; }
	if (patch.vitality       !== undefined) { sets.push(`vitality=$${i}`);       vals.push(patch.vitality); i++; }
	if (patch.ait_planned    !== undefined) { sets.push(`ait_planned=$${i}`);    vals.push(patch.ait_planned ? 1 : 0); i++; }
	if (patch.cpt_planned    !== undefined) { sets.push(`cpt_planned=$${i}`);    vals.push(patch.cpt_planned ? 1 : 0); i++; }
	if (patch.status         !== undefined) { sets.push(`status=$${i}`);         vals.push(patch.status); i++; }
	if (sets.length === 0) return;
	vals.push(assessmentId, tooth);
	await conn.execute(
		`UPDATE par_tooth_data SET ${sets.join(', ')} WHERE assessment_id = $${i} AND tooth = $${i + 1}`,
		vals,
	);
}

// ── PAR Bone Levels ───────────────────────────────────────────────────────────

export async function getParBoneLevel(
	assessmentId: number,
	jaw: 'upper' | 'lower',
): Promise<import('$lib/types').ParBoneLevel | null> {
	const conn = await getDb();
	const rows = await conn.select<any[]>(
		'SELECT * FROM par_bone_levels WHERE assessment_id = $1 AND jaw = $2',
		[assessmentId, jaw],
	);
	if (rows.length === 0) return null;
	return rows[0] as import('$lib/types').ParBoneLevel;
}

export async function upsertParBoneLevel(
	assessmentId: number,
	jaw: 'upper' | 'lower',
	points: { x: number; y: number }[],
): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		`INSERT INTO par_bone_levels (assessment_id, jaw, points_json)
		 VALUES ($1,$2,$3)
		 ON CONFLICT(assessment_id, jaw) DO UPDATE SET points_json=$3`,
		[assessmentId, jaw, JSON.stringify(points)],
	);
}

// ── PAR Anamnesis ─────────────────────────────────────────────────────────────

export async function getParAnamnesis(caseId: number): Promise<import('$lib/types').ParAnamnesis | null> {
	const conn = await getDb();
	const rows = await conn.select<any[]>(
		'SELECT * FROM par_anamnesis WHERE case_id = $1',
		[caseId],
	);
	if (rows.length === 0) return null;
	const r = rows[0];
	return {
		id: r.id, case_id: r.case_id,
		diabetes: !!r.diabetes, hba1c: r.hba1c,
		smoking: !!r.smoking, smoking_cpd: r.smoking_cpd, smoking_years: r.smoking_years,
		cardiovascular: !!r.cardiovascular, immunosuppression: !!r.immunosuppression,
		general_other: r.general_other ?? '',
		prior_par: !!r.prior_par, prior_par_year: r.prior_par_year,
		family_history: !!r.family_history, specific_other: r.specific_other ?? '',
		special_history: r.special_history ?? '',
		assessor_done: !!r.assessor_done, assessor_date: r.assessor_date,
	};
}

export async function upsertParAnamnesis(
	caseId: number,
	data: Partial<Omit<import('$lib/types').ParAnamnesis, 'id' | 'case_id'>>,
): Promise<void> {
	const conn = await getDb();
	await conn.execute(
		`INSERT OR IGNORE INTO par_anamnesis (case_id) VALUES ($1)`,
		[caseId],
	);
	const sets: string[] = [];
	const vals: unknown[] = [];
	let i = 1;
	const boolFields = ['diabetes', 'smoking', 'cardiovascular', 'immunosuppression', 'prior_par', 'family_history', 'assessor_done'] as const;
	const numFields  = ['hba1c', 'smoking_cpd', 'smoking_years', 'prior_par_year'] as const;
	const strFields  = ['general_other', 'specific_other', 'special_history', 'assessor_date'] as const;
	for (const f of boolFields) {
		if (data[f] !== undefined) { sets.push(`${f}=$${i}`); vals.push(data[f] ? 1 : 0); i++; }
	}
	for (const f of numFields) {
		if (data[f] !== undefined) { sets.push(`${f}=$${i}`); vals.push(data[f]); i++; }
	}
	for (const f of strFields) {
		if (data[f] !== undefined) { sets.push(`${f}=$${i}`); vals.push(data[f]); i++; }
	}
	if (sets.length === 0) return;
	vals.push(caseId);
	await conn.execute(
		`UPDATE par_anamnesis SET ${sets.join(', ')} WHERE case_id = $${i}`,
		vals,
	);
}

// ── PAR UPT Schedule ──────────────────────────────────────────────────────────

export async function getParUptSchedule(caseId: number): Promise<import('$lib/types').ParUptSession[]> {
	const conn = await getDb();
	const rows = await conn.select<any[]>(
		'SELECT * FROM par_upt_schedule WHERE case_id = $1 ORDER BY session',
		[caseId],
	);
	return rows as import('$lib/types').ParUptSession[];
}

export async function upsertParUptSchedule(
	caseId: number,
	sessions: Omit<import('$lib/types').ParUptSession, 'id'>[],
): Promise<void> {
	const conn = await getDb();
	for (const s of sessions) {
		await conn.execute(
			`INSERT INTO par_upt_schedule (case_id, session, window_start, window_end, delivered_date, assessment_id, appointment_id)
			 VALUES ($1,$2,$3,$4,$5,$6,$7)
			 ON CONFLICT(case_id, session) DO UPDATE SET
			   window_start=$3, window_end=$4, delivered_date=$5, assessment_id=$6, appointment_id=$7`,
			[caseId, s.session, s.window_start, s.window_end, s.delivered_date, s.assessment_id, s.appointment_id],
		);
	}
}

// ── PAR Snapshot ──────────────────────────────────────────────────────────────

export async function loadParAssessmentSnapshot(assessmentId: number): Promise<import('$lib/types').ParAssessmentSnapshot> {
	const conn = await getDb();
	const [assessment, measurements, toothData, boneLevelRows] = await Promise.all([
		getParAssessment(assessmentId),
		getParMeasurements(assessmentId),
		getParToothData(assessmentId),
		conn.select<any[]>(
			'SELECT * FROM par_bone_levels WHERE assessment_id = $1',
			[assessmentId],
		),
	]);
	if (!assessment) throw new Error(`PAR assessment ${assessmentId} not found`);
	return {
		assessment,
		measurements,
		toothData,
		boneLevels: boneLevelRows as import('$lib/types').ParBoneLevel[],
	};
}
