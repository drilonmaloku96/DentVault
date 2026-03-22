<script lang="ts">
	import { i18n } from '$lib/i18n';
	import type { Doctor, DoctorWorkingHours, DoctorWorkingHoursFormData } from '$lib/types';
	import { getDoctorWorkingHours, upsertDoctorWorkingHours } from '$lib/services/db';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';

	interface Props {
		doctor: Doctor | null;
		open?: boolean;
		onClose?: () => void;
	}

	let { doctor, open = $bindable(false), onClose }: Props = $props();

	const DAY_NAMES_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
	const DAY_NAMES_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

	const dayNames = $derived(i18n.code === 'de' ? DAY_NAMES_DE : DAY_NAMES_EN);

	const DEFAULT_HOURS: DoctorWorkingHoursFormData[] = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
		day_of_week: d,
		start_time: '08:00',
		end_time: '18:00',
		break_start: '12:00',
		break_end: '13:00',
		is_active: d >= 1 && d <= 5, // Mon-Fri default
	}));

	let hours = $state<DoctorWorkingHoursFormData[]>(DEFAULT_HOURS.map(h => ({ ...h })));
	let isSaving = $state(false);
	let saved = $state(false);

	$effect(() => {
		if (doctor && open) {
			getDoctorWorkingHours(String(doctor.id)).then((rows: DoctorWorkingHours[]) => {
				if (rows.length === 0) {
					hours = DEFAULT_HOURS.map(h => ({ ...h }));
				} else {
					hours = [0, 1, 2, 3, 4, 5, 6].map((d) => {
						const row = rows.find((r) => r.day_of_week === d);
						return row
							? { day_of_week: d, start_time: row.start_time, end_time: row.end_time, break_start: row.break_start ?? '', break_end: row.break_end ?? '', is_active: row.is_active === 1 }
							: { ...DEFAULT_HOURS[d] };
					});
				}
			});
		}
	});

	async function handleSave() {
		if (!doctor) return;
		isSaving = true;
		try {
			await upsertDoctorWorkingHours(String(doctor.id), hours);
			saved = true;
			setTimeout(() => (saved = false), 2500);
		} finally {
			isSaving = false;
		}
	}

	const inputClass = 'border border-border rounded px-1.5 py-1 text-xs bg-background w-full outline-none focus:border-ring';
</script>

<Dialog bind:open onOpenChange={(v) => !v && onClose?.()}>
	<DialogContent class="max-w-[560px] sm:max-w-[560px]">
		<DialogHeader>
			<DialogTitle>{i18n.t.dashboard.staff.workingHours}{doctor ? ` — ${doctor.name}` : ''}</DialogTitle>
		</DialogHeader>
		<p class="text-xs text-muted-foreground -mt-1">{i18n.t.dashboard.staff.workingHoursDesc}</p>

		<div class="flex flex-col gap-1 mt-2">
			<!-- Header row -->
			<div class="grid grid-cols-[80px_1fr_1fr_1fr_1fr_32px] gap-1.5 px-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
				<span>Tag</span>
				<span>Von</span>
				<span>Bis</span>
				<span>Pause von</span>
				<span>Pause bis</span>
				<span></span>
			</div>
			{#each hours as h}
				<div class="grid grid-cols-[80px_1fr_1fr_1fr_1fr_32px] gap-1.5 items-center px-1 py-0.5 rounded {h.is_active ? '' : 'opacity-40'}">
					<label class="flex items-center gap-1.5 cursor-pointer">
						<input type="checkbox" bind:checked={h.is_active} class="rounded" />
						<span class="text-sm font-medium">{dayNames[h.day_of_week]}</span>
					</label>
					<input type="time" step="300" class={inputClass} bind:value={h.start_time} disabled={!h.is_active} />
					<input type="time" step="300" class={inputClass} bind:value={h.end_time} disabled={!h.is_active} />
					<input type="time" step="300" class={inputClass} bind:value={h.break_start} disabled={!h.is_active} />
					<input type="time" step="300" class={inputClass} bind:value={h.break_end} disabled={!h.is_active} />
					<div></div>
				</div>
			{/each}
		</div>

		<div class="flex items-center justify-between pt-2">
			{#if saved}
				<span class="text-xs text-emerald-600">✓ {i18n.t.settings.saved}</span>
			{:else}
				<span></span>
			{/if}
			<div class="flex gap-2">
				<button
					class="rounded px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
					onclick={onClose}
				>
					{i18n.t.actions.cancel}
				</button>
				<button
					class="rounded px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
					onclick={handleSave}
					disabled={isSaving}
				>
					{isSaving ? i18n.t.common.loading : i18n.t.actions.save}
				</button>
			</div>
		</div>
	</DialogContent>
</Dialog>
