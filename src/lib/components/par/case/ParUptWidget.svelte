<script lang="ts">
	import { onMount } from 'svelte';
	import { getParUptSchedule, upsertParUptSchedule } from '$lib/services/db';
	import { calculateUptWindows, classifyUptStatus } from '$lib/utils/par-upt-calculator';
	import type { ParCase, ParAssessment, ParUptSession, UptSessionWindow } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { toLocalISODate, formatDate } from '$lib/utils';

	let {
		parCase,
		assessments,
		locked = false,
	}: {
		parCase: ParCase;
		assessments: ParAssessment[];
		locked?: boolean;
	} = $props();

	let sessions = $state<ParUptSession[]>([]);
	let saving   = $state<number | null>(null); // session number being saved

	// AIT and CPT end dates derived from assessments
	const aitEndDate = $derived(
		assessments.filter(a => a.type === 'AIT' && a.end_date).sort((a, b) => (b.end_date ?? '') > (a.end_date ?? '') ? 1 : -1)[0]?.end_date ?? null
	);
	const cptEndDate = $derived(
		assessments.filter(a => a.type === 'CPT' && a.end_date).sort((a, b) => (b.end_date ?? '') > (a.end_date ?? '') ? 1 : -1)[0]?.end_date ?? null
	);

	// Compute expected windows
	const windows = $derived.by((): UptSessionWindow[] | null => {
		if (!parCase.grade || !aitEndDate) return null;
		try {
			return calculateUptWindows(parCase.grade, aitEndDate, cptEndDate).sessions;
		} catch {
			return null;
		}
	});

	// Merge DB sessions onto computed windows (DB = source of truth for delivered_date)
	const mergedWindows = $derived.by((): UptSessionWindow[] | null => {
		if (!windows) return null;
		return windows.map(w => {
			const dbSess = sessions.find(s => s.session === w.session);
			const deliveredDate = dbSess?.delivered_date ?? null;
			const merged: UptSessionWindow = { ...w, deliveredDate, appointmentId: dbSess?.appointment_id ?? null };
			merged.status = classifyUptStatus(merged);
			return merged;
		});
	});

	onMount(() => { void load(); });

	async function load() {
		sessions = await getParUptSchedule(parCase.id);
	}

	async function saveSchedule(computed: UptSessionWindow[]) {
		const toSave = computed.map(w => ({
			case_id:        parCase.id,
			session:        w.session,
			window_start:   w.windowStart,
			window_end:     w.windowEnd,
			delivered_date: w.deliveredDate,
			assessment_id:  null,
			appointment_id: w.appointmentId,
		}));
		await upsertParUptSchedule(parCase.id, toSave);
		sessions = await getParUptSchedule(parCase.id);
	}

	async function markDelivered(sessionNum: number) {
		if (!mergedWindows) return;
		saving = sessionNum;
		const today = toLocalISODate();
		const updated = mergedWindows.map(w =>
			w.session === sessionNum ? { ...w, deliveredDate: today, status: classifyUptStatus({ ...w, deliveredDate: today }) } : w
		) as UptSessionWindow[];
		await saveSchedule(updated);
		saving = null;
	}

	async function clearDelivered(sessionNum: number) {
		if (!mergedWindows) return;
		saving = sessionNum;
		const updated = mergedWindows.map(w =>
			w.session === sessionNum ? { ...w, deliveredDate: null, status: classifyUptStatus({ ...w, deliveredDate: null }) } : w
		) as UptSessionWindow[];
		await saveSchedule(updated);
		saving = null;
	}

	function statusColor(status: UptSessionWindow['status']): string {
		switch (status) {
			case 'delivered_on_time': return 'text-emerald-600 dark:text-emerald-400';
			case 'delivered_early':   return 'text-emerald-500 dark:text-emerald-400';
			case 'delivered_late':    return 'text-amber-600 dark:text-amber-400';
			case 'overdue':           return 'text-red-600 dark:text-red-400';
			case 'upcoming':          return 'text-blue-600 dark:text-blue-400';
			case 'future':            return 'text-muted-foreground';
		}
	}

	function statusBg(status: UptSessionWindow['status']): string {
		switch (status) {
			case 'delivered_on_time': return 'bg-emerald-50 dark:bg-emerald-950/30';
			case 'delivered_early':   return 'bg-emerald-50 dark:bg-emerald-950/30';
			case 'delivered_late':    return 'bg-amber-50 dark:bg-amber-950/30';
			case 'overdue':           return 'bg-red-50 dark:bg-red-950/30';
			case 'upcoming':          return 'bg-blue-50 dark:bg-blue-950/30';
			case 'future':            return '';
		}
	}

	function statusLabel(status: UptSessionWindow['status']): string {
		return i18n.t.par.upt.status[status];
	}
</script>

<div class="flex flex-col gap-3">
	<div class="flex items-center justify-between">
		<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
			{i18n.t.par.upt.title}
		</h3>
		{#if parCase.grade}
			<span class="text-xs text-muted-foreground">Grade {parCase.grade}</span>
		{/if}
	</div>

	{#if !parCase.grade}
		<p class="text-xs text-muted-foreground italic">{i18n.t.par.upt.noGrade}</p>

	{:else if !aitEndDate}
		<p class="text-xs text-muted-foreground italic">{i18n.t.par.upt.noBaseDate}</p>

	{:else if mergedWindows}
		<div class="flex flex-col gap-1.5">
			{#each mergedWindows as w}
				<div class={[
					'flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 border border-border/50',
					statusBg(w.status),
				].join(' ')}>
					<div class="flex items-center gap-3 min-w-0">
						<!-- Session number bubble -->
						<span class="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground shrink-0">
							{w.session}
						</span>

						<div class="flex flex-col min-w-0">
							<!-- Window range -->
							<span class="text-xs text-muted-foreground">
								{i18n.t.par.upt.window}: {formatDate(w.windowStart)} – {formatDate(w.windowEnd)}
							</span>
							<!-- Delivered date -->
							{#if w.deliveredDate}
								<span class="text-xs">
									{i18n.t.par.upt.delivered}: {formatDate(w.deliveredDate)}
								</span>
							{/if}
						</div>
					</div>

					<div class="flex items-center gap-2 shrink-0">
						<!-- Status chip -->
						<span class={['text-[10px] font-semibold uppercase', statusColor(w.status)].join(' ')}>
							{statusLabel(w.status)}
						</span>

						{#if !locked}
							{#if w.deliveredDate}
								<!-- Clear delivered -->
								<button
									type="button"
									onclick={() => clearDelivered(w.session)}
									disabled={saving === w.session}
									class="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors disabled:opacity-50"
									title="Clear delivered date"
								>
									×
								</button>
							{:else}
								<!-- Mark delivered -->
								<button
									type="button"
									onclick={() => markDelivered(w.session)}
									disabled={saving === w.session}
									class="rounded-md bg-primary/10 hover:bg-primary/20 text-primary px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-50"
								>
									{saving === w.session ? '…' : i18n.t.par.upt.markDelivered}
								</button>
							{/if}
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
