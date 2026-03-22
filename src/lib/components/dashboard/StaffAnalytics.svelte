<script lang="ts">
	import { i18n } from '$lib/i18n';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { getAbsenceStatsByYear, getAppointmentStatsByDoctor } from '$lib/services/db';
	import type { AbsenceStat, AppointmentDoctorStat, Doctor } from '$lib/types';
	import DoctorWorkingHoursDialog from '$lib/components/schedule/DoctorWorkingHoursDialog.svelte';

	// ── Filters ───────────────────────────────────────────────────────
	const currentYear = new Date().getFullYear();
	let selectedYear = $state(currentYear);
	let selectedDoctorId = $state(''); // '' = all
	let dateFrom = $state(`${currentYear}-01-01`);
	let dateTo = $state(new Date().toISOString().slice(0, 10));

	// ── Working Hours Dialog ──────────────────────────────────────────
	let workingHoursDialogOpen = $state(false);
	let workingHoursDoctor = $state<Doctor | null>(null);

	// ── Data ──────────────────────────────────────────────────────────
	let absenceStats = $state<AbsenceStat[]>([]);
	let apptStats = $state<AppointmentDoctorStat[]>([]);
	let isLoading = $state(false);

	async function load() {
		isLoading = true;
		try {
			[absenceStats, apptStats] = await Promise.all([
				getAbsenceStatsByYear(selectedYear),
				getAppointmentStatsByDoctor(dateFrom, dateTo),
			]);
		} finally {
			isLoading = false;
		}
	}

	$effect(() => {
		selectedYear;
		dateFrom;
		dateTo;
		load();
	});

	// ── Derived: filter to selected doctor ───────────────────────────
	const filteredAbsence = $derived(
		selectedDoctorId
			? absenceStats.filter((s) => s.doctor_id === selectedDoctorId)
			: absenceStats
	);

	const filteredAppt = $derived(
		selectedDoctorId
			? apptStats.filter((s) => s.doctor_id === selectedDoctorId)
			: apptStats
	);

	// ── Helpers ──────────────────────────────────────────────────────
	function totalAbsenceDays(s: AbsenceStat): number {
		return s.vacation_days + s.sick_days + s.conference_days + s.training_days + s.other_days;
	}

	function completionRate(s: AppointmentDoctorStat): number | null {
		const decided = s.completed + s.cancelled + s.no_show;
		if (decided === 0) return null;
		return Math.round((s.completed / decided) * 100);
	}

	const inputClass = 'border border-border rounded px-2 py-1.5 text-sm bg-background outline-none focus:border-ring focus:ring-1 focus:ring-ring/50';

	// Years to show in selector (current year back 5 years)
	const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - i);

	// Absence reason color
	const REASON_BG: Record<string, string> = {
		vacation_days: 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300',
		sick_days: 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300',
		conference_days: 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300',
		training_days: 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300',
		other_days: 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300',
	};

	function openWorkingHours() {
		const doc = doctors.list.find((d) => String(d.id) === selectedDoctorId) ?? null;
		workingHoursDoctor = doc;
		workingHoursDialogOpen = true;
	}
</script>

<div class="flex flex-col gap-6">

	<!-- ── Filter Bar ── -->
	<div class="flex flex-wrap items-end gap-3">
		<!-- Doctor selector -->
		<div class="flex flex-col gap-1">
			<label class="text-xs text-muted-foreground font-medium">{i18n.t.dashboard.staff.doctor}</label>
			<select class={inputClass} bind:value={selectedDoctorId}>
				<option value="">{i18n.t.dashboard.staff.allDoctors}</option>
				{#each doctors.list as d}
					<option value={String(d.id)}>{d.name}</option>
				{/each}
			</select>
		</div>

		<!-- Year (for absences) -->
		<div class="flex flex-col gap-1">
			<label class="text-xs text-muted-foreground font-medium">{i18n.t.dashboard.staff.year}</label>
			<select class={inputClass} bind:value={selectedYear}>
				{#each yearOptions as y}
					<option value={y}>{y}</option>
				{/each}
			</select>
		</div>

		<!-- Date range (for appointments) -->
		<div class="flex flex-col gap-1">
			<label class="text-xs text-muted-foreground font-medium">{i18n.t.dashboard.staff.dateRange} ({i18n.t.dashboard.staff.appointmentStats})</label>
			<div class="flex items-center gap-1.5">
				<input type="date" class={inputClass} bind:value={dateFrom} />
				<span class="text-muted-foreground text-sm">–</span>
				<input type="date" class={inputClass} bind:value={dateTo} />
			</div>
		</div>

		<!-- Working Hours button (only when a specific doctor is selected) -->
		{#if selectedDoctorId}
			<div class="flex flex-col gap-1">
				<label class="text-xs text-muted-foreground font-medium opacity-0">.</label>
				<button
					class="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm border border-border hover:bg-accent transition-colors"
					onclick={openWorkingHours}
				>
					<span>⚙</span>
					{i18n.t.dashboard.staff.workingHours}
				</button>
			</div>
		{/if}
	</div>

	{#if isLoading}
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			{#each [1, 2] as _}
				<div class="h-48 animate-pulse rounded-lg border bg-muted"></div>
			{/each}
		</div>
	{:else}

		<!-- ── Absence Summary ── -->
		<div class="rounded-lg border bg-card overflow-hidden">
			<div class="px-5 py-4 border-b flex items-center justify-between">
				<div>
					<h2 class="text-sm font-semibold">{i18n.t.dashboard.staff.absenceSummary}</h2>
					<p class="text-xs text-muted-foreground mt-0.5">{selectedYear} · {i18n.t.dashboard.staff.totalDays}</p>
				</div>
			</div>

			{#if filteredAbsence.filter(s => totalAbsenceDays(s) > 0).length === 0}
				<p class="text-sm text-muted-foreground text-center py-6">{i18n.t.dashboard.staff.noAbsences}</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead class="bg-muted/40 border-b">
							<tr>
								<th class="text-left px-5 py-2.5 font-medium text-muted-foreground text-xs">{i18n.t.dashboard.staff.doctor}</th>
								<th class="text-center px-3 py-2.5 font-medium text-xs text-amber-700 dark:text-amber-400">{i18n.t.dashboard.staff.reasons.vacation}</th>
								<th class="text-center px-3 py-2.5 font-medium text-xs text-red-700 dark:text-red-400">{i18n.t.dashboard.staff.reasons.sick}</th>
								<th class="text-center px-3 py-2.5 font-medium text-xs text-blue-700 dark:text-blue-400">{i18n.t.dashboard.staff.reasons.conference}</th>
								<th class="text-center px-3 py-2.5 font-medium text-xs text-green-700 dark:text-green-400">{i18n.t.dashboard.staff.reasons.training}</th>
								<th class="text-center px-3 py-2.5 font-medium text-xs text-muted-foreground">{i18n.t.dashboard.staff.reasons.other}</th>
								<th class="text-right px-5 py-2.5 font-medium text-xs text-muted-foreground">{i18n.t.dashboard.staff.totalDays}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border/40">
							{#each filteredAbsence as s}
								{@const total = totalAbsenceDays(s)}
								{#if total > 0 || !selectedDoctorId}
									<tr class="hover:bg-muted/20 transition-colors">
										<td class="px-5 py-3">
											<div class="flex items-center gap-2">
												<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: {s.doctor_color}"></span>
												<span class="font-medium text-sm">{s.doctor_name}</span>
											</div>
										</td>
										<td class="px-3 py-3 text-center tabular-nums">
											{#if s.vacation_days > 0}
												<span class="rounded-full px-2 py-0.5 text-xs font-medium {REASON_BG.vacation_days}">{s.vacation_days}</span>
											{:else}
												<span class="text-muted-foreground/30">—</span>
											{/if}
										</td>
										<td class="px-3 py-3 text-center tabular-nums">
											{#if s.sick_days > 0}
												<span class="rounded-full px-2 py-0.5 text-xs font-medium {REASON_BG.sick_days}">{s.sick_days}</span>
											{:else}
												<span class="text-muted-foreground/30">—</span>
											{/if}
										</td>
										<td class="px-3 py-3 text-center tabular-nums">
											{#if s.conference_days > 0}
												<span class="rounded-full px-2 py-0.5 text-xs font-medium {REASON_BG.conference_days}">{s.conference_days}</span>
											{:else}
												<span class="text-muted-foreground/30">—</span>
											{/if}
										</td>
										<td class="px-3 py-3 text-center tabular-nums">
											{#if s.training_days > 0}
												<span class="rounded-full px-2 py-0.5 text-xs font-medium {REASON_BG.training_days}">{s.training_days}</span>
											{:else}
												<span class="text-muted-foreground/30">—</span>
											{/if}
										</td>
										<td class="px-3 py-3 text-center tabular-nums">
											{#if s.other_days > 0}
												<span class="rounded-full px-2 py-0.5 text-xs font-medium {REASON_BG.other_days}">{s.other_days}</span>
											{:else}
												<span class="text-muted-foreground/30">—</span>
											{/if}
										</td>
										<td class="px-5 py-3 text-right font-bold tabular-nums">
											{total > 0 ? total : '—'}
										</td>
									</tr>
								{/if}
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Absence breakdown bar chart per doctor -->
				<div class="px-5 py-4 border-t flex flex-col gap-3">
					{#each filteredAbsence.filter(s => totalAbsenceDays(s) > 0) as s}
						{@const total = totalAbsenceDays(s)}
						<div class="flex items-center gap-3">
							<span class="text-xs text-muted-foreground w-28 truncate shrink-0 text-right">{s.doctor_name}</span>
							<div class="flex-1 flex h-4 rounded-full overflow-hidden bg-muted">
								{#if s.vacation_days > 0}
									<div class="bg-amber-400 dark:bg-amber-500 h-full" style="width: {(s.vacation_days/total)*100}%" title="{i18n.t.dashboard.staff.reasons.vacation}: {s.vacation_days}d"></div>
								{/if}
								{#if s.sick_days > 0}
									<div class="bg-red-400 dark:bg-red-500 h-full" style="width: {(s.sick_days/total)*100}%" title="{i18n.t.dashboard.staff.reasons.sick}: {s.sick_days}d"></div>
								{/if}
								{#if s.conference_days > 0}
									<div class="bg-blue-400 dark:bg-blue-500 h-full" style="width: {(s.conference_days/total)*100}%" title="{i18n.t.dashboard.staff.reasons.conference}: {s.conference_days}d"></div>
								{/if}
								{#if s.training_days > 0}
									<div class="bg-green-400 dark:bg-green-500 h-full" style="width: {(s.training_days/total)*100}%" title="{i18n.t.dashboard.staff.reasons.training}: {s.training_days}d"></div>
								{/if}
								{#if s.other_days > 0}
									<div class="bg-zinc-400 h-full" style="width: {(s.other_days/total)*100}%" title="{i18n.t.dashboard.staff.reasons.other}: {s.other_days}d"></div>
								{/if}
							</div>
							<span class="text-xs tabular-nums text-muted-foreground w-8 shrink-0">{total}d</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- ── Appointment Statistics ── -->
		<div class="rounded-lg border bg-card overflow-hidden">
			<div class="px-5 py-4 border-b">
				<h2 class="text-sm font-semibold">{i18n.t.dashboard.staff.appointmentStats}</h2>
				<p class="text-xs text-muted-foreground mt-0.5">{dateFrom} – {dateTo}</p>
			</div>

			{#if filteredAppt.filter(s => s.total > 0).length === 0}
				<p class="text-sm text-muted-foreground text-center py-6">{i18n.t.dashboard.staff.noAppointments}</p>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead class="bg-muted/40 border-b">
							<tr>
								<th class="text-left px-5 py-2.5 font-medium text-muted-foreground text-xs">{i18n.t.dashboard.staff.doctor}</th>
								<th class="text-center px-3 py-2.5 font-medium text-muted-foreground text-xs">{i18n.t.common.all}</th>
								<th class="text-center px-3 py-2.5 font-medium text-xs text-emerald-600 dark:text-emerald-400">✓</th>
								<th class="text-center px-3 py-2.5 font-medium text-xs text-amber-600 dark:text-amber-400">⏳</th>
								<th class="text-center px-3 py-2.5 font-medium text-xs text-red-500">✕</th>
								<th class="text-center px-3 py-2.5 font-medium text-xs text-red-400">👻</th>
								<th class="text-center px-3 py-2.5 font-medium text-muted-foreground text-xs">{i18n.t.dashboard.staff.completionRate}</th>
								<th class="text-right px-5 py-2.5 font-medium text-muted-foreground text-xs">{i18n.t.dashboard.staff.avgDuration}</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-border/40">
							{#each filteredAppt.filter(s => s.total > 0) as s}
								{@const rate = completionRate(s)}
								<tr class="hover:bg-muted/20 transition-colors">
									<td class="px-5 py-3">
										<div class="flex items-center gap-2">
											<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: {s.doctor_color}"></span>
											<span class="font-medium text-sm">{s.doctor_name}</span>
										</div>
									</td>
									<td class="px-3 py-3 text-center font-bold tabular-nums">{s.total}</td>
									<td class="px-3 py-3 text-center tabular-nums text-emerald-600 dark:text-emerald-400 font-medium">{s.completed || '—'}</td>
									<td class="px-3 py-3 text-center tabular-nums text-amber-600 dark:text-amber-400">{s.scheduled || '—'}</td>
									<td class="px-3 py-3 text-center tabular-nums text-red-500">{s.cancelled || '—'}</td>
									<td class="px-3 py-3 text-center tabular-nums text-red-400">{s.no_show || '—'}</td>
									<td class="px-3 py-3 text-center tabular-nums">
										{#if rate !== null}
											<span class={rate >= 85 ? 'text-emerald-600 dark:text-emerald-400 font-medium' : rate >= 65 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'}>
												{rate}%
											</span>
										{:else}
											<span class="text-muted-foreground/30">—</span>
										{/if}
									</td>
									<td class="px-5 py-3 text-right tabular-nums text-muted-foreground">
										{s.avg_duration_min > 0 ? `${s.avg_duration_min} min` : '—'}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>

				<!-- Per-doctor appointment status bar -->
				<div class="px-5 py-4 border-t flex flex-col gap-3">
					{#each filteredAppt.filter(s => s.total > 0) as s}
						<div class="flex items-center gap-3">
							<span class="text-xs text-muted-foreground w-28 truncate shrink-0 text-right">{s.doctor_name}</span>
							<div class="flex-1 flex h-3 rounded-full overflow-hidden bg-muted">
								{#if s.completed > 0}
									<div class="bg-emerald-400 dark:bg-emerald-500 h-full" style="width: {(s.completed/s.total)*100}%"></div>
								{/if}
								{#if s.scheduled > 0}
									<div class="bg-blue-300 dark:bg-blue-500 h-full" style="width: {(s.scheduled/s.total)*100}%"></div>
								{/if}
								{#if s.cancelled > 0}
									<div class="bg-red-300 dark:bg-red-500 h-full" style="width: {(s.cancelled/s.total)*100}%"></div>
								{/if}
								{#if s.no_show > 0}
									<div class="bg-red-200 dark:bg-red-400 h-full" style="width: {(s.no_show/s.total)*100}%"></div>
								{/if}
							</div>
							<span class="text-xs tabular-nums text-muted-foreground w-8 shrink-0">{s.total}</span>
						</div>
					{/each}
					<!-- Legend -->
					<div class="flex gap-3 flex-wrap pt-1">
						<span class="flex items-center gap-1 text-[10px] text-muted-foreground"><span class="w-2 h-2 rounded-full bg-emerald-400 dark:bg-emerald-500"></span> Completed</span>
						<span class="flex items-center gap-1 text-[10px] text-muted-foreground"><span class="w-2 h-2 rounded-full bg-blue-300 dark:bg-blue-500"></span> Scheduled</span>
						<span class="flex items-center gap-1 text-[10px] text-muted-foreground"><span class="w-2 h-2 rounded-full bg-red-300 dark:bg-red-500"></span> Cancelled</span>
						<span class="flex items-center gap-1 text-[10px] text-muted-foreground"><span class="w-2 h-2 rounded-full bg-red-200 dark:bg-red-400"></span> No-show</span>
					</div>
				</div>
			{/if}
		</div>

	{/if}
</div>

<DoctorWorkingHoursDialog
	bind:open={workingHoursDialogOpen}
	doctor={workingHoursDoctor}
	onClose={() => (workingHoursDialogOpen = false)}
/>
