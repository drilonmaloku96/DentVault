<script lang="ts">
	import { i18n } from '$lib/i18n';
	import type { ScheduleBlockFormData } from '$lib/types';
	import { rooms } from '$lib/stores/rooms.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';

	export interface DragSelection {
		roomIds: string[];
		startTime: string; // HH:MM
		endTime: string;   // HH:MM
	}

	interface Props {
		anchorRect: DOMRect;
		selections: DragSelection[];
		date: string; // YYYY-MM-DD
		onBlockSave?: (data: ScheduleBlockFormData[]) => void; // one per (room × selection)
		onBookAppointment?: (primary: DragSelection) => void;
		onClose?: () => void;
	}

	let { anchorRect, selections, date, onBlockSave, onBookAppointment, onClose }: Props = $props();

	let mode = $state<'choose' | 'block'>('choose');

	// Block form state
	let blockTitle = $state('');
	let blockDoctorId = $state('');
	let blockColor = $state('#94a3b8');
	let blockNotes = $state('');

	const isMulti = $derived(selections.length > 1 || (selections[0]?.roomIds.length ?? 0) > 1);
	const totalSlots = $derived(selections.reduce((n, s) => n + s.roomIds.length, 0));

	// Room name lookup
	function roomName(id: string): string {
		return rooms.active.find((r) => r.id === id)?.name ?? id;
	}

	// All time ranges are identical → can book an appointment
	const singleTimeRange = $derived(
		selections.length === 1 ||
		selections.every((s) => s.startTime === selections[0].startTime && s.endTime === selections[0].endTime)
	);

	// Summary label for choose mode
	const summaryLabel = $derived(() => {
		if (selections.length === 1 && selections[0].roomIds.length === 1) {
			return `${selections[0].startTime} – ${selections[0].endTime}`;
		}
		return `${selections.length} Bereiche, ${totalSlots} Felder`;
	});

	// Position: near the pointer (anchorRect is a zero-size rect at cursor coords)
	const style = $derived(() => {
		const W = 268, H = mode === 'choose' ? 100 : 240;
		const px = anchorRect.x, py = anchorRect.y;
		// Try below-right of cursor; flip left/up if too close to viewport edge
		let left = px + 12;
		let top  = py + 12;
		if (left + W > window.innerWidth  - 8) left = px - W - 4;
		if (top  + H > window.innerHeight - 8) top  = py - H - 4;
		return `position: fixed; top: ${Math.max(8, top)}px; left: ${Math.max(8, left)}px; width: ${W}px; z-index: 200;`;
	});

	function handleBlockSave() {
		if (!blockTitle.trim()) return;
		const blocks: ScheduleBlockFormData[] = selections.flatMap((sel) =>
			sel.roomIds.map((rid) => ({
				room_id: rid,
				doctor_id: blockDoctorId,
				title: blockTitle.trim(),
				start_time: `${date}T${sel.startTime}:00`,
				end_time: `${date}T${sel.endTime}:00`,
				color: blockColor,
				notes: blockNotes,
			}))
		);
		onBlockSave?.(blocks);
		onClose?.();
	}

	const inputClass = 'border border-border rounded px-2 py-1.5 text-sm bg-background w-full outline-none focus:border-ring focus:ring-1 focus:ring-ring/50';
	const PRESET_COLORS = ['#94a3b8', '#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899'];
</script>

<!-- Backdrop -->
<div
	class="fixed inset-0 z-[199]"
	role="button"
	tabindex="-1"
	aria-label="Close"
	onclick={onClose}
	onkeydown={(e) => e.key === 'Escape' && onClose?.()}
></div>

<!-- Popover card -->
<div
	class="bg-popover border border-border rounded-lg shadow-lg p-3 flex flex-col gap-3"
	style={style()}
	role="dialog"
>
	{#if mode === 'choose'}
		<!-- Summary of what's selected -->
		<div class="flex flex-col gap-1.5">
			<p class="text-xs font-medium text-muted-foreground">{summaryLabel()}</p>
			{#if isMulti}
				<div class="flex flex-col gap-1 max-h-28 overflow-y-auto pr-0.5">
					{#each selections as sel, si}
						<div class="flex items-center gap-1.5 text-[11px]">
							<span class="shrink-0 text-muted-foreground font-mono">{sel.startTime}–{sel.endTime}</span>
							<div class="flex gap-1 flex-wrap">
								{#each sel.roomIds as rid}
									<span class="rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 px-1.5 py-0.5 font-medium">{roomName(rid)}</span>
								{/each}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="flex gap-2">
			<button
				class="flex-1 rounded px-2 py-2 text-sm font-medium bg-muted hover:bg-muted/80 transition-colors text-left"
				onclick={() => (mode = 'block')}
			>
				🚫 {i18n.t.schedule.dragCreate.blockTime}{totalSlots > 1 ? ` (${totalSlots})` : ''}
			</button>
			{#if singleTimeRange}
				<button
					class="flex-1 rounded px-2 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors text-left"
					onclick={() => { onBookAppointment?.(selections[0]); onClose?.(); }}
				>
					📅 {i18n.t.schedule.dragCreate.bookAppointment}{totalSlots > 1 ? ` (${totalSlots})` : ''}
				</button>
			{/if}
		</div>
	{:else}
		<div class="flex items-center gap-2">
			<button class="text-muted-foreground hover:text-foreground text-xs" onclick={() => (mode = 'choose')}>← Back</button>
			<span class="text-xs font-medium">{i18n.t.schedule.blocks.title}</span>
			<span class="text-xs text-muted-foreground ml-auto">{summaryLabel()}</span>
		</div>

		<div class="flex flex-col gap-2">
			<input
				type="text"
				placeholder={i18n.t.schedule.blocks.blockTitle}
				class={inputClass}
				bind:value={blockTitle}
				onkeydown={(e) => e.key === 'Enter' && handleBlockSave()}
			/>

			<select class={inputClass} bind:value={blockDoctorId}>
				<option value="">— {i18n.t.schedule.doctor} ({i18n.t.schedule.optional}) —</option>
				{#each doctors.list as d}
					<option value={d.id}>{d.name}</option>
				{/each}
			</select>

			<div class="flex gap-1.5 flex-wrap">
				{#each PRESET_COLORS as c}
					<button
						class="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
						style="background-color: {c}; border-color: {blockColor === c ? 'hsl(var(--foreground))' : 'transparent'};"
						onclick={() => (blockColor = c)}
						aria-label={c}
					></button>
				{/each}
			</div>

			<input
				type="text"
				placeholder={i18n.t.schedule.notes}
				class={inputClass}
				bind:value={blockNotes}
			/>
		</div>

		<div class="flex gap-2">
			<button
				class="flex-1 rounded px-2 py-1.5 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
				disabled={!blockTitle.trim()}
				onclick={handleBlockSave}
			>
				{i18n.t.actions.save}{totalSlots > 1 ? ` (${totalSlots})` : ''}
			</button>
			<button
				class="rounded px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent transition-colors"
				onclick={onClose}
			>
				{i18n.t.actions.cancel}
			</button>
		</div>
	{/if}
</div>
