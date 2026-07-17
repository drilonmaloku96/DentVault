/**
 * Patient export: gather data, render HTML report, copy files.
 * Pure TypeScript — no Svelte, no DOM reactivity.
 */

import type {
	Patient, TimelineEntry, ToothChartEntry, TreatmentPlan, TreatmentPlanItem,
	OrthoClassification, OrthoAssessment, ProbingRecord, ProbingMeasurement, ProbingToothData,
	PatientCondition, PatientDocument, Doctor, Complication, EndoRecord, ToothNote,
	ParCase, ParAssessmentSnapshot, Appointment,
} from '$lib/types';
import {
	getPatient, getTimelineEntries, getChartData, getTreatmentPlans, getTreatmentPlanItems,
	getOrthoClassification, getProbingRecords, getProbingMeasurements, getProbingToothData,
	getPatientConditions, getDocuments, getDoctors, getComplications,
	getAcuteText, getMedicalText, getMiscNotes, getAllEndoRecordsForPatient,
	getAllToothNotesForPatient, getPatientTags,
	getParCases, getParAssessments, loadParAssessmentSnapshot,
	getAppointmentsForPatient,
} from '$lib/services/db';
import { computeAssessmentStats } from '$lib/utils/par-stats';
import { renderChartSVG, type TagConfig, type BridgeRoleConfig, type ProsthesisTypeConfig, type FillingMaterialConfig } from '$lib/services/chart-svg-static';
import { writeTextFile, copyPatientFolderTo } from '$lib/services/files';
import { vault } from '$lib/stores/vault.svelte';
import { appointmentStatuses } from '$lib/stores/appointmentStatuses.svelte';
import { toLocalISODate, toFDI, FDI_TOOTH_NAMES } from '$lib/utils';

// ── Export data model ──────────────────────────────────────────────────────

export interface PatientExportOptions {
	dateFrom?: string;
	dateTo?: string;
	sections?: {
		demographics?: boolean;
		medical?: boolean;
		notes?: boolean;
		ortho?: boolean;
		chart?: boolean;
		timeline?: boolean;
		perio?: boolean;
		plans?: boolean;
		documents?: boolean;
		par?: boolean;
		appointments?: boolean;
	};
}

interface PatientExportData {
	patient: Patient;
	entries: TimelineEntry[];
	chartData: ToothChartEntry[];
	plans: TreatmentPlan[];
	planItems: Map<string, TreatmentPlanItem[]>;
	ortho: OrthoClassification | null;
	orthoAssessments: OrthoAssessment[];
	probingRecords: Array<{
		record: ProbingRecord;
		measurements: ProbingMeasurement[];
		toothData: ProbingToothData[];
	}>;
	conditions: PatientCondition[];
	documents: PatientDocument[];
	appointments: Appointment[];
	doctors: Doctor[];
	complicationsByEntry: Map<number, Complication[]>;
	acuteText: string;
	medicalText: string;
	miscNotes: string;
	acuteTags: string[];
	medicalTags: string[];
	endoRecords: EndoRecord[];
	toothNotes: ToothNote[];
	exportDate: string;
	parData: Array<{ parCase: ParCase; snapshots: ParAssessmentSnapshot[] }>;
}

// ── Data gathering ─────────────────────────────────────────────────────────

export async function gatherExportData(
	patientId: string,
	options?: PatientExportOptions,
): Promise<PatientExportData> {
	const [patient, allEntries, chartData, plans, ortho, probingRecords, conditions, documents, doctors, allAppointments] =
		await Promise.all([
			getPatient(patientId),
			getTimelineEntries(patientId),
			getChartData(patientId),
			getTreatmentPlans(patientId),
			getOrthoClassification(patientId),
			getProbingRecords(patientId),
			getPatientConditions(patientId),
			getDocuments(patientId),
			getDoctors(),
			getAppointmentsForPatient(patientId),
		]);

	// Ortho assessments are now stored as timeline entries (ortho_snapshot type)
	const orthoAssessments: OrthoAssessment[] = allEntries
		.filter(e => e.entry_type === 'ortho_snapshot' && e.chart_data)
		.sort((a, b) => a.entry_date.localeCompare(b.entry_date))
		.map((e, i) => {
			try {
				const payload = JSON.parse(e.chart_data);
				return { id: i, patient_id: patientId, created_at: e.created_at ?? '', ...payload } as OrthoAssessment;
			} catch { return null; }
		})
		.filter((a): a is OrthoAssessment => a !== null);

	if (!patient) throw new Error('Patient not found: ' + patientId);

	// Apply date filter
	let entries = allEntries;
	if (options?.dateFrom) entries = entries.filter(e => e.entry_date >= options.dateFrom!);
	if (options?.dateTo) entries = entries.filter(e => e.entry_date <= options.dateTo!);

	// Sort oldest-first for report
	entries = [...entries].sort((a, b) => a.entry_date.localeCompare(b.entry_date));

	// Appointments — respect the same date-range options as the timeline section.
	// Sort descending by start_time (most recent visit history first).
	let appointments = allAppointments;
	if (options?.dateFrom) appointments = appointments.filter(a => a.start_time.slice(0, 10) >= options.dateFrom!);
	if (options?.dateTo) appointments = appointments.filter(a => a.start_time.slice(0, 10) <= options.dateTo!);
	appointments = [...appointments].sort((a, b) => b.start_time.localeCompare(a.start_time));

	// Plan items
	const planItems = new Map<string, TreatmentPlanItem[]>();
	for (const plan of plans) {
		planItems.set(plan.plan_id, await getTreatmentPlanItems(plan.plan_id));
	}

	// Probing measurements
	const probingFull = await Promise.all(
		probingRecords.map(async (record) => {
			const [measurements, toothData] = await Promise.all([
				getProbingMeasurements(record.id),
				getProbingToothData(record.id),
			]);
			return { record, measurements, toothData };
		}),
	);

	// Complications per entry
	const complicationsByEntry = new Map<number, Complication[]>();
	for (const entry of entries) {
		const comps = await getComplications(entry.id);
		if (comps.length > 0) complicationsByEntry.set(entry.id, comps);
	}

	const [acuteText, medicalText, miscNotes, acuteTags, medicalTags, endoRecords, toothNotes, parCasesRaw] = await Promise.all([
		getAcuteText(patientId),
		getMedicalText(patientId),
		getMiscNotes(patientId),
		getPatientTags(patientId, 'acute'),
		getPatientTags(patientId, 'medical'),
		getAllEndoRecordsForPatient(patientId),
		getAllToothNotesForPatient(patientId),
		getParCases(patientId),
	]);

	const parData = await Promise.all(
		parCasesRaw.map(async (parCase) => {
			const assessments = await getParAssessments(parCase.id);
			const snapshots = await Promise.all(assessments.map(a => loadParAssessmentSnapshot(a.id)));
			return { parCase, snapshots };
		}),
	);

	return {
		patient,
		entries,
		chartData,
		plans,
		planItems,
		ortho,
		orthoAssessments,
		probingRecords: probingFull,
		conditions,
		documents,
		appointments,
		doctors,
		complicationsByEntry,
		acuteText,
		medicalText,
		miscNotes,
		acuteTags,
		medicalTags,
		endoRecords,
		toothNotes,
		exportDate: toLocalISODate(),
		parData,
	};
}

// ── HTML helpers ───────────────────────────────────────────────────────────

/**
 * Path of a file relative to its patient folder (`xrays/2023/scan.png`), for
 * `src`/`href` into the export's copied folder tree. Handles absolute (legacy)
 * and vault-relative inputs and any subfolder depth — naive "take the parent
 * dir" broke every file that lived in a category subfolder. Patient folders
 * are named `Lastname_Firstname_ID`, so the segment ending in the patient id
 * anchors the split. Returns null if the path doesn't contain the folder.
 */
function pathInPatientFolder(path: string, patientId: string): string | null {
	const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
	const idx = parts.findIndex(seg => seg === patientId || seg.endsWith(`_${patientId}`));
	if (idx === -1 || idx === parts.length - 1) return null;
	return parts.slice(idx + 1).join('/');
}

/** True when the auto-generated title is just the first words of the description. */
function titleIsRedundant(title: string, description: string | null | undefined): boolean {
	if (!description || !title) return false;
	const norm = (s: string) =>
		s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/​/g, '')
			.replace(/\s+/g, ' ').trim().toLowerCase();
	const t = norm(title.replace(/…$/, ''));
	return t.length > 0 && norm(description).startsWith(t);
}

function esc(s: string | null | undefined): string {
	if (!s) return '';
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function stripHtml(html: string): string {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function fmtDate(d: string): string {
	if (!d) return '';
	const parts = d.split('T')[0].split('-');
	if (parts.length !== 3) return d;
	return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function doctorName(doctorId: number | null, colleagues: string, doctors: Doctor[]): string {
	const ids: number[] = [];
	if (doctorId) ids.push(doctorId);
	try {
		const cIds = JSON.parse(colleagues || '[]') as number[];
		ids.push(...cIds);
	} catch { /* ignore */ }
	return ids.map(id => doctors.find(d => d.id === id)?.name ?? `#${id}`).join(', ');
}

// ── Surface label helpers ───────────────────────────────────────────────────

function getSurfTagFromExport(v: unknown): string {
	if (typeof v === 'string') return v;
	if (v && typeof v === 'object' && 'tag' in v) return (v as { tag: string }).tag;
	return '';
}

function getSurfLabelFromExport(v: unknown): string {
	const tag = getSurfTagFromExport(v);
	if (!v || typeof v === 'string') return tag;
	const data = v as { tag: string; material?: string; origin?: string; insufficient?: boolean; grade?: number };
	const parts: string[] = [tag];
	if (data.grade !== undefined) parts.push(`Grade ${data.grade}`);
	if (data.material) parts.push(data.material);
	if (data.origin === 'foreign') parts.push('Foreign');
	if (data.insufficient) parts.push('insufficient');
	return parts.join(' / ');
}

// ── Section renderers ──────────────────────────────────────────────────────

function renderCover(data: PatientExportData): string {
	const { patient, exportDate } = data;
	return `
<div class="cover page-break">
	<div class="cover-logo">DentVault</div>
	<h1 class="cover-title">${esc(patient.lastname)}, ${esc(patient.firstname)}</h1>
	<p class="cover-sub">Patient Record</p>
	<table class="cover-meta">
		<tr><th>Patient ID</th><td>${esc(patient.patient_id)}</td></tr>
		<tr><th>Date of Birth</th><td>${fmtDate(patient.dob)}</td></tr>
		<tr><th>Export Date</th><td>${fmtDate(exportDate)}</td></tr>
	</table>
	<p class="cover-footer">${esc('Generated with DentVault')}</p>
</div>`;
}

function renderDemographics(data: PatientExportData): string {
	const { patient } = data;
	const parseArr = (s: string) => { try { return (JSON.parse(s || '[]') as string[]).join(', '); } catch { return s; } };

	const rows: [string, string][] = [
		['Last Name', patient.lastname],
		['First Name', patient.firstname],
		['Date of Birth', fmtDate(patient.dob)],
		['Gender', patient.gender],
		['Status', patient.status],
		['Patient ID', patient.patient_id],
		['Phone', patient.phone],
		['E-Mail', patient.email],
		['Address', [patient.address, patient.postal_code, patient.city, patient.country].filter(Boolean).join(', ')],
		['Occupation', patient.occupation],
		['Referral Source', patient.referral_source],
		['Smoking Status', patient.smoking_status],
		['Marital Status', patient.marital_status],
		['Blood Group', patient.blood_group],
		['Primary Physician', patient.primary_physician],
		['Insurance', patient.insurance_provider],
		['Insurance ID', patient.insurance_id],
		['Emergency Contact', patient.emergency_contact_name],
		['Emergency Phone', patient.emergency_contact_phone],
		['Relation', patient.emergency_contact_relation],
		['Allergies', parseArr(patient.allergies)],
		['Medications', parseArr(patient.medications)],
		['Risk Flags', parseArr(patient.risk_flags)],
		['Notes', patient.notes],
	].filter(([, v]) => v) as [string, string][];

	return `
<div class="section avoid-break">
	<h2>Demographics</h2>
	<table class="info-table">
		${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
	</table>
</div>`;
}

function renderMedical(data: PatientExportData, includeNotes: boolean): string {
	const { conditions, acuteText, medicalText, miscNotes, acuteTags, medicalTags } = data;
	let html = `<div class="section"><h2>Medical History &amp; Conditions</h2>`;

	const tagChips = (tags: string[]) =>
		`<p style="margin:4px 0">${tags.map(t => `<span style="display:inline-block;font-size:11px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:1px 8px;margin:0 4px 4px 0">${esc(t)}</span>`).join('')}</p>`;

	if (acuteText?.trim() || acuteTags.length > 0) {
		html += `<h3>Acute Problems</h3>`;
		if (acuteTags.length > 0) html += tagChips(acuteTags);
		if (acuteText?.trim()) html += `<div class="richtext">${acuteText}</div>`;
	}
	if (medicalText?.trim() || medicalTags.length > 0) {
		html += `<h3>Medical History</h3>`;
		if (medicalTags.length > 0) html += tagChips(medicalTags);
		if (medicalText?.trim()) html += `<div class="richtext">${medicalText}</div>`;
	}
	if (includeNotes && miscNotes?.trim()) {
		html += `<h3>Notes</h3><div class="richtext">${miscNotes}</div>`;
	}

	const active = conditions.filter(c => c.is_active);
	const historical = conditions.filter(c => !c.is_active);
	if (active.length > 0) {
		html += `<h3>Active Conditions</h3><ul class="cond-list">${active.map(c => `<li>${esc(c.condition_key)}${c.start_date ? ' (' + fmtDate(c.start_date) + ')' : ''}${c.notes ? ' — ' + esc(c.notes) : ''}</li>`).join('')}</ul>`;
	}
	if (historical.length > 0) {
		html += `<h3>Past Conditions</h3><ul class="cond-list">${historical.map(c => `<li>${esc(c.condition_key)}${c.end_date ? ' (' + fmtDate(c.end_date) + ')' : ''}${c.notes ? ' — ' + esc(c.notes) : ''}</li>`).join('')}</ul>`;
	}

	html += '</div>';
	return html;
}

function renderOrtho(data: PatientExportData): string {
	const { ortho, orthoAssessments } = data;
	if (!ortho && orthoAssessments.length === 0) return '';
	const row = (label: string, pre: string | number | null, post: string | number | null) =>
		`<tr><th>${esc(label)}</th><td>${esc(String(pre ?? '—'))}</td><td>${esc(String(post ?? '—'))}</td></tr>`;

	let html = `<div class="section avoid-break"><h2>Orthodontic / IOTN Findings</h2>`;

	if (ortho) {
		html += `<h3>Classification</h3>
	<table class="info-table">
		<tr><th></th><th>Pre-treatment</th><th>Post-treatment</th></tr>
		${row('Angle Class', ortho.pre_angle_class, ortho.post_angle_class)}
		${row('Molar Relationship', ortho.pre_molar_relationship, ortho.post_molar_relationship)}
		${row('Overjet (mm)', ortho.pre_overjet_mm, ortho.post_overjet_mm)}
		${row('Overbite (mm)', ortho.pre_overbite_mm, ortho.post_overbite_mm)}
		${row('Crowding', ortho.pre_crowding, ortho.post_crowding)}
		${row('Crossbite', ortho.pre_crossbite, ortho.post_crossbite)}
		${row('Open Bite', ortho.pre_open_bite, ortho.post_open_bite)}
		${row('Midline Deviation (mm)', ortho.pre_midline_deviation_mm, ortho.post_midline_deviation_mm)}
	</table>`;
		if (ortho.notes) html += `<p>${esc(ortho.notes)}</p>`;
	}

	// Ortho assessment snapshots (IOTN new format or legacy KIG)
	if (orthoAssessments.length > 0) {
		html += `<h3 style="margin-top:1em">Ortho / IOTN Assessments (${orthoAssessments.length})</h3>`;
		for (const a of orthoAssessments) {
			const isIOTN = a.dhc != null || 'ac_grade' in a;
			const acGrade = (a as { ac_grade?: number }).ac_grade ?? 0;

			// Build score header string
			let scoreStr = '';
			if (isIOTN) {
				const dhc = a.dhc;
				if (dhc) {
					const sub = dhc.subcategory || '';
					const mm  = dhc.mm_value != null ? ` ${dhc.mm_value}mm` : '';
					scoreStr += `DHC ${sub || dhc.grade}${mm}`;
				}
				if (acGrade > 0) scoreStr += (scoreStr ? ' · ' : '') + `AC ${acGrade}`;
			} else {
				const covered = (a.findings ?? []).some((f: { grade: number }) => f.grade >= 3);
				scoreStr = covered ? 'Insurance-covered (grade ≥ 3)' : 'Not covered';
			}

			const scoreColor = isIOTN
				? ((a.dhc?.grade ?? 0) >= 4 || acGrade >= 8 ? '#dc2626' : (a.dhc?.grade ?? 0) >= 3 || acGrade >= 5 ? '#b45309' : '#6b7280')
				: ((a.findings ?? []).some((f: { grade: number }) => f.grade >= 3) ? '#b45309' : '#6b7280');

			html += `<div class="avoid-break" style="margin-bottom:1em;padding:0.75em;border:1px solid #e5e7eb;border-radius:6px">
				<div style="display:flex;align-items:center;gap:1em;margin-bottom:0.5em">
					<strong>${esc(a.exam_date ?? '')}</strong>
					<span style="color:${scoreColor};font-weight:600;font-size:0.85em;font-family:monospace">${esc(scoreStr)}</span>
				</div>`;
				// Context fields
			const ctx: string[] = [];
			if (a.dentition_stage) ctx.push(({ primary: 'Primary', mixed: 'Mixed', permanent: 'Permanent' } as Record<string,string>)[a.dentition_stage] ?? a.dentition_stage);
			if (a.treatment_phase) ctx.push(({ expectative: 'Watchful waiting', early: 'Early treatment', main: 'Main treatment', adult: 'Adult treatment' } as Record<string,string>)[a.treatment_phase] ?? a.treatment_phase);
			if (a.angle_class) ctx.push(({ class_I: 'Class I', class_II_div1: 'Class II/1', class_II_div2: 'Class II/2', class_III: 'Class III' } as Record<string,string>)[a.angle_class] ?? a.angle_class);
			if (a.cvm_stage > 0) ctx.push(`CVM ${a.cvm_stage}`);
			if (a.facial_profile) ctx.push(({ straight: 'Straight profile', convex: 'Convex profile', concave: 'Concave profile' } as Record<string,string>)[a.facial_profile] ?? a.facial_profile);
			if (ctx.length > 0) html += `<p style="font-size:0.8em;color:#6b7280;margin:0.25em 0">${ctx.join(' · ')}</p>`;

			// Bad habits
			if (a.bad_habits && a.bad_habits.length > 0) {
				const habitEN: Record<string,string> = { thumbSucking: 'Thumb sucking', tongueThrusting: 'Tongue thrusting', mouthBreathing: 'Mouth breathing', lipBiting: 'Lip biting', nailBiting: 'Nail biting', bruxism: 'Bruxism', pacifierUse: 'Pacifier use', penChewing: 'Pen/pencil chewing' };
				const labels = a.bad_habits.map((k: string) => habitEN[k] ?? k);
				html += `<p style="font-size:0.8em;color:#7c3aed;margin:0.25em 0"><strong>Bad Habits:</strong> ${esc(labels.join(', '))}</p>`;
			}

			// IOTN detail rows
			if (isIOTN && a.dhc) {
				const dhcSubcats: Record<string,string> = {
					'2a':'Overjet > 3.5–6 mm, competent lips','2b':'Reverse overjet 0–1 mm','2c':'Crossbite ≤ 1 mm discrepancy','2d':'Displacement > 1–2 mm','2e':'Open bite > 1–2 mm','2f':'Overbite > ½ incisor ht, no trauma','2g':'Pre-/post-normal, no anomalies','2h':'Submerged deciduous','2i':'Crossbite ≤ 1 mm discrepancy',
					'3a':'Overjet > 3.5–6 mm, incompetent lips','3b':'Reverse overjet > 1–3.5 mm','3c':'Crossbite > 1–2 mm','3d':'Displacement > 2–4 mm','3e':'Open bite > 2–4 mm','3f':'Complete overbite with trauma',
					'4a':'Overjet > 6–9 mm','4b':'Reverse overjet > 3.5 mm, no difficulties','4c':'Crossbite > 2 mm','4d':'Severe displacement > 4 mm','4e':'Extreme open bite > 4 mm','4f':'Complete overbite with trauma','4h':'Hypodontia requiring ortho','4i':'Posterior lingual crossbite, no contact','4j':'Reverse overjet > 1–3.5 mm with difficulties','4k':'Submerged permanent teeth','4l':'Partially erupted, tipped/impacted','4m':'Supernumerary teeth',
					'5a':'Overjet > 9 mm','5h':'Extensive hypodontia (>1 tooth/quadrant)','5i':'Impeded eruption (excl. 3rd molars)','5m':'Reverse overjet > 3.5 mm with difficulties','5p':'Cleft palate/craniofacial anomaly','5s':'Submerged deciduous teeth',
				};
				const needLevels: Record<number,string> = { 1:'No need', 2:'Little need', 3:'Moderate need', 4:'Great need', 5:'Very great need' };
				const dhc = a.dhc;
				const sub = dhc.subcategory || '';
				const mm  = dhc.mm_value != null ? ` (${dhc.mm_value} mm)` : '';
				const desc = sub ? (dhcSubcats[sub] ?? '') : '';
				html += `<table class="info-table" style="font-size:0.85em">
					<tr><th>DHC Grade</th><th>Subcategory</th><th>Description</th></tr>
					<tr>
						<td><strong>Grade ${dhc.grade}</strong> — ${esc(needLevels[dhc.grade] ?? '')}</td>
						<td><strong>${esc(sub || '—')}</strong>${mm}</td>
						<td style="color:#374151">${esc(desc)}</td>
					</tr>
				</table>`;
				if (acGrade > 0) {
					const acDescs: Record<number,string> = { 1:'Excellent', 2:'Good', 3:'Fairly good', 4:'Acceptable', 5:'Moderate', 6:'Moderate/poor', 7:'Poor', 8:'Very poor', 9:'Very poor — severe', 10:'Extremely poor' };
					html += `<p style="font-size:0.85em;margin-top:0.35em"><strong>AC ${acGrade}</strong> — ${esc(acDescs[acGrade] ?? '')}</p>`;
				}
			} else if (!isIOTN && (a.findings ?? []).length > 0) {
				// Legacy KIG table
				html += `<table class="info-table" style="font-size:0.85em">
					<tr>
						<th>Group</th>
						<th>Grade</th>
						<th>Value</th>
					</tr>`;
				for (const f of (a.findings ?? [])) {
					html += `<tr>
						<td><strong>${esc(String(f.group))}</strong></td>
						<td>${f.grade}</td>
						<td>${f.measured_value != null ? f.measured_value + ' mm' : '—'}</td>
					</tr>`;
				}
				html += `</table>`;
			}
			// Biss (bite) data
			const bissRight = (a as any).biss_right as { type: string; praemolarenbreite: number | null } | null | undefined;
			const bissLeft  = (a as any).biss_left  as { type: string; praemolarenbreite: number | null } | null | undefined;
			if (bissRight || bissLeft) {
				const bissTypeEN: Record<string,string> = { neutral: 'Neutral occlusion', distal: 'Distal occlusion', mesial: 'Mesial occlusion' };
				const pbFrac: Record<number,string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
				function pbLabel(v: number): string {
					const w = Math.floor(v); const d = +(v - w).toFixed(2);
					return w > 0 ? w + (pbFrac[d] ?? '') : (pbFrac[d] ?? String(v));
				}
				function formatBiss(b: { type: string; praemolarenbreite: number | null }): string {
					const tl = bissTypeEN[b.type] ?? b.type;
					const pb = b.praemolarenbreite != null ? ` ${pbLabel(b.praemolarenbreite)} PW` : '';
					return esc(tl + pb);
				}
				const parts: string[] = [];
				if (bissRight) parts.push(`<span style="margin-right:1em"><strong>Right:</strong> ${formatBiss(bissRight)}</span>`);
				if (bissLeft)  parts.push(`<span><strong>Left:</strong> ${formatBiss(bissLeft)}</span>`);
				html += `<p style="font-size:0.875em;margin-top:0.5em"><strong>Bite:</strong> ${parts.join(' ')}</p>`;
			}
			if (a.treatment_recommendation) html += `<p style="font-size:0.875em;margin-top:0.5em"><strong>Recommendation:</strong> ${esc(a.treatment_recommendation)}</p>`;
			if (a.notes) html += `<p style="font-size:0.875em;color:#374151;margin-top:0.25em">${esc(a.notes)}</p>`;
			html += `</div>`;
		}
	}

	html += `</div>`;
	return html;
}

function calcDMFTExport(entries: ToothChartEntry[]): { D: number; M: number; F: number } {
	let D = 0, M = 0, F = 0;
	for (const e of entries) {
		if (e.condition === 'extracted') { M++; continue; }
		if (e.condition === 'missing') {
			const isArchPlaceholder = !e.notes?.trim() && (e.surfaces === '{}' || !e.surfaces) && !e.bridge_group_id;
			if (!isArchPlaceholder) M++;
			continue;
		}
		let hasDecayed = (e.condition === 'decayed');
		let hasFilled  = (e.condition === 'filled' || e.condition === 'crowned');
		try {
			const surfs = JSON.parse(e.surfaces || '{}') as Record<string, unknown>;
			for (const v of Object.values(surfs)) {
				const tag = getSurfTagFromExport(v);
				if (tag === 'decayed' || tag === 'decayed_radiographic') hasDecayed = true;
				// inlay_planned is excluded — a planned restoration is not yet an F
				if (tag === 'filled' || tag === 'inlay') hasFilled = true;
			}
		} catch { /* skip */ }
		if (hasDecayed) D++;
		else if (hasFilled) F++;
	}
	return { D, M, F };
}

function isPrimaryToothExport(n: number): boolean {
	return (n >= 51 && n <= 55) || (n >= 61 && n <= 65) ||
	       (n >= 71 && n <= 75) || (n >= 81 && n <= 85);
}

function renderChart(
	data: PatientExportData,
	tags: TagConfig[],
	bridgeConfigs: BridgeRoleConfig[],
	prosthesisConfigs: ProsthesisTypeConfig[],
	fillingMaterialConfigs: FillingMaterialConfig[],
): string {
	const svgMarkup = renderChartSVG(data.chartData, tags, bridgeConfigs, prosthesisConfigs, fillingMaterialConfigs);

	// DMFT score
	const permanentTeeth = data.chartData.filter(e => !isPrimaryToothExport(e.tooth_number));
	const primaryTeeth   = data.chartData.filter(e => isPrimaryToothExport(e.tooth_number));
	const dmft = calcDMFTExport(permanentTeeth);
	const dmftTotal = dmft.D + dmft.M + dmft.F;
	let dmftLine = `DMFT: <strong>${dmftTotal}</strong> (D:${dmft.D} M:${dmft.M} F:${dmft.F})`;
	if (primaryTeeth.length > 0) {
		const dt = calcDMFTExport(primaryTeeth);
		dmftLine += ` &nbsp;|&nbsp; dmft: <strong>${dt.D + dt.M + dt.F}</strong> (d:${dt.D} m:${dt.M} f:${dt.F})`;
	}

	// Per-tooth surface text summary (only teeth with surface data)
	const surfaceRows = data.chartData
		.filter(entry => entry.surfaces && entry.surfaces !== '{}')
		.map(entry => {
			let surfMap: Record<string, unknown> = {};
			try { surfMap = JSON.parse(entry.surfaces) as Record<string, unknown>; } catch { /* skip */ }
			const surfEntries = Object.entries(surfMap).filter(([, v]) => getSurfTagFromExport(v));
			if (surfEntries.length === 0) return '';
			const fdi = toFDI(entry.tooth_number);
			const surfStr = surfEntries
				.map(([k, v]) => `${k}: ${esc(getSurfLabelFromExport(v))}`)
				.join(', ');
			return `<tr><td>${fdi}</td><td>${esc(entry.condition)}</td><td>${surfStr}</td><td>${esc(entry.notes)}</td></tr>`;
		})
		.filter(Boolean);

	let toothTable = '';
	if (surfaceRows.length > 0) {
		toothTable = `
	<h3 style="margin-top:1em">Surface Findings</h3>
	<table class="info-table" style="font-size:0.85em">
		<thead><tr>
			<th>Tooth</th>
			<th>Condition</th>
			<th>Surfaces</th>
			<th>Notes</th>
		</tr></thead>
		<tbody>${surfaceRows.join('')}</tbody>
	</table>`;
	}

	// Tooth notes grouped by tooth
	let toothNotesSection = '';
	if (data.toothNotes.length > 0) {
		const byTooth = new Map<number, typeof data.toothNotes>();
		for (const n of data.toothNotes) {
			if (!byTooth.has(n.tooth_number)) byTooth.set(n.tooth_number, []);
			byTooth.get(n.tooth_number)!.push(n);
		}
		const today = toLocalISODate();
		let rows = '';
		for (const [tooth, notes] of [...byTooth.entries()].sort((a, b) => a[0] - b[0])) {
			for (const note of notes) {
				const due = note.reminder_date && note.reminder_date <= today;
				const reminderLabel = note.reminder_date
					? ` <span style="color:${due ? '#dc2626' : '#d97706'}">[Reminder: ${fmtDate(note.reminder_date)}${due ? ' ⚠' : ''}]</span>`
					: '';
				rows += `<tr><td>${toFDI(tooth)}</td><td>${esc(note.text)}${reminderLabel}</td><td style="color:#94a3b8;font-size:0.9em">${fmtDate(note.created_at)}</td></tr>`;
			}
		}
		toothNotesSection = `
	<h3 style="margin-top:1em">Tooth Notes</h3>
	<table class="info-table" style="font-size:0.85em">
		<thead><tr>
			<th>Tooth</th>
			<th>Note</th>
			<th>Date</th>
		</tr></thead>
		<tbody>${rows}</tbody>
	</table>`;
	}

	// Position findings
	const positionRows = data.chartData
		.filter(e => e.migration || e.tipping || e.rotation || e.foreign_work)
		.sort((a, b) => a.tooth_number - b.tooth_number)
		.map(e => {
			const fdi = toFDI(e.tooth_number);
			const parts: string[] = [];
			if (e.foreign_work) parts.push(`<strong>Foreign work</strong>`);
			if (e.migration)    parts.push(`Migration: ${esc(e.migration)}`);
			if (e.tipping)      parts.push(`Tipping: ${esc(e.tipping)}`);
			if (e.rotation)     parts.push(`Rotation: ${esc(e.rotation)}`);
			return `<tr><td>${fdi}</td><td>${parts.join(' · ')}</td></tr>`;
		});

	let positionSection = '';
	if (positionRows.length > 0) {
		positionSection = `
	<h3 style="margin-top:1em">Tooth Position</h3>
	<table class="info-table" style="font-size:0.85em">
		<thead><tr><th>Tooth</th><th>Finding</th></tr></thead>
		<tbody>${positionRows.join('')}</tbody>
	</table>`;
	}

	// Shade findings
	const shadeRows = data.chartData
		.filter(e => e.shade)
		.sort((a, b) => a.tooth_number - b.tooth_number)
		.map(e => `<tr><td>${toFDI(e.tooth_number)}</td><td>${esc(e.shade!)}</td></tr>`);

	let shadeSection = '';
	if (shadeRows.length > 0) {
		shadeSection = `
	<h3 style="margin-top:1em">Tooth Shades</h3>
	<table class="info-table" style="font-size:0.85em">
		<thead><tr><th>Tooth</th><th>Shade</th></tr></thead>
		<tbody>${shadeRows.join('')}</tbody>
	</table>`;
	}

	// Watch status findings (under observation)
	interface SurfDataExport { tag?: string; watch?: string }
	const watchRows: string[] = [];
	for (const e of [...data.chartData].sort((a, b) => a.tooth_number - b.tooth_number)) {
		const fdi = toFDI(e.tooth_number);
		const parts: string[] = [];
		if (e.watch_status) parts.push('<strong>Under Observation</strong>');
		// Per-surface watch
		if (e.surfaces && e.surfaces !== '{}') {
			try {
				const surfs = JSON.parse(e.surfaces) as Record<string, string | SurfDataExport>;
				for (const [sk, sv] of Object.entries(surfs)) {
					if (typeof sv === 'object' && sv.watch) {
						parts.push(`Surface ${sk}: Under Observation`);
					}
				}
			} catch { /* skip */ }
		}
		if (parts.length > 0) watchRows.push(`<tr><td>${fdi}</td><td>${parts.join('; ')}</td></tr>`);
	}
	let watchSection = '';
	if (watchRows.length > 0) {
		watchSection = `
	<h3 style="margin-top:1em">Watch Status</h3>
	<table class="info-table" style="font-size:0.85em">
		<thead><tr><th>Tooth</th><th>Status</th></tr></thead>
		<tbody>${watchRows.join('')}</tbody>
	</table>`;
	}

	return `
<div class="section">
	<h2>Dental Chart (current)</h2>
	<p style="font-size:0.85em;color:#64748b;margin-bottom:0.75em">${dmftLine}</p>
	<div class="chart-container">${svgMarkup}</div>${toothTable}${watchSection}${positionSection}${shadeSection}${toothNotesSection}
</div>`;
}

function renderEndo(data: PatientExportData): string {
	const { endoRecords } = data;
	if (endoRecords.length === 0) return '';

	let html = `<div class="section page-break"><h2>Endo Documentation</h2>`;

	// Group records by tooth number
	const byTooth = new Map<number, EndoRecord[]>();
	for (const rec of endoRecords) {
		const list = byTooth.get(rec.tooth_number) ?? [];
		list.push(rec);
		byTooth.set(rec.tooth_number, list);
	}

	for (const [toothNum, records] of [...byTooth.entries()].sort((a, b) => a[0] - b[0])) {
		const fdi = toFDI(toothNum);
		const toothLabel = FDI_TOOTH_NAMES[fdi] ?? String(fdi);
		html += `<div class="endo-tooth avoid-break">`;
		html += `<h3>Tooth ${fdi} — ${esc(toothLabel)}</h3>`;

		for (const rec of records) {
			html += `<div class="endo-session">`;
			html += `<p class="endo-session-date"><strong>${fmtDate(rec.treatment_date)}</strong></p>`;
			if (rec.notes?.trim()) {
				html += `<p class="endo-notes">${esc(rec.notes)}</p>`;
			}
			if (rec.canals.length > 0) {
				html += `<table class="endo-table">
					<thead><tr>
						<th>Canal</th>
						<th>Instrument</th>
						<th>ISO</th>
						<th>X-ray (mm)</th>
						<th>Prep. (mm)</th>
						<th>Electr. (mm)</th>
						<th>Reference Point</th>
						<th>Def. Length (mm)</th>
					</tr></thead>
					<tbody>`;
				for (const c of rec.canals) {
					html += `<tr>
						<td>${esc(c.canal_name)}</td>
						<td>${esc(c.instrument)}</td>
						<td>${c.iso_size != null ? c.iso_size : '—'}</td>
						<td>${c.length_xray != null ? c.length_xray : '—'}</td>
						<td>${c.length_preparation != null ? c.length_preparation : '—'}</td>
						<td>${c.length_electronic != null ? c.length_electronic : '—'}</td>
						<td>${esc(c.reference_point)}</td>
						<td>${c.definitive_length != null ? c.definitive_length : '—'}</td>
					</tr>`;
				}
				html += `</tbody></table>`;
			}
			html += `</div>`;
		}

		html += `</div>`;
	}

	html += '</div>';
	return html;
}

function renderTimeline(
	data: PatientExportData,
	tags: TagConfig[],
	bridgeConfigs: BridgeRoleConfig[],
	prosthesisConfigs: ProsthesisTypeConfig[],
	fillingMaterialConfigs: FillingMaterialConfig[],
): string {
	const { entries, doctors, complicationsByEntry } = data;
	if (entries.length === 0) return `<div class="section"><h2>Clinical Timeline</h2><p class="empty">No entries.</p></div>`;

	let html = `<div class="section"><h2>Clinical Timeline</h2>`;

	for (const entry of entries) {
		// par_step entries render as a slim inline milestone row — no full entry box
		if (entry.entry_type === 'par_step') {
			let parMetaStr = '';
			try {
				const m = JSON.parse(entry.description ?? '{}') as { bop?: number; max_pocket?: number; risk?: string };
				if (typeof m.bop === 'number') {
					parMetaStr = ` · BOP ${m.bop.toFixed(0)}% · Max ${m.max_pocket ?? 0}mm · ${
						m.risk === 'stable' ? 'Stable' : m.risk === 'high_risk' ? 'High risk' : 'Maintenance'
					}`;
				}
			} catch { /* skip */ }
			html += `<div class="entry avoid-break" style="border-left:3px solid #2dd4bf;padding-left:10px;background:none;border:none;border-left:3px solid #2dd4bf;">`;
			html += `<div class="entry-header"><span class="entry-date">${fmtDate(entry.entry_date)}</span>`;
			html += `<span class="entry-type" style="background:#f0fdfa;color:#0f766e;">PAR</span></div>`;
			html += `<p class="entry-title" style="margin:2px 0;">✓ ${esc(entry.title)}${esc(parMetaStr)}</p>`;
			html += `</div>`;
			continue;
		}

		const isSnapshot = entry.entry_type === 'chart_snapshot';
		const comps = complicationsByEntry.get(entry.id) ?? [];
		const doctorStr = doctorName(entry.doctor_id, entry.colleague_ids, doctors);
		// Timeline tooth_numbers are FDI notation (normalized by the v66 migration)
		const teeth = entry.tooth_numbers ? entry.tooth_numbers.split(',').map(t => t.trim()).join(', ') : '';

		html += `<div class="entry avoid-break">`;
		html += `<div class="entry-header">`;
		html += `<span class="entry-date">${fmtDate(entry.entry_date)}</span>`;
		// Composer entries save with entry_type '' — skip the badge instead of rendering an empty pill.
		// System types with a friendlier display name than the raw key get mapped here (export
		// HTML is standalone, so labels are hardcoded like the rest of this file — no i18n store).
		const typeBadge = entry.entry_type === 'xray_report' ? 'X-ray Report'
			: entry.entry_type === 'facial_analysis' ? 'Facial Analysis'
			: entry.entry_type;
		if (typeBadge) html += `<span class="entry-type">${esc(typeBadge)}</span>`;
		if (entry.treatment_category) html += `<span class="entry-cat">${esc(entry.treatment_category)}</span>`;
		if (entry.treatment_outcome) html += `<span class="entry-outcome">${esc(entry.treatment_outcome)}</span>`;
		html += `</div>`;
		// Auto-generated titles just repeat the description's first words — same rule as TimelineEntryCard
		if (!titleIsRedundant(entry.title, entry.description)) {
			html += `<p class="entry-title">${esc(entry.title)}</p>`;
		}
		if (teeth) html += `<p class="entry-teeth">Teeth: ${esc(teeth)}</p>`;
		if (doctorStr) html += `<p class="entry-doctor">Doctor: ${esc(doctorStr)}</p>`;

		if (isSnapshot && entry.chart_data) {
			try {
				const snapshotChart = JSON.parse(entry.chart_data) as ToothChartEntry[];
				const snapshotSvg = renderChartSVG(snapshotChart, tags, bridgeConfigs, prosthesisConfigs, fillingMaterialConfigs);
				html += `<div class="chart-container chart-snapshot">${snapshotSvg}</div>`;
			} catch { /* skip malformed snapshot */ }
		} else if (entry.description?.trim()) {
			html += `<div class="entry-desc">${entry.description}</div>`;
		}

		// Attachments — images inline, everything else as a link into the copied folder tree
		try {
			const attachments = JSON.parse(entry.attachments || '[]') as Array<{ path: string; name: string; mime: string }>;
			for (const att of attachments) {
				const filename = att.path.split('/').pop() ?? att.name;
				// Path within the patient folder (subfolder-safe); legacy fallback: parent dir only
				const relSrc = pathInPatientFolder(att.path, data.patient.patient_id)
					?? `${att.path.replace(/\\/g, '/').split('/').slice(-2, -1)[0] ?? 'documents'}/${filename}`;
				if (att.mime && att.mime.startsWith('image/')) {
					html += `<figure class="attachment"><img src="${esc(relSrc)}" alt="${esc(att.name)}" loading="lazy"/><figcaption>${esc(att.name)}</figcaption></figure>`;
				} else {
					html += `<p class="attachment-file">📎 <a href="${esc(relSrc)}">${esc(att.name)}</a></p>`;
				}
			}
		} catch { /* ignore */ }

		if (comps.length > 0) {
			html += `<ul class="complications">${comps.map(c => `<li><strong>${esc(c.complication_type)}</strong>${c.severity ? ' [' + esc(c.severity) + ']' : ''}${c.date_reported ? ' ' + fmtDate(c.date_reported) : ''} — ${esc(c.description)}${c.resolved ? ` ✓${c.date_resolved ? ' ' + fmtDate(c.date_resolved) : ''}` : ''}</li>`).join('')}</ul>`;
		}

		html += `</div>`;
	}

	html += '</div>';
	return html;
}

function renderPerio(data: PatientExportData): string {
	const { probingRecords } = data;
	if (probingRecords.length === 0) return '';

	let html = `<div class="section page-break"><h2>Periodontal Records</h2>`;

	for (const { record, measurements, toothData } of probingRecords) {
		html += `<div class="perio-record avoid-break">`;
		html += `<h3>${fmtDate(record.exam_date)}${record.examiner ? ' — ' + esc(record.examiner) : ''}</h3>`;

		if (measurements.length > 0) {
			// Group by tooth number
			const byTooth = new Map<number, ProbingMeasurement[]>();
			for (const m of measurements) {
				const list = byTooth.get(m.tooth_number) ?? [];
				list.push(m);
				byTooth.set(m.tooth_number, list);
			}

			const hasRecession = measurements.some(m => m.recession != null);
			html += `<table class="perio-table"><thead><tr><th>FDI</th><th>DB</th><th>B</th><th>MB</th><th>DL</th><th>L</th><th>ML</th></tr></thead><tbody>`;
			for (const [toothNum, meas] of [...byTooth.entries()].sort((a, b) => a[0] - b[0])) {
				const sites = ['DB', 'B', 'MB', 'DL', 'L', 'ML'];
				const measMap = new Map(meas.map(m => [m.site, m]));
				html += `<tr><th>${toFDI(toothNum)}</th>`;
				for (const site of sites) {
					const m = measMap.get(site);
					const pd = m?.pocket_depth ?? null;
					const bop = m?.bleeding_on_probing ?? 0;
					const rec = m?.recession ?? null;
					const cls = pd === null ? '' : pd >= 6 ? ' class="pd-severe"' : pd >= 4 ? ' class="pd-moderate"' : '';
					const recStr = rec != null ? `<span style="color:#64748b;font-size:0.85em">/${rec}</span>` : '';
					html += `<td${cls}>${pd !== null ? pd : '—'}${recStr}${bop ? '*' : ''}</td>`;
				}
				html += '</tr>';
			}
			html += '</tbody></table>';
			const legendParts = ['* = Bleeding on probing'];
			if (hasRecession) legendParts.push('/n = Recession (mm)');
			html += `<p class="perio-legend">${legendParts.join(' · ')}</p>`;
		}

		// Mobility / furcation / per-tooth notes
		const toothRows = (toothData ?? [])
			.filter(t => t.mobility != null || t.furcation != null || (t.furcation_sites ?? '') !== '' || (t.notes ?? '').trim() !== '')
			.sort((a, b) => a.tooth_number - b.tooth_number);
		if (toothRows.length > 0) {
			html += `<table class="perio-table" style="margin-top:6px"><thead><tr>
				<th>FDI</th>
				<th>Mobility</th>
				<th>Furcation</th>
				<th>Notes</th>
			</tr></thead><tbody>`;
			for (const t of toothRows) {
				const furk = t.furcation != null
					? `Grade ${t.furcation}${t.furcation_sites ? ` (${esc(t.furcation_sites)})` : ''}`
					: '—';
				html += `<tr><th>${toFDI(t.tooth_number)}</th><td>${t.mobility != null ? t.mobility : '—'}</td><td>${furk}</td><td style="text-align:left">${esc(t.notes ?? '')}</td></tr>`;
			}
			html += '</tbody></table>';
		}

		if (record.notes?.trim()) {
			html += `<p>${esc(record.notes)}</p>`;
		}
		html += '</div>';
	}

	html += '</div>';
	return html;
}

// ── PAR ────────────────────────────────────────────────────────────────────

const PAR_STEP_LABEL: Record<string, string> = {
	baseline:       'Baseline (PA)',
	ait:            'AIT',
	reevaluation:   'Re-evaluation (UPT)',
	correction:     'Correction',
	maintenance:    'UPT Maintenance',
};

const PAR_RISK_LABEL: Record<string, string> = {
	stable:      'Stable',
	maintenance: 'Maintenance',
	high_risk:   'High risk',
};

const PAR_SITES_BUC = ['db', 'b', 'mb'] as const;
const PAR_SITES_LIN = ['dl', 'l', 'ml'] as const;

function renderPar(data: PatientExportData): string {
	const { parData } = data;
	if (parData.length === 0) return '';

	let html = `<div class="section page-break"><h2>PAR Periodontal Treatment</h2>`;

	for (const { parCase, snapshots } of parData) {
		const gradeLabel = parCase.grade ? `Grade ${parCase.grade}` : '';
		const caseLabel = gradeLabel || 'PAR Case';
		const endStr = parCase.end_date ? ` – ${fmtDate(parCase.end_date)}` : '';
		html += `<h3>${esc(caseLabel)}${endStr}</h3>`;

		if (snapshots.length === 0) {
			html += `<p class="empty">No measurements recorded.</p>`;
			continue;
		}

		for (const snap of snapshots) {
			const { assessment, measurements, toothData } = snap;
			const stats = computeAssessmentStats(snap);
			const typeLabel = PAR_STEP_LABEL[assessment.type] ?? assessment.type;

			html += `<div class="perio-record avoid-break">`;
			html += `<h4 style="margin:8px 0 4px;font-size:12px;font-weight:600;">${esc(typeLabel)} — ${fmtDate(assessment.exam_date)}</h4>`;

			// Stats strip
			html += `<p style="font-size:11px;color:#475569;margin:2px 0 6px;">` +
				`BOP: <strong>${stats.bopPercent.toFixed(0)}%</strong> · ` +
				`Max PD: <strong>${stats.maxPocket}mm</strong> · ` +
				`Mean PD: <strong>${stats.meanPocket.toFixed(1)}mm</strong> · ` +
				`CAL: <strong>${stats.cal.toFixed(1)}mm</strong> · ` +
				`Risk: <strong>${PAR_RISK_LABEL[stats.riskLevel] ?? stats.riskLevel}</strong>` +
				`</p>`;

			if (measurements.length === 0) {
				html += `<p class="empty">No measurements recorded.</p></div>`;
				continue;
			}

			// Group measurements by tooth
			const byTooth = new Map<number, typeof measurements>();
			for (const m of measurements) {
				const list = byTooth.get(m.tooth) ?? [];
				list.push(m);
				byTooth.set(m.tooth, list);
			}

			const sortedTeeth = [...byTooth.keys()].sort((a, b) => a - b);

			html += `<table class="perio-table"><thead>
				<tr>
					<th>FDI</th>
					<th colspan="3">Buccal (DB / B / MB)</th>
					<th colspan="3">Lingual (DL / L / ML)</th>
					<th>Mob</th>
					<th>Furc</th>
					<th>Flags</th>
				</tr></thead><tbody>`;

			for (const tooth of sortedTeeth) {
				const meas = byTooth.get(tooth) ?? [];
				const mmap = new Map(meas.map(m => [m.site, m]));
				const td = toothData.find(t => t.tooth === tooth);
				const status = td?.status ?? null;
				const mob = td?.mobility ?? null;

				const cellVal = (site: import('$lib/types').ParSite) => {
					const m = mmap.get(site);
					if (!m) return '—';
					const pd = m.pocket;
					const rec = m.recession;
					const bop = m.bop;
					if (pd == null) return '—';
					const cls = pd >= 6 ? ' class="pd-severe"' : pd >= 4 ? ' class="pd-moderate"' : '';
					const recStr = rec != null && rec > 0 ? `<span style="color:#64748b;font-size:0.85em">/${rec}</span>` : '';
					const bopDot = bop > 0 ? (bop === 2 ? '◆' : '●') : '';
					return `${pd}${recStr}${bopDot ? `<span style="color:#ef4444;font-size:8px">${bopDot}</span>` : ''}`;
				};

				const furcB = td?.furcation_b;
				const furcM = td?.furcation_m;
				const furcD = td?.furcation_d;
				const furcStr = [
					furcB != null && furcB > 0 ? `B:${furcB}` : '',
					furcM != null && furcM > 0 ? `M:${furcM}` : '',
					furcD != null && furcD > 0 ? `D:${furcD}` : '',
				].filter(Boolean).join(' ') || '—';

				const flags = [
					status ? esc(status) : '',
					td?.ait_planned ? 'AIT' : '',
					td?.cpt_planned ? 'CPT' : '',
					td?.vitality === 0 ? 'non-vital' : '',
				].filter(Boolean).join(', ');

				html += `<tr>
					<th>${tooth}</th>
					<td>${cellVal('db')}</td><td>${cellVal('b')}</td><td>${cellVal('mb')}</td>
					<td>${cellVal('dl')}</td><td>${cellVal('l')}</td><td>${cellVal('ml')}</td>
					<td>${mob != null ? ['0','I','II','III'][mob] ?? mob : '—'}</td>
					<td>${furcStr}</td>
					<td style="text-align:left;font-size:10px">${flags}</td>
				</tr>`;
			}

			html += `</tbody></table>`;
			html += `<p class="perio-legend">● BOP · ◆ Pus · /n = Recession · Mob = Mobility grade</p>`;
			html += `</div>`;
		}
	}

	html += '</div>';
	return html;
}

// Procedure key → human-readable label for export
const PROC_LABELS: Record<string, string> = {
	plan_extract:         'Extraction',
	plan_fill:            'Filling',
	plan_crown:           'Crown',
	plan_rct:             'Root Canal',
	plan_bridge:          'Bridge',
	plan_implant:         'Implant',
	plan_veneer:          'Veneer',
	plan_partial_denture: 'Partial Denture',
	plan_full_denture:    'Full Denture',
	plan_watch:           'Watch',
};

function renderPlans(data: PatientExportData): string {
	const { plans, planItems } = data;
	if (plans.length === 0) return '';

	let html = `<div class="section page-break"><h2>Treatment Plans</h2>`;

	for (const plan of plans) {
		const items = planItems.get(plan.plan_id) ?? [];
		html += `<div class="plan avoid-break">`;
		html += `<h3>${esc(plan.title)} <span class="plan-status">[${esc(plan.status)}]</span></h3>`;
		if (plan.description) html += `<p>${esc(plan.description)}</p>`;

		// Planned chart overview — parse { procedures, notes, entries } format (+ legacy fallbacks)
		// procedures: Record<string, string[]> — tooth number → array of plan_* keys
		// notes: Record<string, string> — tooth number → free-text notes
		let procMap: Record<string, string[]> = {};
		let notesMap: Record<string, string> = {};
		try {
			const parsed = JSON.parse(plan.plan_chart_data ?? '{}');
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
				if ('steps' in parsed) {
					// New format: { steps: PlanStep[], notes, entries }
					const steps = (parsed.steps ?? []) as Array<{ teeth: number[]; procKey: string; bridgeGroupId?: string }>;
					notesMap = parsed.notes ?? {};
					for (const step of steps) {
						if (!step.bridgeGroupId) {
							for (const t of step.teeth) {
								const k = String(t);
								if (!procMap[k]) procMap[k] = [];
								if (!procMap[k].includes(step.procKey)) procMap[k].push(step.procKey);
							}
						}
					}
				} else if ('procedures' in parsed || 'entries' in parsed) {
					const rawProcs = (parsed.procedures ?? {}) as Record<string, string | string[]>;
					for (const [k, v] of Object.entries(rawProcs)) {
						procMap[k] = Array.isArray(v) ? v : [v];
					}
					notesMap = parsed.notes ?? {};
				} else {
					// Legacy flat Record<string,string>
					for (const [k, v] of Object.entries(parsed as Record<string, string>)) {
						procMap[k] = [v];
					}
				}
			}
		} catch { /* ignore */ }

		const procEntries = Object.entries(procMap)
			.map(([toothStr, procs]) => ({ tooth: Number(toothStr), procs }))
			.filter(r => r.procs.length > 0)
			.sort((a, b) => a.tooth - b.tooth);

		if (procEntries.length > 0) {
			html += `<p class="plan-chart-header"><strong>Planned Procedures (Dental Chart):</strong></p>`;
			html += `<table class="plan-table"><thead><tr><th>FDI</th><th>Procedures</th><th>Notes</th></tr></thead><tbody>`;
			for (const { tooth, procs } of procEntries) {
				const fdi = String(toFDI(tooth));
				const labels = procs.map(p => PROC_LABELS[p] ?? p).join(', ');
				const note = notesMap[String(tooth)] ?? '';
				html += `<tr><td>${esc(fdi)}</td><td>${esc(labels)}</td><td>${esc(note)}</td></tr>`;
			}
			html += '</tbody></table>';
		}

		if (items.length > 0) {
			html += `<table class="plan-table" style="margin-top:8px"><thead><tr><th>#</th><th>Procedure</th><th>Teeth</th><th>Status</th><th>Cost</th></tr></thead><tbody>`;
			for (const item of items) {
				const statusDone = item.status === 'completed';
				html += `<tr${statusDone ? ' class="item-done"' : ''}><td>${item.sequence_order}</td><td>${esc(item.description)}</td><td>${esc(item.tooth_numbers)}</td><td>${esc(item.status)}</td><td>${item.estimated_cost ? item.estimated_cost.toFixed(2) : ''}</td></tr>`;
			}
			html += '</tbody></table>';
			const total = items.reduce((sum, i) => sum + (i.estimated_cost ?? 0), 0);
			if (total > 0) html += `<p class="plan-total">Total: ${total.toFixed(2)}</p>`;
		}
		html += '</div>';
	}
	html += '</div>';
	return html;
}

function renderAppointments(data: PatientExportData): string {
	const { appointments } = data;
	if (appointments.length === 0) return '';

	let html = `<div class="section page-break"><h2>Appointments</h2>`;
	html += `<table class="doc-table"><thead><tr><th>Date</th><th>Time</th><th>Duration</th><th>Type</th><th>Doctor</th><th>Room</th><th>Status</th></tr></thead><tbody>`;
	for (const a of appointments) {
		const time = `${a.start_time.slice(11, 16)}–${a.end_time.slice(11, 16)}`;
		const typeLabel = [a.type_icon, a.type_name].filter(Boolean).join(' ') || '—';
		const statusCfg = appointmentStatuses.map[a.status];
		const statusLabel = statusCfg?.label ?? a.status;
		html += `<tr><td>${fmtDate(a.start_time)}</td><td>${esc(time)}</td><td>${a.duration_min} min</td><td>${esc(typeLabel)}</td><td>${esc(a.doctor_name ?? '—')}</td><td>${esc(a.room_name ?? '—')}</td><td>${esc(statusLabel)}</td></tr>`;
	}
	html += '</tbody></table></div>';
	return html;
}

function renderDocuments(data: PatientExportData): string {
	const { documents } = data;
	if (documents.length === 0) return '';

	let html = `<div class="section page-break"><h2>Document Index</h2>`;
	html += `<table class="doc-table"><thead><tr><th>Filename</th><th>Category</th><th>Date</th><th>Path</th><th>Notes</th></tr></thead><tbody>`;
	for (const doc of documents) {
		// Subfolder-safe path within the copied patient folder; legacy fallback: parent dir only
		const relPath = pathInPatientFolder(doc.rel_path, data.patient.patient_id)
			?? `${doc.rel_path.split('/').slice(-2, -1)[0] ?? doc.category}/${doc.rel_path.split('/').pop() ?? doc.filename}`;
		html += `<tr><td>${esc(doc.original_name || doc.filename)}</td><td>${esc(doc.category)}</td><td>${fmtDate(doc.created_at)}</td><td><code><a href="${esc(relPath)}">${esc(relPath)}</a></code></td><td>${esc(doc.notes || '')}</td></tr>`;
	}
	html += '</tbody></table></div>';
	return html;
}

// ── Full HTML document ─────────────────────────────────────────────────────

export function generatePatientHTML(
	data: PatientExportData,
	tags: TagConfig[],
	bridgeConfigs: BridgeRoleConfig[],
	prosthesisConfigs: ProsthesisTypeConfig[],
	fillingMaterialConfigs: FillingMaterialConfig[],
	options: PatientExportOptions,
): string {
	const { patient } = data;
	const sections = options.sections ?? {};
	const all = (k: keyof typeof sections) => sections[k] !== false;

	const bodyParts: string[] = [];
	bodyParts.push(renderCover(data));
	if (all('demographics')) bodyParts.push(renderDemographics(data));
	if (all('medical')) bodyParts.push(renderMedical(data, all('notes')));
	if (all('ortho') && (data.ortho || data.orthoAssessments.length > 0)) bodyParts.push(renderOrtho(data));
	if (all('chart')) bodyParts.push(renderChart(data, tags, bridgeConfigs, prosthesisConfigs, fillingMaterialConfigs));
	if (data.endoRecords.length > 0) bodyParts.push(renderEndo(data));
	if (all('timeline')) bodyParts.push(renderTimeline(data, tags, bridgeConfigs, prosthesisConfigs, fillingMaterialConfigs));
	if (all('perio')) bodyParts.push(renderPerio(data));
	if (all('par') && data.parData.length > 0) bodyParts.push(renderPar(data));
	if (all('plans')) bodyParts.push(renderPlans(data));
	if (all('appointments')) bodyParts.push(renderAppointments(data));
	if (all('documents')) bodyParts.push(renderDocuments(data));

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(patient.lastname)}, ${esc(patient.firstname)} — DentVault</title>
<style>
:root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 13px; color: #1a1a2e; }
@page { size: A4; margin: 18mm 16mm; }
body { margin: 0; padding: 0; }
h1, h2, h3 { margin: 0 0 6px; font-weight: 600; }
h2 { font-size: 15px; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 10px; color: #0f172a; }
h3 { font-size: 13px; color: #334155; margin-top: 10px; }
p { margin: 4px 0; }
ul { margin: 4px 0; padding-left: 18px; }
li { margin: 2px 0; }
table { border-collapse: collapse; width: 100%; margin: 8px 0; }
th, td { border: 1px solid #e2e8f0; padding: 4px 8px; text-align: left; font-size: 12px; }
th { background: #f8fafc; font-weight: 600; }
code { font-size: 11px; background: #f1f5f9; padding: 1px 3px; border-radius: 3px; }
.page-break { page-break-before: always; }
.avoid-break { page-break-inside: avoid; }
/* Cover */
.cover { min-height: 240mm; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 40px; }
.cover-logo { font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #64748b; margin-bottom: 24px; }
.cover-title { font-size: 28px; font-weight: 700; margin: 0 0 8px; }
.cover-sub { font-size: 16px; color: #64748b; margin: 0 0 32px; }
.cover-meta { width: auto; border: none; margin: 0 0 24px; }
.cover-meta th, .cover-meta td { border: none; padding: 3px 12px; text-align: left; }
.cover-footer { font-size: 11px; color: #94a3b8; }
/* Sections */
.section { margin-bottom: 20px; }
.info-table th { width: 160px; }
/* Entries */
.entry { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
.entry-header { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; flex-wrap: wrap; }
.entry-date { font-size: 12px; font-weight: 600; color: #475569; }
.entry-type { font-size: 10px; background: #f1f5f9; color: #475569; padding: 1px 6px; border-radius: 10px; border: 1px solid #e2e8f0; }
.entry-cat { font-size: 10px; background: #eff6ff; color: #1d4ed8; padding: 1px 6px; border-radius: 10px; }
.entry-outcome { font-size: 10px; background: #f0fdf4; color: #15803d; padding: 1px 6px; border-radius: 10px; }
.entry-title { font-weight: 600; margin: 4px 0; }
.entry-teeth, .entry-doctor { font-size: 11px; color: #64748b; margin: 2px 0; }
.entry-desc { font-size: 12px; margin-top: 6px; border-left: 2px solid #e2e8f0; padding-left: 8px; }
.richtext { font-size: 12px; border-left: 2px solid #e2e8f0; padding-left: 8px; margin: 6px 0; }
.complications { font-size: 11px; color: #b45309; margin: 4px 0; }
.attachment { margin: 8px 0; page-break-inside: avoid; }
.attachment img { max-width: 100%; max-height: 200px; border: 1px solid #e2e8f0; border-radius: 4px; display: block; }
.attachment figcaption { font-size: 10px; color: #94a3b8; margin-top: 2px; }
.attachment-file { font-size: 11px; margin: 4px 0; }
.attachment-file a { color: #1d4ed8; text-decoration: none; }
.attachment-file a:hover { text-decoration: underline; }
/* Chart */
.chart-container { margin: 8px 0; background: #fafafa; border: 1px solid #e2e8f0; border-radius: 6px; padding: 8px; page-break-inside: avoid; }
.chart-snapshot { background: #f8f8f8; }
/* Perio */
.perio-record { margin-bottom: 14px; }
.perio-table td, .perio-table th { padding: 3px 6px; font-size: 11px; text-align: center; }
.pd-moderate { background: #fef3c7; }
.pd-severe { background: #fee2e2; font-weight: 700; }
.perio-legend { font-size: 10px; color: #64748b; margin: 2px 0; }
/* Plans */
.plan { margin-bottom: 12px; }
.plan-status { font-size: 11px; font-weight: 400; color: #64748b; }
.plan-table td, .plan-table th { font-size: 11px; padding: 3px 7px; }
.plan-total { font-size: 12px; font-weight: 600; text-align: right; }
/* Documents */
.doc-table td, .doc-table th { font-size: 11px; padding: 3px 7px; }
/* Conditions */
.cond-list li { font-size: 12px; }
/* Endo */
.endo-tooth { margin-bottom: 16px; }
.endo-session { margin-bottom: 10px; border-left: 3px solid #bae6fd; padding-left: 10px; }
.endo-session-date { margin: 0 0 4px; font-size: 12px; }
.endo-notes { font-size: 12px; color: #374151; margin: 2px 0 6px; }
.endo-table td, .endo-table th { font-size: 11px; padding: 3px 7px; text-align: center; }
.endo-table th:first-child, .endo-table td:first-child { text-align: left; }
/* Empty */
.empty { color: #94a3b8; font-size: 12px; font-style: italic; }
</style>
</head>
<body>
${bodyParts.join('\n')}
</body>
</html>`;
}

// ── Orchestrator ──────────────────────────────────────────────────────────

export async function exportPatient(
	patientId: string,
	destDir: string,
	options: PatientExportOptions,
	tags: TagConfig[],
	bridgeConfigs: BridgeRoleConfig[],
	prosthesisConfigs: ProsthesisTypeConfig[],
	fillingMaterialConfigs: FillingMaterialConfig[],
	onProgress?: (pct: number, text: string) => void,
): Promise<string> {
	const prog = (pct: number, text: string) => onProgress?.(pct, text);

	prog(5, 'Collecting data…');
	const data = await gatherExportData(patientId, options);

	prog(40, 'Building HTML report…');
	const html = generatePatientHTML(data, tags, bridgeConfigs, prosthesisConfigs, fillingMaterialConfigs, options);

	// Export folder name
	const lastName = data.patient.lastname.replace(/[^a-zA-Z0-9]/g, '_');
	const firstName = data.patient.firstname.replace(/[^a-zA-Z0-9]/g, '_');
	const exportFolder = `DentVault-Export-${lastName}-${firstName}-${data.exportDate}`;
	const exportPath = `${destDir}/${exportFolder}`;

	// Copy patient files
	if (vault.path) {
		prog(60, 'Copying files…');
		const patientFolder = vault.patientFolder(data.patient.lastname, data.patient.firstname, data.patient.patient_id);
		await copyPatientFolderTo(vault.path, patientFolder, exportPath).catch(() => {/* non-fatal */});
	}

	// Write HTML
	prog(85, 'Writing report…');
	await writeTextFile(`${exportPath}/Patient-Report.html`, html);

	prog(100, 'Export complete');
	return exportPath;
}
