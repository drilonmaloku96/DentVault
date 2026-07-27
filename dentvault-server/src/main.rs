mod auth;
mod events;
mod files;
mod migrations;
mod rpc;
mod state;

use axum::routing::{delete, get, post};
use axum::{middleware, Router};
use clap::Parser;
use rand::Rng;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex};
use tower_http::cors::{Any, CorsLayer};
use tower_http::trace::TraceLayer;

use state::AppState;

/// DentVault clinic server — one process owning dentvault.db and the vault folder,
/// serving workstations in connected mode. See ROADMAP_MULTI_COMPUTER.md Phase 1.
#[derive(Parser)]
#[command(name = "dentvault-server", version)]
struct Args {
    /// Path to the vault folder (must already exist — this is NOT a network share; see
    /// the "Option A — REJECTED" note in ROADMAP_MULTI_COMPUTER.md).
    #[arg(long)]
    vault: PathBuf,

    /// Port to listen on.
    #[arg(long, default_value_t = 8420)]
    port: u16,

    /// Bearer token every workstation must send. If omitted, one is generated and printed
    /// at startup — capture it and pass it back on future starts (Phase 1 has no
    /// persisted-secret story yet; that's Phase 4 hardening).
    #[arg(long)]
    token: Option<String>,
}

fn generate_token() -> String {
    let mut rng = rand::thread_rng();
    (0..32).map(|_| format!("{:x}", rng.gen_range(0..16))).collect()
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    let args = Args::parse();

    if !args.vault.is_dir() {
        eprintln!("Vault path does not exist or is not a directory: {}", args.vault.display());
        std::process::exit(1);
    }

    let token = args.token.unwrap_or_else(generate_token);

    let db_path = args.vault.join("dentvault.db");
    let conn = Connection::open(&db_path).expect("failed to open dentvault.db");
    conn.pragma_update(None, "journal_mode", "WAL").expect("failed to set WAL mode");
    conn.pragma_update(None, "foreign_keys", "ON").ok();
    migrations::run_migrations(&conn).expect("migration failed");

    // Drop the initial receiver immediately — binding it (e.g. `_rx`) would keep it alive
    // for the process lifetime and permanently inflate receiver_count() by one phantom
    // subscriber. send() already handles the zero-receiver case (Err, ignored) just fine.
    let (tx, rx0) = broadcast::channel(256);
    drop(rx0);

    let state = AppState {
        db: Arc::new(Mutex::new(conn)),
        vault_path: args.vault.clone(),
        token: token.clone(),
        events: tx.clone(),
    };

    // Application-level heartbeat: some WebView WebSocket implementations don't reliably
    // fire a 'close' event when the underlying TCP connection dies abruptly (server crash/
    // restart, network drop) rather than via a clean close handshake — the client-side
    // watchdog in ws-client.ts relies on seeing *some* traffic to know the connection is
    // still alive, and force-reconnects if this goes quiet. No-op when nobody's connected.
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            interval.tick().await;
            let _ = tx.send(r#"{"entity":"__heartbeat__"}"#.to_string());
        }
    });

    let protected = Router::new()
        .route("/rpc", post(rpc::rpc_handler))
        .route("/files/list/*patient_folder", get(files::list_files))
        .route("/files/raw/*rel_path", get(files::get_raw_file))
        .route("/files/upload", post(files::upload_file))
        .route("/files/move", post(files::move_file))
        .route("/files/mkdir", post(files::mkdir))
        .route("/files", delete(files::delete_file))
        .route("/files/tree/*patient_folder", get(files::get_folder_tree))
        .route("/files/subfolder", post(files::create_subfolder))
        .route("/files/move-folder", post(files::move_folder))
        .route("/events", get(events::ws_handler))
        .route_layer(middleware::from_fn_with_state(state.clone(), auth::require_token));

    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .merge(protected)
        .fallback(files::not_found)
        .layer(CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{}", args.port);
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("failed to bind port");

    println!("DentVault server listening on http://{addr}");
    println!("Vault: {}", args.vault.display());
    println!("Bearer token: {token}");
    println!("(Every workstation's connect screen needs this exact token.)");

    axum::serve(listener, app).await.expect("server error");
}
