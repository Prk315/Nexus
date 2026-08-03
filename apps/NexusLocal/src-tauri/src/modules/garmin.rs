//! Garmin module — the first grid capability. Wraps the vendored
//! `modules/garmin/garmin_bridge.py`, which logs into Garmin Connect with tokens
//! stored in `~/.garminconnect` and prints JSON.
//!
//! This module only *fetches*: a queued command returns the raw JSON as its
//! result, and the web app that enqueued it maps + upserts into the
//! `protocol_*` tables — matching the existing desktop data flow.

use crate::grid::{ModuleContext, ModuleManifest, NexusModule};
use async_trait::async_trait;
use serde_json::Value;
use std::path::PathBuf;

pub struct GarminModule;

#[async_trait]
impl NexusModule for GarminModule {
    fn manifest(&self) -> ModuleManifest {
        ModuleManifest {
            id: "garmin".to_string(),
            name: "Protocol · Garmin Bridge".to_string(),
            version: "0.1.0".to_string(),
            actions: vec![
                "check".to_string(),
                "status".to_string(),
                "sleep".to_string(),
                "body_stats".to_string(),
                "activities".to_string(),
            ],
            tick_interval_secs: None,
        }
    }

    async fn handle(
        &self,
        action: &str,
        payload: &Value,
        _ctx: &ModuleContext,
    ) -> Result<Value, String> {
        let args = build_args(action, payload)?;
        // The Python call is blocking — keep it off the async runtime.
        let raw = tokio::task::spawn_blocking(move || run_bridge(args))
            .await
            .map_err(|e| e.to_string())??;
        serde_json::from_str::<Value>(raw.trim())
            .map_err(|e| format!("bridge returned non-JSON: {e} — {raw}"))
    }
}

/// Translate a queue action + payload into `garmin_bridge.py` CLI args.
fn build_args(action: &str, payload: &Value) -> Result<Vec<String>, String> {
    let mut args = vec![action.to_string()];
    match action {
        "check" | "status" => {}
        "sleep" | "body_stats" | "activities" => {
            let date = payload
                .get("date")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(today);
            let days = payload.get("days").and_then(|v| v.as_u64()).unwrap_or(7);
            args.push("--date".to_string());
            args.push(date);
            args.push("--days".to_string());
            args.push(days.to_string());
        }
        other => return Err(format!("unsupported garmin action: {other}")),
    }
    Ok(args)
}

fn today() -> String {
    chrono::Utc::now().format("%Y-%m-%d").to_string()
}

/// Locate the vendored bridge script: env override → dev path relative to this
/// crate → walk up from the executable for bundled/release layouts.
fn bridge_script_path() -> Result<PathBuf, String> {
    if let Ok(env_path) = std::env::var("GARMIN_BRIDGE_PATH") {
        let p = PathBuf::from(env_path);
        if p.exists() {
            return Ok(p);
        }
    }

    const REL: &str = "modules/garmin/garmin_bridge.py";

    // Dev: CARGO_MANIFEST_DIR is <app>/src-tauri; the bridge is at <app>/modules/…
    #[cfg(debug_assertions)]
    {
        if let Some(app_dir) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent() {
            let candidate = app_dir.join(REL);
            if candidate.exists() {
                return Ok(candidate);
            }
        }
    }

    // Release/bundled: walk upward from the executable.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut dir = exe.parent().unwrap_or(&exe).to_path_buf();
    for _ in 0..8 {
        let candidate = dir.join(REL);
        if candidate.exists() {
            return Ok(candidate);
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
    }

    Err("garmin_bridge.py not found — set GARMIN_BRIDGE_PATH to override".to_string())
}

/// Interpreters to try, in order. A module-owned venv is preferred so the module
/// carries its own pinned `garminconnect` and doesn't depend on whatever Python
/// happens to be on PATH (the system one is often too old). Falls back to
/// `GARMIN_PYTHON`, then `py -3` / `python` / `python3`.
fn python_candidates() -> Vec<Vec<String>> {
    let mut cands: Vec<Vec<String>> = Vec::new();

    if let Ok(p) = std::env::var("GARMIN_PYTHON") {
        if !p.is_empty() {
            cands.push(vec![p]);
        }
    }

    // ~/.nexuslocal/venvs/garmin/bin/python — the module's dedicated venv.
    let venv = crate::config::state_dir()
        .join("venvs")
        .join("garmin")
        .join("bin")
        .join("python");
    if venv.exists() {
        cands.push(vec![venv.to_string_lossy().to_string()]);
    }

    cands.push(vec!["py".to_string(), "-3".to_string()]);
    cands.push(vec!["python".to_string()]);
    cands.push(vec!["python3".to_string()]);
    cands
}

fn invoke_python(args: &[String]) -> Result<std::process::Output, String> {
    let mut last_err = "no python interpreter available".to_string();
    for cand in python_candidates() {
        let (bin, prefix) = cand.split_first().expect("candidate is non-empty");
        match std::process::Command::new(bin)
            .args(prefix)
            .args(args)
            .output()
        {
            Ok(output) => return Ok(output),
            Err(e) => last_err = format!("{bin}: {e}"),
        }
    }
    Err(format!("Failed to launch Python: {last_err}"))
}

fn run_bridge(cmd_args: Vec<String>) -> Result<String, String> {
    let bridge = bridge_script_path()?;
    let mut full = vec![bridge.to_string_lossy().to_string()];
    full.extend(cmd_args);

    let output = invoke_python(&full)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).to_string())
    }
}
