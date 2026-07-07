<script lang="ts">
	import { toLocalISODate } from '$lib/utils';
	import { onMount, onDestroy } from 'svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { invoke } from '@tauri-apps/api/core';
	import {
		listVaultFiles, openDocumentFile, formatFileSize, type VaultFileInfo,
		listDocTemplates, saveDocTemplate, deleteDocTemplate, pickFile,
		generateDestFilename, type DocTemplateInfo,
		saveDocumentFile, getMimeType,
	} from '$lib/services/files';
	import type { Patient } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { cephSelection } from '$lib/stores/cephSelection.svelte';
	import { insertDocument, insertTimelineEntry, getDocuments } from '$lib/services/db';
	import { docCategories } from '$lib/stores/categories.svelte';

	let { patient }: { patient: Patient } = $props();

	let files       = $state<VaultFileInfo[]>([]);
	let isLoading   = $state(true);
	let openFolders = $state<Record<string, boolean>>({});
	let fileWatcherId: number | null = null;

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
	let draggingFile       = $state<VaultFileInfo | null>(null);
	let isDraggingTemplate = $state(false);
	let isDraggingFile     = $state(false);
	let dragOverPath       = $state<string | null>(null);
	let dragStartPos = { x: 0, y: 0 };
	const DRAG_THRESHOLD = 5; // px of movement before drag activates

	// ── Multi-file selection (shift-click) — lets several files be dragged as a group ──
	let multiSelected = $state<Set<string>>(new Set()); // keyed by VaultFileInfo.rel_path

	// ── Context menu state ──────────────────────────────────────────────
	let contextMenu = $state<{ file: VaultFileInfo; x: number; y: number } | null>(null);

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

	// ── Auto-track files that appear in the vault outside the app's own flows ──
	// (Finder drops, or files a Ceph analysis saves next to the source X-ray). Runs
	// after every refresh; any file already recorded in `documents` (dropped via
	// VaultDropDialog or a template) is skipped, so nothing gets double-tracked.
	let isAutoTracking = false;

	async function autoTrackUntrackedFiles(freshFiles: VaultFileInfo[]) {
		if (!patient.patient_id || isAutoTracking) return;
		isAutoTracking = true;
		try {
			const existingDocs = await getDocuments(patient.patient_id);
			const trackedPaths = new Set(existingDocs.map(d => d.rel_path));
			const untracked = freshFiles.filter(f => !trackedPaths.has(f.rel_path));

			for (const f of untracked) {
				const categoryKey = folderToKey[f.category_folder] ?? f.category_folder;
				const mime = getMimeType(f.filename);

				const doc = await insertDocument(patient.patient_id, {
					filename: f.filename,
					original_name: f.filename,
					category: categoryKey,
					mime_type: mime,
					file_size: f.file_size,
					abs_path: f.abs_path,
					rel_path: f.rel_path,
				});

				await insertTimelineEntry(patient.patient_id, {
					entry_date: f.modified_at || toLocalISODate(),
					entry_type: 'document',
					title: f.filename,
					treatment_category: categoryKey,
					document_id: doc.id,
					// Vault-relative path — abs paths in attachments break vault portability
					attachments: JSON.stringify([{ path: f.rel_path, name: f.filename, mime, size: f.file_size }]),
				});
			}
		} catch (err) {
			console.error('[AutoTrack] error:', err);
		} finally {
			isAutoTracking = false;
		}
	}

	async function refreshFiles() {
		if (!vault.path || !patientFolder) return;
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
			// Fire-and-forget — don't block the sidebar refresh on DB writes
			autoTrackUntrackedFiles(result);
		} catch {
			files = [];
		}
	}

	let watchInterval: ReturnType<typeof setInterval> | null = null;

	onMount(async () => {
		cephSelection.clear(); // stale selection from a previous patient
		multiSelected = new Set();
		if (!vault.path || !patientFolder) { isLoading = false; return; }

		try {
			await refreshFiles();

			// Set up a polling mechanism to refresh when files change (auto-refresh on file add/delete)
			watchInterval = setInterval(refreshFiles, 2000);
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
		// Clean up file watcher interval
		if (watchInterval !== null) {
			clearInterval(watchInterval);
		}
		if (fileWatcherId !== null) {
			invoke('unwatch_folder', { id: fileWatcherId }).catch(() => {});
		}
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

	function onFileMouseDown(e: MouseEvent, file: VaultFileInfo) {
		if (e.button !== 0) return; // left-click only
		if (e.shiftKey) return; // shift-click toggles multi-select instead of starting a drag
		e.preventDefault(); // prevent browser text selection on drag
		draggingFile = file;
		dragStartPos = { x: e.clientX, y: e.clientY };
		isDraggingFile = false;
		document.addEventListener('mousemove', onGlobalMouseMove);
		document.addEventListener('mouseup', onGlobalMouseUp);
	}

	/** Folder path (category + sub-path) the file currently lives in — comparable to a `data-drop-folder` value. */
	function currentFolderPath(file: VaultFileInfo): string {
		return file.path_in_category ? `${file.category_folder}/${file.path_in_category}` : file.category_folder;
	}

	function toggleMultiSelect(file: VaultFileInfo) {
		const next = new Set(multiSelected);
		if (next.has(file.rel_path)) next.delete(file.rel_path);
		else next.add(file.rel_path);
		multiSelected = next;
	}

	function onGlobalMouseMove(e: MouseEvent) {
		// Handle template drag
		if (draggingTemplate) {
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

		// Handle file drag
		if (draggingFile) {
			// Activate drag only after passing threshold (avoids accidental drags on clicks)
			if (!isDraggingFile) {
				const dx = e.clientX - dragStartPos.x;
				const dy = e.clientY - dragStartPos.y;
				if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
				isDraggingFile = true;
				document.body.classList.add('cursor-grabbing');
			}

			// Find the folder element under the cursor
			const el = document.elementFromPoint(e.clientX, e.clientY);
			const folderEl = el?.closest('[data-drop-folder]') as HTMLElement | null;
			dragOverPath = folderEl?.dataset.dropFolder ?? null;
		}
	}

	function onGlobalMouseUp(_e: MouseEvent) {
		document.removeEventListener('mousemove', onGlobalMouseMove);
		document.removeEventListener('mouseup', onGlobalMouseUp);
		document.body.classList.remove('cursor-grabbing');

		const tpl = draggingTemplate;
		const file = draggingFile;
		const targetFolder = dragOverPath;

		// Reset all drag state
		draggingTemplate = null;
		draggingFile = null;
		isDraggingTemplate = false;
		isDraggingFile = false;
		dragOverPath = null;

		if (tpl && targetFolder) {
			performDrop(tpl, targetFolder);
		} else if (file && targetFolder) {
			// Dragging a file that's part of an active multi-selection moves the whole group
			const group = multiSelected.has(file.rel_path) && multiSelected.size > 1
				? files.filter(f => multiSelected.has(f.rel_path))
				: [file];
			const toMove = group.filter(f => currentFolderPath(f) !== targetFolder);
			if (toMove.length > 0) performFileMove(toMove, targetFolder);
			multiSelected = new Set();
		}
	}

	/** Appends _1, _2, ... before the extension until `filename` is free within `folderPath`. */
	function uniqueFilename(filename: string, folderPath: string, existing: VaultFileInfo[]): string {
		const parts = folderPath.split('/');
		const top = parts[0];
		const sub = parts.slice(1).join('/');
		const exists = (name: string) =>
			existing.some(f => f.filename === name && f.category_folder === top && f.path_in_category === sub);

		if (!exists(filename)) return filename;
		const dotIdx = filename.lastIndexOf('.');
		const base = dotIdx > 0 ? filename.slice(0, dotIdx) : filename;
		const ext = dotIdx > 0 ? filename.slice(dotIdx) : '';
		let counter = 1;
		let candidate = `${base}_${counter}${ext}`;
		while (exists(candidate)) {
			counter++;
			candidate = `${base}_${counter}${ext}`;
		}
		return candidate;
	}

	async function performDrop(tpl: DocTemplateInfo, folderPath: string) {
		if (!vault.path || !patientFolder || !patient.patient_id) return;

		const mime = getMimeType(tpl.filename);
		// Append patient surname and firstname before the extension
		const dotIdx = tpl.filename.lastIndexOf('.');
		const baseName = dotIdx > 0 ? tpl.filename.slice(0, dotIdx) : tpl.filename;
		const ext = dotIdx > 0 ? tpl.filename.slice(dotIdx) : '';
		const baseDestFilename = `${baseName}_${patient.lastname}_${patient.firstname}${ext}`;

		try {
			// Re-fetch the current folder contents so repeated drops of the same template
			// get _1, _2, ... suffixes instead of silently overwriting the previous file.
			const currentFiles = await listVaultFiles(vault.path, patientFolder);
			const destFilename = uniqueFilename(baseDestFilename, folderPath, currentFiles);

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
				entry_date: toLocalISODate(),
				entry_type: 'document',
				title: tpl.filename,
				treatment_category: categoryKey,
				document_id: doc.id,
				// Vault-relative path — abs paths in attachments break vault portability
				attachments: JSON.stringify([{ path: relPath, name: tpl.filename, mime, size: fileSize }]),
			});

			files = await listVaultFiles(vault.path, patientFolder);
			openFolders[folderPath] = true;
		} catch (err) { console.error('[DnD] drop error:', err); }
	}

	async function performFileMove(filesToMove: VaultFileInfo[], newFolder: string) {
		if (!vault.path || !patientFolder || filesToMove.length === 0) return;
		try {
			for (const f of filesToMove) {
				await invoke('move_patient_file', {
					vaultPath: vault.path,
					patientFolder,
					srcPath: f.rel_path,
					destFolder: newFolder,
				});
			}
			files = await listVaultFiles(vault.path, patientFolder);
			openFolders[newFolder] = true;
		} catch (err) { console.error('[FileMove] error:', err); }
	}

	function handleFileContextMenu(e: MouseEvent, file: VaultFileInfo) {
		e.preventDefault();
		contextMenu = {
			file,
			x: e.clientX,
			y: e.clientY,
		};
		document.addEventListener('click', closeContextMenu);
	}

	function closeContextMenu() {
		contextMenu = null;
		document.removeEventListener('click', closeContextMenu);
	}

	async function deleteFile(file: VaultFileInfo) {
		if (!vault.path || !patientFolder) return;
		if (!confirm(`Delete "${file.filename}"?`)) return;

		try {
			await invoke('delete_patient_file', {
				vaultPath: vault.path,
				patientFolder,
				filePath: file.rel_path,
			});
			files = await listVaultFiles(vault.path, patientFolder);
		} catch (err) { console.error('[FileDelete] error:', err); }
		closeContextMenu();
	}

	async function createNewFolder(parentFolder: string) {
		const folderName = prompt('Folder name:');
		if (!folderName || !vault.path || !patientFolder) return;

		try {
			await invoke('create_patient_subfolder', {
				vaultPath: vault.path,
				patientFolder,
				parentRel: parentFolder,
				folderName,
			});
			files = await listVaultFiles(vault.path, patientFolder);
			openFolders[parentFolder] = true;
		} catch (err) { console.error('[CreateFolder] error:', err); }
	}

	// ── UI helpers ──────────────────────────────────────────────────────

	type FileKind = 'image' | 'pdf' | 'document' | 'spreadsheet' | 'archive' | 'dicom' | 'generic';

	const FILE_KIND_BY_EXT: Record<string, FileKind> = {
		jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', svg: 'image', webp: 'image',
		pdf: 'pdf',
		doc: 'document', docx: 'document', txt: 'document', rtf: 'document',
		xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet',
		zip: 'archive', rar: 'archive', '7z': 'archive',
		dcm: 'dicom',
	};

	const FILE_KIND_COLOR: Record<FileKind, string> = {
		image: 'text-info',
		pdf: 'text-primary',
		document: 'text-muted-foreground',
		spreadsheet: 'text-success',
		archive: 'text-warning',
		dicom: 'text-info',
		generic: 'text-muted-foreground/60',
	};

	function getFileKind(filename: string): FileKind {
		const ext = filename.split('.').pop()?.toLowerCase() ?? '';
		return FILE_KIND_BY_EXT[ext] ?? 'generic';
	}

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

	function selectFile(f: VaultFileInfo) {
		cephSelection.toggle({
			relPath: f.rel_path,
			filename: f.filename,
			patientId: patient.patient_id,
		});
	}

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
			title={i18n.t.sidebar.timelineTitle}
		>
			<span class="truncate text-[12px] font-semibold text-sidebar-foreground leading-snug hover:text-sidebar-primary transition-colors">
				{patient.lastname}, {patient.firstname}
			</span>
			<span class="text-[10px] text-muted-foreground/80 truncate font-mono">{patient.patient_id}</span>
		</a>
		<button
			type="button"
			title={i18n.t.sidebar.openInFinder}
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
						{i18n.t.sidebar.dragHint}
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
</div>

<!-- Context menu for files -->
{#if contextMenu}
	{@const cm = contextMenu}
	<div
		style="position: fixed; left: {cm.x}px; top: {cm.y}px; z-index: 50;"
		class="bg-popover border border-border rounded-md shadow-lg overflow-hidden min-w-[120px]"
	>
		<button
			type="button"
			onclick={() => {
				openFile(cm.file);
				closeContextMenu();
			}}
			class="w-full px-3 py-1.5 text-left text-xs hover:bg-sidebar-accent/60 transition-colors"
		>
			Open
		</button>
		<div class="border-t border-border/50"></div>
		<button
			type="button"
			onclick={() => {
				selectFile(cm.file);
				closeContextMenu();
			}}
			class="w-full px-3 py-1.5 text-left text-xs hover:bg-sidebar-accent/60 transition-colors"
		>
			Select for Ceph
		</button>
		<div class="border-t border-border/50"></div>
		<button
			type="button"
			onclick={() => {
				deleteFile(cm.file);
			}}
			class="w-full px-3 py-1.5 text-left text-xs text-critical hover:bg-critical/10 transition-colors"
		>
			Delete
		</button>
	</div>
{/if}

<!-- ── Recursive snippets ──────────────────────────────────────────────── -->

{#snippet fileTypeIcon(kind: FileKind, colorClass: string)}
	{#if kind === 'image' || kind === 'dicom'}
		<svg class="h-3.5 w-3.5 shrink-0 {colorClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
			<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
		</svg>
	{:else if kind === 'spreadsheet'}
		<svg class="h-3.5 w-3.5 shrink-0 {colorClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
			<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/>
		</svg>
	{:else if kind === 'archive'}
		<svg class="h-3.5 w-3.5 shrink-0 {colorClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
			<rect x="3" y="8" width="18" height="13" rx="1"/><path d="M1 4h22v4H1z"/><line x1="10" y1="12" x2="14" y2="12"/>
		</svg>
	{:else}
		<!-- pdf / document / generic — page glyph, PDF gets the primary accent -->
		<svg class="h-3.5 w-3.5 shrink-0 {colorClass}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
			<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>
		</svg>
	{/if}
{/snippet}

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
				'flex items-center gap-1.5 rounded px-2 py-1 transition-colors group',
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

			<!-- Create subfolder button (hover only) -->
			<button
				type="button"
				title="Create subfolder"
				onclick={() => createNewFolder(node.folderPath)}
				class="shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-sidebar-primary/60 hover:bg-sidebar-primary/10 hover:text-sidebar-primary transition-all"
			>
				<svg class="h-3.5 w-3.5 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 5v14M5 12h14"/>
				</svg>
			</button>
		</div>

		<!-- Contents: files + sub-folders — also a drop target, so dropping anywhere
		     among the files (not just on the folder row) still lands in this folder -->
		{#if isOpen}
			<div
				data-drop-folder={node.folderPath}
				class={[
					'ml-[' + (depth > 0 ? (depth * 14) + 19 : 19) + 'px] border-l-2 pl-[10px] flex flex-col gap-0.5 pb-1 rounded-r transition-colors',
					isDropTarget ? 'border-teal-400/60 bg-teal-100/30 dark:bg-teal-900/20' : 'border-sidebar-border/50',
				].join(' ')}
			>
				{#each node.files as file (file.abs_path)}
					{@const isSelected = cephSelection.isSelected(file.rel_path)}
					{@const isMultiSelected = multiSelected.has(file.rel_path)}
					{@const isDragging = isDraggingFile && (draggingFile?.abs_path === file.abs_path || (multiSelected.size > 1 && !!draggingFile && multiSelected.has(draggingFile.rel_path) && isMultiSelected))}
					<button
						type="button"
						onclick={(e) => {
							if (e.shiftKey) toggleMultiSelect(file);
							else { if (multiSelected.size > 0) multiSelected = new Set(); selectFile(file); }
						}}
						ondblclick={() => openFile(file)}
						onmousedown={(e) => onFileMouseDown(e, file)}
						oncontextmenu={(e) => handleFileContextMenu(e, file)}
						title="{file.filename}\n{formatFileSize(file.file_size)}\n{i18n.t.sidebar.shiftClickHint}"
						class={[
							'flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left transition-colors group cursor-move',
							isDragging ? 'opacity-50 bg-sidebar-primary/25' : '',
							!isDragging && isMultiSelected ? 'bg-primary/15 ring-1 ring-primary/50' : '',
							isSelected && !isDragging && !isMultiSelected
								? 'bg-sidebar-primary/15 ring-1 ring-sidebar-primary/40'
								: !isDragging && !isMultiSelected ? 'hover:bg-sidebar-accent/60' : '',
						].join(' ')}
					>
						{@render fileTypeIcon(getFileKind(file.filename), isSelected ? 'text-sidebar-primary' : FILE_KIND_COLOR[getFileKind(file.filename)])}
						<span class="flex-1 truncate text-[11px] font-mono {isSelected ? 'text-sidebar-primary font-semibold' : 'text-sidebar-foreground'}">
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
