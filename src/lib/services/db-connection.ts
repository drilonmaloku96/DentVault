import { invoke } from '@tauri-apps/api/core';
import { getDb as getLocalDb, resetDb as resetLocalDb } from './db-local';
import { getDbRemote, resetRemoteConnection } from './db-remote';
import { resetFilesConnection } from './files-connection';
import type { DataTransport } from './db-transport';

/**
 * Picks solo (local SQLite) vs. connected (HTTP to dentvault-server) transport at startup
 * (ROADMAP_MULTI_COMPUTER.md Phase 1, §3.2). This is the ONLY place db-core.ts's getDb()
 * import should come from — db-local.ts and db-remote.ts stay implementation details.
 *
 * Mode is derived from whether a server connection is configured (server_connection.json
 * in app_data_dir, written by the connect screen) — solo mode and connected mode are
 * mutually exclusive per app instance, matching the Rust-side invariant in lib.rs.
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

export async function getDb(): Promise<DataTransport> {
	return (await resolveMode()) === 'remote' ? getDbRemote() : getLocalDb();
}

/** Call after vault OR server-connection configuration changes to force a reconnect.
 *  Also resets the files transport (files-connection.ts) — both track the same
 *  local-vs-connected mode and must never drift out of sync with each other. */
export function resetDb(): void {
	mode = null;
	resetLocalDb();
	resetRemoteConnection();
	resetFilesConnection();
}

export async function isConnectedMode(): Promise<boolean> {
	return (await resolveMode()) === 'remote';
}
