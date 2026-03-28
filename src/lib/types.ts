export type PatientStatus = 'active' | 'inactive' | 'archived' | 'deceased';

export interface Patient {
	id: number;
	patient_id: string;
	firstname: string;
	lastname: string;
	dob: string;
	gender: string;
	phone: string;
	email: string;
	insurance_provider: string;
	insurance_id: string;
	allergies: string; // JSON array stored as text
	medications: string; // JSON array stored as text
	risk_flags: string; // JSON array stored as text
	status: PatientStatus;
	next_appointment: string;
	notes: string;
	referral_source: string;
	smoking_status: string;
	occupation: string;
	address: string;
	city: string;
	postal_code: string;
	country: string;
	emergency_contact_name: string;
	emergency_contact_phone: string;
	emergency_contact_relation: string;
	blood_group: string;
	primary_physician: string;
	marital_status: string;
	created_at: string;
	updated_at: string;
}

export interface PatientFormData {
	firstname: string;
	lastname: string;
	dob?: string;
	gender?: string;
	phone?: string;
	email?: string;
	insurance_provider?: string;
	insurance_id?: string;
	referral_source?: string;
	smoking_status?: string;
	occupation?: string;
	allergies?: string;
	address?: string;
	city?: string;
	postal_code?: string;
	country?: string;
	emergency_contact_name?: string;
	emergency_contact_phone?: string;
	emergency_contact_relation?: string;
	blood_group?: string;
	primary_physician?: string;
	marital_status?: string;
}

export type TimelineEntryType = string;
/** System-only entry types — never shown in user-configurable dropdowns */
export const SYSTEM_ENTRY_TYPES = new Set(['document', 'plan', 'chart_snapshot', 'ortho_snapshot']);

export type TreatmentCategory =
	| 'endodontics'
	| 'orthodontics'
	| 'prosthodontics'
	| 'periodontics'
	| 'oral_surgery'
	| 'restorative'
	| 'preventive'
	| 'imaging'
	| 'other';

export type TreatmentOutcome =
	| 'successful'
	| 'retreated'
	| 'failed_extracted'
	| 'failed_other'
	| 'ongoing'
	| 'unknown';

export interface TimelineEntry {
	id: number;
	patient_id: string;
	entry_date: string;
	entry_type: TimelineEntryType;
	title: string;
	provider: string;
	tooth_numbers: string;
	description: string;
	diagnosis_codes: string; // JSON array
	cpt_codes: string; // JSON array
	attachments: string; // JSON array — for documents: [{ path, name, mime, size }]
	treatment_category: string; // TreatmentCategory | '' — for documents: DocumentCategory
	treatment_outcome: string; // TreatmentOutcome | ''
	related_entry_id: number | null;
	document_id: number | null; // FK to documents table (only set for entry_type='document')
	plan_id: string; // FK reference to treatment_plans.plan_id (only set for entry_type='plan')
	chart_data: string; // JSON snapshot of dental chart (only set for entry_type='chart_snapshot')
	is_locked: number; // 1 = locked (chart snapshots are locked by default), 0 = editable
	doctor_id: number | null; // FK to doctors table — structured doctor attribution
	colleague_ids: string; // JSON array of doctor IDs — additional staff on this entry
	created_at: string;
	updated_at: string;
}

export interface TimelineFormData {
	entry_date: string;
	entry_type: TimelineEntryType;
	title: string;
	provider?: string;
	tooth_numbers?: string;
	description?: string;
	treatment_category?: TreatmentCategory | string; // string to allow DocumentCategory values too
	treatment_outcome?: TreatmentOutcome | '';
	related_entry_id?: number | null;
	document_id?: number | null;
	attachments?: string; // JSON array
	plan_id?: string; // for entry_type='plan'
	chart_data?: string; // JSON snapshot for entry_type='chart_snapshot'
	is_locked?: number; // 1 = locked, 0 = editable
	doctor_id?: number | null; // FK to doctors table
	colleague_ids?: string; // JSON array of doctor IDs — additional staff on this entry
}

// ── Orthodontic Classification ─────────────────────────────────────────

export type AngleClass = 'class_I' | 'class_II_div1' | 'class_II_div2' | 'class_III' | '';
export type MolarRelationship = 'class_I' | 'class_II' | 'class_III' | 'super_class_II' | 'super_class_III' | '';
export type CrowdingLevel = 'none' | 'mild' | 'moderate' | 'severe' | '';
export type CrossbiteType = 'none' | 'anterior' | 'posterior_unilateral' | 'posterior_bilateral' | '';
export type OpenBiteType = 'none' | 'anterior' | 'posterior' | '';
export type OrthoTreatmentType = 'fixed_appliances' | 'aligners' | 'functional' | 'headgear' | 'surgical_ortho' | 'retainer_only' | 'other' | '';
export type ExtractionPattern = 'non_extraction' | '4_premolars' | '2_upper_premolars' | '2_lower_premolars' | 'other' | '';
export type FacialProfile = 'straight' | 'convex' | 'concave' | '';
export type LipCompetence = 'competent' | 'incompetent' | 'potentially_competent' | '';
export type NasalBreathing = 'normal' | 'impaired' | 'mouth_breathing' | '';
export type GrowthPotential = 'high' | 'medium' | 'low' | 'completed' | '';

export interface OrthoClassification {
	id: number;
	patient_id: string;
	pre_angle_class: AngleClass;
	post_angle_class: AngleClass;
	pre_molar_relationship: MolarRelationship;
	post_molar_relationship: MolarRelationship;
	pre_overjet_mm: number;
	post_overjet_mm: number;
	pre_overbite_mm: number;
	post_overbite_mm: number;
	pre_crowding: CrowdingLevel;
	post_crowding: CrowdingLevel;
	pre_crossbite: CrossbiteType;
	post_crossbite: CrossbiteType;
	pre_open_bite: OpenBiteType;
	post_open_bite: OpenBiteType;
	pre_midline_deviation_mm: number;
	post_midline_deviation_mm: number;
	treatment_type: OrthoTreatmentType;
	extraction_pattern: ExtractionPattern;
	treatment_start_date: string;
	treatment_end_date: string;
	notes: string;
	// Extended fields (v37+)
	exam_date: string;
	pre_canine_class: AngleClass;
	post_canine_class: AngleClass;
	pre_crowding_upper_mm: number;
	post_crowding_upper_mm: number;
	pre_crowding_lower_mm: number;
	post_crowding_lower_mm: number;
	facial_profile: FacialProfile;
	lip_competence: LipCompetence;
	nasal_breathing: NasalBreathing;
	oral_habits: string; // JSON array: 'thumb_sucking' | 'finger_sucking' | 'lip_biting' | 'nail_biting' | 'tongue_thrust' | 'bruxism'
	cvm_stage: number; // Cervical Vertebral Maturation 1–6
	growth_potential: GrowthPotential;
	retention_protocol: string;
	updated_at: string;
}

// ── KIG (Kieferorthopädische Indikationsgruppen) ────────────────────────

export type KigGroupCode = 'A' | 'U' | 'S' | 'D' | 'M' | 'O' | 'T' | 'B' | 'K' | 'E' | 'P';

/** One KIG group finding within an assessment snapshot */
export interface OrthoKigEntry {
	group: KigGroupCode;
	grade: number; // valid grades depend on group
	measured_value: number | null; // mm for D, M, O, T, E, P
}

/** Bite classification type (sagittal relationship) */
export type BissType = 'neutral' | 'distal' | 'mesial';

/** Per-side bite measurement in Prämolarenbreite units */
export interface BissMeasurement {
	type: BissType;
	/** Number of Prämolarenbreiten (0.25–2.0 in 0.25 steps); null for neutral */
	praemolarenbreite: number | null;
}

/** A single KIG assessment snapshot (like dental_chart_history) */
export interface OrthoAssessment {
	id: number;
	patient_id: string;
	exam_date: string; // ISO date
	doctor_id: number | null;
	findings: OrthoKigEntry[]; // stored as JSON
	notes: string;
	// Optional clinical context fields (v40)
	dentition_stage: string;   // 'primary' | 'mixed' | 'permanent'
	treatment_phase: string;   // 'expectative' | 'early' | 'main' | 'adult'
	angle_class: string;       // 'class_I' | 'class_II_div1' | 'class_II_div2' | 'class_III'
	cvm_stage: number;         // 0 = not set, 1–6
	facial_profile: string;    // 'straight' | 'convex' | 'concave'
	treatment_recommendation: string; // free text (removed from UI, kept for backward compat)
	bad_habits?: string[]; // array of habit keys, e.g. ['thumbSucking', 'mouthBreathing']
	// Bite classification per side (v41+, optional — not in older snapshots)
	biss_right?: BissMeasurement | null;
	biss_left?: BissMeasurement | null;
	created_at: string;
}

/** @deprecated use OrthoAssessment instead */
export interface KigFinding {
	id: number;
	patient_id: string;
	kig_group: KigGroupCode;
	kig_level: number;
	measured_value: number | null;
	notes: string;
	created_at: string;
}

// ── Patient Clinical Classification ───────────────────────────────────

export type PerioStatus =
	| 'healthy'
	| 'gingivitis'
	| 'mild_periodontitis'
	| 'moderate_periodontitis'
	| 'severe_periodontitis'
	| '';

export type RiskLevel = 'low' | 'medium' | 'high' | '';

export type SpecialCondition =
	| 'bruxism'
	| 'tmj'
	| 'sleep_apnea'
	| 'cleft_lip_palate'
	| 'diabetes'
	| 'hypertension'
	| 'anticoagulants'
	| 'bisphosphonates'
	| 'immunosuppressed'
	| 'pregnancy';

export interface PatientClassification {
	id: number;
	patient_id: string;
	perio_status: PerioStatus;
	caries_risk: RiskLevel;
	perio_risk: RiskLevel;
	special_conditions: string; // JSON array of SpecialCondition
	notes: string;
	updated_at: string;
}

// ── Treatment Plans ────────────────────────────────────────────────────

export type TreatmentPlanStatus =
	| 'proposed'
	| 'accepted'
	| 'in_progress'
	| 'completed'
	| 'cancelled';

export type TreatmentPlanItemStatus = 'pending' | 'scheduled' | 'completed' | 'cancelled';

export interface TreatmentPlan {
	id: number;
	plan_id: string;
	patient_id: string;
	title: string;
	description: string;
	status: TreatmentPlanStatus;
	total_estimated_cost: number;
	created_at: string;
	updated_at: string;
}

export interface TreatmentPlanItem {
	id: number;
	plan_id: string;
	sequence_order: number;
	procedure_code: string;
	description: string;
	tooth_numbers: string;
	estimated_cost: number;
	status: TreatmentPlanItemStatus;
	completed_date: string;
	notes: string;
	timeline_entry_id: number | null;
}

export interface TreatmentPlanFormData {
	title: string;
	description?: string;
	status?: TreatmentPlanStatus;
}

export interface TreatmentPlanItemFormData {
	description: string;
	procedure_code?: string;
	tooth_numbers?: string;
	estimated_cost?: number;
	notes?: string;
}

// ── Dental Chart ────────────────────────────────────────────────────────

export type ToothCondition =
	| 'healthy'
	| 'watch'
	| 'decayed'
	| 'filled'
	| 'crowned'
	| 'root_canal'
	| 'implant'
	| 'bridge'
	| 'missing'
	| 'extracted'
	| 'impacted'
	| 'fractured'
	| 'prosthesis';

export type PatternType = 'solid' | 'diagonal' | 'crosshatch' | 'horizontal' | 'vertical' | 'dots';

export interface DentalTag {
	key: string;
	/** @deprecated label is now derived from i18n at render time — not persisted */
	label?: string;
	color: string;
	strokeColor: string;
	pattern: PatternType;
	shortcut?: string; // single-character keyboard shortcut
	/** When true, this tag always applies to the whole tooth condition, never to individual surfaces */
	wholeTooth?: boolean;
}

export interface TextBlock {
	/** URL-friendly slug; also the trigger after '/' (e.g. "filling") */
	key: string;
	/** Display name shown in the palette (e.g. "Composite Füllung") */
	label: string;
	/** Template text inserted into the description. Use __ for placeholders. */
	body: string;
}

export interface ToothChartEntry {
	id: number;
	patient_id: string;
	tooth_number: number;
	condition: string;
	surfaces: string; // JSON: {M:'',O:'',D:'',B:'',L:''}
	notes: string;
	last_examined: string;
	bridge_group_id: string | null;
	bridge_role: 'abutment' | 'pontic' | null;
	abutment_type: 'tooth' | 'implant' | null;
	prosthesis_type: 'telescope' | 'replaced' | null;
	updated_at: string;
}

export interface ToothChartFormData {
	condition?: string;
	surfaces?: string;
	notes?: string;
	last_examined?: string;
	bridge_group_id?: string | null;
	bridge_role?: 'abutment' | 'pontic' | null;
	abutment_type?: 'tooth' | 'implant' | null;
	prosthesis_type?: 'telescope' | 'replaced' | null;
}

// ── Clinical Exams ──────────────────────────────────────────────────────

export type ExamType = 'full' | 'limited' | 'emergency' | 'recall';

export interface ClinicalExam {
	id: number;
	patient_id: string;
	exam_date: string;
	exam_type: ExamType;
	examiner: string;
	chief_complaint: string;
	findings: string;
	probing_data: string; // JSON
	notes: string;
	created_at: string;
}

export interface ClinicalExamFormData {
	exam_date: string;
	exam_type?: ExamType;
	examiner?: string;
	chief_complaint?: string;
	findings?: string;
	notes?: string;
}

// ── Documents & Attachments ──────────────────────────────────────────────

/** Document category key — matches `documents.category` in the DB.
 *  Built-in keys: 'xray' | 'photo' | 'lab' | 'referral' | 'consent' | 'other'.
 *  Users may add custom keys via Settings; those use the key itself as the vault subfolder name. */
export type DocumentCategory = string;

export interface PatientDocument {
	id: number;
	patient_id: string;
	filename: string;
	original_name: string;
	category: DocumentCategory;
	mime_type: string;
	file_size: number;
	abs_path: string;
	/** Path relative to vault root, e.g. "Smith_John_PT001/xrays/scan.pdf" */
	rel_path: string;
	notes: string;
	created_at: string;
}

export interface PatientDocumentFormData {
	filename: string;
	original_name: string;
	category?: DocumentCategory;
	mime_type?: string;
	file_size?: number;
	abs_path: string;
	/** Path relative to vault root — used for portable storage */
	rel_path?: string;
	notes?: string;
}

// ── Patient Notes ────────────────────────────────────────────────────────

export interface PatientNoteEntry {
	id: number;
	patient_id: string;
	content: string;
	created_at: string;
}

// ── Medical Entries ──────────────────────────────────────────────────────

export type MedicalEntryType = 'allergy' | 'medication' | 'risk_flag' | 'note';

export interface MedicalEntry {
	id: number;
	patient_id: string;
	content: string;
	entry_type: MedicalEntryType;
	created_at: string;
}

// ── Acute Problems ────────────────────────────────────────────────────────

export interface AcuteProblem {
	id: number;
	patient_id: string;
	content: string;
	resolved: number; // 0 = active, 1 = resolved
	created_at: string;
}

// ── Doctors ──────────────────────────────────────────────────────────────

export interface Doctor {
	id: number;
	name: string;
	specialty: string;
	color: string; // hex or oklch CSS string, used for badge colouring
	role: string; // clinical role key — matches StaffRole.key in staffRoles store
	show_in_doc_bar: number; // 1 = shown in doc bar, 0 = hidden
	created_at: string;
}

export interface DoctorFormData {
	name: string;
	specialty?: string;
	color?: string;
	role?: string;
	show_in_doc_bar?: number;
}

// ── Audit Log ────────────────────────────────────────────────────────────

export type AuditAction = 'update' | 'delete';

export type AuditEntityType =
	| 'timeline_entry'
	| 'treatment_plan'
	| 'treatment_plan_item'
	| 'dental_chart'
	| 'patient'
	| 'document';

export interface AuditRecord {
	id: string;
	timestamp: string;
	action: AuditAction;
	entity_type: AuditEntityType;
	entity_id: string;
	patient_id: string;
	patient_name: string;
	user: string;
	summary: string; // human-readable one-liner, e.g. "Edited 'Root Canal #14'"
	before: Record<string, unknown> | null;
	after: Record<string, unknown> | null;
	checksum: string;
}

export interface AuditFilters {
	patient_id?: string;
	entity_id?: string; // filter to a specific entity (e.g. a single timeline entry)
	action?: AuditAction;
	entity_type?: AuditEntityType;
	date_from?: string;
	date_to?: string;
	search?: string;
}

// ── Dashboard Analytics ──────────────────────────────────────────────────

export interface PatientStatusCounts {
	total: number;
	active: number;
	inactive: number;
	archived: number;
}

export interface CategoryStat {
	category: string;
	count: number;
}

export interface OutcomeStat {
	category: string;
	outcome: string;
	count: number;
}

export interface SuccessRateStat {
	successful: number;
	total_with_outcome: number;
}

export interface RecentEntry {
	id: number;
	patient_id: string;
	entry_date: string;
	entry_type: string;
	title: string;
	treatment_category: string;
	treatment_outcome: string;
	tooth_numbers: string;
	firstname: string;
	lastname: string;
}

// ── Complications ────────────────────────────────────────────────────────

export interface Complication {
	id: number;
	timeline_entry_id: number;
	patient_id: string;
	complication_type: string;
	description: string;
	severity: 'mild' | 'moderate' | 'severe';
	date_reported: string;
	date_resolved: string;
	resolved: number; // 0 = open, 1 = resolved
	created_at: string;
}

// ── Patient Conditions ────────────────────────────────────────────────────

export interface PatientCondition {
	id: number;
	patient_id: string;
	condition_key: string;
	start_date: string;
	end_date: string;
	is_active: number; // 0 | 1
	notes: string;
	created_at: string;
}

// ── Dental Chart History ──────────────────────────────────────────────────

export interface DentalChartHistoryEntry {
	id: number;
	patient_id: string;
	tooth_number: number;
	condition: string;
	surfaces: string; // JSON
	snapshot_entry_id: number | null;
	recorded_at: string;
}

// ── Probing ───────────────────────────────────────────────────────────────

export interface ProbingRecord {
	id: number;
	patient_id: string;
	exam_date: string;
	examiner: string;
	notes: string;
	created_at: string;
}

export interface ProbingMeasurement {
	id: number;
	record_id: number;
	tooth_number: number;
	site: string;
	pocket_depth: number | null;
	bleeding_on_probing: number; // 0 | 1
	recession: number | null;
	plaque: number; // 0 | 1
}

export interface ProbingToothData {
	id: number;
	record_id: number;
	tooth_number: number;
	mobility: number | null; // 0, 1, 2, 3
	furcation: number | null; // 0, 1, 2, 3
	furcation_sites: string; // comma-separated, e.g. 'B,ML'
	notes: string;
}

// ── Analytics / Reports ───────────────────────────────────────────────────

export interface AnalyticsFilters {
	dateFrom?: string;
	dateTo?: string;
	doctorId?: number | null;
}

export interface ReportFilters {
	dateFrom?: string;
	dateTo?: string;
	categories?: string[];
	outcomes?: string[];
	doctorId?: number | null;
	toothNumbers?: number[];
}

export interface ReportEntry {
	id: number;
	patient_id: string;
	patient_name: string;
	entry_date: string;
	entry_type: string;
	title: string;
	treatment_category: string;
	treatment_outcome: string;
	tooth_numbers: string;
	description: string;
	doctor_name: string;
}

// ── Appointment Scheduling ────────────────────────────────────────────

export type AppointmentStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';

export interface AppointmentRoom {
	id: string;
	name: string;
	short_name: string;
	color: string;
	sort_order: number;
	is_active: number;
	created_at: string;
}

export interface AppointmentRoomFormData {
	name: string;
	short_name: string;
	color: string;
	sort_order: number;
	is_active: boolean;
}

export interface AppointmentType {
	id: string;
	name: string;
	short_name: string;
	default_duration_min: number;
	color: string;
	treatment_category: string;
	sort_order: number;
	is_active: number;
	created_at: string;
}

export interface AppointmentTypeFormData {
	name: string;
	short_name: string;
	default_duration_min: number;
	color: string;
	treatment_category: string;
	sort_order: number;
	is_active: boolean;
}

export interface Appointment {
	id: string;
	patient_id: string;
	doctor_id: string | null;
	room_id: string;
	type_id: string | null;
	start_time: string;
	end_time: string;
	duration_min: number;
	title: string | null;
	notes: string | null;
	status: AppointmentStatus;
	timeline_entry_id: string | null;
	created_at: string;
	updated_at: string;
	// Joined display fields
	patient_firstname: string | null;
	patient_lastname: string | null;
	doctor_name: string | null;
	type_name: string | null;
	type_color: string | null;
	type_short_name: string | null;
	room_name: string | null;
	room_color: string | null;
}

export interface AppointmentFormData {
	patient_id: string;
	doctor_id: string;
	room_id: string;
	type_id: string;
	start_time: string;
	end_time: string;
	duration_min: number;
	title: string;
	notes: string;
	status: AppointmentStatus;
}

export interface WorkingHoursEntry {
	day_of_week: number; // 0=Sun, 1=Mon, ..., 6=Sat
	start_time: string; // HH:MM
	end_time: string; // HH:MM
	break_start: string | null;
	break_end: string | null;
	is_active: boolean;
}

// ── Doctor Working Hours (per-doctor schedule) ──────────────────────────

export interface DoctorWorkingHours {
	id: string;
	doctor_id: string;
	day_of_week: number; // 0=Sun, 1=Mon, ..., 6=Sat
	start_time: string;
	end_time: string;
	break_start: string | null;
	break_end: string | null;
	is_active: number; // 0 | 1
	created_at: string;
}

export interface DoctorWorkingHoursFormData {
	day_of_week: number;
	start_time: string;
	end_time: string;
	break_start: string;
	break_end: string;
	is_active: boolean;
}

// ── Staff Presence (schedule overlay) ────────────────────────────────────

export interface StaffPresenceInfo {
	doctor_id: string;
	name: string;
	color: string;
	start_time: string;
	end_time: string;
	break_start: string | null;
	break_end: string | null;
}

// ── Staff Analytics ──────────────────────────────────────────────────────

export interface AbsenceStat {
	doctor_id: string;
	doctor_name: string;
	doctor_color: string;
	vacation_days: number;
	sick_days: number;
	conference_days: number;
	training_days: number;
	other_days: number;
}

export interface AppointmentDoctorStat {
	doctor_id: string;
	doctor_name: string;
	doctor_color: string;
	total: number;
	completed: number;
	cancelled: number;
	no_show: number;
	scheduled: number;
	avg_duration_min: number;
}

// ── Schedule Blocks ───────────────────────────────────────────────────

export interface ScheduleBlock {
	id: string;
	room_id: string;
	doctor_id: string | null;
	title: string;
	start_time: string;
	end_time: string;
	color: string;
	notes: string | null;
	created_at: string;
	updated_at: string;
	// Joined
	doctor_name: string | null;
	room_name: string | null;
}

export interface ScheduleBlockFormData {
	room_id: string;
	doctor_id: string;
	title: string;
	start_time: string;
	end_time: string;
	color: string;
	notes: string;
}

// ── Staff Blockouts ───────────────────────────────────────────────────

export type BlockoutReason = 'vacation' | 'sick' | 'conference' | 'training' | 'other';

export interface StaffBlockout {
	id: string;
	doctor_id: string;
	start_date: string;
	end_date: string;
	start_time: string | null;
	end_time: string | null;
	is_all_day: number; // 0 | 1
	reason: BlockoutReason;
	notes: string | null;
	color: string;
	created_at: string;
	// Joined
	doctor_name: string | null;
	doctor_color: string | null;
}

export interface StaffBlockoutFormData {
	doctor_id: string;
	start_date: string;
	end_date: string;
	start_time: string;
	end_time: string;
	is_all_day: boolean;
	reason: BlockoutReason;
	notes: string;
	color: string;
}

// ── Patient sidebar summary ────────────────────────────────────────────

export interface PatientSummaryEntry {
	id: number;
	entry_date: string;
	title: string;
	entry_type: string;
	treatment_category: string;
}

export interface PatientSummary {
	timelineCount: number;
	recentEntries: PatientSummaryEntry[];
	planCount: number;
	activePlanCount: number;
	documentCount: number;
	perioExamCount: number;
	lastPerioDate: string | null;
	activeConditionCount: number;
	acuteTags: string[];
	medicalTags: string[];
}

