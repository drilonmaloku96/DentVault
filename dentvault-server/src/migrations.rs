use rusqlite::Connection;
use serde::Deserialize;

/// Embedded at compile time so the binary is self-contained and migrations are
/// byte-identical to the TS side regardless of the process's working directory or
/// deployment layout — see shared/schema-statements.json and CLAUDE.md's Migrations note.
const SCHEMA_JSON: &str = include_str!("../../shared/schema-statements.json");

#[derive(Deserialize)]
struct SchemaStatement {
    version: i64,
    sql: String,
}

#[derive(Deserialize)]
struct SchemaFile {
    #[serde(rename = "latestVersion")]
    latest_version: i64,
    statements: Vec<SchemaStatement>,
}

/// Mirrors db-local.ts's runMigrations exactly: create _schema_version, detect an
/// already-migrated DB from the old system, apply missing DDL (ignoring "duplicate
/// column"/"already exists" — ALTER TABLE ADD COLUMN re-runs), bump to the highest
/// applied version. The three one-time data migrations (v13/v23+v59/v66) are TS-only
/// (they call the Rust `get_vault_path` Tauri command and JS JSON parsing) — a server
/// only ever inherits an already-migrated vault (a clinic grows into connected mode by
/// pointing the server at an existing, already-current solo vault), so those backfills
/// are not re-implemented here. If that assumption ever breaks, port them before relying
/// on this path for a vault that predates v66.
pub fn run_migrations(conn: &Connection) -> rusqlite::Result<()> {
    let schema: SchemaFile =
        serde_json::from_str(SCHEMA_JSON).expect("shared/schema-statements.json failed to parse");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS _schema_version (version INTEGER PRIMARY KEY)",
        [],
    )?;

    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM _schema_version",
        [],
        |row| row.get(0),
    )?;
    let mut current = current;

    if current == 0 {
        let table_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='patients'",
            [],
            |row| row.get(0),
        )?;
        if table_count > 0 {
            conn.execute(
                "INSERT OR REPLACE INTO _schema_version (version) VALUES (?1)",
                [schema.latest_version],
            )?;
            return Ok(());
        }
    }

    let mut max_applied = current;
    for stmt in &schema.statements {
        if stmt.version > current {
            match conn.execute_batch(&stmt.sql) {
                Ok(_) => {}
                Err(e) => {
                    let msg = e.to_string().to_lowercase();
                    if !msg.contains("duplicate column") && !msg.contains("already exists") {
                        return Err(e);
                    }
                }
            }
            if stmt.version > max_applied {
                max_applied = stmt.version;
            }
        }
    }

    if max_applied > current {
        conn.execute(
            "INSERT OR REPLACE INTO _schema_version (version) VALUES (?1)",
            [max_applied],
        )?;
        current = max_applied;
    }

    tracing::info!("Schema at version {} (latest known: {})", current, schema.latest_version);
    Ok(())
}
