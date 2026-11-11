#[cfg(all(feature = "embed", feature = "download"))]
use std::fs;
#[cfg(all(feature = "embed", feature = "download"))]
use std::path::Path;
#[cfg(all(feature = "embed", feature = "download"))]
use std::time::Instant;

#[cfg(all(feature = "embed", feature = "download"))]
use rag_core::{
    chunk::{chunk_file_tokens, filter_private_chunks, terms_hash},
    embed::load_embedder,
    excluded_globs_from_wiki, list_files, model_by_id, read_config, FileSource,
    head_sha, index_path, model_dir, repo_id, resolve_repo, wiki_root, Store,
};
#[cfg(all(feature = "embed", feature = "download"))]
use sha2::{Digest, Sha256};

#[cfg(all(feature = "embed", feature = "download"))]
fn sha_bytes(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

#[cfg(all(feature = "embed", feature = "download"))]
pub fn run_index(repo: Option<&Path>, json: bool) -> i32 {
    let err = |msg: &str| -> i32 {
        if json {
            println!("{}", serde_json::json!({"event":"error","message":msg}));
        } else {
            eprintln!("{msg}");
        }
        1
    };
    let root = match resolve_repo(repo) {
        Ok(r) => r,
        Err(e) => return err(&e),
    };
    let cfg = match read_config() {
        Ok(c) => c,
        Err(e) => return err(&e),
    };
    let spec = match model_by_id(&cfg.model) {
        Some(s) => s,
        None => return err("Modello sconosciuto"),
    };
    if !rag_core::models::is_installed(spec) {
        return err("Nessun modello installato: apri Codebase Wiki → Ricerca");
    }
    let wiki = wiki_root(&root);
    let wiki_dir = wiki.as_ref().map(|w| root.join(w));
    let terms = if let Some(ref wd) = wiki_dir {
        match wiki_core::read_private_terms(wd) {
            Ok(t) => t,
            Err(e) => return err(&e),
        }
    } else {
        None
    };
    let th = terms_hash(terms.as_deref());
    let id = repo_id(&root);
    let db_path = index_path(&id);
    let mut store = match Store::open_writer(&db_path, spec.dims, spec.id) {
        Ok(s) => s,
        Err(e) => return err(&e),
    };
    // New private terms: chunks indexed before may hold a term that is now forbidden. Start over.
    let stored = store.meta_get("terms_hash").ok().flatten();
    if stored.is_some_and(|h| h != th) {
        drop(store);
        if let Err(e) = rag_core::delete_index(&db_path) {
            return err(&e);
        }
        store = match Store::open_writer(&db_path, spec.dims, spec.id) {
            Ok(s) => s,
            Err(e) => return err(&e),
        };
    }
    if let Err(e) = store.meta_set("terms_hash", &th) {
        return err(&e);
    }
    run_index_with_store(store, root, wiki, terms, spec, json)
}

#[cfg(all(feature = "embed", feature = "download"))]
#[allow(clippy::too_many_arguments)]
fn run_index_with_store(
    store: Store,
    root: std::path::PathBuf,
    wiki: Option<String>,
    terms: Option<String>,
    spec: &'static rag_core::ModelSpec,
    json: bool,
) -> i32 {
    let emit = |v: serde_json::Value| {
        if json {
            println!("{}", v);
        }
    };
    let err = |msg: &str| -> i32 {
        if json {
            println!("{}", serde_json::json!({"event":"error","message":msg}));
        } else {
            eprintln!("{msg}");
        }
        1
    };
    let start = Instant::now();
    let globs = wiki
        .as_ref()
        .map(|w| excluded_globs_from_wiki(&root, w))
        .unwrap_or_default();
    let all = match list_files(&root, wiki.as_deref(), &globs) {
        Ok(f) => f,
        Err(e) => return err(&e),
    };
    let wiki_files: Vec<_> = all.iter().filter(|f| f.source == FileSource::Wiki).cloned().collect();
    let code_files: Vec<_> = all.iter().filter(|f| f.source == FileSource::Code).cloned().collect();
    emit(serde_json::json!({"event":"phase","phase":"wiki","total":wiki_files.len()}));
    let mut embedder = match load_embedder(spec, &model_dir(spec.id)) {
        Ok(e) => e,
        Err(e) => return err(&e),
    };
    let tok = match embedder.chunk_tokenizer() {
        Ok(t) => t,
        Err(e) => return err(&e),
    };
    let mut skipped_private = 0u32;
    let mut done_wiki = 0usize;
    for entry in &wiki_files {
        if index_one(&store, &root, entry, &mut embedder, &tok, terms.as_deref(), &mut skipped_private).is_err() {
            return err("Indicizzazione file wiki fallita");
        }
        done_wiki += 1;
        emit(serde_json::json!({"event":"progress","phase":"wiki","done":done_wiki,"total":wiki_files.len()}));
    }
    emit(serde_json::json!({"event":"phase","phase":"code","total":code_files.len()}));
    let mut done_code = 0usize;
    for entry in &code_files {
        if index_one(&store, &root, entry, &mut embedder, &tok, terms.as_deref(), &mut skipped_private).is_err() {
            return err("Indicizzazione file codice fallita");
        }
        done_code += 1;
        emit(serde_json::json!({"event":"progress","phase":"code","done":done_code,"total":code_files.len()}));
    }
    let paths: Vec<String> = all.iter().map(|e| e.rel_path.clone()).collect();
    if store.remove_missing(&paths).is_err() {
        return err("remove_missing fallito");
    }
    if let Some(h) = head_sha(&root) {
        let _ = store.meta_set("indexed_head", &h);
    }
    let (files, chunks) = store.counts().unwrap_or((0, 0));
    let ms = start.elapsed().as_millis();
    emit(serde_json::json!({"event":"done","files":files,"chunks":chunks,"skipped_private":skipped_private,"ms":ms}));
    0
}

#[cfg(all(feature = "embed", feature = "download"))]
fn index_one(
    store: &Store,
    root: &Path,
    entry: &rag_core::FileEntry,
    embedder: &mut rag_core::embed::Embedder,
    tok: &rag_core::tokenizers::Tokenizer,
    terms: Option<&str>,
    skipped_private: &mut u32,
) -> Result<(), String> {
    let path = root.join(&entry.rel_path);
    // Read once: the hash and the chunks come from the same bytes. A file that vanished since
    // `git ls-files` is skipped; remove_missing drops it on the next run.
    let Ok(bytes) = fs::read(&path) else { return Ok(()) };
    let sha = sha_bytes(&bytes);
    let same_source = store.file_source(&entry.rel_path)? == Some(entry.source);
    if let Some((size, mtime, old_sha)) = store.file_record(&entry.rel_path)?.filter(|_| same_source) {
        if size == entry.size && mtime == entry.mtime {
            return Ok(());
        }
        if old_sha == sha {
            return store.touch_file(&entry.rel_path, entry.size, entry.mtime);
        }
    }
    let Ok(text) = String::from_utf8(bytes) else { return Ok(()) };
    let chunks = chunk_file_tokens(&entry.rel_path, &text, entry.source, tok);
    let (chunks, sk) = filter_private_chunks(chunks, terms);
    *skipped_private += sk;
    let embed_texts: Vec<String> = chunks.iter().map(|c| c.embed_text.clone()).collect();
    let vectors = embedder.embed_passages(&embed_texts)?;
    store.replace_file(entry, &sha, &chunks, &vectors)
}

#[cfg(all(feature = "embed", feature = "download"))]
pub fn run_search(repo: Option<&Path>, wiki: bool, k: usize, glob: Option<&str>, query: &str, json: bool) -> i32 {
    match search_hits(repo, wiki, k, glob, query) {
        Ok((hits, reranked)) => {
            for (h, stale) in hits {
                if json {
                    println!(
                        "{}",
                        serde_json::json!({"path": h.path, "start_line": h.start_line, "end_line": h.end_line,
                            "source": h.source, "score": h.score, "snippet": h.text,
                            "bm25_rank": h.bm25_rank, "vec_rank": h.vec_rank, "fused_rank": h.fused_rank,
                            "reranked": reranked, "stale": stale})
                    );
                } else {
                    println!("{}:{}-{} score={:.4}", h.path, h.start_line, h.end_line, h.score);
                    println!("{}", h.text.lines().take(5).collect::<Vec<_>>().join("\n"));
                    println!("---");
                }
            }
            0
        }
        Err(e) => {
            if json {
                println!("{}", serde_json::json!({"event":"error","message":e}));
            } else {
                eprintln!("{e}");
            }
            1
        }
    }
}

/// Hits with their `stale` flag (file changed since indexing), and whether the reranker ran.
#[cfg(all(feature = "embed", feature = "download"))]
fn search_hits(
    repo: Option<&Path>,
    wiki: bool,
    k: usize,
    glob: Option<&str>,
    query: &str,
) -> Result<(Vec<(rag_core::Hit, bool)>, bool), String> {
    let root = resolve_repo(repo)?;
    let spec = active_spec()?;
    let store = Store::open_reader(&index_path(&repo_id(&root)), spec.dims, spec.id)?;
    let mut embedder = load_embedder(spec, &model_dir(spec.id))?;
    let qv = embedder.embed_query(query)?;
    let source = if wiki { FileSource::Wiki } else { FileSource::Code };
    let mut reranker = rag_core::embed::load_installed_reranker().unwrap_or_else(|e| {
        eprintln!("reranker: {e}");
        None
    });
    let reranked = reranker.is_some();
    let hits = rag_core::embed::search_reranked(&store, reranker.as_mut(), &qv, query, source, k.clamp(1, 20), glob)?;
    // Same rule as `serve`: re-check the current private terms; unreadable terms → no results.
    let terms = match wiki_root(&root) {
        Some(w) => wiki_core::read_private_terms(&root.join(w))?,
        None => None,
    };
    let mut out = Vec::new();
    for h in hits {
        if terms.as_deref().is_some_and(|t| wiki_core::content_has_forbidden_term(t, &h.text)) {
            continue;
        }
        let stale = match store.file_record(&h.path)? {
            Some((size, mtime, _)) => rag_core::file_changed(&root, &h.path, size, mtime),
            None => true,
        };
        out.push((h, stale));
    }
    Ok((out, reranked))
}

#[cfg(all(feature = "embed", feature = "download"))]
fn active_spec() -> Result<&'static rag_core::ModelSpec, String> {
    let cfg = read_config().unwrap_or(rag_core::RagConfig { model: rag_core::default_model_id().to_string() });
    let spec = model_by_id(&cfg.model).ok_or_else(|| format!("Modello sconosciuto: {}", cfg.model))?;
    if !rag_core::models::is_installed(spec) {
        return Err("Nessun modello installato: apri Codebase Wiki → Ricerca".into());
    }
    Ok(spec)
}

/// `status --json`: never creates or rebuilds the index (reader only).
#[cfg(all(feature = "embed", feature = "download"))]
pub fn status_json(root: &Path) -> serde_json::Value {
    let id = repo_id(root);
    let cfg = read_config().unwrap_or(rag_core::RagConfig { model: rag_core::default_model_id().to_string() });
    let mut out = serde_json::json!({
        "repo": root.display().to_string(),
        "repo_id": id,
        "model": cfg.model,
        "index_path": index_path(&id).display().to_string(),
        "head": head_sha(root),
        "indexed": false,
        "indexed_head": null,
        "indexed_model": null,
        "files": 0,
        "chunks": 0,
        "changed_since_index": 0,
        "error": null,
        "reranker": rag_core::models::is_installed(rag_core::catalog::reranker_spec())
            .then_some(rag_core::catalog::reranker_spec().id),
    });
    // Size on disk (db + WAL) and last write time, from the files themselves.
    let mut size = 0u64;
    let mut modified: Option<std::time::SystemTime> = None;
    for suffix in ["", "-wal"] {
        let mut p = index_path(&id).into_os_string();
        p.push(suffix);
        if let Ok(m) = std::fs::metadata(&p) {
            size += m.len();
            modified = modified.max(m.modified().ok());
        }
    }
    out["size_bytes"] = size.into();
    out["indexed_at"] = modified
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .into();
    let Some(spec) = model_by_id(&cfg.model) else {
        out["error"] = "Modello sconosciuto".into();
        return out;
    };
    match Store::open_reader(&index_path(&id), spec.dims, spec.id) {
        Ok(store) => {
            out["indexed"] = true.into();
            out["indexed_model"] = spec.id.into();
            out["indexed_head"] = store.meta_get("indexed_head").ok().flatten().into();
            if let Ok((f, c)) = store.counts() {
                out["files"] = f.into();
                out["chunks"] = c.into();
            }
            if let Ok(rows) = store.counts_by_source() {
                out["by_source"] = rows
                    .into_iter()
                    .map(|(src, f, c)| (src, serde_json::json!({"files": f, "chunks": c})))
                    .collect::<serde_json::Map<_, _>>()
                    .into();
            }
            out["changed_since_index"] = store.count_changed(root).unwrap_or(0).into();
        }
        Err(e) => out["error"] = e.into(),
    }
    out
}

#[cfg(all(feature = "embed", feature = "download"))]
pub fn run_status(repo: Option<&Path>, _json: bool) -> i32 {
    match resolve_repo(repo) {
        Ok(root) => {
            println!("{}", status_json(&root));
            0
        }
        Err(e) => {
            println!("{}", serde_json::json!({"event":"error","message":e}));
            1
        }
    }
}
