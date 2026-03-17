<script lang="ts">
	import { cn } from '$lib/utils.js';
	import type { Snippet } from 'svelte';

	let {
		class: className,
		children,
		...restProps
	}: { class?: string; children?: Snippet } = $props();
</script>

<div
	data-slot="alert-title"
	class={cn('col-start-2 font-medium leading-none tracking-tight', className)}
	{...restProps}
>
	{@render children?.()}
</div>
