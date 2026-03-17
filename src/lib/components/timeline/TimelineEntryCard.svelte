<script lang="ts">
	import { untrack, tick } from 'svelte';
	import type { TimelineEntry, TimelineEntryType, Complication } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { openDocumentFile, fileToAssetUrl, isImageMime, formatFileSize, toAbsPath } from '$lib/services/files';
	import { docCategories } from '$lib/stores/categories.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { complicationTypes } from '$lib/stores/complicationTypes.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { vault } from '$lib/stores/vault.svelte';
	import { getComplications, insertComplication, resolveComplication, deleteComplication } from '$lib/services/db';

	let {
		entry,
		onEdit,
		onDelete,
		onHistory,
		onDateChange,
	}: {
		entry: TimelineEntry;
		onEdit: (entry: TimelineEntry) => void;
		onDelete: (entry: TimelineEntry) => void;
		onHistory?: (entry: TimelineEntry) => void;
		/** If provided, a date-edit control is shown. Caller must persist + reload. */
		onDateChange?: (entry: TimelineEntry, newDate: string) => void;
	} = $props();

	let expanded = $state(true);

	// ── Inline date editing ──────────────────────────────────────────────
	let editingDate = $state(false);
	// untrack() suppresses the "captures initial value of entry" Svelte warning
	let pendingDate = $state(untrack(() => entry.entry_date));

	// Keep pendingDate in sync when the entry prop updates (after parent reload)
	$effect(() => {
		if (!editingDate) pendingDate = entry.entry_date;
	});

	function startDateEdit(e: Event) {
		e.stopPropagation();
		pendingDate = entry.entry_date;
		editingDate = true;
	}

	function commitDateEdit() {
		if (pendingDate && pendingDate !== entry.entry_date) {
			onDateChange?.(entry, pendingDate);
		}
		editingDate = false;
	}

	function cancelDateEdit(e?: Event) {
		e?.stopPropagation();
		pendingDate = entry.entry_date;
		editingDate = false;
	}

	function onDateInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commitDateEdit(); }
		if (e.key === 'Escape') cancelDateEdit();
	}

	// ── Entry type config ────────────────────────────────────────────────
	const typeConfig: Record<
		TimelineEntryType,
		{ icon: string; label: string; dotClass: string; bgClass: string; textClass: string }
	> = {
		visit: {
			icon: '🏥',
			label: 'Visit',
			dotClass: 'bg-blue-500',
			bgClass: 'bg-blue-50 dark:bg-blue-950/30',
			textClass: 'text-blue-700 dark:text-blue-400',
		},
		procedure: {
			icon: '🔧',
			label: 'Procedure',
			dotClass: 'bg-violet-500',
			bgClass: 'bg-violet-50 dark:bg-violet-950/30',
			textClass: 'text-violet-700 dark:text-violet-400',
		},
		note: {
			icon: '📝',
			label: 'Note',
			dotClass: 'bg-zinc-400',
			bgClass: 'bg-zinc-50 dark:bg-zinc-800/40',
			textClass: 'text-zinc-600 dark:text-zinc-400',
		},
		lab: {
			icon: '🧪',
			label: 'Lab',
			dotClass: 'bg-amber-500',
			bgClass: 'bg-amber-50 dark:bg-amber-950/30',
			textClass: 'text-amber-700 dark:text-amber-400',
		},
		imaging: {
			icon: '📷',
			label: 'Imaging',
			dotClass: 'bg-teal-500',
			bgClass: 'bg-teal-50 dark:bg-teal-950/30',
			textClass: 'text-teal-700 dark:text-teal-400',
		},
		referral: {
			icon: '📋',
			label: 'Referral',
			dotClass: 'bg-rose-500',
			bgClass: 'bg-rose-50 dark:bg-rose-950/30',
			textClass: 'text-rose-700 dark:text-rose-400',
		},
		document: {
			icon: '📎',
			label: 'File',
			dotClass: 'bg-sky-500',
			bgClass: 'bg-sky-50 dark:bg-sky-950/30',
			textClass: 'text-sky-700 dark:text-sky-400',
		},
		plan: {
			icon: '📋',
			label: 'Plan',
			dotClass: 'bg-primary',
			bgClass: 'bg-primary/5',
			textClass: 'text-primary',
		},
		chart_snapshot: {
			icon: '🦷',
			label: 'Chart',
			dotClass: 'bg-indigo-500',
			bgClass: 'bg-indigo-50 dark:bg-indigo-950/30',
			textClass: 'text-indigo-700 dark:text-indigo-400',
		},
	};

	// ── Document category metadata — driven by configurable categories store ──
	const docCatLabel = $derived(docCategories.getLabel(entry.treatment_category));
	const docCatIcon  = $derived(docCategories.getIcon(entry.treatment_category));
	const docCatColor = $derived(docCategories.getColor(entry.treatment_category));

	const cfg = $derived(typeConfig[entry.entry_type] ?? typeConfig.note);

	// ── Treatment category & outcome labels (clinical entries) ────────────
	const categoryLabels = $derived<Record<string, { label: string; icon: string }>>({
		endodontics:    { label: i18n.t.categories.endodontics,    icon: '🦷' },
		orthodontics:   { label: i18n.t.categories.orthodontics,   icon: '😁' },
		prosthodontics: { label: i18n.t.categories.prosthodontics, icon: '🔩' },
		periodontics:   { label: i18n.t.categories.periodontics,   icon: '🩺' },
		oral_surgery:   { label: i18n.t.categories.oral_surgery,   icon: '✂️' },
		restorative:    { label: i18n.t.categories.restorative,    icon: '🪥' },
		preventive:     { label: i18n.t.categories.preventive,     icon: '✨' },
		imaging:        { label: i18n.t.categories.imaging,        icon: '📷' },
		other:          { label: i18n.t.categories.other,          icon: '📌' },
	});

	const outcomeLabels = $derived<Record<string, { label: string; colorClass: string }>>({
		successful:       { label: i18n.t.outcomes.successful,        colorClass: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400' },
		retreated:        { label: i18n.t.outcomes.retreated,         colorClass: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400' },
		failed_extracted: { label: i18n.t.outcomes.failed_extracted,  colorClass: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400' },
		failed_other:     { label: i18n.t.outcomes.failed_other,      colorClass: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400' },
		ongoing:          { label: i18n.t.outcomes.ongoing,           colorClass: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400' },
		unknown:          { label: i18n.t.outcomes.unknown,           colorClass: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400' },
	});

	function formatDate(val: string): string {
		if (!val) return '—';
		const [y, m, d] = val.split('-').map(Number);
		const date = new Date(y, m - 1, d);
		return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
	}

	// ── Document attachment helpers ──────────────────────────────────────

	interface AttachmentInfo {
		path: string;
		name: string;
		mime: string;
		size: number;
	}

	function parseAttachments(raw: string): AttachmentInfo[] {
		try {
			const parsed = JSON.parse(raw);
			return Array.isArray(parsed) ? (parsed as AttachmentInfo[]) : [];
		} catch {
			return [];
		}
	}

	function mimeIcon(mime: string): string {
		if (mime === 'application/pdf') return '📄';
		if (mime === 'application/dicom') return '🩻';
		if (mime.startsWith('image/')) return '🖼️';
		if (mime.includes('word')) return '📝';
		if (mime.includes('sheet') || mime.includes('csv')) return '📊';
		return '📁';
	}

	// Reactive document info (only valid when entry_type === 'document')
	const docFile = $derived(
		entry.entry_type === 'document' ? (parseAttachments(entry.attachments)[0] ?? null) : null,
	);
	/** Resolve the attachment path (may be relative) to an absolute path for display/open. */
	const resolvedDocPath = $derived(docFile ? toAbsPath(docFile.path, vault.path ?? '') : '');

	// ── Image preview state ───────────────────────────────────────────────
	let imageExpanded = $state(false);
	let expandedImageEl = $state<HTMLElement | undefined>(undefined);
	let clickTimer: ReturnType<typeof setTimeout> | null = null;

	function handleImageClick() {
		if (clickTimer) {
			// Second click within 220 ms → double-click: open in system app
			clearTimeout(clickTimer);
			clickTimer = null;
			handleOpenFile();
		} else {
			// First click: wait to see if a second arrives
			clickTimer = setTimeout(async () => {
				clickTimer = null;
				imageExpanded = !imageExpanded;
				if (imageExpanded) {
					await tick();
					if (expandedImageEl) {
						// Wait for the full-size image to finish loading before measuring
						const img = expandedImageEl.querySelector('img');
						if (img && !img.complete) {
							await new Promise<void>(resolve => {
								img.addEventListener('load', () => resolve(), { once: true });
								img.addEventListener('error', () => resolve(), { once: true });
							});
						}
						const scrollParent = expandedImageEl.closest('main');
						if (scrollParent) {
							const elRect = expandedImageEl.getBoundingClientRect();
							const parentRect = scrollParent.getBoundingClientRect();
							const overshoot = elRect.bottom - parentRect.bottom;
							if (overshoot > 0) {
								scrollParent.scrollBy({ top: overshoot + 16, behavior: 'smooth' });
							}
						}
					}
				}
			}, 220);
		}
	}

	async function handleOpenFile() {
		if (!resolvedDocPath) return;
		await openDocumentFile(resolvedDocPath);
	}

	// ── Complications ─────────────────────────────────────────────────────
	let complications = $state<Complication[]>([]);
	let showComplicationForm = $state(false);
	let newComplicationType = $state('');
	let newComplicationNotes = $state('');
	let isSavingComplication = $state(false);

	const isComplicationEntry = $derived(
		entry.entry_type === 'procedure' || entry.entry_type === 'visit',
	);

	async function loadComplications() {
		if (isComplicationEntry) {
			complications = await getComplications(entry.id);
		}
	}

	$effect(() => {
		if (expanded && isComplicationEntry) {
			loadComplications();
		}
	});

	async function handleAddComplication() {
		if (!newComplicationType.trim()) return;
		isSavingComplication = true;
		try {
			const today = new Date().toISOString().slice(0, 10);
			await insertComplication(entry.id, entry.patient_id, {
				complication_type: newComplicationType,
				description: newComplicationNotes,
				date_reported: today,
			});
			newComplicationType = '';
			newComplicationNotes = '';
			showComplicationForm = false;
			await loadComplications();
		} finally {
			isSavingComplication = false;
		}
	}

	async function handleResolveComplication(id: number) {
		await resolveComplication(id, true);
		await loadComplications();
	}

	async function handleDeleteComplication(id: number) {
		await deleteComplication(id);
		await loadComplications();
	}
</script>

<div class="relative flex gap-4">
	<!-- Timeline dot -->
	<div class="flex flex-col items-center">
		<div
			class={`mt-1.5 h-3 w-3 rounded-full border-2 border-background ring-2 ring-offset-0 shrink-0 ${cfg.dotClass}`}
			style="box-shadow: 0 0 0 2px white;"
		></div>
	</div>

	<!-- ── Document entry — compact clickable card ── -->
	{#if entry.entry_type === 'document'}
		<div class="mb-4 flex-1 rounded-lg border bg-card shadow-xs overflow-hidden">
			<div class="flex items-center gap-3 p-3">

				<!-- Thumbnail / file icon -->
				{#if docFile && isImageMime(docFile.mime)}
					<button
						type="button"
						onclick={handleImageClick}
						class="shrink-0 h-14 w-14 rounded-md border overflow-hidden bg-muted hover:opacity-80 transition-opacity"
						title="Click to preview · Double-click to open"
					>
						<img
							src={fileToAssetUrl(resolvedDocPath)}
							alt={docFile.name}
							class="h-full w-full object-cover"
						/>
					</button>
				{:else}
					<div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border bg-muted text-2xl select-none">
						{mimeIcon(docFile?.mime ?? '')}
					</div>
				{/if}

				<!-- Metadata -->
				<div class="flex-1 min-w-0">
					<!-- Badges row -->
					<div class="flex flex-wrap items-center gap-1.5 mb-1">
						<span class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${cfg.bgClass} ${cfg.textClass}`}>
							{cfg.icon} {cfg.label}
						</span>
						{#if entry.treatment_category}
							<span class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${docCatColor}`}>
								{docCatIcon} {docCatLabel}
							</span>
						{/if}
					</div>

					<!-- Filename -->
					<p class="text-sm font-medium leading-tight truncate" title={entry.title}>
						{entry.title}
					</p>

					<!-- Date · size · notes -->
					<div class="flex flex-wrap items-center gap-x-2 mt-0.5 text-xs text-muted-foreground">
						{#if editingDate}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								type="date"
								value={pendingDate}
								oninput={(e) => (pendingDate = (e.target as HTMLInputElement).value)}
								onblur={commitDateEdit}
								onkeydown={onDateInputKeydown}
								autofocus
								class="text-xs border rounded px-1.5 py-0.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring/50 focus:border-ring"
							/>
							<button type="button" onclick={cancelDateEdit} class="text-muted-foreground/60 hover:text-muted-foreground text-xs transition-colors">
								{i18n.t.actions.cancel}
							</button>
						{:else}
							<button
								type="button"
								onclick={onDateChange ? startDateEdit : undefined}
								class={[
									'transition-colors',
									onDateChange ? 'hover:text-foreground hover:underline cursor-pointer group/date flex items-center gap-1' : 'cursor-default',
								].join(' ')}
								title={onDateChange ? 'Click to change date' : undefined}
							>
								{formatDate(entry.entry_date)}
								{#if onDateChange}
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5 opacity-0 group-hover/date:opacity-50 transition-opacity">
										<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
									</svg>
								{/if}
							</button>
						{/if}
						{#if docFile?.size}
							<span>· {formatFileSize(docFile.size)}</span>
						{/if}
						{#if entry.description}
							<span class="truncate max-w-[200px]">· {entry.description}</span>
						{/if}
					</div>
				</div>

				<!-- Open button -->
				{#if docFile && resolvedDocPath}
					<button
						type="button"
						onclick={handleOpenFile}
						class="shrink-0 inline-flex items-center gap-1.5 rounded-md border bg-muted px-2.5 py-1.5 text-xs font-medium hover:bg-muted/80 transition-colors"
						title="Open with default application"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
							<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
							<polyline points="15 3 21 3 21 9"/>
							<line x1="10" y1="14" x2="21" y2="3"/>
						</svg>
						{i18n.t.actions.open}
					</button>
				{/if}
			</div>

			<!-- Expanded image preview -->
			{#if imageExpanded && docFile && isImageMime(docFile.mime) && resolvedDocPath}
				<div bind:this={expandedImageEl} class="border-t bg-black/5 dark:bg-white/5 p-2">
					<button
						type="button"
						onclick={handleImageClick}
						ondblclick={(e) => { e.preventDefault(); handleOpenFile(); }}
						class="block w-full rounded overflow-hidden cursor-zoom-in"
						title="Click to close · Double-click to open in app"
					>
						<img
							src={fileToAssetUrl(resolvedDocPath)}
							alt={docFile.name}
							class="w-full max-h-[480px] object-contain rounded"
						/>
					</button>
					<p class="mt-1.5 text-center text-[10px] text-muted-foreground/50 select-none">
						{i18n.t.actions.close} · {i18n.t.actions.open}
					</p>
				</div>
			{/if}
		</div>

	<!-- ── Normal clinical entry — expandable card ── -->
	{:else}
		<div class="mb-4 flex-1 rounded-lg border bg-card shadow-xs overflow-hidden">
			<!-- Header row -->
			<button
				type="button"
				class="flex w-full items-start justify-between gap-3 p-4 text-left hover:bg-muted/40 transition-colors"
				onclick={() => (expanded = !expanded)}
			>
				<div class="flex items-start gap-3 min-w-0">
					<!-- Entry type badge -->
					<span class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${cfg.bgClass} ${cfg.textClass}`}>
						{cfg.icon} {cfg.label}
					</span>
					<div class="min-w-0 flex-1">
						<div class="flex flex-wrap items-center gap-1.5">
							<p class="font-medium text-sm leading-tight">{entry.title}</p>
							<!-- Treatment category badge -->
							{#if entry.treatment_category && categoryLabels[entry.treatment_category]}
								{@const cat = categoryLabels[entry.treatment_category]}
								<span class="rounded bg-primary/8 border border-primary/20 px-1.5 py-0.5 text-xs text-primary font-medium">
									{cat.icon} {cat.label}
								</span>
							{/if}
							<!-- Outcome badge -->
							{#if entry.treatment_outcome && outcomeLabels[entry.treatment_outcome]}
								{@const out = outcomeLabels[entry.treatment_outcome]}
								<span class={`rounded border px-1.5 py-0.5 text-xs font-medium ${out.colorClass}`}>
									{out.label}
								</span>
							{/if}
						</div>
						<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
							<span>{formatDate(entry.entry_date)}</span>
							{#if entry.doctor_id !== null && doctors.map.get(entry.doctor_id)}
								{@const doc = doctors.map.get(entry.doctor_id)!}
								<span class="inline-flex items-center gap-1">
									<span class="h-2 w-2 rounded-full shrink-0 inline-block" style="background:{doc.color}"></span>
									{staffLabel(doc)}
								</span>
							{:else if entry.provider}
								<span class="text-muted-foreground/50">· {entry.provider} <span class="text-[9px]">(legacy)</span></span>
							{/if}
							{#each JSON.parse(entry.colleague_ids || '[]') as colId}
								{#if doctors.map.get(colId)}
									{@const col = doctors.map.get(colId)!}
									<span
										style="--col-color: {col.color}"
										class="inline-flex items-center gap-1 rounded-full border border-[var(--col-color)]/40 bg-[var(--col-color)]/5 text-[var(--col-color)] px-2 py-0 text-[10px] font-medium"
									>
										{staffLabel(col)}
									</span>
								{/if}
							{/each}
							{#if entry.tooth_numbers}
								<span>· {i18n.t.common.tooth} {entry.tooth_numbers}</span>
							{/if}
						</div>
					</div>
				</div>

				<!-- Expand chevron -->
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					class={`h-4 w-4 shrink-0 text-muted-foreground transition-transform mt-0.5 ${expanded ? 'rotate-180' : ''}`}
				>
					<path d="M6 9l6 6 6-6" />
				</svg>
			</button>

			<!-- Expanded section -->
			{#if expanded}
				<div class="border-t px-4 pb-4 pt-3 flex flex-col gap-3">
					{#if entry.description}
						<p class="text-sm text-foreground whitespace-pre-wrap">{entry.description}</p>
					{:else}
						<p class="text-sm text-muted-foreground italic">{i18n.t.common.notes}</p>
					{/if}

					{#if entry.related_entry_id}
						<p class="text-xs text-muted-foreground/70 flex items-center gap-1">
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0">
								<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
								<path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
							</svg>
							{i18n.t.timeline.entry.relatedEntry} #{entry.related_entry_id}
						</p>
					{/if}

					<!-- Complications section (procedure/visit only) -->
					{#if isComplicationEntry}
						<div class="border-t pt-3">
							<div class="flex items-center justify-between mb-2">
								<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{i18n.t.complications.title}</span>
								<button
									type="button"
									onclick={() => (showComplicationForm = !showComplicationForm)}
									class="text-[10px] text-primary hover:underline"
								>
									{showComplicationForm ? i18n.t.actions.cancel : `+ ${i18n.t.actions.add}`}
								</button>
							</div>

							{#if complications.length > 0}
								<div class="flex flex-col gap-1.5 mb-2">
									{#each complications as comp}
										<div class="flex items-start justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
											<div class="flex-1 min-w-0">
												<span class="text-xs font-medium">{comp.complication_type}</span>
												{#if comp.description}
													<span class="text-xs text-muted-foreground ml-1.5">{comp.description}</span>
												{/if}
												{#if comp.resolved}
													<span class="ml-1.5 text-[10px] text-emerald-600">{i18n.t.complications.resolved} {comp.date_resolved}</span>
												{/if}
											</div>
											<div class="flex items-center gap-1 shrink-0">
												{#if !comp.resolved}
													<button
														type="button"
														onclick={() => handleResolveComplication(comp.id)}
														class="text-[10px] text-emerald-600 hover:underline"
														title="Mark as resolved"
													>{i18n.t.complications.resolve}</button>
												{/if}
												<button
													type="button"
													onclick={() => handleDeleteComplication(comp.id)}
													class="text-[10px] text-destructive hover:underline"
													title="Delete"
												>✕</button>
											</div>
										</div>
									{/each}
								</div>
							{:else if !showComplicationForm}
								<p class="text-xs text-muted-foreground/60 italic">{i18n.t.common.noData}</p>
							{/if}

							{#if showComplicationForm}
								<div class="flex flex-col gap-2 rounded-md border bg-muted/20 p-2.5">
									<div class="flex gap-2">
										<select
											bind:value={newComplicationType}
											class="flex-1 h-7 rounded border border-input bg-background px-2 text-xs outline-none focus:border-ring"
										>
											<option value="">Select type…</option>
											{#each complicationTypes.list as ct}
												<option value={ct.key}>{complicationTypes.displayLabel(ct)}</option>
											{/each}
										</select>
									</div>
									<input
										type="text"
										bind:value={newComplicationNotes}
										placeholder="Notes (optional)"
										class="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:border-ring"
									/>
									<div class="flex gap-2">
										<button
											type="button"
											onclick={handleAddComplication}
											disabled={isSavingComplication || !newComplicationType}
											class="h-6 rounded bg-primary px-3 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
										>
											{isSavingComplication ? i18n.t.common.loading : i18n.t.actions.save}
										</button>
										<button
											type="button"
											onclick={() => (showComplicationForm = false)}
											class="h-6 rounded border px-3 text-[10px] hover:bg-muted"
										>{i18n.t.actions.cancel}</button>
									</div>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Inline date editor (only shown when caller supports date changes) -->
					{#if onDateChange}
						<div class="flex items-center gap-2 text-xs text-muted-foreground border-t pt-2">
							<span class="font-medium text-foreground/70">{i18n.t.common.date}:</span>
							{#if editingDate}
								<!-- svelte-ignore a11y_autofocus -->
								<input
									type="date"
									value={pendingDate}
									oninput={(e) => (pendingDate = (e.target as HTMLInputElement).value)}
									onblur={commitDateEdit}
									onkeydown={onDateInputKeydown}
									autofocus
									class="text-xs border rounded px-1.5 py-0.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring/50 focus:border-ring"
								/>
								<button type="button" onclick={cancelDateEdit} class="text-muted-foreground/60 hover:text-muted-foreground transition-colors">
									Cancel
								</button>
							{:else}
								<button
									type="button"
									onclick={startDateEdit}
									class="group/date flex items-center gap-1 hover:text-foreground transition-colors"
									title="Click to change date"
								>
									{formatDate(entry.entry_date)}
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 opacity-0 group-hover/date:opacity-60 transition-opacity">
										<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
									</svg>
								</button>
							{/if}
						</div>
					{/if}

					<!-- Actions -->
					<div class="flex items-center gap-2 pt-1">
						<Button
							variant="outline"
							size="sm"
							onclick={() => onEdit(entry)}
							class="h-7 px-2.5 text-xs"
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1 h-3 w-3">
								<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
							</svg>
							{i18n.t.actions.edit}
						</Button>
						{#if onHistory}
							<Button
								variant="ghost"
								size="sm"
								onclick={() => onHistory!(entry)}
								class="h-7 px-2.5 text-xs text-muted-foreground hover:text-foreground"
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1 h-3 w-3">
									<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
								</svg>
								{i18n.t.audit.title}
							</Button>
						{/if}
						<Button
							variant="ghost"
							size="sm"
							onclick={() => onDelete(entry)}
							class="h-7 px-2.5 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1 h-3 w-3">
								<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
							</svg>
							{i18n.t.actions.delete}
						</Button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>
