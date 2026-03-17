<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getPatientStatusCounts,
		getProcedureCountThisMonth,
		getCategoryStats,
		getOutcomeStats,
		getOverallSuccessRate,
		getRecentEntries,
		getUpcomingAppointments,
		getProviderOutcomeStats,
	} from '$lib/services/db';
	import { Separator } from '$lib/components/ui/separator';
	import { i18n } from '$lib/i18n';
	import type {
		PatientStatusCounts,
		CategoryStat,
		OutcomeStat,
		SuccessRateStat,
		RecentEntry,
		Patient,
	} from '$lib/types';

	// ── State ─────────────────────────────────────────────────────────────
	let isLoading = $state(true);
	let patientCounts = $state<PatientStatusCounts>({ total: 0, active: 0, inactive: 0, archived: 0 });
	let proceduresThisMonth = $state(0);
	let categoryStats = $state<CategoryStat[]>([]);
	let outcomeStats = $state<OutcomeStat[]>([]);
	let successRate = $state<SuccessRateStat>({ successful: 0, total_with_outcome: 0 });
	let recentEntries = $state<RecentEntry[]>([]);
	let upcomingAppointments = $state<Patient[]>([]);
	let providerStats = $state<{ doctor_name: string; total: number; successful: number }[]>([]);

	// Filter bar state
	let filterCategory = $state<string>('');
	let filterDateFrom = $state('');
	let filterDateTo = $state('');

	onMount(async () => {
		const [counts, thisMonth, cats, outcomes, rate, recent, upcoming, providers] = await Promise.all([
			getPatientStatusCounts(),
			getProcedureCountThisMonth(),
			getCategoryStats(),
			getOutcomeStats(),
			getOverallSuccessRate(),
			getRecentEntries(12),
			getUpcomingAppointments(8),
			getProviderOutcomeStats(),
		]);
		patientCounts = counts;
		proceduresThisMonth = thisMonth;
		categoryStats = cats;
		outcomeStats = outcomes;
		successRate = rate;
		recentEntries = recent;
		upcomingAppointments = upcoming;
		providerStats = providers;
		isLoading = false;
	});

	// ── Computed ──────────────────────────────────────────────────────────

	/** Total procedures (all time) */
	const totalProcedures = $derived(categoryStats.reduce((s, c) => s + c.count, 0));

	/** Max category count for bar scaling */
	const maxCategoryCount = $derived(
		categoryStats.length > 0 ? Math.max(...categoryStats.map((c) => c.count)) : 1,
	);

	/** Success rate percentage */
	const successPct = $derived(
		successRate.total_with_outcome > 0
			? Math.round((successRate.successful / successRate.total_with_outcome) * 100)
			: null,
	);

	/** Build outcome map: category → { outcome → count } */
	const outcomeMap = $derived(() => {
		const map = new Map<string, Map<string, number>>();
		for (const row of outcomeStats) {
			if (!map.has(row.category)) map.set(row.category, new Map());
			map.get(row.category)!.set(row.outcome, row.count);
		}
		return map;
	});

	/** Categories that have at least one outcome recorded */
	const categoriesWithOutcomes = $derived(
		[...outcomeMap().keys()].sort(),
	);

	// ── Helpers ───────────────────────────────────────────────────────────

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

	const CATEGORY_COLORS: Record<string, string> = {
		endodontics: 'bg-blue-500',
		orthodontics: 'bg-purple-500',
		prosthodontics: 'bg-orange-500',
		periodontics: 'bg-emerald-500',
		oral_surgery: 'bg-red-500',
		restorative: 'bg-yellow-500',
		preventive: 'bg-teal-500',
		imaging: 'bg-sky-400',
		other: 'bg-zinc-400',
	};

	const CATEGORY_DOTS: Record<string, string> = {
		endodontics: 'bg-blue-500',
		orthodontics: 'bg-purple-500',
		prosthodontics: 'bg-orange-500',
		periodontics: 'bg-emerald-500',
		oral_surgery: 'bg-red-500',
		restorative: 'bg-yellow-500',
		preventive: 'bg-teal-500',
		imaging: 'bg-sky-400',
		other: 'bg-zinc-400',
	};

	const OUTCOME_LABELS = $derived<Record<string, string>>({
		successful: i18n.t.outcomes.successful,
		retreated: i18n.t.outcomes.retreated,
		failed_extracted: i18n.t.outcomes.failed_extracted,
		failed_other: i18n.t.outcomes.failed_other,
		ongoing: i18n.t.outcomes.ongoing,
		unknown: i18n.t.outcomes.unknown,
	});

	const OUTCOME_CLASSES: Record<string, string> = {
		successful: 'text-emerald-600 dark:text-emerald-400',
		retreated: 'text-amber-600 dark:text-amber-400',
		failed_extracted: 'text-red-600 dark:text-red-400',
		failed_other: 'text-red-500 dark:text-red-400',
		ongoing: 'text-blue-600 dark:text-blue-400',
		unknown: 'text-muted-foreground',
	};

	const ENTRY_TYPE_ICONS: Record<string, string> = {
		visit: '🏥',
		procedure: '🦷',
		note: '📝',
		lab: '🔬',
		imaging: '📷',
		referral: '📋',
		document: '📄',
	};

	function catLabel(key: string): string {
		return CATEGORY_LABELS[key] ?? key;
	}

	function formatDate(val: string): string {
		if (!val) return '—';
		const d = new Date(val + 'T00:00:00');
		return isNaN(d.getTime())
			? val
			: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function getOutcomeCount(cat: string, outcome: string): number {
		return outcomeMap().get(cat)?.get(outcome) ?? 0;
	}

	function getCategoryTotal(cat: string): number {
		let total = 0;
		for (const [, count] of (outcomeMap().get(cat) ?? new Map()).entries()) {
			total += count;
		}
		return total;
	}

	function pct(n: number, total: number): string {
		if (total === 0) return '0%';
		return Math.round((n / total) * 100) + '%';
	}
</script>

<div class="flex flex-col gap-8">

	<!-- ── Page Header ── -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">{i18n.t.nav.dashboard}</h1>
			<p class="text-sm text-muted-foreground mt-0.5">
				{i18n.t.dashboard.title}
			</p>
		</div>
		{#if !isLoading}
			<span class="text-xs text-muted-foreground/60 mt-1">
				Updated {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
			</span>
		{/if}
	</div>

	{#if isLoading}
		<!-- Loading skeleton -->
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
			{#each [1, 2, 3, 4] as _}
				<div class="h-24 animate-pulse rounded-lg border bg-muted"></div>
			{/each}
		</div>
		<div class="grid gap-4 md:grid-cols-2">
			<div class="h-64 animate-pulse rounded-lg border bg-muted"></div>
			<div class="h-64 animate-pulse rounded-lg border bg-muted"></div>
		</div>
	{:else}

		<!-- ── Stat Cards ── -->
		<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">

			<!-- Total Patients -->
			<div class="rounded-lg border bg-card p-5 flex flex-col gap-1">
				<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.dashboard.stats.totalPatients}</span>
				<span class="text-3xl font-bold tabular-nums">{patientCounts.total}</span>
				<span class="text-xs text-muted-foreground mt-1">
					{patientCounts.active} {i18n.t.patients.status.active.toLowerCase()} · {patientCounts.inactive} {i18n.t.patients.status.inactive.toLowerCase()}
				</span>
			</div>

			<!-- Active Patients -->
			<div class="rounded-lg border bg-card p-5 flex flex-col gap-1">
				<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.dashboard.stats.activePatients}</span>
				<span class="text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
					{patientCounts.active}
				</span>
				<span class="text-xs text-muted-foreground mt-1">
					{patientCounts.total > 0
						? Math.round((patientCounts.active / patientCounts.total) * 100)
						: 0}%
				</span>
			</div>

			<!-- Procedures This Month -->
			<div class="rounded-lg border bg-card p-5 flex flex-col gap-1">
				<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.dashboard.stats.entriesThisMonth}</span>
				<span class="text-3xl font-bold tabular-nums">{proceduresThisMonth}</span>
				<span class="text-xs text-muted-foreground mt-1">&nbsp;</span>
			</div>

			<!-- Success Rate -->
			<div class="rounded-lg border bg-card p-5 flex flex-col gap-1">
				<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.dashboard.stats.successRate}</span>
				{#if successPct !== null}
					<span class="text-3xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
						{successPct}%
					</span>
					<span class="text-xs text-muted-foreground mt-1">
						{successRate.successful} / {successRate.total_with_outcome}
					</span>
				{:else}
					<span class="text-3xl font-bold tabular-nums text-muted-foreground">—</span>
					<span class="text-xs text-muted-foreground mt-1">{i18n.t.dashboard.noData}</span>
				{/if}
			</div>
		</div>

		<!-- ── Main Grid ── -->
		<div class="grid gap-6 lg:grid-cols-[1fr_320px]">

			<!-- Left column -->
			<div class="flex flex-col gap-6">

				<!-- Procedures by Category -->
				<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
					<div>
						<h2 class="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
							{i18n.t.dashboard.categoryChart}
						</h2>
					</div>
					<Separator />

					{#if categoryStats.length === 0}
						<p class="text-sm text-muted-foreground py-4 text-center">
							{i18n.t.dashboard.noData}
						</p>
					{:else}
						<div class="flex flex-col gap-3">
							{#each categoryStats as stat}
								{@const barPct = Math.round((stat.count / maxCategoryCount) * 100)}
								{@const totalPct = totalProcedures > 0 ? Math.round((stat.count / totalProcedures) * 100) : 0}
								<div class="flex items-center gap-3">
									<div class="w-28 shrink-0 text-xs text-muted-foreground text-right truncate">
										{catLabel(stat.category)}
									</div>
									<div class="flex-1 flex items-center gap-2">
										<div class="flex-1 h-2 rounded-full bg-muted overflow-hidden">
											<div
												class="h-full rounded-full transition-all duration-500 {CATEGORY_COLORS[stat.category] ?? 'bg-primary'}"
												style="width: {barPct}%"
											></div>
										</div>
										<span class="text-xs tabular-nums text-muted-foreground w-8 text-right shrink-0">
											{stat.count}
										</span>
										<span class="text-xs text-muted-foreground/60 w-8 shrink-0">
											{totalPct}%
										</span>
									</div>
								</div>
							{/each}
						</div>

						<!-- Legend + total -->
						<div class="flex items-center justify-between pt-1 border-t">
							<div class="flex flex-wrap gap-2">
								{#each categoryStats.slice(0, 5) as stat}
									<span class="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
										<span class="h-2 w-2 rounded-full {CATEGORY_DOTS[stat.category] ?? 'bg-primary'}"></span>
										{catLabel(stat.category)}
									</span>
								{/each}
								{#if categoryStats.length > 5}
									<span class="text-[10px] text-muted-foreground/60">+{categoryStats.length - 5} more</span>
								{/if}
							</div>
							<span class="text-xs text-muted-foreground shrink-0">
								{totalProcedures} total
							</span>
						</div>
					{/if}
				</div>

				<!-- Outcome Analysis -->
				{#if categoriesWithOutcomes.length > 0}
					<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
						<div>
							<h2 class="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
								{i18n.t.dashboard.outcomeTable}
							</h2>
						</div>
						<Separator />

						<div class="overflow-x-auto">
							<table class="w-full text-xs">
								<thead>
									<tr class="border-b">
										<th class="text-left font-medium text-muted-foreground pb-2 pr-4">{i18n.t.reports.columns.category}</th>
										<th class="text-center font-medium text-emerald-600 dark:text-emerald-400 pb-2 px-2">✓ {i18n.t.outcomes.successful}</th>
										<th class="text-center font-medium text-amber-600 dark:text-amber-400 pb-2 px-2">↻ {i18n.t.outcomes.retreated}</th>
										<th class="text-center font-medium text-red-500 pb-2 px-2">✕ {i18n.t.outcomes.failed_other}</th>
										<th class="text-center font-medium text-blue-600 dark:text-blue-400 pb-2 px-2">⏳ {i18n.t.outcomes.ongoing}</th>
										<th class="text-right font-medium text-muted-foreground pb-2 pl-4">{i18n.t.common.all}</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-border/40">
									{#each categoriesWithOutcomes as cat}
										{@const total = getCategoryTotal(cat)}
										{@const succ = getOutcomeCount(cat, 'successful')}
										{@const retr = getOutcomeCount(cat, 'retreated')}
										{@const failExt = getOutcomeCount(cat, 'failed_extracted')}
										{@const failOth = getOutcomeCount(cat, 'failed_other')}
										{@const ongoing = getOutcomeCount(cat, 'ongoing')}
										<tr class="hover:bg-muted/30 transition-colors">
											<td class="py-2 pr-4 font-medium text-foreground">{catLabel(cat)}</td>
											<td class="py-2 px-2 text-center">
												{#if succ > 0}
													<span class="text-emerald-600 dark:text-emerald-400 font-medium">{succ}</span>
													<span class="text-muted-foreground/60 ml-1">({pct(succ, total)})</span>
												{:else}
													<span class="text-muted-foreground/30">—</span>
												{/if}
											</td>
											<td class="py-2 px-2 text-center">
												{#if retr > 0}
													<span class="text-amber-600 dark:text-amber-400 font-medium">{retr}</span>
													<span class="text-muted-foreground/60 ml-1">({pct(retr, total)})</span>
												{:else}
													<span class="text-muted-foreground/30">—</span>
												{/if}
											</td>
											<td class="py-2 px-2 text-center">
												{#if failExt + failOth > 0}
													<span class="text-red-500 font-medium">{failExt + failOth}</span>
													<span class="text-muted-foreground/60 ml-1">({pct(failExt + failOth, total)})</span>
												{:else}
													<span class="text-muted-foreground/30">—</span>
												{/if}
											</td>
											<td class="py-2 px-2 text-center">
												{#if ongoing > 0}
													<span class="text-blue-600 dark:text-blue-400 font-medium">{ongoing}</span>
													<span class="text-muted-foreground/60 ml-1">({pct(ongoing, total)})</span>
												{:else}
													<span class="text-muted-foreground/30">—</span>
												{/if}
											</td>
											<td class="py-2 pl-4 text-right font-medium tabular-nums">{total}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}

			</div>

			<!-- Right column: Recent activity + Upcoming appointments -->
			<div class="flex flex-col gap-6">

				<!-- Upcoming Appointments -->
				<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
					<div>
						<h2 class="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
							{i18n.t.dashboard.drillDown}
						</h2>
					</div>
					<Separator />

					{#if upcomingAppointments.length === 0}
						<p class="text-sm text-muted-foreground text-center py-4">
							{i18n.t.dashboard.noData}
						</p>
					{:else}
						<div class="flex flex-col gap-2">
							{#each upcomingAppointments as patient}
								<a
									href="/patients/{patient.patient_id}"
									class="flex items-center justify-between gap-3 rounded-md p-2 hover:bg-muted/50 transition-colors group"
								>
									<div class="flex items-center gap-2 min-w-0">
										<div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
											{patient.firstname[0]?.toUpperCase()}{patient.lastname[0]?.toUpperCase()}
										</div>
										<span class="text-sm truncate font-medium group-hover:text-primary transition-colors">
											{patient.lastname}, {patient.firstname}
										</span>
									</div>
									<span class="text-xs text-muted-foreground shrink-0">
										{formatDate(patient.next_appointment)}
									</span>
								</a>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Recent Activity -->
				<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
					<div>
						<h2 class="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
							{i18n.t.dashboard.recentActivity}
						</h2>
					</div>
					<Separator />

					{#if recentEntries.length === 0}
						<p class="text-sm text-muted-foreground text-center py-4">
							{i18n.t.dashboard.noData}
						</p>
					{:else}
						<div class="flex flex-col gap-1">
							{#each recentEntries as entry}
								<a
									href="/patients/{entry.patient_id}?tab=timeline"
									class="flex items-start gap-3 rounded-md p-2 hover:bg-muted/50 transition-colors group"
								>
									<span class="text-base leading-none mt-0.5 shrink-0">
										{ENTRY_TYPE_ICONS[entry.entry_type] ?? '📋'}
									</span>
									<div class="flex flex-col gap-0.5 min-w-0 flex-1">
										<div class="flex items-center gap-1.5 flex-wrap">
											<span class="text-xs font-medium truncate group-hover:text-primary transition-colors">
												{entry.lastname}, {entry.firstname}
											</span>
											{#if entry.treatment_category}
												<span class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground shrink-0">
													{catLabel(entry.treatment_category)}
												</span>
											{/if}
										</div>
										<span class="text-xs text-muted-foreground truncate">{entry.title}</span>
										{#if entry.tooth_numbers}
											<span class="text-[10px] text-muted-foreground/60">#{entry.tooth_numbers}</span>
										{/if}
									</div>
									<span class="text-[10px] text-muted-foreground/60 shrink-0 mt-0.5">
										{formatDate(entry.entry_date)}
									</span>
								</a>
							{/each}
						</div>
					{/if}
				</div>

			</div>
		</div>

		<!-- ── Provider Outcome Stats ── -->
	{#if providerStats.length > 0}
		<div class="rounded-lg border bg-card overflow-hidden">
			<div class="px-5 py-4 border-b">
				<h2 class="text-sm font-semibold">{i18n.t.dashboard.providerOutcomes}</h2>
				<p class="text-xs text-muted-foreground mt-0.5">{i18n.t.dashboard.stats.successRate}</p>
			</div>
			<div class="overflow-x-auto">
				<table class="w-full text-xs">
					<thead class="bg-muted/40">
						<tr>
							<th class="text-left px-4 py-2.5 font-medium text-muted-foreground">{i18n.t.reports.columns.doctor}</th>
							<th class="text-center px-4 py-2.5 font-medium text-muted-foreground">{i18n.t.common.all}</th>
							<th class="text-center px-4 py-2.5 font-medium text-emerald-600 dark:text-emerald-400">{i18n.t.outcomes.successful}</th>
							<th class="text-center px-4 py-2.5 font-medium text-muted-foreground">{i18n.t.dashboard.stats.successRate}</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-border/40">
						{#each providerStats as prov}
							{@const rate = prov.total > 0 ? Math.round(100 * prov.successful / prov.total) : null}
							<tr class="hover:bg-muted/20 transition-colors">
								<td class="px-4 py-2.5 font-medium">{prov.doctor_name}</td>
								<td class="px-4 py-2.5 text-center tabular-nums">{prov.total}</td>
								<td class="px-4 py-2.5 text-center tabular-nums text-emerald-600 dark:text-emerald-400">{prov.successful}</td>
								<td class="px-4 py-2.5 text-center tabular-nums">
									{#if rate !== null}
										<span class={rate >= 90 ? 'text-emerald-600 dark:text-emerald-400' : rate >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'}>
											{rate}%
										</span>
									{:else}—{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</div>
	{/if}

	<!-- ── Empty state when no data at all ── -->
		{#if patientCounts.total === 0}
			<div class="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
				<svg
					xmlns="http://www.w3.org/2000/svg"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					class="mb-4 h-12 w-12 text-muted-foreground/40"
				>
					<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"/>
				</svg>
				<h3 class="text-base font-medium text-muted-foreground">{i18n.t.dashboard.noData}</h3>
				<p class="mt-1 text-sm text-muted-foreground/70 max-w-xs">
					{i18n.t.patients.noPatients}
				</p>
				<a
					href="/patients/new"
					class="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
						<path d="M12 5v14M5 12h14"/>
					</svg>
					{i18n.t.patients.new}
				</a>
			</div>
		{/if}

	{/if}
</div>
