use crate::models::{ActiveSession, AppConfig, PausedSession};
use crate::sync::device;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;

const TABLE: &str = "active_sessions";

/// What the poll command returns to the frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "type", content = "data")]
pub enum PollResult {
    /// No remote session exists and local state is unchanged.
    NoChange,
    /// Remote session was silently adopted (local was idle, same device or
    /// matching session — frontend should call get_status to refresh).
    Adopted,
    /// A different device has an active session while we are also active.
    /// Frontend shows the conflict banner.
    Conflict(RemoteSession),
    /// Remote session disappeared (other device stopped). If local is still
    /// showing a remotely-adopted session the frontend should stop it.
    RemoteGone,
}

/// A snapshot of a remote active session, sent to the frontend.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RemoteSession {
    pub device_id: String,
    pub task_name: String,
    pub project: Option<String>,
    pub tags: Option<String>,
    pub notes: Option<String>,
    pub billable: bool,
    pub hourly_rate: f64,
    pub start_time: String,
    pub paused_at: Option<String>,
    pub elapsed_seconds: i64,
    pub user_id: String,
}

// ── helpers ───────────────────────────────────────────────────────────────────

fn base_url(config: &AppConfig) -> String {
    format!(
        "{}/rest/v1/{TABLE}",
        config.supabase.url.trim_end_matches('/')
    )
}

fn auth_headers(config: &AppConfig) -> [(&'static str, String); 2] {
    [
        ("apikey", config.supabase.key.clone()),
        ("Authorization", format!("Bearer {}", config.supabase.key)),
    ]
}

fn is_configured(config: &AppConfig) -> bool {
    !config.supabase.url.is_empty() && !config.supabase.key.is_empty()
}

// ── push ─────────────────────────────────────────────────────────────────────

/// Upsert the current active session to Supabase.
/// Call after start_timer / resume_timer.
pub async fn push_active(
    config: &AppConfig,
    session: &ActiveSession,
    user_id: &str,
) -> Result<(), String> {
    if !is_configured(config) {
        return Ok(());
    }

    let device_id = device::get_or_create();
    let client = Client::new();
    let url = format!("{}?on_conflict=user_id", base_url(config));

    let body = json!({
        "user_id":        user_id,
        "device_id":      device_id,
        "task_name":      session.task_name,
        "project":        session.project,
        "tags":           session.tags,
        "notes":          session.notes,
        "billable":       session.billable,
        "hourly_rate":    session.hourly_rate,
        "start_time":     session.start_time,
        "paused_at":      serde_json::Value::Null,
        "elapsed_seconds": 0,
        "updated_at":     chrono::Utc::now().to_rfc3339(),
    });

    let resp = client
        .post(&url)
        .header("apikey", &config.supabase.key)
        .header("Authorization", format!("Bearer {}", config.supabase.key))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("push_active HTTP {status}: {text}"));
    }
    Ok(())
}

/// Upsert a paused session to Supabase.
/// Call after pause_timer.
pub async fn push_paused(
    config: &AppConfig,
    session: &PausedSession,
    user_id: &str,
) -> Result<(), String> {
    if !is_configured(config) {
        return Ok(());
    }

    let device_id = device::get_or_create();
    let client = Client::new();
    let url = format!("{}?on_conflict=user_id", base_url(config));

    let body = json!({
        "user_id":         user_id,
        "device_id":       device_id,
        "task_name":       session.task_name,
        "project":         session.project,
        "tags":            session.tags,
        "notes":           session.notes,
        "billable":        session.billable,
        "hourly_rate":     session.hourly_rate,
        "start_time":      session.start_time,
        "paused_at":       session.paused_at,
        "elapsed_seconds": session.elapsed_seconds,
        "updated_at":      chrono::Utc::now().to_rfc3339(),
    });

    let resp = client
        .post(&url)
        .header("apikey", &config.supabase.key)
        .header("Authorization", format!("Bearer {}", config.supabase.key))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("push_paused HTTP {status}: {text}"));
    }
    Ok(())
}

// ── clear ─────────────────────────────────────────────────────────────────────

/// Delete this user's remote active session.
/// Call after stop_timer / cancel_paused.
pub async fn clear_remote(config: &AppConfig, user_id: &str) -> Result<(), String> {
    if !is_configured(config) {
        return Ok(());
    }

    let client = Client::new();
    let url = format!(
        "{}?user_id=eq.{}",
        base_url(config),
        urlencoding::encode(user_id)
    );

    let resp = client
        .delete(&url)
        .header("apikey", &config.supabase.key)
        .header("Authorization", format!("Bearer {}", config.supabase.key))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("clear_remote HTTP {status}: {text}"));
    }
    Ok(())
}

// ── poll ──────────────────────────────────────────────────────────────────────

/// Fetch the remote active session for this user and decide what to tell the
/// frontend.
///
/// Logic:
///   remote missing + local idle   → NoChange
///   remote missing + local active → RemoteGone  (other device stopped)
///   remote present, same device   → NoChange    (our own push, ignore)
///   remote present, other device, local idle → Adopted  (take it over)
///   remote present, other device, local active → Conflict
pub async fn poll(
    config: &AppConfig,
    local_status: &str,   // "idle" | "running" | "paused"
    local_start_time: Option<&str>,
) -> Result<PollResult, String> {
    if !is_configured(config) {
        return Ok(PollResult::NoChange);
    }

    let device_id = device::get_or_create();
    let user_id = "default"; // single-user for now; extend when multi-user lands
    let client = Client::new();

    let url = format!(
        "{}?user_id=eq.{}&select=*",
        base_url(config),
        urlencoding::encode(user_id)
    );

    let resp = client
        .get(&url)
        .header("apikey", &config.supabase.key)
        .header("Authorization", format!("Bearer {}", config.supabase.key))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("poll HTTP {}", resp.status()));
    }

    let rows: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;
    let remote = rows.into_iter().next();

    match remote {
        None => {
            // No remote session
            if local_status == "running" || local_status == "paused" {
                // We have a local session but nothing remote — another device
                // cleared it. Signal the frontend.
                Ok(PollResult::RemoteGone)
            } else {
                Ok(PollResult::NoChange)
            }
        }
        Some(row) => {
            let remote_device = row["device_id"].as_str().unwrap_or("").to_string();
            let remote_start = row["start_time"].as_str().unwrap_or("").to_string();

            // Our own push — skip
            if remote_device == device_id {
                return Ok(PollResult::NoChange);
            }

            // Same start time as our local session — already in sync
            if let Some(local_st) = local_start_time {
                if local_st == remote_start {
                    return Ok(PollResult::NoChange);
                }
            }

            let remote_session = RemoteSession {
                device_id: remote_device,
                task_name: row["task_name"]
                    .as_str()
                    .unwrap_or("Unknown")
                    .to_string(),
                project: row["project"].as_str().map(String::from),
                tags: row["tags"].as_str().map(String::from),
                notes: row["notes"].as_str().map(String::from),
                billable: row["billable"].as_bool().unwrap_or(false),
                hourly_rate: row["hourly_rate"].as_f64().unwrap_or(0.0),
                start_time: remote_start,
                paused_at: row["paused_at"].as_str().map(String::from),
                elapsed_seconds: row["elapsed_seconds"].as_i64().unwrap_or(0),
                user_id: row["user_id"]
                    .as_str()
                    .unwrap_or("default")
                    .to_string(),
            };

            if local_status == "idle" {
                // Silently adopt: caller will insert into local DB
                Ok(PollResult::Adopted(remote_session))
            } else {
                // Local is running/paused with a different session → conflict
                Ok(PollResult::Conflict(remote_session))
            }
        }
    }
}
