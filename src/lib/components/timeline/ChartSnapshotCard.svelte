<script lang="ts">
	import type { TimelineEntry } from '$lib/types';
	import { formatDate } from '$lib/utils';
	import { i18n } from '$lib/i18n';

	let {
		entry,
		onView,
	}: {
		entry: TimelineEntry;
		onView: () => void;
	} = $props();

	let expanded = $state(false);

	const description = $derived(entry.description || '');
	const lines = $derived(description.split('\n'));
	const isLong = $derived(lines.length > 4);
	const previewText = $derived(isLong ? lines.slice(0, 4).join('\n') : description);
</script>

<div class="mb-2 ml-8">
	<!-- Timeline dot -->
	<div class="absolute left-0 flex h-3 w-3 items-center justify-center rounded-full bg-indigo-500 ring-2 ring-background mt-1.5"></div>

	<!-- Compact inline layout (no card border) -->
	<div class="py-1.5">
		<!-- Title row — entire row is clickable to open snapshot viewer -->
		<button
			type="button"
			onclick={onView}
			class="flex items-center gap-2 w-full text-left rounded-md px-1.5 py-1 -mx-1.5 -my-1 hover:bg-indigo-500/8 transition-colors group cursor-pointer"
			title={i18n.t.timeline.snapshot.view}
		>
			<!-- Tooth icon -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-indigo-500 shrink-0">
				<path d="M12 2c-1.5 0-3 .5-4 1.5C6.5 5 6 7 6 9c0 3 1 6 2 9 .5 1.5 1 2 2 2h4c1 0 1.5-.5 2-2 1-3 2-6 2-9 0-2-.5-4-2-5.5C15 2.5 13.5 2 12 2z"/>
			</svg>
			<span class="text-xs font-medium text-foreground group-hover:text-indigo-600 transition-colors">{i18n.t.timeline.snapshot.title}</span>
			<span class="text-[10px] text-muted-foreground/50">{formatDate(entry.entry_date)}</span>

			<!-- Eye icon on the right -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-auto h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-indigo-500 transition-colors shrink-0">
				<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
				<circle cx="12" cy="12" r="3"/>
			</svg>
		</button>

		<!-- Description text (auto-generated report) -->
		{#if description}
			<div class="mt-1 ml-5.5 text-[11px] text-muted-foreground/70 whitespace-pre-line leading-relaxed font-mono">
				{#if expanded || !isLong}
					{description}
				{:else}
					{previewText}…
				{/if}
			</div>
			{#if isLong}
				<button
					type="button"
					onclick={() => (expanded = !expanded)}
					class="ml-5.5 mt-0.5 text-[10px] text-indigo-500/70 hover:text-indigo-500 transition-colors"
				>
					{expanded ? i18n.t.chart.snapshotReport.showLess : i18n.t.chart.snapshotReport.showMore}
				</button>
			{/if}
		{/if}
	</div>
</div>
