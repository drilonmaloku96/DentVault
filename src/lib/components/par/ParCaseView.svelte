<script lang="ts">
	import { getParCases, getParAssessments } from '$lib/services/db';
	import { i18n } from '$lib/i18n';
	import { formatDate } from '$lib/utils';
	import { STEP_COLORS } from '$lib/utils/par-state-machine';
	import type { ParCase, ParAssessment } from '$lib/types';
	import ParCaseHeader from './case/ParCaseHeader.svelte';
	import ParNewCaseDialog from './case/ParNewCaseDialog.svelte';
	import ParPathwayLane from './pathway/ParPathwayLane.svelte';
	import ParAssessmentPanel from './assessment/ParAssessmentPanel.svelte';
	import ParNewAssessmentDialog from './assessment/ParNewAssessmentDialog.svelte';

	let { patientId }: { patientId: string } = $props();

	// ── State ────────────────────────────────────────────────
	let cases            = $state<ParCase[]>([]);
	let selectedCaseId   = $state<number | null>(null);
	let assessments      = $state<ParAssessment[]>([]);
	let selectedAssessId = $state<number | null>(null);
	let isLoading        = $state(true);

	let showNewCase      = $state(false);
	let showNewStep      = $state(false);

	// ── Derived ──────────────────────────────────────────────
	const selectedCase       = $derived(cases.find(c => c.id === selectedCaseId) ?? null);
	const selectedAssessment = $derived(assessments.find(a => a.id === selectedAssessId) ?? null);

	// ── Load ─────────────────────────────────────────────────
	$effect(() => {
		void loadCases();
	});

	$effect(() => {
		if (selectedCaseId !== null) {
			void loadAssessments(selectedCaseId);
		} else {
			assessments      = [];
			selectedAssessId = null;
		}
	});

	async function loadCases() {
		isLoading = true;
		cases = await getParCases(patientId);
		if (cases.length > 0 && selectedCaseId === null) {
			selectedCaseId = cases[0].id;
		}
		isLoading = false;
	}

	async function loadAssessments(caseId: number) {
		assessments      = await getParAssessments(caseId);
		selectedAssessId = assessments.length > 0 ? assessments[assessments.length - 1].id : null;
	}

	// ── Callbacks ─────────────────────────────────────────────
	function onCaseCreated(caseId: number) {
		void loadCases().then(() => {
			selectedCaseId = caseId;
		});
	}

	function onCaseUpdated(updated: ParCase) {
		cases = cases.map(c => c.id === updated.id ? updated : c);
	}

	function onCaseDeleted() {
		const remaining = cases.filter(c => c.id !== selectedCaseId);
		cases          = remaining;
		selectedCaseId = remaining.length > 0 ? remaining[0].id : null;
	}

	function onAssessmentCreated(a: ParAssessment) {
		assessments      = [...assessments, a];
		selectedAssessId = a.id;
	}

	function onAssessmentUpdated(a: ParAssessment) {
		assessments = assessments.map(x => x.id === a.id ? a : x);
	}

	function onAssessmentDeleted() {
		assessments      = assessments.filter(a => a.id !== selectedAssessId);
		selectedAssessId = assessments.length > 0 ? assessments[assessments.length - 1].id : null;
	}
</script>

<div class="flex flex-col gap-0 min-h-0">

	{#if isLoading}
		<div class="flex items-center justify-center py-16">
			<svg class="h-6 w-6 animate-spin text-muted-foreground" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
				<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
				<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
			</svg>
		</div>

	{:else if cases.length === 0}
		<!-- Empty state -->
		<div class="flex flex-col items-center justify-center gap-4 py-20 text-center">
			<div class="rounded-full bg-muted/50 p-4">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-8 w-8 text-muted-foreground/60">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
					<polyline points="14 2 14 8 20 8"/>
					<line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
				</svg>
			</div>
			<div>
				<p class="text-sm font-medium">{i18n.t.par.noCase}</p>
				<p class="text-xs text-muted-foreground mt-1">{i18n.t.par.noCaseHint}</p>
			</div>
			<button
				type="button"
				onclick={() => showNewCase = true}
				class="rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90 transition-colors"
			>
				{i18n.t.par.newCase}
			</button>
		</div>

	{:else}
		<div class="flex flex-col gap-4 pt-4">

			<!-- Case selector row -->
			<div class="flex items-center gap-2 flex-wrap">
				{#each cases as c}
					<button
						type="button"
						onclick={() => selectedCaseId = c.id}
						class={[
							'rounded-md border px-3 py-1.5 text-xs font-medium transition-all',
							selectedCaseId === c.id
								? 'border-primary bg-primary/10 text-primary'
								: 'border-border bg-muted/30 text-muted-foreground hover:bg-muted',
						].join(' ')}
					>
						{i18n.t.par.planType[c.plan_type]}
						<span class="ml-1.5 opacity-60">{formatDate(c.created_at)}</span>
					</button>
				{/each}
				<button
					type="button"
					onclick={() => showNewCase = true}
					class="rounded-md border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 text-primary/60 hover:text-primary px-3 py-1.5 text-xs font-medium transition-all"
					title={i18n.t.par.newCase}
				>
					+ {i18n.t.par.newCase}
				</button>
			</div>

			{#if selectedCase}
				<!-- Case header (meta + actions) -->
				<div class="rounded-xl border border-border bg-card px-4 py-3">
					<ParCaseHeader
						parCase={selectedCase}
						onUpdated={onCaseUpdated}
						onDeleted={onCaseDeleted}
					/>
				</div>

				<!-- Pathway lane -->
				<div class="rounded-xl border border-border bg-card px-4 py-3 flex flex-col gap-2">
					<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
						{i18n.t.par.title}
					</p>
					<ParPathwayLane
						parCase={selectedCase}
						{assessments}
						bind:selectedId={selectedAssessId}
						onNewStep={() => showNewStep = true}
					/>
				</div>

				<!-- Assessment detail panel -->
				{#if selectedAssessment}
					<div class="rounded-xl border border-border bg-card px-4 py-4">
						<ParAssessmentPanel
							assessment={selectedAssessment}
							parCase={selectedCase}
							onUpdated={onAssessmentUpdated}
							onDeleted={onAssessmentDeleted}
						/>
					</div>
				{:else if assessments.length === 0 && selectedCase.status === 'active'}
					<div class="rounded-xl border border-dashed border-muted-foreground/20 px-4 py-8 text-center">
						<p class="text-sm text-muted-foreground">{i18n.t.par.newStepHint}</p>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<!-- New case dialog -->
<ParNewCaseDialog
	bind:open={showNewCase}
	{patientId}
	onCreated={onCaseCreated}
/>

<!-- New assessment dialog -->
{#if selectedCase}
	<ParNewAssessmentDialog
		bind:open={showNewStep}
		parCase={selectedCase}
		{assessments}
		onCreated={onAssessmentCreated}
	/>
{/if}
