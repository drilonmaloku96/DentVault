<script lang="ts">
	import type { ScheduleBlock } from '$lib/types';

	interface Props {
		block: ScheduleBlock;
		slotHeight?: number;
		minutesPerSlot?: number;
		onclick?: () => void;
	}

	let { block, slotHeight = 8, minutesPerSlot = 5, onclick }: Props = $props();

	function hexToRgb(hex: string) {
		if (!hex || !hex.startsWith('#') || hex.length < 7) return '148, 163, 184';
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `${r}, ${g}, ${b}`;
	}

	// Parse duration in minutes
	const startParts = $derived(block.start_time.slice(11, 16).split(':').map(Number));
	const endParts = $derived(block.end_time.slice(11, 16).split(':').map(Number));
	const durationMin = $derived(
		(endParts[0] * 60 + endParts[1]) - (startParts[0] * 60 + startParts[1])
	);
	const isCompact = $derived(slotHeight * (durationMin / minutesPerSlot) < 32);
	const color = $derived(block.color ?? '#94a3b8');
</script>

<button
	class="w-full h-full rounded text-left overflow-hidden px-1.5 py-0.5 transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-offset-1 cursor-pointer"
	style="
		border-left: 3px solid {color};
		background: repeating-linear-gradient(
			-45deg,
			rgba({hexToRgb(color)}, 0.08),
			rgba({hexToRgb(color)}, 0.08) 4px,
			rgba({hexToRgb(color)}, 0.02) 4px,
			rgba({hexToRgb(color)}, 0.02) 8px
		);
	"
	{onclick}
>
	{#if !isCompact}
		<div class="flex flex-col gap-0.5 text-xs leading-tight">
			<span class="font-medium truncate" style="color: {color};">{block.title}</span>
			{#if block.doctor_name}
				<span class="text-muted-foreground truncate text-[10px]">{block.doctor_name}</span>
			{/if}
		</div>
	{:else}
		<span class="text-[10px] font-medium truncate" style="color: {color};">{block.title}</span>
	{/if}
</button>
