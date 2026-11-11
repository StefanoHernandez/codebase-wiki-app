// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use std::sync::Mutex;

use wiki_core::WatchHandle;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Mutex::new(None::<WatchHandle>))
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::list_recent,
            commands::remove_recent,
            commands::load_snapshot,
            commands::write_wiki_file,
            commands::read_wiki_file,
            commands::read_source_file,
            commands::source_diff,
            commands::run_lint,
            commands::git_user_name,
            commands::workflow_prompt,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codebase Wiki");
}
