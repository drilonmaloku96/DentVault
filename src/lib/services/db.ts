// Barrel: keeps `$lib/services/db` as the stable import path while the implementation is
// split by transport-readiness (ROADMAP_MULTI_COMPUTER.md). db-local.ts (schema/migrations/
// solo-mode connection) and db-core.ts (the data functions, written against the
// DataTransport interface) split in Phase 0; getDb/resetDb now come from db-connection.ts,
// which picks solo (db-local) vs. connected (db-remote) transport at startup (Phase 1) —
// named re-exports here (not `export *` for db-local) avoid a getDb/resetDb name collision
// between db-local.ts and db-connection.ts.
export { isValidEntryTooth, syncEntryTeeth } from './db-local';
export { getDb, resetDb, isConnectedMode } from './db-connection';
export * from './db-core';
