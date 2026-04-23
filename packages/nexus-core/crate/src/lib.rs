pub mod error;
pub mod types;

/// The port Nexus runs its IPC server on — shared constant across all apps
pub const NEXUS_IPC_PORT: u16 = 1430;

pub use error::{NexusError, Result};
pub use types::{AppInfo, ConnectedApp, IpcMessage, LaunchRequest, LaunchResult, RegisterRequest, RegisterResponse};
