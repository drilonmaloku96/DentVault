<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { vault } from '$lib/stores/vault.svelte';
	import {
		listVaultFiles, openDocumentFile, formatFileSize, type VaultFileInfo,
		listDocTemplates, saveDocTemplate, deleteDocTemplate, pickFile,
		generateDestFilename, type DocTemplateInfo,
	} from '$lib/services/files';
	import type { Patient } from '$lib/types';
	import { i18n } from '$lib/i18n';
	import { activePatient } from '$lib/stores/activePatient.svelte';

	let { patient }: { patient: Patient } = $props();

	let files     = $state<VaultFileInfo[]>([]);
	let isLoading = $state(true);
	let openFolders = $state<Record<string, boolean>>({});

	// !Documents template folder
	let docTemplates      = $state<DocTemplateInfo[]>([]);
	let templatesOpen     = $state(true);
	let isAddingTemplate  = $state(false);

	const STANDARD_FOLDERS = ['xrays', 'photos', 'documents', 'lab_results', 'consents', 'referrals'];

	// Reverse map: disk folder name → category key for label lookup
	const FOLDER_TO_KEY: Record<string, string> = {
		xrays:       'xray',
		photos:      'photo',
		lab_results: 'lab',
		referrals:   'referral',
		consents:    'consent',
		documents:   'other',
	};

	const patientFolder = $derived(
		vault.path
			? vault.patientFolder(patient.lastname, patient.firstname, patient.patient_id)
			: '',
	);

	// Group files by category_folder
	const grouped = $derived(
		files.reduce<Record<string, VaultFileInfo[]>>((acc, f) => {
			if (!acc[f.category_folder]) acc[f.category_folder] = [];
			acc[f.category_folder].push(f);
			return acc;
		}, {}),
	);

	// All folders to show: standard set + any non-standard folders that have files
	const allFolders = $derived([
		...STANDARD_FOLDERS,
		...Object.keys(grouped).filter(k => !STANDARD_FOLDERS.includes(k)),
	]);

	const totalFiles = $derived(files.length);

	onMount(async () => {
		if (!vault.path || !patientFolder) { isLoading = false; return; }
		try {
			const [result, tpl] = await Promise.all([
				listVaultFiles(vault.path, patientFolder),
				listDocTemplates(vault.path),
			]);
			files = result;
			docTemplates = tpl;
			// Auto-open folders that contain files
			for (const folder of STANDARD_FOLDERS) {
				openFolders[folder] = (result.filter(f => f.category_folder === folder).length > 0);
			}
		} catch {
			files = [];
		} finally {
			isLoading = false;
		}
	});

	async function handleAddTemplate() {
		if (!vault.path || isAddingTemplate) return;
		const srcPath = await pickFile();
		if (!srcPath) return;
		isAddingTemplate = true;
		try {
			const filename = srcPath.split('/').pop()?.split('\\').pop() ?? srcPath;
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

	function folderLabel(folderName: string): string {
		const key = FOLDER_TO_KEY[folderName];
		if (key) {
			const entry = i18n.t.defaults.docCategories.find(d => d.key === key);
			if (entry) return entry.label;
		}
		return folderName;
	}

	function toggleFolder(name: string) {
		openFolders[name] = !openFolders[name];
	}

	function openFile(f: VaultFileInfo) {
		openDocumentFile(f.abs_path);
	}

	function openPatientFolder() {
		if (!vault.path || !patientFolder) return;
		openDocumentFile(`${vault.path}/${patientFolder}`);
	}

	function initials(p: Patient) {
		return (p.firstname[0] ?? '') + (p.lastname[0] ?? '');
	}


</script>

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
			<span class="text-[10px] text-muted-foreground/60 truncate font-mono">{patient.patient_id}</span>
		</a>
		<!-- Open in Finder/Explorer -->
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
		<div class="flex items-center gap-1 px-3 py-1.5 text-[10px] text-muted-foreground/50 font-mono select-none">
			<svg class="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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
					<!-- Folder row -->
					<div class="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-teal-50/60 dark:hover:bg-teal-950/20 transition-colors">
						<button
							type="button"
							onclick={() => (templatesOpen = !templatesOpen)}
							class="flex flex-1 items-center gap-1.5 text-left min-w-0"
						>
							<svg class={['h-2.5 w-2.5 shrink-0 text-teal-500/60 transition-transform', templatesOpen ? 'rotate-90' : ''].join(' ')} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
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

					<!-- Files inside !Documents -->
					{#if templatesOpen}
						{#if docTemplates.length === 0}
							<p class="ml-8 py-1.5 text-[10px] text-muted-foreground/50 italic">{i18n.t.docTemplates.noFiles}</p>
						{:else}
							<div class="ml-6 flex flex-col gap-0.5 pb-0.5">
								{#each docTemplates as tpl}
									<div class="flex items-center gap-1 rounded px-2 py-0.5 hover:bg-teal-50/60 dark:hover:bg-teal-950/20 group transition-colors">
										<svg class="h-3 w-3 shrink-0 text-teal-500/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
											<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
											<polyline points="14 2 14 8 20 8"/>
										</svg>
										<button
											type="button"
											ondblclick={() => openDocumentFile(tpl.abs_path)}
											title="{tpl.filename}\n{formatFileSize(tpl.file_size)}"
											class="flex-1 min-w-0 text-left"
										>
											<span class="block truncate text-[11px] text-sidebar-foreground/80 group-hover:text-teal-700 dark:group-hover:text-teal-400 font-mono transition-colors">
												{tpl.filename}
											</span>
										</button>
										<button
											type="button"
											title={i18n.t.docTemplates.deleteFile}
											onclick={() => handleDeleteTemplate(tpl.filename)}
											class="shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-all"
										>
											<svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
												<polyline points="3 6 5 6 21 6"/>
												<path d="M19 6l-1 14H6L5 6"/>
											</svg>
										</button>
									</div>
								{/each}
							</div>
						{/if}
					{/if}
				</div>

				<!-- Separator between template folder and patient files -->
				<div class="mx-2 mt-2 mb-1 border-t border-sidebar-border/40"></div>
			</div>

			<div class="flex flex-col gap-0.5 px-1.5 pt-0">
				{#each allFolders as folderName}
					{@const folderFiles = grouped[folderName] ?? []}
					{@const isOpen = !!openFolders[folderName]}
					{@const hasFiles = folderFiles.length > 0}

					<!-- Folder row -->
					<div>
						<button
							type="button"
							onclick={() => toggleFolder(folderName)}
							ondblclick={() => {
								if (vault.path && patientFolder) openDocumentFile(`${vault.path}/${patientFolder}/${folderName}`);
							}}
							class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
						>
							<!-- Chevron -->
							<svg
								class={['h-2.5 w-2.5 shrink-0 text-muted-foreground/40 transition-transform', isOpen ? 'rotate-90' : ''].join(' ')}
								viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"
							>
								<path d="M9 18l6-6-6-6"/>
							</svg>

							<!-- Folder SVG icon -->
							{#if isOpen}
								<svg class="h-3.5 w-3.5 shrink-0 text-sidebar-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
									<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
									<line x1="2" y1="10" x2="22" y2="10"/>
								</svg>
							{:else}
								<svg class="h-3.5 w-3.5 shrink-0 text-sidebar-primary/70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
									<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
								</svg>
							{/if}

							<!-- Label -->
							<span class={['flex-1 truncate font-medium', hasFiles ? 'text-sidebar-foreground' : 'text-muted-foreground/50'].join(' ')}>
								{folderLabel(folderName)}
							</span>

							<!-- File count badge -->
							{#if hasFiles}
								<span class="shrink-0 rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground tabular-nums">
									{folderFiles.length}
								</span>
							{/if}
						</button>

						<!-- Files inside folder -->
						{#if isOpen && hasFiles}
							<div class="ml-6 flex flex-col gap-0.5 pb-0.5">
								{#each folderFiles as file (file.abs_path)}
									<button
										type="button"
										ondblclick={() => openFile(file)}
										title="{file.filename}\n{formatFileSize(file.file_size)}"
										class="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-left hover:bg-sidebar-accent/50 transition-colors group"
									>
										<svg class="h-3 w-3 shrink-0 text-muted-foreground/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
											<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
											<polyline points="14 2 14 8 20 8"/>
										</svg>
										<span class="flex-1 truncate text-[11px] text-sidebar-foreground/80 group-hover:text-sidebar-foreground font-mono">
											{file.filename}
										</span>
										<span class="shrink-0 text-[9px] text-muted-foreground/40 tabular-nums">
											{formatFileSize(file.file_size)}
										</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
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
