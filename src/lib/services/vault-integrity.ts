import { invoke } from '@tauri-apps/api/core';
import { getDb } from './db';
import { toAbsPath } from './files';

export interface IntegrityResult {
	total: number;
	missing: number;
	missingFiles: { id: number; rel_path: string; patient_id: string }[];
}

/**
 * Verify that every document in the database has a corresponding file on disk.
 * Resolves rel_path (or abs_path fallback) against the current vault location.
 * Returns a summary of total documents and any missing files.
 */
export async function reconcileVaultIntegrity(vaultPath: string): Promise<IntegrityResult> {
	const conn = await getDb();
	const docs = await conn.select<{ id: number; rel_path: string; abs_path: string; patient_id: string }[]>(
		'SELECT id, rel_path, abs_path, patient_id FROM documents',
		[],
	);

	const missing: { id: number; rel_path: string; patient_id: string }[] = [];

	for (const doc of docs) {
		const relPath = doc.rel_path || doc.abs_path;
		const fullPath = toAbsPath(relPath, vaultPath);
		const exists = await invoke<boolean>('file_exists', { path: fullPath });
		if (!exists) {
			missing.push({ id: doc.id, rel_path: relPath, patient_id: doc.patient_id });
		}
	}

	return { total: docs.length, missing: missing.length, missingFiles: missing };
}
