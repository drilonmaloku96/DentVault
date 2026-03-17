/**
 * Simple reactive event bus for patient list invalidation.
 * Any component that mutates patient data should call patientBus.invalidate()
 * so the sidebar (and any other subscriber) refreshes automatically.
 */
let _version = $state(0);

export const patientBus = {
	get version(): number {
		return _version;
	},
	invalidate(): void {
		_version++;
	},
};
