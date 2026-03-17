import { invoke } from '@tauri-apps/api/core';
import { vault } from '$lib/stores/vault.svelte';
import type { AuditRecord, AuditFilters, AuditAction, AuditEntityType } from '$lib/types';

// ── Checksum chain ────────────────────────────────────────────────────────

const GENESIS_SEED = 'DENTVAULT_AUDIT_GENESIS';

// In-memory cache of the last written checksum to avoid repeated file reads
let _lastChecksum: string | null = null;

async function sha256(input: string): Promise<string> {
	const encoded = new TextEncoder().encode(input);
	const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

async function resolveLastChecksum(): Promise<string> {
	if (_lastChecksum !== null) return _lastChecksum;

	if (!vault.path) {
		// No vault: use genesis seed so we can still return a valid chain start
		return sha256(GENESIS_SEED);
	}

	try {
		const lastLine = await invoke<string>('read_last_audit_line', { vaultPath: vault.path });
		if (!lastLine.trim()) {
			return sha256(GENESIS_SEED);
		}
		const rec = JSON.parse(lastLine) as AuditRecord;
		return rec.checksum;
	} catch {
		return sha256(GENESIS_SEED);
	}
}

// ── Public API ────────────────────────────────────────────────────────────

export interface AuditInput {
	action: AuditAction;
	entity_type: AuditEntityType;
	entity_id: string;
	patient_id: string;
	patient_name: string;
	user: string;
	summary: string;
	before: Record<string, unknown> | null;
	after: Record<string, unknown> | null;
}

export async function appendAuditRecord(input: AuditInput): Promise<void> {
	if (!vault.path) return; // vault not configured — silently skip

	const rec: AuditRecord = {
		id: crypto.randomUUID(),
		timestamp: new Date().toISOString(),
		...input,
		checksum: '',
	};

	const prevChecksum = await resolveLastChecksum();

	// Compute checksum over the record content (excluding checksum field itself)
	const { checksum: _cs, ...body } = rec;
	rec.checksum = await sha256(prevChecksum + JSON.stringify(body));

	// Update in-memory cache
	_lastChecksum = rec.checksum;

	const line = JSON.stringify(rec);
	await invoke('append_audit_line', { vaultPath: vault.path, line });
}

export async function readAuditLog(filters?: AuditFilters): Promise<AuditRecord[]> {
	if (!vault.path) return [];

	let raw = '';
	try {
		raw = await invoke<string>('read_audit_log', { vaultPath: vault.path });
	} catch {
		return [];
	}

	if (!raw.trim()) return [];

	const records: AuditRecord[] = [];
	for (const line of raw.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		try {
			records.push(JSON.parse(trimmed) as AuditRecord);
		} catch {
			// skip malformed lines
		}
	}

	// Apply filters
	let result = records;

	if (filters?.patient_id) {
		result = result.filter((r) => r.patient_id === filters.patient_id);
	}
	if (filters?.entity_id) {
		result = result.filter((r) => r.entity_id === filters.entity_id);
	}
	if (filters?.action) {
		result = result.filter((r) => r.action === filters.action);
	}
	if (filters?.entity_type) {
		result = result.filter((r) => r.entity_type === filters.entity_type);
	}
	if (filters?.date_from) {
		result = result.filter((r) => r.timestamp >= filters.date_from!);
	}
	if (filters?.date_to) {
		// date_to is YYYY-MM-DD, so add T23:59:59 to include the full day
		result = result.filter((r) => r.timestamp <= filters.date_to! + 'T23:59:59Z');
	}
	if (filters?.search) {
		const q = filters.search.toLowerCase();
		result = result.filter(
			(r) =>
				r.summary.toLowerCase().includes(q) ||
				r.patient_name.toLowerCase().includes(q) ||
				r.user.toLowerCase().includes(q),
		);
	}

	// Newest first
	return result.reverse();
}

export interface IntegrityResult {
	valid: boolean;
	total: number;
	brokenAt?: number; // 0-based index of first broken record
}

export async function verifyIntegrity(): Promise<IntegrityResult> {
	if (!vault.path) return { valid: true, total: 0 };

	let raw = '';
	try {
		raw = await invoke<string>('read_audit_log', { vaultPath: vault.path });
	} catch {
		return { valid: true, total: 0 };
	}

	const lines = raw.split('\n').filter((l) => l.trim());
	if (lines.length === 0) return { valid: true, total: 0 };

	let prevChecksum = await sha256(GENESIS_SEED);

	for (let i = 0; i < lines.length; i++) {
		try {
			const rec = JSON.parse(lines[i]) as AuditRecord;
			const { checksum, ...body } = rec;
			const expected = await sha256(prevChecksum + JSON.stringify(body));
			if (expected !== checksum) {
				return { valid: false, total: lines.length, brokenAt: i };
			}
			prevChecksum = checksum;
		} catch {
			return { valid: false, total: lines.length, brokenAt: i };
		}
	}

	return { valid: true, total: lines.length };
}
