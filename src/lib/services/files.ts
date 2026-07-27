import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open as dialogOpen } from '@tauri-apps/plugin-dialog';
import { getFilesTransport, isConnectedFilesMode } from './files-connection';
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
 * Copy a picked/dropped file into the vault patient folder.
 * Returns { absPath, relPath, fileSize } on success — absPath is '' in connected mode
 * (no local absolute path exists for a server-hosted file; rel_path is the portable
 * source of truth used everywhere else per the July 2026 export-path audit).
 *
 * Routes through files-connection.ts: solo mode calls the Tauri command as before,
 * connected mode reads srcPath's local bytes and uploads them via POST /files/upload.
 */
export async function saveDocumentFile(opts: {
	srcPath: string;
	vaultPath: string;
	patientFolder: string;
	categoryFolder: string;
	destFilename: string;
}): Promise<{ absPath: string; relPath: string; fileSize: number }> {
	const transport = await getFilesTransport(opts.vaultPath);
	return transport.saveDocumentFile(opts);
}

/** Delete a document file from disk. */
export async function deleteDocumentFile(absPath: string): Promise<void> {
	await invoke<void>('delete_document_file', { absPath });
}

// ── Vault file scanning ────────────────────────────────────────────────

/** Metadata returned by the Rust `list_vault_files` command. */
export interface VaultFileInfo {
	abs_path: string;
	/** Path relative to vault root, e.g. {patient}/{cat}/{filename} or {patient}/{cat}/{sub}/{filename} */
	rel_path: string;
	filename: string;
	/** Name of the top-level category subfolder containing this file (e.g. "xrays"). */
	category_folder: string;
	/** Sub-directory path within the category folder using `/` separator.
	 *  Empty string for files directly in the category folder; e.g. "2023" or "2023/January". */
	path_in_category: string;
	file_size: number;
	/** File modification date as YYYY-MM-DD, used to pre-fill the timeline entry date. */
	modified_at: string;
}

/**
 * Scan all immediate subdirectories of a patient vault folder and return metadata
 * for every regular file found. Hidden files and dentvault.db are excluded by Rust.
 *
 * Routes through files-connection.ts: solo mode calls the Tauri command as before,
 * connected mode calls dentvault-server's GET /files/list/{patientFolder} — vaultPath is
 * only used by the local path (the server already knows its own vault root).
 */
export async function listVaultFiles(
	vaultPath: string,
	patientFolder: string,
): Promise<VaultFileInfo[]> {
	const transport = await getFilesTransport(vaultPath);
	return transport.listFiles(patientFolder);
}

/**
 * Resolve a vault-relative path to a URL the webview can actually load. Solo mode returns
 * a Tauri `asset://` URL (fileToAssetUrl) as before; connected mode has no local file to
 * point at, so it fetches the bytes over HTTP and returns a `blob:` URL instead — the
 * caller is responsible for revoking it (`URL.revokeObjectURL`) when done, same as any
 * other blob URL.
 */
export async function getFileDisplayUrl(relPath: string, vaultPath: string): Promise<string> {
	if (await isConnectedFilesMode()) {
		const transport = await getFilesTransport(vaultPath);
		const bytes = await transport.getFileBytes(relPath);
		const mime = getMimeType(relPath);
		return URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
	}
	return fileToAssetUrl(toAbsPath(relPath, vaultPath));
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
	/** Path relative to `!Documents/` root. E.g. "Contract.pdf" or "Forms/Consent.pdf". */
	rel_path: string;
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

/** Rename a patient's folder in the vault. No-op if source missing; throws if target exists. */
export async function renamePatientFolder(
	vaultPath: string,
	oldFolder: string,
	newFolder: string,
): Promise<void> {
	await invoke<void>('rename_patient_folder', { vaultPath, oldFolder, newFolder });
}

/** Write a UTF-8 string to a file, creating parent directories as needed. */
export async function writeTextFile(destPath: string, content: string): Promise<void> {
	await invoke<void>('write_text_file', { destPath, content });
}

/**
 * Copy a file from srcPath to destPath on disk, creating parent directories as needed.
 * Returns the file size in bytes.
 *
 * Local-only — takes an absolute destPath, which doesn't exist in connected mode. Use
 * `saveDocumentFile` instead for anything that needs to work in both modes (it takes a
 * vault-relative destination and routes through files-connection.ts) — VaultDropDialog
 * (the only caller as of July 2026) was switched to it for exactly this reason.
 */
export async function copyFileToVault(srcPath: string, destPath: string): Promise<number> {
	return invoke<number>('copy_file_to_vault', { srcPath, destPath });
}

// ── Patient folder tree ────────────────────────────────────────────────────

export interface FolderNode {
	name: string;
	rel_path: string;
	children: FolderNode[];
}

/** Return the folder tree for a patient (category folders + subfolders). */
export async function listPatientFolders(vaultPath: string, patientFolder: string): Promise<FolderNode[]> {
	const transport = await getFilesTransport(vaultPath);
	return transport.listFolderTree(patientFolder);
}

/** Create a new subfolder inside a patient's vault. Returns the new folder's rel_path. */
export async function createPatientSubfolder(
	vaultPath: string,
	patientFolder: string,
	parentRel: string,
	folderName: string,
): Promise<string> {
	const transport = await getFilesTransport(vaultPath);
	return transport.createSubfolder(patientFolder, parentRel, folderName);
}

/** Move a patient vault folder to a new parent folder. */
export async function movePatientFolder(
	vaultPath: string,
	patientFolder: string,
	srcRel: string,
	destParentRel: string,
): Promise<void> {
	const transport = await getFilesTransport(vaultPath);
	await transport.moveFolder(patientFolder, srcRel, destParentRel);
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
		tif: 'image/tiff',
		tiff: 'image/tiff',
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
