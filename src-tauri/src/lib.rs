use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use nexus_core::{ConnectedApp, RegisterRequest, RegisterResponse, NEXUS_IPC_PORT};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use std::process::Command;
use tauri_plugin_sql::{Migration, MigrationKind};
use tokio::sync::Mutex;
use tower_http::cors::CorsLayer;

// In-memory registry of connected apps — cleared when Nexus restarts
type Registry = Arc<Mutex<HashMap<String, ConnectedApp>>>;

async fn health() -> &'static str {
    "ok"
}

async fn register_app(
    State(registry): State<Registry>,
    Json(req): Json<RegisterRequest>,
) -> Json<RegisterResponse> {
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();

    let app = ConnectedApp {
        id: id.clone(),
        name: req.name,
        version: req.version,
        registered_at: id.clone(),
    };

    registry.lock().await.insert(id.clone(), app);
    Json(RegisterResponse { id })
}

async fn unregister_app(
    State(registry): State<Registry>,
    Path(id): Path<String>,
) -> StatusCode {
    registry.lock().await.remove(&id);
    StatusCode::NO_CONTENT
}

async fn get_apps(State(registry): State<Registry>) -> Json<Vec<ConnectedApp>> {
    let apps: Vec<ConnectedApp> = registry.lock().await.values().cloned().collect();
    Json(apps)
}

async fn start_ipc_server(registry: Registry) {
    let app = Router::new()
        .route("/health", get(health))
        .route("/register", post(register_app))
        .route("/unregister/{id}", delete(unregister_app))
        .route("/apps", get(get_apps))
        .layer(CorsLayer::permissive())
        .with_state(registry);

    let addr = format!("127.0.0.1:{}", NEXUS_IPC_PORT);
    let listener = tokio::net::TcpListener::bind(&addr).await
        .expect("Failed to bind Nexus IPC server");
    axum::serve(listener, app).await
        .expect("Nexus IPC server crashed");
}

#[tauri::command]
fn launch_app(path: String) -> Result<(), String> {
    let result = if path.ends_with(".app") {
        Command::new("open").arg(&path).spawn()
    } else if path.ends_with(".sh") {
        Command::new("bash").arg(&path).spawn()
    } else {
        Command::new(&path).spawn()
    };

    result
        .map(|_| ())
        .map_err(|e| format!("Failed to launch {}: {}", path, e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create apps table",
            sql: "
                CREATE TABLE IF NOT EXISTS apps (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    name          TEXT NOT NULL,
                    path          TEXT NOT NULL,
                    icon          TEXT,
                    last_launched TEXT
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "seed apps",
            sql: "
                INSERT OR IGNORE INTO apps (id, name, path) VALUES
                    (1, 'Vault', '/Users/bastianthomsen/Repositories/Vault/Vault/src-tauri/target/release/vault');
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add pathfinder app",
            sql: "
                INSERT OR IGNORE INTO apps (id, name, path) VALUES
                    (2, 'PathFinder', '/Users/bastianthomsen/Repositories/PathFinder/launch-dev.sh');
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "switch to dev launchers",
            sql: "
                UPDATE apps SET path = '/Users/bastianthomsen/Repositories/Vault/Vault/launch-dev.sh' WHERE id = 1;
            ",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .setup(|_app| {
            let registry: Registry = Arc::new(Mutex::new(HashMap::new()));
            tauri::async_runtime::spawn(start_ipc_server(registry));
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:nexus.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![launch_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
