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
	data-slot="alert-description"
	class={cn('text-muted-foreground col-start-2 grid justify-items-start gap-1 text-sm [&_p]:leading-relaxed', className)}
	{...restProps}
>
	{@render children?.()}
</div>
