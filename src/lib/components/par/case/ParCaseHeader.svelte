<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { updateParCase, deleteParCase } from '$lib/services/db';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { i18n } from '$lib/i18n';
	import type { ParCase } from '$lib/types';

	let {
		parCase,
		onUpdated,
		onDeleted,
	}: {
		parCase: ParCase;
		onUpdated: (updated: ParCase) => void;
		onDeleted: () => void;
	} = $props();

	let showEndDialog    = $state(false);
	let showDeleteDialog = $state(false);
	let endDate          = $state(new Date().toISOString().slice(0, 10));
	let saving           = $state(false);

	const doctor = $derived(
		parCase.doctor_id ? doctors.list.find(d => d.id === parCase.doctor_id) : null,
	);

	const statusColors: Record<string, string> = {
		active:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400',
		completed: 'bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-400',
		ended:     'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400',
	};

	const gradeColors: Record<string, string> = {
		A: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400',
		B: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
		C: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400',
	};

	async function handleEndCase() {
		saving = true;
		await updateParCase(parCase.id, { end_date: endDate, status: 'completed' });
		saving = false;
		showEndDialog = false;
		onUpdated({ ...parCase, end_date: endDate, status: 'completed' });
	}

	async function handleDelete() {
		await deleteParCase(parCase.id);
		showDeleteDialog = false;
		onDeleted();
	}
</script>

<div class="flex items-center gap-2 flex-wrap min-h-[40px]">
	<!-- Plan type badge -->
	<span class="rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
		{i18n.t.par.planType[parCase.plan_type]}
	</span>

	<!-- Grade badge -->
	{#if parCase.grade}
		<span class="rounded-full px-2.5 py-0.5 text-xs font-semibold {gradeColors[parCase.grade]}">
			{i18n.t.par.gradeLabel[parCase.grade]}
			<span class="opacity-70 ml-1">·</span>
			{i18n.t.par.gradeUpt[parCase.grade]}
		</span>
	{:else}
		<span class="rounded-full border border-dashed border-muted-foreground/30 px-2.5 py-0.5 text-xs text-muted-foreground/60 italic">
			{i18n.t.par.grade}: —
		</span>
	{/if}

	<!-- § 22 badge -->
	{#if parCase.sgb22}
		<span class="rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-400 px-2.5 py-0.5 text-xs font-medium">
			{i18n.t.par.sgb22}
		</span>
	{/if}

	<!-- Transfer badge -->
	{#if parCase.is_transfer}
		<span class="rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400 px-2.5 py-0.5 text-xs font-medium">
			{i18n.t.par.transferCase}
			{#if parCase.transfer_from} · {parCase.transfer_from}{/if}
		</span>
	{/if}

	<!-- Doctor -->
	{#if doctor}
		<span class="text-xs text-muted-foreground">
			{staffLabel(doctor)}
		</span>
	{/if}

	<div class="flex-1"></div>

	<!-- Status badge -->
	<span class="rounded-full px-2.5 py-0.5 text-xs font-semibold {statusColors[parCase.status]}">
		{i18n.t.par.status[parCase.status]}
	</span>

	<!-- Treatment end date -->
	{#if parCase.end_date}
		<span class="text-xs text-muted-foreground">
			{i18n.t.par.treatmentEnd}: {parCase.end_date}
		</span>
	{/if}

	<!-- Actions -->
	{#if parCase.status === 'active'}
		<Button
			variant="outline"
			size="sm"
			onclick={() => { endDate = new Date().toISOString().slice(0, 10); showEndDialog = true; }}
			class="text-xs h-7"
		>
			{i18n.t.par.setTreatmentEnd}
		</Button>
	{/if}

	<button
		type="button"
		onclick={() => showDeleteDialog = true}
		class="rounded-md p-1 text-muted-foreground/50 hover:bg-destructive/10 hover:text-destructive transition-colors"
		title={i18n.t.par.deleteCase}
	>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
			<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
		</svg>
	</button>
</div>

<!-- End case dialog -->
{#if showEndDialog}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
		<div class="w-[380px] rounded-xl border border-border bg-background p-5 shadow-xl flex flex-col gap-4">
			<h3 class="font-semibold text-base">{i18n.t.par.endCaseTitle}</h3>
			<p class="text-sm text-muted-foreground">{i18n.t.par.endCaseDesc}</p>
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.treatmentEnd}</label>
				<input type="date" bind:value={endDate} class="rounded-md border border-input bg-background px-3 py-2 text-sm" />
			</div>
			<div class="flex gap-2 justify-end">
				<Button variant="outline" onclick={() => showEndDialog = false}>{i18n.t.actions.cancel}</Button>
				<Button onclick={handleEndCase} disabled={saving}>
					{saving ? i18n.t.common.loading : i18n.t.par.endCaseConfirm}
				</Button>
			</div>
		</div>
	</div>
{/if}

<!-- Delete confirmation -->
{#if showDeleteDialog}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
		<div class="w-[380px] rounded-xl border border-border bg-background p-5 shadow-xl flex flex-col gap-4">
			<h3 class="font-semibold text-base text-destructive">{i18n.t.par.deleteCase}</h3>
			<p class="text-sm text-muted-foreground">{i18n.t.par.deleteCaseConfirm}</p>
			<div class="flex gap-2 justify-end">
				<Button variant="outline" onclick={() => showDeleteDialog = false}>{i18n.t.actions.cancel}</Button>
				<Button variant="destructive" onclick={handleDelete}>{i18n.t.actions.delete}</Button>
			</div>
		</div>
	</div>
{/if}
