<script lang="ts">
	import { untrack, tick } from 'svelte';
	import type { TimelineEntry, TimelineEntryType } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { openDocumentFile, fileToAssetUrl, isImageMime, formatFileSize, toAbsPath } from '$lib/services/files';
	import { docCategories } from '$lib/stores/categories.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { formatDate } from '$lib/utils';
	import { vault } from '$lib/stores/vault.svelte';
	import { appointmentTypes } from '$lib/stores/appointmentTypes.svelte';
	import { entryTypes } from '$lib/stores/entryTypes.svelte';

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

	let menuOpen = $state(false);
	let descExpanded = $state(false);
	const descIsLong = $derived((entry.description ?? '').length > 350);

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
	// System / legacy types have fixed Tailwind colours; user-defined appointment
	// types use the hex colour stored in the appointment_types table.
	type StaticCfg = { icon: string; label: string; dotClass: string; bgClass: string; textClass: string; color?: undefined };
	type DynamicCfg = { icon: string; label: string; dotClass?: undefined; bgClass?: undefined; textClass?: undefined; color: string };

	const STATIC_TYPE_CONFIG: Record<string, StaticCfg> = {
		visit:          { icon: '🏥', label: 'Visit',     dotClass: 'bg-blue-500',   bgClass: 'bg-blue-50 dark:bg-blue-950/30',     textClass: 'text-blue-700 dark:text-blue-400'   },
		procedure:      { icon: '🔧', label: 'Procedure', dotClass: 'bg-violet-500', bgClass: 'bg-violet-50 dark:bg-violet-950/30', textClass: 'text-violet-700 dark:text-violet-400' },
		note:           { icon: '📝', label: 'Note',      dotClass: 'bg-zinc-400',   bgClass: 'bg-zinc-50 dark:bg-zinc-800/40',     textClass: 'text-zinc-600 dark:text-zinc-400'   },
		lab:            { icon: '🧪', label: 'Lab',       dotClass: 'bg-amber-500',  bgClass: 'bg-amber-50 dark:bg-amber-950/30',   textClass: 'text-amber-700 dark:text-amber-400' },
		imaging:        { icon: '📷', label: 'Imaging',   dotClass: 'bg-teal-500',   bgClass: 'bg-teal-50 dark:bg-teal-950/30',     textClass: 'text-teal-700 dark:text-teal-400'   },
		referral:       { icon: '📋', label: 'Referral',  dotClass: 'bg-rose-500',   bgClass: 'bg-rose-50 dark:bg-rose-950/30',     textClass: 'text-rose-700 dark:text-rose-400'   },
		document:       { icon: '📎', label: 'File',      dotClass: 'bg-sky-500',    bgClass: 'bg-sky-50 dark:bg-sky-950/30',       textClass: 'text-sky-700 dark:text-sky-400'     },
		plan:           { icon: '📋', label: 'Plan',      dotClass: 'bg-primary',    bgClass: 'bg-primary/5',                       textClass: 'text-primary'                       },
		chart_snapshot: { icon: '🦷', label: 'Chart',     dotClass: 'bg-indigo-500', bgClass: 'bg-indigo-50 dark:bg-indigo-950/30', textClass: 'text-indigo-700 dark:text-indigo-400' },
	};

	const cfg = $derived.by<StaticCfg | DynamicCfg>(() => {
		if (!entry.entry_type) return {
			icon: '—', label: i18n.t.timeline.entry.typePlaceholder,
			dotClass: 'bg-border', bgClass: 'bg-muted', textClass: 'text-muted-foreground',
		} satisfies StaticCfg;
		const staticCfg = STATIC_TYPE_CONFIG[entry.entry_type];
		if (staticCfg) return staticCfg;
		const appt = appointmentTypes.active.find(t => t.name === entry.entry_type);
		if (appt) return { icon: appt.short_name, label: appt.name, color: appt.color };
		return { ...STATIC_TYPE_CONFIG.note, label: entry.entry_type };
	});

	/** Inline style string for dynamic (appointment-type) badge colours */
	const cfgStyle = $derived(
		cfg.color
			? `background-color: ${cfg.color}18; color: ${cfg.color}; border: 1px solid ${cfg.color}40;`
			: undefined
	);
	const cfgDotStyle = $derived(cfg.color ? `background-color: ${cfg.color};` : undefined);

	// ── Document category metadata — driven by configurable categories store ──
	const docCatLabel = $derived(docCategories.getLabel(entry.treatment_category));
	const docCatIcon  = $derived(docCategories.getIcon(entry.treatment_category));
	const docCatColor = $derived(docCategories.getColor(entry.treatment_category));

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


</script>

<div class="relative flex gap-4">
	<!-- Timeline dot -->
	<div class="flex flex-col items-center">
		<div
			class={`mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-background ring-2 ring-offset-0 shrink-0 ${cfg.dotClass ?? ''}`}
			style={`box-shadow: 0 0 0 2px white;${cfgDotStyle ? ' ' + cfgDotStyle : ''}`}
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
						<span
							class={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium shrink-0 ${cfg.bgClass ?? ''} ${cfg.textClass ?? ''}`}
							style={cfgStyle}
						>
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

	<!-- ── Clinical entry — flat layout matching ChartSnapshotCard ── -->
	{:else}
		<div class="mb-3 flex-1 py-1">
			<!-- Title row: type icon · title · date · 3-dot menu -->
			<div class="flex items-center gap-2">
				<!-- Type icon with dynamic/static colour -->
				<span
					class={`text-sm shrink-0 ${cfg.textClass ?? ''}`}
					style={cfg.color ? `color: ${cfg.color}` : undefined}
				>{cfg.icon}</span>

				<!-- Title -->
				<span class="text-sm font-semibold text-foreground leading-tight">{entry.title}</span>

				<!-- Category badge -->
				{#if entry.treatment_category && categoryLabels[entry.treatment_category]}
					{@const cat = categoryLabels[entry.treatment_category]}
					<span class="rounded bg-primary/8 border border-primary/20 px-1.5 py-0.5 text-[10px] text-primary font-medium shrink-0">
						{cat.icon} {cat.label}
					</span>
				{/if}

				<!-- Outcome badge -->
				{#if entry.treatment_outcome && outcomeLabels[entry.treatment_outcome]}
					{@const out = outcomeLabels[entry.treatment_outcome]}
					<span class={`rounded border px-1.5 py-0.5 text-[10px] font-medium shrink-0 ${out.colorClass}`}>
						{out.label}
					</span>
				{/if}

				<!-- Date -->
				{#if editingDate}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						type="date"
						value={pendingDate}
						oninput={(e) => (pendingDate = (e.target as HTMLInputElement).value)}
						onblur={commitDateEdit}
						onkeydown={onDateInputKeydown}
						autofocus
						class="ml-1 text-xs border rounded px-1.5 py-0.5 bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring/50 focus:border-ring"
					/>
					<button type="button" onclick={cancelDateEdit} class="text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">
						{i18n.t.actions.cancel}
					</button>
				{:else}
					<button
						type="button"
						onclick={onDateChange ? startDateEdit : undefined}
						class={[
							'text-[10px] text-muted-foreground/50 transition-colors ml-0.5',
							onDateChange ? 'hover:text-muted-foreground hover:underline cursor-pointer' : 'cursor-default',
						].join(' ')}
						title={onDateChange ? 'Click to change date' : undefined}
					>
						{formatDate(entry.entry_date)}
					</button>
				{/if}

				<!-- 3-dot menu (right) -->
				<div class="relative ml-auto shrink-0">
					<button
						type="button"
						onclick={() => (menuOpen = !menuOpen)}
						class="h-5 w-5 flex items-center justify-center rounded text-muted-foreground/30 hover:text-muted-foreground transition-colors"
						title="More options"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5">
							<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
						</svg>
					</button>
					{#if menuOpen}
						<div class="fixed inset-0 z-40" role="none" onclick={() => (menuOpen = false)}></div>
						<div class="absolute right-0 top-full mt-1 z-50 min-w-[130px] rounded-md border border-border bg-popover shadow-md py-1">
							<button
								type="button"
								onclick={() => { menuOpen = false; onDelete(entry); }}
								class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors"
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
									<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>
								</svg>
								{i18n.t.actions.delete}
							</button>
						</div>
					{/if}
				</div>
			</div>

			<!-- Meta: doctor · colleagues · teeth -->
			{#if (entry.doctor_id !== null && doctors.map.get(entry.doctor_id)) || entry.provider || JSON.parse(entry.colleague_ids || '[]').some((id: number) => doctors.map.get(id)) || entry.tooth_numbers}
				<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 ml-[22px] text-[11px] text-muted-foreground/60">
					{#if entry.doctor_id !== null && doctors.map.get(entry.doctor_id)}
						{@const doc = doctors.map.get(entry.doctor_id)!}
						<span class="inline-flex items-center gap-1">
							<span class="h-1.5 w-1.5 rounded-full shrink-0 inline-block" style="background:{doc.color}"></span>
							{staffLabel(doc)}
						</span>
					{:else if entry.provider}
						<span class="text-muted-foreground/40">{entry.provider} <span class="text-[9px]">(legacy)</span></span>
					{/if}
					{#each JSON.parse(entry.colleague_ids || '[]') as colId}
						{#if doctors.map.get(colId)}
							{@const col = doctors.map.get(colId)!}
							<span
								class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
								style="border-color: {col.color}40; background-color: {col.color}0d; color: {col.color};"
							>
								{staffLabel(col)}
							</span>
						{/if}
					{/each}
					{#if entry.tooth_numbers}
						<span>{i18n.t.common.tooth} {entry.tooth_numbers}</span>
					{/if}
				</div>
			{/if}

			<!-- Description -->
			{#if entry.description}
				<div class="mt-1.5 ml-[22px] text-[13px] text-muted-foreground/80 leading-relaxed font-mono">
					{#if descExpanded || !descIsLong}
						<div class="[&_strong]:text-foreground/90 [&_em]:italic [&_u]:underline">{@html entry.description}</div>
					{:else}
						<div class="line-clamp-4 [&_strong]:text-foreground/90 [&_em]:italic [&_u]:underline">{@html entry.description}</div>
					{/if}
				</div>
				{#if descIsLong}
					<button
						type="button"
						onclick={() => (descExpanded = !descExpanded)}
						class="ml-[22px] mt-0.5 text-[10px] text-primary/60 hover:text-primary transition-colors"
					>
						{descExpanded ? i18n.t.chart.snapshotReport.showLess : i18n.t.chart.snapshotReport.showMore}
					</button>
				{/if}
			{:else}
				<p class="mt-1.5 ml-[22px] text-[11px] text-muted-foreground/30 italic">—</p>
			{/if}

			{#if entry.related_entry_id}
				<p class="ml-[22px] mt-1 text-[11px] text-muted-foreground/50 flex items-center gap-1">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5 shrink-0">
						<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
						<path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
					</svg>
					{i18n.t.timeline.entry.relatedEntry} #{entry.related_entry_id}
				</p>
			{/if}

			<!-- Subtle actions -->
			<div class="ml-[22px] mt-1.5 flex items-center gap-3">
				<button
					type="button"
					onclick={() => onEdit(entry)}
					class="text-[10px] text-primary/60 hover:text-primary transition-colors"
				>
					{i18n.t.actions.edit}
				</button>
				{#if onHistory}
					<button
						type="button"
						onclick={() => onHistory!(entry)}
						class="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
					>
						{i18n.t.audit.title}
					</button>
				{/if}
			</div>
		</div>
	{/if}
</div>
