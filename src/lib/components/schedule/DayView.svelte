<script lang="ts">
	import type { Appointment, AppointmentRoom, WorkingHoursEntry, ScheduleBlock, StaffPresenceInfo } from '$lib/types';
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
		staffPresence?: StaffPresenceInfo[];
		showPresenceOverlay?: boolean;
		onSlotClick?: (roomId: string, time: string) => void;
		onAppointmentClick?: (appointment: Appointment) => void;
		onDragCreate?: (selections: Array<{roomIds: string[]; startTime: string; endTime: string}>, anchorRect: DOMRect) => void;
		onBlockClick?: (block: ScheduleBlock) => void;
	onAppointmentDoubleClick?: (appointment: Appointment) => void;
	onAppointmentQuickUpdate?: (id: string, startTime: string, endTime: string, durationMin: number, roomId: string) => void;
	onBlockQuickUpdate?: (id: string, startTime: string, endTime: string, roomId: string) => void;
	}

	let {
		date,
		appointments,
		activeRooms,
		workingHoursForDay,
		scheduleBlocks = [],
		staffPresence = [],
		showPresenceOverlay = false,
		onSlotClick,
		onAppointmentClick,
		onDragCreate,
		onBlockClick,
		onAppointmentDoubleClick,
		onAppointmentQuickUpdate,
		onBlockQuickUpdate,
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
		return activeRooms.findIndex((r) => r.id === roomId) + 2 + staffColCount; // +2 for time col, +N for staff strips
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
		if (suppressNextSlotClick) { suppressNextSlotClick = false; return; }
		if (isDragging) return;
		// Guard: don't open new-appointment dialog if an appointment covers this slot
		if (appointments.some(a =>
			a.room_id === roomId &&
			getSlotFromTime(a.start_time) <= slot &&
			getSlotFromTime(a.end_time) > slot
		)) return;
		onSlotClick?.(roomId, slotToTime(slot));
	}

	// ── Color helpers ────────────────────────────────────────────────────
	function hexToRgba(hex: string, alpha: number): string {
		if (!hex || !hex.startsWith('#') || hex.length < 7) return `rgba(100,116,139,${alpha})`;
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r},${g},${b},${alpha})`;
	}

	// ── Staff presence overlay ────────────────────────────────────────────
	function timeToSlot(t: string): number {
		const [h, m] = t.split(':').map(Number);
		return h * SLOTS_PER_HOUR + Math.floor(m / MINUTES_PER_SLOT);
	}

	const staffColCount = $derived(showPresenceOverlay && staffPresence.length > 0 ? staffPresence.length : 0);

	// Pills: show all when hoverSlot is null, filter to present when on grid
	const pillsToShow = $derived.by(() => {
		if (!showPresenceOverlay || staffPresence.length === 0) return [];
		const slot = hoverSlot;
		if (slot === null) return staffPresence;
		return staffPresence.filter(s => {
			const start = timeToSlot(s.start_time);
			const end = timeToSlot(s.end_time);
			if (slot < start || slot >= end) return false;
			if (s.break_start && s.break_end) {
				const bs = timeToSlot(s.break_start);
				const be = timeToSlot(s.break_end);
				if (slot >= bs && slot < be) return false;
			}
			return true;
		});
	});

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
	let dragHasMoved = $state(false); // true once pointer crosses to a different slot
	let hoverSlot = $state<number | null>(null);

	// ── Schedule block drag state ─────────────────────────────────────
	let selectedBlockId = $state<string | null>(null);
	type BlockDragOp = 'move' | 'resize-top' | 'resize-bottom';
	let blockPendingId = $state<string | null>(null);
	let blockPendingOp = $state<BlockDragOp>('move');
	let blockPendingDownX = $state(0);
	let blockPendingDownY = $state(0);
	let blockDragActive = $state(false);
	let blockDragOp = $state<BlockDragOp | null>(null);
	let blockDragSource = $state<ScheduleBlock | null>(null);
	let blockDragOrigStartSlot = $state(0);
	let blockDragOrigEndSlot = $state(0);
	let blockDragOrigRoomId = $state('');
	let blockDragAnchorSlot = $state(0);
	let blockGhostStartSlot = $state<number | null>(null);
	let blockGhostEndSlot = $state<number | null>(null);
	let blockGhostRoomId = $state<string | null>(null);

	// ── Appointment interaction state ─────────────────────────────────
	// Set in onGridPointerUp after a plain appointment click to suppress the
	// subsequent click event that bubbles/falls through to slot cells.
	let suppressNextSlotClick = false;
	// Double-click detection (can't rely on ondblclick — e.preventDefault on pointerdown kills it)
	let lastApptClickId: string | null = null;
	let lastApptClickTime = 0;

	type ApptDragOp = 'move' | 'resize-top' | 'resize-bottom';
	let selectedApptId = $state<string | null>(null);
	// Pending: pointer-down on appt but not yet confirmed as drag
	let apptPendingId = $state<string | null>(null);
	let apptPendingOp = $state<ApptDragOp>('move');
	let apptPendingDownX = $state(0);
	let apptPendingDownY = $state(0);
	let apptPendingSlot = $state(0);
	// Active drag
	let apptDragActive = $state(false);
	let apptDragOp = $state<ApptDragOp | null>(null);
	let apptDragSource = $state<Appointment | null>(null);
	let apptDragOrigStartSlot = $state(0);
	let apptDragOrigEndSlot = $state(0);
	let apptDragOrigRoomId = $state('');
	let apptDragAnchorSlot = $state(0);
	let apptGhostStartSlot = $state<number | null>(null);
	let apptGhostEndSlot = $state<number | null>(null);
	let apptGhostRoomId = $state<string | null>(null);

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

		// ── Appointment interaction ───────────────────────────────────
		// First try direct DOM detection (click landed on the wrapper or handle).
		const handleEl = target.closest('[data-appt-handle]') as HTMLElement | null;
		const apptWrapperEl = target.closest('[data-appt-id]') as HTMLElement | null;

		// Also check via slot cell: pointer-events:none on AppointmentBlock's inner
		// content div routes events to the slot cell behind — so if the target is a
		// slot cell, check if any appointment occupies that slot+room in the data.
		const slotCellEl = target.closest('[data-slot]') as HTMLElement | null;
		const slotNum = slotCellEl ? parseInt(slotCellEl.dataset.slot ?? '') : NaN;
		const slotRoom = slotCellEl?.dataset.room ?? '';
		const apptAtSlot = (!isNaN(slotNum) && slotRoom && !handleEl && !apptWrapperEl)
			? appointments.find(a =>
				a.room_id === slotRoom &&
				getSlotFromTime(a.start_time) <= slotNum &&
				getSlotFromTime(a.end_time) > slotNum
			) ?? null
			: null;

		if (handleEl || apptWrapperEl || apptAtSlot) {
			const wrapperId = handleEl?.closest('[data-appt-id]')?.getAttribute('data-appt-id')
				?? apptWrapperEl?.getAttribute('data-appt-id')
				?? apptAtSlot?.id
				?? null;
			if (!wrapperId) return;
			const handle = handleEl?.getAttribute('data-appt-handle') as 'top' | 'bottom' | null;
			const op: ApptDragOp = handle === 'top' ? 'resize-top' : handle === 'bottom' ? 'resize-bottom' : 'move';
			apptPendingId = wrapperId;
			apptPendingOp = op;
			apptPendingDownX = e.clientX;
			apptPendingDownY = e.clientY;
			apptPendingSlot = apptDragOrigStartSlot;
			e.preventDefault();
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			return;
		}

		// ── Schedule block interaction ────────────────────────────────
		const blockHandleEl = target.closest('[data-block-handle]') as HTMLElement | null;
		const blockWrapperEl = target.closest('[data-block-id]') as HTMLElement | null;
		if (blockHandleEl || blockWrapperEl) {
			const wrapperId = blockHandleEl?.closest('[data-block-id]')?.getAttribute('data-block-id')
				?? blockWrapperEl?.getAttribute('data-block-id')
				?? null;
			if (!wrapperId) return;
			const handle = blockHandleEl?.getAttribute('data-block-handle') as 'top' | 'bottom' | null;
			const op: BlockDragOp = handle === 'top' ? 'resize-top' : handle === 'bottom' ? 'resize-bottom' : 'move';
			blockPendingId = wrapperId;
			blockPendingOp = op;
			blockPendingDownX = e.clientX;
			blockPendingDownY = e.clientY;
			e.preventDefault();
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
			return;
		}

		// ── Slot drag (empty area) ────────────────────────────────────
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
		dragHasMoved = false;
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

		// ── Appointment drag activation ───────────────────────────────
		if (apptPendingId && !apptDragActive) {
			const dx = e.clientX - apptPendingDownX;
			const dy = e.clientY - apptPendingDownY;
			if (Math.abs(dx) + Math.abs(dy) > 5) {
				const appt = appointments.find(a => a.id === apptPendingId);
				if (appt) {
					// Find slot under pointer (look past the appointment element)
					const els = document.elementsFromPoint(e.clientX, e.clientY) as Element[];
					const cell = els.find(el => (el as HTMLElement).dataset?.slot) as HTMLElement | undefined;
					const anchorSlot = cell ? parseInt(cell.dataset.slot ?? '') : getSlotFromTime(appt.start_time);
					apptDragActive = true;
					apptDragOp = apptPendingOp;
					apptDragSource = appt;
					apptDragOrigStartSlot = getSlotFromTime(appt.start_time);
					apptDragOrigEndSlot = getSlotFromTime(appt.end_time);
					apptDragOrigRoomId = appt.room_id;
					apptDragAnchorSlot = isNaN(anchorSlot) ? apptDragOrigStartSlot : anchorSlot;
					apptGhostStartSlot = apptDragOrigStartSlot;
					apptGhostEndSlot = apptDragOrigEndSlot;
					apptGhostRoomId = appt.room_id;
				}
			}
		}

		// ── Appointment drag update ───────────────────────────────────
		if (apptDragActive && apptDragOp !== null) {
			const els = document.elementsFromPoint(e.clientX, e.clientY) as Element[];
			const cell = els.find(el => (el as HTMLElement).dataset?.slot) as HTMLElement | undefined;
			if (cell) {
				const curSlot = parseInt(cell.dataset.slot ?? '');
				const curRoomId = cell.dataset.room ?? (apptGhostRoomId ?? apptDragOrigRoomId);
				if (!isNaN(curSlot)) {
					const dur = apptDragOrigEndSlot - apptDragOrigStartSlot;
					if (apptDragOp === 'move') {
						const newStart = Math.max(visibleStart(), apptDragOrigStartSlot + (curSlot - apptDragAnchorSlot));
						apptGhostStartSlot = newStart;
						apptGhostEndSlot = newStart + dur;
						apptGhostRoomId = curRoomId;
					} else if (apptDragOp === 'resize-top') {
						apptGhostStartSlot = Math.min(curSlot, apptDragOrigEndSlot - 1);
						apptGhostEndSlot = apptDragOrigEndSlot;
					} else if (apptDragOp === 'resize-bottom') {
						apptGhostStartSlot = apptDragOrigStartSlot;
						apptGhostEndSlot = Math.max(curSlot + 1, apptDragOrigStartSlot + 1);
					}
				}
			}
			return;
		}

		// ── Block drag activation ─────────────────────────────────────
		if (blockPendingId && !blockDragActive) {
			const dx = e.clientX - blockPendingDownX;
			const dy = e.clientY - blockPendingDownY;
			if (Math.abs(dx) + Math.abs(dy) > 5) {
				const block = scheduleBlocks.find(b => b.id === blockPendingId);
				if (block) {
					const els = document.elementsFromPoint(e.clientX, e.clientY) as Element[];
					const cell = els.find(el => (el as HTMLElement).dataset?.slot) as HTMLElement | undefined;
					const anchorSlot = cell ? parseInt(cell.dataset.slot ?? '') : getSlotFromTime(block.start_time);
					blockDragActive = true;
					blockDragOp = blockPendingOp;
					blockDragSource = block;
					blockDragOrigStartSlot = getSlotFromTime(block.start_time);
					blockDragOrigEndSlot = getSlotFromTime(block.end_time);
					blockDragOrigRoomId = block.room_id;
					blockDragAnchorSlot = isNaN(anchorSlot) ? blockDragOrigStartSlot : anchorSlot;
					blockGhostStartSlot = blockDragOrigStartSlot;
					blockGhostEndSlot = blockDragOrigEndSlot;
					blockGhostRoomId = block.room_id;
				}
			}
		}

		// ── Block drag update ─────────────────────────────────────────
		if (blockDragActive && blockDragOp !== null) {
			const els = document.elementsFromPoint(e.clientX, e.clientY) as Element[];
			const cell = els.find(el => (el as HTMLElement).dataset?.slot) as HTMLElement | undefined;
			if (cell) {
				const curSlot = parseInt(cell.dataset.slot ?? '');
				const curRoomId = cell.dataset.room ?? (blockGhostRoomId ?? blockDragOrigRoomId);
				if (!isNaN(curSlot)) {
					const dur = blockDragOrigEndSlot - blockDragOrigStartSlot;
					if (blockDragOp === 'move') {
						const newStart = Math.max(visibleStart(), blockDragOrigStartSlot + (curSlot - blockDragAnchorSlot));
						blockGhostStartSlot = newStart;
						blockGhostEndSlot = newStart + dur;
						blockGhostRoomId = curRoomId;
					} else if (blockDragOp === 'resize-top') {
						blockGhostStartSlot = Math.min(curSlot, blockDragOrigEndSlot - 1);
						blockGhostEndSlot = blockDragOrigEndSlot;
					} else if (blockDragOp === 'resize-bottom') {
						blockGhostStartSlot = blockDragOrigStartSlot;
						blockGhostEndSlot = Math.max(curSlot + 1, blockDragOrigStartSlot + 1);
					}
				}
			}
			return;
		}

		// ── Hover update ──────────────────────────────────────────────
		if (!isDragging) {
			const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
			const cell = el?.closest('[data-slot]') as HTMLElement | null;
			if (cell) {
				const s = parseInt(cell.dataset.slot ?? '');
				if (!isNaN(s)) hoverSlot = s;
			}
		}

		// ── Slot drag update ──────────────────────────────────────────
		if (!isDragging || !gridEl) return;
		const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
		const cell = el?.closest('[data-slot]') as HTMLElement | null;
		if (!cell) return;
		const slot = parseInt(cell.dataset.slot ?? '');
		const roomId = cell.dataset.room ?? '';
		if (isNaN(slot)) return;
		if (slot !== dragStartSlot || roomId !== dragRoomId) dragHasMoved = true;
		dragEndSlot = slot;
		if (dragShiftHeld) {
			const rIdx = activeRooms.findIndex((r) => r.id === roomId);
			if (rIdx >= 0) dragEndRoomIdx = rIdx;
		} else {
			if (roomId !== dragRoomId) return;
		}
	}

	function onGridPointerUp(e: PointerEvent) {
		// ── Appointment interaction path ──────────────────────────────
		if (apptPendingId) {
			if (!apptDragActive) {
				// Plain click → check for double-click (can't use ondblclick, e.preventDefault kills it)
				const now = Date.now();
				const isDouble = lastApptClickId === apptPendingId && now - lastApptClickTime < 300;
				if (isDouble) {
					const appt = appointments.find(a => a.id === apptPendingId);
					if (appt) onAppointmentDoubleClick?.(appt);
					lastApptClickId = null;
					lastApptClickTime = 0;
				} else {
					selectedApptId = apptPendingId;
					lastApptClickId = apptPendingId;
					lastApptClickTime = now;
				}
				suppressNextSlotClick = true;
			} else {
				// Drag complete → commit
				if (apptDragSource && apptGhostStartSlot !== null && apptGhostEndSlot !== null) {
					const newStart = `${date}T${slotToTime(apptGhostStartSlot)}:00`;
					const newEnd   = `${date}T${slotToTime(apptGhostEndSlot)}:00`;
					const dur = (apptGhostEndSlot - apptGhostStartSlot) * MINUTES_PER_SLOT;
					const roomId = apptGhostRoomId ?? apptDragOrigRoomId;
					onAppointmentQuickUpdate?.(apptDragSource.id, newStart, newEnd, dur, roomId);
					selectedApptId = apptDragSource.id;
				}
			}
			apptPendingId = null;
			apptDragActive = false;
			apptDragOp = null;
			apptDragSource = null;
			apptGhostStartSlot = null;
			apptGhostEndSlot = null;
			apptGhostRoomId = null;
			return;
		}

		// ── Schedule block interaction path ───────────────────────────
		if (blockPendingId) {
			if (!blockDragActive) {
				// Plain click → select, clear appointment selection
				selectedBlockId = blockPendingId;
				selectedApptId = null;
			} else {
				// Drag complete → commit
				if (blockDragSource && blockGhostStartSlot !== null && blockGhostEndSlot !== null) {
					const newStart = `${date}T${slotToTime(blockGhostStartSlot)}:00`;
					const newEnd   = `${date}T${slotToTime(blockGhostEndSlot)}:00`;
					const roomId = blockGhostRoomId ?? blockDragOrigRoomId;
					onBlockQuickUpdate?.(blockDragSource.id, newStart, newEnd, roomId);
					selectedBlockId = blockDragSource.id;
				}
			}
			blockPendingId = null;
			blockDragActive = false;
			blockDragOp = null;
			blockDragSource = null;
			blockGhostStartSlot = null;
			blockGhostEndSlot = null;
			blockGhostRoomId = null;
			return;
		}

		// ── Slot drag path ────────────────────────────────────────────
		// Click on empty area → deselect both appointment and block
		if (!isDragging) {
			selectedApptId = null;
			selectedBlockId = null;
			return;
		}
		isDragging = false;
		lastPointerX = e.clientX;
		lastPointerY = e.clientY;
		lastAnchorRect = new DOMRect(e.clientX, e.clientY, 0, 0);

		const moved = dragHasMoved;
		dragHasMoved = false;

		const roomIds = dragSelectedRoomIds();
		const hasSelection = roomIds.length > 0 && dragMinSlot !== null && dragMaxSlot !== null;

		// If the user clicked (no drag) on a slot that has an appointment, do nothing —
		// the appointment pointer path handles selection. Without this guard the code
		// falls through to firePendingSelections → onDragCreate → dialog opens.
		const apptAtClickSlot = !moved && dragRoomId !== null && dragStartSlot !== null
			? appointments.find(a =>
				a.room_id === dragRoomId &&
				getSlotFromTime(a.start_time) <= dragStartSlot! &&
				getSlotFromTime(a.end_time) > dragStartSlot!
			) ?? null
			: null;
		if (!moved && apptAtClickSlot) {
			// plain click on appointment — handled above; skip all slot actions
		} else if (!moved && hasSelection && !e.shiftKey) {
			onSlotClick?.(roomIds[0], slotToTime(dragMinSlot!));
		} else if (hasSelection && e.shiftKey) {
			pendingSelections = [
				...pendingSelections,
				{ roomIds, startSlot: dragMinSlot!, endSlot: dragMaxSlot! },
			];
		} else if (hasSelection) {
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

	// Override cursor globally during appointment drag
	$effect(() => {
		if (apptDragActive) {
			const c = apptDragOp === 'move' ? 'grabbing' : 'ns-resize';
			document.body.style.cursor = c;
			return () => { document.body.style.cursor = ''; };
		}
	});

	// Override cursor globally during block drag
	$effect(() => {
		if (blockDragActive) {
			const c = blockDragOp === 'move' ? 'grabbing' : 'ns-resize';
			document.body.style.cursor = c;
			return () => { document.body.style.cursor = ''; };
		}
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
		<!-- Staff presence pills bar -->
		{#if showPresenceOverlay}
			<div class="sticky top-0 z-30 flex flex-wrap items-center gap-1.5 px-3 py-2 bg-background/95 backdrop-blur-sm border-b border-border min-h-[36px]">
				<span class="text-[10px] text-muted-foreground/60 mr-1 shrink-0">
					{hoverSlot !== null ? i18n.t.schedule.presence.presentAt + ' ' + slotToTime(hoverSlot ?? 0) : i18n.t.schedule.presence.allPresent}:
				</span>
				{#if pillsToShow.length === 0}
					<span class="text-[11px] text-muted-foreground italic">{i18n.t.schedule.presence.nonePresent}</span>
				{:else}
					{#each pillsToShow as s}
						<span
							class="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium transition-all"
							style="background-color: {hexToRgba(s.color, 0.15)}; border: 1px solid {hexToRgba(s.color, 0.6)}; color: {s.color};"
						>
							<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background: {s.color}"></span>
							{s.name}
						</span>
					{/each}
				{/if}
			</div>
		{/if}

		<div
			bind:this={gridEl}
			class="day-grid min-w-0 relative"
			style="
				display: grid;
				grid-template-columns: 56px{staffColCount > 0 ? ` repeat(${staffColCount}, 10px)` : ''} repeat({activeRooms.length}, 200px);
				grid-template-rows: 32px repeat({visibleSlots}, {SLOT_HEIGHT}px);
			"
			onpointerdown={onGridPointerDown}
			onpointermove={onGridPointerMove}
			onpointerup={onGridPointerUp}
			onpointerleave={() => { hoverSlot = null; }}
			role="grid"
		>
			<!-- Top-left corner -->
			<div class="sticky top-0 z-20 bg-background border-b border-r border-border" style="grid-column: 1; grid-row: 1;"></div>

			<!-- Staff strip headers (tiny colored dots in header row) -->
			{#if staffColCount > 0}
				{#each staffPresence as s, si}
					<div
						class="sticky top-0 z-20 border-b border-border flex items-center justify-center"
						style="grid-column: {si + 2}; grid-row: 1; background-color: {hexToRgba(s.color, 0.12)};"
						title={s.name}
					>
						<span class="w-2 h-2 rounded-full" style="background: {s.color}"></span>
					</div>
				{/each}
			{/if}

			<!-- Room headers -->
			{#each activeRooms as room, i}
				<div
					class="sticky top-0 z-20 border-b border-border flex items-center justify-center gap-1.5 text-xs font-medium px-2"
					style="grid-column: {i + 2 + staffColCount}; grid-row: 1; background-color: {hexToRgba(room.color, 0.15)};"
				>
					<span class="w-2 h-2 rounded-full shrink-0" style="background-color: {room.color}"></span>
					<span class="truncate">{room.name}</span>
				</div>
			{/each}

			<!-- Staff presence strips (vertical bands spanning working hours) -->
			{#if staffColCount > 0}
				{#each staffPresence as s, si}
					{@const sStart = timeToSlot(s.start_time)}
					{@const sEnd = timeToSlot(s.end_time)}
					{@const clampedStart = Math.max(sStart, visibleStart())}
					{@const clampedEnd = Math.min(sEnd, visibleEnd())}
					{@const bStart = s.break_start ? timeToSlot(s.break_start) : null}
					{@const bEnd = s.break_end ? timeToSlot(s.break_end) : null}
					{@const col = si + 2}

					{#if clampedEnd > clampedStart}
						<!-- Working hours band (solid color, broken into segments around break) -->
						{#if bStart !== null && bEnd !== null && bStart > clampedStart && bStart < clampedEnd}
							<!-- Before break -->
							<div class="pointer-events-none z-5"
								style="grid-column: {col}; grid-row: {getRowStart(clampedStart)} / span {bStart - clampedStart}; background-color: {hexToRgba(s.color, 0.45)};"></div>
							<!-- Break: diagonal hatch -->
							{@const clampedBStart = Math.max(bStart, clampedStart)}
							{@const clampedBEnd = Math.min(bEnd ?? bStart, clampedEnd)}
							{#if clampedBEnd > clampedBStart}
								<div class="pointer-events-none z-5"
									style="grid-column: {col}; grid-row: {getRowStart(clampedBStart)} / span {clampedBEnd - clampedBStart}; background-color: {hexToRgba(s.color, 0.08)}; background-image: repeating-linear-gradient(-45deg, transparent, transparent 3px, {hexToRgba(s.color, 0.35)} 3px, {hexToRgba(s.color, 0.35)} 4px);"></div>
							{/if}
							<!-- After break -->
							{#if (bEnd ?? bStart) < clampedEnd}
								<div class="pointer-events-none z-5"
									style="grid-column: {col}; grid-row: {getRowStart(bEnd ?? bStart)} / span {clampedEnd - (bEnd ?? bStart)}; background-color: {hexToRgba(s.color, 0.45)};"></div>
							{/if}
						{:else}
							<!-- No break or break outside visible range: solid band -->
							<div class="pointer-events-none z-5"
								style="grid-column: {col}; grid-row: {getRowStart(clampedStart)} / span {clampedEnd - clampedStart}; background-color: {hexToRgba(s.color, 0.45)};"></div>
						{/if}
					{/if}
				{/each}
			{/if}

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
							grid-column: {ri + 2 + staffColCount};
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

			<!-- Drag end-time indicator -->
		{#if isDragging && dragMinSlot !== null && dragMaxSlot !== null && dragMaxSlot >= visibleStart() && dragMaxSlot <= visibleEnd()}
			{@const endTop  = 32 + (dragMaxSlot - visibleStart()) * SLOT_HEIGHT}
			{@const startTop = 32 + (dragMinSlot - visibleStart()) * SLOT_HEIGHT}
			{@const durationMin = (dragMaxSlot - dragMinSlot) * MINUTES_PER_SLOT}
			{@const midTop = (startTop + endTop) / 2}
			<!-- Solid line + end-time pill at the bottom edge of selection -->
			<div
				class="pointer-events-none absolute left-0 right-0 z-30 flex items-center"
				style="top: {endTop}px;"
			>
				<div class="w-14 shrink-0 flex justify-end pr-1.5">
					<span class="text-[9px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded leading-none -translate-y-1/2 block shadow-sm">
						{slotToTime(dragMaxSlot)}
					</span>
				</div>
				<div class="flex-1 h-px bg-primary/70"></div>
			</div>
			<!-- Duration badge centered in the selection (only if tall enough: ≥ 3 slots) -->
			{#if dragMaxSlot - dragMinSlot >= 3}
				<div
					class="pointer-events-none absolute left-0 right-0 z-30 flex items-center justify-start"
					style="top: {midTop}px;"
				>
					<div class="w-14 shrink-0 flex justify-end pr-1.5">
						<span class="text-[9px] text-primary/80 font-medium leading-none -translate-y-1/2 block">
							{durationMin}′
						</span>
					</div>
				</div>
			{/if}
		{/if}

		<!-- Appointment drag: end-time indicator -->
		{#if apptDragActive && apptGhostEndSlot !== null && apptGhostEndSlot >= visibleStart() && apptGhostEndSlot <= visibleEnd()}
			{@const apptEndTop = 32 + (apptGhostEndSlot - visibleStart()) * SLOT_HEIGHT}
			<div
				class="pointer-events-none absolute left-0 right-0 flex items-center"
				style="top: {apptEndTop}px; z-index: 30;"
			>
				<div class="w-14 shrink-0 flex justify-end pr-1.5">
					<span class="text-[9px] font-bold bg-primary text-primary-foreground px-1.5 py-0.5 rounded leading-none -translate-y-1/2 block shadow-sm">
						{slotToTime(apptGhostEndSlot)}
					</span>
				</div>
				<div class="flex-1 h-px bg-primary/70"></div>
			</div>
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

			<!-- Hover time indicator -->
			{#if hoverSlot !== null && !isDragging && hoverSlot >= visibleStart() && hoverSlot < visibleEnd()}
				{@const lineTop = 32 + (hoverSlot - visibleStart()) * SLOT_HEIGHT}
				<div
					class="pointer-events-none absolute left-0 right-0 z-[15] flex items-center"
					style="top: {lineTop}px;"
				>
					<div class="w-14 shrink-0 flex justify-end pr-1.5">
						<span class="text-[9px] font-semibold bg-primary text-primary-foreground px-1 py-0.5 rounded leading-none -translate-y-1/2 block">
							{slotToTime(hoverSlot)}
						</span>
					</div>
					<div class="flex-1 h-px bg-primary/25 border-t border-dashed border-primary/40"></div>
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
						data-block-id={block.id}
						style="
							grid-column: {col};
							grid-row: {getRowStart(startSlot)} / span {getRowSpan(startSlot, endSlot)};
							{blockDragActive && blockDragSource?.id === block.id ? 'opacity: 0.25; pointer-events: none;' : ''}
						"
						ondblclick={() => { onBlockClick?.(block); }}
					>
						<ScheduleBlockCell
							{block}
							slotHeight={SLOT_HEIGHT}
							minutesPerSlot={MINUTES_PER_SLOT}
							isSelected={selectedBlockId === block.id}
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
						data-appt-id={appt.id}
						style="
							grid-column: {col};
							grid-row: {getRowStart(startSlot)} / span {getRowSpan(startSlot, endSlot)};
							{apptDragActive && apptDragSource?.id === appt.id ? 'opacity: 0.25; pointer-events: none;' : ''}
						"
					>
						<AppointmentBlock
							appointment={appt}
							isSelected={selectedApptId === appt.id}
							slotHeight={SLOT_HEIGHT}
							minutesPerSlot={MINUTES_PER_SLOT}
						/>
					</div>
				{/if}
			{/each}

			<!-- Appointment drag ghost -->
			{#if apptDragActive && apptDragSource && apptGhostStartSlot !== null && apptGhostEndSlot !== null && apptGhostRoomId}
				{@const ghostCol = getColumnIndex(apptGhostRoomId)}
				{@const ghostRowStart = getRowStart(apptGhostStartSlot)}
				{@const ghostRowSpan = Math.max(1, apptGhostEndSlot - apptGhostStartSlot)}
				{@const ghostColor = apptDragSource.type_color ?? '#6366f1'}
				{#if ghostCol >= 2}
					<div
						class="pointer-events-none p-0.5"
						style="
							grid-column: {ghostCol};
							grid-row: {ghostRowStart} / span {ghostRowSpan};
							z-index: 25;
						"
					>
						<div
							class="w-full h-full rounded overflow-hidden flex flex-col justify-between p-1.5 text-[10px]"
							style="
								border-left: 3px solid {ghostColor};
								background-color: {hexToRgba(ghostColor, 0.22)};
								outline: 2px dashed {ghostColor};
								outline-offset: -2px;
								color: {ghostColor};
							"
						>
							<span class="font-bold leading-none">{slotToTime(apptGhostStartSlot)}–{slotToTime(apptGhostEndSlot)}</span>
							{#if ghostRowSpan >= 3}
								<span class="opacity-70 leading-none">{(apptGhostEndSlot - apptGhostStartSlot) * MINUTES_PER_SLOT}′</span>
							{/if}
						</div>
					</div>
				{/if}
			{/if}

			<!-- Schedule block drag ghost -->
			{#if blockDragActive && blockDragSource && blockGhostStartSlot !== null && blockGhostEndSlot !== null && blockGhostRoomId}
				{@const ghostCol = getColumnIndex(blockGhostRoomId)}
				{@const ghostRowStart = getRowStart(blockGhostStartSlot)}
				{@const ghostRowSpan = Math.max(1, blockGhostEndSlot - blockGhostStartSlot)}
				{@const ghostColor = blockDragSource.color ?? '#94a3b8'}
				{#if ghostCol >= 2}
					<div
						class="pointer-events-none p-0.5"
						style="
							grid-column: {ghostCol};
							grid-row: {ghostRowStart} / span {ghostRowSpan};
							z-index: 22;
						"
					>
						<div
							class="w-full h-full rounded overflow-hidden flex flex-col justify-between p-1.5 text-[10px]"
							style="
								border-left: 3px solid {ghostColor};
								background: repeating-linear-gradient(-45deg, {hexToRgba(ghostColor, 0.12)}, {hexToRgba(ghostColor, 0.12)} 4px, {hexToRgba(ghostColor, 0.04)} 4px, {hexToRgba(ghostColor, 0.04)} 8px);
								outline: 2px dashed {ghostColor};
								outline-offset: -2px;
								color: {ghostColor};
							"
						>
							<span class="font-bold leading-none">{slotToTime(blockGhostStartSlot)}–{slotToTime(blockGhostEndSlot)}</span>
							{#if ghostRowSpan >= 3}
								<span class="opacity-70 leading-none">{(blockGhostEndSlot - blockGhostStartSlot) * MINUTES_PER_SLOT}′</span>
							{/if}
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}
