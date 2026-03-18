<script lang="ts">
	import { slide } from 'svelte/transition';
	import { untrack } from 'svelte';
	import { Separator } from '$lib/components/ui/separator';
	import { Button } from '$lib/components/ui/button';
	import { theme } from '$lib/stores/theme.svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { docCategories, DEFAULT_CATEGORIES, type DocCategory } from '$lib/stores/categories.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { resetDb, getAllSettings, bulkSetSettings } from '$lib/services/db';
	import { pickDirectory } from '$lib/services/files';
	import { downloadJson } from '$lib/services/export';
	import { invoke } from '@tauri-apps/api/core';
	import { staffLabel, roleLabel, roleBadge } from '$lib/utils/staff';
	import { staffRoles, DEFAULT_ROLES, type StaffRole } from '$lib/stores/staffRoles.svelte';
	import { dentalTags, DEFAULT_DENTAL_TAGS } from '$lib/stores/dentalTags.svelte';
	import { textBlocks, DEFAULT_TEXT_BLOCKS, type TextBlock } from '$lib/stores/textBlocks.svelte';
	import { acuteTagOptions, medicalTagOptions, DEFAULT_ACUTE_TAGS, DEFAULT_MEDICAL_TAGS, type ClinicalTag } from '$lib/stores/clinicalTags.svelte';
	import { complicationTypes, DEFAULT_COMPLICATION_TYPES, type ComplicationType } from '$lib/stores/complicationTypes.svelte';
	import type { DentalTag, PatternType } from '$lib/types';
	import { i18n, type LangCode } from '$lib/i18n';

	// ── Language ───────────────────────────────────────────────────────────
	let showShortcutResetDialog = $state(false);
	let pendingLangCode = $state<LangCode | null>(null);

	async function handleLangChange(code: LangCode) {
		if (code === i18n.code) return;
		await i18n.setLang(code);
		// Check if any shortcut differs from the new language's defaults
		const anyDiffers = dentalTags.list.some(tag => {
			const def = i18n.t.chart.tags[tag.key as keyof typeof i18n.t.chart.tags];
			if (!def) return false;
			return (tag.shortcut ?? '').toLowerCase() !== def.defaultShortcut.toLowerCase();
		});
		if (anyDiffers) {
			pendingLangCode = code;
			showShortcutResetDialog = true;
		}
	}

	async function confirmShortcutReset() {
		await dentalTags.resetShortcutsToLanguageDefaults();
		showShortcutResetDialog = false;
		pendingLangCode = null;
	}

	// ── Vault ─────────────────────────────────────────────────────────────
	let isChangingVault = $state(false);
	let vaultChangeMsg = $state('');

	async function handleChangeVault() {
		isChangingVault = true;
		vaultChangeMsg = '';
		try {
			const path = await pickDirectory();
			if (!path) return;
			await vault.configure(path);
			resetDb();
			window.location.reload();
		} catch (e) {
			vaultChangeMsg = 'Error: ' + String(e);
			isChangingVault = false;
		}
	}

	// ── Document Categories ────────────────────────────────────────────────

	// Work with a local copy; only write to the store when user clicks Save
	let localCategories = $state<DocCategory[]>([...docCategories.list]);

	// Keep in sync if the store changes externally (e.g. first load)
	$effect(() => {
		if (docCategories.loaded) {
			localCategories = [...docCategories.list];
		}
	});

	// Add-category form state
	let newLabel = $state('');
	let newKey   = $state('');
	let newIcon  = $state('📁');
	let addError = $state('');
	let showAddForm = $state(false);

	// Category saving state
	let isSavingCategories = $state(false);
	let categoriesSaved = $state(false);

	// Auto-derive key from label (slugify)
	function slugify(s: string): string {
		return s
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_|_$/g, '')
			.slice(0, 32);
	}

	$effect(() => {
		// Auto-fill key from label, but only while the user hasn't typed in key manually
		if (newLabel && !_keyManuallyEdited) {
			newKey = slugify(newLabel);
		}
	});

	let _keyManuallyEdited = $state(false);

	function handleKeyInput(e: Event) {
		_keyManuallyEdited = true;
		newKey = (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9_]/g, '');
	}

	function resetAddForm() {
		newLabel = '';
		newKey   = '';
		newIcon  = '📁';
		addError = '';
		_keyManuallyEdited = false;
		showAddForm = false;
	}

	function handleAddCategory() {
		addError = '';
		const trimLabel = newLabel.trim();
		const trimKey   = newKey.trim();

		if (!trimLabel) { addError = 'Label is required.'; return; }
		if (!trimKey)   { addError = 'Key is required.'; return; }
		if (!/^[a-z0-9_]+$/.test(trimKey)) {
			addError = 'Key may only contain lowercase letters, digits, and underscores.';
			return;
		}
		if (localCategories.some(c => c.key === trimKey)) {
			addError = `Key "${trimKey}" already exists.`;
			return;
		}

		localCategories = [...localCategories, { key: trimKey, label: trimLabel, icon: newIcon }];
		resetAddForm();
	}

	function handleDeleteCategory(key: string) {
		localCategories = localCategories.filter(c => c.key !== key);
	}

	function handleLabelChange(key: string, value: string) {
		localCategories = localCategories.map(c => c.key === key ? { ...c, label: value } : c);
	}

	function handleIconChange(key: string, value: string) {
		localCategories = localCategories.map(c => c.key === key ? { ...c, icon: value } : c);
	}

	async function handleSaveCategories() {
		if (localCategories.length === 0) return;
		isSavingCategories = true;
		try {
			await docCategories.save(localCategories);
			categoriesSaved = true;
			setTimeout(() => (categoriesSaved = false), 2500);
		} finally {
			isSavingCategories = false;
		}
	}

	function handleResetCategories() {
		localCategories = [...DEFAULT_CATEGORIES];
	}

	const inputClass = 'border-input bg-background flex h-8 rounded-md border px-2.5 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
	const iconInputClass = 'border-input bg-background flex h-8 w-12 rounded-md border px-1.5 py-1 text-sm text-center outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';

	// ── Staff ──────────────────────────────────────────────────────────────

	let showAddStaff = $state(false);
	let newStaffName     = $state('');
	let newStaffRole     = $state('doctor');
	let newStaffSpec     = $state('');
	let newStaffColor    = $state('#6366f1');
	let addStaffError    = $state('');
	let staffSaving      = $state(false);

	// Per-row edit state: null = not editing; number = id of row being edited
	let editingStaffId = $state<number | null>(null);
	let editStaffName  = $state('');
	let editStaffRole  = $state('doctor');
	let editStaffSpec  = $state('');
	let editStaffColor = $state('#6366f1');

	function startEditStaff(doc: { id: number; name: string; role: string; specialty: string; color: string }) {
		editingStaffId = doc.id;
		editStaffName  = doc.name;
		editStaffRole  = doc.role;
		editStaffSpec  = doc.specialty;
		editStaffColor = doc.color;
	}

	async function saveEditStaff(id: number) {
		const name = editStaffName.trim();
		if (!name) return;
		staffSaving = true;
		try {
			await doctors.update(id, { name, role: editStaffRole, specialty: editStaffSpec.trim(), color: editStaffColor });
			editingStaffId = null;
		} finally {
			staffSaving = false;
		}
	}

	async function handleAddStaff() {
		addStaffError = '';
		const name = newStaffName.trim();
		if (!name) { addStaffError = 'Name is required.'; return; }
		staffSaving = true;
		try {
			await doctors.add({ name, role: newStaffRole, specialty: newStaffSpec.trim(), color: newStaffColor });
			newStaffName = ''; newStaffRole = 'doctor'; newStaffSpec = ''; newStaffColor = '#6366f1';
			showAddStaff = false;
		} catch (e) {
			addStaffError = String(e);
		} finally {
			staffSaving = false;
		}
	}

	async function handleDeleteStaff(id: number) {
		await doctors.remove(id);
		if (editingStaffId === id) editingStaffId = null;
	}

	// ── Staff Roles (embedded in Staff card) ──────────────────────────────

	let showRolesPanel = $state(false);
	let localRoles = $state<StaffRole[]>([...staffRoles.list]);
	let rolesSaving = $state(false);
	let rolesSaved  = $state(false);

	$effect(() => {
		if (staffRoles.loaded) localRoles = [...staffRoles.list];
	});

	let showAddRole   = $state(false);
	let newRoleKey    = $state('');
	let newRoleLabel  = $state('');
	let newRolePrefix = $state('');
	let addRoleError  = $state('');
	let _roleKeyManuallyEdited = $state(false);

	$effect(() => {
		if (newRoleLabel && !_roleKeyManuallyEdited) {
			newRoleKey = slugify(newRoleLabel);
		}
	});

	function handleRoleKeyInput(e: Event) {
		_roleKeyManuallyEdited = true;
		newRoleKey = (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9_]/g, '');
	}

	function resetRoleForm() {
		newRoleKey = ''; newRoleLabel = ''; newRolePrefix = ''; addRoleError = '';
		_roleKeyManuallyEdited = false; showAddRole = false;
	}

	function handleAddRole() {
		addRoleError = '';
		const trimKey   = newRoleKey.trim();
		const trimLabel = newRoleLabel.trim();
		if (!trimLabel) { addRoleError = 'Label is required.'; return; }
		if (!trimKey)   { addRoleError = 'Key is required.'; return; }
		if (!/^[a-z0-9_]+$/.test(trimKey)) { addRoleError = 'Key may only contain lowercase letters, digits, and underscores.'; return; }
		if (localRoles.some(r => r.key === trimKey)) { addRoleError = `Key "${trimKey}" already exists.`; return; }
		localRoles = [...localRoles, { key: trimKey, label: trimLabel, prefix: newRolePrefix.trim() }];
		resetRoleForm();
	}

	function handleDeleteRole(key: string) {
		localRoles = localRoles.filter(r => r.key !== key);
	}

	async function handleSaveRoles() {
		rolesSaving = true;
		try {
			await staffRoles.save(localRoles);
			// Update role for any staff add/edit states if their current role was removed
			if (!localRoles.some(r => r.key === newStaffRole)) newStaffRole = localRoles[0]?.key ?? 'doctor';
			if (!localRoles.some(r => r.key === editStaffRole)) editStaffRole = localRoles[0]?.key ?? 'doctor';
			rolesSaved = true;
			setTimeout(() => (rolesSaved = false), 2500);
		} finally {
			rolesSaving = false;
		}
	}

	function handleResetRoles() {
		localRoles = [...DEFAULT_ROLES];
	}

	// ── Dental Chart Tags ──────────────────────────────────────────────────

	const PATTERNS: { key: PatternType; label: string }[] = [
		{ key: 'solid',      label: 'Solid' },
		{ key: 'diagonal',   label: 'Diagonal' },
		{ key: 'crosshatch', label: 'Crosshatch' },
		{ key: 'horizontal', label: 'Horizontal' },
		{ key: 'vertical',   label: 'Vertical' },
		{ key: 'dots',       label: 'Dots' },
	];

	let draftTags      = $state<DentalTag[]>([]);
	let isTagsSaving   = $state(false);
	let tagsSaved      = $state(false);
	let openPatternIdx = $state<number | null>(null);

	$effect(() => {
		if (dentalTags.loaded) {
			draftTags = untrack(() => dentalTags.list.map(t => ({ ...t })));
		}
	});

	const duplicateShortcuts = $derived.by(() => {
		const seen = new Map<string, number>();
		const dupes = new Set<string>();
		for (const t of draftTags) {
			if (!t.shortcut) continue;
			const key = t.shortcut.toLowerCase();
			seen.set(key, (seen.get(key) ?? 0) + 1);
		}
		for (const [k, count] of seen) { if (count > 1) dupes.add(k); }
		return dupes;
	});

	function updateTag(i: number, field: keyof DentalTag, value: string) {
		draftTags = draftTags.map((t, idx) => {
			if (idx !== i) return t;
			if (field === 'shortcut') {
				const { shortcut: _s, ...rest } = t;
				return value ? { ...rest, shortcut: value } : { ...rest };
			}
			return { ...t, [field]: value };
		});
	}

	function selectPattern(i: number, p: PatternType) {
		draftTags = draftTags.map((t, idx) => idx === i ? { ...t, pattern: p } : t);
		openPatternIdx = null;
	}

	function addTag() {
		const key = `custom_${Date.now()}`;
		draftTags = [...draftTags, { key, label: 'New Tag', color: '#e0f2fe', strokeColor: '#0284c7', pattern: 'solid' }];
	}

	function removeTag(i: number) {
		draftTags      = draftTags.filter((_, idx) => idx !== i);
		openPatternIdx = null;
	}

	async function resetTags() {
		draftTags      = DEFAULT_DENTAL_TAGS.map(t => ({ ...t }));
		openPatternIdx = null;
		await handleSaveTags();
	}

	async function handleSaveTags() {
		if (duplicateShortcuts.size > 0) return;
		isTagsSaving = true;
		try {
			await dentalTags.save(draftTags);
			tagsSaved = true;
			setTimeout(() => (tagsSaved = false), 2500);
		} finally {
			isTagsSaving = false;
		}
	}

	// ── Text Blocks ────────────────────────────────────────────────────────────────────
	let draftBlocks      = $state<TextBlock[]>([]);
	let isBlocksSaving   = $state(false);
	let blocksSaved      = $state(false);
	let expandedBlockIdx = $state<number | null>(null);

	$effect(() => {
		if (textBlocks.loaded) {
			draftBlocks = untrack(() => textBlocks.list.map(b => ({ ...b })));
		}
	});

	function slugifyBlockKey(s: string): string {
		return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32);
	}

	function addBlock() {
		draftBlocks = [...draftBlocks, { key: '', label: '', body: '' }];
		expandedBlockIdx = draftBlocks.length - 1;
	}

	function removeBlock(i: number) {
		draftBlocks = draftBlocks.filter((_, idx) => idx !== i);
		if (expandedBlockIdx === i) expandedBlockIdx = null;
	}

	function updateBlock<K extends keyof TextBlock>(i: number, field: K, value: TextBlock[K]) {
		const b: TextBlock = { ...draftBlocks[i], [field]: value };
		if (field === 'label' && !draftBlocks[i].key) b.key = slugifyBlockKey(value as string);
		draftBlocks[i] = b;
	}

	const duplicateBlockKeys = $derived.by(() => {
		const seen = new Map<string, number>();
		const dupes = new Set<string>();
		for (const b of draftBlocks) {
			if (!b.key) continue;
			if (seen.has(b.key)) dupes.add(b.key);
			else seen.set(b.key, 1);
		}
		return dupes;
	});

	async function handleSaveBlocks() {
		if (duplicateBlockKeys.size > 0) return;
		isBlocksSaving = true;
		try {
			await textBlocks.save(draftBlocks.filter(b => b.key && b.label));
			blocksSaved = true;
			setTimeout(() => (blocksSaved = false), 2500);
		} finally {
			isBlocksSaving = false;
		}
	}

	async function resetBlocks() {
		draftBlocks = DEFAULT_TEXT_BLOCKS.map(b => ({ ...b }));
		expandedBlockIdx = null;
		await handleSaveBlocks();
	}

	// ── Clinical Tags ──────────────────────────────────────────────────────────

	let draftAcuteTags   = $state<ClinicalTag[]>([]);
	let draftMedicalTags = $state<ClinicalTag[]>([]);
	let acuteTagsSaving   = $state(false);
	let medicalTagsSaving = $state(false);
	let acuteTagsSaved    = $state(false);
	let medicalTagsSaved  = $state(false);
	let newAcuteTag       = $state('');
	let newMedicalTag     = $state('');

	$effect(() => {
		if (acuteTagOptions.loaded)   draftAcuteTags   = untrack(() => [...acuteTagOptions.list]);
	});
	$effect(() => {
		if (medicalTagOptions.loaded) draftMedicalTags = untrack(() => [...medicalTagOptions.list]);
	});

	async function saveAcuteTags() {
		acuteTagsSaving = true;
		try {
			await acuteTagOptions.save(draftAcuteTags);
			acuteTagsSaved = true;
			setTimeout(() => (acuteTagsSaved = false), 2500);
		} finally {
			acuteTagsSaving = false;
		}
	}

	async function saveMedicalTags() {
		medicalTagsSaving = true;
		try {
			await medicalTagOptions.save(draftMedicalTags);
			medicalTagsSaved = true;
			setTimeout(() => (medicalTagsSaved = false), 2500);
		} finally {
			medicalTagsSaving = false;
		}
	}

	function addAcuteTag() {
		const t = newAcuteTag.trim();
		if (!t || draftAcuteTags.some(tag => acuteTagOptions.displayLabel(tag) === t)) return;
		draftAcuteTags = [...draftAcuteTags, { key: 'custom_' + Date.now(), label: t }];
		newAcuteTag = '';
	}

	function addMedicalTag() {
		const t = newMedicalTag.trim();
		if (!t || draftMedicalTags.some(tag => medicalTagOptions.displayLabel(tag) === t)) return;
		draftMedicalTags = [...draftMedicalTags, { key: 'custom_' + Date.now(), label: t }];
		newMedicalTag = '';
	}

	// ── Complication Types ──────────────────────────────────────────────────────
	let draftComplicationTypes = $state<ComplicationType[]>([]);
	let complicationTypesSaving = $state(false);
	let complicationTypesSaved  = $state(false);
	let newComplicationTypeLabel = $state('');

	$effect(() => {
		if (complicationTypes.loaded) draftComplicationTypes = untrack(() => [...complicationTypes.list]);
	});

	async function saveComplicationTypes() {
		complicationTypesSaving = true;
		try {
			await complicationTypes.save(draftComplicationTypes);
			complicationTypesSaved = true;
			setTimeout(() => (complicationTypesSaved = false), 2500);
		} finally {
			complicationTypesSaving = false;
		}
	}

	function addComplicationTypeItem() {
		const t = newComplicationTypeLabel.trim();
		if (!t || draftComplicationTypes.some(ct => complicationTypes.displayLabel(ct) === t)) return;
		draftComplicationTypes = [...draftComplicationTypes, { key: 'custom_' + Date.now(), label: t }];
		newComplicationTypeLabel = '';
	}

	// ── Backup & Export ─────────────────────────────────────────────────────
	let importFileEl          = $state<HTMLInputElement | null>(null);
	let isBackingUpDb         = $state(false);
	let isBackingUpVault      = $state(false);
	let dbBackupMsg           = $state('');
	let dbBackupError         = $state(false);
	let vaultBackupMsg        = $state('');
	let vaultBackupError      = $state(false);
	let showImportConfirm     = $state(false);
	let pendingImportEntries  = $state<{ key: string; value: string }[]>([]);
	let importMsg             = $state('');
	let importError           = $state(false);

	async function handleExportSettings() {
		try {
			const settings = await getAllSettings();
			const payload = {
				version: 1,
				exportedAt: new Date().toISOString(),
				app: 'DentVault',
				settings,
			};
			const dateStr = new Date().toISOString().slice(0, 10);
			downloadJson(payload, `dentvault-settings-${dateStr}.json`);
		} catch (e) {
			console.error('Settings export failed:', e);
		}
	}

	function handleImportFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = (ev) => {
			try {
				const raw = JSON.parse(ev.target?.result as string);
				if (!Array.isArray(raw?.settings) || !raw.settings.every((s: unknown) =>
					typeof (s as Record<string, unknown>)?.key === 'string' &&
					typeof (s as Record<string, unknown>)?.value === 'string'
				)) {
					importMsg = i18n.t.settings.backup.importError;
					importError = true;
					return;
				}
				pendingImportEntries = raw.settings;
				showImportConfirm = true;
			} catch {
				importMsg = i18n.t.settings.backup.importError;
				importError = true;
			}
		};
		reader.readAsText(file);
		// Reset the file input so the same file can be picked again
		(e.target as HTMLInputElement).value = '';
	}

	async function confirmImport() {
		showImportConfirm = false;
		try {
			await bulkSetSettings(pendingImportEntries);
			importMsg = i18n.t.settings.backup.importSuccess;
			importError = false;
			setTimeout(() => window.location.reload(), 1200);
		} catch (e) {
			importMsg = i18n.t.settings.backup.importError + ' ' + String(e);
			importError = true;
		}
		pendingImportEntries = [];
	}

	async function handleBackupDatabase() {
		const dir = await pickDirectory();
		if (!dir) return;
		isBackingUpDb = true;
		dbBackupMsg = '';
		try {
			const dateStr = new Date().toISOString().slice(0, 10);
			const destPath = `${dir}/dentvault-backup-${dateStr}.db`;
			await invoke('backup_database', { vaultPath: vault.path, destPath });
			dbBackupMsg = `${i18n.t.settings.backup.backupSuccess} ${destPath}`;
			dbBackupError = false;
		} catch (e) {
			dbBackupMsg = `${i18n.t.settings.backup.backupError} ${String(e)}`;
			dbBackupError = true;
		} finally {
			isBackingUpDb = false;
		}
	}

	async function handleBackupVault() {
		const dir = await pickDirectory();
		if (!dir) return;
		isBackingUpVault = true;
		vaultBackupMsg = '';
		try {
			const backupPath = await invoke<string>('backup_vault_to', { vaultPath: vault.path, destDir: dir });
			vaultBackupMsg = `${i18n.t.settings.backup.backupSuccess} ${backupPath}`;
			vaultBackupError = false;
		} catch (e) {
			vaultBackupMsg = `${i18n.t.settings.backup.backupError} ${String(e)}`;
			vaultBackupError = true;
		} finally {
			isBackingUpVault = false;
		}
	}
</script>

<div class="flex flex-col gap-8 max-w-2xl">

	<!-- Page header -->
	<div>
		<h1 class="text-2xl font-bold tracking-tight">{i18n.t.settings.title}</h1>
		<p class="text-sm text-muted-foreground mt-1">{i18n.t.settings.sections.general}</p>
	</div>

	<!-- ── Language ── -->
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.languageLabel}</h2>
		</div>
		<Separator />
		<div class="flex gap-2">
			{#each (['de', 'en'] as LangCode[]) as code}
				<button
					type="button"
					onclick={() => handleLangChange(code)}
					class={[
						'flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors',
						i18n.code === code
							? 'border-primary bg-primary/10 text-primary'
							: 'border-border bg-card text-muted-foreground hover:border-foreground/40 hover:text-foreground',
					].join(' ')}
				>
					{code === 'de' ? '🇩🇪 Deutsch' : '🇬🇧 English'}
				</button>
			{/each}
		</div>
	</section>

	<!-- Shortcut reset confirmation dialog -->
	{#if showShortcutResetDialog}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
			<div class="w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl">
				<h3 class="text-base font-semibold">{i18n.t.chart.resetShortcuts}</h3>
				<p class="mt-2 text-sm text-muted-foreground">{i18n.t.chart.resetShortcutsConfirm}</p>
				<div class="mt-5 flex justify-end gap-3">
					<Button variant="outline" size="sm" onclick={() => { showShortcutResetDialog = false; pendingLangCode = null; }}>
						{i18n.t.actions.cancel}
					</Button>
					<Button size="sm" onclick={confirmShortcutReset}>
						{i18n.t.chart.resetShortcuts}
					</Button>
				</div>
			</div>
		</div>
	{/if}

	<!-- ── Appearance ── -->
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.appearance}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.settings.theme.label}</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex items-center justify-between gap-6">
			<div class="flex flex-col gap-0.5">
				<span class="text-sm font-medium">{i18n.t.settings.sections.appearance}</span>
				<span class="text-xs text-muted-foreground">
					{theme.current === 'dark' ? i18n.t.settings.theme.dark : i18n.t.settings.theme.light}
				</span>
			</div>

			<div class="flex items-center gap-1 rounded-full border bg-muted p-1">
				<button
					type="button"
					onclick={() => theme.set('light')}
					class={[
						'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all',
						theme.current === 'light'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground',
					].join(' ')}
					aria-pressed={theme.current === 'light'}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
						<circle cx="12" cy="12" r="4"/>
						<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
					</svg>
					{i18n.t.settings.theme.light}
				</button>
				<button
					type="button"
					onclick={() => theme.set('dark')}
					class={[
						'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all',
						theme.current === 'dark'
							? 'bg-background text-foreground shadow-sm'
							: 'text-muted-foreground hover:text-foreground',
					].join(' ')}
					aria-pressed={theme.current === 'dark'}
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
						<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
					</svg>
					{i18n.t.settings.theme.dark}
				</button>
			</div>
		</div>
	</section>

	<!-- ── Document Categories ── -->
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.docCategories}</h2>
			<p class="text-sm text-muted-foreground">
				{i18n.t.settings.docCategories.description}
			</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">

			<!-- Column headers -->
			<div class="grid grid-cols-[2rem_1fr_1fr_6rem_2rem] gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1">
				<span>{i18n.t.settings.docCategories.iconField}</span>
				<span>{i18n.t.settings.docCategories.labelField}</span>
				<span>Folder key</span>
				<span>{i18n.t.settings.sections.vault}</span>
				<span></span>
			</div>

			<Separator />

			<!-- Category rows -->
			<div class="flex flex-col gap-2">
				{#each localCategories as cat (cat.key)}
					<div class="grid grid-cols-[2rem_1fr_1fr_6rem_2rem] items-center gap-2">
						<!-- Icon -->
						<input
							type="text"
							class={iconInputClass}
							value={cat.icon}
							oninput={(e) => handleIconChange(cat.key, (e.target as HTMLInputElement).value)}
							title="Emoji icon"
							maxlength="4"
						/>
						<!-- Label -->
						<input
							type="text"
							class="{inputClass} w-full"
							value={cat.label}
							oninput={(e) => handleLabelChange(cat.key, (e.target as HTMLInputElement).value)}
							placeholder="Category name"
						/>
						<!-- Key (read-only — changing it would break existing documents) -->
						<div class="flex items-center h-8">
							<code class="text-xs text-muted-foreground bg-muted rounded px-2 py-1 truncate w-full">
								{cat.key}
							</code>
						</div>
						<!-- Vault folder -->
						<div class="flex items-center h-8">
							<code class="text-xs text-muted-foreground truncate">
								{vault.categoryFolder(cat.key)}/
							</code>
						</div>
						<!-- Delete -->
						<button
							type="button"
							onclick={() => handleDeleteCategory(cat.key)}
							class="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
							title="Remove category"
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
								<path d="M18 6L6 18M6 6l12 12"/>
							</svg>
						</button>
					</div>
				{/each}
			</div>

			<!-- Add category form -->
			{#if showAddForm}
				<div class="rounded-md border border-dashed bg-muted/30 p-3 flex flex-col gap-3">
					<p class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{i18n.t.settings.docCategories.add}</p>

					<div class="grid grid-cols-[auto_1fr_auto] gap-2 items-start">
						<div class="flex flex-col gap-1">
							<label for="new-cat-icon" class="text-[10px] text-muted-foreground">Icon</label>
							<input
								id="new-cat-icon"
								type="text"
								class={iconInputClass}
								bind:value={newIcon}
								maxlength="4"
								placeholder="📁"
							/>
						</div>
						<div class="flex flex-col gap-1">
							<label for="new-cat-label" class="text-[10px] text-muted-foreground">Label <span class="text-destructive">*</span></label>
							<input
								id="new-cat-label"
								type="text"
								class="{inputClass} w-full"
								bind:value={newLabel}
								placeholder="e.g. CBCT Scans"
							/>
						</div>
						<div class="flex flex-col gap-1">
							<label for="new-cat-key" class="text-[10px] text-muted-foreground">Key / folder name <span class="text-destructive">*</span></label>
							<input
								id="new-cat-key"
								type="text"
								class="{inputClass} w-40 font-mono"
								value={newKey}
								oninput={handleKeyInput}
								placeholder="cbct_scans"
							/>
						</div>
					</div>

					{#if newKey}
						<p class="text-[10px] text-muted-foreground">
							Files will be saved to: <code class="bg-muted px-1 rounded">{newKey}/</code> inside each patient folder.
						</p>
					{/if}

					{#if addError}
						<p class="text-xs text-destructive">{addError}</p>
					{/if}

					<div class="flex gap-2">
						<Button size="sm" onclick={handleAddCategory}>{i18n.t.settings.docCategories.add}</Button>
						<Button size="sm" variant="outline" onclick={resetAddForm}>{i18n.t.actions.cancel}</Button>
					</div>
				</div>
			{/if}

			<!-- Actions -->
			<div class="flex items-center gap-3 pt-1">
				{#if !showAddForm}
					<Button
						size="sm"
						variant="outline"
						onclick={() => { showAddForm = true; _keyManuallyEdited = false; }}
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-1.5 h-3.5 w-3.5">
							<path d="M12 5v14M5 12h14"/>
						</svg>
						{i18n.t.settings.docCategories.add}
					</Button>
				{/if}

				<Button size="sm" onclick={handleSaveCategories} disabled={isSavingCategories || localCategories.length === 0}>
					{isSavingCategories ? i18n.t.common.loading : i18n.t.actions.save}
				</Button>

				{#if categoriesSaved}
					<span class="text-sm text-emerald-600 dark:text-emerald-400 font-medium">✓ {i18n.t.settings.saved}</span>
				{/if}

				<button
					type="button"
					class="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
					onclick={handleResetCategories}
				>
					{i18n.t.settings.resetToDefaults}
				</button>
			</div>

			<p class="text-[10px] text-muted-foreground/70 leading-relaxed">
				⚠️ Renaming a category's <strong>label</strong> or <strong>icon</strong> is safe — existing documents keep their category key.
				Deleting a category does <em>not</em> delete its documents; they remain visible under their original key.
				The folder key cannot be changed after creation.
			</p>
		</div>
	</section>

	<!-- ── Dental Chart Tags ── -->
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.chart.title}</h2>
			<p class="text-sm text-muted-foreground">
				{i18n.t.chart.editTags}
			</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-3">

			{#snippet patIcon(pt: PatternType, color: string, stroke: string)}
				<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" class="shrink-0 rounded">
					<rect width="20" height="20" fill={color}/>
					{#if pt === 'diagonal'}
						<line x1="-1" y1="5"  x2="5"  y2="-1" stroke={stroke} stroke-width="1.2"/>
						<line x1="-1" y1="13" x2="13" y2="-1" stroke={stroke} stroke-width="1.2"/>
						<line x1="-1" y1="21" x2="21" y2="-1" stroke={stroke} stroke-width="1.2"/>
						<line x1="5"  y1="21" x2="21" y2="5"  stroke={stroke} stroke-width="1.2"/>
						<line x1="13" y1="21" x2="21" y2="13" stroke={stroke} stroke-width="1.2"/>
					{:else if pt === 'crosshatch'}
						<line x1="0" y1="6"  x2="20" y2="6"  stroke={stroke} stroke-width="1"/>
						<line x1="0" y1="14" x2="20" y2="14" stroke={stroke} stroke-width="1"/>
						<line x1="6"  y1="0" x2="6"  y2="20" stroke={stroke} stroke-width="1"/>
						<line x1="14" y1="0" x2="14" y2="20" stroke={stroke} stroke-width="1"/>
					{:else if pt === 'horizontal'}
						<line x1="0" y1="7"  x2="20" y2="7"  stroke={stroke} stroke-width="1.5"/>
						<line x1="0" y1="14" x2="20" y2="14" stroke={stroke} stroke-width="1.5"/>
					{:else if pt === 'vertical'}
						<line x1="7"  y1="0" x2="7"  y2="20" stroke={stroke} stroke-width="1.5"/>
						<line x1="14" y1="0" x2="14" y2="20" stroke={stroke} stroke-width="1.5"/>
					{:else if pt === 'dots'}
						<circle cx="5"  cy="5"  r="2" fill={stroke}/>
						<circle cx="15" cy="5"  r="2" fill={stroke}/>
						<circle cx="5"  cy="15" r="2" fill={stroke}/>
						<circle cx="15" cy="15" r="2" fill={stroke}/>
						<circle cx="10" cy="10" r="2" fill={stroke}/>
					{/if}
				</svg>
			{/snippet}

			<!-- Tag rows -->
			<div class="flex flex-col gap-1.5">
				{#each draftTags as tag, i}
					<div class="rounded-md border bg-background">
						<!-- Single row: colour bar · label · shortcut · fill · border · pattern · delete -->
						<div class="flex items-center gap-2 px-3 py-2">
							<!-- Colour preview swatch -->
							<div class="h-7 w-2 rounded-full shrink-0" style="background:{tag.color};outline:2px solid {tag.strokeColor};outline-offset:1px"></div>
							<!-- Label -->
							<input
								type="text"
								value={tag.label}
								oninput={(e) => updateTag(i, 'label', (e.target as HTMLInputElement).value)}
								class="border-input bg-transparent h-8 min-w-0 flex-1 rounded border px-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
								placeholder="Tag name"
							/>
							<!-- Shortcut key -->
							<input
								type="text"
								maxlength="1"
								value={tag.shortcut ?? ''}
								oninput={(e) => updateTag(i, 'shortcut', (e.target as HTMLInputElement).value.slice(-1))}
								class={[
									'h-8 w-9 shrink-0 rounded border text-center font-mono text-sm outline-none',
									tag.shortcut && duplicateShortcuts.has(tag.shortcut.toLowerCase())
										? 'border-destructive bg-destructive/10 text-destructive focus:border-destructive focus:ring-1 focus:ring-destructive/50'
										: 'border-input bg-background focus:border-ring focus:ring-1 focus:ring-ring/50',
								].join(' ')}
								placeholder="—"
								title={tag.shortcut && duplicateShortcuts.has(tag.shortcut.toLowerCase()) ? 'Duplicate shortcut' : 'Shortcut key'}
							/>
							<!-- Fill colour -->
							<label class="relative h-8 w-8 shrink-0 rounded border-2 border-border overflow-hidden cursor-pointer" style="background:{tag.color}" title="Fill colour">
								<input
									type="color"
									value={tag.color}
									oninput={(e) => updateTag(i, 'color', (e.target as HTMLInputElement).value)}
									class="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer opacity-0"
								/>
							</label>
							<!-- Border colour -->
							<label class="relative h-8 w-8 shrink-0 rounded border-2 overflow-hidden cursor-pointer" style="background:{tag.strokeColor};border-color:{tag.strokeColor}" title="Border colour">
								<input
									type="color"
									value={tag.strokeColor}
									oninput={(e) => updateTag(i, 'strokeColor', (e.target as HTMLInputElement).value)}
									class="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer opacity-0"
								/>
							</label>
							<!-- Pattern toggle -->
							<button
								type="button"
								onclick={() => { openPatternIdx = openPatternIdx === i ? null : i; }}
								class={[
									'flex items-center gap-1 rounded border px-1.5 h-8 shrink-0 transition-colors',
									openPatternIdx === i ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/40',
								].join(' ')}
								title="Change fill pattern"
							>
								{@render patIcon(tag.pattern, tag.color, tag.strokeColor)}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
									class={['h-3 w-3 text-muted-foreground transition-transform duration-150', openPatternIdx === i ? 'rotate-180' : ''].join(' ')}>
									<polyline points="6 9 12 15 18 9"/>
								</svg>
							</button>
							<!-- Delete -->
							<button
								type="button"
								onclick={() => removeTag(i)}
								class="shrink-0 rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
								aria-label="Remove tag"
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
									<path d="M18 6L6 18M6 6l12 12"/>
								</svg>
							</button>
						</div>
						<!-- Pattern picker panel -->
						{#if openPatternIdx === i}
							<div transition:slide={{ duration: 120 }} class="border-t border-border/50 px-3 py-2.5 flex items-center gap-2 flex-wrap rounded-b-md bg-muted/30">
								<span class="text-[10px] font-medium text-muted-foreground w-full mb-0.5">Choose fill pattern:</span>
								{#each PATTERNS as p}
									<button
										type="button"
										onclick={() => selectPattern(i, p.key)}
										class={[
											'flex flex-col items-center gap-1 rounded border p-1.5 transition-all',
											tag.pattern === p.key
												? 'border-primary bg-primary/10 ring-2 ring-primary ring-offset-1'
												: 'border-border hover:border-foreground/40 bg-background',
										].join(' ')}
										title={p.label}
									>
										{@render patIcon(p.key, tag.color, tag.strokeColor)}
										<span class="text-[9px] text-muted-foreground leading-none">{p.label}</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Add tag -->
			<button
				type="button"
				onclick={addTag}
				class="flex items-center gap-1.5 rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
					<path d="M12 5v14M5 12h14"/>
				</svg>
				{i18n.t.actions.add}
			</button>

			<!-- Actions -->
			<div class="flex items-center gap-3 pt-1">
				<Button size="sm" onclick={handleSaveTags} disabled={isTagsSaving || duplicateShortcuts.size > 0}>
					{isTagsSaving ? i18n.t.common.loading : i18n.t.actions.save}
				</Button>
				{#if tagsSaved}
					<span class="text-sm text-emerald-600 dark:text-emerald-400 font-medium">✓ {i18n.t.settings.saved}</span>
				{/if}
				{#if duplicateShortcuts.size > 0}
					<span class="text-xs text-destructive">{i18n.t.chart.editTagsDialog.duplicateShortcut}: {[...duplicateShortcuts].join(', ')}</span>
				{/if}
				<button
					type="button"
					class="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
					onclick={resetTags}
				>
					{i18n.t.settings.resetToDefaults}
				</button>
			</div>

		</div>
	</section>

	<!-- ── Staff ── -->
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.staff.title}</h2>
			<p class="text-sm text-muted-foreground">
				{i18n.t.settings.staffRoles.description}
			</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">

			{#if doctors.list.length === 0 && !showAddStaff}
				<p class="text-sm text-muted-foreground italic">{i18n.t.staff.noStaff}</p>
			{/if}

			{#if doctors.list.length > 0}
				<!-- Column headers -->
				<div class="grid grid-cols-[1.5rem_1fr_5rem_5rem_auto_3rem_2rem_2rem] items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1">
					<span></span>
					<span>{i18n.t.staff.fields.name}</span>
					<span>{i18n.t.staff.fields.role}</span>
					<span>Specialty</span>
					<span>Color</span>
					<span title="Doc Bar">Bar</span>
					<span></span>
					<span></span>
				</div>
				<Separator />

				<!-- Staff rows -->
				<div class="flex flex-col gap-2">
					{#each doctors.list as doc (doc.id)}
						{#if editingStaffId === doc.id}
							<!-- Edit row -->
							<div class="flex flex-col gap-2 rounded-md border border-primary/30 bg-primary/5 p-3">
								<div class="grid grid-cols-2 gap-2">
									<div class="flex flex-col gap-1">
										<label for="staff-edit-name" class="text-[10px] text-muted-foreground uppercase tracking-wide">{i18n.t.staff.fields.name}</label>
										<input id="staff-edit-name" type="text" bind:value={editStaffName} class="{inputClass} w-full" placeholder="Full name" />
									</div>
									<div class="flex flex-col gap-1">
										<label for="staff-edit-role" class="text-[10px] text-muted-foreground uppercase tracking-wide">{i18n.t.staff.fields.role}</label>
										<select id="staff-edit-role" bind:value={editStaffRole} class="{inputClass} w-full">
											{#each staffRoles.list as role (role.key)}
												<option value={role.key}>{role.label}</option>
											{/each}
										</select>
									</div>
									<div class="flex flex-col gap-1">
										<label for="staff-edit-spec" class="text-[10px] text-muted-foreground uppercase tracking-wide">Specialty</label>
										<input id="staff-edit-spec" type="text" bind:value={editStaffSpec} class="{inputClass} w-full" placeholder="e.g. Orthodontics" />
									</div>
									<div class="flex flex-col gap-1">
										<label for="staff-edit-color" class="text-[10px] text-muted-foreground uppercase tracking-wide">Color</label>
										<div class="flex items-center gap-2">
											<input id="staff-edit-color" type="color" bind:value={editStaffColor} class="h-8 w-12 rounded border border-input cursor-pointer" />
											<span class="text-xs text-muted-foreground">{editStaffColor}</span>
										</div>
									</div>
								</div>
								<div class="flex gap-2 justify-end mt-1">
									<button type="button" onclick={() => (editingStaffId = null)} class="rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors">{i18n.t.actions.cancel}</button>
									<button type="button" onclick={() => saveEditStaff(doc.id)} disabled={staffSaving || !editStaffName.trim()} class="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity">{i18n.t.actions.save}</button>
								</div>
							</div>
						{:else}
							<!-- Display row -->
							<div class="grid grid-cols-[1.5rem_1fr_5rem_5rem_auto_3rem_2rem_2rem] items-center gap-2 py-1 px-1 rounded-md hover:bg-muted/30 group">
								<!-- Color dot -->
								<span class="h-3 w-3 rounded-full shrink-0 ring-1 ring-black/10" style="background: {doc.color}"></span>
								<!-- Name -->
								<span class="text-sm font-medium truncate">{staffLabel(doc)}</span>
								<!-- Role badge -->
								<span class="text-xs rounded-full px-2 py-0.5 font-medium w-fit {staffRoles.getBadgeClass(doc.role)}">{roleBadge(doc.role)}</span>
								<!-- Specialty -->
								<span class="text-xs text-muted-foreground truncate">{doc.specialty || '—'}</span>
								<!-- Spacer -->
								<span></span>
								<!-- Doc bar toggle -->
								<button
									type="button"
									onclick={() => doctors.update(doc.id, { show_in_doc_bar: doc.show_in_doc_bar === 0 ? 1 : 0 })}
									class={['flex items-center justify-center h-5 w-5 rounded border transition-colors', doc.show_in_doc_bar !== 0 ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground/40 hover:border-foreground/30'].join(' ')}
									title={doc.show_in_doc_bar !== 0 ? 'Shown in doc bar (click to hide)' : 'Hidden from doc bar (click to show)'}
								>
									{#if doc.show_in_doc_bar !== 0}
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-3 w-3"><polyline points="20 6 9 17 4 12"/></svg>
									{/if}
								</button>
								<!-- Edit button -->
								<button type="button" onclick={() => startEditStaff(doc)} class="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground" aria-label="Edit">
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
								</button>
								<!-- Delete button -->
								<button type="button" onclick={() => handleDeleteStaff(doc.id)} class="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive" aria-label="Delete">
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
								</button>
							</div>
						{/if}
					{/each}
				</div>
			{/if}

			<!-- Add staff form -->
			{#if showAddStaff}
				<div class="flex flex-col gap-3 rounded-md border border-dashed border-primary/40 p-4 mt-1">
					<p class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{i18n.t.staff.add}</p>
					{#if addStaffError}
						<p class="text-xs text-destructive">{addStaffError}</p>
					{/if}
					<div class="grid grid-cols-2 gap-3">
						<div class="flex flex-col gap-1">
							<label for="staff-new-name" class="text-[10px] text-muted-foreground uppercase tracking-wide">{i18n.t.staff.fields.name} *</label>
							<input id="staff-new-name" type="text" bind:value={newStaffName} class="{inputClass} w-full" placeholder="e.g. Anna Müller" />
						</div>
						<div class="flex flex-col gap-1">
							<label for="staff-new-role" class="text-[10px] text-muted-foreground uppercase tracking-wide">{i18n.t.staff.fields.role} *</label>
							<select id="staff-new-role" bind:value={newStaffRole} class="{inputClass} w-full">
								{#each staffRoles.list as role (role.key)}
									<option value={role.key}>{role.label}</option>
								{/each}
							</select>
						</div>
						<div class="flex flex-col gap-1">
							<label for="staff-new-spec" class="text-[10px] text-muted-foreground uppercase tracking-wide">Specialty</label>
							<input id="staff-new-spec" type="text" bind:value={newStaffSpec} class="{inputClass} w-full" placeholder="e.g. Orthodontics" />
						</div>
						<div class="flex flex-col gap-1">
							<label for="staff-new-color" class="text-[10px] text-muted-foreground uppercase tracking-wide">Color</label>
							<div class="flex items-center gap-2">
								<input id="staff-new-color" type="color" bind:value={newStaffColor} class="h-8 w-12 rounded border border-input cursor-pointer" />
								<span class="text-xs text-muted-foreground">{newStaffColor}</span>
							</div>
						</div>
					</div>
					<div class="flex gap-2 justify-end">
						<button type="button" onclick={() => { showAddStaff = false; addStaffError = ''; }} class="rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors">{i18n.t.actions.cancel}</button>
						<button type="button" onclick={handleAddStaff} disabled={staffSaving || !newStaffName.trim()} class="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity">{staffSaving ? i18n.t.common.loading : i18n.t.staff.add}</button>
					</div>
				</div>
			{/if}

			<!-- Add Staff Member button -->
		{#if !showAddStaff}
			<button type="button" onclick={() => (showAddStaff = true)} class="self-start flex items-center gap-2 rounded-md border border-dashed px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
				{i18n.t.staff.add}
			</button>
		{/if}

		<!-- ── Manage Roles sub-panel ── -->
		<div class="border-t border-border/60 pt-3 mt-1">
			<!-- Toggle button -->
			<button
				type="button"
				onclick={() => { showRolesPanel = !showRolesPanel; if (!showRolesPanel) { showAddRole = false; addRoleError = ''; } }}
				class="w-full flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
			>
				<!-- Gear icon -->
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0">
					<path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/>
				</svg>
				<span class="font-medium">{i18n.t.settings.sections.staffRoles}</span>
				<!-- Live role pills -->
				<span class="flex items-center gap-1 ml-1">
					{#each staffRoles.list as r (r.key)}
						<span class="rounded-full px-1.5 py-px text-[9px] font-semibold leading-tight {staffRoles.getBadgeClass(r.key)}">{r.label}</span>
					{/each}
				</span>
				<!-- Chevron -->
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
					class="h-3 w-3 ml-auto transition-transform duration-150 {showRolesPanel ? 'rotate-180' : ''}">
					<polyline points="6 9 12 15 18 9"/>
				</svg>
			</button>

			<!-- Expanded roles panel -->
			{#if showRolesPanel}
				<div transition:slide={{ duration: 150 }} class="flex flex-col gap-2 mt-3 pl-1">
					<!-- Role rows -->
					{#each localRoles as role (role.key)}
						<div class="flex items-center gap-2 py-1 px-2 rounded-md hover:bg-muted/40 group/rolerow">
							<span class="text-xs rounded-full px-2 py-0.5 font-medium shrink-0 {staffRoles.getBadgeClass(role.key)}">{role.label}</span>
							<code class="text-[10px] text-muted-foreground/60 font-mono">{role.key}</code>
							{#if role.prefix}
								<span class="text-[10px] text-muted-foreground/50 italic">"{role.prefix} …"</span>
							{/if}
							<span class="flex-1"></span>
							{#if localRoles.length > 1}
								<button
									type="button"
									onclick={() => handleDeleteRole(role.key)}
									class="opacity-0 group-hover/rolerow:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
									aria-label="Delete role"
								>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
										<path d="M18 6L6 18M6 6l12 12"/>
									</svg>
								</button>
							{/if}
						</div>
					{/each}

					<!-- Add role inline form -->
					{#if showAddRole}
						<div class="flex flex-col gap-2 rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 mt-1">
							{#if addRoleError}
								<p class="text-xs text-destructive">{addRoleError}</p>
							{/if}
							<div class="grid grid-cols-3 gap-2">
								<div class="flex flex-col gap-1">
									<label for="role-new-label" class="text-[10px] text-muted-foreground uppercase tracking-wide">{i18n.t.settings.staffRoles.roleLabel} *</label>
									<input id="role-new-label" type="text" bind:value={newRoleLabel} class="{inputClass} w-full" placeholder="e.g. Hygienist" />
								</div>
								<div class="flex flex-col gap-1">
									<label for="role-new-key" class="text-[10px] text-muted-foreground uppercase tracking-wide">Key *</label>
									<input id="role-new-key" type="text" value={newRoleKey} oninput={handleRoleKeyInput} class="{inputClass} w-full font-mono" placeholder="e.g. hygienist" />
								</div>
								<div class="flex flex-col gap-1">
									<label for="role-new-prefix" class="text-[10px] text-muted-foreground uppercase tracking-wide">{i18n.t.settings.staffRoles.prefix}</label>
									<input id="role-new-prefix" type="text" bind:value={newRolePrefix} class="{inputClass} w-full" placeholder="e.g. Dr." />
								</div>
							</div>
							<p class="text-[10px] text-muted-foreground/60">Prefix shown before name (e.g. "Dr. Smith"). Leave empty to show role in parentheses.</p>
							<div class="flex gap-2 justify-end">
								<button type="button" onclick={resetRoleForm} class="rounded-md border px-3 py-1.5 text-xs hover:bg-muted transition-colors">{i18n.t.actions.cancel}</button>
								<button type="button" onclick={handleAddRole} class="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:opacity-90 transition-opacity">{i18n.t.settings.staffRoles.add}</button>
							</div>
						</div>
					{/if}

					<!-- Roles footer controls -->
					<div class="flex items-center gap-2 pt-2">
						{#if !showAddRole}
							<button
								type="button"
								onclick={() => (showAddRole = true)}
								class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
									<path d="M12 5v14M5 12h14"/>
								</svg>
								{i18n.t.settings.staffRoles.add}
							</button>
						{/if}
						<span class="flex-1"></span>
						<button
							type="button"
							onclick={handleResetRoles}
							class="text-xs text-muted-foreground/60 hover:text-muted-foreground underline-offset-2 hover:underline transition-colors"
						>
							{i18n.t.settings.resetToDefaults}
						</button>
						<button
							type="button"
							onclick={handleSaveRoles}
							disabled={rolesSaving}
							class="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
						>
							{rolesSaved ? `${i18n.t.settings.saved} ✓` : rolesSaving ? i18n.t.common.loading : i18n.t.settings.sections.staffRoles}
						</button>
					</div>
				</div>
			{/if}
		</div>

		</div>
	</section>

	<!-- ── Vault ── -->
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.vault}</h2>
			<p class="text-sm text-muted-foreground">The folder where all patient data and files are stored.</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
			<div class="flex flex-col gap-1.5">
				<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{i18n.t.settings.vault.path}</span>
				<code class="rounded bg-muted px-3 py-2 text-xs break-all">
					{vault.path ?? '(not configured)'}
				</code>
			</div>

			{#if vaultChangeMsg}
				<p class="rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
					{vaultChangeMsg}
				</p>
			{/if}

			<button
				type="button"
				onclick={handleChangeVault}
				disabled={isChangingVault}
				class="self-start rounded-md border bg-muted px-4 py-2 text-sm font-medium hover:bg-muted/80 transition-colors disabled:opacity-50"
			>
				{isChangingVault ? i18n.t.common.loading : i18n.t.settings.vault.changePath}
			</button>
		</div>
	</section>

	<!-- ── Text Blocks ── -->
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.textBlocks}</h2>
			<p class="text-sm text-muted-foreground">
				{i18n.t.settings.textBlocks.description}
			</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-3">
			{#each draftBlocks as block, i}
				{@const isOpen = expandedBlockIdx === i}
				{@const hasDupeKey = block.key && duplicateBlockKeys.has(block.key)}
				<div class="rounded-md border bg-background overflow-hidden">
					<!-- Header row -->
					<div class="flex items-center gap-2 px-3 py-2">
						<button
							type="button"
							onclick={() => expandedBlockIdx = isOpen ? null : i}
							class="flex-1 flex items-center gap-2 text-left min-w-0"
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
								class="h-3 w-3 shrink-0 text-muted-foreground transition-transform {isOpen ? 'rotate-90' : ''}">
								<polyline points="9 18 15 12 9 6"/>
							</svg>
							{#if block.label}
								<span class="text-sm font-medium truncate">{block.label}</span>
								<span class="shrink-0 font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">/{block.key || '…'}</span>
							{:else}
								<span class="text-sm text-muted-foreground italic">{i18n.t.settings.textBlocks.add}</span>
							{/if}
						</button>
						<button
							type="button"
							onclick={() => removeBlock(i)}
							class="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
							title={i18n.t.actions.delete}
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
								<path d="M18 6L6 18M6 6l12 12"/>
							</svg>
						</button>
					</div>

					<!-- Expanded edit form -->
					{#if isOpen}
						<div transition:slide={{ duration: 120 }} class="border-t border-border/50 px-3 py-3 flex flex-col gap-3 bg-muted/20">
							<div class="grid grid-cols-2 gap-3">
								<!-- Label -->
								<div class="flex flex-col gap-1">
									<label class="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{i18n.t.settings.docCategories.labelField}</label>
									<input
										type="text"
										value={block.label}
										oninput={(e) => updateBlock(i, 'label', (e.target as HTMLInputElement).value)}
										placeholder="z.B. Composite-Füllung"
										class="h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
									/>
								</div>
								<!-- Key / trigger -->
								<div class="flex flex-col gap-1">
									<label class="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{i18n.t.settings.textBlocks.triggerLabel}</label>
									<div class="flex items-center gap-1">
										<span class="text-sm text-muted-foreground font-mono">/</span>
										<input
											type="text"
											value={block.key}
											oninput={(e) => updateBlock(i, 'key', slugifyBlockKey((e.target as HTMLInputElement).value))}
											placeholder="fuellung"
											class="h-8 flex-1 rounded-md border font-mono text-sm px-2.5 outline-none focus:border-ring focus:ring-1 focus:ring-ring/30 {hasDupeKey ? 'border-destructive bg-destructive/5' : 'border-input bg-background'}"
										/>
									</div>
									{#if hasDupeKey}<p class="text-[10px] text-destructive">{i18n.t.chart.editTagsDialog.duplicateShortcut}</p>{/if}
								</div>
							</div>
							<!-- Body -->
							<div class="flex flex-col gap-1">
								<label class="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
									Text <span class="normal-case font-normal">(__ = Platzhalter)</span>
								</label>
								<textarea
									value={block.body}
									oninput={(e) => updateBlock(i, 'body', (e.target as HTMLTextAreaElement).value)}
									rows={5}
									placeholder="Templatetext… __ für Platzhalter"
									class="w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 font-mono text-xs outline-none focus:border-ring focus:ring-1 focus:ring-ring/30"
								></textarea>
							</div>
						</div>
					{/if}
				</div>
			{/each}

			<!-- Add block button -->
			<button
				type="button"
				onclick={addBlock}
				class="flex items-center gap-1.5 rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors w-full"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
					<path d="M12 5v14M5 12h14"/>
				</svg>
				{i18n.t.settings.textBlocks.add}
			</button>

			<!-- Actions -->
			<div class="flex items-center gap-3 pt-1">
				<Button size="sm" onclick={handleSaveBlocks} disabled={isBlocksSaving || duplicateBlockKeys.size > 0}>
					{isBlocksSaving ? i18n.t.common.loading : i18n.t.actions.save}
				</Button>
				{#if blocksSaved}
					<span class="text-sm text-emerald-600 dark:text-emerald-400 font-medium">✓ {i18n.t.settings.saved}</span>
				{/if}
				{#if duplicateBlockKeys.size > 0}
					<span class="text-xs text-destructive">{i18n.t.chart.editTagsDialog.duplicateShortcut}: {[...duplicateBlockKeys].join(', ')}</span>
				{/if}
				<button
					type="button"
					class="ml-auto text-xs text-muted-foreground hover:text-foreground transition-colors"
					onclick={resetBlocks}
				>
					{i18n.t.settings.resetToDefaults}
				</button>
			</div>
		</div>
	</section>

	<!-- ── Clinical Tags ── -->
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.clinicalTags}</h2>
			<p class="text-sm text-muted-foreground">
				Configure the tag chips available in Acute Problems and Medical History notes.
				These tags are used for statistical filtering across patients.
			</p>
		</div>
		<Separator />

		<!-- Acute Problems tags -->
		<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
			<div class="flex items-center justify-between gap-2">
				<div>
					<p class="text-sm font-medium text-red-700 dark:text-red-400">{i18n.t.settings.clinicalTags.acuteTitle}</p>
					<p class="text-xs text-muted-foreground mt-0.5">{i18n.t.settings.clinicalTags.acuteDesc}</p>
				</div>
				<div class="flex items-center gap-2">
					{#if acuteTagsSaved}
						<span class="text-xs text-emerald-500">{i18n.t.settings.saved} ✓</span>
					{/if}
					<button
						type="button"
						class="text-xs text-muted-foreground hover:text-foreground transition-colors"
						onclick={() => { draftAcuteTags = i18n.t.defaults.acuteTags.map(t => ({ key: t.key })); }}
					>
						{i18n.t.settings.resetToDefaults}
					</button>
					<Button size="sm" onclick={saveAcuteTags} disabled={acuteTagsSaving}>
						{acuteTagsSaving ? i18n.t.common.loading : i18n.t.actions.save}
					</Button>
				</div>
			</div>

			<!-- Existing tags -->
			<div class="flex flex-wrap gap-2">
				{#each draftAcuteTags as tag, i}
					<span class="flex items-center gap-1 rounded-full border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 px-2.5 py-0.5 text-[11px] font-medium text-red-700 dark:text-red-400">
						{acuteTagOptions.displayLabel(tag)}
						<button
							type="button"
							onclick={() => { draftAcuteTags = draftAcuteTags.filter((_, idx) => idx !== i); }}
							class="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
							aria-label="Remove tag"
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-2.5 w-2.5">
								<path d="M18 6L6 18M6 6l12 12"/>
							</svg>
						</button>
					</span>
				{/each}
			</div>

			<!-- Add new tag -->
			<div class="flex items-center gap-2">
				<input
					type="text"
					bind:value={newAcuteTag}
					placeholder={i18n.t.settings.clinicalTags.addTag}
					class={inputClass + ' flex-1'}
					onkeydown={(e) => { if (e.key === 'Enter') addAcuteTag(); }}
				/>
				<Button size="sm" variant="outline" onclick={addAcuteTag} disabled={!newAcuteTag.trim()}>
					{i18n.t.actions.add}
				</Button>
			</div>
		</div>

		<!-- Medical History tags -->
		<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
			<div class="flex items-center justify-between gap-2">
				<div>
					<p class="text-sm font-medium text-amber-700 dark:text-amber-400">{i18n.t.settings.clinicalTags.medicalTitle}</p>
					<p class="text-xs text-muted-foreground mt-0.5">{i18n.t.settings.clinicalTags.medicalDesc}</p>
				</div>
				<div class="flex items-center gap-2">
					{#if medicalTagsSaved}
						<span class="text-xs text-emerald-500">{i18n.t.settings.saved} ✓</span>
					{/if}
					<button
						type="button"
						class="text-xs text-muted-foreground hover:text-foreground transition-colors"
						onclick={() => { draftMedicalTags = i18n.t.defaults.medicalTags.map(t => ({ key: t.key })); }}
					>
						{i18n.t.settings.resetToDefaults}
					</button>
					<Button size="sm" onclick={saveMedicalTags} disabled={medicalTagsSaving}>
						{medicalTagsSaving ? i18n.t.common.loading : i18n.t.actions.save}
					</Button>
				</div>
			</div>

			<!-- Existing tags -->
			<div class="flex flex-wrap gap-2">
				{#each draftMedicalTags as tag, i}
					<span class="flex items-center gap-1 rounded-full border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
						{medicalTagOptions.displayLabel(tag)}
						<button
							type="button"
							onclick={() => { draftMedicalTags = draftMedicalTags.filter((_, idx) => idx !== i); }}
							class="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
							aria-label="Remove tag"
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-2.5 w-2.5">
								<path d="M18 6L6 18M6 6l12 12"/>
							</svg>
						</button>
					</span>
				{/each}
			</div>

			<!-- Add new tag -->
			<div class="flex items-center gap-2">
				<input
					type="text"
					bind:value={newMedicalTag}
					placeholder={i18n.t.settings.clinicalTags.addTag}
					class={inputClass + ' flex-1'}
					onkeydown={(e) => { if (e.key === 'Enter') addMedicalTag(); }}
				/>
				<Button size="sm" variant="outline" onclick={addMedicalTag} disabled={!newMedicalTag.trim()}>
					{i18n.t.actions.add}
				</Button>
			</div>
		</div>
	</section>

	<!-- ── Complication Types ── -->
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.complicationTypes}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.settings.complicationTypes.description}</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
			<!-- Header row -->
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{i18n.t.settings.sections.complicationTypes}</span>
				<div class="flex items-center gap-2">
					{#if complicationTypesSaved}
						<span class="text-xs text-emerald-600">{i18n.t.settings.saved}!</span>
					{/if}
					<button
						type="button"
						onclick={() => { draftComplicationTypes = DEFAULT_COMPLICATION_TYPES.map(k => ({ key: k })); }}
						class="text-xs text-muted-foreground hover:text-foreground transition-colors"
					>{i18n.t.settings.resetToDefaults}</button>
					<Button size="sm" onclick={saveComplicationTypes} disabled={complicationTypesSaving}>
						{complicationTypesSaving ? i18n.t.common.loading : i18n.t.actions.save}
					</Button>
				</div>
			</div>

			<!-- Existing types -->
			<div class="flex flex-wrap gap-2">
				{#each draftComplicationTypes as ct, i}
					<span class="flex items-center gap-1 rounded-full border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/20 px-2.5 py-0.5 text-[11px] font-medium text-orange-700 dark:text-orange-400">
						{complicationTypes.displayLabel(ct)}
						<button
							type="button"
							onclick={() => { draftComplicationTypes = draftComplicationTypes.filter((_, idx) => idx !== i); }}
							class="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
							aria-label="Remove"
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" class="h-2.5 w-2.5">
								<path d="M18 6L6 18M6 6l12 12"/>
							</svg>
						</button>
					</span>
				{/each}
			</div>

			<!-- Add new type -->
			<div class="flex items-center gap-2">
				<input
					type="text"
					bind:value={newComplicationTypeLabel}
					placeholder={i18n.t.settings.complicationTypes.add}
					class="h-8 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-ring"
					onkeydown={(e) => { if (e.key === 'Enter') addComplicationTypeItem(); }}
				/>
				<Button size="sm" variant="outline" onclick={addComplicationTypeItem} disabled={!newComplicationTypeLabel.trim()}>
					{i18n.t.actions.add}
				</Button>
			</div>
		</div>
	</section>

	<!-- ── Backup & Export ── -->
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.backup}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.settings.backup.description}</p>
		</div>
		<Separator />

		<!-- Hidden file input for import -->
		<input bind:this={importFileEl} type="file" accept=".json" class="hidden" onchange={handleImportFile} />

		<!-- Import confirmation dialog -->
		{#if showImportConfirm}
			<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
				<div class="w-full max-w-sm rounded-xl border border-border bg-popover p-6 shadow-xl flex flex-col gap-4">
					<p class="text-sm font-semibold">{i18n.t.settings.backup.importSettings}</p>
					<p class="text-sm text-muted-foreground">{i18n.t.settings.backup.importWarning}</p>
					<div class="flex items-center gap-3 justify-end">
						<Button variant="outline" size="sm" onclick={() => { showImportConfirm = false; pendingImportEntries = []; }}>
							{i18n.t.actions.cancel}
						</Button>
						<Button size="sm" onclick={confirmImport}>
							{i18n.t.settings.backup.importConfirm}
						</Button>
					</div>
				</div>
			</div>
		{/if}

		<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">

			<!-- Export Settings -->
			<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
				<div class="flex items-start gap-3">
					<div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-blue-50 dark:bg-blue-950/40">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-blue-600 dark:text-blue-400">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
						</svg>
					</div>
					<div class="min-w-0">
						<p class="text-sm font-medium">{i18n.t.settings.backup.exportSettings}</p>
						<p class="text-xs text-muted-foreground mt-0.5 leading-relaxed">{i18n.t.settings.backup.exportSettingsDesc}</p>
					</div>
				</div>
				<Button size="sm" variant="outline" onclick={handleExportSettings}>
					{i18n.t.settings.backup.exportSettings}
				</Button>
				{#if importMsg && !importError}
					<p class="text-xs text-emerald-600 dark:text-emerald-400">{importMsg}</p>
				{/if}
			</div>

			<!-- Import Settings -->
			<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
				<div class="flex items-start gap-3">
					<div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-amber-50 dark:bg-amber-950/40">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-amber-600 dark:text-amber-400">
							<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
						</svg>
					</div>
					<div class="min-w-0">
						<p class="text-sm font-medium">{i18n.t.settings.backup.importSettings}</p>
						<p class="text-xs text-muted-foreground mt-0.5 leading-relaxed">{i18n.t.settings.backup.importSettingsDesc}</p>
					</div>
				</div>
				<Button size="sm" variant="outline" onclick={() => importFileEl?.click()}>
					{i18n.t.settings.backup.importSettings}
				</Button>
				{#if importMsg && importError}
					<p class="text-xs text-destructive">{importMsg}</p>
				{/if}
			</div>

			<!-- Backup Database -->
			<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
				<div class="flex items-start gap-3">
					<div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-emerald-50 dark:bg-emerald-950/40">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-emerald-600 dark:text-emerald-400">
							<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
						</svg>
					</div>
					<div class="min-w-0">
						<p class="text-sm font-medium">{i18n.t.settings.backup.backupDatabase}</p>
						<p class="text-xs text-muted-foreground mt-0.5 leading-relaxed">{i18n.t.settings.backup.backupDatabaseDesc}</p>
					</div>
				</div>
				<Button size="sm" variant="outline" onclick={handleBackupDatabase} disabled={isBackingUpDb}>
					{isBackingUpDb ? i18n.t.common.loading : i18n.t.settings.backup.backupDatabase}
				</Button>
				{#if dbBackupMsg}
					<p class="text-xs {dbBackupError ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'} break-all">{dbBackupMsg}</p>
				{/if}
			</div>

			<!-- Backup Vault -->
			<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
				<div class="flex items-start gap-3">
					<div class="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-purple-50 dark:bg-purple-950/40">
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 text-purple-600 dark:text-purple-400">
							<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
						</svg>
					</div>
					<div class="min-w-0">
						<p class="text-sm font-medium">{i18n.t.settings.backup.backupVault}</p>
						<p class="text-xs text-muted-foreground mt-0.5 leading-relaxed">{i18n.t.settings.backup.backupVaultDesc}</p>
					</div>
				</div>
				<Button size="sm" variant="outline" onclick={handleBackupVault} disabled={isBackingUpVault}>
					{isBackingUpVault ? i18n.t.common.loading : i18n.t.settings.backup.backupVault}
				</Button>
				{#if vaultBackupMsg}
					<p class="text-xs {vaultBackupError ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'} break-all">{vaultBackupMsg}</p>
				{/if}
			</div>

		</div>
	</section>

	<!-- ── About ── -->
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.about}</h2>
			<p class="text-sm text-muted-foreground">Application information.</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-3">
			<div class="flex items-center gap-3">
				<div class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 text-primary">
						<path d="M12 2C8 2 6 5 6 8c0 2 .5 3.5 1 5 .5 1.5 1 3.5 1 6 0 1.5 1 3 2 3s2-1.5 2-3v-2c0-1 1-1 1-1s1 0 1 1v2c0 1.5 1 3 2 3s2-1.5 2-3c0-2.5.5-4.5 1-6s1-3 1-5c0-3-2-6-6-6z"/>
					</svg>
				</div>
				<div>
					<p class="text-sm font-medium">DentVault</p>
					<p class="text-xs text-muted-foreground">{i18n.t.settings.about.version} 0.0.1 · Tauri 2 + SvelteKit + SQLite</p>
				</div>
			</div>
			<Separator />
			<p class="text-xs text-muted-foreground leading-relaxed">
				{i18n.t.settings.about.description}
			</p>
		</div>
	</section>

</div>
