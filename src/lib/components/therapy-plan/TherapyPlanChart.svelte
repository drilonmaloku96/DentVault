<script lang="ts">
	import type { ToothChartEntry } from '$lib/types';
	import { planProcedures } from '$lib/stores/planProcedures.svelte';
	import ToothChart from '$lib/components/dental/ToothChart.svelte';
	import { toFDI } from '$lib/utils';
	import { i18n } from '$lib/i18n';

	let {
		ghostData,
		procedures,
		entries,
		selectedTooth = null,
		shiftSelectedTeeth = [],
		altSelectedTeeth = [],
		onToothClick,
		onDragSelect,
		onBlankClick = undefined,
	}: {
		ghostData: ToothChartEntry[];
		procedures: Record<string, string[]>;
		entries: ToothChartEntry[];
		selectedTooth?: number | null;
		shiftSelectedTeeth?: number[];
		altSelectedTeeth?: number[];
		onToothClick: (tooth: number, shiftHeld: boolean, altHeld: boolean) => void;
		onDragSelect: (teeth: number[], modifier: 'shift' | 'alt' | 'none') => void;
		onBlankClick?: () => void;
	} = $props();

	// ── Geometry (mirror ToothChart.svelte) ──────────────────────────────
	const SW = 46;
	const VW = SW * 16; // 736
	const VH = 304;
	const BL_PAD = 18; // must match ToothChart.svelte — expands viewBox for B/L labels
	const UPPER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
	const LOWER = [32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17];
	type ToothType = 'M' | 'P' | 'C' | 'I';
	const SLOT_TYPE: ToothType[] = ['M','M','M','P','P','C','I','I','I','I','C','P','P','M','M','M'];
	const CROWN_W: Record<ToothType, number> = { M: 32, P: 26, C: 22, I: 20 };
	const CROWN_H: Record<ToothType, number> = { M: 40, P: 36, C: 38, I: 32 };
	const UPPER_BASE = 108;
	const LOWER_TOP  = 208;
	const cx = (slot: number) => SW * slot + SW / 2;
	const ALL_TEETH = [...UPPER, ...LOWER];

	interface Bounds {
		x: number; y: number; w: number; h: number;
		tcx: number; tcy: number; isUpper: boolean; slot: number;
	}

	function getBounds(tooth: number): Bounds | null {
		const ui = UPPER.indexOf(tooth);
		const li = LOWER.indexOf(tooth);
		if (ui >= 0) {
			const t = SLOT_TYPE[ui]; const w = CROWN_W[t]; const h = CROWN_H[t];
			return { x: cx(ui) - w/2, y: UPPER_BASE - h, w, h, tcx: cx(ui), tcy: UPPER_BASE - h/2, isUpper: true, slot: ui };
		} else if (li >= 0) {
			const t = SLOT_TYPE[li]; const w = CROWN_W[t]; const h = CROWN_H[t];
			return { x: cx(li) - w/2, y: LOWER_TOP, w, h, tcx: cx(li), tcy: LOWER_TOP + h/2, isUpper: false, slot: li };
		}
		return null;
	}

	function hitTestTooth(x: number, y: number): number | null {
		for (const tooth of ALL_TEETH) {
			const b = getBounds(tooth);
			if (b && x >= b.x - 3 && x <= b.x + b.w + 3 && y >= b.y - 3 && y <= b.y + b.h + 3) {
				return tooth;
			}
		}
		return null;
	}

	// ── Bridge groups from plan entries ──────────────────────────────────
	const bridgeGroups = $derived.by(() => {
		const map = new Map<string, ToothChartEntry[]>();
		for (const e of entries) {
			if (e.bridge_group_id) {
				if (!map.has(e.bridge_group_id)) map.set(e.bridge_group_id, []);
				map.get(e.bridge_group_id)!.push(e);
			}
		}
		return map;
	});

	const bridgeTeeth = $derived(new Set(entries.filter(e => e.bridge_group_id).map(e => e.tooth_number)));

	// ── Procedure colors + abbreviations — derived from store ─────────────
	const PROC_COLOR = $derived(
		Object.fromEntries(planProcedures.list.map(p => [p.key, p.color]))
	);
	const PROC_ABBR = $derived(
		Object.fromEntries(planProcedures.list.map(p => [p.key, p.abbr]))
	);

	// ── Pointer-capture drag-select ───────────────────────────────────────
	let containerEl = $state<HTMLDivElement | null>(null);
	let isDragging = $state(false);
	let hasMoved = $state(false);
	let localDragTeeth = $state<number[]>([]);
	let hoveredTooth = $state<number | null>(null);
	let dragPointerDownX = 0;
	let dragPointerDownY = 0;
	let dragModifier = $state<'shift' | 'alt' | 'none'>('none');

	function toSvgCoords(e: PointerEvent): { x: number; y: number } | null {
		if (!containerEl) return null;
		const rect = containerEl.getBoundingClientRect();
		return {
			x: (e.clientX - rect.left) / rect.width * VW,
			y: (e.clientY - rect.top) / rect.height * VH,
		};
	}

	function onPointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		const pt = toSvgCoords(e);
		if (!pt) return;
		const tooth = hitTestTooth(pt.x, pt.y);
		if (tooth === null) return;
		(e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
		isDragging = true;
		hasMoved = false;
		localDragTeeth = [tooth];
		dragPointerDownX = e.clientX;
		dragPointerDownY = e.clientY;
		dragModifier = e.shiftKey ? 'shift' : e.altKey ? 'alt' : 'none';
	}

	function onPointerMove(e: PointerEvent) {
		const pt = toSvgCoords(e);
		if (!pt) return;
		hoveredTooth = hitTestTooth(pt.x, pt.y);

		if (!isDragging) return;
		const dx = e.clientX - dragPointerDownX;
		const dy = e.clientY - dragPointerDownY;
		if (!hasMoved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) hasMoved = true;
		if (!hasMoved) return;

		const tooth = hoveredTooth;
		if (tooth !== null && !localDragTeeth.includes(tooth)) {
			const isUpper = (t: number) => t >= 1 && t <= 16;
			if (localDragTeeth.length === 0 || isUpper(tooth) === isUpper(localDragTeeth[0])) {
				localDragTeeth = [...localDragTeeth, tooth];
			}
		}
	}

	function onPointerUp(e: PointerEvent) {
		if (!isDragging) return;
		isDragging = false;
		const teeth = [...localDragTeeth];
		const moved = hasMoved;
		const mod = dragModifier;
		localDragTeeth = [];
		hasMoved = false;
		dragModifier = 'none';

		if (moved && teeth.length >= 2) {
			onDragSelect(teeth, mod);
		} else if (teeth.length >= 1) {
			onToothClick(teeth[0], e.shiftKey, e.altKey);
		}
	}

	function onPointerLeave() {
		hoveredTooth = null;
	}

	// During drag: show localDragTeeth; otherwise show persistent selections
	const dragActive = $derived(isDragging && hasMoved && localDragTeeth.length > 0);
	const dragColor = $derived(dragModifier === 'alt' ? '#0ea5e9' : '#7c3aed');

	const cursorStyle = 'cursor: default;';
	const shiftColor = '#7c3aed'; // violet — prosthesis
	const altColor   = '#0ea5e9'; // sky    — tag assignment
</script>

<div class="overflow-x-auto rounded-md border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/20 dark:bg-amber-950/10 select-none">
	<div
		class="relative"
		style="min-width: 560px; {cursorStyle}"
		bind:this={containerEl}
		role="application"
		aria-label={i18n.t.chart.planningAriaLabel}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointerleave={onPointerLeave}
		onclick={(e) => {
			const pt = toSvgCoords(e as unknown as PointerEvent);
			if (!pt || hitTestTooth(pt.x, pt.y) === null) onBlankClick?.();
		}}
	>
		<!-- ── Layer 1: Clinical befund ghost — dimmed but colored ── -->
		<div class="pointer-events-none select-none"
			style="filter: saturate(0.35) opacity(0.55) brightness(0.82);">
			<ToothChart
				chartData={ghostData}
				selectedTooth={null}
				selectedSurface={null}
				showLegend={false}
				onToothClick={() => {}}
			/>
		</div>

		<!-- ── Layer 2: Planning overlay SVG ── -->
		<svg
			class="absolute inset-0 w-full h-full pointer-events-none"
			viewBox="-{BL_PAD} 0 {VW + BL_PAD * 2} {VH}"
			preserveAspectRatio="none"
			style="display:block;"
		>
			<!-- Subtle arch midline -->
			<line x1="0" y1="158" x2={VW} y2="158"
				stroke="#f59e0b" stroke-width="0.6" stroke-opacity="0.35"/>

			<!-- ── Bridge groups from plan entries ── -->
			{#each [...bridgeGroups.values()] as members}
				{@const upperG = members.filter(m => UPPER.includes(m.tooth_number))}
				{@const lowerG = members.filter(m => LOWER.includes(m.tooth_number))}
				{#each [upperG, lowerG].filter(g => g.length > 0) as group}
					{@const isUpper = UPPER.includes(group[0].tooth_number)}
					{@const bnds = group.map(m => getBounds(m.tooth_number)).filter((b): b is Bounds => b !== null)}
					{#if bnds.length > 0}
						{@const minX = Math.min(...bnds.map(b => b.x))}
						{@const maxX = Math.max(...bnds.map(b => b.x + b.w))}
						<rect
							x={minX} y={isUpper ? UPPER_BASE + 2 : LOWER_TOP - 8}
							width={maxX - minX} height={6}
							fill="#7c3aed" fill-opacity="0.3"
							stroke="#7c3aed" stroke-width="1.5" stroke-dasharray="8,3"
							rx="2"
						/>
						{#each group as member}
							{@const b = getBounds(member.tooth_number)}
							{#if b}
								{@const isPontic = member.bridge_role === 'pontic'}
								<rect
									x={b.x + 1} y={b.y + 1} width={b.w - 2} height={b.h - 2}
									fill={isPontic ? '#7c3aed' : 'none'}
									fill-opacity={isPontic ? 0.18 : 0}
									stroke="#7c3aed" stroke-width={isPontic ? 1 : 2}
									stroke-dasharray={isPontic ? '5,3' : '0'}
									rx="2"
								/>
								<text x={b.tcx} y={b.tcy + 4}
									font-size="8" font-weight="700" fill="#7c3aed"
									text-anchor="middle" font-family="sans-serif"
									style="user-select:none;"
								>{isPontic ? 'P' : 'B'}</text>
							{/if}
						{/each}
					{/if}
				{/each}
			{/each}

			<!-- ── Procedure markers ── -->
			{#each Object.entries(procedures) as [toothStr, procList]}
				{@const tooth = parseInt(toothStr)}
				{@const b = getBounds(tooth)}
				{@const procs = Array.isArray(procList) ? procList : [procList as unknown as string]}
				{#if b && !isNaN(tooth) && procs.length > 0}
					{#if bridgeTeeth.has(tooth)}
						<!-- ── Bridge tooth: small corner procedure badges ── -->
						{#each procs as procKey, pi}
							{@const col = PROC_COLOR[procKey] ?? '#999'}
							{@const abbr = PROC_ABBR[procKey] ?? '?'}
							{@const bx = b.x + 1 + pi * 11}
							{@const by = b.isUpper ? b.y + 2 : b.y + b.h - 11}
							<rect x={bx} y={by} width={9} height={9}
								fill={col} fill-opacity="0.95" rx="1.5"/>
							<text x={bx + 4.5} y={by + 7}
								font-size={abbr.length > 1 ? '5' : '6.5'} font-weight="800" fill="white"
								text-anchor="middle" font-family="sans-serif"
								style="user-select:none;">{abbr}</text>
						{/each}
					{:else}

					{#if procs.length === 1}
						<!-- ── Single procedure: rich dedicated marker ── -->
						{@const procKey = procs[0]}
						{@const col = PROC_COLOR[procKey] ?? '#f59e0b'}
						{@const abbr = PROC_ABBR[procKey] ?? '?'}

						{#if procKey === 'plan_extract'}
							<rect x={b.x} y={b.y} width={b.w} height={b.h}
								fill="#ef4444" fill-opacity="0.07"
								stroke="#ef4444" stroke-width="1.5" stroke-dasharray="5,3" rx="3"/>
							<line x1={b.x + 5} y1={b.y + 5} x2={b.x + b.w - 5} y2={b.y + b.h - 5}
								stroke="#ef4444" stroke-width="2.8" stroke-dasharray="5,2.5" stroke-linecap="round"/>
							<line x1={b.x + b.w - 5} y1={b.y + 5} x2={b.x + 5} y2={b.y + b.h - 5}
								stroke="#ef4444" stroke-width="2.8" stroke-dasharray="5,2.5" stroke-linecap="round"/>

						{:else if procKey === 'plan_fill'}
							<rect x={b.x} y={b.y} width={b.w} height={b.h}
								fill="#f59e0b" fill-opacity="0.65"
								stroke="#d97706" stroke-width="2" rx="2"/>
							<text x={b.tcx} y={b.tcy + 4} font-size="10" font-weight="800"
								fill="#78350f" text-anchor="middle" font-family="sans-serif"
								style="user-select:none;">F</text>

						{:else if procKey === 'plan_crown'}
							<rect x={b.x - 3} y={b.y - 4} width={b.w + 6} height={b.h + 4}
								fill="#ea580c" fill-opacity="0.13"
								stroke="#ea580c" stroke-width="2.5" stroke-dasharray="7,3" rx="5"/>
							<text x={b.tcx} y={b.tcy + 4} font-size="10" font-weight="800"
								fill="#ea580c" text-anchor="middle" font-family="sans-serif"
								style="user-select:none;">K</text>

						{:else if procKey === 'plan_rct'}
							{@const r = Math.round(Math.min(b.w, b.h) / 2 - 2)}
							<circle cx={b.tcx} cy={b.tcy} r={r}
								fill="none" stroke="#0891b2" stroke-width="1.5" stroke-dasharray="4,2.5"/>
							<circle cx={b.tcx} cy={b.tcy} r="4" fill="#0891b2"/>
							<line x1={b.x + 2} y1={b.tcy} x2={b.x + b.w - 2} y2={b.tcy}
								stroke="#0891b2" stroke-width="0.8" stroke-opacity="0.45"/>
							<line x1={b.tcx} y1={b.y + 2} x2={b.tcx} y2={b.y + b.h - 2}
								stroke="#0891b2" stroke-width="0.8" stroke-opacity="0.45"/>

						{:else if procKey === 'plan_implant'}
							<circle cx={b.tcx} cy={b.tcy} r="13"
								fill="#059669" fill-opacity="0.92"/>
							<line x1={b.tcx - 7} y1={b.tcy} x2={b.tcx + 7} y2={b.tcy}
								stroke="white" stroke-width="2.5" stroke-linecap="round"/>
							<line x1={b.tcx} y1={b.tcy - 7} x2={b.tcx} y2={b.tcy + 7}
								stroke="white" stroke-width="2.5" stroke-linecap="round"/>

						{:else if procKey === 'plan_veneer'}
							<polygon
								points="{b.x},{b.y} {b.x + b.w},{b.y} {b.x},{b.y + b.h}"
								fill="#db2777" fill-opacity="0.48"/>
							<rect x={b.x} y={b.y} width={b.w} height={b.h}
								fill="none" stroke="#db2777" stroke-width="1.5" rx="2"/>
							<text x={b.tcx} y={b.y + b.h - 5} font-size="8" font-weight="700"
								fill="#db2777" text-anchor="middle" font-family="sans-serif"
								style="user-select:none;">V</text>

						{:else if procKey === 'plan_watch'}
							<polygon
								points="{b.tcx},{b.y + 4} {b.x + b.w - 4},{b.tcy} {b.tcx},{b.y + b.h - 4} {b.x + 4},{b.tcy}"
								fill="#64748b" fill-opacity="0.09"
								stroke="#64748b" stroke-width="1.5" stroke-dasharray="4,2"/>
							<text x={b.tcx} y={b.tcy + 5} font-size="13" font-weight="800"
								fill="#64748b" text-anchor="middle" font-family="sans-serif"
								style="user-select:none;">?</text>

						{:else if procKey === 'plan_partial_denture' || procKey === 'plan_full_denture'}
							{@const exp = procKey === 'plan_full_denture' ? 5 : 3}
							<rect
								x={b.x - exp} y={b.y - exp}
								width={b.w + exp * 2} height={b.h + exp * 2}
								fill={col} fill-opacity="0.11"
								stroke={col} stroke-width="2" stroke-dasharray="6,3"
								rx={4 + exp}/>
							<text x={b.tcx} y={b.tcy + 4}
								font-size={abbr.length > 1 ? '7' : '10'} font-weight="700"
								fill={col} text-anchor="middle" font-family="sans-serif"
								style="user-select:none;">{abbr}</text>

						{:else}
							<rect x={b.x} y={b.y} width={b.w} height={b.h}
								fill={col} fill-opacity="0.2"
								stroke={col} stroke-width="1.5" stroke-dasharray="4,2" rx="3"/>
							<text x={b.tcx} y={b.tcy + 4}
								font-size={abbr.length > 1 ? '8' : '10'} font-weight="700"
								fill={col} text-anchor="middle" font-family="sans-serif"
								style="user-select:none;">{abbr}</text>
						{/if}

						<!-- FDI label (single proc) -->
						{#if b.isUpper}
							<text x={b.tcx} y="20" font-size="8" font-weight="600"
								fill={col} fill-opacity="0.9" text-anchor="middle" font-family="sans-serif"
								style="user-select:none;">{toFDI(tooth)}</text>
						{:else}
							<text x={b.tcx} y={VH - 4} font-size="8" font-weight="600"
								fill={col} fill-opacity="0.9" text-anchor="middle" font-family="sans-serif"
								style="user-select:none;">{toFDI(tooth)}</text>
						{/if}

					{:else}
						<!-- ── Multiple procedures: colored strip stack (clipped to tooth bounds) ── -->
						{@const hasExtract = procs.includes('plan_extract')}
						{@const displayProcs = procs.filter(p => p !== 'plan_extract')}
						{@const renderProcs = displayProcs.length > 0 ? displayProcs : procs}
						{@const stripH = b.h / renderProcs.length}
						{@const primaryCol = PROC_COLOR[renderProcs[0]] ?? '#f59e0b'}
						{@const clipId = `tpc-${tooth}`}

						<defs>
							<clipPath id={clipId}>
								<rect x={b.x} y={b.y} width={b.w} height={b.h} rx="3"/>
							</clipPath>
						</defs>

						<!-- Strips clipped to tooth shape -->
						<g clip-path="url(#{clipId})">
							{#each renderProcs as procKey, si}
								{@const col = PROC_COLOR[procKey] ?? '#999'}
								{@const abbr = PROC_ABBR[procKey] ?? '?'}
								{@const sy = b.y + si * stripH}
								<rect x={b.x} y={sy} width={b.w} height={stripH + 0.5}
									fill={col} fill-opacity="0.85"/>
								<!-- Divider line between strips -->
								{#if si > 0}
									<line x1={b.x} y1={sy} x2={b.x + b.w} y2={sy}
										stroke="rgba(255,255,255,0.4)" stroke-width="0.75"/>
								{/if}
								<text x={b.tcx} y={sy + stripH / 2 + 3.5}
									font-size={stripH > 14 ? '8' : '7'} font-weight="700" fill="white"
									text-anchor="middle" font-family="sans-serif"
									style="user-select:none;">{abbr}</text>
							{/each}
						</g>

						<!-- Rounded border frame -->
						<rect x={b.x} y={b.y} width={b.w} height={b.h}
							fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="1.5" rx="3"/>

						<!-- Extraction X overlay on top if extract is one of the procedures -->
						{#if hasExtract}
							<rect x={b.x} y={b.y} width={b.w} height={b.h}
								fill="#ef4444" fill-opacity="0.08"
								stroke="#ef4444" stroke-width="1.5" stroke-dasharray="5,3" rx="3"/>
							<line x1={b.x + 5} y1={b.y + 5} x2={b.x + b.w - 5} y2={b.y + b.h - 5}
								stroke="#ef4444" stroke-width="2.5" stroke-dasharray="5,2.5" stroke-linecap="round"/>
							<line x1={b.x + b.w - 5} y1={b.y + 5} x2={b.x + 5} y2={b.y + b.h - 5}
								stroke="#ef4444" stroke-width="2.5" stroke-dasharray="5,2.5" stroke-linecap="round"/>
						{/if}

						<!-- FDI label (multi-proc: first strip color) -->
						{#if b.isUpper}
							<text x={b.tcx} y="20" font-size="8" font-weight="600"
								fill={primaryCol} fill-opacity="0.9" text-anchor="middle" font-family="sans-serif"
								style="user-select:none;">{toFDI(tooth)}</text>
						{:else}
							<text x={b.tcx} y={VH - 4} font-size="8" font-weight="600"
								fill={primaryCol} fill-opacity="0.9" text-anchor="middle" font-family="sans-serif"
								style="user-select:none;">{toFDI(tooth)}</text>
						{/if}
					{/if}
				{/if}
			{/if}
			{/each}

			<!-- ── Selected tooth: amber dashed highlight ring ── -->
			{#if selectedTooth !== null}
				{@const b = getBounds(selectedTooth)}
				{#if b}
					<rect
						x={b.x - 5} y={b.y - 5}
						width={b.w + 10} height={b.h + 10}
						fill="#f59e0b" fill-opacity="0.12"
						stroke="#f59e0b" stroke-width="2.5" stroke-dasharray="6,3"
						rx="6"
					/>
				{/if}
			{/if}

			<!-- Shift-selected teeth (prosthesis): violet rings -->
			{#if !dragActive}
				{#each shiftSelectedTeeth as tooth}
					{@const b = getBounds(tooth)}
					{#if b}
						<rect x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6}
							fill={shiftColor} fill-opacity="0.12"
							stroke={shiftColor} stroke-width="2" stroke-dasharray="4,2" rx="4"/>
					{/if}
				{/each}
				<!-- Alt-selected teeth (tag assignment): sky rings -->
				{#each altSelectedTeeth as tooth}
					{@const b = getBounds(tooth)}
					{#if b}
						<rect x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6}
							fill={altColor} fill-opacity="0.12"
							stroke={altColor} stroke-width="2" stroke-dasharray="4,2" rx="4"/>
					{/if}
				{/each}
			{/if}

			<!-- Drag-in-progress rings + badge -->
			{#if dragActive}
				{#each localDragTeeth as tooth}
					{@const b = getBounds(tooth)}
					{#if b}
						<rect x={b.x - 3} y={b.y - 3} width={b.w + 6} height={b.h + 6}
							fill={dragColor} fill-opacity="0.12"
							stroke={dragColor} stroke-width="2" stroke-dasharray="4,2" rx="4"/>
					{/if}
				{/each}
				{#if localDragTeeth.length >= 2}
					<rect x="4" y="4" width="58" height="18" rx="9"
						fill={dragColor} fill-opacity="0.92"/>
					<text x="33" y="17" font-size="10" font-weight="700" fill="white"
						text-anchor="middle" font-family="sans-serif"
						style="user-select:none;">{i18n.t.plans.dragTeethCount.replace('{n}', String(localDragTeeth.length))}</text>
				{/if}
			{/if}
		</svg>
	</div>
</div>
