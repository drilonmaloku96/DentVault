import { getSetting, setSetting } from '$lib/services/db';

const DEFAULT_MINUTES = 30;

function createNoShowThresholdStore() {
	let _value = $state(DEFAULT_MINUTES);

	return {
		get value() { return _value; },

		async load() {
			try {
				const stored = await getSetting('no_show_threshold_min');
				const n = stored ? parseInt(stored, 10) : NaN;
				_value = Number.isFinite(n) && n > 0 ? n : DEFAULT_MINUTES;
			} catch {
				_value = DEFAULT_MINUTES;
			}
		},

		async set(minutes: number) {
			_value = minutes;
			await setSetting('no_show_threshold_min', String(minutes));
		},
	};
}

export const noShowThreshold = createNoShowThresholdStore();
