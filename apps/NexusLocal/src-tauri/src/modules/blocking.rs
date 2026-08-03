//! Blocking module — macOS site blocking via `/etc/hosts`, the second grid
//! capability. Ports TimeTracker's proven marker-bracketed hosts approach but
//! under its own marker so the two enforcers never touch each other's region.
//!
//! Autonomous enforcement (the tick) is gated behind `blocking_enabled` in the
//! node config, off by default, because writing `/etc/hosts` requires an admin
//! prompt. Explicit `apply`/`clear` commands work regardless (user-initiated).
//!
//! The block list is read from the shared `blocked_sites` table — the same one
//! TimeTracker's UI edits — so blocking is driven by existing config.

use crate::grid::{ModuleContext, ModuleManifest, NexusModule};
use async_trait::async_trait;
use serde_json::{json, Value};

const MARKER_BEGIN: &str = "# BEGIN NexusLocal-Block";
const MARKER_END: &str = "# END NexusLocal-Block";

pub struct BlockingModule {
    /// Whether the tick autonomously enforces `blocked_sites`.
    enabled: bool,
}

impl BlockingModule {
    pub fn new(enabled: bool) -> Self {
        Self { enabled }
    }
}

#[async_trait]
impl NexusModule for BlockingModule {
    fn manifest(&self) -> ModuleManifest {
        ModuleManifest {
            id: "blocking".to_string(),
            name: "TimeTracker · Site Blocking".to_string(),
            version: "0.1.0".to_string(),
            actions: vec!["status".to_string(), "apply".to_string(), "clear".to_string()],
            // Re-enforce every 30s so blocked_sites edits take effect without a
            // manual command — but only when enforcement is switched on.
            tick_interval_secs: if self.enabled { Some(30) } else { None },
        }
    }

    async fn tick(&self, ctx: &ModuleContext) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }
        let domains = enabled_domains(ctx).await?;
        tokio::task::spawn_blocking(move || apply(&domains))
            .await
            .map_err(|e| e.to_string())?
    }

    async fn handle(
        &self,
        action: &str,
        _payload: &Value,
        ctx: &ModuleContext,
    ) -> Result<Value, String> {
        match action {
            "status" => {
                let blocked = tokio::task::spawn_blocking(current_blocked)
                    .await
                    .map_err(|e| e.to_string())??;
                Ok(json!({ "enforcing": self.enabled, "blocked": blocked, "count": blocked.len() }))
            }
            "apply" => {
                let domains = enabled_domains(ctx).await?;
                let n = domains.len();
                tokio::task::spawn_blocking(move || apply(&domains))
                    .await
                    .map_err(|e| e.to_string())??;
                Ok(json!({ "applied": n }))
            }
            "clear" => {
                tokio::task::spawn_blocking(clear)
                    .await
                    .map_err(|e| e.to_string())??;
                Ok(json!({ "cleared": true }))
            }
            other => Err(format!("unsupported blocking action: {other}")),
        }
    }
}

/// Fetch the enabled block list from the shared `blocked_sites` table.
async fn enabled_domains(ctx: &ModuleContext) -> Result<Vec<String>, String> {
    let rows = ctx
        .supabase
        .select("blocked_sites", &[("select", "domain"), ("enabled", "eq.true")])
        .await?;
    let domains = rows
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|r| r.get("domain").and_then(|d| d.as_str()))
                .map(|s| s.to_string())
                .filter(|s| !s.trim().is_empty())
                .collect()
        })
        .unwrap_or_default();
    Ok(domains)
}

// ── hosts-file plumbing (macOS) ─────────────────────────────────────────────

#[cfg(target_os = "macos")]
fn build_block(domains: &[String]) -> String {
    if domains.is_empty() {
        return String::new();
    }
    let mut lines = vec![MARKER_BEGIN.to_owned()];
    for domain in domains {
        let domain = domain.trim();
        if domain.is_empty() {
            continue;
        }
        lines.push(format!("127.0.0.1 {domain}"));
        if !domain.starts_with("www.") {
            lines.push(format!("127.0.0.1 www.{domain}"));
        }
    }
    lines.push(MARKER_END.to_owned());
    lines.join("\n")
}

#[cfg(target_os = "macos")]
fn strip_block(content: &str) -> String {
    let mut out = Vec::new();
    let mut inside = false;
    for line in content.lines() {
        if line.trim() == MARKER_BEGIN {
            inside = true;
            continue;
        }
        if line.trim() == MARKER_END {
            inside = false;
            continue;
        }
        if !inside {
            out.push(line);
        }
    }
    while out.last().map(|l: &&str| l.trim().is_empty()).unwrap_or(false) {
        out.pop();
    }
    out.join("\n")
}

/// Domains currently blocked in our marker region of /etc/hosts (bare, no www).
fn current_blocked() -> Result<Vec<String>, String> {
    let content = std::fs::read_to_string("/etc/hosts")
        .map_err(|e| format!("Cannot read /etc/hosts: {e}"))?;
    let mut domains = Vec::new();
    let mut inside = false;
    for line in content.lines() {
        match line.trim() {
            MARKER_BEGIN => inside = true,
            MARKER_END => inside = false,
            l if inside => {
                if let Some(host) = l.strip_prefix("127.0.0.1 ") {
                    let host = host.trim();
                    if !host.starts_with("www.") {
                        domains.push(host.to_string());
                    }
                }
            }
            _ => {}
        }
    }
    Ok(domains)
}

#[cfg(target_os = "macos")]
fn apply(domains: &[String]) -> Result<(), String> {
    let current = std::fs::read_to_string("/etc/hosts")
        .map_err(|e| format!("Cannot read /etc/hosts: {e}"))?;
    let stripped = strip_block(&current);
    let block = build_block(domains);
    let new_content = if block.is_empty() {
        stripped
    } else {
        format!("{stripped}\n\n{block}\n")
    };

    // Skip the privileged write (and its password dialog) if nothing changed.
    if new_content == current {
        return Ok(());
    }

    let escaped = new_content.replace('\'', r"'\''");
    let script = format!(
        "do shell script \
         \"printf '%s' '{escaped}' | tee /etc/hosts > /dev/null && \
           dscacheutil -flushcache && killall -HUP mDNSResponder\" \
         with administrator privileges"
    );
    let output = std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("osascript failed to launch: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "hosts update failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

#[cfg(not(target_os = "macos"))]
fn apply(_domains: &[String]) -> Result<(), String> {
    Err("site blocking is only implemented on macOS".to_string())
}

fn clear() -> Result<(), String> {
    apply(&[])
}
