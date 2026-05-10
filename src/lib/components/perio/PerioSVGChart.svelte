<script lang="ts">
	import { toFDI } from '$lib/utils';
	import { i18n } from '$lib/i18n';

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

	// ── Geometry ────────────────────────────────────────────────────────
	const SLOT_W   = 54;
	const VW       = SLOT_W * 16;          // 864
	const LEFT_PAD = 36;                   // ruler space
	const RIGHT_PAD = 8;
	const TOTAL_W  = LEFT_PAD + VW + RIGHT_PAD; // 908

	const BAR_W    = 13;
	const BAR_GAP  = 2;
	const GROUP_W  = BAR_W * 3 + BAR_GAP * 2;   // 43
	const GROUP_OFF = (SLOT_W - GROUP_W) / 2;     // 5.5

	const SCALE    = 8;    // px per mm (for bars)
	const MAX_PD   = 12;
	const CHART_H  = MAX_PD * SCALE; // 96

	// Recession scale inside tooth drawing zone (px per mm)
	const REC_SCALE = 2.8;

	const UPPER_TEETH = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16] as const;
	const LOWER_TEETH = [32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17] as const;
	const BUC_SITES   = ['MB','B','DB'] as const;
	const LIN_SITES   = ['ML','L','DL'] as const;

	// ── Y Coordinates ───────────────────────────────────────────────────
	// UPPER ARCH
	const U_FDI      = 10;
	const U_BOP_BUC  = 23;    // BOP dot row (buccal)
	const U_NUM_BUC  = 37;    // PD numbers (buccal)
	const U_GUM_BUC  = 51;    // buccal gumline → bars grow DOWN from here
	// Buccal bars: U_GUM_BUC … U_GUM_BUC+CHART_H = 147

	// Tooth silhouette zone (54px) — root at top, crown at bottom (upper jaw anatomy)
	const U_TOOTH_T  = 149;   // top of tooth drawing (root side)
	const U_CEJ      = 169;   // CEJ line (20px from top = root region)
	const U_TOOTH_B  = 203;   // bottom of tooth drawing (crown/occlusal side)

	const U_GUM_LIN  = 205;   // lingual gumline → bars grow UP from here
	// Lingual tips: U_GUM_LIN - pd*SCALE, range 109…205

	const U_BOP_LIN  = 217;   // BOP dot row (lingual)
	const U_NUM_LIN  = 231;   // PD numbers (lingual)
	const UPPER_END  = 243;

	const ARCH_SEP   = 253;

	// LOWER ARCH — same structure, crown at top, root at bottom (lower jaw anatomy)
	const L_FDI      = 261;
	const L_BOP_BUC  = 274;
	const L_NUM_BUC  = 288;
	const L_GUM_BUC  = 302;   // buccal gumline
	// Buccal bars: L_GUM_BUC … 398

	const L_TOOTH_T  = 400;   // top of tooth drawing (crown/occlusal side)
	const L_CEJ      = 420;   // CEJ line (20px from top = crown region)
	const L_TOOTH_B  = 454;   // bottom of tooth drawing (root side)

	const L_GUM_LIN  = 456;
	// Lingual tips: L_GUM_LIN - pd*SCALE

	const L_BOP_LIN  = 468;
	const L_NUM_LIN  = 482;

	const VH = 494;

	// ── Tooth geometry helpers ───────────────────────────────────────────
	const MOLARS    = new Set([1,2,3,14,15,16,17,18,19,30,31,32]);
	const PREMOLARS = new Set([4,5,12,13,20,21,28,29]);
	const CANINES   = new Set([6,11,22,27]);
	// incisors: 7,8,9,10,23,24,25,26

	function crownW(tooth: number): number {
		if (MOLARS.has(tooth))    return 40;
		if (PREMOLARS.has(tooth)) return 30;
		if (CANINES.has(tooth))   return 25;
		return 20;
	}

	// Upper arch: root at top (yt→yc), crown at bottom (yc→yb)
	function upperToothPath(cx: number, yt: number, yc: number, yb: number, w: number): string {
		const rw = Math.max(w - 12, 10);
		const cr = 3;
		return `M ${cx - rw/2},${yt} L ${cx - w/2},${yc} L ${cx - w/2},${yb - cr} Q ${cx - w/2},${yb} ${cx - w/2 + cr},${yb} L ${cx + w/2 - cr},${yb} Q ${cx + w/2},${yb} ${cx + w/2},${yb - cr} L ${cx + w/2},${yc} L ${cx + rw/2},${yt} Z`;
	}

	// Lower arch: crown at top (yt→yc), root at bottom (yc→yb)
	function lowerToothPath(cx: number, yt: number, yc: number, yb: number, w: number): string {
		const rw = Math.max(w - 12, 10);
		const cr = 3;
		return `M ${cx - w/2 + cr},${yt} Q ${cx - w/2},${yt} ${cx - w/2},${yt + cr} L ${cx - w/2},${yc} L ${cx - rw/2},${yb} L ${cx + rw/2},${yb} L ${cx + w/2},${yc} L ${cx + w/2},${yt + cr} Q ${cx + w/2},${yt} ${cx + w/2 - cr},${yt} Z`;
	}

	// Add cusp bumps at the crown edge of a tooth (for premolars/molars)
	function crownCusps(tooth: number, cx: number, y: number, isUpper: boolean): string {
		if (CANINES.has(tooth)) {
			// Single cusp tip
			const dir = isUpper ? 1 : -1;
			return `M ${cx},${y + dir*3} L ${cx - 4},${y} L ${cx + 4},${y} Z`;
		}
		if (PREMOLARS.has(tooth)) {
			// Two cusps
			const d = isUpper ? 1 : -1;
			return `M ${cx - 8},${y + d*3} L ${cx - 12},${y} L ${cx - 4},${y} Z M ${cx + 8},${y + d*3} L ${cx + 4},${y} L ${cx + 12},${y} Z`;
		}
		if (MOLARS.has(tooth)) {
			// Three cusps
			const d = isUpper ? 1 : -1;
			return `M ${cx - 14},${y + d*3} L ${cx - 18},${y} L ${cx - 10},${y} Z M ${cx},${y + d*4} L ${cx - 4},${y} L ${cx + 4},${y} Z M ${cx + 14},${y + d*3} L ${cx + 10},${y} L ${cx + 18},${y} Z`;
		}
		return '';
	}

	// Root line(s) at the root tip of the tooth
	function rootLines(tooth: number, cx: number, y: number, isUpper: boolean): string {
		const d = isUpper ? -1 : 1;
		if (MOLARS.has(tooth)) {
			return `M ${cx - 8},${y} L ${cx - 8},${y + d*6} M ${cx + 8},${y} L ${cx + 8},${y + d*6}`;
		}
		if (PREMOLARS.has(tooth)) {
			return `M ${cx - 4},${y} L ${cx - 4},${y + d*5} M ${cx + 4},${y} L ${cx + 4},${y + d*5}`;
		}
		return `M ${cx},${y} L ${cx},${y + d*5}`;
	}

	// ── Bar / polyline helpers ───────────────────────────────────────────
	function slotX(i: number): number { return LEFT_PAD + i * SLOT_W; }
	function barX(i: number, bi: number): number { return slotX(i) + GROUP_OFF + bi * (BAR_W + BAR_GAP); }
	function barCx(i: number, bi: number): number { return barX(i, bi) + BAR_W / 2; }

	function pdColor(pd: number | null): string {
		if (!pd || pd <= 0) return '#d1d5db';
		if (pd <= 3) return '#34d399';
		if (pd <= 5) return '#fbbf24';
		return '#f87171';
	}
	function pdH(pd: number | null): number {
		if (!pd || pd <= 0) return 2;
		return Math.min(pd, MAX_PD) * SCALE;
	}
	function numColor(pd: number | null): string {
		if (!pd || pd <= 0) return '#9ca3af';
		if (pd <= 3) return '#059669';
		if (pd <= 5) return '#d97706';
		return '#dc2626';
	}

	function buildPolyline(teeth: readonly number[], sites: readonly string[], gumY: number, dir: 'down' | 'up'): string {
		return teeth.flatMap((t, i) =>
			sites.map((s, bi) => {
				const h = pdH(pocketDepths[`${t}_${s}`] ?? null);
				const cx = barCx(i, bi);
				const cy = dir === 'down' ? gumY + h : gumY - h;
				return `${cx.toFixed(1)},${cy.toFixed(1)}`;
			})
		).join(' ');
	}

	function buildAreaPath(teeth: readonly number[], sites: readonly string[], gumY: number, dir: 'down' | 'up'): string {
		const pts = teeth.flatMap((t, i) =>
			sites.map((s, bi) => {
				const h = pdH(pocketDepths[`${t}_${s}`] ?? null);
				return [barCx(i, bi), dir === 'down' ? gumY + h : gumY - h] as [number, number];
			})
		);
		if (pts.length === 0) return '';
		return `M ${pts[0][0]},${gumY} L ${pts.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} L ${pts[pts.length-1][0]},${gumY} Z`;
	}

	// Gum margin polyline through tooth zone, using B site recession for buccal, L site for lingual
	function buildGumPolylineBuc(teeth: readonly number[], cejY: number, toothT: number): string {
		return teeth.map((t, i) => {
			const rec = recessions[`${t}_B`] ?? 0;
			const cx = slotX(i) + SLOT_W / 2;
			// recession moves gum toward root = toward TOOTH_T (upper: upward, lower: downward)
			// for upper: isUpper=true → gum moves UP (smaller Y) as rec increases
			// For both arches, buccal gum moves toward TOOTH_T from CEJ
			const towardT = toothT < cejY; // true for upper (toothT is above cejY), false for lower (toothT below cejY)
			const shift = Math.min((rec ?? 0) * REC_SCALE, Math.abs(cejY - toothT) - 2);
			const gy = towardT ? cejY - shift : cejY + shift;
			return `${cx.toFixed(1)},${gy.toFixed(1)}`;
		}).join(' ');
	}

	function buildGumPolylineLin(teeth: readonly number[], cejY: number, toothB: number): string {
		return teeth.map((t, i) => {
			const rec = recessions[`${t}_L`] ?? 0;
			const cx = slotX(i) + SLOT_W / 2;
			// lingual recession moves gum toward TOOTH_B from CEJ
			const towardB = toothB > cejY; // true for upper (toothB below cejY), false? actually both should have toothB further from cejY on the lingual side
			const shift = Math.min((rec ?? 0) * REC_SCALE, Math.abs(toothB - cejY) - 2);
			const gy = towardB ? cejY + shift : cejY - shift;
			return `${cx.toFixed(1)},${gy.toFixed(1)}`;
		}).join(' ');
	}

	const RULER_TICKS = [2, 4, 6, 8, 10, 12];
</script>

<svg
	viewBox="0 0 {TOTAL_W} {VH}"
	class="w-full"
	preserveAspectRatio="xMidYMid meet"
	style="min-width:680px"
	role="img"
	aria-label="Periodontal probing chart"
>
<defs>
	<style>
		.tooth-col { cursor: pointer; }
		.tooth-col:hover .col-bg { fill: oklch(0.93 0.04 240 / 0.3); }
	</style>
	<linearGradient id="buc-grad" x1="0" y1="0" x2="0" y2="1">
		<stop offset="0%" stop-color="#6366f1" stop-opacity="0.16"/>
		<stop offset="100%" stop-color="#6366f1" stop-opacity="0.03"/>
	</linearGradient>
	<linearGradient id="lin-grad" x1="0" y1="1" x2="0" y2="0">
		<stop offset="0%" stop-color="#6366f1" stop-opacity="0.16"/>
		<stop offset="100%" stop-color="#6366f1" stop-opacity="0.03"/>
	</linearGradient>
	<!-- Tooth fill: enamel (crown) -->
	<linearGradient id="enamel-grad" x1="0" y1="0" x2="1" y2="0">
		<stop offset="0%"   stop-color="#f1f5f9" stop-opacity="1"/>
		<stop offset="50%"  stop-color="#ffffff" stop-opacity="1"/>
		<stop offset="100%" stop-color="#e2e8f0" stop-opacity="1"/>
	</linearGradient>
	<!-- Root fill -->
	<linearGradient id="root-grad" x1="0" y1="0" x2="1" y2="0">
		<stop offset="0%"   stop-color="#fef9ef" stop-opacity="1"/>
		<stop offset="50%"  stop-color="#fffbf0" stop-opacity="1"/>
		<stop offset="100%" stop-color="#fef3c7" stop-opacity="1"/>
	</linearGradient>
</defs>

<!-- ══════════════════════════════════════════════════════════════ -->
<!-- REFERENCE LINES                                                 -->
<!-- ══════════════════════════════════════════════════════════════ -->
<!-- 3mm dashed lines (green) -->
{#each [[U_GUM_BUC,'down'],[U_GUM_LIN,'up'],[L_GUM_BUC,'down'],[L_GUM_LIN,'up']] as [g, d]}
	{@const y3 = d === 'down' ? (g as number) + 3*SCALE : (g as number) - 3*SCALE}
	{@const y6 = d === 'down' ? (g as number) + 6*SCALE : (g as number) - 6*SCALE}
	<line x1={LEFT_PAD} y1={y3} x2={LEFT_PAD+VW} y2={y3} stroke="#34d399" stroke-width="0.6" stroke-dasharray="5,5" opacity="0.4"/>
	<line x1={LEFT_PAD} y1={y6} x2={LEFT_PAD+VW} y2={y6} stroke="#f87171" stroke-width="0.6" stroke-dasharray="5,5" opacity="0.45"/>
{/each}

<!-- Arch separator -->
<line x1={LEFT_PAD} y1={ARCH_SEP} x2={LEFT_PAD+VW} y2={ARCH_SEP}
      stroke="currentColor" stroke-width="1.2" opacity="0.25"/>

<!-- ══════════════════════════════════════════════════════════════ -->
<!-- SCALE RULERS (left margin)                                      -->
<!-- ══════════════════════════════════════════════════════════════ -->
{#each [[U_GUM_BUC,'down'],[U_GUM_LIN,'up'],[L_GUM_BUC,'down'],[L_GUM_LIN,'up']] as [g, d]}
	{#each RULER_TICKS as mm}
		{@const ry = d === 'down' ? (g as number) + mm*SCALE : (g as number) - mm*SCALE}
		<line x1={LEFT_PAD - 6} y1={ry} x2={LEFT_PAD - 1} y2={ry}
		      stroke="currentColor" stroke-width="0.8" opacity="0.35"/>
		<text x={LEFT_PAD - 8} y={ry + 3} text-anchor="end" font-size="7"
		      fill="currentColor" opacity="0.4" font-family="monospace">{mm}</text>
	{/each}
	<line x1={LEFT_PAD - 7} y1={g as number} x2={LEFT_PAD - 1} y2={g as number}
	      stroke="currentColor" stroke-width="1.5" opacity="0.5"/>
	<text x={LEFT_PAD - 8} y={(g as number) + 3} text-anchor="end" font-size="7"
	      fill="currentColor" opacity="0.5" font-family="monospace">0</text>
{/each}

<!-- ══════════════════════════════════════════════════════════════ -->
<!-- BAR AREA FILLS (under depth polylines)                          -->
<!-- ══════════════════════════════════════════════════════════════ -->
<path d={buildAreaPath(UPPER_TEETH, BUC_SITES, U_GUM_BUC, 'down')} fill="url(#buc-grad)"/>
<path d={buildAreaPath(UPPER_TEETH, LIN_SITES, U_GUM_LIN, 'up')}   fill="url(#lin-grad)"/>
<path d={buildAreaPath(LOWER_TEETH, BUC_SITES, L_GUM_BUC, 'down')} fill="url(#buc-grad)"/>
<path d={buildAreaPath(LOWER_TEETH, LIN_SITES, L_GUM_LIN, 'up')}   fill="url(#lin-grad)"/>

<!-- ══════════════════════════════════════════════════════════════ -->
<!-- UPPER ARCH — per-tooth columns                                  -->
<!-- ══════════════════════════════════════════════════════════════ -->
{#each UPPER_TEETH as tooth, i}
	{@const sx  = slotX(i)}
	{@const cx  = sx + SLOT_W / 2}
	{@const sel = selectedTooth === tooth}
	{@const cht = chartingTooth === tooth}
	{@const tw  = crownW(tooth)}
	{@const recB_u = recessions[`${tooth}_B`] ?? 0}
	{@const recL_u = recessions[`${tooth}_L`] ?? 0}
	{@const gumBucY_u = U_CEJ - Math.min(recB_u * REC_SCALE, U_CEJ - U_TOOTH_T - 2)}
	{@const gumLinY_u = U_CEJ + Math.min(recL_u * REC_SCALE, U_TOOTH_B - U_CEJ - 2)}

	<g class="tooth-col" onclick={() => onToothSelect(tooth)} role="button" tabindex="-1" aria-label="FDI {toFDI(tooth)}">
		<!-- Column highlight -->
		{#if sel}
			<rect x={sx} y={0} width={SLOT_W} height={UPPER_END} fill="oklch(0.7 0.15 240 / 0.09)" class="col-bg"/>
		{:else if cht}
			<rect x={sx} y={0} width={SLOT_W} height={UPPER_END} fill="oklch(0.85 0.12 80 / 0.12)" class="col-bg" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3"/>
		{:else}
			<rect x={sx} y={0} width={SLOT_W} height={UPPER_END} fill="transparent" class="col-bg"/>
		{/if}

		<!-- Grid line -->
		{#if i > 0}
			<line x1={sx} y1={0} x2={sx} y2={UPPER_END} stroke="currentColor" stroke-width="0.5" opacity="0.1"/>
		{/if}
		{#if i === 8}
			<line x1={sx} y1={0} x2={sx} y2={UPPER_END} stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
		{/if}

		<!-- FDI label -->
		<text x={cx} y={U_FDI} text-anchor="middle" font-size="9"
		      font-weight={sel ? '700' : '500'}
		      fill={sel ? 'oklch(0.45 0.18 240)' : 'currentColor'}
		      opacity={sel ? 1 : 0.7}>{toFDI(tooth)}</text>

		<!-- Gumlines -->
		<line x1={sx} y1={U_GUM_BUC} x2={sx+SLOT_W} y2={U_GUM_BUC} stroke="currentColor" stroke-width="0.7" opacity="0.18"/>
		<line x1={sx} y1={U_GUM_LIN} x2={sx+SLOT_W} y2={U_GUM_LIN} stroke="currentColor" stroke-width="0.7" opacity="0.18"/>

		<!-- ─── TOOTH SILHOUETTE (upper: root at top, crown at bottom) ─── -->
		<!-- Root portion (top of inner zone: U_TOOTH_T → U_CEJ) -->
		<path d={upperToothPath(cx, U_TOOTH_T, U_CEJ, U_TOOTH_B, tw)}
		      fill="url(#enamel-grad)" stroke="#94a3b8" stroke-width="0.8" opacity="0.9"/>

		<!-- Root region overlay (cementum color) from U_TOOTH_T to U_CEJ -->
		<clipPath id="root-clip-u-{i}">
			<rect x={cx - tw/2 - 1} y={U_TOOTH_T} width={tw + 2} height={U_CEJ - U_TOOTH_T}/>
		</clipPath>
		<path d={upperToothPath(cx, U_TOOTH_T, U_CEJ, U_TOOTH_B, tw)}
		      fill="url(#root-grad)" stroke="none" clip-path="url(#root-clip-u-{i})" opacity="0.9"/>

		<!-- CEJ line across tooth -->
		<line x1={cx - tw/2 + 1} y1={U_CEJ} x2={cx + tw/2 - 1} y2={U_CEJ}
		      stroke="#64748b" stroke-width="0.9" opacity="0.6"/>

		<!-- Root line hints at root tip -->
		<path d={rootLines(tooth, cx, U_TOOTH_T, true)}
		      fill="none" stroke="#94a3b8" stroke-width="0.8" opacity="0.5"/>

		<!-- Crown cusps at occlusal edge -->
		{#if MOLARS.has(tooth) || PREMOLARS.has(tooth) || CANINES.has(tooth)}
			<path d={crownCusps(tooth, cx, U_TOOTH_B, true)}
			      fill="#cbd5e1" stroke="none" opacity="0.6"/>
		{/if}

		<!-- Recession zone (exposed root) — buccal side (between gumBucY_u and U_CEJ) -->
		{#if recB_u > 0.1}
			<clipPath id="rec-buc-u-{i}">
				<rect x={cx - tw/2 - 1} y={gumBucY_u} width={tw + 2} height={U_CEJ - gumBucY_u + 1}/>
			</clipPath>
			<path d={upperToothPath(cx, U_TOOTH_T, U_CEJ, U_TOOTH_B, tw)}
			      fill="#fda4af" stroke="none" clip-path="url(#rec-buc-u-{i})" opacity="0.35"/>
		{/if}

		<!-- Recession zone — lingual side (between U_CEJ and gumLinY_u) -->
		{#if recL_u > 0.1}
			<clipPath id="rec-lin-u-{i}">
				<rect x={cx - tw/2 - 1} y={U_CEJ - 1} width={tw + 2} height={gumLinY_u - U_CEJ + 2}/>
			</clipPath>
			<path d={upperToothPath(cx, U_TOOTH_T, U_CEJ, U_TOOTH_B, tw)}
			      fill="#fda4af" stroke="none" clip-path="url(#rec-lin-u-{i})" opacity="0.35"/>
		{/if}

		<!-- ─── BUCCAL bars ─── -->
		{#each BUC_SITES as site, bi}
			{@const key = `${tooth}_${site}`}
			{@const pd  = pocketDepths[key] ?? null}
			{@const bop = bopSites[key] ?? false}
			{@const plq = plaqueSites[key] ?? false}
			{@const cmp = comparisonDepths?.[key] ?? null}
			{@const bx  = barX(i, bi)}
			{@const bcx = barCx(i, bi)}
			{@const bh  = pdH(pd)}

			{#if cmp !== null}
				<rect x={bx} y={U_GUM_BUC} width={BAR_W} height={pdH(cmp)} fill="#94a3b8" opacity="0.3" rx="1"/>
			{/if}
			<rect x={bx} y={U_GUM_BUC} width={BAR_W} height={bh}
			      fill={pdColor(pd)} opacity={pd ? 0.88 : 0.2} rx="1"/>

			<!-- BOP circle -->
			<circle cx={bcx} cy={U_BOP_BUC} r={bop ? 4.5 : 3.5}
			        fill={bop ? '#ef4444' : 'none'}
			        stroke={bop ? '#ef4444' : '#9ca3af'}
			        stroke-width={bop ? 0 : 1}
			        opacity={bop ? 0.9 : 0.38}/>
			{#if plq}
				<rect x={bcx - 2.5} y={U_BOP_BUC + 7} width={5} height={5} rx="1" fill="#fbbf24" opacity="0.75"/>
			{/if}

			<!-- PD number -->
			<text x={bcx} y={U_NUM_BUC} text-anchor="middle" font-size="8"
			      font-family="monospace" font-weight="600"
			      fill={numColor(pd)} opacity={pd ? 1 : 0.3}>{pd ?? '·'}</text>
		{/each}

		<!-- ─── LINGUAL bars ─── -->
		{#each LIN_SITES as site, li}
			{@const key = `${tooth}_${site}`}
			{@const pd  = pocketDepths[key] ?? null}
			{@const bop = bopSites[key] ?? false}
			{@const plq = plaqueSites[key] ?? false}
			{@const cmp = comparisonDepths?.[key] ?? null}
			{@const bx  = barX(i, li)}
			{@const bcx = barCx(i, li)}
			{@const bh  = pdH(pd)}
			{@const by  = U_GUM_LIN - bh}

			{#if cmp !== null}
				<rect x={bx} y={U_GUM_LIN - pdH(cmp)} width={BAR_W} height={pdH(cmp)} fill="#94a3b8" opacity="0.3" rx="1"/>
			{/if}
			<rect x={bx} y={by} width={BAR_W} height={bh}
			      fill={pdColor(pd)} opacity={pd ? 0.88 : 0.2} rx="1"/>

			<circle cx={bcx} cy={U_BOP_LIN} r={bop ? 4.5 : 3.5}
			        fill={bop ? '#ef4444' : 'none'}
			        stroke={bop ? '#ef4444' : '#9ca3af'}
			        stroke-width={bop ? 0 : 1}
			        opacity={bop ? 0.9 : 0.38}/>
			{#if plq}
				<rect x={bcx - 2.5} y={U_BOP_LIN - 12} width={5} height={5} rx="1" fill="#fbbf24" opacity="0.75"/>
			{/if}

			<text x={bcx} y={U_NUM_LIN} text-anchor="middle" font-size="8"
			      font-family="monospace" font-weight="600"
			      fill={numColor(pd)} opacity={pd ? 1 : 0.3}>{pd ?? '·'}</text>
		{/each}
	</g>
{/each}

<!-- ══════════════════════════════════════════════════════════════ -->
<!-- UPPER ARCH — pocket depth polylines (blue)                      -->
<!-- ══════════════════════════════════════════════════════════════ -->
<polyline points={buildPolyline(UPPER_TEETH, BUC_SITES, U_GUM_BUC, 'down')}
          fill="none" stroke="#6366f1" stroke-width="1.8"
          stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>
<polyline points={buildPolyline(UPPER_TEETH, LIN_SITES, U_GUM_LIN, 'up')}
          fill="none" stroke="#6366f1" stroke-width="1.8"
          stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>

<!-- ══════════════════════════════════════════════════════════════ -->
<!-- UPPER ARCH — gum margin / recession polyline (pink)             -->
<!-- ══════════════════════════════════════════════════════════════ -->
<polyline points={buildGumPolylineBuc(UPPER_TEETH, U_CEJ, U_TOOTH_T)}
          fill="none" stroke="#f43f5e" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>
<polyline points={buildGumPolylineLin(UPPER_TEETH, U_CEJ, U_TOOTH_B)}
          fill="none" stroke="#f43f5e" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>

<!-- ══════════════════════════════════════════════════════════════ -->
<!-- LOWER ARCH — per-tooth columns                                  -->
<!-- ══════════════════════════════════════════════════════════════ -->
{#each LOWER_TEETH as tooth, i}
	{@const sx  = slotX(i)}
	{@const cx  = sx + SLOT_W / 2}
	{@const sel = selectedTooth === tooth}
	{@const cht = chartingTooth === tooth}
	{@const tw  = crownW(tooth)}
	{@const recB_l = recessions[`${tooth}_B`] ?? 0}
	{@const recL_l = recessions[`${tooth}_L`] ?? 0}
	{@const gumBucY_l = L_CEJ - Math.min(recB_l * REC_SCALE, L_CEJ - L_TOOTH_T - 2)}
	{@const gumLinY_l = L_CEJ + Math.min(recL_l * REC_SCALE, L_TOOTH_B - L_CEJ - 2)}

	<g class="tooth-col" onclick={() => onToothSelect(tooth)} role="button" tabindex="-1" aria-label="FDI {toFDI(tooth)}">
		{#if sel}
			<rect x={sx} y={ARCH_SEP} width={SLOT_W} height={VH - ARCH_SEP} fill="oklch(0.7 0.15 240 / 0.09)" class="col-bg"/>
		{:else if cht}
			<rect x={sx} y={ARCH_SEP} width={SLOT_W} height={VH - ARCH_SEP} fill="oklch(0.85 0.12 80 / 0.12)" class="col-bg" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3"/>
		{:else}
			<rect x={sx} y={ARCH_SEP} width={SLOT_W} height={VH - ARCH_SEP} fill="transparent" class="col-bg"/>
		{/if}

		{#if i > 0}
			<line x1={sx} y1={ARCH_SEP} x2={sx} y2={VH} stroke="currentColor" stroke-width="0.5" opacity="0.1"/>
		{/if}
		{#if i === 8}
			<line x1={sx} y1={ARCH_SEP} x2={sx} y2={VH} stroke="currentColor" stroke-width="1.5" opacity="0.25"/>
		{/if}

		<text x={cx} y={L_FDI} text-anchor="middle" font-size="9"
		      font-weight={sel ? '700' : '500'}
		      fill={sel ? 'oklch(0.45 0.18 240)' : 'currentColor'}
		      opacity={sel ? 1 : 0.7}>{toFDI(tooth)}</text>

		<line x1={sx} y1={L_GUM_BUC} x2={sx+SLOT_W} y2={L_GUM_BUC} stroke="currentColor" stroke-width="0.7" opacity="0.18"/>
		<line x1={sx} y1={L_GUM_LIN} x2={sx+SLOT_W} y2={L_GUM_LIN} stroke="currentColor" stroke-width="0.7" opacity="0.18"/>

		<!-- ─── TOOTH SILHOUETTE (lower: crown at top, root at bottom) ─── -->
		<!-- Lower tooth: crown at top, root at bottom -->
		<path d={lowerToothPath(cx, L_TOOTH_T, L_CEJ, L_TOOTH_B, tw)}
		      fill="url(#enamel-grad)" stroke="#94a3b8" stroke-width="0.8" opacity="0.9"/>

		<!-- Root region overlay (cementum) from L_CEJ to L_TOOTH_B -->
		<clipPath id="root-clip-l-{i}">
			<rect x={cx - tw/2 - 1} y={L_CEJ} width={tw + 2} height={L_TOOTH_B - L_CEJ}/>
		</clipPath>
		<path d={lowerToothPath(cx, L_TOOTH_T, L_CEJ, L_TOOTH_B, tw)}
		      fill="url(#root-grad)" stroke="none" clip-path="url(#root-clip-l-{i})" opacity="0.9"/>

		<!-- CEJ line -->
		<line x1={cx - tw/2 + 1} y1={L_CEJ} x2={cx + tw/2 - 1} y2={L_CEJ}
		      stroke="#64748b" stroke-width="0.9" opacity="0.6"/>

		<!-- Crown cusps at occlusal edge (top for lower) -->
		{#if MOLARS.has(tooth) || PREMOLARS.has(tooth) || CANINES.has(tooth)}
			<path d={crownCusps(tooth, cx, L_TOOTH_T, false)}
			      fill="#cbd5e1" stroke="none" opacity="0.6"/>
		{/if}

		<!-- Root line hints at bottom -->
		<path d={rootLines(tooth, cx, L_TOOTH_B, false)}
		      fill="none" stroke="#94a3b8" stroke-width="0.8" opacity="0.5"/>

		<!-- Recession zone — buccal (between L_TOOTH_T and gumBucY_l) -->
		{#if recB_l > 0.1}
			<clipPath id="rec-buc-l-{i}">
				<rect x={cx - tw/2 - 1} y={gumBucY_l} width={tw + 2} height={L_CEJ - gumBucY_l + 1}/>
			</clipPath>
			<path d={lowerToothPath(cx, L_TOOTH_T, L_CEJ, L_TOOTH_B, tw)}
			      fill="#fda4af" stroke="none" clip-path="url(#rec-buc-l-{i})" opacity="0.35"/>
		{/if}

		<!-- Recession zone — lingual -->
		{#if recL_l > 0.1}
			<clipPath id="rec-lin-l-{i}">
				<rect x={cx - tw/2 - 1} y={L_CEJ - 1} width={tw + 2} height={gumLinY_l - L_CEJ + 2}/>
			</clipPath>
			<path d={lowerToothPath(cx, L_TOOTH_T, L_CEJ, L_TOOTH_B, tw)}
			      fill="#fda4af" stroke="none" clip-path="url(#rec-lin-l-{i})" opacity="0.35"/>
		{/if}

		<!-- ─── BUCCAL bars ─── -->
		{#each BUC_SITES as site, bi}
			{@const key = `${tooth}_${site}`}
			{@const pd  = pocketDepths[key] ?? null}
			{@const bop = bopSites[key] ?? false}
			{@const plq = plaqueSites[key] ?? false}
			{@const cmp = comparisonDepths?.[key] ?? null}
			{@const bx  = barX(i, bi)}
			{@const bcx = barCx(i, bi)}
			{@const bh  = pdH(pd)}

			{#if cmp !== null}
				<rect x={bx} y={L_GUM_BUC} width={BAR_W} height={pdH(cmp)} fill="#94a3b8" opacity="0.3" rx="1"/>
			{/if}
			<rect x={bx} y={L_GUM_BUC} width={BAR_W} height={bh}
			      fill={pdColor(pd)} opacity={pd ? 0.88 : 0.2} rx="1"/>

			<circle cx={bcx} cy={L_BOP_BUC} r={bop ? 4.5 : 3.5}
			        fill={bop ? '#ef4444' : 'none'}
			        stroke={bop ? '#ef4444' : '#9ca3af'}
			        stroke-width={bop ? 0 : 1}
			        opacity={bop ? 0.9 : 0.38}/>
			{#if plq}
				<rect x={bcx - 2.5} y={L_BOP_BUC + 7} width={5} height={5} rx="1" fill="#fbbf24" opacity="0.75"/>
			{/if}
			<text x={bcx} y={L_NUM_BUC} text-anchor="middle" font-size="8"
			      font-family="monospace" font-weight="600"
			      fill={numColor(pd)} opacity={pd ? 1 : 0.3}>{pd ?? '·'}</text>
		{/each}

		<!-- ─── LINGUAL bars ─── -->
		{#each LIN_SITES as site, li}
			{@const key = `${tooth}_${site}`}
			{@const pd  = pocketDepths[key] ?? null}
			{@const bop = bopSites[key] ?? false}
			{@const plq = plaqueSites[key] ?? false}
			{@const cmp = comparisonDepths?.[key] ?? null}
			{@const bx  = barX(i, li)}
			{@const bcx = barCx(i, li)}
			{@const bh  = pdH(pd)}
			{@const by  = L_GUM_LIN - bh}

			{#if cmp !== null}
				<rect x={bx} y={L_GUM_LIN - pdH(cmp)} width={BAR_W} height={pdH(cmp)} fill="#94a3b8" opacity="0.3" rx="1"/>
			{/if}
			<rect x={bx} y={by} width={BAR_W} height={bh}
			      fill={pdColor(pd)} opacity={pd ? 0.88 : 0.2} rx="1"/>

			<circle cx={bcx} cy={L_BOP_LIN} r={bop ? 4.5 : 3.5}
			        fill={bop ? '#ef4444' : 'none'}
			        stroke={bop ? '#ef4444' : '#9ca3af'}
			        stroke-width={bop ? 0 : 1}
			        opacity={bop ? 0.9 : 0.38}/>
			{#if plq}
				<rect x={bcx - 2.5} y={L_BOP_LIN - 12} width={5} height={5} rx="1" fill="#fbbf24" opacity="0.75"/>
			{/if}
			<text x={bcx} y={L_NUM_LIN} text-anchor="middle" font-size="8"
			      font-family="monospace" font-weight="600"
			      fill={numColor(pd)} opacity={pd ? 1 : 0.3}>{pd ?? '·'}</text>
		{/each}
	</g>
{/each}

<!-- ══════════════════════════════════════════════════════════════ -->
<!-- LOWER ARCH — depth polylines (blue)                             -->
<!-- ══════════════════════════════════════════════════════════════ -->
<polyline points={buildPolyline(LOWER_TEETH, BUC_SITES, L_GUM_BUC, 'down')}
          fill="none" stroke="#6366f1" stroke-width="1.8"
          stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>
<polyline points={buildPolyline(LOWER_TEETH, LIN_SITES, L_GUM_LIN, 'up')}
          fill="none" stroke="#6366f1" stroke-width="1.8"
          stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>

<!-- ══════════════════════════════════════════════════════════════ -->
<!-- LOWER ARCH — gum margin polylines (pink)                        -->
<!-- ══════════════════════════════════════════════════════════════ -->
<polyline points={buildGumPolylineBuc(LOWER_TEETH, L_CEJ, L_TOOTH_T)}
          fill="none" stroke="#f43f5e" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>
<polyline points={buildGumPolylineLin(LOWER_TEETH, L_CEJ, L_TOOTH_B)}
          fill="none" stroke="#f43f5e" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>

<!-- ══════════════════════════════════════════════════════════════ -->
<!-- ROW LABELS & SIDE LABELS (left margin)                          -->
<!-- ══════════════════════════════════════════════════════════════ -->
<g font-size="6.5" fill="currentColor" opacity="0.42" text-anchor="end" font-family="sans-serif">
	<text x={LEFT_PAD - 11} y={U_BOP_BUC + 3}>BAS</text>
	<text x={LEFT_PAD - 11} y={U_NUM_BUC + 3}>TT</text>
	<text x={LEFT_PAD - 11} y={U_BOP_LIN + 3}>BAS</text>
	<text x={LEFT_PAD - 11} y={U_NUM_LIN + 3}>TT</text>
	<text x={LEFT_PAD - 11} y={L_BOP_BUC + 3}>BAS</text>
	<text x={LEFT_PAD - 11} y={L_NUM_BUC + 3}>TT</text>
	<text x={LEFT_PAD - 11} y={L_BOP_LIN + 3}>BAS</text>
	<text x={LEFT_PAD - 11} y={L_NUM_LIN + 3}>TT</text>
</g>
<!-- B / L side labels -->
<g font-size="7" fill="currentColor" opacity="0.5" font-weight="600" font-family="sans-serif" text-anchor="end">
	<text x={LEFT_PAD - 11} y={U_GUM_BUC + CHART_H/2 + 3}>B</text>
	<text x={LEFT_PAD - 11} y={U_GUM_LIN - CHART_H/2 + 3}>L/P</text>
	<text x={LEFT_PAD - 11} y={L_GUM_BUC + CHART_H/2 + 3}>B</text>
	<text x={LEFT_PAD - 11} y={L_GUM_LIN - CHART_H/2 + 3}>L</text>
</g>
<!-- Tooth zone label -->
<g font-size="6" fill="currentColor" opacity="0.35" text-anchor="end" font-family="sans-serif" font-style="italic">
	<text x={LEFT_PAD - 11} y={(U_TOOTH_T + U_TOOTH_B)/2 + 2}>{i18n.t.perio.svgTeethLabel}</text>
	<text x={LEFT_PAD - 11} y={(L_TOOTH_T + L_TOOTH_B)/2 + 2}>{i18n.t.perio.svgTeethLabel}</text>
</g>

<!-- ══════════════════════════════════════════════════════════════ -->
<!-- LEGEND                                                          -->
<!-- ══════════════════════════════════════════════════════════════ -->
<g font-size="8" fill="currentColor" opacity="0.65" transform="translate({LEFT_PAD}, {VH - 2})">
	<rect x="0"   y="-8" width="10" height="8" fill="#34d399" rx="1"/>
	<text x="13"  y="0">1–3 mm</text>
	<rect x="54"  y="-8" width="10" height="8" fill="#fbbf24" rx="1"/>
	<text x="67"  y="0">4–5 mm</text>
	<rect x="108" y="-8" width="10" height="8" fill="#f87171" rx="1"/>
	<text x="121" y="0">≥ 6 mm</text>
	<circle cx="163" cy="-3" r="4.5" fill="#ef4444" opacity="0.9"/>
	<text x="171" y="0">BAS</text>
	<rect x="198" y="-8" width="10" height="8" fill="#fbbf24" opacity="0.75" rx="1"/>
	<text x="211" y="0">Plaque</text>
	<line x1="248" y1="-3" x2="268" y2="-3" stroke="#6366f1" stroke-width="2" opacity="0.75"/>
	<text x="272" y="0">{i18n.t.perio.legendTtTrend}</text>
	<line x1="330" y1="-3" x2="350" y2="-3" stroke="#f43f5e" stroke-width="1.8" opacity="0.75"/>
	<text x="354" y="0">{i18n.t.perio.legendGumMargin}</text>
	<rect x="415" y="-8" width="10" height="8" fill="#fda4af" opacity="0.4" rx="1"/>
	<text x="428" y="0">{i18n.t.perio.legendRecession}</text>
</g>
</svg>
