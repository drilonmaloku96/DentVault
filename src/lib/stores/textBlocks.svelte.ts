import { getSetting, setSetting } from '$lib/services/db';
import type { TextBlock } from '$lib/types';
import { i18n } from '$lib/i18n';

export type { TextBlock };

export const DEFAULT_TEXT_BLOCKS: TextBlock[] = [
	{
		key: 'fuellung',
		label: 'Composite-Füllung',
		body: 'Composite-Füllung Klasse __ Zahn __.\nAnästhesie: Infiltration __.\nExkavation, Ätzung, Bonding, Schichtung Composite.\nOkklusionskontrolle und Politur.\nPatient beschwerdefrei entlassen.',
	},
	{
		key: 'endo',
		label: 'Wurzelbehandlung',
		body: 'Endodontische Behandlung Zahn __.\nAnästhesie: __.\nTrepanation, maschinelle Aufbereitung bis ISO __.\nSpülung NaOCl 3%, Trocknung, Ca(OH)₂ Einlage.\nProvisiorischer Verschluss.',
	},
	{
		key: 'extraktion',
		label: 'Extraktion',
		body: 'Extraktion Zahn __ in Lokalanästhesie.\nAnästhesie: __.\nAtraumatische Luxation und Extraktion.\nWunde inspiziert, Kompression.\nVerhaltenshinweise gegeben.',
	},
	{
		key: 'pzr',
		label: 'Prophylaxe / PZR',
		body: 'Professionelle Zahnreinigung.\nSupragingivale Zahnsteinentfernung mit Ultraschall.\nPolitur, Fluoridierung.\nMundhygieneinstruktion durchgeführt.',
	},
	{
		key: 'krone',
		label: 'Kronenpräparation',
		body: 'Kronenpräparation Zahn __.\nAnästhesie: __.\nPräparation mit Hohlkehlstufe.\nAbformung: __ (Polyether / digital).\nProvisiorium angefertigt und eingesetzt.\nOkklusionskontrolle durchgeführt.',
	},
	{
		key: 'recall',
		label: 'Recall / Kontrolluntersuchung',
		body: 'Reguläre Kontrolluntersuchung.\nZähne und Zahnfleisch klinisch unauffällig.\nKein Behandlungsbedarf akut.\nNächster Recall: __.',
	},
];

function createTextBlocksStore() {
	let _list = $state<TextBlock[]>(DEFAULT_TEXT_BLOCKS);
	let _loaded = $state(false);

	return {
		get list() { return _list; },
		get loaded() { return _loaded; },

		async load() {
			try {
				const stored = await getSetting('text_blocks');
				if (stored) {
					const parsed = JSON.parse(stored) as TextBlock[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						_list = parsed;
						_loaded = true;
						return;
					}
				}
			} catch { /* fall back to defaults */ }
			_list = DEFAULT_TEXT_BLOCKS;
			_loaded = true;
		},

		async save(blocks: TextBlock[]) {
			await setSetting('text_blocks', JSON.stringify(blocks));
			_list = blocks;
		},

		/** Replace all blocks with the active language's defaults. */
		async resetToLanguageDefaults() {
			const defaults = i18n.t.defaults.textBlocks as TextBlock[];
			await this.save([...defaults]);
		},
	};
}

export const textBlocks = createTextBlocksStore();
