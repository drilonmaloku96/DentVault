import { getSetting, setSetting } from '$lib/services/db';
import type { TextBlock } from '$lib/types';
import { i18n } from '$lib/i18n';

export type { TextBlock };

export const DEFAULT_TEXT_BLOCKS: TextBlock[] = [
	{
		key: 'filling',
		label: 'Composite Filling',
		body: 'Composite filling class __ tooth __.\nAnaesthesia: infiltration __.\nExcavation, etching, bonding, composite layering.\nOcclusion check and polish.\nPatient discharged without complaints.',
	},
	{
		key: 'endo',
		label: 'Root Canal Treatment',
		body: 'Endodontic treatment tooth __.\nAnaesthesia: __.\nAccess cavity, mechanical preparation to ISO __.\nIrrigation NaOCl 3%, drying, Ca(OH)₂ dressing.\nTemporary restoration.',
	},
	{
		key: 'extraction',
		label: 'Extraction',
		body: 'Extraction tooth __ under local anaesthesia.\nAnaesthesia: __.\nAtraumatic luxation and extraction.\nSocket inspected, compression.\nPost-op instructions given.',
	},
	{
		key: 'prophylaxis',
		label: 'Prophylaxis / Scale & Polish',
		body: 'Professional teeth cleaning.\nSupragingival scaling with ultrasonic scaler.\nPolishing, fluoride application.\nOral hygiene instruction provided.',
	},
	{
		key: 'crown',
		label: 'Crown Preparation',
		body: 'Crown preparation tooth __.\nAnaesthesia: __.\nPreparation with chamfer margin.\nImpression: __ (polyether / digital).\nTemporary crown fabricated and cemented.\nOcclusion verified.',
	},
	{
		key: 'recall',
		label: 'Recall / Check-up',
		body: 'Routine examination.\nTeeth and gingiva clinically unremarkable.\nNo acute treatment need.\nNext recall: __.',
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
			_list = (i18n.t.defaults.textBlocks as TextBlock[]) ?? DEFAULT_TEXT_BLOCKS;
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
