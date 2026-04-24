//! Supabase sync for the blocking system tables:
//!   blocked_sites, blocked_apps, focus_schedule_blocks, time_unlock_rules
//!
//! Push/pull pattern mirrors the time-entries sync in supabase.rs:
//!   • Push: send every locally-unsynced row, mark as synced on success.
//!   • Pull: fetch all remote rows for this user, upsert by natural key,
//!           mark local row as synced. Last-write-wins via updated_at.
//!
//! After a successful pull the caller is responsible for any platform-specific
//! side-effects (e.g. refreshing /etc/hosts on Mac, reloading the Safari
//! Content Blocker on iOS).

use crate::db::AppState;
use crate::models::AppConfig;
use reqwest::Client;
use rusqlite::params;
use serde_json::json;

// ── helpers ───────────────────────────────────────────────────────────────────

fn base_url(config: &AppConfig) -> String {
    config.supabase.url.trim_end_matches('/').to_string()
}

fn headers(key: &str) -> Vec<(&'static str, String)> {
    vec![
        ("apikey", key.to_string()),
        ("Authorization", format!("Bearer {key}")),
        ("Content-Type", "application/json".to_string()),
        // upsert: if the row already exists (by unique constraint) update it
        ("Prefer", "resolution=merge-duplicates".to_string()),
    ]
}

fn is_configured(config: &AppConfig) -> bool {
    !config.supabase.url.is_empty() && !config.supabase.key.is_empty()
}

#[derive(Debug, Default)]
pub struct BlockingSyncResult {
    pub sites_pushed: usize,
    pub sites_pulled: usize,
    pub apps_pushed: usize,
    pub apps_pulled: usize,
    pub blocks_pushed: usize,
    pub blocks_pulled: usize,
    pub rules_pushed: usize,
    pub rules_pulled: usize,
    pub errors: Vec<String>,
}

// ── blocked_sites ─────────────────────────────────────────────────────────────

pub async fn push_blocked_sites(
    state: &AppState,
    config: &AppConfig,
) -> Result<BlockingSyncResult, String> {
    if !is_configured(config) {
        return Err("Supabase not configured".into());
    }

    let rows = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = db
            .prepare(
                "SELECT id, domain, enabled, user_id, updated_at
                 FROM blocked_sites WHERE synced = 0",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, bool>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, Option<String>>(4)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let client = Client::new();
    let url = format!("{}/rest/v1/blocked_sites", base_url(config));
    let key = &config.supabase.key;
    let mut result = BlockingSyncResult::default();

    for (id, domain, enabled, user_id, updated_at) in &rows {
        let body = json!({
            "user_id": user_id,
            "domain": domain,
            "enabled": enabled,
            "updated_at": updated_at,
        });

        let mut req = client.post(&url);
        for (k, v) in headers(key) {
            req = req.header(k, v);
        }

        match req.json(&body).send().await {
            Ok(r) if r.status().is_success() => {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                let _ = db.execute(
                    "UPDATE blocked_sites SET synced = 1 WHERE id = ?1",
                    params![id],
                );
                result.sites_pushed += 1;
            }
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                result.errors.push(format!("site {domain}: HTTP {status} — {text}"));
            }
            Err(e) => result.errors.push(format!("site {domain}: {e}")),
        }
    }

    Ok(result)
}

pub async fn pull_blocked_sites(
    state: &AppState,
    config: &AppConfig,
) -> Result<BlockingSyncResult, String> {
    if !is_configured(config) {
        return Err("Supabase not configured".into());
    }

    let client = Client::new();
    let key = &config.supabase.key;
    // Pull all rows for the default user — add ?user_id=eq.{uid} when Auth lands
    let url = format!("{}/rest/v1/blocked_sites?select=*", base_url(config));

    let mut req = client.get(&url);
    for (k, v) in headers(key) {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("blocked_sites pull failed: HTTP {}", resp.status()));
    }

    let remote: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    let mut result = BlockingSyncResult::default();

    for row in &remote {
        let domain = row["domain"].as_str().unwrap_or("").to_string();
        let enabled = row["enabled"].as_bool().unwrap_or(true);
        let user_id = row["user_id"].as_str().unwrap_or("default").to_string();
        let updated_at = row["updated_at"].as_str().unwrap_or("").to_string();

        if domain.is_empty() {
            continue;
        }

        // Two-step upsert (no UNIQUE constraint — iOS 26 beta SQLite bug workaround).
        // 1. Update existing row if our data is at least as new.
        // 2. Insert only if no row with this domain exists yet.
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let update_ok = db.execute(
            "UPDATE blocked_sites
             SET enabled = ?1, user_id = ?2, updated_at = ?3, synced = 1
             WHERE domain = ?4
               AND (updated_at IS NULL OR ?3 >= updated_at)",
            params![enabled as i64, user_id, updated_at, domain],
        );
        let insert_ok = db.execute(
            "INSERT INTO blocked_sites (domain, enabled, user_id, updated_at, synced)
             SELECT ?1, ?2, ?3, ?4, 1
             WHERE NOT EXISTS (SELECT 1 FROM blocked_sites WHERE domain = ?1)",
            params![domain, enabled as i64, user_id, updated_at],
        );
        match (update_ok, insert_ok) {
            (Ok(_), Ok(_)) => result.sites_pulled += 1,
            (Err(e), _) | (_, Err(e)) => result.errors.push(format!("site {domain} pull upsert: {e}")),
        }
    }

    Ok(result)
}

// ── blocked_apps ──────────────────────────────────────────────────────────────

pub async fn push_blocked_apps(
    state: &AppState,
    config: &AppConfig,
) -> Result<BlockingSyncResult, String> {
    if !is_configured(config) {
        return Err("Supabase not configured".into());
    }

    let rows = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = db
            .prepare(
                "SELECT id, display_name, process_name, block_mode, enabled, user_id, updated_at
                 FROM blocked_apps WHERE synced = 0",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, bool>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let client = Client::new();
    let url = format!("{}/rest/v1/blocked_apps", base_url(config));
    let key = &config.supabase.key;
    let mut result = BlockingSyncResult::default();

    for (id, display_name, process_name, block_mode, enabled, user_id, updated_at) in &rows {
        let body = json!({
            "user_id": user_id,
            "display_name": display_name,
            "process_name": process_name,
            "block_mode": block_mode,
            "enabled": enabled,
            "updated_at": updated_at,
        });

        let mut req = client.post(&url);
        for (k, v) in headers(key) {
            req = req.header(k, v);
        }

        match req.json(&body).send().await {
            Ok(r) if r.status().is_success() => {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                let _ = db.execute(
                    "UPDATE blocked_apps SET synced = 1 WHERE id = ?1",
                    params![id],
                );
                result.apps_pushed += 1;
            }
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                result.errors.push(format!("app {process_name}: HTTP {status} — {text}"));
            }
            Err(e) => result.errors.push(format!("app {process_name}: {e}")),
        }
    }

    Ok(result)
}

pub async fn pull_blocked_apps(
    state: &AppState,
    config: &AppConfig,
) -> Result<BlockingSyncResult, String> {
    if !is_configured(config) {
        return Err("Supabase not configured".into());
    }

    let client = Client::new();
    let key = &config.supabase.key;
    let url = format!("{}/rest/v1/blocked_apps?select=*", base_url(config));

    let mut req = client.get(&url);
    for (k, v) in headers(key) {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("blocked_apps pull failed: HTTP {}", resp.status()));
    }

    let remote: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    let mut result = BlockingSyncResult::default();

    for row in &remote {
        let process_name = row["process_name"].as_str().unwrap_or("").to_string();
        let display_name = row["display_name"].as_str().unwrap_or("").to_string();
        let block_mode   = row["block_mode"].as_str().unwrap_or("always").to_string();
        let enabled      = row["enabled"].as_bool().unwrap_or(true);
        let user_id      = row["user_id"].as_str().unwrap_or("default").to_string();
        let updated_at   = row["updated_at"].as_str().unwrap_or("").to_string();

        if process_name.is_empty() { continue; }

        // Two-step upsert — no UNIQUE constraint (iOS 26 beta SQLite bug workaround).
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let update_ok = db.execute(
            "UPDATE blocked_apps
             SET display_name = ?1, block_mode = ?2, enabled = ?3, user_id = ?4, updated_at = ?5, synced = 1
             WHERE process_name = ?6
               AND (updated_at IS NULL OR ?5 >= updated_at)",
            params![display_name, block_mode, enabled as i64, user_id, updated_at, process_name],
        );
        let insert_ok = db.execute(
            "INSERT INTO blocked_apps (display_name, process_name, block_mode, enabled, user_id, updated_at, synced)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, 1
             WHERE NOT EXISTS (SELECT 1 FROM blocked_apps WHERE process_name = ?2)",
            params![display_name, process_name, block_mode, enabled as i64, user_id, updated_at],
        );
        match (update_ok, insert_ok) {
            (Ok(_), Ok(_)) => result.apps_pulled += 1,
            (Err(e), _) | (_, Err(e)) => result.errors.push(format!("app {process_name} pull upsert: {e}")),
        }
    }

    Ok(result)
}

// ── focus_schedule_blocks ─────────────────────────────────────────────────────

pub async fn push_focus_blocks(
    state: &AppState,
    config: &AppConfig,
) -> Result<BlockingSyncResult, String> {
    if !is_configured(config) {
        return Err("Supabase not configured".into());
    }

    // Fetch local unsynced rows; also grab remote_id so we know whether this is
    // a new insert or an update of an already-known remote row.
    let rows = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = db
            .prepare(
                "SELECT id, name, start_time, end_time, days_of_week, color, enabled,
                        user_id, updated_at, remote_id
                 FROM focus_schedule_blocks WHERE synced = 0",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,       // 0 local id
                    r.get::<_, String>(1)?,     // 1 name
                    r.get::<_, String>(2)?,     // 2 start_time
                    r.get::<_, String>(3)?,     // 3 end_time
                    r.get::<_, String>(4)?,     // 4 days_of_week
                    r.get::<_, String>(5)?,     // 5 color
                    r.get::<_, bool>(6)?,       // 6 enabled
                    r.get::<_, String>(7)?,     // 7 user_id
                    r.get::<_, Option<String>>(8)?,  // 8 updated_at
                    r.get::<_, Option<String>>(9)?,  // 9 remote_id
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let client = Client::new();
    // Supabase table is named focus_blocks (matches schema migration)
    let url = format!("{}/rest/v1/focus_blocks", base_url(config));
    let key = &config.supabase.key;
    let mut result = BlockingSyncResult::default();

    for (local_id, name, start_time, end_time, days_of_week, color, enabled, user_id, updated_at, remote_id) in &rows {
        // If we already know the Supabase UUID, include it so the upsert hits
        // the existing row by PK instead of creating a duplicate.
        let mut body = json!({
            "user_id": user_id,
            "name": name,
            "start_time": start_time,
            "end_time": end_time,
            "days_of_week": days_of_week,
            "color": color,
            "enabled": enabled,
            "updated_at": updated_at,
        });
        if let Some(rid) = remote_id {
            body["id"] = serde_json::Value::String(rid.clone());
        }

        // Request the inserted/updated row back so we can capture the UUID.
        let mut req = client.post(&url).header("Prefer", "return=representation,resolution=merge-duplicates");
        for (k, v) in headers(key) {
            // Skip the Prefer header from helpers() — we already set it above.
            if k == "Prefer" { continue; }
            req = req.header(k, v);
        }

        match req.json(&body).send().await {
            Ok(r) if r.status().is_success() => {
                // Parse the returned array to extract the server-assigned UUID.
                let returned: Vec<serde_json::Value> = r.json().await.unwrap_or_default();
                let server_id = returned
                    .first()
                    .and_then(|v| v["id"].as_str())
                    .map(String::from);

                let db = state.db.lock().map_err(|e| e.to_string())?;
                if let Some(sid) = server_id {
                    let _ = db.execute(
                        "UPDATE focus_schedule_blocks SET synced = 1, remote_id = ?1 WHERE id = ?2",
                        params![sid, local_id],
                    );
                } else {
                    let _ = db.execute(
                        "UPDATE focus_schedule_blocks SET synced = 1 WHERE id = ?1",
                        params![local_id],
                    );
                }
                result.blocks_pushed += 1;
            }
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                result.errors.push(format!("focus block {name}: HTTP {status} — {text}"));
            }
            Err(e) => result.errors.push(format!("focus block {name}: {e}")),
        }
    }

    Ok(result)
}

pub async fn pull_focus_blocks(
    state: &AppState,
    config: &AppConfig,
) -> Result<BlockingSyncResult, String> {
    if !is_configured(config) {
        return Err("Supabase not configured".into());
    }

    let client = Client::new();
    let key = &config.supabase.key;
    let url = format!("{}/rest/v1/focus_blocks?select=*", base_url(config));

    let mut req = client.get(&url);
    for (k, v) in headers(key) {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("focus_blocks pull failed: HTTP {}", resp.status()));
    }

    let remote: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    let mut result = BlockingSyncResult::default();

    for row in &remote {
        let name         = row["name"].as_str().unwrap_or("Focus Block").to_string();
        let start_time   = row["start_time"].as_str().unwrap_or("09:00").to_string();
        let end_time     = row["end_time"].as_str().unwrap_or("17:00").to_string();
        let days_of_week = row["days_of_week"].as_str().unwrap_or("1,2,3,4,5").to_string();
        let color        = row["color"].as_str().unwrap_or("#4f46e5").to_string();
        let enabled      = row["enabled"].as_bool().unwrap_or(true);
        let user_id      = row["user_id"].as_str().unwrap_or("default").to_string();
        let updated_at   = row["updated_at"].as_str().unwrap_or("").to_string();
        // remote UUID id — stored as text for reference but local uses autoincrement
        let remote_id    = row["id"].as_str().unwrap_or("").to_string();

        if remote_id.is_empty() { continue; }

        // Two-step upsert keyed on remote_id — no UNIQUE constraint (iOS 26 beta SQLite bug).
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let update_ok = db.execute(
            "UPDATE focus_schedule_blocks
             SET name = ?1, start_time = ?2, end_time = ?3, days_of_week = ?4,
                 color = ?5, enabled = ?6, user_id = ?7, updated_at = ?8, synced = 1
             WHERE remote_id = ?9
               AND (updated_at IS NULL OR ?8 >= updated_at)",
            params![name, start_time, end_time, days_of_week, color, enabled as i64,
                    user_id, updated_at, remote_id],
        );
        let insert_ok = db.execute(
            "INSERT INTO focus_schedule_blocks
               (name, start_time, end_time, days_of_week, color, enabled, user_id, updated_at, synced, remote_id)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9
             WHERE NOT EXISTS (SELECT 1 FROM focus_schedule_blocks WHERE remote_id = ?9)",
            params![name, start_time, end_time, days_of_week, color, enabled as i64,
                    user_id, updated_at, remote_id],
        );
        match (update_ok, insert_ok) {
            (Ok(_), Ok(_)) => result.blocks_pulled += 1,
            (Err(e), _) | (_, Err(e)) => result.errors.push(format!("focus block {name} pull upsert: {e}")),
        }
    }

    Ok(result)
}

// ── time_unlock_rules ─────────────────────────────────────────────────────────

pub async fn push_unlock_rules(
    state: &AppState,
    config: &AppConfig,
) -> Result<BlockingSyncResult, String> {
    if !is_configured(config) {
        return Err("Supabase not configured".into());
    }

    let rows = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let mut stmt = db
            .prepare(
                "SELECT id, process_name, domain, required_minutes, user_id, updated_at, remote_id
                 FROM time_unlock_rules WHERE synced = 0",
            )
            .map_err(|e| e.to_string())?;
        let rows: Vec<_> = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,              // 0 local id
                    r.get::<_, Option<String>>(1)?,   // 1 process_name
                    r.get::<_, Option<String>>(2)?,   // 2 domain
                    r.get::<_, i64>(3)?,              // 3 required_minutes
                    r.get::<_, String>(4)?,           // 4 user_id
                    r.get::<_, Option<String>>(5)?,   // 5 updated_at
                    r.get::<_, Option<String>>(6)?,   // 6 remote_id
                ))
            })
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .collect();
        rows
    };

    let client = Client::new();
    let url = format!("{}/rest/v1/unlock_rules", base_url(config));
    let key = &config.supabase.key;
    let mut result = BlockingSyncResult::default();

    for (local_id, process_name, domain, required_minutes, user_id, updated_at, remote_id) in &rows {
        let mut body = json!({
            "user_id": user_id,
            "process_name": process_name,
            "domain": domain,
            "required_minutes": required_minutes,
            "updated_at": updated_at,
        });
        if let Some(rid) = remote_id {
            body["id"] = serde_json::Value::String(rid.clone());
        }

        let mut req = client.post(&url).header("Prefer", "return=representation,resolution=merge-duplicates");
        for (k, v) in headers(key) {
            if k == "Prefer" { continue; }
            req = req.header(k, v);
        }

        match req.json(&body).send().await {
            Ok(r) if r.status().is_success() => {
                let returned: Vec<serde_json::Value> = r.json().await.unwrap_or_default();
                let server_id = returned
                    .first()
                    .and_then(|v| v["id"].as_str())
                    .map(String::from);

                let db = state.db.lock().map_err(|e| e.to_string())?;
                if let Some(sid) = server_id {
                    let _ = db.execute(
                        "UPDATE time_unlock_rules SET synced = 1, remote_id = ?1 WHERE id = ?2",
                        params![sid, local_id],
                    );
                } else {
                    let _ = db.execute(
                        "UPDATE time_unlock_rules SET synced = 1 WHERE id = ?1",
                        params![local_id],
                    );
                }
                result.rules_pushed += 1;
            }
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                result.errors.push(format!("unlock rule {local_id}: HTTP {status} — {text}"));
            }
            Err(e) => result.errors.push(format!("unlock rule {local_id}: {e}")),
        }
    }

    Ok(result)
}

pub async fn pull_unlock_rules(
    state: &AppState,
    config: &AppConfig,
) -> Result<BlockingSyncResult, String> {
    if !is_configured(config) {
        return Err("Supabase not configured".into());
    }

    let client = Client::new();
    let key = &config.supabase.key;
    let url = format!("{}/rest/v1/unlock_rules?select=*", base_url(config));

    let mut req = client.get(&url);
    for (k, v) in headers(key) {
        req = req.header(k, v);
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("unlock_rules pull failed: HTTP {}", resp.status()));
    }

    let remote: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    let mut result = BlockingSyncResult::default();

    for row in &remote {
        let process_name     = row["process_name"].as_str().map(String::from);
        let domain           = row["domain"].as_str().map(String::from);
        let required_minutes = row["required_minutes"].as_i64().unwrap_or(60);
        let user_id          = row["user_id"].as_str().unwrap_or("default").to_string();
        let updated_at       = row["updated_at"].as_str().unwrap_or("").to_string();
        let remote_id        = row["id"].as_str().unwrap_or("").to_string();

        if remote_id.is_empty() { continue; }
        if process_name.is_none() && domain.is_none() { continue; }

        // Two-step upsert keyed on remote_id — no UNIQUE constraint (iOS 26 beta SQLite bug).
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let update_ok = db.execute(
            "UPDATE time_unlock_rules
             SET process_name = ?1, domain = ?2, required_minutes = ?3,
                 user_id = ?4, updated_at = ?5, synced = 1
             WHERE remote_id = ?6
               AND (updated_at IS NULL OR ?5 >= updated_at)",
            params![process_name, domain, required_minutes, user_id, updated_at, remote_id],
        );
        let insert_ok = db.execute(
            "INSERT INTO time_unlock_rules
               (process_name, domain, required_minutes, user_id, updated_at, synced, remote_id)
             SELECT ?1, ?2, ?3, ?4, ?5, 1, ?6
             WHERE NOT EXISTS (SELECT 1 FROM time_unlock_rules WHERE remote_id = ?6)",
            params![process_name, domain, required_minutes, user_id, updated_at, remote_id],
        );
        match (update_ok, insert_ok) {
            (Ok(_), Ok(_)) => result.rules_pulled += 1,
            (Err(e), _) | (_, Err(e)) => result.errors.push(format!("unlock rule pull upsert: {e}")),
        }
    }

    Ok(result)
}

// ── full bidirectional sync ───────────────────────────────────────────────────

pub async fn sync_all_blocking(
    state: &AppState,
    config: &AppConfig,
) -> Result<BlockingSyncResult, String> {
    let mut total = BlockingSyncResult::default();

    // Push everything unsynced first, then pull
    macro_rules! merge {
        ($fut:expr) => {
            match $fut.await {
                Ok(r) => {
                    total.sites_pushed  += r.sites_pushed;
                    total.sites_pulled  += r.sites_pulled;
                    total.apps_pushed   += r.apps_pushed;
                    total.apps_pulled   += r.apps_pulled;
                    total.blocks_pushed += r.blocks_pushed;
                    total.blocks_pulled += r.blocks_pulled;
                    total.rules_pushed  += r.rules_pushed;
                    total.rules_pulled  += r.rules_pulled;
                    total.errors.extend(r.errors);
                }
                Err(e) => total.errors.push(e),
            }
        };
    }

    merge!(push_blocked_sites(state, config));
    merge!(push_blocked_apps(state, config));
    merge!(push_focus_blocks(state, config));
    merge!(push_unlock_rules(state, config));

    merge!(pull_blocked_sites(state, config));
    merge!(pull_blocked_apps(state, config));
    merge!(pull_focus_blocks(state, config));
    merge!(pull_unlock_rules(state, config));

    Ok(total)
}
