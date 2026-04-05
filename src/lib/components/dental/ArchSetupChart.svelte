<script lang="ts">
	import { i18n } from '$lib/i18n';
	import { toFDI, UPPER_PRIMARY, LOWER_PRIMARY, getTeethForDentition } from '$lib/utils';
	import { Button } from '$lib/components/ui/button';

	let {
		presentTeeth = $bindable<Set<number>>(),
		onConfirm,
		onCancel,
	}: {
		presentTeeth: Set<number>;
		onConfirm:    () => void;
		onCancel:     () => void;
	} = $props();

	// Upper permanent: Universal 1–16 (FDI 18→28, left-to-right)
	const UPPER_PERM: number[] = Array.from({ length: 16 }, (_, i) => i + 1);
	// Lower permanent: Universal 32→17 (FDI 48→38, left-to-right)
	const LOWER_PERM: number[] = Array.from({ length: 16 }, (_, i) => 32 - i);

	const ALL_MIXED = getTeethForDentition('mixed');
	const presentCount = $derived(ALL_MIXED.filter(t => presentTeeth.has(t)).length);

	function toggle(n: number) {
		const next = new Set(presentTeeth);
		if (next.has(n)) next.delete(n);
		else next.add(n);
		presentTeeth = next;
	}

	function selectAll()   { presentTeeth = new Set(ALL_MIXED); }
	function deselectAll() { presentTeeth = new Set(); }

	function cls(n: number): string {
		const base = 'flex items-center justify-center rounded text-[9px] font-mono font-semibold select-none transition-all border h-6 w-full cursor-pointer';
		return presentTeeth.has(n)
			? `${base} bg-teal-100 border-teal-400 text-teal-800 hover:bg-teal-200`
			: `${base} bg-muted/30 border-dashed border-border/40 text-muted-foreground/30 hover:bg-muted/60 hover:border-border/70 line-through`;
	}
</script>

<div class="flex flex-col gap-2">
	<p class="text-xs text-muted-foreground">{i18n.t.chart.archSetup.instruction}</p>

	<!-- Tooth grid -->
	<div class="flex flex-col gap-0.5">
		<!-- Upper permanent -->
		<div class="flex gap-0.5">
			{#each UPPER_PERM as n}<button class={cls(n)} onclick={() => toggle(n)}>{toFDI(n)}</button>{/each}
		</div>
		<!-- Upper primary -->
		<div class="flex gap-0.5">
			{#each UPPER_PRIMARY as fdi}
				{#if fdi !== null}
					<button class={cls(fdi)} onclick={() => toggle(fdi)}>{fdi}</button>
				{:else}
					<div class="flex-1"></div>
				{/if}
			{/each}
		</div>
		<!-- Occlusal divider -->
		<div class="my-0.5 h-px bg-border/50"></div>
		<!-- Lower primary -->
		<div class="flex gap-0.5">
			{#each LOWER_PRIMARY as fdi}
				{#if fdi !== null}
					<button class={cls(fdi)} onclick={() => toggle(fdi)}>{fdi}</button>
				{:else}
					<div class="flex-1"></div>
				{/if}
			{/each}
		</div>
		<!-- Lower permanent -->
		<div class="flex gap-0.5">
			{#each LOWER_PERM as n}<button class={cls(n)} onclick={() => toggle(n)}>{toFDI(n)}</button>{/each}
		</div>
	</div>

	<!-- Footer -->
	<div class="flex items-center justify-between pt-0.5">
		<div class="flex items-center gap-3">
			<button onclick={selectAll}   class="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors">{i18n.t.chart.archSetup.selectAll}</button>
			<button onclick={deselectAll} class="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors">{i18n.t.chart.archSetup.deselectAll}</button>
		</div>
		<div class="flex items-center gap-2">
			<span class="text-xs text-muted-foreground">
				<span class="font-semibold text-foreground">{presentCount}</span>/{ALL_MIXED.length} {i18n.t.chart.archSetup.teethPresent}
			</span>
			<Button size="sm" variant="outline" onclick={onCancel}>{i18n.t.actions.cancel}</Button>
			<Button size="sm" onclick={onConfirm}>{i18n.t.chart.archSetup.confirm}</Button>
		</div>
	</div>
</div>
