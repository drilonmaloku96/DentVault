<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { i18n } from '$lib/i18n';
	import type { BissType, BissMeasurement, TimelineEntry, IOTNDHCFinding } from '$lib/types';
	import { getTimelineEntries, deleteTimelineEntry, insertTimelineEntry, getDoctors } from '$lib/services/db';
	import { formatDate } from '$lib/utils';
	import type { Doctor } from '$lib/types';
	import { untrack } from 'svelte';

	interface Props {
		patientId: string;
		open: boolean;
		existingEntry?: TimelineEntry | null;
		onSaved?: () => void;
	}

	let { patientId, open = $bindable(), existingEntry = null, onSaved }: Props = $props();

	// ── Grade derivation functions (condition → grade) ─────────────────
	function n(s: string): number { return parseFloat(s) || 0; }

	// O/a — Positive overjet
	function gradeA(mm: number, lipCompetent: boolean): number {
		if (mm <= 0)   return 0;
		if (mm > 9)    return 5;
		if (mm > 6)    return 4;
		if (mm > 3.5)  return lipCompetent ? 2 : 3;
		return 0;
	}

	// O/b + O/m — Reverse overjet (fused)
	// b = without masticatory difficulties, m = with difficulties
	// Same mm input; code and grade both derived from mm + difficulties
	function deriveBM(mm: number, difficulties: boolean): { code: 'b' | 'm'; grade: number } {
		if (mm <= 0) return { code: 'b', grade: 0 };
		if (mm > 3.5) return { code: difficulties ? 'm' : 'b', grade: difficulties ? 5 : 4 };
		if (mm > 1)   return { code: difficulties ? 'm' : 'b', grade: difficulties ? 4 : 3 };
		return { code: 'b', grade: 2 }; // 0–1 mm is always grade 2/b regardless of difficulties
	}

	// C/c — Crossbite (RCP/ICP discrepancy)
	function gradeC(mm: number): number {
		if (mm <= 0)  return 0;
		if (mm > 2)   return 4;
		if (mm > 1)   return 3;
		return 2;
	}

	// D/d — Contact point displacement
	function gradeD(mm: number): number {
		if (mm <= 0)  return 0;
		if (mm > 4)   return 4;
		if (mm > 2)   return 3;
		if (mm > 1)   return 2;
		return 1;
	}

	// O/e — Open bite (vertical distance)
	function gradeE(mm: number): number {
		if (mm <= 1)  return 0;
		if (mm > 4)   return 4;
		if (mm > 2)   return 3;
		return 2;
	}

	const BAD_HABIT_KEYS = ['thumbSucking', 'tongueThrusting', 'mouthBreathing', 'lipBiting', 'nailBiting', 'bruxism', 'pacifierUse', 'penChewing'] as const;

	// ── State ──────────────────────────────────────────────────────────
	let doctors          = $state<Doctor[]>([]);
	let isSaving         = $state(false);
	let loadError        = $state('');
	const today          = new Date().toISOString().slice(0, 10);
	let allSnapshots     = $state<TimelineEntry[]>([]);
	let selectedSnapshot = $state<TimelineEntry | null>(null); // null = new assessment mode

	// Read-only when viewing a historical snapshot
	const isReadOnly = $derived(selectedSnapshot !== null);

	// Clinical context
	let examDate         = $state(today);
	let selectedDoctorId = $state<number | null>(null);
	let notes            = $state('');
	let dentitionStage   = $state('');
	let treatmentPhase   = $state('');
	let angleClass       = $state('');
	let cvmStage         = $state(0);
	let facialProfile    = $state('');
	let badHabits        = $state<string[]>([]);

	// DHC per-condition measurement state
	// i/h use direct level (maps straight to a grade); others use mm + optional flags
	let meas = $state({
		i: { level: 0 as 0|4|5 },          // M/i — missing/retained (grade 4=1/quad, 5=2+/quad)
		h: { level: 0 as 0|3|4 },          // M/h — hypodontia needing ortho (grade 3=1/quad, 4=2+/quad)
		a: { mm: '', lipCompetent: true },  // O/a — positive overjet
		bm: { mm: '', difficulties: false }, // O/b+m — reverse overjet (b=no difficulties, m=with difficulties)
		c: { mm: '' },                      // C/c — crossbite RCP/ICP discrepancy
		d: { mm: '' },                      // D/d — contact point displacement
		e: { mm: '' },                      // O/e — open bite vertical distance
		f: { level: 0 as 0|2|3|4 },        // O/f — deep overbite (0=none, 2=≥3.5mm no contact, 3=complete+gingival, 4=complete+trauma)
		g: false,                           // Sn/g — pre/postnormal to ½ PMB (grade 1)
		l: false,                           // Sn/l — scissor bite 4–7 (grade 4)
		p: false,                           // Sn/p — LKG cleft lip/palate (grade 5)
		s: false,                           // Sn/s — submerged primary, adjacent tipping (grade 5)
		t: false,                           // Sn/t — partially erupted, tipped against adjacent (grade 4)
		x: false,                           // Sn/x — supernumerary tooth (grade 5)
	});

	// AC (Aesthetic Component)
	let acGrade = $state(0);

	// Bite (sagittal relationship)
	const PB_OPTIONS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const;
	let bissRight = $state<BissMeasurement | null>(null);
	let bissLeft  = $state<BissMeasurement | null>(null);

	// ── Grade derivation per condition ────────────────────────────────
	const bmResult = $derived(deriveBM(n(meas.bm.mm), meas.bm.difficulties));

	const allGrades = $derived({
		i:  meas.i.level as number,
		h:  meas.h.level as number,
		a:  gradeA(n(meas.a.mm), meas.a.lipCompetent),
		bm: bmResult.grade,
		c: gradeC(n(meas.c.mm)),
		d: gradeD(n(meas.d.mm)),
		e: gradeE(n(meas.e.mm)),
		f: meas.f.level as number,
		g: meas.g ? 1 : 0,
		l: meas.l ? 4 : 0,
		p: meas.p ? 5 : 0,
		s: meas.s ? 5 : 0,
		t: meas.t ? 4 : 0,
		x: meas.x ? 5 : 0,
	});

	// Worst (leading) finding
	const dhcResult = $derived.by(() => {
		let bestGrade = 0;
		let bestKey   = '';
		for (const [key, grade] of Object.entries(allGrades)) {
			if (grade > bestGrade) { bestGrade = grade; bestKey = key; }
		}
		// Remap 'bm' to the actual subcategory code derived from mm + difficulties
		const bestCode = bestKey === 'bm' ? bmResult.code : bestKey;
		const mmVal = (() => {
			if (bestKey === 'a')  return n(meas.a.mm) || null;
			if (bestKey === 'bm') return n(meas.bm.mm) || null;
			if (bestKey === 'c')  return n(meas.c.mm) || null;
			if (bestKey === 'd')  return n(meas.d.mm) || null;
			if (bestKey === 'e')  return n(meas.e.mm) || null;
			return null;
		})();
		return { grade: bestGrade as 0|1|2|3|4|5, code: bestCode, mm_value: mmVal };
	});

	const dhcFinding = $derived<IOTNDHCFinding | null>(
		dhcResult.grade > 0
			? { grade: dhcResult.grade as 1|2|3|4|5, subcategory: dhcResult.code, mm_value: dhcResult.mm_value }
			: null
	);

	const iotnScoreLabel = $derived(() => {
		const parts: string[] = [];
		if (dhcFinding) {
			const mm = dhcFinding.mm_value != null ? ` ${dhcFinding.mm_value}mm` : '';
			parts.push(`DHC ${dhcFinding.subcategory.toUpperCase()}/${dhcFinding.grade}${mm}`);
		}
		if (acGrade > 0) parts.push(`AC ${acGrade}`);
		return parts.join(' · ');
	});

	const dialogTitle = $derived(
		selectedSnapshot
			? `IOTN – ${formatDate(selectedSnapshot.entry_date)}`
			: `IOTN – ${i18n.t.ortho.newAssessment}`
	);

	// ── Styling helpers ────────────────────────────────────────────────
	function gradeBadgeCls(g: number): string {
		if (g === 0) return 'bg-muted/60 text-muted-foreground/50';
		if (g === 1) return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
		if (g === 2) return 'bg-lime-100 text-lime-800 dark:bg-lime-900/40 dark:text-lime-300';
		if (g === 3) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
		if (g === 4) return 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300';
		return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
	}

	const ROD = (disabled: boolean) => disabled ? 'opacity-60 cursor-default' : 'cursor-pointer';

	// Segmented button (used for count/level selectors)
	function segBtn(active: boolean, disabled: boolean, extra = ''): string {
		return `px-2.5 py-0.5 rounded text-xs font-medium border transition-colors ${extra}
			${active ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:bg-muted text-foreground'}
			${ROD(disabled)}`;
	}

	function mmInput(disabled: boolean): string {
		return `w-16 h-7 px-2 text-sm text-center border border-input rounded-md bg-background
			focus:outline-none focus:ring-1 focus:ring-ring ${ROD(disabled)}`;
	}

	function acColor(g: number, selected: boolean): string {
		if (!selected) {
			if (g <= 4) return 'border-emerald-200 hover:bg-emerald-50 dark:border-emerald-800 dark:hover:bg-emerald-900/20';
			if (g <= 7) return 'border-yellow-200 hover:bg-yellow-50 dark:border-yellow-800 dark:hover:bg-yellow-900/20';
			return 'border-red-200 hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-900/20';
		}
		if (g <= 4) return 'bg-emerald-500 text-white border-emerald-600 shadow-sm';
		if (g <= 7) return 'bg-yellow-500 text-white border-yellow-600 shadow-sm';
		return 'bg-red-600 text-white border-red-700 shadow-sm';
	}

	// ── Data load ──────────────────────────────────────────────────────
	$effect(() => { if (open) untrack(() => loadData()); });

	function resetMeas() {
		meas.i.level = 0; meas.h.level = 0;
		meas.a.mm = ''; meas.a.lipCompetent = true;
		meas.bm.mm = ''; meas.bm.difficulties = false;
		meas.c.mm = ''; meas.d.mm = ''; meas.e.mm = '';
		meas.f.level = 0;
		meas.g = false; meas.l = false; meas.p = false;
		meas.s = false; meas.t = false; meas.x = false;
	}

	function resetForm() {
		examDate = today; selectedDoctorId = null; notes = '';
		dentitionStage = ''; treatmentPhase = ''; angleClass = '';
		cvmStage = 0; facialProfile = ''; badHabits = [];
		acGrade = 0; bissRight = null; bissLeft = null;
		resetMeas();
	}

	function populateFromPayload(data: Record<string, unknown>, date: string) {
		examDate         = date;
		selectedDoctorId = (data.doctor_id as number | null) ?? null;
		dentitionStage   = (data.dentition_stage as string) ?? '';
		treatmentPhase   = (data.treatment_phase as string) ?? '';
		angleClass       = (data.angle_class as string) ?? '';
		cvmStage         = (data.cvm_stage as number) ?? 0;
		facialProfile    = (data.facial_profile as string) ?? '';
		notes            = (data.notes as string) ?? '';
		badHabits        = Array.isArray(data.bad_habits) ? (data.bad_habits as string[]) : [];
		bissRight        = (data.biss_right as BissMeasurement | null) ?? null;
		bissLeft         = (data.biss_left as BissMeasurement | null) ?? null;
		acGrade          = (data.ac_grade as number) ?? 0;

		resetMeas();
		const m = data.dhc_measurements as Record<string, unknown> | undefined;
		if (m) {
			meas.i.level = (m.i as any)?.level ?? 0;
			meas.h.level = (m.h as any)?.level ?? 0;
			if (m.a) { meas.a.mm = String((m.a as any).mm ?? ''); meas.a.lipCompetent = (m.a as any).lipCompetent ?? true; }
			// Support both old separate b/m keys and new fused bm key
			const bmSaved = (m.bm ?? m.b ?? m.m) as any;
			if (bmSaved) { meas.bm.mm = String(bmSaved.mm ?? ''); meas.bm.difficulties = bmSaved.difficulties ?? false; }
			if (m.c) meas.c.mm = String((m.c as any).mm ?? '');
			if (m.d) meas.d.mm = String((m.d as any).mm ?? '');
			if (m.e) meas.e.mm = String((m.e as any).mm ?? '');
			meas.f.level = (m.f as any)?.level ?? 0;
			meas.g = !!(m.g); meas.l = !!(m.l); meas.p = !!(m.p);
			meas.s = !!(m.s); meas.t = !!(m.t); meas.x = !!(m.x);
		}
	}

	function snapshotOptionLabel(entry: TimelineEntry): string {
		const date = formatDate(entry.entry_date);
		try {
			const d = JSON.parse(entry.chart_data!) as Record<string, unknown>;
			const dhc = d.dhc as IOTNDHCFinding | undefined;
			const ac  = d.ac_grade as number | undefined;
			const parts: string[] = [];
			if (dhc) {
				const mm = dhc.mm_value != null ? ` ${dhc.mm_value}mm` : '';
				parts.push(`DHC ${dhc.subcategory.toUpperCase()}/${dhc.grade}${mm}`);
			}
			if (ac) parts.push(`AC ${ac}`);
			return parts.length ? `${date} — ${parts.join(' · ')}` : date;
		} catch { return date; }
	}

	function selectSnapshot(entry: TimelineEntry | null) {
		if (entry === null) {
			selectedSnapshot = null;
			resetForm();
			// Pre-fill all fields from most recent snapshot as starting point
			const last = allSnapshots[0];
			if (last) {
				populateFromPayload(JSON.parse(last.chart_data!) as Record<string, unknown>, today);
				examDate = today;
			}
		} else {
			selectedSnapshot = entry;
			populateFromPayload(JSON.parse(entry.chart_data!) as Record<string, unknown>, entry.entry_date);
		}
	}

	async function loadData() {
		loadError = '';
		try {
			doctors = await getDoctors();
			const all = await getTimelineEntries(patientId);
			allSnapshots = all
				.filter(e => e.entry_type === 'ortho_snapshot' && e.chart_data)
				.sort((a, b) => b.entry_date.localeCompare(a.entry_date));

			if (existingEntry?.chart_data) {
				// Opened by clicking an existing card — show that entry
				selectedSnapshot = existingEntry;
				populateFromPayload(JSON.parse(existingEntry.chart_data) as Record<string, unknown>, existingEntry.entry_date);
			} else {
				// New assessment — pre-fill ALL fields from the most recent snapshot
				selectedSnapshot = null;
				resetForm();
				const last = allSnapshots[0];
				if (last) {
					populateFromPayload(JSON.parse(last.chart_data!) as Record<string, unknown>, today);
					examDate = today; // Always today for new entries
				}
			}
		} catch (e) { loadError = String(e); }
	}

	// ── Interactions ───────────────────────────────────────────────────
	function toggleHabit(key: string) {
		if (isReadOnly) return;
		badHabits = badHabits.includes(key) ? badHabits.filter(h => h !== key) : [...badHabits, key];
	}

	function setBissType(side: 'right' | 'left', type: BissType) {
		if (isReadOnly) return;
		const cur = side === 'right' ? bissRight : bissLeft;
		const v: BissMeasurement = { type, praemolarenbreite: type === 'neutral' ? null : (cur?.praemolarenbreite ?? 0.5) };
		if (side === 'right') bissRight = v; else bissLeft = v;
	}

	function clearBiss(side: 'right' | 'left') {
		if (isReadOnly) return;
		if (side === 'right') bissRight = null; else bissLeft = null;
	}

	function setBissPb(side: 'right' | 'left', pb: number) {
		if (isReadOnly) return;
		if (side === 'right' && bissRight) bissRight.praemolarenbreite = pb;
		else if (side === 'left' && bissLeft) bissLeft.praemolarenbreite = pb;
	}

	function pbLabel(v: number): string {
		const frac: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
		const whole = Math.floor(v); const dec = +(v - whole).toFixed(2);
		return whole > 0 ? whole + (frac[dec] ?? '') : (frac[dec] ?? String(v));
	}

	// ── Save ───────────────────────────────────────────────────────────
	async function handleSave() {
		if (isSaving || isReadOnly) return;
		isSaving = true; loadError = '';
		try {
			// Build compact measurements snapshot (omit zero/false entries)
			const dhcMeasurements: Record<string, unknown> = {};
			if (meas.i.level) dhcMeasurements.i = { level: meas.i.level };
			if (meas.h.level) dhcMeasurements.h = { level: meas.h.level };
			if (meas.a.mm)    dhcMeasurements.a = { mm: n(meas.a.mm), lipCompetent: meas.a.lipCompetent };
			if (meas.bm.mm)   dhcMeasurements.bm = { mm: n(meas.bm.mm), difficulties: meas.bm.difficulties };
			if (meas.c.mm)    dhcMeasurements.c = { mm: n(meas.c.mm) };
			if (meas.d.mm)    dhcMeasurements.d = { mm: n(meas.d.mm) };
			if (meas.e.mm)    dhcMeasurements.e = { mm: n(meas.e.mm) };
			if (meas.f.level) dhcMeasurements.f = { level: meas.f.level };
			if (meas.g) dhcMeasurements.g = true;
			if (meas.l) dhcMeasurements.l = true;
			if (meas.p) dhcMeasurements.p = true;
			if (meas.s) dhcMeasurements.s = true;
			if (meas.t) dhcMeasurements.t = true;
			if (meas.x) dhcMeasurements.x = true;

			const payload = {
				exam_date: examDate, doctor_id: selectedDoctorId,
				dhc: dhcFinding, dhc_measurements: dhcMeasurements,
				ac_grade: acGrade, notes,
				dentition_stage: dentitionStage, treatment_phase: treatmentPhase,
				angle_class: angleClass, cvm_stage: cvmStage, facial_profile: facialProfile,
				bad_habits: badHabits, biss_right: bissRight, biss_left: bissLeft,
			};

			// Always save as a new entry; dedup same-date entries
			const existing = await getTimelineEntries(patientId);
			for (const old of existing.filter(e => e.entry_type === 'ortho_snapshot' && e.entry_date === examDate))
				await deleteTimelineEntry(old.id);
			await insertTimelineEntry(patientId, {
				entry_date: examDate, entry_type: 'ortho_snapshot',
				title: 'IOTN Assessment',
				description: iotnScoreLabel() || 'IOTN Assessment',
				chart_data: JSON.stringify(payload),
				doctor_id: selectedDoctorId ?? undefined, is_locked: 1,
			});
			resetForm(); onSaved?.(); open = false;
		} catch (e) { loadError = String(e); }
		finally { isSaving = false; }
	}

	const canSave = $derived(dhcResult.grade > 0 || acGrade > 0);

	const selectCls = 'w-full h-8 px-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60';
	const inputCls  = 'w-full h-8 px-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60';
</script>

<Dialog bind:open>
	<DialogContent class="max-w-[900px] sm:max-w-[900px] max-h-[90vh] flex flex-col overflow-hidden">
		<DialogHeader class="shrink-0">
			<DialogTitle class="flex items-center gap-2">
				<svg class="w-5 h-5 text-violet-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M9 2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9"/>
					<polyline points="9 2 9 9 16 9"/><line x1="12" y1="13" x2="12" y2="17"/><line x1="10" y1="15" x2="14" y2="15"/>
				</svg>
				{dialogTitle}
				{#if isReadOnly}
					<span class="ml-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-muted text-muted-foreground">{i18n.t.ortho.readOnly}</span>
				{/if}
			</DialogTitle>
		</DialogHeader>

		{#if loadError}
			<p class="text-destructive text-sm px-1 shrink-0">{loadError}</p>
		{/if}

		<div class="flex-1 overflow-y-auto space-y-3 pr-1 min-h-0">

			<!-- History dropdown -->
			{#if allSnapshots.length > 0}
			<div class="flex items-center gap-2 bg-muted/30 rounded-lg px-3 py-2 -mx-0.5 shrink-0">
				<span class="text-xs font-medium text-muted-foreground shrink-0">{i18n.t.ortho.historyDropdownLabel}:</span>
				<select
					class="flex-1 h-7 px-2 text-xs border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
					value={selectedSnapshot ? String(selectedSnapshot.id) : 'new'}
					onchange={(e) => {
						const val = (e.currentTarget as HTMLSelectElement).value;
						if (val === 'new') selectSnapshot(null);
						else {
							const found = allSnapshots.find(s => String(s.id) === val);
							if (found) selectSnapshot(found);
						}
					}}>
					<option value="new">{i18n.t.ortho.newAssessmentOption}</option>
					{#each allSnapshots as snap}
						<option value={String(snap.id)}>{snapshotOptionLabel(snap)}</option>
					{/each}
				</select>
			</div>
			{/if}

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
						{#each doctors as d}<option value={d.id}>{d.name}</option>{/each}
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
						{#each [1,2,3,4,5,6] as s}<option value={s}>CVM {s}</option>{/each}
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

			<!-- ═══════════════════════════════════════════════════════════
			     DHC — condition-first table
			     Each row: [code badge | condition name | measurement | grade]
			     Grade is auto-derived from the measurement inputs.
			     ═══════════════════════════════════════════════════════════ -->
			<div class="border border-border rounded-lg overflow-hidden">

				<!-- DHC header -->
				<div class="bg-muted/40 px-3 py-2 border-b border-border flex items-center justify-between">
					<span class="text-xs font-semibold text-foreground">{i18n.t.ortho.dhcTitle}</span>
					{#if dhcResult.grade > 0}
						<div class="flex items-center gap-1.5">
							<span class="text-[11px] text-muted-foreground">Leading:</span>
							<span class="font-mono text-xs font-bold px-2 py-0.5 rounded {gradeBadgeCls(dhcResult.grade)}">
								{dhcResult.code.toUpperCase()} · Grade {dhcResult.grade}
								{#if dhcResult.mm_value != null} · {dhcResult.mm_value} mm{/if}
							</span>
						</div>
					{:else}
						<span class="text-[11px] text-muted-foreground/50">No finding recorded yet</span>
					{/if}
				</div>

				<!-- Condition rows -->
				<div class="divide-y divide-border/40 text-sm">

					<!-- ── Group M: Missing / Retained ─────────────────── -->
					<div class="px-3 py-1.5 bg-emerald-50/60 dark:bg-emerald-950/10 border-b border-border/30">
						<span class="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 tracking-wider uppercase">{i18n.t.ortho.iotnGroupM}</span>
						<p class="text-[10px] text-emerald-700/60 dark:text-emerald-400/60 italic mt-0.5">{i18n.t.ortho.iotnNotScoredM}</p>
					</div>

					<!-- M/i: Retained teeth -->
					<div class="px-3 py-2.5 flex items-start gap-3">
						<div class="flex items-center gap-1.5 w-[248px] shrink-0">
							<span class="px-1.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">i</span>
							<span class="text-xs font-medium text-foreground leading-tight">{i18n.t.ortho.iotnRetainedTeeth}</span>
							<span class="text-[10px] text-muted-foreground shrink-0">(7–7)</span>
						</div>
						<div class="flex-1 flex flex-col gap-1 min-w-0">
							<div class="flex items-center gap-1.5">
								<span class="text-[11px] text-muted-foreground shrink-0">{i18n.t.ortho.iotnPerQuadrant}</span>
								{#each ([0, 4, 5] as const) as level}
									<button disabled={isReadOnly} class={segBtn(meas.i.level === level, isReadOnly)}
										onclick={() => { if (!isReadOnly) meas.i.level = level; }}>
										{level === 0 ? i18n.t.ortho.iotnNone : level === 4 ? i18n.t.ortho.iotnOneTooth : i18n.t.ortho.iotnTwoOrMore}
									</button>
								{/each}
							</div>
							{#if meas.i.level === 4}
								<p class="text-[10px] text-muted-foreground/70 italic">{i18n.t.ortho.iotnRetainedHint}</p>
							{/if}
						</div>
						<div class="w-12 flex justify-end shrink-0 pt-0.5">
							<span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded {gradeBadgeCls(allGrades.i)}">
								{allGrades.i > 0 ? allGrades.i : '—'}
							</span>
						</div>
					</div>

					<!-- M/h: Hypodontia -->
					<div class="px-3 py-2.5 flex items-start gap-3">
						<div class="flex items-center gap-1.5 w-[248px] shrink-0">
							<span class="px-1.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">h</span>
							<span class="text-xs font-medium text-foreground leading-tight">{i18n.t.ortho.iotnHypodontia}</span>
							<span class="text-[10px] text-muted-foreground shrink-0">(7–7)</span>
						</div>
						<div class="flex-1 flex flex-col gap-1 min-w-0">
							<div class="flex items-center gap-1.5">
								<span class="text-[11px] text-muted-foreground shrink-0">{i18n.t.ortho.iotnPerQuadrant}</span>
								{#each ([0, 3, 4] as const) as level}
									<button disabled={isReadOnly} class={segBtn(meas.h.level === level, isReadOnly)}
										onclick={() => { if (!isReadOnly) meas.h.level = level; }}>
										{level === 0 ? i18n.t.ortho.iotnNone : level === 3 ? i18n.t.ortho.iotnOneTooth : i18n.t.ortho.iotnTwoOrMore}
									</button>
								{/each}
							</div>
						</div>
						<div class="w-12 flex justify-end shrink-0 pt-0.5">
							<span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded {gradeBadgeCls(allGrades.h)}">
								{allGrades.h > 0 ? allGrades.h : '—'}
							</span>
						</div>
					</div>

					<!-- ── Group O: Sagittal (Overjet) ─────────────────── -->
					<div class="px-3 py-1 bg-orange-50/60 dark:bg-orange-950/10">
						<span class="text-[10px] font-bold text-orange-700 dark:text-orange-400 tracking-wider uppercase">{i18n.t.ortho.iotnGroupOSagittal}</span>
					</div>

					<!-- O/a: Positive overjet -->
					<div class="px-3 py-2.5 flex items-start gap-3">
						<div class="flex items-center gap-1.5 w-[248px] shrink-0">
							<span class="px-1.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">a</span>
							<span class="text-xs font-medium text-foreground">{i18n.t.ortho.iotnPositiveOverjet}</span>
							<span class="text-[10px] text-muted-foreground shrink-0">(2–2)</span>
						</div>
						<div class="flex-1 flex flex-col gap-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<input type="number" step="0.5" min="0" placeholder="0.0" disabled={isReadOnly}
									bind:value={meas.a.mm} class={mmInput(isReadOnly)} />
								<span class="text-[11px] text-muted-foreground">mm</span>
								<div class="flex gap-1 ml-1">
									{#each ([{ val: true, label: i18n.t.ortho.iotnCompetentLips }, { val: false, label: i18n.t.ortho.iotnIncompetentLips }]) as opt}
										<button disabled={isReadOnly}
											class="px-2 py-0.5 rounded text-xs font-medium border transition-colors
												{meas.a.lipCompetent === opt.val
													? (opt.val ? 'bg-primary text-primary-foreground border-primary' : 'bg-orange-500 text-white border-orange-600')
													: 'border-border bg-background hover:bg-muted text-foreground'}
												{ROD(isReadOnly)}"
											onclick={() => { if (!isReadOnly) meas.a.lipCompetent = opt.val; }}>
											{opt.label}
										</button>
									{/each}
								</div>
							</div>
							{#if allGrades.a > 0}
								<p class="text-[10px] text-muted-foreground/70">
									{allGrades.a === 2 ? i18n.t.ortho.dhcSubcategories['2a']
									: allGrades.a === 3 ? i18n.t.ortho.dhcSubcategories['3a']
									: allGrades.a === 4 ? i18n.t.ortho.dhcSubcategories['4a']
									: i18n.t.ortho.dhcSubcategories['5a']}
								</p>
							{/if}
							<p class="text-[10px] text-muted-foreground/50 italic">{i18n.t.ortho.iotnEvalGreatestPositive}</p>
						</div>
						<div class="w-12 flex justify-end shrink-0 pt-0.5">
							<span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded {gradeBadgeCls(allGrades.a)}">
								{allGrades.a > 0 ? allGrades.a : '—'}
							</span>
						</div>
					</div>

					<!-- O/b+m: Reverse overjet (fused) -->
					<div class="px-3 py-2.5 flex items-start gap-3">
						<div class="flex items-center gap-1.5 w-[248px] shrink-0">
							<!-- Show derived code badge reactively -->
							<span class="px-1.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
								{bmResult.grade > 0 ? bmResult.code : 'b/m'}
							</span>
							<span class="text-xs font-medium text-foreground">{i18n.t.ortho.iotnReverseOverjet}</span>
							<span class="text-[10px] text-muted-foreground shrink-0">(2–2)</span>
						</div>
						<div class="flex-1 flex flex-col gap-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<input type="number" step="0.5" min="0" placeholder="0.0" disabled={isReadOnly}
									bind:value={meas.bm.mm} class={mmInput(isReadOnly)} />
								<span class="text-[11px] text-muted-foreground">mm</span>
								<div class="flex gap-1 ml-1">
									{#each ([{ val: false, label: i18n.t.ortho.iotnNoMasticatoryDiff }, { val: true, label: i18n.t.ortho.iotnWithDifficulties }]) as opt}
										<button disabled={isReadOnly}
											class="px-2 py-0.5 rounded text-xs font-medium border transition-colors
												{meas.bm.difficulties === opt.val
													? (opt.val ? 'bg-red-500 text-white border-red-600' : 'bg-primary text-primary-foreground border-primary')
													: 'border-border bg-background hover:bg-muted text-foreground'}
												{ROD(isReadOnly)}"
											onclick={() => { if (!isReadOnly) meas.bm.difficulties = opt.val; }}>
											{opt.label}
										</button>
									{/each}
								</div>
							</div>
							{#if bmResult.grade > 0}
								<p class="text-[10px] text-muted-foreground/70">
									{bmResult.grade === 2 ? i18n.t.ortho.dhcSubcategories['2b']
									: bmResult.grade === 3 ? i18n.t.ortho.dhcSubcategories['3b']
									: bmResult.grade === 4 && !meas.bm.difficulties ? i18n.t.ortho.dhcSubcategories['4b']
									: bmResult.grade === 4 ? i18n.t.ortho.iotnBm4mDesc
									: i18n.t.ortho.dhcSubcategories['5m']}
								</p>
							{/if}
							<p class="text-[10px] text-muted-foreground/50 italic">{i18n.t.ortho.iotnEvalGreatestNegative}</p>
						</div>
						<div class="w-12 flex justify-end shrink-0 pt-0.5">
							<span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded {gradeBadgeCls(allGrades.bm)}">
								{allGrades.bm > 0 ? allGrades.bm : '—'}
							</span>
						</div>
					</div>

					<!-- ── Group C: Crossbite ───────────────────────────── -->
					<div class="px-3 py-1 bg-blue-50/60 dark:bg-blue-950/10">
						<span class="text-[10px] font-bold text-blue-700 dark:text-blue-400 tracking-wider uppercase">{i18n.t.ortho.iotnGroupC}</span>
					</div>

					<!-- C/c: Crossbite -->
					<div class="px-3 py-2.5 flex items-start gap-3">
						<div class="flex items-center gap-1.5 w-[248px] shrink-0">
							<span class="px-1.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">c</span>
							<span class="text-xs font-medium text-foreground">{i18n.t.ortho.iotnCrossbiteLabel}</span>
							<span class="text-[10px] text-muted-foreground shrink-0">(7–7)</span>
						</div>
						<div class="flex-1 flex flex-col gap-1 min-w-0">
							<div class="flex items-center gap-2">
								<input type="number" step="0.5" min="0" placeholder="0.0" disabled={isReadOnly}
									bind:value={meas.c.mm} class={mmInput(isReadOnly)} />
								<span class="text-[11px] text-muted-foreground">{i18n.t.ortho.iotnMmDiscrepancy}</span>
							</div>
							{#if allGrades.c > 0}
								<p class="text-[10px] text-muted-foreground/70">
									{allGrades.c === 2 ? i18n.t.ortho.dhcSubcategories['2c'] : allGrades.c === 3 ? i18n.t.ortho.dhcSubcategories['3c'] : i18n.t.ortho.dhcSubcategories['4c']}
								</p>
							{/if}
						</div>
						<div class="w-12 flex justify-end shrink-0 pt-0.5">
							<span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded {gradeBadgeCls(allGrades.c)}">
								{allGrades.c > 0 ? allGrades.c : '—'}
							</span>
						</div>
					</div>

					<!-- ── Group D: Contact point displacement ─────────── -->
					<div class="px-3 py-1 bg-purple-50/60 dark:bg-purple-950/10">
						<span class="text-[10px] font-bold text-purple-700 dark:text-purple-400 tracking-wider uppercase">{i18n.t.ortho.iotnGroupD}</span>
					</div>

					<!-- D/d: Contact point displacement -->
					<div class="px-3 py-2.5 flex items-start gap-3">
						<div class="flex items-center gap-1.5 w-[248px] shrink-0">
							<span class="px-1.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">d</span>
							<span class="text-xs font-medium text-foreground">{i18n.t.ortho.iotnContactDisplacement}</span>
							<span class="text-[10px] text-muted-foreground shrink-0">(8–8)</span>
						</div>
						<div class="flex-1 flex flex-col gap-1 min-w-0">
							<div class="flex items-center gap-2">
								<input type="number" step="0.5" min="0" placeholder="0.0" disabled={isReadOnly}
									bind:value={meas.d.mm} class={mmInput(isReadOnly)} />
								<span class="text-[11px] text-muted-foreground">{i18n.t.ortho.iotnMmContactToContact}</span>
							</div>
							{#if allGrades.d > 0}
								<p class="text-[10px] text-muted-foreground/70">
									{allGrades.d === 1 ? '≤ 1 mm'
									: allGrades.d === 2 ? i18n.t.ortho.dhcSubcategories['2d']
									: allGrades.d === 3 ? i18n.t.ortho.dhcSubcategories['3d']
									: i18n.t.ortho.dhcSubcategories['4d']}
								</p>
							{/if}
							<p class="text-[10px] text-muted-foreground/50 italic">{i18n.t.ortho.iotnNotScoredD}</p>
						</div>
						<div class="w-12 flex justify-end shrink-0 pt-0.5">
							<span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded {gradeBadgeCls(allGrades.d)}">
								{allGrades.d > 0 ? allGrades.d : '—'}
							</span>
						</div>
					</div>

					<!-- ── Group O: Vertical (Overbite) ───────────────── -->
					<div class="px-3 py-1 bg-orange-50/60 dark:bg-orange-950/10">
						<span class="text-[10px] font-bold text-orange-700 dark:text-orange-400 tracking-wider uppercase">{i18n.t.ortho.iotnGroupOVertical}</span>
					</div>

					<!-- O/f: Deep overbite -->
					<div class="px-3 py-2.5 flex items-start gap-3">
						<div class="flex items-center gap-1.5 w-[248px] shrink-0">
							<span class="px-1.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">f</span>
							<span class="text-xs font-medium text-foreground">{i18n.t.ortho.iotnDeepOverbite}</span>
							<span class="text-[10px] text-muted-foreground shrink-0">(3–3)</span>
						</div>
						<div class="flex-1 flex flex-wrap gap-1.5 min-w-0">
							{#each ([
								{ level: 0 as 0|2|3|4, label: i18n.t.ortho.iotnNone },
								{ level: 2 as 0|2|3|4, label: i18n.t.ortho.iotnOverbiteNoGingival },
								{ level: 3 as 0|2|3|4, label: i18n.t.ortho.iotnOverbiteGingival },
								{ level: 4 as 0|2|3|4, label: i18n.t.ortho.iotnOverbiteTrauma },
							]) as opt}
								<button disabled={isReadOnly}
									class="px-2.5 py-1 rounded text-xs font-medium border transition-colors
										{meas.f.level === opt.level
											? opt.level === 0 ? 'bg-muted text-muted-foreground border-border'
											: opt.level === 2 ? 'bg-lime-500 text-white border-lime-600'
											: opt.level === 3 ? 'bg-yellow-500 text-white border-yellow-600'
											: 'bg-orange-500 text-white border-orange-600'
											: 'border-border bg-background hover:bg-muted text-foreground'}
										{ROD(isReadOnly)}"
									onclick={() => { if (!isReadOnly) meas.f.level = opt.level; }}>
									{opt.label}
								</button>
							{/each}
						</div>
						<div class="w-12 flex justify-end shrink-0 pt-0.5">
							<span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded {gradeBadgeCls(allGrades.f)}">
								{allGrades.f > 0 ? allGrades.f : '—'}
							</span>
						</div>
					</div>

					<!-- O/e: Open bite -->
					<div class="px-3 py-2.5 flex items-start gap-3">
						<div class="flex items-center gap-1.5 w-[248px] shrink-0">
							<span class="px-1.5 rounded text-[10px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">e</span>
							<span class="text-xs font-medium text-foreground">{i18n.t.ortho.iotnOpenBite}</span>
							<span class="text-[10px] text-muted-foreground shrink-0">(7–7)</span>
						</div>
						<div class="flex-1 flex flex-col gap-1 min-w-0">
							<div class="flex items-center gap-2">
								<input type="number" step="0.5" min="0" placeholder="0.0" disabled={isReadOnly}
									bind:value={meas.e.mm} class={mmInput(isReadOnly)} />
								<span class="text-[11px] text-muted-foreground">{i18n.t.ortho.iotnMmVerticalDistance}</span>
							</div>
							{#if allGrades.e > 0}
								<p class="text-[10px] text-muted-foreground/70">
									{allGrades.e === 2 ? i18n.t.ortho.dhcSubcategories['2e'] : allGrades.e === 3 ? i18n.t.ortho.dhcSubcategories['3e'] : i18n.t.ortho.dhcSubcategories['4e']}
								</p>
							{/if}
							<p class="text-[10px] text-muted-foreground/50 italic">{i18n.t.ortho.iotnEvalGreatestVertical}</p>
						</div>
						<div class="w-12 flex justify-end shrink-0 pt-0.5">
							<span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded {gradeBadgeCls(allGrades.e)}">
								{allGrades.e > 0 ? allGrades.e : '—'}
							</span>
						</div>
					</div>

					<!-- ── Sonstiges (Other) ────────────────────────────── -->
					<div class="px-3 py-1 bg-muted/30">
						<span class="text-[10px] font-bold text-muted-foreground tracking-wider uppercase">{i18n.t.ortho.iotnGroupOther}</span>
					</div>

					<!-- Sonstiges: binary conditions in a compact 2-col grid -->
					<div class="px-3 py-2.5 grid grid-cols-2 gap-x-4 gap-y-2">
						{#each ([
							{ code: 'g', label: i18n.t.ortho.iotnCondG, teeth: '4–8', grade: 1, field: 'g' as const },
							{ code: 'l', label: i18n.t.ortho.iotnCondL, teeth: '4–7', grade: 4, field: 'l' as const },
							{ code: 'p', label: i18n.t.ortho.iotnCondP, teeth: '8–8', grade: 5, field: 'p' as const },
							{ code: 's', label: i18n.t.ortho.iotnCondS, teeth: 'V–V', grade: 5, field: 's' as const },
							{ code: 't', label: i18n.t.ortho.iotnCondT, teeth: '8–8', grade: 4, field: 't' as const },
							{ code: 'x', label: i18n.t.ortho.iotnCondX, teeth: '7–7', grade: 5, field: 'x' as const },
						]) as cond}
							<div class="flex items-center gap-2">
								<button disabled={isReadOnly}
									class="flex items-center justify-center w-5 h-5 rounded border-2 transition-colors shrink-0
										{meas[cond.field]
											? 'bg-primary border-primary'
											: 'border-border bg-background hover:border-primary/50'}
										{ROD(isReadOnly)}"
									onclick={() => { if (!isReadOnly) (meas[cond.field] as boolean) = !(meas[cond.field]); }}>
									{#if meas[cond.field]}
										<svg class="w-3 h-3 text-primary-foreground" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.5">
											<polyline points="2 6 5 9 10 3"/>
										</svg>
									{/if}
								</button>
								<span class="text-[10px] font-bold text-muted-foreground w-4 shrink-0">{cond.code}</span>
								<span class="text-xs text-foreground leading-tight flex-1 min-w-0">{cond.label}</span>
								<span class="text-[10px] text-muted-foreground shrink-0">({cond.teeth})</span>
								<span class="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 {meas[cond.field] ? gradeBadgeCls(cond.grade) : 'text-muted-foreground/30'}">
									{meas[cond.field] ? cond.grade : '—'}
								</span>
							</div>
						{/each}
					</div>

				</div><!-- end condition rows -->
			</div><!-- end DHC card -->

			<!-- ── AC Section ─────────────────────────────────────────── -->
			<div class="border border-border rounded-lg overflow-hidden">
				<div class="bg-muted/40 px-3 py-2 border-b border-border">
					<span class="text-xs font-semibold text-foreground">{i18n.t.ortho.acTitle}</span>
				</div>
				<div class="p-3 space-y-2">
					<div class="flex gap-1.5 flex-wrap">
						{#each [1,2,3,4,5,6,7,8,9,10] as g}
							<button disabled={isReadOnly}
								class="w-9 h-9 rounded-lg text-sm font-bold border-2 transition-all
									{acGrade === g ? acColor(g, true) : `bg-background border ${acColor(g, false)}`}
									{acGrade === g ? (g <= 4 ? 'ring-2 ring-emerald-400' : g <= 7 ? 'ring-2 ring-yellow-400' : 'ring-2 ring-red-500') : ''}
									{ROD(isReadOnly)}"
								onclick={() => { if (!isReadOnly) acGrade = acGrade === g ? 0 : g; }}>
								{g}
							</button>
						{/each}
						{#if acGrade > 0 && !isReadOnly}
							<button class="px-2 h-9 text-xs text-muted-foreground hover:text-foreground"
								onclick={() => acGrade = 0}>×</button>
						{/if}
					</div>
					{#if acGrade > 0}
						<p class="text-xs text-muted-foreground leading-snug">
							<span class="font-semibold text-foreground">AC {acGrade}</span>
							— {(i18n.t.ortho.acGradeDesc as Record<string,string>)[String(acGrade)] ?? ''}
						</p>
					{/if}
				</div>
			</div>

			<!-- ── IOTN Score summary ──────────────────────────────────── -->
			{#if iotnScoreLabel()}
				<div class="flex items-center gap-2 px-1">
					<span class="text-xs font-medium text-muted-foreground">{i18n.t.ortho.iotnScore}:</span>
					<span class="font-mono text-sm font-bold text-foreground">{iotnScoreLabel()}</span>
					{#if dhcResult.grade >= 4}
						<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300">Treatment indicated</span>
					{:else if dhcResult.grade === 3 || acGrade >= 5}
						<span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-yellow-50 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">Borderline</span>
					{/if}
				</div>
			{/if}

			<!-- Bad Habits -->
			<div class="border border-border rounded-lg p-3">
				<div class="text-xs font-semibold text-muted-foreground mb-2">{i18n.t.ortho.badHabitsLabel}</div>
				<div class="flex flex-wrap gap-1.5">
					{#each BAD_HABIT_KEYS as key}
						{@const sel = badHabits.includes(key)}
						<button disabled={isReadOnly}
							class="px-2.5 py-1 rounded-full text-xs font-medium border transition-colors
								{sel ? 'bg-violet-500 text-white border-violet-600' : 'border-border bg-background hover:bg-muted text-foreground'}
								{ROD(isReadOnly)}"
							onclick={() => toggleHabit(key)}>
							{(i18n.t.ortho.badHabitOptions as Record<string,string>)[key]}
						</button>
					{/each}
				</div>
			</div>

			<!-- Bite (Sagittal Relationship) -->
			<div class="border border-border rounded-lg p-3">
				<div class="text-xs font-semibold text-muted-foreground mb-2">{i18n.t.ortho.bissTitle}</div>
				<div class="grid grid-cols-2 gap-4">
					{#each (['right', 'left'] as const) as side}
						{@const biss = side === 'right' ? bissRight : bissLeft}
						<div class="space-y-1.5">
							<div class="text-xs font-medium">{side === 'right' ? i18n.t.ortho.bissRight : i18n.t.ortho.bissLeft}</div>
							<div class="flex flex-wrap gap-1 items-center">
								{#each (['neutral', 'distal', 'mesial'] as const) as type}
									<button disabled={isReadOnly}
										class="px-2 py-0.5 rounded text-xs font-medium border transition-colors
											{biss?.type === type ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:bg-muted text-foreground'}
											{ROD(isReadOnly)}"
										onclick={() => setBissType(side, type)}>
										{(i18n.t.ortho.bissTypes as Record<string,string>)[type]}
									</button>
								{/each}
								{#if biss && !isReadOnly}
									<button class="text-xs text-muted-foreground hover:text-foreground px-1" onclick={() => clearBiss(side)}>×</button>
								{/if}
							</div>
							{#if biss && biss.type !== 'neutral'}
								<div class="flex flex-wrap gap-1 items-center mt-1">
									{#each PB_OPTIONS as pb}
										<button disabled={isReadOnly}
											class="w-8 py-0.5 rounded text-[10px] font-mono border transition-colors
												{biss.praemolarenbreite === pb ? 'bg-primary text-primary-foreground border-primary' : 'border-border bg-background hover:bg-muted text-foreground'}
												{ROD(isReadOnly)}"
											onclick={() => setBissPb(side, pb)}>
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

			<!-- Notes -->
			<div class="space-y-1">
				<label class="text-xs font-medium text-muted-foreground">{i18n.t.common.notes}</label>
				<textarea bind:value={notes} rows={3} disabled={isReadOnly}
					class="w-full px-2 py-1.5 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none disabled:opacity-60">
				</textarea>
			</div>

		</div><!-- end scrollable body -->

		<!-- Footer -->
		<div class="shrink-0 flex items-center justify-between pt-3 border-t border-border mt-2">
			<Button variant="outline" onclick={() => (open = false)}>
				{isReadOnly ? i18n.t.actions.close : i18n.t.actions.cancel}
			</Button>
			{#if !isReadOnly}
				<Button onclick={handleSave} disabled={isSaving || !canSave}>
					{isSaving ? '…' : i18n.t.ortho.saveAssessment}
				</Button>
			{/if}
		</div>
	</DialogContent>
</Dialog>
