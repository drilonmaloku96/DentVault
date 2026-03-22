import { getAppointmentRooms, insertAppointmentRoom, updateAppointmentRoom, deleteAppointmentRoom } from '$lib/services/db';
import type { AppointmentRoom, AppointmentRoomFormData } from '$lib/types';

function createRoomsStore() {
	let list = $state<AppointmentRoom[]>([]);

	const map = $derived(
		Object.fromEntries(list.map((r) => [r.id, r])) as Record<string, AppointmentRoom>,
	);

	const active = $derived(list.filter((r) => r.is_active === 1));

	async function load() {
		list = await getAppointmentRooms();
		// Auto-seed defaults if empty
		if (list.length === 0) {
			await insertAppointmentRoom({ name: 'Stuhl 1', short_name: 'S1', color: '#6366f1', sort_order: 0, is_active: true });
			await insertAppointmentRoom({ name: 'Stuhl 2', short_name: 'S2', color: '#10b981', sort_order: 1, is_active: true });
			list = await getAppointmentRooms();
		}
	}

	async function add(data: AppointmentRoomFormData) {
		const room = await insertAppointmentRoom(data);
		list = [...list, room];
		return room;
	}

	async function update(id: string, data: Partial<AppointmentRoomFormData>) {
		await updateAppointmentRoom(id, data);
		list = await getAppointmentRooms();
	}

	async function remove(id: string) {
		await deleteAppointmentRoom(id);
		list = await getAppointmentRooms();
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

export const rooms = createRoomsStore();
