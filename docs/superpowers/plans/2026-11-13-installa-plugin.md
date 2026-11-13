# Plugin Install From The App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impostazioni → Agenti shows, per agent, whether the Codebase Wiki LLM plugin is installed and current, and installs or updates it after a preview.

**Architecture:** A pure Rust module in `rag-core` plans and applies installs with an injected home dir and command runner. Tauri exposes three commands and keeps a shallow checkout of the plugin repo at the latest tag. The React Agenti section adds a plugin line per agent; Primi passi requires plugin + MCP on one agent.

**Tech Stack:** Rust (rag-core, src-tauri), React + TypeScript, node:test.

**Spec:** `docs/superpowers/specs/2026-11-13-installa-plugin-design.md`

## Global Constraints

- Agent ids are the existing `HarnessRow.id` values: `claude`, `codex`, `antigravity`, `cursor`, `opencode` (no plugin row for Claude Desktop).
- Repo URL `https://github.com/StefanoHernandez/codebase-wiki-llm.git`; ref `main`. Claude Code: marketplace `stefano-wiki`, plugin `codebase-wiki-llm@stefano-wiki`. Codex: marketplace `codebase-wiki-llm`, plugin `codebase-wiki-llm@codebase-wiki-llm`.
- Skill folders for Cursor/OpenCode: `codebase-wiki-llm`, `codebase-wiki-context`, `codebase-wiki-init`, `codebase-wiki-ingest`, `codebase-wiki-sync`, `codebase-wiki-lint`; marker `codebase-wiki-llm/.installed-version`.
- Paths: Antigravity `~/.gemini/config/plugins/codebase-wiki-llm/`; Cursor `~/.cursor/skills/`; OpenCode `$XDG_CONFIG_HOME|~/.config` + `/opencode/skills/`.
- Replace only our folders; old one moved to `<name>.bak`, removed after success, restored on failure.
- Tests never touch the real home or real CLIs (rule 6). Crate versions pinned `=x.y.z`, no new crate unless unavoidable. UI copy Italian. `git add` by name. Nothing pushed, no CI, no release (Stefano says when).

## Review Focus

1. A `claude plugin list --json` entry for another marketplace with the same plugin name — must not count as ours.
2. Folder copy interrupted halfway (e.g. a file not readable) — the previous install comes back from `.bak`.
3. `git ls-remote` offline or failing — rows still show installed versions, actions that need the source are disabled with a reason.
4. Codex CLI present but crashing (`ENOENT` from its wrapper, as on Stefano's Mac) — state "CLI non funzionante" with manual commands, never a stuck spinner.
5. A stale `<name>.bak` left from an earlier crash — replaced, not an error.

---

### Task 1: `plugin_install.rs` — state and version

**Files:** Create `crates/rag-core/src/plugin_install.rs`; modify `crates/rag-core/src/lib.rs` (`pub mod plugin_install;`).

**Produces:**
- `pub trait Runner { fn run(&self, args: &[&str]) -> Result<String, String>; }` (args[0] is the program).
- `pub enum PluginStatus { Missing, Outdated, Current, Unknown }` (serde lowercase); `Unknown` = installed, latest not known.
- `pub struct PluginRow { id: &'static str, installed: Option<String>, latest: Option<String>, status: PluginStatus, skills_only: bool, agent_found: bool, error: Option<String>, manual: Vec<String> }` (serde camelCase).
- `pub fn latest_tag(ls_remote: &str) -> Option<String>` — from `git ls-remote --tags` lines, highest `vX.Y.Z` by numeric compare, `^{}` lines ignored, returned without `v`.
- `pub fn plugin_state(home: &Path, runner: &dyn Runner, latest: Option<&str>) -> Vec<PluginRow>`.

- [ ] **Step 1: Failing tests** (in the module, `tempfile` home, fake runner returning canned stdout per program):
  - `latest_tag("…refs/tags/v0.9.2\n…refs/tags/v0.14.0\n…refs/tags/v0.14.0^{}\n…refs/tags/foo")` → `Some("0.14.0")`.
  - claude JSON `[{"id":"codebase-wiki-llm@other","version":"9.0.0"},{"id":"codebase-wiki-llm@stefano-wiki","version":"0.13.0"}]`, latest `0.14.0` → claude row `installed 0.13.0`, `Outdated`.
  - claude program missing (runner Err "not found") and no `~/.claude` → `agent_found false`.
  - codex `list --json` `{"installed":[{"pluginId":"codebase-wiki-llm@codebase-wiki-llm","version":"0.11.0","enabled":true}],"available":[]}`, latest `0.14.0` → `Outdated`.
  - codex runner Err `spawn … ENOENT` with `~/.codex` present → `agent_found true`, `error` set, `manual` = the two codex commands.
  - antigravity folder with `plugin.json` version `0.14.0` → `Current`; cursor with marker `0.13.0` → `Outdated`, `skills_only true`; opencode absent but `~/.config/opencode` present → `Missing`.
  - latest `None` + installed → `Unknown`.
- [ ] **Step 2:** `cargo test -p rag-core plugin_install` — Expected: FAIL (module missing).
- [ ] **Step 3:** Implement. Claude/Codex parse `list --json` (Codex: object with `installed[]`, match `pluginId == codebase-wiki-llm@codebase-wiki-llm`). Agent found = CLI answered or its config folder exists (`~/.claude`, `~/.codex` / `$CODEX_HOME`, `~/.gemini`, `~/.cursor`, opencode config dir).
- [ ] **Step 4:** `cargo test -p rag-core plugin_install` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(plugin): read installed plugin state per agent`.

### Task 2: preview and apply

**Files:** Modify `crates/rag-core/src/plugin_install.rs`.

**Produces:**
- `pub struct PluginPreview { commands: Vec<String>, folders: Vec<String> }`.
- `pub fn plugin_preview(id: &str, home: &Path, runner: &dyn Runner) -> Result<PluginPreview, String>`.
- `pub fn plugin_apply(id: &str, home: &Path, runner: &dyn Runner, source: Option<&Path>, version: Option<&str>) -> Result<(), String>` — `source` = plugin checkout (required for antigravity/cursor/opencode), `version` written to the marker.

- [ ] **Step 1: Failing tests:**
  - claude preview without `stefano-wiki` on main (runner `plugin marketplace list --json` returns `[]`) → commands `claude plugin marketplace add https://github.com/StefanoHernandez/codebase-wiki-llm.git#main`, `claude plugin install codebase-wiki-llm@stefano-wiki`; with it present on main → `claude plugin marketplace update stefano-wiki`, `claude plugin install …`.
  - codex preview without marketplace `codebase-wiki-llm` (runner `plugin marketplace list` output lacks it) → `codex plugin marketplace add StefanoHernandez/codebase-wiki-llm --ref main`, `codex plugin add codebase-wiki-llm@codebase-wiki-llm`; with it → `codex plugin marketplace upgrade codebase-wiki-llm`, `codex plugin add codebase-wiki-llm@codebase-wiki-llm`.
  - cursor apply from a fake source with the six skill folders → six folders under `home/.cursor/skills/`, marker = version; `home/.cursor/skills/other/` untouched.
  - second apply with an existing install → replaced, no `.bak` left; a pre-existing stale `codebase-wiki-sync.bak` → gone.
  - apply where the source lacks `codebase-wiki-lint` → Err, previous six folders intact (restored from `.bak`).
  - antigravity apply → `home/.gemini/config/plugins/codebase-wiki-llm/plugin.json` from `plugins/antigravity-codebase-wiki-llm/`.
  - claude apply runs exactly the preview commands through the runner (recorded), stops at the first Err and returns it.
- [ ] **Step 2:** run tests — Expected: FAIL.
- [ ] **Step 3:** Implement (recursive copy with `std::fs`; check every source folder exists before touching the target).
- [ ] **Step 4:** `cargo test -p rag-core` — Expected: all PASS.
- [ ] **Step 5: Commit** `feat(plugin): preview and apply plugin installs`.

### Task 3: Tauri commands and plugin source

**Files:** Modify `src-tauri/src/commands.rs`, `src-tauri/src/main.rs`.

**Produces:** commands `plugin_state() -> Vec<PluginRow>`, `plugin_preview(agent) -> PluginPreview`, `plugin_apply(agent) -> ()`; a real `Runner` over `std::process::Command` (PATH as the app sees it; GUI apps on macOS lack the shell PATH — also try `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.npm-global/bin`, like `find_python`).

- [ ] **Step 1:** `latest` = `latest_tag(git ls-remote --tags <repo>)`, cached in managed state for the session; failure → `None`.
- [ ] **Step 2:** source checkout at `<data dir>/plugin-src`: clone `--depth 1 --branch v<latest>` if missing, else `git fetch --depth 1 origin tag v<latest>` + `git checkout v<latest>`; only when an apply needs it.
- [ ] **Step 3:** wire and register; `cargo build -p codebase-wiki-app` — Expected: no warnings; `cargo clippy --workspace` — Expected: 0 warnings.
- [ ] **Step 4: Commit** `feat(plugin): Tauri commands and plugin source checkout`.

### Task 4: UI and first run

**Files:** Modify `src/api.ts`, `src/views/Impostazioni.tsx` (Agenti section), `src/lib/first-run.ts`, `src/views/PrimiPassi.tsx`, `tests/first-run.test.ts`; wiki `wiki/modules/app.md`, `wiki/modules/rag-mcp.md`, `wiki/log.md`.

- [ ] **Step 1: Failing test** `first-run`: `FirstRunState.agent` becomes `{ plugin: boolean; mcp: boolean }[]`; done only when some entry has both; existing cases updated.
- [ ] **Step 2:** `node --test tests/first-run.test.ts` — Expected: FAIL.
- [ ] **Step 3:** implement; Agenti rows get a "Plugin" line with the states/copy of the spec table, buttons "Installa plugin" / "Aggiorna plugin" opening the same preview Dialog as the MCP link (commands as a list, folders as a list), "Copia comandi" for `manual`. Primi passi title "Collega un agente (plugin e ricerca)".
- [ ] **Step 4:** `npm test`, `npm run build`, `cargo test --workspace --features wiki-mcp/embed` — Expected: all pass. Local build `npx tauri build --bundles app` and install in /Applications for Stefano's manual check (Claude Code + Cursor).
- [ ] **Step 5:** wiki sync and commit each file by name — `feat(impostazioni): install and update the plugin per agent`. No push.
