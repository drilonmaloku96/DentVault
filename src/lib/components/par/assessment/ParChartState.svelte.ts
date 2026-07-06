/**
 * ParChartState — shared reactive store for a PAR assessment.
 *
 * Single source of truth consumed by ParToothChartSVG, ParMeasurementGrid,
 * and ParCompareView. Owns mmap / tmap / bone levels / cursor / guided order /
 * dirty-tracking / autosave.
 *
 * DATA INTEGRITY rules:
 *  - All tooth values are FDI (11–48). Never convert via toFDI() here.
 *  - Site keys are ParSite lowercase: 'db'|'b'|'mb'|'ml'|'l'|'dl'.
 *  - Stats come exclusively from computeAssessmentStats (par-stats.ts).
 */

import { getContext, setContext, onDestroy } from 'svelte';
import { untrack } from 'svelte';
import {
	getParMeasurements,
	getParToothData,
	getParBoneLevel,
	bulkUpsertParMeasurements,
	upsertParToothData,
	upsertParBoneLevel,
	getSetting,
} from '$lib/services/db';
import { computeAssessmentStats } from '$lib/utils/par-stats';
import type {
	ParMeasurement,
	ParToothData,
	ParSite,
	ParBopState,
	ParToothStatus,
	ParAssessment,
	ParBoneLevel,
} from '$lib/types';

// ── Tooth layout (FDI) ─────────────────────────────────────────────────────

export const UPPER_TEETH: number[] = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER_TEETH: number[] = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const ALL_TEETH: number[]   = [...UPPER_TEETH, ...LOWER_TEETH];

export const BUCCAL_SITES_6: ParSite[]  = ['db', 'b', 'mb'];
export const LINGUAL_SITES_6: ParSite[] = ['dl', 'l', 'ml'];
export const BUCCAL_SITES_2: ParSite[]  = ['db', 'mb'];
export const LINGUAL_SITES_2: ParSite[] = ['dl', 'ml'];

/** Guided probing order: buc upper 18→28, ling upper 28→18, buc lower 48→38, ling lower 38→48 */
export function buildGuidedOrder(siteMode: '2' | '6', tmap: Record<string, TData>): CellId[] {
	const bucSites  = siteMode === '6' ? BUCCAL_SITES_6  : BUCCAL_SITES_2;
	const lingSites = siteMode === '6' ? LINGUAL_SITES_6 : LINGUAL_SITES_2;
	const cells: CellId[] = [];

	function pushIfPresent(tooth: number, row: 'buc' | 'ling', sites: ParSite[]) {
		if (tmap[`${tooth}`]?.status === 'missing') return;
		for (let i = 0; i < sites.length; i++) {
			cells.push({ tooth, row, siteIdx: i });
		}
	}

	// Buccal upper (18 → 28 left to right across UPPER_TEETH order)
	for (const t of UPPER_TEETH) pushIfPresent(t, 'buc', bucSites);
	// Lingual upper reversed (28 → 18)
	for (const t of [...UPPER_TEETH].reverse()) pushIfPresent(t, 'ling', lingS(siteMode));
	// Buccal lower
	for (const t of LOWER_TEETH) pushIfPresent(t, 'buc', bucSites);
	// Lingual lower reversed
	for (const t of [...LOWER_TEETH].reverse()) pushIfPresent(t, 'ling', lingS(siteMode));

	return cells;
}

function lingS(mode: '2' | '6'): ParSite[] {
	return mode === '6' ? LINGUAL_SITES_6 : LINGUAL_SITES_2;
}

// ── Types ──────────────────────────────────────────────────────────────────

export type MKey = string; // `${tooth}-${site}`
export type MData = {
	pocket: number | null;
	recession: number | null;
	bop: ParBopState;
	plaque: number;
};

export type TKey = string; // `${tooth}`
export type TData = {
	mobility: number | null;
	furcation_b: number | null;
	furcation_m: number | null;
	furcation_d: number | null;
	vitality: number | null;
	ait_planned: boolean;
	cpt_planned: boolean;
	status: ParToothStatus | null;
};

export type CellId = { tooth: number; row: 'buc' | 'ling'; siteIdx: number };

export type InputMode = 'pd' | 'recession' | 'bone';

const CTX_KEY = Symbol('ParChartState');

// ── State class ────────────────────────────────────────────────────────────

export class ParChartState {
	assessmentId: number;
	locked:       boolean;

	// Measurement map: `${tooth}-${site}` → data
	mmap = $state<Record<MKey, MData>>({});
	// Tooth data map: `${tooth}` → data
	tmap = $state<Record<TKey, TData>>({});
	// Bone levels per jaw
	boneUpper = $state<{ x: number; y: number }[]>([]);
	boneLower = $state<{ x: number; y: number }[]>([]);

	// Cursor position in the guided flow
	cursor     = $state<CellId | null>(null);
	siteMode   = $state<'2' | '6'>('2');
	inputMode  = $state<InputMode>('pd');
	autoAdvance = $state(true);
	isLoaded   = $state(false);

	// Dirty tracking + autosave
	private dirtyM = new Set<MKey>();
	private dirtyT = new Set<number>();
	private saveTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(assessmentId: number, locked: boolean) {
		this.assessmentId = assessmentId;
		this.locked = untrack(() => locked);
		void this.load();
		onDestroy(() => void this.flush());
	}

	// ── Load ────────────────────────────────────────────────────────────────

	async load() {
		const [setting, measurements, toothDataArr, boneU, boneL] = await Promise.all([
			getSetting('par_sites'),
			getParMeasurements(this.assessmentId),
			getParToothData(this.assessmentId),
			getParBoneLevel(this.assessmentId, 'upper'),
			getParBoneLevel(this.assessmentId, 'lower'),
		]);
		if (setting === '6' || setting === '2') this.siteMode = setting as '2' | '6';

		const nm: Record<MKey, MData> = {};
		for (const m of measurements) {
			nm[`${m.tooth}-${m.site}`] = { pocket: m.pocket, recession: m.recession, bop: m.bop, plaque: m.plaque };
		}
		this.mmap = nm;

		const nt: Record<TKey, TData> = {};
		for (const t of toothDataArr) {
			nt[`${t.tooth}`] = {
				mobility: t.mobility,
				furcation_b: t.furcation_b,
				furcation_m: t.furcation_m,
				furcation_d: t.furcation_d,
				vitality: t.vitality,
				ait_planned: t.ait_planned,
				cpt_planned: t.cpt_planned,
				status: t.status,
			};
		}
		this.tmap = nt;

		if (boneU) this.boneUpper = JSON.parse(boneU.points_json) as { x: number; y: number }[];
		if (boneL) this.boneLower = JSON.parse(boneL.points_json) as { x: number; y: number }[];

		this.isLoaded = true;
	}

	// ── Stats (computed from current mmap/tmap) ──────────────────────────────

	get stats() {
		const measurements = this.buildMeasurementsArray();
		const toothDataArr = this.buildToothDataArray();
		if (measurements.length === 0) return null;
		return computeAssessmentStats({
			assessment: null as unknown as ParAssessment,
			measurements: measurements.map((m, i) => ({ id: i, assessment_id: this.assessmentId, ...m })),
			toothData: toothDataArr,
			boneLevels: [],
		});
	}

	// ── Guided flow ──────────────────────────────────────────────────────────

	get guidedOrder(): CellId[] {
		return buildGuidedOrder(this.siteMode, this.tmap);
	}

	get cursorIndex(): number {
		if (!this.cursor) return -1;
		return this.guidedOrder.findIndex(c =>
			c.tooth === this.cursor!.tooth &&
			c.row   === this.cursor!.row   &&
			c.siteIdx === this.cursor!.siteIdx,
		);
	}

	get progressLabel(): string {
		const total = this.guidedOrder.length;
		const idx   = this.cursorIndex;
		return idx >= 0 ? `${idx + 1} of ${total}` : `0 of ${total}`;
	}

	moveCursor(dir: 'next' | 'prev') {
		const order = this.guidedOrder;
		if (order.length === 0) return;
		if (!this.cursor) { this.cursor = order[0]; return; }
		const idx = this.cursorIndex;
		if (dir === 'next' && idx < order.length - 1) this.cursor = order[idx + 1];
		else if (dir === 'prev' && idx > 0)           this.cursor = order[idx - 1];
	}

	/** Place the cursor on the first site of the guided probing walk. */
	startCharting() {
		const order = this.guidedOrder;
		if (order.length > 0) this.cursor = order[0];
	}

	/** Resolve the ParSite for a cell under the current site mode. */
	siteAt(c: CellId): ParSite | null {
		const sites = c.row === 'buc'
			? (this.siteMode === '6' ? BUCCAL_SITES_6 : BUCCAL_SITES_2)
			: (this.siteMode === '6' ? LINGUAL_SITES_6 : LINGUAL_SITES_2);
		return sites[c.siteIdx] ?? null;
	}

	// ── Measurement helpers ──────────────────────────────────────────────────

	getM(tooth: number, site: ParSite): MData {
		return this.mmap[`${tooth}-${site}`] ?? { pocket: null, recession: null, bop: 0 as ParBopState, plaque: 0 };
	}

	private setM(tooth: number, site: ParSite, patch: Partial<MData>) {
		if (this.locked) return;
		const k: MKey = `${tooth}-${site}`;
		const cur = this.getM(tooth, site);
		this.mmap[k] = { ...cur, ...patch };
		this.dirtyM.add(k);
		this.scheduleSave();
	}

	setPocket(tooth: number, site: ParSite, val: number | null) {
		this.setM(tooth, site, { pocket: val });
	}

	setRecession(tooth: number, site: ParSite, val: number | null) {
		this.setM(tooth, site, { recession: val });
	}

	cycleBop(tooth: number, site: ParSite) {
		const cur = this.getM(tooth, site);
		this.setM(tooth, site, { bop: ((cur.bop + 1) % 3) as ParBopState });
	}

	togglePlaque(tooth: number, site: ParSite) {
		const cur = this.getM(tooth, site);
		this.setM(tooth, site, { plaque: cur.plaque > 0 ? 0 : 1 });
	}

	/**
	 * Handle a digit key press at `site`. Commits IMMEDIATELY and auto-advances —
	 * probing entry is rapid-fire, so no delayed multi-digit combining (a 400 ms
	 * combine window would turn a quick "3, 2" into 32 mm). Depths above 9 mm
	 * (rare, max 12) are entered with Shift+digit → 10 + digit.
	 */
	handleDigit(tooth: number, site: ParSite, digit: number, shifted: boolean) {
		const value = shifted ? 10 + digit : digit;
		if (value > 12) return; // beyond chartable range
		if (this.inputMode === 'recession') {
			this.setRecession(tooth, site, value);
		} else {
			this.setPocket(tooth, site, value);
		}
		if (this.autoAdvance) this.moveCursor('next');
	}

	// ── Tooth data helpers ───────────────────────────────────────────────────

	getT(tooth: number): TData {
		return this.tmap[`${tooth}`] ?? {
			mobility: null, furcation_b: null, furcation_m: null, furcation_d: null,
			vitality: null, ait_planned: false, cpt_planned: false, status: null,
		};
	}

	setT(tooth: number, patch: Partial<TData>) {
		if (this.locked) return;
		const k: TKey = `${tooth}`;
		this.tmap[k] = { ...this.getT(tooth), ...patch };
		this.dirtyT.add(tooth);
		this.scheduleSave();
	}

	// ── Bone levels ──────────────────────────────────────────────────────────

	setBoneLevel(jaw: 'upper' | 'lower', points: { x: number; y: number }[]) {
		if (this.locked) return;
		if (jaw === 'upper') this.boneUpper = points;
		else                 this.boneLower = points;
		this.scheduleSave(true);
	}

	clearBoneLevel(jaw: 'upper' | 'lower') {
		if (this.locked) return;
		if (jaw === 'upper') this.boneUpper = [];
		else                 this.boneLower = [];
		void upsertParBoneLevel(this.assessmentId, jaw, []);
	}

	// ── Save ─────────────────────────────────────────────────────────────────

	private scheduleSave(boneOnly = false) {
		if (this.saveTimer) clearTimeout(this.saveTimer);
		this.saveTimer = setTimeout(() => void this.flush(boneOnly), 800);
	}

	async flush(boneOnly = false) {
		if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
		if (!boneOnly && this.dirtyM.size > 0) {
			await bulkUpsertParMeasurements(this.assessmentId, this.buildMeasurementsArray());
			this.dirtyM.clear();
		}
		if (!boneOnly) {
			for (const tooth of this.dirtyT) {
				const d = this.tmap[`${tooth}`];
				if (d) await upsertParToothData(this.assessmentId, tooth, d);
			}
			this.dirtyT.clear();
		}
		if (this.boneUpper.length > 0) {
			await upsertParBoneLevel(this.assessmentId, 'upper', this.boneUpper);
		}
		if (this.boneLower.length > 0) {
			await upsertParBoneLevel(this.assessmentId, 'lower', this.boneLower);
		}
	}

	// ── Array builders ────────────────────────────────────────────────────────

	buildMeasurementsArray(): Omit<ParMeasurement, 'id' | 'assessment_id'>[] {
		const result: Omit<ParMeasurement, 'id' | 'assessment_id'>[] = [];
		for (const [k, v] of Object.entries(this.mmap)) {
			if (v.pocket !== null || v.recession !== null || v.bop > 0 || v.plaque > 0) {
				const dashIdx = k.indexOf('-');
				result.push({
					tooth:     Number(k.slice(0, dashIdx)),
					site:      k.slice(dashIdx + 1) as ParSite,
					pocket:    v.pocket,
					recession: v.recession,
					bop:       v.bop,
					plaque:    v.plaque,
				});
			}
		}
		return result;
	}

	buildToothDataArray(): ParToothData[] {
		return Object.entries(this.tmap).map(([k, v]) => ({
			id: 0,
			assessment_id: this.assessmentId,
			tooth: Number(k),
			mobility: v.mobility,
			furcation_b: v.furcation_b,
			furcation_m: v.furcation_m,
			furcation_d: v.furcation_d,
			vitality: v.vitality,
			ait_planned: v.ait_planned,
			cpt_planned: v.cpt_planned,
			status: v.status,
		}));
	}
}

// ── Context helpers (one state per assessment card) ────────────────────────

export function createParChartState(assessmentId: number, locked: boolean): ParChartState {
	const state = new ParChartState(assessmentId, locked);
	setContext(CTX_KEY, state);
	return state;
}

export function getParChartState(): ParChartState {
	return getContext<ParChartState>(CTX_KEY);
}
