<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { vault } from '$lib/stores/vault.svelte';
	import {
		listVaultFiles, openDocumentFile, formatFileSize, type VaultFileInfo,
		listDocTemplates, saveDocTemplate, deleteDocTemplate, pickFile,
		generateDestFilename, type DocTemplateInfo,
		saveDocumentFile, getMimeType,
	} from '$lib/services/files';
	import type { Patient } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { activePatient } from '$lib/stores/activePatient.svelte';
	import { insertDocument, insertTimelineEntry } from '$lib/services/db';
	import { docCategories } from '$lib/stores/categories.svelte';

	let { patient }: { patient: Patient } = $props();

	let files       = $state<VaultFileInfo[]>([]);
	let isLoading   = $state(true);
	let openFolders = $state<Record<string, boolean>>({});

	// !Documents template folder
	let docTemplates     = $state<DocTemplateInfo[]>([]);
	let templatesOpen    = $state(true);
	let isAddingTemplate = $state(false);

	// Open state for !Documents sub-folders (keyed by rel_path of the folder)
	let openTemplateFolders = $state<Record<string, boolean>>({});

	// ── Mouse-based drag-and-drop state ────────────────────────────────
	// HTML5 DnD API does NOT work in WKWebView (Tauri macOS). We use plain
	// mouse events instead: mousedown on template → track mousemove globally
	// → detect folder under cursor via data-drop-folder attribute → mouseup = drop.
	let draggingTemplate   = $state<DocTemplateInfo | null>(null);
	let isDraggingTemplate = $state(false);
	let dragOverPath       = $state<string | null>(null);
	let dragStartPos = { x: 0, y: 0 };
	const DRAG_THRESHOLD = 5; // px of movement before drag activates

	// ── Standard category folder names (language-aware) ────────────────
	const standardFolders = $derived(
		docCategories.list.map(c => vault.categoryFolder(c.key))
	);
	const folderToKey = $derived(
		Object.fromEntries(docCategories.list.map(c => [vault.categoryFolder(c.key), c.key]))
	);

	const patientFolder = $derived(
		vault.path
			? vault.patientFolder(patient.lastname, patient.firstname, patient.patient_id)
			: '',
	);

	// ── Tree building ───────────────────────────────────────────────────

	interface TemplateFolderNode {
		name: string;
		relPath: string;
		absPath: string;
		files: DocTemplateInfo[];
		children: TemplateFolderNode[];
	}

	interface PatientFolderNode {
		name: string;
		folderPath: string;
		absPath: string;
		files: VaultFileInfo[];
		children: PatientFolderNode[];
	}

	function buildTemplateTree(templates: DocTemplateInfo[]): TemplateFolderNode {
		const root: TemplateFolderNode = {
			name: '!Documents', relPath: '',
			absPath: vault.path ? `${vault.path}/!Documents` : '',
			files: [], children: [],
		};
		const nodes = new Map<string, TemplateFolderNode>();
		nodes.set('', root);

		for (const tpl of [...templates].sort((a, b) => a.rel_path.localeCompare(b.rel_path))) {
			const parts = tpl.rel_path.split('/');
			const dirParts = parts.slice(0, -1);
			let parentPath = '';
			for (const part of dirParts) {
				const dirPath = parentPath === '' ? part : `${parentPath}/${part}`;
				if (!nodes.has(dirPath)) {
					const node: TemplateFolderNode = {
						name: part, relPath: dirPath,
						absPath: vault.path ? `${vault.path}/!Documents/${dirPath}` : '',
						files: [], children: [],
					};
					nodes.get(parentPath)!.children.push(node);
					nodes.set(dirPath, node);
				}
				parentPath = dirPath;
			}
			nodes.get(parentPath)!.files.push(tpl);
		}
		return root;
	}

	function buildPatientTree(fileList: VaultFileInfo[]): PatientFolderNode[] {
		const catNodes = new Map<string, PatientFolderNode>();
		const allNodes = new Map<string, PatientFolderNode>();

		// Always include all standard category folders (even if empty)
		for (const cat of standardFolders) {
			const node: PatientFolderNode = {
				name: cat, folderPath: cat,
				absPath: vault.path ? `${vault.path}/${patientFolder}/${cat}` : '',
				files: [], children: [],
			};
			catNodes.set(cat, node);
			allNodes.set(cat, node);
		}

		// Also create nodes for non-standard categories found in files
		for (const file of fileList) {
			const cat = file.category_folder;
			if (!catNodes.has(cat)) {
				const node: PatientFolderNode = {
					name: cat, folderPath: cat,
					absPath: vault.path ? `${vault.path}/${patientFolder}/${cat}` : '',
					files: [], children: [],
				};
				catNodes.set(cat, node);
				allNodes.set(cat, node);
			}
		}

		// Insert files and create intermediate sub-folder nodes
		for (const file of fileList) {
			const cat = file.category_folder;
			const sub = file.path_in_category ?? '';

			if (sub === '') {
				allNodes.get(cat)!.files.push(file);
			} else {
				const parts = sub.split('/');
				let parentPath = cat;
				for (const part of parts) {
					const fullPath = `${parentPath}/${part}`;
					if (!allNodes.has(fullPath)) {
						const node: PatientFolderNode = {
							name: part, folderPath: fullPath,
							absPath: vault.path ? `${vault.path}/${patientFolder}/${fullPath}` : '',
							files: [], children: [],
						};
						allNodes.get(parentPath)!.children.push(node);
						allNodes.set(fullPath, node);
					}
					parentPath = fullPath;
				}
				allNodes.get(`${cat}/${sub}`)!.files.push(file);
			}
		}

		const result: PatientFolderNode[] = [];
		for (const cat of standardFolders) {
			if (catNodes.has(cat)) result.push(catNodes.get(cat)!);
		}
		for (const [, node] of catNodes) {
			if (!standardFolders.includes(node.folderPath)) result.push(node);
		}
		return result;
	}

	const templateTree   = $derived(buildTemplateTree(docTemplates));
	const patientFolders = $derived(buildPatientTree(files));
	const totalFiles     = $derived(files.length);

	// ── Mount ───────────────────────────────────────────────────────────

	onMount(async () => {
		if (!vault.path || !patientFolder) { isLoading = false; return; }
		try {
			const [result, tpl] = await Promise.all([
				listVaultFiles(vault.path, patientFolder),
				listDocTemplates(vault.path),
			]);
			files = result;
			docTemplates = tpl;
			for (const cat of standardFolders) {
				openFolders[cat] = result.some(f => f.category_folder === cat);
			}
		} catch {
			files = [];
		} finally {
			isLoading = false;
		}
	});

	onDestroy(() => {
		// Clean up global listeners if component unmounts mid-drag
		document.removeEventListener('mousemove', onGlobalMouseMove);
		document.removeEventListener('mouseup', onGlobalMouseUp);
		document.body.classList.remove('cursor-grabbing');
	});

	// ── Template folder actions ─────────────────────────────────────────

	async function handleAddTemplate() {
		if (!vault.path || isAddingTemplate) return;
		const srcPath = await pickFile();
		if (!srcPath) return;
		isAddingTemplate = true;
		try {
			const destFilename = generateDestFilename(srcPath);
			await saveDocTemplate(vault.path, srcPath, destFilename);
			docTemplates = await listDocTemplates(vault.path);
		} catch { /* non-fatal */ } finally {
			isAddingTemplate = false;
		}
	}

	async function handleDeleteTemplate(filename: string) {
		if (!vault.path) return;
		if (!confirm(i18n.t.docTemplates.deleteConfirm)) return;
		await deleteDocTemplate(vault.path, filename).catch(() => {});
		docTemplates = await listDocTemplates(vault.path);
	}

	// ── Mouse-based drag-and-drop ──────────────────────────────────────
	// Works in every webview — no HTML5 DnD API dependency.

	function onTemplateMouseDown(e: MouseEvent, tpl: DocTemplateInfo) {
		if (e.button !== 0) return; // left-click only
		e.preventDefault(); // prevent browser text selection on drag
		draggingTemplate = tpl;
		dragStartPos = { x: e.clientX, y: e.clientY };
		isDraggingTemplate = false;
		document.addEventListener('mousemove', onGlobalMouseMove);
		document.addEventListener('mouseup', onGlobalMouseUp);
	}

	function onGlobalMouseMove(e: MouseEvent) {
		if (!draggingTemplate) return;

		// Activate drag only after passing threshold (avoids accidental drags on clicks)
		if (!isDraggingTemplate) {
			const dx = e.clientX - dragStartPos.x;
			const dy = e.clientY - dragStartPos.y;
			if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
			isDraggingTemplate = true;
			document.body.classList.add('cursor-grabbing');
		}

		// Find the folder element under the cursor
		const el = document.elementFromPoint(e.clientX, e.clientY);
		const folderEl = el?.closest('[data-drop-folder]') as HTMLElement | null;
		dragOverPath = folderEl?.dataset.dropFolder ?? null;
	}

	function onGlobalMouseUp(_e: MouseEvent) {
		document.removeEventListener('mousemove', onGlobalMouseMove);
		document.removeEventListener('mouseup', onGlobalMouseUp);
		document.body.classList.remove('cursor-grabbing');

		const tpl = draggingTemplate;
		const targetFolder = dragOverPath;

		// Reset all drag state
		draggingTemplate = null;
		isDraggingTemplate = false;
		dragOverPath = null;

		if (tpl && targetFolder) {
			performDrop(tpl, targetFolder);
		}
	}

	async function performDrop(tpl: DocTemplateInfo, folderPath: string) {
		if (!vault.path || !patientFolder || !patient.patient_id) return;

		const mime = getMimeType(tpl.filename);
		// Append patient surname and firstname before the extension
		const dotIdx = tpl.filename.lastIndexOf('.');
		const baseName = dotIdx > 0 ? tpl.filename.slice(0, dotIdx) : tpl.filename;
		const ext = dotIdx > 0 ? tpl.filename.slice(dotIdx) : '';
		const destFilename = `${baseName}_${patient.lastname}_${patient.firstname}${ext}`;

		try {
			const { absPath, relPath, fileSize } = await saveDocumentFile({
				srcPath: tpl.abs_path,
				vaultPath: vault.path,
				patientFolder,
				categoryFolder: folderPath,
				destFilename,
			});

			const topFolder = folderPath.split('/')[0];
			const categoryKey = folderToKey[topFolder] ?? topFolder;

			const doc = await insertDocument(patient.patient_id, {
				filename: destFilename,
				original_name: tpl.filename,
				category: categoryKey,
				mime_type: mime,
				file_size: fileSize,
				abs_path: absPath,
				rel_path: relPath,
			});

			await insertTimelineEntry(patient.patient_id, {
				entry_date: new Date().toISOString().slice(0, 10),
				entry_type: 'document',
				title: tpl.filename,
				treatment_category: categoryKey,
				document_id: doc.id,
				attachments: JSON.stringify([{ path: absPath, name: tpl.filename, mime, size: fileSize }]),
			});

			files = await listVaultFiles(vault.path, patientFolder);
			openFolders[folderPath] = true;
		} catch (err) { console.error('[DnD] drop error:', err); }
	}

	// ── UI helpers ──────────────────────────────────────────────────────

	function folderLabel(folderPath: string): string {
		const topFolder = folderPath.split('/')[0];
		const key = folderToKey[topFolder];
		if (key && folderPath === topFolder) {
			const entry = i18n.t.defaults.docCategories.find(d => d.key === key);
			if (entry) return entry.label;
		}
		return folderPath.split('/').pop() ?? folderPath;
	}

	function toggleFolder(folderPath: string) {
		openFolders[folderPath] = !openFolders[folderPath];
	}

	function toggleTemplateFolder(relPath: string) {
		openTemplateFolders[relPath] = !openTemplateFolders[relPath];
	}

	function openFile(f: VaultFileInfo) { openDocumentFile(f.abs_path); }

	function openPatientFolder() {
		if (!vault.path || !patientFolder) return;
		openDocumentFile(`${vault.path}/${patientFolder}`);
	}

	function initials(p: Patient) {
		return (p.firstname[0] ?? '') + (p.lastname[0] ?? '');
	}
</script>

<!-- Global cursor override while dragging -->
<svelte:head>
	{#if isDraggingTemplate}
		{@html '<style>* { cursor: grabbing !important; user-select: none !important; }</style>'}
	{/if}
</svelte:head>

<div class="flex h-full flex-col overflow-hidden text-xs">

	<!-- Patient header -->
	<div class="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-sidebar-border/60">
		<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-[11px] font-bold uppercase select-none">
			{initials(patient)}
		</div>
		<a
			href="/patients/{patient.patient_id}"
			class="flex min-w-0 flex-1 flex-col rounded hover:bg-sidebar-accent/50 transition-colors px-1 -mx-1"
			title="Zur Timeline"
		>
			<span class="truncate text-[12px] font-semibold text-sidebar-foreground leading-snug hover:text-sidebar-primary transition-colors">
				{patient.lastname}, {patient.firstname}
			</span>
			<span class="text-[10px] text-muted-foreground/80 truncate font-mono">{patient.patient_id}</span>
		</a>
		<button
			type="button"
			title="In Finder öffnen"
			onclick={openPatientFolder}
			class="shrink-0 rounded p-1 text-muted-foreground/50 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
				<polyline points="15 3 21 3 21 9"/>
				<line x1="10" y1="14" x2="21" y2="3"/>
			</svg>
		</button>
	</div>

	<!-- Vault root label -->
	{#if patientFolder}
		<div class="flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-muted-foreground/70 font-mono select-none">
			<svg class="h-3 w-3 shrink-0 text-muted-foreground/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
			</svg>
			<span class="truncate">{patientFolder}/</span>
			{#if !isLoading}
				<span class="ml-auto shrink-0 pl-1">{totalFiles} {i18n.t.documents.title.toLowerCase()}</span>
			{/if}
		</div>
	{/if}

	<!-- Folder tree -->
	<div class="flex-1 overflow-y-auto pb-2">

		{#if isLoading}
			<div class="flex flex-col gap-1 px-3 pt-1">
				{#each [1, 2, 3, 4] as _}
					<div class="h-6 animate-pulse rounded bg-sidebar-accent/40"></div>
				{/each}
			</div>

		{:else}
			<!-- ── !Documents template folder (pinned at top) ── -->
			<div class="px-1.5 pt-1 pb-0.5">
				<div>
					<!-- !Documents folder header row -->
					<div class="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-teal-50/60 dark:hover:bg-teal-950/20 transition-colors">
						<button
							type="button"
							onclick={() => (templatesOpen = !templatesOpen)}
							class="flex flex-1 items-center gap-1.5 text-left min-w-0"
						>
							<svg class={['h-3 w-3 shrink-0 text-teal-500/80 transition-transform', templatesOpen ? 'rotate-90' : ''].join(' ')} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
								<path d="M9 18l6-6-6-6"/>
							</svg>
							<svg class="h-3.5 w-3.5 shrink-0 text-teal-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
								<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
								<line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
							</svg>
							<span class="flex-1 truncate text-[11px] font-semibold text-teal-700 dark:text-teal-400">
								{i18n.t.docTemplates.folder}
							</span>
							{#if docTemplates.length > 0}
								<span class="shrink-0 rounded-full bg-teal-100 dark:bg-teal-900/40 px-1.5 py-0.5 text-[9px] font-semibold text-teal-700 dark:text-teal-400 tabular-nums">
									{docTemplates.length}
								</span>
							{/if}
						</button>
						<!-- Upload button -->
						<button
							type="button"
							title={i18n.t.docTemplates.addFile}
							onclick={handleAddTemplate}
							disabled={isAddingTemplate}
							class="shrink-0 rounded p-0.5 text-teal-500/60 hover:bg-teal-100 dark:hover:bg-teal-900/30 hover:text-teal-700 transition-colors"
						>
							{#if isAddingTemplate}
								<svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-opacity=".25"/><path d="M12 2a10 10 0 0 1 10 10" stroke-linecap="round"/></svg>
							{:else}
								<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
									<path d="M12 5v14M5 12h14"/>
								</svg>
							{/if}
						</button>
					</div>

					<!-- !Documents content (files + sub-folders, recursive) -->
					{#if templatesOpen}
						{#if docTemplates.length === 0}
							<p class="ml-8 py-1.5 text-[10px] text-muted-foreground/50 italic">{i18n.t.docTemplates.noFiles}</p>
						{:else}
							{@render templateFolderContents(templateTree, 1)}
						{/if}
					{/if}
				</div>

				<!-- Drag hint when dragging -->
				{#if isDraggingTemplate}
					<p class="mx-2 mt-1 mb-0.5 text-[9px] text-teal-600/70 italic text-center">
						{i18n.code === 'de' ? 'Auf einen Ordner ziehen zum Kopieren' : 'Drop onto a folder below to copy'}
					</p>
				{/if}

				<!-- Separator between template folder and patient files -->
				<div class="mx-2 mt-2 mb-1 border-t border-sidebar-border/40"></div>
			</div>

			<!-- Patient folder tree (collapsible, nested) -->
			<div class="flex flex-col gap-0.5 px-1.5 pt-0">
				{#each patientFolders as node}
					{@render patientFolderNode(node, 0)}
				{/each}
			</div>
		{/if}
	</div>

	<!-- Back button -->
	<div class="border-t border-sidebar-border px-2 py-2">
		<button
			type="button"
			onclick={() => { activePatient.clear(); goto('/patients'); }}
			class="flex w-full items-center justify-center gap-1.5 rounded-md bg-sidebar-accent px-3 py-1.5 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/80"
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M19 12H5M12 19l-7-7 7-7"/>
			</svg>
			{i18n.t.sidebar.backToList}
		</button>
	</div>
</div>

<!-- ── Recursive snippets ──────────────────────────────────────────────── -->

{#snippet templateFolderContents(node: TemplateFolderNode, depth: number)}
	<div class="ml-[19px] border-l-2 border-teal-500/30 pl-[10px] flex flex-col gap-0.5 pb-0.5">
		<!-- Sub-folders first -->
		{#each node.children as child}
			<div>
				<button
					type="button"
					onclick={() => toggleTemplateFolder(child.relPath)}
					class="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left hover:bg-teal-50/60 dark:hover:bg-teal-950/20 transition-colors"
				>
					<svg class={['h-2.5 w-2.5 shrink-0 text-teal-500/70 transition-transform', openTemplateFolders[child.relPath] ? 'rotate-90' : ''].join(' ')} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
						<path d="M9 18l6-6-6-6"/>
					</svg>
					<svg class="h-3.5 w-3.5 shrink-0 text-teal-500/80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
						<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
					</svg>
					<span class="flex-1 truncate text-[11px] font-medium text-teal-700/80 dark:text-teal-400/80">{child.name}/</span>
					{#if child.files.length > 0 || child.children.length > 0}
						<span class="shrink-0 text-[9px] text-teal-600/50 tabular-nums">{child.files.length + child.children.reduce((a, c) => a + c.files.length, 0)}</span>
					{/if}
				</button>
				{#if openTemplateFolders[child.relPath]}
					{@render templateFolderContents(child, depth + 1)}
				{/if}
			</div>
		{/each}

		<!-- Files in this folder (draggable via mousedown) -->
		{#each node.files as tpl}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-teal-50/60 dark:hover:bg-teal-950/20 group transition-colors cursor-grab select-none"
				onmousedown={(e) => onTemplateMouseDown(e, tpl)}
				ondblclick={() => openDocumentFile(tpl.abs_path)}
			>
				<svg class="h-3 w-3 shrink-0 text-teal-500/70 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
					<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
					<polyline points="14 2 14 8 20 8"/>
				</svg>
				<span
					class="flex-1 min-w-0 block truncate text-[11px] text-sidebar-foreground group-hover:text-teal-700 dark:group-hover:text-teal-400 font-mono transition-colors pointer-events-none"
					title="{tpl.rel_path}&#10;{formatFileSize(tpl.file_size)}"
				>
					{tpl.filename}
				</span>
				<!-- Delete button (hover only) — stops mousedown to prevent drag -->
				<button
					type="button"
					title={i18n.t.docTemplates.deleteConfirm}
					onmousedown={(e) => e.stopPropagation()}
					onclick={(e) => { e.stopPropagation(); handleDeleteTemplate(tpl.filename); }}
					class="shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-all"
				>
					<svg class="h-3 w-3 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
					</svg>
				</button>
			</div>
		{/each}
	</div>
{/snippet}

{#snippet patientFolderNode(node: PatientFolderNode, depth: number)}
	{@const isOpen = !!openFolders[node.folderPath]}
	{@const hasContent = node.files.length > 0 || node.children.length > 0}
	{@const isDropTarget = dragOverPath === node.folderPath}

	<div>
		<!-- Folder row — serves as mouse-based drop target via data-drop-folder attribute -->
		<div
			data-drop-folder={node.folderPath}
			class={[
				'flex items-center gap-1.5 rounded px-2 py-1 transition-colors',
				isDropTarget
					? 'bg-teal-100/60 dark:bg-teal-900/30 ring-1 ring-teal-400/60'
					: 'hover:bg-sidebar-accent/60',
				depth > 0 ? 'ml-[' + (depth * 14) + 'px]' : '',
			].join(' ')}
			role="region"
		>
			<button
				type="button"
				data-drop-folder={node.folderPath}
				onclick={() => toggleFolder(node.folderPath)}
				ondblclick={() => {
					if (vault.path && patientFolder) openDocumentFile(`${vault.path}/${patientFolder}/${node.folderPath}`);
				}}
				class="flex flex-1 items-center gap-1.5 text-left text-sidebar-foreground min-w-0"
			>
				<!-- Chevron -->
				<svg
					class={['h-3 w-3 shrink-0 text-muted-foreground/65 transition-transform pointer-events-none', isOpen ? 'rotate-90' : ''].join(' ')}
					viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
				>
					<path d="M9 18l6-6-6-6"/>
				</svg>

				<!-- Folder icon -->
				{#if isOpen}
					<svg class="h-4 w-4 shrink-0 pointer-events-none {isDropTarget ? 'text-teal-500' : 'text-sidebar-primary'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
						<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
						<line x1="2" y1="10" x2="22" y2="10"/>
					</svg>
				{:else}
					<svg class="h-4 w-4 shrink-0 pointer-events-none {isDropTarget ? 'text-teal-500' : 'text-sidebar-primary/90'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
						<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
					</svg>
				{/if}

				<!-- Label -->
				<span class={['flex-1 truncate font-medium pointer-events-none', hasContent ? 'text-sidebar-foreground' : 'text-muted-foreground/70'].join(' ')}>
					{folderLabel(node.folderPath)}
				</span>

				<!-- File count badge -->
				{#if hasContent}
					<span class="shrink-0 rounded-full bg-sidebar-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-sidebar-primary tabular-nums pointer-events-none">
						{node.files.length}
					</span>
				{/if}
			</button>
		</div>

		<!-- Contents: files + sub-folders -->
		{#if isOpen}
			<div class="ml-[{depth > 0 ? (depth * 14) + 19 : 19}px] border-l-2 border-sidebar-border/50 pl-[10px] flex flex-col gap-0.5 pb-1">
				{#each node.files as file (file.abs_path)}
					<button
						type="button"
						ondblclick={() => openFile(file)}
						title="{file.filename}\n{formatFileSize(file.file_size)}"
						class="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left hover:bg-sidebar-accent/60 transition-colors group"
					>
						<svg class="h-3 w-3 shrink-0 text-muted-foreground/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
							<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
							<polyline points="14 2 14 8 20 8"/>
						</svg>
						<span class="flex-1 truncate text-[11px] text-sidebar-foreground font-mono">
							{file.filename}
						</span>
						<span class="shrink-0 text-[9px] text-muted-foreground/60 tabular-nums">
							{formatFileSize(file.file_size)}
						</span>
					</button>
				{/each}

				{#each node.children as child}
					{@render patientFolderNode(child, depth + 1)}
				{/each}
			</div>
		{/if}
	</div>
{/snippet}
