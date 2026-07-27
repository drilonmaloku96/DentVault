import { invoke } from '@tauri-apps/api/core';

/**
 * Connected-mode configuration (ROADMAP_MULTI_COMPUTER.md Phase 1). Mirrors vault.svelte.ts's
 * shape/pattern but for a server URL + token instead of a local folder path. Persisted via
 * the Rust get/save/clear_server_connection commands (server_connection.json in app_data_dir).
 *
 * Deliberately NOT wired into +layout.svelte's onboarding gate yet — that gate and dozens
 * of components assume `vault.path` is a real local filesystem path (file listing, thumbnails,
 * drag-drop, exports...). Wiring connected mode into first-run onboarding requires routing
 * all of that file-layer logic over HTTP first (dentvault-server's /files/* endpoints exist,
 * but no client call site uses them yet) — that's the next slice of Phase 1, not this one.
 * For now this only switches the DB/RPC transport (db-connection.ts) — appointments, patient
 * records, timeline entries, settings, etc. all work end-to-end over the network; document/
 * X-ray/photo file access still requires the vault folder to be locally reachable.
 */

let _url = $state<string | null>(null);
let _initialized = $state(false);

export const serverConnection = {
	get url(): string | null {
		return _url;
	},
	get isConnected(): boolean {
		return !!_url;
	},
	get initialized(): boolean {
		return _initialized;
	},

	async init(): Promise<void> {
		const conn = await invoke<{ url: string; token: string } | null>('get_server_connection');
		_url = conn?.url ?? null;
		_initialized = true;
	},

	/** Tests the connection (a harmless SELECT over /rpc) before persisting — a bad URL/token
	 *  never gets saved. Throws with a user-facing message on failure. */
	async configure(url: string, token: string): Promise<void> {
		const normalized = url.trim().replace(/\/$/, '');
		let res: Response;
		try {
			res = await fetch(`${normalized}/rpc`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ sql: 'SELECT 1', params: [] }),
			});
		} catch {
			throw new Error(`Could not reach ${normalized}. Check the URL and that the server is running.`);
		}
		if (res.status === 401) throw new Error('Server rejected the token — check it matches the server\'s printed token.');
		if (!res.ok) throw new Error(`Server responded with an error (${res.status}).`);

		await invoke('save_server_connection', { url: normalized, token });
		_url = normalized;
	},

	async disconnect(): Promise<void> {
		await invoke('clear_server_connection');
		_url = null;
	},
};
