<script lang="ts">
	/**
	 * ParCompareView — Stage D.
	 * Compares current assessment against a chosen baseline from the same case.
	 * Shows: ghost bars on the SVG chart, delta chips, compareSnapshots summary, sparklines.
	 */

	import { onMount } from 'svelte';
	import { getParAssessments, loadParAssessmentSnapshot } from '$lib/services/db';
	import { compareSnapshots } from '$lib/utils/par-stats';
	import type { ParAssessment, ParCase, ParAssessmentSnapshot } from '$lib/types';
	import type { ParChartState } from './ParChartState.svelte';
	import { i18n } from '$lib/i18n';
	import { formatDate } from '$lib/utils';
	import ParToothChartSVG from './ParToothChartSVG.svelte';

	let {
		assessment,
		parCase,
		currentState,
	}: {
		assessment: ParAssessment;
		parCase: ParCase;
		currentState: ParChartState;
	} = $props();

	let allAssessments = $state<ParAssessment[]>([]);
	let baselineId     = $state<number | null>(null);
	let baseline       = $state<ParAssessmentSnapshot | null>(null);
	let loading        = $state(false);

	// Build comparison mmap for the SVG chart ghost bars
	const comparisonMmap = $derived.by(() => {
		if (!baseline) return null;
		const map: Record<string, { pocket: number | null }> = {};
		for (const m of baseline.measurements) {
			map[`${m.tooth}-${m.site}`] = { pocket: m.pocket };
		}
		return map;
	});

	const deltaSummary = $derived.by(() => {
		if (!baseline) return null;
		const currentSnapshot: ParAssessmentSnapshot = {
			assessment,
			measurements: currentState.buildMeasurementsArray().map((m, i) => ({ id: i, assessment_id: assessment.id, ...m })),
			toothData:    currentState.buildToothDataArray(),
			boneLevels:   [],
		};
		return compareSnapshots(baseline, currentSnapshot);
	});

	onMount(async () => {
		const list = await getParAssessments(parCase.id);
		// Only show earlier assessments as baseline options
		allAssessments = list.filter(a => a.id !== assessment.id);
		// Default: previous assessment
		const prev = [...allAssessments].reverse().find(a => a.id < assessment.id);
		if (prev) {
			baselineId = prev.id;
			await loadBaseline(prev.id);
		}
	});

	async function loadBaseline(id: number) {
		loading = true;
		baseline = await loadParAssessmentSnapshot(id);
		loading = false;
	}

	$effect(() => {
		if (baselineId !== null) {
			void loadBaseline(baselineId);
		}
	});

	function sign(n: number): string {
		return n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Baseline selector -->
	<div class="flex items-center gap-3">
		<span class="text-xs font-medium text-muted-foreground">{i18n.t.par.compare.baseline}:</span>
		{#if allAssessments.length === 0}
			<span class="text-xs text-muted-foreground italic">{i18n.t.par.compare.noBaseline}</span>
		{:else}
			<select
				class="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
				onchange={e => {
					const v = Number((e.currentTarget as HTMLSelectElement).value);
					baselineId = v || null;
				}}
			>
				{#each allAssessments as a}
					<option value={a.id} selected={a.id === baselineId}>
						{i18n.t.par.stepTypeShort[a.type]} — {formatDate(a.exam_date)}
					</option>
				{/each}
			</select>
		{/if}
	</div>

	{#if loading}
		<div class="flex items-center justify-center py-8">
			<svg class="h-5 w-5 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
				<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
			</svg>
		</div>
	{:else if baseline && deltaSummary}
		<!-- Delta summary strip -->
		<div class="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
			<span>
				<span class="text-muted-foreground">{i18n.t.par.compare.bopDelta}:</span>
				<strong class={deltaSummary.bopDelta < 0 ? 'text-green-600' : deltaSummary.bopDelta > 0 ? 'text-red-600' : ''}>
					{sign(deltaSummary.bopDelta)}%
				</strong>
			</span>
			<span>
				<span class="text-muted-foreground">{i18n.t.par.compare.pdDelta}:</span>
				<strong class={deltaSummary.meanPocketDelta < 0 ? 'text-green-600' : deltaSummary.meanPocketDelta > 0 ? 'text-red-600' : ''}>
					{sign(deltaSummary.meanPocketDelta)}mm
				</strong>
			</span>
			<span>
				<span class="text-muted-foreground">{i18n.t.par.compare.calDelta}:</span>
				<strong class={deltaSummary.cal_delta < 0 ? 'text-green-600' : deltaSummary.cal_delta > 0 ? 'text-red-600' : ''}>
					{sign(deltaSummary.cal_delta)}mm
				</strong>
			</span>
			<span>
				<span class="text-green-600 font-medium">▼{deltaSummary.improvedTeeth}</span>
				<span class="text-muted-foreground ml-0.5">{i18n.t.par.compare.improved}</span>
			</span>
			<span>
				<span class="text-red-600 font-medium">▲{deltaSummary.worsenedTeeth}</span>
				<span class="text-muted-foreground ml-0.5">{i18n.t.par.compare.worsened}</span>
			</span>
			{#if deltaSummary.teethWithPocket6Resolved > 0}
				<span class="text-green-700 dark:text-green-400 font-medium">
					✓ {deltaSummary.teethWithPocket6Resolved} {i18n.t.par.compare.resolvedPockets}
				</span>
			{/if}
		</div>

		<!-- SVG chart with ghost bars for baseline -->
		<ParToothChartSVG chartState={currentState} comparisonMmap={comparisonMmap} />

		<!-- Ghost bar legend -->
		<p class="text-[10px] text-muted-foreground">
			Solid bars = current ({formatDate(assessment.exam_date)}) ·
			Ghost bars = baseline ({formatDate(baseline.assessment.exam_date)})
		</p>
	{:else if allAssessments.length > 0}
		<p class="text-sm text-muted-foreground text-center py-8">Select a baseline to compare.</p>
	{/if}
</div>
