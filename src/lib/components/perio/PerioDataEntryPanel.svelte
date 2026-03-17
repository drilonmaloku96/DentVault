<script lang="ts">
	import { toFDI } from '$lib/utils';
	import type { ProbingToothData } from '$lib/types';
	import { i18n } from '$lib/i18n';

	let {
		toothNumber,
		pocketDepths,
		bopSites,
		recessions,
		plaqueSites,
		toothData,
		onPdChange,
		onRecessionChange,
		onBopToggle,
		onPlaqueToggle,
		onToothDataChange,
		onAdvance,
		onBack,
		onClose,
		onStartCharting,
	}: {
		toothNumber: number | null;
		pocketDepths: Record<string, number | null>;
		bopSites: Record<string, boolean>;
		recessions: Record<string, number | null>;
		plaqueSites: Record<string, boolean>;
		toothData: ProbingToothData | null;
		onPdChange: (tooth: number, site: string, value: number | null) => void;
		onRecessionChange: (tooth: number, site: string, value: number | null) => void;
		onBopToggle: (tooth: number, site: string) => void;
		onPlaqueToggle: (tooth: number, site: string) => void;
		onToothDataChange: (tooth: number, data: Partial<ProbingToothData>) => void;
		onAdvance: () => void;
		onBack: () => void;
		onClose: () => void;
		onStartCharting: () => void;
	} = $props();

	// Multi-rooted teeth: molars + upper premolars show furcation
	const MULTI_ROOTED = new Set([1,2,3,4,5,12,13,14,15,16,17,18,19,20,21,28,29,30,31,32]);
	// Upper molars have B, ML, DL furcation sites; lower molars have B, L
	const UPPER_MOLARS = new Set([1,2,3,14,15,16]);

	const BUCCAL_SITES = ['MB', 'B', 'DB'] as const;
	const LINGUAL_SITES = ['ML', 'L', 'DL'] as const;

	let savedPulse = $state(false);
	let notesDebounce: ReturnType<typeof setTimeout> | null = null;

	function pdColorClass(pd: number | null): string {
		if (!pd) return 'bg-muted/30';
		if (pd <= 3) return 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100';
		if (pd <= 5) return 'bg-amber-100 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100';
		return 'bg-red-100 dark:bg-red-950/40 text-red-900 dark:text-red-100';
	}

	function calValue(tooth: number, site: string): string {
		const pd = pocketDepths[`${tooth}_${site}`] ?? null;
		const rec = recessions[`${tooth}_${site}`] ?? null;
		if (pd === null) return '—';
		if (rec === null || rec === 0) return String(pd);
		return String(pd + rec);
	}

	function handlePdInput(site: string, e: Event) {
		if (!toothNumber) return;
		const val = (e.target as HTMLInputElement).value;
		const parsed = val === '' ? null : parseInt(val, 10);
		const clamped = parsed === null ? null : Math.max(0, Math.min(15, parsed));
		onPdChange(toothNumber, site, clamped);
		flashSaved();
	}

	function handleRecessionInput(site: string, e: Event) {
		if (!toothNumber) return;
		const val = (e.target as HTMLInputElement).value;
		const parsed = val === '' ? null : parseInt(val, 10);
		const clamped = parsed === null ? null : Math.max(0, Math.min(15, parsed));
		onRecessionChange(toothNumber, site, clamped);
		flashSaved();
	}

	function handlePdKeydown(site: string, e: KeyboardEvent) {
		if (!toothNumber) return;
		const input = e.target as HTMLInputElement;
		if (e.key === 'ArrowUp') {
			e.preventDefault();
			const cur = pocketDepths[`${toothNumber}_${site}`] ?? 0;
			onPdChange(toothNumber, site, Math.min(15, cur + 1));
			flashSaved();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			const cur = pocketDepths[`${toothNumber}_${site}`] ?? 0;
			onPdChange(toothNumber, site, Math.max(0, cur - 1));
			flashSaved();
		} else if (e.key === 'Enter') {
			// If this is the last PD input (DL), advance to next tooth
			if (site === 'DL') {
				e.preventDefault();
				onAdvance();
			}
		}
	}

	function handleNotesInput(e: Event) {
		if (!toothNumber) return;
		const val = (e.target as HTMLTextAreaElement).value;
		if (notesDebounce) clearTimeout(notesDebounce);
		notesDebounce = setTimeout(() => {
			onToothDataChange(toothNumber!, { notes: val });
			flashSaved();
		}, 600);
	}

	function handleMobilityClick(val: number) {
		if (!toothNumber) return;
		const newVal = toothData?.mobility === val ? null : val;
		onToothDataChange(toothNumber, { mobility: newVal });
		flashSaved();
	}

	function handleFurcationClick(val: number) {
		if (!toothNumber) return;
		const newVal = toothData?.furcation === val ? null : val;
		onToothDataChange(toothNumber, { furcation: newVal });
		flashSaved();
	}

	function toggleFurcationSite(site: string) {
		if (!toothNumber) return;
		const current = (toothData?.furcation_sites ?? '').split(',').filter(Boolean);
		const idx = current.indexOf(site);
		if (idx >= 0) current.splice(idx, 1);
		else current.push(site);
		onToothDataChange(toothNumber, { furcation_sites: current.join(',') });
		flashSaved();
	}

	function flashSaved() {
		savedPulse = true;
		setTimeout(() => { savedPulse = false; }, 1200);
	}

	const MOBILITY_LABELS = ['0', 'I', 'II', 'III'];
	const FURCATION_LABELS = ['0', 'I', 'II', 'III'];

	function furcationSites(tooth: number): string[] {
		if (UPPER_MOLARS.has(tooth)) return ['B', 'ML', 'DL'];
		return ['B', 'L'];
	}

	function isFurcSiteActive(site: string): boolean {
		if (!toothData?.furcation_sites) return false;
		return toothData.furcation_sites.split(',').includes(site);
	}
</script>

<div class="flex flex-col h-full min-h-0">
	{#if toothNumber === null}
		<!-- Placeholder -->
		<div class="flex flex-col items-center justify-center h-full gap-4 text-center text-muted-foreground p-6">
			<div class="text-4xl opacity-20">🦷</div>
			<p class="text-sm">{i18n.t.perio.clickToStart}</p>
			<button
				onclick={onStartCharting}
				class="mt-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 transition-colors"
			>
				{i18n.t.perio.startCharting}
			</button>
		</div>
	{:else}
		<!-- Header -->
		<div class="flex items-center justify-between px-3 py-2 border-b bg-muted/30 shrink-0">
			<div class="flex items-center gap-2">
				<span class="font-semibold text-sm">FDI {toFDI(toothNumber)}</span>
				<span class="text-xs text-muted-foreground">(#{toothNumber})</span>
			</div>
			<div class="flex items-center gap-2">
				{#if savedPulse}
					<span class="text-xs text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">✓ saved</span>
				{/if}
				<button
					onclick={onClose}
					class="text-muted-foreground hover:text-foreground transition-colors text-lg leading-none w-6 h-6 flex items-center justify-center rounded"
					aria-label="Deselect tooth"
				>×</button>
			</div>
		</div>

		<div class="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-4">
			<!-- ── Buccal Section ── -->
			<div>
				<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{i18n.t.perio.buccal}</p>
				<div class="grid grid-cols-4 gap-1 text-[10px]">
					<!-- Header row -->
					<div class="text-muted-foreground text-right pr-1 pt-1"></div>
					{#each BUCCAL_SITES as site}
						<div class="text-center font-medium text-muted-foreground">{site}</div>
					{/each}

					<!-- PD row -->
					<div class="text-right pr-1 text-muted-foreground flex items-center justify-end text-[9px]">PD</div>
					{#each BUCCAL_SITES as site}
						<input
							type="number"
							min="0"
							max="15"
							value={pocketDepths[`${toothNumber}_${site}`] ?? ''}
							oninput={(e) => handlePdInput(site, e)}
							onkeydown={(e) => handlePdKeydown(site, e)}
							class="w-full text-center rounded border border-border text-xs h-8 focus:outline-none focus:ring-1 focus:ring-primary/50 {pdColorClass(pocketDepths[`${toothNumber}_${site}`] ?? null)}"
							placeholder="—"
						/>
					{/each}

					<!-- Recession row -->
					<div class="text-right pr-1 text-muted-foreground flex items-center justify-end text-[9px]">Rec</div>
					{#each BUCCAL_SITES as site}
						<input
							type="number"
							min="0"
							max="15"
							value={recessions[`${toothNumber}_${site}`] ?? ''}
							oninput={(e) => handleRecessionInput(site, e)}
							class="w-full text-center rounded border border-border text-xs h-7 focus:outline-none focus:ring-1 focus:ring-primary/50 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300"
							placeholder="—"
						/>
					{/each}

					<!-- CAL row -->
					<div class="text-right pr-1 text-muted-foreground flex items-center justify-end text-[9px]">CAL</div>
					{#each BUCCAL_SITES as site}
						<div class="text-center text-xs font-medium text-muted-foreground py-1">
							{calValue(toothNumber, site)}
						</div>
					{/each}

					<!-- BOP row -->
					<div class="text-right pr-1 text-muted-foreground flex items-center justify-end text-[9px]">BOP</div>
					{#each BUCCAL_SITES as site}
						<div class="flex justify-center">
							<button
								type="button"
								onclick={() => onBopToggle(toothNumber!, site)}
								class="w-7 h-7 rounded-full border-2 transition-colors {bopSites[`${toothNumber}_${site}`] ? 'bg-red-500 border-red-500 text-white' : 'border-border bg-background hover:border-red-300'}"
								title="Bleeding on probing — {site}"
								aria-label="BOP {site}"
							>
								{#if bopSites[`${toothNumber}_${site}`]}
									<span class="text-[8px]">●</span>
								{/if}
							</button>
						</div>
					{/each}

					<!-- Plaque row -->
					<div class="text-right pr-1 text-muted-foreground flex items-center justify-end text-[9px]">Plq</div>
					{#each BUCCAL_SITES as site}
						<div class="flex justify-center">
							<button
								type="button"
								onclick={() => onPlaqueToggle(toothNumber!, site)}
								class="w-7 h-7 rounded-full border-2 transition-colors {plaqueSites[`${toothNumber}_${site}`] ? 'bg-amber-400 border-amber-400 text-white' : 'border-border bg-background hover:border-amber-300'}"
								title="Plaque — {site}"
								aria-label="Plaque {site}"
							>
								{#if plaqueSites[`${toothNumber}_${site}`]}
									<span class="text-[8px]">●</span>
								{/if}
							</button>
						</div>
					{/each}
				</div>
			</div>

			<!-- ── Lingual Section ── -->
			<div>
				<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">{i18n.t.perio.lingual} / {i18n.t.perio.palatal}</p>
				<div class="grid grid-cols-4 gap-1 text-[10px]">
					<!-- Header row -->
					<div></div>
					{#each LINGUAL_SITES as site}
						<div class="text-center font-medium text-muted-foreground">{site}</div>
					{/each}

					<!-- PD row -->
					<div class="text-right pr-1 text-muted-foreground flex items-center justify-end text-[9px]">PD</div>
					{#each LINGUAL_SITES as site}
						<input
							type="number"
							min="0"
							max="15"
							value={pocketDepths[`${toothNumber}_${site}`] ?? ''}
							oninput={(e) => handlePdInput(site, e)}
							onkeydown={(e) => handlePdKeydown(site, e)}
							class="w-full text-center rounded border border-border text-xs h-8 focus:outline-none focus:ring-1 focus:ring-primary/50 {pdColorClass(pocketDepths[`${toothNumber}_${site}`] ?? null)}"
							placeholder="—"
						/>
					{/each}

					<!-- Recession row -->
					<div class="text-right pr-1 text-muted-foreground flex items-center justify-end text-[9px]">Rec</div>
					{#each LINGUAL_SITES as site}
						<input
							type="number"
							min="0"
							max="15"
							value={recessions[`${toothNumber}_${site}`] ?? ''}
							oninput={(e) => handleRecessionInput(site, e)}
							class="w-full text-center rounded border border-border text-xs h-7 focus:outline-none focus:ring-1 focus:ring-primary/50 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300"
							placeholder="—"
						/>
					{/each}

					<!-- CAL row -->
					<div class="text-right pr-1 text-muted-foreground flex items-center justify-end text-[9px]">CAL</div>
					{#each LINGUAL_SITES as site}
						<div class="text-center text-xs font-medium text-muted-foreground py-1">
							{calValue(toothNumber, site)}
						</div>
					{/each}

					<!-- BOP row -->
					<div class="text-right pr-1 text-muted-foreground flex items-center justify-end text-[9px]">BOP</div>
					{#each LINGUAL_SITES as site}
						<div class="flex justify-center">
							<button
								type="button"
								onclick={() => onBopToggle(toothNumber!, site)}
								class="w-7 h-7 rounded-full border-2 transition-colors {bopSites[`${toothNumber}_${site}`] ? 'bg-red-500 border-red-500 text-white' : 'border-border bg-background hover:border-red-300'}"
								title="BOP {site}"
								aria-label="BOP {site}"
							>
								{#if bopSites[`${toothNumber}_${site}`]}
									<span class="text-[8px]">●</span>
								{/if}
							</button>
						</div>
					{/each}

					<!-- Plaque row -->
					<div class="text-right pr-1 text-muted-foreground flex items-center justify-end text-[9px]">Plq</div>
					{#each LINGUAL_SITES as site}
						<div class="flex justify-center">
							<button
								type="button"
								onclick={() => onPlaqueToggle(toothNumber!, site)}
								class="w-7 h-7 rounded-full border-2 transition-colors {plaqueSites[`${toothNumber}_${site}`] ? 'bg-amber-400 border-amber-400 text-white' : 'border-border bg-background hover:border-amber-300'}"
								title="Plaque {site}"
								aria-label="Plaque {site}"
							>
								{#if plaqueSites[`${toothNumber}_${site}`]}
									<span class="text-[8px]">●</span>
								{/if}
							</button>
						</div>
					{/each}
				</div>
			</div>

			<!-- ── Mobility ── -->
			<div>
				<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{i18n.t.perio.mobility}</p>
				<div class="flex gap-1.5">
					{#each MOBILITY_LABELS as label, idx}
						<button
							type="button"
							onclick={() => handleMobilityClick(idx)}
							class="flex-1 rounded py-1 text-xs font-medium border transition-colors
								{toothData?.mobility === idx
									? 'bg-primary text-primary-foreground border-primary'
									: 'border-border hover:bg-muted'}"
						>{label}</button>
					{/each}
				</div>
			</div>

			<!-- ── Furcation (multi-rooted only) ── -->
			{#if MULTI_ROOTED.has(toothNumber)}
				<div>
					<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{i18n.t.perio.furcation}</p>
					<div class="flex gap-1.5 mb-2">
						{#each FURCATION_LABELS as label, idx}
							<button
								type="button"
								onclick={() => handleFurcationClick(idx)}
								class="flex-1 rounded py-1 text-xs font-medium border transition-colors
									{toothData?.furcation === idx
										? 'bg-primary text-primary-foreground border-primary'
										: 'border-border hover:bg-muted'}"
							>{label}</button>
						{/each}
					</div>
					{#if toothData?.furcation && toothData.furcation > 0}
						<div class="flex gap-1.5">
							{#each furcationSites(toothNumber) as site}
								<button
									type="button"
									onclick={() => toggleFurcationSite(site)}
									class="flex-1 rounded py-0.5 text-xs border transition-colors
										{isFurcSiteActive(site)
											? 'bg-primary/20 text-primary border-primary/50'
											: 'border-border hover:bg-muted'}"
								>{site}</button>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- ── Notes ── -->
			<div>
				<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{i18n.t.common.notes}</p>
				<textarea
					oninput={handleNotesInput}
					value={toothData?.notes ?? ''}
					rows="2"
					class="w-full rounded border border-border bg-background px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
					placeholder="Optional notes for this tooth…"
				></textarea>
			</div>
		</div>

		<!-- ── Footer navigation ── -->
		<div class="shrink-0 border-t px-3 py-2 flex items-center justify-between text-[10px] text-muted-foreground bg-muted/20">
			<button
				onclick={onBack}
				class="flex items-center gap-1 hover:text-foreground transition-colors"
				title="Previous tooth (Shift+Enter)"
			>
				← {i18n.t.actions.prev} <kbd class="ml-1 px-1 py-0.5 rounded bg-border text-[9px]">⇧↵</kbd>
			</button>
			<button
				onclick={onAdvance}
				class="flex items-center gap-1 hover:text-foreground transition-colors"
				title="Next tooth (Enter)"
			>
				{i18n.t.actions.next} → <kbd class="ml-1 px-1 py-0.5 rounded bg-border text-[9px]">↵</kbd>
			</button>
		</div>
	{/if}
</div>
