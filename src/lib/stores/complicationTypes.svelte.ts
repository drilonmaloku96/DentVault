/**
 * complicationTypes.svelte.ts
 *
 * Reactive store for the configurable complication type list.
 * Persisted in the settings table under key 'complication_types'.
 *
 * Items are stored as { key: string; label?: string }[].
 * - Known default keys (e.g. 'infection') have their label looked up from
 *   i18n.t.complications.types[key] at render time.
 * - Custom items (key starting with 'custom_') carry their label in the stored object.
 *
 * On load, old bare-string arrays are migrated automatically.
 */

import { getSetting, setSetting } from '$lib/services/db';
import { i18n } from '$lib/i18n';

export interface ComplicationType {
	key: string;
	/** Only set for custom items — built-in items derive their label from i18n */
	label?: string;
}

export const DEFAULT_COMPLICATION_KEYS: string[] = [
	'infection',
	'dry_socket',
	'nerve_damage',
	'hemorrhage',
	'allergic_reaction',
	'pain_persistent',
	'swelling',
	'instrument_fracture',
	'perforation',
	'sinus_communication',
	'restoration_failure',
	'implant_failure',
	'other',
];

const SETTINGS_KEY = 'complication_types';

function defaultItems(): ComplicationType[] {
	return DEFAULT_COMPLICATION_KEYS.map(key => ({ key }));
}

/** Migrate old bare string[] to ComplicationType[] */
function migrate(raw: unknown): ComplicationType[] {
	if (!Array.isArray(raw) || raw.length === 0) return defaultItems();
	// New format: array of objects
	if (typeof raw[0] === 'object' && raw[0] !== null && 'key' in raw[0]) {
		return raw as ComplicationType[];
	}
	// Old format: bare string array — convert each
	return (raw as string[]).map((s: string, i: number) => {
		// If it matches a known default key, use that key (no label needed)
		if (DEFAULT_COMPLICATION_KEYS.includes(s)) return { key: s };
		// Otherwise treat as a custom item
		return { key: `custom_${i}`, label: s };
	});
}

/** @deprecated Use complicationTypes.list — this is a static snapshot of default keys */
export const DEFAULT_COMPLICATION_TYPES = DEFAULT_COMPLICATION_KEYS;

function createComplicationTypesStore() {
	let _list = $state<ComplicationType[]>(defaultItems());
	let _loaded = $state(false);

	return {
		get list(): ComplicationType[] { return _list; },
		get loaded(): boolean { return _loaded; },

		/** Display label for an item — i18n for known keys, stored label for custom */
		displayLabel(item: ComplicationType): string {
			if (item.label) return item.label;
			const map = i18n.t.complications.types;
			return (map as Record<string, string>)[item.key] ?? item.key;
		},

		async load(): Promise<void> {
			try {
				const raw = await getSetting(SETTINGS_KEY);
				if (raw) {
					const parsed = JSON.parse(raw);
					const migrated = migrate(parsed);
					if (migrated.length > 0) _list = migrated;
				}
			} catch { /* keep defaults */ }
			_loaded = true;
		},

		async save(types: ComplicationType[]): Promise<void> {
			await setSetting(SETTINGS_KEY, JSON.stringify(types));
			_list = [...types];
		},
	};
}

export const complicationTypes = createComplicationTypesStore();
