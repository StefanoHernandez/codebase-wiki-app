---
type: AgentNote
title: Agent Context
description: Facts an agent reads before searching the code
generated: { by: claude-code/claude-opus, at: 2026-11-08T09:00:00Z }
sources:
  - README.md
  - wiki/index.md
  - wiki/SCHEMA.md
source_commit: 3f36e87
confidence: high
---

# Agent Context

## Goals And Non-Goals
<!-- wiki:goals -->
- Goal: keep the fixture wiki valid for the structural validator.
- Non-goal: model a real project.

## Non-Negotiable Rules
<!-- wiki:rules -->
1. Human closure is recorded by a person, never by an agent.

## Frequent Commands
<!-- wiki:commands -->
| Purpose | Command | Verified |
| --- | --- | --- |
| Test | `npm test` | 2026-11-08 @3f36e87 |

## Verified Facts
<!-- wiki:verified-facts -->
Do not re-derive these. Re-check a fact only when its evidence changed or it is
marked `⚠️ TO RE-VERIFY`.

| Fact | Value | Evidence | Verified |
| --- | --- | --- | --- |
| Tracker IDs are never reused | true | `tests/parsers.test.ts` | 2026-11-08 @3f36e87 |

**Errors already corrected, do not reintroduce:** none recorded.

## Read First
<!-- wiki:read-first -->
1. [Index](../index.md)
2. [Work tracker](../project/work-tracker.md)
3. [Agent handoff](handoff.md)
