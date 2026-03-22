/**
 * entryTypes.svelte.ts
 *
 * Thin derived view over appointmentTypes.
 * Timeline entry type options and appointment type options are the same list —
 * managed in one place (Settings › Entry & Appointment Types).
 *
 * Legacy built-in keys (visit, procedure, note, lab, imaging, referral) are
 * kept as fallback labels for old entries already stored in the DB.
 */

import { appointmentTypes } from '$lib/stores/appointmentTypes.svelte';

export interface EntryTypeConfig {
	key: string;
	label: string;
	icon: string;
	color?: string;
}

/** Fallback labels for legacy entry_type values stored before the merge */
const LEGACY_LABELS: Record<string, { label: string; icon: string }> = {
	visit:     { label: 'Visit',     icon: '🏥' },
	procedure: { label: 'Procedure', icon: '🔧' },
	note:      { label: 'Note',      icon: '📝' },
	lab:       { label: 'Lab',       icon: '🧪' },
	imaging:   { label: 'Imaging',   icon: '📷' },
	referral:  { label: 'Referral',  icon: '📋' },
};

export const entryTypes = {
	/** All active appointment types as entry type options */
	get list(): EntryTypeConfig[] {
		return appointmentTypes.active.map(t => ({
			key:   t.name,
			label: t.name,
			icon:  t.short_name,
			color: t.color,
		}));
	},

	get loaded(): boolean {
		return appointmentTypes.list.length > 0;
	},

	/** Label for a given entry_type value (handles legacy keys + appointment type names) */
	labelFor(key: string): string {
		const appt = appointmentTypes.active.find(t => t.name === key);
		if (appt) return appt.name;
		return LEGACY_LABELS[key]?.label ?? key;
	},

	/** Icon/short text for a given entry_type value */
	iconFor(key: string): string {
		const appt = appointmentTypes.active.find(t => t.name === key);
		if (appt) return appt.short_name;
		return LEGACY_LABELS[key]?.icon ?? '📌';
	},

	/** Color hex for a given entry_type value (undefined for legacy keys) */
	colorFor(key: string): string | undefined {
		return appointmentTypes.active.find(t => t.name === key)?.color;
	},

	/** No-op — appointmentTypes.load() handles loading */
	async load(): Promise<void> {},
};

// Keep for Settings page: built-in keys that existed before the merge
export const BUILTIN_ENTRY_TYPE_KEYS = new Set(Object.keys(LEGACY_LABELS));
