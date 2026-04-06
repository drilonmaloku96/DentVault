import { getSetting, setSetting } from '$lib/services/db';

export interface EndoInstrumentConfig {
	key: string;
	label: string;
}

export const DEFAULT_ENDO_INSTRUMENTS: EndoInstrumentConfig[] = [
	{ key: 'k_file',      label: 'K-Feile' },
	{ key: 'h_file',      label: 'H-Feile' },
	{ key: 'rotary',      label: 'Rotary' },
	{ key: 'reciprocal',  label: 'Reciproc' },
];

function createEndoInstrumentsStore() {
	let _instruments = $state<EndoInstrumentConfig[]>(DEFAULT_ENDO_INSTRUMENTS);
	let _loaded      = $state(false);

	return {
		get list()   { return _instruments; },
		get loaded() { return _loaded; },

		async load() {
			try {
				const stored = await getSetting('endo_instrument_types');
				if (stored) {
					const parsed = JSON.parse(stored) as EndoInstrumentConfig[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						_instruments = parsed;
						_loaded      = true;
						return;
					}
				}
			} catch { /* fall back to defaults */ }
			_instruments = DEFAULT_ENDO_INSTRUMENTS;
			_loaded      = true;
		},

		async save(instruments: EndoInstrumentConfig[]) {
			await setSetting('endo_instrument_types', JSON.stringify(instruments));
			_instruments = instruments;
		},

		getLabel(key: string): string {
			return _instruments.find(i => i.key === key)?.label
				?? DEFAULT_ENDO_INSTRUMENTS.find(i => i.key === key)?.label
				?? key;
		},
	};
}

export const endoInstruments = createEndoInstrumentsStore();
