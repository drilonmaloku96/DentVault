<script lang="ts">
	import type { TimelineEntry, OrthoAssessment } from '$lib/types';
	import { formatDate } from '$lib/utils';
	import { i18n } from '$lib/i18n';

	let {
		entry,
	}: {
		entry: TimelineEntry;
	} = $props();

	const assessment: OrthoAssessment | null = $derived.by(() => {
		try { return entry.chart_data ? (JSON.parse(entry.chart_data) as OrthoAssessment) : null; }
		catch { return null; }
	});

	const isCovered = $derived(assessment?.findings.some(f => f.grade >= 3) ?? false);

	function gradeLabel(f: { group: string; grade: number; measured_value: number | null }) {
		return `${f.group}${f.grade}${f.measured_value !== null ? ` ${f.measured_value}mm` : ''}`;
	}
</script>

<div class="mb-2 ml-8">
	<!-- Timeline dot -->
	<div class="absolute left-0 flex h-3 w-3 items-center justify-center rounded-full bg-violet-500 ring-2 ring-background mt-1.5"></div>

	<div class="py-1.5">
		<!-- Title row — read-only, no click handler -->
		<div class="flex items-center gap-2 w-full rounded-md px-1.5 py-1 -mx-1.5">
			<!-- KIG icon -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-violet-500 shrink-0">
				<path d="M9 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9"/>
				<polyline points="9 2 9 9 16 9"/>
				<line x1="12" y1="13" x2="12" y2="17"/>
				<line x1="10" y1="15" x2="14" y2="15"/>
			</svg>
			<span class="text-xs font-medium text-foreground">{i18n.t.ortho.button}</span>
			<span class="text-[10px] text-muted-foreground/50">{formatDate(entry.entry_date)}</span>

			{#if assessment}
				<span class="ml-1 px-1.5 py-0 rounded-full text-[10px] font-medium {isCovered ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-muted text-muted-foreground'}">
					{isCovered ? i18n.t.ortho.insuranceCovered : i18n.t.ortho.notCovered}
				</span>
			{/if}

			<!-- Lock icon — past entries are read-only -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-auto h-3 w-3 text-muted-foreground/30 shrink-0">
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
				<path d="M7 11V7a5 5 0 0 1 10 0v4"/>
			</svg>
		</div>

		<!-- Findings chips -->
		{#if assessment?.findings && assessment.findings.length > 0}
			<div class="flex flex-wrap gap-1 mt-1 ml-5.5">
				{#each assessment.findings as f}
					<span class="px-1.5 py-0 rounded text-[10px] font-mono {f.grade >= 3 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-muted text-muted-foreground'}">
						{gradeLabel(f)}
					</span>
				{/each}
			</div>
		{/if}

		{#if assessment?.treatment_recommendation}
			<p class="text-[11px] text-muted-foreground/70 mt-0.5 ml-5.5 line-clamp-1">→ {assessment.treatment_recommendation}</p>
		{/if}
	</div>
</div>
