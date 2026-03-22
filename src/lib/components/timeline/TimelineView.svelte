<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { TimelineEntry, TimelineFormData, TreatmentPlan, TreatmentPlanFormData } from '$lib/types';
	import {
		getTimelineEntries,
		insertTimelineEntry,
		updateTimelineEntry,
		deleteTimelineEntry,
		insertDocument,
		getTrackedFilePaths,
		getTreatmentPlans,
		insertTreatmentPlan,
		getChartData,
		updateSnapshotChartData,
		syncAppointmentFromTimelineEntry,
	} from '$lib/services/db';
	import type { ToothChartEntry } from '$lib/types';
	import {
		listVaultFiles,
		getMimeType,
		formatFileSize,
		pickFile,
		saveDocumentFile,
		inferCategory,
		generateDestFilename,
		type VaultFileInfo,
	} from '$lib/services/files';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '$lib/components/ui/dialog';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '$lib/components/ui/sheet';
	import TimelineEntryCard from './TimelineEntryCard.svelte';
	import TimelineEntryForm from './TimelineEntryForm.svelte';
	import TimelineEntryBar from './TimelineEntryBar.svelte';
	import type { BarDraft } from './TimelineEntryBar.svelte';
	import type { FormPrefill } from './TimelineEntryForm.svelte';
	import PlanTimelineCard from './PlanTimelineCard.svelte';
	import ChartSnapshotCard from './ChartSnapshotCard.svelte';
	import OrthoSnapshotCard from './OrthoSnapshotCard.svelte';
	import DocTemplatePickerDialog from '$lib/components/documents/DocTemplatePickerDialog.svelte';
	import TreatmentPlanList from '$lib/components/treatment/TreatmentPlanList.svelte';
	import DentalChartView from '$lib/components/dental/DentalChartView.svelte';
	import ProbingChartDialog from '$lib/components/perio/ProbingChartDialog.svelte';
	import OrthoChartDialog from '$lib/components/ortho/OrthoChartDialog.svelte';
	import AuditLogDialog from '$lib/components/audit/AuditLogDialog.svelte';
	import { generateChartReport } from '$lib/services/chart-report';
	import { vault } from '$lib/stores/vault.svelte';
	import { docCategories } from '$lib/stores/categories.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { entryTypes } from '$lib/stores/entryTypes.svelte';
	import { i18n } from '$lib/i18n';
	import { formatDate } from '$lib/utils';

	let {
		patientId,
		patientFolder = '',
	}: {
		patientId: string;
		patientFolder?: string;
	} = $props();

	let entries    = $state<TimelineEntry[]>([]);
	let plansMap   = $state<Map<string, TreatmentPlan>>(new Map());
	let isLoading  = $state(true);
	let error      = $state('');

	// ── Filters ──────────────────────────────────────────────────────────
	let activeFilters  = $state<Set<string>>(new Set());
	let activeDoctorId = $state<number | null>(null);

	// Dropdown state
	let filterDropdownOpen = $state(false);
	let filterSearch       = $state('');

	// Text / date search
	let searchQuery = $state('');

	// All type options available for the filter dropdown
	const TYPE_OPTIONS = $derived([
		...entryTypes.list.map(t => ({ key: t.key, label: t.label, color: t.color })),
		{ key: 'document',       label: i18n.t.documents.title,    color: undefined },
		{ key: 'plan',           label: i18n.t.plans.title,        color: undefined },
		{ key: 'chart_snapshot', label: i18n.t.chart.title,        color: undefined },
		{ key: 'ortho_snapshot', label: i18n.t.ortho.button,       color: undefined },
	]);

	const visibleTypeOptions = $derived(
		filterSearch.trim()
			? TYPE_OPTIONS.filter(o => o.label.toLowerCase().includes(filterSearch.toLowerCase()))
			: TYPE_OPTIONS
	);
	const visibleDoctorOptions = $derived(
		filterSearch.trim()
			? doctors.list.filter(d => d.name.toLowerCase().includes(filterSearch.toLowerCase()))
			: doctors.list
	);

	function toggleFilter(key: string) {
		const next = new Set(activeFilters);
		if (next.has(key)) next.delete(key); else next.add(key);
		activeFilters = next;
	}

	function clearAllFilters() {
		activeFilters  = new Set();
		activeDoctorId = null;
	}

	const activeFilterCount = $derived(activeFilters.size + (activeDoctorId !== null ? 1 : 0));

	// Label lookup for active filter chips shown in trigger
	const activeTypeLabels = $derived(
		[...activeFilters].map(k => TYPE_OPTIONS.find(o => o.key === k)?.label ?? k)
	);
	const activeDoctorName = $derived(
		activeDoctorId !== null ? (doctors.list.find(d => d.id === activeDoctorId)?.name ?? '') : ''
	);

	const filteredEntries = $derived((() => {
		let list = activeFilters.size === 0 ? entries : entries.filter(e => activeFilters.has(e.entry_type));
		// Apply doctor filter
		if (activeDoctorId !== null) {
			list = list.filter(e => e.doctor_id === activeDoctorId);
		}
		// Apply text/date search
		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			list = list.filter(e =>
				(e.title ?? '').toLowerCase().includes(q) ||
				(e.description ?? '').replace(/<[^>]*>/g, '').toLowerCase().includes(q) ||
				(e.entry_date ?? '').includes(q)
			);
		}
		return list;
	})());

	// ── Form dialog ───────────────────────────────────────────────────────
	let formOpen      = $state(false);
	let editingEntry  = $state<TimelineEntry | undefined>(undefined);
	let formPrefill   = $state<FormPrefill | undefined>(undefined);
	let barRef        = $state<ReturnType<typeof TimelineEntryBar> | null>(null);

	// ── Delete dialog ─────────────────────────────────────────────────────
	let deleteDialogOpen = $state(false);
	let deletingEntry    = $state<TimelineEntry | null>(null);
	let isDeleting       = $state(false);

	// ── Scroll anchor ─────────────────────────────────────────────────────
	let bottomAnchor = $state<HTMLElement | undefined>(undefined);

	// ── Vault auto-scan ───────────────────────────────────────────────────
	let untrackedFiles = $state<VaultFileInfo[]>([]);
	let bannerDismissed = $state(false);
	let isImporting    = $state(false);

	// ── Plan sheet ────────────────────────────────────────────────────────
	let planSheetOpen = $state(false);

	// ── Probing chart ─────────────────────────────────────────────────────
	let showProbingChart = $state(false);

	// ── Ortho / KIG dialog ────────────────────────────────────────────────
	let showOrthoDialog = $state(false);

	// ── Document template picker ──────────────────────────────────────────
	let showDocTemplatePicker = $state(false);

	// ── Chart sheet ───────────────────────────────────────────────────────
	let chartSheetOpen    = $state(false);
	let chartWasModified      = $state(false);
	let viewingSnapshot       = $state<TimelineEntry | null>(null);
	let viewingSnapshotEdit   = $state(false);

	const snapshotChartData = $derived((): ToothChartEntry[] => {
		if (!viewingSnapshot?.chart_data) return [];
		try { return JSON.parse(viewingSnapshot.chart_data) as ToothChartEntry[]; } catch { return []; }
	});

	// Auto-snapshot when chart dialog closes after edits
	$effect(() => {
		if (!chartSheetOpen && chartWasModified) {
			chartWasModified = false;
			(async () => {
				const data = await getChartData(patientId);
				const today = new Date().toISOString().slice(0, 10);
				const report = generateChartReport(data);

				// Same-day dedup: delete any existing chart_snapshot for today
				const existing = entries.filter(
					e => e.entry_type === 'chart_snapshot' && e.entry_date === today
				);
				for (const old of existing) {
					await deleteTimelineEntry(old.id);
				}

				await insertTimelineEntry(patientId, {
					entry_date: today,
					entry_type: 'chart_snapshot',
					title: i18n.t.timeline.snapshot.title,
					description: report,
					chart_data: JSON.stringify(data),
					is_locked: 1,
				});
				await loadEntries(false);
			})();
		}
	});

	async function handleSnapshotSave(updatedData: ToothChartEntry[]) {
		if (!viewingSnapshot) return;
		await updateSnapshotChartData(viewingSnapshot.id, JSON.stringify(updatedData));
		// Reload entries in background so the card summary updates when the dialog closes
		loadEntries(false);
	}

	// ── Appointment sync toast ────────────────────────────────────────────
	let syncedToast = $state(false);
	let syncedTimer: ReturnType<typeof setTimeout> | null = null;
	function showSyncedToast() {
		if (syncedTimer) clearTimeout(syncedTimer);
		syncedToast = true;
		syncedTimer = setTimeout(() => (syncedToast = false), 3000);
	}

	// ── Loading ───────────────────────────────────────────────────────────

	async function loadEntries(scrollToBottom = true) {
		// Only show the loading skeleton on the first load (entries not yet populated).
		// Background refreshes (polling, post-save) update silently to prevent the
		// skeleton from shrinking the page and snapping the scroll position upward.
		const showSkeleton = entries.length === 0;
		try {
			if (showSkeleton) isLoading = true;
			error = '';
			const freshEntries = await getTimelineEntries(patientId);
			// Only reassign if something actually changed to avoid re-rendering all
			// entry cards on every poll tick when nothing has changed (visible flicker).
			if (JSON.stringify(freshEntries) !== JSON.stringify(entries)) {
				entries = freshEntries;
			}
			// Also (re)load treatment plans so plan cards can render
			const plans = await getTreatmentPlans(patientId);
			const freshMap = new Map(plans.map(p => [p.plan_id, p]));
			if (JSON.stringify([...freshMap]) !== JSON.stringify([...plansMap])) {
				plansMap = freshMap;
			}
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load timeline';
		} finally {
			isLoading = false;
			if (scrollToBottom) {
				await tick();
				requestAnimationFrame(() => {
					bottomAnchor?.scrollIntoView({ behavior: 'instant', block: 'end' });
				});
			}
		}
	}

	// ── Vault auto-scan ───────────────────────────────────────────────────

	function folderToKey(folderName: string): string {
		const match = docCategories.list.find((c) => vault.categoryFolder(c.key) === folderName);
		return match?.key ?? 'other';
	}

	async function scanVaultForUntrackedFiles() {
		if (!vault.isConfigured || !vault.path || !patientFolder) return;
		try {
			const allFiles = await listVaultFiles(vault.path, patientFolder);
			const tracked  = new Set(await getTrackedFilePaths(patientId));
			untrackedFiles = allFiles.filter((f) => !tracked.has(f.rel_path));
		} catch {
			// non-critical
		}
	}

	async function importUntrackedFiles() {
		if (!vault.isConfigured || isImporting) return;
		isImporting = true;
		try {
			const today = new Date().toISOString().slice(0, 10);
			for (const file of untrackedFiles) {
				const mime        = getMimeType(file.filename);
				const categoryKey = folderToKey(file.category_folder);
				const doc = await insertDocument(patientId, {
					filename: file.filename, original_name: file.filename,
					category: categoryKey, mime_type: mime,
					file_size: file.file_size, abs_path: file.abs_path, rel_path: file.rel_path, notes: '',
				});
				await insertTimelineEntry(patientId, {
					entry_date: today, entry_type: 'document',
					title: file.filename, description: '',
					treatment_category: categoryKey, document_id: doc.id,
					attachments: JSON.stringify([{ path: file.rel_path, name: file.filename, mime, size: file.file_size }]),
				});
			}
			untrackedFiles = [];
			bannerDismissed = false;
			await loadEntries(false);
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to import files';
		} finally {
			isImporting = false;
		}
	}

	onMount(() => {
		loadEntries().then(() => scanVaultForUntrackedFiles());

		const interval = setInterval(async () => {
			await scanVaultForUntrackedFiles();
			await loadEntries(false);
		}, 5000);

		return () => clearInterval(interval);
	});

	// ── Audit log dialog ──────────────────────────────────────────────────
	let auditOpen      = $state(false);
	let auditEntryId   = $state<string | undefined>(undefined);

	function openEntryHistory(entry: TimelineEntry) {
		auditEntryId = String(entry.id);
		auditOpen = true;
	}

	// ── Timeline entry CRUD ───────────────────────────────────────────────

	function openAddForm() { editingEntry = undefined; formPrefill = undefined; formOpen = true; }
	function openEditForm(entry: TimelineEntry) { editingEntry = entry; formPrefill = undefined; formOpen = true; }

	function openAddFormFromBar(draft: BarDraft) {
		editingEntry = undefined;
		formPrefill = {
			title:       draft.title,
			description: draft.description,
			entry_date:  draft.entry_date,
			doctor_id:   draft.doctor_id,
		};
		formOpen = true;
		// Clear the bar after a tick so the form opens cleanly
		setTimeout(() => barRef?.reset(), 50);
	}

	function openDeleteDialog(entry: TimelineEntry) {
		deletingEntry = entry;
		deleteDialogOpen = true;
	}

	async function handleSave(data: TimelineFormData) {
		if (editingEntry) {
			await updateTimelineEntry(editingEntry.id, data);
			await loadEntries(false);
			// Sync appointment type if entry has a type and a date
			if (data.entry_type && data.entry_date) {
				const synced = await syncAppointmentFromTimelineEntry(String(patientId), data.entry_date, String(editingEntry.id), data.entry_type);
				if (synced) showSyncedToast();
			}
		} else {
			const newEntry = await insertTimelineEntry(patientId, data);
			await loadEntries();
			// Sync appointment type for new entries too
			if (data.entry_type && data.entry_date) {
				const synced = await syncAppointmentFromTimelineEntry(String(patientId), data.entry_date, String(newEntry.id), data.entry_type);
				if (synced) showSyncedToast();
			}
		}
	}

	async function handleDelete() {
		if (!deletingEntry) return;
		isDeleting = true;
		try {
			await deleteTimelineEntry(deletingEntry.id);
			await loadEntries();
			deleteDialogOpen = false;
		} finally {
			isDeleting    = false;
			deletingEntry = null;
		}
	}

	async function handleDateChange(entry: TimelineEntry, newDate: string) {
		await updateTimelineEntry(entry.id, { entry_date: newDate });
		await loadEntries(false);
	}

	// ── Grouping ──────────────────────────────────────────────────────────
	function getYear(entry: TimelineEntry): string {
		return entry.entry_date?.slice(0, 4) ?? '—';
	}

	const inputClass = 'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
</script>

<!-- ── Header (sticky below patient header) ───────────────────────────── -->
<div class="sticky top-[76px] z-10 bg-background flex flex-col gap-3 pt-3 pb-3 border-b border-border/40 shadow-[0_2px_8px_-2px_hsl(var(--foreground)/0.06)] mb-4">
	<!-- Title row + action buttons -->
	<div class="flex items-center justify-between gap-2 flex-wrap">
		<div class="flex items-center gap-3">
			<h2 class="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
				{i18n.t.timeline.title}
				{#if !isLoading}
					<span class="ml-1 normal-case font-normal">({filteredEntries.length})</span>
				{/if}
			</h2>
			{#if syncedToast}
				<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3 w-3"><polyline points="20 6 9 17 4 12"/></svg>
					{i18n.t.timeline.entry.typeSynced}
				</span>
			{/if}
		</div>

		<div class="flex items-center gap-1.5 flex-wrap">
			<!-- Add document from template — visually distinct, left-anchored -->
			<button
				type="button"
				onclick={() => (showDocTemplatePicker = true)}
				class="inline-flex items-center gap-1.5 h-8 rounded-md border border-teal-200 dark:border-teal-800 bg-teal-50 dark:bg-teal-950/30 px-3 text-xs font-medium text-teal-700 dark:text-teal-400 hover:bg-teal-100 dark:hover:bg-teal-900/40 transition-colors"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
					<polyline points="14 2 14 8 20 8"/>
					<line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
				</svg>
				{i18n.t.docTemplates.button}
			</button>

			<!-- Visual separator between template button and chart buttons -->
			<span class="w-px h-5 bg-border/60 mx-0.5"></span>

			<!-- Open Chart editor -->
			<Button size="sm" variant="outline" onclick={() => (chartSheetOpen = true)}>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
					<path d="M12 2c-1.5 0-3 .5-4 1.5C6.5 5 6 7 6 9c0 3 1 6 2 9 .5 1.5 1 2 2 2h4c1 0 1.5-.5 2-2 1-3 2-6 2-9 0-2-.5-4-2-5.5C15 2.5 13.5 2 12 2z"/>
				</svg>
				{i18n.t.chart.title}
			</Button>

			<!-- Open Perio probing chart -->
			<Button size="sm" variant="outline" onclick={() => (showProbingChart = true)}>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
					<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
				</svg>
				{i18n.t.perio.title}
			</Button>

			<!-- Open KIG / Ortho assessment -->
			<Button size="sm" variant="outline" onclick={() => (showOrthoDialog = true)}>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
					<path d="M9 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9"/>
					<polyline points="9 2 9 9 16 9"/>
					<line x1="12" y1="13" x2="12" y2="17"/>
					<line x1="10" y1="15" x2="14" y2="15"/>
				</svg>
				{i18n.t.ortho.button}
			</Button>


</div>
	</div>

	<!-- Filter bar -->
	<div class="flex items-center gap-2">

		<!-- "Filter by" label + dropdown trigger -->
		<div class="relative">
			<button
				type="button"
				onclick={() => { filterDropdownOpen = !filterDropdownOpen; filterSearch = ''; }}
				class="inline-flex items-center gap-1.5 h-8 rounded-md border border-input bg-background px-3 text-xs font-medium hover:bg-muted/50 transition-colors max-w-[340px]"
			>
				<!-- Filter icon -->
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 text-muted-foreground">
					<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
				</svg>
				{#if activeFilterCount === 0}
					<span class="text-muted-foreground">{i18n.t.timeline.filter}</span>
				{:else}
					<div class="flex items-center gap-1 flex-wrap">
						{#each activeTypeLabels as lbl}
							<span class="rounded bg-primary/10 text-primary px-1.5 py-px text-[10px] font-semibold">{lbl}</span>
						{/each}
						{#if activeDoctorName}
							<span class="rounded bg-muted text-foreground px-1.5 py-px text-[10px] font-semibold">{activeDoctorName}</span>
						{/if}
					</div>
				{/if}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0 text-muted-foreground ml-0.5">
					<polyline points="6 9 12 15 18 9"/>
				</svg>
			</button>

			{#if filterDropdownOpen}
				<!-- Backdrop -->
				<div class="fixed inset-0 z-40" role="presentation" onclick={() => (filterDropdownOpen = false)}></div>

				<!-- Dropdown panel -->
				<div class="absolute top-full left-0 mt-1 z-50 w-60 rounded-lg border border-border bg-background shadow-lg overflow-hidden">
					<!-- Search within dropdown -->
					<div class="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-muted-foreground shrink-0">
							<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
						</svg>
						<input
							type="text"
							bind:value={filterSearch}
							placeholder="Suchen…"
							class="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
						/>
					</div>

					<div class="max-h-72 overflow-y-auto py-1">
						<!-- Entry types group -->
						{#if visibleTypeOptions.length > 0}
							<div class="px-2 pt-1 pb-0.5">
								<span class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide px-1">{i18n.t.settings.sections.entryTypes}</span>
							</div>
							{#each visibleTypeOptions as opt}
								<button
									type="button"
									onclick={() => toggleFilter(opt.key)}
									class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors"
								>
									<!-- Checkmark or empty box -->
									<span class={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${activeFilters.has(opt.key) ? 'bg-primary border-primary text-primary-foreground' : 'border-border'}`}>
										{#if activeFilters.has(opt.key)}
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="h-2.5 w-2.5"><polyline points="20 6 9 17 4 12"/></svg>
										{/if}
									</span>
									{#if opt.color}
										<span class="h-2 w-2 rounded-full shrink-0" style="background:{opt.color}"></span>
									{/if}
									<span class="truncate">{opt.label}</span>
								</button>
							{/each}
						{/if}

						<!-- Doctors group -->
						{#if visibleDoctorOptions.length > 0}
							<div class="px-2 pt-2 pb-0.5 border-t border-border/40 mt-1">
								<span class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide px-1">{i18n.t.staff.title}</span>
							</div>
							{#each visibleDoctorOptions as doc (doc.id)}
								<button
									type="button"
									onclick={() => (activeDoctorId = activeDoctorId === doc.id ? null : doc.id)}
									class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors"
								>
									<span class={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${activeDoctorId === doc.id ? 'bg-primary border-primary text-primary-foreground' : 'border-border'}`}>
										{#if activeDoctorId === doc.id}
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="h-2.5 w-2.5"><polyline points="20 6 9 17 4 12"/></svg>
										{/if}
									</span>
									<span class="h-2 w-2 rounded-full shrink-0" style="background:{doc.color}"></span>
									<span class="truncate">{doc.name}</span>
								</button>
							{/each}
						{/if}

						{#if visibleTypeOptions.length === 0 && visibleDoctorOptions.length === 0}
							<p class="px-3 py-3 text-xs text-muted-foreground text-center">Keine Ergebnisse</p>
						{/if}
					</div>

					<!-- Clear button -->
					{#if activeFilterCount > 0}
						<div class="border-t border-border px-2 py-1.5">
							<button
								type="button"
								onclick={clearAllFilters}
								class="w-full text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors py-0.5"
							>
								Filter zurücksetzen
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Text / date search -->
		<div class="relative flex-1 min-w-0">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground">
				<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
			</svg>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder="Text oder Datum suchen…"
				class="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs outline-none focus:border-ring placeholder:text-muted-foreground/50 transition-[border-color]"
			/>
			{#if searchQuery}
				<button
					type="button"
					onclick={() => (searchQuery = '')}
					class="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3 w-3">
						<path d="M18 6L6 18M6 6l12 12"/>
					</svg>
				</button>
			{/if}
		</div>

	</div>
</div>

<!-- ── Vault auto-scan banner ──────────────────────────────────────────── -->
{#if untrackedFiles.length > 0 && !bannerDismissed}
	<div class="rounded-lg border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 mb-4 flex items-start justify-between gap-3">
		<div class="flex items-start gap-2.5">
			<span class="text-xl mt-0.5 shrink-0">📂</span>
			<div>
				<p class="text-sm font-medium text-amber-900 dark:text-amber-200">
					{untrackedFiles.length} file{untrackedFiles.length > 1 ? 's' : ''} found in vault not yet in the timeline
				</p>
				<ul class="mt-1 space-y-0.5 max-h-28 overflow-y-auto">
					{#each untrackedFiles as f}
						<li class="text-xs text-amber-700/80 dark:text-amber-400/80 flex items-center gap-1.5">
							<span class="opacity-60">{f.category_folder}/</span>{f.filename}
							<span class="opacity-50">({formatFileSize(f.file_size)})</span>
						</li>
					{/each}
				</ul>
			</div>
		</div>
		<div class="flex items-center gap-2 shrink-0 mt-0.5">
			<Button size="sm" variant="outline" onclick={importUntrackedFiles} disabled={isImporting}
				class="border-amber-400/60 bg-amber-50 hover:bg-amber-100 text-amber-900 dark:bg-amber-950/30 dark:text-amber-300 dark:hover:bg-amber-950/50 text-xs h-7 px-3"
			>
				{isImporting ? i18n.t.common.loading : i18n.t.documents.add}
			</Button>
			<button type="button" onclick={() => (bannerDismissed = true)}
				class="text-amber-700/50 hover:text-amber-700 dark:text-amber-400/50 dark:hover:text-amber-400 transition-colors"
				title="Dismiss" aria-label="Dismiss banner"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
					<path d="M18 6L6 18M6 6l12 12"/>
				</svg>
			</button>
		</div>
	</div>
{/if}

<!-- ── Error ────────────────────────────────────────────────────────────── -->
{#if error}
	<div class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive mb-4">{error}</div>
{/if}

<!-- ── Loading ──────────────────────────────────────────────────────────── -->
{#if isLoading}
	<div class="flex flex-col gap-3">
		{#each [1, 2, 3] as _}
			<div class="h-16 animate-pulse rounded-lg border bg-muted"></div>
		{/each}
	</div>

<!-- ── Empty ────────────────────────────────────────────────────────────── -->
{:else if filteredEntries.length === 0}
	<div class="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-10">
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-3 h-10 w-10 text-muted-foreground/40">
			<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
			<line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
			<line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
			<line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
		</svg>
		{#if activeFilters.size > 0}
			<h3 class="text-sm font-medium text-muted-foreground">{i18n.t.common.noData}</h3>
			<p class="mt-1 text-xs text-muted-foreground/70">Try a different filter or add a new entry.</p>
		{:else}
			<h3 class="text-sm font-medium text-muted-foreground">{i18n.t.timeline.noEntries}</h3>
			<p class="mt-1 text-xs text-muted-foreground/70">{i18n.t.timeline.addEntry}</p>
		{/if}
	</div>

<!-- ── Timeline list ─────────────────────────────────────────────────────── -->
{:else}
	<div class="relative">
		<div class="absolute left-[5.5px] top-2 bottom-2 w-px bg-border"></div>
		<div class="pl-8">
			{#each filteredEntries as entry, i (entry.id)}
				<!-- Year separator -->
				{#if i === 0 || getYear(filteredEntries[i - 1]) !== getYear(entry)}
					<div class="relative -ml-8 mb-3 flex items-center gap-3">
						<div class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-border">
							<div class="h-1.5 w-1.5 rounded-full bg-muted-foreground"></div>
						</div>
						<span class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
							{getYear(entry)}
						</span>
					</div>
				{/if}

				<!-- Entry rendering -->
				<div class="relative -ml-8">
					{#if entry.entry_type === 'plan'}
						<PlanTimelineCard
							{entry}
							plan={plansMap.get(entry.plan_id)}
							onOpen={() => (planSheetOpen = true)}
						/>
					{:else if entry.entry_type === 'chart_snapshot'}
						<ChartSnapshotCard
							{entry}
							onView={() => (viewingSnapshot = entry)}
						/>
					{:else if entry.entry_type === 'ortho_snapshot'}
						<OrthoSnapshotCard {entry} />
					{:else}
						<TimelineEntryCard
							{entry}
							onEdit={openEditForm}
							onDelete={openDeleteDialog}
							onHistory={openEntryHistory}
							onDateChange={handleDateChange}
						/>
					{/if}
				</div>
			{/each}
			</div>
	</div>
{/if}

<!-- Spacer so the last timeline entry is never hidden under the fixed bar -->
<div class="h-56"></div>
<div bind:this={bottomAnchor}></div>

<!-- ── Fixed chatbox entry bar ────────────────────────────────────────── -->
<TimelineEntryBar
	bind:this={barRef}
	{patientId}
	onOpen={openAddFormFromBar}
/>

<!-- ── Add/Edit form dialog ────────────────────────────────────────────── -->
<TimelineEntryForm
	bind:open={formOpen}
	entry={editingEntry}
	prefill={formPrefill}
	{patientId}
	onSave={handleSave}
/>

<!-- ── Delete confirmation ─────────────────────────────────────────────── -->
<Dialog bind:open={deleteDialogOpen}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>{i18n.t.actions.delete}</DialogTitle>
			<DialogDescription>Are you sure you want to delete <strong>"{deletingEntry?.title}"</strong>? This cannot be undone.</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={() => (deleteDialogOpen = false)} disabled={isDeleting}>{i18n.t.actions.cancel}</Button>
			<Button variant="destructive" onclick={handleDelete} disabled={isDeleting}>
				{isDeleting ? i18n.t.common.loading : i18n.t.actions.delete}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- ── Treatment Plans sheet ───────────────────────────────────────────── -->
<Sheet bind:open={planSheetOpen}>
	<SheetContent side="right" class="sm:max-w-2xl overflow-y-auto p-6">
		<SheetHeader class="mb-6">
			<SheetTitle>{i18n.t.plans.title}</SheetTitle>
		</SheetHeader>
		{#if planSheetOpen}
			<TreatmentPlanList {patientId} />
		{/if}
	</SheetContent>
</Sheet>

<!-- ── Chart editor dialog ──────────────────────────────────────────────── -->
<Dialog bind:open={chartSheetOpen}>
	<DialogContent class="max-w-[1300px] sm:max-w-[1300px] max-h-[90vh] overflow-y-auto p-6 focus:outline-none outline-none">
		{#if chartSheetOpen}
			<DentalChartView {patientId} onToothSaved={() => { chartWasModified = true; }} />
		{/if}
	</DialogContent>
</Dialog>

<!-- ── Perio probing chart dialog ──────────────────────────────────────── -->
<ProbingChartDialog bind:open={showProbingChart} {patientId} onRecordSaved={() => {}} />

<!-- ── KIG / Ortho assessment dialog ──────────────────────────────────── -->
<OrthoChartDialog bind:open={showOrthoDialog} {patientId} onSaved={() => loadEntries(false)} />

<!-- ── Document template picker ──────────────────────────────────────── -->
<DocTemplatePickerDialog
	bind:open={showDocTemplatePicker}
	{patientId}
	{patientFolder}
	onAdded={() => loadEntries(false)}
/>

<!-- ── Chart snapshot viewer / editor ──────────────────────────────────── -->
<Dialog open={viewingSnapshot !== null} onOpenChange={(o) => { if (!o) { viewingSnapshot = null; viewingSnapshotEdit = false; } }}>
	<DialogContent class="max-w-[1100px] sm:max-w-[1100px] h-[92vh] flex flex-col overflow-hidden p-0">
		{#if viewingSnapshot !== null}
			<DialogHeader class="px-6 pt-5 pb-3 shrink-0 border-b border-border">
				<div class="flex items-center justify-between gap-3">
					<DialogTitle class="text-sm font-semibold">
						{i18n.t.timeline.snapshot.title} — {formatDate(viewingSnapshot.entry_date)}
					</DialogTitle>
					{#if !viewingSnapshotEdit}
						<Button size="sm" variant="outline" onclick={() => (viewingSnapshotEdit = true)}>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
								<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
							</svg>
							{i18n.t.actions.edit}
						</Button>
					{/if}
				</div>
			</DialogHeader>
			<div class="flex-1 min-h-0 overflow-y-auto px-6 py-4">
				<DentalChartView
					{patientId}
					snapshotData={snapshotChartData()}
					snapshotDescription={viewingSnapshot?.description ?? ''}
					snapshotEditMode={viewingSnapshotEdit}
					onSnapshotSave={handleSnapshotSave}
				/>
			</div>
		{/if}
	</DialogContent>
</Dialog>


<!-- ── Audit log dialog (entry-level history) ──────────────────────────── -->
<AuditLogDialog
	bind:open={auditOpen}
	{patientId}
	entityId={auditEntryId}
/>
