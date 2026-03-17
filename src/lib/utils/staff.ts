import type { Doctor } from '$lib/types';
import { staffRoles } from '$lib/stores/staffRoles.svelte';

/** Display label for a staff member in dropdowns and cards. */
export function staffLabel(doc: Doctor): string {
	const role = staffRoles.get(doc.role);
	if (!role) {
		// Unknown role key: show name with role in parentheses
		return `${doc.name} (${doc.role})`;
	}
	return role.prefix ? `${role.prefix} ${doc.name}` : `${doc.name} (${role.label})`;
}

/** Human-readable label for a role key. */
export function roleLabel(key: string): string {
	return staffRoles.getLabel(key);
}

/** Short badge text — same as the role label. */
export function roleBadge(key: string): string {
	return staffRoles.getLabel(key);
}
