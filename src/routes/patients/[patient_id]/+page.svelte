<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getPatient, getDocuments, getAppointmentsForPatient, getAcuteText } from '$lib/services/db';
	import type { Appointment } from '$lib/types';
	import { patientBus } from '$lib/stores/patientBus.svelte';
	import type { Patient } from '$lib/types';
	import { listVaultFiles, type VaultFileInfo } from '$lib/services/files';
	import { Button } from '$lib/components/ui/button';
	import TimelineView from '$lib/components/timeline/TimelineView.svelte';
	import PatientNotesBox from '$lib/components/patient/PatientNotesBox.svelte';
	import MedicalHistoryBox from '$lib/components/patient/MedicalHistoryBox.svelte';
	import AcuteProblemsBox from '$lib/components/patient/AcuteProblemsBox.svelte';
	import NewFilesDialog from '$lib/components/documents/NewFilesDialog.svelte';
	import AuditLogDialog from '$lib/components/audit/AuditLogDialog.svelte';
	import PatientExportDialog from '$lib/components/export/PatientExportDialog.svelte';

	import { vault } from '$lib/stores/vault.svelte';
	import { activePatient } from '$lib/stores/activePatient.svelte';
	import { i18n } from '$lib/i18n';
	import { formatDate, formatDateTime } from '$lib/utils';

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


	// Audit log dialog
	let showAuditDialog = $state(false);

	// Export dialog
	let showExportDialog = $state(false);

	// Appointments dropdown
	let appointments     = $state<Appointment[]>([]);
	let apptDropdownOpen = $state(false);
	let pillWrapperEl    = $state<HTMLElement | null>(null);

	$effect(() => {
		if (!apptDropdownOpen) return;
		function handleDocClick(e: MouseEvent) {
			if (pillWrapperEl && !pillWrapperEl.contains(e.target as Node)) {
				apptDropdownOpen = false;
			}
		}
		document.addEventListener('click', handleDocClick);
		return () => document.removeEventListener('click', handleDocClick);
	});

	const now = new Date().toISOString();
	const futureAppointments = $derived(
		appointments.filter(a => a.status === 'scheduled' && a.start_time >= now)
			.sort((a, b) => a.start_time.localeCompare(b.start_time))
	);
	const nextAppointment  = $derived(futureAppointments[0] ?? null);
	const pastAppointments = $derived(
		appointments.filter(a => a.start_time < now || a.status !== 'scheduled')
			.sort((a, b) => b.start_time.localeCompare(a.start_time))
	);

	$effect(() => { loadPatient(); });

	async function loadPatient() {
		isLoading = true;
		const result = await getPatient(patientId);
		if (!result) { notFound = true; }
		else {
			patient = result;
			activePatient.set(result.patient_id, result.firstname, result.lastname);
			const [appts, acute] = await Promise.all([
				getAppointmentsForPatient(patientId),
				getAcuteText(patientId),
			]);
			appointments = appts;
			acuteContent = acute;
			if (acute.trim()) showAcute = true;
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

	function formatDateShort(val: string): string {
		return formatDate(val);
	}

	function formatApptDateTime(iso: string): string {
		const d = new Date(iso);
		if (isNaN(d.getTime())) return iso;
		const weekday = d.toLocaleDateString('en-GB', { weekday: 'short' });
		return weekday + ' ' + formatDate(d) + ' · ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
	}

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
		<div class="sticky top-0 z-20 bg-background pb-2 border-b border-border/40 shadow-[0_2px_8px_-2px_hsl(var(--foreground)/0.06)] -mx-6 px-6 -mt-6 pt-6">

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
						<div class="flex items-center gap-2 flex-wrap">
							<span class="text-sm font-semibold truncate">{patient.firstname} {patient.lastname}</span>
							<!-- Next appointment pill (click → past appointments list) + Book button -->
							<div class="relative flex items-center gap-1.5 shrink-0" bind:this={pillWrapperEl} onclick={(e) => e.preventDefault()}>
								<!-- Pill button -->
								<button
									type="button"
									class="flex items-center gap-1.5 rounded-md border border-border bg-muted/50 hover:bg-muted px-2 py-1 text-[11px] transition-colors"
									onclick={() => apptDropdownOpen = !apptDropdownOpen}
									title={i18n.t.schedule.previousAppointments}
								>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 text-muted-foreground shrink-0">
										<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
									</svg>
									{#if nextAppointment}
										<span class="text-foreground font-medium">{formatApptDateTime(nextAppointment.start_time)}</span>
									{:else}
										<span class="text-muted-foreground italic">{i18n.t.schedule.noUpcoming}</span>
									{/if}
								</button>
								<!-- Book new appointment button -->
								<button
									type="button"
									class="flex items-center justify-center h-6 w-6 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
									title={i18n.t.schedule.bookNew}
									onclick={(e) => { e.preventDefault(); e.stopPropagation(); goto('/schedule?patient=' + patient?.patient_id); }}
								>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
										<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="10" y1="16" x2="14" y2="16"/>
									</svg>
								</button>
								{#if apptDropdownOpen}
									<!-- Dropdown: all appointments -->
									<div class="absolute left-0 top-full mt-1 z-50 w-72 rounded-lg border border-border bg-popover shadow-lg overflow-hidden">
										<div class="max-h-72 overflow-y-auto">
											<!-- Upcoming section -->
											<div class="px-3 py-1.5 border-b border-border bg-muted/30 sticky top-0">
												<p class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{i18n.t.schedule.upcomingAppointments}</p>
											</div>
											{#if futureAppointments.length === 0}
												<p class="text-xs text-muted-foreground italic px-3 py-2.5">{i18n.t.schedule.noUpcoming}</p>
											{:else}
												{#each futureAppointments as appt}
													<button
														type="button"
														class="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-left"
														onclick={(e) => { e.preventDefault(); e.stopPropagation(); apptDropdownOpen = false; goto('/schedule?date=' + appt.start_time.slice(0, 10)); }}
													>
														<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: {appt.type_color ?? '#6366f1'}"></span>
														<div class="flex-1 min-w-0">
															<span class="block font-medium truncate">{formatApptDateTime(appt.start_time)}</span>
															{#if appt.type_name}<span class="text-muted-foreground">{appt.type_name}</span>{/if}
														</div>
														<span class="text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0 font-medium">scheduled</span>
													</button>
												{/each}
											{/if}
											<!-- Previous section -->
											<div class="px-3 py-1.5 border-y border-border bg-muted/30 sticky top-0">
												<p class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{i18n.t.schedule.previousAppointments}</p>
											</div>
											{#if pastAppointments.length === 0}
												<p class="text-xs text-muted-foreground italic px-3 py-2.5">{i18n.t.schedule.noPrevious}</p>
											{:else}
												{#each pastAppointments as appt}
													<button
														type="button"
														class="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-accent transition-colors text-left"
														onclick={(e) => { e.preventDefault(); e.stopPropagation(); apptDropdownOpen = false; goto('/schedule?date=' + appt.start_time.slice(0, 10)); }}
													>
														<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: {appt.type_color ?? '#6366f1'}"></span>
														<div class="flex-1 min-w-0">
															<span class="block font-medium truncate">{formatApptDateTime(appt.start_time)}</span>
															{#if appt.type_name}<span class="text-muted-foreground">{appt.type_name}</span>{/if}
														</div>
														<span class="text-[10px] text-muted-foreground shrink-0 capitalize">{appt.status.replace('_', ' ')}</span>
													</button>
												{/each}
											{/if}
										</div>
									</div>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-2.5 text-[11px] text-muted-foreground flex-wrap">
							<span class="font-mono">{patient.patient_id}</span>
							{#if patient.dob}
								<span>{formatDateShort(patient.dob)}</span>
							{/if}
							{#if patient.phone}
								<span>{patient.phone}</span>
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
				<div class="flex items-center gap-1.5 shrink-0">

					<!-- Acute problems -->
					<div class="relative">
						<button
							type="button"
							onclick={() => (showAcute = !showAcute)}
							title="Akute Probleme"
							aria-pressed={showAcute}
							class={[
								'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all border',
								acuteContent.trim()
									? 'border-red-500 bg-red-500 text-white shadow-sm shadow-red-500/30 hover:bg-red-600'
									: showAcute
										? 'border-red-300 bg-red-50 text-red-600 dark:bg-red-950/40 dark:border-red-700 dark:text-red-400'
										: 'border-transparent text-red-400/60 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:hover:border-red-800 dark:hover:text-red-400',
							].join(' ')}
						>
							<!-- filled triangle when has content, outline when empty -->
							{#if acuteContent.trim()}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5 shrink-0">
									<path d="M12 2L2 22h20L12 2z"/>
									<rect x="11" y="9" width="2" height="5" fill="white"/>
									<rect x="11" y="16" width="2" height="2" fill="white"/>
								</svg>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0">
									<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
									<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
								</svg>
							{/if}
							<span>Akut</span>
						</button>
						{#if showAcute}
							<div class="fixed inset-0 z-30 bg-black/30" role="none" onclick={() => (showAcute = false)}></div>
							<div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 w-[420px] max-h-[80vh] rounded-lg border border-border bg-background shadow-xl overflow-auto">
								<AcuteProblemsBox patientId={patient.patient_id} onContentChange={(v) => (acuteContent = v)} />
							</div>
						{/if}
					</div>

					<!-- Medical history -->
					<div class="relative">
						<button
							type="button"
							onclick={() => (showMedical = !showMedical)}
							title="Medical History"
							aria-pressed={showMedical}
							class={[
								'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all border',
								showMedical
									? 'border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-400'
									: 'border-transparent text-amber-500/60 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700 dark:hover:border-amber-800 dark:hover:text-amber-400',
							].join(' ')}
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0">
								<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
								<rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
								<line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="16" y2="16"/>
							</svg>
							<span>Anamnese</span>
						</button>
						{#if showMedical}
							<div class="fixed inset-0 z-30 bg-black/30" role="none" onclick={() => (showMedical = false)}></div>
							<div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 w-[420px] max-h-[80vh] rounded-lg border border-border bg-background shadow-xl overflow-auto">
								<MedicalHistoryBox patientId={patient.patient_id} />
							</div>
						{/if}
					</div>

					<!-- Notes -->
					<div class="relative">
						<button
							type="button"
							onclick={() => (showNotes = !showNotes)}
							title="Notes"
							aria-pressed={showNotes}
							class={[
								'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-all border',
								showNotes
									? 'border-violet-300 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:border-violet-700 dark:text-violet-400'
									: 'border-transparent text-violet-400/60 hover:border-violet-200 hover:bg-violet-50 hover:text-violet-700 dark:hover:border-violet-800 dark:hover:text-violet-400',
							].join(' ')}
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0">
								<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
							</svg>
							<span>Notizen</span>
						</button>
						{#if showNotes}
							<div class="fixed inset-0 z-30 bg-black/30" role="none" onclick={() => (showNotes = false)}></div>
							<div class="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 w-[420px] max-h-[80vh] rounded-lg border border-border bg-background shadow-xl overflow-auto">
								<PatientNotesBox patientId={patient.patient_id} />
							</div>
						{/if}
					</div>

					<!-- Export -->
					<button
						type="button"
						onclick={() => (showExportDialog = true)}
						title={i18n.t.export.title}
						class="rounded-md p-1.5 transition-colors text-muted-foreground/50 hover:bg-muted hover:text-foreground"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
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

{#if patient}
	<AuditLogDialog
		bind:open={showAuditDialog}
		patientId={patient.patient_id}
		patientName="{patient.firstname} {patient.lastname}"
	/>
{/if}

{#if showExportDialog && patient}
	<PatientExportDialog bind:open={showExportDialog} {patient} />
{/if}

