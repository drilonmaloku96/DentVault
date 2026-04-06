<script lang="ts">
	import { untrack } from 'svelte';
	import type { ToothChartEntry, DentalChartHistoryEntry } from '$lib/types';
	import { dentalTags } from '$lib/stores/dentalTags.svelte';
	import { postTypes } from '$lib/stores/postTypes.svelte';
	import { fillingMaterials } from '$lib/stores/fillingMaterials.svelte';

	/** Live check — reads from the loaded store so user-configured wholeTooth is respected. */
	function isWholeTooth(tagKey: string): boolean {
		return dentalTags.getByKey(tagKey)?.wholeTooth === true;
	}
	import { prosthesisTypes } from '$lib/stores/prosthesisTypes.svelte';
	import { i18n } from '$lib/i18n';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { toFDI, FDI_TOOTH_NAMES, getCanalsForTooth } from '$lib/utils';
	import { getToothHistory } from '$lib/services/db';
	import { getToothNotes, saveToothNote, deleteToothNote } from '$lib/services/db';
	import type { ToothNote } from '$lib/types';
	import EndoDocDialog from './EndoDocDialog.svelte';

	// ── Root canal types ───────────────────────────────────────────────
	type CanalStatus = 'none' | 'filled' | 'insufficient' | 'dressing';
	interface CanalData { status: CanalStatus; post: string | null; apex: boolean }
	type RootDataMap = Record<string, CanalData>;

	const CANAL_STATUS_CYCLE: CanalStatus[] = ['none', 'filled', 'insufficient', 'dressing'];
	const CANAL_COLORS: Record<CanalStatus, { bg: string; border: string; text: string }> = {
		none:         { bg: '#f5f3ff', border: '#c4b5fd', text: '#7c3aed' },
		filled:       { bg: '#dbeafe', border: '#93c5fd', text: '#2563eb' },
		insufficient: { bg: '#fee2e2', border: '#fca5a5', text: '#dc2626' },
		dressing:     { bg: '#fef3c7', border: '#fde68a', text: '#d97706' },
	};

	let {
		toothNumber,
		patientId = '',
		entry = null,
		selectedSurface = null,
		shortcutTagKey = null,
		horizontal = false,
		onSave,
		onClose,
		onDissolveBridge = undefined,
		onNotesChanged = undefined,
	}: {
		toothNumber: number;
		patientId?: string;
		entry?: ToothChartEntry | null;
		selectedSurface?: string | null;
		shortcutTagKey?: { key: string; seq: number } | null;
		horizontal?: boolean;
		onSave: (toothNumber: number, data: { condition: string; notes: string; last_examined: string; surfaces: string; root_data: string; migration: string; tipping: string; rotation: string; foreign_work: number }) => Promise<void>;
		onClose: () => void;
		onDissolveBridge?: (bridgeGroupId: string) => void;
		onNotesChanged?: () => void;
	} = $props();

	const SURFACE_NAMES: Record<string, string> = {
		O: 'Occlusal', B: 'Buccal', L: 'Lingual', M: 'Mesial', D: 'Distal',
	};

	// Grid layout — varies by quadrant so M is always toward midline and B faces outward.
	// Upper teeth (1–16): Lingual/Palatal at top, Buccal at bottom.
	// Lower teeth (17–32): Buccal at top, Lingual at bottom.
	// Right quadrants (1–8 = Q1, 25–32 = Q4): M on right, D on left.
	// Left  quadrants (9–16 = Q2, 17–24 = Q3): M on left,  D on right.
	const surfaceGrid = $derived((): (string | null)[][] => {
		const isUpper = toothNumber <= 16;
		const isRight = toothNumber <= 8 || toothNumber >= 25;
		const top    = isUpper ? 'L' : 'B';
		const bottom = isUpper ? 'B' : 'L';
		const left   = isRight ? 'D' : 'M';
		const right  = isRight ? 'M' : 'D';
		return [
			[null,  top,   null],
			[left,  'O',  right],
			[null, bottom, null],
		];
	});

	// ── Form state ─────────────────────────────────────────────────────
	let selectedCondition = $state<string>(untrack(() => entry?.condition ?? 'healthy'));
	let notes             = $state(untrack(() => entry?.notes ?? ''));
	let lastExamined      = $state(untrack(() => entry?.last_examined ?? ''));
	let migration         = $state(untrack(() => entry?.migration ?? ''));
	let tipping           = $state(untrack(() => entry?.tipping ?? ''));
	let rotation          = $state(untrack(() => entry?.rotation ?? ''));
	let foreignWork       = $state(untrack(() => (entry?.foreign_work ?? 0) === 1));
	let isSaving          = $state(false);
	let savedPulse        = $state(false);

	// ── Tooth notes state ──────────────────────────────────────────────
	let toothNotesList    = $state<ToothNote[]>([]);
	let notesDraftText    = $state('');
	let notesDraftReminder = $state('');
	let editingNoteId     = $state<number | null>(null);  // null = new note
	let showNoteForm      = $state(false);
	let noteDeleteConfirm = $state<number | null>(null);
	let notesLoading      = $state(false);

	interface SurfaceData { tag: string; material?: string; origin?: 'own' | 'foreign'; insufficient?: boolean; grade?: number }
	type SurfaceValue = string | SurfaceData;
	type SurfMap = Record<string, SurfaceValue>;

	function getSurfTag(v: SurfaceValue | undefined): string {
		if (!v) return '';
		return typeof v === 'string' ? v : v.tag;
	}
	function getSurfData(v: SurfaceValue | undefined): SurfaceData {
		if (!v) return { tag: '' };
		return typeof v === 'string' ? { tag: v } : v;
	}
	function parseSurfMap(json: string | undefined): SurfMap {
		if (!json) return {};
		try { return JSON.parse(json) as SurfMap; } catch { return {}; }
	}
	let surfaceMap = $state<SurfMap>(untrack(() => parseSurfMap(entry?.surfaces)));

	function parseRootMap(json: string | undefined): RootDataMap {
		if (!json) return {};
		try { return JSON.parse(json) as RootDataMap; } catch { return {}; }
	}
	let rootDataMap = $state<RootDataMap>(untrack(() => parseRootMap(entry?.root_data)));

	// Root canal UI state
	let openCanalDropdown = $state<string | null>(null);
	let altHoverInfo = $state<{ canal: string; x: number; y: number } | null>(null);
	let showEndoDialog = $state(false);

	// Canals for this tooth (derived from tooth number)
	const toothCanals = $derived(getCanalsForTooth(toothNumber));

	// Whether to show the root canal widget
	const showRootCanalWidget = $derived(
		selectedCondition === 'root_canal' ||
		Object.values(rootDataMap).some(c => c.status !== 'none' || c.apex),
	);

	// Load postTypes store lazily
	$effect(() => {
		if (!postTypes.loaded) postTypes.load();
	});

	$effect(() => {
		if (!fillingMaterials.loaded) fillingMaterials.load();
	});

	// ── Multi-select state ─────────────────────────────────────────────
	let activeSurfaces = $state(new Set<string>());
	let isDragging     = $state(false);
	let dragMode       = $state<'add' | 'remove'>('add');

	// _ready prevents auto-save on initial mount / tooth switch
	let _ready = false;
	let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let _pendingSave = false;

	// Sync single surface from parent prop → single selection
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
			migration         = entry?.migration ?? '';
			tipping           = entry?.tipping ?? '';
			rotation          = entry?.rotation ?? '';
			foreignWork       = (entry?.foreign_work ?? 0) === 1;
			surfaceMap        = parseSurfMap(entry?.surfaces);
			rootDataMap       = parseRootMap(entry?.root_data);
			activeSurfaces    = new Set();
			toothNotesList    = [];
			showNoteForm      = false;
			notesDraftText    = '';
			notesDraftReminder = '';
			editingNoteId     = null;
			noteDeleteConfirm = null;
		});
		setTimeout(() => { _ready = true; }, 0);
	});

	// Load tooth notes when tooth changes (after _ready)
	$effect(() => {
		const _tooth = toothNumber;
		const _pid   = patientId;
		if (_pid) {
			setTimeout(() => loadToothNotes(), 10);
		}
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
		untrack(() => { applyTag(trigger.key); });
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
				root_data:     JSON.stringify(rootDataMap),
				migration,
				tipping,
				rotation,
				foreign_work: foreignWork ? 1 : 0,
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

	// ── Unified tag actions ────────────────────────────────────────────
	// Core rule:
	//   • If surfaces are selected AND the tag is surface-capable → apply to surfaces only
	//   • Otherwise (no selection, or whole-tooth tag) → set tooth condition + clear surfaces
	function applyTag(tagKey: string) {
		if (activeSurfaces.size > 0 && !isWholeTooth(tagKey)) {
			// Surface-level: paint selected surfaces
			for (const s of activeSurfaces) {
				// Preserve existing extended data when re-applying tags that use it
				const existing = surfaceMap[s];
				const existingData = existing && typeof existing === 'object' ? existing : null;
				if ((tagKey === 'filled' || tagKey === 'inlay' || tagKey === 'inlay_planned') && existingData) {
					surfaceMap[s] = { ...existingData, tag: tagKey };
				} else if (tagKey === 'filled' || tagKey === 'inlay' || tagKey === 'inlay_planned') {
					surfaceMap[s] = { tag: tagKey };
				} else if (tagKey === 'mih') {
					// Preserve existing grade, default to 1 for first application
					const existingGrade = existingData?.grade ?? 1;
					surfaceMap[s] = { tag: 'mih', grade: existingGrade };
				} else {
					surfaceMap[s] = tagKey;
				}
			}
			activeSurfaces = new Set();
		} else {
			// Whole-tooth: set condition, wipe per-surface overrides, clear selection
			selectedCondition = tagKey;
			surfaceMap        = {};
			activeSurfaces    = new Set();
		}
		doSave();
	}

	// Clear/reset: remove surface tags from selection, or reset whole tooth to healthy
	function clearTag() {
		if (activeSurfaces.size > 0) {
			for (const s of activeSurfaces) delete surfaceMap[s];
			// keep selection so user can re-apply something else
		} else {
			selectedCondition = 'healthy';
			surfaceMap        = {};
		}
		doSave();
	}

	// ── Display helpers ────────────────────────────────────────────────
	const TOOTH_NAMES = FDI_TOOTH_NAMES;

	function surfFill(key: string): string {
		const v = surfaceMap[key];
		if (!v) return '#f1f5f9';
		const tag = getSurfTag(v);
		const data = getSurfData(v);
		if (data.material) {
			const matColor = fillingMaterials.getColor(data.material);
			if (matColor) return matColor;
		}
		return dentalTags.getByKey(tag)?.color ?? '#f1f5f9';
	}
	function surfStroke(key: string): string {
		const v = surfaceMap[key];
		if (!v) return '#cbd5e1';
		return dentalTags.getByKey(getSurfTag(v))?.strokeColor ?? '#cbd5e1';
	}

	// Label for what we're currently targeting
	const targetLabel = $derived(
		activeSurfaces.size === 0
			? i18n.t.chart.wholeTooth
			: activeSurfaces.size === 1
				? `${SURFACE_NAMES[[...activeSurfaces][0]] ?? [...activeSurfaces][0]}`
				: [...activeSurfaces].map(s => SURFACE_NAMES[s] ?? s).join(' + '),
	);

	// Whether a tag button should show as "currently applied"
	function isTagMatched(tagKey: string): boolean {
		if (activeSurfaces.size > 0 && !isWholeTooth(tagKey)) {
			// Surface mode: matched if ALL selected surfaces have this tag
			return [...activeSurfaces].every(s => getSurfTag(surfaceMap[s]) === tagKey);
		}
		// Whole-tooth mode: matched if tooth condition equals this tag
		return selectedCondition === tagKey;
	}

	// Whether the current target has any tag that can be cleared
	const hasTagToClear = $derived(
		activeSurfaces.size > 0
			? [...activeSurfaces].some(s => !!surfaceMap[s])
			: selectedCondition !== 'healthy' || Object.keys(surfaceMap).length > 0,
	);

	// Whether a tag is applicable in the current selection context
	function tagIsApplicable(tagKey: string): boolean {
		if (activeSurfaces.size === 0) return true; // whole-tooth: all tags ok
		return !isWholeTooth(tagKey); // surface mode: skip whole-tooth-only tags
	}

	// ── Root canal actions ─────────────────────────────────────────────
	function getCanalData(canal: string): CanalData {
		return rootDataMap[canal] ?? { status: 'none', post: null, apex: false };
	}
	function cycleCanalStatus(canal: string) {
		const current = getCanalData(canal);
		const idx  = CANAL_STATUS_CYCLE.indexOf(current.status);
		const next = CANAL_STATUS_CYCLE[(idx + 1) % CANAL_STATUS_CYCLE.length];
		rootDataMap[canal] = { ...current, status: next };
		doSave();
	}
	function toggleApex(canal: string) {
		const current = getCanalData(canal);
		rootDataMap[canal] = { ...current, apex: !current.apex };
		doSave();
	}
	function setCanalPost(canal: string, postKey: string | null) {
		rootDataMap[canal] = { ...getCanalData(canal), post: postKey };
		doSave();
	}
	function setCanalStatus(canal: string, status: CanalStatus) {
		const cur = getCanalData(canal);
		rootDataMap[canal] = { ...cur, status, post: status === 'none' ? null : cur.post };
		openCanalDropdown = null;
		doSave();
	}

	// ── Tooth notes actions ────────────────────────────────────────────
	async function loadToothNotes() {
		if (!patientId) return;
		notesLoading = true;
		try {
			toothNotesList = await getToothNotes(patientId, toothNumber);
			// Auto-migrate legacy notes field if no tooth_notes exist yet
			if (toothNotesList.length === 0 && notes.trim()) {
				await saveToothNote(patientId, toothNumber, notes.trim(), null);
				toothNotesList = await getToothNotes(patientId, toothNumber);
			}
		} finally {
			notesLoading = false;
		}
	}

	function startNewNote() {
		editingNoteId     = null;
		notesDraftText    = '';
		notesDraftReminder = '';
		showNoteForm      = true;
	}

	function startEditNote(note: ToothNote) {
		editingNoteId      = note.id ?? null;
		notesDraftText     = note.text;
		notesDraftReminder = note.reminder_date ?? '';
		showNoteForm       = true;
	}

	function cancelNoteForm() {
		showNoteForm       = false;
		notesDraftText     = '';
		notesDraftReminder = '';
		editingNoteId      = null;
	}

	async function submitNote() {
		if (!notesDraftText.trim() || !patientId) return;
		await saveToothNote(
			patientId,
			toothNumber,
			notesDraftText.trim(),
			notesDraftReminder || null,
			editingNoteId ?? undefined,
		);
		cancelNoteForm();
		toothNotesList = await getToothNotes(patientId, toothNumber);
		onNotesChanged?.();
	}

	async function confirmDeleteNote() {
		if (noteDeleteConfirm === null) return;
		await deleteToothNote(noteDeleteConfirm);
		noteDeleteConfirm = null;
		toothNotesList = await getToothNotes(patientId, toothNumber);
		onNotesChanged?.();
	}

	// ── Filling material helpers ───────────────────────────────────────
	const FILLING_TAGS = new Set(['filled', 'inlay', 'inlay_planned']);

	// Surfaces on this tooth that have a filling tag
	const filledSurfaceKeys = $derived(
		Object.entries(surfaceMap)
			.filter(([k, v]) => k !== '*' && FILLING_TAGS.has(getSurfTag(v)))
			.map(([k]) => k),
	);

	// Currently-active surfaces that are filling-tagged
	const activeFillingSurfaces = $derived(
		activeSurfaces.size > 0
			? [...activeSurfaces].filter(s => FILLING_TAGS.has(getSurfTag(surfaceMap[s])))
			: filledSurfaceKeys,
	);

	const showMaterialPanel = $derived(
		activeFillingSurfaces.length > 0 ||
		FILLING_TAGS.has(selectedCondition),
	);

	// For the panel: read data from first active filling surface, whole-tooth '*' key, or bare condition
	const panelSurfData = $derived(
		activeFillingSurfaces.length > 0
			? getSurfData(surfaceMap[activeFillingSurfaces[0]])
			: FILLING_TAGS.has(selectedCondition)
				? getSurfData(surfaceMap['*'])
				: { tag: selectedCondition },
	);

	function setPanelMaterial(mat: string) {
		if (activeFillingSurfaces.length > 0) {
			for (const s of activeFillingSurfaces) {
				const cur = getSurfData(surfaceMap[s]);
				surfaceMap[s] = { ...cur, material: mat || undefined };
			}
		} else if (FILLING_TAGS.has(selectedCondition)) {
			// Whole-tooth filling: store material in special '*' key
			const cur = getSurfData(surfaceMap['*']);
			surfaceMap['*'] = { ...cur, tag: selectedCondition, material: mat || undefined };
		}
		doSave();
	}
	function setPanelOrigin(origin: 'own' | 'foreign') {
		if (activeFillingSurfaces.length > 0) {
			for (const s of activeFillingSurfaces) {
				const cur = getSurfData(surfaceMap[s]);
				surfaceMap[s] = { ...cur, origin };
			}
		} else if (FILLING_TAGS.has(selectedCondition)) {
			const cur = getSurfData(surfaceMap['*']);
			surfaceMap['*'] = { ...cur, tag: selectedCondition, origin };
		}
		doSave();
	}
	function togglePanelInsufficient() {
		if (activeFillingSurfaces.length > 0) {
			for (const s of activeFillingSurfaces) {
				const cur = getSurfData(surfaceMap[s]);
				surfaceMap[s] = { ...cur, insufficient: !cur.insufficient };
			}
		}
		doSave();
	}

	// ── MIH grade helpers ──────────────────────────────────────────────
	const mihSurfaceKeys = $derived(
		Object.entries(surfaceMap)
			.filter(([, v]) => getSurfTag(v) === 'mih')
			.map(([k]) => k),
	);

	const activeMihSurfaces = $derived(
		activeSurfaces.size > 0
			? [...activeSurfaces].filter(s => getSurfTag(surfaceMap[s]) === 'mih')
			: mihSurfaceKeys,
	);

	const showMihPanel = $derived(activeMihSurfaces.length > 0);

	const panelMihGrade = $derived(
		activeMihSurfaces.length > 0
			? (getSurfData(surfaceMap[activeMihSurfaces[0]]).grade ?? 1)
			: 1,
	);

	function setMihGrade(grade: number) {
		for (const s of activeMihSurfaces) {
			const cur = getSurfData(surfaceMap[s]);
			surfaceMap[s] = { ...cur, grade };
		}
		doSave();
	}

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

<!-- ── Reusable snippets ─────────────────────────────────────────────── -->

{#snippet surfaceGridWidget()}
	<div
		class="grid grid-cols-3 gap-1 select-none"
		style="width:156px; touch-action:none; cursor:crosshair;"
		role="group"
		aria-label="Tooth surfaces"
		onpointerdown={onGridPointerDown}
		onpointerup={() => { isDragging = false; }}
	>
		{#each surfaceGrid() as row}
			{#each row as surf}
				{#if surf}
					{@const isActive = activeSurfaces.has(surf)}
					<div
						data-surface={surf}
						class={[
							'flex items-center justify-center rounded border font-bold text-[11px] transition-colors h-[48px]',
							isActive ? 'ring-2 ring-blue-500 ring-offset-1 border-blue-500 text-blue-700' : '',
						].join(' ')}
						style="background:{surfFill(surf)};border-color:{isActive ? '#2563eb' : surfStroke(surf)};color:{isActive ? '#1d4ed8' : surfStroke(surf)};"
						title={SURFACE_NAMES[surf]}
						onpointerenter={() => { if (isDragging) applySurfaceDragMode(surf); }}
					>{surf}</div>
				{:else}
					<div></div>
				{/if}
			{/each}
		{/each}
	</div>
{/snippet}

{#snippet unifiedTagPickerWidget()}
	<div class="flex flex-col gap-2">
		<!-- Context indicator: what we're tagging -->
		<div class="flex items-center gap-1.5 min-h-[20px]">
			<span class="text-[11px] text-muted-foreground">{i18n.t.chart.applyingTo}:</span>
			<span class="text-[11px] font-semibold text-foreground">
				{#if activeSurfaces.size > 0}
					<span class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 font-medium">
						{targetLabel}
					</span>
				{:else}
					<span class="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-foreground/70">
						{targetLabel}
					</span>
				{/if}
			</span>
			{#if activeSurfaces.size > 0}
				<button
					type="button"
					onclick={() => { activeSurfaces = new Set(); }}
					class="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors"
					title="Deselect surfaces"
				>✕</button>
			{/if}
		</div>

		<!-- Unified tag grid -->
		<div class="flex flex-wrap gap-1.5">
			{#each dentalTags.list as tag}
				{@const applicable = tagIsApplicable(tag.key)}
				{@const matched = isTagMatched(tag.key)}
				<button
					type="button"
					onclick={() => applyTag(tag.key)}
					disabled={!applicable}
					class={[
						'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all',
						matched   ? 'ring-2 ring-offset-1 ring-foreground/20 shadow-sm' : '',
						applicable ? 'opacity-80 hover:opacity-100' : 'opacity-25 cursor-not-allowed',
					].join(' ')}
					style="background:{tag.color};border-color:{matched ? '#1e293b' : tag.strokeColor};color:{tag.strokeColor}"
					title={applicable ? undefined : i18n.t.chart.wholeToothOnly}
				>
					{#if matched}
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
					{dentalTags.getLabel(tag.key)}
					{#if tag.shortcut}<kbd class="ml-0.5 rounded bg-black/10 px-1 font-mono text-[9px] leading-tight">{tag.shortcut}</kbd>{/if}
				</button>
			{/each}

			<!-- Clear/reset button -->
			{#if hasTagToClear}
				<button
					type="button"
					onclick={clearTag}
					class="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
				>
					{activeSurfaces.size > 0 ? i18n.t.chart.clearSurfaces : i18n.t.chart.resetToHealthy}
				</button>
			{/if}
		</div>

	<!-- Material panel — visible when filling surfaces exist -->
	{#if showMaterialPanel}
		<div class="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50/40 px-3 py-2 dark:border-blue-900/40 dark:bg-blue-950/20">
			<!-- Material select -->
			<div class="flex items-center gap-1.5">
				<span class="text-[10px] font-medium text-muted-foreground">{i18n.t.chart.filling.material}</span>
				<select
					class="text-[11px] border border-border rounded px-1.5 py-0.5 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
					onchange={(e) => setPanelMaterial((e.target as HTMLSelectElement).value)}
				>
					<option value="" selected={!panelSurfData.material}>{i18n.t.chart.filling.noMaterial}</option>
					{#each fillingMaterials.list as mat}
						<option value={mat.key} selected={panelSurfData.material === mat.key}>
							{mat.label}
						</option>
					{/each}
				</select>
				{#if panelSurfData.material}
					{@const matColor = fillingMaterials.getColor(panelSurfData.material)}
					<span class="w-3.5 h-3.5 rounded-sm border border-border/60 shrink-0" style="background:{matColor}"></span>
				{/if}
			</div>
			<!-- Origin toggle -->
			<div class="flex items-center gap-1">
				<span class="text-[10px] font-medium text-muted-foreground">{i18n.t.chart.filling.origin}:</span>
				<button
					type="button"
					onclick={() => setPanelOrigin('own')}
					class={['text-[10px] px-2 py-0.5 rounded transition-colors',
						(panelSurfData.origin ?? 'own') === 'own'
							? 'bg-blue-600 text-white'
							: 'border border-border text-muted-foreground hover:bg-muted',
					].join(' ')}
				>{i18n.t.chart.filling.own}</button>
				<button
					type="button"
					onclick={() => setPanelOrigin('foreign')}
					class={['text-[10px] px-2 py-0.5 rounded transition-colors',
						panelSurfData.origin === 'foreign'
							? 'bg-orange-500 text-white'
							: 'border border-border text-muted-foreground hover:bg-muted',
					].join(' ')}
				>{i18n.t.chart.filling.foreign}</button>
			</div>
			<!-- Insufficient checkbox -->
			<label class="flex items-center gap-1.5 cursor-pointer select-none">
				<input
					type="checkbox"
					checked={panelSurfData.insufficient ?? false}
					onchange={togglePanelInsufficient}
					class="rounded border-border"
				/>
				<span class="text-[10px] text-muted-foreground">{i18n.t.chart.filling.insufficient}</span>
			</label>
		</div>
	{/if}

	<!-- MIH grade panel — visible when MIH surfaces are selected or exist -->
	{#if showMihPanel}
		<div class="mt-2 flex items-center gap-2 rounded-md border border-purple-200 bg-purple-50/40 px-3 py-2 dark:border-purple-900/40 dark:bg-purple-950/20">
			<span class="text-[10px] font-medium text-muted-foreground shrink-0">{i18n.t.chart.mih.grade}:</span>
			<div class="flex items-center gap-1">
				{#each [1, 2, 3, 4] as g}
					<button
						type="button"
						onclick={() => setMihGrade(g)}
						title={i18n.t.chart.mih.grades[g as 1|2|3|4]}
						class={['text-[11px] w-6 h-6 rounded font-semibold transition-colors',
							panelMihGrade === g
								? 'bg-purple-600 text-white'
								: 'border border-purple-300 text-purple-700 hover:bg-purple-100 dark:border-purple-700 dark:text-purple-300 dark:hover:bg-purple-900/40',
						].join(' ')}
					>{g}</button>
				{/each}
			</div>
			<span class="text-[10px] text-muted-foreground/70 ml-1">{i18n.t.chart.mih.grades[panelMihGrade as 1|2|3|4]}</span>
		</div>
	{/if}
	</div>
{/snippet}

{#snippet rootCanalWidget()}
	{#if showRootCanalWidget}
		{@const statusLabels: Record<string,string> = {
			none: i18n.t.chart.rootCanal.statusNone,
			filled: i18n.t.chart.rootCanal.filled,
			insufficient: i18n.t.chart.rootCanal.insufficient,
			dressing: i18n.t.chart.rootCanal.dressing,
		}}
		<!-- Transparent overlay to close dropdown on outside click -->
		{#if openCanalDropdown !== null}
			<div class="fixed inset-0 z-40" onclick={() => openCanalDropdown = null} role="none"></div>
		{/if}
		<!-- Alt/Option hover floating info tooltip -->
		{#if altHoverInfo !== null}
			{@const hdata = getCanalData(altHoverInfo.canal)}
			{@const hName = (i18n.t.chart.rootCanal.canalNames as Record<string,string>)[altHoverInfo.canal] ?? altHoverInfo.canal}
			{@const hPost = hdata.post ? (postTypes.list.find(p => p.key === hdata.post)?.label ?? hdata.post) : null}
			<div
				class="fixed z-[60] pointer-events-none rounded-md border border-border bg-popover px-2.5 py-2 shadow-lg text-[11px] flex flex-col gap-1 min-w-[120px]"
				style="left:{altHoverInfo.x + 12}px;top:{altHoverInfo.y + 12}px"
			>
				<span class="font-semibold text-foreground">{hName}</span>
				<span class="flex items-center gap-1.5 text-muted-foreground">
					<span class="w-2.5 h-2.5 rounded-sm border shrink-0" style="background:{CANAL_COLORS[hdata.status].bg};border-color:{CANAL_COLORS[hdata.status].border}"></span>
					{statusLabels[hdata.status] ?? hdata.status}
				</span>
				{#if hPost}
					<span class="text-muted-foreground">{i18n.t.chart.rootCanal.postLabel}: {hPost}</span>
				{/if}
				{#if hdata.apex}
					<span class="flex items-center gap-1 text-red-600 font-medium">
						<span class="w-2 h-2 rounded-full bg-red-500 shrink-0"></span>
						{i18n.t.chart.rootCanal.apexFocus}
					</span>
				{/if}
			</div>
		{/if}
		<div class="flex flex-col gap-2 rounded-md border border-purple-200 bg-purple-50/40 px-3 py-2.5 dark:border-purple-900/40 dark:bg-purple-950/20">
			<div class="flex items-center gap-1.5">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 text-purple-600 shrink-0"><path d="M12 22V8M5 12H2a10 10 0 0 0 20 0h-3"/><path d="M8 2v4M16 2v4M12 2v4"/></svg>
				<span class="text-[11px] font-semibold text-purple-700 uppercase tracking-wide dark:text-purple-400">{i18n.t.chart.rootCanal.filled.split(' ')[0] ?? 'Root Canals'}</span>
				<button
					type="button"
					onclick={() => showEndoDialog = true}
					class="ml-auto flex items-center gap-1.5 rounded-md bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white text-[11px] font-semibold px-2.5 py-1.5 transition-colors shadow-sm dark:bg-purple-700 dark:hover:bg-purple-600"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
					{i18n.t.chart.endo.openButton}
				</button>
			</div>
			<div class="flex gap-2.5 flex-wrap">
				{#each toothCanals as canal}
					{@const cdata     = getCanalData(canal)}
					{@const colors    = CANAL_COLORS[cdata.status]}
					{@const canalName = (i18n.t.chart.rootCanal.canalNames as Record<string,string>)[canal] ?? canal}
					<div
						class="flex flex-col items-center gap-1"
						onpointermove={(e) => {
							if (e.altKey) {
								altHoverInfo = { canal, x: e.clientX, y: e.clientY };
							} else if (altHoverInfo?.canal === canal) {
								altHoverInfo = null;
							}
						}}
						onpointerleave={() => { if (altHoverInfo?.canal === canal) altHoverInfo = null; }}
					>
						<!-- Canal name -->
						<span class="text-[10px] font-mono font-medium text-muted-foreground">{canalName}</span>
						<!-- Status rect — click to open dropdown -->
						<div class="relative">
							<button
								type="button"
								onclick={(e) => { e.stopPropagation(); openCanalDropdown = openCanalDropdown === canal ? null : canal; }}
								class="w-7 h-9 rounded border-2 flex flex-col items-center justify-center transition-all hover:opacity-80 relative"
								style="background:{colors.bg};border-color:{colors.border}"
								title={statusLabels[cdata.status] ?? cdata.status}
							>
								{#if cdata.post}
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-2.5 w-2.5 pointer-events-none" style="color:{colors.text}"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="5" x2="19" y2="5"/></svg>
								{:else if cdata.status !== 'none'}
									<span class="text-[8px] font-bold leading-none" style="color:{colors.text}">✓</span>
								{/if}
							</button>
							<!-- Status dropdown -->
							{#if openCanalDropdown === canal}
								<div
									class="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 flex flex-row rounded-md border border-border bg-popover shadow-md overflow-hidden"
									onclick={(e) => e.stopPropagation()}
									role="menu"
								>
									{#each CANAL_STATUS_CYCLE as status}
										{@const sc = CANAL_COLORS[status]}
										<button
											type="button"
											role="menuitem"
											onclick={() => setCanalStatus(canal, status)}
											class={['flex flex-col items-center gap-1 px-2.5 py-2 text-[10px] hover:bg-accent transition-colors border-r border-border last:border-r-0',
												cdata.status === status ? 'font-semibold bg-accent/50' : '',
											].join(' ')}
											title={statusLabels[status] ?? status}
										>
											<span class="w-4 h-4 rounded-sm border" style="background:{sc.bg};border-color:{sc.border}"></span>
											<span class="whitespace-nowrap">{statusLabels[status] ?? status}</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>
						<!-- Post type selector (only if status is not none) -->
						{#if cdata.status !== 'none'}
							<select
								class="text-[9px] w-7 rounded border border-border bg-background px-0.5 py-0 leading-tight cursor-pointer"
								value={cdata.post ?? ''}
								onchange={(e) => setCanalPost(canal, (e.target as HTMLSelectElement).value || null)}
								title={i18n.t.chart.rootCanal.postLabel}
							>
								<option value="">—</option>
								{#each postTypes.list as pt}
									<option value={pt.key}>{pt.label}</option>
								{/each}
							</select>
						{/if}
						<!-- Apex focus dot -->
						<button
							type="button"
							onclick={() => toggleApex(canal)}
							class={['w-4 h-4 rounded-full border-2 transition-colors flex items-center justify-center',
								cdata.apex ? 'bg-red-500 border-red-700' : 'bg-background border-muted-foreground/30 hover:border-red-400',
							].join(' ')}
							title={i18n.t.chart.rootCanal.apexFocus}
						>
							{#if cdata.apex}
								<span class="text-[8px] text-white font-bold leading-none">!</span>
							{/if}
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}
{/snippet}

{#snippet prosthesisAndDissolveWidget()}
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
	{#if entry?.bridge_group_id && onDissolveBridge}
		<button
			type="button"
			onclick={() => entry?.bridge_group_id && onDissolveBridge?.(entry.bridge_group_id)}
			class="flex items-center gap-1.5 rounded-md border border-dashed border-destructive/40 px-3 py-2 text-xs text-destructive/70 hover:border-destructive hover:text-destructive hover:bg-destructive/5 transition-colors w-full"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0"><path d="M18 6L6 18M6 6l12 12"/></svg>
			{i18n.t.chart.dissolve}
		</button>
	{/if}
{/snippet}

{#snippet positionWidget()}
	{@const MIGRATION_DIRS = ['','mesial','distal','buccal','lingual','superior','inferior']}
	{@const ROTATION_DIRS  = ['','clockwise','counterclockwise']}
	<div class="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
		<span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{i18n.t.chart.position.title}</span>
		<div class="grid grid-cols-2 gap-x-3 gap-y-1.5">
			<!-- Migration -->
			<div class="flex flex-col gap-0.5">
				<label class="text-[10px] text-muted-foreground">{i18n.t.chart.position.migration}</label>
				<select
					bind:value={migration}
					onchange={() => doSave()}
					class="text-[11px] rounded border border-input bg-background px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
				>
					{#each MIGRATION_DIRS as d}
						<option value={d}>{d === '' ? i18n.t.chart.position.directions.none : i18n.t.chart.position.directions[d as keyof typeof i18n.t.chart.position.directions]}</option>
					{/each}
				</select>
			</div>
			<!-- Tipping -->
			<div class="flex flex-col gap-0.5">
				<label class="text-[10px] text-muted-foreground">{i18n.t.chart.position.tipping}</label>
				<select
					bind:value={tipping}
					onchange={() => doSave()}
					class="text-[11px] rounded border border-input bg-background px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
				>
					{#each MIGRATION_DIRS as d}
						<option value={d}>{d === '' ? i18n.t.chart.position.directions.none : i18n.t.chart.position.directions[d as keyof typeof i18n.t.chart.position.directions]}</option>
					{/each}
				</select>
			</div>
			<!-- Rotation -->
			<div class="flex flex-col gap-0.5">
				<label class="text-[10px] text-muted-foreground">{i18n.t.chart.position.rotation}</label>
				<select
					bind:value={rotation}
					onchange={() => doSave()}
					class="text-[11px] rounded border border-input bg-background px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-ring"
				>
					{#each ROTATION_DIRS as d}
						<option value={d}>{d === '' ? i18n.t.chart.position.directions.none : i18n.t.chart.position.directions[d as keyof typeof i18n.t.chart.position.directions]}</option>
					{/each}
				</select>
			</div>
			<!-- Foreign work checkbox -->
			<div class="flex items-center gap-1.5 pt-3">
				<input
					id="foreign-work-cb"
					type="checkbox"
					bind:checked={foreignWork}
					onchange={() => doSave()}
					class="h-3.5 w-3.5 rounded border-input accent-blue-600 cursor-pointer"
				/>
				<label for="foreign-work-cb" class="text-[11px] text-foreground/80 cursor-pointer select-none">{i18n.t.chart.position.foreignWork}</label>
			</div>
		</div>
	</div>
{/snippet}

{#snippet notesDateWidget()}
	<!-- Last examined date — unchanged -->
	<div class="flex flex-col gap-1.5">
		<Label class="text-xs" for="tooth-exam">{i18n.t.chart.lastExamined}</Label>
		<input id="tooth-exam" type="date" class={sc} bind:value={lastExamined}/>
	</div>

	<!-- Multi-entry tooth notes -->
	<div class="flex flex-col gap-2">
		<div class="flex items-center gap-1.5">
			<Label class="text-xs">{i18n.t.chart.toothNotes}</Label>
			{#if !showNoteForm}
				<button
					type="button"
					onclick={startNewNote}
					class="ml-auto flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
				>
					<svg class="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M8 2v12M2 8h12" stroke-linecap="round"/></svg>
					{i18n.t.chart.addNote}
				</button>
			{/if}
		</div>

		<!-- Inline note form -->
		{#if showNoteForm}
			<div class="rounded-md border border-border bg-muted/30 p-2.5 flex flex-col gap-2">
				<textarea
					bind:value={notesDraftText}
					rows={3}
					placeholder="…"
					class="text-xs w-full border border-border rounded px-2 py-1.5 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
				></textarea>
				<div class="flex items-center gap-2">
					<label class="text-[10px] text-muted-foreground shrink-0">{i18n.t.chart.reminderDate}</label>
					<input
						type="date"
						bind:value={notesDraftReminder}
						class="text-[10px] border border-border rounded px-1.5 py-0.5 bg-background flex-1 focus:outline-none focus:ring-1 focus:ring-ring"
					/>
				</div>
				<div class="flex gap-1.5 justify-end">
					<button
						type="button"
						onclick={cancelNoteForm}
						class="text-[10px] px-2 py-1 rounded border border-border text-muted-foreground hover:bg-muted transition-colors"
					>{i18n.t.chart.cancelNote}</button>
					<button
						type="button"
						onclick={submitNote}
						disabled={!notesDraftText.trim()}
						class="text-[10px] px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
					>{i18n.t.chart.saveNote}</button>
				</div>
			</div>
		{/if}

		<!-- Notes list -->
		{#if notesLoading}
			<div class="text-[11px] text-muted-foreground">…</div>
		{:else if toothNotesList.length === 0 && !showNoteForm}
			<div class="text-[11px] text-muted-foreground italic">{i18n.t.chart.noNotes}</div>
		{:else}
			{#each toothNotesList as note (note.id)}
				{@const isOverdue = note.reminder_date !== null && note.reminder_date <= new Date().toISOString().slice(0, 10)}
				<div class="rounded-md border border-border/60 bg-background px-2.5 py-2 flex flex-col gap-1 group">
					<div class="flex items-start gap-1.5">
						<span class="text-[11px] text-foreground flex-1 leading-relaxed whitespace-pre-wrap">{note.text}</span>
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
							<button
								type="button"
								onclick={() => startEditNote(note)}
								class="text-[10px] text-muted-foreground hover:text-foreground transition-colors px-1"
							>{i18n.t.chart.editNote}</button>
							{#if noteDeleteConfirm === note.id}
								<span class="text-[10px] text-destructive">{i18n.t.chart.deleteNoteConfirm}</span>
								<button type="button" onclick={confirmDeleteNote} class="text-[10px] text-destructive hover:underline px-1">{i18n.t.chart.deleteNote}</button>
							{:else}
								<button
									type="button"
									onclick={() => noteDeleteConfirm = note.id ?? null}
									class="text-[10px] text-muted-foreground hover:text-destructive transition-colors px-1"
								>×</button>
							{/if}
						</div>
					</div>
					<div class="flex items-center gap-2 text-[10px] text-muted-foreground">
						<span>{note.created_at.slice(0, 10)}</span>
						{#if note.reminder_date}
							<span class={['flex items-center gap-0.5', isOverdue ? 'text-red-600 font-medium' : 'text-muted-foreground'].join(' ')}>
								<svg class="h-2.5 w-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2" stroke-linecap="round"/></svg>
								{note.reminder_date}
								{#if isOverdue}<span class="ml-0.5">(!)</span>{/if}
							</span>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>
{/snippet}

{#snippet historyWidget()}
	{#if toothHistory.length > 0}
		<div class="flex flex-col gap-1.5">
			<Label class="text-xs text-muted-foreground uppercase tracking-wide">{i18n.t.chart.conditionHistory}</Label>
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
{/snippet}

{#snippet saveStatus()}
	<span class={[
		'text-xs font-medium transition-all duration-300',
		isSaving   ? 'text-muted-foreground opacity-100' :
		savedPulse ? 'text-emerald-600 opacity-100'      : 'opacity-0',
	].join(' ')}>{isSaving ? 'Saving…' : '✓ Saved'}</span>
{/snippet}

<!-- ── Layouts ──────────────────────────────────────────────────────── -->

{#if horizontal}
	<!-- ── Horizontal layout (used below the big chart) ── -->
	<div class="flex flex-col gap-3">
		<!-- Compact header -->
		<div class="flex items-center justify-between gap-4 min-w-0">
			<div class="flex items-center gap-2.5 min-w-0">
				<span class="text-xl font-bold tabular-nums shrink-0">{toFDI(toothNumber)}</span>
				<span class="text-sm font-medium text-muted-foreground truncate">{TOOTH_NAMES[toFDI(toothNumber)] ?? ''}</span>
			</div>
			<div class="flex items-center gap-3 shrink-0">
				{@render saveStatus()}
				<button
					type="button"
					onclick={onClose}
					class="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
					aria-label={i18n.t.actions.close}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
				</button>
			</div>
		</div>
		<Separator />
		<!-- Three-column content row -->
		<div class="flex items-start gap-5 min-w-0">
			<!-- Column 1: Surface grid -->
			<div class="shrink-0 flex flex-col gap-2">
				<Label class="text-xs">
					{i18n.t.chart.selectSurfaces}
					<span class="text-muted-foreground font-normal">(drag)</span>
				</Label>
				{@render surfaceGridWidget()}
			</div>
			<!-- Divider -->
			<div class="w-px bg-border self-stretch shrink-0"></div>
			<!-- Column 2: Unified tag picker + root canal widget -->
			<div class="flex-1 flex flex-col gap-2 min-w-0">
				{@render unifiedTagPickerWidget()}
				{@render rootCanalWidget()}
				{@render prosthesisAndDissolveWidget()}
			</div>
			<!-- Divider -->
			<div class="w-px bg-border self-stretch shrink-0"></div>
			<!-- Column 3: Notes, date, position, history -->
			<div class="shrink-0 flex flex-col gap-2.5" style="width:220px">
				{@render notesDateWidget()}
				{@render positionWidget()}
				{@render historyWidget()}
			</div>
		</div>
	</div>
{:else}
	<!-- ── Vertical layout (original, used in right-panel / snapshot edit mode) ── -->
	<div class="flex flex-col gap-4">
		<!-- Header -->
		<div class="flex items-start justify-between gap-2">
			<div class="flex items-center gap-2">
				<span class="text-2xl font-bold tabular-nums">{toFDI(toothNumber)}</span>
				<span class="text-sm font-medium text-muted-foreground leading-tight">{TOOTH_NAMES[toFDI(toothNumber)] ?? ''}</span>
			</div>
			<div class="flex items-center gap-2">
				{@render saveStatus()}
			</div>
		</div>

		<Separator />

		<!-- Surface grid + unified tag picker side by side -->
		<div class="flex flex-col gap-2">
			<Label class="text-xs">
				{i18n.t.chart.selectSurfaces}
				<span class="text-muted-foreground font-normal">(drag to select · key to tag)</span>
			</Label>
			<div class="flex items-start gap-4">
				{@render surfaceGridWidget()}
				<div class="flex-1 min-w-0">
					{@render unifiedTagPickerWidget()}
				</div>
			</div>
		</div>

		<!-- Root canal widget -->
		{@render rootCanalWidget()}

		<!-- Notes + date -->
		<div class="flex flex-col gap-3">
			{@render notesDateWidget()}
		</div>

		{@render prosthesisAndDissolveWidget()}

		{@render positionWidget()}

		{#if toothHistory.length > 0}
			<Separator />
			{@render historyWidget()}
		{/if}
	</div>
{/if}

<EndoDocDialog
	open={showEndoDialog}
	toothNumber={toothNumber}
	patientId={patientId ?? ''}
	toothCanals={toothCanals}
	onClose={() => showEndoDialog = false}
/>
