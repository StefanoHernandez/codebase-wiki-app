# Tracker Dependencies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the tracker's `Depends on` column a defined meaning, check it in the plugin validator, and show ready/waiting on Lavori cards in the app.

**Architecture:** Two repos, plugin first. The plugin (`/Users/stefano/Documents/Progetti_personali/codebase-wiki-llm`) defines the cell, adds three validator errors and the agent rules, released as 0.14.0. The app (`/Users/stefano/Documents/Progetti_personali/codebase-wiki-app`) copies the new validator, parses the column into `dependsOn`, computes readiness in a pure module and renders it on Lavori.

**Tech Stack:** Python 3.10+ stdlib (validator, tests), React + TypeScript (app), node:test.

**Spec:** `docs/superpowers/specs/2026-11-12-tracker-dipendenze-design.md` (app repo)

## Global Constraints

- Header keyword: literal `Depends on`, compared case-insensitive after trim; item IDs match `T[1-9]\d*` after trim; anything else is external; empty cell or `—` = no items.
- Satisfied: ID present in the Done table (🟢 or ⚫). External items are never satisfied.
- Validator messages, exact: `depends on unknown tracker ID T<n>`, `task depends on itself`, `dependency cycle: T1 → T2 → T1`.
- `FORMAT_VERSION` stays `"0.12.0"`; plugin `VERSION` becomes `0.14.0`.
- Plugin: edit `canonical/` only, then regenerate packages (`python3 scripts/generate-codebase-packages.py`, `python3 scripts/generate-host-packages.py`); the four `validate-wiki.py` copies stay byte-identical.
- App: `resources/validate-wiki.py` is replaced, never edited (rule 5). Never `git add -A` / `git add .`. UI copy Italian, code/commits English. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Merge to `main`, tags and releases only with Stefano's ok (both repos). The plugin repo has untracked `SPEC.md` and `.gitattributes`: leave them alone.

## Review Focus

1. A `Depends on` cell with markdown around an ID (`[T17](#t17)`, `` `T17` ``) — treated as external, not an error; the card shows it as text.
2. A Done-table `Depends on` that cites an ID only in Open — valid (existence only).
3. A three-task cycle (T1 → T2 → T3 → T1) — reported once, not three times.
4. A dependency on a task that is open but whose own row is malformed (IDs unreadable) — no dependency findings at all (existing readability guard).
5. Translated tracker (marker-mapped columns) with an extra `Depends on` column — recognised by header text, not by position.

---

### Task 1 (plugin): validator checks

**Files:**
- Modify: `canonical/codebase/scripts/validate-wiki.py` (`tracker()`, ~line 563)
- Test: `scripts/test-wiki-validator.py` (new `dependency_cases()`, registered in `run()` next to `translated_extra_column()`)

**Interfaces:**
- Produces: the three messages above, as `self.error(page.path, line, msg)` on the row's line.

- [ ] **Step 1: Branch** `git switch -c feat/tracker-deps` in the plugin repo.
- [ ] **Step 2: Write `dependency_cases()`**, built like `translated_extra_column()`: `fixture(repo)`, `current_schema(wiki)`, append ` Depends on |` / ` --- |` / ` <cell> |` to the Open table's header, delimiter and T1 row; add extra open rows where needed. Cases (name, cells, expected exit, required, forbidden):

| Case | Setup | Exit | Required in stderr | Forbidden |
| --- | --- | --- | --- | --- |
| deps external text accepted | T1: `distribution received` | 0 | — | `depends on` |
| deps empty and dash | T1: `—` | 0 | — | `depends on` |
| deps unknown ID | T1: `T99` | 1 | `depends on unknown tracker ID T99` | — |
| deps self | T1: `T1` | 1 | `task depends on itself` | — |
| deps two-task cycle | T1: `T2`; T2 row 🟡 with `T1` | 1 | `dependency cycle: T1 → T2 → T1` | — |
| deps three-task cycle once | T1→T2, T2→T3, T3→T1 | 1 | `dependency cycle: T1 → T2 → T3 → T1` (count == 1) | — |
| deps on done ID | T2 in Done (🟢), T1: `T2, TRR` | 0 | — | `depends on` |
| deps markdown ID is external | T1: `` `T99` `` | 0 | — | `unknown tracker ID` |
| deps column in Done | Done row with `Depends on` = `T1` | 0 | — | `depends on` |
| deps translated tracker | `fixture(repo, localized=True)`, extra header `Depends on`, T1: `T99` | 1 | `depends on unknown tracker ID T99` | — |

- [ ] **Step 3: Run** `python3 scripts/test-wiki-validator.py 2>&1 | grep deps` — Expected: the error cases FAIL, accepted cases PASS.
- [ ] **Step 4: Implement in `tracker()`**: while reading each Open/Done row, if a header cell `.strip().lower() == "depends on"`, split that cell on `,`, keep `(line, id, [items matching T\d+])` per row (open rows separately). After the loop, inside the existing `if open_readable and ids_readable:` guard: unknown IDs (not in `ids`), self on open rows, cycles by DFS over open rows in table order with edges only to open IDs; record each cycle once by its node set; message starts at the first row of the cycle in table order.
- [ ] **Step 5: Run** `python3 scripts/test-wiki-validator.py` — Expected: all PASS, no FAIL lines.
- [ ] **Step 6: Commit** `git add canonical/codebase/scripts/validate-wiki.py scripts/test-wiki-validator.py` — `feat(validator): check tracker Depends on IDs and cycles`.

### Task 2 (plugin): rules, packages, release 0.14.0

**Files:**
- Modify: `canonical/codebase/references/work-tracker-template.md` (Rules), `canonical/codebase/workflows/wiki-sync.md` (step 3, Next steps sentence), `canonical/codebase/references/agent-handoff-template.md` (Rules)
- Modify for the version: `canonical/codebase/VERSION`, `VERSION` constant in the validator, `.claude-plugin/marketplace.json`, the three `plugins/*/plugin.json`, `README.md` (every `0.13.1` that names the current release), `docs/release-checklist.md` (new `## 0.14.0 tracker dependencies` section)
- Regenerated: everything `generate-*-packages.py` writes

- [ ] **Step 1: Template rule** — replace the `Depends on` mention with a bullet: cell = comma-separated `T<n>` IDs and/or external conditions in free text; header stays `Depends on` in translated tables; an ID is satisfied when it is in Done (🟢 or ⚫), an external condition when whoever verified it removes it; a task is ready when all items are satisfied; add a dependency only when work order matters.
- [ ] **Step 2: wiki-sync + handoff rule** — Next steps and baton list ready tasks first; a step on a task that is not ready says what it waits for (`T29 — waits for T17`).
- [ ] **Step 3: Version** to `0.14.0` in the files above; `FORMAT_VERSION` unchanged.
- [ ] **Step 4: Regenerate** `python3 scripts/generate-codebase-packages.py && python3 scripts/generate-host-packages.py`; check the four validator copies: `shasum canonical/codebase/scripts/validate-wiki.py plugins/*/skills/*/scripts/validate-wiki.py skills/codebase-wiki-llm/scripts/validate-wiki.py` — Expected: one hash.
- [ ] **Step 5: Full suite** `PATH="$PWD/.venv/bin:$PATH" bash scripts/run-tests.sh` (create `.venv` with Python ≥3.10 if missing) — Expected: exit 0.
- [ ] **Step 6: Versal check** — `python3 canonical/codebase/scripts/validate-wiki.py "/Users/stefano/Downloads/versal-container-platform-main 2/docs"` before/after on a copy — Expected: no `depends on` / `dependency cycle` lines; other output unchanged from 0.13.1.
- [ ] **Step 7: Commit** each file by name — `feat: define tracker dependencies (0.14.0)`. Push the branch; merge, tag `v0.14.0` and release only on Stefano's ok.

### Task 3 (app): validator copy and parser

**Files:**
- Replace: `resources/validate-wiki.py` (copy of the plugin's canonical 0.14.0)
- Modify: `src/types/wiki.ts` (`TrackerOpenRow`, `TrackerDoneRow`), `src/lib/markdown-tables.ts` (`parseTrackerMarkdown`, rows built ~lines 225–250)
- Test: `tests/parsers.test.ts`

**Interfaces:**
- Produces: `dependsOn: { ids: string[]; external: string[] }` on every open and done row; `parseDependsOn(cell: string): { ids: string[]; external: string[] }` exported from `markdown-tables.ts`.

- [ ] **Step 1: Copy** `cp <plugin>/canonical/codebase/scripts/validate-wiki.py resources/validate-wiki.py`; `cmp` both — Expected: identical.
- [ ] **Step 2: Failing tests** in `tests/parsers.test.ts`:
  - `parseDependsOn('T17, distribution received')` → `{ ids: ['T17'], external: ['distribution received'] }`
  - `parseDependsOn('—')` and `parseDependsOn('')` → `{ ids: [], external: [] }`
  - `parseDependsOn('`T9`')` → `{ ids: [], external: ['`T9`'] }`
  - a tracker with header `| … | depends ON |` and cell `T2` → `open[0].dependsOn.ids` is `['T2']`, and `extra['depends ON']` is still `'T2'`
  - a tracker without the column → `dependsOn` is `{ ids: [], external: [] }`
- [ ] **Step 3: Run** `node --test tests/parsers.test.ts` — Expected: FAIL (`parseDependsOn` not exported).
- [ ] **Step 4: Implement** `parseDependsOn` and fill `dependsOn` from the `extra` entry whose key matches `depends on` (trim, lower-case).
- [ ] **Step 5: Run** `npm test` — Expected: all pass.
- [ ] **Step 6: Commit** `git add resources/validate-wiki.py src/types/wiki.ts src/lib/markdown-tables.ts tests/parsers.test.ts` — `feat(tracker): parse Depends on; validator 0.14.0`.

### Task 4 (app): readiness and Lavori

**Files:**
- Create: `src/lib/dependencies.ts`, `tests/dependencies.test.ts`
- Modify: `src/views/Lavori.tsx` (open card; `extras()` skips `depends on`), `src/lib/labels.ts` (`'depends on': 'Dipende da'`), `tests/labels.test.ts`
- Wiki: `wiki/modules/app.md`, `wiki/log.md`, `wiki/agent/handoff.md`

**Interfaces:**
- Consumes: `TrackerData` with `dependsOn` (Task 3).
- Produces: `taskReadiness(tracker: TrackerData): Map<string, { ready: boolean; waitingOn: string[]; external: string[] }>`.

- [ ] **Step 1: Failing tests** `tests/dependencies.test.ts` on a tracker with Open T1 (`T2, T3`), T4 (`T5, TRR`), T6 (no column value), T7 (`T99`); Done T2 🟢, T3 ⚫:
  - T1 → `{ ready: true, waitingOn: [], external: [] }`
  - T4 (T5 open) → `{ ready: false, waitingOn: ['T5'], external: ['TRR'] }`
  - T6 → `{ ready: true, waitingOn: [], external: [] }`
  - T7 → `{ ready: false, waitingOn: ['T99'], external: [] }`
  - labels: `fieldLabel('Depends on')` → `'Dipende da'`
- [ ] **Step 2: Run** `node --test tests/dependencies.test.ts tests/labels.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `taskReadiness` and the label.
- [ ] **Step 4: Lavori** — under the open card title: if the row has items and is ready, `<span className="badge badge-ok">Pronto</span>`; if not ready, "Aspetta " + each waiting ID as a `btn btn-link` calling `nav.go('lavori', id)` + external items joined with ` · `; nothing when the row has no items. `extras()` skips the `depends on` header.
- [ ] **Step 5: Verify** `npm test` and `npm run build` — Expected: all pass, build ok. `python3 resources/validate-wiki.py --json wiki` — Expected: exit 0.
- [ ] **Step 6: Wiki sync** — `modules/app.md` (`lib/dependencies.ts` in sources and one line under Lavori), log entry, handoff goal/last step.
- [ ] **Step 7: Commit** each file by name — `feat(lavori): show ready and waiting tasks from Depends on`. Merge only on Stefano's ok.
