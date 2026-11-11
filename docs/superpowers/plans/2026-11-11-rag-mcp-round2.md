# RAG + MCP — round 2: finish the app side

> **For the implementer (Cursor):** this is the review of B8–B12 on `feat/rag-mcp`. Apply the tasks in order, one commit per task, tests first where a task has logic, push after each commit. Do not stop between tasks; Claude reviews everything at the end. The global constraints of `2026-11-11-rag-mcp.md` still apply (rustc 1.90, `=x.y.z` pins, stage by path, never `git add -A`, noreply author, never main/merge/PR, UI in Italian, no real harness config in tests).

**Start from `7985ae3` or later.** Claude already fixed the core in that commit, so **do not touch** `crates/rag-core/src/{store,files,catalog}.rs` or `crates/wiki-mcp/src/{run,serve,main}.rs`, except where a task below names them.

## The binary interface (from 7985ae3)

The app talks to the sidecar only through this interface.

| Command | stdout |
|---|---|
| `status --repo P` | One JSON object: `{repo, repo_id, model, index_path, head, indexed, indexed_head, indexed_model, files, chunks, changed_since_index, error}`. It never creates or changes the index. `indexed: false` plus `error` means there is no usable index; `error` is the message to show. |
| `index --repo P --json` | JSON lines `phase` / `progress` / `done` / `error` (see the main plan). The exit code is non-zero on error. |
| `search --repo P [--wiki] [-k N] [--glob G] --json "query"` | One JSON object per hit: `{path, start_line, end_line, source, score, snippet}`. On failure, one `{"event":"error","message":…}` line and exit 1. `--wiki` searches the wiki **plus** README and docs (all prose); without it, only code. |
| `models list --json` | `{installed:[id], catalog:[{id, dims, size_mb, languages, note, tested, installed}]}` |
| `models pull <id> --json` | `download` lines, then `{"event":"done","model":id}` or an `error` line. |
| `models search <q> --json` | HF hits (B12). |

Error lines are always valid JSON. Human text goes to stderr.

---

### Task R1: Sidecar processes (commands.rs)

- **One indexer per repo.** Keep a `HashMap<repo, Child>`. `rag_index_start` refuses with `Indicizzazione già in corso` when a child for that repo is alive (`try_wait()` returns `None`). `rag_index_cancel(repo)` kills that child, then waits for it.
- **Reaping and exit.** The reader thread, after stdout EOF:
  - calls `wait()` on the child;
  - removes it from the map;
  - emits `rag://progress` with `{"event":"exit","code":N,"repo":…}`.

  If the child crashes without an `error` line, the UI still leaves the indexing state. Every forwarded event carries `repo`.
- **`rag_model_pull(id)`:** same pattern (one at a time), `models pull <id> --json`, forwarded on `rag://progress`.
- **No work on the main thread.**
  - `rag_status`, `rag_models` and `rag_preview` become `async` and run in `blocking()`, as the rest of `commands.rs` does.
  - `rag_preview` passes `--json` and parses the hit lines. A non-zero exit becomes an `Err` that carries the `error` message.
  - `rag_status` runs `status --repo P` and returns the parsed JSON. Delete any rag-core DB reading in the app: `status` is the single reader.
- **Windows:** every sidecar spawn sets `CREATE_NO_WINDOW` (`std::os::windows::process::CommandExt`, `0x08000000`).

**Tests:** a Rust unit test for the "already running" refusal, using a fake long-running child (`sleep`/`timeout`) behind a small helper that takes the command.

### Task R2: Sidecar install (rag_sidecar.rs, main.rs)

- `install_mcp_binary` runs in `std::thread::spawn` from `setup`, so it never blocks the window.
- **Install order:** copy to `bin_path().part`, `chmod 755` the `.part` (unix), then `rename`.
- **On Windows, if the rename fails** because a harness is running `serve`: keep the old binary and record `stale_install: true`. `rag_status` reports it, and Ricerca shows `Chiudi gli agenti collegati e riapri l'app per aggiornare il server MCP.`
- Compare versions with `--version` output equality, as today.

### Task R3: Ricerca view, finishing B9

- **Index state:**
  - Show the `status` JSON as `Modello · N file · M chunk · indicizzato a @abc · HEAD @def · K file cambiati`.
  - Show `error` when `indexed` is false.
  - Show a real progress bar per phase (`<progress>`, `wiki` then `code`).
  - `Annulla` is visible while running. An `error` event shows the message and leaves the indexing state; so does `exit`.
- **State survives navigation:** keep the indexing and download state in a small store (context or module) keyed by repo, not in `Ricerca`'s `useState`. Leaving and re-entering the view must show the running job.
- **Modello:**
  - Render the catalog from `rag_models()` (the `models list --json` data). Delete the hard-coded list.
  - Each row shows name, languages, size, note and `non provato` when `tested` is false.
  - The button is `Scarica` (it runs `rag_model_pull`, with a progress bar) or `Usa questo`; the active model is marked.
  - Before switching to a model whose id differs from `indexed_model`, confirm: `L'indice verrà ricostruito con il nuovo modello.`
  - On first run, with no config, preselect `multilingual-e5-small`.
- **Prova una ricerca:**
  - A real `Codice | Documentazione` segmented toggle, not a checkbox.
  - Results show `path:start-end` and the snippet in a `<pre>`. A result under the wiki root opens in the existing `SidePanel`.
  - Errors are shown.
- **Auto-index:**
  - A setting `Indicizza automaticamente` (localStorage, default on).
  - When a project opens, and after about 5 s without watcher events, run `index` if **an index already exists** (`indexed: true`) and `changed_since_index > 0` or `head != indexed_head`.
  - Never on first use, never while a job runs, never a download.
- Delete developer-facing copy such as "prossima iterazione".
- Keep Grafo's keyboard shortcut: put Ricerca **after** Grafo in `SECTIONS`, or check that the shortcut list in `CommandPalette` still matches.

**Tests (node):**
- the progress reducer handles `exit` and `error`;
- the auto-index decision is a pure function `shouldAutoIndex(status, running, setting)`, tested with a table of cases.

### Task R4: Collega agli agenti, finishing B10

**Rust (`rag_core::harness`, testable with a temp HOME):**
- Every write function: read the file. A read error other than NotFound → `Err`, and nothing is written. Copy to `<file>.bak` (an error aborts), then write temp + rename.
- Codex: `codex_connect` / `codex_disconnect`, using `CODEX_HOME` when set.
- Cursor: `cursor_connect` / `cursor_disconnect` on `~/.cursor/mcp.json`. A missing file or a file without `mcpServers` gets that key created; invalid JSON is refused.
  Cursor runs global servers with the workspace as cwd? If you cannot verify it, use the global file and say so in the UI hint: `Se Cursor non trova il repo, aggiungi "--repo", "${workspaceFolder}" negli args.`
- Claude Code: `claude_command(bin) -> String`, which builds `claude mcp add-json --scope user codebase-wiki '<json>'`. Run it only when the person clicks `Esegui` in the confirm dialog and `claude` is on PATH; otherwise show it with `Copia`. `Scollega`: `claude mcp remove --scope user codebase-wiki`.
- Antigravity: show the JSON block with `Copia`, plus a one-line hint (`Incollalo in Manage MCP servers → View raw config`).
- `harness_state()` returns, for each harness, `connected` (an entry exists and its command equals the current `bin_path()`), `outdated` (the entry exists with another path) or `absent`.

**Tauri commands:**
- `rag_harness_state()`;
- `rag_harness_preview(harness, action)` returns `{path, before, after}` without writing;
- `rag_harness_apply(harness, action)` writes, and must only be called after the dialog's confirm.

**UI:** a card `Collega agli agenti` with one row per harness: name, status dot, and `Collega` / `Scollega` / `Aggiorna`. Every write opens a dialog with the file path and a before/after diff (reuse an existing diff or `<pre>` pair), and `Conferma` / `Annulla`. Buttons use `btn` / `btn-primary`, never `btn-human`.

**Tests:**
- Codex keeps a comment and an unrelated table, and disconnect removes only our table;
- Cursor creates `mcpServers` in `{}` and keeps other servers;
- invalid JSON or an unreadable file is refused and the file is unchanged;
- `.bak` exists after apply;
- `harness_state` reports `outdated` for another path.

### Task R5: Hugging Face models, finishing B12

- Add `rag_models_search(q)` → `models search <q> --json` (UI button `Cerca su Hugging Face` under the catalog, results with downloads).
- **Install a custom model:** `models add <hf_repo> --json` in wiki-mcp (you may edit `main.rs` for this subcommand only, plus `rag-core/src/models.rs`).
  - Fetch `config.json` and, if present, `1_Pooling/config.json` / `sentence_bert_config.json`.
  - Infer `dims` (`hidden_size`) and pooling (`pooling_mode_cls_token` → Cls, else Mean).
  - Pick the ONNX file: `onnx/model_quantized.onnx`, then `onnx/model.onnx`, then `model.onnx`.
  - Save the spec to `<data>/models/<id>/spec.json`, with `tested: false` and no prefixes. A spec that cannot be inferred is refused with a clear message.
  - `model_by_id` and `models list` also read installed custom specs. This means a small change in `catalog.rs` (returning owned or leaked specs is fine); keep the static list unchanged.
- **Tests:** spec inference from fixture JSONs (cls, mean, missing hidden_size → error).

### Task R6: Leftovers

- `models.rs pull`:
  - set ureq timeouts (connect 15 s, read 60 s);
  - delete `.complete` **before** a re-pull starts;
  - check the downloaded size against `Content-Length` when present.
- `harness.rs` codex test: assert the unrelated table is still there.
- Clippy clean on `-p rag-core -p wiki-mcp -F wiki-mcp/embed`: the unused imports in `models.rs` and `paths.rs`, the loop counter in `rag_sidecar.rs`.

## Final message

List:
- the commits per task;
- the test totals (`npm test`, `npm run build`, `cargo test --workspace`, `cargo test -p rag-core -F embed,download`);
- every deviation, with its reason;
- what you could not verify (the Cursor cwd and the Antigravity path).
