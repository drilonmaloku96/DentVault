<script lang="ts">
	/**
	 * ParEntryHud — sticky entry footer shown while charting.
	 * Displays: current tooth/site, last entered value, mode toggles,
	 * big BOP button, auto-advance checkbox, progress bar.
	 */

	import type { ParChartState } from './ParChartState.svelte';
	import type { InputMode } from './ParChartState.svelte';
	import { i18n } from '$lib/i18n';

	let {
		chartState,
		onStart,
	}: {
		chartState: ParChartState;
		onStart?: () => void;
	} = $props();

	// Cursor-derived display values
	const cursorTooth = $derived(chartState.cursor?.tooth ?? null);
	const cursorSite  = $derived(() =>
		chartState.cursor ? chartState.siteAt(chartState.cursor) : null,
	);

	const lastValue = $derived(() => {
		if (!cursorTooth || !cursorSite()) return null;
		const m = chartState.getM(cursorTooth, cursorSite() as any);
		return chartState.inputMode === 'recession' ? m.recession : m.pocket;
	});

	const progress = $derived(() => {
		const total = chartState.guidedOrder.length;
		const idx   = chartState.cursorIndex;
		return { idx: idx >= 0 ? idx + 1 : 0, total };
	});

	const progressPct = $derived(() => {
		const p = progress();
		return p.total > 0 ? (p.idx / p.total) * 100 : 0;
	});

	const MODE_LABELS: Record<InputMode, string> = {
		pd:        i18n.t.par.hud.pdMode,
		recession: i18n.t.par.hud.recessionMode,
		bone:      i18n.t.par.hud.boneMode,
	};
</script>

<div class="flex flex-col gap-2 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
	<!-- Progress bar -->
	<div class="h-1 w-full rounded-full bg-muted overflow-hidden">
		<div
			class="h-full rounded-full bg-primary/60 transition-all"
			style="width: {progressPct()}%"
		></div>
	</div>

	<div class="flex items-center gap-4 flex-wrap">
		<!-- Current position / start affordance -->
		<div class="flex items-center gap-2 min-w-0">
			{#if cursorTooth}
				<span class="text-xs font-mono font-semibold text-foreground">
					{i18n.t.par.hud.site}: <span class="text-primary">{i18n.t.par.hud.tooth} {cursorTooth} · {cursorSite()?.toUpperCase()}</span>
				</span>
				<span class="text-[10px] text-muted-foreground">
					{progress().idx} / {progress().total}
				</span>
			{:else}
				<button
					type="button"
					disabled={chartState.locked}
					onclick={() => onStart?.()}
					class="rounded-md bg-primary text-primary-foreground px-3 py-1 text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
				>
					▶ {i18n.t.par.hud.start}
				</button>
				<span class="text-xs text-muted-foreground">{i18n.t.par.hud.clickToStart}</span>
			{/if}
		</div>

		<!-- Last entered value -->
		{#if lastValue() !== null}
			<div class="flex items-center gap-1">
				<span class="text-[10px] text-muted-foreground">{chartState.inputMode === 'recession' ? 'Rec' : 'PD'}:</span>
				<span class="text-lg font-bold font-mono leading-none text-primary">{lastValue()}</span>
				<span class="text-[10px] text-muted-foreground">mm</span>
			</div>
		{/if}

		<div class="flex-1"></div>

		<!-- Mode toggles -->
		<div class="flex items-center gap-1 rounded-md border border-border p-0.5 bg-muted/30">
			{#each (['pd', 'recession', 'bone'] as const) as mode}
				<button
					type="button"
					disabled={chartState.locked}
					onclick={() => chartState.inputMode = mode}
					class={[
						'rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
						chartState.inputMode === mode
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground',
						chartState.locked ? 'opacity-50 cursor-default' : '',
					].join(' ')}
					title={MODE_LABELS[mode]}
				>{MODE_LABELS[mode]}</button>
			{/each}
		</div>

		<!-- BOP button (touch-friendly) -->
		{#if cursorTooth && cursorSite() && chartState.inputMode === 'pd'}
			{@const m = chartState.getM(cursorTooth, cursorSite() as any)}
			<button
				type="button"
				disabled={chartState.locked}
				onclick={() => chartState.cycleBop(cursorTooth!, cursorSite()! as any)}
				class={[
					'rounded-md px-3 py-1 text-xs font-semibold border transition-colors',
					m.bop === 0 ? 'border-border text-muted-foreground hover:bg-muted'
					: m.bop === 1 ? 'bg-red-100 dark:bg-red-900/30 border-red-300 text-red-700 dark:text-red-300'
					: 'bg-yellow-100 dark:bg-yellow-900/30 border-yellow-300 text-yellow-700 dark:text-yellow-300',
					chartState.locked ? 'opacity-50 cursor-default' : '',
				].join(' ')}
				title={i18n.t.par.hud.bop}
			>
				{i18n.t.par.hud.bop}
				{m.bop === 1 ? ' ●' : m.bop === 2 ? ' ◆' : ''}
			</button>
		{/if}

		<!-- Bone-level clear buttons (shown in bone mode) -->
		{#if chartState.inputMode === 'bone'}
			<div class="flex items-center gap-1">
				<span class="text-[10px] text-muted-foreground mr-1">{i18n.t.par.chart.boneLevel}:</span>
				<button
					type="button"
					disabled={chartState.locked || chartState.boneUpper.length === 0}
					onclick={() => chartState.clearBoneLevel('upper')}
					class="rounded px-2 py-0.5 text-[10px] border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-default"
					title="Clear upper bone level line"
				>✕ Upper</button>
				<button
					type="button"
					disabled={chartState.locked || chartState.boneLower.length === 0}
					onclick={() => chartState.clearBoneLevel('lower')}
					class="rounded px-2 py-0.5 text-[10px] border border-border text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-30 disabled:cursor-default"
					title="Clear lower bone level line"
				>✕ Lower</button>
			</div>
		{/if}

		<!-- Auto-advance toggle (hidden in bone mode — not applicable) -->
		{#if chartState.inputMode !== 'bone'}
			<label class="flex items-center gap-1.5 cursor-pointer {chartState.locked ? 'opacity-50 pointer-events-none' : ''}">
				<input
					type="checkbox"
					bind:checked={chartState.autoAdvance}
					class="h-3.5 w-3.5 accent-primary"
				/>
				<span class="text-[10px] text-muted-foreground">{i18n.t.par.hud.autoAdvance}</span>
			</label>
		{/if}
	</div>

	<!-- Keyboard shortcut hints -->
	{#if chartState.inputMode !== 'bone'}
		<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground/70">
			<span><kbd class="rounded border border-border bg-muted px-1 font-mono">0–9</kbd> {i18n.t.par.grid.hintNumbersShort}</span>
			<span><kbd class="rounded border border-border bg-muted px-1 font-mono">⇧+0–2</kbd> {i18n.t.par.grid.hintShift}</span>
			<span><kbd class="rounded border border-border bg-muted px-1 font-mono">B</kbd> {i18n.t.par.hud.bop}</span>
			<span><kbd class="rounded border border-border bg-muted px-1 font-mono">P</kbd> {i18n.t.par.hud.plaque}</span>
			<span><kbd class="rounded border border-border bg-muted px-1 font-mono">R</kbd> {i18n.t.par.hud.recessionMode}</span>
			<span><kbd class="rounded border border-border bg-muted px-1 font-mono">⌫</kbd> {i18n.t.par.grid.hintClear}</span>
			<span><kbd class="rounded border border-border bg-muted px-1 font-mono">Tab/Enter</kbd> {i18n.t.par.grid.hintNext}</span>
		</div>
	{/if}
</div>
