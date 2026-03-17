/**
 * clinicalTags.svelte.ts
 *
 * Reactive stores for the two configurable clinical tag lists:
 *   - acuteTagOptions  — tags for Acute Problems notes
 *   - medicalTagOptions — tags for Medical History notes
 *
 * Items are stored as { key: string; label?: string }[].
 * Known default keys have their label resolved from i18n at render time.
 * Custom items (key starting with 'custom_') carry their label in storage.
 *
 * Backwards-compatible: old bare string[] is auto-migrated on load.
 */

import { getSetting, setSetting } from '$lib/services/db';
import { i18n } from '$lib/i18n';

export interface ClinicalTag {
	key: string;
	/** Only set for custom items */
	label?: string;
}

// ── Default key lists ──────────────────────────────────────────────────────────

export const DEFAULT_ACUTE_TAG_KEYS: string[] = [
	'allergy', 'drug_reaction', 'infection', 'pain',
	'swelling', 'bleeding', 'trauma', 'abscess',
];

export const DEFAULT_MEDICAL_TAG_KEYS: string[] = [
	'diabetes', 'hypertension', 'heart_disease', 'anticoagulants',
	'penicillin_allergy', 'osteoporosis', 'bisphosphonates', 'immunocompromised',
	'smoking', 'pregnancy', 'renal_disease', 'liver_disease',
	'epilepsy', 'asthma',
];

// ── Legacy string → key mapping (for migrating old bare-string arrays) ─────────

const LEGACY_ACUTE_MAP: Record<string, string> = {
	'Allergy': 'allergy', 'Drug Reaction': 'drug_reaction', 'Infection': 'infection',
	'Pain': 'pain', 'Swelling': 'swelling', 'Bleeding': 'bleeding',
	'Trauma': 'trauma', 'Abscess': 'abscess',
};

const LEGACY_MEDICAL_MAP: Record<string, string> = {
	'Diabetes': 'diabetes', 'Hypertension': 'hypertension', 'Heart Disease': 'heart_disease',
	'Anticoagulants': 'anticoagulants', 'Penicillin Allergy': 'penicillin_allergy',
	'Osteoporosis': 'osteoporosis', 'Bisphosphonates': 'bisphosphonates',
	'Immunocompromised': 'immunocompromised', 'Smoking': 'smoking',
	'Pregnancy': 'pregnancy', 'Renal Disease': 'renal_disease',
	'Liver Disease': 'liver_disease', 'Epilepsy': 'epilepsy', 'Asthma': 'asthma',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function migrate(raw: unknown, legacyMap: Record<string, string>, defaultKeys: string[]): ClinicalTag[] {
	if (!Array.isArray(raw) || raw.length === 0) return defaultKeys.map(k => ({ key: k }));
	if (typeof raw[0] === 'object' && raw[0] !== null && 'key' in raw[0]) {
		return raw as ClinicalTag[];
	}
	// Old bare string[] format
	return (raw as string[]).map((s: string, i: number) => {
		const mappedKey = legacyMap[s];
		if (mappedKey) return { key: mappedKey };
		return { key: `custom_${i}`, label: s };
	});
}

// ── Store factory ──────────────────────────────────────────────────────────────

function makeTagOptionsStore(
	settingsKey: string,
	defaultKeys: string[],
	legacyMap: Record<string, string>,
	getI18nLabel: (key: string) => string,
) {
	let _list   = $state<ClinicalTag[]>(defaultKeys.map(k => ({ key: k })));
	let _loaded = $state(false);

	return {
		get list():   ClinicalTag[] { return _list;   },
		get loaded(): boolean       { return _loaded; },

		/** Display label — i18n for known keys, stored label for custom */
		displayLabel(item: ClinicalTag): string {
			return item.label ?? getI18nLabel(item.key);
		},

		async load(): Promise<void> {
			try {
				const raw = await getSetting(settingsKey);
				if (raw) {
					const migrated = migrate(JSON.parse(raw), legacyMap, defaultKeys);
					if (migrated.length > 0) _list = migrated;
				}
			} catch { /* keep defaults */ }
			_loaded = true;
		},

		async save(tags: ClinicalTag[]): Promise<void> {
			await setSetting(settingsKey, JSON.stringify(tags));
			_list = [...tags];
		},
	};
}

// ── Backward-compat exports (settings page still uses these names) ─────────────
/** @deprecated Use acuteTagOptions.list — this is a static snapshot of default keys */
export const DEFAULT_ACUTE_TAGS = DEFAULT_ACUTE_TAG_KEYS;
/** @deprecated Use medicalTagOptions.list — this is a static snapshot of default keys */
export const DEFAULT_MEDICAL_TAGS = DEFAULT_MEDICAL_TAG_KEYS;

export const acuteTagOptions = makeTagOptionsStore(
	'acute_tag_options',
	DEFAULT_ACUTE_TAG_KEYS,
	LEGACY_ACUTE_MAP,
	(key) => {
		const defaults = i18n.t.defaults.acuteTags;
		return defaults.find(t => t.key === key)?.label ?? key;
	},
);

export const medicalTagOptions = makeTagOptionsStore(
	'medical_tag_options',
	DEFAULT_MEDICAL_TAG_KEYS,
	LEGACY_MEDICAL_MAP,
	(key) => {
		const defaults = i18n.t.defaults.medicalTags;
		return defaults.find(t => t.key === key)?.label ?? key;
	},
);
