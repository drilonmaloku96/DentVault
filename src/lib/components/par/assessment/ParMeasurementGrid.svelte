<script lang="ts">
	/**
	 * ParMeasurementGrid — table view of PAR measurements.
	 * Reads/writes through ParChartState from context — single source of truth
	 * shared with the SVG chart. Rebinds automatically when state changes.
	 *
	 * FDI note: teeth are already FDI (11–48) — render directly; never call toFDI().
	 */

	import { getParChartState } from './ParChartState.svelte';
	import {
		UPPER_TEETH, LOWER_TEETH,
		BUCCAL_SITES_2, BUCCAL_SITES_6,
		LINGUAL_SITES_2, LINGUAL_SITES_6,
	} from './ParChartState.svelte';
	import { pdChipClass, bopDotClass, RISK_CHIP_CLASSES } from '$lib/utils/par-colors';
	import { i18n } from '$lib/i18n';

	// Shared state from context (set by ParAssessmentPanel via createParChartState) —
	// locked/assessment identity live there; this component takes no props.
	const chartState = getParChartState();

	const activeBucSites  = $derived(chartState.siteMode === '6' ? BUCCAL_SITES_6  : BUCCAL_SITES_2);
	const activeLingSites = $derived(chartState.siteMode === '6' ? LINGUAL_SITES_6 : LINGUAL_SITES_2);

	const jawBlocks = [
		{ teeth: UPPER_TEETH, labelKey: 'upper' as const },
		{ teeth: LOWER_TEETH, labelKey: 'lower' as const },
	];

	// Pending recession mode: press 'r' then digit
	let pendingRecession = $state(false);

	function isCursor(tooth: number, row: 'buc' | 'ling', si: number): boolean {
		const c = chartState.cursor;
		return !!c && c.tooth === tooth && c.row === row && c.siteIdx === si;
	}

	function handleCellKeydown(
		e: KeyboardEvent,
		tooth: number,
		row: 'buc' | 'ling',
		si: number,
	) {
		if (chartState.locked) return;
		// After auto-advance the cursor has moved on but keyboard focus stays on the
		// originally clicked button — act on the CURSOR cell so consecutive typing
		// walks the arch instead of overwriting one cell.
		const cell = chartState.cursor ?? { tooth, row, siteIdx: si };
		const site = chartState.siteAt(cell);
		if (!site) return;

		if (pendingRecession && e.key >= '0' && e.key <= '9') {
			e.preventDefault();
			chartState.setRecession(cell.tooth, site, parseInt(e.key));
			pendingRecession = false;
		} else if (e.key >= '0' && e.key <= '9') {
			e.preventDefault();
			chartState.handleDigit(cell.tooth, site, parseInt(e.key), e.shiftKey);
		} else if (e.key === 'r') {
			e.preventDefault();
			pendingRecession = true;
		} else if (e.key === 'p') {
			e.preventDefault();
			chartState.togglePlaque(cell.tooth, site);
		} else if (e.key === 'b') {
			e.preventDefault();
			chartState.cycleBop(cell.tooth, site);
		} else if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			chartState.setPocket(cell.tooth, site, null);
			pendingRecession = false;
		} else if (e.key === 'Tab') {
			e.preventDefault();
			chartState.moveCursor(e.shiftKey ? 'prev' : 'next');
		} else if (e.key === 'Enter' || e.key === 'ArrowRight') {
			e.preventDefault();
			chartState.moveCursor('next');
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			chartState.moveCursor('prev');
		} else if (e.key === 'Escape') {
			pendingRecession = false;
		}
	}

	const hasRecession = $derived(
		Object.values(chartState.mmap).some(d => d.recession !== null && d.recession > 0),
	);
</script>

<div class="flex flex-col gap-3 min-w-0">
	<!-- Recession mode badge -->
	{#if pendingRecession}
		<span class="rounded bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 self-start">
			{i18n.t.par.hud.recessionMode} — {i18n.t.par.grid.hintRecession}
		</span>
	{/if}

	<!-- Stats summary bar (from shared state) -->
	{#if chartState.stats}
		{@const s = chartState.stats}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
			<span><span class="text-muted-foreground">BOP:</span> <strong>{s.bopPercent.toFixed(0)}%</strong></span>
			<span><span class="text-muted-foreground">{i18n.t.par.grid.maxPd}:</span> <strong>{s.maxPocket}mm</strong></span>
			<span><span class="text-muted-foreground">{i18n.t.par.grid.meanPd}:</span> <strong>{s.meanPocket.toFixed(1)}mm</strong></span>
			<span><span class="text-muted-foreground">CAL:</span> <strong>{s.cal.toFixed(1)}mm</strong></span>
			<span class={RISK_CHIP_CLASSES[s.riskLevel]}>●
				{s.riskLevel === 'stable' ? i18n.t.par.risk.stable
				: s.riskLevel === 'maintenance' ? i18n.t.par.risk.maintenance
				: i18n.t.par.risk.highRisk}
			</span>
		</div>
	{/if}

	<!-- Grid wrapper -->
	<div class="overflow-x-auto rounded-md border border-border text-[11px]">
		{#each jawBlocks as { teeth, labelKey }}
			{@const jawLabel = labelKey === 'upper' ? i18n.t.par.grid.upperJaw : i18n.t.par.grid.lowerJaw}
			<div class="mb-1">
				<div class="px-2 py-0.5 text-[10px] font-semibold text-muted-foreground bg-muted/50">{jawLabel}</div>
				<table class="w-full border-collapse">
					<thead>
						<tr>
							<td class="w-12 pr-1 text-right text-muted-foreground text-[10px]"></td>
							{#each teeth as tooth}
								<!-- FDI number rendered directly — already FDI (11–48) -->
								<td class="text-center font-mono text-muted-foreground border-l border-border/50 px-0.5 min-w-[2rem]">{tooth}</td>
							{/each}
						</tr>
					</thead>
					<tbody>
						<!-- Mobility -->
						<tr class="border-t border-border/30">
							<td class="pr-1 text-right text-muted-foreground text-[10px] leading-tight py-0.5">{i18n.t.par.grid.mobility}</td>
							{#each teeth as tooth}
								<td class="border-l border-border/50 text-center">
									<select
										class="w-full text-center text-[10px] bg-transparent cursor-pointer"
										disabled={chartState.locked}
										onchange={e => chartState.setT(tooth, { mobility: (e.currentTarget as HTMLSelectElement).value === '' ? null : Number((e.currentTarget as HTMLSelectElement).value) })}
									>
										<option value="" selected={chartState.getT(tooth).mobility === null}>–</option>
										{#each [0,1,2,3] as g}
											<option value={g} selected={chartState.getT(tooth).mobility === g}>{['0','I','II','III'][g]}</option>
										{/each}
									</select>
								</td>
							{/each}
						</tr>

						<!-- Buccal PD row -->
						<tr class="border-t border-border/30 bg-blue-50/30 dark:bg-blue-950/10">
							<td class="pr-1 text-right text-muted-foreground text-[10px] leading-tight py-0.5">B</td>
							{#each teeth as tooth}
								<td class="border-l border-border/50 p-0">
									<div class="flex">
										{#each activeBucSites as site, si}
											{@const m = chartState.getM(tooth, site)}
											<button
												type="button"
												class={['flex-1 h-6 text-center font-mono transition-colors outline-none relative', pdChipClass(m.pocket, m.bop), isCursor(tooth,'buc',si) ? 'ring-1 ring-inset ring-blue-500' : '', chartState.locked ? 'cursor-default' : 'hover:bg-blue-100/50 dark:hover:bg-blue-900/20'].filter(Boolean).join(' ')}
												onclick={() => chartState.cursor = { tooth, row: 'buc', siteIdx: si }}
												onkeydown={e => handleCellKeydown(e, tooth, 'buc', si)}
												oncontextmenu={e => { e.preventDefault(); chartState.cycleBop(tooth, site); }}
											>
												{m.pocket ?? '·'}
												{#if m.bop > 0}
													<span class="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full {bopDotClass(m.bop)}"></span>
												{/if}
												{#if m.plaque > 0}
													<span class="absolute bottom-0.5 left-0.5 w-1.5 h-1.5 rounded-sm bg-blue-400 opacity-75"></span>
												{/if}
											</button>
										{/each}
									</div>
								</td>
							{/each}
						</tr>

						<!-- Buccal recession (only when data exists) -->
						{#if hasRecession}
							<tr class="border-t border-border/20 bg-rose-50/20 dark:bg-rose-950/5">
								<td class="pr-1 text-right text-muted-foreground text-[9px] leading-tight py-0.5 italic">Rec</td>
								{#each teeth as tooth}
									<td class="border-l border-border/50 p-0">
										<div class="flex">
											{#each activeBucSites as site}
												{@const rec = chartState.getM(tooth, site).recession}
												<span class="flex-1 h-4 text-center text-[9px] text-rose-600 dark:text-rose-400 leading-4 font-mono">
													{rec !== null && rec > 0 ? rec : ''}
												</span>
											{/each}
										</div>
									</td>
								{/each}
							</tr>
						{/if}

						<!-- Lingual PD row -->
						<tr class="border-t border-border/30 bg-rose-50/30 dark:bg-rose-950/10">
							<td class="pr-1 text-right text-muted-foreground text-[10px] leading-tight py-0.5">L</td>
							{#each teeth as tooth}
								<td class="border-l border-border/50 p-0">
									<div class="flex">
										{#each activeLingSites as site, si}
											{@const m = chartState.getM(tooth, site)}
											<button
												type="button"
												class={['flex-1 h-6 text-center font-mono transition-colors outline-none relative', pdChipClass(m.pocket, m.bop), isCursor(tooth,'ling',si) ? 'ring-1 ring-inset ring-rose-500' : '', chartState.locked ? 'cursor-default' : 'hover:bg-rose-100/50 dark:hover:bg-rose-900/20'].filter(Boolean).join(' ')}
												onclick={() => chartState.cursor = { tooth, row: 'ling', siteIdx: si }}
												onkeydown={e => handleCellKeydown(e, tooth, 'ling', si)}
												oncontextmenu={e => { e.preventDefault(); chartState.cycleBop(tooth, site); }}
											>
												{m.pocket ?? '·'}
												{#if m.bop > 0}
													<span class="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full {bopDotClass(m.bop)}"></span>
												{/if}
												{#if m.plaque > 0}
													<span class="absolute bottom-0.5 left-0.5 w-1.5 h-1.5 rounded-sm bg-blue-400 opacity-75"></span>
												{/if}
											</button>
										{/each}
									</div>
								</td>
							{/each}
						</tr>

						<!-- Lingual recession -->
						{#if hasRecession}
							<tr class="border-t border-border/20 bg-rose-50/20 dark:bg-rose-950/5">
								<td class="pr-1 text-right text-muted-foreground text-[9px] leading-tight py-0.5 italic">Rec</td>
								{#each teeth as tooth}
									<td class="border-l border-border/50 p-0">
										<div class="flex">
											{#each activeLingSites as site}
												{@const rec = chartState.getM(tooth, site).recession}
												<span class="flex-1 h-4 text-center text-[9px] text-rose-600 dark:text-rose-400 leading-4 font-mono">
													{rec !== null && rec > 0 ? rec : ''}
												</span>
											{/each}
										</div>
									</td>
								{/each}
							</tr>
						{/if}

						<!-- AIT planned row -->
						<tr class="border-t border-border/30">
							<td class="pr-1 text-right text-muted-foreground text-[10px] leading-tight py-0.5">AIT</td>
							{#each teeth as tooth}
								<td class="border-l border-border/50 text-center text-[9px]">
									<button
										type="button"
										class={['w-full leading-tight py-0.5', chartState.getT(tooth).ait_planned ? 'text-red-600 font-bold' : 'text-muted-foreground/40', chartState.locked ? 'cursor-default' : ''].join(' ')}
										onclick={() => chartState.setT(tooth, { ait_planned: !chartState.getT(tooth).ait_planned })}
										title={i18n.t.par.grid.aitPlanned}
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
		<span>{i18n.t.par.grid.hintRecession}</span>
		<span>{i18n.t.par.grid.hintPlaque}</span>
		<span class="flex items-center gap-1"><span class="inline-block h-3 w-3 rounded-sm bg-red-200"></span> ≥6mm</span>
		<span class="flex items-center gap-1"><span class="inline-block h-2 w-2 rounded-full bg-red-500"></span> BOP</span>
		<span class="flex items-center gap-1"><span class="inline-block h-2 w-2 rounded-sm bg-blue-400"></span> Plaque</span>
	</div>
</div>
