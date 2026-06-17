import { getSetting, setSetting } from '$lib/services/db';

export interface CrownFindingConfig {
	key: string;
	label: string;
	color: string;
	strokeColor: string;
	wholeCrown?: boolean;
}

export const BUILTIN_CROWN_FINDING_KEYS = new Set([
	'cx_secondary_caries', 'cx_margin_open', 'cx_margin_overhang', 'cx_fracture',
	'cx_wear', 'cx_margin_exposed', 'cx_hyperocclusion', 'cx_perforation',
	'cx_loose', 'cx_aesthetic',
]);

export const DEFAULT_CROWN_FINDINGS: CrownFindingConfig[] = [
	{ key: 'cx_secondary_caries', label: 'Secondary Caries',   color: '#fef9c3', strokeColor: '#a16207' },
	{ key: 'cx_margin_open',      label: 'Open Margin',         color: '#fee2e2', strokeColor: '#dc2626' },
	{ key: 'cx_margin_overhang',  label: 'Overhanging Margin',  color: '#ffedd5', strokeColor: '#c2410c' },
	{ key: 'cx_fracture',         label: 'Crown Fracture',       color: '#e2e8f0', strokeColor: '#475569' },
	{ key: 'cx_wear',             label: 'Occlusal Wear',        color: '#f1f5f9', strokeColor: '#64748b' },
	{ key: 'cx_margin_exposed',   label: 'Exposed Margin',       color: '#fce7f3', strokeColor: '#db2777' },
	{ key: 'cx_hyperocclusion',   label: 'High Occlusion',       color: '#dbeafe', strokeColor: '#2563eb' },
	{ key: 'cx_perforation',      label: 'Perforation',          color: '#fecaca', strokeColor: '#b91c1c' },
	{ key: 'cx_loose',            label: 'Loose / De-cemented',  color: '#ffedd5', strokeColor: '#ea580c', wholeCrown: true },
	{ key: 'cx_aesthetic',        label: 'Aesthetic Complaint',  color: '#f3e8ff', strokeColor: '#7c3aed', wholeCrown: true },
];

function createCrownFindingsStore() {
	let _list   = $state<CrownFindingConfig[]>(DEFAULT_CROWN_FINDINGS);
	let _loaded = $state(false);

	return {
		get list()   { return _list; },
		get loaded() { return _loaded; },

		async load() {
			try {
				const stored = await getSetting('crown_findings');
				if (stored) {
					const parsed = JSON.parse(stored) as CrownFindingConfig[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						const storedKeys = new Set(parsed.map(f => f.key));
						const newDefaults = DEFAULT_CROWN_FINDINGS.filter(f => !storedKeys.has(f.key));
						_list = newDefaults.length > 0 ? [...parsed, ...newDefaults] : parsed;
						_loaded = true;
						return;
					}
				}
			} catch { /* fall through to defaults */ }
			_list   = DEFAULT_CROWN_FINDINGS;
			_loaded = true;
		},

		async save(findings: CrownFindingConfig[]) {
			await setSetting('crown_findings', JSON.stringify(findings));
			_list = findings;
		},

		getByKey(key: string): CrownFindingConfig | undefined {
			return _list.find(f => f.key === key);
		},

		getLabel(key: string): string {
			return _list.find(f => f.key === key)?.label ?? key;
		},
	};
}

export const crownFindings = createCrownFindingsStore();
