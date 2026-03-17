<script lang="ts">
	import { onMount } from 'svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { listVaultFiles, openDocumentFile, formatFileSize, type VaultFileInfo } from '$lib/services/files';
	import type { Patient } from '$lib/types';
	import { i18n } from '$lib/i18n';

	let { patient }: { patient: Patient } = $props();

	let files     = $state<VaultFileInfo[]>([]);
	let isLoading = $state(true);
	let openFolders = $state<Record<string, boolean>>({});

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
			const result = await listVaultFiles(vault.path, patientFolder);
			files = result;
			// Auto-open folders that contain files
			for (const folder of STANDARD_FOLDERS) {
				openFolders[folder] = (result.filter(f => f.category_folder === folder).length > 0);
			}
		} catch {
			// folder may not exist yet — show empty tree
			files = [];
		} finally {
			isLoading = false;
		}
	});

	function folderLabel(folderName: string): string {
		const key = FOLDER_TO_KEY[folderName];
		if (key) {
			const entry = i18n.t.defaults.docCategories.find(d => d.key === key);
			if (entry) return entry.label;
		}
		return folderName;
	}

	function folderIcon(folderName: string): string {
		const key = FOLDER_TO_KEY[folderName];
		if (key) {
			const entry = i18n.t.defaults.docCategories.find(d => d.key === key);
			if (entry) return entry.icon;
		}
		return '📁';
	}

	function fileIcon(filename: string): string {
		const ext = filename.split('.').pop()?.toLowerCase() ?? '';
		if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return '🖼';
		if (ext === 'pdf') return '📄';
		if (['doc', 'docx'].includes(ext)) return '📝';
		if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
		if (ext === 'dcm') return '🔬';
		return '📎';
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

	function statusDot(status: string) {
		return status === 'active'
			? 'bg-green-500'
			: status === 'inactive'
				? 'bg-amber-400'
				: 'bg-muted-foreground/30';
	}
</script>

<div class="flex h-full flex-col overflow-hidden text-xs">

	<!-- Patient header -->
	<div class="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-sidebar-border/60">
		<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sidebar-primary-foreground text-[11px] font-bold uppercase select-none">
			{initials(patient)}
		</div>
		<div class="flex min-w-0 flex-1 flex-col">
			<span class="truncate text-[12px] font-semibold text-sidebar-foreground leading-snug">
				{patient.lastname}, {patient.firstname}
			</span>
			<div class="flex items-center gap-1">
				<span class={['h-1.5 w-1.5 rounded-full shrink-0', statusDot(patient.status)].join(' ')}></span>
				<span class="text-[10px] text-muted-foreground/60 truncate">{patient.patient_id}</span>
			</div>
		</div>
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
			<div class="flex flex-col gap-0.5 px-1.5 pt-0.5">
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

							<!-- Folder emoji icon -->
							<span class="shrink-0 text-[12px] leading-none">{folderIcon(folderName)}</span>

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
										<span class="shrink-0 text-[11px] leading-none">{fileIcon(file.filename)}</span>
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
		<a
			href="/patients"
			class="flex w-full items-center justify-center gap-1.5 rounded-md bg-sidebar-accent px-3 py-1.5 text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/80"
		>
			<svg class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M19 12H5M12 19l-7-7 7-7"/>
			</svg>
			{i18n.t.sidebar.backToList}
		</a>
	</div>
</div>
