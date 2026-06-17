<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { getMedicalText, upsertMedicalText, getPatientTags, setPatientTags } from '$lib/services/db';
	import { medicalTagOptions, type ClinicalTag } from '$lib/stores/clinicalTags.svelte';
	import { i18n } from '$lib/i18n';

	let { patientId }: { patientId: string } = $props();

	let content    = $state('');
	let activeTags = $state<string[]>([]);
	let isLoading  = $state(true);
	let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let textareaEl = $state<HTMLTextAreaElement | null>(null);

	// ── # trigger inside textarea ────────────────────────────────────────
	let hashQuery       = $state('');
	let hashMatchStart  = $state(0);
	let hashMatchEnd    = $state(0);
	let showHashPalette = $state(false);
	let hashActiveIdx   = $state(0);

	const hashSuggestions = $derived.by(() => {
		const q = hashQuery.toLowerCase();
		const list = medicalTagOptions.list;
		if (!q) return list.slice(0, 8);
		return list.filter(t => medicalTagOptions.displayLabel(t).toLowerCase().includes(q));
	});

	const hashShowCreate = $derived(
		hashQuery.trim().length > 0 &&
		!hashSuggestions.some(t =>
			medicalTagOptions.displayLabel(t).toLowerCase() === hashQuery.toLowerCase().trim(),
		),
	);

	$effect(() => { hashSuggestions; hashActiveIdx = 0; });

	onMount(async () => {
		await medicalTagOptions.load();
		[content, activeTags] = await Promise.all([
			getMedicalText(patientId),
			getPatientTags(patientId, 'medical'),
		]);
		isLoading = false;
		await tick();
		autoResize();
	});

	onDestroy(() => {
		if (saveTimer) { clearTimeout(saveTimer); upsertMedicalText(patientId, content); }
	});

	function autoResize() {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		textareaEl.style.height = textareaEl.scrollHeight + 'px';
	}

	function handleInput() {
		saveStatus = 'idle';
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(save, 600);
		autoResize();
		checkHashTrigger();
	}

	function checkHashTrigger() {
		if (!textareaEl) return;
		const pos = textareaEl.selectionStart ?? 0;
		const before = content.slice(0, pos);
		const match = before.match(/#([^\s#]*)$/);
		if (match) {
			hashQuery      = match[1];
			hashMatchStart = pos - match[0].length;
			hashMatchEnd   = pos;
			showHashPalette = true;
		} else {
			showHashPalette = false;
			hashQuery = '';
		}
	}

	function handleTextareaKeydown(e: KeyboardEvent) {
		if (!showHashPalette) return;
		const total = hashSuggestions.length + (hashShowCreate ? 1 : 0);
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			hashActiveIdx = (hashActiveIdx + 1) % (total || 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			hashActiveIdx = (hashActiveIdx - 1 + (total || 1)) % (total || 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (hashActiveIdx < hashSuggestions.length) {
				selectHashCondition(hashSuggestions[hashActiveIdx]);
			} else if (hashShowCreate) {
				createAndSelectHashCondition(hashQuery.trim());
			} else if (hashSuggestions.length > 0) {
				selectHashCondition(hashSuggestions[0]);
			}
		} else if (e.key === 'Escape') {
			showHashPalette = false;
			hashQuery = '';
		}
	}

	async function selectHashCondition(tag: ClinicalTag) {
		const label = medicalTagOptions.displayLabel(tag);
		const before = content.slice(0, hashMatchStart);
		const after   = content.slice(hashMatchEnd);
		content = before + '#' + label + after;
		if (!activeTags.includes(tag.key)) await toggleTag(tag.key);
		showHashPalette = false; hashQuery = '';
		await tick();
		const newPos = hashMatchStart + 1 + label.length;
		textareaEl?.setSelectionRange(newPos, newPos);
		save();
	}

	async function createAndSelectHashCondition(label: string) {
		if (!label) return;
		const newTag: ClinicalTag = { key: `custom_${Date.now()}`, label };
		await medicalTagOptions.save([...medicalTagOptions.list, newTag]);
		await selectHashCondition(newTag);
	}

	async function save() {
		saveTimer = null;
		saveStatus = 'saving';
		try {
			await upsertMedicalText(patientId, content);
			saveStatus = 'saved';
			setTimeout(() => { saveStatus = 'idle'; }, 2000);
		} catch { saveStatus = 'idle'; }
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

	<!-- Title + save status -->
	<div class="flex items-center justify-between px-4 pt-3 pb-1">
		<span class="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide select-none">
			{i18n.t.patients.medicalHistory}
		</span>
		<span class="text-[10px] min-w-[3rem] text-right transition-opacity duration-300 {saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'}">
			{#if saveStatus === 'saving'}<span class="text-muted-foreground/50">{i18n.t.common.loading}</span>
			{:else if saveStatus === 'saved'}<span class="text-emerald-500">{i18n.t.settings.saved}</span>
			{/if}
		</span>
	</div>

	<!-- Auto-growing textarea -->
	{#if isLoading}
		<div class="h-20 animate-pulse bg-amber-50/50 mx-4 mb-3 rounded"></div>
	{:else}
		<textarea
			bind:this={textareaEl}
			bind:value={content}
			oninput={handleInput}
			onkeydown={handleTextareaKeydown}
			placeholder={i18n.t.patients.medicalHistoryPlaceholder + '\n# to tag conditions'}
			rows={3}
			class="w-full max-w-full resize-none overflow-x-hidden px-4 py-2 text-sm bg-transparent outline-none
			       placeholder:text-amber-300/50 leading-relaxed text-foreground focus:outline-none"
		></textarea>
	{/if}

	<!-- # palette (inline flow — won't be clipped) -->
	{#if showHashPalette && (hashSuggestions.length > 0 || hashShowCreate)}
		<div class="mx-4 mb-2 rounded-md border border-border bg-popover shadow-sm overflow-hidden">
			<div class="px-3 py-1 border-b border-border/50 text-[10px] text-muted-foreground">
				{#if hashQuery}<span class="font-mono text-foreground">#{hashQuery}</span> — {/if}type to search conditions
			</div>
			{#each hashSuggestions as tag, i}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					role="option"
					aria-selected={i === hashActiveIdx}
					class={[
						'flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none text-xs transition-colors',
						i === hashActiveIdx ? 'bg-amber-50 dark:bg-amber-950/20' : 'hover:bg-muted/50',
						i > 0 ? 'border-t border-border/40' : '',
					].join(' ')}
					onmouseenter={() => (hashActiveIdx = i)}
					onmousedown={(e) => { e.preventDefault(); selectHashCondition(tag); }}
				>
					<span class="flex-1 truncate">{medicalTagOptions.displayLabel(tag)}</span>
					{#if activeTags.includes(tag.key)}
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3 w-3 text-amber-500 shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
				</div>
			{/each}
			{#if hashShowCreate}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					role="option"
					aria-selected={hashActiveIdx === hashSuggestions.length}
					class={[
						'flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none text-xs border-t border-border/40 transition-colors',
						hashActiveIdx === hashSuggestions.length ? 'bg-amber-50 dark:bg-amber-950/20' : 'hover:bg-muted/50',
					].join(' ')}
					onmouseenter={() => (hashActiveIdx = hashSuggestions.length)}
					onmousedown={(e) => { e.preventDefault(); createAndSelectHashCondition(hashQuery.trim()); }}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3 w-3 shrink-0 text-muted-foreground"><path d="M12 5v14M5 12h14"/></svg>
					<span class="flex-1">
						<span class="text-muted-foreground">{i18n.t.patients.createCondition} </span>
						<span class="font-medium">"{hashQuery.trim()}"</span>
					</span>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Active condition tags -->
	{#if medicalTagOptions.loaded && activeTags.length > 0}
		<div class="px-4 pb-3 flex flex-wrap gap-1.5">
			{#each activeTags as tagKey (tagKey)}
				{@const tag = medicalTagOptions.list.find(t => t.key === tagKey)}
				{@const label = tag ? medicalTagOptions.displayLabel(tag) : tagKey}
				<button
					type="button"
					onclick={() => toggleTag(tagKey)}
					class="inline-flex items-center gap-1 rounded-full border border-amber-500 bg-amber-500 text-white px-2.5 py-0.5 text-[11px] font-medium hover:bg-amber-600 transition-colors select-none"
				>
					{label}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="h-2.5 w-2.5 opacity-70"><path d="M18 6L6 18M6 6l12 12"/></svg>
				</button>
			{/each}
		</div>
	{/if}
</div>
