<script lang="ts">
	import { i18n } from '$lib/i18n';
	import type { ScheduleBlock, ScheduleBlockFormData } from '$lib/types';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';

	interface Props {
		block: ScheduleBlock | null;
		open?: boolean;
		onSave?: (id: string, data: ScheduleBlockFormData) => void;
		onDelete?: (id: string) => void;
		onClose?: () => void;
	}

	let { block, open = $bindable(false), onSave, onDelete, onClose }: Props = $props();

	let title = $state('');
	let doctorId = $state('');
	let color = $state('#94a3b8');
	let notes = $state('');
	let startTime = $state('');
	let endTime = $state('');
	let confirmDelete = $state(false);

	$effect(() => {
		if (block) {
			title = block.title;
			doctorId = block.doctor_id ?? '';
			color = block.color;
			notes = block.notes ?? '';
			startTime = block.start_time.slice(11, 16);
			endTime = block.end_time.slice(11, 16);
			confirmDelete = false;
		}
	});

	const date = $derived(block?.start_time.slice(0, 10) ?? '');

	function handleSave() {
		if (!block || !title.trim()) return;
		onSave?.(block.id, {
			room_id: block.room_id,
			doctor_id: doctorId,
			title: title.trim(),
			start_time: `${date}T${startTime}:00`,
			end_time: `${date}T${endTime}:00`,
			color,
			notes,
		});
	}

	function handleDelete() {
		if (!block) return;
		onDelete?.(block.id);
	}

	const inputClass = 'border border-border rounded px-2 py-1.5 text-sm bg-background w-full outline-none focus:border-ring focus:ring-1 focus:ring-ring/50';
	const PRESET_COLORS = ['#94a3b8', '#f59e0b', '#ef4444', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899'];
</script>

<Dialog bind:open onOpenChange={(v) => !v && onClose?.()}>
	<DialogContent class="max-w-[400px] sm:max-w-[400px]">
		<DialogHeader>
			<DialogTitle>{i18n.t.schedule.blocks.editBlock}</DialogTitle>
		</DialogHeader>

		{#if block}
			<div class="flex flex-col gap-3 mt-2">
				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.blocks.blockTitle}</label>
					<input type="text" class={inputClass} bind:value={title} />
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.doctor} ({i18n.t.schedule.optional})</label>
					<select class={inputClass} bind:value={doctorId}>
						<option value="">—</option>
						{#each doctors.list as d}
							<option value={d.id}>{d.name}</option>
						{/each}
					</select>
				</div>

				<div class="grid grid-cols-2 gap-2">
					<div class="flex flex-col gap-1">
						<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.startTime}</label>
						<input type="time" step="300" class={inputClass} bind:value={startTime} />
					</div>
					<div class="flex flex-col gap-1">
						<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.endTime}</label>
						<input type="time" step="300" class={inputClass} bind:value={endTime} />
					</div>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium text-muted-foreground">Farbe / Color</label>
					<div class="flex gap-1.5 flex-wrap">
						{#each PRESET_COLORS as c}
							<button
								class="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
								style="background-color: {c}; border-color: {color === c ? 'hsl(var(--foreground))' : 'transparent'};"
								onclick={() => (color = c)}
								aria-label={c}
							></button>
						{/each}
					</div>
				</div>

				<div class="flex flex-col gap-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.schedule.notes}</label>
					<textarea class={inputClass} rows="2" bind:value={notes}></textarea>
				</div>

				<div class="flex flex-col gap-2 pt-1">
					<button
						class="w-full rounded px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
						disabled={!title.trim()}
						onclick={handleSave}
					>
						{i18n.t.actions.save}
					</button>

					{#if !confirmDelete}
						<button
							class="w-full rounded px-3 py-2 text-sm text-destructive hover:bg-destructive/10 transition-colors"
							onclick={() => (confirmDelete = true)}
						>
							{i18n.t.schedule.blocks.delete}
						</button>
					{:else}
						<div class="flex gap-2">
							<button
								class="flex-1 rounded px-3 py-2 text-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
								onclick={handleDelete}
							>
								{i18n.t.schedule.blocks.confirmDelete}
							</button>
							<button
								class="flex-1 rounded px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors"
								onclick={() => (confirmDelete = false)}
							>
								{i18n.t.actions.cancel}
							</button>
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</DialogContent>
</Dialog>
