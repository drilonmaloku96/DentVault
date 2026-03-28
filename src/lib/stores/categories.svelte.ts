/**
 * categories.svelte.ts
 *
 * Reactive store for user-configurable document categories.
 * Built-in category labels (xray, photo, lab, referral, consent, other) are
 * looked up from i18n.t.defaults.docCategories at render time so they switch
 * language automatically. Custom categories use the stored `label` directly.
 *
 * Persisted in the `settings` table under key 'document_categories'.
 */

import { getSetting, setSetting } from '$lib/services/db';
import { i18n } from '$lib/i18n';

export interface DocCategory {
	key: string;
	label: string;
	icon: string;
	/** Disk subfolder name for this category. If absent, vault.categoryFolder(key) provides the legacy English default. */
	folder?: string;
}

const BUILTIN_KEYS = new Set(['xray', 'photo', 'lab', 'referral', 'consent', 'other']);

/** The built-in set — keys preserved for backward-compat with existing DB rows. */
export const DEFAULT_CATEGORIES: DocCategory[] = [
	{ key: 'xray',     label: 'X-Rays',        icon: '🔬' },
	{ key: 'photo',    label: 'Photos',         icon: '📸' },
	{ key: 'lab',      label: 'Lab Results',    icon: '🧪' },
	{ key: 'referral', label: 'Referrals',      icon: '📋' },
	{ key: 'consent',  label: 'Consent Forms',  icon: '📄' },
	{ key: 'other',    label: 'Other',          icon: '📁' },
];

const SETTINGS_KEY = 'document_categories';

// ── Reactive module-level state (Svelte 5 runes) ──────────────────────
let _categories = $state<DocCategory[]>(DEFAULT_CATEGORIES);
let _loaded = $state(false);

export const docCategories = {
	get list(): DocCategory[] {
		return _categories;
	},

	get loaded(): boolean {
		return _loaded;
	},

	async load(): Promise<void> {
		try {
			const raw = await getSetting(SETTINGS_KEY);
			if (raw) {
				const parsed = JSON.parse(raw) as DocCategory[];
				if (Array.isArray(parsed) && parsed.length > 0) {
					_categories = parsed;
				}
			}
		} catch {
			// Leave defaults in place
		}
		_loaded = true;
	},

	async save(categories: DocCategory[]): Promise<void> {
		await setSetting(SETTINGS_KEY, JSON.stringify(categories));
		_categories = [...categories];
	},

	/** Get the display label for a category key.
	 *  Built-in keys use i18n translation; custom keys use stored label. */
	getLabel(key: string): string {
		const cat = _categories.find((c) => c.key === key);
		if (!cat) return key;
		if (BUILTIN_KEYS.has(key)) {
			const t = i18n.t.defaults.docCategories.find(d => d.key === key);
			return t?.label ?? cat.label;
		}
		return cat.label;
	},

	getIcon(key: string): string {
		return _categories.find((c) => c.key === key)?.icon ?? '📁';
	},

	getColor(key: string): string {
		const PALETTE = [
			'bg-blue-500/15 text-blue-700 dark:text-blue-400',
			'bg-violet-500/15 text-violet-700 dark:text-violet-400',
			'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
			'bg-amber-500/15 text-amber-700 dark:text-amber-400',
			'bg-rose-500/15 text-rose-700 dark:text-rose-400',
			'bg-sky-500/15 text-sky-700 dark:text-sky-400',
			'bg-teal-500/15 text-teal-700 dark:text-teal-400',
			'bg-orange-500/15 text-orange-700 dark:text-orange-400',
			'bg-indigo-500/15 text-indigo-700 dark:text-indigo-400',
			'bg-pink-500/15 text-pink-700 dark:text-pink-400',
		];
		const idx = _categories.findIndex((c) => c.key === key);
		return PALETTE[idx >= 0 ? idx % PALETTE.length : PALETTE.length - 1];
	},
};
