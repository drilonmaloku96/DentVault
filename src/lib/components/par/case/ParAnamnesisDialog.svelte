<script lang="ts">
	import { onMount } from 'svelte';
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { getParAnamnesis, upsertParAnamnesis } from '$lib/services/db';
	import type { ParAnamnesis } from '$lib/types';
	import { i18n } from '$lib/i18n';

	let {
		caseId,
		locked = false,
		open = $bindable(false),
	}: {
		caseId: number;
		locked?: boolean;
		open?: boolean;
	} = $props();

	// Form fields mirroring ParAnamnesis
	let diabetes           = $state(false);
	let hba1c              = $state<string>('');
	let smoking            = $state(false);
	let smokingCpd         = $state<string>('');
	let smokingYears       = $state<string>('');
	let cardiovascular     = $state(false);
	let immunosuppression  = $state(false);
	let generalOther       = $state('');
	let priorPar           = $state(false);
	let priorParYear       = $state<string>('');
	let familyHistory      = $state(false);
	let specificOther      = $state('');
	let specialHistory     = $state('');
	let assessorDone       = $state(false);
	let assessorDate       = $state('');

	let loading = $state(false);
	let saving  = $state(false);
	let dirty   = $state(false);

	onMount(() => { void load(); });

	async function load() {
		loading = true;
		const a = await getParAnamnesis(caseId);
		if (a) populateFrom(a);
		loading = false;
	}

	function populateFrom(a: ParAnamnesis) {
		diabetes          = a.diabetes;
		hba1c             = a.hba1c != null ? String(a.hba1c) : '';
		smoking           = a.smoking;
		smokingCpd        = a.smoking_cpd != null ? String(a.smoking_cpd) : '';
		smokingYears      = a.smoking_years != null ? String(a.smoking_years) : '';
		cardiovascular    = a.cardiovascular;
		immunosuppression = a.immunosuppression;
		generalOther      = a.general_other ?? '';
		priorPar          = a.prior_par;
		priorParYear      = a.prior_par_year != null ? String(a.prior_par_year) : '';
		familyHistory     = a.family_history;
		specificOther     = a.specific_other ?? '';
		specialHistory    = a.special_history ?? '';
		assessorDone      = a.assessor_done;
		assessorDate      = a.assessor_date ?? '';
		dirty = false;
	}

	function mark() { dirty = true; }

	async function save() {
		saving = true;
		await upsertParAnamnesis(caseId, {
			diabetes,
			hba1c:             hba1c             ? Number(hba1c)       : null,
			smoking,
			smoking_cpd:       smokingCpd        ? Number(smokingCpd)  : null,
			smoking_years:     smokingYears       ? Number(smokingYears) : null,
			cardiovascular,
			immunosuppression,
			general_other:     generalOther,
			prior_par:         priorPar,
			prior_par_year:    priorParYear       ? Number(priorParYear) : null,
			family_history:    familyHistory,
			specific_other:    specificOther,
			special_history:   specialHistory,
			assessor_done:     assessorDone,
			assessor_date:     assessorDate || null,
		});
		saving = false;
		dirty = false;
	}
</script>

<Dialog bind:open>
	<DialogContent class="max-w-[540px] sm:max-w-[540px] max-h-[88vh] overflow-y-auto">
		<DialogHeader>
			<DialogTitle>{i18n.t.par.anamnesis.title}</DialogTitle>
		</DialogHeader>

		{#if loading}
			<div class="flex justify-center py-8">
				<svg class="h-5 w-5 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
				</svg>
			</div>
		{:else}
			<div class="flex flex-col gap-5 py-2">

				<!-- General risk factors -->
				<section class="flex flex-col gap-3">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">General Risk Factors</h3>

					<!-- Diabetes -->
					<div class="flex flex-col gap-1.5">
						<label class="flex items-center gap-2 cursor-pointer {locked ? 'opacity-50 pointer-events-none' : ''}">
							<input type="checkbox" bind:checked={diabetes} onchange={mark} disabled={locked} class="h-4 w-4 accent-primary rounded"/>
							<span class="text-sm">{i18n.t.par.anamnesis.diabetes}</span>
						</label>
						{#if diabetes}
							<div class="flex items-center gap-2 ml-6">
								<label class="text-xs text-muted-foreground w-20">{i18n.t.par.anamnesis.hba1c}</label>
								<input
									type="number" step="0.1" min="0" max="20"
									bind:value={hba1c} oninput={mark}
									disabled={locked}
									class="w-24 rounded border border-input bg-background px-2 py-1 text-sm disabled:opacity-50"
									placeholder="e.g. 7.2"
								/>
							</div>
						{/if}
					</div>

					<!-- Smoking -->
					<div class="flex flex-col gap-1.5">
						<label class="flex items-center gap-2 cursor-pointer {locked ? 'opacity-50 pointer-events-none' : ''}">
							<input type="checkbox" bind:checked={smoking} onchange={mark} disabled={locked} class="h-4 w-4 accent-primary rounded"/>
							<span class="text-sm">{i18n.t.par.anamnesis.smoking}</span>
						</label>
						{#if smoking}
							<div class="grid grid-cols-2 gap-2 ml-6">
								<div class="flex items-center gap-2">
									<label class="text-xs text-muted-foreground w-24">{i18n.t.par.anamnesis.smokingCpd}</label>
									<input type="number" min="0" bind:value={smokingCpd} oninput={mark} disabled={locked}
										class="w-20 rounded border border-input bg-background px-2 py-1 text-sm disabled:opacity-50"/>
								</div>
								<div class="flex items-center gap-2">
									<label class="text-xs text-muted-foreground w-24">{i18n.t.par.anamnesis.smokingYears}</label>
									<input type="number" min="0" bind:value={smokingYears} oninput={mark} disabled={locked}
										class="w-20 rounded border border-input bg-background px-2 py-1 text-sm disabled:opacity-50"/>
								</div>
							</div>
						{/if}
					</div>

					<!-- Cardiovascular -->
					<label class="flex items-center gap-2 cursor-pointer {locked ? 'opacity-50 pointer-events-none' : ''}">
						<input type="checkbox" bind:checked={cardiovascular} onchange={mark} disabled={locked} class="h-4 w-4 accent-primary rounded"/>
						<span class="text-sm">{i18n.t.par.anamnesis.cardiovascular}</span>
					</label>

					<!-- Immunosuppression -->
					<label class="flex items-center gap-2 cursor-pointer {locked ? 'opacity-50 pointer-events-none' : ''}">
						<input type="checkbox" bind:checked={immunosuppression} onchange={mark} disabled={locked} class="h-4 w-4 accent-primary rounded"/>
						<span class="text-sm">{i18n.t.par.anamnesis.immunosuppression}</span>
					</label>

					<!-- Other general -->
					<div class="flex flex-col gap-1">
						<label class="text-xs text-muted-foreground">{i18n.t.par.anamnesis.generalOther}</label>
						<textarea
							bind:value={generalOther} oninput={mark}
							disabled={locked} rows={2}
							class="rounded border border-input bg-background px-2 py-1.5 text-sm resize-none disabled:opacity-50"
						></textarea>
					</div>
				</section>

				<!-- Specific periodontitis risk factors -->
				<section class="flex flex-col gap-3">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Periodontitis-Specific Factors</h3>

					<!-- Prior PAR -->
					<div class="flex flex-col gap-1.5">
						<label class="flex items-center gap-2 cursor-pointer {locked ? 'opacity-50 pointer-events-none' : ''}">
							<input type="checkbox" bind:checked={priorPar} onchange={mark} disabled={locked} class="h-4 w-4 accent-primary rounded"/>
							<span class="text-sm">{i18n.t.par.anamnesis.priorPar}</span>
						</label>
						{#if priorPar}
							<div class="flex items-center gap-2 ml-6">
								<label class="text-xs text-muted-foreground w-12">{i18n.t.par.anamnesis.priorParYear}</label>
								<input type="number" min="1950" max={new Date().getFullYear()}
									bind:value={priorParYear} oninput={mark} disabled={locked}
									class="w-24 rounded border border-input bg-background px-2 py-1 text-sm disabled:opacity-50"
									placeholder={String(new Date().getFullYear() - 5)}
								/>
							</div>
						{/if}
					</div>

					<!-- Family history -->
					<label class="flex items-center gap-2 cursor-pointer {locked ? 'opacity-50 pointer-events-none' : ''}">
						<input type="checkbox" bind:checked={familyHistory} onchange={mark} disabled={locked} class="h-4 w-4 accent-primary rounded"/>
						<span class="text-sm">{i18n.t.par.anamnesis.familyHistory}</span>
					</label>

					<!-- Other specific -->
					<div class="flex flex-col gap-1">
						<label class="text-xs text-muted-foreground">{i18n.t.par.anamnesis.specificOther}</label>
						<textarea
							bind:value={specificOther} oninput={mark}
							disabled={locked} rows={2}
							class="rounded border border-input bg-background px-2 py-1.5 text-sm resize-none disabled:opacity-50"
						></textarea>
					</div>
				</section>

				<!-- Special history -->
				<section class="flex flex-col gap-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Special Notes</h3>
					<textarea
						bind:value={specialHistory} oninput={mark}
						disabled={locked} rows={3}
						placeholder={i18n.t.par.anamnesis.specialHistory}
						class="rounded border border-input bg-background px-2 py-1.5 text-sm resize-none disabled:opacity-50"
					></textarea>
				</section>

				<!-- Assessor -->
				<section class="flex flex-col gap-2">
					<h3 class="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Assessor Sign-off</h3>
					<label class="flex items-center gap-2 cursor-pointer {locked ? 'opacity-50 pointer-events-none' : ''}">
						<input type="checkbox" bind:checked={assessorDone} onchange={mark} disabled={locked} class="h-4 w-4 accent-emerald-500 rounded"/>
						<span class="text-sm font-medium">{i18n.t.par.anamnesis.assessorDone}</span>
					</label>
					{#if assessorDone}
						<div class="flex items-center gap-2 ml-6">
							<label class="text-xs text-muted-foreground w-28">{i18n.t.par.anamnesis.assessorDate}</label>
							<input type="date" bind:value={assessorDate} onchange={mark} disabled={locked}
								class="rounded border border-input bg-background px-2 py-1 text-sm disabled:opacity-50"/>
						</div>
					{/if}
				</section>

				{#if !locked && dirty}
					<div class="flex justify-end pt-1">
						<Button onclick={save} disabled={saving} size="sm">
							{saving ? i18n.t.common.loading : i18n.t.actions.save}
						</Button>
					</div>
				{/if}
			</div>
		{/if}
	</DialogContent>
</Dialog>
