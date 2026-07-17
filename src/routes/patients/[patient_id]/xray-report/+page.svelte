<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import {
		getPatient,
		getDocuments,
		insertDocument,
		insertTimelineEntry,
		updateTimelineEntry,
		getXrayReportEntryForSource,
	} from '$lib/services/db';
	import type { TimelineEntry } from '$lib/types';
	import { vault } from '$lib/stores/vault.svelte';
	import { docCategories } from '$lib/stores/categories.svelte';
	import { toAbsPath, getMimeType } from '$lib/services/files';
	import { generateXrayReportPdf } from '$lib/services/xray-report-pdf';
	import { formatDate, toLocalISODate } from '$lib/utils';
	import { i18n } from '$lib/i18n';
	import FullScreenView from '$lib/components/ui/FullScreenView.svelte';
	import FloatingPanel from '$lib/components/ui/FloatingPanel.svelte';
	import ImageViewport from '$lib/components/imaging/ImageViewport.svelte';
	import { Button } from '$lib/components/ui/button';

	const patientId = $derived(page.params.patient_id ?? '');
	/** Vault-relative path of the X-ray image, e.g. {patientFolder}/xrays/scan.png */
	const relPath = $derived(page.url.searchParams.get('file') ?? '');
	const relDir = $derived(relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '');
	const fileName = $derived(relPath.split('/').pop() ?? relPath);
	/** Filename without extension — the report PDF is named {baseName}_report.pdf */
	const baseName = $derived(fileName.replace(/\.[^.]+$/, ''));

	/** Document category key inferred from the top-level folder inside the patient folder. */
	const folderToKey = $derived(
		Object.fromEntries(docCategories.list.map((c) => [vault.categoryFolder(c.key), c.key])),
	);
	const categoryKey = $derived.by(() => {
		const parts = relPath.split('/');
		return parts.length > 2 ? (folderToKey[parts[1]] ?? parts[1]) : 'other';
	});

	// ── Load state ─────────────────────────────────────────────────────────
	let patientName = $state('');
	let imageDataUrl = $state('');
	let imageByteSize = $state(0);
	let naturalWidth = $state(0);
	let naturalHeight = $state(0);
	let imageLoaded = $state(false);
	let loadError = $state('');
	let existingEntry = $state<TimelineEntry | null>(null);

	// ── Image-adjust state (bound into ImageViewport) ────────────────────────
	let brightness = $state(100);
	let contrast = $state(100);

	// ── Report panel state ──────────────────────────────────────────────────
	let panelOpen = $state(true);
	let reportText = $state('');
	let generating = $state(false);
	let feedback = $state<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

	// Bottom-center initial panel position (same pattern as the patient page panels)
	const panelInitX = typeof window !== 'undefined' ? Math.max(20, Math.floor(window.innerWidth / 2) - 210) : 400;
	const panelInitY = typeof window !== 'undefined' ? Math.max(90, window.innerHeight - 500) : 300;

	function goBack() {
		history.back();
	}

	function base64ByteSize(b64: string): number {
		const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
		return Math.floor((b64.length * 3) / 4) - padding;
	}

	function escapeHtml(s: string): string {
		return s
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	// ── Load: patient, image bytes, existing report ─────────────────────────

	onMount(() => {
		(async () => {
			if (!vault.path || !relPath || !patientId) {
				loadError = i18n.t.xrayReport.loadFailed;
				return;
			}
			try {
				const p = await getPatient(patientId);
				patientName = p ? `${p.firstname} ${p.lastname}`.trim() : '';

				const base64 = await invoke<string>('read_base64_file', {
					path: toAbsPath(relPath, vault.path),
				});
				imageByteSize = base64ByteSize(base64);
				imageDataUrl = `data:${getMimeType(fileName)};base64,${base64}`;

				const entry = await getXrayReportEntryForSource(patientId, relPath);
				if (entry) {
					existingEntry = entry;
					try {
						const data = JSON.parse(entry.chart_data || '{}') as { text?: string };
						reportText = data.text ?? '';
					} catch {
						reportText = '';
					}
					feedback = { kind: 'info', text: i18n.t.xrayReport.existingLoaded };
				}
			} catch (e) {
				console.error('X-ray report load failed:', e);
				loadError = i18n.t.xrayReport.loadFailed;
			}
		})();
	});

	function onImageLoad(w: number, h: number) {
		naturalWidth = w;
		naturalHeight = h;
		imageLoaded = true;
	}

	// ── Generate PDF + upsert documents row + timeline entry ────────────────

	async function handleGenerate() {
		if (generating || !imageDataUrl || !naturalWidth || !naturalHeight || !vault.path) return;
		generating = true;
		feedback = null;
		try {
			const dateStr = formatDate(existingEntry?.entry_date ?? toLocalISODate());
			const pdfBase64 = generateXrayReportPdf({
				imageDataUrl,
				imageWidth: naturalWidth,
				imageHeight: naturalHeight,
				patientName,
				dateStr,
				reportText,
			});

			// Write the PDF next to the source X-ray (overwrite = re-generate)
			const pdfName = `${baseName}_report.pdf`;
			const pdfRel = relDir ? `${relDir}/${pdfName}` : pdfName;
			const pdfAbs = toAbsPath(pdfRel, vault.path);
			await invoke<void>('write_base64_file', { destPath: pdfAbs, base64Data: pdfBase64 });
			const pdfSize = base64ByteSize(pdfBase64);

			// Ensure a documents row exists so the sidebar auto-tracker doesn't
			// create a duplicate generic entry for the new file
			const docs = await getDocuments(patientId);
			if (!docs.some((d) => d.rel_path === pdfRel)) {
				await insertDocument(patientId, {
					filename: pdfName,
					original_name: pdfName,
					category: categoryKey,
					mime_type: 'application/pdf',
					file_size: pdfSize,
					abs_path: pdfAbs,
					rel_path: pdfRel,
					notes: '',
				});
			}

			// Upsert the single xray_report timeline entry for this source image
			const title = `${i18n.t.xrayReport.title} — ${baseName}`;
			const description = escapeHtml(reportText).replace(/\n/g, '<br>');
			const chartData = JSON.stringify({ source: relPath, pdf: pdfRel, text: reportText });
			const attachments = JSON.stringify([
				{ path: pdfRel, name: pdfName, mime: 'application/pdf', size: pdfSize },
				{ path: relPath, name: fileName, mime: getMimeType(fileName), size: imageByteSize },
			]);

			if (existingEntry) {
				await updateTimelineEntry(existingEntry.id, {
					title,
					description,
					chart_data: chartData,
					attachments,
				});
				existingEntry = { ...existingEntry, title, description, chart_data: chartData, attachments };
			} else {
				existingEntry = await insertTimelineEntry(patientId, {
					entry_date: toLocalISODate(),
					entry_type: 'xray_report',
					title,
					description,
					chart_data: chartData,
					attachments,
				});
			}

			feedback = { kind: 'success', text: i18n.t.xrayReport.generated };
		} catch (e) {
			console.error('X-ray report generation failed:', e);
			feedback = { kind: 'error', text: i18n.t.xrayReport.generateFailed };
		} finally {
			generating = false;
		}
	}
</script>

<FullScreenView open={true} title="{i18n.t.xrayReport.title} — {fileName}" scroll={false} onClose={goBack}>
	{#snippet actions()}
		{#if !panelOpen}
			<Button variant="outline" size="sm" onclick={() => (panelOpen = true)}>
				{i18n.t.xrayReport.panelTitle}
			</Button>
		{/if}
	{/snippet}

	<!-- Viewer surface -->
	{#if loadError}
		<div class="relative flex-1 min-h-0 overflow-hidden bg-neutral-900 flex items-center justify-center">
			<div class="max-w-md rounded-lg border border-destructive/50 bg-card p-6 text-center space-y-3">
				<p class="text-sm font-medium text-destructive">{i18n.t.xrayReport.loadFailed}</p>
				<button
					type="button"
					onclick={goBack}
					class="rounded-md border border-border bg-muted/40 hover:bg-muted px-4 py-2 text-xs font-medium transition-colors"
				>
					← {i18n.t.actions.back}
				</button>
			</div>
		</div>
	{:else}
		<ImageViewport
			{imageDataUrl}
			{naturalWidth}
			{naturalHeight}
			bind:brightness
			bind:contrast
			alt={fileName}
			hintText={i18n.t.xrayReport.viewerHints}
			{onImageLoad}
		/>
	{/if}

	<!-- Floating report panel -->
	{#if panelOpen && !loadError}
		<FloatingPanel
			title={i18n.t.xrayReport.panelTitle}
			initialX={panelInitX}
			initialY={panelInitY}
			onclose={() => (panelOpen = false)}
		>
			<div class="h-full flex flex-col gap-2 p-3">
				<textarea
					bind:value={reportText}
					placeholder={i18n.t.xrayReport.placeholder}
					class="flex-1 min-h-[120px] resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60 placeholder:text-muted-foreground/60"
				></textarea>
				{#if feedback}
					<p
						class="text-xs shrink-0
							{feedback.kind === 'error' ? 'text-destructive' : ''}
							{feedback.kind === 'success' ? 'text-success' : ''}
							{feedback.kind === 'info' ? 'text-muted-foreground' : ''}"
					>
						{feedback.text}
					</p>
				{/if}
				<Button
					onclick={handleGenerate}
					disabled={generating || !imageLoaded || !reportText.trim()}
					class="shrink-0"
				>
					{#if generating}
						<svg class="animate-spin h-3.5 w-3.5 mr-1.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
							<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
							<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
						</svg>
						{i18n.t.xrayReport.generating}
					{:else}
						{i18n.t.xrayReport.generate}
					{/if}
				</Button>
			</div>
		</FloatingPanel>
	{/if}
</FullScreenView>
