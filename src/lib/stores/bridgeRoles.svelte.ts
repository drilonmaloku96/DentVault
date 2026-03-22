import { getSetting, setSetting } from '$lib/services/db';
import type { PatternType } from '$lib/types';

export { type PatternType };

export interface BridgeRoleConfig {
	key: string; // 'abutment' | 'pontic' | 'connector'
	/** Badge character shown in tooth top-right. Empty string = no badge (connector has none). */
	badge: string;
	/** Stroke / outline color: crown border, badge ring */
	color: string;
	/** Fill color for crown body / connector bar */
	fillColor: string;
	/** Fill pattern for crown body (connector uses solid only in rendering, but stored for consistency) */
	fillPattern: PatternType;
}

export const DEFAULT_BRIDGE_ROLE_CONFIGS: BridgeRoleConfig[] = [
	{ key: 'abutment',  badge: 'A', color: '#f97316', fillColor: '#fed7aa', fillPattern: 'solid'    },
	{ key: 'pontic',    badge: 'P', color: '#f97316', fillColor: '#fed7aa', fillPattern: 'diagonal' },
	{ key: 'connector', badge: '',  color: '#f97316', fillColor: '#fed7aa', fillPattern: 'solid'    },
];

function createBridgeRolesStore() {
	let _configs = $state<BridgeRoleConfig[]>(DEFAULT_BRIDGE_ROLE_CONFIGS);
	let _loaded  = $state(false);

	return {
		get configs() { return _configs; },
		get loaded()  { return _loaded; },

		async load() {
			try {
				const stored = await getSetting('bridge_role_configs');
				if (stored) {
					const parsed = JSON.parse(stored) as BridgeRoleConfig[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						_configs = DEFAULT_BRIDGE_ROLE_CONFIGS.map(def => {
							const found = parsed.find(p => p.key === def.key);
							return found ? { ...def, ...found } : def;
						});
						_loaded = true;
						return;
					}
				}
			} catch { /* fall back to defaults */ }
			_configs = DEFAULT_BRIDGE_ROLE_CONFIGS;
			_loaded  = true;
		},

		async save(configs: BridgeRoleConfig[]) {
			await setSetting('bridge_role_configs', JSON.stringify(configs));
			_configs = configs;
		},

		getConfig(key: string): BridgeRoleConfig {
			return _configs.find(c => c.key === key)
				?? DEFAULT_BRIDGE_ROLE_CONFIGS.find(c => c.key === key)
				?? DEFAULT_BRIDGE_ROLE_CONFIGS[0];
		},

		/** Returns CSS fill value: hex color or url(#brpat-KEY) for patterned roles */
		getFill(key: string): string {
			const cfg = this.getConfig(key);
			if (cfg.fillPattern !== 'solid') return `url(#brpat-${key})`;
			return cfg.fillColor;
		},
	};
}

export const bridgeRoles = createBridgeRolesStore();
