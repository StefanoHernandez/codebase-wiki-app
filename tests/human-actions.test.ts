import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseTrackerMarkdown, parseHandoffMarkdown, computeNextTrackerId } from '../src/lib/markdown-tables.ts';
import { promoteProposalToOpen, closeTrackerItemHumanUnproven, approveDecisionHuman } from '../src/lib/human-actions.ts';

const SAMPLE_TRACKER = `---
type: Project
title: Work Tracker
description: Status tracker
generated: { by: codex/gpt-5, at: 2026-11-10T09:00:00Z }
sources:
  - wiki/log.md
source_commit: a1b2c3d
confidence: high
---

# Work Tracker

## Compiti Aperti
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Build parser | Tests pass | stefano | \`node --test\` | \`tests/parsers.test.ts\` |

## Proposte
<!-- wiki:proposals -->

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Add graph filter | stefano | 2026-11-10 | Faster debugging |

## Completati
<!-- wiki:done -->

| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
| T4 | 🟢 | Initial setup | 2026-11-09 | \`git status\` clean | commit a1b2c3d |
`;

const SAMPLE_LOG = `---
title: Wiki Log
sources:
  - README.md
source_commit: a1b2c3d
confidence: high
generated: { by: codex/gpt-5, at: 2026-11-10T09:00:00Z }
---

# Log

## 2026-11-09 · Archive old task · human
- What: Closed legacy task
- Evidence: manual review @a1b2c3d
- IDs: T7
`;

test('parseTrackerMarkdown supports translated headings via wiki markers and computeNextTrackerId scans Open, Done, and Log', () => {
  const data = parseTrackerMarkdown(SAMPLE_TRACKER);
  assert.equal(data.open.length, 1);
  assert.equal(data.open[0].id, 'T1');
  assert.equal(data.proposals.length, 1);
  assert.equal(data.proposals[0].proposal, 'Add graph filter');
  assert.equal(data.done.length, 1);
  assert.equal(data.done[0].id, 'T4');

  const nextId = computeNextTrackerId(SAMPLE_TRACKER, SAMPLE_LOG);
  assert.equal(nextId, 'T8');
});

test('promoteProposalToOpen assigns next never-reused T<N>, adds Open row with ⚪, removes proposal, and appends human log', () => {
  const res = promoteProposalToOpen({
    trackerMarkdown: SAMPLE_TRACKER,
    logMarkdown: SAMPLE_LOG,
    proposalIndex: 0,
    person: 'Stefano',
    owner: 'Stefano',
    doneWhen: 'Filter toggles source nodes',
    nextVerification: 'node --test',
    dateIso: '2026-11-10',
    shortSha: 'b2c3d4e',
  });
  assert.equal(res.assignedId, 'T8');
  const parsed = parseTrackerMarkdown(res.trackerMarkdown);
  assert.equal(parsed.proposals.length, 0);
  assert.equal(parsed.open.length, 2);
  assert.equal(parsed.open[1].id, 'T8');
  assert.equal(parsed.open[1].status, '⚪');
  assert.match(res.logMarkdown, /## 2026-11-10 · Promote proposal to T8 · human/);
});

test('closeTrackerItemHumanUnproven enforces human authority and formats ⚫ row to match validate-wiki.py', () => {
  assert.throws(() => {
    closeTrackerItemHumanUnproven({
      trackerMarkdown: SAMPLE_TRACKER,
      logMarkdown: SAMPLE_LOG,
      taskId: 'T1',
      person: 'coding agent',
      notProvenReason: 'skipped',
      dateIso: '2026-11-10',
      shortSha: 'b2c3d4e',
    });
  }, /human/i);

  const res = closeTrackerItemHumanUnproven({
    trackerMarkdown: SAMPLE_TRACKER,
    logMarkdown: SAMPLE_LOG,
    taskId: 'T1',
    person: 'Stefano',
    notProvenReason: 'superseded by direct parser',
    dateIso: '2026-11-10',
    shortSha: 'b2c3d4e',
  });
  const parsed = parseTrackerMarkdown(res.trackerMarkdown);
  assert.equal(parsed.open.length, 0);
  assert.equal(parsed.done.length, 2);
  const closedRow = parsed.done.find((r) => r.id === 'T1')!;
  assert.equal(closedRow.status, '⚫');
  assert.equal(closedRow.closed, '2026-11-10');
  assert.equal(closedRow.criteriaMet, 'closed by Stefano 2026-11-10; not proven: superseded by direct parser');
  assert.match(res.logMarkdown, /## 2026-11-10 · Close T1 without proof · human/);
});

test('approveDecisionHuman updates status to accepted, rewrites ## Approval, and appends human log', () => {
  const decisionMd = `---
type: Decision
title: 0002 - Use Canvas Graph
description: Render graph in 2D canvas
status: proposed
generated: { by: codex/gpt-5, at: 2026-11-10T09:00:00Z }
sources:
  - README.md
source_commit: a1b2c3d
confidence: high
---

# 0002 - Use Canvas Graph

## Context
Need smooth rendering on Linux Wayland.

## Decision
Use HTML5 2D Canvas force graph.

## Alternatives rejected
- WebGL: Wayland driver glitches.

## Consequences
Fast rendering.

## Approval
proposed: codex on 2026-11-10.
`;

  const res = approveDecisionHuman({
    decisionMarkdown: decisionMd,
    logMarkdown: SAMPLE_LOG,
    person: 'Stefano',
    whereContext: 'Codebase Wiki Desktop App',
    dateIso: '2026-11-10',
    shortSha: 'b2c3d4e',
  });
  assert.match(res.decisionMarkdown, /status: accepted/);
  assert.match(res.decisionMarkdown, /accepted: approved by Stefano \(Codebase Wiki Desktop App\) on 2026-11-10/);
  assert.match(res.logMarkdown, /## 2026-11-10 · Approve decision 0002 - Use Canvas Graph · human/);
});

test('parseHandoffMarkdown parses state bullets, baton rows, and blockers', () => {
  const handoffMd = `---
type: AgentNote
title: Agent Handoff
sources:
  - wiki/SCHEMA.md
source_commit: a1b2c3d
confidence: high
generated: { by: codex/gpt-5, at: 2026-11-10T09:00:00Z }
---
# Agent Handoff

## Current Work State
<!-- wiki:state -->
- Tracker IDs: T1
- Goal: Build app
- Current branch: \`main\`

## Baton For Next Coding Agent
<!-- wiki:baton -->
| Order | Task | Start files | Done when | Verification command | Notes / blockers |
| --- | --- | --- | --- | --- | --- |
| 1 | T1 - Implement parser | \`src/lib/frontmatter.ts\` | Tests pass | \`node --test\` | none |

## Blockers
<!-- wiki:blockers -->
| Blocker | Type | Needed from | Current workaround |
| --- | --- | --- | --- |
| none | external | none | none |
`;
  const parsed = parseHandoffMarkdown(handoffMd);
  assert.equal(parsed.stateBullets['Tracker IDs'], 'T1');
  assert.equal(parsed.baton.length, 1);
  assert.equal(parsed.baton[0].task, 'T1 - Implement parser');
  assert.equal(parsed.noOpenWork, false);
});

test('integration: mutated wiki files pass validate-wiki.py exit code 0', () => {
  const tempDir = fs.mkdtempSync(path.join('/tmp', 'wiki-test-'));
  try {
    // Initialize git repo in tempDir so validate-wiki.py resolves repo root
    execFileSync('git', ['init', tempDir]);
    const wikiDir = path.join(tempDir, 'wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.mkdirSync(path.join(wikiDir, 'project'), { recursive: true });
    fs.mkdirSync(path.join(wikiDir, 'project', 'decisions'), { recursive: true });
    fs.mkdirSync(path.join(wikiDir, 'agent'), { recursive: true });

    // Create dummy README.md for repo-relative sources
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Repo\n');

    // Create SCHEMA.md with Core map
    const schemaContent = `---
type: Schema
title: Wiki Schema
confidence: high
updated: 2026-11-10
---

# Wiki Schema

## Core map
| Role | Path |
| --- | --- |
| index | \`index.md\` |
| log | \`log.md\` |
| log-archive | \`log/\` |
| tracker | \`project/work-tracker.md\` |
| decisions | \`project/decisions/\` |
| risks | \`project/risks.md\` |
| context | \`agent/context.md\` |
| handoff | \`agent/handoff.md\` |
| troubleshooting | \`troubleshooting.md\` |
| glossary | \`glossary.md\` |
`;
    fs.writeFileSync(path.join(wikiDir, 'SCHEMA.md'), schemaContent);

    // Create other required core pages
    fs.writeFileSync(
      path.join(wikiDir, 'index.md'),
      `---
type: Overview
title: Wiki Index
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Wiki Index
Welcome to the wiki.
`
    );

    fs.writeFileSync(
      path.join(wikiDir, 'project', 'risks.md'),
      `---
type: Project
title: Risks
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Risks
None.
`
    );

    fs.writeFileSync(
      path.join(wikiDir, 'agent', 'context.md'),
      `---
type: AgentNote
title: Agent Context
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Context

## Goals And Non-Goals
<!-- wiki:goals -->
Goals.

## Non-Negotiable Rules
<!-- wiki:rules -->
Rules.

## Frequent Commands
<!-- wiki:commands -->
Commands.

## Verified Facts
<!-- wiki:verified-facts -->
Facts.

## Read First
<!-- wiki:read-first -->
Read.
`
    );

    fs.writeFileSync(
      path.join(wikiDir, 'troubleshooting.md'),
      `---
type: Guide
title: Troubleshooting
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Troubleshooting
`
    );

    fs.writeFileSync(
      path.join(wikiDir, 'glossary.md'),
      `---
type: Reference
title: Glossary
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Glossary
`
    );

    // Initial files
    let trackerMd = `---
type: Project
title: Work Tracker
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Work Tracker

## Open
<!-- wiki:open -->

| ID | Status | Goal | Done when | Owner | Next verification | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| T1 | 🟡 | Build parser | Tests pass | stefano | \`node --test\` | \`README.md\` |

## Proposals
<!-- wiki:proposals -->

| Proposal | By | Date | Why |
| --- | --- | --- | --- |
| Add graph filter | stefano | 2026-11-10 | Faster debugging |

## Done
<!-- wiki:done -->

| ID | Status | Goal | Closed | Criteria met | Evidence |
| --- | --- | --- | --- | --- | --- |
| T4 | 🟢 | Initial setup | 2026-11-09 | \`git status\` clean | commit a1b2c3d |
`;

    let logMd = `---
title: Wiki Log
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Log

## 2026-11-09 · Archive old task · human
- What: Closed legacy task
- Evidence: manual review @a1b2c3d
- IDs: T7
`;

    let decisionMd = `---
type: Decision
title: 0002 - Use Canvas Graph
status: proposed
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# 0002 - Use Canvas Graph

## Context
Rendering.

## Decision
Canvas.

## Alternatives rejected
- WebGL

## Consequences
Fast.

## Approval
proposed: codex on 2026-11-10.
`;

    // 1. Promote proposal to open (T8)
    const res1 = promoteProposalToOpen({
      trackerMarkdown: trackerMd,
      logMarkdown: logMd,
      proposalIndex: 0,
      person: 'Stefano',
      owner: 'Stefano',
      doneWhen: 'Filter toggles source nodes',
      nextVerification: 'node --test',
      dateIso: '2026-11-10',
      shortSha: 'b2c3d4e',
    });
    trackerMd = res1.trackerMarkdown;
    logMd = res1.logMarkdown;

    // 2. Close T1 without proof (human unproven)
    const res2 = closeTrackerItemHumanUnproven({
      trackerMarkdown: trackerMd,
      logMarkdown: logMd,
      taskId: 'T1',
      person: 'Stefano',
      notProvenReason: 'superseded by direct parser',
      dateIso: '2026-11-10',
      shortSha: 'b2c3d4e',
    });
    trackerMd = res2.trackerMarkdown;
    logMd = res2.logMarkdown;

    // 3. Approve decision
    const res3 = approveDecisionHuman({
      decisionMarkdown: decisionMd,
      logMarkdown: logMd,
      person: 'Stefano',
      whereContext: 'Codebase Wiki Desktop App',
      dateIso: '2026-11-10',
      shortSha: 'b2c3d4e',
    });
    decisionMd = res3.decisionMarkdown;
    logMd = res3.logMarkdown;

    // Handoff referencing open task T8
    const handoffMd = `---
type: AgentNote
title: Agent Handoff
confidence: high
sources:
  - README.md
source_commit: a1b2c3d
updated: 2026-11-10
---

# Agent Handoff

## Current Work State
<!-- wiki:state -->
- Tracker IDs: T8
- Goal: Filter
- Current branch: \`main\`

## Baton For Next Coding Agent
<!-- wiki:baton -->
| Order | Task | Start files | Done when | Verification command | Notes / blockers |
| --- | --- | --- | --- | --- | --- |
| 1 | T8 - Filter toggles | \`README.md\` | Tests pass | \`node --test\` | none |

## Blockers
<!-- wiki:blockers -->
| Blocker | Type | Needed from | Current workaround |
| --- | --- | --- | --- |
| none | external | none | none |

## Known Risks
<!-- wiki:risks -->
None.

## Commands Already Run
<!-- wiki:commands-run -->
None.

## Do Not Redo
<!-- wiki:do-not-redo -->
None.

## Evidence Trail
<!-- wiki:evidence-trail -->
None.
`;

    fs.writeFileSync(path.join(wikiDir, 'project', 'work-tracker.md'), trackerMd);
    fs.writeFileSync(path.join(wikiDir, 'log.md'), logMd);
    fs.writeFileSync(path.join(wikiDir, 'project', 'decisions', '0002-canvas.md'), decisionMd);
    fs.writeFileSync(path.join(wikiDir, 'agent', 'handoff.md'), handoffMd);

    // Validate using validate-wiki.py
    const validatorScript = path.resolve(process.cwd(), 'resources', 'validate-wiki.py');
    const result = execFileSync('python3', [validatorScript, wikiDir], { encoding: 'utf-8' });
    assert.match(result, /wiki structural validation passed/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
