# Progetti e agenti Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Progetti" view listing every recent repo (attention, index, news, last agent) and a log of what MCP agents searched.

**Architecture:** The MCP server appends one JSON line per tool call to `<data dir>/activity/<repo_id>.jsonl` (module in `rag-core`, shared by server and app). The app stores a "last seen" baseline per recent project and exposes `project_news` and `agent_activity`; the view builds each row in TS from `load_snapshot` + the existing `derive()` + `rag_status`.

**Tech Stack:** Rust (rmcp 3.9.0, serde_json, std only for time), Tauri v2 commands, React + TS, vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-progetti-agenti-design.md`

## Global Constraints

- Rust crates pinned `=x.y.z`; no new crates (time = `SystemTime` epoch ms, no chrono); rustc 1.90.
- UI text Italian; code, comments, commits English.
- No `btn-human` in this view.
- Never `git add -A` / `git add .`.
- Tests never write the real `~/.claude*`, `~/.codex`, `~/.cursor`; data dir in tests via `CODEBASE_WIKI_DATA_DIR` or explicit paths.
- Logging must never change a tool result.

## Rulings against the spec (made while planning)

- `ts` is epoch milliseconds (`u64`), not RFC3339: no date crate in the workspace; TS formats it.
- No "cartella non trovata" row: `list_recent` already drops missing folders (`commands.rs:441`).
- Projects are always git repos (`open_project` refuses others), so "no git" is not a case.
- The baseline is set by a new command `mark_project_seen(repo, logEntries)` that the frontend calls after a project loads, not inside `open_project`: only the frontend knows the Core map log path and log order. `project_news` returns commits only; log-entry news are computed in TS from the snapshot.

## Review Focus

1. Two agent sessions writing the same `.jsonl` at once → lines may interleave but each `append` is one `write_all` of a full line; reader skips malformed lines (test in Task 1).
2. `recent.json` written by 0.3.1 (no new fields) → loads, news empty, no error (test in Task 2).
3. `last_opened_commit` no longer in history (rebase/force-push) → `project_news` returns `commits: null` instead of erroring (test in Task 2).
4. Query with a private term in different case → logged as `[riservata]` (uses `content_has_forbidden_term`, test in Task 1).
5. Activity dir missing (agent never ran) → `agent_activity` returns `[]` (test in Task 1).

---

### Task 1: Activity log module (`rag-core`)

**Files:**
- Create: `crates/rag-core/src/activity.rs`
- Modify: `crates/rag-core/src/lib.rs` (add `pub mod activity;`), `crates/rag-core/src/paths.rs` (add `activity_dir()`)

**Interfaces:**
- Produces:
  ```rust
  #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
  pub struct ActivityLine { pub ts: u64, pub repo: Option<String>, pub agent: String,
      pub tool: String, pub query: Option<String>, pub top: Vec<String>, pub ms: u64,
      pub error: Option<String> }
  pub const PRIVATE_QUERY: &str = "[riservata]";
  pub fn activity_dir() -> PathBuf                     // paths.rs: data_dir().join("activity")
  pub fn append(dir: &Path, file_stem: &str, line: &ActivityLine) -> std::io::Result<()>
  pub fn read_all(dir: &Path, limit: usize) -> Vec<ActivityLine>   // newest first
  pub fn now_ms() -> u64
  ```
- `append` writes `<dir>/<file_stem>.jsonl` (creates dir), one `write_all` of `json + "\n"`; then if the file has more than 600 lines keeps the last 500 (write `<stem>.jsonl.tmp`, rename).

- [ ] **Step 1: Write failing tests** in `activity.rs` `mod tests` (tempfile):
  - `append_then_read`: append 2 lines (ts 1 and 2) → `read_all(dir, 10)` returns 2, first has `ts == 2`.
  - `rotates_past_600`: append 601 lines with ts 0..=600 → file has 500 lines, `read_all(dir, 1000)[0].ts == 600`, last `.ts == 101`.
  - `merges_files_and_skips_bad_lines`: `a.jsonl` with ts 1, `b.jsonl` with ts 3 plus a line `not json` → `read_all` gives ts `[3, 1]`.
  - `missing_dir_is_empty`: `read_all(&dir.join("nope"), 10).is_empty()`.
  - `limit_applies`: 5 lines, `read_all(dir, 2).len() == 2`.
- [ ] **Step 2:** `cargo test -p rag-core activity` → FAIL (module missing).
- [ ] **Step 3:** Implement as in Interfaces. `read_all` reads only `*.jsonl` files, ignores `.tmp`.
- [ ] **Step 4:** `cargo test -p rag-core activity` → PASS; `cargo test -p rag-core` green.
- [ ] **Step 5: Commit** `feat(rag-core): activity log for MCP tool calls`

### Task 2: Log calls in the MCP server

**Files:**
- Modify: `crates/wiki-mcp/src/serve.rs` (tool fns at ~192-220)

**Interfaces:**
- Consumes: Task 1 `ActivityLine`, `append`, `activity_dir`, `now_ms`, `PRIVATE_QUERY`.
- Tool fns gain `ctx: RequestContext<RoleServer>` (rmcp extractor, `rmcp::service::RequestContext`, `rmcp::RoleServer`); agent = `ctx.peer.peer_info().map(|i| i.client_info.name.clone()).unwrap_or("unknown")`.
- New private fn `fn log_call(agent: String, tool: &str, repo: Option<&Path>, query: Option<&str>, started: Instant, result: &Result<String, String>)`:
  - file stem = `repo_id(repo)` or `"_global"`;
  - query → `PRIVATE_QUERY` when `wiki_root(repo)` + `read_private_terms` is `Err` or the query hits `content_has_forbidden_term`; `top` then empty;
  - `top` = first 3 distinct `path` values parsed from the JSON hit lines of an `Ok` search result (skip the header line);
  - `error` = the `Err` text; any `append` error is dropped (`let _ =`).
- `search_inner` stays unchanged; the repo used for logging is `pick_repo(p.repo.as_deref()).ok()`.

- [ ] **Step 1: Write failing test** in a new `#[cfg(test)] mod tests` in `serve.rs`: `top_paths_from_result` — a pure helper `fn top_paths(text: &str) -> Vec<String>` given `"header\n{\"path\":\"a.rs\",...}\n{\"path\":\"a.rs\"}\n{\"path\":\"b.rs\"}"` returns `["a.rs","b.rs"]`; and `private_query_is_masked` — pure helper `fn logged_query(q: &str, terms: Result<Option<String>, String>) -> String`: terms `Ok(Some("Acme"))` + query `"where is acme"` → `"[riservata]"`; `Err(_)` → `"[riservata]"`; `Ok(None)` → query unchanged.
- [ ] **Step 2:** `cargo test -p wiki-mcp` → FAIL.
- [ ] **Step 3:** Implement helpers, `log_call`, and call it from the three tool fns after computing the result.
- [ ] **Step 4:** `cargo test -p wiki-mcp` PASS; `cargo build --release -p wiki-mcp --features embed` OK; manual: run `npx @modelcontextprotocol/inspector <bin> serve --repo .`, call `search_code`, check a line in `~/Library/Application Support/com.codebasewiki.app/rag/activity/`.
- [ ] **Step 5: Commit** `feat(mcp): record each tool call in the activity log`

### Task 3: Last-seen baseline and news commands (`src-tauri`)

**Files:**
- Modify: `src-tauri/src/commands.rs` (`RecentProject` line 27, new commands), `src-tauri/src/main.rs` (register), `crates/wiki-core/src/git_ops.rs` (new fn)

**Interfaces:**
- `RecentProject` gains `#[serde(default)] last_seen_at: Option<u64>, last_seen_commit: Option<String>, last_seen_log_entries: Option<usize>` (camelCase on the wire). `with_recent` keeps these fields of the existing entry when re-adding the same path (opening must not reset the baseline; only `mark_project_seen` does).
- `wiki-core`: `pub fn wiki_commits_since(repo: &Path, since: &str, wiki_rel: &str) -> Option<Vec<String>>` — `git log --format=%s <since>..HEAD -- <wiki_rel>`, max 20; `None` when the commit is unknown or git fails. `pub fn is_ignored(repo: &Path, rel_dir: &str) -> bool` — `git check-ignore -q <rel_dir>/`.
- Commands:
  - `mark_project_seen(app, repo: String, log_entries: Option<usize>) -> Result<(), String>`: sets `last_seen_at = now ms`, `last_seen_commit = HEAD`, `last_seen_log_entries`.
  - `project_news(app, repo: String) -> Result<ProjectNews, String>`; `ProjectNews { commits: Option<Vec<String>>, last_seen_log_entries: Option<usize>, last_seen_at: Option<u64> }`. `commits` is `None` when never seen, wiki ignored by git, or `wiki_commits_since` is `None`.
  - `agent_activity(limit: usize) -> Result<Vec<ActivityLine>, String>` = `activity::read_all(&activity_dir(), limit.min(1000))`.

- [ ] **Step 1: Write failing tests** in `commands.rs` `mod tests` and `git_ops.rs`:
  - `old_recents_json_loads`: `serde_json::from_str::<Vec<RecentProject>>(r#"[{"path":"/p","name":"p"}]"#)` → ok, `last_seen_at == None`.
  - `with_recent_keeps_baseline`: existing entry with `last_seen_commit: Some("abc")`, re-add same path with `None` → result keeps `Some("abc")`.
  - `wiki_commits_since_lists_wiki_only` (tempdir git repo: commit A; commit B touching `wiki/x.md` "wiki change"; commit C touching `src.rs` "code change") → `wiki_commits_since(repo, A, "wiki") == Some(vec!["wiki change"])`.
  - `wiki_commits_since_unknown_commit` → `None` for `"deadbeef"`.
- [ ] **Step 2:** `cargo test --workspace` → new tests FAIL.
- [ ] **Step 3:** Implement; register the three commands in `main.rs`.
- [ ] **Step 4:** `cargo test --workspace` green.
- [ ] **Step 5: Commit** `feat(app): last-seen baseline, project news and agent activity commands`

### Task 4: TS data layer for the overview

**Files:**
- Modify: `src/api.ts`, `src/types/snapshot.ts` (`RecentProject` new optional fields, `ProjectNews`, `ActivityLine`), `src/state/project.tsx` (export `derive` as `deriveProject`; after a successful `open`, call `api.markProjectSeen(path, countLogEntries(...))`)
- Create: `src/lib/overview.ts`, `tests/overview.test.ts`

**Interfaces:**
- `api.markProjectSeen(repo: string, logEntries: number | null): Promise<void>`, `api.projectNews(repo): Promise<ProjectNews>`, `api.agentActivity(limit: number): Promise<ActivityLine[]>`.
- `overview.ts`:
  - `countLogEntries(logMd: string): number` — lines matching `/^## \d{4}-\d{2}-\d{2}\b/m`.
  - `newLogEntries(logMd: string, seen: number | null, order: LogOrder): string[]` — heading titles (text after `## `) beyond `seen`; from the end for `oldest-first`, from the top for `newest-first`; `[]` when `seen` is null.
  - `relativeTime(ms: number, now: number): string` — `"ora"` (<60 s), `"N min fa"`, `"N h fa"`, `"N g fa"`.
  - `interface ProjectRow { path; name; branch; head; attention: number; index: 'aggiornato' | 'indietro' | 'assente' | 'errore'; behindFiles: number; news: string[]; lastAgent: { agent: string; ts: number } | null; error: string | null }`
  - `buildRow(recent: RecentProject, derived: { attention: AttentionItem[]; schema: SchemaConfig | null; pages: { relPath: string; markdown: string }[] } | null, snapshotHead: { branch: string; headSha: string } | null, status: IndexStatus | null, news: ProjectNews | null, activity: ActivityLine[], now: number, error: string | null): ProjectRow` — news = `news.commits` when not null, else `newLogEntries` of the Core map log page; `lastAgent` = newest activity line whose `repo` equals `recent.path`.
  - `lastUseByAgent(activity: ActivityLine[]): Map<string, number>`.
- Reuse `parseIndexStatus` from `src/lib/rag-format.ts` for `IndexStatus`.

- [ ] **Step 1: Write failing tests** in `tests/overview.test.ts`:
  - `countLogEntries` of a log with 3 dated `## ` headings and one `## Notes` → 3.
  - `newLogEntries(md3, 2, 'oldest-first')` → `[third title]`; `'newest-first'` → `[first title]`; `seen null` → `[]`.
  - `relativeTime(now - 5*60_000, now) === '5 min fa'`; 30 s → `'ora'`; 3 days → `'3 g fa'`.
  - `buildRow` with `news.commits = ['a','b']` → `news.length === 2`; with `commits: null` and log page → log titles; activity for two repos → `lastAgent` from the matching repo only; `error` set → row keeps name and error.
- [ ] **Step 2:** `npx vitest run tests/overview.test.ts` → FAIL.
- [ ] **Step 3:** Implement; wire `markProjectSeen` in `open` (log page from `derive` result's schema `coreMap.log`).
- [ ] **Step 4:** `npm test` green, `npm run build` OK.
- [ ] **Step 5: Commit** `feat(ui): overview data helpers and last-seen tracking`

### Task 5: "Progetti" view

**Files:**
- Create: `src/views/Progetti.tsx`, `src/views/progetti.css`
- Modify: `src/views/index.ts` (`'progetti'` first in `SectionId` and `SECTIONS`, label `Progetti`), `src/state/nav.tsx` (initial section: `'progetti'` when `recent.length > 1`, else `'per-te'`), `src/views/Ricerca.tsx` (tile "Agenti (MCP)" at line ~166: add "Ultima chiamata: <agent> <relativeTime>" for this repo and a `btn btn-link` "Vedi attività" → `nav.go('progetti')`)

**Interfaces:**
- Consumes: Task 4 helpers and api; `useProject()` (`recent`, `open`), `rag_harness_state` (`HarnessRow[]`, as in `Ricerca.tsx:74`).
- Loading: rows rendered at once with name; for each recent project sequentially: `api.loadSnapshot` → `deriveProject(snap, null)`, `invoke('rag_status')`, `api.projectNews`; one `api.agentActivity(200)` for all. A failure fills `row.error` only.

Copy (exact):
- title `Progetti`; header button `Apri cartella` (same handler as the existing open-folder action);
- row meta: `${n} per te` · `indice aggiornato` | `indice indietro (${n} file)` | `indice assente` · `${n} novità` | `nessuna novità` · `ultimo agente: ${agent} ${relativeTime}` | `nessun agente`;
- section `Attività degli agenti`, filter select first option `Tutti i progetti`, button `Mostra altre 20`, private query shown as `query riservata`;
- section `Agenti configurati`: `✓ ultimo uso ${relativeTime}` | `✓ mai usato` | `— non collegato` with `btn btn-link` `Collega` → `nav.go('impostazioni')`;
- empty projects: `Apri una cartella con una wiki` + button `Apri cartella`;
- empty activity: `Nessun agente ha ancora cercato: collegane uno dalle Impostazioni`.

Behaviour: row click → `open(path)` then `nav.go('per-te')`; news count is a toggle that shows the list under the row; activity row file click → open that repo, then the existing source preview for that path (same call Ricerca uses for a hit); error line class `error` with the message. Colors: attention count uses the existing badge class, "indietro" the drift class (reuse from `views.css`, no new colors).

- [ ] **Step 1:** Implement view, registry and nav change.
- [ ] **Step 2:** `npm test`, `npm run build` green; `npm run tauri dev`, check by hand with two recent repos: rows load, click opens, news toggle, activity list shows a call made from Task 2's inspector run, empty states (temporarily with a fresh data dir via `CODEBASE_WIKI_DATA_DIR`).
- [ ] **Step 3: Commit** `feat(ui): Progetti view with projects and agent activity`

### Task 6: Wiki sync

**Files:** `wiki/modules/rag-mcp.md` (activity log), the app UI page that lists views, `wiki/log.md`, `wiki/project/work-tracker.md`, `wiki/agent/handoff.md`.

- [ ] **Step 1:** Update pages; run `python3 resources/validate-wiki.py --json wiki` (0 findings) and `python3 /Users/stefano/Documents/Progetti_personali/codebase-wiki-llm/scripts/validate-agent-handoff.py wiki` (pass).
- [ ] **Step 2: Commit** `docs(wiki): Progetti view and agent activity log`
