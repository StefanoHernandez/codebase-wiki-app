# Plugin install from the app — design

Date: 2026-11-13. Status: approved in chat, spec to review.

## Goal

Whoever uses the app also needs the Codebase Wiki LLM plugin in their agent: it is what writes
the wiki. The app shows, for each agent, whether the plugin is there and current, and installs or
updates it with one confirmed action. Success: on a Mac with Claude Code and Cursor and no plugin,
a person opens Impostazioni → Agenti, presses Installa on both, and the next agent session has the
wiki workflows (Claude Code: `/wiki-sync` etc.; Cursor: the wiki skills).

Out of scope: the `secondbrain-wiki-llm` plugin, removing the plugin (the README keeps the
commands), project-scoped installs, Windows paths beyond what `dirs` gives for free.

## 1. Agents and how each one installs

| Agent | Package | Install | Installed version read from |
| --- | --- | --- | --- |
| Claude Code | native plugin, hooks | `claude plugin marketplace add https://github.com/StefanoHernandez/codebase-wiki-llm.git#main` (skipped when `stefano-wiki` exists with ref `main`), then `claude plugin install codebase-wiki-llm@stefano-wiki`; update: `claude plugin marketplace update stefano-wiki` + `claude plugin install …` | `claude plugin list --json`, entry `codebase-wiki-llm@stefano-wiki`, field `version` |
| Codex | native plugin, hooks | `codex plugin marketplace add StefanoHernandez/codebase-wiki-llm --ref main` (skipped when marketplace `codebase-wiki-llm` exists), then `codex plugin add codebase-wiki-llm@codebase-wiki-llm`; update: `codex plugin marketplace upgrade codebase-wiki-llm` + the same `plugin add` (verified on codex-cli 0.169.0) | `codex plugin list --json` → `installed[]` entry with `pluginId` `codebase-wiki-llm@codebase-wiki-llm`, fields `version`, `enabled` (verified) |
| Antigravity | native plugin (rules + skills), no hooks for the change note | copy `plugins/antigravity-codebase-wiki-llm/` to `~/.gemini/config/plugins/codebase-wiki-llm/` | `version` in that folder's `plugin.json` |
| Cursor | skills only, no hooks | copy each `skills/codebase-wiki-*` folder to `~/.cursor/skills/<name>/` | marker file `~/.cursor/skills/codebase-wiki-llm/.installed-version` |
| OpenCode | skills only, no hooks | copy each `skills/codebase-wiki-*` folder to `$XDG_CONFIG_HOME or ~/.config`/`opencode/skills/<name>/` | marker file in `…/opencode/skills/codebase-wiki-llm/.installed-version` |

Skill folders copied for Cursor and OpenCode: `codebase-wiki-llm`, `codebase-wiki-context`,
`codebase-wiki-init`, `codebase-wiki-ingest`, `codebase-wiki-sync`, `codebase-wiki-lint`.

**Source of the files (Antigravity, Cursor, OpenCode):** a shallow git checkout of the plugin
repo kept in `<data dir>/plugin-src/` at the latest `v*` tag (`git ls-remote --tags` → highest
semver; `git clone --depth 1 --branch vX.Y.Z`, or `git fetch` + checkout when it exists). Git is
already required by the app. Claude Code and Codex fetch on their own through their CLI.

**Latest version:** the highest `v*` tag of the plugin repo, read with `git ls-remote` when the
Agenti section opens (cached for the session; offline → "versione più recente non disponibile",
installed versions still shown).

## 2. States and actions

Per agent row, next to the MCP link that exists today:

| State | Shown | Action |
| --- | --- | --- |
| agent not found (no CLI on PATH and no config folder) | "agente non trovato" | none |
| plugin missing | "Plugin: non installato" | **Installa plugin** |
| installed, older than latest | "Plugin: 0.13.0 → 0.14.0" | **Aggiorna plugin** |
| installed, current | "Plugin: 0.14.0 ✓" | none |
| Cursor / OpenCode | adds "solo skill, senza gli avvisi automatici" | as above |
| CLI present but failing (e.g. Codex `ENOENT`) | the error, plus the commands to run by hand with a copy button | **Copia comandi** |

Every install/update first shows a preview, like the MCP link: the exact commands, or the list of
folders that will be created or replaced. Confirm → run → re-read the state. Copies replace only
the plugin's own folders (the names above); nothing else in the agent's folders is touched. A
replaced folder is moved to `<name>.bak` first and deleted only after the copy succeeds.

Primi passi: the step "Collega un agente" becomes "Collega un agente (plugin e ricerca)" and is
done when at least one agent has the plugin installed **and** the MCP link connected.

## 3. Code

- `crates/rag-core/src/plugin_install.rs` (new): pure planning + execution, home directory and
  command runner injected (`trait Runner { fn run(&self, cmd: &[&str]) -> Result<String, String> }`)
  so tests never touch real configs (rule 6) or real CLIs.
  - `plugin_state(home, runner, latest) -> Vec<PluginRow>`
  - `plugin_preview(agent, home, runner) -> PluginPreview { commands: Vec<String>, folders: Vec<PathBuf> }`
  - `plugin_apply(agent, home, runner, source_dir) -> Result<(), String>`
  - `latest_tag(tags_output: &str) -> Option<String>` (semver sort of `refs/tags/v*`).
- `src-tauri/src/commands.rs`: `plugin_state`, `plugin_preview`, `plugin_apply` commands, the
  source checkout under the data dir, real `Runner` over `std::process::Command`.
- `src/views/Impostazioni.tsx` (Agenti section) and `src/lib/first-run.ts` / `PrimiPassi.tsx`.

## 4. Tests

- Rust, temp home: missing → preview lists commands/folders → apply with a fake runner creates
  the Antigravity/Cursor/OpenCode folders and marker; second apply replaces only our folders
  (a sibling `~/.cursor/skills/other/` survives); a failing copy restores the `.bak`.
- Rust: `latest_tag` picks `v0.14.0` over `v0.9.2` and ignores non-`v` tags; Claude list JSON
  parsing; Codex runner error → state "CLI non funzionante" with manual commands.
- TS: first-run step done only with plugin and MCP on the same agent.
- By hand: Claude Code and Cursor on this Mac (Stefano), Codex once its CLI works again.

## Risks

- Codex: commands and JSON checked on codex-cli 0.169.0 (help and `list --json`); the marketplace
  is named `codebase-wiki-llm` (from `.agents/plugins/marketplace.json`), not `stefano-wiki`.
- Agents change their folders: paths live in one table in `plugin_install.rs`.
- Cursor/OpenCode get no hooks, so no "wiki not updated" note: shown in the row.
