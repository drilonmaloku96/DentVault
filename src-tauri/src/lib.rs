use std::path::PathBuf;
use tauri::Manager;

// ── Vault config helpers ───────────────────────────────────────────────

fn vault_path_file(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;
    Ok(data_dir.join("vault_path.txt"))
}

fn read_vault_path(app: &tauri::AppHandle) -> Option<String> {
    let path_file = vault_path_file(app).ok()?;
    std::fs::read_to_string(path_file)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

// ── Vault commands ─────────────────────────────────────────────────────

#[tauri::command]
fn get_vault_path(app: tauri::AppHandle) -> Option<String> {
    read_vault_path(&app)
}

#[tauri::command]
fn save_vault_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let path_file = vault_path_file(&app)?;
    std::fs::write(path_file, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_db_url(app: tauri::AppHandle) -> String {
    if let Some(vault) = read_vault_path(&app) {
        // Build absolute DB path inside the vault folder
        let db_path = PathBuf::from(&vault).join("dentvault.db");
        // tauri-plugin-sql interprets paths starting after "sqlite:" as absolute
        // when they begin with "/" (Unix) or drive letter (Windows).
        format!("sqlite:{}", db_path.to_string_lossy().replace('\\', "/"))
    } else {
        // Fall back to app data dir (relative path)
        "sqlite:dentvault.db".to_string()
    }
}

/// Create the patient folder structure inside the vault.
#[tauri::command]
fn init_patient_folder(vault_path: String, patient_folder: String) -> Result<(), String> {
    let base = PathBuf::from(&vault_path).join(&patient_folder);
    for sub in &["xrays", "photos", "documents", "lab_results", "consents", "referrals"] {
        std::fs::create_dir_all(base.join(sub)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── File management commands ───────────────────────────────────────────

/// Copy a picked file into the vault patient folder and return (abs_dest_path, rel_path, file_size_bytes).
#[tauri::command]
fn save_document_file(
    vault_path: String,
    patient_folder: String,
    category_folder: String,
    dest_filename: String,
    src_path: String,
) -> Result<(String, String, u64), String> {
    let dest_dir = PathBuf::from(&vault_path)
        .join(&patient_folder)
        .join(&category_folder);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;

    let file_size = std::fs::metadata(&src_path)
        .map_err(|e| format!("Cannot read source file: {e}"))?
        .len();

    let dest_path = dest_dir.join(&dest_filename);
    std::fs::copy(&src_path, &dest_path)
        .map_err(|e| format!("Copy failed: {e}"))?;

    let rel_path = format!("{}/{}/{}", patient_folder, category_folder, dest_filename);
    Ok((dest_path.to_string_lossy().to_string(), rel_path, file_size))
}

/// Delete a document file from disk.
#[tauri::command]
fn delete_document_file(abs_path: String) -> Result<(), String> {
    let p = std::path::Path::new(&abs_path);
    if p.exists() {
        std::fs::remove_file(p).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Metadata about a single file found in the vault.
#[derive(serde::Serialize)]
struct VaultFileInfo {
    abs_path: String,
    /// Path relative to the vault root, e.g. {patient}/{cat}/{filename} or {patient}/{cat}/{sub}/{filename}
    rel_path: String,
    filename: String,
    /// Name of the top-level category subfolder containing this file (e.g. "xrays").
    category_folder: String,
    /// Sub-directory path within the category folder, using `/` separator.
    /// Empty string for files directly in the category folder; e.g. "2023" or "2023/January".
    path_in_category: String,
    file_size: u64,
    /// File modification time as an ISO-8601 date string (YYYY-MM-DD), or empty string.
    modified_at: String,
}

fn secs_to_date(secs: u64) -> String {
    let days = (secs / 86400) as u32;
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y2 = if m <= 2 { y + 1 } else { y };
    format!("{:04}-{:02}-{:02}", y2, m, d)
}

fn collect_patient_files(
    dir: &PathBuf,
    patient_folder: &str,
    category_folder: &str,
    path_in_category: &str,
    files: &mut Vec<VaultFileInfo>,
) {
    let entries = match std::fs::read_dir(dir) { Ok(e) => e, Err(_) => return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        if path.is_dir() {
            let sub = if path_in_category.is_empty() { name } else { format!("{}/{}", path_in_category, name) };
            collect_patient_files(&path, patient_folder, category_folder, &sub, files);
        } else if path.is_file() {
            if name == "dentvault.db" { continue; }
            let meta = std::fs::metadata(&path);
            let file_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified_at = meta.ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| secs_to_date(d.as_secs()))
                .unwrap_or_default();
            let rel_path = if path_in_category.is_empty() {
                format!("{}/{}/{}", patient_folder, category_folder, name)
            } else {
                format!("{}/{}/{}/{}", patient_folder, category_folder, path_in_category, name)
            };
            files.push(VaultFileInfo {
                abs_path: path.to_string_lossy().replace('\\', "/").to_string(),
                rel_path,
                filename: name,
                category_folder: category_folder.to_string(),
                path_in_category: path_in_category.to_string(),
                file_size,
                modified_at,
            });
        }
    }
}

/// Recursively scan all subdirectories of a patient folder and return metadata for every file found.
/// Hidden files and `dentvault.db` are skipped.
#[tauri::command]
fn list_vault_files(vault_path: String, patient_folder: String) -> Result<Vec<VaultFileInfo>, String> {
    let patient_dir = PathBuf::from(&vault_path).join(&patient_folder);
    if !patient_dir.exists() {
        return Ok(vec![]);
    }
    let mut files: Vec<VaultFileInfo> = Vec::new();
    for entry in std::fs::read_dir(&patient_dir).map_err(|e| e.to_string())?.flatten() {
        let dir_path = entry.path();
        if !dir_path.is_dir() { continue; }
        let cat_folder = match dir_path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        collect_patient_files(&dir_path, &patient_folder, &cat_folder, "", &mut files);
    }
    Ok(files)
}

/// Check whether a file exists on disk.
#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

/// Recursively delete a patient folder from the vault. No-op if it doesn't exist.
#[tauri::command]
fn delete_patient_folder(vault_path: String, patient_folder: String) -> Result<(), String> {
    let target = PathBuf::from(&vault_path).join(&patient_folder);
    if target.exists() {
        std::fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── !TEMPLATE folder commands ──────────────────────────────────────────

/// Create `<vault>/!TEMPLATE/` (and one subfolder per category) plus
/// `<vault>/!Documents/` — both special vault-root folders, always together.
/// Safe to call repeatedly — only creates, never deletes.
#[tauri::command]
fn ensure_template_structure(vault_path: String, category_folders: Vec<String>) -> Result<(), String> {
    let template = PathBuf::from(&vault_path).join("!TEMPLATE");
    std::fs::create_dir_all(&template).map_err(|e| e.to_string())?;
    for folder in &category_folders {
        std::fs::create_dir_all(template.join(folder)).map_err(|e| e.to_string())?;
    }
    // !Documents is always created alongside !TEMPLATE — they are both vault-root
    // special folders and must always exist together.
    let documents = PathBuf::from(&vault_path).join("!Documents");
    std::fs::create_dir_all(&documents).map_err(|e| e.to_string())?;
    Ok(())
}

/// Return the names of all non-hidden subdirectories inside `<vault>/!TEMPLATE/`.
/// Returns an empty list if the template folder does not exist yet.
#[tauri::command]
fn get_template_categories(vault_path: String) -> Result<Vec<String>, String> {
    let template = PathBuf::from(&vault_path).join("!TEMPLATE");
    if !template.exists() {
        return Ok(vec![]);
    }
    let mut folders: Vec<String> = std::fs::read_dir(&template)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            if !path.is_dir() { return None; }
            let name = path.file_name()?.to_str()?.to_string();
            if name.starts_with('.') { return None; }
            Some(name)
        })
        .collect();
    folders.sort();
    Ok(folders)
}

/// Copy the entire `!TEMPLATE` folder tree to a new patient folder.
/// For each subfolder in `!TEMPLATE/`, creates the matching subfolder in the patient
/// directory and copies all regular files into it.
/// Falls back to creating empty folders from `fallback_folders` if no template exists.
#[tauri::command]
fn copy_template_to_patient(
    vault_path: String,
    patient_folder: String,
    fallback_folders: Vec<String>,
) -> Result<(), String> {
    let vault = PathBuf::from(&vault_path);
    let template = vault.join("!TEMPLATE");
    let patient = vault.join(&patient_folder);
    std::fs::create_dir_all(&patient).map_err(|e| e.to_string())?;

    if template.exists() {
        for entry in std::fs::read_dir(&template).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let src_dir = entry.path();
            if !src_dir.is_dir() { continue; }
            let folder_name = match src_dir.file_name().and_then(|n| n.to_str()) {
                Some(n) if !n.starts_with('.') => n.to_string(),
                _ => continue,
            };
            let dest_dir = patient.join(&folder_name);
            std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
            if let Ok(files) = std::fs::read_dir(&src_dir) {
                for file_entry in files.flatten() {
                    let src_file = file_entry.path();
                    if !src_file.is_file() { continue; }
                    let filename = match src_file.file_name().and_then(|n| n.to_str()) {
                        Some(n) if !n.starts_with('.') => n.to_string(),
                        _ => continue,
                    };
                    // Non-fatal: skip files that fail to copy
                    let _ = std::fs::copy(&src_file, dest_dir.join(&filename));
                }
            }
        }
    } else {
        // No template yet — create empty folders from the fallback list
        for folder in &fallback_folders {
            std::fs::create_dir_all(patient.join(folder)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ── Backup commands ────────────────────────────────────────────────────

/// Copy dentvault.db to the given destination path.
#[tauri::command]
fn backup_database(vault_path: String, dest_path: String) -> Result<(), String> {
    let db_src = PathBuf::from(&vault_path).join("dentvault.db");
    if !db_src.exists() {
        return Err("Database file not found".to_string());
    }
    if let Some(parent) = PathBuf::from(&dest_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::copy(&db_src, &dest_path).map_err(|e| format!("Backup failed: {e}"))?;
    Ok(())
}

fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> Result<u64, String> {
    std::fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    let mut count = 0u64;
    for entry in std::fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_name = entry.file_name();
        let dst_child = dst.join(&file_name);
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            count += copy_dir_all(&entry.path(), &dst_child)?;
        } else if file_type.is_file() {
            std::fs::copy(entry.path(), &dst_child).map_err(|e| e.to_string())?;
            count += 1;
        }
    }
    Ok(count)
}

/// Recursively copy the entire vault directory into dest_dir/DentVault-Backup-{date}/.
/// Returns the absolute path of the created backup folder.
#[tauri::command]
fn backup_vault_to(vault_path: String, dest_dir: String) -> Result<String, String> {
    let src = PathBuf::from(&vault_path);
    if !src.exists() {
        return Err("Vault directory not found".to_string());
    }
    // Derive YYYY-MM-DD from UNIX timestamp without external crates
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();
    let days = (secs / 86400) as u32;
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y2 = if m <= 2 { y + 1 } else { y };
    let date_str = format!("{:04}-{:02}-{:02}", y2, m, d);

    let folder_name = format!("DentVault-Backup-{}", date_str);
    let dest = PathBuf::from(&dest_dir).join(&folder_name);
    copy_dir_all(&src, &dest)?;
    Ok(dest.to_string_lossy().to_string())
}

// ── Export commands ────────────────────────────────────────────────────

/// Write a UTF-8 string to a file, creating parent directories as needed.
#[tauri::command]
fn write_text_file(dest_path: String, content: String) -> Result<(), String> {
    let path = PathBuf::from(&dest_path);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

/// Copy a patient's vault category subfolders into dest_dir.
/// Each category subfolder (xrays/, photos/, etc.) is copied directly into dest_dir.
/// No-op if the patient folder doesn't exist.
#[tauri::command]
fn copy_patient_folder_to(vault_path: String, patient_folder: String, dest_dir: String) -> Result<(), String> {
    let src = PathBuf::from(&vault_path).join(&patient_folder);
    if !src.exists() {
        return Ok(());
    }
    let dest = PathBuf::from(&dest_dir);
    std::fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(&src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            let folder_name = match path.file_name().and_then(|n| n.to_str()) {
                Some(n) if !n.starts_with('.') => n.to_string(),
                _ => continue,
            };
            copy_dir_all(&path, &dest.join(&folder_name))?;
        }
    }
    Ok(())
}

// ── Audit log helpers ──────────────────────────────────────────────────

/// Append a single line to <vault_path>/audit.jsonl (creates file if needed).
#[tauri::command]
fn append_audit_line(vault_path: String, line: String) -> Result<(), String> {
    use std::io::Write;
    let path = std::path::Path::new(&vault_path).join("audit.jsonl");
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{}", line).map_err(|e| e.to_string())
}

/// Read the entire audit.jsonl file as a string (returns "" if file doesn't exist).
#[tauri::command]
fn read_audit_log(vault_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&vault_path).join("audit.jsonl");
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// Open a file or folder with the OS default application.
/// Uses the platform-native launcher so it bypasses any plugin scoping issues.
#[tauri::command]
fn open_file_native(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── Document Templates (!Documents folder) ───────────────────────────────

const DOC_TEMPLATES_FOLDER: &str = "!Documents";

#[derive(serde::Serialize)]
struct DocTemplateInfo {
    filename: String,
    abs_path: String,
    file_size: u64,
    /// Path relative to `!Documents/` root, using `/` separator.
    /// E.g. "Contract.pdf" for root-level files, "Forms/Consent.pdf" for nested.
    rel_path: String,
}

fn collect_doc_templates(dir: &PathBuf, rel_prefix: &str, results: &mut Vec<DocTemplateInfo>) {
    let entries = match std::fs::read_dir(dir) { Ok(e) => e, Err(_) => return };
    let mut items: Vec<(String, PathBuf)> = entries.flatten()
        .filter_map(|e| {
            let p = e.path();
            let name = p.file_name()?.to_str()?.to_string();
            if name.starts_with('.') { return None; }
            Some((name, p))
        })
        .collect();
    items.sort_by(|a, b| a.0.to_lowercase().cmp(&b.0.to_lowercase()));
    for (name, path) in items {
        let rel = if rel_prefix.is_empty() { name.clone() } else { format!("{}/{}", rel_prefix, name) };
        if path.is_dir() {
            collect_doc_templates(&path, &rel, results);
        } else if path.is_file() {
            let file_size = path.metadata().map(|m| m.len()).unwrap_or(0);
            results.push(DocTemplateInfo {
                abs_path: path.to_string_lossy().to_string(),
                filename: name,
                file_size,
                rel_path: rel,
            });
        }
    }
}

/// Create `<vault>/!Documents/` if it does not exist yet.
#[tauri::command]
fn ensure_doc_templates_folder(vault_path: String) -> Result<(), String> {
    let dir = PathBuf::from(&vault_path).join(DOC_TEMPLATES_FOLDER);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())
}

/// Recursively list all files inside `<vault>/!Documents/`, sorted alphabetically.
/// Each entry includes `rel_path` relative to `!Documents/` root.
#[tauri::command]
fn list_doc_templates(vault_path: String) -> Result<Vec<DocTemplateInfo>, String> {
    let dir = PathBuf::from(&vault_path).join(DOC_TEMPLATES_FOLDER);
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut results = Vec::new();
    collect_doc_templates(&dir, "", &mut results);
    Ok(results)
}

/// Copy a file from `src_path` into `<vault>/!Documents/<dest_filename>`.
#[tauri::command]
fn save_doc_template(vault_path: String, src_path: String, dest_filename: String) -> Result<(), String> {
    let dir = PathBuf::from(&vault_path).join(DOC_TEMPLATES_FOLDER);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = dir.join(&dest_filename);
    std::fs::copy(&src_path, &dest).map_err(|e| format!("Copy failed: {e}"))?;
    Ok(())
}

/// Copy `<vault>/!Documents/<template_filename>` into
/// `<vault>/<patient_folder>/<category_folder>/<dest_filename>`.
/// Returns (abs_path, rel_path, file_size).
#[tauri::command]
fn copy_doc_template_to_patient(
    vault_path: String,
    template_filename: String,
    patient_folder: String,
    category_folder: String,
    dest_filename: String,
) -> Result<(String, String, u64), String> {
    let src = PathBuf::from(&vault_path).join(DOC_TEMPLATES_FOLDER).join(&template_filename);
    if !src.exists() {
        return Err(format!("Template file not found: {template_filename}"));
    }
    let dest_dir = PathBuf::from(&vault_path).join(&patient_folder).join(&category_folder);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let dest = dest_dir.join(&dest_filename);
    let file_size = std::fs::copy(&src, &dest).map_err(|e| format!("Copy failed: {e}"))?;
    let rel_path = format!("{}/{}/{}", patient_folder, category_folder, dest_filename);
    Ok((dest.to_string_lossy().to_string(), rel_path, file_size))
}

/// Delete a file from `<vault>/!Documents/<filename>`.
#[tauri::command]
fn delete_doc_template(vault_path: String, filename: String) -> Result<(), String> {
    let path = PathBuf::from(&vault_path).join(DOC_TEMPLATES_FOLDER).join(&filename);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Read only the last non-empty line of audit.jsonl (for checksum chaining).
#[tauri::command]
fn read_last_audit_line(vault_path: String) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    let path = std::path::Path::new(&vault_path).join("audit.jsonl");
    if !path.exists() {
        return Ok(String::new());
    }
    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let file_size = file.metadata().map_err(|e| e.to_string())?.len();
    if file_size == 0 {
        return Ok(String::new());
    }
    // Read the last 8 KB at most to find the last line
    let seek_pos = if file_size > 8192 { file_size - 8192 } else { 0 };
    file.seek(SeekFrom::Start(seek_pos)).map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let content = String::from_utf8_lossy(&buf);
    let last = content.lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("").to_string();
    Ok(last)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        // SQL plugin with no pre-registered migrations — TypeScript handles schema init
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            get_vault_path,
            save_vault_path,
            get_db_url,
            init_patient_folder,
            save_document_file,
            delete_document_file,
            list_vault_files,
            file_exists,
            backup_database,
            backup_vault_to,
            append_audit_line,
            read_audit_log,
            read_last_audit_line,
            open_file_native,
            ensure_template_structure,
            get_template_categories,
            copy_template_to_patient,
            delete_patient_folder,
            write_text_file,
            copy_patient_folder_to,
            ensure_doc_templates_folder,
            list_doc_templates,
            save_doc_template,
            copy_doc_template_to_patient,
            delete_doc_template,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
