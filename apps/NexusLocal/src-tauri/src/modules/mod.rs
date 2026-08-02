//! Module registry. To install a new local capability, implement
//! [`crate::grid::NexusModule`] and add it here — the runtime picks it up
//! automatically (tick loops, command routing, presence).

pub mod blocking;
pub mod garmin;

use crate::config::AppConfig;
use crate::grid::NexusModule;
use std::sync::Arc;

/// Every module this node ships with. Modules receive the node config at
/// registration so they can pick up their own settings (e.g. blocking's
/// enforcement switch).
pub fn registry(config: &AppConfig) -> Vec<Arc<dyn NexusModule>> {
    vec![
        Arc::new(garmin::GarminModule),
        Arc::new(blocking::BlockingModule::new(config.blocking_enabled)),
    ]
}
