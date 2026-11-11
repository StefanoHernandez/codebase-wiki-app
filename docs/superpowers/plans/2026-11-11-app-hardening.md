# App hardening — safe writes, security, Python, plugin 0.13.0

> **For the implementer (Cursor):** apply the tasks in order, one commit per task, tests first where a task has logic. Claude (Opus) reviews every commit on Stefano's Mac and decides the next step. Stop at the **STOP** marks.

**Goal:** a human action in the app never loses or rewrites text it did not mean to touch, the app cannot be steered outside the opened repo, the validator runs from a Finder launch, and the app reads plugin 0.13.0 through `--json`.

**Why:** an external review, verified on this code, showed that today's actions:
- build their output from the in-memory snapshot (`src/components/TrackerDialogs.tsx:38-90`, `DecisionDialogs.tsx:26-65`, `ReviewDialog.tsx:25-35`), so rows an agent wrote since the last reload are lost;
- re-render whole tables (`src/lib/markdown-tables.ts` `formatTrackerTable`, `replaceSectionTable`), dropping translated headers, extra columns and delimiter alignment;
- do not skip fenced code blocks (`findSectionLines`, `extractTableFromLines`);
- look for `## Approval` in English only (`human-actions.ts` `appendUnderApproval`);
- treat an unreadable log as empty.

Also: `"csp": null`, the wiki folder may be a symlink out of the repo, the app finds Python 3.9 when launched from Finder, and none of `docs/tasks/fixes-round1.md` is applied.

**Branch:** `app/hardening` (created from `integrate/cursor-wave`, which merges the five Cursor branches). Push it after every commit.

## Global constraints

- **Stack:** Tauri v2, React 18, TS (`node --test` with native type stripping), Rust workspace (`crates/wiki-core` pure Rust, never depends on Tauri; `src-tauri` thin commands). Local rustc **1.90**: never run a blanket `cargo update`; pin any new crate to a version that supports 1.90.
- **Commands that must stay green after every task:** `npm test`, `npm run build`, `cargo test --workspace`.
- **Git:**
  - stage files by path. **Never `git add -A` / `git add .`**: the untracked folder `codebase-wiki-app/` (a nested git repo) must not be committed.
  - author email: `172262795+StefanoHernandez@users.noreply.github.com`.
  - never push `main`, never merge, never open a PR.
- **UI and design:**
  - UI text in Italian. Follow `docs/tasks/design.md`: ultramarine (`--human*` tokens) only for human authority.
  - no new npm or cargo dependency unless the task names it.
- **Wikis:** never write a real wiki. Tests use temp copies (`tests/helpers/fixture.ts` → `makeTempRepo()`).
- **When the plan is wrong:** if a step is wrong or does not match the code, do not invent. Write what you found and what you chose in the commit body and in your final message.

## Decisions

| # | Decision | Why |
|---|---|---|
| D1 | Round-1 fixes are applied here, on one branch, not on the five Cursor branches | they are already merged in `integrate/cursor-wave`; one implementer works in sequence |
| D2 | An action is a **transform** `(currentText) => newText`, applied to the file **read from disk at confirm time** | the snapshot can be stale; this is what `docs/tasks/HANDOFF-OPUS.md` §4 already promised |
| D3 | An edit changes **only the lines it means to change**. Other lines stay byte-identical, including the header, the delimiter, other rows, CRLF, BOM and the final newline | whole-table re-rendering loses data |
| D4 | A literal `|` inside backticks still splits a cell (GFM; plugin 0.13.0 decision D6). The app escapes `|` only in cells **it writes** | agreeing with every Markdown renderer and the validator |
| D5 | `generated` is not touched by human status actions | the `## Approval` line or the log entry already records who and when |
| D6 | Dates in log entries: local calendar date, one helper. `verified.at` stays UTC ISO with `Z` | the three actions disagree today |

---

### Task A0: Baseline

```bash
git fetch origin && git switch app/hardening && git pull --ff-only
npm ci && npm test && npm run build && cargo test --workspace
```

Record the totals in the commit body of A1. No commit for A0.

---

### Task A1: Round-1 fixes

Apply every item of `docs/tasks/fixes-round1.md` (sections T7, T8, T9, T10, T12). The rule "only your own files" in that document does not apply here: it was written for five separate branches.

Pay attention to the critical and important ones:
- T9.1: remove `onEngineStop`/`pauseAnimation`;
- T9.4: create `src/views/grafo-helpers.ts`;
- T10.1–3: artifact paths, rust-cache, `npm run build` before cargo in the test job;
- T12.1: `forget()`.

Commit: `fix: round-1 review fixes (T7-T12)`. In the body, list each item as done or skipped, with the reason.

---

### Task A2: Surgical Markdown edits

**Files:**
- Create: `src/lib/md-edit.ts`
- Modify: `src/lib/human-actions.ts` (every action uses `md-edit.ts`)
- Modify: `src/lib/markdown-tables.ts` (parsing stays; delete `formatTracker*Table`/`replaceSectionTable` once unused)
- Test: `tests/md-edit.test.ts` (new), `tests/human-actions.test.ts`

**`md-edit.ts` (pure functions, no React):**

```ts
export interface Doc { lines: string[]; eol: '\n' | '\r\n'; bom: boolean; finalNewline: boolean }
export function parseDoc(text: string): Doc;            // keeps EOL, BOM, final newline
export function renderDoc(doc: Doc): string;            // exact inverse of parseDoc for unchanged docs
export function fenceMask(lines: string[]): boolean[];  // true inside ``` or ~~~ fences (CommonMark: same char, closing length ≥ opening)
export function findSection(doc: Doc, marker: string, headings: string[]): { start: number; end: number } | null;
// heading line `## <h>` (any of `headings`, case-insensitive, trailing spaces ignored) OR the line `<!-- wiki:<marker> -->`
// (then the section starts at the heading just above it); end = next `## ` heading outside fences, or EOF.
export interface TableLoc { header: string[]; headerLine: number; delimLine: number; rows: { line: number; cells: string[] }[] }
export function findTable(doc: Doc, section: { start: number; end: number }): TableLoc | null;  // first header+delimiter outside fences
export function setCells(doc: Doc, row: number, cells: string[]): Doc;   // rewrites ONE line, escaping `|` only in cells it changed
export function insertRow(doc: Doc, afterLine: number, cells: string[]): Doc;
export function removeLine(doc: Doc, line: number): Doc;
export function insertLines(doc: Doc, at: number, lines: string[]): Doc;
```

**Rules:**
- **Rows are found by key, never by position:**
  - Open/Done rows by the `ID` cell;
  - proposals by (proposal text, by, date) as shown in the dialog.

  If the key is not found exactly once, throw `StaleError` (exported class), with Italian message "Il file è cambiato da quando l'hai aperto: ricarico, riprova."
- **Column mapping:**
  - English headers map by name;
  - a translated header (section found by marker) maps the documented columns by position, in documented order;
  - extra columns follow the documented ones and are kept;
  - a new row built for a translated or extended header has the header's length, and its extra cells are empty.
- **Rows with more cells than the header** (an unescaped `|`): the app never rewrites them. Acting on one throws an Italian error naming the ID: "La riga T1 ha una | non protetta: correggila nel file (scrivi \|)".
- **Promote:**
  - insert the new Open row after the last Open row (or after the delimiter);
  - remove the proposal line;
  - next ID = `computeNextTrackerId` (existing).
- **Close ⚫:**
  - remove the Open line;
  - insert the Done row after the Done delimiter, so it becomes the first row;
  - extra values are copied only into same-name Done columns (existing rule).
- **Update field:** `setCells` on that row only.
- **Decisions:**
  - frontmatter `status:` is changed in place: one line;
  - `## Approval` is found by `findSection(doc, 'approval', ['Approval'])`, which also matches `## Approvazione` + marker;
  - the new line goes after the last non-empty line of that section;
  - if the section is missing, throw. With plugin 0.13.0 that wiki has an `upgrade:` line and the action is disabled (A7).
- **`verified` line:**
  - written by replacing or inserting exactly one frontmatter line;
  - the id is `human:<id>` from `personId()`, tightened to `[a-z0-9._-]` (strip other characters, collapse `-`). Example: "Rossi, Mario" → `human:rossi-mario`;
  - throw if the result is empty.

**Regression tests**, one per reported defect, in `tests/md-edit.test.ts` / `tests/human-actions.test.ts`. Each asserts that the other lines are byte-identical (compare `before.split(eol)` and `after.split(eol)` outside the touched lines):
1. Promote with a translated Proposals header (`<!-- wiki:proposals -->`) and one extra column: the extra column and its values survive.
2. Change T2's owner while T1's Evidence holds `` `cmd \| tail` ``: T1's line is unchanged. A second variant has T1 with an unescaped pipe: T2 still edits fine, and editing T1 throws the "| non protetta" error.
3. A fenced example tracker above the real `## Open`: the promoted row lands in the real table, the example is unchanged.
4. `## Approvazione` + `<!-- wiki:approval -->`: accepting appends under it; no second section is created.
5. Delimiter `| :--- | ---: |` is preserved after an edit.
6. A person name with a comma or space gives a valid `human:<id>`.
7. CRLF file and BOM file: edit → same EOL and BOM.
8. `log.md` newest-first: see A3, which owns the log order (oldest-first here; A7 adds `Log order`).

Then run the whole action flow on the fixture: `makeTempRepo()`, apply each action, `runValidator()` has no new finding.

Commit: `fix: edit only the touched lines of wiki files`.

---

### Task A3: Re-read from disk, atomic writes, safe log

**Files:**
- `crates/wiki-core/src/wiki_fs.rs`: new `read_wiki_file_safe` (same confinement as the write; refuses `.private-terms`; errors on unreadable or non-UTF-8, **never returns empty for an error**); `write_wiki_file_safe` writes `<dir>/.<name>.tmp-<pid>` then `fs::rename` over the target.
- `src-tauri/src/commands.rs` + `src-tauri/src/main.rs`: command `read_wiki_file(repo, rel_path)`.
- `src/api.ts`: `readWikiFile`.
- `src/state/project.tsx`: `act()`.
- `src/components/TrackerDialogs.tsx`, `DecisionDialogs.tsx`, `ReviewDialog.tsx`.

**`act()` contract:**

```ts
export interface FileEdit { relPath: string; apply(current: string): string }  // replaces FileWrite
act(edits: FileEdit[]): Promise<void>
```

1. Read every file with `readWikiFile`. Any error → throw, write nothing.
2. Run each `apply(current)`. A `StaleError` or validation error → throw, write nothing, reload.
3. Write in order: content files first, `log.md` last.
4. Reload.

Dialogs build closures that call the pure actions with `current` instead of the snapshot text.

**Log:**
- `appendLogEntry` gains `order: 'oldest-first' | 'newest-first' = 'oldest-first'`. Newest-first inserts the entry above the first `## YYYY-MM-DD` heading outside fences, keeping any intro or `## Rules` block above it.
- A missing log, or one the app cannot read, aborts with "Il log non è leggibile: nessuna modifica scritta."

**Tests:**
- **Rust:**
  - read refuses `.private-terms` and paths outside the wiki;
  - a non-UTF-8 file → Err;
  - the atomic write leaves no `.tmp-` file behind.
- **TS** (fake `api` injected, or pure helper `applyEdits(reads, edits)` exported for testing):
  - a row added to the tracker between snapshot and confirm is still there after promote;
  - an unreadable log → no write;
  - newest-first insertion.

Commit: `fix: apply actions to the file on disk, write atomically`.

---

### Task A4: Handoff lag warnings

The plugin validator 0.13.0 reports these two cases as `info:`, but the person should know before confirming.

**Files:** `src/lib/handoff-lag.ts` (new, pure), with its test; `TrackerDialogs.tsx`.

- `handoffLag(handoff, action)` returns a warning:
  - when promoting while the handoff says `No open work.`;
  - when closing ⚫ an ID that is in the baton.
- The dialog shows the warning (Italian) and a "Copia prompt /wiki-sync" button (`api.workflowPrompt(repo, 'wiki-sync')` + clipboard, as the Handoff view does). It does not block confirmation.

Commit: `feat: warn when an action leaves the handoff behind`.

---

### Task A5: Security

**Files:** `src-tauri/tauri.conf.json`, `crates/wiki-core/src/wiki_fs.rs`, `crates/wiki-core/src/wiki_resolver.rs`, `src/components/Markdown.tsx`.

- **CSP.** Set:

  ```
  default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: asset: http://asset.localhost; font-src 'self' data:; connect-src ipc: http://ipc.localhost
  ```

  Check in `npm run tauri dev` that the devtools console shows no CSP violation and every view works.
- **Remote images.** `Markdown.tsx` renders an image with a remote `src` (`http:`/`https:`) as a plain link with its alt text, not as `<img>`.
- **Confinement.** On open, snapshot, read and write, the canonical wiki directory must be inside the canonical repo; otherwise error "La cartella della wiki punta fuori dal repository." Snapshot walking does not follow symlinked directories, and keeps a symlinked file only if its canonical path is inside the wiki.
- **`.private-terms`.**
  - read with `symlink_metadata` first; a symlink → refuse the write (fail closed): "`.private-terms` è un collegamento simbolico: scrittura rifiutata."
  - the forbidden-term error **never contains the term**: "Il testo contiene un termine vietato da .private-terms."
- **Tests** (Rust, in the existing `mod tests`):
  - wiki symlinked outside the repo;
  - `.private-terms` as a symlink;
  - the error message without the term;
  - a symlinked dir in the wiki pointing outside is not collected.

Commit: `fix: CSP, wiki confinement, private-terms hardening`.

---

### Task A6: Find Python 3.10+

**Files:** `src-tauri/src/commands.rs` (`find_python`), `src/views/Salute.tsx`, the settings popover in `src/components/Shell.tsx`.

- **Pure, testable chooser:**

  ```rust
  fn choose_python(candidates: &[PathBuf], version: impl Fn(&Path) -> Option<(u32, u32)>) -> Option<PathBuf>
  ```

  It returns the first candidate with version ≥ (3, 10).
- **Candidates, in order:**
  1. the path set in settings, if any;
  2. `python3.13`, `python3.12`, `python3.11`, `python3.10`, `python3`, `python` on PATH;
  3. `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, `~/.pyenv/shims/python3`;
  4. on Windows, `py -3` (handle it as a command plus argument).

  The version comes from running `<bin> -c "import sys;print(sys.version_info[0],sys.version_info[1])"`.
- **No more process-wide cache.** Cache per chosen path, and re-choose when the setting changes.
- **Settings.** Field "Percorso di Python (facoltativo)", stored in localStorage `cw.python`, passed to `run_lint` as an optional argument.
- **When none is found,** Salute shows: "Il controllo strutturale richiede Python 3.10 o più recente. Installalo (python.org, oppure `brew install python` su macOS) o indica il percorso nelle impostazioni." This replaces today's generic error.
- **Tests:** `choose_python` with fake candidates (3.9 skipped, 3.11 chosen, nothing → None).

Commit: `fix: find Python 3.10+ outside the shell PATH`.

---

### Task A8: Small fixes from the review

- **Lavori kanban.** Rows whose status is not ⚪ 🟡 🔴 (Open) or 🟢 ⚫ (Done) appear in an "Altro" column with the raw status, instead of disappearing.
- **One date helper.** `src/lib/dates.ts` `todayLocal()` (`YYYY-MM-DD`, local calendar) is used by every action's log entry, including "Segna come rivista". `verified.at` stays `new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')`.
- **`schema-parser.ts`.** It reads `## Excluded paths`, `## Page types` and every other section only outside fenced blocks (reuse `fenceMask` from `md-edit.ts`). Excluded paths come only from table rows or list items whose glob is in backticks. Test: the plugin's `default-schema.md` example blocks produce no glob.

Commit: `fix: show unknown statuses, one date helper, schema parser skips fences`.

**STOP.** Push and report. A7 waits until Claude confirms plugin 0.13.0 is merged.

---

### Task A7: Plugin 0.13.0 alignment (only after Claude's go)

**Files:** `resources/validate-wiki.py`, `crates/wiki-core/src/validator.rs`, `src/api.ts` types, `src/state/project.tsx`, `src/lib/attention.ts`, views.

- **Validator.**
  - Copy `canonical/codebase/scripts/validate-wiki.py` from plugin tag `v0.13.0` byte for byte into `resources/validate-wiki.py`.
  - `validator.rs` runs it with `--json` and deserializes it with `serde`:

    ```rust
    struct Report { validator: String, format: String, wiki: Option<String>, exit: i32, error: Option<String>,
                    findings: Vec<Finding>, upgrades: Vec<Upgrade>, infos: Vec<Info> }
    struct Finding { path: Option<String>, line: Option<u32>, message: String }
    struct Upgrade { path: Option<String>, line: Option<u32>, code: String, message: String, fix: String }
    struct Info    { path: Option<String>, line: Option<u32>, code: String, message: String }
    ```

    The regex parsing of text lines is deleted.
- **Gating by upgrade `code`:**

  | `code` | Effect |
  |---|---|
  | `core-map-missing` | "Wiki non compatibile" screen instead of the six sections, with a "Copia prompt" button for `/wiki-init --adopt <wiki-root>` |
  | `done-status-missing` | close ⚫ disabled, with the reason |
  | `decision-status-missing`, `decision-status-invalid`, `decision-approval-missing` | accept/reject disabled **on that file** |
  | `format-version-newer` | banner "La wiki è più nuova del plugin: aggiorna il plugin" |
  | `format-version-missing`, `format-version-older`, `schema-section-missing`, `decisions-not-folder`, `format-version-invalid` | banner with the list and the adopt prompt, no gating |

- **Infos.** Shown in Salute; the two handoff ones also in Handoff.
- **`Log order`.** Read from SCHEMA `## Project profile` (row `Log order`, values `oldest first` / `newest first`) and passed to `appendLogEntry`.
- **Agent names.** Mirror the validator's `AGENT_NAMES` set in `src/lib/human-actions.ts`. `validateHumanActor` rejects those names and any name containing `/`.
- **Next steps.** `## Next steps` (`<!-- wiki:next -->`) is shown at the top of Lavori and as the first item of Per te.
- **Risk register.** `<!-- wiki:risk-register -->` is a table in Salute. `critical`/`high` rows whose Owner is `unknown` or empty go into Per te.
- **Tests:**
  - the serde parse of a captured `--json` output (`tests/fixtures/validator-0.13.json`);
  - the gating function, a pure `actionsAllowed(upgrades)`;
  - Next steps and risk parsers.

Commit: `feat: read validator 0.13.0 JSON, gate actions by upgrade code`.

---

## Verification (Claude, after each push)

- `npm test`, `npm run build`, `cargo test --workspace`; CI green on macOS, Windows, Linux (after A1 fixed `build.yml`).
- From A3 on, on a temp copy of a v2 wiki: promote, close ⚫, accept a decision, mark reviewed. After that, `git diff` shows only the expected lines plus the log entry, and the validator reports no new finding.
- A6: `npm run tauri build`, then open the `.app` from Finder; Salute runs the validator, or shows the Python message.

## Out of scope

- The local RAG + MCP (separate plan, after this one).
- Moving the nested `codebase-wiki-app/` folder: Stefano decides.
