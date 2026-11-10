# Global constraints (bind every task)

Project: rewrite of `codebase-wiki-app` as a Tauri v2 + React 18 + TypeScript + Vite desktop **control panel for a person** over wikis written in the Codebase Wiki LLM plugin format (plugin source: `/Users/stefano/Documents/Progetti_personali/codebase-wiki-llm`, templates in `canonical/codebase/references/`, schema in `canonical/codebase/default-schema.md`). Branch `rewrite/tauri-v2`. Cross-platform: Windows, macOS, Linux.

## Architecture (fixed)
- Cargo workspace at repo root: `crates/wiki-core` (pure Rust lib: resolver, git, guarded fs, validator, watcher) and `src-tauri` (Tauri v2 app; thin `#[tauri::command]`s over wiki-core). A future `crates/wiki-mcp` will reuse wiki-core: keep wiki-core free of any Tauri dependency.
- Frontend in `src/`: `src/lib/` pure TS (no React, no Tauri imports, testable with `node --test`), `src/api.ts` the ONLY module that imports `@tauri-apps/api`, `src/views/`, `src/components/`, `src/state/`.
- Rust returns raw data (wiki file contents, git state, drift per page, lint). TS parses markdown and computes derived state.
- A human action = pure TS function (old text → new text) in `src/lib/human-actions.ts`, then `write_wiki_file` via api.ts, plus a `log.md` entry.

## Plugin format rules (exact)
- Status icons: 🟢 done and verified · ⚫ closed by a person without proven criteria · 🟡 in progress · ⚪ to do · 🔴 blocked.
- Tracker sections located by markers `<!-- wiki:open -->`, `<!-- wiki:proposals -->`, `<!-- wiki:done -->` on the line under the heading (heading text may be translated).
- Promote: next ID `T<N>` never reused (scan Open, Done and log), new Open row status ⚪.
- Close ⚫: `Criteria met` = `closed by <person> YYYY-MM-DD; not proven: <what>`; `Evidence` cites the human closure source.
- Decision files `NNNN-<slug>.md` with frontmatter `status: proposed | accepted | rejected | superseded by NNNN`. Accept/reject only from `proposed`. `## Approval` gets the accepted/rejected line appended; the existing "proposed" line is preserved.
- `verified:` frontmatter is `{ by, at }` or a list; human actor `human:<id>`; timestamps ISO 8601 with `Z`; optional `commit: <sha>`. Trust tiers: no verified = unverified; only non-human = machine-confirmed; any `human:` = human-reviewed; verified but sources changed since = stale verified.
- Handoff stale when its `source_commit` is ≥ 5 commits behind HEAD.
- Budgets default: page 20 KB, core read 60 KB, log 30 KB (overridable in SCHEMA `## Budgets`).
- Log entry format: `## YYYY-MM-DD · <title> · human` then `- What:`, `- Evidence:`, `- IDs:` lines.
- Agents/app never write `.private-terms`; writes confined to the wiki root; app never makes git commits in the user's repos.

## Process
- Never modify real wikis in other repos; tests that write use temp copies.
- Python: `resources/validate-wiki.py` is stdlib-only; no venv needed. Any new Python dependency → `.venv` in repo.
- npm deps local to the project (no global installs).
- Tests: `npm test` (node --test on `tests/*.test.ts`) and `cargo test --workspace`.
