<script lang="ts">
	import type { FacialLandmark } from '$lib/types';
	import type { LandmarkDef } from '$lib/services/facial-measurements';

	let {
		naturalWidth,
		naturalHeight,
		landmarks,
		landmarkDefs,
		activeId,
		referenceLines,
		onSelect,
	}: {
		naturalWidth: number;
		naturalHeight: number;
		/** Mutated in place (Svelte 5 deep reactivity) as points are dragged. */
		landmarks: Record<string, FacialLandmark>;
		landmarkDefs: LandmarkDef[];
		activeId: string | null;
		/** Landmark-id pairs to connect once both endpoints are placed. */
		referenceLines: [string, string][];
		onSelect?: (id: string) => void;
	} = $props();

	let svgEl = $state<SVGSVGElement | null>(null);
	let dragId = $state<string | null>(null);

	// Geometry constants sized off the image so dots/labels stay legible at fit scale.
	const dim = $derived(Math.max(naturalWidth, naturalHeight) || 1);
	const dotR = $derived(dim / 150);
	const hitR = $derived(dim / 70);
	const strokeW = $derived(dim / 500);
	const fontSize = $derived(dim / 55);

	const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

	/** Pointer (visual px) → natural-image px via the SVG's own bounding rect (zoom cancels in the ratio). */
	function clientToImage(clientX: number, clientY: number): { x: number; y: number } | null {
		if (!svgEl) return null;
		const rect = svgEl.getBoundingClientRect();
		if (rect.width <= 0 || rect.height <= 0) return null;
		return {
			x: ((clientX - rect.left) / rect.width) * naturalWidth,
			y: ((clientY - rect.top) / rect.height) * naturalHeight,
		};
	}

	function onDotDown(e: PointerEvent, id: string) {
		// Stop the viewport from treating this as a place-landmark click.
		e.stopPropagation();
		e.preventDefault();
		dragId = id;
		onSelect?.(id);
		(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
	}

	function onSvgPointerMove(e: PointerEvent) {
		if (!dragId) return;
		const p = clientToImage(e.clientX, e.clientY);
		if (!p) return;
		const lm = landmarks[dragId];
		if (!lm) return;
		lm.x = clamp(p.x, 0, naturalWidth);
		lm.y = clamp(p.y, 0, naturalHeight);
		// A user-corrected point is a gold human label, even if it started as AI.
		lm.placedBy = 'human';
	}

	function onSvgPointerUp() {
		dragId = null;
	}

	const defById = $derived(Object.fromEntries(landmarkDefs.map((d) => [d.id, d])));
	const placedLines = $derived(
		referenceLines
			.map(([a, b]) => ({ a: landmarks[a], b: landmarks[b] }))
			.filter((l) => l.a && l.b) as { a: FacialLandmark; b: FacialLandmark }[],
	);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<svg
	bind:this={svgEl}
	class="absolute inset-0 w-full h-full"
	viewBox="0 0 {naturalWidth} {naturalHeight}"
	style="pointer-events: none; overflow: visible;"
	onpointermove={onSvgPointerMove}
	onpointerup={onSvgPointerUp}
	onpointercancel={onSvgPointerUp}
>
	<!-- Reference lines -->
	{#each placedLines as line, i (i)}
		<line
			x1={line.a.x}
			y1={line.a.y}
			x2={line.b.x}
			y2={line.b.y}
			stroke="rgba(56, 189, 248, 0.85)"
			stroke-width={strokeW}
			stroke-linecap="round"
		/>
	{/each}

	<!-- Placed landmark dots -->
	{#each landmarkDefs as def (def.id)}
		{@const lm = landmarks[def.id]}
		{#if lm}
			{@const isActive = def.id === activeId}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<g style="cursor: grab; pointer-events: auto;" onpointerdown={(e) => onDotDown(e, def.id)}>
				<!-- Enlarged transparent hit target -->
				<circle cx={lm.x} cy={lm.y} r={hitR} fill="transparent" />
				{#if isActive}
					<circle
						cx={lm.x}
						cy={lm.y}
						r={dotR * 1.9}
						fill="none"
						stroke="rgba(251, 191, 36, 0.95)"
						stroke-width={strokeW}
					/>
				{/if}
				<circle
					cx={lm.x}
					cy={lm.y}
					r={dotR}
					fill={isActive ? '#fbbf24' : '#34d399'}
					stroke="#0b1220"
					stroke-width={strokeW * 0.6}
				/>
				<text
					x={lm.x + dotR * 1.6}
					y={lm.y - dotR * 1.2}
					font-size={fontSize}
					font-weight="600"
					fill="#e5faf3"
					stroke="#0b1220"
					stroke-width={strokeW * 0.4}
					paint-order="stroke"
					style="pointer-events: none; user-select: none;"
				>
					{(defById[def.id]?.id ?? def.id).toUpperCase()}
				</text>
			</g>
		{/if}
	{/each}
</svg>
