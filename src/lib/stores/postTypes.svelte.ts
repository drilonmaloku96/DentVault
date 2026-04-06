import { getSetting, setSetting } from '$lib/services/db';

export interface PostTypeConfig {
	key: string;
	label: string;
}

export const DEFAULT_POST_TYPES: PostTypeConfig[] = [
	{ key: 'metal',      label: 'Metallstift' },
	{ key: 'glass_fiber', label: 'Glasfaserstift' },
	{ key: 'carbon',     label: 'Kohlefaserstift' },
];

function createPostTypesStore() {
	let _types  = $state<PostTypeConfig[]>(DEFAULT_POST_TYPES);
	let _loaded = $state(false);

	return {
		get list()   { return _types; },
		get loaded() { return _loaded; },

		async load() {
			try {
				const stored = await getSetting('post_type_configs');
				if (stored) {
					const parsed = JSON.parse(stored) as PostTypeConfig[];
					if (Array.isArray(parsed) && parsed.length > 0) {
						_types  = parsed;
						_loaded = true;
						return;
					}
				}
			} catch { /* fall back to defaults */ }
			_types  = DEFAULT_POST_TYPES;
			_loaded = true;
		},

		async save(types: PostTypeConfig[]) {
			await setSetting('post_type_configs', JSON.stringify(types));
			_types = types;
		},

		getLabel(key: string): string {
			return _types.find(t => t.key === key)?.label
				?? DEFAULT_POST_TYPES.find(t => t.key === key)?.label
				?? key;
		},
	};
}

export const postTypes = createPostTypesStore();
