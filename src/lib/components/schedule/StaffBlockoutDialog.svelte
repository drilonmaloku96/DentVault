<script lang="ts">
	import { i18n } from '$lib/i18n';
	import type { StaffBlockout, StaffBlockoutFormData, BlockoutReason } from '$lib/types';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';

	interface Props {
		open?: boolean;
		blockouts: StaffBlockout[];
		onSave?: (data: StaffBlockoutFormData) => void;
		onUpdate?: (id: string, data: StaffBlockoutFormData) => void;
		onDelete?: (id: string) => void;
		onClose?: () => void;
	}

	let { open = $bindable(false), blockouts, onSave, onUpdate, onDelete, onClose }: Props = $props();

	let editingBlockout = $state<StaffBlockout | null>(null);
	let showForm = $state(false);

	// Form state
	let fDoctorId = $state('');
	let fStartDate = $state('');
	let fEndDate = $state('');
	let fStartTime = $state('08:00');
	let fEndTime = $state('17:00');
	let fIsAllDay = $state(true);
	let fReason = $state<BlockoutReason>('vacation');
	let fNotes = $state('');
	let fColor = $state('#f59e0b');

	const REASON_COLORS: Record<BlockoutReason, string> = {
		vacation: '#f59e0b',
		sick: '#ef4444',
		conference: '#3b82f6',
		training: '#10b981',
		other: '#94a3b8',
	};

	function openNewForm() {
		editingBlockout = null;
		fDoctorId = '';
		fStartDate = new Date().toISOString().slice(0, 10);
		fEndDate = new Date().toISOString().slice(0, 10);
		fStartTime = '08:00';
		fEndTime = '17:00';
		fIsAllDay = true;
		fReason = 'vacation';
		fNotes = '';
		fColor = REASON_COLORS.vacation;
		showForm = true;
	}

	function openEditForm(b: StaffBlockout) {
		editingBlockout = b;
		fDoctorId = b.doctor_id;
		fStartDate = b.start_date;
		fEndDate = b.end_date;
		fStartTime = b.start_time ?? '08:00';
		fEndTime = b.end_time ?? '17:00';
		fIsAllDay = b.is_all_day === 1;
		fReason = b.reason;
		fNotes = b.notes ?? '';
		fColor = b.color;
		showForm = true;
	}

	function onReasonChange() {
		fColor = REASON_COLORS[fReason];
	}

	function handleSave() {
		if (!fDoctorId || !fStartDate || !fEndDate) return;
		const data: StaffBlockoutFormData = {
			doctor_id: fDoctorId,
			start_date: fStartDate,
			end_date: fEndDate,
			start_time: fIsAllDay ? '' : fStartTime,
			end_time: fIsAllDay ? '' : fEndTime,
			is_all_day: fIsAllDay,
			reason: fReason,
			notes: fNotes,
			color: fColor,
		};
		if (editingBlockout) {
			onUpdate?.(editingBlockout.id, data);
		} else {
			onSave?.(data);
		}
		showForm = false;
		editingBlockout = null;
	}

	const inputClass = 'border border-border rounded px-2 py-1.5 text-sm bg-background w-full outline-none focus:border-ring focus:ring-1 focus:ring-ring/50';

	function reasonLabel(r: BlockoutReason): string {
		return i18n.t.schedule.staffBlockouts.reasons[r];
	}

	function reasonColor(r: BlockoutReason): string {
		const map: Record<BlockoutReason, string> = {
			vacation: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
			sick: 'bg-red-100 text-red-800 dark:bg-red-950/30 dark:text-red-300',
			conference: 'bg-blue-100 text-blue-800 dark:bg-blue-950/30 dark:text-blue-300',
			training: 'bg-green-100 text-green-800 dark:bg-green-950/30 dark:text-green-300',
			other: 'bg-muted text-muted-foreground',
		};
		return map[r] ?? map.other;
	}
</script>

<Dialog bind:open onOpenChange={(v) => !v && onClose?.()}>
	<DialogContent class="max-w-[520px] sm:max-w-[520px]">
		<DialogHeader>
			<DialogTitle>{i18n.t.schedule.staffBlockouts.title}</DialogTitle>
		</DialogHeader>

		<div class="flex flex-col gap-4 mt-2 max-h-[60vh] overflow-y-auto pr-1">
			{#if !showForm}
				<!-- List of blockouts -->
				{#if blockouts.length === 0}
					<p class="text-sm text-muted-foreground">{i18n.t.schedule.staffBlockouts.noBlockouts}</p>
				{:else}
					{#each blockouts as b}
						<div class="flex items-start gap-3 rounded-lg border border-border p-3">
							<span class="w-3 h-3 rounded-full mt-1 shrink-0" style="background-color: {b.doctor_color ?? '#6366f1'};"></span>
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium">{b.doctor_name}</p>
								<p class="text-xs text-muted-foreground">{b.start_date} – {b.end_date}</p>
								{#if !b.is_all_day && b.start_time && b.end_time}
									<p class="text-xs text-muted-foreground">{b.start_time} – {b.end_time}</p>
								{/if}
							</div>
							<span class="rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 {reasonColor(b.reason)}">
								{reasonLabel(b.reason)}
							</span>
							<div class="flex gap-1 shrink-0">
								<button
									class="text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5"
									onclick={() => openEditForm(b)}
								>✏️</button>
								<button
									class="text-xs text-destructive hover:text-destructive/80 transition-colors px-1.5"
									onclick={() => onDelete?.(b.id)}
								>✕</button>
							</div>
						</div>
					{/each}
				{/if}

				<button
					class="self-start rounded px-3 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
					onclick={openNewForm}
				>
					+ {i18n.t.schedule.staffBlockouts.addBlockout}
				</button>
			{:else}
				<!-- Form -->
				<h3 class="text-sm font-medium">
					{editingBlockout ? i18n.t.schedule.staffBlockouts.editBlockout : i18n.t.schedule.staffBlockouts.addBlockout}
				</h3>

				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.doctor}</label>
					<select class={inputClass} bind:value={fDoctorId}>
						<option value="">—</option>
						{#each doctors.list as d}
							<option value={d.id}>{d.name}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.staffBlockouts.dateRange}</label>
					<div class="grid grid-cols-2 gap-2">
						<input type="date" class={inputClass} bind:value={fStartDate} />
						<input type="date" class={inputClass} bind:value={fEndDate} />
					</div>
				</div>

				<label class="flex items-center gap-2 text-sm cursor-pointer">
					<input type="checkbox" bind:checked={fIsAllDay} class="rounded" />
					{i18n.t.schedule.staffBlockouts.allDay}
				</label>

				{#if !fIsAllDay}
					<div class="flex flex-col gap-1">
						<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.staffBlockouts.timeRange}</label>
						<div class="grid grid-cols-2 gap-2">
							<input type="time" step="300" class={inputClass} bind:value={fStartTime} />
							<input type="time" step="300" class={inputClass} bind:value={fEndTime} />
						</div>
					</div>
				{/if}

				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium text-muted-foreground">Grund / Reason</label>
					<select class={inputClass} bind:value={fReason} onchange={onReasonChange}>
						{#each (['vacation', 'sick', 'conference', 'training', 'other'] as const) as r}
							<option value={r}>{reasonLabel(r)}</option>
						{/each}
					</select>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.notes}</label>
					<textarea class={inputClass} rows="2" bind:value={fNotes}></textarea>
				</div>

				<div class="flex gap-2 pt-1">
					<button
						class="flex-1 rounded px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
						disabled={!fDoctorId || !fStartDate || !fEndDate}
						onclick={handleSave}
					>
						{i18n.t.actions.save}
					</button>
					<button
						class="flex-1 rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
						onclick={() => { showForm = false; editingBlockout = null; }}
					>
						{i18n.t.actions.cancel}
					</button>
				</div>
			{/if}
		</div>
	</DialogContent>
</Dialog>
