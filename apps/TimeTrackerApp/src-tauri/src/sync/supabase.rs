use crate::db::entries;
use crate::db::AppState;
use crate::models::{AppConfig, SyncResult, TimeEntry};
use crate::sync::device;
use reqwest::Client;
use serde_json::json;
use std::collections::HashSet;

pub async fn push_unsynced(
    state: &AppState,
    config: &AppConfig,
) -> Result<SyncResult, String> {
    if config.supabase.url.is_empty() || config.supabase.key.is_empty() {
        return Err("Supabase not configured".into());
    }

    let device_id = device::get_or_create();
    let entries = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        entries::get_unsynced_entries(&db).map_err(|e| e.to_string())?
    };

    let client = Client::new();
    let url = format!(
        "{}/rest/v1/{}",
        config.supabase.url.trim_end_matches('/'),
        config.supabase.table_name
    );

    let mut pushed = 0;
    let mut errors: Vec<String> = vec![];

    for entry in &entries {
        let body = json!({
            "local_id": entry.id,
            "device_id": device_id,
            "user_id": entry.user_id,
            "task_name": entry.task_name,
            "project": entry.project,
            "start_time": entry.start_time,
            "end_time": entry.end_time,
            "duration_seconds": entry.duration_seconds,
            "tags": entry.tags,
            "notes": entry.notes,
            "billable": entry.billable,
            "hourly_rate": entry.hourly_rate,
            "created_at": entry.created_at,
        });

        let resp = client
            .post(&url)
            .header("apikey", &config.supabase.key)
            .header("Authorization", format!("Bearer {}", config.supabase.key))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates")
            .json(&body)
            .send()
            .await;

        match resp {
            Ok(r) if r.status().is_success() => {
                let db = state.db.lock().map_err(|e| e.to_string())?;
                let _ = entries::mark_as_synced(&db, entry.id);
                pushed += 1;
            }
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                errors.push(format!("Entry {}: HTTP {status} — {text}", entry.id));
            }
            Err(e) => errors.push(format!("Entry {}: {e}", entry.id)),
        }
    }

    Ok(SyncResult {
        pushed,
        pulled: 0,
        errors,
    })
}

pub async fn pull_from_cloud(
    state: &AppState,
    config: &AppConfig,
    include_own_device: bool,
) -> Result<SyncResult, String> {
    if config.supabase.url.is_empty() || config.supabase.key.is_empty() {
        return Err("Supabase not configured".into());
    }

    let device_id = device::get_or_create();
    let client = Client::new();

    let filter = if include_own_device {
        String::new()
    } else {
        format!("device_id=neq.{device_id}")
    };

    let url = format!(
        "{}/rest/v1/{}?{}",
        config.supabase.url.trim_end_matches('/'),
        config.supabase.table_name,
        filter
    );

    let resp = client
        .get(&url)
        .header("apikey", &config.supabase.key)
        .header("Authorization", format!("Bearer {}", config.supabase.key))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Supabase pull failed: HTTP {}", resp.status()));
    }

    let remote: Vec<serde_json::Value> = resp.json().await.map_err(|e| e.to_string())?;

    // Build dedup set from existing entries (start_time + task_name)
    let existing: HashSet<String> = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        entries::get_entries(&db, None, None, None, None, None, None)
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|e| format!("{}|{}", e.start_time, e.task_name))
            .collect()
    };

    let mut pulled = 0;
    let mut errors: Vec<String> = vec![];

    for record in remote {
        let key = format!(
            "{}|{}",
            record["start_time"].as_str().unwrap_or(""),
            record["task_name"].as_str().unwrap_or("")
        );
        if existing.contains(&key) {
            continue;
        }

        let entry = TimeEntry {
            id: 0,
            task_name: record["task_name"]
                .as_str()
                .unwrap_or("imported")
                .to_string(),
            project: record["project"].as_str().map(String::from),
            start_time: record["start_time"]
                .as_str()
                .unwrap_or_default()
                .to_string(),
            end_time: record["end_time"].as_str().map(String::from),
            duration_seconds: record["duration_seconds"].as_i64().unwrap_or(0),
            tags: record["tags"].as_str().map(String::from),
            notes: record["notes"].as_str().map(String::from),
            billable: record["billable"].as_bool().unwrap_or(false),
            hourly_rate: record["hourly_rate"].as_f64().unwrap_or(0.0),
            synced: true,
            user_id: record["user_id"].as_str().map(String::from),
            created_at: record["created_at"].as_str().map(String::from),
        };

        let db = state.db.lock().map_err(|e| e.to_string())?;
        match entries::import_entry(&db, &entry) {
            Ok(Some(_)) => pulled += 1,
            Ok(None) => {}
            Err(e) => errors.push(e.to_string()),
        }
    }

    Ok(SyncResult {
        pushed: 0,
        pulled,
        errors,
    })
}

pub async fn test_connection(config: &AppConfig) -> Result<bool, String> {
    if config.supabase.url.is_empty() || config.supabase.key.is_empty() {
        return Ok(false);
    }
    let client = Client::new();
    let url = format!(
        "{}/rest/v1/{}?limit=1",
        config.supabase.url.trim_end_matches('/'),
        config.supabase.table_name
    );
    let resp = client
        .get(&url)
        .header("apikey", &config.supabase.key)
        .header("Authorization", format!("Bearer {}", config.supabase.key))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp.status().is_success())
}
