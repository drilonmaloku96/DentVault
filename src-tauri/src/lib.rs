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
    /// Path relative to the vault root: {patient_folder}/{category_folder}/{filename}
    rel_path: String,
    filename: String,
    /// Name of the immediate subdirectory (category folder) that contains the file.
    category_folder: String,
    file_size: u64,
    /// File modification time as an ISO-8601 date string (YYYY-MM-DD), or empty string.
    modified_at: String,
}

/// Recursively scan all immediate subdirectories of a patient folder and return
/// metadata for every regular file found.  Hidden files and `dentvault.db` are skipped.
#[tauri::command]
fn list_vault_files(vault_path: String, patient_folder: String) -> Result<Vec<VaultFileInfo>, String> {
    let patient_dir = PathBuf::from(&vault_path).join(&patient_folder);
    if !patient_dir.exists() {
        return Ok(vec![]);
    }

    let mut files: Vec<VaultFileInfo> = Vec::new();

    let dir_entries = std::fs::read_dir(&patient_dir).map_err(|e| e.to_string())?;
    for dir_entry in dir_entries.flatten() {
        let dir_path = dir_entry.path();
        if !dir_path.is_dir() {
            continue;
        }

        let category_folder = dir_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();

        // Skip hidden directories
        if category_folder.starts_with('.') {
            continue;
        }

        if let Ok(sub_entries) = std::fs::read_dir(&dir_path) {
            for sub_entry in sub_entries.flatten() {
                let sub_path = sub_entry.path();
                if !sub_path.is_file() {
                    continue;
                }

                let filename = sub_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();

                // Skip hidden files and the SQLite database
                if filename.starts_with('.') || filename == "dentvault.db" {
                    continue;
                }

                let meta = std::fs::metadata(&sub_path);
                let file_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
                // Format modified time as YYYY-MM-DD using std::time (no external crates needed)
                let modified_at = meta
                    .ok()
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| {
                        // Simplified Julian-day → Gregorian conversion (valid for 1970–2100)
                        let secs = d.as_secs();
                        let days = (secs / 86400) as u32;
                        let z = days + 719468;
                        let era = z / 146097;
                        let doe = z - era * 146097;
                        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
                        let y = yoe + era * 400;
                        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
                        let mp = (5 * doy + 2) / 153;
                        let d2 = doy - (153 * mp + 2) / 5 + 1;
                        let m2 = if mp < 10 { mp + 3 } else { mp - 9 };
                        let y2 = if m2 <= 2 { y + 1 } else { y };
                        format!("{:04}-{:02}-{:02}", y2, m2, d2)
                    })
                    .unwrap_or_default();

                let rel_path = format!("{}/{}/{}", patient_folder, &category_folder, &filename);
                files.push(VaultFileInfo {
                    abs_path: sub_path.to_string_lossy().replace('\\', "/").to_string(),
                    rel_path,
                    filename,
                    category_folder: category_folder.clone(),
                    file_size,
                    modified_at,
                });
            }
        }
    }

    Ok(files)
}

/// Check whether a file exists on disk.
#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
