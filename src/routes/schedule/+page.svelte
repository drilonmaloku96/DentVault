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
	} from '$lib/services/db';
	import type { Appointment, AppointmentFormData, ScheduleBlock, ScheduleBlockFormData, StaffBlockout, StaffBlockoutFormData } from '$lib/types';
	import { activePatient } from '$lib/stores/activePatient.svelte';
	import DayView from '$lib/components/schedule/DayView.svelte';
	import BookingPanel from '$lib/components/schedule/BookingPanel.svelte';
	import DragCreatePopover, { type DragSelection } from '$lib/components/schedule/DragCreatePopover.svelte';
	import ScheduleBlockEditDialog from '$lib/components/schedule/ScheduleBlockEditDialog.svelte';
	import StaffBlockoutDialog from '$lib/components/schedule/StaffBlockoutDialog.svelte';
	import AbsentDoctorStrip from '$lib/components/schedule/AbsentDoctorStrip.svelte';
	import { Dialog, DialogContent } from '$lib/components/ui/dialog';

	// Date from URL param (?date=YYYY-MM-DD) or today
	const urlDate = page.url.searchParams.get('date');
	let currentDate = $state(urlDate ?? new Date().toISOString().slice(0, 10));
	let appointments = $state<Appointment[]>([]);
	let scheduleBlocks = $state<ScheduleBlock[]>([]);
	let staffBlockouts = $state<StaffBlockout[]>([]);
	let allStaffBlockouts = $state<StaffBlockout[]>([]);
	let isLoading = $state(false);

	// Sheet state (booking)
	let sheetOpen = $state(false);
	let selectedAppointment = $state<Appointment | null>(null);
	let prefillRoomId = $state('');
	let prefillTime = $state('');

	// Block edit dialog
	let selectedBlock = $state<ScheduleBlock | null>(null);
	let blockEditOpen = $state(false);

	// Staff blockout dialog
	let staffDialogOpen = $state(false);

	// Drag create popover
	let dragPopoverVisible = $state(false);
	let dragSelections = $state<DragSelection[]>([]);
	let dragAnchorRect = $state<DOMRect>(new DOMRect());
	// Extra room IDs for multi-chair booking (all except the first, which goes into BookingPanel)
	let extraRoomIds = $state<string[]>([]);

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
		return d.toLocaleDateString('en-GB', {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric',
		});
	});

	async function loadDay() {
		isLoading = true;
		try {
			[appointments, scheduleBlocks, staffBlockouts] = await Promise.all([
				getAppointmentsForDate(currentDate),
				getScheduleBlocksForDate(currentDate),
				getStaffBlockoutsForDate(currentDate),
			]);
		} finally {
			isLoading = false;
		}
	}

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

	// Slot / appointment click handlers
	function handleSlotClick(roomId: string, time: string) {
		selectedAppointment = null;
		prefillRoomId = roomId;
		prefillTime = time;
		sheetOpen = true;
	}

	function handleAppointmentClick(appt: Appointment) {
		selectedAppointment = appt;
		prefillRoomId = '';
		prefillTime = '';
		sheetOpen = true;
	}

	// Drag create handler
	function handleDragCreate(selections: DragSelection[], anchorRect: DOMRect) {
		dragSelections = selections;
		dragAnchorRect = anchorRect;
		dragPopoverVisible = true;
	}

	// Block click
	function handleBlockClick(block: ScheduleBlock) {
		selectedBlock = block;
		blockEditOpen = true;
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

	async function handleBlockoutDelete(id: string) {
		await deleteStaffBlockout(id);
		const [dayBlockouts, all] = await Promise.all([
			getStaffBlockoutsForDate(currentDate),
			getAllStaffBlockouts(),
		]);
		staffBlockouts = dayBlockouts;
		allStaffBlockouts = all;
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
			{#if isLoading && appointments.length === 0 && scheduleBlocks.length === 0}
				<div class="flex items-center justify-center h-32 text-muted-foreground text-sm">{i18n.t.common.loading}</div>
			{:else}
				<DayView
					date={currentDate}
					{appointments}
					{scheduleBlocks}
					activeRooms={rooms.active}
					{workingHoursForDay}
					onSlotClick={handleSlotClick}
					onAppointmentClick={handleAppointmentClick}
					onDragCreate={handleDragCreate}
					onBlockClick={handleBlockClick}
				/>
			{/if}
		</div>

		<!-- Booking Dialog (centered) -->
		<Dialog bind:open={sheetOpen}>
			<DialogContent class="max-w-[480px] sm:max-w-[480px] p-0 overflow-hidden flex flex-col max-h-[90vh]" showCloseButton={false}>
				<BookingPanel
					appointment={selectedAppointment}
					prefillRoomId={prefillRoomId}
					prefillTime={prefillTime}
					prefillPatientId={patientId}
					date={currentDate}
					extraRoomNames={extraRoomIds.map((id) => rooms.active.find((r) => r.id === id)?.name ?? id)}
					onSave={handleSave}
					onDelete={selectedAppointment ? handleDelete : undefined}
					onClose={() => { sheetOpen = false; extraRoomIds = []; }}
				/>
			</DialogContent>
		</Dialog>
	</div>

	<!-- Drag create popover -->
	{#if dragPopoverVisible}
		<DragCreatePopover
			anchorRect={dragAnchorRect}
			selections={dragSelections}
			date={currentDate}
			onBlockSave={handleBlockSave}
			onBookAppointment={(primary) => {
				// Use the primary selection (first — or the one the user chose) for BookingPanel
				prefillRoomId = primary.roomIds[0] ?? '';
				// Extra rooms = remaining rooms in primary selection + all rooms from other selections
				extraRoomIds = [
					...primary.roomIds.slice(1),
					...dragSelections.filter((s) => s !== primary).flatMap((s) => s.roomIds),
				];
				prefillTime = primary.startTime;
				selectedAppointment = null;
				sheetOpen = true;
			}}
			onClose={() => (dragPopoverVisible = false)}
		/>
	{/if}

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
