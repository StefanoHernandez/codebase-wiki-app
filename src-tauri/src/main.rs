// Prevents an extra console window on Windows in release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod rag_jobs;
mod rag_sidecar;

use std::sync::{Arc, Mutex};

use wiki_core::WatchHandle;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(Mutex::new(None::<WatchHandle>))
        .manage(Arc::new(rag_jobs::RagJobs::new()))
        .setup(|_app| {
            if let Err(e) = rag_sidecar::install_mcp_binary() {
                eprintln!("MCP binary: {e}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_project,
            commands::list_recent,
            commands::remove_recent,
            commands::load_snapshot,
            commands::write_wiki_file,
            commands::write_wiki_files,
            commands::read_wiki_file,
            commands::read_source_file,
            commands::source_diff,
            commands::run_lint,
            commands::git_user_name,
            commands::workflow_prompt,
            commands::rag_status,
            commands::rag_index_start,
            commands::rag_index_cancel,
            commands::rag_models,
            commands::rag_set_model,
            commands::rag_model_pull,
            commands::rag_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Codebase Wiki");
}
