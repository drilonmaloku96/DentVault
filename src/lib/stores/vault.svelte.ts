import { invoke } from '@tauri-apps/api/core';
import { docCategories } from './categories.svelte';

let _vaultPath = $state<string | null>(null);
let _initialized = $state(false);

export const vault = {
	/** Absolute path to the vault folder, or null if not yet configured. */
	get path(): string | null {
		return _vaultPath;
	},

	/** True once `init()` has completed (whether or not vault is configured). */
	get initialized(): boolean {
		return _initialized;
	},

	/** True if the vault folder has been chosen by the user. */
	get isConfigured(): boolean {
		return !!_vaultPath;
	},

	/** Read the stored vault path from the Rust side. Call once at app start.
	 *  If the stored path no longer exists on disk, treats the vault as unconfigured. */
	async init(): Promise<void> {
		const path = await invoke<string | null>('get_vault_path');
		if (path) {
			const exists = await invoke<boolean>('file_exists', { path });
			_vaultPath = exists ? path : null;
		} else {
			_vaultPath = null;
		}
		_initialized = true;
	},

	/**
	 * Save a new vault path (called after user picks a folder).
	 * Persists to disk and updates the in-memory state.
	 *
	 * Refuses network-mounted paths (SMB/NFS/AFP/CIFS/WebDAV) — SQLite's file locking is
	 * broken over network shares and silently corrupts dentvault.db under concurrent writers.
	 * See ROADMAP_MULTI_COMPUTER.md, "Option A — REJECTED".
	 */
	async configure(folderPath: string): Promise<void> {
		if (await vault.isNetworkMount(folderPath)) {
			throw new Error(
				'This folder is on a network drive (SMB/NFS/network share). DentVault cannot ' +
				'use a network-mounted vault — SQLite database corruption is a real risk on shared ' +
				'drives. Choose a folder on this computer\'s local disk instead.',
			);
		}
		await invoke('save_vault_path', { path: folderPath });
		_vaultPath = folderPath;
	},

	/** True if `folderPath` resides on a network-mounted filesystem. Best-effort: a detection
	 *  failure (missing tool, unexpected `mount` output) returns false rather than blocking. */
	async isNetworkMount(folderPath: string): Promise<boolean> {
		return invoke<boolean>('is_network_mount', { path: folderPath });
	},

	/**
	 * Compute a deterministic patient folder name.
	 * Format: Lastname_Firstname_PatientID  (special chars replaced with _)
	 */
	patientFolder(lastname: string, firstname: string, patientId: string): string {
		const safe = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
		return `${safe(lastname)}_${safe(firstname)}_${patientId}`;
	},

	/**
	 * Map a document category key to its vault subfolder name.
	 *
	 * Checks the docCategories store first (which stores localized folder names set
	 * during onboarding). Falls back to the legacy English map for vaults created
	 * before multi-language folder support, or before the store is loaded.
	 */
	categoryFolder(category: string): string {
		// Stored folder name takes priority (set during onboarding with language-aware name)
		const stored = docCategories.list.find(c => c.key === category);
		if (stored?.folder) return stored.folder;
		// Legacy English fallback — keeps existing vaults working unchanged
		const builtinMap: Record<string, string> = {
			xray:     'xrays',
			photo:    'photos',
			lab:      'lab_results',
			referral: 'referrals',
			consent:  'consents',
			other:    'documents',
		};
		return builtinMap[category] ?? category;
	},
};
