//! Local code + wiki index (paths, store, search).

#[cfg(feature = "download")]
pub mod models;
#[cfg(feature = "embed")]
pub mod embed;
pub mod catalog;
pub mod chunk;
pub mod files;
pub mod paths;
pub mod repo;
pub mod store;
pub mod harness;

pub use catalog::{catalog, default_model_id, model_by_id, ModelSpec, Pooling};
pub use files::{excluded_globs_from_wiki, list_files, FileEntry, FileSource};
pub use paths::{
    bin_path, config_path, data_dir, ensure_data_dirs, index_path, model_dir, models_dir,
    read_config, write_config, RagConfig,
};
pub use repo::{head_sha, repo_id, resolve_repo, wiki_root};
pub use store::{delete_index, file_changed, Hit, Store, NO_INDEX_MSG};
#[cfg(feature = "download")]
pub use models::{installed_ids, pull, DownloadEvent, is_installed};
