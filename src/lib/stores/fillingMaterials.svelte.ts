import { getSetting, setSetting } from '$lib/services/db';

export interface FillingMaterialConfig {
	key: string;
	label: string;
	color: string; // hex fill color for SVG surfaces
}

export const DEFAULT_FILLING_MATERIALS: FillingMaterialConfig[] = [
	{ key: 'composite',     label: 'Komposit',    color: '#bfdbfe' },
	{ key: 'amalgam',       label: 'Amalgam',     color: '#9ca3af' },
	{ key: 'gold',          label: 'Gold',        color: '#fbbf24' },
	{ key: 'ceramic',       label: 'Keramik',     color: '#f0f9ff' },
	{ key: 'glass_ionomer', label: 'Glasionomer', color: '#86efac' },
	{ key: 'temporary',     label: 'Provisorium', color: '#fde68a' },
];

function createFillingMaterialsStore() {
	let _materials = $state<FillingMaterialConfig[]>(DEFAULT_FILLING_MATERIALS);
	let _loaded    = $state(false);

	return {
		get list()   { return _materials; },
		get loaded() { return _loaded; },

		async load() {
			try {
				const stored = await getSetting('filling_material_configs');
				if (stored) {
					const parsed = JSON.parse(stored) as FillingMaterialConfig[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						_materials = parsed;
						_loaded    = true;
						return;
					}
				}
			} catch { /* fall back to defaults */ }
			_materials = DEFAULT_FILLING_MATERIALS;
			_loaded    = true;
		},

		async save(materials: FillingMaterialConfig[]) {
			await setSetting('filling_material_configs', JSON.stringify(materials));
			_materials = materials;
		},

		getLabel(key: string): string {
			return _materials.find(m => m.key === key)?.label
				?? DEFAULT_FILLING_MATERIALS.find(m => m.key === key)?.label
				?? key;
		},

		getColor(key: string): string {
			return _materials.find(m => m.key === key)?.color
				?? DEFAULT_FILLING_MATERIALS.find(m => m.key === key)?.color
				?? '#bfdbfe';
		},
	};
}

export const fillingMaterials = createFillingMaterialsStore();
