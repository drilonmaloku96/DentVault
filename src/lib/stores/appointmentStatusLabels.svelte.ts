import { getSetting, setSetting } from '$lib/services/db';
import { i18n } from '$lib/i18n';
import { SYSTEM_APPOINTMENT_STATUSES } from '$lib/types';

const LABELS_KEY = 'appointment_status_labels';
const CUSTOM_KEY  = 'appointment_status_custom';

export type CustomStatus = { key: string; label: string };

// System status metadata (icon + Tailwind color class) — keyed by status string
export const SYSTEM_STATUS_META: Record<string, { icon: string; colorClass: string }> = {
	scheduled:    { icon: '📅', colorClass: 'text-foreground' },
	waiting:      { icon: '⏳', colorClass: 'text-amber-600 dark:text-amber-400' },
	in_treatment: { icon: '🦷', colorClass: 'text-blue-600 dark:text-blue-400' },
	completed:    { icon: '✓',  colorClass: 'text-green-600 dark:text-green-400' },
	cancelled:    { icon: '✕',  colorClass: 'text-destructive' },
	no_show:      { icon: '✗',  colorClass: 'text-orange-500' },
};

export const SYSTEM_STATUS_DOTS: Record<string, string> = {
	scheduled:    'bg-primary',
	waiting:      'bg-amber-500',
	in_treatment: 'bg-blue-600',
	completed:    'bg-green-600',
	cancelled:    'bg-destructive',
	no_show:      'bg-orange-500',
};

function createAppointmentStatusLabelsStore() {
	// label overrides for system statuses
	let overrides = $state<Record<string, string>>({});
	// user-added custom statuses
	let custom = $state<CustomStatus[]>([]);

	function i18nDefault(s: string): string {
		const key = s as keyof typeof i18n.t.schedule.statuses;
		return (i18n.t.schedule.statuses as Record<string, string>)[key] ?? s;
	}

	function getLabel(s: string): string {
		const ov = overrides[s];
		if (ov && ov.trim()) return ov.trim();
		// check custom
		const c = custom.find(x => x.key === s);
		if (c) return c.label;
		return i18nDefault(s);
	}

	function getOverride(s: string): string {
		return overrides[s] ?? '';
	}

	/** All statuses in display order: system first, then custom. */
	function allStatuses(): Array<{ key: string; isCustom: boolean }> {
		return [
			...SYSTEM_APPOINTMENT_STATUSES.map(k => ({ key: k, isCustom: false })),
			...custom.map(c => ({ key: c.key, isCustom: true })),
		];
	}

	function getMeta(s: string): { icon: string; colorClass: string } {
		return SYSTEM_STATUS_META[s] ?? { icon: '●', colorClass: 'text-purple-500' };
	}

	async function load() {
		const [rawLabels, rawCustom] = await Promise.all([
			getSetting(LABELS_KEY),
			getSetting(CUSTOM_KEY),
		]);
		if (rawLabels) { try { overrides = JSON.parse(rawLabels); } catch { overrides = {}; } }
		if (rawCustom) { try { custom = JSON.parse(rawCustom); } catch { custom = []; } }
	}

	async function saveLabels(next: Record<string, string>) {
		const cleaned: Record<string, string> = {};
		for (const [k, v] of Object.entries(next)) {
			if (v && v.trim()) cleaned[k] = v.trim();
		}
		overrides = cleaned;
		await setSetting(LABELS_KEY, JSON.stringify(cleaned));
	}

	async function addCustomStatus(label: string): Promise<void> {
		const trimmed = label.trim();
		if (!trimmed) return;
		// derive a unique key
		const base = 'custom_' + trimmed.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
		let key = base;
		let n = 2;
		while (custom.some(c => c.key === key)) { key = `${base}_${n++}`; }
		const next = [...custom, { key, label: trimmed }];
		custom = next;
		await setSetting(CUSTOM_KEY, JSON.stringify(next));
	}

	async function removeCustomStatus(key: string): Promise<void> {
		const next = custom.filter(c => c.key !== key);
		custom = next;
		await setSetting(CUSTOM_KEY, JSON.stringify(next));
	}

	return {
		get overrides() { return overrides; },
		get custom() { return custom; },
		getLabel,
		getOverride,
		getMeta,
		allStatuses,
		load,
		saveLabels,
		addCustomStatus,
		removeCustomStatus,
	};
}

export const appointmentStatusLabels = createAppointmentStatusLabelsStore();

// Export the system status array for the settings UI
export { SYSTEM_APPOINTMENT_STATUSES as ALL_STATUSES };
