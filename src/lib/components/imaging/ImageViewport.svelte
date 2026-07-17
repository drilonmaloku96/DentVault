<script lang="ts">
	import type { Snippet } from 'svelte';
	import { i18n } from '$lib/i18n';

	let {
		imageDataUrl,
		naturalWidth,
		naturalHeight,
		brightness = $bindable(100),
		contrast = $bindable(100),
		hintText = '',
		alt = '',
		children,
		overlayChrome,
		onImageLoad,
		onImageClick,
	}: {
		imageDataUrl: string;
		naturalWidth: number;
		naturalHeight: number;
		brightness?: number;
		contrast?: number;
		hintText?: string;
		alt?: string;
		/** Overlay content, rendered in NATURAL-IMAGE pixel space inside the transformed container. */
		children?: Snippet;
		/** Fixed chrome (e.g. a flip button) rendered on top of the viewer, outside the transform. */
		overlayChrome?: Snippet;
		/** Fired once the image loads, reporting its natural pixel dimensions. */
		onImageLoad?: (naturalWidth: number, naturalHeight: number) => void;
		/** Fired on a plain left click (no drag-adjust mode, movement below threshold) with NATURAL-IMAGE pixel coords. */
		onImageClick?: (x: number, y: number) => void;
	} = $props();

	// ── Viewer state (matches Cephalyzer's ImageCanvas interaction model) ──
	let scale = $state(1);
	let tx = $state(0);
	let ty = $state(0);

	type DragAdjustMode = 'zoom' | 'brightness' | 'contrast';
	let dragAdjustMode = $state<DragAdjustMode | null>(null);
	let isPanning = $state(false);
	let isDragAdjusting = $state(false);
	let dragStartX = 0;
	let dragStartValue = 0;
	let lastPanX = 0;
	let lastPanY = 0;

	// Click detection (place-landmark): track the down position + accumulated movement.
	let clickCandidate = false;
	let downX = 0;
	let downY = 0;
	let movedDist = 0;

	let viewerEl = $state<HTMLDivElement | null>(null);
	let wrapperEl = $state<HTMLDivElement | null>(null);
	let viewerW = $state(0);
	let viewerH = $state(0);
	let imageLoaded = $state(false);

	const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

	/**
	 * Root-zoom coordinate rule (CLAUDE.md): uiScale sets `zoom` on <html>, so
	 * pointer clientX/Y deltas are visual px while translate values are layout px —
	 * divide pointer deltas by the root zoom factor.
	 */
	function rootZoom(): number {
		return parseFloat(document.documentElement.style.zoom || '1') || 1;
	}

	/** object-contain fit factor so the natural-sized wrapper fits the viewer at scale = 1. */
	const baseScale = $derived(
		naturalWidth > 0 && naturalHeight > 0 && viewerW > 0 && viewerH > 0
			? Math.min(viewerW / naturalWidth, viewerH / naturalHeight)
			: 1,
	);

	function isTypingTarget(t: EventTarget | null): boolean {
		const el = t as HTMLElement | null;
		if (!el || !el.tagName) return false;
		const tag = el.tagName.toLowerCase();
		return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (isTypingTarget(e.target)) return;
		const key = e.key.toLowerCase();
		if (key === 'b' && !e.ctrlKey && !e.metaKey) {
			dragAdjustMode = dragAdjustMode === 'brightness' ? null : 'brightness';
		} else if (key === 'c' && !e.ctrlKey && !e.metaKey) {
			dragAdjustMode = dragAdjustMode === 'contrast' ? null : 'contrast';
		} else if (key === 'z' && !e.ctrlKey && !e.metaKey) {
			dragAdjustMode = dragAdjustMode === 'zoom' ? null : 'zoom';
		} else if (key === 'escape' && dragAdjustMode) {
			// Clear the mode and consume the key so FullScreenView doesn't also close
			dragAdjustMode = null;
			e.preventDefault();
		}
	}

	function onViewerPointerDown(e: PointerEvent) {
		clickCandidate = false;
		if (e.button === 2) {
			e.preventDefault();
			isPanning = true;
			lastPanX = e.clientX;
			lastPanY = e.clientY;
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} else if (e.button === 0 && dragAdjustMode) {
			e.preventDefault();
			isDragAdjusting = true;
			dragStartX = e.clientX;
			dragStartValue =
				dragAdjustMode === 'brightness' ? brightness : dragAdjustMode === 'contrast' ? contrast : scale;
			(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		} else if (e.button === 0) {
			// Potential place-landmark click — confirmed on pointerup if it stayed still.
			clickCandidate = true;
			downX = e.clientX;
			downY = e.clientY;
			movedDist = 0;
		}
	}

	function onViewerPointerMove(e: PointerEvent) {
		const zoom = rootZoom();
		if (clickCandidate) {
			movedDist = Math.hypot(e.clientX - downX, e.clientY - downY);
		}
		if (isDragAdjusting && dragAdjustMode) {
			e.preventDefault();
			const deltaX = (e.clientX - dragStartX) / zoom;
			if (dragAdjustMode === 'brightness') {
				brightness = Math.round(clamp(dragStartValue + deltaX * 0.5, 10, 300));
			} else if (dragAdjustMode === 'contrast') {
				contrast = Math.round(clamp(dragStartValue + deltaX * 0.5, 10, 300));
			} else {
				scale = clamp(dragStartValue + deltaX * 0.005, 0.1, 5);
			}
			return;
		}
		if (!isPanning) return;
		e.preventDefault();
		tx += (e.clientX - lastPanX) / zoom;
		ty += (e.clientY - lastPanY) / zoom;
		lastPanX = e.clientX;
		lastPanY = e.clientY;
	}

	/** Map a viewport pointer to natural-image pixel coordinates via the overlay's bounding rect. */
	function mapToImage(clientX: number, clientY: number): { x: number; y: number } | null {
		if (!wrapperEl || naturalWidth <= 0 || naturalHeight <= 0) return null;
		const rect = wrapperEl.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		// clientX/Y and rect are both visual px, so the root-zoom factor cancels in the ratio.
		const fx = (clientX - rect.left) / rect.width;
		const fy = (clientY - rect.top) / rect.height;
		return { x: fx * naturalWidth, y: fy * naturalHeight };
	}

	function onViewerPointerUp(e: PointerEvent) {
		if (e.button === 2) isPanning = false;
		if (isDragAdjusting) {
			isDragAdjusting = false;
			// Auto-deactivate after one drag, like Cephalyzer's ImageCanvas
			dragAdjustMode = null;
		}
		if (clickCandidate && e.button === 0 && movedDist < 5 && onImageClick) {
			const p = mapToImage(e.clientX, e.clientY);
			if (p) onImageClick(p.x, p.y);
		}
		clickCandidate = false;
	}

	function onViewerPointerCancel() {
		isPanning = false;
		isDragAdjusting = false;
		clickCandidate = false;
	}

	// Wheel zoom — non-passive so preventDefault works
	function handleWheel(e: WheelEvent) {
		e.preventDefault();
		const step = 0.12;
		const delta = e.deltaY > 0 ? -step : step;
		scale = clamp(scale + delta, 0.1, 5);
	}

	$effect(() => {
		const el = viewerEl;
		if (!el) return;
		el.addEventListener('wheel', handleWheel, { passive: false });
		const ro = new ResizeObserver(() => {
			viewerW = el.offsetWidth;
			viewerH = el.offsetHeight;
		});
		ro.observe(el);
		viewerW = el.offsetWidth;
		viewerH = el.offsetHeight;
		return () => {
			el.removeEventListener('wheel', handleWheel);
			ro.disconnect();
		};
	});

	function handleImgLoad(e: Event) {
		const img = e.currentTarget as HTMLImageElement;
		imageLoaded = true;
		onImageLoad?.(img.naturalWidth, img.naturalHeight);
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	bind:this={viewerEl}
	class="relative flex-1 min-h-0 flex items-center justify-center overflow-hidden bg-neutral-900 select-none touch-none"
	style="cursor: {dragAdjustMode ? 'ew-resize' : isPanning ? 'move' : 'default'};"
	onpointerdown={onViewerPointerDown}
	onpointermove={onViewerPointerMove}
	onpointerup={onViewerPointerUp}
	onpointercancel={onViewerPointerCancel}
	oncontextmenu={(e) => e.preventDefault()}
>
	{#if imageDataUrl}
		<div
			bind:this={wrapperEl}
			class="relative"
			style="width: {naturalWidth > 0 ? naturalWidth + 'px' : 'auto'}; height: {naturalHeight > 0
				? naturalHeight + 'px'
				: 'auto'}; transform: translate({tx}px, {ty}px) scale({scale * baseScale}); transform-origin: center center;"
		>
			<img
				src={imageDataUrl}
				{alt}
				draggable="false"
				onload={handleImgLoad}
				class="block w-full h-full select-none pointer-events-none"
				style="filter: brightness({brightness}%) contrast({contrast}%);"
			/>
			{#if children && naturalWidth > 0 && naturalHeight > 0}
				{@render children()}
			{/if}
		</div>
	{:else}
		<div class="absolute inset-0 flex items-center justify-center">
			<svg class="animate-spin h-6 w-6 text-neutral-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
				<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
			</svg>
		</div>
	{/if}

	<!-- Drag-adjust mode indicator -->
	{#if dragAdjustMode && imageLoaded}
		<div class="absolute top-3 right-3 z-10 rounded-md border border-neutral-700/60 bg-neutral-900/90 backdrop-blur-sm px-3 py-1.5 shadow-lg">
			<div class="flex items-center gap-2 text-xs">
				{#if dragAdjustMode === 'brightness'}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-amber-400">
						<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
					</svg>
				{:else if dragAdjustMode === 'contrast'}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-neutral-300">
						<circle cx="12" cy="12" r="10"/><path d="M12 2a10 10 0 010 20z" fill="currentColor" stroke="none"/>
					</svg>
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-neutral-300">
						<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
					</svg>
				{/if}
				<span class="text-neutral-200 font-medium capitalize">{dragAdjustMode}</span>
				<span class="text-neutral-500 font-mono">
					{#if dragAdjustMode === 'brightness'}{brightness}%{:else if dragAdjustMode === 'contrast'}{contrast}%{:else}{Math.round(scale * 100)}%{/if}
				</span>
			</div>
		</div>
	{/if}

	<!-- Caller-supplied overlay chrome (e.g. flip button) -->
	{@render overlayChrome?.()}

	<!-- Hint line -->
	{#if hintText}
		<div class="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 rounded-md bg-neutral-900/80 backdrop-blur-sm px-3 py-1.5 pointer-events-none">
			<p class="text-[11px] text-neutral-400 whitespace-nowrap">{hintText}</p>
		</div>
	{/if}
</div>
