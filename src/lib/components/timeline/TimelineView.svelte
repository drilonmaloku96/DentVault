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
	import TreatmentPlanList from '$lib/components/treatment/TreatmentPlanList.svelte';
	import DentalChartView from '$lib/components/dental/DentalChartView.svelte';
	import ProbingChartDialog from '$lib/components/perio/ProbingChartDialog.svelte';
	import AuditLogDialog from '$lib/components/audit/AuditLogDialog.svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { docCategories } from '$lib/stores/categories.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { i18n } from '$lib/i18n';

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

	// ── Filter chips ─────────────────────────────────────────────────────
	// Empty set = show all; otherwise only show entry types in the set
	let activeFilters = $state<Set<string>>(new Set());

	const FILTER_CHIPS = $derived([
		{ key: 'all',            label: i18n.t.common.all,    icon: '' },
		{ key: 'visit',          label: 'Visit',              icon: '🏥' },
		{ key: 'procedure',      label: 'Procedure',          icon: '🔧' },
		{ key: 'note',           label: 'Note',               icon: '📝' },
		{ key: 'lab',            label: 'Lab',                icon: '🧪' },
		{ key: 'imaging',        label: i18n.t.categories.imaging, icon: '📷' },
		{ key: 'referral',       label: 'Referral',           icon: '📋' },
		{ key: 'document',       label: i18n.t.documents.title,   icon: '📎' },
		{ key: 'plan',           label: i18n.t.plans.title,   icon: '📋' },
		{ key: 'chart_snapshot', label: i18n.t.chart.title,   icon: '🦷' },
	]);

	// Doc category sub-chips (shown when 'document' filter is active)
	const docSubChips = $derived([
		{ key: '__all_docs__', label: `${i18n.t.common.all} ${i18n.t.documents.title}` },
		...docCategories.list.map((c) => ({ key: vault.categoryFolder(c.key), label: `${c.icon} ${c.label}` })),
	]);
	let activeDocFolder = $state<string>('__all_docs__');

	function toggleFilter(key: string) {
		if (key === 'all') {
			activeFilters = new Set();
			activeDocFolder = '__all_docs__';
			return;
		}
		const next = new Set(activeFilters);
		if (next.has(key)) {
			next.delete(key);
		} else {
			next.add(key);
		}
		activeFilters = next;
		if (!next.has('document')) activeDocFolder = '__all_docs__';
	}

	function isFilterActive(key: string): boolean {
		if (key === 'all') return activeFilters.size === 0;
		return activeFilters.has(key);
	}

	// Doctor filter — null = show all, otherwise filter to entries with that doctor_id
	let activeDoctorId = $state<number | null>(null);

	// Clinical filters
	let showClinicalFilters = $state(false);
	let activeCategoryFilter = $state('');
	let activeOutcomeFilter = $state('');

	const CATEGORY_CHIP_CLASSES: Record<string, string> = {
		endodontics:    'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
		orthodontics:   'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400',
		prosthodontics: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
		periodontics:   'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
		oral_surgery:   'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
		restorative:    'bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-400',
		preventive:     'bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-400',
		imaging:        'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400',
		other:          'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-400',
	};

	const CATEGORY_LABELS_MAP = $derived<Record<string, string>>({
		endodontics:    i18n.t.categories.endodontics,
		orthodontics:   i18n.t.categories.orthodontics,
		prosthodontics: i18n.t.categories.prosthodontics,
		periodontics:   i18n.t.categories.periodontics,
		oral_surgery:   i18n.t.categories.oral_surgery,
		restorative:    i18n.t.categories.restorative,
		preventive:     i18n.t.categories.preventive,
		imaging:        i18n.t.categories.imaging,
		other:          i18n.t.categories.other,
	});

	const OUTCOME_CHIP_CLASSES: Record<string, string> = {
		successful:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
		retreated:        'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
		failed_extracted: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
		failed_other:     'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
		ongoing:          'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400',
		unknown:          'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-500',
	};

	const OUTCOME_LABELS_MAP = $derived<Record<string, string>>({
		successful:       i18n.t.outcomes.successful,
		retreated:        i18n.t.outcomes.retreated,
		failed_extracted: i18n.t.outcomes.failed_extracted,
		failed_other:     i18n.t.outcomes.failed_other,
		ongoing:          i18n.t.outcomes.ongoing,
		unknown:          i18n.t.outcomes.unknown,
	});

	const uniqueCategories = $derived(
		[...new Set(entries.map(e => e.treatment_category).filter(Boolean))].sort()
	);

	const uniqueOutcomes = $derived(
		[...new Set(entries.map(e => e.treatment_outcome).filter(Boolean))].sort()
	);

	const filteredEntries = $derived((() => {
		let list = activeFilters.size === 0 ? entries : entries.filter(e => activeFilters.has(e.entry_type));
		// Apply doc sub-filter
		if (activeFilters.has('document') && activeDocFolder !== '__all_docs__') {
			list = list.filter(e =>
				e.entry_type !== 'document' ||
				vault.categoryFolder(e.treatment_category) === activeDocFolder,
			);
		}
		// Apply doctor filter
		if (activeDoctorId !== null) {
			list = list.filter(e => e.doctor_id === activeDoctorId);
		}
		// Apply clinical category filter
		if (activeCategoryFilter) {
			list = list.filter(e => e.treatment_category === activeCategoryFilter);
		}
		// Apply clinical outcome filter
		if (activeOutcomeFilter) {
			list = list.filter(e => e.treatment_outcome === activeOutcomeFilter);
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

	// ── Upload dialog ─────────────────────────────────────────────────────
	let showUploadDialog = $state(false);
	let pickedPath       = $state<string | null>(null);
	let pickedName       = $state('');
	let uploadCategory   = $state<string>('other');
	let uploadNotes      = $state('');
	let isUploading      = $state(false);
	let uploadError      = $state('');

	// ── Plan sheet ────────────────────────────────────────────────────────
	let planSheetOpen = $state(false);
	// (TreatmentPlanList uses patientId, no extra state needed)

	// ── Plan create dialog ────────────────────────────────────────────────
	let createPlanOpen  = $state(false);
	let newPlanTitle    = $state('');
	let newPlanDesc     = $state('');
	let isCreatingPlan  = $state(false);
	let createPlanError = $state('');

	// ── Probing chart ─────────────────────────────────────────────────────
	let showProbingChart = $state(false);

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
				await insertTimelineEntry(patientId, {
					entry_date: today,
					entry_type: 'chart_snapshot',
					title: 'Dental Chart Snapshot',
					description: '',
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

	// ── Loading ───────────────────────────────────────────────────────────

	async function loadEntries(scrollToBottom = true) {
		// Only show the loading skeleton on the first load (entries not yet populated).
		// Background refreshes (polling, post-save) update silently to prevent the
		// skeleton from shrinking the page and snapping the scroll position upward.
		const showSkeleton = entries.length === 0;
		try {
			if (showSkeleton) isLoading = true;
			error = '';
			entries = await getTimelineEntries(patientId);
			// Also (re)load treatment plans so plan cards can render
			const plans = await getTreatmentPlans(patientId);
			plansMap = new Map(plans.map(p => [p.plan_id, p]));
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
		} else {
			await insertTimelineEntry(patientId, data);
			await loadEntries();
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

	// ── Upload file ───────────────────────────────────────────────────────

	async function handlePickFile() {
		uploadError = '';
		const path = await pickFile();
		if (!path) return;
		pickedPath = path;
		const parts = path.replace(/\\/g, '/').split('/');
		pickedName = parts[parts.length - 1];
		const mime = getMimeType(pickedName);
		uploadCategory = inferCategory(pickedName, mime);
		showUploadDialog = true;
	}

	async function handleUpload() {
		if (!pickedPath) return;
		if (!vault.isConfigured || !vault.path) {
			uploadError = 'Vault not configured. Please set up your vault in Settings.';
			return;
		}
		isUploading = true;
		uploadError = '';
		try {
			const destFilename  = generateDestFilename(pickedPath);
			const mime          = getMimeType(pickedName);
			const categoryFolder = vault.categoryFolder(uploadCategory);

			const { absPath, relPath, fileSize } = await saveDocumentFile({
				srcPath: pickedPath, vaultPath: vault.path,
				patientFolder, categoryFolder, destFilename,
			});

			const doc = await insertDocument(patientId, {
				filename: destFilename, original_name: pickedName,
				category: uploadCategory, mime_type: mime,
				file_size: fileSize, abs_path: absPath, rel_path: relPath, notes: uploadNotes.trim(),
			});

			const today = new Date().toISOString().slice(0, 10);
			await insertTimelineEntry(patientId, {
				entry_date: today, entry_type: 'document',
				title: pickedName, description: uploadNotes.trim(),
				treatment_category: uploadCategory, document_id: doc.id,
				attachments: JSON.stringify([{ path: relPath, name: pickedName, mime, size: fileSize }]),
			});

			await loadEntries();
			showUploadDialog = false;
			pickedPath = null; pickedName = ''; uploadNotes = '';
			uploadCategory = docCategories.list[0]?.key ?? 'other';
		} catch (e) {
			uploadError = String(e);
		} finally {
			isUploading = false;
		}
	}

	function handleCancelUpload() {
		showUploadDialog = false;
		pickedPath = null; pickedName = ''; uploadNotes = ''; uploadError = '';
	}

	// ── Treatment Plans ───────────────────────────────────────────────────

	async function handleCreatePlan() {
		if (!newPlanTitle.trim()) { createPlanError = i18n.t.common.required; return; }
		createPlanError = '';
		isCreatingPlan = true;
		try {
			const planData: TreatmentPlanFormData = { title: newPlanTitle.trim(), description: newPlanDesc.trim() || undefined };
			const plan = await insertTreatmentPlan(patientId, planData);
			// Create a timeline entry for this plan
			const today = new Date().toISOString().slice(0, 10);
			await insertTimelineEntry(patientId, {
				entry_date: today,
				entry_type: 'plan',
				title: plan.title,
				description: plan.description || '',
				plan_id: plan.plan_id,
			});
			createPlanOpen = false;
			newPlanTitle = ''; newPlanDesc = '';
			await loadEntries();
			// Open the plan sheet so user can add procedures immediately
			planSheetOpen = true;
		} catch (err) {
			createPlanError = err instanceof Error ? err.message : 'Failed to create plan';
		} finally {
			isCreatingPlan = false;
		}
	}


	// ── Grouping ──────────────────────────────────────────────────────────
	function getYear(entry: TimelineEntry): string {
		return entry.entry_date?.slice(0, 4) ?? '—';
	}

	const inputClass = 'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
</script>

<!-- ── Header (sticky below patient header) ───────────────────────────── -->
<div class="sticky top-[140px] z-10 bg-background flex flex-col gap-3 pt-3 pb-3 border-b border-border/40 shadow-[0_2px_8px_-2px_hsl(var(--foreground)/0.06)] mb-4">
	<!-- Title row + action buttons -->
	<div class="flex items-center justify-between gap-2 flex-wrap">
		<h2 class="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
			{i18n.t.timeline.title}
			{#if !isLoading}
				<span class="ml-1 normal-case font-normal">({filteredEntries.length})</span>
			{/if}
		</h2>

		<div class="flex items-center gap-1.5 flex-wrap">
			<!-- Upload File -->
			<Button
				size="sm"
				variant="outline"
				onclick={handlePickFile}
				disabled={!vault.isConfigured}
				title={vault.isConfigured ? undefined : 'Vault not configured'}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
					<polyline points="17 8 12 3 7 8"/>
					<line x1="12" y1="3" x2="12" y2="15"/>
				</svg>
				{i18n.t.documents.uploadTitle}
			</Button>

			<!-- New Plan -->
			<Button size="sm" variant="outline" onclick={() => (createPlanOpen = true)}>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
					<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
					<polyline points="14 2 14 8 20 8"/>
					<line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
				</svg>
				{i18n.t.plans.new}
			</Button>

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


</div>
	</div>

	<!-- Filter chip row -->
	<div class="flex flex-wrap gap-1.5">
		{#each FILTER_CHIPS as chip}
			<button
				type="button"
				onclick={() => toggleFilter(chip.key)}
				class={[
					'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors border',
					isFilterActive(chip.key)
						? 'bg-primary text-primary-foreground border-primary'
						: 'bg-transparent text-muted-foreground border-border hover:border-foreground/40 hover:text-foreground',
				].join(' ')}
			>
				{#if chip.icon}<span>{chip.icon}</span>{/if}
				{chip.label}
			</button>
		{/each}
	</div>

	<!-- Doc sub-category chips (only when document filter active) -->
	{#if activeFilters.has('document')}
		<div class="flex flex-wrap gap-1 pl-2 border-l-2 border-border/50 ml-1">
			{#each docSubChips as sub}
				<button
					type="button"
					onclick={() => (activeDocFolder = sub.key)}
					class={[
						'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors',
						activeDocFolder === sub.key
							? 'bg-primary/10 text-primary border border-primary/30'
							: 'bg-muted text-muted-foreground hover:text-foreground',
					].join(' ')}
				>
					{sub.label}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Doctor filter chips (only when doctors exist) -->
	{#if doctors.list.length > 0}
		<div class="flex flex-wrap gap-1 items-center">
			<span class="text-[10px] text-muted-foreground/50 uppercase tracking-wide mr-0.5">Dr.</span>
			{#each doctors.list as doc (doc.id)}
				<button
					type="button"
					onclick={() => (activeDoctorId = activeDoctorId === doc.id ? null : doc.id)}
					style="--doc-color: {doc.color}"
					class={[
						'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors border',
						activeDoctorId === doc.id
							? 'border-[var(--doc-color)] bg-[var(--doc-color)] text-white'
							: 'border-border bg-transparent text-muted-foreground hover:border-[var(--doc-color)] hover:text-foreground',
					].join(' ')}
				>
					{doc.name}
				</button>
			{/each}
		</div>
	{/if}

	<!-- Clinical filters toggle -->
	<button
		type="button"
		onclick={() => (showClinicalFilters = !showClinicalFilters)}
		class="inline-flex items-center gap-1 text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors self-start"
	>
		{i18n.t.timeline.filter} {showClinicalFilters ? '▾' : '▸'}
	</button>

	{#if showClinicalFilters}
		<!-- Category chips -->
		{#if uniqueCategories.length > 0}
			<div class="flex flex-wrap gap-1 items-center pl-2 border-l-2 border-border/50 ml-1">
				<span class="text-[10px] text-muted-foreground/50 uppercase tracking-wide mr-0.5 shrink-0">{i18n.t.timeline.entry.category}</span>
				<button
					type="button"
					onclick={() => (activeCategoryFilter = '')}
					class={[
						'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors border',
						activeCategoryFilter === ''
							? 'bg-primary text-primary-foreground border-primary'
							: 'bg-transparent text-muted-foreground border-border hover:border-foreground/40',
					].join(' ')}
				>{i18n.t.common.all}</button>
				{#each uniqueCategories as cat}
					<button
						type="button"
						onclick={() => (activeCategoryFilter = activeCategoryFilter === cat ? '' : cat)}
						class={[
							'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors border',
							activeCategoryFilter === cat
								? (CATEGORY_CHIP_CLASSES[cat] ?? 'bg-primary text-primary-foreground') + ' border-transparent'
								: 'bg-transparent text-muted-foreground border-border hover:border-foreground/40',
						].join(' ')}
					>
						{CATEGORY_LABELS_MAP[cat] ?? cat}
					</button>
				{/each}
			</div>
		{/if}

		<!-- Outcome chips -->
		{#if uniqueOutcomes.length > 0}
			<div class="flex flex-wrap gap-1 items-center pl-2 border-l-2 border-border/50 ml-1">
				<span class="text-[10px] text-muted-foreground/50 uppercase tracking-wide mr-0.5 shrink-0">{i18n.t.timeline.entry.outcome}</span>
				<button
					type="button"
					onclick={() => (activeOutcomeFilter = '')}
					class={[
						'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors border',
						activeOutcomeFilter === ''
							? 'bg-primary text-primary-foreground border-primary'
							: 'bg-transparent text-muted-foreground border-border hover:border-foreground/40',
					].join(' ')}
				>{i18n.t.common.all}</button>
				{#each uniqueOutcomes as out}
					<button
						type="button"
						onclick={() => (activeOutcomeFilter = activeOutcomeFilter === out ? '' : out)}
						class={[
							'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors border',
							activeOutcomeFilter === out
								? (OUTCOME_CHIP_CLASSES[out] ?? 'bg-primary text-primary-foreground') + ' border-transparent'
								: 'bg-transparent text-muted-foreground border-border hover:border-foreground/40',
						].join(' ')}
					>
						{OUTCOME_LABELS_MAP[out] ?? out}
					</button>
				{/each}
			</div>
		{/if}
	{/if}
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

<!-- ── Upload File dialog ──────────────────────────────────────────────── -->
<Dialog bind:open={showUploadDialog}>
	<DialogContent class="max-w-md">
		<DialogHeader>
			<DialogTitle>{i18n.t.documents.uploadTitle}</DialogTitle>
			<DialogDescription>Add a file to this patient's vault folder.</DialogDescription>
		</DialogHeader>
		<div class="flex flex-col gap-4 py-2">
			<div class="flex flex-col gap-1.5">
				<Label class="text-xs">Selected File</Label>
				<div class="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground truncate">{pickedName || '—'}</div>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label class="text-xs">{i18n.t.documents.category}</Label>
				<select class={inputClass} bind:value={uploadCategory}>
					{#each docCategories.list as cat}
						<option value={cat.key}>{cat.icon} {cat.label}</option>
					{/each}
				</select>
				<p class="text-[10px] text-muted-foreground/60">
					Folder: <code>{vault.categoryFolder(uploadCategory)}/</code>
					· <a href="/settings" class="underline hover:text-foreground">Manage categories</a>
				</p>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label class="text-xs">{i18n.t.common.notes} <span class="text-muted-foreground">({i18n.t.common.optional})</span></Label>
				<input type="text" class={inputClass} placeholder="Brief description…" bind:value={uploadNotes} />
			</div>
			{#if uploadError}
				<p class="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">{uploadError}</p>
			{/if}
		</div>
		<DialogFooter>
			<Button variant="outline" onclick={handleCancelUpload} disabled={isUploading}>{i18n.t.actions.cancel}</Button>
			<Button onclick={handleUpload} disabled={isUploading || !pickedPath}>
				{isUploading ? i18n.t.common.loading : i18n.t.actions.save}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- ── New Plan dialog ──────────────────────────────────────────────────── -->
<Dialog bind:open={createPlanOpen}>
	<DialogContent class="max-w-md">
		<DialogHeader>
			<DialogTitle>{i18n.t.plans.new}</DialogTitle>
			<DialogDescription>Create a plan to track multi-step treatment for this patient.</DialogDescription>
		</DialogHeader>
		<div class="flex flex-col gap-4 py-2">
			{#if createPlanError}
				<p class="text-sm text-destructive">{createPlanError}</p>
			{/if}
			<div class="flex flex-col gap-1.5">
				<Label>{i18n.t.plans.fields.name} <span class="text-destructive">*</span></Label>
				<Input placeholder="e.g. Full mouth rehabilitation" bind:value={newPlanTitle} />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label>{i18n.t.plans.fields.description}</Label>
				<Textarea placeholder="Optional notes…" class="min-h-[70px]" bind:value={newPlanDesc} />
			</div>
		</div>
		<DialogFooter>
			<Button variant="outline" onclick={() => (createPlanOpen = false)} disabled={isCreatingPlan}>{i18n.t.actions.cancel}</Button>
			<Button onclick={handleCreatePlan} disabled={isCreatingPlan}>
				{isCreatingPlan ? i18n.t.common.loading : i18n.t.actions.confirm}
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

<!-- ── Chart snapshot viewer / editor ──────────────────────────────────── -->
<Dialog open={viewingSnapshot !== null} onOpenChange={(o) => { if (!o) { viewingSnapshot = null; viewingSnapshotEdit = false; } }}>
	<DialogContent class="max-w-[1100px] sm:max-w-[1100px] h-[92vh] flex flex-col overflow-hidden p-0">
		{#if viewingSnapshot !== null}
			<DialogHeader class="px-6 pt-5 pb-3 shrink-0 border-b border-border">
				<div class="flex items-center justify-between gap-3">
					<DialogTitle class="text-sm font-semibold">
						{i18n.t.timeline.snapshot.title} — {new Date(viewingSnapshot.entry_date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
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
