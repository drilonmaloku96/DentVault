<script lang="ts">
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

	// Contextual panel toggles
	let showAcute   = $state(false);
	let showNotes   = $state(false);
	let showMedical = $state(false);

	// Acute content preview
	let acuteContent = $state('');

	// New-file detection
	let pendingFiles       = $state<VaultFileInfo[]>([]);
	let showNewFilesDialog = $state(false);

	// Status
	let statusSaving = $state(false);

	// Delete dialog
	let showDeleteDialog = $state(false);
	let isDeleting       = $state(false);

	// Audit log dialog
	let showAuditDialog = $state(false);

	$effect(() => { loadPatient(); });

	async function loadPatient() {
		isLoading = true;
		const result = await getPatient(patientId);
		if (!result) { notFound = true; }
		else {
			patient = result;
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

	function formatDateShort(val: string): string {
		if (!val) return '—';
		const d = new Date(val);
		return isNaN(d.getTime()) ? val : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
	}

	const statusConfig = $derived<Record<PatientStatus, { label: string; class: string }>>({
		active:   { label: i18n.t.patients.status.active,   class: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400' },
		inactive: { label: i18n.t.patients.status.inactive, class: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400' },
		archived: { label: i18n.t.patients.status.archived, class: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400' },
		deceased: { label: i18n.t.patients.status.deceased, class: 'bg-zinc-800 text-zinc-200 border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300' },
	});

	const selectClass =
		'border-input bg-background flex h-8 rounded-md border px-2.5 py-1 text-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50';
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

		<!-- ── Sticky patient header ───────────────────────────────── -->
		<div class="sticky top-0 z-20 bg-background pb-2 border-b border-border/40 shadow-[0_2px_8px_-2px_hsl(var(--foreground)/0.06)]">

			<!-- Single compact row: breadcrumb + patient identity + actions -->
			<div class="flex items-center gap-3 min-w-0">

				<!-- Back link -->
				<a
					href="/patients"
					class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
					title={i18n.t.nav.patients}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
						<path d="M19 12H5M12 5l-7 7 7 7"/>
					</svg>
				</a>

				<!-- Avatar + name (links to info page) -->
				<a
					href="/patients/{patient.patient_id}/info"
					class="flex items-center gap-2.5 flex-1 min-w-0 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors group"
					title="View patient details"
				>
					<div class="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-xs shrink-0 transition-colors group-hover:bg-primary/15">
						{patient.firstname[0]?.toUpperCase()}{patient.lastname[0]?.toUpperCase()}
					</div>
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2">
							<span class="text-sm font-semibold truncate">{patient.firstname} {patient.lastname}</span>
							{#if patient.status !== 'active'}
								<span class={`rounded-full border px-1.5 py-px text-[10px] font-medium shrink-0 ${statusConfig[patient.status]?.class ?? ''}`}>
									{statusConfig[patient.status]?.label ?? patient.status}
								</span>
							{/if}
						</div>
						<div class="flex items-center gap-2.5 text-[11px] text-muted-foreground flex-wrap">
							<span class="font-mono">{patient.patient_id}</span>
							{#if patient.dob}
								<span>{formatDateShort(patient.dob)}</span>
							{/if}
							{#if patient.phone}
								<span>{patient.phone}</span>
							{/if}
							{#if patient.next_appointment}
								<span>Next: {formatDateShort(patient.next_appointment)}</span>
							{/if}
						</div>
					</div>
					<!-- Info icon hint -->
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
						class="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors"
					>
						<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
					</svg>
				</a>

				<!-- Actions -->
				<div class="flex items-center gap-1 shrink-0">

					<!-- Status select -->
					<select class={selectClass} value={patient.status} onchange={handleStatusChange} disabled={statusSaving}>
						<option value="active">{i18n.t.patients.status.active}</option>
						<option value="inactive">{i18n.t.patients.status.inactive}</option>
						<option value="archived">{i18n.t.patients.status.archived}</option>
						<option value="deceased">{i18n.t.patients.status.deceased}</option>
					</select>

					<!-- Edit -->
					<Button href="/patients/{patient.patient_id}/edit" variant="outline" size="sm" class="h-8 px-2.5 text-xs">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
							<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
						</svg>
					</Button>

					<!-- Delete -->
					<Button variant="destructive" size="sm" class="h-8 px-2.5" onclick={() => (showDeleteDialog = true)}>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
							<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/>
						</svg>
					</Button>

					<!-- Separator -->
					<div class="w-px h-5 bg-border/60 mx-0.5"></div>

					<!-- Acute problems -->
					<button
						type="button"
						onclick={() => (showAcute = !showAcute)}
						title="Akute Probleme"
						aria-pressed={showAcute}
						class={[
							'flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors max-w-[160px]',
							showAcute || acuteContent.trim()
								? 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400'
								: 'text-red-400/70 hover:bg-red-50 hover:text-red-600 dark:text-red-700 dark:hover:text-red-400',
						].join(' ')}
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0">
							<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
							<line x1="12" y1="9" x2="12" y2="13"/>
							<line x1="12" y1="17" x2="12.01" y2="17"/>
						</svg>
						{#if acuteContent.trim() && !showAcute}
							<span class="text-[10px] font-medium leading-tight truncate">
								{acuteContent.trim().slice(0, 30)}{acuteContent.trim().length > 30 ? '…' : ''}
							</span>
						{/if}
					</button>

					<!-- Medical history -->
					<button
						type="button"
						onclick={() => (showMedical = !showMedical)}
						title="Medical History"
						aria-pressed={showMedical}
						class={[
							'rounded-md p-1.5 transition-colors',
							showMedical
								? 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400'
								: 'text-amber-400/70 hover:bg-amber-50 hover:text-amber-600 dark:text-amber-700 dark:hover:text-amber-400',
						].join(' ')}
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
							<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
							<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
							<line x1="8" y1="12" x2="16" y2="12"/>
							<line x1="8" y1="16" x2="16" y2="16"/>
						</svg>
					</button>

					<!-- Notes -->
					<button
						type="button"
						onclick={() => (showNotes = !showNotes)}
						title="Notes"
						aria-pressed={showNotes}
						class={[
							'rounded-md p-1.5 transition-colors',
							showNotes
								? 'bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400'
								: 'text-violet-400/70 hover:bg-violet-50 hover:text-violet-600 dark:text-violet-700 dark:hover:text-violet-400',
						].join(' ')}
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
							<path d="M12 20h9"/>
							<path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
						</svg>
					</button>

					<!-- Audit log -->
					<button
						type="button"
						onclick={() => (showAuditDialog = true)}
						title={i18n.t.audit.title}
						class="rounded-md p-1.5 transition-colors text-muted-foreground/50 hover:bg-muted hover:text-foreground"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
							<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
						</svg>
					</button>

				</div>
			</div>

		</div><!-- /sticky header -->

		<!-- ── Contextual panels ───────────────────────────────────── -->
		{#if showAcute || showNotes || showMedical}
			<div class="flex flex-col gap-2 mt-3 mb-4">
				{#if showAcute}
					<AcuteProblemsBox
						patientId={patient.patient_id}
						onContentChange={(v) => (acuteContent = v)}
					/>
				{/if}
				{#if showMedical}
					<MedicalHistoryBox patientId={patient.patient_id} />
				{/if}
				{#if showNotes}
					<PatientNotesBox patientId={patient.patient_id} />
				{/if}
			</div>
		{/if}

		<!-- ── Timeline ────────────────────────────────────────────── -->
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

<!-- Delete confirmation -->
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

{#if patient}
	<AuditLogDialog
		bind:open={showAuditDialog}
		patientId={patient.patient_id}
		patientName="{patient.firstname} {patient.lastname}"
	/>
{/if}
