<script lang="ts">
	import { onMount } from 'svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { getFilteredEntries, getFilteredSummary } from '$lib/services/db';
	import { i18n } from '$lib/i18n';
	import { downloadCSV, entriesToCSV } from '$lib/services/export';
	import { Separator } from '$lib/components/ui/separator';
	import type { CategoryStat, ReportFilters, ReportEntry } from '$lib/types';

	const CATEGORY_LABELS = $derived<Record<string, string>>({
		endodontics: i18n.t.categories.endodontics,
		orthodontics: i18n.t.categories.orthodontics,
		prosthodontics: i18n.t.categories.prosthodontics,
		periodontics: i18n.t.categories.periodontics,
		oral_surgery: i18n.t.categories.oral_surgery,
		restorative: i18n.t.categories.restorative,
		preventive: i18n.t.categories.preventive,
		imaging: i18n.t.categories.imaging,
		other: i18n.t.categories.other,
	});

	const OUTCOME_LABELS = $derived<Record<string, string>>({
		successful: i18n.t.outcomes.successful,
		retreated: i18n.t.outcomes.retreated,
		failed_extracted: i18n.t.outcomes.failed_extracted,
		failed_other: i18n.t.outcomes.failed_other,
		ongoing: i18n.t.outcomes.ongoing,
		unknown: i18n.t.outcomes.unknown,
	});

	// Filter state
	let dateFrom = $state('');
	let dateTo = $state('');
	let selectedCategories = $state<Set<string>>(new Set());
	let selectedOutcomes = $state<Set<string>>(new Set());
	let doctorId = $state<number | null>(null);
	let toothInput = $state('');

	// Results
	let entries = $state<ReportEntry[]>([]);
	let summary = $state<{
		total: number;
		byCategory: CategoryStat[];
		byOutcome: { outcome: string; count: number }[];
		byProvider: { doctor_name: string; total: number; successful: number }[];
	} | null>(null);
	let isLoading = $state(false);
	let hasRun = $state(false);

	let activeTab = $state<'summary' | 'table' | 'providers'>('summary');

	const CATEGORIES = ['endodontics', 'orthodontics', 'prosthodontics', 'periodontics', 'oral_surgery', 'restorative', 'preventive', 'imaging', 'other'];
	const OUTCOMES = ['successful', 'retreated', 'failed_extracted', 'failed_other', 'ongoing', 'unknown'];

	function buildFilters(): ReportFilters {
		const teeth = toothInput
			? toothInput.split(',').map(t => parseInt(t.trim())).filter(n => !isNaN(n) && n >= 1 && n <= 32)
			: undefined;
		return {
			dateFrom: dateFrom || undefined,
			dateTo: dateTo || undefined,
			categories: selectedCategories.size > 0 ? [...selectedCategories] : undefined,
			outcomes: selectedOutcomes.size > 0 ? [...selectedOutcomes] : undefined,
			doctorId: doctorId,
			toothNumbers: teeth,
		};
	}

	async function runQuery() {
		isLoading = true;
		hasRun = true;
		const filters = buildFilters();
		const [e, s] = await Promise.all([getFilteredEntries(filters), getFilteredSummary(filters)]);
		entries = e;
		summary = s;
		isLoading = false;
	}

	function resetFilters() {
		dateFrom = '';
		dateTo = '';
		selectedCategories = new Set();
		selectedOutcomes = new Set();
		doctorId = null;
		toothInput = '';
		entries = [];
		summary = null;
		hasRun = false;
	}

	function toggleCategory(cat: string) {
		const s = new Set(selectedCategories);
		s.has(cat) ? s.delete(cat) : s.add(cat);
		selectedCategories = s;
	}

	function toggleOutcome(out: string) {
		const s = new Set(selectedOutcomes);
		s.has(out) ? s.delete(out) : s.add(out);
		selectedOutcomes = s;
	}

	function exportCSV() {
		const csv = entriesToCSV(entries);
		const date = new Date().toISOString().slice(0, 10);
		downloadCSV(csv, `dentvault_report_${date}.csv`);
	}
</script>

<div class="flex flex-col gap-6">
	<div>
		<h1 class="text-2xl font-bold tracking-tight">{i18n.t.nav.reports}</h1>
		<p class="text-sm text-muted-foreground mt-0.5">{i18n.t.reports.title}</p>
	</div>

	<!-- Filter panel -->
	<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
		<h2 class="font-semibold text-sm uppercase tracking-wide text-muted-foreground">{i18n.t.reports.filters}</h2>
		<Separator />

		<!-- Date range -->
		<div class="flex flex-wrap items-center gap-3">
			<label class="text-xs font-medium text-muted-foreground w-20 shrink-0">{i18n.t.dashboard.filters.dateFrom}</label>
			<input type="date" bind:value={dateFrom} class="h-7 rounded border border-border bg-background px-2 text-xs" />
			<span class="text-xs text-muted-foreground">to</span>
			<input type="date" bind:value={dateTo} class="h-7 rounded border border-border bg-background px-2 text-xs" />
		</div>

		<!-- Provider -->
		<div class="flex flex-wrap items-center gap-3">
			<label class="text-xs font-medium text-muted-foreground w-20 shrink-0">{i18n.t.dashboard.filters.doctor}</label>
			<select bind:value={doctorId} class="h-7 rounded border border-border bg-background px-2 text-xs">
				<option value={null}>{i18n.t.dashboard.filters.allDoctors}</option>
				{#each doctors.list as doc}
					<option value={doc.id}>{doc.name}</option>
				{/each}
			</select>
		</div>

		<!-- Teeth -->
		<div class="flex flex-wrap items-center gap-3">
			<label class="text-xs font-medium text-muted-foreground w-20 shrink-0">{i18n.t.reports.columns.teeth}</label>
			<input type="text" bind:value={toothInput} placeholder="e.g. 14, 36" class="h-7 rounded border border-border bg-background px-2 text-xs w-40" />
			<span class="text-[10px] text-muted-foreground/60">comma-separated tooth numbers</span>
		</div>

		<!-- Categories -->
		<div class="flex flex-wrap items-start gap-3">
			<label class="text-xs font-medium text-muted-foreground w-20 shrink-0 mt-1.5">{i18n.t.reports.columns.category}</label>
			<div class="flex flex-wrap gap-1.5">
				{#each CATEGORIES as cat}
					<button
						type="button"
						onclick={() => toggleCategory(cat)}
						class={`h-6 rounded-full px-2.5 text-[10px] font-medium border transition-colors ${selectedCategories.has(cat) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-foreground/40'}`}
					>
						{CATEGORY_LABELS[cat] ?? cat}
					</button>
				{/each}
			</div>
		</div>

		<!-- Outcomes -->
		<div class="flex flex-wrap items-start gap-3">
			<label class="text-xs font-medium text-muted-foreground w-20 shrink-0 mt-1.5">{i18n.t.reports.columns.outcome}</label>
			<div class="flex flex-wrap gap-1.5">
				{#each OUTCOMES as out}
					<button
						type="button"
						onclick={() => toggleOutcome(out)}
						class={`h-6 rounded-full px-2.5 text-[10px] font-medium border transition-colors ${selectedOutcomes.has(out) ? 'bg-primary text-primary-foreground border-primary' : 'bg-background text-muted-foreground border-border hover:border-foreground/40'}`}
					>
						{OUTCOME_LABELS[out] ?? out}
					</button>
				{/each}
			</div>
		</div>

		<!-- Actions -->
		<div class="flex items-center gap-2 pt-1 border-t">
			<button onclick={runQuery} class="h-8 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors">
				{i18n.t.actions.apply}
			</button>
			<button onclick={resetFilters} class="h-8 rounded-md border px-3 text-xs text-muted-foreground hover:bg-muted transition-colors">
				{i18n.t.actions.reset}
			</button>
		</div>
	</div>

	<!-- Results -->
	{#if isLoading}
		<div class="h-32 animate-pulse rounded-lg border bg-muted"></div>
	{:else if hasRun && summary}
		<!-- Tabs -->
		<div class="flex items-center gap-0 border-b">
			{#each (['summary', 'table', 'providers'] as const) as tab}
				<button
					onclick={() => activeTab = tab}
					class={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${activeTab === tab ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
				>
					{tab === 'summary' ? i18n.t.common.all : tab === 'table' ? `${entries.length}` : i18n.t.reports.columns.doctor}
				</button>
			{/each}
		</div>

		{#if activeTab === 'summary'}
			<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
				<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
					<div class="rounded-lg border p-4">
						<div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.common.all}</div>
						<div class="text-3xl font-bold tabular-nums mt-1">{summary.total}</div>
					</div>
					<div class="rounded-lg border p-4">
						<div class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.dashboard.stats.successRate}</div>
						<div class="text-3xl font-bold tabular-nums mt-1 text-emerald-600">
							{#if summary.byOutcome.find(o => o.outcome === 'successful') && summary.total > 0}
								{Math.round(100 * (summary.byOutcome.find(o => o.outcome === 'successful')?.count ?? 0) / summary.total)}%
							{:else}—{/if}
						</div>
					</div>
				</div>

				{#if summary.byCategory.length > 0}
					<div>
						<h3 class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">{i18n.t.reports.columns.category}</h3>
						<div class="flex flex-col gap-2">
							{#each summary.byCategory as stat}
								<div class="flex items-center gap-3">
									<div class="w-28 shrink-0 text-xs text-muted-foreground text-right truncate">{CATEGORY_LABELS[stat.category] ?? stat.category}</div>
									<div class="flex-1 h-2 rounded-full bg-muted overflow-hidden">
										<div class="h-full rounded-full bg-primary transition-all" style="width: {summary.byCategory[0].count > 0 ? Math.round(stat.count / summary.byCategory[0].count * 100) : 0}%"></div>
									</div>
									<span class="text-xs tabular-nums text-muted-foreground w-8 text-right">{stat.count}</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}

				{#if summary.byOutcome.length > 0}
					<div>
						<h3 class="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-3">{i18n.t.reports.columns.outcome}</h3>
						<div class="flex flex-wrap gap-2">
							{#each summary.byOutcome as stat}
								<div class="rounded-lg border p-3 text-center min-w-[80px]">
									<div class="text-lg font-bold tabular-nums">{stat.count}</div>
									<div class="text-[10px] text-muted-foreground mt-0.5">{OUTCOME_LABELS[stat.outcome] ?? stat.outcome}</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>

		{:else if activeTab === 'table'}
			<div class="rounded-lg border bg-card overflow-hidden">
				<div class="flex items-center justify-between p-4 border-b">
					<span class="text-sm font-medium">{entries.length}</span>
					<button onclick={exportCSV} class="h-7 rounded-md border px-3 text-xs hover:bg-muted flex items-center gap-1.5">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5">
							<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
							<polyline points="7 10 12 15 17 10"/>
							<line x1="12" y1="15" x2="12" y2="3"/>
						</svg>
						{i18n.t.reports.exportCsv}
					</button>
				</div>
				<div class="overflow-x-auto">
					<table class="w-full text-xs">
						<thead class="bg-muted/40">
							<tr>
								<th class="text-left px-3 py-2 font-medium text-muted-foreground">{i18n.t.reports.columns.date}</th>
								<th class="text-left px-3 py-2 font-medium text-muted-foreground">{i18n.t.reports.columns.patient}</th>
								<th class="text-left px-3 py-2 font-medium text-muted-foreground">{i18n.t.reports.columns.category}</th>
								<th class="text-left px-3 py-2 font-medium text-muted-foreground">{i18n.t.common.name}</th>
								<th class="text-left px-3 py-2 font-medium text-muted-foreground">{i18n.t.reports.columns.teeth}</th>
								<th class="text-left px-3 py-2 font-medium text-muted-foreground">{i18n.t.reports.columns.doctor}</th>
								<th class="text-left px-3 py-2 font-medium text-muted-foreground">{i18n.t.reports.columns.outcome}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border/40">
							{#each entries as e}
								<tr class="hover:bg-muted/20">
									<td class="px-3 py-2 text-muted-foreground">{e.entry_date}</td>
									<td class="px-3 py-2"><a href="/patients/{e.patient_id}" class="hover:text-primary hover:underline">{e.patient_name}</a></td>
									<td class="px-3 py-2">{(CATEGORY_LABELS[e.treatment_category] ?? e.treatment_category) || '—'}</td>
									<td class="px-3 py-2 max-w-[200px] truncate" title={e.title}>{e.title}</td>
									<td class="px-3 py-2 text-muted-foreground">{e.tooth_numbers || '—'}</td>
									<td class="px-3 py-2 text-muted-foreground">{e.doctor_name || '—'}</td>
									<td class="px-3 py-2">{(OUTCOME_LABELS[e.treatment_outcome] ?? e.treatment_outcome) || '—'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>

		{:else if activeTab === 'providers'}
			<div class="rounded-lg border bg-card overflow-hidden">
				<div class="overflow-x-auto">
					<table class="w-full text-xs">
						<thead class="bg-muted/40">
							<tr>
								<th class="text-left px-3 py-2 font-medium text-muted-foreground">{i18n.t.reports.columns.doctor}</th>
								<th class="text-center px-3 py-2 font-medium text-muted-foreground">{i18n.t.common.all}</th>
								<th class="text-center px-3 py-2 font-medium text-emerald-600">{i18n.t.outcomes.successful}</th>
								<th class="text-center px-3 py-2 font-medium text-muted-foreground">{i18n.t.dashboard.stats.successRate}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border/40">
							{#each summary.byProvider as prov}
								{@const rate = prov.total > 0 ? Math.round(100 * prov.successful / prov.total) : null}
								<tr class="hover:bg-muted/20">
									<td class="px-3 py-2 font-medium">{prov.doctor_name}</td>
									<td class="px-3 py-2 text-center tabular-nums">{prov.total}</td>
									<td class="px-3 py-2 text-center tabular-nums text-emerald-600">{prov.successful}</td>
									<td class="px-3 py-2 text-center tabular-nums">
										{#if rate !== null}
											<span class={rate >= 90 ? 'text-emerald-600' : rate >= 70 ? 'text-amber-600' : 'text-red-500'}>{rate}%</span>
										{:else}—{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

	{:else if hasRun}
		<div class="rounded-lg border border-dashed p-12 text-center">
			<p class="text-sm text-muted-foreground">{i18n.t.reports.noResults}</p>
		</div>
	{:else}
		<div class="rounded-lg border border-dashed p-12 text-center">
			<p class="text-sm text-muted-foreground">{i18n.t.reports.filters}</p>
		</div>
	{/if}
</div>
