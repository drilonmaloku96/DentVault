<script lang="ts">
	import { goto } from '$app/navigation';
	import { insertPatient } from '$lib/services/db';
	import { initPatientFolder } from '$lib/services/files';
	import { vault } from '$lib/stores/vault.svelte';
	import { patientBus } from '$lib/stores/patientBus.svelte';
	import PatientForm from '$lib/components/patient/PatientForm.svelte';
	import type { PatientFormData } from '$lib/types';
	import { i18n } from '$lib/i18n';

	async function handleCreate(data: PatientFormData) {
		const patient = await insertPatient(data);

		// Create the patient folder in the vault (if vault is configured)
		if (vault.isConfigured && vault.path) {
			const folderName = vault.patientFolder(patient.lastname, patient.firstname, patient.patient_id);
			try {
				await initPatientFolder(vault.path, folderName);
			} catch (e) {
				// Folder creation failure is non-fatal — DB record already saved
				console.warn('Could not create patient folder:', e);
			}
		}

		// Signal the sidebar to refresh
		patientBus.invalidate();
		goto('/patients/' + patient.patient_id);
	}
</script>

<div class="flex flex-col gap-6">
	<!-- Breadcrumb -->
	<nav class="flex items-center gap-2 text-sm text-muted-foreground">
		<a href="/patients" class="hover:text-foreground transition-colors">{i18n.t.patients.title}</a>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
			<path d="M9 18l6-6-6-6" />
		</svg>
		<span class="text-foreground font-medium">{i18n.t.patients.new}</span>
	</nav>

	<div>
		<h1 class="text-2xl font-bold tracking-tight">{i18n.t.patients.new}</h1>
		<p class="text-sm text-muted-foreground">Add a new patient record to DentVault</p>
	</div>

	<PatientForm onSubmit={handleCreate} submitLabel={i18n.t.patients.new} />
</div>
