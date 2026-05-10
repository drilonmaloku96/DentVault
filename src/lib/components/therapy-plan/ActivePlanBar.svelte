<script lang="ts">
	import type { TreatmentPlan } from '$lib/types';
	import type { PlanStep } from '$lib/types';
	import { i18n } from '$lib/i18n';

	let {
		plan,
		onOpen,
	}: {
		plan: TreatmentPlan;
		onOpen: () => void;
	} = $props();

	// Parse step progress directly from plan_chart_data
	const steps = $derived.by((): PlanStep[] => {
		try {
			const v = JSON.parse(plan.plan_chart_data ?? '{}');
			if (v && 'steps' in v) return v.steps ?? [];
			if (v && ('procedures' in v || 'entries' in v)) {
				// Legacy: count teeth × procedures as steps
				const procs = v.procedures ?? {} as Record<string, string[]>;
				return Object.entries(procs).flatMap(([t, ps]) =>
					(Array.isArray(ps) ? ps : [ps]).map(p => ({
						id: t + p, teeth: [parseInt(t)], procKey: p as string, done: false, addedAt: ''
					}))
				);
			}
		} catch { /* */ }
		return [];
	});

	const completedCount = $derived(steps.filter(s => s.done).length);
	const totalCount     = $derived(steps.length);
	const pct            = $derived(totalCount > 0 ? completedCount / totalCount : 0);

	const R    = 9;
	const CIRC = $derived(2 * Math.PI * R);

	function statusDot(s: string) {
		if (s === 'in_progress') return '#f59e0b';
		if (s === 'accepted')   return '#60a5fa';
		return '#a1a1aa';
	}
</script>

<button
	onclick={onOpen}
	class="group flex items-center gap-2.5 rounded-lg border border-blue-200/80 dark:border-blue-800/50
		bg-blue-50 dark:bg-blue-950/25 hover:bg-blue-100 dark:hover:bg-blue-950/40
		px-3 py-2 transition-all hover:border-blue-300 dark:hover:border-blue-700/70
		hover:shadow-sm active:scale-[0.98] text-left min-w-[160px] max-w-[280px]"
>
	<!-- Completion ring -->
	<svg width="22" height="22" viewBox="0 0 22 22" class="shrink-0" aria-hidden="true">
		<!-- Track -->
		<circle cx="11" cy="11" r={R} fill="none" stroke="currentColor" stroke-width="2.5"
			class="text-blue-200/70 dark:text-blue-800/50"/>
		{#if pct >= 1}
			<!-- Full — solid green with check -->
			<circle cx="11" cy="11" r={R} fill="#22c55e"/>
			<polyline points="7,11 10,14 15,8" fill="none" stroke="white" stroke-width="2"
				stroke-linecap="round" stroke-linejoin="round"/>
		{:else if pct > 0}
			<!-- Partial arc -->
			<circle cx="11" cy="11" r={R} fill="none" stroke="#3b82f6" stroke-width="2.5"
				stroke-dasharray={CIRC} stroke-dashoffset={CIRC * (1 - pct)}
				stroke-linecap="round" transform="rotate(-90 11 11)"/>
			<!-- Status dot center -->
			<circle cx="11" cy="11" r="2.5" fill={statusDot(plan.status)}/>
		{:else}
			<!-- Empty — just status dot -->
			<circle cx="11" cy="11" r="2.5" fill={statusDot(plan.status)}/>
		{/if}
	</svg>

	<!-- Plan title + count -->
	<div class="flex-1 min-w-0">
		<p class="text-xs font-semibold text-blue-900 dark:text-blue-200 truncate leading-tight">
			{plan.title}
		</p>
		{#if totalCount > 0}
			<p class="text-[10px] text-blue-600/70 dark:text-blue-400/70 tabular-nums leading-tight mt-px">
				{completedCount}/{totalCount} {totalCount === 1 ? i18n.t.plans.stepSingular : i18n.t.plans.stepPlural}
			</p>
		{:else}
			<p class="text-[10px] text-blue-500/50 dark:text-blue-500/40 leading-tight mt-px italic">{i18n.t.plans.noSteps}</p>
		{/if}
	</div>

	<!-- Arrow -->
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
		stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
		class="h-3 w-3 shrink-0 text-blue-400 dark:text-blue-500 group-hover:translate-x-0.5 transition-transform"
	>
		<polyline points="9 18 15 12 9 6"/>
	</svg>
</button>
