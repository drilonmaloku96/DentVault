<script lang="ts">
	import { onMount } from 'svelte';
	import type { TreatmentPlan, TreatmentPlanFormData, TreatmentPlanStatus } from '$lib/types';
	import { getTreatmentPlans, insertTreatmentPlan, getTreatmentPlanItems } from '$lib/services/db';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter,
		DialogDescription,
	} from '$lib/components/ui/dialog';
	import TreatmentPlanEditor from './TreatmentPlanEditor.svelte';
	import { i18n } from '$lib/i18n';
	import { formatDate } from '$lib/utils';

	let { patientId }: { patientId: string } = $props();

	let plans = $state<TreatmentPlan[]>([]);
	let isLoading = $state(true);
	let error = $state('');

	// Per-plan item counts (for progress bars)
	let itemStats = $state<Record<string, { total: number; completed: number }>>({});

	// Viewing a single plan
	let activePlan = $state<TreatmentPlan | null>(null);

	// Create dialog
	let createOpen = $state(false);
	let newTitle = $state('');
	let newDescription = $state('');
	let isCreating = $state(false);
	let createError = $state('');

	onMount(async () => {
		await loadPlans();
	});

	async function loadPlans() {
		try {
			isLoading = true;
			error = '';
			plans = await getTreatmentPlans(patientId);
			// Load item stats for each plan
			const stats: Record<string, { total: number; completed: number }> = {};
			await Promise.all(
				plans.map(async (p) => {
					const items = await getTreatmentPlanItems(p.plan_id);
					stats[p.plan_id] = {
						total: items.length,
						completed: items.filter((i) => i.status === 'completed').length,
					};
				}),
			);
			itemStats = stats;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Failed to load treatment plans';
		} finally {
			isLoading = false;
		}
	}

	async function handleCreate() {
		if (!newTitle.trim()) {
			createError = i18n.t.common.required;
			return;
		}
		createError = '';
		isCreating = true;
		try {
			const data: TreatmentPlanFormData = {
				title: newTitle.trim(),
				description: newDescription.trim() || undefined,
			};
			const created = await insertTreatmentPlan(patientId, data);
			plans = [created, ...plans];
			itemStats = { ...itemStats, [created.plan_id]: { total: 0, completed: 0 } };
			createOpen = false;
			newTitle = '';
			newDescription = '';
			// Immediately open the new plan for editing
			activePlan = created;
		} catch (err) {
			createError = err instanceof Error ? err.message : 'Failed to create plan';
		} finally {
			isCreating = false;
		}
	}

	function handlePlanUpdated(updated: TreatmentPlan) {
		plans = plans.map((p) => (p.plan_id === updated.plan_id ? updated : p));
		activePlan = updated;
	}

	function handlePlanDeleted() {
		if (activePlan) {
			plans = plans.filter((p) => p.plan_id !== activePlan!.plan_id);
		}
		activePlan = null;
	}

	async function handleBackFromEditor() {
		activePlan = null;
		// Refresh stats in case items changed
		await loadPlans();
	}

	function formatCost(val: number): string {
		if (!val) return '—';
		return val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
	}

	const planStatusConfig = $derived<Record<TreatmentPlanStatus, { label: string; class: string }>>({
		proposed: {
			label: i18n.t.plans.status.draft,
			class: 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400',
		},
		accepted: {
			label: i18n.t.plans.status.active,
			class: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950/30 dark:text-blue-400',
		},
		in_progress: {
			label: i18n.t.plans.status.active,
			class: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400',
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


</script>

<!-- Show editor if a plan is selected -->
{#if activePlan}
	<TreatmentPlanEditor
		plan={activePlan}
		onBack={handleBackFromEditor}
		onDeleted={handlePlanDeleted}
		onUpdated={handlePlanUpdated}
	/>
{:else}
	<!-- Plan list view -->
	<div class="flex flex-col gap-4">
		<!-- Header -->
		<div class="flex items-center justify-between">
			<h2 class="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
				{i18n.t.plans.title}
				{#if !isLoading}
					<span class="ml-1 normal-case font-normal">({plans.length})</span>
				{/if}
			</h2>
			<Button size="sm" onclick={() => (createOpen = true)}>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
					<path d="M12 5v14M5 12h14" />
				</svg>
				{i18n.t.plans.new}
			</Button>
		</div>

		<!-- Error -->
		{#if error}
			<div class="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
				{error}
			</div>
		{/if}

		<!-- Loading -->
		{#if isLoading}
			<div class="flex flex-col gap-3">
				{#each [1, 2] as _}
					<div class="h-24 animate-pulse rounded-lg border bg-muted"></div>
				{/each}
			</div>

		<!-- Empty state -->
		{:else if plans.length === 0}
			<div class="flex flex-col items-center justify-center rounded-lg border border-dashed p-10 text-center">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="mb-3 h-10 w-10 text-muted-foreground/40">
					<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
					<polyline points="14 2 14 8 20 8"/>
					<line x1="16" y1="13" x2="8" y2="13"/>
					<line x1="16" y1="17" x2="8" y2="17"/>
					<polyline points="10 9 9 9 8 9"/>
				</svg>
				<h3 class="text-sm font-medium text-muted-foreground">{i18n.t.plans.noPlans}</h3>
				<p class="mt-1 text-xs text-muted-foreground/70">
					Click <strong>New Plan</strong> to create one.
				</p>
			</div>

		<!-- Plan cards -->
		{:else}
			<div class="flex flex-col gap-3">
				{#each plans as plan (plan.plan_id)}
					{@const stats = itemStats[plan.plan_id] ?? { total: 0, completed: 0 }}
					{@const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}
					{@const cfg = planStatusConfig[plan.status] ?? planStatusConfig.proposed}

					<button
						type="button"
						class="group flex flex-col gap-3 rounded-lg border bg-card p-4 text-left shadow-xs transition-all hover:border-primary/40 hover:shadow-sm"
						onclick={() => (activePlan = plan)}
					>
						<!-- Top row -->
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="font-semibold text-sm leading-snug group-hover:text-primary transition-colors">
									{plan.title}
								</p>
								{#if plan.description}
									<p class="mt-0.5 text-xs text-muted-foreground line-clamp-1">{plan.description}</p>
								{/if}
							</div>
							<span class={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${cfg.class}`}>
								{cfg.label}
							</span>
						</div>

						<!-- Progress bar -->
						{#if stats.total > 0}
							<div class="flex flex-col gap-1">
								<div class="flex items-center justify-between text-xs text-muted-foreground">
									<span>{stats.completed} of {stats.total} procedures</span>
									<span>{pct}%</span>
								</div>
								<div class="h-1.5 w-full overflow-hidden rounded-full bg-muted">
									<div
										class="h-full rounded-full bg-emerald-500 transition-all"
										style="width: {pct}%"
									></div>
								</div>
							</div>
						{:else}
							<p class="text-xs text-muted-foreground/60 italic">No procedures added yet</p>
						{/if}

						<!-- Bottom row: cost + date -->
						<div class="flex items-center justify-between text-xs text-muted-foreground">
							<span>Est. {formatCost(plan.total_estimated_cost)}</span>
							<span>Created {formatDate(plan.created_at)}</span>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<!-- Create plan dialog -->
<Dialog bind:open={createOpen}>
	<DialogContent class="max-w-md">
		<DialogHeader>
			<DialogTitle>{i18n.t.plans.new}</DialogTitle>
			<DialogDescription>Create a plan to track multi-step treatment for this patient.</DialogDescription>
		</DialogHeader>

		<div class="flex flex-col gap-4 py-2">
			{#if createError}
				<p class="text-sm text-destructive">{createError}</p>
			{/if}
			<div class="flex flex-col gap-1.5">
				<Label for="new-plan-title">{i18n.t.plans.fields.name} <span class="text-destructive">*</span></Label>
				<Input
					id="new-plan-title"
					placeholder="e.g. Full mouth rehabilitation"
					bind:value={newTitle}
				/>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="new-plan-desc">{i18n.t.plans.fields.description}</Label>
				<Textarea
					id="new-plan-desc"
					placeholder="Optional notes about this plan…"
					class="min-h-[70px]"
					bind:value={newDescription}
				/>
			</div>
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={() => (createOpen = false)} disabled={isCreating}>
				{i18n.t.actions.cancel}
			</Button>
			<Button onclick={handleCreate} disabled={isCreating}>
				{isCreating ? i18n.t.common.loading : i18n.t.actions.confirm}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
