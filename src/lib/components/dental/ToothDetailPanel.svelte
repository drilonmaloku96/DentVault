<script lang="ts">
	import { untrack } from 'svelte';
	import type { ToothChartEntry, DentalChartHistoryEntry } from '$lib/types';
	import { dentalTags } from '$lib/stores/dentalTags.svelte';
	import { fillingMaterials } from '$lib/stores/fillingMaterials.svelte';
	import { shadeGuides } from '$lib/stores/shadeGuides.svelte';
	import { crownFindings, type CrownFindingConfig } from '$lib/stores/crownFindings.svelte';
	import { canalStatuses } from '$lib/stores/canalStatuses.svelte';

	/** Live check — reads from the loaded store so user-configured wholeTooth is respected. */
	function isWholeTooth(tagKey: string): boolean {
		return dentalTags.getByKey(tagKey)?.wholeTooth === true;
	}
	import { prosthesisTypes } from '$lib/stores/prosthesisTypes.svelte';
	import { i18n } from '$lib/i18n';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { toLocalISODate, toFDI, FDI_TOOTH_NAMES, getCanalsForTooth } from '$lib/utils';
	import { getToothHistory } from '$lib/services/db';
	import { getToothNotes, saveToothNote, deleteToothNote } from '$lib/services/db';
	import type { ToothNote } from '$lib/types';

	// ── Crown surface findings (store-backed) ─────────────────────────
	const WHOLE_CROWN_KEY = '_whole';

	function crownSurfFinding(surf: string): CrownFindingConfig | undefined {
		const tag = getSurfTag(surfaceMap[surf]);
		return tag.startsWith('cx_') ? crownFindings.getByKey(tag) : undefined;
	}

	// ── Root canal types ───────────────────────────────────────────────
	interface CanalData { status: string; notes?: string; length?: number | null }
	type RootDataMap = Record<string, CanalData>;

	let {
		toothNumber,
		patientId = '',
		entry = null,
		selectedSurface = null,
		shortcutTagKey = null,
		watchShortcutTrigger = null,
		horizontal = false,
		onSave,
		onClose,
		onDissolveBridge = undefined,
		onEditBridge = undefined,
		onNotesChanged = undefined,
	}: {
		toothNumber: number;
		patientId?: string;
		entry?: ToothChartEntry | null;
		selectedSurface?: string | null;
		shortcutTagKey?: { key: string; seq: number } | null;
		watchShortcutTrigger?: { seq: number } | null;
		horizontal?: boolean;
		onSave: (toothNumber: number, data: { condition: string; notes: string; last_examined: string; surfaces: string; root_data: string; migration: string; tipping: string; rotation: string; foreign_work: number; shade: string | null; watch_status: string | null }) => Promise<void>;
		onClose: () => void;
		onDissolveBridge?: (bridgeGroupId: string) => void;
		onEditBridge?: () => void;
		onNotesChanged?: () => void;
	} = $props();

	const SURFACE_NAMES: Record<string, string> = {
		O: 'Occlusal', B: 'Buccal', L: 'Lingual', M: 'Mesial', D: 'Distal', Cv: 'Cervical',
	};

	// Grid layout — mirrors the chart visual orientation so the picker matches what you see on the SVG.
	// Upper teeth (1–16): Buccal at top (far from arch), Lingual at bottom (close to arch).
	// Lower teeth (17–32): Lingual at top (close to arch), Buccal at bottom (far from arch).
	// Right quadrants (1–8 = Q1, 25–32 = Q4): M on right, D on left.
	// Left  quadrants (9–16 = Q2, 17–24 = Q3): M on left,  D on right.
	const surfaceGrid = $derived((): (string | null)[][] => {
		const isUpper = toothNumber <= 16;
		const isRight = toothNumber <= 8 || toothNumber >= 25;
		const top    = isUpper ? 'B' : 'L';
		const bottom = isUpper ? 'L' : 'B';
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
	let selectedShade     = $state<string | null>(untrack(() => entry?.shade ?? null));
	let watchStatus       = $state<string | null>(untrack(() => entry?.watch_status ?? null));
	let activeShadeGuide  = $state<string>(untrack(() => shadeGuides.list[0]?.key ?? ''));
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

	interface SurfaceData { tag: string; material?: string; origin?: 'own' | 'foreign'; insufficient?: boolean; grade?: number; watch?: 'observe' }
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
	let activeRootCanals = $state(new Set<string>());
	let addCanalInput    = $state('');
	let showCanalInput   = $state(false);

	// Canals for this tooth: anatomical defaults + user-added extras stored in rootDataMap
	const toothCanals = $derived(getCanalsForTooth(toothNumber));
	const allCanals   = $derived([
		...toothCanals,
		...Object.keys(rootDataMap).filter(k => !toothCanals.includes(k)),
	]);


	$effect(() => {
		if (!fillingMaterials.loaded) fillingMaterials.load();
	});

	$effect(() => {
		if (!shadeGuides.loaded) shadeGuides.load();
	});

	$effect(() => {
		if (!crownFindings.loaded) crownFindings.load();
	});

	$effect(() => {
		if (!canalStatuses.loaded) canalStatuses.load();
	});

	// Crown derived state — single crown OR bridge abutment (abutments always carry a crown)
	const isCrowned = $derived(
		selectedCondition === 'crowned' ||
		entry?.bridge_role === 'abutment'
	);
	const isPontic = $derived(entry?.bridge_role === 'pontic');
	const wholeCrownFinding   = $derived((() => {
		const tag = getSurfTag(surfaceMap[WHOLE_CROWN_KEY]);
		return tag.startsWith('cx_') ? crownFindings.getByKey(tag) : undefined;
	})());
	const hasCrownFindings    = $derived(
		Object.keys(surfaceMap).some(k => getSurfTag(surfaceMap[k]).startsWith('cx_'))
	);

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
			selectedShade     = entry?.shade ?? null;
			watchStatus       = entry?.watch_status ?? null;
			surfaceMap        = parseSurfMap(entry?.surfaces);
			rootDataMap       = parseRootMap(entry?.root_data);
			activeSurfaces    = new Set();
			activeRootCanals = new Set();
			addCanalInput    = '';
			showCanalInput   = false;
			toothNotesList   = [];
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
				shade: selectedShade,
				watch_status: watchStatus,
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
		const surf = (e.target as Element).closest('[data-surface]')?.getAttribute('data-surface');
		if (!surf) return;
		e.preventDefault();
		isDragging = true;
		// Switching to surface mode clears any active canal selection
		if (activeRootCanals.size > 0) activeRootCanals = new Set();
		if (e.shiftKey) {
			// Shift: additive toggle
			if (activeSurfaces.has(surf)) {
				const s = new Set(activeSurfaces); s.delete(surf); activeSurfaces = s;
				dragMode = 'remove';
			} else {
				activeSurfaces = new Set([...activeSurfaces, surf]);
				dragMode = 'add';
			}
		} else {
			// Plain click: exclusive selection (deselects previous surface)
			if (activeSurfaces.size === 1 && activeSurfaces.has(surf)) {
				activeSurfaces = new Set(); // toggle off if clicking the only selected surface
				dragMode = 'remove';
			} else {
				activeSurfaces = new Set([surf]);
				dragMode = 'add';
			}
		}
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

	// ── Crown finding actions ──────────────────────────────────────────
	function applyCrownFinding(key: string, wholeCrown: boolean) {
		if (wholeCrown) {
			if (getSurfTag(surfaceMap[WHOLE_CROWN_KEY]) === key) {
				delete surfaceMap[WHOLE_CROWN_KEY];
			} else {
				surfaceMap[WHOLE_CROWN_KEY] = key;
			}
			activeSurfaces = new Set();
		} else if (activeSurfaces.size > 0) {
			for (const s of activeSurfaces) {
				if (getSurfTag(surfaceMap[s]) === key) {
					delete surfaceMap[s];
				} else {
					surfaceMap[s] = key;
				}
			}
			activeSurfaces = new Set();
		}
		doSave();
	}

	function clearCrownFindings() {
		for (const k of Object.keys(surfaceMap)) {
			if (getSurfTag(surfaceMap[k]).startsWith('cx_')) delete surfaceMap[k];
		}
		delete surfaceMap[WHOLE_CROWN_KEY];
		doSave();
	}

	// SVG donut-sector path — clockface angles (0=top, 90=right, 180=bottom, 270=left)
	function sectorPath(startClock: number, endClock: number, innerR: number, outerR: number): string {
		const toRad = (c: number) => (c - 90) * Math.PI / 180;
		const a1 = toRad(startClock), a2 = toRad(endClock);
		const f = (n: number) => n.toFixed(2);
		const cx = (r: number, a: number) => r * Math.cos(a);
		const cy = (r: number, a: number) => r * Math.sin(a);
		const span = ((endClock - startClock) + 360) % 360;
		const lg = span > 180 ? 1 : 0;
		return [
			`M ${f(cx(outerR, a1))},${f(cy(outerR, a1))}`,
			`A ${outerR} ${outerR} 0 ${lg} 1 ${f(cx(outerR, a2))},${f(cy(outerR, a2))}`,
			`L ${f(cx(innerR, a2))},${f(cy(innerR, a2))}`,
			`A ${innerR} ${innerR} 0 ${lg} 0 ${f(cx(innerR, a1))},${f(cy(innerR, a1))}`,
			'Z',
		].join(' ');
	}

	// ── Watch status actions ───────────────────────────────────────────
	function setWatchStatus() {
		if (activeSurfaces.size > 0) {
			for (const s of activeSurfaces) {
				const existing = surfaceMap[s];
				const cur = existing && typeof existing === 'object' ? existing : { tag: typeof existing === 'string' ? existing : '' };
				surfaceMap[s] = { ...cur, watch: 'observe' };
			}
			activeSurfaces = new Set();
		} else {
			watchStatus = 'observe';
		}
		doSave();
	}

	// Keyboard shortcut: 'O' toggles observe on/off
	$effect(() => {
		const trigger = watchShortcutTrigger;
		if (!trigger) return;
		untrack(() => {
			if (activeSurfaces.size > 0) {
				for (const s of activeSurfaces) {
					const existing = surfaceMap[s];
					const v = existing && typeof existing === 'object' ? existing : { tag: typeof existing === 'string' ? existing : '' };
					if ((v as SurfaceData).watch === 'observe') {
						const { watch: _w, ...rest } = v as SurfaceData;
						if (!rest.tag && !rest.material && !rest.origin && !rest.insufficient && !rest.grade) {
							delete surfaceMap[s];
						} else {
							surfaceMap[s] = rest;
						}
					} else {
						surfaceMap[s] = { ...v, watch: 'observe' };
					}
				}
				activeSurfaces = new Set();
			} else {
				watchStatus = watchStatus === 'observe' ? null : 'observe';
			}
			doSave();
		});
	});

	function clearWatchStatus() {
		if (activeSurfaces.size > 0) {
			for (const s of activeSurfaces) {
				const existing = surfaceMap[s];
				if (existing && typeof existing === 'object') {
					const { watch: _w, ...rest } = existing as SurfaceData;
					// if nothing left in the surface data, remove the entry
					if (!rest.tag && !rest.material && !rest.origin && !rest.insufficient && !rest.grade) {
						delete surfaceMap[s];
					} else {
						surfaceMap[s] = rest;
					}
				}
			}
			activeSurfaces = new Set();
		} else {
			watchStatus = null;
		}
		doSave();
	}

	// Watch status for the current context (selected surfaces or whole tooth)
	const contextWatchStatus = $derived(
		activeSurfaces.size > 0
			? (() => {
				const watches = [...activeSurfaces].map(s => {
					const v = surfaceMap[s];
					return (v && typeof v === 'object') ? (v as SurfaceData).watch ?? null : null;
				});
				const allSame = watches.every(w => w === watches[0]);
				return allSame ? (watches[0] ?? null) : null;
			})()
			: watchStatus
	);

	// Whether any surface has watch status (for visual cue)
	const anySurfaceHasWatch = $derived(
		Object.values(surfaceMap).some(v => v && typeof v === 'object' && !!(v as SurfaceData).watch)
	);

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
		return rootDataMap[canal] ?? { status: 'none' };
	}

	function toggleCanalSelection(canal: string, shift = false) {
		if (activeSurfaces.size > 0) activeSurfaces = new Set();
		if (shift) {
			const next = new Set(activeRootCanals);
			if (next.has(canal)) { next.delete(canal); } else { next.add(canal); }
			activeRootCanals = next;
		} else {
			// Exclusive: re-clicking the sole selected canal deselects; otherwise select only this one
			activeRootCanals = activeRootCanals.size === 1 && activeRootCanals.has(canal)
				? new Set()
				: new Set([canal]);
		}
	}

	function applyRootStatus(status: string) {
		for (const canal of activeRootCanals) {
			const cur = getCanalData(canal);
			rootDataMap[canal] = { status, notes: cur.notes, length: cur.length };
		}
		// Don't clear selection so the notes/length panel stays visible
		doSave();
	}

	// Status shared by all currently-selected canals (null if mixed)
	const contextCanalStatus = $derived(
		activeRootCanals.size === 0 ? null : (() => {
			const statuses = [...activeRootCanals].map(c => getCanalData(c).status);
			return statuses.every(s => s === statuses[0]) ? statuses[0] : null;
		})()
	);

	function addExtraCanal() {
		const name = addCanalInput.trim();
		if (!name) return;
		rootDataMap[name] = { status: 'none' };
		addCanalInput  = '';
		showCanalInput = false;
		doSave();
	}

	function removeExtraCanal(key: string) {
		delete rootDataMap[key];
		const next = new Set(activeRootCanals);
		next.delete(key);
		activeRootCanals = next;
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
	{@const isUpperTooth = toothNumber <= 16 || (toothNumber >= 51 && toothNumber <= 65)}
	{@const hasCanals = allCanals.length > 0}
	<!-- Flex order when canals present:
	     Upper: Root(order-1) → Cv(order-2) → Crown grid(order-3)
	     Lower: Crown grid(order-1) → Cv(order-2) → Root(order-3)
	     No canals: Crown grid(DOM first) → Cv(DOM second, mt-1) — no order needed -->
	<div class="flex flex-col gap-0" style="width:156px;">

		<!-- Crown 3×3 grid -->
		<div
			class={['flex flex-col gap-1 select-none', hasCanals ? (isUpperTooth ? 'order-3' : 'order-1') : ''].join(' ')}
			style="touch-action:none; cursor:crosshair;"
			role="group"
			aria-label="Tooth surfaces"
			onpointerdown={onGridPointerDown}
			onpointerup={() => { isDragging = false; }}
		>
			<div class="grid grid-cols-3 gap-1">
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
		</div>

		<!-- Cervical — order-2 keeps it between root and crown grid when canals present;
		     falls naturally below the grid (mt-1) when there are no canals -->
		<div
			data-surface="Cv"
			class={[
				'flex items-center justify-center gap-1.5 rounded border font-medium text-[11px] transition-colors h-[26px] select-none',
				hasCanals ? 'order-2 my-2' : 'mt-1',
				activeSurfaces.has('Cv') ? 'ring-2 ring-blue-500 ring-offset-1 border-blue-500 text-blue-700' : '',
			].join(' ')}
			style="touch-action:none; cursor:crosshair; background:{surfFill('Cv')};border-color:{activeSurfaces.has('Cv') ? '#2563eb' : surfStroke('Cv')};color:{activeSurfaces.has('Cv') ? '#1d4ed8' : surfStroke('Cv')};"
			title="Cervical"
			onpointerdown={onGridPointerDown}
			onpointerup={() => { isDragging = false; }}
			onpointerenter={() => { if (isDragging) applySurfaceDragMode('Cv'); }}
		>
			<span class="font-mono text-[10px] font-bold">Cv</span>
			<span class="text-[10px] opacity-70">Cervical</span>
		</div>

		<!-- Root triangles -->
		{#if hasCanals}
			{@const n = allCanals.length}
			{@const gap = 3}
			{@const triW = (156 - (n - 1) * gap) / n}
			{@const svgH = 80}
			{@const baseY  = isUpperTooth ? svgH - 6 : 0}
			{@const apexY  = isUpperTooth ? 6         : svgH - 6}
			{@const labelY = isUpperTooth ? svgH - 10 : 15}
			{@const dotY   = Math.round(svgH / 2)}
			<div class={isUpperTooth ? 'order-1' : 'order-3'}>
				<svg
					width="156"
					height={svgH}
					style="display:block;"
					class="select-none"
					role="group"
					aria-label={i18n.t.chart.rootCanal.title}
				>
					{#each allCanals as canal, i}
						{@const cdata = getCanalData(canal)}
						{@const col = canalStatuses.getColors(cdata.status)}
						{@const isSel = activeRootCanals.has(canal)}
						{@const x0 = i * (triW + gap)}
						{@const x1 = x0 + triW}
						{@const xc = x0 + triW / 2}
						{@const canalName = (i18n.t.chart.rootCanal.canalNames as Record<string,string>)[canal] ?? canal}
						{@const triPath = `M ${x0},${baseY} L ${x1},${baseY} L ${xc},${apexY} Z`}
						<path
							d={triPath}
							fill={isSel ? '#eff6ff' : col.bg}
							stroke={isSel ? '#2563eb' : col.border}
							stroke-width={isSel ? 2 : 1.5}
							stroke-linejoin="round"
							class="cursor-pointer"
							role="button"
							tabindex="0"
							aria-label="{canalName}: {canalStatuses.getLabel(cdata.status)}"
							aria-pressed={isSel}
							onclick={(e) => toggleCanalSelection(canal, e.shiftKey)}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCanalSelection(canal, e.shiftKey); } }}
						/>
						{#if isSel}
							<path d={triPath} fill="#3b82f6" fill-opacity="0.08" stroke="none" pointer-events="none" />
						{/if}
						<text
							x={xc} y={labelY}
							text-anchor="middle"
							font-size="9" font-weight="700" font-family="ui-monospace,monospace"
							fill={isSel ? '#1d4ed8' : col.text}
							pointer-events="none"
						>{canalName}</text>
						{#if cdata.status !== 'none'}
							<circle cx={xc} cy={dotY} r="3.5" fill={col.border} opacity="0.75" pointer-events="none" />
						{/if}
					{/each}
				</svg>
			</div>
		{/if}

	</div>
{/snippet}

{#snippet crownSurfacePickerWidget()}
	{@const isUpperTooth = toothNumber <= 16 || (toothNumber >= 51 && toothNumber <= 65)}
	{@const isRightTooth = toothNumber <= 8 || toothNumber >= 25}
	{@const topSurf    = isUpperTooth ? 'B' : 'L'}
	{@const bottomSurf = isUpperTooth ? 'L' : 'B'}
	{@const leftSurf   = isRightTooth ? 'D' : 'M'}
	{@const rightSurf  = isRightTooth ? 'M' : 'D'}
	{@const OR   = 50}
	{@const IR   = 18}
	{@const mid  = (OR + IR) / 2}
	{@const wcf  = wholeCrownFinding}
	{@const oFind   = crownSurfFinding('O')}
	{@const oActive = activeSurfaces.has('O')}
	{@const cvFind   = crownSurfFinding('Cv')}
	{@const cvActive = activeSurfaces.has('Cv')}
	{@const sectors = [
		{ surf: topSurf,    s: 315, e: 45  },
		{ surf: rightSurf,  s: 45,  e: 135 },
		{ surf: bottomSurf, s: 135, e: 225 },
		{ surf: leftSurf,   s: 225, e: 315 },
	]}
	{@const lblColor = (surf: string) => activeSurfaces.has(surf) ? '#1d4ed8' : '#92400e'}
	{@const hasCanals = allCanals.length > 0}

	<!-- Flex order when canals present:
	     Upper: Root(order-1) → Cv(order-2) → Crown SVG(order-3)
	     Lower: Crown SVG(order-1) → Cv(order-2) → Root(order-3) -->
	<div class="flex flex-col gap-0 select-none" style="width:156px;">

		<!-- Crown SVG circle diagram -->
		<div class={hasCanals ? (isUpperTooth ? 'order-3' : 'order-1') : ''}>
			<svg
				width="148"
				height="148"
				viewBox="-60 -60 120 120"
				style="display:block; touch-action:none; cursor:crosshair;"
				role="group"
				aria-label={i18n.t.chart.crown.surfacePickerLabel}
				onpointerdown={onGridPointerDown}
				onpointerup={() => { isDragging = false; }}
			>
				<defs>
					<pattern id="cx-hatch-{toothNumber}" patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
						<line x1="0" y1="0" x2="0" y2="8" stroke="#d97706" stroke-width="0.7" opacity="0.3"/>
					</pattern>
					<clipPath id="cx-clip-{toothNumber}"><circle r={OR}/></clipPath>
				</defs>

				<circle r={OR}
					fill={wcf ? wcf.color : '#fffbeb'}
					fill-opacity={wcf ? 0.5 : 1}
					stroke={wcf ? wcf.strokeColor : '#d97706'}
					stroke-width={wcf ? 2.5 : 1.5}
					pointer-events="none"
				/>
				<circle r={OR} fill="url(#cx-hatch-{toothNumber})" clip-path="url(#cx-clip-{toothNumber})" pointer-events="none"/>

				{#each sectors as sec}
					{@const finding  = crownSurfFinding(sec.surf)}
					{@const isActive = activeSurfaces.has(sec.surf)}
					{@const pd       = sectorPath(sec.s, sec.e, IR + 3, OR)}
					<path
						d={pd}
						fill={finding ? finding.color : 'transparent'}
						fill-opacity={finding ? 0.8 : 1}
						stroke="none"
						data-surface={sec.surf}
						onpointerenter={() => { if (isDragging) applySurfaceDragMode(sec.surf); }}
						class="cursor-pointer"
						role="button"
						tabindex="0"
						aria-label={SURFACE_NAMES[sec.surf] ?? sec.surf}
						aria-pressed={isActive}
					/>
					{#if isActive}
						<path d={pd} fill="rgba(59,130,246,0.18)" stroke="#2563eb" stroke-width="1.5" pointer-events="none"/>
					{/if}
				{/each}

				<line x1={-OR * 0.68} y1={-OR * 0.68} x2={OR * 0.68} y2={OR * 0.68}
					stroke="#d97706" stroke-width="1.1" opacity="0.4" pointer-events="none"/>
				<line x1={OR * 0.68} y1={-OR * 0.68} x2={-OR * 0.68} y2={OR * 0.68}
					stroke="#d97706" stroke-width="1.1" opacity="0.4" pointer-events="none"/>

				<line x1="0" y1={-(IR + 3)} x2="0" y2={-OR}   stroke="#d97706" stroke-width="0.8" opacity="0.5" pointer-events="none"/>
				<line x1={IR + 3} y1="0"   x2={OR} y2="0"     stroke="#d97706" stroke-width="0.8" opacity="0.5" pointer-events="none"/>
				<line x1="0" y1={IR + 3}   x2="0" y2={OR}     stroke="#d97706" stroke-width="0.8" opacity="0.5" pointer-events="none"/>
				<line x1={-(IR + 3)} y1="0" x2={-OR} y2="0"   stroke="#d97706" stroke-width="0.8" opacity="0.5" pointer-events="none"/>

				<circle
					r={IR}
					fill={oFind ? oFind.color : 'white'}
					stroke={oActive ? '#2563eb' : (oFind ? oFind.strokeColor : '#d97706')}
					stroke-width={oActive ? 2 : 1.2}
					data-surface="O"
					onpointerenter={() => { if (isDragging) applySurfaceDragMode('O'); }}
					class="cursor-pointer"
					role="button"
					tabindex="0"
					aria-label="Occlusal"
					aria-pressed={oActive}
				/>
				{#if oActive}
					<circle r={IR} fill="rgba(59,130,246,0.18)" stroke="none" pointer-events="none"/>
				{/if}

				<text x="0"    y={-mid} text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="700" fill={lblColor(topSurf)}    pointer-events="none">{topSurf}</text>
				<text x="0"    y={mid}  text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="700" fill={lblColor(bottomSurf)} pointer-events="none">{bottomSurf}</text>
				<text x={-mid} y="0"    text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="700" fill={lblColor(leftSurf)}   pointer-events="none">{leftSurf}</text>
				<text x={mid}  y="0"    text-anchor="middle" dominant-baseline="central" font-size="9" font-weight="700" fill={lblColor(rightSurf)}  pointer-events="none">{rightSurf}</text>
				<text x="0"    y="0"    text-anchor="middle" dominant-baseline="central" font-size="8" font-weight="700" fill={lblColor('O')}         pointer-events="none">O</text>
			</svg>
		</div>

		<!-- Cervical margin: order-2 (between root and crown) when canals present, mt-1 otherwise -->
		<div
			data-surface="Cv"
			class={['flex items-center justify-center gap-1.5 rounded border font-medium text-[11px] transition-colors h-[26px] select-none',
				hasCanals ? 'order-2 my-2' : 'mt-1',
				cvActive ? 'ring-2 ring-blue-500 ring-offset-1 border-blue-500 text-blue-700' : '',
			].join(' ')}
			style="touch-action:none; cursor:crosshair; background:{cvFind ? cvFind.color : '#f1f5f9'};border-color:{cvActive ? '#2563eb' : (cvFind ? cvFind.strokeColor : '#cbd5e1')};color:{cvActive ? '#1d4ed8' : (cvFind ? cvFind.strokeColor : '#94a3b8')};"
			title="Cervical margin"
			onpointerdown={onGridPointerDown}
			onpointerup={() => { isDragging = false; }}
			onpointerenter={() => { if (isDragging) applySurfaceDragMode('Cv'); }}
		>
			<span class="font-mono text-[10px] font-bold">Cv</span>
			<span class="text-[10px] opacity-70">Cervical margin</span>
		</div>

		<!-- Root canal triangles: order-1 (upper, above crown) / order-3 (lower, below crown) -->
		{#if hasCanals}
			{@const n = allCanals.length}
			{@const gap = 3}
			{@const triW = (156 - (n - 1) * gap) / n}
			{@const svgH = 80}
			{@const baseY  = isUpperTooth ? svgH - 6 : 0}
			{@const apexY  = isUpperTooth ? 6 : svgH - 6}
			{@const labelY = isUpperTooth ? svgH - 10 : 15}
			{@const dotY   = Math.round(svgH / 2)}
			<div class={isUpperTooth ? 'order-1' : 'order-3'}>
				<svg
					width="156"
					height={svgH}
					style="display:block;"
					class="select-none"
					role="group"
					aria-label={i18n.t.chart.rootCanal.title}
				>
					{#each allCanals as canal, ci}
						{@const cdata = getCanalData(canal)}
						{@const col = canalStatuses.getColors(cdata.status)}
						{@const isSel = activeRootCanals.has(canal)}
						{@const x0 = ci * (triW + gap)}
						{@const x1 = x0 + triW}
						{@const xc = x0 + triW / 2}
						{@const canalName = (i18n.t.chart.rootCanal.canalNames as Record<string,string>)[canal] ?? canal}
						{@const triPath = `M ${x0},${baseY} L ${x1},${baseY} L ${xc},${apexY} Z`}
						<path
							d={triPath}
							fill={isSel ? '#eff6ff' : col.bg}
							stroke={isSel ? '#2563eb' : col.border}
							stroke-width={isSel ? 2 : 1.5}
							stroke-linejoin="round"
							class="cursor-pointer"
							role="button"
							tabindex="0"
							aria-label="{canalName}: {canalStatuses.getLabel(cdata.status)}"
							aria-pressed={isSel}
							onclick={(e) => toggleCanalSelection(canal, e.shiftKey)}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCanalSelection(canal, e.shiftKey); } }}
						/>
						{#if isSel}
							<path d={triPath} fill="#3b82f6" fill-opacity="0.08" stroke="none" pointer-events="none" />
						{/if}
						<text
							x={xc} y={labelY}
							text-anchor="middle"
							font-size="9" font-weight="700" font-family="ui-monospace,monospace"
							fill={isSel ? '#1d4ed8' : col.text}
							pointer-events="none"
						>{canalName}</text>
						{#if cdata.status !== 'none'}
							<circle cx={xc} cy={dotY} r="3.5" fill={col.border} opacity="0.75" pointer-events="none" />
						{/if}
					{/each}
				</svg>
			</div>
		{/if}

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

	<!-- Watch status widget -->
	<div class="flex items-center gap-1.5 pt-1 border-t border-border/40">
		<span class="text-[10px] font-medium text-muted-foreground shrink-0">{i18n.t.chart.watchStatus.label}:</span>
		<div class="flex items-center gap-1 flex-wrap">
			<button
				type="button"
				onclick={() => setWatchStatus()}
				class={[
					'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all',
					contextWatchStatus === 'observe'
						? 'bg-blue-100 border-blue-500 text-blue-700 ring-2 ring-blue-400/40 ring-offset-1 shadow-sm'
						: 'border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-400',
				].join(' ')}
				title="{i18n.t.chart.watchStatus.observe} [O]"
			>
				<!-- Eye icon -->
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5">
					<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
				</svg>
				{i18n.t.chart.watchStatus.observe}
				<span class="text-[9px] opacity-50 font-mono">O</span>
			</button>
			{#if contextWatchStatus !== null || anySurfaceHasWatch}
				<button
					type="button"
					onclick={clearWatchStatus}
					class="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-destructive hover:border-destructive transition-colors"
				>
					{i18n.t.chart.watchStatus.none}
				</button>
			{/if}
		</div>
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

{#snippet crownFindingPickerWidget()}
	<div class="flex flex-col gap-2">
		<!-- Context: what surface(s) we're tagging -->
		<div class="flex items-center gap-1.5 min-h-[20px]">
			<span class="text-[11px] text-muted-foreground">{i18n.t.chart.applyingTo}:</span>
			{#if activeSurfaces.size > 0}
				<span class="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{targetLabel}</span>
				<button type="button" onclick={() => { activeSurfaces = new Set(); }} class="ml-auto text-[10px] text-muted-foreground hover:text-foreground transition-colors" title="Deselect surfaces">✕</button>
			{:else}
				<span class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{i18n.t.chart.crown.wholeCrown}</span>
			{/if}
		</div>

		<!-- Per-surface findings -->
		<div class="flex flex-col gap-1">
			<span class="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{i18n.t.chart.crown.perSurface}</span>
			<div class="flex flex-wrap gap-1.5">
				{#each crownFindings.list.filter(f => !f.wholeCrown) as f}
					{@const matched = activeSurfaces.size > 0 && [...activeSurfaces].every(s => getSurfTag(surfaceMap[s]) === f.key)}
					{@const disabled = activeSurfaces.size === 0}
					<button
						type="button"
						onclick={() => { if (!disabled) applyCrownFinding(f.key, false); }}
						disabled={disabled}
						title={disabled ? i18n.t.chart.crown.selectSurfaceHint : undefined}
						class={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all',
							matched   ? 'ring-2 ring-offset-1 ring-foreground/20 shadow-sm' : '',
							disabled  ? 'opacity-30 cursor-not-allowed' : 'opacity-90 hover:opacity-100',
						].join(' ')}
						style="background:{f.color};border-color:{matched ? '#1e293b' : f.strokeColor};color:{f.strokeColor}"
					>
						{#if matched}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5"><polyline points="20 6 9 17 4 12"/></svg>{/if}
						{crownFindings.getLabel(f.key)}
					</button>
				{/each}
				{#if activeSurfaces.size > 0 && [...activeSurfaces].some(s => getSurfTag(surfaceMap[s]).startsWith('cx_'))}
					<button type="button" onclick={() => {
						for (const s of activeSurfaces) { if (getSurfTag(surfaceMap[s]).startsWith('cx_')) delete surfaceMap[s]; }
						activeSurfaces = new Set(); doSave();
					}} class="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-destructive hover:border-destructive transition-colors">
						{i18n.t.chart.clearSurfaces}
					</button>
				{/if}
			</div>
			{#if activeSurfaces.size === 0}
				<p class="text-[10px] text-amber-700/60 italic">{i18n.t.chart.crown.selectSurfaceHint}</p>
			{/if}
		</div>

		<!-- Whole-crown findings (no surface selection needed) -->
		<div class="flex flex-col gap-1.5 border-t border-amber-200/50 pt-1.5">
			<span class="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">{i18n.t.chart.crown.wholeCrownSection}</span>
			<div class="flex flex-wrap gap-1.5">
				{#each crownFindings.list.filter(f => f.wholeCrown) as f}
					{@const matched = getSurfTag(surfaceMap[WHOLE_CROWN_KEY]) === f.key}
					<button
						type="button"
						onclick={() => applyCrownFinding(f.key, true)}
						class={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all hover:opacity-100',
							matched ? 'ring-2 ring-offset-1 ring-foreground/20 shadow-sm opacity-100' : 'opacity-80',
						].join(' ')}
						style="background:{f.color};border-color:{matched ? '#1e293b' : f.strokeColor};color:{f.strokeColor}"
					>
						{#if matched}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5"><polyline points="20 6 9 17 4 12"/></svg>{/if}
						{crownFindings.getLabel(f.key)}
					</button>
				{/each}
			</div>
		</div>

		<!-- Clear all crown findings -->
		{#if hasCrownFindings}
			<button type="button" onclick={clearCrownFindings}
				class="text-[10px] text-muted-foreground hover:text-destructive transition-colors border border-dashed border-border/40 rounded px-2 py-0.5 w-full text-center hover:border-destructive/40">
				{i18n.t.chart.crown.clearCrownFindings}
			</button>
		{/if}

		<!-- Watch status (same as standard panel) -->
		<div class="flex items-center gap-1.5 pt-1 border-t border-border/40">
			<span class="text-[10px] font-medium text-muted-foreground shrink-0">{i18n.t.chart.watchStatus.label}:</span>
			<div class="flex items-center gap-1 flex-wrap">
				<button type="button" onclick={() => setWatchStatus()}
					class={['inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all',
						contextWatchStatus === 'observe'
							? 'bg-blue-100 border-blue-500 text-blue-700 ring-2 ring-blue-400/40 ring-offset-1 shadow-sm'
							: 'border-blue-300 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:border-blue-400',
					].join(' ')}
					title="{i18n.t.chart.watchStatus.observe} [O]"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
					{i18n.t.chart.watchStatus.observe}
					<span class="text-[9px] opacity-50 font-mono">O</span>
				</button>
				{#if contextWatchStatus !== null || anySurfaceHasWatch}
					<button type="button" onclick={clearWatchStatus}
						class="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-[10px] text-muted-foreground hover:text-destructive hover:border-destructive transition-colors">
						{i18n.t.chart.watchStatus.none}
					</button>
				{/if}
			</div>
		</div>
	</div>
{/snippet}

{#snippet ponticSurfaceWidget()}
	<div class="flex flex-col gap-0 select-none" style="width:156px;">
		<div
			class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-amber-300/60 bg-amber-50/30 gap-2"
			style="height:100px; width:156px;"
		>
			<svg viewBox="0 0 64 26" class="w-20 text-amber-400/70" fill="none" stroke="currentColor" stroke-width="1.5">
				<ellipse cx="32" cy="13" rx="29" ry="11"/>
				<line x1="3" y1="13" x2="61" y2="13" stroke-dasharray="5,3"/>
			</svg>
			<span class="text-[10px] text-muted-foreground/60 text-center leading-tight px-3">
				{i18n.t.chart.ponticChart.noSurface}
			</span>
		</div>
	</div>
{/snippet}

{#snippet ponticTagPickerWidget()}
	<div class="flex flex-col gap-2">
		<div class="rounded-md border border-dashed border-amber-200 bg-amber-50/30 px-2.5 py-2 text-[10px] text-muted-foreground/75 leading-relaxed italic">
			{i18n.t.chart.ponticChart.conditionNote}
		</div>
		<div class="flex flex-wrap gap-1.5">
			{#each dentalTags.list.filter(t => t.key === 'fractured') as tag}
				{@const isBroken = selectedCondition === 'fractured'}
				<button
					type="button"
					onclick={() => { selectedCondition = isBroken ? 'bridge' : 'fractured'; doSave(); }}
					class={[
						'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-all',
						isBroken ? 'ring-2 ring-offset-1 ring-foreground/20 shadow-sm opacity-100' : 'opacity-80 hover:opacity-100',
					].join(' ')}
					style="background:{tag.color};border-color:{isBroken ? '#1e293b' : tag.strokeColor};color:{tag.strokeColor}"
				>
					{#if isBroken}
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5"><polyline points="20 6 9 17 4 12"/></svg>
					{/if}
					{i18n.t.chart.ponticChart.broken}
				</button>
			{/each}
		</div>
	</div>
{/snippet}

{#snippet rootCanalWidget()}
	{#if activeRootCanals.size > 0}
		{@const canalNames = i18n.t.chart.rootCanal.canalNames as Record<string,string>}
		<div class="flex flex-col gap-2">

			<!-- Selected root label + deselect -->
			<div class="flex items-center gap-1.5">
				<span class="text-[11px] font-semibold text-foreground">
					{[...activeRootCanals].map(c => canalNames[c] ?? c).join(' + ')}
				</span>
				<button
					type="button"
					onclick={() => { activeRootCanals = new Set(); }}
					class="text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
					title={i18n.t.chart.rootCanal.clearSelection}
				>✕</button>
			</div>

			<!-- Status tag palette -->
			<div class="flex flex-wrap gap-1">
				{#each canalStatuses.list as statusCfg}
					{@const isMatch = contextCanalStatus === statusCfg.key}
					<button
						type="button"
						onclick={() => applyRootStatus(statusCfg.key)}
						class={[
							'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all hover:opacity-90',
							isMatch ? 'ring-2 ring-offset-1 ring-foreground/20 shadow-sm' : '',
						].join(' ')}
						style="background:{statusCfg.bg};border-color:{isMatch ? '#1e293b' : statusCfg.border};color:{statusCfg.text}"
					>
						{#if isMatch}
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5 shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
						{/if}
						{statusCfg.label}
					</button>
				{/each}
			</div>

			<!-- Per-canal notes + length — only shown once a status is applied -->
			{#each [...activeRootCanals] as canal (canal)}
				{@const cdata = getCanalData(canal)}
				{#if cdata.status !== 'none'}
					<div class="flex flex-col gap-1.5 rounded-md border border-border/60 bg-muted/20 px-2.5 py-2">
						<span class="text-[10px] font-semibold text-muted-foreground">{canalNames[canal] ?? canal}</span>
						<textarea
							rows={2}
							placeholder="Notes…"
							value={cdata.notes ?? ''}
							oninput={(e) => { rootDataMap[canal] = { ...getCanalData(canal), notes: (e.target as HTMLTextAreaElement).value }; }}
							onblur={() => doSave()}
							class="text-xs border border-border rounded px-2 py-1 bg-background resize-none focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40"
						></textarea>
						<div class="flex items-center gap-1.5">
							<label class="text-[10px] text-muted-foreground shrink-0">Length</label>
							<input
								type="number"
								step={0.5}
								min={0}
								placeholder="—"
								value={cdata.length ?? ''}
								oninput={(e) => { const v = (e.target as HTMLInputElement).valueAsNumber; rootDataMap[canal] = { ...getCanalData(canal), length: isNaN(v) ? null : v }; }}
								onblur={() => doSave()}
								class="text-xs border border-border rounded px-2 py-1 bg-background w-20 focus:outline-none focus:ring-1 focus:ring-ring"
							/>
							<span class="text-[10px] text-muted-foreground">mm</span>
							<!-- Remove extra canal (non-anatomical only) -->
							{#if !toothCanals.includes(canal)}
								<button
									type="button"
									onclick={() => removeExtraCanal(canal)}
									class="ml-auto text-[10px] text-muted-foreground hover:text-destructive transition-colors"
									title={i18n.t.actions.delete}
								>✕</button>
							{/if}
						</div>
					</div>
				{/if}
			{/each}

			<!-- Add extra canal -->
			{#if showCanalInput}
				<div class="flex items-center gap-1.5">
					<input
						type="text"
						bind:value={addCanalInput}
						placeholder="Canal name (e.g. MB2)"
						class="text-xs border border-border rounded px-2 py-1 bg-background flex-1 focus:outline-none focus:ring-1 focus:ring-ring"
						onkeydown={(e) => { if (e.key === 'Enter') addExtraCanal(); if (e.key === 'Escape') { showCanalInput = false; addCanalInput = ''; } }}
					/>
					<button type="button" onclick={addExtraCanal} disabled={!addCanalInput.trim()}
						class="text-[10px] px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 transition-colors">Add</button>
					<button type="button" onclick={() => { showCanalInput = false; addCanalInput = ''; }}
						class="text-[10px] text-muted-foreground hover:text-foreground transition-colors">✕</button>
				</div>
			{:else}
				<button
					type="button"
					onclick={() => showCanalInput = true}
					class="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground border border-dashed border-border/60 rounded px-2.5 py-1 w-full justify-center transition-colors hover:border-foreground/30"
				>
					<svg class="size-2.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M8 2v12M2 8h12"/></svg>
					Add canal
				</button>
			{/if}
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
	{#if entry?.bridge_group_id && onEditBridge}
		<button
			type="button"
			onclick={onEditBridge}
			class="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-foreground/80 hover:border-ring/50 hover:bg-muted transition-colors w-full"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
			{i18n.t.chart.editBridge}
		</button>
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

{#snippet shadeWidget()}
	{@const currentGuide = shadeGuides.list.find(g => g.key === activeShadeGuide) ?? shadeGuides.list[0]}
	<div class="flex flex-col gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2.5">
		<div class="flex items-center justify-between">
			<span class="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{i18n.t.chart.shade.title}</span>
			{#if selectedShade}
				<button
					type="button"
					onclick={() => { selectedShade = null; doSave(); }}
					class="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
				>{i18n.t.chart.shade.clear}</button>
			{/if}
		</div>
		{#if shadeGuides.list.length > 1}
			<div class="flex gap-1 flex-wrap">
				{#each shadeGuides.list as guide}
					<button
						type="button"
						onclick={() => activeShadeGuide = guide.key}
						class="text-[10px] px-1.5 py-0.5 rounded border transition-colors {activeShadeGuide === guide.key ? 'border-ring bg-primary/10 text-foreground font-medium' : 'border-border/50 text-muted-foreground hover:border-ring/50'}"
					>{guide.label}</button>
				{/each}
			</div>
		{/if}
		{#if currentGuide}
			<div class="flex flex-wrap gap-1">
				{#each currentGuide.shades as shade}
					<button
						type="button"
						onclick={() => { selectedShade = shade === selectedShade ? null : shade; doSave(); }}
						class="text-[10px] px-1.5 py-0.5 rounded border font-mono transition-colors {selectedShade === shade ? 'bg-blue-600 text-white border-blue-700' : 'border-border/60 text-foreground hover:border-ring/50 hover:bg-muted/60'}"
					>{shade}</button>
				{/each}
			</div>
		{/if}
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
				{@const isOverdue = note.reminder_date !== null && note.reminder_date <= toLocalISODate()}
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
			<!-- Column 1: Surface grid / Crown picker / Pontic indicator -->
			<div class="shrink-0 flex flex-col gap-2">
				<Label class="text-xs">
					{isCrowned ? i18n.t.chart.crown.surfacePickerLabel : isPontic ? i18n.t.chart.pontic : i18n.t.chart.selectSurfaces}
					{#if !isPontic}<span class="text-muted-foreground font-normal">(shift to add)</span>{/if}
				</Label>
				{#if isCrowned}
					{@render crownSurfacePickerWidget()}
				{:else if isPontic}
					{@render ponticSurfaceWidget()}
				{:else}
					{@render surfaceGridWidget()}
				{/if}
			</div>
			<!-- Divider -->
			<div class="w-px bg-border self-stretch shrink-0"></div>
			<!-- Column 2: Finding/tag picker, then root canal widget -->
			<div class="flex-1 flex flex-col gap-2 min-w-0">
				{#if activeRootCanals.size === 0}
					{#if isCrowned}
						{@render crownFindingPickerWidget()}
					{:else if isPontic}
						{@render ponticTagPickerWidget()}
					{:else}
						{@render unifiedTagPickerWidget()}
					{/if}
				{/if}
				{@render rootCanalWidget()}
				{@render prosthesisAndDissolveWidget()}
			</div>
			<!-- Divider -->
			<div class="w-px bg-border self-stretch shrink-0"></div>
			<!-- Column 3: Notes, date, shade, position, history -->
			<div class="shrink-0 flex flex-col gap-2.5" style="width:220px">
				{@render notesDateWidget()}
				{@render shadeWidget()}
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

		<!-- Surface picker + tag picker side by side -->
		<div class="flex flex-col gap-2">
			<Label class="text-xs">
				{isCrowned ? i18n.t.chart.crown.surfacePickerLabel : isPontic ? i18n.t.chart.pontic : i18n.t.chart.selectSurfaces}
				{#if !isPontic}<span class="text-muted-foreground font-normal">(shift to add{isCrowned ? '' : ' · key to tag'})</span>{/if}
			</Label>
			<div class="flex items-start gap-4">
				{#if isCrowned}
					{@render crownSurfacePickerWidget()}
				{:else if isPontic}
					{@render ponticSurfaceWidget()}
				{:else}
					{@render surfaceGridWidget()}
				{/if}
				<div class="flex-1 min-w-0">
					{#if activeRootCanals.size === 0}
						{#if isCrowned}
							{@render crownFindingPickerWidget()}
						{:else if isPontic}
							{@render ponticTagPickerWidget()}
						{:else}
							{@render unifiedTagPickerWidget()}
						{/if}
					{/if}
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

		{@render shadeWidget()}

		{@render positionWidget()}

		{#if toothHistory.length > 0}
			<Separator />
			{@render historyWidget()}
		{/if}
	</div>
{/if}

