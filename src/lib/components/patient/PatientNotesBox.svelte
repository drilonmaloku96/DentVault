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
<div class="rounded-lg border border-border bg-card overflow-hidden">

	<!-- Minimal title + save status row -->
	<div class="flex items-center justify-between px-4 pt-3 pb-1">
		<span class="text-xs font-medium text-muted-foreground/70 uppercase tracking-wide select-none">
			Miscellaneous Notes
		</span>
		<span class="text-[10px] min-w-[3rem] text-right transition-opacity duration-300 {saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'}">
			{#if saveStatus === 'saving'}
				<span class="text-muted-foreground/50">Saving…</span>
			{:else if saveStatus === 'saved'}
				<span class="text-emerald-500">Saved ✓</span>
			{/if}
		</span>
	</div>

	<!-- Auto-resizing textarea -->
	{#if isLoading}
		<div class="h-24 animate-pulse bg-muted/30 mx-4 mb-3 rounded"></div>
	{:else}
		<textarea
			bind:value={content}
			oninput={handleInput}
			placeholder="Anything goes — allergies, personal context, reminders, observations…"
			rows={5}
			class="w-full resize-y px-4 py-2 pb-3 text-sm bg-transparent outline-none
			       placeholder:text-muted-foreground/35 leading-relaxed text-foreground
			       focus:outline-none"
		></textarea>
	{/if}
</div>
