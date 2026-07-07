<script lang="ts">
	import { untrack, tick } from 'svelte';
	import type { TimelineEntry, TimelineEntryType } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { Button } from '$lib/components/ui/button';
	import { openDocumentFile, fileToAssetUrl, isImageMime, formatFileSize, toAbsPath } from '$lib/services/files';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { formatDate } from '$lib/utils';
	import { vault } from '$lib/stores/vault.svelte';
	import { appointmentTypes } from '$lib/stores/appointmentTypes.svelte';
	import { entryTypes } from '$lib/stores/entryTypes.svelte';
	import { complicationTypes } from '$lib/stores/complicationTypes.svelte';
	import { getComplications, insertComplication, resolveComplication, deleteComplication } from '$lib/services/db';
	import type { Complication } from '$lib/types';
	import { toLocalISODate } from '$lib/utils';

	let {
		entry,
		onEdit,
		onDelete,
		onHistory,
		onDateChange,
		hideDateDisplay = false,
	}: {
		entry: TimelineEntry;
		onEdit: (entry: TimelineEntry) => void;
		onDelete: (entry: TimelineEntry) => void;
		onHistory?: (entry: TimelineEntry) => void;
		/** If provided, a date-edit control is shown. Caller must persist + reload. */
		onDateChange?: (entry: TimelineEntry, newDate: string) => void;
		/** When true, the per-card date text is hidden (date shown in group header instead). */
		hideDateDisplay?: boolean;
	} = $props();

	let menuOpen = $state(false);
	let descExpanded = $state(false);
	const descIsLong = $derived((entry.description ?? '').length > 350);

	// The composer auto-generates the title from the first words of the body, so
	// showing it above the description just repeats the opening line. Hide it
	// whenever it's a prefix of the description (whitespace/markup-insensitive).
	const titleIsRedundant = $derived.by(() => {
		if (!entry.description || !entry.title) return false;
		const norm = (s: string) =>
			s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/​/g, '')
				.replace(/\s+/g, ' ').trim().toLowerCase();
		const t = norm(entry.title.replace(/…$/, ''));
		return t.length > 0 && norm(entry.description).startsWith(t);
	});

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
		visit:          { icon: '🏥', label: 'Visit',     dotClass: 'bg-info',             bgClass: 'bg-info-light',                                   textClass: 'text-info'                        },
		procedure:      { icon: '🔧', label: 'Procedure', dotClass: 'bg-text-tertiary',   bgClass: 'bg-surface-tertiary dark:bg-surface-tertiary',  textClass: 'text-text-tertiary'               },
		note:           { icon: '📝', label: 'Note',      dotClass: 'bg-text-tertiary',   bgClass: 'bg-surface-tertiary dark:bg-surface-tertiary',  textClass: 'text-text-tertiary'               },
		lab:            { icon: '🧪', label: 'Lab',       dotClass: 'bg-warning',         bgClass: 'bg-warning-light',                               textClass: 'text-warning'                     },
		imaging:        { icon: '📷', label: 'Imaging',   dotClass: 'bg-primary',         bgClass: 'bg-primary-light',                               textClass: 'text-primary'                     },
		referral:       { icon: '📋', label: 'Referral',  dotClass: 'bg-critical',        bgClass: 'bg-critical-light',                              textClass: 'text-critical'                    },
		document:       { icon: '📎', label: 'File',      dotClass: 'bg-info',            bgClass: 'bg-info-light',                                  textClass: 'text-info'                        },
		plan:           { icon: '📋', label: 'Plan',      dotClass: 'bg-primary',         bgClass: 'bg-primary/5',                                   textClass: 'text-primary'                     },
		chart_snapshot: { icon: '🦷', label: 'Chart',     dotClass: 'bg-primary',         bgClass: 'bg-primary-light',                               textClass: 'text-primary'                     },
	};

	const cfg = $derived.by<StaticCfg | DynamicCfg>(() => {
		if (!entry.entry_type) return {
			icon: '—', label: i18n.t.timeline.entry.typePlaceholder,
			dotClass: 'bg-border', bgClass: 'bg-muted', textClass: 'text-muted-foreground',
		} satisfies StaticCfg;

		// For procedures, map treatment_category to procedure-type colors
		if (entry.entry_type === 'procedure' && entry.treatment_category) {
			const catColorMap: Record<string, { dotClass: string; bgClass: string; textClass: string }> = {
				endodontics:    { dotClass: 'bg-proc-endo',    bgClass: 'bg-proc-endo/10 dark:bg-proc-endo/15',   textClass: 'text-proc-endo' },
				periodontics:   { dotClass: 'bg-proc-perio',   bgClass: 'bg-proc-perio/10 dark:bg-proc-perio/15', textClass: 'text-proc-perio' },
				orthodontics:   { dotClass: 'bg-proc-ortho',   bgClass: 'bg-proc-ortho/10 dark:bg-proc-ortho/15', textClass: 'text-proc-ortho' },
				prosthodontics: { dotClass: 'bg-proc-prosth',  bgClass: 'bg-proc-prosth/10 dark:bg-proc-prosth/15', textClass: 'text-proc-prosth' },
				preventive:     { dotClass: 'bg-proc-hygiene', bgClass: 'bg-proc-hygiene/10 dark:bg-proc-hygiene/15', textClass: 'text-proc-hygiene' },
				restorative:    { dotClass: 'bg-proc-hygiene', bgClass: 'bg-proc-hygiene/10 dark:bg-proc-hygiene/15', textClass: 'text-proc-hygiene' },
				oral_surgery:   { dotClass: 'bg-critical',     bgClass: 'bg-critical-light',                        textClass: 'text-critical' },
				imaging:        { dotClass: 'bg-primary',      bgClass: 'bg-primary-light',                        textClass: 'text-primary' },
				other:          { dotClass: 'bg-text-tertiary', bgClass: 'bg-surface-tertiary dark:bg-surface-tertiary', textClass: 'text-text-tertiary' },
			};
			const catCfg = catColorMap[entry.treatment_category];
			if (catCfg) {
				const catLabel = entry.treatment_category in categoryLabels
					? categoryLabels[entry.treatment_category as keyof typeof categoryLabels].label
					: entry.treatment_category;
				return { icon: '🔧', label: catLabel, ...catCfg };
			}
		}

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
		successful:       { label: i18n.t.outcomes.successful,        colorClass: 'bg-success-light text-success border-success/20 dark:bg-success/15 dark:text-success' },
		retreated:        { label: i18n.t.outcomes.retreated,         colorClass: 'bg-warning-light text-warning border-warning/20 dark:bg-warning/15 dark:text-warning' },
		failed_extracted: { label: i18n.t.outcomes.failed_extracted,  colorClass: 'bg-critical-light text-critical border-critical/20 dark:bg-critical/15 dark:text-critical' },
		failed_other:     { label: i18n.t.outcomes.failed_other,      colorClass: 'bg-critical-light text-critical border-critical/20 dark:bg-critical/15 dark:text-critical' },
		ongoing:          { label: i18n.t.outcomes.ongoing,           colorClass: 'bg-info-light text-info border-info/20 dark:bg-info/15 dark:text-info' },
		unknown:          { label: i18n.t.outcomes.unknown,           colorClass: 'bg-muted text-text-secondary border-border dark:bg-muted dark:text-text-tertiary' },
	});

	// ── Tagged staff (floats over the description as colored pills) ──────
	const primaryDoc    = $derived(entry.doctor_id !== null ? doctors.map.get(entry.doctor_id) : undefined);
	const colleagueIds  = $derived(JSON.parse(entry.colleague_ids || '[]') as number[]);
	const hasTaggedStaff = $derived(!!primaryDoc || colleagueIds.some((id) => doctors.map.get(id)));

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
	let showComplications = $state(false);
	let showAddComplication = $state(false);
	let confirmDeleteComplicationId = $state<number | null>(null);

	let newComplicationType = $state('');
	let newComplicationSeverity = $state('mild');
	let newComplicationDescription = $state('');
	let newComplicationDate = $state(toLocalISODate());

	async function loadComplications() {
		complications = await getComplications(entry.id);
	}

	$effect(() => {
		entry.id; // reactive dependency — reload when the entry changes
		loadComplications();
	});

	const unresolvedComplicationCount = $derived(complications.filter(c => !c.resolved).length);

	function complicationTypeLabel(key: string): string {
		const item = complicationTypes.list.find(t => t.key === key);
		return item ? complicationTypes.displayLabel(item) : key;
	}

	function resetAddComplicationForm() {
		newComplicationType = '';
		newComplicationSeverity = 'mild';
		newComplicationDescription = '';
		newComplicationDate = toLocalISODate();
		showAddComplication = false;
	}

	async function handleAddComplication() {
		if (!newComplicationType) return;
		await insertComplication(entry.id, entry.patient_id, {
			complication_type: newComplicationType,
			description: newComplicationDescription.trim(),
			severity: newComplicationSeverity,
			date_reported: newComplicationDate,
		});
		resetAddComplicationForm();
		await loadComplications();
	}

	async function handleResolveComplication(c: Complication) {
		await resolveComplication(c.id, !c.resolved);
		await loadComplications();
	}

	async function handleDeleteComplication(id: number) {
		if (confirmDeleteComplicationId !== id) {
			confirmDeleteComplicationId = id;
			return;
		}
		confirmDeleteComplicationId = null;
		await deleteComplication(id);
		await loadComplications();
	}

	const complicationSeverityDotClass: Record<string, string> = {
		mild: 'bg-amber-400',
		moderate: 'bg-orange-500',
		severe: 'bg-red-600',
	};
</script>

<div class="relative flex gap-4">
	<!-- Timeline dot -->
	<div class="flex flex-col items-center">
		<div
			class={`mt-1.5 h-3.5 w-3.5 rounded-full border-2 border-background ring-2 ring-offset-0 shrink-0 ${cfg.dotClass ?? ''}`}
			style={`box-shadow: 0 0 0 2px white;${cfgDotStyle ? ' ' + cfgDotStyle : ''}`}
		></div>
	</div>

	<!-- ── Document entry — slim inline file row ── -->
	{#if entry.entry_type === 'document'}
		<div class="mb-1 flex-1">
			<!-- Single compact row — double-click anywhere on the row opens the file -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="group/doc flex items-center gap-2 rounded py-1 -mx-1 px-1 hover:bg-muted/20 transition-colors {docFile && resolvedDocPath ? 'cursor-pointer' : ''}"
				ondblclick={handleOpenFile}
				title={docFile && resolvedDocPath ? 'Double-click to open' : undefined}
			>

				<!-- File icon / tiny image thumbnail -->
				{#if docFile && isImageMime(docFile.mime)}
					<button
						type="button"
						onclick={handleImageClick}
						ondblclick={(e) => e.stopPropagation()}
						class="shrink-0 h-5 w-5 rounded overflow-hidden border bg-muted hover:opacity-75 transition-opacity"
						title="Click to preview"
					>
						<img src={fileToAssetUrl(resolvedDocPath)} alt={docFile.name} class="h-full w-full object-cover"/>
					</button>
				{:else}
					<span class="shrink-0 text-sm leading-none select-none text-muted-foreground/50">{mimeIcon(docFile?.mime ?? '')}</span>
				{/if}

				<!-- Filename -->
				<span class="text-[13px] font-medium truncate flex-1 leading-none" title={entry.title}>{entry.title}</span>

				<!-- Date (editable) · size -->
				<div class="flex items-center gap-1 text-[11px] text-muted-foreground/50 shrink-0 tabular-nums">
					{#if editingDate}
						<!-- svelte-ignore a11y_autofocus -->
						<input
							type="date"
							value={pendingDate}
							oninput={(e) => (pendingDate = (e.target as HTMLInputElement).value)}
							onblur={commitDateEdit}
							onkeydown={onDateInputKeydown}
							autofocus
							class="text-[11px] border rounded px-1 py-px bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-ring/50"
						/>
						<button type="button" onclick={cancelDateEdit} class="hover:text-foreground transition-colors">{i18n.t.actions.cancel}</button>
					{:else if !hideDateDisplay}
						<button
							type="button"
							onclick={onDateChange ? startDateEdit : undefined}
							class={onDateChange ? 'hover:text-foreground hover:underline cursor-pointer group/date flex items-center gap-1 transition-colors' : 'cursor-default'}
							title={onDateChange ? 'Click to change date' : undefined}
						>
							{formatDate(entry.entry_date)}
							{#if onDateChange}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-2 w-2 opacity-0 group-hover/date:opacity-40 transition-opacity">
									<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
								</svg>
							{/if}
						</button>
					{/if}
					{#if docFile?.size}<span>· {formatFileSize(docFile.size)}</span>{/if}
				</div>

				<!-- Open — icon-only, fades in on row hover -->
				{#if docFile && resolvedDocPath}
					<button
						type="button"
						onclick={handleOpenFile}
						class="shrink-0 opacity-0 group-hover/doc:opacity-60 hover:!opacity-100 rounded p-0.5 text-muted-foreground transition-all"
						title={i18n.t.actions.open}
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
							<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
							<polyline points="15 3 21 3 21 9"/>
							<line x1="10" y1="14" x2="21" y2="3"/>
						</svg>
					</button>
				{/if}

				<!-- 3-dot menu (delete) -->
				<div class="relative shrink-0" ondblclick={(e) => e.stopPropagation()} role="presentation">
					<button
						type="button"
						onclick={() => (menuOpen = !menuOpen)}
						class="h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover/doc:opacity-100 text-muted-foreground/40 hover:text-muted-foreground transition-all"
						title="More options"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-3.5 w-3.5">
							<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
						</svg>
					</button>
					{#if menuOpen}
						<div class="fixed inset-0 z-40" role="none" onclick={() => (menuOpen = false)}></div>
						<div class="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-border bg-popover shadow-md py-1">
							{#if onDateChange && hideDateDisplay}
								<button
									type="button"
									onclick={() => { menuOpen = false; editingDate = true; }}
									class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
								>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-muted-foreground">
										<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
									</svg>
									{i18n.t.timeline.changeDate}
								</button>
								<div class="my-1 h-px bg-border/60 mx-1"></div>
							{/if}
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

			<!-- Description (if any) -->
			{#if entry.description}
				<p class="mt-0.5 ml-1 pl-5 text-[11px] text-muted-foreground/50 truncate">{entry.description}</p>
			{/if}

			<!-- Expanded image preview -->
			{#if imageExpanded && docFile && isImageMime(docFile.mime) && resolvedDocPath}
				<div bind:this={expandedImageEl} class="mt-1 ml-1 rounded-md overflow-hidden border bg-black/5 dark:bg-white/5">
					<button
						type="button"
						onclick={handleImageClick}
						ondblclick={(e) => { e.preventDefault(); handleOpenFile(); }}
						class="block w-full cursor-zoom-in"
						title="Click to close · Double-click to open in app"
					>
						<img
							src={fileToAssetUrl(resolvedDocPath)}
							alt={docFile.name}
							class="w-full max-h-[480px] object-contain"
						/>
					</button>
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

				<!-- Title (hidden when it's just the auto-generated repeat of the body's first words) -->
				{#if !titleIsRedundant}
					<span class="text-sm font-semibold text-foreground leading-tight">{entry.title}</span>
				{/if}

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

				<!-- Complications badge — clinically important, don't bury -->
				{#if complications.length > 0}
					<button
						type="button"
						onclick={() => (showComplications = !showComplications)}
						class={`rounded border px-1.5 py-0.5 text-[10px] font-medium shrink-0 transition-colors ${unresolvedComplicationCount > 0 ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800' : 'bg-muted text-muted-foreground border-border'}`}
						title={i18n.t.complications.title}
					>
						⚠ {complications.length}
					</button>
				{/if}

				<!-- Date (hidden when group header shows it; editing input always visible) -->
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
				{:else if !hideDateDisplay}
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
						<div class="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-md border border-border bg-popover shadow-md py-1">
							{#if onDateChange && hideDateDisplay}
								<button
									type="button"
									onclick={() => { menuOpen = false; editingDate = true; }}
									class="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors"
								>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-muted-foreground">
										<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
									</svg>
									{i18n.t.timeline.changeDate}
								</button>
								<div class="my-1 h-px bg-border/60 mx-1"></div>
							{/if}
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

			<!-- Legacy provider text / tooth numbers — doctor pills float over the description below -->
			{#if (!primaryDoc && entry.provider) || entry.tooth_numbers}
				<div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 ml-[22px] text-[11px] text-muted-foreground/60">
					{#if !primaryDoc && entry.provider}
						<span class="text-muted-foreground/40">{entry.provider} <span class="text-[9px]">(legacy)</span></span>
					{/if}
					{#if entry.tooth_numbers}
						<span>{i18n.t.common.tooth} {entry.tooth_numbers}</span>
					{/if}
				</div>
			{/if}

			<!-- Description — tagged doctor/colleague pills float over its top-right corner -->
			{#if entry.description}
				<div class="relative mt-1.5 ml-[22px]">
					{#if hasTaggedStaff}
						<div class="absolute -top-1 right-0 flex flex-wrap items-center justify-end gap-1 max-w-[70%] z-10">
							{#if primaryDoc}
								<span class="h-5 rounded-full text-white text-[10px] font-medium px-2 flex items-center shadow-sm" style="background:{primaryDoc.color}">
									{staffLabel(primaryDoc)}
								</span>
							{/if}
							{#each colleagueIds as colId}
								{#if doctors.map.get(colId)}
									{@const col = doctors.map.get(colId)!}
									<span class="h-5 rounded-full text-white text-[10px] font-medium px-2 flex items-center shadow-sm" style="background:{col.color}">
										{staffLabel(col)}
									</span>
								{/if}
							{/each}
						</div>
					{/if}
					<div class="text-[13px] text-muted-foreground/80 leading-relaxed font-mono">
						{#if descExpanded || !descIsLong}
							<div class="[&_strong]:font-semibold [&_em]:italic [&_u]:underline [&_b]:font-semibold [&_i]:italic">{@html entry.description}</div>
						{:else}
							<div class="line-clamp-4 [&_strong]:font-semibold [&_em]:italic [&_u]:underline [&_b]:font-semibold [&_i]:italic">{@html entry.description}</div>
						{/if}
					</div>
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
				{#if hasTaggedStaff}
					<div class="flex flex-wrap items-center gap-1 mt-1.5 ml-[22px]">
						{#if primaryDoc}
							<span class="h-5 rounded-full text-white text-[10px] font-medium px-2 flex items-center shadow-sm" style="background:{primaryDoc.color}">
								{staffLabel(primaryDoc)}
							</span>
						{/if}
						{#each colleagueIds as colId}
							{#if doctors.map.get(colId)}
								{@const col = doctors.map.get(colId)!}
								<span class="h-5 rounded-full text-white text-[10px] font-medium px-2 flex items-center shadow-sm" style="background:{col.color}">
									{staffLabel(col)}
								</span>
							{/if}
						{/each}
					</div>
				{/if}
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
				{#if complications.length === 0}
					<button
						type="button"
						onclick={() => (showComplications = !showComplications)}
						class="text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
					>
						{i18n.t.complications.title}
					</button>
				{/if}
			</div>

			<!-- Complications panel -->
			{#if showComplications}
				<div class="ml-[22px] mt-2 rounded-md border border-border/60 bg-muted/20 p-2.5 flex flex-col gap-2">
					{#if complications.length === 0}
						<p class="text-[11px] text-muted-foreground/50 italic">{i18n.t.complications.noComplications}</p>
					{:else}
						<div class="flex flex-col gap-1.5">
							{#each complications as c (c.id)}
								<div class="flex items-start gap-2 text-[11px]">
									<span class={`mt-1 h-1.5 w-1.5 rounded-full shrink-0 ${complicationSeverityDotClass[c.severity] ?? 'bg-zinc-400'}`}></span>
									<div class="flex-1 min-w-0">
										<div class="flex items-center gap-1.5 flex-wrap">
											<span class="font-medium">{complicationTypeLabel(c.complication_type)}</span>
											<span class="text-muted-foreground/60">· {formatDate(c.date_reported)}</span>
											{#if c.resolved}
												<span class="rounded bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 px-1 py-px text-[9px] font-medium">{i18n.t.complications.resolved}</span>
											{/if}
										</div>
										{#if c.description}
											<p class="text-muted-foreground/70 mt-0.5">{c.description}</p>
										{/if}
									</div>
									<div class="flex items-center gap-2 shrink-0">
										<button
											type="button"
											onclick={() => handleResolveComplication(c)}
											class="text-primary/60 hover:text-primary transition-colors"
										>
											{c.resolved ? i18n.t.actions.reset : i18n.t.complications.resolve}
										</button>
										<button
											type="button"
											onclick={() => handleDeleteComplication(c.id)}
											class="text-destructive/60 hover:text-destructive transition-colors"
										>
											{confirmDeleteComplicationId === c.id ? i18n.t.complications.confirmDelete : i18n.t.complications.delete}
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}

					{#if showAddComplication}
						<div class="flex flex-col gap-1.5 pt-1.5 border-t border-border/50">
							<div class="flex gap-1.5">
								<select bind:value={newComplicationType} class="flex-1 text-[11px] border rounded px-1.5 py-1 bg-background">
									<option value="">{i18n.t.complications.fields.type}</option>
									{#each complicationTypes.list as t}
										<option value={t.key}>{complicationTypes.displayLabel(t)}</option>
									{/each}
								</select>
								<select bind:value={newComplicationSeverity} class="text-[11px] border rounded px-1.5 py-1 bg-background">
									<option value="mild">{i18n.t.complications.severity.mild}</option>
									<option value="moderate">{i18n.t.complications.severity.moderate}</option>
									<option value="severe">{i18n.t.complications.severity.severe}</option>
								</select>
								<input
									type="date"
									bind:value={newComplicationDate}
									class="text-[11px] border rounded px-1.5 py-1 bg-background"
								/>
							</div>
							<textarea
								bind:value={newComplicationDescription}
								placeholder={i18n.t.complications.fields.description}
								rows="2"
								class="text-[11px] border rounded px-1.5 py-1 bg-background resize-none"
							></textarea>
							<div class="flex items-center gap-2">
								<Button type="button" size="sm" disabled={!newComplicationType} onclick={handleAddComplication} class="h-6 text-[11px] px-2">
									{i18n.t.complications.add}
								</Button>
								<button type="button" onclick={resetAddComplicationForm} class="text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors">
									{i18n.t.actions.cancel}
								</button>
							</div>
						</div>
					{:else}
						<button
							type="button"
							onclick={() => (showAddComplication = true)}
							class="self-start text-[10px] text-primary/60 hover:text-primary transition-colors pt-1 border-t border-border/50 w-full text-left"
						>
							+ {i18n.t.complications.add}
						</button>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
