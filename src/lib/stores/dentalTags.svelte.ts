import { getSetting, setSetting } from '$lib/services/db';
import type { DentalTag, PatternType } from '$lib/types';
import { i18n } from '$lib/i18n';

export { type PatternType };

/**
 * Tags whose key is hardcoded into the SVG rendering engine (root morphology, structural
 * outlines, connector bars). Removing one of these would break chart visuals or make the
 * condition impossible to apply, so the delete button is disabled for them in Settings.
 * Color, pattern, label and shortcut remain fully editable.
 */
export const RENDER_CRITICAL_TAGS = new Set([
	'implant',    // cylindrical grey fixture root
	'bridge',     // orange connector bar + pontic: no root, dashed outline
	'prosthesis', // blue dashed connector + replaced: no root, dashed outline
	'missing',    // suppresses roots entirely
	'extracted',  // suppresses roots + draws X mark
	'root_canal', // purple root fill + canal line + apex dot
]);

// Default tags — no `label` field (labels come from i18n.t.chart.tags[key].label at render time)
export const DEFAULT_DENTAL_TAGS: DentalTag[] = [
	{ key: 'healthy',    color: '#f8fafc', strokeColor: '#94a3b8', pattern: 'solid',      shortcut: 'G' },
	{ key: 'watch',      color: '#fef9c3', strokeColor: '#ca8a04', pattern: 'solid',      shortcut: 'U' },
	{ key: 'decayed',    color: '#fca5a5', strokeColor: '#ef4444', pattern: 'solid',      shortcut: 'K' },
	{ key: 'filled',     color: '#bfdbfe', strokeColor: '#3b82f6', pattern: 'solid',      shortcut: 'F' },
	{ key: 'crowned',    color: '#fde68a', strokeColor: '#d97706', pattern: 'solid',      shortcut: 'O' },
	{ key: 'root_canal', color: '#e9d5ff', strokeColor: '#9333ea', pattern: 'solid',      shortcut: 'W' },
	{ key: 'implant',    color: '#6b7280', strokeColor: '#374151', pattern: 'solid',      shortcut: 'I', wholeTooth: true },
	{ key: 'bridge',     color: '#fed7aa', strokeColor: '#f97316', pattern: 'solid',      shortcut: 'B', wholeTooth: true },
	{ key: 'missing',    color: '#f1f5f9', strokeColor: '#cbd5e1', pattern: 'solid',      shortcut: 'X', wholeTooth: true },
	{ key: 'extracted',  color: '#e2e8f0', strokeColor: '#94a3b8', pattern: 'solid',      shortcut: 'E', wholeTooth: true },
	{ key: 'impacted',   color: '#d6d3d1', strokeColor: '#78716c', pattern: 'solid',      shortcut: 'P', wholeTooth: true },
	{ key: 'fractured',  color: '#fce7f3', strokeColor: '#ec4899', pattern: 'solid',      shortcut: 'R' },
	{ key: 'prosthesis', color: '#dbeafe', strokeColor: '#3b82f6', pattern: 'horizontal', shortcut: 'T', wholeTooth: true },
];

/** Keys whose tags always apply to the whole tooth, never to individual surfaces. */
export const WHOLE_TOOTH_TAG_KEYS = new Set(
	DEFAULT_DENTAL_TAGS.filter(t => t.wholeTooth).map(t => t.key)
);

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
						// Strip legacy `label` field silently (backwards compat); preserve wholeTooth
						_list = parsed.map(({ key, color, strokeColor, pattern, shortcut, wholeTooth }) =>
							({ key, color, strokeColor, pattern, shortcut, wholeTooth } as DentalTag)
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
