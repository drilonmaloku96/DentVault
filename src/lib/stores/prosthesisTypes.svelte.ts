import { getSetting, setSetting } from '$lib/services/db';
import type { PatternType } from '$lib/types';

export { type PatternType };

export interface ProsthesisTypeConfig {
	key: string;   // 'telescope' | 'replaced'
	badge: string; // single character shown in top-right tooth badge
	/** Stroke / outline color: badge ring, connector bar, replaced tooth border */
	color: string;
	/** Fill color for connector bar and replaced tooth body */
	fillColor: string;
	/** Fill pattern for replaced tooth crown body */
	fillPattern: PatternType;
}

export const DEFAULT_PROSTHESIS_CONFIGS: ProsthesisTypeConfig[] = [
	{ key: 'telescope', badge: 'T', color: '#3b82f6', fillColor: '#dbeafe', fillPattern: 'solid'      },
	{ key: 'replaced',  badge: 'E', color: '#3b82f6', fillColor: '#dbeafe', fillPattern: 'horizontal' },
];

function createProsthesisTypesStore() {
	let _configs = $state<ProsthesisTypeConfig[]>(DEFAULT_PROSTHESIS_CONFIGS);
	let _loaded  = $state(false);

	return {
		get configs() { return _configs; },
		get loaded()  { return _loaded; },

		async load() {
			try {
				const stored = await getSetting('prosthesis_type_configs');
				if (stored) {
					const parsed = JSON.parse(stored) as ProsthesisTypeConfig[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						// Merge with defaults to ensure all known keys always exist
						_configs = DEFAULT_PROSTHESIS_CONFIGS.map(def => {
							const found = parsed.find(p => p.key === def.key);
							return found ? { ...def, ...found } : def;
						});
						_loaded = true;
						return;
					}
				}
			} catch { /* fall back to defaults */ }
			_configs = DEFAULT_PROSTHESIS_CONFIGS;
			_loaded  = true;
		},

		async save(configs: ProsthesisTypeConfig[]) {
			await setSetting('prosthesis_type_configs', JSON.stringify(configs));
			_configs = configs;
		},

		getConfig(key: string): ProsthesisTypeConfig {
			return _configs.find(c => c.key === key)
				?? DEFAULT_PROSTHESIS_CONFIGS.find(c => c.key === key)
				?? DEFAULT_PROSTHESIS_CONFIGS[0];
		},

		/** Returns CSS fill value: hex color or url(#ptpat-KEY) for patterned types */
		getFill(key: string): string {
			const cfg = this.getConfig(key);
			if (cfg.fillPattern !== 'solid') return `url(#ptpat-${key})`;
			return cfg.fillColor;
		},
	};
}

export const prosthesisTypes = createProsthesisTypesStore();
