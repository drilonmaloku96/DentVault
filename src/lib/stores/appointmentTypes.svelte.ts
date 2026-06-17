import { getAppointmentTypes, insertAppointmentType, updateAppointmentType, deleteAppointmentType } from '$lib/services/db';
import type { AppointmentType, AppointmentTypeFormData } from '$lib/types';
import { i18n } from '$lib/i18n';

function createAppointmentTypesStore() {
	let list = $state<AppointmentType[]>([]);

	const map = $derived(
		Object.fromEntries(list.map((t) => [t.id, t])) as Record<string, AppointmentType>,
	);

	const active = $derived(list.filter((t) => t.is_active === 1));

	async function load() {
		list = await getAppointmentTypes();
		if (list.length === 0) {
			const defaults = i18n.t.defaults.appointmentTypes;
			for (let i = 0; i < defaults.length; i++) {
				await insertAppointmentType({ ...defaults[i], sort_order: i, is_active: true });
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
