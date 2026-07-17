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
		getFacialAnalysisEntryForSource,
	} from '$lib/services/db';
	import type {
		TimelineEntry,
		FacialAnalysisView,
		FacialLandmark,
		FacialMeasurementResult,
		FacialAnalysisChartData,
	} from '$lib/types';
	import { vault } from '$lib/stores/vault.svelte';
	import { docCategories } from '$lib/stores/categories.svelte';
	import { toAbsPath, getMimeType } from '$lib/services/files';
	import { FACIAL_TEMPLATES, computeMeasurements } from '$lib/services/facial-measurements';
	import { generateFacialAnalysisPdf } from '$lib/services/facial-analysis-pdf';
	import { formatDate, toLocalISODate } from '$lib/utils';
	import { i18n } from '$lib/i18n';
	import FullScreenView from '$lib/components/ui/FullScreenView.svelte';
	import FloatingPanel from '$lib/components/ui/FloatingPanel.svelte';
	import ImageViewport from '$lib/components/imaging/ImageViewport.svelte';
	import LandmarkLayer from '$lib/components/imaging/LandmarkLayer.svelte';
	import { Button } from '$lib/components/ui/button';

	const patientId = $derived(page.params.patient_id ?? '');
	/** Vault-relative path of the source photo, e.g. {patientFolder}/photos/profile.jpg */
	const relPath = $derived(page.url.searchParams.get('file') ?? '');
	const relDir = $derived(relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '');
	const fileName = $derived(relPath.split('/').pop() ?? relPath);
	/** Filename without extension — the PDF is named {baseName}_facial.pdf */
	const baseName = $derived(fileName.replace(/\.[^.]+$/, ''));

	const folderToKey = $derived(
		Object.fromEntries(docCategories.list.map((c) => [vault.categoryFolder(c.key), c.key])),
	);
	const categoryKey = $derived.by(() => {
		const parts = relPath.split('/');
		return parts.length > 2 ? (folderToKey[parts[1]] ?? parts[1]) : 'other';
	});

	// ── Reference-line topology (guarded by endpoint existence at render time) ──
	const PROFILE_LINES: [string, string][] = [
		['prn', 'pog'], // Ricketts E-line
		['cm', 'pog'], // Steiner S-line (approx.)
		['ls', 'pog'], // Holdaway H-line
		['sn', 'pog'], // Burstone line
		['g', 'sn'],
		['sn', 'pog'], // facial-convexity segments (G'–Sn–Pog')
		['cm', 'sn'],
		['sn', 'ls'], // nasolabial-angle segments
		['li', 'sm'],
		['sm', 'pog'], // mentolabial-angle segments
		['t', 'or'], // FH approximation
		['g', 'n'],
		['n', 'prn'], // nasofrontal-angle segments
	];
	const FRONTAL_LINES: [string, string][] = [
		['g', 'sn'],
		['sn', 'me'], // facial midline (vertical)
		['g', 'pog'],
		['zy_r', 'zy_l'], // bizygomatic width
		['go_r', 'go_l'], // bigonial width
		['pu_r', 'pu_l'], // interpupillary line
		['ch_r', 'ch_l'], // commissure line
		['en_r', 'en_l'], // intercanthal
	];

	// ── Load state ─────────────────────────────────────────────────────────
	let patientName = $state('');
	let originalDataUrl = $state('');
	let workingImageDataUrl = $state('');
	let imageByteSize = $state(0);
	let naturalWidth = $state(0);
	let naturalHeight = $state(0);
	let imageLoaded = $state(false);
	let loadError = $state('');
	let existingEntry = $state<TimelineEntry | null>(null);

	// ── Analysis state ───────────────────────────────────────────────────────
	let view = $state<FacialAnalysisView | null>(null);
	let chosenView = $state<FacialAnalysisView>('profile');
	let mirrored = $state(false);
	let landmarks = $state<Record<string, FacialLandmark>>({});
	let activeId = $state<string | null>(null);
	let notes = $state('');

	// ── Image-adjust state (bound into ImageViewport) ────────────────────────
	let brightness = $state(100);
	let contrast = $state(100);

	// ── Panels ───────────────────────────────────────────────────────────────
	let landmarksPanelOpen = $state(true);
	let generating = $state(false);
	let feedback = $state<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);

	const landmarksPanelX = 20;
	const landmarksPanelY = 90;
	/** Static right-side Measurements sidebar width — no longer a floating/draggable panel. */
	const MEASUREMENTS_SIDEBAR_WIDTH = 360;

	// ── Derived template / measurement state ─────────────────────────────────
	const template = $derived(view ? FACIAL_TEMPLATES[view] : null);
	const landmarkDefs = $derived(template?.landmarks ?? []);
	const referenceLines = $derived(view === 'frontal' ? FRONTAL_LINES : PROFILE_LINES);

	const placedCount = $derived(landmarkDefs.filter((d) => landmarks[d.id]).length);
	const remainingCount = $derived(landmarkDefs.length - placedCount);
	const activeDef = $derived(activeId ? (landmarkDefs.find((d) => d.id === activeId) ?? null) : null);

	const landmarksXY = $derived.by(() => {
		const out: Record<string, { x: number; y: number }> = {};
		for (const id in landmarks) out[id] = { x: landmarks[id].x, y: landmarks[id].y };
		return out;
	});
	const measurements = $derived<FacialMeasurementResult[]>(
		view ? computeMeasurements(view, landmarksXY) : [],
	);
	const measurementNames = $derived<Record<string, string>>(
		Object.fromEntries((template?.measurements ?? []).map((m) => [m.id, m.name])),
	);

	function goBack() {
		history.back();
	}

	const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

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

	function firstUnplaced(): string | null {
		for (const d of landmarkDefs) if (!landmarks[d.id]) return d.id;
		return null;
	}

	// ── Load: patient, image bytes, existing analysis ───────────────────────

	onMount(() => {
		(async () => {
			if (!vault.path || !relPath || !patientId) {
				loadError = i18n.t.facialAnalysis.loadFailed;
				return;
			}
			try {
				const p = await getPatient(patientId);
				patientName = p ? `${p.firstname} ${p.lastname}`.trim() : '';

				const base64 = await invoke<string>('read_base64_file', {
					path: toAbsPath(relPath, vault.path),
				});
				imageByteSize = base64ByteSize(base64);
				originalDataUrl = `data:${getMimeType(fileName)};base64,${base64}`;

				// Decode once to learn natural dimensions before any flip work.
				const probe = new Image();
				probe.src = originalDataUrl;
				await probe.decode();
				naturalWidth = probe.naturalWidth;
				naturalHeight = probe.naturalHeight;

				const entry = await getFacialAnalysisEntryForSource(patientId, relPath);
				if (entry) {
					existingEntry = entry;
					try {
						const data = JSON.parse(entry.chart_data || '{}') as Partial<FacialAnalysisChartData>;
						view = data.view === 'frontal' ? 'frontal' : 'profile';
						mirrored = !!data.mirrored;
						landmarks = data.landmarks ? { ...data.landmarks } : {};
						notes = data.notes ?? '';
					} catch {
						view = 'profile';
					}
					activeId = firstUnplaced();
					feedback = { kind: 'info', text: i18n.t.facialAnalysis.existingLoaded };
				}

				await refreshWorking();
			} catch (e) {
				console.error('Facial analysis load failed:', e);
				loadError = i18n.t.facialAnalysis.loadFailed;
			}
		})();
	});

	/** Flip the source horizontally onto a canvas so the working frame is always canonical. */
	async function makeFlipped(dataUrl: string, w: number, h: number): Promise<string> {
		const img = new Image();
		img.src = dataUrl;
		await img.decode();
		const canvas = document.createElement('canvas');
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext('2d');
		if (!ctx) return dataUrl;
		ctx.translate(w, 0);
		ctx.scale(-1, 1);
		ctx.drawImage(img, 0, 0, w, h);
		return canvas.toDataURL('image/png');
	}

	async function refreshWorking() {
		if (!originalDataUrl) return;
		workingImageDataUrl =
			mirrored && naturalWidth > 0 && naturalHeight > 0
				? await makeFlipped(originalDataUrl, naturalWidth, naturalHeight)
				: originalDataUrl;
	}

	function confirmView() {
		view = chosenView;
		activeId = landmarkDefs[0]?.id ?? null;
	}

	async function toggleFlip() {
		if (view !== 'profile' || naturalWidth <= 0) return;
		mirrored = !mirrored;
		// Re-express every placed landmark in the new (flipped) canonical frame.
		for (const id in landmarks) landmarks[id].x = naturalWidth - landmarks[id].x;
		await refreshWorking();
	}

	function onImgLoad(w: number, h: number) {
		naturalWidth = w;
		naturalHeight = h;
		imageLoaded = true;
	}

	function handleImageClick(x: number, y: number) {
		if (!activeId) return;
		landmarks[activeId] = {
			x: clamp(x, 0, naturalWidth),
			y: clamp(y, 0, naturalHeight),
			placedBy: 'human',
			confidence: null,
		};
		activeId = firstUnplaced();
	}

	// ── Generate PDF + upsert documents row + timeline entry ────────────────

	/** Flatten the working image + overlay onto a natural-resolution canvas for the PDF. */
	async function buildAnnotatedImage(): Promise<string> {
		const img = new Image();
		img.src = workingImageDataUrl;
		await img.decode();
		const canvas = document.createElement('canvas');
		canvas.width = naturalWidth;
		canvas.height = naturalHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) return workingImageDataUrl;
		ctx.drawImage(img, 0, 0, naturalWidth, naturalHeight);

		const dim = Math.max(naturalWidth, naturalHeight) || 1;
		const dotR = dim / 150;
		const lineW = dim / 500;
		const font = dim / 55;

		// Reference lines
		ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
		ctx.lineWidth = lineW;
		ctx.lineCap = 'round';
		for (const [a, b] of referenceLines) {
			const pa = landmarks[a];
			const pb = landmarks[b];
			if (!pa || !pb) continue;
			ctx.beginPath();
			ctx.moveTo(pa.x, pa.y);
			ctx.lineTo(pb.x, pb.y);
			ctx.stroke();
		}

		// Landmark dots + labels
		ctx.font = `600 ${font}px sans-serif`;
		ctx.textBaseline = 'bottom';
		for (const def of landmarkDefs) {
			const lm = landmarks[def.id];
			if (!lm) continue;
			ctx.beginPath();
			ctx.arc(lm.x, lm.y, dotR, 0, Math.PI * 2);
			ctx.fillStyle = '#34d399';
			ctx.fill();
			ctx.lineWidth = lineW * 0.6;
			ctx.strokeStyle = '#0b1220';
			ctx.stroke();

			const label = def.id.toUpperCase();
			ctx.lineWidth = font * 0.18;
			ctx.strokeStyle = '#0b1220';
			ctx.strokeText(label, lm.x + dotR * 1.6, lm.y - dotR * 1.2);
			ctx.fillStyle = '#e5faf3';
			ctx.fillText(label, lm.x + dotR * 1.6, lm.y - dotR * 1.2);
		}

		return canvas.toDataURL('image/png');
	}

	async function handleGenerate() {
		if (generating || !view || !workingImageDataUrl || !naturalWidth || !naturalHeight || !vault.path) return;
		generating = true;
		feedback = null;
		try {
			const dateStr = formatDate(existingEntry?.entry_date ?? toLocalISODate());
			const annotatedImageDataUrl = await buildAnnotatedImage();
			const pdfBase64 = generateFacialAnalysisPdf({
				annotatedImageDataUrl,
				imageWidth: naturalWidth,
				imageHeight: naturalHeight,
				patientName,
				dateStr,
				measurements,
				measurementNames,
				notes,
			});

			// Write the PDF next to the source photo (overwrite = re-generate)
			const pdfName = `${baseName}_facial.pdf`;
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

			// Upsert the single facial_analysis timeline entry for this source image
			const title = `${i18n.t.facialAnalysis.title} — ${baseName}`;
			const description = escapeHtml(notes).replace(/\n/g, '<br>');
			const chart: FacialAnalysisChartData = {
				schemaVersion: 1,
				source: relPath,
				view,
				imageWidth: naturalWidth,
				imageHeight: naturalHeight,
				mirrored,
				landmarks: { ...landmarks },
				measurements,
				pdf: pdfRel,
				notes,
			};
			const chartData = JSON.stringify(chart);
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
					entry_type: 'facial_analysis',
					title,
					description,
					chart_data: chartData,
					attachments,
				});
			}

			feedback = { kind: 'success', text: i18n.t.facialAnalysis.generated };
		} catch (e) {
			console.error('Facial analysis generation failed:', e);
			feedback = { kind: 'error', text: i18n.t.facialAnalysis.generateFailed };
		} finally {
			generating = false;
		}
	}

	// ── Norm-bar helpers for the results panel ──────────────────────────────
	function unitSuffix(unit: FacialMeasurementResult['unit']): string {
		return unit === 'deg' ? '°' : unit === 'mm' ? ' mm' : unit === '%' ? '%' : '';
	}
	function fmt(v: number): string {
		return (Math.round(v * 10) / 10).toString();
	}
	/** 0..100 marker position of `value` inside the [std − 3sd, std + 3sd] window. */
	function markerPct(m: FacialMeasurementResult): number {
		if (m.standardValue == null || !m.standardDeviation) return 50;
		const lo = m.standardValue - 3 * m.standardDeviation;
		const span = 6 * m.standardDeviation;
		return clamp(((m.value - lo) / span) * 100, 0, 100);
	}
	function bandTone(m: FacialMeasurementResult): string {
		if (m.standardValue == null || !m.standardDeviation) return 'text-muted-foreground';
		const z = Math.abs((m.value - m.standardValue) / m.standardDeviation);
		return z <= 1 ? 'text-success' : z <= 2 ? 'text-warning' : 'text-destructive';
	}
</script>

{#if loadError}
	<FullScreenView open={true} title={i18n.t.facialAnalysis.title} scroll={false} onClose={goBack}>
		<div class="relative flex-1 min-h-0 overflow-hidden bg-neutral-900 flex items-center justify-center">
			<div class="max-w-md rounded-lg border border-destructive/50 bg-card p-6 text-center space-y-3">
				<p class="text-sm font-medium text-destructive">{i18n.t.facialAnalysis.loadFailed}</p>
				<button
					type="button"
					onclick={goBack}
					class="rounded-md border border-border bg-muted/40 hover:bg-muted px-4 py-2 text-xs font-medium transition-colors"
				>
					← {i18n.t.actions.back}
				</button>
			</div>
		</div>
	</FullScreenView>
{:else if !view}
	<!-- View chooser (only when no existing analysis fixes the view) -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
		<div class="w-full max-w-sm rounded-xl border border-border bg-background shadow-2xl p-6 space-y-5">
			<h2 class="text-base font-semibold text-foreground">{i18n.t.facialAnalysis.chooseViewTitle}</h2>
			<div class="space-y-2">
				{#each [{ v: 'profile', label: i18n.t.facialAnalysis.chooseViewProfile }, { v: 'frontal', label: i18n.t.facialAnalysis.chooseViewFrontal }] as opt (opt.v)}
					<button
						type="button"
						onclick={() => (chosenView = opt.v as FacialAnalysisView)}
						class="w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors
							{chosenView === opt.v
							? 'border-primary bg-primary/10 text-foreground'
							: 'border-border bg-muted/20 hover:bg-muted/40 text-foreground'}"
					>
						<span
							class="h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center
								{chosenView === opt.v ? 'border-primary' : 'border-muted-foreground/50'}"
						>
							{#if chosenView === opt.v}
								<span class="h-2 w-2 rounded-full bg-primary"></span>
							{/if}
						</span>
						{opt.label}
					</button>
				{/each}
			</div>
			<div class="flex justify-end gap-2 pt-1">
				<Button variant="outline" size="sm" onclick={goBack}>{i18n.t.actions.back}</Button>
				<Button size="sm" onclick={confirmView}>{i18n.t.facialAnalysis.chooseViewContinue}</Button>
			</div>
		</div>
	</div>
{:else}
	<FullScreenView open={true} title="{i18n.t.facialAnalysis.title} — {fileName}" scroll={false} onClose={goBack}>
		{#snippet actions()}
			{#if !landmarksPanelOpen}
				<Button variant="outline" size="sm" onclick={() => (landmarksPanelOpen = true)}>
					{i18n.t.facialAnalysis.landmarksTitle}
				</Button>
			{/if}
		{/snippet}

		<div class="flex-1 min-h-0 flex">
			<ImageViewport
				imageDataUrl={workingImageDataUrl}
				{naturalWidth}
				{naturalHeight}
				bind:brightness
				bind:contrast
				alt={fileName}
				hintText={i18n.t.facialAnalysis.viewerHints}
				onImageLoad={onImgLoad}
				onImageClick={handleImageClick}
			>
				{#snippet children()}
					<LandmarkLayer
						{naturalWidth}
						{naturalHeight}
						{landmarks}
						{landmarkDefs}
						{activeId}
						{referenceLines}
						onSelect={(id) => (activeId = id)}
					/>
				{/snippet}
				{#snippet overlayChrome()}
					{#if view === 'profile'}
						<button
							type="button"
							onclick={toggleFlip}
							title={i18n.t.facialAnalysis.flip}
							aria-label={i18n.t.facialAnalysis.flip}
							class="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-md border border-neutral-700/60 bg-neutral-900/90 backdrop-blur-sm px-2.5 py-1.5 text-xs font-medium text-neutral-200 shadow-lg hover:bg-neutral-800 transition-colors"
						>
							<span class="text-base leading-none">⇋</span>
							{i18n.t.facialAnalysis.flip}
						</button>
					{/if}
				{/snippet}
			</ImageViewport>

			<!-- Measurements — static sidebar fixed to the right edge, not a floating/draggable panel -->
			<aside
				class="shrink-0 flex flex-col border-l border-border bg-background overflow-hidden"
				style="width: {MEASUREMENTS_SIDEBAR_WIDTH}px;"
			>
				<div class="shrink-0 px-4 py-2.5 border-b border-border bg-muted/30">
					<span class="text-sm font-semibold text-foreground">{i18n.t.facialAnalysis.measurementsTitle}</span>
				</div>
				<div class="flex-1 min-h-0 flex flex-col gap-3 p-3">
					<!-- Measurements -->
					<div class="flex-1 min-h-[100px] overflow-y-auto -mx-1 px-1 space-y-2">
						{#if measurements.length === 0}
							<p class="text-xs text-muted-foreground py-2">—</p>
						{:else}
							{#each measurements as m (m.id)}
								<div class="rounded-md border border-border/60 bg-muted/10 px-2.5 py-2">
									<div class="flex items-baseline justify-between gap-2">
										<span class="text-xs font-medium text-foreground truncate">
											{measurementNames[m.id] ?? m.id}
										</span>
										<span class="text-xs font-mono font-semibold shrink-0 {bandTone(m)}">
											{fmt(m.value)}{unitSuffix(m.unit)}
										</span>
									</div>
									{#if m.standardValue != null && m.standardDeviation}
										<div class="mt-1.5 relative h-1.5 rounded-full bg-muted">
											<!-- ±1 SD band -->
											<div class="absolute inset-y-0 rounded-full bg-success/25" style="left: 33.33%; right: 33.33%;"></div>
											<!-- value marker -->
											<div
												class="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background {bandTone(m).replace('text-', 'bg-')}"
												style="left: {markerPct(m)}%;"
											></div>
										</div>
										<p class="mt-0.5 text-[10px] text-muted-foreground">
											norm {fmt(m.standardValue)}{unitSuffix(m.unit)} ± {fmt(m.standardDeviation)}
										</p>
									{/if}
								</div>
							{/each}
						{/if}
					</div>

					<!-- Notes -->
					<div class="shrink-0 flex flex-col gap-1">
						<span class="text-xs font-medium text-muted-foreground">{i18n.t.facialAnalysis.notesTitle}</span>
						<textarea
							bind:value={notes}
							placeholder={i18n.t.facialAnalysis.notesPlaceholder}
							class="min-h-[64px] max-h-[160px] resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/60 placeholder:text-muted-foreground/60"
						></textarea>
					</div>

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

					<Button onclick={handleGenerate} disabled={generating || !imageLoaded} class="shrink-0">
						{#if generating}
							<svg class="animate-spin h-3.5 w-3.5 mr-1.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
							</svg>
							{i18n.t.facialAnalysis.generating}
						{:else}
							{i18n.t.facialAnalysis.generate}
						{/if}
					</Button>
				</div>
			</aside>
		</div>

		<!-- Landmark checklist + guided placement -->
		{#if landmarksPanelOpen}
			<FloatingPanel
				title={i18n.t.facialAnalysis.landmarksTitle}
				initialX={landmarksPanelX}
				initialY={landmarksPanelY}
				onclose={() => (landmarksPanelOpen = false)}
			>
				<div class="h-full flex flex-col gap-3 p-3">
					<!-- Active landmark card -->
					{#if activeDef}
						<div class="shrink-0 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2.5">
							<p class="text-sm font-semibold text-foreground">
								{activeDef.name}
								<span class="text-muted-foreground font-normal">({activeDef.id})</span>
							</p>
							<p class="mt-0.5 text-xs text-muted-foreground">{activeDef.hint}</p>
						</div>
					{/if}

					<!-- Progress -->
					<p class="shrink-0 text-xs font-medium {remainingCount === 0 ? 'text-success' : 'text-muted-foreground'}">
						{remainingCount === 0
							? i18n.t.facialAnalysis.allLandmarksPlaced
							: i18n.t.facialAnalysis.landmarksRemaining.replace('{n}', String(remainingCount))}
					</p>

					<!-- Checklist -->
					<div class="flex-1 min-h-[80px] overflow-y-auto -mx-1 px-1 space-y-0.5">
						{#each landmarkDefs as def (def.id)}
							{@const placed = !!landmarks[def.id]}
							<button
								type="button"
								onclick={() => (activeId = def.id)}
								class="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors
									{def.id === activeId ? 'bg-primary/10 ring-1 ring-primary/40' : 'hover:bg-muted/50'}"
							>
								<span
									class="h-3.5 w-3.5 shrink-0 rounded-full flex items-center justify-center
										{placed ? 'bg-success/20 text-success' : 'border border-muted-foreground/40'}"
								>
									{#if placed}
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" class="h-2.5 w-2.5">
											<polyline points="20 6 9 17 4 12" />
										</svg>
									{/if}
								</span>
								<span class="text-foreground truncate">{def.name}</span>
								<span class="ml-auto text-[10px] uppercase text-muted-foreground/70">{def.id}</span>
							</button>
						{/each}
					</div>
				</div>
			</FloatingPanel>
		{/if}
	</FullScreenView>
{/if}
