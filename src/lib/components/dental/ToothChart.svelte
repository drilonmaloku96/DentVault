<script lang="ts">
	import type { ToothChartEntry } from '$lib/types';
	import { dentalTags } from '$lib/stores/dentalTags.svelte';
	import { toFDI } from '$lib/utils';

	let {
		chartData,
		onToothClick,
		selectedTooth = null,
		selectedSurface = null,
		onBridgeRangeSelected = undefined,
		chartingTooth = null,
		shiftSelectedTeeth = [],
	}: {
		chartData: ToothChartEntry[];
		onToothClick: (toothNumber: number, shiftHeld: boolean) => void;
		selectedTooth?: number | null;
		selectedSurface?: string | null;
		onBridgeRangeSelected?: (teeth: number[]) => void;
		chartingTooth?: number | null;
		shiftSelectedTeeth?: number[];
	} = $props();

	// ── Layout constants ────────────────────────────────────────────────
	const SW = 46;
	const VW = SW * 16;
	const VH = 304;

	const UPPER_BASE = 108;   // bottom y of upper crowns; roots grow UPWARD from here
	const ROOT_H     = 36;    // pixel height of roots
	const LOWER_TOP  = 208;   // top y of lower crowns; roots grow DOWNWARD from here
	const ARCH_Y     = Math.round((UPPER_BASE + LOWER_TOP) / 2); // midline arch separator (y=158)

	// ── Tooth definitions ──────────────────────────────────────────────
	type ToothType = 'M' | 'P' | 'C' | 'I';
	const UPPER: number[] = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
	const LOWER: number[] = [32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17];
	const SLOT_TYPE: ToothType[] = ['M','M','M','P','P','C','I','I','I','I','C','P','P','M','M','M'];
	const CROWN_W: Record<ToothType, number> = { M: 32, P: 26, C: 22, I: 20 };
	const CROWN_H: Record<ToothType, number> = { M: 40, P: 36, C: 38, I: 32 };

	// ── Root counts per tooth (Universal 1–32) ──────────────────────────
	const ROOT_COUNTS: Record<number, number> = {
		 1:3,  2:3,  3:3,  4:2,  5:2,  6:1,  7:1,  8:1,  // Upper right (Q1)
		 9:1, 10:1, 11:1, 12:2, 13:2, 14:3, 15:3, 16:3,  // Upper left  (Q2)
		17:2, 18:2, 19:2, 20:1, 21:1, 22:1, 23:1, 24:1,  // Lower left  (Q3)
		25:1, 26:1, 27:1, 28:1, 29:1, 30:2, 31:2, 32:2,  // Lower right (Q4)
	};

	// Conditions that have no natural roots
	const NO_ROOT = new Set(['extracted', 'missing', 'implant']);

	// ── Root geometry ───────────────────────────────────────────────────
	interface RootInfo { points: string; centerX: number; apexY: number; }

	function makeRoots(slotCx: number, crownW: number, numRoots: number, rootBaseY: number, goUp: boolean): RootInfo[] {
		const totalW = crownW * 0.70;
		const gap    = 2;
		const rw     = (totalW - gap * (numRoots - 1)) / numRoots;
		const tipW   = 2.5;
		return Array.from({ length: numRoots }, (_, i) => {
			const left  = slotCx - totalW / 2 + i * (rw + gap);
			const right = left + rw;
			const rcx   = (left + right) / 2;
			const y1    = rootBaseY;
			const y2    = goUp ? rootBaseY - ROOT_H : rootBaseY + ROOT_H;
			const points = `${left},${y1} ${right},${y1} ${rcx + tipW / 2},${y2} ${rcx - tipW / 2},${y2}`;
			return { points, centerX: rcx, apexY: y2 };
		});
	}

	// ── Helpers ────────────────────────────────────────────────────────
	function cx(slot: number): number { return SW * slot + SW / 2; }

	function getEntry(toothNum: number): ToothChartEntry | undefined {
		return chartData.find(e => e.tooth_number === toothNum);
	}
	function getCondition(toothNum: number): string {
		return getEntry(toothNum)?.condition ?? 'healthy';
	}

	function parseSurfaces(json: string): Partial<Record<string, string>> {
		try { return JSON.parse(json) as Partial<Record<string, string>>; }
		catch { return {}; }
	}
	function surfKey(s: Partial<Record<string, string>>, key: string, fallback: string): string {
		return s[key] || fallback;
	}

	// ── Divided-square crown geometry ───────────────────────────────────
	interface ToothGeom {
		pTop: string; pBot: string; pLeft: string; pRight: string; pCenter: string;
		ox: number; oy: number; ow: number; oh: number;
		ix: number; iy: number; iw: number; ih: number;
		m: number;
	}

	function dividedSquare(x: number, y: number, w: number, h: number): ToothGeom {
		const m = Math.max(5, Math.round(w * 0.26));
		const x2 = x + w, y2 = y + h;
		const ix = x + m, iy = y + m, ix2 = x2 - m, iy2 = y2 - m;
		const pts = (...pairs: number[]) =>
			Array.from({ length: pairs.length / 2 }, (_, i) => `${pairs[i * 2]},${pairs[i * 2 + 1]}`).join(' ');
		return {
			pTop:    pts(x, y,   x2, y,   ix2, iy,  ix, iy),
			pBot:    pts(x, y2,  ix, iy2, ix2, iy2, x2, y2),
			pLeft:   pts(x, y,   ix, iy,  ix, iy2,  x, y2),
			pRight:  pts(x2, y,  x2, y2,  ix2, iy2, ix2, iy),
			pCenter: pts(ix, iy, ix2, iy, ix2, iy2, ix, iy2),
			ox: x, oy: y, ow: w, oh: h,
			ix, iy, iw: w - 2 * m, ih: h - 2 * m, m,
		};
	}

	function upperGeom(slot: number): ToothGeom {
		const t = SLOT_TYPE[slot]; const w = CROWN_W[t], h = CROWN_H[t];
		return dividedSquare(cx(slot) - w / 2, UPPER_BASE - h, w, h);
	}
	function lowerGeom(slot: number): ToothGeom {
		const t = SLOT_TYPE[slot]; const w = CROWN_W[t], h = CROWN_H[t];
		return dividedSquare(cx(slot) - w / 2, LOWER_TOP, w, h);
	}

	function isDashed(cond: string) { return cond === 'missing' || cond === 'extracted'; }

	// ── Bridge group rendering data ─────────────────────────────────────
	interface BridgeGroupRender {
		minSlot: number;
		maxSlot: number;
		isUpper: boolean;
		kind: 'bridge' | 'prosthesis';
		// For prosthesis: anchor tooth slots (telescope/clasp/attachment)
		anchorSlots: number[];
	}

	const bridgeGroups = $derived.by<Map<string, BridgeGroupRender>>(() => {
		const map = new Map<string, BridgeGroupRender>();
		for (const entry of chartData) {
			if (!entry.bridge_group_id) continue;
			const upperSlot = UPPER.indexOf(entry.tooth_number);
			const lowerSlot = LOWER.indexOf(entry.tooth_number);
			const isUpper = upperSlot !== -1;
			const slot = isUpper ? upperSlot : lowerSlot;
			if (slot === -1) continue;
			const isProsthesis = entry.condition === 'prosthesis';
			const isAnchor = isProsthesis && entry.prosthesis_type !== 'replaced';
			if (!map.has(entry.bridge_group_id)) {
				map.set(entry.bridge_group_id, {
					minSlot: slot, maxSlot: slot, isUpper,
					kind: isProsthesis ? 'prosthesis' : 'bridge',
					anchorSlots: isAnchor ? [slot] : [],
				});
			} else {
				const g = map.get(entry.bridge_group_id)!;
				g.minSlot = Math.min(g.minSlot, slot);
				g.maxSlot = Math.max(g.maxSlot, slot);
				if (isProsthesis) g.kind = 'prosthesis';
				if (isAnchor) g.anchorSlots.push(slot);
			}
		}
		return map;
	});

	// ── Bridge drag state ───────────────────────────────────────────────
	let svgEl = $state<SVGSVGElement | null>(null);
	let dragStartTooth = $state<number | null>(null);
	let dragCurrentTooth = $state<number | null>(null);
	let isDragging = $state(false);
	let dragShiftHeld = $state(false);

	const bridgeDragRange = $derived.by<number[]>(() => {
		if (dragStartTooth === null || dragCurrentTooth === null) return [];
		const ui = UPPER.indexOf(dragStartTooth);
		const uj = UPPER.indexOf(dragCurrentTooth);
		if (ui !== -1 && uj !== -1) {
			const [a, b] = [Math.min(ui, uj), Math.max(ui, uj)];
			return UPPER.slice(a, b + 1);
		}
		const li = LOWER.indexOf(dragStartTooth);
		const lj = LOWER.indexOf(dragCurrentTooth);
		if (li !== -1 && lj !== -1) {
			const [a, b] = [Math.min(li, lj), Math.max(li, lj)];
			return LOWER.slice(a, b + 1);
		}
		return [dragStartTooth];
	});

	function svgPoint(e: PointerEvent): { x: number; y: number } | null {
		if (!svgEl) return null;
		const rect = svgEl.getBoundingClientRect();
		if (!rect.width || !rect.height) return null;
		return {
			x: (e.clientX - rect.left) * (VW / rect.width),
			y: (e.clientY - rect.top) * (VH / rect.height),
		};
	}

	function toothAtSVGPoint(x: number, y: number): number | null {
		const slot = Math.floor(x / SW);
		if (slot < 0 || slot >= 16) return null;
		if (y < ARCH_Y) return UPPER[slot];
		return LOWER[slot];
	}

	function handlePointerDown(e: PointerEvent) {
		if (e.button !== 0) return;
		const pt = svgPoint(e);
		if (!pt) return;
		const tooth = toothAtSVGPoint(pt.x, pt.y);
		if (tooth === null) return;
		dragStartTooth = tooth;
		dragCurrentTooth = tooth;
		isDragging = false;
		dragShiftHeld = e.shiftKey;
		svgEl?.setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function handlePointerMove(e: PointerEvent) {
		if (dragStartTooth === null) return;
		const pt = svgPoint(e);
		if (!pt) return;
		const tooth = toothAtSVGPoint(pt.x, pt.y);
		if (tooth === null) return;
		if (tooth !== dragStartTooth) isDragging = true;
		dragCurrentTooth = tooth;
	}

	function handlePointerUp(e: PointerEvent) {
		if (dragStartTooth === null) return;
		const range = bridgeDragRange;
		const wasDragging = isDragging;
		const shiftHeld = dragShiftHeld;
		dragStartTooth = null;
		dragCurrentTooth = null;
		isDragging = false;
		dragShiftHeld = false;

		if (wasDragging && shiftHeld && range.length >= 1) {
			// Shift+drag: add the entire dragged range to the multi-selection
			for (const tooth of range) {
				onToothClick(tooth, true);
			}
		} else if (wasDragging && range.length > 1 && onBridgeRangeSelected && !shiftHeld) {
			onBridgeRangeSelected(range);
		} else if (!wasDragging && range.length === 1) {
			onToothClick(range[0], shiftHeld);
		}
	}
</script>

<div class="overflow-x-auto rounded-md">
	<svg
		bind:this={svgEl}
		viewBox="0 0 {VW} {VH}"
		class="w-full"
		style="min-width:560px; display:block; margin:0 auto; touch-action:none; outline:none;"
		xmlns="http://www.w3.org/2000/svg"
		onpointerdown={handlePointerDown}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
	>
		<defs>
			<!-- Drop shadow for selected tooth -->
			<filter id="tooth-selected" x="-30%" y="-30%" width="160%" height="160%">
				<feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#2563eb" flood-opacity="0.35"/>
			</filter>

			<!-- Per-tag SVG fill patterns (only rendered for non-solid patterns) -->
			{#each dentalTags.list as tag}
				{#if tag.pattern === 'diagonal'}
					<pattern id="dtpat-{tag.key}" patternUnits="userSpaceOnUse" width="6" height="6">
						<rect width="6" height="6" fill={tag.color}/>
						<path d="M -1 1 l 2 -2 M 0 6 l 6 -6 M 5 7 l 2 -2" stroke={tag.strokeColor} stroke-width="1.2" stroke-linecap="round"/>
					</pattern>
				{:else if tag.pattern === 'crosshatch'}
					<pattern id="dtpat-{tag.key}" patternUnits="userSpaceOnUse" width="8" height="8">
						<rect width="8" height="8" fill={tag.color}/>
						<line x1="4" y1="0" x2="4" y2="8" stroke={tag.strokeColor} stroke-width="0.9"/>
						<line x1="0" y1="4" x2="8" y2="4" stroke={tag.strokeColor} stroke-width="0.9"/>
					</pattern>
				{:else if tag.pattern === 'horizontal'}
					<pattern id="dtpat-{tag.key}" patternUnits="userSpaceOnUse" width="8" height="6">
						<rect width="8" height="6" fill={tag.color}/>
						<line x1="0" y1="3" x2="8" y2="3" stroke={tag.strokeColor} stroke-width="1.2"/>
					</pattern>
				{:else if tag.pattern === 'vertical'}
					<pattern id="dtpat-{tag.key}" patternUnits="userSpaceOnUse" width="6" height="8">
						<rect width="6" height="8" fill={tag.color}/>
						<line x1="3" y1="0" x2="3" y2="8" stroke={tag.strokeColor} stroke-width="1.2"/>
					</pattern>
				{:else if tag.pattern === 'dots'}
					<pattern id="dtpat-{tag.key}" patternUnits="userSpaceOnUse" width="8" height="8">
						<rect width="8" height="8" fill={tag.color}/>
						<circle cx="4" cy="4" r="1.7" fill={tag.strokeColor}/>
					</pattern>
				{/if}
			{/each}
		</defs>

		<!-- Arch gap separator -->
		<line x1="0" y1={ARCH_Y} x2={VW} y2={ARCH_Y} stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,6"/>
		<!-- Midline separator -->
		<line x1="368" y1="20" x2="368" y2={LOWER_TOP + 44} stroke="#e2e8f0" stroke-width="1" stroke-dasharray="2,5"/>

		<!-- Quadrant labels -->
		<text x="180" y="10" font-size="9" fill="#94a3b8" text-anchor="middle" font-family="sans-serif" font-weight="600">Q1</text>
		<text x="556" y="10" font-size="9" fill="#94a3b8" text-anchor="middle" font-family="sans-serif" font-weight="600">Q2</text>
		<text x="180" y={VH - 5} font-size="9" fill="#94a3b8" text-anchor="middle" font-family="sans-serif" font-weight="600">Q4</text>
		<text x="556" y={VH - 5} font-size="9" fill="#94a3b8" text-anchor="middle" font-family="sans-serif" font-weight="600">Q3</text>

		<!-- ── Bridge bars / Prosthesis lines (rendered before teeth so teeth sit on top) ── -->
		{#each bridgeGroups as [, group]}
			{#if group.kind === 'bridge'}
				{@const t0 = SLOT_TYPE[group.minSlot]}
				{@const t1 = SLOT_TYPE[group.maxSlot]}
				{@const x1 = cx(group.minSlot) - CROWN_W[t0] / 2}
				{@const x2 = cx(group.maxSlot) + CROWN_W[t1] / 2}
				{@const bridgeTag = dentalTags.list.find(t => t.key === 'bridge')}
				{@const barFill = bridgeTag?.color ?? '#fed7aa'}
				{@const barStroke = bridgeTag?.strokeColor ?? '#f97316'}
				{#if group.isUpper}
					<rect x={x1} y={UPPER_BASE - 1} width={x2 - x1} height={7}
						fill={barFill} stroke={barStroke} stroke-width="1" rx="2"
						pointer-events="none"/>
				{:else}
					<rect x={x1} y={LOWER_TOP - 6} width={x2 - x1} height={7}
						fill={barFill} stroke={barStroke} stroke-width="1" rx="2"
						pointer-events="none"/>
				{/if}
			{:else}
				<!-- Prosthesis: dashed connecting line between anchor teeth -->
				{@const anchorSlotsSorted = [...group.anchorSlots].sort((a, b) => a - b)}
				{#if anchorSlotsSorted.length >= 2}
					{@const aMin = anchorSlotsSorted[0]}
					{@const aMax = anchorSlotsSorted[anchorSlotsSorted.length - 1]}
					{@const lx1 = cx(aMin)}
					{@const lx2 = cx(aMax)}
					{#if group.isUpper}
						<line x1={lx1} y1={UPPER_BASE + 3} x2={lx2} y2={UPPER_BASE + 3}
							stroke="#3b82f6" stroke-width="2" stroke-dasharray="6 4"
							pointer-events="none"/>
					{:else}
						<line x1={lx1} y1={LOWER_TOP - 3} x2={lx2} y2={LOWER_TOP - 3}
							stroke="#3b82f6" stroke-width="2" stroke-dasharray="6 4"
							pointer-events="none"/>
					{/if}
				{:else if anchorSlotsSorted.length === 1}
					<!-- single anchor: just a dot -->
					<circle cx={cx(anchorSlotsSorted[0])} cy={group.isUpper ? UPPER_BASE + 3 : LOWER_TOP - 3}
						r="3" fill="#3b82f6" opacity="0.6" pointer-events="none"/>
				{/if}
			{/if}
		{/each}

		<!-- ── Bridge drag preview ── -->
		{#if isDragging && bridgeDragRange.length > 1}
			{@const dragUpper = UPPER.indexOf(bridgeDragRange[0]) !== -1}
			{@const slots = bridgeDragRange.map(t => dragUpper ? UPPER.indexOf(t) : LOWER.indexOf(t))}
			{@const minS = Math.min(...slots)}
			{@const maxS = Math.max(...slots)}
			{@const t0 = SLOT_TYPE[minS]}
			{@const t1 = SLOT_TYPE[maxS]}
			{@const px1 = cx(minS) - CROWN_W[t0] / 2 - 2}
			{@const px2 = cx(maxS) + CROWN_W[t1] / 2 + 2}
			{#if dragUpper}
				<rect x={px1} y={UPPER_BASE - CROWN_H['M'] - 4} width={px2 - px1} height={CROWN_H['M'] + 8}
					fill="#2563eb" fill-opacity="0.08" stroke="#2563eb" stroke-width="1.5" rx="4"
					stroke-dasharray="4,2" pointer-events="none"/>
			{:else}
				<rect x={px1} y={LOWER_TOP - 4} width={px2 - px1} height={CROWN_H['M'] + 8}
					fill="#2563eb" fill-opacity="0.08" stroke="#2563eb" stroke-width="1.5" rx="4"
					stroke-dasharray="4,2" pointer-events="none"/>
			{/if}
		{/if}

		<!-- ── Upper teeth ── -->
		{#each UPPER as tooth, slot}
			{@const cond      = getCondition(tooth)}
			{@const entry     = getEntry(tooth)}
			{@const surfs     = parseSurfaces(entry?.surfaces ?? '{}')}
			{@const g         = upperGeom(slot)}
			{@const sel       = selectedTooth === tooth}
			{@const charting  = chartingTooth === tooth}
			{@const shiftSel  = shiftSelectedTeeth.includes(tooth)}
			{@const dashed    = isDashed(cond)}
			{@const isPontic          = entry?.bridge_role === 'pontic'}
			{@const isProsthesisReplaced = entry?.condition === 'prosthesis' && entry?.prosthesis_type === 'replaced'}
			{@const isImplantAbutment = entry?.bridge_role === 'abutment' && entry?.abutment_type === 'implant'}
			{@const showRoot          = !NO_ROOT.has(cond) && !isPontic && !isProsthesisReplaced}
			{@const sc        = sel ? '#2563eb' : dentalTags.getStroke(cond)}
			{@const divOp     = sel ? '0.9' : '0.55'}
			{@const leftSurf  = slot < 8 ? 'D' : 'M'}
			{@const rightSurf = slot < 8 ? 'M' : 'D'}

			<text x={cx(slot)} y="20" font-size="8"
				fill={sel ? '#2563eb' : '#94a3b8'}
				text-anchor="middle" font-family="sans-serif"
				font-weight={sel ? '700' : '400'}
				class="pointer-events-none select-none"
			>{toFDI(tooth)}</text>

			<!-- ── Upper roots / implant fixture ── -->
			{#if showRoot}
				{#if isImplantAbutment}
					{@const fw = Math.max(8, CROWN_W[SLOT_TYPE[slot]] * 0.38)}
					{@const fx = cx(slot) - fw / 2}
					{@const fy = g.oy - ROOT_H}
					<rect x={fx} y={fy} width={fw} height={ROOT_H}
						fill="#e5e7eb" stroke="#9ca3af" stroke-width="0.9" rx="2" class="cursor-pointer"/>
					{#each [0.28, 0.52, 0.76] as ratio}
						<line x1={fx + 2} y1={fy + ROOT_H * ratio}
							x2={fx + fw - 2} y2={fy + ROOT_H * ratio}
							stroke="#9ca3af" stroke-width="0.8" pointer-events="none"/>
					{/each}
				{:else}
					{#each makeRoots(cx(slot), CROWN_W[SLOT_TYPE[slot]], ROOT_COUNTS[tooth] ?? 1, g.oy, true) as root}
						<polygon
							points={root.points}
							fill={cond === 'root_canal' ? '#f5f3ff' : '#f1f5f9'}
							stroke={sc}
							stroke-width="0.9"
							class="cursor-pointer"
						/>
						{#if cond === 'root_canal'}
							<line
								x1={root.centerX} y1={g.oy - 2}
								x2={root.centerX} y2={root.apexY + 3}
								stroke="#7c3aed" stroke-width="1.5" opacity="0.75"
								pointer-events="none"
							/>
							<circle cx={root.centerX} cy={root.apexY + 3} r="1.5"
								fill="#7c3aed" opacity="0.75" pointer-events="none"/>
						{/if}
					{/each}
				{/if}
			{/if}

			<g
				class="cursor-pointer"
				filter={sel ? 'url(#tooth-selected)' : undefined}
				aria-label="Tooth {toFDI(tooth)}"
			>
				<!-- 5 surface polygons -->
				<polygon points={g.pTop}    fill={dentalTags.getFill(surfKey(surfs, 'B', cond))} stroke="none"/>
				<polygon points={g.pBot}    fill={dentalTags.getFill(surfKey(surfs, 'L', cond))} stroke="none"/>
				<polygon points={g.pLeft}   fill={dentalTags.getFill(surfKey(surfs, leftSurf, cond))} stroke="none"/>
				<polygon points={g.pRight}  fill={dentalTags.getFill(surfKey(surfs, rightSurf, cond))} stroke="none"/>
				<polygon points={g.pCenter} fill={dentalTags.getFill(surfKey(surfs, 'O', cond))} stroke="none"/>

				<!-- Structural lines -->
				<rect x={g.ix} y={g.iy} width={g.iw} height={g.ih} fill="none" stroke={sc} stroke-width="0.7" opacity={divOp}/>
				<line x1={g.ox}         y1={g.oy}         x2={g.ix}         y2={g.iy}         stroke={sc} stroke-width="0.7" opacity={divOp}/>
				<line x1={g.ox + g.ow}  y1={g.oy}         x2={g.ix + g.iw}  y2={g.iy}         stroke={sc} stroke-width="0.7" opacity={divOp}/>
				<line x1={g.ox + g.ow}  y1={g.oy + g.oh}  x2={g.ix + g.iw}  y2={g.iy + g.ih}  stroke={sc} stroke-width="0.7" opacity={divOp}/>
				<line x1={g.ox}         y1={g.oy + g.oh}  x2={g.ix}         y2={g.iy + g.ih}  stroke={sc} stroke-width="0.7" opacity={divOp}/>
				<rect x={g.ox} y={g.oy} width={g.ow} height={g.oh}
					fill="none" stroke={isProsthesisReplaced ? '#3b82f6' : isPontic ? (dentalTags.list.find(t => t.key === 'bridge')?.strokeColor ?? sc) : sc}
					stroke-width={sel ? 2 : 1.5}
					stroke-dasharray={dashed || isPontic || isProsthesisReplaced ? '4,3' : undefined}/>

				<!-- Selected surface highlight -->
				{#if sel && selectedSurface}
					<polygon
						points={
							selectedSurface === 'B' ? g.pTop :
							selectedSurface === 'L' ? g.pBot :
							selectedSurface === leftSurf ? g.pLeft :
							selectedSurface === rightSurf ? g.pRight :
							g.pCenter
						}
						fill="#2563eb" fill-opacity="0.18" stroke="#2563eb" stroke-width="1.5"
						pointer-events="none"
					/>
				{/if}

				<!-- Extracted X -->
				{#if cond === 'extracted'}
					<line x1={g.ox+3} y1={g.oy+3} x2={g.ox+g.ow-3} y2={g.oy+g.oh-3} stroke="#94a3b8" stroke-width="1.5"/>
					<line x1={g.ox+g.ow-3} y1={g.oy+3} x2={g.ox+3} y2={g.oy+g.oh-3} stroke="#94a3b8" stroke-width="1.5"/>
				{/if}
				<!-- Implant post line -->
				{#if cond === 'implant'}
					<line x1={g.ix + g.iw/2} y1={g.iy + 2} x2={g.ix + g.iw/2} y2={g.iy + g.ih - 2} stroke="#6366f1" stroke-width="1.5" opacity="0.6"/>
				{/if}
				<!-- Charting mode highlight ring -->
				{#if charting}
					<rect x={g.ox - 4} y={g.oy - 4} width={g.ow + 8} height={g.oh + 8}
						fill="#f59e0b" fill-opacity="0.12" stroke="#f59e0b" stroke-width="1.5" rx="3"
						pointer-events="none"/>
					<rect x={g.ox - 2} y={g.oy - 2} width={g.ow + 4} height={g.oh + 4}
						fill="none" stroke="#f59e0b" stroke-width="2.5" rx="2"
						pointer-events="none"/>
				{/if}
				<!-- Shift-select ring -->
				{#if shiftSel}
					<rect x={g.ox - 3} y={g.oy - 3} width={g.ow + 6} height={g.oh + 6}
						fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4 3" rx="3"
						pointer-events="none"/>
				{/if}
				<!-- Prosthesis type badge -->
				{#if entry?.condition === 'prosthesis' && entry?.prosthesis_type}
					{@const pBadge = entry.prosthesis_type === 'telescope' ? 'T' : entry.prosthesis_type === 'clasp' ? 'K' : entry.prosthesis_type === 'attachment' ? 'A' : 'E'}
					<circle cx={g.ox + g.ow - 3.5} cy={g.oy + 3.5} r="3.5" fill="white" stroke="#3b82f6" stroke-width="0.9" pointer-events="none"/>
					<text x={g.ox + g.ow - 3.5} y={g.oy + 5.5} font-size="4.5" font-weight="bold" text-anchor="middle" fill="#3b82f6" font-family="sans-serif" pointer-events="none">{pBadge}</text>
				{/if}
			</g>
		{/each}

		<!-- ── Lower teeth ── -->
		{#each LOWER as tooth, slot}
			{@const cond      = getCondition(tooth)}
			{@const entry     = getEntry(tooth)}
			{@const surfs     = parseSurfaces(entry?.surfaces ?? '{}')}
			{@const g         = lowerGeom(slot)}
			{@const sel       = selectedTooth === tooth}
			{@const charting  = chartingTooth === tooth}
			{@const shiftSel  = shiftSelectedTeeth.includes(tooth)}
			{@const dashed    = isDashed(cond)}
				{@const isPontic          = entry?.bridge_role === 'pontic'}
			{@const isProsthesisReplaced = entry?.condition === 'prosthesis' && entry?.prosthesis_type === 'replaced'}
			{@const isImplantAbutment = entry?.bridge_role === 'abutment' && entry?.abutment_type === 'implant'}
			{@const showRoot          = !NO_ROOT.has(cond) && !isPontic && !isProsthesisReplaced}
			{@const sc        = sel ? '#2563eb' : dentalTags.getStroke(cond)}
			{@const divOp     = sel ? '0.9' : '0.55'}
			{@const leftSurf  = slot < 8 ? 'D' : 'M'}
			{@const rightSurf = slot < 8 ? 'M' : 'D'}
			{@const t         = SLOT_TYPE[slot]}

			<!-- Lower roots / implant fixture: grow DOWNWARD from crown base -->
			{#if showRoot}
				{#if isImplantAbutment}
					{@const fw = Math.max(8, CROWN_W[t] * 0.38)}
					{@const fx = cx(slot) - fw / 2}
					{@const fy = LOWER_TOP + CROWN_H[t]}
					<rect x={fx} y={fy} width={fw} height={ROOT_H}
						fill="#e5e7eb" stroke="#9ca3af" stroke-width="0.9" rx="2" class="cursor-pointer"/>
					{#each [0.28, 0.52, 0.76] as ratio}
						<line x1={fx + 2} y1={fy + ROOT_H * ratio}
							x2={fx + fw - 2} y2={fy + ROOT_H * ratio}
							stroke="#9ca3af" stroke-width="0.8" pointer-events="none"/>
					{/each}
				{:else}
					{#each makeRoots(cx(slot), CROWN_W[t], ROOT_COUNTS[tooth] ?? 1, LOWER_TOP + CROWN_H[t], false) as root}
						<polygon
							points={root.points}
							fill={cond === 'root_canal' ? '#f5f3ff' : '#f1f5f9'}
							stroke={sc}
							stroke-width="0.9"
							class="cursor-pointer"
						/>
						{#if cond === 'root_canal'}
							<line
								x1={root.centerX} y1={LOWER_TOP + CROWN_H[t] + 2}
								x2={root.centerX} y2={root.apexY - 3}
								stroke="#7c3aed" stroke-width="1.5" opacity="0.75"
								pointer-events="none"
							/>
							<circle cx={root.centerX} cy={root.apexY - 3} r="1.5"
								fill="#7c3aed" opacity="0.75" pointer-events="none"/>
						{/if}
					{/each}
				{/if}
			{/if}

			<g
				class="cursor-pointer"
				filter={sel ? 'url(#tooth-selected)' : undefined}
				aria-label="Tooth {toFDI(tooth)}"
			>
				<polygon points={g.pTop}    fill={dentalTags.getFill(surfKey(surfs, 'L', cond))} stroke="none"/>
				<polygon points={g.pBot}    fill={dentalTags.getFill(surfKey(surfs, 'B', cond))} stroke="none"/>
				<polygon points={g.pLeft}   fill={dentalTags.getFill(surfKey(surfs, leftSurf, cond))} stroke="none"/>
				<polygon points={g.pRight}  fill={dentalTags.getFill(surfKey(surfs, rightSurf, cond))} stroke="none"/>
				<polygon points={g.pCenter} fill={dentalTags.getFill(surfKey(surfs, 'O', cond))} stroke="none"/>

				<rect x={g.ix} y={g.iy} width={g.iw} height={g.ih} fill="none" stroke={sc} stroke-width="0.7" opacity={divOp}/>
				<line x1={g.ox}         y1={g.oy}         x2={g.ix}         y2={g.iy}         stroke={sc} stroke-width="0.7" opacity={divOp}/>
				<line x1={g.ox + g.ow}  y1={g.oy}         x2={g.ix + g.iw}  y2={g.iy}         stroke={sc} stroke-width="0.7" opacity={divOp}/>
				<line x1={g.ox + g.ow}  y1={g.oy + g.oh}  x2={g.ix + g.iw}  y2={g.iy + g.ih}  stroke={sc} stroke-width="0.7" opacity={divOp}/>
				<line x1={g.ox}         y1={g.oy + g.oh}  x2={g.ix}         y2={g.iy + g.ih}  stroke={sc} stroke-width="0.7" opacity={divOp}/>
				<rect x={g.ox} y={g.oy} width={g.ow} height={g.oh}
					fill="none" stroke={isProsthesisReplaced ? '#3b82f6' : isPontic ? (dentalTags.list.find(t => t.key === 'bridge')?.strokeColor ?? sc) : sc}
					stroke-width={sel ? 2 : 1.5}
					stroke-dasharray={dashed || isPontic || isProsthesisReplaced ? '4,3' : undefined}/>

				{#if sel && selectedSurface}
					<polygon
						points={
							selectedSurface === 'L' ? g.pTop :
							selectedSurface === 'B' ? g.pBot :
							selectedSurface === leftSurf ? g.pLeft :
							selectedSurface === rightSurf ? g.pRight :
							g.pCenter
						}
						fill="#2563eb" fill-opacity="0.18" stroke="#2563eb" stroke-width="1.5"
						pointer-events="none"
					/>
				{/if}

				{#if cond === 'extracted'}
					<line x1={g.ox+3} y1={g.oy+3} x2={g.ox+g.ow-3} y2={g.oy+g.oh-3} stroke="#94a3b8" stroke-width="1.5"/>
					<line x1={g.ox+g.ow-3} y1={g.oy+3} x2={g.ox+3} y2={g.oy+g.oh-3} stroke="#94a3b8" stroke-width="1.5"/>
				{/if}
				{#if cond === 'implant'}
					<line x1={g.ix + g.iw/2} y1={g.iy + 2} x2={g.ix + g.iw/2} y2={g.iy + g.ih - 2} stroke="#6366f1" stroke-width="1.5" opacity="0.6"/>
				{/if}
				<!-- Charting mode highlight ring -->
				{#if charting}
					<rect x={g.ox - 4} y={g.oy - 4} width={g.ow + 8} height={g.oh + 8}
						fill="#f59e0b" fill-opacity="0.12" stroke="#f59e0b" stroke-width="1.5" rx="3"
						pointer-events="none"/>
					<rect x={g.ox - 2} y={g.oy - 2} width={g.ow + 4} height={g.oh + 4}
						fill="none" stroke="#f59e0b" stroke-width="2.5" rx="2"
						pointer-events="none"/>
				{/if}
				<!-- Shift-select ring -->
				{#if shiftSel}
					<rect x={g.ox - 3} y={g.oy - 3} width={g.ow + 6} height={g.oh + 6}
						fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4 3" rx="3"
						pointer-events="none"/>
				{/if}
				<!-- Prosthesis type badge -->
				{#if entry?.condition === 'prosthesis' && entry?.prosthesis_type}
					{@const pBadge = entry.prosthesis_type === 'telescope' ? 'T' : entry.prosthesis_type === 'clasp' ? 'K' : entry.prosthesis_type === 'attachment' ? 'A' : 'E'}
					<circle cx={g.ox + g.ow - 3.5} cy={g.oy + 3.5} r="3.5" fill="white" stroke="#3b82f6" stroke-width="0.9" pointer-events="none"/>
					<text x={g.ox + g.ow - 3.5} y={g.oy + 5.5} font-size="4.5" font-weight="bold" text-anchor="middle" fill="#3b82f6" font-family="sans-serif" pointer-events="none">{pBadge}</text>
				{/if}
			</g>

			<text x={cx(slot)} y={LOWER_TOP + CROWN_H[t] + ROOT_H + 12} font-size="8"
				fill={sel ? '#2563eb' : '#94a3b8'}
				text-anchor="middle" font-family="sans-serif"
				font-weight={sel ? '700' : '400'}
				class="pointer-events-none select-none"
			>{toFDI(tooth)}</text>
		{/each}
	</svg>
</div>

<!-- ── Condition legend — driven by dentalTags store ── -->
<div class="mt-3 flex flex-wrap gap-2 px-1">
	{#each dentalTags.list as tag}
		<span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
			<svg width="13" height="13" viewBox="0 0 13 13" xmlns="http://www.w3.org/2000/svg" class="shrink-0">
				<polygon points="0,0 13,0 10,3 3,3"     fill={tag.color}/>
				<polygon points="0,13 3,10 10,10 13,13" fill={tag.color}/>
				<polygon points="0,0 3,3 3,10 0,13"     fill={tag.color}/>
				<polygon points="13,0 13,13 10,10 10,3" fill={tag.color}/>
				<polygon points="3,3 10,3 10,10 3,10"   fill={tag.color}/>
				<rect x="0" y="0" width="13" height="13" fill="none" stroke={tag.strokeColor} stroke-width="1"/>
				<rect x="3" y="3" width="7"  height="7"  fill="none" stroke={tag.strokeColor} stroke-width="0.6" opacity="0.6"/>
				<line x1="0" y1="0"  x2="3"  y2="3"  stroke={tag.strokeColor} stroke-width="0.6" opacity="0.6"/>
				<line x1="13" y1="0" x2="10" y2="3"  stroke={tag.strokeColor} stroke-width="0.6" opacity="0.6"/>
				<line x1="13" y1="13" x2="10" y2="10" stroke={tag.strokeColor} stroke-width="0.6" opacity="0.6"/>
				<line x1="0" y1="13" x2="3"  y2="10" stroke={tag.strokeColor} stroke-width="0.6" opacity="0.6"/>
			</svg>
			{dentalTags.getLabel(tag.key)}
		</span>
	{/each}
</div>
