import type { ToothChartEntry } from '$lib/types';
import { toFDI, isPrimaryTooth, UPPER_PRIMARY, LOWER_PRIMARY } from '$lib/utils';
import { dentalTags } from '$lib/stores/dentalTags.svelte';
import { i18n } from '$lib/i18n';

// All primary FDI numbers in display order
const ALL_PRIMARY_FDI: readonly number[] = [
	...(UPPER_PRIMARY.filter(Boolean) as number[]),
	...(LOWER_PRIMARY.filter(Boolean) as number[]),
];

/**
 * True when a tooth's only "notable" trait is an arch-setup placeholder 'missing' —
 * i.e. the arch-setup step (DentalChartView's confirmArch, permanent/mixed/primary
 * picker) marking an entire other dentition absent (e.g. every primary tooth when the
 * patient is charted as permanent dentition), not a clinically documented missing tooth.
 * Mirrors the exact predicate DentalChartView's DMFT calc already uses to exclude these
 * from the M count — same reasoning applies here: reporting 20 "missing" primary teeth
 * on every permanent-dentition chart snapshot is noise, not a finding.
 */
function isArchPlaceholderMissing(entry: ToothChartEntry): boolean {
	return entry.condition === 'missing'
		&& !entry.notes?.trim()
		&& (entry.surfaces === '{}' || !entry.surfaces)
		&& !entry.bridge_group_id;
}

/**
 * Generate a plain-text report summarising all notable teeth in the chart.
 * Teeth that are 'healthy' with no surface tags, no notes, and no bridge/prosthesis are skipped.
 * Arch-setup placeholder 'missing' teeth (see isArchPlaceholderMissing) are skipped too.
 *
 * Output format:
 *   Bridge/prosthesis groups first (e.g. "13–23 Bridge: 13 Implant (Abutment), 14 Pontic, ...")
 *   Then individual teeth: "18: Crown, marginal leakage"
 */
export function generateChartReport(chartData: ToothChartEntry[]): string {
	const byTooth = new Map<number, ToothChartEntry>();
	for (const entry of chartData) {
		byTooth.set(entry.tooth_number, entry);
	}

	// ── 1. Collect bridge/prosthesis groups ──
	const groupMap = new Map<string, ToothChartEntry[]>();
	for (const entry of chartData) {
		if (entry.bridge_group_id) {
			const list = groupMap.get(entry.bridge_group_id) ?? [];
			list.push(entry);
			groupMap.set(entry.bridge_group_id, list);
		}
	}

	const teethInGroups = new Set<number>();
	const groupLines: string[] = [];

	for (const [, members] of groupMap) {
		// Sort by tooth number for consistent display
		members.sort((a, b) => a.tooth_number - b.tooth_number);
		for (const m of members) teethInGroups.add(m.tooth_number);

		const firstFDI = toFDI(members[0].tooth_number);
		const lastFDI = toFDI(members[members.length - 1].tooth_number);

		// Determine if this is a prosthesis or a bridge
		const isProsthesis = members.some(m => m.prosthesis_type);
		const groupType = isProsthesis ? i18n.t.chart.prosthesisTitle : i18n.t.chart.bridgeTitle;

		const memberDescs = members.map(m => {
			const fdi = toFDI(m.tooth_number);
			const parts: string[] = [];

			// Condition (e.g. Implant, Crown)
			if (m.condition && m.condition !== 'healthy') {
				parts.push(dentalTags.getLabel(m.condition));
			}

			// Role
			if (isProsthesis && m.prosthesis_type) {
				const ptLabel = i18n.t.chart.prosthesisTypes[m.prosthesis_type as keyof typeof i18n.t.chart.prosthesisTypes] ?? m.prosthesis_type;
				parts.push(ptLabel);
			} else if (m.bridge_role) {
				const roleLabel = m.bridge_role === 'abutment' ? i18n.t.chart.abutment : i18n.t.chart.pontic;
				parts.push(roleLabel);
			}

			// Notes
			if (m.notes?.trim()) {
				parts.push(m.notes.trim());
			}

			return `${fdi} ${parts.join(', ')}`;
		});

		groupLines.push(`${firstFDI}–${lastFDI} ${groupType}: ${memberDescs.join(' | ')}`);
	}

	// ── 2. Individual permanent teeth (not in a group) ──
	const toothLines: string[] = [];

	// Iterate all 32 permanent teeth in order
	for (let u = 1; u <= 32; u++) {
		if (teethInGroups.has(u)) continue;
		const entry = byTooth.get(u);
		if (!entry) continue;

		const rootSummary = parseRootSummary(entry.root_data);
		const placeholderMissing = isArchPlaceholderMissing(entry);
		const isNotable = (entry.condition && entry.condition !== 'healthy' && !placeholderMissing)
			|| hasSurfaceTags(entry.surfaces)
			|| rootSummary.length > 0
			|| entry.watch_status === 'observe'
			|| (entry.notes && entry.notes.trim());

		if (!isNotable) continue;

		const fdi = toFDI(u);
		const parts: string[] = [];

		if (entry.condition && entry.condition !== 'healthy' && !placeholderMissing) {
			parts.push(dentalTags.getLabel(entry.condition));
		}
		const surfaceInfo = parseSurfaceTags(entry.surfaces);
		if (surfaceInfo.length > 0) {
			parts.push(surfaceInfo.map(([s, tag]) => `${s}(${dentalTags.getLabel(tag)})`).join(', '));
		}
		if (rootSummary.length > 0) {
			parts.push(`Endo: ${rootSummary.join(', ')}`);
		}
		if (entry.watch_status === 'observe') {
			parts.push(i18n.t.chart.watchStatus.observe);
		}
		if (entry.notes?.trim()) {
			parts.push(entry.notes.trim());
		}

		toothLines.push(`${fdi}: ${parts.join(', ')}`);
	}

	// ── 3. Primary (deciduous) teeth ──
	const primaryLines: string[] = [];
	for (const fdi of ALL_PRIMARY_FDI) {
		const entry = byTooth.get(fdi);
		if (!entry) continue;

		const rootSummaryP = parseRootSummary(entry.root_data);
		const placeholderMissingP = isArchPlaceholderMissing(entry);
		const isNotable = (entry.condition && entry.condition !== 'healthy' && !placeholderMissingP)
			|| hasSurfaceTags(entry.surfaces)
			|| rootSummaryP.length > 0
			|| entry.watch_status === 'observe'
			|| (entry.notes && entry.notes.trim());

		if (!isNotable) continue;

		const parts: string[] = [];
		if (entry.condition && entry.condition !== 'healthy' && !placeholderMissingP) {
			parts.push(dentalTags.getLabel(entry.condition));
		}
		const surfaceInfo = parseSurfaceTags(entry.surfaces);
		if (surfaceInfo.length > 0) {
			parts.push(surfaceInfo.map(([s, tag]) => `${s}(${dentalTags.getLabel(tag)})`).join(', '));
		}
		if (rootSummaryP.length > 0) {
			parts.push(`Endo: ${rootSummaryP.join(', ')}`);
		}
		if (entry.watch_status === 'observe') {
			parts.push(i18n.t.chart.watchStatus.observe);
		}
		if (entry.notes?.trim()) {
			parts.push(entry.notes.trim());
		}
		// fdi is already the FDI number for primary teeth (51–85)
		primaryLines.push(`${fdi} (${i18n.t.chart.primaryTeeth}): ${parts.join(', ')}`);
	}

	// ── 4. Assemble ──
	const allLines: string[] = [];
	if (groupLines.length > 0) {
		allLines.push(...groupLines);
	}
	if (toothLines.length > 0) {
		if (allLines.length > 0) allLines.push('');
		allLines.push(...toothLines);
	}
	if (primaryLines.length > 0) {
		if (allLines.length > 0) allLines.push('');
		allLines.push(...primaryLines);
	}

	if (allLines.length === 0) {
		return i18n.t.chart.snapshotReport.allHealthy;
	}

	return allLines.join('\n');
}

function surfaceTag(v: string | { tag: string } | unknown): string {
	if (v && typeof v === 'object' && 'tag' in v) return (v as { tag: string }).tag;
	return (v as string) ?? '';
}

function canalStatusLabel(status: string): string {
	const rc = i18n.t.chart.rootCanal;
	if (status === 'filled')       return rc.filled;
	if (status === 'insufficient') return rc.insufficient;
	if (status === 'dressing')     return rc.dressing;
	if (status === 'open_apex')    return rc.openApex;
	if (status === 'calcified')    return rc.calcified;
	if (status === 'resorption')   return rc.resorption;
	return status;
}

function parseRootSummary(rootDataJson: string | undefined): string[] {
	if (!rootDataJson) return [];
	try {
		const obj = JSON.parse(rootDataJson) as Record<string, { status?: string; length?: number | null; notes?: string }>;
		const names = i18n.t.chart.rootCanal.canalNames as Record<string, string>;
		return Object.entries(obj)
			.filter(([, d]) => d.status && d.status !== 'none')
			.map(([canal, d]) => {
				const parts: string[] = [canalStatusLabel(d.status!)];
				if (d.length != null) parts.push(`${d.length} mm`);
				if (d.notes?.trim()) parts.push(d.notes.trim());
				return `${names[canal] ?? canal}: ${parts.join(', ')}`;
			});
	} catch {
		return [];
	}
}

function hasSurfaceTags(surfacesJson: string): boolean {
	if (!surfacesJson) return false;
	try {
		const obj = JSON.parse(surfacesJson) as Record<string, unknown>;
		return Object.values(obj).some(v => {
			const tag = surfaceTag(v);
			return tag && tag !== '' && tag !== 'healthy';
		});
	} catch {
		return false;
	}
}

function parseSurfaceTags(surfacesJson: string): [string, string][] {
	if (!surfacesJson) return [];
	try {
		const obj = JSON.parse(surfacesJson) as Record<string, unknown>;
		return Object.entries(obj)
			.map(([s, v]) => [s, surfaceTag(v)] as [string, string])
			.filter(([, tag]) => tag && tag !== '' && tag !== 'healthy');
	} catch {
		return [];
	}
}
