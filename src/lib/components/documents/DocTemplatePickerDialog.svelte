<script lang="ts">
	import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { i18n } from '$lib/i18n';
	import { vault } from '$lib/stores/vault.svelte';
	import { docCategories } from '$lib/stores/categories.svelte';
	import {
		listDocTemplates, type DocTemplateInfo,
		formatFileSize, getMimeType, generateDestFilename,
	} from '$lib/services/files';
	import { insertDocument, insertTimelineEntry } from '$lib/services/db';
	import { copyDocTemplateToPatient } from '$lib/services/files';

	interface Props {
		patientId: string;
		patientFolder: string;
		open: boolean;
		onAdded?: () => void;
	}

	let { patientId, patientFolder, open = $bindable(), onAdded }: Props = $props();

	let templates = $state<DocTemplateInfo[]>([]);
	let selected  = $state<DocTemplateInfo | null>(null);
	let category  = $state('other');
	let isLoading = $state(false);
	let isAdding  = $state(false);
	let error     = $state('');

	$effect(() => {
		if (open) loadTemplates();
	});

	async function loadTemplates() {
		if (!vault.path) return;
		isLoading = true;
		error = '';
		try {
			templates = await listDocTemplates(vault.path);
			selected = null;
			category = docCategories.list[0]?.key ?? 'other';
		} catch (e) {
			error = String(e);
		} finally {
			isLoading = false;
		}
	}

	async function handleAdd() {
		if (!selected || !vault.path) return;
		isAdding = true;
		error = '';
		try {
			const mime = getMimeType(selected.filename);
			const destFilename = generateDestFilename(selected.filename);
			const categoryFolder = vault.categoryFolder(category);

			const [absPath, relPath, fileSize] = await copyDocTemplateToPatient(
				vault.path,
				selected.filename,
				patientFolder,
				categoryFolder,
				destFilename,
			);

			const doc = await insertDocument(patientId, {
				filename: destFilename,
				original_name: selected.filename,
				category,
				mime_type: mime,
				file_size: fileSize,
				abs_path: absPath,
				rel_path: relPath,
			});

			await insertTimelineEntry(patientId, {
				entry_date: new Date().toISOString().slice(0, 10),
				entry_type: 'document',
				title: selected.filename,
				treatment_category: category,
				document_id: doc.id,
				attachments: JSON.stringify([{ path: absPath, name: selected.filename, mime, size: fileSize }]),
			});

			onAdded?.();
			open = false;
		} catch (e) {
			error = String(e);
		} finally {
			isAdding = false;
		}
	}

	function fileIcon(filename: string) {
		const ext = filename.split('.').pop()?.toLowerCase() ?? '';
		if (['pdf'].includes(ext)) return 'pdf';
		if (['doc', 'docx'].includes(ext)) return 'word';
		if (['xls', 'xlsx'].includes(ext)) return 'sheet';
		return 'file';
	}
</script>

<Dialog bind:open>
	<DialogContent class="max-w-[520px] sm:max-w-[520px]">
		<DialogHeader>
			<DialogTitle class="flex items-center gap-2">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-teal-600">
					<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
					<polyline points="14 2 14 8 20 8"/>
					<line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
				</svg>
				{i18n.t.docTemplates.dialogTitle}
			</DialogTitle>
		</DialogHeader>

		<div class="flex flex-col gap-3 py-1">
			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}

			<!-- Template list -->
			<div class="flex flex-col gap-1 max-h-64 overflow-y-auto border border-border rounded-lg p-1">
				{#if isLoading}
					{#each [1,2,3] as _}
						<div class="h-9 animate-pulse rounded bg-muted/50"></div>
					{/each}
				{:else if templates.length === 0}
					<p class="text-sm text-muted-foreground text-center py-6">{i18n.t.docTemplates.noFiles}</p>
				{:else}
					{#each templates as tpl}
						{@const isSelected = selected?.rel_path === tpl.rel_path}
						<button
							type="button"
							onclick={() => (selected = tpl)}
							class="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors {isSelected ? 'bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800' : 'hover:bg-muted/50 border border-transparent'}"
						>
							<!-- File type icon -->
							{#if fileIcon(tpl.filename) === 'pdf'}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="h-5 w-5 shrink-0 text-red-500">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
									<polyline points="14 2 14 8 20 8"/>
									<line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>
								</svg>
							{:else if fileIcon(tpl.filename) === 'word'}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="h-5 w-5 shrink-0 text-blue-500">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
									<polyline points="14 2 14 8 20 8"/>
									<line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>
								</svg>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="h-5 w-5 shrink-0 text-muted-foreground">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
									<polyline points="14 2 14 8 20 8"/>
								</svg>
							{/if}

							<span class="flex-1 min-w-0">
								<span class="block text-sm font-medium truncate {isSelected ? 'text-teal-800 dark:text-teal-200' : 'text-foreground'}">{tpl.filename}</span>
								<span class="block text-[11px] text-muted-foreground/70">{formatFileSize(tpl.file_size)}</span>
							</span>

							{#if isSelected}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="h-4 w-4 shrink-0 text-teal-600">
									<polyline points="20 6 9 17 4 12"/>
								</svg>
							{/if}
						</button>
					{/each}
				{/if}
			</div>

			<!-- Category selector (only shown when a file is selected) -->
			{#if selected}
				<div class="flex items-center gap-2">
					<label class="text-xs font-medium text-muted-foreground w-20 shrink-0">{i18n.t.docTemplates.category}</label>
					<select
						bind:value={category}
						class="flex-1 h-8 px-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
					>
						{#each docCategories.list as cat}
							<option value={cat.key}>{cat.label}</option>
						{/each}
					</select>
				</div>
			{/if}
		</div>

		<!-- Footer -->
		<div class="flex justify-end gap-2 pt-2 border-t border-border mt-1">
			<Button variant="outline" onclick={() => (open = false)} disabled={isAdding}>
				{i18n.t.actions.cancel}
			</Button>
			<Button
				onclick={handleAdd}
				disabled={!selected || isAdding}
				class="bg-teal-600 hover:bg-teal-700 text-white border-teal-700"
			>
				{isAdding ? i18n.t.docTemplates.adding : i18n.t.docTemplates.addToPatient}
			</Button>
		</div>
	</DialogContent>
</Dialog>
