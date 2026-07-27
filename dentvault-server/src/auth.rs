use axum::extract::State;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::Response;

use crate::state::AppState;

/// Single shared bearer token for all stations (Phase 1). Per-user sessions/roles are
/// Phase 2 (ROADMAP_MULTI_COMPUTER.md §3.7) — every request is equally trusted for now.
pub async fn require_token(
    State(state): State<AppState>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let header_token = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|h| h.strip_prefix("Bearer "))
        .map(str::to_string);

    // The WebSocket handshake (/events) can't set a custom Authorization header — the
    // browser/webview WebSocket API has no header option — so it authenticates via a
    // `?token=` query param instead. /rpc and /files/* always use the header.
    let query_token = header_token
        .is_none()
        .then(|| request.uri().query().and_then(parse_token_param))
        .flatten();

    let provided = header_token.or(query_token);

    match provided.as_deref() {
        Some(t) if constant_time_eq(t.as_bytes(), state.token.as_bytes()) => Ok(next.run(request).await),
        _ => Err(StatusCode::UNAUTHORIZED),
    }
}

/// Minimal `?token=...` extraction — no full query-string parser needed for one known key.
/// Does not decode percent-escapes: the token is a random hex string (auth.rs's own
/// `generate_token`), which never contains characters that need escaping.
fn parse_token_param(query: &str) -> Option<String> {
    query
        .split('&')
        .find_map(|pair| pair.strip_prefix("token=").map(str::to_string))
}

/// Avoids a timing side-channel on token comparison — cheap insurance for a value that
/// otherwise gates every clinical record on the LAN.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
