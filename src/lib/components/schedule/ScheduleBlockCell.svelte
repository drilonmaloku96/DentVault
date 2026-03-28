<script lang="ts">
	import type { ScheduleBlock } from '$lib/types';

	interface Props {
		block: ScheduleBlock;
		slotHeight?: number;
		minutesPerSlot?: number;
		isSelected?: boolean;
	}

	let { block, slotHeight = 8, minutesPerSlot = 5, isSelected = false }: Props = $props();

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

<div
	class="relative w-full h-full rounded overflow-hidden select-none"
	style="
		border-left: 3px solid {color};
		background: repeating-linear-gradient(
			-45deg,
			rgba({hexToRgb(color)}, 0.08),
			rgba({hexToRgb(color)}, 0.08) 4px,
			rgba({hexToRgb(color)}, 0.02) 4px,
			rgba({hexToRgb(color)}, 0.02) 8px
		);
		cursor: grab;
	"
>
	<!-- Top resize handle -->
	<div
		class="absolute top-0 inset-x-0 h-2 z-10 cursor-ns-resize flex items-center justify-center group/rh pointer-events-auto"
		data-block-handle="top"
	>
		<div class="w-8 h-0.5 rounded-full bg-transparent group-hover/rh:bg-white/70 transition-colors pointer-events-none mt-0.5"></div>
	</div>

	<!-- Content -->
	<div class="absolute inset-0 px-1.5 py-1 pt-2">
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
	</div>

	<!-- Bottom resize handle -->
	<div
		class="absolute bottom-0 inset-x-0 h-2 z-10 cursor-ns-resize flex items-center justify-center group/rh pointer-events-auto"
		data-block-handle="bottom"
	>
		<div class="w-8 h-0.5 rounded-full bg-transparent group-hover/rh:bg-white/70 transition-colors pointer-events-none mb-0.5"></div>
	</div>

	<!-- Selected ring -->
	{#if isSelected}
		<div
			class="absolute inset-0 rounded pointer-events-none"
			style="box-shadow: 0 0 0 2px {color}, 0 0 0 4px rgba(255,255,255,0.4); z-index: 6;"
		></div>
	{/if}
</div>
