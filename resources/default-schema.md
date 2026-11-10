---
type: Schema
title: Wiki Schema
description: Repo-specific conventions that wiki workflows must follow.
generated: { by: <host>/<model>, at: <ISO 8601 UTC> }
confidence: high
---

# Wiki Schema for This Repo

This file is the repo-specific constitution for the wiki. Edit it when the
repository needs different conventions. Wiki workflows must read this file
before editing wiki content.

## Mission

This wiki keeps shared context between the people and the agents working on
this repository, a log of what was done with its evidence, and the decisions
taken and why. Everything else is an optional topic listed in `## Topics`.

## Truth hierarchy

1. Source code, tests, configs, CI, runtime manifests, command output.
2. Topic pages (`## Topics`).
3. `tracker`, `decisions`, `risks` (Core map).
4. `context`, `handoff`, `log`.

A page must not contradict a higher level. When it does, fix the lower page.
Level 1 tells what the system does now, not what it should do: code can hold a bug.

## Project profile

| Setting | Value |
| --- | --- |
| Language | English (headings and prose; fixed tokens in Conventions) |
| Project division | none (phases/WP · releases · sprints/milestones · none) |
| Sensitive data | no |
| Agent entry file | none (CLAUDE.md · AGENTS.md · none) |

## Core map

Every workflow finds the core pages through this table. Paths are relative to
the wiki root. Change a path here to relocate a page.
`log-archive` reserves a directory created on the first archive write; an
empty archive directory is not required at init or adoption.

| Role | Path |
| --- | --- |
| index | `index.md` |
| log | `log.md` |
| log-archive | `log/` |
| tracker | `project/work-tracker.md` |
| decisions | `project/decisions/` |
| risks | `project/risks.md` |
| context | `agent/context.md` |
| handoff | `agent/handoff.md` |
| troubleshooting | `troubleshooting.md` |
| glossary | `glossary.md` |

## Conventions

- Activity IDs: prefix `T`, stable, never reused; status lives only in the
  tracker.
- Status: 🟢 done and verified · ⚫ closed by a person without proven criteria
  · 🟡 in progress · ⚪ to do · 🔴 blocked.
- Terminal tracker rows carry `Status`: 🟢 requires every `Done when`
  criterion to be proven; ⚫ requires explicit human closure recorded as
  `closed by <person> YYYY-MM-DD; not proven: <what>` in `Criteria met`,
  with the closure source in `Evidence`. Never infer closure authority.
- Dates: `YYYY-MM-DD`.
- The `tracker` is the only source of status; external tools are linked, never copied as status.

## Budgets

| Budget | Default |
| --- | --- |
| Single page | 20 KB |
| Core read at a new context (agent entry file, SCHEMA, index, context, handoff, tracker, risks, troubleshooting, glossary, last 10 log entries) | 60 KB |
| log | 30 KB |

## Log format

```markdown
## YYYY-MM-DD · <title> · human | agent
- What: <what was done>
- Evidence: `<command>` → <essential output> @<short-sha>[+local]   (or `> ⚠️ NOT VERIFIED - <reason>`)
- IDs: T12, T13
```

## Topics

| Topic | Path | What belongs there |
| --- | --- | --- |
| architecture | `architecture.md` | components, boundaries, data/control flow, invariants |

## Page frontmatter

| Page | Default `type` |
| --- | --- |
| `overview.md`, `overview-<project-slug>.md` | `Overview` |
| `engineering/*` | `Engineering` |
| `modules/*` | `Module` |
| `project/*` | `Project` |
| `project-docs/*` | `ProjectDoc` |
| `agent/*` | `AgentNote` |
| `SCHEMA.md` | `Schema` |
| `glossary.md` | `Glossary` |

## What this repo is about

Replace this section during `/wiki-init` with one concise paragraph describing
the repository.
