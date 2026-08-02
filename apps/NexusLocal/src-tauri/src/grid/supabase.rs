//! Thin PostgREST client for the two grid tables. Uses the same reqwest +
//! anon-key pattern as TimeTracker's sync layer.

use serde::Deserialize;
use serde_json::{json, Value};

const NODES_TABLE: &str = "nexus_local_nodes";
const COMMANDS_TABLE: &str = "nexus_local_commands";

/// One row of work enqueued by a web app for a module to execute.
#[derive(Debug, Clone, Deserialize)]
pub struct Command {
    pub id: String,
    pub module: String,
    pub action: String,
    #[serde(default)]
    pub payload: Value,
}

/// Snapshot of this node written to `nexus_local_nodes` on each heartbeat.
pub struct NodePresence<'a> {
    pub device_id: &'a str,
    pub user_id: &'a str,
    pub platform: &'a str,
    pub hostname: &'a str,
    pub version: &'a str,
    pub modules: Value,
}

#[derive(Clone)]
pub struct Supabase {
    url: String,
    key: String,
    client: reqwest::Client,
}

impl Supabase {
    pub fn new(url: String, key: String) -> Self {
        Self {
            url: url.trim_end_matches('/').to_string(),
            key,
            client: reqwest::Client::new(),
        }
    }

    pub fn is_configured(&self) -> bool {
        !self.url.is_empty() && !self.key.is_empty()
    }

    fn rest(&self, table: &str) -> String {
        format!("{}/rest/v1/{table}", self.url)
    }

    fn auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        req.header("apikey", &self.key)
            .header("Authorization", format!("Bearer {}", self.key))
    }

    /// Upsert this node's presence + installed-module list.
    pub async fn heartbeat(&self, node: &NodePresence<'_>) -> Result<(), String> {
        let body = json!([{
            "device_id": node.device_id,
            "user_id": node.user_id,
            "platform": node.platform,
            "hostname": node.hostname,
            "version": node.version,
            "modules": node.modules,
            "last_seen": now(),
        }]);

        let resp = self
            .auth(self.client.post(self.rest(NODES_TABLE)))
            .header("Content-Type", "application/json")
            .header("Prefer", "resolution=merge-duplicates,return=minimal")
            .query(&[("on_conflict", "device_id")])
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;

        ensure_ok(resp).await
    }

    /// Atomically (per node) claim pending commands addressed to this node or
    /// left untargeted, for the modules this node actually has installed.
    ///
    /// NOTE: a filtered PATCH is a safe claim for a single node. For multiple
    /// nodes racing the same queue, move this to a Postgres RPC using
    /// `FOR UPDATE SKIP LOCKED`.
    pub async fn claim_pending(
        &self,
        device_id: &str,
        module_ids: &[String],
    ) -> Result<Vec<Command>, String> {
        if module_ids.is_empty() {
            return Ok(vec![]);
        }
        let modules_in = format!("in.({})", module_ids.join(","));
        let target_or = format!("(target_device.is.null,target_device.eq.{device_id})");

        let resp = self
            .auth(self.client.patch(self.rest(COMMANDS_TABLE)))
            .header("Content-Type", "application/json")
            .header("Prefer", "return=representation")
            .query(&[
                ("status", "eq.pending"),
                ("module", modules_in.as_str()),
                ("or", target_or.as_str()),
            ])
            .json(&json!({
                "status": "claimed",
                "claimed_by": device_id,
                "claimed_at": now(),
            }))
            .send()
            .await
            .map_err(|e| e.to_string())?;

        let resp = error_for_status(resp).await?;
        resp.json::<Vec<Command>>().await.map_err(|e| e.to_string())
    }

    /// Mark a command done with its result payload.
    pub async fn complete(&self, id: &str, result: &Value) -> Result<(), String> {
        self.finish(id, json!({
            "status": "done",
            "result": result,
            "completed_at": now(),
        }))
        .await
    }

    /// Mark a command failed with an error message.
    pub async fn fail(&self, id: &str, error: &str) -> Result<(), String> {
        self.finish(id, json!({
            "status": "error",
            "error": error,
            "completed_at": now(),
        }))
        .await
    }

    async fn finish(&self, id: &str, patch: Value) -> Result<(), String> {
        let resp = self
            .auth(self.client.patch(self.rest(COMMANDS_TABLE)))
            .header("Content-Type", "application/json")
            .header("Prefer", "return=minimal")
            .query(&[("id", format!("eq.{id}").as_str())])
            .json(&patch)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        ensure_ok(resp).await
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

async fn ensure_ok(resp: reqwest::Response) -> Result<(), String> {
    error_for_status(resp).await.map(|_| ())
}

async fn error_for_status(resp: reqwest::Response) -> Result<reqwest::Response, String> {
    if resp.status().is_success() {
        Ok(resp)
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("supabase {status}: {body}"))
    }
}
