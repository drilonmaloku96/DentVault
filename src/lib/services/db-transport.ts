/**
 * The transport contract db-core.ts's data functions are written against.
 * Solo mode implements this in db-local.ts (tauri-plugin-sql, local file).
 * Connected mode (Phase 1, ROADMAP_MULTI_COMPUTER.md) will add db-remote.ts,
 * implementing the same shape over HTTP — db-core.ts does not change.
 */
export interface DataTransport {
	select<T>(query: string, bindValues?: unknown[]): Promise<T>;
	execute(query: string, bindValues?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
}
