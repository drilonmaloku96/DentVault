<script lang="ts">
	import { i18n } from '$lib/i18n';
	import type { Appointment, AppointmentFormData, AppointmentStatus, Patient } from '$lib/types';
	import { rooms } from '$lib/stores/rooms.svelte';
	import { appointmentTypes } from '$lib/stores/appointmentTypes.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { searchPatients, getPatient } from '$lib/services/db';

	interface Props {
		appointment?: Appointment | null;
		prefillRoomId?: string;
		prefillTime?: string;
		prefillPatientId?: string;
		date?: string;
		extraRoomNames?: string[]; // additional rooms that will be booked on save
		onSave?: (data: AppointmentFormData & { patient_id: string }) => void;
		onDelete?: () => void;
		onClose?: () => void;
	}

	let {
		appointment = null,
		prefillRoomId = '',
		prefillTime = '',
		prefillPatientId = '',
		date = new Date().toISOString().slice(0, 10),
		extraRoomNames = [],
		onSave,
		onDelete,
		onClose,
	}: Props = $props();

	// Form state
	let patientId = $state(appointment?.patient_id ?? prefillPatientId ?? '');
	let patientDisplay = $state(
		appointment
			? `${appointment.patient_lastname ?? ''}, ${appointment.patient_firstname ?? ''}`
			: '',
	);
	let roomId = $state(appointment?.room_id ?? prefillRoomId ?? '');
	let typeId = $state(appointment?.type_id ?? '');
	let doctorId = $state(appointment?.doctor_id ?? '');
	let apptDate = $state(appointment?.start_time?.slice(0, 10) ?? date);
	let startTime = $state(appointment?.start_time?.slice(11, 16) ?? prefillTime ?? '');
	let durationMin = $state(appointment?.duration_min ?? 30);
	// Auto-calculate endTime from startTime + durationMin when no existing end time
	function calcEndTime(start: string, dur: number): string {
		if (!start) return '';
		const [h, m] = start.split(':').map(Number);
		const total = h * 60 + m + dur;
		return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
	}
	let endTime = $state(appointment?.end_time?.slice(11, 16) ?? calcEndTime(startTime, durationMin));
	let title = $state(appointment?.title ?? '');
	let notes = $state(appointment?.notes ?? '');
	let status = $state<AppointmentStatus>(appointment?.status ?? 'scheduled');

	// Patient search
	let patientSearchQuery = $state(patientDisplay || '');
	let patientResults = $state<Patient[]>([]);
	let showPatientDropdown = $state(false);
	let highlightedIndex = $state(-1);
	let searchTimeout: ReturnType<typeof setTimeout> | null = null;

	// If prefillPatientId provided but no display name, load patient
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
		if (patientSearchQuery.length < 2) {
			patientResults = [];
			showPatientDropdown = false;
			return;
		}
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

	let dropdownEl = $state<HTMLDivElement | null>(null);

	function scrollHighlightedIntoView() {
		// Run after DOM updates
		setTimeout(() => {
			const el = dropdownEl?.querySelector(`[data-idx="${highlightedIndex}"]`);
			el?.scrollIntoView({ block: 'nearest' });
		}, 0);
	}

	// Auto-fill duration + end time when type changes
	function onTypeChange() {
		const t = appointmentTypes.map[typeId];
		if (t) {
			durationMin = t.default_duration_min;
			endTime = calcEndTime(startTime, durationMin);
		}
	}

	function onStartTimeChange() {
		endTime = calcEndTime(startTime, durationMin);
	}

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

	const inputClass = 'border border-border rounded px-2 py-1.5 text-sm bg-background w-full outline-none focus:border-ring focus:ring-1 focus:ring-ring/50';
</script>

<div class="flex flex-col gap-4 p-4 overflow-y-auto h-full">
	<h3 class="font-semibold text-base">
		{appointment ? i18n.t.schedule.editAppointment : i18n.t.schedule.bookAppointment}
	</h3>

	<!-- Patient -->
	<div class="flex flex-col gap-1 relative">
		<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.patient}</label>
		<input
			type="text"
			class={inputClass}
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
				class="absolute top-full left-0 right-0 z-50 bg-popover border border-border rounded shadow-md mt-1 max-h-48 overflow-y-auto"
			>
				{#each patientResults as p, i}
					<button
						data-idx={i}
						class="w-full text-left px-3 py-2 text-sm transition-colors {i === highlightedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'}"
						onmousedown={() => selectPatient(p)}
						onmouseenter={() => (highlightedIndex = i)}
					>
						{p.lastname}, {p.firstname}
						{#if p.dob}
							<span class="text-muted-foreground text-xs ml-1">({p.dob.slice(0, 10)})</span>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Room -->
	<div class="flex flex-col gap-1">
		<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.room}</label>
		<select class={inputClass} bind:value={roomId}>
			<option value="">—</option>
			{#each rooms.active as room}
				<option value={room.id}>{room.name}</option>
			{/each}
		</select>
	</div>

	<!-- Type -->
	<div class="flex flex-col gap-1">
		<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.type}</label>
		<select class={inputClass} bind:value={typeId} onchange={onTypeChange}>
			<option value="">— {i18n.t.schedule.optional} —</option>
			{#each appointmentTypes.active as t}
				<option value={t.id}>{t.name} ({t.default_duration_min} {i18n.t.schedule.durationMin})</option>
			{/each}
		</select>
	</div>

	<!-- Doctor -->
	<div class="flex flex-col gap-1">
		<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.doctor} ({i18n.t.schedule.optional})</label>
		<select class={inputClass} bind:value={doctorId}>
			<option value="">—</option>
			{#each doctors.list as d}
				<option value={d.id}>{d.name}</option>
			{/each}
		</select>
	</div>

	<!-- Date -->
	<div class="flex flex-col gap-1">
		<label class="text-xs font-medium text-muted-foreground">{i18n.t.common.date}</label>
		<input type="date" class={inputClass} bind:value={apptDate} />
	</div>

	<!-- Start / End time -->
	<div class="grid grid-cols-2 gap-2">
		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.startTime}</label>
			<input type="time" step="300" class={inputClass} bind:value={startTime} onchange={onStartTimeChange} />
		</div>
		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.endTime}</label>
			<input type="time" step="300" class={inputClass} bind:value={endTime} />
		</div>
	</div>

	<!-- Duration -->
	<div class="flex flex-col gap-1">
		<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.duration} ({i18n.t.schedule.durationMin})</label>
		<input type="number" min="5" step="5" class={inputClass} bind:value={durationMin} />
	</div>

	<!-- Title -->
	<div class="flex flex-col gap-1">
		<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.titleLabel}</label>
		<input type="text" class={inputClass} bind:value={title} />
	</div>

	<!-- Notes -->
	<div class="flex flex-col gap-1">
		<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.notes}</label>
		<textarea class={inputClass} rows="3" bind:value={notes}></textarea>
	</div>

	<!-- Status (edit only) -->
	{#if appointment}
		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.status}</label>
			<select class={inputClass} bind:value={status}>
				<option value="scheduled">{i18n.t.schedule.statuses.scheduled}</option>
				<option value="completed">{i18n.t.schedule.statuses.completed}</option>
				<option value="cancelled">{i18n.t.schedule.statuses.cancelled}</option>
				<option value="no_show">{i18n.t.schedule.statuses.no_show}</option>
			</select>
		</div>
	{/if}

	<!-- Multi-chair indicator -->
	{#if extraRoomNames.length > 0}
		<div class="rounded-md bg-primary/10 border border-primary/20 px-3 py-2 text-xs text-primary mt-1">
			📋 Also books in: {extraRoomNames.join(', ')}
		</div>
	{/if}

	<!-- Actions -->
	<div class="flex flex-col gap-2 mt-2">
		<button
			class="w-full rounded px-3 py-2 text-sm font-medium bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
			disabled={!isValid}
			onclick={handleSave}
		>
			{i18n.t.actions.save}{extraRoomNames.length > 0 ? ` (${extraRoomNames.length + 1} chairs)` : ''}
		</button>
		{#if onClose}
			<button
				class="w-full rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
				onclick={onClose}
			>
				{i18n.t.actions.cancel}
			</button>
		{/if}
		{#if appointment && onDelete}
			{#if !confirmDelete}
				<button
					class="w-full rounded px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
					onclick={() => (confirmDelete = true)}
				>
					{i18n.t.schedule.deleteAppointment}
				</button>
			{:else}
				<div class="flex gap-2">
					<button
						class="flex-1 rounded px-3 py-2 text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
						onclick={onDelete}
					>
						{i18n.t.schedule.confirmDelete}
					</button>
					<button
						class="flex-1 rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
						onclick={() => (confirmDelete = false)}
					>
						{i18n.t.actions.cancel}
					</button>
				</div>
			{/if}
		{/if}
	</div>
</div>
