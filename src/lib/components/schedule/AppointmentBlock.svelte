<script lang="ts">
	import type { Appointment } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { appointmentStatuses } from '$lib/stores/appointmentStatuses.svelte';

	interface Props {
		appointment: Appointment;
		slotHeight?: number;
		minutesPerSlot?: number;
		isSelected?: boolean;
		ondblclick?: () => void;
		onstatuschange?: (id: string, status: string) => void;
	}

	let { appointment, slotHeight = 8, minutesPerSlot = 5, isSelected = false, ondblclick, onstatuschange }: Props = $props();

	const isCompact = $derived(slotHeight * (appointment.duration_min / minutesPerSlot) < 40);
	const showNotes = $derived(slotHeight * (appointment.duration_min / minutesPerSlot) >= 56);
	const typeColor = $derived(appointment.type_color ?? '#6366f1');

	function hexToRgba(hex: string, alpha: number): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	}

	// ── Status config from store ────────────────────────────────────────
	const statusCfg = $derived(appointmentStatuses.map[appointment.status]);

	// Completed and cancelled get a grayscale overlay regardless of configured color
	const isTerminal = $derived(
		appointment.status === 'completed' || appointment.status === 'cancelled',
	);
	const isScheduled = $derived(appointment.status === 'scheduled');

	const statusBorderColor = $derived(() => {
		if (isScheduled) return typeColor;
		return statusCfg?.color ?? '#64748b';
	});

	const statusBgColor = $derived(() => {
		if (isScheduled) return hexToRgba(typeColor, 0.12);
		if (isTerminal)  return hexToRgba(statusCfg?.color ?? '#64748b', 0.06);
		return hexToRgba(statusCfg?.color ?? '#64748b', 0.13);
	});

	const statusFilter = $derived(() => {
		if (appointment.status === 'completed') return 'filter: grayscale(0.85); opacity: 0.65;';
		if (appointment.status === 'cancelled') return 'filter: grayscale(1); opacity: 0.32;';
		return '';
	});

	const patientName = $derived(
		appointment.patient_firstname && appointment.patient_lastname
			? `${appointment.patient_lastname}, ${appointment.patient_firstname}`
			: appointment.patient_id,
	);

	const timeRange = $derived(() => {
		const start = appointment.start_time.slice(11, 16);
		const end   = appointment.end_time.slice(11, 16);
		return `${start}–${end}`;
	});

	// ── Portal action ───────────────────────────────────────────────────
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy() { node.remove(); } };
	}

	function getZoom(): number {
		if (typeof document === 'undefined') return 1;
		return parseFloat(document.documentElement.style.zoom) || 1;
	}

	// ── Hover tooltip ───────────────────────────────────────────────────
	let tooltipVisible = $state(false);
	let tooltipX = $state(0);
	let tooltipY = $state(0);
	let hoverTimer: ReturnType<typeof setTimeout> | null = null;

	function onMouseEnter(e: MouseEvent) {
		if (contextMenuVisible) return;
		const z = getZoom();
		tooltipX = e.clientX / z;
		tooltipY = e.clientY / z;
		hoverTimer = setTimeout(() => { tooltipVisible = true; }, 420);
	}
	function onMouseMove(e: MouseEvent) {
		const z = getZoom();
		tooltipX = e.clientX / z;
		tooltipY = e.clientY / z;
	}
	function onMouseLeave() {
		if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
		tooltipVisible = false;
	}

	const tipLeft = $derived(() => {
		if (typeof window === 'undefined') return tooltipX + 14;
		const viewW = window.innerWidth / getZoom();
		return tooltipX + 14 + 260 > viewW ? tooltipX - 270 : tooltipX + 14;
	});
	const tipTop = $derived(() => {
		if (typeof window === 'undefined') return tooltipY + 8;
		const viewH = window.innerHeight / getZoom();
		return tooltipY + 8 + 240 > viewH ? tooltipY - 248 : tooltipY + 8;
	});

	// ── Right-click context menu ────────────────────────────────────────
	let contextMenuVisible = $state(false);
	let cmX = $state(0);
	let cmY = $state(0);

	function onContextMenu(e: MouseEvent) {
		if (!onstatuschange) return;
		e.preventDefault();
		e.stopPropagation();
		if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
		tooltipVisible = false;
		const z = getZoom();
		const menuH = appointmentStatuses.list.length * 36 + 48;
		const menuW = 200;
		const viewW = window.innerWidth / z;
		const viewH = window.innerHeight / z;
		const rawX = e.clientX / z;
		const rawY = e.clientY / z;
		cmX = rawX + menuW > viewW ? rawX - menuW : rawX;
		cmY = rawY + menuH > viewH ? rawY - menuH : rawY;
		contextMenuVisible = true;
	}

	function setStatus(key: string) {
		contextMenuVisible = false;
		onstatuschange?.(appointment.id, key);
	}
</script>

<!-- Root wrapper -->
<div
	class="relative w-full h-full"
	onmouseenter={onMouseEnter}
	onmousemove={onMouseMove}
	onmouseleave={onMouseLeave}
	ondblclick={ondblclick}
	oncontextmenu={onContextMenu}
	role="button"
	tabindex="0"
>
	<!-- Top resize handle -->
	<div
		class="absolute top-0 inset-x-0 h-2 z-10 cursor-ns-resize flex items-center justify-center group/rh pointer-events-auto"
		data-appt-handle="top"
	>
		<div class="w-8 h-0.5 rounded-full bg-transparent group-hover/rh:bg-white/70 transition-colors pointer-events-none mt-0.5"></div>
	</div>

	<!-- Main content — receives the grayscale filter for terminal statuses -->
	<div
		class="absolute inset-0 rounded text-left overflow-hidden px-1.5 py-1 select-none transition-all duration-150"
		style="
			border-left: 3px solid {statusBorderColor()};
			background-color: {statusBgColor()};
			cursor: grab;
			{statusFilter()}
		"
	>
		{#if isCompact}
			<div class="flex items-center gap-1 text-xs leading-tight truncate pr-5">
				{#if appointment.type_icon}
					<span class="shrink-0 text-[11px] leading-none">{appointment.type_icon}</span>
				{:else}
					<span class="w-2 h-2 rounded-full shrink-0" style="background-color: {typeColor}"></span>
				{/if}
				<span class="font-medium truncate {appointment.status === 'cancelled' ? 'line-through text-muted-foreground' : ''}">{patientName}</span>
			</div>
		{:else}
			<div class="flex flex-col gap-0.5 text-xs leading-tight pt-0.5 pr-5">
				<span class="font-semibold truncate {appointment.status === 'cancelled' ? 'line-through text-muted-foreground' : ''}">{patientName}</span>
				<div class="flex items-center gap-1">
					{#if appointment.type_icon}
						<span class="text-[11px] leading-none shrink-0">{appointment.type_icon}</span>
					{:else}
						<span class="w-2 h-2 rounded-full shrink-0" style="background-color: {typeColor}; opacity: 0.75;"></span>
					{/if}
					{#if appointment.type_name}
						<span class="truncate text-muted-foreground">{appointment.type_short_name ?? appointment.type_name}</span>
					{/if}
				</div>
				<span class="text-muted-foreground">{timeRange()}</span>
				{#if showNotes && appointment.notes}
					<span class="text-muted-foreground/70 italic truncate text-[10px] mt-0.5">{appointment.notes}</span>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Status badge — sibling of filtered div so colours are never desaturated -->
	{#if statusCfg?.kuerzel}
		<div class="absolute top-1 right-1 z-20 pointer-events-none">
			<span
				class="inline-flex items-center justify-center px-1 py-0.5 rounded text-[9px] font-bold leading-none"
				style="
					background-color: {hexToRgba(statusCfg.color, 0.28)};
					color: {statusCfg.color};
					border: 1px solid {hexToRgba(statusCfg.color, 0.45)};
					min-width: 1.25rem;
				"
			>
				{#if statusCfg.key === 'in_chair'}
					<span class="w-1.5 h-1.5 rounded-full mr-0.5 animate-pulse shrink-0" style="background-color: {statusCfg.color}"></span>
				{/if}
				{statusCfg.kuerzel}
			</span>
		</div>
	{/if}

	<!-- Bottom resize handle -->
	<div
		class="absolute bottom-0 inset-x-0 h-2 z-10 cursor-ns-resize flex items-center justify-center group/rh pointer-events-auto"
		data-appt-handle="bottom"
	>
		<div class="w-8 h-0.5 rounded-full bg-transparent group-hover/rh:bg-white/70 transition-colors pointer-events-none mb-0.5"></div>
	</div>

	<!-- Selected ring -->
	{#if isSelected}
		<div
			class="absolute inset-0 rounded pointer-events-none"
			style="box-shadow: 0 0 0 2px {statusBorderColor()}, 0 0 0 4px rgba(255,255,255,0.4); z-index: 6;"
		></div>
	{/if}
</div>

<!-- Context menu — portal'd -->
{#if contextMenuVisible}
	<div
		use:portal
		class="fixed inset-0 z-[9998]"
		role="none"
		onmousedown={() => (contextMenuVisible = false)}
	></div>
	<div
		use:portal
		class="fixed z-[9999] rounded-xl overflow-hidden shadow-xl border border-border"
		style="left: {cmX}px; top: {cmY}px; background: var(--popover); min-width: 200px;"
		role="menu"
	>
		<div class="px-3 py-2 border-b border-border/60">
			<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{i18n.t.schedule.status}</p>
		</div>
		<div class="py-1">
			{#each appointmentStatuses.list as cfg}
				{@const isCurrent = appointment.status === cfg.key}
				<button
					type="button"
					role="menuitem"
					class="flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-muted/70
						{isCurrent ? 'bg-muted/50 font-semibold' : 'font-normal'}"
					onclick={() => setStatus(cfg.key)}
				>
					<span
						class="w-2.5 h-2.5 rounded-full shrink-0"
						style="background-color: {cfg.color}"
					></span>
					<span class="flex-1 text-left">{cfg.label}</span>
					{#if cfg.kuerzel}
						<span
							class="text-[9px] font-bold px-1 py-0.5 rounded leading-none"
							style="background-color: {hexToRgba(cfg.color, 0.2)}; color: {cfg.color}; border: 1px solid {hexToRgba(cfg.color, 0.35)}"
						>{cfg.kuerzel}</span>
					{/if}
					{#if isCurrent}
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5 shrink-0 text-muted-foreground"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
				</button>
			{/each}
		</div>
	</div>
{/if}

<!-- Rich hover tooltip — portal'd -->
{#if tooltipVisible && !contextMenuVisible}
	<div
		use:portal
		class="fixed z-[9999] w-64 rounded-xl pointer-events-none"
		style="left: {tipLeft()}px; top: {tipTop()}px; background-color: var(--popover); border: 1.5px solid {statusBorderColor()}; box-shadow: 0 8px 24px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.14);"
	>
		<div
			class="rounded-t-xl px-3 py-2 flex items-center justify-between gap-2"
			style="background-color: {statusBorderColor()}; border-bottom: 1px solid {statusBorderColor()};"
		>
			<span class="text-xs font-bold truncate text-white">{patientName}</span>
			<span class="text-[10px] font-semibold shrink-0 px-1.5 py-0.5 rounded bg-black/20 text-white">{timeRange()}</span>
		</div>

		<div class="px-3 py-2.5 flex flex-col gap-1.5 text-xs">
			{#if appointment.type_name}
				<div class="flex items-start gap-2">
					<span class="text-muted-foreground w-16 shrink-0">{i18n.t.schedule.type}</span>
					<span class="font-medium flex items-center gap-1">
						{#if appointment.type_icon}<span>{appointment.type_icon}</span>{/if}
						{appointment.type_name}
					</span>
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
				<span class="flex items-center gap-1.5">
					{#if statusCfg}
						<span class="w-2 h-2 rounded-full shrink-0" style="background-color: {statusCfg.color}"></span>
						<span>{statusCfg.label}</span>
					{:else}
						<span>{appointment.status}</span>
					{/if}
				</span>
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
