<script lang="ts">
	import { i18n } from '$lib/i18n';

	let {
		pocketDepths,
		bopSites,
	}: {
		pocketDepths: Record<string, number | null>;
		bopSites: Record<string, boolean>;
	} = $props();

	const stats = $derived.by(() => {
		const allValues = Object.values(pocketDepths).filter((v): v is number => v !== null && v > 0);
		const totalSites = 192; // 32 teeth × 6 sites
		const recorded = allValues.length;
		const meanPd = recorded > 0 ? (allValues.reduce((a, b) => a + b, 0) / recorded) : null;
		const pd4plus = allValues.filter((v) => v >= 4).length;
		const pd6plus = allValues.filter((v) => v >= 6).length;
		const bopPositive = Object.values(bopSites).filter(Boolean).length;
		const bopPct = recorded > 0 ? Math.round((bopPositive / recorded) * 100) : 0;
		const teethCharted = new Set(
			Object.entries(pocketDepths)
				.filter(([, v]) => v !== null && v > 0)
				.map(([k]) => k.split('_')[0])
		).size;

		return {
			recorded,
			totalSites,
			meanPd,
			pd4plus,
			pd4pct: recorded > 0 ? Math.round((pd4plus / recorded) * 100) : 0,
			pd6plus,
			pd6pct: recorded > 0 ? Math.round((pd6plus / recorded) * 100) : 0,
			bopPct,
			teethCharted,
		};
	});

	function bopColorClass(pct: number): string {
		if (pct > 50) return 'text-red-600 dark:text-red-400';
		if (pct > 30) return 'text-amber-600 dark:text-amber-400';
		return 'text-emerald-600 dark:text-emerald-400';
	}

	function pd6ColorClass(pct: number): string {
		if (pct > 20) return 'text-red-600 dark:text-red-400';
		if (pct > 10) return 'text-amber-600 dark:text-amber-400';
		return 'text-muted-foreground';
	}
</script>

<div class="flex items-center gap-0 text-[10px] border-t bg-muted/20 divide-x divide-border shrink-0">
	<div class="px-3 py-1.5 flex items-center gap-1">
		<span class="text-muted-foreground">{i18n.t.perio.summary.sites}:</span>
		<span class="font-medium">{stats.recorded}/{stats.totalSites}</span>
	</div>
	<div class="px-3 py-1.5 flex items-center gap-1">
		<span class="text-muted-foreground">{i18n.t.perio.summary.meanPd}:</span>
		<span class="font-medium">
			{stats.meanPd !== null ? stats.meanPd.toFixed(1) + 'mm' : '—'}
		</span>
	</div>
	<div class="px-3 py-1.5 flex items-center gap-1">
		<span class="text-muted-foreground">{i18n.t.perio.summary.pd4plus}:</span>
		<span class="font-medium">{stats.pd4plus} ({stats.pd4pct}%)</span>
	</div>
	<div class="px-3 py-1.5 flex items-center gap-1">
		<span class="text-muted-foreground">{i18n.t.perio.summary.pd6plus}:</span>
		<span class="font-medium {pd6ColorClass(stats.pd6pct)}">{stats.pd6plus} ({stats.pd6pct}%)</span>
	</div>
	<div class="px-3 py-1.5 flex items-center gap-1">
		<span class="text-muted-foreground">{i18n.t.perio.summary.bopPct}:</span>
		<span class="font-medium {bopColorClass(stats.bopPct)}">{stats.bopPct}%</span>
	</div>
	<div class="px-3 py-1.5 flex items-center gap-1">
		<span class="text-muted-foreground">{i18n.t.perio.summary.teeth}:</span>
		<span class="font-medium">{stats.teethCharted}</span>
	</div>
</div>
