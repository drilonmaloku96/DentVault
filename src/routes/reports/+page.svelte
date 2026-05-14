<script lang="ts">
	import { onMount } from 'svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import {
		getAllDoctorKPIs,
		getDoctorPerformanceKPI,
		getDoctorMonthlyTrend,
		getDoctorDowDistribution,
		getDoctorTreatmentStats,
	} from '$lib/services/db';
	import { i18n } from '$lib/i18n';
	import type {
		DoctorPerformanceKPI,
		DoctorMonthlyTrend,
		DoctorDowStat,
		DoctorTreatmentStat,
	} from '$lib/types';

	// ── Date range state ─────────────────────────────────────────────────
	const today = new Date();
	const todayStr = today.toISOString().slice(0, 10);

	function firstDayOfMonth(d: Date): string {
		return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
	}
	function offsetMonths(d: Date, n: number): Date {
		return new Date(d.getFullYear(), d.getMonth() + n, 1);
	}

	let dateFrom = $state(firstDayOfMonth(today));
	let dateTo = $state(todayStr);
	let selectedDoctorId = $state<string>('');

	// ── Data state ───────────────────────────────────────────────────────
	let allKpis = $state<DoctorPerformanceKPI[]>([]);
	let singleKpi = $state<DoctorPerformanceKPI | null>(null);
	let monthlyTrend = $state<DoctorMonthlyTrend[]>([]);
	let dowStats = $state<DoctorDowStat[]>([]);
	let treatmentStats = $state<DoctorTreatmentStat[]>([]);
	let isLoading = $state(false);

	// ── Derived helpers ──────────────────────────────────────────────────
	const isAllDoctors = $derived(selectedDoctorId === '');

	function avgPerDay(kpi: DoctorPerformanceKPI): string {
		if (!kpi.working_days) return '—';
		return (kpi.total / kpi.working_days).toFixed(1);
	}

	function completionRate(kpi: DoctorPerformanceKPI): string {
		const resolved = kpi.completed + kpi.cancelled + kpi.no_show;
		if (!resolved) return '—';
		return Math.round((kpi.completed / resolved) * 100) + '%';
	}

	function completionRateNum(kpi: DoctorPerformanceKPI): number {
		const resolved = kpi.completed + kpi.cancelled + kpi.no_show;
		if (!resolved) return 0;
		return Math.round((kpi.completed / resolved) * 100);
	}

	function deviationLabel(dev: number | null): string {
		if (dev === null) return '—';
		const sign = dev > 0 ? '+' : '';
		return `${sign}${dev.toFixed(1)} ${i18n.t.reports.performance.minutes}`;
	}

	function deviationColor(dev: number | null): string {
		if (dev === null) return 'text-muted-foreground';
		if (Math.abs(dev) <= 2) return 'text-emerald-600 dark:text-emerald-400';
		if (dev > 0) return 'text-red-500 dark:text-red-400';
		return 'text-blue-500 dark:text-blue-400';
	}

	// ── Monthly trend chart helpers ──────────────────────────────────────
	const maxMonthTotal = $derived(Math.max(1, ...monthlyTrend.map(m => m.total)));

	function allMonthsInRange(from: string, to: string): string[] {
		const months: string[] = [];
		let cur = new Date(from.slice(0, 7) + '-01');
		const end = new Date(to.slice(0, 7) + '-01');
		while (cur <= end) {
			months.push(cur.toISOString().slice(0, 7));
			cur = offsetMonths(cur, 1);
		}
		return months.slice(-12); // cap at 12 months for readability
	}

	const trendMonths = $derived(allMonthsInRange(dateFrom, dateTo));

	function trendForMonth(month: string): DoctorMonthlyTrend {
		return monthlyTrend.find(m => m.month === month) ?? { month, total: 0, completed: 0, cancelled: 0, no_show: 0 };
	}

	function monthLabel(month: string): string {
		const [year, mon] = month.split('-');
		return new Date(Number(year), Number(mon) - 1, 1).toLocaleString(i18n.t.meta.code === 'de' ? 'de-DE' : 'en-GB', { month: 'short' });
	}

	// ── DoW chart helpers ────────────────────────────────────────────────
	// dayAbbrevs is Sun-first (index 0=Sun), matching SQLite strftime('%w')
	const DOW_LABELS = $derived(i18n.t.defaults.dayAbbrevs); // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
	const maxDow = $derived(Math.max(1, ...dowStats.map(d => d.count)));

	function dowCount(dow: number): number {
		return dowStats.find(d => d.dow === dow)?.count ?? 0;
	}

	// ── Quick date presets ───────────────────────────────────────────────
	function applyPreset(preset: 'month' | 'quarter' | 'year') {
		dateTo = todayStr;
		if (preset === 'month') {
			dateFrom = firstDayOfMonth(today);
		} else if (preset === 'quarter') {
			dateFrom = firstDayOfMonth(offsetMonths(today, -2));
		} else {
			dateFrom = `${today.getFullYear()}-01-01`;
		}
		load();
	}

	// ── Load data ────────────────────────────────────────────────────────
	async function load() {
		if (!dateFrom || !dateTo) return;
		isLoading = true;
		try {
			if (isAllDoctors) {
				[allKpis] = await Promise.all([getAllDoctorKPIs(dateFrom, dateTo)]);
				singleKpi = null;
				monthlyTrend = [];
				dowStats = [];
				treatmentStats = [];
			} else {
				[singleKpi, monthlyTrend, dowStats, treatmentStats] = await Promise.all([
					getDoctorPerformanceKPI(selectedDoctorId, dateFrom, dateTo),
					getDoctorMonthlyTrend(selectedDoctorId, dateFrom, dateTo),
					getDoctorDowDistribution(selectedDoctorId, dateFrom, dateTo),
					getDoctorTreatmentStats(selectedDoctorId, dateFrom, dateTo),
				]);
				allKpis = [];
			}
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		doctors.load();
	});

	$effect(() => {
		// tracks selectedDoctorId, dateFrom, dateTo — fires on mount and on any change
		selectedDoctorId;
		dateFrom;
		dateTo;
		load();
	});
</script>

<div class="flex flex-col gap-6">

	<!-- Header -->
	<div>
		<h1 class="text-2xl font-bold tracking-tight">{i18n.t.reports.performance.title}</h1>
		<p class="text-sm text-muted-foreground mt-0.5">{i18n.t.reports.performance.subtitle}</p>
	</div>

	<!-- Controls -->
	<div class="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4">
		<!-- Doctor selector -->
		<div class="flex items-center gap-2">
			<label class="text-xs font-medium text-muted-foreground whitespace-nowrap">{i18n.t.reports.performance.selectDoctor}</label>
			<select
				bind:value={selectedDoctorId}
				class="h-8 rounded-md border border-border bg-background px-2 text-xs min-w-[160px]"
			>
				<option value="">{i18n.t.reports.performance.allDoctors}</option>
				{#each doctors.list as doc}
					<option value={String(doc.id)}>{doc.name}</option>
				{/each}
			</select>
		</div>

		<div class="h-5 w-px bg-border hidden sm:block"></div>

		<!-- Date range -->
		<div class="flex items-center gap-2 flex-wrap">
			<input type="date" bind:value={dateFrom} class="h-8 rounded-md border border-border bg-background px-2 text-xs" />
			<span class="text-xs text-muted-foreground">–</span>
			<input type="date" bind:value={dateTo} class="h-8 rounded-md border border-border bg-background px-2 text-xs" />
		</div>

		<div class="h-5 w-px bg-border hidden sm:block"></div>

		<!-- Quick presets -->
		<div class="flex items-center gap-1.5">
			<button
				onclick={() => applyPreset('month')}
				class="h-7 rounded-full border border-border bg-background px-3 text-[11px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
			>
				{i18n.t.reports.performance.quickThisMonth}
			</button>
			<button
				onclick={() => applyPreset('quarter')}
				class="h-7 rounded-full border border-border bg-background px-3 text-[11px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
			>
				{i18n.t.reports.performance.quickLast3Months}
			</button>
			<button
				onclick={() => applyPreset('year')}
				class="h-7 rounded-full border border-border bg-background px-3 text-[11px] text-muted-foreground hover:border-primary hover:text-primary transition-colors"
			>
				{i18n.t.reports.performance.quickThisYear}
			</button>
		</div>
	</div>

	<!-- Loading skeleton -->
	{#if isLoading}
		<div class="flex flex-col gap-4">
			<div class="h-28 animate-pulse rounded-lg border bg-muted"></div>
			<div class="h-40 animate-pulse rounded-lg border bg-muted"></div>
		</div>

	<!-- ── All Doctors Comparison ── -->
	{:else if isAllDoctors}
		{#if allKpis.length === 0}
			<div class="rounded-lg border border-dashed p-12 text-center">
				<p class="text-sm text-muted-foreground">{i18n.t.reports.performance.noData}</p>
			</div>
		{:else}
			<div class="rounded-lg border bg-card overflow-hidden">
				<div class="px-5 py-3 border-b">
					<h2 class="text-sm font-semibold">{i18n.t.reports.performance.comparisonTable}</h2>
				</div>
				<div class="overflow-x-auto">
					<table class="w-full text-xs">
						<thead class="bg-muted/40">
							<tr>
								<th class="text-left px-4 py-2.5 font-medium text-muted-foreground">{i18n.t.common.doctor}</th>
								<th class="text-center px-3 py-2.5 font-medium text-muted-foreground">{i18n.t.reports.performance.colTotal}</th>
								<th class="text-center px-3 py-2.5 font-medium text-muted-foreground">{i18n.t.reports.performance.colWorkingDays}</th>
								<th class="text-center px-3 py-2.5 font-medium text-muted-foreground">{i18n.t.reports.performance.colAvgPerDay}</th>
								<th class="text-center px-3 py-2.5 font-medium text-muted-foreground">{i18n.t.reports.performance.colCompletion}</th>
								<th class="text-center px-3 py-2.5 font-medium text-muted-foreground">{i18n.t.reports.performance.colCancelled}</th>
								<th class="text-center px-3 py-2.5 font-medium text-muted-foreground">{i18n.t.reports.performance.colNoShow}</th>
								<th class="text-center px-3 py-2.5 font-medium text-muted-foreground">{i18n.t.reports.performance.colAvgPlanned}</th>
								<th class="text-center px-3 py-2.5 font-medium text-muted-foreground">{i18n.t.reports.performance.colAvgActual}</th>
								<th class="text-center px-3 py-2.5 font-medium text-muted-foreground">{i18n.t.reports.performance.colDeviation}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border/40">
							{#each allKpis as kpi}
								{@const rate = completionRateNum(kpi)}
								<tr class="hover:bg-muted/20">
									<td class="px-4 py-2.5 font-medium">
										<div class="flex items-center gap-2">
											<span class="h-2.5 w-2.5 rounded-full shrink-0" style="background:{kpi.doctor_color}"></span>
											<button
												onclick={() => { selectedDoctorId = kpi.doctor_id; }}
												class="hover:text-primary hover:underline text-left"
											>
												{kpi.doctor_name}
											</button>
										</div>
									</td>
									<td class="px-3 py-2.5 text-center tabular-nums font-medium">{kpi.total}</td>
									<td class="px-3 py-2.5 text-center tabular-nums text-muted-foreground">{kpi.working_days}</td>
									<td class="px-3 py-2.5 text-center tabular-nums">{avgPerDay(kpi)}</td>
									<td class="px-3 py-2.5 text-center tabular-nums">
										{#if kpi.total > 0}
											<span class={rate >= 85 ? 'text-emerald-600' : rate >= 65 ? 'text-amber-600' : 'text-red-500'}>
												{rate}%
											</span>
										{:else}—{/if}
									</td>
									<td class="px-3 py-2.5 text-center tabular-nums text-red-500">{kpi.cancelled || '—'}</td>
									<td class="px-3 py-2.5 text-center tabular-nums text-orange-500">{kpi.no_show || '—'}</td>
									<td class="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
										{kpi.avg_planned_duration != null ? `${kpi.avg_planned_duration} ${i18n.t.reports.performance.minutes}` : '—'}
									</td>
									<td class="px-3 py-2.5 text-center tabular-nums text-muted-foreground">
										{kpi.avg_actual_duration != null ? `${kpi.avg_actual_duration} ${i18n.t.reports.performance.minutes}` : '—'}
									</td>
									<td class="px-3 py-2.5 text-center tabular-nums {deviationColor(kpi.avg_deviation)}">
										{deviationLabel(kpi.avg_deviation)}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

	<!-- ── Single Doctor Deep Dive ── -->
	{:else if singleKpi}
		{@const kpi = singleKpi}
		{@const rate = completionRateNum(kpi)}

		<!-- KPI cards row -->
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
			<!-- Total -->
			<div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
				<span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.reports.performance.kpi.total}</span>
				<span class="text-3xl font-bold tabular-nums">{kpi.total}</span>
				<span class="text-[11px] text-muted-foreground">{kpi.working_days} {i18n.t.reports.performance.days}</span>
			</div>
			<!-- Avg/Day -->
			<div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
				<span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.reports.performance.kpi.avgPerDay}</span>
				<span class="text-3xl font-bold tabular-nums">{avgPerDay(kpi)}</span>
				<span class="text-[11px] text-muted-foreground">{i18n.t.reports.performance.kpi.workingDays}</span>
			</div>
			<!-- Completion rate -->
			<div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
				<span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.reports.performance.kpi.completionRate}</span>
				<span class="text-3xl font-bold tabular-nums {rate >= 85 ? 'text-emerald-600' : rate >= 65 ? 'text-amber-600' : 'text-red-500'}">{completionRate(kpi)}</span>
				<span class="text-[11px] text-muted-foreground">{kpi.completed} / {kpi.completed + kpi.cancelled + kpi.no_show}</span>
			</div>
			<!-- Avg deviation -->
			<div class="rounded-lg border bg-card p-4 flex flex-col gap-1">
				<span class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.reports.performance.kpi.avgDeviation}</span>
				<span class="text-3xl font-bold tabular-nums {deviationColor(kpi.avg_deviation)}">{deviationLabel(kpi.avg_deviation)}</span>
				{#if kpi.avg_deviation !== null}
					<span class="text-[11px] {deviationColor(kpi.avg_deviation)}">
						{Math.abs(kpi.avg_deviation) <= 2
							? i18n.t.reports.performance.onTime
							: kpi.avg_deviation > 0
								? i18n.t.reports.performance.overTime
								: i18n.t.reports.performance.underTime}
					</span>
				{:else}
					<span class="text-[11px] text-muted-foreground">{i18n.t.common.noData}</span>
				{/if}
			</div>
		</div>

		<!-- Secondary stats strip -->
		<div class="flex flex-wrap gap-3">
			<div class="rounded-md border bg-card px-4 py-2.5 flex items-center gap-3 min-w-[130px]">
				<div>
					<div class="text-[10px] text-muted-foreground uppercase tracking-wide">{i18n.t.reports.performance.kpi.cancelled}</div>
					<div class="text-lg font-semibold tabular-nums text-red-500">{kpi.cancelled}</div>
				</div>
			</div>
			<div class="rounded-md border bg-card px-4 py-2.5 flex items-center gap-3 min-w-[130px]">
				<div>
					<div class="text-[10px] text-muted-foreground uppercase tracking-wide">{i18n.t.reports.performance.kpi.noShow}</div>
					<div class="text-lg font-semibold tabular-nums text-orange-500">{kpi.no_show}</div>
				</div>
			</div>
			{#if kpi.avg_planned_duration != null}
				<div class="rounded-md border bg-card px-4 py-2.5 flex items-center gap-3 min-w-[130px]">
					<div>
						<div class="text-[10px] text-muted-foreground uppercase tracking-wide">{i18n.t.reports.performance.kpi.avgPlanned}</div>
						<div class="text-lg font-semibold tabular-nums">{kpi.avg_planned_duration} <span class="text-xs font-normal text-muted-foreground">{i18n.t.reports.performance.minutes}</span></div>
					</div>
				</div>
			{/if}
			{#if kpi.avg_actual_duration != null}
				<div class="rounded-md border bg-card px-4 py-2.5 flex items-center gap-3 min-w-[130px]">
					<div>
						<div class="text-[10px] text-muted-foreground uppercase tracking-wide">{i18n.t.reports.performance.kpi.avgActual}</div>
						<div class="text-lg font-semibold tabular-nums">{kpi.avg_actual_duration} <span class="text-xs font-normal text-muted-foreground">{i18n.t.reports.performance.minutes}</span></div>
					</div>
				</div>
			{/if}
		</div>

		<!-- Monthly trend -->
		{#if trendMonths.length > 0}
			<div class="rounded-lg border bg-card p-5">
				<h2 class="text-sm font-semibold mb-4">{i18n.t.reports.performance.monthlyTrend}</h2>
				<div class="flex items-end gap-1.5 h-32 overflow-x-auto pb-1">
					{#each trendMonths as month}
						{@const m = trendForMonth(month)}
						{@const completedH = maxMonthTotal > 0 ? Math.round((m.completed / maxMonthTotal) * 112) : 0}
						{@const cancelledH = maxMonthTotal > 0 ? Math.round((m.cancelled / maxMonthTotal) * 112) : 0}
						{@const noShowH = maxMonthTotal > 0 ? Math.round((m.no_show / maxMonthTotal) * 112) : 0}
						<div class="flex flex-col items-center gap-1 min-w-[36px]">
							<div class="flex flex-col-reverse items-center gap-px w-6">
								{#if completedH > 0}
									<div
										class="w-full rounded-sm bg-emerald-500/80"
										style="height:{completedH}px"
										title="{i18n.t.reports.performance.completed}: {m.completed}"
									></div>
								{/if}
								{#if cancelledH > 0}
									<div
										class="w-full rounded-sm bg-red-400/70"
										style="height:{cancelledH}px"
										title="{i18n.t.reports.performance.cancelled}: {m.cancelled}"
									></div>
								{/if}
								{#if noShowH > 0}
									<div
										class="w-full rounded-sm bg-orange-400/70"
										style="height:{noShowH}px"
										title="{i18n.t.reports.performance.noShow}: {m.no_show}"
									></div>
								{/if}
								{#if m.total === 0}
									<div class="w-full h-1 rounded-sm bg-border"></div>
								{/if}
							</div>
							<span class="text-[9px] text-muted-foreground">{monthLabel(month)}</span>
							{#if m.total > 0}
								<span class="text-[9px] tabular-nums font-medium">{m.total}</span>
							{/if}
						</div>
					{/each}
				</div>
				<!-- Legend -->
				<div class="flex items-center gap-4 mt-3 pt-3 border-t">
					<div class="flex items-center gap-1.5">
						<span class="h-2 w-4 rounded-sm bg-emerald-500/80 inline-block"></span>
						<span class="text-[11px] text-muted-foreground">{i18n.t.reports.performance.completed}</span>
					</div>
					<div class="flex items-center gap-1.5">
						<span class="h-2 w-4 rounded-sm bg-red-400/70 inline-block"></span>
						<span class="text-[11px] text-muted-foreground">{i18n.t.reports.performance.cancelled}</span>
					</div>
					<div class="flex items-center gap-1.5">
						<span class="h-2 w-4 rounded-sm bg-orange-400/70 inline-block"></span>
						<span class="text-[11px] text-muted-foreground">{i18n.t.reports.performance.noShow}</span>
					</div>
				</div>
			</div>
		{/if}

		<!-- DoW distribution + Treatment types (side by side on wide screens) -->
		<div class="grid grid-cols-1 gap-4 lg:grid-cols-2">

			<!-- Day of week -->
			<div class="rounded-lg border bg-card p-5">
				<h2 class="text-sm font-semibold mb-4">{i18n.t.reports.performance.dowDistribution}</h2>
				<div class="flex flex-col gap-2">
					{#each [1, 2, 3, 4, 5, 6, 0] as dow}
						{@const count = dowCount(dow)}
						{@const pct = maxDow > 0 ? (count / maxDow) * 100 : 0}
						<div class="flex items-center gap-2">
							<span class="text-xs text-muted-foreground w-8 shrink-0">{DOW_LABELS[dow]}</span>
							<div class="flex-1 h-5 rounded bg-muted/40 overflow-hidden relative">
								<div
									class="h-full rounded bg-primary/70 transition-all duration-300"
									style="width:{pct}%"
								></div>
							</div>
							<span class="text-xs tabular-nums text-muted-foreground w-6 text-right">{count}</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Treatment types -->
			<div class="rounded-lg border bg-card p-5">
				<h2 class="text-sm font-semibold mb-4">{i18n.t.reports.performance.treatmentTypes}</h2>
				{#if treatmentStats.length === 0}
					<p class="text-xs text-muted-foreground">{i18n.t.reports.performance.noData}</p>
				{:else}
					<div class="flex flex-col gap-3">
						{#each treatmentStats as stat}
							{@const maxDur = Math.max(stat.avg_planned_duration ?? 0, stat.avg_actual_duration ?? 0, 1)}
							<div class="flex flex-col gap-1">
								<div class="flex items-center justify-between">
									<div class="flex items-center gap-1.5">
										{#if stat.type_color}
											<span class="h-2 w-2 rounded-full shrink-0" style="background:{stat.type_color}"></span>
										{/if}
										<span class="text-xs font-medium truncate">{stat.type_name ?? i18n.t.common.unknown}</span>
									</div>
									<div class="flex items-center gap-3 text-[11px] tabular-nums">
										<span class="text-muted-foreground">×{stat.appointment_count}</span>
										<span class={deviationColor(stat.avg_deviation)}>{deviationLabel(stat.avg_deviation)}</span>
									</div>
								</div>
								<!-- Dual bar: planned vs actual -->
								{#if stat.avg_planned_duration != null}
									<div class="flex flex-col gap-0.5">
										<div class="flex items-center gap-1.5">
											<span class="text-[9px] text-muted-foreground/70 w-12 text-right">{i18n.t.dashboard.staff.treatmentTimes.planned}</span>
											<div class="flex-1 h-2.5 rounded bg-muted/40 overflow-hidden">
												<div class="h-full rounded bg-primary/50" style="width:{Math.round((stat.avg_planned_duration / maxDur) * 100)}%"></div>
											</div>
											<span class="text-[10px] tabular-nums text-muted-foreground w-12">{stat.avg_planned_duration} {i18n.t.reports.performance.minutes}</span>
										</div>
										{#if stat.avg_actual_duration != null}
											<div class="flex items-center gap-1.5">
												<span class="text-[9px] text-muted-foreground/70 w-12 text-right">{i18n.t.dashboard.staff.treatmentTimes.actual}</span>
												<div class="flex-1 h-2.5 rounded bg-muted/40 overflow-hidden">
													<div
														class="h-full rounded {stat.avg_deviation != null && stat.avg_deviation > 2 ? 'bg-red-400/70' : stat.avg_deviation != null && stat.avg_deviation < -2 ? 'bg-blue-400/70' : 'bg-emerald-500/70'}"
														style="width:{Math.round((stat.avg_actual_duration / maxDur) * 100)}%"
													></div>
												</div>
												<span class="text-[10px] tabular-nums text-muted-foreground w-12">{stat.avg_actual_duration} {i18n.t.reports.performance.minutes}</span>
											</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

	<!-- No doctor selected but also no data somehow -->
	{:else if !isLoading}
		<div class="rounded-lg border border-dashed p-12 text-center">
			<p class="text-sm text-muted-foreground">{i18n.t.reports.performance.noData}</p>
		</div>
	{/if}

</div>
