<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { getMedicalText, upsertMedicalText, getPatientTags, setPatientTags } from '$lib/services/db';
	import { medicalTagOptions } from '$lib/stores/clinicalTags.svelte';
	import { i18n } from '$lib/i18n';

	let { patientId }: { patientId: string } = $props();

	let content    = $state('');
	let activeTags = $state<string[]>([]);
	let isLoading  = $state(true);
	let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	onMount(async () => {
		[content, activeTags] = await Promise.all([
			getMedicalText(patientId),
			getPatientTags(patientId, 'medical'),
		]);
		isLoading = false;
	});

	onDestroy(() => {
		if (saveTimer) {
			clearTimeout(saveTimer);
			upsertMedicalText(patientId, content);
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
			await upsertMedicalText(patientId, content);
			saveStatus = 'saved';
			setTimeout(() => { saveStatus = 'idle'; }, 2000);
		} catch {
			saveStatus = 'idle';
		}
	}

	async function toggleTag(tagKey: string) {
		const next = activeTags.includes(tagKey)
			? activeTags.filter(t => t !== tagKey)
			: [...activeTags, tagKey];
		activeTags = next;
		await setPatientTags(patientId, 'medical', next);
	}
</script>

<div class="rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden">

	<!-- Minimal title + save status row -->
	<div class="flex items-center justify-between px-4 pt-3 pb-1">
		<span class="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide select-none">
			{i18n.t.patients.medicalHistory}
		</span>
		<span class="text-[10px] min-w-[3rem] text-right transition-opacity duration-300 {saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'}">
			{#if saveStatus === 'saving'}
				<span class="text-muted-foreground/50">{i18n.t.common.loading}</span>
			{:else if saveStatus === 'saved'}
				<span class="text-emerald-500">{i18n.t.settings.saved}</span>
			{/if}
		</span>
	</div>

	<!-- Auto-resizing textarea -->
	{#if isLoading}
		<div class="h-20 animate-pulse bg-amber-50/50 mx-4 mb-3 rounded"></div>
	{:else}
		<textarea
			bind:value={content}
			oninput={handleInput}
			placeholder="Allgemeinerkrankungen, Medikamente, Allergien, Risikofaktoren…"
			rows={4}
			class="w-full resize-y px-4 py-2 text-sm bg-transparent outline-none
			       placeholder:text-amber-300/50 leading-relaxed text-foreground
			       focus:outline-none"
		></textarea>
	{/if}

	<!-- Tag chips -->
	{#if medicalTagOptions.loaded && medicalTagOptions.list.length > 0}
		<div class="flex flex-wrap gap-1.5 px-4 pb-3">
			{#each medicalTagOptions.list as tag}
				{@const active = activeTags.includes(tag.key) || activeTags.includes(medicalTagOptions.displayLabel(tag))}
				<button
					type="button"
					onclick={() => toggleTag(tag.key)}
					class={[
						'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all select-none',
						active
							? 'border-amber-500 bg-amber-500 text-white'
							: 'border-amber-200 dark:border-amber-800 text-amber-500/70 hover:border-amber-400 hover:text-amber-600',
					].join(' ')}
				>
					{medicalTagOptions.displayLabel(tag)}
				</button>
			{/each}
		</div>
	{/if}
</div>
