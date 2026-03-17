/**
 * staffRoles.svelte.ts
 *
 * Reactive store for user-configurable staff roles.
 * Built-in roles ('doctor', 'nurse') have their labels looked up from
 * i18n.t.defaults.staffRoles so they switch language automatically.
 * Custom roles use the stored `label` directly.
 *
 * Persisted in the `settings` table under key 'staff_roles'.
 */

import { getSetting, setSetting } from '$lib/services/db';
import { i18n } from '$lib/i18n';

export interface StaffRole {
	key: string;
	label: string;
	prefix: string;
}

const BUILTIN_ROLE_KEYS = new Set(['doctor', 'nurse']);

export const DEFAULT_ROLES: StaffRole[] = [
	{ key: 'doctor', label: 'Doctor',         prefix: 'Dr.' },
	{ key: 'nurse',  label: 'Nurse / Sister', prefix: ''    },
];

const SETTINGS_KEY = 'staff_roles';

const BADGE_PALETTE = [
	'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
	'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
	'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
	'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300',
	'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
	'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
	'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
	'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
];

let _roles  = $state<StaffRole[]>(DEFAULT_ROLES);
let _loaded = $state(false);

export const staffRoles = {
	get list(): StaffRole[] { return _roles; },
	get loaded(): boolean   { return _loaded; },

	async load(): Promise<void> {
		try {
			const raw = await getSetting(SETTINGS_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as StaffRole[];
				if (Array.isArray(parsed) && parsed.length > 0) {
					_roles = parsed;
				}
			}
		} catch {
			// Leave defaults in place
		}
		_loaded = true;
	},

	async save(roles: StaffRole[]): Promise<void> {
		await setSetting(SETTINGS_KEY, JSON.stringify(roles));
		_roles = [...roles];
	},

	get(key: string): StaffRole | undefined {
		return _roles.find(r => r.key === key);
	},

	/** Display label — i18n for built-in keys, stored label for custom roles. */
	getLabel(key: string): string {
		const role = _roles.find(r => r.key === key);
		if (!role) return key;
		if (BUILTIN_ROLE_KEYS.has(key)) {
			const t = i18n.t.defaults.staffRoles.find(r => r.key === key);
			return t?.label ?? role.label;
		}
		return role.label;
	},

	getBadgeClass(key: string): string {
		const idx = _roles.findIndex(r => r.key === key);
		return BADGE_PALETTE[idx >= 0 ? idx % BADGE_PALETTE.length : 0];
	},
};
