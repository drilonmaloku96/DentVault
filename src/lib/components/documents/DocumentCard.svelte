<script lang="ts">
	import type { PatientDocument } from '$lib/types';
	import { getFileDisplayUrl, isImageMime, formatFileSize, openDocumentFile, toAbsPath } from '$lib/services/files';
	import { docCategories } from '$lib/stores/categories.svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { i18n } from '$lib/i18n';
	import { formatDate } from '$lib/utils';

	let {
		doc,
		onEdit,
		onDelete,
	}: {
		doc: PatientDocument;
		onEdit: (doc: PatientDocument) => void;
		onDelete: (doc: PatientDocument) => void;
	} = $props();

	let isImageError = $state(false);
	let resolvedPath = $derived(toAbsPath(doc.rel_path || doc.abs_path, vault.path ?? ''));
	let showImage = $derived(isImageMime(doc.mime_type) && !isImageError);

	// getFileDisplayUrl is async (connected mode fetches bytes over HTTP and returns a
	// blob: URL — see files.ts) so this can't be a plain $derived; the effect's cleanup
	// revokes the blob URL when doc changes or the card unmounts.
	let assetUrl = $state('');
	$effect(() => {
		let cancelled = false;
		let objectUrl: string | null = null;
		getFileDisplayUrl(doc.rel_path || doc.abs_path, vault.path ?? '')
			.then((url) => {
				if (cancelled) return;
				assetUrl = url;
				if (url.startsWith('blob:')) objectUrl = url;
			})
			.catch(() => { isImageError = true; });
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	});

	// Derived from the reactive categories store — updates if the user renames/adds categories
	const categoryLabel = $derived(docCategories.getLabel(doc.category));
	const categoryColor = $derived(docCategories.getColor(doc.category));
	const categoryIcon  = $derived(docCategories.getIcon(doc.category));



	async function handleOpen() {
		try {
			await openDocumentFile(resolvedPath);
		} catch (e) {
			console.error('Failed to open document:', e);
		}
	}
</script>

<div class="rounded-lg border bg-card flex flex-col overflow-hidden group transition-all hover:border-primary/40 hover:shadow-sm">

	<!-- Thumbnail / Preview area -->
	<div class="relative bg-muted flex items-center justify-center h-32 overflow-hidden">
		{#if showImage}
			<!-- svelte-ignore a11y_img_redundant_alt -->
			<img
				src={assetUrl}
				alt={doc.original_name}
				class="object-cover w-full h-full"
				onerror={() => (isImageError = true)}
			/>
		{:else}
			<!-- File type icon -->
			<div class="flex flex-col items-center gap-1.5 text-muted-foreground">
				{#if doc.mime_type === 'application/pdf'}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-10 w-10">
						<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
						<polyline points="14 2 14 8 20 8"/>
						<path d="M9 13h1a1 1 0 0 1 0 2H9v-4h1a1 1 0 0 1 0 2"/>
						<path d="M14 13v4"/>
						<path d="M14 13h1.5a1 1 0 0 1 0 2H14"/>
					</svg>
					<span class="text-xs font-medium">PDF</span>
				{:else if doc.mime_type === 'application/dicom' || doc.original_name.toLowerCase().endsWith('.dcm')}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-10 w-10">
						<rect width="18" height="18" x="3" y="3" rx="2"/>
						<path d="M8 12h8M12 8v8"/>
					</svg>
					<span class="text-xs font-medium">DICOM</span>
				{:else}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="h-10 w-10">
						<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
						<polyline points="14 2 14 8 20 8"/>
					</svg>
					<span class="text-xs font-medium uppercase">{doc.original_name.split('.').pop()}</span>
				{/if}
			</div>
		{/if}

		<!-- Action buttons — appear on hover -->
		<div class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
			<button
				type="button"
				onclick={handleOpen}
				class="rounded-lg bg-white/90 dark:bg-black/70 text-foreground px-3 py-1.5 text-xs font-medium shadow hover:bg-white dark:hover:bg-black transition-colors"
				title="Open with default app"
			>
				{i18n.t.documents.openFile}
			</button>
			<button
				type="button"
				onclick={() => onEdit(doc)}
				class="rounded-lg bg-white/90 dark:bg-black/70 text-foreground p-1.5 shadow hover:bg-white dark:hover:bg-black transition-colors"
				title={i18n.t.documents.editFile}
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
					<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
				</svg>
			</button>
			<button
				type="button"
				onclick={() => onDelete(doc)}
				class="rounded-lg bg-destructive/90 text-destructive-foreground px-3 py-1.5 text-xs font-medium shadow hover:bg-destructive transition-colors"
				title={i18n.t.documents.deleteFile}
			>
				{i18n.t.actions.delete}
			</button>
		</div>
	</div>

	<!-- Metadata -->
	<div class="p-3 flex flex-col gap-1.5">
		<p class="text-xs font-medium truncate leading-tight" title={doc.original_name}>
			{doc.original_name}
		</p>
		<div class="flex items-center justify-between gap-2">
			<span class={['rounded-full px-2 py-0.5 text-xs font-medium', categoryColor].join(' ')}>
				{categoryIcon} {categoryLabel}
			</span>
			<span class="text-xs text-muted-foreground shrink-0">
				{formatFileSize(doc.file_size)}
			</span>
		</div>
		<p class="text-xs text-muted-foreground">{formatDate(doc.created_at)}</p>
		{#if doc.notes}
			<p class="text-xs text-muted-foreground truncate">{doc.notes}</p>
		{/if}
	</div>
</div>
