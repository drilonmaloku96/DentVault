import type { VaultFileInfo, FolderNode } from './files';

/**
 * File transport (ROADMAP_MULTI_COMPUTER.md Phase 1, §3.3) — the file-layer counterpart to
 * db-transport.ts. Covers reads (listing, bytes), VaultDropDialog's folder-tree operations,
 * and the OS-drag-drop upload path. Deliberately still NOT covering: delete, rename/move of
 * a whole patient folder, the !TEMPLATE/!Documents template systems, native "open in
 * Finder", or the Ceph/X-ray/facial-analysis image bridges — see CLAUDE.md's Multi-computer
 * section for the exact list of what's deferred and why.
 */
export interface FilesTransport {
	listFiles(patientFolder: string): Promise<VaultFileInfo[]>;
	/** Raw bytes of a vault-relative file, for display (blob URLs) — see getFileDisplayUrl. */
	getFileBytes(relPath: string): Promise<Uint8Array>;
	listFolderTree(patientFolder: string): Promise<FolderNode[]>;
	/** Returns the new folder's rel_path (relative to the patient folder). */
	createSubfolder(patientFolder: string, parentRel: string, folderName: string): Promise<string>;
	moveFolder(patientFolder: string, srcRel: string, destParentRel: string): Promise<void>;
	/** Copies a local file (srcPath — always a real local path, freshly picked/dropped) into
	 *  the vault. categoryFolder may be a nested rel path (e.g. "xrays/2023"). */
	saveDocumentFile(opts: {
		srcPath: string;
		patientFolder: string;
		categoryFolder: string;
		destFilename: string;
	}): Promise<{ absPath: string; relPath: string; fileSize: number }>;
}
