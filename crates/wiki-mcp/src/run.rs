#[cfg(all(feature = "embed", feature = "download"))]
use std::fs;
#[cfg(all(feature = "embed", feature = "download"))]
use std::io::Write;
#[cfg(all(feature = "embed", feature = "download"))]
use std::path::Path;
#[cfg(all(feature = "embed", feature = "download"))]
use std::time::Instant;

#[cfg(all(feature = "embed", feature = "download"))]
use rag_core::{
    chunk::{chunk_file, filter_private_chunks, terms_hash},
    embed::load_embedder,
    excluded_globs_from_wiki, list_files, model_by_id, read_config, FileSource,
    head_sha, index_path, model_dir, repo_id, resolve_repo, wiki_root, Store,
};
#[cfg(all(feature = "embed", feature = "download"))]
use sha2::{Digest, Sha256};

#[cfg(all(feature = "embed", feature = "download"))]
fn sha_file(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mut h = Sha256::new();
    h.update(&bytes);
    Ok(format!("{:x}", h.finalize()))
}

#[cfg(all(feature = "embed", feature = "download"))]
pub fn run_index(repo: Option<&Path>, json: bool) -> i32 {
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
    let mut store = match Store::open(&db_path, spec.dims, spec.id) {
        Ok(s) => s,
        Err(e) => return err(&e),
    };
    if store.meta_get("terms_hash").ok().flatten().as_deref() != Some(&th) {
        let _ = std::fs::remove_file(&db_path);
        store = match Store::open(&db_path, spec.dims, spec.id) {
            Ok(s) => s,
            Err(e) => return err(&e),
        };
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
    let mut skipped_private = 0u32;
    let mut done_wiki = 0usize;
    for entry in &wiki_files {
        if index_one(&store, &root, entry, &mut embedder, terms.as_deref(), &mut skipped_private).is_err() {
            return err("Indicizzazione file wiki fallita");
        }
        done_wiki += 1;
        emit(serde_json::json!({"event":"progress","phase":"wiki","done":done_wiki,"total":wiki_files.len()}));
    }
    emit(serde_json::json!({"event":"phase","phase":"code","total":code_files.len()}));
    let mut done_code = 0usize;
    for entry in &code_files {
        if index_one(&store, &root, entry, &mut embedder, terms.as_deref(), &mut skipped_private).is_err() {
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
    let _ = store.meta_set("terms_hash", &terms_hash(terms.as_deref()));
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
    terms: Option<&str>,
    skipped_private: &mut u32,
) -> Result<(), String> {
    if let Some((size, mtime, sha)) = store.file_record(&entry.rel_path)? {
        if size == entry.size && mtime == entry.mtime {
            return Ok(());
        }
        let path = root.join(&entry.rel_path);
        let new_sha = sha_file(&path)?;
        if new_sha == sha {
            return Ok(());
        }
    }
    let text = fs::read_to_string(root.join(&entry.rel_path)).map_err(|e| e.to_string())?;
    let chunks = chunk_file(&entry.rel_path, &text, entry.source);
    let (chunks, sk) = filter_private_chunks(chunks, terms);
    *skipped_private += sk;
    let embed_texts: Vec<String> = chunks.iter().map(|c| c.embed_text.clone()).collect();
    let vectors = embedder.embed_passages(&embed_texts)?;
  let sha = sha_file(&root.join(&entry.rel_path))?;
    store.replace_file(entry, &sha, &chunks, &vectors)
}

#[cfg(all(feature = "embed", feature = "download"))]
pub fn run_search(repo: Option<&Path>, wiki: bool, k: usize, glob: Option<&str>, query: &str) -> i32 {
    let root = match resolve_repo(repo) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    let cfg = read_config().unwrap_or(rag_core::RagConfig {
        model: rag_core::default_model_id().to_string(),
    });
    let spec = match model_by_id(&cfg.model) {
        Some(s) => s,
        None => {
            eprintln!("Nessun modello");
            return 1;
        }
    };
    if !rag_core::models::is_installed(spec) {
        eprintln!("Nessun modello installato: apri Codebase Wiki → Ricerca");
        return 1;
    }
    let store = match Store::open(&index_path(&repo_id(&root)), spec.dims, spec.id) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    let mut embedder = match load_embedder(spec, &model_dir(spec.id)) {
        Ok(e) => e,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    let qv = match embedder.embed_query(query) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    let source = if wiki { FileSource::Wiki } else { FileSource::Code };
    let hits = match store.search(&qv, query, source, k, glob) {
        Ok(h) => h,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    for h in hits {
        println!("{}:{}-{} score={:.4}", h.path, h.start_line, h.end_line, h.score);
        println!("{}", h.text.lines().take(5).collect::<Vec<_>>().join("\n"));
        println!("---");
    }
    0
}

#[cfg(all(feature = "embed", feature = "download"))]
pub fn run_status(repo: Option<&Path>, json: bool) -> i32 {
    let root = match resolve_repo(repo) {
        Ok(r) => r,
        Err(e) => {
            eprintln!("{e}");
            return 1;
        }
    };
    let id = repo_id(&root);
    let cfg = read_config().unwrap_or(rag_core::RagConfig {
        model: rag_core::default_model_id().to_string(),
    });
    let head = head_sha(&root);
    let mut out = serde_json::json!({
        "repo": root.display().to_string(),
        "repo_id": id,
        "model": cfg.model,
        "index_path": index_path(&id).display().to_string(),
        "head": head,
        "indexed_head": null,
        "files": 0,
        "chunks": 0,
        "changed_since_index": 0,
    });
    if let Some(spec) = model_by_id(&cfg.model) {
        if let Ok(store) = Store::open(&index_path(&id), spec.dims, spec.id) {
            out["indexed_head"] = store
                .meta_get("indexed_head")
                .ok()
                .flatten()
                .into();
            if let Ok((f, c)) = store.counts() {
                out["files"] = f.into();
                out["chunks"] = c.into();
            }
        }
    }
    if json {
        println!("{}", serde_json::to_string(&out).unwrap());
    } else {
        println!("{}", out);
    }
    0
}
