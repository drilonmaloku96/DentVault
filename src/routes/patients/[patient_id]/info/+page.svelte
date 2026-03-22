<script lang="ts">
	import { page } from '$app/state';
	import { getPatient } from '$lib/services/db';
	import type { Patient } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import AuditLogDialog from '$lib/components/audit/AuditLogDialog.svelte';
	import { i18n } from '$lib/i18n';
	import { formatDate } from '$lib/utils';

	function parseJsonArray(val: string): string[] {
		if (!val) return [];
		try { return JSON.parse(val) as string[]; } catch { return []; }
	}

	const patientId = $derived(page.params.patient_id ?? '');

	let patient   = $state<Patient | null>(null);
	let isLoading = $state(true);
	let notFound  = $state(false);

	let showAuditDialog  = $state(false);

	$effect(() => { loadPatient(); });

	async function loadPatient() {
		isLoading = true;
		const result = await getPatient(patientId);
		if (!result) notFound = true;
		else patient = result;
		isLoading = false;
	}




	function formatGender(val: string): string {
		const map: Record<string, string> = {
			male: 'Male', female: 'Female', other: 'Other', prefer_not_to_say: 'Prefer not to say',
		};
		return map[val] ?? val ?? '—';
	}

	const infoRowClass   = 'flex flex-col gap-0.5';
	const infoLabelClass = 'text-xs font-medium text-muted-foreground uppercase tracking-wide';
	const infoValueClass = 'text-sm text-foreground';
</script>

{#if isLoading}
	<div class="flex h-48 items-center justify-center">
		<svg class="h-6 w-6 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
			<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
			<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
		</svg>
	</div>

{:else if notFound || !patient}
	<div class="flex flex-col items-center justify-center gap-4 py-16">
		<p class="text-lg font-medium text-muted-foreground">Patient not found</p>
		<Button href="/patients" variant="outline">← {i18n.t.nav.patients}</Button>
	</div>

{:else}
	<!-- Header -->
	<div class="flex items-center justify-between gap-4 mb-6">
		<div class="flex items-center gap-3">
			<Button href="/patients/{patient.patient_id}" variant="ghost" size="sm" class="gap-1.5">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
					<path d="M19 12H5M12 5l-7 7 7 7"/>
				</svg>
				Back
			</Button>
			<div class="flex items-center gap-2.5">
				<div class="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary font-semibold text-sm shrink-0">
					{patient.firstname[0]?.toUpperCase()}{patient.lastname[0]?.toUpperCase()}
				</div>
				<div>
					<h1 class="text-lg font-semibold leading-tight">{patient.firstname} {patient.lastname}</h1>
					<p class="text-xs text-muted-foreground font-mono">{patient.patient_id}</p>
				</div>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<Button href="/patients/{patient.patient_id}/edit" variant="outline" size="sm">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
					<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
				</svg>
				{i18n.t.actions.edit}
			</Button>
			<button
				type="button"
				onclick={() => (showAuditDialog = true)}
				class="flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
				title={i18n.t.audit.title}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
					<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
				</svg>
			</button>
		</div>
	</div>

	<!-- Info cards -->
	<div class="flex flex-col gap-3">
		<!-- Row 1: Personal + Contact -->
		<div class="grid gap-3 md:grid-cols-2">
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

		<!-- Row 3: Clinical (allergies, medications, risk flags) -->
		{#if patient.allergies || patient.medications || patient.risk_flags}
			{@const allergies = parseJsonArray(patient.allergies)}
			{@const medications = parseJsonArray(patient.medications)}
			{@const riskFlags = parseJsonArray(patient.risk_flags)}
			{#if allergies.length > 0 || medications.length > 0 || riskFlags.length > 0}
				<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{i18n.t.patients.formSections.clinical}</h3>
					<div class="grid gap-3 md:grid-cols-3">
						{#if allergies.length > 0}
							<div class={infoRowClass}>
								<span class={infoLabelClass}>{i18n.t.patients.fields.allergies}</span>
								<div class="flex flex-wrap gap-1 mt-0.5">
									{#each allergies as a}
										<span class="rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400 px-2 py-0.5 text-xs">{a}</span>
									{/each}
								</div>
							</div>
						{/if}
						{#if medications.length > 0}
							<div class={infoRowClass}>
								<span class={infoLabelClass}>Medications</span>
								<div class="flex flex-wrap gap-1 mt-0.5">
									{#each medications as m}
										<span class="rounded-full bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 px-2 py-0.5 text-xs">{m}</span>
									{/each}
								</div>
							</div>
						{/if}
						{#if riskFlags.length > 0}
							<div class={infoRowClass}>
								<span class={infoLabelClass}>Risk Flags</span>
								<div class="flex flex-wrap gap-1 mt-0.5">
									{#each riskFlags as r}
										<span class="rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 px-2 py-0.5 text-xs">{r}</span>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		{/if}

		<!-- Row 4: Demographics -->
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

		<!-- Dates footer -->
		<div class="flex items-center gap-4 px-1 text-xs text-muted-foreground/60">
			<span>ID: <span class="font-mono">{patient.patient_id}</span></span>
			<span>Created: {formatDate(patient.created_at)}</span>
			<span>Updated: {formatDate(patient.updated_at)}</span>
		</div>
	</div>
{/if}

{#if patient}
	<AuditLogDialog
		bind:open={showAuditDialog}
		patientId={patient.patient_id}
		patientName="{patient.firstname} {patient.lastname}"
	/>
{/if}
