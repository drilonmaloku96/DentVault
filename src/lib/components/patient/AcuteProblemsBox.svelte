<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { getAcuteText, upsertAcuteText, getPatientTags, setPatientTags } from '$lib/services/db';
	import { acuteTagOptions } from '$lib/stores/clinicalTags.svelte';
	import { i18n } from '$lib/i18n';

	let {
		patientId,
		onContentChange,
	}: {
		patientId: string;
		onContentChange?: (val: string) => void;
	} = $props();

	let content    = $state('');
	let activeTags = $state<string[]>([]);
	let isLoading  = $state(true);
	let saveStatus = $state<'idle' | 'saving' | 'saved'>('idle');
	let saveTimer: ReturnType<typeof setTimeout> | null = null;

	// Tag search
	let searching           = $state(false);
	let searchQuery         = $state('');
	let selectedIdx         = $state(0);
	let searchInputEl       = $state<HTMLInputElement | null>(null);
	let triggerFromTextarea = $state(false);

	// Plain ref — populated from event currentTarget, avoids bind:this timing issues
	let textareaEl: HTMLTextAreaElement | null = null;
	let triggerPos = -1;

	const suggestions = $derived(
		acuteTagOptions.list
			.filter(t => {
				const isActive = activeTags.includes(t.key) || activeTags.includes(acuteTagOptions.displayLabel(t));
				if (isActive) return false;
				if (!searchQuery.trim()) return true;
				return acuteTagOptions.displayLabel(t).toLowerCase().includes(searchQuery.toLowerCase());
			})
			.slice(0, 8)
	);

	onMount(async () => {
		[content, activeTags] = await Promise.all([
			getAcuteText(patientId),
			getPatientTags(patientId, 'acute'),
		]);
		isLoading = false;
		onContentChange?.(content);
	});

	onDestroy(() => {
		if (saveTimer) {
			clearTimeout(saveTimer);
			upsertAcuteText(patientId, content);
		}
	});

	// ── Textarea input handler — always called with the live Event ────────────

	function handleInput(e: Event) {
		const ta = e.currentTarget as HTMLTextAreaElement;
		textareaEl = ta; // keep ref fresh from the event itself

		saveStatus = 'idle';
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(save, 600);
		onContentChange?.(content);

		// Check for inline + trigger
		const pos = ta.selectionStart ?? 0;
		// ta.value is always current — oninput fires after the character is inserted
		const match = ta.value.slice(0, pos).match(/\+(\S*)$/);

		if (match) {
			if (!searching || !triggerFromTextarea) {
				triggerPos = pos - match[0].length;
				searching = true;
				triggerFromTextarea = true;
			}
			searchQuery = match[1];
			selectedIdx = 0;
		} else if (triggerFromTextarea) {
			// Space typed or + deleted — exit, leave text as-is
			searching = false;
			triggerFromTextarea = false;
			triggerPos = -1;
			searchQuery = '';
			selectedIdx = 0;
		}
	}

	async function save() {
		saveTimer = null;
		saveStatus = 'saving';
		try {
			await upsertAcuteText(patientId, content);
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
		await setPatientTags(patientId, 'acute', next);
	}

	// ── Keyboard navigation while in inline trigger mode ─────────────────────

	function handleTextareaKeydown(e: KeyboardEvent) {
		if (!searching || !triggerFromTextarea) return;
		textareaEl = e.currentTarget as HTMLTextAreaElement;

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIdx = Math.min(selectedIdx + 1, suggestions.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIdx = Math.max(selectedIdx - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const tag = suggestions[selectedIdx];
			if (tag) addSuggestionFromTextarea(tag);
		} else if (e.key === 'Escape') {
			searching = false;
			triggerFromTextarea = false;
			triggerPos = -1;
			searchQuery = '';
			selectedIdx = 0;
		}
		// Space: falls through → oninput fires → regex fails → exits trigger
	}

	async function addSuggestionFromTextarea(tag: (typeof acuteTagOptions.list)[number]) {
		const ta = textareaEl;
		if (ta && triggerPos >= 0) {
			const val = ta.value;
			const cur = ta.selectionStart ?? val.length;
			content = val.slice(0, triggerPos) + val.slice(cur);
			searching = false;
			triggerFromTextarea = false;
			const savedPos = triggerPos;
			triggerPos = -1;
			searchQuery = '';
			selectedIdx = 0;
			await tick();
			ta.setSelectionRange(savedPos, savedPos);
		}
		await toggleTag(tag.key);
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(save, 600);
		onContentChange?.(content);
	}

	// ── + button triggered search ─────────────────────────────────────────────

	async function startSearch() {
		searching = true;
		triggerFromTextarea = false;
		triggerPos = -1;
		searchQuery = '';
		selectedIdx = 0;
		await tick();
		searchInputEl?.focus();
	}

	function cancelSearch() {
		searching = false;
		searchQuery = '';
		selectedIdx = 0;
		triggerFromTextarea = false;
		triggerPos = -1;
	}

	async function addSuggestion(tag: (typeof acuteTagOptions.list)[number]) {
		await toggleTag(tag.key);
		cancelSearch();
	}

	async function handleSuggestionClick(tag: (typeof acuteTagOptions.list)[number]) {
		if (triggerFromTextarea) {
			await addSuggestionFromTextarea(tag);
		} else {
			await addSuggestion(tag);
		}
	}

	function handleSearchKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') { cancelSearch(); return; }
		if (e.key === 'Enter') {
			e.preventDefault();
			const tag = suggestions[selectedIdx];
			if (tag) addSuggestion(tag);
			return;
		}
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIdx = Math.min(selectedIdx + 1, suggestions.length - 1);
			return;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIdx = Math.max(selectedIdx - 1, 0);
			return;
		}
	}
</script>

<div class="rounded-lg border border-red-200 dark:border-red-800 overflow-hidden h-full flex flex-col">

	<!-- Title + save status row -->
	<div class="flex items-center justify-between px-4 pt-3 pb-1 shrink-0">
		<span class="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wide select-none">
			{i18n.t.patients.acuteProblems}
		</span>
		<span class="text-[10px] min-w-[3rem] text-right transition-opacity duration-300 {saveStatus === 'idle' ? 'opacity-0' : 'opacity-100'}">
			{#if saveStatus === 'saving'}
				<span class="text-muted-foreground/50">{i18n.t.common.loading}</span>
			{:else if saveStatus === 'saved'}
				<span class="text-emerald-500">{i18n.t.settings.saved}</span>
			{/if}
		</span>
	</div>

	<!-- Textarea -->
	{#if isLoading}
		<div class="flex-1 animate-pulse bg-red-50/50 mx-4 mb-3 rounded"></div>
	{:else}
		<textarea
			bind:value={content}
			oninput={handleInput}
			onkeydown={handleTextareaKeydown}
			onblur={() => { if (triggerFromTextarea) cancelSearch(); }}
			placeholder={i18n.t.patients.acuteProblemPlaceholder}
			class="w-full flex-1 min-h-0 resize-none px-4 py-2 text-sm bg-transparent outline-none
			       placeholder:text-red-300/50 leading-relaxed text-foreground focus:outline-none"
		></textarea>
	{/if}

	<!-- Tag area -->
	{#if acuteTagOptions.loaded}
		<div class="shrink-0 flex flex-col gap-1.5 px-4 pb-3 pt-1 border-t border-red-100 dark:border-red-900/30">

			<!-- Suggestions row (while searching by either method) -->
			{#if searching}
				<div class="flex flex-wrap gap-1.5 min-h-[22px]">
					{#if suggestions.length > 0}
						{#each suggestions as tag, i}
							<button
								type="button"
								onmousedown={(e) => e.preventDefault()}
								onclick={() => handleSuggestionClick(tag)}
								class={[
									'rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all select-none',
									i === selectedIdx
										? 'border-red-500 bg-red-500 text-white'
										: 'border-red-200 dark:border-red-800 text-red-500/70 hover:border-red-400 hover:text-red-600',
								].join(' ')}
							>
								{acuteTagOptions.displayLabel(tag)}
							</button>
						{/each}
					{:else}
						<span class="text-[11px] text-muted-foreground/50 italic leading-[22px]">No matching tags</span>
					{/if}
				</div>
			{/if}

			<!-- Active tags + search input / + button row -->
			<div class="flex flex-wrap items-center gap-1.5">
				{#each acuteTagOptions.list as tag}
					{@const active = activeTags.includes(tag.key) || activeTags.includes(acuteTagOptions.displayLabel(tag))}
					{#if active}
						<button
							type="button"
							onclick={() => toggleTag(tag.key)}
							class="rounded-full border border-red-500 bg-red-500 text-white px-2.5 py-0.5 text-[11px] font-medium flex items-center gap-1 hover:bg-red-600 transition-colors select-none"
						>
							{acuteTagOptions.displayLabel(tag)}<span class="opacity-60">×</span>
						</button>
					{/if}
				{/each}

				{#if searching && !triggerFromTextarea}
					<input
						bind:this={searchInputEl}
						bind:value={searchQuery}
						type="text"
						placeholder="Search tags…"
						oninput={() => { selectedIdx = 0; }}
						onkeydown={handleSearchKeydown}
						onblur={cancelSearch}
						class="rounded-full border border-red-400 bg-background px-2.5 py-0.5 text-[11px] font-medium text-foreground outline-none w-28"
					/>
				{:else if !searching}
					<button
						type="button"
						onclick={startSearch}
						class="rounded-full border border-dashed border-red-300 dark:border-red-700 px-2.5 py-0.5 text-[11px] text-red-400 hover:border-red-500 hover:text-red-600 transition-colors select-none"
					>
						+
					</button>
				{/if}
			</div>

		</div>
	{/if}
</div>
