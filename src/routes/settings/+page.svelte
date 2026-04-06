<script lang="ts">
	import { slide } from 'svelte/transition';
	import { tick } from 'svelte';
	import { untrack } from 'svelte';
	import { Separator } from '$lib/components/ui/separator';
	import { Button } from '$lib/components/ui/button';
	import { theme } from '$lib/stores/theme.svelte';
	import { vault } from '$lib/stores/vault.svelte';
	import { docCategories, DEFAULT_CATEGORIES, type DocCategory } from '$lib/stores/categories.svelte';
	import { doctors } from '$lib/stores/doctors.svelte';
	import { resetDb, getAllSettings, bulkSetSettings, getAllPatientsIncludingArchived, deletePatient, getSetting, setSetting } from '$lib/services/db';
	import { patientBus } from '$lib/stores/patientBus.svelte';
	import { pickDirectory, ensureTemplateStructure, ensureDocTemplatesFolder, getTemplateCategories, listVaultFiles, listDocTemplates, openDocumentFile, deletePatientFolder, TEMPLATE_FOLDER, type VaultFileInfo, type DocTemplateInfo } from '$lib/services/files';
	import { exportPatient } from '$lib/services/patient-export';
	import { downloadJson } from '$lib/services/export';
	import { invoke } from '@tauri-apps/api/core';
	import { staffLabel, roleLabel, roleBadge } from '$lib/utils/staff';
	import { formatDate } from '$lib/utils';
	import { staffRoles, DEFAULT_ROLES, type StaffRole } from '$lib/stores/staffRoles.svelte';
	import { dentalTags, DEFAULT_DENTAL_TAGS, RENDER_CRITICAL_TAGS } from '$lib/stores/dentalTags.svelte';
	import { uiScale } from '$lib/stores/uiScale.svelte';
	import { prosthesisTypes, type ProsthesisTypeConfig } from '$lib/stores/prosthesisTypes.svelte';
	import { bridgeRoles, type BridgeRoleConfig } from '$lib/stores/bridgeRoles.svelte';
	import { postTypes, DEFAULT_POST_TYPES, type PostTypeConfig } from '$lib/stores/postTypes.svelte';
	import { fillingMaterials, DEFAULT_FILLING_MATERIALS, type FillingMaterialConfig } from '$lib/stores/fillingMaterials.svelte';
	import { endoInstruments, DEFAULT_ENDO_INSTRUMENTS, type EndoInstrumentConfig } from '$lib/stores/endoInstruments.svelte';
	import { textBlocks, DEFAULT_TEXT_BLOCKS, type TextBlock } from '$lib/stores/textBlocks.svelte';
	import { acuteTagOptions, medicalTagOptions, DEFAULT_ACUTE_TAGS, DEFAULT_MEDICAL_TAGS, type ClinicalTag } from '$lib/stores/clinicalTags.svelte';
	import { complicationTypes, DEFAULT_COMPLICATION_TYPES, type ComplicationType } from '$lib/stores/complicationTypes.svelte';
	import { rooms } from '$lib/stores/rooms.svelte';
	import { appointmentTypes } from '$lib/stores/appointmentTypes.svelte';
	import { workingHours } from '$lib/stores/workingHours.svelte';
	import StaffWorkingHoursGrid from '$lib/components/schedule/StaffWorkingHoursGrid.svelte';
	import type { DentalTag, PatternType, AppointmentRoom, AppointmentType, WorkingHoursEntry, Patient } from '$lib/types';
	import { i18n, type LangCode } from '$lib/i18n';
	import { activePatient } from '$lib/stores/activePatient.svelte';

	// ── Active section (sidebar nav) ───────────────────────────────────────
	let activeSection = $state('home');
	let contentEl = $state<HTMLDivElement | null>(null);
	const scrollPositions: Record<string, number> = {};

	function navigateTo(key: string) {
		if (contentEl) scrollPositions[activeSection] = contentEl.scrollTop;
		activeSection = key;
		tick().then(() => {
			if (contentEl) contentEl.scrollTop = scrollPositions[key] ?? 0;
		});
	}

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
			// Ensure !TEMPLATE exists in the new vault (no-op if already present)
			await ensureTemplateStructure(
				path,
				docCategories.list.map(c => vault.categoryFolder(c.key)),
			).catch(() => {/* non-fatal */});
			await ensureDocTemplatesFolder(path).catch(() => {/* non-fatal */});
			window.location.reload();
		} catch (e) {
			vaultChangeMsg = 'Error: ' + String(e);
			isChangingVault = false;
		}
	}

	// ── Document Categories ────────────────────────────────────────────────

	// Work with a local copy; only write to the store when user clicks Save
	let localCategories = $state<DocCategory[]>([...docCategories.list]);

	// Template file metadata (for file-count badges in the UI)
	let templateFiles = $state<VaultFileInfo[]>([]);
	let docTemplateFiles = $state<DocTemplateInfo[]>([]);

	// Keep in sync if the store changes externally (e.g. first load).
	// Also merge any subfolders found on disk in !TEMPLATE that aren't stored yet.
	$effect(() => {
		if (docCategories.loaded) {
			localCategories = [...docCategories.list];
			// Async: load template info without blocking the reactive update
			if (vault.isConfigured && vault.path) {
				Promise.all([
					getTemplateCategories(vault.path),
					listVaultFiles(vault.path, TEMPLATE_FOLDER),
					listDocTemplates(vault.path),
				]).then(([templateFolders, files, docFiles]) => {
					templateFiles = files;
					docTemplateFiles = docFiles;
					// Merge template folders that aren't already known categories
					let changed = false;
					for (const folder of templateFolders) {
						const alreadyKnown = localCategories.some(
							c => vault.categoryFolder(c.key) === folder,
						);
						if (!alreadyKnown) {
							localCategories = [...localCategories, { key: folder, label: folder, icon: '📁' }];
							changed = true;
						}
					}
					// If new categories were found on disk, auto-save them
					if (changed) {
						docCategories.save(localCategories);
					}
				}).catch(() => {/* non-fatal */});
			}
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
			// Keep !TEMPLATE folder structure in sync with categories
			if (vault.isConfigured && vault.path) {
				await ensureTemplateStructure(
					vault.path,
					localCategories.map(c => vault.categoryFolder(c.key)),
				);
				await ensureDocTemplatesFolder(vault.path).catch(() => {/* non-fatal */});
				// Refresh template file counts
				templateFiles = await listVaultFiles(vault.path, TEMPLATE_FOLDER);
				docTemplateFiles = await listDocTemplates(vault.path).catch(() => []);
			}
			categoriesSaved = true;
			setTimeout(() => (categoriesSaved = false), 2500);
		} finally {
			isSavingCategories = false;
		}
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

	// Working hours editor state
	let editWorkingHoursDocId = $state<number | null>(null);

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

	// ── Dental Chart Tags ──────────────────────────────────────────────────

	const PATTERNS: { key: PatternType; label: string }[] = [
		{ key: 'solid',      label: 'Solid' },
		{ key: 'diagonal',   label: 'Diagonal' },
		{ key: 'crosshatch', label: 'Crosshatch' },
		{ key: 'horizontal', label: 'Horizontal' },
		{ key: 'vertical',   label: 'Vertical' },
		{ key: 'dots',       label: 'Dots' },
	];

	// ── Dental tag groups ──────────────────────────────────────────────────────────────
	const TAG_GROUPS = $derived([
		{ key: 'general',          label: i18n.t.chart.tagGroups.general,          keys: ['healthy', 'watch', 'impacted', 'fractured'] },
		{ key: 'restorative',      label: i18n.t.chart.tagGroups.restorative,      keys: ['decayed', 'filled'] },
		{ key: 'endodontic',       label: i18n.t.chart.tagGroups.endodontic,       keys: ['root_canal'] },
		{ key: 'fixedProsthetics', label: i18n.t.chart.tagGroups.fixedProsthetics, keys: ['crowned', 'implant', 'bridge'] },
		{ key: 'removable',        label: i18n.t.chart.tagGroups.removable,        keys: ['prosthesis'] },
		{ key: 'absent',           label: i18n.t.chart.tagGroups.absent,           keys: ['missing', 'extracted'] },
	]);

	let draftTags      = $state<DentalTag[]>([]);
	let isTagsSaving   = $state(false);
	let tagsSaved      = $state(false);
	let openPatternIdx = $state<number | null>(null);

	/** Populate label from i18n for built-in tags so the input has a visible value. */
	function hydrateLabel(t: DentalTag): DentalTag {
		if (!t.label) {
			const trans = i18n.t.chart.tags[t.key as keyof typeof i18n.t.chart.tags];
			if (trans) return { ...t, label: trans.label };
		}
		return { ...t };
	}

	$effect(() => {
		if (!dentalTags.loaded) {
			dentalTags.load();
			return;
		}
		draftTags = untrack(() => dentalTags.list.map(hydrateLabel));
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

	function toggleWholeTooth(i: number) {
		draftTags = draftTags.map((t, idx) => idx === i ? { ...t, wholeTooth: !t.wholeTooth } : t);
	}

	function addTag() {
		const key = `custom_${Date.now()}`;
		draftTags = [...draftTags, { key, label: 'New Tag', color: '#e0f2fe', strokeColor: '#0284c7', pattern: 'solid' }];
	}

	function removeTag(i: number) {
		draftTags      = draftTags.filter((_, idx) => idx !== i);
		openPatternIdx = null;
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

	// ── Prosthesis Type Appearance ─────────────────────────────────────────────────────
	let draftPtConfigs    = $state<ProsthesisTypeConfig[]>([]);
	let isPtSaving        = $state(false);
	let ptSaved           = $state(false);
	let openPtPatternIdx  = $state<number | null>(null);

	$effect(() => {
		if (!prosthesisTypes.loaded) {
			prosthesisTypes.load();
			return;
		}
		draftPtConfigs = untrack(() => prosthesisTypes.configs.map(c => ({ ...c })));
	});

	function updatePtConfig<K extends keyof ProsthesisTypeConfig>(i: number, field: K, value: ProsthesisTypeConfig[K]) {
		draftPtConfigs[i] = { ...draftPtConfigs[i], [field]: value };
	}

	function selectPtPattern(i: number, pattern: PatternType) {
		draftPtConfigs[i] = { ...draftPtConfigs[i], fillPattern: pattern };
		openPtPatternIdx = null;
	}

	async function handleSavePtConfigs() {
		isPtSaving = true;
		try {
			await prosthesisTypes.save(draftPtConfigs);
			ptSaved = true;
			setTimeout(() => (ptSaved = false), 2500);
		} finally {
			isPtSaving = false;
		}
	}

	// ── Bridge Role Appearance ─────────────────────────────────────────────────────────
	let draftBrConfigs    = $state<BridgeRoleConfig[]>([]);
	let isBrSaving        = $state(false);
	let brSaved           = $state(false);
	let openBrPatternIdx  = $state<number | null>(null);

	$effect(() => {
		if (!bridgeRoles.loaded) {
			bridgeRoles.load();
			return;
		}
		draftBrConfigs = untrack(() => bridgeRoles.configs.map(c => ({ ...c })));
	});

	function updateBrConfig<K extends keyof BridgeRoleConfig>(i: number, field: K, value: BridgeRoleConfig[K]) {
		draftBrConfigs[i] = { ...draftBrConfigs[i], [field]: value };
	}

	function selectBrPattern(i: number, pattern: PatternType) {
		draftBrConfigs[i] = { ...draftBrConfigs[i], fillPattern: pattern };
		openBrPatternIdx = null;
	}

	async function handleSaveBrConfigs() {
		isBrSaving = true;
		try {
			await bridgeRoles.save(draftBrConfigs);
			brSaved = true;
			setTimeout(() => (brSaved = false), 2500);
		} finally {
			isBrSaving = false;
		}
	}

	// ── Post Types (Root Canal) ────────────────────────────────────────────────────────
	let draftPostTypes   = $state<PostTypeConfig[]>([]);
	let isPostSaving     = $state(false);
	let postSaved        = $state(false);

	$effect(() => {
		if (!postTypes.loaded) {
			postTypes.load();
			return;
		}
		draftPostTypes = untrack(() => postTypes.list.map(p => ({ ...p })));
	});

	function addPostType() {
		draftPostTypes = [...draftPostTypes, { key: `custom_${Date.now()}`, label: '' }];
	}
	function removePostType(i: number) {
		draftPostTypes = draftPostTypes.filter((_, idx) => idx !== i);
	}
	async function handleSavePostTypes() {
		isPostSaving = true;
		try {
			await postTypes.save(draftPostTypes.filter(p => p.label.trim()));
			postSaved = true;
			setTimeout(() => (postSaved = false), 2500);
		} finally {
			isPostSaving = false;
		}
	}

	// ── Filling Materials ──────────────────────────────────────────────────────────────
	let draftFillingMaterials = $state<FillingMaterialConfig[]>([]);
	let isFillingMatSaving    = $state(false);
	let fillingMatSaved       = $state(false);

	$effect(() => {
		if (!fillingMaterials.loaded) fillingMaterials.load();
		draftFillingMaterials = fillingMaterials.list.map(m => ({ ...m }));
	});

	function addFillingMaterial() {
		draftFillingMaterials.push({ key: crypto.randomUUID(), label: '', color: '#bfdbfe' });
	}
	function removeFillingMaterial(i: number) {
		draftFillingMaterials.splice(i, 1);
	}
	async function handleSaveFillingMaterials() {
		isFillingMatSaving = true;
		await fillingMaterials.save(draftFillingMaterials.filter(m => m.label.trim()));
		isFillingMatSaving = false;
		fillingMatSaved = true;
		setTimeout(() => fillingMatSaved = false, 2000);
	}

	// ── Endo Instruments ───────────────────────────────────────────────────────────────
	let draftEndoInstruments = $state<EndoInstrumentConfig[]>([]);
	let isEndoInstrSaving    = $state(false);
	let endoInstrSaved       = $state(false);

	$effect(() => {
		if (!endoInstruments.loaded) {
			endoInstruments.load();
			return;
		}
		draftEndoInstruments = untrack(() => endoInstruments.list.map(p => ({ ...p })));
	});

	function addEndoInstrument() {
		draftEndoInstruments = [...draftEndoInstruments, { key: `custom_${Date.now()}`, label: '' }];
	}
	function removeEndoInstrument(i: number) {
		draftEndoInstruments = draftEndoInstruments.filter((_, idx) => idx !== i);
	}
	async function handleSaveEndoInstruments() {
		isEndoInstrSaving = true;
		try {
			await endoInstruments.save(draftEndoInstruments.filter(t => t.label.trim()));
			endoInstrSaved = true;
			setTimeout(() => (endoInstrSaved = false), 2500);
		} finally {
			isEndoInstrSaving = false;
		}
	}

	// ── DMFT display toggle ────────────────────────────────────────────────────────────
	let dmftForAdults = $state(true);

	$effect(() => {
		getSetting('dmft_for_adults').then(v => { dmftForAdults = v !== 'false'; });
	});

	async function handleDmftToggle(val: boolean) {
		dmftForAdults = val;
		await setSetting('dmft_for_adults', val ? 'true' : 'false');
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

	// ── Rooms ──────────────────────────────────────────────────────────────────
	let roomsSaving = $state(false);
	let roomsSaved  = $state(false);
	let showAddRoom  = $state(false);
	let newRoomName  = $state('');
	let newRoomShort = $state('');
	let newRoomColor = $state('#6366f1');
	let editingRoomId = $state<string | null>(null);
	let editRoomName  = $state('');
	let editRoomShort = $state('');
	let editRoomColor = $state('#6366f1');

	async function handleAddRoom() {
		const name = newRoomName.trim();
		if (!name) return;
		roomsSaving = true;
		try {
			await rooms.add({ name, short_name: newRoomShort.trim(), color: newRoomColor, sort_order: rooms.list.length, is_active: true });
			newRoomName = ''; newRoomShort = ''; newRoomColor = '#6366f1'; showAddRoom = false;
			roomsSaved = true; setTimeout(() => (roomsSaved = false), 2000);
		} finally { roomsSaving = false; }
	}

	function startEditRoom(r: AppointmentRoom) {
		editingRoomId = r.id; editRoomName = r.name; editRoomShort = r.short_name; editRoomColor = r.color;
	}

	async function saveEditRoom(id: string) {
		const name = editRoomName.trim();
		if (!name) return;
		roomsSaving = true;
		try {
			await rooms.update(id, { name, short_name: editRoomShort.trim(), color: editRoomColor });
			editingRoomId = null;
		} finally { roomsSaving = false; }
	}

	async function handleToggleRoom(room: AppointmentRoom) {
		await rooms.update(room.id, { is_active: room.is_active === 0 });
	}

	async function handleDeleteRoom(id: string) {
		await rooms.remove(id);
	}

	// ── Appointment Types ───────────────────────────────────────────────────────
	let apptTypesSaving = $state(false);
	let apptTypesSaved  = $state(false);
	let showAddApptType  = $state(false);
	let newApptTypeName  = $state('');
	let newApptTypeShort = $state('');
	let newApptTypeDuration = $state(30);
	let newApptTypeColor = $state('#6366f1');
	let newApptTypeCategory = $state('other');
	let editingApptTypeId = $state<string | null>(null);
	let editApptTypeName  = $state('');
	let editApptTypeShort = $state('');
	let editApptTypeDuration = $state(30);
	let editApptTypeColor = $state('#6366f1');
	let editApptTypeCategory = $state('other');

	async function handleAddApptType() {
		const name = newApptTypeName.trim();
		if (!name) return;
		apptTypesSaving = true;
		try {
			await appointmentTypes.add({ name, short_name: newApptTypeShort.trim(), default_duration_min: newApptTypeDuration, color: newApptTypeColor, treatment_category: newApptTypeCategory, sort_order: appointmentTypes.list.length, is_active: true });
			newApptTypeName = ''; newApptTypeShort = ''; newApptTypeDuration = 30; newApptTypeColor = '#6366f1'; newApptTypeCategory = 'other'; showAddApptType = false;
			apptTypesSaved = true; setTimeout(() => (apptTypesSaved = false), 2000);
		} finally { apptTypesSaving = false; }
	}

	function startEditApptType(t: AppointmentType) {
		editingApptTypeId = t.id; editApptTypeName = t.name; editApptTypeShort = t.short_name;
		editApptTypeDuration = t.default_duration_min; editApptTypeColor = t.color; editApptTypeCategory = t.treatment_category;
	}

	async function saveEditApptType(id: string) {
		const name = editApptTypeName.trim();
		if (!name) return;
		apptTypesSaving = true;
		try {
			await appointmentTypes.update(id, { name, short_name: editApptTypeShort.trim(), default_duration_min: editApptTypeDuration, color: editApptTypeColor, treatment_category: editApptTypeCategory });
			editingApptTypeId = null;
		} finally { apptTypesSaving = false; }
	}

	async function handleDeleteApptType(id: string) {
		await appointmentTypes.remove(id);
	}

	// ── Working Hours ───────────────────────────────────────────────────────────
	let localWorkingHours = $state<WorkingHoursEntry[]>([...workingHours.hours]);
	let workingHoursSaving = $state(false);
	let workingHoursSaved  = $state(false);

	$effect(() => {
		localWorkingHours = [...workingHours.hours];
	});

	async function handleSaveWorkingHours() {
		workingHoursSaving = true;
		try {
			await workingHours.save(localWorkingHours);
			workingHoursSaved = true; setTimeout(() => (workingHoursSaved = false), 2000);
		} finally { workingHoursSaving = false; }
	}

	// ── Backup & Export ─────────────────────────────────────────────────────
	let importFileEl          = $state<HTMLInputElement | null>(null);
	let isBackingUpDb         = $state(false);
	let isBackingUpVault      = $state(false);
	let dbBackupMsg           = $state('');
	let dbBackupError         = $state(false);
	let vaultBackupMsg        = $state('');
	let vaultBackupError      = $state(false);
	// ── Patient Export (Settings) ──────────────────────────────────────────
	let exportSearchQuery     = $state('');
	let exportSearchResults   = $state<Patient[]>([]);
	let exportDropdownOpen    = $state(false);
	let exportSelectedPatient = $state<Patient | null>(null);
	let exportDateFrom        = $state('');
	let exportDateTo          = $state('');
	let exportIsRunning       = $state(false);
	let exportProgress        = $state(0);
	let exportProgressText    = $state('');
	let exportPath            = $state('');
	let exportError           = $state('');

	async function handleExportSearch(query: string) {
		exportSearchQuery = query;
		exportDropdownOpen = true;
		if (!query.trim()) { exportSearchResults = []; return; }
		const { searchPatients } = await import('$lib/services/db');
		exportSearchResults = await searchPatients(query, true);
	}

	async function handleSettingsExport() {
		if (!exportSelectedPatient) return;
		const destDir = await pickDirectory();
		if (!destDir) return;

		exportIsRunning = true;
		exportProgress = 0;
		exportProgressText = '';
		exportPath = '';
		exportError = '';

		try {
			const tags = dentalTags.list.map(t => ({ key: t.key, color: t.color, strokeColor: t.strokeColor, pattern: t.pattern }));
			const bridgeCfgs = bridgeRoles.configs.map(c => ({ key: c.key, color: c.color, fillColor: c.fillColor, fillPattern: c.fillPattern, badge: c.badge ?? '' }));
			const prosthesisCfgs = prosthesisTypes.configs.map(c => ({ key: c.key, color: c.color, fillColor: c.fillColor, fillPattern: c.fillPattern, badge: c.badge ?? '' }));

			exportPath = await exportPatient(
				exportSelectedPatient.patient_id,
				destDir,
				{ dateFrom: exportDateFrom || undefined, dateTo: exportDateTo || undefined },
				tags,
				bridgeCfgs,
				prosthesisCfgs,
				fillingMaterials.list.map(m => ({ key: m.key, label: m.label, color: m.color })),
				i18n.code,
				(pct, text) => { exportProgress = pct; exportProgressText = text; },
			);
		} catch (e) {
			exportError = String(e);
		} finally {
			exportIsRunning = false;
		}
	}

	// ── Patient Management ─────────────────────────────────────────────────
	let allPatients           = $state<Patient[]>([]);
	let selectedPatientIds    = $state<Set<string>>(new Set());
	let patientMgmtLoaded     = $state(false);
	let isDeletingPatients    = $state(false);
	let showDeletePatientsConfirm = $state(false);
	let deletePatientsMsg     = $state('');
	let patientSearch         = $state('');

	const filteredPatients = $derived(() => {
		const q = patientSearch.trim().toLowerCase();
		if (!q) return allPatients;
		return allPatients.filter(p =>
			`${p.lastname} ${p.firstname}`.toLowerCase().includes(q) ||
			`${p.firstname} ${p.lastname}`.toLowerCase().includes(q)
		);
	});

	async function loadAllPatients() {
		allPatients = await getAllPatientsIncludingArchived();
		patientMgmtLoaded = true;
	}

	function togglePatientSelection(id: string) {
		const next = new Set(selectedPatientIds);
		if (next.has(id)) next.delete(id); else next.add(id);
		selectedPatientIds = next;
	}

	function toggleSelectAll() {
		if (selectedPatientIds.size === allPatients.length) {
			selectedPatientIds = new Set();
		} else {
			selectedPatientIds = new Set(allPatients.map(p => p.patient_id));
		}
	}

	async function handleDeleteSelectedPatients() {
		isDeletingPatients = true;
		for (const id of selectedPatientIds) {
			// Capture folder name before the DB row is gone
			const patient = allPatients.find(p => p.patient_id === id);
			await deletePatient(id);
			if (patient && vault.isConfigured && vault.path) {
				const folder = vault.patientFolder(patient.lastname, patient.firstname, patient.patient_id);
				await deletePatientFolder(vault.path, folder).catch(() => {/* non-fatal */});
			}
		}
		patientBus.invalidate();
		selectedPatientIds = new Set();
		allPatients = await getAllPatientsIncludingArchived();
		isDeletingPatients = false;
		showDeletePatientsConfirm = false;
		deletePatientsMsg = i18n.t.settings.patientManagement.deleted;
		setTimeout(() => { deletePatientsMsg = ''; }, 3000);
	}

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

<div class="flex h-full overflow-hidden -m-6">

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

	{#snippet navBtn(key: string, label: string)}
		<button
			type="button"
			onclick={() => navigateTo(key)}
			class={[
				'w-full flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-left transition-colors relative',
				activeSection === key
					? 'bg-sidebar-accent text-sidebar-primary font-medium'
					: 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground',
			].join(' ')}
		>
			{#if activeSection === key}
				<span class="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-sidebar-primary"></span>
			{/if}
			{label}
		</button>
	{/snippet}

	{#snippet navGroup(label: string)}
		<p class="px-3 pt-3 pb-0.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 select-none">{label}</p>
	{/snippet}

	<!-- ── Left Sidebar Navigation ── -->
	<nav class="w-52 shrink-0 overflow-y-auto border-r border-border/60 bg-muted/10 py-4 px-2 flex flex-col gap-0.5">

		<div class="px-3 pb-3 mb-1 border-b border-border/50">
			<p class="text-sm font-semibold text-foreground">{i18n.t.settings.title}</p>
			{#if activePatient.id}
				<a
					href="/patients/{activePatient.id}"
					class="mt-2 flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted transition-colors"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3 shrink-0 text-muted-foreground">
						<path d="M19 12H5M12 19l-7-7 7-7"/>
					</svg>
					<span class="truncate">{activePatient.displayName}</span>
				</a>
			{/if}
		</div>

		{@render navBtn('home', i18n.code === 'de' ? 'Übersicht' : 'Overview')}
		{@render navBtn('general', i18n.code === 'de' ? 'Allgemein' : 'General')}
		{@render navBtn('team', i18n.t.staff.title)}
		{@render navBtn('schedule', i18n.code === 'de' ? 'Terminplan' : 'Schedule')}
		{@render navBtn('clinical', i18n.code === 'de' ? 'Klinisch' : 'Clinical')}
		{@render navBtn('documents', i18n.code === 'de' ? 'Dokumente' : 'Documents')}
		{@render navBtn('patients', i18n.t.nav.patients)}

	</nav>

	<!-- ── Right Content Panel ── -->
	<div class="flex-1 overflow-y-auto" bind:this={contentEl}>
		<div class="flex flex-col gap-8 max-w-2xl px-8 py-7">

	{#if activeSection === 'home'}
	{@const de = i18n.code === 'de'}
	{@const nav = navigateTo}
	<div class="flex flex-col gap-5">
		<div>
			<h2 class="text-base font-semibold">{de ? 'Einstellungen' : 'Settings'}</h2>
			<p class="text-sm text-muted-foreground mt-0.5">{de ? 'Wähle einen Bereich oder tippe direkt ein Thema an.' : 'Select a section or jump directly to any topic.'}</p>
		</div>

		<div class="grid grid-cols-2 gap-3">

			<!-- General -->
			<div class="rounded-lg border bg-card overflow-hidden flex flex-col">
				<button type="button" onclick={() => nav('general')} class="flex items-center gap-2 px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left border-b border-border group">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
					<span class="text-sm font-semibold">{de ? 'Allgemein' : 'General'}</span>
				</button>
				<div class="px-2 py-1.5 flex flex-col gap-px">
					{#each [
						{ label: de ? 'Sprache & Darstellung' : 'Language & Appearance' },
						{ label: de ? 'Vault-Pfad' : 'Vault Path' },
						{ label: de ? 'Backup' : 'Backup' },
						{ label: de ? 'Über die App' : 'About' },
					] as item}
						<button type="button" onclick={() => nav('general')} class="flex items-center gap-2 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-left">
							<span class="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0"></span>
							{item.label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Staff -->
			<div class="rounded-lg border bg-card overflow-hidden flex flex-col">
				<button type="button" onclick={() => nav('team')} class="flex items-center gap-2 px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left border-b border-border group">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
					<span class="text-sm font-semibold">{i18n.t.staff.title}</span>
				</button>
				<div class="px-2 py-1.5 flex flex-col gap-px">
					{#each [
						{ label: de ? 'Mitarbeiter & Arbeitszeiten' : 'Staff Members & Hours' },
						{ label: de ? 'Rollen' : 'Roles' },
					] as item}
						<button type="button" onclick={() => nav('team')} class="flex items-center gap-2 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-left">
							<span class="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0"></span>
							{item.label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Schedule -->
			<div class="rounded-lg border bg-card overflow-hidden flex flex-col">
				<button type="button" onclick={() => nav('schedule')} class="flex items-center gap-2 px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left border-b border-border group">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
					<span class="text-sm font-semibold">{de ? 'Terminplan' : 'Schedule'}</span>
				</button>
				<div class="px-2 py-1.5 flex flex-col gap-px">
					{#each [
						{ label: de ? 'Praxis-Öffnungszeiten' : 'Practice Hours' },
						{ label: de ? 'Behandlungsräume' : 'Rooms' },
						{ label: de ? 'Terminarten' : 'Appointment Types' },
					] as item}
						<button type="button" onclick={() => nav('schedule')} class="flex items-center gap-2 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-left">
							<span class="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0"></span>
							{item.label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Clinical -->
			<div class="rounded-lg border bg-card overflow-hidden flex flex-col">
				<button type="button" onclick={() => nav('clinical')} class="flex items-center gap-2 px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left border-b border-border group">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.51 0 2.93.37 4.18 1.02"/><path d="M21 3l-9 9"/><path d="M15 3h6v6"/></svg>
					<span class="text-sm font-semibold">{de ? 'Klinisch' : 'Clinical'}</span>
				</button>
				<div class="px-2 py-1.5 flex flex-col gap-px">
					{#each [
						{ label: de ? 'Klinische Tags' : 'Clinical Tags' },
						{ label: de ? 'Komplikationstypen' : 'Complication Types' },
						{ label: de ? 'Textbausteine' : 'Text Blocks' },
						{ label: de ? 'Zahn-Tags & Symbole' : 'Dental Tags & Symbols' },
						{ label: de ? 'Prothetik & Brücken' : 'Prosthetics & Bridges' },
					] as item}
						<button type="button" onclick={() => nav('clinical')} class="flex items-center gap-2 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-left">
							<span class="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0"></span>
							{item.label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Documents -->
			<div class="rounded-lg border bg-card overflow-hidden flex flex-col">
				<button type="button" onclick={() => nav('documents')} class="flex items-center gap-2 px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left border-b border-border group">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
					<span class="text-sm font-semibold">{de ? 'Dokumente' : 'Documents'}</span>
				</button>
				<div class="px-2 py-1.5 flex flex-col gap-px">
					{#each [
						{ label: de ? 'Ordnerkategorien (!TEMPLATE)' : 'Folder Categories (!TEMPLATE)' },
						{ label: de ? 'Dokumentvorlagen (!Documents)' : 'Document Templates (!Documents)' },
					] as item}
						<button type="button" onclick={() => nav('documents')} class="flex items-center gap-2 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-left">
							<span class="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0"></span>
							{item.label}
						</button>
					{/each}
				</div>
			</div>

			<!-- Patients -->
			<div class="rounded-lg border bg-card overflow-hidden flex flex-col">
				<button type="button" onclick={() => nav('patients')} class="flex items-center gap-2 px-3 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left border-b border-border group">
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
					<span class="text-sm font-semibold">{i18n.t.nav.patients}</span>
				</button>
				<div class="px-2 py-1.5 flex flex-col gap-px">
					{#each [
						{ label: de ? 'Patienten verwalten' : 'Manage Patients' },
						{ label: de ? 'Patientenexport' : 'Patient Export' },
					] as item}
						<button type="button" onclick={() => nav('patients')} class="flex items-center gap-2 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors text-left">
							<span class="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0"></span>
							{item.label}
						</button>
					{/each}
				</div>
			</div>

		</div>
	</div>
	{/if}

	{#if activeSection === 'general'}
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


	<div class="pt-6 pb-2"><Separator /></div>
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.appearance}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.settings.theme.label}</p>
		</div>
		<Separator />

		<!-- UI Scale -->
		<div class="rounded-lg border bg-card p-5 flex items-center justify-between gap-6">
			<div class="flex flex-col gap-0.5">
				<span class="text-sm font-medium">{i18n.t.settings.uiScaleLabel}</span>
				<span class="text-xs text-muted-foreground">{i18n.t.settings.uiScaleOptions[String(uiScale.value) as keyof typeof i18n.t.settings.uiScaleOptions]}</span>
			</div>
			<div class="flex items-center gap-1 rounded-full border bg-muted p-1">
				{#each uiScale.options as opt}
					<button
						type="button"
						onclick={() => uiScale.set(opt)}
						class={[
							'rounded-full px-2.5 py-1 text-xs font-medium transition-all',
							uiScale.value === opt ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
						].join(' ')}
						aria-pressed={uiScale.value === opt}
					>
						{Math.round(opt * 100)} %
					</button>
				{/each}
			</div>
		</div>

		<!-- Theme -->
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


	<div class="pt-6 pb-2"><Separator /></div>
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


	<div class="pt-6 pb-2"><Separator /></div>
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


	<div class="pt-6 pb-2"><Separator /></div>
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
	{/if}

	{#if activeSection === 'team'}
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
				<div class="grid grid-cols-[1.5rem_1fr_5rem_5rem_auto_3rem_2rem_2rem_2rem] items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1">
					<span></span>
					<span>{i18n.t.staff.fields.name}</span>
					<span>{i18n.t.staff.fields.role}</span>
					<span>Specialty</span>
					<span>Color</span>
					<span title="Doc Bar">Bar</span>
					<span title={i18n.t.staff.workingHours}>⏰</span>
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
							<div class="grid grid-cols-[1.5rem_1fr_5rem_5rem_auto_3rem_2rem_2rem_2rem] items-center gap-2 py-1 px-1 rounded-md hover:bg-muted/30 group">
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
								<!-- Working hours button -->
								<button
									type="button"
									onclick={() => { editWorkingHoursDocId = editWorkingHoursDocId === doc.id ? null : doc.id; }}
									class={['flex items-center justify-center h-5 w-5 rounded border transition-colors', editWorkingHoursDocId === doc.id ? 'border-primary bg-primary/10 text-primary' : 'opacity-0 group-hover:opacity-100 border-border text-muted-foreground/60 hover:border-foreground/30'].join(' ')}
									title={i18n.t.staff.workingHours}
								>
									<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
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

	<!-- Working hours editor (shown when clock icon clicked on a staff row) -->
	{#if editWorkingHoursDocId}
		{@const whDoc = doctors.list.find(d => d.id === editWorkingHoursDocId)}
		{#if whDoc}
			<StaffWorkingHoursGrid
				doctorId={whDoc.id}
				doctorName={whDoc.name}
				doctorColor={whDoc.color}
				onClose={() => { editWorkingHoursDocId = null; }}
			/>
		{/if}
	{/if}

	</section>

	{/if}

	{#if activeSection === 'documents'}
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.docCategories}</h2>
			<p class="text-sm text-muted-foreground mt-0.5">
				{i18n.t.settings.docCategories.description}
			</p>
		</div>

		<Separator />

		<!-- Card framed as the !TEMPLATE folder -->
		<div class="rounded-lg border bg-card overflow-hidden">

			<!-- Card header — visually anchors the table to the !TEMPLATE folder -->
			<div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-amber-50/60 dark:bg-amber-950/20">
				<div class="flex items-center gap-2 min-w-0">
					<!-- Folder icon -->
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400">
						<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
					</svg>
					<code class="text-sm font-semibold text-amber-800 dark:text-amber-200">!TEMPLATE/</code>
					<span class="text-xs text-muted-foreground truncate">{i18n.t.settings.docCategories.templateFrameHint}</span>
				</div>
				{#if vault.isConfigured && vault.path}
					<button
						type="button"
						onclick={() => openDocumentFile(`${vault.path}/${TEMPLATE_FOLDER}`)}
						class="shrink-0 flex items-center gap-1.5 rounded border border-amber-200 dark:border-amber-800 bg-amber-100/60 dark:bg-amber-900/20 px-2.5 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-400 hover:bg-amber-200/60 dark:hover:bg-amber-800/30 transition-colors"
						title="Open !TEMPLATE folder in Finder/Explorer"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
							<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
						</svg>
						{i18n.code === 'de' ? 'Im Finder öffnen' : 'Open in Finder'}
					</button>
				{/if}
			</div>

			<!-- Info callout about how !TEMPLATE works -->
			<div class="px-4 py-2.5 border-b border-border/60 bg-muted/20 text-[11px] text-muted-foreground leading-relaxed">
				{i18n.t.settings.docCategories.templateInfoBox}
			</div>

			<div class="p-5 flex flex-col gap-4">
				<!-- Column headers -->
				<div class="grid grid-cols-[2rem_1fr_7rem_5rem_2rem] gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1">
					<span>{i18n.t.settings.docCategories.iconField}</span>
					<span>{i18n.t.settings.docCategories.labelField}</span>
					<span>{i18n.t.settings.docCategories.subfolderCol}</span>
					<span>{i18n.t.settings.docCategories.templateFilesCol}</span>
					<span></span>
				</div>

				<Separator />

				<!-- Category rows -->
				<div class="flex flex-col gap-2">
					{#each localCategories as cat (cat.key)}
						{@const catFolder = vault.categoryFolder(cat.key)}
						{@const tplCount = templateFiles.filter(f => f.category_folder === catFolder).length}
						<div class="grid grid-cols-[2rem_1fr_7rem_5rem_2rem] items-center gap-2">
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
							<!-- Folder name on disk -->
							<div class="flex items-center h-8">
								<code class="text-xs text-muted-foreground bg-muted rounded px-2 py-1 truncate w-full">
									{catFolder}/
								</code>
							</div>
							<!-- Template file count + open -->
							<div class="flex items-center h-8 gap-1">
								{#if tplCount > 0}
									<button
										type="button"
										onclick={() => vault.path && openDocumentFile(`${vault.path}/${TEMPLATE_FOLDER}/${catFolder}`)}
										class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-800/60 transition-colors"
										title="Open template subfolder"
									>
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
											<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>
										</svg>
										{tplCount}
									</button>
								{:else}
									<button
										type="button"
										onclick={() => vault.path && openDocumentFile(`${vault.path}/${TEMPLATE_FOLDER}/${catFolder}`)}
										class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted transition-colors"
										title="Open template subfolder (empty)"
									>
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
											<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
										</svg>
										<span>0</span>
									</button>
								{/if}
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
					<div class="rounded-md border border-dashed border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 p-3 flex flex-col gap-3">
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
								<label for="new-cat-key" class="text-[10px] text-muted-foreground">{i18n.t.settings.docCategories.subfolderCol} <span class="text-destructive">*</span></label>
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
							<p class="text-[10px] text-muted-foreground leading-relaxed">
								{i18n.t.settings.docCategories.addCategoryFolderHint.replace('{key}', newKey)}
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

			</div>

			<p class="text-[10px] text-muted-foreground/70 leading-relaxed">
				⚠️ {i18n.code === 'de'
					? 'Das Umbenennen von <strong>Bezeichnung</strong> oder <strong>Symbol</strong> ist sicher — bestehende Dokumente behalten ihren Kategorieschlüssel. Das Löschen einer Kategorie löscht <em>keine</em> Dokumente. Der Ordnername kann nach der Erstellung nicht mehr geändert werden.'
					: "Renaming a category's <strong>label</strong> or <strong>icon</strong> is safe — existing documents keep their category key. Deleting a category does <em>not</em> delete its documents. The folder name cannot be changed after creation."}
			</p>
			</div><!-- /p-5 -->
		</div><!-- /card -->
	<!-- !Documents folder card -->
	<div class="rounded-lg border bg-card overflow-hidden mt-2">

		<!-- Card header -->
		<div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-teal-50/60 dark:bg-teal-950/20">
			<div class="flex items-center gap-2 min-w-0">
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400">
					<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
				</svg>
				<code class="text-sm font-semibold text-teal-800 dark:text-teal-200">!Documents/</code>
				<span class="text-xs text-muted-foreground truncate">{i18n.code === 'de' ? 'Wiederverwendbare Dokumentvorlagen' : 'Reusable document templates'}</span>
			</div>
			{#if vault.isConfigured && vault.path}
				<button
					type="button"
					onclick={() => openDocumentFile(`${vault.path}/!Documents`)}
					class="shrink-0 flex items-center gap-1.5 rounded border border-teal-200 dark:border-teal-800 bg-teal-100/60 dark:bg-teal-900/20 px-2.5 py-1 text-[11px] font-medium text-teal-700 dark:text-teal-400 hover:bg-teal-200/60 dark:hover:bg-teal-800/30 transition-colors"
					title="Open !Documents folder"
				>
					<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
						<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
					</svg>
					{i18n.code === 'de' ? 'Im Finder öffnen' : 'Open in Finder'}
				</button>
			{/if}
		</div>

		<!-- Explanation -->
		<div class="px-4 py-2.5 border-b border-border/60 bg-muted/20 text-[11px] text-muted-foreground leading-relaxed">
			{i18n.code === 'de'
				? 'Legen Sie hier Vorlagendokumente ab (PDFs, Word-Dateien usw.). Im Patienten-Timeline gibt es einen "+ Vorlage"-Button, mit dem eine dieser Dateien in den Ordner des aktiven Patienten kopiert und als Dokument-Eintrag registriert wird — nützlich für Einwilligungsformulare, Behandlungsprotokolle oder andere patientenspezifische Unterlagen.'
				: "Store reusable document templates here (PDFs, Word files, etc.). In a patient's timeline, use the \"+ Template\" button to copy one of these files into that patient's folder and register it as a document entry — useful for consent forms, treatment protocols, or any patient-specific starting documents."}
		</div>

		<!-- File list -->
		<div class="p-4">
			{#if docTemplateFiles.length === 0}
				<p class="text-xs text-muted-foreground/60 text-center py-3 italic">
					{i18n.code === 'de' ? 'Noch keine Vorlagen vorhanden. Dateien im Finder in diesen Ordner ablegen.' : 'No templates yet. Drop files into this folder in Finder to add them.'}
				</p>
			{:else}
				<div class="flex flex-col gap-1">
					{#each docTemplateFiles as tpl}
						<div class="flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-muted/40 transition-colors group">
							<!-- File icon based on extension -->
							{#if tpl.filename.match(/\.pdf$/i)}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="h-4 w-4 shrink-0 text-red-500">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
									<line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/>
								</svg>
							{:else if tpl.filename.match(/\.docx?$/i)}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="h-4 w-4 shrink-0 text-blue-500">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
									<line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>
								</svg>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" class="h-4 w-4 shrink-0 text-muted-foreground">
									<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
								</svg>
							{/if}
							<span class="flex-1 text-xs font-medium truncate">{tpl.filename}</span>
							<span class="text-[10px] text-muted-foreground/50 shrink-0">{(tpl.file_size / 1024).toFixed(0)} KB</span>
							<button
								type="button"
								onclick={() => vault.path && openDocumentFile(`${vault.path}/!Documents/${tpl.filename}`)}
								class="opacity-0 group-hover:opacity-100 flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
								title={i18n.code === 'de' ? 'Datei öffnen' : 'Open file'}
							>
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
									<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
								</svg>
							</button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

	</div>
	</section>

	{/if}

	{#if activeSection === 'clinical'}

	<div class="pt-6 pb-2"><Separator /></div>
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


	<div class="pt-6 pb-2"><Separator /></div>
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


	<div class="pt-6 pb-2"><Separator /></div>
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
			</div>
		</div>
	</section>

	<div class="pt-6 pb-2"><Separator /></div>
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.chart.title}</h2>
			<p class="text-sm text-muted-foreground">
				{i18n.t.chart.editTags}
			</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-3">

			<!-- Tag rows — grouped by clinical category -->
			<div class="flex flex-col gap-4">
				{#each TAG_GROUPS as group}
					{@const groupTags = draftTags
						.map((t, i) => ({ tag: t, i }))
						.filter(({ tag }) => group.keys.includes(tag.key))}
					{#if groupTags.length > 0}
						<div class="flex flex-col gap-1">
							<div class="flex items-center gap-2 mb-0.5">
								<span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{group.label}</span>
								<div class="flex-1 h-px bg-border/60"></div>
							</div>
							{#each groupTags as { tag, i }}
								{@const isRenderCritical = RENDER_CRITICAL_TAGS.has(tag.key)}
								{@const isAppearanceManaged = tag.key === 'bridge' || tag.key === 'prosthesis'}
								<div class="rounded-md border bg-background">
									<div class="flex items-center gap-2 px-3 py-2">
										<!-- Colour preview swatch (uses store colors for bridge/prosthesis) -->
										{#if tag.key === 'bridge'}
											{@const brCfg = bridgeRoles.getConfig('abutment')}
											<div class="h-7 w-2 rounded-full shrink-0" style="background:{brCfg.fillColor};outline:2px solid {brCfg.color};outline-offset:1px"></div>
										{:else if tag.key === 'prosthesis'}
											{@const ptCfg = prosthesisTypes.getConfig('telescope')}
											<div class="h-7 w-2 rounded-full shrink-0" style="background:{ptCfg.fillColor};outline:2px solid {ptCfg.color};outline-offset:1px"></div>
										{:else}
											<div class="h-7 w-2 rounded-full shrink-0" style="background:{tag.color};outline:2px solid {tag.strokeColor};outline-offset:1px"></div>
										{/if}
										<!-- Label -->
										<input
											type="text"
											value={tag.label}
											oninput={(e) => updateTag(i, 'label', (e.target as HTMLInputElement).value)}
											class="border-input bg-transparent h-8 min-w-0 flex-1 rounded border px-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
											placeholder="Tag name"
										/>
										{#if isAppearanceManaged}
											<!-- Shortcut only — color/fill managed by dedicated appearance settings -->
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
											<button
												type="button"
												onclick={() => document.getElementById(tag.key === 'bridge' ? 'section-bridge-appearance' : 'section-prosthesis-appearance')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
												class="flex-1 min-w-0 text-left text-[10px] text-primary/70 hover:text-primary underline underline-offset-2 transition-colors truncate"
												title={tag.key === 'bridge' ? i18n.t.chart.tagGroups.bridgeTagNote : i18n.t.chart.tagGroups.prosthesisTagNote}
											>
												↓ {tag.key === 'bridge' ? i18n.t.settings.bridgeRoleSettings.title : i18n.t.settings.prosthesisTypeSettings.title}
											</button>
										{:else}
											<!-- Full controls for regular tags -->
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
										{/if}
										<!-- Whole-tooth toggle -->
										<button
											type="button"
											onclick={() => toggleWholeTooth(i)}
											class={[
												'shrink-0 rounded border px-2 h-8 text-[10px] font-medium transition-colors',
												tag.wholeTooth ? 'bg-amber-100 border-amber-300 text-amber-700' : 'border-border text-muted-foreground hover:border-foreground/40',
											].join(' ')}
											title={i18n.t.chart.wholeToothOnly}
										>
											{i18n.t.chart.wholeToothOnly}
										</button>
										<!-- Delete — disabled for render-critical tags -->
										<button
											type="button"
											onclick={() => removeTag(i)}
											disabled={isRenderCritical}
											class="shrink-0 rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
											aria-label={isRenderCritical ? 'Cannot delete — affects chart rendering' : 'Remove tag'}
											title={isRenderCritical ? 'Cannot delete — this tag is used by the chart rendering engine or a clinical module (endo docs, filling materials). Color, pattern, label and shortcut can still be changed.' : 'Remove tag'}
										>
											<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
												<path d="M18 6L6 18M6 6l12 12"/>
											</svg>
										</button>
									</div>
									<!-- Pattern picker panel — only for non-appearance-managed tags -->
									{#if !isAppearanceManaged && openPatternIdx === i}
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
					{/if}
				{/each}
				<!-- Custom tags (user-added) -->
				{#if draftTags.some(t => t.key.startsWith('custom_'))}
					<div class="flex flex-col gap-1">
						<div class="flex items-center gap-2 mb-0.5">
							<span class="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">{i18n.t.chart.tagGroups.custom}</span>
							<div class="flex-1 h-px bg-border/60"></div>
						</div>
						{#each draftTags.map((t, i) => ({ tag: t, i })).filter(({ tag }) => tag.key.startsWith('custom_')) as { tag, i }}
							{@const isRenderCritical = RENDER_CRITICAL_TAGS.has(tag.key)}
							<div class="rounded-md border bg-background">
								<div class="flex items-center gap-2 px-3 py-2">
									<div class="h-7 w-2 rounded-full shrink-0" style="background:{tag.color};outline:2px solid {tag.strokeColor};outline-offset:1px"></div>
									<input type="text" value={tag.label}
										oninput={(e) => updateTag(i, 'label', (e.target as HTMLInputElement).value)}
										class="border-input bg-transparent h-8 min-w-0 flex-1 rounded border px-2 text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
										placeholder="Tag name"/>
									<input type="text" maxlength="1" value={tag.shortcut ?? ''}
										oninput={(e) => updateTag(i, 'shortcut', (e.target as HTMLInputElement).value.slice(-1))}
										class={['h-8 w-9 shrink-0 rounded border text-center font-mono text-sm outline-none',
											tag.shortcut && duplicateShortcuts.has(tag.shortcut.toLowerCase())
												? 'border-destructive bg-destructive/10 text-destructive' : 'border-input bg-background focus:border-ring focus:ring-1 focus:ring-ring/50'
										].join(' ')} placeholder="—"/>
									<label class="relative h-8 w-8 shrink-0 rounded border-2 border-border overflow-hidden cursor-pointer" style="background:{tag.color}" title="Fill colour">
										<input type="color" value={tag.color} oninput={(e) => updateTag(i, 'color', (e.target as HTMLInputElement).value)}
											class="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer opacity-0"/>
									</label>
									<label class="relative h-8 w-8 shrink-0 rounded border-2 overflow-hidden cursor-pointer" style="background:{tag.strokeColor};border-color:{tag.strokeColor}" title="Border colour">
										<input type="color" value={tag.strokeColor} oninput={(e) => updateTag(i, 'strokeColor', (e.target as HTMLInputElement).value)}
											class="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer opacity-0"/>
									</label>
									<button type="button" onclick={() => { openPatternIdx = openPatternIdx === i ? null : i; }}
										class={['flex items-center gap-1 rounded border px-1.5 h-8 shrink-0 transition-colors',
											openPatternIdx === i ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/40'].join(' ')} title="Change fill pattern">
										{@render patIcon(tag.pattern, tag.color, tag.strokeColor)}
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
											class={['h-3 w-3 text-muted-foreground transition-transform duration-150', openPatternIdx === i ? 'rotate-180' : ''].join(' ')}>
											<polyline points="6 9 12 15 18 9"/>
										</svg>
									</button>
									<button type="button" onclick={() => removeTag(i)} disabled={isRenderCritical}
										class="shrink-0 rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-25 disabled:cursor-not-allowed">
										<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
											<path d="M18 6L6 18M6 6l12 12"/>
										</svg>
									</button>
								</div>
								{#if openPatternIdx === i}
									<div transition:slide={{ duration: 120 }} class="border-t border-border/50 px-3 py-2.5 flex items-center gap-2 flex-wrap rounded-b-md bg-muted/30">
										<span class="text-[10px] font-medium text-muted-foreground w-full mb-0.5">Choose fill pattern:</span>
										{#each PATTERNS as p}
											<button type="button" onclick={() => selectPattern(i, p.key)}
												class={['flex flex-col items-center gap-1 rounded border p-1.5 transition-all',
													tag.pattern === p.key ? 'border-primary bg-primary/10 ring-2 ring-primary ring-offset-1' : 'border-border hover:border-foreground/40 bg-background'].join(' ')} title={p.label}>
												{@render patIcon(p.key, tag.color, tag.strokeColor)}
												<span class="text-[9px] text-muted-foreground leading-none">{p.label}</span>
											</button>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
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
			</div>

		</div>
	</section>


	<div class="pt-6 pb-2"><Separator /></div>
	<section id="section-prosthesis-appearance" class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.prosthesisTypeSettings.title}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.settings.prosthesisTypeSettings.description}</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-3">
			<!-- Column headers -->
			<div class="grid grid-cols-[6rem_2rem_2.5rem_2rem_2rem_auto_5rem] items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1">
				<span>{i18n.t.common.name}</span>
				<span>{i18n.t.settings.prosthesisTypeSettings.badge}</span>
				<span>{i18n.t.settings.prosthesisTypeSettings.color}</span>
				<span>{i18n.t.settings.prosthesisTypeSettings.fillColor}</span>
				<span>{i18n.t.settings.prosthesisTypeSettings.fillPattern}</span>
				<span></span>
				<span></span>
			</div>
			<Separator />

			<div class="flex flex-col gap-2">
				{#each draftPtConfigs as cfg, i}
					{@const ptLabel = i18n.t.chart.prosthesisTypes[cfg.key as keyof typeof i18n.t.chart.prosthesisTypes] ?? cfg.key}
					<div class="rounded-md border bg-background">
						<div class="grid grid-cols-[6rem_2rem_2.5rem_2rem_2rem_auto] items-center gap-2 px-3 py-2">
							<!-- Label (read-only, from i18n) -->
							<span class="text-sm font-medium truncate">{ptLabel}</span>

							<!-- Badge character (single char) -->
							<input
								type="text"
								maxlength="1"
								value={cfg.badge}
								oninput={(e) => updatePtConfig(i, 'badge', (e.target as HTMLInputElement).value.slice(-1) || cfg.badge)}
								class="h-8 w-8 shrink-0 rounded border border-input bg-background text-center font-mono text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
								title={i18n.t.settings.prosthesisTypeSettings.badge}
							/>

							<!-- Outline/color picker -->
							<label class="relative h-8 w-8 shrink-0 rounded border-2 overflow-hidden cursor-pointer" style="background:{cfg.color};border-color:{cfg.color}" title={i18n.t.settings.prosthesisTypeSettings.color}>
								<input type="color" value={cfg.color} oninput={(e) => updatePtConfig(i, 'color', (e.target as HTMLInputElement).value)}
									class="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer opacity-0"/>
							</label>

							<!-- Fill color picker -->
							<label class="relative h-8 w-8 shrink-0 rounded border-2 overflow-hidden cursor-pointer" style="background:{cfg.fillColor};border-color:{cfg.color}40" title={i18n.t.settings.prosthesisTypeSettings.fillColor}>
								<input type="color" value={cfg.fillColor} oninput={(e) => updatePtConfig(i, 'fillColor', (e.target as HTMLInputElement).value)}
									class="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer opacity-0"/>
							</label>

							<!-- Fill pattern toggle -->
							<button
								type="button"
								onclick={() => { openPtPatternIdx = openPtPatternIdx === i ? null : i; }}
								class={[
									'flex items-center gap-1 rounded border px-1.5 h-8 shrink-0 transition-colors',
									openPtPatternIdx === i ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/40',
								].join(' ')}
								title={i18n.t.settings.prosthesisTypeSettings.fillPattern}
							>
								{@render patIcon(cfg.fillPattern, cfg.fillColor, cfg.color)}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
									class={['h-3 w-3 text-muted-foreground transition-transform duration-150', openPtPatternIdx === i ? 'rotate-180' : ''].join(' ')}>
									<polyline points="6 9 12 15 18 9"/>
								</svg>
							</button>

							<!-- Badge preview -->
							<div class="flex items-center gap-2">
								<span class="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0"
									style="background:white; color:{cfg.color}; outline:1.5px solid {cfg.color}">{cfg.badge || '?'}</span>
								<span class="text-xs text-muted-foreground">{i18n.t.settings.prosthesisTypeSettings.badge}</span>
							</div>
						</div>
						<!-- Pattern picker panel -->
						{#if openPtPatternIdx === i}
							<div transition:slide={{ duration: 120 }} class="border-t border-border/50 px-3 py-2.5 flex items-center gap-2 flex-wrap rounded-b-md bg-muted/30">
								<span class="text-[10px] font-medium text-muted-foreground w-full mb-0.5">Choose fill pattern:</span>
								{#each PATTERNS as p}
									<button
										type="button"
										onclick={() => selectPtPattern(i, p.key)}
										class={[
											'flex flex-col items-center gap-1 rounded border p-1.5 transition-all',
											cfg.fillPattern === p.key
												? 'border-primary bg-primary/10 ring-2 ring-primary ring-offset-1'
												: 'border-border hover:border-foreground/40 bg-background',
										].join(' ')}
										title={p.label}
									>
										{@render patIcon(p.key, cfg.fillColor, cfg.color)}
										<span class="text-[9px] text-muted-foreground leading-none">{p.label}</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Save -->
			<div class="flex items-center gap-3 pt-1">
				<Button size="sm" onclick={handleSavePtConfigs} disabled={isPtSaving}>
					{isPtSaving ? i18n.t.common.loading : i18n.t.actions.save}
				</Button>
				{#if ptSaved}
					<span class="text-sm text-emerald-600 dark:text-emerald-400 font-medium">✓ {i18n.t.settings.prosthesisTypeSettings.saved}</span>
				{/if}
			</div>
		</div>
	</section>


	<div class="pt-6 pb-2"><Separator /></div>
	<section id="section-bridge-appearance" class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.bridgeRoleSettings.title}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.settings.bridgeRoleSettings.description}</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-3">
			<!-- Column headers -->
			<div class="grid grid-cols-[6rem_2rem_2.5rem_2rem_2rem_auto_5rem] items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground px-1">
				<span>{i18n.t.common.name}</span>
				<span>{i18n.t.settings.bridgeRoleSettings.badge}</span>
				<span>{i18n.t.settings.bridgeRoleSettings.color}</span>
				<span>{i18n.t.settings.bridgeRoleSettings.fillColor}</span>
				<span>{i18n.t.settings.bridgeRoleSettings.fillPattern}</span>
				<span></span>
				<span></span>
			</div>
			<Separator />

			<div class="flex flex-col gap-2">
				{#each draftBrConfigs as cfg, i}
					{@const brLabel = cfg.key === 'connector'
						? i18n.t.settings.bridgeRoleSettings.connectorBar
						: (i18n.t.chart.bridgeRoles[cfg.key as keyof typeof i18n.t.chart.bridgeRoles] ?? cfg.key)}
					<div class="rounded-md border bg-background">
						<div class="grid grid-cols-[6rem_2rem_2.5rem_2rem_2rem_auto] items-center gap-2 px-3 py-2">
							<!-- Label (read-only, from i18n) -->
							<span class="text-sm font-medium truncate">{brLabel}</span>

							<!-- Badge character (single char, not for connector) -->
							{#if cfg.key !== 'connector'}
								<input
									type="text"
									maxlength="1"
									value={cfg.badge}
									oninput={(e) => updateBrConfig(i, 'badge', (e.target as HTMLInputElement).value.slice(-1) || cfg.badge)}
									class="h-8 w-8 shrink-0 rounded border border-input bg-background text-center font-mono text-sm outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
									title={i18n.t.settings.bridgeRoleSettings.badge}
								/>
							{:else}
								<div class="h-8 w-8 shrink-0 rounded border border-dashed border-border flex items-center justify-center opacity-40">
									<span class="text-[10px] text-muted-foreground">—</span>
								</div>
							{/if}

							<!-- Outline/color picker -->
							<label class="relative h-8 w-8 shrink-0 rounded border-2 overflow-hidden cursor-pointer" style="background:{cfg.color};border-color:{cfg.color}" title={i18n.t.settings.bridgeRoleSettings.color}>
								<input type="color" value={cfg.color} oninput={(e) => updateBrConfig(i, 'color', (e.target as HTMLInputElement).value)}
									class="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer opacity-0"/>
							</label>

							<!-- Fill color picker -->
							<label class="relative h-8 w-8 shrink-0 rounded border-2 overflow-hidden cursor-pointer" style="background:{cfg.fillColor};border-color:{cfg.color}40" title={i18n.t.settings.bridgeRoleSettings.fillColor}>
								<input type="color" value={cfg.fillColor} oninput={(e) => updateBrConfig(i, 'fillColor', (e.target as HTMLInputElement).value)}
									class="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer opacity-0"/>
							</label>

							<!-- Fill pattern toggle (connector uses solid only in rendering but we still allow setting it) -->
							<button
								type="button"
								onclick={() => { openBrPatternIdx = openBrPatternIdx === i ? null : i; }}
								class={[
									'flex items-center gap-1 rounded border px-1.5 h-8 shrink-0 transition-colors',
									openBrPatternIdx === i ? 'border-primary bg-primary/5' : 'border-border hover:border-foreground/40',
								].join(' ')}
								title={i18n.t.settings.bridgeRoleSettings.fillPattern}
							>
								{@render patIcon(cfg.fillPattern, cfg.fillColor, cfg.color)}
								<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
									class={['h-3 w-3 text-muted-foreground transition-transform duration-150', openBrPatternIdx === i ? 'rotate-180' : ''].join(' ')}>
									<polyline points="6 9 12 15 18 9"/>
								</svg>
							</button>

							<!-- Badge preview (or bar preview for connector) -->
							<div class="flex items-center gap-2">
								{#if cfg.key === 'connector'}
									<span class="inline-flex items-center justify-center w-8 h-4 rounded text-[9px] font-bold shrink-0"
										style="background:{cfg.fillColor}; outline:1.5px solid {cfg.color}; color:{cfg.color}">▬</span>
								{:else}
									<span class="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold shrink-0"
										style="background:white; color:{cfg.color}; outline:1.5px solid {cfg.color}">{cfg.badge || '?'}</span>
								{/if}
							</div>
						</div>
						<!-- Pattern picker panel -->
						{#if openBrPatternIdx === i}
							<div transition:slide={{ duration: 120 }} class="border-t border-border/50 px-3 py-2.5 flex items-center gap-2 flex-wrap rounded-b-md bg-muted/30">
								<span class="text-[10px] font-medium text-muted-foreground w-full mb-0.5">Choose fill pattern:</span>
								{#each PATTERNS as p}
									<button
										type="button"
										onclick={() => selectBrPattern(i, p.key)}
										class={[
											'flex flex-col items-center gap-1 rounded border p-1.5 transition-all',
											cfg.fillPattern === p.key
												? 'border-primary bg-primary/10 ring-2 ring-primary ring-offset-1'
												: 'border-border hover:border-foreground/40 bg-background',
										].join(' ')}
										title={p.label}
									>
										{@render patIcon(p.key, cfg.fillColor, cfg.color)}
										<span class="text-[9px] text-muted-foreground leading-none">{p.label}</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Save -->
			<div class="flex items-center gap-3 pt-1">
				<Button size="sm" onclick={handleSaveBrConfigs} disabled={isBrSaving}>
					{isBrSaving ? i18n.t.common.loading : i18n.t.actions.save}
				</Button>
				{#if brSaved}
					<span class="text-sm text-emerald-600 dark:text-emerald-400 font-medium">✓ {i18n.t.settings.bridgeRoleSettings.saved}</span>
				{/if}
			</div>
		</div>
	</section>

	<div class="pt-6 pb-2"><Separator /></div>
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.fillingMaterials.title}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.settings.fillingMaterials.description}</p>
		</div>
		<Separator />
		<div class="rounded-lg border bg-card p-5 flex flex-col gap-3">
			<div class="flex flex-col gap-2">
				{#each draftFillingMaterials as mat, i}
					<div class="flex items-center gap-2">
						<input
							type="color"
							bind:value={draftFillingMaterials[i].color}
							class="h-6 w-8 rounded border border-border cursor-pointer p-0.5"
							title={i18n.t.settings.fillingMaterials.colorLabel}
						/>
						<input
							type="text"
							class="border-input bg-background flex h-8 flex-1 rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
							placeholder={i18n.t.settings.fillingMaterials.labelPlaceholder}
							bind:value={draftFillingMaterials[i].label}
						/>
						<button
							type="button"
							onclick={() => removeFillingMaterial(i)}
							class="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
							title={i18n.t.actions.delete}
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
						</button>
					</div>
				{/each}
			</div>
			<button
				type="button"
				onclick={addFillingMaterial}
				class="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-sm text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors w-full"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
				{i18n.t.settings.fillingMaterials.add}
			</button>
			<div class="flex items-center gap-3 pt-1">
				<Button size="sm" onclick={handleSaveFillingMaterials} disabled={isFillingMatSaving}>
					{isFillingMatSaving ? i18n.t.common.loading : i18n.t.actions.save}
				</Button>
				{#if fillingMatSaved}
					<span class="text-sm text-emerald-600 dark:text-emerald-400 font-medium">✓ {i18n.t.settings.saved}</span>
				{/if}
			</div>
		</div>
	</section>

	<div class="pt-6 pb-2"><Separator /></div>
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.endoInstruments.title}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.settings.endoInstruments.description}</p>
		</div>
		<Separator />
		<div class="rounded-lg border bg-card p-5 flex flex-col gap-3">
			<div class="flex flex-col gap-2">
				{#each draftEndoInstruments as ei, i}
					<div class="flex items-center gap-2">
						<input
							type="text"
							class="border-input bg-background flex h-8 flex-1 rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
							placeholder={i18n.t.settings.endoInstruments.labelPlaceholder}
							bind:value={draftEndoInstruments[i].label}
						/>
						<button
							type="button"
							onclick={() => removeEndoInstrument(i)}
							class="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
							title={i18n.t.actions.delete}
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
						</button>
					</div>
				{/each}
			</div>
			<button
				type="button"
				onclick={addEndoInstrument}
				class="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-sm text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors w-full"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
				{i18n.t.settings.endoInstruments.add}
			</button>
			<div class="flex items-center gap-3 pt-1">
				<Button size="sm" onclick={handleSaveEndoInstruments} disabled={isEndoInstrSaving}>
					{isEndoInstrSaving ? i18n.t.common.loading : i18n.t.actions.save}
				</Button>
				{#if endoInstrSaved}
					<span class="text-sm text-emerald-600 dark:text-emerald-400 font-medium">✓ {i18n.t.settings.saved}</span>
				{/if}
			</div>
		</div>
	</section>

	<div class="pt-6 pb-2"><Separator /></div>
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.postTypes.title}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.settings.postTypes.description}</p>
		</div>
		<Separator />
		<div class="rounded-lg border bg-card p-5 flex flex-col gap-3">
			<div class="flex flex-col gap-2">
				{#each draftPostTypes as pt, i}
					<div class="flex items-center gap-2">
						<input
							type="text"
							class="border-input bg-background flex h-8 flex-1 rounded-md border px-3 py-1 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
							placeholder={i18n.t.settings.postTypes.labelPlaceholder}
							bind:value={draftPostTypes[i].label}
						/>
						<button
							type="button"
							onclick={() => removePostType(i)}
							class="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
							title={i18n.t.actions.delete}
						>
							<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
						</button>
					</div>
				{/each}
			</div>
			<button
				type="button"
				onclick={addPostType}
				class="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/40 px-3 py-2 text-sm text-muted-foreground hover:border-foreground/50 hover:text-foreground transition-colors w-full"
			>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4 shrink-0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
				{i18n.t.settings.postTypes.add}
			</button>
			<div class="flex items-center gap-3 pt-1">
				<Button size="sm" onclick={handleSavePostTypes} disabled={isPostSaving}>
					{isPostSaving ? i18n.t.common.loading : i18n.t.actions.save}
				</Button>
				{#if postSaved}
					<span class="text-sm text-emerald-600 dark:text-emerald-400 font-medium">✓ {i18n.t.settings.saved}</span>
				{/if}
			</div>
		</div>
	</section>

	<Separator />

	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.code === 'de' ? 'DMFT-Index' : 'DMFT Index'}</h2>
			<p class="text-sm text-muted-foreground">{i18n.code === 'de' ? 'Einstellungen für die automatische DMFT-Berechnung im Zahnschema.' : 'Settings for automatic DMFT index calculation in the dental chart.'}</p>
		</div>
		<Separator />
		<div class="rounded-lg border bg-card p-5 flex flex-col gap-3">
			<label class="flex items-center gap-3 cursor-pointer">
				<input
					type="checkbox"
					class="h-4 w-4 rounded border-border"
					checked={dmftForAdults}
					onchange={(e) => handleDmftToggle((e.target as HTMLInputElement).checked)}
				/>
				<div>
					<p class="text-sm font-medium">{i18n.t.settings.chart.dmftForAdults}</p>
					<p class="text-xs text-muted-foreground">{i18n.code === 'de' ? 'Zeigt D/M/F-Aufschlüsselung im Zahnschema-Header an.' : 'Shows D/M/F breakdown in the dental chart header.'}</p>
				</div>
			</label>
		</div>
	</section>

	{/if}

	{#if activeSection === 'schedule'}
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.workingHours}</h2>
			<p class="text-sm text-muted-foreground">{i18n.code === 'de' ? 'Öffnungszeiten der Praxis für den Terminplaner.' : 'Practice opening hours — controls the visible range in the day view.'}</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{i18n.t.settings.sections.workingHours}</span>
				<div class="flex items-center gap-2">
					{#if workingHoursSaved}
						<span class="text-xs text-emerald-600">{i18n.t.settings.saved}!</span>
					{/if}
					<Button size="sm" onclick={handleSaveWorkingHours} disabled={workingHoursSaving}>
						{workingHoursSaving ? i18n.t.common.loading : i18n.t.actions.save}
					</Button>
				</div>
			</div>

			<div class="flex flex-col divide-y divide-border">
				{#each localWorkingHours as day, idx}
					<div class="flex items-center gap-3 py-2.5">
						<input
							type="checkbox"
							class="h-4 w-4 rounded border-border"
							bind:checked={localWorkingHours[idx].is_active}
						/>
						<span class="w-24 text-sm font-medium {day.is_active ? '' : 'text-muted-foreground'}">
							{i18n.t.defaults.workingDays[day.day_of_week]}
						</span>
						{#if day.is_active}
							<input type="time" bind:value={localWorkingHours[idx].start_time} class="border border-border rounded px-2 py-1 text-sm bg-background w-24" />
							<span class="text-xs text-muted-foreground">–</span>
							<input type="time" bind:value={localWorkingHours[idx].end_time} class="border border-border rounded px-2 py-1 text-sm bg-background w-24" />
							<span class="text-xs text-muted-foreground ml-2">{i18n.code === 'de' ? 'Pause' : 'Break'}:</span>
							<input type="time" bind:value={localWorkingHours[idx].break_start as string} class="border border-border rounded px-2 py-1 text-sm bg-background w-24" placeholder="--:--" />
							<span class="text-xs text-muted-foreground">–</span>
							<input type="time" bind:value={localWorkingHours[idx].break_end as string} class="border border-border rounded px-2 py-1 text-sm bg-background w-24" placeholder="--:--" />
						{:else}
							<span class="text-xs text-muted-foreground">{i18n.code === 'de' ? 'Geschlossen' : 'Closed'}</span>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</section>

	<div class="pt-6 pb-2"><Separator /></div>
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.rooms}</h2>
			<p class="text-sm text-muted-foreground">Behandlungsräume und Stühle für den Terminplaner.</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{i18n.t.settings.sections.rooms}</span>
				<div class="flex items-center gap-2">
					{#if roomsSaved}
						<span class="text-xs text-emerald-600">{i18n.t.settings.saved}!</span>
					{/if}
					<Button size="sm" variant="outline" onclick={() => (showAddRoom = !showAddRoom)}>
						{i18n.t.actions.add}
					</Button>
				</div>
			</div>

			{#if showAddRoom}
				<div class="flex flex-col gap-2 border border-border rounded p-3 bg-muted/30">
					<div class="grid grid-cols-2 gap-2">
						<input type="text" placeholder="Name" bind:value={newRoomName} class={inputClass + ' col-span-2'} />
						<input type="text" placeholder="Kürzel (z.B. S1)" bind:value={newRoomShort} class={inputClass} />
						<div class="flex items-center gap-2">
							<label class="text-xs text-muted-foreground">Farbe</label>
							<input type="color" bind:value={newRoomColor} class="h-8 w-12 rounded border border-border cursor-pointer" />
						</div>
					</div>
					<div class="flex gap-2">
						<Button size="sm" onclick={handleAddRoom} disabled={!newRoomName.trim() || roomsSaving}>{i18n.t.actions.add}</Button>
						<Button size="sm" variant="outline" onclick={() => (showAddRoom = false)}>{i18n.t.actions.cancel}</Button>
					</div>
				</div>
			{/if}

			<div class="flex flex-col divide-y divide-border">
				{#each rooms.list as room}
					<div class="flex items-center gap-3 py-2">
						<span class="w-3 h-3 rounded-full shrink-0" style="background-color: {room.color}"></span>
						{#if editingRoomId === room.id}
							<div class="flex flex-1 items-center gap-2 flex-wrap">
								<input type="text" bind:value={editRoomName} class={inputClass + ' flex-1 min-w-0'} />
								<input type="text" bind:value={editRoomShort} placeholder="Kürzel" class={inputClass + ' w-20'} />
								<input type="color" bind:value={editRoomColor} class="h-8 w-10 rounded border border-border cursor-pointer" />
								<Button size="sm" onclick={() => saveEditRoom(room.id)} disabled={roomsSaving}>{i18n.t.actions.save}</Button>
								<Button size="sm" variant="outline" onclick={() => (editingRoomId = null)}>{i18n.t.actions.cancel}</Button>
							</div>
						{:else}
							<span class="flex-1 text-sm font-medium">{room.name}</span>
							{#if room.short_name}
								<span class="text-xs text-muted-foreground">{room.short_name}</span>
							{/if}
							<span class="text-xs px-1.5 py-0.5 rounded-full {room.is_active ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}">
								{room.is_active ? 'Aktiv' : 'Inaktiv'}
							</span>
							<button class="text-xs text-muted-foreground hover:text-foreground" onclick={() => startEditRoom(room)}>{i18n.t.actions.edit}</button>
							<button class="text-xs text-muted-foreground hover:text-foreground" onclick={() => handleToggleRoom(room)}>
								{room.is_active ? 'Deakt.' : 'Aktiv.'}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</section>


	<div class="pt-6 pb-2"><Separator /></div>
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.entryTypes}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.settings.entryTypes.description}</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-5 flex flex-col gap-4">
			<div class="flex items-center justify-between">
				<span class="text-xs font-medium text-muted-foreground uppercase tracking-wide">{i18n.t.settings.sections.entryTypes}</span>
				<div class="flex items-center gap-2">
					{#if apptTypesSaved}
						<span class="text-xs text-emerald-600">{i18n.t.settings.saved}!</span>
					{/if}
					<Button size="sm" variant="outline" onclick={() => (showAddApptType = !showAddApptType)}>
						{i18n.t.actions.add}
					</Button>
				</div>
			</div>

			{#if showAddApptType}
				<div class="flex flex-col gap-2 border border-border rounded p-3 bg-muted/30">
					<div class="grid grid-cols-2 gap-2">
						<input type="text" placeholder="Name" bind:value={newApptTypeName} class={inputClass + ' col-span-2'} />
						<input type="text" placeholder="Kürzel" bind:value={newApptTypeShort} class={inputClass} />
						<input type="number" min="5" step="5" placeholder="Dauer (min)" bind:value={newApptTypeDuration} class={inputClass} />
						<div class="flex items-center gap-2">
							<label class="text-xs text-muted-foreground">Farbe</label>
							<input type="color" bind:value={newApptTypeColor} class="h-8 w-12 rounded border border-border cursor-pointer" />
						</div>
					</div>
					<div class="flex gap-2">
						<Button size="sm" onclick={handleAddApptType} disabled={!newApptTypeName.trim() || apptTypesSaving}>{i18n.t.actions.add}</Button>
						<Button size="sm" variant="outline" onclick={() => (showAddApptType = false)}>{i18n.t.actions.cancel}</Button>
					</div>
				</div>
			{/if}

			<div class="flex flex-col divide-y divide-border">
				{#each appointmentTypes.list as t}
					<div class="flex items-center gap-3 py-2">
						<span class="w-3 h-3 rounded-full shrink-0" style="background-color: {t.color}"></span>
						{#if editingApptTypeId === t.id}
							<div class="flex flex-1 items-center gap-2 flex-wrap">
								<input type="text" bind:value={editApptTypeName} class={inputClass + ' flex-1 min-w-0'} />
								<input type="text" bind:value={editApptTypeShort} placeholder="Kürzel" class={inputClass + ' w-16'} />
								<input type="number" min="5" step="5" bind:value={editApptTypeDuration} class={inputClass + ' w-16'} />
								<input type="color" bind:value={editApptTypeColor} class="h-8 w-10 rounded border border-border cursor-pointer" />
								<Button size="sm" onclick={() => saveEditApptType(t.id)} disabled={apptTypesSaving}>{i18n.t.actions.save}</Button>
								<Button size="sm" variant="outline" onclick={() => (editingApptTypeId = null)}>{i18n.t.actions.cancel}</Button>
							</div>
						{:else}
							<span class="flex-1 text-sm font-medium">{t.name}</span>
							<span class="text-xs text-muted-foreground">{t.default_duration_min} min</span>
							{#if t.short_name}
								<span class="text-xs text-muted-foreground">{t.short_name}</span>
							{/if}
							<button class="text-xs text-muted-foreground hover:text-foreground" onclick={() => startEditApptType(t)}>{i18n.t.actions.edit}</button>
							<button class="text-xs text-destructive hover:text-destructive/80" onclick={() => handleDeleteApptType(t.id)}>{i18n.t.actions.delete}</button>
						{/if}
					</div>
				{/each}
			</div>
		</div>
	</section>

	{/if}

	{#if activeSection === 'patients'}
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.settings.sections.patientManagement}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.settings.patientManagement.description}</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-4 flex flex-col gap-3">
			{#if !patientMgmtLoaded}
				<Button size="sm" variant="outline" onclick={loadAllPatients}>
					{i18n.t.settings.patientManagement.title}
				</Button>
			{:else}
				<!-- Search -->
				<input
					type="text"
					placeholder={i18n.t.settings.patientManagement.search}
					class="border border-border rounded px-2 py-1.5 text-sm bg-background w-full outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
					bind:value={patientSearch}
				/>

				<!-- Toolbar -->
				<div class="flex items-center gap-2 flex-wrap">
					<button
						class="text-xs text-muted-foreground hover:text-foreground underline"
						onclick={toggleSelectAll}
					>
						{selectedPatientIds.size === allPatients.length && allPatients.length > 0
							? i18n.t.settings.patientManagement.deselectAll
							: i18n.t.settings.patientManagement.selectAll}
					</button>
					<span class="text-xs text-muted-foreground">{selectedPatientIds.size} / {allPatients.length}</span>
					{#if selectedPatientIds.size > 0}
						<Button
							size="sm"
							variant="destructive"
							class="ml-auto h-7 text-xs"
							onclick={() => showDeletePatientsConfirm = true}
							disabled={isDeletingPatients}
						>
							{i18n.t.settings.patientManagement.deleteSelected} ({selectedPatientIds.size})
						</Button>
					{/if}
				</div>

				{#if allPatients.length === 0}
					<p class="text-sm text-muted-foreground">{i18n.t.settings.patientManagement.noPatients}</p>
				{:else if filteredPatients().length === 0}
					<p class="text-sm text-muted-foreground">{i18n.t.settings.patientManagement.noResults}</p>
				{:else}
					<div class="flex flex-col divide-y divide-border max-h-80 overflow-y-auto rounded border">
						{#each filteredPatients() as patient}
							<label class="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors">
								<input
									type="checkbox"
									class="accent-primary"
									checked={selectedPatientIds.has(patient.patient_id)}
									onchange={() => togglePatientSelection(patient.patient_id)}
								/>
								<span class="text-sm flex-1">{patient.lastname}, {patient.firstname}</span>
								{#if patient.dob}
									<span class="text-xs text-muted-foreground">{formatDate(patient.dob)}</span>
								{/if}
								<span class="text-[10px] px-1.5 py-0.5 rounded-full border {
									patient.status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400' :
									patient.status === 'deceased' ? 'bg-zinc-800 text-zinc-200 border-zinc-700' :
									'bg-zinc-100 text-zinc-500 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400'
								}">{patient.status}</span>
							</label>
						{/each}
					</div>
				{/if}

				{#if deletePatientsMsg}
					<p class="text-xs text-emerald-600 dark:text-emerald-400">{deletePatientsMsg}</p>
				{/if}

				<!-- Confirm delete dialog -->
				{#if showDeletePatientsConfirm}
					<div class="rounded-lg border border-destructive/40 bg-destructive/5 p-3 flex flex-col gap-2">
						<p class="text-sm text-destructive">{i18n.t.settings.patientManagement.confirmDelete}</p>
						<div class="flex gap-2">
							<Button size="sm" variant="destructive" onclick={handleDeleteSelectedPatients} disabled={isDeletingPatients}>
								{isDeletingPatients ? '…' : i18n.t.settings.patientManagement.deleteSelected}
							</Button>
							<Button size="sm" variant="outline" onclick={() => showDeletePatientsConfirm = false} disabled={isDeletingPatients}>
								{i18n.t.actions.cancel}
							</Button>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</section>


	<div class="pt-6 pb-2"><Separator /></div>
	<section class="flex flex-col gap-4">
		<div>
			<h2 class="text-base font-semibold">{i18n.t.export.title}</h2>
			<p class="text-sm text-muted-foreground">{i18n.t.export.description}</p>
		</div>
		<Separator />

		<div class="rounded-lg border bg-card p-4 flex flex-col gap-4">
			<!-- Patient search -->
			<div class="flex flex-col gap-1.5">
				<label class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{i18n.t.export.selectPatient}</label>
				<div class="relative">
					<input
						type="text"
						placeholder={i18n.t.export.searchPatients}
						value={exportSearchQuery}
						oninput={(e) => handleExportSearch((e.target as HTMLInputElement).value)}
						onfocus={() => exportDropdownOpen = true}
						onblur={() => setTimeout(() => { exportDropdownOpen = false; }, 150)}
						class="border border-border rounded px-2 py-1.5 text-sm bg-background w-full outline-none focus:border-ring focus:ring-1 focus:ring-ring/50"
					/>
					{#if exportDropdownOpen && exportSearchResults.length > 0}
						<div class="absolute top-full left-0 right-0 z-10 mt-1 max-h-52 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
							{#each exportSearchResults as p}
								<button
									type="button"
									class="w-full px-3 py-2 text-sm text-left hover:bg-accent hover:text-accent-foreground transition-colors"
									onmousedown={() => {
										exportSelectedPatient = p;
										exportSearchQuery = `${p.lastname}, ${p.firstname}`;
										exportDropdownOpen = false;
										exportPath = '';
										exportError = '';
									}}
								>{p.lastname}, {p.firstname} <span class="text-xs text-muted-foreground ml-1">{p.patient_id}</span></button>
							{/each}
						</div>
					{/if}
				</div>
				{#if exportSelectedPatient}
					<p class="text-xs text-muted-foreground">
						{exportSelectedPatient.lastname}, {exportSelectedPatient.firstname} · {exportSelectedPatient.patient_id}
					</p>
				{/if}
			</div>

			<!-- Date range -->
			<div class="flex items-center gap-2">
				<div class="flex flex-col gap-0.5 flex-1">
					<label class="text-xs text-muted-foreground">{i18n.t.export.dateFrom}</label>
					<input type="date" bind:value={exportDateFrom} class="border border-border rounded px-2 py-1 text-sm bg-background outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 w-full"/>
				</div>
				<div class="flex flex-col gap-0.5 flex-1">
					<label class="text-xs text-muted-foreground">{i18n.t.export.dateTo}</label>
					<input type="date" bind:value={exportDateTo} class="border border-border rounded px-2 py-1 text-sm bg-background outline-none focus:border-ring focus:ring-1 focus:ring-ring/50 w-full"/>
				</div>
			</div>

			<!-- Export button -->
			<Button
				size="sm"
				onclick={handleSettingsExport}
				disabled={!exportSelectedPatient || exportIsRunning}
			>{exportIsRunning ? '…' : i18n.t.export.chooseFolder}</Button>

			<!-- Progress -->
			{#if exportIsRunning}
				<div class="flex flex-col gap-1">
					<div class="w-full bg-muted rounded-full h-1.5 overflow-hidden">
						<div class="h-full bg-primary transition-all duration-300" style="width: {exportProgress}%"></div>
					</div>
					<p class="text-xs text-muted-foreground">{exportProgressText}</p>
				</div>
			{/if}

			<!-- Success -->
			{#if exportPath && !exportIsRunning}
				<div class="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/20 dark:border-green-800 p-3 flex flex-col gap-2">
					<p class="text-sm text-green-800 dark:text-green-300 font-medium">{i18n.t.export.success}</p>
					<p class="text-xs text-green-700 dark:text-green-400 font-mono break-all">{exportPath}</p>
					<Button size="sm" variant="outline" onclick={() => openDocumentFile(exportPath)} class="self-start">{i18n.t.export.openFolder}</Button>
				</div>
			{/if}

			<!-- Error -->
			{#if exportError}
				<p class="text-sm text-destructive">{i18n.t.export.error} {exportError}</p>
			{/if}
		</div>
	</section>
	{/if}

		</div>
	</div>

</div>
