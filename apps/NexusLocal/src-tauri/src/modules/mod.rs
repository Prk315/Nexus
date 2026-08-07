//! Module registry. To install a new local capability, implement
//! [`crate::grid::NexusModule`] and add it here — the runtime picks it up
//! automatically (tick loops, command routing, presence).

// Executor modules run native local work (Python, /etc/hosts) that the iOS
// sandbox forbids — there the node is a container/presence-only node, so they're
// compiled out entirely.
#[cfg(not(target_os = "ios"))]
pub mod blocking;
#[cfg(not(target_os = "ios"))]
pub mod garmin;
// Foreground-app time tracking reads LaunchServices (`lsappinfo`) and the HID
// idle counter (`ioreg`), neither of which exists off macOS.
#[cfg(target_os = "macos")]
pub mod usage_tracker;

use crate::grid::NexusModule;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

/// Every module this node ships with.
///
/// `blocking_enabled` is passed as a **shared flag**, not a bool: the other end
/// is held by the `enforcement` Tauri commands, so toggling enforcement in the
/// UI is picked up by the already-running tick loop rather than needing a
/// restart. On iOS this is empty — the phone is a presence node that still
/// heartbeats (so the dashboard shows it online) but executes nothing.
pub fn registry(blocking_enabled: Arc<AtomicBool>) -> Vec<Arc<dyn NexusModule>> {
    #[cfg(target_os = "ios")]
    {
        let _ = blocking_enabled;
        Vec::new()
    }
    #[cfg(not(target_os = "ios"))]
    {
        #[allow(unused_mut)]
        let mut modules: Vec<Arc<dyn NexusModule>> = vec![
            Arc::new(garmin::GarminModule),
            Arc::new(blocking::BlockingModule::new(blocking_enabled)),
        ];
        // macOS-only, and pushed rather than listed inline so the two entries
        // above stay on their own lines for parallel work.
        #[cfg(target_os = "macos")]
        modules.push(Arc::new(usage_tracker::UsageTrackerModule::new()));
        modules
    }
}

// ── shims for the enforcement commands ──────────────────────────────────────
//
// `enforcement.rs` registers the same Tauri commands on every platform (the
// `generate_handler!` list in `lib.rs` is not cfg'd, and cfg-ing it is how you
// get a command that exists on one target and 404s on another). The `blocking`
// module only compiles off-iOS, so these two shims give it a definition
// everywhere and let the iOS build report "unsupported" instead of failing to
// link.

/// Domains in this machine's `/etc/hosts` marker block.
pub fn blocking_hosts_domains() -> Result<Vec<String>, String> {
    #[cfg(target_os = "ios")]
    {
        Err("hosts-file blocking is not available on iOS".to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        blocking::current_blocked()
    }
}

/// Fetch and apply the server's verdict right now.
pub async fn blocking_enforce_now(
    ctx: &crate::grid::ModuleContext,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "ios")]
    {
        let _ = ctx;
        Err("enforcement runs on the Mac node, not on iOS".to_string())
    }
    #[cfg(not(target_os = "ios"))]
    {
        blocking::enforce_now(ctx).await
    }
}
