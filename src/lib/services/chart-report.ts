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
 * Generate a plain-text report summarising all notable teeth in the chart.
 * Teeth that are 'healthy' with no surface tags, no notes, and no bridge/prosthesis are skipped.
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

		const isNotable = (entry.condition && entry.condition !== 'healthy')
			|| hasSurfaceTags(entry.surfaces)
			|| (entry.notes && entry.notes.trim());

		if (!isNotable) continue;

		const fdi = toFDI(u);
		const parts: string[] = [];

		if (entry.condition && entry.condition !== 'healthy') {
			parts.push(dentalTags.getLabel(entry.condition));
		}
		const surfaceInfo = parseSurfaceTags(entry.surfaces);
		if (surfaceInfo.length > 0) {
			parts.push(surfaceInfo.map(([s, tag]) => `${s}(${dentalTags.getLabel(tag)})`).join(', '));
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

		const isNotable = (entry.condition && entry.condition !== 'healthy')
			|| hasSurfaceTags(entry.surfaces)
			|| (entry.notes && entry.notes.trim());

		if (!isNotable) continue;

		const parts: string[] = [];
		if (entry.condition && entry.condition !== 'healthy') {
			parts.push(dentalTags.getLabel(entry.condition));
		}
		const surfaceInfo = parseSurfaceTags(entry.surfaces);
		if (surfaceInfo.length > 0) {
			parts.push(surfaceInfo.map(([s, tag]) => `${s}(${dentalTags.getLabel(tag)})`).join(', '));
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

function hasSurfaceTags(surfacesJson: string): boolean {
	if (!surfacesJson) return false;
	try {
		const obj = JSON.parse(surfacesJson) as Record<string, string>;
		return Object.values(obj).some(v => v && v !== '' && v !== 'healthy');
	} catch {
		return false;
	}
}

function parseSurfaceTags(surfacesJson: string): [string, string][] {
	if (!surfacesJson) return [];
	try {
		const obj = JSON.parse(surfacesJson) as Record<string, string>;
		return Object.entries(obj)
			.filter(([, v]) => v && v !== '' && v !== 'healthy')
			.map(([s, v]) => [s, v]);
	} catch {
		return [];
	}
}
