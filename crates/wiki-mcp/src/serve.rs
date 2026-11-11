use std::path::PathBuf;

use std::sync::{Mutex, OnceLock};

use rmcp::{
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock as Content, Implementation, ServerCapabilities, ServerConfig},
    schemars, tool, tool_handler, tool_router, ErrorData as McpError, ServerHandler, ServiceExt,
};
use rag_core::{
    data_dir, embed::{load_embedder, load_installed_reranker, search_reranked}, file_changed, head_sha, index_path, indexed_repos, model_by_id,
    model_dir, read_config, repo_id, resolve_repo, wiki_root, FileSource, Store,
};
use wiki_core::{content_has_forbidden_term, read_private_terms};

const INSTRUCTIONS: &str = "Local search over this repository's code and its Codebase Wiki. Use `search_code` for *where/how* questions (where is X defined, how does Y work, what calls Z) before grepping. Use `search_wiki` or the wiki pages for status, decisions, risks and *why*; it also covers README and docs/. Results marked `stale: true` changed after indexing: re-read those lines from disk before relying on them. Outside a repository (e.g. a desktop chat), call `list_repos` and pass `repo` to the other tools.";

/// The repo the server was started in, if any. A server started outside a repo (Claude Desktop
/// chat, Cowork) has none and every tool takes `repo` instead.
static REPO: OnceLock<PathBuf> = OnceLock::new();
/// The embedder of the active model, loaded at the first search. Reloaded when the person picks
/// another model in the app while this server runs.
static EMBEDDER: Mutex<Option<(&'static str, rag_core::embed::Embedder)>> = Mutex::new(None);
/// The optional reranker, loaded at the first search after its model is installed.
static RERANKER: Mutex<Option<rag_core::embed::Reranker>> = Mutex::new(None);

#[derive(Clone)]
pub struct WikiMcp {
    tool_router: ToolRouter<Self>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct SearchParams {
    /// What to look for: a question or keywords, any language.
    query: String,
    /// Number of results (default 8, max 20).
    #[serde(default = "default_k_code")]
    k: usize,
    /// Optional fnmatch glob on the repo-relative path, e.g. `crates/*` or `*.tsx`.
    path_glob: Option<String>,
    /// Repository to search: its absolute path or its folder name from `list_repos`.
    /// Omit when the session is already inside a repository.
    repo: Option<String>,
}

fn default_k_code() -> usize {
    8
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct WikiSearchParams {
    /// What to look for in the wiki pages.
    query: String,
    /// Number of results (default 5, max 20).
    #[serde(default = "default_k_wiki")]
    k: usize,
    /// Repository to search: its absolute path or its folder name from `list_repos`.
    /// Omit when the session is already inside a repository.
    repo: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
struct RepoParams {
    /// Repository: its absolute path or its folder name from `list_repos`. Omit inside a repository.
    repo: Option<String>,
}

fn default_k_wiki() -> usize {
    5
}

fn active_spec() -> Result<&'static rag_core::ModelSpec, String> {
    let cfg = read_config().map_err(|e| e.to_string())?;
    let spec = model_by_id(&cfg.model).ok_or_else(|| format!("Modello sconosciuto: {}", cfg.model))?;
    if !rag_core::models::is_installed(spec) {
        return Err("Nessun modello installato: apri Codebase Wiki → Ricerca".into());
    }
    Ok(spec)
}

impl WikiMcp {
    pub fn new() -> Self {
        Self { tool_router: Self::tool_router() }
    }

    fn search_inner(&self, repo: Option<&str>, query: &str, k: usize, wiki: bool, path_glob: Option<&str>) -> Result<String, String> {
        let root = &pick_repo(repo)?;
        let spec = active_spec()?;
        let store = Store::open_reader(&index_path(&repo_id(root)), spec.dims, spec.id)?;
        // Privacy first: an unreadable terms file means no results at all (fail-closed).
        let terms = match wiki_root(root) {
            Some(w) => read_private_terms(&root.join(w))?,
            None => None,
        };
        let qv = {
            let mut guard = EMBEDDER.lock().map_err(|e| e.to_string())?;
            if guard.as_ref().map(|(id, _)| *id) != Some(spec.id) {
                *guard = Some((spec.id, load_embedder(spec, &model_dir(spec.id))?));
            }
            guard.as_mut().map(|(_, e)| e.embed_query(query)).ok_or("embedder")??
        };
        let source = if wiki { FileSource::Wiki } else { FileSource::Code };
        let hits = {
            let mut rr = RERANKER.lock().map_err(|e| e.to_string())?;
            if rr.is_none() {
                // A broken reranker must not break search: fall back to the RRF order.
                *rr = load_installed_reranker().unwrap_or_else(|e| {
                    eprintln!("reranker: {e}");
                    None
                });
            }
            search_reranked(&store, rr.as_mut(), &qv, query, source, k.clamp(1, 20), path_glob)?
        };
        let mut lines = vec![status_header(root, &store)?];
        for h in hits {
            if terms.as_deref().is_some_and(|tc| content_has_forbidden_term(tc, &h.text)) {
                continue;
            }
            let stale = match store.file_record(&h.path)? {
                Some((size, mtime, _)) => file_changed(root, &h.path, size, mtime),
                None => true,
            };
            let snippet = h.text.lines().take(40).collect::<Vec<_>>().join("\n");
            lines.push(
                serde_json::json!({
                    "path": h.path, "start_line": h.start_line, "end_line": h.end_line,
                    "source": h.source, "score": (h.score * 10000.0).round() / 10000.0,
                    "stale": stale, "snippet": snippet,
                })
                .to_string(),
            );
        }
        if lines.len() == 1 {
            lines.push("Nessun risultato.".into());
        }
        Ok(lines.join("\n"))
    }
}

fn repo_names() -> String {
    let repos = indexed_repos(&data_dir().join("indexes"));
    if repos.is_empty() {
        return "nessun progetto indicizzato: apri Codebase Wiki → Ricerca locale → Indicizza".into();
    }
    repos.iter().map(|r| r.name.as_str()).collect::<Vec<_>>().join(", ")
}

/// `repo` as an absolute path or an indexed folder name; otherwise the repo the server started in.
fn pick_repo(repo: Option<&str>) -> Result<PathBuf, String> {
    let wanted = repo.map(str::trim).filter(|r| !r.is_empty());
    let Some(wanted) = wanted else {
        return REPO
            .get()
            .cloned()
            .ok_or_else(|| format!("Nessun repo in questa sessione: passa `repo`. Progetti indicizzati: {}", repo_names()));
    };
    let path = std::path::Path::new(wanted);
    if path.is_absolute() {
        return resolve_repo(Some(path));
    }
    let matches: Vec<_> = indexed_repos(&data_dir().join("indexes"))
        .into_iter()
        .filter(|r| r.name.eq_ignore_ascii_case(wanted))
        .collect();
    match matches.as_slice() {
        [one] => Ok(one.root.clone()),
        [] => Err(format!("Nessun progetto indicizzato si chiama {wanted:?}. Progetti indicizzati: {}", repo_names())),
        many => Err(format!(
            "Più progetti si chiamano {wanted:?}: passa il percorso assoluto ({})",
            many.iter().map(|r| r.root.display().to_string()).collect::<Vec<_>>().join(", ")
        )),
    }
}

fn short_sha(s: &str) -> String {
    s.chars().take(7).collect()
}

fn status_header(root: &std::path::Path, store: &Store) -> Result<String, String> {
    let ih = store.meta_get("indexed_head")?.unwrap_or_default();
    let head = head_sha(root).unwrap_or_default();
    let changed = store.count_changed(root)?;
    Ok(format!(
        "index @{} · HEAD @{} · {changed} file cambiati dall'indice",
        short_sha(&ih),
        short_sha(&head)
    ))
}

fn tool_result(r: Result<String, String>) -> Result<CallToolResult, McpError> {
    Ok(match r {
        Ok(text) => CallToolResult::success(vec![Content::text(text)]),
        Err(e) => CallToolResult::error(vec![Content::text(e)]),
    })
}

#[tool_router]
impl WikiMcp {
    #[tool(description = "Search this repository's source code (hybrid keyword + semantic). Use it for where/how questions before grepping. Returns a header line, then one JSON object per hit: path, start_line, end_line, score, stale, snippet.")]
    fn search_code(&self, Parameters(p): Parameters<SearchParams>) -> Result<CallToolResult, McpError> {
        tool_result(self.search_inner(p.repo.as_deref(), &p.query, p.k, false, p.path_glob.as_deref()))
    }

    #[tool(description = "Search this repository's documentation: the Codebase Wiki pages (status, decisions, risks, why) and other Markdown docs (README, docs/). Same output shape as search_code.")]
    fn search_wiki(&self, Parameters(p): Parameters<WikiSearchParams>) -> Result<CallToolResult, McpError> {
        tool_result(self.search_inner(p.repo.as_deref(), &p.query, p.k, true, None))
    }

    #[tool(description = "State of the local index for this repository: model, indexed commit, HEAD, files, chunks, files changed since indexing.")]
    fn index_status(&self, Parameters(p): Parameters<RepoParams>) -> Result<CallToolResult, McpError> {
        tool_result(pick_repo(p.repo.as_deref()).map(|r| crate::run::status_json(&r).to_string()))
    }

    #[tool(description = "Repositories with a local Codebase Wiki index: one JSON object per line with name and path, plus which one this session is in. Use a name or path as `repo` in the other tools.")]
    fn list_repos(&self) -> Result<CallToolResult, McpError> {
        let current = REPO.get();
        let repos = indexed_repos(&data_dir().join("indexes"));
        if repos.is_empty() {
            return tool_result(Err(repo_names()));
        }
        let lines: Vec<String> = repos
            .iter()
            .map(|r| {
                serde_json::json!({
                    "name": r.name, "path": r.root.display().to_string(),
                    "current": current.is_some_and(|c| c.canonicalize().ok() == r.root.canonicalize().ok()),
                })
                .to_string()
            })
            .collect();
        tool_result(Ok(lines.join("\n")))
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

pub fn run(repo: Option<&std::path::Path>) -> Result<(), String> {
    // An explicit --repo must exist; otherwise starting outside a repo is fine (desktop chats).
    match resolve_repo(repo) {
        Ok(root) => REPO.set(root).map_err(|_| "repo già impostato")?,
        Err(e) if repo.is_some() => return Err(e),
        Err(_) => eprintln!("codebase-wiki: avviato fuori da un repo, i tool chiedono `repo` (vedi list_repos)"),
    }
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
