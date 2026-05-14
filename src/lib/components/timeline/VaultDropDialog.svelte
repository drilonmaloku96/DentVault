<script lang="ts">
	import { tick } from 'svelte';
	import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { vault } from '$lib/stores/vault.svelte';
	import {
		listPatientFolders,
		createPatientSubfolder,
		movePatientFolder,
		copyFileToVault,
		type FolderNode,
	} from '$lib/services/files';
	import { getMimeType, formatFileSize } from '$lib/services/files';
	import { insertDocument } from '$lib/services/db';
	import { insertTimelineEntry } from '$lib/services/db';

	let {
		open = $bindable(false),
		patientId,
		patientFolder,
		filePaths,
		onSaved,
	}: {
		open: boolean;
		patientId: string;
		patientFolder: string;
		filePaths: string[];
		onSaved?: () => void;
	} = $props();

	let tree        = $state<FolderNode[]>([]);
	let selected    = $state('');            // rel_path of selected folder
	let expanded    = $state<Set<string>>(new Set());
	let isSaving    = $state(false);
	let loadError   = $state('');

	// Create-folder inline state
	let creatingUnder  = $state<string | null>(null);  // rel_path of parent, '' = root
	let newFolderName  = $state('');
	let createError    = $state('');
	let newFolderInput = $state<HTMLInputElement | null>(null);

	// Pointer-based drag-to-reorganize (HTML5 draggable triggers Tauri file-drop events)
	let draggingRel = $state<string | null>(null);
	let dragOverRel = $state<string | null>(null);
	let ghostX      = $state(0);
	let ghostY      = $state(0);
	let ghostName   = $state('');

	// ── Load tree whenever dialog opens ───────────────────────────────────

	$effect(() => {
		if (open && vault.path && patientFolder) {
			loadTree();
		}
		if (!open) {
			selected = '';
			expanded = new Set();
			creatingUnder = null;
			newFolderName = '';
			createError = '';
			draggingRel = null;
			dragOverRel = null;
			ghostX = 0; ghostY = 0; ghostName = '';
			loadError = '';
		}
	});

	async function loadTree() {
		try {
			tree = await listPatientFolders(vault.path!, patientFolder);
			loadError = '';
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to load folders';
		}
	}

	// ── Expand / select ───────────────────────────────────────────────────

	function toggleExpand(rel: string) {
		const next = new Set(expanded);
		if (next.has(rel)) next.delete(rel); else next.add(rel);
		expanded = next;
	}

	function selectFolder(rel: string) {
		selected = rel;
	}

	// ── Create folder ─────────────────────────────────────────────────────

	async function startCreate(parentRel: string, e: MouseEvent) {
		e.stopPropagation();
		// Ensure parent is expanded so new folder shows
		if (parentRel !== '') {
			const next = new Set(expanded);
			next.add(parentRel);
			expanded = next;
		}
		creatingUnder = parentRel;
		newFolderName = '';
		createError = '';
		await tick();
		newFolderInput?.focus();
	}

	async function confirmCreate() {
		if (!newFolderName.trim() || creatingUnder === null) return;
		try {
			const rel = await createPatientSubfolder(
				vault.path!,
				patientFolder,
				creatingUnder,
				newFolderName.trim(),
			);
			await loadTree();
			// Auto-select the new folder and expand its parent
			selected = rel;
			if (creatingUnder !== '') {
				const next = new Set(expanded);
				next.add(creatingUnder);
				expanded = next;
			}
			creatingUnder = null;
			newFolderName = '';
		} catch (e) {
			createError = e instanceof Error ? e.message : 'Failed to create folder';
		}
	}

	function cancelCreate() {
		creatingUnder = null;
		newFolderName = '';
		createError = '';
	}

	// ── Pointer-based drag-to-reorganize ─────────────────────────────────
	// Uses setPointerCapture + elementsFromPoint instead of HTML5 draggable,
	// because draggable="true" triggers Tauri's tauri://drag-enter events.

	function onGripPointerDown(e: PointerEvent, rel: string) {
		if (e.button !== 0) return;
		e.preventDefault();
		draggingRel = rel;
		ghostName   = rel.split('/').pop() ?? rel;
		ghostX      = e.clientX + 14;
		ghostY      = e.clientY;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onGripPointerMove(e: PointerEvent) {
		if (!draggingRel) return;
		ghostX = e.clientX + 14;
		ghostY = e.clientY;
		// Find which element under the cursor has data-folder-rel.
		// Empty string = root container; specific string = a folder; undefined = outside valid area.
		// Ghost has pointer-events:none so it won't be hit-tested.
		dragOverRel = null;
		for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
			const rel = (el as HTMLElement).dataset?.folderRel;
			if (rel !== undefined) { dragOverRel = rel; break; } // '' is valid (root)
		}
	}

	async function onGripPointerUp(e: PointerEvent) {
		if (!draggingRel) return;
		const src  = draggingRel;
		const dest = dragOverRel;
		draggingRel = null;
		dragOverRel = null;
		if (dest === null || dest === src || dest.startsWith(src + '/')) return;
		const srcParent = src.includes('/') ? src.slice(0, src.lastIndexOf('/')) : '';
		if (srcParent === dest) return;
		try {
			await movePatientFolder(vault.path!, patientFolder, src, dest);
			if (selected === src || selected.startsWith(src + '/')) {
				const srcName = src.includes('/') ? src.slice(src.lastIndexOf('/') + 1) : src;
				selected = `${dest}/${srcName}`;
			}
			await loadTree();
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Failed to move folder';
		}
	}

	function onGripPointerCancel() {
		draggingRel = null;
		dragOverRel = null;
	}

	// ── Save files ────────────────────────────────────────────────────────

	async function handleSave() {
		if (!vault.path || !selected || isSaving) return;
		isSaving = true;
		try {
			const today = new Date().toISOString().slice(0, 10);
			for (const srcPath of filePaths) {
				const name         = srcPath.replace(/\\/g, '/').split('/').pop() ?? srcPath;
				const destRel      = `${selected}/${name}`;          // relative to patient folder
				const vaultRelPath = `${patientFolder}/${destRel}`;  // relative to vault root
				const destAbs      = `${vault.path}/${vaultRelPath}`;
				const fileSize = await copyFileToVault(srcPath, destAbs);

				const mime   = getMimeType(name);
				const catKey = selected.split('/')[0]; // top-level folder = category
				const doc = await insertDocument(patientId, {
					filename: name,
					original_name: name,
					category: catKey,
					mime_type: mime,
					file_size: fileSize,
					abs_path: destAbs,
					rel_path: vaultRelPath,
					notes: '',
				});
				await insertTimelineEntry(patientId, {
					entry_date: today,
					entry_type: 'document',
					title: name,
					description: '',
					treatment_category: catKey,
					document_id: doc.id,
					attachments: JSON.stringify([{ path: vaultRelPath, name, mime, size: fileSize }]),
				});
			}
			open = false;
			onSaved?.();
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Failed to save file';
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog bind:open>
	<DialogContent class="max-w-md sm:max-w-md flex flex-col gap-0 p-0 overflow-hidden max-h-[80vh]">

		<DialogHeader class="px-5 pt-5 pb-3 shrink-0">
			<DialogTitle class="text-sm font-semibold">Add to patient vault</DialogTitle>
		</DialogHeader>

		<!-- Files being dropped -->
		<div class="px-5 pb-3 shrink-0 border-b border-border/50">
			{#each filePaths as fp}
				{@const name = fp.replace(/\\/g, '/').split('/').pop() ?? fp}
				<div class="flex items-center gap-2 text-xs text-muted-foreground">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 text-primary/60">
						<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
					</svg>
					<span class="font-medium text-foreground truncate">{name}</span>
				</div>
			{/each}
		</div>

		<!-- Folder tree — data-folder-rel="" marks the container as the root drop target -->
		<div class="flex-1 overflow-y-auto min-h-0 py-2" data-folder-rel="">
			{#if loadError}
				<p class="px-5 text-xs text-destructive">{loadError}</p>
			{:else if tree.length === 0}
				<p class="px-5 text-xs text-muted-foreground italic">No folders found</p>
			{:else}
				{#each tree as node}
					{@render folderRow(node, 0)}
				{/each}
			{/if}

			<!-- Inline create at root level -->
			{#if creatingUnder === ''}
				{@render createInput('')}
			{/if}
		</div>

		<!-- Root-level "New folder" button — also a root drop target -->
		<div
			data-folder-rel=""
			class="shrink-0 px-4 pb-2 pt-1 border-t border-border/40 flex items-center gap-2
			       {dragOverRel === '' ? 'bg-primary/5 ring-1 ring-inset ring-primary/20 rounded-b-lg' : ''}"
		>
			<button
				type="button"
				onclick={(e) => startCreate('', e)}
				class="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
					<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
				</svg>
				New folder
			</button>
			{#if dragOverRel === ''}
				<span class="text-[11px] text-primary/70 ml-auto">Drop here → root</span>
			{/if}
		</div>

		<DialogFooter class="px-5 py-3 shrink-0 border-t border-border/50 gap-2">
			<Button variant="ghost" onclick={() => (open = false)} class="text-muted-foreground">Cancel</Button>
			<Button
				onclick={handleSave}
				disabled={!selected || isSaving}
				class="min-w-[90px]"
			>
				{#if isSaving}
					<svg class="animate-spin h-3.5 w-3.5 mr-1.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
					</svg>
					Saving…
				{:else}
					Save here
				{/if}
			</Button>
		</DialogFooter>
	</DialogContent>
</Dialog>

<!-- Drag ghost — follows cursor, pointer-events:none so elementsFromPoint ignores it -->
{#if draggingRel}
	<div
		class="fixed z-[9999] pointer-events-none flex items-center gap-1.5 rounded-md border border-primary bg-background px-2 py-1 text-xs font-medium text-primary shadow-lg"
		style="left: {ghostX}px; top: {ghostY}px; transform: translateY(-50%);"
	>
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0">
			<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
		</svg>
		{ghostName}
	</div>
{/if}

{#snippet folderRow(node: FolderNode, depth: number)}
	{@const isSelected   = selected === node.rel_path}
	{@const isExpanded   = expanded.has(node.rel_path)}
	{@const isDragging   = draggingRel === node.rel_path}
	{@const isDragOver   = dragOverRel === node.rel_path}
	{@const isDescendant = draggingRel ? (node.rel_path === draggingRel || node.rel_path.startsWith(draggingRel + '/')) : false}
	{@const indent = depth * 16}

	<div class="group">
		<!-- Row: chevron + icon + name + grip + add-subfolder button -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			role="button"
			tabindex="0"
			data-folder-rel={node.rel_path}
			onclick={() => { if (!draggingRel) { selectFolder(node.rel_path); if (node.children.length) toggleExpand(node.rel_path); } }}
			onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFolder(node.rel_path); if (node.children.length) toggleExpand(node.rel_path); } }}
			style="padding-left: {12 + indent}px;"
			class="select-none flex items-center gap-1.5 py-1.5 pr-2 text-xs rounded-md transition-colors
			       {isSelected  ? 'bg-primary/10 text-primary font-medium' : 'text-foreground/80 hover:bg-muted/60'}
			       {isDragOver  ? 'ring-1 ring-primary ring-inset bg-primary/8' : ''}
			       {isDragging  ? 'opacity-40' : ''}
			       {draggingRel ? 'cursor-default' : 'cursor-pointer'}"
		>
			<!-- Expand chevron (stops click propagation so it only expands, not selects) -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				class="w-3.5 h-3.5 shrink-0 flex items-center justify-center text-muted-foreground/50"
				onclick={(e) => { if (node.children.length) { e.stopPropagation(); toggleExpand(node.rel_path); } }}
			>
				{#if node.children.length}
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
						class="h-2.5 w-2.5 transition-transform {isExpanded ? 'rotate-90' : ''}">
						<polyline points="9 18 15 12 9 6"/>
					</svg>
				{/if}
			</span>

			<!-- Folder icon -->
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
				class="h-3.5 w-3.5 shrink-0 {isSelected ? 'text-primary' : 'text-amber-500/70'}">
				<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
			</svg>

			<span class="flex-1 truncate">{node.name}</span>

			<!-- Drag grip — pointer-event drag handle -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				onpointerdown={(e) => onGripPointerDown(e, node.rel_path)}
				onpointermove={onGripPointerMove}
				onpointerup={onGripPointerUp}
				onpointercancel={onGripPointerCancel}
				class="opacity-0 group-hover:opacity-40 {draggingRel === node.rel_path ? '!opacity-60 cursor-grabbing' : 'cursor-grab'} text-muted-foreground shrink-0 touch-none"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
					<circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>
					<circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/>
				</svg>
			</span>

			<!-- Add subfolder (stops propagation to avoid also selecting/expanding) -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<span
				role="button"
				tabindex="0"
				title="New subfolder"
				onclick={(e) => startCreate(node.rel_path, e)}
				onkeydown={(e) => { if (e.key === 'Enter') startCreate(node.rel_path, e as unknown as MouseEvent); }}
				class="opacity-0 group-hover:opacity-60 hover:!opacity-100 text-muted-foreground hover:text-foreground shrink-0 p-0.5 rounded transition-opacity"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
					<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
				</svg>
			</span>
		</div>

		<!-- Children -->
		{#if isExpanded && node.children.length}
			{#each node.children as child}
				{@render folderRow(child, depth + 1)}
			{/each}
		{/if}

		<!-- Inline create-subfolder input -->
		{#if creatingUnder === node.rel_path}
			{@render createInput(node.rel_path, indent + 16)}
		{/if}
	</div>
{/snippet}

{#snippet createInput(parentRel: string, indentPx: number = 0)}
	<div class="flex items-center gap-1.5 pr-3 py-1" style="padding-left: {12 + indentPx + 20}px;">
		<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 text-amber-500/60">
			<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
		</svg>
		<input
			bind:this={newFolderInput}
			bind:value={newFolderName}
			type="text"
			placeholder="Folder name…"
			onkeydown={(e) => {
				if (e.key === 'Enter') { e.preventDefault(); confirmCreate(); }
				if (e.key === 'Escape') cancelCreate();
			}}
			class="flex-1 min-w-0 rounded border border-primary/40 bg-background px-2 py-0.5 text-xs outline-none focus:border-primary"
		/>
		<button type="button" onclick={confirmCreate}
			class="shrink-0 text-primary hover:text-primary/80 text-xs font-medium">✓</button>
		<button type="button" onclick={cancelCreate}
			class="shrink-0 text-muted-foreground hover:text-foreground text-xs">✕</button>
	</div>
	{#if createError}
		<p class="text-[11px] text-destructive px-5 pb-1">{createError}</p>
	{/if}
{/snippet}
