use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::ToSql;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as JsonValue};

use crate::events::entity_for_table;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct RpcRequest {
    sql: String,
    #[serde(default)]
    params: Vec<JsonValue>,
}

#[derive(Serialize)]
pub struct ExecuteResult {
    #[serde(rename = "rowsAffected")]
    rows_affected: i64,
    #[serde(rename = "lastInsertId", skip_serializing_if = "Option::is_none")]
    last_insert_id: Option<i64>,
}

#[derive(Serialize)]
pub struct RpcError {
    error: String,
}

fn err(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<RpcError>) {
    (status, Json(RpcError { error: msg.into() }))
}

/// Shape 1 SQL pass-through (ROADMAP_MULTI_COMPUTER.md §3.2). db-core.ts's 158 functions
/// generate the SQL text; every call here is one of that fixed, already-audited set of
/// statements, sent by a trusted (token-authenticated) DentVault workstation — not
/// arbitrary end-user input. The guardrails below are a coarse safety net (block schema
/// changes and multi-statement injection), not per-operation authorization — that's Shape
/// 2 / Phase 2, once authorization needs to attach to *operations* rather than SQL strings.
pub async fn rpc_handler(
    State(state): State<AppState>,
    Json(req): Json<RpcRequest>,
) -> Result<Json<JsonValue>, (StatusCode, Json<RpcError>)> {
    tracing::debug!(sql = %req.sql, params = ?req.params, "/rpc");
    let trimmed = req.sql.trim();
    let without_trailing_semi = trimmed.strip_suffix(';').unwrap_or(trimmed).trim();

    if without_trailing_semi.contains(';') {
        return Err(err(StatusCode::BAD_REQUEST, "multi-statement SQL is not allowed"));
    }

    let verb = without_trailing_semi
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_ascii_uppercase();

    if !matches!(verb.as_str(), "SELECT" | "INSERT" | "UPDATE" | "DELETE") {
        return Err(err(
            StatusCode::BAD_REQUEST,
            format!("statement type '{verb}' is not allowed over /rpc — schema changes only happen via server startup migrations"),
        ));
    }

    let sql_params: Vec<SqlValue> = req.params.iter().map(json_to_sql).collect();

    let conn = state.db.lock().await;

    if verb == "SELECT" {
        let mut stmt = conn
            .prepare(without_trailing_semi)
            .map_err(|e| err(StatusCode::BAD_REQUEST, e.to_string()))?;
        let column_names: Vec<String> = stmt.column_names().into_iter().map(String::from).collect();

        let param_refs: Vec<&dyn ToSql> = sql_params.iter().map(|v| v as &dyn ToSql).collect();
        let rows = stmt
            .query_map(param_refs.as_slice(), |row| {
                let mut map = Map::new();
                for (i, name) in column_names.iter().enumerate() {
                    map.insert(name.clone(), sql_to_json(row.get_ref(i)?));
                }
                Ok(JsonValue::Object(map))
            })
            .map_err(|e| err(StatusCode::BAD_REQUEST, e.to_string()))?;

        let results: Result<Vec<JsonValue>, rusqlite::Error> = rows.collect();
        let results = results.map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        return Ok(Json(JsonValue::Array(results)));
    }

    // INSERT / UPDATE / DELETE
    let param_refs: Vec<&dyn ToSql> = sql_params.iter().map(|v| v as &dyn ToSql).collect();
    let rows_affected = conn
        .execute(without_trailing_semi, param_refs.as_slice())
        .map_err(|e| err(StatusCode::BAD_REQUEST, e.to_string()))?;

    let last_insert_id = if verb == "INSERT" {
        Some(conn.last_insert_rowid())
    } else {
        None
    };

    if let Some(table) = extract_table_name(without_trailing_semi, &verb) {
        if let Some(entity) = entity_for_table(&table) {
            // No listeners is not an error — fine if nobody's connected yet.
            let n = state.events.receiver_count();
            tracing::info!(entity, stations_notified = n, "broadcasting invalidation");
            let _ = state.events.send(format!(r#"{{"entity":"{entity}"}}"#));
        }
    }

    Ok(Json(
        serde_json::to_value(ExecuteResult {
            rows_affected: rows_affected as i64,
            last_insert_id,
        })
        .unwrap(),
    ))
}

fn json_to_sql(v: &JsonValue) -> SqlValue {
    match v {
        JsonValue::Null => SqlValue::Null,
        JsonValue::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else {
                SqlValue::Real(n.as_f64().unwrap_or(0.0))
            }
        }
        JsonValue::String(s) => SqlValue::Text(s.clone()),
        // Arrays/objects aren't expected as bind params (callers JSON.stringify first) —
        // fall back to the stringified form rather than dropping data silently.
        JsonValue::Array(_) | JsonValue::Object(_) => SqlValue::Text(v.to_string()),
    }
}

fn sql_to_json(v: ValueRef) -> JsonValue {
    match v {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(i) => JsonValue::Number(i.into()),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(JsonValue::Number).unwrap_or(JsonValue::Null),
        ValueRef::Text(t) => JsonValue::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(b) => JsonValue::String(base64_encode(b)),
    }
}

/// Minimal base64 encoder — avoids pulling in a whole crate for the one BLOB edge case
/// (the current schema has no BLOB columns; this is defensive, not exercised today).
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = *chunk.get(1).unwrap_or(&0);
        let b2 = *chunk.get(2).unwrap_or(&0);
        out.push(CHARS[(b0 >> 2) as usize] as char);
        out.push(CHARS[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
        out.push(if chunk.len() > 1 { CHARS[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { CHARS[(b2 & 0x3f) as usize] as char } else { '=' });
    }
    out
}

/// Pulls the table name out of a single INSERT/UPDATE/DELETE statement for the best-effort
/// invalidation broadcast. Simple token scan — the SQL here is always one of db-core.ts's
/// own generated statements, not arbitrary text, so this doesn't need to be a real parser.
fn extract_table_name(sql: &str, verb: &str) -> Option<String> {
    let upper = sql.to_ascii_uppercase();
    let anchor = match verb {
        "INSERT" => "INTO",
        "UPDATE" => "UPDATE",
        "DELETE" => "FROM",
        _ => return None,
    };
    let anchor_idx = upper.find(anchor)?;
    let after = sql[anchor_idx + anchor.len()..].trim_start();
    let token: String = after
        .chars()
        .take_while(|c| c.is_alphanumeric() || *c == '_')
        .collect();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}
