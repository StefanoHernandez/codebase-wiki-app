---
type: AgentNote
title: Agent Handoff
description: Where the next coding agent starts
generated: { by: claude-code/claude-opus, at: 2026-11-08T09:00:00Z }
sources:
  - wiki/SCHEMA.md
  - wiki/log.md
  - wiki/project/work-tracker.md
  - README.md
source_commit: 3f36e87
confidence: high
---

# Agent Handoff

## Current Work State
<!-- wiki:state -->

- Tracker IDs: T1, T2
- Goal: finish the parser tests
- Last completed step: validator passes on the fixture
- Current branch: `main`
- Last commit: `3f36e87`
- Worktree: clean

## Baton For Next Coding Agent
<!-- wiki:baton -->

| Order | Task | Start files | Done when | Verification command | Notes / blockers |
| --- | --- | --- | --- | --- | --- |
| 1 | T1 - Finish the parser tests | `tests/parsers.test.ts` | Parser tests pass | `npm test` | none |

## Blockers
<!-- wiki:blockers -->

| Blocker | Type | Needed from | Current workaround |
| --- | --- | --- | --- |
| Watcher fix for T2 | external | stefano | none |

## Known Risks
<!-- wiki:risks -->

| Risk | Impact | Mitigation | Evidence |
| --- | --- | --- | --- |
| Stale handoff after many commits | Wrong start point | Refresh at five commits | `wiki/project/risks.md` |

## Commands Already Run
<!-- wiki:commands-run -->

| Command | Directory | Result | Evidence / notes |
| --- | --- | --- | --- |
| `python3 resources/validate-wiki.py wiki` | repository root | pass @3f36e87 | structure only |

## Do Not Redo
<!-- wiki:do-not-redo -->

- Wiki bootstrap (T3) is done and recorded in `wiki/log.md`.

## Evidence Trail
<!-- wiki:evidence-trail -->

- `log` page: latest entries in `wiki/log.md`
- `tracker` page: IDs of the open work, `wiki/project/work-tracker.md`
- `decisions` folder: `wiki/project/decisions/0001-use-tauri.md`
