<script lang="ts">
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { staffRoles } from '$lib/stores/staffRoles.svelte';
	import type { Doctor } from '$lib/types';

	let {
		query,
		onSelect,
		onDismiss,
	}: {
		query: string;
		onSelect: (doc: Doctor) => void;
		onDismiss: () => void;
	} = $props();

	// Only show staff with show_in_doc_bar enabled, sorted: non-doctors first (nurses/assistants), then doctors
	const filtered = $derived.by(() => {
		const q = query.toLowerCase().trim();
		const visible = doctors.list.filter(d => d.show_in_doc_bar !== 0);
		const sorted = [...visible].sort((a, b) => {
			const aIsDoc = a.role === 'doctor';
			const bIsDoc = b.role === 'doctor';
			if (aIsDoc !== bIsDoc) return aIsDoc ? 1 : -1;
			return a.name.localeCompare(b.name);
		});
		if (!q) return sorted;
		return sorted.filter(d =>
			d.name.toLowerCase().includes(q) ||
			(d.specialty ?? '').toLowerCase().includes(q) ||
			d.role.toLowerCase().includes(q),
		);
	});

	let activeIdx = $state(0);

	$effect(() => {
		const _ = filtered;
		activeIdx = 0;
	});

	export function handleKeydown(e: KeyboardEvent): boolean {
		if (filtered.length === 0) return false;
		if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % filtered.length; return true; }
		if (e.key === 'ArrowUp')   { e.preventDefault(); activeIdx = (activeIdx - 1 + filtered.length) % filtered.length; return true; }
		if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); onSelect(filtered[activeIdx]); return true; }
		if (e.key === 'Escape')    { e.preventDefault(); onDismiss(); return true; }
		return false;
	}
</script>

{#if filtered.length > 0}
<div
	class="flex flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
	style="min-width:220px; max-width:300px;"
	role="listbox"
	aria-label="Staff members"
>
	<div class="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
		<span class="text-[10px] text-muted-foreground">
			{#if query}<span class="font-mono text-foreground">@{query}</span> — {/if}
			{filtered.length} Mitarbeiter · ↑↓ navigate · ↵ select
		</span>
	</div>
	<div class="flex flex-col overflow-y-auto" style="max-height:180px;">
		{#each filtered as doc, i}
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
				onclick={() => onSelect(doc)}
			>
				<span class="h-2.5 w-2.5 rounded-full shrink-0 ring-1 ring-black/10" style="background:{doc.color}"></span>
				<span class="text-xs font-medium flex-1 truncate">{staffLabel(doc)}</span>
				{#if doc.specialty}
					<span class="text-[10px] text-muted-foreground shrink-0">{doc.specialty}</span>
				{:else}
					<span class="text-[10px] text-muted-foreground shrink-0">{staffRoles.getLabel(doc.role)}</span>
				{/if}
			</div>
		{/each}
	</div>
</div>
{/if}
