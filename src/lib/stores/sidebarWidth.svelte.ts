/**
 * User-resizable left sidebar width (px).
 *
 * Persisted to localStorage only — width is display-specific UI state, not
 * clinic data, so it deliberately does not round-trip through the vault DB.
 *
 * Every fixed-position bar that used to hardcode `left-56` (224px) must read
 * `sidebarWidth.px` instead so it follows the drag handle.
 */

const STORAGE_KEY = 'dentvault-sidebar-width';
export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 480;
const DEFAULT = 224; // = Tailwind w-56, the previous fixed width

function clamp(v: number): number {
	return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(v)));
}

function initial(): number {
	if (typeof localStorage === 'undefined') return DEFAULT;
	const stored = parseInt(localStorage.getItem(STORAGE_KEY) ?? '');
	return isNaN(stored) ? DEFAULT : clamp(stored);
}

let _px = $state(initial());

export const sidebarWidth = {
	get px(): number {
		return _px;
	},

	set(value: number) {
		_px = clamp(value);
	},

	/** Persist the current width (call on drag end, not every mousemove). */
	save() {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(STORAGE_KEY, String(_px));
		}
	},

	reset() {
		_px = DEFAULT;
		this.save();
	},
};
