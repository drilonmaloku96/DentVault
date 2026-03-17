<script lang="ts">
	import { untrack } from 'svelte';
	import type { TreatmentPlanItem, TreatmentPlanItemStatus } from '$lib/types';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { i18n } from '$lib/i18n';

	let {
		item,
		index,
		totalItems,
		onStatusChange,
		onMoveUp,
		onMoveDown,
		onDelete,
		onCostChange,
	}: {
		item: TreatmentPlanItem;
		index: number;
		totalItems: number;
		onStatusChange: (id: number, status: TreatmentPlanItemStatus) => Promise<void>;
		onMoveUp: (id: number) => Promise<void>;
		onMoveDown: (id: number) => Promise<void>;
		onDelete: (id: number) => Promise<void>;
		onCostChange: (id: number, cost: number) => Promise<void>;
	} = $props();

	const statusConfig = $derived<Record<TreatmentPlanItemStatus, { label: string; class: string }>>({
		pending: {
			label: i18n.t.plans.status.draft,
			class: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
		},
		scheduled: {
			label: i18n.t.plans.status.active,
			class: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400',
		},
		completed: {
			label: i18n.t.plans.status.completed,
			class: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400',
		},
		cancelled: {
			label: i18n.t.plans.status.cancelled,
			class: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400',
		},
	});

	const cfg = $derived(statusConfig[item.status] ?? statusConfig.pending);

	let costInput = $state(untrack(() => item.estimated_cost.toString()));
	let costTimeout: ReturnType<typeof setTimeout>;

	function handleCostInput() {
		clearTimeout(costTimeout);
		costTimeout = setTimeout(() => {
			const val = parseFloat(costInput);
			if (!isNaN(val) && val >= 0) {
				onCostChange(item.id, val);
			}
		}, 600);
	}

	const statusOptions = $derived<{ value: TreatmentPlanItemStatus; label: string }[]>([
		{ value: 'pending',   label: i18n.t.plans.status.draft },
		{ value: 'scheduled', label: i18n.t.plans.status.active },
		{ value: 'completed', label: i18n.t.plans.status.completed },
		{ value: 'cancelled', label: i18n.t.plans.status.cancelled },
	]);

	const selectClass =
		'border-input bg-background flex h-8 rounded-md border px-2 py-1 text-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
</script>

<div class="flex items-start gap-2 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/20">
	<!-- Sequence number -->
	<span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
		{index + 1}
	</span>

	<!-- Main content -->
	<div class="flex min-w-0 flex-1 flex-col gap-2">
		<!-- Top row: description + badges -->
		<div class="flex flex-wrap items-start gap-2">
			<span class="flex-1 text-sm font-medium leading-snug">{item.description}</span>
			{#if item.procedure_code}
				<span class="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
					{item.procedure_code}
				</span>
			{/if}
			{#if item.tooth_numbers}
				<span class="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
					{i18n.t.common.tooth} {item.tooth_numbers}
				</span>
			{/if}
		</div>

		<!-- Bottom row: status select + cost -->
		<div class="flex flex-wrap items-center gap-2">
			<select
				class={selectClass}
				value={item.status}
				onchange={(e) => onStatusChange(item.id, (e.target as HTMLSelectElement).value as TreatmentPlanItemStatus)}
			>
				{#each statusOptions as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>

			<span class={`rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.class}`}>
				{cfg.label}
			</span>

			{#if item.status === 'completed' && item.timeline_entry_id}
				<a
					href="#entry-{item.timeline_entry_id}"
					class="flex items-center gap-1 text-[10px] text-primary hover:underline"
					title="View linked timeline entry"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
						<path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/>
						<path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/>
					</svg>
					Entry #{item.timeline_entry_id}
				</a>
			{/if}

			<div class="flex items-center gap-1 ml-auto">
				<span class="text-xs text-muted-foreground">$</span>
				<input
					type="number"
					min="0"
					step="0.01"
					class="h-7 w-20 rounded border border-input bg-background px-2 text-xs outline-none focus:border-ring"
					bind:value={costInput}
					oninput={handleCostInput}
				/>
			</div>
		</div>
	</div>

	<!-- Reorder + delete buttons -->
	<div class="flex shrink-0 flex-col gap-0.5">
		<Button
			variant="ghost"
			size="icon"
			class="h-6 w-6"
			disabled={index === 0}
			onclick={() => onMoveUp(item.id)}
			title="Move up"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
				<path d="M18 15l-6-6-6 6" />
			</svg>
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="h-6 w-6"
			disabled={index === totalItems - 1}
			onclick={() => onMoveDown(item.id)}
			title="Move down"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
				<path d="M6 9l6 6 6-6" />
			</svg>
		</Button>
		<Button
			variant="ghost"
			size="icon"
			class="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
			onclick={() => onDelete(item.id)}
			title="Remove item"
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
				<path d="M18 6L6 18M6 6l12 12" />
			</svg>
		</Button>
	</div>
</div>
