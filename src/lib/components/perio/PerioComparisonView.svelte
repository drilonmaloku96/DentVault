<script lang="ts">
	import { toFDI } from '$lib/utils';
	import { i18n } from '$lib/i18n';

	let {
		currentDepths,
		comparisonDepths,
		currentBop,
		comparisonBop,
	}: {
		currentDepths: Record<string, number | null>;
		comparisonDepths: Record<string, number | null>;
		currentBop: Record<string, boolean>;
		comparisonBop: Record<string, boolean>;
	} = $props();

	interface SiteDelta {
		tooth: number;
		site: string;
		prev: number | null;
		curr: number | null;
		delta: number;
	}

	const deltas = $derived.by((): SiteDelta[] => {
		const result: SiteDelta[] = [];
		const allKeys = new Set([
			...Object.keys(currentDepths),
			...Object.keys(comparisonDepths),
		]);
		for (const key of allKeys) {
			const curr = currentDepths[key] ?? null;
			const prev = comparisonDepths[key] ?? null;
			if (curr === null && prev === null) continue;
			const delta = (curr ?? 0) - (prev ?? 0);
			if (delta !== 0) {
				const [toothStr, site] = key.split('_');
				result.push({ tooth: parseInt(toothStr), site, prev, curr, delta });
			}
		}
		return result.sort((a, b) => a.tooth - b.tooth);
	});

	const summary = $derived.by(() => {
		const improved = deltas.filter((d) => d.delta < 0).length;
		const worsened = deltas.filter((d) => d.delta > 0).length;
		// Count unchanged recorded sites
		const allKeys = new Set([...Object.keys(currentDepths), ...Object.keys(comparisonDepths)]);
		const total = [...allKeys].filter((k) => {
			const c = currentDepths[k] ?? null;
			const p = comparisonDepths[k] ?? null;
			return c !== null || p !== null;
		}).length;
		const unchanged = total - improved - worsened;
		return { improved, worsened, unchanged };
	});

	// Group deltas by tooth
	const byTooth = $derived.by(() => {
		const map = new Map<number, SiteDelta[]>();
		for (const d of deltas) {
			if (!map.has(d.tooth)) map.set(d.tooth, []);
			map.get(d.tooth)!.push(d);
		}
		return map;
	});
</script>

<div class="border-t px-3 py-2 bg-muted/10 shrink-0">
	<!-- Summary strip -->
	<div class="flex items-center gap-4 text-[11px] mb-2">
		<span class="font-semibold text-muted-foreground">{i18n.t.perio.comparison.title}:</span>
		{#if deltas.length === 0}
			<span class="text-muted-foreground italic">{i18n.t.perio.comparison.noChanges}</span>
		{:else}
			<span class="text-emerald-600 dark:text-emerald-400 font-medium">
				↓ {summary.improved} {i18n.t.perio.comparison.improved}
			</span>
			<span class="text-red-600 dark:text-red-400 font-medium">
				↑ {summary.worsened} {i18n.t.perio.comparison.worsened}
			</span>
			<span class="text-muted-foreground">
				= {summary.unchanged} {i18n.t.perio.comparison.unchanged}
			</span>
		{/if}
	</div>

	<!-- Per-tooth delta table (only teeth with changes) -->
	{#if deltas.length > 0}
		<div class="flex flex-wrap gap-2 max-h-28 overflow-y-auto">
			{#each [...byTooth.entries()] as [tooth, sites]}
				<div class="rounded border border-border bg-background px-2 py-1 text-[10px] min-w-[80px]">
					<div class="font-semibold text-xs mb-1">FDI {toFDI(tooth)}</div>
					{#each sites as d}
						<div class="flex items-center gap-1.5">
							{#if d.delta < 0}
								<span class="text-emerald-600 dark:text-emerald-400 font-bold">↓</span>
							{:else}
								<span class="text-red-600 dark:text-red-400 font-bold">↑</span>
							{/if}
							<span class="text-muted-foreground">{d.site}:</span>
							<span>{d.prev ?? '—'}</span>
							<span class="text-muted-foreground">→</span>
							<span class="{d.delta < 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} font-medium">{d.curr ?? '—'}</span>
						</div>
					{/each}
				</div>
			{/each}
		</div>
	{/if}
</div>
