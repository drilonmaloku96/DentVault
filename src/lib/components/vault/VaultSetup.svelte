<script lang="ts">
	import { vault } from '$lib/stores/vault.svelte';
	import { resetDb } from '$lib/services/db';
	import { pickDirectory } from '$lib/services/files';

	let { onConfigured }: { onConfigured: () => void } = $props();

	let selectedPath = $state('');
	let isSaving = $state(false);
	let error = $state('');

	async function handlePickFolder() {
		error = '';
		const path = await pickDirectory();
		if (path) selectedPath = path;
	}

	async function handleConfirm() {
		if (!selectedPath.trim()) {
			error = 'Please select a vault folder first.';
			return;
		}
		isSaving = true;
		error = '';
		try {
			await vault.configure(selectedPath.trim());
			// Force DB to reconnect with the new vault path
			resetDb();
			onConfigured();
		} catch (e) {
			error = String(e);
		} finally {
			isSaving = false;
		}
	}
</script>

<div class="flex h-screen items-center justify-center bg-background p-6">
	<div class="w-full max-w-md">

		<!-- Logo + title -->
		<div class="mb-8 flex flex-col items-center gap-3 text-center">
			<div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="h-9 w-9 text-primary"
				>
					<path d="M12 2C8 2 6 5 6 8c0 2 .5 3.5 1 5 .5 1.5 1 3.5 1 6 0 1.5 1 3 2 3s2-1.5 2-3v-2c0-1 1-1 1-1s1 0 1 1v2c0 1.5 1 3 2 3s2-1.5 2-3c0-2.5.5-4.5 1-6s1-3 1-5c0-3-2-6-6-6z" />
				</svg>
			</div>
			<div>
				<h1 class="text-2xl font-bold tracking-tight">Welcome to DentVault</h1>
				<p class="mt-1 text-sm text-muted-foreground">
					Choose where to store your patient data.
				</p>
			</div>
		</div>

		<!-- Card -->
		<div class="rounded-xl border bg-card p-6 shadow-sm">
			<h2 class="font-semibold">Set Up Your Vault</h2>
			<p class="mt-1 text-sm text-muted-foreground">
				All patient records, files, X-rays, and the database will be stored in a folder you choose
				on your computer. You can move or back up this folder at any time.
			</p>

			<!-- Folder structure preview -->
			<div class="my-4 rounded-lg border bg-muted/50 p-3 font-mono text-xs text-muted-foreground">
				<p class="font-semibold text-foreground">YourVaultFolder/</p>
				<p class="ml-3">📄 dentvault.db</p>
				<p class="ml-3">📁 Smith_John_PT-ABC/</p>
				<p class="ml-6">📁 xrays/</p>
				<p class="ml-6">📁 photos/</p>
				<p class="ml-6">📁 documents/</p>
				<p class="ml-6">📁 lab_results/</p>
				<p class="ml-6">📁 consents/</p>
				<p class="ml-6">📁 referrals/</p>
				<p class="ml-3">📁 Doe_Jane_PT-DEF/ …</p>
			</div>

			<!-- Folder picker -->
			<div class="flex flex-col gap-2">
				<span class="text-xs font-medium">Vault Location</span>
				<div class="flex gap-2">
					<div
						class="flex-1 truncate rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground"
						title={selectedPath}
					>
						{selectedPath || 'No folder selected'}
					</div>
					<button
						type="button"
						onclick={handlePickFolder}
						class="rounded-md border bg-muted px-3 py-2 text-sm font-medium hover:bg-muted/80 transition-colors shrink-0"
					>
						Browse…
					</button>
				</div>
			</div>

			{#if error}
				<p class="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					{error}
				</p>
			{/if}

			<button
				type="button"
				onclick={handleConfirm}
				disabled={!selectedPath || isSaving}
				class="mt-4 w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
			>
				{isSaving ? 'Setting up vault…' : 'Open Vault'}
			</button>
		</div>

		<p class="mt-4 text-center text-xs text-muted-foreground/60">
			You can change this location later in Settings.
		</p>
	</div>
</div>
