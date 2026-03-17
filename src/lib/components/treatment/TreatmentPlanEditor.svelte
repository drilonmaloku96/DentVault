<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import type {
		TreatmentPlan,
		TreatmentPlanItem,
		TreatmentPlanItemStatus,
		TreatmentPlanStatus,
		TreatmentPlanItemFormData,
	} from '$lib/types';
	import {
		getTreatmentPlanItems,
		insertTreatmentPlanItem,
		updateTreatmentPlanItem,
		deleteTreatmentPlanItem,
		updateTreatmentPlan,
		deleteTreatmentPlan,
		recomputePlanCost,
	} from '$lib/services/db';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import { Separator } from '$lib/components/ui/separator';
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '$lib/components/ui/dialog';
	import TreatmentPlanItemRow from './TreatmentPlanItem.svelte';
	import { i18n } from '$lib/i18n';

	let {
		plan,
		onBack,
		onDeleted,
		onUpdated,
	}: {
		plan: TreatmentPlan;
		onBack: () => void;
		onDeleted: () => void;
		onUpdated: (plan: TreatmentPlan) => void;
	} = $props();

	let items = $state<TreatmentPlanItem[]>([]);
	let isLoading = $state(true);

	// Plan metadata editing
	let editingTitle = $state(untrack(() => plan.title));
	let editingDescription = $state(untrack(() => plan.description));
	let editingStatus = $state<TreatmentPlanStatus>(untrack(() => plan.status));
	let isSavingMeta = $state(false);
	let metaSaved = $state(false);

	// Add item form
	let newDescription = $state('');
	let newProcedureCode = $state('');
	let newToothNumbers = $state('');
	let newCost = $state('');
	let isAddingItem = $state(false);
	let addError = $state('');

	// Delete plan dialog
	let showDeleteDialog = $state(false);
	let isDeletingPlan = $state(false);

	// Derived stats
	const completedCount = $derived(items.filter((i) => i.status === 'completed').length);
	const totalCount = $derived(items.length);
	const progressPct = $derived(totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0);
	const totalCost = $derived(items.reduce((sum, i) => sum + (i.estimated_cost ?? 0), 0));

	onMount(async () => {
		await loadItems();
	});

	async function loadItems() {
		isLoading = true;
		items = await getTreatmentPlanItems(plan.plan_id);
		isLoading = false;
	}

	async function saveMeta() {
		isSavingMeta = true;
		await updateTreatmentPlan(plan.plan_id, {
			title: editingTitle,
			description: editingDescription,
			status: editingStatus,
		});
		onUpdated({ ...plan, title: editingTitle, description: editingDescription, status: editingStatus });
		isSavingMeta = false;
		metaSaved = true;
		setTimeout(() => (metaSaved = false), 2000);
	}

	async function addItem() {
		if (!newDescription.trim()) {
			addError = i18n.t.common.required;
			return;
		}
		addError = '';
		isAddingItem = true;
		const nextOrder = items.length > 0 ? Math.max(...items.map((i) => i.sequence_order)) + 1 : 1;
		const data: TreatmentPlanItemFormData = {
			description: newDescription.trim(),
			procedure_code: newProcedureCode.trim() || undefined,
			tooth_numbers: newToothNumbers.trim() || undefined,
			estimated_cost: newCost ? parseFloat(newCost) : 0,
		};
		await insertTreatmentPlanItem(plan.plan_id, data, nextOrder);
		await recomputePlanCost(plan.plan_id);
		await loadItems();
		newDescription = '';
		newProcedureCode = '';
		newToothNumbers = '';
		newCost = '';
		isAddingItem = false;
	}

	async function handleStatusChange(id: number, status: TreatmentPlanItemStatus) {
		const now = new Date().toISOString().slice(0, 10);
		await updateTreatmentPlanItem(id, {
			status,
			completed_date: status === 'completed' ? now : '',
		});
		items = items.map((i) =>
			i.id === id ? { ...i, status, completed_date: status === 'completed' ? now : '' } : i,
		);
	}

	async function handleCostChange(id: number, cost: number) {
		await updateTreatmentPlanItem(id, { estimated_cost: cost });
		items = items.map((i) => (i.id === id ? { ...i, estimated_cost: cost } : i));
		await recomputePlanCost(plan.plan_id);
	}

	async function handleMoveUp(id: number) {
		const idx = items.findIndex((i) => i.id === id);
		if (idx <= 0) return;
		const above = items[idx - 1];
		const current = items[idx];
		await updateTreatmentPlanItem(current.id, { sequence_order: above.sequence_order });
		await updateTreatmentPlanItem(above.id, { sequence_order: current.sequence_order });
		// Swap locally
		const updated = [...items];
		updated[idx - 1] = { ...current, sequence_order: above.sequence_order };
		updated[idx] = { ...above, sequence_order: current.sequence_order };
		items = updated;
	}

	async function handleMoveDown(id: number) {
		const idx = items.findIndex((i) => i.id === id);
		if (idx >= items.length - 1) return;
		const below = items[idx + 1];
		const current = items[idx];
		await updateTreatmentPlanItem(current.id, { sequence_order: below.sequence_order });
		await updateTreatmentPlanItem(below.id, { sequence_order: current.sequence_order });
		const updated = [...items];
		updated[idx + 1] = { ...current, sequence_order: below.sequence_order };
		updated[idx] = { ...below, sequence_order: current.sequence_order };
		items = updated;
	}

	async function handleDeleteItem(id: number) {
		await deleteTreatmentPlanItem(id);
		items = items.filter((i) => i.id !== id);
		await recomputePlanCost(plan.plan_id);
	}

	async function handleDeletePlan() {
		isDeletingPlan = true;
		await deleteTreatmentPlan(plan.plan_id);
		onDeleted();
	}

	function formatCost(val: number): string {
		return val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
	}

	const planStatusOptions = $derived<{ value: TreatmentPlanStatus; label: string }[]>([
		{ value: 'proposed',    label: i18n.t.plans.status.draft },
		{ value: 'accepted',    label: i18n.t.plans.status.active },
		{ value: 'in_progress', label: i18n.t.plans.status.active },
		{ value: 'completed',   label: i18n.t.plans.status.completed },
		{ value: 'cancelled',   label: i18n.t.plans.status.cancelled },
	]);

	const planStatusConfig: Record<TreatmentPlanStatus, { class: string }> = {
		proposed: { class: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400' },
		accepted: { class: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400' },
		in_progress: { class: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400' },
		completed: { class: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400' },
		cancelled: { class: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400' },
	};

	const selectClass =
		'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
</script>

<div class="flex flex-col gap-6">
	<!-- Back + title -->
	<div class="flex items-start justify-between gap-3">
		<div class="flex items-center gap-3">
			<Button variant="ghost" size="sm" onclick={onBack} class="h-8 px-2">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1 h-4 w-4">
					<path d="M15 18l-6-6 6-6" />
				</svg>
				{i18n.t.plans.title}
			</Button>
			<Separator orientation="vertical" class="h-5" />
			<span class={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${planStatusConfig[plan.status]?.class ?? ''}`}>
				{planStatusOptions.find(o => o.value === plan.status)?.label ?? plan.status}
			</span>
		</div>

		<Button
			variant="ghost"
			size="sm"
			class="h-8 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
			onclick={() => (showDeleteDialog = true)}
		>
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1 h-3.5 w-3.5">
				<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
			</svg>
			{i18n.t.actions.delete}
		</Button>
	</div>

	<!-- Plan metadata form -->
	<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{i18n.t.plans.fields.description}</h2>
		<Separator />

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="flex flex-col gap-1.5 sm:col-span-2">
				<Label for="plan-title">{i18n.t.plans.fields.name}</Label>
				<Input id="plan-title" bind:value={editingTitle} placeholder="e.g. Full mouth rehabilitation" />
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="plan-status">{i18n.t.plans.status.active}</Label>
				<select id="plan-status" class={selectClass} bind:value={editingStatus}>
					{#each planStatusOptions as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-col gap-1.5 sm:col-span-2">
				<Label for="plan-desc">{i18n.t.plans.fields.description}</Label>
				<Textarea id="plan-desc" bind:value={editingDescription} placeholder="Treatment goals, patient consent notes…" class="min-h-[70px]" />
			</div>
		</div>

		<div class="flex items-center gap-3">
			<Button onclick={saveMeta} disabled={isSavingMeta} size="sm">
				{isSavingMeta ? i18n.t.common.loading : i18n.t.actions.save}
			</Button>
			{#if metaSaved}
				<span class="text-sm text-emerald-600 font-medium">✓ {i18n.t.settings.saved}</span>
			{/if}
		</div>
	</div>

	<!-- Progress + cost summary -->
	{#if totalCount > 0}
		<div class="flex items-center gap-6 rounded-lg border bg-card px-5 py-4">
			<div class="flex flex-1 flex-col gap-1.5">
				<div class="flex items-center justify-between text-xs text-muted-foreground">
					<span>Progress</span>
					<span class="font-medium">{completedCount} / {totalCount} items</span>
				</div>
				<div class="h-2 w-full overflow-hidden rounded-full bg-muted">
					<div
						class="h-full rounded-full bg-emerald-500 transition-all duration-500"
						style="width: {progressPct}%"
					></div>
				</div>
			</div>
			<div class="text-right shrink-0">
				<p class="text-xs text-muted-foreground">Estimated Total</p>
				<p class="text-lg font-bold tabular-nums">{formatCost(totalCost)}</p>
			</div>
		</div>
	{/if}

	<!-- Procedures list -->
	<div class="flex flex-col gap-3">
		<h2 class="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
			{i18n.t.plans.addItem}
			{#if totalCount > 0}<span class="normal-case font-normal ml-1">({totalCount})</span>{/if}
		</h2>

		{#if isLoading}
			<div class="flex flex-col gap-2">
				{#each [1, 2, 3] as _}
					<div class="h-16 animate-pulse rounded-lg border bg-muted"></div>
				{/each}
			</div>
		{:else if items.length === 0}
			<div class="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
				No procedures yet — add one below.
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each items as item, i (item.id)}
					<TreatmentPlanItemRow
						{item}
						index={i}
						totalItems={items.length}
						onStatusChange={handleStatusChange}
						onMoveUp={handleMoveUp}
						onMoveDown={handleMoveDown}
						onDelete={handleDeleteItem}
						onCostChange={handleCostChange}
					/>
				{/each}
			</div>
		{/if}

		<!-- Add item form -->
		<div class="rounded-lg border bg-muted/30 p-4 flex flex-col gap-3">
			<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add Procedure</h3>

			{#if addError}
				<p class="text-xs text-destructive">{addError}</p>
			{/if}

			<div class="grid gap-2 sm:grid-cols-2">
				<div class="flex flex-col gap-1 sm:col-span-2">
					<Label class="text-xs" for="new-desc">{i18n.t.plans.fields.description} <span class="text-destructive">*</span></Label>
					<Input
						id="new-desc"
						placeholder="e.g. Root canal treatment #14"
						bind:value={newDescription}
						class="h-8 text-sm"
					/>
				</div>
				<div class="flex flex-col gap-1">
					<Label class="text-xs" for="new-cdt">CDT Code</Label>
					<Input id="new-cdt" placeholder="D3330" bind:value={newProcedureCode} class="h-8 text-sm" />
				</div>
				<div class="flex flex-col gap-1">
					<Label class="text-xs" for="new-tooth">{i18n.t.plans.fields.tooth}</Label>
					<Input id="new-tooth" placeholder="14, 15" bind:value={newToothNumbers} class="h-8 text-sm" />
				</div>
				<div class="flex flex-col gap-1">
					<Label class="text-xs" for="new-cost">{i18n.t.plans.fields.cost}</Label>
					<Input id="new-cost" type="number" min="0" step="0.01" placeholder="0.00" bind:value={newCost} class="h-8 text-sm" />
				</div>
			</div>

			<Button onclick={addItem} disabled={isAddingItem} size="sm" class="w-fit">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
					<path d="M12 5v14M5 12h14" />
				</svg>
				{isAddingItem ? i18n.t.common.loading : i18n.t.plans.addItem}
			</Button>
		</div>
	</div>
</div>

<!-- Delete plan confirmation -->
<Dialog bind:open={showDeleteDialog}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>{i18n.t.actions.delete}</DialogTitle>
			<DialogDescription>
				Are you sure you want to permanently delete <strong>"{plan.title}"</strong> and all its procedures? This cannot be undone.
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={() => (showDeleteDialog = false)} disabled={isDeletingPlan}>
				{i18n.t.actions.cancel}
			</Button>
			<Button variant="destructive" onclick={handleDeletePlan} disabled={isDeletingPlan}>
				{isDeletingPlan ? i18n.t.common.loading : i18n.t.actions.delete}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
