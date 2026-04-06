<script lang="ts">
	import { untrack } from 'svelte';
	import { i18n } from '$lib/i18n';
	import { toFDI, FDI_TOOTH_NAMES } from '$lib/utils';
	import { getEndoRecords, saveEndoRecord, deleteEndoRecord } from '$lib/services/db';
	import { endoInstruments } from '$lib/stores/endoInstruments.svelte';
	import type { EndoRecord, EndoCanal } from '$lib/types';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Separator } from '$lib/components/ui/separator';

	// ── Props ───────────────────────────────────────────────────────────
	let {
		open,
		toothNumber,
		patientId,
		toothCanals,
		onClose,
	}: {
		open: boolean;
		toothNumber: number;
		patientId: string;
		toothCanals: string[];
		onClose: () => void;
	} = $props();

	// ── Derived display values ──────────────────────────────────────────
	const fdiNumber  = $derived(toFDI(toothNumber));
	const toothLabel = $derived(FDI_TOOTH_NAMES[fdiNumber] ?? `Zahn ${fdiNumber}`);

	// ── Data state ──────────────────────────────────────────────────────
	let records         = $state<EndoRecord[]>([]);
	let isLoading       = $state(false);
	let isSaving        = $state(false);
	let deleteConfirmId = $state<number | null>(null); // record id pending delete confirm

	// ── Selection state ─────────────────────────────────────────────────
	// null → "new session" mode
	let selectedRecordId = $state<number | null>(null);

	// ── Draft state ─────────────────────────────────────────────────────
	let draftDate  = $state('');
	let draftNotes = $state('');
	let draftCanals = $state<EndoCanal[]>([]);

	// Tracks which canal indices were pre-populated from `toothCanals` prop
	// (used to prevent deleting the base canals)
	let baseCanalsCount = $state(0);

	function todayStr(): string {
		return new Date().toISOString().slice(0, 10);
	}

	function makeBaseCanals(): EndoCanal[] {
		return toothCanals.map((name) => ({
			canal_name:          name,
			instrument:          '',
			iso_size:            null,
			length_xray:         null,
			length_preparation:  null,
			length_electronic:   null,
			reference_point:     '',
			definitive_length:   null,
		}));
	}

	function resetToNewSession() {
		selectedRecordId = null;
		draftDate  = todayStr();
		draftNotes = '';
		draftCanals = makeBaseCanals();
		baseCanalsCount = toothCanals.length;
		deleteConfirmId = null;
	}

	function loadRecord(record: EndoRecord) {
		selectedRecordId = record.id ?? null;
		draftDate  = record.treatment_date;
		draftNotes = record.notes;
		// Deep-copy canals so we don't mutate the store
		draftCanals = record.canals.map((c) => ({ ...c }));
		// All canals from a saved record are treated as base (non-deletable)
		// except any that go beyond the initial toothCanals names
		baseCanalsCount = Math.min(record.canals.length, toothCanals.length);
		deleteConfirmId = null;
	}

	async function loadRecords() {
		isLoading = true;
		try {
			records = await getEndoRecords(patientId, toothNumber);
		} finally {
			isLoading = false;
		}
		// After load: select the most recent, or stay in new-session mode
		if (records.length > 0 && selectedRecordId === null) {
			// Only auto-select on first open
			loadRecord(records[0]);
		} else if (selectedRecordId !== null) {
			// Re-sync draft with reloaded data (e.g. after save)
			const refreshed = records.find((r) => r.id === selectedRecordId);
			if (refreshed) loadRecord(refreshed);
		}
	}

	// ── Load instruments on mount ───────────────────────────────────────
	$effect(() => {
		if (!endoInstruments.loaded) {
			endoInstruments.load();
		}
	});

	// ── Load records when dialog opens ─────────────────────────────────
	$effect(() => {
		if (open) {
			// Reset selection on fresh open so we auto-select most recent
			untrack(() => {
				selectedRecordId = null;
				resetToNewSession();
			});
			loadRecords();
		}
	});

	// ── Canal helpers ───────────────────────────────────────────────────
	function addCanal() {
		draftCanals.push({
			canal_name:         '',
			instrument:         '',
			iso_size:           null,
			length_xray:        null,
			length_preparation: null,
			length_electronic:  null,
			reference_point:    '',
			definitive_length:  null,
		});
	}

	function removeCanal(index: number) {
		draftCanals.splice(index, 1);
	}

	// Suggest definitive length as xray - 0.5 if not already set
	function suggestDefLength(index: number) {
		const canal = draftCanals[index];
		if (canal.definitive_length === null && canal.length_xray !== null) {
			canal.definitive_length = Math.round((canal.length_xray - 0.5) * 10) / 10;
		}
	}

	// ── Save ────────────────────────────────────────────────────────────
	async function handleSave() {
		if (!draftDate) return;
		isSaving = true;
		try {
			const id = await saveEndoRecord(
				patientId,
				toothNumber,
				draftDate,
				draftNotes,
				draftCanals,
				selectedRecordId ?? undefined,
			);
			selectedRecordId = id;
			await loadRecords();
		} finally {
			isSaving = false;
		}
	}

	// ── Delete ──────────────────────────────────────────────────────────
	function requestDelete(id: number) {
		deleteConfirmId = id;
	}

	async function confirmDelete() {
		if (deleteConfirmId === null) return;
		const id = deleteConfirmId;
		deleteConfirmId = null;
		await deleteEndoRecord(id);
		// Clear selection first so loadRecords auto-selects most recent
		selectedRecordId = null;
		await loadRecords();
		if (records.length === 0) {
			resetToNewSession();
		}
	}

	function cancelDelete() {
		deleteConfirmId = null;
	}

	// ── Session summary line for history list ───────────────────────────
	function sessionSummary(record: EndoRecord): string {
		if (record.canals.length === 0) return '—';
		return record.canals
			.map((c) => {
				const instrument = c.instrument ? c.instrument : null;
				const defLen = c.definitive_length !== null ? `${c.definitive_length} mm` : null;
				const parts = [instrument, defLen].filter(Boolean).join(', ');
				return `${c.canal_name}${parts ? ': ' + parts : ''}`;
			})
			.join(' · ');
	}

	// Is the currently-viewed record in read-only mode?
	// Only the very latest record (records[0]) is editable; older ones are read-only.
	const isReadOnly = $derived(
		selectedRecordId !== null &&
		records.length > 0 &&
		records[0].id !== selectedRecordId,
	);

	// Is this a new (unsaved) session?
	const isNew = $derived(selectedRecordId === null);
</script>

<Dialog
	open={open}
	onOpenChange={(v) => { if (!v) onClose(); }}
>
	<DialogContent class="max-w-2xl sm:max-w-2xl flex flex-col gap-0 p-0 overflow-hidden max-h-[90vh]">
		<DialogHeader class="px-6 pt-5 pb-4 shrink-0">
			<DialogTitle class="text-base font-semibold">
				{i18n.t.chart.endo.title}
				<span class="text-muted-foreground font-normal ml-2 text-sm">
					— {i18n.t.common.tooth} {fdiNumber}
					<span class="hidden sm:inline"> ({toothLabel})</span>
				</span>
			</DialogTitle>
		</DialogHeader>

		<Separator />

		<!-- Body: two-column layout -->
		<div class="flex flex-1 min-h-0 overflow-hidden">

			<!-- ── Left: session history list ──────────────────────────── -->
			<aside class="w-56 shrink-0 border-r border-border flex flex-col">
				<!-- New session button -->
				<div class="px-3 pt-3 pb-2 shrink-0">
					<Button
						variant="outline"
						size="sm"
						class="w-full text-xs gap-1.5"
						onclick={resetToNewSession}
					>
						<svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
							<path d="M8 2v12M2 8h12" stroke-linecap="round"/>
						</svg>
						{i18n.t.chart.endo.newSession}
					</Button>
				</div>

				<div class="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
					{i18n.t.chart.endo.history}
				</div>

				<!-- History list -->
				<div class="flex-1 overflow-y-auto min-h-0">
					{#if isLoading}
						<div class="px-3 py-4 text-xs text-muted-foreground">{i18n.t.common.loading}</div>
					{:else if records.length === 0}
						<div class="px-3 py-4 text-xs text-muted-foreground">{i18n.t.chart.endo.noHistory}</div>
					{:else}
						{#each records as record, idx (record.id)}
							{@const isSelected = record.id === selectedRecordId}
							{@const isLatest = idx === 0}
							<button
								type="button"
								class="w-full text-left px-3 py-2.5 border-b border-border/60 transition-colors
									{isSelected
										? 'bg-accent text-accent-foreground'
										: 'hover:bg-muted/50 text-foreground'}"
								onclick={() => loadRecord(record)}
							>
								<div class="flex items-center gap-1.5 mb-0.5">
									<span class="text-xs font-medium">{record.treatment_date}</span>
									{#if isLatest}
										<span class="text-[10px] bg-primary/10 text-primary px-1 rounded">{i18n.t.chart.endo.newSession}</span>
									{/if}
								</div>
								<div class="text-[11px] text-muted-foreground line-clamp-2 leading-snug">
									{sessionSummary(record)}
								</div>
							</button>
						{/each}
					{/if}
				</div>
			</aside>

			<!-- ── Right: session editor ────────────────────────────────── -->
			<div class="flex-1 flex flex-col min-w-0 overflow-hidden">
				<div class="flex-1 overflow-y-auto p-5 space-y-4">

					<!-- Session header -->
					<div class="flex items-center gap-4">
						<!-- Date -->
						<div class="flex flex-col gap-1">
							<label class="text-xs font-medium text-muted-foreground" for="endo-date">
								{i18n.t.common.date}
							</label>
							<input
								id="endo-date"
								type="date"
								bind:value={draftDate}
								disabled={isReadOnly}
								class="text-sm border border-border rounded-md px-2.5 py-1.5 bg-background
									disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-ring"
							/>
						</div>

						{#if isReadOnly}
							<span class="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-4">
								{i18n.t.chart.snapshotReport?.readOnly ?? 'Schreibgeschützt'}
							</span>
						{/if}
					</div>

					<!-- Notes -->
					<div class="flex flex-col gap-1">
						<label class="text-xs font-medium text-muted-foreground" for="endo-notes">
							{i18n.t.common.notes}
						</label>
						<textarea
							id="endo-notes"
							bind:value={draftNotes}
							disabled={isReadOnly}
							rows={2}
							placeholder={isReadOnly ? '' : 'Befund, Besonderheiten…'}
							class="text-sm border border-border rounded-md px-2.5 py-1.5 bg-background resize-none
								disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-ring
								placeholder:text-muted-foreground/50"
						></textarea>
					</div>

					<!-- Canal cards -->
					<div class="space-y-3">
						<div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
							{i18n.t.chart.endo.canal}
						</div>

						{#if draftCanals.length === 0}
							<div class="text-xs text-muted-foreground py-2">—</div>
						{:else}
							{#each draftCanals as canal, idx (idx)}
								{@const isBaseCanal = idx < baseCanalsCount}
								<div class="rounded-md border border-border bg-muted/20 p-3 space-y-2.5">

									<!-- Row 1: Canal name + instrument + ISO + delete -->
									<div class="flex items-center gap-2">
										<!-- Canal name -->
										{#if isBaseCanal}
											<span class="text-sm font-bold w-10 shrink-0 text-foreground">{canal.canal_name}</span>
										{:else}
											<input
												type="text"
												bind:value={canal.canal_name}
												disabled={isReadOnly}
												placeholder="MB2"
												class="text-xs border border-border rounded px-2 py-1 bg-background w-16 shrink-0 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
											/>
										{/if}
										<!-- Instrument -->
										<div class="flex-1 flex items-center gap-1.5 min-w-0">
											<label class="text-[10px] text-muted-foreground shrink-0">{i18n.t.chart.endo.instrument}</label>
											<select
												bind:value={canal.instrument}
												disabled={isReadOnly}
												class="text-xs border border-border rounded px-1.5 py-1 bg-background flex-1 min-w-0 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
											>
												<option value="">—</option>
												{#each endoInstruments.list as instr (instr.key)}
													<option value={instr.key}>{instr.label}</option>
												{/each}
											</select>
										</div>
										<!-- ISO -->
										<div class="flex items-center gap-1.5 shrink-0">
											<label class="text-[10px] text-muted-foreground">{i18n.t.chart.endo.isoSize}</label>
											<input
												type="number"
												bind:value={canal.iso_size}
												disabled={isReadOnly}
												min={1} max={140}
												placeholder="—"
												class="text-xs border border-border rounded px-2 py-1 bg-background w-16 disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
											/>
										</div>
										<!-- Delete (custom canals only) -->
										{#if !isBaseCanal && !isReadOnly}
											<button
												type="button"
												onclick={() => removeCanal(idx)}
												class="text-muted-foreground hover:text-destructive transition-colors p-1 rounded shrink-0"
												title={i18n.t.actions.delete}
											>
												<svg class="size-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
													<path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" stroke-linecap="round" stroke-linejoin="round"/>
												</svg>
											</button>
										{/if}
									</div>

									<!-- Row 2: Three length fields -->
									<div class="grid grid-cols-3 gap-2">
										<div class="flex flex-col gap-1">
											<label class="text-[10px] text-muted-foreground">{i18n.t.chart.endo.lengthXray}</label>
											<input
												type="number"
												bind:value={canal.length_xray}
												disabled={isReadOnly}
												step={0.5} min={0}
												placeholder="—"
												onchange={() => suggestDefLength(idx)}
												class="text-xs border border-border rounded px-2 py-1 bg-background w-full disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
											/>
										</div>
										<div class="flex flex-col gap-1">
											<label class="text-[10px] text-muted-foreground">{i18n.t.chart.endo.lengthPrep}</label>
											<input
												type="number"
												bind:value={canal.length_preparation}
												disabled={isReadOnly}
												step={0.5} min={0}
												placeholder="—"
												class="text-xs border border-border rounded px-2 py-1 bg-background w-full disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
											/>
										</div>
										<div class="flex flex-col gap-1">
											<label class="text-[10px] text-muted-foreground">{i18n.t.chart.endo.lengthElectronic}</label>
											<input
												type="number"
												bind:value={canal.length_electronic}
												disabled={isReadOnly}
												step={0.5} min={0}
												placeholder="—"
												class="text-xs border border-border rounded px-2 py-1 bg-background w-full disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
											/>
										</div>
									</div>

									<!-- Row 3: Reference point + Definitive length -->
									<div class="grid grid-cols-2 gap-2">
										<div class="flex flex-col gap-1">
											<label class="text-[10px] text-muted-foreground">{i18n.t.chart.endo.referencePoint}</label>
											<input
												type="text"
												bind:value={canal.reference_point}
												disabled={isReadOnly}
												placeholder="—"
												class="text-xs border border-border rounded px-2 py-1 bg-background w-full disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
											/>
										</div>
										<div class="flex flex-col gap-1">
											<label class="text-[10px] text-muted-foreground font-medium text-foreground/80">{i18n.t.chart.endo.definitiveLength}</label>
											<input
												type="number"
												bind:value={canal.definitive_length}
												disabled={isReadOnly}
												step={0.5} min={0}
												placeholder="—"
												class="text-xs border border-border rounded px-2 py-1 bg-background w-full font-medium disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-ring"
											/>
										</div>
									</div>

								</div>
							{/each}
						{/if}

						<!-- Add canal button -->
						{#if !isReadOnly}
							<button
								type="button"
								onclick={addCanal}
								class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground border border-dashed border-border rounded-md px-3 py-1.5 w-full justify-center transition-colors hover:border-foreground/40"
							>
								<svg class="size-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M8 2v12M2 8h12" stroke-linecap="round"/>
								</svg>
								{i18n.t.chart.endo.addCanal}
							</button>
						{/if}
					</div>
				</div>

				<!-- ── Footer actions ───────────────────────────────────── -->
				<Separator />
				<div class="px-5 py-3 flex items-center gap-2 shrink-0">
					{#if !isReadOnly}
						<!-- Delete confirm inline -->
						{#if deleteConfirmId !== null}
							<span class="text-xs text-destructive mr-1">
								{i18n.t.chart.endo.deleteConfirm}
							</span>
							<Button
								variant="destructive"
								size="sm"
								onclick={confirmDelete}
							>
								{i18n.t.actions.delete}
							</Button>
							<Button variant="outline" size="sm" onclick={cancelDelete}>
								{i18n.t.actions.cancel}
							</Button>
						{:else}
							<!-- Save -->
							<Button
								size="sm"
								disabled={isSaving || !draftDate}
								onclick={handleSave}
							>
								{isSaving ? i18n.t.common.loading : i18n.t.chart.endo.saveSession}
							</Button>

							<!-- Delete (only for existing sessions) -->
							{#if !isNew && selectedRecordId !== null}
								<Button
									variant="ghost"
									size="sm"
									class="text-destructive hover:text-destructive hover:bg-destructive/10 ml-auto"
									onclick={() => requestDelete(selectedRecordId!)}
								>
									{i18n.t.chart.endo.deleteSession}
								</Button>
							{/if}
						{/if}
					{:else}
						<!-- Read-only: nothing to save -->
						<span class="text-xs text-muted-foreground">{i18n.t.chart.endo.sessionOf} {draftDate}</span>
					{/if}

					<!-- Close button always visible -->
					<Button
						variant="outline"
						size="sm"
						class="{isReadOnly || (deleteConfirmId === null && isNew) ? '' : ''} ml-auto"
						onclick={onClose}
					>
						{i18n.t.actions.close}
					</Button>
				</div>
			</div>
		</div>
	</DialogContent>
</Dialog>
