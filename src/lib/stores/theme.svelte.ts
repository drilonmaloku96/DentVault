import { getSetting, setSetting } from '$lib/services/db';

const DB_KEY = 'app_theme';
const STORAGE_KEY = 'dentvault-theme'; // legacy localStorage key

// Module-level reactive state — shared across all consumers
let _theme = $state<'dark' | 'light'>('dark');

function applyClass(t: 'dark' | 'light') {
	if (typeof document === 'undefined') return;
	document.documentElement.classList.toggle('dark', t === 'dark');
}

export const theme = {
	/** Reactive getter — read this in templates: `theme.current` */
	get current(): 'dark' | 'light' {
		return _theme;
	},

	/**
	 * Call once from layout onMount to hydrate theme.
	 * Reads localStorage synchronously first (no flash), then loads from DB (authoritative).
	 */
	async init() {
		// Immediate: apply from localStorage for instant render (no flash)
		if (typeof localStorage !== 'undefined') {
			const stored = localStorage.getItem(STORAGE_KEY);
			_theme = stored === 'light' ? 'light' : 'dark';
			applyClass(_theme);
		}

		// Then: load from DB (authoritative, portable source)
		try {
			const dbTheme = await getSetting(DB_KEY);
			if (dbTheme === 'light' || dbTheme === 'dark') {
				if (dbTheme !== _theme) {
					_theme = dbTheme as 'dark' | 'light';
					applyClass(_theme);
				}
				// Sync localStorage cache for fast future loads
				if (typeof localStorage !== 'undefined') {
					localStorage.setItem(STORAGE_KEY, _theme);
				}
			} else {
				// First run or migrating: persist current value to DB
				await setSetting(DB_KEY, _theme);
			}
		} catch {
			// DB not ready yet — localStorage value is fine for now
		}
	},

	async set(value: 'dark' | 'light') {
		_theme = value;
		applyClass(_theme);
		// Write to localStorage (fast cache for next load)
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, value);
		}
		// Write to DB (authoritative, portable)
		try {
			await setSetting(DB_KEY, value);
		} catch {
			// DB write failed — localStorage still has the value
		}
	},

	toggle() {
		this.set(_theme === 'dark' ? 'light' : 'dark');
	},
};
