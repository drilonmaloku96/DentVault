<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';

	let {
		items,
		label,
		placeholder = 'Add item…',
		variant = 'default',
		onUpdate,
	}: {
		items: string[];
		label: string;
		placeholder?: string;
		variant?: 'default' | 'danger' | 'warning' | 'info';
		onUpdate: (items: string[]) => void;
	} = $props();

	let newItem = $state('');

	const badgeClasses: Record<string, string> = {
		default: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300',
		danger: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300',
		warning: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400',
		info: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300',
	};

	function addItem() {
		const trimmed = newItem.trim();
		if (!trimmed || items.includes(trimmed)) return;
		onUpdate([...items, trimmed]);
		newItem = '';
	}

	function removeItem(item: string) {
		onUpdate(items.filter((i) => i !== item));
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			addItem();
		}
	}
</script>

<div class="flex flex-col gap-2">
	<p class="text-sm font-medium">{label}</p>

	<!-- Existing items -->
	{#if items.length > 0}
		<div class="flex flex-wrap gap-1.5">
			{#each items as item}
				<span
					class={cn(
						'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
						badgeClasses[variant] ?? badgeClasses.default,
					)}
				>
					{item}
					<button
						type="button"
						onclick={() => removeItem(item)}
						class="ml-0.5 rounded-full opacity-60 hover:opacity-100 focus:outline-none"
						aria-label="Remove {item}"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
							<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
						</svg>
					</button>
				</span>
			{/each}
		</div>
	{:else}
		<p class="text-xs text-muted-foreground">None recorded.</p>
	{/if}

	<!-- Add new item -->
	<div class="flex gap-2">
		<Input
			{placeholder}
			bind:value={newItem}
			onkeydown={handleKeydown}
			class="h-8 text-sm"
		/>
		<Button type="button" variant="outline" size="sm" onclick={addItem} class="shrink-0">
			Add
		</Button>
	</div>
</div>
