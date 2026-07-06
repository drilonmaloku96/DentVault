<script lang="ts">
	/**
	 * ParToothChartSVG — FDI-native PAR odontogram.
	 *
	 * Geometry modeled on PerioSVGChart (slot 54, viewBox 908×494, scale 8px/mm).
	 * All tooth values are FDI (11–48) — render directly, never call toFDI().
	 * Site keys are lowercase ParSite: 'db'|'b'|'mb'|'ml'|'l'|'dl'.
	 *
	 * Props: pure view over ParChartState (passed in from parent).
	 */

	import type { ParChartState, CellId } from './ParChartState.svelte';
	import type { ParSite } from '$lib/types';
	import {
		UPPER_TEETH, LOWER_TEETH,
		BUCCAL_SITES_2, BUCCAL_SITES_6,
		LINGUAL_SITES_2, LINGUAL_SITES_6,
	} from './ParChartState.svelte';
	import {
		pdBarColor, pdNumColor, bopCircleColor, bopCircleStroke,
		mobilityColor, BONE_LEVEL_STROKE, statusGlyph, statusOpacity,
	} from '$lib/utils/par-colors';
	import { i18n } from '$lib/i18n';
	import ParToothPopover from './ParToothPopover.svelte';

	let {
		chartState,
		comparisonMmap = null,
		onSiteClick,
		onToothClick,
	}: {
		chartState: ParChartState;
		comparisonMmap?: Record<string, { pocket: number | null }> | null;
		onSiteClick?: (cell: CellId) => void;
		onToothClick?: (tooth: number, svgX: number, svgY: number) => void;
	} = $props();

	// ── Geometry (mirrors PerioSVGChart) ────────────────────────────────────
	const SLOT_W    = 54;
	const VW        = SLOT_W * 16;         // 864
	const LEFT_PAD  = 36;
	const RIGHT_PAD = 8;
	const TOTAL_W   = LEFT_PAD + VW + RIGHT_PAD; // 908

	const BAR_W   = 13;
	const BAR_GAP = 2;
	// 2-site: 2 bars; 6-site: 3 bars
	const GROUP_W_2 = BAR_W * 2 + BAR_GAP;
	const GROUP_W_6 = BAR_W * 3 + BAR_GAP * 2;
	const groupW = $derived(chartState.siteMode === '6' ? GROUP_W_6 : GROUP_W_2);
	const groupOff = $derived((SLOT_W - groupW) / 2);

	const SCALE   = 8;    // px per mm
	const MAX_PD  = 12;
	const CHART_H = MAX_PD * SCALE; // 96
	const REC_SCALE = 2.8;

	// ── Y coordinates (same vertical layout as PerioSVGChart) ───────────────
	const U_FDI     = 10;
	const U_MOB     = 21;    // mobility row text y
	const U_BOP_BUC = 30;
	const U_NUM_BUC = 43;
	const U_GUM_BUC = 54;
	// buccal bars: U_GUM_BUC … U_GUM_BUC + CHART_H = 150

	const U_TOOTH_T = 152;
	const U_CEJ     = 172;
	const U_TOOTH_B = 206;

	const U_GUM_LIN = 208;
	const U_NUM_LIN = 222;
	const U_BOP_LIN = 233;
	const UPPER_END = 244;

	const ARCH_SEP  = 254;

	const L_FDI     = 262;
	const L_MOB     = 273;
	const L_BOP_BUC = 282;
	const L_NUM_BUC = 295;
	const L_GUM_BUC = 306;

	const L_TOOTH_T = 408;
	const L_CEJ     = 388;
	const L_TOOTH_B = 460;

	const L_GUM_LIN = 462;
	const L_NUM_LIN = 475;
	const L_BOP_LIN = 486;

	const VH = 498;

	const RULER_TICKS = [2, 4, 6, 8, 10, 12];

	// ── Tooth geometry (same helpers as PerioSVGChart) ──────────────────────
	const MOLARS    = new Set([18, 17, 16, 28, 27, 26, 48, 47, 46, 38, 37, 36]);
	const PREMOLARS = new Set([15, 14, 25, 24, 45, 44, 35, 34]);
	const CANINES   = new Set([13, 23, 43, 33]);

	function crownW(tooth: number): number {
		if (MOLARS.has(tooth))    return 40;
		if (PREMOLARS.has(tooth)) return 30;
		if (CANINES.has(tooth))   return 25;
		return 20;
	}

	function upperToothPath(cx: number, yt: number, yc: number, yb: number, w: number): string {
		const rw = Math.max(w - 12, 10);
		const cr = 3;
		return `M ${cx-rw/2},${yt} L ${cx-w/2},${yc} L ${cx-w/2},${yb-cr} Q ${cx-w/2},${yb} ${cx-w/2+cr},${yb} L ${cx+w/2-cr},${yb} Q ${cx+w/2},${yb} ${cx+w/2},${yb-cr} L ${cx+w/2},${yc} L ${cx+rw/2},${yt} Z`;
	}

	function lowerToothPath(cx: number, yt: number, yc: number, yb: number, w: number): string {
		const rw = Math.max(w - 12, 10);
		const cr = 3;
		return `M ${cx-w/2+cr},${yt} Q ${cx-w/2},${yt} ${cx-w/2},${yt+cr} L ${cx-w/2},${yc} L ${cx-rw/2},${yb} L ${cx+rw/2},${yb} L ${cx+w/2},${yc} L ${cx+w/2},${yt+cr} Q ${cx+w/2},${yt} ${cx+w/2-cr},${yt} Z`;
	}

	function crownCusps(tooth: number, cx: number, y: number, isUpper: boolean): string {
		const d = isUpper ? 1 : -1;
		if (CANINES.has(tooth))   return `M ${cx},${y+d*3} L ${cx-4},${y} L ${cx+4},${y} Z`;
		if (PREMOLARS.has(tooth)) return `M ${cx-8},${y+d*3} L ${cx-12},${y} L ${cx-4},${y} Z M ${cx+8},${y+d*3} L ${cx+4},${y} L ${cx+12},${y} Z`;
		if (MOLARS.has(tooth))    return `M ${cx-14},${y+d*3} L ${cx-18},${y} L ${cx-10},${y} Z M ${cx},${y+d*4} L ${cx-4},${y} L ${cx+4},${y} Z M ${cx+14},${y+d*3} L ${cx+10},${y} L ${cx+18},${y} Z`;
		return '';
	}

	function rootLines(tooth: number, cx: number, y: number, isUpper: boolean): string {
		const d = isUpper ? -1 : 1;
		if (MOLARS.has(tooth))    return `M ${cx-8},${y} L ${cx-8},${y+d*6} M ${cx+8},${y} L ${cx+8},${y+d*6}`;
		if (PREMOLARS.has(tooth)) return `M ${cx-4},${y} L ${cx-4},${y+d*5} M ${cx+4},${y} L ${cx+4},${y+d*5}`;
		return `M ${cx},${y} L ${cx},${y+d*5}`;
	}

	// ── Bar / position helpers ───────────────────────────────────────────────
	function slotX(i: number): number { return LEFT_PAD + i * SLOT_W; }
	function barX(i: number, bi: number): number { return slotX(i) + groupOff + bi * (BAR_W + BAR_GAP); }
	function barCx(i: number, bi: number): number { return barX(i, bi) + BAR_W / 2; }

	function pdH(pd: number | null): number {
		if (!pd || pd <= 0) return 2;
		return Math.min(pd, MAX_PD) * SCALE;
	}

	// ── Active sites ─────────────────────────────────────────────────────────
	const activeBucSites  = $derived(chartState.siteMode === '6' ? BUCCAL_SITES_6  : BUCCAL_SITES_2);
	const activeLingSites = $derived(chartState.siteMode === '6' ? LINGUAL_SITES_6 : LINGUAL_SITES_2);

	// ── Cursor match helper ──────────────────────────────────────────────────
	function isCursor(tooth: number, row: 'buc' | 'ling', si: number): boolean {
		const c = chartState.cursor;
		return !!c && c.tooth === tooth && c.row === row && c.siteIdx === si;
	}

	// ── Tooth popover state ──────────────────────────────────────────────────
	let popoverTooth   = $state<number | null>(null);
	let popoverX       = $state(0);
	let popoverY       = $state(0);

	function openPopover(tooth: number, svgEl: SVGElement, cx: number, cy: number) {
		const rect = svgEl.getBoundingClientRect();
		const vbW  = TOTAL_W;
		const vbH  = VH;
		const scaleX = rect.width  / vbW;
		const scaleY = rect.height / vbH;
		popoverX     = rect.left + cx * scaleX;
		popoverY     = rect.top  + cy * scaleY;
		popoverTooth = tooth;
		onToothClick?.(tooth, popoverX, popoverY);
	}

	// ── Furcation triangle ───────────────────────────────────────────────────
	// Draw a small triangle at root tip; fill represents grade (0=outline, 1=half, 2/3=filled)
	function furcTriangle(cx: number, y: number, grade: number | null, dir: 'down' | 'up'): string {
		const h = 5;
		const w = 5;
		const dy = dir === 'down' ? 1 : -1;
		if (!grade) return '';
		return `M ${cx-w},${y} L ${cx+w},${y} L ${cx},${y+dy*h} Z`;
	}
	function furcFill(grade: number | null): string {
		if (!grade || grade === 0) return 'none';
		if (grade === 1) return '#fbbf24';  // amber — partial
		return '#ef4444';                   // red — full
	}

	// ── Bone level polyline string (normalized 0-1 x, absolute y for jaw) ───
	function bonePolyline(pts: { x: number; y: number }[], toothT: number, toothB: number): string {
		if (pts.length < 2) return '';
		// pts.x is 0–1 across the full arch width, pts.y is 0–1 within the root zone
		return pts.map(p => {
			const px = LEFT_PAD + p.x * VW;
			const py = toothT + p.y * (toothB - toothT);
			return `${px.toFixed(1)},${py.toFixed(1)}`;
		}).join(' ');
	}

	// ── SVG element ref for popover positioning ──────────────────────────────
	let svgEl: SVGElement | null = $state(null);

	// ── Bone-level draw mode ─────────────────────────────────────────────────
	let isDrawing      = $state(false);
	let drawJaw        = $state<'upper' | 'lower' | null>(null);
	let drawPoints     = $state<{ x: number; y: number }[]>([]);

	function svgCoords(e: PointerEvent): { svgX: number; svgY: number } | null {
		if (!svgEl) return null;
		const rect    = svgEl.getBoundingClientRect();
		const scaleX  = TOTAL_W / rect.width;
		const scaleY  = VH      / rect.height;
		return {
			svgX: (e.clientX - rect.left) * scaleX,
			svgY: (e.clientY - rect.top)  * scaleY,
		};
	}

	function normPoint(svgX: number, svgY: number, jaw: 'upper' | 'lower'): { x: number; y: number } {
		const toothT = jaw === 'upper' ? U_TOOTH_T : L_TOOTH_T;
		const toothB = jaw === 'upper' ? U_TOOTH_B : L_TOOTH_B;
		return {
			x: Math.max(0, Math.min(1, (svgX - LEFT_PAD) / VW)),
			y: Math.max(0, Math.min(1, (svgY - toothT) / (toothB - toothT))),
		};
	}

	function handleBoneDown(e: PointerEvent) {
		if (chartState.inputMode !== 'bone' || chartState.locked) return;
		const pt = svgCoords(e);
		if (!pt) return;
		const jaw = pt.svgY < ARCH_SEP ? 'upper' : 'lower';
		isDrawing  = true;
		drawJaw    = jaw;
		drawPoints = [normPoint(pt.svgX, pt.svgY, jaw)];
		(e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
	}

	function handleBoneMove(e: PointerEvent) {
		if (!isDrawing || !drawJaw) return;
		const pt = svgCoords(e);
		if (!pt) return;
		drawPoints = [...drawPoints, normPoint(pt.svgX, pt.svgY, drawJaw)];
	}

	function handleBoneUp() {
		if (!isDrawing || !drawJaw || drawPoints.length < 2) {
			isDrawing  = false;
			drawJaw    = null;
			drawPoints = [];
			return;
		}
		chartState.setBoneLevel(drawJaw, [...drawPoints]);
		isDrawing  = false;
		drawJaw    = null;
		drawPoints = [];
	}

	// ── Mobility Roman label ─────────────────────────────────────────────────
	function mobilityLabel(m: number | null): string {
		if (m === null) return '';
		return ['0', 'I', 'II', 'III'][m] ?? '';
	}
</script>

<!-- Scroll container shrinks with the card; the SVG keeps its legible minimum
     width and scrolls horizontally at narrow window sizes -->
<div class="overflow-x-auto">
<svg
	bind:this={svgEl}
	viewBox="0 0 {TOTAL_W} {VH}"
	class="w-full"
	style="min-width: 908px; cursor: {chartState.inputMode === 'bone' && !chartState.locked ? 'crosshair' : 'default'}"
	preserveAspectRatio="xMidYMid meet"
	role="img"
	aria-label="PAR periodontal charting odontogram"
	onpointerdown={handleBoneDown}
	onpointermove={handleBoneMove}
	onpointerup={handleBoneUp}
	onpointerleave={handleBoneUp}
>
<defs>
	<style>
		.tooth-col { cursor: pointer; }
		.tooth-col:hover .col-bg-u { fill: oklch(0.93 0.04 240 / 0.2); }
		.tooth-col:hover .col-bg-l { fill: oklch(0.93 0.04 240 / 0.2); }
		.site-btn { cursor: pointer; }
		@keyframes par-pulse {
			0%   { opacity:1; r:6; }
			50%  { opacity:0.4; r:8; }
			100% { opacity:1; r:6; }
		}
		.cursor-pulse { animation: par-pulse 1s ease-in-out infinite; }
	</style>
	<linearGradient id="par-buc-grad" x1="0" y1="0" x2="0" y2="1">
		<stop offset="0%"   stop-color="#6366f1" stop-opacity="0.14"/>
		<stop offset="100%" stop-color="#6366f1" stop-opacity="0.02"/>
	</linearGradient>
	<linearGradient id="par-lin-grad" x1="0" y1="1" x2="0" y2="0">
		<stop offset="0%"   stop-color="#6366f1" stop-opacity="0.14"/>
		<stop offset="100%" stop-color="#6366f1" stop-opacity="0.02"/>
	</linearGradient>
	<linearGradient id="par-enamel" x1="0" y1="0" x2="1" y2="0">
		<stop offset="0%"   stop-color="#f1f5f9"/>
		<stop offset="50%"  stop-color="#ffffff"/>
		<stop offset="100%" stop-color="#e2e8f0"/>
	</linearGradient>
	<linearGradient id="par-root" x1="0" y1="0" x2="1" y2="0">
		<stop offset="0%"   stop-color="#fef9ef"/>
		<stop offset="50%"  stop-color="#fffbf0"/>
		<stop offset="100%" stop-color="#fef3c7"/>
	</linearGradient>
	<pattern id="par-hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
		<line x1="0" y1="0" x2="0" y2="4" stroke="#94a3b8" stroke-width="1.5"/>
	</pattern>
</defs>

<!-- ════════════════════════════════════════════════════ -->
<!-- REFERENCE LINES                                       -->
<!-- ════════════════════════════════════════════════════ -->
{#each [[U_GUM_BUC,'down'],[U_GUM_LIN,'up'],[L_GUM_BUC,'down'],[L_GUM_LIN,'up']] as [g, d]}
	{@const y3 = d === 'down' ? (g as number)+3*SCALE : (g as number)-3*SCALE}
	{@const y6 = d === 'down' ? (g as number)+6*SCALE : (g as number)-6*SCALE}
	<line x1={LEFT_PAD} y1={y3} x2={LEFT_PAD+VW} y2={y3} stroke="#34d399" stroke-width="0.6" stroke-dasharray="5,5" opacity="0.35"/>
	<line x1={LEFT_PAD} y1={y6} x2={LEFT_PAD+VW} y2={y6} stroke="#f87171" stroke-width="0.6" stroke-dasharray="5,5" opacity="0.4"/>
{/each}

<!-- Arch separator -->
<line x1={LEFT_PAD} y1={ARCH_SEP} x2={LEFT_PAD+VW} y2={ARCH_SEP} stroke="currentColor" stroke-width="1.2" opacity="0.22"/>

<!-- ════════════════════════════════════════════════════ -->
<!-- SCALE RULERS                                          -->
<!-- ════════════════════════════════════════════════════ -->
{#each [[U_GUM_BUC,'down'],[U_GUM_LIN,'up'],[L_GUM_BUC,'down'],[L_GUM_LIN,'up']] as [g, d]}
	{#each RULER_TICKS as mm}
		{@const ry = d === 'down' ? (g as number)+mm*SCALE : (g as number)-mm*SCALE}
		<line x1={LEFT_PAD-6} y1={ry} x2={LEFT_PAD-1} y2={ry} stroke="currentColor" stroke-width="0.8" opacity="0.3"/>
		<text x={LEFT_PAD-8} y={ry+3} text-anchor="end" font-size="7" fill="currentColor" opacity="0.35" font-family="monospace">{mm}</text>
	{/each}
	<line x1={LEFT_PAD-7} y1={g as number} x2={LEFT_PAD-1} y2={g as number} stroke="currentColor" stroke-width="1.5" opacity="0.45"/>
	<text x={LEFT_PAD-8} y={(g as number)+3} text-anchor="end" font-size="7" fill="currentColor" opacity="0.45" font-family="monospace">0</text>
{/each}

<!-- ════════════════════════════════════════════════════ -->
<!-- UPPER ARCH — per-tooth columns                        -->
<!-- ════════════════════════════════════════════════════ -->
{#each UPPER_TEETH as tooth, i}
	{@const sx  = slotX(i)}
	{@const cx  = sx + SLOT_W / 2}
	{@const tw  = crownW(tooth)}
	{@const td  = chartState.getT(tooth)}
	{@const isMissing = td.status === 'missing'}
	{@const mob = td.mobility}

	<g class="tooth-col" opacity={isMissing ? 0.25 : 1}>
		<!-- Column background -->
		<rect x={sx} y={0} width={SLOT_W} height={UPPER_END} fill="transparent" class="col-bg-u"/>

		<!-- Grid line -->
		{#if i > 0}
			<line x1={sx} y1={0} x2={sx} y2={UPPER_END} stroke="currentColor" stroke-width="0.4" opacity="0.1"/>
		{/if}
		{#if i === 8}
			<line x1={sx} y1={0} x2={sx} y2={UPPER_END} stroke="currentColor" stroke-width="1.4" opacity="0.22"/>
		{/if}

		<!-- FDI tooth number (render directly — already FDI) -->
		<text x={cx} y={U_FDI} text-anchor="middle" font-size="9" font-weight="500"
		      fill="currentColor" opacity="0.7" font-family="monospace">{tooth}</text>

		<!-- Mobility row -->
		{#if mob !== null && mob > 0}
			<text x={cx} y={U_MOB} text-anchor="middle" font-size="8" font-weight={mob >= 2 ? '700' : '500'}
			      fill={mobilityColor(mob)} font-family="monospace">{mobilityLabel(mob)}</text>
		{/if}

		<!-- AIT / CPT badges above tooth -->
		{#if td.ait_planned}
			<rect x={cx-8} y={U_BOP_BUC-10} width={14} height={9} rx="2" fill="#fca5a5"/>
			<text x={cx-1} y={U_BOP_BUC-3} text-anchor="middle" font-size="7" font-weight="700" fill="#991b1b">A</text>
		{/if}
		{#if td.cpt_planned}
			<rect x={cx+2} y={U_BOP_BUC-10} width={14} height={9} rx="2" fill="#c4b5fd"/>
			<text x={cx+9} y={U_BOP_BUC-3} text-anchor="middle" font-size="7" font-weight="700" fill="#5b21b6">C</text>
		{/if}

		<!-- Gumlines -->
		<line x1={sx} y1={U_GUM_BUC} x2={sx+SLOT_W} y2={U_GUM_BUC} stroke="currentColor" stroke-width="0.6" opacity="0.15"/>
		<line x1={sx} y1={U_GUM_LIN} x2={sx+SLOT_W} y2={U_GUM_LIN} stroke="currentColor" stroke-width="0.6" opacity="0.15"/>

		<!-- ── Tooth silhouette (upper: root at top, crown at bottom) ── -->
		{#if td.status === 'implant'}
			<!-- Hexagon glyph instead of root -->
			<text x={cx} y={(U_TOOTH_T+U_TOOTH_B)/2+4} text-anchor="middle" font-size="22" fill="#64748b" opacity="0.5">⬡</text>
		{:else}
			<path d={upperToothPath(cx, U_TOOTH_T, U_CEJ, U_TOOTH_B, tw)}
			      fill={td.status === 'destroyed' ? 'url(#par-hatch)' : 'url(#par-enamel)'}
			      stroke="#94a3b8" stroke-width="0.8" opacity="0.9"/>
			<!-- Root color overlay -->
			<clipPath id="par-rc-u-{i}">
				<rect x={cx-tw/2-1} y={U_TOOTH_T} width={tw+2} height={U_CEJ-U_TOOTH_T}/>
			</clipPath>
			<path d={upperToothPath(cx, U_TOOTH_T, U_CEJ, U_TOOTH_B, tw)}
			      fill="url(#par-root)" stroke="none" clip-path="url(#par-rc-u-{i})" opacity="0.85"/>
			<!-- CEJ line -->
			<line x1={cx-tw/2+1} y1={U_CEJ} x2={cx+tw/2-1} y2={U_CEJ} stroke="#64748b" stroke-width="0.8" opacity="0.5"/>
			<!-- Crown cusps -->
			{#if MOLARS.has(tooth) || PREMOLARS.has(tooth) || CANINES.has(tooth)}
				<path d={crownCusps(tooth, cx, U_TOOTH_B, true)} fill="#cbd5e1" stroke="none" opacity="0.5"/>
			{/if}
			<!-- Root lines at apex -->
			<path d={rootLines(tooth, cx, U_TOOTH_T, true)} fill="none" stroke="#94a3b8" stroke-width="0.8" opacity="0.4"/>
			<!-- Missing glyph -->
			{#if td.status === 'missing'}
				<text x={cx} y={(U_TOOTH_T+U_TOOTH_B)/2+4} text-anchor="middle" font-size="14" fill="#64748b" opacity="0.6">✕</text>
			{/if}
			<!-- Vitality dot near apex -->
			{#if td.vitality !== null}
				<circle cx={cx} cy={U_TOOTH_T+4} r={3}
				        fill={td.vitality > 0 ? '#22c55e' : '#94a3b8'}
				        stroke="white" stroke-width="0.8" opacity="0.9"/>
			{/if}
			<!-- Furcation triangle at buccal root (molars/premolars only) -->
			{#if (MOLARS.has(tooth) || PREMOLARS.has(tooth)) && td.furcation_b !== null && td.furcation_b > 0}
				<path d={furcTriangle(cx, U_TOOTH_T+2, td.furcation_b, 'up')}
				      fill={furcFill(td.furcation_b)} stroke="#d97706" stroke-width="0.8" opacity="0.85"/>
			{/if}
		{/if}

		<!-- Tooth silhouette clickable overlay (open popover) -->
		{#if !chartState.locked}
			<rect
				x={cx-tw/2} y={U_TOOTH_T} width={tw} height={U_TOOTH_B-U_TOOTH_T}
				fill="transparent"
				role="button"
				tabindex="-1"
				aria-label="Tooth {tooth} details"
				onclick={(e) => {
					const s = e.currentTarget.closest('svg') as SVGElement|null;
					if (s) openPopover(tooth, s, cx, (U_TOOTH_T+U_TOOTH_B)/2);
				}}
				style="cursor:pointer"
			/>
		{/if}

		<!-- ── Buccal bars ── -->
		{#each activeBucSites as site, bi}
			{@const mdata = chartState.getM(tooth, site)}
			{@const pd    = mdata.pocket}
			{@const bop   = mdata.bop}
			{@const plq   = mdata.plaque}
			{@const bx    = barX(i, bi)}
			{@const bcx   = barCx(i, bi)}
			{@const bh    = pdH(pd)}
			{@const cmpPd = comparisonMmap?.[`${tooth}-${site}`]?.pocket ?? null}
			{@const isCur = isCursor(tooth, 'buc', bi)}

			<!-- Comparison ghost bar -->
			{#if cmpPd !== null}
				<rect x={bx} y={U_GUM_BUC} width={BAR_W} height={pdH(cmpPd)} fill="#94a3b8" opacity="0.28" rx="1" stroke="#94a3b8" stroke-width="0.5" stroke-dasharray="2,2"/>
			{/if}
			<!-- PD bar -->
			<rect x={bx} y={U_GUM_BUC} width={BAR_W} height={bh}
			      fill={pdBarColor(pd)} opacity={pd ? 0.88 : 0.2} rx="1"/>

			<!-- BOP circle -->
			<circle cx={bcx} cy={U_BOP_BUC} r={bop ? 4.5 : 3.5}
			        fill={bopCircleColor(bop)}
			        stroke={bopCircleStroke(bop)}
			        stroke-width={bop ? 0 : 1}
			        opacity={bop ? 0.9 : 0.35}/>
			<!-- Plaque dot -->
			{#if plq > 0}
				<circle cx={bcx} cy={U_BOP_BUC+8} r="2.5" fill="#60a5fa" opacity="0.7"/>
			{/if}

			<!-- PD number -->
			<text x={bcx} y={U_NUM_BUC} text-anchor="middle" font-size="8"
			      font-family="monospace" font-weight="600"
			      fill={pdNumColor(pd)} opacity={pd ? 1 : 0.3}>{pd ?? '·'}</text>

			<!-- Site hit target / cursor ring -->
			{#if !chartState.locked && !isMissing}
				<circle
					cx={bcx} cy={U_GUM_BUC-4} r={isCur ? 6 : 5}
					fill={isCur ? 'oklch(0.7 0.2 240 / 0.15)' : 'transparent'}
					stroke={isCur ? '#6366f1' : '#cbd5e1'}
					stroke-width={isCur ? 1.5 : 0.8}
					class={isCur ? 'cursor-pulse site-btn' : 'site-btn'}
					role="button"
					tabindex="-1"
					aria-label="{tooth} {site}"
					onclick={() => {
						chartState.cursor = { tooth, row: 'buc', siteIdx: bi };
						onSiteClick?.({ tooth, row: 'buc', siteIdx: bi });
					}}
					oncontextmenu={(e) => { e.preventDefault(); chartState.cycleBop(tooth, site); }}
				/>
			{:else if isCur}
				<circle cx={bcx} cy={U_GUM_BUC-4} r={6}
				        fill="oklch(0.7 0.2 240 / 0.1)" stroke="#6366f1" stroke-width="1.5" class="cursor-pulse"/>
			{/if}
		{/each}

		<!-- ── Lingual bars ── -->
		{#each activeLingSites as site, li}
			{@const mdata = chartState.getM(tooth, site)}
			{@const pd    = mdata.pocket}
			{@const bop   = mdata.bop}
			{@const plq   = mdata.plaque}
			{@const bx    = barX(i, li)}
			{@const bcx   = barCx(i, li)}
			{@const bh    = pdH(pd)}
			{@const cmpPd = comparisonMmap?.[`${tooth}-${site}`]?.pocket ?? null}
			{@const isCur = isCursor(tooth, 'ling', li)}

			{#if cmpPd !== null}
				<rect x={bx} y={U_GUM_LIN-pdH(cmpPd)} width={BAR_W} height={pdH(cmpPd)} fill="#94a3b8" opacity="0.28" rx="1" stroke="#94a3b8" stroke-width="0.5" stroke-dasharray="2,2"/>
			{/if}
			<rect x={bx} y={U_GUM_LIN-bh} width={BAR_W} height={bh}
			      fill={pdBarColor(pd)} opacity={pd ? 0.88 : 0.2} rx="1"/>

			<circle cx={bcx} cy={U_BOP_LIN} r={bop ? 4.5 : 3.5}
			        fill={bopCircleColor(bop)} stroke={bopCircleStroke(bop)}
			        stroke-width={bop ? 0 : 1} opacity={bop ? 0.9 : 0.35}/>
			{#if plq > 0}
				<circle cx={bcx} cy={U_BOP_LIN-8} r="2.5" fill="#60a5fa" opacity="0.7"/>
			{/if}

			<text x={bcx} y={U_NUM_LIN} text-anchor="middle" font-size="8"
			      font-family="monospace" font-weight="600"
			      fill={pdNumColor(pd)} opacity={pd ? 1 : 0.3}>{pd ?? '·'}</text>

			{#if !chartState.locked && !isMissing}
				<circle
					cx={bcx} cy={U_GUM_LIN+4} r={isCur ? 6 : 5}
					fill={isCur ? 'oklch(0.7 0.2 240 / 0.15)' : 'transparent'}
					stroke={isCur ? '#6366f1' : '#cbd5e1'}
					stroke-width={isCur ? 1.5 : 0.8}
					class={isCur ? 'cursor-pulse site-btn' : 'site-btn'}
					role="button"
					tabindex="-1"
					aria-label="{tooth} {site}"
					onclick={() => {
						chartState.cursor = { tooth, row: 'ling', siteIdx: li };
						onSiteClick?.({ tooth, row: 'ling', siteIdx: li });
					}}
					oncontextmenu={(e) => { e.preventDefault(); chartState.cycleBop(tooth, site); }}
				/>
			{:else if isCur}
				<circle cx={bcx} cy={U_GUM_LIN+4} r={6}
				        fill="oklch(0.7 0.2 240 / 0.1)" stroke="#6366f1" stroke-width="1.5" class="cursor-pulse"/>
			{/if}
		{/each}
	</g>
{/each}

<!-- ════════════════════════════════════════════════════ -->
<!-- UPPER ARCH — pocket depth polylines                   -->
<!-- ════════════════════════════════════════════════════ -->
<polyline
	points={UPPER_TEETH.flatMap((t,i) => activeBucSites.map((_s,bi) => {
		const h = pdH(chartState.getM(t, activeBucSites[bi]).pocket);
		return `${barCx(i,bi).toFixed(1)},${(U_GUM_BUC+h).toFixed(1)}`;
	})).join(' ')}
	fill="none" stroke="#6366f1" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.7"/>
<polyline
	points={UPPER_TEETH.flatMap((t,i) => activeLingSites.map((_s,li) => {
		const h = pdH(chartState.getM(t, activeLingSites[li]).pocket);
		return `${barCx(i,li).toFixed(1)},${(U_GUM_LIN-h).toFixed(1)}`;
	})).join(' ')}
	fill="none" stroke="#6366f1" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.7"/>

<!-- Upper bone level polyline -->
{#if chartState.boneUpper.length >= 2}
	<polyline
		points={bonePolyline(chartState.boneUpper, U_TOOTH_T, U_TOOTH_B)}
		fill="none" stroke={BONE_LEVEL_STROKE} stroke-width="1.8"
		stroke-dasharray="5,3" stroke-linecap="round" opacity="0.85"/>
{/if}

<!-- ════════════════════════════════════════════════════ -->
<!-- LOWER ARCH — per-tooth columns                        -->
<!-- ════════════════════════════════════════════════════ -->
{#each LOWER_TEETH as tooth, i}
	{@const sx  = slotX(i)}
	{@const cx  = sx + SLOT_W / 2}
	{@const tw  = crownW(tooth)}
	{@const td  = chartState.getT(tooth)}
	{@const isMissing = td.status === 'missing'}
	{@const mob = td.mobility}

	<g class="tooth-col" opacity={isMissing ? 0.25 : 1}>
		<rect x={sx} y={ARCH_SEP} width={SLOT_W} height={VH-ARCH_SEP} fill="transparent" class="col-bg-l"/>

		{#if i > 0}
			<line x1={sx} y1={ARCH_SEP} x2={sx} y2={VH} stroke="currentColor" stroke-width="0.4" opacity="0.1"/>
		{/if}
		{#if i === 8}
			<line x1={sx} y1={ARCH_SEP} x2={sx} y2={VH} stroke="currentColor" stroke-width="1.4" opacity="0.22"/>
		{/if}

		<text x={cx} y={L_FDI} text-anchor="middle" font-size="9" font-weight="500"
		      fill="currentColor" opacity="0.7" font-family="monospace">{tooth}</text>

		<!-- Mobility -->
		{#if mob !== null && mob > 0}
			<text x={cx} y={L_MOB} text-anchor="middle" font-size="8" font-weight={mob >= 2 ? '700' : '500'}
			      fill={mobilityColor(mob)} font-family="monospace">{mobilityLabel(mob)}</text>
		{/if}

		<!-- AIT/CPT badges -->
		{#if td.ait_planned}
			<rect x={cx-8} y={L_BOP_BUC-10} width={14} height={9} rx="2" fill="#fca5a5"/>
			<text x={cx-1} y={L_BOP_BUC-3} text-anchor="middle" font-size="7" font-weight="700" fill="#991b1b">A</text>
		{/if}
		{#if td.cpt_planned}
			<rect x={cx+2} y={L_BOP_BUC-10} width={14} height={9} rx="2" fill="#c4b5fd"/>
			<text x={cx+9} y={L_BOP_BUC-3} text-anchor="middle" font-size="7" font-weight="700" fill="#5b21b6">C</text>
		{/if}

		<line x1={sx} y1={L_GUM_BUC} x2={sx+SLOT_W} y2={L_GUM_BUC} stroke="currentColor" stroke-width="0.6" opacity="0.15"/>
		<line x1={sx} y1={L_GUM_LIN} x2={sx+SLOT_W} y2={L_GUM_LIN} stroke="currentColor" stroke-width="0.6" opacity="0.15"/>

		<!-- ── Tooth silhouette (lower: crown at top, root at bottom) ── -->
		{#if td.status === 'implant'}
			<text x={cx} y={(L_TOOTH_T+L_TOOTH_B)/2+4} text-anchor="middle" font-size="22" fill="#64748b" opacity="0.5">⬡</text>
		{:else}
			<path d={lowerToothPath(cx, L_TOOTH_T, L_CEJ, L_TOOTH_B, tw)}
			      fill={td.status === 'destroyed' ? 'url(#par-hatch)' : 'url(#par-enamel)'}
			      stroke="#94a3b8" stroke-width="0.8" opacity="0.9"/>
			<clipPath id="par-rc-l-{i}">
				<rect x={cx-tw/2-1} y={L_CEJ} width={tw+2} height={L_TOOTH_B-L_CEJ}/>
			</clipPath>
			<path d={lowerToothPath(cx, L_TOOTH_T, L_CEJ, L_TOOTH_B, tw)}
			      fill="url(#par-root)" stroke="none" clip-path="url(#par-rc-l-{i})" opacity="0.85"/>
			<line x1={cx-tw/2+1} y1={L_CEJ} x2={cx+tw/2-1} y2={L_CEJ} stroke="#64748b" stroke-width="0.8" opacity="0.5"/>
			{#if MOLARS.has(tooth) || PREMOLARS.has(tooth) || CANINES.has(tooth)}
				<path d={crownCusps(tooth, cx, L_TOOTH_T, false)} fill="#cbd5e1" stroke="none" opacity="0.5"/>
			{/if}
			<path d={rootLines(tooth, cx, L_TOOTH_B, false)} fill="none" stroke="#94a3b8" stroke-width="0.8" opacity="0.4"/>
			{#if td.status === 'missing'}
				<text x={cx} y={(L_TOOTH_T+L_TOOTH_B)/2+4} text-anchor="middle" font-size="14" fill="#64748b" opacity="0.6">✕</text>
			{/if}
			{#if td.vitality !== null}
				<circle cx={cx} cy={L_TOOTH_B-4} r={3}
				        fill={td.vitality > 0 ? '#22c55e' : '#94a3b8'}
				        stroke="white" stroke-width="0.8" opacity="0.9"/>
			{/if}
			{#if (MOLARS.has(tooth) || PREMOLARS.has(tooth)) && td.furcation_b !== null && td.furcation_b > 0}
				<path d={furcTriangle(cx, L_TOOTH_B-2, td.furcation_b, 'down')}
				      fill={furcFill(td.furcation_b)} stroke="#d97706" stroke-width="0.8" opacity="0.85"/>
			{/if}
		{/if}

		<!-- Tooth silhouette click target -->
		{#if !chartState.locked}
			<rect
				x={cx-tw/2} y={L_TOOTH_T} width={tw} height={L_TOOTH_B-L_TOOTH_T}
				fill="transparent"
				role="button"
				tabindex="-1"
				aria-label="Tooth {tooth} details"
				onclick={(e) => {
					const s = e.currentTarget.closest('svg') as SVGElement|null;
					if (s) openPopover(tooth, s, cx, (L_TOOTH_T+L_TOOTH_B)/2);
				}}
				style="cursor:pointer"
			/>
		{/if}

		<!-- ── Buccal bars ── -->
		{#each activeBucSites as site, bi}
			{@const mdata = chartState.getM(tooth, site)}
			{@const pd    = mdata.pocket}
			{@const bop   = mdata.bop}
			{@const plq   = mdata.plaque}
			{@const bx    = barX(i, bi)}
			{@const bcx   = barCx(i, bi)}
			{@const bh    = pdH(pd)}
			{@const cmpPd = comparisonMmap?.[`${tooth}-${site}`]?.pocket ?? null}
			{@const isCur = isCursor(tooth, 'buc', bi)}

			{#if cmpPd !== null}
				<rect x={bx} y={L_GUM_BUC} width={BAR_W} height={pdH(cmpPd)} fill="#94a3b8" opacity="0.28" rx="1" stroke="#94a3b8" stroke-width="0.5" stroke-dasharray="2,2"/>
			{/if}
			<rect x={bx} y={L_GUM_BUC} width={BAR_W} height={bh}
			      fill={pdBarColor(pd)} opacity={pd ? 0.88 : 0.2} rx="1"/>
			<circle cx={bcx} cy={L_BOP_BUC} r={bop ? 4.5 : 3.5}
			        fill={bopCircleColor(bop)} stroke={bopCircleStroke(bop)}
			        stroke-width={bop ? 0 : 1} opacity={bop ? 0.9 : 0.35}/>
			{#if plq > 0}
				<circle cx={bcx} cy={L_BOP_BUC+8} r="2.5" fill="#60a5fa" opacity="0.7"/>
			{/if}
			<text x={bcx} y={L_NUM_BUC} text-anchor="middle" font-size="8"
			      font-family="monospace" font-weight="600"
			      fill={pdNumColor(pd)} opacity={pd ? 1 : 0.3}>{pd ?? '·'}</text>
			{#if !chartState.locked && !isMissing}
				<circle
					cx={bcx} cy={L_GUM_BUC-4} r={isCur ? 6 : 5}
					fill={isCur ? 'oklch(0.7 0.2 240 / 0.15)' : 'transparent'}
					stroke={isCur ? '#6366f1' : '#cbd5e1'}
					stroke-width={isCur ? 1.5 : 0.8}
					class={isCur ? 'cursor-pulse site-btn' : 'site-btn'}
					role="button"
					tabindex="-1"
					aria-label="{tooth} {site}"
					onclick={() => {
						chartState.cursor = { tooth, row: 'buc', siteIdx: bi };
						onSiteClick?.({ tooth, row: 'buc', siteIdx: bi });
					}}
					oncontextmenu={(e) => { e.preventDefault(); chartState.cycleBop(tooth, site); }}
				/>
			{:else if isCur}
				<circle cx={bcx} cy={L_GUM_BUC-4} r={6}
				        fill="oklch(0.7 0.2 240 / 0.1)" stroke="#6366f1" stroke-width="1.5" class="cursor-pulse"/>
			{/if}
		{/each}

		<!-- ── Lingual bars ── -->
		{#each activeLingSites as site, li}
			{@const mdata = chartState.getM(tooth, site)}
			{@const pd    = mdata.pocket}
			{@const bop   = mdata.bop}
			{@const plq   = mdata.plaque}
			{@const bx    = barX(i, li)}
			{@const bcx   = barCx(i, li)}
			{@const bh    = pdH(pd)}
			{@const cmpPd = comparisonMmap?.[`${tooth}-${site}`]?.pocket ?? null}
			{@const isCur = isCursor(tooth, 'ling', li)}

			{#if cmpPd !== null}
				<rect x={bx} y={L_GUM_LIN-pdH(cmpPd)} width={BAR_W} height={pdH(cmpPd)} fill="#94a3b8" opacity="0.28" rx="1" stroke="#94a3b8" stroke-width="0.5" stroke-dasharray="2,2"/>
			{/if}
			<rect x={bx} y={L_GUM_LIN-bh} width={BAR_W} height={bh}
			      fill={pdBarColor(pd)} opacity={pd ? 0.88 : 0.2} rx="1"/>
			<circle cx={bcx} cy={L_BOP_LIN} r={bop ? 4.5 : 3.5}
			        fill={bopCircleColor(bop)} stroke={bopCircleStroke(bop)}
			        stroke-width={bop ? 0 : 1} opacity={bop ? 0.9 : 0.35}/>
			{#if plq > 0}
				<circle cx={bcx} cy={L_BOP_LIN-8} r="2.5" fill="#60a5fa" opacity="0.7"/>
			{/if}
			<text x={bcx} y={L_NUM_LIN} text-anchor="middle" font-size="8"
			      font-family="monospace" font-weight="600"
			      fill={pdNumColor(pd)} opacity={pd ? 1 : 0.3}>{pd ?? '·'}</text>
			{#if !chartState.locked && !isMissing}
				<circle
					cx={bcx} cy={L_GUM_LIN+4} r={isCur ? 6 : 5}
					fill={isCur ? 'oklch(0.7 0.2 240 / 0.15)' : 'transparent'}
					stroke={isCur ? '#6366f1' : '#cbd5e1'}
					stroke-width={isCur ? 1.5 : 0.8}
					class={isCur ? 'cursor-pulse site-btn' : 'site-btn'}
					role="button"
					tabindex="-1"
					aria-label="{tooth} {site}"
					onclick={() => {
						chartState.cursor = { tooth, row: 'ling', siteIdx: li };
						onSiteClick?.({ tooth, row: 'ling', siteIdx: li });
					}}
					oncontextmenu={(e) => { e.preventDefault(); chartState.cycleBop(tooth, site); }}
				/>
			{:else if isCur}
				<circle cx={bcx} cy={L_GUM_LIN+4} r={6}
				        fill="oklch(0.7 0.2 240 / 0.1)" stroke="#6366f1" stroke-width="1.5" class="cursor-pulse"/>
			{/if}
		{/each}
	</g>
{/each}

<!-- ════════════════════════════════════════════════════ -->
<!-- LOWER ARCH — pocket depth polylines                   -->
<!-- ════════════════════════════════════════════════════ -->
<polyline
	points={LOWER_TEETH.flatMap((t,i) => activeBucSites.map((_s,bi) => {
		const h = pdH(chartState.getM(t, activeBucSites[bi]).pocket);
		return `${barCx(i,bi).toFixed(1)},${(L_GUM_BUC+h).toFixed(1)}`;
	})).join(' ')}
	fill="none" stroke="#6366f1" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.7"/>
<polyline
	points={LOWER_TEETH.flatMap((t,i) => activeLingSites.map((_s,li) => {
		const h = pdH(chartState.getM(t, activeLingSites[li]).pocket);
		return `${barCx(i,li).toFixed(1)},${(L_GUM_LIN-h).toFixed(1)}`;
	})).join(' ')}
	fill="none" stroke="#6366f1" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.7"/>

<!-- Lower bone level polyline -->
{#if chartState.boneLower.length >= 2}
	<polyline
		points={bonePolyline(chartState.boneLower, L_TOOTH_T, L_TOOTH_B)}
		fill="none" stroke={BONE_LEVEL_STROKE} stroke-width="1.8"
		stroke-dasharray="5,3" stroke-linecap="round" opacity="0.85"/>
{/if}

<!-- ════════════════════════════════════════════════════ -->
<!-- IN-PROGRESS BONE DRAW LINE                            -->
<!-- ════════════════════════════════════════════════════ -->
{#if isDrawing && drawJaw && drawPoints.length >= 2}
	<polyline
		points={bonePolyline(drawPoints, drawJaw === 'upper' ? U_TOOTH_T : L_TOOTH_T, drawJaw === 'upper' ? U_TOOTH_B : L_TOOTH_B)}
		fill="none" stroke={BONE_LEVEL_STROKE} stroke-width="2"
		stroke-dasharray="4,3" stroke-linecap="round" opacity="0.6"
		pointer-events="none"/>
{/if}

<!-- ════════════════════════════════════════════════════ -->
<!-- ROW / SIDE LABELS (left margin)                       -->
<!-- ════════════════════════════════════════════════════ -->
<g font-size="6.5" fill="currentColor" opacity="0.38" text-anchor="end" font-family="sans-serif">
	<text x={LEFT_PAD-11} y={U_BOP_BUC+3}>BOP</text>
	<text x={LEFT_PAD-11} y={U_NUM_BUC+3}>PD</text>
	<text x={LEFT_PAD-11} y={U_NUM_LIN+3}>PD</text>
	<text x={LEFT_PAD-11} y={U_BOP_LIN+3}>BOP</text>
	<text x={LEFT_PAD-11} y={L_BOP_BUC+3}>BOP</text>
	<text x={LEFT_PAD-11} y={L_NUM_BUC+3}>PD</text>
	<text x={LEFT_PAD-11} y={L_NUM_LIN+3}>PD</text>
	<text x={LEFT_PAD-11} y={L_BOP_LIN+3}>BOP</text>
</g>
<g font-size="7" fill="currentColor" opacity="0.45" font-weight="600" font-family="sans-serif" text-anchor="end">
	<text x={LEFT_PAD-11} y={U_GUM_BUC+CHART_H/2+3}>B</text>
	<text x={LEFT_PAD-11} y={U_GUM_LIN-CHART_H/2+3}>L</text>
	<text x={LEFT_PAD-11} y={L_GUM_BUC+CHART_H/2+3}>B</text>
	<text x={LEFT_PAD-11} y={L_GUM_LIN-CHART_H/2+3}>L</text>
</g>

<!-- ════════════════════════════════════════════════════ -->
<!-- LEGEND                                                -->
<!-- ════════════════════════════════════════════════════ -->
<g font-size="8" fill="currentColor" opacity="0.62" transform="translate({LEFT_PAD},{VH-2})">
	<rect x="0"   y="-8" width="10" height="8" fill="#34d399" rx="1"/>
	<text x="13"  y="0">1–3 mm</text>
	<rect x="54"  y="-8" width="10" height="8" fill="#fbbf24" rx="1"/>
	<text x="67"  y="0">4–5 mm</text>
	<rect x="108" y="-8" width="10" height="8" fill="#f87171" rx="1"/>
	<text x="121" y="0">≥ 6 mm</text>
	<circle cx="163" cy="-3" r="4.5" fill="#ef4444" opacity="0.9"/>
	<text x="171"  y="0">BOP</text>
	<circle cx="200" cy="-3" r="2.5" fill="#60a5fa" opacity="0.7"/>
	<text x="207"  y="0">Plaque</text>
	<line x1="244" y1="-3" x2="264" y2="-3" stroke={BONE_LEVEL_STROKE} stroke-width="1.8" stroke-dasharray="4,2" opacity="0.85"/>
	<text x="267"  y="0">{i18n.t.par.chart.boneLevel}</text>
</g>
</svg>
</div>

<!-- Per-tooth popover (anchored to screen coordinates) -->
{#if popoverTooth !== null}
	<ParToothPopover
		tooth={popoverTooth}
		chartState={chartState}
		anchorX={popoverX}
		anchorY={popoverY}
		onClose={() => popoverTooth = null}
	/>
{/if}
