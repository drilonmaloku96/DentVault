<script lang="ts">
	import { slide } from 'svelte/transition';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getPatient, updatePatient, deletePatient, getDocuments } from '$lib/services/db';
	import { patientBus } from '$lib/stores/patientBus.svelte';
	import type { Patient, PatientStatus } from '$lib/types';
	import { listVaultFiles, type VaultFileInfo } from '$lib/services/files';
	import { Button } from '$lib/components/ui/button';
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '$lib/components/ui/dialog';
	import TimelineView from '$lib/components/timeline/TimelineView.svelte';
	import PatientNotesBox from '$lib/components/patient/PatientNotesBox.svelte';
	import MedicalHistoryBox from '$lib/components/patient/MedicalHistoryBox.svelte';
	import AcuteProblemsBox from '$lib/components/patient/AcuteProblemsBox.svelte';
	import NewFilesDialog from '$lib/components/documents/NewFilesDialog.svelte';
	import AuditLogDialog from '$lib/components/audit/AuditLogDialog.svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { i18n } from '$lib/i18n';

	const patientId = $derived(page.params.patient_id ?? '');

	let patient   = $state<Patient | null>(null);
	let isLoading = $state(true);
	let notFound  = $state(false);
	let showInfo  = $state(false);

	// Contextual panel toggles
	let showAcute   = $state(false);
	let showNotes   = $state(false);
	let showMedical = $state(false);

	// Acute content preview (populated by AcuteProblemsBox via callback)
	let acuteContent = $state('');

	// New-file detection
	let pendingFiles       = $state<VaultFileInfo[]>([]);
	let showNewFilesDialog = $state(false);

	// Status
	let statusSaving = $state(false);

	// Delete dialog
	let showDeleteDialog = $state(false);
	let isDeleting       = $state(false);

	// Three-dot menu
	let showActionsMenu  = $state(false);

	// Audit log dialog
	let showAuditDialog  = $state(false);

	$effect(() => { loadPatient(); });

	async function loadPatient() {
		isLoading = true;
		const result = await getPatient(patientId);
		if (!result) { notFound = true; }
		else {
			patient = result;
			// Detect externally-added vault files after a short tick so the UI renders first
			setTimeout(() => checkNewVaultFiles(), 300);
		}
		isLoading = false;
	}

	async function checkNewVaultFiles() {
		if (!vault.path || !patient) return;
		try {
			const folder = vault.patientFolder(patient.lastname, patient.firstname, patient.patient_id);
			const [onDisk, inDb] = await Promise.all([
				listVaultFiles(vault.path, folder),
				getDocuments(patient.patient_id),
			]);
			const registered = new Set(inDb.map(d => d.rel_path || d.abs_path));
			pendingFiles = onDisk.filter(f => !registered.has(f.rel_path));
			if (pendingFiles.length > 0) showNewFilesDialog = true;
		} catch {
			// Vault not configured or folder doesn't exist yet — silently ignore
		}
	}

	async function handleStatusChange(e: Event) {
		if (!patient) return;
		const newStatus = (e.target as HTMLSelectElement).value as PatientStatus;
		statusSaving = true;
		await updatePatient(patient.patient_id, { status: newStatus });
		patient = { ...patient, status: newStatus };
		statusSaving = false;
		patientBus.invalidate();
	}

	async function handleDelete() {
		if (!patient) return;
		isDeleting = true;
		await deletePatient(patient.patient_id);
		patientBus.invalidate();
		goto('/patients');
	}

	function formatDate(val: string): string {
		if (!val) return '—';
		const d = new Date(val);
		return isNaN(d.getTime()) ? val : d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
	}

	function formatDateShort(val: string): string {
		if (!val) return '—';
		const d = new Date(val);
		return isNaN(d.getTime()) ? val : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function formatGender(val: string): string {
		const map: Record<string, string> = {
			male: 'Male', female: 'Female', other: 'Other', prefer_not_to_say: 'Prefer not to say',
		};
		return map[val] ?? val ?? '—';
	}

	const statusConfig = $derived<Record<PatientStatus, { label: string; class: string }>>({
		active:   { label: i18n.t.patients.status.active,   class: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400' },
		inactive: { label: i18n.t.patients.status.inactive, class: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400' },
		archived: { label: i18n.t.patients.status.archived, class: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400' },
		deceased: { label: i18n.t.patients.status.deceased, class: 'bg-zinc-800 text-zinc-200 border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300' },
	});

	const selectClass =
		'border-input bg-background flex h-9 rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50';

	const infoRowClass   = 'flex flex-col gap-0.5';
	const infoLabelClass = 'text-xs font-medium text-muted-foreground uppercase tracking-wide';
	const infoValueClass = 'text-sm text-foreground';
</script>

<!-- Loading -->
{#if isLoading}
	<div class="flex h-48 items-center justify-center">
		<svg class="h-6 w-6 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
			<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
			<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
		</svg>
	</div>

<!-- Not found -->
{:else if notFound || !patient}
	<div class="flex flex-col items-center justify-center gap-4 py-16">
		<p class="text-lg font-medium text-muted-foreground">Patient not found</p>
		<Button href="/patients" variant="outline">← {i18n.t.nav.patients}</Button>
	</div>

<!-- Patient detail -->
{:else}
	<div class="flex flex-col gap-0">

		<!-- ── Sticky patient header (breadcrumb + patient row) ─────── -->
		<div class="sticky top-0 z-20 bg-background pb-3 border-b border-border/40 shadow-[0_2px_8px_-2px_hsl(var(--foreground)/0.06)]">

		<!-- ── Breadcrumb + Actions ─────────────────────────────────── -->
		<div class="flex items-start justify-between gap-4 mb-4">
			<nav class="flex items-center gap-2 text-sm text-muted-foreground">
				<a href="/patients" class="hover:text-foreground transition-colors">{i18n.t.nav.patients}</a>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
					<path d="M9 18l6-6-6-6"/>
				</svg>
				<span class="text-foreground font-medium">{patient.lastname}, {patient.firstname}</span>
			</nav>

			<div class="flex items-center gap-2 shrink-0">
				<select class={selectClass} value={patient.status} onchange={handleStatusChange} disabled={statusSaving}>
					<option value="active">{i18n.t.patients.status.active}</option>
					<option value="inactive">{i18n.t.patients.status.inactive}</option>
					<option value="archived">{i18n.t.patients.status.archived}</option>
					<option value="deceased">{i18n.t.patients.status.deceased}</option>
				</select>
				<Button href="/patients/{patient.patient_id}/edit" variant="outline" size="sm">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
						<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
					</svg>
					{i18n.t.actions.edit}
				</Button>
				<Button variant="destructive" size="sm" onclick={() => (showDeleteDialog = true)}>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
						<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
					</svg>
					{i18n.t.actions.delete}
				</Button>

				<!-- Three-dot menu -->
				<div class="relative">
					<button
						type="button"
						onclick={() => (showActionsMenu = !showActionsMenu)}
						class="flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
						title="More actions"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
							<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
						</svg>
					</button>
					{#if showActionsMenu}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div
							class="absolute right-0 top-full mt-1 z-50 min-w-[160px] rounded-lg border bg-popover shadow-lg py-1"
							onmouseleave={() => (showActionsMenu = false)}
						>
							<button
								type="button"
								onclick={() => { showAuditDialog = true; showActionsMenu = false; }}
								class="flex w-full items-center gap-2.5 px-3 py-2 text-sm hover:bg-muted transition-colors text-left"
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-muted-foreground shrink-0">
									<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
								</svg>
								{i18n.t.audit.title}
							</button>
						</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- ── Patient header row ──────────────────────────────────── -->
		<div class="flex items-center gap-2 w-full">

			<!-- Info toggle: avatar + name + chevron (flex-1) -->
			<button
				type="button"
				onclick={() => (showInfo = !showInfo)}
				class="flex items-center gap-4 flex-1 min-w-0 text-left rounded-lg px-3 py-2.5 hover:bg-muted/50 transition-colors group"
				aria-expanded={showInfo}
				aria-controls="patient-info-panel"
			>
				<!-- Avatar -->
				<div class="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-xl shrink-0 transition-colors group-hover:bg-primary/15">
					{patient.firstname[0]?.toUpperCase()}{patient.lastname[0]?.toUpperCase()}
				</div>
				<!-- Name + quick facts -->
				<div class="flex-1 min-w-0">
					<div class="flex items-center gap-2">
						<h1 class="text-2xl font-bold tracking-tight truncate">
							{patient.firstname} {patient.lastname}
						</h1>
						{#if patient.status !== 'active'}
							<span class={`rounded-full border px-2 py-0.5 text-xs font-medium shrink-0 ${statusConfig[patient.status]?.class ?? ''}`}>
								{statusConfig[patient.status]?.label ?? patient.status}
							</span>
						{/if}
					</div>
					<!-- Compact always-visible info row -->
					<div class="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground flex-wrap">
						<span class="font-mono text-xs">{patient.patient_id}</span>
						{#if patient.dob}
							<span class="flex items-center gap-1">
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0">
									<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
								</svg>
								{formatDateShort(patient.dob)}
							</span>
						{/if}
						{#if patient.phone}
							<span class="flex items-center gap-1">
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0">
									<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.67A2 2 0 012 1.11h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.91a16 16 0 006.18 6.18l1.17-1.17a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7a2 2 0 011.72 2.01z"/>
								</svg>
								{patient.phone}
							</span>
						{/if}
						{#if patient.next_appointment}
							<span class="flex items-center gap-1">
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0">
									<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
								</svg>
								Next: {formatDateShort(patient.next_appointment)}
							</span>
						{/if}
					</div>
				</div>
				<!-- Chevron -->
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					class={['h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200', showInfo ? 'rotate-180' : ''].join(' ')}
				>
					<polyline points="6 9 12 15 18 9"/>
				</svg>
			</button>

			<!-- ── Three icon buttons ──────────────────────────────── -->
			<div class="flex items-center gap-0.5 shrink-0 pr-1">

				<!-- Emergencies: red alert — shows content preview when content exists -->
				<button
					type="button"
					onclick={() => (showAcute = !showAcute)}
					title="Akute Probleme"
					aria-label="Toggle emergencies panel"
					aria-pressed={showAcute}
					class={[
						'flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors max-w-[200px]',
						showAcute || acuteContent.trim()
							? 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400'
							: 'text-red-400/70 hover:bg-red-50 hover:text-red-600 dark:text-red-700 dark:hover:text-red-400',
					].join(' ')}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0">
						<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
						<line x1="12" y1="9" x2="12" y2="13"/>
						<line x1="12" y1="17" x2="12.01" y2="17"/>
					</svg>
					{#if acuteContent.trim() && !showAcute}
						<span class="text-[11px] font-medium leading-tight truncate">
							{acuteContent.trim().slice(0, 40)}{acuteContent.trim().length > 40 ? '…' : ''}
						</span>
					{/if}
				</button>

				<!-- Medical History: amber clipboard — always amber -->
				<button
					type="button"
					onclick={() => (showMedical = !showMedical)}
					title="Medical History"
					aria-label="Toggle medical history panel"
					aria-pressed={showMedical}
					class={[
						'rounded-md p-2 transition-colors',
						showMedical
							? 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
							: 'text-amber-400/70 hover:bg-amber-50 hover:text-amber-600 dark:text-amber-700 dark:hover:text-amber-400',
					].join(' ')}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
						<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
						<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
						<line x1="8" y1="12" x2="16" y2="12"/>
						<line x1="8" y1="16" x2="16" y2="16"/>
					</svg>
				</button>

				<!-- Misc Notes: violet pencil — always violet, no document lines -->
				<button
					type="button"
					onclick={() => (showNotes = !showNotes)}
					title="Notes"
					aria-label="Toggle notes panel"
					aria-pressed={showNotes}
					class={[
						'rounded-md p-2 transition-colors',
						showNotes
							? 'bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400'
							: 'text-violet-400/70 hover:bg-violet-50 hover:text-violet-600 dark:text-violet-700 dark:hover:text-violet-400',
					].join(' ')}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
						<path d="M12 20h9"/>
						<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
					</svg>
				</button>

			</div>
		</div>

		</div><!-- /sticky patient header -->

		<!-- ── Expandable patient info panel ──────────────────────── -->
		{#if showInfo}
			<div id="patient-info-panel" transition:slide={{ duration: 180 }} class="mt-3 mb-4">
				<div class="flex flex-col gap-3 pt-3 pb-1">
					<!-- Row 1: Personal + Contact -->
					<div class="grid gap-3 md:grid-cols-2">
						<!-- Personal -->
						<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
							<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{i18n.t.patients.formSections.personal}</h3>
							<div class="grid grid-cols-2 gap-3">
								<div class={infoRowClass}><span class={infoLabelClass}>{i18n.t.patients.fields.firstName}</span><span class={infoValueClass}>{patient.firstname || '—'}</span></div>
								<div class={infoRowClass}><span class={infoLabelClass}>{i18n.t.patients.fields.lastName}</span><span class={infoValueClass}>{patient.lastname || '—'}</span></div>
								<div class={infoRowClass}><span class={infoLabelClass}>{i18n.t.patients.fields.dob}</span><span class={infoValueClass}>{formatDate(patient.dob)}</span></div>
								<div class={infoRowClass}><span class={infoLabelClass}>{i18n.t.patients.fields.gender}</span><span class={infoValueClass}>{formatGender(patient.gender)}</span></div>
								<div class={infoRowClass}><span class={infoLabelClass}>{i18n.t.patients.fields.maritalStatus}</span><span class={infoValueClass}>{patient.marital_status || '—'}</span></div>
								<div class={infoRowClass}><span class={infoLabelClass}>{i18n.t.patients.fields.bloodGroup}</span><span class={infoValueClass}>{patient.blood_group || '—'}</span></div>
							</div>
						</div>
						<!-- Contact -->
						<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
							<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{i18n.t.patients.formSections.contact}</h3>
							<div class="flex flex-col gap-2">
								<div class={infoRowClass}>
									<span class={infoLabelClass}>{i18n.t.patients.fields.phone}</span>
									{#if patient.phone}<a href="tel:{patient.phone}" class="text-sm text-primary hover:underline">{patient.phone}</a>{:else}<span class={infoValueClass}>—</span>{/if}
								</div>
								<div class={infoRowClass}>
									<span class={infoLabelClass}>{i18n.t.patients.fields.email}</span>
									{#if patient.email}<a href="mailto:{patient.email}" class="text-sm text-primary hover:underline">{patient.email}</a>{:else}<span class={infoValueClass}>—</span>{/if}
								</div>
								{#if patient.address || patient.city || patient.postal_code || patient.country}
									<div class={infoRowClass}>
										<span class={infoLabelClass}>{i18n.t.patients.formSections.address}</span>
										<span class={infoValueClass}>
											{[patient.address, [patient.postal_code, patient.city].filter(Boolean).join(' '), patient.country].filter(Boolean).join(', ') || '—'}
										</span>
									</div>
								{/if}
							</div>
						</div>
					</div>

					<!-- Row 2: Emergency Contact + Insurance -->
					<div class="grid gap-3 md:grid-cols-2">
						<!-- Emergency Contact -->
						<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
							<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{i18n.t.patients.formSections.emergencyContact}</h3>
							<div class="flex flex-col gap-2">
								<div class={infoRowClass}>
									<span class={infoLabelClass}>{i18n.t.patients.fields.emergencyContactName}</span>
									<span class={infoValueClass}>{patient.emergency_contact_name || '—'}</span>
								</div>
								<div class={infoRowClass}>
									<span class={infoLabelClass}>{i18n.t.patients.fields.emergencyContactRelation}</span>
									<span class={infoValueClass}>{patient.emergency_contact_relation || '—'}</span>
								</div>
								<div class={infoRowClass}>
									<span class={infoLabelClass}>{i18n.t.patients.fields.emergencyContactPhone}</span>
									{#if patient.emergency_contact_phone}<a href="tel:{patient.emergency_contact_phone}" class="text-sm text-primary hover:underline">{patient.emergency_contact_phone}</a>{:else}<span class={infoValueClass}>—</span>{/if}
								</div>
							</div>
						</div>
						<!-- Insurance + Clinical -->
						<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
							<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{i18n.t.patients.formSections.insurance}</h3>
							<div class="grid grid-cols-2 gap-3">
								<div class={infoRowClass}><span class={infoLabelClass}>Provider</span><span class={infoValueClass}>{patient.insurance_provider || '—'}</span></div>
								<div class={infoRowClass}><span class={infoLabelClass}>Policy ID</span><span class={infoValueClass}>{patient.insurance_id || '—'}</span></div>
							</div>
							{#if patient.primary_physician}
								<div class={infoRowClass}>
									<span class={infoLabelClass}>{i18n.t.patients.fields.primaryPhysician}</span>
									<span class={infoValueClass}>{patient.primary_physician}</span>
								</div>
							{/if}
							{#if patient.next_appointment}
								<div class={infoRowClass}>
									<span class={infoLabelClass}>Next Appointment</span>
									<span class={infoValueClass}>{formatDate(patient.next_appointment)}</span>
								</div>
							{/if}
						</div>
					</div>

					<!-- Row 3: Demographics (compact) - only show if any values exist -->
					{#if patient.referral_source || patient.smoking_status || patient.occupation}
						<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
							<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{i18n.t.patients.formSections.demographics}</h3>
							<div class="grid grid-cols-3 gap-3">
								{#if patient.referral_source}<div class={infoRowClass}><span class={infoLabelClass}>{i18n.t.patients.fields.referralSource}</span><span class={infoValueClass}>{patient.referral_source}</span></div>{/if}
								{#if patient.smoking_status}<div class={infoRowClass}><span class={infoLabelClass}>{i18n.t.patients.fields.smokingStatus}</span><span class={infoValueClass}>{patient.smoking_status}</span></div>{/if}
								{#if patient.occupation}<div class={infoRowClass}><span class={infoLabelClass}>{i18n.t.patients.fields.occupation}</span><span class={infoValueClass}>{patient.occupation}</span></div>{/if}
							</div>
						</div>
					{/if}

					<!-- Dates row -->
					<div class="flex items-center gap-4 px-1 text-xs text-muted-foreground/60">
						<span>ID: <span class="font-mono">{patient.patient_id}</span></span>
						<span>Created: {formatDateShort(patient.created_at)}</span>
						<span>Updated: {formatDateShort(patient.updated_at)}</span>
					</div>
				</div>
			</div>
		{/if}

		<!-- ── Contextual panels (slide in when icon toggled) ──────── -->
		{#if showAcute || showNotes || showMedical}
			<div class="flex flex-col gap-2 mt-3 mb-4">
				{#if showAcute}
					<div transition:slide={{ duration: 150 }}>
						<AcuteProblemsBox
							patientId={patient.patient_id}
							onContentChange={(v) => (acuteContent = v)}
						/>
					</div>
				{/if}
				{#if showMedical}
					<div transition:slide={{ duration: 150 }}>
						<MedicalHistoryBox patientId={patient.patient_id} />
					</div>
				{/if}
				{#if showNotes}
					<div transition:slide={{ duration: 150 }}>
						<PatientNotesBox patientId={patient.patient_id} />
					</div>
				{/if}
			</div>
		{/if}

		<!-- ── Timeline (primary content) ─────────────────────────── -->
		<TimelineView
			patientId={patient.patient_id}
			patientFolder={vault.patientFolder(patient.lastname, patient.firstname, patient.patient_id)}
		/>

	</div>
{/if}

<!-- New vault files detected dialog -->
{#if showNewFilesDialog && patient}
	<NewFilesDialog
		bind:open={showNewFilesDialog}
		{pendingFiles}
		patientId={patient.patient_id}
		onDone={() => { showNewFilesDialog = false; pendingFiles = []; }}
	/>
{/if}

<!-- Delete confirmation dialog -->
<Dialog bind:open={showDeleteDialog}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>{i18n.t.patients.deletePatient}</DialogTitle>
			<DialogDescription>
				{i18n.t.patients.deleteConfirm} <strong>{patient?.firstname} {patient?.lastname}</strong>.
				{i18n.t.patients.deleteWarning}
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={() => (showDeleteDialog = false)} disabled={isDeleting}>{i18n.t.actions.cancel}</Button>
			<Button variant="destructive" onclick={handleDelete} disabled={isDeleting}>
				{isDeleting ? 'Deleting…' : i18n.t.patients.deletePatient}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- ── Audit log dialog ────────────────────────────────────────────────── -->
{#if patient}
	<AuditLogDialog
		bind:open={showAuditDialog}
		patientId={patient.patient_id}
		patientName="{patient.firstname} {patient.lastname}"
	/>
{/if}
