<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { i18n } from '$lib/i18n';
	import type { OrthoKigEntry, KigGroupCode, BissType, BissMeasurement, TimelineEntry } from '$lib/types';
	import { getTimelineEntries, deleteTimelineEntry, insertTimelineEntry, getDoctors, updateSnapshotChartData } from '$lib/services/db';
	import type { Doctor } from '$lib/types';
	import { untrack } from 'svelte';

	interface Props {
		patientId: string;
		open: boolean;
		/** When set, view/edit an existing ortho_snapshot entry instead of creating new. */
		existingEntry?: TimelineEntry | null;
		onSaved?: () => void;
	}

	let { patientId, open = $bindable(), existingEntry = null, onSaved }: Props = $props();

	// ── KIG group definitions from official KIG schema (Anlage 1) ─────
	type GradeOption = { key: string; grade: number; needsMm: boolean };
	type GroupDef = { code: KigGroupCode; grades: GradeOption[] };

	const KIG_GROUPS: GroupDef[] = [
		{ code: 'A', grades: [{ key: 'A5', grade: 5, needsMm: false }] },
		{ code: 'U', grades: [{ key: 'U4', grade: 4, needsMm: false }] },
		{ code: 'S', grades: [{ key: 'S4', grade: 4, needsMm: false }, { key: 'S5', grade: 5, needsMm: false }] },
		{ code: 'D', grades: [{ key: 'D1', grade: 1, needsMm: true }, { key: 'D2', grade: 2, needsMm: true }, { key: 'D4', grade: 4, needsMm: true }, { key: 'D5', grade: 5, needsMm: true }] },
		{ code: 'M', grades: [{ key: 'M4', grade: 4, needsMm: true }, { key: 'M5', grade: 5, needsMm: true }] },
		{ code: 'O', grades: [{ key: 'O1', grade: 1, needsMm: true }, { key: 'O2', grade: 2, needsMm: true }, { key: 'O3', grade: 3, needsMm: true }, { key: 'O4', grade: 4, needsMm: true }, { key: 'O5', grade: 5, needsMm: true }] },
		{ code: 'T', grades: [{ key: 'T1', grade: 1, needsMm: true }, { key: 'T2', grade: 2, needsMm: true }, { key: 'T3', grade: 3, needsMm: true }] },
		{ code: 'B', grades: [{ key: 'B4', grade: 4, needsMm: false }] },
		{ code: 'K', grades: [{ key: 'K2', grade: 2, needsMm: false }, { key: 'K3', grade: 3, needsMm: false }, { key: 'K4', grade: 4, needsMm: false }] },
		{ code: 'E', grades: [{ key: 'E1', grade: 1, needsMm: true }, { key: 'E2', grade: 2, needsMm: true }, { key: 'E3', grade: 3, needsMm: true }, { key: 'E4', grade: 4, needsMm: true }] },
		{ code: 'P', grades: [{ key: 'P2', grade: 2, needsMm: true }, { key: 'P3', grade: 3, needsMm: true }, { key: 'P4', grade: 4, needsMm: true }] },
	];

	const BAD_HABIT_KEYS = ['thumbSucking', 'tongueThrusting', 'mouthBreathing', 'lipBiting', 'nailBiting', 'bruxism', 'pacifierUse', 'penChewing'] as const;

	// ── State ─────────────────────────────────────────────────────────
	let doctors = $state<Doctor[]>([]);
	let isSaving = $state(false);
	let loadError = $state('');

	const today = new Date().toISOString().slice(0, 10);

	// Read-only: viewing a past entry (not today's date)
	const isReadOnly = $derived(
		existingEntry != null && existingEntry.entry_date !== today
	);

	// Form state
	let examDate             = $state(today);
	let selectedDoctorId     = $state<number | null>(null);
	let notes                = $state('');
	let dentitionStage       = $state('');
	let treatmentPhase       = $state('');
	let angleClass           = $state('');
	let cvmStage             = $state(0);
	let facialProfile        = $state('');
	let badHabits            = $state<string[]>([]);
	let selectedGrades = $state<Record<string, { grade: number; mm: string }>>({});

	// Bite (Biss) measurements
	const PB_OPTIONS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const;
	let bissRight = $state<BissMeasurement | null>(null);
	let bissLeft  = $state<BissMeasurement | null>(null);

	function pbLabel(v: number): string {
		const frac: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
		const whole = Math.floor(v);
		const dec = +(v - whole).toFixed(2);
		return whole > 0 ? whole + (frac[dec] ?? '') : (frac[dec] ?? String(v));
	}

	function setBissType(side: 'right' | 'left', type: BissType) {
		if (isReadOnly) return;
		const cur = side === 'right' ? bissRight : bissLeft;
		const newVal: BissMeasurement = {
			type,
			praemolarenbreite: type === 'neutral' ? null : (cur?.praemolarenbreite ?? 0.5),
		};
		if (side === 'right') bissRight = newVal;
		else bissLeft = newVal;
	}

	function clearBiss(side: 'right' | 'left') {
		if (isReadOnly) return;
		if (side === 'right') bissRight = null;
		else bissLeft = null;
	}

	function setBissPb(side: 'right' | 'left', pb: number) {
		if (isReadOnly) return;
		if (side === 'right' && bissRight) bissRight.praemolarenbreite = pb;
		else if (side === 'left' && bissLeft) bissLeft.praemolarenbreite = pb;
	}

	function toggleHabit(key: string) {
		if (isReadOnly) return;
		if (badHabits.includes(key)) {
			badHabits = badHabits.filter(h => h !== key);
		} else {
			badHabits = [...badHabits, key];
		}
	}

	// ── Derived ───────────────────────────────────────────────────────
	let activeFindings = $derived(
		Object.entries(selectedGrades)
			.filter(([, v]) => v.grade > 0)
			.map(([group, v]) => ({
				group: group as KigGroupCode,
				grade: v.grade,
				measured_value: v.mm !== '' ? parseFloat(v.mm) : null,
			})) satisfies OrthoKigEntry[],
	);

	let isCovered = $derived(activeFindings.some((f) => f.grade >= 3));

	let leadingFinding = $derived(() => {
		let best: OrthoKigEntry | null = null;
		for (const f of activeFindings) {
			if (!best || f.grade > best.grade) best = f;
		}
		return best;
	});

	// Dialog title
	const dialogTitle = $derived(
		existingEntry
			? `KIG – ${i18n.t.ortho.viewAssessment}`
			: `KIG – ${i18n.t.ortho.newAssessment}`
	);

	// ── Load data ─────────────────────────────────────────────────────
	$effect(() => {
		if (open) {
			untrack(() => loadData());
		}
	});

	/** Populate form fields from a parsed OrthoAssessment payload */
	function populateFromPayload(data: Record<string, unknown>, date: string) {
		examDate = date;
		selectedDoctorId = (data.doctor_id as number | null) ?? null;
		dentitionStage = (data.dentition_stage as string) ?? '';
		treatmentPhase = (data.treatment_phase as string) ?? '';
		angleClass = (data.angle_class as string) ?? '';
		cvmStage = (data.cvm_stage as number) ?? 0;
		facialProfile = (data.facial_profile as string) ?? '';
		notes = (data.notes as string) ?? '';
		badHabits = Array.isArray(data.bad_habits) ? data.bad_habits : [];
		bissRight = (data.biss_right as BissMeasurement | null) ?? null;
		bissLeft = (data.biss_left as BissMeasurement | null) ?? null;

		// Rebuild selectedGrades from findings array
		const findings = data.findings as OrthoKigEntry[] | undefined;
		const grades: Record<string, { grade: number; mm: string }> = {};
		if (findings) {
			for (const f of findings) {
				grades[f.group] = {
					grade: f.grade,
					mm: f.measured_value !== null ? String(f.measured_value) : '',
				};
			}
		}
		selectedGrades = grades;
	}

	async function loadData() {
		loadError = '';
		try {
			doctors = await getDoctors();

			if (existingEntry?.chart_data) {
				// Viewing/editing an existing entry
				const data = JSON.parse(existingEntry.chart_data);
				populateFromPayload(data, existingEntry.entry_date);
			} else {
				// New assessment — auto-load the most recent ortho_snapshot for context
				resetForm();
				const entries = await getTimelineEntries(patientId);
				const orthoEntries = entries
					.filter(e => e.entry_type === 'ortho_snapshot' && e.chart_data)
					.sort((a, b) => b.entry_date.localeCompare(a.entry_date));
				if (orthoEntries.length > 0) {
					const lastData = JSON.parse(orthoEntries[0].chart_data!);
					populateFromPayload(lastData, today); // keep today as date
				}
			}
		} catch (e) {
			loadError = String(e);
		}
	}

	// ── Actions ───────────────────────────────────────────────────────
	function selectGrade(groupCode: KigGroupCode, grade: number, needsMm: boolean) {
		if (isReadOnly) return;
		const cur = selectedGrades[groupCode];
		if (cur?.grade === grade) {
			const { [groupCode]: _, ...rest } = selectedGrades;
			selectedGrades = rest;
		} else {
			selectedGrades = { ...selectedGrades, [groupCode]: { grade, mm: needsMm && cur?.mm ? cur.mm : '' } };
		}
	}

	function resetForm() {
		selectedGrades = {};
		notes = '';
		examDate = today;
		dentitionStage = '';
		treatmentPhase = '';
		angleClass = '';
		cvmStage = 0;
		facialProfile = '';
		badHabits = [];
		selectedDoctorId = null;
		bissRight = null;
		bissLeft = null;
	}

	async function handleSave() {
		if (isSaving || isReadOnly) return;
		isSaving = true;
		loadError = '';
		try {
			// Build text summary for timeline card display
			const findingSummary = activeFindings.map(f =>
				`${f.group}${f.grade}${f.measured_value !== null ? ` ${f.measured_value}mm` : ''}`
			).join('  ');
			const coveredLabel = isCovered
				? (i18n.code === 'de' ? 'GKV-Leistungsanspruch' : 'Insurance-covered')
				: (i18n.code === 'de' ? 'Kein Anspruch' : 'Not covered');
			const description = [findingSummary, coveredLabel].filter(Boolean).join(' · ');

			// Assessment payload stored in chart_data as JSON
			const payload = {
				exam_date: examDate,
				doctor_id: selectedDoctorId,
				findings: activeFindings,
				notes,
				dentition_stage: dentitionStage,
				treatment_phase: treatmentPhase,
				angle_class: angleClass,
				cvm_stage: cvmStage,
				facial_profile: facialProfile,
				treatment_recommendation: '', // kept for backward compat, removed from UI
				bad_habits: badHabits,
				biss_right: bissRight,
				biss_left: bissLeft,
			};

			if (existingEntry && existingEntry.entry_date === today) {
				// Editing today's existing entry — update in place
				await updateSnapshotChartData(existingEntry.id, JSON.stringify(payload));
			} else {
				// New assessment — same-date dedup: remove any existing ortho_snapshot for this exam date
				const existing = await getTimelineEntries(patientId);
				const sameDay = existing.filter(e => e.entry_type === 'ortho_snapshot' && e.entry_date === examDate);
				for (const old of sameDay) await deleteTimelineEntry(old.id);

				await insertTimelineEntry(patientId, {
					entry_date: examDate,
					entry_type: 'ortho_snapshot',
					title: i18n.code === 'de' ? 'KIG-Befund' : 'KIG Assessment',
					description,
					chart_data: JSON.stringify(payload),
					doctor_id: selectedDoctorId ?? undefined,
					is_locked: 1,
				});
			}

			resetForm();
			onSaved?.();
			open = false;
		} catch (e) {
			loadError = String(e);
		} finally {
			isSaving = false;
		}
	}

	function gradeLabel(grade: number): string {
		return grade >= 3 ? `${grade} ✓` : String(grade);
	}

	function gradeColor(grade: number, selected: boolean): string {
		if (!selected) return 'bg-background border border-border hover:bg-muted text-foreground';
		if (grade >= 3) return 'bg-amber-500 text-white border border-amber-600';
		return 'bg-primary text-primary-foreground border border-primary';
	}

	const selectCls = 'w-full h-8 px-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';
	const inputCls  = 'w-full h-8 px-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';
</script>

<Dialog bind:open>
	<DialogContent class="max-w-[820px] sm:max-w-[820px] max-h-[90vh] flex flex-col overflow-hidden">
		<DialogHeader class="shrink-0">
			<DialogTitle class="flex items-center gap-2">
				<svg class="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M9 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9"/>
					<polyline points="9 2 9 9 16 9"/>
					<line x1="12" y1="13" x2="12" y2="17"/>
					<line x1="10" y1="15" x2="14" y2="15"/>
				</svg>
				{dialogTitle}
				{#if isReadOnly}
					<span class="ml-2 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">
						{i18n.t.ortho.readOnly}
					</span>
				{/if}
			</DialogTitle>
		</DialogHeader>

		{#if loadError}
			<p class="text-destructive text-sm px-1">{loadError}</p>
		{/if}

		<div class="flex-1 overflow-y-auto space-y-4 pr-1 min-h-0">

			<!-- Row 1: Date + Doctor -->
			<div class="grid grid-cols-2 gap-3">
				<div class="space-y-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.ortho.examDate}</label>
					<input type="date" bind:value={examDate} class={inputCls} disabled={isReadOnly} />
				</div>
				<div class="space-y-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.ortho.doctor}</label>
					<select bind:value={selectedDoctorId} class={selectCls} disabled={isReadOnly}>
						<option value={null}>—</option>
						{#each doctors as d}
							<option value={d.id}>{d.name}</option>
						{/each}
					</select>
				</div>
			</div>

			<!-- Row 2: Dentition + Treatment phase + Angle class -->
			<div class="grid grid-cols-3 gap-3">
				<div class="space-y-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.ortho.dentitionStage}</label>
					<select bind:value={dentitionStage} class={selectCls} disabled={isReadOnly}>
						<option value="">—</option>
						<option value="primary">{i18n.t.ortho.dentitionOptions.primary}</option>
						<option value="mixed">{i18n.t.ortho.dentitionOptions.mixed}</option>
						<option value="permanent">{i18n.t.ortho.dentitionOptions.permanent}</option>
					</select>
				</div>
				<div class="space-y-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.ortho.treatmentPhase}</label>
					<select bind:value={treatmentPhase} class={selectCls} disabled={isReadOnly}>
						<option value="">—</option>
						<option value="expectative">{i18n.t.ortho.treatmentPhaseOptions.expectative}</option>
						<option value="early">{i18n.t.ortho.treatmentPhaseOptions.early}</option>
						<option value="main">{i18n.t.ortho.treatmentPhaseOptions.main}</option>
						<option value="adult">{i18n.t.ortho.treatmentPhaseOptions.adult}</option>
					</select>
				</div>
				<div class="space-y-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.ortho.angleClassLabel}</label>
					<select bind:value={angleClass} class={selectCls} disabled={isReadOnly}>
						<option value="">—</option>
						<option value="class_I">{i18n.t.ortho.angleClass.class_I}</option>
						<option value="class_II_div1">{i18n.t.ortho.angleClass.class_II_div1}</option>
						<option value="class_II_div2">{i18n.t.ortho.angleClass.class_II_div2}</option>
						<option value="class_III">{i18n.t.ortho.angleClass.class_III}</option>
					</select>
				</div>
			</div>

			<!-- Row 3: CVM + Facial profile -->
			<div class="grid grid-cols-3 gap-3">
				<div class="space-y-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.ortho.cvmStage}</label>
					<select bind:value={cvmStage} class={selectCls} disabled={isReadOnly}>
						<option value={0}>—</option>
						{#each [1,2,3,4,5,6] as n}
							<option value={n}>CVM {n}</option>
						{/each}
					</select>
				</div>
				<div class="space-y-1">
					<label class="text-xs font-medium text-muted-foreground">{i18n.t.ortho.facialProfile}</label>
					<select bind:value={facialProfile} class={selectCls} disabled={isReadOnly}>
						<option value="">—</option>
						<option value="straight">{i18n.t.ortho.facialProfileOptions.straight}</option>
						<option value="convex">{i18n.t.ortho.facialProfileOptions.convex}</option>
						<option value="concave">{i18n.t.ortho.facialProfileOptions.concave}</option>
					</select>
				</div>
			</div>

			<!-- Bad Habits -->
			<div class="border border-border rounded-lg p-3">
				<div class="text-xs font-semibold text-muted-foreground mb-2">{i18n.t.ortho.badHabitsLabel}</div>
				<div class="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto">
					{#each BAD_HABIT_KEYS as key}
						{@const isSelected = badHabits.includes(key)}
						<button
							type="button"
							disabled={isReadOnly}
							class="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors {isSelected ? 'bg-violet-500 text-white border-violet-600' : 'border-border bg-background hover:bg-muted text-foreground'} {isReadOnly ? 'opacity-70' : ''}"
							onclick={() => toggleHabit(key)}
						>
							{(i18n.t.ortho.badHabitOptions as Record<string,string>)[key]}
						</button>
					{/each}
				</div>
			</div>

			<!-- Biss section -->
			<div class="border border-border rounded-lg p-3">
				<div class="text-xs font-semibold text-muted-foreground mb-2">{i18n.t.ortho.bissTitle}</div>
				<div class="grid grid-cols-2 gap-4">
					{#each (['right', 'left'] as const) as side}
						{@const biss = side === 'right' ? bissRight : bissLeft}
						{@const sideLabel = side === 'right' ? i18n.t.ortho.bissRight : i18n.t.ortho.bissLeft}
						<div class="space-y-1.5">
							<div class="text-xs font-medium">{sideLabel}</div>
							<div class="flex flex-wrap gap-1 items-center">
								{#each (['neutral', 'distal', 'mesial'] as const) as type}
									<button
										type="button"
										disabled={isReadOnly}
										class="px-2 py-0.5 rounded text-xs font-medium border transition-colors {biss?.type === type ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:bg-muted text-foreground'} {isReadOnly ? 'opacity-70' : ''}"
										onclick={() => setBissType(side, type)}
									>
										{(i18n.t.ortho.bissTypes as Record<string,string>)[type]}
									</button>
								{/each}
								{#if biss && !isReadOnly}
									<button type="button" class="text-xs text-muted-foreground hover:text-foreground px-1" onclick={() => clearBiss(side)}>×</button>
								{/if}
							</div>
							{#if biss && biss.type !== 'neutral'}
								<div class="flex flex-wrap gap-1 items-center mt-1">
									{#each PB_OPTIONS as pb}
										<button
											type="button"
											disabled={isReadOnly}
											class="w-8 py-0.5 rounded text-[10px] font-mono border transition-colors {biss.praemolarenbreite === pb ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:bg-muted text-foreground'} {isReadOnly ? 'opacity-70' : ''}"
											onclick={() => setBissPb(side, pb)}
										>
											{pbLabel(pb)}
										</button>
									{/each}
									<span class="text-[10px] text-muted-foreground">{i18n.t.ortho.praemolarenbreiteShort}</span>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>

			<!-- KIG Groups table -->
			<div class="border border-border rounded-lg overflow-hidden">
				<table class="w-full text-sm">
					<thead>
						<tr class="bg-muted/50 border-b border-border">
							<th class="text-left text-xs font-medium text-muted-foreground px-3 py-2 w-8">Gr.</th>
							<th class="text-left text-xs font-medium text-muted-foreground px-3 py-2">Befund</th>
							<th class="text-left text-xs font-medium text-muted-foreground px-3 py-2">Grad</th>
							<th class="text-left text-xs font-medium text-muted-foreground px-2 py-2 w-24">mm</th>
						</tr>
					</thead>
					<tbody>
						{#each KIG_GROUPS as grp}
							{@const sel = selectedGrades[grp.code]}
							<tr class="border-b border-border/50 last:border-0 {sel ? 'bg-muted/30' : ''}">
								<td class="px-3 py-2 font-bold text-primary">{grp.code}</td>
								<td class="px-3 py-2 text-xs text-muted-foreground leading-snug max-w-[220px]">
									{(i18n.t.ortho.groups as Record<string, string>)[grp.code]}
								</td>
								<td class="px-3 py-2">
									<div class="flex flex-wrap gap-1">
										{#each grp.grades as opt}
											<button
												type="button"
												disabled={isReadOnly}
												class="px-2 py-0.5 rounded text-xs font-medium transition-colors {gradeColor(opt.grade, sel?.grade === opt.grade)} {isReadOnly ? 'opacity-70' : ''}"
												onclick={() => selectGrade(grp.code, opt.grade, opt.needsMm)}
												title={(i18n.t.ortho.grades as Record<string, string>)[opt.key]}
											>
												{gradeLabel(opt.grade)}
											</button>
										{/each}
									</div>
									{#if sel}
										<p class="text-[11px] text-muted-foreground mt-0.5 leading-snug">
											{(i18n.t.ortho.grades as Record<string, string>)[`${grp.code}${sel.grade}`] ?? ''}
										</p>
									{/if}
								</td>
								<td class="px-2 py-2">
									{#if sel && grp.grades.find((g) => g.grade === sel.grade)?.needsMm}
										<div class="flex items-center gap-1">
											<input
												type="number"
												step="0.1"
												min="0"
												disabled={isReadOnly}
												bind:value={sel.mm}
												class="w-14 h-6 px-1.5 text-xs border border-input rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring {isReadOnly ? 'opacity-70' : ''}"
											/>
											<span class="text-xs text-muted-foreground">{i18n.t.ortho.mmLabel}</span>
										</div>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Coverage badge -->
			<div class="flex items-center gap-2">
				{#if activeFindings.length === 0}
					<span class="text-muted-foreground text-xs">{i18n.t.ortho.noFindings}</span>
				{:else}
					<span class="px-2 py-0.5 rounded-full text-xs font-medium {isCovered ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-muted text-muted-foreground'}">
						{isCovered ? i18n.t.ortho.insuranceCovered : i18n.t.ortho.notCovered}
					</span>
					{#if leadingFinding()}
						<span class="text-xs text-muted-foreground">
							{i18n.t.ortho.leadingGroup}: <strong>{leadingFinding()!.group}{leadingFinding()!.grade}</strong>
						</span>
					{/if}
				{/if}
			</div>

			<!-- Notes (full width) -->
			<div class="space-y-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.common.notes}</label>
				<textarea
					bind:value={notes}
					rows={3}
					disabled={isReadOnly}
					class="w-full px-2 py-1.5 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none {isReadOnly ? 'opacity-70' : ''}"
				></textarea>
			</div>
		</div>

		<!-- Footer -->
		<div class="shrink-0 flex items-center justify-between pt-3 border-t border-border mt-2">
			<Button variant="outline" onclick={() => (open = false)}>
				{isReadOnly ? i18n.t.actions.close : i18n.t.actions.cancel}
			</Button>
			{#if !isReadOnly}
				<Button
					onclick={handleSave}
					disabled={isSaving || activeFindings.length === 0}
				>
					{isSaving ? '…' : i18n.t.ortho.saveAssessment}
				</Button>
			{/if}
		</div>
	</DialogContent>
</Dialog>
