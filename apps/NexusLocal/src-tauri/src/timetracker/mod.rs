//! Productivity stack folded in from TimeTracker: session recording, pomodoro,
//! focus schedules, rewards, and the materialized blocking state.
//!
//! # Where the thinking happens
//!
//! Nothing in here computes policy. The `focus-evaluate` edge function runs on
//! pg_cron and resolves schedule windows, reward unlocks and `focus_only` modes
//! into a single `blocking_state` row; clients read that row and act on it. This
//! is the same split as the Vellafit bridge — the device does the cheap thing,
//! the server does the thinking on a schedule — and it is what makes blocking
//! autonomous rather than dependent on an app being open.
//!
//! # Adding to this module
//!
//! Each submodule owns its own file and its commands are already listed in
//! `lib.rs`'s `generate_handler!`. Fill in the file; don't touch the registration.
//!
//! Two rules that fail silently if broken:
//!
//! 1. Every command needs a `#[cfg(not(target_os = "ios"))]` no-op arm — the
//!    desktop build has to keep compiling, and `cargo check` on macOS is what
//!    most verification runs against.
//! 2. These tables are keyed `user_id = "default"` under anon-role RLS. Reading
//!    them with an authenticated JWT returns an empty set, not an error.

// Scaffolding: the REST verbs and table names exist before the submodules that
// call them, so every one of them is briefly dead. Remove this once the stubs
// below are filled in — it should stop being needed, and a real unused item is
// worth hearing about.
#![allow(dead_code)]

pub mod blocking_state;
pub mod focus;
pub mod pomodoro;
pub mod rewards;
pub mod session;

use crate::config::AppConfig;
use serde_json::Value;

/// Tables this module owns. Named once so a typo is a compile error rather than
/// a silent empty result set.
pub const T_ACTIVE_SESSIONS: &str = "active_sessions";
pub const T_TIME_ENTRIES: &str = "time_entries";
pub const T_BLOCKING_STATE: &str = "blocking_state";
pub const T_POMODORO_CONFIG: &str = "pomodoro_config";
pub const T_FOCUS_BLOCKS: &str = "focus_blocks";
pub const T_UNLOCK_RULES: &str = "unlock_rules";
pub const T_BLOCKED_SITES: &str = "blocked_sites";
pub const T_BLOCKED_APPS: &str = "blocked_apps";

/// Thin PostgREST client for the productivity tables.
///
/// Deliberately separate from `grid::supabase::Supabase`, which is scoped to the
/// two grid tables and models a command queue. This one is a plain REST verb
/// surface so each submodule can express its own query.
#[derive(Clone)]
pub struct Rest {
    url: String,
    key: String,
    user_id: String,
    client: reqwest::Client,
}

impl Rest {
    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            url: config.supabase.url.trim_end_matches('/').to_string(),
            key: config.supabase.key.clone(),
            user_id: config.user_id.clone(),
            client: reqwest::Client::new(),
        }
    }

    /// Built fresh from `~/.nexuslocalrc` so commands don't need Tauri state.
    pub fn load() -> Self {
        Self::from_config(&AppConfig::load())
    }

    pub fn user_id(&self) -> &str {
        &self.user_id
    }

    pub fn is_configured(&self) -> bool {
        !self.url.is_empty() && !self.key.is_empty()
    }

    fn endpoint(&self, table: &str) -> String {
        format!("{}/rest/v1/{table}", self.url)
    }

    fn auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        req.header("apikey", &self.key)
            .header("Authorization", format!("Bearer {}", self.key))
    }

    pub async fn select(&self, table: &str, query: &[(&str, &str)]) -> Result<Value, String> {
        let resp = self
            .auth(self.client.get(self.endpoint(table)))
            .query(query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        json_or_err(resp).await
    }

    /// Upsert. `on_conflict` names the unique constraint to merge on.
    pub async fn upsert(
        &self,
        table: &str,
        on_conflict: &str,
        body: &Value,
    ) -> Result<Value, String> {
        let resp = self
            .auth(self.client.post(self.endpoint(table)))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates,return=representation")
            .query(&[("on_conflict", on_conflict)])
            .json(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        json_or_err(resp).await
    }

    pub async fn insert(&self, table: &str, body: &Value) -> Result<Value, String> {
        let resp = self
            .auth(self.client.post(self.endpoint(table)))
            .header("Content-Type", "application/json")
            .header("Prefer", "return=representation")
            .json(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        json_or_err(resp).await
    }

    pub async fn update(
        &self,
        table: &str,
        query: &[(&str, &str)],
        body: &Value,
    ) -> Result<Value, String> {
        let resp = self
            .auth(self.client.patch(self.endpoint(table)))
            .header("Content-Type", "application/json")
            .header("Prefer", "return=representation")
            .query(query)
            .json(body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        json_or_err(resp).await
    }

    pub async fn delete(&self, table: &str, query: &[(&str, &str)]) -> Result<(), String> {
        let resp = self
            .auth(self.client.delete(self.endpoint(table)))
            .header("Prefer", "return=minimal")
            .query(query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(status_error(resp).await)
        }
    }
}

async fn json_or_err(resp: reqwest::Response) -> Result<Value, String> {
    if resp.status().is_success() {
        resp.json::<Value>().await.map_err(|e| e.to_string())
    } else {
        Err(status_error(resp).await)
    }
}

async fn status_error(resp: reqwest::Response) -> String {
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    format!("supabase {status}: {body}")
}

/// PostgREST `eq.` filter value.
pub fn eq(value: &str) -> String {
    format!("eq.{value}")
}

/// Timestamps in these tables are RFC3339 UTC. TimeTracker's SQLite era wrote
/// local-time strings with a space separator, which made every last-write-wins
/// comparison a lexical string compare that remote always won. Anything written
/// from here uses this.
pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339()
}
