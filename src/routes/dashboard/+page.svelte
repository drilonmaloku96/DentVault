<script lang="ts">
	import { onMount } from 'svelte';
	import {
		getPatientStatusCounts,
		getCategoryStats,
		getOutcomeStats,
		getOverallSuccessRate,
		getRecentEntries,
		getUpcomingAppointments,
		getProviderOutcomeStats,
		getActivityStats,
		getDoctorActivityStats,
		getAppointmentPeriodStats,
		getAppointmentHeatmap,
		getPatientDemographics,
	} from '$lib/services/db';
	import { Separator } from '$lib/components/ui/separator';
	import { i18n } from '$lib/i18n';
	import { formatDate } from '$lib/utils';
	import { activePatient } from '$lib/stores/activePatient.svelte';
	import StaffAnalytics from '$lib/components/dashboard/StaffAnalytics.svelte';
	import type {
		PatientStatusCounts,
		CategoryStat,
		OutcomeStat,
		SuccessRateStat,
		RecentEntry,
		Patient,
	} from '$lib/types';

	// ── Tab state ─────────────────────────────────────────────────────────
	let activeTab = $state<'overview' | 'staff'>('overview');

	// ── Period toggle (shared across all activity cards) ──────────────────
	type Period = 'week' | 'month' | 'year';
	let period = $state<Period>('month');

	function periodDates(p: Period): { from: string; to: string } {
		const today = new Date();
		const to = today.toISOString().slice(0, 10);
		const d = new Date(today);
		if (p === 'week')  d.setDate(d.getDate() - 6);
		else if (p === 'month') d.setDate(d.getDate() - 29);
		else d.setFullYear(d.getFullYear() - 1);
		return { from: d.toISOString().slice(0, 10), to };
	}

	// ── State ─────────────────────────────────────────────────────────────
	let isLoading = $state(true);
	let isActivityLoading = $state(false);
	let patientCounts = $state<PatientStatusCounts>({ total: 0, active: 0, inactive: 0, archived: 0 });
	let categoryStats = $state<CategoryStat[]>([]);
	let outcomeStats = $state<OutcomeStat[]>([]);
	let successRate = $state<SuccessRateStat>({ successful: 0, total_with_outcome: 0 });
	let recentEntries = $state<RecentEntry[]>([]);
	let upcomingAppointments = $state<Patient[]>([]);
	let providerStats = $state<{ doctor_name: string; total: number; successful: number }[]>([]);

	// Period-dependent stats
	let activityStats = $state({ patients_served: 0, entries_count: 0, new_patients: 0 });
	let doctorActivity = $state<{ doctor_name: string; doctor_color: string; patients_served: number; entries_count: number }[]>([]);
	let appointmentStats = $state({ total: 0, completed: 0, cancelled: 0, no_show: 0, avg_duration_min: 0 });
	let appointmentHeatmap = $state<Array<{ day_of_week: number; hour: number; count: number }>>([]);

	// Static (whole-of-time) demographics
	let demographics = $state<{
		avg_age: number | null;
		age_buckets: Array<{ label: string; count: number }>;
		gender_counts: Array<{ gender: string; count: number }>;
		referral_counts: Array<{ source: string; count: number }>;
	}>({ avg_age: null, age_buckets: [], gender_counts: [], referral_counts: [] });

	async function loadActivityData() {
		isActivityLoading = true;
		const { from, to } = periodDates(period);
		const [activity, doctors, apptStats, heatmap] = await Promise.all([
			getActivityStats(from, to),
			getDoctorActivityStats(from, to),
			getAppointmentPeriodStats(from, to),
			getAppointmentHeatmap(from, to),
		]);
		activityStats = activity;
		doctorActivity = doctors;
		appointmentStats = apptStats;
		appointmentHeatmap = heatmap;
		isActivityLoading = false;
	}

	onMount(async () => {
		const { from, to } = periodDates(period);
		const [counts, cats, outcomes, rate, recent, upcoming, providers, activity, doctors, apptStats, heatmap, demo] = await Promise.all([
			getPatientStatusCounts(),
			getCategoryStats(),
			getOutcomeStats(),
			getOverallSuccessRate(),
			getRecentEntries(12),
			getUpcomingAppointments(8),
			getProviderOutcomeStats(),
			getActivityStats(from, to),
			getDoctorActivityStats(from, to),
			getAppointmentPeriodStats(from, to),
			getAppointmentHeatmap(from, to),
			getPatientDemographics(),
		]);
		patientCounts = counts;
		categoryStats = cats;
		outcomeStats = outcomes;
		successRate = rate;
		recentEntries = recent;
		upcomingAppointments = upcoming;
		providerStats = providers;
		activityStats = activity;
		doctorActivity = doctors;
		appointmentStats = apptStats;
		appointmentHeatmap = heatmap;
		demographics = demo;
		isLoading = false;
	});

	// Reload activity data when period changes (after initial load)
	$effect(() => {
		period; // reactive dependency
		if (!isLoading) loadActivityData();
	});

	// ── Computed ──────────────────────────────────────────────────────────
	const totalProcedures = $derived(categoryStats.reduce((s, c) => s + c.count, 0));
	const maxCategoryCount = $derived(
		categoryStats.length > 0 ? Math.max(...categoryStats.map((c) => c.count)) : 1,
	);

	const outcomeMap = $derived(() => {
		const map = new Map<string, Map<string, number>>();
		for (const row of outcomeStats) {
			if (!map.has(row.category)) map.set(row.category, new Map());
			map.get(row.category)!.set(row.outcome, row.count);
		}
		return map;
	});

	const categoriesWithOutcomes = $derived([...outcomeMap().keys()].sort());

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

	const OUTCOME_CLASSES: Record<string, string> = {
		successful: 'text-emerald-600 dark:text-emerald-400',
		retreated: 'text-amber-600 dark:text-amber-400',
		failed_extracted: 'text-red-600 dark:text-red-400',
		failed_other: 'text-red-500 dark:text-red-400',
		ongoing: 'text-blue-600 dark:text-blue-400',
		unknown: 'text-muted-foreground',
	};

	const ENTRY_TYPE_ICONS: Record<string, string> = {
		visit: '🏥', procedure: '🦷', note: '📝',
		lab: '🔬', imaging: '📷', referral: '📋', document: '📄',
	};

	function catLabel(key: string): string { return CATEGORY_LABELS[key] ?? key; }

	function getOutcomeCount(cat: string, outcome: string): number {
		return outcomeMap().get(cat)?.get(outcome) ?? 0;
	}

	function getCategoryTotal(cat: string): number {
		let total = 0;
		for (const [, count] of (outcomeMap().get(cat) ?? new Map()).entries()) total += count;
		return total;
	}

	function pct(n: number, total: number): string {
		if (total === 0) return '0%';
		return Math.round((n / total) * 100) + '%';
	}

	const periodLabel = $derived(i18n.t.dashboard.period[period]);

	// ── Heatmap helpers ────────────────────────────────────────────────
	// strftime %w: 0=Sun, 1=Mon … 6=Sat → reorder to Mon-Sun for display
	const HEATMAP_DAYS = [1, 2, 3, 4, 5, 6, 0]; // Mon … Sun
	const HEATMAP_DAY_LABELS = $derived(
		i18n.code === 'de'
			? ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
			: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
	);
	const HEATMAP_HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];

	const heatmapMap = $derived(() => {
		const m = new Map<string, number>();
		for (const row of appointmentHeatmap) m.set(`${row.day_of_week}-${row.hour}`, row.count);
		return m;
	});

	const maxHeatCount = $derived(() => {
		let max = 0;
		for (const row of appointmentHeatmap) if (row.count > max) max = row.count;
		return max;
	});

	const dayTotals = $derived(() => {
		const t = new Map<number, number>();
		for (const row of appointmentHeatmap) t.set(row.day_of_week, (t.get(row.day_of_week) ?? 0) + row.count);
		return t;
	});

	const maxDayTotal = $derived(() => {
		let max = 0;
		for (const [, v] of dayTotals()) if (v > max) max = v;
		return max;
	});

	// ── Demographics helpers ───────────────────────────────────────────
	const totalPatientsWithDob = $derived(demographics.age_buckets.reduce((s, b) => s + b.count, 0));
	const maxAgeBucket = $derived(
		demographics.age_buckets.length > 0 ? Math.max(...demographics.age_buckets.map((b) => b.count)) : 1,
	);
	const totalGender = $derived(demographics.gender_counts.reduce((s, g) => s + g.count, 0));
	const totalReferral = $derived(demographics.referral_counts.reduce((s, r) => s + r.count, 0));

	const GENDER_LABELS = $derived<Record<string, string>>(
		i18n.code === 'de'
			? { male: 'Männlich', female: 'Weiblich', other: 'Divers', unknown: 'Unbekannt' }
			: { male: 'Male', female: 'Female', other: 'Other', unknown: 'Unknown' },
	);
	const GENDER_COLORS: Record<string, string> = {
		male: '#3b82f6', female: '#ec4899', other: '#a855f7', unknown: '#6b7280',
	};

	const cancellationRate = $derived(
		appointmentStats.total > 0 ? Math.round(100 * appointmentStats.cancelled / appointmentStats.total) : 0,
	);
	const noShowRate = $derived(
		appointmentStats.total > 0 ? Math.round(100 * appointmentStats.no_show / appointmentStats.total) : 0,
	);
</script>

<div class="flex flex-col gap-8">

	<!-- ── Page Header ── -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold tracking-tight">{i18n.t.nav.dashboard}</h1>
			<p class="text-sm text-muted-foreground mt-0.5">{i18n.t.dashboard.title}</p>
		</div>
		<div class="flex items-center gap-3">
			{#if activePatient.id}
				<a
					href="/patients/{activePatient.id}"
					class="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 text-muted-foreground">
						<path d="M19 12H5M12 19l-7-7 7-7"/>
					</svg>
					{activePatient.displayName}
				</a>
			{/if}
			{#if !isLoading}
				<span class="text-xs text-muted-foreground/60">Updated {formatDate(new Date())}</span>
			{/if}
		</div>
	</div>

	<!-- Tab bar -->
	<div class="flex gap-1 border-b border-border -mt-2">
		<button
			class="px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeTab === 'overview' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
			onclick={() => (activeTab = 'overview')}
		>
			{i18n.t.dashboard.staff.overview}
		</button>
		<button
			class="px-4 py-2 text-sm font-medium border-b-2 transition-colors {activeTab === 'staff' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}"
			onclick={() => (activeTab = 'staff')}
		>
			{i18n.t.dashboard.staff.title}
		</button>
	</div>

	{#if activeTab === 'overview'}

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

		<!-- ── Period toggle + Stat Cards ── -->
		<div class="flex flex-col gap-3">

			<!-- Period toggle pill row -->
			<div class="flex items-center gap-2">
				<span class="text-xs text-muted-foreground font-medium">Zeitraum:</span>
				<div class="flex rounded-lg border border-border overflow-hidden">
					{#each (['week', 'month', 'year'] as Period[]) as p}
						<button
							class="px-3 py-1.5 text-xs font-medium transition-colors
								{period === p
									? 'bg-primary text-primary-foreground'
									: 'bg-background text-muted-foreground hover:bg-muted hover:text-foreground'}"
							onclick={() => (period = p)}
						>
							{i18n.t.dashboard.period[p]}
						</button>
					{/each}
				</div>
				{#if isActivityLoading}
					<span class="text-xs text-muted-foreground/50 animate-pulse">↻</span>
				{/if}
			</div>

			<!-- 4 Stat Cards -->
			<div class="grid grid-cols-2 gap-4 sm:grid-cols-4">

				<!-- Total Patients (static) -->
				<div class="rounded-lg border bg-card p-5 flex flex-col gap-1">
					<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.dashboard.stats.totalPatients}</span>
					<span class="text-3xl font-bold tabular-nums">{patientCounts.total}</span>
					<span class="text-xs text-muted-foreground mt-1">
						{patientCounts.active} {i18n.t.patients.status.active.toLowerCase()} · {patientCounts.inactive} {i18n.t.patients.status.inactive.toLowerCase()}
					</span>
				</div>

				<!-- Patients Served (period) -->
				<div class="rounded-lg border bg-card p-5 flex flex-col gap-1 relative overflow-hidden">
					<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.dashboard.stats.patientsServed}</span>
					<span class="text-3xl font-bold tabular-nums {isActivityLoading ? 'opacity-50' : ''}">
						{activityStats.patients_served}
					</span>
					<span class="text-xs text-muted-foreground mt-1">{periodLabel}</span>
				</div>

				<!-- New Patients (period) -->
				<div class="rounded-lg border bg-card p-5 flex flex-col gap-1">
					<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.dashboard.stats.newPatients}</span>
					<span class="text-3xl font-bold tabular-nums text-primary {isActivityLoading ? 'opacity-50' : ''}">
						{activityStats.new_patients}
					</span>
					<span class="text-xs text-muted-foreground mt-1">{periodLabel}</span>
				</div>

				<!-- Treatments / Entries (period) -->
				<div class="rounded-lg border bg-card p-5 flex flex-col gap-1">
					<span class="text-xs font-medium uppercase tracking-wide text-muted-foreground">{i18n.t.dashboard.stats.treatments}</span>
					<span class="text-3xl font-bold tabular-nums {isActivityLoading ? 'opacity-50' : ''}">
						{activityStats.entries_count}
					</span>
					<span class="text-xs text-muted-foreground mt-1">{periodLabel}</span>
				</div>

			</div>
		</div>

		<!-- ── Doctor Activity (period-aware) ── -->
		{#if doctorActivity.length > 0}
			<div class="rounded-lg border bg-card overflow-hidden">
				<div class="px-5 py-3 border-b flex items-center justify-between">
					<div>
						<h2 class="text-sm font-semibold">{i18n.t.dashboard.doctorActivity}</h2>
						<p class="text-xs text-muted-foreground mt-0.5">{periodLabel}</p>
					</div>
				</div>
				<div class="overflow-x-auto">
					<table class="w-full text-xs">
						<thead class="bg-muted/40">
							<tr>
								<th class="text-left px-5 py-2.5 font-medium text-muted-foreground">{i18n.t.reports.columns.doctor}</th>
								<th class="text-center px-4 py-2.5 font-medium text-muted-foreground">{i18n.t.dashboard.stats.patientsServed}</th>
								<th class="text-center px-4 py-2.5 font-medium text-muted-foreground">{i18n.t.dashboard.stats.treatments}</th>
								<th class="text-right px-5 py-2.5 font-medium text-muted-foreground">Ø / Patient</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border/40">
							{#each doctorActivity as doc}
								{@const avgPerPatient = doc.patients_served > 0 ? (doc.entries_count / doc.patients_served).toFixed(1) : '—'}
								<tr class="hover:bg-muted/20 transition-colors {isActivityLoading ? 'opacity-50' : ''}">
									<td class="px-5 py-2.5">
										<div class="flex items-center gap-2">
											<span class="h-2 w-2 rounded-full shrink-0" style="background: {doc.doctor_color}"></span>
											<span class="font-medium">{doc.doctor_name}</span>
										</div>
									</td>
									<td class="px-4 py-2.5 text-center tabular-nums font-medium">{doc.patients_served}</td>
									<td class="px-4 py-2.5 text-center tabular-nums">{doc.entries_count}</td>
									<td class="px-5 py-2.5 text-right tabular-nums text-muted-foreground">{avgPerPatient}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}

		<!-- ── Appointment Analytics ── -->
		<div class="grid gap-6 lg:grid-cols-[1fr_1fr]">

			<!-- Left: Appointment stats + Day-of-week bars -->
			<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-semibold">{i18n.t.dashboard.appointments.title}</h2>
					<span class="text-xs text-muted-foreground">{periodLabel}</span>
				</div>

				<!-- 4 mini stat chips -->
				<div class="grid grid-cols-2 gap-3">
					<div class="rounded-md bg-muted/40 p-3 flex flex-col gap-0.5">
						<span class="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{i18n.t.dashboard.appointments.booked}</span>
						<span class="text-2xl font-bold tabular-nums {isActivityLoading ? 'opacity-50' : ''}">{appointmentStats.total}</span>
						<span class="text-[10px] text-muted-foreground">{appointmentStats.completed} {i18n.t.dashboard.appointments.completed.toLowerCase()}</span>
					</div>
					<div class="rounded-md bg-muted/40 p-3 flex flex-col gap-0.5">
						<span class="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{i18n.t.dashboard.appointments.avgDuration}</span>
						<span class="text-2xl font-bold tabular-nums {isActivityLoading ? 'opacity-50' : ''}">{appointmentStats.avg_duration_min}</span>
						<span class="text-[10px] text-muted-foreground">{i18n.t.dashboard.appointments.minutes}</span>
					</div>
					<div class="rounded-md bg-red-50 dark:bg-red-950/30 p-3 flex flex-col gap-0.5">
						<span class="text-[10px] uppercase tracking-wide text-red-600 dark:text-red-400 font-medium">{i18n.t.dashboard.appointments.cancelled}</span>
						<span class="text-2xl font-bold tabular-nums text-red-600 dark:text-red-400 {isActivityLoading ? 'opacity-50' : ''}">{appointmentStats.cancelled}</span>
						<span class="text-[10px] text-red-500/70">{cancellationRate}% {i18n.t.dashboard.appointments.cancellationRate.toLowerCase()}</span>
					</div>
					<div class="rounded-md bg-amber-50 dark:bg-amber-950/30 p-3 flex flex-col gap-0.5">
						<span class="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-medium">{i18n.t.dashboard.appointments.noShow}</span>
						<span class="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400 {isActivityLoading ? 'opacity-50' : ''}">{appointmentStats.no_show}</span>
						<span class="text-[10px] text-amber-500/70">{noShowRate}% {i18n.t.dashboard.appointments.noShowRate.toLowerCase()}</span>
					</div>
				</div>

				<!-- Day-of-week bars -->
				<div class="flex flex-col gap-1 pt-1 border-t">
					<p class="text-[10px] uppercase tracking-wide text-muted-foreground font-medium mb-1">{i18n.t.dashboard.appointments.byDay}</p>
					{#each HEATMAP_DAYS as dayIdx, di}
						{@const total = dayTotals().get(dayIdx) ?? 0}
						{@const pctW = maxDayTotal() > 0 ? Math.round((total / maxDayTotal()) * 100) : 0}
						<div class="flex items-center gap-2 text-xs {isActivityLoading ? 'opacity-50' : ''}">
							<span class="w-6 shrink-0 text-muted-foreground text-right">{HEATMAP_DAY_LABELS[di]}</span>
							<div class="flex-1 h-3 rounded-full bg-muted overflow-hidden">
								<div class="h-full rounded-full bg-blue-400 transition-all duration-500" style="width:{pctW}%"></div>
							</div>
							<span class="w-5 tabular-nums text-muted-foreground text-right">{total}</span>
						</div>
					{/each}
				</div>
			</div>

			<!-- Right: Time heatmap -->
			<div class="rounded-lg border bg-card p-5 flex flex-col gap-3">
				<div class="flex items-center justify-between">
					<h2 class="text-sm font-semibold">{i18n.t.dashboard.appointments.heatmap}</h2>
					<span class="text-xs text-muted-foreground">{periodLabel}</span>
				</div>

				{#if appointmentHeatmap.length === 0 && !isActivityLoading}
					<p class="text-sm text-muted-foreground text-center py-8">{i18n.t.dashboard.noData}</p>
				{:else}
					<div class="overflow-x-auto">
						<div class="min-w-[280px]" style="display:grid; grid-template-columns: 28px repeat(7,1fr); gap:2px; {isActivityLoading ? 'opacity-50' : ''}">
							<!-- Column headers (days) -->
							<div></div>
							{#each HEATMAP_DAY_LABELS as label}
								<div class="text-[10px] text-muted-foreground text-center pb-1 font-medium">{label}</div>
							{/each}
							<!-- Rows (hours) -->
							{#each HEATMAP_HOURS as hour}
								<div class="text-[10px] text-muted-foreground/70 text-right pr-1 leading-5">{String(hour).padStart(2,'0')}</div>
								{#each HEATMAP_DAYS as dayIdx}
									{@const count = heatmapMap().get(`${dayIdx}-${hour}`) ?? 0}
									{@const intensity = maxHeatCount() > 0 ? count / maxHeatCount() : 0}
									{@const alpha = count > 0 ? (0.18 + intensity * 0.72).toFixed(2) : '0.04'}
									<div
										class="h-5 rounded-[3px] transition-colors"
										style="background:rgba(59,130,246,{alpha})"
										title="{count} appt {String(hour).padStart(2,'0')}:00 {HEATMAP_DAY_LABELS[HEATMAP_DAYS.indexOf(dayIdx)]}"
									></div>
								{/each}
							{/each}
						</div>
					</div>
					<!-- Scale legend -->
					<div class="flex items-center gap-2 pt-1">
						<span class="text-[10px] text-muted-foreground/60">0</span>
						<div class="flex gap-px h-2 flex-1">
							{#each [0.04, 0.18, 0.36, 0.54, 0.72, 0.90] as a}
								<div class="flex-1 rounded-sm" style="background:rgba(59,130,246,{a})"></div>
							{/each}
						</div>
						<span class="text-[10px] text-muted-foreground/60">{maxHeatCount()}</span>
					</div>
				{/if}
			</div>
		</div>

		<!-- ── Patient Demographics ── -->
		<div class="grid gap-6 lg:grid-cols-[1fr_1fr_1fr]">

			<!-- Age stats -->
			<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
				<h2 class="text-sm font-semibold">{i18n.t.dashboard.demographics.title}</h2>
				{#if demographics.avg_age !== null}
					<div class="flex items-baseline gap-2">
						<span class="text-4xl font-bold tabular-nums">{demographics.avg_age}</span>
						<span class="text-sm text-muted-foreground">{i18n.t.dashboard.demographics.years} · Ø {i18n.t.dashboard.demographics.avgAge.toLowerCase()}</span>
					</div>
					<div class="text-xs text-muted-foreground">
						{i18n.code === 'de' ? 'Basierend auf' : 'Based on'} {totalPatientsWithDob} {i18n.code === 'de' ? 'Patienten mit Geburtsdatum' : 'patients with date of birth'}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">{i18n.t.dashboard.noData}</p>
				{/if}

				<!-- Age distribution -->
				{#if demographics.age_buckets.length > 0}
					<div class="flex flex-col gap-2 border-t pt-3">
						<p class="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">{i18n.t.dashboard.demographics.ageDistribution}</p>
						{#each demographics.age_buckets as bucket}
							{@const pctW = Math.round((bucket.count / maxAgeBucket) * 100)}
							{@const pctOfAll = totalPatientsWithDob > 0 ? Math.round((bucket.count / totalPatientsWithDob) * 100) : 0}
							<div class="flex items-center gap-2 text-xs">
								<span class="w-10 shrink-0 text-muted-foreground font-mono text-right">{bucket.label}</span>
								<div class="flex-1 h-3 rounded-full bg-muted overflow-hidden">
									<div class="h-full rounded-full bg-violet-400 transition-all duration-500" style="width:{pctW}%"></div>
								</div>
								<span class="w-12 tabular-nums text-muted-foreground text-right">{bucket.count} <span class="text-muted-foreground/50">({pctOfAll}%)</span></span>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Gender breakdown -->
			<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
				<h2 class="text-sm font-semibold">{i18n.t.dashboard.demographics.gender}</h2>
				{#if demographics.gender_counts.length > 0}
					<!-- Visual bar stack -->
					<div class="h-4 w-full rounded-full overflow-hidden flex">
						{#each demographics.gender_counts as g}
							{@const pct = totalGender > 0 ? (g.count / totalGender) * 100 : 0}
							{#if pct > 0}
								<div
									class="h-full transition-all"
									style="width:{pct.toFixed(1)}%; background:{GENDER_COLORS[g.gender] ?? '#6b7280'}"
									title="{GENDER_LABELS[g.gender] ?? g.gender}: {g.count}"
								></div>
							{/if}
						{/each}
					</div>
					<!-- Legend rows -->
					<div class="flex flex-col gap-2">
						{#each demographics.gender_counts as g}
							{@const pct = totalGender > 0 ? Math.round((g.count / totalGender) * 100) : 0}
							<div class="flex items-center gap-2 text-xs">
								<span class="h-2.5 w-2.5 rounded-full shrink-0" style="background:{GENDER_COLORS[g.gender] ?? '#6b7280'}"></span>
								<span class="flex-1 text-muted-foreground">{GENDER_LABELS[g.gender] ?? g.gender}</span>
								<span class="tabular-nums font-medium">{g.count}</span>
								<span class="tabular-nums text-muted-foreground w-8 text-right">{pct}%</span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">{i18n.t.dashboard.noData}</p>
				{/if}
			</div>

			<!-- Referral sources -->
			<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
				<h2 class="text-sm font-semibold">{i18n.t.dashboard.demographics.referralSource}</h2>
				{#if demographics.referral_counts.filter(r => r.source !== 'unknown').length > 0}
					{@const knownReferrals = demographics.referral_counts.filter(r => r.source !== 'unknown')}
					{@const maxRef = Math.max(...knownReferrals.map(r => r.count))}
					<div class="flex flex-col gap-2">
						{#each knownReferrals as ref}
							{@const pctW = maxRef > 0 ? Math.round((ref.count / maxRef) * 100) : 0}
							{@const pctOfAll = totalReferral > 0 ? Math.round((ref.count / totalReferral) * 100) : 0}
							<div class="flex items-center gap-2 text-xs">
								<span class="w-20 shrink-0 text-muted-foreground truncate text-right" title="{ref.source}">{ref.source}</span>
								<div class="flex-1 h-3 rounded-full bg-muted overflow-hidden">
									<div class="h-full rounded-full bg-teal-400 transition-all duration-500" style="width:{pctW}%"></div>
								</div>
								<span class="w-14 tabular-nums text-muted-foreground text-right">{ref.count} <span class="text-muted-foreground/50">({pctOfAll}%)</span></span>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">{i18n.t.dashboard.noData}</p>
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
						<p class="text-sm text-muted-foreground py-4 text-center">{i18n.t.dashboard.noData}</p>
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
							<span class="text-xs text-muted-foreground shrink-0">{totalProcedures} total</span>
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

			<!-- Right column: Upcoming + Recent Activity -->
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
						<p class="text-sm text-muted-foreground text-center py-4">{i18n.t.dashboard.noData}</p>
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
						<p class="text-sm text-muted-foreground text-center py-4">{i18n.t.dashboard.noData}</p>
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

		<!-- ── Provider Outcome Stats (all-time) ── -->
		{#if providerStats.length > 0}
			<div class="rounded-lg border bg-card overflow-hidden">
				<div class="px-5 py-4 border-b">
					<h2 class="text-sm font-semibold">{i18n.t.dashboard.providerOutcomes}</h2>
					<p class="text-xs text-muted-foreground mt-0.5">{i18n.t.dashboard.stats.successRate} · alle Einträge</p>
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

		<!-- ── Empty state ── -->
		{#if patientCounts.total === 0}
			<div class="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-12 text-center">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-4 h-12 w-12 text-muted-foreground/40">
					<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"/>
				</svg>
				<h3 class="text-base font-medium text-muted-foreground">{i18n.t.dashboard.noData}</h3>
				<p class="mt-1 text-sm text-muted-foreground/70 max-w-xs">{i18n.t.patients.noPatients}</p>
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

	{/if}

	{#if activeTab === 'staff'}
		<StaffAnalytics />
	{/if}

</div>
