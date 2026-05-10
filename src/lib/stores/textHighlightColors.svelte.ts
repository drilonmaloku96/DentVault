import { getSetting, setSetting } from '$lib/services/db';

export interface TextHighlightColor {
	hex: string;
	label: string;
}

export const DEFAULT_HIGHLIGHT_COLORS: TextHighlightColor[] = [
	{ hex: '#dc2626', label: 'Red' },
	{ hex: '#2563eb', label: 'Blue' },
	{ hex: '#16a34a', label: 'Green' },
];

export const MAX_HIGHLIGHT_COLORS = 8;

const SETTING_KEY = 'text_highlight_colors';

function createTextHighlightColorsStore() {
	let _colors = $state<TextHighlightColor[]>(DEFAULT_HIGHLIGHT_COLORS);
	let _loaded = $state(false);

	return {
		get list()   { return _colors; },
		get loaded() { return _loaded; },

		async load() {
			try {
				const stored = await getSetting(SETTING_KEY);
				if (stored) {
					const parsed = JSON.parse(stored) as TextHighlightColor[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						_colors = parsed;
						_loaded = true;
						return;
					}
				}
			} catch { /* fall back to defaults */ }
			_colors = DEFAULT_HIGHLIGHT_COLORS;
			_loaded = true;
		},

		async save(colors: TextHighlightColor[]) {
			await setSetting(SETTING_KEY, JSON.stringify(colors));
			_colors = colors;
		},
	};
}

export const textHighlightColors = createTextHighlightColorsStore();
