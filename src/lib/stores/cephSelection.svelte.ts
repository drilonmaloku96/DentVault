import type { VaultFileInfo } from '$lib/services/files';

function createCephSelection() {
	let file = $state<VaultFileInfo | null>(null);

	return {
		get file() { return file; },
		get isCeph() { return file ? isCephFileType(file.filename) : false; },
		select(f: VaultFileInfo | null) { file = f; },
		clear() { file = null; },
	};
}

export const cephSelection = createCephSelection();

export const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'tif', 'tiff']);

export function isImageFile(filename: string): boolean {
	return IMAGE_EXTS.has(filename.split('.').pop()?.toLowerCase() ?? '');
}

export function isCephFileType(filename: string): boolean {
	return filename.toLowerCase().endsWith('.ceph');
}

export function isCephCompatible(filename: string): boolean {
	return isImageFile(filename) || isCephFileType(filename);
}
