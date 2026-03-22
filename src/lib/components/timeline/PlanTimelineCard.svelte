<script lang="ts">
	import type { TimelineEntry, TreatmentPlan, TreatmentPlanStatus } from '$lib/types';
	import { getTreatmentPlanItems } from '$lib/services/db';
	import { onMount } from 'svelte';
	import { i18n } from '$lib/i18n';
	import { formatDate } from '$lib/utils';

	let {
		entry,
		plan,
		onOpen,
	}: {
		entry: TimelineEntry;
		plan: TreatmentPlan | undefined;
		onOpen: () => void;
	} = $props();

	let totalItems     = $state(0);
	let completedItems = $state(0);

	onMount(async () => {
		if (plan) {
			const items = await getTreatmentPlanItems(plan.plan_id);
			totalItems     = items.length;
			completedItems = items.filter(i => i.status === 'completed').length;
		}
	});

	const pct = $derived(totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0);

	const STATUS_CONFIG = $derived<Record<TreatmentPlanStatus, { label: string; class: string }>>({
		proposed:    { label: i18n.t.plans.status.draft,      class: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400' },
		accepted:    { label: i18n.t.plans.status.active,     class: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400' },
		in_progress: { label: i18n.t.plans.status.active,     class: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400' },
		completed:   { label: i18n.t.plans.status.completed,  class: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400' },
		cancelled:   { label: i18n.t.plans.status.cancelled,  class: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400' },
	});



	function formatCost(val: number): string {
		if (!val) return '';
		return '· Est. ' + val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
	}
</script>

<!-- Timeline dot + line already provided by parent layout -->
<div class="mb-4 ml-8 flex items-start gap-3">
	<!-- Timeline dot at left -->
	<div class="absolute left-0 flex h-3 w-3 items-center justify-center rounded-full bg-primary/80 ring-2 ring-background mt-3">
	</div>

	<!-- Card -->
	<button
		type="button"
		onclick={onOpen}
		class="group w-full flex flex-col gap-2 rounded-lg border bg-card p-4 text-left shadow-xs transition-all hover:border-primary/40 hover:shadow-sm"
	>
		<!-- Header row -->
		<div class="flex items-start justify-between gap-3">
			<div class="flex items-center gap-2 min-w-0">
				<!-- Plan icon -->
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-primary shrink-0">
					<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
					<polyline points="14 2 14 8 20 8"/>
					<line x1="16" y1="13" x2="8" y2="13"/>
					<line x1="16" y1="17" x2="8" y2="17"/>
				</svg>
				<div class="min-w-0">
					<p class="font-semibold text-sm leading-snug group-hover:text-primary transition-colors truncate">
						{plan?.title ?? entry.title}
					</p>
					{#if plan?.description}
						<p class="text-xs text-muted-foreground line-clamp-1 mt-0.5">{plan.description}</p>
					{/if}
				</div>
			</div>

			<div class="flex items-center gap-1.5 shrink-0">
				{#if plan}
					{@const cfg = STATUS_CONFIG[plan.status] ?? STATUS_CONFIG.proposed}
					<span class="rounded-full border px-2 py-0.5 text-xs font-medium {cfg.class}">
						{cfg.label}
					</span>
				{/if}
				<!-- Arrow hint -->
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary transition-colors">
					<path d="M9 18l6-6-6-6"/>
				</svg>
			</div>
		</div>

		<!-- Progress bar -->
		{#if totalItems > 0}
			<div class="flex flex-col gap-1">
				<div class="flex items-center justify-between text-xs text-muted-foreground">
					<span>{completedItems} of {totalItems} procedures</span>
					<span>{pct}%</span>
				</div>
				<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
					<div class="h-full rounded-full bg-emerald-500 transition-all" style="width: {pct}%"></div>
				</div>
			</div>
		{:else if plan}
			<p class="text-xs text-muted-foreground/60 italic">No procedures added yet</p>
		{/if}

		<!-- Date + cost -->
		<div class="flex items-center gap-2 text-xs text-muted-foreground/70">
			<span>{formatDate(entry.entry_date)}</span>
			{#if plan}
				<span>{formatCost(plan.total_estimated_cost)}</span>
			{/if}
		</div>
	</button>
</div>
