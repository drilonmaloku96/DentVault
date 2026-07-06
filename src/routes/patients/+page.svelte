<script lang="ts">
	import { goto } from '$app/navigation';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import PatientCard from '$lib/components/patient/PatientCard.svelte';
	import { getAllPatients, searchPatients } from '$lib/services/db';
	import { debounce } from '$lib/utils';
	import type { Patient } from '$lib/types';
	import { i18n } from '$lib/i18n';

	let patients = $state<Patient[]>([]);
	let isLoading = $state(true);
	let searchQuery = $state('');
	let error = $state('');
	let searchInputEl = $state<HTMLInputElement | null>(null);

	// Guards against out-of-order resolution when typing fast.
	let requestToken = 0;

	async function runSearch(query: string) {
		const token = ++requestToken;
		try {
			isLoading = true;
			error = '';
			const results = query.trim() ? await searchPatients(query, false) : await getAllPatients();
			if (token !== requestToken) return;
			patients = results;
		} catch (err) {
			if (token !== requestToken) return;
			error = err instanceof Error ? err.message : 'Search failed';
		} finally {
			if (token === requestToken) isLoading = false;
		}
	}

	const debouncedSearch = debounce(runSearch, 300);

	$effect(() => {
		const query = searchQuery;
		// Skip the debounce for the empty query so first paint (and clearing
		// the search box) isn't held up by a 300ms delay.
		if (!query.trim()) {
			runSearch(query);
		} else {
			debouncedSearch(query);
		}
	});

	$effect(() => {
		searchInputEl?.focus();
	});

	function onSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && patients.length === 1) {
			goto('/patients/' + patients[0].patient_id);
		}
	}
</script>

<div class="flex flex-col gap-6">
	<!-- Header -->
	<div class="flex items-center justify-between">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">{i18n.t.patients.title}</h1>
			<p class="text-sm text-muted-foreground">
				{#if isLoading}
					{i18n.t.common.loading}
				{:else}
					{patients.length} patient{patients.length === 1 ? '' : 's'}
				{/if}
			</p>
		</div>
		<Button href="/patients/new">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="mr-2 h-4 w-4"
			>
				<path d="M12 5v14M5 12h14" />
			</svg>
			{i18n.t.patients.new}
		</Button>
	</div>

	<!-- Search -->
	<div class="relative max-w-sm">
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
			class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
		>
			<circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
		</svg>
		<Input
			type="search"
			placeholder={i18n.t.patients.search}
			class="pl-10"
			bind:value={searchQuery}
			bind:ref={searchInputEl}
			onkeydown={onSearchKeydown}
		/>
	</div>

	<!-- Error -->
	{#if error}
		<div class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
			{error}
		</div>
	{/if}

	<!-- Loading skeleton -->
	{#if isLoading}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each [1, 2, 3, 4, 5, 6] as _}
				<div class="h-32 animate-pulse rounded-lg border bg-muted"></div>
			{/each}
		</div>

	<!-- Empty state -->
	{:else if patients.length === 0}
		<div class="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-12">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="mb-4 h-12 w-12 text-muted-foreground/50"
			>
				<path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
			</svg>
			{#if searchQuery}
				<h3 class="text-lg font-medium text-muted-foreground">{i18n.t.patients.noResults}</h3>
				<p class="mt-1 text-sm text-muted-foreground/70">Try a different name, ID, or phone number.</p>
			{:else}
				<h3 class="text-lg font-medium text-muted-foreground">{i18n.t.patients.noPatients}</h3>
				<p class="mt-1 text-sm text-muted-foreground/70">
					Click <strong>+ {i18n.t.patients.new}</strong> to get started.
				</p>
			{/if}
		</div>

	<!-- Patient grid -->
	{:else}
		<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each patients as patient (patient.patient_id)}
				<PatientCard {patient} />
			{/each}
		</div>
	{/if}
</div>
