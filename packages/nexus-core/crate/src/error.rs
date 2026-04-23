use thiserror::Error;

#[derive(Debug, Error)]
pub enum NexusError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("App not found: {0}")]
    AppNotFound(String),

    #[error("Launch failed for '{app}': {reason}")]
    LaunchFailed { app: String, reason: String },

    #[error("IPC error: {0}")]
    Ipc(String),

    #[error("{0}")]
    Custom(String),
}

pub type Result<T> = std::result::Result<T, NexusError>;
