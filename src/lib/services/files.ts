import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
// DocumentCategory is now `string`; no import needed

// ── File picking ───────────────────────────────────────────────────────

/** Open a native file picker and return the selected file path (or null). */
export async function pickFile(): Promise<string | null> {
	const result = await dialogOpen({
		multiple: false,
		filters: [{ name: 'All Files', extensions: ['*'] }],
	});
	// With multiple:false, result is string | null
	return result ?? null;
}

/** Open a native directory picker and return the selected folder path (or null). */
export async function pickDirectory(): Promise<string | null> {
	const result = await dialogOpen({
		directory: true,
		multiple: false,
	});
	return result ?? null;
}

// ── Path resolution helpers ────────────────────────────────────────────

/**
 * Convert an absolute file path to a vault-relative path by stripping the vault prefix.
 * Returns the relative portion, e.g. "Smith_John_PT001/xrays/scan.pdf".
 */
export function toRelPath(absPath: string, vaultPath: string): string {
	const norm = absPath.replace(/\\/g, '/');
	const vaultNorm = vaultPath.replace(/\\/g, '/').replace(/\/$/, '');
	if (norm.startsWith(vaultNorm + '/')) {
		return norm.slice(vaultNorm.length + 1);
	}
	return norm; // fallback: return as-is
}

/**
 * Resolve a relative path to an absolute path using the current vault location.
 * If the input is already absolute (starts with / or drive letter), returns it as-is
 * for backward compatibility with legacy data.
 */
export function toAbsPath(relPath: string, vaultPath: string): string {
	if (!relPath) return '';
	// Already absolute (legacy data) — return as-is
	if (relPath.startsWith('/') || /^[A-Za-z]:/.test(relPath)) return relPath;
	const vaultNorm = vaultPath.replace(/\\/g, '/').replace(/\/$/, '');
	return `${vaultNorm}/${relPath}`;
}

// ── File operations via Rust commands ──────────────────────────────────

/**
 * Copy a picked file into the vault patient folder.
 * Returns { absPath, relPath, fileSize } on success.
 */
export async function saveDocumentFile(opts: {
	srcPath: string;
	vaultPath: string;
	patientFolder: string;
	categoryFolder: string;
	destFilename: string;
}): Promise<{ absPath: string; relPath: string; fileSize: number }> {
	const [absPath, relPath, fileSize] = await invoke<[string, string, number]>('save_document_file', {
		srcPath: opts.srcPath,
		vaultPath: opts.vaultPath,
		patientFolder: opts.patientFolder,
		categoryFolder: opts.categoryFolder,
		destFilename: opts.destFilename,
	});
	return { absPath, relPath, fileSize };
}

/** Delete a document file from disk. */
export async function deleteDocumentFile(absPath: string): Promise<void> {
	await invoke<void>('delete_document_file', { absPath });
}

// ── Vault file scanning ────────────────────────────────────────────────

/** Metadata returned by the Rust `list_vault_files` command. */
export interface VaultFileInfo {
	abs_path: string;
	/** Path relative to vault root: {patient_folder}/{category_folder}/{filename} */
	rel_path: string;
	filename: string;
	/** Name of the immediate category subfolder containing this file (e.g. "xrays", "photos"). */
	category_folder: string;
	file_size: number;
	/** File modification date as YYYY-MM-DD, used to pre-fill the timeline entry date. */
	modified_at: string;
}

/**
 * Scan all immediate subdirectories of a patient vault folder and return metadata
 * for every regular file found. Hidden files and dentvault.db are excluded by Rust.
 */
export async function listVaultFiles(
	vaultPath: string,
	patientFolder: string,
): Promise<VaultFileInfo[]> {
	return invoke<VaultFileInfo[]>('list_vault_files', { vaultPath, patientFolder });
}

/** Create the patient folder + subfolders inside the vault. */
export async function initPatientFolder(vaultPath: string, patientFolder: string): Promise<void> {
	await invoke<void>('init_patient_folder', { vaultPath, patientFolder });
}

// ── !TEMPLATE folder ───────────────────────────────────────────────────

/** The special vault-root folder that acts as a template for new patients. */
export const TEMPLATE_FOLDER = '!TEMPLATE';

// ── !Documents folder (document templates) ────────────────────────────

/** The vault-root folder holding reusable document templates. */
export const DOC_TEMPLATES_FOLDER = '!Documents';

export interface DocTemplateInfo {
	filename: string;
	abs_path: string;
	file_size: number;
}

/** Create `<vault>/!Documents/` if it does not exist. */
export async function ensureDocTemplatesFolder(vaultPath: string): Promise<void> {
	await invoke<void>('ensure_doc_templates_folder', { vaultPath });
}

/** List all files in `<vault>/!Documents/`, sorted alphabetically. */
export async function listDocTemplates(vaultPath: string): Promise<DocTemplateInfo[]> {
	return invoke<DocTemplateInfo[]>('list_doc_templates', { vaultPath });
}

/** Copy a picked file into `<vault>/!Documents/<destFilename>`. */
export async function saveDocTemplate(vaultPath: string, srcPath: string, destFilename: string): Promise<void> {
	await invoke<void>('save_doc_template', { vaultPath, srcPath, destFilename });
}

/**
 * Copy `<vault>/!Documents/<templateFilename>` into the patient's subfolder.
 * Returns [absPath, relPath, fileSize].
 */
export async function copyDocTemplateToPatient(
	vaultPath: string,
	templateFilename: string,
	patientFolder: string,
	categoryFolder: string,
	destFilename: string,
): Promise<[string, string, number]> {
	return invoke<[string, string, number]>('copy_doc_template_to_patient', {
		vaultPath, templateFilename, patientFolder, categoryFolder, destFilename,
	});
}

/** Delete a file from `<vault>/!Documents/<filename>`. */
export async function deleteDocTemplate(vaultPath: string, filename: string): Promise<void> {
	await invoke<void>('delete_doc_template', { vaultPath, filename });
}

/**
 * Create `<vault>/!TEMPLATE/` and one subfolder per category folder name.
 * Safe to call on every save — it only creates, never deletes.
 */
export async function ensureTemplateStructure(vaultPath: string, categoryFolders: string[]): Promise<void> {
	await invoke<void>('ensure_template_structure', { vaultPath, categoryFolders });
}

/**
 * Return subfolder names found inside `<vault>/!TEMPLATE/`.
 * Empty array if the template folder does not exist yet.
 */
export async function getTemplateCategories(vaultPath: string): Promise<string[]> {
	return invoke<string[]>('get_template_categories', { vaultPath });
}

/**
 * Create a new patient folder by copying the `!TEMPLATE` tree into it.
 * Each template subfolder is recreated and its files are copied.
 * If no `!TEMPLATE` exists, creates empty folders from `fallbackFolders`.
 */
export async function copyTemplateToPatient(
	vaultPath: string,
	patientFolder: string,
	fallbackFolders: string[],
): Promise<void> {
	await invoke<void>('copy_template_to_patient', { vaultPath, patientFolder, fallbackFolders });
}

/** Recursively delete a patient's folder from the vault. No-op if not found. */
export async function deletePatientFolder(vaultPath: string, patientFolder: string): Promise<void> {
	await invoke<void>('delete_patient_folder', { vaultPath, patientFolder });
}

/** Write a UTF-8 string to a file, creating parent directories as needed. */
export async function writeTextFile(destPath: string, content: string): Promise<void> {
	await invoke<void>('write_text_file', { destPath, content });
}

/**
 * Copy a patient's vault category subfolders into destDir.
 * Each subfolder (xrays, photos, etc.) is copied directly into destDir.
 */
export async function copyPatientFolderTo(
	vaultPath: string,
	patientFolder: string,
	destDir: string,
): Promise<void> {
	await invoke<void>('copy_patient_folder_to', { vaultPath, patientFolder, destDir });
}

/** Open a file with the default OS application. */
export async function openDocumentFile(absPath: string): Promise<void> {
	await invoke<void>('open_file_native', { path: absPath });
}

// ── Asset URL conversion ───────────────────────────────────────────────

/** Convert an absolute file path to a WebView-safe asset:// URL for display. */
export function fileToAssetUrl(absPath: string): string {
	return convertFileSrc(absPath);
}

// ── File metadata helpers ──────────────────────────────────────────────

/** Infer MIME type from file extension (client-side only). */
export function getMimeType(filename: string): string {
	const ext = filename.split('.').pop()?.toLowerCase() ?? '';
	const map: Record<string, string> = {
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		gif: 'image/gif',
		webp: 'image/webp',
		bmp: 'image/bmp',
		svg: 'image/svg+xml',
		pdf: 'application/pdf',
		doc: 'application/msword',
		docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		xls: 'application/vnd.ms-excel',
		xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		txt: 'text/plain',
		csv: 'text/csv',
		dcm: 'application/dicom',
	};
	return map[ext] ?? 'application/octet-stream';
}

/** Returns true if the MIME type is a displayable image. */
export function isImageMime(mimeType: string): boolean {
	return mimeType.startsWith('image/') && mimeType !== 'image/svg+xml';
}

/** Format a byte count into a human-readable string. */
export function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Infer a sensible default document category key from filename / MIME type.
 *  Returns one of the built-in keys; the upload dialog lets the user override it. */
export function inferCategory(filename: string, mimeType: string): string {
	const name = filename.toLowerCase();
	const ext = name.split('.').pop() ?? '';
	if (ext === 'dcm' || name.includes('xray') || name.includes('x-ray') || name.includes('radiograph')) {
		return 'xray';
	}
	if (mimeType.startsWith('image/')) return 'photo';
	if (name.includes('lab') || name.includes('result') || ext === 'csv' || ext === 'xlsx') return 'lab';
	if (name.includes('referral') || name.includes('refer')) return 'referral';
	if (name.includes('consent') || name.includes('form')) return 'consent';
	return 'other';
}

/**
 * Generate a unique destination filename that preserves the original extension.
 * Format: {timestamp}_{sanitized_original}
 */
export function generateDestFilename(originalPath: string): string {
	const parts = originalPath.replace(/\\/g, '/').split('/');
	const originalName = parts[parts.length - 1];
	const sanitized = originalName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_+/g, '_');
	return `${Date.now()}_${sanitized}`;
}
