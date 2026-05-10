<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { updateParAssessment, deleteParAssessment } from '$lib/services/db';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { STEP_COLORS, assessmentStatus } from '$lib/utils/par-state-machine';
	import { i18n } from '$lib/i18n';
	import type { ParAssessment, ParCase } from '$lib/types';
	import { formatDate } from '$lib/utils';
	import ParMeasurementGrid from './ParMeasurementGrid.svelte';

	let {
		assessment,
		parCase,
		onUpdated,
		onDeleted,
	}: {
		assessment: ParAssessment;
		parCase: ParCase;
		onUpdated: (a: ParAssessment) => void;
		onDeleted: () => void;
	} = $props();

	const colors  = $derived(STEP_COLORS[assessment.type]);
	const status  = $derived(assessmentStatus(assessment));
	const locked  = $derived(assessment.locked || parCase.status !== 'active');

	// Edit form state
	let examDate     = $state(assessment.exam_date);
	let startDate    = $state(assessment.start_date ?? '');
	let endDate      = $state(assessment.end_date ?? '');
	let approvalDate = $state(assessment.approval_date ?? '');
	let doctorId     = $state<number | null>(assessment.doctor_id);
	let isReferral   = $state(assessment.is_referral);
	let notes        = $state(assessment.notes);
	let saving       = $state(false);
	let showDelete   = $state(false);
	let dirty        = $state(false);

	// Sync form when assessment changes
	$effect(() => {
		examDate     = assessment.exam_date;
		startDate    = assessment.start_date ?? '';
		endDate      = assessment.end_date ?? '';
		approvalDate = assessment.approval_date ?? '';
		doctorId     = assessment.doctor_id;
		isReferral   = assessment.is_referral;
		notes        = assessment.notes;
		dirty        = false;
	});

	async function save() {
		saving = true;
		await updateParAssessment(assessment.id, {
			exam_date:     examDate,
			doctor_id:     doctorId,
			start_date:    startDate || null,
			end_date:      endDate || null,
			approval_date: approvalDate || null,
			is_referral:   isReferral,
			notes,
		});
		saving = false;
		dirty  = false;
		onUpdated({
			...assessment,
			exam_date:    examDate,
			doctor_id:    doctorId,
			start_date:   startDate || null,
			end_date:     endDate || null,
			approval_date: approvalDate || null,
			is_referral:  isReferral,
			notes,
		});
	}

	async function handleDelete() {
		await deleteParAssessment(assessment.id);
		showDelete = false;
		onDeleted();
	}
</script>

<div class="flex flex-col gap-4">
	<!-- Panel header -->
	<div class="flex items-center gap-2">
		<span class="rounded-md px-2.5 py-1 text-xs font-bold {colors.bg} {colors.text} {colors.border} border">
			{i18n.t.par.stepTypeShort[assessment.type]}
		</span>
		<span class="text-sm font-medium">{i18n.t.par.stepTypes[assessment.type]}</span>
		{#if assessment.sequence > 1}
			<span class="text-xs text-muted-foreground">({i18n.t.par.sequence} {assessment.sequence})</span>
		{/if}

		<div class="flex-1"></div>

		<!-- Status chip -->
		{#if status === 'done'}
			<span class="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓ {i18n.t.par.stepStatus.done}</span>
		{:else if status === 'locked'}
			<span class="text-xs text-muted-foreground">🔒 {i18n.t.par.stepStatus.locked}</span>
		{:else}
			<span class="text-xs text-amber-600 dark:text-amber-400 font-medium">● {i18n.t.par.stepStatus.active}</span>
		{/if}

		{#if !locked}
			<button
				type="button"
				onclick={() => showDelete = true}
				class="rounded-md p-1 text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive transition-colors"
				title={i18n.t.par.deleteStep}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
					<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
					<path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
				</svg>
			</button>
		{/if}
	</div>

	<!-- Locked notice -->
	{#if locked && !assessment.locked}
		<p class="text-xs text-muted-foreground italic">{i18n.t.par.caseLocked}</p>
	{/if}

	<!-- Fields grid -->
	<div class="grid grid-cols-2 gap-3">
		<!-- Exam date -->
		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.examDate}</label>
			<input
				type="date"
				bind:value={examDate}
				onchange={() => dirty = true}
				disabled={locked}
				class="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
			/>
		</div>

		<!-- Doctor -->
		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.newStepDialog.doctorLabel}</label>
			<select
				class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
				disabled={locked}
				onchange={(e) => { doctorId = Number((e.target as HTMLSelectElement).value) || null; dirty = true; }}
			>
				<option value="">{i18n.t.common.none}</option>
				{#each doctors.list as doc}
					<option value={doc.id} selected={doctorId === doc.id}>{staffLabel(doc)}</option>
				{/each}
			</select>
		</div>

		<!-- Start date -->
		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.startDate}</label>
			<input
				type="date"
				bind:value={startDate}
				onchange={() => dirty = true}
				disabled={locked}
				class="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
			/>
		</div>

		<!-- End date (Abschlussdatum) -->
		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.endDate}</label>
			<input
				type="date"
				bind:value={endDate}
				onchange={() => dirty = true}
				disabled={locked}
				class="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
			/>
		</div>

		<!-- Approval date -->
		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.approvalDate}</label>
			<input
				type="date"
				bind:value={approvalDate}
				onchange={() => dirty = true}
				disabled={locked}
				class="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"
			/>
		</div>

		<!-- Referral -->
		<div class="flex flex-col justify-end gap-1">
			<label class="flex items-center gap-2 cursor-pointer {locked ? 'opacity-50 pointer-events-none' : ''}">
				<input
					type="checkbox"
					bind:checked={isReferral}
					onchange={() => dirty = true}
					disabled={locked}
					class="h-4 w-4 rounded border-input accent-primary"
				/>
				<span class="text-sm">{i18n.t.par.referralLabel}</span>
			</label>
		</div>
	</div>

	<!-- Notes -->
	<div class="flex flex-col gap-1">
		<label class="text-xs font-medium text-muted-foreground">{i18n.t.common.notes}</label>
		<textarea
			bind:value={notes}
			oninput={() => dirty = true}
			disabled={locked}
			rows={3}
			placeholder={i18n.t.common.optional}
			class="rounded-md border border-input bg-background px-3 py-2 text-sm resize-none disabled:opacity-50"
		></textarea>
	</div>

	<!-- Measurements placeholder (Stage 2) -->
	<div class="rounded-lg border border-dashed border-muted-foreground/20 bg-muted/10 px-4 py-6 text-center">
		<p class="text-sm text-muted-foreground font-medium">Messwerte</p>
		<p class="text-xs text-muted-foreground/60 mt-1">Messwerteingabe folgt in Stage 2</p>
	</div>

	<!-- Save button -->
	{#if !locked && dirty}
		<div class="flex justify-end">
			<Button onclick={save} disabled={saving} size="sm">
				{saving ? i18n.t.common.loading : i18n.t.actions.save}
			</Button>
		</div>
	{/if}
</div>

<!-- Delete confirm -->
{#if showDelete}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
		<div class="w-[360px] rounded-xl border border-border bg-background p-5 shadow-xl flex flex-col gap-4">
			<h3 class="font-semibold">{i18n.t.par.deleteStep}</h3>
			<p class="text-sm text-muted-foreground">{i18n.t.par.deleteStepConfirm}</p>
			<div class="flex gap-2 justify-end">
				<Button variant="outline" onclick={() => showDelete = false}>{i18n.t.actions.cancel}</Button>
				<Button variant="destructive" onclick={handleDelete}>{i18n.t.actions.delete}</Button>
			</div>
		</div>
	</div>
{/if}
