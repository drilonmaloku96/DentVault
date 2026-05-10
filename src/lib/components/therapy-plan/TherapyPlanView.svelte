<script lang="ts">
	import { onMount } from 'svelte';
	import type { TreatmentPlan, TreatmentPlanItem, ToothChartEntry, PlanStep } from '$lib/types';
	import {
		getTreatmentPlans,
		insertTreatmentPlan,
		updateTreatmentPlan,
		deleteTreatmentPlan,
		getTreatmentPlanItems,
		insertTreatmentPlanItem,
		updateTreatmentPlanItem,
		deleteTreatmentPlanItem,
		recomputePlanCost,
		updatePlanChartData,
		getChartData,
	} from '$lib/services/db';
	import { Dialog, DialogContent } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import TherapyPlanChart from './TherapyPlanChart.svelte';
	import ToothChart from '$lib/components/dental/ToothChart.svelte';
	import RestorationEditorPanel from '$lib/components/dental/RestorationEditorPanel.svelte';
	import type { BridgeRole, ProsthesisRole, AbutmentType, RestorationType, RestorationResult } from '$lib/components/dental/RestorationEditorPanel.svelte';
	import { prosthesisTypes } from '$lib/stores/prosthesisTypes.svelte';
	import { bridgeRoles } from '$lib/stores/bridgeRoles.svelte';
	import { i18n } from '$lib/i18n';
	import { planProcedures, DEFAULT_PLAN_PROCEDURES, type PlanProcedureConfig } from '$lib/stores/planProcedures.svelte';
	import { toFDI } from '$lib/utils';
	import { scrollIndicator } from '$lib/actions/scrollIndicator';

	let {
		open = $bindable(false),
		patientId,
		onChanged = undefined,
	}: {
		open?: boolean;
		patientId: string;
		onChanged?: () => void;
	} = $props();

	// ── Procedure config — driven by planProcedures store ─────────────────
	// Structural bridge/prosthesis tools (require multi-tooth selection)
	const BRIDGE_TOOLS = new Set(['plan_bridge', 'plan_partial_denture', 'plan_full_denture']);

	// Reactive derived from store
	const PLAN_PROCEDURES = $derived(planProcedures.list);
	const PROC_SHORTCUT   = $derived(
		Object.fromEntries(planProcedures.list.map(p => [p.key, p.shortcut]))
	);

	function procLabel(key: string): string {
		const i18nLabel = (i18n.t.plans.procedures as Record<string, string>)[key];
		return i18nLabel ?? planProcedures.list.find(p => p.key === key)?.label ?? key;
	}
	function procColor(key: string): string {
		return planProcedures.getColor(key);
	}

	// ── Plan data ────────────────────────────────────────────────────────
	// steps: ordered list of procedure applications (source of truth)
	// procedures: derived from steps for chart rendering
	// notes: per-tooth free-text notes
	// entries: bridge/prosthesis group data (ToothChartEntry[])
	let steps     = $state<PlanStep[]>([]);
	let notes     = $state<Record<string, string>>({});
	let entries   = $state<ToothChartEntry[]>([]);
	let ghostData = $state<ToothChartEntry[]>([]);

	// Derived procedures map for chart overlay (skips bridge-group steps — they render via entries)
	const procedures = $derived.by(() => {
		const map: Record<string, string[]> = {};
		for (const step of steps) {
			if (step.bridgeGroupId) continue;
			for (const t of step.teeth) {
				const k = String(t);
				if (!map[k]) map[k] = [];
				if (!map[k].includes(step.procKey)) map[k].push(step.procKey);
			}
		}
		return map;
	});

	// ── Chart interaction state ──────────────────────────────────────────
	let selectedTooth       = $state<number | null>(null);
	let shiftSelectedTeeth  = $state<number[]>([]); // shift = prosthesis/bridge selection
	let altSelectedTeeth    = $state<number[]>([]); // alt   = multi-tag assignment
	let selectedToothNote   = $state('');

	// Sync note textarea with selected tooth
	$effect(() => {
		if (selectedTooth !== null) {
			selectedToothNote = notes[String(selectedTooth)] ?? '';
		}
	});

	// Restoration editor
	let restorationEditTeeth         = $state<number[] | null>(null);
	let expandingGroupId             = $state<string | null>(null);
	let expandingInitialMode         = $state<RestorationType | undefined>(undefined);
	let expandingInitialBridgeRoles  = $state<Map<number, BridgeRole> | undefined>(undefined);
	let expandingInitialProsthesisRoles = $state<Map<number, { prosthesis_type: ProsthesisRole; abutment_type: AbutmentType }> | undefined>(undefined);

	// ── Plan-level state ─────────────────────────────────────────────────
	let allPlans    = $state<TreatmentPlan[]>([]);
	let activePlan  = $state<TreatmentPlan | null>(null);
	let items       = $state<TreatmentPlanItem[]>([]);
	let isLoading   = $state(true);

	let mode           = $state<'list' | 'plan'>('list');  // list = plan selector, plan = planning view
	let showCreateForm = $state(false);
	let newPlanTitle   = $state('');
	let isCreating     = $state(false);
	let editingTitle   = $state(false);
	let editTitleVal   = $state('');
	let manualStepLabel = $state('');
	let showManualStepForm = $state(false);
	let confirmDelete   = $state(false);
	let showPlanSwitcher = $state(false);

	const costTimers: Record<number, ReturnType<typeof setTimeout>> = {};

	const STATUS_ORDER: TreatmentPlan['status'][] = ['proposed', 'accepted', 'in_progress', 'completed', 'cancelled'];
	const ACTIVE_STATUSES = new Set<TreatmentPlan['status']>(['proposed', 'accepted', 'in_progress']);

	const chartSteps     = $derived(steps.filter(s => s.procKey !== 'manual'));
	const manualSteps    = $derived(steps.filter(s => s.procKey === 'manual'));
	const completedCount = $derived(steps.filter(s => s.done).length);
	const totalCount     = $derived(steps.length);
	const pct            = $derived(totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0);
	const activePlans    = $derived(allPlans.filter(p => ACTIVE_STATUSES.has(p.status)));
	const archivedPlans  = $derived(allPlans.filter(p => !ACTIVE_STATUSES.has(p.status)));

	// Per-tooth groups for checklist (excludes bridge-group steps, which are listed separately)
	const TOOTH_ORDER = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17];
	interface ToothGroup { tooth: number; steps: PlanStep[]; doneCount: number; }
	const toothGroups = $derived.by((): ToothGroup[] => {
		const map = new Map<number, PlanStep[]>();
		for (const s of chartSteps) {
			if (s.bridgeGroupId) continue;
			const t = s.teeth[0];
			if (t == null) continue;
			if (!map.has(t)) map.set(t, []);
			map.get(t)!.push(s);
		}
		return [...map.entries()]
			.map(([tooth, ss]) => ({ tooth, steps: ss, doneCount: ss.filter(s => s.done).length }))
			.sort((a, b) => TOOTH_ORDER.indexOf(a.tooth) - TOOTH_ORDER.indexOf(b.tooth));
	});
	const bridgeGroupSteps = $derived(chartSteps.filter(s => !!s.bridgeGroupId));

	function toggleToothDone(tooth: number) {
		const group = toothGroups.find(g => g.tooth === tooth);
		if (!group) return;
		const allDone = group.doneCount === group.steps.length;
		if (allDone) {
			// All done → reset all to undone
			const ids = new Set(group.steps.map(s => s.id));
			for (const s of steps) if (ids.has(s.id)) s.done = false;
		} else {
			// Mark the next undone step as done (one per click)
			const firstUndone = group.steps.find(s => !s.done);
			if (firstUndone) {
				const idx = steps.findIndex(s => s.id === firstUndone.id);
				if (idx >= 0) steps[idx].done = true;
			}
		}
		savePlanData();
	}

	// Bridge/prosthesis info for currently selected tooth
	const selectedToothBridgeEntry = $derived(
		selectedTooth !== null ? (entries.find(e => e.tooth_number === selectedTooth) ?? null) : null
	);
	const selectedToothBridgeMembers = $derived(
		selectedToothBridgeEntry?.bridge_group_id
			? entries.filter(e => e.bridge_group_id === selectedToothBridgeEntry!.bridge_group_id)
			: []
	);

	// ── Data loading ─────────────────────────────────────────────────────
	async function loadAll() {
		isLoading = true;
		mode = 'list';
		activePlan = null;
		steps = []; notes = {}; entries = [];
		try {
			const [plans, ghost] = await Promise.all([
				getTreatmentPlans(patientId),
				getChartData(patientId),
				prosthesisTypes.load(),
				bridgeRoles.load(),
				planProcedures.load(),
			]);
			allPlans  = plans;
			ghostData = ghost;
		} finally {
			isLoading = false;
		}
	}

	async function selectPlan(plan: TreatmentPlan | null) {
		activePlan = plan;
		selectedTooth = null;
		shiftSelectedTeeth = [];
		altSelectedTeeth = [];
		cancelRestorationEdit();
		if (plan) {
			const parsed = parsePlanData(plan.plan_chart_data);
			steps   = parsed.steps;
			notes   = parsed.notes;
			entries = parsed.entries;
			items = await getTreatmentPlanItems(plan.plan_id);
		} else {
			steps   = [];
			notes   = {};
			entries = [];
			items   = [];
		}
	}

	interface PlanData { steps: PlanStep[]; notes: Record<string, string>; entries: ToothChartEntry[]; }

	function parsePlanData(raw: string): PlanData {
		try {
			const v = JSON.parse(raw ?? '{}');
			if (v && typeof v === 'object' && !Array.isArray(v)) {
				// New format: { steps, notes, entries }
				if ('steps' in v) {
					return { steps: v.steps ?? [], notes: v.notes ?? {}, entries: v.entries ?? [] };
				}
				// Previous format: { procedures, notes, entries } → convert to steps preserving array order
				if ('procedures' in v || 'entries' in v) {
					const rawProcs = (v.procedures ?? {}) as Record<string, string | string[]>;
					const converted: PlanStep[] = [];
					let i = 0;
					for (const [toothStr, val] of Object.entries(rawProcs)) {
						const procs = Array.isArray(val) ? val : [val];
						for (const procKey of procs) {
							converted.push({ id: crypto.randomUUID(), teeth: [parseInt(toothStr)], procKey, done: false, addedAt: new Date(Date.now() + i++ * 1000).toISOString() });
						}
					}
					return { steps: converted, notes: v.notes ?? {}, entries: v.entries ?? [] };
				}
				// Legacy flat Record<string,string>
				const converted: PlanStep[] = [];
				let i = 0;
				for (const [toothStr, procKey] of Object.entries(v as Record<string, string>)) {
					converted.push({ id: crypto.randomUUID(), teeth: [parseInt(toothStr)], procKey, done: false, addedAt: new Date(Date.now() + i++ * 1000).toISOString() });
				}
				return { steps: converted, notes: {}, entries: [] };
			}
			if (Array.isArray(v)) return { steps: [], notes: {}, entries: v as ToothChartEntry[] };
		} catch { /* */ }
		return { steps: [], notes: {}, entries: [] };
	}

	async function savePlanData() {
		if (!activePlan) return;
		await updatePlanChartData(activePlan.plan_id, JSON.stringify({ steps, notes, entries }));
		onChanged?.();
	}

	onMount(() => { if (open) loadAll(); });
	$effect(() => { if (open) loadAll(); });


	// ── Keyboard shortcuts ────────────────────────────────────────────────
	// Works for both single-tooth and multi-tooth (alt-selected) modes.
	// When multiple teeth are alt-selected, the shortcut applies to all of
	// them via applyProcToSelection — same as clicking the legend button.
	$effect(() => {
		if (!open) return;
		function onKeydown(e: KeyboardEvent) {
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
			const key = e.key.toLowerCase();
			const found = Object.entries(PROC_SHORTCUT).find(([, k]) => k === key);
			if (!found) return;
			if (altSelectedTeeth.length > 0) {
				e.preventDefault();
				applyProcToSelection(found[0]);
			} else if (selectedTooth !== null) {
				e.preventDefault();
				toggleProcedureOnTooth(selectedTooth, found[0]);
			}
		}
		document.addEventListener('keydown', onKeydown);
		return () => document.removeEventListener('keydown', onKeydown);
	});

	// ── Procedure helpers — all backed by steps[] ───────────────────────────
	function toggleProcedureOnTooth(tooth: number, key: string) {
		const existing = steps.find(s => s.teeth.length === 1 && s.teeth[0] === tooth && s.procKey === key && !s.bridgeGroupId);
		if (existing) {
			steps = steps.filter(s => s.id !== existing.id);
		} else {
			steps = [...steps, { id: crypto.randomUUID(), teeth: [tooth], procKey: key, done: false, addedAt: new Date().toISOString() }];
		}
		savePlanData();
	}

	function removeProcFromTooth(tooth: number, key: string) {
		const existing = steps.find(s => s.teeth.length === 1 && s.teeth[0] === tooth && s.procKey === key && !s.bridgeGroupId);
		if (existing) {
			steps = steps.filter(s => s.id !== existing.id);
			savePlanData();
		}
	}

	function toggleStepDone(id: string) {
		const idx = steps.findIndex(s => s.id === id);
		if (idx >= 0) { steps[idx].done = !steps[idx].done; savePlanData(); }
	}

	function deleteStep(id: string) {
		steps = steps.filter(s => s.id !== id);
		savePlanData();
	}

	function addManualStep() {
		if (!manualStepLabel.trim()) return;
		steps = [...steps, { id: crypto.randomUUID(), teeth: [], procKey: 'manual', done: false, addedAt: new Date().toISOString(), label: manualStepLabel.trim() }];
		manualStepLabel = '';
		showManualStepForm = false;
		savePlanData();
	}

	async function saveSelectedNote() {
		if (selectedTooth === null) return;
		if (selectedToothNote.trim()) {
			notes = { ...notes, [String(selectedTooth)]: selectedToothNote.trim() };
		} else {
			const n = { ...notes };
			delete n[String(selectedTooth)];
			notes = n;
		}
		await savePlanData();
	}

	// ── Tooth click handling ─────────────────────────────────────────────
	function handleToothClick(tooth: number, shiftHeld: boolean, altHeld: boolean) {
		if (restorationEditTeeth !== null) return;

		if (shiftHeld) {
			// Shift+click: build prosthesis/bridge selection (same arch only)
			const isUpper = tooth <= 16;
			if (shiftSelectedTeeth.length > 0 && (shiftSelectedTeeth[0] <= 16) !== isUpper) return;
			const idx = shiftSelectedTeeth.indexOf(tooth);
			shiftSelectedTeeth = idx >= 0
				? shiftSelectedTeeth.filter(t => t !== tooth)
				: [...shiftSelectedTeeth, tooth];
			altSelectedTeeth = [];
			selectedTooth = null;
			return;
		}

		if (altHeld) {
			// Alt+click: build multi-tooth tag-assignment selection (same arch only)
			const isUpper = tooth <= 16;
			if (altSelectedTeeth.length > 0 && (altSelectedTeeth[0] <= 16) !== isUpper) return;
			const idx = altSelectedTeeth.indexOf(tooth);
			altSelectedTeeth = idx >= 0
				? altSelectedTeeth.filter(t => t !== tooth)
				: [...altSelectedTeeth, tooth];
			shiftSelectedTeeth = [];
			selectedTooth = null;
			return;
		}

		// Normal click: single select; clear both multi-selects
		shiftSelectedTeeth = [];
		altSelectedTeeth = [];
		selectedTooth = selectedTooth === tooth ? null : tooth;
	}

	// ── Drag-select handler ───────────────────────────────────────────────
	function handleDragSelect(teeth: number[], modifier: 'shift' | 'alt' | 'none') {
		if (teeth.length === 0) return;
		if (teeth.length === 1) { handleToothClick(teeth[0], modifier === 'shift', modifier === 'alt'); return; }
		selectedTooth = null;
		if (modifier === 'shift') {
			// Shift-drag → immediately open restoration editor
			altSelectedTeeth = [];
			openNewRestorationEditor(teeth);
		} else {
			// Alt-drag (or plain drag) → multi-tooth procedure assignment
			shiftSelectedTeeth = [];
			altSelectedTeeth = teeth;
		}
	}

	// Apply a procedure to all alt-selected teeth
	function applyProcToSelection(key: string) {
		const now = new Date();
		const newSteps: PlanStep[] = [];
		for (const t of altSelectedTeeth) {
			const alreadyHas = steps.some(s => s.teeth.length === 1 && s.teeth[0] === t && s.procKey === key && !s.bridgeGroupId);
			if (!alreadyHas) newSteps.push({ id: crypto.randomUUID(), teeth: [t], procKey: key, done: false, addedAt: new Date(now.getTime() + newSteps.length).toISOString() });
		}
		steps = [...steps, ...newSteps];
		altSelectedTeeth = [];
		savePlanData();
	}

	// ── Entry helpers (bridge/prosthesis groups) ──────────────────────────
	function upsertPlanEntry(toothNumber: number, data: Partial<ToothChartEntry>) {
		const idx = entries.findIndex(e => e.tooth_number === toothNumber);
		const now = new Date().toISOString();
		if (idx >= 0) {
			entries[idx] = { ...entries[idx], ...data, updated_at: now };
		} else {
			entries = [...entries, {
				id: toothNumber, patient_id: patientId, tooth_number: toothNumber,
				bridge_group_id: null, bridge_role: null, abutment_type: null, prosthesis_type: null,
				condition: 'healthy', notes: '', surfaces: '{}', last_examined: '',
				root_data: '{}', migration: '', tipping: '', rotation: '', foreign_work: 0,
				updated_at: now,
				...data,
			} as ToothChartEntry];
		}
	}

	// ── Restoration editor ───────────────────────────────────────────────
	function areTeethContiguous(teeth: number[]): boolean {
		if (teeth.length <= 1) return true;
		const upper = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
		const lower = [32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17];
		const row = teeth.every(t => upper.includes(t)) ? upper :
		            teeth.every(t => lower.includes(t)) ? lower : null;
		if (!row) return false;
		const slots = teeth.map(t => row.indexOf(t)).sort((a, b) => a - b);
		for (let i = 1; i < slots.length; i++) if (slots[i] !== slots[i - 1] + 1) return false;
		return true;
	}

	function openNewRestorationEditor(teeth: number[]) {
		expandingGroupId = null;
		expandingInitialMode = areTeethContiguous(teeth) ? 'bridge' : 'prosthesis';
		expandingInitialBridgeRoles = undefined;
		expandingInitialProsthesisRoles = undefined;
		shiftSelectedTeeth = [...teeth];
		restorationEditTeeth = [...teeth];
		selectedTooth = null;
	}

	function openExistingRestorationEditor(groupId: string) {
		const members = entries.filter(e => e.bridge_group_id === groupId);
		if (!members.length) return;
		const isBridge = !members.some(m => m.prosthesis_type != null);
		expandingGroupId = groupId;
		expandingInitialMode = isBridge ? 'bridge' : 'prosthesis';
		const bm = new Map<number, BridgeRole>();
		const pm = new Map<number, { prosthesis_type: ProsthesisRole; abutment_type: AbutmentType }>();
		for (const m of members) {
			const isImplant = m.condition === 'implant' || m.abutment_type === 'implant';
			bm.set(m.tooth_number, m.bridge_role === 'pontic' ? 'pontic' : isImplant ? 'implant' : 'tooth');
			if (m.prosthesis_type) pm.set(m.tooth_number, { prosthesis_type: m.prosthesis_type as ProsthesisRole, abutment_type: isImplant ? 'implant' : 'tooth' });
		}
		expandingInitialBridgeRoles = bm;
		expandingInitialProsthesisRoles = pm;
		shiftSelectedTeeth = members.map(m => m.tooth_number);
		restorationEditTeeth = [...shiftSelectedTeeth];
		// don't clear selectedTooth — detail panel resumes after editing
	}

	function cancelRestorationEdit() {
		restorationEditTeeth = null;
		shiftSelectedTeeth = [];
		altSelectedTeeth = [];
		expandingGroupId = null;
		expandingInitialMode = undefined;
		expandingInitialBridgeRoles = undefined;
		expandingInitialProsthesisRoles = undefined;
	}

	async function handleRestorationConfirm(result: RestorationResult) {
		if (!restorationEditTeeth) return;
		const groupId = expandingGroupId ?? crypto.randomUUID();
		if (expandingGroupId) {
			const old = entries.filter(e => e.bridge_group_id === expandingGroupId);
			for (const m of old) {
				if (!restorationEditTeeth.includes(m.tooth_number)) {
					upsertPlanEntry(m.tooth_number, { condition: 'healthy', bridge_group_id: null, bridge_role: null, prosthesis_type: null });
				}
			}
		}
		if (result.type === 'bridge') {
			for (const tooth of restorationEditTeeth) {
				const isPontic  = result.ponticTeeth.includes(tooth);
				const isImplant = result.implantAbutments.includes(tooth);
				upsertPlanEntry(tooth, {
					condition: isImplant ? 'implant' : 'bridge',
					bridge_group_id: groupId,
					bridge_role: isPontic ? 'pontic' : 'abutment',
					abutment_type: null, prosthesis_type: null,
				});
			}
		} else {
			for (const tooth of restorationEditTeeth) {
				const role = result.prosthesisRoles.get(tooth);
				if (!role) continue;
				const isReplaced      = role.prosthesis_type === 'replaced';
				const isImplantAnchor = !isReplaced && role.abutment_type === 'implant';
				upsertPlanEntry(tooth, {
					condition: isImplantAnchor ? 'implant' : 'prosthesis',
					bridge_group_id: groupId,
					bridge_role: isReplaced ? 'pontic' : 'abutment',
					abutment_type: null, prosthesis_type: role.prosthesis_type,
				});
			}
		}
		// Add a checklist step for the bridge/prosthesis (only if new group)
		if (!expandingGroupId) {
			const bridgeProcKey = result.type === 'bridge' ? 'plan_bridge'
				: (restorationEditTeeth!.length >= 8 ? 'plan_full_denture' : 'plan_partial_denture');
			steps = [...steps, {
				id: crypto.randomUUID(),
				teeth: [...restorationEditTeeth!],
				procKey: bridgeProcKey,
				done: false,
				addedAt: new Date().toISOString(),
				bridgeGroupId: groupId,
			}];
		}
		await savePlanData();
		cancelRestorationEdit();
	}

	function handleDissolveGroup(groupId: string) {
		const members = entries.filter(e => e.bridge_group_id === groupId);
		for (const m of members) {
			upsertPlanEntry(m.tooth_number, { condition: 'healthy', bridge_group_id: null, bridge_role: null, prosthesis_type: null });
		}
		steps = steps.filter(s => s.bridgeGroupId !== groupId);
		selectedTooth = null;
		savePlanData();
	}

	// ── Plan management ──────────────────────────────────────────────────
	async function createPlan() {
		if (!newPlanTitle.trim() || isCreating) return;
		isCreating = true;
		try {
			const plan = await insertTreatmentPlan(patientId, { title: newPlanTitle.trim(), status: 'proposed' });
			allPlans = [plan, ...allPlans];
			newPlanTitle = '';
			showCreateForm = false;
			await selectPlan(plan);
			mode = 'plan';
			onChanged?.();
		} finally {
			isCreating = false;
		}
	}

	async function enterPlan(plan: TreatmentPlan) {
		await selectPlan(plan);
		mode = 'plan';
	}

	async function toggleItemDone(item: TreatmentPlanItem) {
		if (!activePlan) return;
		const newStatus = item.status === 'completed' ? 'pending' : 'completed';
		const completedDate = newStatus === 'completed' ? new Date().toISOString().slice(0, 10) : '';
		await updateTreatmentPlanItem(item.id, { status: newStatus, completed_date: completedDate });
		items = await getTreatmentPlanItems(activePlan.plan_id);
		const updated = await getTreatmentPlans(patientId);
		allPlans = updated;
		activePlan = updated.find(p => p.plan_id === activePlan?.plan_id) ?? activePlan;
		onChanged?.();
	}

	function handleCostInput(item: TreatmentPlanItem, val: string) {
		clearTimeout(costTimers[item.id]);
		costTimers[item.id] = setTimeout(async () => {
			if (!activePlan) return;
			await updateTreatmentPlanItem(item.id, { estimated_cost: parseFloat(val) || 0 });
			await recomputePlanCost(activePlan.plan_id);
			const updated = await getTreatmentPlans(patientId);
			allPlans = updated;
			activePlan = updated.find(p => p.plan_id === activePlan?.plan_id) ?? activePlan;
			onChanged?.();
		}, 600);
	}

	async function deleteItem(item: TreatmentPlanItem) {
		if (!activePlan) return;
		await deleteTreatmentPlanItem(item.id);
		await recomputePlanCost(activePlan.plan_id);
		items = await getTreatmentPlanItems(activePlan.plan_id);
		onChanged?.();
	}


	async function saveTitle() {
		if (!activePlan || !editTitleVal.trim()) return;
		await updateTreatmentPlan(activePlan.plan_id, { title: editTitleVal.trim() });
		const updated = await getTreatmentPlans(patientId);
		allPlans = updated;
		activePlan = updated.find(p => p.plan_id === activePlan?.plan_id) ?? activePlan;
		editingTitle = false;
		onChanged?.();
	}

	async function setPlanStatus(status: TreatmentPlan['status']) {
		if (!activePlan) return;
		await updateTreatmentPlan(activePlan.plan_id, { status });
		const updated = await getTreatmentPlans(patientId);
		allPlans = updated;
		activePlan = updated.find(p => p.plan_id === activePlan?.plan_id) ?? activePlan;
		onChanged?.();
	}

	async function doDeletePlan() {
		if (!activePlan) return;
		await deleteTreatmentPlan(activePlan.plan_id);
		confirmDelete = false;
		await loadAll();
		onChanged?.();
	}

	let deletingPlanId = $state<string | null>(null);
	async function doDeletePlanById(planId: string) {
		await deleteTreatmentPlan(planId);
		deletingPlanId = null;
		await loadAll();
		onChanged?.();
	}

	function statusClass(s: string) {
		if (s === 'proposed')    return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
		if (s === 'accepted')    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
		if (s === 'in_progress') return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
		if (s === 'completed')   return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300';
		return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
	}
	function statusLabel(s: string) {
		return (i18n.t.plans.status as Record<string, string>)[s] ?? s;
	}
</script>

<Dialog bind:open>
	<DialogContent class="{mode === 'list' ? 'max-w-2xl sm:max-w-2xl' : 'max-w-[1400px] sm:max-w-[1400px]'} max-h-[95vh] overflow-hidden p-0 focus:outline-none outline-none gap-0" showCloseButton={false}>

		<!-- ── Amber header banner ── -->
		<div class="flex items-center gap-3 px-5 py-3 border-b border-blue-300/60 dark:border-blue-700/40 bg-blue-50 dark:bg-blue-950/30 shrink-0">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0">
				<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
			</svg>

			{#if mode === 'plan'}
				<button
					onclick={() => { mode = 'list'; activePlan = null; steps = []; notes = {}; entries = []; }}
					class="flex items-center gap-1 text-xs text-blue-700/70 dark:text-blue-400/70 hover:text-blue-900 dark:hover:text-blue-200 font-medium transition-colors shrink-0"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3.5 w-3.5"><polyline points="15 18 9 12 15 6"/></svg>
					{i18n.t.plans.title}
				</button>
				<span class="text-blue-400/50 dark:text-blue-600/50 shrink-0">·</span>
			{/if}

			<span class="text-xs font-bold uppercase tracking-widest text-blue-700 dark:text-blue-400 shrink-0">{i18n.t.plans.planningLabel}</span>

			{#if activePlan && mode === 'plan'}
				{#if editingTitle}
					<form onsubmit={(e) => { e.preventDefault(); saveTitle(); }} class="flex items-center gap-1.5 flex-1 min-w-0">
						<input
							bind:value={editTitleVal}
							class="flex-1 min-w-0 rounded border border-blue-300 bg-white dark:bg-blue-950/40 dark:border-blue-700 px-2 py-0.5 text-sm font-semibold text-blue-900 dark:text-blue-100 outline-none focus:ring-1 focus:ring-blue-400"
							autofocus
							onblur={saveTitle}
						/>
					</form>
				{:else}
					<button
						onclick={() => { editTitleVal = activePlan?.title ?? ''; editingTitle = true; }}
						class="flex-1 min-w-0 text-sm font-semibold text-blue-900 dark:text-blue-100 truncate text-left hover:underline decoration-blue-400/60"
					>{activePlan.title}</button>
				{/if}

				<div class="relative shrink-0">
					<button
						onclick={() => (showPlanSwitcher = !showPlanSwitcher)}
						class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold {statusClass(activePlan.status)}"
					>
						{statusLabel(activePlan.status)}
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-2.5 w-2.5 ml-0.5"><polyline points="6 9 12 15 18 9"/></svg>
					</button>
					{#if showPlanSwitcher}
						<div class="fixed inset-0 z-40" role="presentation" onclick={() => (showPlanSwitcher = false)}></div>
						<div class="absolute top-full right-0 mt-1 z-50 w-44 rounded-lg border border-border bg-background shadow-lg overflow-hidden">
							{#each STATUS_ORDER as s}
								<button
									onclick={() => { setPlanStatus(s); showPlanSwitcher = false; }}
									class="flex w-full items-center gap-2 px-3 py-2 text-xs hover:bg-muted/60 transition-colors {activePlan.status === s ? 'font-semibold' : ''}"
								>
									<span class="inline-flex rounded-full px-2 py-px {statusClass(s)}">{statusLabel(s)}</span>
								</button>
							{/each}
							<div class="border-t border-border">
								{#if !confirmDelete}
									<button onclick={() => (confirmDelete = true)} class="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors">
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
										{i18n.t.plans.deletePlan}
									</button>
								{:else}
									<button onclick={doDeletePlan} class="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-semibold text-destructive bg-destructive/10 hover:bg-destructive/20 transition-colors">
										{i18n.t.plans.confirmDeleteShort}
									</button>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			{:else if mode === 'list'}
				<span class="flex-1 text-xs text-blue-600/60 dark:text-blue-500/60">
					{allPlans.length === 0 ? i18n.t.plans.countZero : allPlans.length === 1 ? i18n.t.plans.countSingular : i18n.t.plans.countPlural.replace('{n}', String(allPlans.length))}
				</span>
			{/if}

			<button
				onclick={() => (open = false)}
				class="shrink-0 ml-1 rounded-sm p-1 text-blue-600/70 hover:text-blue-900 dark:text-blue-400/70 dark:hover:text-blue-200 hover:bg-blue-200/40 transition-colors"
				aria-label={i18n.t.actions.close}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-4 w-4"><path d="M18 6L6 18M6 6l12 12"/></svg>
			</button>
		</div>

		<!-- ── Main content area ── -->
		{#if isLoading}
			<div class="flex items-center justify-center h-64">
				<div class="h-6 w-6 animate-spin rounded-full border-2 border-blue-400 border-t-transparent"></div>
			</div>

		{:else if mode === 'list'}
			<!-- ════════════════════════════════════════════════════════
			     LIST VIEW — plan selector
			════════════════════════════════════════════════════════ -->
			<div use:scrollIndicator={{ zIndex: 55 }} class="overflow-y-auto p-5 flex flex-col gap-3" style="max-height: calc(95vh - 52px);">

				<!-- Active plans -->
				{#if activePlans.length > 0}
					<p class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-0.5">{i18n.t.plans.status.active}</p>
					{#each activePlans as plan (plan.plan_id)}
						{@const pd = parsePlanData(plan.plan_chart_data)}
						{@const psc = pd.steps.length}
						{@const pdc = pd.steps.filter(s => s.done).length}
						<div class="flex items-center gap-1.5 group">
							<button
								onclick={() => enterPlan(plan)}
								class="flex-1 text-left rounded-xl border border-blue-200/70 dark:border-blue-800/40 bg-blue-50/40 dark:bg-blue-950/15 px-4 py-3.5 hover:bg-blue-50 dark:hover:bg-blue-950/25 hover:border-blue-300 dark:hover:border-blue-700/60 transition-all min-w-0"
							>
								<div class="flex items-start justify-between gap-2 mb-2">
									<span class="font-semibold text-sm text-foreground leading-snug">{plan.title}</span>
									<span class="inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold {statusClass(plan.status)}">{statusLabel(plan.status)}</span>
								</div>
								<div class="flex items-center gap-3">
									{#if psc > 0}
										<div class="flex items-center gap-1.5 flex-1 min-w-0">
											<div class="flex-1 h-1 rounded-full bg-muted/60 overflow-hidden">
												<div class="h-full rounded-full bg-blue-400 dark:bg-blue-500" style="width:{Math.round((pdc/psc)*100)}%"></div>
											</div>
											<span class="text-[11px] text-muted-foreground shrink-0">{pdc}/{psc}</span>
										</div>
									{:else}
										<span class="text-[11px] text-muted-foreground/50 italic flex-1">{i18n.t.plans.noSteps}</span>
									{/if}
									{#if plan.total_estimated_cost > 0}
										<span class="text-[11px] text-muted-foreground shrink-0">{plan.total_estimated_cost.toFixed(0)} €</span>
									{/if}
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-3.5 w-3.5 text-blue-400 group-hover:text-blue-600 shrink-0 transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
								</div>
							</button>
							<!-- Delete button -->
							{#if deletingPlanId === plan.plan_id}
								<button
									onclick={(e) => { e.stopPropagation(); doDeletePlanById(plan.plan_id); }}
									class="shrink-0 flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-white bg-destructive hover:bg-destructive/90 transition-colors"
								>{i18n.t.plans.confirmDeleteShort}</button>
								<button
									onclick={(e) => { e.stopPropagation(); deletingPlanId = null; }}
									class="shrink-0 text-xs text-muted-foreground hover:text-foreground px-1"
								>✕</button>
							{:else}
								<button
									onclick={(e) => { e.stopPropagation(); deletingPlanId = plan.plan_id; }}
									class="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
									aria-label={i18n.t.plans.deletePlan}
								>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
								</button>
							{/if}
						</div>
					{/each}
				{/if}

				<!-- Archived plans -->
				{#if archivedPlans.length > 0}
					<p class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 px-0.5 mt-1">{i18n.t.plans.archive}</p>
					{#each archivedPlans as plan (plan.plan_id)}
						{@const pd = parsePlanData(plan.plan_chart_data)}
						{@const psc = pd.steps.length}
						{@const pdc = pd.steps.filter(s => s.done).length}
						<div class="flex items-center gap-1.5 group opacity-75 hover:opacity-100 transition-opacity">
							<button
								onclick={() => enterPlan(plan)}
								class="flex-1 text-left rounded-xl border border-border/40 bg-muted/10 px-4 py-3.5 hover:bg-muted/20 hover:border-border/70 transition-all min-w-0"
							>
								<div class="flex items-start justify-between gap-2 mb-2">
									<span class="font-semibold text-sm text-foreground leading-snug">{plan.title}</span>
									<span class="inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold {statusClass(plan.status)}">{statusLabel(plan.status)}</span>
								</div>
								<div class="flex items-center gap-3">
									{#if psc > 0}
										<div class="flex items-center gap-1.5 flex-1 min-w-0">
											<div class="flex-1 h-1 rounded-full bg-muted/60 overflow-hidden">
												<div class="h-full rounded-full bg-emerald-400 dark:bg-emerald-500" style="width:{Math.round((pdc/psc)*100)}%"></div>
											</div>
											<span class="text-[11px] text-muted-foreground shrink-0">{pdc}/{psc}</span>
										</div>
									{:else}
										<span class="text-[11px] text-muted-foreground/50 italic flex-1">{i18n.t.plans.noSteps}</span>
									{/if}
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground shrink-0 transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
								</div>
							</button>
							<!-- Delete button -->
							{#if deletingPlanId === plan.plan_id}
								<button
									onclick={(e) => { e.stopPropagation(); doDeletePlanById(plan.plan_id); }}
									class="shrink-0 flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold text-white bg-destructive hover:bg-destructive/90 transition-colors"
								>{i18n.t.plans.confirmDeleteShort}</button>
								<button
									onclick={(e) => { e.stopPropagation(); deletingPlanId = null; }}
									class="shrink-0 text-xs text-muted-foreground hover:text-foreground px-1"
								>✕</button>
							{:else}
								<button
									onclick={(e) => { e.stopPropagation(); deletingPlanId = plan.plan_id; }}
									class="shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
									aria-label={i18n.t.plans.deletePlan}
								>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
								</button>
							{/if}
						</div>
					{/each}
				{/if}

				<!-- New plan -->
				{#if showCreateForm}
					<div class="rounded-xl border border-blue-300 dark:border-blue-700/60 bg-blue-50 dark:bg-blue-950/20 px-4 py-3.5">
						<p class="text-xs font-semibold text-blue-800 dark:text-blue-300 mb-2">{i18n.t.plans.new}</p>
						<div class="flex items-center gap-2">
							<input
								bind:value={newPlanTitle}
								placeholder={i18n.t.plans.fields.name}
								class="flex-1 rounded border border-blue-300 dark:border-blue-700 bg-white dark:bg-blue-950/40 px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-blue-400"
								onkeydown={(e) => { if (e.key === 'Enter') createPlan(); if (e.key === 'Escape') { showCreateForm = false; } }}
								autofocus
							/>
							<Button size="sm" onclick={createPlan} disabled={isCreating || !newPlanTitle.trim()} class="bg-blue-500 hover:bg-blue-600 text-white border-0 h-8 px-3 text-xs shrink-0">
								{isCreating ? i18n.t.common.loading : i18n.t.actions.save}
							</Button>
							<button onclick={() => (showCreateForm = false)} class="text-xs text-muted-foreground hover:text-foreground shrink-0">{i18n.t.actions.cancel}</button>
						</div>
					</div>
				{:else}
					<button
						onclick={() => { showCreateForm = true; newPlanTitle = ''; }}
						class="w-full rounded-xl border-2 border-dashed border-blue-200/70 dark:border-blue-800/40 px-4 py-4 hover:border-blue-400 dark:hover:border-blue-600 hover:bg-blue-50/30 dark:hover:bg-blue-950/10 transition-all flex items-center justify-center gap-2 text-blue-500/60 dark:text-blue-500/40 hover:text-blue-600 dark:hover:text-blue-400"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-4 w-4"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
						<span class="text-sm font-medium">{i18n.t.plans.new}</span>
					</button>
				{/if}

			</div>

		{:else if mode === 'plan' && activePlan}
			<!-- ════════════════════════════════════════════════════════
			     PLAN VIEW — two-panel layout
			════════════════════════════════════════════════════════ -->
			<div class="flex overflow-hidden" style="height: calc(95vh - 52px);">

				<!-- ── Left panel: befund (above) + planning chart + legend + detail ── -->
				<div use:scrollIndicator={{ zIndex: 55 }} class="flex-1 flex flex-col overflow-y-auto border-r border-border/60 min-w-0 p-4 gap-3">

					<!-- ── Clinical befund — full color, read-only reference ── -->
					<div class="shrink-0">
						<div class="flex items-center gap-2 mb-1">
							<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{i18n.t.plans.currentFindings}</span>
							<div class="flex-1 h-px bg-border/25"></div>
						</div>
						<div class="pointer-events-none select-none rounded-md border border-border/25 overflow-hidden">
							<ToothChart
								chartData={ghostData}
								selectedTooth={null}
								selectedSurface={null}
								showLegend={false}
								onToothClick={() => {}}
							/>
						</div>
					</div>

					<!-- ── Therapy planning chart ── -->
					<div class="shrink-0">
						<div class="flex items-center gap-2 mb-1">
							<span class="text-[10px] font-semibold uppercase tracking-widest text-blue-600/70 dark:text-blue-400/60">{i18n.t.plans.planningLabel}</span>
							<div class="flex-1 h-px bg-blue-200/40 dark:bg-blue-800/30"></div>
						</div>
				{#key activePlan.plan_id}
					<TherapyPlanChart
						{ghostData}
						{procedures}
						{entries}
						{selectedTooth}
						{shiftSelectedTeeth}
						{altSelectedTeeth}
						onToothClick={handleToothClick}
						onDragSelect={handleDragSelect}
						onBlankClick={() => { selectedTooth = null; shiftSelectedTeeth = []; altSelectedTeeth = []; }}
					/>
				{/key}
			</div>

				<!-- Shift-selection bar: prosthesis / bridge -->
				{#if shiftSelectedTeeth.length >= 2 && restorationEditTeeth === null}
					<div class="rounded-md border border-violet-200 dark:border-violet-800/40 bg-violet-50/60 dark:bg-violet-950/20 px-3 py-2.5 shrink-0">
						<div class="flex items-center gap-2">
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-violet-600 shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
							<span class="text-xs text-violet-700 dark:text-violet-400 font-semibold flex-1">
								{i18n.t.plans.dragTeethCount.replace('{n}', String(shiftSelectedTeeth.length))}: {shiftSelectedTeeth.map(t => toFDI(t)).join(', ')}
							</span>
							<button
								onclick={() => openNewRestorationEditor([...shiftSelectedTeeth])}
								class="rounded border border-violet-400 bg-violet-100 dark:bg-violet-900/40 px-2.5 py-1 text-xs font-semibold text-violet-700 dark:text-violet-300 hover:bg-violet-200 transition-colors"
							>{i18n.t.plans.planBridgeProsthesis}</button>
							<button
								onclick={() => { shiftSelectedTeeth = []; }}
								class="text-muted-foreground hover:text-foreground transition-colors"
								aria-label={i18n.t.actions.deselect}
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3.5 w-3.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
							</button>
						</div>
					</div>
				{/if}

				<!-- ── Keyboard shortcut legend ── -->
				<div class="shrink-0 rounded-md border border-border/40 bg-muted/10 px-3 py-2.5">
					<div class="flex flex-wrap gap-x-2 gap-y-1.5 items-center">
						{#each PLAN_PROCEDURES as proc}
						{@const sc = PROC_SHORTCUT[proc.key]}
						{@const isMulti = altSelectedTeeth.length >= 2}
						{@const canApply = selectedTooth !== null || isMulti}
						{@const alreadyOn = isMulti
							? altSelectedTeeth.every(t => (procedures[String(t)] ?? []).includes(proc.key))
							: selectedTooth !== null && (procedures[String(selectedTooth)] ?? []).includes(proc.key)}
						<button
							onclick={() => {
								if (isMulti) applyProcToSelection(proc.key);
								else if (selectedTooth !== null) toggleProcedureOnTooth(selectedTooth, proc.key);
							}}
							title={isMulti
								? i18n.t.plans.applyToAll.replace('{label}', procLabel(proc.key)).replace('{n}', String(altSelectedTeeth.length))
								: canApply ? i18n.t.plans.applyToTooth.replace('{label}', procLabel(proc.key)).replace('{n}', String(toFDI(selectedTooth!))).replace('{key}', sc.toUpperCase()) : i18n.t.plans.selectToothThenKey.replace('{key}', sc.toUpperCase()).replace('{label}', procLabel(proc.key))}
							class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-all {canApply ? 'hover:scale-105' : 'cursor-default'}"
							style={alreadyOn
								? `background:${proc.color}; color:#fff; font-weight:700;`
								: `color:${proc.color}; opacity:${canApply ? '1' : '0.55'};`}
						>
							<kbd class="inline-flex h-4 min-w-[14px] items-center justify-center rounded border px-1 text-[9px] font-mono leading-none shrink-0" style="border-color:{proc.color}66; background:{proc.color}18; color:{proc.color};">{sc.toUpperCase()}</kbd>
							<span class="h-2 w-2 rounded-sm shrink-0" style="background:{proc.color}; opacity:{canApply ? '1' : '0.6'};"></span>
							<span>{procLabel(proc.key)}</span>
						</button>
						{/each}
					</div>
					<p class="text-[9px] text-muted-foreground/40 mt-1.5 leading-tight">
						{i18n.t.plans.chartHintText}
					</p>
				</div>

					<!-- ── Restoration editor (bridge/prosthesis) ── -->
					{#if restorationEditTeeth !== null}
						<div class="border border-violet-200 dark:border-violet-800/40 rounded-lg bg-violet-50/50 dark:bg-violet-950/10 shrink-0">
							<div class="px-4 pt-3">
								<p class="text-xs font-semibold text-violet-700 dark:text-violet-400 mb-2">
									{i18n.t.plans.restorationPlanHeader.replace('{teeth}', shiftSelectedTeeth.map(t => toFDI(t)).join(', '))}
								</p>
							</div>
							<div class="px-4 pb-4">
								<RestorationEditorPanel
									teeth={restorationEditTeeth}
									onConfirm={handleRestorationConfirm}
									onCancel={cancelRestorationEdit}
									isExpand={expandingGroupId !== null}
									initialMode={expandingInitialMode}
									initialBridgeRoles={expandingInitialBridgeRoles}
									initialProsthesisRoles={expandingInitialProsthesisRoles}
								/>
							</div>
						</div>
					{/if}

					<!-- ── Per-tooth planning detail (pointer mode, tooth selected) ── -->
					{#if selectedTooth !== null && restorationEditTeeth === null}
						{@const toothProcs = procedures[String(selectedTooth)] ?? []}
						{@const unassigned = PLAN_PROCEDURES.filter(p => !toothProcs.includes(p.key))}
						{@const bridgeEntry = selectedToothBridgeEntry}
						{@const bridgeMembers = selectedToothBridgeMembers}

						<div class="rounded-lg border border-blue-200/70 dark:border-blue-800/40 bg-blue-50/40 dark:bg-blue-950/15 p-3 shrink-0">

							<!-- Header -->
							<div class="flex items-center justify-between mb-2">
								<span class="text-xs font-semibold text-blue-800 dark:text-blue-300">
									{i18n.t.plans.toothStepsHeader.replace('{n}', String(toFDI(selectedTooth)))}
								</span>
								<button
									onclick={() => { selectedTooth = null; }}
									class="text-muted-foreground/40 hover:text-foreground p-0.5 rounded transition-colors"
									aria-label={i18n.t.actions.close}
								>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3.5 w-3.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
								</button>
							</div>

							<!-- ── Bridge/Prosthesis group info ── -->
							{#if bridgeEntry?.bridge_group_id}
								<div class="mb-2.5 rounded border border-violet-200/70 dark:border-violet-700/40 bg-violet-50/50 dark:bg-violet-950/15 px-2.5 py-2">
									<div class="flex items-center gap-2 mb-1.5">
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 text-violet-500 shrink-0"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
										<span class="text-[11px] font-semibold text-violet-700 dark:text-violet-300">
											{bridgeEntry.prosthesis_type ? i18n.t.plans.prosthesisLabel : i18n.t.plans.bridgeLabel} ·
											{bridgeEntry.bridge_role === 'pontic' ? i18n.t.chart.pontic : i18n.t.plans.abutmentLabel}
										</span>
										<span class="text-[10px] text-violet-500 dark:text-violet-400 ml-auto">
											{i18n.t.plans.teethLabel} {bridgeMembers.map(m => toFDI(m.tooth_number)).join(', ')}
										</span>
									</div>
									<div class="flex gap-1.5">
										<button
											onclick={() => openExistingRestorationEditor(bridgeEntry.bridge_group_id!)}
											class="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors font-medium"
										>
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-2.5 w-2.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
											{i18n.t.plans.editStructure}
										</button>
										<button
											onclick={() => handleDissolveGroup(bridgeEntry.bridge_group_id!)}
											class="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border border-red-300/70 dark:border-red-800/60 text-destructive hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors font-medium"
										>
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-2.5 w-2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
											Entfernen
										</button>
									</div>
								</div>
							{/if}

							<!-- ── Planned steps: assigned (removable tags) ── -->
							{#if toothProcs.length > 0}
								<div class="flex flex-wrap gap-1.5 mb-2">
									{#each toothProcs as procKey}
										<span
											class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold text-white"
											style="background: {procColor(procKey)};"
										>
											{procLabel(procKey)}
											<button
												onclick={() => removeProcFromTooth(selectedTooth!, procKey)}
												class="opacity-60 hover:opacity-100 ml-0.5 leading-none font-bold"
												aria-label="Entfernen"
											>✕</button>
										</span>
									{/each}
								</div>
							{:else if !bridgeEntry?.bridge_group_id}
								<p class="text-[11px] text-muted-foreground/50 mb-2 italic">{i18n.t.plans.noStepPlanned}</p>
							{/if}

							<!-- ── Add more steps: compact color-coded abbreviation tiles ──
							     Visually distinct from the large palette above — small square tiles,
							     only shows unassigned procedures, clear "+" label context ── -->
							{#if unassigned.length > 0}
								<div class="flex items-center gap-1.5 flex-wrap">
									<span class="text-[10px] text-muted-foreground/50 shrink-0 mr-0.5">{i18n.t.plans.addStepLabel}</span>
									{#each unassigned as proc}
										<button
											onclick={() => toggleProcedureOnTooth(selectedTooth!, proc.key)}
											title={procLabel(proc.key)}
											class="h-6 w-6 rounded text-[9px] font-bold text-white transition-all hover:scale-110 hover:shadow-md shrink-0 flex items-center justify-center"
											style="background:{proc.color}; opacity:0.88;"
										>{proc.abbr}</button>
									{/each}
								</div>
							{/if}

							<!-- Per-tooth notes -->
							<textarea
								bind:value={selectedToothNote}
								placeholder={i18n.t.plans.toothNotesPlaceholder.replace('{n}', String(toFDI(selectedTooth)))}
								onblur={saveSelectedNote}
								rows="2"
								class="w-full mt-2.5 rounded border border-input bg-background px-2.5 py-1.5 text-xs resize-none outline-none focus:border-blue-400 transition-colors"
							></textarea>
						</div>
					{/if}

				</div>

				<!-- ── Right panel: steps checklist ── -->
				<div class="w-80 shrink-0 flex flex-col overflow-hidden bg-background border-l border-border/40">

					<!-- Progress bar header -->
					<div class="px-4 pt-3 pb-2.5 border-b border-border/40 shrink-0">
						<div class="flex items-center justify-between mb-1.5">
							<span class="text-xs font-semibold text-foreground">
								{completedCount} / {totalCount} {totalCount === 1 ? i18n.t.plans.stepSingular : i18n.t.plans.stepPlural}
							</span>
							<span class="text-xs font-semibold text-blue-600 dark:text-blue-400">{pct}%</span>
						</div>
						<div class="h-1.5 rounded-full bg-muted overflow-hidden">
							<div class="h-full rounded-full bg-blue-400 dark:bg-blue-500 transition-all duration-300" style="width:{pct}%"></div>
						</div>
					</div>

					<!-- Steps list: per-tooth grouped with completion ring -->
					<div use:scrollIndicator={{ zIndex: 55 }} class="flex-1 overflow-y-auto">
						{#if toothGroups.length === 0 && bridgeGroupSteps.length === 0 && manualSteps.length === 0}
							<div class="flex flex-col items-center justify-center h-32 gap-1.5 text-center px-4">
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="h-6 w-6 text-muted-foreground/30"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
								<p class="text-xs text-muted-foreground/60">{i18n.t.plans.planTooth}</p>
							</div>
						{:else}
							<ul class="py-1 divide-y divide-border/20">

								<!-- Per-tooth rows -->
								{#each toothGroups as group (group.tooth)}
									{@const allDone = group.doneCount === group.steps.length}
									{@const pctDone = group.steps.length > 0 ? group.doneCount / group.steps.length : 0}
									{@const r = 6}
									{@const circ = 2 * Math.PI * r}
									{@const ringColor = allDone ? '#22c55e' : pctDone > 0 ? '#f59e0b' : undefined}
									<li
										class="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/30 transition-colors group cursor-pointer {allDone ? 'opacity-50' : ''}"
										onclick={() => { toggleToothDone(group.tooth); }}
									>
										<!-- Completion ring -->
										<svg width="16" height="16" viewBox="0 0 16 16" class="shrink-0" aria-hidden="true">
											<circle cx="8" cy="8" r={r} fill="none" stroke="#e5e7eb" stroke-width="2" class="dark:stroke-zinc-700"/>
											{#if allDone}
												<circle cx="8" cy="8" r={r} fill="#22c55e"/>
												<polyline points="5,8 7,10 11,6" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
											{:else if pctDone > 0}
												<circle cx="8" cy="8" r={r} fill="none" stroke={ringColor} stroke-width="2"
													stroke-dasharray={circ} stroke-dashoffset={circ * (1 - pctDone)}
													stroke-linecap="round" transform="rotate(-90 8 8)"/>
											{/if}
										</svg>

										<!-- Tooth label — clicking selects it in chart -->
										<button
											onclick={(e) => { e.stopPropagation(); selectedTooth = selectedTooth === group.tooth ? null : group.tooth; }}
											class="text-xs font-mono font-bold shrink-0 w-7 text-center rounded px-0.5 py-px transition-colors {selectedTooth === group.tooth ? 'bg-blue-400/20 text-blue-700 dark:text-blue-300' : 'text-muted-foreground hover:text-foreground'}"
											title={i18n.t.plans.planTooth}
										>{toFDI(group.tooth)}</button>

										<!-- Procedure chips -->
										<div class="flex flex-wrap gap-1 flex-1 min-w-0">
											{#each group.steps as step (step.id)}
												<span
													class="inline-flex items-center rounded px-1.5 py-px text-[10px] font-semibold text-white leading-tight {step.done ? 'opacity-40' : ''}"
													style="background:{procColor(step.procKey)};"
													title="{procLabel(step.procKey)}"
												>{planProcedures.list.find(p => p.key === step.procKey)?.abbr ?? step.procKey.slice(0,2).toUpperCase()}</span>
											{/each}
										</div>

										<!-- Step count badge & delete -->
										<span class="text-[10px] text-muted-foreground/50 shrink-0 tabular-nums">{group.doneCount}/{group.steps.length}</span>
										<button
											onclick={(e) => { e.stopPropagation(); for (const s of group.steps) deleteStep(s.id); }}
											class="opacity-0 group-hover:opacity-100 shrink-0 h-4 w-4 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all flex items-center justify-center"
										>
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-2.5 w-2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
										</button>
									</li>
								{/each}

								<!-- Bridge / prosthesis group steps -->
								{#if bridgeGroupSteps.length > 0}
									<li class="px-3 py-1 border-t border-border/30">
										<span class="text-[10px] font-semibold uppercase tracking-widest text-violet-500/60">{i18n.t.plans.prosthetics}</span>
									</li>
									{#each bridgeGroupSteps as step (step.id)}
										{@const r = 6}
										{@const circ = 2 * Math.PI * r}
										<li class="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/30 transition-colors group {step.done ? 'opacity-50' : ''}">
											<svg width="16" height="16" viewBox="0 0 16 16" class="shrink-0 cursor-pointer" onclick={() => toggleStepDone(step.id)}>
												<circle cx="8" cy="8" r={r} fill="none" stroke="#e5e7eb" stroke-width="2" class="dark:stroke-zinc-700"/>
												{#if step.done}
													<circle cx="8" cy="8" r={r} fill="#22c55e"/>
													<polyline points="5,8 7,10 11,6" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
												{/if}
											</svg>
											<div class="flex-1 min-w-0">
												<span class="text-xs {step.done ? 'line-through text-muted-foreground' : 'font-medium text-foreground'}">{procLabel(step.procKey)}</span>
												<p class="text-[10px] text-muted-foreground/60 mt-px">{i18n.t.plans.teethLabel} {step.teeth.map(t => toFDI(t)).join(', ')}</p>
											</div>
											<button onclick={() => deleteStep(step.id)} class="opacity-0 group-hover:opacity-100 shrink-0 h-4 w-4 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all flex items-center justify-center">
												<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-2.5 w-2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
											</button>
										</li>
									{/each}
								{/if}

								<!-- Manual steps -->
								{#if manualSteps.length > 0}
									<li class="px-3 py-1 border-t border-border/30">
										<span class="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">{i18n.t.plans.manual}</span>
									</li>
									{#each manualSteps as step (step.id)}
										{@const r = 6}
										<li class="flex items-center gap-2.5 px-3 py-2 hover:bg-muted/30 transition-colors group {step.done ? 'opacity-50' : ''}">
											<svg width="16" height="16" viewBox="0 0 16 16" class="shrink-0 cursor-pointer" onclick={() => toggleStepDone(step.id)}>
												<circle cx="8" cy="8" r={r} fill="none" stroke="#e5e7eb" stroke-width="2" class="dark:stroke-zinc-700"/>
												{#if step.done}
													<circle cx="8" cy="8" r={r} fill="#22c55e"/>
													<polyline points="5,8 7,10 11,6" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
												{/if}
											</svg>
											<p class="flex-1 text-xs {step.done ? 'line-through text-muted-foreground' : 'text-foreground'}">{step.label ?? '—'}</p>
											<button onclick={() => deleteStep(step.id)} class="opacity-0 group-hover:opacity-100 shrink-0 h-4 w-4 rounded text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all flex items-center justify-center">
												<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-2.5 w-2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
											</button>
										</li>
									{/each}
								{/if}

							</ul>
						{/if}
					</div>

										<!-- Add manual step -->
					<div class="border-t border-border/40 px-3 py-2 shrink-0">
						{#if showManualStepForm}
							<div class="flex items-center gap-1.5">
								<input
									bind:value={manualStepLabel}
									placeholder={i18n.t.plans.stepPlaceholder}
									class="flex-1 rounded border border-input bg-background px-2 py-1 text-xs outline-none focus:border-ring"
									onkeydown={(e) => { if (e.key === 'Enter') addManualStep(); if (e.key === 'Escape') { showManualStepForm = false; manualStepLabel = ''; } }}
									autofocus
								/>
								<button onclick={addManualStep} disabled={!manualStepLabel.trim()} class="shrink-0 rounded bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white px-2 py-1 text-xs font-medium transition-colors">+</button>
								<button onclick={() => { showManualStepForm = false; manualStepLabel = ''; }} class="text-xs text-muted-foreground hover:text-foreground shrink-0">✕</button>
							</div>
						{:else}
							<button
								onclick={() => (showManualStepForm = true)}
								class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full py-0.5"
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3.5 w-3.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
								{i18n.t.plans.addManualStepButton}
							</button>
						{/if}
					</div>

				</div>
			</div>
		{/if}
	</DialogContent>
</Dialog>
