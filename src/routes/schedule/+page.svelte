<script lang="ts">
	import { page } from '$app/state';
	import { i18n } from '$lib/i18n';
	import { rooms } from '$lib/stores/rooms.svelte';
	import { workingHours } from '$lib/stores/workingHours.svelte';
	import {
		getAppointmentsForDate,
		insertAppointment,
		updateAppointment,
		deleteAppointment,
		getPatient,
		getScheduleBlocksForDate,
		insertScheduleBlock,
		updateScheduleBlock,
		deleteScheduleBlock,
		getStaffBlockoutsForDate,
		getAllStaffBlockouts,
		insertStaffBlockout,
		updateStaffBlockout,
		deleteStaffBlockout,
		getStaffPresenceForDay,
	} from '$lib/services/db';
	import type { Appointment, AppointmentFormData, ScheduleBlock, ScheduleBlockFormData, StaffBlockout, StaffBlockoutFormData, StaffPresenceInfo } from '$lib/types';
	import { activePatient } from '$lib/stores/activePatient.svelte';
	import { navState } from '$lib/stores/navState.svelte';
	import DayView from '$lib/components/schedule/DayView.svelte';
	import BookingPanel from '$lib/components/schedule/BookingPanel.svelte';
	import { type DragSelection } from '$lib/components/schedule/DragCreatePopover.svelte';
	import ScheduleBlockEditDialog from '$lib/components/schedule/ScheduleBlockEditDialog.svelte';
	import StaffBlockoutDialog from '$lib/components/schedule/StaffBlockoutDialog.svelte';
	import AbsentDoctorStrip from '$lib/components/schedule/AbsentDoctorStrip.svelte';
	import { Dialog, DialogContent } from '$lib/components/ui/dialog';

	// Date from URL param → navState (last visited date) → today
	const urlDate = page.url.searchParams.get('date');
	let currentDate = $state(urlDate ?? (navState.scheduleDate || new Date().toISOString().slice(0, 10)));
	let appointments = $state<Appointment[]>([]);
	let scheduleBlocks = $state<ScheduleBlock[]>([]);
	let staffBlockouts = $state<StaffBlockout[]>([]);
	let allStaffBlockouts = $state<StaffBlockout[]>([]);
	let staffPresence = $state<StaffPresenceInfo[]>([]);
	let showPresenceOverlay = $state(false);
	let isLoading = $state(false);

	// Sheet state (booking)
	let sheetOpen = $state(false);
	let selectedAppointment = $state<Appointment | null>(null);
	let prefillRoomId = $state('');
	let prefillTime = $state('');
	let prefillEndTime = $state('');

	// Block edit dialog
	let selectedBlock = $state<ScheduleBlock | null>(null);
	let blockEditOpen = $state(false);

	// Staff blockout dialog
	let staffDialogOpen = $state(false);

	// Extra room IDs for multi-chair booking (all except the first, which goes into BookingPanel)
	let extraRoomIds = $state<string[]>([]);
	// All drag selections passed to BookingPanel for the block-time tab
	let bookingBlockSelections = $state<DragSelection[]>([]);

	// Patient context from URL — or fall back to the last-viewed patient in the store
	const patientId = $derived(page.url.searchParams.get('patient') ?? activePatient.id ?? '');

	$effect(() => {
		if (patientId && patientId !== activePatient.id) {
			getPatient(patientId).then(p => {
				if (p) activePatient.set(p.patient_id, p.firstname, p.lastname);
			});
		}
	});

	const todayStr = new Date().toISOString().slice(0, 10);

	const formattedDate = $derived(() => {
		const d = new Date(currentDate + 'T12:00:00');
		const locale = i18n.code === 'de' ? 'de-DE' : 'en-GB';
		return d.toLocaleDateString(locale, {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric',
		});
	});

	async function loadDay() {
		isLoading = true;
		const dow = dayOfWeek();
		try {
			[appointments, scheduleBlocks, staffBlockouts, staffPresence] = await Promise.all([
				getAppointmentsForDate(currentDate),
				getScheduleBlocksForDate(currentDate),
				getStaffBlockoutsForDate(currentDate),
				getStaffPresenceForDay(dow),
			]);
		} finally {
			isLoading = false;
		}
	}

	// Alt key toggles the staff presence overlay
	$effect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.key === 'Alt' && !e.repeat) {
				e.preventDefault();
				showPresenceOverlay = !showPresenceOverlay;
			}
		}
		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	});

	$effect(() => {
		currentDate; // reactive dependency
		loadDay();
	});

	// Load all blockouts for the staff dialog whenever it opens
	$effect(() => {
		if (staffDialogOpen) {
			getAllStaffBlockouts().then(b => { allStaffBlockouts = b; });
		}
	});

	function prevDay() {
		const d = new Date(currentDate + 'T12:00:00');
		d.setDate(d.getDate() - 1);
		currentDate = d.toISOString().slice(0, 10);
	}

	function nextDay() {
		const d = new Date(currentDate + 'T12:00:00');
		d.setDate(d.getDate() + 1);
		currentDate = d.toISOString().slice(0, 10);
	}

	function goToday() {
		currentDate = todayStr;
	}

	const dayOfWeek = $derived(() => {
		const d = new Date(currentDate + 'T12:00:00');
		return d.getDay();
	});

	const workingHoursForDay = $derived(workingHours.getForDay(dayOfWeek()));

	// Guard: returns true if an appointment already occupies the given room+time
	function hasAppointmentAt(roomId: string, time: string): boolean {
		const [h, m] = time.split(':').map(Number);
		const clickMin = h * 60 + m;
		return appointments.some(a => {
			if (a.room_id !== roomId) return false;
			const [sh, sm] = a.start_time.slice(11, 16).split(':').map(Number);
			const [eh, em] = a.end_time.slice(11, 16).split(':').map(Number);
			return clickMin >= sh * 60 + sm && clickMin < eh * 60 + em;
		});
	}

	// Slot / appointment click handlers
	function handleSlotClick(roomId: string, time: string) {
		// Don't open new-appointment dialog if an appointment already covers this slot
		if (hasAppointmentAt(roomId, time)) return;
		selectedAppointment = null;
		prefillRoomId = roomId;
		prefillTime = time;
		prefillEndTime = '';
		sheetOpen = true;
	}

	function handleAppointmentClick(appt: Appointment) {
		selectedAppointment = appt;
		prefillRoomId = '';
		prefillTime = '';
		prefillEndTime = '';
		sheetOpen = true;
	}

	// Drag create handler — directly open BookingPanel (appointment tab by default)
	function handleDragCreate(selections: DragSelection[], _anchorRect: DOMRect) {
		const primary = selections[0];
		if (!primary) return;
		// Single-slot drag on a slot that already has an appointment → ignore
		if (primary.roomIds.length === 1 && hasAppointmentAt(primary.roomIds[0], primary.startTime)) return;
		prefillRoomId = primary.roomIds[0] ?? '';
		extraRoomIds = [
			...primary.roomIds.slice(1),
			...selections.slice(1).flatMap((s) => s.roomIds),
		];
		prefillTime = primary.startTime;
		prefillEndTime = primary.endTime;
		bookingBlockSelections = selections;
		selectedAppointment = null;
		sheetOpen = true;
	}

	// Block click (double-click → open edit dialog)
	function handleBlockClick(block: ScheduleBlock) {
		selectedBlock = block;
		blockEditOpen = true;
	}

	// Block quick update from drag-move / resize
	async function handleBlockQuickUpdate(id: string, startTime: string, endTime: string, roomId: string) {
		const block = scheduleBlocks.find(b => b.id === id);
		if (!block) return;
		await updateScheduleBlock(id, {
			room_id: roomId,
			doctor_id: block.doctor_id ?? '',
			title: block.title,
			start_time: startTime,
			end_time: endTime,
			color: block.color ?? '#94a3b8',
			notes: block.notes ?? '',
		});
		await loadDay();
	}

	// Appointment CRUD
	async function handleSave(data: AppointmentFormData & { patient_id: string }) {
		if (selectedAppointment) {
			await updateAppointment(selectedAppointment.id, data);
		} else {
			// Primary room (from BookingPanel form)
			await insertAppointment(data);
			// Duplicate into extra rooms from multi-chair drag
			await Promise.all(extraRoomIds.map((rid) => insertAppointment({ ...data, room_id: rid })));
		}
		extraRoomIds = [];
		sheetOpen = false;
		selectedAppointment = null;
		await loadDay();
	}

	async function handleDelete() {
		if (!selectedAppointment) return;
		await deleteAppointment(selectedAppointment.id);
		sheetOpen = false;
		selectedAppointment = null;
		await loadDay();
	}

	// Schedule block CRUD (receives array — one entry per room from drag)
	async function handleBlockSave(dataList: ScheduleBlockFormData[]) {
		await Promise.all(dataList.map((d) => insertScheduleBlock(d)));
		await loadDay();
	}

	async function handleBlockUpdate(id: string, data: ScheduleBlockFormData) {
		await updateScheduleBlock(id, data);
		blockEditOpen = false;
		selectedBlock = null;
		await loadDay();
	}

	async function handleBlockDelete(id: string) {
		await deleteScheduleBlock(id);
		blockEditOpen = false;
		selectedBlock = null;
		await loadDay();
	}

	// Staff blockout CRUD
	async function handleBlockoutSave(data: StaffBlockoutFormData) {
		await insertStaffBlockout(data);
		const [dayBlockouts, all] = await Promise.all([
			getStaffBlockoutsForDate(currentDate),
			getAllStaffBlockouts(),
		]);
		staffBlockouts = dayBlockouts;
		allStaffBlockouts = all;
	}

	async function handleBlockoutUpdate(id: string, data: StaffBlockoutFormData) {
		await updateStaffBlockout(id, data);
		const [dayBlockouts, all] = await Promise.all([
			getStaffBlockoutsForDate(currentDate),
			getAllStaffBlockouts(),
		]);
		staffBlockouts = dayBlockouts;
		allStaffBlockouts = all;
	}

	async function handleAppointmentQuickUpdate(id: string, startTime: string, endTime: string, durationMin: number, roomId: string) {
		const appt = appointments.find(a => a.id === id);
		if (!appt) return;
		await updateAppointment(id, {
			patient_id: appt.patient_id,
			doctor_id: appt.doctor_id ?? '',
			room_id: roomId,
			type_id: appt.type_id ?? '',
			start_time: startTime,
			end_time: endTime,
			duration_min: durationMin,
			title: appt.title ?? '',
			notes: appt.notes ?? '',
			status: appt.status,
		});
		await loadDay();
	}

	async function handleBlockoutDelete(id: string) {
		await deleteStaffBlockout(id);
		const [dayBlockouts, all] = await Promise.all([
			getStaffBlockoutsForDate(currentDate),
			getAllStaffBlockouts(),
		]);
		staffBlockouts = dayBlockouts;
		allStaffBlockouts = all;
	}

	// Persist current date so returning to schedule restores it
	$effect(() => { navState.setScheduleDate(currentDate); });

	// ── Day PDF / Print ────────────────────────────────────────────────
	function fmtTime(iso: string): string {
		const d = new Date(iso);
		return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
	}

	function printScheduleDay() {
		const locale = i18n.code === 'de' ? 'de-DE' : 'en-GB';
		const dateLabel = new Date(currentDate + 'T12:00:00').toLocaleDateString(locale, {
			weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
		});

		const statusLabel: Record<string, string> = {
			scheduled:  i18n.t.schedule.statuses.scheduled,
			completed:  i18n.t.schedule.statuses.completed,
			cancelled:  i18n.t.schedule.statuses.cancelled,
			no_show:    i18n.t.schedule.statuses.no_show,
		};
		const statusColor: Record<string, string> = {
			scheduled: '#2563eb', completed: '#16a34a',
			cancelled: '#dc2626', no_show: '#d97706',
		};

		const sorted = [...appointments].sort((a, b) => a.start_time.localeCompare(b.start_time));

		const rows = sorted.map((a) => {
			const patientName = a.patient_lastname
				? `${a.patient_lastname}, ${a.patient_firstname ?? ''}`.trim()
				: '—';
			const timeRange = `${fmtTime(a.start_time)} – ${fmtTime(a.end_time)}`;
			const color = statusColor[a.status] ?? '#6b7280';
			const label = statusLabel[a.status] ?? a.status;
			return `<tr>
				<td>${timeRange}</td>
				<td><strong>${patientName}</strong></td>
				<td>${a.type_name ?? '—'}</td>
				<td>${a.room_name ?? '—'}</td>
				<td>${a.doctor_name ?? '—'}</td>
				<td>${a.duration_min} min</td>
				<td><span style="color:${color};font-weight:600">${label}</span></td>
				<td style="font-size:11px;color:#555">${a.notes ?? ''}</td>
			</tr>`;
		}).join('');

		const colHeaders = [
			i18n.t.schedule.startTime,
			i18n.t.schedule.patient,
			i18n.t.schedule.type,
			i18n.t.schedule.room,
			i18n.t.schedule.doctor,
			i18n.t.schedule.duration,
			i18n.t.schedule.status,
			i18n.t.common.notes,
		].map(h => `<th>${h}</th>`).join('');

		const html = `<!DOCTYPE html>
<html lang="${i18n.code}">
<head>
<meta charset="utf-8"/>
<title>DentVault – ${dateLabel}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, Arial, sans-serif; font-size: 13px; color: #111; padding: 24px 32px; }
  h1 { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
  .sub { font-size: 12px; color: #666; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #f1f5f9; text-align: left; padding: 7px 10px; font-size: 11px; text-transform: uppercase;
       letter-spacing: .04em; border-bottom: 2px solid #cbd5e1; }
  td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(even) td { background: #f8fafc; }
  .empty { text-align: center; color: #999; padding: 40px; font-style: italic; }
  @media print {
    body { padding: 12px 20px; }
    @page { margin: 1.5cm; }
  }
</style>
</head>
<body>
<h1>DentVault</h1>
<p class="sub">${dateLabel} &nbsp;·&nbsp; ${sorted.length} ${i18n.t.dashboard.visits.patients}</p>
<table>
  <thead><tr>${colHeaders}</tr></thead>
  <tbody>${rows || `<tr><td class="empty" colspan="8">${i18n.t.common.noData}</td></tr>`}</tbody>
</table>
<script>window.onload = () => window.print();<\/script>
</body>
</html>`;

		const win = window.open('', '_blank');
		if (win) {
			win.document.write(html);
			win.document.close();
		}
	}
</script>

<div class="flex flex-col h-full overflow-hidden -m-6">
	<!-- Header -->
	<div class="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
		<h1 class="text-lg font-semibold mr-2">{i18n.t.schedule.title}</h1>

		<!-- Patient context banner -->
		{#if activePatient.id}
			<a
				href="/patients/{activePatient.id}"
				class="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 text-muted-foreground">
					<path d="M19 12H5M12 19l-7-7 7-7"/>
				</svg>
				{activePatient.displayName}
			</a>
		{/if}

		<div class="flex items-center gap-1 ml-auto">
			<!-- Print / PDF -->
			<button
				class="px-3 py-1 text-sm border border-border rounded hover:bg-accent transition-colors"
				onclick={printScheduleDay}
				title={i18n.t.schedule.printDay}
			>
				<span class="flex items-center gap-1.5">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
						<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
					</svg>
					{i18n.t.schedule.printDay}
				</span>
			</button>
			<!-- Presence overlay toggle -->
			<button
				class="px-3 py-1 text-sm border rounded transition-colors {showPresenceOverlay ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-accent'}"
				onclick={() => { showPresenceOverlay = !showPresenceOverlay; }}
				title="Alt / Option"
			>
				<span class="flex items-center gap-1.5">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
					{i18n.t.schedule.presence.toggle}
				</span>
			</button>
			<!-- Staff absences button -->
			<button
				class="px-3 py-1 text-sm border border-border rounded hover:bg-accent transition-colors"
				onclick={() => (staffDialogOpen = true)}
			>
				👥 {i18n.t.schedule.staffBlockouts.title}
			</button>

			<button
				class="px-3 py-1 text-sm border border-border rounded hover:bg-accent transition-colors"
				onclick={goToday}
			>
				{i18n.t.schedule.today}
			</button>
			<button
				class="px-2 py-1 rounded hover:bg-accent transition-colors"
				onclick={prevDay}
				aria-label="Previous day"
			>◀</button>
			<input
				type="date"
				class="border border-border rounded px-2 py-1 text-sm bg-background"
				bind:value={currentDate}
			/>
			<button
				class="px-2 py-1 rounded hover:bg-accent transition-colors"
				onclick={nextDay}
				aria-label="Next day"
			>▶</button>
		</div>
	</div>

	<!-- Date label -->
	<div class="px-6 py-1.5 text-sm text-muted-foreground border-b border-border shrink-0">
		{formattedDate()}
	</div>

	<!-- Absent doctors strip -->
	<AbsentDoctorStrip blockouts={staffBlockouts} />

	<!-- Main content -->
	<div class="flex flex-1 overflow-hidden relative">
		<div class="flex-1 overflow-hidden flex flex-col">
			{#if rooms.active.length === 0}
				<div class="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-10 w-10 opacity-30">
						<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
					</svg>
					<p class="text-sm">{i18n.t.schedule.noRoomsConfigured}</p>
					<a href="/settings?section=schedule" class="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
						{i18n.t.schedule.goToSettings}
					</a>
				</div>
			{:else if isLoading && appointments.length === 0 && scheduleBlocks.length === 0}
				<div class="flex items-center justify-center h-32 text-muted-foreground text-sm">{i18n.t.common.loading}</div>
			{:else}
				<DayView
					date={currentDate}
					{appointments}
					{scheduleBlocks}
					activeRooms={rooms.active}
					{workingHoursForDay}
					{staffPresence}
					{showPresenceOverlay}
					onSlotClick={handleSlotClick}
					onAppointmentDoubleClick={handleAppointmentClick}
				onAppointmentQuickUpdate={handleAppointmentQuickUpdate}
					onDragCreate={handleDragCreate}
					onBlockClick={handleBlockClick}
					onBlockQuickUpdate={handleBlockQuickUpdate}
				/>
			{/if}
		</div>

		<!-- Booking Dialog (centered) -->
		<Dialog bind:open={sheetOpen}>
			<DialogContent class="max-w-[640px] sm:max-w-[640px] p-0 overflow-hidden flex flex-col max-h-[90vh]" showCloseButton={false}>
				<BookingPanel
					appointment={selectedAppointment}
					prefillRoomId={prefillRoomId}
					prefillTime={prefillTime}
					prefillEndTime={prefillEndTime}
					prefillPatientId={patientId}
					date={currentDate}
					extraRoomNames={extraRoomIds.map((id) => rooms.active.find((r) => r.id === id)?.name ?? id)}
					blockSelections={bookingBlockSelections}
					onSave={handleSave}
					onBlockSave={handleBlockSave}
					onDelete={selectedAppointment ? handleDelete : undefined}
					onClose={() => { sheetOpen = false; extraRoomIds = []; prefillEndTime = ''; bookingBlockSelections = []; }}
				/>
			</DialogContent>
		</Dialog>
	</div>


	<!-- Block edit dialog -->
	<ScheduleBlockEditDialog
		block={selectedBlock}
		bind:open={blockEditOpen}
		onSave={handleBlockUpdate}
		onDelete={handleBlockDelete}
		onClose={() => { blockEditOpen = false; selectedBlock = null; }}
	/>

	<!-- Staff blockout dialog -->
	<StaffBlockoutDialog
		bind:open={staffDialogOpen}
		blockouts={allStaffBlockouts}
		onSave={handleBlockoutSave}
		onUpdate={handleBlockoutUpdate}
		onDelete={handleBlockoutDelete}
		onClose={() => (staffDialogOpen = false)}
	/>
</div>
