//! Local code + wiki index (paths, store, search).

#[cfg(feature = "download")]
pub mod models;
#[cfg(feature = "embed")]
pub mod embed;
#[cfg(feature = "embed")]
pub use tokenizers;
pub mod activity;
pub mod catalog;
pub mod chunk;
pub mod files;
pub mod paths;
pub mod repo;
pub mod store;
pub mod harness;
pub mod plugin_install;

pub use catalog::{catalog, default_model_id, model_by_id, ModelSpec, Pooling};
pub use files::{list_files, FileEntry, FileSource};
pub use paths::{
    bin_path, config_path, data_dir, ensure_data_dirs, index_path, model_dir, models_dir,
    read_config, write_config, RagConfig,
};
pub use repo::{head_sha, repo_id, resolve_repo, wiki_root};
pub use store::{delete_index, file_changed, indexed_repos, Hit, IndexedRepo, Store, NO_INDEX_MSG};
#[cfg(feature = "download")]
pub use models::{installed_ids, pull, DownloadEvent, is_installed};
