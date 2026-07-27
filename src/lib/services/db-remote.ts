import { invoke } from '@tauri-apps/api/core';
import type { DataTransport } from './db-transport';

/**
 * Connected-mode data transport (ROADMAP_MULTI_COMPUTER.md Phase 1) — implements the same
 * DataTransport shape as db-local.ts, but over HTTP against dentvault-server's POST /rpc
 * (Shape 1: SQL pass-through). db-core.ts's 158 functions do not know or care which
 * transport is active; db-connection.ts picks this vs. db-local.ts at startup.
 */

export interface ServerConnection {
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

/** Call this after connection settings change to force a reconnect (mirrors db-local's resetDb). */
export function resetRemoteConnection(): void {
	cached = null;
}

async function rpc<T>(sql: string, params: unknown[] = []): Promise<T> {
	const { url, token } = await getConnection();
	let res: Response;
	try {
		res = await fetch(`${url.replace(/\/$/, '')}/rpc`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ sql, params }),
		});
	} catch {
		throw new Error(`Could not reach the DentVault server at ${url}. Check the clinic network and that the server is running.`);
	}
	if (!res.ok) {
		const body = await res.json().catch(() => ({ error: res.statusText }));
		throw new Error(body.error || `Server error (${res.status})`);
	}
	return res.json() as Promise<T>;
}

const remoteTransport: DataTransport = {
	select<T>(query: string, bindValues: unknown[] = []): Promise<T> {
		return rpc<T>(query, bindValues);
	},
	execute(query: string, bindValues: unknown[] = []) {
		return rpc<{ rowsAffected: number; lastInsertId?: number }>(query, bindValues);
	},
};

/** Returns the shared remote transport, throwing if connected mode isn't configured. */
export async function getDbRemote(): Promise<DataTransport> {
	await getConnection();
	return remoteTransport;
}
