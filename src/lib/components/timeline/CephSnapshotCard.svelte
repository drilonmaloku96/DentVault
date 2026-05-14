<script lang="ts">
	import type { TimelineEntry } from '$lib/types';
	import { formatDate } from '$lib/utils';
	import { i18n } from '$lib/i18n';
	import { goto } from '$app/navigation';

	let {
		entry,
		patientId,
	}: {
		entry: TimelineEntry;
		patientId: string;
	} = $props();

	interface CephSnapshotData {
		imageName?: string;
		pointCount?: number;
		hasRefScale?: boolean;
		templateName?: string;
		clinicalNotes?: string;
		measurements?: {
			angular: Array<{ name: string; value: number | null; standard: { value: number; deviation: number } | null }>;
			linear: Array<{ name: string; value: number | null; standard: { value: number; deviation: number } | null }>;
		};
	}

	const data = $derived.by((): CephSnapshotData | null => {
		try { return entry.chart_data ? (JSON.parse(entry.chart_data) as CephSnapshotData) : null; }
		catch { return null; }
	});

	function deviationStatus(
		value: number | null,
		std: { value: number; deviation: number } | null,
	): 'normal' | 'warning' | 'alert' | 'unknown' {
		if (value === null || !std) return 'unknown';
		const d = Math.abs(value - std.value);
		if (d <= std.deviation) return 'normal';
		if (d <= std.deviation * 2) return 'warning';
		return 'alert';
	}

	const angularSummary = $derived.by(() => {
		const items = data?.measurements?.angular ?? [];
		return items.slice(0, 4).map((m) => {
			const status = deviationStatus(m.value, m.standard);
			return { name: m.name, value: m.value, status };
		});
	});
</script>

<div class="mb-2 ml-8">
	<div class="absolute left-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-cyan-500 ring-2 ring-background mt-1.5"></div>

	<div class="py-1.5">
		<!-- Title row -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex items-center gap-2 w-full rounded-md px-1.5 py-1 -mx-1.5 cursor-pointer hover:bg-muted/50 transition-colors"
			onclick={() => goto(`/patients/${patientId}/ceph`)}
		>
			<!-- Ceph icon (skull X-ray) -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-cyan-500 shrink-0">
				<circle cx="12" cy="10" r="7"/>
				<path d="M9 17v1a3 3 0 0 0 6 0v-1"/>
				<path d="M9 10h.01M15 10h.01"/>
			</svg>

			<span class="text-sm font-semibold text-foreground">{entry.title || i18n.t.ceph.title}</span>
			<span class="text-[10px] text-muted-foreground/50">{formatDate(entry.entry_date)}</span>

			{#if data?.pointCount != null}
				<span class="ml-1 px-1.5 py-0 rounded bg-muted text-[10px] text-muted-foreground font-mono">
					{data.pointCount} pts
				</span>
			{/if}

			{#if data?.hasRefScale}
				<span class="px-1.5 py-0 rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 text-[10px]">
					{i18n.t.ceph.refScaleSet}
				</span>
			{/if}

			<!-- Always locked -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-auto h-3 w-3 text-muted-foreground/30 shrink-0">
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
				<path d="M7 11V7a5 5 0 0 1 10 0v4"/>
			</svg>
		</div>

		<!-- Template name -->
		{#if data?.templateName}
			<p class="text-[11px] text-muted-foreground/70 mt-0.5 ml-5.5 leading-snug">
				{data.templateName}
				{#if data.imageName}· {data.imageName}{/if}
			</p>
		{/if}

		<!-- Angular measurements summary (top 4) -->
		{#if angularSummary.length > 0}
			<div class="flex flex-wrap gap-1 mt-1 ml-5.5">
				{#each angularSummary as m}
					<span class="px-1.5 py-0 rounded text-[10px] font-mono
						{m.status === 'normal'
							? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
							: m.status === 'warning'
							? 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
							: m.status === 'alert'
							? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
							: 'bg-muted text-muted-foreground'}">
						{m.name} {m.value !== null ? m.value.toFixed(1) + '°' : '—'}
					</span>
				{/each}
			</div>
		{/if}

		<!-- Clinical notes -->
		{#if data?.clinicalNotes}
			<p class="text-[11px] text-foreground/80 mt-1 ml-5.5 line-clamp-2 bg-muted/30 rounded px-1.5 py-0.5">
				{data.clinicalNotes}
			</p>
		{/if}
	</div>
</div>
