<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import type { Patient } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { pickDirectory, openDocumentFile } from '$lib/services/files';
	import { exportPatient } from '$lib/services/patient-export';
	import { dentalTags } from '$lib/stores/dentalTags.svelte';
	import { bridgeRoles } from '$lib/stores/bridgeRoles.svelte';
	import { prosthesisTypes } from '$lib/stores/prosthesisTypes.svelte';

	let {
		patient,
		open = $bindable(false),
	}: {
		patient: Patient;
		open?: boolean;
	} = $props();

	// ── Options ───────────────────────────────────────────────────────────
	let dateFrom = $state('');
	let dateTo = $state('');

	let sectionDemographics = $state(true);
	let sectionMedical = $state(true);
	let sectionNotes = $state(true);
	let sectionChart = $state(true);
	let sectionTimeline = $state(true);
	let sectionPerio = $state(true);
	let sectionPlans = $state(true);
	let sectionDocuments = $state(true);

	// ── Export state ──────────────────────────────────────────────────────
	let isExporting = $state(false);
	let progress = $state(0);
	let progressText = $state('');
	let exportedPath = $state('');
	let errorMsg = $state('');

	function reset() {
		isExporting = false;
		progress = 0;
		progressText = '';
		exportedPath = '';
		errorMsg = '';
	}

	async function handleExport() {
		const destDir = await pickDirectory();
		if (!destDir) return;

		reset();
		isExporting = true;

		try {
			// Take a snapshot of the store configs (non-reactive)
			const tags = dentalTags.list.map(t => ({
				key: t.key,
				color: t.color,
				strokeColor: t.strokeColor,
				pattern: t.pattern,
			}));
			const bridgeCfgs = bridgeRoles.configs.map(c => ({
				key: c.key,
				color: c.color,
				fillColor: c.fillColor,
				fillPattern: c.fillPattern,
				badge: c.badge ?? '',
			}));
			const prosthesisCfgs = prosthesisTypes.configs.map(c => ({
				key: c.key,
				color: c.color,
				fillColor: c.fillColor,
				fillPattern: c.fillPattern,
				badge: c.badge ?? '',
			}));

			const path = await exportPatient(
				patient.patient_id,
				destDir,
				{
					dateFrom: dateFrom || undefined,
					dateTo: dateTo || undefined,
					sections: {
						demographics: sectionDemographics,
						medical: sectionMedical,
						notes: sectionNotes,
						chart: sectionChart,
						timeline: sectionTimeline,
						perio: sectionPerio,
						plans: sectionPlans,
						documents: sectionDocuments,
					},
				},
				tags,
				bridgeCfgs,
				prosthesisCfgs,
				i18n.code,
				(pct, text) => {
					progress = pct;
					progressText = text;
				},
			);
			exportedPath = path;
		} catch (e) {
			errorMsg = String(e);
		} finally {
			isExporting = false;
		}
	}

	function handleClose() {
		if (!isExporting) {
			reset();
			open = false;
		}
	}
</script>

<Dialog bind:open onOpenChange={(v) => { if (!v && !isExporting) { reset(); } }}>
	<DialogContent class="max-w-[480px] sm:max-w-[480px]">
		<DialogHeader>
			<DialogTitle>{i18n.t.export.title}</DialogTitle>
		</DialogHeader>

		<div class="flex flex-col gap-4 py-2">
			<p class="text-sm text-muted-foreground">{i18n.t.export.description}</p>

			<!-- Date range -->
			<div class="flex flex-col gap-1.5">
				<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{i18n.t.export.dateRange}</p>
				<div class="flex items-center gap-2">
					<div class="flex flex-col gap-0.5 flex-1">
						<label class="text-xs text-muted-foreground">{i18n.t.export.dateFrom}</label>
						<input
							type="date"
							bind:value={dateFrom}
							disabled={isExporting}
							class="border border-border rounded px-2 py-1 text-sm bg-background outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 w-full"
						/>
					</div>
					<div class="flex flex-col gap-0.5 flex-1">
						<label class="text-xs text-muted-foreground">{i18n.t.export.dateTo}</label>
						<input
							type="date"
							bind:value={dateTo}
							disabled={isExporting}
							class="border border-border rounded px-2 py-1 text-sm bg-background outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 w-full"
						/>
					</div>
					{#if dateFrom || dateTo}
						<button
							type="button"
							onclick={() => { dateFrom = ''; dateTo = ''; }}
							disabled={isExporting}
							class="mt-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
						>{i18n.t.export.allTime}</button>
					{/if}
				</div>
			</div>

			<!-- Section checkboxes -->
			<div class="flex flex-col gap-1.5">
				<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{i18n.code === 'de' ? 'Abschnitte' : 'Sections'}</p>
				<div class="grid grid-cols-2 gap-1">
					<label class="flex items-center gap-2 text-sm cursor-pointer select-none">
						<input type="checkbox" bind:checked={sectionDemographics} disabled={isExporting} class="rounded"/>
						{i18n.t.export.sections.demographics}
					</label>
					<label class="flex items-center gap-2 text-sm cursor-pointer select-none">
						<input type="checkbox" bind:checked={sectionMedical} disabled={isExporting} class="rounded"/>
						{i18n.t.export.sections.medical}
					</label>
					<label class="flex items-center gap-2 text-sm cursor-pointer select-none">
						<input type="checkbox" bind:checked={sectionNotes} disabled={isExporting} class="rounded"/>
						{i18n.t.export.sections.notes}
					</label>
					<label class="flex items-center gap-2 text-sm cursor-pointer select-none">
						<input type="checkbox" bind:checked={sectionChart} disabled={isExporting} class="rounded"/>
						{i18n.t.export.sections.chart}
					</label>
					<label class="flex items-center gap-2 text-sm cursor-pointer select-none">
						<input type="checkbox" bind:checked={sectionTimeline} disabled={isExporting} class="rounded"/>
						{i18n.t.export.sections.timeline}
					</label>
					<label class="flex items-center gap-2 text-sm cursor-pointer select-none">
						<input type="checkbox" bind:checked={sectionPerio} disabled={isExporting} class="rounded"/>
						{i18n.t.export.sections.perio}
					</label>
					<label class="flex items-center gap-2 text-sm cursor-pointer select-none">
						<input type="checkbox" bind:checked={sectionPlans} disabled={isExporting} class="rounded"/>
						{i18n.t.export.sections.plans}
					</label>
					<label class="flex items-center gap-2 text-sm cursor-pointer select-none">
						<input type="checkbox" bind:checked={sectionDocuments} disabled={isExporting} class="rounded"/>
						{i18n.t.export.sections.documents}
					</label>
				</div>
			</div>

			<!-- Progress -->
			{#if isExporting}
				<div class="flex flex-col gap-1.5">
					<div class="w-full bg-muted rounded-full h-2 overflow-hidden">
						<div class="h-full bg-primary transition-all duration-300" style="width: {progress}%"></div>
					</div>
					<p class="text-xs text-muted-foreground">{progressText}</p>
				</div>
			{/if}

			<!-- Success -->
			{#if exportedPath && !isExporting}
				<div class="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800 p-3 flex flex-col gap-2">
					<p class="text-sm text-green-800 dark:text-green-300 font-medium">{i18n.t.export.success}</p>
					<p class="text-xs text-green-700 dark:text-green-400 font-mono break-all">{exportedPath}</p>
					<Button
						size="sm"
						variant="outline"
						onclick={() => openDocumentFile(exportedPath)}
						class="self-start"
					>{i18n.t.export.openFolder}</Button>
				</div>
			{/if}

			<!-- Error -->
			{#if errorMsg}
				<div class="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
					<p class="text-sm text-destructive">{i18n.t.export.error} {errorMsg}</p>
				</div>
			{/if}
		</div>

		<!-- Actions -->
		<div class="flex justify-end gap-2 pt-1 border-t border-border mt-1">
			<Button variant="outline" onclick={handleClose} disabled={isExporting}>{i18n.t.actions.cancel}</Button>
			{#if !exportedPath}
				<Button onclick={handleExport} disabled={isExporting}>
					{isExporting ? '…' : i18n.t.export.chooseFolder}
				</Button>
			{/if}
		</div>
	</DialogContent>
</Dialog>
