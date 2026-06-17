import { getSetting, setSetting } from '$lib/services/db';

export interface AppointmentStatusConfig {
	key: string;
	label: string;
	kuerzel: string;
	color: string;
	isBuiltIn: boolean;
}

export const BUILT_IN_STATUS_KEYS = ['scheduled', 'waiting', 'in_chair', 'completed', 'cancelled', 'no_show'] as const;

const DEFAULTS: AppointmentStatusConfig[] = [
	{ key: 'scheduled', label: 'Scheduled',    kuerzel: '',   color: '#64748b', isBuiltIn: true },
	{ key: 'waiting',   label: 'Waiting Room', kuerzel: 'W',  color: '#3b82f6', isBuiltIn: true },
	{ key: 'in_chair',  label: 'In Treatment', kuerzel: 'IN', color: '#22c55e', isBuiltIn: true },
	{ key: 'completed', label: 'Completed',    kuerzel: '✓',  color: '#10b981', isBuiltIn: true },
	{ key: 'cancelled', label: 'Cancelled',    kuerzel: '✗',  color: '#ef4444', isBuiltIn: true },
	{ key: 'no_show',   label: 'No Show',      kuerzel: '?',  color: '#f97316', isBuiltIn: true },
];

const SETTINGS_KEY = 'appointment_statuses';

function createAppointmentStatusesStore() {
	let list = $state<AppointmentStatusConfig[]>([...DEFAULTS]);

	const map = $derived(
		Object.fromEntries(list.map((s) => [s.key, s])) as Record<string, AppointmentStatusConfig>,
	);

	async function persist() {
		await setSetting(SETTINGS_KEY, JSON.stringify(list));
	}

	async function load() {
		try {
			const raw = await getSetting(SETTINGS_KEY);
			if (raw) {
				const parsed: AppointmentStatusConfig[] = JSON.parse(raw);
				// Merge: built-ins keep isBuiltIn flag; new built-ins (from code updates) are appended
				const merged: AppointmentStatusConfig[] = DEFAULTS.map((def) => {
					const saved = parsed.find((s) => s.key === def.key);
					return saved ? { ...saved, isBuiltIn: true } : def;
				});
				// Append any custom statuses from the saved list
				for (const s of parsed) {
					if (!s.isBuiltIn && !merged.some((m) => m.key === s.key)) {
						merged.push({ ...s, isBuiltIn: false });
					}
				}
				list = merged;
				return;
			}
		} catch { /* keep defaults */ }
		list = [...DEFAULTS];
		await persist();
	}

	async function update(key: string, patch: Partial<Pick<AppointmentStatusConfig, 'label' | 'kuerzel' | 'color'>>) {
		const idx = list.findIndex((s) => s.key === key);
		if (idx === -1) return;
		list[idx] = { ...list[idx], ...patch };
		await persist();
	}

	async function add(cfg: { label: string; kuerzel: string; color: string }) {
		const base = cfg.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'custom';
		let key = base;
		let n = 2;
		while (list.some((s) => s.key === key)) key = `${base}_${n++}`;
		list = [...list, { key, label: cfg.label, kuerzel: cfg.kuerzel, color: cfg.color, isBuiltIn: false }];
		await persist();
	}

	async function remove(key: string) {
		const cfg = list.find((s) => s.key === key);
		if (!cfg || cfg.isBuiltIn) return;
		list = list.filter((s) => s.key !== key);
		await persist();
	}

	return {
		get list() { return list; },
		get map() { return map; },
		load,
		update,
		add,
		remove,
	};
}

export const appointmentStatuses = createAppointmentStatusesStore();
