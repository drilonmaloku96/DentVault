<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { getPatient, updatePatient } from '$lib/services/db';
	import type { Patient, PatientFormData } from '$lib/types';
	import { Button } from '$lib/components/ui/button';
	import PatientForm from '$lib/components/patient/PatientForm.svelte';
	import { patientBus } from '$lib/stores/patientBus.svelte';
	import { i18n } from '$lib/i18n';

	const patientId = $derived(page.params.patient_id ?? '');

	let patient = $state<Patient | null>(null);
	let isLoading = $state(true);
	let notFound = $state(false);

	onMount(async () => {
		const result = await getPatient(patientId);
		if (!result) {
			notFound = true;
		} else {
			patient = result;
		}
		isLoading = false;
	});

	async function handleUpdate(data: PatientFormData) {
		if (!patient) return;
		await updatePatient(patient.patient_id, data as unknown as Record<string, unknown>);
		// Signal the sidebar to refresh (name or other visible fields may have changed)
		patientBus.invalidate();
		goto('/patients/' + patient.patient_id);
	}
</script>

{#if isLoading}
	<div class="flex h-48 items-center justify-center">
		<svg class="h-6 w-6 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
			<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
			<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
		</svg>
	</div>

{:else if notFound || !patient}
	<div class="flex flex-col items-center justify-center gap-4 py-16">
		<p class="text-lg font-medium text-muted-foreground">Patient not found</p>
		<Button href="/patients" variant="outline">← {i18n.t.nav.patients}</Button>
	</div>

{:else}
	<div class="flex flex-col gap-6">
		<!-- Breadcrumb -->
		<nav class="flex items-center gap-2 text-sm text-muted-foreground">
			<a href="/patients" class="hover:text-foreground transition-colors">Patients</a>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
				<path d="M9 18l6-6-6-6" />
			</svg>
			<a href="/patients/{patient.patient_id}" class="hover:text-foreground transition-colors">
				{patient.lastname}, {patient.firstname}
			</a>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
				<path d="M9 18l6-6-6-6" />
			</svg>
			<span class="text-foreground font-medium">Edit</span>
		</nav>

		<div>
			<h1 class="text-2xl font-bold tracking-tight">Edit Patient</h1>
			<p class="text-sm text-muted-foreground">{patient.patient_id}</p>
		</div>

		<PatientForm
			initialData={{
				firstname: patient.firstname,
				lastname: patient.lastname,
				dob: patient.dob,
				gender: patient.gender,
				phone: patient.phone,
				email: patient.email,
				insurance_provider: patient.insurance_provider,
				insurance_id: patient.insurance_id,
			}}
			onSubmit={handleUpdate}
			submitLabel={i18n.t.actions.save}
		/>
	</div>
{/if}
