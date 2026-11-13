use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use sqlite_vec::sqlite3_vec_init;
use wiki_core::glob_match;

use crate::chunk::Chunk;
use crate::files::{FileEntry, FileSource};

// 3: token-sized chunks with `path › symbols/headings` headers (0.1.3).
const SCHEMA_VERSION: &str = "3";

/// Shown when a reader finds no index for this repo.
pub const NO_INDEX_MSG: &str = "Indice assente per questo repo: apri Codebase Wiki → Ricerca → Indicizza";

#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub source: FileSource,
    pub score: f64,
    pub text: String,
    pub chunk_id: i64,
    /// 1-based rank in the keyword (BM25) list, if the chunk was there.
    pub bm25_rank: Option<u32>,
    /// 1-based rank in the vector list, if the chunk was there.
    pub vec_rank: Option<u32>,
    /// 1-based rank after RRF fusion (before any reranker).
    pub fused_rank: u32,
}

pub struct Store {
    conn: Connection,
    dims: u32,
}

fn load_sqlite_vec() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| unsafe {
        #[allow(clippy::missing_transmute_annotations)]
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(sqlite3_vec_init as *const ())));
    });
}

fn source_str(s: FileSource) -> &'static str {
    match s {
        FileSource::Code => "code",
        FileSource::Wiki => "wiki",
    }
}

/// A repository with a local index, as recorded by the indexer (`repo_root` in meta).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexedRepo {
    pub root: std::path::PathBuf,
    /// Folder name, used to pick a repo by name.
    pub name: String,
}

/// Every index under `indexes_dir` that records its repo root and whose folder still exists.
/// Indexes written before `repo_root` was recorded are skipped until they are rebuilt.
pub fn indexed_repos(indexes_dir: &Path) -> Vec<IndexedRepo> {
    let Ok(entries) = std::fs::read_dir(indexes_dir) else {
        return Vec::new();
    };
    let mut out: Vec<IndexedRepo> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "sqlite"))
        .filter_map(|p| {
            let conn = Connection::open_with_flags(&p, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
            let root: String = conn
                .query_row("SELECT value FROM meta WHERE key='repo_root'", [], |r| r.get(0))
                .ok()?;
            let root = std::path::PathBuf::from(root);
            root.is_dir().then(|| IndexedRepo {
                name: root.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                root,
            })
        })
        .collect();
    out.sort_by(|a, b| a.name.cmp(&b.name).then(a.root.cmp(&b.root)));
    out
}

/// Deletes the DB and its WAL side files. The caller must have dropped every connection first.
pub fn delete_index(path: &Path) -> Result<(), String> {
    for suffix in ["", "-wal", "-shm"] {
        let mut s = path.as_os_str().to_owned();
        s.push(suffix);
        match std::fs::remove_file(std::path::PathBuf::from(s)) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(wiki_core::tr(&format!("Impossibile cancellare l'indice: {e}"), &format!("Cannot delete the index: {e}"))),
        }
    }
    Ok(())
}

impl Store {
    /// Writer (only `index`): opens the index, rebuilding it when the model, dims or schema changed.
    pub fn open_writer(path: &Path, dims: u32, model_id: &str) -> Result<Self, String> {
        if path.exists() {
            let keep = match Self::connect(path, false) {
                Ok(existing) => {
                    let ok = existing.meta_get("model_id").ok().flatten().as_deref() == Some(model_id)
                        && existing.meta_get("dims").ok().flatten() == Some(dims.to_string())
                        && existing.meta_get("schema_version").ok().flatten().as_deref() == Some(SCHEMA_VERSION);
                    drop(existing);
                    ok
                }
                Err(_) => false,
            };
            if keep {
                let mut s = Self::connect(path, false)?;
                s.dims = dims;
                return Ok(s);
            }
            delete_index(path)?;
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut s = Self::connect(path, false)?;
        s.dims = dims;
        s.init_schema(model_id)?;
        Ok(s)
    }

    /// Reader (`serve`, `search`, `status`, the app): never creates, deletes or migrates anything.
    pub fn open_reader(path: &Path, dims: u32, model_id: &str) -> Result<Self, String> {
        if !path.exists() {
            return Err(NO_INDEX_MSG.into());
        }
        let mut s = Self::connect(path, true)?;
        let model = s.meta_get("model_id").ok().flatten();
        let ok = model.as_deref() == Some(model_id)
            && s.meta_get("dims").ok().flatten() == Some(dims.to_string())
            && s.meta_get("schema_version").ok().flatten().as_deref() == Some(SCHEMA_VERSION);
        if !ok {
            return Err(format!(
                "L'indice è stato creato con un altro modello o formato ({}): apri Codebase Wiki → Ricerca → Indicizza",
                model.unwrap_or_else(|| "sconosciuto".into())
            ));
        }
        s.dims = dims;
        Ok(s)
    }

    fn connect(path: &Path, read_only: bool) -> Result<Self, String> {
        load_sqlite_vec();
        let conn = if read_only {
            Connection::open_with_flags(
                path,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
            )
        } else {
            Connection::open(path)
        }
        .map_err(|e| e.to_string())?;
        if !read_only {
            conn.pragma_update(None, "journal_mode", "WAL").map_err(|e| e.to_string())?;
        }
        conn.pragma_update(None, "foreign_keys", "ON").map_err(|e| e.to_string())?;
        conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
        Ok(Self { conn, dims: 0 })
    }

    fn init_schema(&self, model_id: &str) -> Result<(), String> {
        // FTS holds the embedded text (path + heading + chunk), so a file name or path finds its chunks.
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
                 CREATE TABLE IF NOT EXISTS files(
                   id INTEGER PRIMARY KEY, path TEXT UNIQUE, source TEXT, size INTEGER, mtime INTEGER, sha256 TEXT);
                 CREATE TABLE IF NOT EXISTS chunks(
                   id INTEGER PRIMARY KEY, file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
                   start_line INTEGER, end_line INTEGER, text TEXT);
                 CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                   body, source UNINDEXED, tokenize='unicode61 remove_diacritics 2');",
            )
            .map_err(|e| e.to_string())?;
        for table in ["vec_code", "vec_wiki"] {
            self.conn
                .execute_batch(&format!(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS {table} USING vec0(embedding float[{}] distance_metric=cosine);",
                    self.dims
                ))
                .map_err(|e| e.to_string())?;
        }
        self.meta_set("schema_version", SCHEMA_VERSION)?;
        self.meta_set("model_id", model_id)?;
        self.meta_set("dims", &self.dims.to_string())?;
        Ok(())
    }

    pub fn meta_set(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn meta_get(&self, key: &str) -> Result<Option<String>, String> {
        self.conn
            .query_row("SELECT value FROM meta WHERE key=?1", params![key], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn file_record(&self, path: &str) -> Result<Option<(u64, i64, String)>, String> {
        self.conn
            .query_row("SELECT size, mtime, sha256 FROM files WHERE path=?1", params![path], |r| {
                Ok((r.get::<_, i64>(0)? as u64, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
            })
            .optional()
            .map_err(|e| e.to_string())
    }

    pub fn file_source(&self, path: &str) -> Result<Option<FileSource>, String> {
        let s: Option<String> = self
            .conn
            .query_row("SELECT source FROM files WHERE path=?1", params![path], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(s.map(|s| if s == "wiki" { FileSource::Wiki } else { FileSource::Code }))
    }

    /// Same content, new mtime (checkout, touch): remember it so the next run skips the hash.
    pub fn touch_file(&self, path: &str, size: u64, mtime: i64) -> Result<(), String> {
        self.conn
            .execute("UPDATE files SET size=?2, mtime=?3 WHERE path=?1", params![path, size as i64, mtime])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// (files, chunks) per source, e.g. `[("code", 120, 900), ("wiki", 40, 300)]`.
    pub fn counts_by_source(&self) -> Result<Vec<(String, u64, u64)>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT f.source, count(DISTINCT f.id), count(c.id)
                 FROM files f LEFT JOIN chunks c ON c.file_id = f.id GROUP BY f.source ORDER BY f.source",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)? as u64, r.get::<_, i64>(2)? as u64)))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn counts(&self) -> Result<(u64, u64), String> {
        let files: i64 = self.conn.query_row("SELECT count(*) FROM files", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        let chunks: i64 = self.conn.query_row("SELECT count(*) FROM chunks", [], |r| r.get(0)).map_err(|e| e.to_string())?;
        Ok((files as u64, chunks as u64))
    }

    /// Indexed files whose size or mtime differ on disk now, or that are gone. No hashing: cheap enough per search.
    pub fn count_changed(&self, root: &Path) -> Result<u64, String> {
        let mut stmt = self.conn.prepare("SELECT path, size, mtime FROM files").map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))
            .map_err(|e| e.to_string())?;
        let mut n = 0;
        for (path, size, mtime) in rows.flatten() {
            if file_changed(root, &path, size as u64, mtime) {
                n += 1;
            }
        }
        Ok(n)
    }

    fn delete_file_rows(tx: &rusqlite::Transaction<'_>, file_id: i64) -> Result<(), String> {
        let chunk_ids: Vec<i64> = {
            let mut stmt = tx.prepare("SELECT id FROM chunks WHERE file_id=?1").map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map(params![file_id], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<i64>, _>>()
                .map_err(|e| e.to_string())?;
            ids
        };
        for cid in chunk_ids {
            for table in ["chunks_fts", "vec_code", "vec_wiki"] {
                tx.execute(&format!("DELETE FROM {table} WHERE rowid=?1"), params![cid])
                    .map_err(|e| e.to_string())?;
            }
        }
        tx.execute("DELETE FROM chunks WHERE file_id=?1", params![file_id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    /// One transaction per file: a killed run leaves every file either old or new, never half.
    pub fn replace_file(&self, entry: &FileEntry, sha: &str, chunks: &[Chunk], vectors: &[Vec<f32>]) -> Result<(), String> {
        if chunks.len() != vectors.len() {
            return Err("chunks/vectors length mismatch".into());
        }
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let old: Option<i64> = tx
            .query_row("SELECT id FROM files WHERE path=?1", params![entry.rel_path], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(fid) = old {
            Self::delete_file_rows(&tx, fid)?;
        }
        tx.execute(
            "INSERT INTO files(path,source,size,mtime,sha256) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(path) DO UPDATE SET source=excluded.source,size=excluded.size,mtime=excluded.mtime,sha256=excluded.sha256",
            params![entry.rel_path, source_str(entry.source), entry.size as i64, entry.mtime, sha],
        )
        .map_err(|e| e.to_string())?;
        let file_id: i64 = tx
            .query_row("SELECT id FROM files WHERE path=?1", params![entry.rel_path], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        let vec_table = match entry.source {
            FileSource::Code => "vec_code",
            FileSource::Wiki => "vec_wiki",
        };
        for (chunk, vec) in chunks.iter().zip(vectors.iter()) {
            if vec.len() != self.dims as usize {
                return Err(format!("vector has {} dims, index has {}", vec.len(), self.dims));
            }
            tx.execute(
                "INSERT INTO chunks(file_id,start_line,end_line,text) VALUES(?1,?2,?3,?4)",
                params![file_id, chunk.start_line, chunk.end_line, chunk.text],
            )
            .map_err(|e| e.to_string())?;
            let chunk_id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO chunks_fts(rowid,body,source) VALUES(?1,?2,?3)",
                params![chunk_id, chunk.embed_text, source_str(entry.source)],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                &format!("INSERT INTO {vec_table}(rowid, embedding) VALUES (?1, ?2)"),
                params![chunk_id, vector_to_blob(vec)],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    /// Drops files (and their chunks, FTS rows and vectors) that are no longer in the file list.
    pub fn remove_missing(&self, paths_now: &[String]) -> Result<u64, String> {
        let keep: std::collections::HashSet<&str> = paths_now.iter().map(String::as_str).collect();
        let gone: Vec<i64> = {
            let mut stmt = self.conn.prepare("SELECT id, path FROM files").map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows.into_iter().filter(|(_, p)| !keep.contains(p.as_str())).map(|(id, _)| id).collect()
        };
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        for fid in &gone {
            Self::delete_file_rows(&tx, *fid)?;
            tx.execute("DELETE FROM files WHERE id=?1", params![fid]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(gone.len() as u64)
    }

    /// FTS query: words OR'ed, so a natural-language question still matches its keywords.
    fn fts_query(raw: &str) -> String {
        const STOP: &[&str] = &[
            "the", "and", "for", "how", "what", "where", "which", "does", "with", "from", "this", "that", "are", "is",
            "dove", "come", "cosa", "che", "del", "della", "delle", "dei", "degli", "nel", "nella", "per", "con", "una",
            "uno", "gli", "sono", "quale", "quali", "viene",
        ];
        let mut seen = std::collections::HashSet::new();
        raw.split(|c: char| !(c.is_alphanumeric() || c == '_'))
            .map(|t| t.to_lowercase())
            .filter(|t| t.chars().count() >= 3 && !STOP.contains(&t.as_str()))
            .filter(|t| seen.insert(t.clone()))
            .map(|t| format!("\"{t}\""))
            .collect::<Vec<_>>()
            .join(" OR ")
    }

    /// Hybrid search: top 50 by BM25 and top 50 by vector for one source, fused with RRF (k=60).
    pub fn search(
        &self,
        query_vec: &[f32],
        query_text: &str,
        source: FileSource,
        k: usize,
        path_glob: Option<&str>,
    ) -> Result<Vec<Hit>, String> {
        const RRF_K: f64 = 60.0;
        const POOL: usize = 50;
        let vec_table = match source {
            FileSource::Code => "vec_code",
            FileSource::Wiki => "vec_wiki",
        };
        let mut scores: std::collections::HashMap<i64, f64> = std::collections::HashMap::new();
        let mut vec_ranks: std::collections::HashMap<i64, u32> = std::collections::HashMap::new();
        let mut bm25_ranks: std::collections::HashMap<i64, u32> = std::collections::HashMap::new();
        {
            let mut stmt = self
                .conn
                .prepare(&format!(
                    "SELECT rowid FROM {vec_table} WHERE embedding MATCH ?1 AND k = {POOL} ORDER BY distance"
                ))
                .map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map(params![vector_to_blob(query_vec)], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            for (i, id) in ids.into_iter().enumerate() {
                *scores.entry(id).or_default() += 1.0 / (RRF_K + (i + 1) as f64);
                vec_ranks.insert(id, i as u32 + 1);
            }
        }
        let fts_q = Self::fts_query(query_text);
        if !fts_q.is_empty() {
            let mut stmt = self
                .conn
                .prepare(&format!(
                    "SELECT rowid FROM chunks_fts WHERE chunks_fts MATCH ?1 AND source = ?2 ORDER BY bm25(chunks_fts) LIMIT {POOL}"
                ))
                .map_err(|e| e.to_string())?;
            let ids = stmt
                .query_map(params![fts_q, source_str(source)], |r| r.get::<_, i64>(0))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            for (i, id) in ids.into_iter().enumerate() {
                *scores.entry(id).or_default() += 1.0 / (RRF_K + (i + 1) as f64);
                bm25_ranks.insert(id, i as u32 + 1);
            }
        }
        // Tests repeat the words of the code they test: rank them below it unless the query asks for tests.
        let wants_tests = query_text.to_lowercase().contains("test");
        if !wants_tests {
            let mut stmt = self
                .conn
                .prepare("SELECT f.path FROM chunks c JOIN files f ON f.id=c.file_id WHERE c.id=?1")
                .map_err(|e| e.to_string())?;
            for (id, score) in scores.iter_mut() {
                let path: Option<String> = stmt.query_row(params![id], |r| r.get(0)).optional().map_err(|e| e.to_string())?;
                if path.as_deref().is_some_and(is_test_path) {
                    *score *= TEST_PENALTY;
                }
            }
        }
        let mut ranked: Vec<(i64, f64)> = scores.into_iter().collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
        let mut out = Vec::new();
        // Generated copies (one package per host) hold the same text: one slot each, not k.
        let mut seen_text = std::collections::HashSet::new();
        for (pos, (chunk_id, score)) in ranked.into_iter().enumerate() {
            let hit = self
                .conn
                .query_row(
                    "SELECT f.path, c.start_line, c.end_line, f.source, c.text
                     FROM chunks c JOIN files f ON f.id=c.file_id WHERE c.id=?1",
                    params![chunk_id],
                    |r| {
                        let src: String = r.get(3)?;
                        Ok(Hit {
                            path: r.get(0)?,
                            start_line: r.get::<_, i64>(1)? as u32,
                            end_line: r.get::<_, i64>(2)? as u32,
                            source: if src == "wiki" { FileSource::Wiki } else { FileSource::Code },
                            score,
                            text: r.get(4)?,
                            chunk_id,
                            bm25_rank: bm25_ranks.get(&chunk_id).copied(),
                            vec_rank: vec_ranks.get(&chunk_id).copied(),
                            fused_rank: pos as u32 + 1,
                        })
                    },
                )
                .optional()
                .map_err(|e| e.to_string())?;
            let Some(hit) = hit else { continue };
            // ponytail: the glob filters the 100-candidate pool; a narrow glob may return fewer than k.
            if path_glob.is_some_and(|g| !glob_match(g, &hit.path)) {
                continue;
            }
            if !seen_text.insert(hit.text.clone()) {
                continue;
            }
            out.push(hit);
            if out.len() >= k {
                break;
            }
        }
        Ok(out)
    }
}

/// Score multiplier for test files, so the implementation outranks the test that names it.
const TEST_PENALTY: f64 = 0.5;

/// Test files by common conventions: a `tests`/`test`/`__tests__`/`spec` folder, or names like
/// `x.test.ts`, `x.spec.js`, `x_test.go`, `test_x.py`, `test-x.sh`, `XTest.java`, `XTests.cs`.
fn is_test_path(path: &str) -> bool {
    let lower = path.to_lowercase();
    let mut parts = lower.split('/').collect::<Vec<_>>();
    let name = parts.pop().unwrap_or("");
    if parts.iter().any(|d| matches!(*d, "tests" | "test" | "__tests__" | "spec" | "specs")) {
        return true;
    }
    let stem = name.split('.').next().unwrap_or("");
    name.contains(".test.")
        || name.contains(".spec.")
        || stem.ends_with("_test")
        || stem.starts_with("test_")
        || stem.starts_with("test-")
        || path.rsplit('/').next().unwrap_or("").split('.').next().is_some_and(|s| s.ends_with("Test") || s.ends_with("Tests"))
}

/// A file changed since indexing when it is gone or its size or mtime differ.
pub fn file_changed(root: &Path, rel_path: &str, size: u64, mtime: i64) -> bool {
    match std::fs::metadata(root.join(rel_path)) {
        Ok(m) => {
            let now = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
            m.len() != size || now != mtime
        }
        Err(_) => true,
    }
}

fn vector_to_blob(vec: &[f32]) -> Vec<u8> {
    vec.iter().flat_map(|f| f.to_le_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chunk::Chunk;

    #[test]
    fn test_paths_are_recognised() {
        for p in ["tests/md-edit.test.ts", "src/a.spec.js", "pkg/x_test.go", "scripts/test-hooks.sh", "test_x.py", "src/FooTest.java", "a/__tests__/b.tsx"] {
            assert!(is_test_path(p), "{p}");
        }
        for p in ["src/lib/md-edit.ts", "crates/x/src/testing.rs", "src/contest.ts", "latest.py"] {
            assert!(!is_test_path(p), "{p}");
        }
    }

    fn fake_vec(seed: f32) -> Vec<f32> {
        vec![seed, 0.1, 0.2, 0.3]
    }

    #[test]
    fn rrf_fuses_fts_and_vector() {
        let td = tempfile::tempdir().unwrap();
        let path = td.path().join("t.sqlite");
        let store = Store::open_writer(&path, 4, "m").unwrap();
        let entry = FileEntry {
            rel_path: "a.rs".into(),
            source: FileSource::Code,
            size: 10,
            mtime: 1,
        };
        let chunks = vec![Chunk {
            start_line: 1,
            end_line: 1,
            text: "debounce watcher".into(),
            embed_text: "a.rs\n".into(),
        }];
        let vecs = vec![fake_vec(1.0)];
        store.replace_file(&entry, "sha", &chunks, &vecs).unwrap();
        let q = fake_vec(1.0);
        let hits = store
            .search(&q, "debounce watcher", FileSource::Code, 5, None)
            .unwrap();
        assert!(!hits.is_empty());
        assert_eq!(hits[0].path, "a.rs");
    }

    #[test]
    fn identical_copies_take_one_slot() {
        let td = tempfile::tempdir().unwrap();
        let store = Store::open_writer(&td.path().join("t.sqlite"), 4, "m").unwrap();
        for (p, text) in [("canonical/a.py", "def lock(): pass"), ("plugins/x/a.py", "def lock(): pass"), ("b.py", "def lock_other(): pass")] {
            let entry = FileEntry { rel_path: p.into(), source: FileSource::Code, size: 1, mtime: 1 };
            let c = Chunk { start_line: 1, end_line: 1, text: text.into(), embed_text: p.into() };
            store.replace_file(&entry, "sha", &[c], &[fake_vec(1.0)]).unwrap();
        }
        let hits = store.search(&fake_vec(1.0), "lock", FileSource::Code, 5, None).unwrap();
        let paths: Vec<_> = hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(paths.len(), 2, "{paths:?}");
        assert!(paths.contains(&"b.py"));
    }

    #[test]
    fn replace_twice_one_copy() {
        let td = tempfile::tempdir().unwrap();
        let path = td.path().join("t.sqlite");
        let store = Store::open_writer(&path, 4, "m").unwrap();
        let entry = FileEntry {
            rel_path: "b.rs".into(),
            source: FileSource::Code,
            size: 1,
            mtime: 1,
        };
        let c = Chunk {
            start_line: 1,
            end_line: 1,
            text: "x".into(),
            embed_text: "x".into(),
        };
        store
            .replace_file(&entry, "s1", &[c.clone()], &[fake_vec(0.5)])
            .unwrap();
        store
            .replace_file(&entry, "s2", &[c], &[fake_vec(0.6)])
            .unwrap();
        let n: i64 = store
            .conn
            .query_row("SELECT count(*) FROM chunks", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn model_change_rebuilds_db() {
        let td = tempfile::tempdir().unwrap();
        let path = td.path().join("t.sqlite");
        let _ = Store::open_writer(&path, 4, "a").unwrap();
        let store2 = Store::open_writer(&path, 8, "b").unwrap();
        assert_eq!(store2.meta_get("model_id").unwrap().as_deref(), Some("b"));
    }

    fn chunk(text: &str, path: &str) -> Chunk {
        Chunk { start_line: 1, end_line: 1, text: text.into(), embed_text: format!("{path}\n{text}") }
    }

    fn entry(path: &str, source: FileSource) -> FileEntry {
        FileEntry { rel_path: path.into(), source, size: 1, mtime: 1 }
    }

    #[test]
    fn removed_file_does_not_break_search_and_leaves_no_rows() {
        let td = tempfile::tempdir().unwrap();
        let store = Store::open_writer(&td.path().join("t.sqlite"), 4, "m").unwrap();
        store.replace_file(&entry("a.rs", FileSource::Code), "s", &[chunk("watcher debounce", "a.rs")], &[fake_vec(1.0)]).unwrap();
        store.replace_file(&entry("b.rs", FileSource::Code), "s", &[chunk("other code", "b.rs")], &[fake_vec(0.9)]).unwrap();
        assert_eq!(store.remove_missing(&["b.rs".into()]).unwrap(), 1);
        let n = |sql: &str| -> i64 { store.conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(n("SELECT count(*) FROM chunks"), 1);
        assert_eq!(n("SELECT count(*) FROM chunks_fts"), 1);
        assert_eq!(n("SELECT count(*) FROM vec_code"), 1);
        let hits = store.search(&fake_vec(1.0), "watcher", FileSource::Code, 5, None).unwrap();
        assert_eq!(hits.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(), vec!["b.rs"]);
    }

    #[test]
    fn natural_language_query_hits_fts_and_sources_stay_apart() {
        let td = tempfile::tempdir().unwrap();
        let store = Store::open_writer(&td.path().join("t.sqlite"), 4, "m").unwrap();
        store.replace_file(&entry("w.rs", FileSource::Code), "s", &[chunk("fn debounce() {}", "w.rs")], &[vec![0.0, 0.0, 1.0, 0.0]]).unwrap();
        store.replace_file(&entry("wiki/p.md", FileSource::Wiki), "s", &[chunk("debounce notes", "wiki/p.md")], &[vec![0.0, 0.0, 1.0, 0.0]]).unwrap();
        // Vector points elsewhere: only FTS can find it, and only with OR'ed words.
        let hits = store.search(&[1.0, 0.0, 0.0, 0.0], "dove è il debounce del watcher", FileSource::Code, 5, None).unwrap();
        assert_eq!(hits[0].path, "w.rs");
        assert!(hits.iter().all(|h| h.source == FileSource::Code));
        // A path word matches through the FTS body (path + text).
        let by_path = store.search(&[1.0, 0.0, 0.0, 0.0], "p.md", FileSource::Wiki, 5, None).unwrap();
        assert_eq!(by_path[0].path, "wiki/p.md");
    }

    #[test]
    fn indexed_repos_lists_recorded_roots_that_still_exist() {
        let td = tempfile::tempdir().unwrap();
        let idx = td.path().join("indexes");
        let repo = td.path().join("my-repo");
        std::fs::create_dir_all(&repo).unwrap();
        let with_root = Store::open_writer(&idx.join("a.sqlite"), 4, "m").unwrap();
        with_root.meta_set("repo_root", &repo.display().to_string()).unwrap();
        let gone = Store::open_writer(&idx.join("b.sqlite"), 4, "m").unwrap();
        gone.meta_set("repo_root", "/no/such/dir").unwrap();
        let _legacy = Store::open_writer(&idx.join("c.sqlite"), 4, "m").unwrap();
        assert_eq!(indexed_repos(&idx), vec![IndexedRepo { root: repo, name: "my-repo".into() }]);
        assert!(indexed_repos(&td.path().join("missing")).is_empty());
    }

    #[test]
    fn reader_never_creates_or_rebuilds() {
        let td = tempfile::tempdir().unwrap();
        let path = td.path().join("t.sqlite");
        assert!(Store::open_reader(&path, 4, "m").is_err());
        assert!(!path.exists(), "reader must not create the DB");
        let w = Store::open_writer(&path, 4, "m").unwrap();
        w.replace_file(&entry("a.rs", FileSource::Code), "s", &[chunk("x", "a.rs")], &[fake_vec(1.0)]).unwrap();
        drop(w);
        assert!(Store::open_reader(&path, 8, "other").is_err());
        let r = Store::open_reader(&path, 4, "m").unwrap();
        assert_eq!(r.counts().unwrap(), (1, 1), "a reader with another model must not wipe the index");
    }
}
