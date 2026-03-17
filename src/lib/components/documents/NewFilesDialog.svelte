<script lang="ts">
	import { insertDocument, insertTimelineEntry } from '$lib/services/db';
	import { getMimeType, inferCategory, type VaultFileInfo } from '$lib/services/files';
	import { docCategories } from '$lib/stores/categories.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { i18n } from '$lib/i18n';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogDescription,
		DialogFooter,
	} from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';

	let {
		open = $bindable(false),
		pendingFiles,
		patientId,
		onDone,
	}: {
		open: boolean;
		pendingFiles: VaultFileInfo[];
		patientId: string;
		onDone: () => void;
	} = $props();

	// ── Per-step state ──────────────────────────────────────────────────

	let currentIndex = $state(0);
	let isSaving = $state(false);
	let saveError = $state('');

	const current = $derived(pendingFiles[currentIndex] ?? null);

	// Per-file form fields — reset whenever the current file changes
	let entryDate     = $state('');
	let category      = $state('');
	let staffId       = $state<number | null>(null);
	let notes         = $state('');

	$effect(() => {
		// Reacts to currentIndex or pendingFiles changing
		const f = pendingFiles[currentIndex];
		if (!f) return;
		const mime = getMimeType(f.filename);
		entryDate = f.modified_at || new Date().toISOString().slice(0, 10);
		category  = inferCategory(f.filename, mime);
		staffId   = null;
		notes     = '';
		saveError = '';
	});

	const progress = $derived(
		pendingFiles.length > 0
			? `${currentIndex + 1} of ${pendingFiles.length}`
			: '',
	);

	function advance() {
		if (currentIndex + 1 < pendingFiles.length) {
			currentIndex += 1;
		} else {
			// All files processed
			open = false;
			onDone();
		}
	}

	async function handleAddToTimeline() {
		if (!current) return;
		isSaving = true;
		saveError = '';
		try {
			const mime = getMimeType(current.filename);

			// Register the file in the documents table (already on disk — no copy needed)
			const doc = await insertDocument(patientId, {
				filename:      current.filename,
				original_name: current.filename,
				category,
				mime_type:     mime,
				file_size:     current.file_size,
				abs_path:      current.abs_path,
				rel_path:      current.rel_path,
				notes:         notes.trim(),
			});

			// Create the corresponding timeline entry
			await insertTimelineEntry(patientId, {
				entry_date:         entryDate,
				entry_type:         'document',
				title:              current.filename,
				description:        notes.trim() || undefined,
				treatment_category: category,
				document_id:        doc.id,
				doctor_id:          staffId,
				attachments:        JSON.stringify([{
					path: current.rel_path,
					name: current.filename,
					mime,
					size: current.file_size,
				}]),
			});

			advance();
		} catch (e) {
			saveError = String(e);
		} finally {
			isSaving = false;
		}
	}

	function handleSkip() {
		advance();
	}

	function handleDismissAll() {
		open = false;
		onDone();
	}

	const inputClass = 'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
</script>

<Dialog bind:open>
	<DialogContent class="max-w-md">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<!-- Inbox icon -->
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 text-primary shrink-0">
					<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
					<path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>
				</svg>
				New Files Detected
			</DialogTitle>
			<DialogDescription>
				{pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''} found in this patient's vault
				folder that {pendingFiles.length !== 1 ? 'are' : 'is'} not yet in the timeline.
				Review each file and choose when to add it.
			</DialogDescription>
		</DialogHeader>

		{#if current}
			<!-- Progress indicator -->
			<div class="flex items-center justify-between mb-1">
				<span class="text-xs text-muted-foreground font-medium uppercase tracking-wide">File {progress}</span>
				<div class="flex gap-0.5">
					{#each pendingFiles as _, i (i)}
						<span class="h-1.5 w-4 rounded-full {i === currentIndex ? 'bg-primary' : i < currentIndex ? 'bg-primary/30' : 'bg-muted'}"></span>
					{/each}
				</div>
			</div>

			<!-- File name -->
			<div class="rounded-md bg-muted/50 border border-border px-4 py-3 flex items-start gap-3">
				<!-- File icon based on MIME -->
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-8 w-8 text-muted-foreground/60 shrink-0 mt-0.5">
					<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
					<polyline points="14 2 14 8 20 8"/>
				</svg>
				<div class="min-w-0">
					<p class="text-sm font-semibold break-all leading-snug">{current.filename}</p>
					<p class="text-xs text-muted-foreground mt-0.5">
						{current.category_folder} · {(current.file_size / 1024).toFixed(1)} KB
					</p>
				</div>
			</div>

			<!-- Form fields -->
			<div class="flex flex-col gap-3 mt-1">

				<!-- Date -->
				<div class="grid grid-cols-2 gap-3">
					<div class="flex flex-col gap-1.5">
						<label for="nfd-date" class="text-xs font-medium">{i18n.t.common.date}</label>
						<input id="nfd-date" type="date" bind:value={entryDate} class={inputClass} />
						<p class="text-[10px] text-muted-foreground/60">Pre-filled from file's last modified date</p>
					</div>

					<!-- Category -->
					<div class="flex flex-col gap-1.5">
						<label for="nfd-category" class="text-xs font-medium">{i18n.t.documents.category}</label>
						<select id="nfd-category" bind:value={category} class={inputClass}>
							{#each docCategories.list as cat (cat.key)}
								<option value={cat.key}>{cat.icon} {cat.label}</option>
							{/each}
						</select>
					</div>
				</div>

				<!-- Staff -->
				<div class="flex flex-col gap-1.5">
					<label for="nfd-staff" class="text-xs font-medium">{i18n.t.staff.title} <span class="text-muted-foreground font-normal">({i18n.t.common.optional})</span></label>
					<select id="nfd-staff" bind:value={staffId} class={inputClass}>
						<option value={null}>— None —</option>
						{#each doctors.list as doc (doc.id)}
							<option value={doc.id}>{staffLabel(doc)}{doc.specialty ? ` · ${doc.specialty}` : ''}</option>
						{/each}
					</select>
				</div>

				<!-- Notes -->
				<div class="flex flex-col gap-1.5">
					<label for="nfd-notes" class="text-xs font-medium">{i18n.t.common.notes} <span class="text-muted-foreground font-normal">({i18n.t.common.optional})</span></label>
					<input id="nfd-notes" type="text" bind:value={notes} placeholder="Brief description of this file…" class={inputClass} />
				</div>

				{#if saveError}
					<p class="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
						{saveError}
					</p>
				{/if}
			</div>
		{/if}

		<DialogFooter class="flex items-center gap-2 mt-2">
			<!-- Dismiss all — leftmost, understated -->
			<button
				type="button"
				onclick={handleDismissAll}
				class="mr-auto text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline transition-colors"
			>
				{i18n.t.actions.dismiss}
			</button>

			<!-- Skip this file -->
			<Button variant="outline" onclick={handleSkip} disabled={isSaving}>
				{i18n.t.actions.next}
			</Button>

			<!-- Add to timeline -->
			<Button onclick={handleAddToTimeline} disabled={isSaving || !entryDate}>
				{isSaving ? i18n.t.common.loading : i18n.t.timeline.addEntry}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
