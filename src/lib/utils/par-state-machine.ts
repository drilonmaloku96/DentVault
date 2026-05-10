import type { ParAssessment, ParGrade, ParStepType } from '$lib/types';

/**
 * Determines which step types are valid to create next, given the current
 * set of assessments and the case's progression grade.
 *
 * Rules (per G-BA PAR-Richtlinie 01.07.2021):
 *   No steps          → AIT (or KTB standalone)
 *   AIT open          → nothing (AIT must be completed first)
 *   AIT done          → BEVa
 *   BEVa open         → nothing
 *   BEVa done         → CPT and/or UPT (first UPT can begin without CPT)
 *   CPT open          → nothing
 *   CPT done, no BEVb → BEVb
 *   BEVb done         → UPT
 *   UPT < max         → more UPT
 *   UPT = max         → nothing (case should be ended)
 *   KTB               → always allowed
 */
export function getValidNextSteps(
	assessments: ParAssessment[],
	grade: ParGrade | null,
): ParStepType[] {
	const always: ParStepType[] = ['KTB'];

	if (assessments.length === 0) return ['AIT', ...always];

	// Sort chronologically (stable for same date)
	const sorted = [...assessments].sort(
		(a, b) => a.exam_date.localeCompare(b.exam_date) || a.created_at.localeCompare(b.created_at),
	);

	const find = (t: ParStepType) => sorted.find(a => a.type === t);
	const exists = (t: ParStepType) => sorted.some(a => a.type === t);
	const uptCount = sorted.filter(a => a.type === 'UPTd' || a.type === 'UPTg' || a.type === 'UPTc').length;
	const maxUpt = grade ? ({ A: 2, B: 4, C: 6 } as const)[grade] : 6;

	const ait  = find('AIT');
	const beva = find('BEVa');
	const cpt  = find('CPT');
	const bevb = find('BEVb');

	// AIT not yet started
	if (!ait) return ['AIT', ...always];

	// AIT open (no end_date)
	if (!ait.end_date) return always;

	// AIT complete, no BEVa yet
	if (!exists('BEVa')) return ['BEVa', ...always];

	// BEVa open
	if (!beva?.end_date) return always;

	// BEVa complete — can branch to CPT or go directly to UPT
	if (!exists('CPT') && uptCount === 0) {
		return ['CPT', 'UPTd', 'UPTg', 'UPTc', ...always];
	}

	// CPT was chosen
	if (exists('CPT')) {
		if (!cpt?.end_date) return always; // CPT still open

		// CPT complete, no BEVb yet
		if (!exists('BEVb')) return ['BEVb', ...always];

		// BEVb open
		if (!bevb?.end_date) return always;
	}

	// UPT phase (after BEVa done + no CPT, or after BEVb done)
	if (uptCount < maxUpt) return ['UPTd', 'UPTg', 'UPTc', ...always];

	// All UPT sessions done — nothing left
	return always;
}

/** Returns the next expected UPT session number (1-based). */
export function nextUptSequence(assessments: ParAssessment[]): number {
	const count = assessments.filter(
		a => a.type === 'UPTd' || a.type === 'UPTg' || a.type === 'UPTc',
	).length;
	return count + 1;
}

/**
 * Determines the visual status of an assessment for the pathway lane.
 * 'active' = most recent, no end_date
 * 'done'   = has end_date
 * 'locked' = locked flag is set
 */
export function assessmentStatus(
	a: ParAssessment,
): 'active' | 'done' | 'locked' {
	if (a.locked) return 'locked';
	if (a.end_date) return 'done';
	return 'active';
}

/** Step type color tokens (Tailwind CSS classes) */
export const STEP_COLORS: Record<ParStepType, { bg: string; text: string; border: string; dot: string }> = {
	AIT:  { bg: 'bg-red-100 dark:bg-red-950/40',    text: 'text-red-700 dark:text-red-400',    border: 'border-red-300 dark:border-red-700',    dot: 'bg-red-500' },
	BEVa: { bg: 'bg-blue-100 dark:bg-blue-950/40',  text: 'text-blue-700 dark:text-blue-400',  border: 'border-blue-300 dark:border-blue-700',  dot: 'bg-blue-500' },
	CPT:  { bg: 'bg-orange-100 dark:bg-orange-950/40', text: 'text-orange-700 dark:text-orange-400', border: 'border-orange-300 dark:border-orange-700', dot: 'bg-orange-500' },
	BEVb: { bg: 'bg-teal-100 dark:bg-teal-950/40',  text: 'text-teal-700 dark:text-teal-400',  border: 'border-teal-300 dark:border-teal-700',  dot: 'bg-teal-500' },
	UPTd: { bg: 'bg-green-100 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-400', border: 'border-green-300 dark:border-green-700', dot: 'bg-green-500' },
	UPTg: { bg: 'bg-green-100 dark:bg-green-950/40', text: 'text-green-700 dark:text-green-400', border: 'border-green-300 dark:border-green-700', dot: 'bg-green-500' },
	UPTc: { bg: 'bg-purple-100 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-400', border: 'border-purple-300 dark:border-purple-700', dot: 'bg-purple-500' },
	KTB:  { bg: 'bg-slate-100 dark:bg-slate-800/60', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-300 dark:border-slate-600', dot: 'bg-slate-400' },
};
