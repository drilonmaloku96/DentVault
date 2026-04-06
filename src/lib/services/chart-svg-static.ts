/**
 * Pure TypeScript static dental chart SVG renderer.
 * No DOM, no Svelte, no reactive stores — suitable for use in the export pipeline.
 */

import type { ToothChartEntry } from '$lib/types';
import { toFDI, getCanalsForTooth } from '$lib/utils';
import type { FillingMaterialConfig } from '$lib/stores/fillingMaterials.svelte';

const CANAL_FILL_STATIC:   Record<string, string> = { none: '#f5f3ff', filled: '#dbeafe', insufficient: '#fee2e2', dressing: '#fef3c7' };
const CANAL_STROKE_STATIC: Record<string, string> = { none: '#7c3aed', filled: '#3b82f6', insufficient: '#ef4444', dressing: '#d97706' };
function parseRootDataStatic(json: string | undefined): Record<string, { status?: string; apex?: boolean }> {
	if (!json) return {};
	try { return JSON.parse(json) as Record<string, { status?: string; apex?: boolean }>; } catch { return {}; }
}

export type { FillingMaterialConfig };

export interface TagConfig {
	key: string;
	color: string;
	strokeColor: string;
	pattern: string; // 'solid' | 'diagonal' | 'crosshatch' | 'horizontal' | 'vertical' | 'dots'
}

export interface BridgeRoleConfig {
	key: string; // 'abutment' | 'pontic' | 'connector'
	color: string;
	fillColor: string;
	fillPattern: string;
	badge: string;
}

export interface ProsthesisTypeConfig {
	key: string; // 'telescope' | 'replaced'
	color: string;
	fillColor: string;
	fillPattern: string;
	badge: string;
}

// ── Layout constants (same as ToothChart.svelte) ─────────────────────────
const SW = 46;
const VW = SW * 16; // 736
const VH = 304;
const UPPER_BASE = 108;
const ROOT_H = 36;
const LOWER_TOP = 208;
const ARCH_Y = Math.round((UPPER_BASE + LOWER_TOP) / 2); // 158

type ToothType = 'M' | 'P' | 'C' | 'I';
const UPPER: number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
const LOWER: number[] = [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17];
const SLOT_TYPE: ToothType[] = ['M', 'M', 'M', 'P', 'P', 'C', 'I', 'I', 'I', 'I', 'C', 'P', 'P', 'M', 'M', 'M'];
const CROWN_W: Record<ToothType, number> = { M: 32, P: 26, C: 22, I: 20 };
const CROWN_H: Record<ToothType, number> = { M: 40, P: 36, C: 38, I: 32 };

const ROOT_COUNTS: Record<number, number> = {
	1: 3, 2: 3, 3: 3, 4: 2, 5: 2, 6: 1, 7: 1, 8: 1,
	9: 1, 10: 1, 11: 1, 12: 2, 13: 2, 14: 3, 15: 3, 16: 3,
	17: 2, 18: 2, 19: 2, 20: 1, 21: 1, 22: 1, 23: 1, 24: 1,
	25: 1, 26: 1, 27: 1, 28: 1, 29: 1, 30: 2, 31: 2, 32: 2,
};

const NO_ROOT = new Set(['extracted', 'missing']);

// ── Helpers ───────────────────────────────────────────────────────────────

function cx(slot: number): number { return SW * slot + SW / 2; }

interface RootInfo { points: string; centerX: number; apexY: number }

function makeRoots(slotCx: number, crownW: number, numRoots: number, rootBaseY: number, goUp: boolean): RootInfo[] {
	const totalW = crownW * 0.70;
	const gap = 2;
	const rw = (totalW - gap * (numRoots - 1)) / numRoots;
	const tipW = 2.5;
	return Array.from({ length: numRoots }, (_, i) => {
		const left = slotCx - totalW / 2 + i * (rw + gap);
		const right = left + rw;
		const rcx = (left + right) / 2;
		const y1 = rootBaseY;
		const y2 = goUp ? rootBaseY - ROOT_H : rootBaseY + ROOT_H;
		const points = `${left},${y1} ${right},${y1} ${rcx + tipW / 2},${y2} ${rcx - tipW / 2},${y2}`;
		return { points, centerX: rcx, apexY: y2 };
	});
}

interface ToothGeom {
	pTop: string; pBot: string; pLeft: string; pRight: string; pCenter: string;
	ox: number; oy: number; ow: number; oh: number;
	ix: number; iy: number; iw: number; ih: number;
}

function dividedSquare(x: number, y: number, w: number, h: number): ToothGeom {
	const m = Math.max(5, Math.round(w * 0.26));
	const x2 = x + w, y2 = y + h;
	const ix = x + m, iy = y + m, ix2 = x2 - m, iy2 = y2 - m;
	const pts = (...pairs: number[]) =>
		Array.from({ length: pairs.length / 2 }, (_, i) => `${pairs[i * 2]},${pairs[i * 2 + 1]}`).join(' ');
	return {
		pTop: pts(x, y, x2, y, ix2, iy, ix, iy),
		pBot: pts(x, y2, ix, iy2, ix2, iy2, x2, y2),
		pLeft: pts(x, y, ix, iy, ix, iy2, x, y2),
		pRight: pts(x2, y, x2, y2, ix2, iy2, ix2, iy),
		pCenter: pts(ix, iy, ix2, iy, ix2, iy2, ix, iy2),
		ox: x, oy: y, ow: w, oh: h,
		ix, iy, iw: w - 2 * m, ih: h - 2 * m,
	};
}

function upperGeom(slot: number): ToothGeom {
	const t = SLOT_TYPE[slot]; const w = CROWN_W[t], h = CROWN_H[t];
	return dividedSquare(cx(slot) - w / 2, UPPER_BASE - h, w, h);
}
function lowerGeom(slot: number): ToothGeom {
	const t = SLOT_TYPE[slot]; const w = CROWN_W[t], h = CROWN_H[t];
	return dividedSquare(cx(slot) - w / 2, LOWER_TOP, w, h);
}

function slotRuns(slots: number[]): [number, number][] {
	if (slots.length === 0) return [];
	const sorted = [...slots].sort((a, b) => a - b);
	const runs: [number, number][] = [];
	let start = sorted[0], end = sorted[0];
	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i] === end + 1) { end = sorted[i]; }
		else { runs.push([start, end]); start = end = sorted[i]; }
	}
	runs.push([start, end]);
	return runs;
}

// ── Color/fill resolution ─────────────────────────────────────────────────

function getTagFill(key: string, tags: TagConfig[]): string {
	const cfg = tags.find(c => c.key === key);
	if (!cfg) return '#f8fafc';
	if (cfg.pattern && cfg.pattern !== 'solid') return `url(#dtpat-${cfg.key})`;
	return cfg.color;
}

function getTagStroke(key: string, tags: TagConfig[]): string {
	const cfg = tags.find(c => c.key === key);
	return cfg?.strokeColor ?? '#94a3b8';
}

function getBridgeFill(role: string, configs: BridgeRoleConfig[]): string {
	const cfg = configs.find(c => c.key === role);
	if (!cfg) return '#f1f5f9';
	if (cfg.fillPattern && cfg.fillPattern !== 'solid') return `url(#brpat-${cfg.key})`;
	return cfg.fillColor;
}

function getBridgeColor(role: string, configs: BridgeRoleConfig[]): string {
	return configs.find(c => c.key === role)?.color ?? '#94a3b8';
}

function getProsthesisFill(type: string, configs: ProsthesisTypeConfig[]): string {
	const cfg = configs.find(c => c.key === type);
	if (!cfg) return '#fda4af';
	if (cfg.fillPattern && cfg.fillPattern !== 'solid') return `url(#ptpat-${cfg.key})`;
	return cfg.fillColor;
}

function getProsthesisColor(type: string, configs: ProsthesisTypeConfig[]): string {
	return configs.find(c => c.key === type)?.color ?? '#f43f5e';
}

// ── Pattern defs generation ──────────────────────────────────────────────

function patternDefs(
	tags: TagConfig[],
	bridgeConfigs: BridgeRoleConfig[],
	prosthesisConfigs: ProsthesisTypeConfig[],
	fillingMaterials: FillingMaterialConfig[],
): string {
	const parts: string[] = [];

	function makePattern(id: string, color: string, stroke: string, pattern: string): string {
		if (pattern === 'diagonal') {
			return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="6" height="6"><rect width="6" height="6" fill="${color}"/><path d="M -1 1 l 2 -2 M 0 6 l 6 -6 M 5 7 l 2 -2" stroke="${stroke}" stroke-width="1.2" stroke-linecap="round"/></pattern>`;
		} else if (pattern === 'crosshatch') {
			return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="8" height="8" fill="${color}"/><line x1="4" y1="0" x2="4" y2="8" stroke="${stroke}" stroke-width="0.9"/><line x1="0" y1="4" x2="8" y2="4" stroke="${stroke}" stroke-width="0.9"/></pattern>`;
		} else if (pattern === 'horizontal') {
			return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="6"><rect width="8" height="6" fill="${color}"/><line x1="0" y1="3" x2="8" y2="3" stroke="${stroke}" stroke-width="1.2"/></pattern>`;
		} else if (pattern === 'vertical') {
			return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="6" height="8"><rect width="6" height="8" fill="${color}"/><line x1="3" y1="0" x2="3" y2="8" stroke="${stroke}" stroke-width="1.2"/></pattern>`;
		} else if (pattern === 'dots') {
			return `<pattern id="${id}" patternUnits="userSpaceOnUse" width="8" height="8"><rect width="8" height="8" fill="${color}"/><circle cx="4" cy="4" r="1.7" fill="${stroke}"/></pattern>`;
		}
		return '';
	}

	for (const tag of tags) {
		if (tag.pattern && tag.pattern !== 'solid') {
			parts.push(makePattern(`dtpat-${tag.key}`, tag.color, tag.strokeColor, tag.pattern));
		}
	}
	for (const cfg of bridgeConfigs) {
		if (cfg.fillPattern && cfg.fillPattern !== 'solid') {
			parts.push(makePattern(`brpat-${cfg.key}`, cfg.fillColor, cfg.color, cfg.fillPattern));
		}
	}
	for (const cfg of prosthesisConfigs) {
		if (cfg.fillPattern && cfg.fillPattern !== 'solid') {
			parts.push(makePattern(`ptpat-${cfg.key}`, cfg.fillColor, cfg.color, cfg.fillPattern));
		}
	}
	// Material hatch patterns (transparent background, diagonal lines in material color)
	for (const mat of fillingMaterials) {
		parts.push(`<pattern id="mat-hatch-${mat.key}" patternUnits="userSpaceOnUse" width="5" height="5"><line x1="0" y1="5" x2="5" y2="0" stroke="${mat.color}" stroke-width="2" stroke-linecap="round"/></pattern>`);
	}
	return parts.join('');
}

// ── Main renderer ─────────────────────────────────────────────────────────

export function renderChartSVG(
	chartData: ToothChartEntry[],
	tags: TagConfig[],
	bridgeConfigs: BridgeRoleConfig[],
	prosthesisConfigs: ProsthesisTypeConfig[],
	fillingMaterialConfigs: FillingMaterialConfig[] = [],
): string {
	const entryMap = new Map<number, ToothChartEntry>();
	for (const e of chartData) entryMap.set(e.tooth_number, e);

	function getEntry(t: number) { return entryMap.get(t); }
	function getCond(t: number) { return getEntry(t)?.condition ?? 'healthy'; }
	type SurfVal = string | { tag: string; material?: string; origin?: string; insufficient?: boolean; grade?: number };
	function parseSurfaces(json: string): Record<string, SurfVal> {
		try { return JSON.parse(json) as Record<string, SurfVal>; } catch { return {}; }
	}
	function getSurfTagKey(v: SurfVal | undefined): string {
		if (!v) return '';
		return typeof v === 'string' ? v : v.tag;
	}
	function getSurfFillStatic(v: SurfVal | undefined, fallback: string): string {
		if (!v) return getTagFill(fallback, tags);
		const tag = getSurfTagKey(v);
		return getTagFill(tag || fallback, tags);
	}
	function getSurfMaterialKeyStatic(v: SurfVal | undefined): string | null {
		if (!v || typeof v === 'string') return null;
		return v.material ?? null;
	}

	// ── Bridge groups ──
	interface BridgeGroupRender {
		minSlot: number; maxSlot: number; isUpper: boolean;
		kind: 'bridge' | 'prosthesis';
		memberSlots: number[];
		prosthesisType: string | null;
	}

	const bridgeGroups = new Map<string, BridgeGroupRender>();
	for (const entry of chartData) {
		if (!entry.bridge_group_id) continue;
		const upperSlot = UPPER.indexOf(entry.tooth_number);
		const lowerSlot = LOWER.indexOf(entry.tooth_number);
		const isUpper = upperSlot !== -1;
		const slot = isUpper ? upperSlot : lowerSlot;
		if (slot === -1) continue;
		const isProsthesis = !!entry.prosthesis_type;
		const isAnchor = isProsthesis && entry.bridge_role === 'abutment';
		if (!bridgeGroups.has(entry.bridge_group_id)) {
			bridgeGroups.set(entry.bridge_group_id, {
				minSlot: slot, maxSlot: slot, isUpper,
				kind: isProsthesis ? 'prosthesis' : 'bridge',
				memberSlots: [slot],
				prosthesisType: isAnchor ? (entry.prosthesis_type ?? null) : null,
			});
		} else {
			const g = bridgeGroups.get(entry.bridge_group_id)!;
			g.minSlot = Math.min(g.minSlot, slot);
			g.maxSlot = Math.max(g.maxSlot, slot);
			g.memberSlots.push(slot);
			if (isProsthesis) g.kind = 'prosthesis';
			if (isAnchor && !g.prosthesisType) g.prosthesisType = entry.prosthesis_type ?? null;
		}
	}

	const parts: string[] = [];

	// ── Defs ──
	parts.push(`<defs>${patternDefs(tags, bridgeConfigs, prosthesisConfigs, fillingMaterialConfigs)}</defs>`);

	// ── Guide lines ──
	parts.push(`<line x1="0" y1="${ARCH_Y}" x2="${VW}" y2="${ARCH_Y}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,6"/>`);
	parts.push(`<line x1="368" y1="20" x2="368" y2="${LOWER_TOP + 44}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="2,5"/>`);

	// Quadrant labels
	parts.push(`<text x="180" y="10" font-size="9" fill="#94a3b8" text-anchor="middle" font-family="sans-serif" font-weight="600">Q1</text>`);
	parts.push(`<text x="556" y="10" font-size="9" fill="#94a3b8" text-anchor="middle" font-family="sans-serif" font-weight="600">Q2</text>`);
	parts.push(`<text x="180" y="${VH - 5}" font-size="9" fill="#94a3b8" text-anchor="middle" font-family="sans-serif" font-weight="600">Q4</text>`);
	parts.push(`<text x="556" y="${VH - 5}" font-size="9" fill="#94a3b8" text-anchor="middle" font-family="sans-serif" font-weight="600">Q3</text>`);

	// ── Bridge bars / Prosthesis overlays ──
	for (const [, group] of bridgeGroups) {
		if (group.kind === 'bridge') {
			const t0 = SLOT_TYPE[group.minSlot], t1 = SLOT_TYPE[group.maxSlot];
			const x1 = cx(group.minSlot) - CROWN_W[t0] / 2;
			const x2 = cx(group.maxSlot) + CROWN_W[t1] / 2;
			const connColor = getBridgeColor('connector', bridgeConfigs);
			const connFill = getBridgeFill('connector', bridgeConfigs);
			if (group.isUpper) {
				parts.push(`<rect x="${x1}" y="${UPPER_BASE - 1}" width="${x2 - x1}" height="7" fill="${connFill}" stroke="${connColor}" stroke-width="1" rx="2"/>`);
			} else {
				parts.push(`<rect x="${x1}" y="${LOWER_TOP - 6}" width="${x2 - x1}" height="7" fill="${connFill}" stroke="${connColor}" stroke-width="1" rx="2"/>`);
			}
		} else {
			const pry = group.isUpper ? UPPER_BASE - 44 : LOWER_TOP - 3;
			for (const [runStart, runEnd] of slotRuns(group.memberSlots)) {
				const t0r = SLOT_TYPE[runStart], t1r = SLOT_TYPE[runEnd];
				const px1 = cx(runStart) - CROWN_W[t0r] / 2 - 2;
				const px2 = cx(runEnd) + CROWN_W[t1r] / 2 + 2;
				parts.push(`<rect x="${px1}" y="${pry}" width="${px2 - px1}" height="48" fill="#fda4af" fill-opacity="0.20" stroke="#f43f5e" stroke-opacity="0.45" stroke-width="1" stroke-dasharray="4,3" rx="4"/>`);
			}
		}
	}

	// ── Render a single tooth (upper or lower) ──
	function renderTooth(tooth: number, slot: number, isUpper: boolean): string {
		const entry = getEntry(tooth);
		const cond = getCond(tooth);
		const surfs = parseSurfaces(entry?.surfaces ?? '{}');
		const g = isUpper ? upperGeom(slot) : lowerGeom(slot);

		const isPontic = entry?.bridge_role === 'pontic';
		const isProsthesisReplaced = entry?.condition === 'prosthesis' && entry?.prosthesis_type === 'replaced';
		const isImplantAbutment = entry?.bridge_role === 'abutment' && entry?.abutment_type === 'implant';
		const isBridgeMember = cond === 'bridge';
		const showRoot = !NO_ROOT.has(cond) && !isPontic && !(cond === 'prosthesis' && isProsthesisReplaced);
		const isAbsent = cond === 'missing' || cond === 'extracted';

		const sc = isBridgeMember
			? (isPontic ? getBridgeColor('pontic', bridgeConfigs) : getBridgeColor('abutment', bridgeConfigs))
			: getTagStroke(cond, tags);

		const leftSurf = slot < 8 ? 'D' : 'M';
		const rightSurf = slot < 8 ? 'M' : 'D';
		const crownFallback = cond === 'root_canal' ? 'healthy' : cond;

		const prosthesisBodyFill = cond === 'prosthesis'
			? getProsthesisFill(entry?.prosthesis_type ?? 'telescope', prosthesisConfigs)
			: null;
		const bridgeBodyFill = isBridgeMember
			? (isPontic ? getBridgeFill('pontic', bridgeConfigs) : getBridgeFill('abutment', bridgeConfigs))
			: null;

		const infraOffset = cond === 'impacted' ? (isUpper ? -14 : 14) : 0;
		const t: string[] = [];

		// FDI label
		t.push(`<text x="${cx(slot)}" y="${isUpper ? 20 : VH - 5}" font-size="8" fill="#94a3b8" text-anchor="middle" font-family="sans-serif">${toFDI(tooth)}</text>`);

		const gStart = infraOffset ? `<g transform="translate(0,${infraOffset})">` : '<g>';
		t.push(gStart);

		// Roots / implant fixture
		if (showRoot) {
			if (cond === 'implant' || isImplantAbutment) {
				const fw = Math.max(10, CROWN_W[SLOT_TYPE[slot]] * 0.48);
				const fx = cx(slot) - fw / 2;
				const fy = isUpper ? g.oy - ROOT_H : g.oy + g.oh;
				t.push(`<rect x="${fx}" y="${fy}" width="${fw}" height="${ROOT_H}" fill="#6b7280" stroke="#374151" stroke-width="1" rx="3"/>`);
				for (const ratio of [0.2, 0.4, 0.6, 0.8]) {
					t.push(`<line x1="${fx + 2}" y1="${fy + ROOT_H * ratio}" x2="${fx + fw - 2}" y2="${fy + ROOT_H * ratio}" stroke="#4b5563" stroke-width="0.9"/>`);
				}
			} else {
				const roots = makeRoots(cx(slot), CROWN_W[SLOT_TYPE[slot]], ROOT_COUNTS[tooth] ?? 1, isUpper ? g.oy : g.oy + g.oh, isUpper);
				const rootDataStatic = parseRootDataStatic(entry?.root_data);
				const tCanalsStatic  = getCanalsForTooth(tooth);
				roots.forEach((root, ri) => {
					const canalName   = tCanalsStatic[ri] ?? 'single';
					const canalStatus = rootDataStatic[canalName]?.status ?? 'none';
					const canalApex   = rootDataStatic[canalName]?.apex === true;
					const rFill   = cond === 'root_canal' ? (CANAL_FILL_STATIC[canalStatus] ?? CANAL_FILL_STATIC.none) : '#f1f5f9';
					const rStroke = cond === 'root_canal' ? (CANAL_STROKE_STATIC[canalStatus] ?? CANAL_STROKE_STATIC.none) : '#7c3aed';
					t.push(`<polygon points="${root.points}" fill="${rFill}" stroke="${sc}" stroke-width="0.9"/>`);
					if (cond === 'root_canal') {
						t.push(`<line x1="${root.centerX}" y1="${isUpper ? g.oy - 2 : g.oy + g.oh + 2}" x2="${root.centerX}" y2="${root.apexY + (isUpper ? 3 : -3)}" stroke="${rStroke}" stroke-width="1.5" opacity="0.75"/>`);
						t.push(`<circle cx="${root.centerX}" cy="${root.apexY + (isUpper ? 3 : -3)}" r="1.5" fill="${canalApex ? '#dc2626' : rStroke}" opacity="0.85"/>`);
						if (canalApex) {
							t.push(`<circle cx="${root.centerX}" cy="${root.apexY + (isUpper ? 3 : -3)}" r="3.5" fill="none" stroke="#dc2626" stroke-width="1" opacity="0.7"/>`);
						}
					}
				});
			}
		}

		// Crown surfaces
		if (!isAbsent) {
			const topFill = bridgeBodyFill ?? prosthesisBodyFill ?? getSurfFillStatic(surfs['B'], crownFallback);
			const botFill = bridgeBodyFill ?? prosthesisBodyFill ?? getSurfFillStatic(surfs['L'], crownFallback);
			const leftFill = bridgeBodyFill ?? prosthesisBodyFill ?? getSurfFillStatic(surfs[leftSurf], crownFallback);
			const rightFill = bridgeBodyFill ?? prosthesisBodyFill ?? getSurfFillStatic(surfs[rightSurf], crownFallback);
			const centerFill = bridgeBodyFill ?? prosthesisBodyFill ?? getSurfFillStatic(surfs['O'], crownFallback);

			t.push(`<polygon points="${g.pTop}" fill="${topFill}" stroke="none"/>`);
			t.push(`<polygon points="${g.pBot}" fill="${botFill}" stroke="none"/>`);
			t.push(`<polygon points="${g.pLeft}" fill="${leftFill}" stroke="none"/>`);
			t.push(`<polygon points="${g.pRight}" fill="${rightFill}" stroke="none"/>`);
			t.push(`<polygon points="${g.pCenter}" fill="${centerFill}" stroke="none"/>`);
			// Material hatch overlays
			if (!bridgeBodyFill && !prosthesisBodyFill) {
				const wmk = getSurfMaterialKeyStatic(surfs['*']);
				if (wmk) {
					const hf = `url(#mat-hatch-${wmk})`;
					t.push(`<polygon points="${g.pTop}" fill="${hf}" stroke="none" opacity="0.6"/>`);
					t.push(`<polygon points="${g.pBot}" fill="${hf}" stroke="none" opacity="0.6"/>`);
					t.push(`<polygon points="${g.pLeft}" fill="${hf}" stroke="none" opacity="0.6"/>`);
					t.push(`<polygon points="${g.pRight}" fill="${hf}" stroke="none" opacity="0.6"/>`);
					t.push(`<polygon points="${g.pCenter}" fill="${hf}" stroke="none" opacity="0.6"/>`);
				}
				const mkB  = getSurfMaterialKeyStatic(surfs['B']);             if (mkB)  t.push(`<polygon points="${g.pTop}"    fill="url(#mat-hatch-${mkB})"  stroke="none" opacity="0.6"/>`);
				const mkL  = getSurfMaterialKeyStatic(surfs['L']);             if (mkL)  t.push(`<polygon points="${g.pBot}"    fill="url(#mat-hatch-${mkL})"  stroke="none" opacity="0.6"/>`);
				const mkLS = getSurfMaterialKeyStatic(surfs[leftSurf]);  if (mkLS) t.push(`<polygon points="${g.pLeft}"   fill="url(#mat-hatch-${mkLS})" stroke="none" opacity="0.6"/>`);
				const mkRS = getSurfMaterialKeyStatic(surfs[rightSurf]); if (mkRS) t.push(`<polygon points="${g.pRight}"  fill="url(#mat-hatch-${mkRS})" stroke="none" opacity="0.6"/>`);
				const mkO  = getSurfMaterialKeyStatic(surfs['O']);             if (mkO)  t.push(`<polygon points="${g.pCenter}" fill="url(#mat-hatch-${mkO})"  stroke="none" opacity="0.6"/>`);
			}
			// Structural lines
			t.push(`<rect x="${g.ix}" y="${g.iy}" width="${g.iw}" height="${g.ih}" fill="none" stroke="${sc}" stroke-width="0.7" opacity="0.55"/>`);
			t.push(`<line x1="${g.ox}" y1="${g.oy}" x2="${g.ix}" y2="${g.iy}" stroke="${sc}" stroke-width="0.7" opacity="0.55"/>`);
			t.push(`<line x1="${g.ox + g.ow}" y1="${g.oy}" x2="${g.ix + g.iw}" y2="${g.iy}" stroke="${sc}" stroke-width="0.7" opacity="0.55"/>`);
			t.push(`<line x1="${g.ox + g.ow}" y1="${g.oy + g.oh}" x2="${g.ix + g.iw}" y2="${g.iy + g.ih}" stroke="${sc}" stroke-width="0.7" opacity="0.55"/>`);
			t.push(`<line x1="${g.ox}" y1="${g.oy + g.oh}" x2="${g.ix}" y2="${g.iy + g.ih}" stroke="${sc}" stroke-width="0.7" opacity="0.55"/>`);
		}

		// Outline
		const outlineStroke = isAbsent ? '#b0bec5' : (cond === 'prosthesis' ? getProsthesisColor(entry?.prosthesis_type ?? 'telescope', prosthesisConfigs) : sc);
		const outlineWidth = isAbsent ? 1 : 1.5;
		const outlineDash = isAbsent ? '3,3' : (isPontic || isProsthesisReplaced ? '4,3' : '');
		t.push(`<rect x="${g.ox}" y="${g.oy}" width="${g.ow}" height="${g.oh}" fill="none" stroke="${outlineStroke}" stroke-width="${outlineWidth}"${outlineDash ? ` stroke-dasharray="${outlineDash}"` : ''}/>`);

		// Absent indicators
		if (cond === 'extracted') {
			t.push(`<line x1="${g.ox + 4}" y1="${g.oy + 4}" x2="${g.ox + g.ow - 4}" y2="${g.oy + g.oh - 4}" stroke="#90a4ae" stroke-width="1.5" stroke-linecap="round"/>`);
			t.push(`<line x1="${g.ox + g.ow - 4}" y1="${g.oy + 4}" x2="${g.ox + 4}" y2="${g.oy + g.oh - 4}" stroke="#90a4ae" stroke-width="1.5" stroke-linecap="round"/>`);
		} else if (cond === 'missing') {
			t.push(`<line x1="${g.ox + g.ow * 0.25}" y1="${g.oy + g.oh * 0.5}" x2="${g.ox + g.ow * 0.75}" y2="${g.oy + g.oh * 0.5}" stroke="#b0bec5" stroke-width="1.5" stroke-linecap="round"/>`);
		}

		// Badge (prosthesis or bridge)
		if (!isAbsent && entry?.prosthesis_type) {
			const ptCfg = prosthesisConfigs.find(c => c.key === entry.prosthesis_type);
			if (ptCfg) {
				t.push(`<circle cx="${g.ox + g.ow - 3.5}" cy="${g.oy + 3.5}" r="3.5" fill="white" stroke="${ptCfg.color}" stroke-width="0.9"/>`);
				t.push(`<text x="${g.ox + g.ow - 3.5}" y="${g.oy + 5.5}" font-size="4.5" font-weight="bold" text-anchor="middle" fill="${ptCfg.color}" font-family="sans-serif">${ptCfg.badge}</text>`);
			}
		} else if (!isAbsent && isBridgeMember) {
			const brCfg = bridgeConfigs.find(c => c.key === (isPontic ? 'pontic' : 'abutment'));
			if (brCfg?.badge) {
				t.push(`<circle cx="${g.ox + g.ow - 3.5}" cy="${g.oy + 3.5}" r="3.5" fill="white" stroke="${brCfg.color}" stroke-width="0.9"/>`);
				t.push(`<text x="${g.ox + g.ow - 3.5}" y="${g.oy + 5.5}" font-size="4.5" font-weight="bold" text-anchor="middle" fill="${brCfg.color}" font-family="sans-serif">${brCfg.badge}</text>`);
			}
		}

		t.push('</g>');
		return t.join('');
	}

	// Render all teeth
	for (let slot = 0; slot < 16; slot++) {
		parts.push(renderTooth(UPPER[slot], slot, true));
	}
	for (let slot = 0; slot < 16; slot++) {
		parts.push(renderTooth(LOWER[slot], slot, false));
	}

	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="100%" style="display:block;max-width:700px;margin:0 auto;">${parts.join('')}</svg>`;
}
