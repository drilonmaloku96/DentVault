import { invoke } from '@tauri-apps/api/core';
import { createLocalFilesTransport } from './files-local';
import { remoteFilesTransport, resetRemoteFilesConnection } from './files-remote';
import type { FilesTransport } from './files-transport';

/**
 * Picks solo vs. connected file transport, mirroring db-connection.ts. `vaultPath` is
 * still passed by every existing files.ts caller (unchanged signatures) but is only used
 * by the local transport — the server already knows its own vault root.
 */

type Mode = 'local' | 'remote';
let mode: Mode | null = null;

async function resolveMode(): Promise<Mode> {
	if (mode === null) {
		const conn = await invoke<{ url: string; token: string } | null>('get_server_connection');
		mode = conn ? 'remote' : 'local';
	}
	return mode;
}

export async function getFilesTransport(vaultPath: string): Promise<FilesTransport> {
	return (await resolveMode()) === 'remote' ? remoteFilesTransport : createLocalFilesTransport(vaultPath);
}

export async function isConnectedFilesMode(): Promise<boolean> {
	return (await resolveMode()) === 'remote';
}

/** Call after vault OR server-connection configuration changes to force a re-check. */
export function resetFilesConnection(): void {
	mode = null;
	resetRemoteFilesConnection();
}
