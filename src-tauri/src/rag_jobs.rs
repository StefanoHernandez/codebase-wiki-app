use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Emitter};

pub struct RagJobs {
    index: Mutex<HashMap<String, Child>>,
    pull: Mutex<Option<(String, Child)>>,
}

impl RagJobs {
    pub fn new() -> Self {
        Self {
            index: Mutex::new(HashMap::new()),
            pull: Mutex::new(None),
        }
    }

    pub fn index_running(&self, repo: &str) -> bool {
        let mut map = self.index.lock().unwrap();
        if let Some(child) = map.get_mut(repo) {
            match child.try_wait() {
                Ok(None) => return true,
                Ok(Some(_)) => {
                    map.remove(repo);
                }
                Err(_) => return true,
            }
        }
        false
    }

    pub fn start_index(
        self: &Arc<Self>,
        app: AppHandle,
        repo: String,
        bin: &std::path::Path,
    ) -> Result<(), String> {
        if self.index_running(&repo) {
            return Err(wiki_core::tr("Indicizzazione già in corso", "Indexing already in progress"));
        }
        let mut child = spawn_sidecar(bin, &["index", "--repo", &repo, "--json"])?;
        let stdout = child.stdout.take().ok_or("stdout")?;
        let pid = child.id();
        self.index.lock().unwrap().insert(repo.clone(), child);
        let jobs = Arc::clone(self);
        std::thread::spawn(move || read_stdout(app, jobs, repo, pid, stdout, JobKind::Index));
        Ok(())
    }

    pub fn cancel_index(&self, repo: &str) -> Result<(), String> {
        let mut child = self
            .index
            .lock()
            .unwrap()
            .remove(repo)
            .ok_or_else(|| wiki_core::tr("Nessuna indicizzazione in corso per questo repo", "No indexing in progress for this repo"))?;
        let _ = child.kill();
        let _ = child.wait();
        Ok(())
    }

    pub fn any_index_running(&self) -> bool {
        let repos: Vec<String> = self.index.lock().unwrap().keys().cloned().collect();
        repos.iter().any(|r| self.index_running(r))
    }

    pub fn pull_running(&self) -> bool {
        let mut slot = self.pull.lock().unwrap();
        if let Some((_, child)) = slot.as_mut() {
            match child.try_wait() {
                Ok(None) => return true,
                Ok(Some(_)) => {
                    *slot = None;
                }
                Err(_) => return true,
            }
        }
        false
    }

    pub fn start_pull(
        self: &Arc<Self>,
        app: AppHandle,
        model_id: String,
        bin: &std::path::Path,
    ) -> Result<(), String> {
        if self.pull_running() {
            return Err(wiki_core::tr("Download già in corso", "Download already in progress"));
        }
        let mut child = spawn_sidecar(bin, &["models", "pull", &model_id, "--json"])?;
        let stdout = child.stdout.take().ok_or("stdout")?;
        let pid = child.id();
        *self.pull.lock().unwrap() = Some((model_id.clone(), child));
        let jobs = Arc::clone(self);
        std::thread::spawn(move || read_stdout(app, jobs, model_id, pid, stdout, JobKind::Pull));
        Ok(())
    }
}

enum JobKind {
    Index,
    Pull,
}

fn spawn_sidecar(bin: &std::path::Path, args: &[&str]) -> Result<Child, String> {
    let mut cmd = wiki_core::no_window_command(bin);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::inherit());
    cmd.spawn().map_err(|e| e.to_string())
}

/// Forwards every stdout line on `rag://progress`, tagged with `job` ("index"/"pull") and
/// `repo` or `model`, then reaps the child and emits `exit`.
fn read_stdout(
    app: AppHandle,
    jobs: Arc<RagJobs>,
    key: String,
    pid: u32,
    stdout: impl std::io::Read + Send + 'static,
    kind: JobKind,
) {
    let tag = match kind {
        JobKind::Index => ("index", "repo"),
        JobKind::Pull => ("pull", "model"),
    };
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
        let _ = app.emit("rag://progress", enrich_line(tag, &key, &line));
    }
    let code = jobs.reap(&kind, &key, pid);
    let exit = serde_json::json!({"event": "exit", "code": code});
    let _ = app.emit("rag://progress", enrich_line(tag, &key, &exit.to_string()));
}

impl RagJobs {
    /// Removes and waits for the child `pid` only: after a cancel, a new job for the same key
    /// may already be in the slot and must stay there. Returns the exit code, -1 when unknown.
    fn reap(&self, kind: &JobKind, key: &str, pid: u32) -> i32 {
        let child = match kind {
            JobKind::Index => {
                let mut map = self.index.lock().unwrap();
                match map.get(key) {
                    Some(c) if c.id() == pid => map.remove(key),
                    _ => None,
                }
            }
            JobKind::Pull => {
                let mut slot = self.pull.lock().unwrap();
                match slot.as_ref() {
                    Some((_, c)) if c.id() == pid => slot.take().map(|(_, c)| c),
                    _ => None,
                }
            }
        };
        child
            .and_then(|mut c| c.wait().ok())
            .and_then(|s| s.code())
            .unwrap_or(-1)
    }
}

fn enrich_line((job, field): (&str, &str), key: &str, line: &str) -> String {
    let mut v = serde_json::from_str::<Value>(line)
        .ok()
        .filter(Value::is_object)
        .unwrap_or_else(|| serde_json::json!({"raw": line}));
    let obj = v.as_object_mut().expect("object");
    obj.insert("job".into(), Value::String(job.into()));
    obj.insert(field.into(), Value::String(key.into()));
    v.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn sleeper() -> Child {
        Command::new("sleep").arg("30").stdout(Stdio::null()).spawn().expect("sleep")
    }

    #[test]
    fn index_running_detects_live_child_and_cancel_clears_it() {
        let jobs = RagJobs::new();
        jobs.index.lock().unwrap().insert("/repo".into(), sleeper());
        assert!(jobs.index_running("/repo"));
        jobs.cancel_index("/repo").unwrap();
        assert!(!jobs.index_running("/repo"));
    }

    #[test]
    fn reap_leaves_a_newer_job_for_the_same_repo() {
        let jobs = RagJobs::new();
        let newer = sleeper();
        let newer_pid = newer.id();
        jobs.index.lock().unwrap().insert("/repo".into(), newer);
        assert_eq!(jobs.reap(&JobKind::Index, "/repo", newer_pid.wrapping_add(1)), -1);
        assert!(jobs.index_running("/repo"));
        jobs.cancel_index("/repo").unwrap();
    }

    #[test]
    fn enrich_tags_job_and_key() {
        let v: Value = serde_json::from_str(&enrich_line(("pull", "model"), "e5", r#"{"event":"done"}"#)).unwrap();
        assert_eq!(v["job"], "pull");
        assert_eq!(v["model"], "e5");
        let raw: Value = serde_json::from_str(&enrich_line(("index", "repo"), "/r", "boom")).unwrap();
        assert_eq!(raw["raw"], "boom");
    }
}
