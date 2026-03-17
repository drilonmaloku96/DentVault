<script lang="ts">
	import { textBlocks, type TextBlock } from '$lib/stores/textBlocks.svelte';

	let {
		query,
		onSelect,
		onDismiss,
	}: {
		query: string;
		onSelect: (block: TextBlock) => void;
		onDismiss: () => void;
	} = $props();

	// Filter blocks by query (matches key or label, case-insensitive)
	const filtered = $derived.by(() => {
		const q = query.toLowerCase().trim();
		if (!q) return textBlocks.list;
		return textBlocks.list.filter(
			b => b.key.toLowerCase().includes(q) || b.label.toLowerCase().includes(q),
		);
	});

	let activeIdx = $state(0);

	// Reset index when filter changes
	$effect(() => {
		const _ = filtered;
		activeIdx = 0;
	});

	export function handleKeydown(e: KeyboardEvent): boolean {
		if (filtered.length === 0) return false;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIdx = (activeIdx + 1) % filtered.length;
			return true;
		}
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIdx = (activeIdx - 1 + filtered.length) % filtered.length;
			return true;
		}
		if (e.key === 'Enter' || e.key === 'Tab') {
			e.preventDefault();
			onSelect(filtered[activeIdx]);
			return true;
		}
		if (e.key === 'Escape') {
			e.preventDefault();
			onDismiss();
			return true;
		}
		return false;
	}

	function previewLine(body: string): string {
		const first = body.split('\n')[0].trim();
		return first.length > 55 ? first.slice(0, 52) + '…' : first;
	}
</script>

{#if filtered.length > 0}
	<!-- Palette panel — positioned by parent via CSS wrapper -->
	<div
		class="flex flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
		style="min-width:260px; max-width:340px;"
		role="listbox"
		aria-label="Text blocks"
	>
		<!-- Header hint -->
		<div class="flex items-center gap-1.5 border-b border-border px-3 py-1.5">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 text-muted-foreground shrink-0">
				<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
			</svg>
			<span class="text-[10px] text-muted-foreground">
				{#if query}
					<span class="font-mono text-foreground">/{query}</span> —
				{/if}
				{filtered.length} block{filtered.length !== 1 ? 's' : ''} · ↑↓ navigate · ↵ insert
			</span>
		</div>

		<!-- Block list -->
		<div class="flex flex-col overflow-y-auto" style="max-height:180px;">
			{#each filtered as block, i}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div
					role="option"
					aria-selected={i === activeIdx}
					class={[
						'flex flex-col gap-0.5 px-3 py-2 cursor-pointer transition-colors select-none',
						i === activeIdx
							? 'bg-accent text-accent-foreground'
							: 'hover:bg-accent/50 text-foreground',
						i > 0 ? 'border-t border-border/50' : '',
					].join(' ')}
					onmouseenter={() => (activeIdx = i)}
					onclick={() => onSelect(block)}
				>
					<div class="flex items-center gap-2">
						<span class="text-xs font-semibold leading-tight">{block.label}</span>
						<span class="ml-auto font-mono text-[10px] text-muted-foreground shrink-0">/{block.key}</span>
					</div>
					<span class="text-[11px] text-muted-foreground leading-tight truncate">
						{previewLine(block.body)}
					</span>
				</div>
			{/each}
		</div>
	</div>
{/if}
