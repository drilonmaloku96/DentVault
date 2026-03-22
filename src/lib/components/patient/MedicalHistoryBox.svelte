<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { getMedicalText, upsertMedicalText, getPatientTags, setPatientTags } from '$lib/services/db';
	import { medicalTagOptions } from '$lib/stores/clinicalTags.svelte';
	import { i18n } from '$lib/i18n';

	let { patientId }: { patientId: string } = $props();

	let content    = $state('');
	let activeTags = $state<string[]>([]);
	let isLoading  = $state(true);
	let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	// ── New tag inline input ─────────────────────────────────────────────
	let addingTag  = $state(false);
	let newTagName = $state('');
	let tagInput   = $state<HTMLInputElement | null>(null);

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

	async function startAddTag() {
		addingTag = true;
		newTagName = '';
		await tick();
		tagInput?.focus();
	}

	async function confirmAddTag() {
		const label = newTagName.trim();
		if (!label) { cancelAddTag(); return; }
		const newTag = { key: `custom_${Date.now()}`, label };
		await medicalTagOptions.save([...medicalTagOptions.list, newTag]);
		// auto-activate for this patient
		await toggleTag(newTag.key);
		cancelAddTag();
	}

	function cancelAddTag() {
		addingTag = false;
		newTagName = '';
	}
</script>

<div class="rounded-lg border border-amber-200 dark:border-amber-800 overflow-hidden">

	<!-- Title + save status row -->
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

	<!-- Tag chips + add button -->
	{#if medicalTagOptions.loaded}
		<div class="flex flex-wrap items-center gap-1.5 px-4 pb-3">
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

			{#if addingTag}
				<input
					bind:this={tagInput}
					bind:value={newTagName}
					type="text"
					placeholder="Tag name…"
					onkeydown={(e) => { if (e.key === 'Enter') confirmAddTag(); else if (e.key === 'Escape') cancelAddTag(); }}
					onblur={confirmAddTag}
					class="rounded-full border border-amber-400 bg-background px-2.5 py-0.5 text-[11px] font-medium text-foreground outline-none w-28"
				/>
			{:else}
				<button
					type="button"
					onclick={startAddTag}
					title="Add tag"
					class="rounded-full border border-dashed border-amber-300 dark:border-amber-700 px-2 py-0.5 text-[11px] text-amber-400 hover:border-amber-500 hover:text-amber-600 transition-colors select-none"
				>
					+ Add
				</button>
			{/if}
		</div>
	{/if}
</div>
