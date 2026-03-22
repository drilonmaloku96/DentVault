<script lang="ts">
	import { onMount } from 'svelte';
	import type { ToothChartEntry } from '$lib/types';
	import {
		getChartData,
		upsertToothChartEntry,
		getBridgeGroup,
	} from '$lib/services/db';
	import ToothChart from './ToothChart.svelte';
	import ToothDetailPanel from './ToothDetailPanel.svelte';
	import RestorationEditorPanel from './RestorationEditorPanel.svelte';
	import type { BridgeRole, ProsthesisRole, AbutmentType, RestorationType, RestorationResult } from './RestorationEditorPanel.svelte';
	import { i18n } from '$lib/i18n';
	import { generateChartReport } from '$lib/services/chart-report';
	import { dentalTags } from '$lib/stores/dentalTags.svelte';
	import { prosthesisTypes } from '$lib/stores/prosthesisTypes.svelte';
	import { bridgeRoles } from '$lib/stores/bridgeRoles.svelte';
	import { getNextTooth, getPrevTooth, FDI_CHARTING_ORDER, toFDI } from '$lib/utils';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';

	let {
		patientId,
		snapshotData = undefined,
		snapshotDescription = '',
		onToothSaved = undefined,
		snapshotEditMode = false,
		onSnapshotSave = undefined,
	}: {
		patientId: string;
		snapshotData?: ToothChartEntry[];
		snapshotDescription?: string;
		onToothSaved?: () => void;
		snapshotEditMode?: boolean;
		onSnapshotSave?: (data: ToothChartEntry[]) => void;
	} = $props();

	const isSnapshotMode   = $derived(snapshotData !== undefined);
	const isSnapshotReadOnly = $derived(isSnapshotMode && !snapshotEditMode);

	let chartData     = $state<ToothChartEntry[]>([]);

	// Use provided description, or generate on the fly from chart data (for old snapshots without description)
	const effectiveSnapshotReport = $derived(
		snapshotDescription || (isSnapshotMode && chartData.length > 0 ? generateChartReport(chartData) : '')
	);
	let isLoading     = $state(true);
	let selectedTooth   = $state<number | null>(null);
	let selectedSurface = $state<string | null>(null);
	// Shortcut key passed down to ToothDetailPanel; seq increments so repeated same-key presses still fire
	let shortcutTagKey  = $state<{ key: string; seq: number } | null>(null);
	let _shortcutSeq    = 0;
	let selectedEntry   = $derived(
		chartData.find(e => e.tooth_number === selectedTooth) ?? null
	);

	// Reset selected surface when tooth changes
	$effect(() => {
		const _ = selectedTooth;
		selectedSurface = null;
	});

	// ── Keyboard navigation ────────────────────────────────────────────
	$effect(() => {
		function onKeydown(e: KeyboardEvent) {
			const target = e.target as HTMLElement;
			if (
				target.tagName === 'INPUT' ||
				target.tagName === 'TEXTAREA' ||
				target.tagName === 'SELECT' ||
				target.isContentEditable
			) return;

			if (e.key === 'Enter' && selectedTooth !== null) {
				e.preventDefault();
				if (chartingMode) {
					if (e.shiftKey) chartingBack();
					else chartingAdvance();
				} else {
					const next = e.shiftKey ? getPrevTooth(selectedTooth) : getNextTooth(selectedTooth);
					if (next !== null) { selectedTooth = next; selectedSurface = null; }
				}
				return;
			}

			if (e.key === 'Escape') {
				if (restorationEditTeeth !== null) { cancelRestorationEdit(); return; }
				if (shiftSelectedTeeth.length > 0) { shiftSelectedTeeth = []; return; }
				if (chartingMode) { exitCharting(); }
				else { shortcutTagKey = null; selectedTooth = null; selectedSurface = null; }
				return;
			}

			// Tag shortcut keys — forward to the detail panel via prop
			if (selectedTooth !== null && e.key.length === 1) {
				const tag = dentalTags.list.find(t => t.shortcut?.toLowerCase() === e.key.toLowerCase());
				if (tag) {
					e.preventDefault();
					shortcutTagKey = { key: tag.key, seq: ++_shortcutSeq };
				}
			}
		}

		function onKeyup(e: KeyboardEvent) {
			if (e.key === 'Shift' && shiftSelectedTeeth.length >= 1 && !isSnapshotReadOnly) {
				openNewRestorationEditor([...shiftSelectedTeeth]);
			}
		}

		document.addEventListener('keydown', onKeydown);
		document.addEventListener('keyup', onKeyup);
		return () => {
			document.removeEventListener('keydown', onKeydown);
			document.removeEventListener('keyup', onKeyup);
		};
	});

	// ── Bridge / Prosthesis workflow ─────────────────────────────────
	let restorationEditTeeth = $state<number[] | null>(null);
	let shiftSelectedTeeth = $state<number[]>([]);
	let hintMessage = $state<string | null>(null);
	let chartWasModified = $state(false);
	let _hintTimer: ReturnType<typeof setTimeout> | null = null;

	// Expand/modify mode
	let expandingGroupId = $state<string | null>(null);
	let expandingInitialMode = $state<RestorationType | undefined>(undefined);
	let expandingInitialBridgeRoles = $state<Map<number, BridgeRole> | undefined>(undefined);
	let expandingInitialProsthesisRoles = $state<Map<number, { prosthesis_type: ProsthesisRole; abutment_type: AbutmentType }> | undefined>(undefined);

	function showHint(msg: string) {
		if (_hintTimer) clearTimeout(_hintTimer);
		hintMessage = msg;
		_hintTimer = setTimeout(() => { hintMessage = null; }, 2000);
	}

	// ── Contiguity check ──────────────────────────────────────────────
	function areTeethContiguous(teeth: number[]): boolean {
		if (teeth.length <= 1) return true;
		const upperRow = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16];
		const lowerRow = [32,31,30,29,28,27,26,25,24,23,22,21,20,19,18,17];
		const row = teeth.every(t => upperRow.includes(t)) ? upperRow :
		            teeth.every(t => lowerRow.includes(t)) ? lowerRow : null;
		if (!row) return false;
		const slots = teeth.map(t => row.indexOf(t)).sort((a, b) => a - b);
		for (let i = 1; i < slots.length; i++) {
			if (slots[i] !== slots[i - 1] + 1) return false;
		}
		return true;
	}

	// ── Cancel restoration edit ────────────────────────────────────────
	function cancelRestorationEdit() {
		restorationEditTeeth = null;
		shiftSelectedTeeth = [];
		clearExpandState();
		selectedTooth = null;
	}

	// ── Open new restoration editor ────────────────────────────────────
	function openNewRestorationEditor(teeth: number[]) {
		const contiguous = areTeethContiguous(teeth);
		expandingGroupId = null;
		expandingInitialMode = contiguous ? 'bridge' : 'prosthesis';
		expandingInitialBridgeRoles = undefined;
		expandingInitialProsthesisRoles = undefined;
		shiftSelectedTeeth = [...teeth];
		restorationEditTeeth = [...teeth];
		selectedTooth = null;
	}

	// ── Open existing restoration editor ──────────────────────────────
	async function openExistingRestorationEditor(toothNum: number) {
		if (isSnapshotReadOnly) return;
		const entry = chartData.find(e => e.tooth_number === toothNum);
		if (!entry?.bridge_group_id) return;
		const groupId = entry.bridge_group_id;
		const members = await getBridgeGroup(patientId, groupId);
		// A group is a prosthesis if any member has prosthesis_type set (works for old+new data)
		const isBridge = !members.some(m => m.prosthesis_type != null);
		expandingGroupId = groupId;
		expandingInitialMode = isBridge ? 'bridge' : 'prosthesis';
		const bm = new Map<number, BridgeRole>();
		const pm = new Map<number, { prosthesis_type: ProsthesisRole; abutment_type: AbutmentType }>();
		for (const m of members) {
			// condition='implant' is the new canonical form; abutment_type='implant' is legacy
			const isImplant = m.condition === 'implant' || m.abutment_type === 'implant';
			if (m.bridge_role === 'pontic') bm.set(m.tooth_number, 'pontic');
			else if (isImplant) bm.set(m.tooth_number, 'implant');
			else bm.set(m.tooth_number, 'tooth');
			if (m.prosthesis_type) {
				pm.set(m.tooth_number, {
					prosthesis_type: m.prosthesis_type as ProsthesisRole,
					abutment_type: isImplant ? 'implant' : 'tooth',
				});
			}
		}
		expandingInitialBridgeRoles = bm;
		expandingInitialProsthesisRoles = pm;
		shiftSelectedTeeth = members.map(m => m.tooth_number);
		restorationEditTeeth = [...shiftSelectedTeeth];
		selectedTooth = null;
	}

	function clearExpandState() {
		expandingGroupId = null;
		expandingInitialMode = undefined;
		expandingInitialBridgeRoles = undefined;
		expandingInitialProsthesisRoles = undefined;
	}

	async function handleBridgeRangeSelected(teeth: number[]) {
		if (isSnapshotReadOnly) return;
		openNewRestorationEditor(teeth);
	}

	async function handleRestorationConfirm(result: RestorationResult) {
		if (!restorationEditTeeth) return;
		const groupId = expandingGroupId ?? crypto.randomUUID();
		// If expanding: reset any old group members that were removed from the new set
		if (expandingGroupId) {
			const oldMembers = await getBridgeGroup(patientId, expandingGroupId);
			for (const m of oldMembers) {
				if (!restorationEditTeeth.includes(m.tooth_number)) {
					await upsertToothChartEntry(patientId, m.tooth_number, {
						condition: 'healthy',
						bridge_group_id: null,
						bridge_role: null,
						prosthesis_type: null,
					});
				}
			}
		}
		if (result.type === 'bridge') {
			for (const tooth of restorationEditTeeth) {
				const isPontic  = result.ponticTeeth.includes(tooth);
				const isImplant = result.implantAbutments.includes(tooth);
				await upsertToothChartEntry(patientId, tooth, {
					// Implant abutments keep condition='implant' — the canonical source of truth
					condition: isImplant ? 'implant' : 'bridge',
					bridge_group_id: groupId,
					bridge_role: isPontic ? 'pontic' : 'abutment',
					abutment_type: null,
					prosthesis_type: null,
				});
			}
		} else {
			for (const tooth of restorationEditTeeth) {
				const role = result.prosthesisRoles.get(tooth);
				if (!role) continue;
				const isReplaced      = role.prosthesis_type === 'replaced';
				const isImplantAnchor = !isReplaced && role.abutment_type === 'implant';
				await upsertToothChartEntry(patientId, tooth, {
					// Implant anchors keep condition='implant'; everything else is 'prosthesis'
					condition: isImplantAnchor ? 'implant' : 'prosthesis',
					bridge_group_id: groupId,
					bridge_role: isReplaced ? 'pontic' : 'abutment',
					abutment_type: null,
					prosthesis_type: role.prosthesis_type,
				});
			}
		}
		chartData = await getChartData(patientId);
		onToothSaved?.();
		chartWasModified = true;
		cancelRestorationEdit();
	}

	async function handleDissolveGroup(bridgeGroupId: string) {
		const members = await getBridgeGroup(patientId, bridgeGroupId);
		for (const member of members) {
			await upsertToothChartEntry(patientId, member.tooth_number, {
				condition: 'healthy',
				bridge_group_id: null,
				bridge_role: null,
				prosthesis_type: null,
			});
		}
		chartData = await getChartData(patientId);
		onToothSaved?.();
	}

	// ── Charting mode ──────────────────────────────────────────────────
	let chartingMode  = $state(false);
	let chartingIndex = $state(0);
	const chartingDone = $derived(chartingIndex >= FDI_CHARTING_ORDER.length);

	function startCharting() {
		shortcutTagKey  = null;
		chartingMode    = true;
		chartingIndex   = 0;
		selectedTooth   = FDI_CHARTING_ORDER[0];
		selectedSurface = null;
	}

	function exitCharting() {
		chartingMode = false;
	}

	function chartingAdvance() {
		if (chartingDone) { exitCharting(); return; }
		const next = chartingIndex + 1;
		chartingIndex = next;
		if (next >= FDI_CHARTING_ORDER.length) {
			exitCharting();
		} else {
			selectedTooth   = FDI_CHARTING_ORDER[next];
			selectedSurface = null;
		}
	}

	function chartingBack() {
		if (chartingIndex <= 0) return;
		chartingIndex -= 1;
		selectedTooth   = FDI_CHARTING_ORDER[chartingIndex];
		selectedSurface = null;
	}

	onMount(async () => {
		if (snapshotData !== undefined) {
			await Promise.all([dentalTags.load(), prosthesisTypes.load(), bridgeRoles.load()]);
			chartData = snapshotData;
			isLoading = false;
			return;
		}
		const [chart] = await Promise.all([
			getChartData(patientId),
			dentalTags.load(),
			prosthesisTypes.load(),
			bridgeRoles.load(),
		]);
		chartData = chart;
		isLoading = false;
	});

	async function handleToothSave(
		toothNumber: number,
		data: { condition: string; notes: string; last_examined: string; surfaces: string },
	) {
		if (isSnapshotMode && snapshotEditMode) {
			const idx = chartData.findIndex(t => t.tooth_number === toothNumber);
			const now = new Date().toISOString();
			if (idx >= 0) {
				chartData[idx] = { ...chartData[idx], ...data, updated_at: now };
			} else {
				chartData = [...chartData, {
					id: toothNumber, patient_id: patientId, tooth_number: toothNumber,
					bridge_group_id: null, bridge_role: null, abutment_type: null, prosthesis_type: null, updated_at: now, ...data,
				}];
			}
			onSnapshotSave?.(chartData);
		} else {
			await upsertToothChartEntry(patientId, toothNumber, data);
			chartData = await getChartData(patientId);
			onToothSaved?.();
		}
	}

</script>

{#if isLoading}
	<div class="h-48 animate-pulse rounded-lg border bg-muted"></div>
{:else if isSnapshotReadOnly}
	<!-- ── Read-only snapshot: chart + text report below ── -->
	<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
		<div class="flex items-center gap-2 rounded-md bg-muted/60 border border-border/50 px-3 py-2">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-muted-foreground/70 shrink-0">
				<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
				<path d="M7 11V7a5 5 0 0 1 10 0v4"/>
			</svg>
			<p class="text-xs text-muted-foreground">{i18n.t.chart.snapshotReport.readOnly}</p>
		</div>
		<Separator />
		<ToothChart
			{chartData}
			selectedTooth={null}
			selectedSurface={null}
			onToothClick={() => {}}
		/>
		{#if effectiveSnapshotReport}
			<Separator />
			<div class="flex flex-col gap-2">
				<h4 class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{i18n.t.chart.snapshotReport.reportTitle}</h4>
				<div class="text-[12px] text-foreground/80 whitespace-pre-line leading-relaxed">
					{effectiveSnapshotReport}
				</div>
			</div>
		{/if}
	</div>
{:else}
	<!-- ── Two-column layout: chart (left) + detail panel (right) ── -->
	<div class="flex gap-0 min-h-[520px] h-full">

		<!-- Left column: chart (~62%) -->
		<div class="flex flex-col gap-3 pr-5 border-r border-border" style="flex:62 1 0; min-width:0">

			{#if chartingMode}
				<!-- ── Charting mode progress bar ── -->
				<div class="flex flex-col gap-1.5">
					<div class="flex items-center justify-between gap-3">
						<div class="flex items-center gap-2">
							<button
								onclick={chartingBack}
								disabled={chartingIndex === 0}
								class="rounded p-1 text-muted-foreground hover:bg-muted transition-colors disabled:opacity-30"
								aria-label="Vorheriger Zahn"
								title="Vorheriger Zahn (Shift+Enter)"
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
									<path d="M15 18l-6-6 6-6"/>
								</svg>
							</button>
							<span class="text-xs font-semibold text-foreground">
								Charting — Zahn {chartingIndex + 1}/32
								{#if selectedTooth !== null}
									<span class="text-muted-foreground font-normal">(FDI {toFDI(selectedTooth)})</span>
								{/if}
							</span>
						</div>
						<Button size="sm" variant="outline" onclick={exitCharting} class="h-7 text-xs px-2">
							Fertig
						</Button>
					</div>
					<!-- Progress bar -->
					<div class="h-1.5 rounded-full bg-muted overflow-hidden">
						<div
							class="h-full rounded-full bg-primary transition-all duration-200"
							style="width:{Math.round((chartingIndex / FDI_CHARTING_ORDER.length) * 100)}%"
						></div>
					</div>
				</div>
			{:else}
				<!-- ── Normal header ── -->
				<div class="flex items-center justify-between gap-4">
					<div>
						{#if isSnapshotMode}
							<div class="flex items-center gap-1.5 mb-1">
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 text-amber-500 shrink-0">
									<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
								</svg>
								<span class="text-xs font-medium text-amber-600 dark:text-amber-400">Editing snapshot</span>
							</div>
						{/if}
						<h3 class="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
							Dental Chart
						</h3>
					</div>
					<div class="flex items-center gap-2">
						{#if !isSnapshotMode}
							<Button size="sm" variant="outline" onclick={startCharting}>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
									<polygon points="5 3 19 12 5 21 5 3"/>
								</svg>
								Charting starten
							</Button>
						{/if}
					</div>
				</div>
			{/if}

			<div class="relative">
			<ToothChart
				{chartData}
				{selectedTooth}
				{selectedSurface}
				chartingTooth={chartingMode ? selectedTooth : null}
				{shiftSelectedTeeth}
				onToothClick={async (n, shiftHeld) => {
					if (shiftHeld && !isSnapshotReadOnly) {
						// Shift+click: toggle in multi-select, enforce same arch
						const isUpper = n <= 16;
						if (shiftSelectedTeeth.length > 0) {
							const existingIsUpper = shiftSelectedTeeth[0] <= 16;
							if (isUpper !== existingIsUpper) {
								showHint('Nur Zähne im selben Kiefer auswählbar');
								return;
							}
						}
						const idx = shiftSelectedTeeth.indexOf(n);
						if (idx >= 0) {
							shiftSelectedTeeth = shiftSelectedTeeth.filter(t => t !== n);
						} else {
							shiftSelectedTeeth = [...shiftSelectedTeeth, n];
						}
						return;
					}
					// Normal click
					shiftSelectedTeeth = [];
					const clickedEntry = chartData.find(e => e.tooth_number === n);
					if (clickedEntry?.bridge_group_id && !isSnapshotReadOnly) {
						await openExistingRestorationEditor(n);
						return;
					}
					// Cancel any open restoration editor
					if (restorationEditTeeth !== null) {
						cancelRestorationEdit();
					}
					if (chartingMode) {
						const idx = FDI_CHARTING_ORDER.indexOf(n);
						if (idx !== -1) chartingIndex = idx;
					}
					selectedTooth = n;
					selectedSurface = null;
				}}
				onBridgeRangeSelected={!isSnapshotReadOnly ? handleBridgeRangeSelected : undefined}
			/>
			<!-- Hint message -->
			{#if hintMessage}
				<div class="absolute top-2 left-1/2 -translate-x-1/2 z-30 rounded-full bg-amber-100 border border-amber-300 text-amber-800 px-4 py-1.5 text-xs font-medium shadow-sm">
					{hintMessage}
				</div>
			{/if}
			</div>
		</div>

		<!-- Right column: restoration editor, tooth detail, or placeholder (~38%) -->
		<div class="flex flex-col pl-5 overflow-y-auto" style="flex:38 1 0; min-width:0">
			{#if restorationEditTeeth !== null}
				<RestorationEditorPanel
					teeth={restorationEditTeeth}
					onConfirm={handleRestorationConfirm}
					onCancel={cancelRestorationEdit}
					isExpand={expandingGroupId !== null}
					initialMode={expandingInitialMode}
					initialBridgeRoles={expandingInitialBridgeRoles}
					initialProsthesisRoles={expandingInitialProsthesisRoles}
				/>
			{:else if selectedTooth !== null}
				<ToothDetailPanel
					toothNumber={selectedTooth}
					{patientId}
					entry={selectedEntry}
					{selectedSurface}
					{shortcutTagKey}
					onSave={handleToothSave}
					onClose={() => { shortcutTagKey = null; selectedTooth = null; selectedSurface = null; }}
					onDissolveBridge={!isSnapshotReadOnly ? handleDissolveGroup : undefined}
				/>
			{:else}
				<!-- Placeholder + Clinical Exams -->
				<div class="flex flex-col gap-5">
					<div class="flex flex-col items-center justify-center gap-2 py-8 text-center">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-8 w-8 text-muted-foreground/30">
							<path d="M12 2c-1.5 0-3 .5-4 1.5C6.5 5 6 7 6 9c0 3 1 6 2 9 .5 1.5 1 2 2 2h4c1 0 1.5-.5 2-2 1-3 2-6 2-9 0-2-.5-4-2-5.5C15 2.5 13.5 2 12 2z"/>
						</svg>
						<p class="text-sm text-muted-foreground">Zahn anklicken zum Bearbeiten</p>
						<p class="text-xs text-muted-foreground/60">Click any tooth in the chart to view and edit its details.</p>
					</div>

				</div>
			{/if}
		</div>
	</div>
{/if}

