<script lang="ts">
	import { untrack } from 'svelte';
	import type {
		TimelineEntry,
		TimelineEntryType,
		TimelineFormData,
		TreatmentCategory,
		TreatmentOutcome,
	} from '$lib/types';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { entryTypes } from '$lib/stores/entryTypes.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { i18n } from '$lib/i18n';
	import type { TagSuggestion } from '$lib/services/keyword-engine';
	import { getPriorProceduresForTooth } from '$lib/services/db';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Button } from '$lib/components/ui/button';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter,
		DialogDescription,
	} from '$lib/components/ui/dialog';
	import TagSuggestionBar from '$lib/components/ui/TagSuggestionBar.svelte';
	import TextBlockPalette from '$lib/components/ui/TextBlockPalette.svelte';
	import StaffMentionPalette from '$lib/components/ui/StaffMentionPalette.svelte';
	import TextColorPicker from '$lib/components/timeline/TextColorPicker.svelte';
	import type { TextBlock } from '$lib/stores/textBlocks.svelte';
	import type { Doctor } from '$lib/types';

	export interface FormPrefill {
		title?: string;
		description?: string;
		entry_date?: string;
		doctor_id?: number | null;
		colleague_ids?: number[];
	}

	let {
		open = $bindable(false),
		entry = undefined,
		prefill = undefined,
		patientId,
		onSave,
	}: {
		open: boolean;
		entry?: TimelineEntry | undefined;
		prefill?: FormPrefill | undefined;
		patientId: string;
		onSave: (data: TimelineFormData) => Promise<void>;
	} = $props();

	const isEdit = $derived(!!entry);
	const dialogTitle = $derived(isEdit ? i18n.t.actions.edit : i18n.t.timeline.addEntry);

	const todayISO = new Date().toISOString().slice(0, 10);

	// Form state — untrack to suppress "captures initial value" warning
	let entryDate = $state(untrack(() => entry?.entry_date ?? todayISO));
	let entryType = $state<TimelineEntryType>(untrack(() => entry?.entry_type ?? ''));
	let entryTitle = $state(untrack(() => entry?.title ?? ''));
	let provider = $state(untrack(() => entry?.provider ?? ''));
	let toothNumbers = $state(untrack(() => entry?.tooth_numbers ?? ''));
	let description = $state(untrack(() => entry?.description ?? ''));
	let treatmentCategory = $state<TreatmentCategory | ''>(
		untrack(() => (entry?.treatment_category as TreatmentCategory) ?? ''),
	);
	let treatmentOutcome = $state<TreatmentOutcome | ''>(
		untrack(() => (entry?.treatment_outcome as TreatmentOutcome) ?? ''),
	);
	let doctorId = $state<number | null>(untrack(() => entry?.doctor_id ?? null));
	let colleagueIds = $state<number[]>(untrack(() => JSON.parse(entry?.colleague_ids || '[]')));

	let relatedEntryId = $state<number | null>(untrack(() => entry?.related_entry_id ?? null));
	let showRelatedPicker = $state(false);
	let relatedOptions = $state<TimelineEntry[]>([]);

	let errors = $state<Record<string, string>>({});
	let isSaving = $state(false);
	let submitError = $state('');

	// ── Text block palette ───────────────────────────────────────────────
	let showPalette      = $state(false);
	let paletteQuery     = $state('');
	let descEditorEl     = $state<HTMLDivElement | null>(null);
	let descContainerEl  = $state<HTMLDivElement | null>(null);
	let formPaletteRef   = $state<ReturnType<typeof TextBlockPalette> | null>(null);

	// ── Staff mention palette ────────────────────────────────────────────
	let showMentionPalette = $state(false);
	let mentionQuery       = $state('');
	let mentionPaletteRef  = $state<ReturnType<typeof StaffMentionPalette> | null>(null);

	// ── Selection / caret helpers ────────────────────────────────────────
	function getTextBeforeCaretForm(): string {
		const sel = window.getSelection();
		if (!sel || !sel.rangeCount || !descEditorEl) return '';
		const range = sel.getRangeAt(0);
		const preRange = document.createRange();
		preRange.selectNodeContents(descEditorEl);
		preRange.setEnd(range.startContainer, range.startOffset);
		return preRange.toString();
	}

	function selectTextRangeForm(start: number, end: number) {
		if (!descEditorEl) return;
		const range = document.createRange();
		let charIndex = 0;
		let startNode: Node | null = null, startOff = 0;
		let endNode: Node | null = null, endOff = 0;
		const walker = document.createTreeWalker(descEditorEl, NodeFilter.SHOW_TEXT);
		let node: Node | null;
		while ((node = walker.nextNode())) {
			const len = (node as Text).length;
			if (!startNode && charIndex + len >= start) { startNode = node; startOff = start - charIndex; }
			if (!endNode && charIndex + len >= end) { endNode = node; endOff = end - charIndex; }
			charIndex += len;
		}
		if (startNode && endNode) {
			range.setStart(startNode, startOff);
			range.setEnd(endNode, endOff);
			const sel = window.getSelection();
			sel?.removeAllRanges();
			sel?.addRange(range);
		}
	}

	function getCurrentWordForm(): { word: string; start: number; end: number } {
		const textBefore = getTextBeforeCaretForm();
		const end = textBefore.length;
		let start = end;
		while (start > 0 && textBefore[start - 1] !== '\n' && textBefore[start - 1] !== ' ') start--;
		return { word: textBefore.slice(start), start, end };
	}

	function handleDescInput() {
		description = descEditorEl?.innerHTML ?? '';
		const { word } = getCurrentWordForm();
		if (word.startsWith('@')) {
			mentionQuery = word.slice(1); showMentionPalette = true;
			showPalette = false;
		} else if (word.startsWith('/')) {
			paletteQuery = word.slice(1); showPalette = true;
			showMentionPalette = false;
		} else {
			showPalette = false;
			showMentionPalette = false;
		}
	}

	function insertMentionInForm(doc: Doctor) {
		if (!descEditorEl) return;
		descEditorEl.focus();
		const { start, end } = getCurrentWordForm();
		selectTextRangeForm(start, end);
		document.execCommand('insertText', false, '');
		description = descEditorEl.innerHTML;
		showMentionPalette = false; mentionQuery = '';
		if (!allStaffIds.includes(doc.id)) {
			toggleStaff(doc.id);
		}
	}

	// All selected staff ids in order (primary first, then colleagues)
	const allStaffIds = $derived([...(doctorId !== null ? [doctorId] : []), ...colleagueIds]);

	function toggleStaff(id: number) {
		if (doctorId === id) {
			// Removing primary: promote first colleague, or clear
			doctorId = colleagueIds[0] ?? null;
			colleagueIds = colleagueIds.slice(1);
		} else if (colleagueIds.includes(id)) {
			colleagueIds = colleagueIds.filter(c => c !== id);
		} else {
			// Adding new
			if (doctorId === null) {
				doctorId = id;
			} else {
				colleagueIds = [...colleagueIds, id];
			}
		}
	}

	function insertBlockInForm(block: TextBlock) {
		if (!descEditorEl) return;
		descEditorEl.focus();
		const { start, end } = getCurrentWordForm();
		selectTextRangeForm(start, end);
		document.execCommand('insertText', false, block.body);
		description = descEditorEl.innerHTML;
		showPalette = false; paletteQuery = '';
	}

	function handleDescKeydown(e: KeyboardEvent) {
		if (showMentionPalette && mentionPaletteRef?.handleKeydown(e)) return;
		if (showPalette && formPaletteRef?.handleKeydown(e)) return;
		if (e.key === 'Escape' && showMentionPalette) { showMentionPalette = false; return; }
		if (e.key === 'Escape' && showPalette) { showPalette = false; return; }
		if (e.key === 'Enter' && (showMentionPalette || showPalette)) { e.preventDefault(); return; }
	}

	// Text fed to the keyword scanner: title + description combined
	const descPlainText = $derived(descEditorEl?.innerText ?? description.replace(/<[^>]*>/g, ''));
	const scanText = $derived(`${entryTitle} ${descPlainText}`);

	// Reset form when dialog opens/entry changes
	$effect(() => {
		if (open) {
			entryDate = entry?.entry_date ?? prefill?.entry_date ?? todayISO;
			entryType = entry?.entry_type ?? '';
			entryTitle = entry?.title ?? prefill?.title ?? '';
			provider = entry?.provider ?? '';
			toothNumbers = entry?.tooth_numbers ?? '';
			description = entry?.description ?? prefill?.description ?? '';
			treatmentCategory = (entry?.treatment_category as TreatmentCategory) ?? '';
			treatmentOutcome = (entry?.treatment_outcome as TreatmentOutcome) ?? '';
			doctorId = entry?.doctor_id ?? prefill?.doctor_id ?? null;
			colleagueIds = JSON.parse(entry?.colleague_ids || (prefill?.colleague_ids ? JSON.stringify(prefill.colleague_ids) : '[]'));
			relatedEntryId = entry?.related_entry_id ?? null;
			showRelatedPicker = false;
			relatedOptions = [];
			errors = {};
			submitError = '';
		}
	});

	function handleTagAccepted(s: TagSuggestion) {
		if (s.field === 'treatment_category') {
			treatmentCategory = s.value as TreatmentCategory;
		} else if (s.field === 'treatment_outcome') {
			treatmentOutcome = s.value as TreatmentOutcome;
		} else if (s.field === 'tooth_numbers') {
			// Merge with existing tooth numbers, dedup
			const existing = toothNumbers
				.split(',')
				.map((t) => t.trim())
				.filter(Boolean);
			const incoming = s.value.split(',').map((t) => t.trim()).filter(Boolean);
			const merged = [...new Set([...existing, ...incoming])].sort(
				(a, b) => parseInt(a) - parseInt(b),
			);
			toothNumbers = merged.join(', ');
		}
	}

	function isoToDisplay(iso: string): string {
		if (!iso || iso.length !== 10) return iso;
		const [y, m, d] = iso.split('-');
		return `${d}/${m}/${y}`;
	}

	function displayToISO(display: string): string | null {
		const match = display.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
		if (!match) return null;
		const [, d, m, y] = match;
		return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
	}

	function validate(): boolean {
		const errs: Record<string, string> = {};
		if (!entryDate) errs.entryDate = i18n.t.common.required;
		if (!entryTitle.trim()) errs.entryTitle = i18n.t.common.required;
		errors = errs;
		return Object.keys(errs).length === 0;
	}

	async function handleSubmit(e?: Event) {
		e?.preventDefault();
		submitError = '';
		if (!validate()) return;
		isSaving = true;
		try {
			await onSave({
				entry_date: entryDate,
				entry_type: entryType,
				title: entryTitle.trim(),
				provider: undefined,
				tooth_numbers: toothNumbers.trim() || undefined,
				description: description.trim() || undefined,
				treatment_category: treatmentCategory || undefined,
				treatment_outcome: treatmentOutcome || undefined,
				related_entry_id: relatedEntryId,
				doctor_id: doctorId,
				colleague_ids: JSON.stringify(colleagueIds),
			});
			open = false;
		} catch (err) {
			submitError = err instanceof Error ? err.message : 'Failed to save entry';
		} finally {
			isSaving = false;
		}
	}

	const typeOptions = $derived(
		entryTypes.list.map(t => ({ value: t.key as TimelineEntryType, label: t.label, icon: t.icon }))
	);

	const categoryOptions = $derived<{ value: TreatmentCategory | ''; label: string; icon: string }[]>([
		{ value: '', label: `— ${i18n.t.timeline.filter} —`, icon: '' },
		{ value: 'endodontics',    label: i18n.t.categories.endodontics,    icon: '🦷' },
		{ value: 'orthodontics',   label: i18n.t.categories.orthodontics,   icon: '😁' },
		{ value: 'prosthodontics', label: i18n.t.categories.prosthodontics, icon: '🔩' },
		{ value: 'periodontics',   label: i18n.t.categories.periodontics,   icon: '🩺' },
		{ value: 'oral_surgery',   label: i18n.t.categories.oral_surgery,   icon: '✂️' },
		{ value: 'restorative',    label: i18n.t.categories.restorative,    icon: '🪥' },
		{ value: 'preventive',     label: i18n.t.categories.preventive,     icon: '✨' },
		{ value: 'imaging',        label: i18n.t.categories.imaging,        icon: '📷' },
		{ value: 'other',          label: i18n.t.categories.other,          icon: '📌' },
	]);

	const outcomeOptions = $derived<{ value: TreatmentOutcome | ''; label: string; icon: string }[]>([
		{ value: '',               label: `— ${i18n.t.timeline.entry.outcome} —`, icon: '' },
		{ value: 'successful',       label: i18n.t.outcomes.successful,       icon: '✅' },
		{ value: 'retreated',        label: i18n.t.outcomes.retreated,        icon: '🔄' },
		{ value: 'failed_extracted', label: i18n.t.outcomes.failed_extracted, icon: '❌' },
		{ value: 'failed_other',     label: i18n.t.outcomes.failed_other,     icon: '⚠️' },
		{ value: 'ongoing',          label: i18n.t.outcomes.ongoing,          icon: '⏳' },
		{ value: 'unknown',          label: i18n.t.outcomes.unknown,          icon: '❓' },
	]);

	// Show category/outcome for clinically meaningful entry types
	const showClinicalFields = $derived(
		entryType === 'procedure' ||
		entryType === 'visit' ||
		entryType === 'referral',
	);

	const selectClass =
		'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50';
</script>

<Dialog bind:open>
	<DialogContent class="max-w-lg">
		<DialogHeader>
			<DialogTitle>{dialogTitle}</DialogTitle>
			<DialogDescription>
				{isEdit ? 'Update this timeline entry.' : "Record a new event in this patient's timeline."}
			</DialogDescription>
		</DialogHeader>

		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="flex flex-col gap-4 py-2">
			<!-- Error -->
			{#if submitError}
				<div class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
					{submitError}
				</div>
			{/if}

			<!-- Date + Type row -->
			<div class="grid grid-cols-2 gap-3">
				<div class="flex flex-col gap-1.5">
					<Label for="entry-date">{i18n.t.common.date} <span class="text-destructive">*</span></Label>
					<input
						id="entry-date"
						type="text"
						placeholder="DD/MM/YYYY"
						value={isoToDisplay(entryDate)}
						oninput={(e) => {
							const iso = displayToISO(e.currentTarget.value);
							if (iso) entryDate = iso;
						}}
						onblur={(e) => {
							const iso = displayToISO(e.currentTarget.value);
							if (iso) {
								entryDate = iso;
								e.currentTarget.value = isoToDisplay(iso);
							} else {
								e.currentTarget.value = isoToDisplay(entryDate);
							}
						}}
						class={`flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${errors.entryDate ? 'border-destructive' : 'border-input'}`}
					/>
					{#if errors.entryDate}
						<p class="text-xs text-destructive">{errors.entryDate}</p>
					{/if}
				</div>

				<div class="flex flex-col gap-1.5">
					<Label for="entry-type">{i18n.t.timeline.entry.type} <span class="text-muted-foreground font-normal text-xs">({i18n.t.schedule.optional})</span></Label>
					<select id="entry-type" class={selectClass} bind:value={entryType}>
						<option value="">{i18n.t.timeline.entry.typePlaceholder}</option>
						{#each typeOptions as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>
			</div>

			<!-- Title -->
			<div class="flex flex-col gap-1.5">
				<Label for="entry-title">{i18n.t.common.name} <span class="text-destructive">*</span></Label>
				<Input
					id="entry-title"
					placeholder="e.g. Annual checkup, Root canal #14…"
					bind:value={entryTitle}
					class={errors.entryTitle ? 'border-destructive' : ''}
				/>
				{#if errors.entryTitle}
					<p class="text-xs text-destructive">{errors.entryTitle}</p>
				{/if}
			</div>

			<!-- Staff chips -->
			<div class="flex flex-col gap-1.5">
				<Label>{i18n.t.staff.title}</Label>
				<div class="flex flex-wrap gap-1.5">
					{#each doctors.list.filter(d => d.show_in_doc_bar !== 0) as doc (doc.id)}
						{@const active = allStaffIds.includes(doc.id)}
						{@const idx = allStaffIds.indexOf(doc.id)}
						<button
							type="button"
							onclick={() => toggleStaff(doc.id)}
							style="--doc-color: {doc.color}"
							class={[
								'h-7 rounded-full border px-2.5 text-xs font-medium transition-all flex items-center gap-1',
								active
									? 'border-[var(--doc-color)] bg-[var(--doc-color)] text-white shadow-sm'
									: 'border-border bg-transparent text-muted-foreground hover:border-[var(--doc-color)] hover:text-foreground',
							].join(' ')}
							title={active && idx === 0 ? 'Primary (click to remove)' : active ? 'Colleague (click to remove)' : 'Click to add'}
						>
							{#if active && idx > 0}
								<span class="opacity-75 text-[9px] font-bold leading-none">+</span>
							{/if}
							{staffLabel(doc)}{#if doc.specialty}<span class={['ml-0.5 text-[10px]', active ? 'opacity-75' : 'opacity-70'].join(' ')}> · {doc.specialty}</span>{/if}
						</button>
					{/each}
					{#if doctors.list.filter(d => d.show_in_doc_bar !== 0).length === 0}
						<p class="text-[10px] text-muted-foreground/60">Add staff in Settings → Staff</p>
					{/if}
				</div>
			</div>

			<!-- Description + Tag Suggestion Bar -->
			<div class="flex flex-col gap-2">
				<Label for="description">{i18n.t.common.notes}</Label>
				<div class="relative" bind:this={descContainerEl}>
					<!-- svelte-ignore a11y_interactive_supports_focus -->
					<div
						id="description"
						bind:this={descEditorEl}
						bind:innerHTML={description}
						contenteditable="true"
						role="textbox"
						aria-multiline="true"
						data-placeholder={i18n.t.timeline.entry.notesPlaceholder}
						oninput={handleDescInput}
						onkeydown={handleDescKeydown}
						class="form-editor border-input bg-background block min-h-[80px] w-full rounded-md border px-3 py-2 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
					></div>
					{#if showPalette}
						<div class="absolute bottom-full left-0 mb-1.5 z-50">
							<TextBlockPalette
								bind:this={formPaletteRef}
								query={paletteQuery}
								onSelect={insertBlockInForm}
								onDismiss={() => { showPalette = false; }}
							/>
						</div>
					{/if}
					{#if showMentionPalette}
						<div class="absolute bottom-full left-0 mb-1.5 z-50">
							<StaffMentionPalette
								bind:this={mentionPaletteRef}
								query={mentionQuery}
								onSelect={insertMentionInForm}
								onDismiss={() => { showMentionPalette = false; }}
							/>
						</div>
					{/if}
				</div>
				<!-- Smart tag suggestions fire after typing in title OR description -->
				<TagSuggestionBar
					text={scanText}
					onAccept={handleTagAccepted}
					onRelatedEntryAccept={async () => {
						showRelatedPicker = true;
						if (toothNumbers.trim()) {
							relatedOptions = await getPriorProceduresForTooth(patientId, toothNumbers, entryDate || undefined, entry?.id);
						}
					}}
				/>
			</div>

			<!-- Related entry picker (shown for procedure/visit when tooth numbers set) -->
			{#if entryType === 'procedure' || entryType === 'visit'}
				<div class="flex flex-col gap-1.5">
					<Label>{i18n.t.timeline.tagSuggestion.relatedEntry}</Label>
					{#if relatedEntryId}
						<div class="flex items-center gap-2">
							<span class="flex-1 text-sm border border-input rounded-md px-3 py-1.5 bg-background text-muted-foreground">
								Entry #{relatedEntryId} — {relatedOptions.find(o => o.id === relatedEntryId)?.title ?? 'linked'}
							</span>
							<button
								type="button"
								onclick={() => { relatedEntryId = null; }}
								class="shrink-0 rounded-md border border-input bg-background p-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors"
								title="Unlink"
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
									<path d="M18 6L6 18M6 6l12 12"/>
								</svg>
							</button>
						</div>
					{:else}
						<button
							type="button"
							onclick={async () => {
								showRelatedPicker = !showRelatedPicker;
								if (showRelatedPicker && toothNumbers.trim()) {
									relatedOptions = await getPriorProceduresForTooth(patientId, toothNumbers, entryDate || undefined, entry?.id);
								}
							}}
							class="h-9 rounded-md border border-dashed border-border px-3 text-sm text-muted-foreground hover:border-foreground/40 hover:text-foreground transition-colors text-left"
						>
							{showRelatedPicker ? i18n.t.actions.close : `+ ${i18n.t.timeline.tagSuggestion.pickEntry}`}
						</button>
					{/if}
					{#if showRelatedPicker && !relatedEntryId}
						<div class="rounded-md border border-border bg-background overflow-hidden">
							{#if relatedOptions.length === 0}
								<p class="text-xs text-muted-foreground px-3 py-2">No prior procedures found for this tooth.</p>
							{:else}
								{#each relatedOptions as opt}
									<button
										type="button"
										onclick={() => { relatedEntryId = opt.id; showRelatedPicker = false; }}
										class="flex items-start gap-2 w-full px-3 py-2 text-left text-xs hover:bg-muted transition-colors border-b border-border/50 last:border-b-0"
									>
										<span class="font-medium">{opt.entry_date}</span>
										<span class="text-muted-foreground truncate">{opt.title}</span>
										{#if opt.treatment_category}
											<span class="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{opt.treatment_category}</span>
										{/if}
									</button>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Clinical classification fields (visible for procedure/visit/referral) -->
			{#if showClinicalFields}
				<div class="grid grid-cols-2 gap-3 rounded-md border border-dashed p-3">
					<p class="col-span-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
						{i18n.t.timeline.entry.category}
					</p>

					<div class="flex flex-col gap-1.5">
						<Label for="treatment-category">{i18n.t.timeline.entry.category}</Label>
						<select id="treatment-category" class={selectClass} bind:value={treatmentCategory}>
							{#each categoryOptions as opt}
								<option value={opt.value}>{opt.icon ? opt.icon + ' ' : ''}{opt.label}</option>
							{/each}
						</select>
					</div>

					<div class="flex flex-col gap-1.5">
						<Label for="treatment-outcome">{i18n.t.timeline.entry.outcome}</Label>
						<select id="treatment-outcome" class={selectClass} bind:value={treatmentOutcome}>
							{#each outcomeOptions as opt}
								<option value={opt.value}>{opt.icon ? opt.icon + ' ' : ''}{opt.label}</option>
							{/each}
						</select>
					</div>
				</div>
			{/if}

			<DialogFooter>
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{i18n.t.actions.cancel}
				</Button>
				<Button type="button" onclick={handleSubmit} disabled={isSaving}>
					{isSaving ? i18n.t.common.loading : isEdit ? i18n.t.actions.save : i18n.t.timeline.addEntry}
				</Button>
			</DialogFooter>
		</form>
	</DialogContent>
</Dialog>

<TextColorPicker containerEl={descContainerEl} />

<style>
	.form-editor:empty::before {
		content: attr(data-placeholder);
		color: hsl(var(--muted-foreground) / 0.6);
		pointer-events: none;
	}
</style>
