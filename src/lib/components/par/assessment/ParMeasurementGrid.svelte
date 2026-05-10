<script lang="ts">
	import { onMount } from 'svelte';
	import { getSetting } from '$lib/services/db';
	import {
		getParMeasurements,
		getParToothData,
		bulkUpsertParMeasurements,
		upsertParToothData,
	} from '$lib/services/db';
	import { computeAssessmentStats } from '$lib/utils/par-stats';
	import type {
		ParMeasurement,
		ParToothData,
		ParSite,
		ParBopState,
		ParToothStatus,
		ParAssessment,
	} from '$lib/types';
	import { toFDI } from '$lib/utils';
	import { i18n } from '$lib/i18n';

	let { assessmentId, locked = false }: { assessmentId: number; locked?: boolean } = $props();

	// ── Tooth layout ───────────────────────────────────────────────────────────
	const UPPER_TEETH: number[] = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
	const LOWER_TEETH: number[] = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
	const ALL_TEETH: number[]   = [...UPPER_TEETH, ...LOWER_TEETH];

	const BUCCAL_SITES_6: ParSite[]  = ['db', 'b', 'mb'];
	const LINGUAL_SITES_6: ParSite[] = ['dl', 'l', 'ml'];
	const BUCCAL_SITES_2: ParSite[]  = ['db', 'mb'];
	const LINGUAL_SITES_2: ParSite[] = ['dl', 'ml'];

	const jawBlocks = [
		{ teeth: UPPER_TEETH, label: 'Oberkiefer' },
		{ teeth: LOWER_TEETH, label: 'Unterkiefer' },
	];

	// ── Settings ───────────────────────────────────────────────────────────────
	let siteMode = $state<'2' | '6'>('2');

	// ── Data state ─────────────────────────────────────────────────────────────
	type MKey = string; // `${tooth}-${site}`
	type MData = { pocket: number | null; recession: number | null; bop: ParBopState; plaque: number };
	let mmap = $state<Record<MKey, MData>>({});

	type TKey = string; // `${tooth}`
	type TData = {
		mobility: number | null;
		furcation_b: number | null;
		vitality: number | null;
		ait_planned: boolean;
		cpt_planned: boolean;
		status: ParToothStatus | null;
	};
	let tmap = $state<Record<TKey, TData>>({});

	// ── Cursor ─────────────────────────────────────────────────────────────────
	type CellId = { tooth: number; row: 'buc' | 'ling'; siteIdx: number };
	let cursor = $state<CellId | null>(null);

	// ── Dirty tracking for auto-save ───────────────────────────────────────────
	let dirtyMeasurements = $state<Set<MKey>>(new Set());
	let dirtyToothData    = $state<Set<number>>(new Set());
	let saveTimeout: ReturnType<typeof setTimeout> | null = null;

	// ── Active sites (derived from siteMode) ───────────────────────────────────
	const activeBuccalSites  = $derived(siteMode === '6' ? BUCCAL_SITES_6 : BUCCAL_SITES_2);
	const activeLingualSites = $derived(siteMode === '6' ? LINGUAL_SITES_6 : LINGUAL_SITES_2);

	// ── Derived stats ──────────────────────────────────────────────────────────
	const stats = $derived.by(() => {
		const measurements = buildMeasurementsArray();
		const toothDataArr = buildToothDataArray();
		if (measurements.length === 0) return null;
		return computeAssessmentStats({
			assessment: null as unknown as ParAssessment,
			measurements,
			toothData: toothDataArr,
			boneLevels: [],
		});
	});

	// ── Load ───────────────────────────────────────────────────────────────────
	onMount(async () => {
		const [setting, measurements, toothDataArr] = await Promise.all([
			getSetting('par_sites'),
			getParMeasurements(assessmentId),
			getParToothData(assessmentId),
		]);
		if (setting === '6' || setting === '2') {
			siteMode = setting as '2' | '6';
		}

		const newMmap: Record<MKey, MData> = {};
		for (const m of measurements) {
			const k: MKey = `${m.tooth}-${m.site}`;
			newMmap[k] = { pocket: m.pocket, recession: m.recession, bop: m.bop, plaque: m.plaque };
		}
		mmap = newMmap;

		const newTmap: Record<TKey, TData> = {};
		for (const t of toothDataArr) {
			const k: TKey = `${t.tooth}`;
			newTmap[k] = {
				mobility: t.mobility,
				furcation_b: t.furcation_b,
				vitality: t.vitality,
				ait_planned: t.ait_planned,
				cpt_planned: t.cpt_planned,
				status: t.status,
			};
		}
		tmap = newTmap;
	});

	// ── Build arrays for save / stats ──────────────────────────────────────────
	function buildMeasurementsArray(): Omit<ParMeasurement, 'id' | 'assessment_id'>[] {
		const result: Omit<ParMeasurement, 'id' | 'assessment_id'>[] = [];
		for (const [k, v] of Object.entries(mmap)) {
			if (v.pocket !== null || v.recession !== null || v.bop > 0 || v.plaque > 0) {
				const dashIdx = k.indexOf('-');
				const tooth = Number(k.slice(0, dashIdx));
				const site = k.slice(dashIdx + 1) as ParSite;
				result.push({ tooth, site, pocket: v.pocket, recession: v.recession, bop: v.bop, plaque: v.plaque });
			}
		}
		return result;
	}

	function buildToothDataArray(): ParToothData[] {
		return Object.entries(tmap).map(([k, v]) => ({
			id: 0,
			assessment_id: assessmentId,
			tooth: Number(k),
			mobility: v.mobility,
			furcation_b: v.furcation_b,
			furcation_m: null,
			furcation_d: null,
			vitality: v.vitality,
			ait_planned: v.ait_planned,
			cpt_planned: v.cpt_planned,
			status: v.status,
		}));
	}

	// ── Auto-save ─────────────────────────────────────────────────────────────
	function scheduleSave() {
		if (saveTimeout) clearTimeout(saveTimeout);
		saveTimeout = setTimeout(async () => {
			if (dirtyMeasurements.size > 0) {
				await bulkUpsertParMeasurements(assessmentId, buildMeasurementsArray());
				dirtyMeasurements = new Set();
			}
			for (const tooth of dirtyToothData) {
				const k: TKey = `${tooth}`;
				const d = tmap[k];
				if (d) await upsertParToothData(assessmentId, tooth, d);
			}
			dirtyToothData = new Set();
		}, 800);
	}

	// ── Cell value helpers ─────────────────────────────────────────────────────
	function getM(tooth: number, site: ParSite): MData {
		const k: MKey = `${tooth}-${site}`;
		return mmap[k] ?? { pocket: null, recession: null, bop: 0 as ParBopState, plaque: 0 };
	}

	function setMPocket(tooth: number, site: ParSite, val: number | null) {
		if (locked) return;
		const k: MKey = `${tooth}-${site}`;
		const cur = getM(tooth, site);
		mmap[k] = { ...cur, pocket: val };
		dirtyMeasurements = new Set([...dirtyMeasurements, k]);
		scheduleSave();
	}

	function cycleBop(tooth: number, site: ParSite) {
		if (locked) return;
		const k: MKey = `${tooth}-${site}`;
		const cur = getM(tooth, site);
		const next = ((cur.bop + 1) % 3) as ParBopState;
		mmap[k] = { ...cur, bop: next };
		dirtyMeasurements = new Set([...dirtyMeasurements, k]);
		scheduleSave();
	}

	function getT(tooth: number): TData {
		const k: TKey = `${tooth}`;
		return tmap[k] ?? {
			mobility: null,
			furcation_b: null,
			vitality: null,
			ait_planned: false,
			cpt_planned: false,
			status: null,
		};
	}

	function setTField(tooth: number, field: keyof TData, val: TData[keyof TData]) {
		if (locked) return;
		const k: TKey = `${tooth}`;
		const cur = getT(tooth);
		tmap[k] = { ...cur, [field]: val };
		dirtyToothData = new Set([...dirtyToothData, tooth]);
		scheduleSave();
	}

	// ── Keyboard navigation ────────────────────────────────────────────────────
	function flatCells(): CellId[] {
		const cells: CellId[] = [];
		for (const t of ALL_TEETH) {
			for (let i = 0; i < activeBuccalSites.length; i++)
				cells.push({ tooth: t, row: 'buc', siteIdx: i });
			for (let i = 0; i < activeLingualSites.length; i++)
				cells.push({ tooth: t, row: 'ling', siteIdx: i });
		}
		return cells;
	}

	function cursorKey(c: CellId): string {
		return `${c.tooth}-${c.row}-${c.siteIdx}`;
	}

	function moveCursor(dir: 'next' | 'prev') {
		const cells = flatCells();
		if (!cursor) { cursor = cells[0]; return; }
		const idx = cells.findIndex(c => cursorKey(c) === cursorKey(cursor!));
		if (dir === 'next' && idx < cells.length - 1) cursor = cells[idx + 1];
		else if (dir === 'prev' && idx > 0) cursor = cells[idx - 1];
	}

	function handleCellKeydown(
		e: KeyboardEvent,
		tooth: number,
		_row: 'buc' | 'ling',
		_siteIdx: number,
		site: ParSite,
	) {
		if (locked) return;
		if (e.key >= '0' && e.key <= '9') {
			e.preventDefault();
			setMPocket(tooth, site, parseInt(e.key));
			moveCursor('next');
		} else if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			setMPocket(tooth, site, null);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			moveCursor(e.shiftKey ? 'prev' : 'next');
		} else if (e.key === 'Enter') {
			e.preventDefault();
			moveCursor('next');
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			moveCursor('next');
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			moveCursor('prev');
		}
	}

	// ── Cell color ─────────────────────────────────────────────────────────────
	function pocketColor(pocket: number | null, bop: ParBopState): string {
		if (pocket === null) return '';
		if (pocket >= 6) return 'bg-red-200 dark:bg-red-900/50 text-red-800 dark:text-red-300 font-bold';
		if (pocket >= 4 && bop > 0) return 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300';
		if (bop === 1) return 'bg-pink-100 dark:bg-pink-900/40';
		if (bop === 2) return 'bg-yellow-100 dark:bg-yellow-900/40';
		return '';
	}

	const RISK_COLORS = {
		stable: 'text-green-600 dark:text-green-400',
		maintenance: 'text-amber-600 dark:text-amber-400',
		high_risk: 'text-red-600 dark:text-red-400',
	} as const;

	const RISK_LABELS = {
		stable: 'Stabil',
		maintenance: 'Wartung',
		high_risk: 'Hohes Risiko',
	} as const;
</script>

<div class="flex flex-col gap-3 min-w-0">
	<!-- Summary bar -->
	{#if stats}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
			<span><span class="text-muted-foreground">BOP:</span> <strong>{stats.bopPercent.toFixed(0)}%</strong></span>
			<span><span class="text-muted-foreground">Max TT:</span> <strong>{stats.maxPocket}mm</strong></span>
			<span><span class="text-muted-foreground">Ø TT:</span> <strong>{stats.meanPocket.toFixed(1)}mm</strong></span>
			<span><span class="text-muted-foreground">CAL:</span> <strong>{stats.cal.toFixed(1)}mm</strong></span>
			<span class={RISK_COLORS[stats.riskLevel]}>● {RISK_LABELS[stats.riskLevel]}</span>
		</div>
	{/if}

	<!-- Grid wrapper — horizontally scrollable -->
	<div class="overflow-x-auto rounded-md border border-border text-[11px]">
		{#each jawBlocks as { teeth, label }}
			<div class="mb-1">
				<div class="px-2 py-0.5 text-[10px] font-semibold text-muted-foreground bg-muted/50">{label}</div>
				<table class="w-full border-collapse">
					<thead>
						<tr>
							<td class="w-12 pr-1 text-right text-muted-foreground text-[10px]"></td>
							{#each teeth as tooth}
								<td class="text-center font-mono text-muted-foreground border-l border-border/50 px-0.5 min-w-[2rem]">
									{toFDI(tooth)}
								</td>
							{/each}
						</tr>
					</thead>
					<tbody>
						<!-- Mobility row -->
						<tr class="border-t border-border/30">
							<td class="pr-1 text-right text-muted-foreground text-[10px] leading-tight py-0.5">Mob</td>
							{#each teeth as tooth}
								<td class="border-l border-border/50 text-center">
									<select
										class="w-full text-center text-[10px] bg-transparent cursor-pointer"
										disabled={locked}
										onchange={e =>
											setTField(
												tooth,
												'mobility',
												(e.currentTarget as HTMLSelectElement).value === ''
													? null
													: Number((e.currentTarget as HTMLSelectElement).value),
											)}
									>
										<option value="" selected={getT(tooth).mobility === null}>–</option>
										<option value="0" selected={getT(tooth).mobility === 0}>0</option>
										<option value="1" selected={getT(tooth).mobility === 1}>I</option>
										<option value="2" selected={getT(tooth).mobility === 2}>II</option>
										<option value="3" selected={getT(tooth).mobility === 3}>III</option>
									</select>
								</td>
							{/each}
						</tr>

						<!-- Buccal pocket row -->
						<tr class="border-t border-border/30 bg-blue-50/30 dark:bg-blue-950/10">
							<td class="pr-1 text-right text-muted-foreground text-[10px] leading-tight py-0.5">B</td>
							{#each teeth as tooth}
								<td class="border-l border-border/50 p-0">
									<div class="flex">
										{#each activeBuccalSites as site, si}
											<button
												type="button"
												class="{['flex-1 h-6 text-center font-mono transition-colors outline-none', pocketColor(getM(tooth, site).pocket, getM(tooth, site).bop), cursor?.tooth === tooth && cursor.row === 'buc' && cursor.siteIdx === si ? 'ring-1 ring-inset ring-blue-500' : '', locked ? 'cursor-default' : 'hover:bg-blue-100/50 dark:hover:bg-blue-900/20'].filter(Boolean).join(' ')}"
												onclick={() => (cursor = { tooth, row: 'buc', siteIdx: si })}
												onkeydown={e => handleCellKeydown(e, tooth, 'buc', si, site)}
												oncontextmenu={e => { e.preventDefault(); cycleBop(tooth, site); }}
											>
												{getM(tooth, site).pocket ?? '·'}
											</button>
										{/each}
									</div>
								</td>
							{/each}
						</tr>

						<!-- Lingual pocket row -->
						<tr class="border-t border-border/30 bg-rose-50/30 dark:bg-rose-950/10">
							<td class="pr-1 text-right text-muted-foreground text-[10px] leading-tight py-0.5">L</td>
							{#each teeth as tooth}
								<td class="border-l border-border/50 p-0">
									<div class="flex">
										{#each activeLingualSites as site, si}
											<button
												type="button"
												class="{['flex-1 h-6 text-center font-mono transition-colors outline-none', pocketColor(getM(tooth, site).pocket, getM(tooth, site).bop), cursor?.tooth === tooth && cursor.row === 'ling' && cursor.siteIdx === si ? 'ring-1 ring-inset ring-rose-500' : '', locked ? 'cursor-default' : 'hover:bg-rose-100/50 dark:hover:bg-rose-900/20'].filter(Boolean).join(' ')}"
												onclick={() => (cursor = { tooth, row: 'ling', siteIdx: si })}
												onkeydown={e => handleCellKeydown(e, tooth, 'ling', si, site)}
												oncontextmenu={e => { e.preventDefault(); cycleBop(tooth, site); }}
											>
												{getM(tooth, site).pocket ?? '·'}
											</button>
										{/each}
									</div>
								</td>
							{/each}
						</tr>

						<!-- AIT planned row -->
						<tr class="border-t border-border/30">
							<td class="pr-1 text-right text-muted-foreground text-[10px] leading-tight py-0.5">Plan</td>
							{#each teeth as tooth}
								<td class="border-l border-border/50 text-center text-[9px]">
									<button
										type="button"
										class="{['w-full leading-tight py-0.5', getT(tooth).ait_planned ? 'text-red-600 font-bold' : 'text-muted-foreground/40', locked ? 'cursor-default' : ''].join(' ')}"
										onclick={() => setTField(tooth, 'ait_planned', !getT(tooth).ait_planned)}
										title="AIT geplant"
									>A</button>
								</td>
							{/each}
						</tr>
					</tbody>
				</table>
			</div>
		{/each}
	</div>

	<!-- Legend -->
	<div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
		<span>{i18n.t.par.grid.hintNumbers}</span>
		<span>{i18n.t.par.grid.hintTabEnter}</span>
		<span>{i18n.t.par.grid.hintRightClick}</span>
		<span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded-sm bg-red-200"></span> ≥6mm</span>
		<span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded-sm bg-pink-100"></span> BOP</span>
	</div>
</div>
