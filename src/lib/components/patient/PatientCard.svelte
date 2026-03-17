<script lang="ts">
	import type { Patient, PatientStatus } from '$lib/types';
	import { cn } from '$lib/utils';
	import { i18n } from '$lib/i18n';

	let { patient }: { patient: Patient } = $props();

	const statusConfig = $derived<Record<PatientStatus, { label: string; class: string }>>({
		active: { label: i18n.t.patients.status.active, class: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400' },
		inactive: { label: i18n.t.patients.status.inactive, class: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400' },
		archived: { label: i18n.t.patients.status.archived, class: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400' },
	});

	const status = $derived(statusConfig[patient.status] ?? statusConfig.active);

	function formatDob(dob: string): string {
		if (!dob) return '—';
		const d = new Date(dob);
		if (isNaN(d.getTime())) return dob;
		return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function formatDate(dt: string): string {
		if (!dt) return '—';
		const d = new Date(dt);
		if (isNaN(d.getTime())) return dt;
		return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
	}
</script>

<a
	href="/patients/{patient.patient_id}"
	class="group flex flex-col gap-3 rounded-lg border bg-card p-4 shadow-xs transition-all hover:border-ring hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
>
	<!-- Header row -->
	<div class="flex items-start justify-between gap-2">
		<div class="min-w-0">
			<p class="truncate font-semibold text-card-foreground group-hover:text-primary">
				{patient.lastname}, {patient.firstname}
			</p>
			<p class="text-xs text-muted-foreground">{patient.patient_id}</p>
		</div>
		<span
			class={cn(
				'shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium',
				status.class,
			)}
		>
			{status.label}
		</span>
	</div>

	<!-- Info rows -->
	<div class="flex flex-col gap-1 text-sm text-muted-foreground">
		{#if patient.dob}
			<div class="flex items-center gap-1.5">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0">
					<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
				</svg>
				<span>{i18n.t.patients.fields.dob}: {formatDob(patient.dob)}</span>
			</div>
		{/if}
		{#if patient.phone}
			<div class="flex items-center gap-1.5">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0">
					<path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.63A2 2 0 012 .18h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
				</svg>
				<span>{patient.phone}</span>
			</div>
		{/if}
		{#if patient.next_appointment}
			<div class="flex items-center gap-1.5">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 text-primary">
					<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
				</svg>
				<span class="text-primary font-medium">Next: {formatDate(patient.next_appointment)}</span>
			</div>
		{/if}
	</div>
</a>
