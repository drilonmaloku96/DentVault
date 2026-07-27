use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<Mutex<Connection>>,
    pub vault_path: PathBuf,
    pub token: String,
    /// Invalidation broadcast — JSON-encoded `{entity, key?}` strings. No payload data,
    /// per ROADMAP_MULTI_COMPUTER.md §3.4: clients refetch through the normal RPC path.
    pub events: broadcast::Sender<String>,
}
