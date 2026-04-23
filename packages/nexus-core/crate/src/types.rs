use serde::{Deserialize, Serialize};

/// An app currently connected to the Nexus IPC server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectedApp {
    pub id: String,
    pub name: String,
    pub version: String,
    pub registered_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterRequest {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RegisterResponse {
    pub id: String,
}

/// Represents a registered application in the Nexus launcher database
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppInfo {
    pub id: i64,
    pub name: String,
    pub path: String,
    pub icon: Option<String>,
    pub last_launched: Option<String>,
}

/// Payload sent when requesting an app launch via Tauri command
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchRequest {
    pub app_id: i64,
    #[serde(default)]
    pub args: Vec<String>,
}

/// Result returned after a launch attempt
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaunchResult {
    pub success: bool,
    pub message: Option<String>,
}

/// Generic IPC message envelope for cross-app communication
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcMessage<T> {
    pub r#type: String,
    pub payload: T,
    pub timestamp: String,
}

impl<T> IpcMessage<T> {
    pub fn new(msg_type: impl Into<String>, payload: T) -> Self {
        Self {
            r#type: msg_type.into(),
            payload,
            timestamp: chrono_now(),
        }
    }
}

/// Returns the current UTC time as an ISO 8601 string without pulling in chrono.
/// Uses std::time to keep the dependency footprint minimal.
fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    // Produce a simple Unix-epoch seconds string; consuming apps can parse as needed
    format!("{secs}")
}
