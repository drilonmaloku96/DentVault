/**
 * Global single-active-patient store.
 * Set when a patient page loads; persists across navigation so the
 * schedule page and sidebar can reference it.
 */
let _id        = $state('');
let _firstname = $state('');
let _lastname  = $state('');

export const activePatient = {
	get id()        { return _id; },
	get firstname() { return _firstname; },
	get lastname()  { return _lastname; },
	/** "Lastname, Firstname" — empty string when no patient active */
	get displayName() {
		return _id ? `${_lastname}, ${_firstname}` : '';
	},
	set(id: string, firstname: string, lastname: string) {
		_id = id; _firstname = firstname; _lastname = lastname;
	},
	clear() {
		_id = ''; _firstname = ''; _lastname = '';
	},
};
