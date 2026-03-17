<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import {
		insertProbingRecord,
		getProbingRecords,
		upsertProbingMeasurement,
		getProbingMeasurements,
		upsertProbingToothData,
		getProbingToothData,
	} from '$lib/services/db';
	import { FDI_CHARTING_ORDER } from '$lib/utils';
	import type { ProbingRecord, ProbingToothData } from '$lib/types';
	import PerioSVGChart from './PerioSVGChart.svelte';
	import PerioDataEntryPanel from './PerioDataEntryPanel.svelte';
	import PerioSummaryBar from './PerioSummaryBar.svelte';
	import PerioComparisonView from './PerioComparisonView.svelte';
	import { i18n } from '$lib/i18n';

	let {
		open = $bindable(false),
		patientId,
		onRecordSaved,
	}: {
		open: boolean;
		patientId: string;
		onRecordSaved?: () => void;
	} = $props();

	// ── Record management ─────────────────────────────────────────────────
	let examDate = $state(new Date().toISOString().slice(0, 10));
	let examinerId = $state<number | null>(null);
	let notes = $state('');
	let currentRecord = $state<ProbingRecord | null>(null);
	let pastRecords = $state<ProbingRecord[]>([]);

	// ── Measurement data ──────────────────────────────────────────────────
	let pocketDepths = $state<Record<string, number | null>>({});
	let bopSites = $state<Record<string, boolean>>({});
	let recessions = $state<Record<string, number | null>>({});
	let plaqueSites = $state<Record<string, boolean>>({});
	let toothDataMap = $state<Record<number, ProbingToothData>>({});

	// ── Navigation ────────────────────────────────────────────────────────
	let selectedTooth = $state<number | null>(null);

	// ── Charting mode ─────────────────────────────────────────────────────
	let chartingMode = $state(false);
	let chartingIndex = $state(0);
	const chartingTooth = $derived(chartingMode ? FDI_CHARTING_ORDER[chartingIndex] : null);
	const chartingProgress = $derived(Math.round((chartingIndex / 32) * 100));

	// ── Comparison ────────────────────────────────────────────────────────
	let comparisonRecord = $state<ProbingRecord | null>(null);
	let comparisonDepths = $state<Record<string, number | null> | null>(null);
	let comparisonBop = $state<Record<string, boolean> | null>(null);
	let showComparison = $state(false);

	// ── Load on open ─────────────────────────────────────────────────────
	$effect(() => {
		if (open && patientId) {
			// Reset state for new session
			examDate = new Date().toISOString().slice(0, 10);
			examinerId = null;
			notes = '';
			currentRecord = null;
			pocketDepths = {};
			bopSites = {};
			recessions = {};
			plaqueSites = {};
			toothDataMap = {};
			selectedTooth = null;
			chartingMode = false;
			chartingIndex = 0;
			comparisonRecord = null;
			comparisonDepths = null;
			comparisonBop = null;
			showComparison = false;

			getProbingRecords(patientId).then((recs) => {
				pastRecords = recs;
			});
		}
	});

	// ── Ensure a record exists before saving data ─────────────────────────
	async function ensureRecord(): Promise<ProbingRecord> {
		if (!currentRecord) {
			const rec = await insertProbingRecord(patientId, {
				exam_date: examDate,
				examiner: examinerId ? String(examinerId) : '',
				notes,
			});
			currentRecord = rec;
		}
		return currentRecord;
	}

	// ── Data mutation handlers ────────────────────────────────────────────
	async function handlePdChange(tooth: number, site: string, value: number | null) {
		const key = `${tooth}_${site}`;
		pocketDepths[key] = value;
		const rec = await ensureRecord();
		await upsertProbingMeasurement(rec.id, tooth, site, { pocket_depth: value });
	}

	async function handleRecessionChange(tooth: number, site: string, value: number | null) {
		const key = `${tooth}_${site}`;
		recessions[key] = value;
		const rec = await ensureRecord();
		await upsertProbingMeasurement(rec.id, tooth, site, { recession: value });
	}

	async function handleBopToggle(tooth: number, site: string) {
		const key = `${tooth}_${site}`;
		bopSites[key] = !bopSites[key];
		const rec = await ensureRecord();
		await upsertProbingMeasurement(rec.id, tooth, site, {
			bleeding_on_probing: bopSites[key] ? 1 : 0,
		});
	}

	async function handlePlaqueToggle(tooth: number, site: string) {
		const key = `${tooth}_${site}`;
		plaqueSites[key] = !plaqueSites[key];
		const rec = await ensureRecord();
		await upsertProbingMeasurement(rec.id, tooth, site, {
			plaque: plaqueSites[key] ? 1 : 0,
		});
	}

	async function handleToothDataChange(tooth: number, data: Partial<ProbingToothData>) {
		if (!toothDataMap[tooth]) {
			toothDataMap[tooth] = {
				id: 0,
				record_id: 0,
				tooth_number: tooth,
				mobility: null,
				furcation: null,
				furcation_sites: '',
				notes: '',
			};
		}
		Object.assign(toothDataMap[tooth], data);
		const rec = await ensureRecord();
		await upsertProbingToothData(rec.id, tooth, data);
	}

	// ── Load a past record ────────────────────────────────────────────────
	async function loadRecord(rec: ProbingRecord) {
		currentRecord = rec;
		examDate = rec.exam_date;
		const [measurements, toothData] = await Promise.all([
			getProbingMeasurements(rec.id),
			getProbingToothData(rec.id),
		]);
		const newPd: Record<string, number | null> = {};
		const newBop: Record<string, boolean> = {};
		const newRec: Record<string, number | null> = {};
		const newPlaque: Record<string, boolean> = {};
		for (const m of measurements) {
			const key = `${m.tooth_number}_${m.site}`;
			newPd[key] = m.pocket_depth;
			newBop[key] = m.bleeding_on_probing === 1;
			newRec[key] = m.recession;
			newPlaque[key] = m.plaque === 1;
		}
		pocketDepths = newPd;
		bopSites = newBop;
		recessions = newRec;
		plaqueSites = newPlaque;
		const newToothMap: Record<number, ProbingToothData> = {};
		for (const td of toothData) {
			newToothMap[td.tooth_number] = td;
		}
		toothDataMap = newToothMap;
	}

	// ── Load a comparison record ──────────────────────────────────────────
	async function loadComparison(rec: ProbingRecord) {
		comparisonRecord = rec;
		const measurements = await getProbingMeasurements(rec.id);
		const cmpPd: Record<string, number | null> = {};
		const cmpBop: Record<string, boolean> = {};
		for (const m of measurements) {
			const key = `${m.tooth_number}_${m.site}`;
			cmpPd[key] = m.pocket_depth;
			cmpBop[key] = m.bleeding_on_probing === 1;
		}
		comparisonDepths = cmpPd;
		comparisonBop = cmpBop;
		showComparison = true;
	}

	// ── Charting mode ─────────────────────────────────────────────────────
	function startCharting() {
		chartingMode = true;
		chartingIndex = 0;
		selectedTooth = FDI_CHARTING_ORDER[0];
	}

	function stopCharting() {
		chartingMode = false;
		chartingIndex = 0;
	}

	function advanceTooth() {
		if (chartingMode) {
			if (chartingIndex < FDI_CHARTING_ORDER.length - 1) {
				chartingIndex += 1;
				selectedTooth = FDI_CHARTING_ORDER[chartingIndex];
			} else {
				stopCharting();
			}
		} else if (selectedTooth !== null) {
			const idx = FDI_CHARTING_ORDER.indexOf(selectedTooth);
			if (idx >= 0 && idx < FDI_CHARTING_ORDER.length - 1) {
				selectedTooth = FDI_CHARTING_ORDER[idx + 1];
			}
		}
	}

	function goBackTooth() {
		if (chartingMode) {
			if (chartingIndex > 0) {
				chartingIndex -= 1;
				selectedTooth = FDI_CHARTING_ORDER[chartingIndex];
			}
		} else if (selectedTooth !== null) {
			const idx = FDI_CHARTING_ORDER.indexOf(selectedTooth);
			if (idx > 0) {
				selectedTooth = FDI_CHARTING_ORDER[idx - 1];
			}
		}
	}

	function handleToothSelect(tooth: number) {
		selectedTooth = tooth;
		if (chartingMode) {
			const idx = FDI_CHARTING_ORDER.indexOf(tooth);
			if (idx >= 0) chartingIndex = idx;
		}
	}

	// ── Keyboard navigation ───────────────────────────────────────────────
	function handleKeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement).tagName;
		const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

		if (isInput) {
			// Only intercept Enter on DL input to advance tooth
			if (e.key === 'Enter' && !e.shiftKey) {
				const input = e.target as HTMLInputElement;
				if (input.name === 'pd_DL' || input.getAttribute('data-site') === 'DL') {
					e.preventDefault();
					advanceTooth();
				}
			}
			return;
		}

		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			advanceTooth();
		} else if (e.key === 'Enter' && e.shiftKey) {
			e.preventDefault();
			goBackTooth();
		} else if (e.key === 'Escape') {
			if (chartingMode) {
				stopCharting();
			} else if (selectedTooth !== null) {
				selectedTooth = null;
			}
		}
	}

	// ── Save & close ──────────────────────────────────────────────────────
	function handleClose() {
		onRecordSaved?.();
		open = false;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<Dialog bind:open>
	<DialogContent
		class="max-w-[1200px] sm:max-w-[1200px] max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0"
		onkeydown={handleKeydown}
	>
		<!-- ── Header ─────────────────────────────────────────────────────── -->
		<div class="shrink-0 px-4 py-3 border-b">
			<DialogHeader class="mb-0">
				<DialogTitle class="text-base">{i18n.t.perio.title}</DialogTitle>
			</DialogHeader>
		</div>

		<!-- ── Toolbar ────────────────────────────────────────────────────── -->
		<div class="shrink-0 px-4 py-2 border-b bg-muted/20 flex flex-wrap items-center gap-2">
			<!-- Date -->
			<div class="flex items-center gap-1.5">
				<label class="text-xs text-muted-foreground" for="perio-date">{i18n.t.common.date}:</label>
				<input
					id="perio-date"
					type="date"
					bind:value={examDate}
					class="h-7 rounded border border-border bg-background px-2 text-xs"
				/>
			</div>

			<!-- Examiner -->
			<div class="flex items-center gap-1.5">
				<label class="text-xs text-muted-foreground" for="perio-examiner">{i18n.t.perio.examiner}:</label>
				<select
					id="perio-examiner"
					bind:value={examinerId}
					class="h-7 rounded border border-border bg-background px-2 text-xs"
				>
					<option value={null}>—</option>
					{#each doctors.list as doc}
						<option value={doc.id}>{staffLabel(doc)}</option>
					{/each}
				</select>
			</div>

			<!-- Load past record -->
			{#if pastRecords.length > 0}
				<div class="flex items-center gap-1.5">
					<label class="text-xs text-muted-foreground" for="perio-past">{i18n.t.perio.loadPast}:</label>
					<select
						id="perio-past"
						class="h-7 rounded border border-border bg-background px-2 text-xs"
						onchange={async (e) => {
							const id = parseInt((e.target as HTMLSelectElement).value);
							if (isNaN(id)) return;
							const rec = pastRecords.find((r) => r.id === id);
							if (rec) await loadRecord(rec);
						}}
					>
						<option value="">Select past…</option>
						{#each pastRecords as rec}
							<option value={rec.id}>{rec.exam_date}</option>
						{/each}
					</select>
				</div>

				<!-- Compare toggle -->
				{#if pastRecords.length > 1 || (currentRecord && pastRecords.length > 0)}
					<div class="flex items-center gap-1.5">
						<label class="text-xs text-muted-foreground" for="perio-compare">{i18n.t.perio.compare}:</label>
						<select
							id="perio-compare"
							class="h-7 rounded border border-border bg-background px-2 text-xs"
							onchange={async (e) => {
								const id = parseInt((e.target as HTMLSelectElement).value);
								if (isNaN(id)) {
									showComparison = false;
									comparisonDepths = null;
									comparisonBop = null;
									return;
								}
								const rec = pastRecords.find((r) => r.id === id);
								if (rec) await loadComparison(rec);
							}}
						>
							<option value="">Off</option>
							{#each pastRecords as rec}
								{#if rec.id !== currentRecord?.id}
									<option value={rec.id}>{rec.exam_date}</option>
								{/if}
							{/each}
						</select>
					</div>
				{/if}
			{/if}

			<!-- Charting mode controls -->
			{#if !chartingMode}
				<button
					onclick={startCharting}
					class="h-7 rounded-md border border-primary/40 bg-primary/10 text-primary px-3 text-xs hover:bg-primary/20 transition-colors"
				>
					▶ {i18n.t.perio.startCharting}
				</button>
			{:else}
				<div class="flex items-center gap-2 flex-1">
					<div class="flex items-center gap-1.5 flex-1 max-w-[200px]">
						<div class="flex-1 h-2 rounded-full bg-muted overflow-hidden">
							<div
								class="h-full bg-primary rounded-full transition-[width] duration-300 ease-in-out"
								style="width: {chartingProgress}%"
							></div>
						</div>
						<span class="text-xs text-muted-foreground tabular-nums">{chartingIndex}/32</span>
					</div>
					<button
						onclick={stopCharting}
						class="h-7 rounded-md border px-3 text-xs hover:bg-muted transition-colors"
					>
						✓ {i18n.t.actions.done}
					</button>
				</div>
			{/if}

			<!-- Save & Close -->
			<div class="ml-auto">
				<button
					onclick={handleClose}
					class="h-7 rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
				>
					{i18n.t.perio.saveClose}
				</button>
			</div>
		</div>

		<!-- ── Main content — two-column layout ──────────────────────────── -->
		<div class="flex flex-1 min-h-0 overflow-hidden">
			<!-- Left: SVG chart -->
			<div class="overflow-y-auto overflow-x-auto" style="flex: 62 1 0; min-width: 0; padding: 12px 8px 8px;">
				<PerioSVGChart
					{pocketDepths}
					{bopSites}
					{recessions}
					{plaqueSites}
					{selectedTooth}
					chartingTooth={chartingMode ? chartingTooth : null}
					comparisonDepths={showComparison ? comparisonDepths : null}
					onToothSelect={handleToothSelect}
				/>
			</div>

			<!-- Divider -->
			<div class="w-px bg-border shrink-0"></div>

			<!-- Right: Data entry panel -->
			<div class="overflow-y-auto" style="flex: 38 1 0; min-width: 280px;">
				<PerioDataEntryPanel
					toothNumber={selectedTooth}
					{pocketDepths}
					{bopSites}
					{recessions}
					{plaqueSites}
					toothData={selectedTooth !== null ? (toothDataMap[selectedTooth] ?? null) : null}
					onPdChange={handlePdChange}
					onRecessionChange={handleRecessionChange}
					onBopToggle={handleBopToggle}
					onPlaqueToggle={handlePlaqueToggle}
					onToothDataChange={handleToothDataChange}
					onAdvance={advanceTooth}
					onBack={goBackTooth}
					onClose={() => { selectedTooth = null; }}
					onStartCharting={startCharting}
				/>
			</div>
		</div>

		<!-- ── Comparison view (above summary) ───────────────────────────── -->
		{#if showComparison && comparisonDepths !== null && comparisonBop !== null}
			<PerioComparisonView
				currentDepths={pocketDepths}
				{comparisonDepths}
				currentBop={bopSites}
				{comparisonBop}
			/>
		{/if}

		<!-- ── Summary bar ────────────────────────────────────────────────── -->
		<PerioSummaryBar {pocketDepths} {bopSites} />
	</DialogContent>
</Dialog>
