---
type: Project
title: Work Tracker
description: Status of the fixture project work
generated: { by: claude-code/claude-opus, at: 2026-11-08T09:00:00Z }
sources:
  - wiki/log.md
  - wiki/agent/handoff.md
  - README.md
source_commit: 3f36e87
confidence: high
---

# Work Tracker

Only source of status. IDs (`T1`, `T2`, …) are stable and never reused. Other
pages cite IDs without repeating their status. Status icons: see SCHEMA.md
`## Conventions`. External issues and PRs are linked, never copied as status.

## Open
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Build the tracker parser | Parser tests pass | stefano | `npm test` | `tests/parsers.test.ts` |
| T2 | 🔴 | Refresh the handoff after the watcher change | Handoff source commit matches HEAD | stefano | `git log -1 --oneline` | ⚠️ NOT VERIFIED - waiting for the watcher fix |

## Proposals
<!-- wiki:proposals -->

Ideas and suggested work nobody approved yet: no ID, no status icon.

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Add a phase filter to the work view | stefano | 2026-11-09 | Phases are listed in the tracker |
| Export accepted decisions to a file | stefano | 2026-11-09 | Reviews happen outside the app |

## Done
<!-- wiki:done -->

| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
| T3 | 🟢 | Create the project wiki | 2026-11-08 | Validator exits 0 on the fixture | commit 3f36e87 |
