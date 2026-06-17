import { getSetting, setSetting } from '$lib/services/db';

export interface CanalStatusConfig {
	key: string;
	label: string;
	bg: string;
	border: string;
	text: string;
}

/** Keys whose statuses ship with the app and cannot be deleted (only recolored/relabeled). */
export const BUILTIN_CANAL_STATUS_KEYS = new Set([
	'none', 'filled', 'insufficient', 'dressing', 'open_apex', 'calcified', 'resorption',
]);

export const DEFAULT_CANAL_STATUSES: CanalStatusConfig[] = [
	{ key: 'none',         label: 'Healthy',          bg: '#f1f5f9', border: '#94a3b8', text: '#64748b' },
	{ key: 'filled',       label: 'Root Filling',      bg: '#dbeafe', border: '#93c5fd', text: '#2563eb' },
	{ key: 'insufficient', label: 'Insufficient',     bg: '#fee2e2', border: '#fca5a5', text: '#dc2626' },
	{ key: 'dressing',     label: 'Dressing',          bg: '#fef3c7', border: '#fde68a', text: '#d97706' },
	{ key: 'open_apex',    label: 'Open Apex',         bg: '#fce7f3', border: '#f9a8d4', text: '#db2777' },
	{ key: 'calcified',    label: 'Calcified',         bg: '#f1f5f9', border: '#94a3b8', text: '#475569' },
	{ key: 'resorption',   label: 'Resorption',        bg: '#fff7ed', border: '#fdba74', text: '#c2410c' },
];

function createCanalStatusesStore() {
	let _list   = $state<CanalStatusConfig[]>(DEFAULT_CANAL_STATUSES);
	let _loaded = $state(false);

	return {
		get list()   { return _list; },
		get loaded() { return _loaded; },

		async load() {
			try {
				const stored = await getSetting('canal_statuses');
				if (stored) {
					const parsed = JSON.parse(stored) as CanalStatusConfig[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						const storedKeys = new Set(parsed.map(s => s.key));
						const newDefaults = DEFAULT_CANAL_STATUSES.filter(s => !storedKeys.has(s.key));
						_list = newDefaults.length > 0 ? [...parsed, ...newDefaults] : parsed;
						_loaded = true;
						return;
					}
				}
			} catch { /* fall through to defaults */ }
			_list   = DEFAULT_CANAL_STATUSES;
			_loaded = true;
		},

		async save(statuses: CanalStatusConfig[]) {
			await setSetting('canal_statuses', JSON.stringify(statuses));
			_list = statuses;
		},

		getByKey(key: string): CanalStatusConfig | undefined {
			return _list.find(s => s.key === key);
		},

		getColors(key: string): { bg: string; border: string; text: string } {
			const s = _list.find(s => s.key === key);
			if (s) return { bg: s.bg, border: s.border, text: s.text };
			// Fallback to 'none' colors so unknown statuses still render
			const none = _list.find(s => s.key === 'none') ?? DEFAULT_CANAL_STATUSES[0];
			return { bg: none.bg, border: none.border, text: none.text };
		},

		getLabel(key: string): string {
			return _list.find(s => s.key === key)?.label ?? key;
		},
	};
}

export const canalStatuses = createCanalStatusesStore();
