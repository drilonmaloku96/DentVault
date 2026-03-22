import { getAppointmentTypes, insertAppointmentType, updateAppointmentType, deleteAppointmentType } from '$lib/services/db';
import type { AppointmentType, AppointmentTypeFormData } from '$lib/types';

const DEFAULTS: AppointmentTypeFormData[] = [
	{ name: 'Kontrolle', short_name: 'Ko', default_duration_min: 15, color: '#3b82f6', treatment_category: 'preventive', sort_order: 0, is_active: true },
	{ name: 'Beratung', short_name: 'Be', default_duration_min: 20, color: '#64748b', treatment_category: 'other', sort_order: 1, is_active: true },
	{ name: 'PZR', short_name: 'PZR', default_duration_min: 45, color: '#10b981', treatment_category: 'preventive', sort_order: 2, is_active: true },
	{ name: 'Füllung', short_name: 'Fü', default_duration_min: 30, color: '#f59e0b', treatment_category: 'restorative', sort_order: 3, is_active: true },
	{ name: 'Wurzelbehandlung', short_name: 'WB', default_duration_min: 60, color: '#8b5cf6', treatment_category: 'endodontics', sort_order: 4, is_active: true },
	{ name: 'Extraktion', short_name: 'Ex', default_duration_min: 30, color: '#ef4444', treatment_category: 'oral_surgery', sort_order: 5, is_active: true },
	{ name: 'Krone', short_name: 'Kr', default_duration_min: 45, color: '#f97316', treatment_category: 'prosthodontics', sort_order: 6, is_active: true },
	{ name: 'KFO-Kontrolle', short_name: 'KFO', default_duration_min: 15, color: '#06b6d4', treatment_category: 'orthodontics', sort_order: 7, is_active: true },
	{ name: 'Notfall', short_name: 'Not', default_duration_min: 30, color: '#f43f5e', treatment_category: 'other', sort_order: 8, is_active: true },
];

function createAppointmentTypesStore() {
	let list = $state<AppointmentType[]>([]);

	const map = $derived(
		Object.fromEntries(list.map((t) => [t.id, t])) as Record<string, AppointmentType>,
	);

	const active = $derived(list.filter((t) => t.is_active === 1));

	async function load() {
		list = await getAppointmentTypes();
		if (list.length === 0) {
			for (const d of DEFAULTS) {
				await insertAppointmentType(d);
			}
			list = await getAppointmentTypes();
		}
	}

	async function add(data: AppointmentTypeFormData) {
		const t = await insertAppointmentType(data);
		list = [...list, t];
		return t;
	}

	async function update(id: string, data: Partial<AppointmentTypeFormData>) {
		await updateAppointmentType(id, data);
		list = await getAppointmentTypes();
	}

	async function remove(id: string) {
		await deleteAppointmentType(id);
		list = await getAppointmentTypes();
	}

	return {
		get list() { return list; },
		get map() { return map; },
		get active() { return active; },
		load,
		add,
		update,
		remove,
	};
}

export const appointmentTypes = createAppointmentTypesStore();
