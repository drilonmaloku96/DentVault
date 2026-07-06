<script lang="ts">
	/**
	 * ParToothPopover — per-tooth data editor.
	 * Opens anchored to the tooth's screen position.
	 * Edits: mobility, furcation B/M/D, vitality, status, AIT planned, CPT planned.
	 */

	import type { ParChartState } from './ParChartState.svelte';
	import type { ParToothStatus } from '$lib/types';
	import { i18n } from '$lib/i18n';

	let {
		tooth,
		chartState,
		anchorX,
		anchorY,
		onClose,
	}: {
		tooth: number;
		chartState: ParChartState;
		anchorX: number;
		anchorY: number;
		onClose: () => void;
	} = $props();

	const td = $derived(chartState.getT(tooth));

	const MOBILITY_OPTIONS = [
		{ value: null, label: '–' },
		{ value: 0,    label: '0' },
		{ value: 1,    label: 'I' },
		{ value: 2,    label: 'II' },
		{ value: 3,    label: 'III' },
	];

	const FURC_OPTIONS = [
		{ value: null, label: '–' },
		{ value: 0,    label: '0' },
		{ value: 1,    label: 'I' },
		{ value: 2,    label: 'II' },
		{ value: 3,    label: 'III' },
	];

	const STATUS_OPTIONS: { value: ParToothStatus | null; label: string }[] = [
		{ value: null,        label: i18n.t.par.tooth.statusNone },
		{ value: 'implant',   label: i18n.t.par.tooth.statusImplant },
		{ value: 'destroyed', label: i18n.t.par.tooth.statusDestroyed },
		{ value: 'missing',   label: i18n.t.par.tooth.statusMissing },
	];

	// Clamp popover into viewport (approximate 240px wide, 310px tall)
	const POP_W = 240;
	const POP_H = 310;
	const left = $derived(Math.min(Math.max(anchorX - POP_W / 2, 8), window.innerWidth  - POP_W - 8));
	const top  = $derived(Math.min(Math.max(anchorY - POP_H - 12, 8), window.innerHeight - POP_H - 8));

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKey}/>

<!-- Backdrop (click-outside closes) -->
<div
	class="fixed inset-0 z-[60]"
	role="dialog"
	aria-modal="true"
	aria-label="Tooth {tooth} details"
	onclick={onClose}
>
	<!-- Popover panel -->
	<div
		class="absolute rounded-xl border border-border bg-background shadow-2xl p-4 flex flex-col gap-3 z-[61]"
		style="left:{left}px; top:{top}px; width:{POP_W}px;"
		role="none"
		onclick={(e) => e.stopPropagation()}
	>
		<!-- Header -->
		<div class="flex items-center justify-between">
			<span class="text-sm font-semibold">{i18n.t.par.tooth.status} — Tooth {tooth}</span>
			<button
				type="button"
				onclick={onClose}
				class="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
				aria-label="Close"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
					<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
				</svg>
			</button>
		</div>

		<!-- Tooth status -->
		<div class="flex flex-col gap-1">
			<label class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{i18n.t.par.tooth.status}</label>
			<div class="flex flex-wrap gap-1">
				{#each STATUS_OPTIONS as opt}
					<button
						type="button"
						disabled={chartState.locked}
						onclick={() => chartState.setT(tooth, { status: opt.value })}
						class={[
							'rounded px-2 py-0.5 text-xs font-medium border transition-colors',
							td.status === opt.value
								? 'bg-primary text-primary-foreground border-primary'
								: 'border-border text-muted-foreground hover:bg-muted',
							chartState.locked ? 'opacity-50 cursor-default' : '',
						].join(' ')}
					>{opt.label}</button>
				{/each}
			</div>
		</div>

		<!-- Mobility -->
		<div class="flex items-center gap-2">
			<span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide w-20 flex-shrink-0">{i18n.t.par.tooth.mobility}</span>
			<div class="flex gap-1">
				{#each MOBILITY_OPTIONS as opt}
					<button
						type="button"
						disabled={chartState.locked}
						onclick={() => chartState.setT(tooth, { mobility: opt.value })}
						class={[
							'w-8 h-6 rounded text-xs font-mono border transition-colors',
							td.mobility === opt.value
								? 'bg-primary text-primary-foreground border-primary'
								: 'border-border text-muted-foreground hover:bg-muted',
							chartState.locked ? 'opacity-50 cursor-default' : '',
						].join(' ')}
					>{opt.label}</button>
				{/each}
			</div>
		</div>

		<!-- Furcation B / M / D -->
		<div class="flex flex-col gap-1">
			<span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">{i18n.t.par.tooth.furcation} (B / M / D)</span>
			{#each ([['furcation_b', 'B'], ['furcation_m', 'M'], ['furcation_d', 'D']] as const) as [field, label]}
				<div class="flex items-center gap-2">
					<span class="text-xs text-muted-foreground w-4">{label}</span>
					<div class="flex gap-1">
						{#each FURC_OPTIONS as opt}
							{@const cur = field === 'furcation_b' ? td.furcation_b : field === 'furcation_m' ? td.furcation_m : td.furcation_d}
							<button
								type="button"
								disabled={chartState.locked}
								onclick={() => chartState.setT(tooth, { [field]: opt.value })}
								class={[
									'w-7 h-5 rounded text-[10px] font-mono border transition-colors',
									cur === opt.value
										? 'bg-primary text-primary-foreground border-primary'
										: 'border-border text-muted-foreground hover:bg-muted',
									chartState.locked ? 'opacity-50 cursor-default' : '',
								].join(' ')}
							>{opt.label}</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<!-- Vitality -->
		<div class="flex items-center gap-2">
			<span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide w-20 flex-shrink-0">{i18n.t.par.tooth.vitality}</span>
			<div class="flex gap-1">
				{#each ([{ value: null, label: '–' }, { value: 1, label: i18n.t.par.tooth.vital }, { value: 0, label: i18n.t.par.tooth.nonVital }]) as opt}
					<button
						type="button"
						disabled={chartState.locked}
						onclick={() => chartState.setT(tooth, { vitality: opt.value })}
						class={[
							'rounded px-2 py-0.5 text-xs border transition-colors',
							td.vitality === opt.value
								? 'bg-primary text-primary-foreground border-primary'
								: 'border-border text-muted-foreground hover:bg-muted',
							chartState.locked ? 'opacity-50 cursor-default' : '',
						].join(' ')}
					>{opt.label}</button>
				{/each}
			</div>
		</div>

		<!-- AIT / CPT planned -->
		<div class="flex gap-3">
			<label class="flex items-center gap-1.5 cursor-pointer {chartState.locked ? 'opacity-50 pointer-events-none' : ''}">
				<input
					type="checkbox"
					checked={td.ait_planned}
					onchange={() => chartState.setT(tooth, { ait_planned: !td.ait_planned })}
					disabled={chartState.locked}
					class="h-3.5 w-3.5 accent-red-500"
				/>
				<span class="text-xs font-medium text-red-700 dark:text-red-400">{i18n.t.par.tooth.aitPlanned}</span>
			</label>
			<label class="flex items-center gap-1.5 cursor-pointer {chartState.locked ? 'opacity-50 pointer-events-none' : ''}">
				<input
					type="checkbox"
					checked={td.cpt_planned}
					onchange={() => chartState.setT(tooth, { cpt_planned: !td.cpt_planned })}
					disabled={chartState.locked}
					class="h-3.5 w-3.5 accent-violet-500"
				/>
				<span class="text-xs font-medium text-violet-700 dark:text-violet-400">{i18n.t.par.tooth.cptPlanned}</span>
			</label>
		</div>
	</div>
</div>
