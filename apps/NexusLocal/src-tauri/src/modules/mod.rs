//! Module registry. To install a new local capability, implement
//! [`crate::grid::NexusModule`] and add it here — the runtime picks it up
//! automatically (tick loops, command routing, presence).

pub mod garmin;

use crate::grid::NexusModule;
use std::sync::Arc;

/// Every module this node ships with.
pub fn registry() -> Vec<Arc<dyn NexusModule>> {
    vec![Arc::new(garmin::GarminModule)]
}
