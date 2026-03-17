<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { readAuditLog, verifyIntegrity, type IntegrityResult } from '$lib/services/audit';
	import type { AuditRecord, AuditAction, AuditEntityType, AuditFilters } from '$lib/types';
	import AuditEntry from './AuditEntry.svelte';
	import { i18n } from '$lib/i18n';

	let {
		open = $bindable(false),
		patientId,
		patientName,
		entityId,
		entityTitle,
	}: {
		open: boolean;
		/** If provided, pre-filters to this patient. Leave undefined for vault-wide view. */
		patientId?: string;
		patientName?: string;
		/** If provided, further filters to this specific entity (e.g. one timeline entry). */
		entityId?: string;
		entityTitle?: string;
	} = $props();

	let records        = $state<AuditRecord[]>([]);
	let isLoading      = $state(false);
	let integrity      = $state<IntegrityResult | null>(null);
	let verifying      = $state(false);

	// Filters
	let filterAction     = $state<AuditAction | ''>('');
	let filterEntityType = $state<AuditEntityType | ''>('');
	let filterDateRange  = $state<'7' | '30' | '90' | 'all'>('all');
	let filterSearch     = $state('');

	$effect(() => {
		if (open) {
			loadRecords();
			checkIntegrity();
		}
	});

	async function loadRecords() {
		isLoading = true;
		const filters: AuditFilters = {};
		if (patientId) filters.patient_id = patientId;
		if (entityId) filters.entity_id = entityId;
		if (filterAction) filters.action = filterAction as AuditAction;
		if (filterEntityType) filters.entity_type = filterEntityType as AuditEntityType;
		if (filterDateRange !== 'all') {
			const days = parseInt(filterDateRange);
			const from = new Date();
			from.setDate(from.getDate() - days);
			filters.date_from = from.toISOString().slice(0, 10);
		}
		if (filterSearch.trim()) filters.search = filterSearch.trim();

		records = await readAuditLog(filters);
		isLoading = false;
	}

	async function checkIntegrity() {
		verifying = true;
		integrity = await verifyIntegrity();
		verifying = false;
	}

	// Re-load when filters change (debounced for search)
	let _searchTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		void filterAction;
		void filterEntityType;
		void filterDateRange;
		// Search is debounced
		const q = filterSearch;
		if (!open) return;
		if (_searchTimer) clearTimeout(_searchTimer);
		_searchTimer = setTimeout(() => { void q; loadRecords(); }, q ? 300 : 0);
	});

	const title = $derived(
		entityTitle
			? `${i18n.t.audit.title} — "${entityTitle}"`
			: patientName
				? `${i18n.t.audit.title} — ${patientName}`
				: i18n.t.audit.title,
	);
</script>

<Dialog bind:open>
	<DialogContent class="max-w-2xl sm:max-w-2xl flex flex-col max-h-[85vh] p-0 gap-0 focus:outline-none outline-none">

		<DialogHeader class="px-5 pt-5 pb-3 border-b shrink-0">
			<DialogTitle class="text-base">{title}</DialogTitle>
		</DialogHeader>

		<!-- Filter bar -->
		<div class="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b shrink-0 bg-muted/30">
			<!-- Action filter -->
			<select
				bind:value={filterAction}
				class="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
			>
				<option value="">{i18n.t.common.all}</option>
				<option value="update">{i18n.t.audit.actions.update}</option>
				<option value="delete">{i18n.t.audit.actions.delete}</option>
			</select>

			<!-- Entity type filter -->
			<select
				bind:value={filterEntityType}
				class="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
			>
				<option value="">{i18n.t.common.all}</option>
				<option value="timeline_entry">{i18n.t.audit.entityTypes.timeline_entry}</option>
				<option value="treatment_plan">{i18n.t.audit.entityTypes.treatment_plan}</option>
				<option value="patient">{i18n.t.audit.entityTypes.patient}</option>
				<option value="document">{i18n.t.audit.entityTypes.document}</option>
				<option value="dental_chart">{i18n.t.audit.entityTypes.dental_chart}</option>
			</select>

			<!-- Date range filter -->
			<select
				bind:value={filterDateRange}
				class="h-7 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
			>
				<option value="all">{i18n.t.common.all}</option>
				<option value="7">Last 7 days</option>
				<option value="30">Last 30 days</option>
				<option value="90">Last 90 days</option>
			</select>

			<!-- Search -->
			<div class="relative flex-1 min-w-[120px]">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					class="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none">
					<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
				</svg>
				<input
					type="text"
					placeholder={i18n.t.audit.filters.search}
					bind:value={filterSearch}
					class="h-7 w-full rounded-md border border-border bg-background pl-6 pr-2 text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
				/>
			</div>
		</div>

		<!-- Records list -->
		<div class="flex-1 overflow-y-auto px-4 py-3 min-h-0">
			{#if isLoading}
				<div class="flex items-center justify-center py-10">
					<svg class="h-5 w-5 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
					</svg>
				</div>
			{:else if records.length === 0}
				<div class="flex flex-col items-center justify-center py-10 text-muted-foreground">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-10 w-10 mb-2 opacity-30">
						<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
					</svg>
					<p class="text-sm">{i18n.t.audit.noRecords}</p>
					{#if filterAction || filterEntityType || filterDateRange !== 'all' || filterSearch}
						<p class="text-xs mt-1 opacity-70">Try adjusting the filters.</p>
					{/if}
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each records as record (record.id)}
						<AuditEntry {record} />
					{/each}
				</div>
			{/if}
		</div>

		<!-- Integrity footer -->
		<div class="px-4 py-2.5 border-t bg-muted/20 shrink-0 flex items-center gap-2 text-xs text-muted-foreground">
			{#if verifying}
				<svg class="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
				</svg>
				<span>Verifying integrity...</span>
			{:else if integrity}
				{#if integrity.valid}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-emerald-600 shrink-0">
						<polyline points="20 6 9 17 4 12"/>
					</svg>
					<span class="text-emerald-700 dark:text-emerald-400">
						Checksum verified — {integrity.total} {integrity.total === 1 ? 'entry' : 'entries'}, chain intact
					</span>
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-amber-600 shrink-0">
						<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
						<line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
					</svg>
					<span class="text-amber-700 dark:text-amber-400">
						Checksum warning — chain broken at entry #{(integrity.brokenAt ?? 0) + 1} (possible tampering)
					</span>
				{/if}
			{/if}

			<span class="ml-auto">{records.length} {records.length === 1 ? 'result' : 'results'}</span>
		</div>

	</DialogContent>
</Dialog>
