mod anki;
mod apkg;

use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::Value;

// Commands return Result<_, String> so errors surface as rejected promises in JS.

#[tauri::command]
async fn parse_apkg(path: PathBuf) -> Result<apkg::Package, String> {
    tauri::async_runtime::spawn_blocking(move || apkg::parse(&path))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn read_media(path: PathBuf, names: Vec<String>) -> Result<HashMap<String, String>, String> {
    tauri::async_runtime::spawn_blocking(move || apkg::read_media(&path, &names))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn anki_connect(url: String, action: String, params: Value, timeout_secs: Option<u64>) -> Result<Value, String> {
    anki::anki_connect(&url, &action, params, timeout_secs.unwrap_or(60)).await
}

#[tauri::command]
async fn bridge(
    url: String,
    method: String,
    path: String,
    body: Option<Value>,
    timeout_secs: Option<u64>,
) -> Result<Value, String> {
    anki::bridge(&url, &method, &path, body, timeout_secs.unwrap_or(30)).await
}

/// Writes a text file the user chose in a save dialog (the dry-run report).
#[tauri::command]
async fn write_text_file(path: PathBuf, contents: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        std::fs::write(&path, contents).map_err(|e| format!("Could not write {}: {e}", path.display()))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![parse_apkg, read_media, anki_connect, bridge, write_text_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
