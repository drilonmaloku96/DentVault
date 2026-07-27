import { invoke } from '@tauri-apps/api/core';
import type { FilesTransport } from './files-transport';
import type { VaultFileInfo, FolderNode } from './files';
import { toAbsPath } from './files';

/** Solo-mode file transport — the existing Tauri commands, unchanged. */
export function createLocalFilesTransport(vaultPath: string): FilesTransport {
	return {
		async listFiles(patientFolder: string): Promise<VaultFileInfo[]> {
			return invoke<VaultFileInfo[]>('list_vault_files', { vaultPath, patientFolder });
		},
		async getFileBytes(relPath: string): Promise<Uint8Array> {
			const absPath = toAbsPath(relPath, vaultPath);
			const base64 = await invoke<string>('read_base64_file', { path: absPath });
			const binary = atob(base64);
			const bytes = new Uint8Array(binary.length);
			for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
			return bytes;
		},
		async listFolderTree(patientFolder: string): Promise<FolderNode[]> {
			return invoke<FolderNode[]>('list_patient_folders', { vaultPath, patientFolder });
		},
		async createSubfolder(patientFolder: string, parentRel: string, folderName: string): Promise<string> {
			return invoke<string>('create_patient_subfolder', { vaultPath, patientFolder, parentRel, folderName });
		},
		async moveFolder(patientFolder: string, srcRel: string, destParentRel: string): Promise<void> {
			await invoke<void>('move_patient_folder', { vaultPath, patientFolder, srcRel, destParentRel });
		},
		async saveDocumentFile(opts): Promise<{ absPath: string; relPath: string; fileSize: number }> {
			const [absPath, relPath, fileSize] = await invoke<[string, string, number]>('save_document_file', {
				srcPath: opts.srcPath,
				vaultPath,
				patientFolder: opts.patientFolder,
				categoryFolder: opts.categoryFolder,
				destFilename: opts.destFilename,
			});
			return { absPath, relPath, fileSize };
		},
	};
}
