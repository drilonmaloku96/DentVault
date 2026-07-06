/**
 * Currently selected file in the patient sidebar file tree (PatientTreeView).
 *
 * Single-click on any file selects it; the TimelineView toolbar's Ceph Analysis
 * button activates when the selection is a Cephalyzer-compatible image (or a
 * saved .ceph analysis) belonging to the open patient.
 */

export interface CephSelectableFile {
	/** Path relative to vault root, e.g. "Smith_John_PT001/xrays/scan.png" */
	relPath: string;
	filename: string;
	patientId: string;
}

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff'];

let _selected = $state<CephSelectableFile | null>(null);

export const cephSelection = {
	get file(): CephSelectableFile | null {
		return _selected;
	},

	/** True when the selection can be opened in Cephalyzer (image or saved .ceph). */
	get isAnalyzable(): boolean {
		if (!_selected) return false;
		const ext = _selected.filename.split('.').pop()?.toLowerCase() ?? '';
		return IMAGE_EXTENSIONS.includes(ext) || ext === 'ceph';
	},

	select(file: CephSelectableFile): void {
		_selected = file;
	},

	/** Toggle-style select: clicking the already-selected file deselects it. */
	toggle(file: CephSelectableFile): void {
		_selected = _selected?.relPath === file.relPath ? null : file;
	},

	isSelected(relPath: string): boolean {
		return _selected?.relPath === relPath;
	},

	clear(): void {
		_selected = null;
	},
};
