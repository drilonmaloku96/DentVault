import { getSetting, setSetting } from '$lib/services/db';

export interface ShadeGuideConfig {
	key: string;
	label: string;
	shades: string[];
}

export const DEFAULT_SHADE_GUIDES: ShadeGuideConfig[] = [
	{
		key: 'vita_classical',
		label: 'VITA Classical',
		shades: ['A1', 'A2', 'A3', 'A3.5', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4', 'D2', 'D3', 'D4'],
	},
	{
		key: 'vita_3d',
		label: 'VITA 3D-Master',
		shades: [
			'0M1', '0M2', '0M3',
			'1M1', '1M2',
			'2L1.5', '2L2.5', '2M1', '2M2', '2M3', '2R1.5', '2R2.5',
			'3L1.5', '3L2.5', '3M1', '3M2', '3M3', '3R1.5', '3R2.5',
			'4L1.5', '4L2.5', '4M1', '4M2', '4M3', '4R1.5', '4R2.5',
			'5M1', '5M2', '5M3',
		],
	},
];

function createShadeGuidesStore() {
	let _guides = $state<ShadeGuideConfig[]>(DEFAULT_SHADE_GUIDES);
	let _loaded  = $state(false);

	return {
		get list()   { return _guides; },
		get loaded() { return _loaded; },

		async load() {
			try {
				const stored = await getSetting('shade_guide_configs');
				if (stored) {
					const parsed = JSON.parse(stored) as ShadeGuideConfig[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						_guides = parsed;
						_loaded = true;
						return;
					}
				}
			} catch { /* fall back to defaults */ }
			_guides = DEFAULT_SHADE_GUIDES;
			_loaded = true;
		},

		async save(guides: ShadeGuideConfig[]) {
			await setSetting('shade_guide_configs', JSON.stringify(guides));
			_guides = guides;
		},

		getGuide(key: string): ShadeGuideConfig | undefined {
			return _guides.find(g => g.key === key);
		},
	};
}

export const shadeGuides = createShadeGuidesStore();
