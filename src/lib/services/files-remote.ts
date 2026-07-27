import { invoke } from '@tauri-apps/api/core';
import type { FilesTransport } from './files-transport';
import type { VaultFileInfo, FolderNode } from './files';

interface ServerConnection {
	url: string;
	token: string;
}

let cached: ServerConnection | null = null;

async function getConnection(): Promise<ServerConnection> {
	if (!cached) {
		const conn = await invoke<ServerConnection | null>('get_server_connection');
		if (!conn) throw new Error('Not connected to a DentVault server.');
		cached = conn;
	}
	return cached;
}

export function resetRemoteFilesConnection(): void {
	cached = null;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
	const { url, token } = await getConnection();
	const res = await fetch(`${url}${path}`, {
		...init,
		headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
	});
	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error(body.error || `Request failed (${res.status})`);
	}
	return res;
}

/** relPath segments must each be encoded individually — encoding the whole string would
 *  also encode the '/' separators the route depends on. */
function encodeRelPath(relPath: string): string {
	return relPath.split('/').map(encodeURIComponent).join('/');
}

/** Connected-mode file transport — dentvault-server's /files/* endpoints (§3.3). */
export const remoteFilesTransport: FilesTransport = {
	async listFiles(patientFolder: string): Promise<VaultFileInfo[]> {
		const res = await authedFetch(`/files/list/${encodeRelPath(patientFolder)}`);
		return res.json();
	},

	async getFileBytes(relPath: string): Promise<Uint8Array> {
		const res = await authedFetch(`/files/raw/${encodeRelPath(relPath)}`);
		return new Uint8Array(await res.arrayBuffer());
	},

	async listFolderTree(patientFolder: string): Promise<FolderNode[]> {
		const res = await authedFetch(`/files/tree/${encodeRelPath(patientFolder)}`);
		return res.json();
	},

	async createSubfolder(patientFolder: string, parentRel: string, folderName: string): Promise<string> {
		const res = await authedFetch('/files/subfolder', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ patient_folder: patientFolder, parent_rel: parentRel, folder_name: folderName }),
		});
		const data = await res.json();
		return data.rel_path;
	},

	async moveFolder(patientFolder: string, srcRel: string, destParentRel: string): Promise<void> {
		await authedFetch('/files/move-folder', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ patient_folder: patientFolder, src_rel: srcRel, dest_parent_rel: destParentRel }),
		});
	},

	async saveDocumentFile(opts): Promise<{ absPath: string; relPath: string; fileSize: number }> {
		// The local file being uploaded is always a real local path (freshly picked/dropped
		// on this workstation) — read its bytes via the existing Tauri command, then POST
		// them to the server. No local absolute path exists for the result, so absPath is ''.
		const base64 = await invoke<string>('read_base64_file', { path: opts.srcPath });
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

		const form = new FormData();
		form.append('patient_folder', opts.patientFolder);
		form.append('category_folder', opts.categoryFolder);
		form.append('filename', opts.destFilename);
		form.append('file', new Blob([bytes]), opts.destFilename);

		const res = await authedFetch('/files/upload', { method: 'POST', body: form });
		const data = await res.json();
		return { absPath: '', relPath: data.relPath, fileSize: data.fileSize };
	},
};
