<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { cephSelection } from '$lib/stores/cephSelection.svelte';
	import { sidebarWidth } from '$lib/stores/sidebarWidth.svelte';
	import type { TimelineEntry, TimelineFormData, TreatmentPlan, TreatmentPlanFormData } from '$lib/types';
	import {
		getTimelineEntries,
		insertTimelineEntry,
		updateTimelineEntry,
		deleteTimelineEntry,
		getTreatmentPlans,
		insertTreatmentPlan,
		getTreatmentPlanItems,
		getChartData,
		updateSnapshotChartData,
		syncAppointmentFromTimelineEntry,
		recordChartHistory,
		deleteChartHistoryForSnapshot,
	} from '$lib/services/db';
	import type { ToothChartEntry } from '$lib/types';
	import { listen } from '@tauri-apps/api/event';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '$lib/components/ui/dialog';
	import { Sheet, SheetContent, SheetHeader, SheetTitle } from '$lib/components/ui/sheet';
	import FullScreenView from '$lib/components/ui/FullScreenView.svelte';
	import TimelineEntryCard from './TimelineEntryCard.svelte';
	import TimelineEntryForm from './TimelineEntryForm.svelte';
	import TimelineEntryBar from './TimelineEntryBar.svelte';
	import type { FormPrefill } from './TimelineEntryForm.svelte';
	import ChartSnapshotCard from './ChartSnapshotCard.svelte';
	import OrthoSnapshotCard from './OrthoSnapshotCard.svelte';
	import DocTemplatePickerDialog from '$lib/components/documents/DocTemplatePickerDialog.svelte';
	import VaultDropDialog from './VaultDropDialog.svelte';
	import TreatmentPlanList from '$lib/components/treatment/TreatmentPlanList.svelte';
	import DentalChartView from '$lib/components/dental/DentalChartView.svelte';
	import TherapyPlanView from '$lib/components/therapy-plan/TherapyPlanView.svelte';
	import ActivePlanBar from '$lib/components/therapy-plan/ActivePlanBar.svelte';
	import OrthoChartDialog from '$lib/components/ortho/OrthoChartDialog.svelte';
	import AuditLogDialog from '$lib/components/audit/AuditLogDialog.svelte';
	import { generateChartReport } from '$lib/services/chart-report';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { entryTypes } from '$lib/stores/entryTypes.svelte';
	import { i18n } from '$lib/i18n';
	import { toLocalISODate, formatDate } from '$lib/utils';

	let {
		patientId,
		patientFolder = '',
		headerHeight = 64,
	}: {
		patientId: string;
		patientFolder?: string;
		headerHeight?: number;
	} = $props();

	let entries       = $state<TimelineEntry[]>([]);
	let plansMap      = $state<Map<string, TreatmentPlan>>(new Map());
	// Ceph Analysis toolbar button activates when the sidebar file-tree selection
	// is a Cephalyzer-compatible file belonging to this patient
	const cephEnabled = $derived(cephSelection.isAnalyzable && cephSelection.file?.patientId === patientId);
	let isLoading     = $state(true);
	let hasEverLoaded = $state(false);
	let error         = $state('');

	// ── Filters ──────────────────────────────────────────────────────────
	let typeFilters    = $state<Set<string>>(new Set());
	let activeDoctorId = $state<number | null>(null);

	// Dropdown state
	let filterDropdownOpen = $state(false);

	// Text / date search
	let searchQuery = $state('');

	const SYSTEM_TYPES = new Set(['document', 'chart_snapshot', 'ortho_snapshot', 'plan', 'par_step']);

	function typeLabel(key: string): string {
		if (key === '')                return i18n.t.timeline.typeLabels.unclassified;
		if (key === 'document')       return i18n.t.timeline.typeLabels.documents;
		if (key === 'chart_snapshot') return i18n.t.timeline.typeLabels.chartSnapshots;
		if (key === 'ortho_snapshot') return i18n.t.timeline.typeLabels.orthoRecords;
		if (key === 'plan')           return i18n.t.timeline.typeLabels.plans;
		if (key === 'par_step')       return i18n.t.timeline.typeLabels.parSteps;
		return entryTypes.labelFor(key);
	}

	function parseParMeta(desc: string): { bop: number; max_pocket: number; risk: string } | null {
		try {
			const obj = JSON.parse(desc);
			if (typeof obj?.bop === 'number') return obj as { bop: number; max_pocket: number; risk: string };
		} catch { /* */ }
		return null;
	}

	// Derive distinct types from this patient's actual entries, with counts
	const availableTypes = $derived.by(() => {
		const counts = new Map<string, number>();
		for (const e of entries) {
			const k = e.entry_type ?? '';
			counts.set(k, (counts.get(k) ?? 0) + 1);
		}
		const clinical: Array<{ key: string; label: string; count: number }> = [];
		const system:   Array<{ key: string; label: string; count: number }> = [];
		for (const [key, count] of counts) {
			const item = { key, label: typeLabel(key), count };
			if (SYSTEM_TYPES.has(key)) system.push(item); else clinical.push(item);
		}
		clinical.sort((a, b) => b.count - a.count);
		return [...clinical, ...system];
	});

	function toggleFilter(typeKey: string) {
		const next = new Set(typeFilters);
		if (next.has(typeKey)) next.delete(typeKey); else next.add(typeKey);
		typeFilters = next;
	}

	function clearAllFilters() {
		typeFilters    = new Set();
		activeDoctorId = null;
	}

	const activeFilterCount = $derived(typeFilters.size + (activeDoctorId !== null ? 1 : 0));

	const activeTypeLabels = $derived([...typeFilters].map(k => typeLabel(k)));
	const activeDoctorName = $derived(
		activeDoctorId !== null ? (doctors.list.find(d => d.id === activeDoctorId)?.name ?? '') : ''
	);

	const filteredEntries = $derived((() => {
		let list = typeFilters.size === 0 ? entries : entries.filter(e => typeFilters.has(e.entry_type ?? ''));
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

	// ── OS drag-and-drop (Tauri native events) ────────────────────────────
	let isDragOver       = $state(false);
	let droppedFilePaths = $state<string[]>([]);
	let dropDialogOpen   = $state(false);

	// ── Plan sheet ────────────────────────────────────────────────────────
	let planSheetOpen = $state(false);

	// ── Therapy plan view ─────────────────────────────────────────────────
	let therapyPlanOpen = $state(false);

	// All non-completed/non-cancelled plans (drives ActivePlanBar buttons)
	const ACTIVE_PLAN_STATUSES = new Set(['proposed', 'accepted', 'in_progress']);
	const activePlans = $derived(
		[...plansMap.values()].filter(p => ACTIVE_PLAN_STATUSES.has(p.status))
	);

	// ── Probing chart ─────────────────────────────────────────────────────

	// ── Ortho / KIG dialog ────────────────────────────────────────────────
	let showOrthoDialog = $state(false);
	let viewingOrthoEntry = $state<TimelineEntry | null>(null);
	// Clear existing entry reference when dialog closes
	$effect(() => { if (!showOrthoDialog) viewingOrthoEntry = null; });

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
				const today = toLocalISODate();
				const report = generateChartReport(data);

				// Same-day dedup: delete any existing chart_snapshot for today
				// (including its per-tooth history rows, which would otherwise
				// linger with snapshot_entry_id = NULL and duplicate the day)
				const existing = entries.filter(
					e => e.entry_type === 'chart_snapshot' && e.entry_date === today
				);
				for (const old of existing) {
					await deleteChartHistoryForSnapshot(old.id);
					await deleteTimelineEntry(old.id);
				}

				const snapshotEntry = await insertTimelineEntry(patientId, {
					entry_date: today,
					entry_type: 'chart_snapshot',
					title: i18n.t.timeline.snapshot.title,
					description: report,
					chart_data: JSON.stringify(data),
					is_locked: 1,
				});
				// Record per-tooth history — feeds the tooth history panel and
				// per-tooth progression statistics
				await recordChartHistory(patientId, snapshotEntry.id);
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

	function entryFingerprint(e: TimelineEntry) { return `${e.id}|${e.updated_at}`; }

	async function loadEntries(scrollToBottom = true) {
		// Only show the loading skeleton on the very first load — never on background polls.
		// Using entries.length === 0 was wrong: it fired on every poll for patients with
		// no entries, causing a continuous skeleton flash every 5 seconds.
		const showSkeleton = !hasEverLoaded;
		try {
			if (showSkeleton) isLoading = true;
			error = '';
			const freshEntries = await getTimelineEntries(patientId);
			hasEverLoaded = true;
			// Lightweight fingerprint comparison — avoids full JSON stringify on every poll.
			const freshPrint = freshEntries.map(entryFingerprint).join(',');
			const curPrint   = entries.map(entryFingerprint).join(',');
			if (freshPrint !== curPrint) {
				entries = freshEntries;
			}
			// Also (re)load treatment plans so plan cards can render
			const plans = await getTreatmentPlans(patientId);
			const freshMap = new Map(plans.map(p => [p.plan_id, p]));
			const freshMapPrint = plans.map(p => `${p.plan_id}|${p.updated_at}`).join(',');
			const curMapPrint   = [...plansMap.values()].map(p => `${p.plan_id}|${p.updated_at}`).join(',');
			if (freshMapPrint !== curMapPrint) {
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

	onMount(() => {
		loadEntries();

		const interval = setInterval(() => loadEntries(false), 5000);

		// Tauri intercepts OS file drops — dataTransfer.files is always empty in WKWebView.
		// Use Tauri's native drag events instead.
		const unlistenPromises = [
			listen('tauri://drag-enter', () => { isDragOver = true; }),
			listen('tauri://drag-leave', () => { isDragOver = false; }),
			listen<{ paths: string[] }>('tauri://drag-drop', (event) => {
				isDragOver = false;
				if (!event.payload.paths.length) return; // ignore if no files (e.g. internal drag)
				droppedFilePaths = event.payload.paths;
				dropDialogOpen = true;
			}),
		];

		return () => {
			clearInterval(interval);
			unlistenPromises.forEach(p => p.then(fn => fn()));
		};
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

	async function handleBarSave(data: TimelineFormData) {
		const newEntry = await insertTimelineEntry(patientId, data);
		await loadEntries();
		if (data.entry_type && data.entry_date) {
			const synced = await syncAppointmentFromTimelineEntry(String(patientId), data.entry_date, String(newEntry.id), data.entry_type, data.doctor_id != null ? String(data.doctor_id) : null);
			if (synced) showSyncedToast();
		}
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
				const synced = await syncAppointmentFromTimelineEntry(String(patientId), data.entry_date, String(editingEntry.id), data.entry_type, data.doctor_id != null ? String(data.doctor_id) : null);
				if (synced) showSyncedToast();
			}
		} else {
			const newEntry = await insertTimelineEntry(patientId, data);
			await loadEntries();
			// Sync appointment type for new entries too
			if (data.entry_type && data.entry_date) {
				const synced = await syncAppointmentFromTimelineEntry(String(patientId), data.entry_date, String(newEntry.id), data.entry_type, data.doctor_id != null ? String(data.doctor_id) : null);
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

	// ── Date grouping ─────────────────────────────────────────────────────
	interface DateGroup { date: string; entries: TimelineEntry[]; }
	const dateGroups = $derived((() => {
		const groups: DateGroup[] = [];
		for (const entry of filteredEntries) {
			const last = groups[groups.length - 1];
			if (last && last.date === (entry.entry_date ?? '')) {
				last.entries.push(entry);
			} else {
				groups.push({ date: entry.entry_date ?? '', entries: [entry] });
			}
		}
		return groups;
	})());

		const inputClass = 'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
</script>

<!-- ── Drop zone wrapper ──────────────────────────────────────────────── -->
<div class="relative">

{#if isDragOver}
	<div style="left: {sidebarWidth.px}px" class="fixed inset-y-0 right-0 z-50 flex flex-col items-center justify-center gap-3 border-2 border-dashed border-primary bg-primary/5 backdrop-blur-[1px] pointer-events-none">
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-10 w-10 text-primary/60">
			<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
			<polyline points="17 8 12 3 7 8"/>
			<line x1="12" y1="3" x2="12" y2="15"/>
		</svg>
		<p class="text-sm font-semibold text-primary/80">{i18n.t.timeline.vaultDrop.dropOverlayTitle}</p>
		<p class="text-xs text-primary/50">{i18n.t.timeline.vaultDrop.dropOverlaySubtitle}</p>
	</div>
{/if}

<!-- ── Header (fixed below patient header, top tracks header height) ─────── -->
<div class="fixed right-0 z-10 bg-background flex items-center gap-2 pt-2 pb-2 px-6 border-b border-border/40 shadow-[0_2px_8px_-2px_hsl(var(--foreground)/0.06)]" style="top: {headerHeight}px; left: {sidebarWidth.px}px">

	<!-- Filter bar (left side, compact) -->
	<div class="flex items-center gap-1.5 min-w-0 flex-1">

		<!-- Filter dropdown trigger -->
		<div class="relative shrink-0">
			<button
				type="button"
				onclick={() => { filterDropdownOpen = !filterDropdownOpen; }}
				class="inline-flex items-center gap-1 h-7 rounded-md border border-input bg-background px-2 text-xs font-medium hover:bg-muted/50 transition-colors"
			>
				<!-- Filter icon -->
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0 text-muted-foreground">
					<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
				</svg>
				{#if activeFilterCount === 0}
					<span class="text-muted-foreground text-[11px]">{i18n.t.timeline.filter}</span>
				{:else}
					<div class="flex items-center gap-1 overflow-hidden">
						{#if activeTypeLabels.length === 1}
							<span class="rounded bg-primary/10 text-primary px-1 py-px text-[10px] font-semibold truncate max-w-[120px]">{activeTypeLabels[0]}</span>
						{:else if activeTypeLabels.length > 1}
							<span class="rounded bg-primary/10 text-primary px-1 py-px text-[10px] font-semibold shrink-0">{activeTypeLabels.length} types</span>
						{/if}
						{#if activeDoctorName}
							<span class="rounded bg-muted text-foreground px-1 py-px text-[10px] font-semibold truncate max-w-[80px]">{activeDoctorName}</span>
						{/if}
					</div>
				{/if}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0 text-muted-foreground">
					<polyline points="6 9 12 15 18 9"/>
				</svg>
			</button>

			{#if filterDropdownOpen}
				<!-- Backdrop -->
				<div class="fixed inset-0 z-40" role="presentation" onclick={() => (filterDropdownOpen = false)}></div>

				<!-- Dropdown panel -->
				<div class="absolute top-full left-0 mt-1 z-50 w-52 rounded-lg border border-border bg-background shadow-lg overflow-hidden">
					<div class="py-1">
						<!-- Per-patient entry type list -->
						{#if availableTypes.length > 0}
							<div class="px-2 pt-1 pb-0.5">
								<span class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide px-1">{i18n.t.timeline.filter}</span>
							</div>
							<div class="max-h-60 overflow-y-auto">
								{#each availableTypes as item}
									<button
										type="button"
										onclick={() => toggleFilter(item.key)}
										class="flex w-full items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/60 transition-colors"
									>
										<span class={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${typeFilters.has(item.key) ? 'bg-primary border-primary text-primary-foreground' : 'border-border'}`}>
											{#if typeFilters.has(item.key)}
												<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" class="h-2.5 w-2.5"><polyline points="20 6 9 17 4 12"/></svg>
											{/if}
										</span>
										<span class="flex-1 truncate">{item.label}</span>
										<span class="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">{item.count}</span>
									</button>
								{/each}
							</div>
						{/if}

						<!-- Doctors group -->
						{#if doctors.list.length > 0}
							<div class="px-2 pt-2 pb-0.5 border-t border-border/40 mt-1">
								<span class="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wide px-1">{i18n.t.staff.title}</span>
							</div>
							{#each doctors.list as doc (doc.id)}
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
					</div>

					<!-- Clear button -->
					{#if activeFilterCount > 0}
						<div class="border-t border-border px-2 py-1.5">
							<button
								type="button"
								onclick={clearAllFilters}
								class="w-full text-center text-[11px] text-muted-foreground hover:text-foreground transition-colors py-0.5"
							>
								{i18n.t.timeline.filterAll}
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Text / date search (compact) -->
		<div class="relative flex-1 min-w-[80px] max-w-[160px]">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground">
				<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
			</svg>
			<input
				type="text"
				bind:value={searchQuery}
				placeholder={i18n.t.timeline.searchPlaceholder}
				class="h-7 w-full rounded-md border border-input bg-background pl-6 pr-6 text-[11px] outline-none focus:border-ring placeholder:text-muted-foreground/50 transition-[border-color]"
			/>
			{#if searchQuery}
				<button
					type="button"
					onclick={() => (searchQuery = '')}
					class="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3 w-3">
						<path d="M18 6L6 18M6 6l12 12"/>
					</svg>
				</button>
			{/if}
		</div>

	</div><!-- /filter bar + search -->

	<!-- Synced toast -->
	{#if syncedToast}
		<span class="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 shrink-0">
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3 w-3"><polyline points="20 6 9 17 4 12"/></svg>
			{i18n.t.timeline.entry.typeSynced}
		</span>
	{/if}

	<!-- Action buttons -->
	<div class="flex items-center gap-1 shrink-0">
		<!-- Open Chart editor -->
		<Button size="sm" variant="outline" onclick={() => (chartSheetOpen = true)} title={i18n.t.chart.title}>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="xl:mr-1.5 h-3.5 w-3.5">
				<path d="M12 2c-1.5 0-3 .5-4 1.5C6.5 5 6 7 6 9c0 3 1 6 2 9 .5 1.5 1 2 2 2h4c1 0 1.5-.5 2-2 1-3 2-6 2-9 0-2-.5-4-2-5.5C15 2.5 13.5 2 12 2z"/>
			</svg>
			<span class="hidden xl:inline">{i18n.t.chart.title}</span>
		</Button>
		<!-- Open Therapy Plan -->
		<Button size="sm" variant="outline" onclick={() => (therapyPlanOpen = true)} title={i18n.t.plans.title}
			class="{activePlans.length > 0 ? 'border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30' : ''}"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="xl:mr-1.5 h-3.5 w-3.5">
				<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
			</svg>
			<span class="hidden xl:inline">{i18n.t.plans.title}</span>
		</Button>
		<!-- Open KIG / Ortho assessment -->
		<Button size="sm" variant="outline" onclick={() => { viewingOrthoEntry = null; showOrthoDialog = true; }} title={i18n.t.ortho.button}>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="xl:mr-1.5 h-3.5 w-3.5">
				<path d="M9 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9"/>
				<polyline points="9 2 9 9 16 9"/>
				<line x1="12" y1="13" x2="12" y2="17"/>
				<line x1="10" y1="15" x2="14" y2="15"/>
			</svg>
			<span class="hidden xl:inline">{i18n.t.ortho.button}</span>
		</Button>
		<!-- Open Cephalyzer — needs an image (or saved .ceph) selected in the sidebar file tree -->
		<Button
			size="sm"
			variant="outline"
			disabled={!cephEnabled}
			onclick={() => {
				const sel = cephSelection.file;
				if (sel) goto(`/patients/${patientId}/ceph?file=${encodeURIComponent(sel.relPath)}`);
			}}
			title={cephEnabled ? i18n.t.ceph.analyze : i18n.t.ceph.selectHint}
			class={cephEnabled ? 'border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30' : ''}
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="xl:mr-1.5 h-3.5 w-3.5">
				<circle cx="12" cy="5" r="2"/>
				<path d="m3 21 8.02-14.26"/>
				<path d="m12.99 6.74 1.93 3.44"/>
				<path d="M19 12c-3.87 4-7.74 8.61-16 4.61"/>
				<path d="m21 21-2.16-3.84"/>
			</svg>
			<span class="hidden xl:inline">{i18n.t.ceph.button}</span>
		</Button>
	</div>

</div>
<!-- Spacer: compensates for the fixed toolbar height (pt-2 + h-7 + pb-2 = 44px) -->
<div class="h-[44px] mb-4"></div>

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
		{#if typeFilters.size > 0}
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
		<!-- Spine line — slightly heavier for legibility -->
		<div class="absolute left-[5.5px] top-2 bottom-2 w-[2px] rounded-full bg-border/70"></div>
		<div class="pl-8">
			{#each dateGroups as group, gi (group.date)}
				<!-- Year separator (when year changes between groups) -->
				{#if gi === 0 || group.date.slice(0, 4) !== dateGroups[gi - 1].date.slice(0, 4)}
					<div class="relative -ml-8 flex items-center gap-3 mb-3 {gi > 0 ? 'mt-4' : ''}">
						<div class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background border-2 border-border z-10">
							<div class="h-1.5 w-1.5 rounded-full bg-muted-foreground/60"></div>
						</div>
						<span class="text-[11px] font-bold text-muted-foreground/55 uppercase tracking-widest">{group.date.slice(0, 4)}</span>
						<div class="flex-1 h-px bg-border/40"></div>
					</div>
				{/if}

				<!-- Date group band: alternating light background, rounded on the card-side -->
				<div class="mb-2 rounded-lg {gi % 2 === 1 ? 'bg-muted/[0.15]' : ''}">
					<!-- Date header row — runs through the gutter to put a marker on the spine -->
					<div class="relative -ml-8 flex items-center gap-2 pt-1.5 pb-1">
						<!-- Orange dot on the spine -->
						<div class="h-[11px] w-[11px] shrink-0 rounded-full bg-orange-400 dark:bg-orange-500 z-10 ring-2 ring-background"></div>
						<span class="text-sm font-bold text-orange-500 dark:text-orange-400">{formatDate(group.date)}</span>
						{#if group.entries.length > 1}
							<span class="inline-flex items-center rounded-full bg-orange-100 dark:bg-orange-900/30 px-1.5 py-px text-[10px] font-bold text-orange-600 dark:text-orange-400 leading-4">
								{group.entries.length}
							</span>
						{/if}
					</div>

					<!-- Entries for this date -->
					{#each group.entries as entry (entry.id)}
						<div class="relative -ml-8">
							{#if entry.entry_type === 'plan'}
								{@const plan = plansMap.get(entry.plan_id)}
								{@const planWasEdited = !!plan && plan.updated_at.slice(0, 10) !== plan.created_at.slice(0, 10)}
								{@const planChangeLabel = !plan ? '' :
									plan.status === 'completed' ? i18n.t.plans.status.completed :
									plan.status === 'cancelled' ? i18n.t.plans.status.cancelled :
									plan.status === 'accepted' || plan.status === 'in_progress' ? i18n.t.plans.status.active :
									planWasEdited ? i18n.t.plans.status.edited : ''}
								<!-- Spine dot -->
								<div class="absolute left-0 mt-[15px] h-[9px] w-[9px] rounded-full bg-blue-400/60 ring-2 ring-background z-10"></div>
								<!-- Slim plan indicator -->
								<div class="ml-8 py-1 mb-1">
									<button
										type="button"
										onclick={() => (therapyPlanOpen = true)}
										class="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors group"
									>
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-blue-500/70 shrink-0">
											<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
										</svg>
										<span class="font-medium">{plan?.title ?? entry.title}</span>
										{#if planChangeLabel}
											<span class="text-muted-foreground/50">·</span>
											<span class="{plan?.status === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : plan?.status === 'cancelled' ? 'text-red-500/70' : plan?.status === 'accepted' || plan?.status === 'in_progress' ? 'text-blue-500/70' : 'text-muted-foreground/60'}">{planChangeLabel}</span>
										{/if}
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" class="h-3 w-3 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors shrink-0">
											<path d="M9 18l6-6-6-6"/>
										</svg>
									</button>
								</div>
							{:else if entry.entry_type === 'chart_snapshot'}
								<ChartSnapshotCard
									{entry}
									onView={() => { viewingSnapshot = entry; viewingSnapshotEdit = entry.entry_date === toLocalISODate(); }}
								/>
							{:else if entry.entry_type === 'ortho_snapshot'}
								<OrthoSnapshotCard {entry} onView={() => { viewingOrthoEntry = entry; showOrthoDialog = true; }} />
							{:else if entry.entry_type === 'par_step'}
								{@const parMeta = parseParMeta(entry.description ?? '')}
								<!-- Spine dot -->
								<div class="absolute left-0 mt-[15px] h-[9px] w-[9px] rounded-full bg-teal-400/70 ring-2 ring-background z-10"></div>
								<div class="ml-8 py-1 mb-1">
									<div class="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground">
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-teal-500/80 shrink-0">
											<path d="M9 12l2 2 4-4"/><path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
										</svg>
										<span class="font-medium">{entry.title}</span>
										{#if parMeta}
											<span class="text-muted-foreground/40">·</span>
											<span>BOP {parMeta.bop.toFixed(0)}%</span>
											<span class="text-muted-foreground/40">·</span>
											<span>Max {parMeta.max_pocket}mm</span>
											{#if parMeta.risk === 'stable'}
												<span class="rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.5 text-[9px] font-medium">Stable</span>
											{:else if parMeta.risk === 'high_risk'}
												<span class="rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-1.5 py-0.5 text-[9px] font-medium">High risk</span>
											{:else}
												<span class="rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-1.5 py-0.5 text-[9px] font-medium">Maintenance</span>
											{/if}
										{/if}
									</div>
								</div>
							{:else}
								<TimelineEntryCard
									{entry}
									onEdit={openEditForm}
									onDelete={openDeleteDialog}
									onHistory={openEntryHistory}
									onDateChange={handleDateChange}
									hideDateDisplay={true}
								/>
							{/if}
						</div>
					{/each}
				</div>
			{/each}
		</div>
	</div>
{/if}

<!-- Active plan bar — shown when a non-completed plan exists -->
{#if activePlans.length > 0}
	<div class="mt-4 mb-2 flex flex-wrap gap-2">
		{#each activePlans as plan (plan.plan_id)}
			<ActivePlanBar
				{plan}
				onOpen={() => (therapyPlanOpen = true)}
			/>
		{/each}
	</div>
{/if}

<!-- Spacer so the last timeline entry is never hidden under the fixed bar -->
<div class="h-56"></div>
<div bind:this={bottomAnchor}></div>

</div><!-- end drop zone wrapper -->

<!-- ── Vault drop dialog ───────────────────────────────────────────────── -->
<VaultDropDialog
	bind:open={dropDialogOpen}
	{patientId}
	{patientFolder}
	filePaths={droppedFilePaths}
	onSaved={() => loadEntries(false)}
/>

<!-- ── Fixed chatbox entry bar ────────────────────────────────────────── -->
<TimelineEntryBar
	bind:this={barRef}
	{patientId}
	onSave={handleBarSave}
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

<!-- ── Therapy Plan View ────────────────────────────────────────────── -->
<TherapyPlanView
	bind:open={therapyPlanOpen}
	{patientId}
	onChanged={() => loadEntries(false)}
/>

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

<!-- ── Chart editor — full-screen surface with back button ─────────────── -->
<FullScreenView bind:open={chartSheetOpen} title={i18n.t.chart.title} maxWidth="max-w-[1300px]">
	<DentalChartView {patientId} onToothSaved={() => { chartWasModified = true; }} />
</FullScreenView>

<!-- ── KIG / Ortho assessment dialog ──────────────────────────────────── -->
<OrthoChartDialog bind:open={showOrthoDialog} {patientId} existingEntry={viewingOrthoEntry} onSaved={() => { loadEntries(false); viewingOrthoEntry = null; }} />

<!-- ── Document template picker ──────────────────────────────────────── -->
<DocTemplatePickerDialog
	bind:open={showDocTemplatePicker}
	{patientId}
	{patientFolder}
	onAdded={() => loadEntries(false)}
/>

<!-- ── Chart snapshot viewer / editor — full-screen surface ────────────── -->
<FullScreenView
	open={viewingSnapshot !== null}
	onClose={() => { viewingSnapshot = null; viewingSnapshotEdit = false; }}
	title={viewingSnapshot ? `${i18n.t.timeline.snapshot.title} — ${formatDate(viewingSnapshot.entry_date)}` : ''}
	maxWidth="max-w-[1100px]"
>
	{#snippet actions()}
		{#if viewingSnapshot && viewingSnapshot.entry_date !== toLocalISODate()}
			<span class="text-[11px] text-muted-foreground/60 flex items-center gap-1">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
					<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
				</svg>
				{i18n.t.chart.snapshotReport.readOnly}
			</span>
		{/if}
	{/snippet}
	{#if viewingSnapshot !== null}
		<DentalChartView
			{patientId}
			snapshotData={snapshotChartData()}
			snapshotDescription={viewingSnapshot?.description ?? ''}
			snapshotEditMode={viewingSnapshotEdit}
			onSnapshotSave={handleSnapshotSave}
		/>
	{/if}
</FullScreenView>


<!-- ── Audit log dialog (entry-level history) ──────────────────────────── -->
<AuditLogDialog
	bind:open={auditOpen}
	{patientId}
	entityId={auditEntryId}
/>
