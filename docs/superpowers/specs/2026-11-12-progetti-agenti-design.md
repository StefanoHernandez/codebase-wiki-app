# Progetti e agenti — design

Date: 2026-11-12. Status: approved in chat (data and view), spec to review.

## Goal

One place to see every Codebase Wiki project on this machine and what agents did with them:
what waits for a person in each repo, whether its search index is current, what changed in the
wiki since the last visit, and which agent searched what. Success: Stefano opens the app and,
without opening each repo, knows which project needs him and whether agents are actually using
`search_code`.

Out of scope: aggregate statistics, sharing activity between machines, the Python validator per
repo (lint findings are not counted in the overview).

## 1. MCP activity log (`crates/wiki-mcp/src/serve.rs`)

- Every call to `search_code`, `index_status` and `list_repos` appends one JSON line to
  `<data dir>/activity/<repo_id>.jsonl` (`rag_core::paths::data_dir()`, same `repo_id` as the
  index). `list_repos` has no repo: it goes to `<data dir>/activity/_global.jsonl`.
- Line: `{"ts": RFC3339 UTC, "repo": canonical repo path or null, "agent": MCP client name or
  "unknown", "tool": name, "query": text or null, "top": up to 3 repo-relative paths,
  "ms": duration, "error": message or null}`.
- `agent` comes from the client info the peer sent at initialize (rmcp `peer_info()`); the
  tool functions get the peer through rmcp's request context.
- A query containing a `.private-terms` term (same `content_has_forbidden_term` check) is
  written as `"[riservata]"`, and its `top` is empty. An unreadable `.private-terms` also
  writes `"[riservata]"` (fail-closed).
- Rotation: when the file passes 600 lines, keep the last 500 (rewrite via temp file + rename).
- Any I/O error while logging is ignored: the tool result never changes because of the log.

## 2. News since the last visit

- `RecentProject` gains `last_opened_at: Option<String>` (RFC3339),
  `last_opened_commit: Option<String>` and `last_opened_log_entries` (below), all
  `#[serde(default)]` so the old `recent.json` loads.
- `open_project` sets all three before returning (the commit is the repo HEAD, or none outside git).
- New command `project_news(repo) -> Vec<NewsItem>`; `NewsItem { kind: "commit" | "log", text }`:
  - tracked wiki with `last_opened_commit`: subjects of `git log <commit>..HEAD -- <wiki root>`,
    at most 20;
  - otherwise (gitignored wiki, no git, or commit unknown): log entries added since the last
    open. Log headings carry only a day (`## 2026-11-12 · title · agent`), so dates cannot
    separate two entries of the same day: `RecentProject` also stores
    `last_opened_log_entries: Option<usize>` (count of `## ` headings in the Core map log page),
    and the news are the entries beyond that count, taken from the end of the log, or from the
    top when the Project profile says `Log order: newest first`;
  - never opened: empty list (nothing to compare against).
- News reset when the project is opened, because `open_project` moves the baseline.

## 3. Overview data

No new aggregate Rust command: the view builds each row from commands that already exist.
For each recent project, one at a time, in the background:

- `load_snapshot(repo)` → wiki found or not, compatible or not, `computeAttention()` with
  `lintFindings: []` → "per te" count;
- `rag_status(repo)` → index current / behind (N files) / missing;
- `project_news(repo)` → news count and list;
- last agent activity for that repo from `agent_activity` (below).

A repo whose folder no longer exists shows "cartella non trovata" with "Rimuovi"
(`remove_recent`). A failed snapshot shows the error on that row; other rows still load.

New command `agent_activity(limit) -> Vec<ActivityLine>`: reads every
`<data dir>/activity/*.jsonl`, skips malformed lines, sorts by `ts` descending, returns the first
`limit` (the view asks for 200 and pages 20 at a time on screen).

## 4. The "Progetti" view

- New first sidebar item "Progetti", above "Per te". At startup the app shows Progetti when
  there is more than one recent project; with one it opens it on "Per te" as today.
- The repo selector at the top of the sidebar stays.

```
Progetti                                              [+ Apri cartella]

  codebase-wiki-app     main @36f9599                                  ›
  3 per te · indice aggiornato · 2 novità · ultimo agente: claude-code 5 min fa

  versal-test           main @65cd050                                  ›
  1 per te · indice indietro (4 file) · nessuna novità · nessun agente

  vecchio-repo          cartella non trovata              [Rimuovi]

Attività degli agenti                         [Tutti i progetti ▾]
  23:41  claude-code  codebase-wiki-app  search_code
         "graph builder wiki pages source files"  → src/lib/graph-builder.ts
  23:30  claude-code  codebase-wiki-app  index_status
  ── mostra altre 20 ──

Agenti configurati
  Claude Code ✓ ultimo uso 5 min fa · Codex ✓ mai usato · Cursor — non collegato
```

- Project row: click opens the project on "Per te". "N per te" uses the existing badge blue;
  "indice indietro" uses the drift orange. The news count expands in place to its list.
- Activity: last 20 calls, filter by project; a returned file opens the existing source
  preview for that repo; an error call is red with its message; "[riservata]" shows no text.
- Configured agents: `rag_harness_state()` plus last use per agent from the activity lines;
  "Collega" goes to Impostazioni.
- Empty states: no projects → "Apri una cartella con una wiki" + button; no activity →
  "Nessun agente ha ancora cercato: collegane uno dalle Impostazioni".
- Ricerca: the "Agenti (MCP)" tile also shows this repo's last call and links to Progetti.
- UI text in Italian; no `btn-human` in this view (no human-authority action).

## 5. Tests

- Rust (`wiki-mcp`): line written with the right fields; rotation 600 → 500; private term →
  "[riservata]"; unwritable dir does not fail the tool.
- Rust (`src-tauri`): old `recent.json` without the new fields loads; `project_news` on a temp
  git repo (commit touching the wiki after the baseline is listed, one outside it is not);
  log-date fallback.
- Rust: `agent_activity` merges files, skips a malformed line, sorts newest first.
- TS: building a project row from snapshot/status/news/activity; relative time; empty states.
- Manual: a real agent session calls `search_code`, the call appears in Progetti.
