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

use crate::config::AppConfig;
use crate::grid::NexusModule;
use std::sync::Arc;

/// Every module this node ships with. Modules receive the node config at
/// registration so they can pick up their own settings (e.g. blocking's
/// enforcement switch). On iOS this is empty: the phone is a presence node that
/// still heartbeats (so the dashboard shows it online) but executes nothing.
pub fn registry(config: &AppConfig) -> Vec<Arc<dyn NexusModule>> {
    #[cfg(target_os = "ios")]
    {
        let _ = config;
        Vec::new()
    }
    #[cfg(not(target_os = "ios"))]
    {
        vec![
            Arc::new(garmin::GarminModule),
            Arc::new(blocking::BlockingModule::new(config.blocking_enabled)),
        ]
    }
}
