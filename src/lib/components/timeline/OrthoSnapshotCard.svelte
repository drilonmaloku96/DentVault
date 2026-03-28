<script lang="ts">
	import type { TimelineEntry, OrthoAssessment, BissType } from '$lib/types';
	import { formatDate } from '$lib/utils';
	import { i18n } from '$lib/i18n';

	let {
		entry,
		onView,
	}: {
		entry: TimelineEntry;
		onView?: () => void;
	} = $props();

	const assessment: OrthoAssessment | null = $derived.by(() => {
		try { return entry.chart_data ? (JSON.parse(entry.chart_data) as OrthoAssessment) : null; }
		catch { return null; }
	});

	const isCovered = $derived(assessment?.findings.some(f => f.grade >= 3) ?? false);
	const today = new Date().toISOString().slice(0, 10);
	const isEditable = $derived(entry.entry_date === today);

	function gradeLabel(f: { group: string; grade: number; measured_value: number | null }) {
		return `${f.group}${f.grade}${f.measured_value !== null ? ` ${f.measured_value}mm` : ''}`;
	}

	function pbLabel(v: number): string {
		const frac: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
		const whole = Math.floor(v);
		const dec = +(v - whole).toFixed(2);
		return whole > 0 ? whole + (frac[dec] ?? '') : (frac[dec] ?? String(v));
	}

	function bissLabel(side: 'right' | 'left'): string {
		const biss = side === 'right' ? assessment?.biss_right : assessment?.biss_left;
		if (!biss) return '';
		const sideStr = side === 'right' ? i18n.t.ortho.bissRight : i18n.t.ortho.bissLeft;
		const typeStr = (i18n.t.ortho.bissTypes as Record<BissType, string>)[biss.type] ?? biss.type;
		const pbStr = biss.praemolarenbreite != null ? ` ${pbLabel(biss.praemolarenbreite)} ${i18n.t.ortho.praemolarenbreiteShort}` : '';
		return `${sideStr}: ${typeStr}${pbStr}`;
	}

	const bissLabels = $derived([bissLabel('right'), bissLabel('left')].filter(Boolean));

	// ── Readable context fields ────────────────────────────────────
	function resolveOption(value: string | undefined, map: Record<string, string>): string {
		if (!value) return '';
		return map[value] ?? value;
	}

	const contextParts = $derived.by(() => {
		if (!assessment) return [];
		const parts: string[] = [];
		const d = resolveOption(assessment.dentition_stage, i18n.t.ortho.dentitionOptions as Record<string, string>);
		if (d) parts.push(`${i18n.t.ortho.dentitionStage}: ${d}`);
		const tp = resolveOption(assessment.treatment_phase, i18n.t.ortho.treatmentPhaseOptions as Record<string, string>);
		if (tp) parts.push(`${i18n.t.ortho.treatmentPhase}: ${tp}`);
		const ac = resolveOption(assessment.angle_class, i18n.t.ortho.angleClass as Record<string, string>);
		if (ac) parts.push(`${i18n.t.ortho.angleClassLabel}: ${ac}`);
		if (assessment.cvm_stage > 0) parts.push(`CVM ${assessment.cvm_stage}`);
		const fp = resolveOption(assessment.facial_profile, i18n.t.ortho.facialProfileOptions as Record<string, string>);
		if (fp) parts.push(`${i18n.t.ortho.facialProfile}: ${fp}`);
		return parts;
	});

	const habitLabels = $derived.by(() => {
		if (!assessment?.bad_habits?.length) return '';
		return assessment.bad_habits
			.map(k => (i18n.t.ortho.badHabitOptions as Record<string, string>)[k] ?? k)
			.join(', ');
	});
</script>

<div class="mb-2 ml-8">
	<!-- Timeline dot -->
	<div class="absolute left-0 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-violet-500 ring-2 ring-background mt-1.5"></div>

	<div class="py-1.5">
		<!-- Title row — clickable to open -->
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="flex items-center gap-2 w-full rounded-md px-1.5 py-1 -mx-1.5 {onView ? 'cursor-pointer hover:bg-muted/50 transition-colors' : ''}"
			onclick={onView}
		>
			<!-- KIG icon -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-violet-500 shrink-0">
				<path d="M9 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9"/>
				<polyline points="9 2 9 9 16 9"/>
				<line x1="12" y1="13" x2="12" y2="17"/>
				<line x1="10" y1="15" x2="14" y2="15"/>
			</svg>
			<span class="text-sm font-semibold text-foreground">{i18n.t.ortho.button}</span>
			<span class="text-[10px] text-muted-foreground/50">{formatDate(entry.entry_date)}</span>

			{#if assessment}
				<span class="ml-1 px-1.5 py-0 rounded-full text-[10px] font-medium {isCovered ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-muted text-muted-foreground'}">
					{isCovered ? i18n.t.ortho.insuranceCovered : i18n.t.ortho.notCovered}
				</span>
			{/if}

			<!-- Lock / Edit icon -->
			{#if isEditable}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-auto h-3 w-3 text-muted-foreground/40 shrink-0">
					<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
				</svg>
			{:else}
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="ml-auto h-3 w-3 text-muted-foreground/30 shrink-0">
					<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
					<path d="M7 11V7a5 5 0 0 1 10 0v4"/>
				</svg>
			{/if}
		</div>

		<!-- Context fields (readable text) -->
		{#if contextParts.length > 0}
			<p class="text-[11px] text-muted-foreground/80 mt-0.5 ml-5.5 leading-snug">
				{contextParts.join(' · ')}
			</p>
		{/if}

		<!-- Bad habits -->
		{#if habitLabels}
			<p class="text-[11px] text-violet-600/70 dark:text-violet-400/70 mt-0.5 ml-5.5 leading-snug">
				{i18n.t.ortho.badHabitsLabel}: {habitLabels}
			</p>
		{/if}

		<!-- Findings chips -->
		{#if assessment?.findings && assessment.findings.length > 0}
			<div class="flex flex-wrap gap-1 mt-1 ml-5.5">
				{#each assessment.findings as f}
					<span class="px-1.5 py-0 rounded text-[10px] font-mono {f.grade >= 3 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-muted text-muted-foreground'}">
						{gradeLabel(f)}
					</span>
				{/each}
			</div>
		{/if}

		<!-- Bite labels -->
		{#if bissLabels.length > 0}
			<div class="flex flex-wrap gap-1 mt-1 ml-5.5">
				{#each bissLabels as lbl}
					<span class="px-1.5 py-0 rounded text-[10px] bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">{lbl}</span>
				{/each}
			</div>
		{/if}

		<!-- Legacy treatment recommendation (backward compat for old entries) -->
		{#if assessment?.treatment_recommendation}
			<p class="text-[11px] text-muted-foreground/60 mt-0.5 ml-5.5 line-clamp-1 italic">→ {assessment.treatment_recommendation}</p>
		{/if}

		<!-- Notes -->
		{#if assessment?.notes}
			<p class="text-[11px] text-foreground/80 mt-1 ml-5.5 line-clamp-2 bg-muted/30 rounded px-1.5 py-0.5">
				{assessment.notes}
			</p>
		{/if}
	</div>
</div>
