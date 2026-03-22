<script lang="ts">
	import type { Appointment } from '$lib/types';
	import { i18n } from '$lib/i18n';

	interface Props {
		appointment: Appointment;
		slotHeight?: number;
		minutesPerSlot?: number;
		onclick?: () => void;
	}

	let { appointment, slotHeight = 8, minutesPerSlot = 5, onclick }: Props = $props();

	const isCompact = $derived(slotHeight * (appointment.duration_min / minutesPerSlot) < 40);
	const showNotes = $derived(slotHeight * (appointment.duration_min / minutesPerSlot) >= 56);
	const color = $derived(appointment.type_color ?? '#6366f1');

	function hexToRgb(hex: string) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `${r}, ${g}, ${b}`;
	}

	const patientName = $derived(
		appointment.patient_firstname && appointment.patient_lastname
			? `${appointment.patient_lastname}, ${appointment.patient_firstname}`
			: appointment.patient_id,
	);

	const timeRange = $derived(() => {
		const start = appointment.start_time.slice(11, 16);
		const end = appointment.end_time.slice(11, 16);
		return `${start}–${end}`;
	});

	const statusLabel = $derived(() => {
		const s = appointment.status;
		if (s === 'completed') return i18n.t.schedule.statuses.completed;
		if (s === 'cancelled') return i18n.t.schedule.statuses.cancelled;
		if (s === 'no_show') return i18n.t.schedule.statuses.no_show;
		return i18n.t.schedule.statuses.scheduled;
	});

	// ── Hover tooltip ───────────────────────────────────────────────────
	let tooltipVisible = $state(false);
	let tooltipX = $state(0);
	let tooltipY = $state(0);
	let hoverTimer: ReturnType<typeof setTimeout> | null = null;

	function onMouseEnter(e: MouseEvent) {
		tooltipX = e.clientX;
		tooltipY = e.clientY;
		hoverTimer = setTimeout(() => { tooltipVisible = true; }, 420);
	}
	function onMouseMove(e: MouseEvent) {
		tooltipX = e.clientX;
		tooltipY = e.clientY;
	}
	function onMouseLeave() {
		if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
		tooltipVisible = false;
	}

	// Smart positioning: flip left if near right edge, flip up if near bottom
	const tipLeft = $derived(() => {
		if (typeof window === 'undefined') return tooltipX + 14;
		return tooltipX + 14 + 260 > window.innerWidth
			? tooltipX - 270
			: tooltipX + 14;
	});
	const tipTop = $derived(() => {
		if (typeof window === 'undefined') return tooltipY + 8;
		return tooltipY + 8 + 220 > window.innerHeight
			? tooltipY - 228
			: tooltipY + 8;
	});
</script>

<button
	class="appointment-block w-full h-full rounded text-left overflow-hidden px-1.5 py-0.5 transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-1"
	style="
		border-left: 3px solid {color};
		background-color: rgba({hexToRgb(color)}, 0.12);
		{appointment.status === 'completed' ? 'opacity: 0.6;' : ''}
		{appointment.status === 'cancelled' ? 'opacity: 0.4; filter: grayscale(0.6);' : ''}
	"
	{onclick}
	onmouseenter={onMouseEnter}
	onmousemove={onMouseMove}
	onmouseleave={onMouseLeave}
>
	{#if isCompact}
		<div class="flex items-center gap-1 text-xs leading-tight truncate">
			<span class="font-medium truncate">{patientName}</span>
			{#if appointment.type_short_name}
				<span class="text-muted-foreground shrink-0">{appointment.type_short_name}</span>
			{/if}
		</div>
	{:else}
		<div class="flex flex-col gap-0.5 text-xs leading-tight">
			<span class="font-semibold truncate
				{appointment.status === 'cancelled' ? 'line-through text-muted-foreground' : ''}
			">{patientName}</span>
			<div class="flex items-center gap-1 text-muted-foreground">
				{#if appointment.type_name}
					<span class="truncate">{appointment.type_name}</span>
				{/if}
				{#if appointment.status === 'completed'}
					<span class="text-green-600">✓</span>
				{:else if appointment.status === 'no_show'}
					<span class="text-red-500">✗</span>
				{/if}
			</div>
			<span class="text-muted-foreground">{timeRange()}</span>
			{#if showNotes && appointment.notes}
				<span class="text-muted-foreground/70 italic truncate text-[10px] mt-0.5">{appointment.notes}</span>
			{/if}
		</div>
	{/if}
</button>

<!-- Rich hover card (fixed, escapes overflow:auto containers) -->
{#if tooltipVisible}
	<div
		class="fixed z-[9999] w-64 rounded-xl border border-border bg-popover shadow-xl pointer-events-none"
		style="left: {tipLeft()}px; top: {tipTop()}px;"
	>
		<!-- Header strip -->
		<div
			class="rounded-t-xl px-3 py-2 flex items-center justify-between gap-2"
			style="background-color: rgba({hexToRgb(color)}, 0.15); border-bottom: 2px solid {color};"
		>
			<span class="text-xs font-bold truncate">{patientName}</span>
			<span class="text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded"
				style="background-color: rgba({hexToRgb(color)}, 0.25); color: {color};"
			>{timeRange()}</span>
		</div>

		<!-- Body -->
		<div class="px-3 py-2.5 flex flex-col gap-1.5 text-xs">
			{#if appointment.type_name}
				<div class="flex items-start gap-2">
					<span class="text-muted-foreground w-16 shrink-0">{i18n.t.schedule.type}</span>
					<span class="font-medium">{appointment.type_name}</span>
				</div>
			{/if}

			<div class="flex items-start gap-2">
				<span class="text-muted-foreground w-16 shrink-0">{i18n.t.schedule.duration}</span>
				<span>{appointment.duration_min} {i18n.t.dashboard.appointments.minutes}</span>
			</div>

			{#if appointment.doctor_name}
				<div class="flex items-start gap-2">
					<span class="text-muted-foreground w-16 shrink-0">{i18n.t.schedule.doctor}</span>
					<span>{appointment.doctor_name}</span>
				</div>
			{/if}

			{#if appointment.room_name}
				<div class="flex items-start gap-2">
					<span class="text-muted-foreground w-16 shrink-0">{i18n.t.schedule.room}</span>
					<span>{appointment.room_name}</span>
				</div>
			{/if}

			{#if appointment.title}
				<div class="flex items-start gap-2">
					<span class="text-muted-foreground w-16 shrink-0">{i18n.t.schedule.titleLabel}</span>
					<span class="italic">{appointment.title}</span>
				</div>
			{/if}

			<div class="flex items-start gap-2">
				<span class="text-muted-foreground w-16 shrink-0">{i18n.t.schedule.status}</span>
				<span class="
					{appointment.status === 'completed' ? 'text-green-600' : ''}
					{appointment.status === 'cancelled' ? 'text-destructive' : ''}
					{appointment.status === 'no_show' ? 'text-orange-500' : ''}
				">{statusLabel()}</span>
			</div>

			{#if appointment.notes}
				<div class="mt-0.5 pt-1.5 border-t border-border/60">
					<p class="text-muted-foreground mb-0.5">{i18n.t.schedule.notes}</p>
					<p class="whitespace-pre-wrap leading-relaxed">{appointment.notes}</p>
				</div>
			{/if}
		</div>
	</div>
{/if}
