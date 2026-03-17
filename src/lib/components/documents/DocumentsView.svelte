<script lang="ts">
	import { onMount } from 'svelte';
	import type { PatientDocument } from '$lib/types';
	import { getDocuments, insertDocument, deleteDocument, insertTimelineEntry, deleteTimelineEntriesByDocumentId } from '$lib/services/db';
	import {
		pickFile,
		saveDocumentFile,
		deleteDocumentFile,
		getMimeType,
		inferCategory,
		generateDestFilename,
		toAbsPath,
	} from '$lib/services/files';
	import { vault } from '$lib/stores/vault.svelte';
	import { docCategories } from '$lib/stores/categories.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { staffLabel } from '$lib/utils/staff';
	import { i18n } from '$lib/i18n';
	import DocumentCard from './DocumentCard.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Separator } from '$lib/components/ui/separator';
	import {
		Dialog,
		DialogContent,
		DialogHeader,
		DialogTitle,
		DialogFooter,
		DialogDescription,
	} from '$lib/components/ui/dialog';

	let {
		patientId,
		patientFolder,
	}: {
		patientId: string;
		/** Vault subfolder name for this patient, e.g. "Smith_John_PT-ABC" */
		patientFolder: string;
	} = $props();

	let docs = $state<PatientDocument[]>([]);
	let isLoading = $state(true);
	let activeCategory = $state<string>('all');

	// Upload dialog
	let showUploadDialog = $state(false);
	let pickedPath = $state<string | null>(null);
	let pickedName = $state('');
	let uploadCategory = $state<string>('other');
	let uploadNotes = $state('');
	let uploadStaffId = $state<number | null>(null);
	let isUploading = $state(false);
	let uploadError = $state('');

	// Delete confirmation
	let docToDelete = $state<PatientDocument | null>(null);
	let isDeleting = $state(false);

	// Build filter pill list reactively from the categories store
	const filterPills = $derived([
		{ key: 'all', label: i18n.t.common.all, icon: '' },
		...docCategories.list.map((c) => ({ key: c.key, label: c.label, icon: c.icon })),
	]);

	let filteredDocs = $derived(
		activeCategory === 'all'
			? docs
			: docs.filter(d => d.category === activeCategory),
	);

	onMount(async () => {
		docs = await getDocuments(patientId);
		isLoading = false;
	});

	async function handlePickFile() {
		uploadError = '';
		const path = await pickFile();
		if (!path) return;
		pickedPath = path;
		const parts = path.replace(/\\/g, '/').split('/');
		pickedName = parts[parts.length - 1];
		const mime = getMimeType(pickedName);
		// inferCategory returns one of the built-in keys; user can override in the dialog
		uploadCategory = inferCategory(pickedName, mime);
		showUploadDialog = true;
	}

	async function handleUpload() {
		if (!pickedPath) return;
		if (!vault.isConfigured || !vault.path) {
			uploadError = 'Vault not configured. Please set up your vault in Settings.';
			return;
		}
		isUploading = true;
		uploadError = '';
		try {
			const destFilename = generateDestFilename(pickedPath);
			const mime = getMimeType(pickedName);
			const categoryFolder = vault.categoryFolder(uploadCategory);

			const { absPath, relPath, fileSize } = await saveDocumentFile({
				srcPath: pickedPath,
				vaultPath: vault.path,
				patientFolder,
				categoryFolder,
				destFilename,
			});

			const doc = await insertDocument(patientId, {
				filename: destFilename,
				original_name: pickedName,
				category: uploadCategory,
				mime_type: mime,
				file_size: fileSize,
				abs_path: relPath,
				rel_path: relPath,
				notes: uploadNotes.trim(),
			});

			// Auto-add a timeline entry so the file appears chronologically
			const today = new Date().toISOString().slice(0, 10);
			await insertTimelineEntry(patientId, {
				entry_date: today,
				entry_type: 'document',
				title: pickedName,
				description: uploadNotes.trim(),
				treatment_category: uploadCategory,
				document_id: doc.id,
				doctor_id: uploadStaffId,
				attachments: JSON.stringify([{
					path: absPath,
					name: pickedName,
					mime,
					size: fileSize,
				}]),
			});

			docs = await getDocuments(patientId);
			showUploadDialog = false;
			pickedPath = null;
			pickedName = '';
			uploadNotes = '';
			uploadStaffId = null;
			uploadCategory = docCategories.list[0]?.key ?? 'other';
		} catch (e) {
			uploadError = String(e);
		} finally {
			isUploading = false;
		}
	}

	function handleCancelUpload() {
		showUploadDialog = false;
		pickedPath = null;
		pickedName = '';
		uploadNotes = '';
		uploadError = '';
	}

	async function handleDeleteConfirm() {
		if (!docToDelete) return;
		isDeleting = true;
		try {
			await deleteDocumentFile(toAbsPath(docToDelete.rel_path || docToDelete.abs_path, vault.path ?? ''));
			await deleteTimelineEntriesByDocumentId(docToDelete.id);
			await deleteDocument(docToDelete.id);
			docs = await getDocuments(patientId);
		} finally {
			isDeleting = false;
			docToDelete = null;
		}
	}

	const inputClass = 'border-input bg-background flex h-9 w-full rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
</script>

{#if isLoading}
	<div class="h-48 animate-pulse rounded-lg border bg-muted"></div>
{:else}
	<div class="flex flex-col gap-4">

		<!-- Header -->
		<div class="flex items-center justify-between gap-4">
			<div>
				<h3 class="font-semibold text-sm uppercase tracking-wide text-muted-foreground">
					{i18n.t.documents.title}
				</h3>
				<p class="text-xs text-muted-foreground/70 mt-0.5">
					X-rays, photos, lab results, and other patient files.
				</p>
			</div>
			<Button size="sm" onclick={handlePickFile} disabled={!vault.isConfigured}>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
					<polyline points="17 8 12 3 7 8"/>
					<line x1="12" y1="3" x2="12" y2="15"/>
				</svg>
				{i18n.t.documents.uploadTitle}
			</Button>
		</div>

		{#if !vault.isConfigured}
			<div class="rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
				Vault not configured. Go to Settings to set up your vault folder before uploading files.
			</div>
		{/if}

		<Separator />

		<!-- Category filter pills (dynamic from docCategories store) -->
		<div class="flex flex-wrap gap-1.5">
			{#each filterPills as cat}
				{@const count = cat.key === 'all' ? docs.length : docs.filter(d => d.category === cat.key).length}
				<button
					type="button"
					onclick={() => (activeCategory = cat.key)}
					class={[
						'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors',
						activeCategory === cat.key
							? 'bg-primary text-primary-foreground'
							: 'bg-muted text-muted-foreground hover:text-foreground',
					].join(' ')}
				>
					{#if cat.icon}{cat.icon}{/if}
					{cat.label}
					{#if count > 0}
						<span class={[
							'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
							activeCategory === cat.key
								? 'bg-primary-foreground/20 text-primary-foreground'
								: 'bg-background text-foreground',
						].join(' ')}>
							{count}
						</span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Document grid -->
		{#if filteredDocs.length === 0}
			<div class="rounded-lg border border-dashed bg-muted/30 py-12 flex flex-col items-center gap-3 text-center">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-10 w-10 text-muted-foreground/50">
					<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
					<polyline points="14 2 14 8 20 8"/>
				</svg>
				<div>
					<p class="text-sm font-medium text-muted-foreground">{i18n.t.documents.noDocuments}</p>
					<p class="text-xs text-muted-foreground/70 mt-0.5">
						Click <strong>Upload File</strong> to add the first document.
					</p>
				</div>
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
				{#each filteredDocs as doc (doc.id)}
					<DocumentCard {doc} onDelete={(d) => (docToDelete = d)} />
				{/each}
			</div>
		{/if}
	</div>
{/if}

<!-- ── Upload Dialog ── -->
<Dialog bind:open={showUploadDialog}>
	<DialogContent class="max-w-md">
		<DialogHeader>
			<DialogTitle>{i18n.t.documents.uploadTitle}</DialogTitle>
			<DialogDescription>Add a file to this patient's vault folder.</DialogDescription>
		</DialogHeader>

		<div class="flex flex-col gap-4 py-2">
			<div class="flex flex-col gap-1.5">
				<Label class="text-xs">Selected File</Label>
				<div class="rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground truncate">
					{pickedName || '—'}
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label class="text-xs">Category</Label>
				<select class={inputClass} bind:value={uploadCategory}>
					{#each docCategories.list as cat}
						<option value={cat.key}>{cat.icon} {cat.label}</option>
					{/each}
				</select>
				<p class="text-[10px] text-muted-foreground/60">
					Folder: <code>{vault.categoryFolder(uploadCategory)}/</code>
					· <a href="/settings" class="underline hover:text-foreground">Manage categories</a>
				</p>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label class="text-xs">Staff <span class="text-muted-foreground">(optional)</span></Label>
				<select class={inputClass} bind:value={uploadStaffId}>
					<option value={null}>— None —</option>
					{#each doctors.list as doc (doc.id)}
						<option value={doc.id}>{staffLabel(doc)}{doc.specialty ? ` · ${doc.specialty}` : ''}</option>
					{/each}
				</select>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label class="text-xs">Notes <span class="text-muted-foreground">(optional)</span></Label>
				<input type="text" class={inputClass} placeholder="Brief description…" bind:value={uploadNotes} />
			</div>

			{#if uploadError}
				<p class="text-xs text-destructive rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2">
					{uploadError}
				</p>
			{/if}
		</div>

		<DialogFooter>
			<Button variant="outline" onclick={handleCancelUpload} disabled={isUploading}>{i18n.t.actions.cancel}</Button>
			<Button onclick={handleUpload} disabled={isUploading || !pickedPath}>
				{isUploading ? i18n.t.common.loading : i18n.t.actions.save}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- ── Delete Confirmation ── -->
<Dialog open={docToDelete !== null} onOpenChange={(o) => { if (!o) docToDelete = null; }}>
	<DialogContent>
		<DialogHeader>
			<DialogTitle>{i18n.t.documents.deleteFile}</DialogTitle>
			<DialogDescription>
				Delete <strong>{docToDelete?.original_name}</strong>? The file will be permanently removed from disk. This cannot be undone.
			</DialogDescription>
		</DialogHeader>
		<DialogFooter>
			<Button variant="outline" onclick={() => (docToDelete = null)} disabled={isDeleting}>{i18n.t.actions.cancel}</Button>
			<Button variant="destructive" onclick={handleDeleteConfirm} disabled={isDeleting}>
				{isDeleting ? i18n.t.common.loading : i18n.t.actions.delete}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>
