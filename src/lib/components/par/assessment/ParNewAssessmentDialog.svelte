<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { createParAssessment } from '$lib/services/db';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { getValidNextSteps, nextUptSequence, STEP_COLORS } from '$lib/utils/par-state-machine';
	import { i18n } from '$lib/i18n';
	import type { ParAssessment, ParCase, ParStepType } from '$lib/types';

	let {
		open = $bindable(false),
		parCase,
		assessments,
		onCreated,
	}: {
		open: boolean;
		parCase: ParCase;
		assessments: ParAssessment[];
		onCreated: (assessment: ParAssessment) => void;
	} = $props();

	const validSteps = $derived(getValidNextSteps(assessments, parCase.grade));
	const isUptStep = (t: ParStepType) => t === 'UPTd' || t === 'UPTg' || t === 'UPTc';

	let selectedType = $state<ParStepType | null>(null);
	let examDate     = $state(new Date().toISOString().slice(0, 10));
	let doctorId     = $state<number | null>(parCase.doctor_id);
	let saving       = $state(false);
	let error        = $state('');

	// Auto-select first valid step when dialog opens / validSteps changes
	$effect(() => {
		if (open) {
			const nonKtb = validSteps.filter(s => s !== 'KTB');
			selectedType = nonKtb[0] ?? (validSteps[0] ?? null);
			examDate     = new Date().toISOString().slice(0, 10);
			doctorId     = parCase.doctor_id;
			error        = '';
		}
	});

	const sequence = $derived(
		selectedType && isUptStep(selectedType) ? nextUptSequence(assessments) : 1,
	);

	async function handleCreate() {
		if (!selectedType) return;
		saving = true;
		error  = '';
		try {
			const id = await createParAssessment(parCase.id, {
				type: selectedType,
				sequence,
				exam_date: examDate,
				doctor_id: doctorId,
			});
			open = false;
			onCreated({
				id,
				case_id:      parCase.id,
				type:         selectedType,
				sequence,
				exam_date:    examDate,
				doctor_id:    doctorId,
				start_date:   null,
				end_date:     null,
				approval_date: null,
				is_referral:  false,
				notes:        '',
				locked:       false,
				created_at:   new Date().toISOString(),
				updated_at:   new Date().toISOString(),
			});
		} catch (e) {
			error = String(e);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog bind:open>
	<DialogContent class="max-w-[460px] sm:max-w-[460px]">
		<DialogHeader>
			<DialogTitle>{i18n.t.par.newStepDialog.title}</DialogTitle>
		</DialogHeader>

		{#if validSteps.length === 0 || (validSteps.length === 1 && validSteps[0] === 'KTB' && assessments.length > 0)}
			<p class="py-4 text-sm text-muted-foreground text-center">{i18n.t.par.noValidNextStep}</p>
			<DialogFooter>
				<Button variant="outline" onclick={() => open = false}>{i18n.t.actions.close}</Button>
			</DialogFooter>
		{:else}
			<div class="flex flex-col gap-4 py-2">
				<!-- Step type selector -->
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.newStepDialog.typeLabel}</label>
					<div class="flex flex-wrap gap-2">
						{#each validSteps as stepType}
							{@const colors = STEP_COLORS[stepType]}
							<button
								type="button"
								onclick={() => selectedType = stepType}
								class={[
									'rounded-md border px-3 py-1.5 text-xs font-semibold transition-all',
									selectedType === stepType
										? `${colors.bg} ${colors.text} ${colors.border}`
										: 'border-border bg-muted/30 text-muted-foreground hover:bg-muted',
								].join(' ')}
							>
								{i18n.t.par.stepTypeShort[stepType]}
								<span class="ml-1 font-normal opacity-70">
									{i18n.t.par.stepTypes[stepType]}
								</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- UPT sequence indicator -->
				{#if selectedType && isUptStep(selectedType)}
					<p class="text-xs text-muted-foreground">
						{i18n.t.par.newStepDialog.sequenceLabel}: <strong>{sequence}</strong>
						{#if parCase.grade}
							/ {({ A: 2, B: 4, C: 6 } as const)[parCase.grade]}
						{/if}
					</p>
				{/if}

				<!-- Exam date -->
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.newStepDialog.dateLabel}</label>
					<input
						type="date"
						bind:value={examDate}
						class="rounded-md border border-input bg-background px-3 py-2 text-sm"
					/>
				</div>

				<!-- Doctor -->
				<div class="flex flex-col gap-1.5">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.newStepDialog.doctorLabel}</label>
					<select
						class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
						onchange={(e) => {
							const v = (e.target as HTMLSelectElement).value;
							doctorId = v ? Number(v) : null;
						}}
					>
						<option value="">{i18n.t.common.none}</option>
						{#each doctors.list as doc}
							<option value={doc.id} selected={doctorId === doc.id}>{staffLabel(doc)}</option>
						{/each}
					</select>
				</div>

				{#if error}
					<p class="text-xs text-destructive">{error}</p>
				{/if}
			</div>

			<DialogFooter>
				<Button variant="outline" onclick={() => open = false}>{i18n.t.actions.cancel}</Button>
				<Button onclick={handleCreate} disabled={saving || !selectedType}>
					{saving ? i18n.t.common.loading : i18n.t.actions.save}
				</Button>
			</DialogFooter>
		{/if}
	</DialogContent>
</Dialog>
