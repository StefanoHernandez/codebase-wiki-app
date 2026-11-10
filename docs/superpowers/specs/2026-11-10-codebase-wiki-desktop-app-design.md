# Codebase Wiki Desktop App (`codebase-wiki-app`) — Design Specification

- **Date:** 2026-11-10
- **Repository:** `/home/stefano/Documents/ProgettiPersonali/codebase-wiki-app` (standalone repository, separated from `codebase-wiki-llm`)
- **Target Platforms:** Linux (all distros via `.AppImage`, `.deb`, `.rpm`), Windows (`.msi`/`.exe`), macOS (`.dmg`/`.app`)
- **Chosen Stack:** Tauri v2 (Rust backend) + React 18 / TypeScript / Vite + HTML5 Canvas Force-Graph + Markdown Workbench
- **Development Workflow:** Planning & Code Review by **Gemini 4 Argon**; Task-by-task implementation by **Gemini Flash** subagents.

---

## 1. Intent and Why

**Codebase Wiki LLM** maintains an evidence-backed, structured Markdown wiki (`wiki/` or `.wikidir` target such as `.wiki/`) inside software repositories. While standard Markdown editors like Obsidian can open a wiki folder, they have two structural blind spots:
1. Obsidian ignores hidden folders like `.wiki/` unless opened directly as the vault root, losing visibility of the repository's source tree.
2. Plain Markdown viewers do not understand the **Codebase Wiki v2 contract**: `SCHEMA.md` Core map roles, `sources:` links from wiki pages to real repository files, `source_commit` + Git drift detection, `work-tracker.md` status rules (`T1`, 🟢/🟡/🔴/⚪/⚫), `decisions/` human approval rules (`proposed` → `accepted`), `agent/handoff.md` baton tables, page size budgets, and `validate-wiki.py` structural checks.

**`codebase-wiki-app`** gives developers a dedicated, lightweight Obsidian-style visual environment tailored specifically to the Codebase Wiki LLM contract: combining an interactive **Wiki ↔ Code Graph**, a **Schema-Aware Explorer & Editor**, an **Operational Dashboard (Tracker, Decisions, Handoff, Live Lint)**, and a **Hybrid Reactive Action Engine** (instant zero-token human actions + background CLI Agent Runner with live filesystem watching).

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Open any local Git repository** (resolving the wiki root via `.wikidir` or `wiki/SCHEMA.md` using the exact rules of `resolve-wiki-root.sh`, or offering a graphical `/wiki-init` 7-question wizard if no wiki exists yet).
- **Obsidian-style Interactive Graph ("Wiki ↔ Code"):**
  - Render wiki pages and their linked repository source files (`sources:` frontmatter) + Markdown cross-links (`[...](...)`) in an interactive 2D force-directed HTML5 Canvas graph.
  - Color and style nodes by **Core map role** (`index`, `log`, `tracker`, `decisions`, `risks`, `context`, `handoff`, `troubleshooting`, `glossary`, `topic`, `source-file`) and **Health / Drift state** (`confidence: high|medium|low`, `⚠️ TO RE-VERIFY` / `⚠️ NOT VERIFIED`, and live Git drift when a listed source file has uncommitted or newer committed changes since the wiki page's `source_commit`).
  - Filter graph by node type (Wiki only vs Wiki + Code Sources), role, confidence, and drift status; support **Local Graph** mode (1-hop or 2-hop neighborhood around the active page); click a node to open its page or source file preview.
- **Schema-Aware Explorer & Split-Pane Markdown Workbench:**
  - Left sidebar organized by `SCHEMA.md` **Core map** roles first, followed by **Decisions**, **Topics**, **Log Archives**, and a **Core Read Budget Bar** (`60 KB` default Core Read limit, `20 KB` single page limit).
  - Center/Right split-pane: Markdown editor + rendered preview alongside a **Frontmatter & Evidence Inspector** (showing `type`, `confidence`, `source_commit`, page size vs budget, backlinks, and clickable `sources:` that open a read-only code viewer + `git diff <source_commit>..HEAD -- <path>`).
- **Operational Views & Zero-Token Human Actions:**
  - **Work Tracker View:** Parses `<!-- wiki:open -->`, `<!-- wiki:proposals -->`, and `<!-- wiki:done -->` tables from the mapped `tracker` page. Allows human-authorized deterministic edits:
    - Promote a row from `Proposals` to `Open` (assigning the next never-reused `T<N>` ID across `Open`, `Done`, and `log.md`, with status `⚪` and a `human` entry appended to `log.md`).
    - Explicitly close an `Open` row as human unproven closure (⚫) by prompting for `<person>` and `<what was not proven>`, moving the row to `Done` with Status `⚫`, `Closed: YYYY-MM-DD`, `Criteria met: closed by <person> YYYY-MM-DD; not proven: <what>`, `Evidence: human closure in app`, and appending a `human` entry to `log.md`.
  - **Decisions View:** Lists all decision pages in the mapped `decisions` role (`NNNN-<slug>.md` or legacy `decisions.md`). Provides a 1-click **"Approve Decision (Human)"** action on `status: proposed` pages that prompts for `<person>` and `<where>`, updates frontmatter `status: accepted`, updates `## Approval` with `- accepted: approved by <person> (<where>) on YYYY-MM-DD`, and records a `human` log entry in `log.md`.
  - **Agent Baton & Context View:** Renders `agent/handoff.md` (`<!-- wiki:state -->`, `<!-- wiki:baton -->`, `<!-- wiki:blockers -->`) and `agent/context.md`, plus a staleness badge when `git rev-list --count <last-handoff-commit>..HEAD >= 5`.
  - **Live Structural Validator:** Runs `resources/validate-wiki.py` on demand and automatically on wiki file saves, displaying clickable `file:line: message` findings.
- **Hybrid Agent Runner (Background CLI Execution + Live File Watcher):**
  - Watches `<repo>/<wiki-root>` and `.git` so any edit made by an external terminal agent (`claude`, `codex`, `antigravity`) or inside the app updates the graph, views, and lint status in real time.
  - Allows launching `/wiki-init`, `/wiki-sync`, `/wiki-ingest <target>`, and `/wiki-lint` in background subprocesses using locally installed agent CLIs (`claude` or `codex`) with live streaming output in a bottom drawer, plus a **"Copy Prompt for Agent"** fallback button.

### Non-Goals & Guardrails
- **No SecondBrain support:** Exclusively targets `codebase-wiki-llm`.
- **Wiki-only write guardrail:** The app may only write files inside `<repo>/<wiki-root>/` (plus `<repo>/.wikidir` during init). Repository source code files opened from `sources:` are strictly read-only.
- **Confidentiality (`.private-terms`):** Never index or display `<wiki-root>/.private-terms` in the graph or explorer; block or warn if saving a wiki page would introduce a forbidden term listed in `.private-terms` when `Sensitive data` is `yes`.
