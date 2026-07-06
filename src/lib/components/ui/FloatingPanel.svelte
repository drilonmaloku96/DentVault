<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import type { Snippet } from 'svelte';

	let {
		title,
		onclose,
		children,
		initialX = 400,
		initialY = 90,
	}: {
		title: string;
		onclose?: () => void;
		children: Snippet;
		initialX?: number;
		initialY?: number;
	} = $props();

	let x = $state(untrack(() => initialX));
	let y = $state(untrack(() => initialY));
	let width = $state(420);
	let height = $state(420);
	let dragging = $state(false);
	let dragOffsetX = 0;
	let dragOffsetY = 0;
	let dimmed = $state(false);
	let el = $state<HTMLElement | null>(null);
	let ro: ResizeObserver | null = null;

	function onHeaderPointerDown(e: PointerEvent) {
		if ((e.target as HTMLElement).closest('button')) return;
		dragging = true;
		dragOffsetX = e.clientX - x;
		dragOffsetY = e.clientY - y;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function onHeaderPointerMove(e: PointerEvent) {
		if (!dragging) return;
		x = e.clientX - dragOffsetX;
		y = e.clientY - dragOffsetY;
	}

	function onHeaderPointerUp() {
		dragging = false;
	}

	function handleDocWheel() {
		dimmed = true;
	}

	function handleDocMouseDown(e: MouseEvent) {
		if (!el || el.contains(e.target as Node)) return;
		dimmed = true;
	}

	function handlePanelMouseEnter() {
		dimmed = false;
	}

	onMount(() => {
		document.addEventListener('wheel', handleDocWheel, { passive: true, capture: true });
		document.addEventListener('mousedown', handleDocMouseDown, true);
		if (el) {
			ro = new ResizeObserver(() => {
				if (!el) return;
				width = el.offsetWidth;
				height = el.offsetHeight;
			});
			ro.observe(el);
		}
	});

	onDestroy(() => {
		document.removeEventListener('wheel', handleDocWheel, { capture: true });
		document.removeEventListener('mousedown', handleDocMouseDown, true);
		ro?.disconnect();
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={el}
	class="fixed z-50 flex flex-col rounded-lg border border-border bg-background shadow-2xl"
	style="left: {x}px; top: {y}px; width: {width}px; height: {height}px; min-width: 240px; min-height: 160px; opacity: {dimmed ? 0.4 : 1}; transition: opacity 200ms ease; resize: both; overflow: hidden;"
	onmouseenter={handlePanelMouseEnter}
>
	<!-- Drag handle / title bar -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/30 select-none shrink-0"
		style="cursor: {dragging ? 'grabbing' : 'grab'};"
		onpointerdown={onHeaderPointerDown}
		onpointermove={onHeaderPointerMove}
		onpointerup={onHeaderPointerUp}
	>
		<span class="text-sm font-semibold text-foreground">{title}</span>
		<button
			type="button"
			onclick={onclose}
			class="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
			aria-label="Close"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
				<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
			</svg>
		</button>
	</div>

	<!-- Scrollable content area -->
	<div class="flex-1 overflow-y-auto min-h-0">
		{@render children()}
	</div>

	<!-- Resize handle indicator -->
	<div class="absolute bottom-1 right-1 pointer-events-none" aria-hidden="true">
		<svg width="10" height="10" viewBox="0 0 10 10" fill="none" class="text-primary opacity-40">
			<line x1="9" y1="2" x2="2" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
			<line x1="9" y1="5" x2="5" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
			<line x1="9" y1="8" x2="8" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
		</svg>
	</div>
</div>
