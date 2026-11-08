//! `run_batch`: run many SQL statements in ONE transaction.
//!
//! tauri-plugin-sql hands each query to any connection in its pool, so
//! `BEGIN … COMMIT` sent from JavaScript is not reliable. Multi-row writes
//! (import, item save, later purchase and bill save) come here instead.
//! Business logic stays in TypeScript; this file only executes what it is given.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::{Row, SqlitePool};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};
use tokio::sync::OnceCell;

#[derive(Default)]
pub struct BatchDb(OnceCell<SqlitePool>);

/// `sqls` holds each distinct statement once; `steps` say which one to run with
/// which parameters. A 10,000-row import then sends 4 statements, not 40,000.
#[derive(Deserialize)]
pub struct BatchRequest {
    sqls: Vec<String>,
    steps: Vec<(usize, Vec<Value>)>,
}

#[derive(Serialize)]
pub struct BatchResult {
    rows_affected: Vec<u64>,
    /// `last_insert_rowid` after each step (0 when the step inserted nothing).
    last_ids: Vec<i64>,
}

async fn pool(app: &AppHandle, state: &BatchDb) -> Result<SqlitePool, String> {
    state
        .0
        .get_or_try_init(|| async {
            // Same file that tauri-plugin-sql opens for "sqlite:medshop.db".
            let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
            let opts = SqliteConnectOptions::new()
                .filename(dir.join("medshop.db"))
                .create_if_missing(false) // the frontend opens the DB (and runs migrations) first
                .journal_mode(SqliteJournalMode::Wal)
                .foreign_keys(true)
                .busy_timeout(Duration::from_secs(5));
            SqlitePoolOptions::new()
                .max_connections(1) // one writer: transactions never interleave
                .connect_with(opts)
                .await
                .map_err(|e| e.to_string())
        })
        .await
        .cloned()
}

#[tauri::command]
pub async fn run_batch(
    app: AppHandle,
    state: State<'_, BatchDb>,
    req: BatchRequest,
) -> Result<BatchResult, String> {
    let pool = pool(&app, &state).await?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut result = BatchResult { rows_affected: Vec::with_capacity(req.steps.len()), last_ids: Vec::with_capacity(req.steps.len()) };

    for (i, (sql_index, params)) in req.steps.iter().enumerate() {
        let sql = req
            .sqls
            .get(*sql_index)
            .ok_or_else(|| format!("step {i}: no statement #{sql_index}"))?;
        let mut q = sqlx::query(sql);
        for p in params {
            q = match p {
                Value::Null => q.bind(None::<i64>),
                Value::Bool(b) => q.bind(*b as i64),
                Value::Number(n) => match n.as_i64() {
                    Some(v) => q.bind(v),
                    None => q.bind(n.as_f64().unwrap_or(0.0)),
                },
                Value::String(s) => q.bind(s.clone()),
                other => q.bind(other.to_string()),
            };
        }
        // Any error drops `tx` without commit, so nothing from this batch is kept.
        let done = q
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("step {i}: {e}"))?;
        result.rows_affected.push(done.rows_affected());
        result.last_ids.push(done.last_insert_rowid());
    }

    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(result)
}

/// Read one value, mainly for tests and diagnostics.
#[tauri::command]
pub async fn batch_db_ready(app: AppHandle, state: State<'_, BatchDb>) -> Result<i64, String> {
    let pool = pool(&app, &state).await?;
    let row = sqlx::query("SELECT COUNT(*) AS n FROM sqlite_master")
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.get::<i64, _>("n"))
}
