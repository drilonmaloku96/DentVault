use axum::extract::{Multipart, Path as AxPath, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

use crate::state::AppState;

/// Mirrors src-tauri's VaultFileInfo field-for-field — the TS side's `list_vault_files`
/// consumer doesn't need to know whether it's talking to the Tauri command or this HTTP
/// endpoint (ROADMAP_MULTI_COMPUTER.md §3.3's file-transport table).
#[derive(Serialize)]
pub struct VaultFileInfo {
    abs_path: String,
    rel_path: String,
    filename: String,
    category_folder: String,
    path_in_category: String,
    file_size: u64,
    modified_at: String,
}

fn err(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<serde_json::Value>) {
    (status, Json(serde_json::json!({ "error": msg.into() })))
}

/// Rejects any relative path that escapes the vault root via `..` — every /files/*
/// endpoint takes a vault-relative path from the network and must not trust it blindly.
fn safe_join(vault_path: &Path, rel: &str) -> Result<PathBuf, (StatusCode, Json<serde_json::Value>)> {
    if rel.contains('\0') {
        return Err(err(StatusCode::BAD_REQUEST, "invalid path"));
    }
    let candidate = vault_path.join(rel);
    for component in Path::new(rel).components() {
        if matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)) {
            return Err(err(StatusCode::BAD_REQUEST, "path must be relative and stay inside the vault"));
        }
    }
    Ok(candidate)
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
    dir: &Path,
    patient_folder: &str,
    category_folder: &str,
    path_in_category: &str,
    files: &mut Vec<VaultFileInfo>,
) {
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        if path.is_dir() {
            let sub = if path_in_category.is_empty() { name } else { format!("{path_in_category}/{name}") };
            collect_patient_files(&path, patient_folder, category_folder, &sub, files);
        } else if path.is_file() {
            if name == "dentvault.db" {
                continue;
            }
            let meta = std::fs::metadata(&path);
            let file_size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let modified_at = meta
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| secs_to_date(d.as_secs()))
                .unwrap_or_default();
            let rel_path = if path_in_category.is_empty() {
                format!("{patient_folder}/{category_folder}/{name}")
            } else {
                format!("{patient_folder}/{category_folder}/{path_in_category}/{name}")
            };
            files.push(VaultFileInfo {
                abs_path: path.to_string_lossy().into_owned(),
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

pub async fn list_files(
    State(state): State<AppState>,
    AxPath(patient_folder): AxPath<String>,
) -> Result<Json<Vec<VaultFileInfo>>, (StatusCode, Json<serde_json::Value>)> {
    let patient_dir = safe_join(&state.vault_path, &patient_folder)?;
    if !patient_dir.exists() {
        return Ok(Json(vec![]));
    }
    let mut files = Vec::new();
    let entries = std::fs::read_dir(&patient_dir).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    for entry in entries.flatten() {
        let dir_path = entry.path();
        if !dir_path.is_dir() {
            continue;
        }
        let cat_folder = match dir_path.file_name().and_then(|n| n.to_str()) {
            Some(n) if !n.starts_with('.') => n.to_string(),
            _ => continue,
        };
        collect_patient_files(&dir_path, &patient_folder, &cat_folder, "", &mut files);
    }
    Ok(Json(files))
}

pub async fn get_raw_file(
    State(state): State<AppState>,
    AxPath(rel_path): AxPath<String>,
) -> Result<Vec<u8>, (StatusCode, Json<serde_json::Value>)> {
    let full = safe_join(&state.vault_path, &rel_path)?;
    std::fs::read(&full).map_err(|_| err(StatusCode::NOT_FOUND, "file not found"))
}

#[derive(Deserialize)]
pub struct MkdirRequest {
    /// Vault-relative directory path to create (parents created as needed).
    rel_path: String,
}

pub async fn mkdir(
    State(state): State<AppState>,
    Json(req): Json<MkdirRequest>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let full = safe_join(&state.vault_path, &req.rel_path)?;
    std::fs::create_dir_all(&full).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::CREATED)
}

#[derive(Deserialize)]
pub struct MoveRequest {
    from_rel_path: String,
    to_rel_path: String,
}

pub async fn move_file(
    State(state): State<AppState>,
    Json(req): Json<MoveRequest>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let from = safe_join(&state.vault_path, &req.from_rel_path)?;
    let to = safe_join(&state.vault_path, &req.to_rel_path)?;
    if let Some(parent) = to.parent() {
        std::fs::create_dir_all(parent).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    std::fs::rename(&from, &to).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let _ = state.events.send(r#"{"entity":"files"}"#.to_string());
    Ok(StatusCode::OK)
}

#[derive(Deserialize)]
pub struct DeleteQuery {
    rel_path: String,
}

pub async fn delete_file(
    State(state): State<AppState>,
    Query(q): Query<DeleteQuery>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let full = safe_join(&state.vault_path, &q.rel_path)?;
    std::fs::remove_file(&full).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let _ = state.events.send(r#"{"entity":"files"}"#.to_string());
    Ok(StatusCode::OK)
}

/// Multipart upload: fields `patient_folder`, `category_folder`, `filename`, `file`.
/// Collision-safe server-side (`_1`, `_2`, ... suffixing) — this is the race-free version
/// of the client-side `uniqueFilename()` fix noted in CLAUDE.md's "Sidebar file tree" section.
pub async fn upload_file(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    let mut patient_folder = String::new();
    let mut category_folder = String::new();
    let mut filename = String::new();
    let mut bytes: Option<Vec<u8>> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, e.to_string()))?
    {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "patient_folder" => patient_folder = field.text().await.unwrap_or_default(),
            "category_folder" => category_folder = field.text().await.unwrap_or_default(),
            "filename" => filename = field.text().await.unwrap_or_default(),
            "file" => {
                bytes = Some(field.bytes().await.map_err(|e| err(StatusCode::BAD_REQUEST, e.to_string()))?.to_vec());
            }
            _ => {}
        }
    }

    if patient_folder.is_empty() || filename.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "patient_folder and filename are required"));
    }
    let bytes = bytes.ok_or_else(|| err(StatusCode::BAD_REQUEST, "missing file part"))?;

    let dest_dir = safe_join(&state.vault_path, &format!("{patient_folder}/{category_folder}"))?;
    std::fs::create_dir_all(&dest_dir).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let dest_name = unique_filename(&dest_dir, &filename);
    let dest_path = dest_dir.join(&dest_name);
    std::fs::write(&dest_path, &bytes).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let rel_path = if category_folder.is_empty() {
        format!("{patient_folder}/{dest_name}")
    } else {
        format!("{patient_folder}/{category_folder}/{dest_name}")
    };

    let _ = state.events.send(r#"{"entity":"files"}"#.to_string());

    Ok(Json(serde_json::json!({
        "relPath": rel_path,
        "filename": dest_name,
        "fileSize": bytes.len(),
    })))
}

fn unique_filename(dir: &Path, filename: &str) -> String {
    if !dir.join(filename).exists() {
        return filename.to_string();
    }
    let (stem, ext) = match filename.rfind('.') {
        Some(i) if i > 0 => (&filename[..i], &filename[i..]),
        _ => (filename, ""),
    };
    for n in 1..10_000 {
        let candidate = format!("{stem}_{n}{ext}");
        if !dir.join(&candidate).exists() {
            return candidate;
        }
    }
    format!("{stem}_{}{ext}", uuid_fallback())
}

fn uuid_fallback() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    format!("{}", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos())
}

// ── Folder tree (VaultDropDialog's folder picker) ───────────────────────────────────────
// Mirrors src-tauri's FolderNode/scan_folders/list_patient_folders/create_patient_subfolder/
// move_patient_folder exactly, including their safety checks — these are dedicated endpoints
// rather than generic file operations because the Tauri commands have folder-specific rules
// (name sanitization, "can't move into own descendant", overwrite prevention) that a plain
// mkdir/rename wouldn't enforce.

#[derive(Serialize)]
pub struct FolderNode {
    name: String,
    rel_path: String,
    children: Vec<FolderNode>,
}

fn scan_folders(dir: &Path, rel_prefix: &str) -> Vec<FolderNode> {
    let mut nodes = Vec::new();
    let Ok(entries) = std::fs::read_dir(dir) else { return nodes };
    let mut dirs: Vec<_> = entries.filter_map(|e| e.ok()).filter(|e| e.path().is_dir()).collect();
    dirs.sort_by_key(|e| e.file_name().to_string_lossy().to_lowercase());
    for entry in dirs {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let rel_path = if rel_prefix.is_empty() { name.clone() } else { format!("{rel_prefix}/{name}") };
        let children = scan_folders(&entry.path(), &rel_path);
        nodes.push(FolderNode { name, rel_path, children });
    }
    nodes
}

pub async fn get_folder_tree(
    State(state): State<AppState>,
    AxPath(patient_folder): AxPath<String>,
) -> Result<Json<Vec<FolderNode>>, (StatusCode, Json<serde_json::Value>)> {
    let patient_dir = safe_join(&state.vault_path, &patient_folder)?;
    if !patient_dir.exists() {
        return Ok(Json(Vec::new()));
    }
    Ok(Json(scan_folders(&patient_dir, "")))
}

#[derive(Deserialize)]
pub struct CreateSubfolderRequest {
    patient_folder: String,
    parent_rel: String,
    folder_name: String,
}

#[derive(Serialize)]
pub struct CreateSubfolderResponse {
    rel_path: String,
}

pub async fn create_subfolder(
    State(state): State<AppState>,
    Json(req): Json<CreateSubfolderRequest>,
) -> Result<Json<CreateSubfolderResponse>, (StatusCode, Json<serde_json::Value>)> {
    let safe_name: String = req
        .folder_name
        .trim()
        .chars()
        .map(|c| if "/\\:*?\"<>|".contains(c) { '_' } else { c })
        .collect();
    if safe_name.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "Folder name cannot be empty"));
    }
    let patient_dir = safe_join(&state.vault_path, &req.patient_folder)?;
    let target = if req.parent_rel.is_empty() {
        patient_dir.join(&safe_name)
    } else {
        patient_dir.join(&req.parent_rel).join(&safe_name)
    };
    std::fs::create_dir_all(&target).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let rel_path = if req.parent_rel.is_empty() { safe_name } else { format!("{}/{}", req.parent_rel, safe_name) };
    let _ = state.events.send(r#"{"entity":"files"}"#.to_string());
    Ok(Json(CreateSubfolderResponse { rel_path }))
}

#[derive(Deserialize)]
pub struct MoveFolderRequest {
    patient_folder: String,
    src_rel: String,
    dest_parent_rel: String,
}

pub async fn move_folder(
    State(state): State<AppState>,
    Json(req): Json<MoveFolderRequest>,
) -> Result<StatusCode, (StatusCode, Json<serde_json::Value>)> {
    let patient_dir = safe_join(&state.vault_path, &req.patient_folder)?;
    let src = patient_dir.join(&req.src_rel);
    let src_name = src
        .file_name()
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "Invalid source path"))?
        .to_string_lossy()
        .to_string();
    let dest = if req.dest_parent_rel.is_empty() {
        patient_dir.join(&src_name)
    } else {
        patient_dir.join(&req.dest_parent_rel).join(&src_name)
    };
    if dest.starts_with(&src) {
        return Err(err(StatusCode::BAD_REQUEST, "Cannot move a folder into its own subfolder"));
    }
    if dest.exists() {
        return Err(err(
            StatusCode::CONFLICT,
            format!("A folder named '{src_name}' already exists at that location"),
        ));
    }
    std::fs::rename(&src, &dest).map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let _ = state.events.send(r#"{"entity":"files"}"#.to_string());
    Ok(StatusCode::OK)
}

pub async fn not_found() -> impl IntoResponse {
    err(StatusCode::NOT_FOUND, "no such route")
}
