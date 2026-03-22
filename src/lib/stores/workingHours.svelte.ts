import { getSetting, setSetting } from '$lib/services/db';
import type { WorkingHoursEntry } from '$lib/types';

const SETTINGS_KEY = 'working_hours';

const DEFAULTS: WorkingHoursEntry[] = [
	{ day_of_week: 0, start_time: '08:00', end_time: '18:00', break_start: '12:00', break_end: '13:00', is_active: false }, // Sun
	{ day_of_week: 1, start_time: '08:00', end_time: '18:00', break_start: '12:00', break_end: '13:00', is_active: true },  // Mon
	{ day_of_week: 2, start_time: '08:00', end_time: '18:00', break_start: '12:00', break_end: '13:00', is_active: true },  // Tue
	{ day_of_week: 3, start_time: '08:00', end_time: '18:00', break_start: '12:00', break_end: '13:00', is_active: true },  // Wed
	{ day_of_week: 4, start_time: '08:00', end_time: '18:00', break_start: '12:00', break_end: '13:00', is_active: true },  // Thu
	{ day_of_week: 5, start_time: '08:00', end_time: '18:00', break_start: '12:00', break_end: '13:00', is_active: true },  // Fri
	{ day_of_week: 6, start_time: '08:00', end_time: '13:00', break_start: null, break_end: null, is_active: true },         // Sat
];

function createWorkingHoursStore() {
	let hours = $state<WorkingHoursEntry[]>(DEFAULTS);

	function getForDay(dayOfWeek: number): WorkingHoursEntry | undefined {
		return hours.find((h) => h.day_of_week === dayOfWeek);
	}

	async function load() {
		const raw = await getSetting(SETTINGS_KEY);
		if (raw) {
			try {
				hours = JSON.parse(raw);
			} catch {
				hours = DEFAULTS;
			}
		} else {
			hours = DEFAULTS;
		}
	}

	async function save(newHours: WorkingHoursEntry[]) {
		hours = newHours;
		await setSetting(SETTINGS_KEY, JSON.stringify(newHours));
	}

	return {
		get hours() { return hours; },
		getForDay,
		load,
		save,
	};
}

export const workingHours = createWorkingHoursStore();
