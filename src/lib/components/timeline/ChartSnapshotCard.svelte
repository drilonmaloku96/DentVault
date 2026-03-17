<script lang="ts">
	import type { TimelineEntry, ToothChartEntry } from '$lib/types';

	let {
		entry,
		onView,
	}: {
		entry: TimelineEntry;
		onView: () => void;
	} = $props();

	// Parse chart_data to get summary stats
	const chartEntries = $derived((): ToothChartEntry[] => {
		try {
			return JSON.parse(entry.chart_data || '[]') as ToothChartEntry[];
		} catch {
			return [];
		}
	});

	const notedCount = $derived(chartEntries().filter(t => t.condition && t.condition !== 'healthy').length);
	const totalCount = $derived(chartEntries().length);

	// Summarise the top conditions
	const conditionSummary = $derived((): string => {
		const teeth = chartEntries();
		if (teeth.length === 0) return '';
		const counts: Record<string, number> = {};
		for (const t of teeth) {
			if (t.condition && t.condition !== 'healthy') {
				counts[t.condition] = (counts[t.condition] ?? 0) + 1;
			}
		}
		return Object.entries(counts)
			.sort((a, b) => b[1] - a[1])
			.slice(0, 3)
			.map(([k, v]) => `${k} (${v})`)
			.join(', ');
	});

	function formatDate(val: string): string {
		if (!val) return '';
		const d = new Date(val);
		return isNaN(d.getTime()) ? val : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<div class="mb-4 ml-8">
	<!-- Timeline dot provided by parent layout -->
	<div class="absolute left-0 flex h-3 w-3 items-center justify-center rounded-full bg-indigo-500 ring-2 ring-background mt-3"></div>

	<div class="rounded-lg border bg-card p-4 shadow-xs">
		<!-- Header -->
		<div class="flex items-start justify-between gap-3">
			<div class="flex items-center gap-2">
				<!-- Tooth icon -->
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-indigo-500 shrink-0">
					<path d="M12 2c-1.5 0-3 .5-4 1.5C6.5 5 6 7 6 9c0 3 1 6 2 9 .5 1.5 1 2 2 2h4c1 0 1.5-.5 2-2 1-3 2-6 2-9 0-2-.5-4-2-5.5C15 2.5 13.5 2 12 2z"/>
				</svg>
				<div>
					<p class="font-semibold text-sm">{entry.title || 'Dental Chart Snapshot'}</p>
					<p class="text-xs text-muted-foreground mt-0.5">
						{#if totalCount > 0}
							{notedCount > 0
								? `${notedCount} of ${totalCount} teeth with conditions`
								: `${totalCount} teeth recorded — all healthy`}
						{:else}
							No teeth data
						{/if}
					</p>
					{#if conditionSummary()}
						<p class="text-xs text-muted-foreground/70 mt-0.5 capitalize">{conditionSummary()}</p>
					{/if}
				</div>
			</div>

			<!-- Date + view button -->
			<div class="flex flex-col items-end gap-1.5 shrink-0">
				<span class="text-xs text-muted-foreground/50">{formatDate(entry.entry_date)}</span>
			</div>
		</div>

		<!-- Footer: View Chart button -->
		<div class="mt-3 pt-3 border-t border-border/50 flex justify-end">
			<button
				type="button"
				onclick={onView}
				class="inline-flex items-center gap-1 rounded-md border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
					<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
					<circle cx="12" cy="12" r="3"/>
				</svg>
				View Chart
			</button>
		</div>
	</div>
</div>
