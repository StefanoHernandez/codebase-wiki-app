use std::path::Path;

use rusqlite::{params, Connection};
use sqlite_vec::sqlite3_vec_init;
use wiki_core::glob_match;

use crate::chunk::Chunk;
use crate::files::{FileEntry, FileSource};

const SCHEMA_VERSION: &str = "1";

#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub source: FileSource,
    pub score: f64,
    pub text: String,
    pub chunk_id: i64,
}

pub struct Store {
    conn: Connection,
    dims: u32,
}

fn load_sqlite_vec() {
    unsafe {
        rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute(
            sqlite3_vec_init as *const (),
        )));
    }
}

impl Store {
    pub fn open(path: &Path, dims: u32, model_id: &str) -> Result<Self, String> {
        if path.exists() {
            if let Ok(existing) = Self::open_existing(path) {
                let meta_model = existing.meta_get("model_id")?;
                let meta_dims = existing.meta_get("dims")?;
                if meta_model.as_deref() != Some(model_id) || meta_dims.as_deref() != Some(&dims.to_string()) {
                    std::fs::remove_file(path).map_err(|e| e.to_string())?;
                } else {
                    return Ok(existing);
                }
            } else {
                let _ = std::fs::remove_file(path);
            }
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        load_sqlite_vec();
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| e.to_string())?;
        let s = Self { conn, dims };
        s.init_schema(model_id)?;
        Ok(s)
    }

    fn open_existing(path: &Path) -> Result<Self, String> {
        load_sqlite_vec();
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        Ok(Self { conn, dims: 0 })
    }

    fn init_schema(&self, model_id: &str) -> Result<(), String> {
        self.conn
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
                 CREATE TABLE IF NOT EXISTS files(
                   id INTEGER PRIMARY KEY, path TEXT UNIQUE, source TEXT, size INTEGER, mtime INTEGER, sha256 TEXT);
                 CREATE TABLE IF NOT EXISTS chunks(
                   id INTEGER PRIMARY KEY, file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
                   start_line INTEGER, end_line INTEGER, text TEXT);
                 CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                   text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');",
            )
            .map_err(|e| e.to_string())?;
        let vec_code = format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS vec_code USING vec0(embedding float[{}] distance_metric=cosine);",
            self.dims
        );
        let vec_wiki = format!(
            "CREATE VIRTUAL TABLE IF NOT EXISTS vec_wiki USING vec0(embedding float[{}] distance_metric=cosine);",
            self.dims
        );
        self.conn.execute_batch(&vec_code).map_err(|e| e.to_string())?;
        self.conn.execute_batch(&vec_wiki).map_err(|e| e.to_string())?;
        self.meta_set("schema_version", SCHEMA_VERSION)?;
        self.meta_set("model_id", model_id)?;
        self.meta_set("dims", &self.dims.to_string())?;
        Ok(())
    }

    fn meta_set(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO meta(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                params![key, value],
            )
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn meta_get(&self, key: &str) -> Result<Option<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT value FROM meta WHERE key=?1")
            .map_err(|e| e.to_string())?;
        let mut rows = stmt.query(params![key]).map_err(|e| e.to_string())?;
        if let Some(row) = rows.next().map_err(|e| e.to_string())? {
            return Ok(row.get(0).ok());
        }
        Ok(None)
    }

    pub fn replace_file(
        &self,
        entry: &FileEntry,
        sha: &str,
        chunks: &[Chunk],
        vectors: &[Vec<f32>],
    ) -> Result<(), String> {
        if chunks.len() != vectors.len() {
            return Err("chunks/vectors length mismatch".into());
        }
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let file_id: i64 = tx
            .query_row(
                "SELECT id FROM files WHERE path=?1",
                params![entry.rel_path],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if file_id != 0 {
            let mut ids_stmt = tx
                .prepare("SELECT id FROM chunks WHERE file_id=?1")
                .map_err(|e| e.to_string())?;
            let chunk_ids: Vec<i64> = ids_stmt
                .query_map(params![file_id], |r| r.get(0))
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .collect();
            for cid in chunk_ids {
                tx.execute("DELETE FROM chunks_fts WHERE rowid=?1", params![cid])
                    .ok();
                tx.execute("DELETE FROM vec_code WHERE rowid=?1", params![cid]).ok();
                tx.execute("DELETE FROM vec_wiki WHERE rowid=?1", params![cid]).ok();
            }
            tx.execute("DELETE FROM chunks WHERE file_id=?1", params![file_id])
                .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "INSERT INTO files(path,source,size,mtime,sha256) VALUES(?1,?2,?3,?4,?5)
             ON CONFLICT(path) DO UPDATE SET source=excluded.source,size=excluded.size,mtime=excluded.mtime,sha256=excluded.sha256",
            params![
                entry.rel_path,
                match entry.source {
                    FileSource::Code => "code",
                    FileSource::Wiki => "wiki",
                },
                entry.size as i64,
                entry.mtime,
                sha
            ],
        )
        .map_err(|e| e.to_string())?;
        let file_id: i64 = tx
            .query_row(
                "SELECT id FROM files WHERE path=?1",
                params![entry.rel_path],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        for (chunk, vec) in chunks.iter().zip(vectors.iter()) {
            tx.execute(
                "INSERT INTO chunks(file_id,start_line,end_line,text) VALUES(?1,?2,?3,?4)",
                params![file_id, chunk.start_line, chunk.end_line, chunk.text],
            )
            .map_err(|e| e.to_string())?;
            let chunk_id = tx.last_insert_rowid();
            tx.execute(
                "INSERT INTO chunks_fts(rowid,text) VALUES(?1,?2)",
                params![chunk_id, chunk.text],
            )
            .map_err(|e| e.to_string())?;
            let blob = vector_to_blob(vec);
            let vec_table = match entry.source {
                FileSource::Code => "vec_code",
                FileSource::Wiki => "vec_wiki",
            };
            tx.execute(
                &format!("INSERT INTO {vec_table}(rowid, embedding) VALUES (?1, ?2)"),
                params![chunk_id, blob],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_missing(&self, paths_now: &[String]) -> Result<(), String> {
        if paths_now.is_empty() {
            self.conn
                .execute("DELETE FROM files", [])
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
        let placeholders: String = paths_now.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!("SELECT id, path FROM files WHERE path NOT IN ({placeholders})");
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let params: Vec<&dyn rusqlite::ToSql> =
            paths_now.iter().map(|p| p as &dyn rusqlite::ToSql).collect();
        let rows = stmt
            .query_map(rusqlite::params_from_iter(params.iter()), |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            let (fid, path) = row;
            self.conn
                .execute("DELETE FROM files WHERE id=?1", params![fid])
                .map_err(|e| e.to_string())?;
            let _ = path;
        }
        Ok(())
    }

    fn fts_query(raw: &str) -> String {
        raw.split_whitespace()
            .map(|t| format!("\"{}\"", t.replace('"', "")))
            .collect::<Vec<_>>()
            .join(" ")
    }

    pub fn search(
        &self,
        query_vec: &[f32],
        query_text: &str,
        source: FileSource,
        k: usize,
        path_glob: Option<&str>,
    ) -> Result<Vec<Hit>, String> {
        let vec_table = match source {
            FileSource::Code => "vec_code",
            FileSource::Wiki => "vec_wiki",
        };
        let q_blob = vector_to_blob(query_vec);
        let mut vector_hits: Vec<(i64, f64)> = Vec::new();
        let sql = format!(
            "SELECT rowid, distance FROM {vec_table} WHERE embedding MATCH ?1 ORDER BY distance LIMIT 50"
        );
        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![q_blob], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))
            .map_err(|e| e.to_string())?;
        for (i, row) in rows.flatten().enumerate() {
            let rank = (i + 1) as f64;
            vector_hits.push((row.0, 1.0 / (60.0 + rank)));
        }
        let fts_q = Self::fts_query(query_text);
        let mut fts_hits: Vec<(i64, f64)> = Vec::new();
        if !fts_q.is_empty() {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT rowid, bm25(chunks_fts) AS score FROM chunks_fts WHERE chunks_fts MATCH ?1 ORDER BY score LIMIT 50",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![fts_q], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?)))
                .map_err(|e| e.to_string())?;
            for (i, row) in rows.flatten().enumerate() {
                let rank = (i + 1) as f64;
                fts_hits.push((row.0, 1.0 / (60.0 + rank)));
            }
        }
        let mut scores: std::collections::HashMap<i64, f64> = std::collections::HashMap::new();
        for (id, s) in fts_hits.iter().chain(vector_hits.iter()) {
            *scores.entry(*id).or_default() += s;
        }
        let mut ranked: Vec<(i64, f64)> = scores.into_iter().collect();
        ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        let mut out = Vec::new();
        for (chunk_id, score) in ranked.into_iter().take(k.max(50)) {
            let hit: Hit = self.conn.query_row(
                "SELECT f.path, c.start_line, c.end_line, f.source, c.text
                 FROM chunks c JOIN files f ON f.id=c.file_id WHERE c.id=?1",
                params![chunk_id],
                |r| {
                    let src: String = r.get(3)?;
                    let source = if src == "wiki" { FileSource::Wiki } else { FileSource::Code };
                    Ok(Hit {
                        path: r.get(0)?,
                        start_line: r.get::<_, i32>(1)? as u32,
                        end_line: r.get::<_, i32>(2)? as u32,
                        source,
                        score,
                        text: r.get(4)?,
                        chunk_id,
                    })
                },
            ).map_err(|e| e.to_string())?;
            if let Some(glob) = path_glob {
                if !glob_match(glob, &hit.path) {
                    continue;
                }
            }
            out.push(hit);
            if out.len() >= k {
                break;
            }
        }
        Ok(out)
    }
}

fn vector_to_blob(vec: &[f32]) -> Vec<u8> {
    vec.iter().flat_map(|f| f.to_le_bytes()).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chunk::Chunk;

    fn fake_vec(seed: f32) -> Vec<f32> {
        vec![seed, 0.1, 0.2, 0.3]
    }

    #[test]
    fn rrf_fuses_fts_and_vector() {
        let td = tempfile::tempdir().unwrap();
        let path = td.path().join("t.sqlite");
        let store = Store::open(&path, 4, "m").unwrap();
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
    fn replace_twice_one_copy() {
        let td = tempfile::tempdir().unwrap();
        let path = td.path().join("t.sqlite");
        let store = Store::open(&path, 4, "m").unwrap();
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
        let _ = Store::open(&path, 4, "a").unwrap();
        let store2 = Store::open(&path, 8, "b").unwrap();
        assert_eq!(store2.meta_get("model_id").unwrap().as_deref(), Some("b"));
    }
}
