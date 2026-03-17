<script lang="ts">
	import { toFDI } from '$lib/utils';

	let {
		pocketDepths,
		bopSites,
		recessions = {},
		plaqueSites = {},
		selectedTooth = null,
		chartingTooth = null,
		comparisonDepths = null,
		onToothSelect,
	}: {
		pocketDepths: Record<string, number | null>;
		bopSites: Record<string, boolean>;
		recessions?: Record<string, number | null>;
		plaqueSites?: Record<string, boolean>;
		selectedTooth?: number | null;
		chartingTooth?: number | null;
		comparisonDepths?: Record<string, number | null> | null;
		onToothSelect: (tooth: number) => void;
	} = $props();

	// ── Geometry ──────────────────────────────────────────────────────────
	const SLOT_W = 48;
	const VW = SLOT_W * 16; // 768
	const PADDING_X = 16;
	const TOTAL_W = VW + PADDING_X * 2; // 800
	const LABEL_H = 18;
	const SCALE = 8; // px per mm
	const MAX_PD = 12; // max rendered depth
	const GUMLINE_Y_UPPER_BUC = 28; // gum line for upper buccal (bars grow downward)
	const GUMLINE_Y_UPPER_LIN = 136; // gum line for upper lingual (bars grow upward)
	const SEPARATOR_Y = 166; // midline between arches
	const GUMLINE_Y_LOWER_BUC = 196; // gum line for lower buccal (bars grow downward)
	const GUMLINE_Y_LOWER_LIN = 320; // gum line for lower lingual (bars grow upward)
	const VH = 360;

	// FDI charting order: upper arch slots 0-15, lower arch slots 0-15
	// Upper: Universal 1-16 → FDI 18→11 (Q1), FDI 21→28 (Q2)
	// Lower: Universal 32→17 → FDI 48→41 (Q4), FDI 31→38 (Q3) — reversed per clinical convention
	const UPPER_TEETH = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
	const LOWER_TEETH = [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17];

	const BUCCAL_SITES = ['MB', 'B', 'DB'] as const;
	const LINGUAL_SITES = ['ML', 'L', 'DL'] as const;

	// Bar layout within a slot: 3 bars, each 10px wide, 3px gap, centered in 48px
	const BAR_W = 10;
	const BAR_GAP = 3;
	const GROUP_W = BAR_W * 3 + BAR_GAP * 2; // 36px
	const GROUP_OFFSET_X = (SLOT_W - GROUP_W) / 2; // 6px

	function slotX(slotIndex: number): number {
		return PADDING_X + slotIndex * SLOT_W;
	}

	function barX(slotIndex: number, barIndex: number): number {
		return slotX(slotIndex) + GROUP_OFFSET_X + barIndex * (BAR_W + BAR_GAP);
	}

	function pdColor(pd: number | null): string {
		if (pd === null || pd === 0) return '#d1d5db'; // gray placeholder
		if (pd <= 3) return '#34d399'; // emerald
		if (pd <= 5) return '#fbbf24'; // amber
		return '#f87171'; // red
	}

	function pdHeight(pd: number | null): number {
		if (!pd || pd <= 0) return 2; // tiny placeholder bar
		return Math.min(pd, MAX_PD) * SCALE;
	}

	// For buccal rows: bars hang DOWN from gum line
	function bucBarY(gumline: number, pd: number | null): number {
		return gumline;
	}
	function bucBarH(pd: number | null): number {
		return pdHeight(pd);
	}

	// For lingual rows: bars hang UP from gum line
	function linBarY(gumline: number, pd: number | null): number {
		return gumline - pdHeight(pd);
	}
	function linBarH(pd: number | null): number {
		return pdHeight(pd);
	}
</script>

<svg
	viewBox="0 0 {TOTAL_W} {VH}"
	class="w-full"
	preserveAspectRatio="xMidYMid meet"
	style="min-width:560px"
	role="img"
	aria-label="Periodontal probing chart"
>
	<defs>
		<style>
			.tooth-slot { cursor: pointer; }
			.tooth-slot:hover .slot-bg { fill: oklch(0.93 0.03 240 / 0.4); }
			.bar-rect { transition: height 0.3s ease-out, y 0.3s ease-out; }
		</style>
	</defs>

	<!-- ── Reference lines ─────────────────────────────────────────── -->
	<!-- 3mm reference upper buccal -->
	<line
		x1={PADDING_X} y1={GUMLINE_Y_UPPER_BUC + 3 * SCALE}
		x2={PADDING_X + VW} y2={GUMLINE_Y_UPPER_BUC + 3 * SCALE}
		stroke="#34d399" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.5"
	/>
	<!-- 6mm reference upper buccal -->
	<line
		x1={PADDING_X} y1={GUMLINE_Y_UPPER_BUC + 6 * SCALE}
		x2={PADDING_X + VW} y2={GUMLINE_Y_UPPER_BUC + 6 * SCALE}
		stroke="#f87171" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.5"
	/>
	<!-- 3mm reference upper lingual -->
	<line
		x1={PADDING_X} y1={GUMLINE_Y_UPPER_LIN - 3 * SCALE}
		x2={PADDING_X + VW} y2={GUMLINE_Y_UPPER_LIN - 3 * SCALE}
		stroke="#34d399" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.5"
	/>
	<!-- 6mm reference upper lingual -->
	<line
		x1={PADDING_X} y1={GUMLINE_Y_UPPER_LIN - 6 * SCALE}
		x2={PADDING_X + VW} y2={GUMLINE_Y_UPPER_LIN - 6 * SCALE}
		stroke="#f87171" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.5"
	/>
	<!-- 3mm reference lower buccal -->
	<line
		x1={PADDING_X} y1={GUMLINE_Y_LOWER_BUC + 3 * SCALE}
		x2={PADDING_X + VW} y2={GUMLINE_Y_LOWER_BUC + 3 * SCALE}
		stroke="#34d399" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.5"
	/>
	<!-- 6mm reference lower buccal -->
	<line
		x1={PADDING_X} y1={GUMLINE_Y_LOWER_BUC + 6 * SCALE}
		x2={PADDING_X + VW} y2={GUMLINE_Y_LOWER_BUC + 6 * SCALE}
		stroke="#f87171" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.5"
	/>
	<!-- 3mm reference lower lingual -->
	<line
		x1={PADDING_X} y1={GUMLINE_Y_LOWER_LIN - 3 * SCALE}
		x2={PADDING_X + VW} y2={GUMLINE_Y_LOWER_LIN - 3 * SCALE}
		stroke="#34d399" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.5"
	/>
	<!-- 6mm reference lower lingual -->
	<line
		x1={PADDING_X} y1={GUMLINE_Y_LOWER_LIN - 6 * SCALE}
		x2={PADDING_X + VW} y2={GUMLINE_Y_LOWER_LIN - 6 * SCALE}
		stroke="#f87171" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.5"
	/>

	<!-- ── Arch separator ──────────────────────────────────────────── -->
	<line
		x1={PADDING_X} y1={SEPARATOR_Y}
		x2={PADDING_X + VW} y2={SEPARATOR_Y}
		stroke="currentColor" stroke-width="1" opacity="0.2"
	/>

	<!-- ── Arch labels ─────────────────────────────────────────────── -->
	<text x={PADDING_X - 4} y={GUMLINE_Y_UPPER_BUC + 4} text-anchor="end" font-size="8" fill="currentColor" opacity="0.5">B</text>
	<text x={PADDING_X - 4} y={GUMLINE_Y_UPPER_LIN - 4} text-anchor="end" font-size="8" fill="currentColor" opacity="0.5">L</text>
	<text x={PADDING_X - 4} y={GUMLINE_Y_LOWER_BUC + 4} text-anchor="end" font-size="8" fill="currentColor" opacity="0.5">B</text>
	<text x={PADDING_X - 4} y={GUMLINE_Y_LOWER_LIN - 4} text-anchor="end" font-size="8" fill="currentColor" opacity="0.5">L</text>

	<!-- ── Upper Arch ──────────────────────────────────────────────── -->
	{#each UPPER_TEETH as tooth, i}
		{@const sx = slotX(i)}
		{@const isSelected = selectedTooth === tooth}
		{@const isCharting = chartingTooth === tooth}
		<g
			class="tooth-slot"
			onclick={() => onToothSelect(tooth)}
			role="button"
			tabindex="-1"
			aria-label="FDI {toFDI(tooth)}"
		>
			<!-- Slot background highlight -->
			{#if isSelected}
				<rect x={sx} y={0} width={SLOT_W} height={SEPARATOR_Y} fill="oklch(0.7 0.15 240 / 0.12)" class="slot-bg" />
			{:else if isCharting}
				<rect x={sx} y={0} width={SLOT_W} height={SEPARATOR_Y} fill="oklch(0.85 0.12 80 / 0.15)" class="slot-bg" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3" />
			{:else}
				<rect x={sx} y={0} width={SLOT_W} height={SEPARATOR_Y} fill="transparent" class="slot-bg" />
			{/if}

			<!-- Vertical grid line -->
			{#if i > 0}
				<line x1={sx} y1={0} x2={sx} y2={SEPARATOR_Y} stroke="currentColor" stroke-width="0.5" opacity="0.1" />
			{/if}

			<!-- Midline separator (between teeth 8 and 9 = FDI 11/21) -->
			{#if i === 8}
				<line x1={sx} y1={0} x2={sx} y2={SEPARATOR_Y} stroke="currentColor" stroke-width="1.5" opacity="0.3" />
			{/if}

			<!-- FDI label -->
			<text
				x={sx + SLOT_W / 2}
				y={LABEL_H - 4}
				text-anchor="middle"
				font-size="9"
				font-weight={isSelected ? '700' : '500'}
				fill={isSelected ? 'oklch(0.5 0.18 240)' : 'currentColor'}
				opacity={isSelected ? 1 : 0.7}
			>{toFDI(tooth)}</text>

			<!-- Gum lines -->
			<line x1={sx} y1={GUMLINE_Y_UPPER_BUC} x2={sx + SLOT_W} y2={GUMLINE_Y_UPPER_BUC} stroke="currentColor" stroke-width="0.8" opacity="0.15" />
			<line x1={sx} y1={GUMLINE_Y_UPPER_LIN} x2={sx + SLOT_W} y2={GUMLINE_Y_UPPER_LIN} stroke="currentColor" stroke-width="0.8" opacity="0.15" />

			<!-- Buccal bars (MB, B, DB) — grow downward -->
			{#each BUCCAL_SITES as site, bi}
				{@const key = `${tooth}_${site}`}
				{@const pd = pocketDepths[key] ?? null}
				{@const bop = bopSites[key] ?? false}
				{@const plaque = plaqueSites[key] ?? false}
				{@const rec = recessions[key] ?? null}
				{@const cmpPd = comparisonDepths?.[key] ?? null}
				{@const bx = barX(i, bi)}
				{@const bh = bucBarH(pd)}
				{@const by = bucBarY(GUMLINE_Y_UPPER_BUC, pd)}

				<!-- Comparison ghost bar -->
				{#if cmpPd !== null}
					<rect
						x={bx} y={GUMLINE_Y_UPPER_BUC}
						width={BAR_W} height={pdHeight(cmpPd)}
						fill="#94a3b8" opacity="0.35" rx="1"
					/>
				{/if}

				<!-- Recession bar (purple, sits below PD bar base) -->
				{#if rec !== null && rec > 0}
					<rect
						x={bx} y={by + bh}
						width={BAR_W} height={Math.min(rec, MAX_PD) * SCALE}
						fill="#a78bfa" opacity="0.7" rx="1"
					/>
				{/if}

				<!-- Main PD bar -->
				<rect
					x={bx} y={by}
					width={BAR_W} height={bh}
					fill={pdColor(pd)}
					opacity={pd ? 0.85 : 0.25}
					rx="1"
					class="bar-rect"
				/>

				<!-- BOP dot at bar tip -->
				{#if bop}
					<circle cx={bx + BAR_W / 2} cy={by + bh + 4} r={3} fill="#ef4444" />
				{/if}

				<!-- Plaque dot at bar base -->
				{#if plaque}
					<circle cx={bx + BAR_W / 2} cy={by - 4} r={2.5} fill="#fbbf24" />
				{/if}
			{/each}

			<!-- Lingual bars (ML, L, DL) — grow upward -->
			{#each LINGUAL_SITES as site, li}
				{@const key = `${tooth}_${site}`}
				{@const pd = pocketDepths[key] ?? null}
				{@const bop = bopSites[key] ?? false}
				{@const plaque = plaqueSites[key] ?? false}
				{@const rec = recessions[key] ?? null}
				{@const cmpPd = comparisonDepths?.[key] ?? null}
				{@const bx = barX(i, li)}
				{@const bh = linBarH(pd)}
				{@const by = linBarY(GUMLINE_Y_UPPER_LIN, pd)}

				<!-- Comparison ghost bar -->
				{#if cmpPd !== null}
					<rect
						x={bx} y={GUMLINE_Y_UPPER_LIN - pdHeight(cmpPd)}
						width={BAR_W} height={pdHeight(cmpPd)}
						fill="#94a3b8" opacity="0.35" rx="1"
					/>
				{/if}

				<!-- Recession bar (purple, grows further upward) -->
				{#if rec !== null && rec > 0}
					<rect
						x={bx} y={by - Math.min(rec, MAX_PD) * SCALE}
						width={BAR_W} height={Math.min(rec, MAX_PD) * SCALE}
						fill="#a78bfa" opacity="0.7" rx="1"
					/>
				{/if}

				<!-- Main PD bar -->
				<rect
					x={bx} y={by}
					width={BAR_W} height={bh}
					fill={pdColor(pd)}
					opacity={pd ? 0.85 : 0.25}
					rx="1"
					class="bar-rect"
				/>

				<!-- BOP dot at bar tip (upward = top of bar) -->
				{#if bop}
					<circle cx={bx + BAR_W / 2} cy={by - 4} r={3} fill="#ef4444" />
				{/if}

				<!-- Plaque dot at bar base (gum line) -->
				{#if plaque}
					<circle cx={bx + BAR_W / 2} cy={GUMLINE_Y_UPPER_LIN + 4} r={2.5} fill="#fbbf24" />
				{/if}
			{/each}
		</g>
	{/each}

	<!-- ── Lower Arch ──────────────────────────────────────────────── -->
	{#each LOWER_TEETH as tooth, i}
		{@const sx = slotX(i)}
		{@const isSelected = selectedTooth === tooth}
		{@const isCharting = chartingTooth === tooth}
		<g
			class="tooth-slot"
			onclick={() => onToothSelect(tooth)}
			role="button"
			tabindex="-1"
			aria-label="FDI {toFDI(tooth)}"
		>
			<!-- Slot background highlight -->
			{#if isSelected}
				<rect x={sx} y={SEPARATOR_Y} width={SLOT_W} height={VH - SEPARATOR_Y - 18} fill="oklch(0.7 0.15 240 / 0.12)" class="slot-bg" />
			{:else if isCharting}
				<rect x={sx} y={SEPARATOR_Y} width={SLOT_W} height={VH - SEPARATOR_Y - 18} fill="oklch(0.85 0.12 80 / 0.15)" class="slot-bg" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3" />
			{:else}
				<rect x={sx} y={SEPARATOR_Y} width={SLOT_W} height={VH - SEPARATOR_Y - 18} fill="transparent" class="slot-bg" />
			{/if}

			<!-- Vertical grid line -->
			{#if i > 0}
				<line x1={sx} y1={SEPARATOR_Y} x2={sx} y2={VH - 18} stroke="currentColor" stroke-width="0.5" opacity="0.1" />
			{/if}

			<!-- Midline separator (between teeth 25 and 24 = FDI 41/31) -->
			{#if i === 8}
				<line x1={sx} y1={SEPARATOR_Y} x2={sx} y2={VH - 18} stroke="currentColor" stroke-width="1.5" opacity="0.3" />
			{/if}

			<!-- FDI label -->
			<text
				x={sx + SLOT_W / 2}
				y={VH - 6}
				text-anchor="middle"
				font-size="9"
				font-weight={isSelected ? '700' : '500'}
				fill={isSelected ? 'oklch(0.5 0.18 240)' : 'currentColor'}
				opacity={isSelected ? 1 : 0.7}
			>{toFDI(tooth)}</text>

			<!-- Gum lines -->
			<line x1={sx} y1={GUMLINE_Y_LOWER_BUC} x2={sx + SLOT_W} y2={GUMLINE_Y_LOWER_BUC} stroke="currentColor" stroke-width="0.8" opacity="0.15" />
			<line x1={sx} y1={GUMLINE_Y_LOWER_LIN} x2={sx + SLOT_W} y2={GUMLINE_Y_LOWER_LIN} stroke="currentColor" stroke-width="0.8" opacity="0.15" />

			<!-- Buccal bars (MB, B, DB) — grow downward -->
			{#each BUCCAL_SITES as site, bi}
				{@const key = `${tooth}_${site}`}
				{@const pd = pocketDepths[key] ?? null}
				{@const bop = bopSites[key] ?? false}
				{@const plaque = plaqueSites[key] ?? false}
				{@const rec = recessions[key] ?? null}
				{@const cmpPd = comparisonDepths?.[key] ?? null}
				{@const bx = barX(i, bi)}
				{@const bh = bucBarH(pd)}
				{@const by = bucBarY(GUMLINE_Y_LOWER_BUC, pd)}

				<!-- Comparison ghost bar -->
				{#if cmpPd !== null}
					<rect
						x={bx} y={GUMLINE_Y_LOWER_BUC}
						width={BAR_W} height={pdHeight(cmpPd)}
						fill="#94a3b8" opacity="0.35" rx="1"
					/>
				{/if}

				<!-- Recession bar -->
				{#if rec !== null && rec > 0}
					<rect
						x={bx} y={by + bh}
						width={BAR_W} height={Math.min(rec, MAX_PD) * SCALE}
						fill="#a78bfa" opacity="0.7" rx="1"
					/>
				{/if}

				<!-- Main PD bar -->
				<rect
					x={bx} y={by}
					width={BAR_W} height={bh}
					fill={pdColor(pd)}
					opacity={pd ? 0.85 : 0.25}
					rx="1"
					class="bar-rect"
				/>

				{#if bop}
					<circle cx={bx + BAR_W / 2} cy={by + bh + 4} r={3} fill="#ef4444" />
				{/if}

				{#if plaque}
					<circle cx={bx + BAR_W / 2} cy={by - 4} r={2.5} fill="#fbbf24" />
				{/if}
			{/each}

			<!-- Lingual bars (ML, L, DL) — grow upward -->
			{#each LINGUAL_SITES as site, li}
				{@const key = `${tooth}_${site}`}
				{@const pd = pocketDepths[key] ?? null}
				{@const bop = bopSites[key] ?? false}
				{@const plaque = plaqueSites[key] ?? false}
				{@const rec = recessions[key] ?? null}
				{@const cmpPd = comparisonDepths?.[key] ?? null}
				{@const bx = barX(i, li)}
				{@const bh = linBarH(pd)}
				{@const by = linBarY(GUMLINE_Y_LOWER_LIN, pd)}

				<!-- Comparison ghost bar -->
				{#if cmpPd !== null}
					<rect
						x={bx} y={GUMLINE_Y_LOWER_LIN - pdHeight(cmpPd)}
						width={BAR_W} height={pdHeight(cmpPd)}
						fill="#94a3b8" opacity="0.35" rx="1"
					/>
				{/if}

				<!-- Recession bar -->
				{#if rec !== null && rec > 0}
					<rect
						x={bx} y={by - Math.min(rec, MAX_PD) * SCALE}
						width={BAR_W} height={Math.min(rec, MAX_PD) * SCALE}
						fill="#a78bfa" opacity="0.7" rx="1"
					/>
				{/if}

				<!-- Main PD bar -->
				<rect
					x={bx} y={by}
					width={BAR_W} height={bh}
					fill={pdColor(pd)}
					opacity={pd ? 0.85 : 0.25}
					rx="1"
					class="bar-rect"
				/>

				{#if bop}
					<circle cx={bx + BAR_W / 2} cy={by - 4} r={3} fill="#ef4444" />
				{/if}

				{#if plaque}
					<circle cx={bx + BAR_W / 2} cy={GUMLINE_Y_LOWER_LIN + 4} r={2.5} fill="#fbbf24" />
				{/if}
			{/each}
		</g>
	{/each}

	<!-- ── Legend ─────────────────────────────────────────────────────── -->
	<!-- legendX=16, legendY=VH-2=358 -->
	<g font-size="8" fill="currentColor" opacity="0.65">
		<rect x="16" y="351" width="8" height="8" fill="#34d399" rx="1" />
		<text x="27" y="358"> 1-3mm</text>
		<rect x="62" y="351" width="8" height="8" fill="#fbbf24" rx="1" />
		<text x="73" y="358"> 4-5mm</text>
		<rect x="108" y="351" width="8" height="8" fill="#f87171" rx="1" />
		<text x="119" y="358"> ≥6mm</text>
		<circle cx="151" cy="355" r="3.5" fill="#ef4444" />
		<text x="158" y="358"> BOP</text>
		<circle cx="184" cy="355" r="3" fill="#fbbf24" />
		<text x="191" y="358"> Plaque</text>
		<rect x="228" y="351" width="8" height="8" fill="#a78bfa" opacity="0.7" rx="1" />
		<text x="239" y="358"> Recession</text>
	</g>
</svg>
