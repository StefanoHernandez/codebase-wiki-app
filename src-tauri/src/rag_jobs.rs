use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
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
            return Err("Indicizzazione già in corso".into());
        }
        let mut child = spawn_sidecar(bin, &["index", "--repo", &repo, "--json"])?;
        let stdout = child.stdout.take().ok_or("stdout")?;
        self.index.lock().unwrap().insert(repo.clone(), child);
        let jobs = Arc::clone(self);
        std::thread::spawn(move || read_stdout(app, jobs, repo, stdout, JobKind::Index));
        Ok(())
    }

    pub fn cancel_index(&self, repo: &str) -> Result<(), String> {
        let mut child = self
            .index
            .lock()
            .unwrap()
            .remove(repo)
            .ok_or("Nessuna indicizzazione in corso per questo repo")?;
        let _ = child.kill();
        let _ = child.wait();
        Ok(())
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
            return Err("Download già in corso".into());
        }
        let mut child = spawn_sidecar(bin, &["models", "pull", &model_id, "--json"])?;
        let stdout = child.stdout.take().ok_or("stdout")?;
        *self.pull.lock().unwrap() = Some((model_id.clone(), child));
        let jobs = Arc::clone(self);
        std::thread::spawn(move || read_stdout(app, jobs, model_id, stdout, JobKind::Pull));
        Ok(())
    }
}

enum JobKind {
    Index,
    Pull,
}

fn spawn_sidecar(bin: &std::path::Path, args: &[&str]) -> Result<Child, String> {
    let mut cmd = Command::new(bin);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn().map_err(|e| e.to_string())
}

fn read_stdout(
    app: AppHandle,
    jobs: Arc<RagJobs>,
    key: String,
    stdout: impl std::io::Read + Send + 'static,
    kind: JobKind,
) {
    let reader = BufReader::new(stdout);
    for line in reader.lines().map_while(Result::ok) {
        let _ = app.emit("rag://progress", enrich_line(&key, &line));
    }
    let code = reap_child(&jobs, &key, kind);
    let _ = app.emit(
        "rag://progress",
        serde_json::json!({"event":"exit","code":code,"repo":key}).to_string(),
    );
}

fn reap_child(jobs: &RagJobs, key: &str, kind: JobKind) -> i32 {
    match kind {
        JobKind::Index => jobs
            .index
            .lock()
            .unwrap()
            .remove(key)
            .and_then(|mut c| c.wait().ok().map(|s| s.code().unwrap_or(-1)))
            .unwrap_or(-1),
        JobKind::Pull => jobs
            .pull
            .lock()
            .unwrap()
            .take()
            .and_then(|(_, mut c)| c.wait().ok().map(|s| s.code().unwrap_or(-1)))
            .unwrap_or(-1),
    }
}

fn enrich_line(repo: &str, line: &str) -> String {
    match serde_json::from_str::<Value>(line) {
        Ok(mut v) => {
            if let Some(obj) = v.as_object_mut() {
                obj.insert("repo".into(), Value::String(repo.to_string()));
            }
            v.to_string()
        }
        Err(_) => serde_json::json!({"repo": repo, "raw": line}).to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn start_index_refuses_when_already_running() {
        let jobs = Arc::new(RagJobs::new());
        let child = Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .spawn()
            .expect("sleep");
        jobs.index.lock().unwrap().insert("/repo".into(), child);
        assert!(jobs.index_running("/repo"));
    }

    #[test]
    fn index_running_detects_live_child() {
        let jobs = RagJobs::new();
        let child = std::process::Command::new("sleep")
            .arg("30")
            .stdout(Stdio::null())
            .spawn()
            .expect("sleep");
        jobs.index.lock().unwrap().insert("/tmp/r".into(), child);
        assert!(jobs.index_running("/tmp/r"));
        let mut c = jobs.index.lock().unwrap().remove("/tmp/r").unwrap();
        let _ = c.kill();
    }
}
