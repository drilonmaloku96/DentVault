/**
 * doctors.svelte.ts
 *
 * Reactive store for the `doctors` table.
 * Exposes a list of doctors + a Map<id, Doctor> for O(1) lookup.
 * Used by: TimelineEntryBar (selector), TimelineEntryCard (display),
 *          filter chips in TimelineView, and Settings › Doctors.
 */

import type { Doctor, DoctorFormData } from '$lib/types';
import { getDoctors, insertDoctor, updateDoctor, deleteDoctor } from '$lib/services/db';

function createDoctorsStore() {
	let list = $state<Doctor[]>([]);
	let loaded = $state(false);

	/** Keyed map id → Doctor for fast lookup */
	const map = $derived(new Map(list.map((d) => [d.id, d])));

	async function load() {
		list   = await getDoctors();
		loaded = true;
	}

	async function add(data: DoctorFormData): Promise<Doctor> {
		const doc = await insertDoctor(data);
		list = [...list, doc].sort((a, b) => a.name.localeCompare(b.name));
		return doc;
	}

	async function update(id: number, data: Partial<DoctorFormData>): Promise<void> {
		await updateDoctor(id, data);
		list = list.map((d) => (d.id === id ? { ...d, ...data } : d));
	}

	async function remove(id: number): Promise<void> {
		await deleteDoctor(id);
		list = list.filter((d) => d.id !== id);
	}

	return {
		get list()   { return list; },
		get map()    { return map; },
		get loaded() { return loaded; },
		load,
		add,
		update,
		remove,
	};
}

export const doctors = createDoctorsStore();
