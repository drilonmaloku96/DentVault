<script lang="ts">
	import { untrack } from 'svelte';
	import type { ToothChartEntry, DentalChartHistoryEntry } from '$lib/types';
	import { dentalTags } from '$lib/stores/dentalTags.svelte';
	import { prosthesisTypes } from '$lib/stores/prosthesisTypes.svelte';
	import { i18n } from '$lib/i18n';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { toFDI, FDI_TOOTH_NAMES } from '$lib/utils';
	import { getToothHistory } from '$lib/services/db';

	let {
		toothNumber,
		patientId = '',
		entry = null,
		selectedSurface = null,
		shortcutTagKey = null,
		onSave,
		onClose,
		onDissolveBridge = undefined,
	}: {
		toothNumber: number;
		patientId?: string;
		entry?: ToothChartEntry | null;
		selectedSurface?: string | null;
		shortcutTagKey?: { key: string; seq: number } | null;
		onSave: (toothNumber: number, data: { condition: string; notes: string; last_examined: string; surfaces: string }) => Promise<void>;
		onClose: () => void;
		onDissolveBridge?: (bridgeGroupId: string) => void;
	} = $props();

	const SURFACE_NAMES: Record<string, string> = {
		O: 'Occlusal', B: 'Buccal', L: 'Lingual', M: 'Mesial', D: 'Distal',
	};

	// Grid layout — null = empty spacer cell
	const SURFACE_GRID: (string | null)[][] = [
		[null, 'B',  null],
		['M',  'O',  'D' ],
		[null, 'L',  null],
	];

	// ── Form state ─────────────────────────────────────────────────────
	let selectedCondition = $state<string>(untrack(() => entry?.condition ?? 'healthy'));
	let notes             = $state(untrack(() => entry?.notes ?? ''));
	let lastExamined      = $state(untrack(() => entry?.last_examined ?? ''));
	let isSaving          = $state(false);
	let savedPulse        = $state(false);

	type SurfMap = Record<string, string>;
	function parseSurfMap(json: string | undefined): SurfMap {
		if (!json) return {};
		try { return JSON.parse(json) as SurfMap; } catch { return {}; }
	}
	let surfaceMap = $state<SurfMap>(untrack(() => parseSurfMap(entry?.surfaces)));

	// ── Multi-select state ─────────────────────────────────────────────
	let activeSurfaces = $state(new Set<string>());
	let isDragging     = $state(false);
	let dragMode       = $state<'add' | 'remove'>('add');

	// _ready prevents auto-save on initial mount / tooth switch
	let _ready = false;
	let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let _pendingSave = false;

	// Sync single surface from parent prop → single selection
	// Do NOT clear activeSurfaces here — drag ends should keep surfaces selected.
	// Clearing on tooth switch is handled in the toothNumber effect below.
	$effect(() => {
		const s = selectedSurface;
		if (s) activeSurfaces = new Set([s]);
	});

	// Reset fields when switching teeth
	$effect(() => {
		const _ = toothNumber;
		_ready = false;
		if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
		untrack(() => {
			selectedCondition = entry?.condition ?? 'healthy';
			notes             = entry?.notes ?? '';
			lastExamined      = entry?.last_examined ?? '';
			surfaceMap        = parseSurfMap(entry?.surfaces);
			activeSurfaces    = new Set();
		});
		setTimeout(() => { _ready = true; }, 0);
	});

	// Debounced auto-save for text fields
	$effect(() => {
		const _n  = notes;
		const _le = lastExamined;
		if (!_ready) return;
		if (_debounceTimer) clearTimeout(_debounceTimer);
		_debounceTimer = setTimeout(() => { doSave(); }, 600);
	});

	// Keyboard shortcuts — driven by shortcutTagKey prop set in DentalChartView's keydown handler
	$effect(() => {
		const trigger = shortcutTagKey;
		if (!trigger) return;
		untrack(() => {
			if (activeSurfaces.size > 0) {
				for (const s of activeSurfaces) surfaceMap[s] = trigger.key;
				activeSurfaces = new Set();
				doSave();
			} else {
				setCondition(trigger.key);
			}
		});
	});

	// Global pointerup ensures drag always ends even outside grid
	$effect(() => {
		function onUp() { isDragging = false; }
		document.addEventListener('pointerup', onUp);
		return () => document.removeEventListener('pointerup', onUp);
	});

	// ── Save ───────────────────────────────────────────────────────────
	async function doSave() {
		if (isSaving) { _pendingSave = true; return; }
		_pendingSave = false;
		isSaving = true;
		try {
			await onSave(toothNumber, {
				condition:     selectedCondition,
				notes:         notes.trim(),
				last_examined: lastExamined,
				surfaces:      JSON.stringify(surfaceMap),
			});
			savedPulse = true;
			setTimeout(() => (savedPulse = false), 1800);
		} finally {
			isSaving = false;
			if (_pendingSave) doSave();
		}
	}

	// ── Drag helpers ───────────────────────────────────────────────────
	function applySurfaceDragMode(surf: string) {
		if (dragMode === 'add' && !activeSurfaces.has(surf)) {
			activeSurfaces = new Set([...activeSurfaces, surf]);
		} else if (dragMode === 'remove' && activeSurfaces.has(surf)) {
			const s = new Set(activeSurfaces); s.delete(surf); activeSurfaces = s;
		}
	}

	function onGridPointerDown(e: PointerEvent) {
		const surf = (e.target as HTMLElement).closest<HTMLElement>('[data-surface]')?.dataset.surface;
		if (!surf) return;
		dragMode   = activeSurfaces.has(surf) ? 'remove' : 'add';
		isDragging = true;
		applySurfaceDragMode(surf);
		e.preventDefault();
	}

	// ── Tag / condition actions ────────────────────────────────────────
	function applyTagToSurfaces(tagKey: string) {
		for (const s of activeSurfaces) surfaceMap[s] = tagKey;
		activeSurfaces = new Set();
		doSave();
	}

	function clearActiveSurfaces() {
		for (const s of activeSurfaces) delete surfaceMap[s];
		doSave();
	}

	function setCondition(key: string) {
		selectedCondition = key;
		doSave();
	}

	// ── Display helpers ────────────────────────────────────────────────
	const TOOTH_NAMES = FDI_TOOTH_NAMES;

	function surfFill(key: string): string {
		const k = surfaceMap[key];
		if (!k) return '#f1f5f9';
		return dentalTags.getByKey(k)?.color ?? '#f1f5f9';
	}
	function surfStroke(key: string): string {
		const k = surfaceMap[key];
		if (!k) return '#cbd5e1';
		return dentalTags.getByKey(k)?.strokeColor ?? '#cbd5e1';
	}

	const activeSurfaceLabel = $derived(
		activeSurfaces.size === 0 ? '' :
		activeSurfaces.size === 1
			? `${SURFACE_NAMES[[...activeSurfaces][0]] ?? [...activeSurfaces][0]} surface`
			: [...activeSurfaces].map(s => SURFACE_NAMES[s] ?? s).join(' + '),
	);

	function allSurfacesMatch(tagKey: string): boolean {
		if (activeSurfaces.size === 0) return false;
		return [...activeSurfaces].every(s => surfaceMap[s] === tagKey);
	}

	const activeSurfacesHaveTag = $derived(
		[...activeSurfaces].some(s => !!surfaceMap[s])
	);

	const sc = 'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

	// ── Tooth history ────────────────────────────────────────────────────
	let toothHistory = $state<DentalChartHistoryEntry[]>([]);

	$effect(() => {
		const pid = patientId;
		const tn  = toothNumber;
		if (pid && tn) {
			getToothHistory(pid, tn).then(h => { toothHistory = h; });
		} else {
			toothHistory = [];
		}
	});
</script>

<div class="flex flex-col gap-4">
	<!-- Header -->
	<div class="flex items-start justify-between gap-2">
		<div class="flex items-center gap-2">
			<span class="text-2xl font-bold tabular-nums">{toFDI(toothNumber)}</span>
			<span class="text-sm font-medium text-muted-foreground leading-tight">
				{TOOTH_NAMES[toFDI(toothNumber)] ?? ''}
			</span>
		</div>
		<div class="flex items-center gap-2">
			<span class={[
				'text-xs font-medium transition-all duration-300',
				isSaving   ? 'text-muted-foreground opacity-100' :
				savedPulse ? 'text-emerald-600 opacity-100'      : 'opacity-0',
			].join(' ')}>
				{isSaving ? 'Saving…' : '✓ Saved'}
			</span>
		</div>
	</div>

	<Separator />

	<!-- ── Surface map ── -->
	<div class="flex flex-col gap-2">
		<Label class="text-xs">
			Surfaces
			<span class="text-muted-foreground font-normal">
				(drag to select · key to tag)
			</span>
		</Label>
		<div class="flex items-start gap-4">

			<!--
				3×3 surface grid.
				ALL pointer logic lives here — setPointerCapture ensures
				pointermove keeps firing on this div; elementFromPoint finds
				which surface button the cursor is actually over.
			-->
			<div
				class="grid grid-cols-3 gap-1 select-none"
				style="width:160px; touch-action:none; cursor:crosshair;"
				role="group"
				aria-label="Tooth surfaces"
				onpointerdown={onGridPointerDown}
				onpointerup={() => { isDragging = false; }}
			>
				{#each SURFACE_GRID as row}
					{#each row as surf}
						{#if surf}
							{@const isActive = activeSurfaces.has(surf)}
							<div
								data-surface={surf}
								class={[
									'flex items-center justify-center rounded border font-bold text-[11px] transition-colors h-[48px]',
									isActive ? 'ring-2 ring-blue-500 ring-offset-1 border-blue-500 text-blue-700' : '',
								].join(' ')}
								style="
									background:{surfFill(surf)};
									border-color:{isActive ? '#2563eb' : surfStroke(surf)};
									color:{isActive ? '#1d4ed8' : surfStroke(surf)};
								"
								title={SURFACE_NAMES[surf]}
								onpointerenter={() => { if (isDragging) applySurfaceDragMode(surf); }}
							>
								{surf}
							</div>
						{:else}
							<div></div>
						{/if}
					{/each}
				{/each}
			</div>

			<!-- Tag picker (visible when ≥1 surface selected) -->
			{#if activeSurfaces.size > 0}
				<div class="flex flex-col gap-2 flex-1">
					<span class="text-xs font-medium text-foreground">
						{activeSurfaceLabel} tag
					</span>
					<div class="flex flex-wrap gap-1.5">
						{#each dentalTags.list.filter(t => !new Set(['impacted','implant','bridge','prosthesis','missing','extracted']).has(t.key)) as tag}
							{@const matched = allSurfacesMatch(tag.key)}
							<button
								type="button"
								onclick={() => applyTagToSurfaces(tag.key)}
								class={[
									'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all',
									matched ? 'ring-2 ring-offset-1 ring-foreground/20 shadow-sm' : 'opacity-60 hover:opacity-100',
								].join(' ')}
								style="background:{tag.color};border-color:{matched ? '#1e293b' : tag.strokeColor};color:{tag.strokeColor}"
							>
								{#if matched}
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5">
										<polyline points="20 6 9 17 4 12"/>
									</svg>
								{/if}
								{dentalTags.getLabel(tag.key)}
								{#if tag.shortcut}
									<kbd class="ml-0.5 rounded bg-black/10 px-1 font-mono text-[9px] leading-tight">{tag.shortcut}</kbd>
								{/if}
							</button>
						{/each}
						{#if activeSurfacesHaveTag}
							<button
								type="button"
								onclick={clearActiveSurfaces}
								class="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
							>Clear</button>
						{/if}
					</div>
				</div>
			{:else}
				<p class="text-xs text-muted-foreground self-center">
					Click or drag surfaces to select them.
				</p>
			{/if}
		</div>
	</div>

	<Separator />

	<!-- Overall condition selector -->
	<div class="flex flex-col gap-2">
		<Label class="text-xs">Overall Condition</Label>
		<div class="flex flex-wrap gap-2">
			{#each dentalTags.list as tag}
				{@const isSelected = selectedCondition === tag.key}
				<button
					type="button"
					onclick={() => setCondition(tag.key)}
					class={[
						'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
						isSelected ? 'ring-2 ring-offset-1 ring-foreground/20 shadow-sm' : 'opacity-70 hover:opacity-100',
					].join(' ')}
					style="background:{tag.color};border-color:{isSelected ? '#1e293b' : tag.strokeColor};color:{tag.strokeColor}"
				>
					{#if isSelected}
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
							<polyline points="20 6 9 17 4 12"/>
						</svg>
					{/if}
					{tag.label}
					{#if tag.shortcut}
						<kbd class="ml-0.5 rounded bg-black/10 px-1 font-mono text-[9px] leading-tight">{tag.shortcut}</kbd>
					{/if}
				</button>
			{/each}
		</div>
	</div>

	<!-- Notes + date column -->
	<div class="flex flex-col gap-3">
		<div class="flex flex-col gap-1.5">
			<Label class="text-xs" for="tooth-notes">Notes</Label>
			<input id="tooth-notes" type="text" class={sc} placeholder="e.g. MOD amalgam, 2018…" bind:value={notes}/>
		</div>
		<div class="flex flex-col gap-1.5">
			<Label class="text-xs" for="tooth-exam">Last Examined</Label>
			<input id="tooth-exam" type="date" class={sc} bind:value={lastExamined}/>
		</div>
	</div>

	<!-- Prosthesis info (shown when prosthesis_type is set, regardless of condition) -->
	{#if entry?.prosthesis_type}
		{@const ptCfg = prosthesisTypes.getConfig(entry.prosthesis_type)}
		{@const ptLabel = i18n.t.chart.prosthesisTypes[entry.prosthesis_type as keyof typeof i18n.t.chart.prosthesisTypes] ?? entry.prosthesis_type}
		<div class="text-xs text-muted-foreground flex flex-col gap-1 rounded-md border px-3 py-2"
			style="background-color:{ptCfg.fillColor}20; border-color:{ptCfg.color}40">
			<div class="flex items-center gap-1.5">
				<span class="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold shrink-0"
					style="background:white; color:{ptCfg.color}; outline:1.5px solid {ptCfg.color}">{ptCfg.badge}</span>
				<span class="font-medium text-foreground">{ptLabel}</span>
			</div>
			{#if entry.prosthesis_type !== 'replaced'}
				<span>{entry.condition === 'implant' || entry.abutment_type === 'implant' ? i18n.t.chart.implantAbutment : i18n.t.chart.abutment}</span>
			{/if}
		</div>
	{/if}

	<!-- Dissolve group button (bridge or prosthesis) -->
	{#if entry?.bridge_group_id && onDissolveBridge}
		<button
			type="button"
			onclick={() => entry?.bridge_group_id && onDissolveBridge?.(entry.bridge_group_id)}
			class="flex items-center gap-1.5 rounded-md border border-dashed border-destructive/40 px-3 py-2 text-xs text-destructive/70 hover:border-destructive hover:text-destructive hover:bg-destructive/5 transition-colors w-full"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0">
				<path d="M18 6L6 18M6 6l12 12"/>
			</svg>
			{i18n.t.chart.dissolve}
		</button>
	{/if}

	<!-- Tooth condition history -->
	{#if toothHistory.length > 0}
		<Separator />
		<div class="flex flex-col gap-2">
			<Label class="text-xs text-muted-foreground uppercase tracking-wide">Condition History</Label>
			<div class="flex flex-col gap-1">
				{#each toothHistory as h}
					<div class="flex items-center justify-between text-xs text-muted-foreground">
						<span class="font-medium text-foreground/70">{h.recorded_at.slice(0, 10)}</span>
						<span>{h.condition}</span>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</div>
