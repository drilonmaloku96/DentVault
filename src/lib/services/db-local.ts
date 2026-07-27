import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import type { DataTransport } from './db-transport';
import schemaStatements from '../../../shared/schema-statements.json';

// ── Solo-mode data transport: local SQLite via tauri-plugin-sql ────────
// Connected mode (Phase 1) adds db-remote.ts implementing the same
// DataTransport shape over HTTP; db-core.ts's 158 functions never change.
//
// The migration DDL itself lives in shared/schema-statements.json, not inline here —
// dentvault-server (Rust) reads the exact same file, so solo mode and connected mode
// apply byte-identical migrations. NEVER edit schema-statements.json by hand or modify
// an existing entry; append a new {version, sql} entry for new migrations (see the
// Migrations rule in CLAUDE.md — this file replaces the old inline SCHEMA_STATEMENTS
// array as the append target).
const SCHEMA_STATEMENTS: { version: number; sql: string }[] = schemaStatements.statements;
const LATEST_VERSION = schemaStatements.latestVersion;


async function runMigrations(conn: Database): Promise<void> {
	// Create the version tracking table
	await conn.execute(
		`CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY)`,
		[],
	);

	// Check if we're working on an already-migrated DB (from old Rust migration system)
	const versionRows = await conn.select<{ version: number }[]>(
		`SELECT COALESCE(MAX(version), 0) AS version FROM _schema_version`,
		[],
	);
	let current = versionRows[0]?.version ?? 0;

	if (current === 0) {
		// Check if tables already exist (DB created by old Rust migration system)
		const tableRows = await conn.select<{ name: string }[]>(
			`SELECT name FROM sqlite_master WHERE type='table' AND name='patients'`,
			[],
		);
		if (tableRows.length > 0) {
			// Existing DB — mark all migrations as applied and return
			await conn.execute(
				`INSERT OR REPLACE INTO _schema_version (version) VALUES ($1)`,
				[LATEST_VERSION],
			);
			return;
		}
	}

	// Apply any missing DDL statements
	const versionsApplied = new Set<number>();
	for (const stmt of SCHEMA_STATEMENTS) {
		if (stmt.version > current) {
			try {
				await conn.execute(stmt.sql, []);
			} catch (e) {
				// ALTER TABLE ADD COLUMN throws "duplicate column name" if column already exists — safe to ignore
				const msg = String(e).toLowerCase();
				if (!msg.includes('duplicate column') && !msg.includes('already exists')) throw e;
			}
			versionsApplied.add(stmt.version);
		}
	}

	// Bump schema version to the highest applied
	if (versionsApplied.size > 0) {
		const maxApplied = Math.max(...versionsApplied);
		await conn.execute(
			`INSERT OR REPLACE INTO _schema_version (version) VALUES ($1)`,
			[maxApplied],
		);
	}

	// ── v13 data migration: convert abs_path → rel_path ──
	// Runs if rel_path column exists but hasn't been populated yet
	if (versionsApplied.has(13) || current < 13) {
		await migrateAbsToRelPaths(conn);
	}

	// ── v23 data migration: backfill entry_teeth from existing tooth_numbers ──
	// ── v59 re-runs the backfill: the original sync filtered teeth to 1–32,
	//    silently dropping FDI numbers 33–48 and primary teeth 51–85. ──
	if (versionsApplied.has(23) || versionsApplied.has(59) || current < 23) {
		await migrateEntryTeeth(conn);
	}

	// ── v66 data migration: normalize legacy Universal tooth references to FDI ──
	if (versionsApplied.has(66) || current < 66) {
		await migrateUniversalTeethToFDI(conn);
	}
}

/**
 * One-time data migration: populate rel_path from abs_path on documents
 * and convert timeline_entries.attachments paths from absolute to relative.
 */
async function migrateAbsToRelPaths(conn: Database): Promise<void> {
	// Get vault path from Rust
	const vaultPath = await invoke<string | null>('get_vault_path');
	if (!vaultPath) return; // no vault configured yet — nothing to migrate

	const vaultNorm = vaultPath.replace(/\\/g, '/').replace(/\/$/, '');

	function stripVault(absPath: string): string {
		const norm = absPath.replace(/\\/g, '/');
		if (norm.startsWith(vaultNorm + '/')) {
			return norm.slice(vaultNorm.length + 1);
		}
		return norm; // can't determine — keep as-is
	}

	// 1. Populate rel_path on documents where it's empty
	const docs = await conn.select<{ id: number; abs_path: string; rel_path: string }[]>(
		`SELECT id, abs_path, rel_path FROM documents WHERE rel_path = '' AND abs_path != ''`,
		[],
	);
	for (const doc of docs) {
		const rel = stripVault(doc.abs_path);
		await conn.execute('UPDATE documents SET rel_path = $1 WHERE id = $2', [rel, doc.id]);
	}

	// 2. Convert timeline_entries.attachments paths from absolute to relative
	const entries = await conn.select<{ id: number; attachments: string }[]>(
		`SELECT id, attachments FROM timeline_entries WHERE attachments != '' AND attachments != '[]'`,
		[],
	);
	for (const entry of entries) {
		try {
			const parsed = JSON.parse(entry.attachments);
			if (!Array.isArray(parsed)) continue;
			let changed = false;
			for (const att of parsed) {
				if (att.path && (att.path.startsWith('/') || /^[A-Za-z]:/.test(att.path))) {
					att.path = stripVault(att.path);
					changed = true;
				}
			}
			if (changed) {
				await conn.execute(
					'UPDATE timeline_entries SET attachments = $1 WHERE id = $2',
					[JSON.stringify(parsed), entry.id],
				);
			}
		} catch {
			// malformed JSON — skip
		}
	}
}

// ── Entry-teeth sync helper ────────────────────────────────────────────

/**
 * Valid tooth identifiers for entry_teeth — FDI (quadrant/tooth) notation only:
 * - FDI permanent: 11–18, 21–28, 31–38, 41–48 (e.g. 14 = quadrant 1, tooth 4)
 * - FDI primary:   51–55, 61–65, 71–75, 81–85
 */
export function isValidEntryTooth(n: number): boolean {
	if (!Number.isInteger(n)) return false;
	const q = Math.floor(n / 10);
	const p = n % 10;
	if (q >= 1 && q <= 4) return p >= 1 && p <= 8; // FDI permanent
	if (q >= 5 && q <= 8) return p >= 1 && p <= 5; // FDI primary
	return false;
}

export async function syncEntryTeeth(conn: DataTransport, entryId: number, toothNumbers: string): Promise<void> {
	await conn.execute('DELETE FROM entry_teeth WHERE entry_id = $1', [entryId]);
	if (!toothNumbers) return;
	const teeth = toothNumbers.split(',').map(t => parseInt(t.trim(), 10)).filter(n => !isNaN(n) && isValidEntryTooth(n));
	for (const tooth of teeth) {
		await conn.execute('INSERT OR IGNORE INTO entry_teeth (entry_id, tooth_number) VALUES ($1, $2)', [entryId, tooth]);
	}
}

async function migrateEntryTeeth(conn: Database): Promise<void> {
	const rows = await conn.select<{ id: number; tooth_numbers: string }[]>(
		`SELECT id, tooth_numbers FROM timeline_entries WHERE tooth_numbers != '' AND tooth_numbers IS NOT NULL`,
	);
	for (const row of rows) {
		await syncEntryTeeth(conn, row.id, row.tooth_numbers);
	}
}

// Universal 1–10 → FDI. Only 1–10 can be converted unambiguously: they are
// invalid as FDI, so they must be legacy Universal. Values 11–32 are valid FDI
// and are treated as such from v66 on.
const V66_UNIVERSAL_TO_FDI: Record<number, number> = {
	1: 18, 2: 17, 3: 16, 4: 15, 5: 14, 6: 13, 7: 12, 8: 11, 9: 21, 10: 22,
};

/**
 * v66 data migration: normalize timeline_entries.tooth_numbers to FDI-only.
 * Converts unambiguous legacy Universal tokens (1–10), drops anything that is
 * not a valid FDI number, and re-syncs entry_teeth for changed rows.
 */
async function migrateUniversalTeethToFDI(conn: Database): Promise<void> {
	const rows = await conn.select<{ id: number; tooth_numbers: string }[]>(
		`SELECT id, tooth_numbers FROM timeline_entries WHERE tooth_numbers != '' AND tooth_numbers IS NOT NULL`,
	);
	for (const row of rows) {
		const tokens = row.tooth_numbers
			.split(',')
			.map((t) => parseInt(t.trim(), 10))
			.filter((n) => !isNaN(n));
		const fdi = [...new Set(tokens.map((n) => V66_UNIVERSAL_TO_FDI[n] ?? n))]
			.filter(isValidEntryTooth)
			.sort((a, b) => a - b);
		const normalized = fdi.join(', ');
		if (normalized !== row.tooth_numbers) {
			await conn.execute('UPDATE timeline_entries SET tooth_numbers = $1 WHERE id = $2', [
				normalized,
				row.id,
			]);
			await syncEntryTeeth(conn, row.id, normalized);
		}
	}
}

// ── DB singleton ───────────────────────────────────────────────────────

let db: Database | null = null;

/** Call this after vault configuration changes to force reconnect. */
export function resetDb(): void {
	db = null;
}

export async function getDb(): Promise<DataTransport> {
	if (!db) {
		const url = await invoke<string>('get_db_url');
		const conn = await Database.load(url);
		// Cache the handle only after migrations succeed — assigning `db` first
		// meant a failing migration was thrown once, then every later call got
		// the unmigrated DB and migrations were never retried (this is how the
		// broken v65 silently froze production vaults at schema v64).
		await runMigrations(conn);
		db = conn;
	}
	return db;
}
