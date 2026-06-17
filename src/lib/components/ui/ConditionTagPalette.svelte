<script lang="ts">
	import { acuteTagOptions, medicalTagOptions, type ClinicalTag } from '$lib/stores/clinicalTags.svelte';
	import { i18n } from '$lib/i18n';

	let {
		query,
		onSelect,
		onCreateNew,
		onDismiss,
	}: {
		query: string;
		onSelect: (tag: ClinicalTag, label: string) => void;
		onCreateNew: (label: string) => void;
		onDismiss: () => void;
	} = $props();

	interface TagEntry { tag: ClinicalTag; label: string; category: 'acute' | 'medical'; }

	const allTags = $derived.by((): TagEntry[] => {
		const acute   = acuteTagOptions.list.map(t   => ({ tag: t, label: acuteTagOptions.displayLabel(t),   category: 'acute'   as const }));
		const medical = medicalTagOptions.list.map(t => ({ tag: t, label: medicalTagOptions.displayLabel(t), category: 'medical' as const }));
		return [...acute, ...medical];
	});

	const filtered = $derived.by(() => {
		const q = query.toLowerCase().trim();
		if (!q) return allTags.slice(0, 10);
		return allTags.filter(e => e.label.toLowerCase().includes(q));
	});

	const showCreate = $derived(
		query.trim().length > 0 &&
		!filtered.some(e => e.label.toLowerCase() === query.toLowerCase().trim()),
	);

	let activeIdx = $state(0);

	$effect(() => {
		const _ = filtered;
		activeIdx = 0;
	});

	const total = $derived(filtered.length + (showCreate ? 1 : 0));

	export function handleKeydown(e: KeyboardEvent): boolean {
		if (total === 0 && !showCreate) return false;
		if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % total; return true; }
		if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = (activeIdx - 1 + total) % total; return true; }
		if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault();
			if (activeIdx < filtered.length) {
				const entry = filtered[activeIdx];
				onSelect(entry.tag, entry.label);
			} else if (showCreate) {
				onCreateNew(query.trim());
			}
			return true;
		}
		if (e.key === 'Escape') { e.preventDefault(); onDismiss(); return true; }
		return false;
	}
</script>

{#if filtered.length > 0 || showCreate}
<div
	class="flex flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
	style="min-width:220px; max-width:300px;"
	role="listbox"
	aria-label="Conditions"
>
	<div class="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
		<span class="text-[10px] text-muted-foreground">
			{#if query}<span class="font-mono text-foreground">#{query}</span> — {/if}
			{filtered.length} condition{filtered.length !== 1 ? 's' : ''}
		</span>
	</div>
	<div class="flex flex-col overflow-y-auto" style="max-height:180px;">
		{#each filtered as entry, i}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				role="option"
				aria-selected={i === activeIdx}
				class={[
					'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors select-none',
					i === activeIdx ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
					i > 0 ? 'border-t border-border/50' : '',
				].join(' ')}
				onmouseenter={() => (activeIdx = i)}
				onclick={() => onSelect(entry.tag, entry.label)}
			>
				<span class="text-xs font-medium flex-1 truncate">{entry.label}</span>
				<span class={[
					'text-[10px] px-1.5 py-px rounded font-medium shrink-0',
					entry.category === 'acute'
						? 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400'
						: 'bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400',
				].join(' ')}>
					{entry.category === 'acute' ? 'Acute' : 'Medical'}
				</span>
			</div>
		{/each}

		{#if showCreate}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<div
				role="option"
				aria-selected={activeIdx === filtered.length}
				class={[
					'flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors select-none border-t border-border/50',
					activeIdx === filtered.length ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
				].join(' ')}
				onmouseenter={() => (activeIdx = filtered.length)}
				onclick={() => onCreateNew(query.trim())}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3 w-3 shrink-0 text-muted-foreground">
					<path d="M12 5v14M5 12h14"/>
				</svg>
				<span class="text-xs flex-1 truncate">
					<span class="text-muted-foreground">{i18n.t.patients.createCondition} </span>
					<span class="font-medium">"{query.trim()}"</span>
				</span>
			</div>
		{/if}
	</div>
</div>
{/if}
