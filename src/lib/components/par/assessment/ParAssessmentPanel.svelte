<script lang="ts">
	/**
	 * ParAssessmentPanel — thin shell:
	 * header + collapsible meta + summary bar + view tabs [Chart|Table|Compare] + charting surface.
	 * ParChartState is the single source of truth for all three views.
	 */

	import { Button } from '$lib/components/ui/button';
	import { updateParAssessment, deleteParAssessment, insertTimelineEntry } from '$lib/services/db';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { STEP_COLORS, assessmentStatus } from '$lib/utils/par-state-machine';
	import { i18n } from '$lib/i18n';
	import type { ParAssessment, ParCase } from '$lib/types';
	import { formatDate } from '$lib/utils';
	import { createParChartState } from './ParChartState.svelte';
	import { RISK_CHIP_CLASSES } from '$lib/utils/par-colors';
	import ParToothChartSVG from './ParToothChartSVG.svelte';
	import ParEntryHud from './ParEntryHud.svelte';
	import ParMeasurementGrid from './ParMeasurementGrid.svelte';
	import ParCompareView from './ParCompareView.svelte';

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

	const colors = $derived(STEP_COLORS[assessment.type]);
	const status = $derived(assessmentStatus(assessment));
	const locked = $derived(assessment.locked || parCase.status !== 'active');

	// ── ParChartState — single source of truth ────────────────────────────────
	// Re-create when assessmentId changes (key block in template handles this)
	const chartState = createParChartState(assessment.id, locked);

	// ── View tabs ──────────────────────────────────────────────────────────────
	type ViewTab = 'chart' | 'table' | 'compare';
	let activeView = $state<ViewTab>('chart');

	// ── Meta section (collapsed by default) ───────────────────────────────────
	let metaExpanded = $state(false);
	let examDate     = $state(assessment.exam_date);
	let startDate    = $state(assessment.start_date ?? '');
	let endDate      = $state(assessment.end_date ?? '');
	let approvalDate = $state(assessment.approval_date ?? '');
	let doctorId     = $state<number | null>(assessment.doctor_id);
	let isReferral   = $state(assessment.is_referral);
	let notes        = $state(assessment.notes);
	let metaDirty    = $state(false);
	let saving       = $state(false);
	let showDelete   = $state(false);

	// Sync form fields when assessment prop changes
	$effect(() => {
		examDate     = assessment.exam_date;
		startDate    = assessment.start_date ?? '';
		endDate      = assessment.end_date ?? '';
		approvalDate = assessment.approval_date ?? '';
		doctorId     = assessment.doctor_id;
		isReferral   = assessment.is_referral;
		notes        = assessment.notes;
		metaDirty    = false;
	});

	const metaSummary = $derived.by(() => {
		const parts: string[] = [];
		if (examDate) parts.push(`Exam ${formatDate(examDate)}`);
		const doc = doctorId ? doctors.list.find(d => d.id === doctorId) : null;
		if (doc) parts.push(`Dr. ${staffLabel(doc)}`);
		if (approvalDate) parts.push(`approved ${formatDate(approvalDate)}`);
		if (isReferral) parts.push('referral');
		return parts.join(' · ') || 'No date set';
	});

	async function saveMeta() {
		const isNewlyCompleted = !assessment.end_date && !!endDate;
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

		// Auto-create a par_step timeline entry the first time end_date is set
		if (isNewlyCompleted && parCase.patient_id) {
			const stats = chartState.stats;
			const typeShort = i18n.t.par.stepTypeShort[assessment.type] ?? assessment.type;
			const typeLong  = i18n.t.par.stepTypes[assessment.type] ?? assessment.type;
			await insertTimelineEntry(parCase.patient_id, {
				entry_date: endDate,
				entry_type: 'par_step',
				title:      `${typeShort} · ${typeLong}`,
				description: JSON.stringify({
					assessment_id: assessment.id,
					bop:       stats?.bopPercent      ?? 0,
					max_pocket: stats?.maxPocket      ?? 0,
					risk:       stats?.riskLevel      ?? 'stable',
				}),
				is_locked: 1,
			});
		}

		saving = false;
		metaDirty = false;
		onUpdated({
			...assessment,
			exam_date:     examDate,
			doctor_id:     doctorId,
			start_date:    startDate || null,
			end_date:      endDate || null,
			approval_date: approvalDate || null,
			is_referral:   isReferral,
			notes,
		});
	}

	async function handleDelete() {
		await chartState.flush();
		await deleteParAssessment(assessment.id);
		showDelete = false;
		onDeleted();
	}

	// ── Keyboard entry ─────────────────────────────────────────────────────────
	// The chart surface div (below) is programmatically focused whenever the user
	// clicks a probing point or presses "Start charting" — without focus, keydown
	// events never reach us and typing silently does nothing.
	let chartSurfaceEl = $state<HTMLDivElement | null>(null);

	function focusChart() {
		chartSurfaceEl?.focus();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (chartState.locked) return;
		// Never hijack typing inside real form controls (HUD checkbox, meta fields)
		const target = e.target as HTMLElement | null;
		if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

		const c = chartState.cursor;
		if (!c) return;
		const site = chartState.siteAt(c);
		if (!site) return;

		if (e.key >= '0' && e.key <= '9') {
			e.preventDefault();
			chartState.handleDigit(c.tooth, site, parseInt(e.key), e.shiftKey);
		} else if (e.key === 'r' || e.key === 'R') {
			e.preventDefault();
			chartState.inputMode = chartState.inputMode === 'recession' ? 'pd' : 'recession';
		} else if (e.key === 'p' || e.key === 'P') {
			e.preventDefault();
			chartState.togglePlaque(c.tooth, site);
		} else if (e.key === 'b' || e.key === 'B') {
			e.preventDefault();
			chartState.cycleBop(c.tooth, site);
		} else if (e.key === 'Backspace' || e.key === 'Delete') {
			e.preventDefault();
			chartState.setPocket(c.tooth, site, null);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			chartState.moveCursor(e.shiftKey ? 'prev' : 'next');
		} else if (e.key === 'ArrowRight' || e.key === 'Enter') {
			e.preventDefault();
			chartState.moveCursor('next');
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			chartState.moveCursor('prev');
		} else if (e.key === 'Escape') {
			chartSurfaceEl?.blur();
		}
	}

	function startCharting() {
		chartState.startCharting();
		focusChart();
	}
</script>

<div class="flex flex-col gap-4" role="region" aria-label="PAR Assessment">
	<!-- ── Panel header ───────────────────────────────────────────────────── -->
	<div class="flex items-center gap-2">
		<span class="rounded-md px-2.5 py-1 text-xs font-bold {colors.bg} {colors.text} {colors.border} border">
			{i18n.t.par.stepTypeShort[assessment.type]}
		</span>
		<span class="text-sm font-medium">{i18n.t.par.stepTypes[assessment.type]}</span>
		{#if assessment.sequence > 1}
			<span class="text-xs text-muted-foreground">({i18n.t.par.sequence} {assessment.sequence})</span>
		{/if}

		<div class="flex-1"></div>

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

	{#if locked && !assessment.locked}
		<p class="text-xs text-muted-foreground italic">{i18n.t.par.caseLocked}</p>
	{/if}

	<!-- ── Collapsible meta summary row ──────────────────────────────────── -->
	<button
		type="button"
		onclick={() => metaExpanded = !metaExpanded}
		class="flex items-center gap-2 text-left w-full rounded-md border border-border/50 bg-muted/20 hover:bg-muted/40 px-3 py-1.5 transition-colors"
	>
		<span class="text-xs text-muted-foreground flex-1 truncate">{metaSummary}</span>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
		     class="h-3 w-3 text-muted-foreground/50 flex-shrink-0 transition-transform {metaExpanded ? 'rotate-180' : ''}">
			<polyline points="6 9 12 15 18 9"/>
		</svg>
	</button>

	{#if metaExpanded}
		<div class="grid grid-cols-2 gap-3">
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.examDate}</label>
				<input type="date" bind:value={examDate} onchange={() => metaDirty=true} disabled={locked} class="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.newStepDialog.doctorLabel}</label>
				<select class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50" disabled={locked}
					onchange={(e) => { doctorId = Number((e.target as HTMLSelectElement).value)||null; metaDirty=true; }}>
					<option value="">{i18n.t.common.none}</option>
					{#each doctors.list as doc}
						<option value={doc.id} selected={doctorId === doc.id}>{staffLabel(doc)}</option>
					{/each}
				</select>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.startDate}</label>
				<input type="date" bind:value={startDate} onchange={() => metaDirty=true} disabled={locked} class="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.endDate}</label>
				<input type="date" bind:value={endDate} onchange={() => metaDirty=true} disabled={locked} class="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"/>
			</div>
			<div class="flex flex-col gap-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.par.approvalDate}</label>
				<input type="date" bind:value={approvalDate} onchange={() => metaDirty=true} disabled={locked} class="rounded-md border border-input bg-background px-3 py-2 text-sm disabled:opacity-50"/>
			</div>
			<div class="flex flex-col justify-end gap-1">
				<label class="flex items-center gap-2 cursor-pointer {locked ? 'opacity-50 pointer-events-none' : ''}">
					<input type="checkbox" bind:checked={isReferral} onchange={() => metaDirty=true} disabled={locked} class="h-4 w-4 rounded border-input accent-primary"/>
					<span class="text-sm">{i18n.t.par.referralLabel}</span>
				</label>
			</div>
		</div>
		<div class="flex flex-col gap-1">
			<label class="text-xs font-medium text-muted-foreground">{i18n.t.common.notes}</label>
			<textarea bind:value={notes} oninput={() => metaDirty=true} disabled={locked} rows={2}
			          placeholder={i18n.t.common.optional}
			          class="rounded-md border border-input bg-background px-3 py-2 text-sm resize-none disabled:opacity-50"></textarea>
		</div>
		{#if !locked && metaDirty}
			<div class="flex justify-end">
				<Button onclick={saveMeta} disabled={saving} size="sm">
					{saving ? i18n.t.common.loading : i18n.t.actions.save}
				</Button>
			</div>
		{/if}
	{/if}

	<!-- ── Summary bar ───────────────────────────────────────────────────── -->
	{#if chartState.stats}
		{@const s = chartState.stats}
		<div class="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
			<span><span class="text-muted-foreground">BOP:</span> <strong>{s.bopPercent.toFixed(0)}%</strong></span>
			<span><span class="text-muted-foreground">{i18n.t.par.grid.maxPd}:</span> <strong>{s.maxPocket}mm</strong></span>
			<span><span class="text-muted-foreground">{i18n.t.par.grid.meanPd}:</span> <strong>{s.meanPocket.toFixed(1)}mm</strong></span>
			<span><span class="text-muted-foreground">CAL:</span> <strong>{s.cal.toFixed(1)}mm</strong></span>
			<span><span class="text-muted-foreground">{i18n.t.par.grid.teeth6}:</span> <strong>{s.teethWithPocket6plus}</strong></span>
			<span class={RISK_CHIP_CLASSES[s.riskLevel]}>●
				{s.riskLevel === 'stable'
					? i18n.t.par.risk.stable
					: s.riskLevel === 'maintenance'
						? i18n.t.par.risk.maintenance
						: i18n.t.par.risk.highRisk}
			</span>
		</div>
	{/if}

	<!-- ── View toggle + site mode ─────────────────────────────────────────── -->
	<div class="flex items-center gap-2 flex-wrap">
		<!-- View tabs -->
		<div class="flex rounded-md border border-border overflow-hidden">
			{#each (['chart', 'table', 'compare'] as const) as tab}
				<button
					type="button"
					onclick={() => activeView = tab}
					class={[
						'px-3 py-1.5 text-xs font-medium transition-colors border-r border-border last:border-0',
						activeView === tab
							? 'bg-primary text-primary-foreground'
							: 'text-muted-foreground hover:bg-muted',
					].join(' ')}
				>
					{tab === 'chart' ? i18n.t.par.views.chart
					: tab === 'table' ? i18n.t.par.views.table
					: i18n.t.par.views.compare}
				</button>
			{/each}
		</div>

		<!-- Site mode (only on chart/table) -->
		{#if activeView !== 'compare'}
			<div class="flex items-center gap-1 rounded-md border border-border p-0.5 bg-muted/20">
				{#each (['2', '6'] as const) as m}
					<button
						type="button"
						onclick={() => chartState.siteMode = m}
						disabled={locked}
						class={[
							'rounded px-2 py-0.5 text-xs font-medium transition-colors',
							chartState.siteMode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
							locked ? 'opacity-50 cursor-default' : '',
						].join(' ')}
						title={i18n.t.par.chart.siteModeTip}
					>
						{m === '2' ? i18n.t.par.grid.sites2 : i18n.t.par.grid.sites6}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- ── Charting surface ───────────────────────────────────────────────── -->
	{#if activeView === 'chart'}
		<!-- Focusable wrapper: owns keyboard entry. Clicking anywhere on the chart
		     focuses it; a visible ring signals that typing is live. -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			bind:this={chartSurfaceEl}
			tabindex="0"
			role="application"
			aria-label={i18n.t.par.views.chart}
			onkeydown={handleKeydown}
			onclick={focusChart}
			class="flex flex-col gap-3 rounded-lg outline-none transition-shadow focus:ring-2 focus:ring-primary/30"
		>
			<ParToothChartSVG chartState={chartState} onSiteClick={focusChart} />
			{#if !locked}
				<div class="sticky bottom-3 z-10">
					<ParEntryHud chartState={chartState} onStart={startCharting} />
				</div>
			{/if}
		</div>
	{:else if activeView === 'table'}
		<ParMeasurementGrid />
	{:else}
		<ParCompareView {assessment} {parCase} currentState={chartState} />
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
