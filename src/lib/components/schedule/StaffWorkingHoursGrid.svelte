<script lang="ts">
	import { onMount } from 'svelte';
	import { getDoctorWorkingHours, upsertDoctorWorkingHours } from '$lib/services/db';
	import type { DoctorWorkingHoursFormData } from '$lib/types';
	import { i18n } from '$lib/i18n';

	let {
		doctorId,
		doctorName,
		doctorColor,
		onClose,
		onSaved,
	}: {
		doctorId: number;
		doctorName: string;
		doctorColor: string;
		onClose: () => void;
		onSaved?: () => void;
	} = $props();

	// Day labels: index 0=Sun, 1=Mon, ..., 6=Sat
	const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Mon–Sun
	const SHORT_DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']; // fallback (unused)

	function dayLabel(dow: number): string {
		return i18n.t.defaults.workingDays[dow] ?? SHORT_DAYS[dow];
	}

	let hours = $state<DoctorWorkingHoursFormData[]>([]);
	let saving = $state(false);
	let saved = $state(false);
	let loaded = $state(false);

	// Build a full 7-day array from DB rows (fill missing days with defaults)
	function buildHoursGrid(rows: Awaited<ReturnType<typeof getDoctorWorkingHours>>): DoctorWorkingHoursFormData[] {
		const map = new Map(rows.map(r => [r.day_of_week, r]));
		return Array.from({ length: 7 }, (_, dow) => {
			const r = map.get(dow);
			return {
				day_of_week: dow,
				start_time: r?.start_time ?? '08:00',
				end_time: r?.end_time ?? '17:00',
				break_start: r?.break_start ?? '12:00',
				break_end: r?.break_end ?? '13:00',
				is_active: r ? r.is_active === 1 : (dow >= 1 && dow <= 5), // Mon–Fri active by default
			};
		});
	}

	onMount(async () => {
		const rows = await getDoctorWorkingHours(String(doctorId));
		hours = buildHoursGrid(rows);
		loaded = true;
	});

	async function handleSave() {
		saving = true;
		try {
			await upsertDoctorWorkingHours(String(doctorId), hours);
			saved = true;
			setTimeout(() => { saved = false; }, 2000);
			onSaved?.();
		} finally {
			saving = false;
		}
	}

	const inputClass = 'rounded border border-input bg-background px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-40 disabled:cursor-not-allowed';
	const timeClass = inputClass + ' w-[72px]';
</script>

<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
	<!-- Header -->
	<div class="flex items-center gap-2">
		<span class="w-3 h-3 rounded-full shrink-0" style="background: {doctorColor}"></span>
		<h3 class="text-sm font-semibold">{i18n.t.staff.workingHours} — {doctorName}</h3>
		<button
			type="button"
			onclick={onClose}
			class="ml-auto text-muted-foreground hover:text-foreground transition-colors"
			aria-label="Close"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
				<path d="M18 6L6 18M6 6l12 12"/>
			</svg>
		</button>
	</div>

	{#if !loaded}
		<p class="text-xs text-muted-foreground">{i18n.t.common.loading}</p>
	{:else}
		<!-- Grid table -->
		<div class="overflow-x-auto">
			<table class="w-full text-xs border-collapse">
				<thead>
					<tr class="text-[10px] text-muted-foreground uppercase tracking-wide">
						<th class="text-left py-1 pr-3 font-medium w-24">Tag</th>
						<th class="text-center py-1 px-1 font-medium">{i18n.t.staff.colActive}</th>
						<th class="text-center py-1 px-1 font-medium">{i18n.t.staff.colStart}</th>
						<th class="text-center py-1 px-1 font-medium">{i18n.t.staff.colBreakStart}</th>
						<th class="text-center py-1 px-1 font-medium">{i18n.t.staff.colBreakEnd}</th>
						<th class="text-center py-1 px-1 font-medium">{i18n.t.staff.colEnd}</th>
					</tr>
				</thead>
				<tbody>
					{#each DAY_ORDER as dow}
						{@const h = hours[dow]}
						{#if h}
							<tr class="border-t border-border/50 {h.is_active ? '' : 'opacity-50'}">
								<td class="py-1.5 pr-3">
									<span class="font-medium {h.is_active ? 'text-foreground' : 'text-muted-foreground'}">{dayLabel(dow)}</span>
								</td>
								<td class="py-1.5 px-1 text-center">
									<input
										type="checkbox"
										checked={h.is_active}
										onchange={(e) => { h.is_active = (e.currentTarget as HTMLInputElement).checked; }}
										class="h-3.5 w-3.5 accent-primary cursor-pointer"
									/>
								</td>
								<td class="py-1.5 px-1">
									<input
										type="time"
										bind:value={h.start_time}
										disabled={!h.is_active}
										class={timeClass}
									/>
								</td>
								<td class="py-1.5 px-1">
									<input
										type="time"
										bind:value={h.break_start}
										disabled={!h.is_active}
										class={timeClass}
									/>
								</td>
								<td class="py-1.5 px-1">
									<input
										type="time"
										bind:value={h.break_end}
										disabled={!h.is_active}
										class={timeClass}
									/>
								</td>
								<td class="py-1.5 px-1">
									<input
										type="time"
										bind:value={h.end_time}
										disabled={!h.is_active}
										class={timeClass}
									/>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>

		<!-- Save -->
		<div class="flex justify-end pt-1">
			<button
				type="button"
				onclick={handleSave}
				disabled={saving}
				class="rounded-md bg-primary text-primary-foreground px-4 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
			>
				{saved ? `${i18n.t.settings.saved} ✓` : saving ? i18n.t.common.loading : i18n.t.staff.saveWorkingHours}
			</button>
		</div>
	{/if}
</div>
