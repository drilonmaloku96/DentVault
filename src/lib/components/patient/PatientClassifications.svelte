<script lang="ts">
	import { onMount } from 'svelte';
	import type {
		OrthoClassification,
		PatientClassification,
		PatientCondition,
		AngleClass,
		MolarRelationship,
		CrowdingLevel,
		CrossbiteType,
		OpenBiteType,
		OrthoTreatmentType,
		ExtractionPattern,
		PerioStatus,
		RiskLevel,
	} from '$lib/types';
	import {
		getOrthoClassification,
		upsertOrthoClassification,
		getPatientClassification,
		upsertPatientClassification,
		getPatientConditions,
		insertPatientCondition,
		resolvePatientCondition,
		deletePatientCondition,
	} from '$lib/services/db';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import { i18n } from '$lib/i18n';

	let { patientId }: { patientId: string } = $props();

	let ortho = $state<Partial<OrthoClassification>>({});
	let clinical = $state<Partial<PatientClassification>>({});
	let isLoading = $state(true);
	let isSaving = $state(false);
	let saved = $state(false);

	// Dated special conditions
	let patientConditions = $state<PatientCondition[]>([]);
	let showConditionForm = $state(false);
	let newConditionType = $state('');
	let newConditionOnset = $state('');
	let newConditionNotes = $state('');
	let isSavingCondition = $state(false);

	const ALL_CONDITION_TYPES = [
		'Bruxism / Parafunctional', 'TMJ / TMD', 'Sleep Apnea', 'Cleft Lip/Palate',
		'Diabetes', 'Hypertension', 'Anticoagulant Therapy', 'Bisphosphonate Use',
		'Immunosuppressed', 'Pregnancy', 'Cardiovascular Disease', 'Osteoporosis', 'Other',
	];

	onMount(async () => {
		const [o, c, conds] = await Promise.all([
			getOrthoClassification(patientId),
			getPatientClassification(patientId),
			getPatientConditions(patientId),
		]);
		ortho = o ?? {};
		clinical = c ?? {};
		patientConditions = conds;
		isLoading = false;
	});

	async function addCondition() {
		if (!newConditionType.trim()) return;
		isSavingCondition = true;
		try {
			await insertPatientCondition(patientId, {
				condition_key: newConditionType,
				start_date: newConditionOnset || undefined,
				notes: newConditionNotes,
			});
			patientConditions = await getPatientConditions(patientId);
			newConditionType = '';
			newConditionOnset = '';
			newConditionNotes = '';
			showConditionForm = false;
		} finally {
			isSavingCondition = false;
		}
	}

	async function handleResolveCondition(id: number) {
		const today = new Date().toISOString().slice(0, 10);
		await resolvePatientCondition(id, today);
		patientConditions = await getPatientConditions(patientId);
	}

	async function handleDeleteCondition(id: number) {
		await deletePatientCondition(id);
		patientConditions = await getPatientConditions(patientId);
	}

	async function save() {
		isSaving = true;
		try {
			await Promise.all([
				upsertOrthoClassification(patientId, ortho),
				upsertPatientClassification(patientId, { ...clinical }),
			]);
			saved = true;
			setTimeout(() => (saved = false), 2000);
		} finally {
			isSaving = false;
		}
	}


	const sc = 'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

	// Option lists
	const notSet = $derived('—');
	const angleClassOpts = $derived<{ value: AngleClass; label: string }[]>([
		{ value: '', label: notSet },
		{ value: 'class_I', label: i18n.t.ortho.angleClass.class_I },
		{ value: 'class_II_div1', label: i18n.t.ortho.angleClass.class_II_div1 },
		{ value: 'class_II_div2', label: i18n.t.ortho.angleClass.class_II_div2 },
		{ value: 'class_III', label: i18n.t.ortho.angleClass.class_III },
	]);
	const molarOpts = $derived<{ value: MolarRelationship; label: string }[]>([
		{ value: '', label: notSet },
		{ value: 'class_I', label: i18n.t.ortho.angleClass.class_I },
		{ value: 'class_II', label: i18n.t.ortho.angleClass.class_II_div1 },
		{ value: 'class_III', label: i18n.t.ortho.angleClass.class_III },
		{ value: 'super_class_II', label: 'Super Class II' },
		{ value: 'super_class_III', label: 'Super Class III' },
	]);
	const crowdingOpts = $derived<{ value: CrowdingLevel; label: string }[]>([
		{ value: '', label: notSet },
		{ value: 'none', label: i18n.t.ortho.crowding.none },
		{ value: 'mild', label: i18n.t.ortho.crowding.mild },
		{ value: 'moderate', label: i18n.t.ortho.crowding.moderate },
		{ value: 'severe', label: i18n.t.ortho.crowding.severe },
	]);
	const crossbiteOpts = $derived<{ value: CrossbiteType; label: string }[]>([
		{ value: '', label: notSet },
		{ value: 'none', label: i18n.t.ortho.crossbite.none },
		{ value: 'anterior', label: i18n.t.ortho.crossbite.anterior },
		{ value: 'posterior_unilateral', label: i18n.t.ortho.crossbite.posterior_unilateral },
		{ value: 'posterior_bilateral', label: i18n.t.ortho.crossbite.posterior_bilateral },
	]);
	const openBiteOpts = $derived<{ value: OpenBiteType; label: string }[]>([
		{ value: '', label: notSet },
		{ value: 'none', label: i18n.t.ortho.openBite.none },
		{ value: 'anterior', label: i18n.t.ortho.openBite.anterior },
		{ value: 'posterior', label: i18n.t.ortho.openBite.posterior },
	]);
	const treatmentTypeOpts: { value: OrthoTreatmentType; label: string }[] = [
		{ value: '', label: '—' },
		{ value: 'fixed_appliances', label: 'Fixed Appliances' },
		{ value: 'aligners', label: 'Clear Aligners' },
		{ value: 'functional', label: 'Functional Appliance' },
		{ value: 'headgear', label: 'Headgear' },
		{ value: 'surgical_ortho', label: 'Surgical Orthodontics' },
		{ value: 'retainer_only', label: 'Retainer Only' },
		{ value: 'other', label: 'Other' },
	];
	const extractionOpts: { value: ExtractionPattern; label: string }[] = [
		{ value: '', label: '—' },
		{ value: 'non_extraction', label: 'Non-extraction' },
		{ value: '4_premolars', label: '4 Premolars' },
		{ value: '2_upper_premolars', label: '2 Upper Premolars' },
		{ value: '2_lower_premolars', label: '2 Lower Premolars' },
		{ value: 'other', label: 'Other' },
	];
	const perioStatusOpts: { value: PerioStatus; label: string }[] = [
		{ value: '', label: '—' },
		{ value: 'healthy', label: 'Healthy' },
		{ value: 'gingivitis', label: 'Gingivitis' },
		{ value: 'mild_periodontitis', label: 'Mild Periodontitis' },
		{ value: 'moderate_periodontitis', label: 'Moderate Periodontitis' },
		{ value: 'severe_periodontitis', label: 'Severe Periodontitis' },
	];
	const riskOpts: { value: RiskLevel; label: string }[] = [
		{ value: '', label: '—' },
		{ value: 'low', label: 'Low' },
		{ value: 'medium', label: 'Medium' },
		{ value: 'high', label: 'High' },
	];
</script>

{#if isLoading}
	<div class="h-32 animate-pulse rounded-lg border bg-muted"></div>
{:else}
	<div class="flex flex-col gap-6">

		<!-- ── Orthodontic Classification ── -->
		<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
			<div>
				<h3 class="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
					{i18n.t.ortho.title}
				</h3>
			</div>
			<Separator />

			<!-- Skeletal Classification -->
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">{i18n.t.ortho.title} <span class="text-muted-foreground font-normal">({i18n.t.ortho.pretreatment})</span></Label>
					<select class={sc} bind:value={ortho.pre_angle_class}>
						{#each angleClassOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">{i18n.t.ortho.title} <span class="text-muted-foreground font-normal">({i18n.t.ortho.posttreatment})</span></Label>
					<select class={sc} bind:value={ortho.post_angle_class}>
						{#each angleClassOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">{i18n.t.ortho.molarRelationship} <span class="text-muted-foreground font-normal">({i18n.t.ortho.pretreatment})</span></Label>
					<select class={sc} bind:value={ortho.pre_molar_relationship}>
						{#each molarOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">{i18n.t.ortho.molarRelationship} <span class="text-muted-foreground font-normal">({i18n.t.ortho.posttreatment})</span></Label>
					<select class={sc} bind:value={ortho.post_molar_relationship}>
						{#each molarOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
			</div>

			<!-- Measurements -->
			<div class="grid gap-3 sm:grid-cols-4">
				{#each [
					{ label: `${i18n.t.ortho.overjet} (${i18n.t.ortho.pretreatment})`, key: 'pre_overjet_mm' },
					{ label: `${i18n.t.ortho.overjet} (${i18n.t.ortho.posttreatment})`, key: 'post_overjet_mm' },
					{ label: `${i18n.t.ortho.overbite} (${i18n.t.ortho.pretreatment})`, key: 'pre_overbite_mm' },
					{ label: `${i18n.t.ortho.overbite} (${i18n.t.ortho.posttreatment})`, key: 'post_overbite_mm' },
				] as field}
					<div class="flex flex-col gap-1.5">
						<Label class="text-xs">{field.label} <span class="text-muted-foreground font-normal">mm</span></Label>
						<input
							type="number"
							step="0.1"
							min="-10"
							max="30"
							class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
							bind:value={ortho[field.key as keyof typeof ortho]}
						/>
					</div>
				{/each}
			</div>

			<!-- Crowding / Crossbite / Open bite -->
			<div class="grid gap-3 sm:grid-cols-3">
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Crowding (Pre)</Label>
					<select class={sc} bind:value={ortho.pre_crowding}>
						{#each crowdingOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Crossbite (Pre)</Label>
					<select class={sc} bind:value={ortho.pre_crossbite}>
						{#each crossbiteOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Open Bite (Pre)</Label>
					<select class={sc} bind:value={ortho.pre_open_bite}>
						{#each openBiteOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Crowding (Post)</Label>
					<select class={sc} bind:value={ortho.post_crowding}>
						{#each crowdingOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Crossbite (Post)</Label>
					<select class={sc} bind:value={ortho.post_crossbite}>
						{#each crossbiteOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Open Bite (Post)</Label>
					<select class={sc} bind:value={ortho.post_open_bite}>
						{#each openBiteOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
			</div>

			<!-- Treatment info -->
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">{i18n.t.ortho.treatmentType}</Label>
					<select class={sc} bind:value={ortho.treatment_type}>
						{#each treatmentTypeOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">{i18n.t.ortho.extractionPattern}</Label>
					<select class={sc} bind:value={ortho.extraction_pattern}>
						{#each extractionOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Treatment Start</Label>
					<input type="date" class={sc} bind:value={ortho.treatment_start_date} />
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Treatment End</Label>
					<input type="date" class={sc} bind:value={ortho.treatment_end_date} />
				</div>
			</div>
		</div>

		<!-- ── Clinical Risk & Periodontal Status ── -->
		<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
			<div>
				<h3 class="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
					{i18n.t.patients.conditions}
				</h3>
			</div>
			<Separator />

			<div class="grid gap-3 sm:grid-cols-3">
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Periodontal Status</Label>
					<select class={sc} bind:value={clinical.perio_status}>
						{#each perioStatusOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Caries Risk</Label>
					<select class={sc} bind:value={clinical.caries_risk}>
						{#each riskOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label class="text-xs">Periodontal Risk</Label>
					<select class={sc} bind:value={clinical.perio_risk}>
						{#each riskOpts as o}<option value={o.value}>{o.label}</option>{/each}
					</select>
				</div>
			</div>

			<!-- Dated special conditions -->
			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between">
					<Label class="text-xs">Special Conditions</Label>
					<button
						type="button"
						onclick={() => (showConditionForm = !showConditionForm)}
						class="text-[10px] text-primary hover:underline"
					>
						{showConditionForm ? i18n.t.actions.cancel : `+ ${i18n.t.actions.add}`}
					</button>
				</div>

				{#if patientConditions.length > 0}
					<div class="flex flex-col gap-1.5">
						{#each patientConditions as cond}
							<div class="flex items-start justify-between gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5">
								<div class="flex-1 min-w-0">
									<span class="text-xs font-medium">{cond.condition_key}</span>
									{#if cond.start_date}
										<span class="text-xs text-muted-foreground ml-1.5">since {cond.start_date}</span>
									{/if}
									{#if !cond.is_active && cond.end_date}
										<span class="ml-1.5 text-[10px] text-emerald-600">{i18n.t.complications.resolve}d {cond.end_date}</span>
									{/if}
									{#if cond.notes}
										<p class="text-[10px] text-muted-foreground/70 mt-0.5">{cond.notes}</p>
									{/if}
								</div>
								<div class="flex items-center gap-1 shrink-0">
									{#if cond.is_active}
										<button
											type="button"
											onclick={() => handleResolveCondition(cond.id)}
											class="text-[10px] text-emerald-600 hover:underline"
										>{i18n.t.complications.resolve}</button>
									{/if}
									<button
										type="button"
										onclick={() => handleDeleteCondition(cond.id)}
										class="text-[10px] text-destructive hover:underline"
									>✕</button>
								</div>
							</div>
						{/each}
					</div>
				{:else if !showConditionForm}
					<p class="text-xs text-muted-foreground/60 italic">None recorded.</p>
				{/if}

				{#if showConditionForm}
					<div class="flex flex-col gap-2 rounded-md border bg-muted/20 p-2.5">
						<select
							bind:value={newConditionType}
							class="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:border-ring"
						>
							<option value="">Select type…</option>
							{#each ALL_CONDITION_TYPES as ct}
								<option value={ct}>{ct}</option>
							{/each}
						</select>
						<div class="flex gap-2">
							<div class="flex flex-col gap-1 flex-1">
								<label class="text-[10px] text-muted-foreground">Onset Date (optional)</label>
								<input type="date" bind:value={newConditionOnset} class="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:border-ring" />
							</div>
						</div>
						<input
							type="text"
							bind:value={newConditionNotes}
							placeholder="Notes (optional)"
							class="h-7 w-full rounded border border-input bg-background px-2 text-xs outline-none focus:border-ring"
						/>
						<div class="flex gap-2">
							<button
								type="button"
								onclick={addCondition}
								disabled={isSavingCondition || !newConditionType}
								class="h-6 rounded bg-primary px-3 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							>
								{isSavingCondition ? i18n.t.common.loading : i18n.t.actions.save}
							</button>
							<button
								type="button"
								onclick={() => (showConditionForm = false)}
								class="h-6 rounded border px-3 text-[10px] hover:bg-muted"
							>{i18n.t.actions.cancel}</button>
						</div>
					</div>
				{/if}
			</div>
		</div>

		<!-- Save button -->
		<div class="flex items-center gap-3">
			<Button onclick={save} disabled={isSaving}>
				{isSaving ? i18n.t.common.loading : i18n.t.actions.save}
			</Button>
			{#if saved}
				<span class="text-sm text-emerald-600 font-medium">✓ {i18n.t.settings.saved}</span>
			{/if}
		</div>
	</div>
{/if}
