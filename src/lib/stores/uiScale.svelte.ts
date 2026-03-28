import { getSetting, setSetting } from '$lib/services/db';

const VALID_SCALES = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
type Scale = (typeof VALID_SCALES)[number];

function applyZoom(scale: number) {
	if (typeof document !== 'undefined') {
		document.documentElement.style.zoom = String(scale);
	}
}

function createUiScaleStore() {
	let _value = $state<Scale>(1);

	return {
		get value() { return _value; },
		get options() { return VALID_SCALES; },

		async load() {
			try {
				const stored = await getSetting('ui_scale');
				if (stored) {
					const n = parseFloat(stored) as Scale;
					if (VALID_SCALES.includes(n)) {
						_value = n;
						applyZoom(n);
						return;
					}
				}
			} catch { /* fall back to 1 */ }
			_value = 1;
			applyZoom(1);
		},

		async set(scale: Scale) {
			_value = scale;
			applyZoom(scale);
			await setSetting('ui_scale', String(scale));
		},

		/** Apply without persisting — used during onboarding before vault is ready */
		preview(scale: Scale) {
			_value = scale;
			applyZoom(scale);
		},
	};
}

export const uiScale = createUiScaleStore();
