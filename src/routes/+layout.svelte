<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { theme } from '$lib/stores/theme.svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { docCategories } from '$lib/stores/categories.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffRoles } from '$lib/stores/staffRoles.svelte';
	import { textBlocks } from '$lib/stores/textBlocks.svelte';
	import { acuteTagOptions, medicalTagOptions } from '$lib/stores/clinicalTags.svelte';
	import { complicationTypes } from '$lib/stores/complicationTypes.svelte';
	import { rooms } from '$lib/stores/rooms.svelte';
	import { appointmentTypes } from '$lib/stores/appointmentTypes.svelte';
	import { workingHours } from '$lib/stores/workingHours.svelte';
	import PatientSidebar from '$lib/components/sidebar/PatientSidebar.svelte';
	import OnboardingWizard from '$lib/components/onboarding/OnboardingWizard.svelte';
	import { i18n } from '$lib/i18n';
	import { activePatient } from '$lib/stores/activePatient.svelte';
	import { uiScale } from '$lib/stores/uiScale.svelte';
	import { textHighlightColors } from '$lib/stores/textHighlightColors.svelte';
	import { appointmentStatusLabels } from '$lib/stores/appointmentStatusLabels.svelte';
	import { scrollIndicator } from '$lib/actions/scrollIndicator';
	let { children } = $props();

	// Theme + vault + stores all init on mount
	onMount(async () => {
		await vault.init();
		// i18n must init right after vault so all stores get the correct language defaults
		await i18n.init();
		// Theme must init after vault so DB is available for portable persistence
		await theme.init();
		// Load user-configured document categories (falls back to defaults if none saved yet)
		await docCategories.load();
		// Load doctors list (used across timeline views)
		await doctors.load();
		// Load user-configured staff roles (falls back to Doctor/Nurse defaults)
		await staffRoles.load();
		// Load user-configured text blocks for the '/' command palette
		await textBlocks.load();
		// Load clinical tag option lists (acute problems + medical history)
		await acuteTagOptions.load();
		await medicalTagOptions.load();
		// Load complication types
		await complicationTypes.load();
		// Load appointment scheduling stores
		await rooms.load();
		await appointmentTypes.load();
		await workingHours.load();
		// Load UI scale preference
		await uiScale.load();
		await textHighlightColors.load();
		await appointmentStatusLabels.load();
	});

	// Keep html[lang] in sync with the current language so <input type="date">
	// renders in DD/MM/YYYY (en-GB) or DD.MM.YYYY (de) — not US MM/DD/YYYY.
	$effect(() => {
		document.documentElement.lang = i18n.code === 'de' ? 'de' : 'en-GB';
	});

	// Sidebar ref (so other parts of the app can trigger a reload)
	let sidebarRef = $state<ReturnType<typeof PatientSidebar> | null>(null);

	// Hide sidebar when Cephalyzer is open so it gets full width
	const isCephPage = $derived(page.url.pathname.endsWith('/ceph'));

	function onVaultConfigured() {
		// Vault was just set up — navigate to dashboard
		goto('/dashboard', { replaceState: true });
	}

	// Primary nav (above settings) — labels are reactive via i18n
	const primaryNav = $derived([
		{
			label: i18n.t.nav.dashboard,
			href: '/dashboard',
			icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
			badge: null as number | null,
		},
		{
			label: i18n.t.nav.schedule,
			href: '/schedule',
			icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
			badge: null as number | null,
		},
		{
			label: i18n.t.nav.reports,
			href: '/reports',
			icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
			badge: null as number | null,
		},
	]);
</script>

<svelte:head>
	<title>DentVault</title>
</svelte:head>

<!-- Show onboarding wizard until vault is configured -->
{#if vault.initialized && !vault.isConfigured}
	<OnboardingWizard onConfigured={onVaultConfigured} />

<!-- Normal app shell -->
{:else}
	<div class="flex h-screen overflow-hidden bg-background">

		<!-- ── Left Sidebar — hidden on Cephalyzer page ─────────── -->
		{#if !isCephPage}
		<aside class="flex w-56 flex-col border-r border-sidebar-border bg-sidebar">

			<!-- Back button / branding -->
			<div class="flex h-12 shrink-0 items-center px-2">
				<button
					type="button"
					onclick={() => { activePatient.clear(); goto('/dashboard'); }}
					class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
					title="Go to Dashboard"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="h-4 w-4 shrink-0"
					>
						<path d="M19 12H5M12 19l-7-7 7-7" />
					</svg>
					<span class="text-sm font-semibold tracking-tight">DentVault</span>
				</button>
			</div>

			<!-- Patient Explorer (takes all remaining vertical space) -->
			<div class="flex-1 overflow-hidden border-t border-sidebar-border">
				<PatientSidebar bind:this={sidebarRef} />
			</div>

			<!-- Bottom nav — vertical stack -->
			<div class="border-t border-sidebar-border">
				<nav class="flex flex-col py-1">
					{#each primaryNav as item}
						{@const isActive = page.url.pathname.startsWith(item.href)}
						<a
							href={item.href}
							title={item.label}
							class={[
								'relative flex items-center gap-2.5 px-4 h-9 text-[13px] font-medium transition-colors rounded-md mx-1',
								isActive
									? 'bg-sidebar-accent text-sidebar-accent-foreground'
									: 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50',
							].join(' ')}
						>
							{#if isActive}
								<span class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-sidebar-primary"></span>
							{/if}
							<svg
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="1.75"
								stroke-linecap="round"
								stroke-linejoin="round"
								class="h-[15px] w-[15px] shrink-0"
							>
								<path d={item.icon} />
							</svg>
							{item.label}
							{#if item.badge}
								<span class="ml-auto flex h-4 min-w-[16px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{item.badge}</span>
							{/if}
						</a>
					{/each}

					<!-- Settings — separated at bottom -->
					<div class="mx-3 my-1 border-t border-sidebar-border/60"></div>
					<a
						href="/settings"
						title={i18n.t.nav.settings}
						class={[
							'relative flex items-center gap-2.5 px-4 h-9 text-[13px] font-medium transition-colors rounded-md mx-1',
							page.url.pathname.startsWith('/settings')
								? 'bg-sidebar-accent text-sidebar-accent-foreground'
								: 'text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50',
						].join(' ')}
					>
						{#if page.url.pathname.startsWith('/settings')}
							<span class="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-sidebar-primary"></span>
						{/if}
						<svg
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.75"
							stroke-linecap="round"
							stroke-linejoin="round"
							class="h-[15px] w-[15px] shrink-0"
						>
							<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
						</svg>
						{i18n.t.nav.settings}
					</a>

					<div class="h-1"></div>
				</nav>
			</div>
		</aside>
		{/if}

		<!-- ── Main Content ────────────────────────────────────────── -->
		<main use:scrollIndicator class="flex-1 {isCephPage ? 'overflow-hidden' : 'overflow-auto'}">
			<!-- Show a loading skeleton while vault is initialising -->
			{#if !vault.initialized}
				<div class="flex h-full items-center justify-center">
					<div class="flex flex-col items-center gap-3 text-muted-foreground">
						<svg class="h-8 w-8 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
						</svg>
						<p class="text-sm">{i18n.t.vault.opening}</p>
					</div>
				</div>
			{:else}
				<div class="h-full {isCephPage ? '' : 'p-6'}">
					{@render children()}
				</div>
			{/if}
		</main>
	</div>
{/if}
