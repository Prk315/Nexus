//! The local grid: a host runtime that loads installable **modules**, each a
//! self-contained local capability (Garmin sync, site/app blocking, widget
//! feeds, …). Modules never talk to the web apps directly. Instead the grid
//! coordinates entirely through Supabase — the one component that is always on:
//!
//!   web app  ──enqueue command──►  nexus_local_commands  ◄──poll/execute──  grid node
//!                                  nexus_local_nodes      ◄──heartbeat────
//!
//! Adding a capability = implement [`NexusModule`] and register it in
//! `modules::registry()`. Nothing else in the runtime needs to change.

pub mod runtime;
pub mod supabase;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A module's identity and contract, surfaced to the grid and (via presence) to
/// the web apps so the UI knows what is installed and what it can ask for.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModuleManifest {
    /// Stable slug used to route commands, e.g. `"garmin"`.
    pub id: String,
    /// Human-readable name for the dashboard.
    pub name: String,
    pub version: String,
    /// Command actions this module accepts, e.g. `["sleep", "body_stats"]`.
    pub actions: Vec<String>,
    /// If `Some(n)`, the runtime calls [`NexusModule::tick`] every `n` seconds.
    pub tick_interval_secs: Option<u64>,
}

/// Everything a module is handed at runtime.
#[derive(Clone)]
pub struct ModuleContext {
    pub supabase: supabase::Supabase,
    pub user_id: String,
    pub device_id: String,
}

/// A single installable local capability in the Nexus Local grid.
#[async_trait]
pub trait NexusModule: Send + Sync {
    fn manifest(&self) -> ModuleManifest;

    /// Run once when the runtime starts. Default: no-op.
    async fn on_start(&self, _ctx: &ModuleContext) -> Result<(), String> {
        Ok(())
    }

    /// Periodic autonomous work, if `tick_interval_secs` is set. Default: no-op.
    async fn tick(&self, _ctx: &ModuleContext) -> Result<(), String> {
        Ok(())
    }

    /// Handle one queued command routed to this module. Returns a JSON result
    /// that is written back to the command row for the web app to read.
    async fn handle(
        &self,
        action: &str,
        payload: &Value,
        ctx: &ModuleContext,
    ) -> Result<Value, String>;
}
