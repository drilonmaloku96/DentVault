<script lang="ts">
	import { i18n } from '$lib/i18n';
	import type { Appointment, AppointmentFormData, AppointmentStatus, Patient, ScheduleBlockFormData } from '$lib/types';
	import type { DragSelection } from './DragCreatePopover.svelte';
	import { rooms } from '$lib/stores/rooms.svelte';
	import { appointmentTypes } from '$lib/stores/appointmentTypes.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { searchPatients, getPatient } from '$lib/services/db';

	interface Props {
		appointment?: Appointment | null;
		prefillRoomId?: string;
		prefillTime?: string;
		prefillEndTime?: string;
		prefillPatientId?: string;
		date?: string;
		extraRoomNames?: string[]; // additional rooms that will be booked on save
		blockSelections?: DragSelection[]; // drag selections for block-time tab
		onSave?: (data: AppointmentFormData & { patient_id: string }) => void;
		onBlockSave?: (data: ScheduleBlockFormData[]) => void;
		onDelete?: () => void;
		onClose?: () => void;
	}

	let {
		appointment = null,
		prefillRoomId = '',
		prefillTime = '',
		prefillEndTime = '',
		prefillPatientId = '',
		date = new Date().toISOString().slice(0, 10),
		extraRoomNames = [],
		blockSelections = [],
		onSave,
		onBlockSave,
		onDelete,
		onClose,
	}: Props = $props();

	// ── Helpers ─────────────────────────────────────────────────────────
	function calcEndTime(start: string, dur: number): string {
		if (!start) return '';
		const [h, m] = start.split(':').map(Number);
		const total = h * 60 + m + dur;
		return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	}

	function calcDuration(start: string, end: string): number {
		if (!start || !end) return 30;
		const [sh, sm] = start.split(':').map(Number);
		const [eh, em] = end.split(':').map(Number);
		const diff = (eh * 60 + em) - (sh * 60 + sm);
		return diff > 0 ? diff : 30;
	}

	// ── Form state ───────────────────────────────────────────────────────
	let patientId      = $state(appointment?.patient_id ?? prefillPatientId ?? '');
	let patientDisplay = $state(
		appointment ? `${appointment.patient_lastname ?? ''}, ${appointment.patient_firstname ?? ''}` : '',
	);
	let roomId     = $state(appointment?.room_id ?? prefillRoomId ?? '');
	let typeId     = $state(appointment?.type_id ?? '');
	let doctorId   = $state(appointment?.doctor_id ?? '');
	let apptDate   = $state(appointment?.start_time?.slice(0, 10) ?? date);
	let startTime  = $state(appointment?.start_time?.slice(11, 16) ?? prefillTime ?? '');

	// durationMin: init from drag span if available, else from existing appt, else 30
	let durationMin = $state(
		appointment?.duration_min
			?? (prefillEndTime && prefillTime ? calcDuration(prefillTime, prefillEndTime) : 30)
	);
	let endTime = $state(
		appointment?.end_time?.slice(11, 16)
			|| prefillEndTime
			|| calcEndTime(startTime, durationMin)
	);

	// True when the time range came from an explicit drag — type selection must NOT
	// override the end time the user deliberately dragged to.
	const isDragSelection = prefillEndTime !== '';

	// ── Tab mode (appointment vs block-time) ────────────────────────────
	// Tabs are only shown on drag-create (blockSelections populated).
	const showTabs = $derived(blockSelections.length > 0 && !appointment);
	let mode = $state<'appointment' | 'block'>('appointment');

	// Block form state (used when mode === 'block')
	let blockTitle   = $state('');
	let blockDoctorId = $state('');
	let blockColor   = $state('#94a3b8');
	let blockNotes   = $state('');
	const PRESET_COLORS = ['#94a3b8', '#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899'];

	function handleBlockSave() {
		if (!blockTitle.trim() || !blockSelections.length) return;
		const blocks: ScheduleBlockFormData[] = blockSelections.flatMap((sel) =>
			sel.roomIds.map((rid) => ({
				room_id: rid,
				doctor_id: blockDoctorId,
				title: blockTitle.trim(),
				start_time: `${date}T${sel.startTime}:00`,
				end_time: `${date}T${sel.endTime}:00`,
				color: blockColor,
				notes: blockNotes,
			}))
		);
		onBlockSave?.(blocks);
		onClose?.();
	}

	let title  = $state(appointment?.title ?? '');
	let notes  = $state(appointment?.notes ?? '');
	let status = $state<AppointmentStatus>(appointment?.status ?? 'scheduled');

	// Computed duration label (kept in sync whenever start or end changes)
	const computedDuration = $derived(() => {
		if (!startTime || !endTime) return '';
		const d = calcDuration(startTime, endTime);
		return d > 0 ? `${d} min` : '';
	});

	// ── Patient search ───────────────────────────────────────────────────
	let patientSearchQuery  = $state(patientDisplay || '');
	let patientResults      = $state<Patient[]>([]);
	let showPatientDropdown = $state(false);
	let highlightedIndex    = $state(-1);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		if (prefillPatientId && !appointment && !patientDisplay) {
			getPatient(prefillPatientId).then((p) => {
				if (p) {
					patientId = p.patient_id;
					patientDisplay = `${p.lastname}, ${p.firstname}`;
					patientSearchQuery = patientDisplay;
				}
			});
		}
	});

	function onPatientInput() {
		if (searchTimeout) clearTimeout(searchTimeout);
		highlightedIndex = -1;
		if (patientSearchQuery.length < 2) { patientResults = []; showPatientDropdown = false; return; }
		searchTimeout = setTimeout(async () => {
			patientResults = await searchPatients(patientSearchQuery);
			showPatientDropdown = patientResults.length > 0;
			highlightedIndex = -1;
		}, 200);
	}

	function selectPatient(p: Patient) {
		patientId = p.patient_id;
		patientDisplay = `${p.lastname}, ${p.firstname}`;
		patientSearchQuery = patientDisplay;
		showPatientDropdown = false;
		patientResults = [];
		highlightedIndex = -1;
	}

	let dropdownEl = $state<HTMLDivElement | null>(null);

	function scrollHighlightedIntoView() {
		setTimeout(() => {
			const el = dropdownEl?.querySelector(`[data-idx="${highlightedIndex}"]`);
			el?.scrollIntoView({ block: 'nearest' });
		}, 0);
	}

	function onPatientKeydown(e: KeyboardEvent) {
		if (!showPatientDropdown || patientResults.length === 0) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			highlightedIndex = Math.min(highlightedIndex + 1, patientResults.length - 1);
			scrollHighlightedIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			highlightedIndex = Math.max(highlightedIndex - 1, 0);
			scrollHighlightedIntoView();
		} else if (e.key === 'Enter' && highlightedIndex >= 0) {
			e.preventDefault();
			selectPatient(patientResults[highlightedIndex]);
		} else if (e.key === 'Escape') {
			showPatientDropdown = false;
			highlightedIndex = -1;
		}
	}

	// ── Time / type handlers ─────────────────────────────────────────────
	function onTypeChange() {
		const t = appointmentTypes.map[typeId];
		if (t && !isDragSelection) {
			// Single-click origin: auto-fill end time from the type's default duration
			durationMin = t.default_duration_min;
			endTime = calcEndTime(startTime, durationMin);
		}
		// Drag origin: type is metadata only — preserve the explicitly selected time range
	}

	function onStartTimeChange() {
		endTime = calcEndTime(startTime, durationMin);
	}

	function onEndTimeChange() {
		durationMin = calcDuration(startTime, endTime);
	}

	// ── Validity & save ──────────────────────────────────────────────────
	const isValid = $derived(patientId && roomId && startTime && endTime && startTime < endTime);

	function handleSave() {
		if (!isValid) return;
		onSave?.({
			patient_id: patientId,
			doctor_id: doctorId,
			room_id: roomId,
			type_id: typeId,
			start_time: `${apptDate}T${startTime}:00`,
			end_time: `${apptDate}T${endTime}:00`,
			duration_min: durationMin,
			title,
			notes,
			status,
		});
	}

	let confirmDelete = $state(false);

	const STATUS_OPTIONS: { value: AppointmentStatus; label: () => string; color: string }[] = [
		{ value: 'scheduled',  label: () => i18n.t.schedule.statuses.scheduled,  color: 'bg-primary text-primary-foreground' },
		{ value: 'completed',  label: () => i18n.t.schedule.statuses.completed,  color: 'bg-green-600 text-white' },
		{ value: 'cancelled',  label: () => i18n.t.schedule.statuses.cancelled,  color: 'bg-destructive text-destructive-foreground' },
		{ value: 'no_show',    label: () => i18n.t.schedule.statuses.no_show,    color: 'bg-orange-500 text-white' },
	];

	const ic = 'border border-border rounded px-2 py-1.5 text-sm bg-background w-full outline-none focus:border-ring focus:ring-1 focus:ring-ring/50';
</script>

<div class="flex flex-col h-full overflow-hidden">
	<!-- Header -->
	<div class="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
		<h3 class="font-semibold text-sm shrink-0">
			{appointment
				? i18n.t.schedule.editAppointment
				: mode === 'block'
					? i18n.t.schedule.blocks.title
					: i18n.t.schedule.bookAppointment}
		</h3>

		{#if showTabs}
			<!-- Appointment / Block-time tab switcher -->
			<div class="flex rounded-md border border-border overflow-hidden ml-2">
				<!-- Appointment tab -->
				<button
					type="button"
					class="px-2.5 py-1.5 transition-colors {mode === 'appointment' ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}"
					onclick={() => (mode = 'appointment')}
					title={i18n.t.schedule.bookAppointment}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5">
						<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
						<line x1="16" y1="2" x2="16" y2="6"/>
						<line x1="8" y1="2" x2="8" y2="6"/>
						<line x1="3" y1="10" x2="21" y2="10"/>
					</svg>
				</button>
				<!-- Block time tab -->
				<button
					type="button"
					class="px-2.5 py-1.5 border-l border-border transition-colors {mode === 'block' ? 'bg-muted text-foreground' : 'bg-background text-muted-foreground hover:bg-muted'}"
					onclick={() => (mode = 'block')}
					title={i18n.t.schedule.dragCreate.blockTime}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-3.5 h-3.5">
						<circle cx="12" cy="12" r="10"/>
						<line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
					</svg>
				</button>
			</div>
		{/if}

		{#if onClose}
			<button
				class="text-muted-foreground hover:text-foreground transition-colors p-1 rounded ml-auto"
				onclick={onClose}
				aria-label="Close"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-4 h-4">
					<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
				</svg>
			</button>
		{/if}
	</div>

	<!-- Form body — no overflow-y-auto, everything fits -->
	<div class="flex flex-col gap-3 p-4">

	{#if mode === 'block'}
		<!-- ── Block-time form ───────────────────────────── -->
		{#if blockSelections.length > 0}
			<div class="rounded bg-muted/40 border border-border/60 px-3 py-2 text-xs text-muted-foreground">
				{blockSelections[0].startTime} – {blockSelections[0].endTime}
				{#if blockSelections[0].roomIds.length > 1 || blockSelections.length > 1}
					<span class="ml-1 font-medium text-foreground/70">
						({blockSelections.reduce((n, s) => n + s.roomIds.length, 0)} {i18n.t.schedule.room.toLowerCase()}s)
					</span>
				{/if}
			</div>
		{/if}

		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.blocks.blockTitle}</label>
			<input
				type="text"
				class={ic}
				bind:value={blockTitle}
				onkeydown={(e) => e.key === 'Enter' && handleBlockSave()}
				autofocus
			/>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.doctor} <span class="text-muted-foreground/60">({i18n.t.schedule.optional})</span></label>
			<select class={ic} bind:value={blockDoctorId}>
				<option value="">—</option>
				{#each doctors.list as d}
					<option value={d.id}>{d.name}</option>
				{/each}
			</select>
		</div>

		<div class="flex flex-col gap-1">
			<div class="flex gap-2 flex-wrap">
				{#each PRESET_COLORS as c}
					<button
						type="button"
						class="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
						style="background-color: {c}; border-color: {blockColor === c ? 'hsl(var(--foreground))' : 'transparent'};"
						onclick={() => (blockColor = c)}
						aria-label={c}
					></button>
				{/each}
			</div>
		</div>

		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.notes} <span class="text-muted-foreground/60">({i18n.t.schedule.optional})</span></label>
			<input type="text" class={ic} bind:value={blockNotes} />
		</div>
	{:else}
		<!-- ── Appointment form ─────────────────────────── -->

		<!-- Patient (full width — needs room for dropdown) -->
		<div class="flex flex-col gap-1 relative">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.patient}</label>
			<input
				type="text"
				class={ic}
				placeholder={i18n.t.schedule.searchPatients}
				bind:value={patientSearchQuery}
				oninput={onPatientInput}
				onkeydown={onPatientKeydown}
				onfocus={() => { if (patientResults.length > 0) showPatientDropdown = true; }}
				onblur={() => setTimeout(() => { showPatientDropdown = false; highlightedIndex = -1; }, 150)}
				autocomplete="off"
			/>
			{#if showPatientDropdown}
				<div
					bind:this={dropdownEl}
					class="absolute top-full left-0 right-0 z-50 bg-popover border border-border rounded shadow-md mt-1 max-h-44 overflow-y-auto"
				>
					{#each patientResults as p, i}
						<button
							data-idx={i}
							class="w-full text-left px-3 py-2 text-sm transition-colors {i === highlightedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'}"
							onmousedown={() => selectPatient(p)}
							onmouseenter={() => (highlightedIndex = i)}
						>
							{p.lastname}, {p.firstname}
							{#if p.dob}<span class="text-muted-foreground text-xs ml-1">({p.dob.slice(0, 10)})</span>{/if}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Row: Room | Appointment Type -->
		<div class="grid grid-cols-2 gap-3">
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.room}</label>
				<select class={ic} bind:value={roomId}>
					<option value="">—</option>
					{#each rooms.active as room}
						<option value={room.id}>{room.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.type}</label>
				<select class={ic} bind:value={typeId} onchange={onTypeChange}>
					<option value="">— {i18n.t.schedule.optional} —</option>
					{#each appointmentTypes.active as t}
						<option value={t.id}>{t.name} ({t.default_duration_min} {i18n.t.schedule.durationMin})</option>
					{/each}
				</select>
			</div>
		</div>

		<!-- Row: Doctor | Date -->
		<div class="grid grid-cols-2 gap-3">
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.doctor} <span class="text-muted-foreground/60">({i18n.t.schedule.optional})</span></label>
				<select class={ic} bind:value={doctorId}>
					<option value="">—</option>
					{#each doctors.list as d}
						<option value={d.id}>{d.name}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.common.date}</label>
				<input type="date" class={ic} bind:value={apptDate} />
			</div>
		</div>

		<!-- Row: Start time | End time + computed duration badge -->
		<div class="grid grid-cols-2 gap-3">
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.startTime}</label>
				<input type="time" step="300" class={ic} bind:value={startTime} onchange={onStartTimeChange} />
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground flex items-center gap-2">
					{i18n.t.schedule.endTime}
					{#if computedDuration()}
						<span class="font-normal text-muted-foreground/70">= {computedDuration()}</span>
					{/if}
				</label>
				<input type="time" step="300" class={ic} bind:value={endTime} onchange={onEndTimeChange} />
			</div>
		</div>

		<!-- Title (full width, single line) -->
		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.titleLabel} <span class="text-muted-foreground/60">({i18n.t.schedule.optional})</span></label>
			<input type="text" class={ic} bind:value={title} />
		</div>

		<!-- Notes (2 rows) -->
		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.notes} <span class="text-muted-foreground/60">({i18n.t.schedule.optional})</span></label>
			<textarea class={ic} rows={2} bind:value={notes}></textarea>
		</div>

		<!-- Status — compact pill row, edit mode only -->
		{#if appointment}
			<div class="flex flex-col gap-1.5">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.status}</label>
				<div class="flex gap-1.5 flex-wrap">
					{#each STATUS_OPTIONS as opt}
						<button
							type="button"
							class="px-2.5 py-1 rounded text-xs font-medium border transition-colors {status === opt.value
								? opt.color + ' border-transparent'
								: 'bg-background border-border text-muted-foreground hover:bg-muted'}"
							onclick={() => (status = opt.value)}
						>
							{opt.label()}
						</button>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Multi-chair indicator -->
		{#if extraRoomNames.length > 0}
			<div class="rounded bg-primary/10 border border-primary/20 px-3 py-1.5 text-xs text-primary">
				📋 {i18n.t.schedule.optional !== '' ? 'Also books:' : 'Also books:'} {extraRoomNames.join(', ')}
			</div>
		{/if}

	{/if}
	<!-- end mode conditional -->
	</div>

	<!-- Actions — pinned to bottom -->
	<div class="mt-auto px-4 pb-4 pt-2 border-t border-border flex gap-2">
		{#if mode === 'block'}
			<div class="ml-auto flex gap-2">
				{#if onClose}
					<button
						class="rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
						onclick={onClose}
					>
						{i18n.t.actions.cancel}
					</button>
				{/if}
				<button
					class="rounded px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
					disabled={!blockTitle.trim()}
					onclick={handleBlockSave}
				>
					{i18n.t.actions.save}
				</button>
			</div>
		{:else}
			{#if appointment && onDelete}
				{#if !confirmDelete}
					<button
						class="rounded px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
						onclick={() => (confirmDelete = true)}
					>
						{i18n.t.schedule.deleteAppointment}
					</button>
				{:else}
					<button
						class="rounded px-3 py-2 text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
						onclick={onDelete}
					>
						{i18n.t.schedule.confirmDelete}
					</button>
					<button
						class="rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
						onclick={() => (confirmDelete = false)}
					>
						{i18n.t.actions.cancel}
					</button>
				{/if}
			{/if}
			<div class="ml-auto flex gap-2">
				{#if onClose && !confirmDelete}
					<button
						class="rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
						onclick={onClose}
					>
						{i18n.t.actions.cancel}
					</button>
				{/if}
				<button
					class="rounded px-4 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
					disabled={!isValid}
					onclick={handleSave}
				>
					{i18n.t.actions.save}{extraRoomNames.length > 0 ? ` (${extraRoomNames.length + 1})` : ''}
				</button>
			</div>
		{/if}
	</div>
</div>
