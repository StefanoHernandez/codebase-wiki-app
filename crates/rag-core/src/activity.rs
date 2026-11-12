//! Append-only log of MCP tool calls, one JSON object per line, one file per repo.

use std::fs;
use std::io::Write;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Shown instead of a query that contains a private term.
pub const PRIVATE_QUERY: &str = "[riservata]";
const ROTATE_ABOVE: usize = 600;
const KEEP: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActivityLine {
    /// Epoch milliseconds.
    pub ts: u64,
    pub repo: Option<String>,
    pub agent: String,
    pub tool: String,
    pub query: Option<String>,
    pub top: Vec<String>,
    pub ms: u64,
    pub error: Option<String>,
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Appends `line` to `<dir>/<file_stem>.jsonl` in one write, then trims the file to the
/// last `KEEP` lines once it passes `ROTATE_ABOVE`.
pub fn append(dir: &Path, file_stem: &str, line: &ActivityLine) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let path = dir.join(format!("{file_stem}.jsonl"));
    let mut json = serde_json::to_string(line).map_err(std::io::Error::other)?;
    json.push('\n');
    // Several agent sessions share this file: one lock around append + rotation, so a rotation
    // never drops a line appended after its read and two rotations never share a temp file.
    let lock = fs::OpenOptions::new().create(true).truncate(false).write(true).open(dir.join(format!("{file_stem}.lock")))?;
    lock.lock()?;
    fs::OpenOptions::new().create(true).append(true).open(&path)?.write_all(json.as_bytes())?;

    let text = fs::read_to_string(&path)?;
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() > ROTATE_ABOVE {
        let tmp = dir.join(format!("{file_stem}.jsonl.tmp"));
        fs::write(&tmp, lines[lines.len() - KEEP..].join("\n") + "\n")?;
        fs::rename(&tmp, &path)?;
    }
    Ok(())
}

/// Every line of every `*.jsonl` in `dir`, newest first, at most `limit`. Malformed lines
/// and a missing directory are skipped, not errors.
pub fn read_all(dir: &Path, limit: usize) -> Vec<ActivityLine> {
    let Ok(entries) = fs::read_dir(dir) else { return Vec::new() };
    let mut out: Vec<ActivityLine> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
        .filter_map(|p| fs::read_to_string(p).ok())
        .flat_map(|t| t.lines().filter_map(|l| serde_json::from_str(l).ok()).collect::<Vec<_>>())
        .collect();
    out.sort_by(|a, b| b.ts.cmp(&a.ts));
    out.truncate(limit);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(ts: u64) -> ActivityLine {
        ActivityLine {
            ts,
            repo: Some("/r".into()),
            agent: "claude-code".into(),
            tool: "search_code".into(),
            query: Some("q".into()),
            top: vec![],
            ms: 1,
            error: None,
        }
    }

    #[test]
    fn append_then_read() {
        let d = tempfile::tempdir().unwrap();
        append(d.path(), "a", &line(1)).unwrap();
        append(d.path(), "a", &line(2)).unwrap();
        let all = read_all(d.path(), 10);
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].ts, 2);
    }

    #[test]
    fn rotates_past_600() {
        let d = tempfile::tempdir().unwrap();
        for ts in 0..=600 {
            append(d.path(), "a", &line(ts)).unwrap();
        }
        let text = fs::read_to_string(d.path().join("a.jsonl")).unwrap();
        assert_eq!(text.lines().count(), 500);
        let all = read_all(d.path(), 1000);
        assert_eq!(all[0].ts, 600);
        assert_eq!(all.last().unwrap().ts, 101);
    }

    #[test]
    fn merges_files_and_skips_bad_lines() {
        let d = tempfile::tempdir().unwrap();
        append(d.path(), "a", &line(1)).unwrap();
        append(d.path(), "b", &line(3)).unwrap();
        let mut f = fs::OpenOptions::new().append(true).open(d.path().join("b.jsonl")).unwrap();
        writeln!(f, "not json").unwrap();
        let ts: Vec<u64> = read_all(d.path(), 10).iter().map(|l| l.ts).collect();
        assert_eq!(ts, vec![3, 1]);
    }

    #[test]
    fn concurrent_appends_keep_every_line_whole() {
        let d = tempfile::tempdir().unwrap();
        let handles: Vec<_> = (0..4u64)
            .map(|t| {
                let dir = d.path().to_path_buf();
                std::thread::spawn(move || {
                    for i in 0..200u64 {
                        append(&dir, "a", &line(t * 1000 + i)).unwrap();
                    }
                })
            })
            .collect();
        for h in handles {
            h.join().unwrap();
        }
        let text = fs::read_to_string(d.path().join("a.jsonl")).unwrap();
        let n = text.lines().count();
        assert!((500..=600).contains(&n), "{n} lines");
        assert!(text.lines().all(|l| serde_json::from_str::<ActivityLine>(l).is_ok()));
        // The newest 500 appends overall must all be there: nothing lost to a rotation race.
        assert_eq!(read_all(d.path(), 1000).len(), n);
    }

    #[test]
    fn missing_dir_is_empty() {
        let d = tempfile::tempdir().unwrap();
        assert!(read_all(&d.path().join("nope"), 10).is_empty());
    }

    #[test]
    fn limit_applies() {
        let d = tempfile::tempdir().unwrap();
        for ts in 0..5 {
            append(d.path(), "a", &line(ts)).unwrap();
        }
        assert_eq!(read_all(d.path(), 2).len(), 2);
    }
}
