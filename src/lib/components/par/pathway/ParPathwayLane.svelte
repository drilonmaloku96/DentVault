<script lang="ts">
	import { STEP_COLORS, assessmentStatus } from '$lib/utils/par-state-machine';
	import { i18n } from '$lib/i18n';
	import type { ParAssessment, ParCase, ParStepType } from '$lib/types';
	import { formatDate } from '$lib/utils';

	let {
		parCase,
		assessments,
		selectedId = $bindable(null),
		onNewStep,
	}: {
		parCase: ParCase;
		assessments: ParAssessment[];
		selectedId: number | null;
		onNewStep: () => void;
	} = $props();

	// Group UPT steps together for display
	const uptTypes = new Set<ParStepType>(['UPTd', 'UPTg', 'UPTc']);

	const grouped = $derived(() => {
		const out: Array<ParAssessment | { placeholder: true; type: ParStepType }> = [];
		const fixed: ParStepType[] = ['AIT', 'BEVa', 'CPT', 'BEVb'];

		// Non-UPT steps in pathway order
		for (const type of fixed) {
			const found = assessments.filter(a => a.type === type);
			if (found.length > 0) {
				out.push(...found);
			}
		}

		// KTB steps (standalone, shown separately at start)
		const ktbs = assessments.filter(a => a.type === 'KTB');
		out.unshift(...ktbs);

		// UPT steps grouped by sequence
		const upts = assessments.filter(a => uptTypes.has(a.type)).sort((a, b) => a.sequence - b.sequence);
		out.push(...upts);

		return out.filter(a => 'type' in a) as ParAssessment[];
	});

	function statusIcon(a: ParAssessment): string {
		const s = assessmentStatus(a);
		if (s === 'locked') return '🔒';
		if (s === 'done') return '✓';
		return '●';
	}
</script>

<div class="relative">
	<!-- Scrollable horizontal lane -->
	<div class="flex items-start gap-0 overflow-x-auto pb-1 scrollbar-thin">
		{#each grouped() as assessment, idx}
			{@const colors = STEP_COLORS[assessment.type]}
			{@const isSelected = assessment.id === selectedId}
			{@const status = assessmentStatus(assessment)}
			{@const isUpt = uptTypes.has(assessment.type)}

			<!-- Connector line (between steps, not before first) -->
			{#if idx > 0}
				<div class="flex items-center self-center shrink-0 mx-0">
					<div class="h-px w-6 bg-border"></div>
					<!-- Arrow head -->
					<svg class="h-3 w-3 -ml-0.5 text-muted-foreground/40" viewBox="0 0 12 12" fill="currentColor">
						<path d="M4 2l6 4-6 4V2z"/>
					</svg>
				</div>
			{/if}

			<!-- Step node -->
			<button
				type="button"
				onclick={() => selectedId = assessment.id}
				class={[
					'group flex flex-col items-start shrink-0 rounded-lg border px-3 py-2 text-left transition-all min-w-[90px] max-w-[130px]',
					isSelected
						? `${colors.bg} ${colors.border} shadow-sm ring-2 ring-offset-1 ring-primary/30`
						: `border-border bg-muted/20 hover:${colors.bg} hover:${colors.border}`,
				].join(' ')}
			>
				<!-- Type label + status icon -->
				<div class="flex items-center gap-1 w-full">
					<span class={[
						'text-[10px] font-bold tracking-wide uppercase',
						isSelected ? colors.text : 'text-muted-foreground',
					].join(' ')}>
						{i18n.t.par.stepTypeShort[assessment.type]}
						{#if isUpt}<span class="text-[9px] opacity-70">·{assessment.sequence}</span>{/if}
					</span>
					<div class="flex-1"></div>
					<span class={[
						'text-[10px]',
						status === 'done'   ? 'text-emerald-500' :
						status === 'locked' ? 'text-slate-400' :
						'text-amber-500',
					].join(' ')}>
						{statusIcon(assessment)}
					</span>
				</div>

				<!-- Date -->
				<span class="text-[10px] text-muted-foreground mt-0.5 truncate w-full">
					{formatDate(assessment.exam_date)}
				</span>

				<!-- End date -->
				{#if assessment.end_date}
					<span class="text-[9px] text-muted-foreground/60 truncate w-full">
						→ {formatDate(assessment.end_date)}
					</span>
				{/if}
			</button>
		{/each}

		<!-- "Neu" add button -->
		{#if parCase.status === 'active'}
			{#if grouped().length > 0}
				<div class="flex items-center self-center shrink-0 mx-0">
					<div class="h-px w-6 bg-border/50"></div>
				</div>
			{/if}
			<button
				type="button"
				onclick={onNewStep}
				class="flex flex-col items-center justify-center shrink-0 rounded-lg border border-dashed border-primary/40 bg-primary/5 hover:bg-primary/10 hover:border-primary/60 text-primary/60 hover:text-primary transition-all min-w-[56px] h-[64px] px-2"
				title={i18n.t.par.newStep}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
					<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
				</svg>
				<span class="text-[9px] font-medium mt-0.5">{i18n.t.actions.new}</span>
			</button>
		{/if}

		<!-- Empty state -->
		{#if grouped().length === 0 && parCase.status !== 'active'}
			<p class="text-sm text-muted-foreground italic">{i18n.t.common.noData}</p>
		{/if}
	</div>
</div>
