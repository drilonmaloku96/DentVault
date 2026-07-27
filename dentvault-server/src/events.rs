use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};

use crate::state::AppState;

pub async fn ws_handler(ws: WebSocketUpgrade, State(state): State<AppState>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, state))
}

async fn handle_socket(socket: WebSocket, state: AppState) {
    tracing::info!("station connected to /events");
    let (mut sender, mut receiver) = socket.split();
    let mut rx = state.events.subscribe();

    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sender.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Drain (and ignore) client messages — this channel is server-push only for Phase 1,
    // but we still need to read the socket so ping/pong and close frames are handled and
    // the connection doesn't look stalled to intermediaries.
    let mut recv_task = tokio::spawn(async move { while receiver.next().await.is_some() {} });

    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
}

/// Best-effort table → entity mapping for the coarse Phase 1 broadcast (no payload data,
/// entity-level only — see invalidations.svelte.ts's wildcard emit path on the client).
/// Finer per-record keys (e.g. exact patientId) are a Phase 2/3 refinement once the RPC
/// layer moves to Shape 2 named operations and can attach real semantics to a write.
pub fn entity_for_table(table: &str) -> Option<&'static str> {
    match table {
        "timeline_entries" | "entry_teeth" => Some("timeline"),
        "appointments" | "schedule_blocks" | "staff_blockouts" => Some("appointments"),
        "documents" => Some("files"),
        "settings" => Some("settings"),
        _ => None,
    }
}
