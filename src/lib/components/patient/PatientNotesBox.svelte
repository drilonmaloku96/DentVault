<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getMiscNotes, upsertMiscNotes } from '$lib/services/db';

	let { patientId }: { patientId: string } = $props();

	let content    = $state('');
	let isLoading  = $state(true);
	let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(async () => {
		content   = await getMiscNotes(patientId);
		isLoading = false;
	});

	onDestroy(() => {
		// Flush any pending save on unmount
		if (saveTimer) {
			clearTimeout(saveTimer);
			upsertMiscNotes(patientId, content);
		}
	});

	function handleInput() {
		saveStatus = 'idle';
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(save, 600);
	}

	async function save() {
		saveTimer = null;
		saveStatus = 'saving';
		try {
			await upsertMiscNotes(patientId, content);
			saveStatus = 'saved';
			setTimeout(() => { saveStatus = 'idle'; }, 2000);
		} catch {
			saveStatus = 'idle';
		}
	}
</script>

<!-- Plain scratch-pad editor — no header bar, just a clean textarea that auto-saves -->
<div class="rounded-lg border border-border bg-card overflow-hidden h-full flex flex-col">

	<!-- Save status indicator (minimal) -->
	{#if saveStatus !== 'idle'}
		<div class="text-[10px] px-4 py-1 text-right">
			{#if saveStatus === 'saving'}
				<span class="text-muted-foreground/50">Saving…</span>
			{:else if saveStatus === 'saved'}
				<span class="text-emerald-500">Saved ✓</span>
			{/if}
		</div>
	{/if}

	<!-- Auto-resizing textarea -->
	{#if isLoading}
		<div class="flex-1 min-h-[96px] animate-pulse bg-muted/30 mx-4 mb-3 rounded"></div>
	{:else}
		<textarea
			bind:value={content}
			oninput={handleInput}
			placeholder="Anything goes — allergies, personal context, reminders, observations…"
			class="w-full flex-1 min-h-[96px] resize-none px-4 py-2 pb-3 text-sm bg-transparent outline-none
			       placeholder:text-muted-foreground/35 leading-relaxed text-foreground
			       focus:outline-none"
		></textarea>
	{/if}
</div>
