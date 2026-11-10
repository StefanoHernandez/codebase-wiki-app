use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use codebase_wiki_app::{
    build_workflow_prompt, collect_repo_files_recursive, initialize_new_wiki,
    inspect_git_state, load_wiki_snapshot, read_repo_file_safe, resolve_wiki_root,
    run_cli_agent_sync, write_wiki_file_safe, InitWikiRequest, WikiSnapshot,
};
use serde::{Deserialize, Serialize};

struct AppState {
    repo_path: PathBuf,
    resources_dir: PathBuf,
    dist_dir: PathBuf,
}

#[derive(Debug)]
#[allow(dead_code)]
struct HttpRequest {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
}

#[derive(Debug, Deserialize)]
struct OpenRepoRequest {
    #[serde(alias = "repoPath", alias = "repo_path")]
    repo_path: String,
}

#[derive(Debug, Deserialize)]
struct ReadFileRequest {
    #[serde(alias = "relPath", alias = "rel_path")]
    rel_path: String,
    #[serde(alias = "sourceCommit", alias = "source_commit")]
    source_commit: Option<String>,
}

#[derive(Debug, Deserialize)]
struct WriteWikiFileRequest {
    #[serde(alias = "wikiRelPath", alias = "wiki_rel_path")]
    wiki_rel_path: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct HumanActionRequest {
    action: String,
    #[serde(alias = "proposalIndex", alias = "proposal_index")]
    proposal_index: Option<usize>,
    person: Option<String>,
    owner: Option<String>,
    #[serde(alias = "doneWhen", alias = "done_when")]
    done_when: Option<String>,
    #[serde(alias = "nextVerification", alias = "next_verification")]
    next_verification: Option<String>,
    #[serde(alias = "taskId", alias = "task_id")]
    task_id: Option<String>,
    #[serde(alias = "notProvenReason", alias = "not_proven_reason")]
    not_proven_reason: Option<String>,
    #[serde(
        alias = "decisionFile",
        alias = "decision_file",
        alias = "wikiRelPath",
        alias = "wiki_rel_path"
    )]
    decision_file: Option<String>,
    #[serde(alias = "whereContext", alias = "where_context")]
    where_context: Option<String>,
    #[serde(alias = "dateIso", alias = "date_iso")]
    date_iso: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AgentPromptRequest {
    workflow: String,
    target: Option<String>,
    #[serde(alias = "runCli", alias = "run_cli")]
    run_cli: Option<bool>,
    host: Option<String>,
}

fn resolve_resources_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let c1 = exe_dir.join("../../resources");
            if c1.join("validate-wiki.py").is_file() {
                return c1.canonicalize().unwrap_or(c1);
            }
            let c2 = exe_dir.join("resources");
            if c2.join("validate-wiki.py").is_file() {
                return c2.canonicalize().unwrap_or(c2);
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let c3 = cwd.join("resources");
        if c3.join("validate-wiki.py").is_file() {
            return c3.canonicalize().unwrap_or(c3);
        }
    }
    PathBuf::from("resources")
}

fn resolve_dist_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let c1 = exe_dir.join("../../dist");
            if c1.join("index.html").is_file() {
                return c1.canonicalize().unwrap_or(c1);
            }
            let c2 = exe_dir.join("dist");
            if c2.join("index.html").is_file() {
                return c2.canonicalize().unwrap_or(c2);
            }
        }
    }
    if let Ok(cwd) = std::env::current_dir() {
        let c3 = cwd.join("dist");
        if c3.join("index.html").is_file() {
            return c3.canonicalize().unwrap_or(c3);
        }
    }
    PathBuf::from("dist")
}

fn build_current_snapshot(repo_path: &Path, resources_dir: &Path) -> WikiSnapshot {
    let validator_script = resources_dir.join("validate-wiki.py");
    let resolution = resolve_wiki_root(repo_path);
    if let Some(root) = &resolution.wiki_root {
        if repo_path.join(root).is_dir() {
            if let Ok(snapshot) = load_wiki_snapshot(repo_path, root, &validator_script) {
                return snapshot;
            }
        }
    }

    let git_state = inspect_git_state(repo_path, None);
    let mut repo_files = Vec::new();
    collect_repo_files_recursive(repo_path, repo_path, &mut repo_files);
    repo_files.sort();
    repo_files.dedup();

    WikiSnapshot {
        repo_path: repo_path.to_string_lossy().into_owned(),
        wiki_root: None,
        is_initialized: false,
        warning: resolution.warning,
        git_state,
        pages: Vec::new(),
        repo_files,
        changed_files_by_page: BTreeMap::new(),
        lint_report: None,
    }
}

fn compute_mtime_hash(repo_path: &Path) -> u64 {
    let mut hash: u64 = 0;
    let candidates = [
        repo_path.join(".git/HEAD"),
        repo_path.join(".git/index"),
        repo_path.join(".wikidir"),
    ];
    for p in &candidates {
        if let Ok(meta) = fs::metadata(p) {
            if let Ok(mtime) = meta.modified() {
                if let Ok(dur) = mtime.duration_since(UNIX_EPOCH) {
                    hash = hash.wrapping_add(dur.as_millis() as u64);
                }
            }
        }
    }

    let resolution = resolve_wiki_root(repo_path);
    if let Some(root) = resolution.wiki_root {
        let wiki_dir = repo_path.join(root);
        if let Ok(entries) = fs::read_dir(wiki_dir) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(mtime) = meta.modified() {
                        if let Ok(dur) = mtime.duration_since(UNIX_EPOCH) {
                            hash = hash.wrapping_add(dur.as_millis() as u64);
                        }
                    }
                }
            }
        }
    }
    hash
}

fn read_http_request(stream: &mut TcpStream) -> Result<HttpRequest, String> {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| format!("Read line error: {}", e))?;
    if request_line.is_empty() {
        return Err("Empty request".into());
    }

    let parts: Vec<&str> = request_line.trim().split_whitespace().collect();
    if parts.len() < 2 {
        return Err(format!("Malformed request line: {}", request_line));
    }
    let method = parts[0].to_uppercase();
    let full_path = parts[1].to_string();
    let path = full_path
        .split('?')
        .next()
        .unwrap_or(&full_path)
        .to_string();

    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        reader
            .read_line(&mut line)
            .map_err(|e| format!("Header read error: {}", e))?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            headers.insert(k.trim().to_lowercase(), v.trim().to_string());
        }
    }

    let content_length: usize = headers
        .get("content-length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        reader
            .read_exact(&mut body)
            .map_err(|e| format!("Body read error: {}", e))?;
    }

    Ok(HttpRequest {
        method,
        path,
        headers,
        body,
    })
}

fn send_response(stream: &mut TcpStream, status: &str, content_type: &str, body: &[u8]) {
    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nConnection: close\r\n\r\n",
        status,
        content_type,
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(body);
}

fn send_json<T: Serialize>(stream: &mut TcpStream, status: &str, val: &T) {
    let body = serde_json::to_vec(val).unwrap_or_default();
    send_response(stream, status, "application/json; charset=utf-8", &body);
}

fn send_error(stream: &mut TcpStream, status: &str, message: &str) {
    let body = serde_json::to_vec(&serde_json::json!({ "error": message })).unwrap_or_default();
    send_response(stream, status, "application/json; charset=utf-8", &body);
}

fn execute_human_action(
    repo_path: &Path,
    resources_dir: &Path,
    req: &HumanActionRequest,
) -> Result<WikiSnapshot, String> {
    let resolution = resolve_wiki_root(repo_path);
    let wiki_root = resolution
        .wiki_root
        .ok_or_else(|| "Wiki is not initialized".to_string())?;

    let wiki_dir = repo_path.join(&wiki_root);
    let log_path = wiki_dir.join("log.md");
    if !log_path.is_file() {
        return Err("log.md not found in wiki".into());
    }
    let log_markdown = fs::read_to_string(&log_path)
        .map_err(|e| format!("Failed to read log.md: {}", e))?;

    let git_state = inspect_git_state(repo_path, None);
    let short_sha = if git_state.head_sha.is_empty() || git_state.head_sha == "unknown" {
        "initial".to_string()
    } else {
        git_state.head_sha
    };
    let date_iso = req
        .date_iso
        .clone()
        .unwrap_or_else(|| "2026-11-10".to_string());

    let runner_script = resources_dir.join("run-human-action.mjs");
    if !runner_script.is_file() {
        return Err(format!(
            "Runner script not found: {}",
            runner_script.display()
        ));
    }

    let sensitive_data = wiki_dir.join(".private-terms").is_file();

    match req.action.as_str() {
        "promote-proposal" => {
            let tracker_rel = if wiki_dir.join("project/work-tracker.md").is_file() {
                "project/work-tracker.md"
            } else {
                "work-tracker.md"
            };
            let tracker_path = wiki_dir.join(tracker_rel);
            let tracker_markdown = fs::read_to_string(&tracker_path)
                .map_err(|e| format!("Failed to read tracker: {}", e))?;

            let input_val = serde_json::json!({
                "action": "promote-proposal",
                "trackerMarkdown": tracker_markdown,
                "logMarkdown": log_markdown,
                "proposalIndex": req.proposal_index.unwrap_or(0),
                "person": req.person.clone().unwrap_or_default(),
                "owner": req.owner.clone().unwrap_or_default(),
                "doneWhen": req.done_when.clone().unwrap_or_default(),
                "nextVerification": req.next_verification.clone().unwrap_or_default(),
                "dateIso": date_iso,
                "shortSha": short_sha
            });

            let mut child = Command::new("node")
                .arg(&runner_script)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn node: {}", e))?;

            if let Some(mut stdin) = child.stdin.take() {
                let bytes = serde_json::to_vec(&input_val).unwrap();
                stdin
                    .write_all(&bytes)
                    .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            }

            let output = child
                .wait_with_output()
                .map_err(|e| format!("Node process error: {}", e))?;
            if !output.status.success() {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Human action failed: {}", err_msg));
            }

            let res: serde_json::Value = serde_json::from_slice(&output.stdout)
                .map_err(|e| format!("Invalid JSON output from runner: {}", e))?;

            let updated_tracker = res["trackerMarkdown"]
                .as_str()
                .ok_or_else(|| "Missing trackerMarkdown in result".to_string())?;
            let updated_log = res["logMarkdown"]
                .as_str()
                .ok_or_else(|| "Missing logMarkdown in result".to_string())?;

            write_wiki_file_safe(
                repo_path,
                &wiki_root,
                tracker_rel,
                updated_tracker,
                sensitive_data,
            )?;
            write_wiki_file_safe(
                repo_path,
                &wiki_root,
                "log.md",
                updated_log,
                sensitive_data,
            )?;
        }
        "close-unproven" => {
            let tracker_rel = if wiki_dir.join("project/work-tracker.md").is_file() {
                "project/work-tracker.md"
            } else {
                "work-tracker.md"
            };
            let tracker_path = wiki_dir.join(tracker_rel);
            let tracker_markdown = fs::read_to_string(&tracker_path)
                .map_err(|e| format!("Failed to read tracker: {}", e))?;

            let input_val = serde_json::json!({
                "action": "close-unproven",
                "trackerMarkdown": tracker_markdown,
                "logMarkdown": log_markdown,
                "taskId": req.task_id.clone().unwrap_or_default(),
                "person": req.person.clone().unwrap_or_default(),
                "notProvenReason": req.not_proven_reason.clone().unwrap_or_default(),
                "dateIso": date_iso,
                "shortSha": short_sha
            });

            let mut child = Command::new("node")
                .arg(&runner_script)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn node: {}", e))?;

            if let Some(mut stdin) = child.stdin.take() {
                let bytes = serde_json::to_vec(&input_val).unwrap();
                stdin
                    .write_all(&bytes)
                    .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            }

            let output = child
                .wait_with_output()
                .map_err(|e| format!("Node process error: {}", e))?;
            if !output.status.success() {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Human action failed: {}", err_msg));
            }

            let res: serde_json::Value = serde_json::from_slice(&output.stdout)
                .map_err(|e| format!("Invalid JSON output from runner: {}", e))?;

            let updated_tracker = res["trackerMarkdown"]
                .as_str()
                .ok_or_else(|| "Missing trackerMarkdown in result".to_string())?;
            let updated_log = res["logMarkdown"]
                .as_str()
                .ok_or_else(|| "Missing logMarkdown in result".to_string())?;

            write_wiki_file_safe(
                repo_path,
                &wiki_root,
                tracker_rel,
                updated_tracker,
                sensitive_data,
            )?;
            write_wiki_file_safe(
                repo_path,
                &wiki_root,
                "log.md",
                updated_log,
                sensitive_data,
            )?;
        }
        "approve-decision" => {
            let decision_rel = req
                .decision_file
                .as_deref()
                .ok_or_else(|| "decisionFile must be specified".to_string())?;
            let decision_path = wiki_dir.join(decision_rel);
            let decision_markdown = fs::read_to_string(&decision_path)
                .map_err(|e| format!("Failed to read decision file: {}", e))?;

            let input_val = serde_json::json!({
                "action": "approve-decision",
                "decisionMarkdown": decision_markdown,
                "logMarkdown": log_markdown,
                "person": req.person.clone().unwrap_or_default(),
                "whereContext": req.where_context.clone().unwrap_or_default(),
                "dateIso": date_iso,
                "shortSha": short_sha
            });

            let mut child = Command::new("node")
                .arg(&runner_script)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("Failed to spawn node: {}", e))?;

            if let Some(mut stdin) = child.stdin.take() {
                let bytes = serde_json::to_vec(&input_val).unwrap();
                stdin
                    .write_all(&bytes)
                    .map_err(|e| format!("Failed to write to stdin: {}", e))?;
            }

            let output = child
                .wait_with_output()
                .map_err(|e| format!("Node process error: {}", e))?;
            if !output.status.success() {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Human action failed: {}", err_msg));
            }

            let res: serde_json::Value = serde_json::from_slice(&output.stdout)
                .map_err(|e| format!("Invalid JSON output from runner: {}", e))?;

            let updated_decision = res["decisionMarkdown"]
                .as_str()
                .ok_or_else(|| "Missing decisionMarkdown in result".to_string())?;
            let updated_log = res["logMarkdown"]
                .as_str()
                .ok_or_else(|| "Missing logMarkdown in result".to_string())?;

            write_wiki_file_safe(
                repo_path,
                &wiki_root,
                decision_rel,
                updated_decision,
                sensitive_data,
            )?;
            write_wiki_file_safe(
                repo_path,
                &wiki_root,
                "log.md",
                updated_log,
                sensitive_data,
            )?;
        }
        _ => return Err(format!("Unsupported human action: {}", req.action)),
    }

    let validator_script = resources_dir.join("validate-wiki.py");
    load_wiki_snapshot(repo_path, &wiki_root, &validator_script)
}

fn handle_client(
    mut stream: TcpStream,
    app_state: Arc<Mutex<AppState>>,
    sse_clients: Arc<Mutex<Vec<TcpStream>>>,
) {
    let req = match read_http_request(&mut stream) {
        Ok(r) => r,
        Err(_) => return,
    };

    if req.method == "OPTIONS" {
        send_response(&mut stream, "204 No Content", "text/plain", b"");
        return;
    }

    // SSE Endpoint
    if req.method == "GET" && req.path == "/api/events" {
        let headers = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nConnection: keep-alive\r\nAccess-Control-Allow-Origin: *\r\n\r\n: connected\n\n";
        if stream.write_all(headers.as_bytes()).is_ok() {
            if let Ok(cloned) = stream.try_clone() {
                let mut clients = sse_clients.lock().unwrap();
                clients.push(cloned);
            }
        }
        return;
    }

    let (repo_path, resources_dir, dist_dir) = {
        let st = app_state.lock().unwrap();
        (st.repo_path.clone(), st.resources_dir.clone(), st.dist_dir.clone())
    };

    // Static Assets
    if req.method == "GET" {
        if req.path == "/" || req.path == "/index.html" {
            let file_path = dist_dir.join("index.html");
            if let Ok(content) = fs::read(&file_path) {
                send_response(&mut stream, "200 OK", "text/html; charset=utf-8", &content);
                return;
            }
        } else if req.path == "/app.js" {
            let file_path = dist_dir.join("app.js");
            if let Ok(content) = fs::read(&file_path) {
                send_response(
                    &mut stream,
                    "200 OK",
                    "application/javascript; charset=utf-8",
                    &content,
                );
                return;
            }
        } else if req.path == "/styles.css" {
            let file_path = dist_dir.join("styles.css");
            if let Ok(content) = fs::read(&file_path) {
                send_response(&mut stream, "200 OK", "text/css; charset=utf-8", &content);
                return;
            }
        }
    }

    // API Routes
    if req.method == "GET" && req.path == "/api/state" {
        let snapshot = build_current_snapshot(&repo_path, &resources_dir);
        send_json(&mut stream, "200 OK", &snapshot);
        return;
    }

    if req.method == "POST" && req.path == "/api/open-repo" {
        let body: OpenRepoRequest = match serde_json::from_slice(&req.body) {
            Ok(b) => b,
            Err(e) => {
                send_error(&mut stream, "400 Bad Request", &format!("Invalid JSON: {}", e));
                return;
            }
        };

        let new_path = PathBuf::from(&body.repo_path);
        if !new_path.is_dir() {
            send_error(
                &mut stream,
                "400 Bad Request",
                &format!("Directory not found: {}", body.repo_path),
            );
            return;
        }

        {
            let mut st = app_state.lock().unwrap();
            st.repo_path = new_path.clone();
        }

        let snapshot = build_current_snapshot(&new_path, &resources_dir);
        send_json(&mut stream, "200 OK", &snapshot);
        return;
    }

    if req.method == "POST" && req.path == "/api/read-file" {
        let body: ReadFileRequest = match serde_json::from_slice(&req.body) {
            Ok(b) => b,
            Err(e) => {
                send_error(&mut stream, "400 Bad Request", &format!("Invalid JSON: {}", e));
                return;
            }
        };

        match read_repo_file_safe(&repo_path, &body.rel_path, body.source_commit.as_deref()) {
            Ok(payload) => send_json(&mut stream, "200 OK", &payload),
            Err(e) => send_error(&mut stream, "400 Bad Request", &e),
        }
        return;
    }

    if req.method == "POST" && req.path == "/api/write-wiki-file" {
        let body: WriteWikiFileRequest = match serde_json::from_slice(&req.body) {
            Ok(b) => b,
            Err(e) => {
                send_error(&mut stream, "400 Bad Request", &format!("Invalid JSON: {}", e));
                return;
            }
        };

        let resolution = resolve_wiki_root(&repo_path);
        let wiki_root = match resolution.wiki_root {
            Some(r) => r,
            None => {
                send_error(&mut stream, "400 Bad Request", "Wiki is not initialized");
                return;
            }
        };

        let sensitive_data = repo_path.join(&wiki_root).join(".private-terms").is_file();
        if let Err(e) = write_wiki_file_safe(
            &repo_path,
            &wiki_root,
            &body.wiki_rel_path,
            &body.content,
            sensitive_data,
        ) {
            send_error(&mut stream, "400 Bad Request", &e);
            return;
        }

        let validator_script = resources_dir.join("validate-wiki.py");
        match load_wiki_snapshot(&repo_path, &wiki_root, &validator_script) {
            Ok(snapshot) => send_json(&mut stream, "200 OK", &snapshot),
            Err(e) => send_error(&mut stream, "500 Internal Error", &e),
        }
        return;
    }

    if req.method == "POST" && req.path == "/api/init-wiki" {
        let req_init: InitWikiRequest = match serde_json::from_slice(&req.body) {
            Ok(b) => b,
            Err(e) => {
                send_error(
                    &mut stream,
                    "400 Bad Request",
                    &format!("Invalid init request JSON: {}", e),
                );
                return;
            }
        };

        let default_schema_path = resources_dir.join("default-schema.md");
        if let Err(e) = initialize_new_wiki(&repo_path, &req_init, &default_schema_path) {
            send_error(&mut stream, "400 Bad Request", &e);
            return;
        }

        let validator_script = resources_dir.join("validate-wiki.py");
        match load_wiki_snapshot(&repo_path, &req_init.folder, &validator_script) {
            Ok(snapshot) => send_json(&mut stream, "200 OK", &snapshot),
            Err(e) => send_error(&mut stream, "500 Internal Error", &e),
        }
        return;
    }

    if req.method == "POST" && req.path == "/api/human-action" {
        let action_req: HumanActionRequest = match serde_json::from_slice(&req.body) {
            Ok(b) => b,
            Err(e) => {
                send_error(
                    &mut stream,
                    "400 Bad Request",
                    &format!("Invalid human action JSON: {}", e),
                );
                return;
            }
        };

        match execute_human_action(&repo_path, &resources_dir, &action_req) {
            Ok(snapshot) => send_json(&mut stream, "200 OK", &snapshot),
            Err(e) => send_error(&mut stream, "400 Bad Request", &e),
        }
        return;
    }

    if req.method == "POST" && req.path == "/api/agent-prompt" {
        let agent_req: AgentPromptRequest = match serde_json::from_slice(&req.body) {
            Ok(b) => b,
            Err(e) => {
                send_error(&mut stream, "400 Bad Request", &format!("Invalid JSON: {}", e));
                return;
            }
        };

        let workflows_dir = resources_dir.join("workflows");
        let prompt = build_workflow_prompt(
            &agent_req.workflow,
            agent_req.target.as_deref(),
            &workflows_dir,
        )
        .unwrap_or_default();

        let host = agent_req.host.as_deref().unwrap_or("claude");
        let cli_output = if agent_req.run_cli == Some(true) {
            run_cli_agent_sync(&repo_path, host, &prompt).ok()
        } else {
            None
        };

        send_json(
            &mut stream,
            "200 OK",
            &serde_json::json!({
                "prompt": prompt,
                "cliOutput": cli_output
            }),
        );
        return;
    }

    send_error(&mut stream, "404 Not Found", "Endpoint not found");
}

fn main() {
    let mut repo_path = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let mut port: u16 = 4317;
    let mut headless = false;

    let args: Vec<String> = std::env::args().collect();
    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--repo" => {
                if i + 1 < args.len() {
                    repo_path = PathBuf::from(&args[i + 1]);
                    i += 1;
                }
            }
            "--port" => {
                if i + 1 < args.len() {
                    if let Ok(p) = args[i + 1].parse::<u16>() {
                        port = p;
                    }
                    i += 1;
                }
            }
            "--headless" => {
                headless = true;
            }
            _ => {}
        }
        i += 1;
    }

    let resources_dir = resolve_resources_dir();
    let dist_dir = resolve_dist_dir();

    println!("Codebase Wiki Desktop App");
    println!("  Repo: {}", repo_path.display());
    println!("  Resources: {}", resources_dir.display());
    println!("  Dist: {}", dist_dir.display());
    println!("  Port: {}", port);
    println!("  Headless: {}", headless);

    let app_state = Arc::new(Mutex::new(AppState {
        repo_path,
        resources_dir,
        dist_dir,
    }));

    let sse_clients: Arc<Mutex<Vec<TcpStream>>> = Arc::new(Mutex::new(Vec::new()));

    // Background watcher for filesystem changes
    let watcher_state = Arc::clone(&app_state);
    let watcher_clients = Arc::clone(&sse_clients);
    std::thread::spawn(move || {
        let mut last_hash: u64 = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            let repo = {
                let st = watcher_state.lock().unwrap();
                st.repo_path.clone()
            };

            let current_hash = compute_mtime_hash(&repo);
            if last_hash != 0 && current_hash != last_hash {
                let mut clients = watcher_clients.lock().unwrap();
                clients.retain_mut(|client| {
                    client.write_all(b"event: fs-changed\ndata: {}\n\n").is_ok()
                });
            }
            last_hash = current_hash;
        }
    });

    let bind_addr = format!("127.0.0.1:{}", port);
    let listener = match TcpListener::bind(&bind_addr) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("Failed to bind server to {}: {}", bind_addr, e);
            std::process::exit(1);
        }
    };

    println!("Server running at http://{}", bind_addr);

    // Desktop Window Launcher (when not headless)
    if !headless {
        let url = format!("http://127.0.0.1:{}", port);
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let candidates = [
                ("chromium", vec![format!("--app={}", url)]),
                ("google-chrome", vec![format!("--app={}", url)]),
                ("brave", vec![format!("--app={}", url)]),
                ("xdg-open", vec![url.clone()]),
            ];
            for (cmd, args) in candidates {
                if let Ok(mut child) = Command::new(cmd).args(&args).spawn() {
                    let _ = child.wait();
                    return;
                }
            }
        });
    }

    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let state_clone = Arc::clone(&app_state);
                let clients_clone = Arc::clone(&sse_clients);
                std::thread::spawn(move || {
                    handle_client(s, state_clone, clients_clone);
                });
            }
            Err(e) => {
                eprintln!("Connection failed: {}", e);
            }
        }
    }
}
