import { getSetting, setSetting } from '$lib/services/db';

export interface PlanProcedureConfig {
	key: string;
	label: string;   // displayed label (for custom items; built-ins use i18n at render time)
	color: string;   // hex
	abbr: string;    // short SVG label (1-2 chars)
	shortcut: string; // single lowercase key
	isDefault: boolean;
}

export const DEFAULT_PLAN_PROCEDURES: PlanProcedureConfig[] = [
	{ key: 'plan_extract',         label: 'Extraction',           color: '#ef4444', abbr: 'E',  shortcut: 'e', isDefault: true },
	{ key: 'plan_fill',            label: 'Filling',              color: '#f59e0b', abbr: 'F',  shortcut: 'f', isDefault: true },
	{ key: 'plan_crown',           label: 'Crown',                color: '#ea580c', abbr: 'C',  shortcut: 'c', isDefault: true },
	{ key: 'plan_rct',             label: 'Root canal treatment', color: '#0891b2', abbr: 'R',  shortcut: 'r', isDefault: true },
	{ key: 'plan_bridge',          label: 'Bridge',               color: '#7c3aed', abbr: 'B',  shortcut: 'b', isDefault: true },
	{ key: 'plan_implant',         label: 'Implant',              color: '#059669', abbr: 'I',  shortcut: 'i', isDefault: true },
	{ key: 'plan_veneer',          label: 'Veneer',               color: '#db2777', abbr: 'V',  shortcut: 'v', isDefault: true },
	{ key: 'plan_partial_denture', label: 'Partial denture',      color: '#9333ea', abbr: 'PD', shortcut: 'p', isDefault: true },
	{ key: 'plan_full_denture',    label: 'Full denture',         color: '#6d28d9', abbr: 'FD', shortcut: 't', isDefault: true },
	{ key: 'plan_watch',           label: 'Watch',                color: '#64748b', abbr: '?',  shortcut: 'q', isDefault: true },
];

function createPlanProceduresStore() {
	let _list   = $state<PlanProcedureConfig[]>(DEFAULT_PLAN_PROCEDURES);
	let _loaded = $state(false);

	return {
		get list()   { return _list; },
		get loaded() { return _loaded; },

		async load() {
			try {
				const stored = await getSetting('plan_procedure_configs');
				if (stored) {
					const parsed = JSON.parse(stored) as PlanProcedureConfig[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						_list   = parsed;
						_loaded = true;
						return;
					}
				}
			} catch { /* fall back to defaults */ }
			_list   = DEFAULT_PLAN_PROCEDURES;
			_loaded = true;
		},

		async save(list: PlanProcedureConfig[]) {
			await setSetting('plan_procedure_configs', JSON.stringify(list));
			_list = list;
		},

		getLabel(key: string, i18nLabel?: string): string {
			// Prefer i18n label for built-ins (passed in from caller), then store label, then key
			return i18nLabel
				?? _list.find(p => p.key === key)?.label
				?? DEFAULT_PLAN_PROCEDURES.find(p => p.key === key)?.label
				?? key;
		},

		getColor(key: string): string {
			return _list.find(p => p.key === key)?.color
				?? DEFAULT_PLAN_PROCEDURES.find(p => p.key === key)?.color
				?? '#f59e0b';
		},

		getAbbr(key: string): string {
			return _list.find(p => p.key === key)?.abbr
				?? DEFAULT_PLAN_PROCEDURES.find(p => p.key === key)?.abbr
				?? '?';
		},
	};
}

export const planProcedures = createPlanProceduresStore();
