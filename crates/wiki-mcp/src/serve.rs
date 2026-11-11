use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{Implementation, ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router, ServerHandler, ServiceExt,
};
use rag_core::{
    embed::load_embedder, head_sha, index_path, model_by_id, read_config, model_dir, repo_id,
    resolve_repo, wiki_root, FileSource, Store,
};
use wiki_core::{content_has_forbidden_term, read_private_terms};

const INSTRUCTIONS: &str = "Local search over this repository's code and its Codebase Wiki. Use `search_code` for *where/how* questions (where is X defined, how does Y work, what calls Z) before grepping. Use the wiki pages for status, decisions, risks and *why*. Results marked `stale: true` changed after indexing: re-read those lines from disk before relying on them.";

static REPO: OnceLock<PathBuf> = OnceLock::new();
static EMBEDDER: OnceLock<Mutex<rag_core::embed::Embedder>> = OnceLock::new();

#[derive(Clone)]
pub struct WikiMcp {
    tool_router: ToolRouter<Self>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct SearchParams {
    query: String,
    #[serde(default = "default_k_code")]
    k: usize,
    path_glob: Option<String>,
}

fn default_k_code() -> usize {
    8
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct WikiSearchParams {
    query: String,
    #[serde(default = "default_k_wiki")]
    k: usize,
}

fn default_k_wiki() -> usize {
    5
}

impl WikiMcp {
    pub fn new() -> Self {
        Self {
            tool_router: Self::tool_router(),
        }
    }

    fn embedder() -> Result<&'static Mutex<rag_core::embed::Embedder>, String> {
        if let Some(e) = EMBEDDER.get() {
            return Ok(e);
        }
        let cfg = read_config().map_err(|e| e.to_string())?;
        let spec = model_by_id(&cfg.model).ok_or("modello sconosciuto")?;
        if !rag_core::models::is_installed(spec) {
            return Err(
                "Indice assente per questo repo: apri Codebase Wiki → Ricerca → Indicizza".into(),
            );
        }
        let emb = load_embedder(spec, &model_dir(spec.id)).map_err(|e| e.to_string())?;
        Ok(EMBEDDER.get_or_init(|| Mutex::new(emb)))
    }

    fn search_inner(
        &self,
        query: &str,
        k: usize,
        wiki: bool,
        path_glob: Option<&str>,
    ) -> String {
        let Ok(root) = REPO.get().ok_or("repo") else {
            return "repo non impostato".into();
        };
        let inner = (|| -> Result<String, String> {
            let cfg = read_config().map_err(|e| e.to_string())?;
            let spec = model_by_id(&cfg.model).ok_or("modello")?;
            let store = Store::open(&index_path(&repo_id(root)), spec.dims, spec.id)?;
            let mut emb = Self::embedder()?.lock().map_err(|e| e.to_string())?;
            let qv = emb.embed_query(query)?;
            let source = if wiki {
                FileSource::Wiki
            } else {
                FileSource::Code
            };
            let hits = store.search(&qv, query, source, k.min(20), path_glob)?;
            let terms = match wiki_root(root) {
                Some(w) => read_private_terms(&root.join(w))?,
                None => None,
            };
            let mut lines = vec![status_header(root, &store)?];
            for h in hits {
                if let Some(ref tc) = terms {
                    if content_has_forbidden_term(tc, &h.text) {
                        continue;
                    }
                }
                let stale = file_stale(root, &h.path, &store)?;
                let snippet = h.text.lines().take(40).collect::<Vec<_>>().join("\n");
                lines.push(format!(
                    "{{\"path\":\"{}\",\"start_line\":{},\"end_line\":{},\"source\":\"{:?}\",\"score\":{:.4},\"stale\":{},\"snippet\":{}}}",
                    h.path,
                    h.start_line,
                    h.end_line,
                    h.source,
                    h.score,
                    stale,
                    serde_json::to_string(&snippet).unwrap_or_default()
                ));
            }
            Ok(lines.join("\n"))
        })();
        inner.unwrap_or_else(|e| e)
    }
}

fn short_sha(s: &str) -> String {
    s.chars().take(7).collect()
}

fn status_header(root: &std::path::Path, store: &Store) -> Result<String, String> {
    let ih = store.meta_get("indexed_head")?.unwrap_or_default();
    let head = head_sha(root).unwrap_or_default();
    Ok(format!(
        "index @{} · HEAD @{} · 0 file cambiati dall'indice",
        short_sha(&ih),
        short_sha(&head)
    ))
}

fn file_stale(root: &std::path::Path, path: &str, store: &Store) -> Result<bool, String> {
    let full = root.join(path);
    let meta = std::fs::metadata(&full).map_err(|e| e.to_string())?;
    let rec = store.file_record(path)?;
    let Some((size, mtime, _)) = rec else {
        return Ok(true);
    };
    let m = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    Ok(meta.len() != size || m != mtime)
}

#[tool_router]
impl WikiMcp {
    #[tool(description = "Search code for where/how questions")]
    fn search_code(&self, Parameters(p): Parameters<SearchParams>) -> String {
        self.search_inner(&p.query, p.k, false, p.path_glob.as_deref())
    }

    #[tool(description = "Search wiki pages")]
    fn search_wiki(&self, Parameters(p): Parameters<WikiSearchParams>) -> String {
        self.search_inner(&p.query, p.k, true, None)
    }

    #[tool(description = "Index status for this repo")]
    fn index_status(&self) -> String {
        let Some(root) = REPO.get() else {
            return "repo non impostato".into();
        };
        let Ok(cfg) = read_config() else {
            return "config".into();
        };
        let id = repo_id(root);
        let mut out = serde_json::json!({
            "repo": root.display().to_string(),
            "repo_id": id,
            "model": cfg.model,
            "index_path": index_path(&id).display().to_string(),
        });
        if let Some(spec) = model_by_id(&cfg.model) {
            if let Ok(store) = Store::open(&index_path(&id), spec.dims, spec.id) {
                out["indexed_head"] = store.meta_get("indexed_head").ok().flatten().into();
                out["head"] = head_sha(root).into();
                if let Ok((f, c)) = store.counts() {
                    out["files"] = f.into();
                    out["chunks"] = c.into();
                }
            }
        }
        out.to_string()
    }
}

#[tool_handler]
impl ServerHandler for WikiMcp {
    fn get_info(&self) -> ServerConfig {
        let mut info = Implementation::from_build_env();
        info.name = "codebase-wiki".into();
        info.version = env!("CARGO_PKG_VERSION").into();
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions(INSTRUCTIONS)
            .with_server_info(info)
    }
}

pub fn run(args: Vec<String>) -> Result<(), String> {
    let repo = args
        .iter()
        .position(|a| a == "--repo")
        .and_then(|i| args.get(i + 1))
        .map(std::path::PathBuf::from);
    let root = resolve_repo(repo.as_deref())?;
    REPO.set(root).map_err(|_| "repo già impostato")?;
    let server = WikiMcp::new();
    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    rt.block_on(async {
        server
            .serve(rmcp::transport::stdio())
            .await
            .map_err(|e| e.to_string())?
            .waiting()
            .await
            .map_err(|e| e.to_string())
    })?;
    Ok(())
}
