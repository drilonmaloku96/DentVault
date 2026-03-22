<script lang="ts">
	import type { StaffBlockout, BlockoutReason } from '$lib/types';
	import { i18n } from '$lib/i18n';

	interface Props {
		blockouts: StaffBlockout[];
	}

	let { blockouts }: Props = $props();

	function reasonLabel(r: BlockoutReason): string {
		return i18n.t.schedule.staffBlockouts.reasons[r];
	}
</script>

{#if blockouts.length > 0}
	<div class="px-6 py-1.5 border-b border-border flex items-center gap-2 flex-wrap shrink-0 bg-amber-50/30 dark:bg-amber-950/10">
		<span class="text-[10px] font-medium text-muted-foreground uppercase tracking-wide shrink-0">{i18n.t.schedule.staffBlockouts.absent}:</span>
		{#each blockouts as b}
			<span
				class="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border"
				style="background-color: {b.color}22; border-color: {b.color}55; color: {b.doctor_color ?? b.color};"
			>
				<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: {b.doctor_color ?? b.color};"></span>
				{b.doctor_name} — {reasonLabel(b.reason)}
			</span>
		{/each}
	</div>
{/if}
