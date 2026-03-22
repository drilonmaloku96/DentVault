<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { getAllPatients, searchPatients, getPatient } from '$lib/services/db';
	import type { Patient } from '$lib/types';
	import { debounce } from '$lib/utils';
	import { patientBus } from '$lib/stores/patientBus.svelte';
	import { activePatient } from '$lib/stores/activePatient.svelte';
	import { i18n } from '$lib/i18n';
	import PatientTreeView from './PatientTreeView.svelte';

	// ── State ──────────────────────────────────────────
	let patients   = $state<Patient[]>([]);
	let query      = $state('');
	let isLoading  = $state(true);
	let activePatientObj = $state<Patient | null>(null);

	// Active patient ID: from URL when on a specific patient page, empty on list, store otherwise
	let activePatientId = $derived(
		page.url.pathname.startsWith('/patients/')
			? page.url.pathname.split('/patients/')[1]?.split('/')[0] ?? ''
			: page.url.pathname === '/patients'
				? ''
				: activePatient.id,
	);

	// ── Data loading ───────────────────────────────────
	async function load() {
		try {
			patients = await getAllPatients();
		} catch {
			patients = [];
		} finally {
			isLoading = false;
		}
	}

	const doSearch = debounce(async (q: string) => {
		if (!q.trim()) {
			await load();
			return;
		}
		isLoading = true;
		try {
			patients = await searchPatients(q.trim());
		} finally {
			isLoading = false;
		}
	}, 250);

	$effect(() => {
		void patientBus.version;
		doSearch(query);
	});

	// Load active patient object when patientId changes
	$effect(() => {
		if (!activePatientId) {
			activePatientObj = null;
			return;
		}
		// Try from already-loaded list first
		const found = patients.find(p => p.patient_id === activePatientId);
		if (found) {
			activePatientObj = found;
		} else {
			// Fetch individually (e.g. direct URL navigation before list loads)
			getPatient(activePatientId).then(p => { activePatientObj = p; });
		}
	});

	onMount(() => load());

	// Expose reload so parent can trigger a refresh after patient creation
	export function reload() {
		load();
	}

	// ── Helpers ────────────────────────────────────────
	function initials(p: Patient) {
		return (p.firstname[0] ?? '') + (p.lastname[0] ?? '');
	}

	const t = $derived(i18n.t.sidebar);
</script>

<div class="flex h-full flex-col">

{#if activePatientObj}
	<!-- ── Tree mode: active patient ─────────────────── -->
	<PatientTreeView patient={activePatientObj} />

{:else}
	<!-- ── List mode: patient search & list ──────────── -->

	<!-- Search bar -->
	<div class="px-3 pb-2 pt-3">
		<div class="relative">
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60"
			>
				<circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
			</svg>
			<input
				type="search"
				placeholder={t.searchPlaceholder}
				class="h-8 w-full rounded-md border border-sidebar-border bg-sidebar-accent/30 pl-8 pr-3 text-xs text-sidebar-foreground placeholder:text-muted-foreground/50 outline-none focus:border-sidebar-primary focus:ring-0 transition-colors"
				bind:value={query}
			/>
		</div>
	</div>

	<!-- Patient count -->
	<div class="px-4 pb-1.5">
		<span class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
			{#if isLoading}
				…
			{:else if query.trim()}
				{patients.length} {t.results}{patients.length !== 1 ? 's' : ''}
			{:else}
				{patients.length} {t.patientsLabel}{patients.length !== 1 ? 's' : ''}
			{/if}
		</span>
	</div>

	<!-- Patient list -->
	<div class="flex-1 overflow-y-auto px-2 pb-2">
		{#if isLoading}
			<div class="flex flex-col gap-1.5 px-1 pt-1">
				{#each [1, 2, 3, 4, 5] as _}
					<div class="h-9 animate-pulse rounded-md bg-sidebar-accent/50"></div>
				{/each}
			</div>
		{:else if patients.length === 0}
			<div class="flex flex-col items-center gap-2 py-8 text-center">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="h-8 w-8 text-muted-foreground/30"
				>
					<path d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
				</svg>
				<p class="text-xs text-muted-foreground/60">
					{query.trim() ? t.noResults : t.noPatients}
				</p>
			</div>
		{:else}
			<div class="flex flex-col gap-0.5">
				{#each patients as patient (patient.patient_id)}
					{@const isActive = patient.patient_id === activePatientId}
					<button
						type="button"
						onclick={() => goto('/patients/' + patient.patient_id)}
						class={[
							'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors',
							isActive
								? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-100'
								: 'text-sidebar-foreground hover:bg-sidebar-accent',
						].join(' ')}
					>
						<!-- Avatar initials -->
						<span class={[
							'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold uppercase',
							isActive
								? 'bg-emerald-200 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200'
								: 'bg-sidebar-accent text-sidebar-foreground',
						].join(' ')}>
							{initials(patient)}
						</span>

						<!-- Name + ID -->
						<span class="flex min-w-0 flex-col">
							<span class={[
								'truncate text-xs font-medium leading-tight',
								isActive ? 'text-emerald-800 dark:text-emerald-200' : '',
							].join(' ')}>
								{patient.lastname}, {patient.firstname}
							</span>
							<span class={[
								'truncate text-[10px] leading-tight',
								isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground/70',
							].join(' ')}>
								{patient.patient_id}
							</span>
						</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- New Patient button -->
	<div class="border-t border-sidebar-border px-2 py-2">
		<a
			href="/patients/new"
			class="flex w-full items-center justify-center gap-1.5 rounded-md bg-sidebar-primary px-3 py-1.5 text-xs font-semibold text-sidebar-primary-foreground transition-colors hover:bg-sidebar-primary/90"
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
				class="h-3.5 w-3.5"
			>
				<path d="M12 5v14M5 12h14" />
			</svg>
			{t.newPatient}
		</a>
	</div>

{/if}
</div>
