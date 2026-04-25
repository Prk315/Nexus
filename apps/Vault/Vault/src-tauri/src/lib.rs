use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;
#[cfg(not(target_os = "ios"))]
use std::io::{BufRead, BufReader, Write};
#[cfg(not(target_os = "ios"))]
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

fn vault_dir() -> PathBuf {
    let home = dirs::home_dir().expect("Could not find home directory");
    let dir = home.join("Documents").join("Vault");
    fs::create_dir_all(&dir).expect("Could not create Vault directory");
    dir
}

fn content_dir() -> PathBuf {
    let dir = vault_dir().join("content");
    fs::create_dir_all(&dir).expect("Could not create content directory");
    dir
}

fn assets_dir() -> PathBuf {
    let dir = vault_dir().join("assets");
    fs::create_dir_all(&dir).expect("Could not create assets directory");
    dir
}

fn journals_dir() -> PathBuf {
    let dir = vault_dir().join("journals");
    fs::create_dir_all(&dir).expect("Could not create journals directory");
    dir
}

fn graph_path() -> PathBuf {
    vault_dir().join("vault.json")
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type")]
pub enum NodeKind {
    Folder,
    Note,
    Canvas,
    Pdf,
    Video,
    CodeFile { language: String },
    Table,
    Database,
    Workbook,
    Journal,
    Books,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct VaultNode {
    pub id: String,
    pub name: String,
    pub kind: NodeKind,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Serialize, Deserialize, Default, Clone)]
pub struct VaultGraph {
    pub nodes: HashMap<String, VaultNode>,
    pub edges: HashMap<String, Vec<String>>,
    pub back_edges: HashMap<String, Vec<String>>,
    #[serde(default)]
    pub tag_colors: HashMap<String, String>, // tag -> hex color e.g. "#f0c060"
}

fn load_graph() -> VaultGraph {
    let path = graph_path();
    if path.exists() {
        let data = fs::read_to_string(&path).unwrap_or_default();
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        VaultGraph::default()
    }
}

fn save_graph(graph: &VaultGraph) -> Result<(), String> {
    let data = serde_json::to_string_pretty(graph).map_err(|e| e.to_string())?;
    fs::write(graph_path(), data).map_err(|e| e.to_string())
}


#[tauri::command]
fn get_graph() -> VaultGraph {
    load_graph()
}

#[tauri::command]
fn create_node(name: String, kind: NodeKind) -> Result<VaultGraph, String> {
    let mut graph = load_graph();
    let id = Uuid::new_v4().to_string();
    let node = VaultNode { id: id.clone(), name, kind, tags: vec![] };
    graph.nodes.insert(id.clone(), node);
    graph.edges.insert(id.clone(), vec![]);
    graph.back_edges.insert(id.clone(), vec![]);
    save_graph(&graph)?;
    Ok(graph)
}

#[tauri::command]
fn delete_node(id: String) -> Result<VaultGraph, String> {
    let mut graph = load_graph();
    graph.nodes.remove(&id);
    if let Some(children) = graph.edges.remove(&id) {
        for child in &children {
            if let Some(parents) = graph.back_edges.get_mut(child) {
                parents.retain(|p| p != &id);
            }
        }
    }
    if let Some(parents) = graph.back_edges.remove(&id) {
        for parent in &parents {
            if let Some(children) = graph.edges.get_mut(parent) {
                children.retain(|c| c != &id);
            }
        }
    }
    let _ = fs::remove_file(content_dir().join(&id));
    save_graph(&graph)?;
    Ok(graph)
}

#[tauri::command]
fn add_edge(from_id: String, to_id: String) -> Result<VaultGraph, String> {
    let mut graph = load_graph();
    if !graph.nodes.contains_key(&from_id) || !graph.nodes.contains_key(&to_id) {
        return Err("Node not found".to_string());
    }
    if from_id == to_id {
        return Err("Cannot link a node to itself".to_string());
    }
    let children = graph.edges.entry(from_id.clone()).or_default();
    if !children.contains(&to_id) { children.push(to_id.clone()); }
    let parents = graph.back_edges.entry(to_id.clone()).or_default();
    if !parents.contains(&from_id) { parents.push(from_id.clone()); }
    save_graph(&graph)?;
    Ok(graph)
}

#[tauri::command]
fn remove_edge(from_id: String, to_id: String) -> Result<VaultGraph, String> {
    let mut graph = load_graph();
    if let Some(children) = graph.edges.get_mut(&from_id) {
        children.retain(|c| c != &to_id);
    }
    if let Some(parents) = graph.back_edges.get_mut(&to_id) {
        parents.retain(|p| p != &from_id);
    }
    save_graph(&graph)?;
    Ok(graph)
}

#[tauri::command]
fn read_content(id: String) -> Result<String, String> {
    let path = content_dir().join(&id);
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

#[tauri::command]
fn save_content(id: String, content: String) -> Result<(), String> {
    fs::write(content_dir().join(&id), content).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_tag(id: String, tag: String) -> Result<VaultGraph, String> {
    let mut graph = load_graph();
    let node = graph.nodes.get_mut(&id).ok_or("Node not found")?;
    if !node.tags.contains(&tag) {
        node.tags.push(tag);
    }
    save_graph(&graph)?;
    Ok(graph)
}

#[tauri::command]
fn remove_tag(id: String, tag: String) -> Result<VaultGraph, String> {
    let mut graph = load_graph();
    let node = graph.nodes.get_mut(&id).ok_or("Node not found")?;
    node.tags.retain(|t| t != &tag);
    save_graph(&graph)?;
    Ok(graph)
}

#[tauri::command]
fn set_tag_color(tag: String, color: String) -> Result<VaultGraph, String> {
    let mut graph = load_graph();
    graph.tag_colors.insert(tag, color);
    save_graph(&graph)?;
    Ok(graph)
}

// Returns the absolute filesystem path to a binary asset (PDF/video).
// On first call for a legacy node (content stored as a base64 data URL),
// decodes the bytes, writes the binary file, and removes the old content file.
fn get_binary_path(id: &str, ext: &str, data_url_prefix: &str) -> Result<String, String> {
    let asset_path = assets_dir().join(format!("{}.{}", id, ext));
    if asset_path.exists() {
        return Ok(asset_path.to_string_lossy().to_string());
    }
    // Lazy migration from legacy data-URL storage
    let content_file = content_dir().join(id);
    if !content_file.exists() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&content_file).map_err(|e| e.to_string())?;
    if let Some(b64) = content.strip_prefix(data_url_prefix) {
        let bytes = STANDARD.decode(b64.trim()).map_err(|e| e.to_string())?;
        fs::write(&asset_path, bytes).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&content_file);
        return Ok(asset_path.to_string_lossy().to_string());
    }
    Ok(String::new())
}

#[tauri::command]
fn get_pdf_path(id: String) -> Result<String, String> {
    get_binary_path(&id, "pdf", "data:application/pdf;base64,")
}

// data_b64: raw base64 without the data URL prefix
#[tauri::command]
fn save_pdf_file(id: String, data_b64: String) -> Result<String, String> {
    let bytes = STANDARD.decode(data_b64.trim()).map_err(|e| e.to_string())?;
    let path = assets_dir().join(format!("{}.pdf", id));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn get_video_path(id: String, ext: String) -> Result<String, String> {
    // ext is passed so we know the correct extension (mp4, mkv, etc.)
    // For legacy nodes the ext stored in the data URL mime type is used as fallback.
    let asset_path = assets_dir().join(format!("{}.{}", id, ext));
    if asset_path.exists() {
        return Ok(asset_path.to_string_lossy().to_string());
    }
    // Try legacy migration — scan for any existing asset file for this id
    let assets = assets_dir();
    if let Ok(entries) = fs::read_dir(&assets) {
        for entry in entries.flatten() {
            let fname = entry.file_name().to_string_lossy().to_string();
            if fname.starts_with(&format!("{}.", id)) {
                return Ok(entry.path().to_string_lossy().to_string());
            }
        }
    }
    // Decode from legacy data URL
    let content_file = content_dir().join(&id);
    if !content_file.exists() {
        return Ok(String::new());
    }
    let content = fs::read_to_string(&content_file).map_err(|e| e.to_string())?;
    if let Some(rest) = content.strip_prefix("data:video/") {
        if let Some(semi) = rest.find(';') {
            let detected_ext = &rest[..semi];
            let b64_prefix = format!("data:video/{};base64,", detected_ext);
            if let Some(b64) = content.strip_prefix(&b64_prefix) {
                let out_ext = if detected_ext == "x-matroska" { "mkv" } else { detected_ext };
                let out_path = assets_dir().join(format!("{}.{}", id, out_ext));
                let bytes = STANDARD.decode(b64.trim()).map_err(|e| e.to_string())?;
                fs::write(&out_path, bytes).map_err(|e| e.to_string())?;
                let _ = fs::remove_file(&content_file);
                return Ok(out_path.to_string_lossy().to_string());
            }
        }
    }
    Ok(String::new())
}

#[tauri::command]
fn save_video_file(id: String, ext: String, data_b64: String) -> Result<String, String> {
    let bytes = STANDARD.decode(data_b64.trim()).map_err(|e| e.to_string())?;
    let path = assets_dir().join(format!("{}.{}", id, ext));
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn create_tag(tag: String, color: String) -> Result<VaultGraph, String> {
    let mut graph = load_graph();
    graph.tag_colors.entry(tag).or_insert(color);
    save_graph(&graph)?;
    Ok(graph)
}

#[tauri::command]
fn rename_tag(old_name: String, new_name: String) -> Result<VaultGraph, String> {
    if old_name == new_name { return Ok(load_graph()); }
    let mut graph = load_graph();
    // Update tag_colors
    let color = graph.tag_colors.remove(&old_name);
    if let Some(c) = color {
        graph.tag_colors.insert(new_name.clone(), c);
    }
    // Update every node that carries the old tag
    for node in graph.nodes.values_mut() {
        for t in node.tags.iter_mut() {
            if *t == old_name { *t = new_name.clone(); }
        }
    }
    save_graph(&graph)?;
    Ok(graph)
}

#[tauri::command]
fn delete_tag_global(tag: String) -> Result<VaultGraph, String> {
    let mut graph = load_graph();
    graph.tag_colors.remove(&tag);
    for node in graph.nodes.values_mut() {
        node.tags.retain(|t| t != &tag);
    }
    save_graph(&graph)?;
    Ok(graph)
}

#[tauri::command]
fn get_blanket(id: String) -> Result<Vec<String>, String> {
    let graph = load_graph();
    if !graph.nodes.contains_key(&id) {
        return Err("Node not found".to_string());
    }
    let empty = vec![];
    let children = graph.edges.get(&id).unwrap_or(&empty);
    let parents = graph.back_edges.get(&id).unwrap_or(&empty);
    let mut blanket: HashSet<String> = HashSet::new();
    for c in children {
        blanket.insert(c.clone());
        if let Some(co_parents) = graph.back_edges.get(c) {
            for cp in co_parents {
                if cp != &id { blanket.insert(cp.clone()); }
            }
        }
    }
    for p in parents { blanket.insert(p.clone()); }
    Ok(blanket.into_iter().collect())
}

// ── Python kernel session management ───────────────────────────────────────────

#[cfg(not(target_os = "ios"))]
const KERNEL_PY: &str = include_str!("vault_kernel.py");

#[cfg(not(target_os = "ios"))]
struct PythonSession {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

#[cfg(not(target_os = "ios"))]
struct PythonSessions(Mutex<HashMap<String, PythonSession>>);

#[cfg(not(target_os = "ios"))]
#[derive(Serialize)]
struct OutputChunk {
    #[serde(rename = "type")]
    kind: String,
    content: String,
}

#[cfg(not(target_os = "ios"))]
#[derive(Serialize)]
struct RunOutput {
    chunks: Vec<OutputChunk>,
}

#[cfg(not(target_os = "ios"))]
#[tauri::command]
fn run_python(
    session_id: String,
    code: String,
    sessions: tauri::State<PythonSessions>,
) -> Result<RunOutput, String> {
    let mut map = sessions.0.lock().map_err(|e| e.to_string())?;

    if !map.contains_key(&session_id) {
        let short = if session_id.len() >= 8 { &session_id[..8] } else { &session_id };
        let kernel_path = std::env::temp_dir().join(format!("vault_kernel_{}.py", short));
        fs::write(&kernel_path, KERNEL_PY).map_err(|e| e.to_string())?;

        let mut child = Command::new("python3")
            .arg(&kernel_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start Python: {}. Is python3 installed?", e))?;

        let stdin  = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        map.insert(session_id.clone(), PythonSession { child, stdin, stdout });
    }

    let session = map.get_mut(&session_id).unwrap();
    let msg = serde_json::json!({ "code": code });
    writeln!(session.stdin, "{}", msg).map_err(|e| e.to_string())?;

    let mut line = String::new();
    session.stdout.read_line(&mut line).map_err(|e| e.to_string())?;

    let result: serde_json::Value = serde_json::from_str(line.trim()).map_err(|e| e.to_string())?;
    let chunks = result["chunks"].as_array()
        .map(|arr| arr.iter().map(|c| OutputChunk {
            kind:    c["type"].as_str().unwrap_or("text").to_string(),
            content: c["content"].as_str().unwrap_or("").to_string(),
        }).collect())
        .unwrap_or_default();
    Ok(RunOutput { chunks })
}

#[cfg(not(target_os = "ios"))]
#[tauri::command]
fn reset_python_session(
    session_id: String,
    sessions: tauri::State<PythonSessions>,
) -> Result<(), String> {
    let mut map = sessions.0.lock().map_err(|e| e.to_string())?;
    if let Some(mut s) = map.remove(&session_id) {
        let _ = s.child.kill();
    }
    Ok(())
}

#[tauri::command]
fn read_journal(id: String) -> Result<String, String> {
    let path = journals_dir().join(format!("{}.json", id));
    if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())
    } else {
        Ok(r#"{"version":1,"strokes":[],"background":"lined"}"#.to_string())
    }
}

#[tauri::command]
fn save_journal(id: String, data: String) -> Result<(), String> {
    let path = journals_dir().join(format!("{}.json", id));
    fs::write(path, data).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init());

    #[cfg(not(target_os = "ios"))]
    let builder = builder.manage(PythonSessions(Mutex::new(HashMap::new())));

    builder
        .invoke_handler(tauri::generate_handler![
            get_graph,
            create_node,
            delete_node,
            add_edge,
            remove_edge,
            read_content,
            save_content,
            get_pdf_path,
            save_pdf_file,
            get_video_path,
            save_video_file,
            add_tag,
            remove_tag,
            set_tag_color,
            create_tag,
            rename_tag,
            delete_tag_global,
            get_blanket,
            #[cfg(not(target_os = "ios"))]
            run_python,
            #[cfg(not(target_os = "ios"))]
            reset_python_session,
            read_journal,
            save_journal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
