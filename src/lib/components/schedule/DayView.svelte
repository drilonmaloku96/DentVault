<script lang="ts">
	import type { Appointment, AppointmentRoom, WorkingHoursEntry, ScheduleBlock } from '$lib/types';
	import AppointmentBlock from './AppointmentBlock.svelte';
	import ScheduleBlockCell from './ScheduleBlockCell.svelte';
	import { i18n } from '$lib/i18n';
	import { goto } from '$app/navigation';

	interface Props {
		date: string; // YYYY-MM-DD
		appointments: Appointment[];
		activeRooms: AppointmentRoom[];
		workingHoursForDay?: WorkingHoursEntry;
		scheduleBlocks?: ScheduleBlock[];
		onSlotClick?: (roomId: string, time: string) => void;
		onAppointmentClick?: (appointment: Appointment) => void;
		onDragCreate?: (selections: Array<{roomIds: string[]; startTime: string; endTime: string}>, anchorRect: DOMRect) => void;
		onBlockClick?: (block: ScheduleBlock) => void;
	}

	let {
		date,
		appointments,
		activeRooms,
		workingHoursForDay,
		scheduleBlocks = [],
		onSlotClick,
		onAppointmentClick,
		onDragCreate,
		onBlockClick,
	}: Props = $props();

	const SLOT_HEIGHT = 8; // px per 5-min slot
	const SLOTS_PER_HOUR = 12;
	const MINUTES_PER_SLOT = 5;
	const TOTAL_HOURS = 24;
	const TOTAL_SLOTS = TOTAL_HOURS * SLOTS_PER_HOUR;

	// Visible range
	const visibleStart = $derived(() => {
		if (!workingHoursForDay?.is_active) return 0;
		const [h] = workingHoursForDay.start_time.split(':').map(Number);
		return Math.max(0, (h - 1) * SLOTS_PER_HOUR);
	});

	const visibleEnd = $derived(() => {
		if (!workingHoursForDay?.is_active) return TOTAL_SLOTS;
		const [h, m] = workingHoursForDay.end_time.split(':').map(Number);
		return Math.min(TOTAL_SLOTS, (h + 1) * SLOTS_PER_HOUR + Math.ceil(m / MINUTES_PER_SLOT));
	});

	const visibleSlots = $derived(visibleEnd() - visibleStart());

	// Today's current time line
	const isToday = $derived(date === new Date().toISOString().slice(0, 10));
	let currentTimeSlot = $state(0);

	function updateCurrentTime() {
		const now = new Date();
		currentTimeSlot = (now.getHours() * 60 + now.getMinutes()) / MINUTES_PER_SLOT;
	}

	$effect(() => {
		if (isToday) {
			updateCurrentTime();
			const interval = setInterval(updateCurrentTime, 60000);
			return () => clearInterval(interval);
		}
	});

	// Compute appointment grid placement
	function getSlotFromTime(timeStr: string): number {
		const timePart = timeStr.length > 5 ? timeStr.slice(11, 16) : timeStr;
		const [h, m] = timePart.split(':').map(Number);
		return h * SLOTS_PER_HOUR + Math.floor(m / MINUTES_PER_SLOT);
	}

	function getRowStart(slot: number): number {
		return slot - visibleStart() + 2; // +2 for header row
	}

	function getRowSpan(startSlot: number, endSlot: number): number {
		return Math.max(1, endSlot - startSlot);
	}

	function getColumnIndex(roomId: string): number {
		return activeRooms.findIndex((r) => r.id === roomId) + 2; // +2 for time column
	}

	// Break band
	const breakStartSlot = $derived(() => {
		if (!workingHoursForDay?.break_start) return null;
		const [h, m] = workingHoursForDay.break_start.split(':').map(Number);
		return h * SLOTS_PER_HOUR + Math.floor(m / MINUTES_PER_SLOT);
	});

	const breakEndSlot = $derived(() => {
		if (!workingHoursForDay?.break_end) return null;
		const [h, m] = workingHoursForDay.break_end.split(':').map(Number);
		return h * SLOTS_PER_HOUR + Math.floor(m / MINUTES_PER_SLOT);
	});

	function slotToTime(slot: number): string {
		const h = Math.floor(slot / SLOTS_PER_HOUR);
		const m = (slot % SLOTS_PER_HOUR) * MINUTES_PER_SLOT;
		return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
	}

	function handleSlotClick(roomId: string, slot: number) {
		if (!isDragging) {
			onSlotClick?.(roomId, slotToTime(slot));
		}
	}

	// ── Color helpers ────────────────────────────────────────────────────
	function hexToRgba(hex: string, alpha: number): string {
		if (!hex || !hex.startsWith('#') || hex.length < 7) return `rgba(100,116,139,${alpha})`;
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r},${g},${b},${alpha})`;
	}

	// ── Drag-create ──────────────────────────────────────────────────────

	// Accumulated selections (committed on Shift+release, fired on no-Shift release or Shift keyup)
	interface PendingSelection { roomIds: string[]; startSlot: number; endSlot: number; }
	let pendingSelections = $state<PendingSelection[]>([]);
	let lastAnchorRect = $state<DOMRect>(new DOMRect());

	// Active drag
	let isDragging = $state(false);
	let dragRoomId = $state<string | null>(null);
	let dragStartSlot = $state<number | null>(null);
	let dragEndSlot = $state<number | null>(null);
	let dragStartRoomIdx = $state<number | null>(null);
	let dragEndRoomIdx = $state<number | null>(null);
	let dragShiftHeld = $state(false);
	let gridEl = $state<HTMLDivElement | null>(null);
	let lastPointerX = $state(0);
	let lastPointerY = $state(0);

	const dragMinSlot = $derived(
		dragStartSlot !== null && dragEndSlot !== null
			? Math.min(dragStartSlot, dragEndSlot)
			: null
	);
	const dragMaxSlot = $derived(
		dragStartSlot !== null && dragEndSlot !== null
			? Math.max(dragStartSlot, dragEndSlot) + 1
			: null
	);

	// Rooms covered by the current active drag
	const dragSelectedRoomIds = $derived((): string[] => {
		if (dragStartRoomIdx === null || dragEndRoomIdx === null) {
			return dragRoomId ? [dragRoomId] : [];
		}
		if (!dragShiftHeld) return dragRoomId ? [dragRoomId] : [];
		const lo = Math.min(dragStartRoomIdx, dragEndRoomIdx);
		const hi = Math.max(dragStartRoomIdx, dragEndRoomIdx);
		return activeRooms.slice(lo, hi + 1).map((r) => r.id);
	});

	function firePendingSelections(extraSlot?: PendingSelection) {
		const all = extraSlot ? [...pendingSelections, extraSlot] : [...pendingSelections];
		if (!all.length || !onDragCreate) return;
		const selections = all.map((s) => ({
			roomIds: s.roomIds,
			startTime: slotToTime(s.startSlot),
			endTime: slotToTime(s.endSlot),
		}));
		onDragCreate(selections, lastAnchorRect);
		pendingSelections = [];
	}

	function onGridPointerDown(e: PointerEvent) {
		const target = e.target as HTMLElement;
		const cell = target.closest('[data-slot]') as HTMLElement | null;
		if (!cell) return;
		const slot = parseInt(cell.dataset.slot ?? '');
		const roomId = cell.dataset.room ?? '';
		if (isNaN(slot) || !roomId) return;
		e.preventDefault();

		// Starting a drag WITHOUT Shift while there are pending selections → fire them immediately
		if (!e.shiftKey && pendingSelections.length > 0) {
			firePendingSelections();
		}

		const rIdx = activeRooms.findIndex((r) => r.id === roomId);
		isDragging = true;
		dragShiftHeld = e.shiftKey;
		dragRoomId = roomId;
		dragStartSlot = slot;
		dragEndSlot = slot;
		dragStartRoomIdx = rIdx;
		dragEndRoomIdx = rIdx;
		lastAnchorRect = gridEl?.getBoundingClientRect() ?? new DOMRect(e.clientX, e.clientY, 0, 0);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onGridPointerMove(e: PointerEvent) {
		lastPointerX = e.clientX;
		lastPointerY = e.clientY;
		if (!isDragging || !gridEl) return;
		const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
		const cell = el?.closest('[data-slot]') as HTMLElement | null;
		if (!cell) return;
		const slot = parseInt(cell.dataset.slot ?? '');
		const roomId = cell.dataset.room ?? '';
		if (isNaN(slot)) return;
		dragEndSlot = slot;
		if (dragShiftHeld) {
			const rIdx = activeRooms.findIndex((r) => r.id === roomId);
			if (rIdx >= 0) dragEndRoomIdx = rIdx;
		} else {
			if (roomId !== dragRoomId) return;
		}
	}

	function onGridPointerUp(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		lastPointerX = e.clientX;
		lastPointerY = e.clientY;
		lastAnchorRect = new DOMRect(e.clientX, e.clientY, 0, 0);

		const roomIds = dragSelectedRoomIds();
		const hasSelection = roomIds.length > 0 && dragMinSlot !== null && dragMaxSlot !== null;

		if (hasSelection && e.shiftKey) {
			// Shift still held → accumulate, don't open popover yet
			pendingSelections = [
				...pendingSelections,
				{ roomIds, startSlot: dragMinSlot!, endSlot: dragMaxSlot! },
			];
		} else if (hasSelection) {
			// No Shift on release → fire all pending + this one
			firePendingSelections({ roomIds, startSlot: dragMinSlot!, endSlot: dragMaxSlot! });
		}

		dragRoomId = null;
		dragStartSlot = null;
		dragEndSlot = null;
		dragStartRoomIdx = null;
		dragEndRoomIdx = null;
		dragShiftHeld = false;
	}

	// Shift key released while not dragging → fire pending selections
	// Escape → cancel pending
	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape' && pendingSelections.length > 0 && !isDragging) {
			pendingSelections = [];
		}
	}
	function onKeyUp(e: KeyboardEvent) {
		if (e.key === 'Shift' && pendingSelections.length > 0 && !isDragging) {
			firePendingSelections();
		}
	}

	$effect(() => {
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('keyup', onKeyUp);
		return () => {
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('keyup', onKeyUp);
		};
	});
</script>

{#if activeRooms.length === 0}
	<div class="flex flex-col items-center justify-center h-64 text-muted-foreground gap-3">
		<p>{i18n.t.schedule.noRoomsConfigured}</p>
		<button
			class="text-primary underline text-sm"
			onclick={() => goto('/settings')}
		>
			{i18n.t.schedule.goToSettings}
		</button>
	</div>
{:else}
	<div class="relative overflow-auto flex-1">
		<div
			bind:this={gridEl}
			class="day-grid min-w-0 relative"
			style="
				display: grid;
				grid-template-columns: 56px repeat({activeRooms.length}, 200px);
				grid-template-rows: 32px repeat({visibleSlots}, {SLOT_HEIGHT}px);
			"
			onpointerdown={onGridPointerDown}
			onpointermove={onGridPointerMove}
			onpointerup={onGridPointerUp}
			role="grid"
		>
			<!-- Top-left corner -->
			<div class="sticky top-0 z-20 bg-background border-b border-r border-border"></div>

			<!-- Room headers -->
			{#each activeRooms as room, i}
				<div
					class="sticky top-0 z-20 border-b border-border flex items-center justify-center gap-1.5 text-xs font-medium px-2"
					style="grid-column: {i + 2}; grid-row: 1; background-color: {hexToRgba(room.color, 0.15)};"
				>
					<span class="w-2 h-2 rounded-full shrink-0" style="background-color: {room.color}"></span>
					<span class="truncate">{room.name}</span>
				</div>
			{/each}

			<!-- Time labels + slot cells -->
			{#each Array.from({ length: visibleSlots }, (_, i) => visibleStart() + i) as slot}
				{@const isHourMark = slot % SLOTS_PER_HOUR === 0}
				{@const is15MinMark = slot % 3 === 0}
				{@const row = slot - visibleStart() + 2}
				{@const isBreak = breakStartSlot() !== null && slot >= (breakStartSlot() ?? 0) && slot < (breakEndSlot() ?? 0)}

				<!-- Time label -->
				<div
					class="border-r border-border flex items-start justify-end pr-1.5 pt-0.5"
					style="grid-column: 1; grid-row: {row}; border-top: {isHourMark ? '1px solid hsl(var(--border))' : is15MinMark ? '1px solid hsl(var(--border) / 0.5)' : '1px solid hsl(var(--border) / 0.15)'};"
				>
					{#if isHourMark}
						<span class="text-[10px] text-muted-foreground leading-none">{slotToTime(slot)}</span>
					{/if}
				</div>

				<!-- Slot cells per room -->
				{#each activeRooms as room, ri}
					<div
						class="relative border-border cursor-pointer"
						data-slot={slot}
						data-room={room.id}
						style="
							grid-column: {ri + 2};
							grid-row: {row};
							border-top: {isHourMark ? '1px solid hsl(var(--border))' : is15MinMark ? '1px solid hsl(var(--border) / 0.5)' : '1px solid hsl(var(--border) / 0.15)'};
							background-color: {isBreak
								? hexToRgba(room.color, 0.12)
								: hexToRgba(room.color, 0.06)};
						"
						role="gridcell"
						tabindex="0"
						onmouseenter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'inset 0 0 0 1px hsl(var(--ring) / 0.5)'; }}
						onmouseleave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
						onclick={() => handleSlotClick(room.id, slot)}
						onkeydown={(e) => e.key === 'Enter' && handleSlotClick(room.id, slot)}
					></div>
				{/each}
			{/each}

			<!-- Committed (pending) selections — amber tint, shown while Shift is held -->
			{#each pendingSelections as sel}
				{@const rowStart = getRowStart(sel.startSlot)}
				{@const rowSpan = Math.max(1, sel.endSlot - sel.startSlot)}
				{#each sel.roomIds as rId}
					{@const col = getColumnIndex(rId)}
					{#if col >= 2}
						<div
							class="pointer-events-none z-20 rounded border-2 border-amber-400/60"
							style="
								grid-column: {col};
								grid-row: {rowStart} / span {rowSpan};
								background-color: hsl(38 92% 50% / 0.18);
							"
						></div>
					{/if}
				{/each}
			{/each}

			<!-- Active drag overlay (blue) -->
			{#if isDragging && dragMinSlot !== null && dragMaxSlot !== null}
				{@const rowStart = getRowStart(dragMinSlot)}
				{@const rowSpan = Math.max(1, dragMaxSlot - dragMinSlot)}
				{#each dragSelectedRoomIds() as rId}
					{@const col = getColumnIndex(rId)}
					{#if col >= 2}
						<div
							class="pointer-events-none z-20 rounded border-2 border-primary/40"
							style="
								grid-column: {col};
								grid-row: {rowStart} / span {rowSpan};
								background-color: hsl(var(--primary) / 0.12);
							"
						></div>
					{/if}
				{/each}
			{/if}

			<!-- Current time line (absolute overlay) -->
			{#if isToday && currentTimeSlot >= visibleStart() && currentTimeSlot <= visibleEnd()}
				{@const lineTop = 32 + (currentTimeSlot - visibleStart()) * SLOT_HEIGHT}
				<div
					class="pointer-events-none absolute left-0 right-0 z-10 flex items-center"
					style="top: {lineTop}px; height: 2px;"
				>
					<div class="w-14 shrink-0"></div>
					<div class="flex-1 h-0.5 bg-red-500 relative">
						<div class="absolute -left-1 -top-1.5 w-3 h-3 rounded-full bg-red-500"></div>
					</div>
				</div>
			{/if}

			<!-- Schedule blocks (non-patient time) -->
			{#each scheduleBlocks as block}
				{@const startSlot = getSlotFromTime(block.start_time)}
				{@const endSlot = getSlotFromTime(block.end_time)}
				{@const col = getColumnIndex(block.room_id)}
				{#if col >= 2 && startSlot >= visibleStart() && startSlot < visibleEnd()}
					<div
						class="z-9 p-0.5"
						style="
							grid-column: {col};
							grid-row: {getRowStart(startSlot)} / span {getRowSpan(startSlot, endSlot)};
						"
					>
						<ScheduleBlockCell
							{block}
							slotHeight={SLOT_HEIGHT}
							minutesPerSlot={MINUTES_PER_SLOT}
							onclick={() => onBlockClick?.(block)}
						/>
					</div>
				{/if}
			{/each}

			<!-- Appointment blocks (overlaid via grid placement) -->
			{#each appointments as appt}
				{@const startSlot = getSlotFromTime(appt.start_time)}
				{@const endSlot = getSlotFromTime(appt.end_time)}
				{@const col = getColumnIndex(appt.room_id)}
				{#if col >= 2 && startSlot >= visibleStart() && startSlot < visibleEnd()}
					<div
						class="z-10 p-0.5"
						style="
							grid-column: {col};
							grid-row: {getRowStart(startSlot)} / span {getRowSpan(startSlot, endSlot)};
						"
					>
						<AppointmentBlock
							appointment={appt}
							slotHeight={SLOT_HEIGHT}
							minutesPerSlot={MINUTES_PER_SLOT}
							onclick={() => onAppointmentClick?.(appt)}
						/>
					</div>
				{/if}
			{/each}
		</div>
	</div>
{/if}
