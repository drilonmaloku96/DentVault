/**
 * Patient export: gather data, render HTML report, copy files.
 * Pure TypeScript — no Svelte, no DOM reactivity.
 */

import type {
	Patient, TimelineEntry, ToothChartEntry, TreatmentPlan, TreatmentPlanItem,
	OrthoClassification, OrthoAssessment, ProbingRecord, ProbingMeasurement, ProbingToothData,
	PatientCondition, PatientDocument, Doctor, Complication, EndoRecord, ToothNote,
} from '$lib/types';
import {
	getPatient, getTimelineEntries, getChartData, getTreatmentPlans, getTreatmentPlanItems,
	getOrthoClassification, getProbingRecords, getProbingMeasurements, getProbingToothData,
	getPatientConditions, getDocuments, getDoctors, getComplications,
	getAcuteText, getMedicalText, getMiscNotes, getAllEndoRecordsForPatient,
	getAllToothNotesForPatient,
} from '$lib/services/db';
import { renderChartSVG, type TagConfig, type BridgeRoleConfig, type ProsthesisTypeConfig, type FillingMaterialConfig } from '$lib/services/chart-svg-static';
import { writeTextFile, copyPatientFolderTo } from '$lib/services/files';
import { vault } from '$lib/stores/vault.svelte';
import { toFDI, FDI_TOOTH_NAMES } from '$lib/utils';
import type { LangCode } from '$lib/i18n/types';

// ── Export data model ──────────────────────────────────────────────────────

export interface PatientExportOptions {
	dateFrom?: string;
	dateTo?: string;
	sections?: {
		demographics?: boolean;
		medical?: boolean;
		notes?: boolean;
		chart?: boolean;
		timeline?: boolean;
		perio?: boolean;
		plans?: boolean;
		documents?: boolean;
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
	doctors: Doctor[];
	complicationsByEntry: Map<number, Complication[]>;
	acuteText: string;
	medicalText: string;
	miscNotes: string;
	endoRecords: EndoRecord[];
	toothNotes: ToothNote[];
	exportDate: string;
}

// ── Data gathering ─────────────────────────────────────────────────────────

export async function gatherExportData(
	patientId: string,
	options?: PatientExportOptions,
): Promise<PatientExportData> {
	const [patient, allEntries, chartData, plans, ortho, probingRecords, conditions, documents, doctors] =
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

	const [acuteText, medicalText, miscNotes, endoRecords, toothNotes] = await Promise.all([
		getAcuteText(patientId),
		getMedicalText(patientId),
		getMiscNotes(patientId),
		getAllEndoRecordsForPatient(patientId),
		getAllToothNotesForPatient(patientId),
	]);

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
		doctors,
		complicationsByEntry,
		acuteText,
		medicalText,
		miscNotes,
		endoRecords,
		toothNotes,
		exportDate: new Date().toISOString().split('T')[0],
	};
}

// ── HTML helpers ───────────────────────────────────────────────────────────

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

function getSurfLabelFromExport(v: unknown, lang: string): string {
	const tag = getSurfTagFromExport(v);
	if (!v || typeof v === 'string') return tag;
	const data = v as { tag: string; material?: string; origin?: string; insufficient?: boolean; grade?: number };
	const parts: string[] = [tag];
	if (data.grade !== undefined) parts.push(`${lang === 'de' ? 'Grad' : 'Grade'} ${data.grade}`);
	if (data.material) parts.push(data.material);
	if (data.origin === 'foreign') parts.push(lang === 'de' ? 'Fremd' : 'Foreign');
	if (data.insufficient) parts.push(lang === 'de' ? 'insuffizient' : 'insufficient');
	return parts.join(' / ');
}

// ── Section renderers ──────────────────────────────────────────────────────

function renderCover(data: PatientExportData, lang: LangCode): string {
	const { patient, exportDate } = data;
	const title = lang === 'de' ? 'Patientenakte' : 'Patient Record';
	const generatedBy = lang === 'de' ? 'Erstellt mit DentVault' : 'Generated with DentVault';
	return `
<div class="cover page-break">
	<div class="cover-logo">DentVault</div>
	<h1 class="cover-title">${esc(patient.lastname)}, ${esc(patient.firstname)}</h1>
	<p class="cover-sub">${title}</p>
	<table class="cover-meta">
		<tr><th>${lang === 'de' ? 'Patienten-ID' : 'Patient ID'}</th><td>${esc(patient.patient_id)}</td></tr>
		<tr><th>${lang === 'de' ? 'Geburtsdatum' : 'Date of Birth'}</th><td>${fmtDate(patient.dob)}</td></tr>
		<tr><th>${lang === 'de' ? 'Exportdatum' : 'Export Date'}</th><td>${fmtDate(exportDate)}</td></tr>
	</table>
	<p class="cover-footer">${esc(generatedBy)}</p>
</div>`;
}

function renderDemographics(data: PatientExportData, lang: LangCode): string {
	const { patient } = data;
	const de = lang === 'de';
	const parseArr = (s: string) => { try { return (JSON.parse(s || '[]') as string[]).join(', '); } catch { return s; } };

	const rows: [string, string][] = [
		[de ? 'Nachname' : 'Last Name', patient.lastname],
		[de ? 'Vorname' : 'First Name', patient.firstname],
		[de ? 'Geburtsdatum' : 'Date of Birth', fmtDate(patient.dob)],
		[de ? 'Geschlecht' : 'Gender', patient.gender],
		[de ? 'Status' : 'Status', patient.status],
		[de ? 'Patienten-ID' : 'Patient ID', patient.patient_id],
		[de ? 'Telefon' : 'Phone', patient.phone],
		['E-Mail', patient.email],
		[de ? 'Adresse' : 'Address', [patient.address, patient.postal_code, patient.city, patient.country].filter(Boolean).join(', ')],
		[de ? 'Beruf' : 'Occupation', patient.occupation],
		[de ? 'Überweisungsquelle' : 'Referral Source', patient.referral_source],
		[de ? 'Raucherstatus' : 'Smoking Status', patient.smoking_status],
		[de ? 'Familienstand' : 'Marital Status', patient.marital_status],
		[de ? 'Blutgruppe' : 'Blood Group', patient.blood_group],
		[de ? 'Hausarzt' : 'Primary Physician', patient.primary_physician],
		[de ? 'Krankenversicherung' : 'Insurance', patient.insurance_provider],
		[de ? 'Versicherungsnummer' : 'Insurance ID', patient.insurance_id],
		[de ? 'Notfallkontakt' : 'Emergency Contact', patient.emergency_contact_name],
		[de ? 'Notfalltelefon' : 'Emergency Phone', patient.emergency_contact_phone],
		[de ? 'Notfallbeziehung' : 'Relation', patient.emergency_contact_relation],
		[de ? 'Allergien' : 'Allergies', parseArr(patient.allergies)],
		[de ? 'Medikamente' : 'Medications', parseArr(patient.medications)],
		[de ? 'Risikohinweise' : 'Risk Flags', parseArr(patient.risk_flags)],
		[de ? 'Notizen' : 'Notes', patient.notes],
	].filter(([, v]) => v) as [string, string][];

	return `
<div class="section avoid-break">
	<h2>${de ? 'Stammdaten' : 'Demographics'}</h2>
	<table class="info-table">
		${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}
	</table>
</div>`;
}

function renderMedical(data: PatientExportData, lang: LangCode, includeNotes: boolean): string {
	const { conditions, acuteText, medicalText, miscNotes } = data;
	const de = lang === 'de';
	let html = `<div class="section"><h2>${de ? 'Anamnese &amp; Erkrankungen' : 'Medical History &amp; Conditions'}</h2>`;

	if (acuteText?.trim()) {
		html += `<h3>${de ? 'Aktuelle Beschwerden' : 'Acute Problems'}</h3><div class="richtext">${acuteText}</div>`;
	}
	if (medicalText?.trim()) {
		html += `<h3>${de ? 'Allgemeinanamnese' : 'Medical History'}</h3><div class="richtext">${medicalText}</div>`;
	}
	if (includeNotes && miscNotes?.trim()) {
		html += `<h3>${de ? 'Notizen' : 'Notes'}</h3><div class="richtext">${miscNotes}</div>`;
	}

	const active = conditions.filter(c => c.is_active);
	const historical = conditions.filter(c => !c.is_active);
	if (active.length > 0) {
		html += `<h3>${de ? 'Aktive Erkrankungen' : 'Active Conditions'}</h3><ul class="cond-list">${active.map(c => `<li>${esc(c.condition_key)}${c.start_date ? ' (' + fmtDate(c.start_date) + ')' : ''}${c.notes ? ' — ' + esc(c.notes) : ''}</li>`).join('')}</ul>`;
	}
	if (historical.length > 0) {
		html += `<h3>${de ? 'Abgeschlossene Erkrankungen' : 'Past Conditions'}</h3><ul class="cond-list">${historical.map(c => `<li>${esc(c.condition_key)}${c.end_date ? ' (' + fmtDate(c.end_date) + ')' : ''}${c.notes ? ' — ' + esc(c.notes) : ''}</li>`).join('')}</ul>`;
	}

	html += '</div>';
	return html;
}

function renderOrtho(data: PatientExportData, lang: LangCode): string {
	const { ortho, orthoAssessments } = data;
	if (!ortho && orthoAssessments.length === 0) return '';
	const de = lang === 'de';
	const row = (label: string, pre: string | number | null, post: string | number | null) =>
		`<tr><th>${esc(label)}</th><td>${esc(String(pre ?? '—'))}</td><td>${esc(String(post ?? '—'))}</td></tr>`;

	let html = `<div class="section avoid-break"><h2>${de ? 'KFO / KIG-Befunde' : 'Orthodontic / KIG Findings'}</h2>`;

	if (ortho) {
		html += `<h3>${de ? 'Klassifikation' : 'Classification'}</h3>
	<table class="info-table">
		<tr><th></th><th>${de ? 'Vorbehandlung' : 'Pre-treatment'}</th><th>${de ? 'Nachbehandlung' : 'Post-treatment'}</th></tr>
		${row(de ? 'Angle-Klasse' : 'Angle Class', ortho.pre_angle_class, ortho.post_angle_class)}
		${row(de ? 'Molarenrelation' : 'Molar Relationship', ortho.pre_molar_relationship, ortho.post_molar_relationship)}
		${row(de ? 'Overjet (mm)' : 'Overjet (mm)', ortho.pre_overjet_mm, ortho.post_overjet_mm)}
		${row(de ? 'Overbite (mm)' : 'Overbite (mm)', ortho.pre_overbite_mm, ortho.post_overbite_mm)}
		${row(de ? 'Engstand' : 'Crowding', ortho.pre_crowding, ortho.post_crowding)}
		${row(de ? 'Kreuzbiss' : 'Crossbite', ortho.pre_crossbite, ortho.post_crossbite)}
		${row(de ? 'Offener Biss' : 'Open Bite', ortho.pre_open_bite, ortho.post_open_bite)}
		${row(de ? 'Mittellinienabweichung (mm)' : 'Midline Deviation (mm)', ortho.pre_midline_deviation_mm, ortho.post_midline_deviation_mm)}
	</table>`;
		if (ortho.notes) html += `<p>${esc(ortho.notes)}</p>`;
	}

	// KIG assessment snapshots
	if (orthoAssessments.length > 0) {
		html += `<h3 style="margin-top:1em">${de ? 'KIG-Aufnahmen' : 'KIG Assessments'} (${orthoAssessments.length})</h3>`;
		for (const a of orthoAssessments) {
			const covered = a.findings.some(f => f.grade >= 3);
			html += `<div class="avoid-break" style="margin-bottom:1em;padding:0.75em;border:1px solid #e5e7eb;border-radius:6px">
				<div style="display:flex;align-items:center;gap:1em;margin-bottom:0.5em">
					<strong>${a.exam_date}</strong>
					<span style="color:${covered ? '#b45309' : '#6b7280'};font-weight:600;font-size:0.85em">
						${covered ? (de ? 'GKV-Leistungsanspruch (Grad ≥ 3)' : 'Insurance-covered (grade ≥ 3)') : (de ? 'Kein Anspruch' : 'Not covered')}
					</span>
				</div>`;
				// Context fields
			const ctx: string[] = [];
			if (a.dentition_stage) ctx.push(de ? ({ primary: 'Milchgebiss', mixed: 'Wechselgebiss', permanent: 'Bleibendes Gebiss' } as Record<string,string>)[a.dentition_stage] ?? a.dentition_stage : ({ primary: 'Primary', mixed: 'Mixed', permanent: 'Permanent' } as Record<string,string>)[a.dentition_stage] ?? a.dentition_stage);
			if (a.treatment_phase) ctx.push(de ? ({ expectative: 'Expektatives Vorgehen', early: 'Frühbehandlung', main: 'Hauptbehandlung', adult: 'Erwachsenenbehandlung' } as Record<string,string>)[a.treatment_phase] ?? a.treatment_phase : ({ expectative: 'Watchful waiting', early: 'Early treatment', main: 'Main treatment', adult: 'Adult treatment' } as Record<string,string>)[a.treatment_phase] ?? a.treatment_phase);
			if (a.angle_class) ctx.push(de ? ({ class_I: 'Klasse I', class_II_div1: 'Klasse II/1', class_II_div2: 'Klasse II/2', class_III: 'Klasse III' } as Record<string,string>)[a.angle_class] ?? a.angle_class : ({ class_I: 'Class I', class_II_div1: 'Class II/1', class_II_div2: 'Class II/2', class_III: 'Class III' } as Record<string,string>)[a.angle_class] ?? a.angle_class);
			if (a.cvm_stage > 0) ctx.push(`CVM ${a.cvm_stage}`);
			if (a.facial_profile) ctx.push(de ? ({ straight: 'Gerades Profil', convex: 'Konvexes Profil', concave: 'Konkaves Profil' } as Record<string,string>)[a.facial_profile] ?? a.facial_profile : ({ straight: 'Straight profile', convex: 'Convex profile', concave: 'Concave profile' } as Record<string,string>)[a.facial_profile] ?? a.facial_profile);
			if (ctx.length > 0) html += `<p style="font-size:0.8em;color:#6b7280;margin:0.25em 0">${ctx.join(' · ')}</p>`;

			// Bad habits
			if (a.bad_habits && a.bad_habits.length > 0) {
				const habitDE: Record<string,string> = { thumbSucking: 'Daumenlutschen', tongueThrusting: 'Zungenpressen', mouthBreathing: 'Mundatmung', lipBiting: 'Lippenbeißen', nailBiting: 'Nägelkauen', bruxism: 'Bruxismus', pacifierUse: 'Schnullergebrauch', penChewing: 'Stiftekauen' };
				const habitEN: Record<string,string> = { thumbSucking: 'Thumb sucking', tongueThrusting: 'Tongue thrusting', mouthBreathing: 'Mouth breathing', lipBiting: 'Lip biting', nailBiting: 'Nail biting', bruxism: 'Bruxism', pacifierUse: 'Pacifier use', penChewing: 'Pen/pencil chewing' };
				const labels = a.bad_habits.map(k => de ? (habitDE[k] ?? k) : (habitEN[k] ?? k));
				html += `<p style="font-size:0.8em;color:#7c3aed;margin:0.25em 0"><strong>${de ? 'Habits:' : 'Bad Habits:'}</strong> ${esc(labels.join(', '))}</p>`;
			}

			if (a.findings.length > 0) {
				html += `<table class="info-table" style="font-size:0.85em">
					<tr>
						<th>${de ? 'Gruppe' : 'Group'}</th>
						<th>${de ? 'Grad' : 'Grade'}</th>
						<th>${de ? 'Messwert' : 'Value'}</th>
						<th>${de ? 'Kassenpflichtig' : 'Covered'}</th>
					</tr>`;
				for (const f of a.findings) {
					html += `<tr>
						<td><strong>${esc(f.group)}</strong></td>
						<td>${f.grade}</td>
						<td>${f.measured_value != null ? f.measured_value + ' mm' : '—'}</td>
						<td style="color:${f.grade >= 3 ? '#16a34a' : '#6b7280'}">${f.grade >= 3 ? '✓' : '—'}</td>
					</tr>`;
				}
				html += `</table>`;
			}
			// Biss (bite) data
			const bissRight = (a as any).biss_right as { type: string; praemolarenbreite: number | null } | null | undefined;
			const bissLeft  = (a as any).biss_left  as { type: string; praemolarenbreite: number | null } | null | undefined;
			if (bissRight || bissLeft) {
				const bissTypeDE: Record<string,string> = { neutral: 'Neutralbiss', distal: 'Distalbiss', mesial: 'Mesialbiss' };
				const bissTypeEN: Record<string,string> = { neutral: 'Neutral occlusion', distal: 'Distal occlusion', mesial: 'Mesial occlusion' };
				const pbFrac: Record<number,string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
				function pbLabel(v: number): string {
					const w = Math.floor(v); const d = +(v - w).toFixed(2);
					return w > 0 ? w + (pbFrac[d] ?? '') : (pbFrac[d] ?? String(v));
				}
				function formatBiss(b: { type: string; praemolarenbreite: number | null }): string {
					const tl = de ? (bissTypeDE[b.type] ?? b.type) : (bissTypeEN[b.type] ?? b.type);
					const pb = b.praemolarenbreite != null ? ` ${pbLabel(b.praemolarenbreite)} ${de ? 'PB' : 'PW'}` : '';
					return esc(tl + pb);
				}
				const parts: string[] = [];
				if (bissRight) parts.push(`<span style="margin-right:1em"><strong>${de ? 'Rechts' : 'Right'}:</strong> ${formatBiss(bissRight)}</span>`);
				if (bissLeft)  parts.push(`<span><strong>${de ? 'Links' : 'Left'}:</strong> ${formatBiss(bissLeft)}</span>`);
				html += `<p style="font-size:0.875em;margin-top:0.5em"><strong>${de ? 'Biss:' : 'Bite:'}</strong> ${parts.join(' ')}</p>`;
			}
			if (a.treatment_recommendation) html += `<p style="font-size:0.875em;margin-top:0.5em"><strong>${de ? 'Empfehlung:' : 'Recommendation:'}</strong> ${esc(a.treatment_recommendation)}</p>`;
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
				if (tag === 'filled' || tag === 'inlay' || tag === 'inlay_planned') hasFilled = true;
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
	lang: LangCode,
): string {
	const de = lang === 'de';
	const svgMarkup = renderChartSVG(data.chartData, tags, bridgeConfigs, prosthesisConfigs, fillingMaterialConfigs);

	// DMFT score
	const permanentTeeth = data.chartData.filter(e => !isPrimaryToothExport(e.tooth_number));
	const primaryTeeth   = data.chartData.filter(e => isPrimaryToothExport(e.tooth_number));
	const dmft = calcDMFTExport(permanentTeeth);
	const dmftTotal = dmft.D + dmft.M + dmft.F;
	let dmftLine = `${de ? 'DMFT' : 'DMFT'}: <strong>${dmftTotal}</strong> (D:${dmft.D} M:${dmft.M} F:${dmft.F})`;
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
				.map(([k, v]) => `${k}: ${esc(getSurfLabelFromExport(v, lang))}`)
				.join(', ');
			return `<tr><td>${fdi}</td><td>${esc(entry.condition)}</td><td>${surfStr}</td><td>${esc(entry.notes)}</td></tr>`;
		})
		.filter(Boolean);

	let toothTable = '';
	if (surfaceRows.length > 0) {
		toothTable = `
	<h3 style="margin-top:1em">${de ? 'Flächenbefunde' : 'Surface Findings'}</h3>
	<table class="info-table" style="font-size:0.85em">
		<thead><tr>
			<th>${de ? 'Zahn' : 'Tooth'}</th>
			<th>${de ? 'Zustand' : 'Condition'}</th>
			<th>${de ? 'Flächen' : 'Surfaces'}</th>
			<th>${de ? 'Notizen' : 'Notes'}</th>
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
		const today = new Date().toISOString().slice(0, 10);
		let rows = '';
		for (const [tooth, notes] of [...byTooth.entries()].sort((a, b) => a[0] - b[0])) {
			for (const note of notes) {
				const due = note.reminder_date && note.reminder_date <= today;
				const reminderLabel = note.reminder_date
					? ` <span style="color:${due ? '#dc2626' : '#d97706'}">[${de ? 'Erinnerung' : 'Reminder'}: ${fmtDate(note.reminder_date)}${due ? ' ⚠' : ''}]</span>`
					: '';
				rows += `<tr><td>${toFDI(tooth)}</td><td>${esc(note.text)}${reminderLabel}</td><td style="color:#94a3b8;font-size:0.9em">${fmtDate(note.created_at)}</td></tr>`;
			}
		}
		toothNotesSection = `
	<h3 style="margin-top:1em">${de ? 'Zahnnotizen' : 'Tooth Notes'}</h3>
	<table class="info-table" style="font-size:0.85em">
		<thead><tr>
			<th>${de ? 'Zahn' : 'Tooth'}</th>
			<th>${de ? 'Notiz' : 'Note'}</th>
			<th>${de ? 'Datum' : 'Date'}</th>
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
			if (e.foreign_work) parts.push(`<strong>${de ? 'Fremdarbeit' : 'Foreign work'}</strong>`);
			if (e.migration)    parts.push(`${de ? 'Migration' : 'Migration'}: ${esc(e.migration)}`);
			if (e.tipping)      parts.push(`${de ? 'Kippung' : 'Tipping'}: ${esc(e.tipping)}`);
			if (e.rotation)     parts.push(`${de ? 'Rotation' : 'Rotation'}: ${esc(e.rotation)}`);
			return `<tr><td>${fdi}</td><td>${parts.join(' · ')}</td></tr>`;
		});

	let positionSection = '';
	if (positionRows.length > 0) {
		positionSection = `
	<h3 style="margin-top:1em">${de ? 'Zahnposition' : 'Tooth Position'}</h3>
	<table class="info-table" style="font-size:0.85em">
		<thead><tr><th>${de ? 'Zahn' : 'Tooth'}</th><th>${de ? 'Befund' : 'Finding'}</th></tr></thead>
		<tbody>${positionRows.join('')}</tbody>
	</table>`;
	}

	return `
<div class="section">
	<h2>${de ? 'Zahnstatus (aktuell)' : 'Dental Chart (current)'}</h2>
	<p style="font-size:0.85em;color:#64748b;margin-bottom:0.75em">${dmftLine}</p>
	<div class="chart-container">${svgMarkup}</div>${toothTable}${positionSection}${toothNotesSection}
</div>`;
}

function renderEndo(data: PatientExportData, lang: LangCode): string {
	const { endoRecords } = data;
	if (endoRecords.length === 0) return '';
	const de = lang === 'de';

	let html = `<div class="section page-break"><h2>${de ? 'Endodontische Dokumentation' : 'Endo Documentation'}</h2>`;

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
		html += `<h3>${de ? 'Zahn' : 'Tooth'} ${fdi} — ${esc(toothLabel)}</h3>`;

		for (const rec of records) {
			html += `<div class="endo-session">`;
			html += `<p class="endo-session-date"><strong>${fmtDate(rec.treatment_date)}</strong></p>`;
			if (rec.notes?.trim()) {
				html += `<p class="endo-notes">${esc(rec.notes)}</p>`;
			}
			if (rec.canals.length > 0) {
				html += `<table class="endo-table">
					<thead><tr>
						<th>${de ? 'Kanal' : 'Canal'}</th>
						<th>${de ? 'Instrument' : 'Instrument'}</th>
						<th>ISO</th>
						<th>${de ? 'Röntgen (mm)' : 'X-ray (mm)'}</th>
						<th>${de ? 'Präp. (mm)' : 'Prep. (mm)'}</th>
						<th>${de ? 'Elektr. (mm)' : 'Electr. (mm)'}</th>
						<th>${de ? 'Referenzpunkt' : 'Reference Point'}</th>
						<th>${de ? 'Def. Länge (mm)' : 'Def. Length (mm)'}</th>
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
	lang: LangCode,
): string {
	const { entries, doctors, complicationsByEntry } = data;
	const de = lang === 'de';
	if (entries.length === 0) return `<div class="section"><h2>${de ? 'Behandlungsverlauf' : 'Clinical Timeline'}</h2><p class="empty">${de ? 'Keine Einträge.' : 'No entries.'}</p></div>`;

	let html = `<div class="section"><h2>${de ? 'Behandlungsverlauf' : 'Clinical Timeline'}</h2>`;

	for (const entry of entries) {
		const isSnapshot = entry.entry_type === 'chart_snapshot';
		const comps = complicationsByEntry.get(entry.id) ?? [];
		const doctorStr = doctorName(entry.doctor_id, entry.colleague_ids, doctors);
		const teeth = entry.tooth_numbers ? entry.tooth_numbers.split(',').map(t => toFDI(parseInt(t.trim()))).join(', ') : '';

		html += `<div class="entry avoid-break">`;
		html += `<div class="entry-header">`;
		html += `<span class="entry-date">${fmtDate(entry.entry_date)}</span>`;
		html += `<span class="entry-type">${esc(entry.entry_type)}</span>`;
		if (entry.treatment_category) html += `<span class="entry-cat">${esc(entry.treatment_category)}</span>`;
		if (entry.treatment_outcome) html += `<span class="entry-outcome">${esc(entry.treatment_outcome)}</span>`;
		html += `</div>`;
		html += `<p class="entry-title">${esc(entry.title)}</p>`;
		if (teeth) html += `<p class="entry-teeth">${de ? 'Zähne' : 'Teeth'}: ${esc(teeth)}</p>`;
		if (doctorStr) html += `<p class="entry-doctor">${de ? 'Behandler' : 'Doctor'}: ${esc(doctorStr)}</p>`;

		if (isSnapshot && entry.chart_data) {
			try {
				const snapshotChart = JSON.parse(entry.chart_data) as ToothChartEntry[];
				const snapshotSvg = renderChartSVG(snapshotChart, tags, bridgeConfigs, prosthesisConfigs, fillingMaterialConfigs);
				html += `<div class="chart-container chart-snapshot">${snapshotSvg}</div>`;
			} catch { /* skip malformed snapshot */ }
		} else if (entry.description?.trim()) {
			html += `<div class="entry-desc">${entry.description}</div>`;
		}

		// Attachments (images)
		try {
			const attachments = JSON.parse(entry.attachments || '[]') as Array<{ path: string; name: string; mime: string }>;
			for (const att of attachments) {
				if (att.mime && att.mime.startsWith('image/')) {
					const filename = att.path.split('/').pop() ?? att.name;
					// Use relative path into the copied category folder
					const catFolder = att.path.replace(/\\/g, '/').split('/').slice(-2, -1)[0] ?? 'documents';
					html += `<figure class="attachment"><img src="${esc(catFolder + '/' + filename)}" alt="${esc(att.name)}" loading="lazy"/><figcaption>${esc(att.name)}</figcaption></figure>`;
				}
			}
		} catch { /* ignore */ }

		if (comps.length > 0) {
			html += `<ul class="complications">${comps.map(c => `<li><strong>${esc(c.complication_type)}</strong>${c.severity ? ' [' + esc(c.severity) + ']' : ''} — ${esc(c.description)}${c.resolved ? ' ✓' : ''}</li>`).join('')}</ul>`;
		}

		html += `</div>`;
	}

	html += '</div>';
	return html;
}

function renderPerio(data: PatientExportData, lang: LangCode): string {
	const { probingRecords } = data;
	const de = lang === 'de';
	if (probingRecords.length === 0) return '';

	let html = `<div class="section page-break"><h2>${de ? 'Parodontalbefunde' : 'Periodontal Records'}</h2>`;

	for (const { record, measurements } of probingRecords) {
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

			html += `<table class="perio-table"><thead><tr><th>FDI</th><th>DB</th><th>B</th><th>MB</th><th>DL</th><th>L</th><th>ML</th></tr></thead><tbody>`;
			for (const [toothNum, meas] of [...byTooth.entries()].sort((a, b) => a[0] - b[0])) {
				const sites = ['DB', 'B', 'MB', 'DL', 'L', 'ML'];
				const measMap = new Map(meas.map(m => [m.site, m]));
				html += `<tr><th>${toFDI(toothNum)}</th>`;
				for (const site of sites) {
					const m = measMap.get(site);
					const pd = m?.pocket_depth ?? null;
					const bop = m?.bleeding_on_probing ?? 0;
					const cls = pd === null ? '' : pd >= 6 ? ' class="pd-severe"' : pd >= 4 ? ' class="pd-moderate"' : '';
					html += `<td${cls}>${pd !== null ? pd : '—'}${bop ? '*' : ''}</td>`;
				}
				html += '</tr>';
			}
			html += '</tbody></table>';
			html += `<p class="perio-legend">${de ? '* = Blutung bei Sondierung' : '* = Bleeding on probing'}</p>`;
		}

		if (record.notes?.trim()) {
			html += `<p>${esc(record.notes)}</p>`;
		}
		html += '</div>';
	}

	html += '</div>';
	return html;
}

function renderPlans(data: PatientExportData, lang: LangCode): string {
	const { plans, planItems } = data;
	const de = lang === 'de';
	if (plans.length === 0) return '';

	let html = `<div class="section page-break"><h2>${de ? 'Behandlungspläne' : 'Treatment Plans'}</h2>`;

	for (const plan of plans) {
		const items = planItems.get(plan.plan_id) ?? [];
		html += `<div class="plan avoid-break">`;
		html += `<h3>${esc(plan.title)} <span class="plan-status">[${esc(plan.status)}]</span></h3>`;
		if (plan.description) html += `<p>${esc(plan.description)}</p>`;
		if (items.length > 0) {
			html += `<table class="plan-table"><thead><tr><th>#</th><th>${de ? 'Maßnahme' : 'Procedure'}</th><th>${de ? 'Zähne' : 'Teeth'}</th><th>${de ? 'Status' : 'Status'}</th><th>${de ? 'Kosten' : 'Cost'}</th></tr></thead><tbody>`;
			for (const item of items) {
				html += `<tr><td>${item.sequence_order}</td><td>${esc(item.description)}</td><td>${esc(item.tooth_numbers)}</td><td>${esc(item.status)}</td><td>${item.estimated_cost ? item.estimated_cost.toFixed(2) : ''}</td></tr>`;
			}
			html += '</tbody></table>';
			const total = items.reduce((sum, i) => sum + (i.estimated_cost ?? 0), 0);
			if (total > 0) html += `<p class="plan-total">${de ? 'Gesamt' : 'Total'}: ${total.toFixed(2)}</p>`;
		}
		html += '</div>';
	}
	html += '</div>';
	return html;
}

function renderDocuments(data: PatientExportData, lang: LangCode): string {
	const { documents } = data;
	const de = lang === 'de';
	if (documents.length === 0) return '';

	let html = `<div class="section page-break"><h2>${de ? 'Dokumentenverzeichnis' : 'Document Index'}</h2>`;
	html += `<table class="doc-table"><thead><tr><th>${de ? 'Dateiname' : 'Filename'}</th><th>${de ? 'Kategorie' : 'Category'}</th><th>${de ? 'Datum' : 'Date'}</th><th>${de ? 'Pfad' : 'Path'}</th></tr></thead><tbody>`;
	for (const doc of documents) {
		const catFolder = doc.rel_path.split('/').slice(-2, -1)[0] ?? doc.category;
		const filename = doc.rel_path.split('/').pop() ?? doc.filename;
		html += `<tr><td>${esc(doc.original_name || doc.filename)}</td><td>${esc(doc.category)}</td><td>${fmtDate(doc.created_at)}</td><td><code>${esc(catFolder + '/' + filename)}</code></td></tr>`;
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
	lang: LangCode,
): string {
	const { patient } = data;
	const sections = options.sections ?? {};
	const all = (k: keyof typeof sections) => sections[k] !== false;

	const bodyParts: string[] = [];
	bodyParts.push(renderCover(data, lang));
	if (all('demographics')) bodyParts.push(renderDemographics(data, lang));
	if (all('medical')) bodyParts.push(renderMedical(data, lang, all('notes')));
	if (data.ortho || data.orthoAssessments.length > 0) bodyParts.push(renderOrtho(data, lang));
	if (all('chart')) bodyParts.push(renderChart(data, tags, bridgeConfigs, prosthesisConfigs, fillingMaterialConfigs, lang));
	if (data.endoRecords.length > 0) bodyParts.push(renderEndo(data, lang));
	if (all('timeline')) bodyParts.push(renderTimeline(data, tags, bridgeConfigs, prosthesisConfigs, fillingMaterialConfigs, lang));
	if (all('perio')) bodyParts.push(renderPerio(data, lang));
	if (all('plans')) bodyParts.push(renderPlans(data, lang));
	if (all('documents')) bodyParts.push(renderDocuments(data, lang));

	return `<!DOCTYPE html>
<html lang="${lang}">
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
	lang: LangCode,
	onProgress?: (pct: number, text: string) => void,
): Promise<string> {
	const prog = (pct: number, text: string) => onProgress?.(pct, text);

	prog(5, lang === 'de' ? 'Daten werden gesammelt…' : 'Collecting data…');
	const data = await gatherExportData(patientId, options);

	prog(40, lang === 'de' ? 'HTML-Bericht wird erstellt…' : 'Building HTML report…');
	const html = generatePatientHTML(data, tags, bridgeConfigs, prosthesisConfigs, fillingMaterialConfigs, options, lang);

	// Export folder name
	const lastName = data.patient.lastname.replace(/[^a-zA-Z0-9]/g, '_');
	const firstName = data.patient.firstname.replace(/[^a-zA-Z0-9]/g, '_');
	const exportFolder = `DentVault-Export-${lastName}-${firstName}-${data.exportDate}`;
	const exportPath = `${destDir}/${exportFolder}`;

	// Copy patient files
	if (vault.path) {
		prog(60, lang === 'de' ? 'Dateien werden kopiert…' : 'Copying files…');
		const patientFolder = vault.patientFolder(data.patient.lastname, data.patient.firstname, data.patient.patient_id);
		await copyPatientFolderTo(vault.path, patientFolder, exportPath).catch(() => {/* non-fatal */});
	}

	// Write HTML
	prog(85, lang === 'de' ? 'Bericht wird geschrieben…' : 'Writing report…');
	await writeTextFile(`${exportPath}/Patient-Report.html`, html);

	prog(100, lang === 'de' ? 'Export abgeschlossen' : 'Export complete');
	return exportPath;
}
