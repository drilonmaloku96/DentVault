/**
 * entryTypes.svelte.ts
 *
 * Thin derived view over appointmentTypes.
 * Timeline entry type options and appointment type options are the same list —
 * managed in one place (Settings › Entry & Appointment Types).
 */

import { appointmentTypes } from '$lib/stores/appointmentTypes.svelte';

export interface EntryTypeConfig {
	key: string;
	label: string;
	icon: string;
	color?: string;
}

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

	/** Label for a given entry_type value (appointment type names; raw key as fallback) */
	labelFor(key: string): string {
		return appointmentTypes.active.find(t => t.name === key)?.name ?? key;
	},

	/** Icon/short text for a given entry_type value */
	iconFor(key: string): string {
		return appointmentTypes.active.find(t => t.name === key)?.short_name ?? '📌';
	},

	/** Color hex for a given entry_type value (undefined for unknown keys) */
	colorFor(key: string): string | undefined {
		return appointmentTypes.active.find(t => t.name === key)?.color;
	},

	/** No-op — appointmentTypes.load() handles loading */
	async load(): Promise<void> {},
};
