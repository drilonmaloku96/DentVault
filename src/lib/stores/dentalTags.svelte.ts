import { getSetting, setSetting } from '$lib/services/db';
import type { DentalTag, PatternType } from '$lib/types';
import { i18n } from '$lib/i18n';

export { type PatternType };

// Default tags — no `label` field (labels come from i18n.t.chart.tags[key].label at render time)
export const DEFAULT_DENTAL_TAGS: DentalTag[] = [
	{ key: 'healthy',    color: '#f8fafc', strokeColor: '#94a3b8', pattern: 'solid',      shortcut: 'G' },
	{ key: 'watch',      color: '#fef9c3', strokeColor: '#ca8a04', pattern: 'solid',      shortcut: 'U' },
	{ key: 'decayed',    color: '#fca5a5', strokeColor: '#ef4444', pattern: 'solid',      shortcut: 'K' },
	{ key: 'filled',     color: '#bfdbfe', strokeColor: '#3b82f6', pattern: 'solid',      shortcut: 'F' },
	{ key: 'crowned',    color: '#fde68a', strokeColor: '#d97706', pattern: 'solid',      shortcut: 'O' },
	{ key: 'root_canal', color: '#e9d5ff', strokeColor: '#9333ea', pattern: 'solid',      shortcut: 'W' },
	{ key: 'implant',    color: '#c7d2fe', strokeColor: '#6366f1', pattern: 'solid',      shortcut: 'I' },
	{ key: 'bridge',     color: '#fed7aa', strokeColor: '#f97316', pattern: 'solid',      shortcut: 'B' },
	{ key: 'missing',    color: '#f1f5f9', strokeColor: '#cbd5e1', pattern: 'solid',      shortcut: 'X' },
	{ key: 'extracted',  color: '#e2e8f0', strokeColor: '#94a3b8', pattern: 'solid',      shortcut: 'E' },
	{ key: 'impacted',   color: '#d6d3d1', strokeColor: '#78716c', pattern: 'solid',      shortcut: 'P' },
	{ key: 'fractured',  color: '#fce7f3', strokeColor: '#ec4899', pattern: 'solid',      shortcut: 'R' },
	{ key: 'prosthesis', color: '#dbeafe', strokeColor: '#3b82f6', pattern: 'horizontal', shortcut: 'T' },
];

function createDentalTagsStore() {
	let _list   = $state<DentalTag[]>(DEFAULT_DENTAL_TAGS);
	let _loaded = $state(false);

	return {
		get list()   { return _list; },
		get loaded() { return _loaded; },

		async load() {
			try {
				const stored = await getSetting('dental_tags');
				if (stored) {
					const parsed = JSON.parse(stored) as DentalTag[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						// Strip legacy `label` field silently (backwards compat)
						_list = parsed.map(({ key, color, strokeColor, pattern, shortcut }) =>
							({ key, color, strokeColor, pattern, shortcut } as DentalTag)
						);
						_loaded = true;
						return;
					}
				}
			} catch { /* silently fall back to defaults */ }
			_list   = DEFAULT_DENTAL_TAGS;
			_loaded = true;
		},

		async save(tags: DentalTag[]) {
			await setSetting('dental_tags', JSON.stringify(tags));
			_list = tags;
		},

		/** Reset all tag shortcuts to the current language's defaults. */
		async resetShortcutsToLanguageDefaults() {
			const updated = _list.map(tag => {
				const def = i18n.t.chart.tags[tag.key as keyof typeof i18n.t.chart.tags];
				return def
					? { ...tag, shortcut: def.defaultShortcut.toUpperCase() }
					: tag;
			});
			await this.save(updated);
		},

		getByKey(key: string): DentalTag | undefined {
			return _list.find(t => t.key === key);
		},

		/** Returns a CSS fill value — hex color or url(#dtpat-KEY) for patterned tags */
		getFill(key: string): string {
			const tag = _list.find(t => t.key === key);
			if (!tag) return '#f1f5f9';
			if (tag.pattern !== 'solid') return `url(#dtpat-${tag.key})`;
			return tag.color;
		},

		getStroke(key: string): string {
			return _list.find(t => t.key === key)?.strokeColor ?? '#cbd5e1';
		},

		/** Get translated label for a tag key, falling back to the key itself. */
		getLabel(key: string): string {
			return i18n.t.chart.tags[key as keyof typeof i18n.t.chart.tags]?.label ?? key;
		},
	};
}

export const dentalTags = createDentalTagsStore();
